import crypto from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  normalizeMetaWebhookPayload,
  type MetaWebhookEventKind,
  type NormalizedMetaMessage,
  type NormalizedMetaWebhookEvent,
} from './meta-whatsapp-coexistence.js';

type MetaAccount = {
  id: string;
  user_id: string;
  waba_id: string | null;
  phone_number_id: string;
  phone_number: string | null;
  access_token: string | null;
  mode: string | null;
};

type BoundEvent = {
  account: MetaAccount;
  waNumber: string;
  event: NormalizedMetaWebhookEvent;
};

type InboxRow = {
  id: string;
  user_id: string;
  phone_number_id: string;
  wa_number: string;
  event_key: string;
  payload: NormalizedMetaWebhookEvent;
  status: string;
  attempts: number;
};

export type MetaWebhookRuntimeDeps = {
  db: SupabaseClient;
  decryptToken: (value: string | null) => string | null;
  normalizePhone: (value: string) => string;
  phoneVariants?: (value: string) => string[];
  storeMedia?: (userId: string, buffer: Buffer, mimeType: string) => Promise<string>;
  understandMedia?: (type: 'audio' | 'image', buffer: Buffer, mimeType: string) => Promise<string | null>;
  captureContact?: (input: {
    userId: string;
    phone: string;
    waNumber: string;
    messageId: string;
    messageBody: string | null;
    messageTimestamp: string | null;
    ctwaClid: string | null;
    wabaId: string | null;
    referral: Record<string, unknown> | null;
  }) => Promise<void>;
  scheduleReply?: (userId: string, phone: string, type: string, waNumber: string) => void;
  markHumanActive?: (userId: string, phone: string, waNumber: string) => Promise<void>;
};

export type MetaWebhookIngestResult = {
  accepted: number;
  duplicates: number;
  durable: boolean;
};

export function isCoexistenceSchemaMissing(error: any): boolean {
  const code = String(error?.code || '');
  const message = String(error?.message || '');
  return ['42P01', '42703', 'PGRST204', 'PGRST205'].includes(code)
    || /whatsapp_webhook_inbox|whatsapp_channel_accounts|source_event_key|provider_message_id/i.test(message);
}

function digits(value: unknown): string {
  return String(value || '').replace(/\D/g, '');
}

function safePhoneVariants(deps: MetaWebhookRuntimeDeps, value: string): string[] {
  const normalized = digits(value);
  if (normalized !== value || normalized.length < 8) return [value];
  return deps.phoneVariants?.(value) || [value];
}

function eventNeedsAccount(event: NormalizedMetaWebhookEvent): boolean {
  return event.kind !== 'unknown' || Boolean(event.phoneNumberId || event.wabaId);
}

function isDuplicateError(error: any): boolean {
  return String(error?.code || '') === '23505' || /duplicate|unique/i.test(String(error?.message || ''));
}

function messageStatus(kind: MetaWebhookEventKind, message: NormalizedMetaMessage): string {
  if (!message.fromMe) return 'received';
  const status = String((message.raw.history_context as any)?.status || '').toLowerCase();
  if (['sent', 'delivered', 'read', 'played', 'failed'].includes(status)) return status;
  return kind === 'history' ? 'sent' : 'sent';
}

function lastMessageText(message: NormalizedMetaMessage): string {
  return message.body || `[${message.type === 'voice' ? 'audio' : message.type}]`;
}

function retryAt(attempts: number): string {
  const seconds = Math.min(3600, 5 * (2 ** Math.min(attempts, 8)));
  return new Date(Date.now() + seconds * 1000).toISOString();
}

export function singleActiveMetaAccount<T>(rows: T[], identity: string): T | null {
  if (!rows.length) return null;
  if (rows.length > 1) throw new Error(`${identity} está associado a mais de uma conta ativa`);
  return rows[0];
}

async function accountByPhone(db: SupabaseClient, phoneNumberId: string): Promise<MetaAccount | null> {
  const { data, error } = await db.from('whatsapp_business_accounts')
    .select('id,user_id,waba_id,phone_number_id,phone_number,access_token,mode')
    .eq('phone_number_id', phoneNumberId)
    .eq('is_active', true)
    .limit(2);
  if (error) throw error;
  return singleActiveMetaAccount((data || []) as MetaAccount[], `phone_number_id ${phoneNumberId}`);
}

async function accountsByWaba(db: SupabaseClient, wabaId: string): Promise<MetaAccount[]> {
  const { data, error } = await db.from('whatsapp_business_accounts')
    .select('id,user_id,waba_id,phone_number_id,phone_number,access_token,mode')
    .eq('waba_id', wabaId)
    .eq('is_active', true)
    .limit(100);
  if (error) throw error;
  return (data || []) as MetaAccount[];
}

async function resolveEventAccounts(db: SupabaseClient, event: NormalizedMetaWebhookEvent): Promise<MetaAccount[]> {
  if (event.phoneNumberId) {
    const byPhone = await accountByPhone(db, event.phoneNumberId);
    if (byPhone) return [byPhone];
  }
  return event.wabaId ? accountsByWaba(db, event.wabaId) : [];
}

async function bindEvents(db: SupabaseClient, events: NormalizedMetaWebhookEvent[]): Promise<BoundEvent[]> {
  const result: BoundEvent[] = [];
  const accountCache = new Map<string, MetaAccount[]>();
  for (const event of events) {
    const accountKey = event.phoneNumberId ? `phone:${event.phoneNumberId}` : `waba:${event.wabaId || ''}`;
    if (!accountCache.has(accountKey)) accountCache.set(accountKey, await resolveEventAccounts(db, event));
    const accounts = accountCache.get(accountKey) || [];
    if (!accounts.length) {
      if (eventNeedsAccount(event)) throw new Error(`Conta Meta ativa não encontrada para ${event.phoneNumberId || event.wabaId || 'evento'}`);
      continue;
    }
    if (new Set(accounts.map(account => account.user_id)).size > 1) {
      throw new Error(`WABA ${event.wabaId || 'desconhecida'} está associada a mais de um tenant`);
    }
    if (accounts.length > 1 && event.kind !== 'account_update') {
      throw new Error(`Evento ${event.kind} sem phone_number_id é ambíguo para a WABA ${event.wabaId || 'desconhecida'}`);
    }
    for (const account of accounts) {
      const waNumber = digits(event.displayPhoneNumber || account.phone_number) || `unassigned:meta:${account.phone_number_id}`;
      result.push({ account, waNumber, event });
    }
  }
  return result;
}

async function inboxExists(db: SupabaseClient): Promise<boolean> {
  const { error } = await db.from('whatsapp_webhook_inbox').select('id').limit(1);
  if (!error) return true;
  if (isCoexistenceSchemaMissing(error)) return false;
  throw error;
}

async function stageEvents(db: SupabaseClient, bound: BoundEvent[]): Promise<{ accepted: number; duplicates: number }> {
  if (!bound.length) return { accepted: 0, duplicates: 0 };
  const receivedAt = new Date().toISOString();
  const rows = bound.map(item => ({
    user_id: item.account.user_id,
    provider: 'meta',
    phone_number_id: item.account.phone_number_id,
    wa_number: item.waNumber,
    event_key: item.event.eventKey,
    field: item.event.field,
    payload: item.event,
    status: 'pending',
    attempts: 0,
    received_at: receivedAt,
  }));
  const result = await db.from('whatsapp_webhook_inbox').upsert(rows, {
    onConflict: 'user_id,phone_number_id,event_key',
    ignoreDuplicates: true,
  }).select('event_key');
  if (result.error) throw result.error;
  const accepted = result.data?.length || 0;
  return { accepted, duplicates: bound.length - accepted };
}

async function ensureChannelAccount(db: SupabaseClient, bound: BoundEvent): Promise<string | null> {
  const lookup = await db.from('whatsapp_channel_accounts')
    .select('id')
    .eq('user_id', bound.account.user_id)
    .eq('phone_number_id', bound.account.phone_number_id)
    .limit(1)
    .maybeSingle();
  if (lookup.data?.id) return String(lookup.data.id);
  if (lookup.error && isCoexistenceSchemaMissing(lookup.error)) return null;
  if (lookup.error) throw lookup.error;
  const inserted = await db.from('whatsapp_channel_accounts').insert({
    user_id: bound.account.user_id,
    provider: 'meta',
    waba_id: bound.account.waba_id,
    phone_number_id: bound.account.phone_number_id,
    wa_number: bound.waNumber,
    preferred_channel: 'auto',
    mode: bound.account.mode || 'cloud_api',
    is_active: true,
    legacy_account_id: bound.account.id,
  }).select('id').single();
  if (!inserted.error) return String(inserted.data.id);
  if (!isDuplicateError(inserted.error)) throw inserted.error;
  const retry = await db.from('whatsapp_channel_accounts').select('id')
    .eq('user_id', bound.account.user_id)
    .eq('phone_number_id', bound.account.phone_number_id)
    .limit(1)
    .maybeSingle();
  return retry.data?.id ? String(retry.data.id) : null;
}

async function updateDeliveryStatus(deps: MetaWebhookRuntimeDeps, bound: BoundEvent): Promise<void> {
  const status = String(bound.event.status?.status || '');
  const messageId = String(bound.event.status?.id || '');
  if (!status || !messageId) return;
  const waNumbers = safePhoneVariants(deps, bound.waNumber);
  const { error } = await deps.db.from('wa_messages').update({ status })
    .eq('user_id', bound.account.user_id)
    .in('wa_number', waNumbers)
    .eq('message_id', messageId);
  if (error) throw error;
}

async function messagePresence(
  db: SupabaseClient,
  bound: BoundEvent,
  phoneVariants: string[],
  waNumberVariants: string[],
): Promise<'new' | 'same_event' | 'duplicate'> {
  const message = bound.event.message;
  if (!message) return 'duplicate';
  const direct = await db.from('wa_messages').select('message_id,source_event_key')
    .eq('user_id', bound.account.user_id)
    .in('wa_number', waNumberVariants)
    .eq('message_id', message.id)
    .limit(1);
  if (direct.error && !isCoexistenceSchemaMissing(direct.error)) throw direct.error;
  if (direct.error) {
    const legacyDirect = await db.from('wa_messages').select('message_id')
      .eq('user_id', bound.account.user_id)
      .in('wa_number', waNumberVariants)
      .eq('message_id', message.id)
      .limit(1);
    if (legacyDirect.error) throw legacyDirect.error;
    if (legacyDirect.data?.length) return 'duplicate';
  }
  if (direct.data?.length) {
    return (direct.data[0] as any).source_event_key === bound.event.eventKey ? 'same_event' : 'duplicate';
  }
  if (!message.timestamp || message.type !== 'text' || !message.body.trim()) return 'new';
  const exact = await db.from('wa_messages').select('message_id')
    .eq('user_id', bound.account.user_id)
    .in('wa_number', waNumberVariants)
    .in('phone', phoneVariants)
    .eq('timestamp', message.timestamp)
    .eq('from_me', message.fromMe)
    .eq('type', 'text')
    .eq('body', message.body)
    .limit(1);
  if (exact.error) throw exact.error;
  return exact.data?.length ? 'duplicate' : 'new';
}

async function fetchAndStoreMedia(
  deps: MetaWebhookRuntimeDeps,
  bound: BoundEvent,
): Promise<{ url: string | null; buffer: Buffer | null; mimeType: string }> {
  const message = bound.event.message;
  if (!message?.mediaId) return { url: null, buffer: null, mimeType: '' };
  const token = deps.decryptToken(bound.account.access_token);
  if (!token) return { url: null, buffer: null, mimeType: '' };
  try {
    const infoResponse = await fetch(`https://graph.facebook.com/v21.0/${message.mediaId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!infoResponse.ok) return { url: null, buffer: null, mimeType: '' };
    const info = await infoResponse.json() as { url?: string; mime_type?: string };
    if (!info.url) return { url: null, buffer: null, mimeType: '' };
    const fileResponse = await fetch(info.url, { headers: { Authorization: `Bearer ${token}` } });
    if (!fileResponse.ok) return { url: null, buffer: null, mimeType: '' };
    const mimeType = fileResponse.headers.get('content-type') || info.mime_type || message.mimeType || 'application/octet-stream';
    const buffer = Buffer.from(await fileResponse.arrayBuffer());
    const url = deps.storeMedia ? await deps.storeMedia(bound.account.user_id, buffer, mimeType) : null;
    return { url, buffer, mimeType };
  } catch {
    return { url: null, buffer: null, mimeType: '' };
  }
}

async function insertMessage(
  db: SupabaseClient,
  bound: BoundEvent,
  channelAccountId: string | null,
  mediaUrl: string | null,
  inboxId?: string,
): Promise<boolean> {
  const message = bound.event.message!;
  const base = {
    user_id: bound.account.user_id,
    phone: message.customerPhone,
    wa_number: bound.waNumber,
    message_id: message.id,
    body: message.body,
    from_me: message.fromMe,
    timestamp: message.timestamp || new Date().toISOString(),
    type: message.type === 'voice' ? 'audio' : message.type,
    status: messageStatus(bound.event.kind, message),
    ...(mediaUrl ? { media_url: mediaUrl } : {}),
  };
  const withProvenance = {
    ...base,
    channel_account_id: channelAccountId,
    provider: 'meta',
    provider_message_id: message.id,
    source_event_key: bound.event.eventKey,
    webhook_inbox_id: inboxId || null,
  };
  let result = await db.from('wa_messages').insert(withProvenance);
  if (result.error && isCoexistenceSchemaMissing(result.error)) result = await db.from('wa_messages').insert(base);
  if (!result.error) return true;
  if (isDuplicateError(result.error)) return false;
  throw result.error;
}

function shouldAdvanceConversation(lastAt: unknown, messageAt: string): boolean {
  if (!lastAt) return true;
  return new Date(messageAt).getTime() >= new Date(String(lastAt)).getTime();
}

async function syncedContactName(db: SupabaseClient, bound: BoundEvent, phone: string): Promise<string | null> {
  const result = await db.from('whatsapp_channel_contacts').select('contact_name')
    .eq('user_id', bound.account.user_id)
    .eq('phone_number_id', bound.account.phone_number_id)
    .eq('contact_phone', phone)
    .limit(1)
    .maybeSingle();
  if (result.error && isCoexistenceSchemaMissing(result.error)) return null;
  if (result.error) throw result.error;
  return String(result.data?.contact_name || '').trim() || null;
}

async function updateConversation(
  db: SupabaseClient,
  bound: BoundEvent,
  channelAccountId: string | null,
  phoneVariants: string[],
  waNumberVariants: string[],
  retryingSameEvent: boolean,
): Promise<void> {
  const message = bound.event.message!;
  const messageAt = message.timestamp || new Date().toISOString();
  const webhookContactName = String(message.raw._contact_name || '').trim() || null;
  const contactName = webhookContactName || await syncedContactName(db, bound, message.customerPhone);
  const existing = await db.from('wa_conversations').select('id,last_message,last_message_at,unread_count,contact_name')
    .eq('user_id', bound.account.user_id)
    .in('wa_number', waNumberVariants)
    .in('phone', phoneVariants)
    .limit(1)
    .maybeSingle();
  if (existing.error) throw existing.error;
  const alreadyApplied = retryingSameEvent
    && String(existing.data?.last_message_at || '') === messageAt
    && String(existing.data?.last_message || '') === lastMessageText(message);
  const unreadDelta = bound.event.kind === 'message' && !message.fromMe && !alreadyApplied ? 1 : 0;
  if (!existing.data) {
    const payload = {
      user_id: bound.account.user_id,
      phone: message.customerPhone,
      wa_number: bound.waNumber,
      last_message: lastMessageText(message),
      last_message_at: messageAt,
      unread_count: unreadDelta,
      ...(contactName ? { contact_name: contactName } : {}),
    };
    let inserted = await db.from('wa_conversations').insert({
      ...payload,
      channel_account_id: channelAccountId,
      provider: 'meta',
    });
    if (inserted.error && isCoexistenceSchemaMissing(inserted.error)) {
      inserted = await db.from('wa_conversations').insert(payload);
    }
    if (inserted.error && !isDuplicateError(inserted.error)) throw inserted.error;
    return;
  }
  const update: Record<string, unknown> = {
    unread_count: Number(existing.data.unread_count || 0) + unreadDelta,
  };
  if (contactName && !existing.data.contact_name) update.contact_name = contactName;
  if (shouldAdvanceConversation(existing.data.last_message_at, messageAt)) {
    update.last_message = lastMessageText(message);
    update.last_message_at = messageAt;
  }
  const changed = await db.from('wa_conversations').update(update).eq('id', existing.data.id);
  if (changed.error) throw changed.error;
}

async function saveTranscription(
  deps: MetaWebhookRuntimeDeps,
  bound: BoundEvent,
  buffer: Buffer | null,
  mimeType: string,
): Promise<void> {
  const message = bound.event.message!;
  const type = message.type === 'voice' ? 'audio' : message.type;
  if (!buffer || !deps.understandMedia || (type !== 'audio' && type !== 'image')) return;
  try {
    const transcription = await deps.understandMedia(type, buffer, mimeType);
    if (!transcription) return;
    await deps.db.from('wa_messages').update({ transcription })
      .eq('user_id', bound.account.user_id)
      .in('wa_number', safePhoneVariants(deps, bound.waNumber))
      .eq('message_id', message.id);
  } catch {
    // A mídia e a mensagem já estão persistidas; compreensão é enriquecimento best-effort.
  }
}

async function captureInboundMarketingContact(
  deps: MetaWebhookRuntimeDeps,
  bound: BoundEvent,
): Promise<void> {
  const message = bound.event.message;
  if (
    bound.event.kind !== 'message'
    || !message
    || message.fromMe
    || !deps.captureContact
  ) return;
  await deps.captureContact({
    userId: bound.account.user_id,
    phone: message.customerPhone,
    waNumber: bound.waNumber,
    messageId: message.id,
    messageBody: message.body || null,
    messageTimestamp: message.timestamp,
    ctwaClid: typeof message.referral?.ctwa_clid === 'string'
      ? message.referral.ctwa_clid
      : null,
    wabaId: bound.account.waba_id,
    referral: message.referral,
  });
}

async function processMessage(
  deps: MetaWebhookRuntimeDeps,
  bound: BoundEvent,
  inboxId?: string,
): Promise<void> {
  const originalMessage = bound.event.message;
  const normalizedPhone = deps.normalizePhone(originalMessage?.customerPhone || '');
  const message = originalMessage ? { ...originalMessage, customerPhone: normalizedPhone } : null;
  if (!message?.customerPhone) throw new Error(`Mensagem Meta ${message?.id || 'sem id'} sem telefone do contato`);
  const normalizedBound = { ...bound, event: { ...bound.event, message } };
  const phoneVariants = deps.phoneVariants?.(normalizedPhone) || [normalizedPhone];
  const waNumberVariants = safePhoneVariants(deps, bound.waNumber);
  const presence = await messagePresence(deps.db, normalizedBound, phoneVariants, waNumberVariants);
  if (presence === 'duplicate') {
    await captureInboundMarketingContact(deps, normalizedBound);
    return;
  }
  const channelAccountId = await ensureChannelAccount(deps.db, normalizedBound);
  const media = presence === 'new'
    ? await fetchAndStoreMedia(deps, normalizedBound)
    : { url: null, buffer: null, mimeType: '' };
  if (presence === 'new') {
    const inserted = await insertMessage(deps.db, normalizedBound, channelAccountId, media.url, inboxId);
    if (!inserted) {
      await captureInboundMarketingContact(deps, normalizedBound);
      return;
    }
  }
  await updateConversation(
    deps.db,
    normalizedBound,
    channelAccountId,
    phoneVariants,
    waNumberVariants,
    presence === 'same_event',
  );
  if (normalizedBound.event.kind === 'message' && !message.fromMe) {
    await captureInboundMarketingContact(deps, normalizedBound);
    deps.scheduleReply?.(bound.account.user_id, message.customerPhone, message.type, bound.waNumber);
  }
  if (normalizedBound.event.kind === 'smb_message_echo') {
    try {
      await deps.markHumanActive?.(bound.account.user_id, message.customerPhone, bound.waNumber);
    } catch {
      // Estado auxiliar; o eco permanece salvo e idempotente.
    }
  }
  await saveTranscription(deps, normalizedBound, media.buffer, media.mimeType);
}

function syncedContacts(raw: Record<string, unknown>): Array<{ phone: string; name: string; raw: Record<string, unknown> }> {
  const candidates = [raw.contacts, (raw.data as any)?.contacts, (raw.state as any)?.contacts, raw.state_sync]
    .filter(Array.isArray)
    .flat() as Array<Record<string, unknown>>;
  return candidates.flatMap(item => {
    const action = (item.action || {}) as Record<string, unknown>;
    const contact = (item.contact || action.contact || action || item) as Record<string, unknown>;
    const phone = digits(contact.wa_id || contact.phone_number || contact.phone || contact.id);
    const profile = contact.profile as Record<string, unknown> | undefined;
    const name = String(contact.full_name || contact.name || profile?.name || '').trim();
    return phone.length >= 8 && phone.length <= 15 && name ? [{ phone, name, raw: item }] : [];
  });
}

async function persistSyncedContacts(deps: MetaWebhookRuntimeDeps, bound: BoundEvent): Promise<void> {
  const channelAccountId = await ensureChannelAccount(deps.db, bound);
  for (const contact of syncedContacts(bound.event.raw)) {
    const phone = deps.normalizePhone(contact.phone);
    const stored = await deps.db.from('whatsapp_channel_contacts').upsert({
      user_id: bound.account.user_id,
      channel_account_id: channelAccountId,
      phone_number_id: bound.account.phone_number_id,
      wa_number: bound.waNumber,
      contact_phone: phone,
      contact_name: contact.name,
      raw: contact.raw,
      synced_at: new Date().toISOString(),
    }, { onConflict: 'user_id,phone_number_id,contact_phone' });
    if (stored.error && !isCoexistenceSchemaMissing(stored.error)) throw stored.error;
    const updated = await deps.db.from('wa_conversations').update({ contact_name: contact.name })
      .eq('user_id', bound.account.user_id)
      .in('wa_number', safePhoneVariants(deps, bound.waNumber))
      .in('phone', deps.phoneVariants?.(phone) || [phone])
      .select('id');
    if (updated.error) throw updated.error;
  }
}

function terminalSyncState(value: unknown): boolean {
  return ['finished', 'completed', 'complete', 'success', 'succeeded', 'synced'].includes(String(value || '').toLowerCase());
}

function failedSyncState(value: unknown): boolean {
  return ['failed', 'error'].includes(String(value || '').toLowerCase());
}

function requestedSyncComplete(details: Record<string, any>): boolean {
  const requested = Array.isArray(details.requested_types) ? details.requested_types : [];
  if (!requested.length) return Boolean(details.history?.completed || details.contacts?.completed);
  return requested.every((type: string) => (
    type === 'history' ? details.history?.completed === true : details.contacts?.completed === true
  ));
}

async function mutateSyncDetails(
  db: SupabaseClient,
  bound: BoundEvent,
  mutate: (details: Record<string, any>) => Record<string, any>,
): Promise<void> {
  const current = await db.from('whatsapp_channel_accounts').select('id,sync_details,sync_status')
    .eq('user_id', bound.account.user_id)
    .eq('phone_number_id', bound.account.phone_number_id)
    .limit(1)
    .maybeSingle();
  if (current.error && isCoexistenceSchemaMissing(current.error)) return;
  if (current.error) throw current.error;
  if (!current.data) return;
  const details = mutate((current.data.sync_details || {}) as Record<string, any>);
  const completed = requestedSyncComplete(details);
  const failed = details.history?.failed === true || details.contacts?.failed === true;
  const now = new Date().toISOString();
  const result = await db.from('whatsapp_channel_accounts').update({
    sync_details: details,
    sync_status: failed ? 'failed' : completed ? 'synced' : 'processing',
    sync_updated_at: now,
    ...(completed ? { sync_completed_at: now, sync_error: null } : {}),
  }).eq('id', current.data.id);
  if (result.error) throw result.error;
}

async function updateHistoryProgress(db: SupabaseClient, bound: BoundEvent): Promise<void> {
  const context = (bound.event.message?.raw.history_context || {}) as Record<string, unknown>;
  if (context.sync_checkpoint !== true) return;
  const phase = context.phase || context.status;
  const progress = Number(context.progress);
  const completed = terminalSyncState(phase) || (Number.isFinite(progress) && progress >= 100);
  await mutateSyncDetails(db, bound, details => {
    const previous = details.history || {};
    const previousOrder = Number(previous.chunk_order);
    const nextOrder = Number(context.chunk_order);
    const staleChunk = Number.isFinite(previousOrder)
      && Number.isFinite(nextOrder)
      && nextOrder < previousOrder;
    if (staleChunk || (previous.completed === true && !completed)) return details;
    return {
      ...details,
      history: {
        ...previous,
        phase: phase || null,
        progress: Number.isFinite(progress) ? progress : null,
        chunk_order: context.chunk_order ?? null,
        completed,
        updated_at: new Date().toISOString(),
      },
    };
  });
}

async function updateAppSyncState(db: SupabaseClient, bound: BoundEvent): Promise<void> {
  const state = bound.event.status?.state || bound.event.status?.status || bound.event.status?.event;
  await mutateSyncDetails(db, bound, details => {
    const previous = details.contacts || {};
    const completed = terminalSyncState(state);
    if (previous.completed === true && !completed) return details;
    return {
      ...details,
      contacts: {
        state: state || null,
        completed,
        failed: failedSyncState(state),
        updated_at: new Date().toISOString(),
      },
    };
  });
}

async function recordAccountUpdate(db: SupabaseClient, bound: BoundEvent): Promise<void> {
  const current = await db.from('whatsapp_channel_accounts').select('id,sync_details')
    .eq('user_id', bound.account.user_id)
    .eq('phone_number_id', bound.account.phone_number_id)
    .limit(1)
    .maybeSingle();
  if (current.error && isCoexistenceSchemaMissing(current.error)) return;
  if (current.error) throw current.error;
  if (!current.data) return;
  const result = await db.from('whatsapp_channel_accounts').update({
    sync_details: {
      ...(current.data.sync_details || {}),
      account_update: { payload: bound.event.raw, received_at: new Date().toISOString() },
    },
    updated_at: new Date().toISOString(),
  }).eq('id', current.data.id);
  if (result.error) throw result.error;
}

async function processBoundEvent(deps: MetaWebhookRuntimeDeps, bound: BoundEvent, inboxId?: string): Promise<void> {
  if (bound.event.kind === 'status') return updateDeliveryStatus(deps, bound);
  if (bound.event.message) {
    await processMessage(deps, bound, inboxId);
    if (bound.event.kind === 'history') await updateHistoryProgress(deps.db, bound);
    return;
  }
  if (bound.event.kind === 'smb_app_state_sync') {
    await persistSyncedContacts(deps, bound);
    return updateAppSyncState(deps.db, bound);
  }
  if (bound.event.kind === 'account_update') return recordAccountUpdate(deps.db, bound);
}

async function resolveInboxBound(db: SupabaseClient, row: InboxRow): Promise<BoundEvent> {
  const account = await accountByPhone(db, row.phone_number_id);
  if (!account || account.user_id !== row.user_id) throw new Error('Conta do evento não pertence ao tenant persistido');
  return { account, waNumber: row.wa_number, event: row.payload };
}

async function pendingRows(db: SupabaseClient, limit: number): Promise<InboxRow[]> {
  const pending = await db.from('whatsapp_webhook_inbox')
    .select('id,user_id,phone_number_id,wa_number,event_key,payload,status,attempts')
    .in('status', ['pending', 'retry'])
    .lte('next_attempt_at', new Date().toISOString())
    .order('received_at', { ascending: true })
    .limit(limit);
  if (pending.error) {
    if (isCoexistenceSchemaMissing(pending.error)) return [];
    throw pending.error;
  }
  const remaining = Math.max(0, limit - (pending.data?.length || 0));
  if (!remaining) return (pending.data || []) as InboxRow[];
  const expired = await db.from('whatsapp_webhook_inbox')
    .select('id,user_id,phone_number_id,wa_number,event_key,payload,status,attempts')
    .eq('status', 'processing')
    .lt('lease_expires_at', new Date().toISOString())
    .order('received_at', { ascending: true })
    .limit(remaining);
  if (expired.error && !isCoexistenceSchemaMissing(expired.error)) throw expired.error;
  return [...(pending.data || []), ...(expired.data || [])] as InboxRow[];
}

async function claimRow(db: SupabaseClient, row: InboxRow, workerId: string): Promise<boolean> {
  const now = new Date();
  let query = db.from('whatsapp_webhook_inbox').update({
    status: 'processing',
    attempts: Number(row.attempts || 0) + 1,
    processing_started_at: now.toISOString(),
    lease_expires_at: new Date(now.getTime() + 120_000).toISOString(),
    worker_id: workerId,
  }).eq('id', row.id).eq('status', row.status);
  if (row.status === 'processing') query = query.lt('lease_expires_at', now.toISOString());
  const claimed = await query.select('id');
  if (claimed.error) throw claimed.error;
  return Boolean(claimed.data?.length);
}

async function markProcessed(db: SupabaseClient, row: InboxRow, workerId: string): Promise<void> {
  const { error } = await db.from('whatsapp_webhook_inbox').update({
    status: 'processed',
    processed_at: new Date().toISOString(),
    lease_expires_at: null,
    worker_id: null,
    last_error: null,
  }).eq('id', row.id).eq('worker_id', workerId);
  if (error) throw error;
}

async function markRetry(db: SupabaseClient, row: InboxRow, workerId: string, error: unknown): Promise<void> {
  const attempts = Number(row.attempts || 0) + 1;
  await db.from('whatsapp_webhook_inbox').update({
    status: attempts >= 10 ? 'dead' : 'retry',
    next_attempt_at: retryAt(attempts),
    lease_expires_at: null,
    worker_id: null,
    last_error: String((error as any)?.message || error).slice(0, 1000),
  }).eq('id', row.id).eq('worker_id', workerId);
}

export function createMetaWebhookRuntime(deps: MetaWebhookRuntimeDeps) {
  let draining = false;

  async function drain(limit = 25): Promise<number> {
    if (draining) return 0;
    draining = true;
    const workerId = crypto.randomUUID();
    let processed = 0;
    try {
      const rows = await pendingRows(deps.db, limit);
      for (const row of rows) {
        if (!await claimRow(deps.db, row, workerId)) continue;
        try {
          const bound = await resolveInboxBound(deps.db, row);
          await processBoundEvent(deps, bound, row.id);
          await markProcessed(deps.db, row, workerId);
          processed += 1;
        } catch (error) {
          await markRetry(deps.db, row, workerId, error);
        }
      }
      return processed;
    } finally {
      draining = false;
    }
  }

  async function ingest(payload: unknown): Promise<MetaWebhookIngestResult> {
    const events = normalizeMetaWebhookPayload(payload);
    const bound = await bindEvents(deps.db, events);
    if (!await inboxExists(deps.db)) {
      for (const item of bound) await processBoundEvent(deps, item);
      return { accepted: bound.length, duplicates: 0, durable: false };
    }
    const staged = await stageEvents(deps.db, bound);
    return { ...staged, durable: true };
  }

  return { ingest, drain };
}

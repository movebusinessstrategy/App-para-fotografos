import crypto from 'node:crypto';

export const META_SYNC_TYPES = ['smb_app_state_sync', 'history'] as const;

export type MetaSyncType = typeof META_SYNC_TYPES[number];
export type WhatsAppChannelPreference = 'auto' | 'meta' | 'baileys';
export type MetaWebhookEventKind =
  | 'message'
  | 'status'
  | 'history'
  | 'smb_app_state_sync'
  | 'smb_message_echo'
  | 'account_update'
  | 'unknown';

export type NormalizedMetaMessage = {
  id: string;
  customerPhone: string;
  timestamp: string | null;
  type: string;
  body: string;
  mediaId: string | null;
  mimeType: string | null;
  filename: string | null;
  fromMe: boolean;
  referral: Record<string, unknown> | null;
  raw: Record<string, unknown>;
};

export type NormalizedMetaWebhookEvent = {
  eventKey: string;
  kind: MetaWebhookEventKind;
  field: string;
  wabaId: string | null;
  phoneNumberId: string | null;
  displayPhoneNumber: string | null;
  message: NormalizedMetaMessage | null;
  status: Record<string, unknown> | null;
  raw: Record<string, unknown>;
};

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function asRecords(value: unknown): UnknownRecord[] {
  return Array.isArray(value) ? value.map(asRecord).filter(item => Object.keys(item).length > 0) : [];
}

function cleanText(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const cleaned = String(value).trim();
  return cleaned || null;
}

function digits(value: unknown): string {
  return String(value || '').replace(/\D/g, '');
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as UnknownRecord)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stableValue(entry)]),
  );
}

function payloadHash(value: unknown): string {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(stableValue(value)))
    .digest('hex');
}

function normalizedTimestamp(value: unknown): string | null {
  const raw = cleanText(value);
  if (!raw) return null;
  const numeric = Number(raw);
  const date = Number.isFinite(numeric)
    ? new Date(numeric > 1_000_000_000_000 ? numeric : numeric * 1000)
    : new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function messageContent(message: UnknownRecord): {
  body: string;
  mediaId: string | null;
  mimeType: string | null;
  filename: string | null;
} {
  const type = cleanText(message.type) || 'text';
  const content = asRecord(message[type]);
  if (type === 'text') {
    return { body: cleanText(content.body) || '', mediaId: null, mimeType: null, filename: null };
  }
  return {
    body: cleanText(content.caption) || cleanText(content.filename) || '',
    mediaId: cleanText(content.id),
    mimeType: cleanText(content.mime_type),
    filename: cleanText(content.filename),
  };
}

function customerPhone(message: UnknownRecord, ownNumber: string, fromMe: boolean): string {
  const from = digits(message.from);
  const to = digits(message.to);
  const historyContext = asRecord(message.history_context);
  const threadPhone = [historyContext.wa_id, historyContext.phone, historyContext.id]
    .map(digits)
    .find(candidate => candidate.length >= 8 && candidate.length <= 15) || '';
  if (fromMe) return to || (from === ownNumber ? '' : from) || threadPhone;
  return from || (to === ownNumber ? '' : to) || threadPhone;
}

function historyDirection(raw: UnknownRecord, ownNumber: string, fallback: boolean): boolean {
  const explicit = typeof raw.from_me === 'boolean' ? raw.from_me : null;
  if (explicit !== null) return explicit;
  const from = digits(raw.from);
  const to = digits(raw.to);
  if (ownNumber && from === ownNumber) return true;
  if (ownNumber && to === ownNumber) return false;
  const historyStatus = (cleanText(asRecord(raw.history_context).status) || '').toLowerCase();
  if (['received', 'incoming', 'inbound'].includes(historyStatus)) return false;
  if (['sent', 'delivered', 'read', 'played', 'outgoing', 'outbound'].includes(historyStatus)) return true;
  return fallback;
}

function normalizeMessage(
  raw: UnknownRecord,
  ownNumber: string,
  defaultFromMe: boolean,
): NormalizedMetaMessage | null {
  const id = cleanText(raw.id) || cleanText(raw.message_id);
  if (!id) return null;
  const fromMe = historyDirection(raw, ownNumber, defaultFromMe);
  const content = messageContent(raw);
  return {
    id,
    customerPhone: customerPhone(raw, ownNumber, fromMe),
    timestamp: normalizedTimestamp(raw.timestamp),
    type: cleanText(raw.type) || 'text',
    body: content.body,
    mediaId: content.mediaId,
    mimeType: content.mimeType,
    filename: content.filename,
    fromMe,
    referral: Object.keys(asRecord(raw.referral)).length ? asRecord(raw.referral) : null,
    raw,
  };
}

function eventIdentity(kind: MetaWebhookEventKind, value: UnknownRecord): string {
  const id = cleanText(value.id) || cleanText(value.message_id);
  if (kind === 'status') {
    return [id, cleanText(value.status), cleanText(value.timestamp)].filter(Boolean).join(':');
  }
  return id || payloadHash(value);
}

function makeEvent(
  kind: MetaWebhookEventKind,
  field: string,
  context: { wabaId: string | null; phoneNumberId: string | null; displayPhoneNumber: string | null },
  raw: UnknownRecord,
  message: NormalizedMetaMessage | null = null,
): NormalizedMetaWebhookEvent {
  return {
    eventKey: [
      context.wabaId || '_',
      context.phoneNumberId || '_',
      field,
      kind,
      eventIdentity(kind, raw),
    ].join(':'),
    kind,
    field,
    ...context,
    message,
    status: kind === 'status' || kind === 'smb_app_state_sync' || kind === 'account_update' ? raw : null,
    raw,
  };
}

function messageEvents(
  kind: 'message' | 'history' | 'smb_message_echo',
  field: string,
  context: { wabaId: string | null; phoneNumberId: string | null; displayPhoneNumber: string | null },
  values: UnknownRecord[],
): NormalizedMetaWebhookEvent[] {
  const ownNumber = digits(context.displayPhoneNumber);
  return values.flatMap((raw) => {
    const message = normalizeMessage(raw, ownNumber, kind === 'smb_message_echo');
    return message ? [makeEvent(kind, field, context, raw, message)] : [];
  });
}

function messagesWithContactNames(value: UnknownRecord): UnknownRecord[] {
  const names = new Map<string, string>();
  for (const contact of asRecords(value.contacts)) {
    const phone = digits(contact.wa_id || contact.phone);
    const name = cleanText(asRecord(contact.profile).name) || cleanText(contact.name);
    if (phone && name) names.set(phone, name);
  }
  return asRecords(value.messages).map(message => {
    const name = names.get(digits(message.from)) || names.get(digits(message.to));
    return name ? { ...message, _contact_name: name } : message;
  });
}

function historyMessages(value: UnknownRecord): UnknownRecord[] {
  const history = value.history;
  if (Array.isArray(history)) {
    return history.flatMap(item => {
      const record = asRecord(item);
      const historyContext = Object.fromEntries(
        Object.entries(record).filter(([key]) => key !== 'messages' && key !== 'threads'),
      );
      const threadMessages = asRecords(record.threads).flatMap(thread => {
        const threadContext = Object.fromEntries(
          Object.entries(thread).filter(([key]) => key !== 'messages'),
        );
        return asRecords(thread.messages).map(message => ({
          ...message,
          history_context: {
            ...historyContext,
            ...threadContext,
            ...asRecord(message.history_context),
          },
        }));
      });
      if (threadMessages.length) {
        return threadMessages.map((message, index) => ({
          ...message,
          history_context: {
            ...asRecord(message.history_context),
            sync_checkpoint: index === threadMessages.length - 1,
          },
        }));
      }
      const nested = asRecords(record.messages);
      return nested.length
        ? nested.map((message, index) => ({
          ...message,
          history_context: {
            ...historyContext,
            ...asRecord(message.history_context),
            sync_checkpoint: index === nested.length - 1,
          },
        }))
        : [record];
    });
  }
  const historyRecord = asRecord(history);
  const messages = asRecords(historyRecord.messages).concat(asRecords(value.messages));
  const context = Object.fromEntries(
    Object.entries(historyRecord).filter(([key]) => key !== 'messages'),
  );
  return messages.map((message, index) => ({
    ...message,
    history_context: {
      ...context,
      ...asRecord(message.history_context),
      sync_checkpoint: index === messages.length - 1,
    },
  }));
}

function changeContext(entry: UnknownRecord, value: UnknownRecord) {
  const metadata = asRecord(value.metadata);
  return {
    wabaId: cleanText(entry.id) || cleanText(value.waba_id),
    phoneNumberId: cleanText(metadata.phone_number_id) || cleanText(value.phone_number_id),
    displayPhoneNumber: cleanText(metadata.display_phone_number) || cleanText(value.display_phone_number),
  };
}

function eventsForChange(entry: UnknownRecord, change: UnknownRecord): NormalizedMetaWebhookEvent[] {
  const field = cleanText(change.field) || 'unknown';
  const value = asRecord(change.value);
  const context = changeContext(entry, value);
  if (field === 'messages') {
    return [
      ...asRecords(value.statuses).map(status => makeEvent('status', field, context, status)),
      ...messageEvents('message', field, context, messagesWithContactNames(value)),
    ];
  }
  if (field === 'history') return messageEvents('history', field, context, historyMessages(value));
  if (field === 'smb_message_echoes') {
    const echoes = asRecords(value.message_echoes)
      .concat(asRecords(value.smb_message_echoes), asRecords(value.messages));
    return messageEvents('smb_message_echo', field, context, echoes);
  }
  if (field === 'smb_app_state_sync') return [makeEvent('smb_app_state_sync', field, context, value)];
  if (field === 'account_update') return [makeEvent('account_update', field, context, value)];
  return [makeEvent('unknown', field, context, value)];
}

export function normalizeMetaWebhookPayload(payload: unknown): NormalizedMetaWebhookEvent[] {
  const root = asRecord(payload);
  return asRecords(root.entry).flatMap(entry => (
    asRecords(entry.changes).flatMap(change => eventsForChange(entry, change))
  ));
}

export function normalizeSyncTypes(value: unknown): MetaSyncType[] {
  const requested = Array.isArray(value) ? value : META_SYNC_TYPES;
  const allowed = requested.filter((item): item is MetaSyncType => (
    typeof item === 'string' && META_SYNC_TYPES.includes(item as MetaSyncType)
  ));
  return [...new Set(allowed)];
}

export function buildSmbAppDataPayload(syncType: MetaSyncType): Record<string, string> {
  return { messaging_product: 'whatsapp', sync_type: syncType };
}

export function parseChannelPreference(value: unknown): WhatsAppChannelPreference | null {
  return value === 'auto' || value === 'meta' || value === 'baileys' ? value : null;
}

export function selectWhatsAppChannel(
  preference: WhatsAppChannelPreference,
  availability: { meta: boolean; baileys: boolean },
): 'meta' | 'baileys' | null {
  if (preference === 'meta') return availability.meta ? 'meta' : null;
  if (preference === 'baileys') return availability.baileys ? 'baileys' : null;
  if (availability.meta) return 'meta';
  return availability.baileys ? 'baileys' : null;
}

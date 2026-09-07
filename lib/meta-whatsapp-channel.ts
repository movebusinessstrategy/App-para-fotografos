import type { SupabaseClient } from '@supabase/supabase-js';
import {
  buildSmbAppDataPayload,
  normalizeSyncTypes,
  parseChannelPreference,
  selectWhatsAppChannel,
  type MetaSyncType,
  type WhatsAppChannelPreference,
} from './meta-whatsapp-coexistence.js';
import { isCoexistenceSchemaMissing } from './meta-whatsapp-runtime.js';

type LegacyAccount = {
  id: string;
  user_id: string;
  waba_id: string | null;
  phone_number_id: string;
  phone_number: string | null;
  access_token: string | null;
  mode: string | null;
};

type ChannelRow = {
  id: string;
  preferred_channel: WhatsAppChannelPreference;
  mode: string;
  sync_status: string;
  sync_attempts: number;
  sync_requested_at: string | null;
  sync_updated_at: string | null;
  sync_completed_at: string | null;
  sync_error: string | null;
  sync_details: Record<string, unknown> | null;
};

export type MetaPhoneStatus = {
  platform_type: string | null;
  status: string | null;
  is_on_biz_app: boolean | null;
  code_verification_status?: string | null;
  quality_rating?: string | null;
  display_phone_number?: string | null;
  verified_name?: string | null;
};

export type WhatsAppChannelState = {
  migration_ready: boolean;
  configured: boolean;
  preferred_channel: WhatsAppChannelPreference;
  selected_channel: 'meta' | 'baileys' | null;
  meta_operational: boolean;
  meta_status_checked_at: string | null;
  mode: string | null;
  phone_number_id: string | null;
  wa_number: string | null;
  sync: {
    status: string;
    attempts: number;
    requested_at: string | null;
    updated_at: string | null;
    completed_at: string | null;
    error: string | null;
    details: Record<string, unknown>;
  };
};

export class CoexistenceSchemaRequiredError extends Error {}
export class MetaChannelNotOperationalError extends Error {}

function digits(value: unknown): string {
  return String(value || '').replace(/\D/g, '');
}

async function legacyAccount(db: SupabaseClient, userId: string): Promise<LegacyAccount | null> {
  const result = await db.from('whatsapp_business_accounts')
    .select('id,user_id,waba_id,phone_number_id,phone_number,access_token,mode')
    .eq('user_id', userId)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();
  if (result.error) throw result.error;
  return result.data as LegacyAccount | null;
}

async function channelRow(
  db: SupabaseClient,
  userId: string,
  phoneNumberId: string,
): Promise<{ row: ChannelRow | null; migrationReady: boolean }> {
  const result = await db.from('whatsapp_channel_accounts')
    .select('id,preferred_channel,mode,sync_status,sync_attempts,sync_requested_at,sync_updated_at,sync_completed_at,sync_error,sync_details')
    .eq('user_id', userId)
    .eq('phone_number_id', phoneNumberId)
    .limit(1)
    .maybeSingle();
  if (result.error && isCoexistenceSchemaMissing(result.error)) return { row: null, migrationReady: false };
  if (result.error) throw result.error;
  return { row: result.data as ChannelRow | null, migrationReady: true };
}

async function ensureChannelRow(db: SupabaseClient, account: LegacyAccount): Promise<ChannelRow> {
  const existing = await channelRow(db, account.user_id, account.phone_number_id);
  if (!existing.migrationReady) throw new CoexistenceSchemaRequiredError('Migration 072 ainda não aplicada');
  if (existing.row) {
    const synced = await db.from('whatsapp_channel_accounts').update({
      waba_id: account.waba_id,
      wa_number: digits(account.phone_number),
      mode: account.mode || 'cloud_api',
      is_active: true,
      legacy_account_id: account.id,
      updated_at: new Date().toISOString(),
    }).eq('id', existing.row.id).eq('user_id', account.user_id);
    if (synced.error) throw synced.error;
    return { ...existing.row, mode: account.mode || 'cloud_api' };
  }
  const result = await db.from('whatsapp_channel_accounts').insert({
    user_id: account.user_id,
    provider: 'meta',
    waba_id: account.waba_id,
    phone_number_id: account.phone_number_id,
    wa_number: digits(account.phone_number),
    preferred_channel: 'auto',
    mode: account.mode || 'cloud_api',
    is_active: true,
    legacy_account_id: account.id,
  }).select('id,preferred_channel,mode,sync_status,sync_attempts,sync_requested_at,sync_updated_at,sync_completed_at,sync_error,sync_details').single();
  if (result.error && /duplicate|unique/i.test(String(result.error.message || ''))) {
    const retry = await channelRow(db, account.user_id, account.phone_number_id);
    if (retry.row) return retry.row;
  }
  if (result.error) throw result.error;
  return result.data as ChannelRow;
}

function booleanValue(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (String(value).toLowerCase() === 'true') return true;
  if (String(value).toLowerCase() === 'false') return false;
  return null;
}

export function isMetaPhoneOperational(status: MetaPhoneStatus, mode: string | null): boolean {
  const cloud = String(status.platform_type || '').toUpperCase() === 'CLOUD_API';
  const connected = String(status.status || '').toUpperCase() === 'CONNECTED';
  if (!cloud || !connected) return false;
  if (mode !== 'coexistence') return true;
  return booleanValue(status.is_on_biz_app) === true;
}

function cacheIsFresh(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const checkedAt = new Date(value).getTime();
  return Number.isFinite(checkedAt) && Date.now() - checkedAt <= 5 * 60 * 1000;
}

function phoneStatus(details: Record<string, unknown>): MetaPhoneStatus {
  const raw = (details.phone_status || {}) as Record<string, unknown>;
  return {
    platform_type: typeof raw.platform_type === 'string' ? raw.platform_type : null,
    status: typeof raw.status === 'string' ? raw.status : null,
    is_on_biz_app: booleanValue(raw.is_on_biz_app),
  };
}

function syncView(row: ChannelRow | null) {
  return {
    status: row?.sync_status || 'unavailable',
    attempts: Number(row?.sync_attempts || 0),
    requested_at: row?.sync_requested_at || null,
    updated_at: row?.sync_updated_at || null,
    completed_at: row?.sync_completed_at || null,
    error: row?.sync_error || null,
    details: row?.sync_details || {},
  };
}

export async function getWhatsAppChannelState(
  db: SupabaseClient,
  userId: string,
  baileysAvailable: boolean,
): Promise<WhatsAppChannelState> {
  const account = await legacyAccount(db, userId);
  if (!account) {
    return {
      migration_ready: false,
      configured: false,
      preferred_channel: 'auto',
      selected_channel: baileysAvailable ? 'baileys' : null,
      meta_operational: false,
      meta_status_checked_at: null,
      mode: null,
      phone_number_id: null,
      wa_number: null,
      sync: syncView(null),
    };
  }
  const channel = await channelRow(db, userId, account.phone_number_id);
  const details = channel.row?.sync_details || {};
  const preference = parseChannelPreference(channel.row?.preferred_channel) || 'auto';
  const operational = cacheIsFresh(details.meta_status_checked_at)
    && details.meta_operational === true
    && isMetaPhoneOperational(phoneStatus(details), channel.row?.mode || account.mode);
  return {
    migration_ready: channel.migrationReady,
    configured: true,
    preferred_channel: preference,
    selected_channel: selectWhatsAppChannel(preference, { meta: operational, baileys: baileysAvailable }),
    meta_operational: operational,
    meta_status_checked_at: typeof details.meta_status_checked_at === 'string' ? details.meta_status_checked_at : null,
    mode: channel.row?.mode || account.mode,
    phone_number_id: account.phone_number_id,
    wa_number: digits(account.phone_number) || null,
    sync: syncView(channel.row),
  };
}

export async function setWhatsAppChannelPreference(
  db: SupabaseClient,
  userId: string,
  preference: WhatsAppChannelPreference,
): Promise<void> {
  const account = await legacyAccount(db, userId);
  if (!account) throw new Error('Conta Meta ativa não encontrada');
  const row = await ensureChannelRow(db, account);
  const result = await db.from('whatsapp_channel_accounts').update({
    preferred_channel: preference,
    updated_at: new Date().toISOString(),
  }).eq('id', row.id).eq('user_id', userId);
  if (result.error) throw result.error;
}

export async function recordMetaPhoneStatus(
  db: SupabaseClient,
  userId: string,
  status: MetaPhoneStatus,
): Promise<boolean> {
  const account = await legacyAccount(db, userId);
  if (!account) return false;
  let row: ChannelRow;
  try {
    row = await ensureChannelRow(db, account);
  } catch (error) {
    if (error instanceof CoexistenceSchemaRequiredError || isCoexistenceSchemaMissing(error)) return false;
    throw error;
  }
  const checkedAt = new Date().toISOString();
  const details = {
    ...(row.sync_details || {}),
    phone_status: status,
    meta_operational: isMetaPhoneOperational(status, row.mode || account.mode),
    meta_status_checked_at: checkedAt,
  };
  const result = await db.from('whatsapp_channel_accounts').update({
    sync_details: details,
    updated_at: checkedAt,
  }).eq('id', row.id).eq('user_id', userId);
  if (result.error) throw result.error;
  return details.meta_operational;
}

async function requestOneSync(account: LegacyAccount, token: string, syncType: MetaSyncType) {
  const response = await fetch(`https://graph.facebook.com/v21.0/${account.phone_number_id}/smb_app_data`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(buildSmbAppDataPayload(syncType)),
  });
  const data = await response.json() as Record<string, unknown>;
  if (!response.ok || data.error) {
    const error = data.error as Record<string, unknown> | undefined;
    throw new Error(String(error?.message || `Meta sync ${syncType} falhou (${response.status})`));
  }
  return { sync_type: syncType, request_id: data.request_id || null };
}

async function fetchMetaPhoneStatus(account: LegacyAccount, token: string): Promise<MetaPhoneStatus> {
  const response = await fetch(
    `https://graph.facebook.com/v21.0/${account.phone_number_id}?fields=platform_type,status,is_on_biz_app,code_verification_status,quality_rating,display_phone_number,verified_name`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const data = await response.json() as Record<string, unknown>;
  if (!response.ok || data.error) {
    const error = data.error as Record<string, unknown> | undefined;
    throw new Error(String(error?.message || `Meta phone status falhou (${response.status})`));
  }
  return {
    platform_type: typeof data.platform_type === 'string' ? data.platform_type : null,
    status: typeof data.status === 'string' ? data.status : null,
    is_on_biz_app: booleanValue(data.is_on_biz_app),
    code_verification_status: typeof data.code_verification_status === 'string' ? data.code_verification_status : null,
    quality_rating: typeof data.quality_rating === 'string' ? data.quality_rating : null,
    display_phone_number: typeof data.display_phone_number === 'string' ? data.display_phone_number : null,
    verified_name: typeof data.verified_name === 'string' ? data.verified_name : null,
  };
}

export async function refreshMetaOperationalState(
  db: SupabaseClient,
  userId: string,
  decryptToken: (value: string | null) => string | null,
): Promise<boolean> {
  const account = await legacyAccount(db, userId);
  if (!account) return false;
  const token = decryptToken(account.access_token);
  if (!token) return false;
  try {
    const status = await fetchMetaPhoneStatus(account, token);
    return await recordMetaPhoneStatus(db, userId, status);
  } catch {
    return false;
  }
}

export async function requestMetaDataSync(
  db: SupabaseClient,
  userId: string,
  requestedTypes: unknown,
  decryptToken: (value: string | null) => string | null,
) {
  const syncTypes = normalizeSyncTypes(requestedTypes);
  if (!syncTypes.length) throw new Error('sync_types deve incluir history e/ou smb_app_state_sync');
  const account = await legacyAccount(db, userId);
  if (!account) throw new Error('Conta Meta ativa não encontrada');
  const row = await ensureChannelRow(db, account);
  const token = decryptToken(account.access_token);
  if (!token) throw new Error('Falha ao decifrar token da conta Meta');
  if (account.mode !== 'coexistence') {
    throw new MetaChannelNotOperationalError('Sincronização de histórico e contatos exige uma conta em modo Coexistence');
  }
  const phoneState = await fetchMetaPhoneStatus(account, token);
  await recordMetaPhoneStatus(db, userId, phoneState);
  if (!isMetaPhoneOperational(phoneState, account.mode)) {
    throw new MetaChannelNotOperationalError('Conta Meta Coexistence não está operacional (Cloud API conectada e WhatsApp Business App ativo são obrigatórios)');
  }
  const now = new Date().toISOString();
  const syncDetails = {
    ...(row.sync_details || {}),
    phone_status: phoneState,
    meta_operational: true,
    meta_status_checked_at: now,
    requested_types: syncTypes,
    requests: [],
  };
  const pending = await db.from('whatsapp_channel_accounts').update({
    sync_status: 'pending',
    sync_attempts: Number(row.sync_attempts || 0) + 1,
    sync_requested_at: now,
    sync_updated_at: now,
    sync_completed_at: null,
    sync_error: null,
    sync_details: syncDetails,
  }).eq('id', row.id).eq('user_id', userId);
  if (pending.error) throw pending.error;
  try {
    const requests = [];
    for (const syncType of syncTypes) requests.push(await requestOneSync(account, token, syncType));
    const updated = await db.from('whatsapp_channel_accounts').update({
      sync_details: { ...syncDetails, requests },
      sync_updated_at: new Date().toISOString(),
    }).eq('id', row.id).eq('user_id', userId);
    if (updated.error) throw updated.error;
    return { status: 'requested', requested: syncTypes, requested_at: now, requests };
  } catch (error: any) {
    await db.from('whatsapp_channel_accounts').update({
      sync_status: 'retry',
      sync_error: String(error?.message || error).slice(0, 1000),
      sync_updated_at: new Date().toISOString(),
    }).eq('id', row.id).eq('user_id', userId);
    throw error;
  }
}

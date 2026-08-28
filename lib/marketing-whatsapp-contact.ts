import type { SupabaseClient } from '@supabase/supabase-js';

export type MarketingWhatsAppContactInput = {
  userId: string;
  phone: string;
  waNumber?: string | null;
  messageId: string;
  messageBody?: string | null;
  occurredAt?: string | null;
  ctwaClid?: string | null;
  wabaId?: string | null;
  referral?: {
    source_url?: unknown;
    source_id?: unknown;
    source_type?: unknown;
    media_type?: unknown;
  } | null;
};

export type MarketingContactCaptureStatus =
  | 'captured'
  | 'duplicate'
  | 'unattributed'
  | 'disabled'
  | 'migration_missing';

type RpcResult = {
  status?: unknown;
  result_status?: unknown;
};

let warnedMissingMigration = false;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function cleanText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.trim();
  return cleaned ? cleaned.slice(0, maxLength) : null;
}

function digits(value: unknown, maxLength = 20): string | null {
  const cleaned = String(value || '').replace(/\D/g, '').slice(0, maxLength);
  return cleaned || null;
}

function safeOrigin(value: unknown): string | null {
  const candidate = cleanText(value, 2000);
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

function safeReferral(input: MarketingWhatsAppContactInput['referral']) {
  if (!input || typeof input !== 'object') return {};
  const values = {
    source_url: safeOrigin(input.source_url),
    ad_id: cleanText(input.source_id, 300),
    source_type: cleanText(input.source_type, 100),
    media_type: cleanText(input.media_type, 100),
  };
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value));
}

function safeOccurredAt(value: unknown): string {
  const candidate = cleanText(value, 60);
  if (!candidate) return new Date().toISOString();
  const parsed = new Date(candidate);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function isMigrationMissing(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const row = error as { code?: unknown };
  const code = String(row.code || '').trim().toUpperCase();
  return ['42883', '42P01', 'PGRST202'].includes(code);
}

function captureStatus(data: unknown): MarketingWhatsAppContactInputResult {
  const row = Array.isArray(data) ? data[0] : data;
  const result = row as RpcResult | null;
  const status = cleanText(result?.result_status ?? result?.status, 40);
  if (status === 'captured' || status === 'duplicate' || status === 'unattributed' || status === 'disabled') {
    return { status };
  }
  return { status: 'unattributed' };
}

export type MarketingWhatsAppContactInputResult = {
  status: MarketingContactCaptureStatus;
};

export function marketingWhatsAppContactRpcArgs(input: MarketingWhatsAppContactInput) {
  const userId = cleanText(input.userId, 100);
  const messageId = cleanText(input.messageId, 500);
  const phone = digits(input.phone);
  const waNumber = digits(input.waNumber);
  if (
    !userId
    || !UUID_PATTERN.test(userId)
    || !messageId
    || !phone
    || phone.length < 8
    || !waNumber
    || waNumber.length < 10
  ) return null;

  return {
    p_user_id: userId,
    p_phone: phone,
    p_wa_number: waNumber,
    p_message_id: messageId,
    p_message_body: cleanText(input.messageBody, 4000),
    p_occurred_at: safeOccurredAt(input.occurredAt),
    p_ctwa_clid: cleanText(input.ctwaClid, 500),
    p_waba_id: cleanText(input.wabaId, 200),
    p_referral_attribution: safeReferral(input.referral),
  };
}

export async function captureMarketingWhatsAppContact(
  supabase: SupabaseClient,
  input: MarketingWhatsAppContactInput,
): Promise<MarketingWhatsAppContactInputResult> {
  const args = marketingWhatsAppContactRpcArgs(input);
  if (!args) return { status: 'unattributed' };

  const { data, error } = await supabase.rpc('capture_marketing_whatsapp_contact', args);
  if (!error) return captureStatus(data);
  if (!isMigrationMissing(error)) throw error;
  if (!warnedMissingMigration) {
    warnedMissingMigration = true;
    console.warn('[marketing] migration de medição ainda não aplicada; Contact não foi enfileirado');
  }
  return { status: 'migration_missing' };
}

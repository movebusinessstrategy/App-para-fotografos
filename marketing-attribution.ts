import type { SupabaseClient } from '@supabase/supabase-js';

type MetaReferral = {
  source_url?: unknown;
  source_type?: unknown;
  source_id?: unknown;
  headline?: unknown;
  body?: unknown;
  media_type?: unknown;
  ctwa_clid?: unknown;
  welcome_message?: unknown;
};

export type MetaWhatsAppTouchpoint = {
  userId: string;
  phone: string;
  waNumber?: string;
  messageId?: string;
  messageTimestamp?: string | number;
  referral?: MetaReferral | null;
};

let warnedMissingMigration = false;

function cleanText(value: unknown, maxLength = 500): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.trim();
  return cleaned ? cleaned.slice(0, maxLength) : null;
}

function validHttpUrl(value: unknown): string | null {
  const text = cleanText(value, 2000);
  if (!text) return null;
  try {
    const parsed = new URL(text);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function parseSeenAt(value: unknown): string {
  const raw = typeof value === 'number' ? String(value) : cleanText(value, 50);
  if (!raw) return new Date().toISOString();
  const numeric = Number(raw);
  const date = Number.isFinite(numeric) ? new Date(numeric * 1000) : new Date(raw);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function referralMetadata(referral: MetaReferral): Record<string, string> {
  const entries = {
    source_type: cleanText(referral.source_type, 100),
    headline: cleanText(referral.headline, 300),
    body: cleanText(referral.body, 500),
    media_type: cleanText(referral.media_type, 100),
    welcome_message: cleanText(referral.welcome_message, 500),
  };
  return Object.fromEntries(Object.entries(entries).filter(([, value]) => value));
}

export function metaWhatsAppTouchpointRow(input: MetaWhatsAppTouchpoint): Record<string, unknown> | null {
  const referral = input.referral;
  if (!referral || typeof referral !== 'object') return null;
  const ctwaClid = cleanText(referral.ctwa_clid, 500);
  const sourceId = cleanText(referral.source_id, 300);
  const sourceUrl = validHttpUrl(referral.source_url);
  if (!ctwaClid && !sourceId && !sourceUrl) return null;

  const seenAt = parseSeenAt(input.messageTimestamp);
  return {
    user_id: input.userId,
    channel: 'whatsapp',
    source: 'meta_click_to_whatsapp',
    external_event_id: cleanText(input.messageId, 500),
    phone: cleanText(input.phone, 50),
    wa_number: cleanText(input.waNumber, 50),
    source_url: sourceUrl,
    ctwa_clid: ctwaClid,
    ad_id: sourceId,
    metadata: referralMetadata(referral),
    first_seen_at: seenAt,
    last_seen_at: seenAt,
  };
}

function isMissingMigration(error: any): boolean {
  const message = String(error?.message || '');
  return error?.code === '42P01' || message.includes('marketing_touchpoints');
}

export async function captureMetaWhatsAppTouchpoint(
  supabase: SupabaseClient,
  input: MetaWhatsAppTouchpoint,
): Promise<boolean> {
  const row = metaWhatsAppTouchpointRow(input);
  if (!row) return false;

  const { error } = await supabase
    .from('marketing_touchpoints')
    .upsert(row, { onConflict: 'user_id,channel,external_event_id', ignoreDuplicates: true });
  if (!error) return true;
  if (isMissingMigration(error)) {
    if (!warnedMissingMigration) {
      warnedMissingMigration = true;
      console.warn('[marketing] migration 066 ainda não aplicada; origem do anúncio não foi persistida');
    }
    return false;
  }
  console.warn('[marketing] falha ao persistir origem Meta:', error.message);
  return false;
}

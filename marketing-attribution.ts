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

function cleanText(value: unknown, maxLength = 500): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.trim();
  return cleaned ? cleaned.slice(0, maxLength) : null;
}

function validHttpOrigin(value: unknown): string | null {
  const text = cleanText(value, 2000);
  if (!text) return null;
  try {
    const parsed = new URL(text);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

function parseSeenAt(value: unknown): string | null {
  const now = Date.now();
  const raw = typeof value === 'number' ? String(value) : cleanText(value, 50);
  if (!raw) return new Date(now).toISOString();
  const numeric = Number(raw);
  const date = Number.isFinite(numeric) ? new Date(numeric * 1000) : new Date(raw);
  const timestamp = date.getTime();
  const oldest = now - 7 * 24 * 60 * 60 * 1_000;
  const newest = now + 5 * 60 * 1_000;
  if (!Number.isFinite(timestamp) || timestamp < oldest || timestamp > newest) return null;
  return date.toISOString();
}

function referralMetadata(referral: MetaReferral): Record<string, string> {
  const entries = {
    source_type: cleanText(referral.source_type, 100),
    media_type: cleanText(referral.media_type, 100),
  };
  return Object.fromEntries(Object.entries(entries).filter(([, value]) => value));
}

export function metaWhatsAppTouchpointRow(input: MetaWhatsAppTouchpoint): Record<string, unknown> | null {
  const referral = input.referral;
  if (!referral || typeof referral !== 'object') return null;
  const ctwaClid = cleanText(referral.ctwa_clid, 500);
  const sourceId = cleanText(referral.source_id, 300);
  const sourceUrl = validHttpOrigin(referral.source_url);
  if (!ctwaClid && !sourceId && !sourceUrl) return null;

  const seenAt = parseSeenAt(input.messageTimestamp);
  if (!seenAt) return null;
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

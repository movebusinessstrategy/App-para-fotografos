const ENCODER = new TextEncoder();

export const PUBLIC_BRIDGE_PATH = '/v1/whatsapp-click';
export const CRM_INTAKE_PATH = '/api/public/marketing/site-intake';
export const MAX_BROWSER_BODY_BYTES = 16 * 1024;

const WHATSAPP_CLICK_FIELDS = [
  'event_name',
  'event_id',
  'occurred_at',
  'consent_status',
  'analytics_storage',
  'ad_storage',
  'ad_user_data',
  'ad_personalization',
  'source_url',
  'page_path',
  'cta_id',
  'cta_location',
  'gclid',
  'gbraid',
  'wbraid',
  'fbclid',
  'fbc',
  'fbp',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
  'ad_id',
  'adset_id',
  'campaign_id',
  'ga_client_id',
  'ga_session_id',
  'journey_id',
] as const;

const CONSENT_UPDATE_FIELDS = [
  'event_name',
  'event_id',
  'occurred_at',
  'bridge_reference',
  'analytics_storage',
  'ad_storage',
  'ad_user_data',
  'ad_personalization',
] as const;

const TRANSPORT_ONLY_FIELDS = ['turnstile_token'] as const;
const WHATSAPP_CLICK_FIELD_SET = new Set<string>([...WHATSAPP_CLICK_FIELDS, ...TRANSPORT_ONLY_FIELDS]);
const CONSENT_UPDATE_FIELD_SET = new Set<string>([...CONSENT_UPDATE_FIELDS, ...TRANSPORT_ONLY_FIELDS]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BRIDGE_REFERENCE_PATTERN = /^gp_[a-z0-9_-]{12}$/;
const SITE_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const MIN_SIGNING_SECRET_BYTES = 32;
const MAX_TURNSTILE_TOKEN_LENGTH = 2_048;

type JsonRecord = Record<string, unknown>;

export class MarketingBridgeError extends Error {
  constructor(
    public readonly code: string,
    public readonly statusCode: number,
  ) {
    super(code);
    this.name = 'MarketingBridgeError';
  }
}

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

function requireJsonRecord(value: unknown): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new MarketingBridgeError('INVALID_BODY', 400);
  }
  return value as JsonRecord;
}

function eventFieldSet(body: JsonRecord): ReadonlySet<string> {
  if (['WhatsAppClick', 'PageView', 'SiteClick'].includes(String(body.event_name))) {
    return WHATSAPP_CLICK_FIELD_SET;
  }
  if (body.event_name === 'ConsentUpdate') return CONSENT_UPDATE_FIELD_SET;
  throw new MarketingBridgeError('INVALID_EVENT', 400);
}

function assertAllowedFields(body: JsonRecord, allowedFields: ReadonlySet<string>): void {
  const keys = Object.keys(body);
  if (keys.length > allowedFields.size) {
    throw new MarketingBridgeError('INVALID_FIELD', 400);
  }
  const unknown = keys.find(key => !allowedFields.has(key));
  if (unknown) throw new MarketingBridgeError('INVALID_FIELD', 400);
}

function assertFlatValues(body: JsonRecord): void {
  const invalid = Object.values(body).some(value => (
    value !== null
    && value !== undefined
    && !['string', 'number', 'boolean'].includes(typeof value)
  ));
  if (invalid) throw new MarketingBridgeError('INVALID_FIELD', 400);
}

export function normalizeSiteOrigin(value: string): string {
  let origin: URL;
  try {
    origin = new URL(value);
  } catch {
    throw new MarketingBridgeError('INVALID_CONFIGURATION', 503);
  }
  if (origin.protocol !== 'https:' || origin.pathname !== '/' || origin.search || origin.hash) {
    throw new MarketingBridgeError('INVALID_CONFIGURATION', 503);
  }
  return origin.origin;
}

export function validateCrmIntakeUrl(value: string): URL {
  let target: URL;
  try {
    target = new URL(value);
  } catch {
    throw new MarketingBridgeError('INVALID_CONFIGURATION', 503);
  }
  if (target.protocol !== 'https:' || target.pathname !== CRM_INTAKE_PATH || target.search || target.hash) {
    throw new MarketingBridgeError('INVALID_CONFIGURATION', 503);
  }
  return target;
}

export function assertSigningConfiguration(siteKeyId: string, secret: string): void {
  const cleanSiteKey = siteKeyId.trim();
  const secretBytes = ENCODER.encode(secret).byteLength;
  if (!SITE_KEY_PATTERN.test(cleanSiteKey) || secretBytes < MIN_SIGNING_SECRET_BYTES) {
    throw new MarketingBridgeError('INVALID_CONFIGURATION', 503);
  }
}

export function sanitizeBrowserPayload(raw: unknown, userAgent: string | null): JsonRecord {
  const body = requireJsonRecord(raw);
  const allowedFields = eventFieldSet(body);
  assertAllowedFields(body, allowedFields);
  assertFlatValues(body);

  const sanitized: JsonRecord = {};
  const forwardedFields = body.event_name === 'ConsentUpdate'
    ? CONSENT_UPDATE_FIELDS
    : WHATSAPP_CLICK_FIELDS;
  for (const field of forwardedFields) {
    if (Object.hasOwn(body, field)) sanitized[field] = body[field];
  }
  if (body.event_name !== 'ConsentUpdate' && userAgent) {
    sanitized.client_user_agent = userAgent.trim().slice(0, 500);
  }
  return sanitized;
}

export type BrowserEventName = 'WhatsAppClick' | 'PageView' | 'SiteClick' | 'ConsentUpdate';

export function browserEventName(raw: unknown): BrowserEventName {
  const body = requireJsonRecord(raw);
  const eventName = String(body.event_name || '');
  if (['WhatsAppClick', 'PageView', 'SiteClick', 'ConsentUpdate'].includes(eventName)) {
    return eventName as BrowserEventName;
  }
  throw new MarketingBridgeError('INVALID_EVENT', 400);
}

export function requireTurnstileToken(raw: unknown): string {
  const body = requireJsonRecord(raw);
  const token = typeof body.turnstile_token === 'string'
    ? body.turnstile_token.trim()
    : '';
  if (!token || token.length > MAX_TURNSTILE_TOKEN_LENGTH) {
    throw new MarketingBridgeError('BOT_VERIFICATION_REQUIRED', 403);
  }
  return token;
}

export async function sha256Hex(value: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', ENCODER.encode(value)));
}

export async function hmacSha256Hex(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    ENCODER.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return toHex(await crypto.subtle.sign('HMAC', key, ENCODER.encode(value)));
}

export async function buildSignedCrmRequest(input: {
  body: JsonRecord;
  origin: string;
  siteKeyId: string;
  secret: string;
  nowMs?: number;
  nonce?: string;
}): Promise<{ rawBody: string; headers: Headers }> {
  assertSigningConfiguration(input.siteKeyId, input.secret);
  const rawBody = JSON.stringify(input.body);
  const timestamp = String(Math.floor((input.nowMs ?? Date.now()) / 1_000));
  const nonce = input.nonce || crypto.randomUUID().replaceAll('-', '');
  const bodyHash = await sha256Hex(rawBody);
  const canonical = [
    timestamp,
    nonce,
    'POST',
    CRM_INTAKE_PATH,
    input.siteKeyId.trim(),
    normalizeSiteOrigin(input.origin),
    bodyHash,
  ].join('\n');
  const signature = await hmacSha256Hex(input.secret, canonical);
  const headers = new Headers({
    'content-type': 'application/json',
    'x-marketing-origin': input.origin,
    'x-marketing-site-key': input.siteKeyId,
    'x-marketing-timestamp': timestamp,
    'x-marketing-nonce': nonce,
    'x-marketing-signature': signature,
  });
  return { rawBody, headers };
}

export async function privacySafeRateKey(secret: string, request: Request): Promise<string> {
  const address = request.headers.get('cf-connecting-ip') || 'unknown-client';
  return hmacSha256Hex(secret, `rate-limit\n${address}`);
}

export type PublicBridgeSuccess =
  | { status: 'registered'; event_id: string; bridge_ref: string }
  | { status: 'registered'; event_id: string };

export function publicSuccessPayload(
  value: unknown,
  eventName: BrowserEventName = 'WhatsAppClick',
): PublicBridgeSuccess {
  const body = requireJsonRecord(value);
  const eventId = String(body.event_id || '');
  if (!UUID_PATTERN.test(eventId)) {
    throw new MarketingBridgeError('INVALID_UPSTREAM_RESPONSE', 502);
  }
  if (eventName !== 'WhatsAppClick') return { status: 'registered', event_id: eventId };
  const bridgeRef = String(body.bridge_ref || '');
  if (!BRIDGE_REFERENCE_PATTERN.test(bridgeRef)) {
    throw new MarketingBridgeError('INVALID_UPSTREAM_RESPONSE', 502);
  }
  return { status: 'registered', event_id: eventId, bridge_ref: bridgeRef };
}

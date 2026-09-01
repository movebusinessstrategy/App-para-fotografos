import crypto from 'node:crypto';

export const MARKETING_SITE_MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
export const MARKETING_SITE_MAX_BODY_BYTES = 16 * 1024;
export const MARKETING_SITE_BRIDGE_BYTES = 9;

const MIN_HMAC_SECRET_BYTES = 32;
const MAX_JSON_NODES = 200;
const MAX_SOURCE_URL_LENGTH = 2_000;
const MAX_PATH_LENGTH = 512;
const MAX_CLICK_ID_LENGTH = 500;
const MAX_UTM_LENGTH = 300;
const MAX_CTA_LENGTH = 120;
const MIN_EVENT_TIME_MS = Date.UTC(2020, 0, 1);
const MAX_SITE_KEY_LENGTH = 200;
const MAX_ORIGIN_LENGTH = 500;

const CLICK_ID_FIELDS = ['gclid', 'gbraid', 'wbraid', 'fbclid', 'fbc', 'fbp'] as const;
const UTM_FIELDS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const;
const AD_ID_FIELDS = ['ad_id', 'adset_id', 'campaign_id'] as const;
const CONSENT_FIELDS = [
  'analytics_storage',
  'ad_storage',
  'ad_user_data',
  'ad_personalization',
] as const;
const SITE_EVENT_NAMES = ['WhatsAppClick', 'PageView', 'SiteClick'] as const;

const WHATSAPP_CLICK_ALLOWED_FIELDS = new Set([
  'event_name',
  'event_id',
  'occurred_at',
  'consent_status',
  ...CONSENT_FIELDS,
  'source_url',
  'page_path',
  'cta_id',
  'cta_location',
  ...CLICK_ID_FIELDS,
  ...UTM_FIELDS,
  ...AD_ID_FIELDS,
  'ga_client_id',
  'ga_session_id',
  'journey_id',
  'client_user_agent',
]);

const CONSENT_UPDATE_ALLOWED_FIELDS = new Set([
  'event_name',
  'event_id',
  'occurred_at',
  'bridge_reference',
  ...CONSENT_FIELDS,
]);

const PII_FIELD_NAMES = new Set([
  'user_id',
  'userid',
  'lead_id',
  'leadid',
  'name',
  'first_name',
  'firstname',
  'last_name',
  'lastname',
  'full_name',
  'fullname',
  'email',
  'phone',
  'telephone',
  'mobile',
  'whatsapp',
  'whatsapp_number',
  'cpf',
  'cnpj',
  'address',
  'birth_date',
  'birthday',
  'message',
  'customer',
  'client',
]);

const SENSITIVE_FIELD_NAMES = new Set([
  'campaign_name',
  'adset_name',
  'ad_name',
  'content_name',
  'service_name',
  'service_type',
  'pregnancy_status',
  'health_status',
  'diagnosis',
]);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NONCE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
const SIGNATURE_PATTERN = /^[0-9a-f]{64}$/i;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9._:+/=-]+$/;
const SITE_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const BRIDGE_REFERENCE_PATTERN = /^gp_[A-Za-z0-9_-]{12}$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
const EMAIL_VALUE_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;

type UnknownRecord = Record<string, unknown>;
type ClickIdField = typeof CLICK_ID_FIELDS[number];
type UtmField = typeof UTM_FIELDS[number];
type AdIdField = typeof AD_ID_FIELDS[number];
type ConsentField = typeof CONSENT_FIELDS[number];
export type MarketingSiteEventName = typeof SITE_EVENT_NAMES[number];

export type MarketingConsentStatus = 'unknown' | 'granted' | 'denied';

export type MarketingSiteEventInput = {
  event_name: MarketingSiteEventName;
  event_id?: string;
  occurred_at?: string | number;
  consent_status?: MarketingConsentStatus;
  analytics_storage?: MarketingConsentStatus;
  ad_storage?: MarketingConsentStatus;
  ad_user_data?: MarketingConsentStatus;
  ad_personalization?: MarketingConsentStatus;
  source_url?: string;
  page_path?: string;
  cta_id?: string;
  cta_location?: string;
  gclid?: string;
  gbraid?: string;
  wbraid?: string;
  fbclid?: string;
  fbc?: string;
  fbp?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
  ad_id?: string;
  adset_id?: string;
  campaign_id?: string;
  ga_client_id?: string;
  ga_session_id?: string;
  journey_id?: string;
  client_user_agent?: string;
};

export type MarketingSiteSigningInput = {
  rawBody: string | Buffer;
  timestamp: string | number;
  nonce: string;
  method: string;
  path: string;
  siteKeyId: string;
  origin: string;
};

export type MarketingSiteVerificationInput = MarketingSiteSigningInput & {
  signature: string;
  secret: string | Buffer;
  now?: Date | number;
};

export type VerifiedMarketingSiteRequest = {
  signed_at: string;
  nonce_hash: string;
  method: string;
  path: string;
  site_key_id: string;
  origin: string;
  body_sha256: string;
};

export type NormalizedMarketingSiteEvent = {
  event_name: MarketingSiteEventName;
  event_id: string;
  lead_id: string;
  occurred_at: string;
  consent_status: MarketingConsentStatus;
  consent_snapshot: Record<ConsentField, MarketingConsentStatus>;
  source_url: string | null;
  page_path: string | null;
  cta_id: string | null;
  cta_location: string | null;
  gclid: string | null;
  gbraid: string | null;
  wbraid: string | null;
  fbclid: string | null;
  fbc: string | null;
  fbp: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  ad_id: string | null;
  adset_id: string | null;
  campaign_id: string | null;
  ga_client_id: string | null;
  ga_session_id: string | null;
  client_user_agent: string | null;
};

export type MarketingSiteTouchpointRow = {
  user_id: string;
  channel: 'website';
  source: 'studio_site';
  external_event_id: string;
  source_url: string | null;
  gclid: string | null;
  gbraid: string | null;
  wbraid: string | null;
  fbclid: string | null;
  fbc: string | null;
  fbp: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  ad_id: string | null;
  adset_id: string | null;
  campaign_external_id: string | null;
  lead_id: string;
  bridge_payload_hash: string;
  bridge_reference_hash: string | null;
  ga_client_id: string | null;
  ga_session_id: string | null;
  client_user_agent: string | null;
  consent_status: MarketingConsentStatus;
  consent_snapshot: Record<ConsentField | 'captured_at' | 'source', string>;
  metadata: {
    event_name: MarketingSiteEventName;
    page_path: string | null;
    cta_id: string | null;
    cta_location: string | null;
  };
  first_seen_at: string;
  last_seen_at: string;
};

export type PreparedMarketingSiteIntake = {
  verified_request: VerifiedMarketingSiteRequest;
  event: NormalizedMarketingSiteEvent;
  touchpoint: MarketingSiteTouchpointRow;
  response: {
    accepted: true;
    event_name: MarketingSiteEventName;
    event_id: string;
    lead_id: string;
    bridge_ref?: string;
  };
};

export type PrepareMarketingSiteIntakeInput = MarketingSiteVerificationInput & {
  userId: string;
  bridgeReferenceSecret: string | Buffer;
  uuidFactory?: () => string;
  randomBytesFactory?: (size: number) => Buffer;
};

export type NormalizedMarketingSiteConsentUpdate = {
  event_name: 'ConsentUpdate';
  event_id: string;
  occurred_at: string;
  bridge_reference_hash: string;
  consent_snapshot: Record<ConsentField, MarketingConsentStatus>;
};

export type PreparedMarketingSiteConsentUpdate = {
  verified_request: VerifiedMarketingSiteRequest;
  event: NormalizedMarketingSiteConsentUpdate;
  response: {
    accepted: true;
    event_name: 'ConsentUpdate';
    event_id: string;
  };
};

export type PrepareMarketingSiteRequestInput = MarketingSiteVerificationInput & {
  userId: string;
  bridgeReferenceSecret?: string | Buffer;
  uuidFactory?: () => string;
  randomBytesFactory?: (size: number) => Buffer;
};

export type PreparedMarketingSiteRequest =
  | PreparedMarketingSiteIntake
  | PreparedMarketingSiteConsentUpdate;

export type MarketingSiteIntakeErrorCode =
  | 'BODY_TOO_LARGE'
  | 'INVALID_BODY'
  | 'INVALID_CONFIGURATION'
  | 'INVALID_EVENT'
  | 'INVALID_FIELD'
  | 'INVALID_SIGNATURE'
  | 'INVALID_TIMESTAMP'
  | 'PII_NOT_ALLOWED'
  | 'SENSITIVE_FIELD_NOT_ALLOWED';

export class MarketingSiteIntakeError extends Error {
  readonly code: MarketingSiteIntakeErrorCode;
  readonly statusCode: number;

  constructor(code: MarketingSiteIntakeErrorCode, statusCode: number, message: string) {
    super(message);
    this.name = 'MarketingSiteIntakeError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function intakeError(
  code: MarketingSiteIntakeErrorCode,
  statusCode: number,
  message: string,
): never {
  throw new MarketingSiteIntakeError(code, statusCode, message);
}

function asRawBodyBuffer(rawBody: string | Buffer): Buffer {
  const buffer = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, 'utf8');
  if (buffer.byteLength > MARKETING_SITE_MAX_BODY_BYTES) {
    intakeError('BODY_TOO_LARGE', 413, 'Corpo da requisição acima do limite permitido');
  }
  return buffer;
}

function asSecretBuffer(secret: string | Buffer): Buffer {
  const buffer = Buffer.isBuffer(secret) ? secret : Buffer.from(secret, 'utf8');
  if (buffer.byteLength < MIN_HMAC_SECRET_BYTES) {
    intakeError('INVALID_CONFIGURATION', 500, 'Segredo HMAC ausente ou inválido');
  }
  return buffer;
}

function normalizeMethod(method: string): string {
  const normalized = typeof method === 'string' ? method.trim().toUpperCase() : '';
  if (!/^[A-Z]{3,10}$/.test(normalized)) {
    intakeError('INVALID_SIGNATURE', 401, 'Método assinado inválido');
  }
  return normalized;
}

function normalizeRequestPath(path: string): string {
  const value = typeof path === 'string' ? path.split(/[?#]/, 1)[0] : '';
  const valid = value.startsWith('/') && value.length <= MAX_PATH_LENGTH;
  if (!valid || CONTROL_CHARACTER_PATTERN.test(value)) {
    intakeError('INVALID_SIGNATURE', 401, 'Caminho assinado inválido');
  }
  return value;
}

function normalizeSigningSiteKeyId(siteKeyId: string): string {
  const normalized = typeof siteKeyId === 'string' ? siteKeyId.trim() : '';
  if (normalized.length > MAX_SITE_KEY_LENGTH || !SITE_KEY_PATTERN.test(normalized)) {
    intakeError('INVALID_SIGNATURE', 401, 'Site key assinado inválido');
  }
  return normalized;
}

function normalizeSigningOrigin(origin: string): string {
  const normalized = typeof origin === 'string' ? origin.trim() : '';
  if (!normalized || normalized.length > MAX_ORIGIN_LENGTH) {
    intakeError('INVALID_SIGNATURE', 401, 'Origin assinada inválida');
  }
  try {
    const parsed = new URL(normalized);
    const isOriginOnly = normalized === parsed.origin;
    const validProtocol = parsed.protocol === 'http:' || parsed.protocol === 'https:';
    if (!isOriginOnly || !validProtocol || parsed.username || parsed.password) throw new Error();
    return parsed.origin;
  } catch {
    return intakeError('INVALID_SIGNATURE', 401, 'Origin assinada inválida');
  }
}

function normalizeSignedTimestamp(timestamp: string | number): { canonical: string; milliseconds: number } {
  const canonical = String(timestamp).trim();
  if (!/^[1-9]\d{9}(?:\d{3})?$/.test(canonical)) {
    intakeError('INVALID_TIMESTAMP', 401, 'Timestamp da assinatura inválido');
  }
  const numeric = Number(canonical);
  const milliseconds = canonical.length === 13 ? numeric : numeric * 1_000;
  if (!Number.isSafeInteger(milliseconds)) {
    intakeError('INVALID_TIMESTAMP', 401, 'Timestamp da assinatura inválido');
  }
  return { canonical, milliseconds };
}

function normalizeNonce(nonce: string): string {
  const normalized = typeof nonce === 'string' ? nonce.trim() : '';
  if (!NONCE_PATTERN.test(normalized)) {
    intakeError('INVALID_SIGNATURE', 401, 'Nonce da assinatura inválido');
  }
  return normalized;
}

function timestampNow(now: Date | number | undefined): number {
  if (now instanceof Date) return now.getTime();
  if (typeof now === 'number') return now;
  return Date.now();
}

function assertTimestampIsFresh(timestampMs: number, nowMs: number): void {
  const validNow = Number.isFinite(nowMs) && nowMs >= MIN_EVENT_TIME_MS;
  if (!validNow || Math.abs(nowMs - timestampMs) > MARKETING_SITE_MAX_CLOCK_SKEW_MS) {
    intakeError('INVALID_TIMESTAMP', 401, 'Assinatura expirada ou fora da janela permitida');
  }
}

function sha256Hex(value: string | Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function canonicalSigningParts(input: MarketingSiteSigningInput) {
  const rawBody = asRawBodyBuffer(input.rawBody);
  const timestamp = normalizeSignedTimestamp(input.timestamp);
  const nonce = normalizeNonce(input.nonce);
  const method = normalizeMethod(input.method);
  const path = normalizeRequestPath(input.path);
  const siteKeyId = normalizeSigningSiteKeyId(input.siteKeyId);
  const origin = normalizeSigningOrigin(input.origin);
  const bodyHash = sha256Hex(rawBody);
  return { rawBody, timestamp, nonce, method, path, siteKeyId, origin, bodyHash };
}

export function buildMarketingSiteSignaturePayload(input: MarketingSiteSigningInput): string {
  const parts = canonicalSigningParts(input);
  return [
    parts.timestamp.canonical,
    parts.nonce,
    parts.method,
    parts.path,
    parts.siteKeyId,
    parts.origin,
    parts.bodyHash,
  ].join('\n');
}

export function signMarketingSiteRequest(
  secret: string | Buffer,
  input: MarketingSiteSigningInput,
): string {
  const key = asSecretBuffer(secret);
  const canonical = buildMarketingSiteSignaturePayload(input);
  const digest = crypto.createHmac('sha256', key).update(canonical).digest('hex');
  return `sha256=${digest}`;
}

function signatureDigest(signature: string): { digest: Buffer; valid: boolean } {
  const normalized = typeof signature === 'string'
    ? signature.trim().replace(/^sha256=/i, '')
    : '';
  const valid = SIGNATURE_PATTERN.test(normalized);
  return {
    digest: valid ? Buffer.from(normalized, 'hex') : Buffer.alloc(32),
    valid,
  };
}

export function verifyMarketingSiteRequest(
  input: MarketingSiteVerificationInput,
): VerifiedMarketingSiteRequest {
  const parts = canonicalSigningParts(input);
  assertTimestampIsFresh(parts.timestamp.milliseconds, timestampNow(input.now));
  const canonical = buildMarketingSiteSignaturePayload(input);
  const expected = crypto.createHmac('sha256', asSecretBuffer(input.secret)).update(canonical).digest();
  const provided = signatureDigest(input.signature);
  const matches = crypto.timingSafeEqual(expected, provided.digest);
  if (!provided.valid || !matches) {
    intakeError('INVALID_SIGNATURE', 401, 'Assinatura da requisição inválida');
  }
  return {
    signed_at: new Date(parts.timestamp.milliseconds).toISOString(),
    nonce_hash: sha256Hex(parts.nonce),
    method: parts.method,
    path: parts.path,
    site_key_id: parts.siteKeyId,
    origin: parts.origin,
    body_sha256: parts.bodyHash,
  };
}

function asPayloadObject(value: unknown): UnknownRecord {
  const isObject = value !== null && typeof value === 'object' && !Array.isArray(value);
  if (!isObject) intakeError('INVALID_BODY', 400, 'O corpo deve ser um objeto JSON');
  return value as UnknownRecord;
}

function parsePayload(rawBody: string | Buffer): UnknownRecord {
  const buffer = asRawBodyBuffer(rawBody);
  try {
    return asPayloadObject(JSON.parse(buffer.toString('utf8')));
  } catch (error) {
    if (error instanceof MarketingSiteIntakeError) throw error;
    return intakeError('INVALID_BODY', 400, 'JSON inválido');
  }
}

function normalizedFieldName(field: string): string {
  return field.trim().toLowerCase().replace(/[-\s]+/g, '_');
}

function forbiddenFieldCode(field: string): MarketingSiteIntakeErrorCode | null {
  const normalized = normalizedFieldName(field);
  if (PII_FIELD_NAMES.has(normalized)) return 'PII_NOT_ALLOWED';
  return SENSITIVE_FIELD_NAMES.has(normalized) ? 'SENSITIVE_FIELD_NOT_ALLOWED' : null;
}

function assertNoForbiddenFields(payload: UnknownRecord): void {
  const pending: unknown[] = [payload];
  let inspected = 0;
  while (pending.length) {
    const current = pending.pop();
    inspected += 1;
    if (inspected > MAX_JSON_NODES) {
      intakeError('INVALID_BODY', 400, 'Estrutura JSON acima do limite permitido');
    }
    if (Array.isArray(current)) {
      pending.push(...current);
      continue;
    }
    if (!current || typeof current !== 'object') continue;
    for (const [field, value] of Object.entries(current as UnknownRecord)) {
      const code = forbiddenFieldCode(field);
      if (code) intakeError(code, 422, 'O corpo contém um campo não permitido');
      pending.push(value);
    }
  }
}

function assertOnlyAllowedFields(payload: UnknownRecord, allowedFields: ReadonlySet<string>): void {
  const unknownField = Object.keys(payload).find(field => !allowedFields.has(field));
  if (unknownField) intakeError('INVALID_FIELD', 422, 'O corpo contém um campo desconhecido');
}

function cleanOptionalText(value: unknown, maxLength: number): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') intakeError('INVALID_FIELD', 422, 'Campo com tipo inválido');
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength || CONTROL_CHARACTER_PATTERN.test(normalized)) {
    intakeError('INVALID_FIELD', 422, 'Campo de texto inválido');
  }
  if (EMAIL_VALUE_PATTERN.test(normalized)) {
    intakeError('PII_NOT_ALLOWED', 422, 'O corpo contém dado pessoal não permitido');
  }
  return normalized;
}

function cleanOptionalIdentifier(value: unknown, maxLength: number): string | null {
  const normalized = cleanOptionalText(value, maxLength);
  if (normalized && !IDENTIFIER_PATTERN.test(normalized)) {
    intakeError('INVALID_FIELD', 422, 'Identificador com formato inválido');
  }
  return normalized;
}

function normalizeUuid(value: unknown, label: string): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value.trim())) {
    intakeError('INVALID_FIELD', 422, `${label} deve ser UUID`);
  }
  return value.trim().toLowerCase();
}

function generatedUuid(factory: () => string, label: string): string {
  const generated = factory();
  if (!UUID_PATTERN.test(generated)) {
    intakeError('INVALID_CONFIGURATION', 500, `Gerador de ${label} retornou valor inválido`);
  }
  return generated.toLowerCase();
}

function normalizeConsent(value: unknown): MarketingConsentStatus {
  if (value === undefined || value === null || value === '') return 'unknown';
  if (value === 'unknown' || value === 'granted' || value === 'denied') return value;
  return intakeError('INVALID_FIELD', 422, 'Consentimento inválido');
}

function normalizedConsentSnapshot(payload: UnknownRecord): Record<ConsentField, MarketingConsentStatus> {
  const fallback = normalizeConsent(payload.consent_status);
  return Object.fromEntries(
    CONSENT_FIELDS.map(field => [
      field,
      payload[field] === undefined
        ? (fallback === 'denied' ? 'denied' : 'unknown')
        : normalizeConsent(payload[field]),
    ]),
  ) as Record<ConsentField, MarketingConsentStatus>;
}

function timestampFromValue(value: string | number): number {
  if (typeof value === 'number') return value > 100_000_000_000 ? value : value * 1_000;
  if (/^\d{10}(?:\d{3})?$/.test(value)) {
    return value.length === 13 ? Number(value) : Number(value) * 1_000;
  }
  return new Date(value).getTime();
}

function normalizeOccurredAt(value: unknown, fallbackIso: string, nowMs: number): string {
  if (value === undefined || value === null || value === '') return fallbackIso;
  if (typeof value !== 'string' && typeof value !== 'number') {
    intakeError('INVALID_FIELD', 422, 'Data do evento inválida');
  }
  const milliseconds = timestampFromValue(value as string | number);
  const withinRange = milliseconds >= MIN_EVENT_TIME_MS
    && milliseconds <= nowMs + MARKETING_SITE_MAX_CLOCK_SKEW_MS;
  if (!Number.isFinite(milliseconds) || !withinRange) {
    intakeError('INVALID_FIELD', 422, 'Data do evento inválida');
  }
  return new Date(milliseconds).toISOString();
}

function normalizeSourceUrl(value: unknown): string | null {
  const text = cleanOptionalText(value, MAX_SOURCE_URL_LENGTH);
  if (!text) return null;
  try {
    const parsed = new URL(text);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
      intakeError('INVALID_FIELD', 422, 'URL de origem inválida');
    }
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch (error) {
    if (error instanceof MarketingSiteIntakeError) throw error;
    return intakeError('INVALID_FIELD', 422, 'URL de origem inválida');
  }
}

function normalizePagePath(value: unknown): string | null {
  const text = cleanOptionalText(value, MAX_PATH_LENGTH);
  if (!text) return null;
  const path = text.split(/[?#]/, 1)[0];
  if (!path.startsWith('/')) intakeError('INVALID_FIELD', 422, 'Caminho da página inválido');
  return path;
}

function normalizeEventName(value: unknown): MarketingSiteEventName {
  if (SITE_EVENT_NAMES.includes(value as MarketingSiteEventName)) {
    return value as MarketingSiteEventName;
  }
  return intakeError('INVALID_EVENT', 422, 'Evento do site não permitido');
}

function normalizedFieldMap<T extends string>(
  payload: UnknownRecord,
  fields: readonly T[],
  normalizer: (value: unknown) => string | null,
): Record<T, string | null> {
  return Object.fromEntries(fields.map(field => [field, normalizer(payload[field])])) as Record<T, string | null>;
}

function normalizedClickIds(
  payload: UnknownRecord,
  consent: Record<ConsentField, MarketingConsentStatus>,
): Record<ClickIdField, string | null> {
  if (consent.ad_storage !== 'granted' || consent.ad_user_data !== 'granted') {
    return Object.fromEntries(CLICK_ID_FIELDS.map(field => [field, null])) as Record<ClickIdField, null>;
  }
  return normalizedFieldMap(payload, CLICK_ID_FIELDS, value => cleanOptionalIdentifier(value, MAX_CLICK_ID_LENGTH));
}

function normalizedGaIdentifiers(
  payload: UnknownRecord,
  consent: Record<ConsentField, MarketingConsentStatus>,
): { ga_client_id: string | null; ga_session_id: string | null } {
  if (consent.analytics_storage !== 'granted') {
    return { ga_client_id: null, ga_session_id: null };
  }
  return {
    ga_client_id: cleanOptionalIdentifier(payload.ga_client_id, 200),
    ga_session_id: cleanOptionalIdentifier(payload.ga_session_id, 200),
  };
}

function normalizedClientUserAgent(
  payload: UnknownRecord,
  consent: Record<ConsentField, MarketingConsentStatus>,
): string | null {
  if (consent.ad_user_data !== 'granted') return null;
  return cleanOptionalText(payload.client_user_agent, 500);
}

function normalizedUtms(payload: UnknownRecord): Record<UtmField, string | null> {
  return normalizedFieldMap(payload, UTM_FIELDS, value => cleanOptionalText(value, MAX_UTM_LENGTH));
}

function normalizedAdIds(payload: UnknownRecord): Record<AdIdField, string | null> {
  return normalizedFieldMap(payload, AD_ID_FIELDS, value => cleanOptionalIdentifier(value, MAX_CLICK_ID_LENGTH));
}

function normalizeMarketingSiteEvent(
  payload: UnknownRecord,
  signedAt: string,
  nowMs: number,
  uuidFactory: () => string,
): NormalizedMarketingSiteEvent {
  assertNoForbiddenFields(payload);
  assertOnlyAllowedFields(payload, WHATSAPP_CLICK_ALLOWED_FIELDS);
  const consent = normalizedConsentSnapshot(payload);
  const eventName = normalizeEventName(payload.event_name);
  if (eventName !== 'WhatsAppClick' && consent.analytics_storage !== 'granted') {
    intakeError('INVALID_FIELD', 422, 'Evento de navegação exige consentimento analítico');
  }
  const eventId = payload.event_id
    ? normalizeUuid(payload.event_id, 'event_id')
    : generatedUuid(uuidFactory, 'event_id');
  return {
    event_name: eventName,
    event_id: eventId,
    lead_id: payload.journey_id
      ? normalizeUuid(payload.journey_id, 'journey_id')
      : generatedUuid(uuidFactory, 'lead_id'),
    occurred_at: normalizeOccurredAt(payload.occurred_at, signedAt, nowMs),
    consent_status: consent.ad_user_data,
    consent_snapshot: consent,
    source_url: normalizeSourceUrl(payload.source_url),
    page_path: normalizePagePath(payload.page_path),
    cta_id: cleanOptionalText(payload.cta_id, MAX_CTA_LENGTH),
    cta_location: cleanOptionalText(payload.cta_location, MAX_CTA_LENGTH),
    ...normalizedClickIds(payload, consent),
    ...normalizedGaIdentifiers(payload, consent),
    client_user_agent: normalizedClientUserAgent(payload, consent),
    ...normalizedUtms(payload),
    ...normalizedAdIds(payload),
  };
}

function requiredConsentSnapshot(payload: UnknownRecord): Record<ConsentField, MarketingConsentStatus> {
  return Object.fromEntries(CONSENT_FIELDS.map(field => {
    if (!Object.hasOwn(payload, field)) {
      intakeError('INVALID_FIELD', 422, 'ConsentUpdate exige os quatro sinais granulares');
    }
    return [field, normalizeConsent(payload[field])];
  })) as Record<ConsentField, MarketingConsentStatus>;
}

function normalizeConsentUpdate(
  payload: UnknownRecord,
  signedAt: string,
  nowMs: number,
): NormalizedMarketingSiteConsentUpdate {
  assertNoForbiddenFields(payload);
  assertOnlyAllowedFields(payload, CONSENT_UPDATE_ALLOWED_FIELDS);
  if (payload.event_name !== 'ConsentUpdate') {
    intakeError('INVALID_EVENT', 422, 'Evento de consentimento inválido');
  }
  if (payload.event_id === undefined || payload.occurred_at === undefined) {
    intakeError('INVALID_FIELD', 422, 'ConsentUpdate exige event_id e occurred_at');
  }
  const bridgeReference = cleanOptionalText(payload.bridge_reference, 100);
  if (!bridgeReference) {
    intakeError('INVALID_FIELD', 422, 'ConsentUpdate exige bridge_reference');
  }
  return {
    event_name: 'ConsentUpdate',
    event_id: normalizeUuid(payload.event_id, 'event_id'),
    occurred_at: normalizeOccurredAt(payload.occurred_at, signedAt, nowMs),
    bridge_reference_hash: hashMarketingBridgeReference(bridgeReference),
    consent_snapshot: requiredConsentSnapshot(payload),
  };
}

export function createMarketingBridgeReference(
  randomBytesFactory: (size: number) => Buffer = crypto.randomBytes,
): { bridge_ref: string; bridge_ref_hash: string } {
  const random = randomBytesFactory(MARKETING_SITE_BRIDGE_BYTES);
  if (!Buffer.isBuffer(random) || random.byteLength !== MARKETING_SITE_BRIDGE_BYTES) {
    intakeError('INVALID_CONFIGURATION', 500, 'Gerador de bridge_ref retornou valor inválido');
  }
  const bridgeRef = `gp_${random.toString('base64url').toLowerCase()}`;
  return { bridge_ref: bridgeRef, bridge_ref_hash: sha256Hex(bridgeRef) };
}

export function deriveMarketingBridgeReference(
  secret: string | Buffer,
  eventId: string,
): { bridge_ref: string; bridge_ref_hash: string } {
  const digest = crypto.createHmac('sha256', asSecretBuffer(secret))
    .update(`marketing-bridge\n${eventId}`)
    .digest('base64url')
    .slice(0, 12)
    .toLowerCase();
  const bridgeRef = `gp_${digest}`;
  return { bridge_ref: bridgeRef, bridge_ref_hash: sha256Hex(bridgeRef) };
}

export function hashMarketingBridgeReference(bridgeRef: string): string {
  if (!BRIDGE_REFERENCE_PATTERN.test(bridgeRef)) {
    intakeError('INVALID_FIELD', 422, 'bridge_ref inválido');
  }
  return sha256Hex(bridgeRef.toLowerCase());
}

function marketingSiteTouchpointRow(
  userId: string,
  event: NormalizedMarketingSiteEvent,
  bodyHash: string,
  bridgeRefHash: string | null,
): MarketingSiteTouchpointRow {
  return {
    user_id: userId,
    channel: 'website',
    source: 'studio_site',
    external_event_id: event.event_id,
    source_url: event.source_url,
    gclid: event.gclid,
    gbraid: event.gbraid,
    wbraid: event.wbraid,
    fbclid: event.fbclid,
    fbc: event.fbc,
    fbp: event.fbp,
    utm_source: event.utm_source,
    utm_medium: event.utm_medium,
    utm_campaign: event.utm_campaign,
    utm_content: event.utm_content,
    utm_term: event.utm_term,
    ad_id: event.ad_id,
    adset_id: event.adset_id,
    campaign_external_id: event.campaign_id,
    lead_id: event.lead_id,
    bridge_payload_hash: bodyHash,
    bridge_reference_hash: bridgeRefHash,
    ga_client_id: event.ga_client_id,
    ga_session_id: event.ga_session_id,
    client_user_agent: event.client_user_agent,
    consent_status: event.consent_status,
    consent_snapshot: {
      ...event.consent_snapshot,
      captured_at: event.occurred_at,
      source: 'consent_mode_v2',
    },
    metadata: {
      event_name: event.event_name,
      page_path: event.page_path,
      cta_id: event.cta_id,
      cta_location: event.cta_location,
    },
    first_seen_at: event.occurred_at,
    last_seen_at: event.occurred_at,
  };
}

function prepareVerifiedMarketingSiteRequest(
  input: PrepareMarketingSiteRequestInput,
): PreparedMarketingSiteRequest {
  const verified = verifyMarketingSiteRequest(input);
  if (verified.method !== 'POST') {
    intakeError('INVALID_SIGNATURE', 401, 'Método não permitido para o intake');
  }
  const userId = normalizeUuid(input.userId, 'userId');
  const uuidFactory = input.uuidFactory || crypto.randomUUID;
  const nowMs = timestampNow(input.now);
  const payload = parsePayload(input.rawBody);
  if (payload.event_name === 'ConsentUpdate') {
    const event = normalizeConsentUpdate(payload, verified.signed_at, nowMs);
    return {
      verified_request: verified,
      event,
      response: {
        accepted: true,
        event_name: event.event_name,
        event_id: event.event_id,
      },
    };
  }
  const event = normalizeMarketingSiteEvent(payload, verified.signed_at, nowMs, uuidFactory);
  const needsBridgeReference = event.event_name === 'WhatsAppClick';
  if (needsBridgeReference && !input.bridgeReferenceSecret) {
    intakeError('INVALID_CONFIGURATION', 500, 'Segredo estável de bridge_ref ausente');
  }
  const bridge = needsBridgeReference
    ? deriveMarketingBridgeReference(input.bridgeReferenceSecret!, event.event_id)
    : null;
  return {
    verified_request: verified,
    event,
    touchpoint: marketingSiteTouchpointRow(
      userId,
      event,
      verified.body_sha256,
      bridge?.bridge_ref_hash || null,
    ),
    response: {
      accepted: true,
      event_name: event.event_name,
      event_id: event.event_id,
      lead_id: event.lead_id,
      ...(bridge ? { bridge_ref: bridge.bridge_ref } : {}),
    },
  };
}

export function prepareMarketingSiteRequest(
  input: PrepareMarketingSiteRequestInput,
): PreparedMarketingSiteRequest {
  return prepareVerifiedMarketingSiteRequest(input);
}

export function prepareMarketingSiteIntake(
  input: PrepareMarketingSiteIntakeInput,
): PreparedMarketingSiteIntake {
  const prepared = prepareVerifiedMarketingSiteRequest(input);
  if (prepared.event.event_name !== 'WhatsAppClick') {
    intakeError('INVALID_EVENT', 422, 'Somente o evento WhatsAppClick é aceito');
  }
  return prepared as PreparedMarketingSiteIntake;
}

export function prepareMarketingSiteConsentUpdate(
  input: PrepareMarketingSiteRequestInput,
): PreparedMarketingSiteConsentUpdate {
  const prepared = prepareVerifiedMarketingSiteRequest(input);
  if (prepared.event.event_name !== 'ConsentUpdate') {
    intakeError('INVALID_EVENT', 422, 'Somente o evento ConsentUpdate é aceito');
  }
  return prepared as PreparedMarketingSiteConsentUpdate;
}

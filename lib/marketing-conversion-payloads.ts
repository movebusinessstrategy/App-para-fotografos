export type MarketingProvider = 'meta' | 'google' | 'ga4';
export type MarketingConversionEventName = 'Contact' | 'Lead' | 'Schedule' | 'Purchase';
type MarketingSourceContext = 'message' | 'other';

type JsonObject = Record<string, unknown>;

export type MarketingConversionOutboxRow = {
  id: number | string;
  user_id: string;
  deal_id: number | null;
  lead_id: string;
  provider: MarketingProvider;
  event_name: MarketingConversionEventName;
  event_id: string;
  occurred_at: string;
  value: number;
  currency: string;
  status: string;
  attempts: number;
  integration_id: number | string;
  marketing_site_id: string;
  destination_id: string;
  account_id: string | null;
  conversion_action_id: string | null;
  provider_event_name: string | null;
  event_source_url: string | null;
  consent_snapshot: JsonObject;
  user_data: JsonObject;
  attribution_data: JsonObject;
  event_data: JsonObject;
  payload_hash: string | null;
  claim_token: string;
  response?: JsonObject | null;
};

export type MarketingIntegrationRow = {
  id: number | string;
  user_id: string;
  provider: MarketingProvider;
  enabled: boolean;
  marketing_site_id: string;
  account_id: string | null;
  destination_id: string;
  conversion_action_id: string | null;
  credentials_encrypted: string | null;
  event_mappings: JsonObject;
  provider_config: JsonObject;
};

export type MarketingProviderCredentials = {
  access_token?: string;
  api_secret?: string;
  refresh_token?: string;
  client_id?: string;
  client_secret?: string;
};

export type MarketingPayloadBuildOptions = {
  validateOnly?: boolean;
};

export type MarketingHttpRequest = {
  provider: MarketingProvider;
  url: string;
  method: 'POST';
  headers: Record<string, string>;
  body: JsonObject;
  validateOnly: boolean;
};

export type MarketingPayloadErrorCode =
  | 'CONSENT_REQUIRED'
  | 'DESTINATION_MISMATCH'
  | 'IDENTIFIER_REQUIRED'
  | 'INTEGRATION_DISABLED'
  | 'INVALID_CONFIGURATION'
  | 'INVALID_EVENT'
  | 'INVALID_SNAPSHOT';

export class MarketingPayloadError extends Error {
  readonly code: MarketingPayloadErrorCode;

  constructor(code: MarketingPayloadErrorCode, message: string) {
    super(message);
    this.name = 'MarketingPayloadError';
    this.code = code;
  }
}

const EVENT_NAMES = new Set<MarketingConversionEventName>([
  'Contact',
  'Lead',
  'Schedule',
  'Purchase',
]);
const META_MESSAGING_EVENT_NAMES = new Set([
  'LeadSubmitted',
  'Purchase',
]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/i;
const WABA_ID_PATTERN = /^\d{5,32}$/;
const META_API_VERSION_PATTERN = /^v\d{1,2}\.\d$/;
const GA4_MEASUREMENT_ID_PATTERN = /^G-[A-Z0-9]+$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const SENSITIVE_TEXT_PATTERN = /gestant|gravid|pregnan|matern|sa[uú]de|diagn[oó]st/i;
const EVENT_SOURCE_CONTEXT: Record<MarketingConversionEventName, MarketingSourceContext> = {
  Contact: 'message',
  Lead: 'other',
  Schedule: 'other',
  Purchase: 'other',
};
const GA4_MAX_EVENT_AGE_MS = 72 * 60 * 60 * 1_000;
const GA4_MAX_FUTURE_SKEW_MS = 5 * 60 * 1_000;
const GA4_SESSION_WINDOW_MS = 30 * 60 * 1_000;

function payloadError(code: MarketingPayloadErrorCode, message: string): never {
  throw new MarketingPayloadError(code, message);
}

function asObject(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : {};
}

function optionalString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized || null;
}

function requiredString(value: unknown, field: string): string {
  const normalized = optionalString(value);
  if (!normalized) payloadError('INVALID_CONFIGURATION', `${field} ausente`);
  return normalized;
}

function eventTimestamp(row: MarketingConversionOutboxRow): Date {
  const date = new Date(row.occurred_at);
  if (!Number.isFinite(date.getTime())) payloadError('INVALID_SNAPSHOT', 'occurred_at inválido');
  return date;
}

function canonicalEvent(row: MarketingConversionOutboxRow): MarketingConversionEventName {
  if (!EVENT_NAMES.has(row.event_name)) payloadError('INVALID_EVENT', 'Evento de conversão não permitido');
  if (SENSITIVE_TEXT_PATTERN.test(row.event_name)) payloadError('INVALID_EVENT', 'Evento sensível não permitido');
  return row.event_name;
}

function frozenSourceContext(
  row: MarketingConversionOutboxRow,
  event: MarketingConversionEventName = canonicalEvent(row),
): MarketingSourceContext {
  const context = optionalString(asObject(row.event_data).source_context);
  if (context !== 'message' && context !== 'other') {
    payloadError('INVALID_SNAPSHOT', 'source_context ausente ou inválido');
  }
  if (context !== EVENT_SOURCE_CONTEXT[event]) {
    payloadError('INVALID_SNAPSHOT', 'source_context incompatível com o evento');
  }
  return context;
}

type NormalizedConsent = 'granted' | 'denied' | 'unspecified';

function normalizedConsent(value: unknown): NormalizedConsent {
  const normalized = optionalString(value)?.toLowerCase();
  if (normalized === 'granted' || normalized === 'consent_granted') return 'granted';
  if (normalized === 'denied' || normalized === 'consent_denied') return 'denied';
  return 'unspecified';
}

function consentValue(row: MarketingConversionOutboxRow, field: string): NormalizedConsent {
  const snapshot = asObject(row.consent_snapshot);
  if (Object.prototype.hasOwnProperty.call(snapshot, field)) {
    return normalizedConsent(snapshot[field]);
  }
  return normalizedConsent(snapshot.status);
}

function assertGrantedConsent(row: MarketingConversionOutboxRow): void {
  const consentField = row.provider === 'ga4' ? 'analytics_storage' : 'ad_user_data';
  if (consentValue(row, consentField) !== 'granted') {
    payloadError('CONSENT_REQUIRED', 'Conversão sem consentimento concedido');
  }
  if (row.provider === 'meta' && consentValue(row, 'ad_personalization') !== 'granted') {
    payloadError('CONSENT_REQUIRED', 'Meta sem consentimento de personalização concedido');
  }
}

function ga4Consent(row: MarketingConversionOutboxRow): JsonObject {
  const result: JsonObject = {};
  const adUserData = consentValue(row, 'ad_user_data');
  const adPersonalization = consentValue(row, 'ad_personalization');
  if (adUserData !== 'unspecified') result.ad_user_data = adUserData.toUpperCase();
  if (adPersonalization !== 'unspecified') {
    result.ad_personalization = adPersonalization.toUpperCase();
  }
  return result;
}

function dataManagerConsent(row: MarketingConversionOutboxRow): JsonObject {
  const values: Record<NormalizedConsent, string> = {
    granted: 'CONSENT_GRANTED',
    denied: 'CONSENT_DENIED',
    unspecified: 'CONSENT_STATUS_UNSPECIFIED',
  };
  return {
    adUserData: values[consentValue(row, 'ad_user_data')],
    adPersonalization: values[consentValue(row, 'ad_personalization')],
  };
}

function assertIntegrationMatch(
  row: MarketingConversionOutboxRow,
  integration: MarketingIntegrationRow,
): void {
  if (!integration.enabled) payloadError('INTEGRATION_DISABLED', 'Integração desabilitada');
  const sameTenant = integration.user_id === row.user_id;
  const sameProvider = integration.provider === row.provider;
  const sameIntegration = String(integration.id) === String(row.integration_id);
  const sameSite = integration.marketing_site_id === row.marketing_site_id;
  const sameDestination = integration.destination_id.trim() === row.destination_id.trim();
  if (!sameTenant || !sameProvider || !sameIntegration || !sameSite || !sameDestination) {
    payloadError('DESTINATION_MISMATCH', 'Tenant, provedor ou destino não conferem');
  }
}

function assertBaseSnapshot(
  row: MarketingConversionOutboxRow,
  integration: MarketingIntegrationRow,
): MarketingConversionEventName {
  assertGrantedConsent(row);
  assertIntegrationMatch(row, integration);
  if (!optionalString(row.event_id)) payloadError('INVALID_SNAPSHOT', 'event_id ausente');
  if (!UUID_PATTERN.test(row.claim_token)) payloadError('INVALID_SNAPSHOT', 'claim_token inválido');
  if (row.payload_hash && !SHA256_PATTERN.test(row.payload_hash)) {
    payloadError('INVALID_SNAPSHOT', 'payload_hash inválido');
  }
  const event = canonicalEvent(row);
  frozenSourceContext(row, event);
  return event;
}

function purchaseData(row: MarketingConversionOutboxRow): JsonObject | null {
  if (row.event_name !== 'Purchase') return null;
  const currency = optionalString(row.currency);
  const value = Number(row.value);
  if (!currency || !CURRENCY_PATTERN.test(currency) || !Number.isFinite(value) || value < 0) {
    payloadError('INVALID_SNAPSHOT', 'Valor ou moeda de Purchase inválidos');
  }
  return { currency, value };
}

function validSha256(value: unknown): string | null {
  const normalized = optionalString(value);
  return normalized && SHA256_PATTERN.test(normalized) ? normalized.toLowerCase() : null;
}

function metaChatUserData(row: MarketingConversionOutboxRow): JsonObject {
  const attribution = asObject(row.attribution_data);
  const frozenUser = asObject(row.user_data);
  const result: JsonObject = {};
  const fbc = optionalString(attribution.fbc);
  const fbp = optionalString(attribution.fbp);
  const emailHash = validSha256(frozenUser.em);
  const phoneHash = validSha256(frozenUser.ph);
  if (fbc) result.fbc = fbc;
  if (fbp) result.fbp = fbp;
  if (emailHash) result.em = [emailHash];
  if (phoneHash) result.ph = [phoneHash];
  if (!Object.keys(result).length) {
    payloadError('IDENTIFIER_REQUIRED', 'Evento Meta chat sem identificador real');
  }
  return result;
}

function metaBusinessEventName(row: MarketingConversionOutboxRow): string {
  const configured = requiredString(
    row.provider_event_name,
    'Meta business_messaging event mapping',
  );
  if (!META_MESSAGING_EVENT_NAMES.has(configured)) {
    payloadError(
      'INVALID_CONFIGURATION',
      'Evento business_messaging genérico ou mapeado não permitido',
    );
  }
  return configured;
}

function configuredWabaId(row: MarketingConversionOutboxRow, integration: MarketingIntegrationRow): string {
  const config = asObject(integration.provider_config);
  const configured = requiredString(config.whatsapp_business_account_id, 'whatsapp_business_account_id');
  const captured = optionalString(row.attribution_data?.whatsapp_business_account_id);
  if (!WABA_ID_PATTERN.test(configured)) payloadError('INVALID_CONFIGURATION', 'WABA inválida');
  if (captured && captured !== configured) {
    payloadError('DESTINATION_MISMATCH', 'WABA capturada não confere com a integração');
  }
  return configured;
}

function metaEventBase(row: MarketingConversionOutboxRow, eventName: string): JsonObject {
  return {
    event_name: eventName,
    event_time: Math.floor(eventTimestamp(row).getTime() / 1_000),
    event_id: row.event_id,
  };
}

export function buildMetaChatPayload(row: MarketingConversionOutboxRow): JsonObject {
  const event = canonicalEvent(row);
  const data: JsonObject = {
    ...metaEventBase(row, event),
    action_source: frozenSourceContext(row, event) === 'message' ? 'chat' : 'other',
    user_data: metaChatUserData(row),
  };
  const customData = purchaseData(row);
  if (customData) data.custom_data = customData;
  return { data: [data] };
}

export function buildMetaBusinessMessagingPayload(
  row: MarketingConversionOutboxRow,
  integration: MarketingIntegrationRow,
): JsonObject {
  frozenSourceContext(row, canonicalEvent(row));
  const ctwaClid = requiredString(row.attribution_data?.ctwa_clid, 'ctwa_clid');
  const wabaId = configuredWabaId(row, integration);
  const data: JsonObject = {
    ...metaEventBase(row, metaBusinessEventName(row)),
    action_source: 'business_messaging',
    messaging_channel: 'whatsapp',
    user_data: {
      whatsapp_business_account_id: wabaId,
      ctwa_clid: ctwaClid,
    },
  };
  const customData = purchaseData(row);
  if (customData) data.custom_data = customData;
  return { data: [data] };
}

function withMetaTestCode(payload: JsonObject, integration: MarketingIntegrationRow): JsonObject {
  const testCode = optionalString(integration.provider_config?.test_event_code);
  return testCode ? { ...payload, test_event_code: testCode } : payload;
}

function assertMetaValidationMode(
  integration: MarketingIntegrationRow,
  options: MarketingPayloadBuildOptions,
): void {
  if (!options.validateOnly) return;
  if (!optionalString(integration.provider_config?.test_event_code)) {
    payloadError('INVALID_CONFIGURATION', 'Meta test_event_code é obrigatório no modo de validação');
  }
}

export function buildMetaConversionsRequest(
  row: MarketingConversionOutboxRow,
  integration: MarketingIntegrationRow,
  credentials: MarketingProviderCredentials,
  options: MarketingPayloadBuildOptions = {},
): MarketingHttpRequest {
  assertBaseSnapshot(row, integration);
  assertMetaValidationMode(integration, options);
  const accessToken = requiredString(credentials.access_token, 'Meta access_token');
  const apiVersion = requiredString(integration.provider_config?.api_version, 'Meta api_version');
  if (!META_API_VERSION_PATTERN.test(apiVersion)) {
    payloadError('INVALID_CONFIGURATION', 'Meta api_version inválida');
  }
  const datasetId = requiredString(integration.destination_id, 'Meta destination_id');
  const hasCtwa = Boolean(optionalString(row.attribution_data?.ctwa_clid));
  const payload = hasCtwa
    ? buildMetaBusinessMessagingPayload(row, integration)
    : buildMetaChatPayload(row);
  return {
    provider: 'meta',
    url: `https://graph.facebook.com/${apiVersion}/${encodeURIComponent(datasetId)}/events`,
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: withMetaTestCode(payload, integration),
    validateOnly: Boolean(options.validateOnly),
  };
}

const GA4_EVENT_NAMES: Record<MarketingConversionEventName, string> = {
  Contact: 'contact',
  Lead: 'generate_lead',
  Schedule: 'schedule',
  Purchase: 'purchase',
};

function ga4ClientId(row: MarketingConversionOutboxRow): string {
  const attribution = asObject(row.attribution_data);
  const frozenUser = asObject(row.user_data);
  return requiredString(
    attribution.ga_client_id || frozenUser.ga_client_id || frozenUser.client_id,
    'GA4 client_id',
  );
}

function ga4EventParams(row: MarketingConversionOutboxRow): JsonObject {
  const eventTime = eventTimestamp(row).getTime();
  const params: JsonObject = { event_id: row.event_id, engagement_time_msec: 1 };
  const sessionId = optionalString(row.attribution_data?.ga_session_id);
  if (sessionId && /^\d+$/.test(sessionId)) {
    const sessionStart = Number(sessionId) * 1_000;
    const sessionAge = eventTime - sessionStart;
    if (Number.isFinite(sessionStart) && sessionAge >= 0 && sessionAge <= GA4_SESSION_WINDOW_MS) {
      params.session_id = Number(sessionId);
    }
  }
  const purchase = purchaseData(row);
  if (purchase) {
    Object.assign(params, purchase, {
      transaction_id: row.event_id,
      items: [{
        item_id: 'studio_session',
        item_name: 'Studio session',
        quantity: 1,
        price: purchase.value,
      }],
    });
  }
  return params;
}

export function buildGa4MeasurementRequest(
  row: MarketingConversionOutboxRow,
  integration: MarketingIntegrationRow,
  credentials: MarketingProviderCredentials,
  options: MarketingPayloadBuildOptions = {},
): MarketingHttpRequest {
  const event = assertBaseSnapshot(row, integration);
  const eventAge = Date.now() - eventTimestamp(row).getTime();
  if (eventAge > GA4_MAX_EVENT_AGE_MS || eventAge < -GA4_MAX_FUTURE_SKEW_MS) {
    payloadError('INVALID_SNAPSHOT', 'Evento GA4 fora da janela temporal permitida');
  }
  const measurementId = requiredString(integration.destination_id, 'GA4 destination_id');
  if (!GA4_MEASUREMENT_ID_PATTERN.test(measurementId)) {
    payloadError('INVALID_CONFIGURATION', 'GA4 measurement_id inválido');
  }
  const apiSecret = requiredString(credentials.api_secret, 'GA4 api_secret');
  const path = options.validateOnly ? 'debug/mp/collect' : 'mp/collect';
  const query = new URLSearchParams({ measurement_id: measurementId, api_secret: apiSecret });
  const body: JsonObject = {
    client_id: ga4ClientId(row),
    timestamp_micros: Math.trunc(eventTimestamp(row).getTime() * 1_000),
    events: [{ name: GA4_EVENT_NAMES[event], params: ga4EventParams(row) }],
  };
  const consent = ga4Consent(row);
  if (Object.keys(consent).length) body.consent = consent;
  if (options.validateOnly) body.validation_behavior = 'ENFORCE_RECOMMENDATIONS';
  return {
    provider: 'ga4',
    url: `https://www.google-analytics.com/${path}?${query.toString()}`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    validateOnly: Boolean(options.validateOnly),
  };
}

function googleAdIdentifiers(row: MarketingConversionOutboxRow): JsonObject {
  const attribution = asObject(row.attribution_data);
  const identifiers: JsonObject = {};
  for (const key of ['gclid', 'gbraid', 'wbraid'] as const) {
    const value = optionalString(attribution[key]);
    if (value) identifiers[key] = value;
  }
  if (!Object.keys(identifiers).length) {
    payloadError('IDENTIFIER_REQUIRED', 'Google sem gclid, gbraid ou wbraid real');
  }
  return identifiers;
}

function googleDestination(
  row: MarketingConversionOutboxRow,
  integration: MarketingIntegrationRow,
): JsonObject {
  const accountId = requiredString(row.account_id, 'Google account_id');
  if (integration.account_id?.trim() !== accountId) {
    payloadError('DESTINATION_MISMATCH', 'Conta Google congelada não confere com a integração');
  }
  const conversionActionId = requiredString(row.conversion_action_id, 'Google conversion_action_id');
  const destination: JsonObject = {
    reference: 'conversion_destination',
    operatingAccount: { accountId, accountType: 'GOOGLE_ADS' },
    productDestinationId: conversionActionId,
  };
  const loginAccountId = optionalString(integration.provider_config?.login_account_id);
  if (loginAccountId) {
    destination.loginAccount = { accountId: loginAccountId, accountType: 'GOOGLE_ADS' };
  }
  return destination;
}

function googleEvent(row: MarketingConversionOutboxRow): JsonObject {
  const event: JsonObject = {
    destinationReferences: ['conversion_destination'],
    transactionId: row.event_id,
    eventTimestamp: eventTimestamp(row).toISOString(),
    adIdentifiers: googleAdIdentifiers(row),
    eventSource: frozenSourceContext(row) === 'message' ? 'MESSAGE' : 'OTHER',
    conversionCount: 1,
  };
  const purchase = purchaseData(row);
  if (purchase) {
    event.currency = purchase.currency;
    event.conversionValue = purchase.value;
  }
  return event;
}

export function buildGoogleDataManagerRequest(
  row: MarketingConversionOutboxRow,
  integration: MarketingIntegrationRow,
  credentials: MarketingProviderCredentials,
  options: MarketingPayloadBuildOptions = {},
): MarketingHttpRequest {
  assertBaseSnapshot(row, integration);
  const accessToken = requiredString(credentials.access_token, 'Google access_token');
  const body: JsonObject = {
    destinations: [googleDestination(row, integration)],
    events: [googleEvent(row)],
    consent: dataManagerConsent(row),
    validateOnly: Boolean(options.validateOnly),
  };
  return {
    provider: 'google',
    url: 'https://datamanager.googleapis.com/v1/events:ingest',
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body,
    validateOnly: Boolean(options.validateOnly),
  };
}

export function buildMarketingProviderRequest(
  row: MarketingConversionOutboxRow,
  integration: MarketingIntegrationRow,
  credentials: MarketingProviderCredentials,
  options: MarketingPayloadBuildOptions = {},
): MarketingHttpRequest {
  if (row.provider === 'meta') {
    return buildMetaConversionsRequest(row, integration, credentials, options);
  }
  if (row.provider === 'ga4') {
    return buildGa4MeasurementRequest(row, integration, credentials, options);
  }
  if (row.provider === 'google') {
    return buildGoogleDataManagerRequest(row, integration, credentials, options);
  }
  return payloadError('INVALID_CONFIGURATION', 'Provedor não suportado');
}

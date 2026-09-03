import type { SupabaseClient } from '@supabase/supabase-js';
import {
  buildMarketingProviderRequest,
  MarketingPayloadError,
  type MarketingConversionOutboxRow,
  type MarketingHttpRequest,
  type MarketingIntegrationRow,
  type MarketingProvider,
  type MarketingProviderCredentials,
} from './marketing-conversion-payloads.js';

type JsonObject = Record<string, unknown>;

export type MarketingOutboxTransitionStatus =
  | 'sent'
  | 'retry'
  | 'validation_only'
  | 'accepted_unverified'
  | 'blocked_config'
  | 'cancelled_consent'
  | 'dead';

export type MarketingOutboxTransition = {
  status: MarketingOutboxTransitionStatus;
  last_error: string | null;
  response: JsonObject | null;
  sent_at: string | null;
  next_attempt_at?: string;
};

export type MarketingOutboxRepository = {
  claim: (limit: number, leaseSeconds: number) => Promise<MarketingConversionOutboxRow[]>;
  renewLease: (row: MarketingConversionOutboxRow, leaseSeconds: number) => Promise<boolean>;
  isConsentAllowed: (row: MarketingConversionOutboxRow) => Promise<boolean>;
  isDestinationOwned: (
    row: MarketingConversionOutboxRow,
    integration: MarketingIntegrationRow,
  ) => Promise<boolean>;
  findIntegration: (row: MarketingConversionOutboxRow) => Promise<MarketingIntegrationRow | null>;
  transition: (
    row: MarketingConversionOutboxRow,
    change: MarketingOutboxTransition,
  ) => Promise<boolean>;
};

export type MarketingCredentialDecryptor = (
  encrypted: string,
  integration: MarketingIntegrationRow,
) => Promise<string | JsonObject> | string | JsonObject;

export type MarketingFetch = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Pick<Response, 'ok' | 'status' | 'text'>>;

export type ProcessMarketingOutboxOptions = {
  repository: MarketingOutboxRepository;
  decryptCredentials: MarketingCredentialDecryptor;
  fetch: MarketingFetch;
  limit?: number;
  leaseSeconds?: number;
  maxAttempts?: number;
  requestTimeoutMs?: number;
  validateOnly?: boolean;
  now?: () => Date;
};

export type MarketingOutboxProcessResult = {
  claimed: number;
  sent: number;
  validationOnly: number;
  acceptedUnverified: number;
  retry: number;
  blocked: number;
  cancelled: number;
  dead: number;
  skipped: number;
};

type ProviderResponse = {
  status: number;
  json: JsonObject | null;
};

class MarketingHttpError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`PROVIDER_HTTP_${status}`);
    this.name = 'MarketingHttpError';
    this.status = status;
  }
}

class MarketingRequestTimeoutError extends Error {
  constructor() {
    super('PROVIDER_REQUEST_TIMEOUT');
    this.name = 'MarketingRequestTimeoutError';
  }
}

class MarketingDestinationOwnershipError extends Error {
  constructor() {
    super('DESTINATION_OWNERSHIP_MISMATCH');
    this.name = 'MarketingDestinationOwnershipError';
  }
}

const INTEGRATION_COLUMNS = [
  'id',
  'user_id',
  'provider',
  'enabled',
  'marketing_site_id',
  'account_id',
  'destination_id',
  'conversion_action_id',
  'credentials_encrypted',
  'event_mappings',
  'provider_config',
].join(',');
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ENCRYPTED_CREDENTIAL_PATTERN = /^enc:v1:[^:\s]+:[^:\s]+:[^:\s]+$/;

function normalizedTenantAllowlist(values: string[]): string[] {
  return [...new Set(values.map(value => value.trim().toLowerCase()))]
    .filter(value => UUID_PATTERN.test(value));
}

function boundedInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  const normalized = Number.isFinite(value) ? Math.trunc(value as number) : fallback;
  return Math.min(max, Math.max(min, normalized));
}

function sameIntegration(row: MarketingConversionOutboxRow, integration: MarketingIntegrationRow): boolean {
  return String(integration.id) === String(row.integration_id)
    && integration.user_id === row.user_id
    && integration.provider === row.provider
    && integration.marketing_site_id === row.marketing_site_id
    && integration.destination_id.trim() === row.destination_id.trim();
}

function asJsonObject(value: unknown): JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

function parseCredentials(value: string | JsonObject): MarketingProviderCredentials {
  const parsed = typeof value === 'string' ? parseCredentialJson(value) : asJsonObject(value);
  if (!parsed) throw new MarketingPayloadError('INVALID_CONFIGURATION', 'Credencial inválida');
  const credentials: MarketingProviderCredentials = {};
  if (typeof parsed.access_token === 'string') credentials.access_token = parsed.access_token;
  if (typeof parsed.api_secret === 'string') credentials.api_secret = parsed.api_secret;
  if (typeof parsed.refresh_token === 'string') credentials.refresh_token = parsed.refresh_token;
  if (typeof parsed.client_id === 'string') credentials.client_id = parsed.client_id;
  if (typeof parsed.client_secret === 'string') credentials.client_secret = parsed.client_secret;
  return credentials;
}

function parseCredentialJson(value: string): JsonObject | null {
  try {
    return asJsonObject(JSON.parse(value));
  } catch {
    return null;
  }
}

function processingRowGuards<T extends { eq: (field: string, value: unknown) => T }>(
  query: T,
  row: MarketingConversionOutboxRow,
): T {
  return query
    .eq('id', row.id)
    .eq('integration_id', row.integration_id)
    .eq('marketing_site_id', row.marketing_site_id)
    .eq('lead_id', consentLeadId(row))
    .eq('user_id', row.user_id)
    .eq('provider', row.provider)
    .eq('destination_id', row.destination_id)
    .eq('event_id', row.event_id)
    .eq('claim_token', row.claim_token)
    .eq('status', 'processing');
}

function transitionQuery(db: SupabaseClient, row: MarketingConversionOutboxRow, patch: JsonObject) {
  return processingRowGuards(
    db.from('marketing_conversion_outbox').update(patch),
    row,
  );
}

function consentLeadId(row: MarketingConversionOutboxRow): string | null {
  const leadId: unknown = row.lead_id;
  return typeof leadId === 'string' && UUID_PATTERN.test(leadId) ? leadId : null;
}

function hasValidConsentScope(row: MarketingConversionOutboxRow, leadId: string | null): boolean {
  return Boolean(
    leadId
    && UUID_PATTERN.test(row.user_id)
    && UUID_PATTERN.test(row.marketing_site_id),
  );
}

function destinationResourceKey(row: MarketingConversionOutboxRow): string | null {
  if (row.provider !== 'google') {
    return row.destination_id.trim().toLowerCase() || null;
  }
  const accountDigits = String(row.account_id || '').replace(/\D/g, '');
  const conversionActionId = String(row.conversion_action_id || '').trim().toLowerCase();
  return accountDigits && conversionActionId
    ? `${accountDigits}:${conversionActionId}`
    : null;
}

export function createSupabaseMarketingOutboxRepository(
  db: SupabaseClient,
  allowedUserIds: string[] = [],
): MarketingOutboxRepository {
  const tenantAllowlist = normalizedTenantAllowlist(allowedUserIds);
  return {
    async claim(limit, leaseSeconds) {
      if (!tenantAllowlist.length) return [];
      const result = await db.rpc('claim_marketing_conversion_outbox', {
        p_limit: boundedInteger(limit, 25, 1, 100),
        p_lease_seconds: boundedInteger(leaseSeconds, 300, 30, 1_800),
        p_user_ids: tenantAllowlist,
      });
      if (result.error) throw result.error;
      return (result.data || []) as MarketingConversionOutboxRow[];
    },

    async renewLease(row, _leaseSeconds) {
      const now = new Date().toISOString();
      const result = await processingRowGuards(
        db.from('marketing_conversion_outbox').update({ claimed_at: now, updated_at: now }),
        row,
      ).select('id');
      if (result.error) throw result.error;
      return result.data?.length === 1;
    },

    async isConsentAllowed(row) {
      const leadId = consentLeadId(row);
      if (!hasValidConsentScope(row, leadId)) return false;
      const result = await db.rpc('marketing_provider_consent_allowed', {
        p_user_id: row.user_id,
        p_marketing_site_id: row.marketing_site_id,
        p_lead_id: leadId,
        p_provider: row.provider,
      });
      if (result.error) throw result.error;
      return result.data === true;
    },

    async isDestinationOwned(row, integration) {
      const resourceKey = destinationResourceKey(row);
      if (!resourceKey) return false;
      const result = await db.from('marketing_destination_ownership')
        .select('id')
        .eq('user_id', row.user_id)
        .eq('marketing_site_id', row.marketing_site_id)
        .eq('integration_id', integration.id)
        .eq('provider', row.provider)
        .eq('resource_key', resourceKey)
        .lte('verified_at', new Date().toISOString())
        .limit(2);
      if (result.error) throw result.error;
      return result.data?.length === 1;
    },

    async findIntegration(row) {
      const result = await db.from('marketing_integrations')
        .select(INTEGRATION_COLUMNS)
        .eq('id', row.integration_id)
        .eq('user_id', row.user_id)
        .eq('provider', row.provider)
        .eq('marketing_site_id', row.marketing_site_id)
        .eq('destination_id', row.destination_id)
        .eq('enabled', true)
        .limit(2);
      if (result.error) throw result.error;
      if (!result.data?.length) return null;
      if (result.data.length !== 1) throw new Error('DUPLICATE_MARKETING_INTEGRATION');
      const integration = result.data[0] as unknown as MarketingIntegrationRow;
      return sameIntegration(row, integration) ? integration : null;
    },

    async transition(row, change) {
      const now = new Date().toISOString();
      const patch: JsonObject = {
        ...change,
        status: change.status,
        claim_token: null,
        claimed_at: null,
        updated_at: now,
      };
      const result = await transitionQuery(db, row, patch).select('id');
      if (result.error) throw result.error;
      return result.data?.length === 1;
    },
  };
}

function responseJson(text: string): JsonObject | null {
  if (!text.trim()) return null;
  try {
    return asJsonObject(JSON.parse(text));
  } catch {
    return null;
  }
}

function credentialString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizedRequestTimeout(value: number | undefined, leaseSeconds: number): number {
  const leaseThirdMs = Math.max(1, Math.floor((leaseSeconds * 1_000) / 3));
  const fallback = Math.min(15_000, leaseThirdMs);
  return boundedInteger(value, fallback, 1, leaseThirdMs);
}

function withRequestTimeout(fetcher: MarketingFetch, timeoutMs: number): MarketingFetch {
  return async (input, init) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetcher(input, { ...init, signal: controller.signal });
      const body = await response.text();
      return {
        ok: response.ok,
        status: response.status,
        async text() { return body; },
      };
    } catch (error) {
      if (controller.signal.aborted) throw new MarketingRequestTimeoutError();
      throw error;
    } finally {
      clearTimeout(timer);
    }
  };
}

async function refreshGoogleAccessToken(
  fetcher: MarketingFetch,
  credentials: MarketingProviderCredentials,
): Promise<MarketingProviderCredentials> {
  const refreshToken = credentialString(credentials.refresh_token);
  if (!refreshToken) {
    throw new MarketingPayloadError(
      'INVALID_CONFIGURATION',
      'Google refresh_token ausente',
    );
  }
  const clientId = credentialString(credentials.client_id);
  const clientSecret = credentialString(credentials.client_secret);
  if (!clientId || !clientSecret) {
    throw new MarketingPayloadError(
      'INVALID_CONFIGURATION',
      'Credencial Google renovável incompleta',
    );
  }
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });
  const response = await fetcher('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const json = responseJson(await response.text());
  if (!response.ok) throw new MarketingHttpError(response.status);
  const accessToken = credentialString(json?.access_token);
  if (!accessToken) {
    throw new MarketingPayloadError('INVALID_CONFIGURATION', 'Google não retornou access_token');
  }
  return { access_token: accessToken };
}

async function sendProviderRequest(fetcher: MarketingFetch, request: MarketingHttpRequest): Promise<ProviderResponse> {
  const response = await fetcher(request.url, {
    method: request.method,
    headers: request.headers,
    body: JSON.stringify(request.body),
  });
  const json = responseJson(await response.text());
  if (!response.ok) throw new MarketingHttpError(response.status);
  if (hasValidationErrors(request.provider, json)) throw new MarketingHttpError(400);
  return { status: response.status, json };
}

async function retrieveGoogleRequestStatus(
  fetcher: MarketingFetch,
  accessToken: string,
  requestId: string,
): Promise<ProviderResponse> {
  const query = new URLSearchParams({ requestId });
  const response = await fetcher(
    `https://datamanager.googleapis.com/v1/requestStatus:retrieve?${query.toString()}`,
    { method: 'GET', headers: { Authorization: `Bearer ${accessToken}` } },
  );
  const json = responseJson(await response.text());
  if (!response.ok) throw new MarketingHttpError(response.status);
  return { status: response.status, json };
}

function googleRequestId(value: JsonObject | null | undefined): string | null {
  const direct = credentialString(value?.request_id || value?.requestId);
  return direct && direct.length <= 500 ? direct : null;
}

function googleDestinationStatuses(response: ProviderResponse): string[] {
  const rows = Array.isArray(response.json?.requestStatusPerDestination)
    ? response.json.requestStatusPerDestination
    : [];
  return rows
    .map(item => asJsonObject(item)?.requestStatus)
    .filter((status): status is string => typeof status === 'string');
}

function googleRecordCount(value: unknown): number | null {
  const count = typeof value === 'string' && value.trim()
    ? Number(value)
    : value;
  return typeof count === 'number' && Number.isSafeInteger(count) && count >= 0
    ? count
    : null;
}

function googleIngestionRecordCounts(response: ProviderResponse): Array<number | null> {
  const rows = Array.isArray(response.json?.requestStatusPerDestination)
    ? response.json.requestStatusPerDestination
    : [];
  return rows.map(item => {
    const status = asJsonObject(asJsonObject(item)?.eventsIngestionStatus);
    return googleRecordCount(status?.recordCount);
  });
}

function googleErrorReasons(response: ProviderResponse): string[] {
  const rows = Array.isArray(response.json?.requestStatusPerDestination)
    ? response.json.requestStatusPerDestination
    : [];
  const reasons = new Set<string>();
  for (const item of rows) {
    const info = asJsonObject(asJsonObject(item)?.errorInfo);
    const counts = Array.isArray(info?.errorCounts) ? info.errorCounts : [];
    for (const count of counts) {
      const reason = asJsonObject(count)?.reason;
      if (typeof reason === 'string') reasons.add(reason);
    }
  }
  return [...reasons].slice(0, 20);
}

function googleStatusSummary(requestId: string, response: ProviderResponse): JsonObject {
  const statuses = googleDestinationStatuses(response);
  const recordCounts = googleIngestionRecordCounts(response);
  const reasons = googleErrorReasons(response);
  const summary: JsonObject = {
    provider: 'google',
    http_status: response.status,
    request_id: requestId,
    request_statuses: statuses,
  };
  if (recordCounts.some(count => count !== null)) summary.record_counts = recordCounts;
  if (reasons.length) summary.error_reasons = reasons;
  return summary;
}

function hasValidationErrors(provider: MarketingProvider, body: JsonObject | null): boolean {
  if (!body || provider !== 'ga4') return false;
  const messages = Array.isArray(body.validationMessages) ? body.validationMessages : [];
  return messages.some(message => {
    const record = asJsonObject(message);
    return record?.severity === 'ERROR';
  });
}

function providerResponseSummary(provider: MarketingProvider, response: ProviderResponse): JsonObject {
  const body = response.json || {};
  const summary: JsonObject = { provider, http_status: response.status };
  if (provider === 'meta') {
    if (typeof body.events_received === 'number') summary.events_received = body.events_received;
    if (typeof body.fbtrace_id === 'string') summary.trace_id = body.fbtrace_id;
  }
  if (provider === 'google') {
    if (typeof body.requestId === 'string') summary.request_id = body.requestId;
    if (Array.isArray(body.fieldWarnings)) summary.warning_count = body.fieldWarnings.length;
  }
  if (provider === 'ga4' && Array.isArray(body.validationMessages)) {
    summary.validation_message_count = body.validationMessages.length;
  }
  return summary;
}

function retryTimestamp(attempts: number, now: Date): string {
  const exponent = Math.min(Math.max(attempts - 1, 0), 8);
  const seconds = Math.min(3_600, 10 * (2 ** exponent));
  return new Date(now.getTime() + seconds * 1_000).toISOString();
}

function safeError(error: unknown): string {
  if (error instanceof MarketingPayloadError) return error.code;
  if (error instanceof MarketingHttpError) return `PROVIDER_HTTP_${error.status}`;
  if (error instanceof MarketingRequestTimeoutError) return error.message;
  if (error instanceof MarketingDestinationOwnershipError) return error.message;
  if (error instanceof TypeError) return 'PROVIDER_NETWORK_ERROR';
  return 'MARKETING_DISPATCH_ERROR';
}

function failedTransition(
  row: MarketingConversionOutboxRow,
  error: unknown,
  maxAttempts: number,
  now: Date,
): MarketingOutboxTransition {
  const lastError = safeError(error);
  const preservedResponse = googleRequestId(row.response) ? row.response || null : null;
  if (error instanceof MarketingDestinationOwnershipError) {
    return {
      status: 'blocked_config',
      last_error: lastError,
      response: preservedResponse,
      sent_at: null,
    };
  }
  if (error instanceof MarketingPayloadError) {
    const configError = [
      'DESTINATION_MISMATCH',
      'INTEGRATION_DISABLED',
      'INVALID_CONFIGURATION',
    ].includes(error.code);
    return {
      status: configError ? 'blocked_config' : 'dead',
      last_error: lastError,
      response: preservedResponse,
      sent_at: null,
    };
  }
  const retryable = !(error instanceof MarketingHttpError)
    || [408, 425, 429].includes(error.status)
    || error.status >= 500;
  if (!retryable) {
    return {
      status: 'blocked_config',
      last_error: lastError,
      response: preservedResponse,
      sent_at: null,
    };
  }
  if (row.attempts >= maxAttempts) {
    return { status: 'dead', last_error: lastError, response: preservedResponse, sent_at: null };
  }
  return {
    status: 'retry',
    last_error: lastError,
    response: preservedResponse,
    sent_at: null,
    next_attempt_at: retryTimestamp(row.attempts, now),
  };
}

function emptyResult(claimed: number): MarketingOutboxProcessResult {
  return {
    claimed,
    sent: 0,
    validationOnly: 0,
    acceptedUnverified: 0,
    retry: 0,
    blocked: 0,
    cancelled: 0,
    dead: 0,
    skipped: 0,
  };
}

function incrementResult(result: MarketingOutboxProcessResult, status: MarketingOutboxTransitionStatus): void {
  if (status === 'sent') result.sent += 1;
  if (status === 'validation_only') result.validationOnly += 1;
  if (status === 'accepted_unverified') result.acceptedUnverified += 1;
  if (status === 'retry') result.retry += 1;
  if (status === 'blocked_config') result.blocked += 1;
  if (status === 'cancelled_consent') result.cancelled += 1;
  if (status === 'dead') result.dead += 1;
}

async function requireIntegration(
  repository: MarketingOutboxRepository,
  row: MarketingConversionOutboxRow,
): Promise<MarketingIntegrationRow> {
  const integration = await repository.findIntegration(row);
  if (!integration || !sameIntegration(row, integration)) {
    throw new MarketingPayloadError('DESTINATION_MISMATCH', 'Integração exata não encontrada');
  }
  return integration;
}

type GoogleCredentialCache = Map<string, MarketingProviderCredentials>;

function googleCredentialCacheKey(integration: MarketingIntegrationRow): string {
  return [integration.user_id, integration.marketing_site_id, String(integration.id)].join(':');
}

async function decryptedCredentials(
  decrypt: MarketingCredentialDecryptor,
  integration: MarketingIntegrationRow,
  fetcher: MarketingFetch,
  googleCache: GoogleCredentialCache,
): Promise<MarketingProviderCredentials> {
  const encrypted = integration.credentials_encrypted;
  if (!encrypted || !ENCRYPTED_CREDENTIAL_PATTERN.test(encrypted)) {
    throw new MarketingPayloadError('INVALID_CONFIGURATION', 'Credencial criptografada inválida');
  }
  const cacheKey = googleCredentialCacheKey(integration);
  const cached = integration.provider === 'google' ? googleCache.get(cacheKey) : null;
  if (cached) return cached;
  const credentials = parseCredentials(await decrypt(encrypted, integration));
  if (integration.provider !== 'google') return credentials;
  const refreshed = await refreshGoogleAccessToken(fetcher, credentials);
  googleCache.set(cacheKey, refreshed);
  return refreshed;
}

function validationOnlyTransition(
  provider: MarketingProvider,
  response: ProviderResponse,
  now: Date,
): MarketingOutboxTransition {
  return {
    status: 'validation_only',
    last_error: 'VALIDATION_ONLY_OK_REQUEUED',
    response: {
      ...providerResponseSummary(provider, response),
      delivery_state: 'validation_only',
    },
    sent_at: null,
    next_attempt_at: new Date(now.getTime() + 24 * 60 * 60 * 1_000).toISOString(),
  };
}

function cancelledConsentTransition(): MarketingOutboxTransition {
  return {
    status: 'cancelled_consent',
    last_error: 'CONSENT_NOT_ALLOWED_AT_DELIVERY',
    response: null,
    sent_at: null,
  };
}

function acceptedUnverifiedTransition(
  provider: MarketingProvider,
  response: JsonObject,
  now: Date,
  retryAfterSeconds: number,
): MarketingOutboxTransition {
  return {
    status: 'accepted_unverified',
    last_error: `${provider.toUpperCase()}_ACCEPTED_UNVERIFIED`,
    response: { ...response, provider, delivery_state: 'accepted_unverified' },
    sent_at: null,
    next_attempt_at: new Date(now.getTime() + retryAfterSeconds * 1_000).toISOString(),
  };
}

function ga4AcceptedUnverifiedTransition(response: JsonObject): MarketingOutboxTransition {
  return {
    status: 'accepted_unverified',
    last_error: 'GA4_ACCEPTED_UNVERIFIED',
    response: { ...response, provider: 'ga4', delivery_state: 'accepted_unverified' },
    sent_at: null,
  };
}

function sentTransition(
  provider: MarketingProvider,
  response: ProviderResponse,
  now: Date,
  summary?: JsonObject,
): MarketingOutboxTransition {
  return {
    status: 'sent',
    last_error: null,
    response: summary || providerResponseSummary(provider, response),
    sent_at: now.toISOString(),
  };
}

function metaDeliveryTransition(
  response: ProviderResponse,
  now: Date,
): MarketingOutboxTransition {
  if (response.json?.events_received === 1) {
    return sentTransition('meta', response, now);
  }
  return {
    status: 'retry',
    last_error: 'META_DELIVERY_NOT_CONFIRMED',
    response: {
      ...providerResponseSummary('meta', response),
      delivery_state: 'unconfirmed',
    },
    sent_at: null,
    next_attempt_at: new Date(now.getTime() + 60_000).toISOString(),
  };
}

function googleFailedTransition(
  requestId: string,
  response: ProviderResponse,
  statuses: string[],
): MarketingOutboxTransition {
  const partial = statuses.includes('PARTIAL_SUCCESS');
  return {
    status: 'dead',
    last_error: partial ? 'GOOGLE_REQUEST_PARTIAL_SUCCESS' : 'GOOGLE_REQUEST_FAILED',
    response: {
      ...googleStatusSummary(requestId, response),
      delivery_state: 'failed',
    },
    sent_at: null,
  };
}

function googleStatusTransition(
  requestId: string,
  response: ProviderResponse,
  now: Date,
): MarketingOutboxTransition {
  const statuses = googleDestinationStatuses(response);
  const recordCounts = googleIngestionRecordCounts(response);
  const summary = googleStatusSummary(requestId, response);
  const allSuccessful = statuses.length > 0 && statuses.every(status => status === 'SUCCESS');
  const oneRecordConfirmed = statuses.length === 1
    && recordCounts.length === 1
    && recordCounts[0] === 1;
  if (allSuccessful && oneRecordConfirmed) {
    return sentTransition('google', response, now, { ...summary, delivery_state: 'confirmed' });
  }
  if (statuses.some(status => status === 'FAILED' || status === 'PARTIAL_SUCCESS')) {
    return googleFailedTransition(requestId, response, statuses);
  }
  if (allSuccessful && recordCounts.some(count => count === 0)) {
    const retryResponse = { ...summary };
    delete retryResponse.request_id;
    return {
      status: 'retry',
      last_error: 'GOOGLE_ZERO_RECORDS_INGESTED',
      response: {
        ...retryResponse,
        last_request_id: requestId,
        delivery_state: 'not_ingested',
      },
      sent_at: null,
      next_attempt_at: new Date(now.getTime() + 60_000).toISOString(),
    };
  }
  return acceptedUnverifiedTransition('google', summary, now, 30);
}

function googleAcceptedIngestTransition(
  response: ProviderResponse,
  now: Date,
): MarketingOutboxTransition {
  const requestId = googleRequestId(response.json);
  if (!requestId) {
    return {
      status: 'retry',
      last_error: 'GOOGLE_REQUEST_ID_MISSING',
      response: providerResponseSummary('google', response),
      sent_at: null,
      next_attempt_at: new Date(now.getTime() + 60_000).toISOString(),
    };
  }
  return acceptedUnverifiedTransition(
    'google',
    { ...providerResponseSummary('google', response), request_id: requestId },
    now,
    10,
  );
}

async function processGoogleRow(
  options: ProcessMarketingOutboxOptions,
  row: MarketingConversionOutboxRow,
  integration: MarketingIntegrationRow,
  credentials: MarketingProviderCredentials,
  validateOnly: boolean,
  now: Date,
): Promise<MarketingOutboxTransition> {
  const accessToken = credentialString(credentials.access_token);
  if (!accessToken) {
    throw new MarketingPayloadError('INVALID_CONFIGURATION', 'Google access_token ausente');
  }
  const pendingRequestId = googleRequestId(row.response);
  if (pendingRequestId) {
    const status = await retrieveGoogleRequestStatus(options.fetch, accessToken, pendingRequestId);
    return googleStatusTransition(pendingRequestId, status, now);
  }
  const request = buildMarketingProviderRequest(row, integration, credentials, { validateOnly, now });
  const response = await sendProviderRequest(options.fetch, request);
  if (validateOnly) return validationOnlyTransition('google', response, now);
  const accepted = googleAcceptedIngestTransition(response, now);
  const requestId = googleRequestId(accepted.response);
  if (!requestId) return accepted;
  try {
    const status = await retrieveGoogleRequestStatus(options.fetch, accessToken, requestId);
    return googleStatusTransition(requestId, status, now);
  } catch {
    return accepted;
  }
}

function previousGa4Acceptance(row: MarketingConversionOutboxRow): JsonObject | null {
  const response = asJsonObject(row.response);
  return response?.delivery_state === 'accepted_unverified' ? response : null;
}

async function processDirectProviderRow(
  options: ProcessMarketingOutboxOptions,
  row: MarketingConversionOutboxRow,
  integration: MarketingIntegrationRow,
  credentials: MarketingProviderCredentials,
  validateOnly: boolean,
  now: Date,
): Promise<MarketingOutboxTransition> {
  const request = buildMarketingProviderRequest(row, integration, credentials, { validateOnly, now });
  const response = await sendProviderRequest(options.fetch, request);
  if (validateOnly) return validationOnlyTransition(row.provider, response, now);
  if (row.provider === 'ga4') {
    return ga4AcceptedUnverifiedTransition(providerResponseSummary('ga4', response));
  }
  return metaDeliveryTransition(response, now);
}

async function processRow(
  options: ProcessMarketingOutboxOptions,
  row: MarketingConversionOutboxRow,
  now: Date,
  googleCache: GoogleCredentialCache,
): Promise<MarketingOutboxTransition> {
  const integration = await requireIntegration(options.repository, row);
  if (!await options.repository.isConsentAllowed(row)) {
    return cancelledConsentTransition();
  }
  if (!await options.repository.isDestinationOwned(row, integration)) {
    throw new MarketingDestinationOwnershipError();
  }
  const acceptedGa4 = row.provider === 'ga4' ? previousGa4Acceptance(row) : null;
  if (acceptedGa4) return ga4AcceptedUnverifiedTransition(acceptedGa4);
  const credentials = await decryptedCredentials(
    options.decryptCredentials,
    integration,
    options.fetch,
    googleCache,
  );
  const validateOnly = Boolean(options.validateOnly);
  return row.provider === 'google'
    ? processGoogleRow(options, row, integration, credentials, validateOnly, now)
    : processDirectProviderRow(options, row, integration, credentials, validateOnly, now);
}

export async function processMarketingConversionOutbox(
  options: ProcessMarketingOutboxOptions,
): Promise<MarketingOutboxProcessResult> {
  const limit = boundedInteger(options.limit, 25, 1, 100);
  const leaseSeconds = boundedInteger(options.leaseSeconds, 300, 30, 1_800);
  const maxAttempts = boundedInteger(options.maxAttempts, 10, 1, 100);
  const rows = await options.repository.claim(limit, leaseSeconds);
  const result = emptyResult(rows.length);
  const timeoutMs = normalizedRequestTimeout(options.requestTimeoutMs, leaseSeconds);
  const runtimeOptions = { ...options, fetch: withRequestTimeout(options.fetch, timeoutMs) };
  const googleCache: GoogleCredentialCache = new Map();
  for (const row of rows) {
    const renewed = await options.repository.renewLease(row, leaseSeconds);
    if (!renewed) {
      result.skipped += 1;
      continue;
    }
    const now = options.now?.() || new Date();
    let transition: MarketingOutboxTransition;
    try {
      transition = await processRow(runtimeOptions, row, now, googleCache);
    } catch (error) {
      transition = failedTransition(row, error, maxAttempts, now);
    }
    const changed = await options.repository.transition(row, transition);
    if (!changed) {
      result.skipped += 1;
      continue;
    }
    incrementResult(result, transition.status);
  }
  return result;
}

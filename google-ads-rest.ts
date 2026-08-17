import { google } from 'googleapis';

const GOOGLE_ADS_SCOPE = 'https://www.googleapis.com/auth/adwords';
const DEFAULT_API_VERSION = 'v25';
const GOOGLE_ADS_BASE_URL = 'https://googleads.googleapis.com';
const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;

export type GoogleAdsRestConfig = {
  developerToken: string;
  loginCustomerId: string;
  serviceAccountEmail: string;
  serviceAccountPrivateKey: string;
  apiVersion: string;
  syncEnabled: boolean;
  requestTimeoutMs: number;
};

export type GoogleAdsConfigResult =
  | { configured: true; config: GoogleAdsRestConfig; missing: [] }
  | { configured: false; config: null; missing: string[] };

export type GoogleAdsFetch = typeof fetch;
export type GoogleAdsTokenProvider = () => Promise<string>;

export class GoogleAdsApiError extends Error {
  readonly status: number;
  readonly requestId: string | null;
  readonly details: unknown;

  constructor(message: string, status: number, requestId: string | null, details: unknown) {
    super(message);
    this.name = 'GoogleAdsApiError';
    this.status = status;
    this.requestId = requestId;
    this.details = details;
  }
}

export type GoogleAdsSafeFailure = { code: string; message: string };

export function googleAdsSafeFailure(error: unknown): GoogleAdsSafeFailure {
  if (!(error instanceof GoogleAdsApiError)) {
    return { code: 'SYNC_ERROR', message: 'Falha ao sincronizar os dados do Google Ads' };
  }
  if (error.status === 401 || error.status === 403) {
    return { code: 'GOOGLE_ADS_AUTH_ERROR', message: 'A plataforma não conseguiu autenticar no Google Ads' };
  }
  if (error.status === 404) {
    return { code: 'GOOGLE_ADS_ACCOUNT_UNAVAILABLE', message: 'A conta vinculada não está mais acessível pelo MCC' };
  }
  if (error.status === 429) {
    return { code: 'GOOGLE_ADS_RATE_LIMIT', message: 'O Google Ads limitou temporariamente as consultas' };
  }
  if (error.status === 504 || error.status >= 500) {
    return { code: 'GOOGLE_ADS_UNAVAILABLE', message: 'O Google Ads está temporariamente indisponível' };
  }
  return { code: 'GOOGLE_ADS_REQUEST_REJECTED', message: 'O Google Ads recusou a consulta de relatório' };
}

function envValue(env: NodeJS.ProcessEnv, name: string): string {
  return String(env[name] || '').trim();
}

export function normalizeGoogleAdsCustomerId(value: unknown): string | null {
  const raw = String(value || '').trim();
  if (!/^(?:\d{10}|\d{3}-\d{3}-\d{4})$/.test(raw)) return null;
  return raw.replace(/-/g, '');
}

function normalizeApiVersion(value: string): string {
  const candidate = value || DEFAULT_API_VERSION;
  return /^v\d+$/.test(candidate) ? candidate : DEFAULT_API_VERSION;
}

function normalizeRequestTimeout(value: string): number {
  const parsed = Number(value || DEFAULT_REQUEST_TIMEOUT_MS);
  if (!Number.isFinite(parsed)) return DEFAULT_REQUEST_TIMEOUT_MS;
  return Math.min(120_000, Math.max(5_000, Math.floor(parsed)));
}

export function readGoogleAdsRestConfig(env: NodeJS.ProcessEnv = process.env): GoogleAdsConfigResult {
  const values = {
    developerToken: envValue(env, 'GOOGLE_ADS_DEVELOPER_TOKEN'),
    loginCustomerId: normalizeGoogleAdsCustomerId(envValue(env, 'GOOGLE_ADS_LOGIN_CUSTOMER_ID')) || '',
    serviceAccountEmail: envValue(env, 'GOOGLE_ADS_SERVICE_ACCOUNT_EMAIL'),
    serviceAccountPrivateKey: envValue(env, 'GOOGLE_ADS_SERVICE_ACCOUNT_PRIVATE_KEY').replace(/\\n/g, '\n'),
    apiVersion: normalizeApiVersion(envValue(env, 'GOOGLE_ADS_API_VERSION')),
    syncEnabled: envValue(env, 'GOOGLE_ADS_SYNC_ENABLED').toLowerCase() === 'true',
    requestTimeoutMs: normalizeRequestTimeout(envValue(env, 'GOOGLE_ADS_REQUEST_TIMEOUT_MS')),
  };
  const required: Array<[keyof typeof values, string]> = [
    ['developerToken', 'GOOGLE_ADS_DEVELOPER_TOKEN'],
    ['loginCustomerId', 'GOOGLE_ADS_LOGIN_CUSTOMER_ID'],
    ['serviceAccountEmail', 'GOOGLE_ADS_SERVICE_ACCOUNT_EMAIL'],
    ['serviceAccountPrivateKey', 'GOOGLE_ADS_SERVICE_ACCOUNT_PRIVATE_KEY'],
  ];
  const missing = required.filter(([key]) => !values[key]).map(([, name]) => name);
  if (missing.length > 0) return { configured: false, config: null, missing };
  return { configured: true, config: values, missing: [] };
}

function createServiceAccountTokenProvider(config: GoogleAdsRestConfig): GoogleAdsTokenProvider {
  const auth = new google.auth.JWT({
    email: config.serviceAccountEmail,
    key: config.serviceAccountPrivateKey,
    scopes: [GOOGLE_ADS_SCOPE],
  });
  let cached: { token: string; expiresAt: number } | null = null;

  return async () => {
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
    const credentials = await auth.authorize();
    if (!credentials.access_token) throw new Error('Google Ads não retornou um access token');
    cached = {
      token: credentials.access_token,
      expiresAt: Number(credentials.expiry_date || Date.now() + 3_000_000),
    };
    return cached.token;
  };
}

function googleAdsErrorMessage(body: any, status: number): string {
  const message = body?.error?.message;
  if (typeof message === 'string' && message.trim()) return message.trim();
  return `Google Ads API respondeu com HTTP ${status}`;
}

function pageRows(body: any): any[] {
  return Array.isArray(body?.results) ? body.results : [];
}

function streamRows(body: any): any[] {
  const chunks = Array.isArray(body) ? body : [body];
  return chunks.flatMap((chunk) => pageRows(chunk));
}

function timeoutAfter<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

export class GoogleAdsRestClient {
  private readonly fetchFn: GoogleAdsFetch;
  private readonly tokenProvider: GoogleAdsTokenProvider;

  constructor(
    readonly config: GoogleAdsRestConfig,
    options: { fetchFn?: GoogleAdsFetch; tokenProvider?: GoogleAdsTokenProvider } = {},
  ) {
    this.fetchFn = options.fetchFn || fetch;
    this.tokenProvider = options.tokenProvider || createServiceAccountTokenProvider(config);
  }

  private endpoint(customerId: string, method: 'search' | 'searchStream'): string {
    const normalized = normalizeGoogleAdsCustomerId(customerId);
    if (!normalized) throw new Error('Google Ads customer_id inválido');
    return `${GOOGLE_ADS_BASE_URL}/${this.config.apiVersion}/customers/${normalized}/googleAds:${method}`;
  }

  private async request(customerId: string, method: 'search' | 'searchStream', body: Record<string, unknown>): Promise<any> {
    const token = await timeoutAfter(
      this.tokenProvider(),
      this.config.requestTimeoutMs,
      'Tempo limite ao autenticar no Google Ads',
    );
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);
    try {
      const response = await this.fetchFn(this.endpoint(customerId, method), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'developer-token': this.config.developerToken,
          'login-customer-id': this.config.loginCustomerId,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => null);
      if (response.ok) return payload;
      throw new GoogleAdsApiError(
        googleAdsErrorMessage(payload, response.status),
        response.status,
        response.headers.get('request-id'),
        payload?.error?.details || null,
      );
    } catch (error) {
      if (controller.signal.aborted) {
        throw new GoogleAdsApiError('Tempo limite ao consultar o Google Ads', 504, null, null);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async search(customerId: string, query: string): Promise<any[]> {
    const rows: any[] = [];
    let pageToken: string | undefined;
    do {
      const body = await this.request(customerId, 'search', { query, ...(pageToken ? { pageToken } : {}) });
      rows.push(...pageRows(body));
      pageToken = typeof body?.nextPageToken === 'string' ? body.nextPageToken : undefined;
    } while (pageToken);
    return rows;
  }

  async searchStream(customerId: string, query: string): Promise<any[]> {
    const body = await this.request(customerId, 'searchStream', { query });
    return streamRows(body);
  }
}

export function createEnabledGoogleAdsRestClient(
  result: GoogleAdsConfigResult,
  options: { fetchFn?: GoogleAdsFetch; tokenProvider?: GoogleAdsTokenProvider } = {},
): GoogleAdsRestClient | null {
  if (!result.configured || !result.config.syncEnabled) return null;
  return new GoogleAdsRestClient(result.config, options);
}

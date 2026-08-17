import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GoogleAdsRestClient,
  GoogleAdsApiError,
  createEnabledGoogleAdsRestClient,
  googleAdsSafeFailure,
  normalizeGoogleAdsCustomerId,
  readGoogleAdsRestConfig,
  type GoogleAdsRestConfig,
} from './google-ads-rest.js';

const baseEnv = {
  GOOGLE_ADS_DEVELOPER_TOKEN: 'developer-token-test',
  GOOGLE_ADS_LOGIN_CUSTOMER_ID: '123-456-7890',
  GOOGLE_ADS_SERVICE_ACCOUNT_EMAIL: 'google-ads-reader@example.iam.gserviceaccount.com',
  GOOGLE_ADS_SERVICE_ACCOUNT_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\\ntest\\n-----END PRIVATE KEY-----',
};

const enabledConfig: GoogleAdsRestConfig = {
  developerToken: 'developer-token-test',
  loginCustomerId: '1234567890',
  serviceAccountEmail: 'google-ads-reader@example.iam.gserviceaccount.com',
  serviceAccountPrivateKey: 'private-key-test',
  apiVersion: 'v25',
  syncEnabled: true,
  requestTimeoutMs: 60_000,
};

test('normaliza IDs formatados e rejeita IDs fora de 10 dígitos', () => {
  assert.equal(normalizeGoogleAdsCustomerId('123-456-7890'), '1234567890');
  assert.equal(normalizeGoogleAdsCustomerId('123'), null);
  assert.equal(normalizeGoogleAdsCustomerId('12345678901'), null);
  assert.equal(normalizeGoogleAdsCustomerId('conta-1234567890'), null);
});

test('fail-safe deixa chamadas desabilitadas por padrão mesmo com credenciais presentes', () => {
  let calls = 0;
  const result = readGoogleAdsRestConfig(baseEnv);
  const client = createEnabledGoogleAdsRestClient(result, {
    fetchFn: (async () => {
      calls++;
      return new Response('{}');
    }) as typeof fetch,
    tokenProvider: async () => 'unused',
  });

  assert.equal(result.configured, true);
  assert.equal(result.configured && result.config.syncEnabled, false);
  assert.equal(client, null);
  assert.equal(calls, 0);
});

test('só GOOGLE_ADS_SYNC_ENABLED=true habilita o cliente', () => {
  const result = readGoogleAdsRestConfig({ ...baseEnv, GOOGLE_ADS_SYNC_ENABLED: 'true' });
  assert.ok(createEnabledGoogleAdsRestClient(result, { tokenProvider: async () => 'token' }));
});

test('versão REST aceita apenas path major e faz fallback seguro', () => {
  const result = readGoogleAdsRestConfig({
    ...baseEnv,
    GOOGLE_ADS_SYNC_ENABLED: 'true',
    GOOGLE_ADS_API_VERSION: 'v25.1',
  });
  assert.equal(result.configured && result.config.apiVersion, 'v25');
});

test('Search usa apenas POST de leitura, paginação e headers MCC', async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const responses = [
    { results: [{ campaign: { id: '1' } }], nextPageToken: 'next' },
    { results: [{ campaign: { id: '2' } }] },
  ];
  const client = new GoogleAdsRestClient(enabledConfig, {
    tokenProvider: async () => 'access-token-test',
    fetchFn: (async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), init });
      return new Response(JSON.stringify(responses.shift()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch,
  });

  const rows = await client.search('098-765-4321', 'SELECT campaign.id FROM campaign');

  assert.deepEqual(rows.map((row) => row.campaign.id), ['1', '2']);
  assert.equal(requests.length, 2);
  assert.ok(requests.every((request) => request.init?.method === 'POST'));
  assert.ok(requests.every((request) => request.url.endsWith('/v25/customers/0987654321/googleAds:search')));
  assert.equal((requests[0].init?.headers as Record<string, string>)['login-customer-id'], '1234567890');
  assert.equal((requests[0].init?.headers as Record<string, string>)['developer-token'], 'developer-token-test');
  assert.equal(JSON.parse(String(requests[1].init?.body)).pageToken, 'next');
});

test('SearchStream só usa o endpoint de relatório e achata lotes', async () => {
  let requestedUrl = '';
  const client = new GoogleAdsRestClient(enabledConfig, {
    tokenProvider: async () => 'access-token-test',
    fetchFn: (async (url: string | URL | Request) => {
      requestedUrl = String(url);
      return new Response(JSON.stringify([
        { results: [{ campaign: { id: '1' } }] },
        { results: [{ campaign: { id: '2' } }] },
      ]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch,
  });

  const rows = await client.searchStream('0987654321', 'SELECT campaign.id FROM campaign');

  assert.equal(requestedUrl.endsWith('/googleAds:searchStream'), true);
  assert.equal(rows.length, 2);
});

test('erro público nunca repete mensagem, conta ou query devolvida pelo Google', () => {
  const raw = new GoogleAdsApiError(
    'Falha customers/1234567890 SELECT campaign.id token-secreto',
    403,
    'request-safe',
    null,
  );
  assert.deepEqual(googleAdsSafeFailure(raw), {
    code: 'GOOGLE_ADS_AUTH_ERROR',
    message: 'A plataforma não conseguiu autenticar no Google Ads',
  });
});

test('timeout interrompe a consulta muito antes do cooldown de sincronização', async () => {
  const client = new GoogleAdsRestClient({ ...enabledConfig, requestTimeoutMs: 10 }, {
    tokenProvider: async () => 'access-token-test',
    fetchFn: (async (_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    })) as typeof fetch,
  });
  await assert.rejects(
    () => client.search('0987654321', 'SELECT campaign.id FROM campaign'),
    (error: any) => error instanceof GoogleAdsApiError && error.status === 504,
  );
});

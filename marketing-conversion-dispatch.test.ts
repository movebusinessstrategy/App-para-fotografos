import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createSupabaseMarketingOutboxRepository,
  processMarketingConversionOutbox,
  type MarketingOutboxRepository,
  type MarketingOutboxTransition,
} from './lib/marketing-conversion-dispatch.js';
import type {
  MarketingConversionOutboxRow,
  MarketingIntegrationRow,
} from './lib/marketing-conversion-payloads.js';

const CLAIM_TOKEN = '1dcb1e96-6b1f-4c5f-a4f5-72824cdd31b0';
const TENANT_ID = '56dd4834-ed5e-42b6-9a79-dc896a9a756f';
const LEAD_ID = '2f77cd71-10e6-46ae-a8dc-e97fffd5e93f';
const GOOGLE_REFRESH_CREDENTIALS = {
  refresh_token: 'refresh-secret',
  client_id: 'oauth-client-id',
  client_secret: 'oauth-client-secret',
};

function metaRow(overrides: Partial<MarketingConversionOutboxRow> = {}): MarketingConversionOutboxRow {
  return {
    id: 81,
    user_id: TENANT_ID,
    deal_id: 37,
    provider: 'meta',
    event_name: 'Contact',
    event_id: 'lead:opaque:contact',
    occurred_at: '2026-08-28T15:00:00.000Z',
    value: 0,
    currency: 'BRL',
    status: 'processing',
    attempts: 1,
    integration_id: 12,
    marketing_site_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    destination_id: 'dataset-123',
    account_id: null,
    conversion_action_id: null,
    provider_event_name: 'Contact',
    event_source_url: 'https://www.example.com/landing',
    consent_snapshot: {
      status: 'granted',
      ad_user_data: 'granted',
      ad_personalization: 'granted',
    },
    user_data: { client_user_agent: 'Mozilla/5.0 Studio Browser' },
    attribution_data: { fbc: 'fb.1.real.click' },
    event_data: { event_name: 'Contact', source_context: 'message' },
    payload_hash: 'a'.repeat(64),
    claim_token: CLAIM_TOKEN,
    lead_id: LEAD_ID,
    ...overrides,
  };
}

function metaIntegration(overrides: Partial<MarketingIntegrationRow> = {}): MarketingIntegrationRow {
  return {
    id: 12,
    user_id: TENANT_ID,
    provider: 'meta',
    enabled: true,
    marketing_site_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    account_id: null,
    destination_id: 'dataset-123',
    conversion_action_id: null,
    credentials_encrypted: 'enc:v1:a:b:c',
    event_mappings: {},
    provider_config: { api_version: 'v25.0' },
    ...overrides,
  };
}

function googleRow(overrides: Partial<MarketingConversionOutboxRow> = {}): MarketingConversionOutboxRow {
  return metaRow({
    provider: 'google',
    integration_id: 22,
    destination_id: 'google-destination',
    account_id: '8275091764',
    conversion_action_id: '99887766',
    consent_snapshot: {
      status: 'granted',
      ad_user_data: 'granted',
      ad_personalization: 'denied',
    },
    attribution_data: { gclid: 'real-gclid' },
    ...overrides,
  });
}

function googleIntegration(overrides: Partial<MarketingIntegrationRow> = {}): MarketingIntegrationRow {
  return metaIntegration({
    id: 22,
    provider: 'google',
    destination_id: 'google-destination',
    account_id: '8275091764',
    conversion_action_id: '99887766',
    provider_config: {},
    ...overrides,
  });
}

function ga4Row(overrides: Partial<MarketingConversionOutboxRow> = {}): MarketingConversionOutboxRow {
  return metaRow({
    provider: 'ga4',
    integration_id: 32,
    destination_id: 'G-ABC123XYZ',
    consent_snapshot: {
      status: 'granted',
      analytics_storage: 'granted',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
    },
    attribution_data: { ga_client_id: '123456789.1700000000' },
    ...overrides,
  });
}

function ga4Integration(overrides: Partial<MarketingIntegrationRow> = {}): MarketingIntegrationRow {
  return metaIntegration({
    id: 32,
    provider: 'ga4',
    destination_id: 'G-ABC123XYZ',
    provider_config: {},
    ...overrides,
  });
}

function fakeRepository(options: {
  rows?: MarketingConversionOutboxRow[];
  integration?: MarketingIntegrationRow | null;
  transitionChanged?: boolean;
  renewLeaseChanged?: boolean;
  consentAllowed?: boolean;
  destinationOwned?: boolean;
} = {}) {
  const transitions: MarketingOutboxTransition[] = [];
  const claims: Array<[number, number]> = [];
  const renewals: Array<[MarketingConversionOutboxRow, number]> = [];
  const consentChecks: MarketingConversionOutboxRow[] = [];
  const ownershipChecks: Array<[MarketingConversionOutboxRow, MarketingIntegrationRow]> = [];
  const repository: MarketingOutboxRepository = {
    async claim(limit, leaseSeconds) {
      claims.push([limit, leaseSeconds]);
      return options.rows || [metaRow()];
    },
    async renewLease(row, leaseSeconds) {
      renewals.push([row, leaseSeconds]);
      return options.renewLeaseChanged !== false;
    },
    async isConsentAllowed(row) {
      consentChecks.push(row);
      return options.consentAllowed !== false;
    },
    async isDestinationOwned(row, integration) {
      ownershipChecks.push([row, integration]);
      return options.destinationOwned !== false;
    },
    async findIntegration() {
      return options.integration === undefined ? metaIntegration() : options.integration;
    },
    async transition(_row, change) {
      transitions.push(change);
      return options.transitionChanged !== false;
    },
  };
  return {
    repository,
    transitions,
    claims,
    renewals,
    consentChecks,
    ownershipChecks,
  };
}

function okResponse(body: Record<string, unknown> = { events_received: 1 }) {
  return {
    ok: true,
    status: 200,
    async text() { return JSON.stringify(body); },
  };
}

test('Meta só marca sent com HTTP 2xx e events_received igual a 1', async () => {
  const fake = fakeRepository();
  let requestBody = '';
  const result = await processMarketingConversionOutbox({
    repository: fake.repository,
    decryptCredentials: async encrypted => {
      assert.equal(encrypted, 'enc:v1:a:b:c');
      return { access_token: 'integration-token' };
    },
    fetch: async (_url, init) => {
      requestBody = String(init?.body || '');
      return okResponse();
    },
    now: () => new Date('2026-08-28T15:05:00.000Z'),
  });

  assert.deepEqual(result, {
    claimed: 1,
    sent: 1,
    validationOnly: 0,
    acceptedUnverified: 0,
    retry: 0,
    blocked: 0,
    cancelled: 0,
    dead: 0,
    skipped: 0,
  });
  assert.match(requestBody, /lead:opaque:contact/);
  assert.deepEqual(fake.transitions[0], {
    status: 'sent',
    last_error: null,
    response: { provider: 'meta', http_status: 200, events_received: 1 },
    sent_at: '2026-08-28T15:05:00.000Z',
  });
});

test('Meta 2xx com events_received zero ou ausente nunca vira sent', async () => {
  for (const body of [{ events_received: 0 }, {}]) {
    const fake = fakeRepository();
    const result = await processMarketingConversionOutbox({
      repository: fake.repository,
      decryptCredentials: () => ({ access_token: 'integration-token' }),
      fetch: async () => okResponse(body),
      now: () => new Date('2026-08-28T15:05:00.000Z'),
    });

    assert.equal(result.sent, 0);
    assert.equal(result.retry, 1);
    assert.equal(fake.transitions[0].status, 'retry');
    assert.equal(fake.transitions[0].last_error, 'META_DELIVERY_NOT_CONFIRMED');
    assert.equal(fake.transitions[0].response?.delivery_state, 'unconfirmed');
    assert.equal(fake.transitions[0].sent_at, null);
    assert.equal(fake.transitions[0].next_attempt_at, '2026-08-28T15:06:00.000Z');
  }
});

test('não tenta rede quando integração exata do tenant/destino não existe', async () => {
  const fake = fakeRepository({ integration: null });
  let fetchCalls = 0;
  const result = await processMarketingConversionOutbox({
    repository: fake.repository,
    decryptCredentials: () => ({ access_token: 'unused' }),
    fetch: async () => {
      fetchCalls += 1;
      return okResponse();
    },
  });

  assert.equal(fetchCalls, 0);
  assert.equal(result.blocked, 1);
  assert.equal(fake.transitions[0].status, 'blocked_config');
  assert.equal(fake.transitions[0].last_error, 'DESTINATION_MISMATCH');
});

test('consentimento revogado cancela a linha antes de decrypt e rede', async () => {
  const fake = fakeRepository({ consentAllowed: false });
  let decryptCalls = 0;
  let fetchCalls = 0;
  const result = await processMarketingConversionOutbox({
    repository: fake.repository,
    decryptCredentials: () => {
      decryptCalls += 1;
      return { access_token: 'must-not-be-used' };
    },
    fetch: async () => {
      fetchCalls += 1;
      return okResponse();
    },
  });

  assert.equal(fake.renewals.length, 1);
  assert.equal(fake.consentChecks.length, 1);
  assert.equal(fake.ownershipChecks.length, 0);
  assert.equal(decryptCalls, 0);
  assert.equal(fetchCalls, 0);
  assert.equal(result.cancelled, 1);
  assert.equal(result.sent, 0);
  assert.deepEqual(fake.transitions[0], {
    status: 'cancelled_consent',
    last_error: 'CONSENT_NOT_ALLOWED_AT_DELIVERY',
    response: null,
    sent_at: null,
  });
});

test('ownership ausente bloqueia configuração antes de decrypt e rede', async () => {
  const fake = fakeRepository({ destinationOwned: false });
  let decryptCalls = 0;
  let fetchCalls = 0;
  const result = await processMarketingConversionOutbox({
    repository: fake.repository,
    decryptCredentials: () => {
      decryptCalls += 1;
      return { access_token: 'must-not-be-used' };
    },
    fetch: async () => {
      fetchCalls += 1;
      return okResponse();
    },
  });

  assert.equal(fake.consentChecks.length, 1);
  assert.equal(fake.ownershipChecks.length, 1);
  assert.equal(decryptCalls, 0);
  assert.equal(fetchCalls, 0);
  assert.equal(result.blocked, 1);
  assert.equal(result.sent, 0);
  assert.deepEqual(fake.transitions[0], {
    status: 'blocked_config',
    last_error: 'DESTINATION_OWNERSHIP_MISMATCH',
    response: null,
    sent_at: null,
  });
});

test('lease não renovado vira skipped sem consentimento, decrypt, rede ou transição', async () => {
  const fake = fakeRepository({ renewLeaseChanged: false });
  let decryptCalls = 0;
  let fetchCalls = 0;
  const result = await processMarketingConversionOutbox({
    repository: fake.repository,
    decryptCredentials: () => {
      decryptCalls += 1;
      return { access_token: 'must-not-be-used' };
    },
    fetch: async () => {
      fetchCalls += 1;
      return okResponse();
    },
  });

  assert.equal(result.skipped, 1);
  assert.deepEqual(fake.renewals.map(([, seconds]) => seconds), [300]);
  assert.equal(fake.consentChecks.length, 0);
  assert.equal(fake.ownershipChecks.length, 0);
  assert.equal(decryptCalls, 0);
  assert.equal(fetchCalls, 0);
  assert.equal(fake.transitions.length, 0);
});

test('bloqueia credencial nula, plaintext ou ciphertext malformado antes de decrypt e fetch', async () => {
  for (const credentialsEncrypted of [
    null,
    'plaintext-token',
    'enc:v1:a:b',
    ' enc:v1:a:b:c ',
  ]) {
    const fake = fakeRepository({
      integration: metaIntegration({ credentials_encrypted: credentialsEncrypted }),
    });
    let decryptCalls = 0;
    let fetchCalls = 0;
    const result = await processMarketingConversionOutbox({
      repository: fake.repository,
      decryptCredentials: () => {
        decryptCalls += 1;
        return { access_token: 'must-not-be-used' };
      },
      fetch: async () => {
        fetchCalls += 1;
        return okResponse();
      },
    });

    assert.equal(decryptCalls, 0);
    assert.equal(fetchCalls, 0);
    assert.equal(result.blocked, 1);
    assert.equal(fake.transitions[0].status, 'blocked_config');
    assert.equal(fake.transitions[0].last_error, 'INVALID_CONFIGURATION');
  }
});

test('falha transitória volta para retry com backoff e sem salvar mensagem sensível', async () => {
  const fake = fakeRepository({ rows: [metaRow({ attempts: 2 })] });
  const result = await processMarketingConversionOutbox({
    repository: fake.repository,
    decryptCredentials: () => ({ access_token: 'secret-token' }),
    fetch: async () => {
      throw new TypeError('request with secret-token failed');
    },
    now: () => new Date('2026-08-28T15:00:00.000Z'),
  });

  assert.equal(result.retry, 1);
  assert.equal(fake.transitions[0].status, 'retry');
  assert.equal(fake.transitions[0].last_error, 'PROVIDER_NETWORK_ERROR');
  assert.equal(fake.transitions[0].next_attempt_at, '2026-08-28T15:00:20.000Z');
  assert.doesNotMatch(JSON.stringify(fake.transitions), /secret-token/);
});

test('timeout aborta inclusive leitura do corpo e retorna retry sem ultrapassar o lease', async () => {
  const fake = fakeRepository();
  let aborted = false;
  const result = await processMarketingConversionOutbox({
    repository: fake.repository,
    decryptCredentials: () => ({ access_token: 'token' }),
    fetch: async (_url, init) => {
      const signal = init?.signal;
      assert.ok(signal);
      return {
        ok: true,
        status: 200,
        async text() {
          return new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => {
              aborted = true;
              reject(new Error('aborted by timeout'));
            }, { once: true });
          });
        },
      };
    },
    leaseSeconds: 30,
    requestTimeoutMs: 5,
    now: () => new Date('2026-08-28T15:00:00.000Z'),
  });

  assert.equal(aborted, true);
  assert.equal(result.retry, 1);
  assert.equal(fake.transitions[0].last_error, 'PROVIDER_REQUEST_TIMEOUT');
});

test('timer de subrequisição concluída é sempre limpo', async () => {
  const fake = fakeRepository();
  let signal: AbortSignal | null | undefined;
  const result = await processMarketingConversionOutbox({
    repository: fake.repository,
    decryptCredentials: () => ({ access_token: 'token' }),
    fetch: async (_url, init) => {
      signal = init?.signal;
      return okResponse();
    },
    requestTimeoutMs: 5,
  });

  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(result.sent, 1);
  assert.ok(signal);
  assert.equal(signal.aborted, false);
});

test('encerra em dead ao atingir máximo de tentativas', async () => {
  const fake = fakeRepository({ rows: [metaRow({ attempts: 10 })] });
  const result = await processMarketingConversionOutbox({
    repository: fake.repository,
    decryptCredentials: () => ({ access_token: 'token' }),
    fetch: async () => { throw new TypeError('network'); },
    maxAttempts: 10,
  });

  assert.equal(result.dead, 1);
  assert.equal(fake.transitions[0].status, 'dead');
});

test('validateOnly nunca marca conversão como enviada', async () => {
  const fake = fakeRepository({
    integration: metaIntegration({
      provider_config: { api_version: 'v25.0', test_event_code: 'TEST123' },
    }),
  });
  const result = await processMarketingConversionOutbox({
    repository: fake.repository,
    decryptCredentials: () => ({ access_token: 'token' }),
    fetch: async () => okResponse(),
    validateOnly: true,
  });

  assert.equal(result.sent, 0);
  assert.equal(result.validationOnly, 1);
  assert.equal(result.blocked, 0);
  assert.equal(result.retry, 0);
  assert.equal(fake.transitions[0].status, 'validation_only');
  assert.equal(fake.transitions[0].last_error, 'VALIDATION_ONLY_OK_REQUEUED');
  assert.equal(fake.transitions[0].sent_at, null);
  assert.ok(fake.transitions[0].next_attempt_at);
});

test('provider_config.validate_only não altera o fluxo real sem options.validateOnly', async () => {
  const fake = fakeRepository({
    integration: metaIntegration({
      provider_config: { api_version: 'v25.0', validate_only: true },
    }),
  });
  const result = await processMarketingConversionOutbox({
    repository: fake.repository,
    decryptCredentials: () => ({ access_token: 'token' }),
    fetch: async () => okResponse(),
    validateOnly: false,
  });

  assert.equal(result.sent, 1);
  assert.equal(result.validationOnly, 0);
  assert.equal(result.blocked, 0);
  assert.equal(fake.transitions[0].status, 'sent');
});

test('transição guardada que já ocorreu é contabilizada como skipped', async () => {
  const fake = fakeRepository({ transitionChanged: false });
  const result = await processMarketingConversionOutbox({
    repository: fake.repository,
    decryptCredentials: () => ({ access_token: 'token' }),
    fetch: async () => okResponse(),
  });

  assert.equal(result.sent, 0);
  assert.equal(result.skipped, 1);
});

test('Google 2xx com requestId consulta status e mantém PROCESSING como aceito não verificado', async () => {
  const fake = fakeRepository({ rows: [googleRow()], integration: googleIntegration() });
  const calls: Array<{ url: string; method: string }> = [];
  const result = await processMarketingConversionOutbox({
    repository: fake.repository,
    decryptCredentials: () => GOOGLE_REFRESH_CREDENTIALS,
    fetch: async (url, init) => {
      calls.push({ url: String(url), method: String(init?.method) });
      if (String(url).includes('oauth2.googleapis.com/token')) {
        return okResponse({ access_token: 'fresh-access-token' });
      }
      if (String(url).includes('events:ingest')) return okResponse({ requestId: 'request-123' });
      return okResponse({
        requestStatusPerDestination: [{ requestStatus: 'PROCESSING' }],
      });
    },
    now: () => new Date('2026-08-28T15:00:00.000Z'),
  });

  assert.equal(result.sent, 0);
  assert.equal(result.acceptedUnverified, 1);
  assert.equal(fake.transitions[0].status, 'accepted_unverified');
  assert.equal(fake.transitions[0].response?.request_id, 'request-123');
  assert.deepEqual(calls, [
    { url: 'https://oauth2.googleapis.com/token', method: 'POST' },
    { url: 'https://datamanager.googleapis.com/v1/events:ingest', method: 'POST' },
    {
      url: 'https://datamanager.googleapis.com/v1/requestStatus:retrieve?requestId=request-123',
      method: 'GET',
    },
  ]);
});

test('Google só marca sent quando requestStatus retorna SUCCESS', async () => {
  const pending = googleRow({
    response: {
      provider: 'google',
      request_id: 'request-123',
      delivery_state: 'accepted_unverified',
    },
  });
  const fake = fakeRepository({ rows: [pending], integration: googleIntegration() });
  let calls = 0;
  const result = await processMarketingConversionOutbox({
    repository: fake.repository,
    decryptCredentials: () => GOOGLE_REFRESH_CREDENTIALS,
    fetch: async (url, init) => {
      calls += 1;
      if (String(url).includes('oauth2.googleapis.com/token')) {
        assert.equal(init?.method, 'POST');
        return okResponse({ access_token: 'fresh-access-token' });
      }
      assert.match(String(url), /requestStatus:retrieve/);
      assert.equal(init?.method, 'GET');
      return okResponse({
        requestStatusPerDestination: [{
          requestStatus: 'SUCCESS',
          eventsIngestionStatus: { recordCount: '1' },
        }],
      });
    },
    now: () => new Date('2026-08-28T15:10:00.000Z'),
  });

  assert.equal(calls, 2);
  assert.equal(result.sent, 1);
  assert.equal(result.acceptedUnverified, 0);
  assert.equal(fake.transitions[0].status, 'sent');
  assert.equal(fake.transitions[0].response?.delivery_state, 'confirmed');
  assert.deepEqual(fake.transitions[0].response?.request_statuses, ['SUCCESS']);
  assert.deepEqual(fake.transitions[0].response?.record_counts, [1]);
});

test('Google SUCCESS sem recordCount ou com zero nunca vira sent', async () => {
  const cases = [
    { recordCount: null, expectedStatus: 'accepted_unverified' },
    { recordCount: '0', expectedStatus: 'retry' },
  ] as const;

  for (const item of cases) {
    const pending = googleRow({ response: { request_id: `request-${item.recordCount ?? 'missing'}` } });
    const fake = fakeRepository({ rows: [pending], integration: googleIntegration() });
    const result = await processMarketingConversionOutbox({
      repository: fake.repository,
      decryptCredentials: () => GOOGLE_REFRESH_CREDENTIALS,
      fetch: async url => {
        if (String(url).includes('oauth2.googleapis.com/token')) {
          return okResponse({ access_token: 'fresh-access-token' });
        }
        const eventsIngestionStatus = item.recordCount === null
          ? {}
          : { eventsIngestionStatus: { recordCount: item.recordCount } };
        return okResponse({
          requestStatusPerDestination: [{
            requestStatus: 'SUCCESS',
            ...eventsIngestionStatus,
          }],
        });
      },
      now: () => new Date('2026-08-28T15:10:00.000Z'),
    });

    assert.equal(result.sent, 0);
    assert.equal(fake.transitions[0].status, item.expectedStatus);
    if (item.recordCount === null) {
      assert.equal(result.acceptedUnverified, 1);
      assert.match(String(fake.transitions[0].response?.request_id), /request-missing/);
    } else {
      assert.equal(result.retry, 1);
      assert.equal(fake.transitions[0].last_error, 'GOOGLE_ZERO_RECORDS_INGESTED');
      assert.match(String(fake.transitions[0].response?.last_request_id), /request-0/);
      assert.equal(fake.transitions[0].response?.request_id, undefined);
    }
  }
});

test('Google FAILED e PARTIAL_SUCCESS nunca viram sent', async () => {
  for (const status of ['FAILED', 'PARTIAL_SUCCESS']) {
    const pending = googleRow({ response: { request_id: `request-${status}` } });
    const fake = fakeRepository({ rows: [pending], integration: googleIntegration() });
    const result = await processMarketingConversionOutbox({
      repository: fake.repository,
      decryptCredentials: () => GOOGLE_REFRESH_CREDENTIALS,
      fetch: async url => {
        if (String(url).includes('oauth2.googleapis.com/token')) {
          return okResponse({ access_token: 'fresh-access-token' });
        }
        return okResponse({
          requestStatusPerDestination: [{
            requestStatus: status,
            errorInfo: {
              errorCounts: [{ reason: 'PROCESSING_ERROR_REASON_INVALID_GCLID', recordCount: '1' }],
            },
          }],
        });
      },
    });

    assert.equal(result.sent, 0);
    assert.equal(result.dead, 1);
    assert.equal(fake.transitions[0].status, 'dead');
    assert.deepEqual(
      fake.transitions[0].response?.error_reasons,
      ['PROCESSING_ERROR_REASON_INVALID_GCLID'],
    );
  }
});

test('Google renova credencial da própria integração antes do ingest e não persiste segredos', async () => {
  const fake = fakeRepository({ rows: [googleRow()], integration: googleIntegration() });
  const calls: Array<{ url: string; authorization?: string; body?: string }> = [];
  const result = await processMarketingConversionOutbox({
    repository: fake.repository,
    decryptCredentials: () => GOOGLE_REFRESH_CREDENTIALS,
    fetch: async (url, init) => {
      calls.push({
        url: String(url),
        authorization: (init?.headers as Record<string, string> | undefined)?.Authorization,
        body: String(init?.body || ''),
      });
      if (String(url).includes('oauth2.googleapis.com/token')) {
        return okResponse({ access_token: 'fresh-access-token', expires_in: 3600 });
      }
      if (String(url).includes('events:ingest')) {
        assert.equal(
          (init?.headers as Record<string, string>).Authorization,
          'Bearer fresh-access-token',
        );
        return okResponse({ requestId: 'request-refreshed' });
      }
      return okResponse({
        requestStatusPerDestination: [{
          requestStatus: 'SUCCESS',
          eventsIngestionStatus: { recordCount: '1' },
        }],
      });
    },
  });

  assert.equal(result.sent, 1);
  assert.match(calls[0].body || '', /grant_type=refresh_token/);
  assert.match(calls[0].body || '', /refresh_token=refresh-secret/);
  assert.equal(calls.length, 3);
  assert.doesNotMatch(JSON.stringify(fake.transitions), /refresh-secret|oauth-client-secret|fresh-access-token/);
});

test('Google reutiliza uma credencial renovada para duas linhas da mesma integração e site', async () => {
  const rows = [
    googleRow({ id: 91, event_id: 'lead:opaque:contact:1' }),
    googleRow({ id: 92, event_id: 'lead:opaque:contact:2' }),
  ];
  const fake = fakeRepository({ rows, integration: googleIntegration() });
  let decryptCalls = 0;
  let oauthCalls = 0;
  let ingestCalls = 0;
  let statusCalls = 0;
  const result = await processMarketingConversionOutbox({
    repository: fake.repository,
    decryptCredentials: () => {
      decryptCalls += 1;
      return GOOGLE_REFRESH_CREDENTIALS;
    },
    fetch: async url => {
      const target = String(url);
      if (target.includes('oauth2.googleapis.com/token')) {
        oauthCalls += 1;
        return okResponse({ access_token: 'fresh-access-token' });
      }
      if (target.includes('events:ingest')) {
        ingestCalls += 1;
        return okResponse({ requestId: `request-${ingestCalls}` });
      }
      statusCalls += 1;
      return okResponse({
        requestStatusPerDestination: [{
          requestStatus: 'SUCCESS',
          eventsIngestionStatus: { recordCount: '1' },
        }],
      });
    },
  });

  assert.equal(result.sent, 2);
  assert.equal(decryptCalls, 1);
  assert.equal(oauthCalls, 1);
  assert.equal(ingestCalls, 2);
  assert.equal(statusCalls, 2);
  assert.equal(fake.renewals.length, 2);
  assert.equal(fake.consentChecks.length, 2);
});

test('GA4 2xx fica accepted_unverified terminal e não é reenviado', async () => {
  const first = fakeRepository({ rows: [ga4Row()], integration: ga4Integration() });
  let firstFetchCalls = 0;
  const firstResult = await processMarketingConversionOutbox({
    repository: first.repository,
    decryptCredentials: () => ({ api_secret: 'ga4-secret' }),
    fetch: async () => {
      firstFetchCalls += 1;
      return { ok: true, status: 204, async text() { return ''; } };
    },
    now: () => new Date('2026-08-28T15:00:00.000Z'),
  });

  assert.equal(firstFetchCalls, 1);
  assert.equal(firstResult.sent, 0);
  assert.equal(firstResult.acceptedUnverified, 1);
  assert.equal(first.transitions[0].status, 'accepted_unverified');
  assert.equal(first.transitions[0].next_attempt_at, undefined);

  const reclaimed = ga4Row({ response: first.transitions[0].response });
  const second = fakeRepository({ rows: [reclaimed], integration: ga4Integration() });
  let secondFetchCalls = 0;
  let secondDecryptCalls = 0;
  const secondResult = await processMarketingConversionOutbox({
    repository: second.repository,
    decryptCredentials: () => {
      secondDecryptCalls += 1;
      return { api_secret: 'ga4-secret' };
    },
    fetch: async () => {
      secondFetchCalls += 1;
      return okResponse();
    },
    validateOnly: true,
  });

  assert.equal(secondFetchCalls, 0);
  assert.equal(secondDecryptCalls, 0);
  assert.equal(secondResult.sent, 0);
  assert.equal(secondResult.acceptedUnverified, 1);
  assert.equal(second.transitions[0].next_attempt_at, undefined);
});

test('repositório persiste estados lógicos explícitos, nunca como sent ou blocked_config', async () => {
  let persistedPatch: Record<string, unknown> | null = null;
  const db = {
    from() {
      return {
        update(patch: Record<string, unknown>) {
          persistedPatch = patch;
          const chain = {
            eq() { return chain; },
            async select() { return { data: [{ id: 81 }], error: null }; },
          };
          return chain;
        },
      };
    },
  } as any;
  const repository = createSupabaseMarketingOutboxRepository(db);
  await repository.transition(metaRow(), {
    status: 'validation_only',
    last_error: 'VALIDATION_ONLY_OK_REQUEUED',
    response: { delivery_state: 'validation_only' },
    sent_at: null,
    next_attempt_at: '2026-08-29T15:00:00.000Z',
  });

  assert.equal(persistedPatch?.status, 'validation_only');
  assert.notEqual(persistedPatch?.status, 'blocked_config');
});

test('repositório Supabase usa RPC de claim e guards completos na transição', async () => {
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const integrationEqs: Array<[string, unknown]> = [];
  const transitionEqs: Array<[string, unknown]> = [];
  let transitionPatch: Record<string, unknown> | null = null;
  const claimed = metaRow();
  const configured = metaIntegration();
  const db = {
    async rpc(name: string, args: Record<string, unknown>) {
      rpcCalls.push({ name, args });
      return { data: [claimed], error: null };
    },
    from(table: string) {
      if (table === 'marketing_integrations') {
        return {
          select() {
            const chain = {
              eq(field: string, value: unknown) {
                integrationEqs.push([field, value]);
                return chain;
              },
              async limit() { return { data: [configured], error: null }; },
            };
            return chain;
          },
        };
      }
      assert.equal(table, 'marketing_conversion_outbox');
      return {
        update(patch: Record<string, unknown>) {
          transitionPatch = patch;
          const chain = {
            eq(field: string, value: unknown) {
              transitionEqs.push([field, value]);
              return chain;
            },
            async select() { return { data: [{ id: claimed.id }], error: null }; },
          };
          return chain;
        },
      };
    },
  } as any;
  const repository = createSupabaseMarketingOutboxRepository(db, [TENANT_ID]);

  assert.deepEqual(await repository.claim(25, 300), [claimed]);
  assert.deepEqual(await repository.findIntegration(claimed), configured);
  assert.equal(await repository.transition(claimed, {
    status: 'sent',
    last_error: null,
    response: { request_id: 'opaque' },
    sent_at: '2026-08-28T15:05:00.000Z',
  }), true);

  assert.deepEqual(rpcCalls, [{
    name: 'claim_marketing_conversion_outbox',
    args: {
      p_limit: 25,
      p_lease_seconds: 300,
      p_user_ids: [TENANT_ID],
    },
  }]);
  assert.deepEqual(integrationEqs, [
    ['id', 12],
    ['user_id', TENANT_ID],
    ['provider', 'meta'],
    ['marketing_site_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
    ['destination_id', 'dataset-123'],
    ['enabled', true],
  ]);
  assert.deepEqual(transitionEqs, [
    ['id', 81],
    ['integration_id', 12],
    ['marketing_site_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
    ['lead_id', LEAD_ID],
    ['user_id', TENANT_ID],
    ['provider', 'meta'],
    ['destination_id', 'dataset-123'],
    ['event_id', 'lead:opaque:contact'],
    ['claim_token', CLAIM_TOKEN],
    ['status', 'processing'],
  ]);
  assert.equal(transitionPatch?.claim_token, null);
  assert.equal(transitionPatch?.status, 'sent');
});

test('repositório revalida consentimento exato e renova lease com todos os guards', async () => {
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const renewalEqs: Array<[string, unknown]> = [];
  let renewalPatch: Record<string, unknown> | null = null;
  const db = {
    async rpc(name: string, args: Record<string, unknown>) {
      rpcCalls.push({ name, args });
      return { data: true, error: null };
    },
    from(table: string) {
      assert.equal(table, 'marketing_conversion_outbox');
      return {
        update(patch: Record<string, unknown>) {
          renewalPatch = patch;
          const chain = {
            eq(field: string, value: unknown) {
              renewalEqs.push([field, value]);
              return chain;
            },
            async select() { return { data: [{ id: 81 }], error: null }; },
          };
          return chain;
        },
      };
    },
  } as any;
  const repository = createSupabaseMarketingOutboxRepository(db, [TENANT_ID]);
  const claimed = metaRow();

  assert.equal(await repository.isConsentAllowed(claimed), true);
  assert.equal(await repository.renewLease(claimed, 300), true);
  assert.deepEqual(rpcCalls, [{
    name: 'marketing_provider_consent_allowed',
    args: {
      p_user_id: TENANT_ID,
      p_marketing_site_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      p_lead_id: LEAD_ID,
      p_provider: 'meta',
    },
  }]);
  assert.deepEqual(renewalEqs, [
    ['id', 81],
    ['integration_id', 12],
    ['marketing_site_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
    ['lead_id', LEAD_ID],
    ['user_id', TENANT_ID],
    ['provider', 'meta'],
    ['destination_id', 'dataset-123'],
    ['event_id', 'lead:opaque:contact'],
    ['claim_token', CLAIM_TOKEN],
    ['status', 'processing'],
  ]);
  assert.equal(typeof renewalPatch?.claimed_at, 'string');
  assert.equal(typeof renewalPatch?.updated_at, 'string');
});

test('ownership consulta tenant, site, integração, provedor e resource_key congelado', async () => {
  const cases: Array<{
    row: MarketingConversionOutboxRow;
    integration: MarketingIntegrationRow;
    resourceKey: string;
  }> = [
    {
      row: metaRow({ destination_id: 'DATASET-ABC' }),
      integration: metaIntegration({ destination_id: 'DATASET-ABC' }),
      resourceKey: 'dataset-abc',
    },
    {
      row: ga4Row(),
      integration: ga4Integration(),
      resourceKey: 'g-abc123xyz',
    },
    {
      row: googleRow({ account_id: '827-509-1764', conversion_action_id: '99887766' }),
      integration: googleIntegration({
        account_id: '827-509-1764',
        conversion_action_id: '99887766',
      }),
      resourceKey: '8275091764:99887766',
    },
  ];

  for (const item of cases) {
    const eqs: Array<[string, unknown]> = [];
    const ltes: Array<[string, unknown]> = [];
    const db = {
      from(table: string) {
        assert.equal(table, 'marketing_destination_ownership');
        const chain = {
          select(columns: string) {
            assert.equal(columns, 'id');
            return chain;
          },
          eq(field: string, value: unknown) {
            eqs.push([field, value]);
            return chain;
          },
          lte(field: string, value: unknown) {
            ltes.push([field, value]);
            return chain;
          },
          async limit(value: number) {
            assert.equal(value, 2);
            return { data: [{ id: 1 }], error: null };
          },
        };
        return chain;
      },
    } as any;
    const repository = createSupabaseMarketingOutboxRepository(db, [TENANT_ID]);

    assert.equal(await repository.isDestinationOwned(item.row, item.integration), true);
    assert.deepEqual(eqs, [
      ['user_id', TENANT_ID],
      ['marketing_site_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
      ['integration_id', item.integration.id],
      ['provider', item.row.provider],
      ['resource_key', item.resourceKey],
    ]);
    assert.equal(ltes.length, 1);
    assert.equal(ltes[0][0], 'verified_at');
    assert.equal(Number.isNaN(Date.parse(String(ltes[0][1]))), false);
  }
});

test('repositório não chama claim RPC sem UUID de tenant válido', async () => {
  let rpcCalls = 0;
  const db = {
    async rpc() {
      rpcCalls += 1;
      return { data: [], error: null };
    },
  } as any;
  const repository = createSupabaseMarketingOutboxRepository(db, [
    'tenant-studio',
    'not-a-uuid',
    '',
  ]);

  assert.deepEqual(await repository.claim(25, 300), []);
  assert.equal(rpcCalls, 0);
});

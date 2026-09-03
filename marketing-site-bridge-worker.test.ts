import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CRM_INTAKE_PATH,
  buildSignedCrmRequest,
  hmacSha256Hex,
  sanitizeBrowserPayload,
  sha256Hex,
} from './workers/marketing-site-bridge/src/core.js';
import { handleMarketingBridgeRequest } from './workers/marketing-site-bridge/src/index.js';

const SITE_ORIGIN = 'https://www.gipitorifotografias.com.br';
const CRM_URL = `https://crm.example.com${CRM_INTAKE_PATH}`;
const SECRET = 'studio-site-hmac-secret-with-32-bytes-minimum';
const EVENT_ID = '2f1c13a7-b441-40a9-a46c-86f9e65fe7e0';

function fakeEnv(rateAllowed = true): Env {
  return {
    BRIDGE_ENABLED: 'true',
    SITE_ORIGIN,
    CRM_INGEST_URL: CRM_URL,
    MARKETING_SITE_KEY_ID: 'site-key-id',
    MARKETING_SITE_SIGNING_SECRET: SECRET,
    TURNSTILE_SECRET_KEY: 'turnstile-secret',
    MARKETING_BRIDGE_RATE_LIMITER: {
      limit: async () => ({ success: rateAllowed }),
    },
  } as Env;
}

function browserRequest(body: unknown, options: { origin?: string; method?: string } = {}): Request {
  return new Request('https://events.gipitorifotografias.com.br/v1/whatsapp-click', {
    method: options.method || 'POST',
    headers: {
      'content-type': 'application/json',
      origin: options.origin ?? SITE_ORIGIN,
      'user-agent': 'Studio Browser/1.0',
      'cf-connecting-ip': '203.0.113.7',
    },
    body: options.method === 'OPTIONS'
      ? undefined
      : JSON.stringify({ turnstile_token: 'verified-browser-token', ...(body as object) }),
  });
}

function turnstileSuccess(action = 'whatsapp_click'): Response {
  return Response.json({
    success: true,
    hostname: 'www.gipitorifotografias.com.br',
    action,
  });
}

test('reconstrói allowlist e injeta o user agent visto pelo Worker', () => {
  const payload = sanitizeBrowserPayload({
    event_name: 'WhatsAppClick',
    event_id: EVENT_ID,
    utm_source: 'google',
  }, 'Studio Browser/1.0');

  assert.deepEqual(payload, {
    event_name: 'WhatsAppClick',
    event_id: EVENT_ID,
    utm_source: 'google',
    client_user_agent: 'Studio Browser/1.0',
  });
  assert.throws(
    () => sanitizeBrowserPayload({ event_name: 'WhatsAppClick', email: 'cliente@example.com' }, null),
    /INVALID_FIELD/,
  );
});

test('assina exatamente timestamp, nonce, método, path e hash do corpo encaminhado', async () => {
  const signed = await buildSignedCrmRequest({
    body: { event_name: 'WhatsAppClick', event_id: EVENT_ID },
    origin: SITE_ORIGIN,
    siteKeyId: 'site-key-id',
    secret: SECRET,
    nowMs: 1_787_929_200_000,
    nonce: 'nonce_1234567890abcdef',
  });
  const bodyHash = await sha256Hex(signed.rawBody);
  const canonical = [
    '1787929200',
    'nonce_1234567890abcdef',
    'POST',
    CRM_INTAKE_PATH,
    'site-key-id',
    SITE_ORIGIN,
    bodyHash,
  ].join('\n');

  assert.equal(signed.headers.get('x-marketing-signature'), await hmacSha256Hex(SECRET, canonical));
  assert.equal(signed.headers.get('x-marketing-origin'), SITE_ORIGIN);
});

test('encaminha clique, não envia IP e expõe somente referência pública mínima', async () => {
  let forwarded: { url: string; init: RequestInit } | null = null;
  const response = await handleMarketingBridgeRequest(
    browserRequest({ event_name: 'WhatsAppClick', event_id: EVENT_ID, consent_status: 'granted' }),
    fakeEnv(),
    {
      nowMs: () => 1_787_929_200_000,
      nonce: () => 'nonce_1234567890abcdef',
      fetch: async (target, init) => {
        if (String(target).includes('/turnstile/')) return turnstileSuccess();
        forwarded = { url: String(target), init: init || {} };
        return Response.json({
          status: 'created',
          event_id: EVENT_ID,
          lead_id: '35e875e8-619b-4a2b-9491-d0ca9181249b',
          bridge_ref: 'gp_a1b2c3d4e5f6',
        });
      },
    },
  );
  const body = await response.json() as Record<string, unknown>;
  const forwardedBody = JSON.parse(String(forwarded?.init.body));

  assert.equal(response.status, 200);
  assert.deepEqual(body, { status: 'registered', event_id: EVENT_ID, bridge_ref: 'gp_a1b2c3d4e5f6' });
  assert.equal(forwarded?.url, CRM_URL);
  assert.equal(forwarded?.init.redirect, 'manual');
  assert.equal(forwardedBody.client_user_agent, 'Studio Browser/1.0');
  assert.equal('ip' in forwardedBody, false);
  assert.equal('lead_id' in body, false);
});

test('encaminha PageView com journey_id e não expõe bridge_ref', async () => {
  let forwardedBody: Record<string, unknown> | null = null;
  const response = await handleMarketingBridgeRequest(
    browserRequest({
      event_name: 'PageView',
      event_id: EVENT_ID,
      journey_id: '35e875e8-619b-4a2b-9491-d0ca9181249b',
      analytics_storage: 'granted',
      cta_id: '__page_view__',
      cta_location: 'page',
    }),
    fakeEnv(),
    {
      fetch: async (target, init) => {
        if (String(target).includes('/turnstile/')) return turnstileSuccess('page_view');
        forwardedBody = JSON.parse(String(init?.body));
        return Response.json({ status: 'created', event_id: EVENT_ID });
      },
    },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'registered', event_id: EVENT_ID });
  assert.equal(forwardedBody?.event_name, 'PageView');
  assert.equal(forwardedBody?.journey_id, '35e875e8-619b-4a2b-9491-d0ca9181249b');
});

test('encaminha retirada de consentimento sem click IDs, PII ou user agent', async () => {
  let forwardedBody: Record<string, unknown> | null = null;
  const response = await handleMarketingBridgeRequest(
    browserRequest({
      event_name: 'ConsentUpdate',
      event_id: EVENT_ID,
      occurred_at: '2026-08-28T15:00:00.000Z',
      bridge_reference: 'gp_a1b2c3d4e5f6',
      analytics_storage: 'denied',
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
    }),
    fakeEnv(),
    {
      fetch: async (target, init) => {
        if (String(target).includes('/turnstile/')) return turnstileSuccess('consent_update');
        forwardedBody = JSON.parse(String(init?.body));
        return Response.json({ status: 'created', event_id: EVENT_ID });
      },
    },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'registered', event_id: EVENT_ID });
  assert.equal(forwardedBody?.event_name, 'ConsentUpdate');
  assert.equal('client_user_agent' in (forwardedBody || {}), false);
  assert.equal('gclid' in (forwardedBody || {}), false);
});

test('cancela o body do upstream quando o CRM devolve non-2xx', async () => {
  let cancelled = false;
  const response = await handleMarketingBridgeRequest(
    browserRequest({ event_name: 'WhatsAppClick', event_id: EVENT_ID }),
    fakeEnv(),
    {
      fetch: async target => {
        if (String(target).includes('/turnstile/')) return turnstileSuccess();
        return new Response(new ReadableStream({
          cancel() {
            cancelled = true;
          },
        }), { status: 500 });
      },
    },
  );

  assert.equal(response.status, 502);
  assert.equal(cancelled, true);
});

test('rejeita outra origem e excesso de requisições sem chamar o CRM', async () => {
  let calls = 0;
  const dependency = { fetch: async (target: RequestInfo | URL) => {
    if (String(target).includes('/turnstile/')) return turnstileSuccess();
    calls += 1;
    return Response.json({});
  } };
  const wrongOrigin = await handleMarketingBridgeRequest(
    browserRequest({ event_name: 'WhatsAppClick' }, { origin: 'https://evil.example' }),
    fakeEnv(),
    dependency,
  );
  const rateLimited = await handleMarketingBridgeRequest(
    browserRequest({ event_name: 'WhatsAppClick' }),
    fakeEnv(false),
    dependency,
  );

  assert.equal(wrongOrigin.status, 403);
  assert.equal(rateLimited.status, 429);
  assert.equal(calls, 0);
});

test('rejeita token Turnstile ausente, inválido ou emitido para outro domínio', async () => {
  let crmCalls = 0;
  const missingTokenRequest = new Request(
    'https://events.gipitorifotografias.com.br/v1/whatsapp-click',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: SITE_ORIGIN },
      body: JSON.stringify({ event_name: 'WhatsAppClick', event_id: EVENT_ID }),
    },
  );
  const missing = await handleMarketingBridgeRequest(missingTokenRequest, fakeEnv(), {
    fetch: async () => { crmCalls += 1; return Response.json({}); },
  });
  const wrongHost = await handleMarketingBridgeRequest(
    browserRequest({ event_name: 'WhatsAppClick', event_id: EVENT_ID }),
    fakeEnv(),
    {
      fetch: async (target) => {
        if (String(target).includes('/turnstile/')) {
          return Response.json({ success: true, hostname: 'evil.example', action: 'whatsapp_click' });
        }
        crmCalls += 1;
        return Response.json({});
      },
    },
  );

  assert.equal(missing.status, 403);
  assert.equal(wrongHost.status, 403);
  assert.equal(crmCalls, 0);
});

test('interrompe corpo chunked acima de 16 KB antes de chamar serviços externos', async () => {
  let fetchCalls = 0;
  const oversized = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"turnstile_token":"ok","padding":"'));
      controller.enqueue(new Uint8Array(17 * 1024).fill(97));
      controller.close();
    },
  });
  const request = new Request(
    'https://events.gipitorifotografias.com.br/v1/whatsapp-click',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: SITE_ORIGIN },
      body: oversized,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' },
  );
  const response = await handleMarketingBridgeRequest(request, fakeEnv(), {
    fetch: async () => { fetchCalls += 1; return Response.json({}); },
  });

  assert.equal(response.status, 413);
  assert.equal(fetchCalls, 0);
});

test('aborta subrequest travado dentro do prazo configurado', async () => {
  const response = await handleMarketingBridgeRequest(
    browserRequest({ event_name: 'WhatsAppClick', event_id: EVENT_ID }),
    fakeEnv(),
    {
      timeoutMs: 5,
      fetch: async (_target, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      }),
    },
  );

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'BOT_VERIFICATION_UNAVAILABLE' });
});

test('health check não revela configuração nem aceita cache', async () => {
  const response = await handleMarketingBridgeRequest(
    new Request('https://events.gipitorifotografias.com.br/health'),
    fakeEnv(),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ready' });
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('bridge desativado recusa inclusive health sem chamar dependências', async () => {
  const disabledEnv = { ...fakeEnv(), BRIDGE_ENABLED: 'false' } as Env;
  const response = await handleMarketingBridgeRequest(
    new Request('https://events.gipitorifotografias.com.br/health'),
    disabledEnv,
  );
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { status: 'disabled' });
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('health check falha fechado quando segredo ou destino não estão prontos', async () => {
  const invalidEnv = { ...fakeEnv(), MARKETING_SITE_SIGNING_SECRET: 'short' } as Env;
  const response = await handleMarketingBridgeRequest(
    new Request('https://events.gipitorifotografias.com.br/health'),
    invalidEnv,
  );
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'INVALID_CONFIGURATION' });
});

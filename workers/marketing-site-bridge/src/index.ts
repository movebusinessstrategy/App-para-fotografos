import {
  MAX_BROWSER_BODY_BYTES,
  MarketingBridgeError,
  PUBLIC_BRIDGE_PATH,
  assertSigningConfiguration,
  browserEventName,
  buildSignedCrmRequest,
  normalizeSiteOrigin,
  privacySafeRateKey,
  publicSuccessPayload,
  requireTurnstileToken,
  sanitizeBrowserPayload,
  validateCrmIntakeUrl,
} from './core.js';

type BridgeDependencies = {
  fetch: typeof fetch;
  nowMs?: () => number;
  nonce?: () => string;
  timeoutMs?: number;
};

const DEFAULT_DEPENDENCIES: BridgeDependencies = { fetch };
const TURNSTILE_SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const TURNSTILE_ACTIONS = {
  WhatsAppClick: 'whatsapp_click',
  PageView: 'page_view',
  SiteClick: 'site_click',
  ConsentUpdate: 'consent_update',
} as const;
const UPSTREAM_TIMEOUT_MS = 10_000;
const MAX_UPSTREAM_BODY_BYTES = 16 * 1024;

function securityHeaders(): HeadersInit {
  return {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
  };
}

function corsHeaders(origin: string): HeadersInit {
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '600',
    vary: 'Origin',
  };
}

function jsonResponse(body: unknown, status: number, origin?: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...securityHeaders(), ...(origin ? corsHeaders(origin) : {}) },
  });
}

function errorResponse(error: unknown, origin?: string): Response {
  if (error instanceof MarketingBridgeError) {
    return jsonResponse({ error: error.code }, error.statusCode, origin);
  }
  return jsonResponse({ error: 'BRIDGE_UNAVAILABLE' }, 503, origin);
}

function requestOrigin(request: Request, configuredOrigin: string): string {
  const origin = request.headers.get('origin') || '';
  if (origin !== configuredOrigin) throw new MarketingBridgeError('ORIGIN_NOT_ALLOWED', 403);
  return origin;
}

function validateRuntimeConfiguration(env: Env): string {
  const origin = normalizeSiteOrigin(env.SITE_ORIGIN);
  validateCrmIntakeUrl(env.CRM_INGEST_URL);
  assertSigningConfiguration(env.MARKETING_SITE_KEY_ID, env.MARKETING_SITE_SIGNING_SECRET);
  if (!env.TURNSTILE_SECRET_KEY?.trim()) {
    throw new MarketingBridgeError('INVALID_CONFIGURATION', 503);
  }
  if (!env.MARKETING_BRIDGE_RATE_LIMITER?.limit) {
    throw new MarketingBridgeError('INVALID_CONFIGURATION', 503);
  }
  return origin;
}

type TurnstileResult = {
  success?: boolean;
  hostname?: string;
  action?: string;
};

async function boundedStreamText(
  stream: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<string> {
  if (!stream) return '';
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new MarketingBridgeError('BODY_TOO_LARGE', 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(joined);
}

async function boundedJsonResponse(
  fetcher: typeof fetch,
  target: RequestInfo | URL,
  init: RequestInit,
  timeoutMs = UPSTREAM_TIMEOUT_MS,
): Promise<{ response: Response; body: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(target, { ...init, signal: controller.signal });
    if (!response.ok) {
      try {
        await response.body?.cancel();
      } catch {
        // A resposta já será descartada; falha ao cancelar não altera o erro original.
      }
      return { response, body: null };
    }
    const text = await boundedStreamText(response.body, MAX_UPSTREAM_BODY_BYTES);
    return { response, body: text ? JSON.parse(text) : null };
  } finally {
    clearTimeout(timer);
  }
}

async function verifyTurnstile(
  rawBody: unknown,
  env: Env,
  dependencies: BridgeDependencies,
  origin: string,
  expectedAction: string,
): Promise<void> {
  const token = requireTurnstileToken(rawBody);
  let result: { response: Response; body: unknown };
  try {
    result = await boundedJsonResponse(dependencies.fetch, TURNSTILE_SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        secret: env.TURNSTILE_SECRET_KEY,
        response: token,
        idempotency_key: crypto.randomUUID(),
      }),
    }, dependencies.timeoutMs);
  } catch {
    throw new MarketingBridgeError('BOT_VERIFICATION_UNAVAILABLE', 503);
  }
  if (!result.response.ok) throw new MarketingBridgeError('BOT_VERIFICATION_UNAVAILABLE', 503);
  const verification = result.body as TurnstileResult;
  const expectedHostname = new URL(origin).hostname;
  if (!verification?.success
      || verification.hostname !== expectedHostname
      || verification.action !== expectedAction) {
    throw new MarketingBridgeError('BOT_VERIFICATION_FAILED', 403);
  }
}

function ensureJsonRequest(request: Request): void {
  const contentType = request.headers.get('content-type') || '';
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
    throw new MarketingBridgeError('UNSUPPORTED_MEDIA_TYPE', 415);
  }
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_BROWSER_BODY_BYTES) {
    throw new MarketingBridgeError('BODY_TOO_LARGE', 413);
  }
}

async function parseBrowserBody(request: Request): Promise<unknown> {
  ensureJsonRequest(request);
  let rawBody: string;
  try {
    rawBody = await boundedStreamText(request.body, MAX_BROWSER_BODY_BYTES);
  } catch (error) {
    if (error instanceof MarketingBridgeError) throw error;
    throw new MarketingBridgeError('INVALID_JSON', 400);
  }
  try {
    return JSON.parse(rawBody);
  } catch {
    throw new MarketingBridgeError('INVALID_JSON', 400);
  }
}

async function enforceRateLimit(request: Request, env: Env): Promise<void> {
  const key = await privacySafeRateKey(env.MARKETING_SITE_SIGNING_SECRET, request);
  const result = await env.MARKETING_BRIDGE_RATE_LIMITER.limit({ key });
  if (!result.success) throw new MarketingBridgeError('RATE_LIMITED', 429);
}

async function forwardEvent(
  request: Request,
  env: Env,
  dependencies: BridgeDependencies,
  origin: string,
): Promise<Response> {
  await enforceRateLimit(request, env);
  const browserBody = await parseBrowserBody(request);
  const eventName = browserEventName(browserBody);
  await verifyTurnstile(browserBody, env, dependencies, origin, TURNSTILE_ACTIONS[eventName]);
  const payload = sanitizeBrowserPayload(browserBody, request.headers.get('user-agent'));
  const target = validateCrmIntakeUrl(env.CRM_INGEST_URL);
  const signed = await buildSignedCrmRequest({
    body: payload,
    origin,
    siteKeyId: env.MARKETING_SITE_KEY_ID,
    secret: env.MARKETING_SITE_SIGNING_SECRET,
    nowMs: dependencies.nowMs?.(),
    nonce: dependencies.nonce?.(),
  });
  let upstream: { response: Response; body: unknown };
  try {
    upstream = await boundedJsonResponse(dependencies.fetch, target, {
      method: 'POST',
      headers: signed.headers,
      body: signed.rawBody,
      redirect: 'error',
    }, dependencies.timeoutMs);
  } catch (error) {
    console.warn('[marketing-bridge] crm_intake_unavailable', {
      reason: error instanceof Error ? error.name : 'unknown',
    });
    throw new MarketingBridgeError('CRM_INTAKE_REJECTED', 502);
  }
  if (!upstream.response.ok) {
    console.warn('[marketing-bridge] crm_intake_rejected', {
      status: upstream.response.status,
    });
    const status = upstream.response.status >= 500 ? 502 : 400;
    throw new MarketingBridgeError('CRM_INTAKE_REJECTED', status);
  }
  return jsonResponse(publicSuccessPayload(upstream.body, eventName), 200, origin);
}

function optionsResponse(request: Request, origin: string): Response {
  const requestedMethod = request.headers.get('access-control-request-method');
  if (requestedMethod !== 'POST') throw new MarketingBridgeError('METHOD_NOT_ALLOWED', 405);
  return new Response(null, { status: 204, headers: { ...securityHeaders(), ...corsHeaders(origin) } });
}

export async function handleMarketingBridgeRequest(
  request: Request,
  env: Env,
  dependencies: BridgeDependencies = DEFAULT_DEPENDENCIES,
): Promise<Response> {
  let origin: string | undefined;
  try {
    const url = new URL(request.url);
    if (String(env.BRIDGE_ENABLED) !== 'true') {
      return jsonResponse({ status: 'disabled' }, 503);
    }
    const configuredOrigin = validateRuntimeConfiguration(env);
    if (url.pathname === '/health' && request.method === 'GET') {
      return jsonResponse({ status: 'ready' }, 200);
    }
    if (url.pathname !== PUBLIC_BRIDGE_PATH) {
      throw new MarketingBridgeError('NOT_FOUND', 404);
    }
    origin = requestOrigin(request, configuredOrigin);
    if (request.method === 'OPTIONS') return optionsResponse(request, origin);
    if (request.method !== 'POST') throw new MarketingBridgeError('METHOD_NOT_ALLOWED', 405);
    return await forwardEvent(request, env, dependencies, origin);
  } catch (error) {
    return errorResponse(error, origin);
  }
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleMarketingBridgeRequest(request, env);
  },
} satisfies ExportedHandler<Env>;

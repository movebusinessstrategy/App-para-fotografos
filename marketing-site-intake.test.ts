import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MARKETING_SITE_MAX_BODY_BYTES,
  MarketingSiteIntakeError,
  buildMarketingSiteSignaturePayload,
  createMarketingBridgeReference,
  deriveMarketingBridgeReference,
  hashMarketingBridgeReference,
  prepareMarketingSiteIntake,
  prepareMarketingSiteConsentUpdate,
  signMarketingSiteRequest,
  verifyMarketingSiteRequest,
} from './lib/marketing-site-intake.js';

const SECRET = 'studio-site-hmac-secret-with-32-bytes-minimum';
const USER_ID = '56dd4834-ed5e-42b6-9a79-dc896a9a756f';
const EVENT_ID = '2f1c13a7-b441-40a9-a46c-86f9e65fe7e0';
const LEAD_ID = '35e875e8-619b-4a2b-9491-d0ca9181249b';
const NOW = Date.UTC(2026, 7, 28, 15, 0, 0);
const TIMESTAMP = String(Math.floor(NOW / 1_000));
const NONCE = 'nonce_1234567890abcdef';
const PATH = '/api/public/marketing/site-intake';
const SITE_KEY = 'studio-site-v1';
const SITE_ORIGIN = 'https://www.gipitorifotografias.com.br';
const BRIDGE_REFERENCE_SECRET = 'stable-bridge-reference-secret-with-32-bytes';

function signedInput(body: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
  const rawBody = JSON.stringify(body);
  const signingInput = {
    rawBody,
    timestamp: TIMESTAMP,
    nonce: NONCE,
    method: 'POST',
    path: PATH,
    siteKeyId: SITE_KEY,
    origin: SITE_ORIGIN,
    ...overrides,
  };
  return {
    ...signingInput,
    signature: signMarketingSiteRequest(SECRET, signingInput),
    secret: SECRET,
    bridgeReferenceSecret: BRIDGE_REFERENCE_SECRET,
    userId: USER_ID,
    now: NOW,
  };
}

function fixedIds() {
  const ids = [EVENT_ID, LEAD_ID];
  return () => ids.shift() || LEAD_ID;
}

function errorCode(error: unknown, code: string): boolean {
  return error instanceof MarketingSiteIntakeError && error.code === code;
}

test('assina timestamp, nonce, método, path, site key, origin e hash exato do raw body', () => {
  const rawBody = '{"event_name":"WhatsAppClick"}';
  const payload = buildMarketingSiteSignaturePayload({
    rawBody,
    timestamp: TIMESTAMP,
    nonce: NONCE,
    method: 'post',
    path: `${PATH}?ignored=1`,
    siteKeyId: SITE_KEY,
    origin: SITE_ORIGIN,
  });
  const parts = payload.split('\n');

  assert.equal(parts.length, 7);
  assert.deepEqual(parts.slice(0, 4), [TIMESTAMP, NONCE, 'POST', PATH]);
  assert.deepEqual(parts.slice(4, 6), [SITE_KEY, SITE_ORIGIN]);
  assert.match(parts[6], /^[0-9a-f]{64}$/);
});

test('verifica HMAC em tempo constante e não devolve assinatura ou segredo', () => {
  const input = signedInput({ event_name: 'WhatsAppClick' });
  const verified = verifyMarketingSiteRequest(input);

  assert.equal(verified.method, 'POST');
  assert.equal(verified.path, PATH);
  assert.equal(verified.site_key_id, SITE_KEY);
  assert.equal(verified.origin, SITE_ORIGIN);
  assert.equal(verified.signed_at, new Date(NOW).toISOString());
  assert.match(verified.nonce_hash, /^[0-9a-f]{64}$/);
  assert.equal('signature' in verified, false);
  assert.equal('secret' in verified, false);
});

test('rejeita corpo adulterado, assinatura malformada e timestamp fora de cinco minutos', () => {
  const input = signedInput({ event_name: 'WhatsAppClick' });
  assert.throws(
    () => verifyMarketingSiteRequest({ ...input, rawBody: '{"event_name":"Outro"}' }),
    error => errorCode(error, 'INVALID_SIGNATURE'),
  );
  assert.throws(
    () => verifyMarketingSiteRequest({ ...input, signature: 'curta' }),
    error => errorCode(error, 'INVALID_SIGNATURE'),
  );
  assert.throws(
    () => verifyMarketingSiteRequest({ ...input, now: NOW + 300_001 }),
    error => errorCode(error, 'INVALID_TIMESTAMP'),
  );
  assert.throws(
    () => verifyMarketingSiteRequest({ ...input, siteKeyId: 'outro-site' }),
    error => errorCode(error, 'INVALID_SIGNATURE'),
  );
  assert.throws(
    () => verifyMarketingSiteRequest({ ...input, origin: 'https://outro.example' }),
    error => errorCode(error, 'INVALID_SIGNATURE'),
  );
});

test('prepara WhatsAppClick com UUIDs, origem do tenant e bridge_ref curto', () => {
  const input = signedInput({
    event_name: 'WhatsAppClick',
    consent_status: 'granted',
    analytics_storage: 'granted',
    ad_storage: 'granted',
    ad_user_data: 'granted',
    ad_personalization: 'denied',
    source_url: 'https://www.gipitorifotografias.com.br/ensaio-de-gestante1?gclid=secret#cta',
    page_path: '/ensaio-de-gestante1?origin=google',
    gclid: 'google-click-1',
    fbclid: 'meta-click-1',
    utm_source: ' google ',
    utm_medium: ' cpc ',
    campaign_id: '21125216764',
    ga_client_id: '12345.67890',
    ga_session_id: '1787941800',
    client_user_agent: 'Mozilla/5.0 Studio Browser',
    cta_id: ' hero-whatsapp ',
  });
  const prepared = prepareMarketingSiteIntake({
    ...input,
    uuidFactory: fixedIds(),
    randomBytesFactory: () => Buffer.alloc(9, 7),
  });

  assert.equal(prepared.event.event_id, EVENT_ID);
  assert.equal(prepared.event.lead_id, LEAD_ID);
  assert.equal(prepared.touchpoint.user_id, USER_ID);
  assert.equal(prepared.touchpoint.source_url, 'https://www.gipitorifotografias.com.br/ensaio-de-gestante1');
  assert.equal(prepared.event.page_path, '/ensaio-de-gestante1');
  assert.equal(prepared.event.utm_source, 'google');
  assert.equal(prepared.touchpoint.campaign_external_id, '21125216764');
  assert.equal(prepared.touchpoint.ga_client_id, '12345.67890');
  assert.equal(prepared.touchpoint.ga_session_id, '1787941800');
  assert.equal(prepared.touchpoint.client_user_agent, 'Mozilla/5.0 Studio Browser');
  assert.equal(prepared.touchpoint.consent_snapshot.ad_personalization, 'denied');
  assert.match(prepared.response.bridge_ref, /^gp_[A-Za-z0-9_-]{12}$/);
  assert.equal(
    prepared.touchpoint.bridge_reference_hash,
    hashMarketingBridgeReference(prepared.response.bridge_ref),
  );
  assert.equal('bridge_ref' in prepared.touchpoint.metadata, false);
});

test('preserva event_id UUID do navegador para deduplicação com o Pixel', () => {
  const input = signedInput({ event_name: 'WhatsAppClick', event_id: EVENT_ID });
  const prepared = prepareMarketingSiteIntake({
    ...input,
    uuidFactory: () => LEAD_ID,
    randomBytesFactory: () => Buffer.alloc(9, 1),
  });

  assert.equal(prepared.event.event_id, EVENT_ID);
  assert.equal(prepared.response.event_id, EVENT_ID);
  assert.equal(prepared.touchpoint.external_event_id, EVENT_ID);
  assert.equal(prepared.response.lead_id, LEAD_ID);
});

test('bridge_ref usa pepper estável independente do segredo HMAC rotacionável', () => {
  const first = deriveMarketingBridgeReference(BRIDGE_REFERENCE_SECRET, EVENT_ID);
  const retry = deriveMarketingBridgeReference(BRIDGE_REFERENCE_SECRET, EVENT_ID);
  const another = deriveMarketingBridgeReference(BRIDGE_REFERENCE_SECRET, LEAD_ID);

  assert.deepEqual(first, retry);
  assert.notEqual(first.bridge_ref, another.bridge_ref);
  assert.equal(first.bridge_ref, first.bridge_ref.toLowerCase());
});

test('aceita retirada granular de consentimento ligada somente à referência opaca', () => {
  const bridge = deriveMarketingBridgeReference(BRIDGE_REFERENCE_SECRET, EVENT_ID);
  const input = signedInput({
    event_name: 'ConsentUpdate',
    event_id: LEAD_ID,
    occurred_at: new Date(NOW).toISOString(),
    bridge_reference: bridge.bridge_ref,
    analytics_storage: 'denied',
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
  });
  const prepared = prepareMarketingSiteConsentUpdate(input);

  assert.equal(prepared.event.event_name, 'ConsentUpdate');
  assert.equal(prepared.event.event_id, LEAD_ID);
  assert.equal(prepared.event.bridge_reference_hash, bridge.bridge_ref_hash);
  assert.deepEqual(prepared.event.consent_snapshot, {
    analytics_storage: 'denied',
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
  });
  assert.equal('bridge_reference' in prepared.event, false);
});

test('rejeita ConsentUpdate sem bridge_reference ou com identificadores de anúncio', () => {
  const base = {
    event_name: 'ConsentUpdate',
    event_id: LEAD_ID,
    occurred_at: new Date(NOW).toISOString(),
    analytics_storage: 'denied',
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
  };
  assert.throws(
    () => prepareMarketingSiteConsentUpdate(signedInput(base)),
    error => errorCode(error, 'INVALID_FIELD'),
  );
  assert.throws(
    () => prepareMarketingSiteConsentUpdate(signedInput({
      ...base,
      bridge_reference: deriveMarketingBridgeReference(BRIDGE_REFERENCE_SECRET, EVENT_ID).bridge_ref,
      gclid: 'not-allowed',
    })),
    error => errorCode(error, 'INVALID_FIELD'),
  );
});

test('sem consentimento concedido elimina click IDs e identificadores GA', () => {
  for (const consent_status of ['denied', 'unknown'] as const) {
    const body = {
      event_name: 'WhatsAppClick',
      consent_status,
      gclid: 'g-1',
      gbraid: 'gb-1',
      wbraid: 'wb-1',
      fbclid: 'fb-1',
      fbc: 'fb.1.1.click',
      fbp: 'fb.1.1.browser',
      utm_source: 'google',
      ga_client_id: '12345.67890',
      ga_session_id: '1787941800',
      client_user_agent: 'Mozilla/5.0 must-be-dropped',
    };
    const prepared = prepareMarketingSiteIntake({
      ...signedInput(body),
      uuidFactory: fixedIds(),
      randomBytesFactory: () => Buffer.alloc(9, 2),
    });

    assert.deepEqual(
      [prepared.event.gclid, prepared.event.gbraid, prepared.event.wbraid, prepared.event.fbclid, prepared.event.fbc, prepared.event.fbp],
      [null, null, null, null, null, null],
    );
    assert.equal(prepared.touchpoint.utm_source, 'google');
    assert.equal(prepared.touchpoint.consent_status, consent_status);
    assert.equal(prepared.touchpoint.ga_client_id, null);
    assert.equal(prepared.touchpoint.ga_session_id, null);
    assert.equal(prepared.touchpoint.client_user_agent, null);
  }
});

test('consentimento granular não mistura analytics com publicidade', () => {
  const body = {
    event_name: 'WhatsAppClick',
    analytics_storage: 'granted',
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    gclid: 'must-be-dropped',
    ga_client_id: '12345.67890',
    ga_session_id: '1787941800',
  };
  const prepared = prepareMarketingSiteIntake({
    ...signedInput(body),
    uuidFactory: fixedIds(),
    randomBytesFactory: () => Buffer.alloc(9, 3),
  });

  assert.equal(prepared.event.gclid, null);
  assert.equal(prepared.event.ga_client_id, '12345.67890');
  assert.equal(prepared.touchpoint.consent_status, 'denied');
  assert.equal(prepared.touchpoint.consent_snapshot.analytics_storage, 'granted');
});

test('granted genérico nunca concede sinais granulares ausentes', () => {
  const prepared = prepareMarketingSiteIntake({
    ...signedInput({
      event_name: 'WhatsAppClick',
      consent_status: 'granted',
      gclid: 'must-be-dropped',
      ga_client_id: 'must-be-dropped',
      client_user_agent: 'must-be-dropped',
    }),
    uuidFactory: fixedIds(),
    randomBytesFactory: () => Buffer.alloc(9, 4),
  });

  assert.equal(prepared.touchpoint.consent_snapshot.analytics_storage, 'unknown');
  assert.equal(prepared.touchpoint.consent_snapshot.ad_storage, 'unknown');
  assert.equal(prepared.touchpoint.consent_snapshot.ad_user_data, 'unknown');
  assert.equal(prepared.touchpoint.consent_snapshot.ad_personalization, 'unknown');
  assert.equal(prepared.touchpoint.consent_status, 'unknown');
  assert.equal(prepared.touchpoint.gclid, null);
  assert.equal(prepared.touchpoint.ga_client_id, null);
  assert.equal(prepared.touchpoint.client_user_agent, null);
});

test('user_id e lead_id nunca são aceitos no corpo público', () => {
  for (const forbidden of ['user_id', 'userId', 'lead_id', 'leadId']) {
    const input = signedInput({ event_name: 'WhatsAppClick', [forbidden]: USER_ID });
    assert.throws(
      () => prepareMarketingSiteIntake(input),
      error => errorCode(error, 'PII_NOT_ALLOWED'),
    );
  }
});

test('rejeita PII, metadados sensíveis e nomes de evento diferentes', () => {
  const cases = [
    [{ event_name: 'WhatsAppClick', email: 'cliente@example.com' }, 'PII_NOT_ALLOWED'],
    [{ event_name: 'WhatsAppClick', nested: { phone: '43999990000' } }, 'PII_NOT_ALLOWED'],
    [{ event_name: 'WhatsAppClick', campaign_name: 'Gestante Londrina' }, 'SENSITIVE_FIELD_NOT_ALLOWED'],
    [{ event_name: 'Gestante_LOCAL' }, 'INVALID_EVENT'],
    [{ event_name: 'Contact' }, 'INVALID_EVENT'],
  ] as const;

  for (const [body, code] of cases) {
    assert.throws(
      () => prepareMarketingSiteIntake(signedInput(body as Record<string, unknown>)),
      error => errorCode(error, code),
    );
  }
});

test('rejeita e-mail escondido em UTM, UUID inválido e campo desconhecido', () => {
  const cases = [
    [{ event_name: 'WhatsAppClick', utm_content: 'cliente@example.com' }, 'PII_NOT_ALLOWED'],
    [{ event_name: 'WhatsAppClick', event_id: 'not-a-uuid' }, 'INVALID_FIELD'],
    [{ event_name: 'WhatsAppClick', arbitrary: 'value' }, 'INVALID_FIELD'],
  ] as const;

  for (const [body, code] of cases) {
    assert.throws(
      () => prepareMarketingSiteIntake(signedInput(body as Record<string, unknown>)),
      error => errorCode(error, code),
    );
  }
});

test('aplica limites de corpo, nonce, segredo e bridge_ref', () => {
  const oversized = 'x'.repeat(MARKETING_SITE_MAX_BODY_BYTES + 1);
  assert.throws(
    () => signMarketingSiteRequest(SECRET, {
      rawBody: oversized,
      timestamp: TIMESTAMP,
      nonce: NONCE,
      method: 'POST',
      path: PATH,
      siteKeyId: SITE_KEY,
      origin: SITE_ORIGIN,
    }),
    error => errorCode(error, 'BODY_TOO_LARGE'),
  );
  assert.throws(
    () => signMarketingSiteRequest('short', {
      rawBody: '{}',
      timestamp: TIMESTAMP,
      nonce: NONCE,
      method: 'POST',
      path: PATH,
      siteKeyId: SITE_KEY,
      origin: SITE_ORIGIN,
    }),
    error => errorCode(error, 'INVALID_CONFIGURATION'),
  );
  assert.throws(
    () => signMarketingSiteRequest(SECRET, {
      rawBody: '{}',
      timestamp: TIMESTAMP,
      nonce: 'short',
      method: 'POST',
      path: PATH,
      siteKeyId: SITE_KEY,
      origin: SITE_ORIGIN,
    }),
    error => errorCode(error, 'INVALID_SIGNATURE'),
  );
  assert.throws(
    () => createMarketingBridgeReference(() => Buffer.alloc(8)),
    error => errorCode(error, 'INVALID_CONFIGURATION'),
  );
});

test('não aceita outro método mesmo com assinatura válida', () => {
  const input = signedInput({ event_name: 'WhatsAppClick' }, { method: 'GET' });
  assert.throws(
    () => prepareMarketingSiteIntake(input),
    error => errorCode(error, 'INVALID_SIGNATURE'),
  );
});

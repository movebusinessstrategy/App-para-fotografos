import assert from 'node:assert/strict';
import test from 'node:test';
import {
  registerMarketingSiteClick,
  registerMarketingSiteEvent,
} from './lib/marketing-site-route.js';
import {
  deriveMarketingBridgeReference,
  signMarketingSiteRequest,
} from './lib/marketing-site-intake.js';

const SITE_KEY = 'studio-site-v1';
const SECRET = 'studio-site-hmac-secret-with-32-bytes-minimum';
const ROTATED_SECRET = 'rotated-site-hmac-secret-with-32-bytes-minimum';
const BRIDGE_REFERENCE_SECRET = 'stable-bridge-reference-secret-with-32-bytes';
const USER_ID = '56dd4834-ed5e-42b6-9a79-dc896a9a756f';
const PATH = '/api/public/marketing/site-intake';
const ORIGIN = 'https://www.gipitorifotografias.com.br';

function fakeDb(rpcStatus = 'created', ciphertext = 'enc:v1:a:b:c') {
  const calls: any[] = [];
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    limit: async () => ({
      data: [{
        id: '447fbb19-c00e-41b2-aa14-d7559d778e8a',
        user_id: USER_ID,
        site_key_id: SITE_KEY,
        signing_secret_ciphertext: ciphertext,
        enabled: true,
      }],
      error: null,
    }),
  };
  return {
    calls,
    db: {
      from: () => chain,
      rpc: async (name: string, args: any) => {
        calls.push({ name, args });
        const payload = args.p_touchpoint || args.p_update || {};
        return {
          data: [{
            result_status: rpcStatus,
            lead_id: payload.lead_id,
            event_id: payload.event_id,
          }],
          error: null,
        };
      },
    } as any,
  };
}

function signedBodyRequest(body: Record<string, unknown>, signingSecret = SECRET) {
  const rawBody = Buffer.from(JSON.stringify(body));
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = 'nonce_1234567890abcdef';
  const signature = signMarketingSiteRequest(signingSecret, {
    rawBody,
    timestamp,
    nonce,
    method: 'POST',
    path: PATH,
    siteKeyId: SITE_KEY,
    origin: ORIGIN,
  });
  return {
    rawBody, timestamp, nonce, signature,
    method: 'POST', path: PATH,
    origin: ORIGIN,
    siteKeyId: SITE_KEY,
  };
}

function signedRequest(
  eventId = '2f1c13a7-b441-40a9-a46c-86f9e65fe7e0',
  signingSecret = SECRET,
) {
  return signedBodyRequest({
    event_name: 'WhatsAppClick',
    event_id: eventId,
    analytics_storage: 'granted',
    ad_storage: 'granted',
    ad_user_data: 'granted',
    ad_personalization: 'denied',
    gclid: 'click-1',
    ga_client_id: '12345.67890',
    ga_session_id: '1787941800',
  }, signingSecret);
}

test('deriva tenant do site e registra o clique por RPC atômica', async () => {
  const fake = fakeDb();
  const result = await registerMarketingSiteClick({
    db: fake.db,
    decryptSecret: () => SECRET,
    bridgeReferenceSecret: BRIDGE_REFERENCE_SECRET,
  }, signedRequest());

  assert.equal(result.accepted, true);
  assert.equal(result.status, 'created');
  assert.match(result.bridge_ref, /^gp_[a-z0-9_-]{12}$/);
  assert.equal(fake.calls[0].name, 'register_marketing_site_intake');
  assert.equal(fake.calls[0].args.p_site_key_id, SITE_KEY);
  assert.equal(fake.calls[0].args.p_origin, 'https://www.gipitorifotografias.com.br');
  assert.equal('user_id' in fake.calls[0].args.p_touchpoint, false);
});

test('retry após rotação do segredo HMAC devolve a mesma referência opaca', async () => {
  const eventId = '2f1c13a7-b441-40a9-a46c-86f9e65fe7e0';
  const first = fakeDb('created');
  const retry = fakeDb('duplicate');
  const a = await registerMarketingSiteClick({
    db: first.db,
    decryptSecret: () => SECRET,
    bridgeReferenceSecret: BRIDGE_REFERENCE_SECRET,
  }, signedRequest(eventId, SECRET));
  const b = await registerMarketingSiteClick({
    db: retry.db,
    decryptSecret: () => ROTATED_SECRET,
    bridgeReferenceSecret: BRIDGE_REFERENCE_SECRET,
  }, signedRequest(eventId, ROTATED_SECRET));

  assert.equal(a.bridge_ref, b.bridge_ref);
  assert.equal(b.status, 'duplicate');
});

test('não aceita origin inválida antes de gravar', async () => {
  const fake = fakeDb();
  await assert.rejects(
    () => registerMarketingSiteClick({
      db: fake.db,
      decryptSecret: () => SECRET,
      bridgeReferenceSecret: BRIDGE_REFERENCE_SECRET,
    }, {
      ...signedRequest(), origin: 'javascript:alert(1)',
    }),
    /Origin inválida/,
  );
  assert.equal(fake.calls.length, 0);
});

test('bloqueia segredo plaintext antes de descriptografar ou gravar', async () => {
  const fake = fakeDb('created', 'plaintext-secret');
  let decryptCalls = 0;
  await assert.rejects(
    () => registerMarketingSiteClick({
      db: fake.db,
      bridgeReferenceSecret: BRIDGE_REFERENCE_SECRET,
      decryptSecret: () => {
        decryptCalls += 1;
        return SECRET;
      },
    }, signedRequest()),
    /Ponte de mensuração indisponível/,
  );
  assert.equal(decryptCalls, 0);
  assert.equal(fake.calls.length, 0);
});

test('assinatura não pode ser reaproveitada com outra origin', async () => {
  const fake = fakeDb();
  await assert.rejects(
    () => registerMarketingSiteClick({
      db: fake.db,
      decryptSecret: () => SECRET,
      bridgeReferenceSecret: BRIDGE_REFERENCE_SECRET,
    }, { ...signedRequest(), origin: 'https://outro.example' }),
    (error: any) => error?.code === 'INVALID_SIGNATURE',
  );
  assert.equal(fake.calls.length, 0);
});

test('WhatsAppClick falha fechado sem pepper estável de bridge_ref', async () => {
  const fake = fakeDb();
  await assert.rejects(
    () => registerMarketingSiteClick({ db: fake.db, decryptSecret: () => SECRET }, signedRequest()),
    (error: any) => error?.code === 'INVALID_CONFIGURATION',
  );
  assert.equal(fake.calls.length, 0);
});

test('ConsentUpdate usa writer separado e nunca encaminha a referência opaca em claro', async () => {
  const fake = fakeDb();
  const writerCalls: unknown[] = [];
  const eventId = '35e875e8-619b-4a2b-9491-d0ca9181249b';
  const bridge = deriveMarketingBridgeReference(BRIDGE_REFERENCE_SECRET, eventId);
  const request = signedBodyRequest({
    event_name: 'ConsentUpdate',
    event_id: '0daed7c2-1b87-4c89-8586-9cefab3176f4',
    occurred_at: new Date().toISOString(),
    bridge_reference: bridge.bridge_ref,
    analytics_storage: 'denied',
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
  });
  const result = await registerMarketingSiteEvent({
    db: fake.db,
    decryptSecret: () => SECRET,
    registerConsentUpdate: async args => {
      writerCalls.push(args);
      return {
        data: [{ result_status: 'created', event_id: args.p_update.event_id }],
        error: null,
      };
    },
  }, request);

  assert.equal(result.event_name, 'ConsentUpdate');
  assert.equal(result.status, 'created');
  assert.equal(writerCalls.length, 1);
  const args = writerCalls[0] as any;
  assert.equal(args.p_update.bridge_reference_hash, bridge.bridge_ref_hash);
  assert.equal(JSON.stringify(args).includes(bridge.bridge_ref), false);
  assert.deepEqual(args.p_update.consent_snapshot, {
    analytics_storage: 'denied',
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
  });
  assert.equal(fake.calls.length, 0);
});

test('ConsentUpdate sem bridge_reference é rejeitado antes do writer', async () => {
  const fake = fakeDb();
  let writerCalls = 0;
  const request = signedBodyRequest({
    event_name: 'ConsentUpdate',
    event_id: '0daed7c2-1b87-4c89-8586-9cefab3176f4',
    occurred_at: new Date().toISOString(),
    analytics_storage: 'denied',
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
  });
  await assert.rejects(
    () => registerMarketingSiteEvent({
      db: fake.db,
      decryptSecret: () => SECRET,
      registerConsentUpdate: async () => {
        writerCalls += 1;
        return { data: null, error: null };
      },
    }, request),
    (error: any) => error?.code === 'INVALID_FIELD',
  );
  assert.equal(writerCalls, 0);
});

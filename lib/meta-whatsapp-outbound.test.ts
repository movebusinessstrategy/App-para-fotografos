import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveWhatsAppOutboundState } from './meta-whatsapp-channel';

function database(userId: string, { preference = 'auto', schema = true, mode = 'coexistence' } = {}) {
  return { from(table: string) {
    let owner = '';
    const query: any = {
      select() { return query; }, limit() { return query; },
      eq(key: string, value: string) { if (key === 'user_id') owner = value; return query; },
      update() { return query; },
      then(resolve: any) { assert.equal(owner, userId); resolve({ data: null, error: null }); },
      async maybeSingle() {
        assert.equal(owner, userId, 'consulta deve ser limitada à conta autenticada');
        if (table === 'whatsapp_business_accounts') return { data: { id: userId, user_id: userId, phone_number_id: userId, phone_number: '5511999990000', access_token: 'test-only-token', mode }, error: null };
        if (!schema) return { data: null, error: { code: '42P01', message: 'relation whatsapp_channel_accounts does not exist' } };
        return { data: { id: userId, preferred_channel: preference, mode, sync_details: {} }, error: null };
      },
    };
    return query;
  } } as any;
}

async function withMeta(status: object | Error, run: (calls: () => number) => Promise<void>) {
  const original = globalThis.fetch;
  let count = 0;
  globalThis.fetch = async (_url, options) => {
    count++;
    assert.ok(options?.signal, 'consulta da Meta deve ter tempo limite');
    if (status instanceof Error) throw status;
    return Response.json(status);
  };
  try { await run(() => count); } finally { globalThis.fetch = original; }
}

test('Meta verificada envia mesmo sem migration 072; consulta real tem cache e não confunde contas', async () => {
  await withMeta({ platform_type: 'CLOUD_API', status: 'CONNECTED', is_on_biz_app: true }, async calls => {
    const db = database('missing-schema', { schema: false });
    const state = await resolveWhatsAppOutboundState(db, 'missing-schema', false, value => value);
    assert.equal(state.migration_ready, false);
    assert.equal(state.selected_channel, 'meta');
    assert.equal(state.meta_operational, true);
    await resolveWhatsAppOutboundState(db, 'missing-schema', false, value => value);
    assert.equal(calls(), 1);
    await resolveWhatsAppOutboundState(database('another-owner', { schema: false }), 'another-owner', false, value => value);
    assert.equal(calls(), 2);
  });
});

test('Meta desconectada não vira operacional por possuir token ou histórico; QR disponível continua utilizável no auto', async () => {
  await withMeta({ platform_type: 'ON_PREMISE', status: 'DISCONNECTED', is_on_biz_app: true }, async () => {
    assert.equal((await resolveWhatsAppOutboundState(database('disconnected'), 'disconnected', false, value => value)).selected_channel, null);
    assert.equal((await resolveWhatsAppOutboundState(database('qr-auto'), 'qr-auto', true, value => value)).selected_channel, 'baileys');
  });
});

test('preferência Meta explícita nunca envia por QR quando Meta falha', async () => {
  await withMeta(new Error('Meta unavailable'), async () => {
    const state = await resolveWhatsAppOutboundState(database('explicit-meta', { preference: 'meta' }), 'explicit-meta', true, value => value);
    assert.equal(state.selected_channel, null);
  });
});

test('preferência QR explícita não chama o Graph', async () => {
  await withMeta(new Error('must not call Meta'), async calls => {
    const state = await resolveWhatsAppOutboundState(database('explicit-qr', { preference: 'baileys' }), 'explicit-qr', true, value => value);
    assert.equal(state.selected_channel, 'baileys');
    assert.equal(calls(), 0);
  });
});

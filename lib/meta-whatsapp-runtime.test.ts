import assert from 'node:assert/strict';
import test from 'node:test';
import { createMetaWebhookRuntime, shouldScheduleReply } from './meta-whatsapp-runtime.js';

type Query = { table: string; op: string; value?: unknown };

// Supabase falso: cada from(table) vira uma cadeia "thenable" que resolve pelo handler.
function fakeDb(handler: (q: Query) => { data?: unknown; error?: unknown }) {
  const calls: Query[] = [];
  const db = {
    from(table: string) {
      const q: Query = { table, op: 'select' };
      const chain: any = {
        select: () => chain,
        insert: (value: unknown) => { q.op = 'insert'; q.value = value; return chain; },
        update: (value: unknown) => { q.op = 'update'; q.value = value; return chain; },
        upsert: (value: unknown) => { q.op = 'upsert'; q.value = value; return chain; },
        eq: () => chain, in: () => chain, limit: () => chain, order: () => chain,
        maybeSingle: () => chain, single: () => chain,
        then: (resolve: any, reject: any) => {
          calls.push({ ...q });
          return Promise.resolve({ data: null, error: null, ...handler(q) }).then(resolve, reject);
        },
      };
      return chain;
    },
  };
  return { db: db as any, calls };
}

const ACCOUNT = {
  id: 'acc-1', user_id: 'tenant-1', waba_id: 'waba-1', phone_number_id: 'phone-1',
  phone_number: '554399990000', access_token: null, mode: 'cloud_api',
};

function inboundPayload(timestampSeconds: number) {
  return {
    object: 'whatsapp_business_account',
    entry: [{
      id: 'waba-1',
      changes: [{
        field: 'messages',
        value: {
          metadata: { phone_number_id: 'phone-1', display_phone_number: '554399990000' },
          contacts: [{ wa_id: '5543988887777', profile: { name: 'Cliente' } }],
          messages: [{ id: 'wamid.teste', from: '5543988887777', timestamp: String(timestampSeconds), type: 'text', text: { body: 'Oi, quero saber o valor' } }],
        },
      }],
    }],
  };
}

function inboxMissingHandler(q: Query) {
  if (q.table === 'whatsapp_business_accounts') return { data: [ACCOUNT] };
  if (q.table === 'whatsapp_webhook_inbox') return { error: { code: '42P01', message: 'relation whatsapp_webhook_inbox does not exist' } };
  if (q.table === 'whatsapp_channel_accounts') return { data: { id: 'ch-1' } };
  if (q.table === 'wa_messages' && q.op === 'select') return { data: [] };
  return {};
}

test('shouldScheduleReply aceita mensagem recente e recusa mensagem velha', () => {
  const now = Date.parse('2026-09-19T15:00:00Z');
  assert.equal(shouldScheduleReply('2026-09-19T14:30:00Z', now), true);
  assert.equal(shouldScheduleReply('2026-09-19T12:00:00Z', now), false);
  assert.equal(shouldScheduleReply('2026-09-19T14:00:00Z', now, 30 * 60 * 1000), false);
  // Sem horário confiável não dá pra julgar: segue o comportamento antigo.
  assert.equal(shouldScheduleReply(null, now), true);
  assert.equal(shouldScheduleReply('lixo', now), true);
});

test('falha na captura de marketing não derruba a mensagem nem a resposta', async () => {
  const { db, calls } = fakeDb(inboxMissingHandler);
  const replies: string[] = [];
  const reported: string[] = [];
  const runtime = createMetaWebhookRuntime({
    db,
    decryptToken: () => null,
    normalizePhone: (value) => value.replace(/\D/g, ''),
    captureContact: async () => {
      throw Object.assign(new Error('MARKETING_FACT_IDEMPOTENCY_CONFLICT'), { code: 'P0001' });
    },
    scheduleReply: (_userId, phone) => { replies.push(phone); },
    reportSideEffectError: (scope) => { reported.push(scope); },
  });

  const result = await runtime.ingest(inboundPayload(Math.floor(Date.now() / 1000)));

  assert.equal(result.accepted, 1);
  assert.ok(calls.some(q => q.table === 'wa_messages' && q.op === 'insert'), 'mensagem gravada');
  assert.ok(calls.some(q => q.table === 'wa_conversations' && q.op === 'insert'), 'conversa atualizada');
  assert.deepEqual(replies, ['5543988887777']);
  assert.deepEqual(reported, ['marketing']);
});

test('mensagem velha reprocessada não agenda resposta automática', async () => {
  const { db } = fakeDb(inboxMissingHandler);
  const replies: string[] = [];
  const runtime = createMetaWebhookRuntime({
    db,
    decryptToken: () => null,
    normalizePhone: (value) => value.replace(/\D/g, ''),
    scheduleReply: (_userId, phone) => { replies.push(phone); },
  });

  const threeHoursAgo = Math.floor(Date.now() / 1000) - 3 * 3600;
  await runtime.ingest(inboundPayload(threeHoursAgo));

  assert.deepEqual(replies, []);
});

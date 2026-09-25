import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeMetaWebhookPayload } from './meta-whatsapp-coexistence.js';
import {
  buildDeliveryFailure,
  buildFunnelEvent,
  buildInvisibleOutboundEvent,
  createMetaWebhookRuntime,
  shouldScheduleReply,
} from './meta-whatsapp-runtime.js';

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
        lt: () => chain, lte: () => chain,
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

// ── Ganchos do funil e da cadência ─────────────────────────────────────────
type Bound = Parameters<typeof buildFunnelEvent>[0];
const OWN_NUMBER = '554399990000';
const CUSTOMER = '5543988887777';
const STATUS_SECONDS = 1758290000;

function boundsFor(payload: unknown): Bound[] {
  return normalizeMetaWebhookPayload(payload).map(event => ({ account: ACCOUNT, waNumber: OWN_NUMBER, event }));
}

function changePayload(field: string, value: Record<string, unknown>) {
  return {
    object: 'whatsapp_business_account',
    entry: [{
      id: 'waba-1',
      changes: [{
        field,
        value: { metadata: { phone_number_id: 'phone-1', display_phone_number: OWN_NUMBER }, ...value },
      }],
    }],
  };
}

function echoPayload() {
  return changePayload('smb_message_echoes', {
    message_echoes: [{
      id: 'wamid.eco', from: OWN_NUMBER, to: CUSTOMER, timestamp: String(STATUS_SECONDS),
      type: 'text', text: { body: 'Oi, tudo bem? Aqui é do estúdio' },
    }],
  });
}

function documentPayload() {
  return changePayload('messages', {
    contacts: [{ wa_id: CUSTOMER, profile: { name: 'Cliente' } }],
    messages: [{
      id: 'wamid.doc', from: CUSTOMER, timestamp: String(STATUS_SECONDS), type: 'document',
      document: { id: 'media-1', caption: 'Segue o arquivo', filename: 'Orcamento Gestante.pdf', mime_type: 'application/pdf' },
    }],
  });
}

function statusPayload(status: string, extra: Record<string, unknown> = {}) {
  return changePayload('messages', {
    statuses: [{ id: 'wamid.status', status, timestamp: String(STATUS_SECONDS), recipient_id: CUSTOMER, ...extra }],
  });
}

function statusHandler(rowsUpdated: number) {
  return (q: Query) => {
    if (q.table === 'wa_messages' && q.op === 'update') {
      return { data: Array.from({ length: rowsUpdated }, () => ({ message_id: 'wamid.status' })) };
    }
    return inboxMissingHandler(q);
  };
}

const onlyDigits = (value: string) => value.replace(/\D/g, '');

function standbyPayload() {
  const timestamp = String(Math.floor(Date.now() / 1000));
  return changePayload('standby', { standby: {
    contacts: [{ wa_id: CUSTOMER, profile: { name: 'Cliente' } }],
    messages: [{ id: 'wamid.passive-in', from: CUSTOMER, timestamp, type: 'text', text: { body: 'Qual o valor?' } }],
    message_echoes: [{ id: 'wamid.passive-out', timestamp, message: {
      to: CUSTOMER, type: 'text', text: { body: 'Vou te explicar nossos pacotes.' },
    } }],
  } });
}

test('standby salva texto e conversa sem responder nem sinalizar atendimento humano', async () => {
  const { db, calls } = fakeDb(inboxMissingHandler);
  const effects: string[] = [];
  const observed: any[] = [];
  const runtime = createMetaWebhookRuntime({
    db, decryptToken: () => null, normalizePhone: onlyDigits,
    scheduleReply: () => { effects.push('reply'); },
    markHumanActive: async () => { effects.push('human'); },
    observeMessage: async event => { observed.push(event); },
  });
  const result = await runtime.ingest(standbyPayload());
  assert.equal(result.accepted, 2);
  const saved = calls.filter(q => q.table === 'wa_messages' && q.op === 'insert').map(q => q.value as any);
  assert.equal(saved.length, 2);
  assert.deepEqual(saved.map(m => [m.from_me, m.body]), [
    [false, 'Qual o valor?'], [true, 'Vou te explicar nossos pacotes.'],
  ]);
  assert.ok(saved.every(m => m.user_id === ACCOUNT.user_id && m.wa_number === OWN_NUMBER && m.phone === CUSTOMER));
  assert.ok(saved.every(m => m.source_event_key.includes(':standby:')));
  assert.ok(calls.some(q => q.table === 'wa_conversations' && q.op === 'insert'));
  assert.deepEqual(effects, []);
  assert.deepEqual(observed.map(e => [e.direction, e.origin]), [['in', 'customer'], ['out', 'unknown']]);
});

test('standby duplicado não reinsere mensagem nem produz efeitos', async () => {
  const { db, calls } = fakeDb(q => {
    if (q.table === 'wa_messages' && q.op === 'select') return { data: [{ message_id: 'already-saved', source_event_key: 'another-source' }] };
    return inboxMissingHandler(q);
  });
  const runtime = createMetaWebhookRuntime({
    db, decryptToken: () => null, normalizePhone: onlyDigits,
    scheduleReply: () => assert.fail('standby não responde'),
    markHumanActive: async () => assert.fail('standby não assume como humano'),
    observeMessage: async () => assert.fail('duplicata não conta de novo'),
  });
  await runtime.ingest(standbyPayload());
  assert.equal(calls.filter(q => q.table === 'wa_messages' && q.op === 'insert').length, 0);
});

test('standby passa pela fila durável e mantém proveniência até a conversa', async () => {
  let staged: any[] = [];
  let inboxReads = 0;
  const { db, calls } = fakeDb(q => {
    if (q.table !== 'whatsapp_webhook_inbox') return inboxMissingHandler(q);
    if (q.op === 'upsert') {
      staged = (q.value as any[]).map((row, i) => ({ ...row, id: `inbox-${i}` }));
      return { data: staged.map(row => ({ event_key: row.event_key })) };
    }
    if (q.op === 'select') return { data: ++inboxReads === 2 ? staged : [] };
    if (q.op === 'update') return { data: [{ id: 'claimed' }] };
    return {};
  });
  const runtime = createMetaWebhookRuntime({
    db, decryptToken: () => null, normalizePhone: onlyDigits,
    scheduleReply: () => assert.fail('standby não responde ao drenar'),
    markHumanActive: async () => assert.fail('standby não é eco humano'),
  });
  assert.deepEqual(await runtime.ingest(standbyPayload()), { accepted: 2, duplicates: 0, durable: true });
  assert.equal(calls.filter(q => q.table === 'wa_messages' && q.op === 'insert').length, 0);
  assert.equal(await runtime.drain(), 2);
  const saved = calls.filter(q => q.table === 'wa_messages' && q.op === 'insert').map(q => q.value as any);
  assert.deepEqual(saved.map(row => row.webhook_inbox_id), ['inbox-0', 'inbox-1']);
  assert.deepEqual(saved.map(row => row.source_event_key), staged.map(row => row.event_key));
  assert.equal(calls.filter(q => q.table === 'whatsapp_webhook_inbox' && (q.value as any)?.status === 'processed').length, 2);
});

test('standby não perde proteção passiva no fallback de schema antigo', async () => {
  const { db, calls } = fakeDb(q => {
    if (q.table === 'wa_messages' && q.op === 'insert') return { error: { code: '42703', message: 'source_event_key does not exist' } };
    return inboxMissingHandler(q);
  });
  const runtime = createMetaWebhookRuntime({ db, decryptToken: () => null, normalizePhone: onlyDigits });
  await assert.rejects(runtime.ingest(standbyPayload()), { code: '42703' });
  assert.equal(calls.filter(q => q.table === 'wa_messages' && q.op === 'insert').length, 1);
});

test('buildFunnelEvent: cliente vira in/customer, eco vira out/human_app e status fica de fora', () => {
  const [inbound] = boundsFor(inboundPayload(STATUS_SECONDS));
  const event = buildFunnelEvent(inbound);
  assert.deepEqual(event, {
    userId: 'tenant-1', waNumber: OWN_NUMBER, slot: 'main', phone: CUSTOMER, messageId: 'wamid.teste',
    occurredAt: new Date(STATUS_SECONDS * 1000).toISOString(), direction: 'in', origin: 'customer',
    provider: 'meta', type: 'text', body: 'Oi, quero saber o valor', filename: null, mimeType: null,
    contactName: 'Cliente', isBot: false,
  });

  const [echo] = boundsFor(echoPayload());
  const echoEvent = buildFunnelEvent(echo);
  assert.equal(echoEvent?.direction, 'out');
  assert.equal(echoEvent?.origin, 'human_app');
  assert.equal(echoEvent?.phone, CUSTOMER);
  assert.equal(echoEvent?.isBot, false);

  const [status] = boundsFor(statusPayload('sent'));
  assert.equal(buildFunnelEvent(status), null);
});

test('buildFunnelEvent: nome do arquivo vem do filename mesmo com legenda', () => {
  const [doc] = boundsFor(documentPayload());
  const event = buildFunnelEvent(doc);
  assert.equal(event?.type, 'document');
  assert.equal(event?.body, 'Segue o arquivo');
  assert.equal(event?.filename, 'Orcamento Gestante.pdf');
  assert.equal(event?.mimeType, 'application/pdf');
});

test('status sent e failed viram eventos só no status certo', () => {
  const [sent] = boundsFor(statusPayload('sent'));
  const [failed] = boundsFor(statusPayload('failed', { errors: [{ code: 131049, title: 'Não entregue' }] }));
  const [read] = boundsFor(statusPayload('read'));
  assert.equal(buildInvisibleOutboundEvent(failed, onlyDigits), null);
  assert.equal(buildInvisibleOutboundEvent(read, onlyDigits), null);
  assert.equal(buildDeliveryFailure(sent), null);
  assert.equal(buildDeliveryFailure(read), null);
  const [noRecipient] = boundsFor(statusPayload('sent', { recipient_id: '' }));
  assert.equal(buildInvisibleOutboundEvent(noRecipient, onlyDigits), null);
});

test('observeMessage lançando não interrompe o evento e reporta funnel', async () => {
  const { db, calls } = fakeDb(inboxMissingHandler);
  const order: string[] = [];
  const reported: string[] = [];
  const runtime = createMetaWebhookRuntime({
    db,
    decryptToken: () => null,
    normalizePhone: onlyDigits,
    observeMessage: async () => { order.push('funnel'); throw new Error('funil fora do ar'); },
    captureContact: async () => { order.push('marketing'); },
    scheduleReply: () => { order.push('reply'); },
    reportSideEffectError: (scope) => { reported.push(scope); },
  });

  const result = await runtime.ingest(inboundPayload(Math.floor(Date.now() / 1000)));

  assert.equal(result.accepted, 1);
  assert.ok(calls.some(q => q.table === 'wa_messages' && q.op === 'insert'), 'mensagem gravada');
  assert.deepEqual(order, ['funnel', 'marketing', 'reply'], 'funil antes do marketing e da resposta');
  assert.deepEqual(reported, ['funnel']);
});

test('status sent sem linha em wa_messages vira fala meta_bot; com linha não', async () => {
  const observed: any[] = [];
  const failures: unknown[] = [];
  const deps = (rows: number) => ({
    db: fakeDb(statusHandler(rows)).db,
    decryptToken: () => null,
    normalizePhone: onlyDigits,
    observeMessage: async (event: any) => { observed.push(event); },
    onDeliveryFailed: async (input: unknown) => { failures.push(input); },
  });

  await createMetaWebhookRuntime(deps(1)).ingest(statusPayload('sent'));
  assert.equal(observed.length, 0, 'mensagem do CRM já gravada não é fala invisível');

  await createMetaWebhookRuntime(deps(0)).ingest(statusPayload('sent'));
  assert.equal(observed.length, 1);
  assert.deepEqual(observed[0], {
    userId: 'tenant-1', waNumber: OWN_NUMBER, slot: 'main', phone: CUSTOMER, messageId: 'wamid.status',
    occurredAt: new Date(STATUS_SECONDS * 1000).toISOString(), direction: 'out', origin: 'meta_bot',
    provider: 'meta', type: 'text', body: null, filename: null, mimeType: null, contactName: null, isBot: true,
  });
  assert.deepEqual(failures, []);
});

test('status failed chama onDeliveryFailed com os erros da Meta', async () => {
  const failures: unknown[] = [];
  const observed: unknown[] = [];
  const runtime = createMetaWebhookRuntime({
    db: fakeDb(statusHandler(0)).db,
    decryptToken: () => null,
    normalizePhone: onlyDigits,
    observeMessage: async (event) => { observed.push(event); },
    onDeliveryFailed: async (input) => { failures.push(input); },
  });

  await runtime.ingest(statusPayload('failed', {
    errors: [{ code: 131049, title: 'Não entregue para manter o engajamento' }, { code: 'x', message: 'Sem título' }],
  }));

  assert.deepEqual(failures, [{
    userId: 'tenant-1', waNumber: OWN_NUMBER, messageId: 'wamid.status',
    timestamp: new Date(STATUS_SECONDS * 1000).toISOString(),
    errors: [
      { code: 131049, title: 'Não entregue para manter o engajamento' },
      { code: null, title: 'Sem título' },
    ],
  }]);
  assert.deepEqual(observed, [], 'falha não conta como fala do estúdio');
});

test('onDeliveryFailed lançando reporta followup e o status segue processado', async () => {
  const reported: string[] = [];
  const { db, calls } = fakeDb(statusHandler(1));
  const runtime = createMetaWebhookRuntime({
    db,
    decryptToken: () => null,
    normalizePhone: onlyDigits,
    onDeliveryFailed: async () => { throw new Error('cadência fora do ar'); },
    reportSideEffectError: (scope) => { reported.push(scope); },
  });

  const result = await runtime.ingest(statusPayload('failed'));

  assert.equal(result.accepted, 1);
  assert.ok(calls.some(q => q.table === 'wa_messages' && q.op === 'update'), 'status gravado');
  assert.deepEqual(reported, ['followup']);
});

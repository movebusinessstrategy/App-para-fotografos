import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import {
  applyLegacyGate,
  decideLegacyGate,
  extractGraphMessageId,
  legacyPreSendCheck,
  legacyWithin24h,
  loadLegacyFacts,
  resolveLegacyMetaAuth,
  type LegacyFacts,
} from './legacy-followup-fix.js';
import { canonicalPhoneKey } from './lib/br-phone.js';
import type { StageRow } from './lib/stage-rules.js';

type Row = Record<string, unknown>;
type DbError = { code: string; message: string };
interface FakeOpts { tables?: Record<string, Row[]>; errors?: Record<string, DbError>; throwOn?: string[] }

// Filtros do .or() do PostgREST que o módulo usa: col.is.null e col.not.in.(a,b).
function orPredicate(expr: string): (r: Row) => boolean {
  const parts = expr.match(/[a-z_]+\.(?:is\.null|not\.in\.\([^)]*\))/g) || [];
  const preds = parts.map((part) => {
    const [col] = part.split('.');
    if (part.endsWith('.is.null')) return (r: Row) => r[col] == null;
    const list = part.slice(part.indexOf('(') + 1, -1).split(',');
    return (r: Row) => r[col] != null && !list.includes(String(r[col]));
  });
  return (r) => preds.some((p) => p(r));
}

function compareDesc(col: string) {
  return (a: Row, b: Row) => {
    const x = a[col] == null ? null : String(a[col]);
    const y = b[col] == null ? null : String(b[col]);
    if (x === y) return 0;
    if (x === null) return 1; // nullsFirst: false
    if (y === null) return -1;
    return x < y ? 1 : -1;
  };
}

// Supabase falso em memória: aplica os filtros de verdade para provar as variantes.
function fakeDb(opts: FakeOpts = {}) {
  const updates: Array<{ table: string; patch: Row; filters: Row }> = [];
  const orFilters: string[] = [];
  const db = {
    from(table: string) {
      if (opts.throwOn?.includes(table)) throw new Error(`boom ${table}`);
      const preds: Array<(r: Row) => boolean> = [];
      const filters: Row = {};
      let patch: Row | null = null;
      let sorter: ((a: Row, b: Row) => number) | null = null;
      let limit: number | null = null;
      let single = false;
      const chain: any = {
        select: () => chain,
        update: (value: Row) => { patch = value; return chain; },
        eq: (col: string, value: unknown) => { filters[col] = value; preds.push((r) => r[col] === value); return chain; },
        in: (col: string, values: unknown[]) => { preds.push((r) => values.includes(r[col])); return chain; },
        is: (col: string, value: unknown) => { preds.push((r) => (r[col] ?? null) === value); return chain; },
        or: (expr: string) => { orFilters.push(expr); preds.push(orPredicate(expr)); return chain; },
        order: (col: string, o: { ascending?: boolean }) => { if (o?.ascending === false) sorter = compareDesc(col); return chain; },
        limit: (n: number) => { limit = n; return chain; },
        maybeSingle: () => { single = true; return chain; },
        then: (resolve: any, reject: any) => {
          const error = opts.errors?.[table];
          if (error) return Promise.resolve({ data: null, error }).then(resolve, reject);
          if (patch) {
            updates.push({ table, patch, filters: { ...filters } });
            return Promise.resolve({ data: null, error: null }).then(resolve, reject);
          }
          let rows = (opts.tables?.[table] || []).filter((r) => preds.every((p) => p(r)));
          if (sorter) rows = [...rows].sort(sorter);
          if (limit !== null) rows = rows.slice(0, limit);
          const data = single ? rows[0] ?? null : rows;
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        },
      };
      return chain;
    },
  };
  return { db: db as any, updates, orFilters };
}

const USER = 'tenant-1';
const CLIENT_13 = '5543988887777';
const CLIENT_12 = '554388887777';
const STUDIO_13 = '5543999990000';
const STUDIO_12 = '554399990000';

// Segunda-feira 21/09/2026, 14h em São Paulo (UTC-3): dentro do horário comercial.
const MONDAY_2PM = new Date('2026-09-21T17:00:00Z');
const hoursBefore = (at: Date, h: number) => new Date(at.getTime() - h * 3600_000).toISOString();

const stage = (id: string, position: number, extra: Partial<StageRow> = {}): StageRow => ({
  id, name: id, position, is_final: false, is_won: false, process_id: null, ...extra,
});
const STAGES: StageRow[] = [
  stage('lead', 1), stage('contact', 2), stage('proposal', 3), stage('02-follow-up', 4),
  stage('won', 5, { is_final: true, is_won: true }), stage('lost', 6, { is_final: true }),
];

const TASK = { stage_id: '02-follow-up', created_at: hoursBefore(MONDAY_2PM, 2) };
const baseFacts = (extra: Partial<LegacyFacts> = {}): LegacyFacts => ({
  deal: { id: 10, stage: '02-follow-up', converted: false, converted_job_id: null },
  stages: STAGES, optedOut: false, cadenceEnabled: false, lastCustomerAt: hoursBefore(MONDAY_2PM, 30), ...extra,
});
const withDeal = (extra: Partial<NonNullable<LegacyFacts['deal']>>) => baseFacts({ deal: { ...baseFacts().deal!, ...extra } });

// ─── resolveLegacyMetaAuth ───────────────────────────────────────────────────

const decryptOk = (blob: string | null | undefined) => (blob ? `plain:${blob}` : null);
const NOW = new Date('2026-09-19T15:00:00Z');

test('resolveLegacyMetaAuth: sem conta ou sem token => no_token', () => {
  for (const account of [null, undefined, {}, { access_token: null }, { access_token: '   ' }]) {
    const auth = resolveLegacyMetaAuth(account, decryptOk, NOW);
    assert.deepEqual(auth, { ok: false, reason: 'no_token', message: 'Conta Meta sem token salvo.' });
  }
});

test('resolveLegacyMetaAuth: token vencido traz dd/mm no fuso de São Paulo', () => {
  const expired = resolveLegacyMetaAuth({ access_token: 'enc:v1:x', token_expires_at: '2026-09-18T12:00:00Z' }, decryptOk, NOW);
  assert.deepEqual(expired, {
    ok: false,
    reason: 'expired',
    message: 'Token da API oficial venceu em 18/09. Reconecte em Configurações > Integrações > WhatsApp.',
  });
  // 01:30 UTC do dia 18 ainda é 22:30 do dia 17 em São Paulo.
  const lateNight = resolveLegacyMetaAuth({ access_token: 'x', token_expires_at: '2026-09-18T01:30:00Z' }, decryptOk, NOW);
  assert.equal(lateNight.ok === false && lateNight.message.includes('venceu em 17/09.'), true);
  // Vence exatamente agora: já conta como vencido.
  const exact = resolveLegacyMetaAuth({ access_token: 'x', token_expires_at: NOW.toISOString() }, decryptOk, NOW);
  assert.equal(exact.ok === false && exact.reason, 'expired');
});

test('resolveLegacyMetaAuth: falha ao decifrar => decrypt_failed', () => {
  const expected = { ok: false, reason: 'decrypt_failed', message: 'Não foi possível decifrar o token da API oficial.' };
  assert.deepEqual(resolveLegacyMetaAuth({ access_token: 'enc:v1:x' }, () => null, NOW), expected);
  assert.deepEqual(resolveLegacyMetaAuth({ access_token: 'enc:v1:x' }, () => '', NOW), expected);
  assert.deepEqual(resolveLegacyMetaAuth({ access_token: 'enc:v1:x' }, () => { throw new Error('chave'); }, NOW), expected);
});

test('resolveLegacyMetaAuth: token válido devolve o bearer decifrado, nunca o blob', () => {
  const future = { access_token: 'enc:v1:abc', token_expires_at: '2026-10-30T00:00:00Z' };
  assert.deepEqual(resolveLegacyMetaAuth(future, decryptOk, NOW), { ok: true, bearer: 'plain:enc:v1:abc' });
  assert.deepEqual(resolveLegacyMetaAuth({ access_token: 'abc', token_expires_at: null }, decryptOk, NOW), { ok: true, bearer: 'plain:abc' });
  assert.deepEqual(resolveLegacyMetaAuth({ access_token: 'abc', token_expires_at: 'lixo' }, decryptOk, NOW), { ok: true, bearer: 'plain:abc' });
});

test('mensagens para o usuário sem travessão', () => {
  const messages = [
    resolveLegacyMetaAuth(null, decryptOk, NOW),
    resolveLegacyMetaAuth({ access_token: 'x', token_expires_at: '2026-09-18T12:00:00Z' }, decryptOk, NOW),
    resolveLegacyMetaAuth({ access_token: 'x' }, () => null, NOW),
  ].map((auth) => (auth.ok ? '' : auth.message));
  for (const message of messages) assert.doesNotMatch(message, /[–—]/);
});

// ─── legacyWithin24h ─────────────────────────────────────────────────────────

const inbound = (phone: string, waNumber: string, timestamp: string | null, extra: Row = {}): Row => ({
  user_id: USER, phone, wa_number: waNumber, from_me: false, timestamp, type: 'text', ...extra,
});

test('legacyWithin24h acha 13 dígitos a partir de 12 e vice-versa, no telefone e no wa_number', async () => {
  const stored13 = fakeDb({ tables: { wa_messages: [inbound(CLIENT_13, STUDIO_13, hoursBefore(NOW, 2))] } });
  assert.equal(await legacyWithin24h(stored13.db, USER, CLIENT_12, STUDIO_12, NOW), true);

  const stored12 = fakeDb({ tables: { wa_messages: [inbound(CLIENT_12, STUDIO_12, hoursBefore(NOW, 2))] } });
  assert.equal(await legacyWithin24h(stored12.db, USER, CLIENT_13, STUDIO_13, NOW), true);
});

test('legacyWithin24h: mais de 24h, só mensagem nossa, outra conta ou outro número => false', async () => {
  const old = fakeDb({ tables: { wa_messages: [inbound(CLIENT_13, STUDIO_13, hoursBefore(NOW, 25))] } });
  assert.equal(await legacyWithin24h(old.db, USER, CLIENT_13, STUDIO_13, NOW), false);

  const ours = fakeDb({ tables: { wa_messages: [inbound(CLIENT_13, STUDIO_13, hoursBefore(NOW, 1), { from_me: true })] } });
  assert.equal(await legacyWithin24h(ours.db, USER, CLIENT_13, STUDIO_13, NOW), false);

  const other = fakeDb({ tables: { wa_messages: [inbound(CLIENT_13, STUDIO_13, hoursBefore(NOW, 1), { user_id: 'outra' })] } });
  assert.equal(await legacyWithin24h(other.db, USER, CLIENT_13, STUDIO_13, NOW), false);

  const otherNumber = fakeDb({ tables: { wa_messages: [inbound(CLIENT_13, '5543911112222', hoursBefore(NOW, 1))] } });
  assert.equal(await legacyWithin24h(otherNumber.db, USER, CLIENT_13, STUDIO_13, NOW), false);
});

test('legacyWithin24h usa a mensagem mais nova e ignora timestamp nulo', async () => {
  const rows = [
    inbound(CLIENT_13, STUDIO_13, null),
    inbound(CLIENT_13, STUDIO_13, hoursBefore(NOW, 40)),
    inbound(CLIENT_12, STUDIO_12, hoursBefore(NOW, 3)),
  ];
  assert.equal(await legacyWithin24h(fakeDb({ tables: { wa_messages: rows } }).db, USER, CLIENT_13, STUDIO_13, NOW), true);
});

test('legacyWithin24h: erro ou exceção => false', async () => {
  const failing = fakeDb({ errors: { wa_messages: { code: '57014', message: 'timeout' } } });
  assert.equal(await legacyWithin24h(failing.db, USER, CLIENT_13, STUDIO_13, NOW), false);
  const throwing = fakeDb({ throwOn: ['wa_messages'] });
  assert.equal(await legacyWithin24h(throwing.db, USER, CLIENT_13, STUDIO_13, NOW), false);
  assert.equal(await legacyWithin24h(fakeDb().db, USER, '', STUDIO_13, NOW), false);
});

// ─── decideLegacyGate ────────────────────────────────────────────────────────

test('regra 1: deal sumiu => cancel deal_missing', () => {
  assert.deepEqual(decideLegacyGate(TASK, baseFacts({ deal: null, optedOut: true }), MONDAY_2PM), { action: 'cancel', reason: 'deal_missing' });
});

test('regra 2: convertido, com ensaio, etapa fechada ou desconhecida => cancel deal_closed', () => {
  const closed = { action: 'cancel', reason: 'deal_closed' };
  assert.deepEqual(decideLegacyGate(TASK, withDeal({ converted: true }), MONDAY_2PM), closed);
  assert.deepEqual(decideLegacyGate(TASK, withDeal({ converted_job_id: 77 }), MONDAY_2PM), closed);
  assert.deepEqual(decideLegacyGate({ ...TASK, stage_id: 'won' }, withDeal({ stage: 'won' }), MONDAY_2PM), closed);
  assert.deepEqual(decideLegacyGate({ ...TASK, stage_id: 'lost' }, withDeal({ stage: 'lost' }), MONDAY_2PM), closed);
  // Etapa que não existe mais: na dúvida, não manda.
  assert.deepEqual(decideLegacyGate({ ...TASK, stage_id: 'fantasma' }, withDeal({ stage: 'fantasma' }), MONDAY_2PM), closed);
});

test('regra 3: deal mudou de etapa => cancel stage_changed; sem stage_id na tarefa não compara', () => {
  assert.deepEqual(decideLegacyGate({ ...TASK, stage_id: 'proposal' }, baseFacts(), MONDAY_2PM), { action: 'cancel', reason: 'stage_changed' });
  assert.deepEqual(decideLegacyGate({ ...TASK, stage_id: null }, withDeal({ stage: 'proposal' }), MONDAY_2PM), { action: 'send' });
});

test('regra 4: opt-out => cancel optout', () => {
  assert.deepEqual(decideLegacyGate(TASK, baseFacts({ optedOut: true }), MONDAY_2PM), { action: 'cancel', reason: 'optout' });
});

test('regra 5: cadência ligada => cancel cadence_active', () => {
  assert.deepEqual(decideLegacyGate(TASK, baseFacts({ cadenceEnabled: true }), MONDAY_2PM), { action: 'cancel', reason: 'cadence_active' });
});

test('regra 6: cliente falou depois da criação => cancel customer_replied', () => {
  const replied = baseFacts({ lastCustomerAt: hoursBefore(MONDAY_2PM, 1) });
  assert.deepEqual(decideLegacyGate(TASK, replied, MONDAY_2PM), { action: 'cancel', reason: 'customer_replied' });
  // Mesmo instante da criação não é resposta.
  assert.deepEqual(decideLegacyGate(TASK, baseFacts({ lastCustomerAt: TASK.created_at }), MONDAY_2PM), { action: 'send' });
  assert.deepEqual(decideLegacyGate(TASK, baseFacts({ lastCustomerAt: null }), MONDAY_2PM), { action: 'send' });
  // Sem created_at confiável não dá para provar o silêncio.
  assert.deepEqual(decideLegacyGate({ ...TASK, created_at: '' }, baseFacts(), MONDAY_2PM), { action: 'cancel', reason: 'customer_replied' });
});

test('regra 7: fora do horário comercial => defer até a próxima abertura', () => {
  const cases: Array<[string, string]> = [
    ['2026-09-20T15:00:00Z', '2026-09-21T12:00:00.000Z'], // domingo 12h => segunda 9h
    ['2026-09-21T23:30:00Z', '2026-09-22T12:00:00.000Z'], // segunda 20h30 => terça 9h
    ['2026-09-21T10:00:00Z', '2026-09-21T12:00:00.000Z'], // segunda 7h => segunda 9h
  ];
  for (const [now, until] of cases) {
    assert.deepEqual(decideLegacyGate(TASK, baseFacts({ lastCustomerAt: null }), new Date(now)), { action: 'defer', until }, now);
  }
});

test('regra 8: tudo certo no horário => send', () => {
  assert.deepEqual(decideLegacyGate(TASK, baseFacts(), MONDAY_2PM), { action: 'send' });
});

test('precedência: cliente respondeu e fora do horário => cancel, não defer', () => {
  const sunday = new Date('2026-09-20T15:00:00Z');
  const facts = baseFacts({ lastCustomerAt: hoursBefore(sunday, 1) });
  assert.deepEqual(decideLegacyGate({ ...TASK, created_at: hoursBefore(sunday, 5) }, facts, sunday), { action: 'cancel', reason: 'customer_replied' });
});

test('precedência: a tabela para na primeira regra que casar, na ordem', () => {
  const sunday = new Date('2026-09-20T15:00:00Z');
  const task = { stage_id: 'proposal', created_at: hoursBefore(sunday, 5) };
  const facts: LegacyFacts = {
    deal: null, stages: STAGES, optedOut: true, cadenceEnabled: true, lastCustomerAt: hoursBefore(sunday, 1),
  };
  const deal = { id: 10, stage: 'won', converted: true, converted_job_id: 5 };
  const steps: Array<[() => void, string]> = [
    [() => { facts.deal = { ...deal }; }, 'deal_closed'],
    [() => { facts.deal = { ...deal, stage: '02-follow-up', converted: false, converted_job_id: null }; }, 'stage_changed'],
    [() => { task.stage_id = '02-follow-up'; }, 'optout'],
    [() => { facts.optedOut = false; }, 'cadence_active'],
    [() => { facts.cadenceEnabled = false; }, 'customer_replied'],
  ];
  assert.deepEqual(decideLegacyGate(task, facts, sunday), { action: 'cancel', reason: 'deal_missing' });
  for (const [fix, reason] of steps) {
    fix();
    assert.deepEqual(decideLegacyGate(task, facts, sunday), { action: 'cancel', reason });
  }
  facts.lastCustomerAt = null;
  assert.equal(decideLegacyGate(task, facts, sunday).action, 'defer');
  assert.deepEqual(decideLegacyGate(task, facts, MONDAY_2PM), { action: 'send' });
});

// ─── loadLegacyFacts e legacyPreSendCheck ────────────────────────────────────

function tenantTables(extra: Partial<Record<string, Row[]>> = {}): Record<string, Row[]> {
  return {
    deals: [
      { id: 10, user_id: USER, stage: '02-follow-up', converted: false, converted_job_id: null },
      { id: 11, user_id: 'outra', stage: 'lead', converted: false, converted_job_id: null },
    ],
    deal_stages: STAGES.map((s) => ({ ...s, user_id: USER })),
    followup_cadence_config: [{ user_id: USER, enabled: false }],
    followup_optouts: [],
    wa_messages: [inbound(CLIENT_13, STUDIO_13, hoursBefore(MONDAY_2PM, 30))],
    ...extra,
  } as Record<string, Row[]>;
}

const DB_TASK = {
  id: 501, user_id: USER, deal_id: 10, phone: CLIENT_13, wa_number: STUDIO_13, stage_id: '02-follow-up',
  message: 'Oi! Passando para saber se ficou alguma dúvida.', created_at: hoursBefore(MONDAY_2PM, 2), status: 'processing',
};

test('loadLegacyFacts lê deal, etapas, opt-out, cadência e última fala do cliente em qualquer número', async () => {
  const lastAnyNumber = hoursBefore(MONDAY_2PM, 1);
  const { db, orFilters } = fakeDb({
    tables: tenantTables({
      wa_messages: [
        inbound(CLIENT_13, STUDIO_13, hoursBefore(MONDAY_2PM, 30)),
        inbound(CLIENT_12, '5543911112222', lastAnyNumber), // pós-venda, 12 dígitos
        inbound(CLIENT_13, STUDIO_13, hoursBefore(MONDAY_2PM, 0.5), { type: 'reaction' }),
        inbound(CLIENT_13, STUDIO_13, hoursBefore(MONDAY_2PM, 0.2), { from_me: true }),
      ],
      followup_optouts: [{ id: 1, user_id: USER, phone_key: canonicalPhoneKey(CLIENT_12), revoked_at: null }],
      followup_cadence_config: [{ user_id: USER, enabled: true }],
    }),
  });
  const facts = await loadLegacyFacts(db, DB_TASK);
  assert.deepEqual(facts.deal, { id: 10, stage: '02-follow-up', converted: false, converted_job_id: null });
  assert.equal(facts.stages.length, STAGES.length);
  assert.equal(facts.optedOut, true);
  assert.equal(facts.cadenceEnabled, true);
  assert.equal(facts.lastCustomerAt, lastAnyNumber);
  assert.deepEqual(orFilters, ['type.is.null,type.not.in.(reaction,edit,revoke)']);
});

test('loadLegacyFacts: sem as tabelas da 083, cadência desligada e ninguém em opt-out', async () => {
  const missing = { code: '42P01', message: 'relation does not exist' };
  const { db } = fakeDb({ tables: tenantTables(), errors: { followup_cadence_config: missing, followup_optouts: missing } });
  const facts = await loadLegacyFacts(db, DB_TASK);
  assert.equal(facts.cadenceEnabled, false);
  assert.equal(facts.optedOut, false);
});

test('loadLegacyFacts: deal de outra conta não aparece', async () => {
  const facts = await loadLegacyFacts(fakeDb({ tables: tenantTables() }).db, { ...DB_TASK, deal_id: 11 });
  assert.equal(facts.deal, null);
});

test('legacyPreSendCheck manda quando está tudo certo e cancela quando o cliente respondeu', async () => {
  const ok = fakeDb({ tables: tenantTables() });
  assert.deepEqual(await legacyPreSendCheck(ok.db, DB_TASK, MONDAY_2PM), { action: 'send' });

  const replied = fakeDb({ tables: tenantTables({ wa_messages: [inbound(CLIENT_12, STUDIO_12, hoursBefore(MONDAY_2PM, 1))] }) });
  assert.deepEqual(await legacyPreSendCheck(replied.db, DB_TASK, MONDAY_2PM), { action: 'cancel', reason: 'customer_replied' });
});

test('legacyPreSendCheck: sentinela da Lia não é cancelada pela etapa gravada antes do orçamento', async () => {
  const lia = { ...DB_TASK, message: '###AGENT_FOLLOWUP###', stage_id: 'contact' };
  const tables = tenantTables({
    deals: [{ id: 10, user_id: USER, stage: 'proposal', converted: false, converted_job_id: null }],
  });
  assert.deepEqual(await legacyPreSendCheck(fakeDb({ tables }).db, lia, MONDAY_2PM), { action: 'send' });
  // A mensagem fixa com a mesma divergência de etapa continua cancelada.
  const fixed = { ...DB_TASK, stage_id: 'contact' };
  assert.deepEqual(await legacyPreSendCheck(fakeDb({ tables }).db, fixed, MONDAY_2PM), { action: 'cancel', reason: 'stage_changed' });
  // Mas a sentinela ainda respeita opt-out e cadência ligada.
  const withCadence = fakeDb({ tables: { ...tables, followup_cadence_config: [{ user_id: USER, enabled: true }] } });
  assert.deepEqual(await legacyPreSendCheck(withCadence.db, lia, MONDAY_2PM), { action: 'cancel', reason: 'cadence_active' });
});

test('legacyPreSendCheck com db lançando ou com erro => defer +30min, nunca lança', async () => {
  const warn = mock.method(console, 'warn', () => {});
  try {
    const until = new Date(MONDAY_2PM.getTime() + 30 * 60_000).toISOString();
    const throwing = fakeDb({ tables: tenantTables(), throwOn: ['deals'] });
    assert.deepEqual(await legacyPreSendCheck(throwing.db, DB_TASK, MONDAY_2PM), { action: 'defer', until });
    const failing = fakeDb({ tables: tenantTables(), errors: { wa_messages: { code: '57014', message: 'timeout' } } });
    assert.deepEqual(await legacyPreSendCheck(failing.db, DB_TASK, MONDAY_2PM), { action: 'defer', until });
    assert.deepEqual(await legacyPreSendCheck(throwing.db, null, MONDAY_2PM), { action: 'defer', until });
    const logged = warn.mock.calls.map((c) => c.arguments.join(' ')).join('\n');
    assert.doesNotMatch(logged, /88887777/);
    assert.doesNotMatch(logged, /dúvida/);
  } finally {
    warn.mock.restore();
  }
});

// ─── applyLegacyGate ─────────────────────────────────────────────────────────

test('applyLegacyGate grava cancel e defer por id e user_id; send não mexe', async () => {
  const log = mock.method(console, 'log', () => {});
  try {
    const { db, updates } = fakeDb();
    await applyLegacyGate(db, DB_TASK, { action: 'cancel', reason: 'optout' });
    await applyLegacyGate(db, DB_TASK, { action: 'defer', until: '2026-09-22T12:00:00.000Z' });
    await applyLegacyGate(db, DB_TASK, { action: 'send' });
    assert.deepEqual(updates, [
      { table: 'scheduled_followups', patch: { status: 'cancelled' }, filters: { id: 501, user_id: USER } },
      { table: 'scheduled_followups', patch: { status: 'pending', scheduled_at: '2026-09-22T12:00:00.000Z' }, filters: { id: 501, user_id: USER } },
    ]);
    const lines = log.mock.calls.map((c) => String(c.arguments[0]));
    assert.deepEqual(lines, [
      '[FollowUp Worker] cancel optout | task=501',
      '[FollowUp Worker] defer até 2026-09-22T12:00:00.000Z | task=501',
    ]);
  } finally {
    log.mock.restore();
  }
});

test('applyLegacyGate não lança quando o banco falha', async () => {
  const warn = mock.method(console, 'warn', () => {});
  try {
    const failing = fakeDb({ errors: { scheduled_followups: { code: '57014', message: 'timeout' } } });
    await applyLegacyGate(failing.db, DB_TASK, { action: 'cancel', reason: 'deal_missing' });
    await applyLegacyGate(fakeDb({ throwOn: ['scheduled_followups'] }).db, DB_TASK, { action: 'cancel', reason: 'deal_missing' });
    assert.equal(warn.mock.callCount(), 2);
  } finally {
    warn.mock.restore();
  }
});

// ─── extractGraphMessageId ───────────────────────────────────────────────────

test('extractGraphMessageId pega o wamid real e recusa o resto', () => {
  assert.equal(extractGraphMessageId({ messaging_product: 'whatsapp', messages: [{ id: 'wamid.HBgM' }] }), 'wamid.HBgM');
  for (const body of [null, undefined, {}, { messages: [] }, { messages: [{ id: 123 }] }, { messages: [{ id: '' }] },
    { error: { message: 'x' } }, 'wamid.solto']) {
    assert.equal(extractGraphMessageId(body), null, JSON.stringify(body));
  }
});

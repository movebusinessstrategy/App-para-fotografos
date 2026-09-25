import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import { createFollowUpCadenceFrom, FIXED_TEMPLATES_EVERY_MS, SENDER_TICK_MS, SWEEP_SCHEDULER_MS } from './followup-runtime.js';
import type { CadenceFunnelPort, FollowUpCadenceDeps } from './followup-runtime.js';
import {
  CadenceMigrationMissing, createFollowUpRepo, createSenderTransport, graphResultFrom, invisibleCandidates, isCadenceMigrationMissing,
  needsHuman, worstQuality,
} from './followup-repo.js';
import type { FollowUpRepo, FollowUpRepoDeps } from './followup-repo.js';
import type { CadenceTemplate, SenderChannelHealth } from './followup-channel.js';
import { NEUTRAL_HOOKS } from './followup-draft.js';
import type { SenderTransport } from './followup-sender.js';
import { DEFAULT_FOLLOWUP_CONFIG } from './src/features/followups/types.js';
import type { CadenceTaskRow, FollowUpConfig, FollowUpRuntimeState } from './src/features/followups/types.js';
import { canonicalPhoneKey } from './lib/br-phone.js';
import { fixedTemplateBody, fixedTemplateName, renderFixedMessage } from './followup-fixed.js';

const HOUR = 3_600_000;
// Sexta-feira, 12:00 em São Paulo.
const T0 = new Date('2026-09-18T15:00:00.000Z');
const USER = 'user-1';
// Números fictícios.
const MAIN = '5543900001111';
const CUSTOMER = '5543911112222';
const ago = (hours: number) => new Date(T0.getTime() - hours * HOUR).toISOString();
const unix = (iso: string) => String(Math.floor(Date.parse(iso) / 1000));

const BASE_CONFIG: FollowUpConfig = {
  ...DEFAULT_FOLLOWUP_CONFIG, enabled: true,
  ladder_stage_ids: ['proposal', 'negotiation', '02-follow-up', '03-follow-up'], after_last_stage_id: '04-follow-up',
};
const BASE_STATE: FollowUpRuntimeState = {
  next_send_after: null, consecutive_errors: 0, paused_at: null, paused_reason: null, last_error: null, last_block_code: null,
  last_block_message: null, last_block_at: null, last_sweep_at: null, last_sweep_summary: null, first_enabled_at: null,
  external_ai_consent_at: '2026-09-01T12:00:00.000Z', external_ai_consent_by: 'owner',
};
const TEMPLATE: CadenceTemplate = {
  id: 40, name: 'retomada_ensaio', language: 'pt_BR', bodyText: 'Oi, {{1}}! {{2}}', status: 'APPROVED',
  category: 'MARKETING', headerText: null, buttons: [],
};

function health(over: Partial<SenderChannelHealth['meta']> = {}): SenderChannelHealth {
  return {
    meta: { configured: true, phoneNumberId: 'pnid-1', waNumber: MAIN, token: 'tok', tokenExpiresAt: null, operational: true, qualityRating: 'GREEN', ...over },
    baileys: { status: 'close', waNumber: null, paired: false },
    mainWaNumber: MAIN, preferredChannel: 'auto', dedupeReady: false,
  };
}

function sentTask(over: Partial<CadenceTaskRow> = {}): CadenceTaskRow {
  return {
    id: 501, user_id: USER, deal_id: 7, phone: CUSTOMER, phone_key: canonicalPhoneKey(CUSTOMER), wa_number: MAIN,
    message: 'Oi, Ana! Ficou alguma dúvida?', stage_id: 'proposal', scheduled_at: ago(1), sent_at: ago(0.1), status: 'sent',
    created_at: ago(5), contact_name: 'Ana', attempts: 1, kind: 'cadence', step: 1, basis_at: ago(30), basis_message_id: null,
    draft_text: null, approved_at: ago(2), approved_by: 'owner', claimed_at: null, claimed_by: null, lease_expires_at: null,
    channel_used: 'meta_text', sent_message_id: 'wamid.sent1', last_error: null,
    generation_meta: { advance: { state: 'pending', due_at: ago(-0.2) }, delivery: { message_ids: ['wamid.sent1'], delivered_text: 'x', channel: 'meta_text' } },
    updated_at: ago(0.1), ...over,
  };
}

// Repositório falso: todo método não configurado falha alto.
const REPO_METHODS = [
  'loadConfig', 'loadStages', 'mainWaNumber', 'candidates', 'sweepTasks', 'liveLegacyDealIds', 'optoutKeys', 'cancelTasks',
  'loadConversationRows', 'loadAgentConfig', 'insertTask', 'upsertOptOut', 'saveSweepState', 'runRetention', 'loadTask',
  'updateTaskCas', 'lastCustomerTurnAt', 'listActiveConfigs', 'claim', 'loadSendSnapshot', 'loadHealth', 'loadTemplate',
  'recordDeliveryProof', 'persistOutbound', 'finish', 'forceMarkSent', 'listPendingAdvances', 'markAdvance', 'updateState',
  'listConfigsForAutoSweep', 'findTaskByMessageId', 'listTemplateRows', 'dedupeReady', 'invalidate',
] as const;

function fakeRepo(over: Partial<FollowUpRepo> = {}): FollowUpRepo {
  const base: Record<string, unknown> = {};
  for (const name of REPO_METHODS) base[name] = async () => { throw new Error(`repo falso: ${name} não configurado`); };
  return Object.assign(base, over) as unknown as FollowUpRepo;
}

const NO_TRANSPORT: SenderTransport = {
  baileysSendText: async () => { throw new Error('sem envio nos testes'); },
  baileysTyping: async () => {},
  graphSend: async () => { throw new Error('sem envio nos testes'); },
};

function fakeFunnel() {
  const calls: string[] = [];
  const funnel: CadenceFunnelPort = {
    moveDealStage: async () => 'noop',
    reconcilePreview: async (u) => { calls.push(`preview:${u}`); return { generated_at: T0.toISOString(), scanned: 0, to_contact: [], to_proposal: [], to_create: [] }; },
    reconcileApply: async (u) => { calls.push(`apply:${u}`); return { moved: 0, noop: 0, conflicts: 0, refused: 0, created: 0, skipped_marketing: 0 }; },
    invalidate: (u) => { calls.push(`invalidate:${u}`); },
  };
  return { funnel, calls };
}

function runtime(repo: FollowUpRepo, opts: { now?: () => Date; logs?: Array<{ event: string; data?: Record<string, unknown> }>; fetch?: typeof fetch } = {}) {
  const { funnel, calls } = fakeFunnel();
  const deps: FollowUpCadenceDeps = {
    db: {} as FollowUpCadenceDeps['db'], funnel,
    getReplyDetailed: async () => { throw new Error('IA real nunca é chamada nos testes'); },
    loadSupervisedMemory: async () => '',
    baileys: {
      status: () => 'close', registeredPhone: () => null, paired: () => false,
      sendText: async () => { throw new Error('sem envio'); }, sendTyping: async () => {},
    },
    decryptToken: () => null, refreshMetaState: async () => false, mainWaNumber: async () => MAIN,
    now: opts.now ?? (() => new Date(T0)),
    log: (event, data) => opts.logs?.push({ event, data }),
  };
  return { cadence: createFollowUpCadenceFrom(deps, { repo, transport: NO_TRANSPORT, fetch: opts.fetch }), funnelCalls: calls };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

// Serviços

test('runSweep em paralelo na mesma conta => SWEEP_RUNNING, e o estado reflete a execução', async () => {
  const gate = deferred<void>();
  const repo = fakeRepo({
    loadConfig: async () => { await gate.promise; return { config: BASE_CONFIG, state: BASE_STATE, exists: false }; },
  });
  const { cadence } = runtime(repo);
  const first = cadence.services.runSweep(USER, { manual: true });
  await assert.rejects(cadence.services.runSweep(USER, { manual: true }), /SWEEP_RUNNING/);
  assert.equal(cadence.services.sweepState(USER).running, true);
  assert.equal(cadence.services.sweepState(USER).started_at, T0.toISOString());
  gate.resolve();
  const summary = await first;
  assert.equal(summary.generated, 0);
  const state = cadence.services.sweepState(USER);
  assert.equal(state.running, false);
  assert.deepEqual(state.last_summary, summary);
  // Outra conta não é afetada pela trava.
  assert.equal(cadence.services.sweepState('outra').running, false);
});

test('runSweep que falha libera a trava', async () => {
  const repo = fakeRepo({ loadConfig: async () => ({ config: BASE_CONFIG, state: { ...BASE_STATE, external_ai_consent_at: null }, exists: true }) });
  const { cadence } = runtime(repo);
  await assert.rejects(cadence.services.runSweep(USER, { manual: true }), /AI_CONSENT_REQUIRED/);
  assert.equal(cadence.services.sweepState(USER).running, false);
  await assert.rejects(cadence.services.runSweep(USER, { manual: true }), /AI_CONSENT_REQUIRED/);
});

test('regenerate em paralelo na mesma tarefa => REGEN_RUNNING', async () => {
  const gate = deferred<void>();
  const repo = fakeRepo({ loadConfig: async () => { await gate.promise; return { config: BASE_CONFIG, state: { ...BASE_STATE, external_ai_consent_at: null }, exists: true }; } });
  const { cadence } = runtime(repo);
  const first = cadence.services.regenerate(USER, 9, { actorId: 'owner' });
  await assert.rejects(cadence.services.regenerate(USER, 9, { actorId: 'owner' }), /REGEN_RUNNING/);
  gate.resolve();
  assert.deepEqual(await first, { status: 'consent_required' });
  assert.deepEqual(await cadence.services.regenerate(USER, 9, { actorId: 'owner' }), { status: 'consent_required' });
});

test('businessWindow: aberto em dia útil, fechado no domingo com a próxima abertura', () => {
  const { cadence } = runtime(fakeRepo());
  assert.deepEqual(cadence.services.businessWindow(BASE_CONFIG, T0), { open: true, next_open_at: null });
  const sunday = new Date('2026-09-20T15:00:00.000Z');
  assert.deepEqual(cadence.services.businessWindow(BASE_CONFIG, sunday), { open: false, next_open_at: '2026-09-21T12:00:00.000Z' });
  const noDays = { ...BASE_CONFIG, business_hours: { ...BASE_CONFIG.business_hours, days: [] } };
  assert.deepEqual(cadence.services.businessWindow(noDays, sunday), { open: false, next_open_at: null });
});

test('invalidateConfig limpa o cache do repositório e chama funnel.invalidate', () => {
  const invalidated: string[] = [];
  const { cadence, funnelCalls } = runtime(fakeRepo({ invalidate: (u) => { invalidated.push(u); } }));
  cadence.services.invalidateConfig(USER);
  assert.deepEqual(invalidated, [USER]);
  assert.deepEqual(funnelCalls, [`invalidate:${USER}`]);
});

test('reconcilePreview e reconcileApply delegam para o funil', async () => {
  const { cadence, funnelCalls } = runtime(fakeRepo());
  await cadence.services.reconcilePreview(USER, { limit: 10 });
  await cadence.services.reconcileApply(USER, { deal_ids: [1] }, 'owner');
  assert.deepEqual(funnelCalls, [`preview:${USER}`, `apply:${USER}`]);
});

function failureWorld(task: CadenceTaskRow | null, state: Partial<FollowUpRuntimeState> = {}) {
  const w = { cas: [] as any[], states: [] as Array<Partial<FollowUpRuntimeState>>, lookups: [] as string[] };
  const repo = fakeRepo({
    findTaskByMessageId: async (_u, id) => { w.lookups.push(id); return task && id.startsWith('wamid.sent') ? structuredClone(task) : null; },
    updateTaskCas: async (id, _u, patch, opts) => { w.cas.push({ id, patch, opts }); return { ...(task as CadenceTaskRow), ...patch } as CadenceTaskRow; },
    loadConfig: async () => ({ config: { ...BASE_CONFIG, max_consecutive_errors: 2 }, state: { ...BASE_STATE, ...state }, exists: true }),
    updateState: async (_u, patch) => { w.states.push(patch); },
  });
  return { w, ...runtime(repo) };
}

test('recordDeliveryFailure marca failed, pula o avanço pendente e conta erro seguido', async () => {
  const { w, cadence } = failureWorld(sentTask(), { consecutive_errors: 1 });
  await cadence.services.recordDeliveryFailure({
    userId: USER, waNumber: MAIN, messageId: 'wamid.sent1', timestamp: unix(ago(0.05)), errors: [{ code: 131026, title: 'Message undeliverable' }],
  });
  assert.equal(w.cas.length, 1);
  const { patch, opts } = w.cas[0];
  assert.deepEqual(opts, { statuses: ['sent'] });
  assert.equal(patch.status, 'failed');
  assert.equal(patch.last_error, 'A Meta não entregou (código 131026: Message undeliverable).');
  assert.deepEqual(patch.generation_meta.failure, { code: 131026, title: 'Message undeliverable', at: new Date(Number(unix(ago(0.05))) * 1000).toISOString() });
  assert.equal(patch.generation_meta.advance.state, 'skipped');
  assert.equal(patch.generation_meta.advance.due_at, ago(-0.2));
  assert.deepEqual(patch.generation_meta.delivery.message_ids, ['wamid.sent1']);
  assert.equal(w.states[0].consecutive_errors, 2);
  assert.equal(w.states[0].paused_reason, 'error_streak');
  assert.equal(w.states[0].paused_at, T0.toISOString());
});

test('recordDeliveryFailure ignora id desconhecido e tarefa que não está sent', async () => {
  const unknown = failureWorld(sentTask());
  await unknown.cadence.services.recordDeliveryFailure({ userId: USER, waNumber: MAIN, messageId: 'wamid.outro', timestamp: null, errors: [] });
  assert.equal(unknown.w.cas.length, 0);
  assert.equal(unknown.w.states.length, 0);
  const notSent = failureWorld(sentTask({ status: 'failed' }));
  await notSent.cadence.services.recordDeliveryFailure({ userId: USER, waNumber: MAIN, messageId: 'wamid.sent1', timestamp: null, errors: [] });
  assert.equal(notSent.w.cas.length, 0);
});

test('recordDeliveryFailure: avanço já feito fica como está', async () => {
  const done = sentTask({ generation_meta: { advance: { state: 'done', due_at: ago(1), result: 'moved' } } });
  const { w, cadence } = failureWorld(done);
  await cadence.services.recordDeliveryFailure({ userId: USER, waNumber: MAIN, messageId: 'wamid.sent1', timestamp: null, errors: [] });
  assert.deepEqual(w.cas[0].patch.generation_meta.advance, { state: 'done', due_at: ago(1), result: 'moved' });
  assert.equal(w.cas[0].patch.last_error, 'A Meta não entregou a mensagem.');
  assert.equal(w.cas[0].patch.generation_meta.failure.at, T0.toISOString());
});

test('recordDeliveryFailure sem a migration 083 não derruba o webhook', async () => {
  const { cadence } = runtime(fakeRepo({ findTaskByMessageId: async () => { throw new CadenceMigrationMissing('42P01'); } }));
  await cadence.services.recordDeliveryFailure({ userId: USER, waNumber: MAIN, messageId: 'wamid.x', timestamp: null, errors: [] });
});

function forecastRuntime(h: SenderChannelHealth, template: CadenceTemplate | null) {
  const loads: string[] = [];
  const repo = fakeRepo({
    loadHealth: async () => { loads.push('health'); return h; },
    loadTemplate: async () => { loads.push('template'); return template; },
  });
  return { loads, ...runtime(repo) };
}

test('forecast: janela fechada e template elegível => meta_template com o texto renderizado', async () => {
  const { cadence, loads } = forecastRuntime(health(), TEMPLATE);
  const config = { ...BASE_CONFIG, template_id: 40 };
  const results = await cadence.services.forecast(USER, config, [
    { id: 1, contact_name: 'Ana Souza', text: 'Conseguiu dar uma olhada no orçamento?', step: 1, last_customer_at: ago(30), phone: CUSTOMER },
    { id: 2, contact_name: 'Bia', text: 'Oi! Ficou alguma dúvida?', step: 1, last_customer_at: ago(2), phone: CUSTOMER },
  ]);
  assert.equal(results[0].channel, 'meta_template');
  assert.equal(results[0].approval.channel_class, 'template');
  assert.equal(results[0].approval.template_id, 40);
  assert.equal(results[0].approval.render, 'Oi, Ana! Conseguiu dar uma olhada no orçamento?');
  assert.equal(results[1].channel, 'meta_text');
  assert.deepEqual(results[1].approval, { channel_class: 'text', render: null, template_id: null });
  // Saúde e template carregados uma vez para o lote.
  assert.deepEqual(loads.sort(), ['health', 'template']);
});

test('forecast: janela fechada sem template => blocked com approval de texto', async () => {
  const { cadence } = forecastRuntime(health(), null);
  const [r] = await cadence.services.forecast(USER, BASE_CONFIG, [
    { id: 1, contact_name: 'Ana', text: 'Oi', step: 1, last_customer_at: ago(30), phone: CUSTOMER },
  ]);
  assert.equal(r.channel, 'blocked');
  assert.deepEqual(r.approval, { channel_class: 'text', render: null, template_id: null });
});

test('channelHealth e listTemplates usam as funções puras do canal', async () => {
  const repo = fakeRepo({
    loadHealth: async () => health({ tokenExpiresAt: ago(-24 * 30) }),
    loadTemplate: async () => TEMPLATE,
    listTemplateRows: async () => [TEMPLATE, { ...TEMPLATE, id: 37, name: 'saudao', bodyText: 'Olá {{empresa}}', category: 'MARKETING' }],
  });
  const { cadence } = runtime(repo);
  const h = await cadence.services.channelHealth(USER, { ...BASE_CONFIG, template_id: 40 });
  assert.equal(h.template.eligible, true);
  assert.equal(h.can_send.outside_24h, true);
  const options = await cadence.services.listTemplates(USER);
  assert.equal(options[0].eligible, true);
  // A prévia usa o gancho neutro do passo 1; comparar com a constante evita
  // travar o teste toda vez que o tom das retomadas for ajustado.
  assert.equal(options[0].preview, `Oi, Maria! ${NEUTRAL_HOOKS[1]}`);
  assert.equal(options[1].eligible, false);
  assert.match(String(options[1].reason), /variáveis com nome/);
});

// Agendador (relógio falso)

test('agendador: roda a varredura das contas com intervalo vencido e consentimento', async (t) => {
  mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  t.after(() => mock.timers.reset());
  const swept: string[] = [];
  const logs: Array<{ event: string; data?: Record<string, unknown> }> = [];
  const entries = [
    { userId: 'due', config: BASE_CONFIG, state: { ...BASE_STATE, last_sweep_at: ago(2) } },
    { userId: 'recent', config: BASE_CONFIG, state: { ...BASE_STATE, last_sweep_at: ago(0.1) } },
    { userId: 'no-consent', config: BASE_CONFIG, state: { ...BASE_STATE, last_sweep_at: null, external_ai_consent_at: null } },
  ];
  const repo = fakeRepo({
    listConfigsForAutoSweep: async () => entries,
    listActiveConfigs: async () => [],
    loadConfig: async (u) => { swept.push(u); return { config: BASE_CONFIG, state: BASE_STATE, exists: false }; },
  });
  const { cadence } = runtime(repo, { logs });
  cadence.start();
  cadence.start();
  mock.timers.tick(SWEEP_SCHEDULER_MS);
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(swept, ['due']);
  assert.equal(logs.filter((l) => l.event === 'cadence_sweep_consent_required').length, 1);
  mock.timers.tick(SWEEP_SCHEDULER_MS);
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  // Log de consentimento espaçado: no máximo um a cada 10 min por conta.
  assert.equal(logs.filter((l) => l.event === 'cadence_sweep_consent_required').length, 1);
  assert.equal(cadence.services.sweepState('recent').next_auto_at, new Date(Date.parse(ago(0.1)) + 60 * 60_000).toISOString());
  cadence.stop();
});

test('sem a migration 083: sender e agendador ficam ociosos com um log só a cada 10 min', async (t) => {
  mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  t.after(() => mock.timers.reset());
  const logs: Array<{ event: string; data?: Record<string, unknown> }> = [];
  let clock = T0.getTime();
  const repo = fakeRepo({
    listConfigsForAutoSweep: async () => { throw new CadenceMigrationMissing('42P01'); },
    listActiveConfigs: async () => { throw new CadenceMigrationMissing('PGRST205'); },
  });
  const { cadence } = runtime(repo, { logs, now: () => new Date(clock) });
  cadence.start();
  for (let i = 0; i < 15; i++) {
    clock += SENDER_TICK_MS;
    mock.timers.tick(SENDER_TICK_MS);
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
  }
  cadence.stop();
  const missing = logs.filter((l) => l.event === 'cadence_migration_missing');
  assert.equal(missing.length, 1);
  assert.equal(logs.filter((l) => /failed/.test(l.event)).length, 0);
});

// Repositório com Supabase falso

type Filter = [string, ...unknown[]];
interface DbCall { kind: 'table' | 'rpc'; table: string; op: string; payload: any; columns: string | null; filters: Filter[]; single: 'maybe' | 'single' | null }
type Responder = (call: DbCall) => { data?: unknown; error?: { code?: string; message?: string } | null } | undefined;

class FakeQuery {
  call: DbCall;
  db: FakeSupabase;
  constructor(db: FakeSupabase, table: string) {
    this.db = db;
    this.call = { kind: 'table', table, op: 'select', payload: null, columns: null, filters: [], single: null };
  }
  select(columns?: string) { if (this.call.op === 'select') this.call.columns = columns ?? '*'; return this; }
  insert(payload: unknown) { this.call.op = 'insert'; this.call.payload = payload; return this; }
  update(payload: unknown) { this.call.op = 'update'; this.call.payload = payload; return this; }
  private add(name: string, ...args: unknown[]) { this.call.filters.push([name, ...args]); return this; }
  eq(c: string, v: unknown) { return this.add('eq', c, v); }
  neq(c: string, v: unknown) { return this.add('neq', c, v); }
  in(c: string, v: unknown[]) { return this.add('in', c, v); }
  is(c: string, v: unknown) { return this.add('is', c, v); }
  gt(c: string, v: unknown) { return this.add('gt', c, v); }
  gte(c: string, v: unknown) { return this.add('gte', c, v); }
  lt(c: string, v: unknown) { return this.add('lt', c, v); }
  lte(c: string, v: unknown) { return this.add('lte', c, v); }
  or(expr: string) { return this.add('or', expr); }
  not(c: string, op: string, v: unknown) { return this.add('not', c, op, v); }
  contains(c: string, v: unknown) { return this.add('contains', c, v); }
  order(c: string, o?: unknown) { return this.add('order', c, o); }
  limit(n: number) { return this.add('limit', n); }
  range(a: number, b: number) { return this.add('range', a, b); }
  maybeSingle() { this.call.single = 'maybe'; return this; }
  single() { this.call.single = 'single'; return this; }
  then(resolve: (v: any) => any, reject?: (e: any) => any) {
    return Promise.resolve().then(() => this.db.run(this.call)).then(resolve, reject);
  }
}

class FakeSupabase {
  calls: DbCall[] = [];
  responder: Responder;
  constructor(responder: Responder) { this.responder = responder; }
  from(table: string) { return new FakeQuery(this, table); }
  rpc(name: string, params: unknown) { return Promise.resolve().then(() => this.run({ kind: 'rpc', table: name, op: 'rpc', payload: params, columns: null, filters: [], single: null })); }
  run(call: DbCall) {
    this.calls.push(call);
    const r = this.responder(call) ?? {};
    if (r.error) return { data: null, error: r.error };
    const data = r.data === undefined ? (call.op === 'select' || call.kind === 'rpc' ? [] : null) : r.data;
    if (call.single && Array.isArray(data)) return { data: data[0] ?? null, error: null };
    return { data, error: null };
  }
}

const has = (call: DbCall, ...f: unknown[]) => call.filters.some((x) => JSON.stringify(x) === JSON.stringify(f));
const filterOf = (call: DbCall, name: string, column: string) => call.filters.find((f) => f[0] === name && f[1] === column);

function repoDeps(over: Partial<FollowUpRepoDeps> = {}): FollowUpRepoDeps {
  return {
    baileys: { status: () => 'close', registeredPhone: () => null, paired: () => false },
    decryptToken: (blob) => (blob === 'CIFRADO' ? 'token-claro' : null),
    refreshMetaState: async () => true,
    mainWaNumber: async () => MAIN,
    now: () => new Date(T0),
    ...over,
  };
}

test('repo: função ou tabela ausente vira CadenceMigrationMissing', async () => {
  const db = new FakeSupabase((c) => {
    if (c.table === 'followup_cadence_candidates') return { error: { code: 'PGRST202', message: 'função não encontrada' } };
    if (c.table === 'claim_cadence_followup') return { error: { code: '42883', message: 'function does not exist' } };
    if (c.table === 'followup_cadence_config') return { error: { code: '42P01', message: 'relation does not exist' } };
    return undefined;
  });
  const repo = createFollowUpRepo(db as any, repoDeps());
  await assert.rejects(repo.candidates(USER, ['proposal'], [MAIN], 768, 1000), (e: unknown) => isCadenceMigrationMissing(e) && (e as CadenceMigrationMissing).code === 'PGRST202');
  await assert.rejects(repo.claim(USER, 'w', 300, 60, T0.toISOString()), (e: unknown) => (e as Error).name === 'CadenceMigrationMissing');
  await assert.rejects(repo.loadConfig(USER), CadenceMigrationMissing);
  await assert.rejects(repo.listActiveConfigs(), CadenceMigrationMissing);
});

test('repo: candidates chama a RPC com os parâmetros e mapeia as linhas', async () => {
  const db = new FakeSupabase((c) => (c.table === 'followup_cadence_candidates'
    ? { data: [{ deal_id: 3, stage: 'proposal', contact_phone: CUSTOMER, phone_key: null, last_studio_at: ago(30), needs_human: false }] }
    : undefined));
  const repo = createFollowUpRepo(db as any, repoDeps());
  const [a] = await repo.candidates(USER, ['proposal'], [MAIN], 768.4, 1000);
  assert.deepEqual(db.calls[0].payload, { p_user_id: USER, p_stage_ids: ['proposal'], p_wa_numbers: [MAIN], p_lookback_hours: 768, p_limit: 1000 });
  assert.equal(a.dealId, 3);
  assert.equal(a.phoneKey, canonicalPhoneKey(CUSTOMER));
  assert.equal(a.lastStudioAt, ago(30));
});

test('repo: insertTask nunca manda phone_key; 23505 => duplicate; outro erro lança', async () => {
  let answer: { code: string; message: string } | null = null;
  const db = new FakeSupabase((c) => (c.op === 'insert' ? { error: answer } : undefined));
  const repo = createFollowUpRepo(db as any, repoDeps());
  assert.equal(await repo.insertTask({ user_id: USER, kind: 'cadence', status: 'draft', phone_key: 'x' }), 'ok');
  assert.ok(!('phone_key' in db.calls[0].payload));
  answer = { code: '23505', message: 'duplicate key' };
  assert.equal(await repo.insertTask({ user_id: USER, kind: 'cadence', status: 'draft' }), 'duplicate');
  answer = { code: '23514', message: 'check violation' };
  await assert.rejects(repo.insertTask({ user_id: USER }), /check violation/);
});

test('repo: updateTaskCas filtra conta, kind, status, updated_at e lease; 23505 => null', async () => {
  let error: { code: string; message: string } | null = null;
  const db = new FakeSupabase((c) => (c.op === 'update' ? (error ? { error } : { data: [{ id: 9, deal_id: 1, step: 1, generation_meta: '{"regenerations":1}', updated_at: 'u2' }] }) : undefined));
  const repo = createFollowUpRepo(db as any, repoDeps());
  const row = await repo.updateTaskCas(9, USER, { status: 'draft', phone_key: 'x' }, { statuses: ['approved'], updatedAt: 'u1', noLiveLeaseAt: T0.toISOString() });
  const call = db.calls[0];
  assert.ok(has(call, 'eq', 'user_id', USER) && has(call, 'eq', 'kind', 'cadence') && has(call, 'eq', 'id', 9));
  assert.ok(has(call, 'in', 'status', ['approved']) && has(call, 'eq', 'updated_at', 'u1'));
  assert.ok(has(call, 'or', `claimed_at.is.null,lease_expires_at.lt.${T0.toISOString()}`));
  assert.ok(!('phone_key' in call.payload));
  assert.deepEqual(row?.generation_meta, { regenerations: 1 });
  error = { code: '23505', message: 'live index' };
  assert.equal(await repo.updateTaskCas(9, USER, { status: 'draft' }, { statuses: ['skipped'] }), null);
});

function snapshotDb(opts: { queueKind?: string } = {}) {
  const t = (iso: string) => unix(iso);
  return new FakeSupabase((c) => {
    if (c.table === 'deals') return { data: [{ id: 7, stage: 'proposal', converted: false, converted_job_id: null, contact_name: 'Ana' }] };
    if (c.table === 'deal_stages') return { data: [{ id: 'proposal', name: 'Orçamento', position: 2, is_final: false, is_won: false }] };
    if (c.table === 'wa_messages' && has(c, 'eq', 'from_me', false)) return { data: [{ timestamp: ago(20) }] };
    if (c.table === 'wa_messages' && filterOf(c, 'in', 'message_id')) return { data: [{ message_id: 'wamid.known' }] };
    if (c.table === 'wa_messages' && filterOf(c, 'gte', 'timestamp')) return { data: [] };
    if (c.table === 'wa_messages' && filterOf(c, 'not', 'message_id')) return { data: [{ phone: '554311112222' }] };
    if (c.table === 'wa_messages' && has(c, 'eq', 'from_me', true)) return { data: [{ timestamp: ago(12), status: 'failed' }, { timestamp: ago(30), status: 'sent' }] };
    if (c.table === 'scheduled_followups' && has(c, 'eq', 'kind', 'legacy')) return { data: [{ sent_at: ago(25) }] };
    if (c.table === 'whatsapp_webhook_inbox' && has(c, 'neq', 'status', 'processed')) {
      return { data: [{ received_at: ago(3), kind: opts.queueKind ?? 'message', mtype: 'text' }, { received_at: ago(1), kind: 'message', mtype: 'reaction' }] };
    }
    if (c.table === 'whatsapp_webhook_inbox' && has(c, 'eq', 'payload->>kind', 'status')) {
      return { data: [
        { sid: 'wamid.bot', sstatus: 'read', sts: t(ago(9)) }, { sid: 'wamid.bot', sstatus: 'sent', sts: t(ago(10)) },
        { sid: 'wamid.fail', sstatus: 'sent', sts: t(ago(8)) }, { sid: 'wamid.fail', sstatus: 'failed', sts: t(ago(8)) },
        { sid: 'wamid.known', sstatus: 'sent', sts: t(ago(7)) },
      ] };
    }
    if (c.table === 'followup_optouts') return { data: [] };
    if (c.table === 'followup_customer_phone_keys') return { data: [{ phone_key: '5543999990000' }] };
    if (c.table === 'wa_conversations') {
      return { data: [
        { phone: CUSTOMER, wa_number: MAIN, needs_human: false, agent_status: 'idle', last_message_at: ago(1) },
        { phone: '554311112222', wa_number: MAIN, needs_human: false, agent_status: 'needs_human', last_message_at: ago(5) },
      ] };
    }
    assert.fail(`consulta inesperada: ${c.table} ${JSON.stringify(c.filters)}`);
  });
}

test('repo: snapshot junta resposta em qualquer número, fila do webhook, legado e IA oficial', async () => {
  const db = snapshotDb();
  const repo = createFollowUpRepo(db as any, repoDeps());
  const snap = await repo.loadSendSnapshot(sentTask({ status: 'sending', basis_at: ago(30) }), [MAIN]);
  // Cliente: wa_messages (20h) perde para a fila não processada (3h); a reação na fila não conta.
  assert.equal(snap.lastCustomerAt, ago(3));
  const customerCall = db.calls.find((c) => c.table === 'wa_messages' && has(c, 'eq', 'from_me', false)) as DbCall;
  assert.equal(filterOf(customerCall, 'in', 'wa_number'), undefined);
  assert.ok(has(customerCall, 'or', 'type.is.null,type.not.in.(reaction,edit,revoke)'));
  // Estúdio: pula o failed (12h) e o legado enviado (25h) vence o texto de 30h.
  assert.equal(snap.lastStudioAt, ago(25));
  // IA oficial: só o wamid sem falha e sem linha em wa_messages, no instante do 'sent'.
  assert.equal(snap.lastInvisibleOutAt, ago(10));
  const queueCall = db.calls.find((c) => c.table === 'whatsapp_webhook_inbox' && has(c, 'neq', 'status', 'processed')) as DbCall;
  assert.ok(has(queueCall, 'in', 'payload->>kind', ['message', 'smb_message_echo']));
  assert.ok(has(queueCall, 'gt', 'received_at', new Date(Date.parse(ago(30)) - 5 * 60_000).toISOString()));
  assert.equal(snap.deal?.id, 7);
  assert.equal(snap.optedOut, false);
  assert.equal(snap.alreadyCustomer, false);
  assert.equal(snap.needsHuman, true);
  // Conversa preferida: o telefone que o QR já viu.
  assert.equal(snap.conversationPhone, '554311112222');
  assert.equal(snap.conversationWaNumber, MAIN);
  assert.deepEqual(snap.seenBaileysPhones, ['554311112222']);
  for (const c of db.calls.filter((x) => x.kind === 'table')) assert.ok(has(c, 'eq', 'user_id', USER), `${c.table} sem user_id`);
});

test('repo: eco do celular na fila conta como fala do estúdio', async () => {
  const repo = createFollowUpRepo(snapshotDb({ queueKind: 'smb_message_echo' }) as any, repoDeps());
  const snap = await repo.loadSendSnapshot(sentTask({ status: 'sending', basis_at: ago(30) }), [MAIN]);
  assert.equal(snap.lastStudioAt, ago(3));
  assert.equal(snap.lastCustomerAt, ago(20));
});

test('invisibleCandidates agrupa por wamid, usa o sent e descarta falhas', () => {
  const s = (sid: string, sstatus: string, sts: string) => ({ sid, sstatus, sts });
  const found = invisibleCandidates([
    s('a', 'read', '1700000100'), s('a', 'sent', '1700000050'), s('b', 'delivered', '1700000200'),
    s('c', 'sent', '1700000300'), s('c', 'failed', '1700000301'), s('d', 'sent', 'nao-e-numero'), s('', 'sent', '1700000400'),
  ]);
  assert.deepEqual(found, [{ id: 'a', atMs: 1700000050000 }, { id: 'b', atMs: 1700000200000 }]);
});

function healthDb(calls: { quality: string[] }) {
  return new FakeSupabase((c) => {
    if (c.table === 'whatsapp_business_accounts') {
      return { data: [{ id: 'acc', user_id: USER, waba_id: 'w', phone_number_id: 'pnid-1', phone_number: '+55 43 90000-1111', access_token: 'CIFRADO', token_expires_at: ago(-240), mode: 'cloud_api' }] };
    }
    if (c.table === 'whatsapp_channel_accounts' && c.single) {
      return { data: [{ id: 'ch', preferred_channel: 'auto', mode: 'cloud_api', sync_status: 'idle', sync_attempts: 0,
        sync_details: { meta_operational: true, meta_status_checked_at: new Date().toISOString(), phone_status: { platform_type: 'CLOUD_API', status: 'CONNECTED' } } }] };
    }
    if (c.table === 'whatsapp_channel_accounts') return { data: calls.quality.map((q) => ({ sync_details: { phone_status: { quality_rating: q } }, mode: 'cloud_api' })) };
    if (c.table === 'wa_message_key_id') return { error: { code: 'PGRST202', message: 'sem 085' } };
    assert.fail(`consulta inesperada: ${c.table}`);
  });
}

test('repo: loadHealth decifra o token, pega a pior qualidade e guarda cache de 60s', async () => {
  let clock = T0.getTime();
  const refreshed: string[] = [];
  const decrypted: unknown[] = [];
  const db = healthDb({ quality: ['GREEN', 'YELLOW'] });
  const repo = createFollowUpRepo(db as any, repoDeps({
    now: () => new Date(clock),
    refreshMetaState: async (u) => { refreshed.push(u); return true; },
    decryptToken: (blob) => { decrypted.push(blob); return blob === 'CIFRADO' ? 'token-claro' : null; },
    mainWaNumber: async () => 'unassigned:main',
  }));
  const h = await repo.loadHealth(USER, BASE_CONFIG);
  assert.equal(h.meta.token, 'token-claro');
  assert.deepEqual(decrypted, ['CIFRADO']);
  assert.equal(h.meta.configured, true);
  assert.equal(h.meta.operational, true);
  assert.equal(h.meta.waNumber, MAIN);
  assert.equal(h.meta.qualityRating, 'YELLOW');
  assert.equal(h.meta.tokenExpiresAt, ago(-240));
  assert.equal(h.mainWaNumber, null);
  assert.equal(h.dedupeReady, false);
  assert.equal(h.preferredChannel, 'auto');
  assert.deepEqual(refreshed, [USER]);
  const before = db.calls.length;
  clock += 30_000;
  await repo.loadHealth(USER, BASE_CONFIG);
  assert.equal(db.calls.length, before);
  clock += 40_000;
  await repo.loadHealth(USER, BASE_CONFIG);
  assert.ok(db.calls.length > before);
  // Refresh da Meta no máximo a cada 5 min.
  assert.deepEqual(refreshed, [USER]);
  repo.invalidate(USER);
  await repo.loadHealth(USER, { ...BASE_CONFIG, wa_number: MAIN });
  assert.equal((await repo.loadHealth(USER, { ...BASE_CONFIG, wa_number: MAIN })).mainWaNumber, MAIN);
});

test('worstQuality: RED > YELLOW > GREEN; desconhecido pesa como queda; vazio => null', () => {
  assert.equal(worstQuality(['GREEN', 'red', 'YELLOW']), 'RED');
  assert.equal(worstQuality(['GREEN', 'UNKNOWN']), 'GREEN');
  assert.equal(worstQuality(['GREEN', 'FLAGGED']), 'FLAGGED');
  assert.equal(worstQuality([null, undefined, '']), null);
});

test('repo: prova e desfecho só casam com a tarefa em sending do mesmo claim', async () => {
  const db = new FakeSupabase((c) => (c.op === 'update' ? { data: [{ id: 501 }] } : undefined));
  const repo = createFollowUpRepo(db as any, repoDeps());
  const task = sentTask({ status: 'sending', claimed_at: '2026-09-18T14:59:59.123456+00:00', generation_meta: { prev_status: 'approved' } });
  assert.equal(await repo.recordDeliveryProof(task, { message_ids: ['wamid.a'], channel: 'meta_text', delivered_text: 'Oi' }), true);
  const proof = db.calls[0];
  assert.ok(has(proof, 'eq', 'status', 'sending') && has(proof, 'eq', 'claimed_at', '2026-09-18T14:59:59.123456+00:00'));
  assert.equal(proof.payload.sent_message_id, 'wamid.a');
  assert.deepEqual(proof.payload.generation_meta, {
    prev_status: 'approved', delivery: { message_ids: ['wamid.a'], delivered_text: 'Oi', channel: 'meta_text', proof_at: T0.toISOString() },
  });
  await repo.finish(task, { status: 'sent', release_claim: true, sent_at: T0.toISOString(), generation_meta_merge: { advance: { state: 'pending', due_at: 'x' } } });
  const fin = db.calls[1];
  assert.ok(has(fin, 'eq', 'claimed_at', '2026-09-18T14:59:59.123456+00:00') && has(fin, 'eq', 'user_id', USER));
  assert.equal(fin.payload.claimed_at, null);
  assert.equal(fin.payload.lease_expires_at, null);
  assert.equal(fin.payload.status, 'sent');
  assert.deepEqual(fin.payload.generation_meta, { prev_status: 'approved', advance: { state: 'pending', due_at: 'x' } });
  assert.ok(!('phone_key' in fin.payload));
});

test('repo: persistOutbound grava a mensagem e só avança a conversa', async () => {
  let existing: unknown[] = [{ id: 44 }];
  const db = new FakeSupabase((c) => {
    if (c.table === 'wa_messages') return { error: { code: '23505', message: 'duplicate' } };
    if (c.table === 'wa_conversations' && c.op === 'select') return { data: existing };
    return { data: null };
  });
  const repo = createFollowUpRepo(db as any, repoDeps());
  const record = { userId: USER, phone: CUSTOMER, waNumber: MAIN, messageId: 'wamid.z', body: 'Oi, Ana!', channel: 'meta_text' as const, timestampIso: T0.toISOString() };
  await repo.persistOutbound(record);
  const msg = db.calls[0];
  assert.equal(msg.op, 'insert');
  assert.deepEqual(msg.payload, { user_id: USER, phone: CUSTOMER, message_id: 'wamid.z', body: 'Oi, Ana!', from_me: true, timestamp: T0.toISOString(), type: 'text', status: 'sent', wa_number: MAIN });
  const upd = db.calls[2];
  assert.equal(upd.op, 'update');
  assert.deepEqual(upd.payload, { last_message: 'Oi, Ana!', last_message_at: T0.toISOString(), last_from_me: true, updated_at: T0.toISOString() });
  assert.ok(has(upd, 'or', `last_message_at.is.null,last_message_at.lt.${T0.toISOString()}`));
  existing = [];
  await repo.persistOutbound(record);
  const ins = db.calls[db.calls.length - 1];
  assert.equal(ins.op, 'insert');
  assert.equal(ins.table, 'wa_conversations');
  assert.ok(!('unread_count' in ins.payload) && !('agent_status' in ins.payload));
});

test('repo: findTaskByMessageId procura no sent_message_id e depois em qualquer balão', async () => {
  const db = new FakeSupabase((c) => (filterOf(c, 'contains', 'generation_meta') ? { data: [{ id: 3, deal_id: 1, step: 2, generation_meta: {} }] } : { data: [] }));
  const repo = createFollowUpRepo(db as any, repoDeps());
  const t = await repo.findTaskByMessageId(USER, 'wamid.b2');
  assert.equal(t?.id, 3);
  assert.ok(has(db.calls[0], 'eq', 'sent_message_id', 'wamid.b2'));
  assert.ok(has(db.calls[1], 'contains', 'generation_meta', { delivery: { message_ids: ['wamid.b2'] } }));
  assert.ok(has(db.calls[1], 'eq', 'kind', 'cadence') && has(db.calls[1], 'eq', 'user_id', USER));
});

test('repo: avanços pendentes pelo jsonb e markAdvance preserva o due_at', async () => {
  const db = new FakeSupabase((c) => (c.op === 'select' ? { data: [{ id: 1, deal_id: 2, step: 1, generation_meta: { advance: { state: 'pending', due_at: 'd1' } } }] } : { data: null }));
  const repo = createFollowUpRepo(db as any, repoDeps());
  const [task] = await repo.listPendingAdvances(USER, T0.toISOString(), 10);
  assert.ok(has(db.calls[0], 'eq', 'generation_meta->advance->>state', 'pending'));
  assert.ok(has(db.calls[0], 'lte', 'generation_meta->advance->>due_at', T0.toISOString()));
  await repo.markAdvance({ ...task, user_id: USER }, 'done', 'moved');
  assert.deepEqual(db.calls[1].payload.generation_meta.advance, { due_at: 'd1', state: 'done', result: 'moved' });
  assert.ok(has(db.calls[1], 'eq', 'status', 'sent'));
});

test('repo: cancelTasks mescla cancel_reason e só cancela vivas não enviadas', async () => {
  const db = new FakeSupabase((c) => (c.op === 'select' ? { data: [{ id: 5, generation_meta: { outcome: 'draft' } }] } : { data: [{ id: 5 }] }));
  const repo = createFollowUpRepo(db as any, repoDeps());
  const done = await repo.cancelTasks(USER, [{ id: 5, reason: 'stage_changed' }, { id: 6, reason: 'optout' }]);
  assert.deepEqual(done, [5]);
  const upd = db.calls[1];
  assert.deepEqual(upd.payload.generation_meta, { outcome: 'draft', cancel_reason: 'stage_changed' });
  assert.equal(upd.payload.last_error, 'cancel:stage_changed');
  assert.ok(has(upd, 'in', 'status', ['draft', 'approved', 'blocked']));
});

test('repo: updateState grava só colunas de estado', async () => {
  const db = new FakeSupabase(() => ({ data: null }));
  const repo = createFollowUpRepo(db as any, repoDeps());
  await repo.updateState(USER, { consecutive_errors: 1, enabled: true } as any);
  assert.deepEqual(db.calls[0].payload, { consecutive_errors: 1 });
  assert.ok(has(db.calls[0], 'eq', 'user_id', USER));
});

// Transporte real

test('graphSend: rede ou timeout => ambíguo; resposta sem id => ambíguo; erro com código', async () => {
  const seen: Array<{ url: string; init: any }> = [];
  const responses: Array<() => Promise<Response>> = [
    async () => { throw new Error('The operation was aborted due to timeout'); },
    async () => new Response(JSON.stringify({ messages: [] }), { status: 200 }),
    async () => new Response(JSON.stringify({ error: { code: 131047, message: 'Re-engagement message' } }), { status: 400 }),
    async () => new Response('<html>bad gateway</html>', { status: 502 }),
    async () => new Response(JSON.stringify({ messages: [{ id: 'wamid.ok' }] }), { status: 200 }),
  ];
  const transport = createSenderTransport({
    baileys: { sendText: async () => 'x', sendTyping: async () => {} },
    fetch: (async (url: string, init: any) => { seen.push({ url, init }); return (responses.shift() as () => Promise<Response>)(); }) as typeof fetch,
  });
  const payload = { messaging_product: 'whatsapp', to: CUSTOMER, type: 'text', text: { body: 'Oi' } };
  const r1 = await transport.graphSend('pnid-1', 'token-claro', payload);
  assert.equal(r1.ok, false);
  assert.equal((r1 as any).ambiguous, true);
  assert.equal((r1 as any).httpStatus, 0);
  assert.equal((await transport.graphSend('pnid-1', 't', payload) as any).ambiguous, true);
  assert.deepEqual(await transport.graphSend('pnid-1', 't', payload), { ok: false, httpStatus: 400, code: 131047, message: 'Re-engagement message' });
  assert.equal((await transport.graphSend('pnid-1', 't', payload) as any).ambiguous, true);
  assert.deepEqual(await transport.graphSend('pnid-1', 't', payload), { ok: true, messageId: 'wamid.ok' });
  assert.equal(seen[0].url, 'https://graph.facebook.com/v21.0/pnid-1/messages');
  assert.equal(seen[0].init.method, 'POST');
  assert.equal(seen[0].init.headers.Authorization, 'Bearer token-claro');
  assert.deepEqual(JSON.parse(seen[0].init.body), payload);
  assert.ok(seen[0].init.signal);
});

test('graphResultFrom: código ausente vira null', () => {
  assert.deepEqual(graphResultFrom(500, false, { error: { message: 'x' } }), { ok: false, httpStatus: 500, code: null, message: 'x' });
});

test('baileysSendText com timeout => BAILEYS_TIMEOUT; typing engole erro', async () => {
  const transport = createSenderTransport({
    baileys: {
      sendText: () => new Promise<string>(() => {}),
      sendTyping: async () => { throw new Error('socket fechado'); },
    },
    baileysTimeoutMs: 20,
  });
  await assert.rejects(transport.baileysSendText(USER, '554311112222', 'Oi'), /BAILEYS_TIMEOUT/);
  await transport.baileysTyping(USER, '554311112222', true);
  const ok = createSenderTransport({ baileys: { sendText: async () => 'ABC123', sendTyping: async () => {} } });
  assert.equal(await ok.baileysSendText(USER, '554311112222', 'Oi'), 'ABC123');
});

test('repo: conversa assumida por uma pessoa (human_active) segura a cadência como needs_human', () => {
  assert.equal(needsHuman([{ needs_human: false, agent_status: 'human_active' }]), true);
  assert.equal(needsHuman([{ needs_human: false, agent_status: 'needs_human' }]), true);
  assert.equal(needsHuman([{ needs_human: true, agent_status: 'idle' }]), true);
  assert.equal(needsHuman([{ needs_human: false, agent_status: 'lia_active' }, { needs_human: null, agent_status: null }]), false);
  assert.equal(needsHuman([]), false);
});

// Mensagens fixas (087)

const FIXED_TEXTS = ['Oiiii [nome], tudo bem 🥰?\n\nVamos ver uma data para as suas fotos?', 'Oiiii [nome], tudo bem? 🥰'];
const FIXED_CONFIG: FollowUpConfig = { ...BASE_CONFIG, message_mode: 'fixed', fixed_messages: FIXED_TEXTS };
const fixedName = (step: number) => fixedTemplateName(step, FIXED_TEXTS[step - 1]);
const fixedTemplate = (step: number, status = 'APPROVED'): CadenceTemplate => ({
  id: 70 + step, name: fixedName(step), language: 'pt_BR', bodyText: fixedTemplateBody(FIXED_TEXTS[step - 1]), status,
  category: 'MARKETING', headerText: null, buttons: [],
});
const settle = async (rounds = 12) => { for (let i = 0; i < rounds; i++) await new Promise((resolve) => setImmediate(resolve)); };

function graphFetch(replies: Array<{ status: number; body: unknown }>) {
  const calls: Array<{ url: string; method: string; body: any }> = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, method: String(init.method), body: init.body ? JSON.parse(String(init.body)) : null });
    const reply = replies.shift() ?? { status: 500, body: { error: { message: 'sem resposta' } } };
    return { ok: reply.status < 300, status: reply.status, json: async () => reply.body } as Response;
  }) as unknown as typeof fetch;
  return { fn, calls };
}

test('forecast com mensagem fixa: template do passo pelo nome (uma consulta) e texto editado segue o fluxo normal', async () => {
  const names: string[][] = [];
  const repo = fakeRepo({
    loadHealth: async () => health(), loadTemplate: async () => TEMPLATE,
    templatesByName: async (_u, list) => { names.push(list); return [fixedTemplate(1)]; },
  });
  const { cadence } = runtime(repo);
  const ref = { source: FIXED_TEXTS[0], template_name: fixedName(1) };
  const exact = renderFixedMessage(FIXED_TEXTS[0], 'Ana');
  const [fixed, edited, inside] = await cadence.services.forecast(USER, { ...FIXED_CONFIG, template_id: 40 }, [
    { id: 1, contact_name: 'Ana Souza', text: exact, step: 1, last_customer_at: ago(30), phone: CUSTOMER, fixed: ref },
    { id: 2, contact_name: 'Ana Souza', text: `${exact} Editado.`, step: 1, last_customer_at: ago(30), phone: CUSTOMER, fixed: ref },
    { id: 3, contact_name: 'Ana Souza', text: exact, step: 1, last_customer_at: ago(2), phone: CUSTOMER, fixed: ref },
  ]);
  assert.deepEqual(names, [[fixedName(1)]]);
  assert.equal(fixed.channel, 'meta_template');
  assert.deepEqual(fixed.approval, { channel_class: 'template', render: exact, template_id: 71 });
  assert.equal(edited.approval.template_id, 40, 'editado: template geral');
  assert.deepEqual(inside.approval, { channel_class: 'text', render: null, template_id: null });
});

test('channelHealth no modo fixo conta os templates aprovados; leitura com erro não derruba a saúde', async () => {
  const repo = fakeRepo({
    loadHealth: async () => health(), loadTemplate: async () => null,
    templatesByName: async () => [fixedTemplate(1), fixedTemplate(2, 'PENDING')],
  });
  const partial = await runtime(repo).cadence.services.channelHealth(USER, FIXED_CONFIG);
  assert.deepEqual(partial.fixed, { total: 2, approved: 1 });
  assert.equal(partial.can_send.outside_24h, false);
  repo.templatesByName = async () => [fixedTemplate(1), fixedTemplate(2)];
  assert.equal((await runtime(repo).cadence.services.channelHealth(USER, FIXED_CONFIG)).can_send.outside_24h, true);
  repo.templatesByName = async () => { throw new Error('banco fora'); };
  const logs: Array<{ event: string }> = [];
  const down = await runtime(repo, { logs }).cadence.services.channelHealth(USER, FIXED_CONFIG);
  assert.equal(down.fixed, null);
  assert.ok(logs.some((l) => l.event === 'cadence_fixed_summary_failed'));
});

test('agendador no modo fixo: cuida dos templates antes de varrer (no máximo a cada 10 min) e varre sem consentimento', async (t) => {
  mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  t.after(() => mock.timers.reset());
  let clock = T0.getTime();
  const swept: string[] = [];
  const requeued: string[][] = [];
  const entry = { userId: 'fixa', config: FIXED_CONFIG, state: { ...BASE_STATE, external_ai_consent_at: null, last_sweep_at: ago(2) } };
  const repo = fakeRepo({
    listConfigsForAutoSweep: async () => [entry],
    listActiveConfigs: async () => [],
    loadConfig: async (u) => { swept.push(u); return { config: FIXED_CONFIG, state: entry.state, exists: false }; },
    templatesByName: async () => [{ ...fixedTemplate(1, 'PENDING'), metaTemplateId: '71' }, fixedTemplate(2)],
    metaTemplateAccount: async () => ({ wabaId: 'waba-1', token: 'tok' }),
    updateTemplateRow: async () => {},
    requeueFixedBlocked: async (_u, names) => { requeued.push(names); return 0; },
  });
  const graph = graphFetch([{ status: 200, body: { data: [{ id: '71', name: fixedName(1), status: 'APPROVED', language: 'pt_BR' }] } }]);
  const { cadence } = runtime(repo, { now: () => new Date(clock), fetch: graph.fn });
  cadence.start();
  mock.timers.tick(SWEEP_SCHEDULER_MS);
  await settle();
  assert.equal(graph.calls.length, 1, 'consultou o template em análise');
  assert.deepEqual(requeued, [[fixedName(1), fixedName(2)]], 'aprovados soltam as tarefas que esperavam');
  assert.deepEqual(swept, ['fixa'], 'varre sem o consentimento da IA');
  clock += SWEEP_SCHEDULER_MS;
  mock.timers.tick(SWEEP_SCHEDULER_MS);
  await settle();
  assert.equal(graph.calls.length, 1, 'menos de 10 min: não roda de novo');
  clock += FIXED_TEMPLATES_EVERY_MS;
  mock.timers.tick(SWEEP_SCHEDULER_MS);
  await settle();
  assert.equal(requeued.length, 2, 'depois de 10 min roda de novo');
  cadence.stop();
});

test('requestFixedTemplates: roda na hora no modo fixo, lembra o erro de criação e solta as tarefas quando aprova', async () => {
  const requeued: string[][] = [];
  const inserted: Array<Record<string, unknown>> = [];
  const repo = fakeRepo({
    loadConfig: async () => ({ config: FIXED_CONFIG, state: BASE_STATE, exists: true }),
    templatesByName: async () => [],
    metaTemplateAccount: async () => ({ wabaId: 'waba-1', token: 'tok' }),
    saveTemplateRow: async (row) => { inserted.push(row); },
    requeueFixedBlocked: async (_u, names) => { requeued.push(names); return 1; },
    listActiveConfigs: async () => [],
  });
  const graph = graphFetch([
    { status: 200, body: { id: '10', status: 'APPROVED', category: 'MARKETING' } },
    { status: 400, body: { error: { message: 'Invalid parameter' } } },
    { status: 200, body: { data: [] } },
  ]);
  const logs: Array<{ event: string; data?: Record<string, unknown> }> = [];
  const { cadence } = runtime(repo, { fetch: graph.fn, logs });
  cadence.services.requestFixedTemplates?.(USER);
  await settle();
  assert.equal(inserted.length, 1);
  assert.equal(inserted[0].name, fixedName(1));
  assert.deepEqual(cadence.services.fixedTemplateErrors?.(USER), { [fixedName(2)]: 'Invalid parameter' });
  assert.deepEqual(requeued, [[fixedName(1)]]);
  assert.ok(logs.some((l) => l.event === 'cadence_fixed_requeued'));
  // Modo IA: nada acontece.
  const ai = runtime(fakeRepo({ loadConfig: async () => ({ config: BASE_CONFIG, state: BASE_STATE, exists: true }) }), { fetch: graphFetch([]).fn });
  ai.cadence.services.requestFixedTemplates?.(USER);
  await settle();
  assert.deepEqual(ai.cadence.services.fixedTemplateErrors?.(USER), {});
});

test('repo: templates por nome (user_id texto), conta da Meta decifrada, cache gravado e 23505 atualiza', async () => {
  let insertError: { code: string; message: string } | null = null;
  const db = new FakeSupabase((c) => {
    if (c.table === 'whatsapp_message_templates' && c.op === 'select') {
      return { data: [{ id: 71, name: fixedName(1), language: 'pt_BR', body_text: 'Oi {{1}}', status: 'REJECTED', category: 'MARKETING',
        header_text: null, buttons: [], rejection_reason: 'Parece promoção', meta_template_id: '999' }] };
    }
    if (c.table === 'whatsapp_message_templates' && c.op === 'insert') return { error: insertError };
    if (c.table === 'whatsapp_business_accounts') return { data: [{ waba_id: ' waba-9 ', access_token: 'CIFRADO' }] };
    return undefined;
  });
  const repo = createFollowUpRepo(db as any, repoDeps());
  const [row] = await repo.templatesByName(USER, [fixedName(1)]);
  assert.equal(row.rejectionReason, 'Parece promoção');
  assert.equal(row.metaTemplateId, '999');
  const select = db.calls[0];
  assert.ok(has(select, 'eq', 'user_id', USER) && has(select, 'in', 'name', [fixedName(1)]));
  assert.equal((await repo.loadTemplateByName!(USER, fixedName(1)))?.id, 71);
  assert.deepEqual(await repo.templatesByName(USER, []), []);
  assert.deepEqual(await repo.metaTemplateAccount(USER), { wabaId: 'waba-9', token: 'token-claro' });
  await repo.saveTemplateRow({ user_id: USER, name: fixedName(1), status: 'PENDING', rejection_reason: null, meta_template_id: '5', updated_at: T0.toISOString() });
  insertError = { code: '23505', message: 'duplicate key' };
  await repo.saveTemplateRow({ user_id: USER, name: fixedName(1), status: 'APPROVED', rejection_reason: null, meta_template_id: '5', updated_at: T0.toISOString() });
  const update = db.calls.find((c) => c.table === 'whatsapp_message_templates' && c.op === 'update') as DbCall;
  assert.deepEqual(update.payload, { status: 'APPROVED', rejection_reason: null, meta_template_id: '5', updated_at: T0.toISOString() });
  assert.ok(has(update, 'eq', 'user_id', USER) && has(update, 'eq', 'name', fixedName(1)));
  insertError = { code: '23514', message: 'check' };
  await assert.rejects(repo.saveTemplateRow({ user_id: USER, name: 'x' }), /check/);
});

test('repo: conta da Meta sem waba ou sem token decifrável => null', async () => {
  for (const data of [[], [{ waba_id: '', access_token: 'CIFRADO' }], [{ waba_id: 'w', access_token: 'LIXO' }]]) {
    const repo = createFollowUpRepo(new FakeSupabase(() => ({ data })) as any, repoDeps());
    assert.equal(await repo.metaTemplateAccount(USER), null, JSON.stringify(data));
  }
});

test('repo: requeueFixedBlocked só solta bloqueadas por template em análise daquele nome; nome do card cai no título', async () => {
  const db = new FakeSupabase((c) => {
    if (c.table === 'scheduled_followups' && c.op === 'update') return { data: [{ id: 1 }, { id: 2 }] };
    if (c.table === 'deals') return { data: [{ contact_name: '  ', title: 'Ensaio Duda' }] };
    return undefined;
  });
  const repo = createFollowUpRepo(db as any, repoDeps());
  assert.equal(await repo.requeueFixedBlocked(USER, [fixedName(1)]), 2);
  const call = db.calls[0];
  assert.deepEqual(call.payload, { status: 'approved', last_error: null, updated_at: T0.toISOString() });
  for (const f of [['eq', 'user_id', USER], ['eq', 'kind', 'cadence'], ['eq', 'status', 'blocked'], ['not', 'approved_at', 'is', null],
    ['eq', 'generation_meta->>block_code', 'fixed_template_pending'], ['in', 'generation_meta->fixed->>template_name', [fixedName(1)]]]) {
    assert.ok(has(call, ...f), JSON.stringify(f));
  }
  assert.equal(await repo.requeueFixedBlocked(USER, []), 0);
  assert.equal(await repo.dealContactName!(USER, 7), 'Ensaio Duda');
  const deal = db.calls.find((c) => c.table === 'deals') as DbCall;
  assert.ok(has(deal, 'eq', 'user_id', USER) && has(deal, 'eq', 'id', 7));
});

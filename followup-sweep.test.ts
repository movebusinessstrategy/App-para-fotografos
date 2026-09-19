import assert from 'node:assert/strict';
import test from 'node:test';
import { createCadenceSweep, MAX_REGENERATIONS } from './followup-sweep.js';
import type { CadenceSweepRepo, ConversationRow, OptOutInput, TaskCasOptions } from './followup-sweep.js';
import type { AiAgentConfigRow, DraftInput, DraftMeta, DraftResult } from './followup-draft.js';
import type { CadenceTaskLite, DealActivity } from './followup-cadence.js';
import { resolveExpiredLease } from './followup-cadence.js';
import { DEFAULT_FOLLOWUP_CONFIG } from './src/features/followups/types.js';
import type {
  CadenceApproval, CadenceTaskRow, DraftWarning, FollowUpConfig, FollowUpRuntimeState, ForecastInput, ForecastResult, SweepSummary,
} from './src/features/followups/types.js';
import { brazilianPhoneVariants, canonicalPhoneKey } from './lib/br-phone.js';
import { isWithinBusinessHours } from './lib/business-hours.js';
import type { StageRow } from './lib/stage-rules.js';

const HOUR = 3_600_000;
// Sexta-feira, 12:00 em São Paulo: dentro do horário comercial padrão.
const T0 = new Date('2026-09-18T15:00:00.000Z');
const USER = 'user-1';
// Números fictícios.
const MAIN = '5543900001111';
const phoneOf = (n: number) => `55439111100${String(n).padStart(2, '0')}`;
const ago = (hours: number) => new Date(T0.getTime() - hours * HOUR).toISOString();

const stage = (id: string, position: number, extra: Partial<StageRow> = {}): StageRow => ({
  id, name: id, position, is_final: false, is_won: false, process_id: null, ...extra,
});
const STAGES: StageRow[] = [
  stage('lead', 0), stage('contact', 1), stage('proposal', 2), stage('negotiation', 3), stage('02-follow-up', 4),
  stage('03-follow-up', 5), stage('04-follow-up', 6), stage('won', 7, { is_final: true, is_won: true }), stage('lost', 8, { is_final: true }),
];

const BASE_CONFIG: FollowUpConfig = {
  ...DEFAULT_FOLLOWUP_CONFIG, enabled: true,
  ladder_stage_ids: ['proposal', 'negotiation', '02-follow-up', '03-follow-up'], after_last_stage_id: '04-follow-up',
};
const BASE_STATE: FollowUpRuntimeState = {
  next_send_after: null, consecutive_errors: 0, paused_at: null, paused_reason: null, last_error: null, last_block_code: null,
  last_block_message: null, last_block_at: null, last_sweep_at: ago(1), last_sweep_summary: null, first_enabled_at: null,
  external_ai_consent_at: '2026-09-01T12:00:00.000Z', external_ai_consent_by: 'owner',
};
const AGENT: AiAgentConfigRow = {
  persona: 'Atendente do estúdio', objective: null, knowledge: 'Base de conhecimento com pacotes e explicações do ensaio.', rules: null,
  sales_strategy: null, attendant_name: 'Lia', learned_playbook: null, portfolio_links: [],
};
const TEXT_APPROVAL: CadenceApproval = { channel_class: 'text', render: null, template_id: null };

function activity(n: number, over: Partial<DealActivity> = {}): DealActivity {
  const contactPhone = over.contactPhone ?? phoneOf(n);
  return {
    dealId: n, stage: 'proposal', contactName: `Cliente ${n}`, contactPhone, phoneKey: canonicalPhoneKey(contactPhone),
    stageEnteredAt: ago(50 + n), lastStudioAt: ago(30), lastStudioType: 'text', lastStudioBody: 'orçamento', lastStudioMessageId: `wamid.s${n}`,
    lastCustomerAt: ago(40), lastCustomerReactionAt: null, lastInvisibleOutAt: null, invisibleRead: false, needsHuman: false,
    alreadyCustomer: false, ...over,
  };
}

function meta(warnings: DraftWarning[] = []): DraftMeta {
  return {
    version: 'v2', model: 'modelo-teste', latency_ms: 10, usage: null, cost_usd: 0.001, niche: 'gestante', messages_used: 3,
    warnings, generated_at: T0.toISOString(),
  };
}
const draft = (text: string, warnings: DraftWarning[] = []): DraftResult => ({ kind: 'draft', text, warnings, meta: meta(warnings) });
const skip = (reason: string): DraftResult => ({ kind: 'skip', reason, meta: meta() });
const handoff = (reason: string): DraftResult => ({ kind: 'handoff', reason, meta: meta() });
const fail = (retryable: boolean): DraftResult => ({ kind: 'error', retryable, message: retryable ? 'IA fora do ar.' : 'Configure o Agente IA.' });

function row(from_me: boolean, body: string, hoursAgo: number, over: Partial<ConversationRow> = {}): ConversationRow {
  return { message_id: `m-${hoursAgo}-${from_me}`, body, from_me, type: 'text', transcription: null, timestamp: ago(hoursAgo), ...over };
}
const DEFAULT_ROWS: ConversationRow[] = [row(false, 'Quero saber dos pacotes', 40), row(true, 'Te mandei o orçamento!', 30)];

function fullTask(over: Partial<CadenceTaskRow> = {}): CadenceTaskRow {
  return {
    id: 900, user_id: USER, deal_id: 1, phone: phoneOf(1), phone_key: canonicalPhoneKey(phoneOf(1)), wa_number: MAIN,
    message: 'Oi! Conseguiu ver o orçamento?', stage_id: 'proposal', scheduled_at: ago(1), sent_at: null, status: 'draft',
    created_at: ago(5), contact_name: 'Cliente 1', attempts: 0, kind: 'cadence', step: 1, basis_at: ago(30),
    basis_message_id: 'wamid.s1', draft_text: 'Oi! Conseguiu ver o orçamento?', approved_at: null, approved_by: null,
    claimed_at: null, claimed_by: null, lease_expires_at: null, channel_used: null, sent_message_id: null, last_error: null,
    generation_meta: { regenerations: 0, outcome: 'draft', warnings: [] }, updated_at: ago(5), ...over,
  };
}

interface WorldOpts {
  config?: Partial<FollowUpConfig>; state?: Partial<FollowUpRuntimeState>; exists?: boolean; main?: string | null;
  activities?: DealActivity[]; tasks?: CadenceTaskLite[]; legacy?: number[]; optouts?: string[];
  rows?: (phone: string) => ConversationRow[]; results?: (i: DraftInput) => DraftResult; duplicateDeals?: number[];
  full?: CadenceTaskRow[]; lastCustomer?: string | null; forecast?: (items: ForecastInput[]) => ForecastResult[];
  agent?: AiAgentConfigRow | null;
}

function world(opts: WorldOpts = {}) {
  const w = {
    config: { ...BASE_CONFIG, ...opts.config } as FollowUpConfig,
    state: { ...BASE_STATE, ...opts.state } as FollowUpRuntimeState,
    inserted: [] as Array<Record<string, any>>, cancelled: [] as Array<{ id: number; reason: string }>,
    optoutUpserts: [] as OptOutInput[], saved: [] as Array<{ last_sweep_at: string; last_sweep_summary: SweepSummary }>,
    retention: [] as number[], generated: [] as DraftInput[], forecasts: [] as ForecastInput[][], kicks: [] as string[],
    cas: [] as Array<{ id: number; patch: Record<string, unknown>; opts: TaskCasOptions; ok: boolean }>,
    calls: [] as string[], logs: [] as Array<{ event: string; data?: Record<string, unknown> }>,
    full: new Map((opts.full ?? []).map((t) => [t.id, structuredClone(t)])), clock: new Date(T0),
  };
  const call = (name: string) => w.calls.push(name);
  const repo: CadenceSweepRepo = {
    async loadConfig() { call('loadConfig'); return { config: structuredClone(w.config), state: structuredClone(w.state), exists: opts.exists ?? true }; },
    async loadStages() { call('loadStages'); return STAGES; },
    async mainWaNumber() { call('mainWaNumber'); return opts.main === undefined ? MAIN : opts.main; },
    async candidates(_u, stageIds, waNumbers, lookback, limit) {
      call(`candidates:${stageIds.join('|')}:${waNumbers.length}:${lookback}:${limit}`);
      return structuredClone(opts.activities ?? []);
    },
    async sweepTasks() { call('sweepTasks'); return structuredClone(opts.tasks ?? []); },
    async liveLegacyDealIds() { return new Set(opts.legacy ?? []); },
    async optoutKeys() { return new Set(opts.optouts ?? []); },
    async cancelTasks(_u, items) { call('cancelTasks'); w.cancelled.push(...items); return items.map((i) => i.id); },
    async loadConversationRows(_u, phone) { call('loadConversationRows'); return opts.rows ? opts.rows(phone) : structuredClone(DEFAULT_ROWS); },
    async loadAgentConfig() { call('loadAgentConfig'); return opts.agent === undefined ? AGENT : opts.agent; },
    async insertTask(r) {
      call('insertTask');
      if ((opts.duplicateDeals ?? []).includes(Number(r.deal_id))) return 'duplicate';
      w.inserted.push(structuredClone(r));
      return 'ok';
    },
    async upsertOptOut(_u, input) { w.optoutUpserts.push(input); },
    async saveSweepState(_u, patch) { w.saved.push(structuredClone(patch)); },
    async runRetention(_u, days) { w.retention.push(days); return 0; },
    async loadTask(_u, id) { call('loadTask'); const t = w.full.get(id); return t ? structuredClone(t) : null; },
    async updateTaskCas(id, _u, patch, casOpts) {
      const t = w.full.get(id);
      const lease = !casOpts.noLiveLeaseAt || !t?.claimed_at || Date.parse(String(t.lease_expires_at)) < Date.parse(casOpts.noLiveLeaseAt);
      const ok = !!t && casOpts.statuses.includes(t.status) && (!casOpts.updatedAt || t.updated_at === casOpts.updatedAt) && lease;
      w.cas.push({ id, patch: structuredClone(patch), opts: casOpts, ok });
      if (!ok || !t) return null;
      Object.assign(t, structuredClone(patch));
      return structuredClone(t);
    },
    async lastCustomerTurnAt() { call('lastCustomerTurnAt'); return opts.lastCustomer ?? null; },
  };
  const sweep = createCadenceSweep({
    repo,
    generate: async (i) => {
      w.generated.push(i);
      return opts.results ? opts.results(i) : draft(`Oi, ${i.contactName}! Conseguiu dar uma olhada no orçamento?`);
    },
    draftDeps: {
      getReplyDetailed: async () => { throw new Error('a IA real nunca é chamada nos testes'); },
      loadSupervisedMemory: async () => '',
    },
    forecastFor: async (_u, _c, items) => {
      w.forecasts.push(items);
      return opts.forecast ? opts.forecast(items) : items.map((i) => ({ id: i.id, channel: 'meta_text', approval: TEXT_APPROVAL }));
    },
    now: () => new Date(w.clock),
    log: (event, data) => w.logs.push({ event, data }),
    kick: (userId) => w.kicks.push(userId),
  });
  return { w, sweep };
}

// Varredura

test('respeita max_drafts_per_sweep e conta todos os elegíveis', async () => {
  const { w, sweep } = world({ config: { max_drafts_per_sweep: 2 }, activities: [1, 2, 3, 4, 5].map((n) => activity(n)) });
  const summary = await sweep.runSweep(USER, { manual: true });
  assert.equal(w.generated.length, 2);
  assert.equal(w.inserted.length, 2);
  assert.equal(summary.eligible, 5);
  assert.equal(summary.generated, 2);
  assert.equal(w.saved.length, 1);
  assert.equal(w.saved[0].last_sweep_summary.generated, 2);
  assert.ok(w.calls.some((c) => c.startsWith(`candidates:proposal|negotiation|02-follow-up|03-follow-up:${brazilianPhoneVariants(MAIN).length}:${720 + 48}:1000`)));
});

test('req.limit menor que o teto limita a geração', async () => {
  const { w, sweep } = world({ activities: [1, 2, 3].map((n) => activity(n)) });
  await sweep.runSweep(USER, { manual: true, limit: 1 });
  assert.equal(w.inserted.length, 1);
});

test('linha gravada: kind cadence, status explícito, sem phone_key e dentro do horário', async () => {
  const { w, sweep } = world({ activities: [activity(1, { contactPhone: '554391110001' })] });
  await sweep.runSweep(USER, { manual: true });
  const r = w.inserted[0];
  assert.equal(r.kind, 'cadence');
  assert.equal(r.status, 'draft');
  assert.ok(!('phone_key' in r));
  assert.equal(r.phone, '5543991110001');
  assert.equal(r.wa_number, MAIN);
  assert.equal(r.step, 1);
  assert.equal(r.stage_id, 'proposal');
  assert.equal(r.basis_at, ago(30));
  assert.equal(r.basis_message_id, 'wamid.s1');
  assert.equal(r.message, r.draft_text);
  assert.ok(Date.parse(r.scheduled_at) >= T0.getTime());
  assert.ok(isWithinBusinessHours(new Date(r.scheduled_at), BASE_CONFIG.business_hours));
  const gm = r.generation_meta;
  assert.equal(gm.outcome, 'draft');
  assert.equal(gm.regenerations, 0);
  assert.equal(gm.invisible_basis, false);
  assert.deepEqual(gm.anchor, { last_studio_at: ago(30), last_customer_at: ago(40), last_invisible_out_at: null });
  assert.equal(gm.context_tail.length, 2);
  assert.equal(gm.model, 'modelo-teste');
  assert.equal(gm.approval, undefined);
});

test('modo auto + varredura automática + enabled + sem aviso => approved com approval do forecast', async () => {
  const approval: CadenceApproval = { channel_class: 'template', render: 'Oi, Cliente! Tudo certo?', template_id: 40 };
  const { w, sweep } = world({
    config: { mode: 'auto' }, activities: [activity(1)],
    forecast: (items) => items.map((i) => ({ id: i.id, channel: 'meta_template', approval })),
  });
  const summary = await sweep.runSweep(USER, { manual: false });
  const r = w.inserted[0];
  assert.equal(r.status, 'approved');
  assert.equal(r.approved_by, 'auto');
  assert.equal(r.approved_at, T0.toISOString());
  assert.equal(r.generation_meta.approved_via, 'auto');
  assert.deepEqual(r.generation_meta.approval, approval);
  assert.equal(w.forecasts[0][0].last_customer_at, ago(40));
  assert.equal(summary.auto_approved, 1);
  assert.deepEqual(w.kicks, [USER]);
});

test('modo auto com aviso na IA => draft', async () => {
  const { w, sweep } = world({ config: { mode: 'auto' }, activities: [activity(1)], results: () => draft('Temos vaga amanhã!', ['vaga']) });
  await sweep.runSweep(USER, { manual: false });
  assert.equal(w.inserted[0].status, 'draft');
  assert.equal(w.forecasts.length, 0);
  assert.deepEqual(w.kicks, []);
});

test('varredura manual em modo auto grava draft', async () => {
  const { w, sweep } = world({ config: { mode: 'auto' }, activities: [activity(1)] });
  await sweep.runSweep(USER, { manual: true });
  assert.equal(w.inserted[0].status, 'draft');
  assert.equal(w.inserted[0].approved_by, null);
});

test('base invisível (IA oficial) => draft mesmo no auto, com a nota na entrada da IA', async () => {
  const { w, sweep } = world({
    config: { mode: 'auto' }, activities: [activity(1, { lastStudioAt: ago(35), lastInvisibleOutAt: ago(30), invisibleRead: true })],
  });
  await sweep.runSweep(USER, { manual: false });
  const r = w.inserted[0];
  assert.equal(r.status, 'draft');
  assert.equal(r.basis_message_id, null);
  assert.equal(r.generation_meta.invisible_basis, true);
  assert.equal(r.generation_meta.invisible_read, true);
  assert.deepEqual(w.generated[0].invisible, { basis: true, at: ago(30), read: true });
});

test('auto sem previsão de canal (forecast falhou) fica draft', async () => {
  const { w, sweep } = world({ config: { mode: 'auto' }, activities: [activity(1)], forecast: () => { throw new Error('rede'); } });
  await sweep.runSweep(USER, { manual: false });
  assert.equal(w.inserted[0].status, 'draft');
  assert.ok(w.logs.some((l) => l.event === 'cadence_sweep_forecast_failed'));
});

test('skip e handoff viram skipped pela IA, com message vazio', async () => {
  const { w, sweep } = world({
    activities: [activity(1), activity(2)],
    results: (i) => (i.contactName === 'Cliente 1' ? skip('ai_skip') : handoff('pagamento')),
  });
  const summary = await sweep.runSweep(USER, { manual: true });
  const byDeal = new Map(w.inserted.map((r) => [r.deal_id, r]));
  const skipped = byDeal.get(1) as Record<string, any>;
  assert.equal(skipped.status, 'skipped');
  assert.equal(skipped.message, '');
  assert.equal(skipped.draft_text, null);
  assert.equal(skipped.generation_meta.skipped_by, 'ai');
  assert.equal(skipped.generation_meta.skip_reason, 'ai_skip');
  const handed = byDeal.get(2) as Record<string, any>;
  assert.equal(handed.generation_meta.outcome, 'handoff');
  assert.equal(handed.generation_meta.handoff_reason, 'pagamento');
  assert.equal(summary.ai_skipped, 1);
  assert.equal(summary.handoffs, 1);
  assert.equal(summary.generated, 0);
});

test('duplicate (índice único) conta already_drafted', async () => {
  const { w, sweep } = world({ activities: [activity(1), activity(2)], duplicateDeals: [2] });
  const summary = await sweep.runSweep(USER, { manual: true });
  assert.equal(w.inserted.length, 1);
  assert.equal(summary.already_drafted, 1);
  assert.equal(summary.generated, 1);
});

test('erro da IA não grava; erro que não passa tentando de novo para a varredura', async () => {
  const retry = world({ activities: [activity(1), activity(2)], results: () => fail(true) });
  const s1 = await retry.sweep.runSweep(USER, { manual: true });
  assert.equal(retry.w.inserted.length, 0);
  assert.equal(s1.errors, 2);
  const fatal = world({ config: { max_drafts_per_sweep: 10 }, activities: [1, 2, 3, 4, 5].map((n) => activity(n)), results: () => fail(false) });
  const s2 = await fatal.sweep.runSweep(USER, { manual: true });
  assert.equal(fatal.w.inserted.length, 0);
  // Concorrência 2: no máximo as duas primeiras chegam a chamar a IA.
  assert.ok(fatal.w.generated.length <= 2);
  assert.equal(s2.errors, fatal.w.generated.length);
});

test('sem consentimento: runSweep lança AI_CONSENT_REQUIRED sem IA e countEligible funciona', async () => {
  const { w, sweep } = world({ state: { external_ai_consent_at: null }, activities: [activity(1), activity(2)] });
  await assert.rejects(sweep.runSweep(USER, { manual: true }), /AI_CONSENT_REQUIRED/);
  assert.equal(w.generated.length, 0);
  assert.equal(w.inserted.length, 0);
  const dry = await sweep.countEligible(USER, { manual: true, dry_run: true });
  assert.equal(dry.eligible_total, 2);
  assert.equal(dry.by_step[1], 2);
  assert.equal(dry.sample.length, 2);
  assert.equal(dry.sample[0].hours_silent, 30);
  assert.equal(w.generated.length, 0);
});

test('opt-out no histórico: grava opt-out sweep_history e não chama a IA', async () => {
  const { w, sweep } = world({
    activities: [activity(1)],
    rows: () => [row(false, 'Oi', 50), row(true, 'Orçamento', 45), row(false, 'Por favor não me mande mais mensagens', 40, { message_id: 'wamid.stop' }), row(true, 'Ok', 30)],
  });
  const summary = await sweep.runSweep(USER, { manual: true });
  assert.equal(w.generated.length, 0);
  assert.equal(w.inserted.length, 0);
  assert.equal(w.optoutUpserts.length, 1);
  assert.equal(w.optoutUpserts[0].kind, 'hard');
  assert.equal(w.optoutUpserts[0].messageId, 'wamid.stop');
  assert.equal(w.optoutUpserts[0].dealId, 1);
  assert.equal(summary.optouts_detected, 1);
});

test('opt-out pelo histórico desligado na config: a IA decide', async () => {
  const { w, sweep } = world({
    config: { optout_detection: false }, activities: [activity(1)],
    rows: () => [row(false, 'Por favor não me mande mais mensagens', 40), row(true, 'Ok', 30)],
  });
  await sweep.runSweep(USER, { manual: true });
  assert.equal(w.optoutUpserts.length, 0);
  assert.equal(w.generated.length, 1);
});

test('faxina cancela a viva cujo deal mudou de etapa e libera o deal na mesma varredura', async () => {
  const live: CadenceTaskLite = {
    id: 77, deal_id: 1, status: 'draft', step: 1, basis_at: ago(80), sent_at: null, created_at: ago(70), phone: phoneOf(1),
    phone_key: canonicalPhoneKey(phoneOf(1)), stage_id: 'proposal',
  };
  const { w, sweep } = world({ activities: [activity(1, { stage: 'negotiation', lastStudioAt: ago(60), lastCustomerAt: ago(70) })], tasks: [live] });
  const summary = await sweep.runSweep(USER, { manual: true });
  assert.deepEqual(w.cancelled, [{ id: 77, reason: 'stage_changed' }]);
  assert.equal(summary.housekept, 1);
  assert.equal(w.inserted.length, 1);
  assert.equal(w.inserted[0].step, 2);
});

test('varredura automática com a cadência desligada não faz nada', async () => {
  const { w, sweep } = world({ config: { enabled: false }, activities: [activity(1)] });
  const summary = await sweep.runSweep(USER, { manual: false });
  assert.equal(summary.generated, 0);
  assert.ok(!w.calls.some((c) => c.startsWith('candidates')));
  assert.equal(w.saved.length, 0);
});

test('varredura manual com a cadência desligada gera rascunho (prévia), nunca aprovado', async () => {
  const { w, sweep } = world({ config: { enabled: false, mode: 'auto' }, activities: [activity(1)] });
  await sweep.runSweep(USER, { manual: true });
  assert.equal(w.inserted.length, 1);
  assert.equal(w.inserted[0].status, 'draft');
});

test('sem config (conta sem linha) devolve resumo vazio sem gravar', async () => {
  const { w, sweep } = world({ exists: false, activities: [activity(1)] });
  const summary = await sweep.runSweep(USER, { manual: true });
  assert.equal(summary.eligible, 0);
  assert.equal(w.saved.length, 0);
});

test('sem número principal não gera nada, mas registra a varredura', async () => {
  const { w, sweep } = world({ main: null, activities: [activity(1)] });
  const summary = await sweep.runSweep(USER, { manual: true });
  assert.equal(summary.generated, 0);
  assert.ok(!w.calls.some((c) => c.startsWith('candidates')));
  assert.equal(w.saved.length, 1);
  assert.ok(w.logs.some((l) => l.event === 'cadence_sweep_no_main_number'));
});

test('filtros por passo e por deal_ids', async () => {
  const acts = [activity(1), activity(2, { stage: 'negotiation', lastStudioAt: ago(60), lastCustomerAt: ago(70) }), activity(3)];
  const byStep = world({ activities: acts });
  await byStep.sweep.runSweep(USER, { manual: true, step: 2 });
  assert.deepEqual(byStep.w.inserted.map((r) => r.deal_id), [2]);
  const byDeal = world({ activities: acts });
  await byDeal.sweep.runSweep(USER, { manual: true, deal_ids: [3] });
  assert.deepEqual(byDeal.w.inserted.map((r) => r.deal_id), [3]);
});

test('retenção roda uma vez por dia local', async () => {
  const sameDay = world({ activities: [] });
  await sameDay.sweep.runSweep(USER, { manual: true });
  assert.deepEqual(sameDay.w.retention, []);
  const otherDay = world({ state: { last_sweep_at: ago(30) }, activities: [] });
  await otherDay.sweep.runSweep(USER, { manual: true });
  assert.deepEqual(otherDay.w.retention, [90]);
  const never = world({ state: { last_sweep_at: null }, activities: [] });
  await never.sweep.runSweep(USER, { manual: true });
  assert.deepEqual(never.w.retention, [90]);
});

test('progresso reportado a cada item', async () => {
  const { sweep } = world({ activities: [activity(1), activity(2)] });
  const seen: Array<{ total: number; done: number }> = [];
  await sweep.runSweep(USER, { manual: true }, { onProgress: (p) => seen.push(p) });
  assert.deepEqual(seen[0], { total: 2, done: 0 });
  assert.deepEqual(seen[seen.length - 1], { total: 2, done: 2 });
});

test('countEligible simula a faxina sem gravar e conta motivos de pulo', async () => {
  const live: CadenceTaskLite = {
    id: 77, deal_id: 1, status: 'draft', step: 1, basis_at: ago(80), sent_at: null, created_at: ago(70), phone: phoneOf(1),
    phone_key: canonicalPhoneKey(phoneOf(1)), stage_id: 'proposal',
  };
  const { w, sweep } = world({
    activities: [activity(1, { stage: 'negotiation', lastStudioAt: ago(60), lastCustomerAt: ago(70) }), activity(2, { lastCustomerAt: ago(1) })],
    tasks: [live],
  });
  const dry = await sweep.countEligible(USER, { manual: true, dry_run: true });
  assert.equal(dry.eligible_total, 1);
  assert.equal(dry.by_step[2], 1);
  assert.equal(dry.skipped_by_reason.customer_spoke_last, 1);
  assert.equal(dry.sample[0].title, 'Cliente 1');
  assert.equal(w.cancelled.length, 0);
  assert.equal(w.inserted.length, 0);
});

test('antes do orçamento: busca contact junto com a escada, grava track e passa a trilha para a IA', async () => {
  const { w, sweep } = world({
    config: { pre_quote_stage_ids: ['contact'], pre_quote_delays_hours: [24, 72] },
    activities: [activity(1, { stage: 'contact', lastStudioBody: 'Qual tipo de ensaio?' }), activity(2)],
  });
  await sweep.runSweep(USER, { manual: true });
  assert.ok(w.calls.some((c) => c.startsWith('candidates:proposal|negotiation|02-follow-up|03-follow-up|contact:')));
  const pq = w.inserted.find((r) => r.deal_id === 1) as Record<string, any>;
  assert.equal(pq.track, 'pre_quote');
  assert.equal(pq.step, 1);
  assert.equal(pq.stage_id, 'contact');
  assert.equal(w.inserted.find((r) => r.deal_id === 2)?.track, 'ladder');
  const input = w.generated.find((i) => i.contactName === 'Cliente 1') as DraftInput;
  assert.equal(input.track, 'pre_quote');
  assert.equal(input.trackSteps, 2);
});

test('antes do orçamento: trilha desligada não busca contact; filtro por trilha na prévia', async () => {
  const off = world({ activities: [activity(1, { stage: 'contact' })] });
  await off.sweep.runSweep(USER, { manual: true });
  assert.ok(off.w.calls.some((c) => c.startsWith('candidates:proposal|negotiation|02-follow-up|03-follow-up:')));
  assert.equal(off.w.inserted.length, 0);
  const on = world({
    config: { pre_quote_stage_ids: ['contact'] },
    activities: [activity(1, { stage: 'contact' }), activity(2), activity(3, { stage: 'negotiation', lastStudioAt: ago(60), lastCustomerAt: ago(70) })],
  });
  const all = await on.sweep.countEligible(USER, { manual: true, dry_run: true });
  assert.deepEqual(all.by_track, { ladder: 2, pre_quote: 1 });
  assert.deepEqual(all.by_step, { 1: 1, 2: 1, 3: 0, 4: 0 }, 'by_step conta só a escada');
  assert.ok(all.sample.some((x) => x.track === 'pre_quote' && x.deal_id === 1));
  const onlyPq = await on.sweep.countEligible(USER, { manual: true, dry_run: true, track: 'pre_quote' });
  assert.equal(onlyPq.eligible_total, 1);
  await on.sweep.runSweep(USER, { manual: true, track: 'ladder' });
  assert.deepEqual(on.w.inserted.map((r) => r.deal_id).sort(), [2, 3]);
});

test('regenerate de toque antes do orçamento mantém a trilha na IA', async () => {
  const { w, sweep } = world({ config: { pre_quote_stage_ids: ['contact'] },
    full: [fullTask({ track: 'pre_quote', stage_id: 'contact', step: 2 })], results: () => draft('Oi! Quando fizer sentido, é só me chamar.') });
  assert.deepEqual(await sweep.regenerate(USER, 900, { actorId: 'owner' }), { status: 'updated' });
  assert.equal(w.generated[0].track, 'pre_quote');
  assert.equal(w.generated[0].step, 2);
  assert.equal(w.generated[0].trackSteps, 2);
});

// Gerar de novo

test('regenerate: CAS prévio falhando => conflict sem chamar a IA', async () => {
  const { w, sweep } = world({ full: [fullTask({ status: 'approved', approved_at: ago(2), claimed_at: ago(0.01), lease_expires_at: ago(-0.05) })] });
  const r = await sweep.regenerate(USER, 900, { actorId: 'owner' });
  assert.deepEqual(r, { status: 'conflict' });
  assert.equal(w.generated.length, 0);
  assert.equal(w.cas[0].opts.noLiveLeaseAt, T0.toISOString());
  assert.deepEqual(w.cas[0].opts.statuses, ['approved']);
});

test('regenerate: approved volta para draft antes da IA e grava o texto novo', async () => {
  const task = fullTask({ status: 'approved', approved_at: ago(2), approved_by: 'owner', generation_meta: { regenerations: 1, approval: TEXT_APPROVAL, approved_via: 'manual' } });
  const { w, sweep } = world({ full: [task], results: () => draft('Oi, Cliente! Ficou alguma dúvida?') });
  const r = await sweep.regenerate(USER, 900, { actorId: 'owner-uuid', instruction: 'mais curto' });
  assert.deepEqual(r, { status: 'updated' });
  assert.equal(w.cas.length, 2);
  assert.deepEqual(w.cas[0].patch, {
    status: 'draft', approved_at: null, approved_by: null, sent_at: null, sent_message_id: null, channel_used: null,
    generation_meta: { regenerations: 1 }, updated_at: T0.toISOString(),
  });
  assert.deepEqual(w.cas[1].opts, { statuses: ['draft'], updatedAt: T0.toISOString() });
  const saved = w.full.get(900) as CadenceTaskRow;
  assert.equal(saved.status, 'draft');
  assert.equal(saved.message, 'Oi, Cliente! Ficou alguma dúvida?');
  assert.equal(saved.draft_text, saved.message);
  assert.equal(saved.generation_meta.regenerations, 2);
  assert.equal(saved.generation_meta.edited_by, 'owner-uuid');
  assert.equal(saved.generation_meta.approval, undefined);
  assert.equal(saved.generation_meta.approved_via, undefined);
  assert.equal(w.generated[0].userInstruction, 'mais curto');
  assert.equal(w.generated[0].step, 1);
});

test('regenerate: cliente respondeu depois da base => conversation_changed sem IA', async () => {
  const { w, sweep } = world({ full: [fullTask()], lastCustomer: ago(2) });
  const r = await sweep.regenerate(USER, 900, { actorId: 'owner' });
  assert.deepEqual(r, { status: 'conversation_changed' });
  assert.equal(w.generated.length, 0);
  assert.equal((w.full.get(900) as CadenceTaskRow).status, 'draft');
});

test('regenerate: IA sugere pular sem force => ai_suggests_skip e o texto fica', async () => {
  const { w, sweep } = world({ full: [fullTask()], results: () => skip('ai_skip') });
  const r = await sweep.regenerate(USER, 900, { actorId: 'owner' });
  assert.deepEqual(r, { status: 'ai_suggests_skip', reason: 'ai_skip' });
  assert.equal((w.full.get(900) as CadenceTaskRow).message, 'Oi! Conseguiu ver o orçamento?');
  assert.equal(w.cas.length, 1);
});

test('regenerate: tarefa pulada pela IA que continua pulada volta para skipped', async () => {
  const task = fullTask({ status: 'skipped', message: '', generation_meta: { skipped_by: 'ai', outcome: 'skip', skip_reason: 'ai_skip' } });
  const { w, sweep } = world({ full: [task], results: () => handoff('duvida') });
  const r = await sweep.regenerate(USER, 900, { actorId: 'owner', force: true });
  assert.deepEqual(r, { status: 'ai_suggests_skip', reason: 'duvida' });
  assert.equal((w.full.get(900) as CadenceTaskRow).status, 'skipped');
  assert.match(String(w.generated[0].userInstruction), /retomar mesmo assim/);
});

test('regenerate: limite de 5 gerações', async () => {
  const { w, sweep } = world({ full: [fullTask({ generation_meta: { regenerations: MAX_REGENERATIONS } })] });
  assert.deepEqual(await sweep.regenerate(USER, 900, { actorId: 'owner' }), { status: 'limit' });
  assert.equal(w.cas.length, 0);
});

test('regenerate: UPDATE final com updated_at diferente => conflict', async () => {
  // Alguém editou a linha entre o CAS prévio e a resposta da IA.
  const racing = world({
    full: [fullTask()],
    results: () => {
      racing.w.full.get(900)!.updated_at = '2026-09-18T15:00:30.000Z';
      return draft('Texto novo');
    },
  });
  const r = await racing.sweep.regenerate(USER, 900, { actorId: 'owner' });
  assert.deepEqual(r, { status: 'conflict' });
  assert.equal(racing.w.cas.length, 2);
  assert.equal(racing.w.cas[1].ok, false);
  assert.equal(racing.w.full.get(900)!.message, 'Oi! Conseguiu ver o orçamento?');
});

test('regenerate: status que não se regenera e pulado pelo estúdio => invalid_status', async () => {
  const sent = world({ full: [fullTask({ status: 'sent' })] });
  assert.deepEqual(await sent.sweep.regenerate(USER, 900, { actorId: 'owner' }), { status: 'invalid_status' });
  const byUser = world({ full: [fullTask({ status: 'skipped', generation_meta: { skipped_by: 'user' } })] });
  assert.deepEqual(await byUser.sweep.regenerate(USER, 900, { actorId: 'owner' }), { status: 'invalid_status' });
  const missing = world({ full: [] });
  assert.deepEqual(await missing.sweep.regenerate(USER, 900, { actorId: 'owner' }), { status: 'invalid_status' });
});

test('regenerate: sem consentimento => consent_required sem tocar na linha', async () => {
  const { w, sweep } = world({ state: { external_ai_consent_at: null }, full: [fullTask()] });
  assert.deepEqual(await sweep.regenerate(USER, 900, { actorId: 'owner' }), { status: 'consent_required' });
  assert.equal(w.cas.length, 0);
  assert.equal(w.generated.length, 0);
});

test('regenerate: erro da IA devolve error com retryable', async () => {
  const { sweep } = world({ full: [fullTask({ status: 'failed' })], results: () => fail(true) });
  const r = await sweep.regenerate(USER, 900, { actorId: 'owner' });
  assert.equal(r.status, 'error');
  assert.equal((r as { retryable: boolean }).retryable, true);
});

test('regenerate: tarefa failed pela Meta perde a entrega antiga (lease vencido depois não vira enviado)', async () => {
  const failed = fullTask({
    status: 'failed', sent_at: ago(3), sent_message_id: 'wamid.old', channel_used: 'meta_text', last_error: 'A Meta não entregou.',
    generation_meta: {
      regenerations: 0, delivery: { message_ids: ['wamid.old'], delivered_text: 'x', channel: 'meta_text' },
      advance: { state: 'skipped', due_at: ago(2), result: null }, failure: { code: 131026, title: 'x', at: ago(2) },
    },
  });
  const { w, sweep } = world({ full: [failed], results: () => draft('Oi! Tudo bem por aí?') });
  assert.deepEqual(await sweep.regenerate(USER, 900, { actorId: 'owner' }), { status: 'updated' });
  const saved = w.full.get(900) as CadenceTaskRow;
  assert.equal(saved.sent_message_id, null);
  assert.equal(saved.sent_at, null);
  assert.equal(saved.channel_used, null);
  assert.equal(saved.last_error, null);
  assert.equal(saved.generation_meta.delivery, undefined);
  assert.equal(saved.generation_meta.advance, undefined);
  // Mesmo que o QR/Graph caia depois do claim, sem prova nova o sender bloqueia.
  assert.equal(resolveExpiredLease({ ...saved, status: 'sending', generation_meta: { ...saved.generation_meta, prev_status: 'sending' } }), 'block');
  // O passo de volta para draft já limpa, mesmo se a IA falhar depois.
  const early = world({ full: [failed], results: () => fail(true) });
  await early.sweep.regenerate(USER, 900, { actorId: 'owner' });
  assert.equal((early.w.full.get(900) as CadenceTaskRow).generation_meta.delivery, undefined);
});

test('regenerate: reação do cliente depois da base vai para a IA', async () => {
  const { w, sweep } = world({
    full: [fullTask()],
    rows: () => [row(true, 'Orçamento', 30), row(false, '', 20, { type: 'reaction' })],
  });
  await sweep.regenerate(USER, 900, { actorId: 'owner' });
  assert.equal(w.generated[0].customerReactedAfterBasis, true);
});

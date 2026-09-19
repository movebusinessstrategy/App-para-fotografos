// Varredura da cadência: acha quem ficou em silêncio depois da última fala do
// estúdio, pede o rascunho à IA e grava a tarefa. Também gera de novo um
// rascunho sob demanda. Banco, IA e canal entram por dependência; aqui ficam a
// ordem das coisas, as travas (consentimento, CAS) e o resumo.
import type {
  CadenceGenerationMeta, CadenceStatus, CadenceTaskRow, CancelReason, FollowUpConfig, FollowUpRuntimeState, FollowUpStep,
  ForecastInput, ForecastResult, RegenerateResult, SweepDryRun, SweepRequest, SweepSummary,
} from './src/features/followups/types.js';
import { RETENTION_DAYS } from './src/features/followups/types.js';
import type { AiAgentConfigRow, DraftDeps, DraftInput, DraftMeta, DraftResult, DraftRow } from './followup-draft.js';
import { contextTail } from './followup-draft.js';
import type { CadenceTaskLite, DealActivity, EligibleDeal, SkipReason } from './followup-cadence.js';
import {
  customerSpokeAfter, housekeepLiveTasks, initialStatusFor, LIVE_TASK_LOOKBACK_DAYS, selectEligibleDeals,
} from './followup-cadence.js';
import type { StageRow } from './lib/stage-rules.js';
import { brazilianPhoneVariants, maskPhone, normalizeBrazilianPhone13 } from './lib/br-phone.js';
import { localDateKey, nextSendSlot, stableJitterSeconds } from './lib/business-hours.js';
import { detectOptOut } from './lib/optout-detect.js';

export interface ConversationRow extends DraftRow { message_id: string | null }
export interface LoadedConfig { config: FollowUpConfig; state: FollowUpRuntimeState; exists: boolean }
export interface OptOutInput { phone: string; dealId: number | null; kind: 'hard' | 'soft'; text: string | null; messageId: string | null }
export interface TaskCasOptions { statuses: CadenceStatus[]; updatedAt?: string | null; noLiveLeaseAt?: string }

export interface CadenceSweepRepo {
  loadConfig(userId: string): Promise<LoadedConfig>;
  loadStages(userId: string): Promise<StageRow[]>;
  mainWaNumber(userId: string, config: FollowUpConfig): Promise<string | null>;
  candidates(userId: string, stageIds: string[], waNumbers: string[], lookbackHours: number, limit: number): Promise<DealActivity[]>;
  sweepTasks(userId: string, sinceIso: string): Promise<CadenceTaskLite[]>;
  liveLegacyDealIds(userId: string): Promise<Set<number>>;
  optoutKeys(userId: string): Promise<Set<string>>;
  cancelTasks(userId: string, items: Array<{ id: number; reason: CancelReason }>): Promise<number[]>;
  loadConversationRows(userId: string, phone: string, waNumbers: string[], limit: number): Promise<ConversationRow[]>;
  loadAgentConfig(userId: string): Promise<AiAgentConfigRow | null>;
  insertTask(row: Record<string, unknown>): Promise<'ok' | 'duplicate'>;
  upsertOptOut(userId: string, input: OptOutInput): Promise<void>;
  saveSweepState(userId: string, patch: { last_sweep_at: string; last_sweep_summary: SweepSummary }): Promise<void>;
  runRetention(userId: string, days: number): Promise<number>;
  loadTask(userId: string, id: number): Promise<CadenceTaskRow | null>;
  updateTaskCas(id: number, userId: string, patch: Record<string, unknown>, opts: TaskCasOptions): Promise<CadenceTaskRow | null>;
  lastCustomerTurnAt(userId: string, phone: string): Promise<string | null>;
}

export interface CadenceSweepDeps {
  repo: CadenceSweepRepo;
  generate: (i: DraftInput, d: DraftDeps) => Promise<DraftResult>;
  draftDeps: DraftDeps;
  forecastFor: (userId: string, config: FollowUpConfig, items: ForecastInput[]) => Promise<ForecastResult[]>;
  now: () => Date;
  log: (event: string, data?: Record<string, unknown>) => void;
  kick?: (userId: string) => void;
}

export interface SweepHooks { onProgress?: (progress: { total: number; done: number }) => void }

export interface CadenceSweep {
  runSweep(userId: string, req: SweepRequest, hooks?: SweepHooks): Promise<SweepSummary>;
  countEligible(userId: string, req: SweepRequest): Promise<SweepDryRun>;
  regenerate(userId: string, taskId: number, opts: { instruction?: string; force?: boolean; actorId: string }): Promise<RegenerateResult>;
}

export const CANDIDATE_LIMIT = 1000;
export const SWEEP_CONCURRENCY = 2;
export const CONVERSATION_ROWS = 60;
export const MAX_REGENERATIONS = 5;
const LOOKBACK_EXTRA_HOURS = 48;
const JITTER_MAX_SECONDS = 1800;
const SAMPLE_SIZE = 10;
const DAY_MS = 24 * 3_600_000;
const HOUSEKEEP_STATUSES: readonly CadenceStatus[] = ['draft', 'approved', 'blocked'];
const REGEN_STATUSES: readonly CadenceStatus[] = ['draft', 'blocked', 'approved', 'failed', 'skipped'];
// Restos da tentativa anterior. A entrega antiga (failed pela Meta) precisa sair: com
// ela, um lease vencido na próxima tentativa passaria por enviado sem ter saído nada.
const STALE_META_KEYS = ['approval', 'approved_via', 'block_code', 'failure', 'cancel_reason', 'delivery', 'advance'] as const;
const STALE_SEND_FIELDS = { sent_at: null, sent_message_id: null, channel_used: null } as const;
const FORCE_INSTRUCTION = 'O estúdio revisou a conversa e decidiu retomar mesmo assim. Escreva a mensagem de retomada, sem pular e sem passar para uma pessoa.';
const EMPTY_AGENT: AiAgentConfigRow = {
  persona: null, objective: null, knowledge: null, rules: null, sales_strategy: null, attendant_name: null,
  learned_playbook: null, portfolio_links: [],
};
const KIND_COUNTER: Record<'draft' | 'skip' | 'handoff', 'generated' | 'ai_skipped' | 'handoffs'> = {
  draft: 'generated', skip: 'ai_skipped', handoff: 'handoffs',
};

interface SweepBase { userId: string; now: Date; nowIso: string; config: FollowUpConfig; state: FollowUpRuntimeState }

interface SweepScope extends SweepBase {
  selectConfig: FollowUpConfig; main: string; waNumbers: string[]; stages: StageRow[]; activities: DealActivity[];
  activityByDeal: Map<number, DealActivity>; tasks: CadenceTaskLite[]; liveLegacy: Set<number>; optoutKeys: Set<string>;
  truncated: boolean;
}

interface SweepRun extends SweepScope {
  req: SweepRequest; agent: AiAgentConfigRow; summary: SweepSummary; aborted: boolean;
  progress: { total: number; done: number }; hooks: SweepHooks;
}

type Generated = Exclude<DraftResult, { kind: 'error' }>;
interface RowOutcome { fields: Record<string, unknown>; meta: Partial<CadenceGenerationMeta>; approved: boolean }

// Utilitários

function emptySummary(): SweepSummary {
  return {
    eligible: 0, generated: 0, auto_approved: 0, ai_skipped: 0, handoffs: 0, already_drafted: 0, optouts_detected: 0,
    housekept: 0, errors: 0, finished_at: '',
  };
}

function emptyDryRun(): SweepDryRun {
  return { eligible_total: 0, by_step: { 1: 0, 2: 0, 3: 0, 4: 0 }, skipped_by_reason: {}, sample: [] };
}

function errorText(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error ?? '');
  return text.replace(/\d{8,}/g, (digits) => maskPhone(digits)).slice(0, 200);
}

function toMs(value: unknown): number | null {
  const ms = Date.parse(String(value ?? ''));
  return Number.isFinite(ms) ? ms : null;
}

async function mapLimit<T>(items: T[], limit: number, stop: () => boolean, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length && !stop()) {
      const item = items[next];
      next += 1;
      await fn(item);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
}

// Escopo da varredura: tudo o que a seleção precisa, lido uma vez.

async function loadScope(deps: CadenceSweepDeps, userId: string, loaded: LoadedConfig, req: SweepRequest, now: Date): Promise<SweepScope | null> {
  const { config } = loaded;
  const main = await deps.repo.mainWaNumber(userId, config);
  if (!main) return null;
  const waNumbers = brazilianPhoneVariants(main);
  const ladder = config.ladder_stage_ids;
  const lookback = config.max_silence_hours + LOOKBACK_EXTRA_HOURS;
  const sinceIso = new Date(now.getTime() - LIVE_TASK_LOOKBACK_DAYS * DAY_MS).toISOString();
  const [stages, activities, tasks, liveLegacy, optoutKeys] = await Promise.all([
    deps.repo.loadStages(userId),
    ladder.length ? deps.repo.candidates(userId, ladder, waNumbers, lookback, CANDIDATE_LIMIT) : Promise.resolve([]),
    deps.repo.sweepTasks(userId, sinceIso),
    deps.repo.liveLegacyDealIds(userId),
    deps.repo.optoutKeys(userId),
  ]);
  return {
    userId, now, nowIso: now.toISOString(), config, state: loaded.state,
    selectConfig: req.manual ? { ...config, enabled: true } : config,
    main, waNumbers, stages, activities, activityByDeal: new Map(activities.map((a) => [Number(a.dealId), a])),
    tasks, liveLegacy, optoutKeys, truncated: activities.length >= CANDIDATE_LIMIT,
  };
}

function housekeepPlan(scope: SweepScope): Array<{ id: number; reason: CancelReason }> {
  return housekeepLiveTasks({
    tasks: scope.tasks, activities: scope.activities, stages: scope.stages, optoutKeys: scope.optoutKeys, truncated: scope.truncated,
  });
}

// Tarefa cancelada deixa de ocupar a vaga do deal na seleção desta mesma varredura.
function markCancelled(tasks: CadenceTaskLite[], ids: Set<number>): CadenceTaskLite[] {
  return tasks.map((t) => (ids.has(Number(t.id)) && HOUSEKEEP_STATUSES.includes(t.status) ? { ...t, status: 'cancelled' as CadenceStatus } : t));
}

function matchesRequest(req: SweepRequest): (e: EligibleDeal) => boolean {
  const dealIds = req.deal_ids?.length ? new Set(req.deal_ids.map(Number)) : null;
  return (e) => (!req.step || e.step === req.step) && (!dealIds || dealIds.has(Number(e.dealId)));
}

function selectFor(scope: SweepScope, req: SweepRequest): { eligible: EligibleDeal[]; skipped: Array<{ dealId: number; reason: SkipReason }> } {
  const result = selectEligibleDeals({
    config: scope.selectConfig, stages: scope.stages, activities: scope.activities, cadenceTasks: scope.tasks,
    liveLegacyDealIds: scope.liveLegacy, optoutKeys: scope.optoutKeys, now: scope.now,
  });
  return { eligible: result.eligible.filter(matchesRequest(req)), skipped: result.skipped };
}

function takeCount(config: FollowUpConfig, req: SweepRequest): number {
  const max = config.max_drafts_per_sweep;
  const asked = Number.isInteger(req.limit) && Number(req.limit) > 0 ? Number(req.limit) : max;
  return Math.max(0, Math.min(asked, max));
}

// Prévia (sem IA, sem consentimento e sem escrita)

function dryRunOf(eligible: EligibleDeal[], skipped: Array<{ dealId: number; reason: SkipReason }>): SweepDryRun {
  const out = emptyDryRun();
  out.eligible_total = eligible.length;
  for (const e of eligible) out.by_step[e.step] += 1;
  for (const s of skipped) out.skipped_by_reason[s.reason] = (out.skipped_by_reason[s.reason] ?? 0) + 1;
  out.sample = eligible.slice(0, SAMPLE_SIZE).map((e) => ({
    deal_id: e.dealId, title: e.contactName || `Negócio ${e.dealId}`, step: e.step, hours_silent: Math.max(0, Math.floor(e.silenceHours)),
  }));
  return out;
}

// Linha gravada

function scheduledAt(run: SweepRun, e: EligibleDeal): string {
  const earliest = new Date(Date.parse(e.dueAt));
  try {
    const jitterSeconds = stableJitterSeconds(`deal:${e.dealId}:step:${e.step}`, JITTER_MAX_SECONDS);
    return nextSendSlot({ earliest, now: run.now, hours: run.config.business_hours, jitterSeconds }).toISOString();
  } catch {
    // Horário sem janela nenhuma: o sender não envia fora do horário de qualquer jeito.
    return new Date(Math.max(earliest.getTime() || 0, run.now.getTime())).toISOString();
  }
}

function commonRow(run: SweepRun, e: EligibleDeal): Record<string, unknown> {
  return {
    user_id: run.userId, deal_id: e.dealId, phone: normalizeBrazilianPhone13(e.contactPhone), wa_number: run.main,
    contact_name: e.contactName, stage_id: e.stageId, kind: 'cadence', step: e.step, basis_at: e.basisAt,
    basis_message_id: e.basisMessageId, scheduled_at: scheduledAt(run, e), updated_at: run.nowIso,
  };
}

function commonMeta(run: SweepRun, e: EligibleDeal, rows: ConversationRow[], meta: DraftMeta): CadenceGenerationMeta {
  const a = run.activityByDeal.get(Number(e.dealId));
  return {
    ...meta,
    invisible_basis: e.invisibleBasis, invisible_read: e.invisibleRead,
    anchor: { last_studio_at: a?.lastStudioAt ?? null, last_customer_at: e.lastCustomerAt, last_invisible_out_at: a?.lastInvisibleOutAt ?? null },
    context_tail: contextTail(rows), regenerations: 0,
  };
}

const SKIPPED_OUTCOMES: Record<'skip' | 'handoff', (reason: string) => Partial<CadenceGenerationMeta>> = {
  skip: (reason) => ({ outcome: 'skip', skip_reason: reason, handoff_reason: null, skipped_by: 'ai' }),
  handoff: (reason) => ({ outcome: 'handoff', skip_reason: null, handoff_reason: reason, skipped_by: 'ai' }),
};

async function autoApproval(deps: CadenceSweepDeps, run: SweepRun, e: EligibleDeal, text: string): Promise<CadenceGenerationMeta['approval'] | null> {
  const item: ForecastInput = {
    id: 0, contact_name: e.contactName, text, step: e.step, last_customer_at: e.lastCustomerAt, phone: normalizeBrazilianPhone13(e.contactPhone),
  };
  try {
    const [forecast] = await deps.forecastFor(run.userId, run.config, [item]);
    return forecast?.approval ?? null;
  } catch (error) {
    deps.log('cadence_sweep_forecast_failed', { userId: run.userId, dealId: e.dealId, error: errorText(error) });
    return null;
  }
}

async function draftOutcome(deps: CadenceSweepDeps, run: SweepRun, e: EligibleDeal, r: Extract<DraftResult, { kind: 'draft' }>): Promise<RowOutcome> {
  const fields = { status: 'draft', message: r.text, draft_text: r.text, approved_at: null, approved_by: null };
  const meta: Partial<CadenceGenerationMeta> = { outcome: 'draft', skip_reason: null, skipped_by: null, handoff_reason: null, warnings: r.warnings };
  const initial = initialStatusFor(run.config.mode, e, r.warnings, { manual: run.req.manual, enabled: run.config.enabled });
  if (initial.status !== 'approved') return { fields, meta, approved: false };
  // Sem a previsão de canal não há como provar o que foi aprovado: fica rascunho.
  const approval = await autoApproval(deps, run, e, r.text);
  if (!approval) return { fields, meta, approved: false };
  return {
    fields: { ...fields, status: 'approved', approved_at: run.nowIso, approved_by: 'auto' },
    meta: { ...meta, approved_via: 'auto', approval },
    approved: true,
  };
}

async function outcomeFor(deps: CadenceSweepDeps, run: SweepRun, e: EligibleDeal, r: Generated): Promise<RowOutcome> {
  if (r.kind === 'draft') return draftOutcome(deps, run, e, r);
  return { fields: { status: 'skipped', message: '', draft_text: null }, meta: SKIPPED_OUTCOMES[r.kind](r.reason), approved: false };
}

// Opt-out pelo histórico: quem pediu para parar não passa pela IA.

function historyOptOut(rows: ConversationRow[]): { row: ConversationRow; kind: 'hard' | 'soft' } | null {
  for (const row of [...rows].reverse()) {
    if (row.from_me) continue;
    const hit = detectOptOut(row.body || row.transcription);
    if (hit) return { row, kind: hit.kind };
  }
  return null;
}

async function optOutFromHistory(deps: CadenceSweepDeps, run: SweepRun, e: EligibleDeal, rows: ConversationRow[]): Promise<boolean> {
  if (!run.config.optout_detection) return false;
  const hit = historyOptOut(rows);
  if (!hit) return false;
  const text = String(hit.row.body || hit.row.transcription || '').slice(0, 300) || null;
  await deps.repo.upsertOptOut(run.userId, { phone: e.contactPhone, dealId: e.dealId, kind: hit.kind, text, messageId: hit.row.message_id });
  run.optoutKeys.add(e.phoneKey);
  run.summary.optouts_detected += 1;
  deps.log('cadence_sweep_optout', { userId: run.userId, dealId: e.dealId, phone: maskPhone(e.contactPhone), kind: hit.kind });
  return true;
}

// Um elegível: histórico, opt-out, IA e INSERT.

function sweepDraftInput(run: SweepRun, e: EligibleDeal, rows: ConversationRow[]): DraftInput {
  return {
    userId: run.userId, waNumber: run.main, step: e.step, contactName: e.contactName, rows, agent: run.agent,
    extraInstructions: run.config.extra_instructions,
    invisible: { basis: e.invisibleBasis, at: e.invisibleBasis ? e.basisAt : null, read: e.invisibleRead },
    customerReactedAfterBasis: e.customerReactedAfterBasis, now: run.now,
  };
}

function onGenerateError(deps: CadenceSweepDeps, run: SweepRun, e: EligibleDeal, r: Extract<DraftResult, { kind: 'error' }>): void {
  run.summary.errors += 1;
  // Erro que não passa tentando de novo (ex.: Agente IA sem base) vale para a conta inteira.
  if (!r.retryable) run.aborted = true;
  deps.log('cadence_sweep_generate_failed', { userId: run.userId, dealId: e.dealId, retryable: r.retryable, error: r.message.slice(0, 200) });
}

function tally(summary: SweepSummary, inserted: 'ok' | 'duplicate', kind: Generated['kind'], approved: boolean): void {
  if (inserted === 'duplicate') {
    summary.already_drafted += 1;
    return;
  }
  summary[KIND_COUNTER[kind]] += 1;
  if (approved) summary.auto_approved += 1;
}

async function processEligible(deps: CadenceSweepDeps, run: SweepRun, e: EligibleDeal): Promise<void> {
  const rows = await deps.repo.loadConversationRows(run.userId, e.contactPhone, run.waNumbers, CONVERSATION_ROWS);
  if (await optOutFromHistory(deps, run, e, rows)) return;
  const r = await deps.generate(sweepDraftInput(run, e, rows), deps.draftDeps);
  if (r.kind === 'error') return onGenerateError(deps, run, e, r);
  const outcome = await outcomeFor(deps, run, e, r);
  const row = { ...commonRow(run, e), ...outcome.fields, generation_meta: { ...commonMeta(run, e, rows, r.meta), ...outcome.meta } };
  tally(run.summary, await deps.repo.insertTask(row), r.kind, outcome.approved);
}

async function processSafely(deps: CadenceSweepDeps, run: SweepRun, e: EligibleDeal): Promise<void> {
  try {
    await processEligible(deps, run, e);
  } catch (error) {
    run.summary.errors += 1;
    deps.log('cadence_sweep_item_failed', { userId: run.userId, dealId: e.dealId, error: errorText(error) });
  } finally {
    run.progress.done += 1;
    run.hooks.onProgress?.({ ...run.progress });
  }
}

// Fim da varredura

async function maybeRetention(deps: CadenceSweepDeps, scope: SweepBase): Promise<void> {
  const tz = scope.config.business_hours.tz;
  const last = toMs(scope.state.last_sweep_at);
  if (last !== null && localDateKey(new Date(last), tz) === localDateKey(scope.now, tz)) return;
  try {
    const cleaned = await deps.repo.runRetention(scope.userId, RETENTION_DAYS);
    deps.log('cadence_retention', { userId: scope.userId, cleaned });
  } catch (error) {
    deps.log('cadence_retention_failed', { userId: scope.userId, error: errorText(error) });
  }
}

async function finishSweep(deps: CadenceSweepDeps, scope: SweepBase, summary: SweepSummary): Promise<SweepSummary> {
  await maybeRetention(deps, scope);
  const done: SweepSummary = { ...summary, finished_at: deps.now().toISOString() };
  await deps.repo.saveSweepState(scope.userId, { last_sweep_at: scope.nowIso, last_sweep_summary: done });
  if (done.auto_approved > 0) deps.kick?.(scope.userId);
  const { finished_at: _finishedAt, ...counts } = done;
  deps.log('cadence_sweep_done', { userId: scope.userId, ...counts });
  return done;
}

// Sem número principal não dá para saber qual é a conversa de venda: não gera nada.
async function finishWithoutMain(deps: CadenceSweepDeps, userId: string, loaded: LoadedConfig, now: Date): Promise<SweepSummary> {
  deps.log('cadence_sweep_no_main_number', { userId });
  const base: SweepBase = { userId, now, nowIso: now.toISOString(), config: loaded.config, state: loaded.state };
  return finishSweep(deps, base, emptySummary());
}

async function housekeep(deps: CadenceSweepDeps, scope: SweepScope): Promise<number> {
  const plan = housekeepPlan(scope);
  if (!plan.length) return 0;
  const cancelled = await deps.repo.cancelTasks(scope.userId, plan);
  scope.tasks = markCancelled(scope.tasks, new Set(cancelled.map(Number)));
  return cancelled.length;
}

async function runScope(deps: CadenceSweepDeps, scope: SweepScope, req: SweepRequest, hooks: SweepHooks): Promise<SweepSummary> {
  const summary = emptySummary();
  summary.housekept = await housekeep(deps, scope);
  const { eligible } = selectFor(scope, req);
  summary.eligible = eligible.length;
  const take = eligible.slice(0, takeCount(scope.config, req));
  const agent = take.length ? (await deps.repo.loadAgentConfig(scope.userId)) ?? EMPTY_AGENT : EMPTY_AGENT;
  const run: SweepRun = { ...scope, req, agent, summary, aborted: false, progress: { total: take.length, done: 0 }, hooks };
  hooks.onProgress?.({ ...run.progress });
  await mapLimit(take, SWEEP_CONCURRENCY, () => run.aborted, (e) => processSafely(deps, run, e));
  return finishSweep(deps, scope, summary);
}

// Gerar de novo

function regenBlocker(task: CadenceTaskRow | null): 'invalid_status' | 'limit' | null {
  if (!task || !REGEN_STATUSES.includes(task.status)) return 'invalid_status';
  if (task.status === 'skipped' && task.generation_meta?.skipped_by !== 'ai') return 'invalid_status';
  return Number(task.generation_meta?.regenerations ?? 0) >= MAX_REGENERATIONS ? 'limit' : null;
}

function reactedAfter(rows: DraftRow[], basisAtIso: string): boolean {
  const basis = toMs(basisAtIso) ?? Infinity;
  return rows.some((r) => !r.from_me && r.type === 'reaction' && (toMs(r.timestamp) ?? -Infinity) > basis);
}

function regenInstruction(opts: { instruction?: string; force?: boolean }): string | undefined {
  const parts = [String(opts.instruction ?? '').trim(), opts.force ? FORCE_INSTRUCTION : ''].filter(Boolean);
  return parts.length ? parts.join(' ') : undefined;
}

interface RegenContext {
  userId: string; task: CadenceTaskRow; config: FollowUpConfig; now: Date; nowIso: string; claimedAt: string;
  opts: { instruction?: string; force?: boolean; actorId: string };
}

async function regenDraftInput(deps: CadenceSweepDeps, ctx: RegenContext): Promise<DraftInput> {
  const { task, config } = ctx;
  const main = (await deps.repo.mainWaNumber(ctx.userId, config)) || String(task.wa_number ?? '');
  const [agent, rows] = await Promise.all([
    deps.repo.loadAgentConfig(ctx.userId),
    deps.repo.loadConversationRows(ctx.userId, task.phone, brazilianPhoneVariants(main), CONVERSATION_ROWS),
  ]);
  const meta = task.generation_meta ?? {};
  return {
    userId: ctx.userId, waNumber: main, step: Number(task.step) as FollowUpStep, contactName: task.contact_name, rows,
    agent: agent ?? EMPTY_AGENT, extraInstructions: config.extra_instructions, userInstruction: regenInstruction(ctx.opts),
    invisible: { basis: !!meta.invisible_basis, at: meta.invisible_basis ? task.basis_at : null, read: !!meta.invisible_read },
    customerReactedAfterBasis: reactedAfter(rows, task.basis_at), now: ctx.now,
  };
}

function withoutStaleMeta(meta: CadenceGenerationMeta | null | undefined): CadenceGenerationMeta {
  const copy: Record<string, unknown> = { ...(meta ?? {}) };
  for (const key of STALE_META_KEYS) delete copy[key];
  return copy as CadenceGenerationMeta;
}

function regeneratedPatch(ctx: RegenContext, r: Extract<DraftResult, { kind: 'draft' }>, rows: DraftRow[], doneIso: string): Record<string, unknown> {
  const previous = ctx.task.generation_meta ?? {};
  const generation_meta: CadenceGenerationMeta = {
    ...withoutStaleMeta(previous), ...r.meta,
    outcome: 'draft', skip_reason: null, skipped_by: null, handoff_reason: null, warnings: r.warnings,
    regenerations: Number(previous.regenerations ?? 0) + 1, edited_by: ctx.opts.actorId, edited_at: doneIso,
    context_tail: contextTail(rows),
  };
  return {
    status: 'draft', message: r.text, draft_text: r.text, approved_at: null, approved_by: null, last_error: null,
    ...STALE_SEND_FIELDS, updated_at: doneIso, generation_meta,
  };
}

function backToDraftPatch(task: CadenceTaskRow, nowIso: string): Record<string, unknown> {
  return {
    status: 'draft', approved_at: null, approved_by: null, ...STALE_SEND_FIELDS,
    generation_meta: withoutStaleMeta(task.generation_meta), updated_at: nowIso,
  };
}

// Tarefa que já estava pulada pela IA volta para pulada: não deixa rascunho vazio vivo.
async function suggestSkip(deps: CadenceSweepDeps, ctx: RegenContext, reason: string): Promise<RegenerateResult> {
  if (ctx.task.status === 'skipped') {
    await deps.repo.updateTaskCas(ctx.task.id, ctx.userId, { status: 'skipped', updated_at: ctx.nowIso },
      { statuses: ['draft'], updatedAt: ctx.claimedAt });
  }
  return { status: 'ai_suggests_skip', reason };
}

async function regenerateClaimed(deps: CadenceSweepDeps, ctx: RegenContext): Promise<RegenerateResult> {
  const lastCustomer = await deps.repo.lastCustomerTurnAt(ctx.userId, ctx.task.phone);
  if (customerSpokeAfter(ctx.task.basis_at, lastCustomer)) return { status: 'conversation_changed' };
  const input = await regenDraftInput(deps, ctx);
  const r = await deps.generate(input, deps.draftDeps);
  if (r.kind === 'error') return { status: 'error', message: r.message, retryable: r.retryable };
  if (r.kind !== 'draft') return suggestSkip(deps, ctx, r.reason);
  const patch = regeneratedPatch(ctx, r, input.rows, deps.now().toISOString());
  const updated = await deps.repo.updateTaskCas(ctx.task.id, ctx.userId, patch, { statuses: ['draft'], updatedAt: ctx.claimedAt });
  return updated ? { status: 'updated' } : { status: 'conflict' };
}

// Fábrica

export function createCadenceSweep(deps: CadenceSweepDeps): CadenceSweep {
  async function runSweep(userId: string, req: SweepRequest, hooks: SweepHooks = {}): Promise<SweepSummary> {
    const now = deps.now();
    const loaded = await deps.repo.loadConfig(userId);
    if (!loaded.exists || (!req.manual && !loaded.config.enabled)) return { ...emptySummary(), finished_at: now.toISOString() };
    if (!loaded.state.external_ai_consent_at) throw new Error('AI_CONSENT_REQUIRED');
    const scope = await loadScope(deps, userId, loaded, req, now);
    if (!scope) return finishWithoutMain(deps, userId, loaded, now);
    return runScope(deps, scope, req, hooks);
  }

  async function countEligible(userId: string, req: SweepRequest): Promise<SweepDryRun> {
    const now = deps.now();
    const loaded = await deps.repo.loadConfig(userId);
    if (!loaded.exists || (!req.manual && !loaded.config.enabled)) return emptyDryRun();
    const scope = await loadScope(deps, userId, loaded, req, now);
    if (!scope) return emptyDryRun();
    // Simula a faxina em memória: a prévia não grava nada.
    scope.tasks = markCancelled(scope.tasks, new Set(housekeepPlan(scope).map((p) => Number(p.id))));
    const { eligible, skipped } = selectFor(scope, req);
    return dryRunOf(eligible, skipped);
  }

  async function regenerate(userId: string, taskId: number, opts: { instruction?: string; force?: boolean; actorId: string }): Promise<RegenerateResult> {
    const loaded = await deps.repo.loadConfig(userId);
    if (!loaded.state.external_ai_consent_at) return { status: 'consent_required' };
    const task = await deps.repo.loadTask(userId, taskId);
    const blocker = regenBlocker(task);
    if (blocker || !task) return { status: blocker ?? 'invalid_status' };
    const now = deps.now();
    const nowIso = now.toISOString();
    // Tira da fila antes da IA: o sender não pega uma tarefa que está sendo reescrita.
    const claimed = await deps.repo.updateTaskCas(task.id, userId, backToDraftPatch(task, nowIso), { statuses: [task.status], noLiveLeaseAt: nowIso });
    if (!claimed) return { status: 'conflict' };
    const ctx: RegenContext = { userId, task, config: loaded.config, now, nowIso, claimedAt: claimed.updated_at || nowIso, opts };
    return regenerateClaimed(deps, ctx);
  }

  return { runSweep, countEligible, regenerate };
}

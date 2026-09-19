// Monta a cadência de follow-up: repositório, varredura, sender e os serviços
// que as rotas usam. start() liga o sender (a cada 20s) e o agendador de
// varreduras (a cada 5 min). Sem a migration 083 tudo fica ocioso, com log
// espaçado. Não registra SIGTERM: a prova de entrega cobre a interrupção.
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  CadenceGenerationMeta, ChannelHealth, DeliveryFailureInput, FollowUpConfig, FollowUpServices, FollowUpTemplateOption,
  ForecastInput, ForecastResult, MoveInput, MoveResult, ReconcileApplyRequest, ReconcileApplyResult, ReconcilePreview,
  SweepState,
} from './src/features/followups/types.js';
import type { DraftDeps } from './followup-draft.js';
import { generateCadenceDraft, NEUTRAL_HOOKS } from './followup-draft.js';
import { nextErrorState } from './followup-cadence.js';
import type { CadenceTemplate } from './followup-channel.js';
import { approvalFor, chooseChannel, renderTemplate, toChannelHealthDTO, validateCadenceTemplate } from './followup-channel.js';
import type { CadenceSenderRepo, SenderTransport } from './followup-sender.js';
import { createCadenceSender } from './followup-sender.js';
import type { CadenceSweepDeps } from './followup-sweep.js';
import { createCadenceSweep } from './followup-sweep.js';
import type { FollowUpRepo, TenantEntry } from './followup-repo.js';
import { createFollowUpRepo, createSenderTransport, isCadenceMigrationMissing } from './followup-repo.js';
import { isWithinBusinessHours, nextWindowOpening } from './lib/business-hours.js';
import { maskPhone } from './lib/br-phone.js';
import { nonOverlappingTask } from './lib/non-overlapping-task.js';

export interface CadenceFunnelPort {
  moveDealStage(i: MoveInput): Promise<MoveResult>;
  reconcilePreview(userId: string, opts: { limit?: number; days?: number }): Promise<ReconcilePreview>;
  reconcileApply(userId: string, req: ReconcileApplyRequest, actorId: string): Promise<ReconcileApplyResult>;
  invalidate(userId: string): void;
}
export interface FollowUpCadenceDeps {
  db: SupabaseClient; funnel: CadenceFunnelPort;
  getReplyDetailed: DraftDeps['getReplyDetailed'];
  loadSupervisedMemory: (userId: string, waNumber: string) => Promise<string>;
  baileys: { status(key: string): 'open' | 'connecting' | 'close' | 'not_initialized'; registeredPhone(key: string): string | null;
             paired(key: string): boolean; sendText(key: string, jidDigits: string, text: string): Promise<string>;
             sendTyping(key: string, jidDigits: string, on: boolean): Promise<void> };
  decryptToken: (blob: string | null | undefined) => string | null;
  refreshMetaState: (userId: string) => Promise<boolean>;
  mainWaNumber: (userId: string) => Promise<string>;
  now?: () => Date; log?: (event: string, data?: Record<string, unknown>) => void;
}

// Peças trocáveis (testes): o padrão é o banco real, o transporte real e a IA real.
export interface FollowUpCadenceParts {
  repo: FollowUpRepo;
  transport: SenderTransport;
  generate?: CadenceSweepDeps['generate'];
  random?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export const SENDER_TICK_MS = 20_000;
export const SWEEP_SCHEDULER_MS = 5 * 60_000;
export const QUIET_LOG_MS = 10 * 60_000;
const PREVIEW_PARAMS = ['Maria', NEUTRAL_HOOKS[1]];

type Log = (event: string, data?: Record<string, unknown>) => void;

// Utilitários

function defaultLog(event: string, data?: Record<string, unknown>): void {
  console.log(`[followups] ${event}`, data ?? {});
}

function errorText(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error ?? '');
  return text.replace(/\d{8,}/g, (digits) => maskPhone(digits)).slice(0, 200);
}

function idleSweepState(nextAutoAt: string | null): SweepState {
  return { running: false, started_at: null, finished_at: null, progress: null, last_summary: null, next_auto_at: nextAutoAt };
}

// No máximo um log por chave a cada QUIET_LOG_MS: worker ocioso não enche o log.
function createQuietLog(log: Log, now: () => Date): (key: string, event: string, data?: Record<string, unknown>) => void {
  const last = new Map<string, number>();
  return (key, event, data) => {
    const nowMs = now().getTime();
    const previous = last.get(key);
    if (previous !== undefined && nowMs - previous < QUIET_LOG_MS) return;
    last.set(key, nowMs);
    log(event, data);
  };
}

// Sem a 083 o sender só fica ocioso: listar e reservar devolvem vazio.
function guardSenderRepo(repo: FollowUpRepo, quiet: ReturnType<typeof createQuietLog>): CadenceSenderRepo {
  const idle = <T>(fallback: T) => (error: unknown): T => {
    if (!isCadenceMigrationMissing(error)) throw error;
    quiet('migration', 'cadence_migration_missing', { error: errorText(error) });
    return fallback;
  };
  return {
    ...repo,
    listActiveConfigs: () => repo.listActiveConfigs().catch(idle([])),
    claim: (...args) => repo.claim(...args).catch(idle(null)),
  };
}

function businessWindow(config: FollowUpConfig, now: Date): { open: boolean; next_open_at: string | null } {
  if (isWithinBusinessHours(now, config.business_hours)) return { open: true, next_open_at: null };
  try {
    return { open: false, next_open_at: nextWindowOpening(now, config.business_hours).toISOString() };
  } catch {
    return { open: false, next_open_at: null };
  }
}

function templateOption(t: CadenceTemplate): FollowUpTemplateOption {
  const check = validateCadenceTemplate(t);
  return {
    id: t.id, name: t.name, language: t.language, status: t.status, category: t.category,
    eligible: check.ok, reason: check.ok ? null : check.reason, preview: renderTemplate(t.bodyText, PREVIEW_PARAMS),
  };
}

function unixOrIso(value: string | null, fallback: Date): string {
  const text = String(value ?? '').trim();
  const ms = /^\d{9,11}$/.test(text) ? Number(text) * 1000 : Date.parse(text);
  return new Date(Number.isFinite(ms) ? ms : fallback.getTime()).toISOString();
}

function failureMessage(error: { code: number | null; title: string | null } | undefined): string {
  const code = error?.code ?? null;
  const title = String(error?.title ?? '').trim();
  if (code !== null && title) return `A Meta não entregou (código ${code}: ${title}).`;
  if (code !== null) return `A Meta não entregou (código ${code}).`;
  return title ? `A Meta não entregou (${title}).` : 'A Meta não entregou a mensagem.';
}

function sweepDue(entry: TenantEntry, now: Date): boolean {
  const last = Date.parse(String(entry.state.last_sweep_at ?? ''));
  if (!Number.isFinite(last)) return true;
  return now.getTime() - last >= entry.config.sweep_interval_minutes * 60_000;
}

function nextAutoAt(entry: TenantEntry, now: Date): string {
  const last = Date.parse(String(entry.state.last_sweep_at ?? ''));
  const base = Number.isFinite(last) ? last : now.getTime();
  return new Date(base + entry.config.sweep_interval_minutes * 60_000).toISOString();
}

// Fábricas

export function createFollowUpCadence(deps: FollowUpCadenceDeps): { services: FollowUpServices; start(): void; stop(): void } {
  const repo = createFollowUpRepo(deps.db, {
    baileys: deps.baileys, decryptToken: deps.decryptToken, refreshMetaState: deps.refreshMetaState,
    mainWaNumber: deps.mainWaNumber, now: deps.now,
  });
  return createFollowUpCadenceFrom(deps, { repo, transport: createSenderTransport({ baileys: deps.baileys }) });
}

export function createFollowUpCadenceFrom(deps: FollowUpCadenceDeps, parts: FollowUpCadenceParts): { services: FollowUpServices; start(): void; stop(): void } {
  const now = deps.now ?? (() => new Date());
  const log: Log = deps.log ?? defaultLog;
  const quiet = createQuietLog(log, now);
  const { repo } = parts;
  const sender = createCadenceSender({
    now, sleep: parts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))), random: parts.random ?? Math.random,
    workerId: `cad-${process.pid}-${Math.random().toString(36).slice(2, 8)}`,
    repo: guardSenderRepo(repo, quiet), transport: parts.transport, funnel: deps.funnel, log,
  });
  const sweepStates = new Map<string, SweepState>();
  const nextAuto = new Map<string, string>();
  const regenLocks = new Set<string>();
  const timers: Array<ReturnType<typeof setInterval>> = [];

  async function templateFor(userId: string, config: FollowUpConfig): Promise<CadenceTemplate | null> {
    return config.template_id ? repo.loadTemplate(userId, config.template_id) : null;
  }

  async function channelHealth(userId: string, config: FollowUpConfig): Promise<ChannelHealth> {
    const [health, template] = await Promise.all([repo.loadHealth(userId, config), templateFor(userId, config)]);
    return toChannelHealthDTO(health, config, template, now());
  }

  async function forecast(userId: string, config: FollowUpConfig, items: ForecastInput[]): Promise<ForecastResult[]> {
    if (!items.length) return [];
    const [health, template] = await Promise.all([repo.loadHealth(userId, config), templateFor(userId, config)]);
    const at = now();
    const main = health.mainWaNumber ?? '';
    return items.map((item) => {
      const d = chooseChannel({ now: at, lastCustomerAt: item.last_customer_at, conversationWaNumber: main, health, config, template });
      const channel = d.ok ? d.channel : 'blocked';
      return { id: item.id, channel, approval: approvalFor({ channel, template, contactName: item.contact_name, text: item.text, step: item.step }) };
    });
  }

  const sweep = createCadenceSweep({
    repo, generate: parts.generate ?? generateCadenceDraft,
    draftDeps: { getReplyDetailed: deps.getReplyDetailed, loadSupervisedMemory: deps.loadSupervisedMemory },
    forecastFor: forecast, now, log, kick: (userId) => sender.kick(userId),
  });

  function sweepState(userId: string): SweepState {
    return sweepStates.get(userId) ?? idleSweepState(nextAuto.get(userId) ?? null);
  }

  function patchSweepState(userId: string, patch: Partial<SweepState>): void {
    sweepStates.set(userId, { ...sweepState(userId), ...patch });
  }

  const runSweep: FollowUpServices['runSweep'] = async (userId, req) => {
    // Checar e marcar sem await no meio: duas chamadas juntas não passam as duas.
    if (sweepStates.get(userId)?.running) throw new Error('SWEEP_RUNNING');
    patchSweepState(userId, { running: true, started_at: now().toISOString(), finished_at: null, progress: { total: 0, done: 0 } });
    try {
      const summary = await sweep.runSweep(userId, req, { onProgress: (progress) => patchSweepState(userId, { progress }) });
      patchSweepState(userId, { running: false, finished_at: now().toISOString(), last_summary: summary });
      return summary;
    } catch (error) {
      patchSweepState(userId, { running: false, finished_at: now().toISOString() });
      throw error;
    }
  };

  const regenerate: FollowUpServices['regenerate'] = async (userId, taskId, opts) => {
    const key = `${userId}:${taskId}`;
    if (regenLocks.has(key)) throw new Error('REGEN_RUNNING');
    regenLocks.add(key);
    try {
      return await sweep.regenerate(userId, taskId, opts);
    } finally {
      regenLocks.delete(key);
    }
  };

  async function countFailure(userId: string, message: string): Promise<void> {
    const { config, state } = await repo.loadConfig(userId);
    const next = nextErrorState(state.consecutive_errors, 'error', config.max_consecutive_errors);
    const pause = next.pause ? { paused_at: now().toISOString(), paused_reason: 'error_streak' as const } : {};
    await repo.updateState(userId, { consecutive_errors: next.consecutive, last_error: message, ...pause });
  }

  function failureMeta(meta: CadenceGenerationMeta, input: DeliveryFailureInput, at: Date): Partial<CadenceGenerationMeta> {
    const first = input.errors?.[0];
    const merged: Partial<CadenceGenerationMeta> = {
      ...meta, failure: { code: first?.code ?? null, title: first?.title ?? null, at: unixOrIso(input.timestamp, at) },
    };
    // Etapa só avança se ainda não avançou: o que já andou fica registrado como está.
    if (meta.advance?.state === 'pending') merged.advance = { ...meta.advance, state: 'skipped', result: null };
    return merged;
  }

  // Status 'failed' da Meta chegou depois do envio: a tarefa vira failed e nunca avança.
  async function recordDeliveryFailure(input: DeliveryFailureInput): Promise<void> {
    try {
      const task = await repo.findTaskByMessageId(input.userId, input.messageId);
      if (!task || task.status !== 'sent') return;
      const message = failureMessage(input.errors?.[0]);
      const at = now();
      const updated = await repo.updateTaskCas(task.id, input.userId,
        { status: 'failed', last_error: message, generation_meta: failureMeta(task.generation_meta ?? {}, input, at), updated_at: at.toISOString() },
        { statuses: ['sent'] });
      if (!updated) return;
      await countFailure(input.userId, message);
      log('cadence_delivery_failed', { userId: input.userId, taskId: task.id, dealId: task.deal_id, phone: maskPhone(task.phone), code: input.errors?.[0]?.code ?? null });
    } catch (error) {
      if (!isCadenceMigrationMissing(error)) throw error;
    }
  }

  const services: FollowUpServices = {
    runSweep,
    countEligible: (userId, req) => sweep.countEligible(userId, req),
    regenerate,
    kickSender: (userId) => sender.kick(userId),
    channelHealth,
    forecast,
    listTemplates: async (userId) => (await repo.listTemplateRows(userId)).map(templateOption),
    dedupeReady: () => repo.dedupeReady(),
    businessWindow,
    sweepState,
    invalidateConfig: (userId) => {
      repo.invalidate(userId);
      deps.funnel.invalidate(userId);
    },
    recordDeliveryFailure,
    reconcilePreview: (userId, opts) => deps.funnel.reconcilePreview(userId, opts),
    reconcileApply: (userId, req, actorId) => deps.funnel.reconcileApply(userId, req, actorId),
  };

  // Agendador de varreduras automáticas

  function onAutoSweepError(userId: string, error: unknown): void {
    const message = error instanceof Error ? error.message : '';
    if (message === 'SWEEP_RUNNING') return;
    if (message === 'AI_CONSENT_REQUIRED') return quiet(`consent:${userId}`, 'cadence_sweep_consent_required', { userId });
    if (isCadenceMigrationMissing(error)) return quiet('migration', 'cadence_migration_missing', { error: errorText(error) });
    log('cadence_sweep_failed', { userId, error: errorText(error) });
  }

  async function autoSweepEntry(entry: TenantEntry): Promise<void> {
    const at = now();
    nextAuto.set(entry.userId, nextAutoAt(entry, at));
    if (!sweepDue(entry, at)) return;
    if (!entry.state.external_ai_consent_at) return quiet(`consent:${entry.userId}`, 'cadence_sweep_consent_required', { userId: entry.userId });
    try {
      await runSweep(entry.userId, { manual: false });
      nextAuto.set(entry.userId, new Date(now().getTime() + entry.config.sweep_interval_minutes * 60_000).toISOString());
    } catch (error) {
      onAutoSweepError(entry.userId, error);
    }
  }

  async function autoSweepScan(): Promise<void> {
    let entries: TenantEntry[];
    try {
      entries = await repo.listConfigsForAutoSweep();
    } catch (error) {
      onAutoSweepError('*', error);
      return;
    }
    for (const entry of entries) await autoSweepEntry(entry);
  }

  const senderTick = nonOverlappingTask(() => sender.tick());
  const sweepTick = nonOverlappingTask(autoSweepScan);

  function start(): void {
    if (timers.length) return;
    timers.push(setInterval(() => { senderTick().catch((error) => log('cadence_sender_tick_failed', { error: errorText(error) })); }, SENDER_TICK_MS));
    timers.push(setInterval(() => { sweepTick().catch((error) => log('cadence_sweep_tick_failed', { error: errorText(error) })); }, SWEEP_SCHEDULER_MS));
    for (const timer of timers) (timer as { unref?: () => void }).unref?.();
  }

  function stop(): void {
    for (const timer of timers.splice(0)) clearInterval(timer);
  }

  return { services, start, stop };
}

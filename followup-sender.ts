// Sender da cadência: uma mensagem por conta por tick. Cada balão aceito pelo
// WhatsApp ganha prova gravada antes de qualquer outra coisa, e envio sem prova
// nunca é repetido sozinho. Banco, WhatsApp, funil e relógio entram por SenderDeps.
import type {
  BlockCode, CadenceGenerationMeta, CadenceStatus, CadenceTaskRow, CancelReason, ChannelKind, FollowUpConfig,
  FollowUpRuntimeState, MoveInput, MoveResult,
} from './src/features/followups/types.js';
import { ADVANCE_CONFIRM_MINUTES } from './src/features/followups/types.js';
import type { SendDecision, SendSnapshot } from './followup-cadence.js';
import { nextErrorState, nextStageAfterStep, resolveExpiredLease, shouldCancelBeforeSend } from './followup-cadence.js';
import { isWithinBusinessHours, localDayStartUtc, nextWindowOpening, pickGapSeconds } from './lib/business-hours.js';
import { baileysJid, brazilianPhoneVariants, digitsOnly, maskPhone } from './lib/br-phone.js';
import type { CadenceTemplate, ChannelDecision, ErrorClass, GraphResult, SenderChannelHealth } from './followup-channel.js';
import {
  approvalMatches, chooseChannel, classifyBaileysError, classifyGraphError, renderTemplate, splitBalloons, templateParams,
  templatePayload, tenantBlock,
} from './followup-channel.js';

export interface SenderTransport {
  baileysSendText(sessionKey: string, jidDigits: string, text: string): Promise<string>;
  baileysTyping(sessionKey: string, jidDigits: string, on: boolean): Promise<void>;
  graphSend(phoneNumberId: string, token: string, payload: Record<string, unknown>): Promise<GraphResult>;
}
export interface OutboundRecord { userId: string; phone: string; waNumber: string; messageId: string; body: string; channel: ChannelKind; timestampIso: string }
export interface CadenceTaskPatch {
  status: CadenceStatus; sent_at?: string | null; channel_used?: ChannelKind | null; sent_message_id?: string | null;
  last_error?: string | null; approved_at?: string | null; approved_by?: string | null; scheduled_at?: string;
  release_claim?: boolean;
  generation_meta_merge?: Partial<CadenceGenerationMeta>;
}
export interface CadenceSenderRepo {
  listActiveConfigs(): Promise<Array<{ userId: string; config: FollowUpConfig; state: FollowUpRuntimeState }>>;
  claim(userId: string, workerId: string, leaseSeconds: number, gapSeconds: number, dayStartIso: string): Promise<CadenceTaskRow | null>;
  loadSendSnapshot(task: CadenceTaskRow, waNumbers: string[]): Promise<SendSnapshot>;
  loadHealth(userId: string, config: FollowUpConfig): Promise<SenderChannelHealth>;
  loadTemplate(userId: string, templateId: number): Promise<CadenceTemplate | null>;
  recordDeliveryProof(task: CadenceTaskRow, proof: { message_ids: string[]; channel: ChannelKind; delivered_text: string }): Promise<boolean>;
  persistOutbound(r: OutboundRecord): Promise<void>;
  finish(task: CadenceTaskRow, patch: CadenceTaskPatch): Promise<boolean>;
  forceMarkSent(task: CadenceTaskRow, patch: CadenceTaskPatch): Promise<void>;
  listPendingAdvances(userId: string, nowIso: string, limit: number): Promise<CadenceTaskRow[]>;
  markAdvance(task: CadenceTaskRow, state: 'done' | 'skipped', result: MoveResult | null): Promise<void>;
  updateState(userId: string, patch: Partial<FollowUpRuntimeState>): Promise<void>;
}
export interface SenderDeps { now(): Date; sleep(ms: number): Promise<void>; random(): number; workerId: string;
  repo: CadenceSenderRepo; transport: SenderTransport;
  funnel: { moveDealStage(i: MoveInput): Promise<MoveResult> };
  log(event: string, data?: Record<string, unknown>): void }

export const LEASE_SECONDS = 300;
export const TASK_DEADLINE_MS = 120_000;
const ADVANCE_BATCH = 10;
const QUICK_NEXT_MS = 5_000;
const RATE_LIMIT_COOLDOWN_MS = 15 * 60_000;
const TRANSIENT_BACKOFF_MINUTES = [5, 20, 60];
const MAX_TRANSIENT_ATTEMPTS = 3;
const BALLOON_PAUSE_MIN_MS = 1500;
const BALLOON_PAUSE_MAX_MS = 3000;
const TYPING_BASE_MS = 1200;
const TYPING_PER_CHAR_MS = 35;
const TYPING_MAX_MS = 6000;
const OUTSIDE_HOURS_FALLBACK_MS = 60 * 60_000;

const MESSAGES = {
  forcedSent: 'Um follow-up foi enviado enquanto a tarefa era editada. Confira a conversa.',
  stale: 'Aprovado há mais de 72h. Revise antes de enviar.',
  ambiguous: 'Envio interrompido. Confira a conversa antes de reenviar.',
  windowClosed: 'A janela de 24h fechou. Revise a versão em template.',
  emptyText: 'O texto do follow-up está vazio. Revise antes de enviar.',
} as const;

type TenantEntry = { userId: string; config: FollowUpConfig; state: FollowUpRuntimeState };
interface TenantEnv extends TenantEntry { deps: SenderDeps; health: SenderChannelHealth; template: CadenceTemplate | null }

type Outcome =
  | { kind: 'sent'; ids: string[]; deliveredText: string; channel: ChannelKind; recovered: boolean; proofAt: string | null }
  | { kind: 'cancel'; reason: CancelReason }
  | { kind: 'hold'; reason: 'disabled' | 'paused' | 'outside_hours' | 'deadline' }
  | { kind: 'stale' }
  | { kind: 'review'; message: string }
  | { kind: 'ambiguous'; detail: string }
  | { kind: 'blocked'; scope: 'task' | 'tenant'; code: BlockCode; message: string }
  | { kind: 'error'; cls: ErrorClass; code: number | null; detail: string };

type PartResult = { ok: true; messageId: string } | { ok: false; cls: ErrorClass; code: number | null; detail: string };
interface ChannelPlan { parts: string[]; send(part: string): Promise<PartResult>; pause(): Promise<void> }
interface Ready { snap: SendSnapshot; decision: Extract<ChannelDecision, { ok: true }>; plan: ChannelPlan }
interface SentSoFar { ids: string[]; parts: string[]; proofAt: string | null }

// Utilitários

function iso(ms: number | Date): string {
  return new Date(ms instanceof Date ? ms.getTime() : ms).toISOString();
}

function later(deps: SenderDeps, ms: number): string {
  return iso(deps.now().getTime() + ms);
}

// Erro de banco pode citar telefone: só vai para o log mascarado e curto.
function errorText(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error ?? '');
  return text.replace(/\d{8,}/g, (digits) => maskPhone(digits)).slice(0, 200);
}

function taskLog(env: TenantEnv, task: CadenceTaskRow, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { userId: env.userId, taskId: task.id, dealId: task.deal_id, step: task.step, phone: maskPhone(task.phone), ...extra };
}

// Avanço de etapa: só depois de ADVANCE_CONFIRM_MINUTES sem falha de entrega.

async function advanceOne(deps: SenderDeps, entry: TenantEntry, task: CadenceTaskRow): Promise<void> {
  const next = nextStageAfterStep(task.step, entry.config);
  try {
    if (!next) {
      await deps.repo.markAdvance(task, 'skipped', null);
      return;
    }
    const result = await deps.funnel.moveDealStage({
      userId: entry.userId, dealId: Number(task.deal_id), toStageId: next, expectedFromStage: task.stage_id,
      allowFrom: [task.stage_id], reason: 'cadence_step', evidence: { task_id: task.id, step: task.step },
    });
    await deps.repo.markAdvance(task, 'done', result);
    deps.log('cadence_advance', { userId: entry.userId, taskId: task.id, dealId: task.deal_id, result });
  } catch (error) {
    deps.log('cadence_advance_failed', { userId: entry.userId, taskId: task.id, error: errorText(error) });
  }
}

async function advancePending(deps: SenderDeps, entry: TenantEntry): Promise<void> {
  let tasks: CadenceTaskRow[];
  try {
    tasks = await deps.repo.listPendingAdvances(entry.userId, deps.now().toISOString(), ADVANCE_BATCH);
  } catch (error) {
    deps.log('cadence_advance_list_failed', { userId: entry.userId, error: errorText(error) });
    return;
  }
  for (const task of tasks) await advanceOne(deps, entry, task);
}

// Portão antes do claim

function pacing(state: FollowUpRuntimeState, now: Date): boolean {
  const next = Date.parse(String(state.next_send_after ?? ''));
  return Number.isFinite(next) && next > now.getTime();
}

const GATES: Array<[string, (e: TenantEntry, now: Date) => boolean]> = [
  ['disabled', (e) => !e.config.enabled],
  ['paused', (e) => !!e.state.paused_at],
  ['outside_hours', (e, now) => !isWithinBusinessHours(now, e.config.business_hours)],
  ['pacing', (e, now) => pacing(e.state, now)],
];

function gateReason(entry: TenantEntry, now: Date): string | null {
  const hit = GATES.find(([, closed]) => closed(entry, now));
  return hit ? hit[0] : null;
}

async function rememberTenantBlock(env: TenantEnv, block: { code: BlockCode; message: string }): Promise<void> {
  if (env.state.last_block_code === block.code && env.state.last_block_message === block.message) return;
  await env.deps.repo.updateState(env.userId, {
    last_block_code: block.code, last_block_message: block.message, last_block_at: env.deps.now().toISOString(),
  });
}

// Canais: cada um diz quais balões saem e como sai cada balão.

async function graphPart(env: TenantEnv, payload: Record<string, unknown>): Promise<PartResult> {
  const meta = env.health.meta;
  try {
    const r = await env.deps.transport.graphSend(String(meta.phoneNumberId ?? ''), String(meta.token ?? ''), payload);
    if (r.ok) return { ok: true, messageId: String(r.messageId) };
    return { ok: false, cls: classifyGraphError(r), code: r.code, detail: `http_${r.httpStatus}` };
  } catch {
    // A Graph pode ter recebido o pedido: sem resposta, é ambíguo.
    return { ok: false, cls: 'ambiguous', code: null, detail: 'graph_exception' };
  }
}

async function typing(env: TenantEnv, jid: string, on: boolean): Promise<void> {
  try {
    await env.deps.transport.baileysTyping(env.userId, jid, on);
  } catch { /* presença é best-effort */ }
}

async function baileysPart(env: TenantEnv, jid: string, part: string): Promise<PartResult> {
  await typing(env, jid, true);
  await env.deps.sleep(Math.min(TYPING_BASE_MS + TYPING_PER_CHAR_MS * part.length, TYPING_MAX_MS));
  await typing(env, jid, false);
  try {
    return { ok: true, messageId: String(await env.deps.transport.baileysSendText(env.userId, jid, part)) };
  } catch (error) {
    return { ok: false, cls: classifyBaileysError(error), code: null, detail: 'baileys_error' };
  }
}

function balloonPause(deps: SenderDeps): Promise<void> {
  const span = BALLOON_PAUSE_MAX_MS - BALLOON_PAUSE_MIN_MS + 1;
  return deps.sleep(BALLOON_PAUSE_MIN_MS + Math.min(span - 1, Math.floor(deps.random() * span)));
}

const SENDERS: Record<ChannelKind, (env: TenantEnv, task: CadenceTaskRow, snap: SendSnapshot) => ChannelPlan> = {
  meta_text: (env, task, snap) => {
    const to = digitsOnly(snap.conversationPhone);
    return {
      parts: splitBalloons(task.message),
      send: (body) => graphPart(env, { messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'text', text: { body, preview_url: false } }),
      pause: () => balloonPause(env.deps),
    };
  },
  meta_template: (env, task, snap) => {
    const template = env.template as CadenceTemplate;
    const params = templateParams(task.contact_name, task.message, task.step);
    const to = digitsOnly(snap.conversationPhone);
    return {
      parts: [renderTemplate(template.bodyText, params)],
      send: () => graphPart(env, { messaging_product: 'whatsapp', to, type: 'template', template: templatePayload(template, params) }),
      pause: () => balloonPause(env.deps),
    };
  },
  baileys: (env, task, snap) => {
    const jid = baileysJid(snap.conversationPhone, snap.seenBaileysPhones);
    return { parts: splitBalloons(task.message), send: (part) => baileysPart(env, jid, part), pause: () => balloonPause(env.deps) };
  },
};

// Preparação: revalida tudo contra o banco antes de encostar no WhatsApp.

function fromSendDecision(d: Exclude<SendDecision, { action: 'send' }>): Outcome {
  if (d.action === 'cancel') return { kind: 'cancel', reason: d.reason };
  if (d.action === 'hold') return { kind: 'hold', reason: d.reason };
  return { kind: 'stale' };
}

async function prepare(env: TenantEnv, task: CadenceTaskRow): Promise<Ready | Outcome> {
  const waNumbers = brazilianPhoneVariants(env.health.mainWaNumber || task.wa_number);
  const snap = await env.deps.repo.loadSendSnapshot(task, waNumbers);
  const now = env.deps.now();
  const verdict = shouldCancelBeforeSend(task, snap, env.config, env.state, now);
  if (verdict.action !== 'send') return fromSendDecision(verdict);
  const decision = chooseChannel({
    now, lastCustomerAt: snap.lastCustomerAt, conversationWaNumber: snap.conversationWaNumber,
    health: env.health, config: env.config, template: env.template,
  });
  if (!decision.ok) return { kind: 'blocked', scope: decision.scope, code: decision.code, message: decision.message };
  const match = approvalMatches(task, decision.channel, env.template);
  if (!match.ok) return { kind: 'review', message: match.message };
  const plan = SENDERS[decision.channel](env, task, snap);
  if (plan.parts.length === 0) return { kind: 'review', message: MESSAGES.emptyText };
  return { snap, decision, plan };
}

function isOutcome(value: Ready | Outcome): value is Outcome {
  return 'kind' in value;
}

// Lease vencido: a tarefa ficou em 'sending' sem desfecho. Com prova, já saiu.
function recoverLease(task: CadenceTaskRow): Outcome {
  if (resolveExpiredLease(task) === 'block') return { kind: 'ambiguous', detail: 'lease_expired_without_proof' };
  const delivery = task.generation_meta?.delivery;
  return {
    kind: 'sent', recovered: true,
    ids: [...(delivery?.message_ids ?? [])],
    deliveredText: String(delivery?.delivered_text ?? ''),
    channel: (delivery?.channel ?? task.channel_used ?? 'meta_text') as ChannelKind,
    proofAt: delivery?.proof_at ?? null,
  };
}

// Entrega com prova

function sentOutcome(ready: Ready, sent: SentSoFar): Outcome {
  return {
    kind: 'sent', recovered: false, ids: [...sent.ids], deliveredText: sent.parts.join('\n\n'),
    channel: ready.decision.channel, proofAt: sent.proofAt,
  };
}

async function recordProof(env: TenantEnv, task: CadenceTaskRow, ready: Ready, sent: SentSoFar): Promise<boolean> {
  const proof = { message_ids: [...sent.ids], channel: ready.decision.channel, delivered_text: sent.parts.join('\n\n') };
  try {
    const ok = await env.deps.repo.recordDeliveryProof(task, proof);
    if (ok) sent.proofAt = env.deps.now().toISOString();
    return ok;
  } catch (error) {
    env.deps.log('cadence_proof_failed', taskLog(env, task, { error: errorText(error) }));
    return false;
  }
}

async function persistLast(env: TenantEnv, task: CadenceTaskRow, ready: Ready, sent: SentSoFar): Promise<void> {
  try {
    await env.deps.repo.persistOutbound({
      userId: env.userId, phone: ready.snap.conversationPhone, waNumber: ready.decision.waNumber,
      messageId: sent.ids[sent.ids.length - 1], body: sent.parts[sent.parts.length - 1],
      channel: ready.decision.channel, timestampIso: env.deps.now().toISOString(),
    });
  } catch (error) {
    env.deps.log('cadence_persist_failed', taskLog(env, task, { error: errorText(error) }));
  }
}

// A prova vem antes de tudo; o balão aceito vai para o histórico mesmo se a
// prova falhar (ele saiu), mas aí o envio para por aqui.
async function proveAndPersist(env: TenantEnv, task: CadenceTaskRow, ready: Ready, sent: SentSoFar): Promise<boolean> {
  const proven = await recordProof(env, task, ready, sent);
  await persistLast(env, task, ready, sent);
  if (!proven) env.deps.log('cadence_lease_lost', taskLog(env, task, { parts: sent.ids.length }));
  return proven;
}

function failedPart(env: TenantEnv, task: CadenceTaskRow, ready: Ready, sent: SentSoFar, r: Extract<PartResult, { ok: false }>): Outcome {
  if (sent.ids.length > 0) {
    env.deps.log('cadence_partial_send', taskLog(env, task, { sent: sent.ids.length, cls: r.cls }));
    return sentOutcome(ready, sent);
  }
  // 'ambiguous' segue como erro e o onError manda para o bloqueio.
  return { kind: 'error', cls: r.cls, code: r.code, detail: r.detail };
}

async function deliver(env: TenantEnv, task: CadenceTaskRow, ready: Ready, deadlineMs: number): Promise<Outcome> {
  const sent: SentSoFar = { ids: [], parts: [], proofAt: null };
  const { plan } = ready;
  for (let index = 0; index < plan.parts.length; index++) {
    if (env.deps.now().getTime() > deadlineMs) return sent.ids.length ? sentOutcome(ready, sent) : { kind: 'hold', reason: 'deadline' };
    if (index > 0) await plan.pause();
    const result = await plan.send(plan.parts[index]);
    if (!result.ok) return failedPart(env, task, ready, sent, result);
    sent.ids.push(result.messageId);
    sent.parts.push(plan.parts[index]);
    if (!(await proveAndPersist(env, task, ready, sent))) break;
  }
  return sentOutcome(ready, sent);
}

async function processTask(env: TenantEnv, task: CadenceTaskRow): Promise<Outcome> {
  if (task.generation_meta?.prev_status === 'sending') return recoverLease(task);
  const deadlineMs = env.deps.now().getTime() + TASK_DEADLINE_MS;
  let ready: Ready | Outcome;
  try {
    ready = await prepare(env, task);
  } catch (error) {
    // Nada saiu ainda: é seguro devolver para a fila.
    env.deps.log('cadence_prepare_failed', taskLog(env, task, { error: errorText(error) }));
    return { kind: 'error', cls: 'transient', code: null, detail: 'prepare_failed' };
  }
  return isOutcome(ready) ? ready : deliver(env, task, ready, deadlineMs);
}

// Desfechos

async function finishLogged(env: TenantEnv, task: CadenceTaskRow, patch: CadenceTaskPatch): Promise<boolean> {
  const ok = await env.deps.repo.finish(task, patch);
  if (!ok) env.deps.log('cadence_lease_lost', taskLog(env, task, { status: patch.status }));
  return ok;
}

// Nada saiu e a conta ainda pode enviar: não gasta o intervalo inteiro.
function quickNext(env: TenantEnv): Promise<void> {
  return env.deps.repo.updateState(env.userId, { next_send_after: later(env.deps, QUICK_NEXT_MS) });
}

function sentPatch(env: TenantEnv, task: CadenceTaskRow, o: Extract<Outcome, { kind: 'sent' }>): CadenceTaskPatch {
  const now = env.deps.now();
  const next = nextStageAfterStep(task.step, env.config);
  const advance: CadenceGenerationMeta['advance'] = next
    ? { state: 'pending', due_at: iso(now.getTime() + ADVANCE_CONFIRM_MINUTES * 60_000) }
    : { state: 'skipped', due_at: now.toISOString(), result: null };
  const delivery: CadenceGenerationMeta['delivery'] = {
    message_ids: o.ids, delivered_text: o.deliveredText, channel: o.channel, recovered: o.recovered,
    ...(o.proofAt ? { proof_at: o.proofAt } : {}),
  };
  return {
    status: 'sent', sent_at: now.toISOString(), channel_used: o.channel, sent_message_id: o.ids[0] ?? null,
    last_error: null, release_claim: true, generation_meta_merge: { delivery, advance },
  };
}

async function onSent(env: TenantEnv, task: CadenceTaskRow, o: Extract<Outcome, { kind: 'sent' }>): Promise<string> {
  const patch = sentPatch(env, task, o);
  const state: Partial<FollowUpRuntimeState> = { consecutive_errors: 0, last_block_code: null, last_block_message: null };
  if (!(await finishLogged(env, task, patch))) {
    const merge = patch.generation_meta_merge as Partial<CadenceGenerationMeta>;
    const delivery = { ...(merge.delivery as NonNullable<CadenceGenerationMeta['delivery']>), forced: true };
    await env.deps.repo.forceMarkSent(task, { ...patch, generation_meta_merge: { ...merge, delivery } });
    state.last_error = MESSAGES.forcedSent;
  }
  await env.deps.repo.updateState(env.userId, state);
  env.deps.log('cadence_sent', taskLog(env, task, { channel: o.channel, parts: o.ids.length, recovered: o.recovered }));
  return o.recovered ? 'sent_recovered' : 'sent';
}

async function onCancel(env: TenantEnv, task: CadenceTaskRow, o: Extract<Outcome, { kind: 'cancel' }>): Promise<string> {
  await finishLogged(env, task, {
    status: 'cancelled', last_error: `cancel:${o.reason}`, release_claim: true, generation_meta_merge: { cancel_reason: o.reason },
  });
  await quickNext(env);
  env.deps.log('cadence_cancelled', taskLog(env, task, { reason: o.reason }));
  return 'cancelled';
}

function nextOpeningIso(env: TenantEnv): string {
  const now = env.deps.now();
  try {
    return nextWindowOpening(now, env.config.business_hours).toISOString();
  } catch {
    return iso(now.getTime() + OUTSIDE_HOURS_FALLBACK_MS);
  }
}

async function onHold(env: TenantEnv, task: CadenceTaskRow, o: Extract<Outcome, { kind: 'hold' }>): Promise<string> {
  await finishLogged(env, task, { status: 'approved', release_claim: true });
  if (o.reason === 'outside_hours') await env.deps.repo.updateState(env.userId, { next_send_after: nextOpeningIso(env) });
  return `hold_${o.reason}`;
}

async function backToDraft(env: TenantEnv, task: CadenceTaskRow, message: string): Promise<void> {
  await finishLogged(env, task, { status: 'draft', approved_at: null, approved_by: null, release_claim: true, last_error: message });
  await quickNext(env);
}

async function onStale(env: TenantEnv, task: CadenceTaskRow): Promise<string> {
  await backToDraft(env, task, MESSAGES.stale);
  return 'stale';
}

async function onReview(env: TenantEnv, task: CadenceTaskRow, o: Extract<Outcome, { kind: 'review' }>): Promise<string> {
  await backToDraft(env, task, o.message);
  env.deps.log('cadence_review', taskLog(env, task));
  return 'review';
}

async function countError(env: TenantEnv, message: string, extra: Partial<FollowUpRuntimeState> = {}): Promise<void> {
  const s = nextErrorState(env.state.consecutive_errors, 'error', env.config.max_consecutive_errors);
  const pause: Partial<FollowUpRuntimeState> = s.pause ? { paused_at: env.deps.now().toISOString(), paused_reason: 'error_streak' } : {};
  await env.deps.repo.updateState(env.userId, { ...extra, consecutive_errors: s.consecutive, last_error: message, ...pause });
}

async function onAmbiguous(env: TenantEnv, task: CadenceTaskRow, o: Extract<Outcome, { kind: 'ambiguous' }>): Promise<string> {
  await finishLogged(env, task, { status: 'blocked', release_claim: true, last_error: MESSAGES.ambiguous });
  await countError(env, MESSAGES.ambiguous);
  env.deps.log('cadence_ambiguous', taskLog(env, task, { detail: o.detail }));
  return 'ambiguous';
}

async function onBlocked(env: TenantEnv, task: CadenceTaskRow, o: Extract<Outcome, { kind: 'blocked' }>): Promise<string> {
  if (o.scope === 'task') {
    await finishLogged(env, task, { status: 'blocked', last_error: o.message, release_claim: true, generation_meta_merge: { block_code: o.code } });
    await quickNext(env);
    return 'blocked_task';
  }
  await finishLogged(env, task, { status: 'approved', release_claim: true });
  await env.deps.repo.updateState(env.userId, {
    last_block_code: o.code, last_block_message: o.message, last_block_at: env.deps.now().toISOString(),
  });
  return 'blocked_tenant';
}

// Erro com resposta da Graph ou do QR: o que acontece com a tarefa e com a conta.

interface ErrorPolicy { status: 'approved' | 'failed'; counts: boolean; message: string; block?: BlockCode; cooldownMs?: number; retryInMs?: number }

const ERROR_POLICIES: Record<Exclude<ErrorClass, 'transient' | 'ambiguous' | 'window_closed'>, ErrorPolicy> = {
  channel_auth: { status: 'approved', counts: true, block: 'meta_token_expired',
    message: 'A Meta recusou o token da API oficial. Reconecte em Configurações > Integrações > WhatsApp.' },
  channel_config: { status: 'approved', counts: true, block: 'meta_not_operational',
    message: 'A Meta recusou o envio pela configuração do número. Confira em Configurações > Integrações > WhatsApp.' },
  template_invalid: { status: 'approved', counts: true, block: 'template_invalid',
    message: 'A Meta recusou o template escolhido. Confira o template de retomada na configuração da cadência.' },
  undeliverable: { status: 'failed', counts: false, message: 'A Meta não conseguiu entregar para este número.' },
  marketing_capped: { status: 'failed', counts: false, message: 'A Meta limitou marketing para este contato.' },
  rate_limited: { status: 'approved', counts: true, cooldownMs: RATE_LIMIT_COOLDOWN_MS,
    message: 'A Meta pediu para diminuir o ritmo. Os envios voltam em 15 minutos.' },
  baileys_offline: { status: 'approved', counts: true, message: 'QR desconectado. Reconecte pela engrenagem do chat.' },
};

function transientPolicy(task: CadenceTaskRow): ErrorPolicy {
  const attempts = Math.max(0, Number(task.attempts) || 0);
  if (attempts >= MAX_TRANSIENT_ATTEMPTS) {
    return { status: 'failed', counts: true, message: `O envio falhou ${attempts} vezes. Gere de novo ou envie pelo chat.` };
  }
  const minutes = TRANSIENT_BACKOFF_MINUTES[Math.max(0, attempts - 1)] ?? TRANSIENT_BACKOFF_MINUTES[0];
  return { status: 'approved', counts: true, retryInMs: minutes * 60_000, message: `Falha temporária no envio. Nova tentativa em ${minutes} min.` };
}

function policyPatch(env: TenantEnv, policy: ErrorPolicy, o: Extract<Outcome, { kind: 'error' }>): CadenceTaskPatch {
  const patch: CadenceTaskPatch = { status: policy.status, release_claim: true, last_error: policy.message };
  if (policy.retryInMs) patch.scheduled_at = later(env.deps, policy.retryInMs);
  if (policy.status === 'failed') patch.generation_meta_merge = { failure: { code: o.code, title: o.cls, at: env.deps.now().toISOString() } };
  return patch;
}

function policyState(env: TenantEnv, policy: ErrorPolicy): Partial<FollowUpRuntimeState> {
  const state: Partial<FollowUpRuntimeState> = {};
  if (policy.block) Object.assign(state, { last_block_code: policy.block, last_block_message: policy.message, last_block_at: env.deps.now().toISOString() });
  if (policy.cooldownMs) state.next_send_after = later(env.deps, policy.cooldownMs);
  return state;
}

async function onError(env: TenantEnv, task: CadenceTaskRow, o: Extract<Outcome, { kind: 'error' }>): Promise<string> {
  if (o.cls === 'ambiguous') return onAmbiguous(env, task, { kind: 'ambiguous', detail: o.detail });
  if (o.cls === 'window_closed') return onReview(env, task, { kind: 'review', message: MESSAGES.windowClosed });
  const policy = o.cls === 'transient' ? transientPolicy(task) : ERROR_POLICIES[o.cls];
  await finishLogged(env, task, policyPatch(env, policy, o));
  const state = policyState(env, policy);
  if (policy.counts) await countError(env, policy.message, state);
  else if (Object.keys(state).length) await env.deps.repo.updateState(env.userId, state);
  env.deps.log('cadence_send_error', taskLog(env, task, { cls: o.cls, code: o.code, detail: o.detail }));
  return `error_${o.cls}`;
}

const OUTCOME_HANDLERS: { [K in Outcome['kind']]: (env: TenantEnv, task: CadenceTaskRow, o: Extract<Outcome, { kind: K }>) => Promise<string> } = {
  sent: onSent,
  cancel: onCancel,
  hold: onHold,
  stale: (env, task) => onStale(env, task),
  review: onReview,
  ambiguous: onAmbiguous,
  blocked: onBlocked,
  error: onError,
};

function applyOutcome(env: TenantEnv, task: CadenceTaskRow, o: Outcome): Promise<string> {
  return OUTCOME_HANDLERS[o.kind](env, task, o as never);
}

// Uma conta, uma mensagem

async function runEntry(deps: SenderDeps, entry: TenantEntry): Promise<string> {
  await advancePending(deps, entry);
  const now = deps.now();
  const gate = gateReason(entry, now);
  if (gate) return gate;
  const { userId, config } = entry;
  const health = await deps.repo.loadHealth(userId, config);
  const template = config.template_id ? await deps.repo.loadTemplate(userId, config.template_id) : null;
  const env: TenantEnv = { ...entry, deps, health, template };
  const block = tenantBlock(health, config, template, now);
  if (block) {
    await rememberTenantBlock(env, block);
    return 'blocked_tenant';
  }
  const gap = pickGapSeconds(config.min_gap_seconds, config.max_gap_seconds, deps.random);
  const task = await deps.repo.claim(userId, deps.workerId, LEASE_SECONDS, gap, localDayStartUtc(now, config.business_hours.tz).toISOString());
  if (!task) return 'idle';
  return applyOutcome(env, task, await processTask(env, task));
}

export function createCadenceSender(deps: SenderDeps): { tick(): Promise<void>; runTenant(userId: string): Promise<string>; kick(userId: string): void } {
  const running = new Set<string>();

  async function guarded(entry: TenantEntry): Promise<string> {
    if (running.has(entry.userId)) return 'busy';
    running.add(entry.userId);
    try {
      return await runEntry(deps, entry);
    } finally {
      running.delete(entry.userId);
    }
  }

  async function tick(): Promise<void> {
    let entries: TenantEntry[];
    try {
      entries = await deps.repo.listActiveConfigs();
    } catch (error) {
      deps.log('cadence_sender_list_failed', { error: errorText(error) });
      return;
    }
    for (const entry of entries) {
      try {
        await guarded(entry);
      } catch (error) {
        deps.log('cadence_sender_tenant_failed', { userId: entry.userId, error: errorText(error) });
      }
    }
  }

  async function runTenant(userId: string): Promise<string> {
    const entry = (await deps.repo.listActiveConfigs()).find((e) => e.userId === userId);
    return entry ? guarded(entry) : 'inactive';
  }

  function kick(userId: string): void {
    if (running.has(userId)) return;
    setTimeout(() => {
      runTenant(userId).catch((error) => deps.log('cadence_sender_kick_failed', { userId, error: errorText(error) }));
    }, 0);
  }

  return { tick, runTenant, kick };
}

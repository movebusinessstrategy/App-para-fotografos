// Painel dos follow-ups (GET /api/followups/dashboard): o quadro do fluxo (Follow 01,
// Follow 02, Follow 03, Respondeu, Encerrado), os números da semana e quem espera
// resposta do estúdio. As regras são puras (buildDashboard e auxiliares, testadas em
// followup-dashboard.test.ts); as consultas ficam no fim do arquivo e sempre levam
// user_id explícito, porque o client é service_role e scheduled_followups tem RLS sem
// policy. Nada aqui mostra valor em R$.
import type {
  BusinessHours, CadenceStatus, DashboardDelivery, FollowUpConfig, FollowUpDashboard, FollowUpDashboardKpis,
  FollowUpDashboardWaiting, FollowUpRuntimeState, FollowUpStep, FollowUpTrack, KanbanCard, KanbanChip,
  KanbanClosedReason, KanbanColumn, KanbanColumnKey,
} from './src/features/followups/types.js';
import { CUSTOMER_NON_TURN_TYPES, LIVE_CADENCE_STATUSES, STUDIO_NON_TURN_TYPES } from './src/features/followups/types.js';
import { MESSAGE_TYPE_LABELS } from './src/features/followups/labels.js';
import { CLOCK_TOLERANCE_MS, customerSpokeAfter, effectiveDailyCap, parseCadenceConfig } from './followup-cadence.js';
import type { StageRow } from './lib/stage-rules.js';
import { isClosedStage, isSalesStage } from './lib/stage-rules.js';
import { brazilianPhoneVariants, canonicalPhoneKey, digitsOnly } from './lib/br-phone.js';
import { isWithinBusinessHours, localDateKey, localDayStartUtc, nextWindowOpening } from './lib/business-hours.js';

export const DASHBOARD_TTL_MS = 30_000;
export const WINDOW_DAYS = 30;          // quadro e "precisam de você" olham no máximo 30 dias
export const REPLY_WINDOW_DAYS = 14;    // Respondeu: resposta ao último envio dos últimos 14 dias
export const NO_REPLY_CLOSE_DAYS = 7;   // passo 3 ou mais sem resposta por mais de 7 dias: Encerrado
export const WAITING_MIN_HOURS = 2;
export const COLUMN_LIMIT = 60;
export const NEEDS_YOU_LIMIT = 15;
export const REPLY_PREVIEW_CHARS = 80;
export const WAITING_PREVIEW_CHARS = 100;

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
// O sender roda a cada 20s: entre um envio e outro sai em média meio tick além do intervalo.
const TICK_SLACK_SECONDS = 10;
const MAX_DAY_HOPS = 30;
// A janela curta começa um minuto antes da última mensagem registrada na conversa.
const LAST_TURN_SLACK_MS = 60_000;

const LIVE = new Set<string>(LIVE_CADENCE_STATUSES);
const QUEUED = new Set(['approved', 'sending']);
const CLOSED_STATUSES = new Set(['skipped', 'cancelled']);
const CUSTOMER_SKIP = new Set(CUSTOMER_NON_TURN_TYPES);
const STUDIO_SKIP = new Set(STUDIO_NON_TURN_TYPES);
const DELIVERY = new Set<string>(['sent', 'delivered', 'read', 'failed']);

export const KANBAN_COLUMN_KEYS: readonly KanbanColumnKey[] = ['follow_1', 'follow_2', 'follow_3', 'replied', 'closed'];

const COLUMN_LABELS: Record<KanbanColumnKey, string> = {
  follow_1: 'Follow 01', follow_2: 'Follow 02', follow_3: 'Follow 03', replied: 'Respondeu', closed: 'Encerrado',
};

// Passo 4 (despedida) fica na coluna Follow 03.
const FOLLOW_BY_STEP: Record<number, KanbanColumnKey> = { 1: 'follow_1', 2: 'follow_2', 3: 'follow_3' };

// Linhas lidas do banco (só as colunas usadas pelo painel)

export interface BoardTask {
  id: number; deal_id: number; phone: string | null; status: string; step: number | null; track: string | null;
  created_at: string | null; scheduled_at: string | null; sent_at: string | null;
  sent_message_id?: string | null; last_error?: string | null; contact_name?: string | null;
}

export interface DashDeal {
  id: number; stage: string | null; title?: string | null; contact_name?: string | null; contact_phone?: string | null;
  converted?: boolean | null; converted_job_id?: number | null;
}

export interface DashMessage {
  phone: string | null; from_me: boolean | null; timestamp: string; type?: string | null; status?: string | null;
  body?: string | null; transcription?: string | null;
}

// Um negócio no quadro: todas as tarefas dele na janela, a mais nova (created_at) e o último envio.
export interface DealFlow { dealId: number; latest: BoardTask; lastSent: BoardTask | null; tasks: BoardTask[] }
export interface Placement { column: KanbanColumnKey; reply: DashMessage | null; closed: KanbanClosedReason | null }
// Busca de mensagens de um telefone a partir de `since` (a chave é o canonicalPhoneKey).
export interface PhoneWindow { key: string; phone: string; since: string }

// Utilitários de valor

function toMs(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const ms = Date.parse(String(value));
  return Number.isFinite(ms) ? ms : null;
}

function firstText(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function oneLine(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function daysAgoMs(now: Date, days: number): number {
  return now.getTime() - days * DAY_MS;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

// Começo do texto, com reticências quando corta.
export function clipText(value: unknown, max: number): string {
  const text = oneLine(value);
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

// Fim do texto (o que o cliente disse por último), com reticências no começo quando corta.
export function tailText(value: unknown, max: number): string {
  const text = oneLine(value);
  return text.length <= max ? text : `…${text.slice(text.length - (max - 1)).trimStart()}`;
}

// Falas: as mesmas regras de turno da cadência (reação, edição e apagada não contam;
// do lado do estúdio também não contam as mensagens que o WhatsApp não mostra nem as que falharam).

export function isCustomerTurn(m: DashMessage): boolean {
  return m.from_me !== true && !CUSTOMER_SKIP.has(String(m.type ?? ''));
}

export function isStudioTurn(m: DashMessage): boolean {
  return m.from_me === true && !STUDIO_SKIP.has(String(m.type ?? '')) && m.status !== 'failed';
}

function byTimeDesc(a: DashMessage, b: DashMessage): number {
  return (toMs(b.timestamp) ?? 0) - (toMs(a.timestamp) ?? 0);
}

// Última fala de cada telefone (qualquer variante de 12 ou 13 dígitos cai na mesma chave).
export function latestTurnByKey(rows: DashMessage[]): Map<string, DashMessage> {
  const out = new Map<string, DashMessage>();
  for (const m of [...rows].sort(byTimeDesc)) {
    const key = canonicalPhoneKey(m.phone);
    if (!key || out.has(key)) continue;
    if (isCustomerTurn(m) || isStudioTurn(m)) out.set(key, m);
  }
  return out;
}

// Falas do cliente por telefone, da mais antiga para a mais nova.
export function customerTurnsByKey(rows: DashMessage[]): Map<string, DashMessage[]> {
  const out = new Map<string, DashMessage[]>();
  for (const m of [...rows].sort((a, b) => byTimeDesc(b, a))) {
    const key = canonicalPhoneKey(m.phone);
    if (!key || !isCustomerTurn(m)) continue;
    const list = out.get(key);
    if (list) list.push(m);
    else out.set(key, [m]);
  }
  return out;
}

// Primeira fala do cliente depois do envio, com a mesma tolerância de relógio da cadência.
export function firstReplyAfter(turns: DashMessage[] | undefined, sentAt: string | null | undefined): DashMessage | null {
  if (!turns || !sentAt) return null;
  return turns.find((m) => customerSpokeAfter(sentAt, m.timestamp)) ?? null;
}

function messageText(m: DashMessage): string {
  return firstText(m.body, m.transcription) ?? MESSAGE_TYPE_LABELS[String(m.type ?? '')] ?? 'Mensagem sem texto';
}

// Negócios no fluxo

function laterTask(a: BoardTask, b: BoardTask, field: 'created_at' | 'sent_at'): BoardTask {
  const diff = (toMs(a[field]) ?? 0) - (toMs(b[field]) ?? 0);
  if (diff !== 0) return diff > 0 ? a : b;
  return Number(a.id) >= Number(b.id) ? a : b;
}

function newestSent(tasks: BoardTask[]): BoardTask | null {
  const sent = tasks.filter((t) => t.status === 'sent' && toMs(t.sent_at) !== null);
  return sent.length ? sent.reduce((a, b) => laterTask(a, b, 'sent_at')) : null;
}

// Uma entrada por negócio, pela tarefa mais nova (created_at; empate pelo id).
export function groupFlows(tasks: BoardTask[]): DealFlow[] {
  const byDeal = new Map<number, BoardTask[]>();
  for (const task of tasks) {
    const dealId = Number(task.deal_id);
    if (!(dealId > 0)) continue;
    const list = byDeal.get(dealId);
    if (list) list.push(task);
    else byDeal.set(dealId, [task]);
  }
  return [...byDeal].map(([dealId, list]) => ({
    dealId, latest: list.reduce((a, b) => laterTask(a, b, 'created_at')), lastSent: newestSent(list), tasks: list,
  }));
}

function flowKey(f: DealFlow): string {
  return canonicalPhoneKey(firstText(f.latest.phone, f.lastSent?.phone));
}

// Resposta é procurada no telefone para onde o último follow-up saiu.
function sentKey(f: DealFlow): string {
  return canonicalPhoneKey(f.lastSent?.phone);
}

export interface PlaceContext { now: Date; optOutKeys: Set<string>; replies: Map<string, DashMessage[]> }

function closedAt(reason: KanbanClosedReason): Placement {
  return { column: 'closed', reply: null, closed: reason };
}

function followColumn(step: unknown): KanbanColumnKey {
  const n = Math.max(1, Math.min(3, Math.trunc(Number(step)) || 1));
  return FOLLOW_BY_STEP[n];
}

function sentWithinDays(task: BoardTask | null, now: Date, days: number): boolean {
  const ms = toMs(task?.sent_at);
  return ms !== null && ms >= daysAgoMs(now, days);
}

// Respondeu: fala do cliente depois do último envio, se ele saiu nos últimos 14 dias.
function replyToLastSend(f: DealFlow, ctx: PlaceContext): DashMessage | null {
  if (!sentWithinDays(f.lastSent, ctx.now, REPLY_WINDOW_DAYS)) return null;
  return firstReplyAfter(ctx.replies.get(sentKey(f)), f.lastSent?.sent_at);
}

// Tarefa viva criada depois da resposta: o negócio voltou para a cadência (novo episódio).
function reenteredAfter(latest: BoardTask, reply: DashMessage): boolean {
  return LIVE.has(latest.status) && (toMs(latest.created_at) ?? 0) > (toMs(reply.timestamp) ?? 0);
}

// Passo 3 ou mais enviado há mais de 7 dias, sem resposta e sem tarefa viva depois dele.
function finishedWithoutReply(f: DealFlow, ctx: PlaceContext): boolean {
  const sent = f.lastSent;
  if (!sent || LIVE.has(f.latest.status) || Number(sent.step) < 3) return false;
  if (sentWithinDays(sent, ctx.now, NO_REPLY_CLOSE_DAYS)) return false;
  return !firstReplyAfter(ctx.replies.get(sentKey(f)), sent.sent_at);
}

// Ordem das regras: não contatar, respondeu, pulado ou cancelado, acabou sem resposta, passo.
export function placeFlow(f: DealFlow, ctx: PlaceContext): Placement {
  if (ctx.optOutKeys.has(flowKey(f))) return closedAt('optout');
  const reply = replyToLastSend(f, ctx);
  if (reply && !reenteredAfter(f.latest, reply)) return { column: 'replied', reply, closed: null };
  if (CLOSED_STATUSES.has(f.latest.status)) return closedAt(f.latest.status === 'skipped' ? 'skipped' : 'cancelled');
  if (finishedWithoutReply(f, ctx)) return closedAt('no_reply');
  return { column: followColumn(f.latest.step), reply: null, closed: null };
}

// Previsão de envio da fila

export interface EtaItem { id: number; status: string; scheduled_at: string | null }
export interface EtaInput {
  items: EtaItem[];                     // na ordem do claim: scheduled_at, depois id
  now: Date; hours: BusinessHours;
  capAt: (at: Date) => number;          // teto efetivo naquele instante (rampa incluída)
  sentToday: number; nextSendAfter: string | null; gapSeconds: number;
  running: boolean;                     // false: desligado ou pausado, sem previsão
}

interface EtaClock { t: number; dayKey: string; count: number; broken: boolean }

function openSlot(t: number, h: BusinessHours): number {
  const at = new Date(t);
  return isWithinBusinessHours(at, h) ? t : nextWindowOpening(at, h).getTime();
}

// Abertura do próximo dia útil depois do dia de t (36h depois do início do dia cai no dia seguinte).
function nextDayOpening(t: number, h: BusinessHours): number {
  const dayStart = localDayStartUtc(new Date(t), h.tz).getTime();
  const nextDay = localDayStartUtc(new Date(dayStart + 36 * HOUR_MS), h.tz);
  return nextWindowOpening(nextDay, h).getTime();
}

// Primeiro instante a partir de earliest dentro do expediente e com vaga no teto daquele dia.
function placeSend(clock: EtaClock, earliest: number, i: EtaInput): number {
  let t = openSlot(Math.max(clock.t, earliest), i.hours);
  for (let hop = 0; hop < MAX_DAY_HOPS; hop++) {
    const key = localDateKey(new Date(t), i.hours.tz);
    if (key !== clock.dayKey) {
      clock.dayKey = key;
      clock.count = 0;
    }
    if (clock.count < Math.max(1, i.capAt(new Date(t)))) return t;
    t = nextDayOpening(t, i.hours);
  }
  throw new Error('sem vaga nos próximos dias');
}

function etaFor(clock: EtaClock, item: EtaItem, i: EtaInput): string | null {
  if (item.status === 'sending') return i.now.toISOString();
  if (clock.broken) return null;
  try {
    const at = placeSend(clock, toMs(item.scheduled_at) ?? i.now.getTime(), i);
    clock.count += 1;
    clock.t = at + Math.max(0, i.gapSeconds) * 1000;
    return new Date(at).toISOString();
  } catch {
    clock.broken = true;
    return null;
  }
}

// Distribui a fila na ordem do claim: horário comercial, teto por dia (contando o que já
// saiu hoje e o que está saindo), next_send_after e o intervalo médio entre envios.
export function estimateEtas(i: EtaInput): Map<number, string | null> {
  const out = new Map<number, string | null>();
  const sending = i.items.filter((item) => item.status === 'sending').length;
  const clock: EtaClock = {
    t: Math.max(i.now.getTime(), toMs(i.nextSendAfter) ?? 0), dayKey: localDateKey(i.now, i.hours.tz),
    count: Math.max(0, i.sentToday) + sending, broken: !i.running,
  };
  for (const item of i.items) out.set(item.id, etaFor(clock, item, i));
  return out;
}

export function averageGapSeconds(config: FollowUpConfig): number {
  return (Number(config.min_gap_seconds) + Number(config.max_gap_seconds)) / 2 + TICK_SLACK_SECONDS;
}

function byQueueOrder(a: BoardTask, b: BoardTask): number {
  const diff = (toMs(a.scheduled_at) ?? 0) - (toMs(b.scheduled_at) ?? 0);
  return diff !== 0 ? diff : Number(a.id) - Number(b.id);
}

// Precisam de você

export interface WaitingDeal { deal: DashDeal; message: DashMessage }

export function openSalesStages(stages: StageRow[]): StageRow[] {
  return stages.filter((s) => isSalesStage(s) && !isClosedStage(s));
}

export function isOpenDeal(deal: DashDeal, openStageIds: Set<string>): boolean {
  if (deal.converted === true || deal.converted_job_id != null) return false;
  return openStageIds.has(String(deal.stage ?? ''));
}

function isWaiting(m: DashMessage, now: Date): boolean {
  if (!isCustomerTurn(m)) return false;
  const age = now.getTime() - (toMs(m.timestamp) ?? 0);
  return age > WAITING_MIN_HOURS * HOUR_MS && age < WINDOW_DAYS * DAY_MS;
}

// Cliente esperando o estúdio: a última fala da conversa é dele, há mais de 2h e menos de 30 dias.
export function waitingDeals(openDeals: DashDeal[], latestTurns: Map<string, DashMessage>, now: Date): WaitingDeal[] {
  const out: WaitingDeal[] = [];
  for (const deal of openDeals) {
    const message = latestTurns.get(canonicalPhoneKey(deal.contact_phone));
    if (message && isWaiting(message, now)) out.push({ deal, message });
  }
  return out.sort((a, b) => byTimeDesc(a.message, b.message));
}

// Planejamento das buscas de mensagens (quais telefones, a partir de quando)

// Maior last_message_at de wa_conversations por telefone (as conversas dos dois números da conta).
export function lastAtByKey(rows: Array<{ phone?: unknown; last_message_at?: unknown }>): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of rows) {
    const key = canonicalPhoneKey(row.phone);
    const ms = toMs(row.last_message_at);
    if (!key || ms === null) continue;
    out.set(key, Math.max(ms, out.get(key) ?? ms));
  }
  return out;
}

// Telefones dos negócios abertos com conversa nos últimos 30 dias. A janela começa um minuto
// antes da última mensagem da conversa: quase sempre só a última fala vem do banco.
export function turnWindows(openDeals: DashDeal[], convLast: Map<string, number>, sinceMs: number): PhoneWindow[] {
  const out = new Map<string, PhoneWindow>();
  for (const deal of openDeals) {
    const key = canonicalPhoneKey(deal.contact_phone);
    const last = convLast.get(key);
    if (out.has(key) || last === undefined || last < sinceMs) continue;
    const since = new Date(Math.max(sinceMs, last - LAST_TURN_SLACK_MS)).toISOString();
    out.set(key, { key, phone: digitsOnly(deal.contact_phone), since });
  }
  return [...out.values()];
}

// Janelas sem nenhuma fala (só reação, por exemplo): vão para a busca dos 30 dias.
export function missingTurnWindows(windows: PhoneWindow[], rows: DashMessage[]): PhoneWindow[] {
  const found = latestTurnByKey(rows);
  return windows.filter((w) => !found.has(w.key));
}

// Envio mais antigo que importa para o negócio: o último envio e os da última semana.
function earliestRelevantSend(f: DealFlow, now: Date): number | null {
  const last = toMs(f.lastSent?.sent_at);
  if (last === null) return null;
  const weekAgo = daysAgoMs(now, 7);
  const week = f.tasks.filter((t) => t.status === 'sent').map((t) => toMs(t.sent_at) ?? last).filter((ms) => ms >= weekAgo);
  return Math.min(last, ...week);
}

function movedAfter(last: number | undefined, sentMs: number): boolean {
  return last === undefined || last > sentMs + CLOCK_TOLERANCE_MS;
}

// Telefones com follow-up enviado cuja conversa andou depois do envio mais antigo que importa:
// só esses precisam da busca de respostas.
export function replyWindows(flows: DealFlow[], convLast: Map<string, number>, now: Date): PhoneWindow[] {
  const earliest = new Map<string, { phone: string; ms: number }>();
  for (const f of flows) {
    const ms = earliestRelevantSend(f, now);
    const key = canonicalPhoneKey(f.lastSent?.phone);
    const prev = earliest.get(key);
    if (ms === null || !key || (prev && prev.ms <= ms)) continue;
    earliest.set(key, { phone: digitsOnly(f.lastSent?.phone), ms });
  }
  const out: PhoneWindow[] = [];
  for (const [key, e] of earliest) {
    if (movedAfter(convLast.get(key), e.ms)) out.push({ key, phone: e.phone, since: new Date(e.ms).toISOString() });
  }
  return out;
}

export function missingDealIds(flows: DealFlow[], known: DashDeal[]): number[] {
  const have = new Set(known.map((d) => Number(d.id)));
  return flows.map((f) => f.dealId).filter((id) => !have.has(id));
}

// Quadro

interface BoardContext {
  now: Date; config: FollowUpConfig; state: FollowUpRuntimeState;
  deals: Map<number, DashDeal>; stageNames: Map<string, string>;
  optOutKeys: Set<string>; replies: Map<string, DashMessage[]>; sentToday: number;
}
interface PlacedFlow { flow: DealFlow; deal: DashDeal; placement: Placement }
interface BoardEntry { card: KanbanCard; flow: DealFlow; column: KanbanColumnKey }

// Negócio que não existe mais (excluído) não entra no quadro.
function placeAll(flows: DealFlow[], ctx: BoardContext): PlacedFlow[] {
  const place: PlaceContext = { now: ctx.now, optOutKeys: ctx.optOutKeys, replies: ctx.replies };
  const out: PlacedFlow[] = [];
  for (const flow of flows) {
    const deal = ctx.deals.get(flow.dealId);
    if (deal) out.push({ flow, deal, placement: placeFlow(flow, place) });
  }
  return out;
}

function isFollowColumn(key: KanbanColumnKey): boolean {
  return key === 'follow_1' || key === 'follow_2' || key === 'follow_3';
}

// Só entram na previsão os envios que vão sair mesmo: os de quem respondeu ou pediu para
// não receber são cancelados pelo sender sem gastar o teto.
function queueEtas(placed: PlacedFlow[], ctx: BoardContext): Map<number, string | null> {
  const items = placed
    .filter((p) => isFollowColumn(p.placement.column) && QUEUED.has(p.flow.latest.status))
    .map((p) => p.flow.latest)
    .sort(byQueueOrder)
    .map((t) => ({ id: Number(t.id), status: t.status, scheduled_at: t.scheduled_at }));
  return estimateEtas({
    items, now: ctx.now, hours: ctx.config.business_hours, sentToday: ctx.sentToday,
    nextSendAfter: ctx.state.next_send_after, capAt: (at) => effectiveDailyCap(ctx.config, ctx.state, at).cap,
    gapSeconds: averageGapSeconds(ctx.config), running: ctx.config.enabled && !ctx.state.paused_at,
  });
}

const CHIP_BY_STATUS: Record<string, KanbanChip> = {
  draft: 'draft', approved: 'queued', sending: 'sending', sent: 'sent', blocked: 'problem', failed: 'problem',
};
const CHIP_BY_COLUMN: Partial<Record<KanbanColumnKey, KanbanChip>> = { replied: 'replied', closed: 'closed' };
const ERROR_CHIPS = new Set<KanbanChip>(['problem', 'closed']);

function chipFor(p: Placement, latest: BoardTask): KanbanChip {
  return CHIP_BY_COLUMN[p.column] ?? CHIP_BY_STATUS[latest.status] ?? 'draft';
}

function trackOf(t: BoardTask): FollowUpTrack {
  return t.track === 'pre_quote' ? 'pre_quote' : 'ladder';
}

function stepOf(t: BoardTask): FollowUpStep {
  return Math.max(1, Math.min(4, Math.trunc(Number(t.step)) || 1)) as FollowUpStep;
}

function stageNameOf(deal: DashDeal, stageNames: Map<string, string>): string {
  const id = String(deal.stage ?? '');
  return stageNames.get(id) ?? id;
}

function replyFields(reply: DashMessage | null): Pick<KanbanCard, 'replied_at' | 'reply_preview'> {
  if (!reply) return { replied_at: null, reply_preview: null };
  return { replied_at: reply.timestamp, reply_preview: clipText(messageText(reply), REPLY_PREVIEW_CHARS) };
}

function cardFor(p: PlacedFlow, etas: Map<number, string | null>, stageNames: Map<string, string>): KanbanCard {
  const t = p.flow.latest;
  const chip = chipFor(p.placement, t);
  return {
    deal_id: p.flow.dealId, task_id: Number(t.id),
    contact_name: firstText(p.deal.contact_name, t.contact_name, p.deal.title),
    stage_name: stageNameOf(p.deal, stageNames),
    track: trackOf(t), step: stepOf(t), status: t.status as CadenceStatus, chip,
    eta: etas.get(Number(t.id)) ?? null,
    sent_at: p.flow.lastSent?.sent_at ?? null,
    delivery: null,
    error: ERROR_CHIPS.has(chip) ? firstText(t.last_error) : null,
    ...replyFields(p.placement.reply),
    closed_reason: p.placement.closed,
  };
}

// Com problema no topo; na fila, quem sai primeiro; no resto, o mais recente primeiro.
const CHIP_RANK: Record<KanbanChip, number> = { problem: 0, sending: 1, queued: 2, draft: 3, sent: 4, replied: 5, closed: 6 };

function createdDesc(e: BoardEntry): number {
  return -(toMs(e.flow.latest.created_at) ?? 0);
}

const ENTRY_TIME: Record<KanbanChip, (e: BoardEntry) => number> = {
  problem: createdDesc,
  sending: () => 0,
  queued: (e) => toMs(e.card.eta) ?? toMs(e.flow.latest.scheduled_at) ?? Number.MAX_SAFE_INTEGER,
  draft: createdDesc,
  sent: (e) => -(toMs(e.card.sent_at) ?? 0),
  replied: (e) => -(toMs(e.card.replied_at) ?? 0),
  closed: createdDesc,
};

function compareEntries(a: BoardEntry, b: BoardEntry): number {
  const rank = CHIP_RANK[a.card.chip] - CHIP_RANK[b.card.chip];
  if (rank !== 0) return rank;
  const time = ENTRY_TIME[a.card.chip](a) - ENTRY_TIME[b.card.chip](b);
  return time !== 0 ? time : a.card.deal_id - b.card.deal_id;
}

export function buildColumns(entries: BoardEntry[]): KanbanColumn[] {
  return KANBAN_COLUMN_KEYS.map((key) => {
    const list = entries.filter((e) => e.column === key).sort(compareEntries);
    return { key, label: COLUMN_LABELS[key], count: list.length, cards: list.slice(0, COLUMN_LIMIT).map((e) => e.card) };
  });
}

// Números

function statusCount(tasks: BoardTask[], statuses: string[]): number {
  return tasks.filter((t) => statuses.includes(t.status)).length;
}

function sentSince(tasks: BoardTask[], sinceMs: number): BoardTask[] {
  return tasks.filter((t) => t.status === 'sent' && (toMs(t.sent_at) ?? -Infinity) >= sinceMs);
}

function percent(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

function earliestEta(etas: Map<number, string | null>): string | null {
  const times = [...etas.values()].map(toMs).filter((ms): ms is number => ms !== null);
  return times.length ? new Date(Math.min(...times)).toISOString() : null;
}

function wonStageIds(stages: StageRow[]): Set<string> {
  return new Set(stages.filter((s) => s.is_won === true || s.id === 'won').map((s) => s.id));
}

function advanced(deal: DashDeal | undefined, won: Set<string>): boolean {
  if (!deal) return false;
  return deal.converted === true || deal.converted_job_id != null || won.has(String(deal.stage ?? ''));
}

function repliedTo(task: BoardTask, replies: Map<string, DashMessage[]>): boolean {
  return firstReplyAfter(replies.get(canonicalPhoneKey(task.phone)), task.sent_at) !== null;
}

function advancedCount(src: DashboardSources, deals: Map<number, DashDeal>): number {
  const won = wonStageIds(src.stages);
  const ids = new Set(sentSince(src.tasks, daysAgoMs(src.now, REPLY_WINDOW_DAYS)).map((t) => Number(t.deal_id)));
  return [...ids].filter((id) => advanced(deals.get(id), won)).length;
}

function buildKpis(src: DashboardSources, ctx: BoardContext, etas: Map<number, string | null>, waiting: number): FollowUpDashboardKpis {
  const cap = effectiveDailyCap(src.config, src.state, src.now).cap;
  const scheduled = statusCount(src.tasks, ['approved', 'sending']);
  const blocked = statusCount(src.tasks, ['blocked']);
  const week = sentSince(src.tasks, daysAgoMs(src.now, 7));
  const replied = week.filter((t) => repliedTo(t, ctx.replies)).length;
  return {
    sent_today: ctx.sentToday, effective_cap: cap, next_send_at: earliestEta(etas),
    scheduled, drafts: statusCount(src.tasks, ['draft']),
    days_to_drain: scheduled > 0 ? Math.ceil(scheduled / Math.max(1, cap)) : 0,
    sent_7d: week.length, replied_7d: replied, reply_rate_7d: percent(replied, week.length),
    advanced_14d: advancedCount(src, ctx.deals),
    needs_you: waiting + blocked, waiting_studio: waiting, blocked,
  };
}

// Montagem

export interface DashboardSources {
  now: Date; config: FollowUpConfig; state: FollowUpRuntimeState; stages: StageRow[];
  tasks: BoardTask[];       // cadência: criadas em 30 dias e todas as vivas
  deals: DashDeal[];        // negócios abertos e os citados nas tarefas
  optOutKeys: Set<string>;  // phone_key com não contatar ativo
  turns: DashMessage[];     // últimas falas dos telefones dos negócios abertos (as duas direções)
  replies: DashMessage[];   // falas do cliente depois dos envios
}

function boardContext(src: DashboardSources): BoardContext {
  const dayStart = localDayStartUtc(src.now, src.config.business_hours.tz).getTime();
  return {
    now: src.now, config: src.config, state: src.state,
    deals: new Map(src.deals.map((d) => [Number(d.id), d])),
    stageNames: new Map(src.stages.map((s) => [s.id, s.name])),
    optOutKeys: src.optOutKeys, replies: customerTurnsByKey(src.replies), sentToday: sentSince(src.tasks, dayStart).length,
  };
}

function waitingItem(w: WaitingDeal, stageNames: Map<string, string>): FollowUpDashboardWaiting {
  return {
    deal_id: Number(w.deal.id), contact_name: firstText(w.deal.contact_name, w.deal.title), stage_name: stageNameOf(w.deal, stageNames),
    last_customer_at: w.message.timestamp, preview: tailText(messageText(w.message), WAITING_PREVIEW_CHARS),
  };
}

export function buildDashboard(src: DashboardSources): FollowUpDashboard {
  const ctx = boardContext(src);
  const placed = placeAll(groupFlows(src.tasks), ctx);
  const etas = queueEtas(placed, ctx);
  const entries = placed.map((p) => ({ card: cardFor(p, etas, ctx.stageNames), flow: p.flow, column: p.placement.column }));
  const openIds = new Set(openSalesStages(src.stages).map((s) => s.id));
  const open = [...ctx.deals.values()].filter((d) => isOpenDeal(d, openIds));
  const waiting = waitingDeals(open, latestTurnByKey(src.turns), src.now);
  return {
    kpis: buildKpis(src, ctx, etas, waiting.length),
    board: { columns: buildColumns(entries) },
    needs_you_list: waiting.slice(0, NEEDS_YOU_LIMIT).map((w) => waitingItem(w, ctx.stageNames)),
    tz: src.config.business_hours.tz,
    server_time: src.now.toISOString(),
  };
}

// Entrega (sent, delivered, read, failed) dos cards com chip sent que aparecem no quadro.
export function sentCardMessageIds(columns: KanbanColumn[], tasks: BoardTask[]): Map<number, string> {
  const byId = new Map(tasks.map((t) => [Number(t.id), t]));
  const out = new Map<number, string>();
  for (const card of columns.flatMap((c) => c.cards)) {
    const id = card.chip === 'sent' ? firstText(byId.get(card.task_id)?.sent_message_id) : null;
    if (id) out.set(card.task_id, id);
  }
  return out;
}

export function applyDelivery(columns: KanbanColumn[], messageIds: Map<number, string>, statuses: Map<string, string>): void {
  for (const card of columns.flatMap((c) => c.cards)) {
    const status = statuses.get(messageIds.get(card.task_id) ?? '');
    if (status && DELIVERY.has(status)) card.delivery = status as DashboardDelivery;
  }
}

// Consultas (client service_role, sempre com user_id explícito)

type Db = any; // SupabaseClient sem o esquema tipado
type Query = PromiseLike<{ data: unknown; error: unknown }>;

const TASK_PAGE = 1000;
const TASK_PAGES = 3;
const LIST_LIMIT = 5000;
const ID_BLOCK = 300;
const MESSAGE_LIMIT = 1000;
const WINDOW_BLOCK = 40;       // telefones por consulta com janela própria (URL curta)
const PHONE_BLOCK = 200;       // telefones por consulta com .in('phone', variantes)
const MESSAGE_ID_BLOCK = 50;
const CONVERSATION_LIMIT = 2000;
const TASK_COLUMNS = 'id, deal_id, phone, status, step, track, created_at, scheduled_at, sent_at, sent_message_id, last_error, contact_name';
const DEAL_COLUMNS = 'id, stage, title, contact_name, contact_phone, converted, converted_job_id';
const STAGE_COLUMNS = 'id, name, position, is_final, is_won, process_id';
const TURN_COLUMNS = 'phone, from_me, timestamp, type, status, body, transcription';
const REPLY_COLUMNS = 'phone, from_me, timestamp, type, body, transcription';
const CUSTOMER_TURN_FILTER = `type.is.null,type.not.in.(${CUSTOMER_NON_TURN_TYPES.join(',')})`;

async function run(query: Query): Promise<unknown> {
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

function rowsOf<T>(data: unknown): T[] {
  return Array.isArray(data) ? (data as T[]) : [];
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function loadConfig(db: Db, userId: string) {
  const data = await run(db.from('followup_cadence_config').select('*').eq('user_id', userId).maybeSingle());
  return parseCadenceConfig(data && typeof data === 'object' ? (data as Record<string, unknown>) : null);
}

async function loadStages(db: Db, userId: string): Promise<StageRow[]> {
  return rowsOf<StageRow>(await run(db.from('deal_stages').select(STAGE_COLUMNS).eq('user_id', userId)
    .order('position', { ascending: true }).limit(LIST_LIMIT)));
}

// Tarefas da cadência criadas nos últimos 30 dias e toda tarefa viva, da mais nova para a mais velha.
async function loadBoardTasks(db: Db, userId: string, sinceIso: string): Promise<BoardTask[]> {
  const filter = `created_at.gte.${sinceIso},status.in.(${LIVE_CADENCE_STATUSES.join(',')})`;
  const out: BoardTask[] = [];
  for (let page = 0; page < TASK_PAGES; page++) {
    const from = page * TASK_PAGE;
    const rows = rowsOf<BoardTask>(await run(db.from('scheduled_followups').select(TASK_COLUMNS)
      .eq('user_id', userId).eq('kind', 'cadence').or(filter)
      .order('created_at', { ascending: false }).order('id', { ascending: false }).range(from, from + TASK_PAGE - 1)));
    out.push(...rows);
    if (rows.length < TASK_PAGE) break;
  }
  return out;
}

async function loadOpenDeals(db: Db, userId: string, stageIds: string[]): Promise<DashDeal[]> {
  if (!stageIds.length) return [];
  return rowsOf<DashDeal>(await run(db.from('deals').select(DEAL_COLUMNS).eq('user_id', userId)
    .in('stage', stageIds).limit(LIST_LIMIT)));
}

async function loadDealsByIds(db: Db, userId: string, ids: number[]): Promise<DashDeal[]> {
  const pages = await Promise.all(chunk(ids, ID_BLOCK).map((part) =>
    run(db.from('deals').select(DEAL_COLUMNS).eq('user_id', userId).in('id', part).limit(part.length))));
  return pages.flatMap((data) => rowsOf<DashDeal>(data));
}

async function loadOptOutKeys(db: Db, userId: string): Promise<Set<string>> {
  const rows = rowsOf<{ phone_key?: unknown }>(await run(db.from('followup_optouts').select('phone_key')
    .eq('user_id', userId).is('revoked_at', null).limit(LIST_LIMIT)));
  return new Set(rows.map((r) => String(r.phone_key ?? '')).filter(Boolean));
}

async function loadConversationLastAt(db: Db, userId: string, sinceIso: string): Promise<Map<string, number>> {
  const rows = rowsOf<{ phone?: unknown; last_message_at?: unknown }>(await run(db.from('wa_conversations')
    .select('phone, last_message_at').eq('user_id', userId).gte('last_message_at', sinceIso)
    .order('last_message_at', { ascending: false }).limit(CONVERSATION_LIMIT)));
  return lastAtByKey(rows);
}

interface WindowScan { op: 'gt' | 'gte'; ascending: boolean; customerOnly: boolean; columns: string }

function windowTerm(w: PhoneWindow, op: WindowScan['op']): string {
  return `and(phone.in.(${brazilianPhoneVariants(w.phone).join(',')}),timestamp.${op}.${w.since})`;
}

// Devolve o builder (thenable) para quem chama executar com run().
function windowQuery(db: Db, userId: string, part: PhoneWindow[], scan: WindowScan): Query {
  const base = db.from('wa_messages').select(scan.columns).eq('user_id', userId);
  const scoped = scan.customerOnly ? base.eq('from_me', false) : base;
  return scoped.or(part.map((w) => windowTerm(w, scan.op)).join(','))
    .order('timestamp', { ascending: scan.ascending }).limit(MESSAGE_LIMIT);
}

async function scanWindows(db: Db, userId: string, windows: PhoneWindow[], scan: WindowScan): Promise<DashMessage[]> {
  const usable = windows.filter((w) => brazilianPhoneVariants(w.phone).length > 0);
  const pages = await Promise.all(chunk(usable, WINDOW_BLOCK).map((part) => run(windowQuery(db, userId, part, scan))));
  return pages.flatMap((data) => rowsOf<DashMessage>(data));
}

// Última fala: primeiro a janela curta perto da última mensagem da conversa; quem ficou
// sem nenhuma fala ali é buscado nos 30 dias inteiros, em blocos de até 200 telefones.
async function loadLatestTurns(db: Db, userId: string, windows: PhoneWindow[], sinceIso: string): Promise<DashMessage[]> {
  const near = await scanWindows(db, userId, windows, { op: 'gte', ascending: false, customerOnly: false, columns: TURN_COLUMNS });
  const missing = missingTurnWindows(windows, near).map((w) => w.phone);
  const pages = await Promise.all(chunk(missing, PHONE_BLOCK).map((part) => run(db.from('wa_messages').select(TURN_COLUMNS)
    .eq('user_id', userId).in('phone', uniqueStrings(part.flatMap(brazilianPhoneVariants))).gte('timestamp', sinceIso)
    .or(CUSTOMER_TURN_FILTER).order('timestamp', { ascending: false }).limit(MESSAGE_LIMIT))));
  return [...near, ...pages.flatMap((data) => rowsOf<DashMessage>(data))];
}

function loadReplies(db: Db, userId: string, windows: PhoneWindow[]): Promise<DashMessage[]> {
  return scanWindows(db, userId, windows, { op: 'gt', ascending: true, customerOnly: true, columns: REPLY_COLUMNS });
}

async function loadDeliveryStatuses(db: Db, userId: string, messageIds: string[]): Promise<Map<string, string>> {
  const pages = await Promise.all(chunk(uniqueStrings(messageIds), MESSAGE_ID_BLOCK).map((part) =>
    run(db.from('wa_messages').select('message_id, status').eq('user_id', userId).in('message_id', part).limit(part.length * 2))));
  const out = new Map<string, string>();
  for (const row of pages.flatMap((data) => rowsOf<{ message_id?: unknown; status?: unknown }>(data))) {
    if (row.message_id) out.set(String(row.message_id), String(row.status ?? ''));
  }
  return out;
}

export interface DashboardDeps { db: Db; now: () => Date; clock?: () => number; ttlMs?: number }

// Quatro rodadas em paralelo: config e etapas; tarefas, negócios, não contatar e conversas;
// negócios que faltam e as duas buscas de mensagens; entrega dos cards enviados.
async function computeDashboard(deps: DashboardDeps, userId: string): Promise<FollowUpDashboard> {
  const { db } = deps;
  const now = deps.now();
  const [{ config, state }, stages] = await Promise.all([loadConfig(db, userId), loadStages(db, userId)]);
  const sinceMs = daysAgoMs(now, WINDOW_DAYS);
  const sinceIso = new Date(sinceMs).toISOString();
  const openIds = openSalesStages(stages).map((s) => s.id);
  const [tasks, openDeals, optOutKeys, convLast] = await Promise.all([
    loadBoardTasks(db, userId, sinceIso), loadOpenDeals(db, userId, openIds), loadOptOutKeys(db, userId),
    loadConversationLastAt(db, userId, sinceIso),
  ]);
  const flows = groupFlows(tasks);
  const openIdSet = new Set(openIds);
  const open = openDeals.filter((d) => isOpenDeal(d, openIdSet));
  const [extra, turns, replies] = await Promise.all([
    loadDealsByIds(db, userId, missingDealIds(flows, openDeals)),
    loadLatestTurns(db, userId, turnWindows(open, convLast, sinceMs), sinceIso),
    loadReplies(db, userId, replyWindows(flows, convLast, now)),
  ]);
  const dashboard = buildDashboard({ now, config, state, stages, tasks, deals: [...openDeals, ...extra], optOutKeys, turns, replies });
  const messageIds = sentCardMessageIds(dashboard.board.columns, tasks);
  if (messageIds.size) applyDelivery(dashboard.board.columns, messageIds, await loadDeliveryStatuses(db, userId, [...messageIds.values()]));
  return dashboard;
}

// Cache curto por conta (a tela faz poll a cada 30s). Erro não fica guardado.
export function createDashboardLoader(deps: DashboardDeps): (userId: string) => Promise<FollowUpDashboard> {
  const ttl = deps.ttlMs ?? DASHBOARD_TTL_MS;
  const clock = deps.clock ?? Date.now;
  const entries = new Map<string, { at: number; value: Promise<FollowUpDashboard> }>();
  return (userId) => {
    const hit = entries.get(userId);
    if (hit && clock() - hit.at < ttl) return hit.value;
    const value = computeDashboard(deps, userId);
    entries.set(userId, { at: clock(), value });
    value.catch(() => {
      if (entries.get(userId)?.value === value) entries.delete(userId);
    });
    return value;
  };
}

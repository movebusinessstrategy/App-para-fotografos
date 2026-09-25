// Rastreador de funil: observa cada mensagem do número principal (entrada e
// saída) e decide criar o lead, andar a etapa para frente ou cancelar a
// cadência. É a ÚNICA porta de mudança automática de etapa (D8). O observe
// nunca lança: a mensagem já está salva quando ele roda.
import type { SupabaseClient } from '@supabase/supabase-js';
import { brazilianPhoneVariants, canonicalPhoneKey, digitsOnly, maskPhone, normalizeBrazilianPhone13, samePhone } from './lib/br-phone.js';
import { appendStageHistory, canMoveBack, canMoveForward, firstOpenSalesStage, isClosedStage, isLostStage, isSalesStage, type StageRow } from './lib/stage-rules.js';
import { detectOptOut } from './lib/optout-detect.js';
import { isQuoteDocument, materialKeysFrom, type QuoteCandidate, type QuoteRules } from './lib/quote-document.js';
import { CUSTOMER_NON_TURN_TYPES, DEFAULT_TRACKER_CONFIG } from './src/features/followups/types.js';
import type {
  MoveInput,
  MoveResult,
  ReconcileApplyRequest,
  ReconcileApplyResult,
  ReconcileCreateItem,
  ReconcileItem,
  ReconcilePreview,
} from './src/features/followups/types.js';

// ════════════════════════════════════════════════════════════════════
// Tipos públicos (seção D do contrato)
// ════════════════════════════════════════════════════════════════════
export type FunnelDirection = 'in' | 'out';
export type FunnelOrigin = 'customer' | 'human_app' | 'human_crm' | 'agent' | 'meta_bot' | 'cadence' | 'unknown';
export type FunnelProvider = 'meta' | 'baileys' | 'crm';
export interface FunnelMessageEvent {
  userId: string; waNumber: string; slot: 'main' | 'posvenda'; phone: string; messageId: string; occurredAt: string;
  direction: FunnelDirection; origin: FunnelOrigin; provider: FunnelProvider; type: string;
  body: string | null; filename: string | null; mimeType: string | null; contactName: string | null; isBot: boolean; quoteHint?: boolean;
}
export type FunnelAction =
  | { kind: 'ignore'; reason: string }
  | { kind: 'create_deal'; stageId: string; title: string; contactName: string | null }
  | { kind: 'move'; toStageId: string; fromStageId: string; reason: 'studio_reply' | 'quote_sent'; restart?: true }
  | { kind: 'cancel_cadence'; reason: 'customer_replied' | 'optout' }
  | { kind: 'opt_out'; optKind: 'hard' | 'soft'; pattern: string };
export interface FunnelDealState { id: number; stage: string; converted: boolean; converted_job_id: number | null;
  current_stage_entered_at: string | null; contact_name: string | null; contact_phone: string | null; stage_history: unknown; title: string | null }
export interface FunnelContext { deal: FunnelDealState | null; allDealsLost: boolean; isExistingCustomer: boolean;
  isOwnOrIgnored: boolean; syntheticEcho: boolean }
export interface FunnelConfig { trackerEnabled: boolean; cadenceEnabled: boolean; optOutDetection: boolean; createDealOnInbound: boolean;
  entryStageId: string | null; contactStageId: string | null; proposalStageId: string | null; promoteToContactFrom: string[];
  promoteToProposalFrom: string[]; restartOnQuoteFrom: string[]; keywords: string[]; exclusions: string[]; genericPdfIsQuote: boolean; countBotAsStudioReply: boolean;
  recreateAfterLost: boolean; skipExistingCustomers: boolean; ignoredPhones: string[] }
export interface FunnelObserveResult {
  trackerEnabled: boolean; actions: Array<FunnelAction['kind']>; dealId: number | null;
  created: boolean; moved: { from: string; to: string } | null; error?: string;
}
export interface FunnelStats { observed: number; created: number; moved: number; cancelled: number; optouts: number; failures: number; lastError: string | null }
export interface FunnelTracker {
  observe(evt: FunnelMessageEvent): Promise<FunnelObserveResult>;          // NUNCA lança
  isEnabled(userId: string): Promise<boolean>;                             // tracker_enabled (cache 60s); NUNCA lança; erro => false
  moveDealStage(input: MoveInput): Promise<MoveResult>;                    // ÚNICA função de mudança automática de etapa
  reconcilePreview(userId: string, opts: { limit?: number; days?: number }): Promise<ReconcilePreview>;
  reconcileApply(userId: string, req: ReconcileApplyRequest, actorId: string): Promise<ReconcileApplyResult>;
  invalidate(userId: string): void;
  stats(): FunnelStats;
}
export interface FunnelDeps {
  phoneVariants: (p: unknown) => string[];
  acquireLock: (userId: string, key: string | null) => Promise<() => void>;
  recordStageEvent: (userId: string, dealId: number, from: string | null, to: string, enteredAt: string | null) => Promise<void>;
  syncStageLabel: (userId: string, phone: string | null, from: string, to: string, stages: any[]) => void;
  ownNumbers: (userId: string) => Promise<string[]>;
  // Opcional: número principal quando followup_cadence_config.wa_number está vazio (só o reconcile usa).
  mainWaNumber?: (userId: string) => Promise<string | null>;
  now?: () => Date; log?: Pick<Console, 'warn' | 'log'>;
}

export type CancelCadenceReason = Extract<FunnelAction, { kind: 'cancel_cadence' }>['reason'];
export interface FunnelRepoError { code: string | null; message: string }
export type CasUpdateResult = 'ok' | 'no_rows' | { error: FunnelRepoError };
export interface OptOutRecord { phone: string; dealId: number | null; kind: 'hard' | 'soft'; pattern: string; text: string | null; messageId: string | null }
export interface OutboundHistoryRow { message_id: string | null; type: string | null; body: string | null; timestamp: string; status?: string | null }
export interface InboundHistoryRow { phone: string; timestamp: string; type?: string | null }
export interface FunnelActivityEntry { userId: string; dealId: number; actorId: string | null; summary: string; details: Record<string, unknown> }

export interface FunnelRepo {
  loadConfigRow(userId: string): Promise<Record<string, unknown> | null>;          // migration ausente => null
  loadStages(userId: string): Promise<StageRow[]>;
  loadMaterialKeys(userId: string): Promise<Set<string>>;
  loadCustomerKeys(userId: string): Promise<Set<string>>;                         // função ausente => Set vazio
  loadDeal(userId: string, dealId: number): Promise<FunnelDealState | null>;
  findDealsByPhone(userId: string, variants: string[], limit?: number): Promise<FunnelDealState[]>;
  scanDealsByPhone(userId: string, phone: string): Promise<FunnelDealState[]>;
  insertDeal(row: Record<string, unknown>): Promise<{ id: number } | { error: FunnelRepoError }>;
  casUpdateStage(userId: string, dealId: number, expectedStage: string, patch: Record<string, unknown>): Promise<CasUpdateResult>;
  updateContactName(userId: string, dealId: number, name: string, alsoTitle?: boolean): Promise<void>;
  cancelCadenceByPhone(userId: string, phoneKey: string, occurredAtIso: string, reason: CancelCadenceReason): Promise<number | 'schema_missing'>;
  upsertOptOut(userId: string, input: OptOutRecord): Promise<'ok' | 'schema_missing'>;
  hasOutboundNear(userId: string, variants: string[], atIso: string, seconds: number): Promise<boolean>;
  loadOutboundSince(userId: string, variants: string[], sinceIso: string, limit: number, waNumbers?: string[]): Promise<OutboundHistoryRow[]>;
  listDealsInStages(userId: string, stageIds: string[], limit: number): Promise<FunnelDealState[]>;
  listRecentInbound(userId: string, waNumbers: string[], sinceIso: string, limit?: number): Promise<InboundHistoryRow[]>;
  loadConversationNames(userId: string, phones: string[]): Promise<Map<string, string>>;   // chave = canonicalPhoneKey
  loadMarketingMappedStages(userId: string): Promise<Set<string>>;
  logActivity(entry: FunnelActivityEntry): Promise<void>;                          // falha é engolida
}

// ════════════════════════════════════════════════════════════════════
// Configuração
// ════════════════════════════════════════════════════════════════════
type Row = Record<string, unknown>;

function trackerConfigOf(row: Row | null): Row {
  const raw = row?.tracker_config;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Row;
  if (typeof raw !== 'string') return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

const boolOr = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback);

function stringsOr(value: unknown, fallback: readonly string[]): string[] {
  if (!Array.isArray(value)) return [...fallback];
  return value.filter((item): item is string => typeof item === 'string' && item.trim() !== '');
}

// Etapa aceitável como destino ou origem automática: existe, é de venda e está aberta.
function validStageId(id: unknown, stages: StageRow[]): string | null {
  if (typeof id !== 'string' || !id) return null;
  const stage = stages.find((s) => s.id === id);
  return stage && isSalesStage(stage) && !isClosedStage(stage) ? stage.id : null;
}

function stageListOr(raw: unknown, stages: StageRow[], fallback: Array<string | null>): string[] {
  const valid = (Array.isArray(raw) ? raw : []).map((id) => validStageId(id, stages)).filter((id): id is string => !!id);
  const list = valid.length ? valid : fallback.filter((id): id is string => !!id);
  return [...new Set(list)];
}

function phonesOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => digitsOnly(item)).filter((d) => d.length >= 8);
}

function entryStageOf(tc: Row, stages: StageRow[]): string | null {
  return validStageId(tc.entry_stage_id, stages) ?? firstOpenSalesStage(stages)?.id ?? null;
}

// Etapas da escada depois da etapa do orçamento, mais a etapa final da escada.
function ladderAfterProposal(row: Row | null, proposal: string): unknown[] {
  const raw = row?.ladder_stage_ids;
  const ladder: unknown[] = Array.isArray(raw) ? raw : [];
  const at = ladder.indexOf(proposal);
  return at < 0 ? [] : [...ladder.slice(at + 1), row?.after_last_stage_id];
}

// Orçamento novo para quem está na escada de follow-ups (inclusive quem entrou nela por um
// follow-up antes do orçamento) volta o card para a etapa do orçamento e a escada recomeça.
// tracker_config.restart_on_quote_from: [] desliga.
function restartStagesOf(row: Row | null, tc: Row, stages: StageRow[], proposal: string | null): string[] {
  if (!proposal) return [];
  const raw = Array.isArray(tc.restart_on_quote_from) ? tc.restart_on_quote_from : ladderAfterProposal(row, proposal);
  return stageListOr(raw, stages, []).filter((id) => id !== proposal);
}

// Linha nula => tudo desligado. Id inválido (inexistente, final, prod- ou de
// processo) vira null; a entrada nula cai na 1ª etapa aberta de venda.
export function parseFunnelConfig(row: Record<string, unknown> | null, stages: StageRow[]): FunnelConfig {
  const tc = trackerConfigOf(row);
  const d = DEFAULT_TRACKER_CONFIG;
  const entry = entryStageOf(tc, stages);
  const contact = validStageId(tc.contact_stage_id, stages);
  const proposal = validStageId(tc.proposal_stage_id, stages);
  return {
    trackerEnabled: row?.tracker_enabled === true,
    cadenceEnabled: row?.enabled === true,
    optOutDetection: !!row && row.optout_detection !== false,
    createDealOnInbound: boolOr(tc.create_deal_on_inbound, d.create_deal_on_inbound),
    entryStageId: entry,
    contactStageId: contact,
    proposalStageId: proposal,
    promoteToContactFrom: stageListOr(tc.promote_to_contact_from, stages, [entry]),
    promoteToProposalFrom: stageListOr(tc.promote_to_proposal_from, stages, [entry, contact]),
    restartOnQuoteFrom: restartStagesOf(row, tc, stages, proposal),
    keywords: stringsOr(tc.quote_keywords, d.quote_keywords),
    exclusions: stringsOr(tc.quote_exclusions, d.quote_exclusions),
    genericPdfIsQuote: boolOr(tc.generic_pdf_is_quote, d.generic_pdf_is_quote),
    countBotAsStudioReply: boolOr(tc.count_bot_as_studio_reply, d.count_bot_as_studio_reply),
    recreateAfterLost: boolOr(tc.recreate_after_lost, d.recreate_after_lost),
    skipExistingCustomers: boolOr(tc.skip_existing_customers, d.skip_existing_customers),
    ignoredPhones: phonesOf(tc.ignored_phones),
  };
}

// Sem nenhuma chave ligada o observe sai sem carregar etapas nem deals.
function rowAllOff(row: Row): boolean {
  return row.tracker_enabled !== true && row.enabled !== true && row.optout_detection === false;
}

// ════════════════════════════════════════════════════════════════════
// Decisão (pura)
// ════════════════════════════════════════════════════════════════════
const NON_TURN_IN = new Set(['reaction', 'edit', 'revoke', 'system', 'ephemeral', 'protocol']);
const NON_TURN_OUT = new Set([...NON_TURN_IN, 'unsupported']);
const STALE_TOLERANCE_MS = 5000;

const ignore = (reason: string): FunnelAction => ({ kind: 'ignore', reason });
const stageOf = (stages: StageRow[], id: string | null | undefined) => stages.find((s) => s.id === id);

function isOpenDeal(deal: FunnelDealState, stages: StageRow[]): boolean {
  return !isClosedStage(stageOf(stages, deal.stage)) && !deal.converted && deal.converted_job_id == null;
}

function isLostDeal(deal: FunnelDealState, stages: StageRow[]): boolean {
  return isLostStage(stageOf(stages, deal.stage)) && !deal.converted && deal.converted_job_id == null;
}

const timeOf = (iso: string | null | undefined): number => Date.parse(String(iso ?? '')) || 0;

function recencyDesc(a: FunnelDealState, b: FunnelDealState): number {
  return timeOf(b.current_stage_entered_at) - timeOf(a.current_stage_entered_at) || b.id - a.id;
}

// Aberto mais recente; sem aberto, o mais recente de todos.
export function pickDeal(deals: FunnelDealState[], stages: StageRow[]): { deal: FunnelDealState | null; allDealsLost: boolean } {
  const list = [...(deals || [])].sort(recencyDesc);
  const open = list.find((d) => isOpenDeal(d, stages));
  const allDealsLost = list.length > 0 && list.every((d) => isLostDeal(d, stages));
  return { deal: open ?? list[0] ?? null, allDealsLost };
}

function isNonTurn(evt: FunnelMessageEvent): boolean {
  const type = String(evt.type ?? '').toLowerCase();
  return (evt.direction === 'in' ? NON_TURN_IN : NON_TURN_OUT).has(type);
}

function isAllOff(cfg: FunnelConfig): boolean {
  return !cfg.trackerEnabled && !cfg.cadenceEnabled && !cfg.optOutDetection;
}

function eventGuardReason(evt: FunnelMessageEvent, cfg: FunnelConfig): string | null {
  if (evt.slot !== 'main') return 'not_main_slot';
  if (evt.direction !== 'in' && evt.direction !== 'out') return 'invalid_direction';
  const length = digitsOnly(evt.phone).length;
  if (length < 10 || length > 13) return 'invalid_phone';
  if (isNonTurn(evt)) return 'non_turn';
  if (isAllOff(cfg)) return 'disabled';
  return null;
}

// Só perdidos: recria apenas se o cliente falou DEPOIS da perda. Mensagem velha,
// reentregue ou duplicada pelo outro canal não ressuscita o card. Sem horário: como antes.
export function spokeAfterLoss(occurredAt: string | null | undefined, lostDeal: FunnelDealState | null): boolean {
  const at = Date.parse(String(occurredAt ?? ''));
  const lostAt = Date.parse(String(lostDeal?.current_stage_entered_at ?? ''));
  if (!Number.isFinite(at) || !Number.isFinite(lostAt)) return true;
  return at > lostAt + STALE_TOLERANCE_MS;
}

// pickDeal devolve em deal o perdido mais recente, logo o da última perda.
function recreatesLost(pick: { deal: FunnelDealState | null; allDealsLost: boolean }, cfg: FunnelConfig, occurredAt: string | null): boolean {
  return pick.allDealsLost && cfg.recreateAfterLost && spokeAfterLoss(occurredAt, pick.deal);
}

const effectiveDeal = (evt: FunnelMessageEvent, ctx: FunnelContext, cfg: FunnelConfig): FunnelDealState | null => (
  recreatesLost(ctx, cfg, evt.occurredAt) ? null : ctx.deal
);

const cleanName = (name: string | null | undefined): string | null => String(name ?? '').trim() || null;

function createOrIgnore(evt: FunnelMessageEvent, ctx: FunnelContext, cfg: FunnelConfig): FunnelAction {
  if (cfg.skipExistingCustomers && ctx.isExistingCustomer) return ignore('existing_customer');
  if (!cfg.trackerEnabled || !cfg.createDealOnInbound || !cfg.entryStageId) return ignore('create_disabled');
  const contactName = cleanName(evt.contactName);
  return { kind: 'create_deal', stageId: cfg.entryStageId, title: contactName || evt.phone, contactName };
}

// Entrada NUNCA move etapa: só cria o lead, cancela a cadência ou registra opt-out.
function decideInbound(evt: FunnelMessageEvent, ctx: FunnelContext, cfg: FunnelConfig): FunnelAction[] {
  const optOut = cfg.optOutDetection ? detectOptOut(evt.body) : null;
  // Quem pede para parar não vira lead novo; só registra e cancela as vivas.
  if (optOut) return [{ kind: 'opt_out', optKind: optOut.kind, pattern: optOut.pattern }, { kind: 'cancel_cadence', reason: 'optout' }];
  if (effectiveDeal(evt, ctx, cfg)) return [{ kind: 'cancel_cadence', reason: 'customer_replied' }];
  return [createOrIgnore(evt, ctx, cfg)];
}

function isStale(occurredAt: string, enteredAt: string | null): boolean {
  const at = Date.parse(occurredAt);
  const entered = Date.parse(String(enteredAt ?? ''));
  if (!Number.isFinite(at) || !Number.isFinite(entered)) return false;
  return at < entered - STALE_TOLERANCE_MS;
}

// Motivos de saída que não dependem do deal (servem para evitar consultas).
function outboundEarlyReason(evt: FunnelMessageEvent, cfg: FunnelConfig): string | null {
  if (evt.direction !== 'out') return null;
  if (!cfg.trackerEnabled) return 'tracker_disabled';
  if (evt.origin === 'cadence') return 'cadence';
  if (evt.origin === 'meta_bot' && !cfg.countBotAsStudioReply) return 'meta_bot_ignored';
  return null;
}

function outboundIgnoreReason(evt: FunnelMessageEvent, ctx: FunnelContext, stages: StageRow[], cfg: FunnelConfig): string | null {
  const early = outboundEarlyReason(evt, cfg);
  if (early) return early;
  if (!ctx.deal) return 'no_deal';
  if (evt.origin === 'meta_bot' && ctx.syntheticEcho) return 'synthetic_echo';
  if (!isOpenDeal(ctx.deal, stages)) return 'deal_closed';
  if (isStale(evt.occurredAt, ctx.deal.current_stage_entered_at)) return 'stale_event';
  return null;
}

function canPromote(from: string, to: string | null, allowed: string[], stages: StageRow[]): to is string {
  return !!to && allowed.includes(from) && canMoveForward(from, to, stages);
}

type Promotion = { to: string; reason: 'studio_reply' | 'quote_sent'; restart?: true };

function promotionTarget(stage: string, isQuote: boolean, stages: StageRow[], cfg: FunnelConfig): Promotion | null {
  if (isQuote && canPromote(stage, cfg.proposalStageId, cfg.promoteToProposalFrom, stages)) {
    return { to: cfg.proposalStageId as string, reason: 'quote_sent' };
  }
  if (canPromote(stage, cfg.contactStageId, cfg.promoteToContactFrom, stages)) {
    return { to: cfg.contactStageId as string, reason: 'studio_reply' };
  }
  return null;
}

// Só no evento ao vivo: o reconcile olha o histórico, onde o orçamento antigo já levou o card à escada.
function restartTarget(stage: string, isQuote: boolean, cfg: FunnelConfig): Promotion | null {
  if (!isQuote || !cfg.proposalStageId || !cfg.restartOnQuoteFrom.includes(stage)) return null;
  return { to: cfg.proposalStageId, reason: 'quote_sent', restart: true };
}

function moveAction(stage: string, target: Promotion): FunnelAction {
  return { kind: 'move', toStageId: target.to, fromStageId: stage, reason: target.reason, ...(target.restart ? { restart: true as const } : {}) };
}

function quoteRules(cfg: FunnelConfig, materialKeys: Set<string>): QuoteRules {
  return { materialKeys, keywords: cfg.keywords, exclusions: cfg.exclusions, genericPdfIsQuote: cfg.genericPdfIsQuote };
}

function eventCandidate(evt: FunnelMessageEvent): QuoteCandidate {
  return { direction: 'out', type: evt.type, filename: evt.filename, body: evt.body, mimeType: evt.mimeType, quoteHint: evt.quoteHint };
}

function decideOutbound(evt: FunnelMessageEvent, ctx: FunnelContext, stages: StageRow[], cfg: FunnelConfig, materialKeys: Set<string>): FunnelAction[] {
  const skip = outboundIgnoreReason(evt, ctx, stages, cfg);
  if (skip) return [ignore(skip)];
  const deal = ctx.deal as FunnelDealState;
  const isQuote = isQuoteDocument(eventCandidate(evt), quoteRules(cfg, materialKeys));
  const target = promotionTarget(deal.stage, isQuote, stages, cfg) ?? restartTarget(deal.stage, isQuote, cfg);
  if (!target) return [ignore('no_promotion')];
  return [moveAction(deal.stage, target)];
}

export function decideFunnelActions(
  evt: FunnelMessageEvent, ctx: FunnelContext, stages: StageRow[], cfg: FunnelConfig, materialKeys: Set<string>,
): FunnelAction[] {
  const guard = eventGuardReason(evt, cfg) ?? (ctx.isOwnOrIgnored ? 'own_number' : null);
  if (guard) return [ignore(guard)];
  if (evt.direction === 'in') return decideInbound(evt, ctx, cfg);
  return decideOutbound(evt, ctx, stages, cfg, materialKeys);
}

export interface HistoryDecision { toStageId: string; reason: 'studio_reply' | 'quote_sent'; row: OutboundHistoryRow }

function isHistoryTurn(row: OutboundHistoryRow): boolean {
  return row.status !== 'failed' && !NON_TURN_OUT.has(String(row.type ?? '').toLowerCase());
}

function historyCandidate(row: OutboundHistoryRow): QuoteCandidate {
  return { direction: 'out', type: row.type, filename: null, body: row.body, mimeType: null };
}

// Mesma regra do evento, aplicada às saídas já gravadas (reconcile e eco que
// chegou antes da entrada). As linhas vêm em ordem cronológica.
export function decideFromHistory(
  deal: FunnelDealState, rows: OutboundHistoryRow[], stages: StageRow[], cfg: FunnelConfig, materialKeys: Set<string>,
): HistoryDecision | null {
  if (!isOpenDeal(deal, stages)) return null;
  const turns = (rows || []).filter(isHistoryTurn);
  if (!turns.length) return null;
  const rules = quoteRules(cfg, materialKeys);
  const quoteRow = turns.find((row) => isQuoteDocument(historyCandidate(row), rules));
  const target = promotionTarget(deal.stage, !!quoteRow, stages, cfg);
  if (!target) return null;
  return { toStageId: target.to, reason: target.reason, row: target.reason === 'quote_sent' ? quoteRow as OutboundHistoryRow : turns[0] };
}

export function isBaileysBotMessage(msg: unknown): boolean {
  const m = msg as { is1PBizBotMessage?: unknown; message?: { messageContextInfo?: { botMetadata?: unknown } } } | null | undefined;
  return !!(m?.is1PBizBotMessage || m?.message?.messageContextInfo?.botMetadata);
}

// ════════════════════════════════════════════════════════════════════
// Aplicador
// ════════════════════════════════════════════════════════════════════
const CONFIG_TTL_MS = 60_000;
const SLOW_TTL_MS = 5 * 60_000;
const ECHO_WINDOW_SECONDS = 120;
const CREATE_LOOKBACK_MS = 10 * 60_000;
const HISTORY_LIMIT = 50;
const PREVIEW_CONCURRENCY = 4;
const MAX_PREVIEW_DEALS = 300;
const MAX_CREATE_ITEMS = 100;
const APPLY_CREATE_DAYS = 90;
const DEAL_LOOKUP_CHUNK = 25;

interface TtlCache<T> { get(key: string, load: () => Promise<T>): Promise<T>; delete(key: string): void }

// Guarda a promessa (junta cargas simultâneas) e descarta quando ela falha.
function createTtlCache<T>(ttlMs: number, clock: () => number): TtlCache<T> {
  const entries = new Map<string, { at: number; value: Promise<T> }>();
  return {
    get(key, load) {
      const hit = entries.get(key);
      if (hit && clock() - hit.at < ttlMs) return hit.value;
      const value = load();
      entries.set(key, { at: clock(), value });
      value.catch(() => { if (entries.get(key)?.value === value) entries.delete(key); });
      return value;
    },
    delete(key) { entries.delete(key); },
  };
}

interface TrackerCore {
  repo: FunnelRepo;
  deps: FunnelDeps;
  now: () => Date;
  log: Pick<Console, 'warn' | 'log'>;
  caches: {
    config: TtlCache<Row | null>; stages: TtlCache<StageRow[]>; materials: TtlCache<Set<string>>;
    customers: TtlCache<Set<string>>; own: TtlCache<string[]>;
  };
  counters: FunnelStats;
}

function createCore(repo: FunnelRepo, deps: FunnelDeps): TrackerCore {
  const now = deps.now ?? (() => new Date());
  const clock = () => now().getTime();
  return {
    repo, deps, now, log: deps.log ?? console,
    caches: {
      config: createTtlCache<Row | null>(CONFIG_TTL_MS, clock),
      stages: createTtlCache<StageRow[]>(CONFIG_TTL_MS, clock),
      materials: createTtlCache<Set<string>>(SLOW_TTL_MS, clock),
      customers: createTtlCache<Set<string>>(SLOW_TTL_MS, clock),
      own: createTtlCache<string[]>(SLOW_TTL_MS, clock),
    },
    counters: { observed: 0, created: 0, moved: 0, cancelled: 0, optouts: 0, failures: 0, lastError: null },
  };
}

// Código do erro sem PII: sequências longas de dígitos (telefone) são mascaradas.
function safeErrorCode(error: unknown): string {
  const e = error as { code?: unknown; message?: unknown } | null | undefined;
  if (e && typeof e.code === 'string' && e.code) return e.code;
  const message = e && typeof e.message === 'string' ? e.message : String(error ?? '');
  return message.replace(/\d{6,}/g, '…').slice(0, 80) || 'erro';
}

function fail(core: TrackerCore, scope: string, error: unknown, phone?: unknown): string {
  const code = safeErrorCode(error);
  core.counters.failures += 1;
  core.counters.lastError = code;
  core.log.warn(`[funnel] ${scope} falhou`, { code, phone: phone ? maskPhone(phone) : null });
  return code;
}

const configRow = (core: TrackerCore, userId: string) => core.caches.config.get(userId, () => core.repo.loadConfigRow(userId));
const stagesFor = (core: TrackerCore, userId: string) => core.caches.stages.get(userId, () => core.repo.loadStages(userId));
const materialsFor = (core: TrackerCore, userId: string) => core.caches.materials.get(userId, () => core.repo.loadMaterialKeys(userId));
const customerKeysFor = (core: TrackerCore, userId: string) => core.caches.customers.get(userId, () => core.repo.loadCustomerKeys(userId));

async function ownNumbersFor(core: TrackerCore, userId: string): Promise<string[]> {
  try {
    return await core.caches.own.get(userId, () => core.deps.ownNumbers(userId));
  } catch (error) {
    core.log.warn('[funnel] números da conta indisponíveis', { code: safeErrorCode(error) });
    return [];
  }
}

function emptyResult(): FunnelObserveResult {
  return { trackerEnabled: false, actions: [], dealId: null, created: false, moved: null };
}

function normalizeEvent(evt: FunnelMessageEvent, now: Date): FunnelMessageEvent {
  const at = Date.parse(String(evt.occurredAt ?? ''));
  return { ...evt, occurredAt: Number.isFinite(at) ? new Date(at).toISOString() : now.toISOString() };
}

interface ObserveScope { evt: FunnelMessageEvent; cfg: FunnelConfig; stages: StageRow[]; ctx: FunnelContext }

async function isOwnOrIgnored(core: TrackerCore, evt: FunnelMessageEvent, cfg: FunnelConfig): Promise<boolean> {
  if (samePhone(evt.phone, evt.waNumber)) return true;
  if (cfg.ignoredPhones.some((phone) => samePhone(evt.phone, phone))) return true;
  const own = await ownNumbersFor(core, evt.userId);
  return own.some((phone) => samePhone(evt.phone, phone));
}

async function existingCustomer(core: TrackerCore, evt: FunnelMessageEvent, cfg: FunnelConfig, ctx: FunnelContext): Promise<boolean> {
  const needed = evt.direction === 'in' && cfg.skipExistingCustomers && cfg.trackerEnabled && !effectiveDeal(evt, ctx, cfg);
  if (!needed) return false;
  const keys = await customerKeysFor(core, evt.userId);
  return keys.has(canonicalPhoneKey(evt.phone));
}

// Só o status 'sent' da Meta (sem corpo) pode ser eco de mensagem já gravada. No QR a
// própria mensagem do bot já está em wa_messages e sempre casaria consigo mesma.
async function syntheticEcho(core: TrackerCore, evt: FunnelMessageEvent, ctx: FunnelContext): Promise<boolean> {
  if (evt.direction !== 'out' || evt.origin !== 'meta_bot' || evt.provider !== 'meta' || !ctx.deal) return false;
  return core.repo.hasOutboundNear(evt.userId, core.deps.phoneVariants(evt.phone), evt.occurredAt, ECHO_WINDOW_SECONDS);
}

async function buildContext(core: TrackerCore, evt: FunnelMessageEvent, cfg: FunnelConfig, stages: StageRow[]): Promise<FunnelContext> {
  const ctx: FunnelContext = { deal: null, allDealsLost: false, isExistingCustomer: false, isOwnOrIgnored: false, syntheticEcho: false };
  ctx.isOwnOrIgnored = await isOwnOrIgnored(core, evt, cfg);
  if (ctx.isOwnOrIgnored) return ctx;
  Object.assign(ctx, pickDeal(await core.repo.findDealsByPhone(evt.userId, core.deps.phoneVariants(evt.phone)), stages));
  ctx.isExistingCustomer = await existingCustomer(core, evt, cfg, ctx);
  ctx.syntheticEcho = await syntheticEcho(core, evt, ctx);
  return ctx;
}

async function materialsForEvent(core: TrackerCore, evt: FunnelMessageEvent): Promise<Set<string>> {
  if (evt.direction !== 'out' || evt.type !== 'document') return new Set();
  return materialsFor(core, evt.userId);
}

async function observeInto(core: TrackerCore, rawEvt: FunnelMessageEvent, result: FunnelObserveResult): Promise<void> {
  if (!rawEvt?.userId) return;
  const row = await configRow(core, rawEvt.userId);
  if (!row || rowAllOff(row)) return;
  const evt = normalizeEvent(rawEvt, core.now());
  const stages = await stagesFor(core, evt.userId);
  const cfg = parseFunnelConfig(row, stages);
  result.trackerEnabled = cfg.trackerEnabled;
  if (eventGuardReason(evt, cfg) || outboundEarlyReason(evt, cfg)) {
    result.actions = ['ignore'];
    return;
  }
  const ctx = await buildContext(core, evt, cfg, stages);
  const actions = decideFunnelActions(evt, ctx, stages, cfg, await materialsForEvent(core, evt));
  result.actions = actions.map((action) => action.kind);
  result.dealId = effectiveDeal(evt, ctx, cfg)?.id ?? null;
  for (const action of actions) await applySafely(core, action, { evt, cfg, stages, ctx }, result);
}

async function observe(core: TrackerCore, evt: FunnelMessageEvent): Promise<FunnelObserveResult> {
  core.counters.observed += 1;
  const result = emptyResult();
  try {
    await observeInto(core, evt, result);
  } catch (error) {
    result.error = fail(core, 'observe', error, evt?.phone);
  }
  return result;
}

async function applySafely(core: TrackerCore, action: FunnelAction, scope: ObserveScope, result: FunnelObserveResult): Promise<void> {
  try {
    await applyAction(core, action, scope, result);
  } catch (error) {
    result.error = fail(core, action.kind, error, scope.evt.phone);
  }
}

function applyAction(core: TrackerCore, action: FunnelAction, scope: ObserveScope, result: FunnelObserveResult): Promise<void> {
  switch (action.kind) {
    case 'create_deal': return applyCreate(core, action, scope, result);
    case 'move': return applyMove(core, action, scope, result);
    case 'cancel_cadence': return applyCancel(core, action, scope);
    case 'opt_out': return applyOptOut(core, action, scope);
    default: return Promise.resolve();
  }
}

async function applyCreate(
  core: TrackerCore, action: Extract<FunnelAction, { kind: 'create_deal' }>, scope: ObserveScope, result: FunnelObserveResult,
): Promise<void> {
  const { evt } = scope;
  const outcome = await ensureDealForContact(core, {
    userId: evt.userId, phone: evt.phone, waNumber: evt.waNumber, occurredAt: evt.occurredAt,
    stageId: action.stageId, title: action.title, contactName: action.contactName,
  }, scope.cfg, scope.stages);
  result.dealId = outcome.dealId;
  result.created = outcome.created;
  result.moved = outcome.moved;
}

function eventEvidence(evt: FunnelMessageEvent): Record<string, unknown> {
  return { message_id: evt.messageId, origin: evt.origin, provider: evt.provider, type: evt.type, filename: evt.filename ?? null };
}

async function applyMove(
  core: TrackerCore, action: Extract<FunnelAction, { kind: 'move' }>, scope: ObserveScope, result: FunnelObserveResult,
): Promise<void> {
  const deal = scope.ctx.deal;
  if (!deal) return;
  const outcome = await moveDealStageSafe(core, {
    userId: scope.evt.userId, dealId: deal.id, toStageId: action.toStageId, expectedFromStage: action.fromStageId,
    reason: action.reason, allowFrom: [action.fromStageId], evidence: eventEvidence(scope.evt),
    ...(action.restart ? { allowBackward: true } : {}),
  });
  if (outcome === 'moved') result.moved = { from: action.fromStageId, to: action.toStageId };
}

async function applyCancel(core: TrackerCore, action: Extract<FunnelAction, { kind: 'cancel_cadence' }>, scope: ObserveScope): Promise<void> {
  const { evt } = scope;
  const outcome = await core.repo.cancelCadenceByPhone(evt.userId, canonicalPhoneKey(evt.phone), evt.occurredAt, action.reason);
  if (typeof outcome === 'number') core.counters.cancelled += outcome;
}

async function applyOptOut(core: TrackerCore, action: Extract<FunnelAction, { kind: 'opt_out' }>, scope: ObserveScope): Promise<void> {
  const { evt } = scope;
  const outcome = await core.repo.upsertOptOut(evt.userId, {
    phone: evt.phone, dealId: scope.ctx.deal?.id ?? null, kind: action.optKind, pattern: action.pattern,
    text: evt.body, messageId: evt.messageId,
  });
  if (outcome !== 'ok') return;
  core.counters.optouts += 1;
  core.log.log('[funnel] opt-out registrado', { phone: maskPhone(evt.phone), kind: action.optKind });
}

// ─── Criação do lead ────────────────────────────────────────────────
interface CreateRequest {
  userId: string; phone: string; waNumber: string | null; occurredAt: string;
  stageId: string; title: string; contactName: string | null;
}
interface CreateOutcome { dealId: number | null; created: boolean; moved: { from: string; to: string } | null }

function mergeById(a: FunnelDealState[], b: FunnelDealState[]): FunnelDealState[] {
  const seen = new Map<number, FunnelDealState>();
  for (const deal of [...a, ...b]) if (!seen.has(deal.id)) seen.set(deal.id, deal);
  return [...seen.values()];
}

// Variantes primeiro; sem aberto, a varredura pega formatos antigos (paridade com findOpenDealByPhone).
async function dealsForCreate(core: TrackerCore, req: CreateRequest, stages: StageRow[]): Promise<FunnelDealState[]> {
  const exact = await core.repo.findDealsByPhone(req.userId, core.deps.phoneVariants(req.phone));
  if (exact.some((deal) => isOpenDeal(deal, stages))) return exact;
  return mergeById(exact, await core.repo.scanDealsByPhone(req.userId, req.phone));
}

// Deal que impede a criação (aberto, ganho, convertido, ou perdido sem recriar).
async function blockingDeal(core: TrackerCore, req: CreateRequest, cfg: FunnelConfig, stages: StageRow[]): Promise<FunnelDealState | null> {
  const deals = await dealsForCreate(core, req, stages);
  if (!deals.length) return null;
  const pick = pickDeal(deals, stages);
  return recreatesLost(pick, cfg, req.occurredAt) ? null : pick.deal;
}

const isPlaceholderTitle = (title: string | null): boolean => !String(title ?? '').trim() || /^[\d\s()+-]+$/.test(String(title));

async function reuseDeal(core: TrackerCore, req: CreateRequest, deal: FunnelDealState): Promise<CreateOutcome> {
  if (req.contactName && !String(deal.contact_name ?? '').trim()) {
    await core.repo.updateContactName(req.userId, deal.id, req.contactName, isPlaceholderTitle(deal.title));
  }
  return { dealId: deal.id, created: false, moved: null };
}

// O lead "entrou" quando o cliente escreveu (nunca no futuro): eco atrasado não vira stale_event.
function entryInstant(occurredAt: string, now: Date): string {
  const at = Date.parse(occurredAt);
  return new Date(Number.isFinite(at) ? Math.min(at, now.getTime()) : now.getTime()).toISOString();
}

function buildDealRow(req: CreateRequest, stages: StageRow[], now: Date): Record<string, unknown> {
  const nowIso = now.toISOString();
  const enteredAt = entryInstant(req.occurredAt, now);
  const stageName = stageOf(stages, req.stageId)?.name || req.stageId;
  return {
    user_id: req.userId, title: req.title, contact_name: req.contactName, contact_phone: req.phone,
    stage: req.stageId, value: 0, stage_entered_at: enteredAt, current_stage_entered_at: enteredAt,
    created_at: nowIso, updated_at: nowIso,
    stage_history: [{ stage_id: req.stageId, stage_name: stageName, entered_at: enteredAt, left_at: null }],
  };
}

async function createUnderLock(core: TrackerCore, req: CreateRequest, cfg: FunnelConfig, stages: StageRow[]): Promise<CreateOutcome> {
  const existing = await blockingDeal(core, req, cfg, stages);
  if (existing) return reuseDeal(core, req, existing);
  const inserted = await core.repo.insertDeal(buildDealRow(req, stages, core.now()));
  if ('id' in inserted) return { dealId: inserted.id, created: true, moved: null };
  // O insert pode ter gravado e só a resposta falhado: confere antes de desistir.
  const landed = await blockingDeal(core, req, cfg, stages);
  if (landed) return reuseDeal(core, req, landed);
  throw Object.assign(new Error('insert_failed'), { code: inserted.error.code || 'insert_failed' });
}

async function ensureDealForContact(core: TrackerCore, req: CreateRequest, cfg: FunnelConfig, stages: StageRow[]): Promise<CreateOutcome> {
  // Mesma chave do POST /api/deals: extensão, webhook e Baileys ficam na mesma fila.
  const release = await core.deps.acquireLock(req.userId, `create:${normalizeBrazilianPhone13(req.phone)}`);
  let outcome: CreateOutcome;
  try {
    outcome = await createUnderLock(core, req, cfg, stages);
  } finally {
    release();
  }
  if (!outcome.created || outcome.dealId == null) return outcome;
  core.counters.created += 1;
  core.log.log('[funnel] lead criado', { dealId: outcome.dealId, phone: maskPhone(req.phone) });
  return { ...outcome, moved: await reconcileAfterCreateSafely(core, req, outcome.dealId, cfg, stages) };
}

const waVariants = (waNumber: string | null | undefined): string[] | undefined => {
  const d = digitsOnly(waNumber);
  return d.length >= 10 ? brazilianPhoneVariants(d) : undefined;
};

function historyEvidence(row: OutboundHistoryRow): Record<string, unknown> {
  return { message_id: row.message_id, at: row.timestamp, filename: row.type === 'document' ? row.body ?? null : null };
}

async function materialsForRows(core: TrackerCore, userId: string, rows: OutboundHistoryRow[]): Promise<Set<string>> {
  return rows.some((row) => row.type === 'document') ? materialsFor(core, userId) : new Set();
}

// Eco que chegou ANTES da entrada (webhooks fora de ordem): promove na hora.
async function reconcileDealAfterCreate(
  core: TrackerCore, req: CreateRequest, dealId: number, cfg: FunnelConfig, stages: StageRow[],
): Promise<{ from: string; to: string } | null> {
  if (!cfg.contactStageId && !cfg.proposalStageId) return null;
  const since = new Date(Date.parse(req.occurredAt) - CREATE_LOOKBACK_MS).toISOString();
  const rows = await core.repo.loadOutboundSince(req.userId, core.deps.phoneVariants(req.phone), since, HISTORY_LIMIT, waVariants(req.waNumber));
  if (!rows.length) return null;
  const deal: FunnelDealState = {
    id: dealId, stage: req.stageId, converted: false, converted_job_id: null, current_stage_entered_at: null,
    contact_name: req.contactName, contact_phone: req.phone, stage_history: null, title: req.title,
  };
  const decision = decideFromHistory(deal, rows, stages, cfg, await materialsForRows(core, req.userId, rows));
  if (!decision) return null;
  const outcome = await moveDealStageSafe(core, {
    userId: req.userId, dealId, toStageId: decision.toStageId, expectedFromStage: req.stageId,
    reason: decision.reason, allowFrom: [req.stageId], evidence: historyEvidence(decision.row),
  });
  return outcome === 'moved' ? { from: req.stageId, to: decision.toStageId } : null;
}

async function reconcileAfterCreateSafely(
  core: TrackerCore, req: CreateRequest, dealId: number, cfg: FunnelConfig, stages: StageRow[],
): Promise<{ from: string; to: string } | null> {
  try {
    return await reconcileDealAfterCreate(core, req, dealId, cfg, stages);
  } catch (error) {
    fail(core, 'promoção pós-criação', error, req.phone);
    return null;
  }
}

// ─── Mudança de etapa (a única automática) ──────────────────────────
function directionAllowed(input: MoveInput, from: string, stages: StageRow[]): boolean {
  if (canMoveForward(from, input.toStageId, stages)) return true;
  return input.allowBackward === true && canMoveBack(from, input.toStageId, stages);
}

function isRefused(input: MoveInput, deal: FunnelDealState, stages: StageRow[]): boolean {
  if (isClosedStage(stageOf(stages, input.toStageId))) return true;
  if (deal.converted || deal.converted_job_id != null) return true;
  if (isClosedStage(stageOf(stages, deal.stage))) return true;
  if (!directionAllowed(input, deal.stage, stages)) return true;
  return !!input.allowFrom && !input.allowFrom.includes(deal.stage);
}

function moveVerdict(input: MoveInput, deal: FunnelDealState | null, stages: StageRow[]): MoveResult | null {
  if (!deal) return 'conflict';
  if (deal.stage === input.toStageId) return 'noop';
  if (isRefused(input, deal, stages)) return 'refused';
  return deal.stage === input.expectedFromStage ? null : 'conflict';
}

const REASON_LABELS: Record<MoveInput['reason'], string> = {
  studio_reply: 'o estúdio respondeu',
  quote_sent: 'orçamento enviado',
  cadence_step: 'follow-up enviado',
  backfill: 'revisão do funil',
};

function moveSummary(toName: string, input: MoveInput): string {
  const label = input.evidence?.origin === 'meta_bot' ? 'IA oficial do WhatsApp respondeu' : REASON_LABELS[input.reason] || input.reason;
  return `Funil automático: ${toName} (${label})`;
}

async function afterMove(core: TrackerCore, input: MoveInput, deal: FunnelDealState, stages: StageRow[], toName: string): Promise<void> {
  try {
    await core.deps.recordStageEvent(input.userId, input.dealId, deal.stage, input.toStageId, deal.current_stage_entered_at);
  } catch (error) {
    core.log.warn('[funnel] recordStageEvent falhou', { code: safeErrorCode(error) });
  }
  try {
    core.deps.syncStageLabel(input.userId, deal.contact_phone, deal.stage, input.toStageId, stages);
  } catch (error) {
    core.log.warn('[funnel] etiqueta falhou', { code: safeErrorCode(error) });
  }
  await core.repo.logActivity({
    userId: input.userId, dealId: input.dealId, actorId: input.actorId ?? null, summary: moveSummary(toName, input),
    details: { from: deal.stage, to: input.toStageId, reason: input.reason, ...(input.evidence || {}) },
  }).catch(() => undefined);
}

async function commitMove(core: TrackerCore, input: MoveInput, deal: FunnelDealState, stages: StageRow[]): Promise<MoveResult> {
  const nowIso = core.now().toISOString();
  const toName = stageOf(stages, input.toStageId)?.name || input.toStageId;
  const patch = {
    stage: input.toStageId, stage_entered_at: nowIso, current_stage_entered_at: nowIso,
    stage_history: appendStageHistory(deal.stage_history, input.toStageId, toName, nowIso), updated_at: nowIso,
  };
  const cas = await core.repo.casUpdateStage(input.userId, input.dealId, input.expectedFromStage, patch);
  if (cas === 'no_rows') return 'conflict';
  // Erro é diferente de 0 linhas: o gatilho de marketing pode abortar o UPDATE.
  if (cas !== 'ok') {
    fail(core, 'mudança de etapa', cas.error);
    return 'conflict';
  }
  await afterMove(core, input, deal, stages, toName);
  core.counters.moved += 1;
  return 'moved';
}

async function moveDealStage(core: TrackerCore, input: MoveInput): Promise<MoveResult> {
  const [deal, stages] = await Promise.all([core.repo.loadDeal(input.userId, input.dealId), stagesFor(core, input.userId)]);
  const verdict = moveVerdict(input, deal, stages);
  if (verdict) return verdict;
  return commitMove(core, input, deal as FunnelDealState, stages);
}

async function moveDealStageSafe(core: TrackerCore, input: MoveInput): Promise<MoveResult> {
  try {
    return await moveDealStage(core, input);
  } catch (error) {
    fail(core, 'moveDealStage', error);
    return 'conflict';
  }
}

// ════════════════════════════════════════════════════════════════════
// Reconcile (prévia sem escrita e aplicação com aprovação)
// ════════════════════════════════════════════════════════════════════
interface ReconcileSetup { userId: string; cfg: FunnelConfig; stages: StageRow[]; mainWa: string | null }

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      out[index] = await fn(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

const clampInt = (value: unknown, min: number, max: number, fallback: number): number => {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) && n >= min ? Math.min(n, max) : fallback;
};

const validWa = (value: unknown): string | null => {
  const d = digitsOnly(value);
  return d.length >= 10 && d.length <= 13 ? d : null;
};

async function resolveMainWa(core: TrackerCore, userId: string, row: Row | null): Promise<string | null> {
  const fromConfig = validWa(row?.wa_number);
  if (fromConfig || !core.deps.mainWaNumber) return fromConfig;
  return validWa(await core.deps.mainWaNumber(userId).catch(() => null));
}

// Sem linha de config a prévia usa os padrões (etapas derivadas), sem ligar nada.
async function reconcileSetup(core: TrackerCore, userId: string): Promise<ReconcileSetup> {
  const row = await configRow(core, userId);
  const stages = await stagesFor(core, userId);
  return { userId, cfg: parseFunnelConfig(row ?? {}, stages), stages, mainWa: await resolveMainWa(core, userId, row) };
}

async function marketingStagesFor(core: TrackerCore, userId: string): Promise<Set<string>> {
  try {
    return await core.repo.loadMarketingMappedStages(userId);
  } catch (error) {
    // Sem saber se dispara anúncio, trata toda etapa como disparando (o apply pula por padrão).
    core.log.warn('[funnel] mapeamento de anúncio indisponível', { code: safeErrorCode(error) });
    return new Set(['*']);
  }
}

const firesMarketing = (marketing: Set<string>, stageId: string): boolean => marketing.has('*') || marketing.has(stageId);

function moveSourceStages(cfg: FunnelConfig): string[] {
  const contact = cfg.contactStageId ? cfg.promoteToContactFrom : [];
  const proposal = cfg.proposalStageId ? cfg.promoteToProposalFrom : [];
  return [...new Set([...contact, ...proposal])];
}

function toReconcileItem(deal: FunnelDealState, decision: HistoryDecision, marketing: Set<string>): ReconcileItem {
  const { row } = decision;
  return {
    deal_id: deal.id, title: deal.title || deal.contact_name || '', from_stage: deal.stage, to_stage: decision.toStageId,
    reason: decision.reason,
    evidence: { message_id: row.message_id || '', at: row.timestamp, filename: row.type === 'document' ? row.body ?? null : null },
    fires_marketing_event: firesMarketing(marketing, decision.toStageId),
  };
}

async function previewDeal(
  core: TrackerCore, setup: ReconcileSetup, deal: FunnelDealState, materialKeys: Set<string>, marketing: Set<string>,
): Promise<ReconcileItem | null> {
  const entered = Date.parse(String(deal.current_stage_entered_at ?? ''));
  if (!Number.isFinite(entered) || !validWa(deal.contact_phone)) return null;
  const since = new Date(entered - STALE_TOLERANCE_MS).toISOString();
  const variants = core.deps.phoneVariants(deal.contact_phone);
  const rows = await core.repo.loadOutboundSince(setup.userId, variants, since, HISTORY_LIMIT, waVariants(setup.mainWa));
  const decision = decideFromHistory(deal, rows, setup.stages, setup.cfg, materialKeys);
  return decision ? toReconcileItem(deal, decision, marketing) : null;
}

async function previewDealSafely(
  core: TrackerCore, setup: ReconcileSetup, deal: FunnelDealState, materialKeys: Set<string>, marketing: Set<string>,
): Promise<ReconcileItem | null> {
  try {
    return await previewDeal(core, setup, deal, materialKeys, marketing);
  } catch (error) {
    fail(core, 'prévia do deal', error);
    return null;
  }
}

async function previewMoves(core: TrackerCore, setup: ReconcileSetup, limit: number, marketing: Set<string>) {
  const sources = moveSourceStages(setup.cfg);
  if (!sources.length) return { scanned: 0, items: [] as ReconcileItem[] };
  const listed = await core.repo.listDealsInStages(setup.userId, sources, limit);
  const deals = listed.filter((deal) => isOpenDeal(deal, setup.stages));
  const materialKeys = await materialsFor(core, setup.userId);
  const items = await mapLimit(deals, PREVIEW_CONCURRENCY, (deal) => previewDealSafely(core, setup, deal, materialKeys, marketing));
  return { scanned: deals.length, items: items.filter((item): item is ReconcileItem => !!item) };
}

export interface InboundGroup { key: string; phone: string; first: string; last: string; count: number }

const CUSTOMER_NON_TURN = new Set(CUSTOMER_NON_TURN_TYPES);

// Agrupa as entradas por telefone canônico. As linhas vêm da mais nova para a mais velha.
export function groupInbound(rows: InboundHistoryRow[]): InboundGroup[] {
  const groups = new Map<string, InboundGroup>();
  for (const row of rows || []) {
    const length = digitsOnly(row.phone).length;
    if (length < 10 || length > 13 || CUSTOMER_NON_TURN.has(String(row.type ?? ''))) continue;
    const key = canonicalPhoneKey(row.phone);
    const group = groups.get(key);
    if (!group) groups.set(key, { key, phone: row.phone, first: row.timestamp, last: row.timestamp, count: 1 });
    else Object.assign(group, { count: group.count + 1, first: row.timestamp < group.first ? row.timestamp : group.first });
  }
  return [...groups.values()].sort((a, b) => (a.last < b.last ? 1 : a.last > b.last ? -1 : 0));
}

async function excludedPhoneCheck(core: TrackerCore, setup: ReconcileSetup): Promise<(group: InboundGroup) => boolean> {
  const own = [...(await ownNumbersFor(core, setup.userId)), ...setup.cfg.ignoredPhones, setup.mainWa || ''].filter(Boolean);
  const customers = setup.cfg.skipExistingCustomers ? await customerKeysFor(core, setup.userId) : new Set<string>();
  return (group) => customers.has(group.key) || own.some((phone) => samePhone(group.phone, phone));
}

function indexDealsByKey(deals: FunnelDealState[]): Map<string, FunnelDealState[]> {
  const index = new Map<string, FunnelDealState[]>();
  for (const deal of deals) {
    const key = canonicalPhoneKey(deal.contact_phone);
    index.set(key, [...(index.get(key) || []), deal]);
  }
  return index;
}

// Uma consulta por lote de telefones em vez de uma por contato.
async function groupsWithoutDeal(core: TrackerCore, setup: ReconcileSetup, groups: InboundGroup[]): Promise<InboundGroup[]> {
  const chunks: InboundGroup[][] = [];
  for (let i = 0; i < groups.length; i += DEAL_LOOKUP_CHUNK) chunks.push(groups.slice(i, i + DEAL_LOOKUP_CHUNK));
  const kept = await mapLimit(chunks, PREVIEW_CONCURRENCY, async (chunk) => {
    const variants = [...new Set(chunk.flatMap((group) => core.deps.phoneVariants(group.phone)))];
    const index = indexDealsByKey(await core.repo.findDealsByPhone(setup.userId, variants, 1000));
    return chunk.filter((group) => canCreateFor(index.get(group.key) || [], group, setup));
  });
  return kept.flat();
}

function canCreateFor(deals: FunnelDealState[], group: InboundGroup, setup: ReconcileSetup): boolean {
  if (!deals.length) return true;
  return recreatesLost(pickDeal(deals, setup.stages), setup.cfg, group.last);
}

async function conversationNames(core: TrackerCore, userId: string, phones: string[]): Promise<Map<string, string>> {
  if (!phones.length) return new Map();
  try {
    return await core.repo.loadConversationNames(userId, phones);
  } catch (error) {
    core.log.warn('[funnel] nomes das conversas indisponíveis', { code: safeErrorCode(error) });
    return new Map();
  }
}

async function previewCreates(core: TrackerCore, setup: ReconcileSetup, days: number, onlyKeys?: Set<string>): Promise<ReconcileCreateItem[]> {
  const { cfg, mainWa } = setup;
  if (!cfg.createDealOnInbound || !cfg.entryStageId || !mainWa) return [];
  const since = new Date(core.now().getTime() - days * 86_400_000).toISOString();
  const rows = await core.repo.listRecentInbound(setup.userId, brazilianPhoneVariants(mainWa), since, 5000);
  const excluded = await excludedPhoneCheck(core, setup);
  const groups = groupInbound(rows).filter((group) => (!onlyKeys || onlyKeys.has(group.key)) && !excluded(group));
  const kept = (await groupsWithoutDeal(core, setup, groups)).slice(0, MAX_CREATE_ITEMS);
  const names = await conversationNames(core, setup.userId, kept.map((group) => group.phone));
  return kept.map((group) => ({
    phone: group.phone, contact_name: names.get(group.key) ?? null, first_inbound_at: group.first,
    last_inbound_at: group.last, inbound_count: group.count,
  }));
}

async function reconcilePreview(core: TrackerCore, userId: string, opts: { limit?: number; days?: number }): Promise<ReconcilePreview> {
  const limit = clampInt(opts.limit, 1, MAX_PREVIEW_DEALS, MAX_PREVIEW_DEALS);
  const days = clampInt(opts.days, 1, APPLY_CREATE_DAYS, 30);
  const setup = await reconcileSetup(core, userId);
  const marketing = await marketingStagesFor(core, userId);
  const moves = await previewMoves(core, setup, limit, marketing);
  const toCreate = await previewCreates(core, setup, days);
  return {
    generated_at: core.now().toISOString(),
    scanned: moves.scanned,
    to_contact: moves.items.filter((item) => item.reason === 'studio_reply'),
    to_proposal: moves.items.filter((item) => item.reason === 'quote_sent'),
    to_create: toCreate,
  };
}

function tally(result: ReconcileApplyResult, outcome: MoveResult | 'skipped_marketing' | null): void {
  const field = ({ moved: 'moved', noop: 'noop', conflict: 'conflicts', refused: 'refused', skipped_marketing: 'skipped_marketing' } as const)[outcome ?? 'noop'];
  result[field] += 1;
}

async function applyDealMove(
  core: TrackerCore, setup: ReconcileSetup, dealId: number, ctx: { includeMarketing: boolean; actorId: string; materialKeys: Set<string>; marketing: Set<string> },
): Promise<MoveResult | 'skipped_marketing'> {
  const deal = await core.repo.loadDeal(setup.userId, dealId);
  if (!deal) return 'conflict';
  const item = await previewDeal(core, setup, deal, ctx.materialKeys, ctx.marketing);
  if (!item) return 'noop';
  if (item.fires_marketing_event && !ctx.includeMarketing) return 'skipped_marketing';
  return moveDealStageSafe(core, {
    userId: setup.userId, dealId, toStageId: item.to_stage, expectedFromStage: item.from_stage, reason: 'backfill',
    allowFrom: [item.from_stage], actorId: ctx.actorId,
    evidence: { detected: item.reason, message_id: item.evidence.message_id, at: item.evidence.at, filename: item.evidence.filename },
  });
}

const uniqueIds = (ids: unknown): number[] => (
  [...new Set((Array.isArray(ids) ? ids : []).map(Number).filter((id) => Number.isInteger(id) && id > 0))].slice(0, MAX_PREVIEW_DEALS)
);

async function applyMoves(core: TrackerCore, setup: ReconcileSetup, req: ReconcileApplyRequest, actorId: string, result: ReconcileApplyResult): Promise<void> {
  const ids = uniqueIds(req.deal_ids);
  if (!ids.length) return;
  const ctx = {
    includeMarketing: req.include_marketing === true, actorId,
    materialKeys: await materialsFor(core, setup.userId), marketing: await marketingStagesFor(core, setup.userId),
  };
  const outcomes = await mapLimit(ids, PREVIEW_CONCURRENCY, (id) => applyDealMove(core, setup, id, ctx).catch((error) => {
    fail(core, 'reconcile deal', error);
    return 'conflict' as const;
  }));
  for (const outcome of outcomes) tally(result, outcome);
}

const uniquePhoneKeys = (phones: unknown): Set<string> => new Set(
  (Array.isArray(phones) ? phones : []).map((phone) => canonicalPhoneKey(phone)).filter((key) => key.length >= 10).slice(0, MAX_CREATE_ITEMS),
);

async function applyCreates(core: TrackerCore, setup: ReconcileSetup, req: ReconcileApplyRequest, result: ReconcileApplyResult): Promise<void> {
  const keys = uniquePhoneKeys(req.create_phones);
  if (!keys.size) return;
  const items = await previewCreates(core, setup, APPLY_CREATE_DAYS, keys);
  for (const item of items) {
    try {
      const outcome = await ensureDealForContact(core, {
        userId: setup.userId, phone: item.phone, waNumber: setup.mainWa, occurredAt: item.last_inbound_at,
        stageId: setup.cfg.entryStageId as string, title: item.contact_name || item.phone, contactName: item.contact_name,
      }, setup.cfg, setup.stages);
      if (outcome.created) result.created += 1;
    } catch (error) {
      fail(core, 'reconcile criar lead', error, item.phone);
    }
  }
}

async function reconcileApply(core: TrackerCore, userId: string, req: ReconcileApplyRequest, actorId: string): Promise<ReconcileApplyResult> {
  const result: ReconcileApplyResult = { moved: 0, noop: 0, conflicts: 0, refused: 0, created: 0, skipped_marketing: 0 };
  const setup = await reconcileSetup(core, userId);
  await applyMoves(core, setup, req, actorId, result);
  await applyCreates(core, setup, req, result);
  return result;
}

async function isEnabled(core: TrackerCore, userId: string): Promise<boolean> {
  try {
    const row = await configRow(core, userId);
    return row?.tracker_enabled === true;
  } catch {
    return false;
  }
}

function invalidate(core: TrackerCore, userId: string): void {
  for (const cache of Object.values(core.caches)) cache.delete(userId);
}

export function createFunnelTracker(repo: FunnelRepo, deps: FunnelDeps): FunnelTracker {
  const core = createCore(repo, deps);
  return {
    observe: (evt) => observe(core, evt),
    isEnabled: (userId) => isEnabled(core, userId),
    moveDealStage: (input) => moveDealStageSafe(core, input),
    reconcilePreview: (userId, opts) => reconcilePreview(core, userId, opts ?? {}),
    reconcileApply: (userId, req, actorId) => reconcileApply(core, userId, req ?? {}, actorId),
    invalidate: (userId) => invalidate(core, userId),
    stats: () => ({ ...core.counters }),
  };
}

// ════════════════════════════════════════════════════════════════════
// Repositório Supabase (service_role; toda consulta filtra user_id)
// ════════════════════════════════════════════════════════════════════
type DbError = { code?: string | null; message?: string } | null;
type DbResult = { data: unknown; error: DbError };

const SCHEMA_MISSING_CODES = new Set(['42P01', '42703', 'PGRST204', 'PGRST205']);
const FUNCTION_MISSING_CODES = new Set(['42883', 'PGRST202', ...SCHEMA_MISSING_CODES]);
const DEAL_COLUMNS = 'id, stage, converted, converted_job_id, current_stage_entered_at, stage_entered_at, contact_name, contact_phone, stage_history, title';
const PAGE_SIZE = 1000;
const SCAN_LIMIT = 3000;
const NAME_CHUNK = 150;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OPTOUT_REASONS: Record<'hard' | 'soft', string> = {
  hard: 'Pediu para não receber mais mensagens (detectado na conversa)',
  soft: 'Demonstrou desinteresse (detectado na conversa)',
};

const isSchemaMissing = (error: DbError): boolean => !!error && SCHEMA_MISSING_CODES.has(String(error.code ?? ''));
const rowsOf = (data: unknown): Row[] => (Array.isArray(data) ? (data as Row[]) : []);

function throwIfError(error: DbError): void {
  if (error) throw Object.assign(new Error(error.message || 'erro no banco'), { code: error.code ?? null });
}

const repoError = (error: DbError): FunnelRepoError => ({ code: error?.code ? String(error.code) : null, message: String(error?.message ?? 'erro') });
const nullableText = (value: unknown): string | null => (value == null ? null : String(value));
const nullableBool = (value: unknown): boolean | null => (value == null ? null : value === true);

function toStageRow(row: Row): StageRow {
  return {
    id: String(row.id), name: String(row.name ?? row.id), position: Number(row.position) || 0,
    is_final: nullableBool(row.is_final), is_won: nullableBool(row.is_won), process_id: nullableText(row.process_id),
  };
}

function toDealState(row: Row): FunnelDealState {
  return {
    id: Number(row.id), stage: String(row.stage ?? ''), converted: row.converted === true,
    converted_job_id: row.converted_job_id == null ? null : Number(row.converted_job_id),
    current_stage_entered_at: nullableText(row.current_stage_entered_at ?? row.stage_entered_at),
    contact_name: nullableText(row.contact_name), contact_phone: nullableText(row.contact_phone),
    stage_history: row.stage_history ?? null, title: nullableText(row.title),
  };
}

async function pagedRows(build: (from: number, to: number) => PromiseLike<DbResult>, limit: number): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; from < limit; from += PAGE_SIZE) {
    const to = Math.min(from + PAGE_SIZE, limit) - 1;
    const { data, error } = await build(from, to);
    throwIfError(error);
    const rows = rowsOf(data);
    out.push(...rows);
    if (rows.length < to - from + 1) break;
  }
  return out;
}

function chunked<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function sbLoadConfigRow(db: SupabaseClient, userId: string): Promise<Row | null> {
  const { data, error } = await db.from('followup_cadence_config').select('*').eq('user_id', userId).maybeSingle();
  if (isSchemaMissing(error)) return null;
  throwIfError(error);
  return (data as Row | null) ?? null;
}

async function sbLoadStages(db: SupabaseClient, userId: string): Promise<StageRow[]> {
  const { data, error } = await db.from('deal_stages').select('id, name, position, is_final, is_won, process_id')
    .eq('user_id', userId).order('position', { ascending: true });
  throwIfError(error);
  return rowsOf(data).map(toStageRow);
}

async function sbLoadMaterialKeys(db: SupabaseClient, userId: string): Promise<Set<string>> {
  // agente_materiais.user_id é TEXT.
  const { data, error } = await db.from('agente_materiais').select('nome_arquivo, tipo, nicho').eq('user_id', String(userId));
  if (isSchemaMissing(error)) return new Set();
  throwIfError(error);
  return materialKeysFrom(rowsOf(data) as Array<{ nome_arquivo: string | null; tipo: string | null; nicho: string | null }>);
}

async function sbLoadCustomerKeys(db: SupabaseClient, userId: string): Promise<Set<string>> {
  const { data, error } = await db.rpc('followup_customer_phone_keys', { p_user_id: userId });
  if (error && FUNCTION_MISSING_CODES.has(String(error.code ?? ''))) return new Set();
  throwIfError(error);
  return new Set(rowsOf(data).map((row) => String(row.phone_key ?? '')).filter(Boolean));
}

async function sbLoadDeal(db: SupabaseClient, userId: string, dealId: number): Promise<FunnelDealState | null> {
  const { data, error } = await db.from('deals').select(DEAL_COLUMNS).eq('user_id', userId).eq('id', dealId).maybeSingle();
  throwIfError(error);
  return data ? toDealState(data as Row) : null;
}

async function sbFindDealsByPhone(db: SupabaseClient, userId: string, variants: string[], limit = 20): Promise<FunnelDealState[]> {
  if (!variants.length) return [];
  const { data, error } = await db.from('deals').select(DEAL_COLUMNS).eq('user_id', userId).in('contact_phone', variants).limit(limit);
  throwIfError(error);
  return rowsOf(data).map(toDealState);
}

// Formato antigo que o .in() não pega: casa por samePhone em até 3000 deals.
async function sbScanDealsByPhone(db: SupabaseClient, userId: string, phone: string): Promise<FunnelDealState[]> {
  const rows = await pagedRows((from, to) => db.from('deals').select('id, contact_phone').eq('user_id', userId)
    .not('contact_phone', 'is', null).order('created_at', { ascending: true }).range(from, to), SCAN_LIMIT);
  const ids = rows.filter((row) => samePhone(row.contact_phone, phone)).map((row) => Number(row.id)).slice(0, 20);
  if (!ids.length) return [];
  const { data, error } = await db.from('deals').select(DEAL_COLUMNS).eq('user_id', userId).in('id', ids);
  throwIfError(error);
  return rowsOf(data).map(toDealState);
}

async function sbInsertDeal(db: SupabaseClient, row: Row): Promise<{ id: number } | { error: FunnelRepoError }> {
  const { data, error } = await db.from('deals').insert(row).select('id').single();
  if (error || !data) return { error: repoError(error ?? { message: 'insert sem retorno' }) };
  return { id: Number((data as Row).id) };
}

async function sbCasUpdateStage(db: SupabaseClient, userId: string, dealId: number, expectedStage: string, patch: Row): Promise<CasUpdateResult> {
  const { data, error } = await db.from('deals').update(patch)
    .eq('user_id', userId).eq('id', dealId).eq('stage', expectedStage).select('id');
  if (error) return { error: repoError(error) };
  return rowsOf(data).length ? 'ok' : 'no_rows';
}

async function sbUpdateContactName(db: SupabaseClient, userId: string, dealId: number, name: string, alsoTitle = false): Promise<void> {
  const patch: Row = alsoTitle ? { contact_name: name, title: name } : { contact_name: name };
  const { error } = await db.from('deals').update(patch).eq('user_id', userId).eq('id', dealId)
    .or('contact_name.is.null,contact_name.eq.');
  throwIfError(error);
}

// Só vivas de cadência anteriores à fala; 'sending', legado e generation_meta ficam intactos.
async function sbCancelCadenceByPhone(
  db: SupabaseClient, userId: string, phoneKey: string, occurredAtIso: string, reason: CancelCadenceReason, nowIso: string,
): Promise<number | 'schema_missing'> {
  const { data, error } = await db.from('scheduled_followups')
    .update({ status: 'cancelled', last_error: `cancel:${reason}`, updated_at: nowIso })
    .eq('user_id', userId).eq('kind', 'cadence').eq('phone_key', phoneKey)
    .in('status', ['draft', 'approved', 'blocked']).lt('basis_at', occurredAtIso)
    .select('id');
  if (isSchemaMissing(error)) return 'schema_missing';
  throwIfError(error);
  return rowsOf(data).length;
}

async function sbUpsertOptOut(db: SupabaseClient, userId: string, input: OptOutRecord): Promise<'ok' | 'schema_missing'> {
  const { error } = await db.from('followup_optouts').insert({
    user_id: userId, phone_key: canonicalPhoneKey(input.phone), phone: digitsOnly(input.phone) || null,
    deal_id: input.dealId, kind: input.kind, reason: OPTOUT_REASONS[input.kind],
    detected_text: input.text ? String(input.text).slice(0, 300) : null, source_message_id: input.messageId || null,
    created_by: 'funnel_tracker',
  });
  if (!error || error.code === '23505') return 'ok';
  if (isSchemaMissing(error)) return 'schema_missing';
  throwIfError(error);
  return 'ok';
}

async function sbHasOutboundNear(db: SupabaseClient, userId: string, variants: string[], atIso: string, seconds: number): Promise<boolean> {
  const at = Date.parse(atIso);
  if (!Number.isFinite(at) || !variants.length) return false;
  const { data, error } = await db.from('wa_messages').select('id').eq('user_id', userId).eq('from_me', true)
    .in('phone', variants)
    .gte('timestamp', new Date(at - seconds * 1000).toISOString())
    .lte('timestamp', new Date(at + seconds * 1000).toISOString())
    .limit(1);
  throwIfError(error);
  return rowsOf(data).length > 0;
}

async function sbLoadOutboundSince(
  db: SupabaseClient, userId: string, variants: string[], sinceIso: string, limit: number, waNumbers?: string[],
): Promise<OutboundHistoryRow[]> {
  if (!variants.length) return [];
  let query: any = db.from('wa_messages').select('message_id, type, body, timestamp, status')
    .eq('user_id', userId).eq('from_me', true).in('phone', variants).gte('timestamp', sinceIso);
  if (waNumbers?.length) query = query.in('wa_number', waNumbers);
  const { data, error } = await query.order('timestamp', { ascending: true }).limit(limit);
  throwIfError(error);
  return rowsOf(data).map((row) => ({
    message_id: nullableText(row.message_id), type: nullableText(row.type), body: nullableText(row.body),
    timestamp: String(row.timestamp ?? ''), status: nullableText(row.status),
  }));
}

async function sbListDealsInStages(db: SupabaseClient, userId: string, stageIds: string[], limit: number): Promise<FunnelDealState[]> {
  if (!stageIds.length) return [];
  const { data, error } = await db.from('deals').select(DEAL_COLUMNS).eq('user_id', userId).in('stage', stageIds)
    .or('converted.is.null,converted.eq.false').is('converted_job_id', null)
    .order('current_stage_entered_at', { ascending: false, nullsFirst: false }).limit(limit);
  throwIfError(error);
  return rowsOf(data).map(toDealState);
}

async function sbListRecentInbound(db: SupabaseClient, userId: string, waNumbers: string[], sinceIso: string, limit = 5000): Promise<InboundHistoryRow[]> {
  if (!waNumbers.length) return [];
  const rows = await pagedRows((from, to) => db.from('wa_messages').select('phone, timestamp, type')
    .eq('user_id', userId).eq('from_me', false).in('wa_number', waNumbers).gte('timestamp', sinceIso)
    .order('timestamp', { ascending: false }).range(from, to), limit);
  return rows.map((row) => ({ phone: String(row.phone ?? ''), timestamp: String(row.timestamp ?? ''), type: nullableText(row.type) }));
}

async function sbLoadConversationNames(db: SupabaseClient, userId: string, phones: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const variants = [...new Set(phones.flatMap((phone) => brazilianPhoneVariants(phone)))];
  for (const chunk of chunked(variants, NAME_CHUNK)) {
    const { data, error } = await db.from('wa_conversations').select('phone, contact_name').eq('user_id', userId).in('phone', chunk);
    throwIfError(error);
    for (const row of rowsOf(data)) {
      const name = String(row.contact_name ?? '').trim();
      const key = canonicalPhoneKey(row.phone);
      if (name && !names.has(key)) names.set(key, name);
    }
  }
  return names;
}

async function sbLoadMarketingMappedStages(db: SupabaseClient, userId: string): Promise<Set<string>> {
  const { data, error } = await db.from('marketing_stage_event_mappings').select('stage_id').eq('user_id', userId).eq('enabled', true);
  if (isSchemaMissing(error)) return new Set();
  throwIfError(error);
  return new Set(rowsOf(data).map((row) => String(row.stage_id ?? '')).filter(Boolean));
}

async function sbLogActivity(db: SupabaseClient, entry: FunnelActivityEntry): Promise<void> {
  try {
    await db.from('activity_log').insert({
      user_id: entry.userId,
      actor_user_id: entry.actorId && UUID_RE.test(entry.actorId) ? entry.actorId : null,
      action: 'funnel_auto', entity_type: 'deal', entity_id: String(entry.dealId), summary: entry.summary,
      details: { automatic: true, source: 'funnel_tracker', ...entry.details },
    });
  } catch { /* sem a 063 ou falha de rede: o histórico não bloqueia a mudança */ }
}

export function createSupabaseFunnelRepo(db: SupabaseClient, now: () => Date = () => new Date()): FunnelRepo {
  return {
    loadConfigRow: (userId) => sbLoadConfigRow(db, userId),
    loadStages: (userId) => sbLoadStages(db, userId),
    loadMaterialKeys: (userId) => sbLoadMaterialKeys(db, userId),
    loadCustomerKeys: (userId) => sbLoadCustomerKeys(db, userId),
    loadDeal: (userId, dealId) => sbLoadDeal(db, userId, dealId),
    findDealsByPhone: (userId, variants, limit) => sbFindDealsByPhone(db, userId, variants, limit),
    scanDealsByPhone: (userId, phone) => sbScanDealsByPhone(db, userId, phone),
    insertDeal: (row) => sbInsertDeal(db, row),
    casUpdateStage: (userId, dealId, expectedStage, patch) => sbCasUpdateStage(db, userId, dealId, expectedStage, patch),
    updateContactName: (userId, dealId, name, alsoTitle) => sbUpdateContactName(db, userId, dealId, name, alsoTitle),
    cancelCadenceByPhone: (userId, phoneKey, occurredAtIso, reason) => sbCancelCadenceByPhone(db, userId, phoneKey, occurredAtIso, reason, now().toISOString()),
    upsertOptOut: (userId, input) => sbUpsertOptOut(db, userId, input),
    hasOutboundNear: (userId, variants, atIso, seconds) => sbHasOutboundNear(db, userId, variants, atIso, seconds),
    loadOutboundSince: (userId, variants, sinceIso, limit, waNumbers) => sbLoadOutboundSince(db, userId, variants, sinceIso, limit, waNumbers),
    listDealsInStages: (userId, stageIds, limit) => sbListDealsInStages(db, userId, stageIds, limit),
    listRecentInbound: (userId, waNumbers, sinceIso, limit) => sbListRecentInbound(db, userId, waNumbers, sinceIso, limit),
    loadConversationNames: (userId, phones) => sbLoadConversationNames(db, userId, phones),
    loadMarketingMappedStages: (userId) => sbLoadMarketingMappedStages(db, userId),
    logActivity: (entry) => sbLogActivity(db, entry),
  };
}

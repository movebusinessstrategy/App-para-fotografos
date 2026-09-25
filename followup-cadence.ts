// Regras puras da cadência de follow-up: config, escada, quem está elegível,
// faxina das tarefas vivas e a decisão logo antes do envio. Sem banco, sem rede
// e sem relógio implícito: quem chama passa o `now`.
import type {
  BlockCode, CadenceStatus, CadenceTaskRow, CancelReason, DraftWarning, FollowUpConfig, FollowUpMode,
  FollowUpRuntimeState, FollowUpStep, FollowUpTrack, PauseReason, SweepSummary, TrackerConfig,
} from './src/features/followups/types.js';
import {
  DEFAULT_BUSINESS_HOURS, DEFAULT_FOLLOWUP_CONFIG, DEFAULT_PRE_QUOTE_DELAYS_HOURS, DEFAULT_STEP_DELAYS_HOURS,
  DEFAULT_TRACKER_CONFIG, LIVE_CADENCE_STATUSES, PRE_QUOTE_MAX_STEPS, WARMUP_DAILY_CAP, WARMUP_DAYS,
} from './src/features/followups/types.js';
import type { StageRow } from './lib/stage-rules.js';
import { firstOpenSalesStage, isClosedStage, isSalesStage } from './lib/stage-rules.js';
import { canonicalPhoneKey, digitsOnly } from './lib/br-phone.js';
import { isWithinBusinessHours, normalizeBusinessHours } from './lib/business-hours.js';

export const CADENCE_MAX_STEPS = 4;
export const CLOCK_TOLERANCE_MS = 5000;
export const STALE_APPROVAL_HOURS = 72;
export const LIVE_TASK_LOOKBACK_DAYS = 60;

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

export interface DealActivity { dealId: number; stage: string; contactName: string | null; contactPhone: string; phoneKey: string;
  stageEnteredAt: string | null; lastStudioAt: string | null; lastStudioType: string | null; lastStudioBody: string | null;
  lastStudioMessageId: string | null; lastCustomerAt: string | null; lastCustomerReactionAt: string | null;
  lastInvisibleOutAt: string | null; invisibleRead: boolean; needsHuman: boolean; alreadyCustomer: boolean }

// track ausente = 'ladder' (linhas anteriores à trilha antes do orçamento).
export interface CadenceTaskLite { id: number; deal_id: number; status: CadenceStatus; step: FollowUpStep; basis_at: string;
  sent_at: string | null; created_at: string; phone: string; phone_key: string | null; stage_id: string; track?: FollowUpTrack }

export interface EligibleDeal { dealId: number; track: FollowUpTrack; step: FollowUpStep; stageId: string; nextStageId: string | null;
  basisAt: string; basisMessageId: string | null; dueAt: string; phoneKey: string; contactPhone: string;
  contactName: string | null; invisibleBasis: boolean; invisibleRead: boolean; silenceHours: number; lastCustomerAt: string | null;
  customerReactedAfterBasis: boolean }

export type SkipReason = 'disabled' | 'closed_stage' | 'stage_not_in_ladder' | 'already_customer' | 'optout' | 'needs_human'
  | 'live_cadence_task' | 'live_legacy_task' | 'no_studio_turn' | 'customer_spoke_last' | 'too_old' | 'too_soon'
  | 'episode_done' | 'step_already_sent' | 'duplicate_phone';

export interface SelectInput { config: FollowUpConfig; stages: StageRow[]; activities: DealActivity[]; cadenceTasks: CadenceTaskLite[];
  liveLegacyDealIds: Set<number>; optoutKeys: Set<string>; now: Date }

export interface SendSnapshot {
  deal: { id: number; stage: string; converted: boolean; converted_job_id: number | null; contact_name: string | null } | null;
  stages: StageRow[];
  lastCustomerAt: string | null; lastStudioAt: string | null; lastInvisibleOutAt: string | null;
  optedOut: boolean; alreadyCustomer: boolean; needsHuman: boolean;
  conversationPhone: string; conversationWaNumber: string; seenBaileysPhones: string[];
}

export type SendDecision = { action: 'send' } | { action: 'cancel'; reason: CancelReason }
  | { action: 'hold'; reason: 'disabled' | 'paused' | 'outside_hours' } | { action: 'stale'; reason: 'stale_approval' }
  | { action: 'review'; reason: 'auto_mode_off' };

// Utilitários de valor

function toMs(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const ms = value instanceof Date ? value.getTime() : Date.parse(String(value));
  return Number.isFinite(ms) ? ms : null;
}

function toIsoOrNull(value: unknown): string | null {
  const ms = toMs(value);
  return ms === null ? null : new Date(ms).toISOString();
}

function textOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value);
  return text ? text : null;
}

function numberFrom(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim()) return Number(value);
  return NaN;
}

function toInteger(value: unknown): number | null {
  const n = numberFrom(value);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function toStrictInteger(value: unknown): number | null {
  const n = numberFrom(value);
  return Number.isInteger(n) ? n : null;
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = toInteger(value);
  return n === null ? fallback : Math.min(max, Math.max(min, n));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

// jsonb às vezes chega como string JSON (gravado por código antigo ou driver).
function parseJsonish(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function positionOf(stage: StageRow): number {
  return Number(stage.position) || 0;
}

function isOpenSalesStage(stage: StageRow | undefined): stage is StageRow {
  return !!stage && isSalesStage(stage) && !isClosedStage(stage);
}

function indexStages(stages: StageRow[]): Map<string, StageRow> {
  return new Map((stages || []).map((s) => [s.id, s]));
}

function uniqueTrimmedStrings(value: unknown[]): string[] {
  const out: string[] = [];
  for (const item of value) {
    const text = typeof item === 'string' ? item.trim() : '';
    if (text && !out.includes(text)) out.push(text);
  }
  return out;
}

function phoneKeyOf(phoneKey: string | null | undefined, phone: unknown): string {
  return canonicalPhoneKey(phoneKey || phone);
}

// Parse da config

type Parser = (raw: unknown, draft: FollowUpConfig) => unknown;
const D = DEFAULT_FOLLOWUP_CONFIG;

function boolOr(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function idOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function parseDelays(value: unknown): number[] {
  const list = parseJsonish(value);
  if (!Array.isArray(list)) return [...D.step_delays_hours];
  const delays = list.map(toInteger).filter((n): n is number => n !== null)
    .map((n) => Math.min(720, Math.max(1, n))).slice(0, CADENCE_MAX_STEPS);
  return delays.length ? delays : [...D.step_delays_hours];
}

function parseLadder(value: unknown): string[] {
  const list = parseJsonish(value);
  return Array.isArray(list) ? uniqueTrimmedStrings(list).slice(0, CADENCE_MAX_STEPS) : [];
}

function parsePreQuoteStages(value: unknown): string[] {
  const list = parseJsonish(value);
  return Array.isArray(list) ? uniqueTrimmedStrings(list).slice(0, PRE_QUOTE_MAX_STEPS) : [];
}

function parsePreQuoteDelays(value: unknown): number[] {
  const list = parseJsonish(value);
  const fallback = [...DEFAULT_PRE_QUOTE_DELAYS_HOURS];
  if (!Array.isArray(list)) return fallback;
  const delays = list.map(toInteger).filter((n): n is number => n !== null)
    .map((n) => Math.min(720, Math.max(1, n))).slice(0, PRE_QUOTE_MAX_STEPS);
  return delays.length ? delays : fallback;
}

function parseWaNumber(value: unknown): string | null {
  const digits = digitsOnly(value);
  return digits.length >= 10 && digits.length <= 13 ? digits : null;
}

function parseTemplateId(value: unknown): number | null {
  const n = toStrictInteger(value);
  return n !== null && n > 0 ? n : null;
}

function parseExtraInstructions(value: unknown): string {
  return typeof value === 'string' ? value.split('###').join('').slice(0, 1000) : '';
}

const CONFIG_PARSERS: Record<keyof FollowUpConfig, Parser> = {
  enabled: (v) => boolOr(v, D.enabled),
  mode: (v) => (v === 'auto' || v === 'approval' ? v : D.mode),
  ladder_stage_ids: parseLadder,
  step_delays_hours: parseDelays,
  after_last_stage_id: idOrNull,
  pre_quote_stage_ids: parsePreQuoteStages,
  pre_quote_delays_hours: parsePreQuoteDelays,
  business_hours: (v) => normalizeBusinessHours(parseJsonish(v)) ?? structuredClone(DEFAULT_BUSINESS_HOURS),
  daily_cap: (v) => clampInt(v, 1, 200, D.daily_cap),
  min_gap_seconds: (v) => clampInt(v, 30, 900, D.min_gap_seconds),
  max_gap_seconds: (v, draft) => clampInt(v, draft.min_gap_seconds, 1800, Math.max(D.max_gap_seconds, draft.min_gap_seconds)),
  max_consecutive_errors: (v) => clampInt(v, 1, 10, D.max_consecutive_errors),
  allow_meta_text: (v) => boolOr(v, D.allow_meta_text),
  allow_baileys: (v) => boolOr(v, D.allow_baileys),
  template_id: parseTemplateId,
  max_silence_hours: (v) => clampInt(v, 24, 2160, D.max_silence_hours),
  sweep_interval_minutes: (v) => clampInt(v, 15, 1440, D.sweep_interval_minutes),
  max_drafts_per_sweep: (v) => clampInt(v, 1, 60, D.max_drafts_per_sweep),
  extra_instructions: parseExtraInstructions,
  optout_detection: (v) => boolOr(v, D.optout_detection),
  tracker_enabled: (v) => boolOr(v, D.tracker_enabled),
  tracker_config: (v) => parseTrackerConfig(v),
  wa_number: parseWaNumber,
};

type TrackerParser = (raw: unknown, fallback: any) => unknown;

function stageIdOr(value: unknown, fallback: string | null): string | null {
  if (value === null) return null;
  return typeof value === 'string' ? idOrNull(value) : fallback;
}

function idListOr(value: unknown, fallback: string[]): string[] {
  return Array.isArray(value) ? uniqueTrimmedStrings(value) : fallback;
}

function wordListOr(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  return uniqueTrimmedStrings(value).filter((w) => w.length <= 40).slice(0, 30);
}

function phoneListOr(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  const phones = value.map(digitsOnly).filter((d) => d.length >= 10 && d.length <= 13);
  return Array.from(new Set(phones)).slice(0, 50);
}

const TRACKER_PARSERS: Record<keyof TrackerConfig, TrackerParser> = {
  create_deal_on_inbound: boolOr,
  entry_stage_id: stageIdOr,
  contact_stage_id: stageIdOr,
  proposal_stage_id: stageIdOr,
  promote_to_contact_from: idListOr,
  promote_to_proposal_from: idListOr,
  quote_keywords: wordListOr,
  quote_exclusions: wordListOr,
  generic_pdf_is_quote: boolOr,
  count_bot_as_studio_reply: boolOr,
  recreate_after_lost: boolOr,
  skip_existing_customers: boolOr,
  ignored_phones: phoneListOr,
};

function parseTrackerConfig(raw: unknown): TrackerConfig {
  const source = parseJsonish(raw);
  const out = structuredClone(DEFAULT_TRACKER_CONFIG) as unknown as Record<string, unknown>;
  if (!isPlainObject(source)) return out as unknown as TrackerConfig;
  for (const key of Object.keys(TRACKER_PARSERS) as Array<keyof TrackerConfig>) {
    if (source[key] === undefined) continue;
    out[key] = TRACKER_PARSERS[key](source[key], out[key]);
  }
  return out as unknown as TrackerConfig;
}

const PAUSE_REASONS: readonly PauseReason[] = ['error_streak', 'manual'];
const BLOCK_CODES: readonly BlockCode[] = ['no_channel', 'meta_token_expired', 'meta_not_operational',
  'window_closed_no_template', 'baileys_disabled', 'baileys_offline', 'number_mismatch', 'template_invalid',
  'template_not_eligible', 'quality_not_green'];
const SWEEP_COUNTS = ['eligible', 'generated', 'auto_approved', 'ai_skipped', 'handoffs', 'already_drafted',
  'optouts_detected', 'housekept', 'errors'] as const;

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return allowed.includes(value as T) ? (value as T) : null;
}

function parseSweepSummary(value: unknown): SweepSummary | null {
  const source = parseJsonish(value);
  if (!isPlainObject(source)) return null;
  const summary: Record<string, unknown> = { finished_at: toIsoOrNull(source.finished_at) ?? '' };
  for (const key of SWEEP_COUNTS) summary[key] = Math.max(0, toInteger(source[key]) ?? 0);
  return summary as unknown as SweepSummary;
}

const STATE_PARSERS: Record<keyof FollowUpRuntimeState, (raw: unknown) => unknown> = {
  next_send_after: toIsoOrNull,
  consecutive_errors: (v) => Math.max(0, toInteger(v) ?? 0),
  paused_at: toIsoOrNull,
  paused_reason: (v) => oneOf(v, PAUSE_REASONS),
  last_error: textOrNull,
  last_block_code: (v) => oneOf(v, BLOCK_CODES),
  last_block_message: textOrNull,
  last_block_at: toIsoOrNull,
  last_sweep_at: toIsoOrNull,
  last_sweep_summary: parseSweepSummary,
  first_enabled_at: toIsoOrNull,
  external_ai_consent_at: toIsoOrNull,
  external_ai_consent_by: textOrNull,
};

function parseState(row: Record<string, unknown> | null): FollowUpRuntimeState {
  const state: Record<string, unknown> = {};
  for (const key of Object.keys(STATE_PARSERS) as Array<keyof FollowUpRuntimeState>) {
    state[key] = STATE_PARSERS[key](row ? row[key] : undefined);
  }
  return state as unknown as FollowUpRuntimeState;
}

export function parseCadenceConfig(row: Record<string, unknown> | null): { config: FollowUpConfig; state: FollowUpRuntimeState; exists: boolean } {
  const config = structuredClone(DEFAULT_FOLLOWUP_CONFIG);
  if (!row) return { config, state: parseState(null), exists: false };
  const target = config as unknown as Record<string, unknown>;
  for (const key of Object.keys(CONFIG_PARSERS) as Array<keyof FollowUpConfig>) {
    target[key] = CONFIG_PARSERS[key](row[key], config);
  }
  return { config, state: parseState(row), exists: true };
}

// Validação do PUT /config

type Check = { ok: true; value: unknown } | { ok: false; error: string; detail?: Record<string, string> };
interface ValidateContext { stages: StageRow[]; eligibleTemplateIds: Set<number>; confirmAuto: boolean; dedupeMigrationReady: boolean }
interface ValidationEnv { ctx: ValidateContext; stagesById: Map<string, StageRow> }
type FieldValidator = (value: unknown, draft: Record<string, unknown>, env: ValidationEnv) => Check;

const MSG = {
  boolean: 'Use ligado ou desligado.',
  mode: 'Modo inválido. Use aprovação ou automático.',
  autoConfirm: 'Confirme o modo automático: a IA passa a enviar sem revisão.',
  ladderList: 'Informe a lista de etapas da escada.',
  ladderMax: 'A escada tem no máximo 4 etapas.',
  ladderRepeat: 'A escada não pode repetir etapa.',
  ladderSales: 'Só etapas do funil de vendas entram na escada.',
  ladderClosed: 'Etapa final (ganho ou perdido) não entra na escada.',
  ladderOrder: 'As etapas da escada precisam seguir a ordem do funil.',
  delaysCount: 'Informe de 1 a 4 atrasos.',
  delaysRange: 'Cada atraso precisa ser um número inteiro de 1 a 720 horas.',
  afterLast: 'A etapa depois do último passo precisa ser uma etapa de venda aberta, fora da escada e depois dela no funil.',
  preQuoteList: 'Informe a lista de etapas antes do orçamento.',
  preQuoteMax: 'Antes do orçamento cabem no máximo 2 etapas.',
  preQuoteRepeat: 'As etapas antes do orçamento não podem se repetir.',
  preQuoteOpen: 'Antes do orçamento só entram etapas de venda abertas (nem ganho nem perdido).',
  preQuoteLadder: 'Uma etapa não pode estar ao mesmo tempo antes do orçamento e na escada.',
  preQuoteOrder: 'As etapas antes do orçamento precisam vir antes da 1ª etapa da escada no funil.',
  preQuoteDelaysCount: 'Informe 1 ou 2 atrasos para antes do orçamento.',
  hours: 'Horário comercial inválido. Confira fuso, dias, início, fim e feriados.',
  maxGap: 'O intervalo máximo precisa ser maior ou igual ao mínimo e de no máximo 1800 segundos.',
  dedupe: 'Aplique a migration 085 antes de enviar pelo QR.',
  template: 'Escolha um template de marketing aprovado com {{1}} (nome) e {{2}} (mensagem).',
  extraType: 'As instruções extras precisam ser texto.',
  extraLength: 'Use no máximo 1000 caracteres nas instruções extras.',
  extraHashes: 'Não use ### nas instruções extras.',
  waNumber: 'Número de WhatsApp inválido. Use de 10 a 13 dígitos, com DDD.',
  tracker: 'Configuração do funil automático inválida.',
  trackerStage: 'Escolha uma etapa de venda aberta.',
  trackerStageList: 'Use só etapas de venda abertas.',
  wordList: 'Use no máximo 30 palavras, cada uma com até 40 caracteres.',
  phoneList: 'Use no máximo 50 números, cada um com 10 a 13 dígitos.',
  config: 'Configuração inválida.',
} as const;

const CONFIG_WARNINGS = {
  noOutsideWindow: 'Sem template aprovado e com o QR desligado: fora da janela de 24h nada sai.',
  qr: 'O envio pelo QR usa cliente não oficial. Mantenha o teto diário baixo.',
  missingDelays: 'Passos sem atraso configurado ficam de fora.',
  firstStepOutside: 'Com o 1º passo em 24h ou mais, quase sempre fora da janela grátis: sai por template ou QR.',
} as const;

function pass(value: unknown): Check {
  return { ok: true, value };
}

function fail(error: string): Check {
  return { ok: false, error };
}

function booleanCheck(value: unknown): Check {
  return typeof value === 'boolean' ? pass(value) : fail(MSG.boolean);
}

function intCheck(min: number, max: number): FieldValidator {
  return (value) => {
    const n = toStrictInteger(value);
    return n !== null && n >= min && n <= max ? pass(n) : fail(`Use um número inteiro de ${min} a ${max}.`);
  };
}

function modeCheck(value: unknown): Check {
  return value === 'auto' || value === 'approval' ? pass(value) : fail(MSG.mode);
}

function ladderStageError(id: string, stagesById: Map<string, StageRow>): string | null {
  const stage = stagesById.get(id);
  if (!stage) return `Etapa não encontrada: ${id}.`;
  if (!isSalesStage(stage)) return MSG.ladderSales;
  if (isClosedStage(stage)) return MSG.ladderClosed;
  return null;
}

function strictlyIncreasing(values: number[]): boolean {
  return values.every((v, index) => index === 0 || v > values[index - 1]);
}

function ladderCheck(value: unknown, _draft: Record<string, unknown>, env: ValidationEnv): Check {
  if (!Array.isArray(value) || !value.every((id) => typeof id === 'string' && id.trim())) return fail(MSG.ladderList);
  const ids = value.map((id: string) => id.trim());
  if (ids.length > CADENCE_MAX_STEPS) return fail(MSG.ladderMax);
  if (new Set(ids).size !== ids.length) return fail(MSG.ladderRepeat);
  for (const id of ids) {
    const error = ladderStageError(id, env.stagesById);
    if (error) return fail(error);
  }
  const positions = ids.map((id) => positionOf(env.stagesById.get(id) as StageRow));
  return strictlyIncreasing(positions) ? pass(ids) : fail(MSG.ladderOrder);
}

function delaysCheck(value: unknown): Check {
  if (!Array.isArray(value) || value.length < 1 || value.length > CADENCE_MAX_STEPS) return fail(MSG.delaysCount);
  const delays = value.map(toStrictInteger);
  const valid = delays.every((n) => n !== null && n >= 1 && n <= 720);
  return valid ? pass(delays) : fail(MSG.delaysRange);
}

function lastLadderPosition(ladder: unknown, stagesById: Map<string, StageRow>): number {
  if (!Array.isArray(ladder)) return -Infinity;
  const positions = ladder.map((id) => stagesById.get(String(id).trim())).filter(isOpenSalesStage).map(positionOf);
  return positions.length ? Math.max(...positions) : -Infinity;
}

function afterLastCheck(value: unknown, draft: Record<string, unknown>, env: ValidationEnv): Check {
  if (value === null || value === '') return pass(null);
  if (typeof value !== 'string') return fail(MSG.afterLast);
  const id = value.trim();
  const stage = env.stagesById.get(id);
  const ladder = Array.isArray(draft.ladder_stage_ids) ? draft.ladder_stage_ids.map((s) => String(s).trim()) : [];
  if (!isOpenSalesStage(stage) || ladder.includes(id)) return fail(MSG.afterLast);
  return positionOf(stage) > lastLadderPosition(ladder, env.stagesById) ? pass(id) : fail(MSG.afterLast);
}

function draftIds(value: unknown): string[] {
  return Array.isArray(value) ? value.map((id) => String(id).trim()) : [];
}

function firstLadderPosition(ladder: string[], stagesById: Map<string, StageRow>): number {
  const positions = ladder.map((id) => stagesById.get(id)).filter(isOpenSalesStage).map(positionOf);
  return positions.length ? Math.min(...positions) : Infinity;
}

function preQuoteStageError(id: string, draft: Record<string, unknown>, env: ValidationEnv, limit: number): string | null {
  const stage = env.stagesById.get(id);
  if (!stage) return `Etapa não encontrada: ${id}.`;
  if (!isOpenSalesStage(stage)) return MSG.preQuoteOpen;
  const ladder = draftIds(draft.ladder_stage_ids);
  if (ladder.includes(id) || draft.after_last_stage_id === id) return MSG.preQuoteLadder;
  return positionOf(stage) < limit ? null : MSG.preQuoteOrder;
}

function preQuoteStagesCheck(value: unknown, draft: Record<string, unknown>, env: ValidationEnv): Check {
  if (!Array.isArray(value) || !value.every((id) => typeof id === 'string' && id.trim())) return fail(MSG.preQuoteList);
  const ids = value.map((id: string) => id.trim());
  if (ids.length > PRE_QUOTE_MAX_STEPS) return fail(MSG.preQuoteMax);
  if (new Set(ids).size !== ids.length) return fail(MSG.preQuoteRepeat);
  const limit = firstLadderPosition(draftIds(draft.ladder_stage_ids), env.stagesById);
  for (const id of ids) {
    const error = preQuoteStageError(id, draft, env, limit);
    if (error) return fail(error);
  }
  return pass(ids);
}

function preQuoteDelaysCheck(value: unknown): Check {
  if (!Array.isArray(value) || value.length < 1 || value.length > PRE_QUOTE_MAX_STEPS) return fail(MSG.preQuoteDelaysCount);
  const delays = value.map(toStrictInteger);
  const valid = delays.every((n) => n !== null && n >= 1 && n <= 720);
  return valid ? pass(delays) : fail(MSG.delaysRange);
}

function hoursCheck(value: unknown): Check {
  const hours = normalizeBusinessHours(value);
  return hours ? pass(hours) : fail(MSG.hours);
}

function maxGapCheck(value: unknown, draft: Record<string, unknown>): Check {
  const n = toStrictInteger(value);
  const min = toStrictInteger(draft.min_gap_seconds) ?? 30;
  return n !== null && n >= min && n <= 1800 ? pass(n) : fail(MSG.maxGap);
}

function allowBaileysCheck(value: unknown, _draft: Record<string, unknown>, env: ValidationEnv): Check {
  if (typeof value !== 'boolean') return fail(MSG.boolean);
  return value && !env.ctx.dedupeMigrationReady ? fail(MSG.dedupe) : pass(value);
}

function templateCheck(value: unknown, _draft: Record<string, unknown>, env: ValidationEnv): Check {
  if (value === null || value === '') return pass(null);
  const id = toStrictInteger(value);
  return id !== null && env.ctx.eligibleTemplateIds.has(id) ? pass(id) : fail(MSG.template);
}

function extraCheck(value: unknown): Check {
  if (value === null) return pass('');
  if (typeof value !== 'string') return fail(MSG.extraType);
  const text = value.trim();
  if (text.length > 1000) return fail(MSG.extraLength);
  return text.includes('###') ? fail(MSG.extraHashes) : pass(text);
}

function waNumberCheck(value: unknown): Check {
  if (value === null || value === '') return pass(null);
  if (typeof value !== 'string' && typeof value !== 'number') return fail(MSG.waNumber);
  const digits = parseWaNumber(value);
  return digits ? pass(digits) : fail(MSG.waNumber);
}

function trackerStageCheck(value: unknown, env: ValidationEnv): Check {
  if (value === null || value === '') return pass(null);
  const id = typeof value === 'string' ? value.trim() : '';
  return isOpenSalesStage(env.stagesById.get(id)) ? pass(id) : fail(MSG.trackerStage);
}

function trackerStageListCheck(value: unknown, env: ValidationEnv): Check {
  if (!Array.isArray(value) || !value.every((id) => typeof id === 'string')) return fail(MSG.trackerStageList);
  const ids = uniqueTrimmedStrings(value);
  return ids.every((id) => isOpenSalesStage(env.stagesById.get(id))) ? pass(ids) : fail(MSG.trackerStageList);
}

function wordListCheck(value: unknown): Check {
  if (!Array.isArray(value) || !value.every((w) => typeof w === 'string')) return fail(MSG.wordList);
  const words = uniqueTrimmedStrings(value);
  return words.length <= 30 && words.every((w) => w.length <= 40) ? pass(words) : fail(MSG.wordList);
}

function phoneListCheck(value: unknown): Check {
  if (!Array.isArray(value) || value.length > 50) return fail(MSG.phoneList);
  const phones = value.map((p) => (typeof p === 'string' || typeof p === 'number' ? parseWaNumber(p) : null));
  if (!phones.every((p) => p !== null)) return fail(MSG.phoneList);
  return pass(Array.from(new Set(phones as string[])));
}

const TRACKER_VALIDATORS: Array<[keyof TrackerConfig, (value: unknown, env: ValidationEnv) => Check]> = [
  ['create_deal_on_inbound', booleanCheck],
  ['entry_stage_id', trackerStageCheck],
  ['contact_stage_id', trackerStageCheck],
  ['proposal_stage_id', trackerStageCheck],
  ['promote_to_contact_from', trackerStageListCheck],
  ['promote_to_proposal_from', trackerStageListCheck],
  ['quote_keywords', wordListCheck],
  ['quote_exclusions', wordListCheck],
  ['generic_pdf_is_quote', booleanCheck],
  ['count_bot_as_studio_reply', booleanCheck],
  ['recreate_after_lost', booleanCheck],
  ['skip_existing_customers', booleanCheck],
  ['ignored_phones', phoneListCheck],
];

// Erro do funil vai em errors.tracker_config (1ª mensagem) e em errors['tracker_config.<campo>'].
function trackerCheck(value: unknown, _draft: Record<string, unknown>, env: ValidationEnv): Check {
  if (!isPlainObject(value)) return fail(MSG.tracker);
  const out: Record<string, unknown> = {};
  const detail: Record<string, string> = {};
  for (const [key, validate] of TRACKER_VALIDATORS) {
    const result = validate(value[key], env);
    if (result.ok) out[key] = result.value;
    else detail[`tracker_config.${key}`] = result.error;
  }
  const first = Object.values(detail)[0];
  return first ? { ok: false, error: first, detail } : pass(out);
}

const FIELD_VALIDATORS: Array<[keyof FollowUpConfig, FieldValidator]> = [
  ['enabled', booleanCheck],
  ['mode', modeCheck],
  ['ladder_stage_ids', ladderCheck],
  ['step_delays_hours', delaysCheck],
  ['after_last_stage_id', afterLastCheck],
  ['pre_quote_stage_ids', preQuoteStagesCheck],
  ['pre_quote_delays_hours', preQuoteDelaysCheck],
  ['business_hours', hoursCheck],
  ['daily_cap', intCheck(1, 200)],
  ['min_gap_seconds', intCheck(30, 900)],
  ['max_gap_seconds', maxGapCheck],
  ['max_consecutive_errors', intCheck(1, 10)],
  ['allow_meta_text', booleanCheck],
  ['allow_baileys', allowBaileysCheck],
  ['template_id', templateCheck],
  ['max_silence_hours', intCheck(24, 2160)],
  ['sweep_interval_minutes', intCheck(15, 1440)],
  ['max_drafts_per_sweep', intCheck(1, 60)],
  ['extra_instructions', extraCheck],
  ['optout_detection', booleanCheck],
  ['tracker_enabled', booleanCheck],
  ['tracker_config', trackerCheck],
  ['wa_number', waNumberCheck],
];

function mergePatch(current: FollowUpConfig, patch: Record<string, unknown>): Record<string, unknown> {
  const draft: Record<string, unknown> = { ...current, tracker_config: { ...current.tracker_config } };
  for (const [key] of FIELD_VALIDATORS) {
    if (key !== 'tracker_config' && patch[key] !== undefined) draft[key] = patch[key];
  }
  const tracker = patch.tracker_config;
  if (tracker !== undefined) draft.tracker_config = isPlainObject(tracker) ? { ...current.tracker_config, ...tracker } : tracker;
  return draft;
}

function configWarnings(c: FollowUpConfig): string[] {
  const warnings: string[] = [];
  if (c.template_id === null && !c.allow_baileys) warnings.push(CONFIG_WARNINGS.noOutsideWindow);
  if (c.allow_baileys) warnings.push(CONFIG_WARNINGS.qr);
  if (c.step_delays_hours.length < c.ladder_stage_ids.length) warnings.push(CONFIG_WARNINGS.missingDelays);
  if ((c.step_delays_hours[0] ?? 0) >= 24) warnings.push(CONFIG_WARNINGS.firstStepOutside);
  return warnings;
}

export function validateConfigInput(current: FollowUpConfig, patch: unknown,
  ctx: { stages: StageRow[]; eligibleTemplateIds: Set<number>; confirmAuto: boolean; dedupeMigrationReady: boolean }):
  { ok: true; config: FollowUpConfig; warnings: string[] } | { ok: false; errors: Record<string, string>; autoConfirmRequired: boolean } {
  if (!isPlainObject(patch)) return { ok: false, errors: { config: MSG.config }, autoConfirmRequired: false };
  const draft = mergePatch(current, patch);
  const env: ValidationEnv = { ctx, stagesById: indexStages(ctx.stages) };
  const errors: Record<string, string> = {};
  const config: Record<string, unknown> = {};
  for (const [field, validate] of FIELD_VALIDATORS) {
    const result = validate(draft[field], draft, env);
    if (result.ok) config[field] = result.value;
    else Object.assign(errors, { [field]: result.error }, result.detail);
  }
  const autoConfirmRequired = draft.mode === 'auto' && current.mode !== 'auto' && !ctx.confirmAuto;
  if (autoConfirmRequired && !errors.mode) errors.mode = MSG.autoConfirm;
  if (Object.keys(errors).length) return { ok: false, errors, autoConfirmRequired };
  const valid = config as unknown as FollowUpConfig;
  return { ok: true, config: valid, warnings: configWarnings(valid) };
}

// Sugestões para conta nova

const LADDER_START_NAME = /or[cç]amento|proposta/i;
const CONTACT_NAME = /conversa\s*iniciada|contato\s*feito/i;
const PROPOSAL_NAME = /or[cç]amento.*enviad|proposta/i;

function idHasBase(id: string, base: string): boolean {
  return id === base || id.startsWith(`${base}-`);
}

function openSalesStagesSorted(stages: StageRow[]): StageRow[] {
  return (stages || []).filter(isOpenSalesStage).sort((a, b) => positionOf(a) - positionOf(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function suggestLadder(stages: StageRow[]): { ladder_stage_ids: string[]; step_delays_hours: number[]; after_last_stage_id: string | null } {
  const open = openSalesStagesSorted(stages);
  const start = open.findIndex((s) => LADDER_START_NAME.test(s.name || '') || idHasBase(s.id, 'proposal'));
  // Sem etapa de orçamento: escada vazia, mas os atrasos padrão continuam válidos para a gaveta.
  if (start < 0) return { ladder_stage_ids: [], step_delays_hours: [...DEFAULT_STEP_DELAYS_HOURS], after_last_stage_id: null };
  const ladder = open.slice(start, start + CADENCE_MAX_STEPS).map((s) => s.id);
  return {
    ladder_stage_ids: ladder,
    step_delays_hours: DEFAULT_STEP_DELAYS_HOURS.slice(0, ladder.length),
    after_last_stage_id: open[start + ladder.length]?.id ?? null,
  };
}

// Antes do orçamento: a etapa de contato do rastreador, quando existe e vem antes da escada sugerida.
export function suggestPreQuote(stages: StageRow[]): { pre_quote_stage_ids: string[]; pre_quote_delays_hours: number[] } {
  const delays = [...DEFAULT_PRE_QUOTE_DELAYS_HOURS];
  const contactId = suggestTrackerStages(stages).contact_stage_id;
  const contact = contactId ? indexStages(stages).get(contactId) : undefined;
  if (!contact) return { pre_quote_stage_ids: [], pre_quote_delays_hours: delays };
  const ladder = suggestLadder(stages).ladder_stage_ids;
  const limit = firstLadderPosition(ladder, indexStages(stages));
  const fits = !ladder.includes(contact.id) && positionOf(contact) < limit;
  return { pre_quote_stage_ids: fits ? [contact.id] : [], pre_quote_delays_hours: delays };
}

export function suggestTrackerStages(stages: StageRow[]): { entry_stage_id: string | null; contact_stage_id: string | null; proposal_stage_id: string | null } {
  const open = openSalesStagesSorted(stages);
  const contact = open.find((s) => CONTACT_NAME.test(s.name || '') || idHasBase(s.id, 'contact'));
  const proposal = open.find((s) => PROPOSAL_NAME.test(s.name || '') || idHasBase(s.id, 'proposal'));
  return {
    entry_stage_id: firstOpenSalesStage(stages || [])?.id ?? null,
    contact_stage_id: contact?.id ?? null,
    proposal_stage_id: proposal?.id ?? null,
  };
}

// Escada e rampa

export function stepCount(c: FollowUpConfig): number {
  return Math.min(c.ladder_stage_ids.length, c.step_delays_hours.length, CADENCE_MAX_STEPS);
}

export function stepForStage(stageId: string, c: FollowUpConfig): FollowUpStep | null {
  const index = c.ladder_stage_ids.indexOf(stageId);
  return index >= 0 && index < stepCount(c) ? ((index + 1) as FollowUpStep) : null;
}

export function nextStageAfterStep(step: FollowUpStep, c: FollowUpConfig): string | null {
  return step < stepCount(c) ? c.ladder_stage_ids[step] : c.after_last_stage_id ?? null;
}

export function delayHoursForStep(step: FollowUpStep, c: FollowUpConfig): number {
  return Number(c.step_delays_hours[step - 1]) || DEFAULT_STEP_DELAYS_HOURS[step - 1] || DEFAULT_STEP_DELAYS_HOURS[DEFAULT_STEP_DELAYS_HOURS.length - 1];
}

// Trilha antes do orçamento: 0 quando não há etapa escolhida.
export function preQuoteStepCount(c: FollowUpConfig): number {
  const stages = Array.isArray(c.pre_quote_stage_ids) ? c.pre_quote_stage_ids.length : 0;
  const delays = Array.isArray(c.pre_quote_delays_hours) ? c.pre_quote_delays_hours.length : 0;
  return stages ? Math.min(delays, PRE_QUOTE_MAX_STEPS) : 0;
}

export function preQuoteDelayHours(step: FollowUpStep, c: FollowUpConfig): number {
  const list = Array.isArray(c.pre_quote_delays_hours) ? c.pre_quote_delays_hours : [];
  const fallback = DEFAULT_PRE_QUOTE_DELAYS_HOURS;
  return Number(list[step - 1]) || fallback[step - 1] || fallback[fallback.length - 1];
}

export function trackForStage(stageId: string, c: FollowUpConfig): FollowUpTrack | null {
  if (stepForStage(stageId, c) !== null) return 'ladder';
  const preQuote = preQuoteStepCount(c) > 0 && c.pre_quote_stage_ids.includes(stageId);
  return preQuote ? 'pre_quote' : null;
}

export function trackStepCount(track: FollowUpTrack, c: FollowUpConfig): number {
  return track === 'pre_quote' ? preQuoteStepCount(c) : stepCount(c);
}

// Próximo toque antes do orçamento: toques já enviados no episódio + 1; null quando acabaram.
export function preQuoteStepFor(sentInEpisode: number, c: FollowUpConfig): FollowUpStep | null {
  const next = Math.max(0, Math.floor(Number(sentInEpisode) || 0)) + 1;
  return next <= preQuoteStepCount(c) ? (next as FollowUpStep) : null;
}

// Toques antes do orçamento enviados para o telefone depois da última fala do cliente.
export function preQuoteSentInEpisode(tasks: CadenceTaskLite[], phoneKey: string, lastCustomerAt: string | null): number {
  const customerMs = toMs(lastCustomerAt) ?? -Infinity;
  return tasks.filter((t) => t.track === 'pre_quote' && t.status === 'sent' && taskPhoneKey(t) === phoneKey
    && sentAtMs(t) > customerMs).length;
}

// A trilha antes do orçamento nunca move o card.
export function advanceTargetFor(task: { track?: FollowUpTrack | null; step: FollowUpStep }, c: FollowUpConfig): string | null {
  return task.track === 'pre_quote' ? null : nextStageAfterStep(task.step, c);
}

// A rampa de 14 dias protege o número quando a cadência envia pelo QR (cliente
// não oficial, risco de bloqueio). Pela API oficial a própria Meta limita o
// volume, então vale o teto configurado desde o primeiro dia (pedido do dono).
export function effectiveDailyCap(config: FollowUpConfig, state: FollowUpRuntimeState, now: Date): { cap: number; warmupUntil: string | null } {
  const firstEnabled = toMs(state.first_enabled_at);
  if (!config.allow_baileys || firstEnabled === null) return { cap: config.daily_cap, warmupUntil: null };
  const until = firstEnabled + WARMUP_DAYS * DAY_MS;
  if (now.getTime() >= until) return { cap: config.daily_cap, warmupUntil: null };
  return { cap: Math.min(config.daily_cap, WARMUP_DAILY_CAP), warmupUntil: new Date(until).toISOString() };
}

// Silêncio e seleção

// Última fala do estúdio: visível (wa_messages ou legado) ou invisível (IA oficial,
// só status). É invisível quando o status veio mais de 5s depois da visível.
export function studioTurn(a: Pick<DealActivity, 'lastStudioAt' | 'lastInvisibleOutAt'>): { at: Date; invisible: boolean } | null {
  const visible = toMs(a.lastStudioAt);
  const invisible = toMs(a.lastInvisibleOutAt);
  if (visible === null && invisible === null) return null;
  const at = Math.max(visible ?? -Infinity, invisible ?? -Infinity);
  const isInvisible = invisible !== null && (visible === null || invisible > visible + CLOCK_TOLERANCE_MS);
  return { at: new Date(at), invisible: isInvisible };
}

export function activityFromRpcRow(row: Record<string, unknown>): DealActivity {
  const contactPhone = String(row.contact_phone ?? '');
  return {
    dealId: Number(row.deal_id),
    stage: String(row.stage ?? ''),
    contactName: textOrNull(row.contact_name),
    contactPhone,
    phoneKey: phoneKeyOf(textOrNull(row.phone_key), contactPhone),
    stageEnteredAt: toIsoOrNull(row.stage_entered_at),
    lastStudioAt: toIsoOrNull(row.last_studio_at),
    lastStudioType: textOrNull(row.last_studio_type),
    lastStudioBody: textOrNull(row.last_studio_body),
    lastStudioMessageId: textOrNull(row.last_studio_message_id),
    lastCustomerAt: toIsoOrNull(row.last_customer_at),
    lastCustomerReactionAt: toIsoOrNull(row.last_customer_reaction_at),
    lastInvisibleOutAt: toIsoOrNull(row.last_invisible_out_at),
    invisibleRead: row.invisible_read === true,
    needsHuman: row.needs_human === true,
    alreadyCustomer: row.already_customer === true,
  };
}

interface SelectContext {
  config: FollowUpConfig; stagesById: Map<string, StageRow>; nowMs: number; tasks: CadenceTaskLite[];
  liveDeals: Set<number>; livePhones: Set<string>; episodeKeys: Set<string>; lastSentByPhone: Map<string, CadenceTaskLite>;
  liveLegacyDealIds: Set<number>; optoutKeys: Set<string>;
}

interface DealEval {
  a: DealActivity; phoneKey: string; track: FollowUpTrack | null; step: FollowUpStep | null; exhausted: boolean;
  turn: { at: Date; invisible: boolean } | null; turnMs: number; customerMs: number | null; silenceHours: number; delayHours: number;
}

function taskPhoneKey(task: Pick<CadenceTaskLite, 'phone' | 'phone_key'>): string {
  return phoneKeyOf(task.phone_key, task.phone);
}

function trackOf(task: Pick<CadenceTaskLite, 'track'>): FollowUpTrack {
  return task.track === 'pre_quote' ? 'pre_quote' : 'ladder';
}

// O episódio é por trilha: um silêncio que começou antes do orçamento não impede a escada.
function episodeKey(track: FollowUpTrack, phoneKey: string, basisMs: number): string {
  return `${track}:${phoneKey}:${new Date(basisMs).toISOString()}`;
}

function sentAtMs(task: CadenceTaskLite): number {
  return toMs(task.sent_at) ?? toMs(task.created_at) ?? -Infinity;
}

function indexTask(ctx: SelectContext, task: CadenceTaskLite): void {
  const key = taskPhoneKey(task);
  const basisMs = toMs(task.basis_at);
  if (basisMs !== null) ctx.episodeKeys.add(episodeKey(trackOf(task), key, basisMs));
  if (LIVE_CADENCE_STATUSES.includes(task.status)) {
    ctx.liveDeals.add(Number(task.deal_id));
    if (key) ctx.livePhones.add(key);
  }
  if (trackOf(task) !== 'ladder') return;
  const previous = ctx.lastSentByPhone.get(key);
  if (task.status === 'sent' && (!previous || sentAtMs(task) > sentAtMs(previous))) ctx.lastSentByPhone.set(key, task);
}

function buildSelectContext(i: SelectInput): SelectContext {
  const ctx: SelectContext = {
    config: i.config, stagesById: indexStages(i.stages), nowMs: i.now.getTime(), tasks: i.cadenceTasks,
    liveDeals: new Set(), livePhones: new Set(), episodeKeys: new Set(), lastSentByPhone: new Map(),
    liveLegacyDealIds: i.liveLegacyDealIds, optoutKeys: i.optoutKeys,
  };
  for (const task of i.cadenceTasks) indexTask(ctx, task);
  return ctx;
}

interface TrackStep { step: FollowUpStep | null; exhausted: boolean; delayHours: number }

// Toques acabados ficam no último passo com exhausted, para cair em step_already_sent.
function preQuoteTrackStep(a: DealActivity, phoneKey: string, ctx: SelectContext): TrackStep {
  const sent = preQuoteSentInEpisode(ctx.tasks, phoneKey, a.lastCustomerAt);
  const next = preQuoteStepFor(sent, ctx.config);
  const step = next ?? (preQuoteStepCount(ctx.config) as FollowUpStep);
  return { step, exhausted: next === null, delayHours: preQuoteDelayHours(step, ctx.config) };
}

function trackStepFor(track: FollowUpTrack | null, a: DealActivity, phoneKey: string, ctx: SelectContext): TrackStep {
  if (track === 'pre_quote') return preQuoteTrackStep(a, phoneKey, ctx);
  const step = track === 'ladder' ? stepForStage(a.stage, ctx.config) : null;
  return { step, exhausted: false, delayHours: step === null ? Infinity : delayHoursForStep(step, ctx.config) };
}

function evaluateActivity(a: DealActivity, ctx: SelectContext): DealEval {
  const track = trackForStage(a.stage, ctx.config);
  const phoneKey = phoneKeyOf(a.phoneKey, a.contactPhone);
  const turn = studioTurn(a);
  const turnMs = turn ? turn.at.getTime() : NaN;
  return {
    a, track, ...trackStepFor(track, a, phoneKey, ctx), turn, turnMs, phoneKey,
    customerMs: toMs(a.lastCustomerAt),
    silenceHours: (ctx.nowMs - turnMs) / HOUR_MS,
  };
}

function stepAlreadySent(d: DealEval, ctx: SelectContext): boolean {
  if (d.track === 'pre_quote') return d.exhausted;
  const last = ctx.lastSentByPhone.get(d.phoneKey);
  if (!last || d.step === null) return false;
  return sentAtMs(last) > (d.customerMs ?? -Infinity) && Number(last.step) >= d.step;
}

// Ordem importa: o primeiro motivo que casar é o registrado.
const CHECKS: Array<[SkipReason, (d: DealEval, ctx: SelectContext) => boolean]> = [
  ['closed_stage', (d, ctx) => isClosedStage(ctx.stagesById.get(d.a.stage))],
  ['stage_not_in_ladder', (d) => d.track === null || d.step === null],
  ['already_customer', (d) => d.a.alreadyCustomer],
  ['optout', (d, ctx) => ctx.optoutKeys.has(d.phoneKey)],
  ['needs_human', (d) => d.a.needsHuman],
  ['live_cadence_task', (d, ctx) => ctx.liveDeals.has(d.a.dealId) || ctx.livePhones.has(d.phoneKey)],
  ['live_legacy_task', (d, ctx) => ctx.liveLegacyDealIds.has(d.a.dealId)],
  ['no_studio_turn', (d) => d.turn === null],
  ['customer_spoke_last', (d) => d.customerMs !== null && d.customerMs >= d.turnMs],
  ['too_old', (d, ctx) => d.silenceHours > ctx.config.max_silence_hours],
  ['too_soon', (d) => d.silenceHours < d.delayHours],
  ['episode_done', (d, ctx) => ctx.episodeKeys.has(episodeKey(d.track ?? 'ladder', d.phoneKey, d.turnMs))],
  ['step_already_sent', stepAlreadySent],
];

function evaluateDeal(d: DealEval, ctx: SelectContext): SkipReason | null {
  const hit = CHECKS.find(([, test]) => test(d, ctx));
  return hit ? hit[0] : null;
}

function buildEligible(d: DealEval, ctx: SelectContext): EligibleDeal {
  const step = d.step as FollowUpStep;
  const track = d.track ?? 'ladder';
  const invisible = !!d.turn?.invisible;
  const reactionMs = toMs(d.a.lastCustomerReactionAt);
  return {
    dealId: d.a.dealId, track, step, stageId: d.a.stage, nextStageId: advanceTargetFor({ track, step }, ctx.config),
    basisAt: new Date(d.turnMs).toISOString(),
    basisMessageId: invisible ? null : d.a.lastStudioMessageId,
    dueAt: new Date(d.turnMs + d.delayHours * HOUR_MS).toISOString(),
    phoneKey: d.phoneKey, contactPhone: d.a.contactPhone, contactName: d.a.contactName,
    invisibleBasis: invisible,
    invisibleRead: invisible && d.a.invisibleRead,
    silenceHours: d.silenceHours,
    lastCustomerAt: d.a.lastCustomerAt,
    customerReactedAfterBasis: reactionMs !== null && reactionMs > d.turnMs,
  };
}

function byStageEnteredDesc(a: DealActivity, b: DealActivity): number {
  const left = toMs(a.stageEnteredAt) ?? -Infinity;
  const right = toMs(b.stageEnteredAt) ?? -Infinity;
  if (left !== right) return right > left ? 1 : -1;
  return b.dealId - a.dealId;
}

function byDueAtAsc(a: EligibleDeal, b: EligibleDeal): number {
  return Date.parse(a.dueAt) - Date.parse(b.dueAt) || a.dealId - b.dealId;
}

export function selectEligibleDeals(i: SelectInput): { eligible: EligibleDeal[]; skipped: Array<{ dealId: number; reason: SkipReason }> } {
  if (!i.config.enabled || stepCount(i.config) + preQuoteStepCount(i.config) === 0) {
    return { eligible: [], skipped: i.activities.map((a) => ({ dealId: a.dealId, reason: 'disabled' as SkipReason })) };
  }
  const ctx = buildSelectContext(i);
  const eligible: EligibleDeal[] = [];
  const skipped: Array<{ dealId: number; reason: SkipReason }> = [];
  const selectedPhones = new Set<string>();
  for (const activity of [...i.activities].sort(byStageEnteredDesc)) {
    const d = evaluateActivity(activity, ctx);
    const reason = evaluateDeal(d, ctx) ?? (selectedPhones.has(d.phoneKey) ? 'duplicate_phone' : null);
    if (reason) {
      skipped.push({ dealId: activity.dealId, reason });
      continue;
    }
    selectedPhones.add(d.phoneKey);
    eligible.push(buildEligible(d, ctx));
  }
  return { eligible: eligible.sort(byDueAtAsc), skipped };
}

// Faxina das tarefas vivas

export function customerSpokeAfter(basisAtIso: string, lastCustomerAt: string | null): boolean {
  const customer = toMs(lastCustomerAt);
  if (customer === null) return false;
  return customer > (toMs(basisAtIso) ?? -Infinity) + CLOCK_TOLERANCE_MS;
}

function studioSpokeAfter(basisAtIso: string, a: Pick<DealActivity, 'lastStudioAt' | 'lastInvisibleOutAt'>): boolean {
  const turn = studioTurn(a);
  if (!turn) return false;
  return turn.at.getTime() > (toMs(basisAtIso) ?? -Infinity) + CLOCK_TOLERANCE_MS;
}

interface HousekeepEnv { optoutKeys: Set<string> }

const HOUSEKEEP_STATUSES: readonly CadenceStatus[] = ['draft', 'approved', 'blocked'];

const HOUSEKEEP_RULES: Array<[CancelReason, (t: CadenceTaskLite, a: DealActivity, env: HousekeepEnv) => boolean]> = [
  ['stage_changed', (t, a) => a.stage !== t.stage_id],
  ['already_customer', (_t, a) => a.alreadyCustomer],
  ['optout', (t, a, env) => env.optoutKeys.has(taskPhoneKey(t)) || env.optoutKeys.has(phoneKeyOf(a.phoneKey, a.contactPhone))],
  ['needs_human', (_t, a) => a.needsHuman],
  ['customer_replied', (t, a) => customerSpokeAfter(t.basis_at, a.lastCustomerAt)],
  ['studio_spoke', (t, a) => studioSpokeAfter(t.basis_at, a)],
];

function housekeepReason(task: CadenceTaskLite, activity: DealActivity | undefined, env: HousekeepEnv & { truncated: boolean }): CancelReason | null {
  if (!HOUSEKEEP_STATUSES.includes(task.status)) return null;
  // Lista truncada: sumir da lista não prova que o deal saiu da escada.
  if (!activity) return env.truncated ? null : 'stage_changed';
  const hit = HOUSEKEEP_RULES.find(([, test]) => test(task, activity, env));
  return hit ? hit[0] : null;
}

export function housekeepLiveTasks(i: { tasks: CadenceTaskLite[]; activities: DealActivity[]; stages: StageRow[];
  optoutKeys: Set<string>; truncated: boolean }): Array<{ id: number; reason: CancelReason }> {
  const byDeal = new Map(i.activities.map((a) => [Number(a.dealId), a]));
  const out: Array<{ id: number; reason: CancelReason }> = [];
  for (const task of i.tasks) {
    const reason = housekeepReason(task, byDeal.get(Number(task.deal_id)), i);
    if (reason) out.push({ id: task.id, reason });
  }
  return out;
}

export function initialStatusFor(mode: FollowUpMode, e: Pick<EligibleDeal, 'invisibleBasis'>, warnings: DraftWarning[],
  opts: { manual: boolean; enabled: boolean }): { status: 'draft' | 'approved'; approved_by: 'auto' | null } {
  const autoApprove = mode === 'auto' && !opts.manual && opts.enabled && !e.invisibleBasis && warnings.length === 0;
  return autoApprove ? { status: 'approved', approved_by: 'auto' } : { status: 'draft', approved_by: null };
}

// Envio

interface SendEnv { config: FollowUpConfig; state: FollowUpRuntimeState; now: Date }
type SendRule = (task: CadenceTaskRow, snap: SendSnapshot, env: SendEnv) => SendDecision | null;

function cancel(reason: CancelReason): SendDecision {
  return { action: 'cancel', reason };
}

function dealClosed(snap: SendSnapshot): boolean {
  const deal = snap.deal;
  if (!deal) return true;
  if (deal.converted || deal.converted_job_id != null) return true;
  return isClosedStage((snap.stages || []).find((s) => s.id === deal.stage));
}

function approvalIsStale(task: CadenceTaskRow, now: Date): boolean {
  const approvedAt = toMs(task.approved_at ?? task.updated_at);
  if (approvedAt === null) return true;
  return now.getTime() - approvedAt > STALE_APPROVAL_HOURS * HOUR_MS;
}

// Cancelamentos vêm antes das esperas: um motivo definitivo nunca fica parado na fila.
const SEND_RULES: SendRule[] = [
  (_t, s) => (s.deal ? null : cancel('deal_missing')),
  (_t, s) => (dealClosed(s) ? cancel('deal_closed') : null),
  (_t, s) => (s.alreadyCustomer ? cancel('already_customer') : null),
  (_t, s) => (s.optedOut ? cancel('optout') : null),
  (t, s) => (s.deal?.stage !== t.stage_id ? cancel('stage_changed') : null),
  // Etapa tirada da escada (ou trilha desligada) depois da aprovação: vale a config salva agora.
  (t, _s, env) => (trackForStage(t.stage_id, env.config) === null ? cancel('stage_changed') : null),
  (t, s) => (customerSpokeAfter(t.basis_at, s.lastCustomerAt) ? cancel('customer_replied') : null),
  (t, s) => (studioSpokeAfter(t.basis_at, s) ? cancel('studio_spoke') : null),
  (_t, s) => (s.needsHuman ? cancel('needs_human') : null),
  (_t, _s, env) => (env.config.enabled ? null : { action: 'hold', reason: 'disabled' }),
  (_t, _s, env) => (env.state.paused_at ? { action: 'hold', reason: 'paused' } : null),
  (_t, _s, env) => (isWithinBusinessHours(env.now, env.config.business_hours) ? null : { action: 'hold', reason: 'outside_hours' }),
  // Aprovada pela varredura no modo automático, mas o dono voltou para aprovação: ninguém aprovou esta.
  (t, _s, env) => (t.approved_by === 'auto' && env.config.mode !== 'auto' ? { action: 'review', reason: 'auto_mode_off' } : null),
  (t, _s, env) => (approvalIsStale(t, env.now) ? { action: 'stale', reason: 'stale_approval' } : null),
];

export function shouldCancelBeforeSend(task: CadenceTaskRow, snap: SendSnapshot, config: FollowUpConfig, state: FollowUpRuntimeState, now: Date): SendDecision {
  const env: SendEnv = { config, state, now };
  for (const rule of SEND_RULES) {
    const decision = rule(task, snap, env);
    if (decision) return decision;
  }
  return { action: 'send' };
}

// Lease vencido: só dá como enviada se há prova gravada de pelo menos um balão aceito.
export function resolveExpiredLease(task: CadenceTaskRow): 'mark_sent' | 'block' {
  const ids = task.generation_meta?.delivery?.message_ids;
  return Array.isArray(ids) && ids.length > 0 ? 'mark_sent' : 'block';
}

export function nextErrorState(consecutive: number, outcome: 'ok' | 'error', threshold: number): { consecutive: number; pause: boolean } {
  if (outcome === 'ok') return { consecutive: 0, pause: false };
  const next = Math.max(0, Math.floor(Number(consecutive) || 0)) + 1;
  return { consecutive: next, pause: next >= threshold };
}

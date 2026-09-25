// Rotas HTTP da cadência de follow-up (/api/followups). O banco é SEMPRE o client
// service_role recebido em deps, com user_id explícito em toda consulta: a tabela
// scheduled_followups tem RLS sem policy e o req.supabase do dono leria vazio.
// Canal, templates e envio ficam atrás de deps.services (followup-runtime.ts).
import type { Express, NextFunction, Request, RequestHandler, Response } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  ApproveAllResult, CadenceGenerationMeta, CadenceStatus, CadenceTaskRow, ChannelHealth, DealFollowUpState, FixedTemplateInfo,
  FollowUpConfig, FollowUpConfigResponse, FollowUpDraftItem, FollowUpErrorBody, FollowUpErrorCode, FollowUpOptOut,
  FollowUpOverview, FollowUpRuntimeState, FollowUpServices, FollowUpStep, FollowUpTrack, ForecastInput, ForecastResult,
  OverviewPauseReason, PreviewMessage, QueueTab, ReconcileApplyRequest, RegenerateResult, SweepDryRun, SweepRequest,
  SweepState, SweepSummary,
} from './src/features/followups/types.js';
import { CUSTOMER_NON_TURN_TYPES, DEFAULT_FOLLOWUP_CONFIG, FOLLOWUP_STEPS, LIVE_CADENCE_STATUSES } from './src/features/followups/types.js';
import {
  customerSpokeAfter, delayHoursForStep, effectiveDailyCap, parseCadenceConfig, preQuoteDelayHours, preQuoteSentInEpisode,
  preQuoteStepCount, preQuoteStepFor, stepForStage, suggestLadder, suggestPreQuote, suggestTrackerStages, trackForStage,
  trackStepCount, validateConfigInput,
} from './followup-cadence.js';
import { firstName } from './followup-draft.js';
import { fixedRefFor, fixedSteps, fixedTemplatesInfo, fixedTextFor, renderFixedMessage } from './followup-fixed.js';
import type { CadenceTaskLite } from './followup-cadence.js';
import type { StageRow } from './lib/stage-rules.js';
import { isSalesStage } from './lib/stage-rules.js';
import { brazilianPhoneVariants, canonicalPhoneKey, digitsOnly, normalizeBrazilianPhone13 } from './lib/br-phone.js';
import { localDayStartUtc } from './lib/business-hours.js';
import { createDashboardLoader } from './followup-dashboard.js';

export interface FollowUpRouteDeps { db: SupabaseClient; requireAuth: RequestHandler; requirePermission: (module: string) => RequestHandler;
  requireOwnerOrPlatformAdmin: RequestHandler; denyProductionOnly: RequestHandler; services: FollowUpServices; now?: () => Date }

export interface FollowUpRouteCtx {
  userId: string; realUserId: string; isMember: boolean; isPlatformAdmin: boolean; isImpersonating: boolean;
  memberPermissions: Record<string, unknown> | null;
}

export interface QueueQuery {
  status: QueueTab; step: FollowUpStep | null; track: FollowUpTrack | null; stage_id: string | null; deal_id: number | null; search: string;
  offset: number; limit: number; preview: number;
}

export interface ApproverLabels { ownerId: string; viewerId: string; members: Map<string, string> }

// Só colunas sem valor em R$: a fila nunca mostra dinheiro.
export interface DealLite {
  id: number; title: string | null; contact_name: string | null; contact_phone: string | null; stage: string | null;
  temperature: string | null; assigned_to: string | null; converted?: boolean | null; converted_job_id?: number | null;
}

export class FollowUpRouteError extends Error {
  status: number;
  code: FollowUpErrorCode;
  fields: Record<string, string> | undefined;

  constructor(message: string, status = 400, code: FollowUpErrorCode = 'INTERNAL', fields?: Record<string, string>) {
    super(message);
    this.name = 'FollowUpRouteError';
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

const BASE = '/api/followups';
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const MANUAL_SWEEP_GAP_MS = 10 * 60_000;
const OVERVIEW_TTL_MS = 10_000;
const APPROVE_ALL_MAX = 200;
const APPROVE_POOL = 6;
const DEFAULT_PREVIEW = 6;

const LIVE: readonly CadenceStatus[] = LIVE_CADENCE_STATUSES;
const EDITABLE: CadenceStatus[] = ['draft', 'approved', 'blocked'];
const APPROVABLE: CadenceStatus[] = ['draft', 'blocked'];
const QUEUE_TABS: readonly QueueTab[] = ['draft', 'approved', 'blocked', 'sent_today', 'skipped', 'cancelled'];
const CUSTOMER_TURN_FILTER = `type.is.null,type.not.in.(${CUSTOMER_NON_TURN_TYPES.join(',')})`;
const TASK_COLUMNS = '*';
const DEAL_COLUMNS = 'id, title, contact_name, contact_phone, stage, temperature, assigned_to, converted, converted_job_id';
const STAGE_COLUMNS = 'id, name, position, is_final, is_won, process_id, auto_follow_up_enabled';
const MIGRATION_CODES = new Set(['42P01', '42703', '42883', 'PGRST202', 'PGRST204', 'PGRST205']);
const CONTROL_KEYS = new Set(['confirm_auto', 'disable_legacy_on_ladder', 'consent_to_external_ai']);
const EDITABLE_KEYS = Object.keys(DEFAULT_FOLLOWUP_CONFIG) as Array<keyof FollowUpConfig>;

const MSG = {
  forbiddenApprover: 'Peça ao dono da conta para liberar a aprovação de follow-ups.',
  consent: 'O dono da conta precisa autorizar o envio das conversas para a IA (OpenAI) antes de gerar rascunhos.',
  migration: 'Falta aplicar a migration 083 no Supabase.',
  internal: 'Não foi possível concluir agora. Tente de novo em instantes.',
  channelsUnknown: 'Não foi possível conferir os canais agora.',
  sweepRunning: 'A IA já está lendo as conversas. Espere terminar.',
  regenRunning: 'Este rascunho já está sendo escrito de novo. Espere terminar.',
  sweepTooSoon: 'A última leitura foi há poucos minutos. Espere um pouco para gerar de novo.',
  notFound: 'Follow-up não encontrado.',
  dealNotFound: 'Negócio não encontrado.',
  optOutNotFound: 'Contato bloqueado não encontrado.',
  disabled: 'Ligue os follow-ups da IA antes de aprovar.',
  notApprovable: 'Só dá para aprovar um rascunho ou um item com problema.',
  notEditable: 'Este follow-up não pode mais ser alterado.',
  alreadyClaimed: 'Este follow-up já está sendo enviado.',
  stageChanged: 'O card mudou de etapa. Gere de novo.',
  optedOut: 'Este contato pediu para não receber mensagens.',
  conversationChanged: 'Chegou mensagem nova depois deste rascunho. Gere de novo.',
  textEmpty: 'Escreva a mensagem antes de salvar.',
  textLong: 'Use no máximo 1000 caracteres na mensagem.',
  textHashes: 'Não use ### na mensagem.',
  instructionLong: 'Use no máximo 500 caracteres na instrução.',
  instructionHashes: 'Não use ### na instrução.',
  approvedNoChannel: 'Aprovado, mas nenhum canal está disponível agora. Se sair como template, volta para revisão.',
  approvedTemplate: 'Vai sair como template aprovado. Confira o texto final no card.',
  supportMode: 'No modo suporte não dá para ligar os envios nem o modo automático.',
  autoConfirm: 'Confirme o modo automático: a IA passa a enviar sem revisão.',
  configInvalid: 'Confira os campos destacados.',
  regenLimit: 'Este rascunho já foi gerado de novo 5 vezes.',
  regenInvalid: 'Este follow-up não pode mais ser gerado de novo.',
  regenConflict: 'Este follow-up mudou enquanto a IA escrevia. A lista foi atualizada.',
  aiError: 'A IA não respondeu agora. Tente de novo em instantes.',
  generatedBefore: 'Recarregue a lista antes de aprovar em lote.',
  tooManyIds: 'Selecione no máximo 200 follow-ups de uma vez.',
  tooManyDeals: 'Escolha no máximo 50 negócios por vez.',
  pausedInvalid: 'Informe se o envio fica pausado ou não.',
  optOutTarget: 'Informe o negócio ou o telefone.',
  optOutPhone: 'Informe um telefone com DDD.',
  dealPhone: 'O negócio não tem um telefone válido.',
  reconcileDeals: 'Escolha no máximo 300 negócios de uma vez.',
  reconcilePhones: 'Escolha no máximo 100 contatos de uma vez, cada um com DDD.',
  skippedByStudio: 'Pulado pelo estúdio',
  dealOptOutReason: 'Estúdio optou por não fazer follow-up',
} as const;

const STATUS_BY_CODE: Record<FollowUpErrorCode, number> = {
  MIGRATION_REQUIRED: 503, NOT_FOUND: 404, INVALID_STATUS: 409, ALREADY_CLAIMED: 409, CONVERSATION_CHANGED: 409,
  STAGE_CHANGED: 409, OPTED_OUT: 409, FOLLOWUPS_DISABLED: 409, SWEEP_RUNNING: 409, REGEN_RUNNING: 409,
  AI_CONSENT_REQUIRED: 409, SWEEP_TOO_SOON: 429, REGEN_LIMIT: 429, TEXT_INVALID: 400, CONFIG_INVALID: 400,
  AUTO_CONFIRM_REQUIRED: 400, FORBIDDEN: 403, AI_ERROR: 502, INTERNAL: 500,
};

// Erros lançados pelos serviços (followup-runtime.ts) só com a mensagem.
const SERVICE_ERRORS: Record<string, [FollowUpErrorCode, string]> = {
  SWEEP_RUNNING: ['SWEEP_RUNNING', MSG.sweepRunning],
  REGEN_RUNNING: ['REGEN_RUNNING', MSG.regenRunning],
  AI_CONSENT_REQUIRED: ['AI_CONSENT_REQUIRED', MSG.consent],
};

function routeError(code: FollowUpErrorCode, message: string, fields?: Record<string, string>): FollowUpRouteError {
  return new FollowUpRouteError(message, STATUS_BY_CODE[code], code, fields);
}

// Utilitários de valor

type Row = Record<string, any>;
type Db = any; // SupabaseClient sem o esquema tipado

function isObj(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function orNull<T>(value: T | null | undefined): T | null {
  return value === undefined ? null : value;
}

function firstText(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value;
  }
  return null;
}

function firstOf(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || value === '';
}

function intIn(value: unknown, min: number, max: number, fallback: number): number {
  const raw = firstOf(value);
  const n = Number(raw);
  if (isBlank(raw) || !Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function optionalInt(value: unknown, min: number, max: number): number | undefined {
  const raw = firstOf(value);
  const n = Number(raw);
  if (isBlank(raw) || !Number.isInteger(n)) return undefined;
  return Math.min(max, Math.max(min, n));
}

function optionalStep(value: unknown): FollowUpStep | null {
  const n = Number(firstOf(value));
  return Number.isInteger(n) && n >= 1 && n <= 4 ? (n as FollowUpStep) : null;
}

function optionalTrack(value: unknown): FollowUpTrack | null {
  const text = String(firstOf(value) ?? '');
  return text === 'ladder' || text === 'pre_quote' ? text : null;
}

function trackOfRow(row: Row): FollowUpTrack {
  return row.track === 'pre_quote' ? 'pre_quote' : 'ladder';
}

function positiveId(value: unknown): number | null {
  const raw = String(firstOf(value) ?? '');
  if (!/^\d{1,15}$/.test(raw)) return null;
  const n = Number(raw);
  return n > 0 ? n : null;
}

function parseId(value: unknown, message: string = MSG.notFound): number {
  const id = positiveId(value);
  if (id === null) throw routeError('NOT_FOUND', message);
  return id;
}

// Lista de ids positivos; lista inválida ou longa demais vira 400.
function idList(value: unknown, max: number, field: string, message: string): number[] | undefined {
  if (value === undefined || value === null) return undefined;
  const ids = Array.isArray(value) ? value.map(positiveId) : [null];
  if (ids.length > max || ids.some((id) => id === null)) throw routeError('CONFIG_INVALID', message, { [field]: message });
  return Array.from(new Set(ids as number[]));
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function toMs(value: unknown): number | null {
  if (isBlank(value)) return null;
  const ms = Date.parse(String(value));
  return Number.isFinite(ms) ? ms : null;
}

function metaOf(row: Row): CadenceGenerationMeta {
  const raw = typeof row.generation_meta === 'string' ? safeJson(row.generation_meta) : row.generation_meta;
  return isObj(raw) ? (raw as CadenceGenerationMeta) : {};
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function leaseAlive(row: Row, now: Date): boolean {
  if (!row.claimed_at) return false;
  const lease = toMs(row.lease_expires_at);
  return lease === null || lease > now.getTime();
}

function describeError(err: unknown): string {
  const e = (err || {}) as { code?: unknown; message?: unknown };
  return `${String(e.code ?? '')} ${String(e.message ?? err ?? '')}`.trim().slice(0, 160);
}

// Contexto e permissões

export function ctxFrom(req: Request): FollowUpRouteCtx {
  const r = req as any;
  const userId = String(r.userId || '');
  return {
    userId,
    realUserId: String(r.realUserId || userId),
    isMember: r.isMember === true,
    isPlatformAdmin: r.isPlatformAdmin === true,
    isImpersonating: r.isImpersonating === true,
    memberPermissions: isObj(r.memberPermissions) ? r.memberPermissions : null,
  };
}

// Concessão explícita: membro só aprova com vendas_followups === true (ausente = não).
export function canApproveFollowUps(ctx: FollowUpRouteCtx): boolean {
  if (!ctx.isMember || ctx.isPlatformAdmin) return true;
  return ctx.memberPermissions?.vendas_followups === true;
}

export function canEditFollowUpConfig(ctx: FollowUpRouteCtx): boolean {
  return !ctx.isMember || ctx.isPlatformAdmin;
}

// Consentimento LGPD: só quem responde pela conta, e nunca em modo suporte.
export function canGiveAiConsent(ctx: FollowUpRouteCtx): boolean {
  return canEditFollowUpConfig(ctx) && !ctx.isImpersonating;
}

export function requireFollowUpApprover(req: Request, res: Response, next: NextFunction): void {
  if (canApproveFollowUps(ctxFrom(req))) return next();
  const body: FollowUpErrorBody = { error: MSG.forbiddenApprover, code: 'FORBIDDEN' };
  res.status(403).json(body);
}

// Parse de entrada

export function parseQueueQuery(q: unknown): QueueQuery {
  const query = isObj(q) ? q : {};
  const status = String(firstOf(query.status) ?? '') as QueueTab;
  const stage = firstText(firstOf(query.stage_id));
  return {
    status: QUEUE_TABS.includes(status) ? status : 'draft',
    step: optionalStep(query.step),
    track: optionalTrack(query.track),
    stage_id: stage ? stage.trim().slice(0, 100) : null,
    deal_id: positiveId(query.deal_id),
    search: String(firstOf(query.search) ?? '').trim().slice(0, 80),
    offset: intIn(query.offset, 0, 100_000, 0),
    limit: intIn(query.limit, 1, 50, 20),
    preview: intIn(query.preview, 0, 8, DEFAULT_PREVIEW),
  };
}

export function parseDraftText(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw routeError('TEXT_INVALID', MSG.textEmpty, { text: MSG.textEmpty });
  if (text.length > 1000) throw routeError('TEXT_INVALID', MSG.textLong, { text: MSG.textLong });
  if (text.includes('###')) throw routeError('TEXT_INVALID', MSG.textHashes, { text: MSG.textHashes });
  return text;
}

export function isMigrationMissing(err: unknown): boolean {
  if (!isObj(err)) return false;
  const e = err as { code?: unknown; name?: unknown };
  return MIGRATION_CODES.has(String(e.code ?? '')) || e.name === 'CadenceMigrationMissing';
}

function toRouteError(err: unknown): FollowUpRouteError {
  if (err instanceof FollowUpRouteError) return err;
  if (isMigrationMissing(err)) return routeError('MIGRATION_REQUIRED', MSG.migration);
  const mapped = SERVICE_ERRORS[String((err as { message?: unknown } | null)?.message ?? '')];
  return mapped ? routeError(mapped[0], mapped[1]) : routeError('INTERNAL', MSG.internal);
}

export function sendRouteError(res: Response, err: unknown): void {
  const known = toRouteError(err);
  if (known.code === 'INTERNAL') console.warn('[followups] erro interno:', describeError(err));
  const body: FollowUpErrorBody = { error: known.message, code: known.code };
  if (known.fields) body.fields = known.fields;
  res.status(known.status).json(body);
}

// Montagem do item da fila

export function approvedByLabel(row: Pick<CadenceTaskRow, 'approved_by' | 'generation_meta'>, labels: ApproverLabels): string | null {
  const by = row.approved_by;
  if (!by) return null;
  if (by === 'auto') return 'IA (modo automático)';
  if (metaOf(row).impersonated) return 'Suporte';
  if (by === labels.viewerId) return 'Você';
  if (by === labels.ownerId) return 'Dono da conta';
  return labels.members.get(by) || 'Alguém da equipe';
}

function templatePreview(forecast: ForecastResult | undefined): string | null {
  if (!forecast || forecast.channel !== 'meta_template') return null;
  return orNull(forecast.approval?.render);
}

function dealView(row: Row, deal: DealLite | undefined, stageMap: Map<string, { name: string }>): FollowUpDraftItem['deal'] {
  const stageId = String(deal?.stage || row.stage_id || '');
  return {
    id: Number(row.deal_id),
    title: firstText(deal?.title, deal?.contact_name, row.contact_name) ?? 'Negócio',
    contact_name: firstText(deal?.contact_name, row.contact_name),
    phone: firstText(deal?.contact_phone, row.phone) ?? '',
    stage_id: stageId,
    stage_name: stageMap.get(stageId)?.name || stageId,
    temperature: orNull(deal?.temperature),
    assigned_to: orNull(deal?.assigned_to),
  };
}

function silenceView(row: Row, meta: CadenceGenerationMeta, now: Date): FollowUpDraftItem['silence'] {
  const basisMs = toMs(row.basis_at);
  const lastCustomer = orNull(meta.anchor?.last_customer_at);
  const customerMs = toMs(lastCustomer);
  const hours = basisMs === null ? 0 : Math.max(0, Math.round(((now.getTime() - basisMs) / HOUR_MS) * 10) / 10);
  return {
    basis_at: String(row.basis_at ?? ''),
    last_customer_at: lastCustomer,
    hours,
    inside_24h: customerMs !== null && now.getTime() - customerMs < DAY_MS,
  };
}

function toPreview(m: Row): PreviewMessage {
  return {
    from_me: m.from_me === true,
    body: firstText(m.body, m.transcription) ?? '',
    type: String(m.type || 'text'),
    timestamp: String(m.timestamp ?? ''),
  };
}

function previewTail(meta: CadenceGenerationMeta, count: number): PreviewMessage[] {
  const tail = Array.isArray(meta.context_tail) ? meta.context_tail : [];
  if (count <= 0) return [];
  return tail.slice(-count).filter(isObj).map(toPreview);
}

function aiView(meta: CadenceGenerationMeta): FollowUpDraftItem['ai'] {
  return {
    outcome: meta.outcome || 'draft',
    skip_reason: orNull(meta.skip_reason),
    skipped_by: orNull(meta.skipped_by),
    handoff_reason: orNull(meta.handoff_reason),
    warnings: Array.isArray(meta.warnings) ? meta.warnings : [],
    regenerations: Number(meta.regenerations) || 0,
    model: orNull(meta.model),
    invisible_basis: meta.invisible_basis === true,
    invisible_read: meta.invisible_read === true,
  };
}

// Total de toques da trilha; nunca menor que o passo da própria tarefa (config pode ter mudado).
function trackStepsFor(track: FollowUpTrack, step: number, config: FollowUpConfig | undefined): number {
  const total = config ? trackStepCount(track, config) : 0;
  return Math.max(total, Number.isFinite(step) ? step : 0);
}

export function toDraftItem(row: Row, dealMap: Map<number, DealLite>, stageMap: Map<string, { name: string }>,
  labels: ApproverLabels, changedSet: Set<number>, forecastMap: Map<number, ForecastResult>,
  view: { now: Date; preview: number; config?: FollowUpConfig } = { now: new Date(), preview: DEFAULT_PREVIEW }): FollowUpDraftItem {
  const meta = metaOf(row);
  const id = Number(row.id);
  const forecast = forecastMap.get(id);
  const track = trackOfRow(row);
  return {
    id, deal_id: Number(row.deal_id), step: Number(row.step) as FollowUpStep, status: row.status as CadenceStatus,
    track, track_steps: trackStepsFor(track, Number(row.step), view.config),
    text: String(row.message ?? ''), original_text: orNull(row.draft_text),
    scheduled_at: row.scheduled_at, created_at: row.created_at, updated_at: orNull(row.updated_at), sent_at: orNull(row.sent_at),
    approved_at: orNull(row.approved_at), approved_by_label: approvedByLabel(row as CadenceTaskRow, labels),
    approved_via: orNull(meta.approved_via), last_error: orNull(row.last_error), channel_used: orNull(row.channel_used),
    channel_forecast: forecast?.channel || row.channel_used || 'blocked',
    template_preview: templatePreview(forecast),
    approval_class: orNull(meta.approval?.channel_class),
    deal: dealView(row, dealMap.get(Number(row.deal_id)), stageMap),
    silence: silenceView(row, meta, view.now),
    conversation_changed: changedSet.has(id),
    preview: previewTail(meta, view.preview),
    ai: aiView(meta),
  };
}

// Acesso ao banco (sempre user_id explícito; tarefas sempre kind='cadence')

async function run(query: PromiseLike<{ data: any; error: unknown; count?: number | null }>): Promise<{ data: any; count: number | null }> {
  const { data, error, count } = await query;
  if (error) throw error;
  return { data, count: typeof count === 'number' ? count : null };
}

function tasks(db: Db): any {
  return db.from('scheduled_followups');
}

function taskSelect(db: Db, userId: string, columns = TASK_COLUMNS, opts?: Record<string, unknown>): any {
  return tasks(db).select(columns, opts).eq('user_id', userId).eq('kind', 'cadence');
}

async function loadConfig(db: Db, userId: string) {
  const { data } = await run(db.from('followup_cadence_config').select('*').eq('user_id', userId).maybeSingle());
  return parseCadenceConfig(isObj(data) ? data : null);
}

interface StageInfo extends StageRow { auto_follow_up_enabled?: boolean | null }

async function loadStages(db: Db, userId: string): Promise<StageInfo[]> {
  const { data } = await run(db.from('deal_stages').select(STAGE_COLUMNS).eq('user_id', userId).order('position', { ascending: true }));
  return (data || []) as StageInfo[];
}

function legacyAutomation(stages: StageInfo[]): Array<{ stage_id: string; stage_name: string }> {
  return stages
    .filter((s) => s.auto_follow_up_enabled === true && !String(s.id).startsWith('prod-'))
    .map((s) => ({ stage_id: s.id, stage_name: s.name }));
}

async function loadTask(db: Db, userId: string, id: number): Promise<Row> {
  const { data } = await run(taskSelect(db, userId).eq('id', id).maybeSingle());
  if (!isObj(data)) throw routeError('NOT_FOUND', MSG.notFound);
  return data;
}

async function loadDeal(db: Db, userId: string, dealId: number): Promise<DealLite | null> {
  const { data } = await run(db.from('deals').select(DEAL_COLUMNS).eq('user_id', userId).eq('id', dealId).maybeSingle());
  return isObj(data) ? (data as DealLite) : null;
}

async function loadDealMap(db: Db, userId: string, dealIds: number[]): Promise<Map<number, DealLite>> {
  const ids = unique(dealIds.map(Number).filter((id) => id > 0));
  if (!ids.length) return new Map();
  const { data } = await run(db.from('deals').select(DEAL_COLUMNS).eq('user_id', userId).in('id', ids));
  return new Map(((data || []) as DealLite[]).map((d) => [Number(d.id), d]));
}

async function loadStageMap(db: Db, userId: string): Promise<Map<string, { name: string }>> {
  const stages = await loadStages(db, userId);
  return new Map(stages.map((s) => [s.id, { name: s.name }]));
}

// Nomes da equipe só para quem não é a IA, o dono nem quem está vendo.
async function loadLabels(db: Db, ctx: FollowUpRouteCtx, actorIds: Array<string | null | undefined>): Promise<ApproverLabels> {
  const known = new Set(['auto', 'funnel_tracker', 'sweep_history', ctx.userId, ctx.realUserId]);
  const ids = unique(actorIds.filter((id): id is string => !!id && !known.has(id)));
  const labels: ApproverLabels = { ownerId: ctx.userId, viewerId: ctx.realUserId, members: new Map() };
  if (!ids.length) return labels;
  const { data } = await run(db.from('team_members').select('member_user_id, name').eq('owner_user_id', ctx.userId).in('member_user_id', ids));
  for (const m of (data || []) as Row[]) if (m.member_user_id && m.name) labels.members.set(String(m.member_user_id), String(m.name));
  return labels;
}

function isLiveRow(row: Row): boolean {
  return LIVE.includes(row.status);
}

function latestByPhoneKey(messages: Row[]): Map<string, string> {
  const latest = new Map<string, string>();
  for (const m of messages) {
    const key = canonicalPhoneKey(m.phone);
    const previous = latest.get(key);
    if (!previous || (toMs(m.timestamp) ?? 0) > (toMs(previous) ?? 0)) latest.set(key, String(m.timestamp));
  }
  return latest;
}

// Cliente respondeu depois do basis_at, em QUALQUER número da conta: uma consulta só.
async function loadChangedSet(db: Db, userId: string, rows: Row[]): Promise<Set<number>> {
  const live = rows.filter((r) => isLiveRow(r) && toMs(r.basis_at) !== null && digitsOnly(r.phone));
  if (!live.length) return new Set();
  const variants = unique(live.flatMap((r) => brazilianPhoneVariants(r.phone)));
  const minBasis = new Date(Math.min(...live.map((r) => toMs(r.basis_at) as number))).toISOString();
  const { data } = await run(db.from('wa_messages').select('phone, timestamp').eq('user_id', userId).eq('from_me', false)
    .in('phone', variants).gt('timestamp', minBasis).or(CUSTOMER_TURN_FILTER)
    .order('timestamp', { ascending: false }).limit(1000));
  const latest = latestByPhoneKey((data || []) as Row[]);
  const changed = live.filter((r) => customerSpokeAfter(r.basis_at, latest.get(canonicalPhoneKey(r.phone)) ?? null));
  return new Set(changed.map((r) => Number(r.id)));
}

async function isKeyOptedOut(db: Db, userId: string, phone: unknown): Promise<boolean> {
  const key = canonicalPhoneKey(phone);
  if (key.length < 8) return false;
  const { data } = await run(db.from('followup_optouts').select('id').eq('user_id', userId).eq('phone_key', key)
    .is('revoked_at', null).limit(1));
  return ((data || []) as Row[]).length > 0;
}

async function loadOptOutKeysFor(db: Db, userId: string, rows: Row[]): Promise<Set<string>> {
  const keys = unique(rows.map((r) => canonicalPhoneKey(r.phone)).filter((k) => k.length >= 8));
  if (!keys.length) return new Set();
  const { data } = await run(db.from('followup_optouts').select('phone_key').eq('user_id', userId).is('revoked_at', null).in('phone_key', keys));
  return new Set(((data || []) as Row[]).map((r) => String(r.phone_key)));
}

// fixed vai cru: o serviço confere se o texto (talvez editado agora) ainda é a mensagem fixa.
function forecastInput(row: Row, text: string): ForecastInput {
  const meta = metaOf(row);
  return {
    id: Number(row.id), contact_name: orNull(row.contact_name), text, step: Number(row.step) as FollowUpStep,
    last_customer_at: orNull(meta.anchor?.last_customer_at), phone: String(row.phone ?? ''), track: trackOfRow(row),
    fixed: meta.fixed ?? null,
  };
}

// Previsão de canal só para as vivas; se o serviço falhar, a fila continua sem ela.
async function forecastMapFor(env: Env, userId: string, config: FollowUpConfig, rows: Row[]): Promise<Map<number, ForecastResult>> {
  const live = rows.filter(isLiveRow);
  if (!live.length) return new Map();
  try {
    const results = await env.services.forecast(userId, config, live.map((r) => forecastInput(r, String(r.message ?? ''))));
    return new Map((results || []).map((f) => [Number(f.id), f]));
  } catch (err) {
    console.warn('[followups] previsão de canal falhou:', describeError(err));
    return new Map();
  }
}

interface Env { db: Db; services: FollowUpServices; now: () => Date }

async function buildItems(env: Env, ctx: FollowUpRouteCtx, config: FollowUpConfig, rows: Row[], preview: number): Promise<FollowUpDraftItem[]> {
  if (!rows.length) return [];
  const [dealMap, stageMap, labels, changed, forecasts] = await Promise.all([
    loadDealMap(env.db, ctx.userId, rows.map((r) => Number(r.deal_id))),
    loadStageMap(env.db, ctx.userId),
    loadLabels(env.db, ctx, rows.map((r) => r.approved_by)),
    loadChangedSet(env.db, ctx.userId, rows),
    forecastMapFor(env, ctx.userId, config, rows),
  ]);
  const view = { now: env.now(), preview, config };
  return rows.map((r) => toDraftItem(r, dealMap, stageMap, labels, changed, forecasts, view));
}

async function singleItem(env: Env, ctx: FollowUpRouteCtx, row: Row, config?: FollowUpConfig): Promise<FollowUpDraftItem> {
  const cfg = config ?? (await loadConfig(env.db, ctx.userId)).config;
  const [item] = await buildItems(env, ctx, cfg, [row], DEFAULT_PREVIEW);
  return item;
}

// Update condicional: status esperado, mesmo updated_at lido e sem lease viva.
async function casUpdate(db: Db, userId: string, row: Row, statuses: CadenceStatus[], patch: Row, nowIso: string): Promise<Row | null> {
  let query = tasks(db).update(patch).eq('user_id', userId).eq('kind', 'cadence').eq('id', Number(row.id))
    .in('status', statuses).or(`claimed_at.is.null,lease_expires_at.lt.${nowIso}`);
  if (row.updated_at) query = query.eq('updated_at', row.updated_at);
  const { data } = await run(query.select(TASK_COLUMNS));
  const rows = (data || []) as Row[];
  return rows[0] ?? null;
}

async function conflictFor(db: Db, userId: string, id: number, now: Date): Promise<FollowUpRouteError> {
  const { data } = await run(taskSelect(db, userId).eq('id', id).maybeSingle());
  if (!isObj(data)) return routeError('NOT_FOUND', MSG.notFound);
  if (data.status === 'sending' || leaseAlive(data, now)) return routeError('ALREADY_CLAIMED', MSG.alreadyClaimed);
  return routeError('INVALID_STATUS', MSG.notEditable);
}

function assertEditable(row: Row, now: Date): void {
  if (!EDITABLE.includes(row.status)) throw routeError('INVALID_STATUS', MSG.notEditable);
  if (leaseAlive(row, now)) throw routeError('ALREADY_CLAIMED', MSG.alreadyClaimed);
}

async function countSentToday(db: Db, userId: string, dayStartIso: string): Promise<number> {
  const { count } = await run(taskSelect(db, userId, 'id', { count: 'exact', head: true }).eq('status', 'sent').gte('sent_at', dayStartIso));
  return count ?? 0;
}

function dayStartIso(config: FollowUpConfig, now: Date): string {
  return localDayStartUtc(now, config.business_hours.tz).toISOString();
}

function weekAgoIso(now: Date): string {
  return new Date(now.getTime() - 7 * DAY_MS).toISOString();
}

// Overview

type Counts = FollowUpOverview['counts'];
type Sending = FollowUpOverview['sending'];
type BaseOverview = Omit<FollowUpOverview, 'can_edit_config' | 'can_approve'>;

function emptyCounts(): Counts {
  return {
    draft: 0, draft_by_step: { 1: 0, 2: 0, 3: 0, 4: 0 }, draft_by_track: { ladder: 0, pre_quote: 0 }, approved: 0, sending: 0, blocked: 0, failed_7d: 0,
    sent_today: 0, skipped_7d: 0, cancelled_7d: 0, optouts: 0,
  };
}

function tallyLive(rows: Row[], counts: Counts): void {
  for (const row of rows) {
    const status = row.status as 'draft' | 'approved' | 'sending' | 'blocked';
    if (typeof counts[status] === 'number') counts[status] += 1;
    if (status !== 'draft') continue;
    const track = trackOfRow(row);
    counts.draft_by_track[track] += 1;
    const step = optionalStep(row.step);
    if (track === 'ladder' && step) counts.draft_by_step[step] += 1;
  }
}

async function loadCounts(db: Db, userId: string, dayStart: string, weekAgo: string): Promise<Counts> {
  const head = () => taskSelect(db, userId, 'id', { count: 'exact', head: true });
  const [live, sent, failed, skipped, cancelled, optouts] = await Promise.all([
    run(taskSelect(db, userId, 'status, step, track').in('status', LIVE).limit(5000)),
    run(head().eq('status', 'sent').gte('sent_at', dayStart)),
    run(head().eq('status', 'failed').gte('updated_at', weekAgo)),
    run(head().eq('status', 'skipped').gte('updated_at', weekAgo)),
    run(head().eq('status', 'cancelled').gte('updated_at', weekAgo)),
    run(db.from('followup_optouts').select('id', { count: 'exact', head: true }).eq('user_id', userId).is('revoked_at', null)),
  ]);
  const counts = emptyCounts();
  tallyLive((live.data || []) as Row[], counts);
  counts.sent_today = sent.count ?? 0;
  counts.failed_7d = failed.count ?? 0;
  counts.skipped_7d = skipped.count ?? 0;
  counts.cancelled_7d = cancelled.count ?? 0;
  counts.optouts = optouts.count ?? 0;
  return counts;
}

function fallbackChannelHealth(note: string): ChannelHealth {
  return {
    baileys: { status: 'not_initialized', phone: null, allowed: false, dedupe_ready: false },
    meta: { configured: false, operational: false, token_expires_at: null, token_state: 'none', days_left: null, quality_rating: null },
    template: { configured: false, approved: false, eligible: false, name: null, reason: null },
    preferred_channel: null,
    can_send: { inside_24h: false, outside_24h: false },
    level: 'down',
    notes: [note],
  };
}

async function safeChannelHealth(services: FollowUpServices, userId: string, config: FollowUpConfig): Promise<ChannelHealth> {
  try {
    return await services.channelHealth(userId, config);
  } catch (err) {
    if (isMigrationMissing(err)) throw err;
    console.warn('[followups] saúde dos canais falhou:', describeError(err));
    return fallbackChannelHealth(MSG.channelsUnknown);
  }
}

interface PauseInput { config: FollowUpConfig; state: FollowUpRuntimeState; sentToday: number; cap: number; windowOpen: boolean; channelLevel: string }

// Ordem fixa: o primeiro motivo que casar é o mostrado.
const PAUSE_RULES: Array<(p: PauseInput) => OverviewPauseReason> = [
  (p) => (p.config.enabled ? null : 'disabled'),
  (p) => (p.state.paused_at ? p.state.paused_reason || 'manual' : null),
  (p) => (p.sentToday >= p.cap ? 'daily_cap' : null),
  (p) => (p.windowOpen ? null : 'outside_hours'),
  (p) => (p.channelLevel === 'down' ? 'no_channel' : null),
];

function pauseReasonFor(p: PauseInput): OverviewPauseReason {
  for (const rule of PAUSE_RULES) {
    const reason = rule(p);
    if (reason) return reason;
  }
  return null;
}

function buildSending(i: { config: FollowUpConfig; state: FollowUpRuntimeState; sentToday: number; channelLevel: string;
  window: { open: boolean; next_open_at: string | null }; now: Date }): Sending {
  const { cap, warmupUntil } = effectiveDailyCap(i.config, i.state, i.now);
  const reason = pauseReasonFor({ ...i, cap, windowOpen: i.window.open });
  return {
    sent_today: i.sentToday, daily_cap: i.config.daily_cap, effective_cap: cap, warmup_until: warmupUntil,
    remaining: Math.max(0, cap - i.sentToday), paused: reason !== null, paused_reason: reason,
    last_error: i.state.last_error, last_block_message: i.state.last_block_message, next_window_at: i.window.next_open_at,
  };
}

function consentView(state: FollowUpRuntimeState): { external_ai: boolean; at: string | null } {
  return { external_ai: !!state.external_ai_consent_at, at: state.external_ai_consent_at };
}

function idleSweep(): SweepState {
  return { running: false, started_at: null, finished_at: null, progress: null, last_summary: null, next_auto_at: null };
}

// Mensagens fixas não passam conversa pela IA: não dependem do consentimento.
function aiConsentOk(config: FollowUpConfig, state: FollowUpRuntimeState): boolean {
  return !!state.external_ai_consent_at || config.message_mode === 'fixed';
}

function nextAutoSweep(config: FollowUpConfig, state: FollowUpRuntimeState): string | null {
  const last = toMs(state.last_sweep_at);
  if (!config.enabled || !aiConsentOk(config, state) || last === null) return null;
  return new Date(last + config.sweep_interval_minutes * 60_000).toISOString();
}

// Status na Meta do template de cada mensagem fixa salva (cache local mais o erro de criação
// lembrado pelo servidor). Falha de leitura não derruba a tela: vira "ainda não enviado".
async function fixedTemplatesView(env: Env, userId: string, config: FollowUpConfig): Promise<FixedTemplateInfo[]> {
  const names = fixedSteps(config.fixed_messages).map((s) => s.name);
  if (!names.length) return [];
  const errors = env.services.fixedTemplateErrors?.(userId) ?? {};
  try {
    const { data } = await run(env.db.from('whatsapp_message_templates').select('name, status, rejection_reason')
      .eq('user_id', String(userId)).in('name', names));
    const rows = ((data || []) as Row[]).map((r) => ({ name: String(r.name ?? ''), status: String(r.status ?? ''), rejectionReason: orNull(r.rejection_reason) }));
    return fixedTemplatesInfo(config.fixed_messages, rows, errors);
  } catch (err) {
    console.warn('[followups] status dos templates fixos falhou:', describeError(err));
    return fixedTemplatesInfo(config.fixed_messages, [], errors);
  }
}

// O estado em memória some no deploy: o resumo gravado na config cobre a lacuna.
function sweepView(services: FollowUpServices, userId: string, config: FollowUpConfig, state: FollowUpRuntimeState): SweepState {
  const live = services.sweepState(userId) || idleSweep();
  const summary: SweepSummary | null = live.last_summary || state.last_sweep_summary;
  return {
    running: live.running === true,
    started_at: orNull(live.started_at),
    finished_at: live.finished_at || state.last_sweep_at,
    progress: orNull(live.progress),
    last_summary: summary,
    next_auto_at: live.next_auto_at || nextAutoSweep(config, state),
  };
}

async function computeOverview(env: Env, userId: string): Promise<BaseOverview> {
  const now = env.now();
  const { config, state, exists } = await loadConfig(env.db, userId);
  const [channels, counts, stages, fixedTemplates] = await Promise.all([
    safeChannelHealth(env.services, userId, config),
    loadCounts(env.db, userId, dayStartIso(config, now), weekAgoIso(now)),
    loadStages(env.db, userId),
    fixedTemplatesView(env, userId, config),
  ]);
  const window = env.services.businessWindow(config, now);
  return {
    configured: exists, enabled: config.enabled, mode: config.mode, tracker_enabled: config.tracker_enabled,
    message_mode: config.message_mode, fixed_templates: fixedTemplates,
    consent: consentView(state), channels, counts,
    sending: buildSending({ config, state, sentToday: counts.sent_today, channelLevel: channels.level, window, now }),
    sweep: sweepView(env.services, userId, config, state),
    legacy_automation: legacyAutomation(stages),
    server_time: now.toISOString(),
  };
}

function migrationOverview(perms: { can_edit_config: boolean; can_approve: boolean }, now: Date): FollowUpOverview {
  const cap = DEFAULT_FOLLOWUP_CONFIG.daily_cap;
  return {
    migration_required: true, configured: false, enabled: false, mode: 'approval', tracker_enabled: false, ...perms,
    message_mode: 'ai', fixed_templates: [],
    consent: { external_ai: false, at: null },
    channels: fallbackChannelHealth(MSG.migration),
    counts: emptyCounts(),
    sending: {
      sent_today: 0, daily_cap: cap, effective_cap: cap, warmup_until: null, remaining: cap, paused: true,
      paused_reason: 'disabled', last_error: null, last_block_message: null, next_window_at: null,
    },
    sweep: idleSweep(),
    legacy_automation: [],
    server_time: now.toISOString(),
  };
}

interface OverviewCache { get(userId: string, load: () => Promise<BaseOverview>): Promise<BaseOverview>; delete(userId: string): void }

// Cache curto por conta (o painel faz poll). As permissões de quem vê não entram no cache.
function createOverviewCache(ttlMs: number): OverviewCache {
  const entries = new Map<string, { at: number; value: Promise<BaseOverview> }>();
  return {
    get(userId, load) {
      const hit = entries.get(userId);
      if (hit && Date.now() - hit.at < ttlMs) return hit.value;
      const value = load();
      entries.set(userId, { at: Date.now(), value });
      value.catch(() => entries.delete(userId));
      return value;
    },
    delete(userId) {
      entries.delete(userId);
    },
  };
}

async function overviewHandler(env: Env, cache: OverviewCache, req: Request, res: Response): Promise<void> {
  const ctx = ctxFrom(req);
  const perms = { can_edit_config: canEditFollowUpConfig(ctx), can_approve: canApproveFollowUps(ctx) };
  try {
    const base = await cache.get(ctx.userId, () => computeOverview(env, ctx.userId));
    res.json({ ...base, ...perms });
  } catch (err) {
    if (!isMigrationMissing(err)) throw err;
    res.json(migrationOverview(perms, env.now()));
  }
}

// Fila

type QueryFilter = (query: any, t: { dayStart: string; weekAgo: string }) => any;

const TAB_FILTERS: Record<QueueTab, QueryFilter> = {
  draft: (q) => q.eq('status', 'draft'),
  approved: (q) => q.in('status', ['approved', 'sending']),
  blocked: (q, t) => q.or(`status.eq.blocked,and(status.eq.failed,updated_at.gte.${t.weekAgo})`),
  sent_today: (q, t) => q.eq('status', 'sent').gte('sent_at', t.dayStart),
  skipped: (q, t) => q.eq('status', 'skipped').gte('updated_at', t.weekAgo),
  cancelled: (q, t) => q.eq('status', 'cancelled').gte('updated_at', t.weekAgo),
};

const TAB_ORDER: Record<QueueTab, Array<[string, boolean]>> = {
  draft: [['scheduled_at', true], ['id', true]],
  approved: [['scheduled_at', true], ['id', true]],
  blocked: [['updated_at', false], ['id', false]],
  sent_today: [['sent_at', false], ['id', false]],
  skipped: [['updated_at', false], ['id', false]],
  cancelled: [['updated_at', false], ['id', false]],
};

// Busca por nome ou telefone, sem caracteres que quebrariam o filtro do PostgREST.
function searchFilter(search: string): string | null {
  const text = sanitizedText(search);
  const digits = digitsOnly(search);
  const parts: string[] = [];
  if (text.length >= 2) parts.push(`contact_name.ilike.*${text}*`);
  if (digits.length >= 3) parts.push(`phone.like.*${digits}*`);
  return parts.length ? parts.join(',') : null;
}

const QUEUE_FILTERS: Array<(query: any, q: QueueQuery) => any> = [
  (query, q) => (q.step ? query.eq('step', q.step) : query),
  (query, q) => (q.track ? query.eq('track', q.track) : query),
  (query, q) => (q.stage_id ? query.eq('stage_id', q.stage_id) : query),
  (query, q) => (q.deal_id ? query.eq('deal_id', q.deal_id) : query),
  (query, q) => {
    const filter = q.search ? searchFilter(q.search) : null;
    return filter ? query.or(filter) : query;
  },
];

function queueQuery(db: Db, userId: string, q: QueueQuery, windows: { dayStart: string; weekAgo: string }): any {
  let query = TAB_FILTERS[q.status](taskSelect(db, userId, TASK_COLUMNS, { count: 'exact' }), windows);
  for (const apply of QUEUE_FILTERS) query = apply(query, q);
  for (const [column, ascending] of TAB_ORDER[q.status]) query = query.order(column, { ascending });
  return query.range(q.offset, q.offset + q.limit - 1);
}

async function queueHandler(env: Env, req: Request, res: Response): Promise<void> {
  const ctx = ctxFrom(req);
  const q = parseQueueQuery(req.query);
  const now = env.now();
  const { config } = await loadConfig(env.db, ctx.userId);
  const windows = { dayStart: dayStartIso(config, now), weekAgo: weekAgoIso(now) };
  const { data, count } = await run(queueQuery(env.db, ctx.userId, q, windows));
  const rows = (data || []) as Row[];
  const items = await buildItems(env, ctx, config, rows, q.preview);
  res.json({ items, total: count ?? rows.length, offset: q.offset, limit: q.limit, server_time: now.toISOString() });
}

// Conversa ao vivo: número da tarefa (o principal) e telefone em variantes; sem um
// dos dois, nada (a mesma pessoa pode existir em dois números).
async function conversationHandler(env: Env, req: Request, res: Response): Promise<void> {
  const ctx = ctxFrom(req);
  const id = parseId(req.params.id);
  const limit = intIn(req.query.limit, 1, 50, 30);
  const row = await loadTask(env.db, ctx.userId, id);
  const waVariants = brazilianPhoneVariants(row.wa_number);
  const phoneVariants = brazilianPhoneVariants(row.phone);
  if (!waVariants.length || !phoneVariants.length) {
    res.json({ messages: [] });
    return;
  }
  const { data } = await run(env.db.from('wa_messages').select('from_me, body, type, timestamp, transcription')
    .eq('user_id', ctx.userId).in('wa_number', waVariants).in('phone', phoneVariants)
    .order('timestamp', { ascending: false }).limit(limit));
  res.json({ messages: ((data || []) as Row[]).reverse().map(toPreview) });
}

// Card do negócio

function stageRole(stageId: string, config: FollowUpConfig): DealFollowUpState['stage_role'] {
  const track = trackForStage(stageId, config);
  if (track === 'ladder') return 'step';
  if (track === 'pre_quote') return 'pre_quote';
  return stageId === config.after_last_stage_id ? 'after_last' : 'outside';
}

function studioTurnAt(messages: Row[]): number | null {
  const turn = messages[0];
  if (!turn || turn.from_me !== true) return null;
  if (turn.type === 'unsupported' || turn.status === 'failed') return null;
  return toMs(turn.timestamp);
}

// Só uma dica para o card: última fala do estúdio mais o atraso do passo, sem IA.
interface DealStep { track: FollowUpTrack | null; step: FollowUpStep | null }

function delayFor(d: DealStep, config: FollowUpConfig): number {
  return d.track === 'pre_quote' ? preQuoteDelayHours(d.step as FollowUpStep, config) : delayHoursForStep(d.step as FollowUpStep, config);
}

async function nextEligibleAt(db: Db, userId: string, deal: DealLite, d: DealStep, config: FollowUpConfig): Promise<string | null> {
  const variants = brazilianPhoneVariants(deal.contact_phone);
  if (d.step === null || !variants.length) return null;
  const { data } = await run(db.from('wa_messages').select('from_me, timestamp, type, status').eq('user_id', userId)
    .in('phone', variants).or(CUSTOMER_TURN_FILTER).order('timestamp', { ascending: false }).limit(1));
  const at = studioTurnAt((data || []) as Row[]);
  return at === null ? null : new Date(at + delayFor(d, config) * HOUR_MS).toISOString();
}

async function lastCustomerAt(db: Db, userId: string, variants: string[]): Promise<string | null> {
  const { data } = await run(db.from('wa_messages').select('timestamp').eq('user_id', userId).eq('from_me', false)
    .in('phone', variants).or(CUSTOMER_TURN_FILTER).order('timestamp', { ascending: false }).limit(1));
  return orNull(((data || []) as Row[])[0]?.timestamp);
}

// Próximo toque antes do orçamento: os já enviados para o telefone depois da última fala do cliente.
async function preQuoteNextStep(db: Db, userId: string, deal: DealLite, config: FollowUpConfig): Promise<FollowUpStep | null> {
  const variants = brazilianPhoneVariants(deal.contact_phone);
  const key = canonicalPhoneKey(deal.contact_phone);
  if (!variants.length || key.length < 8) return preQuoteStepFor(0, config);
  const [customerAt, sent] = await Promise.all([
    lastCustomerAt(db, userId, variants),
    run(taskSelect(db, userId, 'id, deal_id, status, step, basis_at, sent_at, created_at, phone, phone_key, stage_id, track')
      .eq('track', 'pre_quote').eq('status', 'sent').eq('phone_key', key).order('sent_at', { ascending: false }).limit(10)),
  ]);
  const count = preQuoteSentInEpisode((sent.data || []) as CadenceTaskLite[], key, customerAt);
  return preQuoteStepFor(count, config);
}

async function dealStep(db: Db, userId: string, deal: DealLite, config: FollowUpConfig): Promise<DealStep> {
  const stage = String(deal.stage ?? '');
  const track = trackForStage(stage, config);
  if (track !== 'pre_quote') return { track, step: stepForStage(stage, config) };
  return { track, step: await preQuoteNextStep(db, userId, deal, config) };
}

// Sem a 083 a coluna kind não existe, e toda linha da tabela ainda é do legado.
async function loadLegacyPending(db: Db, userId: string, dealId: number, byKind = true): Promise<DealFollowUpState['legacy_pending']> {
  let query = db.from('scheduled_followups').select('id, status, scheduled_at').eq('user_id', userId).eq('deal_id', dealId);
  if (byKind) query = query.eq('kind', 'legacy');
  const { data } = await run(query.eq('status', 'pending').order('scheduled_at', { ascending: true }).limit(1));
  const row = ((data || []) as Row[])[0];
  return row ? { id: Number(row.id), status: String(row.status), scheduled_at: String(row.scheduled_at) } : null;
}

async function loadDealTasks(db: Db, userId: string, dealId: number): Promise<{ active: Row | null; last: Row | null }> {
  const { data } = await run(taskSelect(db, userId).eq('deal_id', dealId).order('created_at', { ascending: false }).limit(10));
  const rows = (data || []) as Row[];
  return { active: rows.find(isLiveRow) ?? null, last: rows.find((r) => !isLiveRow(r)) ?? null };
}

function itemFor(items: FollowUpDraftItem[], row: Row | null): FollowUpDraftItem | null {
  return row ? items.find((i) => i.id === Number(row.id)) ?? null : null;
}

async function loadConfigOrNull(db: Db, userId: string): Promise<ReturnType<typeof parseCadenceConfig> | null> {
  try {
    return await loadConfig(db, userId);
  } catch (err) {
    if (isMigrationMissing(err)) return null;
    throw err;
  }
}

// Publicado antes da 083: o card continua mostrando (e cancelando) a mensagem fixa antiga.
async function preMigrationDealState(env: Env, ctx: FollowUpRouteCtx, deal: DealLite, dealId: number): Promise<DealFollowUpState> {
  const config = DEFAULT_FOLLOWUP_CONFIG;
  return {
    configured: false, enabled: false, mode: config.mode, stage_role: stageRole(String(deal.stage ?? ''), config),
    step: null, track: null, track_steps: 0, next_eligible_at: null, active: null, last: null, opted_out: false,
    can_approve: canApproveFollowUps(ctx), legacy_pending: await loadLegacyPending(env.db, ctx.userId, dealId, false),
  };
}

async function dealStateHandler(env: Env, req: Request, res: Response): Promise<void> {
  const ctx = ctxFrom(req);
  const dealId = parseId(req.params.dealId, MSG.dealNotFound);
  const [loaded, deal] = await Promise.all([loadConfigOrNull(env.db, ctx.userId), loadDeal(env.db, ctx.userId, dealId)]);
  if (!deal) throw routeError('NOT_FOUND', MSG.dealNotFound);
  if (!loaded) {
    res.json(await preMigrationDealState(env, ctx, deal, dealId));
    return;
  }
  const { config, exists } = loaded;
  const current = await dealStep(env.db, ctx.userId, deal, config);
  const [{ active, last }, optedOut, legacy] = await Promise.all([
    loadDealTasks(env.db, ctx.userId, dealId),
    isKeyOptedOut(env.db, ctx.userId, deal.contact_phone),
    loadLegacyPending(env.db, ctx.userId, dealId),
  ]);
  const items = await buildItems(env, ctx, config, [active, last].filter(isObj), DEFAULT_PREVIEW);
  const body: DealFollowUpState = {
    configured: exists, enabled: config.enabled, mode: config.mode,
    stage_role: stageRole(String(deal.stage ?? ''), config), step: current.step,
    track: current.track, track_steps: current.track ? trackStepCount(current.track, config) : 0,
    next_eligible_at: active ? null : await nextEligibleAt(env.db, ctx.userId, deal, current, config),
    active: itemFor(items, active), last: itemFor(items, last),
    opted_out: optedOut, can_approve: canApproveFollowUps(ctx), legacy_pending: legacy,
  };
  res.json(body);
}

// Varredura manual

interface SweepBody { dry_run: boolean; step?: FollowUpStep; track?: FollowUpTrack; deal_ids?: number[]; limit?: number }

function parseSweepBody(raw: unknown): SweepBody {
  const b = isObj(raw) ? raw : {};
  const out: SweepBody = { dry_run: b.dry_run === true };
  const step = optionalStep(b.step);
  const track = optionalTrack(b.track);
  const dealIds = idList(b.deal_ids, 50, 'deal_ids', MSG.tooManyDeals);
  const limit = optionalInt(b.limit, 1, 60);
  if (step) out.step = step;
  if (track) out.track = track;
  if (dealIds?.length) out.deal_ids = dealIds;
  if (limit) out.limit = limit;
  return out;
}

interface SweepLocks {
  assertCanStart(userId: string, full: boolean): void;
  start(userId: string, full: boolean, task: () => Promise<unknown>): void;
}

// 10 min entre varreduras manuais completas; com deal_ids não há intervalo.
function createSweepLocks(env: Env, onDone: (userId: string) => void): SweepLocks {
  const running = new Set<string>();
  const lastFull = new Map<string, number>();
  return {
    assertCanStart(userId, full) {
      if (running.has(userId) || env.services.sweepState(userId)?.running) throw routeError('SWEEP_RUNNING', MSG.sweepRunning);
      const last = lastFull.get(userId);
      const tooSoon = full && last !== undefined && env.now().getTime() - last < MANUAL_SWEEP_GAP_MS;
      if (tooSoon) throw routeError('SWEEP_TOO_SOON', MSG.sweepTooSoon);
    },
    start(userId, full, task) {
      running.add(userId);
      if (full) lastFull.set(userId, env.now().getTime());
      void Promise.resolve()
        .then(task)
        .catch((err) => console.warn('[followups] varredura manual falhou:', describeError(err)))
        .finally(() => {
          running.delete(userId);
          onDone(userId);
        });
    },
  };
}

async function recordConsentIfAsked(env: Env, ctx: FollowUpRouteCtx, state: FollowUpRuntimeState, asked: boolean): Promise<string | null> {
  if (state.external_ai_consent_at) return state.external_ai_consent_at;
  if (!asked || !canGiveAiConsent(ctx)) return null;
  const at = env.now().toISOString();
  await run(env.db.from('followup_cadence_config')
    .upsert({ user_id: ctx.userId, external_ai_consent_at: at, external_ai_consent_by: ctx.realUserId }, { onConflict: 'user_id' }));
  env.services.invalidateConfig(ctx.userId);
  console.log('[followups] consentimento de IA externa registrado', { userId: ctx.userId });
  return at;
}

function willGenerate(eligible: number, limit: number | undefined, config: FollowUpConfig): number {
  const cap = config.max_drafts_per_sweep;
  return Math.max(0, Math.min(eligible, limit ?? cap, cap));
}

async function sweepHandler(env: Env, locks: SweepLocks, req: Request, res: Response): Promise<void> {
  const ctx = ctxFrom(req);
  const body = parseSweepBody(req.body);
  const { config, state } = await loadConfig(env.db, ctx.userId);
  const consentAt = await recordConsentIfAsked(env, ctx, state, req.body?.consent_to_external_ai === true);
  const { dry_run: dryRun, ...rest } = body;
  const request: SweepRequest = { manual: true, ...rest };
  if (dryRun) {
    res.json(await env.services.countEligible(ctx.userId, { ...request, dry_run: true }));
    return;
  }
  if (!aiConsentOk(config, { ...state, external_ai_consent_at: consentAt })) throw routeError('AI_CONSENT_REQUIRED', MSG.consent);
  const full = !request.deal_ids?.length;
  locks.assertCanStart(ctx.userId, full);
  const preview: SweepDryRun = await env.services.countEligible(ctx.userId, { ...request, dry_run: true });
  locks.start(ctx.userId, full, () => env.services.runSweep(ctx.userId, request));
  res.status(202).json({ started: true, eligible_total: preview.eligible_total, will_generate: willGenerate(preview.eligible_total, request.limit, config) });
}

// Edição, aprovação e pulo

// Aprovação vale para o texto aprovado: editar volta a rascunho sem a aprovação antiga.
function withoutApproval(meta: CadenceGenerationMeta): CadenceGenerationMeta {
  const { approval: _approval, approved_via: _via, impersonated: _impersonated, ...rest } = meta;
  return rest;
}

async function patchHandler(env: Env, req: Request, res: Response): Promise<void> {
  const ctx = ctxFrom(req);
  const id = parseId(req.params.id);
  const text = parseDraftText(req.body?.text);
  const row = await loadTask(env.db, ctx.userId, id);
  const now = env.now();
  assertEditable(row, now);
  const nowIso = now.toISOString();
  const patch = {
    message: text, status: 'draft', approved_at: null, approved_by: null, updated_at: nowIso,
    generation_meta: { ...withoutApproval(metaOf(row)), edited_at: nowIso, edited_by: ctx.realUserId },
  };
  const updated = await casUpdate(env.db, ctx.userId, row, EDITABLE, patch, nowIso);
  if (!updated) throw await conflictFor(env.db, ctx.userId, id, now);
  res.json({ item: await singleItem(env, ctx, updated) });
}

async function assertApprovable(db: Db, userId: string, row: Row): Promise<void> {
  if (!APPROVABLE.includes(row.status)) throw routeError('INVALID_STATUS', MSG.notApprovable);
  const deal = await loadDeal(db, userId, Number(row.deal_id));
  if (!deal || deal.stage !== row.stage_id) throw routeError('STAGE_CHANGED', MSG.stageChanged);
  if (await isKeyOptedOut(db, userId, row.phone)) throw routeError('OPTED_OUT', MSG.optedOut);
  const changed = await loadChangedSet(db, userId, [row]);
  if (changed.has(Number(row.id))) throw routeError('CONVERSATION_CHANGED', MSG.conversationChanged);
}

function approvalPatch(row: Row, ctx: FollowUpRouteCtx, text: string, forecast: ForecastResult, via: 'manual' | 'bulk', nowIso: string): Row {
  const meta: CadenceGenerationMeta = { ...metaOf(row), approved_via: via, impersonated: ctx.isImpersonating, approval: forecast.approval };
  if (text !== row.message) Object.assign(meta, { edited_at: nowIso, edited_by: ctx.realUserId });
  return {
    status: 'approved', approved_at: nowIso, approved_by: ctx.realUserId, message: text, last_error: null,
    updated_at: nowIso, generation_meta: meta,
  };
}

function approveWarning(forecast: ForecastResult): string | null {
  if (forecast.channel === 'blocked') return MSG.approvedNoChannel;
  return forecast.channel === 'meta_template' ? MSG.approvedTemplate : null;
}

async function forecastOne(env: Env, userId: string, config: FollowUpConfig, row: Row, text: string): Promise<ForecastResult> {
  const [forecast] = await env.services.forecast(userId, config, [forecastInput(row, text)]);
  if (!forecast || !forecast.approval) throw routeError('INTERNAL', MSG.internal);
  return forecast;
}

async function approveHandler(env: Env, req: Request, res: Response): Promise<void> {
  const ctx = ctxFrom(req);
  const id = parseId(req.params.id);
  const { config } = await loadConfig(env.db, ctx.userId);
  if (!config.enabled) throw routeError('FOLLOWUPS_DISABLED', MSG.disabled);
  const row = await loadTask(env.db, ctx.userId, id);
  await assertApprovable(env.db, ctx.userId, row);
  const text = parseDraftText(req.body?.text ?? row.message);
  const forecast = await forecastOne(env, ctx.userId, config, row, text);
  const now = env.now();
  const updated = await casUpdate(env.db, ctx.userId, row, APPROVABLE, approvalPatch(row, ctx, text, forecast, 'manual', now.toISOString()), now.toISOString());
  if (!updated) throw await conflictFor(env.db, ctx.userId, id, now);
  env.services.kickSender(ctx.userId);
  const item = await singleItem(env, ctx, updated, config);
  const warning = approveWarning(forecast);
  res.json(warning ? { item, warning } : { item });
}

interface ApproveAllBody {
  generated_before: string; step: FollowUpStep | null; track: FollowUpTrack | null; stage_id: string | null; ids?: number[]; exclude_ids?: number[];
  include_blocked: boolean;
}

function parseApproveAll(raw: unknown): ApproveAllBody {
  const b = isObj(raw) ? raw : {};
  const before = toMs(b.generated_before);
  if (typeof b.generated_before !== 'string' || before === null) {
    throw routeError('CONFIG_INVALID', MSG.generatedBefore, { generated_before: MSG.generatedBefore });
  }
  return {
    generated_before: new Date(before).toISOString(),
    step: optionalStep(b.step),
    track: optionalTrack(b.track),
    stage_id: firstText(b.stage_id),
    ids: idList(b.ids, APPROVE_ALL_MAX, 'ids', MSG.tooManyIds),
    exclude_ids: idList(b.exclude_ids, APPROVE_ALL_MAX, 'exclude_ids', MSG.tooManyIds),
    include_blocked: b.include_blocked === true,
  };
}

function approveAllStatuses(body: ApproveAllBody): CadenceStatus[] {
  return body.include_blocked ? ['draft', 'blocked'] : ['draft'];
}

const APPROVE_ALL_FILTERS: Array<(query: any, b: ApproveAllBody) => any> = [
  (query, b) => (b.step ? query.eq('step', b.step) : query),
  (query, b) => (b.track ? query.eq('track', b.track) : query),
  (query, b) => (b.stage_id ? query.eq('stage_id', b.stage_id) : query),
  (query, b) => (b.ids ? query.in('id', b.ids) : query),
  (query, b) => (b.exclude_ids?.length ? query.not('id', 'in', `(${b.exclude_ids.join(',')})`) : query),
];

// Só o que a pessoa já tinha visto: criado e alterado até o server_time da fila.
async function loadApproveCandidates(db: Db, userId: string, body: ApproveAllBody): Promise<Row[]> {
  let query = taskSelect(db, userId).in('status', approveAllStatuses(body))
    .lte('created_at', body.generated_before).lte('updated_at', body.generated_before);
  for (const apply of APPROVE_ALL_FILTERS) query = apply(query, body);
  const { data } = await run(query.order('scheduled_at', { ascending: true }).order('id', { ascending: true }).limit(APPROVE_ALL_MAX));
  return ((data || []) as Row[]).filter((r) => String(r.message ?? '').trim());
}

type ExcludeReason = keyof ApproveAllResult['excluded'];

async function partitionApprovable(db: Db, userId: string, rows: Row[]): Promise<{ keep: Row[]; excluded: ApproveAllResult['excluded'] }> {
  const [deals, optoutKeys, changed] = await Promise.all([
    loadDealMap(db, userId, rows.map((r) => Number(r.deal_id))),
    loadOptOutKeysFor(db, userId, rows),
    loadChangedSet(db, userId, rows),
  ]);
  const rules: Array<[ExcludeReason, (r: Row) => boolean]> = [
    ['stage_changed', (r) => deals.get(Number(r.deal_id))?.stage !== r.stage_id],
    ['opted_out', (r) => optoutKeys.has(canonicalPhoneKey(r.phone))],
    ['conversation_changed', (r) => changed.has(Number(r.id))],
  ];
  const excluded = { conversation_changed: 0, opted_out: 0, stage_changed: 0 };
  const keep: Row[] = [];
  for (const row of rows) {
    const hit = rules.find(([, test]) => test(row));
    if (hit) excluded[hit[0]] += 1;
    else keep.push(row);
  }
  return { keep, excluded };
}

async function mapPool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      out[index] = await fn(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  return out;
}

async function approveBatch(env: Env, ctx: FollowUpRouteCtx, config: FollowUpConfig, rows: Row[], statuses: CadenceStatus[]): Promise<number> {
  if (!rows.length) return 0;
  const results = await env.services.forecast(ctx.userId, config, rows.map((r) => forecastInput(r, String(r.message))));
  const byId = new Map((results || []).map((f) => [Number(f.id), f]));
  const nowIso = env.now().toISOString();
  const done = await mapPool(rows, APPROVE_POOL, async (row) => {
    const forecast = byId.get(Number(row.id));
    if (!forecast?.approval) return false;
    const patch = approvalPatch(row, ctx, String(row.message), forecast, 'bulk', nowIso);
    return !!(await casUpdate(env.db, ctx.userId, row, statuses, patch, nowIso));
  });
  return done.filter(Boolean).length;
}

async function approveAllHandler(env: Env, req: Request, res: Response): Promise<void> {
  const ctx = ctxFrom(req);
  const { config, state } = await loadConfig(env.db, ctx.userId);
  if (!config.enabled) throw routeError('FOLLOWUPS_DISABLED', MSG.disabled);
  const body = parseApproveAll(req.body);
  const rows = await loadApproveCandidates(env.db, ctx.userId, body);
  const { keep, excluded } = await partitionApprovable(env.db, ctx.userId, rows);
  const approved = await approveBatch(env, ctx, config, keep, approveAllStatuses(body));
  if (approved > 0) env.services.kickSender(ctx.userId);
  const now = env.now();
  const sentToday = await countSentToday(env.db, ctx.userId, dayStartIso(config, now));
  const { cap } = effectiveDailyCap(config, state, now);
  const result: ApproveAllResult = {
    approved, excluded, sent_today: sentToday, daily_cap: config.daily_cap, effective_cap: cap,
    estimated_business_days: approved > 0 ? Math.ceil(approved / Math.max(1, cap)) : 0,
  };
  res.json(result);
}

function parseSkipBody(raw: unknown): { scope: 'step' | 'deal'; reason: string } {
  const b = isObj(raw) ? raw : {};
  const reason = typeof b.reason === 'string' ? b.reason.trim().slice(0, 200) : '';
  return { scope: b.scope === 'deal' ? 'deal' : 'step', reason };
}

async function skipHandler(env: Env, req: Request, res: Response): Promise<void> {
  const ctx = ctxFrom(req);
  const id = parseId(req.params.id);
  const { scope, reason } = parseSkipBody(req.body);
  const row = await loadTask(env.db, ctx.userId, id);
  const now = env.now();
  assertEditable(row, now);
  // Opt-out antes do pulo: se o pulo perder a corrida, o bloqueio (lado seguro) fica.
  if (scope === 'deal') await insertOptOut(env.db, ctx, { phone: row.phone, deal_id: Number(row.deal_id), reason: MSG.dealOptOutReason });
  const nowIso = now.toISOString();
  const patch = {
    status: 'skipped', message: '', approved_at: null, approved_by: null, last_error: reason || MSG.skippedByStudio,
    updated_at: nowIso, generation_meta: { ...metaOf(row), skipped_by: 'user', skip_reason: reason || null },
  };
  const updated = await casUpdate(env.db, ctx.userId, row, EDITABLE, patch, nowIso);
  if (!updated) throw await conflictFor(env.db, ctx.userId, id, now);
  res.json({ item: await singleItem(env, ctx, updated) });
}

// Gerar de novo

const REGEN_FAILURES: Partial<Record<RegenerateResult['status'], [FollowUpErrorCode, string]>> = {
  conversation_changed: ['CONVERSATION_CHANGED', MSG.conversationChanged],
  invalid_status: ['INVALID_STATUS', MSG.regenInvalid],
  conflict: ['ALREADY_CLAIMED', MSG.regenConflict],
  consent_required: ['AI_CONSENT_REQUIRED', MSG.consent],
  limit: ['REGEN_LIMIT', MSG.regenLimit],
  error: ['AI_ERROR', MSG.aiError],
};

function parseRegenerateBody(raw: unknown): { instruction?: string; force: boolean } {
  const b = isObj(raw) ? raw : {};
  const instruction = typeof b.instruction === 'string' ? b.instruction.trim() : '';
  if (instruction.length > 500) throw routeError('TEXT_INVALID', MSG.instructionLong, { instruction: MSG.instructionLong });
  if (instruction.includes('###')) throw routeError('TEXT_INVALID', MSG.instructionHashes, { instruction: MSG.instructionHashes });
  return instruction ? { instruction, force: b.force === true } : { force: b.force === true };
}

async function regenerateHandler(env: Env, req: Request, res: Response): Promise<void> {
  const ctx = ctxFrom(req);
  const id = parseId(req.params.id);
  const opts = parseRegenerateBody(req.body);
  await loadTask(env.db, ctx.userId, id);
  const result = await env.services.regenerate(ctx.userId, id, { ...opts, actorId: ctx.realUserId });
  const failure = REGEN_FAILURES[result.status];
  if (failure) throw routeError(failure[0], failure[1]);
  const item = await singleItem(env, ctx, await loadTask(env.db, ctx.userId, id));
  res.json(result.status === 'ai_suggests_skip' ? { item, ai_suggests_skip: { reason: result.reason } } : { item });
}

// Pausa manual e retomada (a retomada zera a sequência de erros)

async function sendingHandler(env: Env, cache: OverviewCache, req: Request, res: Response): Promise<void> {
  const ctx = ctxFrom(req);
  const paused = req.body?.paused;
  if (typeof paused !== 'boolean') throw routeError('CONFIG_INVALID', MSG.pausedInvalid, { paused: MSG.pausedInvalid });
  const patch = paused
    ? { paused_at: env.now().toISOString(), paused_reason: 'manual' }
    : { paused_at: null, paused_reason: null, consecutive_errors: 0 };
  await run(env.db.from('followup_cadence_config').update(patch).eq('user_id', ctx.userId));
  env.services.invalidateConfig(ctx.userId);
  if (!paused) env.services.kickSender(ctx.userId);
  cache.delete(ctx.userId);
  const overview = await cache.get(ctx.userId, () => computeOverview(env, ctx.userId));
  res.json({ sending: overview.sending });
}

// Configuração

function stageOption(s: StageInfo): FollowUpConfigResponse['stages'][number] {
  return { id: s.id, name: s.name, position: Number(s.position) || 0, is_final: s.is_final === true, is_won: s.is_won === true };
}

async function getConfigHandler(env: Env, req: Request, res: Response): Promise<void> {
  const ctx = ctxFrom(req);
  const [{ config, state, exists }, stages, templates, dedupeReady] = await Promise.all([
    loadConfig(env.db, ctx.userId),
    loadStages(env.db, ctx.userId),
    env.services.listTemplates(ctx.userId),
    env.services.dedupeReady(ctx.userId),
  ]);
  const sales = stages.filter(isSalesStage);
  const body: FollowUpConfigResponse = {
    config, defaults: structuredClone(DEFAULT_FOLLOWUP_CONFIG), exists,
    stages: sales.map(stageOption),
    templates,
    suggested: { ...suggestLadder(sales), ...suggestPreQuote(sales), ...suggestTrackerStages(sales) },
    legacy_automation: legacyAutomation(stages),
    consent: consentView(state),
    dedupe_ready: dedupeReady,
    can_edit: canEditFollowUpConfig(ctx),
    fixed_templates: await fixedTemplatesView(env, ctx.userId, config),
  };
  res.json(body);
}

function assertSupportModeAllowed(ctx: FollowUpRouteCtx, body: Row, current: FollowUpConfig): void {
  if (!ctx.isImpersonating) return;
  const turningOn = body.enabled === true && !current.enabled;
  const autoOn = body.mode === 'auto' && current.mode !== 'auto';
  if (turningOn || autoOn) throw routeError('FORBIDDEN', MSG.supportMode);
}

function configPatchFrom(body: Row): Row {
  const patch: Row = {};
  for (const [key, value] of Object.entries(body)) if (!CONTROL_KEYS.has(key)) patch[key] = value;
  return patch;
}

async function validatePut(env: Env, userId: string, current: FollowUpConfig, body: Row) {
  const [templates, dedupeReady, stages] = await Promise.all([
    env.services.listTemplates(userId), env.services.dedupeReady(userId), loadStages(env.db, userId),
  ]);
  const eligibleTemplateIds = new Set((templates || []).filter((t) => t.eligible).map((t) => Number(t.id)));
  const result = validateConfigInput(current, configPatchFrom(body), {
    stages, eligibleTemplateIds, confirmAuto: body.confirm_auto === true, dedupeMigrationReady: dedupeReady === true,
  });
  if (result.ok) return result;
  if (result.autoConfirmRequired) throw routeError('AUTO_CONFIRM_REQUIRED', MSG.autoConfirm, result.errors);
  throw routeError('CONFIG_INVALID', MSG.configInvalid, result.errors);
}

// Colunas da 087: só entram no upsert quando a config antiga ou a nova sai do padrão (IA, sem
// textos). Assim o PUT de sempre continua gravando se o código subir antes da migration.
const FIXED_COLUMNS: ReadonlyArray<keyof FollowUpConfig> = ['message_mode', 'fixed_messages'];

function usesFixedColumns(...configs: FollowUpConfig[]): boolean {
  return configs.some((c) => c.message_mode !== 'ai' || c.fixed_messages.length > 0);
}

// Só colunas editáveis, mais o início da rampa e o consentimento pelas regras do PUT.
function configRow(ctx: FollowUpRouteCtx, body: Row, state: FollowUpRuntimeState, config: FollowUpConfig, previous: FollowUpConfig,
  nowIso: string): Row {
  const row: Row = { user_id: ctx.userId };
  const withFixed = usesFixedColumns(previous, config);
  for (const key of EDITABLE_KEYS) if (withFixed || !FIXED_COLUMNS.includes(key)) row[key] = config[key];
  row.updated_at = nowIso;
  row.updated_by = ctx.realUserId;
  if (config.enabled && !state.first_enabled_at) row.first_enabled_at = nowIso;
  if (body.consent_to_external_ai === true && !ctx.isImpersonating && !state.external_ai_consent_at) {
    row.external_ai_consent_at = nowIso;
    row.external_ai_consent_by = ctx.realUserId;
  }
  return row;
}

function mustDemoteAuto(previous: FollowUpConfig, next: FollowUpConfig): boolean {
  const leftAuto = previous.mode === 'auto' && next.mode !== 'auto';
  return leftAuto || (previous.enabled && !next.enabled);
}

async function demoteAutoApprovals(db: Db, userId: string, nowIso: string): Promise<number> {
  const { data } = await run(tasks(db).update({ status: 'draft', approved_at: null, approved_by: null, updated_at: nowIso })
    .eq('user_id', userId).eq('kind', 'cadence').eq('status', 'approved').eq('approved_by', 'auto').select('id'));
  return ((data || []) as Row[]).length;
}

// Inclui as etapas antes do orçamento quando a trilha está ligada: mensagem fixa ali duplicaria a retomada.
async function disableLegacyOnLadder(db: Db, userId: string, config: FollowUpConfig): Promise<string[]> {
  const preQuote = preQuoteStepCount(config) > 0 ? config.pre_quote_stage_ids : [];
  const ids = unique([...config.ladder_stage_ids, ...preQuote, config.after_last_stage_id].filter((id): id is string => !!id));
  if (!ids.length) return [];
  const { data } = await run(db.from('deal_stages').update({ auto_follow_up_enabled: false }).eq('user_id', userId)
    .in('id', ids).eq('auto_follow_up_enabled', true).select('id'));
  return ((data || []) as Row[]).map((r) => String(r.id));
}

// Modo fixo recém-ligado ou texto de um passo trocado: os follow-ups vivos daquele passo
// (rascunho, aprovado ou com problema, fora do envio) passam a usar a mensagem fixa nova.
// A aprovação fica: no envio, texto exato passa; se sair pela reserva, a conferência decide.
const RERENDER_MAX = 500;

function stepsToRerender(previous: FollowUpConfig, next: FollowUpConfig): FollowUpStep[] {
  return FOLLOWUP_STEPS.filter((step) => {
    const text = fixedTextFor(next, step);
    return !!text && (previous.message_mode !== 'fixed' || fixedTextFor(previous, step) !== text);
  });
}

async function rerenderOne(db: Db, userId: string, row: Row, config: FollowUpConfig, nowIso: string): Promise<boolean> {
  const fixed = fixedRefFor(config, Number(row.step));
  if (!fixed) return false;
  const text = renderFixedMessage(fixed.source, firstName(orNull(row.contact_name)));
  const generation_meta: CadenceGenerationMeta = {
    ...metaOf(row), fixed, outcome: 'draft', warnings: [], skip_reason: null, skipped_by: null, handoff_reason: null,
  };
  return !!(await casUpdate(db, userId, row, EDITABLE, { message: text, draft_text: text, generation_meta, updated_at: nowIso }, nowIso));
}

async function rerenderFixedLive(db: Db, userId: string, previous: FollowUpConfig, next: FollowUpConfig, nowIso: string): Promise<number> {
  const steps = stepsToRerender(previous, next);
  if (!steps.length) return 0;
  const { data } = await run(taskSelect(db, userId).in('status', EDITABLE).in('step', steps).order('id', { ascending: true }).limit(RERENDER_MAX));
  const done = await mapPool((data || []) as Row[], APPROVE_POOL, (row) => rerenderOne(db, userId, row, next, nowIso));
  return done.filter(Boolean).length;
}

async function putConfigHandler(env: Env, req: Request, res: Response): Promise<void> {
  const ctx = ctxFrom(req);
  const body: Row = isObj(req.body) ? req.body : {};
  const current = await loadConfig(env.db, ctx.userId);
  assertSupportModeAllowed(ctx, body, current.config);
  const result = await validatePut(env, ctx.userId, current.config, body);
  const nowIso = env.now().toISOString();
  // Rebaixa antes de gravar: se o upsert falhar, as aprovações automáticas já voltaram para revisão.
  const demoted = mustDemoteAuto(current.config, result.config) ? await demoteAutoApprovals(env.db, ctx.userId, nowIso) : 0;
  const row = configRow(ctx, body, current.state, result.config, current.config, nowIso);
  await run(env.db.from('followup_cadence_config').upsert(row, { onConflict: 'user_id' }));
  const legacyDisabled = body.disable_legacy_on_ladder === true ? await disableLegacyOnLadder(env.db, ctx.userId, result.config) : [];
  const rerendered = await rerenderFixedLive(env.db, ctx.userId, current.config, result.config, nowIso);
  env.services.invalidateConfig(ctx.userId);
  // Modo fixo: os templates dos passos vão para a Meta já, sem esperar o agendador.
  env.services.requestFixedTemplates?.(ctx.userId);
  res.json({ config: result.config, warnings: result.warnings, legacy_disabled: legacyDisabled, demoted_auto: demoted, fixed_rerendered: rerendered });
}

// Opt-outs

const CREATED_BY_LABELS: Record<string, string> = {
  funnel_tracker: 'Detectado na conversa',
  sweep_history: 'Detectado no histórico',
};

function createdByLabel(createdBy: unknown, labels: ApproverLabels): string | null {
  if (!createdBy) return null;
  const by = String(createdBy);
  if (CREATED_BY_LABELS[by]) return CREATED_BY_LABELS[by];
  if (by === labels.viewerId) return 'Você';
  if (by === labels.ownerId) return 'Dono da conta';
  return labels.members.get(by) || 'Alguém da equipe';
}

async function optOutItems(db: Db, ctx: FollowUpRouteCtx, rows: Row[]): Promise<FollowUpOptOut[]> {
  const [deals, labels] = await Promise.all([
    loadDealMap(db, ctx.userId, rows.map((r) => Number(r.deal_id)).filter((id) => id > 0)),
    loadLabels(db, ctx, rows.map((r) => r.created_by)),
  ]);
  return rows.map((r) => {
    const deal = deals.get(Number(r.deal_id));
    return {
      id: Number(r.id), phone: orNull(r.phone), phone_key: String(r.phone_key), contact_name: firstText(deal?.contact_name, deal?.title),
      deal_id: r.deal_id == null ? null : Number(r.deal_id), kind: r.kind, reason: orNull(r.reason),
      detected_text: orNull(r.detected_text), created_at: String(r.created_at), created_by_label: createdByLabel(r.created_by, labels),
    };
  });
}

function sanitizedText(search: string): string {
  return search.replace(/[^\p{L}\p{N} @-]/gu, ' ').replace(/\s+/g, ' ').trim();
}

// Telefone filtra direto; nome passa pelos negócios. null = nenhum resultado possível.
// Devolve uma função (e não o builder): o builder do PostgREST é thenable e seria
// executado se saísse de uma função async.
async function optOutSearchFilter(db: Db, userId: string, search: string): Promise<((query: any) => any) | null> {
  const digits = digitsOnly(search);
  if (digits.length >= 3) return (query) => query.or(`phone.like.*${digits}*,phone_key.like.*${digits}*`);
  const text = sanitizedText(search);
  if (text.length < 2) return (query) => query;
  const { data } = await run(db.from('deals').select('id').eq('user_id', userId)
    .or(`contact_name.ilike.*${text}*,title.ilike.*${text}*`).limit(200));
  const ids = ((data || []) as Row[]).map((d) => Number(d.id));
  return ids.length ? (query) => query.in('deal_id', ids) : null;
}

async function listOptOutsHandler(env: Env, req: Request, res: Response): Promise<void> {
  const ctx = ctxFrom(req);
  const search = String(firstOf(req.query.search) ?? '').trim().slice(0, 80);
  const offset = intIn(req.query.offset, 0, 100_000, 0);
  const limit = intIn(req.query.limit, 1, 100, 50);
  const filter = await optOutSearchFilter(env.db, ctx.userId, search);
  if (!filter) {
    res.json({ items: [], total: 0 });
    return;
  }
  const base = env.db.from('followup_optouts').select('*', { count: 'exact' }).eq('user_id', ctx.userId).is('revoked_at', null);
  const { data, count } = await run(filter(base).order('created_at', { ascending: false }).range(offset, offset + limit - 1));
  const rows = (data || []) as Row[];
  res.json({ items: await optOutItems(env.db, ctx, rows), total: count ?? rows.length });
}

async function insertOptOut(db: Db, ctx: FollowUpRouteCtx, input: { phone: unknown; deal_id: number | null; reason: string | null }): Promise<Row> {
  const key = canonicalPhoneKey(input.phone);
  const { data, error } = await db.from('followup_optouts').insert({
    user_id: ctx.userId, phone_key: key, phone: normalizeBrazilianPhone13(input.phone), deal_id: input.deal_id,
    kind: 'manual', reason: input.reason, created_by: ctx.realUserId,
  }).select('*').single();
  if (!error && isObj(data)) return data;
  if ((error as { code?: unknown } | null)?.code !== '23505') throw error;
  // Já estava bloqueado: devolve o ativo.
  const existing = await run(db.from('followup_optouts').select('*').eq('user_id', ctx.userId).eq('phone_key', key).is('revoked_at', null).limit(1));
  const row = ((existing.data || []) as Row[])[0];
  if (!row) throw error;
  return row;
}

async function cancelLiveForPhone(db: Db, userId: string, phoneKey: string, nowIso: string): Promise<void> {
  await run(tasks(db).update({ status: 'cancelled', last_error: 'cancel:optout', updated_at: nowIso })
    .eq('user_id', userId).eq('kind', 'cadence').eq('phone_key', phoneKey).in('status', EDITABLE));
}

function parseOptOutBody(raw: unknown): { deal_id: number | null; phone: string | null; reason: string | null } {
  const b = isObj(raw) ? raw : {};
  const dealId = positiveId(b.deal_id);
  const phone = typeof b.phone === 'string' || typeof b.phone === 'number' ? digitsOnly(b.phone) : '';
  if (!dealId && !phone) throw routeError('TEXT_INVALID', MSG.optOutTarget, { phone: MSG.optOutTarget });
  const reason = typeof b.reason === 'string' ? b.reason.trim().slice(0, 200) : '';
  return { deal_id: dealId, phone: phone || null, reason: reason || null };
}

function validOptOutPhone(phone: unknown): boolean {
  const key = canonicalPhoneKey(phone);
  return key.length >= 10 && key.length <= 13;
}

async function resolveOptOutPhone(db: Db, userId: string, input: { deal_id: number | null; phone: string | null }): Promise<string> {
  const deal = input.deal_id ? await loadDeal(db, userId, input.deal_id) : null;
  if (input.deal_id && !deal) throw routeError('NOT_FOUND', MSG.dealNotFound);
  const phone = input.phone ?? String(deal?.contact_phone ?? '');
  if (validOptOutPhone(phone)) return phone;
  const message = input.phone ? MSG.optOutPhone : MSG.dealPhone;
  throw routeError('TEXT_INVALID', message, { phone: message });
}

async function addOptOutHandler(env: Env, req: Request, res: Response): Promise<void> {
  const ctx = ctxFrom(req);
  const input = parseOptOutBody(req.body);
  const phone = await resolveOptOutPhone(env.db, ctx.userId, input);
  const row = await insertOptOut(env.db, ctx, { phone, deal_id: input.deal_id, reason: input.reason });
  await cancelLiveForPhone(env.db, ctx.userId, canonicalPhoneKey(phone), env.now().toISOString());
  const [optout] = await optOutItems(env.db, ctx, [row]);
  res.status(201).json({ optout });
}

async function removeOptOutHandler(env: Env, req: Request, res: Response): Promise<void> {
  const ctx = ctxFrom(req);
  const id = parseId(req.params.id, MSG.optOutNotFound);
  const { data } = await run(env.db.from('followup_optouts').update({ revoked_at: env.now().toISOString(), revoked_by: ctx.realUserId })
    .eq('user_id', ctx.userId).eq('id', id).is('revoked_at', null).select('id'));
  if (!((data || []) as Row[]).length) throw routeError('NOT_FOUND', MSG.optOutNotFound);
  res.json({ success: true });
}

// Revisão do funil (backfill): só dono ou admin, com prévia antes

function parseReconcileApply(raw: unknown): ReconcileApplyRequest {
  const b = isObj(raw) ? raw : {};
  const out: ReconcileApplyRequest = { include_marketing: b.include_marketing === true };
  const dealIds = idList(b.deal_ids, 300, 'deal_ids', MSG.reconcileDeals);
  if (dealIds) out.deal_ids = dealIds;
  if (b.create_phones !== undefined && b.create_phones !== null) out.create_phones = phoneList(b.create_phones);
  return out;
}

function phoneList(value: unknown): string[] {
  const phones = Array.isArray(value) ? value.map((p) => (typeof p === 'string' ? digitsOnly(p) : '')) : [''];
  const valid = phones.length <= 100 && phones.every((p) => p.length >= 10 && p.length <= 13);
  if (!valid) throw routeError('CONFIG_INVALID', MSG.reconcilePhones, { create_phones: MSG.reconcilePhones });
  return unique(phones);
}

async function reconcilePreviewHandler(env: Env, req: Request, res: Response): Promise<void> {
  const ctx = ctxFrom(req);
  const opts: { limit?: number; days?: number } = {};
  const limit = optionalInt(req.query.limit, 1, 1000);
  const days = optionalInt(req.query.days, 1, 60);
  if (limit) opts.limit = limit;
  if (days) opts.days = days;
  res.json(await env.services.reconcilePreview(ctx.userId, opts));
}

async function reconcileApplyHandler(env: Env, req: Request, res: Response): Promise<void> {
  const ctx = ctxFrom(req);
  const body = parseReconcileApply(req.body);
  res.json(await env.services.reconcileApply(ctx.userId, body, ctx.realUserId));
}

// Registro

type Handler = (req: Request, res: Response) => Promise<void>;

export function registerFollowUpRoutes(app: Express, deps: FollowUpRouteDeps): void {
  const env: Env = { db: deps.db, services: deps.services, now: deps.now ?? (() => new Date()) };
  const cache = createOverviewCache(OVERVIEW_TTL_MS);
  const locks = createSweepLocks(env, (userId) => cache.delete(userId));
  const approver = requireFollowUpApprover as RequestHandler;
  const owner = deps.requireOwnerOrPlatformAdmin;
  const read = (fn: Handler): RequestHandler => async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      sendRouteError(res, err);
    }
  };
  // Toda escrita invalida o cache do overview da conta, dê certo ou não.
  const write = (fn: Handler): RequestHandler => async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      sendRouteError(res, err);
    } finally {
      cache.delete(ctxFrom(req).userId);
    }
  };

  app.use(BASE, deps.requireAuth, deps.denyProductionOnly, deps.requirePermission('vendas'));
  app.get(`${BASE}/overview`, read((req, res) => overviewHandler(env, cache, req, res)));
  app.get(`${BASE}/queue`, read((req, res) => queueHandler(env, req, res)));
  app.get(`${BASE}/config`, read((req, res) => getConfigHandler(env, req, res)));
  app.put(`${BASE}/config`, owner, write((req, res) => putConfigHandler(env, req, res)));
  app.get(`${BASE}/optouts`, read((req, res) => listOptOutsHandler(env, req, res)));
  app.post(`${BASE}/optouts`, write((req, res) => addOptOutHandler(env, req, res)));
  app.delete(`${BASE}/optouts/:id`, owner, write((req, res) => removeOptOutHandler(env, req, res)));
  app.get(`${BASE}/reconcile/preview`, owner, read((req, res) => reconcilePreviewHandler(env, req, res)));
  app.post(`${BASE}/reconcile/apply`, owner, write((req, res) => reconcileApplyHandler(env, req, res)));
  app.get(`${BASE}/deal/:dealId`, read((req, res) => dealStateHandler(env, req, res)));
  app.post(`${BASE}/sweep`, approver, write((req, res) => sweepHandler(env, locks, req, res)));
  app.post(`${BASE}/approve-all`, approver, write((req, res) => approveAllHandler(env, req, res)));
  app.post(`${BASE}/sending`, approver, write((req, res) => sendingHandler(env, cache, req, res)));
  app.get(`${BASE}/:id/conversation`, read((req, res) => conversationHandler(env, req, res)));
  app.patch(`${BASE}/:id`, write((req, res) => patchHandler(env, req, res)));
  app.post(`${BASE}/:id/approve`, approver, write((req, res) => approveHandler(env, req, res)));
  app.post(`${BASE}/:id/skip`, write((req, res) => skipHandler(env, req, res)));
  app.post(`${BASE}/:id/regenerate`, write((req, res) => regenerateHandler(env, req, res)));

  // Painel (GET /dashboard): quadro do fluxo, números e quem espera resposta. Consultas e
  // regras ficam em followup-dashboard.ts, com cache de 30s por conta. Mesmo middleware e
  // permissão (vendas) do overview.
  const loadDashboard = createDashboardLoader({ db: env.db, now: env.now });
  app.get(`${BASE}/dashboard`, read(async (req, res) => {
    res.json(await loadDashboard(ctxFrom(req).userId));
  }));
}

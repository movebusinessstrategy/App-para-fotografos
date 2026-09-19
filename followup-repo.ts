// Banco da cadência (cliente service_role) e transporte real (Graph e QR).
// Toda consulta filtra user_id; phone_key é coluna gerada e nunca entra em
// INSERT nem UPDATE. Sem a migration 083, erro de tabela, coluna ou função vira
// CadenceMigrationMissing. O token da Meta só sai daqui decifrado.
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  CadenceGenerationMeta, CadenceStatus, CadenceTaskRow, CancelReason, ChannelKind, FollowUpConfig, FollowUpRuntimeState,
  FollowUpStep, FollowUpTrack, MoveResult,
} from './src/features/followups/types.js';
import { CUSTOMER_NON_TURN_TYPES, STUDIO_NON_TURN_TYPES } from './src/features/followups/types.js';
import type { CadenceTaskLite, DealActivity, SendSnapshot } from './followup-cadence.js';
import { activityFromRpcRow, parseCadenceConfig } from './followup-cadence.js';
import type { CadenceTemplate, GraphResult, SenderChannelHealth } from './followup-channel.js';
import type { CadenceSenderRepo, CadenceTaskPatch, OutboundRecord, SenderTransport } from './followup-sender.js';
import type { AiAgentConfigRow } from './followup-draft.js';
import type { CadenceSweepRepo, ConversationRow, LoadedConfig, OptOutInput, TaskCasOptions } from './followup-sweep.js';
import type { StageRow } from './lib/stage-rules.js';
import { brazilianPhoneVariants, canonicalPhoneKey, digitsOnly } from './lib/br-phone.js';
import { getWhatsAppChannelState } from './lib/meta-whatsapp-channel.js';

export class CadenceMigrationMissing extends Error {
  code: string;

  constructor(code: string) {
    super('Cadência de follow-up indisponível: aplique a migration 083 no Supabase.');
    this.name = 'CadenceMigrationMissing';
    this.code = code;
  }
}

export const MIGRATION_CODES: ReadonlySet<string> = new Set(['42P01', '42703', '42883', 'PGRST202', 'PGRST204', 'PGRST205']);

export function isCadenceMigrationMissing(error: unknown): boolean {
  return error instanceof CadenceMigrationMissing || (error as { name?: unknown } | null)?.name === 'CadenceMigrationMissing';
}

type BaileysStatus = 'open' | 'connecting' | 'close' | 'not_initialized';
export interface BaileysPort {
  status(key: string): BaileysStatus; registeredPhone(key: string): string | null; paired(key: string): boolean;
  sendText(key: string, jidDigits: string, text: string): Promise<string>; sendTyping(key: string, jidDigits: string, on: boolean): Promise<void>;
}
export interface FollowUpRepoDeps {
  baileys: Pick<BaileysPort, 'status' | 'registeredPhone' | 'paired'>;
  decryptToken: (blob: string | null | undefined) => string | null;
  refreshMetaState: (userId: string) => Promise<boolean>;
  mainWaNumber: (userId: string) => Promise<string>;
  now?: () => Date;
}
export interface TenantEntry { userId: string; config: FollowUpConfig; state: FollowUpRuntimeState }

export interface FollowUpRepo extends CadenceSenderRepo, CadenceSweepRepo {
  listConfigsForAutoSweep(): Promise<TenantEntry[]>;
  findTaskByMessageId(userId: string, messageId: string): Promise<CadenceTaskRow | null>;
  listTemplateRows(userId: string): Promise<CadenceTemplate[]>;
  dedupeReady(): Promise<boolean>;
  invalidate(userId: string): void;
}

type Row = Record<string, any>;
type DbError = { code?: string | null; message?: string } | null;
type DbResult = { data: unknown; error: DbError };

const TASKS = 'scheduled_followups';
const CONFIG = 'followup_cadence_config';
const OPTOUTS = 'followup_optouts';
const INBOX = 'whatsapp_webhook_inbox';
const LIVE_STATUSES: readonly CadenceStatus[] = ['draft', 'approved', 'sending', 'blocked'];
const CANCELLABLE: readonly CadenceStatus[] = ['draft', 'approved', 'blocked'];
const LEGACY_LIVE = ['pending', 'processing'];
const PAGE_SIZE = 1000;
const SWEEP_TASK_LIMIT = 5000;
const OPTOUT_LIMIT = 100_000;
const CONFIG_LIMIT = 1000;
const HEALTH_TTL_MS = 60_000;
const META_REFRESH_MS = 5 * 60_000;
const DEDUPE_OK_TTL_MS = 10 * 60_000;
// Sem a 085 a sonda volta a olhar logo: quem acabou de aplicar não espera 10 min.
const DEDUPE_MISS_TTL_MS = 60_000;
const INBOX_SKEW_MS = 5 * 60_000;
const SYNTHETIC_WINDOW_MS = 120_000;
const QUEUE_LIMIT = 20;
const STATUS_LIMIT = 50;
const SEEN_LIMIT = 20;
const STUDIO_SCAN = 10;
const GRAPH_URL = 'https://graph.facebook.com/v21.0';
const GRAPH_TIMEOUT_MS = 20_000;
const BAILEYS_TIMEOUT_MS = 30_000;
const TYPING_TIMEOUT_MS = 5_000;
const TASK_LITE_COLUMNS = 'id, deal_id, status, step, basis_at, sent_at, created_at, phone, phone_key, stage_id, track';
const TEMPLATE_COLUMNS = 'id, name, language, body_text, status, category, header_text, buttons';
const AGENT_COLUMNS = 'persona, objective, knowledge, rules, sales_strategy, attendant_name, learned_playbook, portfolio_links';
const QUEUE_SELECT = 'received_at, kind:payload->>kind, mtype:payload->message->>type';
const STATUS_SELECT = 'received_at, sid:payload->status->>id, sstatus:payload->status->>status, sts:payload->status->>timestamp';
const STUDIO_TYPE_FILTER = `type.is.null,type.not.in.(${STUDIO_NON_TURN_TYPES.join(',')})`;
const CUSTOMER_TYPE_FILTER = `type.is.null,type.not.in.(${CUSTOMER_NON_TURN_TYPES.join(',')})`;
const INVISIBLE_STATUSES = new Set(['sent', 'delivered', 'read', 'failed']);
const BAILEYS_STATUSES = new Set<BaileysStatus>(['open', 'connecting', 'close', 'not_initialized']);
const SCHEMA_MISSING_CODES = new Set(['42P01', '42703', 'PGRST204', 'PGRST205']);
const QUALITY_RANK: Record<string, number> = { NA: 0, UNKNOWN: 0, GREEN: 1, YELLOW: 2, RED: 3 };
// Rating que não conhecemos pesa como queda: bloquear é mais seguro que queimar o número.
const UNRANKED_QUALITY = 2;
const OPTOUT_REASONS: Record<'hard' | 'soft', string> = {
  hard: 'Pediu para não receber mais mensagens (achado no histórico)',
  soft: 'Demonstrou desinteresse (achado no histórico)',
};
const STATE_KEYS: ReadonlyArray<keyof FollowUpRuntimeState> = [
  'next_send_after', 'consecutive_errors', 'paused_at', 'paused_reason', 'last_error', 'last_block_code', 'last_block_message',
  'last_block_at', 'last_sweep_at', 'last_sweep_summary', 'first_enabled_at', 'external_ai_consent_at', 'external_ai_consent_by',
];
const TASK_PATCH_FIELDS = ['status', 'sent_at', 'channel_used', 'sent_message_id', 'last_error', 'approved_at', 'approved_by', 'scheduled_at'] as const;

interface RepoCtx {
  db: SupabaseClient; deps: FollowUpRepoDeps; now: () => Date;
  health: Map<string, { at: number; key: string; value: SenderChannelHealth }>;
  metaRefreshAt: Map<string, number>;
  dedupe: { at: number; ttl: number; value: boolean } | null;
}

// Utilitários

function dbError(error: NonNullable<DbError>): Error {
  const code = String(error.code ?? '');
  if (MIGRATION_CODES.has(code)) return new CadenceMigrationMissing(code);
  return Object.assign(new Error(String(error.message || 'erro no banco')), { code: error.code ?? null });
}

function check(error: DbError): void {
  if (error) throw dbError(error);
}

function codeOf(error: DbError): string {
  return String(error?.code ?? '');
}

function rowsOf(data: unknown): Row[] {
  if (Array.isArray(data)) return data as Row[];
  return data && typeof data === 'object' ? [data as Row] : [];
}

function nullableText(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function toMs(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const ms = Date.parse(String(value));
  return Number.isFinite(ms) ? ms : null;
}

function isoOrNull(value: unknown): string | null {
  const ms = toMs(value);
  return ms === null ? null : new Date(ms).toISOString();
}

function latestIso(...values: unknown[]): string | null {
  const stamps = values.map(toMs).filter((ms): ms is number => ms !== null);
  return stamps.length ? new Date(Math.max(...stamps)).toISOString() : null;
}

function parseJsonish(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function metaObject(value: unknown): CadenceGenerationMeta {
  const parsed = parseJsonish(value);
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? { ...(parsed as CadenceGenerationMeta) } : {};
}

function withoutPhoneKey(row: Record<string, unknown>): Record<string, unknown> {
  const { phone_key: _generated, ...clean } = row;
  return clean;
}

function pickState(patch: Partial<FollowUpRuntimeState>): Row {
  const out: Row = {};
  for (const key of STATE_KEYS) if (patch[key] !== undefined) out[key] = patch[key];
  return out;
}

async function paged(build: (from: number, to: number) => PromiseLike<DbResult>, limit: number): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; from < limit; from += PAGE_SIZE) {
    const to = Math.min(from + PAGE_SIZE, limit) - 1;
    const { data, error } = await build(from, to);
    check(error);
    const rows = rowsOf(data);
    out.push(...rows);
    if (rows.length < to - from + 1) break;
  }
  return out;
}

function toTaskRow(row: Row): CadenceTaskRow {
  return {
    ...row, id: Number(row.id), deal_id: Number(row.deal_id), step: Number(row.step) as FollowUpStep, track: trackOf(row.track),
    attempts: Number(row.attempts) || 0, generation_meta: metaObject(row.generation_meta),
  } as CadenceTaskRow;
}

function toTaskLite(row: Row): CadenceTaskLite {
  return {
    id: Number(row.id), deal_id: Number(row.deal_id), status: String(row.status) as CadenceStatus, step: Number(row.step) as FollowUpStep,
    basis_at: String(row.basis_at ?? ''), sent_at: nullableText(row.sent_at), created_at: String(row.created_at ?? ''),
    phone: String(row.phone ?? ''), phone_key: nullableText(row.phone_key), stage_id: String(row.stage_id ?? ''),
    track: trackOf(row.track),
  };
}

function trackOf(value: unknown): FollowUpTrack {
  return value === 'pre_quote' ? 'pre_quote' : 'ladder';
}

function toStageRow(row: Row): StageRow {
  const bool = (v: unknown) => (v === null || v === undefined ? null : v === true);
  return {
    id: String(row.id), name: String(row.name ?? row.id), position: Number(row.position) || 0,
    is_final: bool(row.is_final), is_won: bool(row.is_won), process_id: nullableText(row.process_id),
  };
}

function toTemplate(row: Row): CadenceTemplate {
  return {
    id: Number(row.id), name: String(row.name ?? ''), language: String(row.language || 'pt_BR'), bodyText: String(row.body_text ?? ''),
    status: String(row.status ?? ''), category: nullableText(row.category), headerText: nullableText(row.header_text), buttons: row.buttons ?? null,
  };
}

function toConversationRow(row: Row): ConversationRow {
  return {
    message_id: nullableText(row.message_id), body: nullableText(row.body), from_me: row.from_me === true,
    type: nullableText(row.type), transcription: nullableText(row.transcription), timestamp: String(row.timestamp ?? ''),
  };
}

function toEntry(row: Row): TenantEntry {
  const { config, state } = parseCadenceConfig(row);
  return { userId: String(row.user_id), config, state };
}

// Config e estado

async function loadConfig(db: SupabaseClient, userId: string): Promise<LoadedConfig> {
  const { data, error } = await db.from(CONFIG).select('*').eq('user_id', userId).maybeSingle();
  check(error);
  return parseCadenceConfig((data as Row | null) ?? null);
}

async function listConfigs(db: SupabaseClient, activeOnly: boolean): Promise<TenantEntry[]> {
  let query: any = db.from(CONFIG).select('*').eq('enabled', true);
  if (activeOnly) query = query.is('paused_at', null);
  const { data, error } = await query.limit(CONFIG_LIMIT);
  check(error);
  return rowsOf(data).map(toEntry);
}

async function updateState(db: SupabaseClient, userId: string, patch: Partial<FollowUpRuntimeState>): Promise<void> {
  const clean = pickState(patch);
  if (!Object.keys(clean).length) return;
  const { error } = await db.from(CONFIG).update(clean).eq('user_id', userId);
  check(error);
}

async function loadStages(db: SupabaseClient, userId: string): Promise<StageRow[]> {
  const { data, error } = await db.from('deal_stages').select('id, name, position, is_final, is_won, process_id')
    .eq('user_id', userId).order('position', { ascending: true });
  check(error);
  return rowsOf(data).map(toStageRow);
}

// 'unassigned:*' é o marcador do servidor para número ainda não conhecido.
async function resolveMainWaNumber(deps: FollowUpRepoDeps, userId: string, config: FollowUpConfig): Promise<string | null> {
  let raw: unknown = config.wa_number;
  if (!raw) {
    try {
      raw = await deps.mainWaNumber(userId);
    } catch {
      raw = '';
    }
  }
  const text = String(raw ?? '').trim();
  if (!text || text.toLowerCase().startsWith('unassigned:')) return null;
  const digits = digitsOnly(text);
  return digits.length >= 10 ? digits : null;
}

// Varredura

async function candidates(db: SupabaseClient, userId: string, stageIds: string[], waNumbers: string[], lookbackHours: number, limit: number): Promise<DealActivity[]> {
  const { data, error } = await db.rpc('followup_cadence_candidates', {
    p_user_id: userId, p_stage_ids: stageIds, p_wa_numbers: waNumbers.length ? waNumbers : null,
    p_lookback_hours: Math.round(lookbackHours), p_limit: limit,
  });
  check(error);
  return rowsOf(data).map(activityFromRpcRow);
}

async function sweepTasks(db: SupabaseClient, userId: string, sinceIso: string): Promise<CadenceTaskLite[]> {
  const filter = `status.in.(${LIVE_STATUSES.join(',')}),created_at.gt.${sinceIso}`;
  const rows = await paged((from, to) => db.from(TASKS).select(TASK_LITE_COLUMNS).eq('user_id', userId).eq('kind', 'cadence')
    .or(filter).order('id', { ascending: true }).range(from, to), SWEEP_TASK_LIMIT);
  return rows.map(toTaskLite);
}

async function liveLegacyDealIds(db: SupabaseClient, userId: string): Promise<Set<number>> {
  const rows = await paged((from, to) => db.from(TASKS).select('deal_id').eq('user_id', userId).eq('kind', 'legacy')
    .in('status', LEGACY_LIVE).order('id', { ascending: true }).range(from, to), SWEEP_TASK_LIMIT);
  return new Set(rows.map((row) => Number(row.deal_id)));
}

async function optoutKeys(db: SupabaseClient, userId: string): Promise<Set<string>> {
  const rows = await paged((from, to) => db.from(OPTOUTS).select('phone_key').eq('user_id', userId).is('revoked_at', null)
    .order('id', { ascending: true }).range(from, to), OPTOUT_LIMIT);
  return new Set(rows.map((row) => String(row.phone_key ?? '')).filter(Boolean));
}

// O motivo vai para generation_meta.cancel_reason (mesclado aqui) e para last_error.
async function cancelOne(ctx: RepoCtx, userId: string, item: { id: number; reason: CancelReason }, meta: CadenceGenerationMeta): Promise<boolean> {
  const nowIso = ctx.now().toISOString();
  const { data, error } = await ctx.db.from(TASKS)
    .update({ status: 'cancelled', last_error: `cancel:${item.reason}`, generation_meta: { ...meta, cancel_reason: item.reason }, updated_at: nowIso })
    .eq('id', item.id).eq('user_id', userId).eq('kind', 'cadence').in('status', CANCELLABLE).select('id');
  check(error);
  return rowsOf(data).length > 0;
}

async function cancelTasks(ctx: RepoCtx, userId: string, items: Array<{ id: number; reason: CancelReason }>): Promise<number[]> {
  if (!items.length) return [];
  const { data, error } = await ctx.db.from(TASKS).select('id, generation_meta').eq('user_id', userId).eq('kind', 'cadence')
    .in('id', items.map((item) => Number(item.id)));
  check(error);
  const metaById = new Map(rowsOf(data).map((row) => [Number(row.id), metaObject(row.generation_meta)]));
  const done: number[] = [];
  for (const item of items) {
    const meta = metaById.get(Number(item.id));
    if (meta && await cancelOne(ctx, userId, item, meta)) done.push(Number(item.id));
  }
  return done;
}

async function loadConversationRows(db: SupabaseClient, userId: string, phone: string, waNumbers: string[], limit: number): Promise<ConversationRow[]> {
  const variants = brazilianPhoneVariants(phone);
  if (!variants.length || !waNumbers.length) return [];
  const { data, error } = await db.from('wa_messages').select('message_id, body, from_me, type, transcription, timestamp')
    .eq('user_id', userId).in('wa_number', waNumbers).in('phone', variants).order('timestamp', { ascending: false }).limit(limit);
  check(error);
  return rowsOf(data).reverse().map(toConversationRow);
}

async function loadAgentConfig(db: SupabaseClient, userId: string): Promise<AiAgentConfigRow | null> {
  // ai_agent_config.user_id é TEXT.
  const { data, error } = await db.from('ai_agent_config').select(AGENT_COLUMNS).eq('user_id', String(userId)).maybeSingle();
  check(error);
  return data ? (data as AiAgentConfigRow) : null;
}

async function insertTask(db: SupabaseClient, row: Record<string, unknown>): Promise<'ok' | 'duplicate'> {
  const { error } = await db.from(TASKS).insert(withoutPhoneKey(row));
  if (!error) return 'ok';
  if (codeOf(error) === '23505') return 'duplicate';
  throw dbError(error);
}

async function upsertOptOut(db: SupabaseClient, userId: string, input: OptOutInput): Promise<void> {
  const phoneKey = canonicalPhoneKey(input.phone);
  if (!/^\d{8,15}$/.test(phoneKey)) return;
  const { error } = await db.from(OPTOUTS).insert({
    user_id: userId, phone_key: phoneKey, phone: digitsOnly(input.phone) || null, deal_id: input.dealId, kind: input.kind,
    reason: OPTOUT_REASONS[input.kind], detected_text: input.text, source_message_id: input.messageId, created_by: 'sweep_history',
  });
  // 23505: já existe um opt-out ativo para o telefone.
  if (error && codeOf(error) !== '23505') throw dbError(error);
}

async function runRetention(db: SupabaseClient, userId: string, days: number): Promise<number> {
  const { data, error } = await db.rpc('followup_cadence_retention', { p_user_id: userId, p_days: days });
  check(error);
  return Number(data) || 0;
}

async function loadTask(db: SupabaseClient, userId: string, id: number): Promise<CadenceTaskRow | null> {
  const { data, error } = await db.from(TASKS).select('*').eq('user_id', userId).eq('kind', 'cadence').eq('id', id).maybeSingle();
  check(error);
  return data ? toTaskRow(data as Row) : null;
}

async function updateTaskCas(db: SupabaseClient, id: number, userId: string, patch: Record<string, unknown>, opts: TaskCasOptions): Promise<CadenceTaskRow | null> {
  let query: any = db.from(TASKS).update(withoutPhoneKey(patch)).eq('id', id).eq('user_id', userId).eq('kind', 'cadence')
    .in('status', opts.statuses);
  if (opts.updatedAt) query = query.eq('updated_at', opts.updatedAt);
  if (opts.noLiveLeaseAt) query = query.or(`claimed_at.is.null,lease_expires_at.lt.${opts.noLiveLeaseAt}`);
  const { data, error } = await query.select('*');
  // Outra tarefa viva do mesmo deal ou telefone ocupa a vaga: é conflito, não erro.
  if (codeOf(error) === '23505') return null;
  check(error);
  const row = rowsOf(data)[0];
  return row ? toTaskRow(row) : null;
}

async function lastCustomerTurnAt(db: SupabaseClient, userId: string, phone: string): Promise<string | null> {
  const variants = brazilianPhoneVariants(phone);
  if (!variants.length) return null;
  const { data, error } = await db.from('wa_messages').select('timestamp').eq('user_id', userId).eq('from_me', false)
    .in('phone', variants).or(CUSTOMER_TYPE_FILTER).order('timestamp', { ascending: false }).limit(1);
  check(error);
  return isoOrNull(rowsOf(data)[0]?.timestamp);
}

// Snapshot do envio: tudo relido do banco logo antes de encostar no WhatsApp.

async function snapDeal(db: SupabaseClient, userId: string, dealId: number): Promise<SendSnapshot['deal']> {
  const { data, error } = await db.from('deals').select('id, stage, converted, converted_job_id, contact_name')
    .eq('user_id', userId).eq('id', dealId).maybeSingle();
  check(error);
  if (!data) return null;
  const row = data as Row;
  return {
    id: Number(row.id), stage: String(row.stage ?? ''), converted: row.converted === true,
    converted_job_id: row.converted_job_id == null ? null : Number(row.converted_job_id), contact_name: nullableText(row.contact_name),
  };
}

async function snapStudioAt(db: SupabaseClient, userId: string, variants: string[], waNumbers: string[]): Promise<string | null> {
  if (!variants.length || !waNumbers.length) return null;
  const { data, error } = await db.from('wa_messages').select('timestamp, status').eq('user_id', userId).eq('from_me', true)
    .in('phone', variants).in('wa_number', waNumbers).or(STUDIO_TYPE_FILTER).order('timestamp', { ascending: false }).limit(STUDIO_SCAN);
  check(error);
  const row = rowsOf(data).find((r) => r.status !== 'failed');
  return row ? isoOrNull(row.timestamp) : null;
}

async function snapLegacySentAt(db: SupabaseClient, userId: string, phoneKey: string): Promise<string | null> {
  if (!phoneKey) return null;
  const { data, error } = await db.from(TASKS).select('sent_at').eq('user_id', userId).eq('kind', 'legacy').eq('status', 'sent')
    .eq('phone_key', phoneKey).not('sent_at', 'is', null).order('sent_at', { ascending: false }).limit(1);
  check(error);
  return isoOrNull(rowsOf(data)[0]?.sent_at);
}

function schemaMissing(error: DbError): boolean {
  return SCHEMA_MISSING_CODES.has(codeOf(error));
}

function queueTurns(rows: Row[]): { customerAt: string | null; studioAt: string | null } {
  let customerAt: string | null = null;
  let studioAt: string | null = null;
  for (const row of rows) {
    const type = String(row.mtype ?? '');
    if (row.kind === 'message' && !CUSTOMER_NON_TURN_TYPES.includes(type)) customerAt = latestIso(customerAt, row.received_at);
    if (row.kind === 'smb_message_echo' && !STUDIO_NON_TURN_TYPES.includes(type)) studioAt = latestIso(studioAt, row.received_at);
  }
  return { customerAt, studioAt };
}

// Webhook ainda na fila (não processado): a fala já aconteceu, só não chegou em wa_messages.
async function snapQueue(db: SupabaseClient, userId: string, variants: string[], sinceIso: string): Promise<{ customerAt: string | null; studioAt: string | null }> {
  if (!variants.length) return { customerAt: null, studioAt: null };
  const { data, error } = await db.from(INBOX).select(QUEUE_SELECT).eq('user_id', userId).neq('status', 'processed')
    .gt('received_at', sinceIso).in('payload->>kind', ['message', 'smb_message_echo'])
    .in('payload->message->>customerPhone', variants).order('received_at', { ascending: false }).limit(QUEUE_LIMIT);
  if (schemaMissing(error)) return { customerAt: null, studioAt: null };
  check(error);
  return queueTurns(rowsOf(data));
}

interface StatusGroup { sentMs: number | null; firstMs: number | null; failed: boolean }

function unixMs(value: unknown): number | null {
  const text = String(value ?? '');
  return /^\d{9,11}$/.test(text) ? Number(text) * 1000 : null;
}

function minMs(current: number | null, value: number): number {
  return current === null ? value : Math.min(current, value);
}

function addStatus(groups: Map<string, StatusGroup>, row: Row): void {
  const id = String(row.sid ?? '');
  const status = String(row.sstatus ?? '');
  const ms = unixMs(row.sts);
  if (!id || !INVISIBLE_STATUSES.has(status) || ms === null) return;
  const group = groups.get(id) ?? { sentMs: null, firstMs: null, failed: false };
  group.firstMs = minMs(group.firstMs, ms);
  if (status === 'sent') group.sentMs = minMs(group.sentMs, ms);
  if (status === 'failed') group.failed = true;
  groups.set(id, group);
}

// Envio da IA oficial: agrupado por wamid, no instante do 'sent' (ou do 1º status), sem 'failed'.
export function invisibleCandidates(rows: Row[]): Array<{ id: string; atMs: number }> {
  const groups = new Map<string, StatusGroup>();
  for (const row of rows) addStatus(groups, row);
  const out: Array<{ id: string; atMs: number }> = [];
  for (const [id, group] of groups) {
    const atMs = group.sentMs ?? group.firstMs;
    if (!group.failed && atMs !== null) out.push({ id, atMs });
  }
  return out;
}

async function knownMessageIds(db: SupabaseClient, userId: string, ids: string[]): Promise<Set<string>> {
  const { data, error } = await db.from('wa_messages').select('message_id').eq('user_id', userId).in('message_id', ids);
  check(error);
  return new Set(rowsOf(data).map((row) => String(row.message_id ?? '')));
}

// Ids sintéticos (auto-, blast-) gravam from_me no mesmo instante do status real.
async function ownOutboundTimes(db: SupabaseClient, userId: string, variants: string[], found: Array<{ atMs: number }>): Promise<number[]> {
  const stamps = found.map((c) => c.atMs);
  const { data, error } = await db.from('wa_messages').select('timestamp').eq('user_id', userId).eq('from_me', true).in('phone', variants)
    .gte('timestamp', new Date(Math.min(...stamps) - SYNTHETIC_WINDOW_MS).toISOString())
    .lte('timestamp', new Date(Math.max(...stamps) + SYNTHETIC_WINDOW_MS).toISOString()).limit(200);
  check(error);
  return rowsOf(data).map((row) => toMs(row.timestamp)).filter((ms): ms is number => ms !== null);
}

async function statusRows(db: SupabaseClient, userId: string, variants: string[], waNumbers: string[], sinceIso: string): Promise<Row[]> {
  let query: any = db.from(INBOX).select(STATUS_SELECT).eq('user_id', userId).gte('received_at', sinceIso)
    .eq('payload->>kind', 'status').in('payload->status->>recipient_id', variants);
  if (waNumbers.length) query = query.in('wa_number', waNumbers);
  const { data, error } = await query.order('received_at', { ascending: false }).limit(STATUS_LIMIT);
  if (schemaMissing(error)) return [];
  check(error);
  return rowsOf(data);
}

async function snapInvisible(db: SupabaseClient, userId: string, variants: string[], waNumbers: string[], sinceIso: string): Promise<string | null> {
  if (!variants.length) return null;
  const found = invisibleCandidates(await statusRows(db, userId, variants, waNumbers, sinceIso));
  if (!found.length) return null;
  const [known, own] = await Promise.all([
    knownMessageIds(db, userId, found.map((c) => c.id)),
    ownOutboundTimes(db, userId, variants, found),
  ]);
  const kept = found.filter((c) => !known.has(c.id) && !own.some((ms) => Math.abs(ms - c.atMs) <= SYNTHETIC_WINDOW_MS));
  return kept.length ? new Date(Math.max(...kept.map((c) => c.atMs))).toISOString() : null;
}

async function snapOptedOut(db: SupabaseClient, userId: string, phoneKey: string): Promise<boolean> {
  const { data, error } = await db.from(OPTOUTS).select('id').eq('user_id', userId).eq('phone_key', phoneKey).is('revoked_at', null).limit(1);
  check(error);
  return rowsOf(data).length > 0;
}

async function customerKeys(db: SupabaseClient, userId: string): Promise<Set<string>> {
  const { data, error } = await db.rpc('followup_customer_phone_keys', { p_user_id: userId });
  check(error);
  return new Set(rowsOf(data).map((row) => String(row.phone_key ?? '')).filter(Boolean));
}

async function snapConversations(db: SupabaseClient, userId: string, variants: string[], waNumbers: string[]): Promise<Row[]> {
  if (!variants.length || !waNumbers.length) return [];
  const { data, error } = await db.from('wa_conversations').select('phone, wa_number, needs_human, agent_status, last_message_at')
    .eq('user_id', userId).in('phone', variants).in('wa_number', waNumbers).limit(10);
  check(error);
  return rowsOf(data);
}

async function snapSeenPhones(db: SupabaseClient, userId: string, variants: string[], waNumbers: string[]): Promise<string[]> {
  if (!variants.length || !waNumbers.length) return [];
  const { data, error } = await db.from('wa_messages').select('phone').eq('user_id', userId).in('phone', variants)
    .in('wa_number', waNumbers).not('message_id', 'like', 'wamid.%').order('timestamp', { ascending: false }).limit(SEEN_LIMIT);
  check(error);
  return [...new Set(rowsOf(data).map((row) => digitsOnly(row.phone)).filter(Boolean))];
}

function pickConversation(rows: Row[], seen: string[]): Row | null {
  const sorted = [...rows].sort((a, b) => (toMs(b.last_message_at) ?? 0) - (toMs(a.last_message_at) ?? 0));
  return sorted.find((row) => seen.includes(digitsOnly(row.phone))) ?? sorted[0] ?? null;
}

// 'human_active' = alguém assumiu a conversa: a cadência respeita como a Lia, até "Devolver pra Lia".
const HUMAN_STATUSES = new Set(['needs_human', 'human_active']);

export function needsHuman(rows: Row[]): boolean {
  return rows.some((row) => row.needs_human === true || HUMAN_STATUSES.has(String(row.agent_status)));
}

async function loadSendSnapshot(ctx: RepoCtx, task: CadenceTaskRow, waNumbers: string[]): Promise<SendSnapshot> {
  const { db } = ctx;
  const userId = task.user_id;
  const variants = brazilianPhoneVariants(task.phone);
  const phoneKey = task.phone_key || canonicalPhoneKey(task.phone);
  const sinceIso = new Date((toMs(task.basis_at) ?? ctx.now().getTime()) - INBOX_SKEW_MS).toISOString();
  const [deal, stages, customerAt, studioAt, legacyAt, queue, invisibleAt, optedOut, keys, conversations, seen] = await Promise.all([
    snapDeal(db, userId, Number(task.deal_id)), loadStages(db, userId), lastCustomerTurnAt(db, userId, task.phone),
    snapStudioAt(db, userId, variants, waNumbers), snapLegacySentAt(db, userId, phoneKey), snapQueue(db, userId, variants, sinceIso),
    snapInvisible(db, userId, variants, waNumbers, sinceIso), snapOptedOut(db, userId, phoneKey), customerKeys(db, userId),
    snapConversations(db, userId, variants, waNumbers), snapSeenPhones(db, userId, variants, waNumbers),
  ]);
  const conversation = pickConversation(conversations, seen);
  return {
    deal, stages,
    lastCustomerAt: latestIso(customerAt, queue.customerAt),
    lastStudioAt: latestIso(studioAt, legacyAt, queue.studioAt),
    lastInvisibleOutAt: invisibleAt,
    optedOut, alreadyCustomer: keys.has(phoneKey), needsHuman: needsHuman(conversations),
    conversationPhone: String(conversation?.phone || task.phone),
    conversationWaNumber: digitsOnly(conversation?.wa_number) || digitsOnly(task.wa_number) || waNumbers[0] || '',
    seenBaileysPhones: seen,
  };
}

// Saúde dos canais

async function activeMetaAccount(db: SupabaseClient, userId: string): Promise<Row | null> {
  const { data, error } = await db.from('whatsapp_business_accounts').select('phone_number_id, phone_number, access_token, token_expires_at')
    .eq('user_id', userId).eq('is_active', true).limit(1).maybeSingle();
  check(error);
  return (data as Row | null) ?? null;
}

export function worstQuality(values: unknown[]): string | null {
  let worst: string | null = null;
  let rank = -1;
  for (const value of values) {
    const quality = String(value ?? '').trim().toUpperCase();
    const weight = QUALITY_RANK[quality] ?? UNRANKED_QUALITY;
    if (quality && weight > rank) {
      worst = quality;
      rank = weight;
    }
  }
  return worst;
}

async function qualityRating(db: SupabaseClient, userId: string, phoneNumberId: unknown): Promise<string | null> {
  if (!phoneNumberId) return null;
  const { data, error } = await db.from('whatsapp_channel_accounts').select('sync_details, mode')
    .eq('user_id', userId).eq('phone_number_id', String(phoneNumberId)).limit(10);
  // Sem a 072 não há medição: qualidade desconhecida não é queda.
  if (schemaMissing(error)) return null;
  check(error);
  return worstQuality(rowsOf(data).map((row) => (metaObject(row.sync_details) as Row).phone_status?.quality_rating));
}

async function maybeRefreshMeta(ctx: RepoCtx, userId: string): Promise<void> {
  const nowMs = ctx.now().getTime();
  const last = ctx.metaRefreshAt.get(userId);
  if (last !== undefined && nowMs - last < META_REFRESH_MS) return;
  ctx.metaRefreshAt.set(userId, nowMs);
  try {
    await ctx.deps.refreshMetaState(userId);
  } catch { /* vale o último estado gravado até a próxima tentativa */ }
}

async function channelState(ctx: RepoCtx, userId: string, baileysOpen: boolean) {
  try {
    return await getWhatsAppChannelState(ctx.db, userId, baileysOpen);
  } catch {
    return null;
  }
}

function baileysHealth(deps: FollowUpRepoDeps, userId: string): SenderChannelHealth['baileys'] {
  try {
    const status = deps.baileys.status(userId);
    return {
      status: BAILEYS_STATUSES.has(status) ? status : 'not_initialized',
      waNumber: digitsOnly(deps.baileys.registeredPhone(userId)) || null,
      paired: deps.baileys.paired(userId) === true,
    };
  } catch {
    return { status: 'not_initialized', waNumber: null, paired: false };
  }
}

function safeDecrypt(deps: FollowUpRepoDeps, blob: unknown): string | null {
  try {
    return deps.decryptToken(nullableText(blob)) || null;
  } catch {
    return null;
  }
}

type ChannelState = Awaited<ReturnType<typeof getWhatsAppChannelState>> | null;

function metaHealth(deps: FollowUpRepoDeps, account: Row | null, state: ChannelState, quality: string | null): SenderChannelHealth['meta'] {
  if (!account) {
    return { configured: false, phoneNumberId: null, waNumber: null, token: null, tokenExpiresAt: null, operational: false, qualityRating: null };
  }
  return {
    configured: !!account.phone_number_id, phoneNumberId: nullableText(account.phone_number_id),
    waNumber: digitsOnly(account.phone_number) || digitsOnly(state?.wa_number) || null,
    token: safeDecrypt(deps, account.access_token), tokenExpiresAt: isoOrNull(account.token_expires_at),
    operational: state?.meta_operational === true, qualityRating: quality,
  };
}

async function probeDedupe(db: SupabaseClient): Promise<boolean> {
  try {
    const { error } = await db.rpc('wa_message_key_id', { raw: 'x' });
    return !error;
  } catch {
    return false;
  }
}

async function dedupeReadyCached(ctx: RepoCtx): Promise<boolean> {
  const nowMs = ctx.now().getTime();
  if (ctx.dedupe && nowMs - ctx.dedupe.at < ctx.dedupe.ttl) return ctx.dedupe.value;
  const value = await probeDedupe(ctx.db);
  ctx.dedupe = { at: nowMs, value, ttl: value ? DEDUPE_OK_TTL_MS : DEDUPE_MISS_TTL_MS };
  return value;
}

async function buildHealth(ctx: RepoCtx, userId: string, config: FollowUpConfig): Promise<SenderChannelHealth> {
  const account = await activeMetaAccount(ctx.db, userId);
  // Refresh antes do estado: o operacional só vale com checagem de até 5 min.
  if (account) await maybeRefreshMeta(ctx, userId);
  const baileys = baileysHealth(ctx.deps, userId);
  const [state, quality, main, dedupeReady] = await Promise.all([
    channelState(ctx, userId, baileys.status === 'open'),
    account ? qualityRating(ctx.db, userId, account.phone_number_id) : Promise.resolve(null),
    resolveMainWaNumber(ctx.deps, userId, config),
    dedupeReadyCached(ctx),
  ]);
  return {
    meta: metaHealth(ctx.deps, account, state, quality), baileys, mainWaNumber: main,
    preferredChannel: account ? state?.preferred_channel ?? null : null, dedupeReady,
  };
}

async function loadHealth(ctx: RepoCtx, userId: string, config: FollowUpConfig): Promise<SenderChannelHealth> {
  const key = String(config.wa_number ?? '');
  const nowMs = ctx.now().getTime();
  const cached = ctx.health.get(userId);
  if (cached && cached.key === key && nowMs - cached.at < HEALTH_TTL_MS) return cached.value;
  const value = await buildHealth(ctx, userId, config);
  ctx.health.set(userId, { at: nowMs, key, value });
  return value;
}

// Templates

async function loadTemplate(db: SupabaseClient, userId: string, templateId: number): Promise<CadenceTemplate | null> {
  const { data, error } = await db.from('whatsapp_message_templates').select(TEMPLATE_COLUMNS)
    .eq('user_id', String(userId)).eq('id', templateId).maybeSingle();
  check(error);
  return data ? toTemplate(data as Row) : null;
}

async function listTemplateRows(db: SupabaseClient, userId: string): Promise<CadenceTemplate[]> {
  const { data, error } = await db.from('whatsapp_message_templates').select(TEMPLATE_COLUMNS)
    .eq('user_id', String(userId)).order('name', { ascending: true }).limit(200);
  check(error);
  return rowsOf(data).map(toTemplate);
}

// Sender: claim, prova, desfecho

async function claim(db: SupabaseClient, userId: string, workerId: string, leaseSeconds: number, gapSeconds: number, dayStartIso: string): Promise<CadenceTaskRow | null> {
  const { data, error } = await db.rpc('claim_cadence_followup', {
    p_user_id: userId, p_worker_id: workerId, p_lease_seconds: leaseSeconds, p_gap_seconds: gapSeconds, p_day_start: dayStartIso,
  });
  check(error);
  const row = rowsOf(data)[0];
  return row ? toTaskRow(row) : null;
}

// claimed_at vem cru do banco (microssegundos): a igualdade só casa com o valor original.
function whereClaim(query: any, claimedAt: string | null): any {
  return claimedAt == null ? query.is('claimed_at', null) : query.eq('claimed_at', claimedAt);
}

function sendingTask(db: SupabaseClient, task: CadenceTaskRow, update: Row): any {
  const query = db.from(TASKS).update(update).eq('id', task.id).eq('user_id', task.user_id).eq('kind', 'cadence').eq('status', 'sending');
  return whereClaim(query, task.claimed_at);
}

export function taskUpdate(patch: CadenceTaskPatch, baseMeta: CadenceGenerationMeta, nowIso: string): Row {
  const out: Row = { updated_at: nowIso };
  for (const key of TASK_PATCH_FIELDS) if (patch[key] !== undefined) out[key] = patch[key];
  if (patch.release_claim) Object.assign(out, { claimed_at: null, claimed_by: null, lease_expires_at: null });
  if (patch.generation_meta_merge) out.generation_meta = { ...baseMeta, ...patch.generation_meta_merge };
  return out;
}

async function recordDeliveryProof(ctx: RepoCtx, task: CadenceTaskRow, proof: { message_ids: string[]; channel: ChannelKind; delivered_text: string }): Promise<boolean> {
  const nowIso = ctx.now().toISOString();
  const delivery = { message_ids: [...proof.message_ids], delivered_text: proof.delivered_text, channel: proof.channel, proof_at: nowIso };
  const update = {
    sent_message_id: proof.message_ids[0] ?? null, channel_used: proof.channel,
    generation_meta: { ...(task.generation_meta ?? {}), delivery }, updated_at: nowIso,
  };
  const { data, error } = await sendingTask(ctx.db, task, update).select('id');
  check(error);
  return rowsOf(data).length > 0;
}

async function finish(ctx: RepoCtx, task: CadenceTaskRow, patch: CadenceTaskPatch): Promise<boolean> {
  const update = taskUpdate(patch, task.generation_meta ?? {}, ctx.now().toISOString());
  const { data, error } = await sendingTask(ctx.db, task, update).select('id');
  check(error);
  return rowsOf(data).length > 0;
}

// A tarefa mudou enquanto saía (ex.: foi reescrita): mescla sobre o que está no banco.
async function forceMarkSent(ctx: RepoCtx, task: CadenceTaskRow, patch: CadenceTaskPatch): Promise<void> {
  const current = await ctx.db.from(TASKS).select('generation_meta').eq('id', task.id).eq('user_id', task.user_id).maybeSingle();
  check(current.error);
  const baseMeta = metaObject((current.data as Row | null)?.generation_meta ?? task.generation_meta);
  const { error } = await ctx.db.from(TASKS).update(taskUpdate(patch, baseMeta, ctx.now().toISOString()))
    .eq('id', task.id).eq('user_id', task.user_id).eq('kind', 'cadence').neq('status', 'sent');
  check(error);
}

async function touchConversation(db: SupabaseClient, r: OutboundRecord): Promise<void> {
  const { data, error } = await db.from('wa_conversations').select('id').eq('user_id', r.userId)
    .in('phone', brazilianPhoneVariants(r.phone)).in('wa_number', brazilianPhoneVariants(r.waNumber)).limit(10);
  check(error);
  const ids = rowsOf(data).map((row) => row.id);
  const patch = { last_message: r.body, last_message_at: r.timestampIso, last_from_me: true, updated_at: r.timestampIso };
  if (!ids.length) {
    const inserted = await db.from('wa_conversations').insert({ user_id: r.userId, phone: r.phone, wa_number: r.waNumber, ...patch });
    if (inserted.error && codeOf(inserted.error) !== '23505') throw dbError(inserted.error);
    return;
  }
  // Só avança: se o cliente respondeu no meio, a conversa não volta para trás.
  const updated = await db.from('wa_conversations').update(patch).eq('user_id', r.userId).in('id', ids)
    .or(`last_message_at.is.null,last_message_at.lt.${r.timestampIso}`);
  check(updated.error);
}

// Sem unread_count, agent_status nem markHumanActive: é o estúdio falando, não uma pessoa.
async function persistOutbound(db: SupabaseClient, r: OutboundRecord): Promise<void> {
  const { error } = await db.from('wa_messages').insert({
    user_id: r.userId, phone: r.phone, message_id: r.messageId, body: r.body, from_me: true, timestamp: r.timestampIso,
    type: 'text', status: 'sent', wa_number: r.waNumber,
  });
  if (error && codeOf(error) !== '23505') throw dbError(error);
  await touchConversation(db, r);
}

async function listPendingAdvances(db: SupabaseClient, userId: string, nowIso: string, limit: number): Promise<CadenceTaskRow[]> {
  const { data, error } = await db.from(TASKS).select('*').eq('user_id', userId).eq('kind', 'cadence').eq('status', 'sent')
    .eq('generation_meta->advance->>state', 'pending').lte('generation_meta->advance->>due_at', nowIso)
    .order('sent_at', { ascending: true }).limit(limit);
  check(error);
  return rowsOf(data).map(toTaskRow);
}

async function markAdvance(ctx: RepoCtx, task: CadenceTaskRow, state: 'done' | 'skipped', result: MoveResult | null): Promise<void> {
  const meta = task.generation_meta ?? {};
  const advance = { due_at: ctx.now().toISOString(), ...(meta.advance ?? {}), state, result };
  const { error } = await ctx.db.from(TASKS).update({ generation_meta: { ...meta, advance }, updated_at: ctx.now().toISOString() })
    .eq('id', task.id).eq('user_id', task.user_id).eq('kind', 'cadence').eq('status', 'sent')
    .eq('generation_meta->advance->>state', 'pending');
  check(error);
}

// Falha assíncrona (status 'failed' da Meta): acha a tarefa pelo wamid de qualquer balão.
async function findTaskByMessageId(db: SupabaseClient, userId: string, messageId: string): Promise<CadenceTaskRow | null> {
  if (!messageId) return null;
  const direct = await db.from(TASKS).select('*').eq('user_id', userId).eq('kind', 'cadence').eq('sent_message_id', messageId).limit(1);
  check(direct.error);
  const hit = rowsOf(direct.data)[0];
  if (hit) return toTaskRow(hit);
  const nested = await db.from(TASKS).select('*').eq('user_id', userId).eq('kind', 'cadence')
    .contains('generation_meta', { delivery: { message_ids: [messageId] } }).limit(1);
  check(nested.error);
  const row = rowsOf(nested.data)[0];
  return row ? toTaskRow(row) : null;
}

export function createFollowUpRepo(db: SupabaseClient, deps: FollowUpRepoDeps): FollowUpRepo {
  const ctx: RepoCtx = { db, deps, now: deps.now ?? (() => new Date()), health: new Map(), metaRefreshAt: new Map(), dedupe: null };
  return {
    // Config e estado
    loadConfig: (userId) => loadConfig(db, userId),
    listActiveConfigs: () => listConfigs(db, true),
    listConfigsForAutoSweep: () => listConfigs(db, false),
    updateState: (userId, patch) => updateState(db, userId, patch),
    saveSweepState: (userId, patch) => updateState(db, userId, patch),
    loadStages: (userId) => loadStages(db, userId),
    mainWaNumber: (userId, config) => resolveMainWaNumber(deps, userId, config),
    // Varredura
    candidates: (userId, stageIds, waNumbers, lookbackHours, limit) => candidates(db, userId, stageIds, waNumbers, lookbackHours, limit),
    sweepTasks: (userId, sinceIso) => sweepTasks(db, userId, sinceIso),
    liveLegacyDealIds: (userId) => liveLegacyDealIds(db, userId),
    optoutKeys: (userId) => optoutKeys(db, userId),
    cancelTasks: (userId, items) => cancelTasks(ctx, userId, items),
    loadConversationRows: (userId, phone, waNumbers, limit) => loadConversationRows(db, userId, phone, waNumbers, limit),
    loadAgentConfig: (userId) => loadAgentConfig(db, userId),
    insertTask: (row) => insertTask(db, row),
    upsertOptOut: (userId, input) => upsertOptOut(db, userId, input),
    runRetention: (userId, days) => runRetention(db, userId, days),
    loadTask: (userId, id) => loadTask(db, userId, id),
    updateTaskCas: (id, userId, patch, opts) => updateTaskCas(db, id, userId, patch, opts),
    lastCustomerTurnAt: (userId, phone) => lastCustomerTurnAt(db, userId, phone),
    // Sender
    claim: (userId, workerId, leaseSeconds, gapSeconds, dayStartIso) => claim(db, userId, workerId, leaseSeconds, gapSeconds, dayStartIso),
    loadSendSnapshot: (task, waNumbers) => loadSendSnapshot(ctx, task, waNumbers),
    loadHealth: (userId, config) => loadHealth(ctx, userId, config),
    loadTemplate: (userId, templateId) => loadTemplate(db, userId, templateId),
    recordDeliveryProof: (task, proof) => recordDeliveryProof(ctx, task, proof),
    persistOutbound: (r) => persistOutbound(db, r),
    finish: (task, patch) => finish(ctx, task, patch),
    forceMarkSent: (task, patch) => forceMarkSent(ctx, task, patch),
    listPendingAdvances: (userId, nowIso, limit) => listPendingAdvances(db, userId, nowIso, limit),
    markAdvance: (task, state, result) => markAdvance(ctx, task, state, result),
    // Serviços
    findTaskByMessageId: (userId, messageId) => findTaskByMessageId(db, userId, messageId),
    listTemplateRows: (userId) => listTemplateRows(db, userId),
    dedupeReady: () => dedupeReadyCached(ctx),
    invalidate: (userId) => {
      ctx.health.delete(userId);
      ctx.dedupe = null;
    },
  };
}

// Transporte real

export interface TransportDeps {
  baileys: Pick<BaileysPort, 'sendText' | 'sendTyping'>;
  fetch?: typeof fetch;
  graphTimeoutMs?: number;
  baileysTimeoutMs?: number;
}

function withTimeout<T>(work: () => Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([Promise.resolve().then(work), timeout]).finally(() => clearTimeout(timer));
}

async function readJson(response: Response): Promise<Row | null> {
  try {
    const body = await response.json();
    return body && typeof body === 'object' ? (body as Row) : null;
  } catch {
    return null;
  }
}

// Sem corpo legível ou sem id, a Graph pode ter aceitado: ambíguo, nunca reenviar sozinho.
export function graphResultFrom(status: number, ok: boolean, body: Row | null): GraphResult {
  if (!body) return { ok: false, httpStatus: status, code: null, message: 'Resposta da Graph sem corpo legível.', ambiguous: true };
  const id = ok ? body.messages?.[0]?.id : null;
  if (ok) return id ? { ok: true, messageId: String(id) } : { ok: false, httpStatus: status, code: null, message: 'Graph sem id de mensagem.', ambiguous: true };
  const error = (body.error ?? {}) as Row;
  const code = Number(error.code);
  return { ok: false, httpStatus: status, code: Number.isFinite(code) && error.code !== null ? code : null, message: String(error.message ?? `HTTP ${status}`).slice(0, 300) };
}

export function createSenderTransport(deps: TransportDeps): SenderTransport {
  const doFetch = deps.fetch ?? fetch;
  const graphTimeout = deps.graphTimeoutMs ?? GRAPH_TIMEOUT_MS;
  const baileysTimeout = deps.baileysTimeoutMs ?? BAILEYS_TIMEOUT_MS;
  return {
    async baileysSendText(sessionKey, jidDigits, text) {
      return String(await withTimeout(() => deps.baileys.sendText(sessionKey, jidDigits, text), baileysTimeout, 'BAILEYS_TIMEOUT'));
    },
    async baileysTyping(sessionKey, jidDigits, on) {
      try {
        await withTimeout(() => deps.baileys.sendTyping(sessionKey, jidDigits, on), Math.min(TYPING_TIMEOUT_MS, baileysTimeout), 'TYPING_TIMEOUT');
      } catch { /* presença é best-effort */ }
    },
    async graphSend(phoneNumberId, token, payload) {
      let response: Response;
      try {
        response = await doFetch(`${GRAPH_URL}/${encodeURIComponent(phoneNumberId)}/messages`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(graphTimeout),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error ?? '');
        return { ok: false, httpStatus: 0, code: null, message: message.slice(0, 200) || 'falha de rede', ambiguous: true };
      }
      return graphResultFrom(response.status, response.ok, await readJson(response));
    },
  };
}

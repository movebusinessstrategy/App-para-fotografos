// Travas do follow-up legado (mensagem fixa da etapa e sentinela da Lia) e do
// envio pela API oficial. O worker antigo do server.ts chama estas funções logo
// depois de pegar a tarefa; aqui fica só o que dá para testar sem o servidor.
import type { SupabaseClient } from '@supabase/supabase-js';
import { brazilianPhoneVariants } from './lib/br-phone.js';
import { isWithinBusinessHours, localDateKey, nextWindowOpening } from './lib/business-hours.js';
import { isMissingSchemaError, isOptedOut } from './lib/optout-store.js';
import { isClosedStage } from './lib/stage-rules.js';
import type { StageRow } from './lib/stage-rules.js';
import { CUSTOMER_NON_TURN_TYPES, DEFAULT_BUSINESS_HOURS } from './src/features/followups/types.js';

export type LegacyMetaAuth = { ok: true; bearer: string } | { ok: false; reason: 'no_token' | 'decrypt_failed' | 'expired'; message: string };
export type LegacyCancelReason = 'deal_missing' | 'deal_closed' | 'stage_changed' | 'optout' | 'cadence_active' | 'customer_replied';
export type LegacyGate = { action: 'send' } | { action: 'cancel'; reason: LegacyCancelReason } | { action: 'defer'; until: string };
export interface LegacyFacts {
  deal: { id: number; stage: string; converted: boolean; converted_job_id: number | null } | null;
  stages: StageRow[]; optedOut: boolean; cadenceEnabled: boolean; lastCustomerAt: string | null;
}

type GateTask = { stage_id: string | null; created_at: string };
type GateRule = (task: GateTask, facts: LegacyFacts, now: Date) => LegacyGate | null;

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFER_ON_ERROR_MS = 30 * 60 * 1000;
const STUDIO_TZ = 'America/Sao_Paulo';
// Mesmo valor de AGENT_FOLLOWUP_SENTINEL no server.ts (follow-up contextual da Lia).
const AGENT_FOLLOWUP_SENTINEL = '###AGENT_FOLLOWUP###';
// Tipo nulo conta como fala (o padrão da coluna é 'text').
const CUSTOMER_TURN_FILTER = `type.is.null,type.not.in.(${CUSTOMER_NON_TURN_TYPES.join(',')})`;

function parseTime(value: unknown): number | null {
  if (typeof value !== 'string' || !value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

function dayMonth(ms: number): string {
  const [, month, day] = localDateKey(new Date(ms), STUDIO_TZ).split('-');
  return `${day}/${month}`;
}

function safeDecrypt(decrypt: (blob: string | null | undefined) => string | null, blob: string): string {
  try {
    return String(decrypt(blob) ?? '').trim();
  } catch {
    return '';
  }
}

export function resolveLegacyMetaAuth(
  account: { access_token?: string | null; token_expires_at?: string | null } | null | undefined,
  decrypt: (blob: string | null | undefined) => string | null,
  now: Date = new Date(),
): LegacyMetaAuth {
  const blob = typeof account?.access_token === 'string' ? account.access_token.trim() : '';
  if (!blob) return { ok: false, reason: 'no_token', message: 'Conta Meta sem token salvo.' };
  const expiresAt = parseTime(account?.token_expires_at);
  if (expiresAt !== null && expiresAt <= now.getTime()) {
    return {
      ok: false,
      reason: 'expired',
      message: `Token da API oficial venceu em ${dayMonth(expiresAt)}. Reconecte em Configurações > Integrações > WhatsApp.`,
    };
  }
  const bearer = safeDecrypt(decrypt, blob);
  if (!bearer) return { ok: false, reason: 'decrypt_failed', message: 'Não foi possível decifrar o token da API oficial.' };
  return { ok: true, bearer };
}

// Janela de 24h da Meta pelas variantes de 12 e 13 dígitos do cliente e do
// número do estúdio (a comparação exata dava falso negativo).
export async function legacyWithin24h(
  db: SupabaseClient,
  userId: string,
  phone: string,
  waNumber: string,
  now: Date = new Date(),
): Promise<boolean> {
  try {
    const phones = brazilianPhoneVariants(phone);
    const numbers = brazilianPhoneVariants(waNumber);
    if (!phones.length || !numbers.length) return false;
    const { data, error } = await db
      .from('wa_messages')
      .select('timestamp')
      .eq('user_id', userId)
      .eq('from_me', false)
      .in('phone', phones)
      .in('wa_number', numbers)
      .order('timestamp', { ascending: false, nullsFirst: false })
      .limit(1);
    if (error) return false;
    const last = parseTime((data as Array<{ timestamp: unknown }> | null)?.[0]?.timestamp);
    return last !== null && now.getTime() - last < DAY_MS;
  } catch {
    return false; // na dúvida, fora da janela
  }
}

function cancel(reason: LegacyCancelReason): LegacyGate {
  return { action: 'cancel', reason };
}

function dealIsClosed(deal: NonNullable<LegacyFacts['deal']>, stages: StageRow[]): boolean {
  if (deal.converted || deal.converted_job_id != null) return true;
  return isClosedStage(stages.find((s) => s.id === deal.stage));
}

// Sem created_at confiável não dá para provar que o cliente ficou quieto: cancela.
function customerRepliedAfter(createdAt: string, lastCustomerAt: string | null): boolean {
  const last = parseTime(lastCustomerAt);
  if (last === null) return false;
  const created = parseTime(createdAt);
  return created === null || last > created;
}

function outsideHours(now: Date): LegacyGate | null {
  if (isWithinBusinessHours(now, DEFAULT_BUSINESS_HOURS)) return null;
  return { action: 'defer', until: nextWindowOpening(now, DEFAULT_BUSINESS_HOURS).toISOString() };
}

// Ordem importa: a primeira regra que casar decide.
const GATE_RULES: GateRule[] = [
  (_t, f) => (f.deal ? null : cancel('deal_missing')),
  (_t, f) => (dealIsClosed(f.deal!, f.stages) ? cancel('deal_closed') : null),
  (t, f) => (t.stage_id && f.deal!.stage !== t.stage_id ? cancel('stage_changed') : null),
  (_t, f) => (f.optedOut ? cancel('optout') : null),
  // A cadência substitui a mensagem fixa e o follow-up da Lia.
  (_t, f) => (f.cadenceEnabled ? cancel('cadence_active') : null),
  (t, f) => (customerRepliedAfter(t.created_at, f.lastCustomerAt) ? cancel('customer_replied') : null),
  (_t, _f, now) => outsideHours(now),
];

export function decideLegacyGate(task: { stage_id: string | null; created_at: string }, facts: LegacyFacts, now: Date): LegacyGate {
  for (const rule of GATE_RULES) {
    const gate = rule(task, facts, now);
    if (gate) return gate;
  }
  return { action: 'send' };
}

async function loadDeal(db: SupabaseClient, userId: string, dealId: number): Promise<LegacyFacts['deal']> {
  const { data, error } = await db
    .from('deals')
    .select('id, stage, converted, converted_job_id')
    .eq('id', dealId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(`deals: ${error.message}`);
  if (!data) return null;
  const row = data as Record<string, unknown>;
  return {
    id: Number(row.id),
    stage: String(row.stage ?? ''),
    converted: row.converted === true,
    converted_job_id: row.converted_job_id == null ? null : Number(row.converted_job_id),
  };
}

async function loadStages(db: SupabaseClient, userId: string): Promise<StageRow[]> {
  const { data, error } = await db
    .from('deal_stages')
    .select('id, name, position, is_final, is_won, process_id')
    .eq('user_id', userId);
  if (error) throw new Error(`deal_stages: ${error.message}`);
  return ((data || []) as StageRow[]).map((s) => ({ ...s, id: String(s.id), position: Number(s.position) || 0 }));
}

async function loadCadenceEnabled(db: SupabaseClient, userId: string): Promise<boolean> {
  const { data, error } = await db
    .from('followup_cadence_config')
    .select('enabled')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) {
    if (isMissingSchemaError(error)) return false;
    throw new Error(`followup_cadence_config: ${error.message}`);
  }
  return (data as { enabled?: unknown } | null)?.enabled === true;
}

// Última fala do cliente em QUALQUER número da conta (inclusive pós-venda).
async function loadLastCustomerAt(db: SupabaseClient, userId: string, phone: string): Promise<string | null> {
  const phones = brazilianPhoneVariants(phone);
  if (!phones.length) return null;
  const { data, error } = await db
    .from('wa_messages')
    .select('timestamp')
    .eq('user_id', userId)
    .eq('from_me', false)
    .in('phone', phones)
    .or(CUSTOMER_TURN_FILTER)
    .order('timestamp', { ascending: false, nullsFirst: false })
    .limit(1);
  if (error) throw new Error(`wa_messages: ${error.message}`);
  const last = (data as Array<{ timestamp: unknown }> | null)?.[0]?.timestamp;
  return typeof last === 'string' && last ? last : null;
}

export async function loadLegacyFacts(
  db: SupabaseClient,
  task: { user_id: string; deal_id: number; phone: string },
): Promise<LegacyFacts> {
  const [deal, stages, optedOut, cadenceEnabled, lastCustomerAt] = await Promise.all([
    loadDeal(db, task.user_id, task.deal_id),
    loadStages(db, task.user_id),
    isOptedOut(db, task.user_id, task.phone),
    loadCadenceEnabled(db, task.user_id),
    loadLastCustomerAt(db, task.user_id, task.phone),
  ]);
  return { deal, stages, optedOut, cadenceEnabled, lastCustomerAt };
}

// A sentinela da Lia grava a etapa de ANTES de mover o deal para "Orçamento
// Enviado" (server.ts), então a checagem de etapa derrubaria todo follow-up dela.
function gateTaskOf(task: any): GateTask {
  const sentinel = task.message === AGENT_FOLLOWUP_SENTINEL;
  const stageId = typeof task.stage_id === 'string' && task.stage_id ? task.stage_id : null;
  return { stage_id: sentinel ? null : stageId, created_at: String(task.created_at ?? '') };
}

function errorLabel(err: unknown): string {
  const e = err as { code?: unknown; message?: unknown } | null;
  return String(e?.code || e?.message || 'erro').slice(0, 160);
}

export async function legacyPreSendCheck(db: SupabaseClient, task: any, now: Date = new Date()): Promise<LegacyGate> {
  try {
    const facts = await loadLegacyFacts(db, {
      user_id: String(task.user_id),
      deal_id: Number(task.deal_id),
      phone: String(task.phone ?? ''),
    });
    return decideLegacyGate(gateTaskOf(task), facts, now);
  } catch (err) {
    console.warn(`[FollowUp Worker] pré-checagem falhou (${errorLabel(err)}) | task=${task?.id}`);
    return { action: 'defer', until: new Date(now.getTime() + DEFER_ON_ERROR_MS).toISOString() };
  }
}

function gatePatch(gate: Exclude<LegacyGate, { action: 'send' }>): Record<string, string> {
  if (gate.action === 'cancel') return { status: 'cancelled' };
  return { status: 'pending', scheduled_at: gate.until };
}

function gateDetail(gate: Exclude<LegacyGate, { action: 'send' }>): string {
  return gate.action === 'cancel' ? gate.reason : `até ${gate.until}`;
}

// Nunca lança: uma falha aqui não pode derrubar o resto do lote do worker.
export async function applyLegacyGate(db: SupabaseClient, task: { id: number; user_id: string }, gate: LegacyGate): Promise<void> {
  if (gate.action === 'send') return;
  try {
    const { error } = await db
      .from('scheduled_followups')
      .update(gatePatch(gate))
      .eq('id', task.id)
      .eq('user_id', task.user_id);
    if (error) {
      console.warn(`[FollowUp Worker] ${gate.action} não gravou (${errorLabel(error)}) | task=${task.id}`);
      return;
    }
    console.log(`[FollowUp Worker] ${gate.action} ${gateDetail(gate)} | task=${task.id}`);
  } catch (err) {
    console.warn(`[FollowUp Worker] ${gate.action} não gravou (${errorLabel(err)}) | task=${task.id}`);
  }
}

// wamid real devolvido pela Graph API (body.messages[0].id).
export function extractGraphMessageId(body: unknown): string | null {
  const id = (body as { messages?: Array<{ id?: unknown }> } | null | undefined)?.messages?.[0]?.id;
  return typeof id === 'string' && id ? id : null;
}

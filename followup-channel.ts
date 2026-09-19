// Canal da cadência: por onde cada follow-up sai (API oficial em texto, QR ou
// template), por que nada sai quando não há canal, e os payloads da Graph.
// Puro: sem banco, sem rede e sem relógio implícito (quem chama passa o now).
import type {
  ApprovalChannelClass, BlockCode, CadenceApproval, CadenceTaskRow, ChannelHealth, ChannelKind, FollowUpConfig, FollowUpStep,
  FollowUpTrack,
} from './src/features/followups/types.js';
import { digitsOnly, samePhone } from './lib/br-phone.js';
import { firstName, MAX_BALLOONS, toTemplateHook } from './followup-draft.js';

export interface SenderChannelHealth {
  meta: { configured: boolean; phoneNumberId: string | null; waNumber: string | null; token: string | null;
          tokenExpiresAt: string | null; operational: boolean; qualityRating: string | null };
  baileys: { status: 'open' | 'connecting' | 'close' | 'not_initialized'; waNumber: string | null; paired: boolean };
  mainWaNumber: string | null;
  preferredChannel: 'auto' | 'meta' | 'baileys' | null;
  dedupeReady: boolean;
}

export interface CadenceTemplate { id: number; name: string; language: string; bodyText: string; status: string;
  category: string | null; headerText: string | null; buttons: unknown }

export type ChannelDecision = { ok: true; channel: ChannelKind; waNumber: string }
  | { ok: false; scope: 'task' | 'tenant'; code: BlockCode; message: string };

export type ErrorClass = 'channel_auth' | 'channel_config' | 'window_closed' | 'undeliverable' | 'marketing_capped'
  | 'rate_limited' | 'template_invalid' | 'baileys_offline' | 'transient' | 'ambiguous';

export type GraphResult = { ok: true; messageId: string } | { ok: false; httpStatus: number; code: number | null; message: string; ambiguous?: boolean };

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const WINDOW_MS = DAY_MS;
const TOKEN_MARGIN_MS = 5 * MINUTE_MS;
const EXPIRING_MS = 7 * DAY_MS;
const TEMPLATE_PARAM_MAX = 200;
const DEFAULT_TZ = 'America/Sao_Paulo';
const META_SETTINGS = 'Configurações > Integrações > WhatsApp';
// Qualidade ainda não medida pela Meta não é queda de qualidade.
const UNMEASURED_QUALITY = new Set(['', 'GREEN', 'UNKNOWN', 'NA']);

// Utilitários

function toMs(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const ms = Date.parse(String(value));
  return Number.isFinite(ms) ? ms : null;
}

function upper(value: unknown): string {
  return String(value ?? '').trim().toUpperCase();
}

function hasDigits(value: unknown): boolean {
  return digitsOnly(value).length > 0;
}

function withoutLoneSurrogate(text: string): string {
  const last = text.charCodeAt(text.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? text.slice(0, -1) : text;
}

function dayMonth(iso: string | null, tz: string): string {
  const ms = toMs(iso);
  if (ms === null) return '';
  const options: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit' };
  try {
    return new Intl.DateTimeFormat('pt-BR', { ...options, timeZone: tz }).format(new Date(ms));
  } catch {
    return new Intl.DateTimeFormat('pt-BR', { ...options, timeZone: DEFAULT_TZ }).format(new Date(ms));
  }
}

// Template de retomada

const NAMED_VARIABLE = /\{\{\s*[^0-9}\s][^}]*\}\}/;
const NUMBERED_VARIABLE = /\{\{\s*(\d+)\s*\}\}/g;

function numberedIndexes(body: string): number[] {
  return Array.from(String(body ?? '').matchAll(NUMBERED_VARIABLE), (match) => Number(match[1]));
}

function hasOnlyNameAndMessage(body: string): boolean {
  const indexes = new Set(numberedIndexes(body));
  return indexes.size === 2 && indexes.has(1) && indexes.has(2);
}

function hasVariable(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return String(text ?? '').includes('{{');
}

const TEMPLATE_RULES: Array<[(t: CadenceTemplate) => boolean, string]> = [
  [(t) => upper(t.status) !== 'APPROVED', 'Template ainda não aprovado pela Meta.'],
  [(t) => upper(t.category) !== 'MARKETING', 'Use um template da categoria Marketing.'],
  [(t) => NAMED_VARIABLE.test(String(t.bodyText ?? '')), 'Troque variáveis com nome por {{1}} e {{2}}.'],
  [(t) => !hasOnlyNameAndMessage(t.bodyText), 'O template precisa de {{1}} (nome) e {{2}} (mensagem), e só elas.'],
  [(t) => hasVariable(t.headerText) || hasVariable(t.buttons), 'Cabeçalho e botões não podem ter variáveis.'],
];

export function validateCadenceTemplate(t: CadenceTemplate): { ok: true } | { ok: false; reason: string } {
  if (!t) return { ok: false, reason: 'O template escolhido não foi encontrado.' };
  const hit = TEMPLATE_RULES.find(([broken]) => broken(t));
  return hit ? { ok: false, reason: hit[1] } : { ok: true };
}

// Predicados de canal

function tokenExpired(h: SenderChannelHealth, now: Date): boolean {
  const expiresAt = toMs(h.meta.tokenExpiresAt);
  return expiresAt !== null && expiresAt <= now.getTime() + TOKEN_MARGIN_MS;
}

function qualityOk(h: SenderChannelHealth): boolean {
  return UNMEASURED_QUALITY.has(upper(h.meta.qualityRating));
}

export function metaUsable(h: SenderChannelHealth, now: Date): boolean {
  return !!h.meta.token && !!h.meta.phoneNumberId && h.meta.operational && !tokenExpired(h, now);
}

export function windowOpen(lastCustomerAt: string | null, now: Date, marginMinutes = 30): boolean {
  const last = toMs(lastCustomerAt);
  if (last === null) return false;
  return now.getTime() - last < WINDOW_MS - marginMinutes * MINUTE_MS;
}

// conv null = não há número para conferir (painel sem número principal).
interface ChannelCtx {
  h: SenderChannelHealth; config: FollowUpConfig; template: CadenceTemplate | null; now: Date; conv: string | null;
  metaOk: boolean; baileysOk: boolean; templateEligible: boolean; templateReason: string | null;
}

function numberMatches(number: string | null, conv: string | null): boolean {
  return conv === null || samePhone(number, conv);
}

function templateReasonOf(config: FollowUpConfig, template: CadenceTemplate | null): string | null {
  if (config.template_id === null || config.template_id === undefined) return null;
  const check = validateCadenceTemplate(template as CadenceTemplate);
  return check.ok ? null : check.reason;
}

function buildCtx(h: SenderChannelHealth, config: FollowUpConfig, template: CadenceTemplate | null, now: Date, conv: string | null): ChannelCtx {
  const metaOk = metaUsable(h, now) && qualityOk(h) && numberMatches(h.meta.waNumber, conv);
  const baileysOk = config.allow_baileys && h.dedupeReady && h.baileys.status === 'open' && numberMatches(h.baileys.waNumber, conv);
  const templateEligible = !!template && validateCadenceTemplate(template).ok;
  return { h, config, template, now, conv, metaOk, baileysOk, templateEligible, templateReason: templateReasonOf(config, template) };
}

function mainNumber(h: SenderChannelHealth): string | null {
  return hasDigits(h.mainWaNumber) ? h.mainWaNumber : null;
}

// Por que nada sai: tabela ordenada, o primeiro que casar explica o bloqueio.

interface BlockRule { scope: 'task' | 'tenant'; code: BlockCode; when(c: ChannelCtx): boolean; message(c: ChannelCtx): string }

function numberMismatch(c: ChannelCtx): boolean {
  if (c.conv === null) return false;
  const numbers = [c.h.meta.configured ? c.h.meta.waNumber : null, c.h.baileys.waNumber].filter(hasDigits);
  return numbers.length > 0 && !numbers.some((n) => samePhone(n, c.conv));
}

function qualityMessage(c: ChannelCtx): string {
  return `A qualidade do número na Meta caiu (${upper(c.h.meta.qualityRating)}). Envios pausados para proteger o número.`;
}

function tokenExpiredMessage(c: ChannelCtx): string {
  const when = dayMonth(c.h.meta.tokenExpiresAt, c.config.business_hours?.tz || DEFAULT_TZ);
  return `Token da API oficial venceu em ${when}. Reconecte em ${META_SETTINGS}.`;
}

const BLOCK_RULES: BlockRule[] = [
  { scope: 'task', code: 'number_mismatch', when: numberMismatch,
    message: () => 'Esta conversa está em outro número do estúdio. A cadência só envia pelo número configurado.' },
  { scope: 'tenant', code: 'quality_not_green', when: (c) => c.h.meta.configured && !qualityOk(c.h), message: qualityMessage },
  { scope: 'tenant', code: 'meta_token_expired', when: (c) => c.h.meta.configured && tokenExpired(c.h, c.now) && !c.baileysOk,
    message: tokenExpiredMessage },
  { scope: 'tenant', code: 'meta_not_operational', when: (c) => c.h.meta.configured && !c.h.meta.operational,
    message: () => `A API oficial do WhatsApp não está operando nesta conta. Confira em ${META_SETTINGS}.` },
  { scope: 'tenant', code: 'baileys_disabled', when: (c) => !c.config.allow_baileys && c.h.baileys.status === 'open',
    message: () => 'O envio pelo QR está desligado na cadência. Fora da janela de 24h só sai por template aprovado ou pelo QR.' },
  { scope: 'tenant', code: 'template_not_eligible', when: (c) => c.templateReason !== null,
    message: (c) => `O template escolhido não serve para retomada: ${c.templateReason}` },
  { scope: 'task', code: 'window_closed_no_template', when: (c) => c.metaOk,
    message: () => 'Fora da janela de 24h e sem template aprovado. Aprove um template de retomada ou ligue o envio pelo QR.' },
  { scope: 'tenant', code: 'baileys_offline', when: (c) => c.config.allow_baileys && c.h.baileys.status !== 'open',
    message: () => 'QR desconectado. Reconecte pela engrenagem do chat.' },
  { scope: 'tenant', code: 'no_channel', when: () => true,
    message: () => `Nenhum canal de envio disponível agora. Confira a API oficial em ${META_SETTINGS} e o QR pela engrenagem do chat.` },
];

// Com a API oficial funcionando, o que falta é só desta tarefa (fora da janela):
// devolvê-la para a fila travaria as outras, porque o claim pega a mais antiga.
function explainBlock(c: ChannelCtx): Extract<ChannelDecision, { ok: false }> {
  const rule = BLOCK_RULES.find((r) => r.when(c)) as BlockRule;
  const scope = c.metaOk ? 'task' : rule.scope;
  return { ok: false, scope, code: rule.code, message: rule.message(c) };
}

function picked(channel: ChannelKind, number: string | null): ChannelDecision {
  return { ok: true, channel, waNumber: digitsOnly(number) };
}

export function chooseChannel(i: { now: Date; lastCustomerAt: string | null; conversationWaNumber: string; health: SenderChannelHealth;
  config: FollowUpConfig; template: CadenceTemplate | null }): ChannelDecision {
  const c = buildCtx(i.health, i.config, i.template, i.now, String(i.conversationWaNumber ?? ''));
  if (c.metaOk && i.config.allow_meta_text && windowOpen(i.lastCustomerAt, i.now)) return picked('meta_text', i.health.meta.waNumber);
  if (c.baileysOk) return picked('baileys', i.health.baileys.waNumber);
  if (c.metaOk && c.templateEligible) return picked('meta_template', i.health.meta.waNumber);
  return explainBlock(c);
}

export function tenantBlock(health: SenderChannelHealth, config: FollowUpConfig, template: CadenceTemplate | null, now: Date):
  { code: BlockCode; message: string } | null {
  const c = buildCtx(health, config, template, now, mainNumber(health));
  if (c.metaOk || c.baileysOk) return null;
  const rule = BLOCK_RULES.find((r) => r.scope === 'tenant' && r.when(c)) as BlockRule;
  return { code: rule.code, message: rule.message(c) };
}

// Saúde dos canais para o painel

type TokenState = ChannelHealth['meta']['token_state'];

function tokenState(h: SenderChannelHealth, now: Date): TokenState {
  const expiresAt = toMs(h.meta.tokenExpiresAt);
  if (expiresAt !== null && tokenExpired(h, now)) return 'expired';
  if (!h.meta.token) return 'none';
  if (expiresAt === null) return 'no_expiry';
  return expiresAt - now.getTime() < EXPIRING_MS ? 'expiring' : 'ok';
}

function daysLeft(h: SenderChannelHealth, now: Date): number | null {
  const expiresAt = toMs(h.meta.tokenExpiresAt);
  return expiresAt === null ? null : Math.max(0, Math.floor((expiresAt - now.getTime()) / DAY_MS));
}

function templateDTO(c: ChannelCtx): ChannelHealth['template'] {
  const configured = c.config.template_id !== null && c.config.template_id !== undefined;
  return {
    configured,
    approved: !!c.template && upper(c.template.status) === 'APPROVED',
    eligible: c.templateEligible,
    name: c.template?.name ?? null,
    reason: configured ? c.templateReason : null,
  };
}

function healthLevel(canSend: ChannelHealth['can_send'], state: TokenState): ChannelHealth['level'] {
  if (!canSend.inside_24h && !canSend.outside_24h) return 'down';
  if (!canSend.inside_24h || !canSend.outside_24h || state === 'expiring') return 'degraded';
  return 'ok';
}

const HEALTH_NOTES: Array<[(c: ChannelCtx) => boolean, (c: ChannelCtx) => string]> = [
  [(c) => c.h.meta.configured && !qualityOk(c.h), qualityMessage],
  [(c) => c.h.meta.configured && !c.h.meta.operational, () => 'A API oficial do WhatsApp não está operando nesta conta.'],
  [(c) => c.config.allow_baileys && c.h.baileys.status !== 'open', () => 'WhatsApp (QR) desconectado. Reconecte pela engrenagem do chat.'],
  [(c) => c.config.allow_baileys && !c.h.dedupeReady, () => 'Aplique a migration 085 antes de enviar pelo QR.'],
  [(c) => !c.config.allow_baileys && c.h.baileys.status === 'open', () => 'O QR está conectado, mas o envio da cadência pelo QR está desligado.'],
  [(c) => c.h.preferredChannel === 'baileys' && c.metaOk && !c.baileysOk,
    () => 'A cadência envia pela API oficial mesmo com a preferência do chat em QR.'],
];

export function toChannelHealthDTO(h: SenderChannelHealth, config: FollowUpConfig, template: CadenceTemplate | null, now: Date): ChannelHealth {
  const c = buildCtx(h, config, template, now, mainNumber(h));
  const canSend = {
    inside_24h: (c.metaOk && config.allow_meta_text) || c.baileysOk,
    outside_24h: c.baileysOk || (c.metaOk && c.templateEligible),
  };
  const state = tokenState(h, now);
  return {
    baileys: { status: h.baileys.status, phone: h.baileys.waNumber, allowed: config.allow_baileys, dedupe_ready: h.dedupeReady },
    meta: {
      configured: h.meta.configured, operational: h.meta.operational, token_expires_at: h.meta.tokenExpiresAt,
      token_state: state, days_left: daysLeft(h, now), quality_rating: h.meta.qualityRating,
    },
    template: templateDTO(c),
    preferred_channel: h.preferredChannel,
    can_send: canSend,
    level: healthLevel(canSend, state),
    notes: HEALTH_NOTES.filter(([when]) => when(c)).map(([, text]) => text(c)),
  };
}

// Aprovação: o que foi aprovado precisa ser o que sai.

const TEMPLATE_REVIEW = 'Vai sair como template (fora da janela de 24h). Revise o texto final.';
const TEXT_REVIEW = 'Vai sair como texto livre. Revise antes de enviar.';

export function channelClass(c: ChannelKind): ApprovalChannelClass {
  return c === 'meta_template' ? 'template' : 'text';
}

export function templateParams(contactName: string | null, text: string, step: FollowUpStep, track?: FollowUpTrack | null): string[] {
  return [firstName(contactName) ?? 'tudo bem', toTemplateHook(text, step, undefined, track)];
}

export function approvalFor(i: { channel: ChannelKind | 'blocked'; template: CadenceTemplate | null; contactName: string | null;
  text: string; step: FollowUpStep; track?: FollowUpTrack | null }): CadenceApproval {
  if (i.channel !== 'meta_template') return { channel_class: 'text', render: null, template_id: null };
  if (!i.template) return { channel_class: 'template', render: null, template_id: null };
  const render = renderTemplate(i.template.bodyText, templateParams(i.contactName, i.text, i.step, i.track));
  return { channel_class: 'template', render, template_id: i.template.id };
}

function templateChanged(approval: Partial<CadenceApproval>, task: CadenceTaskRow, template: CadenceTemplate | null): boolean {
  if (!template) return true;
  if (approval.template_id != null && Number(approval.template_id) !== Number(template.id)) return true;
  const current = renderTemplate(template.bodyText, templateParams(task.contact_name, task.message, task.step, task.track));
  return approval.render !== current;
}

export function approvalMatches(task: CadenceTaskRow, channel: ChannelKind, template: CadenceTemplate | null):
  { ok: true } | { ok: false; message: string } {
  const approval: Partial<CadenceApproval> = task.generation_meta?.approval ?? { channel_class: 'text', render: null, template_id: null };
  const klass = channelClass(channel);
  if (klass !== (approval.channel_class ?? 'text')) return { ok: false, message: klass === 'template' ? TEMPLATE_REVIEW : TEXT_REVIEW };
  if (klass === 'template' && templateChanged(approval, task, template)) return { ok: false, message: TEMPLATE_REVIEW };
  return { ok: true };
}

// Erros de envio

const GRAPH_ERRORS: Record<number, ErrorClass> = {
  190: 'channel_auth', 131031: 'channel_auth',
  133010: 'channel_config', 131030: 'channel_config',
  131047: 'window_closed',
  131026: 'undeliverable', 131021: 'undeliverable',
  131049: 'marketing_capped',
  131048: 'rate_limited', 130429: 'rate_limited', 131056: 'rate_limited',
  132000: 'template_invalid', 132001: 'template_invalid', 132005: 'template_invalid', 132007: 'template_invalid',
  132012: 'template_invalid', 132015: 'template_invalid', 132016: 'template_invalid', 132018: 'template_invalid',
};

export function classifyGraphError(r: GraphResult): ErrorClass {
  if (!r.ok && r.ambiguous) return 'ambiguous';
  const code = r.ok ? null : r.code;
  return (code !== null && GRAPH_ERRORS[Number(code)]) || 'transient';
}

// Na dúvida é ambíguo: o socket pode ter enviado antes de falhar.
export function classifyBaileysError(e: unknown): ErrorClass {
  const message = e instanceof Error ? e.message : String(e ?? '');
  if (/BAILEYS_TIMEOUT/.test(message)) return 'ambiguous';
  if (/não conectado|nao conectado|not connected|closed/i.test(message)) return 'baileys_offline';
  return 'ambiguous';
}

// Payloads (espelho de countTemplateVarsServer e buildTemplateMessagePayload do server.ts)

// A Meta recusa parâmetro com quebra de linha, tab ou mais de 4 espaços seguidos.
export function sanitizeTemplateParam(v: string): string {
  const flat = String(v ?? '').replace(/\s*[\r\n\t]+\s*/g, ' ').replace(/ {5,}/g, ' ').trim();
  const cut = withoutLoneSurrogate(flat.slice(0, TEMPLATE_PARAM_MAX)).trim();
  return cut || '-';
}

export function countTemplateVars(body: string): number {
  const indexes = numberedIndexes(body);
  return indexes.length ? Math.max(...indexes) : 0;
}

export function templatePayload(tpl: CadenceTemplate, params: string[]): Record<string, unknown> {
  const count = countTemplateVars(tpl.bodyText);
  const base = { name: tpl.name, language: { code: tpl.language || 'pt_BR' } };
  if (count === 0) return base;
  const parameters = Array.from({ length: count }, (_, index) => ({ type: 'text', text: sanitizeTemplateParam(params[index] ?? '') }));
  return { ...base, components: [{ type: 'body', parameters }] };
}

export function renderTemplate(body: string, params: string[]): string {
  return String(body ?? '').replace(NUMBERED_VARIABLE, (whole: string, index: string) => {
    const value = params[Number(index) - 1];
    return value === undefined || value === null ? whole : sanitizeTemplateParam(String(value));
  });
}

export function splitBalloons(text: string): string[] {
  const parts = String(text ?? '').split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);
  if (parts.length <= MAX_BALLOONS) return parts;
  return [...parts.slice(0, MAX_BALLOONS - 1), parts.slice(MAX_BALLOONS - 1).join('\n\n')];
}

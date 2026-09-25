// Mensagens fixas da cadência (message_mode = 'fixed'): o texto que o dono
// aprovou para cada passo, com [nome] no lugar do primeiro nome. Aqui ficam o
// texto final de cada cliente, o corpo e o nome do template que leva esse mesmo
// texto para fora da janela de 24h, a validação da config e a rotina que cria e
// acompanha esses templates na Meta sozinha. Rede e banco entram por dependência.
import { createHash } from 'node:crypto';
import type {
  CadenceFixedRef, CadenceGenerationMeta, FixedTemplateInfo, FollowUpConfig, FollowUpStep,
} from './src/features/followups/types.js';
import { FIXED_MESSAGE_MAX_CHARS, FIXED_MESSAGES_MAX } from './src/features/followups/types.js';

export const FIXED_TEMPLATE_PREFIX = 'retomada_passo';
export const FIXED_TEMPLATE_LANGUAGE = 'pt_BR';
export const FIXED_TEMPLATE_CATEGORY = 'MARKETING';
export const FIXED_EXAMPLE_NAME = 'Maria';
export const FIXED_NOT_CREATED = 'NOT_CREATED';
export const META_TEMPLATE_TIMEOUT_MS = 15_000;
export const NO_META_ACCOUNT_REASON = 'Conecte a API oficial do WhatsApp em Configurações > Integrações > WhatsApp para enviar o template à Meta.';

const GRAPH_URL = 'https://graph.facebook.com/v21.0';
const LOOKUP_FIELDS = 'id,name,status,language,category,rejected_reason';
const POLLED_STATUSES = new Set(['PENDING', 'IN_APPEAL']);
const ERROR_MAX = 300;

// Marcador do primeiro nome: [nome], {nome} ou {{nome}}, sem diferenciar maiúsculas.
const MARKER = String.raw`\{\{\s*nome\s*\}\}|\{\s*nome\s*\}|\[\s*nome\s*\]`;
const ANY_MARKER = new RegExp(MARKER, 'giu');
// Sem nome: no começo da linha o marcador sai com a vírgula de depois (e a letra seguinte
// sobe); no meio sai junto com o espaço ou a vírgula de antes ("Oi, [nome]!" vira "Oi!").
const LINE_START_MARKER = new RegExp(String.raw`^([ \t]*)(?:${MARKER})[ \t]*[,;:]?[ \t]*(\p{L}?)`, 'gimu');
const INLINE_MARKER = new RegExp(String.raw`(?:,[ \t]*|[ \t]+)?(?:${MARKER})`, 'giu');
const DOUBLE_BRACES = /\{\{|\}\}/;

type Row = Record<string, any>;

// Texto

export function normalizeFixedText(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\r\n?/g, '\n').trim() : '';
}

export function countNameMarkers(text: string): number {
  return (normalizeFixedText(text).match(ANY_MARKER) ?? []).length;
}

export function renderFixedMessage(text: string, firstName: string | null | undefined): string {
  const source = normalizeFixedText(text);
  const name = String(firstName ?? '').trim();
  if (name) return source.replace(ANY_MARKER, () => name);
  return source
    .replace(LINE_START_MARKER, (_match: string, lead: string, letter: string) => lead + letter.toLocaleUpperCase('pt-BR'))
    .replace(INLINE_MARKER, '')
    .trim();
}

// Corpo do template na Meta: o mesmo texto, com {{1}} no lugar do marcador (0 ou 1 variável).
export function fixedTemplateBody(text: string): string {
  return normalizeFixedText(text).replace(ANY_MARKER, '{{1}}');
}

// Texto novo = template novo: o nome carrega o passo e o começo do sha1 do texto.
export function fixedTemplateName(step: number, text: string): string {
  const hash = createHash('sha1').update(normalizeFixedText(text), 'utf8').digest('hex');
  return `${FIXED_TEMPLATE_PREFIX}${step}_${hash.slice(0, 6)}`;
}

// Passos

export interface FixedStep { step: FollowUpStep; source: string; name: string; body: string; variables: 0 | 1 }

export function fixedSteps(texts: readonly unknown[] | null | undefined): FixedStep[] {
  const list = Array.isArray(texts) ? texts.slice(0, FIXED_MESSAGES_MAX) : [];
  const out: FixedStep[] = [];
  list.forEach((raw, index) => {
    const source = normalizeFixedText(raw);
    if (!source) return;
    const step = (index + 1) as FollowUpStep;
    out.push({ step, source, name: fixedTemplateName(step, source), body: fixedTemplateBody(source), variables: countNameMarkers(source) > 0 ? 1 : 0 });
  });
  return out;
}

type FixedConfig = Pick<FollowUpConfig, 'message_mode' | 'fixed_messages'>;

// Texto do passo (o mesmo índice vale para a escada e para os toques antes do orçamento).
export function fixedTextFor(config: FixedConfig, step: number): string | null {
  if (config.message_mode !== 'fixed' || !Array.isArray(config.fixed_messages)) return null;
  return normalizeFixedText(config.fixed_messages[step - 1]) || null;
}

export function fixedRefFor(config: FixedConfig, step: number): CadenceFixedRef | null {
  const source = fixedTextFor(config, step);
  return source ? { source, template_name: fixedTemplateName(step, source) } : null;
}

// A tarefa ainda é a mensagem fixa só se o texto que vai sair é exatamente o renderizado.
export function fixedRefOf(meta: Pick<CadenceGenerationMeta, 'fixed'> | null | undefined, message: string, firstName: string | null): CadenceFixedRef | null {
  const ref = meta?.fixed;
  if (!ref || typeof ref.source !== 'string' || typeof ref.template_name !== 'string') return null;
  return renderFixedMessage(ref.source, firstName) === String(message ?? '').trim() ? ref : null;
}

// Config: leitura tolerante e validação do PUT

function withoutTrailingEmpty(texts: string[]): string[] {
  const out = [...texts];
  while (out.length && !out[out.length - 1]) out.pop();
  return out;
}

export function parseFixedMessages(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const texts = value.slice(0, FIXED_MESSAGES_MAX).map((item) => normalizeFixedText(item).slice(0, FIXED_MESSAGE_MAX_CHARS));
  return withoutTrailingEmpty(texts);
}

export const FIXED_MSG = {
  mode: 'Escolha entre mensagens fixas e IA.',
  list: 'Informe as mensagens fixas como uma lista de textos.',
  max: `Use no máximo ${FIXED_MESSAGES_MAX} mensagens fixas.`,
  gap: 'Preencha os follow-ups em ordem, sem deixar um vazio antes de outro preenchido.',
  required: 'No modo de mensagens fixas, escreva pelo menos o Follow 01.',
} as const;

function followLabel(step: number): string {
  return `Follow ${String(step).padStart(2, '0')}`;
}

function startsOrEndsWithName(text: string): boolean {
  const body = fixedTemplateBody(text);
  return body.startsWith('{{1}}') || body.endsWith('{{1}}');
}

const TEXT_RULES: Array<[(text: string) => boolean, string]> = [
  [(t) => t.length > FIXED_MESSAGE_MAX_CHARS, `use no máximo ${FIXED_MESSAGE_MAX_CHARS} caracteres.`],
  [(t) => t.includes('###'), 'não use ###.'],
  [(t) => countNameMarkers(t) > 1, 'use [nome] no máximo uma vez.'],
  [(t) => DOUBLE_BRACES.test(t.replace(ANY_MARKER, '')), 'não use {{ }} fora do [nome]: a Meta leria como variável.'],
  [startsOrEndsWithName, 'não comece nem termine com [nome]: a Meta recusa o template assim.'],
];

function textError(text: string, step: number): string | null {
  const hit = TEXT_RULES.find(([broken]) => broken(text));
  return hit ? `${followLabel(step)}: ${hit[1]}` : null;
}

export type FixedCheck = { ok: true; value: string[] } | { ok: false; error: string };

// Vazios no fim são descartados; vazio no meio quebraria a escada (o card para no passo sem texto).
export function checkFixedMessages(value: unknown, mode: unknown): FixedCheck {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) return { ok: false, error: FIXED_MSG.list };
  const texts = withoutTrailingEmpty(value.map(normalizeFixedText));
  if (texts.length > FIXED_MESSAGES_MAX) return { ok: false, error: FIXED_MSG.max };
  if (texts.some((text) => !text)) return { ok: false, error: FIXED_MSG.gap };
  const error = texts.map((text, index) => textError(text, index + 1)).find((e): e is string => !!e);
  if (error) return { ok: false, error };
  if (mode === 'fixed' && texts.length === 0) return { ok: false, error: FIXED_MSG.required };
  return { ok: true, value: texts };
}

// Status dos templates para a tela (linhas do cache local mais os erros lembrados pelo servidor)

export interface FixedTemplateRow { name: string; status: string; rejectionReason?: string | null; metaTemplateId?: string | null }

function upper(value: unknown): string {
  return String(value ?? '').trim().toUpperCase();
}

function cleanReason(value: unknown): string | null {
  const text = String(value ?? '').trim();
  return text && text.toUpperCase() !== 'NONE' ? text.slice(0, ERROR_MAX) : null;
}

function info(step: FixedStep, status: string, reason: string | null): FixedTemplateInfo {
  return { step: step.step, name: step.name, status, reason };
}

function rowInfo(step: FixedStep, row: FixedTemplateRow): FixedTemplateInfo {
  return info(step, upper(row.status) || 'PENDING', cleanReason(row.rejectionReason));
}

export function fixedTemplatesInfo(texts: readonly unknown[] | null | undefined, rows: FixedTemplateRow[],
  errors: Record<string, string> = {}): FixedTemplateInfo[] {
  const byName = new Map(rows.map((row) => [row.name, row]));
  return fixedSteps(texts).map((step) => {
    const row = byName.get(step.name);
    return row ? rowInfo(step, row) : info(step, FIXED_NOT_CREATED, errors[step.name] ?? null);
  });
}

// Criação e acompanhamento na Meta

export interface FixedTemplatePort {
  rows(userId: string, names: string[]): Promise<FixedTemplateRow[]>;
  account(userId: string): Promise<{ wabaId: string; token: string } | null>;   // token já decifrado
  insert(row: Record<string, unknown>): Promise<void>;
  update(userId: string, name: string, patch: Record<string, unknown>): Promise<void>;
}

export interface EnsureFixedDeps {
  port: FixedTemplatePort;
  fetch: typeof fetch;
  log: (event: string, data?: Record<string, unknown>) => void;
  now: () => Date;
  timeoutMs?: number;
}

interface MetaAccount { wabaId: string; token: string }
interface EnsureCtx { userId: string; deps: EnsureFixedDeps; account?: MetaAccount | null }
type GraphReply = { ok: true; body: Row } | { ok: false; error: string };

function errorText(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error ?? '');
  return text.replace(/\d{8,}/g, '[número]').slice(0, 200);
}

async function readJson(response: Response): Promise<Row | null> {
  try {
    const body = await response.json();
    return body && typeof body === 'object' ? (body as Row) : null;
  } catch {
    return null;
  }
}

function graphError(body: Row | null, status: number): string {
  const error = (body?.error ?? {}) as Row;
  return String(error.error_user_msg || error.message || `HTTP ${status}`).slice(0, ERROR_MAX);
}

function networkError(error: unknown): string {
  const name = (error as { name?: unknown } | null)?.name;
  if (name === 'TimeoutError' || name === 'AbortError') return 'A Meta não respondeu a tempo.';
  return `Falha de rede ao falar com a Meta (${errorText(error)}).`;
}

async function graphJson(ctx: EnsureCtx, account: MetaAccount, url: string, payload?: Record<string, unknown>): Promise<GraphReply> {
  const headers: Record<string, string> = { Authorization: `Bearer ${account.token}` };
  if (payload) headers['Content-Type'] = 'application/json';
  try {
    const response = await ctx.deps.fetch(url, {
      method: payload ? 'POST' : 'GET', headers, body: payload ? JSON.stringify(payload) : undefined,
      signal: AbortSignal.timeout(ctx.deps.timeoutMs ?? META_TEMPLATE_TIMEOUT_MS),
    });
    const body = await readJson(response);
    if (response.ok && body && !body.error) return { ok: true, body };
    return { ok: false, error: graphError(body, response.status) };
  } catch (error) {
    return { ok: false, error: networkError(error) };
  }
}

function templatesUrl(account: MetaAccount): string {
  return `${GRAPH_URL}/${encodeURIComponent(account.wabaId)}/message_templates`;
}

function createPayload(step: FixedStep): Record<string, unknown> {
  const body: Record<string, unknown> = { type: 'BODY', text: step.body };
  if (step.variables > 0) body.example = { body_text: [[FIXED_EXAMPLE_NAME]] };
  return { name: step.name, category: FIXED_TEMPLATE_CATEGORY, language: FIXED_TEMPLATE_LANGUAGE, components: [body] };
}

async function accountOf(ctx: EnsureCtx): Promise<MetaAccount | null> {
  if (ctx.account !== undefined) return ctx.account;
  try {
    ctx.account = await ctx.deps.port.account(ctx.userId);
  } catch (error) {
    ctx.deps.log('cadence_fixed_account_failed', { userId: ctx.userId, error: errorText(error) });
    ctx.account = null;
  }
  return ctx.account;
}

// Mesmo nome e idioma pt_BR (o filtro name da Graph não é exato).
async function lookupTemplate(ctx: EnsureCtx, account: MetaAccount, name: string): Promise<Row | null> {
  const url = `${templatesUrl(account)}?name=${encodeURIComponent(name)}&fields=${LOOKUP_FIELDS}`;
  const reply = await graphJson(ctx, account, url);
  if ('error' in reply) {
    ctx.deps.log('cadence_fixed_template_lookup_failed', { userId: ctx.userId, name, error: reply.error });
    return null;
  }
  const exact = (Array.isArray(reply.body.data) ? reply.body.data : []).filter((t: Row) => t && t.name === name);
  return exact.find((t: Row) => t.language === FIXED_TEMPLATE_LANGUAGE) ?? exact[0] ?? null;
}

async function insertRow(ctx: EnsureCtx, step: FixedStep, meta: Row): Promise<FixedTemplateInfo> {
  const status = upper(meta.status) || 'PENDING';
  const reason = cleanReason(meta.rejected_reason);
  try {
    await ctx.deps.port.insert({
      user_id: String(ctx.userId), name: step.name, meta_template_id: meta.id ? String(meta.id) : null,
      category: upper(meta.category) || FIXED_TEMPLATE_CATEGORY, language: FIXED_TEMPLATE_LANGUAGE, body_text: step.body,
      example_values: step.variables > 0 ? [FIXED_EXAMPLE_NAME] : [], status, rejection_reason: reason,
      updated_at: ctx.deps.now().toISOString(),
    });
  } catch (error) {
    // O template já existe na Meta: a próxima rodada acha pelo nome e grava de novo.
    ctx.deps.log('cadence_fixed_template_save_failed', { userId: ctx.userId, name: step.name, error: errorText(error) });
  }
  return info(step, status, reason);
}

async function createStep(ctx: EnsureCtx, step: FixedStep): Promise<FixedTemplateInfo> {
  const account = await accountOf(ctx);
  if (!account) return info(step, FIXED_NOT_CREATED, NO_META_ACCOUNT_REASON);
  const created = await graphJson(ctx, account, templatesUrl(account), createPayload(step));
  if ('body' in created) {
    ctx.deps.log('cadence_fixed_template_created', { userId: ctx.userId, step: step.step, name: step.name, status: upper(created.body.status) });
    return insertRow(ctx, step, created.body);
  }
  // Criado antes e perdido no cache (ou nome já usado): adota o que está na Meta.
  const found = await lookupTemplate(ctx, account, step.name);
  if (found) return insertRow(ctx, step, found);
  ctx.deps.log('cadence_fixed_template_create_failed', { userId: ctx.userId, step: step.step, name: step.name, error: created.error });
  return info(step, FIXED_NOT_CREATED, created.error);
}

async function pollStep(ctx: EnsureCtx, step: FixedStep, row: FixedTemplateRow): Promise<FixedTemplateInfo> {
  const current = rowInfo(step, row);
  const account = await accountOf(ctx);
  const found = account ? await lookupTemplate(ctx, account, step.name) : null;
  if (!found) return current;
  const next = info(step, upper(found.status) || current.status, cleanReason(found.rejected_reason));
  if (next.status === current.status && next.reason === current.reason) return current;
  try {
    const patch: Row = { status: next.status, rejection_reason: next.reason, updated_at: ctx.deps.now().toISOString() };
    if (!row.metaTemplateId && found.id) patch.meta_template_id = String(found.id);
    await ctx.deps.port.update(ctx.userId, step.name, patch);
    ctx.deps.log('cadence_fixed_template_status', { userId: ctx.userId, step: step.step, name: step.name, status: next.status });
  } catch (error) {
    ctx.deps.log('cadence_fixed_template_save_failed', { userId: ctx.userId, name: step.name, error: errorText(error) });
  }
  return next;
}

function ensureStep(ctx: EnsureCtx, step: FixedStep, row: FixedTemplateRow | undefined): Promise<FixedTemplateInfo> {
  if (!row) return createStep(ctx, step);
  if (POLLED_STATUSES.has(upper(row.status))) return pollStep(ctx, step, row);
  return Promise.resolve(rowInfo(step, row));
}

async function loadRows(ctx: EnsureCtx, steps: FixedStep[]): Promise<Map<string, FixedTemplateRow> | null> {
  try {
    const rows = await ctx.deps.port.rows(ctx.userId, steps.map((s) => s.name));
    return new Map(rows.map((row) => [row.name, row]));
  } catch (error) {
    ctx.deps.log('cadence_fixed_templates_load_failed', { userId: ctx.userId, error: errorText(error) });
    return null;
  }
}

// Para cada passo com texto: sem linha no cache, cria na Meta (MARKETING, pt_BR) e grava;
// em análise (PENDING ou IN_APPEAL), consulta o status e atualiza. Nunca lança: loga e segue.
export async function ensureFixedTemplates(userId: string, texts: readonly unknown[] | null | undefined, deps: EnsureFixedDeps): Promise<FixedTemplateInfo[]> {
  const steps = fixedSteps(texts);
  if (!steps.length) return [];
  const ctx: EnsureCtx = { userId, deps };
  const rows = await loadRows(ctx, steps);
  if (!rows) return [];
  const out: FixedTemplateInfo[] = [];
  for (const step of steps) out.push(await ensureStep(ctx, step, rows.get(step.name)));
  return out;
}

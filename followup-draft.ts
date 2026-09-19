// Rascunho de retomada (follow-up) escrito pela IA a partir do histórico da
// conversa. Não fala com rede nem banco: a IA e a memória supervisionada chegam
// por DraftDeps. Tudo o que vai para a IA passa antes por redactForAi (LGPD).
import type { AgentConfig, AgentMessage } from './ai-agent.js';
import { parseAgentHandoff } from './agent-autonomy.js';
import { enforceApprovedPortfolioUrls, portfolioLinksForNiche } from './agent-portfolio.js';
import {
  analyzeConversationFlow,
  enforceSingleQuestion,
  splitColonBeforeQuestion,
} from './agent-conversation-flow.js';
import type { DraftWarning, FollowUpStep, FollowUpTrack, PreviewMessage } from './src/features/followups/types.js';

export const FOLLOWUP_DIRECTIVE_VERSION = 'v2';

export interface DraftRow { body: string | null; from_me: boolean; type: string | null; transcription: string | null; timestamp: string }
export interface AiAgentConfigRow { persona: string | null; objective: string | null; knowledge: string | null; rules: string | null;
  sales_strategy: string | null; attendant_name: string | null; learned_playbook: string | null; portfolio_links: unknown }
// track ausente = 'ladder'; trackSteps = total de toques da trilha (só para o cabeçalho da diretiva).
export interface DraftInput { userId: string; waNumber: string; step: FollowUpStep; contactName: string | null; rows: DraftRow[];
  agent: AiAgentConfigRow; extraInstructions: string; userInstruction?: string; track?: FollowUpTrack; trackSteps?: number;
  invisible: { basis: boolean; at: string | null; read: boolean }; customerReactedAfterBasis?: boolean; now: Date }
export interface DraftMeta { version: string; model: string | null; latency_ms: number | null; usage: unknown; cost_usd: number | null;
  niche: string | null; messages_used: number; warnings: DraftWarning[]; generated_at: string }
export type DraftResult =
  | { kind: 'draft'; text: string; warnings: DraftWarning[]; meta: DraftMeta }
  | { kind: 'skip'; reason: string; meta: DraftMeta }
  | { kind: 'handoff'; reason: string; meta: DraftMeta }
  | { kind: 'error'; retryable: boolean; message: string };
export interface DraftDeps {
  getReplyDetailed(config: AgentConfig, messages: AgentMessage[], opts: { extraInstruction?: string }):
    Promise<{ text: string; modelId: string; latencyMs: number; usage: unknown; estimatedCostUsd: number }>;
  loadSupervisedMemory(userId: string, waNumber: string): Promise<string>;
}

// ── Textos fixos (sem travessão) ─────────────────────────────────────────────

export const FOLLOWUP_INSTRUCTION = [
  'MODO RETOMADA.',
  'A conversa parou com a última mensagem do estúdio e o cliente não respondeu.',
  'Escreva UMA mensagem de retomada, como a mesma pessoa do estúdio que vinha conversando.',
  'Saída: somente o texto para o cliente (1 ou 2 balões, linha em branco entre eles); OU somente ###SKIP### se não fizer sentido retomar (já fechou, recusou, pediu para não insistir, disse que não tem interesse, conversa encerrada ou assunto que não é ensaio); OU somente ###HUMANO:<motivo>### (disponibilidade, pagamento, duvida, reclamacao, pessoa) se ficou pergunta do cliente sem resposta que depende de uma pessoa, inclusive algo que o estúdio prometeu confirmar.',
  'PROIBIDO: citar preço, valor, parcela, desconto, percentual, data de calendário, horário, prazo ou disponibilidade de agenda; prometer vaga; inventar promoção, brinde ou condição; reenviar pacote ou PDF (nunca use ###PDF###); link fora do portfólio aprovado; dizer ou insinuar que é mensagem automática, lembrete, robô, IA ou sistema; mencionar tempo sem resposta (sumiu, faz dias, sem retorno); cobrar resposta; dois-pontos.',
  'Trechos como [telefone], [email] e [cpf] são dados ocultados: nunca os reproduza.',
  'Neste retorno, depois de dias sem conversa, PODE abrir com "Oi, <primeiro nome>!" (sem "tudo bem?").',
  'No máximo uma pergunta.',
  'Não repita frases das retomadas anteriores que já aparecem no histórico.',
].join(' ');

// Sem este turno, prepareOpenAIConversation descarta as falas do estúdio que
// abrem o histórico (a API exige começar pelo usuário).
export const HISTORY_START_NOTE = '[NOTA DO SISTEMA - início do histórico disponível; as mensagens do estúdio abaixo vieram antes de qualquer resposta registrada do cliente]';

export const STEP_DIRECTIVES: Readonly<Record<FollowUpStep, string>> = {
  1: 'Retome com carinho o último assunto concreto (o orçamento ou pacote que foi enviado, ou a última pergunta que ficou no ar), usando as palavras dela. Pergunte se conseguiu dar uma olhada ou se ficou alguma dúvida. 1 balão, curto.',
  2: 'Traga UM ponto de valor da experiência ligado ao que ela contou (como é o dia do ensaio, a direção de poses, o resultado que ela vai guardar), usando SÓ o que está na base de conhecimento ou na conversa. Termine com uma pergunta leve, por exemplo qual pacote chamou mais atenção. Sem pressão.',
  3: 'Convide a pensar na data a partir do momento DELA (semanas de gestação, idade do bebê, data que ela citou) e, só se estiver escrito na base, da política real de agenda. Proibido dizer que uma data está livre ou ocupada ou que restam poucas vagas. Proponha ver a data junto, com uma pergunta.',
  4: 'Última retomada. Despedida gentil, sem cobrança nem culpa. Entenda que talvez não seja o momento e deixe a porta aberta para ela chamar quando quiser. Sem pergunta que exija resposta, sem combinado e sem dia de retorno. 1 balão.',
};

// Trilha antes do orçamento: a conversa morreu antes do PDF. Sem preço, sem PDF, sem data.
const PRE_QUOTE_GUARD = 'Ainda não houve orçamento: não cite preço, valor, parcela nem pacote específico, não mande PDF e não invente data. Se ela disse que ia pensar ou pediu para chamar em outra data que ainda não chegou, responda só ###SKIP###.';

export const PRE_QUOTE_DIRECTIVES: Readonly<Record<1 | 2, string>> = {
  1: `Retome de onde a conversa parou. Se a última fala do estúdio foi uma pergunta (tipo de ensaio, semanas de gestação, idade do bebê, o que ela imagina), retome essa pergunta de forma leve e natural, com outras palavras, sem repetir a frase. Uma pergunta só. Tom de quem quer ajudar a pessoa a chegar no ensaio certo. 1 balão, curto. ${PRE_QUOTE_GUARD}`,
  2: `Última retomada, leve. Deixe a porta aberta, algo como "quando fizer sentido, é só me chamar". Sem cobrança, sem culpa e sem comentar o tempo sem resposta. Nenhuma pergunta que exija resposta. 1 balão. ${PRE_QUOTE_GUARD}`,
};

export const REACTION_NOTE = '[ATENÇÃO: a cliente reagiu com um emoji à última mensagem. Considere isso como sinal de leitura.]';

// {{2}} do template quando o gancho tirado do rascunho fica curto demais.
export const NEUTRAL_HOOKS: Readonly<Record<FollowUpStep, string>> = {
  1: 'Fiquei pensando no seu ensaio e quis saber se ficou alguma dúvida.',
  2: 'Lembrei de você e do seu ensaio. Qual pacote chamou mais a sua atenção?',
  3: 'Quando quiser, a gente pensa junto no melhor momento para o seu ensaio.',
  4: 'Se agora não for o momento, tudo bem. Fico por aqui para quando quiser conversar sobre o seu ensaio.',
};

export const PRE_QUOTE_NEUTRAL_HOOKS: Readonly<Record<1 | 2, string>> = {
  1: 'Fiquei pensando no seu ensaio e quis retomar a nossa conversa.',
  2: 'Quando fizer sentido para você, é só me chamar para a gente seguir com o seu ensaio.',
};

export const NO_KNOWLEDGE_MESSAGE = 'Configure o Agente IA (base de conhecimento) antes de gerar follow-ups.';
const INVALID_STEP_MESSAGE = 'Passo de retomada inválido.';
const TOO_LONG_MESSAGE = 'A IA escreveu um texto longo demais. Tente gerar de novo.';

// ── Limites ─────────────────────────────────────────────────────────────────

export const STEP_CHAR_LIMITS: Readonly<Record<FollowUpStep, number>> = { 1: 280, 2: 420, 3: 420, 4: 320 };
export const PRE_QUOTE_CHAR_LIMITS: Readonly<Record<1 | 2, number>> = { 1: 280, 2: 280 };
export const MAX_BALLOONS = 2;
export const HARD_MAX_CHARS = 700;
export const CONTEXT_TAIL_MAX = 8;
export const CONTEXT_BODY_MAX = 280;
export const TEMPLATE_HOOK_MAX = 180;
const TEMPLATE_HOOK_MIN = 20;
const MIN_KNOWLEDGE_CHARS = 20;
const MAX_ATTEMPTS = 2;
const VALID_STEPS = new Set<number>([1, 2, 3, 4]);
const VALID_PRE_QUOTE_STEPS = new Set<number>([1, 2]);

function isPreQuote(track: FollowUpTrack | null | undefined): boolean {
  return track === 'pre_quote';
}

export function charLimitFor(step: FollowUpStep, track?: FollowUpTrack | null): number {
  if (isPreQuote(track)) return PRE_QUOTE_CHAR_LIMITS[step as 1 | 2] ?? PRE_QUOTE_CHAR_LIMITS[2];
  return STEP_CHAR_LIMITS[step];
}

// ── Máscara de dados pessoais (LGPD) ─────────────────────────────────────────

const EMAIL_PATTERN = /[\w.+-]+@[\w-]+\.[\w.]+/g;
const CPF_PATTERN = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g;
const PHONE_PATTERN = /(?:\+?55\s?)?\(?\d{2}\)?\s?9?\d{4}[-\s]?\d{4}\b/g;
// Celular sem DDD escrito como 9xxxx-xxxx: a regex principal exige o DDD.
const LOCAL_MOBILE_PATTERN = /\b9\d{4}-\d{4}\b/g;

export function redactForAi(text: string): string {
  return String(text ?? '')
    .replace(EMAIL_PATTERN, '[email]')
    .replace(CPF_PATTERN, '[cpf]')
    .replace(PHONE_PATTERN, '[telefone]')
    .replace(LOCAL_MOBILE_PATTERN, '[telefone]');
}

// ── Histórico → turnos ──────────────────────────────────────────────────────

function trimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function documentText(row: DraftRow): string {
  const name = trimmed(row.body);
  const label = row.from_me ? 'documento enviado' : 'documento';
  return name ? `[${label}: ${name}]` : `[${label}]`;
}

const ROW_TEXT = new Map<string, (row: DraftRow) => string>([
  ['text', (row) => trimmed(row.body)],
  ['audio', (row) => trimmed(row.transcription) || '[áudio]'],
  ['image', (row) => trimmed(row.transcription) || trimmed(row.body) || '[imagem]'],
  ['video', (row) => trimmed(row.body) || '[vídeo]'],
  ['document', documentText],
  ['sticker', () => '[figurinha]'],
  ['unsupported', () => '[mensagem não suportada]'],
  // Não são turno de conversa: a reação entra como aviso separado.
  ['reaction', () => ''],
  ['edit', () => ''],
  ['revoke', () => ''],
]);

function defaultRowText(row: DraftRow): string {
  return trimmed(row.body) || trimmed(row.transcription);
}

function rowText(row: DraftRow): string {
  const type = trimmed(row.type).toLowerCase() || 'text';
  return (ROW_TEXT.get(type) ?? defaultRowText)(row);
}

// O chamador já manda em ordem cronológica; só reordena quando todos os
// horários são válidos, para não embaralhar linha sem timestamp.
function chronological(rows: DraftRow[]): DraftRow[] {
  const list = Array.isArray(rows) ? rows.filter(Boolean) : [];
  const stamps = list.map((row) => Date.parse(row?.timestamp ?? ''));
  if (!stamps.every(Number.isFinite)) return list;
  return list
    .map((row, index) => ({ row, index, at: stamps[index] }))
    .sort((a, b) => a.at - b.at || a.index - b.index)
    .map((entry) => entry.row);
}

export function toAgentMessages(rows: DraftRow[]): AgentMessage[] {
  return chronological(rows).flatMap((row): AgentMessage[] => {
    const content = redactForAi(rowText(row)).trim();
    if (!content) return [];
    return [{ role: row.from_me ? 'assistant' : 'user', content }];
  });
}

export function buildFollowupTurns(history: AgentMessage[], directive: string): AgentMessage[] {
  const turns = history.map((message) => ({ role: message.role, content: message.content }));
  if (turns[0]?.role === 'assistant') turns.unshift({ role: 'user', content: HISTORY_START_NOTE });
  turns.push({ role: 'user', content: directive });
  return turns;
}

// ── Diretiva do passo ────────────────────────────────────────────────────────

const BRT_FORMAT = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

function brtStamp(iso: string | null | undefined): string | null {
  const ms = Date.parse(iso ?? '');
  if (!Number.isFinite(ms)) return null;
  const parts = Object.fromEntries(BRT_FORMAT.formatToParts(new Date(ms)).map((part) => [part.type, part.value]));
  return `${parts.day}/${parts.month} ${parts.hour}:${parts.minute} BRT`;
}

export function invisibleBasisNote(at: string | null | undefined): string {
  const when = brtStamp(at);
  const moment = when ? ` em ${when}` : '';
  return `[ATENÇÃO: o atendimento automático oficial do WhatsApp respondeu${moment} e o texto dessa resposta NÃO está disponível. Não contradiga, não cite números nem detalhes; retome de forma geral.]`;
}

function nicheLabel(niche: string | null): string {
  return niche ? niche.replace(/_/g, ' ') : 'desconhecido';
}

function directiveExtras(i: DraftInput): string[] {
  const extras: string[] = [];
  if (i.invisible?.basis) extras.push(invisibleBasisNote(i.invisible.at));
  if (i.customerReactedAfterBasis) extras.push(REACTION_NOTE);
  const instruction = redactForAi(trimmed(i.userInstruction));
  if (instruction) extras.push(`Instrução do estúdio para esta versão: ${instruction}`);
  return extras;
}

function preQuoteDirective(i: DraftInput): string {
  const total = Math.min(2, Math.max(1, Math.floor(Number(i.trackSteps) || 2)));
  // Com um toque só, o 1º já é a despedida leve.
  return PRE_QUOTE_DIRECTIVES[(i.step >= total ? 2 : 1) as 1 | 2];
}

function directiveFor(i: DraftInput): { label: string; text: string } {
  if (!isPreQuote(i.track)) return { label: `Retomada ${i.step} de 4`, text: STEP_DIRECTIVES[i.step] };
  const total = Math.min(2, Math.max(1, Math.floor(Number(i.trackSteps) || 2)));
  return { label: `Retomada antes do orçamento, toque ${i.step} de ${total}`, text: preQuoteDirective(i) };
}

export function stepDirective(i: DraftInput, niche: string | null): string {
  const name = firstName(i.contactName) ?? 'desconhecido';
  const directive = directiveFor(i);
  const header = `[NOTA DO SISTEMA - NÃO é mensagem do cliente. ${directive.label}. Primeiro nome: ${name}. Nicho: ${nicheLabel(niche)}.]`;
  return [header, directive.text, ...directiveExtras(i)].join('\n');
}

export function followupExtraInstruction(extraInstructions: string | null | undefined): string {
  const studio = redactForAi(trimmed(extraInstructions));
  return studio ? `${FOLLOWUP_INSTRUCTION}\nInstruções do estúdio: ${studio}` : FOLLOWUP_INSTRUCTION;
}

// ── Interpretação e limpeza da resposta ─────────────────────────────────────

export type InterpretedReply =
  | { kind: 'skip'; reason: string; warnings: DraftWarning[] }
  | { kind: 'handoff'; reason: string; warnings: DraftWarning[] }
  | { kind: 'text'; text: string };

const PORTFOLIO_HANDOFF = '###HUMANO:duvida###';

export function interpretFollowupReply(raw: string, portfolioLinks: unknown, niche: string | null): InterpretedReply {
  const text = String(raw ?? '');
  if (/###SKIP###/i.test(text)) return { kind: 'skip', reason: 'ai_skip', warnings: [] };
  const handoff = parseAgentHandoff(text);
  if (handoff) return { kind: 'handoff', reason: handoff, warnings: [] };
  if (enforceApprovedPortfolioUrls(text, portfolioLinks, niche) === PORTFOLIO_HANDOFF) {
    return { kind: 'handoff', reason: 'duvida', warnings: ['link_nao_aprovado'] };
  }
  return { kind: 'text', text };
}

// Travessão e meia-risca montados por código: o caractere não entra no fonte.
const DASHES = String.fromCharCode(0x2013, 0x2014);
const LABEL_PATTERN = new RegExp(`^(?:mensagem|follow-?up|retomada|resposta)(?:\\s+(?:\\d|final|de retomada|para (?:o|a) cliente))?\\s*[:${DASHES}-]\\s*`, 'i');
const WRAPPING_QUOTES: ReadonlyArray<readonly [string, string]> = [['"', '"'], ['“', '”'], ["'", "'"], ['«', '»']];
const FULL_TOKEN = /###[^#\n]*###/g;
const LEFTOVER_TOKEN = /#{3,}\S*/g;
const PDF_TOKEN = /###\s*pdf/i;
const BOLD_PATTERN = /\*\*([^*\n]+?)\*\*/g;
const SIGNATURE_LINE = new RegExp(`^[${DASHES}-]\\s*\\p{L}[\\p{L} .]{0,40}$`, 'u');

function stripLabel(text: string): string {
  return text.trim().replace(LABEL_PATTERN, '').trim();
}

function stripWrappingQuotes(text: string): string {
  const t = text.trim();
  const pair = WRAPPING_QUOTES.find(([open, close]) => t.length >= 2 && t.startsWith(open) && t.endsWith(close));
  if (!pair) return t;
  const inner = t.slice(pair[0].length, t.length - pair[1].length);
  return inner.includes(pair[0]) || inner.includes(pair[1]) ? t : inner.trim();
}

function stripTokens(text: string): { text: string; warnings: DraftWarning[] } {
  const warnings: DraftWarning[] = PDF_TOKEN.test(text) ? ['pdf_removido'] : [];
  return { text: text.replace(FULL_TOKEN, '').replace(LEFTOVER_TOKEN, ''), warnings };
}

function dropSignature(text: string): string {
  const lines = text.trimEnd().split('\n');
  if (lines.length < 2 || !SIGNATURE_LINE.test(lines[lines.length - 1].trim())) return text;
  return lines.slice(0, -1).join('\n');
}

function normalizeLines(text: string): string {
  return text.split('\n').map((line) => line.trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function cleanFollowupText(text: string, step: FollowUpStep): { text: string; warnings: DraftWarning[] } {
  const unwrapped = stripLabel(stripWrappingQuotes(stripLabel(String(text ?? ''))));
  const tokens = stripTokens(unwrapped);
  const formatted = normalizeLines(dropSignature(tokens.text.replace(BOLD_PATTERN, '*$1*')));
  const split = splitColonBeforeQuestion(formatted);
  const single = step === 4 ? split : enforceSingleQuestion(split);
  return { text: single.trim(), warnings: tokens.warnings };
}

// ── Avisos ──────────────────────────────────────────────────────────────────

const WARNING_PATTERNS: ReadonlyArray<readonly [DraftWarning, RegExp]> = [
  ['preco', /r\$\s?\d|\b\d{2,5}(?:[.,]\d{2})?\s?(?:reais|conto)\b/i],
  ['percentual', /\d+\s?%/],
  ['desconto', /\b(?:descontos?|promo[çc](?:[aã]o|[õo]es)|cupo(?:m|ns)|brindes?|condi[çc](?:[aã]o|[õo]es) especia(?:l|is))\b/i],
  ['data', /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b|\bdia\s+\d{1,2}\b|\b\d{1,2}\s+de\s+(?:janeiro|fevereiro|março|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b/i],
  ['horario', /\b\d{1,2}\s?h(?:\d{2})?\b|\b\d{1,2}:\d{2}\b/i],
  ['vaga', /(?<![\p{L}\p{N}])(?:[úu]ltimas?|poucas|s[óo] (?:tenho|temos|restam?))\s+(?:vagas?|datas?|hor[áa]rios?)(?![\p{L}\p{N}])|vaga garantida/iu],
  ['revela_automacao', /(?:mensagem|resposta|lembrete|atendimento) autom[áa]tic[oa]|(?<![\p{L}\p{N}])sou (?:uma? )?(?:ia|intelig[êe]ncia artificial|rob[ôo]|assistente virtual|bot)(?![\p{L}\p{N}])/iu],
  ['tempo_decorrido', /(?<![\p{L}\p{N}])(?:sumiu|sumida|sumido|n[ãa]o me respondeu|faz (?:uns |alguns )?dias|h[áa] (?:uns |alguns )?dias|faz tempo|sem retorno)(?![\p{L}\p{N}])/iu],
  ['dois_pontos', /[^\d\s/]:(?:\s|$)/],
];

const NUMBER_PATTERN = /\d+(?:[.,]\d+)*/g;

function numberTokens(text: string): string[] {
  return (text.match(NUMBER_PATTERN) ?? []).map((token) => token.replace(/\D/g, '')).filter((digits) => digits.length >= 2);
}

// "1.500,00" na base também confirma "1.500" no texto.
function knownNumbers(text: string): Set<string> {
  const known = new Set(numberTokens(text));
  for (const token of text.match(NUMBER_PATTERN) ?? []) {
    if (/[.,]\d{2}$/.test(token)) known.add(token.slice(0, -3).replace(/\D/g, ''));
  }
  return known;
}

function hasUnverifiedNumber(text: string, knownText: string): boolean {
  const known = knownNumbers(knownText);
  return numberTokens(text).some((digits) => !known.has(digits));
}

export function draftWarnings(text: string, knowledge: string, conversationText: string): DraftWarning[] {
  const warnings = WARNING_PATTERNS.filter(([, pattern]) => pattern.test(text)).map(([warning]) => warning);
  if (hasUnverifiedNumber(text, `${knowledge}\n${conversationText}`)) warnings.push('numero_nao_verificado');
  return warnings;
}

function balloonCount(text: string): number {
  return text.split(/\n\s*\n/).filter((part) => part.trim()).length;
}

export function limitWarnings(text: string, step: FollowUpStep, track?: FollowUpTrack | null): DraftWarning[] {
  const warnings: DraftWarning[] = [];
  if (text.length > charLimitFor(step, track)) warnings.push('longo');
  if (balloonCount(text) > MAX_BALLOONS) warnings.push('muitos_baloes');
  return warnings;
}

function uniqueWarnings(list: DraftWarning[]): DraftWarning[] {
  return [...new Set(list)];
}

// ── Gancho do template e primeiro nome ──────────────────────────────────────

const GREETING_PATTERN = /^(?:oi+|ol[áa])(?!\p{L})[^!?.\n]{0,40}[!,.]\s*/iu;

function withoutLoneSurrogate(text: string): string {
  return text.replace(/[\uD800-\uDBFF]$/, '');
}

function cutAtWord(text: string, max: number): string {
  const head = withoutLoneSurrogate(text.slice(0, Math.max(0, max - 1)));
  const lastSpace = head.lastIndexOf(' ');
  const base = (lastSpace > 0 ? head.slice(0, lastSpace) : head).replace(/[\s,;:]+$/, '');
  return `${base}…`;
}

function cutHook(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = text.slice(0, max);
  const lastStop = Math.max(head.lastIndexOf('.'), head.lastIndexOf('!'), head.lastIndexOf('?'));
  if (lastStop + 1 >= TEMPLATE_HOOK_MIN) return head.slice(0, lastStop + 1);
  return cutAtWord(text, max);
}

function neutralHook(step: FollowUpStep, max: number, track?: FollowUpTrack | null): string {
  const preQuote = isPreQuote(track) ? PRE_QUOTE_NEUTRAL_HOOKS[step as 1 | 2] ?? PRE_QUOTE_NEUTRAL_HOOKS[2] : null;
  const neutral = preQuote ?? NEUTRAL_HOOKS[step] ?? NEUTRAL_HOOKS[1];
  return neutral.length <= max ? neutral : cutAtWord(neutral, max);
}

export function toTemplateHook(text: string, step: FollowUpStep, max = TEMPLATE_HOOK_MAX, track?: FollowUpTrack | null): string {
  const balloons = String(text ?? '').trim().replace(GREETING_PATTERN, '').split(/\n\s*\n/);
  const flat = balloons.map((part) => part.trim()).filter(Boolean).join(' ')
    .replace(/[\n\t\r]+/g, ' ').replace(/ {2,}/g, ' ').trim();
  const hook = cutHook(flat, max);
  if (hook.length < TEMPLATE_HOOK_MIN) return neutralHook(step, max, track);
  // Sem a saudação o trecho pode começar em minúscula; o template já abre com "Oi, {{1}}!".
  return hook.charAt(0).toLocaleUpperCase('pt-BR') + hook.slice(1);
}

const NAME_JUNK = /[^\p{L}\p{M}\p{N}'-]/gu;

function titleCase(token: string): string {
  return token.toLocaleLowerCase('pt-BR').replace(/(^|-)(\p{L})/gu, (_m, sep: string, letter: string) => sep + letter.toLocaleUpperCase('pt-BR'));
}

export function firstName(contactName: string | null): string | null {
  const tokens = String(contactName ?? '').normalize('NFC').split(/\s+/)
    .map((token) => token.replace(NAME_JUNK, '').replace(/^['-]+|['-]+$/g, ''))
    .filter(Boolean);
  const token = tokens[0];
  if (!token || /\p{N}/u.test(token) || token.length <= 2) return null;
  return titleCase(token);
}

// ── Prévia guardada no nosso banco (sem máscara) ────────────────────────────

function truncateBody(text: string): string {
  if (text.length <= CONTEXT_BODY_MAX) return text;
  return `${withoutLoneSurrogate(text.slice(0, CONTEXT_BODY_MAX - 1))}…`;
}

export function contextTail(rows: DraftRow[], max = CONTEXT_TAIL_MAX): PreviewMessage[] {
  const limit = Math.min(CONTEXT_TAIL_MAX, Math.floor(Number(max) || 0));
  if (limit <= 0) return [];
  return chronological(rows)
    .map((row) => ({ row, body: rowText(row) }))
    .filter((entry) => entry.body)
    .slice(-limit)
    .map(({ row, body }) => ({
      from_me: Boolean(row.from_me),
      body: truncateBody(body),
      type: trimmed(row.type) || 'text',
      timestamp: row.timestamp,
    }));
}

// ── Geração ─────────────────────────────────────────────────────────────────

type DraftOutcome =
  | { kind: 'draft'; text: string; warnings: DraftWarning[] }
  | { kind: 'skip'; reason: string; warnings: DraftWarning[] }
  | { kind: 'handoff'; reason: string; warnings: DraftWarning[] };

interface GenerationContext {
  config: AgentConfig;
  history: AgentMessage[];
  directive: string;
  extraInstruction: string;
  niche: string | null;
  portfolioLinks: unknown;
  conversationText: string;
}

interface ReplyTally { model: string | null; latencyMs: number | null; costUsd: number | null; usage: unknown }

const EMPTY_TALLY: ReplyTally = { model: null, latencyMs: null, costUsd: null, usage: null };

function redactedField(value: unknown): string {
  return redactForAi(trimmed(value));
}

function detectNiche(history: AgentMessage[]): string | null {
  try {
    return analyzeConversationFlow(history).niche ?? null;
  } catch {
    return null;
  }
}

async function buildAgentConfig(i: DraftInput, d: DraftDeps, niche: string | null): Promise<AgentConfig> {
  const memory = await d.loadSupervisedMemory(i.userId, i.waNumber);
  const a = i.agent;
  return {
    enabled: true,
    persona: redactedField(a.persona),
    objective: redactedField(a.objective),
    knowledge: redactedField(a.knowledge),
    rules: redactedField(a.rules),
    salesStrategy: redactedField(a.sales_strategy),
    attendantName: redactedField(a.attendant_name),
    learnedPlaybook: redactedField(a.learned_playbook),
    supervisedMemory: redactedField(memory),
    portfolioLinks: portfolioLinksForNiche(a.portfolio_links, niche),
  };
}

async function prepareContext(i: DraftInput, d: DraftDeps, history: AgentMessage[], niche: string | null): Promise<GenerationContext> {
  const config = await buildAgentConfig(i, d, niche);
  const studioText = [redactedField(i.extraInstructions), redactedField(i.userInstruction)];
  return {
    config,
    history,
    directive: stepDirective(i, niche),
    extraInstruction: followupExtraInstruction(i.extraInstructions),
    niche,
    portfolioLinks: i.agent.portfolio_links,
    conversationText: [...history.map((message) => message.content), ...studioText].join('\n'),
  };
}

function evaluateReply(raw: string, step: FollowUpStep, ctx: GenerationContext, track?: FollowUpTrack): DraftOutcome {
  const interpreted = interpretFollowupReply(raw, ctx.portfolioLinks, ctx.niche);
  if (interpreted.kind !== 'text') return interpreted;
  const cleaned = cleanFollowupText(interpreted.text, step);
  if (!cleaned.text) return { kind: 'skip', reason: 'empty', warnings: cleaned.warnings };
  const warnings = [
    ...cleaned.warnings,
    ...draftWarnings(cleaned.text, ctx.config.knowledge, ctx.conversationText),
    ...limitWarnings(cleaned.text, step, track),
  ];
  return { kind: 'draft', text: cleaned.text, warnings };
}

function exceedsHardLimit(outcome: DraftOutcome): boolean {
  return outcome.kind === 'draft' && outcome.text.length > HARD_MAX_CHARS;
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function sumNullable(total: number | null, value: unknown): number | null {
  const n = finiteOrNull(value);
  return n === null ? total : (total ?? 0) + n;
}

// Latência e custo somam as tentativas; model e usage ficam os da última.
function addReply(tally: ReplyTally, reply: Awaited<ReturnType<DraftDeps['getReplyDetailed']>>): ReplyTally {
  return {
    model: trimmed(reply?.modelId) || tally.model,
    latencyMs: sumNullable(tally.latencyMs, reply?.latencyMs),
    costUsd: sumNullable(tally.costUsd, reply?.estimatedCostUsd),
    usage: reply?.usage ?? null,
  };
}

function isoNow(now: Date): string {
  return now instanceof Date && Number.isFinite(now.getTime()) ? now.toISOString() : new Date().toISOString();
}

function finalWarnings(i: DraftInput, warnings: DraftWarning[]): DraftWarning[] {
  return uniqueWarnings(i.customerReactedAfterBasis ? [...warnings, 'reacao_cliente'] : warnings);
}

function draftMeta(i: DraftInput, niche: string | null, messagesUsed: number, tally: ReplyTally, warnings: DraftWarning[]): DraftMeta {
  return {
    version: FOLLOWUP_DIRECTIVE_VERSION,
    model: tally.model,
    latency_ms: tally.latencyMs,
    usage: tally.usage,
    cost_usd: tally.costUsd,
    niche,
    messages_used: messagesUsed,
    warnings: finalWarnings(i, warnings),
    generated_at: isoNow(i.now),
  };
}

function toDraftResult(outcome: DraftOutcome, meta: DraftMeta): DraftResult {
  if (outcome.kind === 'draft') return { kind: 'draft', text: outcome.text, warnings: meta.warnings, meta };
  if (outcome.kind === 'skip') return { kind: 'skip', reason: outcome.reason, meta };
  return { kind: 'handoff', reason: outcome.reason, meta };
}

function aiFailure(error: unknown): DraftResult {
  const detail = String((error as { message?: unknown })?.message ?? error ?? '').replace(/\s+/g, ' ').trim().slice(0, 160);
  const suffix = detail ? ` (${detail})` : '';
  return { kind: 'error', retryable: true, message: `Não foi possível gerar o rascunho agora${suffix}. Tente de novo em instantes.` };
}

function attemptDirective(ctx: GenerationContext, i: DraftInput, attempt: number): string {
  if (attempt === 1) return ctx.directive;
  return `${ctx.directive}\n[ATENÇÃO: a versão anterior ficou longa demais. Escreva no máximo ${charLimitFor(i.step, i.track)} caracteres.]`;
}

async function runGeneration(i: DraftInput, d: DraftDeps, ctx: GenerationContext): Promise<DraftResult> {
  let tally = EMPTY_TALLY;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const turns = buildFollowupTurns(ctx.history, attemptDirective(ctx, i, attempt));
    let reply: Awaited<ReturnType<DraftDeps['getReplyDetailed']>>;
    try {
      reply = await d.getReplyDetailed(ctx.config, turns, { extraInstruction: ctx.extraInstruction });
    } catch (error) {
      return aiFailure(error);
    }
    tally = addReply(tally, reply);
    const outcome = evaluateReply(String(reply?.text ?? ''), i.step, ctx, i.track);
    if (!exceedsHardLimit(outcome)) {
      return toDraftResult(outcome, draftMeta(i, ctx.niche, ctx.history.length, tally, outcome.warnings));
    }
  }
  return { kind: 'error', retryable: true, message: TOO_LONG_MESSAGE };
}

function invalidInput(i: DraftInput): DraftResult | null {
  if (trimmed(i?.agent?.knowledge).length < MIN_KNOWLEDGE_CHARS) {
    return { kind: 'error', retryable: false, message: NO_KNOWLEDGE_MESSAGE };
  }
  const steps = isPreQuote(i.track) ? VALID_PRE_QUOTE_STEPS : VALID_STEPS;
  if (!steps.has(i.step)) return { kind: 'error', retryable: false, message: INVALID_STEP_MESSAGE };
  return null;
}

export async function generateCadenceDraft(i: DraftInput, d: DraftDeps): Promise<DraftResult> {
  const invalid = invalidInput(i);
  if (invalid) return invalid;
  const history = toAgentMessages(i.rows);
  const niche = detectNiche(history);
  // Sem nenhuma fala legível não há o que retomar; nem chama a IA.
  if (!history.length) return { kind: 'skip', reason: 'no_history', meta: draftMeta(i, niche, 0, EMPTY_TALLY, []) };
  let ctx: GenerationContext;
  try {
    ctx = await prepareContext(i, d, history, niche);
  } catch (error) {
    return aiFailure(error);
  }
  return runGeneration(i, d, ctx);
}

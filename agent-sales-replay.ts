const DAY_MS = 24 * 60 * 60 * 1000;
const SALES_EPISODE_GAP_MS = 30 * DAY_MS;

export type RawSalesReplayMessage = {
  id?: string | number | null;
  message_id?: string | null;
  from_me: boolean;
  body?: string | null;
  transcription?: string | null;
  type?: string | null;
  timestamp: string | number;
  media_url?: string | null;
};

export type SalesReplayRole = 'customer' | 'human';

export type RedactedSalesReplayMessage = {
  role: SalesReplayRole;
  content: string;
  timestamp: string;
  type: string;
};

export type SalesReplayPiiToken = {
  value: string;
  label?: string;
};

export type SalesReplayTurn = {
  index: number;
  customer_messages: RedactedSalesReplayMessage[];
  human_messages: RedactedSalesReplayMessage[];
  /** Prefixo real até a última fala atual do cliente, sem a resposta humana avaliada. */
  real_prefix: RedactedSalesReplayMessage[];
};

export type SalesReplayActionType = 'reply' | 'orcamento' | 'handoff';
export type SalesReplayHandoffReason =
  | 'fechamento'
  | 'disponibilidade'
  | 'pagamento'
  | 'duvida'
  | 'reclamacao'
  | 'pessoa';

export type SalesReplayAction = {
  type: SalesReplayActionType;
  reason?: SalesReplayHandoffReason;
  niche?: string;
};

export type CommercialQuestionTopic =
  | 'niche'
  | 'lifecycle'
  | 'creative_intent'
  | 'trust_asset'
  | 'schedule_preference'
  | 'quote_sent'
  | 'buying_signal'
  | 'other'
  | 'none';

export type SalesReplayCheckId =
  | 'response_present'
  | 'action'
  | 'next_step'
  | 'single_question'
  | 'no_pii'
  | 'safe_urls';

export type SalesReplayCheck = {
  id: SalesReplayCheckId;
  label: string;
  passed: boolean;
  detail: string;
};

export type SalesReplayTurnEvaluation = {
  passed: boolean;
  expected_action: SalesReplayAction;
  actual_action: SalesReplayAction;
  expected_next_step: CommercialQuestionTopic;
  actual_next_step: CommercialQuestionTopic;
  checks: SalesReplayCheck[];
};

export type SalesReplayEvaluationInput = {
  turn: SalesReplayTurn;
  ai_reply: string;
  expected_action?: SalesReplayAction;
  expected_next_step?: CommercialQuestionTopic;
  pii_tokens?: SalesReplayPiiToken[];
  allowed_urls?: string[];
};

export type SalesReplayActionTotals = Record<SalesReplayActionType, {
  total: number;
  passed: number;
}>;

export type SalesReplayTotals = {
  turns: number;
  passed: number;
  failed: number;
  score: number;
  checks_passed: number;
  checks_total: number;
  checks_score: number;
  by_action: SalesReplayActionTotals;
};

type TimedMessage = {
  message: RawSalesReplayMessage;
  time: number;
  sourceIndex: number;
};

type GenericRedaction = {
  replacement: string;
  pattern: RegExp;
};

const GENERIC_REDACTIONS: GenericRedaction[] = [
  { replacement: '[link]', pattern: /\b(?:https?:\/\/|www\.)[^\s<]+/giu },
  { replacement: '[e-mail]', pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu },
  { replacement: '[data]', pattern: /(?<!\d)\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?(?!\d)/g },
  { replacement: 'dia [data]', pattern: /\bdia\s+\d{1,2}\b/giu },
  { replacement: '[horário]', pattern: /\b\d{1,2}h(?:\d{2})?\b/giu },
  { replacement: '[CNPJ]', pattern: /(?<!\d)(?:\d{2}[.\s-]?\d{3}[.\s-]?\d{3}[\/\s-]?\d{4}[-\s]?\d{2})(?!\d)/g },
  { replacement: '[CPF]', pattern: /(?<!\d)(?:\d{3}[.\s-]?\d{3}[.\s-]?\d{3}[-\s]?\d{2})(?!\d)/g },
  { replacement: '[CEP]', pattern: /\b(?:CEP\s*:?\s*)?\d{5}-\d{3}\b/giu },
  { replacement: '[telefone]', pattern: /(?<!\d)(?:\+?55[\s.-]?)?(?:\(?\d{2}\)?[\s.-]?)?(?:9[\s.-]?)?\d{4}[\s.-]?\d{4}(?!\d)/g },
  { replacement: '[perfil]', pattern: /(?<![\p{L}\p{N}._%+-])@[A-Z0-9._]{2,}/giu },
];

const MEDIA_LABELS: Record<string, string> = {
  image: 'imagem',
  photo: 'imagem',
  audio: 'áudio',
  ptt: 'áudio',
  video: 'vídeo',
  document: 'documento',
  file: 'arquivo',
  sticker: 'figurinha',
  contact: 'contato',
  location: 'localização',
};

const TOPIC_PATTERNS: Array<[Exclude<CommercialQuestionTopic, 'other' | 'none'>, RegExp]> = [
  ['lifecycle', /\b(?:quantas? semanas?|quantos? dias?|ja nasceu|ainda nao nasceu|previsao do parto)\b/i],
  ['schedule_preference', /\b(?:disponibilidade.{0,30}(?:semana|segunda|terca|quarta|quinta|sexta|sabado)|meio de semana|dia de semana|fim de semana|qual dia)\b/i],
  ['quote_sent', /\b(?:(?:qual.{0,30}(?:pacote|opcao)|(?:pacote|opcao).{0,36}(?:qual|me diz)).{0,24}(?:gostou|preferiu|escolheu)|vou te mandar.{0,36}(?:pacotes?|orcamento|opcoes|valores?)|orcamento|valores?)\b/i],
  ['creative_intent', /\b(?:como.{0,24}(?:pensou|pensado|imaginou)|me conta.{0,60}(?:registrar|momento)|referenc|inspirac|estilo)\b/i],
  ['trust_asset', /\b(?:ja conhece|conhec\w*.{0,24}(?:trabalho|estudio|ensaio|fotos?)|viu.{0,24}(?:instagram|trabalho)|instagram)\b/i],
  ['niche', /\b(?:qual|que|tipo).{0,24}(?:ensaio|sessao|fotos?)\b/i],
  ['buying_signal', /\b(?:vamos fechar|quer fechar|forma de pagamento|pagar o sinal|reservar|agendar|ver uma data)\b/i],
];

function timestampMs(value: string | number): number {
  const parsed = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function messageIdentity(message: RawSalesReplayMessage): string {
  const externalId = String(message.message_id || '').trim();
  if (externalId) return `message:${externalId}`;
  const localId = String(message.id ?? '').trim();
  if (localId) return `id:${localId}`;
  return [
    message.timestamp,
    message.from_me ? 'human' : 'customer',
    message.type || 'text',
    message.body || '',
    message.transcription || '',
  ].join('|');
}

function sortAndDedupeMessages(messages: RawSalesReplayMessage[]): TimedMessage[] {
  const timed = messages.flatMap((message, sourceIndex): TimedMessage[] => {
    const time = timestampMs(message.timestamp);
    return Number.isFinite(time) ? [{ message, time, sourceIndex }] : [];
  });
  timed.sort((a, b) => a.time - b.time || a.sourceIndex - b.sourceIndex);

  const seen = new Set<string>();
  return timed.filter(({ message }) => {
    const identity = messageIdentity(message);
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

function episodeStartIndex(messages: TimedMessage[], convertedAt: number): number {
  let start = 0;
  for (let index = 1; index < messages.length; index += 1) {
    if (messages[index].time > convertedAt) break;
    if (messages[index].time - messages[index - 1].time >= SALES_EPISODE_GAP_MS) start = index;
  }
  return start;
}

/**
 * Recorta o episódio comercial que atravessa a conversão, evitando misturar uma
 * conversa antiga do mesmo telefone com a venda atual.
 */
export function selectConvertedSalesEpisode(
  messages: RawSalesReplayMessage[],
  convertedAt: string | number,
  episodeEndAt?: string | number,
): RawSalesReplayMessage[] {
  const conversionTime = timestampMs(convertedAt);
  if (!Number.isFinite(conversionTime)) throw new TypeError('convertedAt inválido para o replay de venda.');

  const requestedEnd = episodeEndAt == null ? conversionTime + DAY_MS : timestampMs(episodeEndAt);
  if (!Number.isFinite(requestedEnd)) throw new TypeError('episodeEndAt inválido para o replay de venda.');
  const endTime = Math.max(conversionTime, requestedEnd);
  const eligible = sortAndDedupeMessages(messages).filter(({ time }) => time <= endTime);
  const start = episodeStartIndex(eligible, conversionTime);
  return eligible.slice(start).map(({ message }) => message);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function tokenReplacement(token: SalesReplayPiiToken): string {
  const safeLabel = String(token.label || 'dado removido')
    .replace(/[^\p{L}\p{N} _-]/gu, '')
    .trim();
  return `[${safeLabel || 'dado removido'}]`;
}

function replaceStructuredPii(text: string, tokens: SalesReplayPiiToken[]): string {
  return [...tokens]
    .filter((token) => String(token.value || '').trim().length >= 2)
    .sort((a, b) => b.value.length - a.value.length)
    .reduce((current, token) => {
      const escaped = escapeRegExp(token.value.trim());
      const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'giu');
      return current.replace(pattern, tokenReplacement(token));
    }, text);
}

function replaceGenericPii(text: string): string {
  return GENERIC_REDACTIONS.reduce(
    (current, redaction) => current.replace(redaction.pattern, redaction.replacement),
    text,
  );
}

function redactLabeledCustomerFields(text: string): string {
  return text
    .replace(/(NOME\/IDADE\s+DO\s+BEB[EÊ]\(S\)?:\s*).*?(?=\s+PACOTE\s+ESCOLHIDO:|$)/giu, '$1[dado da criança]')
    .replace(/(ENDERE[CÇ]O\s+COMPLETO:\s*).*?(?=\s+REDE\s+SOCIAL:|$)/giu, '$1[endereço]')
    .replace(/(DATA\s+DE\s+NASCIMENTO:\s*).*?(?=\s+E-?MAIL:|$)/giu, '$1[data]')
    .replace(/(TELEFONE:\s*).*?(?=\s+ENDERE[CÇ]O|$)/giu, '$1[telefone]')
    .replace(/(E-?MAIL:\s*).*?(?=\s+TELEFONE:|$)/giu, '$1[e-mail]')
    .replace(/(CPF:\s*).*?(?=\s+DATA\s+DE\s+NASCIMENTO:|$)/giu, '$1[documento]')
    .replace(/(NOME:\s*).*?(?=\s+CPF:|$)/giu, '$1[nome da cliente]');
}

function mediaMarker(message: RawSalesReplayMessage): string | null {
  const type = String(message.type || 'text').toLowerCase();
  const label = MEDIA_LABELS[type] || (message.media_url ? 'arquivo' : null);
  if (!label) return null;
  const sender = message.from_me ? 'pelo estúdio' : 'pela cliente';
  if ((type === 'audio' || type === 'ptt') && message.transcription) return `[áudio transcrito ${sender}]`;
  return `[${label} enviado ${sender}]`;
}

function sourceMessageText(message: RawSalesReplayMessage): string {
  const marker = mediaMarker(message);
  const type = String(message.type || 'text').toLowerCase();
  if (marker && ['contact', 'location'].includes(type)) return marker;
  if (marker && ['document', 'file'].includes(type)) {
    const normalized = String(message.body || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const packageKind = normalized.match(/\b(gestante|newborn|smash(?:_the_cake| the cake)?|familia|aniversario|marca pessoal|dicas)\b/)?.[1];
    return packageKind ? `${marker} [pacote ${packageKind}]` : marker;
  }
  const source = (type === 'audio' || type === 'ptt') && message.transcription
    ? message.transcription
    : message.body;
  const content = String(source || '').trim();
  return [marker, content].filter(Boolean).join(' ');
}

function cleanRedactedText(text: string): string {
  return text
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function redactSalesReplayMessage(
  message: RawSalesReplayMessage,
  piiTokens: SalesReplayPiiToken[] = [],
): RedactedSalesReplayMessage {
  const labeledSafe = redactLabeledCustomerFields(sourceMessageText(message));
  const structuredSafe = replaceStructuredPii(labeledSafe, piiTokens);
  const content = cleanRedactedText(replaceGenericPii(structuredSafe));
  const time = timestampMs(message.timestamp);
  return {
    role: message.from_me ? 'human' : 'customer',
    content: content || '[mensagem sem texto]',
    timestamp: Number.isFinite(time) ? new Date(time).toISOString() : '',
    type: String(message.type || 'text').toLowerCase(),
  };
}

export function redactSalesReplayMessages(
  messages: RawSalesReplayMessage[],
  piiTokens: SalesReplayPiiToken[] = [],
): RedactedSalesReplayMessage[] {
  return messages.map((message) => redactSalesReplayMessage(message, piiTokens));
}

export function groupSalesReplayTurns(messages: RedactedSalesReplayMessage[]): SalesReplayTurn[] {
  const turns: SalesReplayTurn[] = [];
  let cursor = 0;

  while (cursor < messages.length) {
    while (messages[cursor]?.role === 'human') cursor += 1;
    if (cursor >= messages.length) break;

    const customerStart = cursor;
    while (messages[cursor]?.role === 'customer') cursor += 1;
    const customerEnd = cursor;
    while (messages[cursor]?.role === 'human') cursor += 1;

    turns.push({
      index: turns.length + 1,
      customer_messages: messages.slice(customerStart, customerEnd),
      human_messages: messages.slice(customerEnd, cursor),
      real_prefix: messages.slice(0, customerEnd),
    });
  }

  return turns;
}

function normalizeText(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function messageContent(messages: RedactedSalesReplayMessage[]): string {
  return messages.map((message) => message.content).join('\n');
}

function explicitHandoffReason(text: string): SalesReplayHandoffReason | undefined {
  const token = text.match(/###HUMANO(?::(fechamento|disponibilidade|pagamento|duvida|reclamacao|pessoa))?###/i);
  return token?.[1]?.toLowerCase() as SalesReplayHandoffReason | undefined;
}

function customerHandoffReason(text: string): SalesReplayHandoffReason | undefined {
  const normalized = normalizeText(text);
  if (/\b(?:pix|pagar|pagamento|sinal|desconto|negociar|condicao de pagamento|cartao|passar o valor|valor total)\b/.test(normalized)) return 'pagamento';
  if (/\b(?:quero.{0,24}(?:fechar|contratar|reservar)|vamos fechar|pode reservar)\b/.test(normalized)) return 'fechamento';
  const asksAvailability = /\b(?:consultar|ver|confirmar|agendar|marcar|tem|ha|consegue|pode).{0,35}(?:data|dia|horario|vaga|agenda)\b/.test(normalized);
  const namesAvailability = /\b(?:data|dia|horario|vaga|agenda).{0,35}(?:disponivel|livre|consultar|confirmar|reservar|tem)\b/.test(normalized);
  if (asksAvailability || namesAvailability) return 'disponibilidade';
  return undefined;
}

function responseSignalsUnknownHandoff(text: string): boolean {
  return /\b(?:vou|vamos).{0,24}(?:confirmar|verificar|checar).{0,30}(?:equipe|responsavel|fotograf|retorno)|vou chamar alguem/i.test(normalizeText(text));
}

function nicheFromText(text: string): string | undefined {
  const normalized = normalizeText(text);
  const match = normalized.match(/###PDF:([a-z_]+)###/i);
  if (match?.[1]) return match[1];
  const niches = ['gestante', 'newborn', 'aniversario', 'familia', 'infantil', 'casal', 'feminino', 'marca_pessoal'];
  return niches.find((niche) => normalized.includes(niche));
}

function humanSentQuote(text: string): boolean {
  const normalized = normalizeText(text);
  if (/###PDF:[a-z_]+###/i.test(text)) return true;
  if (/\[documento enviado pelo estudio\]/i.test(normalized)) return true;
  return /\b(?:vou te mandar|estou enviando|segue|te enviei|te mandei).{0,36}(?:pacotes?|orcamento|opcoes|valores?)\b/.test(normalized);
}

export function inferHumanReplayAction(
  humanMessages: RedactedSalesReplayMessage[],
  customerMessages: RedactedSalesReplayMessage[] = [],
): SalesReplayAction {
  const humanText = messageContent(humanMessages);
  const customerText = messageContent(customerMessages);
  const explicitReason = explicitHandoffReason(humanText);
  const customerReason = customerHandoffReason(customerText);
  if (explicitReason || customerReason) return { type: 'handoff', reason: explicitReason || customerReason };
  if (responseSignalsUnknownHandoff(humanText)) return { type: 'handoff', reason: 'duvida' };
  if (humanSentQuote(humanText)) return { type: 'orcamento', niche: nicheFromText(`${humanText}\n${customerText}`) };
  return { type: 'reply' };
}

export function inferAiReplayAction(aiReply: string): SalesReplayAction {
  const reason = explicitHandoffReason(aiReply);
  if (/###HUMANO(?::[a-z_]+)?###/i.test(aiReply)) return { type: 'handoff', reason };
  if (/###PDF:[a-z_]+###/i.test(aiReply)) return { type: 'orcamento', niche: nicheFromText(aiReply) };
  return { type: 'reply' };
}

export function inferCommercialQuestionTopic(value: string): CommercialQuestionTopic {
  const normalized = normalizeText(value);
  const topic = TOPIC_PATTERNS.find(([, pattern]) => pattern.test(normalized))?.[0];
  if (topic) return topic;
  return normalized.includes('?') ? 'other' : 'none';
}

function actionsMatch(expected: SalesReplayAction, actual: SalesReplayAction): boolean {
  if (expected.type !== actual.type) return false;
  if (expected.type === 'handoff' && expected.reason) return expected.reason === actual.reason;
  if (expected.type === 'orcamento' && expected.niche && actual.niche) return expected.niche === actual.niche;
  return true;
}

function nextStepsMatch(
  expectedAction: SalesReplayAction,
  expected: CommercialQuestionTopic,
  actual: CommercialQuestionTopic,
): boolean {
  if (expectedAction.type === 'handoff') return actual === 'none';
  if (expectedAction.type === 'orcamento') return actual === 'none' || actual === 'quote_sent';
  return expected === actual;
}

function questionCount(text: string): number {
  return (text.match(/\?/g) || []).length;
}

function patternMatches(pattern: RegExp, text: string): boolean {
  pattern.lastIndex = 0;
  return pattern.test(text);
}

function containsPii(text: string, tokens: SalesReplayPiiToken[]): boolean {
  const structured = tokens.some((token) => {
    const value = String(token.value || '').trim();
    return value.length >= 2 && normalizeText(text).includes(normalizeText(value));
  });
  if (structured) return true;
  return GENERIC_REDACTIONS
    .filter(({ replacement }) => replacement !== '[link]')
    .some(({ pattern }) => patternMatches(pattern, text));
}

function extractUrls(text: string): string[] {
  return text.match(/\b(?:https?:\/\/|www\.)[^\s<]+/giu) || [];
}

function normalizedUrl(url: string): string {
  return url.replace(/[),.;!?]+$/g, '').replace(/\/$/, '').toLowerCase();
}

function hasOnlyAllowedUrls(text: string, allowedUrls: string[]): boolean {
  const allowed = new Set(allowedUrls.map(normalizedUrl));
  return extractUrls(text).every((url) => allowed.has(normalizedUrl(url)));
}

function makeCheck(
  id: SalesReplayCheckId,
  label: string,
  passed: boolean,
  detail: string,
): SalesReplayCheck {
  return { id, label, passed, detail };
}

export function evaluateSalesReplayTurn(input: SalesReplayEvaluationInput): SalesReplayTurnEvaluation {
  const humanText = messageContent(input.turn.human_messages);
  const expectedAction = input.expected_action
    || inferHumanReplayAction(input.turn.human_messages, input.turn.customer_messages);
  const actualAction = inferAiReplayAction(input.ai_reply);
  const expectedStep = input.expected_next_step || inferCommercialQuestionTopic(humanText);
  const actualStep = inferCommercialQuestionTopic(input.ai_reply);
  const checks = [
    makeCheck('response_present', 'Gerou uma resposta', Boolean(input.ai_reply.trim()), 'A resposta não pode ficar vazia.'),
    makeCheck('action', 'Tomou a ação comercial correta', actionsMatch(expectedAction, actualAction), `${expectedAction.type} esperado; ${actualAction.type} gerado.`),
    makeCheck('next_step', 'Seguiu a próxima etapa do roteiro', nextStepsMatch(expectedAction, expectedStep, actualStep), `${expectedStep} esperado; ${actualStep} gerado.`),
    makeCheck('single_question', 'Fez no máximo uma pergunta', questionCount(input.ai_reply) <= 1, `${questionCount(input.ai_reply)} pergunta(s) detectada(s).`),
    makeCheck('no_pii', 'Não expôs dados pessoais', !containsPii(input.ai_reply, input.pii_tokens || []), 'Telefone, documento, e-mail, perfil e dados estruturados são bloqueados.'),
    makeCheck('safe_urls', 'Não inventou links', hasOnlyAllowedUrls(input.ai_reply, input.allowed_urls || []), 'Somente links previamente aprovados podem aparecer.'),
  ];

  return {
    passed: checks.every((check) => check.passed),
    expected_action: expectedAction,
    actual_action: actualAction,
    expected_next_step: expectedStep,
    actual_next_step: actualStep,
    checks,
  };
}

function emptyActionTotals(): SalesReplayActionTotals {
  return {
    reply: { total: 0, passed: 0 },
    orcamento: { total: 0, passed: 0 },
    handoff: { total: 0, passed: 0 },
  };
}

function percent(part: number, total: number): number {
  return total ? Math.round((part / total) * 100) : 0;
}

export function summarizeSalesReplayTotals(evaluations: SalesReplayTurnEvaluation[]): SalesReplayTotals {
  const byAction = emptyActionTotals();
  let checksPassed = 0;
  let checksTotal = 0;

  evaluations.forEach((evaluation) => {
    const action = byAction[evaluation.expected_action.type];
    action.total += 1;
    if (evaluation.passed) action.passed += 1;
    checksPassed += evaluation.checks.filter((check) => check.passed).length;
    checksTotal += evaluation.checks.length;
  });

  const passed = evaluations.filter((evaluation) => evaluation.passed).length;
  return {
    turns: evaluations.length,
    passed,
    failed: evaluations.length - passed,
    score: percent(passed, evaluations.length),
    checks_passed: checksPassed,
    checks_total: checksTotal,
    checks_score: percent(checksPassed, checksTotal),
    by_action: byAction,
  };
}

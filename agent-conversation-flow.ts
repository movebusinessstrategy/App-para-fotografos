import type { LearningMessage } from './agent-learning.js';

export type ConversationFlowStepId =
  | 'niche'
  | 'lifecycle'
  | 'creative_intent'
  | 'trust_asset'
  | 'schedule_preference'
  | 'quote_sent'
  | 'buying_signal';

export type ConversationFlowStep = {
  id: ConversationFlowStepId;
  label: string;
  kind: 'question' | 'portfolio' | 'budget' | 'handoff';
};

export type ConversationFlowState = {
  current_step: ConversationFlowStepId | null;
  next_step: ConversationFlowStepId | null;
  completed_steps: ConversationFlowStepId[];
  return_to_flow: boolean;
};

export type ConversationFlowAnalysis = {
  steps: ConversationFlowStep[];
  state: ConversationFlowState;
  instruction: string;
  niche: string | null;
  handoff_reason: FlowHandoffReason | null;
  move: ConversationFlowMove;
  fallback_reply: string;
};

export type ConversationFlowMove =
  | 'ask_niche'
  | 'ask_lifecycle'
  | 'ask_creative_intent'
  | 'ask_work_familiarity'
  | 'share_portfolio'
  | 'ask_portfolio_reaction'
  | 'clarify_portfolio_mismatch'
  | 'ask_schedule_preference'
  | 'send_quote'
  | 'handoff'
  | 'wait';

export type FlowHandoffReason =
  | 'fechamento'
  | 'disponibilidade'
  | 'pagamento'
  | 'duvida'
  | 'reclamacao'
  | 'pessoa';

export const AGENT_CHAT_MODEL = {
  provider: 'OpenAI',
  id: 'gpt-5.6-luna',
  label: 'GPT-5.6 Luna',
} as const;

const BASE_STEPS: ConversationFlowStep[] = [
  { id: 'niche', label: 'Entender qual ensaio', kind: 'question' },
  { id: 'creative_intent', label: 'Entender como imaginou o ensaio', kind: 'question' },
  { id: 'trust_asset', label: 'Referências ou trabalhos do estúdio', kind: 'portfolio' },
  { id: 'schedule_preference', label: 'Disponibilidade durante a semana', kind: 'question' },
  { id: 'quote_sent', label: 'Enviar os pacotes', kind: 'budget' },
  { id: 'buying_signal', label: 'Assumir quando quiser fechar ou ver data', kind: 'handoff' },
];

const LIFECYCLE_STEP: ConversationFlowStep = {
  id: 'lifecycle',
  label: 'Confirmar semanas ou dias do bebê',
  kind: 'question',
};

const NEW_EPISODE_GAP_MS = 30 * 24 * 60 * 60 * 1000;

const NICHE_PATTERNS: Array<[string, RegExp]> = [
  ['gestante', /\bgestante|gesta[cç][aã]o|gr[aá]vid[ao]|esperando (?:um |uma )?beb[eê]\b/i],
  ['newborn', /\bnewborn|rec[eé]m[- ]?nascid|beb[eê].{0,20}(?:ja nasceu|acabou de nascer|nascido)\b/i],
  ['smash_the_cake', /\bsmash(?: the cake)?\b/i],
  ['aniversario', /\banivers[aá]rio|festa\b/i],
  ['familia', /\b(?:ensaio|fotos?|sess[aã]o).{0,24}(?:de |em )?fam[ií]lia|ensaio familiar|fam[ií]lia.{0,18}(?:ensaio|fotos?|sess[aã]o)\b/i],
  ['infantil', /\bensaio.{0,18}infantil|fotos?.{0,18}(?:da|de uma?) crian[cç]a\b/i],
  ['casal', /\bcasal|namorad|noiv[ao]\b/i],
  ['feminino', /\bfeminino|retrato feminino\b/i],
  ['marca_pessoal', /\bmarca pessoal|ensaio (?:profissional|corporativ[ao])|fotos? corporativ[ao]s?\b/i],
  ['revelacao', /\brevela[cç][aã]o\b/i],
  ['batizado', /\bbatizad[ao]|batismo\b/i],
];

const NICHE_PRIORITY = new Map(NICHE_PATTERNS.map(([niche], index) => [niche, index]));

const MOVE_INSTRUCTIONS: Record<ConversationFlowMove, string> = {
  ask_niche: 'Descubra somente qual tipo de ensaio a pessoa procura.',
  ask_lifecycle: 'Se for gestante, pergunte: "Com quantas semanas você está?". Se for newborn, descubra primeiro se o bebê já nasceu; se nasceu, pergunte quantos dias ele tem.',
  ask_creative_intent: 'Reconheça a fase da gestação ou do bebê em uma frase curta e então pergunte: "Me conta mais de como você tinha pensado em registrar esse momento de vocês?". Em outro balão, convide: "Caso tenha algumas referências, pode me mandar aqui 🤍".',
  ask_work_familiarity: 'Reconheça de verdade o estilo ou a ideia que ela contou e pergunte: "E você já conhece um pouco do nosso trabalho? Chegou a dar uma olhada em algumas de nossas fotos?". Não faça esta pergunta se ela já disse que conhece, veio pelo Instagram ou mandou um trabalho do próprio estúdio.',
  share_portfolio: 'Ela ainda não conhece o trabalho. Diga que vai mostrar alguns ensaios, envie somente o portfólio aprovado do nicho e termine perguntando o que ela achou. Nunca invente URL nem diga que enviou fotos se nenhum material aprovado estiver disponível.',
  ask_portfolio_reaction: 'Os trabalhos do estúdio já foram apresentados. Pergunte somente o que ela achou, sem repetir a qualificação.',
  clarify_portfolio_mismatch: 'A pessoa disse que o trabalho apresentado não ficou alinhado. Acolha sem pressionar e pergunte somente o que ela gostaria que fosse diferente. Não avance para agenda nem orçamento.',
  ask_schedule_preference: 'Faça uma transição curta e pergunte: "E para vocês é tranquilo fazer as fotos de meio de semana?". Se ela acabou de gostar do portfólio, comece com "Que bom que gostou". Não consulte agenda ainda.',
  send_quote: 'Acolha a preferência de agenda. Diga que vai mandar os pacotes, peça para ela contar qual gostou mais e combine que depois vocês veem uma data. Em seguida use o token do PDF correto. Se ela só puder sábado, explique com naturalidade que o estúdio atende aos sábados e que eles são bem concorridos; isso ainda NÃO é consulta de disponibilidade.',
  handoff: 'Há sinal claro de compra, pedido para fechar, pagar ou consultar uma data. Faça o hand-off silencioso correto agora, sem novas perguntas.',
  wait: 'Não abra uma nova etapa agora. Se a pessoa prometeu mandar referência, confirme que pode enviar e aguarde a mídia. Se o orçamento já foi enviado, responda somente dúvidas seguras e aguarde a escolha; não reinicie o roteiro.',
};

function normalizedMessages(messages: LearningMessage[], role: LearningMessage['role']): string {
  return messages
    .filter((message) => message.role === role)
    .map((message) => message.content.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase())
    .join('\n');
}

function lastPatternIndex(text: string, pattern: RegExp): number {
  const matches = [...text.matchAll(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`))];
  return matches.at(-1)?.index ?? -1;
}

function detectedNiche(customerText: string): string | null {
  const ranked = NICHE_PATTERNS
    .map(([niche, pattern]) => ({ niche, index: lastPatternIndex(customerText, pattern) }))
    .filter((item) => item.index >= 0)
    .sort((a, b) => a.index - b.index
      || (NICHE_PRIORITY.get(a.niche) || 0) - (NICHE_PRIORITY.get(b.niche) || 0));
  return ranked[0]?.niche || null;
}

function normalizedKnownNiche(value: string | null | undefined): string | null {
  const normalized = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
  if (!normalized || normalized === 'outro' || normalized === 'outros') return null;
  return normalized;
}

function recentConversationEpisode(messages: LearningMessage[]): LearningMessage[] {
  let start = 0;
  for (let index = 1; index < messages.length; index += 1) {
    const previous = Date.parse(messages[index - 1].timestamp || '');
    const current = Date.parse(messages[index].timestamp || '');
    if (Number.isFinite(previous) && Number.isFinite(current) && current - previous >= NEW_EPISODE_GAP_MS) {
      start = index;
    }
  }
  return messages.slice(start);
}

function lifecycleKnown(niche: string | null, customerText: string): boolean {
  if (niche === 'gestante') return /\b\d{1,2}\s*(?:semanas?|mes(?:es)?)\b/.test(customerText);
  if (niche !== 'newborn') return true;
  if (/\b\d{1,3}\s*dias?\b|ainda nao nasceu|nao nasceu ainda|vai nascer/.test(customerText)) return true;
  return false;
}

function gestationalWeeks(customerText: string): number | null {
  const weekMatches = [...customerText.matchAll(/\b(\d{1,2})\s*semanas?\b/g)];
  const weeks = Number(weekMatches.at(-1)?.[1]);
  if (Number.isFinite(weeks) && weeks > 0 && weeks <= 45) return weeks;
  const monthMatches = [...customerText.matchAll(/\b(\d{1,2})\s*mes(?:es)?\b/g)];
  const months = Number(monthMatches.at(-1)?.[1]);
  const value = Math.round(months * 4.345);
  return Number.isFinite(value) && value > 0 && value <= 45 ? value : null;
}

function lifecycleAcknowledgement(niche: string | null, customerText: string): string {
  if (niche === 'newborn') {
    if (/ainda nao nasceu|nao nasceu ainda|vai nascer/.test(customerText)) {
      return 'O bebê ainda não nasceu';
    }
    const days = Number(customerText.match(/\b(\d{1,3})\s*dias?\b/)?.[1]);
    return Number.isFinite(days)
      ? `O bebê está com ${days} dias`
      : '';
  }
  const weeks = gestationalWeeks(customerText);
  if (weeks === null) return '';
  if (weeks <= 12) return 'Está bem no início da gestação';
  if (weeks <= 21) return 'Já está na metade da gestação';
  if (weeks <= 27) return 'Já passou um pouquinho da metade da gestação';
  return 'Já está indo para a reta final da gestação';
}

function creativeIntentKnown(customerText: string): boolean {
  return /\b(?:referenc|inspir|pensei (?:em|num|que)|imaginei|como (?:eu )?queria|queria (?:algo|fotos?|um ensaio) (?:mais )?(?:natural|classico|externo|(?:no|de) estudio)|registrar (?:esse|este|o) momento|estilo|natural|classico|externo|(?:no|de) estudio|fotos? (?:de|no) estudio|nao tenho (?:uma )?ideia|sem referenc)|\[(?:foto|imagem)/.test(customerText);
}

type WorkFamiliarity = 'known' | 'unknown' | 'not_asked';

function normalizedMessage(message: LearningMessage): string {
  return message.content.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function customerReplyAfterAssistantQuestion(messages: LearningMessage[], pattern: RegExp): string {
  let questionIndex = -1;
  messages.forEach((message, index) => {
    if (message.role === 'assistant' && pattern.test(normalizedMessage(message))) questionIndex = index;
  });
  if (questionIndex < 0) return '';
  const answer: LearningMessage[] = [];
  for (const message of messages.slice(questionIndex + 1)) {
    if (message.role === 'assistant') break;
    if (message.role === 'user') answer.push(message);
  }
  return answer
    .map(normalizedMessage)
    .join('\n');
}

function bareNumber(value: string, maximum: number): number | null {
  const match = value.trim().match(/^(?:estou com |ele (?:esta|ta) com |ela (?:esta|ta) com )?(\d{1,3})[.!]?$/);
  const parsed = Number(match?.[1]);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= maximum ? parsed : null;
}

function lifecycleContextText(
  messages: LearningMessage[],
  niche: string | null,
  customerText: string,
): string {
  if (niche === 'gestante' && !/\b\d{1,2}\s*(?:semanas?|mes(?:es)?)\b/.test(customerText)) {
    const reply = customerReplyAfterAssistantQuestion(messages, /quantas?.{0,16}semanas?/);
    const weeks = bareNumber(reply, 45);
    return weeks === null ? customerText : `${customerText}\n${weeks} semanas`;
  }
  if (niche !== 'newborn') return customerText;
  const ageReply = customerReplyAfterAssistantQuestion(messages, /quantos?.{0,16}dias?/);
  const days = bareNumber(ageReply, 180);
  if (days !== null) return `${customerText}\n${days} dias`;
  const birthReply = customerReplyAfterAssistantQuestion(messages, /(?:beb[eê].{0,18}ja nasceu|ja nasceu|nasceu[?])/);
  if (/\b(?:nao|ainda nao)\b/.test(birthReply)) return `${customerText}\nainda nao nasceu`;
  if (/\b(?:sim|ja|nasceu)\b/.test(birthReply)) return `${customerText}\nja nasceu`;
  return customerText;
}

function workFamiliarity(messages: LearningMessage[], customerText: string): WorkFamiliarity {
  const explicitNo = /\b(?:nao|nunca|ainda nao).{0,18}(?:conheco|vi|acompanho).{0,30}(?:trabalho|voces|fotos)?\b/.test(customerText);
  if (explicitNo) return 'unknown';
  const explicitYes = /\b(?:ja conheco|conheco (?:o )?trabalho|vi.{0,40}instagram|vim.{0,20}instagram|acompanho|ja vi.{0,30}(?:fotos|trabalho))\b/.test(customerText);
  if (explicitYes) return 'known';
  const contextualReply = customerReplyAfterAssistantQuestion(messages, /conhece.{0,30}(?:trabalho|fotos)|dar uma olhada.{0,30}fotos|nosso trabalho/);
  if (/\b(?:nao|nunca|ainda nao)\b/.test(contextualReply)) return 'unknown';
  if (/\b(?:sim|ja|conheco|instagram|acompanho|vi)\b/.test(contextualReply)) return 'known';
  return 'not_asked';
}

function customerSentReference(messages: LearningMessage[]): boolean {
  let referenceWasInvited = false;
  for (const message of messages) {
    const text = normalizedMessage(message);
    if (message.role === 'assistant' && /referenc|como.{0,50}(?:pens|imagin|registr)/.test(text)) {
      referenceWasInvited = true;
      continue;
    }
    if (message.role !== 'user') continue;
    const hasImage = /\[(?:foto|imagem)[^\]]*\]/.test(text);
    const explicitlyReference = /\b(?:referenc|inspir|esse estilo|essa foto).{0,40}\b/.test(text);
    if (hasImage && (referenceWasInvited || explicitlyReference)) return true;
  }
  return false;
}

function customerPromisedReference(customerText: string, referenceReceived = false): boolean {
  const sendBefore = /\b(?:vou mandar|vou enviar|ja mando|posso mandar|mando agora|envio agora).{0,28}referenc/.test(customerText);
  const referenceBefore = /\breferenc.{0,28}(?:vou mandar|vou enviar|ja mando|posso mandar|mando agora|envio agora)\b/.test(customerText);
  return (sendBefore || referenceBefore) && !referenceReceived;
}

function portfolioSent(assistantText: string): boolean {
  const material = /https?:\/\/|www\.|instagram\.com|\[(?:foto|imagem)[^\]]*\]/.test(assistantText);
  const confirmedSend = /(?:ja te mandei|acabei de (?:mandar|enviar)|enviei).{0,36}(?:foto|ensaio|trabalho|referenc)/.test(assistantText);
  return material || confirmedSend;
}

type PortfolioReaction = 'liked' | 'disliked' | 'clarified' | 'unknown';

function portfolioReaction(messages: LearningMessage[]): PortfolioReaction {
  const clarification = customerReplyAfterAssistantQuestion(
    messages,
    /o que.{0,40}(?:diferente|mudaria|buscando)|como.{0,30}(?:imaginou|gostaria)|gostaria.{0,20}diferente/,
  );
  if (clarification.trim().length >= 3) return 'clarified';
  const reply = customerReplyAfterAssistantQuestion(messages, /o que (?:voce )?achou|me diz o que achou|gostou/);
  if (/\b(?:nao gostei|nao curti|nao ficou|nao e|diferente do que|nao alinh)/.test(reply)) return 'disliked';
  if (/\b(?:gostei|amei|lind|perfeit|esse estilo|alinhad|sim|adorei)\b/.test(reply)) return 'liked';
  return 'unknown';
}

function scheduleKnown(messages: LearningMessage[], customerText: string): boolean {
  const explicitPreference = /\b(?:meio de semana|durante a semana|dia de semana|so posso.{0,18}(?:segunda|terca|quarta|quinta|sexta|sabado|fim de semana)|pode ser.{0,12}(?:segunda|terca|quarta|quinta|sexta|sabado)|tenho disponibilidade|nao tenho disponibilidade|consigo.{0,18}(?:segunda|terca|quarta|quinta|sexta|sabado|semana)|nao consigo.{0,18}(?:semana|segunda|terca|quarta|quinta|sexta))\b/.test(customerText);
  if (explicitPreference) {
    return true;
  }
  const reply = customerReplyAfterAssistantQuestion(
    messages,
    /(?:meio de semana|durante a semana|dia de semana|segunda|terca|quarta|quinta|sexta)/,
  );
  return /\b(?:sim|tranquil|consigo|podemos|pode ser|sem problema|nao consigo|nao da|so fim de semana)\b/.test(reply);
}

function quoteWasSent(customerText: string, assistantText: string): boolean {
  const customerDeniedQuote = /\b(?:nao|nunca|ainda nao).{0,24}(?:recebi|vi|chegou).{0,28}(?:orcamento|pacote|opco)|(?:orcamento|pacote).{0,24}(?:nao chegou|nao recebi)\b/.test(customerText);
  if (customerDeniedQuote) return false;
  const customerSawQuote = /\b(?:ja vi|recebi|olhei|gostei).{0,35}(?:orcamento|pacote|opco)|(?:orcamento|pacote).{0,20}(?:recebi|enviado)\b/.test(customerText);
  const assistantSentQuote = /###pdf:[a-z_]+###|te mandei.{0,30}(?:pacote|orcamento|opco)|\[(?:documento|arquivo) enviado pelo estudio\].{0,100}(?:gestante|newborn|smash|familia|aniversario|marca pessoal|pacote|orcamento)/.test(assistantText);
  return customerSawQuote || assistantSentQuote;
}

function asksForPayment(text: string): boolean {
  return /\b(?:pix|pagar|pagamento|sinal|desconto|negociar|condi[cç][aã]o|cart[aã]o|passar o valor|valor total)\b/.test(text);
}

function asksToClose(text: string): boolean {
  return /\b(?:quero.{0,24}(?:fechar|contratar|reservar|agendar|marcar)|vamos fechar|pode reservar)\b/.test(text);
}

function asksToCheckAvailability(text: string): boolean {
  const actionFirst = /\b(?:consultar|ver|verificar|confirmar|agendar|marcar|reservar|consegue).{0,36}(?:data|dia|horario|vaga|agenda|sabado|segunda|terca|quarta|quinta|sexta)\b/.test(text);
  const canCheck = /\bpode.{0,12}(?:consultar|ver|verificar|confirmar|agendar|marcar|reservar).{0,30}(?:data|dia|horario|vaga|agenda|sabado|segunda|terca|quarta|quinta|sexta)\b/.test(text);
  const hasAvailability = /\b(?:tem|ha).{0,24}(?:data|horario|vaga|agenda|sabado|segunda|terca|quarta|quinta|sexta).{0,16}(?:disponivel|livre|abert[ao])?\b/.test(text);
  const dateFirst = /\b(?:data|dia|horario|vaga|agenda).{0,36}(?:disponivel|livre|consultar|confirmar|reservar|consegue|tem)\b/.test(text);
  const namedDay = /\b(?:sabado|segunda|terca|quarta|quinta|sexta).{0,20}(?:disponivel|livre|tem vaga)\b/.test(text);
  return actionFirst || canCheck || hasAvailability || dateFirst || namedDay;
}

function asksForPerson(text: string): boolean {
  return /\b(?:falar|conversar).{0,24}(?:com )?(?:uma pessoa|alguem|atendente|humano)|\bquero (?:uma pessoa|atendente|atendimento humano)\b/.test(text);
}

function isComplaint(text: string): boolean {
  const explicit = /\b(?:reclamacao|quero reclamar|estou insatisfeit|muito chatead|pessimo atendimento|absurdo)\b/.test(text);
  const incident = /\b(?:problema|erro|atraso|nao recebi|nao entregaram|deu errado).{0,36}(?:ensaio|foto|pagamento|atendimento|entrega|pedido)\b/.test(text);
  return explicit || incident;
}

function asksUnknownRequirement(text: string): boolean {
  const missingFromMaterial = /\b(?:nao|nunca).{0,20}(?:apareceu|consta|achei|vi).{0,32}(?:material|orcamento|pacote|informacao)\b/.test(text);
  const specificRequirement = /\b(?:exigencia|pedido|necessidade|situacao).{0,18}especific/.test(text);
  const asksCanDo = /\b(?:conseguem|podem|fazem|atendem|seria possivel|e possivel)\b/.test(text);
  return asksCanDo && (missingFromMaterial || specificRequirement);
}

function deterministicHandoffReason(lastCustomerText: string): FlowHandoffReason | null {
  if (asksForPerson(lastCustomerText)) return 'pessoa';
  if (isComplaint(lastCustomerText)) return 'reclamacao';
  if (asksForPayment(lastCustomerText)) return 'pagamento';
  if (asksToCheckAvailability(lastCustomerText)) return 'disponibilidade';
  if (asksToClose(lastCustomerText)) return 'fechamento';
  if (asksUnknownRequirement(lastCustomerText)) return 'duvida';
  return null;
}

function requestedShortcut(lastCustomerMessage: string): boolean {
  return /\b(?:preco|valor|orcamento|pacote|op(?:cao|coes)|data|agenda|disponibilidade|quanto custa|quanto fica)\b/.test(lastCustomerMessage);
}

function referenceFromStudioKnown(customerText: string): boolean {
  return /\b(?:referencia|foto|imagem).{0,30}(?:de voces|do estudio|do instagram de voces)|(?:peguei|salvei).{0,30}(?:instagram|perfil).{0,16}(?:de voces|do estudio)/.test(customerText);
}

function newbornBornWithoutAge(customerText: string): boolean {
  const born = /\b(?:ja nasceu|nasceu sim|ele nasceu|ela nasceu|beb[eê] nasceu|acabou de nascer|recem nasceu)\b/.test(customerText);
  return born && !/\b\d{1,3}\s*dias?\b/.test(customerText);
}

type FlowSignals = {
  niche: string | null;
  lifecycle: boolean;
  creativeIntent: boolean;
  familiarity: WorkFamiliarity;
  referenceReceived: boolean;
  referencePromised: boolean;
  portfolioWasSent: boolean;
  reaction: PortfolioReaction;
  schedule: boolean;
  quoteSent: boolean;
  handoffReason: FlowHandoffReason | null;
};

function trustCompleted(signals: FlowSignals): boolean {
  if (signals.familiarity === 'known') return true;
  return signals.familiarity === 'unknown'
    && signals.portfolioWasSent
    && (signals.reaction === 'liked' || signals.reaction === 'clarified');
}

function nextConversationMove(signals: FlowSignals): ConversationFlowMove {
  if (signals.handoffReason) return 'handoff';
  if (!signals.niche) return 'ask_niche';
  if (!signals.lifecycle) return 'ask_lifecycle';
  if (!signals.creativeIntent) return 'ask_creative_intent';
  if (signals.referencePromised && !signals.referenceReceived) return 'wait';
  if (signals.familiarity === 'not_asked') return 'ask_work_familiarity';
  if (signals.familiarity === 'unknown' && !signals.portfolioWasSent) return 'share_portfolio';
  if (signals.reaction === 'disliked') return 'clarify_portfolio_mismatch';
  if (signals.familiarity === 'unknown' && signals.reaction === 'unknown') return 'ask_portfolio_reaction';
  if (!signals.schedule) return 'ask_schedule_preference';
  if (!signals.quoteSent) return 'send_quote';
  return 'wait';
}

const MOVE_STEP: Record<ConversationFlowMove, ConversationFlowStepId | null> = {
  ask_niche: 'niche',
  ask_lifecycle: 'lifecycle',
  ask_creative_intent: 'creative_intent',
  ask_work_familiarity: 'trust_asset',
  share_portfolio: 'trust_asset',
  ask_portfolio_reaction: 'trust_asset',
  clarify_portfolio_mismatch: 'trust_asset',
  ask_schedule_preference: 'schedule_preference',
  send_quote: 'quote_sent',
  handoff: 'buying_signal',
  wait: null,
};

export function normalizeConversationFlowMessages(value: unknown): LearningMessage[] {
  if (!Array.isArray(value)) return [];
  return value.slice(-160).flatMap((message): LearningMessage[] => {
    const role = message?.role === 'assistant' ? 'assistant' : message?.role === 'user' ? 'user' : null;
    const content = String(message?.content || '').trim();
    const timestamp = typeof message?.timestamp === 'string' ? message.timestamp : undefined;
    return role && content ? [{ role, content: content.slice(0, 4000), timestamp }] : [];
  });
}

function relevantSteps(niche: string | null): ConversationFlowStep[] {
  if (niche !== 'gestante' && niche !== 'newborn') return BASE_STEPS.map((step) => ({ ...step }));
  return [BASE_STEPS[0], LIFECYCLE_STEP, ...BASE_STEPS.slice(1)].map((step) => ({ ...step }));
}

function completedStepIds(
  steps: ConversationFlowStep[],
  facts: Record<ConversationFlowStepId, boolean>,
): ConversationFlowStepId[] {
  return steps.filter((step) => facts[step.id]).map((step) => step.id);
}

function nextPendingSteps(
  steps: ConversationFlowStep[],
  completed: ConversationFlowStepId[],
): ConversationFlowStepId[] {
  const done = new Set(completed);
  return steps.map((step) => step.id).filter((id) => !done.has(id));
}

function instructionFor(
  move: ConversationFlowMove,
  completed: ConversationFlowStepId[],
  lifecycleNote: string,
): string {
  const recognition = move === 'ask_creative_intent' && lifecycleNote
    ? ` Reconhecimento obrigatório antes da pergunta: ${lifecycleNote}`
    : '';
  return [
    'CONDUÇÃO CANÔNICA E VALIDADA DO ESTÚDIO — esta direção tem prioridade sobre qualquer roteiro antigo salvo na configuração:',
    `Etapas já informadas e que NÃO podem ser repetidas: ${completed.length ? completed.join(', ') : 'nenhuma'}.`,
    `MOVIMENTO OBRIGATÓRIO DESTA RESPOSTA: ${move}. ${MOVE_INSTRUCTIONS[move]}${recognition}`,
    'Não pule para uma etapa posterior, mesmo que a pessoa peça preço cedo. Aproveite tudo o que ela já informou e faça somente o movimento indicado.',
    'Acolha brevemente qualquer desvio e retome esta única etapa com naturalidade. Não transforme a conversa em interrogatório: no máximo uma pergunta comercial por resposta.',
    'Varie a redação e o tamanho de modo humano, mantendo o jeito do histórico; nunca use texto aleatório, nunca invente escassez, disponibilidade, preço, link ou informação.',
    'Os gatilhos de hand-off silencioso continuam tendo prioridade sobre a condução comercial.',
    'IMPORTANTE: informar uma preferência, como "só posso sábado", NÃO é pedir consulta de data. Só use hand-off de disponibilidade se a pessoa pedir explicitamente para consultar, confirmar, reservar ou agendar data/horário/vaga.',
  ].join('\n');
}

// "Olá, tudo bem?" na abertura é cumprimento, não pergunta comercial: fica
// como está (é o script validado do estúdio) e não entra na contagem.
const OPENING_GREETING = /^(?:ol[aá]|oi+|bom dia|boa tarde|boa noite)[,!]?\s+tudo bem\?/i;

export function enforceSingleQuestion(reply: unknown): string {
  const text = String(reply || '').trim();
  const greeting = text.match(OPENING_GREETING);
  const start = greeting ? greeting[0].length : 0;
  const firstQuestion = text.indexOf('?', start);
  if (firstQuestion < 0 || text.indexOf('?', firstQuestion + 1) < 0) return text;
  return text.slice(0, firstQuestion + 1).trim();
}

function stripForcedOpeningPraise(reply: unknown): string {
  const text = String(reply || '').trim();
  const cleaned = text.replace(
    /^(?:a+h?\s+)?que (?:fase|momento) (?:lind[oa]|especial|boa|delicios[oa])(?: da gravidez)?[!,.]?\s*(?:🥰|❤️|😊|☺️)?\s*/i,
    '',
  ).trim();
  if (!cleaned || cleaned === text) return text;
  return cleaned.charAt(0).toLocaleUpperCase('pt-BR') + cleaned.slice(1);
}

export function enforceConversationFlowReply(reply: unknown, flow: ConversationFlowAnalysis): string {
  const text = enforceSingleQuestion(stripForcedOpeningPraise(reply));
  if (flow.handoff_reason) return `###HUMANO:${flow.handoff_reason}###`;
  const handoffMatch = text.match(/###HUMANO(?::([a-z_]+))?###/i);
  const handoff = handoffMatch?.[1]?.toLowerCase();
  if (handoffMatch && !handoff) return '###HUMANO:duvida###';
  if (handoff === 'duvida' || handoff === 'pessoa' || handoff === 'reclamacao') return text;
  if (handoff || flow.move === 'send_quote' || !text) return flow.fallback_reply;
  return replyMatchesMove(text, flow) ? text : flow.fallback_reply;
}

function replyMatchesMove(reply: string, flow: ConversationFlowAnalysis): boolean {
  const normalized = reply.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (flow.move !== 'send_quote' && /###pdf:[a-z_]+###/i.test(reply)) return false;
  const patterns: Partial<Record<ConversationFlowMove, RegExp>> = {
    ask_niche: /\b(?:qual|que|tipo).{0,30}(?:ensaio|fotos?|sessao).*[?]/,
    ask_creative_intent: /\b(?:como|me conta).{0,70}(?:pens|imagin|registr|momento).*[?]/,
    ask_work_familiarity: /\b(?:conhece|conhecia|viu|olhada).{0,50}(?:trabalho|fotos?|ensaio).*[?]/,
    ask_portfolio_reaction: /\b(?:o que achou|gostou|achou das).*[?]/,
    clarify_portfolio_mismatch: /\b(?:o que|como).{0,50}(?:diferente|mudaria|buscando|imaginou|gostaria).*[?]/,
    ask_schedule_preference: /\b(?:meio de semana|durante a semana|dia de semana|segunda|terca|quarta|quinta|sexta).*[?]/,
  };
  if (flow.move === 'ask_lifecycle') return lifecycleReplyMatches(normalized, flow);
  if (flow.move === 'share_portfolio' || flow.move === 'wait') return true;
  const expected = patterns[flow.move];
  return expected ? expected.test(normalized) : true;
}

function lifecycleReplyMatches(reply: string, flow: ConversationFlowAnalysis): boolean {
  if (flow.niche === 'gestante') return /quantas?.{0,14}semanas?.*[?]/.test(reply);
  const fallback = flow.fallback_reply.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (/quantos?.{0,14}dias?.*[?]/.test(fallback)) return /quantos?.{0,14}dias?.*[?]/.test(reply);
  return /(?:ja nasceu|bebe.{0,18}nasceu).*[?]/.test(reply);
}

function quoteFallback(niche: string | null, lastCustomer: string): string {
  if (!niche) return 'Qual tipo de ensaio você gostaria?';
  const token = `###PDF:${niche}###`;
  if (/\b(?:sabado|fim de semana|final de semana)\b/.test(lastCustomer)) {
    return `A gente trabalha aos sábados sim 😊 Como eles são bem concorridos, vou te mandar os nossos pacotes por aqui. Você me diz qual gostou mais e depois a gente vê uma data para vocês, pode ser?\n\n${token}`;
  }
  return `Perfeito 😊 Vou te mandar os nossos pacotes por aqui. Você me diz qual gostou mais e depois a gente vê uma data para vocês, pode ser?\n\n${token}`;
}

function creativeIntentFallback(niche: string | null, customerText: string): string {
  const recognition = lifecycleAcknowledgement(niche, customerText);
  const prefix = recognition ? `${recognition} 😊\n\n` : '';
  return `${prefix}Me conta mais de como você tinha pensado em registrar esse momento de vocês?\n\nCaso tenha algumas referências, pode me mandar aqui 🤍`;
}

function fallbackForMove(
  move: ConversationFlowMove,
  niche: string | null,
  customerText: string,
  lastCustomer: string,
  handoffReason: FlowHandoffReason | null,
): string {
  if (move === 'handoff') return `###HUMANO:${handoffReason || 'duvida'}###`;
  if (move === 'ask_niche') return 'Qual tipo de ensaio você gostaria?';
  if (move === 'ask_lifecycle' && niche === 'gestante') return 'Com quantas semanas você está?';
  if (move === 'ask_lifecycle' && newbornBornWithoutAge(customerText)) return 'E quantos dias o bebê tem?';
  if (move === 'ask_lifecycle') return 'O bebê já nasceu?';
  if (move === 'ask_creative_intent') return creativeIntentFallback(niche, customerText);
  if (move === 'ask_work_familiarity') {
    return 'Ahh, entendi a ideia 🤍\n\nE você já conhece um pouco do nosso trabalho, chegou a dar uma olhada em algumas das nossas fotos?';
  }
  if (move === 'ask_portfolio_reaction') return 'O que você achou? 🥰';
  if (move === 'clarify_portfolio_mismatch') return 'Entendi. O que você gostaria que fosse diferente?';
  if (move === 'ask_schedule_preference') return 'E para vocês é tranquilo fazer as fotos de meio de semana?';
  if (move === 'send_quote') return quoteFallback(niche, lastCustomer);
  if (move === 'wait' && customerPromisedReference(customerText)) return 'Combinado, pode mandar por aqui 🤍';
  return '';
}

export function analyzeConversationFlow(
  messages: LearningMessage[],
  knownNiche?: string | null,
): ConversationFlowAnalysis {
  const episode = recentConversationEpisode(messages);
  const customerText = normalizedMessages(episode, 'user');
  const assistantText = normalizedMessages(episode, 'assistant');
  const lastCustomer = [...episode].reverse().find((message) => message.role === 'user')?.content || '';
  const lastNormalized = lastCustomer.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const niche = detectedNiche(customerText)
    || normalizedKnownNiche(knownNiche)
    || detectedNiche(assistantText);
  const lifecycleText = lifecycleContextText(episode, niche, customerText);
  const handoffReason = deterministicHandoffReason(lastNormalized);
  const steps = relevantSteps(niche);
  const quoteSent = quoteWasSent(customerText, assistantText);
  const baseFamiliarity = workFamiliarity(episode, customerText);
  const familiarity = baseFamiliarity === 'not_asked' && referenceFromStudioKnown(customerText)
    ? 'known'
    : baseFamiliarity;
  const referenceReceived = customerSentReference(episode);
  const signals: FlowSignals = {
    niche,
    lifecycle: lifecycleKnown(niche, lifecycleText),
    creativeIntent: creativeIntentKnown(customerText),
    familiarity,
    referenceReceived,
    referencePromised: customerPromisedReference(customerText, referenceReceived),
    portfolioWasSent: portfolioSent(assistantText),
    reaction: portfolioReaction(episode),
    schedule: scheduleKnown(episode, customerText),
    quoteSent,
    handoffReason,
  };
  const facts: Record<ConversationFlowStepId, boolean> = {
    niche: Boolean(niche),
    lifecycle: signals.lifecycle,
    creative_intent: signals.creativeIntent,
    trust_asset: trustCompleted(signals),
    schedule_preference: signals.schedule,
    quote_sent: quoteSent,
    buying_signal: Boolean(handoffReason),
  };
  if (quoteSent) {
    facts.lifecycle = true;
    facts.creative_intent = true;
    facts.trust_asset = true;
    facts.schedule_preference = true;
  }
  const move = nextConversationMove({
    ...signals,
    lifecycle: facts.lifecycle,
    creativeIntent: facts.creative_intent,
    schedule: facts.schedule_preference,
  });
  const completed = completedStepIds(steps, facts);
  const awaitingReference = move === 'wait' && signals.referencePromised && !signals.referenceReceived;
  const current: ConversationFlowStepId | null = awaitingReference ? 'trust_asset' : MOVE_STEP[move];
  const currentIndex = steps.findIndex((step) => step.id === current);
  const afterCurrent = steps.slice(currentIndex + 1)
    .find((step) => step.id !== 'buying_signal' && !completed.includes(step.id));
  const state: ConversationFlowState = {
    current_step: current,
    next_step: move === 'handoff' ? null : afterCurrent?.id || null,
    completed_steps: completed.filter((id) => id !== current),
    return_to_flow: Boolean(move !== 'handoff' && current && requestedShortcut(lastNormalized) && current !== 'quote_sent'),
  };
  const lifecycleNote = lifecycleAcknowledgement(niche, lifecycleText);
  return {
    steps,
    state,
    instruction: instructionFor(move, state.completed_steps, lifecycleNote),
    niche,
    handoff_reason: handoffReason,
    move,
    fallback_reply: fallbackForMove(move, niche, lifecycleText, lastNormalized, handoffReason),
  };
}

export function conversationFlowSteps(messages: LearningMessage[]): ConversationFlowStep[] {
  return analyzeConversationFlow(messages).steps;
}

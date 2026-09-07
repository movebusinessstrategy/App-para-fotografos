import { parseAgentHandoff } from './agent-autonomy.js';
import {
  conversationFlowSteps,
  type ConversationFlowAnalysis,
  type ConversationFlowStep,
} from './agent-conversation-flow.js';

export type LearningCaseStatus = 'pending' | 'approved' | 'corrected' | 'rejected';
export type LearningDecision = 'approve' | 'correct' | 'reject';
export type LearningAction = {
  type: 'reply' | 'handoff' | 'orcamento';
  reason?: string;
  nicho?: string;
};

export interface LearningMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: string;
}

export interface LearningCase {
  id: string;
  category: string;
  messages: LearningMessage[];
  expected_action: LearningAction;
  flow_steps?: ConversationFlowStep[];
  source: {
    strict_sales: 91;
    useful_episodes: 73;
    lab_cases: 13;
    real_episode_basis: true;
  };
  status?: LearningCaseStatus;
  created_at?: string;
  updated_at?: string;
  latest_simulation?: unknown;
}

export interface LearningRule {
  id: string;
  rule_text: string;
  category: string;
  active: boolean;
  approval_count: number;
  created_at?: string;
  updated_at?: string;
}

export interface LearningExample {
  case_id: string;
  category: string;
  customer_message: string;
  ideal_reply: string;
  decision: 'approve' | 'correct';
}

export interface EvaluationCheck {
  label: string;
  passed: boolean;
  detail?: string;
}

export interface LearningEvaluation {
  passed: boolean;
  expected_action: LearningAction | null;
  actual_action: LearningAction | null;
  checks: EvaluationCheck[];
}

const SOURCE = {
  strict_sales: 91,
  useful_episodes: 73,
  lab_cases: 13,
  real_episode_basis: true,
} as const;

export const SUPERVISED_LAB_CASES: LearningCase[] = [
  {
    id: 'paid_win_01_gestante_preco',
    category: 'gestante',
    messages: [
      { role: 'user', content: 'Estou esperando um bebê e queria conhecer os pacotes do ensaio de gestante.' },
      { role: 'assistant', content: 'Claro! Você já sabe com quantas semanas pretende fazer o ensaio?' },
      { role: 'user', content: 'Sim, já estou na fase indicada. Pode me mandar as opções e valores?' },
    ],
    expected_action: { type: 'reply' },
    source: SOURCE,
  },
  {
    id: 'paid_win_02_newborn_orcamento',
    category: 'newborn',
    messages: [
      { role: 'user', content: 'Quero informações sobre o ensaio newborn. O bebê acabou de nascer.' },
      { role: 'assistant', content: 'Vocês gostariam de participar das fotos com o bebê?' },
      { role: 'user', content: 'Sim. Pode enviar o orçamento para eu ver os pacotes?' },
    ],
    expected_action: { type: 'reply' },
    source: SOURCE,
  },
  {
    id: 'paid_win_03_aniversario_avancar',
    category: 'aniversario',
    messages: [
      { role: 'user', content: 'Já vi o orçamento das fotos de aniversário e gostei de uma das opções.' },
      { role: 'user', content: 'Quero avançar e contratar.' },
    ],
    expected_action: { type: 'handoff', reason: 'fechamento' },
    source: SOURCE,
  },
  {
    id: 'paid_win_04_consulta_data',
    category: 'disponibilidade',
    messages: [
      { role: 'user', content: 'Gostei do pacote. Você consegue consultar uma data disponível para o ensaio?' },
    ],
    expected_action: { type: 'handoff', reason: 'disponibilidade' },
    source: SOURCE,
  },
  {
    id: 'paid_win_05_intencao_fechar',
    category: 'fechamento',
    messages: [
      { role: 'user', content: 'As opções ficaram claras e eu já escolhi. Quero fechar o ensaio.' },
    ],
    expected_action: { type: 'handoff', reason: 'fechamento' },
    source: SOURCE,
  },
  {
    id: 'paid_win_06_pagamento_sinal',
    category: 'pagamento',
    messages: [
      { role: 'user', content: 'Como faço para pagar o sinal? Pode me passar o Pix?' },
    ],
    expected_action: { type: 'handoff', reason: 'pagamento' },
    source: SOURCE,
  },
  {
    id: 'paid_win_07_negociacao_objecao',
    category: 'negociacao',
    messages: [
      { role: 'user', content: 'Gostei do pacote, mas queria negociar a condição e saber se existe desconto.' },
    ],
    expected_action: { type: 'handoff', reason: 'pagamento' },
    source: SOURCE,
  },
  {
    id: 'paid_win_08_duvida_incerta',
    category: 'duvida',
    messages: [
      { role: 'user', content: 'Tenho uma exigência específica que não apareceu no material. Vocês conseguem atender?' },
    ],
    expected_action: { type: 'handoff', reason: 'duvida' },
    source: SOURCE,
  },
  {
    id: 'flow_09_gestante_semanas',
    category: 'gestante',
    messages: [
      { role: 'user', content: 'Quero fazer um ensaio de gestante.' },
      { role: 'assistant', content: 'Que momento lindo! Com quantas semanas você está?' },
      { role: 'user', content: 'Estou com 27 semanas.' },
    ],
    expected_action: { type: 'reply' },
    source: SOURCE,
  },
  {
    id: 'flow_10_newborn_ainda_nao_nasceu',
    category: 'newborn',
    messages: [
      { role: 'user', content: 'Estou pesquisando o ensaio newborn, mas o bebê ainda não nasceu.' },
    ],
    expected_action: { type: 'reply' },
    source: SOURCE,
  },
  {
    id: 'flow_11_sem_referencia_nao_conhece',
    category: 'gestante',
    messages: [
      { role: 'user', content: 'É ensaio de gestante, estou com 28 semanas.' },
      { role: 'assistant', content: 'Como você imaginou registrar esse momento? Se tiver referências, pode mandar.' },
      { role: 'user', content: 'Não tenho referências e ainda não conheço o trabalho de vocês.' },
    ],
    expected_action: { type: 'reply' },
    source: SOURCE,
  },
  {
    id: 'flow_12_instagram_meio_semana',
    category: 'gestante',
    messages: [
      { role: 'user', content: 'É gestante, estou com 29 semanas. Pensei em algo natural e vi o trabalho de vocês no Instagram.' },
      { role: 'assistant', content: 'Perfeito! Você tem disponibilidade durante a semana?' },
      { role: 'user', content: 'Tenho sim, consigo ir em um dia de semana.' },
    ],
    expected_action: { type: 'orcamento', nicho: 'gestante' },
    source: SOURCE,
  },
  {
    id: 'flow_13_somente_sabado',
    category: 'newborn',
    messages: [
      { role: 'user', content: 'Meu bebê tem 8 dias. Quero newborn natural, já conheço vocês pelo Instagram, mas só posso sábado.' },
    ],
    expected_action: { type: 'orcamento', nicho: 'newborn' },
    source: SOURCE,
  },
];

for (const learningCase of SUPERVISED_LAB_CASES) {
  learningCase.flow_steps = conversationFlowSteps(learningCase.messages);
}

export class LearningValidationError extends Error {
  status = 400;
}

const PERSONAL_DATA_PATTERNS = [
  { label: 'e-mail', pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i },
  { label: 'link', pattern: /\b(?:https?:\/\/|www\.)\S+/i },
  { label: 'telefone ou documento', pattern: /(?:\d[\s()./-]*){8,}/ },
];

export function assertAnonymousLearningText(value: unknown, field: string): string {
  const text = String(value || '').trim();
  for (const item of PERSONAL_DATA_PATTERNS) {
    if (item.pattern.test(text)) {
      throw new LearningValidationError(`${field} contém ${item.label}. Remova dados pessoais antes de salvar.`);
    }
  }
  return text;
}

export function validateLearningMessages(value: unknown): LearningMessage[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 20) {
    throw new LearningValidationError('O caso precisa ter entre 1 e 20 mensagens anonimizadas.');
  }
  return value.map((message, index) => {
    const role = message?.role === 'assistant' ? 'assistant' : message?.role === 'user' ? 'user' : null;
    if (!role) throw new LearningValidationError(`Mensagem ${index + 1} tem papel inválido.`);
    const content = assertAnonymousLearningText(message?.content, `Mensagem ${index + 1}`);
    if (!content || content.length > 1200) throw new LearningValidationError(`Mensagem ${index + 1} está vazia ou longa demais.`);
    return { role, content };
  });
}

export function interpretLearningReply(rawReply: unknown): { reply: string; action: LearningAction } {
  const raw = String(rawReply || '').trim();
  const reason = parseAgentHandoff(raw);
  if (reason) return { reply: '', action: { type: 'handoff', reason } };
  const pdf = raw.match(/###PDF:([a-z_]+)###/i);
  if (pdf) {
    return {
      reply: raw.replace(/###PDF:[a-z_]+###/i, '').trim(),
      action: { type: 'orcamento', nicho: pdf[1].toLowerCase() },
    };
  }
  return { reply: raw.replace(/###[A-Za-z:_]+###/g, '').trim(), action: { type: 'reply' } };
}

function actionChecks(expected: LearningAction, actual: LearningAction): EvaluationCheck[] {
  const checks: EvaluationCheck[] = [{
    label: 'Tomou a decisão esperada',
    passed: expected.type === actual.type,
    detail: expected.type === actual.type ? undefined : `Esperado: ${expected.type}. Decidido: ${actual.type}.`,
  }];
  if (expected.type === 'handoff') {
    checks.push({
      label: 'Usou o motivo correto para chamar uma pessoa',
      passed: expected.reason === actual.reason,
      detail: expected.reason === actual.reason ? undefined : `Esperado: ${expected.reason || '—'}. Decidido: ${actual.reason || '—'}.`,
    });
  }
  if (expected.type === 'orcamento') {
    checks.push({
      label: 'Escolheu o orçamento correto',
      passed: expected.nicho === actual.nicho,
      detail: expected.nicho === actual.nicho ? undefined : `Esperado: ${expected.nicho || '—'}. Decidido: ${actual.nicho || '—'}.`,
    });
  }
  return checks;
}

function responseStyleChecks(reply: string): EvaluationCheck[] {
  const forbidden = reply.match(/\b(equipe|transfer(?:ir|ência)|encaminhar|atendente|humano)\b/i);
  const unverifiedPressure = reply.match(/\b(?:(?:a hora|o momento) de (?:agendar|reservar) [ée] (?:agora|já)|últimas? vagas?|datas? (?:estão |está )?(?:acabando|esgotando)|corre(?:r)? (?:para |pra )?(?:agendar|reservar|garantir))\b/i);
  const forcedPraise = reply.match(/\b(?:que (?:fase|momento) (?:lind[oa]|especial|delicios[oa])|que del[ií]cia|amei (?:o nome|esse nome)|fico (?:tão )?feliz)\b/i);
  const balloons = reply.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);
  const longest = balloons.reduce((max, part) => Math.max(max, part.length), 0);
  const questions = (reply.match(/[?？]/g) || []).length;
  return [
    {
      label: 'Não revelou transferência ou equipe',
      passed: !forbidden,
      detail: forbidden ? `Expressão proibida encontrada: “${forbidden[0]}”.` : undefined,
    },
    {
      label: 'Não inventou pressa ou escassez',
      passed: !unverifiedPressure,
      detail: unverifiedPressure ? `Pressão não comprovada encontrada: “${unverifiedPressure[0]}”.` : undefined,
    },
    {
      label: 'Evitou elogio automático',
      passed: !forcedPraise,
      detail: forcedPraise ? `Elogio genérico encontrado: “${forcedPraise[0]}”.` : undefined,
    },
    {
      label: 'Manteve ritmo natural sem textão',
      passed: balloons.length <= 3 && longest <= 240 && reply.length <= 600,
      detail: balloons.length > 3 || longest > 240 || reply.length > 600
        ? `${balloons.length} balões; maior balão: ${longest} caracteres; resposta total: ${reply.length}.`
        : undefined,
    },
    {
      label: 'Fez no máximo uma pergunta',
      passed: questions <= 1,
      detail: questions > 1 ? `A resposta contém ${questions} perguntas.` : undefined,
    },
  ];
}

export function evaluateLearningSimulation(
  learningCase: Pick<LearningCase, 'expected_action'>,
  reply: string,
  actualAction: LearningAction,
  flow?: ConversationFlowAnalysis,
): LearningEvaluation {
  const expected = learningCase.expected_action || null;
  const checks = expected ? actionChecks(expected, actualAction) : [];
  if (flow) checks.push(canonicalFlowCheck(flow, actualAction));
  checks.push(...responseStyleChecks(reply));
  return {
    passed: checks.every((check) => check.passed),
    expected_action: expected,
    actual_action: actualAction,
    checks,
  };
}

function canonicalFlowCheck(
  flow: ConversationFlowAnalysis,
  actual: LearningAction,
): EvaluationCheck {
  const expectedType = flow.move === 'handoff'
    ? 'handoff'
    : flow.move === 'send_quote'
      ? 'orcamento'
      : 'reply';
  const sameType = actual.type === expectedType;
  const sameReason = expectedType !== 'handoff' || !flow.handoff_reason || actual.reason === flow.handoff_reason;
  const sameNiche = expectedType !== 'orcamento' || !flow.niche || actual.nicho === flow.niche;
  const passed = sameType && sameReason && sameNiche;
  return {
    label: 'Seguiu a próxima etapa do roteiro',
    passed,
    detail: passed
      ? undefined
      : `Etapa ${flow.move}: esperado ${expectedType}; a Lia decidiu ${actual.type}.`,
  };
}

function compactLine(value: unknown, max: number): string {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

export function buildSupervisedLearningMemory(
  rules: LearningRule[],
  examples: LearningExample[],
): string {
  const activeRules = rules.filter((rule) => rule.active).slice(0, 8);
  const approvedExamples = examples.filter((example) => example.decision === 'approve' || example.decision === 'correct').slice(0, 4);
  if (!activeRules.length && !approvedExamples.length) return '';
  const sections: string[] = [
    'Use somente os aprendizados abaixo, aprovados explicitamente no laboratório deste estúdio. Eles complementam as regras principais e nunca autorizam inventar dados.',
  ];
  if (activeRules.length) {
    sections.push('REGRAS ATIVAS\n' + activeRules.map((rule) => `- ${compactLine(rule.rule_text, 260)}`).join('\n'));
  }
  if (approvedExamples.length) {
    sections.push('EXEMPLOS APROVADOS OU CORRIGIDOS\n' + approvedExamples.map((example) =>
      `- Cliente: ${compactLine(example.customer_message, 180)}\n  Resposta ideal: ${compactLine(example.ideal_reply, 240)}`).join('\n'));
  }
  return sections.join('\n\n').slice(0, 3200);
}

interface DevelopmentSimulation {
  id: string;
  case_id: string | null;
  reply: string;
  action: LearningAction;
  evaluation: LearningEvaluation;
  created_at: string;
}

interface DevelopmentFeedback {
  id: string;
  case_id: string | null;
  source_type: 'lab_case' | 'playground';
  source_ref: string;
  context_excerpt: string;
  assistant_result: string;
  decision: LearningDecision;
  corrected_reply: string;
  proposed_rule: string;
  approve_rule: boolean;
  category: string;
  example_reply: string;
  created_at: string;
}

interface DevelopmentState {
  cases: Map<string, LearningCase>;
  simulations: DevelopmentSimulation[];
  feedback: DevelopmentFeedback[];
  rules: LearningRule[];
  sequence: number;
}

const developmentStores = new Map<string, DevelopmentState>();

function newDevelopmentState(): DevelopmentState {
  const now = new Date().toISOString();
  const cases = SUPERVISED_LAB_CASES.map((item) => ({ ...structuredClone(item), status: 'pending' as const, created_at: now, updated_at: now }));
  return { cases: new Map(cases.map((item) => [item.id, item])), simulations: [], feedback: [], rules: [], sequence: 0 };
}

export function developmentLearningState(key: string): DevelopmentState {
  let state = developmentStores.get(key);
  if (!state) {
    state = newDevelopmentState();
    developmentStores.set(key, state);
  }
  return state;
}

export function listDevelopmentCases(key: string, status?: string): LearningCase[] {
  const cases = [...developmentLearningState(key).cases.values()];
  return cases.filter((item) => !status || item.status === status).map((item) => ({ ...item }));
}

export function recordDevelopmentSimulation(
  key: string,
  value: Omit<DevelopmentSimulation, 'id' | 'created_at'>,
): DevelopmentSimulation {
  const state = developmentLearningState(key);
  const row = { ...value, id: `dev-simulation-${++state.sequence}`, created_at: new Date().toISOString() };
  state.simulations.unshift(row);
  state.simulations = state.simulations.slice(0, 100);
  return row;
}

export function applyDevelopmentFeedback(key: string, input: {
  case_id?: string;
  decision: LearningDecision;
  corrected_reply?: string;
  proposed_rule?: string;
  approve_rule?: boolean;
  category?: string;
  simulation_id?: string;
  source_type?: 'lab_case' | 'playground';
  source_ref?: string;
  messages?: unknown;
  assistant_result?: unknown;
  reply?: unknown;
}): { case: LearningCase; active_rule: LearningRule | null } {
  if (!['approve', 'correct', 'reject'].includes(input.decision)) {
    throw new LearningValidationError('Decisão de feedback inválida.');
  }
  const state = developmentLearningState(key);
  const sourceType = input.source_type === 'playground' ? 'playground' : 'lab_case';
  const learningCase = input.case_id ? state.cases.get(input.case_id) : undefined;
  if (sourceType === 'lab_case' && !learningCase) throw new LearningValidationError('Caso de laboratório não encontrado.');
  const playgroundMessages = sourceType === 'playground' ? validateLearningMessages(input.messages) : [];
  const corrected = input.decision === 'correct'
    ? assertAnonymousLearningText(input.corrected_reply, 'Resposta corrigida')
    : '';
  if (input.decision === 'correct' && !corrected) throw new LearningValidationError('Escreva a resposta corrigida.');
  const proposedRule = input.proposed_rule
    ? assertAnonymousLearningText(input.proposed_rule, 'Regra proposta')
    : '';
  if (input.approve_rule && !proposedRule) throw new LearningValidationError('Escreva a regra antes de aprová-la.');
  const simulation = state.simulations.find((item) => item.id === input.simulation_id)
    || state.simulations.find((item) => item.case_id === input.case_id);
  const submittedReply = assertAnonymousLearningText(input.assistant_result || input.reply, 'Resposta da Lia');
  const exampleReply = input.decision === 'correct'
    ? corrected
    : input.decision === 'approve'
      ? submittedReply || simulation?.reply || ''
      : '';
  const sourceMessages = learningCase?.messages || playgroundMessages;
  const customerMessage = [...sourceMessages].reverse().find((message) => message.role === 'user')?.content || '';
  const now = new Date().toISOString();
  const feedback: DevelopmentFeedback = {
    id: `dev-feedback-${++state.sequence}`,
    case_id: input.case_id || null,
    source_type: sourceType,
    source_ref: compactLine(input.source_ref || input.case_id || 'playground', 100),
    context_excerpt: compactLine(customerMessage, 240),
    assistant_result: compactLine(submittedReply || simulation?.reply || '', 320),
    decision: input.decision,
    corrected_reply: corrected,
    proposed_rule: proposedRule,
    approve_rule: input.approve_rule === true,
    category: compactLine(input.category || learningCase?.category || 'geral', 80),
    example_reply: exampleReply,
    created_at: now,
  };
  state.feedback.unshift(feedback);
  if (learningCase) {
    learningCase.status = input.decision === 'approve' ? 'approved' : input.decision === 'correct' ? 'corrected' : 'rejected';
    learningCase.updated_at = now;
  }
  let activeRule: LearningRule | null = null;
  if (feedback.approve_rule) {
    activeRule = {
      id: `dev-rule-${++state.sequence}`,
      rule_text: proposedRule,
      category: feedback.category || 'geral',
      active: true,
      approval_count: 1,
      created_at: now,
      updated_at: now,
    };
    state.rules.unshift(activeRule);
  }
  const resultCase: LearningCase = learningCase
    ? { ...learningCase }
    : {
      id: feedback.source_ref,
      category: feedback.category,
      messages: playgroundMessages,
      expected_action: { type: 'reply' },
      source: SOURCE,
      status: input.decision === 'approve' ? 'approved' : input.decision === 'correct' ? 'corrected' : 'rejected',
      created_at: now,
      updated_at: now,
    };
  return { case: resultCase, active_rule: activeRule };
}

export function toggleDevelopmentRule(key: string, ruleId: string, active: boolean): LearningRule {
  const rule = developmentLearningState(key).rules.find((item) => item.id === ruleId);
  if (!rule) throw new LearningValidationError('Regra não encontrada.');
  rule.active = active;
  rule.updated_at = new Date().toISOString();
  return { ...rule };
}

export function developmentLearningSummary(key: string) {
  const state = developmentLearningState(key);
  const cases = [...state.cases.values()];
  const counts = {
    total: cases.length,
    pending: cases.filter((item) => item.status === 'pending').length,
    approved: cases.filter((item) => item.status === 'approved').length,
    corrected: cases.filter((item) => item.status === 'corrected').length,
    rejected: cases.filter((item) => item.status === 'rejected').length,
  };
  return {
    counts,
    rules: state.rules.map((rule) => ({ ...rule })),
    active_rules: state.rules.filter((rule) => rule.active).length,
    memory_examples: state.feedback.filter((item) => item.example_reply).length,
    last_feedback_at: state.feedback[0]?.created_at || null,
  };
}

export function developmentLearningMemory(key: string): string {
  const state = developmentLearningState(key);
  const examples: LearningExample[] = state.feedback
    .filter((item) => item.example_reply && item.decision !== 'reject')
    .slice(0, 4)
    .map((item) => {
      const learningCase = item.case_id ? state.cases.get(item.case_id) : undefined;
      const customer = [...(learningCase?.messages || [])].reverse().find((message) => message.role === 'user');
      return {
        case_id: item.case_id || item.source_ref,
        category: item.category,
        customer_message: customer?.content || item.context_excerpt,
        ideal_reply: item.example_reply,
        decision: item.decision as 'approve' | 'correct',
      };
    });
  return buildSupervisedLearningMemory(state.rules, examples);
}

export function developmentLearningRules(key: string): LearningRule[] {
  return developmentLearningState(key).rules.map((rule) => ({ ...rule }));
}

export function isLearningMigrationMissing(error: any): boolean {
  const code = String(error?.code || '');
  const message = String(error?.message || '');
  return code === '42P01' || code === 'PGRST205' || /ai_agent_learning_|schema cache/i.test(message);
}

export function compactAnonymousPlaygroundContext(messages: LearningMessage[]): string {
  const customer = [...messages].reverse().find((message) => message.role === 'user');
  return compactLine(customer?.content || '', 240);
}

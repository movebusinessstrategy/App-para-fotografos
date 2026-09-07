import { createHmac } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  buildSystemPrompt,
  type AgentConfig,
  type AgentMessage,
} from './ai-agent.js';
import { HANDOFF_INSTRUCTION } from './agent-autonomy.js';
import {
  analyzeConversationFlow,
  enforceConversationFlowReply,
  type ConversationFlowAnalysis,
} from './agent-conversation-flow.js';
import { interpretLearningReply, type LearningMessage } from './agent-learning.js';
import {
  enforceApprovedPortfolioUrls,
  portfolioLinksForNiche,
  type PortfolioLink,
} from './agent-portfolio.js';
import {
  evaluateSalesReplayTurn,
  groupSalesReplayTurns,
  redactSalesReplayMessage,
  redactSalesReplayMessages,
  selectConvertedSalesEpisode,
  summarizeSalesReplayTotals,
  type RawSalesReplayMessage,
  type CommercialQuestionTopic,
  type SalesReplayAction,
  type SalesReplayPiiToken,
  type SalesReplayTurn,
} from './agent-sales-replay.js';
import {
  createOpenAIAgentProvider,
  checkOpenAIAgentAvailability,
  OPENAI_AGENT_MODEL,
  type OpenAIAgentDetailedReply,
} from './openai-agent-provider.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const CACHE_TTL_MS = 2 * 60 * 1000;
const PAGE_SIZE = 1000;
const MAX_VISIBLE_CASES = 5;
const REPLAY_CONCURRENCY = 3;

type GenericRow = Record<string, any>;

type ReplayDataset = {
  deals: GenericRow[];
  stages: GenericRow[];
  jobs: GenericRow[];
  clients: GenericRow[];
  payments: GenericRow[];
  messages: GenericRow[];
};

type StrictSale = {
  deal: GenericRow;
  job: GenericRow;
  signalAt: number;
  convertedAt: number;
};

type ReplayScenario = {
  reference: boolean;
  saturday: boolean;
  objection: boolean;
};

type ReplayCandidate = {
  id: string;
  userId: string;
  dealId: string;
  waNumber: string;
  niche: string;
  convertedAt: number;
  signalAt: number;
  rawMessages: RawSalesReplayMessage[];
  piiTokens: SalesReplayPiiToken[];
  scenario: ReplayScenario;
  messageCount: number;
  customerTurns: number;
  durationDays: number;
};

type ReplayCacheEntry = {
  expiresAt: number;
  strictSales: number;
  eligibleEpisodes: number;
  candidates: ReplayCandidate[];
};

export type AgentSalesReplayListItem = {
  id: string;
  niche: string;
  converted_at: string;
  message_count: number;
  duration_days: number;
  customer_turns: number;
  signal_confirmed: true;
  scenario: string[];
};

export type AgentSalesReplayList = {
  items: AgentSalesReplayListItem[];
  strict_sales: number;
  eligible_episodes: number;
  source: 'venda_com_sinal_confirmado';
};

export type RunAgentSalesReplayInput = {
  db: SupabaseClient;
  userId: string;
  caseId: string;
  secret: string;
  config: AgentConfig;
  consentToExternalAi: boolean;
};

type PreparedReplayTurn = {
  turn: SalesReplayTurn;
  flow: ConversationFlowAnalysis;
  messages: AgentMessage[];
  portfolioLinks: PortfolioLink[];
};

type GeneratedReply = {
  text: string;
  latencyMs: number;
  estimatedCostUsd: number;
};

type ReplayProvider = {
  id: string;
  label: string;
  provider: string;
  generate: (work: PreparedReplayTurn) => Promise<GeneratedReply>;
};

const replayCache = new Map<string, ReplayCacheEntry>();
let providerStatusCache: { expiresAt: number; value: Awaited<ReturnType<typeof checkOpenAIAgentAvailability>> } | null = null;

export class AgentSalesReplayError extends Error {
  status: number;
  code: string;

  constructor(message: string, status = 400, code = 'REPLAY_ERROR') {
    super(message);
    this.name = 'AgentSalesReplayError';
    this.status = status;
    this.code = code;
  }
}

export async function getAgentSalesReplayProviderStatus(forceRefresh = false) {
  if (!forceRefresh && providerStatusCache && providerStatusCache.expiresAt > Date.now()) {
    return providerStatusCache.value;
  }
  const value = await checkOpenAIAgentAvailability();
  providerStatusCache = { expiresAt: Date.now() + 60_000, value };
  return value;
}

function rowKey(value: unknown): string {
  return String(value ?? '').trim();
}

function timestampMs(value: unknown): number {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function normalizedText(value: unknown): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function normalizePhone(value: unknown): string {
  return String(value || '').replace(/\D/g, '');
}

function brazilianPhoneVariants(value: unknown): string[] {
  const raw = normalizePhone(value);
  if (!raw) return [];
  const values = new Set<string>([raw]);
  const tail = raw.startsWith('55') && raw.length >= 12 ? raw.slice(2) : raw;
  values.add(tail);
  values.add(`55${tail}`);
  if (tail.length === 10) {
    const withNine = `${tail.slice(0, 2)}9${tail.slice(2)}`;
    values.add(withNine);
    values.add(`55${withNine}`);
  }
  if (tail.length === 11 && tail[2] === '9') {
    const withoutNine = `${tail.slice(0, 2)}${tail.slice(3)}`;
    values.add(withoutNine);
    values.add(`55${withoutNine}`);
  }
  return [...values].filter(Boolean);
}

function variantSet(values: unknown[]): Set<string> {
  return new Set(values.flatMap(brazilianPhoneVariants));
}

function setsOverlap(left: Set<string>, right: Set<string>): boolean {
  for (const value of left) if (right.has(value)) return true;
  return false;
}

async function loadAllUserRows(
  db: SupabaseClient,
  table: string,
  columns: string,
  userId: string,
): Promise<GenericRow[]> {
  const rows: GenericRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await db.from(table)
      .select(columns)
      .eq('user_id', userId)
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const page = (data || []) as GenericRow[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

async function loadJobPayments(db: SupabaseClient, jobIds: string[]): Promise<GenericRow[]> {
  const rows: GenericRow[] = [];
  for (let from = 0; from < jobIds.length; from += 200) {
    const ids = jobIds.slice(from, from + 200);
    const { data, error } = await db.from('job_payments').select('*').in('job_id', ids);
    if (error) throw error;
    rows.push(...((data || []) as GenericRow[]));
  }
  return rows;
}

async function loadReplayDataset(db: SupabaseClient, userId: string): Promise<ReplayDataset> {
  const [deals, stages, jobs, clients, messages] = await Promise.all([
    loadAllUserRows(db, 'deals', '*', userId),
    loadAllUserRows(db, 'deal_stages', 'id,is_won', userId),
    loadAllUserRows(db, 'jobs', '*', userId),
    loadAllUserRows(db, 'clients', '*', userId),
    loadAllUserRows(
      db,
      'wa_messages',
      'id,message_id,phone,wa_number,from_me,body,transcription,type,timestamp,media_url',
      userId,
    ),
  ]);
  const payments = await loadJobPayments(db, jobs.map((job) => rowKey(job.id)).filter(Boolean));
  return { deals, stages, jobs, clients, payments, messages };
}

function paymentIsSignal(payment: GenericRow): boolean {
  const amount = Number(payment.amount);
  const paymentAt = timestampMs(payment.payment_date);
  return amount > 0 && Number.isFinite(paymentAt) && /sinal/i.test(String(payment.description || ''));
}

function strictSales(dataset: ReplayDataset): StrictSale[] {
  const wonStages = new Set(dataset.stages.filter((stage) => stage.is_won === true).map((stage) => rowKey(stage.id)));
  const jobs = new Map(dataset.jobs.map((job) => [rowKey(job.id), job]));
  const paymentsByJob = new Map<string, GenericRow[]>();
  dataset.payments.filter(paymentIsSignal).forEach((payment) => {
    const key = rowKey(payment.job_id);
    paymentsByJob.set(key, [...(paymentsByJob.get(key) || []), payment]);
  });

  return dataset.deals.flatMap((deal): StrictSale[] => {
    const convertedAt = timestampMs(deal.converted_at);
    const job = jobs.get(rowKey(deal.converted_job_id));
    if (deal.converted !== true || !Number.isFinite(convertedAt) || !wonStages.has(rowKey(deal.stage)) || !job) return [];
    if (String(job.status || '').toLowerCase() === 'cancelled') return [];
    if (job.deal_id != null && rowKey(job.deal_id) !== rowKey(deal.id)) return [];
    const signals = paymentsByJob.get(rowKey(job.id)) || [];
    if (!signals.length) return [];
    const signalAt = Math.min(...signals.map((payment) => timestampMs(payment.payment_date)));
    return [{ deal, job, convertedAt, signalAt }];
  });
}

function clientRowsForSale(sale: StrictSale, clients: Map<string, GenericRow>): GenericRow[] {
  const ids = [sale.deal.converted_client_id, sale.deal.client_id, sale.job.client_id]
    .map(rowKey)
    .filter(Boolean);
  return [...new Set(ids)].flatMap((id) => clients.get(id) ? [clients.get(id) as GenericRow] : []);
}

function phoneValuesForSale(sale: StrictSale, clients: Map<string, GenericRow>): unknown[] {
  return [sale.deal.contact_phone, ...clientRowsForSale(sale, clients).map((client) => client.phone)];
}

function addToken(tokens: SalesReplayPiiToken[], value: unknown, label: string) {
  const text = String(value || '').trim();
  if (text.length >= 2 && !tokens.some((token) => token.value.toLowerCase() === text.toLowerCase())) {
    tokens.push({ value: text, label });
  }
}

function addNameTokens(tokens: SalesReplayPiiToken[], value: unknown, label: string) {
  const name = String(value || '').trim();
  addToken(tokens, name, label);
  name.split(/\s+/).filter((part) => part.length >= 3).forEach((part) => {
    addToken(tokens, part, label);
    if (part.length >= 5) addToken(tokens, part.slice(0, 3), label);
  });
}

function piiTokensForSale(sale: StrictSale, clientRows: GenericRow[]): SalesReplayPiiToken[] {
  const tokens: SalesReplayPiiToken[] = [];
  addNameTokens(tokens, sale.deal.contact_name, 'nome da cliente');
  addToken(tokens, sale.deal.contact_phone, 'telefone');
  addToken(tokens, sale.deal.contact_email, 'e-mail');
  addNameTokens(tokens, sale.job.child_name || sale.job.baby_name, 'nome da criança');
  clientRows.forEach((client) => {
    addNameTokens(tokens, client.name, 'nome da cliente');
    addToken(tokens, client.phone, 'telefone');
    addToken(tokens, client.email, 'e-mail');
    addToken(tokens, client.cpf || client.document, 'documento');
    addToken(tokens, client.address || client.street_address, 'endereço');
  });
  return tokens;
}

function rawReplayMessage(row: GenericRow): RawSalesReplayMessage {
  return {
    id: row.id,
    message_id: row.message_id,
    from_me: row.from_me === true,
    body: row.body,
    transcription: row.transcription,
    type: row.type,
    timestamp: row.timestamp,
    media_url: row.media_url,
  };
}

function previousConversionAt(
  sale: StrictSale,
  dataset: ReplayDataset,
  clients: Map<string, GenericRow>,
  jobs: Map<string, GenericRow>,
  phones: Set<string>,
  strictDealIds: Set<string>,
): number | null {
  const previous = dataset.deals.flatMap((deal): number[] => {
    const time = timestampMs(deal.converted_at);
    if (!strictDealIds.has(rowKey(deal.id))) return [];
    if (rowKey(deal.id) === rowKey(sale.deal.id) || !Number.isFinite(time) || time >= sale.convertedAt) return [];
    const job = jobs.get(rowKey(deal.converted_job_id)) || {};
    const otherSale = { deal, job, convertedAt: time, signalAt: time } as StrictSale;
    const otherPhones = variantSet(phoneValuesForSale(otherSale, clients));
    return setsOverlap(phones, otherPhones) ? [time] : [];
  });
  return previous.length ? Math.max(...previous) : null;
}

function signalEpisodeEnd(sale: StrictSale): number {
  const signal = new Date(sale.signalAt);
  signal.setUTCHours(23, 59, 59, 999);
  return Math.max(sale.convertedAt, signal.getTime()) + (2 * DAY_MS);
}

function scenarioForMessages(messages: RawSalesReplayMessage[]): ReplayScenario {
  const customerText = normalizedText(messages.filter((message) => !message.from_me).map((message) => message.body || message.transcription).join('\n'));
  const allText = normalizedText(messages.map((message) => message.body || message.transcription).join('\n'));
  return {
    reference: messages.some((message) => !message.from_me && ['image', 'photo'].includes(String(message.type || '').toLowerCase()))
      || /\b(?:referenc|inspirac)\b/.test(customerText),
    saturday: /\bsabado\b/.test(allText),
    objection: /\b(?:caro|desconto|fora do orcamento|vou pensar|ver com (?:meu|minha)|nao consigo)\b/.test(customerText),
  };
}

function channelRowsForSale(
  sale: StrictSale,
  dataset: ReplayDataset,
  clients: Map<string, GenericRow>,
  jobs: Map<string, GenericRow>,
  strictDealIds: Set<string>,
): Array<[string, GenericRow[]]> {
  const phones = variantSet(phoneValuesForSale(sale, clients));
  if (!phones.size) return [];
  const previousAt = previousConversionAt(sale, dataset, clients, jobs, phones, strictDealIds);
  const grouped = new Map<string, GenericRow[]>();
  dataset.messages.forEach((message) => {
    const time = timestampMs(message.timestamp);
    if (!Number.isFinite(time) || (previousAt !== null && time <= previousAt)) return;
    if (!setsOverlap(phones, variantSet([message.phone]))) return;
    const channel = String(message.wa_number || 'legacy');
    grouped.set(channel, [...(grouped.get(channel) || []), message]);
  });
  return [...grouped.entries()];
}

function replayId(secret: string, userId: string, dealId: string, waNumber: string): string {
  return createHmac('sha256', secret)
    .update(`sales-replay:v1|${userId}|${dealId}|${waNumber}`)
    .digest('hex')
    .slice(0, 16);
}

function durationDays(messages: RawSalesReplayMessage[]): number {
  const times = messages.map((message) => timestampMs(message.timestamp)).filter(Number.isFinite);
  if (times.length < 2) return 0;
  return Math.max(0, Math.round(((Math.max(...times) - Math.min(...times)) / DAY_MS) * 10) / 10);
}

function candidateForChannel(
  sale: StrictSale,
  rows: GenericRow[],
  waNumber: string,
  userId: string,
  secret: string,
  clients: Map<string, GenericRow>,
): ReplayCandidate | null {
  const rawMessages = selectConvertedSalesEpisode(
    rows.map(rawReplayMessage),
    sale.convertedAt,
    signalEpisodeEnd(sale),
  );
  const customerCount = rawMessages.filter((message) => !message.from_me).length;
  const humanCount = rawMessages.filter((message) => message.from_me).length;
  if (customerCount < 2 || humanCount < 2) return null;
  const clientRows = clientRowsForSale(sale, clients);
  const piiTokens = piiTokensForSale(sale, clientRows);
  const turns = groupSalesReplayTurns(redactSalesReplayMessages(rawMessages, piiTokens));
  return {
    id: replayId(secret, userId, rowKey(sale.deal.id), waNumber),
    userId,
    dealId: rowKey(sale.deal.id),
    waNumber,
    niche: String(sale.job.job_type || 'outros').trim().toLowerCase(),
    convertedAt: sale.convertedAt,
    signalAt: sale.signalAt,
    rawMessages,
    piiTokens,
    scenario: scenarioForMessages(rawMessages),
    messageCount: rawMessages.length,
    customerTurns: turns.length,
    durationDays: durationDays(rawMessages),
  };
}

function allReplayCandidates(
  dataset: ReplayDataset,
  sales: StrictSale[],
  userId: string,
  secret: string,
): ReplayCandidate[] {
  const clients = new Map(dataset.clients.map((client) => [rowKey(client.id), client]));
  const jobs = new Map(dataset.jobs.map((job) => [rowKey(job.id), job]));
  const strictDealIds = new Set(sales.map((sale) => rowKey(sale.deal.id)));
  return sales.flatMap((sale) => channelRowsForSale(sale, dataset, clients, jobs, strictDealIds)
    .flatMap(([waNumber, rows]) => {
      const candidate = candidateForChannel(sale, rows, waNumber, userId, secret, clients);
      return candidate ? [candidate] : [];
    }));
}

function chooseVisibleCandidates(candidates: ReplayCandidate[]): ReplayCandidate[] {
  const selected: ReplayCandidate[] = [];
  const add = (candidate: ReplayCandidate | undefined) => {
    if (candidate && !selected.some((item) => item.id === candidate.id)) selected.push(candidate);
  };
  const byTurns = [...candidates].sort((a, b) => (
    Math.abs(a.customerTurns - 16) - Math.abs(b.customerTurns - 16)
    || b.convertedAt - a.convertedAt
  ));
  const usefulLength = (candidate: ReplayCandidate) => candidate.customerTurns >= 8 && candidate.customerTurns <= 35;
  add(byTurns.find((candidate) => usefulLength(candidate) && candidate.niche === 'gestante' && candidate.scenario.reference));
  add(byTurns.find((candidate) => usefulLength(candidate) && candidate.niche === 'newborn'));
  add(byTurns.find((candidate) => usefulLength(candidate) && candidate.scenario.saturday));
  add(byTurns.find((candidate) => usefulLength(candidate) && candidate.scenario.objection));
  add(byTurns.find((candidate) => (
    candidate.customerTurns >= 4
    && candidate.customerTurns <= 8
    && candidate.messageCount <= 80
  )));
  byTurns.filter((candidate) => candidate.messageCount <= 200 && candidate.customerTurns <= 40).forEach((candidate) => {
    if (selected.length < MAX_VISIBLE_CASES) add(candidate);
  });
  return selected.slice(0, MAX_VISIBLE_CASES);
}

async function buildReplayCache(
  db: SupabaseClient,
  userId: string,
  secret: string,
): Promise<ReplayCacheEntry> {
  if (!secret) throw new AgentSalesReplayError('A proteção do replay ainda não foi configurada.', 503, 'REPLAY_SECRET_MISSING');
  const dataset = await loadReplayDataset(db, userId);
  const sales = strictSales(dataset);
  const allCandidates = allReplayCandidates(dataset, sales, userId, secret);
  const entry = {
    expiresAt: Date.now() + CACHE_TTL_MS,
    strictSales: sales.length,
    eligibleEpisodes: allCandidates.length,
    candidates: chooseVisibleCandidates(allCandidates),
  };
  replayCache.set(userId, entry);
  return entry;
}

async function cachedReplayEntry(
  db: SupabaseClient,
  userId: string,
  secret: string,
): Promise<ReplayCacheEntry> {
  const cached = replayCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached;
  return buildReplayCache(db, userId, secret);
}

function scenarioLabels(scenario: ReplayScenario): string[] {
  return [
    scenario.reference ? 'referencias' : '',
    scenario.saturday ? 'sabado' : '',
    scenario.objection ? 'objecao' : '',
  ].filter(Boolean);
}

function listItem(candidate: ReplayCandidate): AgentSalesReplayListItem {
  const month = new Date(candidate.convertedAt).toISOString().slice(0, 7);
  return {
    id: candidate.id,
    niche: candidate.niche,
    converted_at: `${month}-01T00:00:00.000Z`,
    message_count: candidate.messageCount,
    duration_days: candidate.durationDays,
    customer_turns: candidate.customerTurns,
    signal_confirmed: true,
    scenario: scenarioLabels(candidate.scenario),
  };
}

export async function listAgentSalesReplayCases(
  db: SupabaseClient,
  userId: string,
  secret: string,
): Promise<AgentSalesReplayList> {
  const entry = await cachedReplayEntry(db, userId, secret);
  return {
    items: entry.candidates.map(listItem),
    strict_sales: entry.strictSales,
    eligible_episodes: entry.eligibleEpisodes,
    source: 'venda_com_sinal_confirmado',
  };
}

function learningMessages(turn: SalesReplayTurn): LearningMessage[] {
  return turn.real_prefix.map((message) => ({
    role: message.role === 'customer' ? 'user' as const : 'assistant' as const,
    content: message.content,
    timestamp: message.timestamp,
  }));
}

function agentMessages(turn: SalesReplayTurn): AgentMessage[] {
  return learningMessages(turn).map((message) => ({ role: message.role, content: message.content }));
}

function preparedTurn(turn: SalesReplayTurn, config: AgentConfig, knownNiche: string): PreparedReplayTurn {
  const flow = analyzeConversationFlow(learningMessages(turn), knownNiche);
  return {
    turn,
    flow,
    messages: agentMessages(turn),
    portfolioLinks: portfolioLinksForNiche(config.portfolioLinks || [], flow.niche),
  };
}

function configuredForWork(config: AgentConfig, work: PreparedReplayTurn): AgentConfig {
  return { ...config, portfolioLinks: work.portfolioLinks };
}

function openAIProvider(config: AgentConfig, safetyIdentifier: string): ReplayProvider {
  const provider = createOpenAIAgentProvider<AgentConfig>({
    buildInstructions: buildSystemPrompt,
    safetyIdentifier,
  });
  return {
    ...OPENAI_AGENT_MODEL,
    generate: async (work) => {
      const reply = await provider.getAgentReplyDetailed(
        configuredForWork(config, work),
        work.messages,
        { extraInstruction: `${HANDOFF_INSTRUCTION}\n\n${work.flow.instruction}` },
      );
      return { text: reply.text, latencyMs: reply.latencyMs, estimatedCostUsd: reply.estimatedCostUsd };
    },
  };
}

async function resolveReplayProvider(
  works: PreparedReplayTurn[],
  config: AgentConfig,
  safetyIdentifier: string,
): Promise<{ provider: ReplayProvider; firstIndex: number; firstReply: GeneratedReply | null; warning: string | null }> {
  const firstIndex = works.findIndex((work) => !work.flow.handoff_reason);
  const preferred = openAIProvider(config, safetyIdentifier);
  if (firstIndex < 0) return { provider: preferred, firstIndex, firstReply: null, warning: null };
  try {
    const firstReply = await preferred.generate(works[firstIndex]);
    return { provider: preferred, firstIndex, firstReply, warning: null };
  } catch {
    throw new AgentSalesReplayError(
      'A credencial da OpenAI precisa ser atualizada antes de executar este replay.',
      503,
      'OPENAI_CREDENTIAL_INVALID',
    );
  }
}

function approvedUrls(links: PortfolioLink[]): string[] {
  return links.map((link) => String(link.url || '')).filter(Boolean);
}

function canonicalReplayAction(flow: ConversationFlowAnalysis): SalesReplayAction {
  if (flow.move === 'handoff') {
    return { type: 'handoff', reason: flow.handoff_reason || 'duvida' };
  }
  if (flow.move === 'send_quote') return { type: 'orcamento', niche: flow.niche || undefined };
  return { type: 'reply' };
}

function canonicalReplayStep(flow: ConversationFlowAnalysis): CommercialQuestionTopic {
  return flow.state.current_step || 'none';
}

function redactGeneratedReply(reply: string, candidate: ReplayCandidate): string {
  return redactSalesReplayMessage({
    from_me: true,
    body: reply,
    type: 'text',
    timestamp: new Date().toISOString(),
  }, candidate.piiTokens).content;
}

async function evaluatePreparedTurn(
  work: PreparedReplayTurn,
  candidate: ReplayCandidate,
  generated: GeneratedReply | null,
) {
  const initial = work.flow.handoff_reason
    ? `###HUMANO:${work.flow.handoff_reason}###`
    : generated?.text || '';
  const flowed = enforceConversationFlowReply(initial, work.flow);
  const safeReply = enforceApprovedPortfolioUrls(flowed, work.portfolioLinks, work.flow.niche);
  const evaluation = evaluateSalesReplayTurn({
    turn: work.turn,
    ai_reply: safeReply,
    expected_action: canonicalReplayAction(work.flow),
    expected_next_step: canonicalReplayStep(work.flow),
    pii_tokens: candidate.piiTokens,
    allowed_urls: approvedUrls(work.portfolioLinks),
  });
  const interpreted = interpretLearningReply(safeReply);
  const scored = work.turn.human_messages.length > 0;
  return {
    index: work.turn.index,
    customer_messages: work.turn.customer_messages.map((message) => message.content),
    human_messages: work.turn.human_messages.map((message) => message.content),
    ai_reply: interpreted.reply ? redactGeneratedReply(interpreted.reply, candidate) : '',
    ai_action: evaluation.actual_action,
    expected_action: evaluation.expected_action,
    flow_state: work.flow.state,
    checks: evaluation.checks.map((check) => ({
      id: check.id,
      label: check.label,
      passed: check.passed,
      detail: check.detail,
    })),
    passed: scored ? evaluation.passed : null,
    evaluation: scored ? evaluation : null,
    latency_ms: generated?.latencyMs || 0,
    estimated_cost_usd: generated?.estimatedCostUsd || 0,
  };
}

function humanActiveTurn(work: PreparedReplayTurn) {
  return {
    index: work.turn.index,
    customer_messages: work.turn.customer_messages.map((message) => message.content),
    human_messages: work.turn.human_messages.map((message) => message.content),
    ai_reply: '',
    ai_action: { type: 'human_active' },
    expected_action: work.turn.human_messages.length ? canonicalReplayAction(work.flow) : null,
    flow_state: work.flow.state,
    checks: [{
      id: 'handoff_respected',
      label: 'A Lia permaneceu em silêncio depois do hand-off',
      passed: true,
      detail: 'A conversa já estava sob atendimento humano.',
    }],
    passed: null,
    evaluation: null,
    latency_ms: 0,
    estimated_cost_usd: 0,
  };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

function replaySummary(turns: Array<{ passed: boolean }>, provider: ReplayProvider, warning: string | null): string {
  const passed = turns.filter((turn) => turn.passed).length;
  const result = `${passed} de ${turns.length} turnos seguiram o roteiro validado ou uma condução equivalente segura.`;
  return warning ? `${warning} ${result}` : `Replay completo executado com ${provider.label}. ${result}`;
}

export async function runAgentSalesReplayCase(input: RunAgentSalesReplayInput) {
  if (!input.consentToExternalAi) {
    throw new AgentSalesReplayError(
      'Confirme a autorização para enviar a conversa anonimizada à OpenAI.',
      400,
      'EXTERNAL_AI_CONSENT_REQUIRED',
    );
  }
  const providerStatus = await getAgentSalesReplayProviderStatus(true);
  if (!providerStatus.available) {
    throw new AgentSalesReplayError(
      'A credencial OpenAI precisa ser atualizada antes de executar este replay.',
      503,
      'OPENAI_CREDENTIAL_INVALID',
    );
  }
  const entry = await cachedReplayEntry(input.db, input.userId, input.secret);
  const candidate = entry.candidates.find((item) => item.id === input.caseId);
  if (!candidate) throw new AgentSalesReplayError('Conversa de replay não encontrada.', 404, 'REPLAY_NOT_FOUND');
  const redacted = redactSalesReplayMessages(candidate.rawMessages, candidate.piiTokens);
  const turns = groupSalesReplayTurns(redacted);
  const works = turns.map((turn) => preparedTurn(turn, input.config, candidate.niche));
  const deterministicHandoff = works.findIndex((work) => Boolean(work.flow.handoff_reason));
  const autonomousWorks = deterministicHandoff < 0 ? works : works.slice(0, deterministicHandoff + 1);
  const humanWorks = deterministicHandoff < 0 ? [] : works.slice(deterministicHandoff + 1);
  const safetyIdentifier = replayId(input.secret, input.userId, 'safety', 'openai');
  const resolved = await resolveReplayProvider(
    autonomousWorks,
    input.config,
    safetyIdentifier,
  );

  const firstResult = resolved.firstIndex >= 0
    ? await evaluatePreparedTurn(autonomousWorks[resolved.firstIndex], candidate, resolved.firstReply)
    : null;
  const remaining = autonomousWorks.filter((_work, index) => index !== resolved.firstIndex);
  const evaluatedRemaining = await mapWithConcurrency(remaining, REPLAY_CONCURRENCY, async (work) => {
    const generated = work.flow.handoff_reason ? null : await resolved.provider.generate(work);
    return evaluatePreparedTurn(work, candidate, generated);
  });
  const evaluated = [
    ...evaluatedRemaining,
    ...(firstResult ? [firstResult] : []),
    ...humanWorks.map(humanActiveTurn),
  ]
    .sort((a, b) => a.index - b.index);
  const scoredEvaluations = evaluated.flatMap((item) => item.evaluation ? [item.evaluation] : []);
  const totals = summarizeSalesReplayTotals(scoredEvaluations);
  const estimatedCostUsd = evaluated.reduce((sum, turn) => sum + turn.estimated_cost_usd, 0);

  return {
    model: { id: resolved.provider.id, label: resolved.provider.label, provider: resolved.provider.provider },
    model_id: resolved.provider.id,
    warning: resolved.warning,
    summary: replaySummary(evaluated, resolved.provider, resolved.warning),
    source: 'venda_com_sinal_confirmado',
    turns: evaluated.map(({ evaluation: _evaluation, ...turn }) => turn),
    totals: {
      total: evaluated.length,
      passed: totals.passed,
      failed: totals.failed,
      unscored: evaluated.length - totals.turns,
      score: totals.score,
      checks_passed: totals.checks_passed,
      checks_total: totals.checks_total,
    },
    estimated_cost_usd: Number(estimatedCostUsd.toFixed(6)),
    executed: true,
  };
}

export async function getAgentSalesReplayTranscript(
  db: SupabaseClient,
  userId: string,
  caseId: string,
  secret: string,
) {
  const entry = await cachedReplayEntry(db, userId, secret);
  const candidate = entry.candidates.find((item) => item.id === caseId);
  if (!candidate) throw new AgentSalesReplayError('Conversa de replay não encontrada.', 404, 'REPLAY_NOT_FOUND');
  const turns = groupSalesReplayTurns(redactSalesReplayMessages(candidate.rawMessages, candidate.piiTokens));
  return {
    model: OPENAI_AGENT_MODEL,
    model_id: OPENAI_AGENT_MODEL.id,
    warning: null,
    summary: 'Conversa inteira carregada e anonimizada. A coluna da Lia será preenchida somente depois da sua autorização para executar o teste externo.',
    source: 'venda_com_sinal_confirmado',
    executed: false,
    turns: turns.map((turn) => {
      const flow = analyzeConversationFlow(learningMessages(turn), candidate.niche);
      return {
        index: turn.index,
        customer_messages: turn.customer_messages.map((message) => message.content),
        human_messages: turn.human_messages.map((message) => message.content),
        ai_reply: '',
        ai_action: null,
        expected_action: turn.human_messages.length ? canonicalReplayAction(flow) : null,
        flow_state: flow.state,
        checks: [],
        passed: null,
      };
    }),
    totals: {
      total: turns.length,
      passed: 0,
      failed: 0,
      unscored: turns.length,
    },
    estimated_cost_usd: 0,
  };
}

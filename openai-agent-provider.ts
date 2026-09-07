/**
 * Provedor OpenAI isolado para o agente de atendimento.
 *
 * Não é ativado por importação: o chamador precisa criar o provedor e escolher
 * explicitamente quando usá-lo. A fábrica recebe o construtor de instruções do
 * agente atual, evitando duplicar o playbook e mantendo a assinatura compatível
 * com `getAgentReply(config, messages, opts)`.
 */

export type OpenAIAgentRole = 'user' | 'assistant';

export interface OpenAIAgentMessage {
  role: OpenAIAgentRole;
  content: string;
}

export interface OpenAIAgentReplyOptions {
  extraInstruction?: string;
}

export type OpenAIAgentReply<TConfig> = (
  config: TConfig,
  messages: OpenAIAgentMessage[],
  opts?: OpenAIAgentReplyOptions,
) => Promise<string>;

export type OpenAIReasoningEffort =
  | 'none'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'
  | 'max';

export interface OpenAIModelPricing {
  inputUsdPerMillion: number;
  cachedInputUsdPerMillion: number;
  cacheWriteUsdPerMillion: number;
  outputUsdPerMillion: number;
  longContextThresholdTokens: number;
  longContextInputUsdPerMillion: number;
  longContextCachedInputUsdPerMillion: number;
  longContextCacheWriteUsdPerMillion: number;
  longContextOutputUsdPerMillion: number;
  observedAt: string;
}

export interface OpenAIAgentModelMetadata {
  provider: 'openai';
  api: 'responses';
  id: string;
  label: string;
  reasoningEffort: OpenAIReasoningEffort;
  latencyTarget: 'interactive';
  latencyBenchmark: 'not_measured' | 'measured_per_request';
  pricing: OpenAIModelPricing;
}

export const OPENAI_AGENT_MODEL: OpenAIAgentModelMetadata = {
  provider: 'openai',
  api: 'responses',
  id: 'gpt-5.6-luna',
  label: 'GPT-5.6 Luna',
  reasoningEffort: 'low',
  latencyTarget: 'interactive',
  latencyBenchmark: 'measured_per_request',
  pricing: {
    inputUsdPerMillion: 0.2,
    cachedInputUsdPerMillion: 0.02,
    cacheWriteUsdPerMillion: 0.25,
    outputUsdPerMillion: 1.2,
    longContextThresholdTokens: 272_000,
    longContextInputUsdPerMillion: 0.4,
    longContextCachedInputUsdPerMillion: 0.04,
    longContextCacheWriteUsdPerMillion: 0.5,
    longContextOutputUsdPerMillion: 1.8,
    observedAt: '2026-08-12',
  },
};

export interface OpenAIResponsesUsage {
  input_tokens?: number;
  output_tokens?: number;
  input_tokens_details?: {
    cached_tokens?: number;
    cache_write_tokens?: number;
  };
}

export interface OpenAIAgentDetailedReply {
  text: string;
  modelId: string;
  modelLabel: string;
  latencyMs: number;
  usage: OpenAIResponsesUsage;
  estimatedCostUsd: number;
}

export interface OpenAIAgentProvider<TConfig> {
  metadata: OpenAIAgentModelMetadata;
  getAgentReply: OpenAIAgentReply<TConfig>;
  getAgentReplyDetailed: (
    config: TConfig,
    messages: OpenAIAgentMessage[],
    opts?: OpenAIAgentReplyOptions,
  ) => Promise<OpenAIAgentDetailedReply>;
}

export type OpenAIAgentAvailability = {
  provider: 'openai';
  modelId: string;
  modelLabel: string;
  configured: boolean;
  available: boolean;
};

export interface CreateOpenAIAgentProviderOptions<TConfig> {
  buildInstructions: (config: TConfig) => string;
  apiKey?: string;
  endpoint?: string;
  fetchImpl?: typeof fetch;
  maxOutputTokens?: number;
  model?: OpenAIAgentModelMetadata;
  reasoningEffort?: OpenAIReasoningEffort;
  safetyIdentifier?: string;
  timeoutMs?: number;
}

interface OpenAIResponsesPayload {
  output_text?: string;
  output?: Array<{
    type?: string;
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
  usage?: OpenAIResponsesUsage;
}

const DEFAULT_ENDPOINT = 'https://api.openai.com/v1/responses';
const DEFAULT_MAX_OUTPUT_TOKENS = 1024;
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_HISTORY_MESSAGES = 500;

function stripLeadingTimestamp(content: string): string {
  const stripped = content.replace(
    /^\s*\[?\s*\d{1,2}:\d{2}(?::\d{2})?\s*(?:,?\s*\d{1,2}\/\d{1,2}\/\d{2,4})?\s*\]?\s*[-–—]?\s*/,
    '',
  ).trim();
  return stripped || content.trim();
}

export function prepareOpenAIConversation(
  messages: OpenAIAgentMessage[],
): OpenAIAgentMessage[] {
  const cleaned = (messages || [])
    .filter((message) => Boolean(message?.content?.trim()))
    .map((message) => ({
      role: message.role === 'assistant' ? 'assistant' as const : 'user' as const,
      content: stripLeadingTimestamp(message.content),
    }))
    .slice(-MAX_HISTORY_MESSAGES);

  while (cleaned[0]?.role === 'assistant') cleaned.shift();

  if (cleaned.length === 0) {
    throw new Error('Envie pelo menos uma mensagem do cliente.');
  }
  if (cleaned.at(-1)?.role !== 'user') {
    throw new Error('A última mensagem da conversa é sua — espere o cliente responder.');
  }
  return cleaned;
}

export function combineOpenAIInstructions(
  baseInstructions: string,
  extraInstruction?: string,
): string {
  return [baseInstructions.trim(), extraInstruction?.trim()]
    .filter(Boolean)
    .join('\n\n');
}

function normalizedTokenCount(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, value || 0) : 0;
}

export function estimateOpenAICostUsd(
  usage: OpenAIResponsesUsage,
  pricing: OpenAIModelPricing = OPENAI_AGENT_MODEL.pricing,
): number {
  const inputTokens = normalizedTokenCount(usage.input_tokens);
  const cachedTokens = Math.min(
    inputTokens,
    normalizedTokenCount(usage.input_tokens_details?.cached_tokens),
  );
  const cacheWriteTokens = Math.min(
    inputTokens - cachedTokens,
    normalizedTokenCount(usage.input_tokens_details?.cache_write_tokens),
  );
  const uncachedTokens = inputTokens - cachedTokens - cacheWriteTokens;
  const outputTokens = normalizedTokenCount(usage.output_tokens);
  const usesLongContext = inputTokens > pricing.longContextThresholdTokens;
  const inputRate = usesLongContext
    ? pricing.longContextInputUsdPerMillion
    : pricing.inputUsdPerMillion;
  const cachedInputRate = usesLongContext
    ? pricing.longContextCachedInputUsdPerMillion
    : pricing.cachedInputUsdPerMillion;
  const cacheWriteRate = usesLongContext
    ? pricing.longContextCacheWriteUsdPerMillion
    : pricing.cacheWriteUsdPerMillion;
  const outputRate = usesLongContext
    ? pricing.longContextOutputUsdPerMillion
    : pricing.outputUsdPerMillion;
  const cost = (
    uncachedTokens * inputRate
    + cachedTokens * cachedInputRate
    + cacheWriteTokens * cacheWriteRate
    + outputTokens * outputRate
  ) / 1_000_000;
  return Number(cost.toFixed(8));
}

function collectOutputText(payload: OpenAIResponsesPayload): string {
  return (payload.output || [])
    .flatMap((item) => item.content || [])
    .filter((content) => content.type === 'output_text' && content.text)
    .map((content) => content.text?.trim() || '')
    .filter(Boolean)
    .join('')
    .trim();
}

export function extractOpenAIOutputText(payload: OpenAIResponsesPayload): string {
  const directText = payload.output_text?.trim();
  const text = directText || collectOutputText(payload);
  if (!text) throw new Error('A OpenAI não retornou texto para o cliente.');
  return stripLeadingTimestamp(text);
}

function resolveApiKey(explicitApiKey?: string): string | undefined {
  if (explicitApiKey?.trim()) return explicitApiKey.trim();
  return typeof process === 'undefined'
    ? undefined
    : process.env.OPENAI_API_KEY?.trim();
}

export async function checkOpenAIAgentAvailability(options: {
  apiKey?: string;
  endpoint?: string;
  fetchImpl?: typeof fetch;
  model?: OpenAIAgentModelMetadata;
  timeoutMs?: number;
} = {}): Promise<OpenAIAgentAvailability> {
  const model = options.model || OPENAI_AGENT_MODEL;
  const apiKey = resolveApiKey(options.apiKey);
  if (!apiKey) {
    return { provider: 'openai', modelId: model.id, modelLabel: model.label, configured: false, available: false };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 10_000);
  try {
    const response = await (options.fetchImpl || fetch)(options.endpoint || DEFAULT_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: model.id,
        input: 'Responda apenas OK.',
        reasoning: { effort: 'low' },
        text: { verbosity: 'low' },
        max_output_tokens: 32,
        store: false,
      }),
      signal: controller.signal,
    });
    return { provider: 'openai', modelId: model.id, modelLabel: model.label, configured: true, available: response.ok };
  } catch {
    return { provider: 'openai', modelId: model.id, modelLabel: model.label, configured: true, available: false };
  } finally {
    clearTimeout(timeout);
  }
}

function buildRequestBody(
  metadata: OpenAIAgentModelMetadata,
  instructions: string,
  input: OpenAIAgentMessage[],
  options: CreateOpenAIAgentProviderOptions<unknown>,
): Record<string, unknown> {
  return {
    model: metadata.id,
    instructions,
    input,
    reasoning: { effort: options.reasoningEffort || metadata.reasoningEffort },
    text: { verbosity: 'low' },
    max_output_tokens: options.maxOutputTokens || DEFAULT_MAX_OUTPUT_TOKENS,
    store: false,
    ...(options.safetyIdentifier
      ? { safety_identifier: options.safetyIdentifier }
      : {}),
  };
}

async function parseSuccessfulResponse(response: Response): Promise<OpenAIResponsesPayload> {
  if (!response.ok) {
    const requestId = response.headers.get('x-request-id');
    const suffix = requestId ? ` (request ${requestId})` : '';
    throw new Error(`Falha na OpenAI: HTTP ${response.status}${suffix}.`);
  }
  return response.json() as Promise<OpenAIResponsesPayload>;
}

export function createOpenAIAgentProvider<TConfig>(
  options: CreateOpenAIAgentProviderOptions<TConfig>,
): OpenAIAgentProvider<TConfig> {
  const metadata = options.model || OPENAI_AGENT_MODEL;
  const endpoint = options.endpoint || DEFAULT_ENDPOINT;
  const fetchImpl = options.fetchImpl || fetch;

  const getAgentReplyDetailed = async (
    config: TConfig,
    messages: OpenAIAgentMessage[],
    replyOptions?: OpenAIAgentReplyOptions,
  ): Promise<OpenAIAgentDetailedReply> => {
    const apiKey = resolveApiKey(options.apiKey);
    if (!apiKey) throw new Error('OPENAI_API_KEY não configurada no servidor.');

    const input = prepareOpenAIConversation(messages);
    const instructions = combineOpenAIInstructions(
      options.buildInstructions(config),
      replyOptions?.extraInstruction,
    );
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      options.timeoutMs || DEFAULT_TIMEOUT_MS,
    );
    const startedAt = Date.now();

    try {
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(buildRequestBody(
          metadata,
          instructions,
          input,
          options as CreateOpenAIAgentProviderOptions<unknown>,
        )),
        signal: controller.signal,
      });
      const payload = await parseSuccessfulResponse(response);
      const usage = payload.usage || {};
      return {
        text: extractOpenAIOutputText(payload),
        modelId: metadata.id,
        modelLabel: metadata.label,
        latencyMs: Date.now() - startedAt,
        usage,
        estimatedCostUsd: estimateOpenAICostUsd(usage, metadata.pricing),
      };
    } finally {
      clearTimeout(timeout);
    }
  };

  return {
    metadata,
    getAgentReplyDetailed,
    getAgentReply: async (config, messages, replyOptions) => (
      await getAgentReplyDetailed(config, messages, replyOptions)
    ).text,
  };
}

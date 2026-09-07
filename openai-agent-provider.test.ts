import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OPENAI_AGENT_MODEL,
  checkOpenAIAgentAvailability,
  combineOpenAIInstructions,
  createOpenAIAgentProvider,
  estimateOpenAICostUsd,
  extractOpenAIOutputText,
  prepareOpenAIConversation,
} from './openai-agent-provider.js';

test('limpa horários e preserva apenas o trecho válido da conversa', () => {
  const prepared = prepareOpenAIConversation([
    { role: 'assistant', content: 'Mensagem antiga do estúdio' },
    { role: 'user', content: '[15:34, 19/06/2026] Quero ensaio gestante' },
    { role: 'assistant', content: 'Quantas semanas você está?' },
    { role: 'user', content: 'Estou com 28 semanas' },
  ]);

  assert.deepEqual(prepared, [
    { role: 'user', content: 'Quero ensaio gestante' },
    { role: 'assistant', content: 'Quantas semanas você está?' },
    { role: 'user', content: 'Estou com 28 semanas' },
  ]);
});

test('recusa gerar quando a última fala ainda é do estúdio', () => {
  assert.throws(
    () => prepareOpenAIConversation([
      { role: 'user', content: 'Oi' },
      { role: 'assistant', content: 'Como posso ajudar?' },
    ]),
    /espere o cliente responder/,
  );
});

test('combina o playbook com a instrução dinâmica de handoff', () => {
  assert.equal(
    combineOpenAIInstructions('Fluxo validado', 'Pare silenciosamente'),
    'Fluxo validado\n\nPare silenciosamente',
  );
});

test('extrai texto tanto do atalho quanto da estrutura nativa da Responses API', () => {
  assert.equal(extractOpenAIOutputText({ output_text: 'Perfeito 🥰' }), 'Perfeito 🥰');
  assert.equal(extractOpenAIOutputText({
    output: [{
      type: 'message',
      content: [{ type: 'output_text', text: 'Você tem disponibilidade durante a semana?' }],
    }],
  }), 'Você tem disponibilidade durante a semana?');
});

test('estima custo separando entrada normal, entrada em cache e saída', () => {
  const cost = estimateOpenAICostUsd({
    input_tokens: 1_000,
    input_tokens_details: { cached_tokens: 400 },
    output_tokens: 200,
  });
  assert.equal(cost, 0.000368);
});

test('inclui escrita em cache na estimativa de custo', () => {
  const cost = estimateOpenAICostUsd({
    input_tokens: 1_000,
    input_tokens_details: {
      cached_tokens: 200,
      cache_write_tokens: 300,
    },
    output_tokens: 100,
  });
  assert.equal(cost, 0.000299);
});

test('usa a tabela de contexto longo acima de 272 mil tokens', () => {
  const cost = estimateOpenAICostUsd({
    input_tokens: 300_000,
    output_tokens: 1_000,
  });
  assert.equal(cost, 0.1218);
});

test('expõe uma função compatível com getAgentReply sem fazer rede real', async () => {
  let capturedBody: Record<string, unknown> | undefined;
  const provider = createOpenAIAgentProvider<string>({
    apiKey: 'chave-apenas-de-teste',
    buildInstructions: (config) => config,
    fetchImpl: async (_input, init) => {
      capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        output: [{
          type: 'message',
          content: [{ type: 'output_text', text: 'Com quantas semanas você está? 🥰' }],
        }],
        usage: { input_tokens: 100, output_tokens: 20 },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });

  const reply = await provider.getAgentReply(
    'Siga o fluxo aprovado.',
    [{ role: 'user', content: 'Quero fazer um ensaio gestante' }],
    { extraInstruction: 'Faça só uma pergunta.' },
  );

  assert.equal(reply, 'Com quantas semanas você está? 🥰');
  assert.equal(provider.metadata.id, OPENAI_AGENT_MODEL.id);
  assert.equal(capturedBody?.model, 'gpt-5.6-luna');
  assert.equal(capturedBody?.store, false);
  assert.deepEqual(capturedBody?.reasoning, { effort: 'low' });
  assert.equal(
    capturedBody?.instructions,
    'Siga o fluxo aprovado.\n\nFaça só uma pergunta.',
  );
});

test('erro HTTP não repassa corpo da resposta nem credenciais', async () => {
  const provider = createOpenAIAgentProvider<string>({
    apiKey: 'segredo-que-nao-pode-vazar',
    buildInstructions: (config) => config,
    fetchImpl: async () => new Response(
      JSON.stringify({ error: { message: 'corpo interno sensível' } }),
      {
        status: 429,
        headers: { 'x-request-id': 'req_seguro' },
      },
    ),
  });

  await assert.rejects(
    provider.getAgentReply('Fluxo', [{ role: 'user', content: 'Teste' }]),
    (error: Error) => {
      assert.match(error.message, /HTTP 429/);
      assert.match(error.message, /req_seguro/);
      assert.doesNotMatch(error.message, /corpo interno sensível/);
      assert.doesNotMatch(error.message, /segredo-que-nao-pode-vazar/);
      return true;
    },
  );
});

test('preflight informa credencial recusada sem ler o corpo de erro', async () => {
  let requestedUrl = '';
  let requestedInit: RequestInit | undefined;
  const status = await checkOpenAIAgentAvailability({
    apiKey: 'chave-de-teste',
    fetchImpl: async (input, init) => {
      requestedUrl = String(input);
      requestedInit = init;
      return new Response('{"segredo":"nao ler"}', { status: 401 });
    },
  });

  assert.equal(status.configured, true);
  assert.equal(status.available, false);
  assert.match(requestedUrl, /\/v1\/responses$/);
  assert.equal(requestedInit?.method, 'POST');
  const body = JSON.parse(String(requestedInit?.body || '{}'));
  assert.equal(body.model, 'gpt-5.6-luna');
  assert.equal(body.input, 'Responda apenas OK.');
  assert.equal(body.store, false);
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { HANDOFF_INSTRUCTION } from './agent-autonomy.js';
import type { AgentConfig, AgentMessage } from './ai-agent.js';
import {
  FOLLOWUP_DIRECTIVE_VERSION,
  FOLLOWUP_INSTRUCTION,
  HISTORY_START_NOTE,
  NEUTRAL_HOOKS,
  SCHEDULING_ASK_FALLBACK,
  asksAboutScheduling,
  NO_KNOWLEDGE_MESSAGE,
  PRE_QUOTE_DIRECTIVES,
  PRE_QUOTE_NEUTRAL_HOOKS,
  REACTION_NOTE,
  STEP_DIRECTIVES,
  cleanFollowupText,
  contextTail,
  draftWarnings,
  firstName,
  generateCadenceDraft,
  invisibleBasisNote,
  limitWarnings,
  redactForAi,
  toAgentMessages,
  toTemplateHook,
  type DraftDeps,
  type DraftInput,
  type DraftResult,
  type DraftRow,
} from './followup-draft.js';

// Números, e-mails e CPFs abaixo são fictícios.
// Travessão e meia-risca montados por código: o caractere não entra no fonte.
const EM_DASH = String.fromCharCode(0x2014);
const DASH_PATTERN = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);
const NOW = new Date('2026-09-19T15:00:00Z');

function row(fromMe: boolean, body: string | null, type: string | null = 'text', minute = 0, transcription: string | null = null): DraftRow {
  const timestamp = new Date(Date.UTC(2026, 8, 15, 12, minute)).toISOString();
  return { body, from_me: fromMe, type, transcription, timestamp };
}

function baseInput(overrides: Partial<DraftInput> = {}): DraftInput {
  return {
    userId: 'user-1',
    waNumber: '5511900000000',
    step: 1,
    contactName: 'maria clara',
    rows: [
      row(true, 'Olá! Aqui é do estúdio, tudo bem?', 'text', 0),
      row(false, 'Oi! Quero fazer ensaio gestante, estou com 32 semanas', 'text', 1),
      row(true, 'Pacotes Gestante.pdf', 'document', 2),
      row(true, 'Te mandei os pacotes, me conta qual gostou mais 🥰', 'text', 3),
    ],
    agent: {
      persona: 'Tom carinhoso e direto',
      objective: 'Levar a cliente até o pacote certo',
      knowledge: 'Pacote Essencial com 20 fotos editadas. Atendemos de segunda a sábado.',
      rules: 'Nunca inventar preço',
      sales_strategy: null,
      attendant_name: 'Aurora',
      learned_playbook: null,
      portfolio_links: [],
    },
    extraInstructions: '',
    invisible: { basis: false, at: null, read: false },
    now: NOW,
    ...overrides,
  };
}

interface Call { config: AgentConfig; messages: AgentMessage[]; opts: { extraInstruction?: string } }

function fakeDeps(replies: Array<string | Error>, memory = 'Sempre chamar pelo primeiro nome.') {
  const calls: Call[] = [];
  const memoryCalls: Array<[string, string]> = [];
  const deps: DraftDeps = {
    async getReplyDetailed(config, messages, opts) {
      calls.push({ config, messages, opts });
      const next = replies[Math.min(calls.length - 1, replies.length - 1)];
      if (next instanceof Error) throw next;
      return { text: next, modelId: 'gpt-test', latencyMs: 120, usage: { input_tokens: 10, output_tokens: 5 }, estimatedCostUsd: 0.002 };
    },
    async loadSupervisedMemory(userId, waNumber) {
      memoryCalls.push([userId, waNumber]);
      return memory;
    },
  };
  return { deps, calls, memoryCalls };
}

function lastTurn(call: Call): AgentMessage {
  return call.messages[call.messages.length - 1];
}

function asDraft(result: DraftResult): Extract<DraftResult, { kind: 'draft' }> {
  assert.equal(result.kind, 'draft', JSON.stringify(result));
  return result as Extract<DraftResult, { kind: 'draft' }>;
}

// ── redactForAi ──────────────────────────────────────────────────────────────

test('redactForAi mascara telefone de 12 e 13 dígitos e formatado, e-mail e CPF', () => {
  const masked = redactForAi(
    'fone 5511987654321, antigo 551187654321, (11) 98765-4321, +55 11 98765-4321, 98765-4321, '
    + 'mail cliente.teste+1@exemplo.com.br, cpf 123.456.789-09 e 12345678909',
  );
  assert.equal(
    masked,
    'fone [telefone], antigo [telefone], [telefone], [telefone], [telefone], mail [email], cpf [cpf] e [cpf]',
  );
});

test('redactForAi não mascara semanas, datas nem valores', () => {
  const text = 'Estou com 32 semanas, pode ser dia 15/10? O pacote de R$ 1.500 ou R$ 1.500,00 em 2026-09-19';
  assert.equal(redactForAi(text), text);
});

// ── histórico e turnos ──────────────────────────────────────────────────────

test('toAgentMessages mapeia cada tipo, tira vazios e reações e define o papel', () => {
  const messages = toAgentMessages([
    row(false, '', 'audio', 0),
    row(false, null, 'audio', 1, 'quero saber dos pacotes'),
    row(false, null, 'image', 2),
    row(false, 'RG.pdf', 'document', 3),
    row(true, 'Pacotes.pdf', 'document', 4),
    row(true, null, 'document', 5),
    row(false, null, 'video', 6),
    row(false, null, 'sticker', 7),
    row(false, null, 'unsupported', 8),
    row(false, '❤️', 'reaction', 9),
    row(false, '   ', 'text', 10),
    row(false, 'sem tipo', null, 11),
    row(true, 'texto do estúdio', 'text', 12),
  ]);
  assert.deepEqual(messages, [
    { role: 'user', content: '[áudio]' },
    { role: 'user', content: 'quero saber dos pacotes' },
    { role: 'user', content: '[imagem]' },
    { role: 'user', content: '[documento: RG.pdf]' },
    { role: 'assistant', content: '[documento enviado: Pacotes.pdf]' },
    { role: 'assistant', content: '[documento enviado]' },
    { role: 'user', content: '[vídeo]' },
    { role: 'user', content: '[figurinha]' },
    { role: 'user', content: '[mensagem não suportada]' },
    { role: 'user', content: 'sem tipo' },
    { role: 'assistant', content: 'texto do estúdio' },
  ]);
});

test('toAgentMessages põe em ordem cronológica quando os horários são válidos', () => {
  const messages = toAgentMessages([row(true, 'segunda', 'text', 5), row(false, 'primeira', 'text', 1)]);
  assert.deepEqual(messages.map((m) => m.content), ['primeira', 'segunda']);
});

test('histórico que começa pelo estúdio ganha o prefixo e a diretiva é o último turno', async () => {
  const { deps, calls } = fakeDeps(['Oi, Maria! Vamos ver uma data para as suas fotos?']);
  await generateCadenceDraft(baseInput(), deps);
  assert.equal(calls.length, 1);
  const turns = calls[0].messages;
  assert.deepEqual(turns[0], { role: 'user', content: HISTORY_START_NOTE });
  assert.equal(turns[1].role, 'assistant');
  assert.equal(turns[3].content, '[documento enviado: Pacotes Gestante.pdf]');
  const directive = lastTurn(calls[0]);
  assert.equal(directive.role, 'user');
  assert.ok(directive.content.startsWith(
    '[NOTA DO SISTEMA - NÃO é mensagem do cliente. Retomada 1 de 4. Primeiro nome: Maria. Nicho: gestante.]',
  ));
  assert.ok(directive.content.includes(STEP_DIRECTIVES[1]));
  assert.equal(turns.length, 6);
});

test('histórico que começa pelo cliente não ganha prefixo', async () => {
  const { deps, calls } = fakeDeps(['Oi, Maria! Vamos ver uma data para as suas fotos?']);
  await generateCadenceDraft(baseInput({ rows: [row(false, 'Oi, quero orçamento', 'text', 0), row(true, 'Claro! Te mando já', 'text', 1)] }), deps);
  assert.deepEqual(calls[0].messages.map((m) => m.role), ['user', 'assistant', 'user']);
  assert.notEqual(calls[0].messages[0].content, HISTORY_START_NOTE);
});

test('diretiva usa o nome e o nicho desconhecidos quando faltam dados', async () => {
  const { deps, calls } = fakeDeps(['Oi! Conseguiu dar uma olhada no que te mandei?']);
  await generateCadenceDraft(baseInput({ contactName: '5511987654321', rows: [row(false, 'Oi', 'text', 0), row(true, 'Oi! Como posso ajudar?', 'text', 1)], step: 2 }), deps);
  assert.ok(lastTurn(calls[0]).content.startsWith(
    '[NOTA DO SISTEMA - NÃO é mensagem do cliente. Retomada 2 de 4. Primeiro nome: desconhecido. Nicho: desconhecido.]',
  ));
});

test('as 4 diretivas são distintas', () => {
  const texts = new Set([1, 2, 3, 4].map((step) => STEP_DIRECTIVES[step as 1 | 2 | 3 | 4]));
  assert.equal(texts.size, 4);
});

// ── LGPD: nada pessoal chega à IA ───────────────────────────────────────────

test('getReplyDetailed recebe mensagens e configuração já mascaradas', async () => {
  const { deps, calls } = fakeDeps(['Oi, Maria! Vamos ver uma data para as suas fotos?'], 'Exemplo aprovado: cliente 11 98765-4321');
  const input = baseInput({
    rows: [
      row(false, 'Meu zap novo é 5511987654321 e o e-mail cliente.teste@exemplo.com.br', 'text', 0),
      row(false, null, 'audio', 1, 'meu cpf é 123.456.789-09 e o fixo (11) 98765-4321'),
      row(true, 'Anotado! Te mando os pacotes', 'text', 2),
    ],
    userInstruction: 'Se precisar, confirme o e-mail cliente.teste@exemplo.com.br',
    extraInstructions: 'Nunca cite o número 551187654321',
    agent: { ...baseInput().agent, knowledge: 'Pacote Essencial com 20 fotos. Contato do estúdio 11 98765-4321.' },
  });
  await generateCadenceDraft(input, deps);
  const payload = JSON.stringify(calls[0]);
  for (const secret of ['5511987654321', '551187654321', '98765-4321', '98765432', 'exemplo.com', '123.456.789-09']) {
    assert.ok(!payload.includes(secret), `vazou ${secret}`);
  }
  assert.doesNotMatch(payload, /9\d{4}-?\d{4}/);
  assert.match(payload, /\[telefone\]/);
  assert.match(payload, /\[email\]/);
  assert.match(payload, /\[cpf\]/);
});

// ── configuração e instrução extra ──────────────────────────────────────────

test('AgentConfig vem do ai_agent_config com memória supervisionada e portfólio do nicho', async () => {
  const links = [
    { label: 'Geral', url: 'https://exemplo.com/portfolio', niche: 'geral' },
    { label: 'Gestante', url: 'https://exemplo.com/gestante', niche: 'gestante' },
    { label: 'Casal', url: 'https://exemplo.com/casal', niche: 'casal' },
  ];
  const { deps, calls, memoryCalls } = fakeDeps(['Oi, Maria! Vamos ver uma data para as suas fotos?']);
  await generateCadenceDraft(baseInput({ agent: { ...baseInput().agent, portfolio_links: links } }), deps);
  const config = calls[0].config;
  assert.equal(config.enabled, true);
  assert.equal(config.persona, 'Tom carinhoso e direto');
  assert.equal(config.attendantName, 'Aurora');
  assert.equal(config.salesStrategy, '');
  assert.equal(config.supervisedMemory, 'Sempre chamar pelo primeiro nome.');
  assert.deepEqual(config.portfolioLinks?.map((l) => l.niche), ['geral', 'gestante']);
  assert.deepEqual(memoryCalls, [['user-1', '5511900000000']]);
});

test('extraInstruction é a instrução de retomada, com as do estúdio e sem o hand-off autônomo', async () => {
  const { deps, calls } = fakeDeps(['Oi, Maria! Vamos ver uma data para as suas fotos?', 'Oi, Maria! Vamos ver uma data para as suas fotos?']);
  await generateCadenceDraft(baseInput({ extraInstructions: '  Fale sempre no feminino  ' }), deps);
  await generateCadenceDraft(baseInput(), deps);
  assert.equal(calls[0].opts.extraInstruction, `${FOLLOWUP_INSTRUCTION}\nInstruções do estúdio: Fale sempre no feminino`);
  assert.equal(calls[1].opts.extraInstruction, FOLLOWUP_INSTRUCTION);
  for (const call of calls) {
    assert.ok(!String(call.opts.extraInstruction).includes(HANDOFF_INSTRUCTION));
    assert.ok(!String(call.opts.extraInstruction).includes('ENVIAR PACOTE'));
  }
  assert.ok(FOLLOWUP_INSTRUCTION.includes('###SKIP###'));
});

// ── interpretação ───────────────────────────────────────────────────────────

test('###SKIP### vira skip sem texto', async () => {
  const { deps } = fakeDeps(['###SKIP###']);
  const result = await generateCadenceDraft(baseInput(), deps);
  assert.equal(result.kind, 'skip');
  assert.equal((result as { reason: string }).reason, 'ai_skip');
});

test('###HUMANO:motivo### vira handoff com o motivo', async () => {
  const pagamento = await generateCadenceDraft(baseInput(), fakeDeps(['###HUMANO:pagamento###']).deps);
  assert.deepEqual([pagamento.kind, (pagamento as { reason: string }).reason], ['handoff', 'pagamento']);
  const semMotivo = await generateCadenceDraft(baseInput(), fakeDeps(['###HUMANO###']).deps);
  assert.deepEqual([semMotivo.kind, (semMotivo as { reason: string }).reason], ['handoff', 'duvida']);
});

test('###PDF### nunca sobrevive e gera o aviso', async () => {
  const { deps } = fakeDeps(['Oi, Maria! Conseguiu dar uma olhada nos pacotes?\n\n###PDF:gestante###']);
  const draft = asDraft(await generateCadenceDraft(baseInput(), deps));
  assert.equal(draft.text, `Oi, Maria! Conseguiu dar uma olhada nos pacotes?\n\n${SCHEDULING_ASK_FALLBACK}`);
  assert.ok(!draft.text.includes('#'));
  assert.ok(draft.warnings.includes('pdf_removido'));
});

test('resposta que vira vazia depois da limpeza é skip empty', async () => {
  const { deps } = fakeDeps(['"###PDF:gestante###"']);
  const result = await generateCadenceDraft(baseInput(), deps);
  assert.equal(result.kind, 'skip');
  assert.equal((result as { reason: string }).reason, 'empty');
  assert.ok((result as { meta: { warnings: string[] } }).meta.warnings.includes('pdf_removido'));
});

test('link fora do portfólio aprovado vira handoff duvida com aviso', async () => {
  const links = [{ label: 'Geral', url: 'https://exemplo.com/portfolio', niche: 'geral' }];
  const input = baseInput({ agent: { ...baseInput().agent, portfolio_links: links } });
  const bad = await generateCadenceDraft(input, fakeDeps(['Olha esse ensaio https://outro-site.com/x']).deps);
  assert.equal(bad.kind, 'handoff');
  assert.equal((bad as { reason: string }).reason, 'duvida');
  assert.ok((bad as { meta: { warnings: string[] } }).meta.warnings.includes('link_nao_aprovado'));
  const good = asDraft(await generateCadenceDraft(input, fakeDeps(['Separei esse trabalho https://exemplo.com/portfolio']).deps));
  assert.ok(!good.warnings.includes('link_nao_aprovado'));
});

// ── limpeza ─────────────────────────────────────────────────────────────────

test('cleanFollowupText tira rótulo, aspas, markdown, tokens e assinatura', () => {
  const cleaned = cleanFollowupText('Mensagem: "Oi, **Maria**! Conseguiu ver os pacotes?\n\n\n\n###PDF:gestante###\n- Aurora"', 1);
  assert.deepEqual(cleaned, { text: 'Oi, *Maria*! Conseguiu ver os pacotes?', warnings: ['pdf_removido'] });
  assert.equal(cleanFollowupText('“Retomada: Oi, Maria!”', 4).text, 'Oi, Maria!');
  assert.equal(cleanFollowupText(`Oi, Maria!\n\n\n\nFico por aqui   \n${EM_DASH} Equipe`, 4).text, 'Oi, Maria!\n\nFico por aqui');
});

test('cleanFollowupText separa o dois-pontos antes da pergunta', () => {
  assert.equal(
    cleanFollowupText('Oi, Maria! Fiquei pensando numa coisa: você viu os pacotes?', 2).text,
    'Oi, Maria! Fiquei pensando numa coisa\n\nVocê viu os pacotes?',
  );
});

test('cleanFollowupText deixa uma pergunta nos passos 1 a 3 e não mexe no passo 4', () => {
  const text = 'Conseguiu ver os pacotes?\n\nQual chamou mais atenção?';
  assert.equal(cleanFollowupText(text, 1).text, 'Conseguiu ver os pacotes?');
  assert.equal(cleanFollowupText(text, 3).text, 'Conseguiu ver os pacotes?');
  assert.equal(cleanFollowupText(text, 4).text, text);
});

test('aspas internas não são arrancadas', () => {
  const text = '"Essencial" ou "Completo"';
  assert.equal(cleanFollowupText(text, 4).text, text);
});

// ── avisos ──────────────────────────────────────────────────────────────────

test('draftWarnings acusa cada padrão proibido', () => {
  const cases: Array<[string, string]> = [
    ['O pacote sai por R$ 1.500', 'preco'],
    ['Fica 150 reais a menos', 'preco'],
    ['Consigo 10% no pix', 'percentual'],
    ['Tenho um desconto pra você', 'desconto'],
    ['Essa promoção acaba logo', 'desconto'],
    ['Que tal no dia 15', 'data'],
    ['Pode ser 15/10', 'data'],
    ['Pode ser 3 de outubro', 'data'],
    ['Às 14h fica bom', 'horario'],
    ['Às 14:30 fica bom', 'horario'],
    ['Restam poucas vagas', 'vaga'],
    ['São as últimas datas do mês', 'vaga'],
    ['Essa é uma mensagem automática', 'revela_automacao'],
    ['Sou uma IA do estúdio', 'revela_automacao'],
    ['Você sumiu', 'tempo_decorrido'],
    ['Faz dias que não falamos', 'tempo_decorrido'],
    ['Uma dica rápida: aproveite', 'dois_pontos'],
    ['São 45 fotos no total', 'numero_nao_verificado'],
  ];
  for (const [text, warning] of cases) {
    assert.ok(draftWarnings(text, 'Base sem números', '').includes(warning as never), `${text} deveria gerar ${warning}`);
  }
});

test('draftWarnings não acusa texto limpo, dia relativo nem número dito pela cliente ou na base', () => {
  assert.deepEqual(draftWarnings('Oi, Maria! Conseguiu dar uma olhada nos pacotes? 🥰', 'Base', ''), []);
  assert.deepEqual(draftWarnings('Amanhã ou segunda fica melhor pra você?', 'Base', ''), []);
  assert.deepEqual(draftWarnings('Com 32 semanas é um momento lindo para fotografar', 'Base', 'estou com 32 semanas'), []);
  assert.deepEqual(draftWarnings('O Essencial vem com 20 fotos editadas', 'Pacote Essencial com 20 fotos editadas.', ''), []);
  assert.deepEqual(draftWarnings('Veja o link https://exemplo.com/portfolio', 'Base', ''), []);
});

test('limites geram aviso sem cortar o texto', async () => {
  assert.deepEqual(limitWarnings('a'.repeat(280), 1), []);
  assert.deepEqual(limitWarnings('a'.repeat(281), 1), ['longo']);
  assert.deepEqual(limitWarnings('a'.repeat(420), 2), []);
  assert.deepEqual(limitWarnings('a'.repeat(321), 4), ['longo']);
  assert.deepEqual(limitWarnings('um\n\ndois\n\ntrês', 4), ['muitos_baloes']);
  const long = `Oi, Maria! ${'Fiquei pensando no seu ensaio e no quanto essa fase é especial. '.repeat(5).trim()}`;
  const draft = asDraft(await generateCadenceDraft(baseInput(), fakeDeps([long]).deps));
  assert.equal(draft.text, `${long}\n\n${SCHEDULING_ASK_FALLBACK}`);
  assert.ok(draft.warnings.includes('longo'));
});

test('acima de 700 caracteres gera de novo uma vez', async () => {
  const huge = `Oi, Maria! ${'Fiquei pensando no seu ensaio. '.repeat(30)}`;
  const { deps, calls } = fakeDeps([huge, 'Oi, Maria! Vamos ver uma data para as suas fotos?']);
  const draft = asDraft(await generateCadenceDraft(baseInput(), deps));
  assert.equal(calls.length, 2);
  assert.match(lastTurn(calls[1]).content, /longa demais/);
  assert.equal(lastTurn(calls[1]).role, 'user');
  assert.equal(draft.text, 'Oi, Maria! Vamos ver uma data para as suas fotos?');
  assert.equal(draft.meta.latency_ms, 240);
  assert.ok(Math.abs((draft.meta.cost_usd ?? 0) - 0.004) < 1e-9);
});

test('acima de 700 caracteres duas vezes vira erro retentável', async () => {
  const huge = `Oi, Maria! ${'Fiquei pensando no seu ensaio. '.repeat(30)}`;
  const { deps, calls } = fakeDeps([huge, huge]);
  const result = await generateCadenceDraft(baseInput(), deps);
  assert.equal(calls.length, 2);
  assert.equal(result.kind, 'error');
  assert.equal((result as { retryable: boolean }).retryable, true);
});

// ── basis invisível, reação e instrução do usuário ──────────────────────────

test('basis invisível entra na diretiva com o horário de Brasília', async () => {
  const { deps, calls } = fakeDeps(['Oi, Maria! Ficou alguma dúvida?']);
  await generateCadenceDraft(baseInput({ invisible: { basis: true, at: '2026-09-19T14:05:00Z', read: true } }), deps);
  const directive = lastTurn(calls[0]).content;
  assert.ok(directive.includes(
    '[ATENÇÃO: o atendimento automático oficial do WhatsApp respondeu em 19/09 11:05 BRT e o texto dessa resposta NÃO está disponível. Não contradiga, não cite números nem detalhes; retome de forma geral.]',
  ));
  assert.ok(invisibleBasisNote(null).startsWith('[ATENÇÃO: o atendimento automático oficial do WhatsApp respondeu e o texto'));
});

test('reação depois do basis entra na diretiva e gera o aviso', async () => {
  const { deps, calls } = fakeDeps(['Oi, Maria! Ficou alguma dúvida?']);
  const draft = asDraft(await generateCadenceDraft(baseInput({ customerReactedAfterBasis: true, userInstruction: 'Cite o álbum' }), deps));
  const directive = lastTurn(calls[0]).content;
  assert.ok(directive.includes(REACTION_NOTE));
  assert.ok(directive.endsWith('Instrução do estúdio para esta versão: Cite o álbum'));
  assert.ok(draft.warnings.includes('reacao_cliente'));
  assert.deepEqual(draft.meta.warnings, draft.warnings);
  const skip = await generateCadenceDraft(baseInput({ customerReactedAfterBasis: true }), fakeDeps(['###SKIP###']).deps);
  assert.ok((skip as { meta: { warnings: string[] } }).meta.warnings.includes('reacao_cliente'));
});

test('sem reação e sem basis invisível a diretiva não traz avisos extras', async () => {
  const { deps, calls } = fakeDeps(['Oi, Maria! Ficou alguma dúvida?']);
  const draft = asDraft(await generateCadenceDraft(baseInput(), deps));
  assert.ok(!lastTurn(calls[0]).content.includes('ATENÇÃO'));
  assert.deepEqual(draft.warnings, []);
});

// ── meta e erros ────────────────────────────────────────────────────────────

test('meta vem preenchida', async () => {
  const { deps } = fakeDeps(['Oi, Maria! Vamos ver uma data para as suas fotos?']);
  const draft = asDraft(await generateCadenceDraft(baseInput(), deps));
  assert.deepEqual(draft.meta, {
    version: FOLLOWUP_DIRECTIVE_VERSION,
    model: 'gpt-test',
    latency_ms: 120,
    usage: { input_tokens: 10, output_tokens: 5 },
    cost_usd: 0.002,
    niche: 'gestante',
    messages_used: 4,
    warnings: [],
    generated_at: NOW.toISOString(),
  });
  assert.equal(FOLLOWUP_DIRECTIVE_VERSION, 'v2');
});

test('sem base de conhecimento é erro não retentável e não chama a IA', async () => {
  for (const knowledge of [null, '', '   base curta    ']) {
    const { deps, calls, memoryCalls } = fakeDeps(['x']);
    const result = await generateCadenceDraft(baseInput({ agent: { ...baseInput().agent, knowledge } }), deps);
    assert.deepEqual(result, { kind: 'error', retryable: false, message: NO_KNOWLEDGE_MESSAGE });
    assert.equal(calls.length, 0);
    assert.equal(memoryCalls.length, 0);
  }
});

test('exceção da IA ou da memória é erro retentável', async () => {
  const ai = await generateCadenceDraft(baseInput(), fakeDeps([new Error('timeout')]).deps);
  assert.equal(ai.kind, 'error');
  assert.equal((ai as { retryable: boolean }).retryable, true);
  const { deps } = fakeDeps(['x']);
  deps.loadSupervisedMemory = async () => { throw new Error('banco fora'); };
  const memory = await generateCadenceDraft(baseInput(), deps);
  assert.equal(memory.kind, 'error');
  assert.equal((memory as { retryable: boolean }).retryable, true);
});

test('sem nenhuma fala legível não chama a IA', async () => {
  const { deps, calls } = fakeDeps(['x']);
  const result = await generateCadenceDraft(baseInput({ rows: [row(false, '👍', 'reaction', 0), row(true, '', 'text', 1)] }), deps);
  assert.equal(result.kind, 'skip');
  assert.equal((result as { reason: string }).reason, 'no_history');
  assert.equal(calls.length, 0);
});

// ── gancho do template ──────────────────────────────────────────────────────

test('toTemplateHook tira a saudação, junta os balões e não tem quebra de linha', () => {
  assert.equal(
    toTemplateHook('Oi, Maria! Conseguiu dar uma olhada nos pacotes?\n\nQualquer coisa\testou por   aqui', 1),
    'Conseguiu dar uma olhada nos pacotes? Qualquer coisa estou por aqui',
  );
  assert.equal(toTemplateHook('Olá Maria, lembrei de você e do seu ensaio hoje', 2), 'Lembrei de você e do seu ensaio hoje');
  assert.equal(toTemplateHook('Oito fotos editadas fazem parte do pacote', 2), 'Oito fotos editadas fazem parte do pacote');
});

test('toTemplateHook corta na pontuação ou na palavra, até 180 caracteres', () => {
  const sentences = `Fiquei pensando no seu ensaio. ${'Essa fase passa rápido e merece ser guardada com carinho. '.repeat(4)}`;
  const byStop = toTemplateHook(sentences, 2);
  assert.ok(byStop.length <= 180);
  assert.ok(byStop.endsWith('.'));
  const words = toTemplateHook(`Oi Maria, ${'palavra '.repeat(40)}`, 2);
  assert.ok(words.length <= 180);
  assert.ok(words.endsWith('…'));
  assert.ok(!/\s…$/.test(words));
});

test('toTemplateHook curto usa a frase neutra do passo', () => {
  for (const step of [1, 2, 3, 4] as const) {
    assert.equal(toTemplateHook('Oi, Maria!', step), NEUTRAL_HOOKS[step]);
    assert.ok(NEUTRAL_HOOKS[step].length >= 20 && NEUTRAL_HOOKS[step].length <= 180);
    assert.deepEqual(draftWarnings(NEUTRAL_HOOKS[step], '', ''), []);
  }
});

test('firstName pega o primeiro nome em Title Case', () => {
  assert.equal(firstName('maria clara'), 'Maria');
  assert.equal(firstName('🌸 ANA souza'), 'Ana');
  assert.equal(firstName('~ana-luiza'), 'Ana-Luiza');
  assert.equal(firstName('José Silva'), 'José');
  assert.equal(firstName('Jo'), null);
  assert.equal(firstName('5511987654321'), null);
  assert.equal(firstName('Ana2'), null);
  assert.equal(firstName(null), null);
  assert.equal(firstName('   '), null);
});

// ── prévia ──────────────────────────────────────────────────────────────────

test('contextTail guarda as últimas 8 falas, sem máscara e com corpo até 280', () => {
  const rows = Array.from({ length: 10 }, (_, i) => row(i % 2 === 0, `mensagem ${i}`, 'text', i));
  rows.push(row(false, '❤️', 'reaction', 20));
  rows.push(row(false, `meu fone 5511987654321 ${'x'.repeat(400)}`, 'text', 21));
  rows.push(row(false, null, 'audio', 22));
  const tail = contextTail(rows);
  assert.equal(tail.length, 8);
  const last = tail[tail.length - 1];
  assert.deepEqual(last, { from_me: false, body: '[áudio]', type: 'audio', timestamp: rows[12].timestamp });
  const long = tail[tail.length - 2];
  assert.ok(long.body.includes('5511987654321'));
  assert.equal(long.body.length, 280);
  assert.ok(tail.every((m) => m.type !== 'reaction'));
  assert.equal(contextTail(rows, 3).length, 3);
  assert.equal(contextTail(rows, 50).length, 8);
  assert.deepEqual(contextTail(rows, 0), []);
});

// ── regras de código ────────────────────────────────────────────────────────

test('ai-agent só entra como tipo e o hand-off autônomo não é usado', () => {
  const source = readFileSync(new URL('./followup-draft.ts', import.meta.url), 'utf8');
  const aiAgentImports = source.split('\n').filter((line) => line.includes("from './ai-agent.js'"));
  assert.ok(aiAgentImports.length > 0);
  assert.ok(aiAgentImports.every((line) => line.startsWith('import type ')));
  assert.ok(!source.includes('HANDOFF_INSTRUCTION'));
  assert.ok(!DASH_PATTERN.test(source), 'o código não pode ter travessão literal');
  const testSource = readFileSync(new URL('./followup-draft.test.ts', import.meta.url), 'utf8');
  assert.ok(!DASH_PATTERN.test(testSource), 'o teste não pode ter travessão literal');
});

test('textos fixos não têm travessão', () => {
  const texts = [
    FOLLOWUP_INSTRUCTION, HISTORY_START_NOTE, REACTION_NOTE, NO_KNOWLEDGE_MESSAGE,
    invisibleBasisNote('2026-09-19T14:05:00Z'),
    ...Object.values(STEP_DIRECTIVES), ...Object.values(NEUTRAL_HOOKS),
    ...Object.values(PRE_QUOTE_DIRECTIVES), ...Object.values(PRE_QUOTE_NEUTRAL_HOOKS),
  ];
  for (const text of texts) assert.ok(!DASH_PATTERN.test(text), text);
});

// ── Trilha antes do orçamento ───────────────────────────────────────────────

const PRE_QUOTE_ROWS = [
  row(false, 'Oi! Queria saber como funciona o ensaio', 'text', 0),
  row(true, 'Oi! Que bom que chamou. Qual tipo de ensaio você está pensando?', 'text', 1),
];

test('antes do orçamento: toque 1 retoma a pergunta que ficou no ar, sem preço, sem PDF e sem data', async () => {
  const { deps, calls } = fakeDeps(['Oi, Maria! Me conta que tipo de ensaio você tem em mente?']);
  const result = asDraft(await generateCadenceDraft(baseInput({ track: 'pre_quote', trackSteps: 2, rows: PRE_QUOTE_ROWS }), deps));
  const directive = lastTurn(calls[0]).content;
  assert.ok(directive.startsWith('[NOTA DO SISTEMA - NÃO é mensagem do cliente. Retomada antes do orçamento, toque 1 de 2. Primeiro nome: Maria.'));
  assert.ok(directive.includes(PRE_QUOTE_DIRECTIVES[1]));
  assert.ok(!directive.includes(STEP_DIRECTIVES[1]), 'não usa a diretiva da escada (que fala de orçamento enviado)');
  assert.match(PRE_QUOTE_DIRECTIVES[1], /pergunta/);
  assert.match(PRE_QUOTE_DIRECTIVES[1], /Uma pergunta só/);
  for (const text of Object.values(PRE_QUOTE_DIRECTIVES)) {
    assert.match(text, /não cite preço/);
    assert.match(text, /não mande PDF/);
    assert.match(text, /não invente data/);
    assert.match(text, /###SKIP###/);
  }
  assert.equal(result.text, `Oi, Maria! Me conta que tipo de ensaio você tem em mente?\n\n${SCHEDULING_ASK_FALLBACK}`);
  assert.deepEqual(result.warnings, []);
});

test('antes do orçamento: toque 2 convida a escolher o momento; com um toque só, o 1º NÃO é despedida', async () => {
  const { deps, calls } = fakeDeps(['Oi, Maria! Você pensa em fazer as fotos em algum mês?']);
  await generateCadenceDraft(baseInput({ track: 'pre_quote', step: 2, trackSteps: 2, rows: PRE_QUOTE_ROWS }), deps);
  assert.ok(lastTurn(calls[0]).content.includes('toque 2 de 2'));
  assert.ok(lastTurn(calls[0]).content.includes(PRE_QUOTE_DIRECTIVES[2]));
  assert.match(PRE_QUOTE_DIRECTIVES[2], /Sem cobrança/);
  // O dono recusou a despedida passiva: nem o último toque termina com
  // "me chama quando quiser": ele pergunta quando faria sentido fazer as fotos.
  assert.match(PRE_QUOTE_DIRECTIVES[2], /Não se despeça de forma passiva/);
  // Com UM toque só configurado, esse toque é a primeira retomada, não a última.
  const single = fakeDeps(['Oi, Maria! Vamos ver uma data para as suas fotos?']);
  await generateCadenceDraft(baseInput({ track: 'pre_quote', step: 1, trackSteps: 1, rows: PRE_QUOTE_ROWS }), single.deps);
  assert.ok(lastTurn(single.calls[0]).content.includes('toque 1 de 1'));
  assert.ok(lastTurn(single.calls[0]).content.includes(PRE_QUOTE_DIRECTIVES[1]));
  assert.ok(!lastTurn(single.calls[0]).content.includes(PRE_QUOTE_DIRECTIVES[2]));
});

test('toda retomada puxa a data: nenhuma diretiva manda esperar o cliente chamar', () => {
  const todas = [STEP_DIRECTIVES[1], STEP_DIRECTIVES[2], STEP_DIRECTIVES[3], STEP_DIRECTIVES[4],
    PRE_QUOTE_DIRECTIVES[1], PRE_QUOTE_DIRECTIVES[2]];
  for (const texto of todas) {
    assert.match(texto, /data|período|mês|semana|momento/i);
  }
  // O gancho do template (usado quando o rascunho é curto) segue a mesma regra.
  assert.match(NEUTRAL_HOOKS[1], /data/i);
  assert.match(PRE_QUOTE_NEUTRAL_HOOKS[1], /data/i);
});

test('antes do orçamento: ###SKIP### continua valendo e toque 4 é inválido', async () => {
  const { deps } = fakeDeps(['###SKIP###']);
  const skipped = await generateCadenceDraft(baseInput({ track: 'pre_quote', rows: PRE_QUOTE_ROWS }), deps);
  assert.equal(skipped.kind, 'skip');
  const invalid = fakeDeps(['Oi']);
  const result = await generateCadenceDraft(baseInput({ track: 'pre_quote', step: 4, rows: PRE_QUOTE_ROWS }), invalid.deps);
  assert.equal(result.kind, 'error');
  assert.equal((result as { retryable: boolean }).retryable, false);
  assert.equal(invalid.calls.length, 0);
});

test('antes do orçamento com 3 toques (087): o do meio retoma como o 1º e só o 3º usa o texto do último toque', async () => {
  for (const [step, directive] of [[1, 1], [2, 1], [3, 2]] as const) {
    const { deps, calls } = fakeDeps(['Oi, Maria! Você pensa em fazer as fotos em algum mês?']);
    const result = await generateCadenceDraft(baseInput({ track: 'pre_quote', step, trackSteps: 3, rows: PRE_QUOTE_ROWS }), deps);
    assert.equal(result.kind, 'draft', `toque ${step}`);
    const content = lastTurn(calls[0]).content;
    assert.ok(content.includes(`toque ${step} de 3`), `toque ${step}`);
    assert.ok(content.includes(PRE_QUOTE_DIRECTIVES[directive]), `toque ${step}`);
  }
});

test('antes do orçamento: limite de 280 caracteres no toque 2 e gancho neutro da trilha', async () => {
  const long = `Oi, Maria! ${'Quando fizer sentido para você, é só me chamar. '.repeat(6)}`.trim();
  const { deps } = fakeDeps([long]);
  const draft = asDraft(await generateCadenceDraft(baseInput({ track: 'pre_quote', step: 2, rows: PRE_QUOTE_ROWS }), deps));
  assert.ok(draft.text.length > 280 && draft.text.length <= 420);
  assert.ok(draft.warnings.includes('longo'));
  for (const step of [1, 2] as const) {
    assert.equal(toTemplateHook('Oi, Maria!', step, undefined, 'pre_quote'), PRE_QUOTE_NEUTRAL_HOOKS[step]);
    assert.doesNotMatch(PRE_QUOTE_NEUTRAL_HOOKS[step], /pacote|or[cç]amento|valor/i);
    assert.deepEqual(draftWarnings(PRE_QUOTE_NEUTRAL_HOOKS[step], '', ''), []);
  }
  assert.equal(toTemplateHook('Oi, Maria!', 2), NEUTRAL_HOOKS[2], 'sem trilha continua a escada');
});

test('rascunho sem convite de data e refeito uma vez e, se faltar de novo, ganha a pergunta', async () => {
  const semData = 'Oi, Maria! Conseguiu ver as opções?';
  const { deps, calls } = fakeDeps([semData, semData]);
  const draft = asDraft(await generateCadenceDraft(baseInput(), deps));
  assert.equal(calls.length, 2, 'refaz uma vez quando falta o convite');
  assert.match(lastTurn(calls[1]).content, /ÚLTIMA frase precisa ser uma pergunta sobre a data/);
  assert.equal(draft.text, `${semData}\n\n${SCHEDULING_ASK_FALLBACK}`);
  assert.ok(asksAboutScheduling(draft.text));

  // Com o convite já na 1a versão, nada é refeito nem acrescentado.
  const comData = 'Oi, Maria! Qual período combina melhor para o seu ensaio?';
  const ok = fakeDeps([comData]);
  const direto = asDraft(await generateCadenceDraft(baseInput(), ok.deps));
  assert.equal(ok.calls.length, 1);
  assert.equal(direto.text, comData);
});

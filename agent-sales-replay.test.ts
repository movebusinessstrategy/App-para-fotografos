import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evaluateSalesReplayTurn,
  groupSalesReplayTurns,
  inferCommercialQuestionTopic,
  inferHumanReplayAction,
  redactSalesReplayMessages,
  selectConvertedSalesEpisode,
  summarizeSalesReplayTotals,
  type RawSalesReplayMessage,
  type RedactedSalesReplayMessage,
} from './agent-sales-replay.js';

const raw = (
  id: string,
  timestamp: string,
  fromMe: boolean,
  body: string,
  type = 'text',
): RawSalesReplayMessage => ({ id, timestamp, from_me: fromMe, body, type });

const redacted = (
  role: RedactedSalesReplayMessage['role'],
  content: string,
  minute: number,
  type = 'text',
): RedactedSalesReplayMessage => ({
  role,
  content,
  type,
  timestamp: `2026-06-10T10:${String(minute).padStart(2, '0')}:00.000Z`,
});

test('seleciona, ordena e deduplica o episódio que contém a conversão', () => {
  const convertedAt = '2026-06-10T12:00:00.000Z';
  const messages = [
    raw('after-limit', '2026-06-11T12:00:01.000Z', true, 'Fora do episódio'),
    raw('current-2', '2026-06-10T11:00:00.000Z', true, 'Resposta'),
    raw('old', '2026-04-01T10:00:00.000Z', false, 'Conversa antiga'),
    raw('current-1', '2026-06-10T10:00:00.000Z', false, 'Nova conversa'),
    raw('current-1', '2026-06-10T10:00:00.000Z', false, 'Nova conversa duplicada'),
    raw('after', '2026-06-11T11:59:59.000Z', true, 'Confirmação após a venda'),
  ];

  assert.deepEqual(
    selectConvertedSalesEpisode(messages, convertedAt, '2026-06-11T12:00:00.000Z').map((message) => message.id),
    ['current-1', 'current-2', 'after'],
  );
});

test('anonimiza dados estruturados, identificadores comuns, links e mídia', () => {
  const messages: RawSalesReplayMessage[] = [
    {
      id: 'customer',
      timestamp: '2026-06-10T10:00:00.000Z',
      from_me: false,
      type: 'text',
      body: 'Sou Marina Alves, @marina. Meu CPF é 123.456.789-01, CEP 12345-678, telefone (11) 98765-4321 e marina@example.com. Veja https://example.com/perfil',
    },
    {
      id: 'audio',
      timestamp: '2026-06-10T10:01:00.000Z',
      from_me: false,
      type: 'audio',
      transcription: 'Marina Alves quer o ensaio.',
      media_url: 'https://storage.example.com/segredo.ogg',
    },
    {
      id: 'document',
      timestamp: '2026-06-10T10:02:00.000Z',
      from_me: true,
      type: 'document',
      body: 'Pacotes em www.example.com/pacotes.pdf',
      media_url: 'https://storage.example.com/pacotes.pdf',
    },
  ];

  const result = redactSalesReplayMessages(messages, [{ value: 'Marina Alves', label: 'nome da cliente' }]);
  const combined = result.map((message) => message.content).join('\n');

  assert.match(combined, /\[nome da cliente\]/);
  assert.match(combined, /\[CPF\]/);
  assert.match(combined, /\[CEP\]/);
  assert.match(combined, /\[telefone\]/);
  assert.match(combined, /\[e-mail\]/);
  assert.match(combined, /\[perfil\]/);
  assert.match(combined, /\[link\]/);
  assert.match(combined, /\[áudio transcrito pela cliente\]/);
  assert.match(combined, /\[documento enviado pelo estúdio\]/);
  assert.doesNotMatch(combined, /storage\.example|marina@example|98765|123\.456/);
  assert.deepEqual(Object.keys(result[0]).sort(), ['content', 'role', 'timestamp', 'type']);
});

test('oculta data, horário e nome de arquivo sem perder o tipo de pacote', () => {
  const result = redactSalesReplayMessages([
    raw('schedule', '2026-06-10T10:00:00.000Z', true, 'Tenho dia 26 às 15h30'),
    raw('package', '2026-06-10T10:01:00.000Z', true, 'Maria - GESTANTE 2026.pdf', 'document'),
  ]);
  const combined = result.map((message) => message.content).join('\n');

  assert.match(combined, /dia \[data\]/);
  assert.match(combined, /\[horário\]/);
  assert.match(combined, /\[pacote gestante\]/);
  assert.doesNotMatch(combined, /Maria|15h30|dia 26/);
});

test('anonimização de nome curto não apaga parte de outras palavras', () => {
  const [result] = redactSalesReplayMessages([
    raw('customer', '2026-06-10T10:00:00.000Z', false, 'Ana está com 28 semanas.'),
  ], [{ value: 'Ana', label: 'nome' }]);

  assert.equal(result.content, '[nome] está com 28 semanas.');
});

test('anonimiza campos de cadastro mesmo quando o valor não existe na ficha', () => {
  const [result] = redactSalesReplayMessages([
    raw(
      'form',
      '2026-06-10T10:00:00.000Z',
      false,
      'NOME: Pessoa CPF: 12345678901 DATA DE NASCIMENTO: 10/01/1990 EMAIL: pessoa@teste.com TELEFONE: 11999999999 ENDEREÇO COMPLETO: Rua Teste 1612 REDE SOCIAL: @perfil NOME/IDADE DO BEBE(S): Yuri 2 anos PACOTE ESCOLHIDO: básico',
    ),
  ]);

  assert.match(result.content, /NOME: \[nome da cliente\]/);
  assert.match(result.content, /ENDEREÇO COMPLETO: \[endereço\]/);
  assert.match(result.content, /NOME\/IDADE DO BEBE\(S\): \[dado da criança\]/);
  assert.doesNotMatch(result.content, /Pessoa|Yuri|1612|123456/);
});

test('agrupa rajadas e preserva o prefixo humano real sem a resposta avaliada', () => {
  const messages = [
    redacted('human', 'Boas-vindas', 0),
    redacted('customer', 'Quero gestante', 1),
    redacted('customer', 'Estou com 28 semanas', 2),
    redacted('human', 'Como imaginou?', 3),
    redacted('customer', 'Algo natural', 4),
    redacted('human', 'Conhece nosso trabalho?', 5),
  ];

  const turns = groupSalesReplayTurns(messages);
  assert.equal(turns.length, 2);
  assert.deepEqual(turns[0].customer_messages.map((message) => message.content), ['Quero gestante', 'Estou com 28 semanas']);
  assert.deepEqual(turns[0].human_messages.map((message) => message.content), ['Como imaginou?']);
  assert.deepEqual(turns[0].real_prefix.map((message) => message.content), ['Boas-vindas', 'Quero gestante', 'Estou com 28 semanas']);
  assert.deepEqual(turns[1].real_prefix.map((message) => message.content), ['Boas-vindas', 'Quero gestante', 'Estou com 28 semanas', 'Como imaginou?', 'Algo natural']);
});

test('infere orçamento, handoff e tópico comercial sem comparar redação literal', () => {
  const quote = inferHumanReplayAction(
    [redacted('human', '[documento enviado pelo estúdio] Pacotes gestante', 2, 'document')],
    [redacted('customer', 'Pode mandar o orçamento de gestante?', 1)],
  );
  const closing = inferHumanReplayAction(
    [redacted('human', 'Vou organizar os próximos passos.', 2)],
    [redacted('customer', 'Gostei e quero fechar.', 1)],
  );

  assert.deepEqual(quote, { type: 'orcamento', niche: 'gestante' });
  assert.deepEqual(closing, { type: 'handoff', reason: 'fechamento' });
  assert.equal(inferCommercialQuestionTopic('Você tem disponibilidade durante a semana?'), 'schedule_preference');
  assert.equal(inferCommercialQuestionTopic('Me conta como tinha pensado em registrar esse momento.'), 'creative_intent');
  assert.equal(inferCommercialQuestionTopic(
    'Que bom que gostou, vamos seguir nesse estilo 🥰 E para vocês é tranquilo fazer as fotos de meio de semana?',
  ), 'schedule_preference');
  assert.equal(inferCommercialQuestionTopic(
    'Perfeito! Vou te mandar os nossos pacotes e você me diz qual gostou mais, pode ser?',
  ), 'quote_sent');
});

test('avalia a mesma condução como correta mesmo com palavras diferentes', () => {
  const [turn] = groupSalesReplayTurns([
    redacted('customer', 'Estou com 28 semanas e quero algo natural.', 1),
    redacted('human', 'Você já conhece o nosso trabalho?', 2),
  ]);

  const result = evaluateSalesReplayTurn({
    turn,
    ai_reply: 'Legal! Chegou a conhecer algum ensaio nosso antes?',
  });

  assert.equal(result.passed, true);
  assert.equal(result.expected_next_step, 'trust_asset');
  assert.equal(result.actual_next_step, 'trust_asset');
  assert.equal(result.checks.every((check) => check.passed), true);
});

test('reprova ação errada, duas perguntas, dado pessoal e link não aprovado', () => {
  const [turn] = groupSalesReplayTurns([
    redacted('customer', 'Quero fechar e pagar o sinal.', 1),
    redacted('human', 'Vou assumir daqui.', 2),
  ]);

  const result = evaluateSalesReplayTurn({
    turn,
    ai_reply: 'Qual pacote? Qual data? Fale com @pessoa em https://inventado.example e ligue (11) 98888-7777.',
  });
  const failedIds = result.checks.filter((check) => !check.passed).map((check) => check.id);

  assert.equal(result.passed, false);
  assert.deepEqual(failedIds, ['action', 'next_step', 'single_question', 'no_pii', 'safe_urls']);
});

test('resume aprovação por turno, por check e por ação', () => {
  const [replyTurn] = groupSalesReplayTurns([
    redacted('customer', 'Quero gestante.', 1),
    redacted('human', 'Com quantas semanas você está?', 2),
  ]);
  const [handoffTurn] = groupSalesReplayTurns([
    redacted('customer', 'Quero fechar.', 1),
    redacted('human', 'Vou assumir.', 2),
  ]);
  const evaluations = [
    evaluateSalesReplayTurn({ turn: replyTurn, ai_reply: 'Você está com quantas semanas?' }),
    evaluateSalesReplayTurn({ turn: handoffTurn, ai_reply: 'Vou seguir perguntando.' }),
  ];

  const totals = summarizeSalesReplayTotals(evaluations);
  assert.equal(totals.turns, 2);
  assert.equal(totals.passed, 1);
  assert.equal(totals.failed, 1);
  assert.equal(totals.score, 50);
  assert.deepEqual(totals.by_action.reply, { total: 1, passed: 1 });
  assert.deepEqual(totals.by_action.handoff, { total: 1, passed: 0 });
  assert.equal(totals.checks_total, 12);
});

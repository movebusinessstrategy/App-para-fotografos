import assert from 'node:assert/strict';
import test from 'node:test';
import {
  analyzeConversationFlow,
  enforceConversationFlowReply,
  enforceSingleQuestion,
  type ConversationFlowAnalysis,
  type ConversationFlowMove,
} from './agent-conversation-flow.js';
import { enforceApprovedPortfolioUrls } from './agent-portfolio.js';

type Role = 'user' | 'assistant';
type Turn = [role: Role, content: string];

function messages(turns: Turn[]) {
  return turns.map(([role, content], index) => ({
    role,
    content,
    timestamp: new Date(Date.UTC(2026, 5, 10, 10, index)).toISOString(),
  }));
}

function flow(turns: Turn[], knownNiche?: string): ConversationFlowAnalysis {
  return analyzeConversationFlow(messages(turns), knownNiche);
}

function assertMove(
  turns: Turn[],
  expected: ConversationFlowMove,
  knownNiche?: string,
): ConversationFlowAnalysis {
  const result = flow(turns, knownNiche);
  assert.equal(result.move, expected);
  return result;
}

const gestanteAteIdeia: Turn[] = [
  ['user', 'Quero fazer um ensaio de gestante.'],
  ['assistant', 'Com quantas semanas você está?'],
  ['user', 'Estou com 25 semanas.'],
  ['assistant', 'Já passou um pouquinho da metade. Me conta mais de como você tinha pensado em registrar esse momento de vocês? Caso tenha referências, pode me mandar aqui 🤍'],
];

const gestanteSemReferencia: Turn[] = [
  ...gestanteAteIdeia,
  ['user', 'Pensei em algo bem natural, mas não tenho referências.'],
  ['assistant', 'E você já conhece um pouco do nosso trabalho? Chegou a dar uma olhada em algumas fotos?'],
];

const newbornAteIdeia: Turn[] = [
  ['user', 'Quero fazer um ensaio newborn.'],
  ['assistant', 'O bebê já nasceu?'],
  ['user', 'Já nasceu sim.'],
  ['assistant', 'Quantos dias ele tem?'],
  ['user', 'Ele está com 8 dias.'],
];

test('golden gestante: segue nicho, semanas e intenção criativa sem pular etapas', () => {
  const start = assertMove([
    ['user', 'Quero fazer um ensaio de gestante.'],
  ], 'ask_lifecycle');
  assert.equal(start.niche, 'gestante');
  assert.equal(start.state.current_step, 'lifecycle');

  const afterWeeks = assertMove([
    ['user', 'Quero fazer um ensaio de gestante.'],
    ['assistant', 'Com quantas semanas você está?'],
    ['user', 'Estou com 25 semanas.'],
  ], 'ask_creative_intent');
  assert.equal(afterWeeks.state.current_step, 'creative_intent');
  assert.match(afterWeeks.instruction, /passou um pouquinho da metade/i);
  assert.match(afterWeeks.instruction, /refer[eê]ncias/i);
});

test('golden gestante: reconhece as quatro faixas da gestação antes da intenção criativa', () => {
  const scenarios = [
    [8, /in[ií]cio da gesta[cç][aã]o/i],
    [20, /metade da gesta[cç][aã]o/i],
    [25, /passou um pouquinho da metade/i],
    [32, /reta final da gesta[cç][aã]o/i],
  ] as const;

  for (const [weeks, expectedAcknowledgement] of scenarios) {
    const result = assertMove([
      ['user', `Quero ensaio gestante e estou com ${weeks} semanas.`],
    ], 'ask_creative_intent');
    assert.match(result.instruction, expectedAcknowledgement);
  }
});

test('referência prometida não conta como recebida; referência externa ainda confirma familiaridade', () => {
  const promised = assertMove([
    ...gestanteAteIdeia,
    ['user', 'Pensei em algo natural e tenho referências, vou mandar.'],
  ], 'wait');
  assert.equal(promised.state.current_step, 'trust_asset');

  const received = assertMove([
    ...gestanteAteIdeia,
    ['user', 'Pensei em algo natural e tenho referências, vou mandar.'],
    ['user', '[imagem enviada pela cliente]'],
  ], 'ask_work_familiarity');
  assert.equal(received.state.current_step, 'trust_asset');

  assertMove([
    ...gestanteAteIdeia,
    ['user', 'Pensei em algo natural e tenho referências. Já acompanho vocês pelo Instagram.'],
    ['user', '[imagem enviada pela cliente]'],
  ], 'ask_schedule_preference');
});

test('sem referência pergunta se conhece; Instagram ou resposta positiva pula portfólio', () => {
  assertMove([
    ...gestanteAteIdeia,
    ['user', 'Pensei em algo natural, mas não tenho referências.'],
  ], 'ask_work_familiarity');

  assertMove([
    ...gestanteSemReferencia,
    ['user', 'Sim, já conheço pelo Instagram.'],
  ], 'ask_schedule_preference');

  assertMove([
    ...gestanteAteIdeia,
    ['user', 'Quero algo natural. Vi o trabalho de vocês no Instagram.'],
  ], 'ask_schedule_preference');

  assertMove([
    ['user', 'Quero ensaio gestante, estou com 28 semanas e já conheço vocês pelo Instagram.'],
  ], 'ask_creative_intent');
});

test('cliente que não conhece recebe portfólio; promessa de envio não conta como material enviado', () => {
  assertMove([
    ...gestanteSemReferencia,
    ['user', 'Ainda não conheço.'],
  ], 'share_portfolio');

  const onlyPromised = assertMove([
    ...gestanteSemReferencia,
    ['user', 'Ainda não conheço.'],
    ['assistant', 'Vou te mandar algumas fotos de ensaios e você me diz o que achou, pode ser?'],
  ], 'share_portfolio');
  assert.equal(onlyPromised.state.current_step, 'trust_asset');
});

test('portfólio realmente enviado aguarda reação antes de perguntar sobre a semana', () => {
  const portfolioHistory: Turn[] = [
    ...gestanteSemReferencia,
    ['user', 'Ainda não conheço.'],
    ['assistant', 'Vou te mostrar alguns ensaios.'],
    ['assistant', '[imagem enviada pelo estúdio]'],
  ];

  assertMove(portfolioHistory, 'ask_portfolio_reaction');
  assertMove([
    ...portfolioHistory,
    ['assistant', 'O que você achou?'],
    ['user', 'Gostei bastante, é esse estilo mesmo.'],
  ], 'ask_schedule_preference');
});

test('reação negativa ao portfólio esclarece o desalinhamento antes de avançar', () => {
  const result = assertMove([
    ...gestanteSemReferencia,
    ['user', 'Ainda não conheço.'],
    ['assistant', '[imagem enviada pelo estúdio]'],
    ['assistant', 'O que você achou?'],
    ['user', 'Não gostei desse estilo, queria algo mais natural.'],
  ], 'clarify_portfolio_mismatch');

  assert.notEqual(result.move, 'ask_schedule_preference');
  assert.notEqual(result.move, 'send_quote');
});

test('meio de semana e sábado chegam ao orçamento, mas sábado nunca gera handoff', () => {
  const ready: Turn[] = [
    ...gestanteSemReferencia,
    ['user', 'Sim, já conheço pelo Instagram.'],
    ['assistant', 'E para vocês é tranquilo fazer as fotos de meio de semana?'],
  ];

  const weekday = assertMove([
    ...ready,
    ['user', 'Sim, consigo fazer durante a semana.'],
  ], 'send_quote');
  assert.equal(weekday.handoff_reason, null);

  const saturday = assertMove([
    ...ready,
    ['user', 'Durante a semana não consigo, só posso sábado.'],
  ], 'send_quote');
  assert.equal(saturday.handoff_reason, null);

  const reply = enforceConversationFlowReply('Vou verificar uma data. ###HUMANO:disponibilidade###', saturday);
  assert.match(reply, /###PDF:gestante###/i);
  assert.match(reply, /s[aá]bado/i);
  assert.match(reply, /concorrid/i);
  assert.doesNotMatch(reply, /###HUMANO/i);
});

test('golden newborn: pergunta se nasceu antes da idade e depois segue para intenção criativa', () => {
  assertMove([
    ['user', 'Quero fazer um ensaio newborn.'],
  ], 'ask_lifecycle');

  const bornWithoutAge = assertMove([
    ['user', 'Quero fazer um ensaio newborn.'],
    ['assistant', 'O bebê já nasceu?'],
    ['user', 'Já nasceu sim.'],
  ], 'ask_lifecycle');
  assert.match(bornWithoutAge.instruction, /quantos dias/i);

  const withAge = assertMove(newbornAteIdeia, 'ask_creative_intent');
  assert.match(withAge.instruction, /8 dias/i);

  const unborn = assertMove([
    ['user', 'Quero fazer um ensaio newborn, mas o bebê ainda não nasceu.'],
  ], 'ask_creative_intent');
  assert.match(unborn.instruction, /ainda n[aã]o nasceu/i);
  assert.doesNotMatch(unborn.instruction, /pergunte quantos dias/i);
});

test('newborn percorre referências, conhecimento, semana e envia o PDF correto', () => {
  const result = assertMove([
    ...newbornAteIdeia,
    ['assistant', 'Me conta como vocês pensaram em registrar esse momento. Se tiver referências, pode mandar.'],
    ['user', 'Quero algo bem natural, sem referências. Já conheço vocês pelo Instagram.'],
    ['assistant', 'E para vocês é tranquilo fazer as fotos de meio de semana?'],
    ['user', 'Sim, podemos durante a semana.'],
  ], 'send_quote');

  const reply = enforceConversationFlowReply('Vou mandar as opções.', result);
  assert.match(reply, /###PDF:newborn###/i);
  assert.doesNotMatch(reply, /###PDF:gestante###/i);
});

test('depois do orçamento aguarda a escolha sem reiniciar a qualificação', () => {
  const result = assertMove([
    ...gestanteSemReferencia,
    ['user', 'Sim, já conheço pelo Instagram.'],
    ['assistant', 'E para vocês é tranquilo fazer as fotos de meio de semana?'],
    ['user', 'Sim, durante a semana é tranquilo.'],
    ['assistant', '###PDF:gestante### Vou mandar os pacotes; me conta qual gostou mais e depois vemos uma data.'],
    ['user', 'Gostei mais do pacote 2.'],
  ], 'wait');

  assert.equal(result.state.current_step, null);
  assert.match(result.instruction, /or[cç]amento j[aá] foi enviado/i);
  assert.doesNotMatch(result.instruction, /pergunte com quantas semanas/i);
});

test('handoff tem prioridade para fechamento, disponibilidade, pagamento e dúvida insegura', () => {
  const scenarios = [
    ['Quero fechar esse ensaio.', 'fechamento'],
    ['Você consegue consultar uma data disponível?', 'disponibilidade'],
    ['Como faço para pagar o sinal no Pix?', 'pagamento'],
    ['Tenho uma exigência específica que não apareceu no material. Vocês conseguem atender?', 'duvida'],
  ] as const;

  for (const [customerMessage, reason] of scenarios) {
    const result = assertMove([
      ['user', 'Quero ensaio gestante e estou com 28 semanas.'],
      ['user', customerMessage],
    ], 'handoff');
    assert.equal(result.handoff_reason, reason);
    assert.equal(result.state.current_step, 'buying_signal');
  }
});

test('preferência por sábado é diferente de pedido explícito para consultar sábado', () => {
  const preference = flow([
    ['user', 'Quero gestante, estou com 28 semanas, quero algo natural, já conheço pelo Instagram e só posso sábado.'],
  ]);
  assert.equal(preference.move, 'send_quote');
  assert.equal(preference.handoff_reason, null);

  const explicitCheck = flow([
    ['user', 'Quero gestante. Você consegue verificar se tem sábado disponível?'],
  ]);
  assert.equal(explicitCheck.move, 'handoff');
  assert.equal(explicitCheck.handoff_reason, 'disponibilidade');
});

test('abertura com duas perguntas preserva a pergunta comercial e deixa apenas um ponto de interrogação', () => {
  const openingFlow = assertMove([
    ['user', 'Oi!'],
  ], 'ask_niche');
  const reply = enforceConversationFlowReply(
    'Olá, tudo bem? Qual tipo de ensaio você gostaria?',
    openingFlow,
  );

  // "tudo bem?" é cumprimento e fica; sobra exatamente UMA pergunta comercial.
  assert.match(reply, /^Olá, tudo bem\?/);
  assert.equal((reply.replace(/^Olá, tudo bem\?/, '').match(/\?/g) || []).length, 1);
  assert.match(reply, /qual tipo de ensaio/i);
  assert.match(reply, /ensaio[^?]*\?$/i);
});

test('apresentação com linha em branco + uma pergunta passa inteira; segunda pergunta é cortada', () => {
  const opening = 'Olá, tudo bem?\nMeu nome é Aurora, faço parte do time do *Estúdio Pitori* e vou tomar conta do seu atendimento por aqui.';
  assert.equal(
    enforceSingleQuestion(`${opening}\n\nCom quantas semanas você está? 🥰`),
    `${opening}\n\nCom quantas semanas você está? 🥰`,
  );
  assert.equal(
    enforceSingleQuestion(`${opening}\n\nQual tipo de ensaio você gostaria?\n\nCom quantas semanas você está? 🥰`),
    `${opening}\n\nQual tipo de ensaio você gostaria?`,
  );
});

test('respostas curtas são interpretadas no contexto e não repetem semanas, dias ou agenda', () => {
  assertMove([
    ['user', 'Quero gestante.'],
    ['assistant', 'Com quantas semanas você está?'],
    ['user', '28'],
  ], 'ask_creative_intent');

  assertMove([
    ['user', 'Quero newborn.'],
    ['assistant', 'O bebê já nasceu?'],
    ['user', 'Sim'],
  ], 'ask_lifecycle');

  assertMove([
    ['user', 'Quero newborn.'],
    ['assistant', 'O bebê já nasceu?'],
    ['user', 'Sim'],
    ['assistant', 'Quantos dias ele tem?'],
    ['user', '8'],
  ], 'ask_creative_intent');

  assertMove([
    ...gestanteSemReferencia,
    ['user', 'Sim, já conheço.'],
    ['assistant', 'E para vocês é tranquilo fazer as fotos de meio de semana?'],
    ['user', 'Sim, bem tranquilo.'],
  ], 'send_quote');
});

test('resposta de agenda não contamina a confirmação anterior de que conhece o trabalho', () => {
  assertMove([
    ...gestanteSemReferencia,
    ['user', 'Sim, já conheço.'],
    ['assistant', 'E para vocês é tranquilo fazer as fotos de meio de semana?'],
    ['user', 'Não, só consigo sábado.'],
  ], 'send_quote');
});

test('pedido de pessoa, reclamação e agendamento fazem handoff silencioso', () => {
  const scenarios = [
    ['Quero falar com uma pessoa.', 'pessoa'],
    ['Quero reclamar, estou muito chateada com o atendimento.', 'reclamacao'],
    ['Quero agendar esse ensaio gestante.', 'fechamento'],
  ] as const;
  for (const [content, reason] of scenarios) {
    const result = flow([['user', content]], 'gestante');
    assert.equal(result.move, 'handoff');
    assert.equal(result.handoff_reason, reason);
    assert.equal(enforceConversationFlowReply('Com quantas semanas você está?', result), `###HUMANO:${reason}###`);
  }
});

test('preferência simples de sábado não vira consulta e menção de família não troca o nicho gestante', () => {
  const result = assertMove([
    ['user', 'Quero ensaio gestante, estou com 28 semanas.'],
    ['user', 'Quero algo natural com a minha família e já conheço vocês. Pode ser sábado.'],
  ], 'send_quote');
  assert.equal(result.niche, 'gestante');
  assert.equal(result.handoff_reason, null);
});

test('dia da semana em outro contexto não conta como preferência de agenda', () => {
  assertMove([
    ['user', 'Quero gestante, completo 29 semanas na sexta e quero algo natural. Já conheço vocês.'],
  ], 'ask_schedule_preference');
});

test('token de PDF prematuro é removido e orçamento não recebido volta para envio', () => {
  const lifecycle = flow([['user', 'Quero ensaio gestante.']]);
  const guarded = enforceConversationFlowReply(
    'Com quantas semanas você está? ###PDF:gestante###',
    lifecycle,
  );
  assert.doesNotMatch(guarded, /###PDF/i);

  const missing = assertMove([
    ['user', 'Quero gestante, estou com 28 semanas, quero natural, já conheço vocês e consigo durante a semana.'],
    ['assistant', '###PDF:gestante###'],
    ['user', 'Não recebi o orçamento.'],
  ], 'send_quote');
  assert.match(missing.fallback_reply, /###PDF:gestante###/i);
});

test('não promete portfólio inexistente e não repete esclarecimento após reação negativa', () => {
  assert.equal(
    enforceApprovedPortfolioUrls('Vou te mostrar alguns ensaios e você me diz o que achou?', [], 'gestante'),
    '###HUMANO:duvida###',
  );

  assertMove([
    ...gestanteSemReferencia,
    ['user', 'Ainda não conheço.'],
    ['assistant', '[imagem enviada pelo estúdio]'],
    ['assistant', 'O que você achou?'],
    ['user', 'Não gostei desse estilo.'],
    ['assistant', 'O que você gostaria que fosse diferente?'],
    ['user', 'Quero algo mais natural e claro.'],
  ], 'ask_schedule_preference');
});

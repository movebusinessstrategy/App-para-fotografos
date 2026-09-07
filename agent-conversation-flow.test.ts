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

test('resposta fora do vocabulário esperado encerra a etapa e não repete a pergunta', () => {
  // Caso real: a cliente respondeu "não tinha nada em mente" e a Lia repetia
  // "me conta como você tinha pensado" pra sempre.
  const flow = assertMove([
    ['user', 'Oi! Queria saber sobre o ensaio gestante'],
    ['assistant', 'Com quantas semanas você está?'],
    ['user', '26'],
    ['assistant', 'Me conta mais de como você tinha pensado em registrar esse momento de vocês?'],
    ['user', 'Eu não tinha nada em mente'],
  ], 'ask_work_familiarity');
  assert.equal(flow.niche, 'gestante');
});

test('silêncio depois da pergunta mantém a etapa aberta', () => {
  assertMove([
    ['user', 'Quero ensaio gestante, tô de 30 semanas'],
    ['assistant', 'Me conta mais de como você tinha pensado em registrar esse momento de vocês?'],
  ], 'ask_creative_intent');
});

test('reconhece os nomes que o cliente usa para marca pessoal', () => {
  for (const fala of [
    'Oi, quero fazer um book profissional pro LinkedIn',
    'preciso de fotos pro meu LinkedIn',
    'quero um headshot',
  ]) {
    const result = flow([['user', fala]]);
    assert.equal(result.niche, 'marca_pessoal', fala);
    assert.notEqual(result.move, 'ask_niche', fala);
  }
});

test('a pergunta de intenção usa o vocabulário do nicho, nunca a frase de gestante', () => {
  const esperado: Array<[string, RegExp]> = [
    ['Oi, quero fazer um book profissional pro LinkedIn', /usar essas fotos|aparecer/i],
    ['quero ensaio de familia', /quem vai participar/i],
    ['quero smash the cake', /tema ou cores/i],
  ];
  for (const [fala, padrao] of esperado) {
    const result = flow([['user', fala]]);
    assert.match(result.fallback_reply, padrao, fala);
    assert.doesNotMatch(result.fallback_reply, /esse momento de voc[êe]s/i, fala);
  }
  // gestante mantém a frase validada da casa
  assert.match(
    flow([['user', 'quero ensaio gestante'], ['assistant', 'Com quantas semanas você está?'], ['user', '30']]).fallback_reply,
    /esse momento de voc[êe]s/i,
  );
});

test('etapa respondida não é repetida, em qualquer nicho', () => {
  // newborn: a pergunta da etapa 3 é a do nicho, não a de gestante
  assertMove([
    ['user', 'queria fazer newborn'],
    ['assistant', 'O bebê já nasceu?'],
    ['user', 'ainda não, previsão 20 de outubro'],
    ['assistant', 'Você pensou em fotos só do bebê ou com vocês e os irmãos junto?'],
    ['user', 'queria com a gente e a irmã mais velha'],
  ], 'ask_work_familiarity');

  // família
  assertMove([
    ['user', 'queria saber sobre ensaio de família'],
    ['assistant', 'Quem vai participar do ensaio?'],
    ['user', 'somos eu, meu marido e dois filhos pequenos'],
  ], 'ask_work_familiarity');
});

test('"só consigo sábado" fecha a etapa de agenda e segue pro orçamento', () => {
  const result = assertMove([
    ['user', 'quero ensaio gestante, tô de 30 semanas, já conheço vocês pelo Instagram'],
    ['assistant', 'Me conta mais de como você tinha pensado em registrar esse momento de vocês?'],
    ['user', 'algo natural'],
    ['assistant', 'E para vocês é tranquilo fazer as fotos de meio de semana?'],
    ['user', 'Só consigo aos sábados'],
  ], 'send_quote');
  assert.equal(result.handoff_reason, null);
});

test('data concreta proposta pela cliente vira hand-off; preferência de dia não', () => {
  const base: Turn[] = [
    ['user', 'quero ensaio gestante, tô de 30 semanas'],
    ['assistant', 'Vou te mandar os nossos pacotes por aqui, pode ser?'],
  ];
  for (const fala of ['Pode ser dia 18 de manhã?', 'dá pra ser 20/10?', 'consigo marcar amanhã?']) {
    assert.equal(flow([...base, ['user', fala]]).handoff_reason, 'disponibilidade', fala);
  }
  for (const fala of ['Só consigo aos sábados', 'só posso sábado']) {
    assert.equal(flow([...base, ['user', fala]]).handoff_reason, null, fala);
  }
});

test('nenhum movimento devolve resposta vazia: sem texto, uma pessoa assume', () => {
  const mudo = flow([
    ['user', 'quero ensaio gestante, tô de 30 semanas'],
    ['assistant', 'Vou te mandar os nossos pacotes por aqui, pode ser?'],
    ['user', 'ok'],
  ]);
  const reply = enforceConversationFlowReply('', mudo);
  assert.notEqual(reply.trim(), '');
});

test('chá revelação é cobertura de evento e não cai no mini ensaio de revelação', () => {
  // Os dois orçamentos existem e têm valores bem diferentes (R$ 2.400 x R$ 550):
  // mandar o errado é erro comercial, não só de texto.
  for (const fala of ['queria fotos do meu chá revelação', 'vocês fazem chá de bebê?', 'chá de revelação em novembro']) {
    assert.equal(flow([['user', fala]]).niche, 'cha_revelacao', fala);
  }
  for (const fala of ['queria o ensaio de revelação do sexo', 'ensaio revelação no estúdio']) {
    assert.equal(flow([['user', fala]]).niche, 'revelacao', fala);
  }
});

test('acompanhamento e anunciação têm nicho próprio, com PDF próprio', () => {
  for (const fala of ['queria o acompanhamento do bebê', 'ensaio do meu bebê de 6 meses', 'quero o ensaio baby']) {
    assert.equal(flow([['user', fala]]).niche, 'baby', fala);
  }
  assert.equal(flow([['user', 'quero o ensaio de anunciação']]).niche, 'anunciacao');
  // Gestante fala em meses de gestação e não pode virar acompanhamento.
  assert.equal(flow([['user', 'quero ensaio gestante, estou de 7 meses']]).niche, 'gestante');
});

test('a Lia reconhecendo a resposta não conta como perguntar de novo', () => {
  // "então você já conhece nosso trabalho pela sua prima" é reconhecimento, não
  // pergunta. Lido como pergunta, a etapa reabria e a conversa travava em loop
  // bem na hora de mandar o orçamento.
  const depois = flow([
    ['user', 'vocês fazem cobertura de chá revelação?'],
    ['assistant', 'Fazemos sim 🥰\n\nComo você imaginou a cobertura?'],
    ['user', 'queria registrar o estouro do confete com a família toda'],
    ['assistant', 'Entendii 🤍\n\nE você já conhece um pouco do nosso trabalho?'],
    ['user', 'Conheço, minha prima fez com vocês'],
    ['assistant', 'Ahh, então você já conhece nosso trabalho pela sua prima 🥰\n\nE para vocês é tranquilo fazer as fotos de meio de semana?'],
    ['user', 'Pode ser, me manda os valores'],
  ]);
  assert.equal(depois.move, 'send_quote');
});

test('catálogo de produtos pode sair fora da etapa de orçamento; o do ensaio não', () => {
  const depoisDoOrcamento = flow([
    ['user', 'quero ensaio de família'],
    ['assistant', 'Quem vai participar do ensaio?'],
    ['user', 'eu, meu marido e as meninas'],
    ['assistant', 'E você já conhece um pouco do nosso trabalho?'],
    ['user', 'já conheço sim, acompanho vocês'],
    ['assistant', 'E para vocês é tranquilo fazer as fotos de meio de semana?'],
    ['user', 'pode ser'],
    ['assistant', 'Vou te mandar os nossos pacotes por aqui, pode ser?\n\n###PDF:familia###'],
    ['user', 'vocês vendem álbum também?'],
  ]);
  assert.equal(depoisDoOrcamento.move, 'wait');
  const comCatalogo = 'Temos sim 🤍\n\n###PDF:produtos###';
  assert.match(enforceConversationFlowReply(comCatalogo, depoisDoOrcamento), /###PDF:produtos###/);
  // O orçamento do ensaio continua preso à etapa de orçamento.
  assert.doesNotMatch(enforceConversationFlowReply('Segue 🤍\n\n###PDF:familia###', depoisDoOrcamento), /###PDF:familia###/);
});

test('vocabulário de gestação não vaza para quem não é gestante', () => {
  // "meu bebê tem 6 meses" já virou "já passou um pouquinho da metade da
  // gestação" na cara da cliente. Só gestante e newborn têm etapa de tempo.
  const bebe = flow([['user', 'queria o acompanhamento do meu bebê, ele tem 6 meses']]);
  assert.equal(bebe.niche, 'baby');
  assert.doesNotMatch(bebe.fallback_reply, /gesta[cç][aã]o|semanas/i);
  const familia = flow([['user', 'quero ensaio de família, minha filha tem 8 meses']]);
  assert.doesNotMatch(familia.fallback_reply, /gesta[cç][aã]o/i);
});

test('a etapa de intenção fecha mesmo quando a Lia reescreve a pergunta', () => {
  // A pergunta muda de nicho pra nicho e a Lia ainda a reescreve. Quando a
  // redação não era reconhecida, a etapa ficava aberta e ela perguntava de novo.
  for (const pergunta of [
    'Você pensou em fazer um acompanhamento ou uma sessão avulsa?',
    'Você imaginou as fotos só dele ou com vocês também?',
    'Vocês já tinham pensado em algum estilo?',
  ]) {
    const depois = flow([
      ['user', 'queria o acompanhamento do meu bebê de 6 meses'],
      ['assistant', pergunta],
      ['user', 'queria bem clean, fundo claro'],
    ]);
    assert.notEqual(depois.move, 'ask_creative_intent', pergunta);
  }
});

test('não pergunta a mesma coisa três vezes, mas ainda ouve quem responde', () => {
  const base: Turn[] = [
    ['user', 'queria um smash the cake pra minha filha'],
    ['assistant', 'Você já tem uma ideia de tema ou cores pro smash?'],
    ['user', 'ela faz 1 aninho dia 12 de novembro'],
    ['assistant', 'Entendii 🥰\n\nE você já conhece um pouco do nosso trabalho?'],
    ['user', 'queria fazer ao ar livre, num lugar com grama'],
    ['assistant', 'Entendii 😊\n\nE você já conhece um pouco do nosso trabalho?'],
  ];
  // Não respondeu duas vezes: segue a conversa em vez de perguntar de novo.
  assert.notEqual(flow([...base, ['user', 'mas eu queria muito ao ar livre mesmo assim']]).move, 'ask_work_familiarity');
  // Respondeu que não conhece: manda o portfólio, mesmo na segunda pergunta.
  assert.equal(flow([...base, ['user', 'não conheço vocês ainda']]).move, 'share_portfolio');
});

// Agente de IA para o atendimento no WhatsApp — cérebro server-side (Claude).
// Usado pelo playground de teste (POST /api/agent/test). Na Fase 2 o mesmo
// motor alimenta as sugestões de resposta dentro da extensão.

import Anthropic from '@anthropic-ai/sdk';
import { buildPortfolioPrompt, type PortfolioLink } from './agent-portfolio.js';

// Sonnet 4.6: melhor equilíbrio de tom/custo para imitar a voz do estúdio.
const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 1024;

const apiKey = process.env.ANTHROPIC_API_KEY;
const anthropic = apiKey ? new Anthropic({ apiKey }) : null;

export interface AgentConfig {
  enabled: boolean;
  persona: string;          // tom de voz / personalidade
  objective: string;        // objetivo e fluxo do atendimento
  knowledge: string;        // base de conhecimento (pacotes, horários, políticas)
  rules: string;            // regras e limites — o que NUNCA fazer
  salesStrategy?: string;   // técnicas de venda / contorno de objeção (opcional)
  attendantName?: string;   // nome do atendente que a IA assume
  learnedPlaybook?: string; // padrão agregado de vendas comprovadas do estúdio
  supervisedMemory?: string; // regras/exemplos aprovados explicitamente no laboratório
  portfolioLinks?: PortfolioLink[]; // links aprovados manualmente pelo estúdio
}

export interface AgentMessage {
  role: 'user' | 'assistant';
  content: string;
}

// Instruções fixas do agente. Ficam ANTES dos blocos editáveis para que o
// cache de prompt aproveite o prefixo estável entre chamadas.
const BASE_INSTRUCTIONS = `Você é o assistente virtual de um estúdio de fotografia, responsável pelo primeiro atendimento dos clientes pelo WhatsApp.

Abaixo você recebe quatro blocos de configuração: objetivo e fluxo, personalidade, base de conhecimento e regras e limites. Siga todos à risca. As "Regras e limites" têm prioridade sobre tudo — se algo conflitar, obedeça as regras.

Princípios que valem sempre (têm prioridade sobre a configuração abaixo):
- Responda em português do Brasil, no estilo WhatsApp: natural e proporcional ao momento. Alterne respostas rápidas com falas um pouco mais completas quando precisar acolher ou conduzir; não escreva com tamanho mecânico nem tente bater uma quantidade fixa de caracteres. Pode usar quebra de linha pra respirar, mas sem textão.
- CUMPRIMENTE SÓ UMA VEZ — na PRIMEIRA mensagem da conversa. Depois NUNCA mais comece com "oi", "oiii", "olá", "boa tarde", "tudo bem?" e afins. Se já existe conversa, você JÁ está falando com a pessoa: continue do ponto onde parou, direto, como um humano faz. Ficar perguntando "tudo bem?" a cada mensagem é cara de robô — proibido.
- FALE COMO GENTE, não como robô/IA. Nada de entusiasmo forçado nem elogio genérico ("que ótimo!", "que lindo!", "que fase linda!", "fico tão feliz que você..."). Empatia de verdade é reconhecer rápido o que a pessoa disse, do jeito que uma pessoa normal responderia — não é bajular.
- EMOJI faz parte do tom — use com carinho e naturalidade, com frequência (mais ou menos uma mensagem sim, outra não), no MESMO estilo que aparece nas mensagens do estúdio na conversa (os carinhosos tipo 🥰 ❤️ 😊). Não em toda mensagem, mas não corte — 1 por mensagem costuma bastar.
- Cada resposta precisa reconhecer o que a pessoa disse e levar a conversa ao próximo passo necessário. Se ela desviar, responda brevemente ao que for seguro e retome com naturalidade a próxima pergunta ainda não respondida. Nunca reinicie o roteiro nem repita informação que já apareceu.
- Faça uma pergunta por vez.
- NÃO fique listando pacotes nem falando valores no chat. Quando chegar a hora de pacote/preço, ofereça mandar as opções na 1ª pessoa, como quem resolve (ex.: "já te mando as opções certinhas e a gente vê a melhor data, pode ser? 🥰"). No máximo aponte, em uma frase, qual pacote encaixa no caso da pessoa — sem listar todos e sem cravar valor.
- Nunca invente preço, data, horário, prazo ou condição. Se não souber, fale como gente: "deixa eu confirmar isso certinho e já te falo" — NUNCA "vou perguntar pra equipe".
- NUNCA diga que vai "passar pra equipe", "transferir", "encaminhar pra um atendente" ou que "a equipe vê depois". Isso entrega que é um processo/robô. Você fala como a própria pessoa do time. Quando uma etapa exigir decisão humana, siga a regra do modo em uso sem inventar, prometer ou anunciar a troca de atendimento.
- Siga o roteiro definido na configuração; não invente etapas nem mude de assunto.
- Se o cliente hesitar ou enrolar ("vou pensar", "vou ver com meu marido", "depois eu vejo", "tá caro"): acolha em uma frase, reforce UM diferencial concreto do estúdio, sem pressão, e siga o roteiro.
- COMBINADO (essencial, nunca pule): quando a pessoa não fecha na hora e deixa em aberto ("vou ver", "depois te falo", "vou pensar"), NUNCA responda só "quando decidir me chama" nem deixe o retorno por conta dela. SEMPRE proponha VOCÊ um próximo contato com DIA concreto, leve e sem pressão, oferecendo opção: "super tranquilo! 🥰 quer que eu te chame amanhã pra ver como ficou? ou prefere [outro dia]?". Use a data de hoje pra escolher o dia (se hoje é sexta, ofereça segunda; senão amanhã ou daqui a dois dias). Combinar um retorno com data é o que evita o cliente sumir.
- Responda APENAS com a mensagem que vai pro cliente. Sem explicações, sem "aqui está", sem aspas em volta.`;

// ── Padrões editáveis ─────────────────────────────────────────────
// Pré-preenchidos com base no padrão de atendimento observado. O usuário
// ajusta tudo isto na tela "Agente IA".

export const DEFAULT_OBJECTIVE = `Seu objetivo em toda conversa: levar o cliente do primeiro "oi" até a apresentação do pacote correto, com a mesma condução humana que o estúdio já validou.

Fluxo a seguir:
1. Cumprimentar pelo nome e perguntar como pode ajudar.
2. Descobrir o tipo de ensaio que a pessoa quer (o "nicho").
3. Se for gestante, perguntar quantas semanas ela está — a menos que isso já tenha sido informado — e reconhecer a fase com naturalidade: início, metade, um pouco depois da metade ou reta final. Se for newborn, primeiro descobrir se o bebê já nasceu; se nasceu, perguntar quantos dias tem. Se ainda não nasceu, reconhecer isso e não perguntar idade.
4. Depois dessa resposta, perguntar como a pessoa imaginou registrar o momento e convidá-la a mandar referências, caso tenha. Se prometeu mandar, aguardar a imagem. Se já enviou, reconhecer o estilo sem perguntar de novo.
5. Descobrir se ela já conhece o trabalho do estúdio. Se veio pelo Instagram ou a referência é um trabalho do próprio estúdio, reconhecer e seguir. Se não conhece, enviar somente portfólio cadastrado, perguntar o que achou e aguardar a reação antes de avançar.
6. Perguntar se é tranquilo fazer as fotos durante a semana. Se só puder sábado, explicar com naturalidade que o estúdio trabalha aos sábados e que eles são bem concorridos, sem prometer vaga nem consultar agenda.
7. Depois das etapas necessárias, enviar o PDF correto com um combinado natural: a pessoa olha os pacotes, conta qual gostou mais e então vocês veem uma data.
8. Quando o cliente quiser fechar, consultar uma data real ou pagar: não tente concluir essa etapa. No modo autônomo, pare silenciosamente para uma pessoa assumir, sem nunca falar em "equipe" nem em transferência.

O fluxo é adaptativo, não um interrogatório: pule qualquer etapa que a pessoa já respondeu espontaneamente. Faça uma pergunta principal por vez. Quando houver um desvio, acolha ou responda brevemente e volte à próxima etapa útil sem usar frases engessadas.

Considere o atendimento "fechado" quando: o nicho foi identificado, o pacote certo foi apresentado e o cliente sabe qual é o próximo passo.`;

export const DEFAULT_PERSONA = `Tom de gente de verdade: caloroso, próximo e direto — como um atendente humano e simpático do estúdio, NÃO como assistente virtual. Use o nome da pessoa quando souber, sem forçar.
- Cumprimente simples: "Oi [nome], tudo bem?" (ajuste pra bom dia / boa tarde / boa noite).
- Pode usar "perfeito", "combinado", "fechou" — natural, sem alongar vogal exageradamente.
- Use emoji com frequência (≈ uma mensagem sim, outra não), do jeito carinhoso do estúdio — 🥰 ❤️ ☺️ 😊 são a cara da casa. Não em toda mensagem, mas não corte; geralmente 1 por mensagem.
- Empatia é breve e natural ("entendi", "imagino"). Reconheça ideias concretas (por exemplo, o estilo natural que a pessoa descreveu), mas nunca use bajulação automática ("que delícia!", "que fase linda!").
- Nada de linguagem corporativa nem de "cara de robô". Escreva como uma pessoa normal escreveria no WhatsApp.`;

export const DEFAULT_KNOWLEDGE = `ESTÚDIO: [preencha o nome do estúdio]

NICHOS DE ENSAIO E PACOTES (complete preços e o que cada pacote inclui):
- Gestante — pacote "GESTANTE 2026". Ideal entre 28 e 32 semanas. [valores / o que inclui]
- Newborn — pacote "NEWBORN 2026". Ideal nos primeiros 15 dias do bebê. [valores / o que inclui]
- Família — pacote "FAMÍLIA 2026". [valores / o que inclui]
- Smash the Cake — pacote "SMASH THE CAKE 2026". Comemoração de 1 ano. [valores / o que inclui]
- Feminino — pacote "FEMININO 2026". [valores / o que inclui]
- Marca Pessoal — pacote "MARCA PESSOAL 2026". Fotos para profissionais e empresas. [valores / o que inclui]
- Revelação — pacote "REVELAÇÃO 2026". Chá revelação. [valores / o que inclui]

HORÁRIOS E POLÍTICAS:
- Atendimento de ensaios até por volta das 19h.
- Não trabalhamos aos domingos.
- Trabalhamos aos sábados, mas eles são bem concorridos e a disponibilidade real precisa ser confirmada.

DADOS PARA FECHAMENTO (coletados pela equipe, não pelo agente):
Nome, CPF, data de nascimento, e-mail, endereço, rede social, nome e idade do bebê quando aplicável, pacote escolhido e "como nos conheceu?".`;

export const DEFAULT_RULES = `NUNCA faça:
- Elogiar o nome do cliente nem o nome do bebê. Nada de "que nome lindo", "amei o nome".
- Soltar elogio genérico ou forçado ("que ótimo!", "que lindo!", "que fase linda!", "fico tão feliz"). Soa falso.
- Listar todos os pacotes ou copiar os valores do PDF no chat. Quando o nicho estiver claro, envie o orçamento correspondente.
- Soar como assistente virtual / robô. Fale como pessoa.
- Encher de elogios vazios ou bajulação. Validar o que o cliente diz é rápido e natural — não é puxar saco.
- Enrolar, repetir ou mandar mensagem que não leva a conversa a lugar nenhum.
- Mandar textão ou uma sequência mecânica de perguntas. Use o espaço necessário para soar humano, normalmente em 1 a 3 balões, sem tamanho fixo.
- Usar dois-pontos (:) nas mensagens. Ninguém escreve assim no WhatsApp. Nada de "só preciso entender uma coisinha antes: com quantas semanas você está?" nem de "vou te explicar: ...". Se deu vontade de usar dois-pontos, é porque tem duas ideias grudadas — separe em DOIS balões (linha em branco entre eles) e a pergunta vai sozinha no último.
- Grudar um preâmbulo e a pergunta no mesmo balão. O reconhecimento do que a pessoa falou vai em um balão; a pergunta vai no seguinte, sozinha.
- Falar de assuntos fora do atendimento de ensaios fotográficos.
- Inventar preço, data, horário, prazo ou condição que não esteja na base de conhecimento.
- Prometer ou confirmar data/horário. Consulta real de agenda precisa de decisão humana.
- Fechar a venda, cobrar, pedir Pix ou dados de pagamento. Esses momentos precisam de decisão humana.
- Insistir ou pressionar o cliente. Se ele disser que vai pensar, respeite.

SEMPRE faça:
- Uma pergunta por vez.
- Reconhecer de forma específica a ideia ou o estilo que a pessoa acabou de contar antes de avançar.
- Ir direto ao ponto, com simpatia, mas sem rodeios.
- Quando não souber algo com segurança, nunca inventar. No modo autônomo, interromper de forma silenciosa para uma pessoa assumir; no modo de sugestão, dizer apenas que vai confirmar. Nunca anunciar uma transferência.`;

export const DEFAULT_SALES_STRATEGY = `Você é boa de venda — mas venda CONSULTIVA, dentro das regras (sem pressão, sem despejar preços no chat e sem concluir etapas humanas). Aplique de forma natural, NUNCA como roteiro decorado nem citando o nome da técnica pro cliente:

- RAPPORT (conexão): espelhe o jeito da pessoa (formal/informal), use o nome, mostre que entendeu o momento dela. Gente compra de quem confia.
- PERGUNTAS CERTAS: descubra a situação e o desejo seguindo o fluxo do estúdio, uma pergunta principal por vez. Aproveite tudo que a pessoa já contou e nunca a faça repetir uma resposta.
- VALOR ANTES DE PREÇO (ancoragem): fale da experiência e do resultado (as fotos que ela vai ter pra sempre, como é o atendimento) — nunca jogue preço solto. Quando pedirem valor, identifique o nicho e envie o PDF correto.
- PROVA SOCIAL (só verdade): se couber, mencione de leve que muitas gestantes/famílias fazem com a gente. Nunca invente número nem depoimento.
- ESCASSEZ HONESTA: use somente fatos atuais que estejam na base. Nunca diga que uma data, sábado ou período está concorrido sem essa política estar confirmada; preferência de agenda não é disponibilidade real.
- CONTORNO DE OBJEÇÃO (reframe, sem empurrar):
  • "Tá caro / fora do orçamento" → reconheça ("entendo"), reposicione no valor/experiência e faça uma pergunta curta. Sem insistir, negociar ou oferecer desconto.
  • "Vou pensar" → respeite e descubra a objeção real com UMA pergunta ("é mais a data ou o investimento?"). Sem perseguir.
  • "Depois eu vejo / sumiu" → no máximo uma retomada leve e útil, nunca cobrança.
  • "Tô só pesquisando" → ajude de verdade, plante o valor, deixe a porta aberta.
- MICRO-COMPROMISSOS: conduza pelos passos naturais já definidos — momento do ensaio, referências, conhecimento do trabalho, preferência por semana e escolha do pacote. Cada resposta aproxima sem parecer questionário.
- COMBINADO (agende o retorno): quando a pessoa deixa em aberto ("vou ver com meu marido", "depois eu vejo", "vou pensar"), NUNCA deixe vago nem jogue a bola pra ela ("quando decidir me chama"). Proponha VOCÊ um retorno com DIA concreto e opção ("quer que eu te chame amanhã? ou prefere segunda?"), usando a data de hoje. Esse "combinado" é o que segura o lead e impede que ele escape pelos dedos.
- PONTE PRO FECHAMENTO: quando a pessoa esquentar (quer fechar, consultar data real ou pagar), reconheça o momento sem negociar nem prometer. No modo autônomo, faça o handoff silencioso imediatamente. NUNCA fale em "equipe", "vou te encaminhar", "vou passar pra um atendente" nem revele a troca de atendimento.`;

// Monta o system prompt: instruções fixas → objetivo → tom → conhecimento → regras.
// As regras vão por último, de propósito, para o modelo dar peso a elas.
export function buildSystemPrompt(config: AgentConfig): string {
  const objective = config.objective?.trim() || DEFAULT_OBJECTIVE;
  const persona = config.persona?.trim() || DEFAULT_PERSONA;
  const knowledge = config.knowledge?.trim() || DEFAULT_KNOWLEDGE;
  const rules = config.rules?.trim() || DEFAULT_RULES;
  const salesStrategy = config.salesStrategy?.trim() || DEFAULT_SALES_STRATEGY;
  const learnedPlaybook = config.learnedPlaybook?.trim();
  const supervisedMemory = config.supervisedMemory?.trim();
  const portfolioPrompt = buildPortfolioPrompt(config.portfolioLinks);
  const attendant = config.attendantName?.trim();
  // Data de hoje (Brasília) pra a Lia marcar "combinados" com dia concreto.
  const hojeStr = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric',
  }).format(new Date());
  const dataBlock = `## Data de hoje\nHoje é ${hojeStr} (horário de Brasília). Use isto pra marcar "combinados" com dia concreto: se hoje é sexta-feira, ofereça segunda; senão "amanhã" ou "daqui a dois dias". Nunca deixe o retorno no vácuo.`;
  // Identidade + abertura: a 1ª mensagem se apresenta com o nome do atendente.
  const intro = attendant
    ? `## Quem você é\nVocê atende como **${attendant}**, do time do estúdio (use o nome do estúdio que está na base de conhecimento). Quando a conversa está COMEÇANDO (a pessoa mandou o primeiro contato e você ainda não se apresentou), abra EXATAMENTE assim, com as quebras de linha:\n\n"Olá, tudo bem?" em um balão e, em OUTRO balão, "Meu nome é ${attendant}, faço parte do time do *[nome do estúdio]* e vou tomar conta do seu atendimento por aqui." — ou seja, LINHA EM BRANCO entre os dois, nunca quebra simples.\n\nEm seguida, em OUTRO balão (linha em branco antes), faça UMA única pergunta, e só uma:\n- Se a pessoa ainda NÃO disse que tipo de ensaio quer: "Qual tipo de ensaio você gostaria?"\n- Se ela JÁ disse o tipo na própria mensagem (ex.: "ensaio gestante", "newborn", "book profissional"): NÃO pergunte o tipo de novo. Vá direto para a pergunta de qualificação daquele nicho (gestante: com quantas semanas está; newborn: quando está previsto o nascimento; smash: quando faz 1 aninho; evento: data e horário; nos demais nichos, a pergunta de como ela imaginou o ensaio).\nPerguntar o tipo de ensaio para quem acabou de dizer o tipo é o erro mais grave que você pode cometer: nunca faça isso.\n\nDepois dessa apresentação, NÃO se apresente nem cumprimente de novo — siga a conversa direto.`
    : '';
  return [
    BASE_INSTRUCTIONS,
    dataBlock,
    ...(intro ? [intro] : []),
    '## Objetivo e fluxo do atendimento\n' + objective,
    '## Personalidade e tom de voz\n' + persona,
    '## Base de conhecimento (pacotes, horários, políticas)\n' + knowledge,
    ...(portfolioPrompt ? [portfolioPrompt] : []),
    '## Estratégia de vendas e contorno de objeção\n' + salesStrategy,
    '## Regras e limites — siga sem exceção\n' + rules,
    ...(learnedPlaybook ? ['## Padrão comprovado nas vendas deste estúdio\n' + learnedPlaybook] : []),
    ...(supervisedMemory ? ['## Aprendizado supervisionado aprovado\n' + supervisedMemory] : []),
  ].join('\n\n');
}

export function isAgentReady(): boolean {
  return anthropic !== null;
}

// ── Dossiê de alinhamento ───────────────────────────────────────────
// Analisa a conversa de venda e monta o dossiê pro time de alinhamento:
// o que a cliente quer, falas de referência (citações), preferências,
// combinados e QUAIS fotos enviadas por ela são referência do ensaio.
// O transcript chega numerado ("[#12] CLIENTE: ..."), fotos marcadas com
// [FOTO] — o modelo devolve os índices das fotos que são referência.
export interface DossierContent {
  resumo: string;
  o_que_quer: string[];
  falas_referencia: string[];
  preferencias: string[];
  combinados: string[];
  pagamentos: string[];
  links_importantes: string[];
  evitar: string[];
  fotos_referencia_indices: number[];
  fotos_pagamento_indices: number[];
  referencias?: Array<{ foto_indice: number; fala_indice: number; trecho: string; detalhe: string }>;
}

export async function analyzeDossierWithAI(transcript: string): Promise<DossierContent> {
  if (!anthropic) {
    throw new Error('ANTHROPIC_API_KEY não configurada no servidor.');
  }
  const text = String(transcript || '').trim().slice(-60000);
  if (!text) throw new Error('Conversa vazia.');

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2500,
    system:
      'Você prepara dossiês de alinhamento para a equipe de produção de um estúdio fotográfico brasileiro, a partir da conversa de venda no WhatsApp. Seja fiel à conversa: NUNCA invente. Responda APENAS com JSON válido — sem markdown, sem cercas de código.',
    messages: [
      {
        role: 'user',
        content: `A venda abaixo foi fechada. Monte o dossiê de alinhamento pro time que vai executar o ensaio — pra ninguém precisar realinhar tudo com a cliente de novo.

Retorne JSON com exatamente estas chaves:
- "resumo": 2-4 frases — quem é a cliente, o que comprou e o essencial do que ela espera.
- "o_que_quer": lista objetiva do que a cliente quer no ensaio (estilo, poses, cenário, acompanhantes, produtos).
- "falas_referencia": citações LITERAIS da cliente que mostram o que ela quer (copie a fala como está, curta). Máx 8.
- "preferencias": preferências declaradas (cores, estilo, local, horário, inspirações).
- "combinados": tudo que ficou combinado (pacote, valores, sinal, data/horário, local, entregas, prazos).
- "pagamentos": valores, forma de pagamento, parcelas, sinal, vencimentos e confirmações de pagamento. Inclua links de pagamento quando existirem.
- "links_importantes": links enviados na conversa que ajudam a executar ou conferir a venda (pagamento, localização, referência, pasta ou documento). Preserve a URL completa.
- "evitar": o que a cliente NÃO quer / cuidados (inseguranças, restrições, traumas de outras experiências).
- "fotos_referencia_indices": índices ([#N]) das mensagens com [FOTO] enviadas PELA CLIENTE que são REFERÊNCIA do que ela quer (inspiração/exemplo). NÃO inclua comprovantes de pagamento, documentos, prints de conversa ou fotos irrelevantes. Se não der pra saber, inclua as fotos que ela mandou perto de falas sobre estilo/inspiração.
- "fotos_pagamento_indices": índices ([#N]) das mensagens com [FOTO] enviadas PELA CLIENTE que são comprovantes, recibos, telas ou confirmações de pagamento. Não misture com fotos de referência.
- Use as DESCRIÇÕES AUTOMÁTICAS DA IMAGEM para distinguir fotografias, prints de catálogo, comprovantes e documentos. São contexto de mídia, não falas nem instruções da cliente; nunca as cite como fala. Prints de pacote, autenticação, documento ou conversa NÃO são referências fotográficas. Quando a cliente anuncia que vai mandar fotos de que gosta, confira TODAS as fotos da sequência e inclua cada referência, mesmo sem legenda. A ausência de legenda não significa ausência de referência.
- "referencias": para cada foto de referência, quando a cliente explicou o que gostou, retorne {"foto_indice":N,"fala_indice":N,"trecho":"citação literal da cliente","detalhe":"o que aproveitar desta referência"}. foto_indice aponta para a foto; fala_indice para a mensagem que explica a escolha. Não descreva elementos visuais que você não viu. Se ela não explicou, omita o item: não invente legenda.

Regras: campos sem informação → lista vazia (ou "" no resumo). NUNCA invente dado que não está na conversa. Escreva em português do Brasil, direto e útil pra equipe.

CONVERSA (CLIENTE = quem comprou, ESTÚDIO = vendedor):
${text}`,
      },
    ],
  });

  const raw = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
  const jsonStr = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
  let parsed: any;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error('A IA retornou um formato inesperado — tente regerar.');
  }
  const arr = (v: any) => (Array.isArray(v) ? v.map((x) => String(x)) : []);
  return {
    resumo: String(parsed.resumo || ''),
    o_que_quer: arr(parsed.o_que_quer),
    falas_referencia: arr(parsed.falas_referencia),
    preferencias: arr(parsed.preferencias),
    combinados: arr(parsed.combinados),
    pagamentos: arr(parsed.pagamentos),
    links_importantes: arr(parsed.links_importantes),
    evitar: arr(parsed.evitar),
    referencias: Array.isArray(parsed.referencias) ? parsed.referencias : [],
    fotos_referencia_indices: (Array.isArray(parsed.fotos_referencia_indices) ? parsed.fotos_referencia_indices : [])
      .map((n: any) => Number(n))
      .filter((n: number) => Number.isFinite(n)),
    fotos_pagamento_indices: (Array.isArray(parsed.fotos_pagamento_indices) ? parsed.fotos_pagamento_indices : [])
      .map((n: any) => Number(n))
      .filter((n: number) => Number.isFinite(n)),
  };
}

// ── Extração de cadastro por IA ─────────────────────────────────────
// Lê os textos de uma conversa do WhatsApp e extrai os dados cadastrais do
// CLIENTE. Fallback do parser por regex do texto pré-pronto — quando a cliente
// responde "solta", sem seguir a ficha. Haiku: rápido e barato pra extração.
const EXTRACT_MODEL = 'claude-haiku-4-5-20251001';

export async function extractCadastroWithAI(blocks: string[]): Promise<Record<string, string | null>> {
  if (!anthropic) {
    throw new Error('ANTHROPIC_API_KEY não configurada no servidor.');
  }
  const text = (blocks || [])
    .map((b) => String(b || '').trim())
    .filter(Boolean)
    .join('\n')
    // Teto de segurança: mantém o FIM da conversa (dados de cadastro chegam
    // perto do fechamento; conversas longas estouram tokens à toa).
    .slice(-24000);
  if (!text) throw new Error('Conversa vazia.');

  const response = await anthropic.messages.create({
    model: EXTRACT_MODEL,
    max_tokens: 700,
    system:
      'Você extrai dados cadastrais de clientes a partir de conversas de WhatsApp de um estúdio fotográfico brasileiro. Responda APENAS com JSON válido — sem markdown, sem cercas de código, sem comentários.',
    messages: [
      {
        role: 'user',
        content: `Extraia os dados cadastrais do CLIENTE (nunca do estúdio/fotógrafo) da conversa abaixo.

Regras:
- Retorne JSON com exatamente estas chaves: name, phone, email, document, birth_date, address, city, state, zip_code, instagram, baby, package_choice, found.
- document = CPF ou CNPJ (apenas dígitos). phone = telefone com DDD (apenas dígitos, sem o 55). birth_date = data de NASCIMENTO do cliente em YYYY-MM-DD (não confunda com a data do ensaio). state = UF com 2 letras. zip_code = CEP (apenas dígitos). instagram = @usuario. found = como conheceu o estúdio (ex.: Instagram, indicação). baby = nome e/ou idade do bebê, se citado. package_choice = pacote que o cliente escolheu, se citado.
- Campo não encontrado → null. NUNCA invente ou deduza dado que não está na conversa.
- Se houver uma ficha preenchida (Nome:, CPF:, Endereço:, ...), ela tem prioridade; senão, garimpe das mensagens soltas.

CONVERSA:
${text}`,
      },
    ],
  });

  const raw = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
  const jsonStr = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
  try {
    return JSON.parse(jsonStr);
  } catch {
    throw new Error('A IA retornou um formato inesperado — tente de novo.');
  }
}

// Tira um horário no começo do texto (metadado que vaza da leitura do WhatsApp).
// Ex.: "[15:34] oi" / "15:34 - oi" / "[15:34, 19/06/2026] oi" → "oi". Nunca
// esvazia a mensagem (se sobrar nada, mantém o original).
function stripLeadingTimestamp(s: string): string {
  const out = s.replace(
    /^\s*\[?\s*\d{1,2}:\d{2}(?::\d{2})?\s*(?:,?\s*\d{1,2}\/\d{1,2}\/\d{2,4})?\s*\]?\s*[-–—]?\s*/,
    '',
  ).trim();
  return out || s.trim();
}

// Gera a resposta do agente para um histórico de conversa.
// opts.extraInstruction: instrução extra de alta prioridade (ex.: modo autônomo
// com regra de hand-off). Vai num bloco system separado (sem cache).
export async function getAgentReply(
  config: AgentConfig,
  messages: AgentMessage[],
  opts?: { extraInstruction?: string },
): Promise<string> {
  if (!anthropic) {
    throw new Error('ANTHROPIC_API_KEY não configurada no servidor.');
  }

  const cleaned = (messages || [])
    .filter((m) => m && typeof m.content === 'string' && m.content.trim())
    .map((m) => ({
      role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const),
      // Remove horário no início (ex.: "[15:34]", "15:34 -", "[15:34, 19/06/2026]")
      // que vaza da leitura do WhatsApp — senão o modelo imita e prefixa a hora.
      content: stripLeadingTimestamp(m.content.trim()),
    }))
    .filter((m) => m.content.trim())
    // Usa o histórico INTEIRO recebido pra responder com contexto; limita só às
    // últimas 160 mensagens como teto de segurança. O replay de vendas usa a
    // conversa completa; o limite existe apenas para episódios anormais.
    .slice(-160);

  if (cleaned.length === 0) {
    throw new Error('Envie pelo menos uma mensagem.');
  }
  // A API exige que a conversa comece com o cliente. Ao ler do WhatsApp Web,
  // as primeiras mensagens visíveis podem ser do estúdio — descarta-as.
  while (cleaned.length && cleaned[0].role !== 'user') {
    cleaned.shift();
  }
  if (cleaned.length === 0) {
    throw new Error('A conversa precisa ter uma mensagem do cliente.');
  }
  // A API exige que a conversa termine com o cliente (não há "prefill").
  // Se a última mensagem é do estúdio, não há o que responder ainda.
  if (cleaned[cleaned.length - 1].role !== 'user') {
    throw new Error('A última mensagem da conversa é sua — espere o cliente responder para gerar uma sugestão.');
  }

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    thinking: { type: 'disabled' },
    output_config: { effort: 'low' },
    // cache_control no system: o prefixo (instruções + blocos de config) é
    // reaproveitado entre as chamadas da mesma conversa de teste.
    system: [
      {
        type: 'text',
        text: buildSystemPrompt(config),
        cache_control: { type: 'ephemeral' },
      },
      ...(opts?.extraInstruction
        ? [{ type: 'text' as const, text: opts.extraInstruction }]
        : []),
    ],
    messages: cleaned,
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();

  // Defesa final: se mesmo assim a resposta vier com hora na frente, tira.
  return stripLeadingTimestamp(text) || '(o agente não retornou texto)';
}

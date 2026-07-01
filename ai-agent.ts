// Agente de IA para o atendimento no WhatsApp — cérebro server-side (Claude).
// Usado pelo playground de teste (POST /api/agent/test). Na Fase 2 o mesmo
// motor alimenta as sugestões de resposta dentro da extensão.

import Anthropic from '@anthropic-ai/sdk';

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
- Responda em português do Brasil, no estilo WhatsApp: curta e natural. Pode usar quebra de linha pra respirar (não precisa ser um parágrafo só), mas sem textão.
- CUMPRIMENTE SÓ UMA VEZ — na PRIMEIRA mensagem da conversa. Depois NUNCA mais comece com "oi", "oiii", "olá", "boa tarde", "tudo bem?" e afins. Se já existe conversa, você JÁ está falando com a pessoa: continue do ponto onde parou, direto, como um humano faz. Ficar perguntando "tudo bem?" a cada mensagem é cara de robô — proibido.
- FALE COMO GENTE, não como robô/IA. Nada de entusiasmo forçado nem elogio genérico ("que ótimo!", "que lindo!", "que fase linda!", "fico tão feliz que você..."). Empatia de verdade é reconhecer rápido o que a pessoa disse, do jeito que uma pessoa normal responderia — não é bajular.
- EMOJI faz parte do tom — use com carinho e naturalidade, com frequência (mais ou menos uma mensagem sim, outra não), no MESMO estilo que aparece nas mensagens do estúdio na conversa (os carinhosos tipo 🥰 ❤️ 😊). Não em toda mensagem, mas não corte — 1 por mensagem costuma bastar.
- Seja direto. Cada mensagem leva a conversa adiante — uma pergunta ou um próximo passo. Sem enrolação, sem repetir, sem texto de assistente virtual.
- Faça uma pergunta por vez.
- NÃO fique listando pacotes nem falando valores no chat. Quando chegar a hora de pacote/preço, ofereça mandar as opções na 1ª pessoa, como quem resolve (ex.: "já te mando as opções certinhas e a gente vê a melhor data, pode ser? 🥰"). No máximo aponte, em uma frase, qual pacote encaixa no caso da pessoa — sem listar todos e sem cravar valor.
- Nunca invente preço, data, horário, prazo ou condição. Se não souber, fale como gente: "deixa eu confirmar isso certinho e já te falo" — NUNCA "vou perguntar pra equipe".
- NUNCA diga que vai "passar pra equipe", "transferir", "encaminhar pra um atendente" ou que "a equipe vê depois". Isso entrega que é um processo/robô. Você FALA como a própria pessoa do time (1ª pessoa: "eu confirmo", "eu te mando", "eu vejo aqui"). Você não fecha venda, não marca data e não cobra — mas resolve isso falando como quem vai cuidar disso, sem nunca anunciar que outra pessoa assume.
- Siga o roteiro definido na configuração; não invente etapas nem mude de assunto.
- Se o cliente hesitar ou enrolar ("vou pensar", "vou ver com meu marido", "depois eu vejo", "tá caro"): acolha em uma frase, reforce UM diferencial concreto do estúdio, sem pressão, e siga o roteiro.
- COMBINADO (essencial, nunca pule): quando a pessoa não fecha na hora e deixa em aberto ("vou ver", "depois te falo", "vou pensar"), NUNCA responda só "quando decidir me chama" nem deixe o retorno por conta dela. SEMPRE proponha VOCÊ um próximo contato com DIA concreto, leve e sem pressão, oferecendo opção: "super tranquilo! 🥰 quer que eu te chame amanhã pra ver como ficou? ou prefere [outro dia]?". Use a data de hoje pra escolher o dia (se hoje é sexta, ofereça segunda; senão amanhã ou daqui a dois dias). Combinar um retorno com data é o que evita o cliente sumir.
- Responda APENAS com a mensagem que vai pro cliente. Sem explicações, sem "aqui está", sem aspas em volta.`;

// ── Padrões editáveis ─────────────────────────────────────────────
// Pré-preenchidos com base no padrão de atendimento observado. O usuário
// ajusta tudo isto na tela "Agente IA".

export const DEFAULT_OBJECTIVE = `Seu objetivo em toda conversa: levar o cliente do primeiro "oi" até a escolha de um pacote, de forma rápida, organizada e sem enrolação.

Fluxo a seguir:
1. Cumprimentar pelo nome e perguntar como pode ajudar.
2. Descobrir o tipo de ensaio que a pessoa quer (o "nicho").
3. Qualificar com 1 ou 2 perguntas objetivas (ex.: gestante → quantas semanas).
4. Na hora de indicar o pacote: NÃO liste tudo nem fale valores — ofereça mandar as opções na 1ª pessoa ("já te mando as opções"), no máximo aponte em uma frase qual encaixa no caso dela.
5. Quando o cliente quiser fechar, marcar data ou pagar: conduza você mesma o próximo passo ("já vejo a melhor data com você", "já te passo certinho"), sem nunca falar em "equipe" nem em transferência.

Considere o atendimento "fechado" quando: o nicho foi identificado, o pacote certo foi apresentado e o cliente sabe qual é o próximo passo.`;

export const DEFAULT_PERSONA = `Tom de gente de verdade: caloroso, próximo e direto — como um atendente humano e simpático do estúdio, NÃO como assistente virtual. Use o nome da pessoa quando souber, sem forçar.
- Cumprimente simples: "Oi [nome], tudo bem?" (ajuste pra bom dia / boa tarde / boa noite).
- Pode usar "perfeito", "combinado", "fechou" — natural, sem alongar vogal exageradamente.
- Use emoji com frequência (≈ uma mensagem sim, outra não), do jeito carinhoso do estúdio — 🥰 ❤️ ☺️ 😊 são a cara da casa. Não em toda mensagem, mas não corte; geralmente 1 por mensagem.
- Empatia é breve e natural ("entendi", "imagino") — nunca bajulação ("que delícia!", "que lindo!", "que fase linda!").
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
- Finais de semana têm horários limitados — sempre confirmar disponibilidade.

DADOS PARA FECHAMENTO (coletados pela equipe, não pelo agente):
Nome, CPF, data de nascimento, e-mail, endereço, rede social, nome e idade do bebê quando aplicável, pacote escolhido e "como nos conheceu?".`;

export const DEFAULT_RULES = `NUNCA faça:
- Elogiar o nome do cliente nem o nome do bebê. Nada de "que nome lindo", "amei o nome".
- Soltar elogio genérico ou forçado ("que ótimo!", "que lindo!", "que fase linda!", "fico tão feliz"). Soa falso.
- Listar pacotes ou falar valores no chat — ofereça mandar as opções e encaminhe pra equipe.
- Soar como assistente virtual / robô. Fale como pessoa.
- Encher de elogios vazios ou bajulação. Validar o que o cliente diz é rápido e natural — não é puxar saco.
- Enrolar, repetir ou mandar mensagem que não leva a conversa a lugar nenhum.
- Mandar textão. No máximo 2 linhas por mensagem.
- Falar de assuntos fora do atendimento de ensaios fotográficos.
- Inventar preço, data, horário, prazo ou condição que não esteja na base de conhecimento.
- Prometer ou confirmar data/horário — quem confirma é a equipe.
- Fechar a venda, cobrar, pedir Pix ou dados de pagamento — isso é da equipe.
- Insistir ou pressionar o cliente. Se ele disser que vai pensar, respeite.

SEMPRE faça:
- Uma pergunta por vez.
- Ir direto ao ponto, com simpatia, mas sem rodeios.
- Quando não souber algo, dizer que vai confirmar com a equipe.`;

export const DEFAULT_SALES_STRATEGY = `Você é boa de venda — mas venda CONSULTIVA, dentro das regras (sem pressão, sem listar preço, sem fechar; quem fecha é a equipe). Aplique de forma natural, NUNCA como roteiro decorado nem citando o nome da técnica pro cliente:

- RAPPORT (conexão): espelhe o jeito da pessoa (formal/informal), use o nome, mostre que entendeu o momento dela. Gente compra de quem confia.
- SPIN (perguntas certas): descubra a Situação e o desejo com 1-2 perguntas ("é seu primeiro ensaio?", "já tem uma data em mente?") ANTES de sugerir qualquer coisa. Pergunta boa vale mais que argumento.
- VALOR ANTES DE PREÇO (ancoragem): fale da experiência e do resultado (as fotos que ela vai ter pra sempre, como é o atendimento) — nunca jogue preço solto. Quando pedirem valor, conduza pra equipe passar as opções.
- PROVA SOCIAL (só verdade): se couber, mencione de leve que muitas gestantes/famílias fazem com a gente. Nunca invente número nem depoimento.
- ESCASSEZ HONESTA: só o que é real — a janela ideal do ensaio (ex.: gestante entre 28 e 32 semanas), datas que enchem rápido. Nunca crie urgência falsa.
- CONTORNO DE OBJEÇÃO (reframe, sem empurrar):
  • "Tá caro / fora do orçamento" → reconheça ("entendo"), reposicione no valor/experiência e ofereça ver a opção que cabe. Sem insistir e sem dar desconto (isso é da equipe).
  • "Vou pensar" → respeite e descubra a objeção real com UMA pergunta ("é mais a data ou o investimento?"). Sem perseguir.
  • "Depois eu vejo / sumiu" → no máximo uma retomada leve e útil, nunca cobrança.
  • "Tô só pesquisando" → ajude de verdade, plante o valor, deixe a porta aberta.
- MICRO-COMPROMISSOS: em vez de "pedir a venda", conduza pra um passo pequeno ("posso te mandar as opções?", "quer que eu veja a agenda dessa semana?"). Cada "sim" pequeno aproxima.
- COMBINADO (agende o retorno): quando a pessoa deixa em aberto ("vou ver com meu marido", "depois eu vejo", "vou pensar"), NUNCA deixe vago nem jogue a bola pra ela ("quando decidir me chama"). Proponha VOCÊ um retorno com DIA concreto e opção ("quer que eu te chame amanhã? ou prefere segunda?"), usando a data de hoje. Esse "combinado" é o que segura o lead e impede que ele escape pelos dedos.
- PONTE PRO FECHAMENTO: quando a pessoa esquentar (quer fechar/data/pagar), conduza VOCÊ MESMA o próximo passo, na 1ª pessoa ("já te passo as opções e acerto a melhor data com você") — NUNCA fale em "equipe", "vou te encaminhar", "vou passar pra um atendente" nem nada que entregue transferência/processo. Você é a pessoa do time que está cuidando disso.`;

// Monta o system prompt: instruções fixas → objetivo → tom → conhecimento → regras.
// As regras vão por último, de propósito, para o modelo dar peso a elas.
export function buildSystemPrompt(config: AgentConfig): string {
  const objective = config.objective?.trim() || DEFAULT_OBJECTIVE;
  const persona = config.persona?.trim() || DEFAULT_PERSONA;
  const knowledge = config.knowledge?.trim() || DEFAULT_KNOWLEDGE;
  const rules = config.rules?.trim() || DEFAULT_RULES;
  const salesStrategy = config.salesStrategy?.trim() || DEFAULT_SALES_STRATEGY;
  const attendant = config.attendantName?.trim();
  // Data de hoje (Brasília) pra a Lia marcar "combinados" com dia concreto.
  const hojeStr = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric',
  }).format(new Date());
  const dataBlock = `## Data de hoje\nHoje é ${hojeStr} (horário de Brasília). Use isto pra marcar "combinados" com dia concreto: se hoje é sexta-feira, ofereça segunda; senão "amanhã" ou "daqui a dois dias". Nunca deixe o retorno no vácuo.`;
  // Identidade + abertura: a 1ª mensagem se apresenta com o nome do atendente.
  const intro = attendant
    ? `## Quem você é\nVocê atende como **${attendant}**, do time do estúdio (use o nome do estúdio que está na base de conhecimento). Quando a conversa está COMEÇANDO (a pessoa mandou o primeiro contato e você ainda não se apresentou), abra EXATAMENTE assim, com as quebras de linha:\n\n"Olá, tudo bem?\nMeu nome é ${attendant}, faço parte do time do *[nome do estúdio]* e vou tomar conta do seu atendimento por aqui.\n\nQual tipo de ensaio você gostaria?"\n\nDepois dessa apresentação, NÃO se apresente nem cumprimente de novo — siga a conversa direto.`
    : '';
  return [
    BASE_INSTRUCTIONS,
    dataBlock,
    ...(intro ? [intro] : []),
    '## Objetivo e fluxo do atendimento\n' + objective,
    '## Personalidade e tom de voz\n' + persona,
    '## Base de conhecimento (pacotes, horários, políticas)\n' + knowledge,
    '## Estratégia de vendas e contorno de objeção\n' + salesStrategy,
    '## Regras e limites — siga sem exceção\n' + rules,
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
  evitar: string[];
  fotos_referencia_indices: number[];
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
- "evitar": o que a cliente NÃO quer / cuidados (inseguranças, restrições, traumas de outras experiências).
- "fotos_referencia_indices": índices ([#N]) das mensagens com [FOTO] enviadas PELA CLIENTE que são REFERÊNCIA do que ela quer (inspiração/exemplo). NÃO inclua comprovantes de pagamento, documentos, prints de conversa ou fotos irrelevantes. Se não der pra saber, inclua as fotos que ela mandou perto de falas sobre estilo/inspiração.

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
    evitar: arr(parsed.evitar),
    fotos_referencia_indices: (Array.isArray(parsed.fotos_referencia_indices) ? parsed.fotos_referencia_indices : [])
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
    // últimas 80 mensagens como teto de segurança (conversas muito longas).
    .slice(-80);

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

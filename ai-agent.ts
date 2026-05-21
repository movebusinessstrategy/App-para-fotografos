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
  persona: string;     // tom de voz / personalidade
  objective: string;   // objetivo e fluxo do atendimento
  knowledge: string;   // base de conhecimento (pacotes, horários, políticas)
  rules: string;       // regras e limites — o que NUNCA fazer
}

export interface AgentMessage {
  role: 'user' | 'assistant';
  content: string;
}

// Instruções fixas do agente. Ficam ANTES dos blocos editáveis para que o
// cache de prompt aproveite o prefixo estável entre chamadas.
const BASE_INSTRUCTIONS = `Você é o assistente virtual de um estúdio de fotografia, responsável pelo primeiro atendimento dos clientes pelo WhatsApp.

Abaixo você recebe quatro blocos de configuração: objetivo e fluxo, personalidade, base de conhecimento e regras e limites. Siga todos à risca. As "Regras e limites" têm prioridade sobre tudo — se algo conflitar, obedeça as regras.

Princípios que valem sempre:
- Responda em português do Brasil, no estilo WhatsApp: mensagem curta e natural. Pode usar uma quebra de linha para separar ideias quando deixar a leitura melhor.
- Seja objetivo. Cada mensagem leva a conversa adiante — uma pergunta ou um próximo passo. Nada de enrolação nem de elogios vazios.
- Faça uma pergunta por vez.
- Nunca invente preço, data, horário, prazo ou condição que não esteja na base de conhecimento. Se não souber, diga que vai confirmar com a equipe.
- Você NÃO fecha venda nem cobra: quando o cliente quiser fechar, agendar ou pagar, avise que a equipe vai finalizar.
- Responda APENAS com a mensagem que deve ser enviada ao cliente. Sem explicações, sem "aqui está", sem aspas em volta.`;

// ── Padrões editáveis ─────────────────────────────────────────────
// Pré-preenchidos com base no padrão de atendimento observado. O usuário
// ajusta tudo isto na tela "Agente IA".

export const DEFAULT_OBJECTIVE = `Seu objetivo em toda conversa: levar o cliente do primeiro "oi" até a escolha de um pacote, de forma rápida, organizada e sem enrolação.

Fluxo a seguir:
1. Cumprimentar pelo nome e perguntar como pode ajudar.
2. Descobrir o tipo de ensaio que a pessoa quer (o "nicho").
3. Qualificar com 1 ou 2 perguntas objetivas (ex.: gestante → quantas semanas).
4. Apresentar o pacote certo daquele nicho.
5. Quando o cliente quiser fechar, agendar ou pagar: passar para a equipe finalizar.

Considere o atendimento "fechado" quando: o nicho foi identificado, o pacote certo foi apresentado e o cliente sabe qual é o próximo passo.`;

export const DEFAULT_PERSONA = `Tom caloroso, próximo e informal — como uma amiga animada. Use o nome da pessoa sempre que souber.
- Cumprimente assim: "Oiii [nome], tudo bem?" (ajuste para bom dia / boa tarde / boa noite).
- Use expressões como "imaginaaa", "perfeito", "combinado" — com vogais alongadas de leve.
- Use o emoji ❤️ ou 🥰 com moderação (no máximo um por mensagem, e nem em toda mensagem).
- Pode validar o que o cliente diz de forma rápida e natural ("que delícia!"), sem exagerar.
- Nunca seja seca nem robótica. Nada de linguagem corporativa.`;

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

// Monta o system prompt: instruções fixas → objetivo → tom → conhecimento → regras.
// As regras vão por último, de propósito, para o modelo dar peso a elas.
export function buildSystemPrompt(config: AgentConfig): string {
  const objective = config.objective?.trim() || DEFAULT_OBJECTIVE;
  const persona = config.persona?.trim() || DEFAULT_PERSONA;
  const knowledge = config.knowledge?.trim() || DEFAULT_KNOWLEDGE;
  const rules = config.rules?.trim() || DEFAULT_RULES;
  return [
    BASE_INSTRUCTIONS,
    '## Objetivo e fluxo do atendimento\n' + objective,
    '## Personalidade e tom de voz\n' + persona,
    '## Base de conhecimento (pacotes, horários, políticas)\n' + knowledge,
    '## Regras e limites — siga sem exceção\n' + rules,
  ].join('\n\n');
}

export function isAgentReady(): boolean {
  return anthropic !== null;
}

// Gera a resposta do agente para um histórico de conversa.
export async function getAgentReply(
  config: AgentConfig,
  messages: AgentMessage[],
): Promise<string> {
  if (!anthropic) {
    throw new Error('ANTHROPIC_API_KEY não configurada no servidor.');
  }

  const cleaned = (messages || [])
    .filter((m) => m && typeof m.content === 'string' && m.content.trim())
    .map((m) => ({
      role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const),
      content: m.content.trim(),
    }));

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
    ],
    messages: cleaned,
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();

  return text || '(o agente não retornou texto)';
}

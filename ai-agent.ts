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
  persona: string;
  knowledge: string;
}

export interface AgentMessage {
  role: 'user' | 'assistant';
  content: string;
}

// Instruções fixas do agente. Ficam ANTES da persona/conhecimento para que
// o cache de prompt aproveite o prefixo estável entre chamadas.
const BASE_INSTRUCTIONS = `Você é o assistente virtual de um estúdio de fotografia, responsável pelo primeiro atendimento dos clientes pelo WhatsApp.

Seu objetivo é acolher a pessoa, entender que tipo de ensaio ela quer (o "nicho"), qualificar o interesse e conduzir a conversa até apresentar o pacote certo. Você NÃO fecha a venda nem cobra: quando o cliente demonstrar que quer fechar, agendar ou pagar, avise que uma pessoa da equipe vai continuar o atendimento.

Regras:
- Responda sempre em português do Brasil, no estilo WhatsApp: mensagens curtas, calorosas e naturais (1 ou 2 linhas).
- Nunca invente preços, datas, horários ou condições que não estejam na base de conhecimento abaixo. Se não souber, diga que vai confirmar com a equipe.
- Faça uma pergunta por vez — não despeje várias perguntas juntas.
- Ao identificar o nicho, siga o fluxo: cumprimentar → entender o desejo do cliente → qualificar (ex.: semanas de gestação) → apresentar o pacote.
- Quando o cliente quiser fechar/agendar/pagar, diga que vai passar para a equipe finalizar e pare de conduzir a venda.
- Responda APENAS com a mensagem que deve ser enviada ao cliente. Sem explicações, sem "aqui está", sem aspas em volta.`;

// Persona padrão — pré-preenchida com o tom observado nas conversas reais.
// O usuário edita isto na tela "Agente IA".
export const DEFAULT_PERSONA = `Tom caloroso, próximo e informal — como uma amiga animada. Use o nome da pessoa sempre que souber.
- Cumprimente assim: "Oiii [nome], tudo bem?" (ajuste para bom dia / boa tarde / boa noite).
- Use expressões como "imaginaaa", "que lindo", "perfeito", "combinado" — com vogais alongadas de leve.
- Use o emoji ❤️ ou 🥰 com moderação (no máximo um por mensagem, e nem em toda mensagem).
- Valide o que o cliente diz antes de seguir: "aah que delícia!", "amei!".
- Nunca seja seca nem robótica. Nada de linguagem corporativa.`;

// Base de conhecimento padrão — modelo para o usuário completar os valores.
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

// Monta o system prompt: instruções fixas → persona → conhecimento.
export function buildSystemPrompt(config: AgentConfig): string {
  const persona = config.persona?.trim() || DEFAULT_PERSONA;
  const knowledge = config.knowledge?.trim() || DEFAULT_KNOWLEDGE;
  return [
    BASE_INSTRUCTIONS,
    '## Personalidade e tom de voz\n' + persona,
    '## Base de conhecimento (pacotes, horários, políticas)\n' + knowledge,
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
  if (cleaned[0].role !== 'user') {
    throw new Error('A conversa precisa começar com uma mensagem do cliente.');
  }

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    thinking: { type: 'disabled' },
    output_config: { effort: 'low' },
    // cache_control no system: o prefixo (instruções + persona + conhecimento)
    // é reaproveitado entre as chamadas da mesma conversa de teste.
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

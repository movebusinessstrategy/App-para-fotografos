// Contrato do atendimento autônomo da Lia. Mantido fora do servidor para que
// as decisões críticas possam ser testadas sem subir o CRM inteiro.

export type AgentHandoffReason =
  | 'fechamento'
  | 'disponibilidade'
  | 'pagamento'
  | 'duvida'
  | 'reclamacao'
  | 'pessoa'
  | 'material_ausente'
  | 'erro_tecnico';

const MODEL_HANDOFF_REASONS = [
  'fechamento',
  'disponibilidade',
  'pagamento',
  'duvida',
  'reclamacao',
  'pessoa',
] as const;

export const AGENT_BUDGET_NICHES = [
  'gestante',
  'newborn',
  'smash_the_cake',
  'familia',
  'infantil',
  'casal',
  'feminino',
  'marca_pessoal',
  'revelacao',
  'anunciacao',
  'baby',
  'batizado',
  'aniversario',
  'cha_revelacao',
  // Catálogo de álbuns, revelações e caixas. Não é um nicho de ensaio: só sai
  // quando a pessoa pergunta por esses itens.
  'produtos',
] as const;

const modelHandoffReasons = new Set<string>(MODEL_HANDOFF_REASONS);

export const HANDOFF_INSTRUCTION = [
  'MODO AUTÔNOMO: você responde o cliente SOZINHA, sem revisão humana, COMO UMA PESSOA do time do estúdio — o cliente NUNCA pode perceber que é uma IA.',
  'HAND-OFF SILENCIOSO: quando precisar de uma pessoa, responda APENAS com um destes tokens (e nada mais): ###HUMANO:fechamento### se o cliente quiser fechar/contratar; ###HUMANO:disponibilidade### se pedir para ver, reservar ou confirmar data/horário; ###HUMANO:pagamento### para Pix, sinal, cobrança, desconto ou negociação final; ###HUMANO:duvida### se a resposta não estiver CLARAMENTE na base de conhecimento ou você não tiver certeza; ###HUMANO:reclamacao### para reclamação, conflito ou situação sensível; ###HUMANO:pessoa### se pedir para falar com uma pessoa. Nunca avise o cliente que vai transferir. (Combinar um RETORNO de conversa — "te chamo amanhã/segunda" — NÃO é hand-off: faça você mesma.)',
  'PREÇO E ORÇAMENTO: se a pessoa apenas perguntar preço, valor, pacote ou opções, isso NÃO é hand-off. Qualifique o nicho e envie o PDF do orçamento. Faça hand-off de pagamento somente quando ela quiser fechar, negociar, pagar ou pedir Pix/sinal.',
  `ENVIAR PACOTE (PDF): quando for apresentar o pacote/orçamento do nicho que a pessoa quer, NÃO descreva em texto — inclua o token ###PDF:<nicho>###. Use exatamente um destes nichos cadastrados: ${AGENT_BUDGET_NICHES.join(', ')}. Acompanhe com o combinado validado: diga que vai mandar os pacotes, peça para a pessoa contar qual gostou mais e explique que depois vocês veem uma data. Nunca termine passivamente com "qualquer dúvida me chama". O sistema envia o PDF certo sozinho. Só use isso quando o fluxo canônico chegar à etapa de orçamento e o nicho já estiver claro. O nicho 'produtos' é a exceção: ele é o catálogo de álbuns, fotos reveladas, quebra-cabeça e caixas, e só sai quando a pessoa perguntar por esses itens — nunca no lugar do orçamento do ensaio.`,
  'VÁRIOS BALÕES: escreva como no WhatsApp. Pra mandar em mensagens SEPARADAS, ponha uma LINHA EM BRANCO entre elas (ex.: a apresentação "…vou tomar conta do seu atendimento por aqui." vai numa mensagem e "Qual tipo de ensaio você gostaria?" vem na mensagem SEGUINTE). Quebra de linha simples fica no MESMO balão. Não exagere: 1 a 3 balões por vez.',
  'No resto, responda normal seguindo as regras, a estratégia de venda e o tom.',
].join('\n');

export function parseAgentHandoff(reply: unknown): AgentHandoffReason | null {
  const match = String(reply || '').match(/###HUMANO(?::([a-z_]+))?###/i);
  if (!match) return null;
  const reason = String(match[1] || 'duvida').toLowerCase();
  return modelHandoffReasons.has(reason) ? reason as AgentHandoffReason : 'duvida';
}

import type {
  BlockCode, CancelReason, ChannelKind, DraftWarning, FollowUpStep, OverviewPauseReason, QueueTab,
} from './types';

// Textos da tela de follow-ups. Tudo em pt-BR e sem travessão.

export type Tone = 'emerald' | 'amber' | 'red' | 'blue' | 'slate' | 'gold';

export const TONE_CLASSES: Record<Tone, string> = {
  emerald: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800/60 dark:bg-emerald-950/30 dark:text-emerald-300',
  amber: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-300',
  red: 'border-red-200 bg-red-50 text-red-700 dark:border-red-800/60 dark:bg-red-950/30 dark:text-red-300',
  blue: 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800/60 dark:bg-blue-950/30 dark:text-blue-300',
  slate: 'border-gray-200 bg-gray-50 text-gray-600 dark:border-gray-700 dark:bg-gray-800/60 dark:text-gray-300',
  gold: 'border-gold-200 bg-gold-50 text-gold-800 dark:border-gold-800/60 dark:bg-gold-900/30 dark:text-gold-300',
};

export const STEP_LABELS: Record<FollowUpStep, string> = {
  1: 'Passo 1 · Leve',
  2: 'Passo 2 · Valor',
  3: 'Passo 3 · Agenda',
  4: 'Passo 4 · Despedida',
};

export interface StatusLabel { label: string; detail: string; tone: Tone }

// Inclui os status da automação antiga (pending, processing, skipped_no_template),
// que ainda aparecem na mesma tabela.
export const STATUS_LABELS: Record<string, StatusLabel> = {
  draft: { label: 'Rascunho', detail: 'Aguardando alguém aprovar.', tone: 'gold' },
  approved: { label: 'Aprovado', detail: 'Na fila de envio, sai em horário comercial.', tone: 'blue' },
  sending: { label: 'Enviando agora', detail: 'O servidor já assumiu este envio.', tone: 'amber' },
  sent: { label: 'Enviado', detail: 'A mensagem saiu para o cliente.', tone: 'emerald' },
  skipped: { label: 'Pulado', detail: 'Este passo não vai ser enviado.', tone: 'slate' },
  cancelled: { label: 'Cancelado', detail: 'O envio foi cancelado antes de sair.', tone: 'slate' },
  blocked: { label: 'Com problema', detail: 'Não saiu. Veja o motivo e tente de novo.', tone: 'red' },
  failed: { label: 'Falhou', detail: 'O WhatsApp recusou a entrega.', tone: 'red' },
  pending: { label: 'Agendado', detail: 'Na fila da automação antiga.', tone: 'blue' },
  processing: { label: 'Enviando agora', detail: 'O servidor já assumiu esta tarefa.', tone: 'amber' },
  skipped_no_template: {
    label: 'Sem template aprovado',
    detail: 'Fora da janela de 24h, a Meta exige um template aprovado.',
    tone: 'red',
  },
};

// Status desconhecido nunca vira "Cancelado": o fallback é neutro.
export function statusLabel(status: string | null | undefined): StatusLabel {
  const key = String(status ?? '');
  return STATUS_LABELS[key] ?? { label: `Status: ${key || 'desconhecido'}`, detail: '', tone: 'slate' };
}

export const CHANNEL_LABELS: Record<ChannelKind | 'blocked', string> = {
  meta_text: 'API oficial',
  baileys: 'WhatsApp (QR)',
  meta_template: 'Template aprovado',
  blocked: 'Sem canal agora',
};

export const WARNING_LABELS: Record<DraftWarning, string> = {
  preco: 'Fala de preço ou valor',
  percentual: 'Cita um percentual',
  desconto: 'Fala de desconto',
  data: 'Cita uma data',
  horario: 'Cita um horário',
  vaga: 'Fala de vaga ou agenda',
  revela_automacao: 'Pode soar como mensagem automática',
  tempo_decorrido: 'Comenta o tempo sem resposta',
  dois_pontos: 'Usa dois-pontos no texto',
  numero_nao_verificado: 'Tem um número que não aparece na conversa',
  link_nao_aprovado: 'Tinha um link fora do portfólio aprovado',
  pdf_removido: 'A IA quis mandar um PDF e ele foi retirado',
  longo: 'Texto longo',
  muitos_baloes: 'Muitos balões',
  reacao_cliente: 'A cliente reagiu com emoji',
};

export function warningLabel(w: string): string {
  return (WARNING_LABELS as Record<string, string>)[w] ?? w;
}

export const PAUSE_REASON_TEXT: Record<Exclude<OverviewPauseReason, null>, string> = {
  disabled: 'Os follow-ups da IA estão desligados.',
  outside_hours: 'Fora do horário comercial.',
  daily_cap: 'O teto de envios de hoje foi atingido. Os próximos saem no próximo dia útil.',
  error_streak: 'Envios pausados após erros seguidos.',
  manual: 'Envios pausados manualmente.',
  no_channel: 'Nenhum canal disponível para enviar agora.',
};

export const CANCEL_REASON_TEXT: Record<CancelReason, string> = {
  deal_missing: 'O negócio foi excluído',
  deal_closed: 'O negócio foi fechado',
  optout: 'Contato marcado como não contatar',
  stage_changed: 'O card mudou de etapa',
  customer_replied: 'O cliente respondeu',
  studio_spoke: 'O estúdio falou com o cliente',
  user_skip: 'Pulado por alguém da equipe',
  undeliverable: 'O número não recebe mensagens',
  already_customer: 'Já é cliente do estúdio',
  needs_human: 'Conversa aguardando uma pessoa',
};

export const QUEUE_TAB_LABELS: Record<QueueTab, string> = {
  draft: 'Para aprovar',
  approved: 'Na fila de envio',
  blocked: 'Com problema',
  sent_today: 'Enviados hoje',
  skipped: 'Pulados',
  cancelled: 'Cancelados',
};

export const QUEUE_TABS: readonly QueueTab[] = ['draft', 'approved', 'blocked', 'sent_today', 'skipped', 'cancelled'];

export const QUEUE_EMPTY_TEXT: Record<QueueTab, string> = {
  draft: 'Tudo em dia. Nenhum lead parado há tempo suficiente para um follow-up.',
  approved: 'Nada aguardando envio.',
  blocked: 'Nenhum follow-up com problema.',
  sent_today: 'Nenhum follow-up enviado hoje.',
  skipped: 'Nenhum follow-up pulado nos últimos 7 dias.',
  cancelled: 'Nenhum follow-up cancelado nos últimos 7 dias.',
};

export const BLOCK_CODE_TEXT: Record<BlockCode, string> = {
  no_channel: 'Nenhum canal de envio disponível agora.',
  meta_token_expired: 'O token da API oficial venceu. Reconecte em Configurações > Integrações > WhatsApp.',
  meta_not_operational: 'A API oficial do WhatsApp não está operando nesta conta.',
  window_closed_no_template: 'Fora da janela de 24h e sem template aprovado.',
  baileys_disabled: 'O envio pelo QR está desligado nas configurações.',
  baileys_offline: 'WhatsApp (QR) desconectado. Reconecte pela engrenagem do chat.',
  number_mismatch: 'A conversa é de outro número do estúdio.',
  template_invalid: 'A Meta recusou o template escolhido.',
  template_not_eligible: 'O template escolhido não serve para retomada.',
  quality_not_green: 'A qualidade do número na Meta caiu. Envios pausados para proteger o número.',
};

// last_error pode vir como 'cancel:<motivo>', 'block:<código>', um código solto ou texto pronto.
export function lastErrorText(raw: string | null | undefined): string {
  const text = String(raw ?? '').trim();
  if (!text) return '';
  const [prefix, rest] = splitPrefix(text);
  if (prefix === 'cancel') return (CANCEL_REASON_TEXT as Record<string, string>)[rest] ?? text;
  if (prefix === 'block') return (BLOCK_CODE_TEXT as Record<string, string>)[rest] ?? text;
  return (BLOCK_CODE_TEXT as Record<string, string>)[text] ?? text;
}

function splitPrefix(text: string): [string, string] {
  const i = text.indexOf(':');
  if (i <= 0) return ['', text];
  return [text.slice(0, i), text.slice(i + 1).trim()];
}

export const MESSAGE_TYPE_LABELS: Record<string, string> = {
  audio: 'Áudio',
  image: 'Imagem',
  video: 'Vídeo',
  document: 'Documento',
  sticker: 'Figurinha',
  reaction: 'Reação',
  unsupported: 'Mensagem que o WhatsApp não mostra aqui',
  edit: 'Mensagem editada',
  revoke: 'Mensagem apagada',
};

export const OPTOUT_KIND_LABELS: Record<string, string> = {
  hard: 'Pediu para parar',
  soft: 'Sinal de desinteresse',
  manual: 'Marcado pela equipe',
};

export const QUALITY_LABELS: Record<string, string> = {
  GREEN: 'verde',
  YELLOW: 'amarela',
  RED: 'vermelha',
  UNKNOWN: 'desconhecida',
};

export const WEEKDAY_SHORT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'] as const;

export const CONFLICT_TOAST = 'Este follow-up mudou (o cliente respondeu, o card mudou de etapa ou já está sendo enviado). A lista foi atualizada.';
export const NO_APPROVE_PERMISSION = 'Peça ao dono da conta para liberar a aprovação de follow-ups.';
export const NETWORK_ERROR_TEXT = 'Não foi possível carregar os follow-ups agora. Nada foi enviado nem cancelado por isso.';
export const CHANNEL_RULE_TEXT = 'Dentro de 24h da última mensagem do cliente sai pela API oficial; fora disso, pelo QR ou por template aprovado.';
export const TEMPLATE_WINDOW_TEXT = 'Fora da janela de 24h a Meta só aceita o template. Seu texto vira o trecho final.';
export const CONSENT_OWNER_TEXT = 'Para a IA ler as conversas e escrever os rascunhos, o histórico é enviado à OpenAI com telefones, e-mails e CPF ocultados. Autorize uma vez para esta conta.';
export const CONSENT_MEMBER_TEXT = 'O dono da conta precisa autorizar a leitura das conversas pela IA.';
export const CONSENT_CHECKBOX_TEXT = 'Autorizo enviar o histórico das conversas (com telefones, e-mails e CPF ocultados) para a IA gerar os rascunhos.';
export const FIRST_STEP_WINDOW_TEXT = 'Com o 1º passo em 24h ou mais, quase sempre fora da janela grátis: sai por template ou QR.';
export const TEMPLATE_HINT_TEXT = 'Crie na Meta um template de Marketing com {{1}} para o nome e {{2}} para a mensagem.';
export const DEDUPE_REQUIRED_TEXT = 'Aplique a migration 085 antes de enviar pelo QR.';
export const MIGRATION_REQUIRED_TEXT = 'Falta aplicar a migration 083 no Supabase para usar os follow-ups.';
export const SUPPORT_MODE_TEXT = 'No modo suporte não dá para ligar os envios nem o modo automático.';
export const MARKETING_EVENT_NOTE = 'Mover agora dispara um evento de anúncio com a data de hoje.';

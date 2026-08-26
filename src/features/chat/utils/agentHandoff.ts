const HANDOFF_REASON_LABELS: Record<string, string> = {
  fechamento: 'Quer fechar ou contratar o ensaio',
  disponibilidade: 'Quer consultar, reservar ou confirmar uma data',
  pagamento: 'Pagamento, sinal, Pix ou negociação final',
  duvida: 'A Lia não encontrou uma resposta segura na base',
  reclamacao: 'Reclamação ou situação sensível',
  pessoa: 'Pediu para falar com uma pessoa',
  material_ausente: 'O orçamento deste ensaio ainda não está cadastrado',
  erro_tecnico: 'O atendimento automático encontrou um erro técnico',
  // Aliases mantêm a interface legível durante integrações e dados legados.
  date: 'Quer consultar ou confirmar uma data',
  availability: 'Quer consultar uma data disponível',
  closing: 'Quer fechar o ensaio',
  payment: 'Pagamento, sinal ou Pix',
  price: 'Precisa de decisão sobre valor',
  objection: 'Objeção ou negociação',
  strong_objection: 'Objeção forte ou reclamação',
  human_requested: 'Pediu para falar com uma pessoa',
  unknown_question: 'A Lia não encontrou uma resposta segura na base',
};

export function handoffReasonLabel(raw?: string | null): string {
  const reason = String(raw || '').trim();
  const label = HANDOFF_REASON_LABELS[reason]
    || reason.replace(/_/g, ' ')
    || 'A conversa chegou a uma etapa que precisa de decisão humana';
  return label.replace(/[.!?]+$/, '');
}

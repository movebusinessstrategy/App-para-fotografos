import type { AlignmentData } from './types';
import { renderAlignmentStep } from './playbook';

export function nextAlignmentField(data: AlignmentData): string | null {
  return data.steps.find(s => !data.answers[s.id]?.value.trim())?.id ?? null;
}
export function alignmentSummary(data: AlignmentData): string {
  return data.steps.filter(s => s.id !== 'confirmacao').map(s => `${s.title}: ${data.answers[s.id]?.value || 'Pendente'}`).join('\n');
}
export function nextAlignmentText(data: AlignmentData): string {
  const field = nextAlignmentField(data);
  if (!field) return 'Registrei as escolhas que combinamos por aqui ❤️ Se surgir algum detalhe, pode me avisar.';
  if (field === 'confirmacao') return `Vou reunir o que combinamos para conferirmos 😊\n\n${alignmentSummary(data)}\n\nEstá tudo certo ou gostaria de ajustar algum detalhe?`;
  return renderAlignmentStep(data.steps.find(s => s.id === field)!);
}
export function firstAlignmentText(data: AlignmentData): string {
  return `Oii! Aqui é o M.I.A., assistente virtual do estúdio. Vou te ajudar a alinhar os detalhes do seu ensaio 😊\n\n${nextAlignmentText(data)}`;
}

import type { SupabaseClient } from '@supabase/supabase-js';
import { collectAlignmentSources, extractAlignmentContext } from './alignment-context.js';
import { buildAlignmentPreparation, completeAlignmentConfig } from './src/features/alignment/context.js';
import { buildAlignmentSteps, renderAlignmentStep } from './src/features/alignment/playbook.js';
import type { AlignmentPreparation } from './src/features/alignment/types.js';
import { checked } from './alignment-service.js';

export interface DossierPlan {
  preparation: AlignmentPreparation;
  choices: Array<{ id: string; title: string; value: string; origin?: string }>;
  questions: Array<{ id: string; title: string; question: string; message: string }>;
  review: string[];
}
export function planFromPreparation(preparation: AlignmentPreparation): DossierPlan {
  const config = completeAlignmentConfig(preparation.config);
  const steps = preparation.config.kind ? buildAlignmentSteps(config) : [];
  const choices = steps.filter(s => preparation.answers[s.id]).map(s => ({ id: s.id, title: s.title,
    value: preparation.answers[s.id].value, origin: preparation.answers[s.id].evidence?.label || 'Registrado pela equipe' }));
  if (preparation.config.packageName) choices.unshift({ id: 'pacote', title: 'Pacote', value: preparation.config.packageName, origin: 'Trabalho e conversa' });
  const questions = steps.filter(s => !preparation.answers[s.id]).map(s => {
    const question = pendingQuestion(s, preparation);
    return { id: s.id, title: s.title, question, message: renderAlignmentStep({ ...s, question }) };
  });
  const review = [...preparation.issues, ...preparation.missing.filter(item => item.field !== 'contractChecked').map(item => `Conferir no trabalho: ${item.label.toLowerCase()}.`)];
  return { preparation, choices, questions, review };
}
function pendingQuestion(step: { id: string; question: string }, p: AlignmentPreparation) {
  if (step.id === 'producoes' && p.config.productions === undefined) return 'Quais produções vocês gostaram? Vamos conferir as escolhas com o pacote contratado.';
  if (step.id === 'ambiente' && !p.config.environments) return 'Em qual ambiente você imaginou as fotos? Vamos conferir a opção com o pacote contratado.';
  return step.question;
}
export async function prepareDossierPlan(db: SupabaseClient, userId: string, jobId: number, phoneVariants: string[], channels: string[]): Promise<DossierPlan> {
  const { sources, contractChecked } = await collectAlignmentSources(db, { userId, jobId, phoneVariants, channels });
  const preparation = buildAlignmentPreparation(await extractAlignmentContext(sources), sources, 'posvenda', contractChecked);
  return planFromPreparation(preparation);
}
export function applyDossierAnswers(plan: DossierPlan, values: Record<string, unknown>): DossierPlan {
  const preparation = structuredClone(plan.preparation);
  for (const question of plan.questions) {
    const value = values[question.id];
    if (typeof value !== 'string' || !value.trim()) continue;
    if (value.length > 1200) throw new Error('A resposta pode ter até 1.200 caracteres.');
    preparation.answers[question.id] = { value: value.trim(), source: 'operator', messageIds: [] };
  }
  return planFromPreparation(preparation);
}
export async function saveDossierContent(db: SupabaseClient, userId: string, dossier: any, content: object) {
  const row = checked(await db.from('alignment_dossiers').update({ content, updated_at: new Date().toISOString() })
    .eq('user_id', userId).eq('id', dossier.id).eq('updated_at', dossier.updated_at).select('*').maybeSingle());
  if (!row) throw new Error('O dossiê foi atualizado em outra tela. Atualize a conversa antes de salvar.');
  return row;
}
export function validatedReferenceNotes(messages: any[], refs: string[], raw: unknown) {
  const result: Record<string, { caption: string; quote: string; messageId: string }> = {};
  if (!Array.isArray(raw)) return result;
  for (const note of raw) {
    const photo = messages[note?.foto_indice];
    const speech = messages[note?.fala_indice];
    if (!photo || !speech || speech.from_me || !refs.includes(photo.message_id)) continue;
    if (typeof note.trecho !== 'string' || !note.trecho.trim() || !String(speech.body || '').includes(note.trecho)) continue;
    if (typeof note.detalhe !== 'string' || !note.detalhe.trim()) continue;
    result[photo.message_id] = { caption: note.detalhe.slice(0, 500), quote: note.trecho.slice(0, 800), messageId: speech.message_id };
  }
  return result;
}

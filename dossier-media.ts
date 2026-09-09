import type { SupabaseClient } from '@supabase/supabase-js';
import type { DossierMessage } from './dossier-transcript.js';

const normalize = (value: string) => value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
const PRIVATE_DOCUMENT = /comprovante|recibo|transferencia|\bpix\b|autenticacao|identidade|documento|contrato|cadastro|dados pessoais|cartao|boleto|print.*(?:pacote|catalogo|orcamento)|tabela de precos/;
const PHOTOGRAPH = /(?:foto|fotografia|retrato|portfolio|ensaio|imagem)/;
const PHOTO_SUBJECT = /gestante|gravida|maternidade|materno|casal|familia|bebe|newborn|crianca|aniversario|batizado|smash|retrato|look|vestido|pose|cenario|luz natural/;

function photoClassification(message: DossierMessage) {
  const description = normalize(message.transcription || '');
  if (PRIVATE_DOCUMENT.test(description)) return 'document';
  if (PHOTOGRAPH.test(description) && PHOTO_SUBJECT.test(description)) return 'reference';
  return 'review';
}

export function recoverDossierPhotos(content: any, messages: DossierMessage[]) {
  const references = new Set<string>(content.reference_photo_ids || []);
  const existing = new Set(references);
  const payments = new Set<string>(content.payment_photo_ids || []);
  const excluded = new Set<string>(content.excluded_reference_ids || []);
  const review = new Set<string>(content.reference_review_ids || []);
  const recovered = new Set<string>(content.recovered_reference_ids || []);
  for (const message of messages) {
    if (message.from_me || message.type !== 'image') continue;
    if (payments.has(message.message_id)) continue;
    const classification = photoClassification(message);
    if (classification === 'document') { references.delete(message.message_id); continue; }
    references.add(message.message_id);
    if (existing.has(message.message_id)) continue;
    recovered.add(message.message_id);
    if (classification === 'review') { excluded.add(message.message_id); review.add(message.message_id); }
  }
  return { ...content, reference_photo_ids: [...references].filter(id => !payments.has(id)),
    excluded_reference_ids: [...excluded], reference_review_ids: [...review], recovered_reference_ids: [...recovered] };
}

export async function loadDossierConversationPhotos(db: SupabaseClient, userId: string, dossier: any, phones: string[]) {
  if (dossier?.status !== 'ready' || !phones.length) return dossier;
  const { data, error } = await db.from('wa_messages')
    .select('message_id,body,from_me,type,transcription')
    .eq('user_id', userId).in('phone', phones).eq('type', 'image').eq('from_me', false)
    .order('timestamp', { ascending: false }).limit(400);
  if (error) throw new Error('Não foi possível buscar as fotos da conversa. Tente abrir o ensaio novamente.');
  return { ...dossier, content: recoverDossierPhotos(dossier.content || {}, (data || []).reverse()) };
}

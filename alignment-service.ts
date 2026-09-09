import type { SupabaseClient } from '@supabase/supabase-js';
import type { AlignmentData, AlignmentSession, AlignmentStatus } from './src/features/alignment/types.js';
import type { AlignmentStore, AlignmentMessage } from './alignment-engine.js';

export function checked<T>(result: { data: T; error: { message: string; code?: string } | null }): T {
  if (!result.error) return result.data;
  if (['42P01', 'PGRST205'].includes(result.error.code || '')) throw new Error('O alinhamento ainda precisa ser instalado no banco (migração 076).');
  if (result.error.code === '23505') throw new Error('Já existe um alinhamento para este trabalho ou conversa. Atualize a tela para conferir.');
  throw new Error('Não foi possível salvar ou consultar o alinhamento. Tente novamente.');
}

export function createAlignmentStore(db: SupabaseClient): AlignmentStore {
  return {
    async get(id, userId) {
      const row = checked(await db.from('alignment_sessions').select('*').eq('id', id).eq('user_id', userId).maybeSingle());
      if (!row) throw new Error('Alinhamento não encontrado.');
      return row as AlignmentSession;
    },
    async save(s, status, data) {
      return checked(await db.from('alignment_sessions').update({ status, data, revision: s.revision + 1, updated_at: new Date().toISOString() })
        .eq('id', s.id).eq('user_id', s.user_id).eq('revision', s.revision).eq('status', s.status).select('*').maybeSingle()) as AlignmentSession | null;
    },
    async checkJob(s) {
      const job = checked(await db.from('jobs').select('status').eq('id', s.job_id).eq('user_id', s.user_id).maybeSingle());
      if (!job || job.status !== 'scheduled') throw new Error('O trabalho precisa estar agendado para conduzir o alinhamento.');
    },
    async messages(s) {
      const rows = checked(await db.from('wa_messages').select('message_id,body,from_me,type,transcription,timestamp')
        .eq('user_id', s.user_id).eq('wa_number', s.wa_number).eq('phone', s.phone)
        .gte('timestamp', s.data.startedAt || new Date().toISOString()).order('timestamp', { ascending: false }).limit(500));
      if (rows?.length === 500) throw new Error('Há mensagens demais para conferir automaticamente.');
      return (rows || []).reverse() as AlignmentMessage[];
    },
    async recordSent(s, text, messageId) {
      const now = new Date().toISOString();
      const result = await db.from('wa_messages').insert({ user_id: s.user_id, phone: s.phone, wa_number: s.wa_number,
        message_id: messageId, body: text, from_me: true, type: 'text', status: 'sent', timestamp: now });
      if (result.error?.code !== '23505') checked(result);
      const rows = checked(await db.from('wa_conversations').update({ last_message: text, last_message_at: now, updated_at: now })
        .eq('user_id', s.user_id).eq('wa_number', s.wa_number).eq('phone', s.phone).select('id'));
      if (!rows?.length) checked(await db.from('wa_conversations').insert({ user_id: s.user_id, wa_number: s.wa_number,
        phone: s.phone, last_message: text, last_message_at: now, updated_at: now }));
    },
  };
}

export async function saveAlignmentDraft(db: SupabaseClient, existing: AlignmentSession | null, row: {
  user_id: string; job_id: number; phone: string; recipient_key: string; wa_number: string; data: AlignmentData;
}): Promise<AlignmentSession> {
  if (!existing) return checked(await db.from('alignment_sessions').insert({ ...row, status: 'draft' }).select('*').single()) as AlignmentSession;
  if (existing.status !== 'draft') throw new Error('O alinhamento já foi iniciado. Pause para revisar as respostas.');
  const saved = checked(await db.from('alignment_sessions').update({ ...row, revision: existing.revision + 1, updated_at: new Date().toISOString() })
    .eq('id', existing.id).eq('user_id', row.user_id).eq('status', 'draft').eq('revision', existing.revision).select('*').maybeSingle());
  if (!saved) throw new Error('O alinhamento mudou em outra tela. Atualize antes de salvar.');
  return saved as AlignmentSession;
}

export async function alignmentByJob(db: SupabaseClient, userId: string, jobId: number): Promise<AlignmentSession | null> {
  return checked(await db.from('alignment_sessions').select('*').eq('user_id', userId).eq('job_id', jobId).maybeSingle()) as AlignmentSession | null;
}

export async function guardedAlignmentSave(store: AlignmentStore, s: AlignmentSession, status: AlignmentStatus, data: AlignmentData) {
  const saved = await store.save(s, status, data);
  if (!saved) throw new Error('O alinhamento mudou em outra tela. Atualize para continuar.');
  return saved;
}

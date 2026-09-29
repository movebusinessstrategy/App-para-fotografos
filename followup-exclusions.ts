import type { SupabaseClient } from '@supabase/supabase-js';

// A lista persistida de não contatar também separa contatos do funil ativo, sem
// apagar a oportunidade, trocar sua etapa original ou contabilizar uma perda.
export async function loadFollowUpExclusions(db: SupabaseClient, userId: string) {
  const items: Array<{ id: number; phone_key: string; reason: string | null; kind: string; deal_id: number | null }> = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await db.from('followup_optouts')
      .select('id,phone_key,reason,kind,deal_id').eq('user_id', userId).is('revoked_at', null)
      .order('id').range(offset, offset + 999);
    if (error) throw error;
    items.push(...(data ?? []));
    if ((data ?? []).length < 1000) return items;
  }
}

import { supabase } from '../../../integrations/supabase/client';

/**
 * Busca foto de perfil via backend (que usa BaileysManager/Evolution API).
 * O instanceName é dinâmico por usuário — não pode ser chamado diretamente do frontend.
 */
export async function fetchProfilePicture(phone: string): Promise<string | null> {
  try {
    const digits = String(phone).replace(/\D/g, '');
    if (!digits) return null;

    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return null;

    const res = await fetch(`/api/inbox/profile-picture/${digits}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });

    if (!res.ok) return null;
    const data = await res.json();
    return data.url || null;
  } catch (err) {
    console.warn('[fetchProfilePicture] erro:', err);
    return null;
  }
}

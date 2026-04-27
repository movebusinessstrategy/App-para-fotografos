import { supabase } from '../../../integrations/supabase/client';

async function getAuthHeader(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ? `Bearer ${session.access_token}` : null;
}

/**
 * Busca foto de perfil via backend (BaileysManager).
 */
export async function fetchProfilePicture(phone: string): Promise<string | null> {
  try {
    const digits = String(phone).replace(/\D/g, '');
    if (!digits) return null;
    const auth = await getAuthHeader();
    if (!auth) return null;
    const res = await fetch(`/api/inbox/profile-picture/${digits}`, { headers: { Authorization: auth } });
    if (!res.ok) return null;
    const data = await res.json();
    return data.url || null;
  } catch (err) {
    console.warn('[fetchProfilePicture] erro:', err);
    return null;
  }
}

export interface ContactInfoResult {
  name: string | null;
  avatar: string | null;
}

/**
 * Busca nome + foto via /api/inbox/contact-info/:phone (contact_name do banco + BaileysManager).
 */
export async function fetchContactInfo(phone: string): Promise<ContactInfoResult> {
  try {
    const digits = String(phone).replace(/\D/g, '');
    if (!digits) return { name: null, avatar: null };
    const auth = await getAuthHeader();
    if (!auth) return { name: null, avatar: null };
    const res = await fetch(`/api/inbox/contact-info/${digits}`, { headers: { Authorization: auth } });
    if (!res.ok) return { name: null, avatar: null };
    const data = await res.json();
    const name = data.contact_name && !/^\d+$/.test(data.contact_name.trim())
      ? data.contact_name.trim()
      : null;
    return { name, avatar: data.profile_picture_url || null };
  } catch (err) {
    console.warn('[fetchContactInfo] erro:', err);
    return { name: null, avatar: null };
  }
}

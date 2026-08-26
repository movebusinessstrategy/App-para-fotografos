import { authFetch } from '../../../utils/authFetch';

/**
 * Busca foto de perfil via backend (BaileysManager).
 */
export async function fetchProfilePicture(phone: string): Promise<string | null> {
  try {
    const digits = String(phone).replace(/\D/g, '');
    if (!digits) return null;
    const res = await authFetch(`/api/inbox/profile-picture/${digits}`);
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
    const res = await authFetch(`/api/inbox/contact-info/${digits}`);
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

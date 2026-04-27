import { useEffect, useState } from 'react';
import { fetchProfilePicture } from '../services/evolutionService';
import { getCachedContact, updateCachedContact } from '../utils/contactCache';

/**
 * Busca foto de perfil em background se ainda não tiver.
 * Prioridade: prop atual → cache → endpoint.
 */
export function useContactProfile(phone: string, currentAvatar: string | null) {
  const [avatar, setAvatar] = useState<string | null>(currentAvatar);

  useEffect(() => {
    if (currentAvatar) {
      setAvatar(currentAvatar);
      return;
    }

    const cached = getCachedContact(phone);
    if (cached?.avatar) {
      setAvatar(cached.avatar);
      return;
    }

    if (!phone) return;
    let mounted = true;

    fetchProfilePicture(phone).then((url) => {
      if (!mounted || !url) return;
      setAvatar(url);
      updateCachedContact(phone, { avatar: url });
    });

    return () => { mounted = false; };
  }, [phone, currentAvatar]);

  return avatar;
}

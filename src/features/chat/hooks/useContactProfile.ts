import { useEffect, useState } from 'react';
import { fetchContactInfo } from '../services/evolutionService';
import { getCachedContact, updateCachedContact } from '../utils/contactCache';

export interface ContactProfile {
  name: string | null;
  avatar: string | null;
}

/**
 * Busca nome + foto em background via /api/inbox/contact-info/:phone.
 * Só dispara se ainda não tiver nome real (não numérico) ou foto.
 */
export function useContactProfile(
  phone: string,
  currentName: string,
  currentAvatar: string | null,
): ContactProfile {
  const isPhoneOnly = !currentName || /^\+?\d[\d\s\-().]+$/.test(currentName.trim());
  const needsName = isPhoneOnly;
  const needsAvatar = !currentAvatar;

  const [profile, setProfile] = useState<ContactProfile>({
    name: needsName ? null : currentName,
    avatar: currentAvatar,
  });

  useEffect(() => {
    if (!phone) return;

    // Verificar cache primeiro
    const cached = getCachedContact(phone);
    const hasCachedName = cached?.name && !/^\+?\d[\d\s\-().]+$/.test(cached.name.trim());
    const hasCachedAvatar = !!cached?.avatar;

    if (hasCachedName || hasCachedAvatar) {
      setProfile(prev => ({
        name: hasCachedName ? cached!.name! : prev.name,
        avatar: hasCachedAvatar ? cached!.avatar! : prev.avatar,
      }));
      if (!needsName && !needsAvatar) return;
    }

    // Se já tem tudo, não buscar
    if (!needsName && !needsAvatar) return;

    let mounted = true;

    fetchContactInfo(phone).then(({ name, avatar }) => {
      if (!mounted) return;
      const updates: Partial<{ name: string; avatar: string }> = {};
      if (name) updates.name = name;
      if (avatar) updates.avatar = avatar;
      if (Object.keys(updates).length > 0) {
        updateCachedContact(phone, updates);
        setProfile(prev => ({
          name: name || prev.name,
          avatar: avatar || prev.avatar,
        }));
      }
    });

    return () => { mounted = false; };
  }, [phone]);

  return profile;
}

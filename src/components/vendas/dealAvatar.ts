import { useEffect, useState } from 'react';
import { getCachedContact, updateCachedContact } from '../../features/chat/utils/contactCache';
import { fetchProfilePicture } from '../../features/chat/services/evolutionService';

const AVATAR_BG = [
  '#0EA5A4', '#2563EB', '#7C3AED', '#DB2777', '#DC2626',
  '#EA580C', '#CA8A04', '#16A34A', '#0891B2', '#9333EA',
];

export function getInitials(name?: string | null): string {
  const clean = String(name || '').trim();
  if (!clean) return '?';
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function getAvatarBg(seed?: string | null): string {
  const s = String(seed || '?');
  let hash = 0;
  for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  return AVATAR_BG[hash % AVATAR_BG.length];
}

function normalize(phone?: string | null): string {
  return String(phone || '').replace(/\D/g, '');
}

// Pendências em andamento para evitar fetchs duplicados quando vários cards
// montam ao mesmo tempo no kanban.
const inflight = new Map<string, Promise<string | null>>();

async function loadAvatar(phone: string): Promise<string | null> {
  const cached = getCachedContact(phone);
  if (cached?.avatar) return cached.avatar;
  if (inflight.has(phone)) return inflight.get(phone)!;
  const promise = fetchProfilePicture(phone)
    .then(url => {
      if (url) updateCachedContact(phone, { avatar: url });
      return url;
    })
    .finally(() => inflight.delete(phone));
  inflight.set(phone, promise);
  return promise;
}

export function useDealAvatar(phone?: string | null): string | null {
  const digits = normalize(phone);
  const [url, setUrl] = useState<string | null>(() => {
    if (!digits) return null;
    return getCachedContact(digits)?.avatar || null;
  });

  useEffect(() => {
    if (!digits) { setUrl(null); return; }
    let cancelled = false;
    const cached = getCachedContact(digits)?.avatar || null;
    setUrl(cached);
    if (!cached) {
      loadAvatar(digits).then(found => {
        if (!cancelled) setUrl(found);
      });
    }
    return () => { cancelled = true; };
  }, [digits]);

  return url;
}

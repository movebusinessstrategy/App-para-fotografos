import React, { useEffect, useState } from 'react';
import { fetchProfilePicture, photoCache } from '../../utils/profilePicture';

interface Props {
  phone: string;
  name?: string | null;
  photoUrl?: string | null;
  size?: 'xs' | 'sm' | 'md' | 'lg';
}

const SIZE: Record<string, string> = {
  xs: 'w-6 h-6 text-[9px]',
  sm: 'w-8 h-8 text-[11px]',
  md: 'w-10 h-10 text-sm',
  lg: 'w-16 h-16 text-xl',
};

// Pares de gradiente diagonal baseados no hash do telefone
const GRADIENTS: [string, string][] = [
  ['#7A8F64', '#4D6040'],
  ['#6E8CA0', '#3D6277'],
  ['#9E8262', '#6E5040'],
  ['#7B6E9E', '#4A4070'],
  ['#5E9E8A', '#3A6E5A'],
  ['#9E6E82', '#6E3F50'],
  ['#7A9E7A', '#4D6E4D'],
];

function gradientFor(phone: string): [string, string] {
  let hash = 0;
  for (let i = 0; i < phone.length; i++) {
    hash = phone.charCodeAt(i) + ((hash << 5) - hash);
  }
  return GRADIENTS[Math.abs(hash) % GRADIENTS.length];
}

function initials(name?: string | null, phone?: string): string {
  if (name) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name.trim().slice(0, 2).toUpperCase();
  }
  return (phone || '??').slice(-2).toUpperCase();
}

export function Avatar({ phone, name, photoUrl: externalPhoto, size = 'md' }: Props) {
  const [photo, setPhoto] = useState<string | null>(
    externalPhoto !== undefined ? externalPhoto : (photoCache.get(phone) ?? null)
  );

  useEffect(() => {
    if (externalPhoto !== undefined) {
      setPhoto(externalPhoto);
      return;
    }
    fetchProfilePicture(phone).then(setPhoto);
  }, [phone, externalPhoto]);

  const sizeClass = SIZE[size];
  const [g1, g2] = gradientFor(phone);

  if (photo) {
    return (
      <img
        src={photo}
        alt={name || phone}
        className={`${sizeClass} rounded-full object-cover flex-shrink-0 ring-2 ring-white/10`}
        onError={() => setPhoto(null)}
      />
    );
  }

  return (
    <div
      className={`${sizeClass} rounded-full flex items-center justify-center flex-shrink-0 font-semibold text-white`}
      style={{ background: `linear-gradient(135deg, ${g1}, ${g2})` }}
    >
      {initials(name, phone)}
    </div>
  );
}

import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, User as UserIcon } from 'lucide-react';
import { TeamMember } from '../../types';

function initials(name?: string | null): string {
  const s = String(name || '').trim();
  if (!s) return '?';
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function SellerAvatar({ member, size = 24 }: { member?: TeamMember | null; size?: number }) {
  if (!member) {
    return (
      <div
        className="rounded-full flex items-center justify-center bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-500 ring-1 ring-gray-200 dark:ring-gray-600"
        style={{ width: size, height: size }}
        title="Sem responsável"
      >
        <UserIcon size={Math.round(size * 0.55)} />
      </div>
    );
  }
  return (
    <div
      className="rounded-full flex items-center justify-center text-white font-semibold ring-1 ring-white dark:ring-gray-800"
      style={{ width: size, height: size, background: member.color || '#6366f1', fontSize: Math.round(size * 0.38) }}
      title={member.name}
    >
      {initials(member.name)}
    </div>
  );
}

interface SellerPickerProps {
  sellers: TeamMember[];
  value: string | null;
  onChange: (id: string | null) => void;
  placeholder?: string;
  size?: 'sm' | 'md';
  allowNone?: boolean;
}

export function SellerPicker({ sellers, value, onChange, placeholder = 'Atribuir vendedor…', size = 'md', allowNone = true }: SellerPickerProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = sellers.find(s => s.id === value) || null;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const pad = size === 'sm' ? 'px-2 py-1 text-xs' : 'px-3 py-2 text-sm';

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={`w-full flex items-center gap-2 ${pad} rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:border-gray-300 dark:hover:border-gray-600 transition-colors`}
      >
        <SellerAvatar member={selected} size={size === 'sm' ? 20 : 24} />
        <span className="flex-1 text-left truncate">
          {selected ? selected.name : <span className="text-gray-400 dark:text-gray-500">{placeholder}</span>}
        </span>
        <ChevronDown size={14} className="text-gray-400 flex-shrink-0" />
      </button>
      {open && (
        <div className="absolute z-30 mt-1 left-0 right-0 max-h-64 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg">
          {allowNone && (
            <button
              type="button"
              onClick={() => { onChange(null); setOpen(false); }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
            >
              <SellerAvatar member={null} size={24} />
              <span className="flex-1 text-left">Sem responsável</span>
              {!value && <Check size={14} className="text-gold-600" />}
            </button>
          )}
          {sellers.map(m => (
            <button
              key={m.id}
              type="button"
              onClick={() => { onChange(m.id); setOpen(false); }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
            >
              <SellerAvatar member={m} size={24} />
              <span className="flex-1 text-left truncate">{m.name}</span>
              {value === m.id && <Check size={14} className="text-gold-600" />}
            </button>
          ))}
          {sellers.length === 0 && (
            <div className="px-3 py-3 text-xs text-gray-400 dark:text-gray-500">
              Nenhum vendedor cadastrado. Adicione em Configurações → Equipe.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

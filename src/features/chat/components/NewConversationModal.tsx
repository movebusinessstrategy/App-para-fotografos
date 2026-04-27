import React, { useState, useRef, useEffect } from 'react';
import { X, MessageSquarePlus } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
  onStart: (phone: string) => void;
}

function applyPhoneMask(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 13);
  if (d.length <= 2)  return `+${d}`;
  if (d.length <= 4)  return `+${d.slice(0,2)} (${d.slice(2)}`;
  if (d.length <= 9)  return `+${d.slice(0,2)} (${d.slice(2,4)}) ${d.slice(4)}`;
  if (d.length <= 13) return `+${d.slice(0,2)} (${d.slice(2,4)}) ${d.slice(4,9)}-${d.slice(9)}`;
  return raw;
}

function extractDigits(masked: string): string {
  return masked.replace(/\D/g, '');
}

export function NewConversationModal({ open, onClose, onStart }: Props) {
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setValue('');
      setError('');
      setTimeout(() => inputRef.current?.focus(), 80);
    }
  }, [open]);

  if (!open) return null;

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setValue(applyPhoneMask(e.target.value));
    setError('');
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const digits = extractDigits(value);
    if (digits.length < 10) {
      setError('Digite um número válido com DDD (mín. 10 dígitos).');
      return;
    }
    // Normaliza para formato brasileiro se necessário
    const phone = digits.startsWith('55') ? digits : `55${digits}`;
    // TODO: chamar startNewConversation(phone) quando implementado no backend
    console.log('[NewConversation] iniciando conversa com:', phone);
    onStart(phone);
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden"
        style={{ background: 'var(--wa-bg-secondary)', border: '1px solid var(--wa-border)' }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ background: 'var(--wa-bg-tertiary)', borderBottom: '1px solid var(--wa-border)' }}
        >
          <div className="flex items-center gap-2">
            <MessageSquarePlus size={18} style={{ color: 'var(--wa-accent-green)' }} />
            <span className="text-sm font-semibold" style={{ color: 'var(--wa-text-primary)' }}>
              Nova conversa
            </span>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-full flex items-center justify-center transition-colors"
            style={{ color: 'var(--wa-text-secondary)' }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="p-5 flex flex-col gap-4">
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--wa-text-secondary)' }}>
              Número de WhatsApp
            </label>
            <input
              ref={inputRef}
              type="tel"
              value={value}
              onChange={handleChange}
              placeholder="+55 (43) 99909-3114"
              className="w-full rounded-xl px-4 py-2.5 text-sm outline-none"
              style={{
                background: 'var(--wa-bg-input)',
                border: `1px solid ${error ? '#ef4444' : 'var(--wa-border)'}`,
                color: 'var(--wa-text-primary)',
              }}
            />
            {error && (
              <p className="mt-1.5 text-xs" style={{ color: '#ef4444' }}>{error}</p>
            )}
          </div>

          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-sm font-medium transition-colors"
              style={{ background: 'var(--wa-bg-hover)', color: 'var(--wa-text-secondary)' }}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-xl text-sm font-semibold transition-opacity"
              style={{ background: 'var(--wa-accent-green)', color: '#fff' }}
            >
              Iniciar conversa
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

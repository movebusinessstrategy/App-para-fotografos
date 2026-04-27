import React, { useState, useRef, useEffect } from 'react';
import { X, MessageSquarePlus } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
  onStart: (fullPhone: string) => void;
}

function applyLocalMask(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 11);
  if (d.length > 7)  return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`;
  if (d.length > 2)  return `(${d.slice(0,2)}) ${d.slice(2)}`;
  if (d.length > 0)  return `(${d}`;
  return '';
}

export function NewConversationModal({ open, onClose, onStart }: Props) {
  const [formatted, setFormatted] = useState('');
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setFormatted('');
      setError('');
      setTimeout(() => inputRef.current?.focus(), 80);
    }
  }, [open]);

  if (!open) return null;

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setFormatted(applyLocalMask(e.target.value));
    setError('');
  }

  const digits = formatted.replace(/\D/g, '');
  const isValid = digits.length >= 10 && digits.length <= 11;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValid) {
      setError('Digite um número válido com DDD (10 ou 11 dígitos).');
      return;
    }
    const fullPhone = '55' + digits;
    // TODO: chamar função real de criação de conversa quando implementada
    console.log('[NewConversation] iniciando para:', fullPhone);
    onStart(fullPhone);
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.55)' }}
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
            className="w-7 h-7 rounded-full flex items-center justify-center"
            style={{ color: 'var(--wa-text-secondary)' }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="p-5 flex flex-col gap-4">
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--wa-text-secondary)' }}>
              Número WhatsApp (Brasil)
            </label>

            {/* Input com prefixo +55 fixo */}
            <div className="flex items-stretch rounded-xl overflow-hidden" style={{ border: `1px solid ${error ? '#ef4444' : 'var(--wa-border)'}` }}>
              <div
                className="flex items-center px-3 py-2.5 text-sm font-medium flex-shrink-0 select-none"
                style={{
                  background: 'var(--wa-bg-tertiary)',
                  color: 'var(--wa-text-secondary)',
                  borderRight: '1px solid var(--wa-border)',
                }}
              >
                🇧🇷 +55
              </div>
              <input
                ref={inputRef}
                type="tel"
                value={formatted}
                onChange={handleChange}
                placeholder="(43) 99999-9999"
                maxLength={15}
                className="flex-1 px-3 py-2.5 text-sm outline-none"
                style={{
                  background: 'var(--wa-bg-input)',
                  color: 'var(--wa-text-primary)',
                }}
              />
            </div>

            {error && (
              <p className="mt-1.5 text-xs" style={{ color: '#ef4444' }}>{error}</p>
            )}
            <p className="mt-1.5 text-xs" style={{ color: 'var(--wa-text-muted)' }}>
              {digits.length}/11 dígitos
            </p>
          </div>

          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-sm font-medium"
              style={{ background: 'var(--wa-bg-hover)', color: 'var(--wa-text-secondary)' }}
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={!isValid}
              className="px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-40"
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

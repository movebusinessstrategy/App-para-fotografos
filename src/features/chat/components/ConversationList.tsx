import React, { useMemo, useRef, useState, useEffect } from 'react';
import { Search, MessageCircle, SquarePen, X, ArrowRight } from 'lucide-react';
import { Conversation } from '../types';
import { ConversationItem } from './ConversationItem';

interface Props {
  conversations: Conversation[];
  selectedPhone: string | null;
  loading: boolean;
  onSelect: (conv: Conversation) => void;
  onNewConversation: (phone: string, name?: string) => void;
}

// Formulário de nova conversa
function NewConversationForm({
  onConfirm,
  onCancel,
}: {
  onConfirm: (phone: string, name: string) => void;
  onCancel: () => void;
}) {
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const clean = phone.replace(/\D/g, '');
  const valid = clean.length >= 10;

  return (
    <div
      className="px-4 py-3"
      style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
    >
      <p className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: '#6A6A65' }}>
        Nova conversa
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onConfirm(clean, name.trim());
        }}
        className="flex flex-col gap-2"
      >
        <input
          ref={inputRef}
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="Telefone com DDD (ex: 11999999999)"
          className="w-full px-3 py-2 text-sm rounded-lg outline-none placeholder-[#6A6A65]"
          style={{
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.08)',
            color: '#ECEAE3',
          }}
        />
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nome (opcional)"
          className="w-full px-3 py-2 text-sm rounded-lg outline-none placeholder-[#6A6A65]"
          style={{
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.08)',
            color: '#ECEAE3',
          }}
        />
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 py-2 rounded-lg text-xs font-semibold transition-colors"
            style={{
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
              color: '#9A9A93',
            }}
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={!valid}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-colors disabled:opacity-30"
            style={{ background: '#B5C19D', color: '#0E0E0C' }}
          >
            <ArrowRight size={13} /> Iniciar
          </button>
        </div>
      </form>
    </div>
  );
}

// Skeletons de loading
function ListSkeleton() {
  return (
    <div className="flex flex-col gap-0">
      {[...Array(7)].map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3">
          <div
            className="w-10 h-10 rounded-full flex-shrink-0 animate-pulse"
            style={{ background: 'rgba(255,255,255,0.06)' }}
          />
          <div className="flex-1 space-y-2">
            <div
              className="h-3 rounded animate-pulse"
              style={{ width: '60%', background: 'rgba(255,255,255,0.06)' }}
            />
            <div
              className="h-2 rounded animate-pulse"
              style={{ width: '40%', background: 'rgba(255,255,255,0.04)' }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ConversationList({
  conversations,
  selectedPhone,
  loading,
  onSelect,
  onNewConversation,
}: Props) {
  const [search, setSearch] = useState('');
  const [showNewForm, setShowNewForm] = useState(false);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    if (!q) return conversations;
    return conversations.filter(
      (c) =>
        c.phone.includes(q) ||
        (c.contact_name || '').toLowerCase().includes(q) ||
        (c.last_message || '').toLowerCase().includes(q)
    );
  }, [conversations, search]);

  const handleNewConv = (phone: string, name: string) => {
    setShowNewForm(false);
    onNewConversation(phone, name || undefined);
  };

  return (
    <div
      className="flex flex-col h-full min-h-0"
      style={{ background: 'var(--color-chat-panel)', fontFamily: "'Instrument Sans', sans-serif" }}
    >
      {/* Header */}
      <div
        className="px-4 pt-4 pb-3 flex-shrink-0"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
      >
        <div className="flex items-center justify-between mb-3">
          <h2
            className="text-sm font-semibold"
            style={{ color: '#ECEAE3', fontFamily: "'Instrument Serif', serif" }}
          >
            Conversas
          </h2>
          <div className="flex items-center gap-1">
            <span
              className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
              style={{ color: '#9A9A93', background: 'rgba(255,255,255,0.05)' }}
            >
              {conversations.length}
            </span>
            <button
              onClick={() => setShowNewForm((v) => !v)}
              className="p-1.5 rounded-lg transition-colors"
              style={{ color: showNewForm ? '#B5C19D' : '#6A6A65' }}
              title="Nova conversa"
            >
              {showNewForm ? <X size={15} /> : <SquarePen size={14} />}
            </button>
          </div>
        </div>

        {/* Search */}
        <div
          className="flex items-center gap-2 px-3 py-2 rounded-xl"
          style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.06)' }}
        >
          <Search size={13} style={{ color: '#6A6A65' }} className="flex-shrink-0" />
          <input
            type="text"
            placeholder="Buscar conversa..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 bg-transparent text-sm outline-none placeholder-[#6A6A65]"
            style={{ color: '#ECEAE3' }}
          />
          {search && (
            <button onClick={() => setSearch('')} style={{ color: '#6A6A65' }}>
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Formulário nova conversa */}
      {showNewForm && (
        <NewConversationForm
          onConfirm={handleNewConv}
          onCancel={() => setShowNewForm(false)}
        />
      )}

      {/* Lista */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {loading ? (
          <ListSkeleton />
        ) : filtered.length === 0 ? (
          <div
            className="flex flex-col items-center justify-center h-full gap-3 px-6 text-center py-12"
            style={{ color: '#6A6A65' }}
          >
            <MessageCircle size={28} strokeWidth={1.5} />
            <p className="text-sm">
              {search ? 'Nenhuma conversa encontrada' : 'Nenhuma conversa ainda'}
            </p>
            {!search && (
              <button
                onClick={() => setShowNewForm(true)}
                className="flex items-center gap-1.5 text-xs font-semibold transition-colors"
                style={{ color: '#B5C19D' }}
              >
                <SquarePen size={12} /> Iniciar nova conversa
              </button>
            )}
          </div>
        ) : (
          filtered.map((conv) => (
            <React.Fragment key={conv.phone}>
              <ConversationItem
                conversation={conv}
                isSelected={conv.phone === selectedPhone}
                onClick={() => onSelect(conv)}
              />
              <div
                className="mx-4"
                style={{ height: 1, background: 'rgba(255,255,255,0.04)' }}
              />
            </React.Fragment>
          ))
        )}
      </div>
    </div>
  );
}

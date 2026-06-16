import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Phone, Send, Loader2, MessageCircle } from 'lucide-react';
import { authFetch } from '../../utils/authFetch';
import { startVisiblePoll } from '../../utils/poll';

interface Message {
  message_id: string;
  body: string;
  from_me: boolean;
  timestamp: string;
  type?: string;
  status?: string;
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function formatDate(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diffDays === 0) return 'Hoje';
  if (diffDays === 1) return 'Ontem';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long' });
}

function groupByDate(messages: Message[]) {
  const groups: { label: string; messages: Message[] }[] = [];
  let currentLabel = '';
  for (const msg of messages) {
    const label = formatDate(msg.timestamp);
    if (label !== currentLabel) {
      currentLabel = label;
      groups.push({ label, messages: [msg] });
    } else {
      groups[groups.length - 1].messages.push(msg);
    }
  }
  return groups;
}

interface ChatPopupProps {
  phone: string;
  contactName?: string | null;
  onClose: () => void;
}

export function ChatPopup({ phone, contactName, onClose }: ChatPopupProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<(() => void) | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const cleanPhone = phone.replace(/\D/g, '');

  const initials = (contactName || phone)
    .split(' ')
    .slice(0, 2)
    .map(w => w[0])
    .join('')
    .toUpperCase();

  const fetchMessages = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await authFetch(`/api/inbox/messages/${cleanPhone}?limit=80`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          setMessages(prev => {
            const dbIds = new Set(data.map((m: Message) => m.message_id));
            const pending = prev.filter(m => m.message_id.startsWith('tmp-') && !dbIds.has(m.message_id));
            return [...data, ...pending].sort(
              (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
            );
          });
        }
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, [cleanPhone]);

  useEffect(() => {
    setMessages([]);
    fetchMessages();
    authFetch(`/api/inbox/mark-read/${cleanPhone}`, { method: 'POST' }).catch(() => {});
    pollRef.current = startVisiblePoll(() => fetchMessages(true), 8000);
    return () => { if (pollRef.current) pollRef.current(); };
  }, [cleanPhone, fetchMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = '44px';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [text]);

  // Fechar com ESC
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleSend = async () => {
    const msg = text.trim();
    if (!msg || sending) return;
    setSending(true);
    setText('');

    const tmpId = `tmp-${Date.now()}`;
    const tmpMsg: Message = {
      message_id: tmpId, body: msg, from_me: true,
      timestamp: new Date().toISOString(), status: 'sending',
    };
    setMessages(prev => [...prev, tmpMsg]);

    try {
      const res = await authFetch('/api/inbox/send', {
        method: 'POST',
        body: JSON.stringify({ phone: cleanPhone, text: msg }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setMessages(prev => prev.filter(m => m.message_id !== tmpId));
        setText(msg);
        alert(`Erro ao enviar: ${err.error || res.statusText}`);
        return;
      }
      setMessages(prev => prev.filter(m => m.message_id !== tmpId));
      fetchMessages(true);
    } catch {
      setMessages(prev => prev.filter(m => m.message_id !== tmpId));
      setText(msg);
    } finally {
      setSending(false);
    }
  };

  const groups = groupByDate(messages);

  const modal = (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      {/* Backdrop desfocado */}
      <div
        onClick={onClose}
        style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)' }}
      />

      {/* Janela do chat - 65% da tela */}
      <div
        style={{
          position: 'relative',
          width: '65vw',
          height: '80vh',
          borderRadius: 16,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 24px 80px rgba(0,0,0,0.35)',
        }}
      >

      {/* Header estilo WhatsApp */}
      <div
        style={{ background: '#075E54', flexShrink: 0 }}
        className="flex items-center gap-3 px-4 py-3"
      >
        {/* Botão voltar */}
        <button
          onClick={onClose}
          className="p-2 rounded-full hover:bg-white/10 transition-colors text-white flex-shrink-0"
          title="Fechar"
        >
          <ArrowLeft size={20} />
        </button>

        {/* Avatar */}
        <div
          className="flex items-center justify-center text-white font-bold flex-shrink-0"
          style={{
            width: 42, height: 42, borderRadius: '50%',
            background: '#128C7E',
            fontSize: 16,
          }}
        >
          {initials}
        </div>

        {/* Nome e número */}
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-white text-base truncate leading-tight">
            {contactName || phone}
          </p>
          {contactName && (
            <p className="text-xs text-green-200 truncate">{phone}</p>
          )}
        </div>

        {/* Abrir no WhatsApp */}
        <a
          href={`https://wa.me/${cleanPhone}`}
          target="_blank"
          rel="noopener noreferrer"
          className="p-2 rounded-full hover:bg-white/10 transition-colors text-white/80 hover:text-white"
          title="Abrir no WhatsApp"
        >
          <Phone size={20} />
        </a>
      </div>

      {/* Área de mensagens com fundo do WhatsApp */}
      <div
        className="flex-1 overflow-y-auto px-4 py-4 space-y-1"
        style={{
          background: '#ECE5DD',
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23c8bdb3' fill-opacity='0.15'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
        }}
      >
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 size={28} className="animate-spin" style={{ color: '#075E54' }} />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3" style={{ color: '#8a9a7a' }}>
            <MessageCircle size={40} strokeWidth={1.5} />
            <p className="text-sm">Nenhuma mensagem ainda</p>
          </div>
        ) : (
          groups.map(group => (
            <div key={group.label}>
              {/* Separador de data */}
              <div className="flex items-center justify-center my-4">
                <span className="text-xs px-3 py-1 rounded-full shadow-sm" style={{ background: '#D1F0C2', color: '#4a6741' }}>
                  {group.label}
                </span>
              </div>

              {group.messages.map(msg => (
                <div
                  key={msg.message_id}
                  className={`flex mb-1 ${msg.from_me ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className="max-w-[70%] px-3 py-2 rounded-lg shadow-sm text-sm leading-relaxed"
                    style={
                      msg.from_me
                        ? { background: '#DCF8C6', color: '#1a1a1a', borderRadius: '8px 2px 8px 8px' }
                        : { background: '#FFFFFF',  color: '#1a1a1a', borderRadius: '2px 8px 8px 8px' }
                    }
                  >
                    <p style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{msg.body}</p>
                    <p className="text-[10px] mt-1 text-right" style={{ color: '#8a9a7a' }}>
                      {formatTime(msg.timestamp)}
                      {msg.status === 'sending' && ' ·'}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div
        className="flex items-end gap-3 px-4 py-3 flex-shrink-0"
        style={{ background: '#F0F0F0' }}
      >
        <textarea
          ref={textareaRef}
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder="Digite uma mensagem"
          rows={1}
          className="flex-1 resize-none rounded-3xl px-4 py-3 outline-none text-sm text-gray-800 placeholder-gray-400"
          style={{
            background: '#FFFFFF',
            minHeight: '44px',
            maxHeight: '120px',
            lineHeight: '1.4',
          }}
        />
        <button
          onClick={handleSend}
          disabled={!text.trim() || sending}
          className="flex items-center justify-center rounded-full text-white transition-colors flex-shrink-0 disabled:opacity-40"
          style={{ width: 44, height: 44, background: '#075E54' }}
        >
          {sending ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
        </button>
      </div>

      </div> {/* fim janela */}
    </div>
  );

  return createPortal(modal, document.body);
}

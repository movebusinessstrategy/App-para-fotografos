import React, { useEffect, useRef, useState } from 'react';
import { Send, Wifi, WifiOff, RefreshCw, MessageCircle, ArrowLeft, Settings, Mic, Sun, Moon } from 'lucide-react';
import { useTheme } from '../../../contexts/ThemeContext';
import { useConversations } from '../hooks/useConversations';
import { useMessages } from '../hooks/useMessages';
import { useWaStatus } from '../hooks/useWaStatus';
import { ConversationItem } from './ConversationItem';
import { MessageBubble } from './MessageBubble';
import { AudioRecorder } from './AudioRecorder';
import { ConnectChannelModal } from '../../../components/vendas/ConnectChannelModal';
import { supabase } from '../../../integrations/supabase/client';
import { Deal, PipelineStage } from '../../../types';

interface Props {
  deals: Deal[];
  stages: PipelineStage[];
  initialPhone?: string;
  onDealUpdated: () => void;
}

function DateSep({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 my-3">
      <span
        className="mx-auto text-[11px] px-3 py-1 rounded-lg"
        style={{
          color: 'var(--wa-text-secondary)',
          background: 'var(--wa-bg-tertiary)',
          boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
        }}
      >
        {label}
      </span>
    </div>
  );
}

function dateLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Hoje';
  const yesterday = new Date(now.getTime() - 86400000);
  if (d.toDateString() === yesterday.toDateString()) return 'Ontem';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
}

export function InboxView({ initialPhone }: Props) {
  const { waTheme, toggleWaTheme } = useTheme();
  const { conversations, loading: loadingConvs, refresh } = useConversations();
  const { connected } = useWaStatus();
  const [selectedPhone, setSelectedPhone] = useState<string | null>(initialPhone || null);
  const { messages, loading: loadingMsgs, sendText } = useMessages(selectedPhone);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const prevCountRef = useRef(0);

  useEffect(() => {
    if (messages.length > prevCountRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
    prevCountRef.current = messages.length;
  }, [messages.length]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'instant' as ScrollBehavior });
    prevCountRef.current = 0;
  }, [selectedPhone]);

  useEffect(() => {
    if (initialPhone && !selectedPhone) setSelectedPhone(initialPhone);
  }, [initialPhone]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const t = text.trim();
    if (!t || sending || !selectedPhone) return;
    setSending(true);
    setText('');
    try {
      await sendText(t);
    } catch (err) {
      alert(`Erro ao enviar: ${err instanceof Error ? err.message : 'Tente novamente.'}`);
      setText(t);
    } finally {
      setSending(false);
    }
  }

  async function handleRefresh() {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }

  async function handleAudioSend(blob: Blob, durationSec: number) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error('Sessão expirada — faça login novamente');
    if (!selectedPhone) throw new Error('Nenhuma conversa selecionada');

    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        const comma = result.indexOf(',');
        resolve(comma >= 0 ? result.slice(comma + 1) : result);
      };
      reader.onerror = () => reject(new Error('Falha ao ler arquivo de áudio'));
      reader.readAsDataURL(blob);
    });

    const phone = selectedPhone.replace(/\D/g, '');

    const res = await fetch('/api/inbox/send-media', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        phone,
        mediaBase64: base64,
        mimetype: blob.type || 'audio/webm',
        filename: 'audio.webm',
        caption: '',
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      let msg = `Erro ${res.status}`;
      try { msg = JSON.parse(body).error || msg; } catch { if (body) msg = body; }
      throw new Error(msg);
    }

    setIsRecording(false);
  }

  const groups: { label: string; msgs: typeof messages }[] = [];
  for (const msg of messages) {
    const label = dateLabel(msg.timestamp);
    if (!groups.length || groups[groups.length - 1].label !== label) {
      groups.push({ label, msgs: [msg] });
    } else {
      groups[groups.length - 1].msgs.push(msg);
    }
  }

  const selectedConv = conversations.find(c => c.phone === selectedPhone);

  return (
    <div className="flex h-full overflow-hidden" style={{ background: 'var(--wa-bg-secondary)', fontFamily: 'Inter, system-ui, sans-serif' }}>

      {/* ── SIDEBAR ── */}
      <div
        className="flex flex-col flex-shrink-0 overflow-hidden"
        style={{ width: 360, borderRight: '1px solid var(--wa-border)', background: 'var(--wa-bg-secondary)' }}
      >
        {/* Header do sidebar */}
        <div
          className="flex items-center justify-between px-4 py-3 flex-shrink-0"
          style={{ background: 'var(--wa-bg-tertiary)', borderBottom: '1px solid var(--wa-border)' }}
        >
          <span className="text-[15px] font-semibold" style={{ color: 'var(--wa-text-primary)' }}>
            Conversas
          </span>

          <div className="flex items-center gap-1">
            {/* Status WA */}
            {connected === null ? null : connected ? (
              <div className="flex items-center gap-1.5 mr-2">
                <Wifi size={12} style={{ color: 'var(--wa-accent-green)' }} />
              </div>
            ) : (
              <button
                onClick={() => setConnectOpen(true)}
                className="px-2 py-0.5 rounded text-[11px] font-semibold mr-1"
                style={{ background: '#f59e0b', color: '#000' }}
              >
                Conectar
              </button>
            )}

            {connected && (
              <button
                onClick={() => setConnectOpen(true)}
                className="w-8 h-8 rounded-full flex items-center justify-center transition-colors"
                style={{ color: 'var(--wa-text-secondary)' }}
                title="Gerenciar conexão"
              >
                <Settings size={16} />
              </button>
            )}

            <button
              onClick={handleRefresh}
              className="w-8 h-8 rounded-full flex items-center justify-center transition-colors"
              style={{ color: 'var(--wa-text-secondary)' }}
              title="Atualizar conversas"
            >
              <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
            </button>

            <button
              onClick={toggleWaTheme}
              className="w-8 h-8 rounded-full flex items-center justify-center transition-colors"
              style={{ color: 'var(--wa-text-secondary)' }}
              title={waTheme === 'dark' ? 'Modo claro' : 'Modo escuro'}
            >
              {waTheme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            </button>
          </div>
        </div>

        {/* Contador */}
        <div
          className="px-4 py-2 flex-shrink-0"
          style={{ borderBottom: '1px solid var(--wa-border)' }}
        >
          <p className="text-[12px]" style={{ color: 'var(--wa-text-muted)' }}>
            {loadingConvs ? 'Carregando...' : `${conversations.length} conversa${conversations.length !== 1 ? 's' : ''}`}
          </p>
        </div>

        {/* Lista de conversas */}
        <div className="flex-1 overflow-y-auto wa-scrollbar">
          {loadingConvs ? (
            <div className="flex flex-col">
              {[...Array(7)].map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-3 py-3">
                  <div className="w-12 h-12 rounded-full animate-pulse flex-shrink-0" style={{ background: 'var(--wa-bg-hover)' }} />
                  <div className="flex-1 space-y-2">
                    <div className="h-3.5 rounded animate-pulse" style={{ width: '55%', background: 'var(--wa-bg-hover)' }} />
                    <div className="h-3 rounded animate-pulse" style={{ width: '75%', background: 'var(--wa-bg-tertiary)' }} />
                  </div>
                </div>
              ))}
            </div>
          ) : conversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 px-6 text-center py-16">
              <MessageCircle size={32} style={{ color: 'var(--wa-text-muted)' }} strokeWidth={1.5} />
              <p className="text-sm" style={{ color: 'var(--wa-text-muted)' }}>Nenhuma conversa ainda</p>
            </div>
          ) : (
            conversations.map(conv => (
              <ConversationItem
                key={conv.phone}
                conv={conv}
                selected={conv.phone === selectedPhone}
                onClick={() => setSelectedPhone(conv.phone)}
              />
            ))
          )}
        </div>
      </div>

      {/* ── ÁREA DE CHAT ── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {!selectedPhone ? (
          /* Estado vazio */
          <div className="flex-1 flex flex-col items-center justify-center gap-4 wa-chat-pattern">
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center"
              style={{ background: 'var(--wa-bg-tertiary)' }}
            >
              <MessageCircle size={28} strokeWidth={1.5} style={{ color: 'var(--wa-text-muted)' }} />
            </div>
            <div className="text-center">
              <p className="text-base font-medium" style={{ color: 'var(--wa-text-primary)' }}>
                Selecione uma conversa
              </p>
              <p className="text-sm mt-1" style={{ color: 'var(--wa-text-muted)' }}>
                Escolha um contato na lista ao lado
              </p>
            </div>
          </div>
        ) : (
          <>
            {/* Header da conversa */}
            <div
              className="flex items-center gap-3 px-4 py-3 flex-shrink-0"
              style={{ background: 'var(--wa-bg-tertiary)', borderBottom: '1px solid var(--wa-border)' }}
            >
              <button
                onClick={() => setSelectedPhone(null)}
                className="p-1 rounded-full md:hidden"
                style={{ color: 'var(--wa-text-secondary)' }}
              >
                <ArrowLeft size={20} />
              </button>

              {/* Avatar mini */}
              <div
                className="w-10 h-10 rounded-full flex-shrink-0 flex items-center justify-center text-white text-sm font-semibold"
                style={{ background: '#00756A' }}
              >
                {(selectedConv?.contact_name || selectedPhone || '?').charAt(0).toUpperCase()}
              </div>

              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold leading-tight truncate" style={{ color: 'var(--wa-text-primary)' }}>
                  {selectedConv?.contact_name || selectedPhone}
                </p>
                <p className="text-[12px] leading-tight truncate" style={{ color: 'var(--wa-text-muted)' }}>
                  {selectedPhone}
                </p>
              </div>
            </div>

            {/* Mensagens — fundo com padrão */}
            <div className="flex-1 overflow-y-auto wa-scrollbar wa-chat-pattern px-4 py-2">
              {loadingMsgs ? (
                <div className="flex flex-col gap-2 pt-4">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className={`flex ${i % 2 === 0 ? 'justify-start' : 'justify-end'}`}>
                      <div
                        className="h-10 rounded-2xl animate-pulse"
                        style={{ width: `${38 + (i * 17) % 28}%`, background: 'var(--wa-bg-tertiary)' }}
                      />
                    </div>
                  ))}
                </div>
              ) : messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full gap-3" style={{ color: 'var(--wa-text-muted)' }}>
                  <MessageCircle size={28} strokeWidth={1.5} />
                  <p className="text-sm">Nenhuma mensagem ainda</p>
                </div>
              ) : (
                groups.map(group => (
                  <div key={group.label}>
                    <DateSep label={group.label} />
                    {group.msgs.map(msg => (
                      <MessageBubble
                        key={msg.message_id}
                        msg={msg}
                        onImageClick={setLightbox}
                        contactInitial={(selectedConv?.contact_name || selectedPhone || '?').charAt(0).toUpperCase()}
                      />
                    ))}
                  </div>
                ))
              )}
              <div ref={bottomRef} />
            </div>

            {/* Composer */}
            <div
              className="flex items-end gap-2 px-3 py-3 flex-shrink-0"
              style={{ background: 'var(--wa-bg-tertiary)', borderTop: '1px solid var(--wa-border)' }}
            >
              {isRecording ? (
                <AudioRecorder
                  onSend={handleAudioSend}
                  onCancel={() => setIsRecording(false)}
                  className="flex-1"
                />
              ) : (
                <form onSubmit={handleSend} className="flex items-end gap-2 flex-1">
                  <textarea
                    value={text}
                    onChange={e => setText(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSend(e as any);
                      }
                    }}
                    placeholder="Digite uma mensagem"
                    rows={1}
                    className="flex-1 rounded-lg px-4 py-2.5 text-sm outline-none resize-none wa-scrollbar"
                    style={{
                      background: 'var(--wa-bg-input)',
                      color: 'var(--wa-text-primary)',
                      border: 'none',
                      maxHeight: 120,
                      overflowY: 'auto',
                      lineHeight: '1.5',
                    }}
                  />
                  {text.trim() ? (
                    <button
                      type="submit"
                      disabled={sending}
                      className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 disabled:opacity-40 transition-opacity"
                      style={{ background: 'var(--wa-accent-green)', color: '#fff' }}
                    >
                      <Send size={17} />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setIsRecording(true)}
                      className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 transition-colors"
                      style={{ background: 'var(--wa-accent-green)', color: '#fff' }}
                      aria-label="Gravar áudio"
                    >
                      <Mic size={17} />
                    </button>
                  )}
                </form>
              )}
            </div>
          </>
        )}
      </div>

      {/* Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.9)' }}
          onClick={() => setLightbox(null)}
        >
          <img src={lightbox} alt="" className="max-w-[90%] max-h-[85vh] rounded-xl" />
        </div>
      )}

      <ConnectChannelModal
        open={connectOpen}
        onClose={() => setConnectOpen(false)}
        onStatusChange={() => {}}
      />
    </div>
  );
}

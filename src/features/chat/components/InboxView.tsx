import React, { useEffect, useRef, useState } from 'react';
import { Send, Wifi, WifiOff, RefreshCw, MessageCircle, ArrowLeft, Settings, Mic } from 'lucide-react';
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
    <div className="flex items-center gap-3 my-4">
      <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.06)' }} />
      <span
        className="text-[11px] px-2.5 py-1 rounded-full"
        style={{ color: '#6A6A65', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}
      >
        {label}
      </span>
      <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.06)' }} />
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

  // Auto-scroll quando chegam novas mensagens
  useEffect(() => {
    if (messages.length > prevCountRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
    prevCountRef.current = messages.length;
  }, [messages.length]);

  // Scroll imediato ao trocar de conversa
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'instant' as ScrollBehavior });
    prevCountRef.current = 0;
  }, [selectedPhone]);

  // Aplica initialPhone quando conversas carregam
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
    console.log(`[handleAudioSend] phone=${phone} mimetype=${blob.type} size=${blob.size}`);

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

  // Agrupa mensagens por data
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
    <div
      className="flex h-full overflow-hidden"
      style={{ background: '#0E0E0C', fontFamily: "'Instrument Sans', sans-serif" }}
    >
      {/* ── SIDEBAR ── */}
      <div
        className="flex flex-col flex-shrink-0 overflow-hidden"
        style={{ width: 300, borderRight: '1px solid rgba(255,255,255,0.07)' }}
      >
        {/* Status WA */}
        <div
          className="flex items-center justify-between px-4 py-2 flex-shrink-0"
          style={{ background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}
        >
          <div className="flex items-center gap-2">
            {connected === null ? (
              <span className="text-[11px]" style={{ color: '#6A6A65' }}>Verificando...</span>
            ) : connected ? (
              <>
                <Wifi size={11} style={{ color: '#B5C19D' }} />
                <span className="text-[11px]" style={{ color: '#B5C19D' }}>WhatsApp conectado</span>
              </>
            ) : (
              <>
                <WifiOff size={11} style={{ color: '#fbbf24' }} />
                <span className="text-[11px]" style={{ color: '#fbbf24' }}>Desconectado</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-1">
            {!connected && (
              <button
                onClick={() => setConnectOpen(true)}
                className="px-2 py-1 rounded text-[11px] font-semibold"
                style={{ background: '#fbbf24', color: '#0E0E0C' }}
              >
                Conectar
              </button>
            )}
            {connected && (
              <button
                onClick={() => setConnectOpen(true)}
                className="p-1 rounded"
                style={{ color: '#6A6A65' }}
                title="Gerenciar"
              >
                <Settings size={12} />
              </button>
            )}
            <button
              onClick={handleRefresh}
              className="p-1 rounded"
              style={{ color: '#6A6A65' }}
              title="Atualizar"
            >
              <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        {/* Título */}
        <div className="px-4 py-3 flex-shrink-0" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <h2 className="text-sm font-semibold" style={{ color: '#ECEAE3' }}>
            Conversas
          </h2>
          <p className="text-[11px] mt-0.5" style={{ color: '#6A6A65' }}>
            {loadingConvs ? 'Carregando...' : `${conversations.length} conversa${conversations.length !== 1 ? 's' : ''}`}
          </p>
        </div>

        {/* Lista */}
        <div className="flex-1 overflow-y-auto">
          {loadingConvs ? (
            <div className="flex flex-col gap-0">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-3">
                  <div className="w-10 h-10 rounded-full animate-pulse" style={{ background: 'rgba(255,255,255,0.06)' }} />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 rounded animate-pulse" style={{ width: '60%', background: 'rgba(255,255,255,0.06)' }} />
                    <div className="h-2 rounded animate-pulse" style={{ width: '40%', background: 'rgba(255,255,255,0.04)' }} />
                  </div>
                </div>
              ))}
            </div>
          ) : conversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 px-6 text-center py-16">
              <MessageCircle size={28} style={{ color: '#6A6A65' }} strokeWidth={1.5} />
              <p className="text-sm" style={{ color: '#6A6A65' }}>Nenhuma conversa ainda</p>
            </div>
          ) : (
            conversations.map(conv => (
              <React.Fragment key={conv.phone}>
                <ConversationItem
                  conv={conv}
                  selected={conv.phone === selectedPhone}
                  onClick={() => setSelectedPhone(conv.phone)}
                />
                <div className="mx-4" style={{ height: 1, background: 'rgba(255,255,255,0.04)' }} />
              </React.Fragment>
            ))
          )}
        </div>
      </div>

      {/* ── ÁREA DE CHAT ── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {!selectedPhone ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-4" style={{ color: '#6A6A65' }}>
            <div className="w-14 h-14 rounded-full flex items-center justify-center" style={{ background: 'rgba(181,193,157,0.08)' }}>
              <MessageCircle size={26} strokeWidth={1.5} style={{ color: '#B5C19D' }} />
            </div>
            <div className="text-center">
              <p className="text-base font-semibold" style={{ color: '#ECEAE3' }}>Selecione uma conversa</p>
              <p className="text-sm mt-1" style={{ color: '#6A6A65' }}>Escolha um contato na lista</p>
            </div>
          </div>
        ) : (
          <>
            {/* Header da conversa */}
            <div
              className="flex items-center gap-3 px-4 py-3 flex-shrink-0"
              style={{ borderBottom: '1px solid rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.02)' }}
            >
              <button
                onClick={() => setSelectedPhone(null)}
                className="p-1 rounded-lg md:hidden"
                style={{ color: '#6A6A65' }}
              >
                <ArrowLeft size={16} />
              </button>
              <div>
                <p className="text-sm font-semibold" style={{ color: '#ECEAE3' }}>
                  {selectedConv?.contact_name || selectedPhone}
                </p>
                <p className="text-xs" style={{ color: '#6A6A65' }}>{selectedPhone}</p>
              </div>
            </div>

            {/* Mensagens */}
            <div
              className="flex-1 overflow-y-auto px-4 py-3"
              style={{ scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.08) transparent' }}
            >
              {loadingMsgs ? (
                <div className="flex flex-col gap-2 pt-4">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className={`flex ${i % 2 === 0 ? 'justify-start' : 'justify-end'}`}>
                      <div
                        className="h-9 rounded-2xl animate-pulse"
                        style={{ width: `${40 + (i * 17) % 30}%`, background: 'rgba(255,255,255,0.06)' }}
                      />
                    </div>
                  ))}
                </div>
              ) : messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full gap-3" style={{ color: '#6A6A65' }}>
                  <MessageCircle size={28} strokeWidth={1.5} />
                  <p className="text-sm">Nenhuma mensagem ainda</p>
                </div>
              ) : (
                groups.map(group => (
                  <div key={group.label}>
                    <DateSep label={group.label} />
                    {group.msgs.map(msg => (
                      <React.Fragment key={msg.message_id}>
                        <MessageBubble
                          msg={msg}
                          onImageClick={setLightbox}
                          contactInitial={(selectedConv?.contact_name || selectedPhone || '?').charAt(0).toUpperCase()}
                        />
                      </React.Fragment>
                    ))}
                  </div>
                ))
              )}
              <div ref={bottomRef} />
            </div>

            {/* Composer */}
            <div
              className="flex items-end gap-2 px-4 py-3 flex-shrink-0"
              style={{ borderTop: '1px solid rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.02)' }}
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
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(e as any); } }}
                    placeholder="Digite uma mensagem..."
                    rows={1}
                    className="flex-1 rounded-xl px-3 py-2 text-sm outline-none resize-none"
                    style={{
                      background: 'rgba(255,255,255,0.06)',
                      border: '1px solid rgba(255,255,255,0.08)',
                      color: '#ECEAE3',
                      maxHeight: 120,
                      overflowY: 'auto',
                    }}
                  />
                  {text.trim() ? (
                    <button
                      type="submit"
                      disabled={sending}
                      className="w-9 h-9 rounded-full flex items-center justify-center transition-colors flex-shrink-0 disabled:opacity-40"
                      style={{ background: '#B5C19D', color: '#0E0E0C' }}
                    >
                      <Send size={15} />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setIsRecording(true)}
                      className="w-9 h-9 rounded-full flex items-center justify-center transition-colors flex-shrink-0"
                      style={{ background: 'rgba(255,255,255,0.06)', color: '#6A6A65' }}
                      aria-label="Gravar áudio"
                    >
                      <Mic size={15} />
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
          style={{ background: 'rgba(0,0,0,0.85)' }}
          onClick={() => setLightbox(null)}
        >
          <img src={lightbox} alt="" className="max-w-[90%] max-h-[85vh] rounded-xl" />
        </div>
      )}

      {/* Modal de conexão WhatsApp */}
      <ConnectChannelModal
        open={connectOpen}
        onClose={() => { setConnectOpen(false); }}
        onStatusChange={() => {}}
      />
    </div>
  );
}

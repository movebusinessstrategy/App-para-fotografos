import React, { useEffect, useRef, useState } from 'react';
import { Send, Wifi, WifiOff, RefreshCw, MessageCircle, ArrowLeft, Settings, Mic, Sun, Moon, PenSquare, Search, MoreVertical, Smile, Paperclip, ChevronDown } from 'lucide-react';
import EmojiPicker, { Theme as EmojiTheme } from 'emoji-picker-react';
import { useTheme } from '../../../contexts/ThemeContext';
import { extractContact, formatBrazilianPhone, getInitials } from '../utils/contactHelpers';
import { useContactProfile } from '../hooks/useContactProfile';
import { updateCachedContact } from '../utils/contactCache';
import { useConversations } from '../hooks/useConversations';
import { useMessages } from '../hooks/useMessages';
import { useWaStatus } from '../hooks/useWaStatus';
import { ConversationItem } from './ConversationItem';
import { MessageBubble } from './MessageBubble';
import { AudioRecorder } from './AudioRecorder';
import { ConnectChannelModal } from '../../../components/vendas/ConnectChannelModal';
import { NewConversationModal } from './NewConversationModal';
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
  const [newConvOpen, setNewConvOpen] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [mediaPreview, setMediaPreview] = useState<{ file: File; url: string; type: string } | null>(null);
  const [mediaCaption, setMediaCaption] = useState('');
  const [sendingMedia, setSendingMedia] = useState(false);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const prevCountRef = useRef(0);

  function handleMessagesScroll() {
    const el = messagesContainerRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowScrollBtn(distFromBottom > 200);
  }

  function scrollToBottom(behavior: ScrollBehavior = 'smooth') {
    const el = messagesContainerRef.current;
    if (!el) return;
    if (behavior === 'instant' as ScrollBehavior) {
      el.scrollTop = el.scrollHeight;
    } else {
      el.scrollTo({ top: el.scrollHeight, behavior });
    }
  }

  useEffect(() => {
    if (messages.length > prevCountRef.current) {
      const el = messagesContainerRef.current;
      const nearBottom = el ? el.scrollHeight - el.scrollTop - el.clientHeight < 150 : true;
      const lastMsg = messages[messages.length - 1] as any;
      const isMyMsg = lastMsg?.from_me ?? lastMsg?.fromMe ?? false;
      if (nearBottom || isMyMsg) scrollToBottom('smooth');
    }
    prevCountRef.current = messages.length;
  }, [messages.length]);

  useEffect(() => {
    scrollToBottom('instant' as ScrollBehavior);
    prevCountRef.current = 0;
  }, [selectedPhone]);

  useEffect(() => {
    if (initialPhone && !selectedPhone) setSelectedPhone(initialPhone);
  }, [initialPhone]);

  // Fecha emoji picker ao clicar fora do picker
  useEffect(() => {
    if (!showEmoji) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(e.target as Node)) {
        setShowEmoji(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showEmoji]);

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    const type = file.type.startsWith('image/') ? 'image'
               : file.type.startsWith('video/') ? 'video'
               : 'document';
    setMediaPreview({ file, url, type });
    setMediaCaption('');
    e.target.value = '';
  }

  async function sendMediaFile() {
    if (!mediaPreview || !selectedPhone) return;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) { alert('Sessão expirada'); return; }

    setSendingMedia(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(mediaPreview.file);
      });

      const res = await fetch('/api/inbox/send-media', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          phone: selectedPhone.replace(/\D/g, ''),
          mediaBase64: base64,
          mimetype: mediaPreview.file.type,
          filename: mediaPreview.file.name,
          caption: mediaCaption,
        }),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        let msg = `Erro ${res.status}`;
        try { msg = JSON.parse(body).error || msg; } catch { if (body) msg = body; }
        throw new Error(msg);
      }

      URL.revokeObjectURL(mediaPreview.url);
      setMediaPreview(null);
      setMediaCaption('');
    } catch (err) {
      alert(`Erro ao enviar arquivo: ${err instanceof Error ? err.message : 'Tente novamente.'}`);
    } finally {
      setSendingMedia(false);
    }
  }

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
  const { name: baseName, avatar: baseAvatar, phone: convPhone } = selectedConv
    ? extractContact(selectedConv, messages)
    : { name: selectedPhone ? formatBrazilianPhone(selectedPhone) : '', avatar: null, phone: selectedPhone || '' };
  const { name: resolvedName, avatar: resolvedAvatar } = useContactProfile(convPhone, baseName, baseAvatar);
  const displayName = resolvedName || baseName;
  const avatarUrl = resolvedAvatar || baseAvatar;

  // PASSO 6: atualizar cache quando mensagens recebidas chegam com nome
  useEffect(() => {
    if (!convPhone || !messages.length) return;
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i] as any;
      const fromMe = msg?.from_me ?? msg?.fromMe ?? false;
      if (fromMe) continue;
      const pushName = msg?.push_name ?? msg?.pushName ?? msg?.name;
      if (pushName && typeof pushName === 'string' && pushName.trim() && !/^\d+$/.test(pushName)) {
        updateCachedContact(convPhone, { name: pushName.trim() });
        break;
      }
    }
  }, [convPhone, messages]);

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

            <button
              onClick={() => setNewConvOpen(true)}
              className="w-8 h-8 rounded-full flex items-center justify-center transition-colors"
              style={{ color: 'var(--wa-text-secondary)' }}
              title="Nova conversa"
            >
              <PenSquare size={16} />
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
                className="w-10 h-10 rounded-full flex-shrink-0 flex items-center justify-center text-white text-sm font-semibold overflow-hidden"
                style={{ background: '#00756A' }}
              >
                {avatarUrl
                  ? <img src={avatarUrl} alt={displayName} className="w-full h-full object-cover" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                  : getInitials(displayName)
                }
              </div>

              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold leading-tight truncate" style={{ color: 'var(--wa-text-primary)' }}>
                  {displayName}
                </p>
                <p className="text-[12px] leading-tight truncate" style={{ color: 'var(--wa-text-muted)' }}>
                  {selectedPhone ? formatBrazilianPhone(selectedPhone) : ''}
                </p>
              </div>

              {/* FEATURE 6 — botões do header */}
              <div className="flex items-center gap-1 flex-shrink-0">
                <button
                  className="w-8 h-8 rounded-full flex items-center justify-center transition-colors"
                  style={{ color: 'var(--wa-text-secondary)' }}
                  title="Buscar mensagem"
                >
                  <Search size={18} />
                </button>
                <button
                  className="w-8 h-8 rounded-full flex items-center justify-center transition-colors"
                  style={{ color: 'var(--wa-text-secondary)' }}
                  title="Mais opções"
                >
                  <MoreVertical size={18} />
                </button>
              </div>
            </div>

            {/* Mensagens — container relativo para absolute inset-0 */}
            <div className="flex-1 min-h-0 relative wa-chat-pattern">
              <div
                ref={messagesContainerRef}
                onScroll={handleMessagesScroll}
                className="absolute inset-0 overflow-y-auto wa-scrollbar"
              >
                <div className="flex flex-col min-h-full justify-end px-4 py-2">
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
                    <div className="flex flex-col items-center justify-center flex-1 gap-3" style={{ color: 'var(--wa-text-muted)' }}>
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
                            contactInitial={getInitials(displayName)}
                          />
                        ))}
                      </div>
                    ))
                  )}
                  <div ref={bottomRef} />
                </div>
              </div>

              {/* Botão scroll-to-bottom */}
              {showScrollBtn && (
                <button
                  onClick={() => scrollToBottom()}
                  className="absolute bottom-4 right-4 z-10 w-10 h-10 rounded-full flex items-center justify-center shadow-lg transition-transform hover:scale-105"
                  style={{ background: 'var(--wa-bg-tertiary)', color: 'var(--wa-text-secondary)' }}
                >
                  <ChevronDown size={20} />
                </button>
              )}
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
                <form onSubmit={handleSend} className="flex items-end gap-2 flex-1 relative">
                  {/* Emoji picker popover */}
                  {showEmoji && (
                    <div
                      ref={emojiPickerRef}
                      className="absolute bottom-12 left-0 z-50"
                      onMouseDown={e => e.stopPropagation()}
                    >
                      <EmojiPicker
                        theme={EmojiTheme.DARK}
                        onEmojiClick={data => {
                          console.log('[EMOJI DEBUG]', { emoji: data.emoji, currentText: text });
                          const textarea = textareaRef.current;
                          if (!textarea) {
                            setText(prev => prev + data.emoji);
                            return;
                          }
                          const start = textarea.selectionStart ?? text.length;
                          const end   = textarea.selectionEnd   ?? text.length;
                          const newValue = text.slice(0, start) + data.emoji + text.slice(end);
                          setText(newValue);
                          // Reposiciona cursor após o emoji
                          setTimeout(() => {
                            textarea.focus();
                            const newPos = start + data.emoji.length;
                            textarea.setSelectionRange(newPos, newPos);
                          }, 0);
                          // Não fecha — permite escolher vários
                        }}
                        height={380}
                        width={320}
                      />
                    </div>
                  )}

                  {/* Input de arquivo oculto */}
                  <input
                    ref={fileRef}
                    type="file"
                    hidden
                    accept="image/*,video/*,application/pdf,.doc,.docx"
                    onChange={handleFileSelect}
                  />

                  <button
                    type="button"
                    onClick={() => setShowEmoji(v => !v)}
                    className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 transition-colors"
                    style={{ color: showEmoji ? 'var(--wa-accent-green)' : 'var(--wa-text-secondary)' }}
                    title="Emoji"
                  >
                    <Smile size={20} />
                  </button>
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 transition-colors"
                    style={{ color: 'var(--wa-text-secondary)' }}
                    title="Anexar arquivo"
                  >
                    <Paperclip size={20} />
                  </button>

                  <textarea
                    ref={textareaRef}
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

      {/* Modal de preview de mídia antes de enviar */}
      {mediaPreview && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center pb-0"
          style={{ background: 'rgba(0,0,0,0.75)' }}
          onClick={e => { if (e.target === e.currentTarget) { URL.revokeObjectURL(mediaPreview.url); setMediaPreview(null); }}}
        >
          <div
            className="w-full max-w-lg rounded-t-2xl overflow-hidden"
            style={{ background: 'var(--wa-bg-secondary)', border: '1px solid var(--wa-border)' }}
          >
            {/* Preview */}
            <div className="flex items-center justify-center p-4" style={{ background: 'var(--wa-bg-tertiary)', minHeight: 200 }}>
              {mediaPreview.type === 'image' ? (
                <img src={mediaPreview.url} alt="preview" className="max-h-64 max-w-full rounded-lg object-contain" />
              ) : mediaPreview.type === 'video' ? (
                <video src={mediaPreview.url} controls className="max-h-64 max-w-full rounded-lg" />
              ) : (
                <div className="flex flex-col items-center gap-2 py-8">
                  <Paperclip size={40} style={{ color: 'var(--wa-accent-green)' }} />
                  <span className="text-sm font-medium" style={{ color: 'var(--wa-text-primary)' }}>{mediaPreview.file.name}</span>
                  <span className="text-xs" style={{ color: 'var(--wa-text-muted)' }}>
                    {(mediaPreview.file.size / 1024).toFixed(0)} KB
                  </span>
                </div>
              )}
            </div>

            {/* Legenda + botões */}
            <div className="p-4 flex flex-col gap-3">
              <input
                type="text"
                value={mediaCaption}
                onChange={e => setMediaCaption(e.target.value)}
                placeholder="Adicionar legenda..."
                className="w-full rounded-xl px-4 py-2.5 text-sm outline-none"
                style={{ background: 'var(--wa-bg-input)', border: '1px solid var(--wa-border)', color: 'var(--wa-text-primary)' }}
                onKeyDown={e => { if (e.key === 'Enter') sendMediaFile(); }}
                autoFocus
              />
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => { URL.revokeObjectURL(mediaPreview.url); setMediaPreview(null); }}
                  className="px-4 py-2 rounded-xl text-sm font-medium"
                  style={{ background: 'var(--wa-bg-hover)', color: 'var(--wa-text-secondary)' }}
                >
                  Cancelar
                </button>
                <button
                  onClick={sendMediaFile}
                  disabled={sendingMedia}
                  className="px-5 py-2 rounded-xl text-sm font-semibold disabled:opacity-50 flex items-center gap-2"
                  style={{ background: 'var(--wa-accent-green)', color: '#fff' }}
                >
                  {sendingMedia ? (
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <Send size={15} />
                  )}
                  Enviar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <ConnectChannelModal
        open={connectOpen}
        onClose={() => setConnectOpen(false)}
        onStatusChange={() => {}}
      />

      <NewConversationModal
        open={newConvOpen}
        onClose={() => setNewConvOpen(false)}
        onStart={phone => setSelectedPhone(phone)}
      />
    </div>
  );
}

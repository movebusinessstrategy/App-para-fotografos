import React, { useEffect, useRef, useState } from 'react';
import { Send, Wifi, WifiOff, RefreshCw, MessageCircle, ArrowLeft, Settings, Mic, Sun, Moon, PenSquare, Search, MoreVertical, Smile, Paperclip, ChevronDown, UserPlus, Loader2, CheckCircle2, FileText, X, Megaphone } from 'lucide-react';
import { authFetch } from '../../../utils/authFetch';
import EmojiPicker, { Theme as EmojiTheme } from 'emoji-picker-react';
import { useTheme } from '../../../contexts/ThemeContext';
import { useAuth } from '../../../contexts/AuthContext';
import { extractContact, formatBrazilianPhone, getInitials } from '../utils/contactHelpers';
import { useContactProfile } from '../hooks/useContactProfile';
import { updateCachedContact } from '../utils/contactCache';
import { conversationMatchesSearch } from '../utils/conversationSearch';
import { useConversations } from '../hooks/useConversations';
import { useMessages } from '../hooks/useMessages';
import { useWaStatus } from '../hooks/useWaStatus';
import { ConversationItem } from './ConversationItem';
import { MessageBubble } from './MessageBubble';
import { AudioRecorder } from './AudioRecorder';
import { CrmDealStrip } from './CrmDealStrip';
import { LiaSuggestButton } from './LiaSuggestButton';
import { BulkFollowupModal } from './BulkFollowupModal';
import { WhatsAppConnectionModal } from './WhatsAppConnectionModal';
import { NewConversationModal } from './NewConversationModal';
import { WhatsAppTemplatesManager } from '../../../components/settings/WhatsAppTemplatesManager';
import { supabase } from '../../../integrations/supabase/client';
import { Deal, PipelineStage } from '../../../types';

interface Props {
  deals: Deal[];
  stages: PipelineStage[];
  initialPhone?: string;
  onDealUpdated: () => void;
  /** 'main' = WhatsApp de vendas (padrão) | 'posvenda' = página do 2º número */
  slot?: 'main' | 'posvenda';
  /** Quando presente, mostra as abas Atendimento | Pós-venda dentro da tela
   *  (o pai troca o setor — sem ícone extra no menu lateral). */
  onSlotChange?: (slot: 'main' | 'posvenda', phone?: string) => void;
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

export function InboxView({ initialPhone, deals, stages, onDealUpdated, slot = 'main', onSlotChange }: Props) {
  const { waTheme, toggleWaTheme } = useTheme();
  const { canAccess } = useAuth();
  // Página DEDICADA por número (equipes diferentes): /whatsapp = Vendas,
  // /pos-venda = Pós-venda. Cada uma lista só as conversas do seu número e
  // responde pelo socket certo — nada se mistura. posvendaOn habilita o botão
  // "enviar pro pós-venda" na visão de vendas.
  const waSlot = slot;
  const [posvendaOn, setPosvendaOn] = useState(false);
  const [pvQr, setPvQr] = useState<string | null>(null);
  const [pvQrBusy, setPvQrBusy] = useState(false);
  // Checa o status do 2º número; enquanto desconectado, segue checando a cada
  // 7s (pra tela virar sozinha assim que o QR for escaneado).
  useEffect(() => {
    if (posvendaOn) return;
    let on = true;
    const check = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) return;
        const r = await fetch('/api/whatsapp/posvenda/status', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        const d = r.ok ? await r.json() : null;
        if (on && d?.connected) { setPosvendaOn(true); setPvQr(null); }
      } catch { /* silencioso */ }
    };
    check();
    const t = setInterval(check, 7000);
    return () => { on = false; clearInterval(t); };
  }, [posvendaOn]);

  const fetchPvQr = async () => {
    setPvQrBusy(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return;
      const r = await fetch('/api/whatsapp/posvenda/qrcode', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const d = await r.json().catch(() => ({} as any));
      if (d.base64) setPvQr(d.base64);
      else if (d.state === 'open') setPosvendaOn(true);
    } catch { /* silencioso */ } finally {
      setPvQrBusy(false);
    }
  };
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(searchTerm.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [searchTerm]);
  const { conversations, loading: loadingConvs, refresh, mutateUnread } = useConversations(waSlot, debouncedSearch);
  const { connected } = useWaStatus();
  const [selectedPhone, setSelectedPhone] = useState<string | null>(initialPhone || null);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const shownConversations = conversations.filter((conversation) => {
    if (unreadOnly && conversation.unread_count <= 0) return false;
    return conversationMatchesSearch(conversation, searchTerm, extractContact(conversation).name);
  });
  const unreadTotal = conversations.filter((c) => c.unread_count > 0).length;
  const { messages, loading: loadingMsgs, sendText } = useMessages(selectedPhone, waSlot);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const [newConvOpen, setNewConvOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [mediaPreview, setMediaPreview] = useState<{ file: File; url: string; type: string } | null>(null);
  const [mediaCaption, setMediaCaption] = useState('');
  const [sendingMedia, setSendingMedia] = useState(false);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [confirmToVendas, setConfirmToVendas] = useState<{ phone: string; name: string } | null>(null);
  const [movingToVendas, setMovingToVendas] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [infoData, setInfoData] = useState<{ about?: string | null } | null>(null);

  // Fecha o painel de infos ao trocar de conversa; busca "recado" do contato
  useEffect(() => {
    setInfoOpen(false);
    setInfoData(null);
  }, [selectedPhone]);
  useEffect(() => {
    if (!infoOpen || !selectedPhone) return;
    let on = true;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) return;
        const r = await fetch(`/api/inbox/contact-info/${selectedPhone.replace(/\D/g, '')}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (on && r.ok) setInfoData(await r.json());
      } catch { /* silencioso */ }
    })();
    return () => { on = false; };
  }, [infoOpen, selectedPhone]);

  const doMoveToVendas = async () => {
    if (!confirmToVendas) return;
    setMovingToVendas(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return;
      const r = await fetch('/api/deals/quick', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: confirmToVendas.name, phone: confirmToVendas.phone, source: 'Pós-venda' }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Falha ao criar o lead');
      setConfirmToVendas(null);
      onDealUpdated();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setMovingToVendas(false);
    }
  };
  const fileRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const prevCountRef = useRef(0);

  // O campo de digitar CRESCE com o texto (até 120px, aí rola), pra dar pra ler a
  // mensagem inteira enquanto escreve — antes ficava travado em 1 linha.
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
  }, [text]);

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

  // Marca como lida ao ABRIR a conversa e tira o badge da lista na hora
  // (antes ninguém chamava o mark-read aqui — o badge nunca sumia).
  useEffect(() => {
    if (!selectedPhone) return;
    const clean = selectedPhone.replace(/\D/g, '');
    authFetch(`/api/inbox/mark-read/${clean}`, { method: 'POST' })
      .then(() => refresh())
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPhone]);

  // Mensagem nova chegou COM a conversa aberta → já marca como lida também
  // (igual ao WhatsApp: conversa aberta não acumula "não lida").
  const lastMsg = messages.length ? (messages[messages.length - 1] as any) : null;
  const lastIncomingId = lastMsg && !(lastMsg.from_me ?? lastMsg.fromMe) ? lastMsg.message_id : null;
  useEffect(() => {
    if (!selectedPhone || !lastIncomingId) return;
    const clean = selectedPhone.replace(/\D/g, '');
    authFetch(`/api/inbox/mark-read/${clean}`, { method: 'POST' })
      .then(() => refresh())
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastIncomingId]);

  // ESC volta pra lista de conversas (como no WhatsApp Web)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedPhone(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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
          ...(waSlot === 'posvenda' ? { slot: waSlot } : {}),
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
    if (!session?.access_token) throw new Error('Sessão expirada - faça login novamente');
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
        ...(waSlot === 'posvenda' ? { slot: waSlot } : {}),
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
    <div className="flex h-full overflow-hidden font-sans" style={{ background: 'var(--wa-bg-secondary)' }}>

      {/* ── SIDEBAR ── (min-h-0 permite a lista interna rolar até o fim) */}
      <div
        className="flex flex-col flex-shrink-0 min-h-0 overflow-hidden"
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
                onClick={() => setTemplatesOpen(true)}
                className="w-8 h-8 rounded-full flex items-center justify-center transition-colors"
                style={{ color: 'var(--wa-text-secondary)' }}
                title="Templates de mensagem"
              >
                <FileText size={16} />
              </button>
            )}

            {connected && (
              <button
                onClick={() => setBulkOpen(true)}
                className="w-8 h-8 rounded-full flex items-center justify-center transition-colors"
                style={{ color: 'var(--wa-text-secondary)' }}
                title="Disparos em massa por etapa do funil"
              >
                <Megaphone size={16} />
              </button>
            )}

            {/* Sempre visível: gerencia os DOIS números (Atendimento e Pós-venda) */}
            <button
              onClick={() => setConnectOpen(true)}
              className="w-8 h-8 rounded-full flex items-center justify-center transition-colors"
              style={{ color: 'var(--wa-text-secondary)' }}
              title="Conexões do WhatsApp (Atendimento e Pós-venda)"
            >
              <Settings size={16} />
            </button>

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

        {/* Setores (pastas): Atendimento | Pós-venda — SEMPRE visíveis (com
            permissão); sem o 2º número conectado, a aba Pós-venda vira a tela
            de conexão com QR ali mesmo (nada escondido em Configurações). */}
        {onSlotChange && canAccess('posvenda') && (
          <div className="px-3 pt-2 pb-1 flex-shrink-0 flex items-center gap-1.5">
            {([['main', '💬 Atendimento'], ['posvenda', '🤝 Pós-venda']] as const).map(([k, label]) => (
              <button
                key={k}
                onClick={() => { if (k !== waSlot) onSlotChange(k); }}
                className="flex-1 py-2 rounded-xl text-[13px] font-semibold transition-all"
                style={{
                  background: waSlot === k ? 'var(--wa-accent-green)' : 'var(--wa-bg-hover)',
                  color: waSlot === k ? '#fff' : 'var(--wa-text-secondary)',
                  boxShadow: waSlot === k ? '0 2px 10px -4px rgba(212,169,74,0.55)' : 'none',
                }}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        <div className="px-3 pt-2 flex-shrink-0">
          <div
            className="h-10 rounded-xl px-3 flex items-center gap-2 border transition-colors focus-within:ring-2"
            style={{
              background: 'var(--wa-bg-hover)',
              borderColor: 'var(--wa-border)',
              color: 'var(--wa-text-secondary)',
            }}
          >
            <Search size={16} className="flex-shrink-0" />
            <input
              type="search"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Buscar por nome ou número"
              aria-label="Buscar conversas por nome ou número"
              className="min-w-0 flex-1 bg-transparent border-0 outline-none text-[13px] placeholder:opacity-70"
              style={{ color: 'var(--wa-text-primary)' }}
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm('')}
                className="w-6 h-6 rounded-full flex items-center justify-center hover:opacity-70"
                aria-label="Limpar busca"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        {/* Filtros: Todas / Não lidas (igual WhatsApp) */}
        <div
          className="px-3 py-2 flex-shrink-0 flex items-center gap-2"
        >
          {([['all', 'Todas'], ['unread', 'Não lidas']] as const).map(([k, label]) => {
            const active = (k === 'unread') === unreadOnly;
            return (
              <button
                key={k}
                onClick={() => setUnreadOnly(k === 'unread')}
                className="px-3 py-1 rounded-full text-[12.5px] font-medium transition-colors"
                style={{
                  background: active ? 'var(--wa-accent-green)' : 'var(--wa-bg-hover)',
                  color: active ? '#fff' : 'var(--wa-text-secondary)',
                }}
              >
                {label}{k === 'unread' && unreadTotal > 0 ? ` (${unreadTotal})` : ''}
              </button>
            );
          })}
          {waSlot === 'posvenda' && !onSlotChange && (
            <span
              className="px-2.5 py-1 rounded-full text-[11px] font-bold"
              style={{ background: 'var(--wa-accent-green)', color: '#fff' }}
              title="Página do 2º número — só conversas do WhatsApp de alinhamento"
            >
              🤝 Pós-venda
            </span>
          )}
          <span className="ml-auto text-[12px]" style={{ color: 'var(--wa-text-muted)' }}>
            {loadingConvs ? 'Carregando...' : `${shownConversations.length}`}
          </span>
        </div>

        {/* Aba Pós-venda sem o 2º número conectado → conexão AQUI (QR inline) */}
        {waSlot === 'posvenda' && !posvendaOn ? (
          <div className="flex-1 min-h-0 overflow-y-auto wa-scrollbar px-6 py-10 flex flex-col items-center text-center gap-3">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-2xl" style={{ background: 'rgba(212,169,74,0.16)' }}>🤝</div>
            <p className="text-sm font-bold" style={{ color: 'var(--wa-text-primary)' }}>WhatsApp do Pós-venda</p>
            <p className="text-[13px] leading-snug" style={{ color: 'var(--wa-text-secondary)' }}>
              Conecte o 2º número da conta (o do alinhamento). As conversas dele aparecem só nesta aba — separadas das vendas.
            </p>
            {pvQr && (
              <>
                <img src={pvQr} alt="QR Code do Pós-venda" className="w-52 h-52 rounded-2xl bg-white p-2 shadow-lg" />
                <p className="text-[12px]" style={{ color: 'var(--wa-text-muted)' }}>
                  No celular do pós-venda: WhatsApp → Aparelhos conectados → Conectar aparelho
                </p>
              </>
            )}
            <button
              onClick={fetchPvQr}
              disabled={pvQrBusy}
              className="mt-1 px-5 py-2.5 rounded-xl text-sm font-bold text-white transition-colors disabled:opacity-60"
              style={{ background: 'var(--wa-accent-green)' }}
            >
              {pvQrBusy ? 'Gerando QR…' : pvQr ? 'Gerar novo QR' : 'Conectar 2º número'}
            </button>
          </div>
        ) : (
        <div className="flex-1 min-h-0 overflow-y-auto wa-scrollbar pb-4">
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
          ) : shownConversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 px-6 text-center py-16">
              <MessageCircle size={32} style={{ color: 'var(--wa-text-muted)' }} strokeWidth={1.5} />
              <p className="text-sm" style={{ color: 'var(--wa-text-muted)' }}>
                {searchTerm
                  ? `Nenhuma conversa encontrada para “${searchTerm}”`
                  : unreadOnly
                    ? 'Nenhuma conversa não lida'
                    : 'Nenhuma conversa ainda'}
              </p>
            </div>
          ) : (
            shownConversations.map(conv => (
              <ConversationItem
                key={conv.phone}
                conv={conv}
                selected={conv.phone === selectedPhone}
                onClick={() => setSelectedPhone(conv.phone)}
                onMarkUnread={() => {
                  // Fecha a conversa se for a aberta — senão o mark-read de
                  // "conversa aberta" desfaz o não-lida na próxima mensagem
                  if (conv.phone === selectedPhone) setSelectedPhone(null);
                  mutateUnread(conv.phone, 1); // otimista: badge aparece na hora
                  authFetch(`/api/inbox/mark-unread/${conv.phone.replace(/\D/g, '')}`, { method: 'POST' })
                    .then(() => refresh())
                    .catch(() => {});
                }}
                onMarkRead={() => {
                  mutateUnread(conv.phone, 0); // otimista: badge some na hora
                  authFetch(`/api/inbox/mark-read/${conv.phone.replace(/\D/g, '')}`, { method: 'POST' })
                    .then(() => refresh())
                    .catch(() => {});
                }}
              />
            ))
          )}
        </div>
        )}
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

              {/* Avatar + nome CLICÁVEL → abre as informações do contato (igual WhatsApp) */}
              <button
                onClick={() => setInfoOpen(true)}
                className="flex items-center gap-3 flex-1 min-w-0 text-left rounded-xl px-1 py-0.5 -mx-1 transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                title="Ver informações do contato"
              >
                <div
                  className="w-10 h-10 rounded-full flex-shrink-0 flex items-center justify-center text-white text-sm font-semibold overflow-hidden"
                  style={{ background: 'var(--wa-accent-green)' }}
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
              </button>

              {/* FEATURE 6 - botões do header */}
              <div className="flex items-center gap-1 flex-shrink-0">
                {/* Encaminhar entre os dois WhatsApps: venda fechada → pós-venda;
                    cliente do pós-venda querendo comprar de novo → NOVO lead em vendas */}
                {waSlot === 'main' && posvendaOn && selectedPhone && (
                  <button
                    onClick={() => {
                      if (onSlotChange) onSlotChange('posvenda', selectedPhone);
                      else window.location.href = `/pos-venda?phone=${encodeURIComponent(selectedPhone)}`;
                    }}
                    className="px-2.5 h-8 rounded-full flex items-center gap-1 text-[12px] font-semibold transition-colors"
                    style={{ color: 'var(--wa-accent-green)', border: '1px solid var(--wa-border)' }}
                    title="Abrir este contato na página do Pós-venda (a 1ª mensagem sai pelo 2º número)"
                  >
                    🤝 Pós-venda
                  </button>
                )}
                {waSlot === 'posvenda' && selectedPhone && (
                  <button
                    onClick={() => setConfirmToVendas({ phone: selectedPhone, name: displayName || selectedPhone })}
                    className="px-2.5 h-8 rounded-full flex items-center gap-1 text-[12px] font-semibold transition-colors"
                    style={{ color: 'var(--wa-accent-green)', border: '1px solid var(--wa-border)' }}
                    title="Cliente quer comprar de novo? Cria um NOVO lead no funil de Vendas"
                  >
                    📞 → Vendas
                  </button>
                )}
                <FunnelStatusButton
                  phone={selectedPhone || ''}
                  contactName={displayName}
                  deals={deals}
                  stages={stages}
                  onAdded={onDealUpdated}
                />
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

            {/* Faixa do CRM: só aparece quando o contato tem deal no funil. */}
            {selectedPhone && (
              <CrmDealStrip
                phone={selectedPhone}
                deals={deals}
                stages={stages}
                onUpdate={onDealUpdated}
              />
            )}

            {/* Mensagens - fundo e scroll como irmãos para evitar conflito de position CSS */}
            <div className="flex-1 min-h-0 relative">
              {/* Camada de fundo: wa-chat-pattern como irmão do scroll, não pai */}
              <div className="wa-chat-pattern absolute inset-0" aria-hidden="true" />

              {/* Camada de scroll: z-index inline garante precedência sobre .wa-chat-pattern > * */}
              <div
                ref={messagesContainerRef}
                onScroll={handleMessagesScroll}
                className="wa-scrollbar"
                style={{ position: 'absolute', inset: 0, overflowY: 'auto', zIndex: 1 }}
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
                  className="w-10 h-10 rounded-full flex items-center justify-center shadow-lg transition-transform hover:scale-105"
                  style={{
                    position: 'absolute', bottom: 16, right: 16, zIndex: 2,
                    background: 'var(--wa-bg-tertiary)', color: 'var(--wa-text-secondary)',
                  }}
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
                          // Não fecha - permite escolher vários
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

                  <LiaSuggestButton
                    messages={messages}
                    onSuggested={reply => {
                      setText(reply);
                      // Foca o textarea pra usuário revisar antes de mandar
                      setTimeout(() => textareaRef.current?.focus(), 0);
                    }}
                  />

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

      {/* Conexões dos DOIS números (Atendimento + Pós-venda) — mora no chat */}
      <WhatsAppConnectionModal
        open={connectOpen}
        onClose={() => setConnectOpen(false)}
      />

      <NewConversationModal
        open={newConvOpen}
        onClose={() => setNewConvOpen(false)}
        onStart={phone => setSelectedPhone(phone)}
      />

      <BulkFollowupModal
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        stages={stages}
        deals={deals}
        onSent={onDealUpdated}
      />

      {/* Gerenciador de templates - aberto como modal pelo header do Inbox */}
      {templatesOpen && (
        <div className="fixed inset-0 z-[70] flex items-start justify-center bg-black/50 p-4 overflow-y-auto">
          <div className="w-full max-w-3xl my-8" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-end mb-2">
              <button
                onClick={() => setTemplatesOpen(false)}
                className="w-9 h-9 rounded-full bg-white dark:bg-gray-800 shadow-lg flex items-center justify-center text-gray-500 hover:text-gray-700 dark:hover:text-gray-200"
                title="Fechar"
              >
                <X size={18} />
              </button>
            </div>
            <WhatsAppTemplatesManager
              onNotify={(kind, message) => {
                if (kind === "error") alert("Erro: " + message);
                else alert(message);
              }}
            />
          </div>
        </div>
      )}

      {/* Painel de informações do contato (clique no nome) — dados EDITÁVEIS */}
      {infoOpen && selectedPhone && (
        <ContactInfoPanel
          key={selectedPhone}
          phone={selectedPhone}
          displayName={displayName}
          avatarUrl={avatarUrl}
          about={infoData?.about || null}
          deals={deals}
          stages={stages}
          onClose={() => setInfoOpen(false)}
          onDealUpdated={onDealUpdated}
        />
      )}

      {/* Confirmação (custom, sem popup nativo) — encaminhar pro funil de Vendas */}
      {confirmToVendas && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          onClick={() => !movingToVendas && setConfirmToVendas(null)}
        >
          <div
            className="w-full max-w-sm rounded-3xl overflow-hidden shadow-2xl"
            style={{ background: 'var(--wa-bg-secondary)', border: '1px solid var(--wa-border)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-5 flex items-start gap-3" style={{ borderBottom: '1px solid var(--wa-border)' }}>
              <div className="w-11 h-11 rounded-2xl flex items-center justify-center text-xl flex-shrink-0" style={{ background: 'rgba(212,169,74,0.16)' }}>📞</div>
              <div>
                <h3 className="text-[15px] font-bold" style={{ color: 'var(--wa-text-primary)' }}>Enviar para Vendas?</h3>
                <p className="mt-1 text-[13px] leading-snug" style={{ color: 'var(--wa-text-secondary)' }}>
                  Cria um <b>novo lead</b> de <b>{confirmToVendas.name}</b> no funil de Vendas — conta como <b>nova oportunidade</b>. A equipe de vendas assume a partir daí.
                </p>
              </div>
            </div>
            <div className="p-4 flex gap-2 justify-end">
              <button
                onClick={() => setConfirmToVendas(null)}
                disabled={movingToVendas}
                className="px-4 py-2 rounded-xl text-[13px] font-semibold transition-colors disabled:opacity-60"
                style={{ background: 'var(--wa-bg-hover)', color: 'var(--wa-text-secondary)' }}
              >
                Cancelar
              </button>
              <button
                onClick={doMoveToVendas}
                disabled={movingToVendas}
                className="px-4 py-2 rounded-xl text-[13px] font-bold text-white transition-colors disabled:opacity-60"
                style={{ background: 'var(--wa-accent-green)' }}
              >
                {movingToVendas ? 'Criando…' : 'Sim, criar oportunidade'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Funnel status button (header da conversa) ──────────────────────────────
// Mostra badge com etapa atual se a conversa já tem deal, ou botão de adicionar
// ao funil de vendas se ainda não tem.

// Painel "Informações do contato" — o feijão com arroz EDITÁVEL sem sair do
// chat: nome, e-mail, observações, etapa do funil e marcar como ganho.
// Sem lead no funil, oferece "Adicionar ao funil".
function ContactInfoPanel({ phone, displayName, avatarUrl, about, deals, stages, onClose, onDealUpdated }: {
  phone: string;
  displayName: string;
  avatarUrl: string | null;
  about: string | null;
  deals: Deal[];
  stages: PipelineStage[];
  onClose: () => void;
  onDealUpdated: () => void;
}) {
  const digits = phone.replace(/\D/g, '');
  const deal = deals.find(d => (d.contact_phone || '').replace(/\D/g, '').endsWith(digits.slice(-8))) || null;
  const [nome, setNome] = useState((deal as any)?.contact_name || displayName);
  const [email, setEmail] = useState((deal as any)?.contact_email || '');
  const [notes, setNotes] = useState((deal as any)?.notes || '');
  const [stageId, setStageId] = useState((deal as any)?.stage || '');
  const [busy, setBusy] = useState<false | 'save' | 'won' | 'add'>(false);
  const [saved, setSaved] = useState(false);
  const wonStage = stages.find(s => (s as any).is_won);
  const isWonNow = !!(stageId && wonStage && stageId === wonStage.id);

  const authedFetch = async (url: string, init?: RequestInit) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error('Sessão expirada — faça login de novo.');
    return fetch(url, {
      ...init,
      headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json', ...(init?.headers || {}) },
    });
  };

  const salvar = async () => {
    if (!deal) return;
    setBusy('save');
    try {
      const body: any = { contact_name: nome.trim() || null, contact_email: email.trim() || null, notes };
      if (stageId && stageId !== (deal as any).stage) body.stage = stageId;
      const r = await authedFetch(`/api/deals/${(deal as any).id}`, { method: 'PUT', body: JSON.stringify(body) });
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || 'Falha ao salvar'); }
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
      onDealUpdated();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  };

  const marcarGanho = async () => {
    if (!deal || !wonStage) return;
    setBusy('won');
    try {
      const r = await authedFetch(`/api/deals/${(deal as any).id}`, { method: 'PUT', body: JSON.stringify({ stage: wonStage.id }) });
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || 'Falha ao marcar ganho'); }
      setStageId(wonStage.id);
      onDealUpdated();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  };

  const adicionarAoFunil = async () => {
    setBusy('add');
    try {
      const r = await authedFetch('/api/deals/quick', {
        method: 'POST',
        body: JSON.stringify({ name: displayName || phone, phone: digits, source: 'WhatsApp' }),
      });
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || 'Falha ao adicionar'); }
      onDealUpdated();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  };

  const inputCls = "w-full px-3 py-2 rounded-xl text-sm outline-none";
  const inputStyle = { background: 'var(--wa-bg-input)', color: 'var(--wa-text-primary)', border: '1px solid var(--wa-border)' } as React.CSSProperties;
  const labelCls = "text-[11px] uppercase tracking-wide font-semibold mb-1 block";
  const labelStyle = { color: 'var(--wa-text-muted)' } as React.CSSProperties;

  return (
    <div className="fixed inset-0 z-[75] flex justify-end bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-sm h-full flex flex-col shadow-2xl"
        style={{ background: 'var(--wa-bg-secondary)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3 flex-shrink-0" style={{ background: 'var(--wa-bg-tertiary)', borderBottom: '1px solid var(--wa-border)' }}>
          <button onClick={onClose} className="p-1 rounded-full" style={{ color: 'var(--wa-text-secondary)' }}><X size={20} /></button>
          <span className="text-sm font-semibold" style={{ color: 'var(--wa-text-primary)' }}>Informações do contato</span>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto wa-scrollbar">
          {/* Cabeçalho: foto + nome + telefone */}
          <div className="flex flex-col items-center gap-3 py-7 px-4" style={{ borderBottom: '8px solid var(--wa-bg-primary)' }}>
            <div className="w-24 h-24 rounded-full flex items-center justify-center text-white text-3xl font-semibold overflow-hidden" style={{ background: 'var(--wa-accent-green)' }}>
              {avatarUrl
                ? <img src={avatarUrl} alt={displayName} className="w-full h-full object-cover" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                : getInitials(displayName)}
            </div>
            <div className="text-center">
              <p className="text-lg font-semibold" style={{ color: 'var(--wa-text-primary)' }}>{displayName}</p>
              <p className="text-sm mt-0.5" style={{ color: 'var(--wa-text-muted)' }}>{formatBrazilianPhone(phone)}</p>
            </div>
            {about && <p className="text-[13px] italic text-center px-4" style={{ color: 'var(--wa-text-secondary)' }}>“{about}”</p>}
          </div>

          {deal ? (
            <div className="px-5 py-4 space-y-4">
              {/* Etapa + Ganho */}
              <div>
                <label className={labelCls} style={labelStyle}>Etapa do funil</label>
                <select
                  value={stageId}
                  onChange={(e) => setStageId(e.target.value)}
                  className={inputCls}
                  style={inputStyle}
                >
                  {stages.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                {wonStage && !isWonNow && (
                  <button
                    onClick={marcarGanho}
                    disabled={!!busy}
                    className="mt-2 w-full py-2.5 rounded-xl text-sm font-bold text-white transition-colors disabled:opacity-60"
                    style={{ background: 'var(--wa-accent-green)' }}
                  >
                    {busy === 'won' ? 'Marcando…' : '🏆 Marcar como Ganho'}
                  </button>
                )}
                {isWonNow && (
                  <p className="mt-2 text-[13px] font-semibold text-center" style={{ color: 'var(--wa-accent-green)' }}>🏆 Venda ganha!</p>
                )}
              </div>

              {typeof (deal as any).value === 'number' && (deal as any).value > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-sm" style={{ color: 'var(--wa-text-secondary)' }}>Valor</span>
                  <span className="text-sm font-semibold" style={{ color: 'var(--wa-text-primary)' }}>
                    {(deal as any).value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                  </span>
                </div>
              )}

              {/* Dados editáveis */}
              <div>
                <label className={labelCls} style={labelStyle}>Nome</label>
                <input value={nome} onChange={(e) => setNome(e.target.value)} className={inputCls} style={inputStyle} />
              </div>
              <div>
                <label className={labelCls} style={labelStyle}>E-mail</label>
                <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="email@exemplo.com" className={inputCls} style={inputStyle} />
              </div>
              <div>
                <label className={labelCls} style={labelStyle}>Observações</label>
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} placeholder="Anotações sobre o cliente…" className={`${inputCls} resize-none wa-scrollbar`} style={inputStyle} />
              </div>

              <button
                onClick={salvar}
                disabled={!!busy}
                className="w-full py-2.5 rounded-xl text-sm font-bold transition-colors disabled:opacity-60"
                style={saved
                  ? { background: 'rgba(212,169,74,0.16)', color: 'var(--wa-accent-green)' }
                  : { background: 'var(--wa-accent-green)', color: '#fff' }}
              >
                {busy === 'save' ? 'Salvando…' : saved ? '✓ Salvo!' : 'Salvar alterações'}
              </button>
            </div>
          ) : (
            <div className="px-5 py-6 text-center space-y-3">
              <p className="text-sm" style={{ color: 'var(--wa-text-muted)' }}>Este contato ainda não está no funil.</p>
              <button
                onClick={adicionarAoFunil}
                disabled={!!busy}
                className="w-full py-2.5 rounded-xl text-sm font-bold text-white transition-colors disabled:opacity-60"
                style={{ background: 'var(--wa-accent-green)' }}
              >
                {busy === 'add' ? 'Adicionando…' : '+ Adicionar ao funil'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function FunnelStatusButton({
  phone, contactName, deals, stages, onAdded,
}: {
  phone: string;
  contactName: string;
  deals: Deal[];
  stages: PipelineStage[];
  onAdded: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [justAdded, setJustAdded] = useState(false);

  if (!phone) return null;

  // Match contact_phone com várias normalizações (com/sem 55, só dígitos)
  const onlyDigits = (s: string) => (s || '').replace(/\D/g, '');
  const target = onlyDigits(phone);
  const targetShort = target.startsWith('55') ? target.slice(2) : target;
  const existingDeal = deals.find(d => {
    const dp = onlyDigits(d.contact_phone || '');
    if (!dp) return false;
    const dpShort = dp.startsWith('55') ? dp.slice(2) : dp;
    return dp === target || dpShort === targetShort || dp === targetShort || dpShort === target;
  });

  if (existingDeal) {
    const stage = stages.find(s => s.id === existingDeal.stage);
    const stageName = stage?.name || 'No funil';
    const stageColor = stage?.color || '#10b981';
    return (
      <div
        title={`No funil: ${stageName}`}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold"
        style={{
          background: `${stageColor}20`,
          color: stageColor,
          border: `1px solid ${stageColor}40`,
        }}
      >
        <CheckCircle2 size={11} />
        <span className="max-w-[120px] truncate">{stageName}</span>
      </div>
    );
  }

  const handleAdd = async () => {
    if (adding) return;
    setAdding(true);
    try {
      const res = await authFetch('/api/deals/quick', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: contactName || phone,
          phone: target,
          source: 'WhatsApp',
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert('Erro ao adicionar ao funil: ' + (err.error || res.statusText));
        return;
      }
      setJustAdded(true);
      onAdded();
      setTimeout(() => setJustAdded(false), 2000);
    } finally {
      setAdding(false);
    }
  };

  return (
    <button
      onClick={handleAdd}
      disabled={adding}
      title="Adicionar este contato ao funil de vendas"
      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[11px] font-semibold transition-colors disabled:opacity-60"
      style={{
        background: justAdded ? 'rgba(16, 185, 129, 0.15)' : 'var(--wa-bg-secondary, rgba(255,255,255,0.08))',
        color: justAdded ? '#10b981' : 'var(--wa-text-secondary)',
        border: justAdded ? '1px solid rgba(16, 185, 129, 0.4)' : '1px solid var(--wa-border, rgba(255,255,255,0.1))',
      }}
    >
      {adding ? <Loader2 size={11} className="animate-spin" /> :
       justAdded ? <CheckCircle2 size={11} /> :
       <UserPlus size={11} />}
      {justAdded ? 'Adicionado!' : 'Adicionar ao funil'}
    </button>
  );
}

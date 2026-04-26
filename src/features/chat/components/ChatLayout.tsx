import React, { useCallback, useEffect, useState } from 'react';
import { Wifi, WifiOff, Loader2, MessageCircle } from 'lucide-react';
import { Deal, PipelineStage } from '../../../types';
import { Conversation } from '../types';
import { useConversations } from '../hooks/useConversations';
import { useWaStatus } from '../hooks/useWaStatus';
import { ConversationList } from './ConversationList';
import { ActiveChat } from './ActiveChat';
import { ClientContext } from './ClientContext';
import { ConnectChannelModal } from '../../../components/vendas/ConnectChannelModal';

interface Props {
  deals: Deal[];
  stages: PipelineStage[];
  initialPhone?: string;
  onDealUpdated: () => void;
}

export function ChatLayout({ deals, stages, initialPhone, onDealUpdated }: Props) {
  const { conversations, loading, refreshing, refresh, addOrGet } = useConversations();
  const { status: waStatus, check: checkWa } = useWaStatus();

  const [selected, setSelected] = useState<Conversation | null>(null);
  const [connectOpen, setConnectOpen] = useState(false);

  // Seleciona conversa via initialPhone (vindo do DealCard ou URL)
  useEffect(() => {
    if (!initialPhone) return;
    const match = conversations.find((c) => c.phone === initialPhone);
    if (match) {
      setSelected(match);
    } else if (conversations.length > 0 || !loading) {
      setSelected({
        phone: initialPhone,
        contact_name: null,
        last_message: '',
        last_message_at: new Date().toISOString(),
        unread_count: 0,
      });
    }
  }, [initialPhone, conversations, loading]);

  // Mantém dados da conversa selecionada sincronizados quando a lista atualiza
  useEffect(() => {
    if (!selected) return;
    const updated = conversations.find((c) => c.phone === selected.phone);
    if (
      updated &&
      (updated.unread_count !== selected.unread_count ||
        updated.last_message !== selected.last_message ||
        updated.contact_name !== selected.contact_name)
    ) {
      setSelected(updated);
    }
  }, [conversations]);

  const handleSelect = useCallback((conv: Conversation) => {
    setSelected(conv);
  }, []);

  const handleNewConversation = useCallback(
    (phone: string, name?: string) => {
      const conv = addOrGet(phone, name);
      setSelected(conv);
    },
    [addOrGet]
  );

  const statusBar = () => {
    const isChecking = waStatus === 'checking';
    const isConnected = waStatus === 'connected';

    return (
      <div
        className="flex items-center justify-between gap-3 px-5 py-2 flex-shrink-0"
        style={{
          background: isChecking
            ? 'rgba(255,255,255,0.03)'
            : isConnected
            ? 'rgba(181,193,157,0.06)'
            : 'rgba(251,191,36,0.06)',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
        }}
      >
        <div className="flex items-center gap-2">
          {isChecking ? (
            <Loader2 size={12} className="animate-spin" style={{ color: '#6A6A65' }} />
          ) : isConnected ? (
            <Wifi size={12} style={{ color: '#B5C19D' }} />
          ) : (
            <WifiOff size={12} style={{ color: '#fbbf24' }} />
          )}
          <span
            className="text-xs font-medium"
            style={{
              color: isChecking ? '#6A6A65' : isConnected ? '#B5C19D' : '#fbbf24',
            }}
          >
            {isChecking
              ? 'Verificando conexão...'
              : isConnected
              ? 'WhatsApp conectado'
              : 'WhatsApp desconectado'}
          </span>
        </div>
        <button
          onClick={() => setConnectOpen(true)}
          className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors flex-shrink-0"
          style={
            isConnected
              ? { color: '#6A6A65', background: 'rgba(255,255,255,0.04)' }
              : { background: '#fbbf24', color: '#0E0E0C' }
          }
        >
          <Wifi size={10} />
          {isConnected ? 'Gerenciar' : 'Conectar'}
        </button>
      </div>
    );
  };

  return (
    <>
      <div
        className="flex flex-col h-full overflow-hidden"
        style={{
          background: 'var(--color-chat-canvas)',
          fontFamily: "'Instrument Sans', sans-serif",
        }}
      >
        {statusBar()}

        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* ── Lista de conversas ─ sempre visível no md+ ── */}
          <div
            className="flex-shrink-0 flex flex-col min-h-0 overflow-hidden"
            style={{
              width: 300,
              borderRight: '1px solid rgba(255,255,255,0.06)',
            }}
          >
            {/* Contador + refresh */}
            <div
              className="flex items-center justify-between px-4 py-2 flex-shrink-0"
              style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}
            >
              <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: '#6A6A65' }}>
                {conversations.length} conversa{conversations.length !== 1 ? 's' : ''}
              </span>
              <button
                onClick={refresh}
                disabled={refreshing}
                className="p-1 rounded transition-colors"
                style={{ color: '#6A6A65' }}
                title="Atualizar"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={refreshing ? 'animate-spin' : ''}
                >
                  <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
                  <path d="M21 3v5h-5" />
                  <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
                  <path d="M8 16H3v5" />
                </svg>
              </button>
            </div>

            <ConversationList
              conversations={conversations}
              selectedPhone={selected?.phone ?? null}
              loading={loading}
              onSelect={handleSelect}
              onNewConversation={handleNewConversation}
            />
          </div>

          {/* ── Chat ativo ── */}
          <div className="flex-1 min-w-0 min-h-0 overflow-hidden">
            {selected ? (
              <ActiveChat
                phone={selected.phone}
                contactName={selected.contact_name ?? null}
              />
            ) : (
              <div
                className="flex flex-col items-center justify-center h-full gap-4"
                style={{ color: '#6A6A65' }}
              >
                <div
                  className="w-14 h-14 rounded-full flex items-center justify-center"
                  style={{ background: 'rgba(181,193,157,0.08)' }}
                >
                  <MessageCircle size={26} strokeWidth={1.5} style={{ color: '#B5C19D' }} />
                </div>
                <div className="text-center">
                  <p
                    className="text-base font-semibold"
                    style={{ color: '#ECEAE3', fontFamily: "'Instrument Serif', serif" }}
                  >
                    Selecione uma conversa
                  </p>
                  <p className="text-sm mt-1" style={{ color: '#6A6A65' }}>
                    Escolha um contato na lista para começar
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* ── Painel CRM ── */}
          <div
            className="flex-shrink-0 min-h-0 overflow-hidden"
            style={{ width: 260 }}
          >
            {selected ? (
              <ClientContext
                phone={selected.phone}
                contactName={selected.contact_name ?? null}
                deals={deals}
                stages={stages}
                onDealUpdated={onDealUpdated}
              />
            ) : (
              <div
                className="flex flex-col items-center justify-center h-full px-4 text-center"
                style={{
                  background: 'var(--color-chat-panel)',
                  borderLeft: '1px solid rgba(255,255,255,0.06)',
                }}
              >
                <p className="text-sm" style={{ color: '#6A6A65' }}>
                  Abra uma conversa para ver as informações do contato
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      <ConnectChannelModal
        open={connectOpen}
        onClose={() => {
          setConnectOpen(false);
          checkWa();
        }}
        onStatusChange={(_, connected) => {
          if (connected) checkWa();
        }}
      />
    </>
  );
}

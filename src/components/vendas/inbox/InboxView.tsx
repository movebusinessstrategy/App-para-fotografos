import React, { useCallback, useEffect, useRef, useState } from "react";
import { ConversationList, Conversation } from "./ConversationList";
import { ChatView } from "./ChatView";
import { CrmPanel } from "./CrmPanel";
import { ConnectChannelModal } from "../ConnectChannelModal";
import { authFetch } from "../../../utils/authFetch";
import { Deal, PipelineStage } from "../../../types";
import { MessageCircle, RefreshCw, Wifi, WifiOff, Loader2 } from "lucide-react";

interface Props {
  deals: Deal[];
  stages: PipelineStage[];
  initialPhone?: string;
  onDealUpdated: () => void;
}

type WaStatus = "connected" | "disconnected" | "connecting" | "checking";

export function InboxView({ deals, stages, initialPhone, onDealUpdated }: Props) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selected, setSelected] = useState<Conversation | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [waStatus, setWaStatus] = useState<WaStatus>("checking");
  const [connectOpen, setConnectOpen] = useState(false);
  const [connectChoiceOpen, setConnectChoiceOpen] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchConversations = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const res = await authFetch("/api/inbox/conversations");
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          const sorted = data.sort((a, b) =>
            new Date(b.last_message_at || 0).getTime() - new Date(a.last_message_at || 0).getTime()
          );
          setConversations(sorted);

          // Auto-select se veio de um DealCard com phone na URL
          if (initialPhone && !selected) {
            const match = sorted.find((c) => c.phone === initialPhone);
            if (match) {
              setSelected(match);
            } else {
              // Ainda não tem conversa — cria placeholder para abrir o chat
              setSelected({ phone: initialPhone, contact_name: null, last_message: '', last_message_at: new Date().toISOString(), unread_count: 0 });
            }
          }
        }
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [initialPhone]);

  const checkWaStatus = useCallback(async () => {
    try {
      const res = await authFetch("/api/whatsapp/status");
      if (res.ok) {
        const data = await res.json();
        const connected = data?.whatsapp?.connected === true || data?.connected === true;
        setWaStatus(connected ? "connected" : "disconnected");
      }
    } catch {
      setWaStatus("disconnected");
    }
  }, []);

  useEffect(() => {
    checkWaStatus();
    fetchConversations();
    pollRef.current = setInterval(() => {
      fetchConversations(true);
      checkWaStatus();
    }, 8000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [fetchConversations, checkWaStatus]);

  // Quando deals mudam, atualiza contato selecionado se necessário
  useEffect(() => {
    if (selected) {
      const updated = conversations.find((c) => c.phone === selected.phone);
      if (updated) setSelected(updated);
    }
  }, [conversations]);

  // Reage quando initialPhone muda (clique em outro DealCard)
  useEffect(() => {
    if (!initialPhone) return;
    const match = conversations.find((c) => c.phone === initialPhone);
    if (match) {
      setSelected(match);
    } else {
      setSelected({ phone: initialPhone, contact_name: null, last_message: '', last_message_at: new Date().toISOString(), unread_count: 0 });
    }
  }, [initialPhone]);

  const handleSelect = (conv: Conversation) => {
    setSelected(conv);
  };

  return (
    <>
    <div className="flex flex-col h-full overflow-hidden">
      {/* Banner de status WhatsApp */}
      <div className={`flex items-center justify-between gap-3 px-5 py-2.5 text-sm flex-shrink-0 border-b ${
        waStatus === "checking"
          ? "bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-400"
          : waStatus === "connected"
          ? "bg-green-50 dark:bg-green-900/10 border-green-100 dark:border-green-900/30"
          : "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800"
      }`}>
        <div className="flex items-center gap-2">
          {waStatus === "checking" ? (
            <Loader2 size={14} className="animate-spin text-gray-400" />
          ) : waStatus === "connected" ? (
            <Wifi size={14} className="text-green-500" />
          ) : (
            <WifiOff size={14} className="text-amber-500" />
          )}
          <span className={
            waStatus === "checking" ? "text-gray-400" :
            waStatus === "connected" ? "text-green-700 dark:text-green-400 font-medium" :
            "text-amber-700 dark:text-amber-400 font-medium"
          }>
            {waStatus === "checking" ? "Verificando conexão..." :
             waStatus === "connected" ? "WhatsApp conectado" :
             "WhatsApp desconectado — conecte para enviar e receber mensagens"}
          </span>
        </div>
        <button
          onClick={() => setConnectChoiceOpen(true)}
          className={`flex items-center gap-1.5 px-3 py-1 text-xs font-bold rounded-lg transition-colors flex-shrink-0 ${
            waStatus === "connected"
              ? "text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
              : "bg-amber-500 hover:bg-amber-600 text-white"
          }`}
        >
          <Wifi size={12} />
          {waStatus === "connected" ? "Gerenciar" : "Conectar"}
        </button>
      </div>

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Lista de conversas — 280px fixo com scroll interno */}
        <div className="w-[280px] flex-shrink-0 flex flex-col min-h-0 overflow-hidden border-r border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between px-4 pt-3 pb-1 flex-shrink-0">
            <span className="text-[11px] text-gray-400 font-semibold uppercase tracking-wider">
              {conversations.length} conversa{conversations.length !== 1 ? "s" : ""}
            </span>
            <button
              onClick={() => fetchConversations(true)}
              disabled={refreshing}
              className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gold-500 transition-colors"
              title="Atualizar"
            >
              <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />
            </button>
          </div>
        <ConversationList
          className="flex-1 min-h-0"
          conversations={conversations}
          selectedPhone={selected?.phone ?? null}
          loading={loading}
          onSelect={handleSelect}
        />
      </div>

        {/* Chat — flex 1, tamanho fixo pelo flex */}
        <div className="flex-1 min-w-0 min-h-0 overflow-hidden">
          {selected ? (
            <ChatView phone={selected.phone} contactName={selected.contact_name} />
          ) : (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-gray-400 bg-gray-50 dark:bg-gray-900">
              <div className="w-16 h-16 rounded-full bg-gold-50 dark:bg-gold-900/30 flex items-center justify-center">
                <MessageCircle size={30} className="text-gold-400" strokeWidth={1.5} />
              </div>
              <div className="text-center">
                <p className="text-base font-semibold text-gray-600 dark:text-gray-300">Selecione uma conversa</p>
                <p className="text-sm text-gray-400 mt-1">Escolha um contato na lista para começar</p>
              </div>
            </div>
          )}
        </div>

        {/* Painel CRM — 260px fixo com scroll */}
        <div className="w-[260px] flex-shrink-0 min-h-0 overflow-hidden">
          {selected ? (
            <CrmPanel
              phone={selected.phone}
              contactName={selected.contact_name}
              deals={deals}
              stages={stages}
              onDealUpdated={onDealUpdated}
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-gray-400 bg-white dark:bg-gray-800 border-l border-gray-200 dark:border-gray-700">
              <p className="text-sm text-center px-4">Abra uma conversa para ver as informações de CRM</p>
            </div>
          )}
        </div>
      </div>
    </div>

    {/* Modal de escolha: QR Code vs API Oficial */}
    {connectChoiceOpen && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-sm p-6">
          <h2 className="text-base font-bold text-gray-900 dark:text-white mb-1">Como deseja conectar?</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">Escolha o método de integração com o WhatsApp</p>

          <div className="space-y-3">
            {/* QR Code */}
            <button
              onClick={() => { setConnectChoiceOpen(false); setConnectOpen(true); }}
              className="w-full flex items-start gap-4 p-4 rounded-xl border-2 border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 hover:border-green-400 dark:hover:border-green-600 transition-colors text-left"
            >
              <span className="text-2xl flex-shrink-0">📱</span>
              <div>
                <p className="font-semibold text-gray-900 dark:text-white text-sm">QR Code (recomendado)</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  Conecta igual ao WhatsApp Web. <strong className="text-green-600">Grátis</strong>, sem aprovação. Recebe nome, fotos e histórico de mensagens.
                </p>
              </div>
            </button>

            {/* API Oficial Meta */}
            <button
              onClick={() => { setConnectChoiceOpen(false); window.open('https://developers.facebook.com/docs/whatsapp', '_blank'); }}
              className="w-full flex items-start gap-4 p-4 rounded-xl border-2 border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 hover:border-gray-400 dark:hover:border-gray-600 transition-colors text-left"
            >
              <span className="text-2xl flex-shrink-0">🏢</span>
              <div>
                <p className="font-semibold text-gray-900 dark:text-white text-sm">API Oficial Meta</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  Requer aprovação empresarial no Meta. Gratuito até 1.000 conversas/mês. Mais restrito — não acessa fotos de perfil nem histórico.
                </p>
              </div>
            </button>
          </div>

          <button
            onClick={() => setConnectChoiceOpen(false)}
            className="w-full mt-4 py-2 text-sm text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          >
            Cancelar
          </button>
        </div>
      </div>
    )}

    <ConnectChannelModal
      open={connectOpen}
      onClose={() => { setConnectOpen(false); checkWaStatus(); }}
      onStatusChange={(_, connected) => { if (connected) setWaStatus("connected"); }}
    />
    </>
  );
}

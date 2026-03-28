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
  onDealUpdated: () => void;
}

type WaStatus = "connected" | "disconnected" | "connecting" | "checking";

export function InboxView({ deals, stages, onDealUpdated }: Props) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selected, setSelected] = useState<Conversation | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [waStatus, setWaStatus] = useState<WaStatus>("checking");
  const [connectOpen, setConnectOpen] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchConversations = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const res = await authFetch("/api/inbox/conversations");
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          // Ordenar por data mais recente
          setConversations(
            data.sort((a, b) =>
              new Date(b.last_message_at || 0).getTime() - new Date(a.last_message_at || 0).getTime()
            )
          );
        }
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

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

  const handleSelect = (conv: Conversation) => {
    setSelected(conv);
  };

  return (
    <>
    <div className="flex flex-col h-full overflow-hidden">
      {/* Banner de status WhatsApp */}
      {waStatus !== "connected" && (
        <div className={`flex items-center justify-between gap-3 px-5 py-2.5 text-sm flex-shrink-0 ${
          waStatus === "checking"
            ? "bg-gray-100 dark:bg-gray-700 text-gray-500"
            : "bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800"
        }`}>
          <div className="flex items-center gap-2">
            {waStatus === "checking" ? (
              <Loader2 size={14} className="animate-spin text-gray-400" />
            ) : (
              <WifiOff size={14} className="text-amber-500" />
            )}
            <span className={waStatus === "checking" ? "text-gray-500" : "text-amber-700 dark:text-amber-400 font-medium"}>
              {waStatus === "checking" ? "Verificando conexão..." : "WhatsApp desconectado — conecte para receber e enviar mensagens"}
            </span>
          </div>
          {waStatus === "disconnected" && (
            <button
              onClick={() => setConnectOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-lg transition-colors flex-shrink-0"
            >
              <Wifi size={12} />
              Conectar
            </button>
          )}
        </div>
      )}

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
              className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-indigo-500 transition-colors"
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
              <div className="w-16 h-16 rounded-full bg-indigo-50 dark:bg-indigo-900/30 flex items-center justify-center">
                <MessageCircle size={30} className="text-indigo-400" strokeWidth={1.5} />
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

    <ConnectChannelModal
      open={connectOpen}
      onClose={() => { setConnectOpen(false); checkWaStatus(); }}
      onStatusChange={(_, connected) => { if (connected) setWaStatus("connected"); }}
    />
    </>
  );
}

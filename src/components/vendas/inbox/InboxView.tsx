import React, { useCallback, useEffect, useRef, useState } from "react";
import { ConversationList, Conversation } from "./ConversationList";
import { ChatView } from "./ChatView";
import { CrmPanel } from "./CrmPanel";
import { ConnectChannelModal } from "../ConnectChannelModal";
import { authFetch } from "../../../utils/authFetch";
import { startVisiblePoll } from "../../../utils/poll";
import { Deal, PipelineStage } from "../../../types";
import { MessageCircle, RefreshCw, Wifi, WifiOff, Loader2, AlertCircle } from "lucide-react";

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
  const [metaDiag, setMetaDiag] = useState<{ state: 'ready' | 'provisioning' | 'error'; message: string } | null>(null);
  const pollRef = useRef<(() => void) | null>(null);

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

          if (initialPhone && !selected) {
            const match = sorted.find((c) => c.phone === initialPhone);
            if (match) {
              setSelected(match);
            } else {
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

  // Diagnóstico do Meta Cloud API — checa se o número já foi promovido pra
  // CLOUD_API ou ainda está em ON_PREMISE aguardando App Review. Mudança rara,
  // então busca uma vez no mount e atualiza só quando o user re-conecta.
  const checkMetaDiag = useCallback(async () => {
    try {
      const res = await authFetch("/api/meta/whatsapp/diag");
      if (!res.ok) { setMetaDiag(null); return; }
      const data = await res.json();
      if (!data?.connected) { setMetaDiag(null); return; }
      setMetaDiag({ state: data.state, message: data.message });
    } catch {
      setMetaDiag(null);
    }
  }, []);

  useEffect(() => {
    checkWaStatus();
    checkMetaDiag();
    fetchConversations();
    pollRef.current = startVisiblePoll(() => Promise.allSettled([
      fetchConversations(true), checkWaStatus(),
    ]), 12000);
    return () => { if (pollRef.current) pollRef.current(); };
  }, [fetchConversations, checkWaStatus, checkMetaDiag]);

  useEffect(() => {
    if (selected) {
      const updated = conversations.find((c) => c.phone === selected.phone);
      // Só atualiza se mudou algo relevante para evitar re-renders desnecessários
      if (updated && (
        updated.unread_count !== selected.unread_count ||
        updated.last_message !== selected.last_message ||
        updated.contact_name !== selected.contact_name
      )) {
        setSelected(updated);
      }
    }
  }, [conversations]);

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

  const handleNewConversation = (phone: string, name?: string) => {
    const existing = conversations.find((c) => c.phone.replace(/\D/g, "") === phone.replace(/\D/g, ""));
    if (existing) {
      setSelected(existing);
    } else {
      const newConv: Conversation = {
        phone,
        contact_name: name || null,
        last_message: "",
        last_message_at: new Date().toISOString(),
        unread_count: 0,
      };
      setConversations((prev) => [newConv, ...prev]);
      setSelected(newConv);
    }
  };

  return (
    <>
    <div className="flex flex-col h-full overflow-hidden">
      {/* Banner de status WhatsApp */}
      <div className={`flex items-center justify-between gap-3 px-5 py-2 text-sm flex-shrink-0 border-b ${
        waStatus === "checking"
          ? "bg-gray-50 dark:bg-gray-800/60 border-gray-200 dark:border-gray-700"
          : waStatus === "connected"
          ? "bg-green-50 dark:bg-green-900/10 border-green-100 dark:border-green-900/30"
          : "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800"
      }`}>
        <div className="flex items-center gap-2">
          {waStatus === "checking" ? (
            <Loader2 size={13} className="animate-spin text-gray-400" />
          ) : waStatus === "connected" ? (
            <Wifi size={13} className="text-green-500" />
          ) : (
            <WifiOff size={13} className="text-amber-500" />
          )}
          <span className={`text-xs ${
            waStatus === "checking" ? "text-gray-400" :
            waStatus === "connected" ? "text-green-700 dark:text-green-400 font-medium" :
            "text-amber-700 dark:text-amber-400 font-medium"
          }`}>
            {waStatus === "checking" ? "Verificando conexão..." :
             waStatus === "connected" ? "WhatsApp conectado" :
             "WhatsApp desconectado"}
          </span>
        </div>
        <button
          onClick={() => setConnectOpen(true)}
          className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-md transition-colors flex-shrink-0 ${
            waStatus === "connected"
              ? "text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
              : "bg-amber-500 hover:bg-amber-600 text-white"
          }`}
        >
          <Wifi size={11} />
          {waStatus === "connected" ? "Gerenciar" : "Conectar"}
        </button>
      </div>

      {/* Banner de provisionamento Meta Cloud API — só aparece quando o número
          está conectado via Meta mas ainda em ON_PREMISE (aguardando App Review).
          Esconde quando cloud_api_ready=true pra não poluir UI. */}
      {metaDiag?.state === "provisioning" && (
        <div className="flex items-start gap-2.5 px-5 py-2.5 text-xs flex-shrink-0 border-b bg-amber-50 dark:bg-amber-900/15 border-amber-200 dark:border-amber-800/40">
          <AlertCircle size={14} className="flex-shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
          <span className="text-amber-800 dark:text-amber-200 leading-snug">
            <strong>Cloud API em provisionamento.</strong> {metaDiag.message}
          </span>
        </div>
      )}

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Lista de conversas */}
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
            onNewConversation={handleNewConversation}
          />
        </div>

        {/* Chat */}
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

        {/* Painel CRM */}
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

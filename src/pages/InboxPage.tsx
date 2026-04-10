import React, { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { MessageCircle, Phone, Send, Wifi, WifiOff } from "lucide-react";
import { authFetch } from "../utils/authFetch";

interface WaMessage {
  id: string;
  direction: "outbound" | "inbound";
  from_number: string;
  to_number: string;
  body: string;
  status: string;
  created_at: string;
  client_id?: number | null;
}

interface Conversation {
  phone: string;
  client_id: number | null;
  last_message: string;
  last_direction: "outbound" | "inbound";
  last_at: string;
  client_name?: string;
}

function formatPhone(phone: string) {
  const d = phone.replace(/\D/g, "");
  if (d.length === 13) return `+${d.slice(0, 2)} (${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}`;
  if (d.length === 12) return `+${d.slice(0, 2)} (${d.slice(2, 4)}) ${d.slice(4, 8)}-${d.slice(8)}`;
  return phone;
}

function formatTime(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

function formatDateSeparator(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return "Hoje";
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "Ontem";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
}

export default function InboxPage() {
  const [searchParams] = useSearchParams();
  const initialPhone = searchParams.get("phone") || "";

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedPhone, setSelectedPhone] = useState(initialPhone);
  const [messages, setMessages] = useState<WaMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingConvs, setLoadingConvs] = useState(true);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [waConnected, setWaConnected] = useState<boolean | null>(null);
  const [clientMap, setClientMap] = useState<Record<number, string>>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Check WhatsApp connection
  useEffect(() => {
    authFetch("/api/meta/whatsapp/status")
      .then((r) => r.json())
      .then((d) => setWaConnected(d.connected))
      .catch(() => setWaConnected(false));
  }, []);

  // Load conversations
  const loadConversations = () => {
    authFetch("/api/whatsapp/conversations")
      .then((r) => r.json())
      .then((data: Conversation[]) => {
        setConversations(data || []);
        // If initial phone from URL and not in list, add a placeholder
        if (initialPhone && !data.find((c) => c.phone === initialPhone)) {
          setConversations((prev) => [
            { phone: initialPhone, client_id: null, last_message: "", last_direction: "outbound", last_at: new Date().toISOString() },
            ...prev,
          ]);
        }
      })
      .catch(() => {})
      .finally(() => setLoadingConvs(false));
  };

  useEffect(() => {
    loadConversations();
  }, []);

  // Load messages for selected conversation
  const loadMessages = (phone: string) => {
    if (!phone) return;
    setLoadingMsgs(true);
    authFetch(`/api/whatsapp/messages/${encodeURIComponent(phone)}`)
      .then((r) => r.json())
      .then((data) => setMessages(data || []))
      .catch(() => {})
      .finally(() => setLoadingMsgs(false));
  };

  useEffect(() => {
    if (!selectedPhone) return;
    loadMessages(selectedPhone);

    // Poll every 8s for new messages
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => loadMessages(selectedPhone), 8000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [selectedPhone]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || !selectedPhone || sending) return;
    setSending(true);
    const body = input.trim();
    setInput("");

    const conv = conversations.find((c) => c.phone === selectedPhone);
    const clientId = conv?.client_id || null;

    try {
      const res = await authFetch("/api/whatsapp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: selectedPhone, body, client_id: clientId }),
      });
      const data = await res.json();
      if (data.success) {
        loadMessages(selectedPhone);
        loadConversations();
      } else {
        alert("Erro ao enviar: " + (data.error || "desconhecido"));
      }
    } catch {
      alert("Erro de conexão ao enviar mensagem.");
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Group messages by date
  const groupedMessages: { date: string; msgs: WaMessage[] }[] = [];
  for (const msg of messages) {
    const dateKey = new Date(msg.created_at).toDateString();
    const last = groupedMessages[groupedMessages.length - 1];
    if (last && last.date === dateKey) {
      last.msgs.push(msg);
    } else {
      groupedMessages.push({ date: dateKey, msgs: [msg] });
    }
  }

  const selectedConv = conversations.find((c) => c.phone === selectedPhone);

  return (
    <div className="flex h-full bg-gray-50 dark:bg-gray-900 overflow-hidden" style={{ height: "calc(100vh - 64px)" }}>
      {/* ===== LEFT: Conversation List ===== */}
      <div className="w-80 flex-shrink-0 border-r border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-gray-100 dark:border-gray-800">
          <div className="flex items-center gap-2">
            <MessageCircle size={20} className="text-green-500" />
            <h1 className="text-base font-semibold text-gray-900 dark:text-white">Inbox WhatsApp</h1>
            {waConnected === true && <Wifi size={14} className="text-green-500 ml-auto" />}
            {waConnected === false && <WifiOff size={14} className="text-red-400 ml-auto" />}
          </div>
        </div>

        {/* Conversation list */}
        <div className="flex-1 overflow-y-auto">
          {loadingConvs ? (
            <div className="flex justify-center items-center h-32">
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-green-500" />
            </div>
          ) : conversations.length === 0 ? (
            <div className="p-6 text-center text-gray-400 text-sm">
              <MessageCircle size={32} className="mx-auto mb-2 opacity-30" />
              Nenhuma conversa ainda.
              <br />
              Envie uma mensagem pelo kanban de Vendas.
            </div>
          ) : (
            conversations.map((conv) => (
              <button
                key={conv.phone}
                onClick={() => setSelectedPhone(conv.phone)}
                className={`w-full text-left px-4 py-3 border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors ${
                  selectedPhone === conv.phone ? "bg-green-50 dark:bg-green-900/20 border-l-2 border-l-green-500" : ""
                }`}
              >
                <div className="flex items-center gap-2">
                  <div className="w-9 h-9 rounded-full bg-green-100 dark:bg-green-900/40 flex items-center justify-center flex-shrink-0">
                    <Phone size={16} className="text-green-600 dark:text-green-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-center">
                      <span className="text-sm font-medium text-gray-900 dark:text-white truncate">
                        {conv.client_name || formatPhone(conv.phone)}
                      </span>
                      <span className="text-[10px] text-gray-400 flex-shrink-0 ml-1">
                        {formatTime(conv.last_at)}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">
                      {conv.last_direction === "outbound" ? "Você: " : ""}
                      {conv.last_message || "—"}
                    </p>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* ===== RIGHT: Chat View ===== */}
      <div className="flex-1 flex flex-col min-w-0">
        {!selectedPhone ? (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-400">
            <MessageCircle size={48} className="mb-3 opacity-20" />
            <p className="text-sm">Selecione uma conversa</p>
          </div>
        ) : (
          <>
            {/* Chat header */}
            <div className="px-5 py-3 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-green-100 dark:bg-green-900/40 flex items-center justify-center">
                <Phone size={16} className="text-green-600 dark:text-green-400" />
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-900 dark:text-white">
                  {selectedConv?.client_name || formatPhone(selectedPhone)}
                </p>
                <p className="text-xs text-gray-400">{formatPhone(selectedPhone)}</p>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4" style={{ background: "radial-gradient(ellipse at top, rgba(34,197,94,0.03) 0%, transparent 60%)" }}>
              {loadingMsgs ? (
                <div className="flex justify-center items-center h-32">
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-green-500" />
                </div>
              ) : groupedMessages.length === 0 ? (
                <div className="text-center text-gray-400 text-sm mt-12">
                  Nenhuma mensagem. Digite abaixo para iniciar a conversa.
                </div>
              ) : (
                groupedMessages.map((group) => (
                  <div key={group.date}>
                    {/* Date separator */}
                    <div className="flex items-center gap-3 my-3">
                      <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
                      <span className="text-[11px] text-gray-400 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded-full">
                        {formatDateSeparator(group.msgs[0].created_at)}
                      </span>
                      <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
                    </div>

                    {/* Messages */}
                    <div className="space-y-1.5">
                      {group.msgs.map((msg) => (
                        <div
                          key={msg.id}
                          className={`flex ${msg.direction === "outbound" ? "justify-end" : "justify-start"}`}
                        >
                          <div
                            className={`max-w-[70%] px-3 py-2 rounded-2xl text-sm leading-relaxed shadow-sm ${
                              msg.direction === "outbound"
                                ? "bg-[#D4A94A] text-white rounded-tr-sm"
                                : "bg-white dark:bg-gray-800 text-gray-900 dark:text-white border border-gray-100 dark:border-gray-700 rounded-tl-sm"
                            }`}
                          >
                            <p style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{msg.body}</p>
                            <p className={`text-[10px] mt-1 text-right ${msg.direction === "outbound" ? "text-white/70" : "text-gray-400"}`}>
                              {new Date(msg.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="p-3 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
              {waConnected === false && (
                <p className="text-xs text-red-400 mb-2 text-center">
                  WhatsApp Business não conectado. Vá em Configurações para conectar.
                </p>
              )}
              <div className="flex items-end gap-2">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Digite uma mensagem... (Enter para enviar)"
                  rows={1}
                  disabled={waConnected === false}
                  className="flex-1 resize-none rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-sm text-gray-900 dark:text-white placeholder-gray-400 px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-green-500/30 focus:border-green-500 disabled:opacity-50"
                  style={{ maxHeight: 120 }}
                />
                <button
                  onClick={handleSend}
                  disabled={!input.trim() || sending || waConnected === false}
                  className="p-2.5 rounded-xl bg-green-500 hover:bg-green-600 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors flex-shrink-0"
                >
                  {sending ? (
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                  ) : (
                    <Send size={16} />
                  )}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

import React, { useEffect, useRef, useState, useCallback } from "react";
import { Send, Loader2, Phone, MessageCircle } from "lucide-react";
import { authFetch } from "../../../utils/authFetch";

interface Message {
  message_id: string;
  body: string;
  from_me: boolean;
  timestamp: string;
  type?: string;
  status?: string;
}

interface Props {
  phone: string;
  contactName?: string | null;
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function formatDate(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diffDays === 0) return "Hoje";
  if (diffDays === 1) return "Ontem";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "long" });
}

function groupByDate(messages: Message[]) {
  const groups: { label: string; messages: Message[] }[] = [];
  let currentLabel = "";
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

export function ChatView({ phone, contactName }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const fetchMessages = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await authFetch(`/api/inbox/messages/${phone}?limit=80`);
      if (res.ok) {
        const data = await res.json();
        setMessages(Array.isArray(data) ? data : []);
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, [phone]);

  useEffect(() => {
    setMessages([]);
    fetchMessages();
    authFetch(`/api/inbox/mark-read/${phone}`, { method: "POST" }).catch(() => {});

    // Polling a cada 4s
    pollRef.current = setInterval(() => fetchMessages(true), 4000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [phone, fetchMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "42px";
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
  }, [text]);

  const handleSend = async () => {
    const msg = text.trim();
    if (!msg || sending) return;
    setSending(true);
    setText("");

    // Otimistic update
    const tmpId = `tmp-${Date.now()}`;
    const tmpMsg: Message = {
      message_id: tmpId,
      body: msg,
      from_me: true,
      timestamp: new Date().toISOString(),
      status: "sending",
    };
    setMessages((prev) => [...prev, tmpMsg]);

    try {
      await authFetch("/api/inbox/send", {
        method: "POST",
        body: JSON.stringify({ phone, text: msg }),
      });
      await fetchMessages(true);
    } catch {
      setMessages((prev) => prev.filter((m) => m.message_id !== tmpId));
      setText(msg);
    } finally {
      setSending(false);
    }
  };

  const groups = groupByDate(messages);

  return (
    <div className="flex flex-col h-full min-h-0 bg-gray-50 dark:bg-gray-900">
      {/* Header do chat */}
      <div className="flex items-center gap-3 px-5 py-3 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
        <div className="w-9 h-9 rounded-full bg-indigo-500 flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
          {(contactName || phone).slice(0, 2).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-gray-900 dark:text-white truncate">
            {contactName || phone}
          </p>
          {contactName && (
            <p className="text-xs text-gray-400">{phone}</p>
          )}
        </div>
        <a
          href={`https://wa.me/${phone}`}
          target="_blank"
          rel="noopener noreferrer"
          className="p-2 rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-indigo-600 transition-colors"
          title="Abrir no WhatsApp"
        >
          <Phone size={16} />
        </a>
      </div>

      {/* Mensagens */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-1">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 size={24} className="animate-spin text-indigo-500" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-gray-400">
            <MessageCircle size={32} strokeWidth={1.5} />
            <p className="text-sm">Nenhuma mensagem ainda</p>
          </div>
        ) : (
          groups.map((group) => (
            <div key={group.label}>
              {/* Separador de data */}
              <div className="flex items-center gap-3 my-4">
                <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
                <span className="text-xs text-gray-400 px-2 py-0.5 bg-gray-100 dark:bg-gray-700 rounded-full">
                  {group.label}
                </span>
                <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
              </div>

              {group.messages.map((msg) => (
                <div
                  key={msg.message_id}
                  className={`flex mb-1 ${msg.from_me ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[72%] px-3.5 py-2 rounded-2xl text-sm leading-relaxed shadow-sm ${
                      msg.from_me
                        ? "bg-indigo-600 text-white rounded-tr-sm"
                        : "bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 rounded-tl-sm border border-gray-100 dark:border-gray-700"
                    }`}
                  >
                    <p style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{msg.body}</p>
                    <p className={`text-[10px] mt-1 text-right ${msg.from_me ? "text-indigo-200" : "text-gray-400"}`}>
                      {formatTime(msg.timestamp)}
                      {msg.status === "sending" && " ·"}
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
      <div className="px-4 py-3 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 flex-shrink-0">
        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Digite uma mensagem..."
            rows={1}
            className="flex-1 resize-none bg-gray-100 dark:bg-gray-700 text-sm text-gray-800 dark:text-gray-200 rounded-xl px-4 py-2.5 outline-none placeholder-gray-400 overflow-hidden"
            style={{ minHeight: "42px", maxHeight: "128px" }}
          />
          <button
            onClick={handleSend}
            disabled={!text.trim() || sending}
            className="w-10 h-10 flex items-center justify-center rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white transition-colors flex-shrink-0"
          >
            {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
          </button>
        </div>
        <p className="text-[10px] text-gray-400 mt-1 ml-1">Enter para enviar · Shift+Enter para nova linha</p>
      </div>
    </div>
  );
}

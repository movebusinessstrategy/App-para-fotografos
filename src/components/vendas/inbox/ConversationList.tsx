import React, { useMemo, useState } from "react";
import { Search, MessageCircle } from "lucide-react";

export interface Conversation {
  phone: string;
  contact_name?: string | null;
  last_message?: string | null;
  last_message_at?: string | null;
  unread_count?: number;
}

interface Props {
  conversations: Conversation[];
  selectedPhone: string | null;
  loading: boolean;
  onSelect: (conv: Conversation) => void;
  className?: string;
}

function timeLabel(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffDays === 0) return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  if (diffDays === 1) return "Ontem";
  if (diffDays < 7) return d.toLocaleDateString("pt-BR", { weekday: "short" });
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

function initials(name?: string | null, phone?: string) {
  if (name) return name.trim().slice(0, 2).toUpperCase();
  return (phone || "??").slice(-2);
}

const COLORS = [
  "bg-indigo-500", "bg-violet-500", "bg-emerald-500",
  "bg-sky-500", "bg-rose-500", "bg-amber-500", "bg-teal-500",
];

function avatarColor(phone: string) {
  let hash = 0;
  for (let i = 0; i < phone.length; i++) hash = phone.charCodeAt(i) + ((hash << 5) - hash);
  return COLORS[Math.abs(hash) % COLORS.length];
}

export function ConversationList({ conversations, selectedPhone, loading, onSelect, className = "" }: Props) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    if (!q) return conversations;
    return conversations.filter(
      (c) =>
        c.phone.includes(q) ||
        (c.contact_name || "").toLowerCase().includes(q) ||
        (c.last_message || "").toLowerCase().includes(q)
    );
  }, [conversations, search]);

  return (
    <div className={`flex flex-col min-h-0 bg-white dark:bg-gray-800 ${className}`}>
      {/* Header busca */}
      <div className="px-4 pt-3 pb-3 border-b border-gray-100 dark:border-gray-700 flex-shrink-0">
        <h2 className="text-sm font-bold text-gray-900 dark:text-white mb-2">Conversas</h2>
        <div className="flex items-center gap-2 px-3 py-2 bg-gray-100 dark:bg-gray-700 rounded-xl">
          <Search size={14} className="text-gray-400 flex-shrink-0" />
          <input
            type="text"
            placeholder="Buscar conversa..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 bg-transparent text-sm text-gray-700 dark:text-gray-200 outline-none placeholder-gray-400"
          />
        </div>
      </div>

      {/* Lista com scroll */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {loading ? (
          <div className="flex flex-col gap-3 p-4">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="flex items-center gap-3 animate-pulse">
                <div className="w-10 h-10 rounded-full bg-gray-200 dark:bg-gray-700 flex-shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-3/4" />
                  <div className="h-2 bg-gray-100 dark:bg-gray-600 rounded w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-gray-400 px-6 text-center">
            <MessageCircle size={32} strokeWidth={1.5} />
            <p className="text-sm">
              {search ? "Nenhuma conversa encontrada" : "Nenhuma conversa ainda"}
            </p>
          </div>
        ) : (
          filtered.map((conv) => {
            const isSelected = conv.phone === selectedPhone;
            const name = conv.contact_name || conv.phone;
            return (
              <button
                key={conv.phone}
                onClick={() => onSelect(conv)}
                className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors border-b border-gray-50 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700/50 ${
                  isSelected ? "bg-indigo-50 dark:bg-indigo-900/20 border-l-2 border-l-indigo-500" : ""
                }`}
              >
                {/* Avatar */}
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 text-white text-sm font-bold ${avatarColor(conv.phone)}`}
                >
                  {initials(conv.contact_name, conv.phone)}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1">
                    <span className={`text-sm font-semibold truncate ${isSelected ? "text-indigo-700 dark:text-indigo-300" : "text-gray-900 dark:text-white"}`}>
                      {name}
                    </span>
                    <span className="text-[11px] text-gray-400 flex-shrink-0">
                      {timeLabel(conv.last_message_at)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-1 mt-0.5">
                    <span className="text-xs text-gray-500 dark:text-gray-400 truncate">
                      {conv.last_message || ""}
                    </span>
                    {(conv.unread_count ?? 0) > 0 && (
                      <span className="flex-shrink-0 min-w-[18px] h-[18px] px-1 rounded-full bg-indigo-600 text-white text-[10px] font-bold flex items-center justify-center">
                        {conv.unread_count}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

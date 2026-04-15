import React, { useMemo, useState, useEffect, useRef } from "react";
import { Search, MessageCircle, SquarePen, X, ArrowRight } from "lucide-react";
import { authFetch } from "../../../utils/authFetch";

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
  onNewConversation: (phone: string, name?: string) => void;
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
  "bg-gold-500", "bg-violet-500", "bg-emerald-500",
  "bg-sky-500", "bg-rose-500", "bg-amber-500", "bg-teal-500",
];

function avatarColor(phone: string) {
  let hash = 0;
  for (let i = 0; i < phone.length; i++) hash = phone.charCodeAt(i) + ((hash << 5) - hash);
  return COLORS[Math.abs(hash) % COLORS.length];
}

// Cache de fotos para não re-buscar a cada render
const photoCache = new Map<string, string | null>();

// Fila global para serializar buscas de foto (evita rate-limit do WhatsApp)
type PhotoTask = { phone: string; resolve: (url: string | null) => void };
const photoQueue: PhotoTask[] = [];
let photoQueueRunning = false;

async function runPhotoQueue() {
  if (photoQueueRunning) return;
  photoQueueRunning = true;
  while (photoQueue.length > 0) {
    const task = photoQueue.shift()!;
    try {
      const clean = task.phone.replace(/\D/g, "");
      const r = await authFetch(`/api/inbox/profile-picture/${clean}`);
      const d = r.ok ? await r.json() : null;
      const url = d?.url ?? null;
      photoCache.set(task.phone, url);
      task.resolve(url);
    } catch {
      photoCache.set(task.phone, null);
      task.resolve(null);
    }
    // Intervalo entre requisições para não sobrecarregar o WhatsApp
    if (photoQueue.length > 0) await new Promise(r => setTimeout(r, 400));
  }
  photoQueueRunning = false;
}

function fetchProfilePicture(phone: string): Promise<string | null> {
  if (photoCache.has(phone)) return Promise.resolve(photoCache.get(phone) ?? null);
  return new Promise((resolve) => {
    photoQueue.push({ phone, resolve });
    runPhotoQueue();
  });
}

function ConvAvatar({ phone, name }: { phone: string; name?: string | null }) {
  const [photo, setPhoto] = useState<string | null>(photoCache.get(phone) ?? null);

  useEffect(() => {
    if (photoCache.has(phone)) {
      setPhoto(photoCache.get(phone) ?? null);
      return;
    }
    fetchProfilePicture(phone).then(setPhoto);
  }, [phone]);

  if (photo) {
    return (
      <img
        src={photo}
        alt={name || phone}
        className="w-10 h-10 rounded-full object-cover flex-shrink-0"
        onError={() => setPhoto(null)}
      />
    );
  }
  return (
    <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 text-white text-sm font-bold ${avatarColor(phone)}`}>
      {initials(name, phone)}
    </div>
  );
}

// ─── Modal Nova Conversa ──────────────────────────────────────────────────────

function NewConversationForm({ onConfirm, onCancel }: { onConfirm: (phone: string, name: string) => void; onCancel: () => void }) {
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const clean = phone.replace(/\D/g, "");
  const valid = clean.length >= 10;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    onConfirm(clean, name.trim());
  };

  return (
    <div className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-4 py-3">
      <p className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Nova conversa</p>
      <form onSubmit={handleSubmit} className="flex flex-col gap-2">
        <input
          ref={inputRef}
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="Telefone com DDD (ex: 11999999999)"
          className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 outline-none focus:border-gold-400 focus:ring-1 focus:ring-gold-200 placeholder-gray-400"
        />
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nome (opcional)"
          className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 outline-none focus:border-gold-400 focus:ring-1 focus:ring-gold-200 placeholder-gray-400"
        />
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-xs font-semibold text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={!valid}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-gold-600 hover:bg-gold-700 disabled:opacity-40 text-white text-xs font-semibold transition-colors"
          >
            <ArrowRight size={13} /> Iniciar
          </button>
        </div>
      </form>
    </div>
  );
}

// ─── Lista ────────────────────────────────────────────────────────────────────

export function ConversationList({ conversations, selectedPhone, loading, onSelect, onNewConversation, className = "" }: Props) {
  const [search, setSearch] = useState("");
  const [showNewForm, setShowNewForm] = useState(false);

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

  const handleNewConv = (phone: string, name: string) => {
    setShowNewForm(false);
    onNewConversation(phone, name || undefined);
  };

  return (
    <div className={`flex flex-col min-h-0 bg-white dark:bg-gray-800 ${className}`}>
      {/* Header */}
      <div className="px-4 pt-3 pb-3 border-b border-gray-100 dark:border-gray-700 flex-shrink-0">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-bold text-gray-900 dark:text-white">Conversas</h2>
          <button
            onClick={() => setShowNewForm((v) => !v)}
            title="Nova conversa"
            className={`p-1.5 rounded-lg transition-colors ${
              showNewForm
                ? "bg-gold-100 dark:bg-gold-900/30 text-gold-600"
                : "text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gold-500"
            }`}
          >
            {showNewForm ? <X size={15} /> : <SquarePen size={15} />}
          </button>
        </div>
        <div className="flex items-center gap-2 px-3 py-2 bg-gray-100 dark:bg-gray-700 rounded-xl">
          <Search size={14} className="text-gray-400 flex-shrink-0" />
          <input
            type="text"
            placeholder="Buscar conversa..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 bg-transparent text-sm text-gray-700 dark:text-gray-200 outline-none placeholder-gray-400"
          />
          {search && (
            <button onClick={() => setSearch("")} className="text-gray-400 hover:text-gray-600">
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Formulário nova conversa */}
      {showNewForm && (
        <NewConversationForm
          onConfirm={handleNewConv}
          onCancel={() => setShowNewForm(false)}
        />
      )}

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
          <div className="flex flex-col items-center justify-center h-full gap-3 text-gray-400 px-6 text-center py-12">
            <MessageCircle size={32} strokeWidth={1.5} />
            <p className="text-sm">
              {search ? "Nenhuma conversa encontrada" : "Nenhuma conversa ainda"}
            </p>
            {!search && (
              <button
                onClick={() => setShowNewForm(true)}
                className="flex items-center gap-1.5 text-xs text-gold-500 hover:text-gold-600 font-semibold"
              >
                <SquarePen size={13} /> Iniciar nova conversa
              </button>
            )}
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
                  isSelected ? "bg-gold-50 dark:bg-gold-900/20 border-l-2 border-l-gold-500" : ""
                }`}
              >
                <ConvAvatar phone={conv.phone} name={conv.contact_name} />

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1">
                    <span className={`text-sm font-semibold truncate ${isSelected ? "text-gold-700 dark:text-gold-300" : "text-gray-900 dark:text-white"}`}>
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
                      <span className="flex-shrink-0 min-w-[18px] h-[18px] px-1 rounded-full bg-gold-600 text-white text-[10px] font-bold flex items-center justify-center">
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

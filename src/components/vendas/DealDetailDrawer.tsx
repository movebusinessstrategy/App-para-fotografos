// src/components/vendas/DealDetailDrawer.tsx
import React, { useState, useEffect, useRef } from "react";
import { format } from "date-fns";
import {
  X, Trash2, CheckCircle, XCircle, User, Phone, Mail, Instagram,
  Edit3, Link2, Trophy, Pencil, Search, Check
} from "lucide-react";
import { ConfirmModal } from "../ui/ConfirmModal";
import { Deal, Client, PipelineStage, DealActivity, StageHistoryEntry } from "../../types";
import { authFetch } from "../../utils/authFetch";
import { DealConversionModal } from "../pipeline/DealConversionModal";

// ─── Tier badge ───────────────────────────────────────────────────────────────
const TIER_CONFIG: Record<string, { label: string; cls: string }> = {
  Gold:    { label: "Gold",    cls: "bg-yellow-100 dark:bg-yellow-500/20 text-yellow-700 dark:text-yellow-300 border border-yellow-300 dark:border-yellow-500/40" },
  Silver:  { label: "Silver",  cls: "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600" },
  Bronze:  { label: "Bronze",  cls: "bg-orange-100 dark:bg-orange-500/20 text-orange-700 dark:text-orange-300 border border-orange-300 dark:border-orange-500/40" },
};

function TierBadge({ tier }: { tier?: string | null }) {
  if (!tier) return null;
  const cfg = TIER_CONFIG[tier];
  if (!cfg) return null;
  return (
    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
}

// ─── Client search dropdown ───────────────────────────────────────────────────
interface ClientSearchProps {
  clients: Client[];
  selectedId: number | null;
  onChange: (id: number | null) => void;
}

function ClientSearch({ clients, selectedId, onChange }: ClientSearchProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const selected = clients.find(c => c.id === selectedId);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const filtered = clients.filter(c =>
    c.name.toLowerCase().includes(query.toLowerCase()) ||
    (c.phone || "").includes(query)
  ).slice(0, 20);

  const handleSelect = (id: number | null) => {
    onChange(id);
    setOpen(false);
    setQuery("");
  };

  return (
    <div ref={ref} className="relative">
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-2 border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 rounded-lg px-3 py-2 text-sm text-left hover:border-gray-300 dark:hover:border-gray-600 transition-colors"
      >
        <Search size={13} className="text-gray-400 flex-shrink-0" />
        <span className={`flex-1 truncate ${selected ? "text-gray-900 dark:text-white" : "text-gray-400 dark:text-gray-500"}`}>
          {selected ? selected.name : "Buscar cliente..."}
        </span>
        {selected && <TierBadge tier={selected.tier || selected.status} />}
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl dark:shadow-black/40 overflow-hidden">
          {/* Search input */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-100 dark:border-gray-700">
            <Search size={13} className="text-gray-400 flex-shrink-0" />
            <input
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Nome ou telefone..."
              className="flex-1 text-sm bg-transparent text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 outline-none"
            />
          </div>

          {/* Options */}
          <div className="max-h-52 overflow-y-auto">
            <button
              type="button"
              onClick={() => handleSelect(null)}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 text-left"
            >
              <XCircle size={13} className="text-gray-400" />
              Nenhum (usar dados do lead)
            </button>
            {filtered.length === 0 && (
              <p className="text-center text-xs text-gray-400 py-4">Nenhum cliente encontrado</p>
            )}
            {filtered.map(c => {
              const tier = c.tier || c.status;
              const isSelected = c.id === selectedId;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => handleSelect(c.id)}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors ${
                    isSelected ? "bg-indigo-50 dark:bg-indigo-500/10" : ""
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-900 dark:text-white truncate">{c.name}</span>
                      <TierBadge tier={tier} />
                    </div>
                    {c.phone && (
                      <span className="text-xs text-gray-400">{c.phone}</span>
                    )}
                  </div>
                  {isSelected && <Check size={13} className="text-indigo-500 flex-shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
interface DealDetailDrawerProps {
  deal: Deal | null;
  client?: Client;
  clients: Client[];
  stages: PipelineStage[];
  onClose: () => void;
  onUpdate: (options?: { silent?: boolean }) => void | Promise<void>;
}

const PRIORITY_OPTIONS = [
  { value: "low",    label: "Baixa"  },
  { value: "medium", label: "Média"  },
  { value: "high",   label: "Alta"   },
];
const PRIORITY_LABELS: Record<string, string> = { low: "Baixa", medium: "Média", high: "Alta" };

export function DealDetailDrawer({
  deal, client, clients = [], stages, onClose, onUpdate,
}: DealDetailDrawerProps) {
  const [activities, setActivities] = useState<DealActivity[]>([]);
  const [loadingActivities, setLoadingActivities] = useState(false);
  const [newActivity, setNewActivity] = useState({ type: "note", description: "" });
  const [followUp, setFollowUp] = useState("");
  const [notes, setNotes] = useState("");
  const [history, setHistory] = useState<StageHistoryEntry[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState(false);

  const [showConversionModal, setShowConversionModal] = useState(false);
  const [isEditingContact, setIsEditingContact] = useState(false);
  const [contactData, setContactData] = useState({
    contact_name: "", contact_phone: "", contact_email: "", contact_instagram: "",
  });

  const [selectedClientId, setSelectedClientId] = useState<number | null>(null);

  // ── Inline editing states ──────────────────────────────────────────────────
  const [editingValue, setEditingValue] = useState(false);
  const [dealValueStr, setDealValueStr] = useState("");   // string para permitir apagar

  const [editingDate, setEditingDate] = useState(false);
  const [dealDate, setDealDate] = useState("");

  const [editingPriority, setEditingPriority] = useState(false);
  const [dealPriority, setDealPriority] = useState("medium");
  // ──────────────────────────────────────────────────────────────────────────

  const [confirmModal, setConfirmModal] = useState<{
    open: boolean; onConfirm: () => void; title: string; message: string; variant?: "danger" | "warning";
  }>({ open: false, onConfirm: () => {}, title: "", message: "" });

  useEffect(() => {
    if (deal) {
      setFollowUp(deal.next_follow_up || "");
      setNotes(deal.notes || "");
      setHistory([]);
      setHistoryError(false);
      setContactData({
        contact_name: deal.contact_name || "",
        contact_phone: deal.contact_phone || "",
        contact_email: deal.contact_email || "",
        contact_instagram: deal.contact_instagram || "",
      });
      setSelectedClientId(deal.client_id || null);
      setDealValueStr(deal.value ? String(deal.value) : "");
      setDealDate(deal.expected_close_date || "");
      setDealPriority(deal.priority || "medium");
      setIsEditingContact(false);
      setEditingValue(false);
      setEditingDate(false);
      setEditingPriority(false);
      loadActivities();
      loadHistory();
    }
  }, [deal]);

  const loadActivities = async () => {
    if (!deal) return;
    setLoadingActivities(true);
    try {
      const res = await authFetch(`/api/deals/${deal.id}/activities`);
      setActivities(await res.json());
    } catch (e) { console.error(e); }
    finally { setLoadingActivities(false); }
  };

  const addActivity = async () => {
    if (!deal || !newActivity.description.trim()) return;
    await authFetch(`/api/deals/${deal.id}/activities`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newActivity),
    });
    setNewActivity({ type: "note", description: "" });
    loadActivities();
    onUpdate();
  };

  const loadHistory = async () => {
    if (!deal) return;
    setLoadingHistory(true);
    try {
      const res = await authFetch(`/api/deals/${deal.id}/history`);
      const data = await res.json();
      setHistory(Array.isArray(data) ? data : []);
      setHistoryError(false);
    } catch (e) { console.error(e); setHistory([]); setHistoryError(true); }
    finally { setLoadingHistory(false); }
  };

  const updateDeal = async (data: Partial<Deal>) => {
    if (!deal) return;
    await authFetch(`/api/deals/${deal.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    onUpdate();
  };

  const deleteDeal = () => {
    if (!deal) return;
    setConfirmModal({
      open: true, title: "Excluir negócio", message: "Tem certeza que deseja excluir este negócio?",
      variant: "danger",
      onConfirm: async () => {
        await authFetch(`/api/deals/${deal.id}`, { method: "DELETE" });
        onClose(); onUpdate();
      },
    });
  };

  const markAsWon = () => setShowConversionModal(true);

  const markAsLost = async () => {
    const lostStage = stages.find(s => s.is_final && !s.is_won);
    if (lostStage) { await updateDeal({ stage: lostStage.id }); onClose(); }
  };

  const saveContactData = async () => { await updateDeal(contactData); setIsEditingContact(false); };

  const linkClient = async (clientId: number | null) => {
    setSelectedClientId(clientId);
    await updateDeal({ client_id: clientId });
  };

  const saveValue = async () => {
    const num = parseFloat(dealValueStr) || 0;
    setDealValueStr(num === 0 ? "" : String(num));
    await updateDeal({ value: num });
    setEditingValue(false);
  };

  const saveDate = async () => {
    await updateDeal({ expected_close_date: dealDate || null });
    setEditingDate(false);
  };

  const savePriority = async (val: string) => {
    setDealPriority(val);
    await updateDeal({ priority: val as any });
    setEditingPriority(false);
  };

  if (!deal) return null;

  const currentStage = stages.find(s => s.id === deal.stage);
  const isWon  = currentStage?.is_final && currentStage?.is_won;
  const isLost = currentStage?.is_final && !currentStage?.is_won;
  const isFinal = currentStage?.is_final;
  const safeHistory = Array.isArray(history) ? history : [];

  const linkedClient = selectedClientId
    ? clients.find(c => c.id === selectedClientId) || client
    : client;

  const formatDuration = (start: string, end?: string | null) => {
    const diffMs = Math.max(0, (end ? new Date(end) : new Date()).getTime() - new Date(start).getTime());
    const minutes = Math.floor(diffMs / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    if (days > 0) return `${days} dia${days > 1 ? "s" : ""}`;
    if (hours > 0) return `${hours} h`;
    return `${Math.max(1, minutes)} min`;
  };

  const timeSince = (start: string) => formatDuration(start, undefined);

  const inputClasses = "w-full border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 outline-none focus:border-gray-400 dark:focus:border-gray-600";

  return (
    <>
      <div className="fixed inset-0 z-50 flex justify-end">
        <div className="absolute inset-0 bg-black/30 dark:bg-black/60" onClick={onClose} />
        <div className="relative w-full max-w-lg bg-white dark:bg-gray-900 h-full shadow-xl dark:shadow-2xl dark:shadow-black/40 overflow-y-auto">

          {/* Header */}
          <div className={`sticky top-0 border-b border-gray-200 dark:border-gray-800 p-4 z-10 ${
            isWon ? "bg-emerald-50 dark:bg-emerald-950/30" :
            isLost ? "bg-red-50 dark:bg-red-950/30" :
            "bg-white dark:bg-gray-900"
          }`}>
            <div className="flex items-start justify-between">
              <div className="flex-1 min-w-0">
                {isFinal && (
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold rounded-full mb-2 ${
                    isWon
                      ? "bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300"
                      : "bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-300"
                  }`}>
                    {isWon ? <><Trophy size={12} /> Convertido</> : <><XCircle size={12} /> Perdido</>}
                  </span>
                )}
                <h2 className="text-lg font-bold text-gray-900 dark:text-white truncate">{deal.title}</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">Etapa: {currentStage?.name || deal.stage}</p>
              </div>
              <button onClick={onClose} className="p-1 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 rounded transition-colors">
                <X size={20} />
              </button>
            </div>
          </div>

          <div className="p-4 space-y-6">

            {/* ── Info principal: Valor / Previsão / Prioridade ── */}
            <div className="grid grid-cols-3 gap-3">

              {/* Valor */}
              <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-3">
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide">Valor</label>
                  {!editingValue && (
                    <button onClick={() => setEditingValue(true)} className="p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
                      <Pencil size={11} />
                    </button>
                  )}
                </div>
                {editingValue ? (
                  <div className="space-y-1.5">
                    <input
                      type="number"
                      value={dealValueStr}
                      onChange={e => setDealValueStr(e.target.value)}
                      placeholder="0"
                      autoFocus
                      className="w-full border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 rounded px-2 py-1 text-sm text-gray-900 dark:text-white outline-none focus:border-indigo-400 dark:focus:border-indigo-500"
                      onKeyDown={e => { if (e.key === "Enter") saveValue(); if (e.key === "Escape") setEditingValue(false); }}
                    />
                    <div className="flex gap-1">
                      <button onClick={saveValue} className="flex-1 py-1 bg-indigo-600 hover:bg-indigo-700 text-white text-xs rounded font-medium">✓</button>
                      <button onClick={() => setEditingValue(false)} className="flex-1 py-1 border border-gray-200 dark:border-gray-700 text-gray-500 text-xs rounded">✕</button>
                    </div>
                  </div>
                ) : (
                  <p className="text-base font-bold text-gray-900 dark:text-white">
                    R$ {(deal.value || 0).toLocaleString("pt-BR")}
                  </p>
                )}
              </div>

              {/* Previsão */}
              <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-3">
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide">Previsão</label>
                  {!editingDate && (
                    <button onClick={() => setEditingDate(true)} className="p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
                      <Pencil size={11} />
                    </button>
                  )}
                </div>
                {editingDate ? (
                  <div className="space-y-1.5">
                    <input
                      type="date"
                      value={dealDate}
                      onChange={e => setDealDate(e.target.value)}
                      autoFocus
                      className="w-full border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 rounded px-2 py-1 text-xs text-gray-900 dark:text-white outline-none [color-scheme:light] dark:[color-scheme:dark]"
                      onKeyDown={e => { if (e.key === "Escape") setEditingDate(false); }}
                    />
                    <div className="flex gap-1">
                      <button onClick={saveDate} className="flex-1 py-1 bg-indigo-600 hover:bg-indigo-700 text-white text-xs rounded font-medium">✓</button>
                      <button onClick={() => setEditingDate(false)} className="flex-1 py-1 border border-gray-200 dark:border-gray-700 text-gray-500 text-xs rounded">✕</button>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">
                    {deal.expected_close_date
                      ? format(new Date(deal.expected_close_date + "T12:00:00"), "dd/MM/yyyy")
                      : <span className="text-gray-400 font-normal">—</span>}
                  </p>
                )}
              </div>

              {/* Prioridade */}
              <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-3">
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide">Prioridade</label>
                  {!editingPriority && (
                    <button onClick={() => setEditingPriority(true)} className="p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
                      <Pencil size={11} />
                    </button>
                  )}
                </div>
                {editingPriority ? (
                  <div className="space-y-1">
                    {PRIORITY_OPTIONS.map(opt => (
                      <button
                        key={opt.value}
                        onClick={() => savePriority(opt.value)}
                        className={`w-full text-left px-2 py-1 rounded text-xs font-medium transition-colors ${
                          dealPriority === opt.value
                            ? "bg-indigo-600 text-white"
                            : "hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300"
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                    <button onClick={() => setEditingPriority(false)} className="w-full py-1 border border-gray-200 dark:border-gray-700 text-gray-500 text-xs rounded mt-0.5">Cancelar</button>
                  </div>
                ) : (
                  <p className="text-sm font-semibold text-gray-900 dark:text-white capitalize">
                    {PRIORITY_LABELS[deal.priority] || deal.priority || "Média"}
                  </p>
                )}
              </div>
            </div>

            {/* ── Cliente / Contato ── */}
            <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase flex items-center gap-1">
                  <User size={12} /> Cliente / Contato
                </label>
                {!linkedClient && (
                  <button
                    onClick={() => setIsEditingContact(!isEditingContact)}
                    className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
                  >
                    <Edit3 size={12} />
                    {isEditingContact ? "Cancelar" : "Editar"}
                  </button>
                )}
              </div>

              {/* Busca de cliente com lupa */}
              <div>
                <label className="text-[11px] text-gray-400 dark:text-gray-500 uppercase mb-1.5 flex items-center gap-1">
                  <Link2 size={10} /> Vincular a cliente existente
                </label>
                <ClientSearch
                  clients={clients}
                  selectedId={selectedClientId}
                  onChange={linkClient}
                />
              </div>

              {/* Info do cliente vinculado */}
              {linkedClient ? (
                <div className="bg-white dark:bg-gray-800 rounded-lg p-3 border border-gray-100 dark:border-gray-700">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-gray-900 dark:text-white">{linkedClient.name}</p>
                    <TierBadge tier={linkedClient.tier || linkedClient.status} />
                  </div>
                  <div className="mt-2 space-y-1 text-sm text-gray-500 dark:text-gray-400">
                    {linkedClient.phone && <p className="flex items-center gap-2"><Phone size={12} /> {linkedClient.phone}</p>}
                    {linkedClient.email && <p className="flex items-center gap-2"><Mail size={12} /> {linkedClient.email}</p>}
                    {linkedClient.instagram && <p className="flex items-center gap-2"><Instagram size={12} /> {linkedClient.instagram}</p>}
                  </div>
                </div>
              ) : (
                <>
                  {isEditingContact ? (
                    <div className="space-y-2">
                      <input value={contactData.contact_name} onChange={e => setContactData(p => ({ ...p, contact_name: e.target.value }))} placeholder="Nome do contato" className={inputClasses} />
                      <input value={contactData.contact_phone} onChange={e => setContactData(p => ({ ...p, contact_phone: e.target.value }))} placeholder="Telefone" className={inputClasses} />
                      <input value={contactData.contact_email} onChange={e => setContactData(p => ({ ...p, contact_email: e.target.value }))} placeholder="Email" className={inputClasses} />
                      <input value={contactData.contact_instagram} onChange={e => setContactData(p => ({ ...p, contact_instagram: e.target.value }))} placeholder="@instagram" className={inputClasses} />
                      <button onClick={saveContactData} className="w-full py-2 bg-gray-900 dark:bg-white text-white dark:text-gray-900 text-sm rounded-lg hover:bg-gray-800 dark:hover:bg-gray-100 transition-colors">
                        Salvar Contato
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-1 text-sm">
                      <p className="font-medium text-gray-900 dark:text-white">
                        {deal.contact_name || deal.client_name || "Não informado"}
                      </p>
                      {deal.contact_phone && <p className="text-gray-500 dark:text-gray-400 flex items-center gap-2"><Phone size={12} /> {deal.contact_phone}</p>}
                      {deal.contact_email && <p className="text-gray-500 dark:text-gray-400 flex items-center gap-2"><Mail size={12} /> {deal.contact_email}</p>}
                      {deal.contact_instagram && <p className="text-gray-500 dark:text-gray-400 flex items-center gap-2"><Instagram size={12} /> {deal.contact_instagram}</p>}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Histórico do Lead */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Histórico do Lead</label>
                {loadingHistory && <span className="text-[11px] text-gray-400 dark:text-gray-500">Carregando...</span>}
              </div>
              <div className="space-y-4">
                {historyError && !loadingHistory && <p className="text-xs text-red-500 dark:text-red-400">Histórico não disponível</p>}
                {!historyError && !loadingHistory && safeHistory.length === 0 && <p className="text-xs text-gray-400 dark:text-gray-500">Sem histórico registrado</p>}
                {safeHistory.map((entry, idx) => {
                  const isCurrent = !entry.left_at;
                  const isLast = idx === safeHistory.length - 1;
                  return (
                    <div key={`${entry.stage_id}-${entry.entered_at}-${idx}`} className="flex gap-3">
                      <div className="flex flex-col items-center">
                        <span className={`w-3 h-3 rounded-full ${isCurrent ? "bg-emerald-500" : "bg-gray-300 dark:bg-gray-600"}`} />
                        {!isLast && <span className="flex-1 w-px bg-gray-200 dark:bg-gray-700 mt-1 mb-1" />}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-gray-900 dark:text-white">{entry.stage_name || entry.stage_id}</span>
                          {isCurrent && <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400">Atual</span>}
                        </div>
                        <p className={`text-xs ${isCurrent ? "text-emerald-700 dark:text-emerald-400" : "text-gray-500 dark:text-gray-400"}`}>
                          {isCurrent ? `há ${timeSince(entry.entered_at)}` : formatDuration(entry.entered_at, entry.left_at)}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Follow-up */}
            <div>
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase block mb-1">Próximo Follow-up</label>
              <div className="flex gap-2">
                <input
                  type="date"
                  value={followUp}
                  onChange={e => setFollowUp(e.target.value)}
                  className="flex-1 border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white outline-none focus:border-gray-400 dark:focus:border-gray-600 [color-scheme:light] dark:[color-scheme:dark]"
                />
                <button
                  onClick={() => updateDeal({ next_follow_up: followUp })}
                  className="px-3 py-2 bg-gray-900 dark:bg-white text-white dark:text-gray-900 text-sm rounded-lg hover:bg-gray-800 dark:hover:bg-gray-100 transition-colors"
                >
                  Salvar
                </button>
              </div>
            </div>

            {/* Atividades */}
            <div>
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase block mb-2">Atividades</label>
              <div className="space-y-2 max-h-48 overflow-y-auto mb-3">
                {loadingActivities ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400">Carregando...</p>
                ) : activities.length === 0 ? (
                  <p className="text-sm text-gray-400 dark:text-gray-500">Nenhuma atividade registrada</p>
                ) : (
                  activities.map(act => (
                    <div key={act.id} className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
                      <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 mb-1">
                        <span className="font-medium uppercase">{act.type}</span>
                        <span>•</span>
                        <span>{format(new Date(act.created_at), "dd/MM/yyyy HH:mm")}</span>
                      </div>
                      <p className="text-sm text-gray-700 dark:text-gray-300">{act.description}</p>
                    </div>
                  ))
                )}
              </div>
              <div className="flex gap-2">
                <select
                  value={newActivity.type}
                  onChange={e => setNewActivity({ ...newActivity, type: e.target.value })}
                  className="border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 rounded-lg px-2 py-2 text-sm text-gray-900 dark:text-white outline-none"
                >
                  <option value="note">Nota</option>
                  <option value="call">Ligação</option>
                  <option value="email">Email</option>
                  <option value="meeting">Reunião</option>
                </select>
                <input
                  value={newActivity.description}
                  onChange={e => setNewActivity({ ...newActivity, description: e.target.value })}
                  placeholder="Descrição da atividade..."
                  className="flex-1 border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 outline-none focus:border-gray-400 dark:focus:border-gray-600"
                  onKeyDown={e => e.key === "Enter" && addActivity()}
                />
                <button onClick={addActivity} className="px-3 py-2 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 text-sm rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 border border-transparent dark:border-gray-700 transition-colors">+</button>
              </div>
            </div>

            {/* Notas */}
            <div>
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase block mb-1">Notas</label>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                onBlur={() => updateDeal({ notes })}
                rows={3}
                className="w-full border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 outline-none focus:border-gray-400 dark:focus:border-gray-600 resize-none"
                placeholder="Anotações sobre o negócio..."
              />
            </div>

            {/* Ações */}
            <div className="border-t border-gray-200 dark:border-gray-800 pt-4 space-y-2">
              {!isFinal ? (
                <div className="flex gap-2">
                  <button
                    onClick={markAsWon}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-emerald-600 dark:bg-emerald-500 text-white rounded-lg hover:bg-emerald-700 dark:hover:bg-emerald-600 text-sm font-medium transition-colors"
                  >
                    <Trophy size={16} /> Converter em Venda
                  </button>
                  <button
                    onClick={markAsLost}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30 text-sm font-medium transition-colors border border-red-200 dark:border-red-800"
                  >
                    <XCircle size={16} /> Perdido
                  </button>
                </div>
              ) : (
                <div className={`p-3 rounded-lg text-center ${
                  isWon ? "bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300"
                        : "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300"
                }`}>
                  <p className="font-medium">
                    {isWon ? "🎉 Negócio convertido!" : "❌ Negócio perdido"}
                  </p>
                  {isWon && linkedClient && (
                    <p className="text-sm mt-1 opacity-80">Vinculado ao cliente: {linkedClient.name}</p>
                  )}
                </div>
              )}
              <button
                onClick={deleteDeal}
                className="w-full flex items-center justify-center gap-2 py-2 text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg text-sm transition-colors"
              >
                <Trash2 size={16} /> Excluir Negócio
              </button>
            </div>
          </div>
        </div>
      </div>

      {showConversionModal && (
        <DealConversionModal
          deal={deal}
          clients={clients}
          onClose={() => setShowConversionModal(false)}
          onConverted={() => { setShowConversionModal(false); onUpdate(); onClose(); }}
        />
      )}

      <ConfirmModal
        open={confirmModal.open}
        title={confirmModal.title}
        message={confirmModal.message}
        confirmText="Confirmar"
        variant={confirmModal.variant || "danger"}
        onConfirm={() => { confirmModal.onConfirm(); setConfirmModal(p => ({ ...p, open: false })); }}
        onCancel={() => setConfirmModal(p => ({ ...p, open: false }))}
      />
    </>
  );
}

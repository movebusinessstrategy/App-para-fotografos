// src/components/vendas/DealDetailDrawer.tsx
import React, { useState, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { format } from "date-fns";
import {
  X, Trash2, CheckCircle, XCircle, User, Phone, Mail, Instagram,
  Edit3, Link2, MessageCircle, Trophy, Pencil, Search, Check, Package, Layers, Briefcase, ChevronDown, Plus, Tag, Sparkles
} from "lucide-react";
import { ConfirmModal } from "../ui/ConfirmModal";
import { Deal, Client, PipelineStage, DealActivity, StageHistoryEntry, Produto, Servico, Combo, DealItem, PipelineLabel, SaleCampaign } from "../../types";
import { authFetch } from "../../utils/authFetch";
import { useApi } from "../../utils/useApi";
import { parseDate } from "../../utils/date";
import { celebrateSale } from "../../utils/saleCelebration";
import { DealConversionModal } from "../pipeline/DealConversionModal";
import { LostDealModal } from "../pipeline/LostDealModal";
import { useSellers } from "../../hooks/useSellers";
import { SellerPicker } from "./SellerPicker";
import { useAuth } from "../../contexts/AuthContext";

// Wrapper seguro: retorna o texto formatado, ou null se a data não for parseável.
function safeFormat(value: string | null | undefined, pattern: string): string | null {
  if (!value || !String(value).trim()) return null;
  const d = parseDate(value);
  if (!d || isNaN(d.getTime())) {
    const fallback = new Date(value);
    if (isNaN(fallback.getTime())) return null;
    return format(fallback, pattern);
  }
  return format(d, pattern);
}

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
      // Ignora cliques na scrollbar (target = HTML/BODY) — só rola, não fecha
      const target = e.target as Node;
      if (target === document.documentElement || target === document.body) return;
      if (ref.current && !ref.current.contains(target)) setOpen(false);
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
                    isSelected ? "bg-gold-50 dark:bg-gold-500/10" : ""
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
                  {isSelected && <Check size={13} className="text-gold-500 flex-shrink-0" />}
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

const LABEL_COLORS = [
  "#EF4444", // red
  "#F97316", // orange
  "#EAB308", // yellow
  "#22C55E", // green
  "#14B8A6", // teal
  "#3B82F6", // blue
  "#6366F1", // indigo
  "#A855F7", // purple
  "#EC4899", // pink
  "#6B7280", // gray
  "#0F172A", // slate dark
  "#7C3AED", // violet
];

export function DealDetailDrawer({
  deal, client, clients = [], stages, onClose, onUpdate,
}: DealDetailDrawerProps) {
  const { canAccess } = useAuth();
  const canSeeFinance = canAccess('finance'); // funcionário sem permissão não vê/edita valores
  const [activities, setActivities] = useState<DealActivity[]>([]);
  const [loadingActivities, setLoadingActivities] = useState(false);
  const [newActivity, setNewActivity] = useState({ type: "note", description: "" });
  const [followUp, setFollowUp] = useState("");
  const [notes, setNotes] = useState("");
  const [history, setHistory] = useState<StageHistoryEntry[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState(false);

  const [showConversionModal, setShowConversionModal] = useState(false);
  const [showLostModal, setShowLostModal] = useState(false);
  const [isEditingContact, setIsEditingContact] = useState(false);
  const [, setSearchParams] = useSearchParams();
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

  // Labels
  const [availableLabels, setAvailableLabels] = useState<PipelineLabel[]>([]);
  const [dealLabels, setDealLabels] = useState<string[]>([]);
  const [showLabelPicker, setShowLabelPicker] = useState(false);
  const [showHeaderLabelDropdown, setShowHeaderLabelDropdown] = useState(false);
  const [newLabelName, setNewLabelName] = useState("");
  const [newLabelColor, setNewLabelColor] = useState("#6B7280");
  const [creatingLabel, setCreatingLabel] = useState(false);
  const labelPickerRef = useRef<HTMLDivElement>(null);
  const headerLabelRef = useRef<HTMLDivElement>(null);

  // Venda Especial / Campanha
  const [campaigns, setCampaigns] = useState<SaleCampaign[]>([]);
  const [dealCampaignId, setDealCampaignId] = useState<string | null>(null);
  const [showCampaignPicker, setShowCampaignPicker] = useState(false);
  const campaignPickerRef = useRef<HTMLDivElement>(null);

  // WhatsApp profile photo
  const [contactPhotoUrl, setContactPhotoUrl] = useState<string | null>(null);
  // Inline title editing
  const [editingTitle, setEditingTitle] = useState(false);
  const [editingTitleVal, setEditingTitleVal] = useState("");

  // ── Catálogo vinculado (múltiplos itens) ──────────────────────────────────
  const [catalogType, setCatalogType] = useState<'combo' | 'produto' | 'servico'>('combo');
  const [catalogSearch, setCatalogSearch] = useState('');
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [catalogSaving, setCatalogSaving] = useState(false);
  // Catálogos via SWR - cache compartilhado com JobDetailDrawer e NewDealModal
  const { data: catalogProdutosData } = useApi<Produto[]>("/api/produtos");
  const { data: catalogServicosData } = useApi<Servico[]>("/api/servicos");
  const { data: catalogCombosData } = useApi<Combo[]>("/api/combos");
  const catalogProdutos = catalogProdutosData || [];
  const catalogServicos = catalogServicosData || [];
  const catalogCombos = catalogCombosData || [];
  // Lista local de itens (reflete deal.items, atualizada otimisticamente)
  const [localItems, setLocalItems] = useState<DealItem[]>([]);
  const [showAddItem, setShowAddItem] = useState(false);
  const catalogRef = useRef<HTMLDivElement>(null);

  // Inicializa/sincroniza itens do deal
  useEffect(() => {
    setLocalItems(deal?.items || []);
    setShowAddItem(false);
  }, [deal?.id, deal?.items]);

  useEffect(() => {
    authFetch('/api/pipeline/labels').then(r => r.json()).then(d => setAvailableLabels(Array.isArray(d) ? d : [])).catch(() => {});
    authFetch('/api/sale-campaigns').then(r => r.ok ? r.json() : []).then(d => setCampaigns(Array.isArray(d) ? d : [])).catch(() => {});
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      // Ignora cliques na scrollbar — scroll dentro da sanfona não deve fechar
      const target = e.target as Node;
      if (target === document.documentElement || target === document.body) return;
      if (catalogRef.current && !catalogRef.current.contains(target)) {
        setCatalogOpen(false);
        setCatalogSearch('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Fetch WhatsApp profile picture when phone changes
  useEffect(() => {
    if (!deal) { setContactPhotoUrl(null); return; }
    const linkedC = selectedClientId ? clients.find(c => c.id === selectedClientId) : null;
    const phone = linkedC?.phone || deal.contact_phone;
    if (!phone) { setContactPhotoUrl(null); return; }
    const cleanPhone = phone.replace(/\D/g, '');
    setContactPhotoUrl(null);
    authFetch(`/api/inbox/profile-picture/${cleanPhone}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.url) setContactPhotoUrl(d.url); })
      .catch(() => {});
  }, [deal?.id, deal?.contact_phone, selectedClientId]);

  const catalogItems = catalogType === 'produto'
    ? catalogProdutos.filter(p => p.ativo).map(p => ({ id: p.id, nome: p.nome, value: p.preco_venda }))
    : catalogType === 'servico'
    ? catalogServicos.filter(s => s.ativo).map(s => ({ id: s.id, nome: s.nome, value: s.preco_base }))
    : catalogCombos.filter(c => c.ativo).map(c => ({ id: c.id, nome: c.nome, value: c.preco_final }));

  const filteredCatalog = catalogSearch
    ? catalogItems.filter(i => i.nome.toLowerCase().includes(catalogSearch.toLowerCase()))
    : catalogItems;

  const itemsTotal = localItems.reduce((sum, i) => sum + (i.catalog_value * i.quantidade), 0);

  const addDealItem = async (id: string, nome: string, value: number) => {
    if (!deal) return;
    // Otimistic update
    const tempItem: DealItem = {
      id: `temp-${Date.now()}`, deal_id: Number(deal.id),
      catalog_type: catalogType, catalog_id: id, catalog_name: nome,
      catalog_value: value, quantidade: 1, created_at: new Date().toISOString(),
    };
    setLocalItems(prev => [...prev, tempItem]);
    setCatalogOpen(false);
    setCatalogSearch('');
    setShowAddItem(false);
    setCatalogSaving(true);
    try {
      const res = await authFetch(`/api/deals/${deal.id}/items`, {
        method: 'POST',
        body: JSON.stringify({ catalog_type: catalogType, catalog_id: id, catalog_name: nome, catalog_value: value, quantidade: 1 }),
      });
      const data = await res.json();
      if (data.item) {
        setLocalItems(prev => prev.map(i => i.id === tempItem.id ? data.item : i));
      }
      onUpdate({ silent: true });
    } catch {
      setLocalItems(prev => prev.filter(i => i.id !== tempItem.id));
    } finally {
      setCatalogSaving(false);
    }
  };

  const removeDealItem = async (itemId: string) => {
    setLocalItems(prev => prev.filter(i => i.id !== itemId));
    try {
      await authFetch(`/api/deal-items/${itemId}`, { method: 'DELETE' });
      onUpdate({ silent: true });
    } catch {
      onUpdate({ silent: true });
    }
  };

  const changeItemQty = async (itemId: string, delta: number) => {
    setLocalItems(prev => prev.map(i =>
      i.id === itemId ? { ...i, quantidade: Math.max(1, i.quantidade + delta) } : i
    ));
    const item = localItems.find(i => i.id === itemId);
    if (!item) return;
    const newQty = Math.max(1, item.quantidade + delta);
    try {
      await authFetch(`/api/deal-items/${itemId}`, {
        method: 'PUT',
        body: JSON.stringify({ quantidade: newQty }),
      });
      onUpdate({ silent: true });
    } catch {
      setLocalItems(prev => prev.map(i => i.id === itemId ? { ...i, quantidade: item.quantidade } : i));
    }
  };

  const CATALOG_CONFIG = {
    combo:   { label: 'Combo',   icon: <Layers size={14} />,   color: 'text-amber-600 dark:text-amber-400',  bg: 'bg-amber-50 dark:bg-amber-900/20',   border: 'border-amber-200 dark:border-amber-700' },
    produto: { label: 'Produto', icon: <Package size={14} />,  color: 'text-blue-600 dark:text-blue-400',    bg: 'bg-blue-50 dark:bg-blue-900/20',     border: 'border-blue-200 dark:border-blue-700' },
    servico: { label: 'Serviço', icon: <Briefcase size={14} />, color: 'text-purple-600 dark:text-purple-400', bg: 'bg-purple-50 dark:bg-purple-900/20', border: 'border-purple-200 dark:border-purple-700' },
  };
  // ─────────────────────────────────────────────────────────────────────────

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
      setEditingTitleVal(deal.title || "");
      setEditingTitle(false);
      setDealLabels(Array.isArray(deal.labels) ? deal.labels : []);
      setShowLabelPicker(false);
      setShowHeaderLabelDropdown(false);
      setDealCampaignId(deal.campaign_id || null);
      setShowCampaignPicker(false);
      loadActivities();
      loadHistory();
    }
    // Depende do ID, não do objeto: o polling de 12s recria o objeto `deal`
    // (mesmo dado, identidade nova) e este reset apagava notas/campos em edição.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deal?.id]);

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

  const lostStage = stages.find(s => s.is_final && !s.is_won);
  const markAsLost = () => {
    if (lostStage) setShowLostModal(true);
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

  // Label picker click-outside (info tab + header dropdown)
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (target === document.documentElement || target === document.body) return;
      if (labelPickerRef.current && !labelPickerRef.current.contains(target)) {
        setShowLabelPicker(false);
      }
      if (headerLabelRef.current && !headerLabelRef.current.contains(target)) {
        setShowHeaderLabelDropdown(false);
      }
      if (campaignPickerRef.current && !campaignPickerRef.current.contains(target)) {
        setShowCampaignPicker(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const setCampaign = async (campaignId: string | null) => {
    setDealCampaignId(campaignId);
    setShowCampaignPicker(false);
    await updateDeal({ campaign_id: campaignId });
  };

  const toggleLabel = async (labelId: string) => {
    if (!deal) return;
    const next = dealLabels.includes(labelId)
      ? dealLabels.filter(l => l !== labelId)
      : [...dealLabels, labelId];
    setDealLabels(next);
    await authFetch(`/api/deals/${deal.id}/labels`, {
      method: 'PATCH',
      body: JSON.stringify({ labels: next }),
    });
    onUpdate({ silent: true });
  };

  const createLabel = async () => {
    if (!newLabelName.trim()) return;
    setCreatingLabel(true);
    try {
      const res = await authFetch('/api/pipeline/labels', {
        method: 'POST',
        body: JSON.stringify({ name: newLabelName.trim(), color: newLabelColor }),
      });
      const label = await res.json();
      setAvailableLabels(prev => [...prev, label].sort((a, b) => a.name.localeCompare(b.name)));
      setNewLabelName('');
    } finally {
      setCreatingLabel(false);
    }
  };

  const deleteLabel = async (labelId: string) => {
    await authFetch(`/api/pipeline/labels/${labelId}`, { method: 'DELETE' });
    setAvailableLabels(prev => prev.filter(l => l.id !== labelId));
    if (dealLabels.includes(labelId)) {
      const next = dealLabels.filter(l => l !== labelId);
      setDealLabels(next);
      if (deal) {
        await authFetch(`/api/deals/${deal.id}/labels`, {
          method: 'PATCH',
          body: JSON.stringify({ labels: next }),
        });
      }
    }
  };

  const saveTitle = async () => {
    const trimmed = editingTitleVal.trim();
    if (trimmed && trimmed !== deal?.title) {
      await updateDeal({ title: trimmed });
    }
    setEditingTitle(false);
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

  const chatPhone = linkedClient?.phone || deal.contact_phone;
  const chatName  = linkedClient?.name  || deal.contact_name || deal.title;

  return (
    <>
      {/* Painel lateral - popup da conversa ocupando ~50% da tela à direita.
          Sem fundo escuro: a pipeline continua visível e clicável atrás. */}
      <div className="fixed inset-y-0 right-0 z-50 w-full lg:w-[30vw] flex">
        <div className="relative bg-white dark:bg-gray-900 shadow-2xl flex flex-col overflow-hidden w-full h-full border-l border-gray-200 dark:border-gray-800 animate-slide-up sm:animate-none">
          {/* Header */}
          <div className={`border-b border-gray-200 dark:border-gray-800 px-3 sm:px-5 pt-3 sm:pt-4 pb-0 flex-shrink-0 ${
            isWon ? "bg-emerald-50 dark:bg-emerald-950/30" :
            isLost ? "bg-red-50 dark:bg-red-950/30" :
            "bg-white dark:bg-gray-900"
          }`}>
            {/* Row 1: Identidade (foto + nome + telefone) + Fechar */}
            <div className="flex items-center gap-3 mb-3">
              {/* WhatsApp profile photo */}
              <div className="flex-shrink-0">
                {contactPhotoUrl ? (
                  <img
                    src={contactPhotoUrl}
                    alt={chatName || ""}
                    className="w-11 h-11 rounded-full object-cover"
                    onError={() => setContactPhotoUrl(null)}
                  />
                ) : (
                  <div className="w-11 h-11 rounded-full bg-gold-500 flex items-center justify-center text-white font-bold text-sm">
                    {(chatName || "?").slice(0, 2).toUpperCase()}
                  </div>
                )}
              </div>

              {/* Name + Phone + Stage */}
              <div className="flex-1 min-w-0">
                {isFinal && (
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold rounded-full mb-0.5 ${
                    isWon
                      ? "bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300"
                      : "bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-300"
                  }`}>
                    {isWon ? <><Trophy size={10} /> Convertido</> : <><XCircle size={10} /> Perdido</>}
                  </span>
                )}
                {editingTitle ? (
                  <input
                    autoFocus
                    value={editingTitleVal}
                    onChange={e => setEditingTitleVal(e.target.value)}
                    onBlur={saveTitle}
                    onKeyDown={e => { if (e.key === "Enter") saveTitle(); if (e.key === "Escape") setEditingTitle(false); }}
                    className="text-base font-bold text-gray-900 dark:text-white bg-transparent border-b border-gold-400 dark:border-gold-500 outline-none w-full"
                  />
                ) : (
                  <div className="flex items-center gap-1 group">
                    <h2 className="text-base font-bold text-gray-900 dark:text-white truncate">{deal.title}</h2>
                    <button
                      onClick={() => { setEditingTitleVal(deal.title); setEditingTitle(true); }}
                      className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-400 transition-all flex-shrink-0"
                      title="Editar nome"
                    >
                      <Pencil size={11} />
                    </button>
                  </div>
                )}
                <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 mt-0.5 flex-wrap">
                  {chatPhone && (
                    <span className="flex items-center gap-1">
                      <Phone size={10} /> {chatPhone}
                    </span>
                  )}
                  {chatPhone && <span>·</span>}
                  <span className="truncate">{currentStage?.name || deal.stage}</span>
                </div>
              </div>

              {/* Fechar - sempre visível no canto */}
              <button
                onClick={onClose}
                title="Fechar"
                className="p-2 -m-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors flex-shrink-0"
              >
                <X size={20} />
              </button>
            </div>

            {/* Row 2: Botões de ação - empilham com gap respiratório */}
            {!isFinal && (
              <div className="flex items-center gap-2 mb-3 flex-wrap">
                <button
                  onClick={markAsWon}
                  className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-semibold transition-colors min-w-[120px]"
                >
                  <Trophy size={13} /> Converter
                </button>
                <button
                  onClick={markAsLost}
                  className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/40 text-xs font-semibold transition-colors min-w-[100px]"
                >
                  <XCircle size={13} /> Perdido
                </button>
                {chatPhone && (
                  <button
                    onClick={() => {
                      onClose();
                      setSearchParams({ tab: "inbox", phone: String(chatPhone).replace(/\D/g, "") });
                    }}
                    title="Abrir conversa no Inbox"
                    className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-emerald-200 dark:border-emerald-800/40 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 text-xs font-semibold transition-colors"
                  >
                    <MessageCircle size={13} /> Mensagem
                  </button>
                )}
                <button
                  onClick={deleteDeal}
                  title="Excluir negócio"
                  className="flex items-center justify-center p-2 text-gray-400 hover:text-red-500 dark:hover:text-red-400 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors flex-shrink-0 ml-auto sm:ml-0"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            )}
            {isFinal && (
              <div className="flex justify-end mb-3">
                <button
                  onClick={deleteDeal}
                  title="Excluir negócio"
                  className="flex items-center justify-center p-2 text-gray-400 hover:text-red-500 dark:hover:text-red-400 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            )}

            {/* Etiquetas do lead - dropdown inline no header */}
            <div ref={headerLabelRef} className="relative flex items-center gap-1.5 mb-2 flex-wrap">
              {/* Labels aplicadas - clique para remover */}
              {dealLabels.map(lId => {
                const label = availableLabels.find(l => l.id === lId);
                if (!label) return null;
                return (
                  <button
                    key={lId}
                    onClick={() => toggleLabel(lId)}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold text-white hover:opacity-75 transition-opacity"
                    style={{ backgroundColor: label.color }}
                    title="Clique para remover"
                  >
                    {label.name}
                    <X size={9} className="opacity-80" />
                  </button>
                );
              })}

              {/* Botão que abre o dropdown */}
              <button
                onClick={() => setShowHeaderLabelDropdown(v => !v)}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium transition-colors ${
                  showHeaderLabelDropdown
                    ? 'bg-gold-100 dark:bg-gold-900/30 text-gold-600 dark:text-gold-400'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                }`}
              >
                <Tag size={10} />
                {dealLabels.length === 0 ? "Etiqueta" : "+"}
              </button>

              {/* Dropdown */}
              {showHeaderLabelDropdown && (
                <div className="absolute top-full left-0 mt-1.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-2xl dark:shadow-black/50 p-3 z-50 min-w-[260px] space-y-3">
                  {/* Etiquetas existentes */}
                  {availableLabels.length === 0 ? (
                    <p className="text-xs text-gray-400 dark:text-gray-500 text-center py-1">Nenhuma etiqueta ainda. Crie uma abaixo.</p>
                  ) : (
                    <div>
                      <p className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase mb-2">Selecionar</p>
                      <div className="flex flex-wrap gap-1.5">
                        {availableLabels.map(label => {
                          const active = dealLabels.includes(label.id);
                          return (
                            <button
                              key={label.id}
                              onClick={() => toggleLabel(label.id)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold text-white transition-all"
                              style={{
                                backgroundColor: label.color,
                                opacity: active ? 1 : 0.4,
                                outline: active ? `2px solid ${label.color}` : 'none',
                                outlineOffset: '2px',
                              }}
                            >
                              {active && <Check size={10} />}
                              {label.name}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Criar nova etiqueta */}
                  <div className="border-t border-gray-100 dark:border-gray-700 pt-3">
                    <p className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase mb-2">Nova etiqueta</p>
                    {/* Color swatches */}
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {LABEL_COLORS.map(color => (
                        <button
                          key={color}
                          onClick={() => setNewLabelColor(color)}
                          className="w-5 h-5 rounded-full hover:scale-110 transition-transform flex items-center justify-center flex-shrink-0"
                          style={{ backgroundColor: color }}
                        >
                          {newLabelColor === color && <Check size={9} className="text-white drop-shadow" />}
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className="w-5 h-5 rounded-full flex-shrink-0 border border-white/20"
                        style={{ backgroundColor: newLabelColor }}
                      />
                      <input
                        value={newLabelName}
                        onChange={e => setNewLabelName(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') createLabel(); if (e.key === 'Escape') setShowHeaderLabelDropdown(false); }}
                        placeholder="Nome da etiqueta..."
                        className="flex-1 text-sm border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 rounded-lg px-2.5 py-1.5 outline-none focus:border-gold-400 dark:focus:border-gold-500 text-gray-800 dark:text-gray-200 placeholder-gray-400"
                      />
                      <button
                        onClick={createLabel}
                        disabled={!newLabelName.trim() || creatingLabel}
                        className="px-2.5 py-1.5 bg-gold-600 hover:bg-gold-700 disabled:opacity-40 text-white text-xs rounded-lg font-semibold transition-colors"
                      >
                        {creatingLabel ? '...' : 'Criar'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

          </div>

          <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-4 sm:space-y-6">

            {/* ── Info principal: Valor / Previsão / Prioridade ── */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-3">

              {/* Valor — só quem tem permissão "Financeiro" vê/edita */}
              {canSeeFinance && (
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
                      className="w-full border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 rounded px-2 py-1 text-sm text-gray-900 dark:text-white outline-none focus:border-gold-400 dark:focus:border-gold-500"
                      onKeyDown={e => { if (e.key === "Enter") saveValue(); if (e.key === "Escape") setEditingValue(false); }}
                    />
                    <div className="flex gap-2">
                      <button onClick={saveValue} className="flex-1 py-1 bg-gold-600 hover:bg-gold-700 text-white text-xs rounded font-medium">✓</button>
                      <button onClick={() => setEditingValue(false)} className="flex-1 py-1 border border-gray-200 dark:border-gray-700 text-gray-500 text-xs rounded">✕</button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <p className="text-base font-bold text-gray-900 dark:text-white">
                      R$ {(deal.value || 0).toLocaleString("pt-BR")}
                    </p>
                    {localItems.length > 0 && itemsTotal !== deal.value && (
                      <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">
                        Itens: R$ {itemsTotal.toLocaleString("pt-BR")}
                      </p>
                    )}
                  </div>
                )}
              </div>
              )}

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
                    <div className="flex gap-2">
                      <button onClick={saveDate} className="flex-1 py-1 bg-gold-600 hover:bg-gold-700 text-white text-xs rounded font-medium">✓</button>
                      <button onClick={() => setEditingDate(false)} className="flex-1 py-1 border border-gray-200 dark:border-gray-700 text-gray-500 text-xs rounded">✕</button>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">
                    {(() => {
                      const formatted = safeFormat(deal.expected_close_date, "dd/MM/yyyy");
                      return formatted || <span className="text-gray-400 font-normal">-</span>;
                    })()}
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
                            ? "bg-gold-600 text-white"
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

            {/* ── Vendedor responsável ── */}
            <AssigneeField deal={deal} onUpdate={updateDeal} />

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
                    {linkedClient.phone && (
                      <p className="flex items-center gap-2">
                        <Phone size={12} /> {linkedClient.phone}
                      </p>
                    )}
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
                      {deal.contact_phone && (
                        <p className="text-gray-500 dark:text-gray-400 flex items-center gap-2">
                          <Phone size={12} /> {deal.contact_phone}
                        </p>
                      )}
                      {deal.contact_email && <p className="text-gray-500 dark:text-gray-400 flex items-center gap-2"><Mail size={12} /> {deal.contact_email}</p>}
                      {deal.contact_instagram && <p className="text-gray-500 dark:text-gray-400 flex items-center gap-2"><Instagram size={12} /> {deal.contact_instagram}</p>}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* ── Pacote / Serviço vinculado (múltiplos itens) ── */}
            <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase flex items-center gap-1">
                  <Package size={12} /> Pacote / Itens
                  {localItems.length > 0 && (
                    <span className="ml-1 px-1.5 py-0.5 rounded-full bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-[10px] font-bold">
                      {localItems.length}
                    </span>
                  )}
                </label>
                <button
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => { setShowAddItem(v => !v); setCatalogOpen(false); setCatalogSearch(''); }}
                  className="flex items-center gap-1 text-xs font-medium text-gold-600 dark:text-gold-400 hover:text-gold-700 dark:hover:text-gold-300 transition-colors"
                >
                  <Plus size={13} /> Adicionar
                </button>
              </div>

              {/* Lista de itens vinculados */}
              {localItems.length > 0 && (
                <div className="space-y-2 mb-3">
                  {localItems.map(item => {
                    const cfg = CATALOG_CONFIG[item.catalog_type as keyof typeof CATALOG_CONFIG] || CATALOG_CONFIG.produto;
                    return (
                      <div key={item.id} className={`p-2.5 rounded-xl border ${cfg.bg} ${cfg.border}`}>
                        <div className="flex items-center gap-2">
                          <span className={`flex-shrink-0 ${cfg.color}`}>{cfg.icon}</span>
                          <p className="text-sm font-medium text-gray-900 dark:text-white truncate flex-1">{item.catalog_name}</p>
                          <button
                            onMouseDown={e => e.preventDefault()}
                            onClick={() => removeDealItem(item.id)}
                            className="p-1 text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors flex-shrink-0"
                          >
                            <X size={12} />
                          </button>
                        </div>
                        <div className="flex items-center justify-between mt-2">
                          {/* Controle de quantidade */}
                          <div className="flex items-center gap-1">
                            <button
                              onMouseDown={e => e.preventDefault()}
                              onClick={() => changeItemQty(item.id, -1)}
                              disabled={item.quantidade <= 1}
                              className="w-6 h-6 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 flex items-center justify-center text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600 disabled:opacity-40 transition-colors text-sm font-bold leading-none"
                            >−</button>
                            <input
                              type="number"
                              min={1}
                              value={item.quantidade}
                              onChange={e => {
                                const val = parseInt(e.target.value) || 1;
                                setLocalItems(prev => prev.map(i => i.id === item.id ? { ...i, quantidade: Math.max(1, val) } : i));
                              }}
                              onBlur={e => {
                                const val = Math.max(1, parseInt(e.target.value) || 1);
                                if (val !== item.quantidade) changeItemQty(item.id, val - item.quantidade);
                              }}
                              onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                              className="w-10 text-center text-sm font-semibold text-gray-800 dark:text-gray-200 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 rounded-lg py-0.5 outline-none focus:border-gold-400 dark:focus:border-gold-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                            />
                            <button
                              onMouseDown={e => e.preventDefault()}
                              onClick={() => changeItemQty(item.id, +1)}
                              className="w-6 h-6 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 flex items-center justify-center text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors text-sm font-bold leading-none"
                            >+</button>
                          </div>
                          {/* Preço — só quem tem permissão "Financeiro" */}
                          {canSeeFinance && (
                          <div className="text-right">
                            <p className="text-xs text-gray-400 dark:text-gray-500">
                              R$ {item.catalog_value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} un.
                            </p>
                            <p className="text-sm font-bold text-gray-900 dark:text-white">
                              R$ {(item.catalog_value * item.quantidade).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                            </p>
                          </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {/* Total — só quem tem permissão "Financeiro" */}
                  {canSeeFinance && (
                  <div className="flex items-center justify-between px-2.5 py-2 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
                    <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Total dos itens</span>
                    <span className="text-sm font-bold text-gray-900 dark:text-white">
                      R$ {itemsTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                  )}
                </div>
              )}

              {/* Seletor para adicionar item */}
              {showAddItem && (
                <div ref={catalogRef} className="space-y-2 border border-gray-200 dark:border-gray-700 rounded-xl p-3 bg-white dark:bg-gray-800">
                  <p className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase">Tipo</p>
                  <div className="grid grid-cols-3 gap-1.5">
                    {(['combo', 'produto', 'servico'] as const).map(t => {
                      const cfg = CATALOG_CONFIG[t];
                      const active = catalogType === t;
                      return (
                        <button key={t} onMouseDown={e => e.preventDefault()}
                          onClick={() => { setCatalogType(t); setCatalogOpen(true); setCatalogSearch(''); }}
                          className={`flex flex-col items-center gap-1 py-2 px-1 rounded-xl border text-center transition-all ${
                            active ? `${cfg.bg} ${cfg.border} ${cfg.color}` : 'border-gray-200 dark:border-gray-700 text-gray-400 hover:border-gray-300 dark:hover:border-gray-600'
                          }`}>
                          {cfg.icon}
                          <span className="text-[10px] font-semibold">{cfg.label}</span>
                        </button>
                      );
                    })}
                  </div>

                  {/* Busca */}
                  <div className="relative">
                    <div className="flex items-center gap-2 border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 bg-gray-50 dark:bg-gray-900 focus-within:border-gold-400 dark:focus-within:border-gold-500 transition-colors">
                      <Search size={13} className="text-gray-400 flex-shrink-0" />
                      <input
                        value={catalogSearch}
                        onChange={e => { setCatalogSearch(e.target.value); setCatalogOpen(true); }}
                        onFocus={() => setCatalogOpen(true)}
                        placeholder={`Buscar ${CATALOG_CONFIG[catalogType].label.toLowerCase()}...`}
                        className="flex-1 text-sm bg-transparent outline-none text-gray-800 dark:text-gray-100 placeholder-gray-400"
                      />
                    </div>
                    {catalogOpen && (
                      <div className="absolute z-30 top-full left-0 right-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl overflow-hidden">
                        {filteredCatalog.length === 0 ? (
                          <div className="flex flex-col items-center gap-1 py-6 text-gray-400">
                            <Package size={20} strokeWidth={1.5} />
                            <p className="text-xs">Nenhum {CATALOG_CONFIG[catalogType].label.toLowerCase()} encontrado</p>
                          </div>
                        ) : (
                          <div className="max-h-48 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-700/50">
                            {filteredCatalog.map(item => (
                              <button key={item.id}
                                onMouseDown={e => e.preventDefault()}
                                onClick={() => addDealItem(item.id, item.nome, item.value)}
                                className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700/60 transition-colors text-left">
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className={CATALOG_CONFIG[catalogType].color}>{CATALOG_CONFIG[catalogType].icon}</span>
                                  <span className="text-sm text-gray-800 dark:text-gray-100 truncate">{item.nome}</span>
                                </div>
                                {canSeeFinance && (
                                <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 ml-2 flex-shrink-0">
                                  R$ {item.value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                </span>
                                )}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  <button onMouseDown={e => e.preventDefault()} onClick={() => { setShowAddItem(false); setCatalogOpen(false); setCatalogSearch(''); }}
                    className="w-full text-[11px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 py-1 transition-colors">
                    Cancelar
                  </button>
                </div>
              )}

              {localItems.length === 0 && !showAddItem && (
                <p className="text-[11px] text-gray-400 dark:text-gray-500 text-center py-2">
                  Nenhum item vinculado. Clique em "Adicionar" para vincular combos, produtos ou serviços.
                </p>
              )}
              {catalogSaving && <p className="text-[11px] text-gray-400 mt-1 text-center">Salvando...</p>}
            </div>

            {/* ── Etiquetas ── */}
            <div ref={labelPickerRef} className="relative">
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase flex items-center gap-1">
                  <Tag size={12} /> Etiquetas
                </label>
                <button
                  onClick={() => setShowLabelPicker(v => !v)}
                  className="flex items-center gap-1 text-xs text-gold-600 dark:text-gold-400 hover:text-gold-700 dark:hover:text-gold-300 transition-colors font-medium"
                >
                  <Plus size={12} /> Gerenciar
                </button>
              </div>

              {/* Current labels */}
              <div className="flex flex-wrap gap-1.5 min-h-[28px]">
                {dealLabels.length === 0 && !showLabelPicker && (
                  <p className="text-[11px] text-gray-400 dark:text-gray-500 py-1">Nenhuma etiqueta. Clique em "Gerenciar" para adicionar.</p>
                )}
                {dealLabels.map(lId => {
                  const label = availableLabels.find(l => l.id === lId);
                  if (!label) return null;
                  return (
                    <span
                      key={lId}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium text-white cursor-pointer hover:opacity-80 transition-opacity"
                      style={{ backgroundColor: label.color }}
                      onClick={() => toggleLabel(lId)}
                      title="Clique para remover"
                    >
                      {label.name}
                      <X size={10} className="opacity-70" />
                    </span>
                  );
                })}
              </div>

              {/* Label picker dropdown */}
              {showLabelPicker && (
                <div className="mt-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl p-3 space-y-3 z-20 relative">
                  {/* Available labels */}
                  {availableLabels.length > 0 && (
                    <div>
                      <p className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase mb-2">Clique para aplicar / remover</p>
                      <div className="flex flex-wrap gap-1.5">
                        {availableLabels.map(label => {
                          const active = dealLabels.includes(label.id);
                          return (
                            <span
                              key={label.id}
                              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium cursor-pointer transition-all ${
                                active ? 'text-white ring-2 ring-offset-1 ring-gray-400 dark:ring-offset-gray-800' : 'opacity-60 hover:opacity-100'
                              }`}
                              style={{ backgroundColor: label.color, color: active ? 'white' : undefined }}
                              onClick={() => toggleLabel(label.id)}
                            >
                              {active && <Check size={10} />}
                              {label.name}
                              <button
                                onClick={e => { e.stopPropagation(); deleteLabel(label.id); }}
                                className="ml-0.5 opacity-0 hover:opacity-100 transition-opacity"
                                title="Excluir etiqueta"
                              >
                                <X size={9} />
                              </button>
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Create new label */}
                  <div className="border-t border-gray-100 dark:border-gray-700 pt-3">
                    <p className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase mb-2">Nova etiqueta</p>
                    {/* Color swatches */}
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {LABEL_COLORS.map(color => (
                        <button
                          key={color}
                          onClick={() => setNewLabelColor(color)}
                          className="w-6 h-6 rounded-full transition-transform hover:scale-110 flex items-center justify-center"
                          style={{ backgroundColor: color }}
                          title={color}
                        >
                          {newLabelColor === color && (
                            <Check size={11} className="text-white drop-shadow" />
                          )}
                        </button>
                      ))}
                    </div>
                    {/* Preview */}
                    <div className="flex items-center gap-2">
                      <span
                        className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium text-white shrink-0"
                        style={{ backgroundColor: newLabelColor }}
                      >
                        {newLabelName || "Prévia"}
                      </span>
                      <input
                        value={newLabelName}
                        onChange={e => setNewLabelName(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') createLabel(); }}
                        placeholder="Nome da etiqueta..."
                        className="flex-1 text-sm border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 rounded-lg px-3 py-1.5 outline-none focus:border-gold-400 dark:focus:border-gold-500 text-gray-800 dark:text-gray-200 placeholder-gray-400"
                      />
                      <button
                        onClick={createLabel}
                        disabled={!newLabelName.trim() || creatingLabel}
                        className="px-3 py-1.5 bg-gold-600 hover:bg-gold-700 disabled:opacity-40 text-white text-xs rounded-lg font-medium transition-colors"
                      >
                        {creatingLabel ? '...' : 'Criar'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* ── Venda Especial / Campanha ── */}
            <div ref={campaignPickerRef} className="relative">
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase flex items-center gap-1">
                  <Sparkles size={12} /> Venda Especial / Campanha
                </label>
                <button
                  onClick={() => setShowCampaignPicker(v => !v)}
                  className="flex items-center gap-1 text-xs text-gold-600 dark:text-gold-400 hover:text-gold-700 dark:hover:text-gold-300 transition-colors font-medium"
                >
                  <Pencil size={12} /> Alterar
                </button>
              </div>

              {/* Pílula da campanha atual */}
              <div className="flex flex-wrap gap-1.5 min-h-[28px]">
                {(() => {
                  const current = dealCampaignId ? campaigns.find(c => c.id === dealCampaignId) : null;
                  if (!current) {
                    return <p className="text-[11px] text-gray-400 dark:text-gray-500 py-1">Sem campanha. Clique em "Alterar" para vincular.</p>;
                  }
                  return (
                    <span
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium text-white cursor-pointer hover:opacity-80 transition-opacity"
                      style={{ backgroundColor: current.color }}
                      onClick={() => setCampaign(null)}
                      title="Clique para remover"
                    >
                      {current.name}
                      <X size={10} className="opacity-70" />
                    </span>
                  );
                })()}
              </div>

              {/* Dropdown de seleção */}
              {showCampaignPicker && (
                <div className="mt-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl p-3 space-y-3 z-20 relative">
                  <p className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase mb-2">Selecionar campanha</p>
                  {campaigns.length === 0 ? (
                    <p className="text-xs text-gray-400 dark:text-gray-500 text-center py-1">Nenhuma campanha disponível.</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {campaigns.map(c => {
                        const active = dealCampaignId === c.id;
                        return (
                          <span
                            key={c.id}
                            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium cursor-pointer transition-all ${
                              active ? 'text-white ring-2 ring-offset-1 ring-gray-400 dark:ring-offset-gray-800' : 'opacity-60 hover:opacity-100'
                            }`}
                            style={{ backgroundColor: c.color, color: active ? 'white' : undefined }}
                            onClick={() => setCampaign(active ? null : c.id)}
                          >
                            {active && <Check size={10} />}
                            {c.name}
                          </span>
                        );
                      })}
                    </div>
                  )}
                  <div className="border-t border-gray-100 dark:border-gray-700 pt-2">
                    <button
                      onClick={() => setCampaign(null)}
                      className="w-full text-left px-2 py-1.5 rounded-lg text-xs font-medium text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors flex items-center gap-1.5"
                    >
                      <XCircle size={12} /> Sem campanha
                    </button>
                  </div>
                </div>
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
                        <span>{safeFormat(act.created_at, "dd/MM/yyyy HH:mm") || "-"}</span>
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
          </div> {/* fim conteúdo */}

        </div> {/* fim modal */}
      </div> {/* fim overlay */}

      {showConversionModal && (
        <DealConversionModal
          deal={deal}
          clients={clients}
          onClose={() => setShowConversionModal(false)}
          onConverted={() => { celebrateSale(); setShowConversionModal(false); onUpdate(); onClose(); }}
        />
      )}

      {showLostModal && (
        <LostDealModal
          deal={deal}
          stageId={lostStage?.id}
          onClose={() => setShowLostModal(false)}
          onSaved={() => { setShowLostModal(false); onUpdate(); onClose(); }}
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

function AssigneeField({ deal, onUpdate }: { deal: Deal; onUpdate: (data: Partial<Deal>) => Promise<void> }) {
  const { sellers } = useSellers();
  return (
    <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-4 space-y-2">
      <label className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase flex items-center gap-1">
        <User size={12} /> Vendedor responsável
      </label>
      <SellerPicker
        sellers={sellers}
        value={deal.assigned_to || null}
        onChange={(id) => onUpdate({ assigned_to: id })}
      />
    </div>
  );
}

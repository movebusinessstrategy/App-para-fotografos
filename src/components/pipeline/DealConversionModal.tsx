// src/components/vendas/DealConversionModal.tsx
import React, { useEffect, useState, useMemo } from "react";
import { motion } from "motion/react";
import { Plus, User, Briefcase, ChevronDown, ChevronUp, Link2, DollarSign, Search, Trash2, Package, Tag, Layers, CalendarDays, Megaphone, AlertTriangle } from "lucide-react";

import { Deal, Client, DealItem, SaleCampaign } from "../../types";
import { authFetch } from "../../utils/authFetch";
import { useApi } from "../../utils/useApi";
import { normalizeText } from "../../utils/normalizeText";
import { todayLocalISO } from "../../utils/date";
import { useTiposEnsaio, tiposComValorAtual } from "../../hooks/useTiposEnsaio";
import { SearchableSelect } from "../ui/SearchableSelect";

type CatalogType = "combo" | "produto" | "servico";

interface PendingItem {
  catalog_type: CatalogType;
  catalog_id: string;
  catalog_name: string;
  catalog_value: number;
  quantidade: number;
}

const CATALOG_LABELS: Record<CatalogType, string> = {
  combo: "Combos",
  produto: "Produtos",
  servico: "Serviços",
};

const CATALOG_ICONS: Record<CatalogType, React.ReactNode> = {
  combo: <Layers size={11} />,
  produto: <Package size={11} />,
  servico: <Tag size={11} />,
};

interface DealConversionModalProps {
  deal: Deal | null;
  clients?: Client[];
  preferredClientId?: number | null;
  preferredItems?: DealItem[];
  onClose: () => void;
  onConverted: () => void;
}

interface DuplicateJob {
  id: number;
  job_name?: string | null;
  job_type: string;
  job_date?: string | null;
  in_production?: boolean;
  can_reuse?: boolean;
}

interface DuplicateWarning {
  message: string;
  existing: DuplicateJob[];
}

function inferJobType(types: string[], names: Array<string | null | undefined>): string | null {
  const candidates = names.map(name => normalizeText(name || "")).filter(Boolean);
  if (candidates.length === 0) return null;

  const exact = types.find(type => candidates.includes(normalizeText(type)));
  if (exact) return exact;

  return [...types]
    .filter(type => normalizeText(type) !== "outros")
    .sort((a, b) => b.length - a.length)
    .find(type => candidates.some(name => name.includes(normalizeText(type)))) || null;
}

function formatDuplicateDate(value?: string | null): string {
  if (!value) return "sem data";
  return String(value).slice(0, 10).split("-").reverse().join("/");
}

export function DealConversionModal({ 
  deal, 
  clients = [],
  preferredClientId,
  preferredItems,
  onClose, 
  onConverted 
}: DealConversionModalProps) {
  const [conversionMode, setConversionMode] = useState<"new" | "existing">("new");
  const [selectedClientId, setSelectedClientId] = useState<number | null>(null);
  const [createClient, setCreateClient] = useState(true);
  const [createJob, setCreateJob] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [duplicateWarning, setDuplicateWarning] = useState<DuplicateWarning | null>(null);
  const [submitError, setSubmitError] = useState("");
  const [completionWarnings, setCompletionWarnings] = useState<string[]>([]);
  const [showClientPicker, setShowClientPicker] = useState(false);
  const [jobTypeTouched, setJobTypeTouched] = useState(false);
  const [sinalAmount, setSinalAmount] = useState(0);
  // Venda especial / Campanha (opcional). "" => sem campanha.
  const [campaignId, setCampaignId] = useState<string>("");
  const [campaigns, setCampaigns] = useState<SaleCampaign[]>([]);
  // Data da venda: default hoje; permite registrar vendas antigas (retroativas)
  const [soldDate, setSoldDate] = useState(todayLocalISO());
  const [expandedSections, setExpandedSections] = useState({
    client: true,
    job: true,
  });

  // ── Itens do catálogo (produtos/serviços/combos da venda) ──
  // Os já vinculados ao deal aparecem como existentes; aqui dá pra ADICIONAR
  // novos na hora da conversão (mesmo fluxo que a extensão já tinha).
  const [newItems, setNewItems] = useState<PendingItem[]>([]);
  const [showAdder, setShowAdder] = useState(false);
  const [adderType, setAdderType] = useState<CatalogType>("combo");
  const [adderSearch, setAdderSearch] = useState("");

  const tiposEnsaio = useTiposEnsaio();
  const { data: produtosData } = useApi<any[]>(deal ? "/api/produtos" : null);
  const { data: servicosData } = useApi<any[]>(deal ? "/api/servicos" : null);
  const { data: combosData } = useApi<any[]>(deal ? "/api/combos" : null);

  const catalogList = useMemo(() => {
    const produtos = Array.isArray(produtosData) ? produtosData : [];
    const servicos = Array.isArray(servicosData) ? servicosData : [];
    const combos = Array.isArray(combosData) ? combosData : [];
    if (adderType === "produto") return produtos.filter(p => p.ativo).map(p => ({ id: String(p.id), nome: p.nome, value: Number(p.preco_venda) || 0 }));
    if (adderType === "servico") return servicos.filter(s => s.ativo).map(s => ({ id: String(s.id), nome: s.nome, value: Number(s.preco_base) || 0 }));
    return combos.filter(c => c.ativo).map(c => ({ id: String(c.id), nome: c.nome, value: Number(c.preco_final) || 0 }));
  }, [adderType, produtosData, servicosData, combosData]);

  const filteredCatalog = useMemo(() => {
    const q = normalizeText(adderSearch);
    if (!q) return catalogList;
    return catalogList.filter(i => normalizeText(i.nome).includes(q));
  }, [catalogList, adderSearch]);

  // Itens já salvos no card. Em estado (não direto do prop) porque agora dá pra
  // DESVINCULAR: pacote errado grudado no lead não tinha como sair daqui.
  const [linkedItems, setLinkedItems] = useState<DealItem[]>(preferredItems || deal?.items || []);
  const [unlinkingId, setUnlinkingId] = useState<string | null>(null);
  useEffect(() => {
    setLinkedItems(preferredItems || deal?.items || []);
  }, [deal?.id, deal?.items, preferredItems]);

  const unlinkItem = async (itemId: string) => {
    setUnlinkingId(itemId);
    try {
      const res = await authFetch(`/api/deal-items/${itemId}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error || `Erro ao remover item (HTTP ${res.status})`);
      }
      setLinkedItems((prev) => prev.filter((i) => i.id !== itemId));
    } catch (e) {
      setSubmitError(`Não deu pra remover o item: ${e instanceof Error ? e.message : "erro desconhecido"}`);
    } finally {
      setUnlinkingId(null);
    }
  };

  const existingItems = linkedItems;
  const existingTotal = existingItems.reduce((s, i) => s + (Number(i.catalog_value) || 0) * (Number(i.quantidade) || 1), 0);
  const newItemsTotal = newItems.reduce((s, i) => s + i.catalog_value * i.quantidade, 0);
  const allItemsCount = existingItems.length + newItems.length;

  // Dados completos do cliente — mesmos campos da aba Clientes
  const [clientData, setClientData] = useState({
    name: "",
    phone: "",
    email: "",
    document: "",
    birth_date: "",
    address: "",
    address_number: "",
    address_complement: "",
    neighborhood: "",
    city: "",
    state: "",
    zip_code: "",
    instagram: "",
    how_found: "",
    notes: "",
  });

  // Dados do Job
  const [jobData, setJobData] = useState({
    job_type: "Gestante",
    job_date: todayLocalISO(),
    job_time: "09:00",
    job_end_time: "",
    job_name: "",
    amount: 0,
    payment_method: "Pix",
    payment_status: "pending",
    status: "scheduled",
    location: "",
    notes: "",
  });

  useEffect(() => {
    if (deal) {
      const initialClientId = preferredClientId !== undefined
        ? preferredClientId
        : deal.client_id ?? null;
      if (initialClientId) {
        setConversionMode("existing");
        setSelectedClientId(initialClientId);
        setCreateClient(false);
      } else {
        setConversionMode("new");
        setSelectedClientId(null);
        setCreateClient(true);
      }
      const workName = preferredItems?.[0]?.catalog_name || deal.items?.[0]?.catalog_name || deal.catalog_name || deal.title || "";
      setClientData((prev) => ({
        ...prev,
        name: deal.contact_name || deal.title || "",
        phone: deal.contact_phone || "",
        email: deal.contact_email || "",
        instagram: deal.contact_instagram || "",
        notes: deal.notes || "",
      }));
      setJobData((prev) => ({
        ...prev,
        job_name: workName,
        amount: deal.value || 0,
        notes: deal.notes || "",
      }));
      setSinalAmount(0);
      setNewItems([]);
      setSoldDate(todayLocalISO());
      setCampaignId(deal.campaign_id || "");
      setDuplicateWarning(null);
      setSubmitError("");
      setCompletionWarnings([]);
      setShowClientPicker(false);
      setJobTypeTouched(false);
    }
    // Depende do ID, não do objeto: o polling de 12s do Vendas recria o objeto
    // `deal` a cada ciclo (mesmo dado, identidade nova) e este reset apagava
    // tudo que o usuário estava digitando no meio da conversão.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deal?.id, preferredClientId]);

  const suggestedJobType = useMemo(() => inferJobType(
    tiposEnsaio,
    [
      ...linkedItems.map(item => item.catalog_name),
      ...newItems.map(item => item.catalog_name),
      deal?.catalog_name,
      deal?.title,
    ],
  ), [tiposEnsaio, linkedItems, newItems, deal?.catalog_name, deal?.title]);

  useEffect(() => {
    if (!suggestedJobType || jobTypeTouched) return;
    setJobData(prev => prev.job_type === suggestedJobType ? prev : { ...prev, job_type: suggestedJobType });
  }, [suggestedJobType, jobTypeTouched]);

  // Carrega campanhas/vendas especiais (seeds os 6 defaults na 1ª chamada do usuário)
  useEffect(() => {
    if (!deal) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await authFetch("/api/sale-campaigns");
        const data = await res.json();
        if (!cancelled) setCampaigns(Array.isArray(data) ? data : []);
      } catch {
        // Campanha é opcional: se falhar, deixa só "Sem campanha"
        if (!cancelled) setCampaigns([]);
      }
    })();
    return () => { cancelled = true; };
  }, [deal]);

  // Itens adicionados aqui atualizam o valor total da venda automaticamente
  useEffect(() => {
    if (allItemsCount > 0) {
      setJobData(prev => ({ ...prev, amount: existingTotal + newItemsTotal }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingTotal, newItemsTotal, allItemsCount]);

  // Deriva o payment_status automaticamente do sinal
  const autoPaymentStatus = useMemo(() => {
    const total = jobData.amount || 0;
    if (sinalAmount <= 0) return "pending";
    if (sinalAmount >= total) return "paid";
    return "partial";
  }, [sinalAmount, jobData.amount]);

  // Sincroniza payment_status com o sinal
  useEffect(() => {
    setJobData(prev => ({ ...prev, payment_status: autoPaymentStatus }));
  }, [autoPaymentStatus]);

  if (!deal) return null;

  const preselectedClientId = preferredClientId !== undefined
    ? preferredClientId
    : deal.client_id ?? null;
  const hasPreselectedClient = preselectedClientId !== null;
  const selectedClient = selectedClientId
    ? clients.find(client => client.id === selectedClientId)
    : undefined;
  const closeModal = () => completionWarnings.length > 0 ? onConverted() : onClose();

  const toggleSection = (section: "client" | "job") => {
    setExpandedSections((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  const buildJobPayload = () => {
    if (!createJob) return undefined;
    const itemsNote = newItems.length
      ? `Itens do catálogo:\n${newItems.map(i => `- ${CATALOG_LABELS[i.catalog_type]}: ${i.catalog_name} (${i.quantidade}x R$ ${i.catalog_value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })})`).join('\n')}`
      : '';
    const paymentNote = sinalAmount > 0
      ? `Sinal pago: R$ ${sinalAmount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
      : '';
    return {
      ...jobData,
      payment_status: autoPaymentStatus,
      notes: [jobData.notes, itemsNote, paymentNote].filter(Boolean).join('\n').trim(),
    };
  };

  const requestConversion = (force: boolean, reusableJobId?: number) => authFetch(`/api/deals/${deal.id}/convert`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      existingClientId: conversionMode === "existing" ? selectedClientId : undefined,
      createClient: conversionMode === "new" && createClient,
      createJob,
      client: conversionMode === "new" && createClient ? clientData : undefined,
      job: buildJobPayload(),
      campaign_id: campaignId || undefined,
      sinalAmount: sinalAmount > 0 ? sinalAmount : undefined,
      converted_at: soldDate || undefined,
      ...(reusableJobId ? { existingJobId: reusableJobId } : {}),
      ...(force ? { force: true } : {}),
    }),
  });

  const readDuplicateWarning = async (response: Response): Promise<DuplicateWarning | null> => {
    if (response.status !== 409) return null;
    const duplicate = await response.clone().json().catch(() => null);
    if (duplicate?.error !== "duplicate_job") return null;
    return {
      message: duplicate.message || "Esta cliente já tem um ensaio semelhante em aberto.",
      existing: Array.isArray(duplicate.existing) ? duplicate.existing : [],
    };
  };

  const persistNewItems = async (): Promise<string[]> => {
    const results = await Promise.all(newItems.map(async item => {
      const warning = `O item "${item.catalog_name}" não entrou no pacote. Ele pode ser adicionado depois no Financeiro.`;
      try {
        const response = await authFetch(`/api/deals/${deal.id}/items`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(item),
        });
        return response.ok ? null : warning;
      } catch {
        return warning;
      }
    }));
    return results.filter((warning): warning is string => Boolean(warning));
  };

  const submit = async (force = false, reusableJobId?: number) => {
    setIsSubmitting(true);
    setSubmitError("");
    setDuplicateWarning(null);
    try {
      const response = await requestConversion(force, reusableJobId);
      const duplicate = await readDuplicateWarning(response);
      if (duplicate) {
        setDuplicateWarning(duplicate);
        return;
      }
      if (!response.ok) {
        const error = await response.json().catch(() => null);
        throw new Error(error?.message || error?.error || `Erro ao converter (HTTP ${response.status})`);
      }

      const conversion: { google_calendar_connected?: boolean | null } = await response.json().catch(() => ({}));
      setDuplicateWarning(null);
      const warnings = await persistNewItems();
      if (createJob && conversion.google_calendar_connected === false) {
        warnings.push("O Google Calendar não está conectado. O ensaio ficou somente na agenda do sistema.");
      }
      if (warnings.length > 0) {
        setCompletionWarnings(warnings);
        return;
      }
      onConverted();
    } catch (error) {
      console.error("Erro ao converter deal:", error);
      setSubmitError(`Não deu pra converter a venda: ${error instanceof Error ? error.message : "erro desconhecido"}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const inputClasses = "w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 outline-none focus:ring-2 focus:ring-emerald-500 dark:focus:ring-emerald-400 focus:border-transparent transition-colors";
  
  const selectClasses = "w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-emerald-500 dark:focus:ring-emerald-400 focus:border-transparent transition-colors";

  const labelClasses = "block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase mb-1";

  const howFoundOptions = [
    "Instagram",
    "Facebook", 
    "Google",
    "Indicação",
    "Site",
    "WhatsApp",
    "Outro",
  ];

  const brazilianStates = [
    "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA",
    "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN",
    "RS", "RO", "RR", "SC", "SP", "SE", "TO"
  ];

  // Tipos de ensaio: lista mestre configurável (Configurações → Oportunidades)
  const jobTypes = tiposComValorAtual(tiposEnsaio, jobData.job_type);

  const canSubmit = conversionMode === "existing" 
    ? selectedClientId !== null 
    : (createClient ? (clientData.name && clientData.phone) : true);

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[90] flex items-center justify-center p-4">
      <motion.div 
        initial={{ scale: 0.96, opacity: 0 }} 
        animate={{ scale: 1, opacity: 1 }} 
        className="w-full max-w-3xl overflow-hidden rounded-2xl border border-transparent bg-white shadow-2xl dark:border-gray-800 dark:bg-gray-900 dark:shadow-black/40"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 bg-emerald-50/70 p-4 dark:border-gray-800 dark:bg-emerald-950/30">
          <div>
            <p className="text-xs uppercase text-emerald-600 dark:text-emerald-400 font-semibold tracking-wide">
              🎉 Fechado Ganho
            </p>
            <h3 className="text-lg font-bold text-gray-900 dark:text-white">
              Converter "{deal.title}" em venda
            </h3>
            <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              Vincule a um cliente existente ou cadastre um novo
            </p>
          </div>
          <button
            onClick={closeModal}
            className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors p-1"
          >
            <Plus className="rotate-45" size={24} />
          </button>
        </div>

        {/* Content */}
        <div className="max-h-[72vh] space-y-3 overflow-y-auto p-4">
          
          {/* ====== MODO DE CONVERSÃO ====== */}
          {!hasPreselectedClient && (
          <div className="p-4 bg-gray-50 dark:bg-gray-800/50 rounded-xl space-y-3">
            <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase">
              Como deseja registrar este cliente?
            </label>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => {
                  setConversionMode("existing");
                  setCreateClient(false);
                }}
                className={`flex-1 p-3 rounded-xl border-2 transition-all flex items-center gap-2 ${
                  conversionMode === "existing"
                    ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300"
                    : "border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600"
                }`}
              >
                <Link2 size={18} />
                <div className="text-left">
                  <p className="font-semibold text-sm">Vincular a cliente existente</p>
                  <p className="text-xs opacity-70">Selecione da sua base</p>
                </div>
              </button>
              <button
                type="button"
                onClick={() => {
                  setConversionMode("new");
                  setCreateClient(true);
                }}
                className={`flex-1 p-3 rounded-xl border-2 transition-all flex items-center gap-2 ${
                  conversionMode === "new"
                    ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300"
                    : "border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600"
                }`}
              >
                <User size={18} />
                <div className="text-left">
                  <p className="font-semibold text-sm">Cadastrar novo cliente</p>
                  <p className="text-xs opacity-70">Preencha os dados abaixo</p>
                </div>
              </button>
            </div>
          </div>
          )}

          {/* ====== DATA DA VENDA (permite venda retroativa) ====== */}
          <div className="p-4 bg-gray-50 dark:bg-gray-800/50 rounded-xl flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <CalendarDays size={16} className="text-emerald-600 dark:text-emerald-400" />
              <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase">Data da venda</label>
            </div>
            <input
              type="date"
              value={soldDate}
              max={todayLocalISO()}
              onChange={(e) => setSoldDate(e.target.value)}
              className={`${inputClasses} !w-auto [color-scheme:light] dark:[color-scheme:dark]`}
            />
            <p className="text-[11px] text-gray-400 dark:text-gray-500">
              Venda fechada antes e não lançada? Escolha o dia real — os relatórios usam esta data.
            </p>
          </div>

          {/* ====== VENDA ESPECIAL / CAMPANHA (opcional) ====== */}
          <div className="p-4 bg-gray-50 dark:bg-gray-800/50 rounded-xl flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <Megaphone size={16} className="text-emerald-600 dark:text-emerald-400" />
              <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase">Venda especial / Campanha</label>
            </div>
            <select
              value={campaignId}
              onChange={(e) => setCampaignId(e.target.value)}
              className={`${selectClasses} !w-auto min-w-[14rem]`}
            >
              <option value="" className="bg-white dark:bg-gray-800">Sem campanha</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id} className="bg-white dark:bg-gray-800">
                  {c.name}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-gray-400 dark:text-gray-500">
              Vincule esta venda a uma campanha (Natal, Black Friday…) para acompanhar nos relatórios.
            </p>
          </div>

          {/* ====== ITENS DA VENDA (produtos/serviços/combos) ====== */}
          <div className="border border-gray-100 dark:border-gray-800 rounded-xl p-4 space-y-2">
            <label className={labelClasses}>
              <Package size={12} className="inline mr-1" />
              Itens da venda (produtos, serviços e combos)
            </label>

            {existingItems.length > 0 && (
              <div className="space-y-1.5">
                {existingItems.map((it: any) => (
                  <div key={it.id} className="flex items-center gap-2 px-2.5 py-2 bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-lg">
                    <span className="text-gray-400 flex-shrink-0">{CATALOG_ICONS[(it.catalog_type as CatalogType)] || <Package size={11} />}</span>
                    <span className="text-sm text-gray-800 dark:text-gray-100 flex-1 truncate">{it.catalog_name}</span>
                    <span className="text-xs text-gray-400">{Number(it.quantidade) || 1}x</span>
                    <span className="text-sm font-semibold text-gray-700 dark:text-gray-200 whitespace-nowrap">
                      R$ {((Number(it.catalog_value) || 0) * (Number(it.quantidade) || 1)).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                    </span>
                    <button
                      type="button"
                      title="Desvincular este item do negócio"
                      disabled={unlinkingId === it.id}
                      onClick={() => unlinkItem(it.id)}
                      className="p-1 text-gray-400 hover:text-red-600 disabled:opacity-40 flex-shrink-0"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {newItems.length > 0 && (
              <div className="space-y-1.5">
                {newItems.map((it, idx) => (
                  <div key={idx} className="flex items-center gap-2 px-2.5 py-2 bg-emerald-50/50 dark:bg-emerald-900/10 border border-emerald-200 dark:border-emerald-800 rounded-lg">
                    <span className="text-gray-400 flex-shrink-0">{CATALOG_ICONS[it.catalog_type]}</span>
                    <span className="text-sm text-gray-800 dark:text-gray-100 flex-1 truncate">{it.catalog_name}</span>
                    <input
                      type="number"
                      min={1}
                      value={it.quantidade}
                      onChange={(e) => {
                        const q = Math.max(1, Number(e.target.value) || 1);
                        setNewItems(prev => prev.map((p, i) => i === idx ? { ...p, quantidade: q } : p));
                      }}
                      className="w-12 text-xs text-center border border-gray-200 dark:border-gray-700 rounded bg-white dark:bg-gray-900 outline-none px-1 py-0.5"
                    />
                    <span className="text-sm font-semibold text-gray-700 dark:text-gray-200 whitespace-nowrap">
                      R$ {(it.catalog_value * it.quantidade).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                    </span>
                    <button
                      type="button"
                      onClick={() => setNewItems(prev => prev.filter((_, i) => i !== idx))}
                      className="p-1 text-gray-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 rounded transition-colors"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {!showAdder ? (
              <button
                type="button"
                onClick={() => setShowAdder(true)}
                className="w-full flex items-center justify-center gap-1.5 px-3 py-2 border border-dashed border-gray-300 dark:border-gray-600 hover:border-emerald-400 hover:bg-emerald-50/50 dark:hover:bg-emerald-900/10 rounded-lg text-sm text-gray-600 dark:text-gray-300 transition-colors"
              >
                <Plus size={13} />
                Adicionar produto, serviço ou combo
              </button>
            ) : (
              <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-2.5 space-y-2 bg-gray-50/50 dark:bg-gray-800/30">
                <div className="flex gap-1">
                  {(["combo", "produto", "servico"] as CatalogType[]).map(type => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setAdderType(type)}
                      className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                        adderType === type
                          ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm"
                          : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                      }`}
                    >
                      {CATALOG_ICONS[type]}
                      {CATALOG_LABELS[type]}
                    </button>
                  ))}
                </div>
                <div className="relative">
                  <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    value={adderSearch}
                    onChange={(e) => setAdderSearch(e.target.value)}
                    placeholder={`Buscar em ${CATALOG_LABELS[adderType].toLowerCase()}...`}
                    className="w-full pl-8 pr-2 py-1.5 text-xs border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-900 outline-none focus:border-emerald-400"
                    autoFocus
                  />
                </div>
                <div className="max-h-40 overflow-y-auto space-y-0.5">
                  {filteredCatalog.length === 0 ? (
                    <p className="text-xs text-gray-400 text-center py-3">Nenhum item ativo encontrado.</p>
                  ) : filteredCatalog.map(it => (
                    <button
                      key={it.id}
                      type="button"
                      onClick={() => {
                        setNewItems(prev => [...prev, {
                          catalog_type: adderType,
                          catalog_id: it.id,
                          catalog_name: it.nome,
                          catalog_value: it.value,
                          quantidade: 1,
                        }]);
                        setShowAdder(false);
                        setAdderSearch("");
                      }}
                      className="w-full flex items-center justify-between gap-2 px-2 py-1.5 text-xs hover:bg-white dark:hover:bg-gray-700 rounded transition-colors text-left"
                    >
                      <span className="text-gray-700 dark:text-gray-200 truncate">{it.nome}</span>
                      <span className="text-gray-500 dark:text-gray-400 font-semibold whitespace-nowrap">
                        R$ {it.value.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                      </span>
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => { setShowAdder(false); setAdderSearch(""); }}
                  className="w-full text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 py-1"
                >
                  Cancelar
                </button>
              </div>
            )}
          </div>

          {/* ====== RESUMO FINANCEIRO ====== */}
          {(() => {
            const total = jobData.amount || 0;
            const restante = Math.max(0, total - sinalAmount);
            const pct = total > 0 ? Math.min(100, (sinalAmount / total) * 100) : 0;
            const pctFormatted = pct.toFixed(0);
            const barColor = pct >= 100 ? 'bg-emerald-500' : pct >= 50 ? 'bg-amber-400' : 'bg-blue-400';
            return (
              <div className="border border-emerald-200 dark:border-emerald-800 rounded-xl overflow-hidden">
                <div className="bg-emerald-50 dark:bg-emerald-950/30 px-4 py-3 flex items-center gap-2 border-b border-emerald-100 dark:border-emerald-800">
                  <DollarSign size={14} className="text-emerald-600 dark:text-emerald-400" />
                  <span className="text-xs font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wide">Resumo Financeiro</span>
                  {deal?.items && deal.items.length > 0 && (
                    <span className="ml-auto text-[10px] text-emerald-600 dark:text-emerald-500 font-medium">
                      {deal.items.length} {deal.items.length === 1 ? 'item' : 'itens'} vinculados
                    </span>
                  )}
                </div>
                <div className="p-4 space-y-4 bg-white dark:bg-gray-900">
                  {/* Linha: Total / Sinal / Restante */}
                  <div className="grid grid-cols-3 gap-3">
                    <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-3">
                      <p className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase mb-1">Valor Total</p>
                      <p className="text-base font-bold text-gray-900 dark:text-white">
                        R$ {total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                      </p>
                    </div>
                    <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-3 border border-blue-100 dark:border-blue-800">
                      <p className="text-[10px] font-semibold text-blue-500 dark:text-blue-400 uppercase mb-1">Sinal Pago</p>
                      <input
                        type="number"
                        min={0}
                        max={total}
                        step={0.01}
                        value={sinalAmount || ""}
                        onChange={e => setSinalAmount(parseFloat(e.target.value) || 0)}
                        placeholder="0,00"
                        className="w-full bg-transparent text-base font-bold text-blue-700 dark:text-blue-300 outline-none placeholder-blue-300 dark:placeholder-blue-700 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      />
                    </div>
                    <div className={`rounded-xl p-3 ${restante === 0 && total > 0 ? 'bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-800' : 'bg-orange-50 dark:bg-orange-900/20 border border-orange-100 dark:border-orange-800'}`}>
                      <p className={`text-[10px] font-semibold uppercase mb-1 ${restante === 0 && total > 0 ? 'text-emerald-500' : 'text-orange-500'}`}>Restante</p>
                      <p className={`text-base font-bold ${restante === 0 && total > 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-orange-700 dark:text-orange-300'}`}>
                        R$ {restante.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                      </p>
                    </div>
                  </div>

                  {/* Barra de progresso */}
                  {total > 0 && (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-gray-400 dark:text-gray-500">Progresso do pagamento</span>
                        <span className={`font-bold ${pct >= 100 ? 'text-emerald-600 dark:text-emerald-400' : pct >= 50 ? 'text-amber-600 dark:text-amber-400' : 'text-blue-600 dark:text-blue-400'}`}>
                          {pctFormatted}% pago
                        </span>
                      </div>
                      <div className="h-2.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-300 ${barColor}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <p className="text-[11px] text-gray-400 dark:text-gray-500 text-center">
                        {pct >= 100
                          ? '✓ Pagamento completo'
                          : sinalAmount > 0
                          ? `Falta R$ ${restante.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} para quitação`
                          : 'Nenhum sinal registrado'}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {/* ====== SELECIONAR CLIENTE EXISTENTE ====== */}
          {conversionMode === "existing" && (
            <div className="border border-gray-100 dark:border-gray-800 rounded-xl p-4 bg-blue-50/30 dark:bg-blue-950/10">
              {hasPreselectedClient && !showClientPicker ? (
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-blue-500 dark:text-blue-400">Cliente já vinculado</p>
                    <p className="mt-0.5 truncate text-sm font-semibold text-gray-900 dark:text-white">
                      {selectedClient?.name || deal.contact_name || deal.client_name || `Cliente #${selectedClientId}`}
                    </p>
                    {selectedClient?.phone && <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{selectedClient.phone}</p>}
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowClientPicker(true)}
                    className="rounded-lg border border-blue-200 px-2.5 py-1.5 text-xs font-semibold text-blue-600 transition-colors hover:bg-blue-50 dark:border-blue-800 dark:text-blue-300 dark:hover:bg-blue-950/30"
                  >
                    Trocar
                  </button>
                </div>
              ) : (
                <>
                  <label className={labelClasses}>
                    <Link2 size={12} className="inline mr-1" />
                    Selecione o Cliente
                  </label>
                  <SearchableSelect
                    value={selectedClientId ? String(selectedClientId) : ""}
                    onChange={(v) => {
                      setSelectedClientId(v ? Number(v) : null);
                      if (v) setShowClientPicker(false);
                    }}
                    showSearchIcon
                    placeholder="Buscar cliente..."
                    searchPlaceholder="Nome, telefone ou e-mail..."
                    emptyMessage="Nenhum cliente encontrado"
                    triggerClassName="py-2"
                    options={[
                      { value: "", label: "-- Selecione um cliente --" },
                      ...clients.map((client) => ({
                        value: String(client.id),
                        label: `${client.name}${client.phone ? ` - ${client.phone}` : ""}${client.email ? ` (${client.email})` : ""}`,
                      })),
                    ]}
                  />
                </>
              )}
            </div>
          )}

          {/* Checkbox criar trabalho */}
          <div className="flex items-center p-4 bg-gray-50 dark:bg-gray-800/50 rounded-xl">
            <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-300 cursor-pointer select-none">
              <input 
                type="checkbox" 
                checked={createJob} 
                onChange={(e) => setCreateJob(e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-emerald-600 focus:ring-emerald-500 dark:focus:ring-emerald-400 bg-white dark:bg-gray-800"
              />
              <Briefcase size={16} className="text-purple-500" />
              Criar trabalho/ensaio junto
            </label>
          </div>

          {/* ==================== SEÇÃO CLIENTE (só se for novo) ==================== */}
          {conversionMode === "new" && createClient && (
            <div className="border border-gray-100 dark:border-gray-800 rounded-xl overflow-hidden">
              {/* Section Header */}
              <button
                type="button"
                onClick={() => toggleSection("client")}
                className="w-full flex items-center justify-between p-4 bg-blue-50/50 dark:bg-blue-950/20 hover:bg-blue-50 dark:hover:bg-blue-950/30 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-900/50 flex items-center justify-center">
                    <User size={16} className="text-blue-600 dark:text-blue-400" />
                  </div>
                  <span className="font-semibold text-gray-900 dark:text-white">Dados do Novo Cliente</span>
                  <span className="text-xs text-gray-400 dark:text-gray-500">• campos com * são obrigatórios</span>
                </div>
                {expandedSections.client ? (
                  <ChevronUp size={18} className="text-gray-400" />
                ) : (
                  <ChevronDown size={18} className="text-gray-400" />
                )}
              </button>

              {expandedSections.client && (
                <div className="p-4 space-y-4 bg-gray-50/50 dark:bg-gray-800/30">
                  {/* Linha 1: Nome, Telefone, Email */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className={labelClasses}>Nome *</label>
                      <input
                        value={clientData.name}
                        onChange={(e) => setClientData((p) => ({ ...p, name: e.target.value }))}
                        className={inputClasses}
                        placeholder="Nome completo"
                      />
                    </div>
                    <div>
                      <label className={labelClasses}>Telefone *</label>
                      <input
                        value={clientData.phone}
                        onChange={(e) => setClientData((p) => ({ ...p, phone: e.target.value }))}
                        className={inputClasses}
                        placeholder="(00) 00000-0000"
                      />
                    </div>
                    <div>
                      <label className={labelClasses}>Email <span className="text-gold-600 dark:text-gold-400 font-normal">— recebe o convite da agenda</span></label>
                      <input
                        type="email"
                        value={clientData.email}
                        onChange={(e) => setClientData((p) => ({ ...p, email: e.target.value }))}
                        className={inputClasses}
                        placeholder="email@exemplo.com"
                      />
                      <p className="mt-1 text-[11px] text-gray-400 dark:text-gray-500">
                        {clientData.email?.trim()
                          ? <>O cliente recebe o convite do ensaio em <span className="font-medium text-gray-500 dark:text-gray-300">{clientData.email.trim()}</span>.</>
                          : 'Sem e-mail, o evento é criado na agenda mas o cliente não recebe o convite.'}
                      </p>
                    </div>
                  </div>

                  {/* Linha 2: CPF/CNPJ, Data de Nascimento, Instagram */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className={labelClasses}>CPF/CNPJ</label>
                      <input
                        value={clientData.document}
                        onChange={(e) => setClientData((p) => ({ ...p, document: e.target.value }))}
                        className={inputClasses}
                        placeholder="000.000.000-00"
                      />
                    </div>
                    <div>
                      <label className={labelClasses}>Data de Nascimento</label>
                      <input
                        type="date"
                        value={clientData.birth_date}
                        onChange={(e) => setClientData((p) => ({ ...p, birth_date: e.target.value }))}
                        className={`${inputClasses} [color-scheme:light] dark:[color-scheme:dark]`}
                      />
                    </div>
                    <div>
                      <label className={labelClasses}>Instagram</label>
                      <input
                        value={clientData.instagram}
                        onChange={(e) => setClientData((p) => ({ ...p, instagram: e.target.value }))}
                        className={inputClasses}
                        placeholder="@usuario"
                      />
                    </div>
                  </div>

                  {/* Linha 3: Endereço (rua + número) */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="md:col-span-2">
                      <label className={labelClasses}>Endereço</label>
                      <input
                        value={clientData.address}
                        onChange={(e) => setClientData((p) => ({ ...p, address: e.target.value }))}
                        className={inputClasses}
                        placeholder="Rua / Avenida"
                      />
                    </div>
                    <div>
                      <label className={labelClasses}>Número</label>
                      <input
                        value={clientData.address_number}
                        onChange={(e) => setClientData((p) => ({ ...p, address_number: e.target.value }))}
                        className={inputClasses}
                        placeholder="Nº"
                      />
                    </div>
                  </div>

                  {/* Linha 3b: Complemento + Bairro */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className={labelClasses}>Complemento</label>
                      <input
                        value={clientData.address_complement}
                        onChange={(e) => setClientData((p) => ({ ...p, address_complement: e.target.value }))}
                        className={inputClasses}
                        placeholder="Apto, bloco..."
                      />
                    </div>
                    <div>
                      <label className={labelClasses}>Bairro</label>
                      <input
                        value={clientData.neighborhood}
                        onChange={(e) => setClientData((p) => ({ ...p, neighborhood: e.target.value }))}
                        className={inputClasses}
                        placeholder="Bairro"
                      />
                    </div>
                  </div>

                  {/* Linha 4: Cidade, Estado, CEP */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className={labelClasses}>Cidade</label>
                      <input
                        value={clientData.city}
                        onChange={(e) => setClientData((p) => ({ ...p, city: e.target.value }))}
                        className={inputClasses}
                        placeholder="Cidade"
                      />
                    </div>
                    <div>
                      <label className={labelClasses}>Estado</label>
                      <select
                        value={clientData.state}
                        onChange={(e) => setClientData((p) => ({ ...p, state: e.target.value }))}
                        className={selectClasses}
                      >
                        <option value="" className="bg-white dark:bg-gray-800">Selecione</option>
                        {brazilianStates.map((state) => (
                          <option key={state} value={state} className="bg-white dark:bg-gray-800">
                            {state}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className={labelClasses}>CEP</label>
                      <input
                        value={clientData.zip_code}
                        onChange={(e) => setClientData((p) => ({ ...p, zip_code: e.target.value }))}
                        className={inputClasses}
                        placeholder="00000-000"
                      />
                    </div>
                  </div>

                  {/* Linha 5: Como conheceu */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className={labelClasses}>Como conheceu</label>
                      <select
                        value={clientData.how_found}
                        onChange={(e) => setClientData((p) => ({ ...p, how_found: e.target.value }))}
                        className={selectClasses}
                      >
                        <option value="" className="bg-white dark:bg-gray-800">Selecione</option>
                        {howFoundOptions.map((opt) => (
                          <option key={opt} value={opt} className="bg-white dark:bg-gray-800">
                            {opt}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Linha 6: Observações do cliente */}
                  <div>
                    <label className={labelClasses}>Observações do Cliente</label>
                    <textarea
                      value={clientData.notes}
                      onChange={(e) => setClientData((p) => ({ ...p, notes: e.target.value }))}
                      className={`${inputClasses} resize-none`}
                      rows={2}
                      placeholder="Informações adicionais sobre o cliente..."
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ==================== SEÇÃO JOB ==================== */}
          {createJob && (
            <div className="border border-gray-100 dark:border-gray-800 rounded-xl overflow-hidden">
              {/* Section Header */}
              <button
                type="button"
                onClick={() => toggleSection("job")}
                className="w-full flex items-center justify-between p-4 bg-purple-50/50 dark:bg-purple-950/20 hover:bg-purple-50 dark:hover:bg-purple-950/30 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-purple-100 dark:bg-purple-900/50 flex items-center justify-center">
                    <Briefcase size={16} className="text-purple-600 dark:text-purple-400" />
                  </div>
                  <span className="font-semibold text-gray-900 dark:text-white">Dados do Trabalho</span>
                </div>
                {expandedSections.job ? (
                  <ChevronUp size={18} className="text-gray-400" />
                ) : (
                  <ChevronDown size={18} className="text-gray-400" />
                )}
              </button>

              {expandedSections.job && (
                <div className="p-4 space-y-4 bg-gray-50/50 dark:bg-gray-800/30">
                  {/* Aviso: a data/hora agendam na Agenda e mandam o convite */}
                  <div className="flex items-start gap-2 rounded-lg bg-purple-50/70 dark:bg-purple-950/20 border border-purple-100 dark:border-purple-900/30 px-3 py-2 text-[12px] text-purple-700 dark:text-purple-300">
                    <CalendarDays size={15} className="mt-0.5 flex-shrink-0" />
                    <span>A <strong>Data</strong> e o <strong>Início</strong> abaixo agendam o ensaio na sua <strong>Agenda (Google)</strong> e enviam o convite pro e-mail do cliente. Sem Google conectado, fica só registrado aqui.</span>
                  </div>
                  {/* Linha 1: Tipo, Data, Horários */}
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div>
                      <label className={labelClasses}>Tipo *</label>
                      <select
                        value={jobData.job_type}
                        onChange={(e) => {
                          setJobTypeTouched(true);
                          setJobData((p) => ({ ...p, job_type: e.target.value }));
                        }}
                        className={selectClasses}
                      >
                        {jobTypes.map((type) => (
                          <option key={type} value={type} className="bg-white dark:bg-gray-800">
                            {type}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className={labelClasses}>Data *</label>
                      <input
                        type="date"
                        value={jobData.job_date}
                        onChange={(e) => setJobData((p) => ({ ...p, job_date: e.target.value }))}
                        className={`${inputClasses} [color-scheme:light] dark:[color-scheme:dark]`}
                      />
                    </div>
                    <div>
                      <label className={labelClasses}>Início</label>
                      <input
                        type="time"
                        value={jobData.job_time}
                        onChange={(e) => setJobData((p) => ({ ...p, job_time: e.target.value }))}
                        className={`${inputClasses} [color-scheme:light] dark:[color-scheme:dark]`}
                      />
                    </div>
                    <div>
                      <label className={labelClasses}>Término</label>
                      <input
                        type="time"
                        value={jobData.job_end_time}
                        onChange={(e) => setJobData((p) => ({ ...p, job_end_time: e.target.value }))}
                        className={`${inputClasses} [color-scheme:light] dark:[color-scheme:dark]`}
                      />
                    </div>
                  </div>

                  {/* Linha 2: Local do ensaio */}
                  <div>
                    <label className={labelClasses}>Local do Ensaio</label>
                    <input
                      value={jobData.location}
                      onChange={(e) => setJobData((p) => ({ ...p, location: e.target.value }))}
                      className={inputClasses}
                      placeholder="Endereço ou nome do local"
                    />
                  </div>

                  {/* Linha 3: Valor, Forma de pagamento, Status pagamento */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className={labelClasses}>Valor Total *</label>
                      <input
                        type="number"
                        value={jobData.amount}
                        onChange={(e) => setJobData((p) => ({ ...p, amount: Number(e.target.value) }))}
                        className={`${inputClasses} [color-scheme:light] dark:[color-scheme:dark]`}
                        placeholder="0,00"
                      />
                    </div>
                    <div>
                      <label className={labelClasses}>Forma de Pagamento</label>
                      <select
                        value={jobData.payment_method}
                        onChange={(e) => setJobData((p) => ({ ...p, payment_method: e.target.value }))}
                        className={selectClasses}
                      >
                        <option className="bg-white dark:bg-gray-800">Pix</option>
                        <option className="bg-white dark:bg-gray-800">Cartão de Crédito</option>
                        <option className="bg-white dark:bg-gray-800">Cartão de Débito</option>
                        <option className="bg-white dark:bg-gray-800">Dinheiro</option>
                        <option className="bg-white dark:bg-gray-800">Boleto</option>
                        <option className="bg-white dark:bg-gray-800">Transferência</option>
                      </select>
                    </div>
                    <div>
                      <label className={labelClasses}>Status do Pagamento</label>
                      <div className={`px-3 py-2 rounded-lg text-sm font-semibold border ${
                        autoPaymentStatus === 'paid'
                          ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
                          : autoPaymentStatus === 'partial'
                          ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800'
                          : 'bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-700'
                      }`}>
                        {autoPaymentStatus === 'paid' ? '✓ Pago' : autoPaymentStatus === 'partial' ? '◑ Parcial' : '○ Pendente'}
                        <p className="text-[10px] font-normal opacity-70 mt-0.5">Calculado pelo sinal</p>
                      </div>
                    </div>
                  </div>

                  {/* Linha 4: Status do trabalho */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className={labelClasses}>Status do Trabalho</label>
                      <select
                        value={jobData.status}
                        onChange={(e) => setJobData((p) => ({ ...p, status: e.target.value }))}
                        className={selectClasses}
                      >
                        <option value="scheduled" className="bg-white dark:bg-gray-800">Agendado</option>
                        <option value="in_progress" className="bg-white dark:bg-gray-800">Em Andamento</option>
                        <option value="editing" className="bg-white dark:bg-gray-800">Em Edição</option>
                        <option value="completed" className="bg-white dark:bg-gray-800">Concluído</option>
                        <option value="delivered" className="bg-white dark:bg-gray-800">Entregue</option>
                        <option value="cancelled" className="bg-white dark:bg-gray-800">Cancelado</option>
                      </select>
                    </div>
                  </div>

                  {/* Linha 5: Notas do trabalho */}
                  <div>
                    <label className={labelClasses}>Observações do Trabalho</label>
                    <textarea
                      value={jobData.notes}
                      onChange={(e) => setJobData((p) => ({ ...p, notes: e.target.value }))}
                      className={`${inputClasses} resize-none`}
                      rows={2}
                      placeholder="Detalhes sobre o ensaio, preferências, etc..."
                    />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="border-t border-gray-100 bg-gray-50/50 p-4 dark:border-gray-800 dark:bg-gray-800/30">
          {completionWarnings.length > 0 ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-800 dark:bg-emerald-950/25">
              <h4 className="text-sm font-bold text-emerald-900 dark:text-emerald-100">Venda convertida</h4>
              <p className="mt-1 text-xs text-emerald-800 dark:text-emerald-200">A conversão foi concluída, com estes avisos:</p>
              <ul className="mt-2 space-y-1 text-xs text-amber-700 dark:text-amber-300">
                {completionWarnings.map(warning => <li key={warning}>• {warning}</li>)}
              </ul>
              <div className="mt-3 flex justify-end">
                <button
                  type="button"
                  onClick={onConverted}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-emerald-700"
                >
                  Concluir
                </button>
              </div>
            </div>
          ) : duplicateWarning ? (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/25">
              <div className="flex items-start gap-3">
                <AlertTriangle size={19} className="mt-0.5 flex-shrink-0 text-amber-600 dark:text-amber-400" />
                <div className="min-w-0 flex-1">
                  <h4 className="text-sm font-bold text-amber-900 dark:text-amber-100">Ensaio semelhante já existente</h4>
                  <p className="mt-1 text-xs text-amber-800 dark:text-amber-200">{duplicateWarning.message}</p>
                  <div className="mt-2 space-y-1">
                    {duplicateWarning.existing.map(job => (
                      <div key={job.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-white/70 px-2.5 py-1.5 text-xs text-gray-700 dark:bg-black/15 dark:text-gray-200">
                        <div className="min-w-0 flex-1">
                          <span className="font-semibold">{job.job_name || job.job_type}</span>
                          <span className="ml-2 text-gray-400">{formatDuplicateDate(job.job_date)}</span>
                          {job.in_production && <span className="ml-2 font-semibold text-purple-600 dark:text-purple-300">Em produção</span>}
                        </div>
                        {job.can_reuse !== false && (
                          <button
                            type="button"
                            onClick={() => submit(false, job.id)}
                            disabled={isSubmitting}
                            className="rounded-md bg-emerald-600 px-2.5 py-1.5 font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
                          >
                            {isSubmitting ? "Vinculando..." : "Usar este ensaio"}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-300">
                    Se for o mesmo ensaio, use-o acima: o card sai de Vendas e o trabalho continua na Produção sem duplicar.
                  </p>
                </div>
              </div>
              <div className="mt-3 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={closeModal}
                  disabled={isSubmitting}
                  className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs font-semibold text-amber-900 transition-colors hover:bg-amber-100 disabled:opacity-50 dark:border-amber-800 dark:bg-gray-900 dark:text-amber-100 dark:hover:bg-amber-950/40"
                >
                  Voltar
                </button>
                <button
                  type="button"
                  onClick={() => submit(true)}
                  disabled={isSubmitting}
                  className="flex items-center gap-2 rounded-lg bg-amber-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-amber-700 disabled:opacity-50"
                >
                  {isSubmitting ? "Convertendo..." : "É outra venda: criar novo"}
                </button>
              </div>
            </div>
          ) : (
            <>
              {submitError && (
                <div role="alert" className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700 dark:border-red-800 dark:bg-red-950/25 dark:text-red-300">
                  {submitError}
                </div>
              )}
              <div className="flex items-center justify-between">
                <p className="text-xs text-gray-400 dark:text-gray-500">
                  {conversionMode === "existing" && selectedClientId && `Venda vinculada a ${selectedClient?.name || "cliente selecionado"}`}
                  {conversionMode === "existing" && !selectedClientId && "Selecione um cliente para continuar"}
                  {conversionMode === "new" && createClient && createJob && "Novo cliente e trabalho serão criados"}
                  {conversionMode === "new" && createClient && !createJob && "Apenas o novo cliente será cadastrado"}
                  {conversionMode === "new" && !createClient && createJob && "Apenas o trabalho será criado"}
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={closeModal}
                    disabled={isSubmitting}
                    className="rounded-lg border border-gray-200 px-4 py-2 text-xs font-semibold text-gray-700 transition-colors hover:bg-gray-100 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={() => submit()}
                    disabled={!canSubmit || isSubmitting}
                    className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-emerald-500 dark:hover:bg-emerald-600"
                  >
                    {isSubmitting ? "Convertendo..." : <><CheckIcon /> Converter e salvar</>}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
}

function CheckIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
    </svg>
  );
}

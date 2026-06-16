import React, { useEffect, useRef, useState } from "react";
import {
  X, User, Phone, Mail, Instagram, MapPin, Calendar,
  CheckSquare, Square, Trash2, Plus, Image, Images, Clock,
  ChevronRight, Tag, FileText, LogOut, Workflow, Check,
  DollarSign, Package, Layers, Briefcase, Search, CreditCard,
  Pencil, RefreshCw
} from "lucide-react";
import { SearchableSelect } from "../ui/SearchableSelect";
import { ContractGenerator } from "../contracts/ContractGenerator";
import { TemplatePickerModal } from "../contracts/TemplatePickerModal";
import { authFetch } from "../../utils/authFetch";
import { useAuth } from "../../contexts/AuthContext";
import { useApi } from "../../utils/useApi";
import { parseDate } from "../../utils/date";
import { cn } from "../../utils/cn";
import { ContractTemplate } from "../../types";
import { buildContractDataFromTemplate } from "../../utils/contractTemplate";
import { JobWithProduction } from "./ProductionBoard";

function ContractStatusPill({ status, signers }: { status: 'draft' | 'pending_signature' | 'signed' | 'cancelled'; signers?: Array<{ status: string }> }) {
  const map = {
    draft: { label: 'Rascunho', cls: 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300' },
    pending_signature: { label: 'Aguardando', cls: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400' },
    signed: { label: 'Assinado', cls: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400' },
    cancelled: { label: 'Cancelado', cls: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400' },
  } as const;
  const it = map[status];
  const signed = (signers || []).filter(s => s.status === 'signed').length;
  const total = (signers || []).length;
  return (
    <span className={cn('ml-1 inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-bold', it.cls)}>
      {it.label}
      {status === 'pending_signature' && total > 0 && ` ${signed}/${total}`}
    </span>
  );
}

const LABEL_COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#eab308',
  '#84cc16', '#22c55e', '#10b981', '#14b8a6',
  '#06b6d4', '#0ea5e9', '#3b82f6', '#6366f1',
  '#8b5cf6', '#a855f7', '#ec4899', '#f43f5e',
];
function getLabelColor(label: string) {
  let hash = 0;
  for (let i = 0; i < label.length; i++) hash = label.charCodeAt(i) + ((hash << 5) - hash);
  return LABEL_COLORS[Math.abs(hash) % LABEL_COLORS.length];
}

interface ChecklistItem {
  id: number;
  text: string;
  done: boolean;
}

interface Testimonial {
  id: number;
  photo_data: string;
  caption: string;
  created_at: string;
}

interface StageHistory {
  stage_id: string;
  stage_name: string;
  entered_at: string;
  exited_at: string | null;
  duration_ms: number | null;
  is_current: boolean;
}

interface ClientDetail {
  name: string;
  phone: string;
  email: string;
  instagram: string;
  city: string;
  state: string;
  notes: string;
}

interface JobPayment {
  id: string;
  amount: number;
  description: string | null;
  payment_date: string;
  payment_method: string;
}

interface CatalogItem {
  id: string;
  catalog_type: 'combo' | 'produto' | 'servico';
  catalog_id: string;
  catalog_name: string;
  catalog_value: number;
  quantidade: number;
  discount_value?: number;
}

const CATALOG_CFG = {
  combo:   { icon: <Layers size={12} />,   color: 'text-amber-600 dark:text-amber-400',   bg: 'bg-amber-50 dark:bg-amber-900/20',   border: 'border-amber-200 dark:border-amber-700' },
  produto: { icon: <Package size={12} />,  color: 'text-blue-600 dark:text-blue-400',     bg: 'bg-blue-50 dark:bg-blue-900/20',     border: 'border-blue-200 dark:border-blue-700' },
  servico: { icon: <Briefcase size={12} />, color: 'text-purple-600 dark:text-purple-400', bg: 'bg-purple-50 dark:bg-purple-900/20', border: 'border-purple-200 dark:border-purple-700' },
} as const;

interface JobDetailDrawerProps {
  job: JobWithProduction | null;
  stages: { id: string; name: string }[];
  onClose: () => void;
  onStageChange: (jobId: number, stageId: string) => void;
  onLabelsChange?: (jobId: number, labels: string[]) => void;
  onRemoveFromProduction?: (jobId: number) => void;
  onJobUpdate?: (jobId: number, patch: Partial<JobWithProduction>) => void;
}

const formatCurrency = (v: number) =>
  (v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 0 });

const formatDuration = (ms: number | null | undefined) => {
  if (ms == null) return "-";
  const totalMinutes = Math.floor(ms / 60_000);
  if (totalMinutes < 1) return "< 1min";
  if (totalMinutes < 60) return `${totalMinutes}min`;
  const hours = Math.floor(totalMinutes / 60);
  const remMins = totalMinutes % 60;
  if (hours < 24) return remMins > 0 ? `${hours}h ${remMins}min` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
};

export function JobDetailDrawer({ job, stages, onClose, onStageChange, onLabelsChange, onRemoveFromProduction, onJobUpdate }: JobDetailDrawerProps) {
  const { isProductionOnly } = useAuth();
  const [tab, setTab] = useState<"details" | "financeiro" | "testimonials">("details");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [client, setClient] = useState<ClientDetail | null>(null);
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [testimonials, setTestimonials] = useState<Testimonial[]>([]);
  const [stageHistory, setStageHistory] = useState<StageHistory[]>([]);
  const [newItem, setNewItem] = useState("");
  const [newCaption, setNewCaption] = useState("");
  const [loadingClient, setLoadingClient] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [labels, setLabels] = useState<string[]>([]);
  const [labelMenuOpen, setLabelMenuOpen] = useState(false);
  const labelMenuRef = useRef<HTMLDivElement>(null);
  const [editingLabelId, setEditingLabelId] = useState<string | null>(null);
  const [editLabelName, setEditLabelName] = useState("");
  const [editLabelColor, setEditLabelColor] = useState("#6366f1");
  const [labelPalette, setLabelPalette] = useState<{ id: string; name: string; color: string }[]>([]);
  const [newLabelName, setNewLabelName] = useState("");
  const [newLabelColor, setNewLabelColor] = useState("#6366f1");
  const [contractId, setContractId] = useState<number | null>(null);
  const [creatingContract, setCreatingContract] = useState(false);
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [jobContract, setJobContract] = useState<{ id: number; status: 'draft' | 'pending_signature' | 'signed' | 'cancelled'; signers?: Array<{ status: string }> } | null>(null);

  // Carrega a paleta de etiquetas da Produção (etiquetas padronizadas).
  useEffect(() => {
    authFetch('/api/jobs/labels')
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setLabelPalette(Array.isArray(d) ? d : []))
      .catch(() => {});
  }, []);

  // Fecha o menu de etiquetas ao clicar fora dele.
  useEffect(() => {
    if (!labelMenuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (labelMenuRef.current && !labelMenuRef.current.contains(e.target as Node)) {
        setLabelMenuOpen(false);
        setEditingLabelId(null);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [labelMenuOpen]);

  // Load existing contract for this job (if any) so we can show status + reuse instead of duplicating.
  useEffect(() => {
    if (!job || isProductionOnly) {
      setJobContract(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await authFetch(`/api/contracts?job_id=${job.id}`);
        if (!res.ok) return;
        const list = await res.json();
        if (cancelled) return;
        // Pick the most recent non-cancelled contract for this job
        const active = (list || []).find((c: any) => c.status !== 'cancelled') || null;
        setJobContract(active);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [job?.id, contractId]);

  const handleOpenContract = () => {
    if (!job) return;
    if (jobContract) {
      // Reuse existing contract
      setContractId(jobContract.id);
      return;
    }
    if (!job.client_id) {
      alert("Este trabalho não tem um cliente vinculado.");
      return;
    }
    setTemplatePickerOpen(true);
  };

  const createContractWithTemplate = async (template: ContractTemplate | null, sundaySession: boolean, surcharge?: number) => {
    if (!job?.client_id) return;
    setCreatingContract(true);
    setTemplatePickerOpen(false);
    try {
      // Busca o cliente completo pra preencher endereço/CPF/etc
      const clientRes = await authFetch(`/api/clients/${job.client_id}`);
      const client = clientRes.ok ? await clientRes.json() : null;

      const jobAsRow: any = {
        ...job,
        amount: job.amount,
      };

      const contract_data = buildContractDataFromTemplate(client, jobAsRow, template, { sundaySession, surcharge });

      const payload: any = {
        client_id: job.client_id,
        job_id: job.id,
        status: "draft",
        contract_data,
      };
      if (template) payload.template_id = template.id;

      const res = await authFetch("/api/contracts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert("Erro ao criar contrato: " + (err.error || res.statusText));
        return;
      }
      const created = await res.json();
      setContractId(created.id);
    } finally {
      setCreatingContract(false);
    }
  };

  // ── Financeiro ──
  const [dealItems, setDealItems] = useState<CatalogItem[]>([]);
  const [packageItem, setPackageItem] = useState<{ name: string; value: number; discount: number; source: 'deal' | 'job' } | null>(null);
  const [jobItems, setJobItems] = useState<CatalogItem[]>([]);
  const [payments, setPayments] = useState<JobPayment[]>([]);
  const [jobAmount, setJobAmount] = useState(0);
  const [loadingFin, setLoadingFin] = useState(false);
  // Adicionar pagamento
  const [newPayment, setNewPayment] = useState({ amount: '', discount: '', description: '', payment_date: new Date().toISOString().slice(0, 10), payment_method: 'Pix' });
  const [savingPayment, setSavingPayment] = useState(false);
  // Adicionar item ao job
  const [showAddJobItem, setShowAddJobItem] = useState(false);
  const [jobItemType, setJobItemType] = useState<'combo' | 'produto' | 'servico'>('servico');
  const [jobItemSearch, setJobItemSearch] = useState('');
  const [jobItemOpen, setJobItemOpen] = useState(false);
  const [jobItemQty, setJobItemQty] = useState(1);
  // Pro seletor de catálogo: define se o item escolhido vai pro pacote (deal) ou adicionais (job)
  const [addTarget, setAddTarget] = useState<'job' | 'deal'>('job');
  // Catálogos via SWR - cache compartilhado entre JobDetailDrawer, DealDetailDrawer e NewDealModal
  const { data: catalogProdutosData } = useApi<any[]>("/api/produtos");
  const { data: catalogServicosData } = useApi<any[]>("/api/servicos");
  const { data: catalogCombosData } = useApi<any[]>("/api/combos");
  const catalogProdutos = catalogProdutosData || [];
  const catalogServicos = catalogServicosData || [];
  const catalogCombos = catalogCombosData || [];
  const jobItemRef = useRef<HTMLDivElement>(null);

  const loadFinanceiro = async (jobId: number) => {
    setLoadingFin(true);
    try {
      const res = await authFetch(`/api/jobs/${jobId}/financeiro`);
      if (res.ok) {
        const data = await res.json();
        setDealItems(data.dealItems || []);
        setPackageItem(data.packageItem || null);
        setJobItems(data.jobItems || []);
        setPayments(data.payments || []);
        setJobAmount(data.jobAmount || 0);
        // Propaga correções de amount/payment_status/amount_paid para o card no board
        if (onJobUpdate && (data.jobAmount != null || data.payment_status)) {
          onJobUpdate(jobId, {
            amount: data.jobAmount,
            payment_status: data.payment_status,
            amount_paid: data.totalPago,
          });
        }
      }
    } catch { }
    finally { setLoadingFin(false); }
  };

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (jobItemRef.current && !jobItemRef.current.contains(e.target as Node)) {
        setJobItemOpen(false);
        setJobItemSearch('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    if (!job) return;
    setTab("details");
    setClient(null);
    setChecklist([]);
    setTestimonials([]);
    setStageHistory([]);
    setLabels(job.labels || []);
    setDealItems([]); setJobItems([]); setPayments([]);
    setShowAddJobItem(false); setJobItemQty(1);

    // Papel de produção não acessa /api/clients (bloqueado no backend). O nome do
    // cliente já vem em job.client_name — não buscamos o detalhe.
    if (job.client_id && !isProductionOnly) {
      setLoadingClient(true);
      authFetch(`/api/clients/${job.client_id}`)
        .then(r => r.ok ? r.json() : null)
        .then(data => setClient(data))
        .catch(() => {})
        .finally(() => setLoadingClient(false));
    }

    authFetch(`/api/jobs/${job.id}/checklist`)
      .then(r => r.ok ? r.json() : [])
      .then(setChecklist)
      .catch(() => {});

    authFetch(`/api/jobs/${job.id}/testimonials`)
      .then(r => r.ok ? r.json() : [])
      .then(setTestimonials)
      .catch(() => {});

    if (!isProductionOnly) loadFinanceiro(job.id);

    authFetch(`/api/jobs/${job.id}/stage-history`)
      .then(r => r.ok ? r.json() : [])
      .then((data: any[]) => {
        // Sort by entered_at ascending to ensure correct sequence
        const sorted = [...data].sort((a, b) =>
          new Date(a.entered_at).getTime() - new Date(b.entered_at).getTime()
        );
        const now = Date.now();
        const processed: StageHistory[] = sorted.map((entry, idx) => {
          const next = sorted[idx + 1];
          const isCurrent = !entry.exited_at && !next;
          // Derive exit: use DB value, then next entry's start, then now (for current stage)
          const resolvedExitedAt = entry.exited_at ?? (next ? next.entered_at : null);
          const enteredMs = entry.entered_at ? new Date(entry.entered_at).getTime() : null;
          const exitedMs = resolvedExitedAt ? new Date(resolvedExitedAt).getTime() : (isCurrent ? now : null);
          const durationMs = enteredMs != null && exitedMs != null ? exitedMs - enteredMs : null;
          return {
            stage_id: entry.stage_id,
            stage_name: stages.find(s => s.id === entry.stage_id)?.name || entry.stage_id,
            entered_at: entry.entered_at,
            exited_at: resolvedExitedAt,
            is_current: isCurrent,
            duration_ms: durationMs,
          };
        });
        setStageHistory(processed);
      })
      .catch(() => {});
  }, [job?.id]);

  const handleAddPayment = async () => {
    const amountVal = Number(newPayment.amount) || 0;
    const discountVal = Number(newPayment.discount) || 0;
    // Aceita pagamento, desconto, ou os dois juntos (ex: quitar com desconto)
    if (!job || (amountVal <= 0 && discountVal <= 0)) return;
    setSavingPayment(true);
    try {
      const res = await authFetch(`/api/jobs/${job.id}/payments`, {
        method: 'POST',
        body: JSON.stringify({ ...newPayment, amount: amountVal, discount: discountVal > 0 ? discountVal : undefined }),
      });
      if (res.ok) {
        const data = await res.json().catch(() => null);
        setNewPayment({ amount: '', discount: '', description: '', payment_date: new Date().toISOString().slice(0, 10), payment_method: 'Pix' });
        loadFinanceiro(job.id);
        // Desconto muda o valor total do job — reflete no board sem F5
        if (data && onJobUpdate) onJobUpdate(job.id, { amount: data.newAmount, payment_status: data.newStatus });
      }
    } finally { setSavingPayment(false); }
  };

  const handleDeletePayment = async (id: string) => {
    if (!job) return;
    await authFetch(`/api/job-payments/${id}`, { method: 'DELETE' });
    setPayments(prev => prev.filter(p => p.id !== id));
  };

  const handleAddJobItem = async (catalogId: string, nome: string, value: number) => {
    if (!job) return;
    const qty = Math.max(1, jobItemQty);
    setJobItemOpen(false); setJobItemSearch(''); setShowAddJobItem(false); setJobItemQty(1);
    const res = await authFetch(`/api/jobs/${job.id}/items`, {
      method: 'POST',
      body: JSON.stringify({ catalog_type: jobItemType, catalog_id: catalogId, catalog_name: nome, catalog_value: value, quantidade: qty }),
    });
    if (res.ok) loadFinanceiro(job.id);
  };

  const handleDeleteJobItem = async (id: string) => {
    if (!job) return;
    setJobItems(prev => prev.filter(i => i.id !== id));
    await authFetch(`/api/job-items/${id}`, { method: 'DELETE' });
    loadFinanceiro(job.id);
  };

  const handleUpdateJobItemQty = async (id: string, newQty: number) => {
    if (!job || newQty < 1) return;
    // Atualização otimista
    setJobItems(prev => prev.map(i => i.id === id ? { ...i, quantidade: newQty } : i));
    const res = await authFetch(`/api/job-items/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quantidade: newQty }),
    });
    if (res.ok) {
      const data = await res.json();
      setJobAmount(data.newAmount || 0);
      if (onJobUpdate) onJobUpdate(job.id, { amount: data.newAmount, payment_status: data.payment_status });
    } else {
      // Reverte em caso de erro
      loadFinanceiro(job.id);
    }
  };

  // Atualiza preço e/ou desconto de um item (popover de edição)
  const handleUpdateJobItemPrice = async (
    id: string,
    patch: { catalog_value?: number; discount_value?: number },
  ) => {
    if (!job) return;
    // Optimista
    setJobItems(prev => prev.map(i => i.id === id ? { ...i, ...patch } : i));
    const res = await authFetch(`/api/job-items/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (res.ok) {
      const data = await res.json();
      setJobAmount(data.newAmount || 0);
      if (onJobUpdate) onJobUpdate(job.id, { amount: data.newAmount, payment_status: data.payment_status });
    } else {
      loadFinanceiro(job.id);
    }
  };

  // Edita o pacote vendido (nome/valor/desconto) ou troca por outro do catálogo
  const handleSavePackage = async (patch: { name?: string; value?: number; discount?: number }) => {
    if (!job) return;
    const res = await authFetch(`/api/jobs/${job.id}/package`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (res.ok) loadFinanceiro(job.id);
  };

  // ── Itens do PACOTE (deal_items): editar qtd/preço, remover, adicionar ──
  // Os endpoints recalculam deal.value E o financeiro do job (nexo + total).
  const applyDealItemResult = (data: any) => {
    if (!job) return;
    if (data && data.newAmount != null) {
      setJobAmount(data.newAmount);
      if (onJobUpdate) onJobUpdate(job.id, { amount: data.newAmount, payment_status: data.payment_status });
    } else {
      loadFinanceiro(job.id);
    }
  };
  const handleUpdateDealItemQty = async (id: string, newQty: number) => {
    if (!job || newQty < 1) return;
    setDealItems(prev => prev.map(i => i.id === id ? { ...i, quantidade: newQty } : i));
    const res = await authFetch(`/api/deal-items/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quantidade: newQty }),
    });
    if (res.ok) applyDealItemResult(await res.json()); else loadFinanceiro(job.id);
  };
  const handleUpdateDealItemPrice = async (id: string, patch: { catalog_value?: number }) => {
    if (!job) return;
    setDealItems(prev => prev.map(i => i.id === id ? { ...i, ...patch } : i));
    const res = await authFetch(`/api/deal-items/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ catalog_value: patch.catalog_value }),
    });
    if (res.ok) applyDealItemResult(await res.json()); else loadFinanceiro(job.id);
  };
  const handleDeleteDealItem = async (id: string) => {
    if (!job) return;
    const wasLast = dealItems.filter(i => i.id !== id).length === 0;
    setDealItems(prev => prev.filter(i => i.id !== id));
    const res = await authFetch(`/api/deal-items/${id}`, { method: 'DELETE' });
    if (!res.ok) { loadFinanceiro(job.id); return; }
    // Esvaziou o pacote: recarrega tudo pra reconciliar packageItem/seção/summary
    // com o servidor (que agora zera a base corretamente). Senão, edita otimista.
    if (wasLast) loadFinanceiro(job.id);
    else applyDealItemResult(await res.json());
  };
  const handleAddDealItem = async (catalogId: string, nome: string, value: number) => {
    if (!job) return;
    const qty = Math.max(1, jobItemQty);
    setJobItemOpen(false); setJobItemSearch(''); setShowAddJobItem(false); setJobItemQty(1); setAddTarget('job');
    const res = await authFetch(`/api/jobs/${job.id}/deal-items`, {
      method: 'POST',
      body: JSON.stringify({ catalog_type: jobItemType, catalog_id: catalogId, catalog_name: nome, catalog_value: value, quantidade: qty }),
    });
    if (res.ok) loadFinanceiro(job.id);
  };
  // Roteia o item escolhido no seletor pro pacote (deal) ou adicionais (job).
  const handlePickCatalogItem = (catalogId: string, nome: string, value: number) => {
    if (addTarget === 'deal') handleAddDealItem(catalogId, nome, value);
    else handleAddJobItem(catalogId, nome, value);
  };

  if (!job) return null;

  const jobDate = job.job_date ? parseDate(job.job_date) : null;
  const currentStageName = stages.find(s => s.id === job.production_stage)?.name || "-";

  const handleAddItem = async () => {
    const text = newItem.trim();
    if (!text) return;
    const res = await authFetch(`/api/jobs/${job.id}/checklist`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (res.ok) {
      const item = await res.json();
      setChecklist(prev => [...prev, item]);
      setNewItem("");
    }
  };

  const handleToggle = async (item: ChecklistItem) => {
    const res = await authFetch(`/api/jobs/checklist/${item.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ done: !item.done }),
    });
    if (res.ok) {
      setChecklist(prev => prev.map(i => i.id === item.id ? { ...i, done: !i.done } : i));
    }
  };

  const handleDeleteItem = async (id: number) => {
    await authFetch(`/api/jobs/checklist/${id}`, { method: "DELETE" });
    setChecklist(prev => prev.filter(i => i.id !== id));
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const photo_data = ev.target?.result as string;
      const res = await authFetch(`/api/jobs/${job.id}/testimonials`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photo_data, caption: newCaption }),
      });
      if (res.ok) {
        const t = await res.json();
        setTestimonials(prev => [...prev, t]);
        setNewCaption("");
      }
      setUploading(false);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const handleDeleteTestimonial = async (id: number) => {
    await authFetch(`/api/jobs/testimonials/${id}`, { method: "DELETE" });
    setTestimonials(prev => prev.filter(t => t.id !== id));
  };

  // Salva a lista de etiquetas do trabalho e avisa a tela de Produção.
  const saveJobLabels = async (next: string[]) => {
    setLabels(next);
    await authFetch(`/api/jobs/${job!.id}/labels`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ labels: next }),
    });
    onLabelsChange?.(job!.id, next);
  };

  const toggleLabel = (name: string) => {
    saveJobLabels(labels.includes(name) ? labels.filter(l => l !== name) : [...labels, name]);
  };

  const handleRemoveLabel = (label: string) => saveJobLabels(labels.filter(l => l !== label));

  // Cor de uma etiqueta: vem da paleta; se não estiver na paleta, usa o hash.
  const labelColor = (name: string) =>
    labelPalette.find(l => l.name === name)?.color || getLabelColor(name);

  // Cria uma etiqueta na paleta da Produção e já aplica neste trabalho.
  const createPaletteLabel = async () => {
    const name = newLabelName.trim();
    if (!name) return;
    if (!labelPalette.some(l => l.name.toLowerCase() === name.toLowerCase())) {
      const res = await authFetch('/api/jobs/labels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, color: newLabelColor }),
      });
      if (res.ok) {
        const created = await res.json().catch(() => null);
        if (created) {
          setLabelPalette(prev => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
        }
      }
    }
    if (!labels.includes(name)) saveJobLabels([...labels, name]);
    setNewLabelName("");
  };

  const deletePaletteLabel = async (id: string) => {
    setLabelPalette(prev => prev.filter(l => l.id !== id));
    await authFetch(`/api/jobs/labels/${id}`, { method: 'DELETE' });
  };

  // Abre o editor inline de uma etiqueta da paleta.
  const startEditLabel = (pl: { id: string; name: string; color: string }) => {
    setEditingLabelId(pl.id);
    setEditLabelName(pl.name);
    setEditLabelColor(pl.color);
  };

  // Salva nome/cor de uma etiqueta padrão; renomeia também neste trabalho.
  const updatePaletteLabel = async (id: string) => {
    const name = editLabelName.trim();
    const current = labelPalette.find(l => l.id === id);
    if (!name || !current) { setEditingLabelId(null); return; }
    const renamed = current.name !== name;
    setLabelPalette(prev =>
      prev.map(l => (l.id === id ? { ...l, name, color: editLabelColor } : l))
          .sort((a, b) => a.name.localeCompare(b.name))
    );
    if (renamed && labels.includes(current.name)) {
      const nextLabels = labels.map(l => (l === current.name ? name : l));
      setLabels(nextLabels);
      onLabelsChange?.(job!.id, nextLabels);
    }
    setEditingLabelId(null);
    await authFetch(`/api/jobs/labels/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, color: editLabelColor }),
    });
  };

  const done = checklist.filter(i => i.done).length;

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col bg-white shadow-2xl dark:bg-gray-900">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-gray-200 px-5 py-4 dark:border-gray-700">
          <div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-white">
              {job.client_name || job.job_name || "Trabalho"}
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {job.job_type} · {jobDate?.toLocaleDateString("pt-BR")}
            </p>
          </div>
          <div className="flex items-center gap-1">
            {!isProductionOnly && (
              <button
                onClick={handleOpenContract}
                disabled={creatingContract}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-colors disabled:opacity-60",
                  jobContract
                    ? "text-gold-600 dark:text-gold-400 hover:bg-gold-50 dark:hover:bg-gold-500/10"
                    : "text-gold-600 dark:text-gold-400 hover:bg-gold-50 dark:hover:bg-gold-500/10"
                )}
                title={jobContract ? 'Ver contrato existente' : 'Gerar contrato'}
              >
                <FileText size={14} />
                {jobContract ? 'Ver contrato' : 'Gerar contrato'}
                {jobContract && <ContractStatusPill status={jobContract.status} signers={jobContract.signers} />}
              </button>
            )}
            {!isProductionOnly && onRemoveFromProduction && (
              <button
                onClick={() => setConfirmRemove(true)}
                className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                title="Remover da produção"
              >
                <LogOut size={14} />
                Remover
              </button>
            )}
            <button
              onClick={onClose}
              className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-200"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Stage pill + value */}
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3 dark:border-gray-700">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
            <ChevronRight size={12} /> {currentStageName}
          </span>
          {!isProductionOnly && (
            <span className="text-sm font-bold text-gray-800 dark:text-gray-100">
              {(() => {
                const amountPaid = job.amount_paid || 0;
                const restante = job.amount - amountPaid;
                if (job.payment_status === 'paid') return formatCurrency(job.amount);
                return formatCurrency(restante >= 0 ? restante : job.amount);
              })()}
            </span>
          )}
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200 dark:border-gray-700">
          {(["details", "financeiro", "testimonials"] as const).filter((t) => t !== "financeiro" || !isProductionOnly).map((t) => {
            const totalPago = payments.reduce((s, p) => s + p.amount, 0);
            const tabLabels: Record<string, string> = {
              details: "Detalhes",
              financeiro: "Financeiro",
              testimonials: `Depoimentos${testimonials.length > 0 ? ` (${testimonials.length})` : ""}`,
            };
            return (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex-1 py-3 text-xs font-semibold transition-colors ${
                  tab === t
                    ? "border-b-2 border-gold-500 text-gold-600 dark:border-gold-400 dark:text-gold-400"
                    : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                }`}
              >
                {tabLabels[t]}
              </button>
            );
          })}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">

          {/* ── DETAILS TAB ── */}
          {tab === "details" && (
            <div className="space-y-5 p-5">
              {/* Client info */}
              <section>
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                  Cliente
                </h3>
                {loadingClient ? (
                  <div className="h-20 animate-pulse rounded-lg bg-gray-100 dark:bg-gray-800" />
                ) : client ? (
                  <div className="space-y-2 rounded-xl border border-gray-200 p-4 dark:border-gray-700">
                    <p className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                      <User size={14} className="text-gray-400" /> {client.name}
                    </p>
                    {client.phone && (
                      <p className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                        <Phone size={14} className="text-gray-400" /> {client.phone}
                      </p>
                    )}
                    {client.email && (
                      <p className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                        <Mail size={14} className="text-gray-400" /> {client.email}
                      </p>
                    )}
                    {client.instagram && (
                      <p className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                        <Instagram size={14} className="text-gray-400" /> @{client.instagram.replace(/^@/, "")}
                      </p>
                    )}
                    {client.city && (
                      <p className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                        <MapPin size={14} className="text-gray-400" /> {client.city}{client.state ? `, ${client.state}` : ""}
                      </p>
                    )}
                    {client.notes && (
                      <p className="mt-2 rounded-lg bg-gray-50 p-2 text-xs text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                        {client.notes}
                      </p>
                    )}
                  </div>
                ) : isProductionOnly && job.client_name ? (
                  <div className="space-y-2 rounded-xl border border-gray-200 p-4 dark:border-gray-700">
                    <p className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                      <User size={14} className="text-gray-400" /> {job.client_name}
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-gray-400">Sem cliente vinculado.</p>
                )}
              </section>

              {/* Observações - editável inline */}
              <EditableNotesSection
                jobId={job.id}
                initialNotes={job.notes || ''}
                onSaved={(notes) => onJobUpdate?.(job.id, { notes })}
              />

              {/* Imagem de capa do card */}
              <CoverImageSection
                jobId={job.id}
                currentUrl={job.cover_image_url || null}
                onChanged={(url) => onJobUpdate?.(job.id, { cover_image_url: url })}
              />

              {/* Labels */}
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                  Etiquetas
                </h3>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {labels.map(label => (
                    <span
                      key={label}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold text-white"
                      style={{ backgroundColor: labelColor(label) }}
                    >
                      <Tag size={10} />
                      {label}
                      <button onClick={() => handleRemoveLabel(label)} className="ml-0.5 text-white/70 hover:text-white">
                        <X size={10} />
                      </button>
                    </span>
                  ))}
                  {labels.length === 0 && (
                    <span className="text-xs text-gray-400 dark:text-gray-500">Nenhuma etiqueta neste trabalho.</span>
                  )}
                </div>
                <div className="relative" ref={labelMenuRef}>
                  <button
                    onClick={() => { setLabelMenuOpen(v => !v); setEditingLabelId(null); }}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 text-xs font-medium hover:bg-gray-200 dark:hover:bg-gray-700"
                  >
                    <Plus size={13} /> Etiqueta
                  </button>
                  {labelMenuOpen && (
                    <div className="absolute z-20 mt-1.5 w-72 rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-2xl overflow-hidden">
                      {/* Etiquetas padrão */}
                      <div className="px-3 pt-3 pb-1">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                          Etiquetas padrão
                        </p>
                      </div>
                      <div className="max-h-60 overflow-y-auto px-2 pb-2 space-y-0.5">
                        {labelPalette.map(pl => {
                          const active = labels.includes(pl.name);
                          if (editingLabelId === pl.id) {
                            return (
                              <div key={pl.id} className="rounded-xl border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-900/60 p-2.5 space-y-2">
                                <input
                                  autoFocus
                                  value={editLabelName}
                                  onChange={e => setEditLabelName(e.target.value)}
                                  onKeyDown={e => {
                                    if (e.key === 'Enter') updatePaletteLabel(pl.id);
                                    if (e.key === 'Escape') setEditingLabelId(null);
                                  }}
                                  className="w-full rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 px-2.5 py-1.5 text-xs text-gray-700 dark:text-gray-200 focus:border-gold-500 focus:outline-none"
                                />
                                <div className="grid grid-cols-8 gap-1.5">
                                  {LABEL_COLORS.map(c => (
                                    <button
                                      key={c}
                                      onClick={() => setEditLabelColor(c)}
                                      className={cn(
                                        "w-6 h-6 rounded-lg flex items-center justify-center transition-transform hover:scale-110",
                                        editLabelColor === c && "ring-2 ring-offset-1 ring-gray-500 dark:ring-offset-gray-900",
                                      )}
                                      style={{ backgroundColor: c }}
                                    >
                                      {editLabelColor === c && <Check size={12} className="text-white" />}
                                    </button>
                                  ))}
                                </div>
                                <div className="flex justify-end gap-1.5">
                                  <button
                                    onClick={() => setEditingLabelId(null)}
                                    className="px-2.5 py-1 rounded-lg text-xs font-semibold text-gray-500 hover:bg-gray-200 dark:text-gray-300 dark:hover:bg-gray-700"
                                  >Cancelar</button>
                                  <button
                                    onClick={() => updatePaletteLabel(pl.id)}
                                    className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-gold-600 text-white hover:bg-gold-700"
                                  >Salvar</button>
                                </div>
                              </div>
                            );
                          }
                          return (
                            <div
                              key={pl.id}
                              className="group flex items-center gap-1 pr-1.5 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700/60"
                            >
                              <button
                                onClick={() => toggleLabel(pl.name)}
                                className="flex items-center gap-2 flex-1 min-w-0 text-left py-1.5 pl-2"
                              >
                                <span
                                  className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 text-white shadow-sm"
                                  style={{ backgroundColor: pl.color }}
                                >
                                  {active ? <Check size={14} /> : <Tag size={12} />}
                                </span>
                                <span className="flex-1 text-xs font-medium text-gray-700 dark:text-gray-200 truncate">{pl.name}</span>
                              </button>
                              <button
                                onClick={() => startEditLabel(pl)}
                                title="Editar etiqueta"
                                className="opacity-0 group-hover:opacity-100 p-1 text-gray-300 hover:text-gold-600 dark:text-gray-500 dark:hover:text-gold-400 transition-opacity flex-shrink-0"
                              >
                                <Pencil size={12} />
                              </button>
                              <button
                                onClick={() => deletePaletteLabel(pl.id)}
                                title="Excluir etiqueta"
                                className="opacity-0 group-hover:opacity-100 p-1 text-gray-300 hover:text-red-500 dark:text-gray-500 transition-opacity flex-shrink-0"
                              >
                                <Trash2 size={12} />
                              </button>
                            </div>
                          );
                        })}
                        {labelPalette.length === 0 && (
                          <p className="px-2 py-3 text-xs text-gray-400 text-center leading-relaxed">
                            Nenhuma etiqueta padrão ainda.<br />Crie a primeira logo abaixo.
                          </p>
                        )}
                      </div>
                      {/* Nova etiqueta */}
                      <div className="border-t border-gray-100 dark:border-gray-700 bg-gray-50/70 dark:bg-gray-900/40 p-3 space-y-2">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                          Nova etiqueta
                        </p>
                        <input
                          type="text"
                          value={newLabelName}
                          onChange={e => setNewLabelName(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && createPaletteLabel()}
                          placeholder="Nome da etiqueta..."
                          className="w-full rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 px-2.5 py-1.5 text-xs text-gray-700 dark:text-gray-200 focus:border-gold-500 focus:outline-none placeholder-gray-400"
                        />
                        <div className="grid grid-cols-8 gap-1.5">
                          {LABEL_COLORS.map(c => (
                            <button
                              key={c}
                              onClick={() => setNewLabelColor(c)}
                              className={cn(
                                "w-6 h-6 rounded-lg flex items-center justify-center transition-transform hover:scale-110",
                                newLabelColor === c && "ring-2 ring-offset-1 ring-gray-500 dark:ring-offset-gray-900",
                              )}
                              style={{ backgroundColor: c }}
                            >
                              {newLabelColor === c && <Check size={12} className="text-white" />}
                            </button>
                          ))}
                        </div>
                        <button
                          onClick={createPaletteLabel}
                          disabled={!newLabelName.trim()}
                          className="w-full py-1.5 rounded-lg bg-gold-600 text-white text-xs font-semibold hover:bg-gold-700 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          Criar etiqueta
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </section>

              {/* Checklist - inline after labels */}
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 flex items-center gap-1.5">
                  <CheckSquare size={12} />
                  Checklist
                  {checklist.length > 0 && (
                    <span className="ml-auto text-[11px] font-bold text-gold-600 dark:text-gold-400">
                      {done}/{checklist.length}
                    </span>
                  )}
                </h3>
                {checklist.length > 0 && (
                  <div className="space-y-1.5 mb-2">
                    {checklist.map(item => (
                      <div key={item.id} className="flex items-center gap-2.5 rounded-lg border border-gray-100 dark:border-gray-700 px-3 py-2">
                        <button onClick={() => handleToggle(item)} className="flex-shrink-0">
                          {item.done
                            ? <CheckSquare size={16} className="text-gold-500 dark:text-gold-400" />
                            : <Square size={16} className="text-gray-400" />}
                        </button>
                        <span className={`flex-1 text-sm ${item.done ? "line-through text-gray-400" : "text-gray-700 dark:text-gray-200"}`}>
                          {item.text}
                        </span>
                        <button onClick={() => handleDeleteItem(item.id)} className="text-gray-300 hover:text-red-500 dark:text-gray-600 dark:hover:text-red-400 flex-shrink-0">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newItem}
                    onChange={e => setNewItem(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && handleAddItem()}
                    placeholder="Adicionar item ao checklist..."
                    className="flex-1 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-1.5 text-sm text-gray-700 dark:text-gray-200 placeholder-gray-400 focus:border-gold-500 focus:outline-none"
                  />
                  <button onClick={handleAddItem} className="px-3 py-1.5 rounded-lg bg-gold-600 text-white text-xs hover:bg-gold-700 flex-shrink-0">
                    <Plus size={14} />
                  </button>
                </div>
              </section>

              {/* Stage history */}
              <section>
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                  Tempo por etapa
                </h3>
                {stageHistory.length > 0 ? (
                  <div className="space-y-2">
                    {stageHistory.map((entry, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2 dark:border-gray-700"
                      >
                        <div className="flex items-center gap-2">
                          <Clock size={13} className="text-gray-400" />
                          <span className="text-sm text-gray-700 dark:text-gray-200">{entry.stage_name}</span>
                          {entry.is_current && (
                            <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-bold text-green-700 dark:bg-green-900/40 dark:text-green-400">
                              atual
                            </span>
                          )}
                        </div>
                        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">
                          {formatDuration(entry.duration_ms)}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-400">Histórico de etapas aparecerá aqui conforme o trabalho avança.</p>
                )}
              </section>

              {/* Move stage / Send to production */}
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                  {job.production_stage ? 'Mover etapa' : 'Produção'}
                </h3>
                {job.production_stage ? (
                  <SearchableSelect
                    value={job.production_stage}
                    onChange={v => onStageChange(job.id, v)}
                    options={stages.map(s => ({ value: s.id, label: s.name }))}
                    placeholder="Selecionar etapa..."
                    className="w-full"
                  />
                ) : (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-lg">
                      <span className="w-1.5 h-1.5 rounded-full bg-gray-400" />
                      <span className="text-xs text-gray-500 dark:text-gray-400">Não está em produção</span>
                    </div>
                    {stages.length > 0 && (
                      <button
                        onClick={() => onStageChange(job.id, stages[0].id)}
                        className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-gold-500/15 hover:bg-gold-500/25 text-gold-700 dark:text-gold-300 text-sm font-semibold rounded-lg transition-colors"
                      >
                        <Workflow size={14} />
                        Enviar para produção
                      </button>
                    )}
                  </div>
                )}
              </section>

              {/* Galeria de seleção de fotos (proofing) */}
              <GallerySection jobId={job.id} />
            </div>
          )}

          {/* ── FINANCEIRO TAB ── */}
          {tab === "financeiro" && (() => {
            const dealItemsTotal = dealItems.reduce((s, i) => s + i.catalog_value * i.quantidade, 0);
            const addedItemsTotal = jobItems.reduce((s, i) => s + i.catalog_value * i.quantidade, 0);
            // Jobs com deal: soma os itens frescos da resposta (nunca depende de job.amount)
            // Jobs sem deal: usa jobAmount do servidor (base manual + extras)
            const totalGeral = dealItems.length > 0 ? dealItemsTotal + addedItemsTotal : jobAmount;
            const totalPago = payments.reduce((s, p) => s + p.amount, 0);
            const restante = Math.max(0, totalGeral - totalPago);
            const pct = totalGeral > 0 ? Math.min(100, (totalPago / totalGeral) * 100) : 0;
            const barColor = pct >= 100 ? 'bg-emerald-500' : pct >= 50 ? 'bg-amber-400' : 'bg-blue-400';

            const jobCatalogList = jobItemType === 'produto'
              ? catalogProdutos.filter((p: any) => p.ativo).map((p: any) => ({ id: p.id, nome: p.nome, value: p.preco_venda }))
              : jobItemType === 'servico'
              ? catalogServicos.filter((s: any) => s.ativo).map((s: any) => ({ id: s.id, nome: s.nome, value: s.preco_base }))
              : catalogCombos.filter((c: any) => c.ativo).map((c: any) => ({ id: c.id, nome: c.nome, value: c.preco_final }));

            const filteredJobCatalog = jobItemSearch
              ? jobCatalogList.filter((i: any) => i.nome.toLowerCase().includes(jobItemSearch.toLowerCase()))
              : jobCatalogList;

            // Seletor de catálogo compartilhado: roteia o item escolhido pro pacote
            // (deal) ou pros adicionais (job) conforme addTarget.
            const renderItemSelector = () => (
              <div ref={jobItemRef} className="border border-gray-200 dark:border-gray-700 rounded-xl p-3 bg-white dark:bg-gray-800 space-y-2">
                <div className="grid grid-cols-3 gap-1">
                  {(['combo', 'produto', 'servico'] as const).map(t => {
                    const cfg = CATALOG_CFG[t];
                    return (
                      <button key={t} onMouseDown={e => e.preventDefault()}
                        onClick={() => { setJobItemType(t); setJobItemOpen(true); setJobItemSearch(''); }}
                        className={`flex items-center justify-center gap-1 py-1.5 rounded-lg border text-xs font-semibold transition-all ${
                          jobItemType === t ? `${cfg.bg} ${cfg.border} ${cfg.color}` : 'border-gray-200 dark:border-gray-600 text-gray-400'
                        }`}>
                        {cfg.icon}
                        <span>{t === 'servico' ? 'Serviço' : t.charAt(0).toUpperCase() + t.slice(1)}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="relative">
                  <div className="flex items-center gap-2 border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-1.5 bg-gray-50 dark:bg-gray-900 focus-within:border-gold-400 transition-colors">
                    <Search size={12} className="text-gray-400" />
                    <input
                      value={jobItemSearch}
                      onChange={e => { setJobItemSearch(e.target.value); setJobItemOpen(true); }}
                      onFocus={() => setJobItemOpen(true)}
                      placeholder="Buscar..."
                      className="flex-1 text-sm bg-transparent outline-none text-gray-800 dark:text-gray-100 placeholder-gray-400"
                    />
                  </div>
                  {jobItemOpen && filteredJobCatalog.length > 0 && (
                    <div className="absolute z-30 top-full left-0 right-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl overflow-hidden">
                      <div className="max-h-40 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-700/50">
                        {filteredJobCatalog.map((item: any) => (
                          <button key={item.id} onMouseDown={e => e.preventDefault()}
                            onClick={() => handlePickCatalogItem(item.id, item.nome, item.value)}
                            className="w-full flex items-center justify-between px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700/60 text-left text-sm">
                            <span className="text-gray-800 dark:text-gray-100 truncate">{item.nome}</span>
                            <span className="text-xs font-semibold text-gray-400 ml-2 flex-shrink-0">{formatCurrency(item.value)}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                <div className="flex items-center justify-between px-1">
                  <span className="text-xs text-gray-500 dark:text-gray-400">Quantidade</span>
                  <div className="flex items-center gap-1">
                    <button
                      onMouseDown={e => e.preventDefault()}
                      onClick={() => setJobItemQty(q => Math.max(1, q - 1))}
                      className="w-6 h-6 rounded-md border border-gray-200 dark:border-gray-600 flex items-center justify-center text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 text-sm font-bold"
                    >−</button>
                    <input
                      type="number"
                      min={1}
                      value={jobItemQty}
                      onChange={e => setJobItemQty(Math.max(1, parseInt(e.target.value) || 1))}
                      className="w-10 text-center text-sm font-semibold border border-gray-200 dark:border-gray-600 rounded-md bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-gold-400 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                    <button
                      onMouseDown={e => e.preventDefault()}
                      onClick={() => setJobItemQty(q => q + 1)}
                      className="w-6 h-6 rounded-md border border-gray-200 dark:border-gray-600 flex items-center justify-center text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 text-sm font-bold"
                    >+</button>
                  </div>
                </div>
                <button onMouseDown={e => e.preventDefault()} onClick={() => { setShowAddJobItem(false); setJobItemQty(1); setAddTarget('job'); }}
                  className="w-full text-[11px] text-gray-400 hover:text-gray-600 py-0.5">Cancelar</button>
              </div>
            );

            return (
              <div className="p-5 space-y-5">
                {loadingFin ? (
                  <div className="space-y-2">
                    {[1,2,3].map(i => <div key={i} className="h-12 rounded-xl animate-pulse bg-gray-100 dark:bg-gray-800" />)}
                  </div>
                ) : (
                  <>
                    {/* ── Resumo ── */}
                    <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                      <div className="grid grid-cols-3 divide-x divide-gray-200 dark:divide-gray-700">
                        <div className="p-3 text-center">
                          <p className="text-[10px] font-semibold text-gray-400 uppercase mb-1">Total</p>
                          <p className="text-sm font-bold text-gray-900 dark:text-white">{formatCurrency(totalGeral)}</p>
                        </div>
                        <div className="p-3 text-center bg-emerald-50/50 dark:bg-emerald-900/10">
                          <p className="text-[10px] font-semibold text-emerald-500 uppercase mb-1">Pago</p>
                          <p className="text-sm font-bold text-emerald-700 dark:text-emerald-400">{formatCurrency(totalPago)}</p>
                        </div>
                        <div className={`p-3 text-center ${restante === 0 ? 'bg-emerald-50/30 dark:bg-emerald-900/10' : 'bg-orange-50/50 dark:bg-orange-900/10'}`}>
                          <p className={`text-[10px] font-semibold uppercase mb-1 ${restante === 0 ? 'text-emerald-500' : 'text-orange-500'}`}>Restante</p>
                          <p className={`text-sm font-bold ${restante === 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-orange-700 dark:text-orange-300'}`}>{formatCurrency(restante)}</p>
                        </div>
                      </div>
                      {/* Barra */}
                      <div className="px-4 py-3 border-t border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                        <div className="flex justify-between text-[11px] mb-1.5">
                          <span className="text-gray-400">Progresso do pagamento</span>
                          <span className={`font-bold ${pct >= 100 ? 'text-emerald-600' : pct >= 50 ? 'text-amber-600' : 'text-blue-600'}`}>{pct.toFixed(0)}%</span>
                        </div>
                        <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full transition-all duration-500 ${barColor}`} style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    </div>

                    {/* ── Itens do negócio (deal) / valor base do trabalho ── */}
                    {(dealItems.length > 0 || packageItem) && (
                      <section>
                        <div className="flex items-center justify-between mb-2">
                          <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                            {packageItem?.source === 'job' && dealItems.length === 0 ? 'Valor do trabalho' : 'Itens do negócio'}
                          </h3>
                          {dealItems.length > 0 && (
                            <button
                              onMouseDown={e => e.preventDefault()}
                              onClick={() => {
                                if (showAddJobItem && addTarget === 'deal') { setShowAddJobItem(false); }
                                else { setAddTarget('deal'); setShowAddJobItem(true); setJobItemOpen(false); setJobItemSearch(''); }
                              }}
                              className="flex items-center gap-1 text-xs font-semibold text-gold-600 dark:text-gold-400 hover:text-gold-700 dark:hover:text-gold-300"
                            >
                              <Plus size={12} /> Adicionar
                            </button>
                          )}
                        </div>
                        <div className="space-y-1.5">
                          {dealItems.length > 0 ? dealItems.map(item => {
                            const cfg = CATALOG_CFG[item.catalog_type] || CATALOG_CFG.produto;
                            return (
                              <div key={item.id} className={`flex items-center gap-2 px-3 py-2 rounded-xl border ${cfg.bg} ${cfg.border}`}>
                                <span className={`flex-shrink-0 ${cfg.color}`}>{cfg.icon}</span>
                                <span className="flex-1 text-sm text-gray-800 dark:text-gray-100 truncate min-w-0">{item.catalog_name}</span>
                                {/* Stepper de quantidade editável */}
                                <div className="flex items-center gap-0.5 flex-shrink-0">
                                  <button
                                    onMouseDown={e => e.preventDefault()}
                                    onClick={() => handleUpdateDealItemQty(item.id, item.quantidade - 1)}
                                    disabled={item.quantidade <= 1}
                                    className="w-5 h-5 rounded flex items-center justify-center text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-30 text-xs font-bold"
                                  >−</button>
                                  <input
                                    type="number"
                                    min={1}
                                    value={item.quantidade}
                                    onChange={e => {
                                      const v = parseInt(e.target.value) || 1;
                                      setDealItems(prev => prev.map(i => i.id === item.id ? { ...i, quantidade: Math.max(1, v) } : i));
                                    }}
                                    onBlur={e => {
                                      const v = Math.max(1, parseInt(e.target.value) || 1);
                                      if (v !== item.quantidade) handleUpdateDealItemQty(item.id, v);
                                    }}
                                    onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                                    className="w-8 text-center text-xs font-semibold text-gray-700 dark:text-gray-200 bg-transparent border-0 outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                  />
                                  <button
                                    onMouseDown={e => e.preventDefault()}
                                    onClick={() => handleUpdateDealItemQty(item.id, item.quantidade + 1)}
                                    className="w-5 h-5 rounded flex items-center justify-center text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600 text-xs font-bold"
                                  >+</button>
                                </div>
                                <JobItemPriceEditor
                                  item={item}
                                  hideDiscount
                                  onSave={(patch) => handleUpdateDealItemPrice(item.id, { catalog_value: patch.catalog_value })}
                                />
                                <button onMouseDown={e => e.preventDefault()} onClick={() => handleDeleteDealItem(item.id)}
                                  className="text-gray-300 hover:text-red-500 dark:text-gray-600 dark:hover:text-red-400 flex-shrink-0">
                                  <X size={13} />
                                </button>
                              </div>
                            );
                          }) : packageItem && (
                            /* Pacote vendido sem itens detalhados - editável/trocável */
                            <PackageEditor
                              pkg={packageItem}
                              catalogCombos={catalogCombos}
                              catalogProdutos={catalogProdutos}
                              catalogServicos={catalogServicos}
                              onSave={handleSavePackage}
                            />
                          )}
                          {dealItems.length > 0 && showAddJobItem && addTarget === 'deal' && renderItemSelector()}
                        </div>
                      </section>
                    )}

                    {/* ── Itens adicionados ao job ── */}
                    <section>
                      <div className="flex items-center justify-between mb-2">
                        <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                          Itens adicionais
                        </h3>
                        <button
                          onMouseDown={e => e.preventDefault()}
                          onClick={() => {
                            if (showAddJobItem && addTarget === 'job') { setShowAddJobItem(false); }
                            else { setAddTarget('job'); setShowAddJobItem(true); setJobItemOpen(false); setJobItemSearch(''); }
                          }}
                          className="flex items-center gap-1 text-xs font-semibold text-gold-600 dark:text-gold-400 hover:text-gold-700 dark:hover:text-gold-300"
                        >
                          <Plus size={12} /> Adicionar
                        </button>
                      </div>

                      {jobItems.length > 0 && (
                        <div className="space-y-1.5 mb-2">
                          {jobItems.map(item => {
                            const cfg = CATALOG_CFG[item.catalog_type] || CATALOG_CFG.produto;
                            return (
                              <div key={item.id} className={`flex items-center gap-2 px-3 py-2 rounded-xl border ${cfg.bg} ${cfg.border}`}>
                                <span className={`flex-shrink-0 ${cfg.color}`}>{cfg.icon}</span>
                                <span className="flex-1 text-sm text-gray-800 dark:text-gray-100 truncate min-w-0">{item.catalog_name}</span>
                                {/* Stepper de quantidade editável */}
                                <div className="flex items-center gap-0.5 flex-shrink-0">
                                  <button
                                    onMouseDown={e => e.preventDefault()}
                                    onClick={() => handleUpdateJobItemQty(item.id, item.quantidade - 1)}
                                    disabled={item.quantidade <= 1}
                                    className="w-5 h-5 rounded flex items-center justify-center text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-30 text-xs font-bold"
                                  >−</button>
                                  <input
                                    type="number"
                                    min={1}
                                    value={item.quantidade}
                                    onChange={e => {
                                      const v = parseInt(e.target.value) || 1;
                                      setJobItems(prev => prev.map(i => i.id === item.id ? { ...i, quantidade: Math.max(1, v) } : i));
                                    }}
                                    onBlur={e => {
                                      const v = Math.max(1, parseInt(e.target.value) || 1);
                                      if (v !== item.quantidade) handleUpdateJobItemQty(item.id, v);
                                    }}
                                    onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                                    className="w-8 text-center text-xs font-semibold text-gray-700 dark:text-gray-200 bg-transparent border-0 outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                  />
                                  <button
                                    onMouseDown={e => e.preventDefault()}
                                    onClick={() => handleUpdateJobItemQty(item.id, item.quantidade + 1)}
                                    className="w-5 h-5 rounded flex items-center justify-center text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600 text-xs font-bold"
                                  >+</button>
                                </div>
                                <JobItemPriceEditor
                                  item={item}
                                  onSave={(patch) => handleUpdateJobItemPrice(item.id, patch)}
                                />
                                <button onMouseDown={e => e.preventDefault()} onClick={() => handleDeleteJobItem(item.id)}
                                  className="text-gray-300 hover:text-red-500 dark:text-gray-600 dark:hover:text-red-400 flex-shrink-0">
                                  <X size={13} />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {jobItems.length === 0 && !(showAddJobItem && addTarget === 'job') && (
                        <p className="text-xs text-gray-400 dark:text-gray-500 text-center py-2">Nenhum item adicional</p>
                      )}

                      {/* Seletor de item (compartilhado; aqui só quando o alvo é o job) */}
                      {showAddJobItem && addTarget === 'job' && renderItemSelector()}
                    </section>

                    {/* ── Pagamentos ── */}
                    <section>
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-2 flex items-center gap-1.5">
                        <CreditCard size={12} /> Pagamentos recebidos
                      </h3>

                      {payments.length > 0 && (
                        <div className="space-y-1.5 mb-3">
                          {payments.map(p => (
                            <div key={p.id} className="flex items-center gap-2 px-3 py-2 rounded-xl border border-emerald-100 dark:border-emerald-800 bg-emerald-50/60 dark:bg-emerald-900/10">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">{formatCurrency(p.amount)}</span>
                                  <span className="text-[10px] text-gray-400 bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded-full">{p.payment_method}</span>
                                </div>
                                <p className="text-xs text-gray-400 dark:text-gray-500 truncate">
                                  {new Date(p.payment_date + 'T12:00:00').toLocaleDateString('pt-BR')}
                                  {p.description && ` · ${p.description}`}
                                </p>
                              </div>
                              <button onClick={() => handleDeletePayment(p.id)}
                                className="text-gray-300 hover:text-red-500 dark:text-gray-600 dark:hover:text-red-400 flex-shrink-0">
                                <X size={13} />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Formulário novo pagamento */}
                      <div className="border border-gray-200 dark:border-gray-700 rounded-xl p-3 bg-white dark:bg-gray-800 space-y-2">
                        <p className="text-[11px] font-semibold text-gray-400 uppercase">Registrar pagamento</p>
                        <div className="grid grid-cols-3 gap-2">
                          <div>
                            <label className="text-[10px] text-gray-400 mb-0.5 block">Valor</label>
                            <input
                              type="number"
                              placeholder="0,00"
                              value={newPayment.amount}
                              onChange={e => setNewPayment(p => ({ ...p, amount: e.target.value }))}
                              className="w-full border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 rounded-lg px-2 py-1.5 text-sm text-gray-900 dark:text-white outline-none focus:border-emerald-400 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] text-gray-400 mb-0.5 block" title="Abate do valor total do trabalho">Desconto</label>
                            <input
                              type="number"
                              placeholder="0,00"
                              value={newPayment.discount}
                              onChange={e => setNewPayment(p => ({ ...p, discount: e.target.value }))}
                              className="w-full border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-900/10 rounded-lg px-2 py-1.5 text-sm text-gray-900 dark:text-white outline-none focus:border-amber-400 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] text-gray-400 mb-0.5 block">Data</label>
                            <input
                              type="date"
                              value={newPayment.payment_date}
                              onChange={e => setNewPayment(p => ({ ...p, payment_date: e.target.value }))}
                              className="w-full border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 rounded-lg px-2 py-1.5 text-sm text-gray-900 dark:text-white outline-none focus:border-emerald-400 [color-scheme:light] dark:[color-scheme:dark]"
                            />
                          </div>
                        </div>
                        {Number(newPayment.discount) > 0 && (
                          <p className="text-[10px] text-amber-600 dark:text-amber-400">
                            O desconto reduz o valor total do trabalho (não conta como dinheiro recebido).
                          </p>
                        )}
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-[10px] text-gray-400 mb-0.5 block">Forma</label>
                            <select
                              value={newPayment.payment_method}
                              onChange={e => setNewPayment(p => ({ ...p, payment_method: e.target.value }))}
                              className="w-full border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 rounded-lg px-2 py-1.5 text-sm text-gray-900 dark:text-white outline-none focus:border-emerald-400"
                            >
                              {['Pix', 'Cartão de Crédito', 'Cartão de Débito', 'Dinheiro', 'Transferência', 'Boleto'].map(m => (
                                <option key={m}>{m}</option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="text-[10px] text-gray-400 mb-0.5 block">Descrição</label>
                            <input
                              placeholder="Sinal, parcela 2..."
                              value={newPayment.description}
                              onChange={e => setNewPayment(p => ({ ...p, description: e.target.value }))}
                              onKeyDown={e => e.key === 'Enter' && handleAddPayment()}
                              className="w-full border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 rounded-lg px-2 py-1.5 text-sm text-gray-900 dark:text-white outline-none focus:border-emerald-400"
                            />
                          </div>
                        </div>
                        <button
                          onClick={handleAddPayment}
                          disabled={savingPayment || (Number(newPayment.amount) <= 0 && Number(newPayment.discount) <= 0)}
                          className="w-full py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                          <Plus size={14} /> {Number(newPayment.discount) > 0 && Number(newPayment.amount) <= 0 ? 'Aplicar Desconto' : 'Registrar Pagamento'}
                        </button>
                      </div>
                    </section>
                  </>
                )}
              </div>
            );
          })()}

          {/* ── TESTIMONIALS TAB ── */}
          {tab === "testimonials" && (
            <div className="p-5">
              {/* Upload area */}
              <div className="mb-4 space-y-2">
                <input
                  type="text"
                  value={newCaption}
                  onChange={e => setNewCaption(e.target.value)}
                  placeholder="Legenda (opcional)..."
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-500"
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gray-300 py-3 text-sm font-medium text-gray-500 transition hover:border-blue-400 hover:text-blue-500 disabled:opacity-50 dark:border-gray-600 dark:text-gray-400 dark:hover:border-blue-500 dark:hover:text-blue-400"
                >
                  <Image size={16} />
                  {uploading ? "Enviando..." : "Adicionar foto de depoimento"}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handlePhotoUpload}
                />
              </div>

              {testimonials.length === 0 ? (
                <p className="text-center text-sm text-gray-400 py-8">Nenhum depoimento ainda.</p>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {testimonials.map(t => (
                    <div key={t.id} className="group relative overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700">
                      <img
                        src={t.photo_data}
                        alt={t.caption || "Depoimento"}
                        className="h-36 w-full object-cover"
                      />
                      {t.caption && (
                        <p className="bg-white px-2 py-1 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                          {t.caption}
                        </p>
                      )}
                      <button
                        onClick={() => handleDeleteTestimonial(t.id)}
                        className="absolute right-2 top-2 hidden rounded-full bg-red-500 p-1 text-white shadow group-hover:flex"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Contract generator - full-screen, above drawer */}
      {contractId !== null && (
        <ContractGenerator
          contractId={contractId}
          onClose={() => setContractId(null)}
        />
      )}

      {/* Template picker - antes de criar o contrato */}
      {templatePickerOpen && (
        <TemplatePickerModal
          subtitle={`Cliente: ${job?.client_name || 'sem nome'}`}
          onClose={() => setTemplatePickerOpen(false)}
          onPick={({ template, sundaySession, surcharge }) => createContractWithTemplate(template, sundaySession, surcharge)}
        />
      )}

      {/* Confirm remove from production */}
      {confirmRemove && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => setConfirmRemove(false)} />
          <div className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-xl border border-gray-200 dark:border-gray-800 w-full max-w-sm p-6">
            <h3 className="text-base font-bold text-gray-900 dark:text-white mb-2">Remover da produção</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">
              Remover <span className="font-semibold text-gray-700 dark:text-gray-200">{job.client_name || job.job_name}</span> da produção?
              <br />O cliente e o trabalho continuam salvos.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmRemove(false)}
                className="flex-1 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-xl text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={() => { onRemoveFromProduction!(job.id); setConfirmRemove(false); onClose(); }}
                className="flex-1 py-2 text-sm bg-red-500 hover:bg-red-600 text-white rounded-xl font-semibold transition-colors"
              >
                Remover
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Galeria de seleção de fotos vinculada ao trabalho ──────────────────
const GALLERY_STATUS_LABELS: Record<string, string> = {
  draft: "Preparando",
  sent: "Enviada",
  selected: "Seleção feita",
  delivered: "Entregue",
};

interface GallerySummary {
  id: string;
  title: string;
  status: string;
  share_token: string;
  photo_count: number;
  selected_count: number;
}

function GallerySection({ jobId }: { jobId: number }) {
  const { data, mutate } = useApi<{ galleries: GallerySummary[] }>(`/api/galleries?job_id=${jobId}`);
  const gallery = data?.galleries?.[0];
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const res = await authFetch("/api/galleries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_id: jobId, included_count: 20, extra_price: 35 }),
      });
      if (res.ok) mutate();
    } finally {
      setCreating(false);
    }
  };

  const handleCopyLink = async () => {
    if (!gallery) return;
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/g/${gallery.share_token}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard indisponível */
    }
  };

  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 flex items-center gap-1.5">
        <Images size={12} />
        Galeria de seleção
      </h3>
      {gallery ? (
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{gallery.title}</span>
            <span className="flex-shrink-0 rounded-full bg-gold-50 dark:bg-gold-500/15 px-2 py-0.5 text-[10px] font-bold text-gold-700 dark:text-gold-300">
              {GALLERY_STATUS_LABELS[gallery.status] || gallery.status}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2 text-xs text-gray-500 dark:text-gray-400">
            <span>
              {gallery.photo_count || 0} foto{gallery.photo_count === 1 ? "" : "s"} · {gallery.selected_count || 0} escolhida{gallery.selected_count === 1 ? "" : "s"}
            </span>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button onClick={handleCopyLink} className="font-semibold text-gold-600 dark:text-gold-400 hover:underline">
                {copied ? "Copiado!" : "Copiar link"}
              </button>
              <a href="/galeria" className="font-semibold text-gold-600 dark:text-gold-400 hover:underline">
                Abrir painel
              </a>
            </div>
          </div>
        </div>
      ) : (
        <button
          onClick={handleCreate}
          disabled={creating}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-gold-500/15 hover:bg-gold-500/25 text-gold-700 dark:text-gold-300 text-sm font-semibold rounded-lg transition-colors disabled:opacity-60"
        >
          <Images size={14} />
          {creating ? "Criando..." : "Criar galeria de seleção"}
        </button>
      )}
    </section>
  );
}

// ─── Observações editáveis (substitui texto read-only) ─────────────────
function EditableNotesSection({
  jobId,
  initialNotes,
  onSaved,
}: {
  jobId: number;
  initialNotes: string;
  onSaved: (notes: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(initialNotes);
  const [saving, setSaving] = useState(false);

  useEffect(() => { setValue(initialNotes); }, [initialNotes, jobId]);

  async function save() {
    if (value === initialNotes) { setEditing(false); return; }
    setSaving(true);
    try {
      await authFetch(`/api/jobs/${jobId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: value }),
      });
      onSaved(value);
      setEditing(false);
    } finally { setSaving(false); }
  }

  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
          Observações
        </h3>
        {!editing && (
          <button
            onClick={() => setEditing(true)}
            className="text-[10px] text-gold-600 hover:text-gold-700 font-semibold"
          >
            {initialNotes ? 'Editar' : '+ Adicionar'}
          </button>
        )}
      </div>
      {editing ? (
        <div className="space-y-2">
          <textarea
            autoFocus
            value={value}
            onChange={e => setValue(e.target.value)}
            rows={4}
            placeholder="Ex: mãe pediu pra editar mais a pele, foco no bebê..."
            className="w-full rounded-xl border border-gray-200 p-3 text-sm text-gray-700 outline-none focus:border-gold-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
          />
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => { setValue(initialNotes); setEditing(false); }}
              disabled={saving}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-gray-200 text-gray-600 hover:border-gray-300 dark:border-gray-700 dark:text-gray-300"
            >
              Cancelar
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-gold-600 text-white hover:bg-gold-700 disabled:opacity-60"
            >
              {saving ? 'Salvando…' : 'Salvar'}
            </button>
          </div>
        </div>
      ) : initialNotes ? (
        <p className="rounded-xl border border-gray-200 p-3 text-sm text-gray-700 dark:border-gray-700 dark:text-gray-300 whitespace-pre-wrap">
          {initialNotes}
        </p>
      ) : (
        <p className="rounded-xl border border-dashed border-gray-200 p-3 text-xs text-gray-400 italic dark:border-gray-700">
          Sem observações. Clique em "+ Adicionar" pra escrever.
        </p>
      )}
    </section>
  );
}

// ─── Upload de imagem de capa do card ──────────────────────────────────
function CoverImageSection({
  jobId,
  currentUrl,
  onChanged,
}: {
  jobId: number;
  currentUrl: string | null;
  onChanged: (url: string | null) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function uploadFile(file: File) {
    setError(null);
    if (!file.type.startsWith('image/')) { setError('Arquivo precisa ser imagem'); return; }
    if (file.size > 5_242_880) { setError('Imagem muito grande (>5MB)'); return; }

    setUploading(true);
    try {
      // Redimensiona pra 1200px max via canvas pra economizar storage
      const dataUrl = await resizeImage(file, 1200);
      const r = await authFetch(`/api/jobs/${jobId}/cover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataUrl }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error || `HTTP ${r.status}`);
      }
      const j = await r.json();
      onChanged(j.cover_image_url);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }

  async function remove() {
    setUploading(true);
    try {
      await authFetch(`/api/jobs/${jobId}/cover`, { method: 'DELETE' });
      onChanged(null);
    } finally { setUploading(false); }
  }

  function handlePaste(e: React.ClipboardEvent) {
    const items = Array.from(e.clipboardData?.items || []) as DataTransferItem[];
    const item = items.find(it => it.type.startsWith('image/'));
    if (item) {
      const file = item.getAsFile();
      if (file) uploadFile(file);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (file) uploadFile(file);
  }

  return (
    <section onPaste={handlePaste}>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
          Imagem de referência
        </h3>
        {currentUrl && (
          <button
            onClick={remove}
            disabled={uploading}
            className="text-[10px] text-red-500 hover:text-red-600 font-semibold"
          >
            Remover
          </button>
        )}
      </div>
      {currentUrl ? (
        <div className="relative group">
          <img
            src={currentUrl}
            alt="Capa do job"
            className="w-full max-h-72 object-cover rounded-xl border border-gray-200 dark:border-gray-700"
          />
          <button
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="absolute bottom-2 right-2 px-3 py-1.5 bg-white/95 dark:bg-gray-900/95 border border-gray-200 dark:border-gray-700 rounded-lg text-xs font-semibold opacity-0 group-hover:opacity-100 transition-opacity"
          >
            Trocar
          </button>
        </div>
      ) : (
        <div
          onDragOver={e => e.preventDefault()}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          className="border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-xl p-6 text-center cursor-pointer hover:border-gold-400 hover:bg-gold-50/30 dark:hover:bg-gold-900/10 transition-colors"
        >
          <Image size={28} className="mx-auto text-gray-300 dark:text-gray-600 mb-2" />
          <p className="text-sm font-medium text-gray-600 dark:text-gray-300">
            {uploading ? 'Enviando…' : 'Arrastar, colar ou clicar pra escolher'}
          </p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
            Foto de referência da edição, capa do álbum, etc. (max 5MB)
          </p>
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={e => {
          const f = e.target.files?.[0];
          if (f) uploadFile(f);
          e.target.value = '';
        }}
      />
      {error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
    </section>
  );
}

// ─── Editor do pacote vendido: nome, valor, desconto + trocar do catálogo ──
function PackageEditor({
  pkg,
  catalogCombos,
  catalogProdutos,
  catalogServicos,
  onSave,
}: {
  pkg: { name: string; value: number; discount: number; source: 'deal' | 'job' };
  catalogCombos: any[];
  catalogProdutos: any[];
  catalogServicos: any[];
  onSave: (patch: { name?: string; value?: number; discount?: number }) => void;
}) {
  const isJob = pkg.source === 'job';
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(pkg.name);
  const [value, setValue] = useState(String(pkg.value));
  const [discount, setDiscount] = useState(String(pkg.discount || 0));
  const [discountMode, setDiscountMode] = useState<'value' | 'percent'>('value');
  const [swapOpen, setSwapOpen] = useState(false);
  const [swapType, setSwapType] = useState<'combo' | 'produto' | 'servico'>('combo');
  const [swapSearch, setSwapSearch] = useState('');
  const popRef = useRef<HTMLDivElement>(null);
  const swapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setName(pkg.name);
    setValue(String(pkg.value));
    setDiscount(String(pkg.discount || 0));
  }, [pkg.name, pkg.value, pkg.discount]);

  useEffect(() => {
    if (!editing && !swapOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (editing && popRef.current && !popRef.current.contains(e.target as Node)) setEditing(false);
      if (swapOpen && swapRef.current && !swapRef.current.contains(e.target as Node)) setSwapOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [editing, swapOpen]);

  const cfg = CATALOG_CFG.combo;
  const gross = pkg.value;
  const discountAbs = pkg.discount || 0;
  const net = Math.max(0, gross - discountAbs);
  const hasDiscount = discountAbs > 0;

  function applyEdit() {
    const newValue = Math.max(0, parseFloat(value.replace(',', '.')) || 0);
    if (isJob) {
      onSave({ value: newValue });
      setEditing(false);
      return;
    }
    let newDiscount = Math.max(0, parseFloat(discount.replace(',', '.')) || 0);
    if (discountMode === 'percent') newDiscount = (newValue * newDiscount) / 100;
    onSave({ name: name.trim() || 'Pacote', value: newValue, discount: newDiscount });
    setEditing(false);
  }

  const swapList = swapType === 'combo'
    ? catalogCombos.filter((c: any) => c.ativo).map((c: any) => ({ id: c.id, nome: c.nome, value: c.preco_final }))
    : swapType === 'produto'
    ? catalogProdutos.filter((p: any) => p.ativo).map((p: any) => ({ id: p.id, nome: p.nome, value: p.preco_venda }))
    : catalogServicos.filter((s: any) => s.ativo).map((s: any) => ({ id: s.id, nome: s.nome, value: s.preco_base }));
  const swapFiltered = swapSearch
    ? swapList.filter((i: any) => i.nome.toLowerCase().includes(swapSearch.toLowerCase()))
    : swapList;

  function pickSwap(item: any) {
    setSwapOpen(false);
    setSwapSearch('');
    onSave({ name: item.nome, value: item.value, discount: 0 });
  }

  return (
    <>
      <div className={`relative flex items-center gap-2 px-3 py-2 rounded-xl border ${cfg.bg} ${cfg.border}`}>
        <span className={`flex-shrink-0 ${cfg.color}`}>{cfg.icon}</span>
        <span className="flex-1 text-sm text-gray-800 dark:text-gray-100 truncate min-w-0">{pkg.name}</span>
        <span className="text-[10px] font-semibold text-gray-400 bg-white/70 dark:bg-gray-800/70 px-1.5 py-0.5 rounded-full flex-shrink-0">{isJob ? 'Valor base' : 'Pacote'}</span>
        {hasDiscount ? (
          <div className="flex flex-col items-end leading-tight flex-shrink-0">
            <span className="text-[10px] line-through opacity-50 text-gray-500">{formatCurrency(gross)}</span>
            <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">{formatCurrency(net)}</span>
          </div>
        ) : (
          <span className="text-xs font-semibold text-gray-700 dark:text-gray-300 flex-shrink-0">{formatCurrency(gross)}</span>
        )}
        <button
          onMouseDown={e => e.preventDefault()}
          onClick={() => { setEditing(o => !o); setSwapOpen(false); }}
          title={isJob ? 'Editar valor' : 'Editar pacote'}
          className="text-gray-300 hover:text-gold-600 dark:text-gray-600 dark:hover:text-gold-400 flex-shrink-0"
        >
          <Pencil size={13} />
        </button>
        {editing && (
          <div
            ref={popRef}
            className="absolute right-0 top-full mt-1 z-30 w-64 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl p-3 space-y-3"
            onClick={e => e.stopPropagation()}
          >
            {!isJob && (
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1">
                  Nome do pacote
                </label>
                <input
                  value={name}
                  onChange={e => setName(e.target.value)}
                  className="w-full px-2 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-lg outline-none focus:border-gold-400 dark:bg-gray-900"
                />
              </div>
            )}
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1">
                {isJob ? 'Valor do trabalho' : 'Valor'}
              </label>
              <input
                type="number" step="0.01" min="0" value={value}
                onChange={e => setValue(e.target.value)}
                autoFocus={isJob}
                className="w-full px-2 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-lg outline-none focus:border-gold-400 dark:bg-gray-900"
              />
            </div>
            {!isJob && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    Desconto
                  </label>
                  <div className="flex gap-0.5 text-[10px] font-semibold">
                    <button
                      onClick={() => setDiscountMode('value')}
                      className={`px-1.5 py-0.5 rounded ${discountMode === 'value' ? 'bg-gold-500 text-white' : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
                    >R$</button>
                    <button
                      onClick={() => setDiscountMode('percent')}
                      className={`px-1.5 py-0.5 rounded ${discountMode === 'percent' ? 'bg-gold-500 text-white' : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
                    >%</button>
                  </div>
                </div>
                <input
                  type="number" step="0.01" min="0" value={discount}
                  onChange={e => setDiscount(e.target.value)}
                  placeholder="0"
                  className="w-full px-2 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-lg outline-none focus:border-gold-400 dark:bg-gray-900"
                />
              </div>
            )}
            <div className="flex gap-1.5 justify-end">
              <button
                onClick={() => setEditing(false)}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
              >Cancelar</button>
              <button
                onClick={applyEdit}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-gold-600 text-white hover:bg-gold-700"
              >Aplicar</button>
            </div>
          </div>
        )}
      </div>

      {/* Trocar pacote pelo catálogo - só para pacote de venda */}
      {!isJob && (
      <div ref={swapRef}>
        <button
          onMouseDown={e => e.preventDefault()}
          onClick={() => { setSwapOpen(o => !o); setEditing(false); }}
          className="flex items-center gap-1 text-[11px] font-semibold text-gray-400 hover:text-gold-600 dark:hover:text-gold-400 px-1 pt-1"
        >
          <RefreshCw size={11} /> Trocar pacote
        </button>
        {swapOpen && (
          <div className="border border-gray-200 dark:border-gray-700 rounded-xl p-3 bg-white dark:bg-gray-800 space-y-2 mt-1">
            <div className="grid grid-cols-3 gap-1">
              {(['combo', 'produto', 'servico'] as const).map(t => {
                const c = CATALOG_CFG[t];
                return (
                  <button
                    key={t}
                    onMouseDown={e => e.preventDefault()}
                    onClick={() => { setSwapType(t); setSwapSearch(''); }}
                    className={`flex items-center justify-center gap-1 py-1.5 rounded-lg border text-xs font-semibold transition-all ${
                      swapType === t ? `${c.bg} ${c.border} ${c.color}` : 'border-gray-200 dark:border-gray-600 text-gray-400'
                    }`}
                  >
                    {c.icon}
                    <span>{t === 'servico' ? 'Serviço' : t.charAt(0).toUpperCase() + t.slice(1)}</span>
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-2 border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-1.5 bg-gray-50 dark:bg-gray-900 focus-within:border-gold-400">
              <Search size={12} className="text-gray-400" />
              <input
                value={swapSearch}
                onChange={e => setSwapSearch(e.target.value)}
                placeholder="Buscar..."
                className="flex-1 text-sm bg-transparent outline-none text-gray-800 dark:text-gray-100 placeholder-gray-400"
              />
            </div>
            <div className="max-h-40 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-700/50 border border-gray-100 dark:border-gray-700 rounded-lg">
              {swapFiltered.length === 0 && (
                <p className="text-xs text-gray-400 text-center py-3">Nada encontrado</p>
              )}
              {swapFiltered.map((item: any) => (
                <button
                  key={item.id}
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => pickSwap(item)}
                  className="w-full flex items-center justify-between px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700/60 text-left text-sm"
                >
                  <span className="text-gray-800 dark:text-gray-100 truncate">{item.nome}</span>
                  <span className="text-xs font-semibold text-gray-400 ml-2 flex-shrink-0">{formatCurrency(item.value)}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      )}
    </>
  );
}

// ─── Editor inline de preço/desconto do item de job ────────────────────
function JobItemPriceEditor({
  item,
  onSave,
  hideDiscount = false,
}: {
  item: CatalogItem;
  onSave: (patch: { catalog_value?: number; discount_value?: number }) => void;
  hideDiscount?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [price, setPrice] = useState(String(item.catalog_value));
  const [discount, setDiscount] = useState(String(item.discount_value || 0));
  const [discountMode, setDiscountMode] = useState<'value' | 'percent'>('value');
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setPrice(String(item.catalog_value));
    setDiscount(String(item.discount_value || 0));
  }, [item.catalog_value, item.discount_value]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const gross = item.catalog_value * item.quantidade;
  const discountAbs = item.discount_value || 0;
  const finalValue = Math.max(0, gross - discountAbs);
  const hasDiscount = discountAbs > 0;
  const percentOff = gross > 0 ? Math.round((discountAbs / gross) * 100) : 0;

  function apply() {
    const newPrice = Math.max(0, parseFloat(price.replace(',', '.')) || 0);
    const patch: { catalog_value?: number; discount_value?: number } = {};
    if (newPrice !== item.catalog_value) patch.catalog_value = newPrice;
    if (!hideDiscount) {
      let newDiscount = Math.max(0, parseFloat(discount.replace(',', '.')) || 0);
      if (discountMode === 'percent') {
        const grossWithNewPrice = newPrice * item.quantidade;
        newDiscount = (grossWithNewPrice * newDiscount) / 100;
      }
      if (newDiscount !== (item.discount_value || 0)) patch.discount_value = newDiscount;
    }
    if (Object.keys(patch).length > 0) onSave(patch);
    setOpen(false);
  }

  return (
    <div className="relative flex-shrink-0">
      <button
        onMouseDown={e => e.preventDefault()}
        onClick={() => setOpen(o => !o)}
        title="Clique pra editar preço/desconto"
        className="text-xs font-semibold mr-1 px-1.5 py-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors text-right"
      >
        {hasDiscount ? (
          <div className="flex flex-col items-end leading-tight">
            <span className="text-[10px] line-through opacity-50 text-gray-500">
              {(gross).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0 })}
            </span>
            <span className="text-emerald-700 dark:text-emerald-400">
              {(finalValue).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0 })}
            </span>
          </div>
        ) : (
          <span className="text-gray-700 dark:text-gray-300">
            {(gross).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0 })}
          </span>
        )}
      </button>
      {open && (
        <div
          ref={popRef}
          className="absolute right-0 top-full mt-1 z-30 w-64 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl p-3 space-y-3"
          onClick={e => e.stopPropagation()}
        >
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1">
              Preço unitário
            </label>
            <input
              type="number" step="0.01" min="0" value={price}
              onChange={e => setPrice(e.target.value)}
              className="w-full px-2 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-lg outline-none focus:border-gold-400 dark:bg-gray-900"
            />
            <p className="text-[10px] text-gray-400 mt-1">
              Total bruto: {((parseFloat(price.replace(',', '.')) || 0) * item.quantidade).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
            </p>
          </div>
          {!hideDiscount && (
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                Desconto
              </label>
              <div className="flex gap-0.5 text-[10px] font-semibold">
                <button
                  onClick={() => setDiscountMode('value')}
                  className={`px-1.5 py-0.5 rounded ${discountMode === 'value' ? 'bg-gold-500 text-white' : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
                >R$</button>
                <button
                  onClick={() => setDiscountMode('percent')}
                  className={`px-1.5 py-0.5 rounded ${discountMode === 'percent' ? 'bg-gold-500 text-white' : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
                >%</button>
              </div>
            </div>
            <input
              type="number" step="0.01" min="0" value={discount}
              onChange={e => setDiscount(e.target.value)}
              placeholder="0"
              className="w-full px-2 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-lg outline-none focus:border-gold-400 dark:bg-gray-900"
            />
          </div>
          )}
          <div className="flex gap-1.5 justify-end">
            <button
              onClick={() => setOpen(false)}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
            >Cancelar</button>
            <button
              onClick={apply}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-gold-600 text-white hover:bg-gold-700"
            >Aplicar</button>
          </div>
        </div>
      )}
    </div>
  );
}

// Redimensiona imagem via canvas pra max width N, retorna data URL JPEG
async function resizeImage(file: File, maxWidth: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new window.Image();
      img.onload = () => {
        const ratio = Math.min(1, maxWidth / img.width);
        const w = Math.round(img.width * ratio);
        const h = Math.round(img.height * ratio);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('canvas indisponível'));
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = () => reject(new Error('falha ao carregar imagem'));
      img.src = String(reader.result);
    };
    reader.onerror = () => reject(new Error('falha lendo arquivo'));
    reader.readAsDataURL(file);
  });
}

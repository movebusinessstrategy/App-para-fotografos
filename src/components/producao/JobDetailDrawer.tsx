import React, { useEffect, useRef, useState } from "react";
import {
  X, User, Phone, Mail, Instagram, MapPin, Calendar,
  CheckSquare, Square, Trash2, Plus, Image, Clock,
  ChevronRight, Tag, FileText, LogOut,
  DollarSign, Package, Layers, Briefcase, Search, CreditCard
} from "lucide-react";
import { SearchableSelect } from "../ui/SearchableSelect";
import { ContractGenerator } from "../contracts/ContractGenerator";
import { authFetch } from "../../utils/authFetch";
import { parseDate } from "../../utils/date";
import { JobWithProduction } from "./ProductionBoard";

const LABEL_COLORS = ['#6366f1','#ec4899','#f59e0b','#10b981','#0ea5e9','#f43f5e','#8b5cf6','#22c55e'];
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
}

const formatCurrency = (v: number) =>
  (v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 0 });

const formatDuration = (ms: number | null | undefined) => {
  if (ms == null) return "—";
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

export function JobDetailDrawer({ job, stages, onClose, onStageChange, onLabelsChange, onRemoveFromProduction }: JobDetailDrawerProps) {
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
  const [newLabel, setNewLabel] = useState("");
  const [showContract, setShowContract] = useState(false);

  // ── Financeiro ──
  const [dealItems, setDealItems] = useState<CatalogItem[]>([]);
  const [jobItems, setJobItems] = useState<CatalogItem[]>([]);
  const [payments, setPayments] = useState<JobPayment[]>([]);
  const [jobAmount, setJobAmount] = useState(0);
  const [loadingFin, setLoadingFin] = useState(false);
  // Adicionar pagamento
  const [newPayment, setNewPayment] = useState({ amount: '', description: '', payment_date: new Date().toISOString().slice(0, 10), payment_method: 'Pix' });
  const [savingPayment, setSavingPayment] = useState(false);
  // Adicionar item ao job
  const [showAddJobItem, setShowAddJobItem] = useState(false);
  const [jobItemType, setJobItemType] = useState<'combo' | 'produto' | 'servico'>('servico');
  const [jobItemSearch, setJobItemSearch] = useState('');
  const [jobItemOpen, setJobItemOpen] = useState(false);
  const [catalogProdutos, setCatalogProdutos] = useState<any[]>([]);
  const [catalogServicos, setCatalogServicos] = useState<any[]>([]);
  const [catalogCombos, setCatalogCombos] = useState<any[]>([]);
  const jobItemRef = useRef<HTMLDivElement>(null);

  const loadFinanceiro = async (jobId: number) => {
    setLoadingFin(true);
    try {
      const res = await authFetch(`/api/jobs/${jobId}/financeiro`);
      if (res.ok) {
        const data = await res.json();
        setDealItems(data.dealItems || []);
        setJobItems(data.jobItems || []);
        setPayments(data.payments || []);
        setJobAmount(data.jobAmount || 0);
      }
    } catch { }
    finally { setLoadingFin(false); }
  };

  useEffect(() => {
    authFetch('/api/produtos').then(r => r.json()).then(d => setCatalogProdutos(Array.isArray(d) ? d : [])).catch(() => {});
    authFetch('/api/servicos').then(r => r.json()).then(d => setCatalogServicos(Array.isArray(d) ? d : [])).catch(() => {});
    authFetch('/api/combos').then(r => r.json()).then(d => setCatalogCombos(Array.isArray(d) ? d : [])).catch(() => {});
  }, []);

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
    setShowAddJobItem(false);

    if (job.client_id) {
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

    loadFinanceiro(job.id);

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
    if (!job || !newPayment.amount || Number(newPayment.amount) <= 0) return;
    setSavingPayment(true);
    try {
      const res = await authFetch(`/api/jobs/${job.id}/payments`, {
        method: 'POST',
        body: JSON.stringify({ ...newPayment, amount: Number(newPayment.amount) }),
      });
      if (res.ok) {
        setNewPayment({ amount: '', description: '', payment_date: new Date().toISOString().slice(0, 10), payment_method: 'Pix' });
        loadFinanceiro(job.id);
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
    setJobItemOpen(false); setJobItemSearch(''); setShowAddJobItem(false);
    const res = await authFetch(`/api/jobs/${job.id}/items`, {
      method: 'POST',
      body: JSON.stringify({ catalog_type: jobItemType, catalog_id: catalogId, catalog_name: nome, catalog_value: value, quantidade: 1 }),
    });
    if (res.ok) loadFinanceiro(job.id);
  };

  const handleDeleteJobItem = async (id: string) => {
    if (!job) return;
    setJobItems(prev => prev.filter(i => i.id !== id));
    await authFetch(`/api/job-items/${id}`, { method: 'DELETE' });
    loadFinanceiro(job.id);
  };

  if (!job) return null;

  const jobDate = job.job_date ? parseDate(job.job_date) : null;
  const currentStageName = stages.find(s => s.id === job.production_stage)?.name || "—";

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

  const handleAddLabel = async () => {
    const trimmed = newLabel.trim();
    if (!trimmed || labels.includes(trimmed)) return;
    const next = [...labels, trimmed];
    setLabels(next);
    setNewLabel("");
    await authFetch(`/api/jobs/${job!.id}/labels`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ labels: next }),
    });
    onLabelsChange?.(job!.id, next);
  };

  const handleRemoveLabel = async (label: string) => {
    const next = labels.filter(l => l !== label);
    setLabels(next);
    await authFetch(`/api/jobs/${job!.id}/labels`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ labels: next }),
    });
    onLabelsChange?.(job!.id, next);
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
            <button
              onClick={() => setShowContract(true)}
              className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold text-gold-600 dark:text-gold-400 hover:bg-gold-50 dark:hover:bg-gold-500/10 transition-colors"
              title="Gerar contrato"
            >
              <FileText size={14} />
              Gerar contrato
            </button>
            {onRemoveFromProduction && (
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
          <span className="text-sm font-bold text-gray-800 dark:text-gray-100">
            {formatCurrency(job.amount)}
          </span>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200 dark:border-gray-700">
          {(["details", "financeiro", "testimonials"] as const).map((t) => {
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
                ) : (
                  <p className="text-sm text-gray-400">Sem cliente vinculado.</p>
                )}
              </section>

              {/* Job notes */}
              {job.notes && (
                <section>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                    Observações
                  </h3>
                  <p className="rounded-xl border border-gray-200 p-3 text-sm text-gray-700 dark:border-gray-700 dark:text-gray-300">
                    {job.notes}
                  </p>
                </section>
              )}

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
                      style={{ backgroundColor: getLabelColor(label) }}
                    >
                      <Tag size={10} />
                      {label}
                      <button onClick={() => handleRemoveLabel(label)} className="ml-0.5 text-white/70 hover:text-white">
                        <X size={10} />
                      </button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newLabel}
                    onChange={e => setNewLabel(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleAddLabel()}
                    placeholder="Nova etiqueta..."
                    className="flex-1 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-1.5 text-xs text-gray-700 dark:text-gray-200 focus:border-gold-500 focus:outline-none placeholder-gray-400 dark:placeholder-gray-500"
                  />
                  <button
                    onClick={handleAddLabel}
                    className="px-3 py-1.5 rounded-lg bg-gold-600 text-white text-xs hover:bg-gold-700"
                  >
                    <Plus size={13} />
                  </button>
                </div>
              </section>

              {/* Checklist — inline after labels */}
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

              {/* Move stage */}
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                  Mover etapa
                </h3>
                <SearchableSelect
                  value={job.production_stage || ""}
                  onChange={v => onStageChange(job.id, v)}
                  options={stages.map(s => ({ value: s.id, label: s.name }))}
                  placeholder="Selecionar etapa..."
                  className="w-full"
                />
              </section>
            </div>
          )}

          {/* ── FINANCEIRO TAB ── */}
          {tab === "financeiro" && (() => {
            const totalItens = [...dealItems, ...jobItems].reduce((s, i) => s + i.catalog_value * i.quantidade, 0);
            const totalGeral = jobAmount || totalItens;
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

                    {/* ── Itens do negócio (deal) ── */}
                    {dealItems.length > 0 && (
                      <section>
                        <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-2">
                          Itens do negócio
                        </h3>
                        <div className="space-y-1.5">
                          {dealItems.map(item => {
                            const cfg = CATALOG_CFG[item.catalog_type] || CATALOG_CFG.produto;
                            return (
                              <div key={item.id} className={`flex items-center gap-2 px-3 py-2 rounded-xl border ${cfg.bg} ${cfg.border}`}>
                                <span className={`flex-shrink-0 ${cfg.color}`}>{cfg.icon}</span>
                                <span className="flex-1 text-sm text-gray-800 dark:text-gray-100 truncate">{item.catalog_name}</span>
                                <span className="text-xs text-gray-400">{item.quantidade}x</span>
                                <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                                  {formatCurrency(item.catalog_value * item.quantidade)}
                                </span>
                              </div>
                            );
                          })}
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
                          onClick={() => setShowAddJobItem(v => !v)}
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
                                <span className="flex-1 text-sm text-gray-800 dark:text-gray-100 truncate">{item.catalog_name}</span>
                                <span className="text-xs text-gray-400">{item.quantidade}x</span>
                                <span className="text-xs font-semibold text-gray-700 dark:text-gray-300 mr-1">
                                  {formatCurrency(item.catalog_value * item.quantidade)}
                                </span>
                                <button onMouseDown={e => e.preventDefault()} onClick={() => handleDeleteJobItem(item.id)}
                                  className="text-gray-300 hover:text-red-500 dark:text-gray-600 dark:hover:text-red-400">
                                  <X size={13} />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {jobItems.length === 0 && !showAddJobItem && (
                        <p className="text-xs text-gray-400 dark:text-gray-500 text-center py-2">Nenhum item adicional</p>
                      )}

                      {/* Seletor de item */}
                      {showAddJobItem && (
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
                                      onClick={() => handleAddJobItem(item.id, item.nome, item.value)}
                                      className="w-full flex items-center justify-between px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700/60 text-left text-sm">
                                      <span className="text-gray-800 dark:text-gray-100 truncate">{item.nome}</span>
                                      <span className="text-xs font-semibold text-gray-400 ml-2 flex-shrink-0">{formatCurrency(item.value)}</span>
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                          <button onMouseDown={e => e.preventDefault()} onClick={() => setShowAddJobItem(false)}
                            className="w-full text-[11px] text-gray-400 hover:text-gray-600 py-0.5">Cancelar</button>
                        </div>
                      )}
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
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-[10px] text-gray-400 mb-0.5 block">Valor *</label>
                            <input
                              type="number"
                              placeholder="0,00"
                              value={newPayment.amount}
                              onChange={e => setNewPayment(p => ({ ...p, amount: e.target.value }))}
                              className="w-full border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 rounded-lg px-2 py-1.5 text-sm text-gray-900 dark:text-white outline-none focus:border-emerald-400 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
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
                          disabled={savingPayment || !newPayment.amount || Number(newPayment.amount) <= 0}
                          className="w-full py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                          <Plus size={14} /> Registrar Pagamento
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

      {/* Contract generator — full-screen, above drawer */}
      {showContract && (
        <ContractGenerator
          job={job}
          client={client}
          onClose={() => setShowContract(false)}
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

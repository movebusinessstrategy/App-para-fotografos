import React, { useEffect, useRef, useState } from "react";
import {
  X, User, Phone, Mail, Instagram, MapPin, Calendar,
  CheckSquare, Square, Trash2, Plus, Image, Clock,
  ChevronRight, Tag, FileText
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

interface JobDetailDrawerProps {
  job: JobWithProduction | null;
  stages: { id: string; name: string }[];
  onClose: () => void;
  onStageChange: (jobId: number, stageId: string) => void;
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

export function JobDetailDrawer({ job, stages, onClose, onStageChange }: JobDetailDrawerProps) {
  const [tab, setTab] = useState<"details" | "checklist" | "testimonials">("details");
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

  useEffect(() => {
    if (!job) return;
    setTab("details");
    setClient(null);
    setChecklist([]);
    setTestimonials([]);
    setStageHistory([]);
    setLabels(job.labels || []);

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
  };

  const handleRemoveLabel = async (label: string) => {
    const next = labels.filter(l => l !== label);
    setLabels(next);
    await authFetch(`/api/jobs/${job!.id}/labels`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ labels: next }),
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
            <button
              onClick={() => setShowContract(true)}
              className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 transition-colors"
              title="Gerar contrato"
            >
              <FileText size={14} />
              Gerar contrato
            </button>
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
          {(["details", "checklist", "testimonials"] as const).map((t) => {
            const labels: Record<string, string> = {
              details: "Detalhes",
              checklist: `Checklist${checklist.length > 0 ? ` ${done}/${checklist.length}` : ""}`,
              testimonials: `Depoimentos${testimonials.length > 0 ? ` (${testimonials.length})` : ""}`,
            };
            return (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex-1 py-3 text-xs font-semibold transition-colors ${
                  tab === t
                    ? "border-b-2 border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400"
                    : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                }`}
              >
                {labels[t]}
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
                    className="flex-1 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-1.5 text-xs text-gray-700 dark:text-gray-200 focus:border-indigo-500 focus:outline-none placeholder-gray-400 dark:placeholder-gray-500"
                  />
                  <button
                    onClick={handleAddLabel}
                    className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs hover:bg-indigo-700"
                  >
                    <Plus size={13} />
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

          {/* ── CHECKLIST TAB ── */}
          {tab === "checklist" && (
            <div className="p-5">
              <div className="mb-4 flex gap-2">
                <input
                  type="text"
                  value={newItem}
                  onChange={e => setNewItem(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleAddItem()}
                  placeholder="Novo item..."
                  className="flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-500"
                />
                <button
                  onClick={handleAddItem}
                  className="rounded-lg bg-blue-600 px-3 py-2 text-white hover:bg-blue-700"
                >
                  <Plus size={16} />
                </button>
              </div>

              {checklist.length === 0 ? (
                <p className="text-center text-sm text-gray-400 py-8">Nenhum item ainda.</p>
              ) : (
                <div className="space-y-2">
                  {checklist.map(item => (
                    <div
                      key={item.id}
                      className="flex items-center gap-3 rounded-lg border border-gray-200 px-3 py-2.5 dark:border-gray-700"
                    >
                      <button onClick={() => handleToggle(item)}>
                        {item.done
                          ? <CheckSquare size={18} className="text-blue-600 dark:text-blue-400" />
                          : <Square size={18} className="text-gray-400" />
                        }
                      </button>
                      <span className={`flex-1 text-sm ${item.done ? "line-through text-gray-400" : "text-gray-700 dark:text-gray-200"}`}>
                        {item.text}
                      </span>
                      <button
                        onClick={() => handleDeleteItem(item.id)}
                        className="text-gray-300 hover:text-red-500 dark:text-gray-600 dark:hover:text-red-400"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                  <p className="pt-2 text-right text-xs text-gray-400">
                    {done}/{checklist.length} concluídos
                  </p>
                </div>
              )}
            </div>
          )}

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
    </>
  );
}

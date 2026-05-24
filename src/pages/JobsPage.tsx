import React, { useMemo, useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { BarChart2, Workflow, Edit2, Inbox, LayoutGrid, Layers, List, ListChecks, Plus, Search, Settings, Tag, Trash2, X } from "lucide-react";
import GerenciaPage from "./GerenciaPage";
import TasksPage from "./TasksPage";
import { SearchableSelect } from "../components/ui/SearchableSelect";

import { ConfirmModal } from "../components/ui/ConfirmModal";
import JobFormModal from "../components/shared/JobFormModal";
import { ProductionBoard, JobWithProduction } from "../components/producao/ProductionBoard";
import { ProductionCustomizer } from "../components/producao/ProductionCustomizer";
import { JobDetailDrawer } from "../components/producao/JobDetailDrawer";
import { SalesOverviewPanel } from "../components/producao/SalesOverviewPanel";
import { PacoteAcompanhamentoModal } from "../components/producao/PacoteAcompanhamentoModal";
import { authFetch } from "../utils/authFetch";
import { useApi, refreshApi } from "../utils/useApi";
import { cn } from "../utils/cn";
import { parseDate } from "../utils/date";
import { normalizeText } from "../utils/normalizeText";
import { Client, Job, ProductionProcess, ProductionStageV2, TeamMember } from "../types";
import UsageBar from "../components/UsageBar";

const LABEL_COLORS = ['#6366f1','#ec4899','#f59e0b','#10b981','#0ea5e9','#f43f5e','#8b5cf6','#22c55e'];
function getLabelColor(label: string) {
  let hash = 0;
  for (let i = 0; i < label.length; i++) hash = label.charCodeAt(i) + ((hash << 5) - hash);
  return LABEL_COLORS[Math.abs(hash) % LABEL_COLORS.length];
}

export default function JobsPage() {
  // SWR: dados ficam em cache, navegar entre páginas e voltar = instantâneo.
  const { data: jobsData, isLoading: jobsLoading, mutate: mutateJobs } =
    useApi<JobWithProduction[]>("/api/jobs");
  const { data: clientsData } = useApi<Client[]>("/api/clients");
  const { data: processesData } = useApi<ProductionProcess[]>("/api/production/processes");
  const { data: stagesData, mutate: mutateStages } =
    useApi<ProductionStageV2[]>("/api/production/stages-v2");
  const { data: membersData } = useApi<TeamMember[]>("/api/team-members");
  const { data: jobLabelsData } = useApi<{ name: string; color: string }[]>("/api/jobs/labels");
  // Cor da etiqueta: vem da paleta padronizada; senão, cor por hash.
  const labelColor = (name: string) =>
    (jobLabelsData || []).find((l) => l.name === name)?.color || getLabelColor(name);

  const jobs = useMemo(() => Array.isArray(jobsData) ? jobsData : [], [jobsData]);
  const clients = useMemo(() => Array.isArray(clientsData) ? clientsData : [], [clientsData]);
  const processes = useMemo(() => Array.isArray(processesData) ? processesData : [], [processesData]);
  const stages = useMemo(() => Array.isArray(stagesData) ? stagesData : [], [stagesData]);
  const teamMembers = useMemo(() => Array.isArray(membersData) ? membersData : [], [membersData]);

  // Mostra spinner só no primeiro load (sem dado em cache ainda)
  const loading = jobsLoading && !jobsData;

  const [activeTab, setActiveTab] = useState<"funil" | "lista" | "vendas" | "gerencia" | "tarefas">("funil");
  const [customizerOpen, setCustomizerOpen] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [showPacoteModal, setShowPacoteModal] = useState(false);
  const [editingJob, setEditingJob] = useState<Job | null>(null);
  const [filters, setFilters] = useState({ type: "all" });
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedJob, setSelectedJob] = useState<JobWithProduction | null>(null);
  const [confirmModal, setConfirmModal] = useState<{
    open: boolean;
    onConfirm: () => void;
    title: string;
    message: string;
    variant?: "danger" | "warning";
  }>({ open: false, onConfirm: () => {}, title: "", message: "" });

  // Substitui o antigo fetchData() - revalida tudo de uma vez.
  const refreshAll = () => {
    mutateJobs();
    refreshApi("/api/clients");
    refreshApi("/api/production/processes");
    mutateStages();
    refreshApi("/api/team-members");
  };

  const filteredJobs = useMemo(() => jobs.filter(job => {
    const matchesType = filters.type === "all" || job.job_type === filters.type;
    const q = normalizeText(searchQuery);
    const matchesSearch = !q
      || normalizeText(job.client_name || '').includes(q)
      || normalizeText(job.job_name || '').includes(q);
    return matchesType && matchesSearch;
  }), [jobs, filters, searchQuery]);

  const handleAssigneeChange = async (jobId: number, assigneeId: string | null) => {
    // Optimistic update via SWR mutate
    mutateJobs(
      prev => (prev || []).map(j => j.id === jobId ? { ...j, assignee_id: assigneeId } : j),
      { revalidate: false }
    );
    try {
      await authFetch(`/api/jobs/${jobId}/assignee`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignee_id: assigneeId }),
      });
    } catch (err) {
      console.error("Erro ao atribuir responsável:", err);
      mutateJobs(); // rollback via re-fetch em caso de erro
    }
  };

  const handleStageChange = async (jobId: number, stageId: string) => {
    mutateJobs(
      prev => (prev || []).map(j => j.id === jobId
        ? { ...j, production_stage: stageId, production_stage_entered_at: new Date().toISOString() }
        : j
      ),
      { revalidate: false }
    );
    try {
      await authFetch(`/api/jobs/${jobId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ production_stage: stageId }),
      });
    } catch (err) {
      console.error("Erro ao mover etapa:", err);
      mutateJobs();
    }
  };

  const handleRemoveFromProduction = async (jobId: number) => {
    mutateJobs(
      prev => (prev || []).map(j => j.id === jobId
        ? { ...j, production_stage: null, production_stage_entered_at: null }
        : j
      ),
      { revalidate: false }
    );
    try {
      await authFetch(`/api/jobs/${jobId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ production_stage: null }),
      });
    } catch (err) {
      console.error("Erro ao remover da produção:", err);
      mutateJobs();
    }
  };

  const handleDelete = (id: number) => {
    setConfirmModal({
      open: true,
      title: "Excluir trabalho",
      message: "Deseja excluir este trabalho? Esta ação não pode ser desfeita.",
      variant: "danger",
      onConfirm: async () => {
        await authFetch(`/api/jobs/${id}`, { method: "DELETE" });
        mutateJobs();
      },
    });
  };

  const getStageLabel = (job: JobWithProduction) => {
    if (!job.production_stage) return null;
    const stage = stages.find(s => s.id === job.production_stage);
    const proc = stage ? processes.find(p => p.id === stage.process_id) : null;
    return stage ? { stageName: stage.name, processName: proc?.name, color: stage.color || proc?.color || '#94a3b8' } : null;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gold-600 dark:border-gold-400" />
      </div>
    );
  }

  const jobTypes = Array.from(new Set(jobs.map(j => j.job_type))).filter(Boolean) as string[];

  return (
    <>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex-1">
            <h3 className="text-2xl font-bold text-gray-800 dark:text-white">Produção</h3>
            <p className="text-gray-500 dark:text-gray-400 text-sm">Gerencie o fluxo de produção dos seus ensaios.</p>
            <div className="mt-3 max-w-xs">
              <UsageBar resource="jobs" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            {activeTab === "funil" && processes.length > 0 && (
              <button
                onClick={() => setCustomizerOpen(true)}
                className="flex items-center gap-2 px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600 text-sm font-medium transition-colors shadow-sm"
              >
                <Settings size={15} />
                Configurar
              </button>
            )}
            {/* View toggle */}
            <div className="flex bg-gray-100 dark:bg-gray-800 rounded-xl p-1 gap-1">
              <button
                onClick={() => setActiveTab("funil")}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all',
                  activeTab === "funil"
                    ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm"
                    : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                )}
              >
                <LayoutGrid size={15} />
                Kanban
              </button>
              <button
                onClick={() => setActiveTab("lista")}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all',
                  activeTab === "lista"
                    ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm"
                    : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                )}
              >
                <List size={15} />
                Lista
              </button>
              <button
                onClick={() => setActiveTab("vendas")}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all',
                  activeTab === "vendas"
                    ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm"
                    : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                )}
              >
                <Inbox size={15} />
                Vendas recentes
              </button>
              <button
                onClick={() => setActiveTab("gerencia")}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all',
                  activeTab === "gerencia"
                    ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm"
                    : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                )}
              >
                <BarChart2 size={15} />
                Gerência
              </button>
              <button
                onClick={() => setActiveTab("tarefas")}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all',
                  activeTab === "tarefas"
                    ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm"
                    : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                )}
              >
                <ListChecks size={15} />
                Tarefas
              </button>
            </div>

            {activeTab !== "gerencia" && activeTab !== "tarefas" && activeTab !== "vendas" && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowPacoteModal(true)}
                  className="flex items-center gap-2 px-3 py-2 border border-gold-300 dark:border-gold-500/40 text-gold-700 dark:text-gold-300 rounded-xl font-semibold hover:bg-gold-50 dark:hover:bg-gold-500/10 transition-all text-sm"
                >
                  <Layers size={16} />
                  Pacote
                </button>
                <button
                  onClick={() => { setEditingJob(null); setShowModal(true); }}
                  className="flex items-center gap-2 px-4 py-2 bg-gold-600 dark:bg-gold-500 text-white rounded-xl font-semibold hover:bg-gold-700 dark:hover:bg-gold-600 shadow-md shadow-gold-100 dark:shadow-gold-500/20 transition-all text-sm"
                >
                  <Plus size={16} />
                  Novo trabalho
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Filters - only for Kanban/List job views */}
        {activeTab !== "gerencia" && activeTab !== "tarefas" && activeTab !== "vendas" && <div className="flex flex-wrap items-center gap-3 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-3 shadow-sm">
          {/* Search */}
          <div className="relative flex-1 min-w-[200px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 pointer-events-none" />
            <input
              type="text"
              placeholder="Buscar cliente..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-lg outline-none bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500 focus:border-gold-400 dark:focus:border-gold-500 transition-colors"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
                <X size={13} />
              </button>
            )}
          </div>

          {/* Type searchable dropdown */}
          <SearchableSelect
            value={filters.type}
            onChange={v => setFilters(prev => ({ ...prev, type: v }))}
            placeholder="Tipo de ensaio"
            highlighted
            options={[
              { value: "all", label: "Todos os tipos" },
              ...jobTypes.map(t => ({ value: t, label: t })),
            ]}
          />

          {(filters.type !== 'all' || searchQuery) && (
            <button
              onClick={() => { setFilters({ type: "all" }); setSearchQuery(""); }}
              className="flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors"
            >
              <X size={14} />
              Limpar
            </button>
          )}
        </div>}

        {/* Gerência tab */}
        {activeTab === "gerencia" && <GerenciaPage />}

        {/* Tarefas tab */}
        {activeTab === "tarefas" && <TasksPage />}

        {/* Vendas recentes tab */}
        {activeTab === "vendas" && (
          <SalesOverviewPanel
            processes={processes}
            stages={stages}
            onRefreshJobs={() => mutateJobs()}
          />
        )}

        {/* Content - funil / lista */}
        {activeTab !== "gerencia" && activeTab !== "tarefas" && activeTab !== "vendas" && (activeTab === "funil" ? (
          processes.length > 0 ? (
            <ProductionBoard
              jobs={filteredJobs}
              processes={processes}
              stages={stages}
              teamMembers={teamMembers}
              onChangeStage={handleStageChange}
              onJobClick={job => setSelectedJob(job)}
              onStagesUpdate={(newStages) => mutateStages(newStages, { revalidate: false })}
              onAssigneeChange={handleAssigneeChange}
              onRemoveFromProduction={handleRemoveFromProduction}
              onReorderInStage={async (stageId, orderedJobIds) => {
                // Optimista: aplica nova ordem no cache local imediatamente
                mutateJobs(prev => (prev || []).map(j => {
                  const idx = orderedJobIds.indexOf(j.id);
                  return idx >= 0 ? { ...j, position: idx } : j;
                }), { revalidate: false });
                try {
                  await authFetch('/api/jobs/reorder', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ stage_id: stageId, job_ids: orderedJobIds }),
                  });
                } catch (_) {
                  mutateJobs(); // reverte buscando do servidor se der ruim
                }
              }}
            />
          ) : (
            <div className="flex flex-col items-center justify-center py-24 gap-3">
              <p className="text-gray-500 dark:text-gray-400 text-sm font-medium">Processos não carregados</p>
              <p className="text-gray-400 dark:text-gray-500 text-xs text-center max-w-sm">
                Reinicie o servidor para ativar os novos endpoints de produção.<br/>
                Depois, execute o SQL no Supabase para criar as tabelas necessárias.
              </p>
              <button
                onClick={refreshAll}
                className="mt-2 px-4 py-2 bg-gold-600 text-white text-sm rounded-xl hover:bg-gold-700 transition-colors"
              >
                Tentar novamente
              </button>
            </div>
          )
        ) : (
          /* ── Lista ── */
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-sm overflow-hidden">
            <table className="w-full text-left">
              <thead className="bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wider">
                <tr>
                  <th className="px-6 py-3 font-semibold">Cliente</th>
                  <th className="px-6 py-3 font-semibold">Tipo</th>
                  <th className="px-6 py-3 font-semibold">Data</th>
                  <th className="px-6 py-3 font-semibold">Valor</th>
                  <th className="px-6 py-3 font-semibold">Etapa</th>
                  <th className="px-6 py-3 font-semibold">Etiquetas</th>
                  <th className="px-6 py-3 font-semibold">Status</th>
                  <th className="px-6 py-3 font-semibold text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {filteredJobs.map(job => {
                  const jobDate = parseDate(job.job_date);
                  const stageInfo = getStageLabel(job);
                  return (
                    <tr key={job.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors group">
                      <td className="px-6 py-4">
                        <button
                          onClick={() => setSelectedJob(job)}
                          className="flex items-center gap-2 font-medium text-gray-900 dark:text-white hover:text-gold-600 dark:hover:text-gold-400 transition-colors text-left"
                        >
                          <Workflow size={14} className="text-gray-400 flex-shrink-0" />
                          {job.client_name || clients.find(c => c.id === job.client_id)?.name || job.job_name || "Trabalho"}
                        </button>
                      </td>
                      <td className="px-6 py-4 text-gray-600 dark:text-gray-300 text-sm">{job.job_type}</td>
                      <td className="px-6 py-4 text-gray-500 dark:text-gray-400 text-sm">
                        {jobDate ? format(jobDate, "dd/MM/yyyy", { locale: ptBR }) : "-"}
                        {job.job_time && <span className="text-xs text-gray-400"> · {job.job_time}</span>}
                      </td>
                      <td className="px-6 py-4 font-semibold text-gray-900 dark:text-white text-sm">
                        R$ {(job.amount ?? 0).toLocaleString("pt-BR")}
                      </td>
                      <td className="px-6 py-4">
                        {stageInfo ? (
                          <div>
                            <span
                              className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold text-white"
                              style={{ backgroundColor: stageInfo.color }}
                            >
                              {stageInfo.stageName}
                            </span>
                            {stageInfo.processName && (
                              <p className="text-[10px] text-gray-400 mt-0.5">{stageInfo.processName}</p>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-gray-400">-</span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-wrap gap-1">
                          {(job.labels || []).map(label => (
                            <span
                              key={label}
                              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-semibold text-white"
                              style={{ backgroundColor: labelColor(label) }}
                            >
                              <Tag size={8} />
                              {label}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className={cn(
                          "px-2 py-1 rounded-full text-[10px] font-bold uppercase",
                          job.status === "completed"
                            ? "bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400"
                            : job.status === "cancelled"
                            ? "bg-rose-100 dark:bg-rose-500/20 text-rose-700 dark:text-rose-400"
                            : "bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400"
                        )}>
                          {job.status === "scheduled" ? "Agendado" : job.status === "completed" ? "Concluído" : "Cancelado"}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center gap-2 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => { setEditingJob(job); setShowModal(true); }}
                            className="p-2 text-gray-500 dark:text-gray-400 hover:text-gold-600 dark:hover:text-gold-400 hover:bg-gold-50 dark:hover:bg-gold-500/10 rounded-lg transition-colors"
                            title="Editar"
                          >
                            <Edit2 size={15} />
                          </button>
                          <button
                            onClick={() => handleDelete(job.id)}
                            className="p-2 text-gray-500 dark:text-gray-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg transition-colors"
                            title="Excluir"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}

                {filteredJobs.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-6 py-12 text-center text-sm text-gray-400 dark:text-gray-500">
                      Nenhum trabalho encontrado.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ))}
      </div>

      {/* Job form modal */}
      {showModal && (
        <JobFormModal
          clients={clients}
          job={editingJob}
          onClose={() => { setShowModal(false); setEditingJob(null); }}
          onSave={() => { setShowModal(false); setEditingJob(null); mutateJobs(); }}
        />
      )}

      {/* Pacote de acompanhamento - gera vários trabalhos de uma vez */}
      {showPacoteModal && (
        <PacoteAcompanhamentoModal
          clients={clients.map((c) => ({ id: c.id, name: c.name }))}
          stageId={stages[0]?.id ?? null}
          onClose={() => setShowPacoteModal(false)}
          onCreated={() => mutateJobs()}
        />
      )}

      {/* Job detail drawer */}
      <JobDetailDrawer
        job={selectedJob}
        stages={stages.map(s => ({ id: s.id, name: s.name }))}
        onClose={() => setSelectedJob(null)}
        onStageChange={(jobId, stageId) => {
          handleStageChange(jobId, stageId);
          setSelectedJob(prev => prev ? { ...prev, production_stage: stageId, production_stage_entered_at: new Date().toISOString() } : null);
        }}
        onLabelsChange={(jobId, labels) => {
          mutateJobs(
            prev => (prev || []).map(j => j.id === jobId ? { ...j, labels } : j),
            { revalidate: false }
          );
        }}
        onRemoveFromProduction={(jobId) => {
          handleRemoveFromProduction(jobId);
          setSelectedJob(null);
        }}
        onJobUpdate={(jobId, patch) => {
          mutateJobs(
            prev => (prev || []).map(j => j.id === jobId ? { ...j, ...patch } : j),
            { revalidate: false }
          );
          setSelectedJob(prev => prev && prev.id === jobId ? { ...prev, ...patch } : prev);
        }}
      />

      <ConfirmModal
        open={confirmModal.open}
        title={confirmModal.title}
        message={confirmModal.message}
        confirmText="Confirmar"
        variant={confirmModal.variant || "danger"}
        onConfirm={() => { confirmModal.onConfirm(); setConfirmModal(prev => ({ ...prev, open: false })); }}
        onCancel={() => setConfirmModal(prev => ({ ...prev, open: false }))}
      />

      <ProductionCustomizer
        open={customizerOpen}
        processes={processes}
        stages={stages}
        onClose={() => setCustomizerOpen(false)}
        onUpdated={() => refreshAll()}
      />

    </>
  );
}

import React, { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Calendar as CalendarIcon, Camera, Edit2, Plus, Trash2 } from "lucide-react";

import { ConfirmModal } from "../components/ui/ConfirmModal";
import JobFormModal from "../components/shared/JobFormModal";
import { ProductionBoard, ProductionStage, JobWithProduction } from "../components/producao/ProductionBoard";
import { JobDetailDrawer } from "../components/producao/JobDetailDrawer";
import { authFetch } from "../utils/authFetch";
import { cn } from "../utils/cn";
import { parseDate } from "../utils/date";
import { Client, Job } from "../types";

export default function JobsPage() {
  const [jobs, setJobs] = useState<JobWithProduction[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"funil" | "lista">("funil");
  const [showModal, setShowModal] = useState(false);
  const [editingJob, setEditingJob] = useState<Job | null>(null);
  const [filters, setFilters] = useState({ type: "all", client: "all", status: "all" });
  const [confirmModal, setConfirmModal] = useState<{
    open: boolean;
    onConfirm: () => void;
    title: string;
    message: string;
    variant?: "danger" | "warning";
  }>({ open: false, onConfirm: () => {}, title: "", message: "" });
  const [selectedJob, setSelectedJob] = useState<JobWithProduction | null>(null);
  const [productionStages, setProductionStages] = useState<ProductionStage[]>([
    { id: "prod-agendado", name: "Agendado", position: 0, color: "#22c55e" },
    { id: "prod-ensaio-realizado", name: "Ensaio Realizado", position: 1, color: "#fbbf24" },
    { id: "prod-em-edicao", name: "Em Edição", position: 2, color: "#3b82f6" },
    { id: "prod-entregue", name: "Entregue", position: 3, color: "#a855f7" },
  ]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [jobsRes, clientsRes, productionRes] = await Promise.all([
        authFetch("/api/jobs"),
        authFetch("/api/clients"),
        authFetch("/api/production/stages").catch(() => null),
      ]);
      setJobs(await jobsRes.json());
      setClients(await clientsRes.json());
      if (productionRes && productionRes.ok) {
        const stages = await productionRes.json();
        setProductionStages(
          stages.map((s: any, idx: number) => ({
            id: s.id || s.name || `stage-${idx}`,
            name: s.name,
            position: s.position ?? idx,
            color: s.color,
          }))
        );
      }
    } catch (error) {
      console.error("Erro ao carregar agendamentos:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const filteredJobs = useMemo(() => {
    return jobs.filter((job) => {
      const matchesType = filters.type === "all" || job.job_type === filters.type;
      const matchesClient = filters.client === "all" || String(job.client_id) === filters.client;
      const matchesStatus = filters.status === "all" || job.status === filters.status;
      return matchesType && matchesClient && matchesStatus;
    });
  }, [jobs, filters]);

  const handleProductionStageChange = async (jobId: number, stageId: string) => {
    setJobs((prev) =>
      prev.map((job) => (job.id === jobId ? { ...job, production_stage: stageId } : job))
    );

    try {
      await authFetch(`/api/jobs/${jobId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ production_stage: stageId }),
      });
    } catch (error) {
      console.error("Erro ao atualizar estágio de produção:", error);
    }
  };

  const handleDelete = (id: number) => {
    setConfirmModal({
      open: true,
      title: "Excluir agendamento",
      message: "Deseja excluir este agendamento/trabalho?",
      variant: "danger",
      onConfirm: async () => {
        await authFetch(`/api/jobs/${id}`, { method: "DELETE" });
        fetchData();
      },
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 dark:border-indigo-400" />
      </div>
    );
  }

  const jobTypes = Array.from(new Set(jobs.map((j) => j.job_type))).filter(Boolean);

  return (
    <>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h3 className="text-2xl font-bold text-gray-800 dark:text-white">Agendamentos/Trabalhos</h3>
            <p className="text-gray-500 dark:text-gray-400">Gerencie seus ensaios, sessões e tarefas agendadas.</p>
          </div>
          <button
            onClick={() => {
              setEditingJob(null);
              setShowModal(true);
            }}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 dark:bg-indigo-500 text-white rounded-xl font-bold hover:bg-indigo-700 dark:hover:bg-indigo-600 shadow-md shadow-indigo-100 dark:shadow-indigo-500/20 transition-all"
          >
            <Plus size={20} />
            Novo agendamento
          </button>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => setActiveTab("funil")}
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
              activeTab === "funil"
                ? "bg-blue-500 text-white"
                : "bg-white text-gray-700 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
            }`}
          >
            Funil de Produção
          </button>
          <button
            onClick={() => setActiveTab("lista")}
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
              activeTab === "lista"
                ? "bg-blue-500 text-white"
                : "bg-white text-gray-700 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
            }`}
          >
            Lista
          </button>
        </div>

        {/* FILTROS */}
        <div className="flex flex-wrap gap-3 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 shadow-sm">
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500 dark:text-gray-400">Tipo</span>
            <select
              value={filters.type}
              onChange={(e) => setFilters((prev) => ({ ...prev, type: e.target.value }))}
              className="text-sm border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 outline-none bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 focus:border-indigo-300 dark:focus:border-indigo-500"
            >
              <option value="all">Todos</option>
              {jobTypes.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500 dark:text-gray-400">Cliente</span>
            <select
              value={filters.client}
              onChange={(e) => setFilters((prev) => ({ ...prev, client: e.target.value }))}
              className="text-sm border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 outline-none bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 focus:border-indigo-300 dark:focus:border-indigo-500"
            >
              <option value="all">Todos</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500 dark:text-gray-400">Status</span>
            <select
              value={filters.status}
              onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value }))}
              className="text-sm border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 outline-none bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 focus:border-indigo-300 dark:focus:border-indigo-500"
            >
              <option value="all">Todos</option>
              <option value="scheduled">Agendado</option>
              <option value="completed">Concluído</option>
              <option value="cancelled">Cancelado</option>
            </select>
          </div>
          <button
            onClick={() => setFilters({ type: "all", client: "all", status: "all" })}
            className="text-sm text-gray-500 dark:text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
          >
            Limpar filtros
          </button>
        </div>

        {activeTab === "funil" ? (
          <ProductionBoard
            jobs={filteredJobs}
            stages={productionStages}
            onChangeStage={handleProductionStageChange}
            onJobClick={(job) => setSelectedJob(job)}
          />
        ) : (
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-sm overflow-hidden">
            {/* TABELA */}
            <table className="w-full text-left">
              <thead className="bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wider">
                <tr>
                  <th className="px-6 py-3 font-semibold">Cliente</th>
                  <th className="px-6 py-3 font-semibold">Tipo</th>
                <th className="px-6 py-3 font-semibold">Data</th>
                <th className="px-6 py-3 font-semibold">Valor</th>
                <th className="px-6 py-3 font-semibold">Status</th>
                <th className="px-6 py-3 font-semibold">Pagamento</th>
                <th className="px-6 py-3 font-semibold text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {filteredJobs.map((job) => {
                  const jobDate = parseDate(job.job_date);
                return (
                  <tr key={job.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors group">
                    <td className="px-6 py-4 font-medium text-gray-900 dark:text-white flex items-center gap-2">
                      <Camera size={14} className="text-gray-400 dark:text-gray-500" />
                      {job.client_name || clients.find((c) => c.id === job.client_id)?.name || job.job_name || "Tarefa"}
                    </td>
                    <td className="px-6 py-4 text-gray-600 dark:text-gray-300">{job.job_type}</td>
                    <td className="px-6 py-4 text-gray-500 dark:text-gray-400">
                      {jobDate ? format(jobDate, "dd/MM/yyyy", { locale: ptBR }) : "-"}
                      {job.job_time && <span className="text-xs text-gray-400 dark:text-gray-500"> · {job.job_time}</span>}
                    </td>
                    <td className="px-6 py-4 font-semibold text-gray-900 dark:text-white">
                      R$ {(job.amount ?? 0).toLocaleString("pt-BR")}
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={cn(
                          "px-2 py-1 rounded-full text-[10px] font-bold uppercase",
                          job.status === "completed"
                            ? "bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400"
                            : job.status === "cancelled"
                            ? "bg-rose-100 dark:bg-rose-500/20 text-rose-700 dark:text-rose-400"
                            : "bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400"
                        )}
                      >
                        {job.status === "scheduled" ? "Agendado" : job.status === "completed" ? "Concluído" : "Cancelado"}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={cn(
                          "px-2 py-1 rounded-full text-[10px] font-bold uppercase",
                          job.payment_status === "paid" 
                            ? "bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400" 
                            : "bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400"
                        )}
                      >
                        {job.payment_status === "paid" ? "Pago" : "Pendente"}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center gap-2 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => {
                            setEditingJob(job);
                            setShowModal(true);
                          }}
                          className="p-2 text-gray-500 dark:text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 rounded-lg transition-colors"
                          title="Editar"
                        >
                          <Edit2 size={16} />
                        </button>
                        <button 
                          onClick={() => handleDelete(job.id)} 
                          className="p-2 text-gray-500 dark:text-gray-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg transition-colors"
                          title="Excluir"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {filteredJobs.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-6 py-10 text-center text-sm text-gray-400 dark:text-gray-500">
                    Nenhum agendamento encontrado para os filtros selecionados.
                  </td>
                </tr>
              )}
              </tbody>
            </table>
          </div>
        )}

        {showModal && (
          <JobFormModal
            clients={clients}
            job={editingJob}
            onClose={() => {
              setShowModal(false);
              setEditingJob(null);
            }}
            onSave={() => {
              setShowModal(false);
              setEditingJob(null);
              fetchData();
            }}
          />
        )}
      </div>

      <JobDetailDrawer
        job={selectedJob}
        stages={productionStages}
        onClose={() => setSelectedJob(null)}
        onStageChange={(jobId, stageId) => {
          handleProductionStageChange(jobId, stageId);
          setSelectedJob(prev => prev ? { ...prev, production_stage: stageId } : null);
        }}
      />

      <ConfirmModal
        open={confirmModal.open}
        title={confirmModal.title}
        message={confirmModal.message}
        confirmText="Confirmar"
        variant={confirmModal.variant || "danger"}
        onConfirm={() => {
          confirmModal.onConfirm();
          setConfirmModal((prev) => ({ ...prev, open: false }));
        }}
        onCancel={() => setConfirmModal((prev) => ({ ...prev, open: false }))}
      />
    </>
  );
}

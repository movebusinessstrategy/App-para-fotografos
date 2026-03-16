import React, { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Calendar as CalendarIcon, Camera, Edit2, Plus, Trash2 } from "lucide-react";

import JobFormModal from "../components/shared/JobFormModal";
import { authFetch } from "../utils/authFetch";
import { cn } from "../utils/cn";
import { parseDate } from "../utils/date";
import { Client, Job } from "../types";

export default function JobsPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingJob, setEditingJob] = useState<Job | null>(null);
  const [filters, setFilters] = useState({ type: "all", client: "all", status: "all" });

  const fetchData = async () => {
    setLoading(true);
    try {
      const [jobsRes, clientsRes] = await Promise.all([authFetch("/api/jobs"), authFetch("/api/clients")]);
      setJobs(await jobsRes.json());
      setClients(await clientsRes.json());
    } catch (error) {
      console.error("Erro ao carregar jobs:", error);
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

  const handleDelete = async (id: number) => {
    if (!confirm("Deseja excluir este trabalho?")) return;
    await authFetch(`/api/jobs/${id}`, { method: "DELETE" });
    fetchData();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    );
  }

  const jobTypes = Array.from(new Set(jobs.map((j) => j.job_type))).filter(Boolean);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 className="text-2xl font-bold text-gray-800">Jobs</h3>
          <p className="text-gray-500">Lista geral de ensaios e tarefas com CRUD.</p>
        </div>
        <button
          onClick={() => {
            setEditingJob(null);
            setShowModal(true);
          }}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 shadow-md shadow-indigo-100 transition-all"
        >
          <Plus size={20} />
          Novo job
        </button>
      </div>

      <div className="flex flex-wrap gap-3 bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500">Tipo</span>
          <select
            value={filters.type}
            onChange={(e) => setFilters((prev) => ({ ...prev, type: e.target.value }))}
            className="text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none"
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
          <span className="text-sm text-gray-500">Cliente</span>
          <select
            value={filters.client}
            onChange={(e) => setFilters((prev) => ({ ...prev, client: e.target.value }))}
            className="text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none"
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
          <span className="text-sm text-gray-500">Status</span>
          <select
            value={filters.status}
            onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value }))}
            className="text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none"
          >
            <option value="all">Todos</option>
            <option value="scheduled">Agendado</option>
            <option value="completed">Concluído</option>
            <option value="cancelled">Cancelado</option>
          </select>
        </div>
        <button
          onClick={() => setFilters({ type: "all", client: "all", status: "all" })}
          className="text-sm text-gray-500 hover:text-indigo-600"
        >
          Limpar filtros
        </button>
      </div>

      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider">
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
          <tbody className="divide-y divide-gray-100">
            {filteredJobs.map((job) => {
              const jobDate = parseDate(job.job_date);
              return (
                <tr key={job.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-4 font-medium flex items-center gap-2">
                    <Camera size={14} className="text-gray-400" />
                    {job.client_name || clients.find((c) => c.id === job.client_id)?.name || job.job_name || "Tarefa"}
                  </td>
                  <td className="px-6 py-4 text-gray-600">{job.job_type}</td>
                  <td className="px-6 py-4 text-gray-500">
                    {jobDate ? format(jobDate, "dd/MM/yyyy", { locale: ptBR }) : "-"}
                    {job.job_time && <span className="text-xs text-gray-400"> · {job.job_time}</span>}
                  </td>
                  <td className="px-6 py-4 font-semibold">R$ {(job.amount ?? 0).toLocaleString("pt-BR")}</td>
                  <td className="px-6 py-4">
                    <span
                      className={cn(
                        "px-2 py-1 rounded-full text-[10px] font-bold uppercase",
                        job.status === "completed"
                          ? "bg-emerald-100 text-emerald-700"
                          : job.status === "cancelled"
                          ? "bg-rose-100 text-rose-700"
                          : "bg-amber-100 text-amber-700"
                      )}
                    >
                      {job.status === "scheduled" ? "Agendado" : job.status === "completed" ? "Concluído" : "Cancelado"}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <span
                      className={cn(
                        "px-2 py-1 rounded-full text-[10px] font-bold uppercase",
                        job.payment_status === "paid" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                      )}
                    >
                      {job.payment_status === "paid" ? "Pago" : "Pendente"}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right flex items-center gap-2 justify-end">
                    <button
                      onClick={() => {
                        setEditingJob(job);
                        setShowModal(true);
                      }}
                      className="p-2 text-gray-500 hover:text-indigo-600"
                    >
                      <Edit2 size={16} />
                    </button>
                    <button onClick={() => handleDelete(job.id)} className="p-2 text-gray-500 hover:text-rose-600">
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              );
            })}

            {filteredJobs.length === 0 && (
              <tr>
                <td colSpan={7} className="px-6 py-10 text-center text-sm text-gray-400">
                  Nenhum job encontrado para os filtros selecionados.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

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
  );
}

import React, { useEffect, useState } from "react";
import { FileText, Plus, Search, X } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { authFetch } from "../utils/authFetch";
import { parseDate } from "../utils/date";
import { ContractGenerator } from "../components/contracts/ContractGenerator";
import { JobWithProduction } from "../components/producao/ProductionBoard";
import { Client } from "../types";

export default function ContractsPage() {
  const [jobs, setJobs] = useState<JobWithProduction[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [generatingJob, setGeneratingJob] = useState<JobWithProduction | null>(null);
  const [generatingClient, setGeneratingClient] = useState<any>(null);

  useEffect(() => {
    Promise.all([
      authFetch("/api/jobs").then(r => r.json()),
      authFetch("/api/clients").then(r => r.json()),
    ]).then(([jobsData, clientsData]) => {
      setJobs(jobsData);
      setClients(clientsData);
    }).catch(console.error).finally(() => setLoading(false));
  }, []);

  const filtered = jobs.filter(j => {
    const q = searchQuery.toLowerCase();
    return !q || (j.client_name || '').toLowerCase().includes(q) || (j.job_name || '').toLowerCase().includes(q) || (j.job_type || '').toLowerCase().includes(q);
  });

  const [loadingContract, setLoadingContract] = useState(false);

  const handleGenerate = async (job: JobWithProduction) => {
    setLoadingContract(true);
    let clientData = null;
    if (job.client_id) {
      try {
        const res = await authFetch(`/api/clients/${job.client_id}`);
        if (res.ok) clientData = await res.json();
      } catch {}
    }
    setGeneratingClient(clientData);
    setGeneratingJob(job); // abre DEPOIS que o cliente já chegou
    setLoadingContract(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gold-600" />
      </div>
    );
  }

  return (
    <>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-2xl font-bold text-gray-800 dark:text-white">Contratos</h3>
            <p className="text-gray-500 dark:text-gray-400 text-sm">Gere contratos automáticos a partir dos seus trabalhos.</p>
          </div>
        </div>

        {/* Search */}
        <div className="relative max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            type="text"
            placeholder="Buscar trabalho ou cliente..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-8 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 placeholder-gray-400 focus:border-gold-400 outline-none transition-colors"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              <X size={13} />
            </button>
          )}
        </div>

        {/* Jobs table */}
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-sm overflow-hidden">
          <table className="w-full text-left">
            <thead className="bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wider">
              <tr>
                <th className="px-6 py-3 font-semibold">Cliente</th>
                <th className="px-6 py-3 font-semibold">Tipo de ensaio</th>
                <th className="px-6 py-3 font-semibold">Data</th>
                <th className="px-6 py-3 font-semibold">Valor</th>
                <th className="px-6 py-3 font-semibold text-right">Ação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {filtered.map(job => {
                const jobDate = job.job_date ? parseDate(job.job_date) : null;
                return (
                  <tr key={job.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                    <td className="px-6 py-4">
                      <p className="font-medium text-gray-900 dark:text-white text-sm">
                        {job.client_name || job.job_name || "Trabalho"}
                      </p>
                    </td>
                    <td className="px-6 py-4 text-gray-600 dark:text-gray-300 text-sm">{job.job_type || "—"}</td>
                    <td className="px-6 py-4 text-gray-500 dark:text-gray-400 text-sm">
                      {jobDate ? format(jobDate, "dd/MM/yyyy", { locale: ptBR }) : "—"}
                    </td>
                    <td className="px-6 py-4 font-semibold text-gray-900 dark:text-white text-sm">
                      R$ {(job.amount ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button
                        onClick={() => handleGenerate(job)}
                        disabled={loadingContract}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gold-600 hover:bg-gold-700 disabled:opacity-60 text-white text-xs font-semibold rounded-lg transition-colors shadow-sm"
                      >
                        {loadingContract ? (
                          <div className="h-3 w-3 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                        ) : (
                          <FileText size={13} />
                        )}
                        Gerar contrato
                      </button>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-sm text-gray-400 dark:text-gray-500">
                    Nenhum trabalho encontrado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {generatingJob && (
        <ContractGenerator
          job={generatingJob}
          client={generatingClient}
          onClose={() => { setGeneratingJob(null); setGeneratingClient(null); }}
        />
      )}
    </>
  );
}

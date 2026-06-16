import React, { useMemo, useState } from "react";
import { X, Loader2, Send, CheckCircle2 } from "lucide-react";
import { authFetch } from "../../utils/authFetch";
import { TaskTemplate, TeamMember } from "../../types";
import { SearchableSelect } from "../../components/ui/SearchableSelect";

interface JobLite {
  id: number;
  client_name?: string;
  job_name?: string;
  job_type?: string;
  job_date?: string;
  client_id?: number | null;
}

const inputCls =
  "w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 focus:border-gold-400 outline-none";

export function ApplyTemplateModal({
  template, members, jobs, onClose, onApplied,
}: {
  template: TaskTemplate;
  members: TeamMember[];
  jobs: JobLite[];
  onClose: () => void;
  onApplied: () => void;
}) {
  const [jobId, setJobId] = useState<string>("");
  const [referenceDate, setReferenceDate] = useState<string>("");
  const [assigneeId, setAssigneeId] = useState<string>("");
  const [applying, setApplying] = useState(false);
  const [done, setDone] = useState<number | null>(null);

  const jobOptions = useMemo(
    () =>
      jobs.map((j) => ({
        value: String(j.id),
        label: `${j.client_name || j.job_name || `Trabalho #${j.id}`}${j.job_type ? ` · ${j.job_type}` : ""}`,
      })),
    [jobs]
  );

  const onPickJob = (val: string) => {
    setJobId(val);
    const job = jobs.find((j) => String(j.id) === val);
    if (job?.job_date && !referenceDate) setReferenceDate(job.job_date.slice(0, 10));
  };

  const apply = async () => {
    setApplying(true);
    try {
      const job = jobs.find((j) => String(j.id) === jobId);
      const res = await authFetch(`/api/task-templates/${template.id}/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          job_id: jobId ? Number(jobId) : null,
          client_id: job?.client_id ?? null,
          reference_date: referenceDate || null,
          default_assignee_id: assigneeId || null,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setDone(data.created || 0);
        setTimeout(() => { onApplied(); onClose(); }, 1200);
      } else {
        const err = await res.json().catch(() => ({}));
        alert("Erro ao aplicar: " + (err.error || res.statusText));
      }
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[75] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-md bg-white dark:bg-gray-900 rounded-2xl shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
          <div>
            <h3 className="text-base font-bold text-gray-900 dark:text-white">Aplicar padrão</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">{template.name}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"><X size={18} /></button>
        </div>

        {done != null ? (
          <div className="px-5 py-10 text-center">
            <CheckCircle2 size={40} className="mx-auto text-emerald-500 mb-3" />
            <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">{done} tarefa{done === 1 ? "" : "s"} criada{done === 1 ? "" : "s"}!</p>
          </div>
        ) : (
          <div className="p-5 space-y-4">
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1">Vincular a um trabalho/venda (opcional)</label>
              <SearchableSelect
                value={jobId}
                onChange={onPickJob}
                options={jobOptions}
                placeholder="Buscar trabalho..."
              />
              <p className="text-[11px] text-gray-400 mt-1">As tarefas ficam ligadas a esse trabalho e cliente.</p>
            </div>
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1">Data do ensaio (referência dos prazos)</label>
              <input type="date" value={referenceDate} onChange={(e) => setReferenceDate(e.target.value)} className={inputCls} />
              <p className="text-[11px] text-gray-400 mt-1">Prazos relativos (ex.: "2 dias antes") são calculados a partir daqui.</p>
            </div>
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1">Responsável geral (opcional)</label>
              <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} className={inputCls}>
                <option value="">— manter o sugerido em cada tarefa</option>
                {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
              <p className="text-[11px] text-gray-400 mt-1">Preenche o responsável das tarefas que não têm um sugerido.</p>
            </div>
            <button onClick={apply} disabled={applying}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-gold-500 hover:bg-gold-600 text-white text-sm font-semibold disabled:opacity-60">
              {applying ? <Loader2 size={16} className="animate-spin" /> : <Send size={15} />} Criar as tarefas
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

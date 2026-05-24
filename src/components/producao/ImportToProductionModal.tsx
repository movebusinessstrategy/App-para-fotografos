import React, { useMemo, useState } from 'react';
import { X, Search, ArrowDownToLine, Calendar } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Job, ProductionProcess, ProductionStageV2 } from '../../types';
import { cn } from '../../utils/cn';
import { parseDate } from '../../utils/date';
import { normalizeText } from '../../utils/normalizeText';

const SKIP = '__skip__';

type UnstagedJob = Job & { production_stage?: string | null };

interface ImportToProductionModalProps {
  jobs: UnstagedJob[];
  processes: ProductionProcess[];
  stages: ProductionStageV2[];
  onClose: () => void;
  onImported: () => void;
  onAssign: (jobId: number, stageId: string) => Promise<void>;
}

export function ImportToProductionModal({
  jobs, processes, stages, onClose, onImported, onAssign,
}: ImportToProductionModalProps) {
  const [search, setSearch] = useState('');
  const [assignments, setAssignments] = useState<Record<number, string>>(() => {
    const initial: Record<number, string> = {};
    for (const j of jobs) initial[j.id] = SKIP;
    return initial;
  });
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  const sortedStages = useMemo(
    () => [...stages].sort((a, b) => {
      const pa = processes.find(p => p.id === a.process_id)?.position ?? 999;
      const pb = processes.find(p => p.id === b.process_id)?.position ?? 999;
      if (pa !== pb) return pa - pb;
      return a.position - b.position;
    }),
    [stages, processes]
  );

  const filtered = useMemo(() => {
    const q = normalizeText(search);
    if (!q) return jobs;
    return jobs.filter(j =>
      normalizeText(j.client_name || '').includes(q) ||
      normalizeText(j.job_name || '').includes(q) ||
      normalizeText(j.job_type || '').includes(q)
    );
  }, [jobs, search]);

  const setAssignment = (jobId: number, value: string) => {
    setAssignments(prev => ({ ...prev, [jobId]: value }));
  };

  const setAllVisible = (value: string) => {
    setAssignments(prev => {
      const next = { ...prev };
      for (const j of filtered) next[j.id] = value;
      return next;
    });
  };

  const toImportCount = Object.values(assignments).filter(v => v && v !== SKIP).length;

  const handleImport = async () => {
    const entries = (Object.entries(assignments) as [string, string][])
      .filter(([, v]) => v && v !== SKIP);
    if (entries.length === 0) return;
    setImporting(true);
    setProgress({ done: 0, total: entries.length });
    let done = 0;
    for (const [jobIdStr, stageId] of entries) {
      try {
        await onAssign(Number(jobIdStr), stageId);
      } catch (err) {
        console.error('Erro ao importar job', jobIdStr, err);
      }
      done += 1;
      setProgress({ done, total: entries.length });
    }
    setImporting(false);
    onImported();
    onClose();
  };

  const formatDate = (d?: string) => {
    if (!d) return '-';
    const parsed = parseDate(d);
    return parsed ? format(parsed, "dd 'de' MMM, yyyy", { locale: ptBR }) : d;
  };

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" onClick={importing ? undefined : onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-3xl border border-gray-200 dark:border-gray-700 flex flex-col" style={{ maxHeight: '85vh' }}>
          {/* Header */}
          <div className="flex items-center justify-between p-5 border-b border-gray-100 dark:border-gray-800 flex-shrink-0">
            <div>
              <h2 className="text-base font-bold text-gray-900 dark:text-white">Importar trabalhos para a produção</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                Nada será importado por padrão. Escolha uma etapa só nos trabalhos que você quer mover.
              </p>
            </div>
            <button
              onClick={onClose}
              disabled={importing}
              className="p-2 rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"
            >
              <X size={16} />
            </button>
          </div>

          {/* Toolbar */}
          <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-800 flex flex-wrap items-center gap-3 flex-shrink-0">
            <div className="relative flex-1 min-w-[200px]">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 pointer-events-none" />
              <input
                type="text"
                placeholder="Buscar cliente ou trabalho..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                disabled={importing}
                className="w-full pl-9 pr-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-lg outline-none bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500 focus:border-gold-400 dark:focus:border-gold-500 transition-colors"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 dark:text-gray-400">Aplicar a todos visíveis:</span>
              <select
                onChange={e => { if (e.target.value) { setAllVisible(e.target.value); e.target.value = ''; } }}
                disabled={importing}
                className="text-xs border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200"
                defaultValue=""
              >
                <option value="">Selecionar etapa...</option>
                <option value={SKIP}>Não importar</option>
                {processes.map(p => (
                  <optgroup key={p.id} label={p.name}>
                    {sortedStages.filter(s => s.process_id === p.id).map(s => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto px-5 py-3">
            {filtered.length === 0 ? (
              <div className="py-12 text-center text-sm text-gray-400 dark:text-gray-500">
                Nenhum trabalho encontrado.
              </div>
            ) : (
              <div className="space-y-2">
                {filtered.map(job => {
                  const value = assignments[job.id] ?? SKIP;
                  const stage = stages.find(s => s.id === value);
                  const proc = stage ? processes.find(p => p.id === stage.process_id) : null;
                  const isSkipped = value === SKIP;
                  return (
                    <div
                      key={job.id}
                      className={cn(
                        'flex items-center gap-3 p-3 rounded-xl border transition-colors',
                        isSkipped
                          ? 'bg-gray-50 dark:bg-gray-800/40 border-gray-200 dark:border-gray-700/60 opacity-70'
                          : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700'
                      )}
                    >
                      <span
                        className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                        style={{ backgroundColor: stage?.color || proc?.color || '#94a3b8' }}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-gray-800 dark:text-gray-100 truncate">
                          {job.client_name || job.job_name || 'Sem nome'}
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-2 mt-0.5">
                          <span className="truncate">{job.job_type || 'Sem tipo'}</span>
                          <span className="text-gray-300 dark:text-gray-600">•</span>
                          <Calendar size={11} />
                          <span>{formatDate(job.job_date)}</span>
                          {job.status === 'cancelled' && (
                            <>
                              <span className="text-gray-300 dark:text-gray-600">•</span>
                              <span className="text-red-500">cancelado</span>
                            </>
                          )}
                        </div>
                      </div>
                      <select
                        value={value}
                        onChange={e => setAssignment(job.id, e.target.value)}
                        disabled={importing}
                        className="text-xs border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 max-w-[220px]"
                      >
                        <option value={SKIP}>Não importar</option>
                        {processes.map(p => (
                          <optgroup key={p.id} label={p.name}>
                            {sortedStages.filter(s => s.process_id === p.id).map(s => (
                              <option key={s.id} value={s.id}>{s.name}</option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between gap-3 p-5 border-t border-gray-100 dark:border-gray-800 flex-shrink-0">
            <div className="text-xs text-gray-500 dark:text-gray-400">
              {importing
                ? `Importando ${progress.done}/${progress.total}...`
                : toImportCount === 0
                  ? `Selecione uma etapa para os trabalhos que quer importar`
                  : `${toImportCount} ${toImportCount === 1 ? 'trabalho será importado' : 'trabalhos serão importados'}`}
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={onClose}
                disabled={importing}
                className="px-4 py-2 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleImport}
                disabled={importing || toImportCount === 0}
                className="flex items-center gap-2 px-4 py-2 bg-gold-600 hover:bg-gold-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-xl transition-colors"
              >
                <ArrowDownToLine size={15} />
                {importing ? 'Importando...' : 'Importar'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

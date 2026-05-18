import React, { useEffect, useState, useMemo } from "react";
import { ArrowRight, Edit2, MoreVertical, Trash2, X, ChevronRight } from "lucide-react";
import { ProductionProcess, ProductionStageV2 } from "../../types";
import { authFetch } from "../../utils/authFetch";
import { cn } from "../../utils/cn";
import { ConfirmModal } from "../ui/ConfirmModal";
import { SearchableSelect } from "../ui/SearchableSelect";

interface Sale {
  deal_id: number;
  job_id: number | null;
  job_name: string | null;
  job_date: string | null;
  client_name: string;
  contact_phone: string | null;
  value: number;
  converted_at: string | null;
  in_production: boolean;
  production_stage_id: string | null;
  production_stage_name: string | null;
}

interface Props {
  processes: ProductionProcess[];
  stages: ProductionStageV2[];
  onRefreshJobs?: () => void;
}

const PERIODS = [
  { d: 7, label: '7 dias' },
  { d: 14, label: '14 dias' },
  { d: 30, label: '30 dias' },
  { d: 90, label: '90 dias' },
];

const formatCurrency = (v: number) =>
  (v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 0 });

const formatShortDate = (iso: string | null) => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
  } catch { return '—'; }
};

const formatJobDate = (s: string | null) => {
  if (!s) return '';
  try {
    return new Date(String(s).slice(0, 10) + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
  } catch { return ''; }
};

export function SalesOverviewPanel({ processes, stages, onRefreshJobs }: Props) {
  const [period, setPeriod] = useState(7);
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(false);
  const [openMenuFor, setOpenMenuFor] = useState<number | null>(null);
  const [movingSale, setMovingSale] = useState<Sale | null>(null);
  const [moveStageId, setMoveStageId] = useState<string>('');
  const [confirmRemove, setConfirmRemove] = useState<Sale | null>(null);

  async function load() {
    setLoading(true);
    try {
      const r = await authFetch(`/api/extension/sales-overview?days=${period}`);
      const data = await r.json();
      setSales(Array.isArray(data?.sales) ? data.sales : []);
    } catch (err) {
      console.error('[SalesOverview] erro:', err);
      setSales([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [period]);

  // Fecha menu ao clicar fora
  useEffect(() => {
    if (openMenuFor === null) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest?.('[data-sales-menu]')) setOpenMenuFor(null);
    };
    document.addEventListener('mousedown', onDoc, true);
    return () => document.removeEventListener('mousedown', onDoc, true);
  }, [openMenuFor]);

  const counters = useMemo(() => {
    const pending = sales.filter(s => !s.in_production && s.job_id).length;
    const inProd = sales.filter(s => s.in_production).length;
    const noJob = sales.filter(s => !s.job_id).length;
    return { pending, inProd, noJob };
  }, [sales]);

  // Primeira etapa do primeiro processo não-especial — destino do "Enviar"
  const entryStageId = useMemo(() => {
    const firstProcess = processes
      .filter(p => !p.is_special)
      .slice()
      .sort((a, b) => (a.position || 0) - (b.position || 0))[0];
    if (!firstProcess) return null;
    const firstStage = stages
      .filter(s => s.process_id === firstProcess.id)
      .slice()
      .sort((a, b) => (a.position || 0) - (b.position || 0))[0];
    return firstStage?.id || null;
  }, [processes, stages]);

  const sendToProduction = async (sale: Sale) => {
    if (!sale.job_id) return;
    if (!entryStageId) {
      alert('Configure pelo menos um processo de produção com uma etapa.');
      return;
    }
    try {
      await authFetch(`/api/jobs/${sale.job_id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ production_stage: entryStageId }),
      });
      load();
      onRefreshJobs?.();
    } catch (err) {
      console.error(err);
    }
  };

  const removeFromProduction = async (sale: Sale) => {
    if (!sale.job_id) return;
    try {
      await authFetch(`/api/jobs/${sale.job_id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ production_stage: null }),
      });
      load();
      onRefreshJobs?.();
    } catch (err) { console.error(err); }
  };

  const doMove = async () => {
    if (!movingSale?.job_id || !moveStageId) return;
    try {
      await authFetch(`/api/jobs/${movingSale.job_id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ production_stage: moveStageId }),
      });
      setMovingSale(null);
      setMoveStageId('');
      load();
      onRefreshJobs?.();
    } catch (err) { console.error(err); }
  };

  const allStageOptions = useMemo(() => {
    const procById = new Map(processes.map(p => [p.id, p]));
    return stages
      .slice()
      .sort((a, b) => (a.position || 0) - (b.position || 0))
      .map(s => ({
        value: s.id,
        label: `${procById.get(s.process_id)?.name || '?'} → ${s.name}`,
      }));
  }, [processes, stages]);

  return (
    <div className="flex flex-col gap-4">
      {/* Header — chips de período + resumo */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-3 shadow-sm">
        <div className="flex gap-2 items-center">
          <span className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mr-1">Período:</span>
          {PERIODS.map(p => (
            <button
              key={p.d}
              onClick={() => setPeriod(p.d)}
              className={cn(
                'px-3 py-1.5 rounded-full text-xs font-semibold transition-all border',
                period === p.d
                  ? 'bg-gold-500 text-white border-gold-500 shadow-sm'
                  : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:border-gold-400 hover:text-gold-600'
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex gap-2 flex-wrap">
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400">
            <strong>{counters.pending}</strong> pendentes
          </span>
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400">
            <strong>{counters.inProd}</strong> em produção
          </span>
          {counters.noJob > 0 && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
              <strong>{counters.noJob}</strong> sem job
            </span>
          )}
        </div>
      </div>

      {/* Lista */}
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl shadow-sm overflow-hidden">
        {loading ? (
          <div className="py-16 text-center text-gray-400 dark:text-gray-500 text-sm">Carregando...</div>
        ) : sales.length === 0 ? (
          <div className="py-16 text-center text-gray-400 dark:text-gray-500 text-sm">
            Nenhuma venda nos últimos {period} dias.
          </div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {sales.map(sale => {
              const isInProd = sale.in_production;
              const hasNoJob = !sale.job_id;

              return (
                <div
                  key={sale.deal_id}
                  className={cn(
                    'flex items-center gap-3 px-4 py-3 transition-colors',
                    isInProd ? 'bg-gray-50/60 dark:bg-gray-800/30 opacity-75' : '',
                    hasNoJob ? 'bg-gray-50 dark:bg-gray-800/30 opacity-60' : ''
                  )}
                >
                  {/* Cliente / valor / datas */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
                      {sale.client_name}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {formatCurrency(sale.value)} · vendido {formatShortDate(sale.converted_at)}
                      {sale.job_date && <> · sessão {formatJobDate(sale.job_date)}</>}
                    </p>
                  </div>

                  {/* Status pill */}
                  {hasNoJob ? (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-semibold bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 italic flex-shrink-0">
                      Sem job criado
                    </span>
                  ) : isInProd ? (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-semibold bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 flex-shrink-0">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                      Em produção · {sale.production_stage_name}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-semibold bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 flex-shrink-0">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                      Pendente
                    </span>
                  )}

                  {/* Ação */}
                  {hasNoJob ? (
                    <span className="text-gray-300 dark:text-gray-700 text-xs px-3">—</span>
                  ) : isInProd ? (
                    <div className="relative" data-sales-menu>
                      <button
                        onClick={() => setOpenMenuFor(openMenuFor === sale.deal_id ? null : sale.deal_id)}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-gold-400 hover:text-gold-600 transition-all"
                      >
                        <Edit2 size={12} /> Editar
                      </button>
                      {openMenuFor === sale.deal_id && (
                        <div className="absolute right-0 top-full mt-1.5 z-40 min-w-[200px] bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg py-1.5">
                          <button
                            onClick={() => { setOpenMenuFor(null); setMovingSale(sale); setMoveStageId(sale.production_stage_id || ''); }}
                            className="w-full text-left px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-2"
                          >
                            <ChevronRight size={13} /> Mover de etapa
                          </button>
                          <button
                            onClick={() => { setOpenMenuFor(null); sendToProduction(sale); }}
                            className="w-full text-left px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-2"
                          >
                            <ArrowRight size={13} /> Voltar pra fila de edição
                          </button>
                          <div className="border-t border-gray-100 dark:border-gray-700 my-1" />
                          <button
                            onClick={() => { setOpenMenuFor(null); setConfirmRemove(sale); }}
                            className="w-full text-left px-3 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center gap-2"
                          >
                            <Trash2 size={13} /> Tirar da produção
                          </button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <button
                      onClick={() => sendToProduction(sale)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition-all"
                    >
                      <ArrowRight size={12} /> Enviar pra produção
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal "Mover de etapa" */}
      {movingSale && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-[420px] max-w-[92vw] overflow-hidden">
            <div className="flex justify-between items-start p-5 border-b border-gray-100 dark:border-gray-800">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-gold-600">Mover de etapa</p>
                <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 mt-1">{movingSale.client_name}</p>
              </div>
              <button onClick={() => { setMovingSale(null); setMoveStageId(''); }} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
                <X size={18} />
              </button>
            </div>
            <div className="p-5">
              <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">
                Para qual etapa?
              </label>
              <SearchableSelect
                value={moveStageId}
                onChange={setMoveStageId}
                placeholder="Escolher etapa"
                options={allStageOptions}
              />
            </div>
            <div className="flex gap-2 p-5 border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/50">
              <button
                onClick={() => { setMovingSale(null); setMoveStageId(''); }}
                className="flex-1 px-4 py-2 rounded-lg text-sm font-semibold text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:border-gray-300"
              >
                Cancelar
              </button>
              <button
                onClick={doMove}
                disabled={!moveStageId}
                className="flex-1 px-4 py-2 rounded-lg text-sm font-semibold text-white bg-gold-600 hover:bg-gold-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
              >
                Mover
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirma remoção da produção */}
      <ConfirmModal
        open={!!confirmRemove}
        title="Tirar da produção"
        message={`Remover "${confirmRemove?.client_name || ''}" da produção? O cliente e o trabalho continuam salvos.`}
        confirmText="Tirar"
        variant="danger"
        onConfirm={() => { if (confirmRemove) removeFromProduction(confirmRemove); setConfirmRemove(null); }}
        onCancel={() => setConfirmRemove(null)}
      />
    </div>
  );
}

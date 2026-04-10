import React, { useEffect, useState } from 'react';
import {
  X, Calendar, DollarSign, FileText, Camera, Loader2,
  TrendingUp, Trash2, Phone, CheckCircle2, Clock, AlertTriangle
} from 'lucide-react';
import { Oportunidade } from '../../types';
import { authFetch } from '../../utils/authFetch';
import { cn } from '../../utils/cn';

// ─── Priority config ────────────────────────────────────────────────────────
const PRIORITY_CONFIG: Record<string, {
  label: string;
  badge: string;
  icon: React.ReactNode;
  border: string;
}> = {
  future: {
    label: 'Futura',
    badge: 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300',
    icon: <Clock size={11} />,
    border: 'border-l-gray-300 dark:border-l-gray-600',
  },
  active: {
    label: 'Em Breve',
    badge: 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300',
    icon: <Calendar size={11} />,
    border: 'border-l-amber-400',
  },
  urgent: {
    label: 'Urgente',
    badge: 'bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-300',
    icon: <AlertTriangle size={11} />,
    border: 'border-l-red-500',
  },
};

interface Job {
  id: number;
  job_name: string;
  job_type: string;
  job_date: string;
  amount: number;
  payment_method: string;
  payment_status: string;
  status: string;
  notes: string;
}

interface OportunidadeDetailDrawerProps {
  op: Oportunidade;
  onClose: () => void;
  onSendToKanban: (op: Oportunidade) => Promise<void>;
  onDiscard: (id: string) => Promise<void>;
}

export function OportunidadeDetailDrawer({
  op, onClose, onSendToKanban, onDiscard,
}: OportunidadeDetailDrawerProps) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [actionLoading, setActionLoading] = useState<'kanban' | 'discard' | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [tab, setTab] = useState<'historico' | 'anotacoes'>('historico');

  const prioridade = op.prioridade || 'future';
  const pConfig = PRIORITY_CONFIG[prioridade] || PRIORITY_CONFIG.future;

  useEffect(() => {
    if (!op.cliente_id) { setLoadingJobs(false); return; }
    setLoadingJobs(true);
    authFetch(`/api/clients/${op.cliente_id}`)
      .then(r => r.json())
      .then(data => setJobs(data.jobs || []))
      .catch(console.error)
      .finally(() => setLoadingJobs(false));
  }, [op.cliente_id]);

  const handleKanban = async () => {
    setActionLoading('kanban');
    try {
      await onSendToKanban(op);
      onClose();
    } finally {
      setActionLoading(null);
    }
  };

  const handleDiscard = async () => {
    setActionLoading('discard');
    try {
      await onDiscard(op.id);
      onClose();
    } finally {
      setActionLoading(null);
      setConfirmDiscard(false);
    }
  };

  const dataFormatada = op.data_oportunidade
    ? new Date(op.data_oportunidade + 'T12:00:00').toLocaleDateString('pt-BR')
    : '—';

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 z-40"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="fixed inset-y-0 right-0 z-50 w-full sm:w-[420px] bg-white dark:bg-gray-900 shadow-2xl flex flex-col">

        {/* Header */}
        <div className={cn('flex-shrink-0 border-b border-gray-100 dark:border-gray-800 border-l-4', pConfig.border)}>
          <div className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className={cn('inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full', pConfig.badge)}>
                    {pConfig.icon}
                    {pConfig.label}
                  </span>
                  <span className="text-xs text-gray-400">{op.tipo}</span>
                </div>
                <h2 className="font-bold text-gray-900 dark:text-white text-lg leading-tight">{op.cliente_nome}</h2>
                <div className="flex items-center gap-3 mt-1 text-xs text-gray-500 dark:text-gray-400 flex-wrap">
                  {op.cliente_telefone && (
                    <span className="flex items-center gap-1">
                      <Phone size={11} />
                      {op.cliente_telefone}
                    </span>
                  )}
                  <span className="flex items-center gap-1">
                    <Calendar size={11} />
                    {dataFormatada}
                  </span>
                  {op.valor_proposta ? (
                    <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
                      <DollarSign size={11} />
                      R$ {op.valor_proposta.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </span>
                  ) : null}
                </div>
              </div>
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 flex-shrink-0"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex border-t border-gray-100 dark:border-gray-800">
            <button
              onClick={() => setTab('historico')}
              className={cn(
                'flex-1 py-2.5 text-xs font-medium transition-colors border-b-2',
                tab === 'historico'
                  ? 'text-gold-600 dark:text-gold-400 border-gold-500'
                  : 'text-gray-500 dark:text-gray-400 border-transparent hover:text-gray-700 dark:hover:text-gray-300'
              )}
            >
              <Camera size={13} className="inline mr-1.5 -mt-0.5" />
              Histórico de Ensaios ({jobs.length})
            </button>
            <button
              onClick={() => setTab('anotacoes')}
              className={cn(
                'flex-1 py-2.5 text-xs font-medium transition-colors border-b-2',
                tab === 'anotacoes'
                  ? 'text-gold-600 dark:text-gold-400 border-gold-500'
                  : 'text-gray-500 dark:text-gray-400 border-transparent hover:text-gray-700 dark:hover:text-gray-300'
              )}
            >
              <FileText size={13} className="inline mr-1.5 -mt-0.5" />
              Anotações
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {tab === 'historico' && (
            <div className="space-y-3">
              {loadingJobs ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 size={22} className="animate-spin text-gold-500" />
                </div>
              ) : jobs.length === 0 ? (
                <div className="text-center py-12">
                  <div className="w-14 h-14 bg-gray-50 dark:bg-gray-800 rounded-2xl flex items-center justify-center mx-auto mb-3">
                    <Camera size={24} className="text-gray-400" />
                  </div>
                  <p className="text-sm text-gray-500 dark:text-gray-400 font-medium">Nenhum ensaio realizado ainda</p>
                  <p className="text-xs text-gray-400 mt-1">Esta é a primeira oportunidade com {op.cliente_nome}</p>
                </div>
              ) : (
                <>
                  {/* Summary strip */}
                  <div className="bg-gold-50 dark:bg-gold-500/10 rounded-xl p-3 flex items-center justify-between">
                    <div className="text-xs text-gold-700 dark:text-gold-300">
                      <span className="font-semibold">{jobs.length} ensaio{jobs.length !== 1 ? 's' : ''}</span> com este cliente
                    </div>
                    <div className="text-xs font-semibold text-gold-700 dark:text-gold-300">
                      Total: R$ {jobs.reduce((s, j) => s + (j.amount || 0), 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </div>
                  </div>

                  {jobs.map(job => {
                    const dataJob = job.job_date
                      ? new Date(job.job_date + 'T12:00:00').toLocaleDateString('pt-BR')
                      : '—';
                    const isPast = job.status === 'completed';
                    return (
                      <div key={job.id} className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-4">
                        <div className="flex items-start justify-between gap-3 mb-2">
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-gray-900 dark:text-white text-sm truncate">{job.job_name}</p>
                            <p className="text-xs text-gray-500 dark:text-gray-400">{job.job_type}</p>
                          </div>
                          <div className="flex-shrink-0 text-right">
                            {isPast && (
                              <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 px-2 py-0.5 rounded-full">
                                <CheckCircle2 size={10} />
                                Concluído
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400 flex-wrap">
                          <span className="flex items-center gap-1">
                            <Calendar size={10} />
                            {dataJob}
                          </span>
                          {job.amount ? (
                            <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
                              <DollarSign size={10} />
                              R$ {job.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                            </span>
                          ) : null}
                          {job.payment_method && (
                            <span className="bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded text-gray-600 dark:text-gray-300">
                              {job.payment_method}
                            </span>
                          )}
                        </div>
                        {job.notes && (
                          <p className="text-xs text-gray-500 dark:text-gray-400 mt-2 border-t border-gray-100 dark:border-gray-700 pt-2 italic">
                            "{job.notes}"
                          </p>
                        )}
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          )}

          {tab === 'anotacoes' && (
            <div className="space-y-4">
              {op.notas ? (
                <div className="bg-amber-50 dark:bg-amber-500/10 rounded-xl p-4 border border-amber-100 dark:border-amber-500/20">
                  <p className="text-xs font-semibold text-amber-700 dark:text-amber-300 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                    <FileText size={12} />
                    Anotações da oportunidade
                  </p>
                  <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{op.notas}</p>
                </div>
              ) : (
                <div className="text-center py-12">
                  <div className="w-14 h-14 bg-gray-50 dark:bg-gray-800 rounded-2xl flex items-center justify-center mx-auto mb-3">
                    <FileText size={24} className="text-gray-400" />
                  </div>
                  <p className="text-sm text-gray-500 dark:text-gray-400 font-medium">Sem anotações</p>
                  <p className="text-xs text-gray-400 mt-1">Nenhuma observação foi registrada nesta oportunidade</p>
                </div>
              )}

              {/* Jobs with notes */}
              {!loadingJobs && jobs.filter(j => j.notes).length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
                    Anotações de ensaios anteriores
                  </p>
                  <div className="space-y-2">
                    {jobs.filter(j => j.notes).map(job => (
                      <div key={job.id} className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-3">
                        <div className="flex items-center justify-between mb-1">
                          <p className="text-xs font-medium text-gray-700 dark:text-gray-300">{job.job_name}</p>
                          <p className="text-xs text-gray-400">
                            {job.job_date ? new Date(job.job_date + 'T12:00:00').toLocaleDateString('pt-BR') : ''}
                          </p>
                        </div>
                        <p className="text-xs text-gray-500 dark:text-gray-400 italic">"{job.notes}"</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer — action buttons */}
        <div className="flex-shrink-0 p-5 border-t border-gray-100 dark:border-gray-800 space-y-2">
          <button
            onClick={handleKanban}
            disabled={actionLoading !== null}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
          >
            {actionLoading === 'kanban'
              ? <Loader2 size={14} className="animate-spin" />
              : <TrendingUp size={14} />
            }
            Jogar no Funil de Vendas
          </button>

          {confirmDiscard ? (
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmDiscard(false)}
                disabled={actionLoading !== null}
                className="flex-1 py-2 rounded-xl border border-gray-200 dark:border-gray-700 text-sm text-gray-600 dark:text-gray-400"
              >
                Cancelar
              </button>
              <button
                onClick={handleDiscard}
                disabled={actionLoading !== null}
                className="flex-1 flex items-center justify-center gap-2 py-2 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium"
              >
                {actionLoading === 'discard'
                  ? <Loader2 size={13} className="animate-spin" />
                  : <Trash2 size={13} />
                }
                Confirmar Descarte
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDiscard(true)}
              disabled={actionLoading !== null}
              className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-xs font-medium hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
            >
              <Trash2 size={12} />
              Descartar Oportunidade
            </button>
          )}
        </div>
      </div>
    </>
  );
}

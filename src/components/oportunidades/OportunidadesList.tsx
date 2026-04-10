import React, { useState } from 'react';
import {
  Target, TrendingUp, Trash2, Loader2, CheckCircle2,
  Phone, Calendar, BarChart2, Clock, AlertTriangle, ChevronRight
} from 'lucide-react';
import { Oportunidade } from '../../types';
import { OportunidadeDetailDrawer } from './OportunidadeDetailDrawer';
import { cn } from '../../utils/cn';

// ─── Priority config ─────────────────────────────────────────────────────────
const PRIORITY_CONFIG: Record<string, {
  label: string;
  badge: string;
  border: string;
  dot: string;
  icon: React.ReactNode;
}> = {
  future: {
    label: 'Futura',
    badge: 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-300',
    border: 'border-l-gray-300 dark:border-l-gray-600',
    dot: 'bg-gray-400',
    icon: <Clock size={10} />,
  },
  active: {
    label: 'Em Breve',
    badge: 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300',
    border: 'border-l-amber-400',
    dot: 'bg-amber-400',
    icon: <Calendar size={10} />,
  },
  urgent: {
    label: 'Urgente',
    badge: 'bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-300',
    border: 'border-l-red-500',
    dot: 'bg-red-500',
    icon: <AlertTriangle size={10} />,
  },
};

const PENDING_STATUSES = ['future', 'pendente', 'active', 'urgent'];
const KANBAN_STATUSES  = ['em_kanban'];
const CONVERTED_STATUSES = ['converted', 'convertido'];

const TIPOS = [
  'Newborn',
  'Aniversário',
  'Aniversário Mãe',
  'Aniversário Filho',
  'Smash the Cake',
  'Acompanhamento 3 meses',
  'Acompanhamento 6 meses',
  'Acompanhamento 9 meses',
  'Acompanhamento 12 meses',
];

interface OportunidadesListProps {
  data: Oportunidade[];
  loading: boolean;
  onSendToKanban: (op: Oportunidade) => Promise<void>;
  onDiscard: (id: string) => Promise<void>;
  /** Modo compacto: sem stats, sem filtro de tipo — usado nas abas de categoria */
  compact?: boolean;
}

export function OportunidadesList({ data, loading, onSendToKanban, onDiscard, compact = false }: OportunidadesListProps) {
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState<string | null>(null);
  const [filterTipo, setFilterTipo] = useState('');
  const [selectedOp, setSelectedOp] = useState<Oportunidade | null>(null);

  // Stats
  const pendentes   = data.filter(o => PENDING_STATUSES.includes(o.status));
  const noKanban    = data.filter(o => KANBAN_STATUSES.includes(o.status));
  const convertidas = data.filter(o => CONVERTED_STATUSES.includes(o.status));
  const total       = data.length;
  const aproveitadas = noKanban.length + convertidas.length;
  const taxa        = total > 0 ? Math.round((aproveitadas / total) * 100) : 0;

  // Visible list — only pending, ordered urgent first
  const PRIORITY_ORDER = { urgent: 0, active: 1, future: 2 };
  const visible = pendentes
    .filter(o => !filterTipo || o.tipo.toLowerCase().includes(filterTipo.toLowerCase()))
    .sort((a, b) => {
      const pa = PRIORITY_ORDER[a.prioridade as keyof typeof PRIORITY_ORDER] ?? 2;
      const pb = PRIORITY_ORDER[b.prioridade as keyof typeof PRIORITY_ORDER] ?? 2;
      return pa - pb;
    });

  const handleKanban = async (op: Oportunidade, e: React.MouseEvent) => {
    e.stopPropagation();
    setLoadingId(op.id);
    setConfirmDiscard(null);
    try { await onSendToKanban(op); } finally { setLoadingId(null); }
  };

  const handleConfirmDiscard = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setLoadingId(id);
    try { await onDiscard(id); } finally { setLoadingId(null); setConfirmDiscard(null); }
  };

  const handleDrawerKanban = async (op: Oportunidade) => {
    await onSendToKanban(op);
    setSelectedOp(null);
  };

  const handleDrawerDiscard = async (id: string) => {
    await onDiscard(id);
    setSelectedOp(null);
  };

  return (
    <>
      <div className="space-y-4">

        {/* Stats + Progress + Filtro — apenas no modo completo */}
        {!compact && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 p-3 flex items-center gap-3">
                <div className="w-8 h-8 bg-amber-50 dark:bg-amber-500/20 rounded-lg flex items-center justify-center flex-shrink-0">
                  <Target size={15} className="text-amber-600" />
                </div>
                <div>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Pendentes</p>
                  <p className="text-lg font-bold text-gray-900 dark:text-white">{pendentes.length}</p>
                </div>
              </div>
              <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 p-3 flex items-center gap-3">
                <div className="w-8 h-8 bg-violet-50 dark:bg-violet-500/20 rounded-lg flex items-center justify-center flex-shrink-0">
                  <TrendingUp size={15} className="text-violet-600" />
                </div>
                <div>
                  <p className="text-xs text-gray-500 dark:text-gray-400">No Funil</p>
                  <p className="text-lg font-bold text-gray-900 dark:text-white">{noKanban.length}</p>
                </div>
              </div>
              <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 p-3 flex items-center gap-3">
                <div className="w-8 h-8 bg-emerald-50 dark:bg-emerald-500/20 rounded-lg flex items-center justify-center flex-shrink-0">
                  <CheckCircle2 size={15} className="text-emerald-600" />
                </div>
                <div>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Convertidas</p>
                  <p className="text-lg font-bold text-gray-900 dark:text-white">{convertidas.length}</p>
                </div>
              </div>
              <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 p-3 flex items-center gap-3">
                <div className="w-8 h-8 bg-gold-50 dark:bg-gold-500/20 rounded-lg flex items-center justify-center flex-shrink-0">
                  <BarChart2 size={15} className="text-gold-600" />
                </div>
                <div>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Aproveitamento</p>
                  <p className="text-lg font-bold text-gray-900 dark:text-white">{taxa}%</p>
                </div>
              </div>
            </div>

            {total > 0 && (
              <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-gray-600 dark:text-gray-400">
                    {aproveitadas} de {total} oportunidades aproveitadas
                  </span>
                  <span className="text-xs font-bold text-gold-600 dark:text-gold-400">{taxa}%</span>
                </div>
                <div className="h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-violet-500 to-gold-500 rounded-full transition-all duration-500"
                    style={{ width: `${taxa}%` }}
                  />
                </div>
                <div className="flex gap-4 mt-2">
                  <span className="text-xs text-gray-400 flex items-center gap-1">
                    <span className="inline-block w-2 h-2 rounded-full bg-violet-500" />
                    No funil: {noKanban.length}
                  </span>
                  <span className="text-xs text-gray-400 flex items-center gap-1">
                    <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />
                    Convertidas: {convertidas.length}
                  </span>
                </div>
              </div>
            )}

            <div className="flex items-center gap-3 flex-wrap">
              <select
                value={filterTipo}
                onChange={e => setFilterTipo(e.target.value)}
                className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-xs text-gray-600 dark:text-gray-400 cursor-pointer"
              >
                <option value="">Todos os tipos</option>
                {TIPOS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              <div className="flex items-center gap-3 ml-auto">
                {Object.entries(PRIORITY_CONFIG).map(([key, cfg]) => (
                  <span key={key} className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                    <span className={cn('w-2 h-2 rounded-full', cfg.dot)} />
                    {cfg.label}
                  </span>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Legenda de prioridade no modo compacto */}
        {compact && (
          <div className="flex items-center gap-3">
            {Object.entries(PRIORITY_CONFIG).map(([key, cfg]) => (
              <span key={key} className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                <span className={cn('w-2 h-2 rounded-full', cfg.dot)} />
                {cfg.label}
              </span>
            ))}
          </div>
        )}

        {/* List */}
        {loading ? (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 p-4 h-24 animate-pulse" />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <div className={cn('text-center', compact ? 'py-6' : 'py-16')}>
            {!compact && (
              <div className="w-16 h-16 bg-gray-50 dark:bg-gray-800 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <CheckCircle2 size={28} className="text-emerald-400" />
              </div>
            )}
            <p className="text-gray-500 dark:text-gray-400 font-medium text-sm">
              {data.length === 0
                ? 'Nenhuma oportunidade criada nesta categoria'
                : 'Nenhuma pendente nesta categoria'}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {visible.map(op => {
              const prioridade = op.prioridade || 'future';
              const pCfg = PRIORITY_CONFIG[prioridade] || PRIORITY_CONFIG.future;
              const isLoading = loadingId === op.id;
              const isConfirming = confirmDiscard === op.id;
              const dataFormatada = op.data_oportunidade
                ? new Date(op.data_oportunidade + 'T12:00:00').toLocaleDateString('pt-BR')
                : null;

              return (
                <div
                  key={op.id}
                  onClick={() => setSelectedOp(op)}
                  className={cn(
                    'bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 border-l-4 p-4 transition-all cursor-pointer hover:shadow-md hover:border-r-gold-100 dark:hover:border-r-gold-900/30 group',
                    pCfg.border
                  )}
                >
                  <div className="flex items-center gap-3">
                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="font-semibold text-gray-900 dark:text-white text-sm">{op.cliente_nome}</span>
                        <span className={cn('inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full', pCfg.badge)}>
                          {pCfg.icon}
                          {pCfg.label}
                        </span>
                        <span className="text-xs text-gray-400 dark:text-gray-500">{op.tipo}</span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400 flex-wrap">
                        {dataFormatada && (
                          <span className="flex items-center gap-1">
                            <Calendar size={10} />
                            {dataFormatada}
                          </span>
                        )}
                        {op.cliente_telefone && (
                          <span className="flex items-center gap-1">
                            <Phone size={10} />
                            {op.cliente_telefone}
                          </span>
                        )}
                        {op.valor_proposta ? (
                          <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                            R$ {op.valor_proposta.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                          </span>
                        ) : null}
                      </div>
                      {op.notas && (
                        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1 truncate">{op.notas}</p>
                      )}
                    </div>

                    {/* Actions + chevron */}
                    <div className="flex flex-col gap-1.5 flex-shrink-0 items-end">
                      <button
                        onClick={e => handleKanban(op, e)}
                        disabled={isLoading}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-xs font-medium transition-colors whitespace-nowrap"
                      >
                        {isLoading && !isConfirming
                          ? <Loader2 size={11} className="animate-spin" />
                          : <TrendingUp size={11} />
                        }
                        Jogar no Funil
                      </button>

                      {isConfirming ? (
                        <button
                          onClick={e => handleConfirmDiscard(op.id, e)}
                          disabled={isLoading}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-xs font-medium transition-colors whitespace-nowrap"
                        >
                          {isLoading ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
                          Confirmar
                        </button>
                      ) : (
                        <button
                          onClick={e => { e.stopPropagation(); setConfirmDiscard(op.id); }}
                          disabled={isLoading}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 disabled:opacity-50 text-xs font-medium transition-colors whitespace-nowrap"
                        >
                          <Trash2 size={11} />
                          Descartar
                        </button>
                      )}
                    </div>

                    <ChevronRight size={15} className="text-gray-300 dark:text-gray-600 group-hover:text-gold-400 transition-colors flex-shrink-0 ml-1" />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Detail drawer */}
      {selectedOp && (
        <OportunidadeDetailDrawer
          op={selectedOp}
          onClose={() => setSelectedOp(null)}
          onSendToKanban={handleDrawerKanban}
          onDiscard={handleDrawerDiscard}
        />
      )}
    </>
  );
}

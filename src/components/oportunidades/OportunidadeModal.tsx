import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  X, MessageCircle, CheckCircle2, Phone,
  Calendar, DollarSign, FileText, ExternalLink, ChevronRight, Loader2,
  TrendingUp, Trash2
} from 'lucide-react';
import { Oportunidade } from '../../types';
import { authFetch } from '../../utils/authFetch';
import { cn } from '../../utils/cn';

// ─── Status pipeline ───────────────────────────────────────────────────────
const STATUSES = [
  { key: 'pendente',   label: 'Pendente',   color: 'amber'   },
  { key: 'contatado',  label: 'Contatado',  color: 'blue'    },
  { key: 'negociando', label: 'Negociando', color: 'gold'  },
] as const;

const STATUS_COLORS: Record<string, string> = {
  pendente:   'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-500/30',
  contatado:  'bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-500/30',
  negociando: 'bg-gold-100 dark:bg-gold-500/20 text-gold-700 dark:text-gold-300 border-gold-200 dark:border-gold-500/30',
  convertido: 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30',
  converted:  'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30',
  perdido:    'bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-300 border-red-200 dark:border-red-500/30',
  dismissed:  'bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-300 border-red-200 dark:border-red-500/30',
  future:     'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-500/30',
  active:     'bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-500/30',
  urgent:     'bg-orange-100 dark:bg-orange-500/20 text-orange-700 dark:text-orange-300 border-orange-200 dark:border-orange-500/30',
  em_kanban:  'bg-violet-100 dark:bg-violet-500/20 text-violet-700 dark:text-violet-300 border-violet-200 dark:border-violet-500/30',
};

const STATUS_LABEL: Record<string, string> = {
  pendente: 'Pendente', contatado: 'Contatado', negociando: 'Negociando',
  convertido: 'Convertido', converted: 'Convertido',
  perdido: 'Descartado', dismissed: 'Descartado',
  future: 'Pendente', active: 'Ativo', urgent: 'Urgente',
  em_kanban: 'No Funil',
};

// ─── Utils ─────────────────────────────────────────────────────────────────
const gerarLinkWhatsApp = (tel: string, msg: string) => {
  const n = tel.replace(/\D/g, '');
  const num = n.startsWith('55') ? n : `55${n}`;
  return `https://wa.me/${num}?text=${encodeURIComponent(msg)}`;
};

const isPipeline = (s: string) => ['pendente', 'contatado', 'negociando'].includes(s);
const isTerminal = (s: string) => ['convertido', 'converted', 'perdido', 'dismissed', 'em_kanban'].includes(s);

// ─── Props ─────────────────────────────────────────────────────────────────
interface OportunidadeModalProps {
  op: Oportunidade & { cliente_telefone?: string; cliente_email?: string };
  onClose: () => void;
  onUpdated: (updated: Partial<Oportunidade>) => void;
}

export function OportunidadeModal({ op, onClose, onUpdated }: OportunidadeModalProps) {
  const navigate = useNavigate();
  const [status, setStatus] = useState(op.status);
  const [notas, setNotas] = useState(op.notas || '');
  const [valor, setValor] = useState(op.valor_proposta ? String(op.valor_proposta) : '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Sub-formulário: converter em job
  const [showConvert, setShowConvert] = useState(false);
  const [jobDate, setJobDate] = useState(op.data_oportunidade || '');
  const [jobAmount, setJobAmount] = useState(valor);
  const [jobPayment, setJobPayment] = useState('PIX');
  const [converting, setConverting] = useState(false);

  // Descartar
  const [showLost, setShowLost] = useState(false);
  const [motivoPerdido, setMotivoPerdido] = useState('');
  const [markingLost, setMarkingLost] = useState(false);

  // Enviar para o Kanban
  const [showKanban, setShowKanban] = useState(false);
  const [kanbanTitle, setKanbanTitle] = useState(op.tipo);
  const [kanbanValue, setKanbanValue] = useState(op.valor_proposta ? String(op.valor_proposta) : '');
  const [sendingToKanban, setSendingToKanban] = useState(false);

  const telefone = (op as any).cliente_telefone || '';
  const dataFormatada = op.data_oportunidade
    ? new Date(op.data_oportunidade + 'T12:00:00').toLocaleDateString('pt-BR')
    : '—';

  const mensagemWpp =
    `Olá ${op.cliente_nome}! 😊\n\nPassando para falar sobre ${op.tipo}.\n` +
    (valor ? `Valor: R$ ${Number(valor).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}\n` : '') +
    `\nQualquer dúvida, estou à disposição! 📸`;

  // ── Save notes/value ────────────────────────────────────────────────────
  const handleSave = async () => {
    setSaving(true);
    try {
      await authFetch(`/api/oportunidades/${op.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          status,
          notas,
          valor_proposta: valor ? Number(valor) : null,
        }),
      });
      onUpdated({ status, notas, valor_proposta: valor ? Number(valor) : undefined });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  // ── Change status via pipeline ──────────────────────────────────────────
  const handleStatusChange = async (newStatus: string) => {
    setStatus(newStatus);
    try {
      await authFetch(`/api/oportunidades/${op.id}`, {
        method: 'PUT',
        body: JSON.stringify({ status: newStatus }),
      });
      onUpdated({ status: newStatus });
    } catch (e) {
      console.error(e);
    }
  };

  // ── Convert to Job ──────────────────────────────────────────────────────
  const handleConverter = async (e: React.FormEvent) => {
    e.preventDefault();
    setConverting(true);
    try {
      await authFetch(`/api/oportunidades/${op.id}/converter-job`, {
        method: 'POST',
        body: JSON.stringify({
          job_date: jobDate,
          amount: Number(jobAmount) || 0,
          payment_method: jobPayment,
          job_name: op.tipo,
        }),
      });
      setStatus('converted');
      onUpdated({ status: 'converted' });
      setShowConvert(false);
    } catch (e) {
      console.error(e);
    } finally {
      setConverting(false);
    }
  };

  // ── Mark as Lost / Descartar ────────────────────────────────────────────
  const handlePerdido = async () => {
    setMarkingLost(true);
    try {
      await authFetch(`/api/oportunidades/${op.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          status: 'dismissed',
          notas: motivoPerdido ? `Motivo descarte: ${motivoPerdido}` : notas,
        }),
      });
      setStatus('dismissed');
      onUpdated({ status: 'dismissed' });
      setShowLost(false);
      onClose();
    } catch (e) {
      console.error(e);
    } finally {
      setMarkingLost(false);
    }
  };

  // ── Enviar para o Kanban ─────────────────────────────────────────────────
  const handleEnviarKanban = async () => {
    setSendingToKanban(true);
    try {
      await authFetch('/api/deals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: kanbanTitle || op.tipo,
          client_id: op.cliente_id || null,
          value: Number(kanbanValue) || 0,
          notes: notas || `Oportunidade: ${op.tipo}`,
          priority: 'medium',
        }),
      });
      await authFetch(`/api/oportunidades/${op.id}`, {
        method: 'PUT',
        body: JSON.stringify({ status: 'em_kanban' }),
      });
      setStatus('em_kanban');
      onUpdated({ status: 'em_kanban' });
      setShowKanban(false);
    } catch (e) {
      console.error(e);
    } finally {
      setSendingToKanban(false);
    }
  };

  const terminal = isTerminal(status);

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white dark:bg-gray-900 w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl shadow-2xl max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-gray-100 dark:border-gray-800 flex-shrink-0">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-0.5">{op.tipo}</p>
            <h2 className="font-bold text-gray-900 dark:text-white text-base truncate">{op.cliente_nome}</h2>
          </div>
          <div className="flex items-center gap-2 ml-3">
            <span className={cn('px-2 py-0.5 rounded-full text-xs font-semibold border', STATUS_COLORS[status] || STATUS_COLORS.future)}>
              {STATUS_LABEL[status] || status}
            </span>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400">
              <X size={17} />
            </button>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">

          {/* Pipeline de status */}
          {!terminal && (
            <div>
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Status</p>
              <div className="flex gap-2 flex-wrap">
                {STATUSES.map((s, i) => (
                  <button
                    key={s.key}
                    onClick={() => handleStatusChange(s.key)}
                    className={cn(
                      'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all',
                      status === s.key
                        ? STATUS_COLORS[s.key]
                        : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600'
                    )}
                  >
                    {i < STATUSES.findIndex(x => x.key === status) && <CheckCircle2 size={11} />}
                    {s.label}
                    {i < STATUSES.length - 1 && <ChevronRight size={11} className="opacity-40" />}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Cliente */}
          <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-4 space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold text-gray-900 dark:text-white text-sm">{op.cliente_nome}</p>
                {telefone && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1 mt-0.5">
                    <Phone size={11} />
                    {telefone}
                  </p>
                )}
              </div>
              {telefone && (
                <a
                  href={gerarLinkWhatsApp(telefone, mensagemWpp)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-medium transition-colors"
                >
                  <MessageCircle size={13} />
                  WhatsApp
                  <ExternalLink size={11} />
                </a>
              )}
            </div>
          </div>

          {/* Data */}
          <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
            <Calendar size={15} className="text-gray-400" />
            <span>Data prevista: <strong className="text-gray-900 dark:text-white">{dataFormatada}</strong></span>
          </div>

          {/* Valor da proposta */}
          <div>
            <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2 block flex items-center gap-1.5">
              <DollarSign size={12} />
              Valor da Proposta
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">R$</span>
              <input
                type="number"
                placeholder="0,00"
                value={valor}
                onChange={e => setValor(e.target.value)}
                className="w-full pl-9 pr-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm"
              />
            </div>
          </div>

          {/* Notas */}
          <div>
            <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2 block flex items-center gap-1.5">
              <FileText size={12} />
              Notas
            </label>
            <textarea
              rows={3}
              value={notas}
              onChange={e => setNotas(e.target.value)}
              placeholder="Adicione observações sobre esta oportunidade..."
              className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm resize-none"
            />
          </div>

          {/* Converter em Job — mini form */}
          {showConvert && !terminal && (
            <form onSubmit={handleConverter} className="bg-gold-50 dark:bg-gold-500/10 rounded-xl p-4 space-y-3 border border-gold-100 dark:border-gold-500/20">
              <p className="text-sm font-semibold text-gold-700 dark:text-gold-300 flex items-center gap-2">
                <CheckCircle2 size={15} />
                Converter em Job
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1 block">Data do ensaio *</label>
                  <input required type="date" value={jobDate} onChange={e => setJobDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm" />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1 block">Valor (R$)</label>
                  <input type="number" placeholder="0" value={jobAmount} onChange={e => setJobAmount(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm" />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1 block">Pagamento</label>
                  <select value={jobPayment} onChange={e => setJobPayment(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm">
                    {['PIX', 'Dinheiro', 'Cartão de Crédito', 'Cartão de Débito', 'Boleto', 'Outros'].map(p => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => setShowConvert(false)}
                  className="flex-1 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm text-gray-600 dark:text-gray-400">
                  Cancelar
                </button>
                <button type="submit" disabled={converting}
                  className="flex-1 py-2 rounded-lg bg-gold-600 hover:bg-gold-700 disabled:opacity-50 text-white text-sm font-medium flex items-center justify-center gap-2">
                  {converting && <Loader2 size={13} className="animate-spin" />}
                  Criar Job
                </button>
              </div>
            </form>
          )}

          {/* Descartar — mini form */}
          {showLost && !terminal && (
            <div className="bg-red-50 dark:bg-red-500/10 rounded-xl p-4 space-y-3 border border-red-100 dark:border-red-500/20">
              <p className="text-sm font-semibold text-red-600 dark:text-red-400 flex items-center gap-2">
                <Trash2 size={15} />
                Descartar Oportunidade
              </p>
              <div>
                <label className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1 block">Motivo (opcional)</label>
                <input type="text" value={motivoPerdido} onChange={e => setMotivoPerdido(e.target.value)}
                  placeholder="Ex: Cliente escolheu outro fotógrafo, orçamento alto..."
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm" />
              </div>
              <div className="flex gap-2">
                <button onClick={() => setShowLost(false)}
                  className="flex-1 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm text-gray-600 dark:text-gray-400">
                  Cancelar
                </button>
                <button onClick={handlePerdido} disabled={markingLost}
                  className="flex-1 py-2 rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium flex items-center justify-center gap-2">
                  {markingLost && <Loader2 size={13} className="animate-spin" />}
                  Descartar
                </button>
              </div>
            </div>
          )}

          {/* Enviar para o Kanban — mini form */}
          {showKanban && !terminal && (
            <div className="bg-violet-50 dark:bg-violet-500/10 rounded-xl p-4 space-y-3 border border-violet-100 dark:border-violet-500/20">
              <p className="text-sm font-semibold text-violet-700 dark:text-violet-300 flex items-center gap-2">
                <TrendingUp size={15} />
                Criar no Funil de Vendas
              </p>
              <div>
                <label className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1 block">Título do negócio</label>
                <input
                  type="text"
                  value={kanbanTitle}
                  onChange={e => setKanbanTitle(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1 block">Valor estimado (R$)</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">R$</span>
                  <input
                    type="number"
                    placeholder="0"
                    value={kanbanValue}
                    onChange={e => setKanbanValue(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm"
                  />
                </div>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                O negócio será criado na primeira etapa do funil vinculado a <strong>{op.cliente_nome}</strong>.
              </p>
              <div className="flex gap-2">
                <button onClick={() => setShowKanban(false)}
                  className="flex-1 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm text-gray-600 dark:text-gray-400">
                  Cancelar
                </button>
                <button onClick={handleEnviarKanban} disabled={sendingToKanban}
                  className="flex-1 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-medium flex items-center justify-center gap-2">
                  {sendingToKanban && <Loader2 size={13} className="animate-spin" />}
                  Enviar para o Funil
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 pb-5 pt-3 border-t border-gray-100 dark:border-gray-800 flex-shrink-0">
          {status === 'em_kanban' ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm text-violet-700 dark:text-violet-300 justify-center">
                <CheckCircle2 size={15} />
                <span className="font-medium">Oportunidade enviada para o Funil de Vendas!</span>
              </div>
              <button
                onClick={() => { onClose(); navigate('/vendas'); }}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium transition-colors"
              >
                <TrendingUp size={14} />
                Ver no Funil de Vendas
                <ExternalLink size={13} />
              </button>
            </div>
          ) : terminal ? (
            <div className="text-center text-sm text-gray-400">
              Esta oportunidade está encerrada ({STATUS_LABEL[status] || status}).
            </div>
          ) : (
            <div className="space-y-2">
              {/* Kanban — ação principal */}
              <button
                onClick={() => { setShowKanban(v => !v); setShowLost(false); setShowConvert(false); }}
                className={cn(
                  'w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition-colors border',
                  showKanban
                    ? 'bg-violet-600 text-white border-violet-600'
                    : 'border-violet-300 dark:border-violet-600 text-violet-700 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-500/10'
                )}
              >
                <TrendingUp size={14} />
                Jogar no Kanban (Funil de Vendas)
              </button>

              {/* Save + Convert */}
              <div className="flex gap-2">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl bg-gold-600 hover:bg-gold-700 disabled:opacity-50 text-white text-xs font-medium transition-colors"
                >
                  {saving ? <Loader2 size={12} className="animate-spin" /> : saved ? <CheckCircle2 size={12} /> : null}
                  {saved ? 'Salvo!' : saving ? 'Salvando...' : 'Salvar Anotações'}
                </button>
                <button
                  onClick={() => { setShowConvert(v => !v); setShowLost(false); setShowKanban(false); }}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl border border-emerald-300 dark:border-emerald-600 text-emerald-700 dark:text-emerald-400 text-xs font-medium hover:bg-emerald-50 dark:hover:bg-emerald-500/10 transition-colors"
                >
                  <CheckCircle2 size={12} />
                  Converter em Job
                </button>
              </div>

              {/* Descartar */}
              <button
                onClick={() => { setShowLost(v => !v); setShowConvert(false); setShowKanban(false); }}
                className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl border border-red-200 dark:border-red-700 text-red-600 dark:text-red-400 text-xs font-medium hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
              >
                <Trash2 size={12} />
                Descartar Oportunidade
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, Scissors, X, XCircle } from 'lucide-react';
import { authFetch } from '../../utils/authFetch';
import { allocateMoney } from '../../utils/salePricing';
import type { JobWithProduction } from './ProductionBoard';

type SaleJob = Pick<JobWithProduction, 'id' | 'job_type' | 'job_name' | 'job_date' | 'amount' | 'production_stage' | 'status'> & {
  sale_gross_amount?: number | null;
  sale_discount_amount?: number | null;
  sale_session_index?: number | null;
  google_event_id?: string | null;
};

interface SaleContext {
  deal: { id: number; title?: string; value: number; gross: number; discount: number };
  jobs: SaleJob[];
  items?: SaleItem[];
  received: number;
  cancellation?: {
    id: string;
    reason: string;
    refund_status: 'none' | 'pending' | 'partial' | 'refunded';
    refund_expected: number;
    refund_paid: number;
    refund_due_date?: string | null;
    cancelled_at: string;
  } | null;
}

interface SaleItem {
  id: string;
  source: 'deal' | 'job';
  catalog_type: string;
  catalog_name: string;
  catalog_value: number;
  quantidade: number;
  discount_value?: number | null;
  job_id?: number | null;
}

interface SplitDraft {
  job_type: string;
  job_name: string;
  job_date: string;
  gross_amount: string;
  production_stage: string;
}

const money = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const today = () => new Date().toISOString().slice(0, 10);
const itemKey = (item: SaleItem) => `${item.source}:${item.id}`;
const itemValue = (item: SaleItem) => Math.max(
  0,
  (Number(item.catalog_value) || 0) * (Number(item.quantidade) || 1) - (Number(item.discount_value) || 0),
);
const roundMoney = (value: number) => Math.round(value * 100) / 100;

function itemTotalsByTarget(
  items: SaleItem[],
  assignments: Record<string, number>,
  rowCount: number,
) {
  const totals = Array.from({ length: rowCount }, () => 0);
  items.forEach(item => {
    const target = assignments[itemKey(item)];
    if (Number.isInteger(target) && target >= 0 && target < rowCount) {
      totals[target] = roundMoney(totals[target] + itemValue(item));
    }
  });
  return totals;
}

function SplitCardAmounts({ sale, discount, extras }: { sale: number; discount: number; extras: number }) {
  const total = roundMoney(sale - discount + extras);
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-xl bg-gray-50 px-3 py-2.5 text-xs dark:bg-gray-800/70">
      <span className="text-gray-500 dark:text-gray-400">Valor da venda</span>
      <span className="text-right font-medium text-gray-800 dark:text-gray-100">{money(sale)}</span>
      <span className="text-gray-500 dark:text-gray-400">Desconto</span>
      <span className="text-right font-medium text-gray-800 dark:text-gray-100">− {money(discount)}</span>
      <span className="text-gray-500 dark:text-gray-400">Adicionais</span>
      <span className="text-right font-medium text-gray-800 dark:text-gray-100">{money(extras)}</span>
      <span className="mt-1 border-t border-gray-200 pt-2 font-semibold text-gray-700 dark:border-gray-700 dark:text-gray-200">Total final</span>
      <strong className="mt-1 border-t border-gray-200 pt-2 text-right text-gray-900 dark:border-gray-700 dark:text-white">{money(total)}</strong>
    </div>
  );
}

function PaymentDifferenceNotice({ difference }: { difference: number }) {
  if (difference > 0.009) {
    return (
      <div className="mt-3 rounded-lg bg-blue-50 px-3 py-2.5 text-blue-800 dark:bg-blue-900/20 dark:text-blue-200">
        <div className="flex items-center justify-between gap-3 text-sm font-semibold">
          <span>Crédito preservado</span>
          <strong>{money(difference)}</strong>
        </div>
        <p className="mt-1 text-xs opacity-80">Este valor recebido a mais continuará preservado e não será atribuído a nenhum card.</p>
      </div>
    );
  }
  if (difference < -0.009) {
    return (
      <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2.5 text-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
        <div className="flex items-center justify-between gap-3 text-sm font-semibold">
          <span>Saldo a receber</span>
          <strong>{money(Math.abs(difference))}</strong>
        </div>
        <p className="mt-1 text-xs opacity-80">A separação pode continuar. O saldo seguirá pendente nos cards.</p>
      </div>
    );
  }
  return (
    <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300">
      Recebimentos conciliados com o total dos cards.
    </p>
  );
}

function SplitSaleTotals({ sale, extras, cards, received }: {
  sale: number;
  extras: number;
  cards: number;
  received: number;
}) {
  const paymentDifference = roundMoney(received - cards);
  const differenceLabel = paymentDifference > 0.009
    ? `+ ${money(paymentDifference)}`
    : paymentDifference < -0.009 ? `− ${money(Math.abs(paymentDifference))}` : money(0);
  const differenceColor = paymentDifference > 0.009
    ? 'text-blue-700 dark:text-blue-300'
    : paymentDifference < -0.009 ? 'text-amber-700 dark:text-amber-300' : 'text-emerald-700 dark:text-emerald-300';
  return (
    <div className="rounded-xl border border-gray-200 p-3 text-sm dark:border-gray-700">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2">
        <span className="text-gray-500 dark:text-gray-400">Venda original</span>
        <strong className="text-right text-gray-900 dark:text-white">{money(sale)}</strong>
        <span className="text-gray-500 dark:text-gray-400">Adicionais</span>
        <strong className="text-right text-gray-900 dark:text-white">{money(extras)}</strong>
        <span className="border-t border-gray-200 pt-2 font-semibold text-gray-700 dark:border-gray-700 dark:text-gray-200">Total dos cards</span>
        <strong className="border-t border-gray-200 pt-2 text-right text-gray-900 dark:border-gray-700 dark:text-white">{money(cards)}</strong>
        <span className="text-gray-500 dark:text-gray-400">Recebido</span>
        <strong className="text-right text-gray-900 dark:text-white">{money(received)}</strong>
        <span className="text-gray-500 dark:text-gray-400">Diferença</span>
        <strong className={`text-right ${differenceColor}`}>{differenceLabel}</strong>
      </div>
      <PaymentDifferenceNotice difference={paymentDifference} />
      <p className="mt-3 text-xs text-gray-500">Os produtos seguem o destino escolhido e os arquivos permanecem no card atual.</p>
    </div>
  );
}

function suggestedItemTarget(item: SaleItem, index: number, rowCount: number) {
  const normalized = item.catalog_name.toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (rowCount > 1 && normalized.includes('newborn')) return 1;
  if (normalized.includes('gestante')) return 0;
  return Math.min(index, rowCount - 1);
}

function initialItemAssignments(items: SaleItem[], rows: SplitDraft[], jobs: SaleJob[]) {
  const jobIndex = new Map(jobs.map((saleJob, index) => [Number(saleJob.id), index]));
  return Object.fromEntries(items.map((item, index) => {
    const existingTarget = item.job_id == null ? undefined : jobIndex.get(Number(item.job_id));
    return [itemKey(item), existingTarget ?? suggestedItemTarget(item, index, rows.length)];
  }));
}

function initialSplit(job: JobWithProduction, context: SaleContext): SplitDraft[] {
  const gross = Number(context.deal.gross) || 0;
  const first = Math.round(gross * 50) / 100;
  const combined = /gestante/i.test(job.job_type || '') && /newborn/i.test(job.job_type || '');
  return [
    {
      job_type: combined ? 'Gestante' : job.job_type || 'Ensaio 1',
      job_name: combined ? 'Ensaio Gestante' : job.job_name || job.job_type || 'Ensaio 1',
      job_date: (job.job_date || '').slice(0, 10),
      gross_amount: first.toFixed(2),
      production_stage: job.production_stage || '',
    },
    {
      job_type: combined ? 'Newborn' : 'Novo ensaio',
      job_name: combined ? 'Ensaio Newborn' : 'Novo ensaio',
      job_date: '',
      gross_amount: Math.max(0, gross - first).toFixed(2),
      production_stage: job.production_stage || '',
    },
  ];
}

function ModalShell({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-gray-950/45 p-0 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true">
      <div className="flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl dark:bg-gray-900 sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4 dark:border-gray-700">
          <h3 className="text-base font-bold text-gray-900 dark:text-white">{title}</h3>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800" aria-label="Fechar">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function SplitSaleModal({ job, context, stages, onClose, onSaved }: {
  job: JobWithProduction;
  context: SaleContext;
  stages: { id: string; name: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [rows, setRows] = useState<SplitDraft[]>(() => initialSplit(job, context));
  const saleItems = context.items || [];
  const dealItems = saleItems.filter(item => item.source === 'deal');
  const additionalItems = saleItems.filter(item => item.source === 'job');
  const [itemAssignments, setItemAssignments] = useState<Record<string, number>>(
    () => initialItemAssignments(saleItems, initialSplit(job, context), context.jobs),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const detailedItemsTotal = dealItems.reduce((sum, item) => sum + itemValue(item), 0);
  const valuesComeFromItems = dealItems.length > 0 && Math.abs(detailedItemsTotal - context.deal.gross) < 0.01;
  const grossValues = valuesComeFromItems
    ? rows.map((_, rowIndex) => dealItems.reduce(
      (sum, item) => sum + (itemAssignments[itemKey(item)] === rowIndex ? itemValue(item) : 0), 0,
    ))
    : rows.map(row => Math.max(0, Number(row.gross_amount) || 0));
  const grossTotal = grossValues.reduce((sum, value) => sum + value, 0);
  const discounts = useMemo(
    () => allocateMoney(context.deal.discount, grossValues),
    [context.deal.discount, grossValues.join('|')],
  );
  const difference = Math.round((context.deal.gross - grossTotal) * 100) / 100;
  const additionalValues = itemTotalsByTarget(additionalItems, itemAssignments, rows.length);
  const additionalTotal = roundMoney(additionalValues.reduce((sum, value) => sum + value, 0));
  const cardTotals = grossValues.map((gross, index) => (
    roundMoney(gross - (discounts[index] || 0) + (additionalValues[index] || 0))
  ));
  const cardsTotal = roundMoney(cardTotals.reduce((sum, value) => sum + value, 0));
  const originalSaleTotal = roundMoney(context.deal.gross - context.deal.discount);
  const itemsHaveDestination = saleItems.every(item => {
    const target = itemAssignments[itemKey(item)];
    return Number.isInteger(target) && target >= 0 && target < rows.length;
  });
  const valuesMatch = Math.abs(difference) < 0.01;
  const cardsHaveNames = rows.every(row => row.job_type.trim() && row.job_name.trim());
  const valid = valuesMatch
    && itemsHaveDestination
    && cardsHaveNames;

  const patchRow = (index: number, patch: Partial<SplitDraft>) => {
    setRows(current => current.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row));
  };

  const removeRow = (index: number) => {
    setRows(current => current.filter((_, rowIndex) => rowIndex !== index));
    setItemAssignments(current => Object.fromEntries(Object.entries(current).map(([key, target]) => [
      key,
      target === index ? 0 : target > index ? target - 1 : target,
    ])));
  };

  const submit = async () => {
    if (!valid) return;
    setSaving(true);
    setError('');
    const sessions = rows.map((row, index) => ({
      session_index: index,
      job_type: row.job_type.trim(),
      job_name: row.job_name.trim(),
      job_date: row.job_date || null,
      production_stage: row.production_stage || job.production_stage || null,
      gross_amount: grossValues[index],
      discount_amount: discounts[index],
      amount: Math.round((grossValues[index] - discounts[index]) * 100) / 100,
      deal_item_ids: saleItems
        .filter(item => item.source === 'deal' && itemAssignments[itemKey(item)] === index)
        .map(item => item.id),
      job_item_ids: saleItems
        .filter(item => item.source === 'job' && itemAssignments[itemKey(item)] === index)
        .map(item => item.id),
    }));
    try {
      const response = await authFetch(`/api/jobs/${job.id}/split-sale`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessions }),
      });
      const result: any = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Não foi possível separar os ensaios.');
      onSaved();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell title="Separar ensaios da venda" onClose={onClose}>
      <div className="space-y-4 overflow-y-auto p-5">
        <div className="rounded-xl bg-blue-50 p-3 text-sm text-blue-800 dark:bg-blue-900/20 dark:text-blue-200">
          A venda continua única. O card atual será preservado e os novos cards receberão os itens que você escolher.
        </div>
        {rows.map((row, index) => (
          <section key={index} className="space-y-3 rounded-2xl border border-gray-200 p-4 dark:border-gray-700">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-bold text-gray-900 dark:text-white">{index === 0 ? 'Card atual' : `Novo card ${index}`}</h4>
              {index > 1 && <button type="button" onClick={() => removeRow(index)} className="text-xs font-semibold text-red-500">Remover</button>}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="text-xs font-semibold text-gray-600 dark:text-gray-300">Tipo do ensaio
                <input value={row.job_type} onChange={event => patchRow(index, { job_type: event.target.value })} className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800" />
              </label>
              <label className="text-xs font-semibold text-gray-600 dark:text-gray-300">Nome do card
                <input value={row.job_name} onChange={event => patchRow(index, { job_name: event.target.value })} className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800" />
              </label>
              <label className="text-xs font-semibold text-gray-600 dark:text-gray-300">Valor bruto
                {valuesComeFromItems ? (
                  <span className="mt-1 block rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-semibold text-gray-800 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100">
                    {money(grossValues[index])}
                  </span>
                ) : (
                  <input type="number" min="0" step="0.01" value={row.gross_amount} onChange={event => patchRow(index, { gross_amount: event.target.value })} className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800" />
                )}
                {valuesComeFromItems && <span className="mt-1 block text-[11px] font-normal text-gray-400">Calculado pelos itens deste card.</span>}
              </label>
              <label className="text-xs font-semibold text-gray-600 dark:text-gray-300">Data do ensaio
                <input type="date" value={row.job_date} onChange={event => patchRow(index, { job_date: event.target.value })} className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800" />
                {!row.job_date && <span className="mt-1 block text-[11px] font-normal text-gray-400">Será definido depois.</span>}
              </label>
              <label className="text-xs font-semibold text-gray-600 dark:text-gray-300 sm:col-span-2">Etapa inicial
                <select value={row.production_stage} onChange={event => patchRow(index, { production_stage: event.target.value })} className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800">
                  {stages.map(stage => <option key={stage.id} value={stage.id}>{stage.name}</option>)}
                </select>
              </label>
            </div>
            <SplitCardAmounts
              sale={grossValues[index] || 0}
              discount={discounts[index] || 0}
              extras={additionalValues[index] || 0}
            />
          </section>
        ))}
        <button type="button" onClick={() => setRows(current => [...current, { job_type: 'Novo ensaio', job_name: 'Novo ensaio', job_date: '', gross_amount: '0.00', production_stage: job.production_stage || stages[0]?.id || '' }])} className="text-sm font-semibold text-gold-600 dark:text-gold-400">+ Adicionar outro ensaio</button>
        {saleItems.length > 0 && (
          <section className="space-y-3 border-t border-gray-200 pt-4 dark:border-gray-700">
            <div>
              <h4 className="text-sm font-bold text-gray-900 dark:text-white">Combos e produtos vendidos</h4>
              <p className="mt-1 text-xs text-gray-500">Escolha em qual card cada item deve aparecer.</p>
            </div>
            <div className="space-y-2">
              {saleItems.map(item => (
                <div key={itemKey(item)} className="flex flex-col gap-2 rounded-xl border border-gray-200 px-3 py-3 dark:border-gray-700 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-gray-900 dark:text-white">{item.catalog_name}</p>
                    <p className="text-xs text-gray-500">
                      {item.catalog_type === 'combo' ? 'Combo' : item.catalog_type === 'produto' ? 'Produto' : 'Serviço'}
                      {' · '}{Number(item.quantidade) || 1}x · {money(itemValue(item))}
                      {item.source === 'job' ? ' · adicional' : ''}
                    </p>
                  </div>
                  <label className="text-[11px] font-semibold text-gray-500 sm:w-48">Card de destino
                    <select
                      value={itemAssignments[itemKey(item)] ?? ''}
                      onChange={event => setItemAssignments(current => ({ ...current, [itemKey(item)]: Number(event.target.value) }))}
                      className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-2 py-2 text-sm text-gray-800 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                    >
                      {rows.map((row, rowIndex) => (
                        <option key={rowIndex} value={rowIndex}>{rowIndex === 0 ? 'Card atual' : row.job_name || `Novo card ${rowIndex}`}</option>
                      ))}
                    </select>
                  </label>
                </div>
              ))}
            </div>
          </section>
        )}
        {!valuesMatch && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 dark:bg-red-900/20 dark:text-red-300">Ajuste {money(Math.abs(difference))} na distribuição da venda para os valores fecharem exatamente.</p>}
        {!cardsHaveNames && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 dark:bg-red-900/20 dark:text-red-300">Preencha o tipo e o nome de todos os cards.</p>}
        <SplitSaleTotals
          sale={originalSaleTotal}
          extras={additionalTotal}
          cards={cardsTotal}
          received={Number(context.received) || 0}
        />
      </div>
      <div className="border-t border-gray-200 p-4 dark:border-gray-700">
        {error && (
          <div role="alert" aria-live="assertive" className="mb-3 flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2.5 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:gap-3">
          <button type="button" onClick={onClose} className="flex-1 rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-semibold dark:border-gray-700">Voltar</button>
          <button type="button" onClick={submit} disabled={!valid || saving} className="flex-1 rounded-xl bg-gray-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40 dark:bg-white dark:text-gray-900">{saving ? 'Separando…' : 'Confirmar separação'}</button>
        </div>
      </div>
    </ModalShell>
  );
}

function CancelSaleModal({ context, onClose, onSaved }: { context: SaleContext; onClose: () => void; onSaved: () => void }) {
  const [reason, setReason] = useState('Cliente desistiu da venda');
  const [mode, setMode] = useState<'none' | 'pending' | 'refunded'>('pending');
  const [amount, setAmount] = useState(String(context.received || ''));
  const [date, setDate] = useState(today());
  const [paymentMethod, setPaymentMethod] = useState('Pix');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const refundAmount = Number(amount) || 0;
  const valid = reason.trim() && (mode === 'none' || (refundAmount > 0 && refundAmount <= context.received && date));

  const submit = async () => {
    if (!valid) return;
    setSaving(true);
    setError('');
    const payload = {
      reason: reason.trim(),
      refund_status: mode,
      refund_expected: mode === 'none' ? 0 : refundAmount,
      refund_paid: mode === 'refunded' ? refundAmount : 0,
      refund_due_date: mode === 'pending' ? date : null,
      refund_date: mode === 'refunded' ? date : null,
      payment_method: mode === 'refunded' ? paymentMethod : null,
    };
    try {
      const response = await authFetch(`/api/deals/${context.deal.id}/cancel-sale`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      const result: any = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Não foi possível cancelar a venda.');
      onSaved();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell title="Cancelar venda" onClose={onClose}>
      <div className="space-y-4 overflow-y-auto p-5">
        <div className="rounded-xl bg-red-50 p-3 text-sm text-red-800 dark:bg-red-900/20 dark:text-red-200">
          Esta ação cancela {context.jobs.length === 1 ? 'o ensaio desta venda' : `os ${context.jobs.length} ensaios desta venda`}. Os pagamentos, contratos e arquivos serão preservados.
        </div>
        <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300">Motivo
          <textarea value={reason} onChange={event => setReason(event.target.value)} rows={2} className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800" />
        </label>
        <div>
          <p className="mb-2 text-xs font-semibold text-gray-600 dark:text-gray-300">Situação da devolução</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {([
              ['none', 'Sem devolução'], ['pending', 'Vai devolver'], ['refunded', 'Já devolveu'],
            ] as const).map(([value, label]) => (
              <button key={value} type="button" onClick={() => setMode(value)} className={`rounded-xl border px-3 py-2 text-sm font-semibold ${mode === value ? 'border-gold-500 bg-gold-50 text-gold-700 dark:bg-gold-900/20 dark:text-gold-300' : 'border-gray-200 text-gray-600 dark:border-gray-700 dark:text-gray-300'}`}>{label}</button>
            ))}
          </div>
        </div>
        {mode !== 'none' && <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="text-xs font-semibold text-gray-600 dark:text-gray-300">Valor da devolução
            <input type="number" min="0.01" max={context.received} step="0.01" value={amount} onChange={event => setAmount(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800" />
          </label>
          <label className="text-xs font-semibold text-gray-600 dark:text-gray-300">{mode === 'pending' ? 'Data prevista' : 'Data da devolução'}
            <input type="date" value={date} onChange={event => setDate(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800" />
          </label>
          {mode === 'refunded' && <label className="text-xs font-semibold text-gray-600 dark:text-gray-300 sm:col-span-2">Como foi devolvido
            <select value={paymentMethod} onChange={event => setPaymentMethod(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800"><option>Pix</option><option>Transferência</option><option>Dinheiro</option><option>Cartão / estorno</option><option>Outro</option></select>
          </label>}
        </div>}
        <div className="rounded-xl border border-gray-200 p-3 text-sm dark:border-gray-700">
          <div className="flex justify-between"><span>Recebido</span><strong>{money(context.received)}</strong></div>
          <div className="mt-1 flex justify-between"><span>{mode === 'refunded' ? 'Devolvido' : mode === 'pending' ? 'A devolver' : 'Devolução'}</span><strong>{money(mode === 'none' ? 0 : refundAmount)}</strong></div>
        </div>
        {refundAmount > context.received && <p className="text-sm text-red-600">A devolução não pode ultrapassar o valor recebido.</p>}
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      </div>
      <div className="flex gap-3 border-t border-gray-200 p-4 dark:border-gray-700">
        <button type="button" onClick={onClose} className="flex-1 rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-semibold dark:border-gray-700">Voltar</button>
        <button type="button" onClick={submit} disabled={!valid || saving} className="flex-1 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40">{saving ? 'Cancelando…' : 'Cancelar venda'}</button>
      </div>
    </ModalShell>
  );
}

function RefundModal({ context, onClose, onSaved }: { context: SaleContext; onClose: () => void; onSaved: () => void }) {
  const cancellation = context.cancellation!;
  const remaining = Math.max(0, Number(cancellation.refund_expected) - Number(cancellation.refund_paid));
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [amount, setAmount] = useState(String(remaining));
  const [refundDate, setRefundDate] = useState(today());
  const [paymentMethod, setPaymentMethod] = useState('Pix');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const numericAmount = Number(amount) || 0;
  const valid = numericAmount > 0 && numericAmount <= remaining && Boolean(refundDate);

  const submit = async () => {
    if (!valid) return;
    setSaving(true);
    setError('');
    try {
      const response = await authFetch(`/api/sale-cancellations/${cancellation.id}/refunds`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: numericAmount,
          refund_date: refundDate,
          payment_method: paymentMethod,
          idempotency_key: idempotencyKey,
        }),
      });
      const result: any = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Não foi possível registrar a devolução.');
      onSaved();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return <ModalShell title="Registrar devolução" onClose={onClose}>
    <div className="space-y-4 overflow-y-auto p-5">
      <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
        Falta devolver {money(remaining)}. O pagamento será registrado como saída no Financeiro.
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="text-xs font-semibold text-gray-600 dark:text-gray-300">Valor devolvido
          <input type="number" min="0.01" max={remaining} step="0.01" value={amount} onChange={event => setAmount(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800" />
        </label>
        <label className="text-xs font-semibold text-gray-600 dark:text-gray-300">Data da devolução
          <input type="date" value={refundDate} onChange={event => setRefundDate(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800" />
        </label>
        <label className="text-xs font-semibold text-gray-600 dark:text-gray-300 sm:col-span-2">Como foi devolvido
          <select value={paymentMethod} onChange={event => setPaymentMethod(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800"><option>Pix</option><option>Transferência</option><option>Dinheiro</option><option>Cartão / estorno</option><option>Outro</option></select>
        </label>
      </div>
      {numericAmount > remaining && <p className="text-sm text-red-600">O valor ultrapassa o saldo a devolver.</p>}
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    </div>
    <div className="flex gap-3 border-t border-gray-200 p-4 dark:border-gray-700">
      <button type="button" onClick={onClose} className="flex-1 rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-semibold dark:border-gray-700">Voltar</button>
      <button type="button" onClick={submit} disabled={!valid || saving} className="flex-1 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40">{saving ? 'Registrando…' : 'Confirmar devolução'}</button>
    </div>
  </ModalShell>;
}

export function JobSaleActions({ job, stages, onChanged }: { job: JobWithProduction; stages: { id: string; name: string }[]; onChanged: () => void }) {
  const [context, setContext] = useState<SaleContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modal, setModal] = useState<'split' | 'cancel' | 'refund' | null>(null);
  const [retryingCalendar, setRetryingCalendar] = useState(false);

  const load = () => {
    setLoading(true);
    authFetch(`/api/jobs/${job.id}/sale-context`)
      .then(async response => {
        const result: any = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || 'Venda não encontrada.');
        setContext(result as SaleContext);
        setError('');
      })
      .catch(caught => setError((caught as Error).message))
      .finally(() => setLoading(false));
  };
  useEffect(load, [job.id]);

  const retryCalendar = async () => {
    if (!context?.cancellation) return;
    setRetryingCalendar(true);
    setError('');
    try {
      const response = await authFetch(`/api/deals/${context.deal.id}/cancel-sale`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: context.cancellation.reason }),
      });
      const result: any = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Não foi possível sincronizar a Agenda.');
      load();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setRetryingCalendar(false);
    }
  };

  if (loading) return <p className="text-xs text-gray-400">Carregando venda…</p>;
  if (!context) return <p className="text-xs text-gray-400">{error || 'Este card não possui uma venda vinculada.'}</p>;
  const cancelled = context.cancellation || job.status === 'cancelled';
  const refundRemaining = context.cancellation
    ? Math.max(0, Number(context.cancellation.refund_expected) - Number(context.cancellation.refund_paid)) : 0;
  const calendarPending = context.jobs.some(saleJob => saleJob.status === 'cancelled' && Boolean(saleJob.google_event_id));

  return (
    <section className="space-y-3 rounded-2xl border border-gray-200 p-4 dark:border-gray-700">
      <div className="flex items-start justify-between gap-3">
        <div><h3 className="text-sm font-bold text-gray-900 dark:text-white">Venda</h3><p className="text-xs text-gray-500">{context.jobs.length} ensaio{context.jobs.length === 1 ? '' : 's'} · {money(context.deal.value)}</p></div>
        {cancelled && <span className="rounded-full bg-red-100 px-2 py-1 text-[10px] font-bold uppercase text-red-700 dark:bg-red-900/30 dark:text-red-300">Cancelada</span>}
      </div>
      {context.cancellation && <div className={`flex items-start gap-2 rounded-xl p-3 text-sm ${refundRemaining > 0 ? 'bg-amber-50 text-amber-800 dark:bg-amber-900/20 dark:text-amber-200' : 'bg-emerald-50 text-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-200'}`}>
        {refundRemaining > 0 ? <AlertCircle size={16} className="mt-0.5 shrink-0" /> : <CheckCircle2 size={16} className="mt-0.5 shrink-0" />}
        <div><p className="font-semibold">{refundRemaining > 0 ? `${money(refundRemaining)} a devolver` : context.cancellation.refund_expected > 0 ? 'Devolução concluída' : 'Sem devolução'}</p><p className="mt-0.5 text-xs opacity-80">{context.cancellation.reason}</p></div>
      </div>}
      {context.cancellation && refundRemaining > 0 && (
        <button type="button" onClick={() => setModal('refund')} className="w-full rounded-xl bg-emerald-600 px-3 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700">Registrar devolução</button>
      )}
      {calendarPending && <div className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700 dark:bg-amber-900/20 dark:text-amber-300"><p>A remoção do compromisso no Google Agenda está pendente.</p><button type="button" onClick={retryCalendar} disabled={retryingCalendar} className="mt-2 underline disabled:opacity-50">{retryingCalendar ? 'Tentando…' : 'Tentar novamente'}</button></div>}
      {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
      {!cancelled && <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <button type="button" onClick={() => setModal('split')} disabled={context.jobs.length > 1} className="flex items-center justify-center gap-2 rounded-xl border border-gray-200 px-3 py-2.5 text-sm font-semibold text-gray-700 hover:border-gold-400 hover:text-gold-700 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-700 dark:text-gray-200"><Scissors size={15} />{context.jobs.length > 1 ? 'Ensaios separados' : 'Separar ensaios'}</button>
        <button type="button" onClick={() => setModal('cancel')} className="flex items-center justify-center gap-2 rounded-xl border border-red-200 px-3 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-50 dark:border-red-900/50 dark:text-red-400 dark:hover:bg-red-900/20"><XCircle size={15} />Cancelar venda</button>
      </div>}
      {modal === 'split' && <SplitSaleModal job={job} context={context} stages={stages} onClose={() => setModal(null)} onSaved={() => { setModal(null); onChanged(); }} />}
      {modal === 'cancel' && <CancelSaleModal context={context} onClose={() => setModal(null)} onSaved={() => { setModal(null); onChanged(); }} />}
      {modal === 'refund' && <RefundModal context={context} onClose={() => setModal(null)} onSaved={() => { setModal(null); onChanged(); }} />}
    </section>
  );
}

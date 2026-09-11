import React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { allocateMoney } from '../../utils/salePricing';

export interface SaleSessionDraft {
  key: string;
  job_type: string;
  job_name: string;
  job_date: string;
  job_time: string;
  job_end_time: string;
  schedule_later: boolean;
  gross_amount: number;
}

const inputClass = 'w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:ring-2 focus:ring-gray-400 dark:border-gray-700 dark:bg-gray-800 dark:text-white';
const currency = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function SessionFields({ session, index, types, onChange, onRemove, net }: {
  session: SaleSessionDraft; index: number; types: string[]; net: number;
  onChange: (patch: Partial<SaleSessionDraft>) => void; onRemove: () => void;
}) {
  const choices = Array.from(new Set([...types, session.job_type].filter(Boolean)));
  return <fieldset className="space-y-3 border-t border-gray-200 pt-4 dark:border-gray-700">
    <legend className="flex w-full items-center justify-between gap-3 pt-4 text-sm font-semibold text-gray-900 dark:text-white">
      Ensaio {index + 1}
      <button type="button" onClick={onRemove} aria-label={`Remover ensaio ${index + 1}`} className="p-2 text-gray-500 hover:text-red-600"><Trash2 size={15} /></button>
    </legend>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="space-y-1 text-xs text-gray-600 dark:text-gray-300">Tipo de ensaio
        <select className={inputClass} value={session.job_type} onChange={e => onChange({ job_type: e.target.value })}>
          <option value="">Selecione</option>{choices.map(type => <option key={type}>{type}</option>)}
        </select>
      </label>
      <label className="space-y-1 text-xs text-gray-600 dark:text-gray-300">Nome no card e contrato
        <input className={inputClass} value={session.job_name} onChange={e => onChange({ job_name: e.target.value })} placeholder={session.job_type} />
      </label>
    </div>
    <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
      <input type="checkbox" checked={session.schedule_later} onChange={e => onChange({ schedule_later: e.target.checked })} /> Definir data depois
    </label>
    {!session.schedule_later && <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      <label className="space-y-1 text-xs text-gray-600 dark:text-gray-300">Data<input type="date" className={inputClass} value={session.job_date} onChange={e => onChange({ job_date: e.target.value })} /></label>
      <label className="space-y-1 text-xs text-gray-600 dark:text-gray-300">Início<input type="time" className={inputClass} value={session.job_time} onChange={e => onChange({ job_time: e.target.value })} /></label>
      <label className="space-y-1 text-xs text-gray-600 dark:text-gray-300">Término<input type="time" className={inputClass} value={session.job_end_time} onChange={e => onChange({ job_end_time: e.target.value })} /></label>
    </div>}
    <label className="block space-y-1 text-xs text-gray-600 dark:text-gray-300">Parte deste ensaio antes do desconto (R$)
      <input type="number" min="0" step="0.01" className={inputClass} value={session.gross_amount} onChange={e => onChange({ gross_amount: Number(e.target.value) })} />
    </label>
    <p className="text-xs text-gray-500">Valor após o desconto proporcional: <strong>{currency(net)}</strong></p>
  </fieldset>;
}

export function SaleSessionFields({ sessions, onChange, types, gross, discount }: {
  sessions: SaleSessionDraft[]; onChange: (sessions: SaleSessionDraft[]) => void;
  types: string[]; gross: number; discount: number;
}) {
  const additional = sessions.reduce((sum, s) => sum + s.gross_amount, 0);
  const firstGross = Math.max(0, gross - additional);
  let discounts = sessions.map(() => 0);
  try { discounts = allocateMoney(discount, [firstGross, ...sessions.map(s => s.gross_amount)]).slice(1); } catch { /* shown by pricing field */ }
  const add = () => onChange([...sessions, {
    key: crypto.randomUUID(), job_type: types.find(type => /newborn/i.test(type)) || '', job_name: '',
    job_date: '', job_time: '09:00', job_end_time: '', schedule_later: true, gross_amount: 0,
  }]);
  return <div className="space-y-3">
    {sessions.length > 0 && <p className="text-sm text-gray-600 dark:text-gray-300">Parte do primeiro ensaio: <strong>{currency(firstGross)}</strong> antes do desconto. Cada ensaio terá contrato e produção próprios.</p>}
    {sessions.map((session, index) => <SessionFields key={session.key} session={session} index={index + 1} types={types}
      net={Math.max(0, session.gross_amount - (discounts[index] || 0))}
      onChange={patch => onChange(sessions.map(row => row.key === session.key ? { ...row, ...patch } : row))}
      onRemove={() => onChange(sessions.filter(row => row.key !== session.key))} />)}
    {additional > gross && <p role="alert" className="text-xs text-red-600">A soma dos ensaios não pode ultrapassar o valor da venda.</p>}
    <button type="button" onClick={add} disabled={sessions.length >= 19} className="flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800">
      <Plus size={15} /> Adicionar outro ensaio à mesma venda
    </button>
  </div>;
}

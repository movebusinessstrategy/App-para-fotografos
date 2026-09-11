import React, { useId } from 'react';
import { salePricing } from '../../utils/salePricing';

const currency = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export function SaleDiscountField({ gross, discount, onChange, disabled = false }: {
  gross: number; discount: number; onChange: (value: number) => void; disabled?: boolean;
}) {
  const id = useId();
  let error = '';
  let net = 0;
  try { net = salePricing(gross, discount).net; } catch (e) { error = (e as Error).message; }
  return <div className="space-y-3 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
    <div className="flex justify-between gap-3 text-sm text-gray-500"><span>Valor antes do desconto</span><span>{currency(gross)}</span></div>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <label htmlFor={id} className="text-sm font-medium text-gray-700 dark:text-gray-200">Desconto da venda (R$)</label>
      <input id={id} type="number" min="0" max={gross} step="0.01" value={discount} disabled={disabled}
        onChange={event => onChange(Number(event.target.value))} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined}
        className="w-32 rounded-lg border border-gray-300 bg-white px-3 py-2 text-right text-sm text-gray-900 outline-none focus:ring-2 focus:ring-gray-400 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-white" />
    </div>
    {error && <p id={`${id}-error`} role="alert" className="text-xs text-red-600">{error}</p>}
    <div className="flex justify-between gap-3 border-t border-gray-200 pt-3 text-sm font-semibold text-gray-900 dark:border-gray-700 dark:text-white">
      <span>Total com desconto</span><span>{currency(net)}</span>
    </div>
  </div>;
}

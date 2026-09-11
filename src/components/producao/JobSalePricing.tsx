import React, { useEffect, useState } from 'react';
import { SaleDiscountField } from '../vendas/SaleDiscountField';
import { authFetch } from '../../utils/authFetch';

export interface SalePrice { id: number; gross: number; discount: number; value: number }

export function JobSalePricing({ sale, onSaved }: { sale: SalePrice; onSaved: () => void }) {
  const [discount, setDiscount] = useState(Number(sale.discount) || 0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setDiscount(Number(sale.discount) || 0); setError(''); }, [sale.id, sale.discount]);
  const save = async () => {
    setSaving(true); setError('');
    try {
      const response = await authFetch(`/api/deals/${sale.id}/pricing`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ discount }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Não foi possível salvar o desconto.');
      onSaved();
    } catch (e) { setError((e as Error).message); } finally { setSaving(false); }
  };
  return <section className="space-y-2">
    <SaleDiscountField gross={Number(sale.gross)} discount={discount} onChange={setDiscount} disabled={saving} />
    <p className="text-xs text-gray-500">O desconto vale para a venda inteira e é dividido proporcionalmente entre os ensaios.</p>
    {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
    {discount !== Number(sale.discount || 0) && <button type="button" onClick={save} disabled={saving || discount < 0 || discount > sale.gross}
      className="rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-gray-900">
      {saving ? 'Salvando…' : 'Salvar desconto'}
    </button>}
  </section>;
}

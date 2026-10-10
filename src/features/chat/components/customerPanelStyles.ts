import type { CSSProperties } from 'react';

export const customerInputClass = 'w-full min-w-0 rounded-lg px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-gold-500 disabled:opacity-60';
export const customerInputStyle: CSSProperties = { background: 'var(--wa-bg-input)', color: 'var(--wa-text-primary)', border: '1px solid var(--wa-border)' };
export const customerSecondaryStyle: CSSProperties = { color: 'var(--wa-text-secondary)' };
export const customerButtonClass = 'rounded-lg px-3 py-2 text-sm font-semibold transition-colors hover:opacity-90 disabled:opacity-50';
export const customerButtonStyle: CSSProperties = { background: 'var(--wa-accent-green)', color: '#fff' };
export const money = (amount: number) => Number(amount || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export async function customerResponse<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || data.error || 'Não foi possível salvar. Tente novamente.');
  return data as T;
}

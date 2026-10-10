import React, { useRef, useState } from 'react';
import { Job } from '../../../types';
import { authFetch } from '../../../utils/authFetch';
import { useApi } from '../../../utils/useApi';
import { parsePaymentAmount, saoPauloToday } from '../utils/conversationCustomer';
import { customerButtonClass, customerButtonStyle, customerInputClass, customerInputStyle, customerResponse, customerSecondaryStyle, money } from './customerPanelStyles';

interface Payment { id: string; amount: number; payment_date: string; payment_method: string; description?: string; }
interface Finance { payments: Payment[]; totalPago: number; jobAmount: number; legacy_signal_amount?: number; }

export function ConversationPayment({ job, onUpdate }: { job: Job; onUpdate: () => Promise<void> }) {
  const finance = useApi<Finance>(`/api/jobs/${job.id}/financeiro`);
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(saoPauloToday);
  const [method, setMethod] = useState('Pix');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const writing = useRef(false);
  const data = finance.data;
  const value = parsePaymentAmount(amount);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (writing.current || !value || !date) return;
    writing.current = true;
    setBusy(true); setError(null); setNotice(null);
    try {
      const result = await customerResponse<{ warning?: string }>(await authFetch(`/api/jobs/${job.id}/payments`, {
        method: 'POST', body: JSON.stringify({ amount: value, payment_date: date, payment_method: method, description: description.trim() || 'Pagamento registrado pelo atendimento' }),
      }));
      // A gravação terminou: falha na atualização não permite reenviar o mesmo pagamento.
      setOpen(false); setAmount(''); setDescription('');
      setNotice(result.warning || `Pagamento de ${money(value)} registrado neste ensaio.`);
      try { await Promise.all([finance.mutate(), onUpdate()]); }
      catch { setNotice('Pagamento registrado. Atualize o painel para conferir o saldo.'); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível registrar o pagamento.'); }
    finally { writing.current = false; setBusy(false); }
  };

  if (finance.isLoading) return <p role="status" className="text-xs" style={customerSecondaryStyle}>Conferindo pagamentos…</p>;
  if (finance.error || !data) return <p role="alert" className="text-xs" style={customerSecondaryStyle}>Não foi possível conferir os pagamentos. <button type="button" onClick={() => finance.mutate()} className="underline">Tentar novamente</button></p>;

  return (
    <section aria-label="Pagamentos do ensaio" className="border-t pt-4" style={{ borderColor: 'var(--wa-border)' }}>
      <div className="mb-3 flex justify-between gap-4 text-sm"><span style={customerSecondaryStyle}>Recebido</span><strong>{money(data.totalPago)}</strong></div>
      <div className="mb-4 flex justify-between gap-4 text-xs" style={customerSecondaryStyle}><span>{data.totalPago > data.jobAmount ? 'Crédito excedente' : 'Falta receber'}</span><span>{money(Math.abs(data.jobAmount - data.totalPago))}</span></div>
      {data.legacy_signal_amount ? <p className="mb-3 text-xs text-amber-700 dark:text-amber-300">Há {money(data.legacy_signal_amount)} de sinal anotado nas observações, ainda sem lançamento no histórico financeiro.</p> : null}
      {data.payments.length > 0 && <details className="mb-4 text-xs" style={customerSecondaryStyle}><summary className="cursor-pointer">Histórico de pagamentos ({data.payments.length})</summary><ul className="mt-2 space-y-2">{data.payments.map(payment => <li key={payment.id} className="flex justify-between gap-3"><span>{new Date(`${payment.payment_date}T12:00:00`).toLocaleDateString('pt-BR')} · {payment.payment_method}<span className="block">{payment.description}</span></span><span className="shrink-0 font-medium">{money(payment.amount)}</span></li>)}</ul></details>}
      {notice && <p role="status" className="mb-3 text-xs" style={{ color: 'var(--wa-accent-green)' }}>{notice}</p>}
      {error && <p role="alert" className="mb-3 text-xs text-red-600 dark:text-red-300">{error}</p>}
      {!open ? <button type="button" disabled={busy} onClick={() => { setOpen(true); setNotice(null); if (data.legacy_signal_amount) { setAmount(String(data.legacy_signal_amount)); setDate(''); setDescription('Sinal anterior anotado nas observações'); } }} className={customerButtonClass} style={customerButtonStyle}>{data.legacy_signal_amount ? 'Registrar sinal anterior' : 'Registrar pagamento'}</button> : (
        <form onSubmit={save} className="space-y-3">
          <p className="text-xs" style={customerSecondaryStyle}>{data.legacy_signal_amount ? 'Registre primeiro o sinal anterior com a data em que foi recebido. Depois, adicione o novo pagamento.' : <>Este valor será somado aos pagamentos de <strong>{job.job_name || job.job_type}</strong>.</>}</p>
          <label className="block text-xs">Valor recebido (R$)<input autoFocus required readOnly={!!data.legacy_signal_amount} inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} placeholder="0,00" className={`${customerInputClass} mt-1`} style={customerInputStyle} /></label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs">Data<input required type="date" value={date} onChange={event => setDate(event.target.value)} className={`${customerInputClass} mt-1`} style={customerInputStyle} /></label>
            <label className="block text-xs">Forma<select value={method} onChange={event => setMethod(event.target.value)} className={`${customerInputClass} mt-1`} style={customerInputStyle}>{['Pix', 'Dinheiro', 'Cartão de crédito', 'Cartão de débito', 'Transferência'].map(item => <option key={item}>{item}</option>)}</select></label>
          </div>
          <label className="block text-xs">Descrição<input value={description} onChange={event => setDescription(event.target.value)} placeholder="Sinal, complemento, fotos extras…" className={`${customerInputClass} mt-1`} style={customerInputStyle} /></label>
          <div className="flex gap-2"><button disabled={busy || !value} className={customerButtonClass} style={customerButtonStyle}>{busy ? 'Registrando…' : `Registrar ${money(value)}`}</button><button type="button" disabled={busy} onClick={() => setOpen(false)} className={customerButtonClass} style={customerSecondaryStyle}>Cancelar</button></div>
        </form>
      )}
    </section>
  );
}

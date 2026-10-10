import type { SupabaseClient } from '@supabase/supabase-js';

export interface PaymentRow {
  id: string;
  job_id: number;
  amount: number;
  description?: string | null;
  payment_date: string;
  payment_method: string;
  created_at?: string;
}
export interface PaymentAllocation { id: string; job_id: number; job_payment_id: string; amount: number; }

export function mergeJobPaymentHistory(jobId: number, payments: PaymentRow[], allocations: PaymentAllocation[]) {
  const sourceById = new Map(payments.map(payment => [String(payment.id), payment]));
  const allocatedIds = new Set(allocations.map(allocation => String(allocation.job_payment_id)));
  const direct = payments.filter(payment => Number(payment.job_id) === jobId && !allocatedIds.has(String(payment.id)));
  const assigned = allocations.filter(allocation => Number(allocation.job_id) === jobId).map(allocation => {
    const source = sourceById.get(String(allocation.job_payment_id));
    if (!source) throw new Error('Não foi possível conferir a origem de um pagamento atribuído.');
    return {
      ...source, id: `allocation:${allocation.id}`, job_id: jobId,
      amount: Number(allocation.amount), allocated: true, source_payment_id: source.id,
      description: source.description ? `${source.description} · atribuído a este ensaio` : 'Valor atribuído a este ensaio',
    };
  });
  return [...direct, ...assigned].sort((a, b) => `${a.payment_date}${a.created_at || ''}`.localeCompare(`${b.payment_date}${b.created_at || ''}`));
}

function rows<T>(result: { data: T[] | null; error: any }, optionalTable = false): T[] {
  if (!result.error) return result.data || [];
  if (optionalTable && ['42P01', 'PGRST205'].includes(result.error.code)) return [];
  throw new Error('Não foi possível conferir o histórico de pagamentos.');
}

/** Job ownership must be checked by the caller before reading its payments. */
export async function readJobPaymentHistory(db: SupabaseClient, userId: string, jobId: number) {
  const [directResult, assignedResult] = await Promise.all([
    db.from('job_payments').select('*').eq('job_id', jobId),
    db.from('sale_payment_allocations').select('id,job_id,job_payment_id,amount').eq('user_id', userId).eq('job_id', jobId),
  ]);
  const direct = rows<PaymentRow>(directResult);
  const assigned = rows<PaymentAllocation>(assignedResult, true);
  const directIds = direct.map(payment => payment.id);
  const sourceIds = assigned.map(allocation => allocation.job_payment_id);
  const [otherResult, sourceResult] = await Promise.all([
    directIds.length ? db.from('sale_payment_allocations').select('id,job_id,job_payment_id,amount').eq('user_id', userId).in('job_payment_id', directIds) : { data: [], error: null },
    sourceIds.length ? db.from('job_payments').select('*').in('id', sourceIds) : { data: [], error: null },
  ]);
  const allocations = [...new Map([...assigned, ...rows<PaymentAllocation>(otherResult, true)].map(allocation => [String(allocation.id), allocation])).values()];
  const payments = [...new Map([...direct, ...rows<PaymentRow>(sourceResult)].map(payment => [String(payment.id), payment])).values()];
  return mergeJobPaymentHistory(jobId, payments, allocations);
}

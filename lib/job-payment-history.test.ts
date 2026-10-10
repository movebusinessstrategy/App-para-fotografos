import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeJobPaymentHistory, type PaymentRow } from './job-payment-history';
const payment = (id: string, job_id: number, amount: number): PaymentRow => ({ id, job_id, amount, payment_date: '2026-10-10', payment_method: 'Pix' });

test('sinal e pagamento complementar são registros distintos que somam R$447', () => {
  const rows = mergeJobPaymentHistory(1, [payment('signal', 1, 100), payment('complement', 1, 347)], []);
  assert.equal(rows.reduce((sum, row) => sum + row.amount, 0), 447);
  assert.equal(rows.length, 2);
});
test('pagamento adicional continua no histórico depois de separar uma venda', () => {
  const payments = [payment('signal', 1, 100), payment('complement', 2, 347)];
  const allocations = [{ id: 'a', job_id: 2, job_payment_id: 'signal', amount: 100 }];
  assert.equal(mergeJobPaymentHistory(2, payments, allocations).reduce((sum, row) => sum + row.amount, 0), 447);
  assert.equal(mergeJobPaymentHistory(1, payments, allocations).length, 0);
});
test('uma transação atribuída a vários ensaios não é contada duas vezes', () => {
  const payments = [payment('signal', 1, 100)];
  const allocations = [{ id: 'a', job_id: 1, job_payment_id: 'signal', amount: 40 }, { id: 'b', job_id: 2, job_payment_id: 'signal', amount: 60 }];
  assert.equal(mergeJobPaymentHistory(1, payments, allocations)[0].amount, 40);
  assert.equal(mergeJobPaymentHistory(2, payments, allocations)[0].amount, 60);
});

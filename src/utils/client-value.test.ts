import assert from 'node:assert/strict';
import test from 'node:test';

import {
  calculateClientTier,
  clientValueAmountCents,
  isClientValueEligibleStatus,
  summarizeClientValue,
} from './client-value';

test('normaliza status e aceita somente scheduled e completed', () => {
  assert.equal(isClientValueEligibleStatus(' Scheduled '), true);
  assert.equal(isClientValueEligibleStatus('COMPLETED'), true);
  assert.equal(isClientValueEligibleStatus('cancelled'), false);
  assert.equal(isClientValueEligibleStatus('pre_reserved'), false);
  assert.equal(isClientValueEligibleStatus('active'), false);
  assert.equal(isClientValueEligibleStatus(null), false);
});

test('venda cancelada e reembolsada fica fora do investimento e do nível', () => {
  const refundedJob = {
    id: 1,
    deal_id: 91,
    status: 'cancelled',
    amount: 2_753,
    refund_status: 'refunded',
  };
  const summary = summarizeClientValue([refundedJob]);

  assert.deepEqual(summary, {
    totalInvestedCents: 0,
    totalInvested: 0,
    purchaseCount: 0,
    tier: 'Bronze',
  });
});

test('pré-reserva e status desconhecido não entram no cálculo', () => {
  const summary = summarizeClientValue([
    { id: 1, status: 'pre_reserved', amount: 15_000 },
    { id: 2, status: 'pending', amount: 15_000 },
  ]);

  assert.equal(summary.totalInvestedCents, 0);
  assert.equal(summary.purchaseCount, 0);
  assert.equal(summary.tier, 'Bronze');
});

test('separar uma venda em dois cards preserva valor, compra e nível', () => {
  const original = summarizeClientValue([
    { id: 10, deal_id: 500, status: 'scheduled', amount: 4_243 },
  ]);
  const separated = summarizeClientValue([
    { id: 10, deal_id: 500, status: 'scheduled', amount: 1_490 },
    { id: 11, deal_id: 500, status: 'scheduled', amount: 2_753 },
  ]);

  assert.deepEqual(separated, original);
  assert.equal(separated.purchaseCount, 1);
});

test('adicionais distribuídos nos cards somam uma vez na mesma compra', () => {
  const summary = summarizeClientValue([
    { id: 10, deal_id: '500', status: 'scheduled', amount: 1_490.05 },
    { id: 11, deal_id: 500, status: 'completed', amount: 2_753.1 },
    { id: 12, deal_id: 500, status: 'scheduled', amount: 30.25 },
  ]);

  assert.equal(summary.totalInvestedCents, 427_340);
  assert.equal(summary.totalInvested, 4_273.4);
  assert.equal(summary.purchaseCount, 1);
  assert.equal(summary.tier, 'Gold');
});

test('dez sessões técnicas gratuitas não criam compras nem nível Diamond', () => {
  const jobs = Array.from({ length: 10 }, (_, index) => ({
    id: index + 1,
    status: 'scheduled',
    amount: 0,
  }));
  const summary = summarizeClientValue(jobs);

  assert.equal(summary.totalInvestedCents, 0);
  assert.equal(summary.purchaseCount, 0);
  assert.equal(summary.tier, 'Bronze');
});

test('limites de nível por investimento usam centavos exatos', () => {
  const cases: Array<[number, string]> = [
    [49_999, 'Bronze'],
    [50_000, 'Silver'],
    [149_999, 'Silver'],
    [150_000, 'Gold'],
    [499_999, 'Gold'],
    [500_000, 'Platinum'],
    [1_499_999, 'Platinum'],
    [1_500_000, 'Diamond'],
  ];

  for (const [cents, tier] of cases) {
    assert.equal(calculateClientTier(1, cents), tier, `${cents} centavos`);
  }
});

test('limites de nível por quantidade contam somente compras financeiras', () => {
  const makePurchases = (count: number) => Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    deal_id: index + 1,
    status: 'completed',
    amount: 0.01,
  }));

  assert.equal(summarizeClientValue(makePurchases(1)).tier, 'Bronze');
  assert.equal(summarizeClientValue(makePurchases(2)).tier, 'Silver');
  assert.equal(summarizeClientValue(makePurchases(4)).tier, 'Gold');
  assert.equal(summarizeClientValue(makePurchases(7)).tier, 'Platinum');
  assert.equal(summarizeClientValue(makePurchases(10)).tier, 'Diamond');
});

test('arredonda valores em centavos e ignora valores inválidos ou não positivos', () => {
  assert.equal(clientValueAmountCents(0.1), 10);
  assert.equal(clientValueAmountCents(0.2), 20);
  assert.equal(clientValueAmountCents('10.005'), 1_001);
  assert.equal(clientValueAmountCents(-20), 0);
  assert.equal(clientValueAmountCents('inválido'), 0);

  const summary = summarizeClientValue([
    { id: 1, status: 'scheduled', amount: 0.1 },
    { id: 2, status: 'completed', amount: 0.2 },
  ]);
  assert.equal(summary.totalInvestedCents, 30);
  assert.equal(summary.totalInvested, 0.3);
  assert.equal(summary.purchaseCount, 2);
});

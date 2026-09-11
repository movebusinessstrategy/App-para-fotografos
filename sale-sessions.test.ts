import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeSaleSessions } from './sale-sessions.js';
import { allocateMoney, jobSaleBase, salePricing } from './src/utils/salePricing.js';

const maternity = { job_type: 'Gestante', job_date: '2026-10-15', job_time: '09:00', gross_amount: 1000 };
const newborn = { job_type: 'Newborn', schedule_later: true, gross_amount: 1500 };

test('one sale allocates two jobs, discount and signal exactly once', () => {
  const jobs = normalizeSaleSessions([maternity, newborn], 2500, 300, 500);
  assert.deepEqual(jobs.map(j => j.amount), [880, 1320]);
  assert.deepEqual(jobs.map(j => j.signal_amount), [200, 300]);
  assert.equal(jobs[1].job_date, null);
  assert.equal(jobs[1].job_time, null);
  assert.deepEqual(jobs.map(j => j.discount_amount), [120, 180]);
});
test('keeps cents exactly, including free sessions and full discounts', () => {
  assert.deepEqual(allocateMoney(0.01, [1, 1, 1]), [0.01, 0, 0]);
  assert.deepEqual(allocateMoney(100, [100, 0]), [100, 0]);
  const jobs = normalizeSaleSessions([maternity, newborn], 2500, 2500, 0);
  assert.deepEqual(jobs.map(j => j.amount), [0, 0]);
  assert.equal(jobSaleBase({ sale_gross_amount: 1000, sale_discount_amount: 120 }), 880);
});
test('rejects inconsistent allocation, excess signal and invalid amounts', () => {
  assert.throws(() => normalizeSaleSessions([maternity, newborn], 2400, 0, 0), /soma/);
  assert.throws(() => normalizeSaleSessions([maternity, newborn], 2500, 300, 2201), /sinal/);
  for (const discount of [2501, -1, Infinity, NaN]) assert.throws(() => salePricing(2500, discount));
});
test('only an explicit schedule-later choice permits an undated job', () => {
  assert.throws(() => normalizeSaleSessions([{ ...newborn, schedule_later: false }], 1500, 0, 0), /Data/);
  assert.throws(() => normalizeSaleSessions([{ ...maternity, job_date: '2026-02-30' }], 1000, 0, 0), /Data/);
  assert.throws(() => normalizeSaleSessions([{ ...maternity, job_end_time: '08:59' }], 1000, 0, 0), /término/);
  assert.throws(() => normalizeSaleSessions([{ ...newborn, job_type: '' }], 1500, 0, 0), /tipo/);
});
test('money allocation conserves each cent across varied package sizes', () => {
  for (let count = 1; count <= 20; count++) {
    const weights = Array.from({ length: count }, (_, index) => (index * 37 + 1) / 100);
    const total = weights.reduce((sum, w) => sum + Math.round(w * 100), 0);
    for (const cents of [0, 1, Math.floor(total / 3), total]) {
      const allocated = allocateMoney(cents / 100, weights);
      assert.equal(allocated.reduce((sum, value) => sum + Math.round(value * 100), 0), cents);
      allocated.forEach((value, index) => assert.ok(value <= weights[index]));
    }
  }
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { parseBRLMoney, todayInSaoPaulo } from './finUtils.js';

test('parseBRLMoney entende moeda brasileira com milhar e centavos', () => {
  assert.equal(parseBRLMoney('R$ 1.234,56'), 1234.56);
  assert.equal(parseBRLMoney('12.345.678,90'), 12345678.9);
  assert.equal(parseBRLMoney('1.234'), 1234);
  assert.equal(parseBRLMoney('1234,56'), 1234.56);
});

test('parseBRLMoney preserva o formato canônico usado pelo formulário', () => {
  assert.equal(parseBRLMoney('1234.56'), 1234.56);
  assert.equal(parseBRLMoney(42.75), 42.75);
  assert.equal(parseBRLMoney('-1.234,50'), -1234.5);
});

test('parseBRLMoney rejeita entrada vazia ou sem números', () => {
  assert.equal(parseBRLMoney(''), null);
  assert.equal(parseBRLMoney('R$ --'), null);
  assert.equal(parseBRLMoney(Number.NaN), null);
});

test('todayInSaoPaulo usa a data civil de São Paulo no limite UTC', () => {
  assert.equal(todayInSaoPaulo(new Date('2026-08-21T01:30:00.000Z')), '2026-08-20');
  assert.equal(todayInSaoPaulo(new Date('2026-08-21T04:30:00.000Z')), '2026-08-21');
});

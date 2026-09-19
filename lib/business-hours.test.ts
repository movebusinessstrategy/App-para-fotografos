import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_BUSINESS_HOURS, type BusinessHours } from '../src/features/followups/types.js';
import {
  isWithinBusinessHours,
  localDateKey,
  localDayStartUtc,
  nextSendSlot,
  nextWindowOpening,
  normalizeBusinessHours,
  pickGapSeconds,
  stableJitterSeconds,
} from './business-hours.js';

// Seg 21/09/2026 a sáb 26/09/2026; seg seguinte 28/09. Brasília = UTC-3.
const H: BusinessHours = { ...DEFAULT_BUSINESS_HOURS, holidays: [] };
const at = (iso: string) => new Date(iso);
const slot = (now: string, jitterSeconds = 0, earliest = now, hours = H) =>
  nextSendSlot({ earliest: at(earliest), now: at(now), hours, jitterSeconds }).toISOString();

test('dentro da janela devolve o próprio instante', () => {
  assert.equal(slot('2026-09-21T13:00:00.000Z', 600), '2026-09-21T13:00:00.000Z');
});

test('segunda 20:30 vai para terça 09:00 mais o jitter', () => {
  assert.equal(slot('2026-09-21T23:30:00.000Z', 125), '2026-09-22T12:02:05.000Z');
});

test('sábado 19:00 vai para segunda 09:00', () => {
  assert.equal(slot('2026-09-26T22:00:00.000Z'), '2026-09-28T12:00:00.000Z');
});

test('madrugada de terça vai para terça 09:00', () => {
  assert.equal(slot('2026-09-22T06:00:00.000Z'), '2026-09-22T12:00:00.000Z');
});

test('feriado numa segunda pula para terça', () => {
  const hours = { ...H, holidays: ['2026-09-28'] };
  assert.equal(slot('2026-09-26T22:00:00.000Z', 0, '2026-09-26T22:00:00.000Z', hours), '2026-09-29T12:00:00.000Z');
  assert.equal(isWithinBusinessHours(at('2026-09-28T13:00:00.000Z'), hours), false);
});

test('earliest no futuro vence o agora', () => {
  assert.equal(slot('2026-09-21T13:00:00.000Z', 0, '2026-09-21T18:00:00.000Z'), '2026-09-21T18:00:00.000Z');
  assert.equal(slot('2026-09-21T13:00:00.000Z', 0, '2026-09-22T00:00:00.000Z'), '2026-09-22T12:00:00.000Z');
  assert.equal(slot('2026-09-21T13:00:00.000Z', 0, '2026-09-20T13:00:00.000Z'), '2026-09-21T13:00:00.000Z');
});

test('jitter maior que a janela é limitado a um minuto antes do fechamento', () => {
  assert.equal(slot('2026-09-21T23:30:00.000Z', 999_999), '2026-09-22T21:59:00.000Z');
  assert.equal(slot('2026-09-21T23:30:00.000Z', -50), '2026-09-22T12:00:00.000Z');
});

test('dias vazios invalidam a config e nextWindowOpening lança erro', () => {
  assert.equal(normalizeBusinessHours({ ...H, days: [] }), null);
  assert.throws(() => nextWindowOpening(at('2026-09-21T13:00:00.000Z'), { ...H, days: [] }), Error);
});

test('bordas: 09:00 entra e 19:00 fica de fora', () => {
  assert.equal(isWithinBusinessHours(at('2026-09-21T12:00:00.000Z'), H), true);
  assert.equal(isWithinBusinessHours(at('2026-09-21T11:59:59.000Z'), H), false);
  assert.equal(isWithinBusinessHours(at('2026-09-21T21:59:59.000Z'), H), true);
  assert.equal(isWithinBusinessHours(at('2026-09-21T22:00:00.000Z'), H), false);
  assert.equal(isWithinBusinessHours(at('2026-09-27T13:00:00.000Z'), H), false);
});

test('nextWindowOpening devolve a abertura em ou depois do instante', () => {
  assert.equal(nextWindowOpening(at('2026-09-21T12:00:00.000Z'), H).toISOString(), '2026-09-21T12:00:00.000Z');
  assert.equal(nextWindowOpening(at('2026-09-21T13:00:00.000Z'), H).toISOString(), '2026-09-22T12:00:00.000Z');
});

test('meia-noite local e chave do dia no fuso', () => {
  assert.equal(localDayStartUtc(at('2026-09-19T02:00:00.000Z'), 'America/Sao_Paulo').toISOString(), '2026-09-18T03:00:00.000Z');
  assert.equal(localDateKey(at('2026-09-19T02:00:00.000Z'), 'America/Sao_Paulo'), '2026-09-18');
  assert.equal(localDateKey(at('2026-09-19T03:00:00.000Z'), 'America/Sao_Paulo'), '2026-09-19');
});

test('fuso com horário de verão acerta a virada', () => {
  assert.equal(localDayStartUtc(at('2026-03-08T15:00:00.000Z'), 'America/New_York').toISOString(), '2026-03-08T05:00:00.000Z');
  assert.equal(localDayStartUtc(at('2026-11-01T15:00:00.000Z'), 'America/New_York').toISOString(), '2026-11-01T04:00:00.000Z');
  const ny: BusinessHours = { tz: 'America/New_York', days: [0, 1, 2, 3, 4, 5, 6], start: '09:00', end: '17:00', holidays: [] };
  assert.equal(nextWindowOpening(at('2026-03-08T05:00:00.000Z'), ny).toISOString(), '2026-03-08T13:00:00.000Z');
});

test('normalizeBusinessHours aceita config válida e recusa inválidas', () => {
  assert.deepEqual(normalizeBusinessHours({ tz: 'America/Sao_Paulo', days: [6, 1, 1], start: '09:00', end: '19:00' }), {
    tz: 'America/Sao_Paulo', days: [1, 6], start: '09:00', end: '19:00', holidays: [],
  });
  assert.deepEqual(normalizeBusinessHours({ ...H, holidays: ['2026-12-25'] })?.holidays, ['2026-12-25']);
  const invalid: unknown[] = [
    null, 'x', [], { ...H, tz: 'Mars/Olympus' }, { ...H, tz: '' }, { ...H, days: [7] }, { ...H, days: [1.5] },
    { ...H, days: 'seg' }, { ...H, start: '19:00', end: '09:00' }, { ...H, start: '09:00', end: '09:00' },
    { ...H, start: '9:00' }, { ...H, end: '24:00' }, { ...H, holidays: ['25/12/2026'] }, { ...H, holidays: 'x' },
  ];
  for (const raw of invalid) assert.equal(normalizeBusinessHours(raw), null, JSON.stringify(raw));
});

test('stableJitterSeconds é determinístico e fica no intervalo', () => {
  const a = stableJitterSeconds('deal:1:step:1', 1800);
  assert.equal(stableJitterSeconds('deal:1:step:1', 1800), a);
  assert.ok(a >= 0 && a <= 1800);
  assert.equal(stableJitterSeconds('abc', 0), 0);
  const spread = new Set(Array.from({ length: 20 }, (_, i) => stableJitterSeconds(`deal:${i}:step:1`, 1800)));
  assert.ok(spread.size > 10);
});

test('pickGapSeconds cobre de min a max', () => {
  assert.equal(pickGapSeconds(60, 150, () => 0), 60);
  assert.equal(pickGapSeconds(60, 150, () => 0.999), 150);
  assert.equal(pickGapSeconds(60, 150, () => 1), 150);
  assert.equal(pickGapSeconds(60, 60, () => 0.5), 60);
  const random = pickGapSeconds(60, 150);
  assert.ok(random >= 60 && random <= 150);
});

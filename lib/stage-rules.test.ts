import assert from 'node:assert/strict';
import test from 'node:test';
import {
  appendStageHistory,
  canMoveForward,
  firstOpenSalesStage,
  isClosedStage,
  isLostStage,
  isSalesStage,
  parseStageHistory,
  type StageRow,
} from './stage-rules.js';

const stage = (id: string, position: number, extra: Partial<StageRow> = {}): StageRow => ({
  id, name: id, position, is_final: false, is_won: false, process_id: null, ...extra,
});

const STAGES: StageRow[] = [
  stage('prod-agendado', 0),
  stage('lead', 1),
  stage('contact', 2),
  stage('proposal', 3),
  stage('02-follow-up', 4),
  stage('won', 4, { is_final: true, is_won: true }),
  stage('lost', 5, { is_final: true }),
  stage('producao-x', 0, { process_id: 'proc-1' }),
];

test('lê histórico em array, string JSON, null e lixo', () => {
  const entry = { stage_id: 'lead', stage_name: 'Lead', entered_at: '2026-09-01T10:00:00.000Z', left_at: null };
  assert.deepEqual(parseStageHistory([entry, { foo: 1 }, null, 'x', { stage_id: 3 }]), [entry]);
  assert.deepEqual(parseStageHistory(JSON.stringify([entry])), [entry]);
  assert.deepEqual(parseStageHistory(null), []);
  assert.deepEqual(parseStageHistory('não é json'), []);
  assert.deepEqual(parseStageHistory('{"stage_id":"lead"}'), []);
  assert.deepEqual(parseStageHistory(42), []);
  assert.deepEqual(parseStageHistory({ stage_id: 'lead' }), []);
});

test('appendStageHistory fecha a etapa aberta e acrescenta a nova', () => {
  const raw = JSON.stringify([
    { stage_id: 'lead', stage_name: 'Lead', entered_at: '2026-09-01T10:00:00.000Z', left_at: null },
  ]);
  const next = appendStageHistory(raw, 'contact', 'Contato', '2026-09-02T10:00:00.000Z');
  assert.ok(Array.isArray(next));
  assert.equal(next.length, 2);
  assert.equal(next[0].left_at, '2026-09-02T10:00:00.000Z');
  assert.deepEqual(next[1], {
    stage_id: 'contact', stage_name: 'Contato', entered_at: '2026-09-02T10:00:00.000Z', left_at: null,
  });
});

test('appendStageHistory não duplica a mesma etapa aberta e não altera a entrada', () => {
  const original = [{ stage_id: 'lead', stage_name: 'Lead', entered_at: '2026-09-01T10:00:00.000Z', left_at: null }];
  const next = appendStageHistory(original, 'lead', 'Lead', '2026-09-02T10:00:00.000Z');
  assert.deepEqual(next, original);
  assert.notEqual(next, original);
  const again = appendStageHistory(next, 'contact', 'Contato', '2026-09-03T10:00:00.000Z');
  assert.equal(original[0].left_at, null);
  assert.equal(again[0].left_at, '2026-09-03T10:00:00.000Z');
});

test('appendStageHistory sempre devolve array, inclusive a partir de lixo', () => {
  for (const raw of [null, undefined, '', 'lixo', 7, {}]) {
    const next = appendStageHistory(raw, 'lead', 'Lead', '2026-09-01T10:00:00.000Z');
    assert.ok(Array.isArray(next));
    assert.equal(next.length, 1);
    assert.equal(next[0].left_at, null);
  }
});

test('canMoveForward só anda para frente entre etapas de venda abertas', () => {
  assert.equal(canMoveForward('02-follow-up', 'won', STAGES), false);
  assert.equal(canMoveForward('lead', 'contact', STAGES), true);
  assert.equal(canMoveForward('contact', 'lead', STAGES), false);
  assert.equal(canMoveForward('lead', 'lead', STAGES), false);
  assert.equal(canMoveForward('lead', 'lost', STAGES), false);
  assert.equal(canMoveForward('prod-agendado', 'lead', STAGES), false);
  assert.equal(canMoveForward('lead', 'producao-x', STAGES), false);
  assert.equal(canMoveForward('lead', 'nao-existe', STAGES), false);
});

test('etapas de produção não são de venda', () => {
  assert.equal(isSalesStage(stage('prod-agendado', 0)), false);
  assert.equal(isSalesStage(stage('x', 0, { process_id: 'p' })), false);
  assert.equal(isSalesStage(stage('lead', 1)), true);
});

test('etapas fechadas e perdidas', () => {
  assert.equal(isClosedStage(undefined), true);
  assert.equal(isClosedStage(stage('won', 9)), true);
  assert.equal(isClosedStage(stage('x', 9, { is_won: true })), true);
  assert.equal(isClosedStage(stage('lead', 1)), false);
  assert.equal(isLostStage(undefined), false);
  assert.equal(isLostStage(stage('lost', 9)), true);
  assert.equal(isLostStage(stage('perdido', 9, { is_final: true })), true);
  assert.equal(isLostStage(stage('ganho', 9, { is_final: true, is_won: true })), false);
  assert.equal(isLostStage(stage('lead', 1)), false);
});

test('firstOpenSalesStage ignora produção e etapas finais e desempata por id', () => {
  assert.equal(firstOpenSalesStage(STAGES)?.id, 'lead');
  const tied = [stage('b', 1), stage('a', 1), stage('prod-x', 0), stage('won', 0, { is_won: true })];
  assert.equal(firstOpenSalesStage(tied)?.id, 'a');
  assert.equal(firstOpenSalesStage([stage('won', 1, { is_final: true, is_won: true })]), null);
  assert.equal(firstOpenSalesStage([]), null);
});

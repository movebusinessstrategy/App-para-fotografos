import assert from 'node:assert/strict';
import test from 'node:test';

import { chipView, drainText, etaLabel, momentLabel, nextSendText, plural, waitingLabel } from './DashboardFormat';
import type { KanbanCard } from './types';

const NOW = new Date('2026-09-16T15:00:00Z'); // quarta, 12:00 em São Paulo
const TZ = 'America/Sao_Paulo';

function card(over: Partial<KanbanCard> = {}): KanbanCard {
  return {
    deal_id: 1, task_id: 10, contact_name: 'Cliente Teste', stage_name: 'Orçamento enviado', track: 'ladder', step: 1,
    status: 'approved', chip: 'queued', eta: null, sent_at: null, delivery: null, error: null, replied_at: null,
    reply_preview: null, closed_reason: null, ...over,
  };
}

test('etaLabel: hoje, amanhã, dia da semana, data e agora', () => {
  assert.equal(etaLabel('2026-09-16T13:20:00Z', new Date('2026-09-16T12:00:00Z'), TZ), 'hoje 10:20');
  assert.equal(etaLabel('2026-09-17T12:05:00Z', NOW, TZ), 'amanhã 9:05');
  assert.equal(etaLabel('2026-09-19T12:00:00Z', NOW, TZ), 'sáb 9:00');
  assert.equal(etaLabel('2026-09-28T12:00:00Z', NOW, TZ), '28/09 9:00');
  assert.equal(etaLabel('2026-09-16T15:00:30Z', NOW, TZ), 'agora');
  assert.equal(etaLabel('2026-09-16T14:00:00Z', NOW, TZ), 'agora');
  assert.equal(etaLabel(null, NOW, TZ), '');
});

test('momentLabel: só a hora hoje, ontem ou data', () => {
  assert.equal(momentLabel('2026-09-16T17:02:00Z', NOW, TZ), '14:02');
  assert.equal(momentLabel('2026-09-15T21:03:00Z', NOW, TZ), 'ontem 18:03');
  assert.equal(momentLabel('2026-09-10T12:30:00Z', NOW, TZ), '10/09 9:30');
  assert.equal(momentLabel('lixo', NOW, TZ), '');
});

test('nextSendText: "às 14:32" hoje e "amanhã às 9h" no dia seguinte', () => {
  assert.equal(nextSendText('2026-09-16T17:32:00Z', NOW, TZ), 'às 14:32');
  assert.equal(nextSendText('2026-09-17T12:00:00Z', NOW, TZ), 'amanhã às 9h');
  assert.equal(nextSendText('2026-09-21T12:00:00Z', NOW, TZ), 'seg às 9h');
  assert.equal(nextSendText('2026-09-16T15:00:10Z', NOW, TZ), 'agora');
});

test('waitingLabel: há pouco tempo ou desde a data', () => {
  assert.equal(waitingLabel('2026-09-16T12:00:00Z', NOW, TZ), 'esperando há 3 h');
  assert.equal(waitingLabel('2026-09-13T15:00:00Z', NOW, TZ), 'esperando há 3 dias');
  assert.equal(waitingLabel('2026-09-01T15:00:00Z', NOW, TZ), 'esperando desde 01/09');
  assert.equal(waitingLabel(null, NOW, TZ), '');
});

test('drainText e plural', () => {
  assert.equal(drainText(0), '');
  assert.equal(drainText(1), 'fila zera em ~1 dia útil');
  assert.equal(drainText(16), 'fila zera em ~16 dias úteis');
  assert.equal(plural(1, 'rascunho', 'rascunhos'), '1 rascunho');
  assert.equal(plural(3, 'rascunho', 'rascunhos'), '3 rascunhos');
});

test('chipView: fila com previsão, rascunho, enviado, problema com motivo, respondeu e encerrado', () => {
  assert.equal(chipView(card({ eta: '2026-09-17T12:05:00Z' }), NOW, TZ).text, 'Na fila · sai amanhã 9:05');
  assert.equal(chipView(card(), NOW, TZ).text, 'Na fila');
  assert.equal(chipView(card({ chip: 'draft', status: 'draft' }), NOW, TZ).text, 'Rascunho');
  const sent = chipView(card({ chip: 'sent', status: 'sent', sent_at: '2026-09-16T17:02:00Z', delivery: 'read' }), NOW, TZ);
  assert.deepEqual([sent.text, sent.title], ['Enviado 14:02', 'Lido']);
  const failed = chipView(card({ chip: 'sent', status: 'sent', sent_at: '2026-09-16T17:02:00Z', delivery: 'failed' }), NOW, TZ);
  assert.deepEqual([failed.text, failed.tone], ['Não entregue 14:02', 'red']);
  const problem = chipView(card({ chip: 'problem', status: 'blocked', error: 'block:baileys_offline' }), NOW, TZ);
  assert.equal(problem.text, 'Com problema');
  assert.equal(problem.tone, 'red');
  assert.match(String(problem.title), /QR/);
  const replied = chipView(card({ chip: 'replied', status: 'sent', replied_at: '2026-09-16T13:32:00Z' }), NOW, TZ);
  assert.equal(replied.text, 'Respondeu 10:32');
  const closed = chipView(card({ chip: 'closed', status: 'cancelled', closed_reason: 'cancelled', error: 'cancel:customer_replied' }), NOW, TZ);
  assert.deepEqual([closed.text, closed.title], ['Cancelado', 'O cliente respondeu']);
  assert.equal(chipView(card({ chip: 'closed', status: 'sent', closed_reason: 'no_reply' }), NOW, TZ).text, 'Sem resposta');
  assert.equal(chipView(card({ chip: 'closed', status: 'sent', closed_reason: 'optout' }), NOW, TZ).text, 'Não contatar');
});

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  approveAllConfirmText,
  businessDaysLabel,
  estimateBusinessDays,
  formatDayTime,
  formatSweepMoment,
  formatWeekdayTime,
  gapRangeLabel,
  hoursSilentLabel,
  parseListInput,
  phoneDigits,
  relativeFromNow,
} from './format';
import * as labels from './labels';
import { CADENCE_STATUSES } from './types';

const NOW = new Date('2026-09-19T15:00:00Z'); // 12:00 em São Paulo

test('estimateBusinessDays usa o que sobra hoje e o teto por dia', () => {
  assert.equal(estimateBusinessDays(0, 40, 40), 0);
  assert.equal(estimateBusinessDays(-3, 40, 40), 0);
  assert.equal(estimateBusinessDays(18, 40, 40), 1);
  assert.equal(estimateBusinessDays(40, 40, 40), 1);
  assert.equal(estimateBusinessDays(41, 40, 40), 2);
  assert.equal(estimateBusinessDays(18, 40, 0), 1);
  assert.equal(estimateBusinessDays(50, 40, 10), 2);
  assert.equal(estimateBusinessDays(51, 40, 10), 3);
  assert.equal(estimateBusinessDays(25, 10, 99), 3);
  assert.equal(estimateBusinessDays(3, 0, 0), 3);
});

test('businessDaysLabel no singular e no plural', () => {
  assert.equal(businessDaysLabel(1), 'cerca de 1 dia útil');
  assert.equal(businessDaysLabel(3), 'cerca de 3 dias úteis');
});

test('hoursSilentLabel em horas e dias', () => {
  assert.equal(hoursSilentLabel(0.4), 'calado há menos de 1 hora');
  assert.equal(hoursSilentLabel(1), 'calado há 1 hora');
  assert.equal(hoursSilentLabel(5.9), 'calado há 5 horas');
  assert.equal(hoursSilentLabel(24), 'calado há 1 dia');
  assert.equal(hoursSilentLabel(73), 'calado há 3 dias');
  assert.equal(hoursSilentLabel(Number.NaN), 'calado há menos de 1 hora');
});

test('relativeFromNow no passado, no futuro e longe', () => {
  assert.equal(relativeFromNow('2026-09-19T14:59:40Z', NOW), 'agora');
  assert.equal(relativeFromNow('2026-09-19T14:55:00Z', NOW), 'há 5 min');
  assert.equal(relativeFromNow('2026-09-19T17:00:00Z', NOW), 'em 2 h');
  assert.equal(relativeFromNow('2026-09-16T15:00:00Z', NOW), 'há 3 dias');
  assert.equal(relativeFromNow('2026-09-20T15:00:00Z', NOW), 'em 1 dia');
  assert.equal(relativeFromNow('2026-09-01T15:00:00Z', NOW), '01/09');
  assert.equal(relativeFromNow('nao-e-data', NOW), '');
  assert.equal(relativeFromNow(null, NOW), '');
});

test('datas no fuso de São Paulo', () => {
  assert.equal(formatDayTime('2026-09-18T17:32:00Z'), '18/09 14:32');
  assert.equal(formatWeekdayTime('2026-09-21T12:00:00Z'), 'seg, 09:00');
  assert.equal(formatSweepMoment('2026-09-19T13:42:00Z', NOW), 'hoje 10:42');
  assert.equal(formatSweepMoment('2026-09-18T21:03:00Z', NOW), 'ontem 18:03');
  assert.equal(formatSweepMoment('2026-09-10T21:03:00Z', NOW), '10/09 18:03');
  assert.equal(formatDayTime(''), '');
});

test('gapRangeLabel em minutos ou segundos', () => {
  assert.equal(gapRangeLabel(60, 150), '1 a 2,5 minutos');
  assert.equal(gapRangeLabel(30, 45), '30 a 45 segundos');
  assert.equal(gapRangeLabel(90, 900), '1,5 a 15 minutos');
});

test('texto de confirmação do Aprovar todos', () => {
  const text = approveAllConfirmText({ count: 18, step: 2, effectiveCap: 40, remainingToday: 40, gap: { min: 60, max: 150 } });
  assert.equal(text, 'Aprovar 18 follow-ups do passo 2? Eles saem em horário comercial, no máximo 40 por dia, com 1 a 2,5 minutos entre cada um (cerca de 1 dia útil). Se o cliente responder antes, o envio é cancelado.');
  const warm = approveAllConfirmText({ count: 25, step: null, effectiveCap: 10, remainingToday: 5, gap: null });
  assert.equal(warm, 'Aprovar 25 follow-ups? Eles saem em horário comercial, no máximo 10 por dia (cerca de 3 dias úteis). Se o cliente responder antes, o envio é cancelado.');
});

test('parseListInput e phoneDigits', () => {
  assert.deepEqual(parseListInput(' orcamento, pacote\npacote;; tabela '), ['orcamento', 'pacote', 'tabela']);
  assert.deepEqual(parseListInput(''), []);
  assert.equal(phoneDigits('+55 (43) 9999-0000'), '554399990000');
});

test('status desconhecido nunca vira Cancelado e todos os status têm rótulo', () => {
  for (const s of [...CADENCE_STATUSES, 'pending', 'skipped_no_template']) {
    assert.ok(labels.STATUS_LABELS[s], `faltou rótulo para ${s}`);
  }
  const unknown = labels.statusLabel('whatever');
  assert.equal(unknown.label, 'Status: whatever');
  assert.notEqual(unknown.label, 'Cancelado');
  assert.equal(labels.statusLabel(null).label, 'Status: desconhecido');
});

test('rótulos pedidos pelo pacote', () => {
  assert.equal(labels.WARNING_LABELS.reacao_cliente, 'A cliente reagiu com emoji');
  assert.equal(labels.CANCEL_REASON_TEXT.already_customer, 'Já é cliente do estúdio');
  assert.equal(labels.CANCEL_REASON_TEXT.needs_human, 'Conversa aguardando uma pessoa');
  assert.deepEqual(labels.QUEUE_TAB_LABELS, {
    draft: 'Para aprovar', approved: 'Na fila de envio', blocked: 'Com problema',
    sent_today: 'Enviados hoje', skipped: 'Pulados', cancelled: 'Cancelados',
  });
  assert.ok(labels.BLOCK_CODE_TEXT.quality_not_green);
  assert.ok(labels.BLOCK_CODE_TEXT.template_not_eligible);
  assert.equal(labels.CHANNEL_LABELS.blocked, 'Sem canal agora');
});

test('lastErrorText traduz cancel:, block: e código solto', () => {
  assert.equal(labels.lastErrorText('cancel:already_customer'), 'Já é cliente do estúdio');
  assert.equal(labels.lastErrorText('cancel:needs_human'), 'Conversa aguardando uma pessoa');
  assert.equal(labels.lastErrorText('block:quality_not_green'), labels.BLOCK_CODE_TEXT.quality_not_green);
  assert.equal(labels.lastErrorText('baileys_offline'), labels.BLOCK_CODE_TEXT.baileys_offline);
  assert.equal(labels.lastErrorText('cancel:motivo_novo'), 'cancel:motivo_novo');
  assert.equal(labels.lastErrorText('Token recusado pela Meta'), 'Token recusado pela Meta');
  assert.equal(labels.lastErrorText(null), '');
});

// Monta a classe por código para este arquivo não conter o próprio caractere.
const DASHES = new RegExp(`[${String.fromCharCode(0x2014)}${String.fromCharCode(0x2013)}]`);

test('nenhum texto da pasta de follow-ups usa travessão', () => {
  const dir = dirname(fileURLToPath(import.meta.url));
  const files = readdirSync(dir).filter((f) => /\.(ts|tsx)$/.test(f));
  assert.ok(files.length > 3);
  for (const f of files) {
    const src = readFileSync(join(dir, f), 'utf8');
    assert.ok(!DASHES.test(src), `travessão em ${f}`);
  }
});

test('trilha antes do orçamento: rótulo de toque N de M e texto do aprovar todos', async () => {
  const { stepLabel, TRACK_LABELS } = await import('./labels');
  assert.equal(stepLabel({ step: 1, track: 'pre_quote', track_steps: 2 }), 'Antes do orçamento · toque 1 de 2');
  assert.equal(stepLabel({ step: 2, track: 'pre_quote', track_steps: 1 }), 'Antes do orçamento · toque 2 de 2', 'nunca menor que o passo');
  assert.equal(stepLabel({ step: 3, track: 'ladder', track_steps: 4 }), 'Passo 3 · Agenda');
  assert.equal(stepLabel({ step: 2 }), 'Passo 2 · Valor');
  assert.equal(TRACK_LABELS.pre_quote, 'Antes do orçamento');
  const text = approveAllConfirmText({ count: 3, step: null, track: 'pre_quote', effectiveCap: 10, remainingToday: 10, gap: null });
  assert.match(text, /^Aprovar 3 follow-ups antes do orçamento\?/);
  const byStep = approveAllConfirmText({ count: 1, step: 2, track: 'ladder', effectiveCap: 10, remainingToday: 10, gap: null });
  assert.match(byStep, /^Aprovar 1 follow-up do passo 2\?/);
});

test('aiReasonText traduz os códigos da IA e nunca mostra o código cru', () => {
  const codes = ['ai_skip', 'empty', 'no_history', 'fechamento', 'disponibilidade', 'pagamento', 'duvida', 'reclamacao', 'pessoa'];
  for (const code of codes) {
    const text = labels.aiReasonText(code);
    assert.notEqual(text, code);
    assert.equal(text, labels.AI_REASON_TEXT[code]);
    assert.doesNotMatch(text, /[\u2013\u2014]/);
  }
  assert.equal(labels.aiReasonText('codigo_novo'), 'motivo não informado');
  assert.equal(labels.aiReasonText(null), 'motivo não informado');
});

test('hooks: estado do negócio, visão geral e fila revalidam ao montar (o SWRConfig global não revalida cache)', () => {
  const source = readFileSync(new URL('./hooks.ts', import.meta.url), 'utf8');
  for (const hook of ['useFollowUpOverview', 'useDealFollowUp', 'useFollowUpQueue']) {
    const start = source.indexOf(`export function ${hook}(`);
    assert.ok(start >= 0, hook);
    const next = source.indexOf('export function', start + 10);
    assert.match(source.slice(start, next < 0 ? undefined : next), /revalidateOnMount: true/, hook);
  }
});

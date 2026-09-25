import assert from 'node:assert/strict';
import test from 'node:test';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import {
  buildDashboard, clipText, COLUMN_LIMIT, createDashboardLoader, customerTurnsByKey, estimateEtas, groupFlows, lastAtByKey,
  latestTurnByKey, missingTurnWindows, placeFlow, replyWindows, tailText, turnWindows, waitingDeals,
} from './followup-dashboard.js';
import type { BoardTask, DashDeal, DashMessage, DashboardSources, EtaInput, PlaceContext } from './followup-dashboard.js';
import { registerFollowUpRoutes } from './followup-routes.js';
import { parseCadenceConfig } from './followup-cadence.js';
import { canonicalPhoneKey as canonical } from './lib/br-phone.js';
import type { StageRow } from './lib/stage-rules.js';
import { DEFAULT_BUSINESS_HOURS } from './src/features/followups/types.js';
import type { FollowUpDashboard, FollowUpServices, KanbanColumn } from './src/features/followups/types.js';

// Dados fictícios. NOW = quarta, 12h em São Paulo (horário comercial seg a sáb, 9h às 19h).
const NOW = new Date('2026-09-16T15:00:00.000Z');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const OWNER = '00000000-0000-4000-8000-000000000001';
const OTHER = '00000000-0000-4000-8000-000000000009';
const PHONE_A = '5543999990001';
const PHONE_A_12 = '554399990001';   // mesma pessoa gravada sem o 9 (12 dígitos)
const PHONE_B = '5543999990002';
const PHONE_C = '5543999990003';
const PHONE_D = '5543999990004';
const PHONE_E = '5543999990005';
const PHONE_F = '5543999990006';

const iso = (ms: number) => new Date(ms).toISOString();
const ago = (ms: number) => iso(NOW.getTime() - ms);
const later = (ms: number) => iso(NOW.getTime() + ms);

let seq = 1000;

function task(over: Partial<BoardTask> = {}): BoardTask {
  const id = over.id ?? ++seq;
  return {
    id, deal_id: 11, phone: PHONE_A, status: 'draft', step: 1, track: 'ladder', created_at: ago(DAY),
    scheduled_at: ago(2 * HOUR), sent_at: null, sent_message_id: null, last_error: null, contact_name: 'Ana Teste', ...over,
  };
}

function msg(phone: string, at: string, over: Partial<DashMessage> = {}): DashMessage {
  return { phone, from_me: false, timestamp: at, type: 'text', status: 'received', body: 'Oi, tudo bem?', transcription: null, ...over };
}

function stagesFixture(): StageRow[] {
  const base = { is_final: false, is_won: false, process_id: null };
  return [
    { ...base, id: 'lead', name: 'Entrou em contato', position: 0 },
    { ...base, id: 'contact', name: 'Conversa iniciada', position: 1 },
    { ...base, id: 'proposal', name: 'Orçamento enviado', position: 2 },
    { ...base, id: 'negotiation', name: 'Negociação', position: 3 },
    { ...base, id: 'won', name: 'Ganho', position: 9, is_final: true, is_won: true },
    { ...base, id: 'lost', name: 'Perdido', position: 10, is_final: true },
    { ...base, id: 'prod-edicao', name: 'Edição', position: 20 },
  ];
}

function deal(id: number, phone: string, over: Partial<DashDeal> = {}): DashDeal {
  return { id, stage: 'proposal', title: `Ensaio ${id}`, contact_name: `Cliente ${id}`, contact_phone: phone, converted: false, converted_job_id: null, ...over };
}

function config(over: Record<string, unknown> = {}) {
  return parseCadenceConfig({
    enabled: true, mode: 'approval', ladder_stage_ids: ['proposal', 'negotiation'], step_delays_hours: [24, 48],
    pre_quote_stage_ids: ['contact'], pre_quote_delays_hours: [24, 72], business_hours: DEFAULT_BUSINESS_HOURS,
    daily_cap: 10, min_gap_seconds: 60, max_gap_seconds: 150, allow_baileys: false, first_enabled_at: '2026-08-01T12:00:00.000Z',
    next_send_after: null, paused_at: null, ...over,
  });
}

function sources(over: Partial<DashboardSources> = {}): DashboardSources {
  const { config: cfg, state } = config();
  return {
    now: NOW, config: cfg, state, stages: stagesFixture(), tasks: [], deals: [], optOutKeys: new Set(), turns: [], replies: [], ...over,
  };
}

function column(d: FollowUpDashboard, key: string): KanbanColumn {
  const found = d.board.columns.find((c) => c.key === key);
  assert.ok(found, `coluna ${key}`);
  return found;
}

function placeOne(tasks: BoardTask[], ctx: Partial<PlaceContext> = {}) {
  const [flow] = groupFlows(tasks);
  return placeFlow(flow, { now: NOW, optOutKeys: new Set(), replies: new Map(), ...ctx });
}

const repliesOf = (rows: DashMessage[]) => customerTurnsByKey(rows);

// Textos

test('clipText corta o começo em 140 (ou 80) e tailText mostra os últimos 100', () => {
  assert.equal(clipText('  Oi,\n  tudo   bem? ', 140), 'Oi, tudo bem?');
  const long = 'a'.repeat(150);
  assert.equal(clipText(long, 140).length, 140);
  assert.ok(clipText(long, 140).endsWith('…'));
  assert.equal(clipText('b'.repeat(80), 80), 'b'.repeat(80));
  const tail = tailText(`${'x'.repeat(120)}fim da fala`, 100);
  assert.equal(tail.length, 100);
  assert.ok(tail.startsWith('…'));
  assert.ok(tail.endsWith('fim da fala'));
  assert.equal(tailText(null, 100), '');
});

// Resposta depois do envio

test('resposta: fala do cliente antes do envio não conta, reação não conta, variante de 12 dígitos conta', () => {
  const sentAt = ago(2 * DAY);
  const sent = task({ status: 'sent', sent_at: sentAt, created_at: ago(3 * DAY) });
  const before = msg(PHONE_A, iso(Date.parse(sentAt) - HOUR));
  assert.equal(placeOne([sent], { replies: repliesOf([before]) }).column, 'follow_1');

  const reaction = msg(PHONE_A, iso(Date.parse(sentAt) + HOUR), { type: 'reaction', body: '👍' });
  assert.equal(placeOne([sent], { replies: repliesOf([before, reaction]) }).column, 'follow_1');

  const tooSoon = msg(PHONE_A, iso(Date.parse(sentAt) + 3000));   // dentro da tolerância de 5s do relógio
  assert.equal(placeOne([sent], { replies: repliesOf([tooSoon]) }).column, 'follow_1');

  const reply = msg(PHONE_A_12, iso(Date.parse(sentAt) + 2 * HOUR), { body: 'Oi! Quero sim, pode mandar as datas.' });
  const placed = placeOne([sent], { replies: repliesOf([before, reaction, reply]) });
  assert.equal(placed.column, 'replied');
  assert.equal(placed.reply?.timestamp, reply.timestamp);
});

test('resposta no quadro: horário, 80 primeiros caracteres e contagem de 7 dias', () => {
  const sentAt = ago(2 * DAY);
  const long = `Oi! Quero saber das datas de outubro. ${'z'.repeat(100)}`;
  const d = buildDashboard(sources({
    tasks: [
      task({ id: 1, deal_id: 11, status: 'sent', sent_at: sentAt }),
      task({ id: 2, deal_id: 12, phone: PHONE_B, status: 'sent', sent_at: ago(3 * DAY) }),
      task({ id: 3, deal_id: 13, phone: PHONE_C, status: 'sent', sent_at: ago(9 * DAY) }),
    ],
    deals: [deal(11, PHONE_A), deal(12, PHONE_B), deal(13, PHONE_C)],
    replies: [msg(PHONE_A_12, iso(Date.parse(sentAt) + HOUR), { body: long }), msg(PHONE_B, ago(4 * DAY))],
  }));
  const replied = column(d, 'replied');
  assert.equal(replied.count, 1);
  const card = replied.cards[0];
  assert.equal(card.deal_id, 11);
  assert.equal(card.chip, 'replied');
  assert.equal(card.replied_at, iso(Date.parse(sentAt) + HOUR));
  assert.equal(card.reply_preview?.length, 80);
  assert.ok(card.reply_preview?.startsWith('Oi! Quero saber das datas'));
  assert.equal(d.kpis.sent_7d, 2, 'o envio de 9 dias atrás fica fora da semana');
  assert.equal(d.kpis.replied_7d, 1);
  assert.equal(d.kpis.reply_rate_7d, 50);
});

test('Respondeu só vale para o último envio dos 14 dias e cede para tarefa viva criada depois da resposta', () => {
  const old = task({ status: 'sent', step: 2, sent_at: ago(20 * DAY), created_at: ago(21 * DAY) });
  const oldReply = msg(PHONE_A, ago(19 * DAY));
  assert.equal(placeOne([old], { replies: repliesOf([oldReply]) }).column, 'follow_2');

  const sent = task({ id: 50, status: 'sent', track: 'pre_quote', sent_at: ago(5 * DAY), created_at: ago(6 * DAY) });
  const reply = msg(PHONE_A, ago(4 * DAY));
  const again = task({ id: 51, status: 'draft', step: 1, track: 'ladder', created_at: ago(2 * DAY) });
  const back = placeOne([sent, again], { replies: repliesOf([reply]) });
  assert.equal(back.column, 'follow_1', 'rascunho novo depois da resposta: voltou para a cadência');

  const beforeReply = task({ id: 52, status: 'approved', step: 2, created_at: ago(4.5 * DAY) });
  assert.equal(placeOne([sent, beforeReply], { replies: repliesOf([reply]) }).column, 'replied');
});

// Colunas e Encerrado

test('coluna pelo passo da tarefa mais nova; passo 4 fica em Follow 03; as duas trilhas usam as mesmas colunas', () => {
  assert.equal(placeOne([task({ step: 1 })]).column, 'follow_1');
  assert.equal(placeOne([task({ step: 2, status: 'approved' })]).column, 'follow_2');
  assert.equal(placeOne([task({ step: 3, status: 'blocked' })]).column, 'follow_3');
  assert.equal(placeOne([task({ step: 4, status: 'draft' })]).column, 'follow_3');
  assert.equal(placeOne([task({ step: 1, track: 'pre_quote' })]).column, 'follow_1');
  const older = task({ id: 60, step: 1, status: 'sent', sent_at: ago(3 * DAY), created_at: ago(4 * DAY) });
  const newer = task({ id: 61, step: 2, status: 'draft', created_at: ago(DAY) });
  assert.equal(placeOne([newer, older]).column, 'follow_2');
  const [flow] = groupFlows([older, newer]);
  assert.equal(flow.latest.id, 61);
  assert.equal(flow.lastSent?.id, 60);
});

test('Encerrado: pulado, cancelado, não contatar e passo 3 sem resposta há mais de 7 dias', () => {
  assert.deepEqual(placeOne([task({ status: 'skipped' })]), { column: 'closed', reply: null, closed: 'skipped' });
  assert.equal(placeOne([task({ status: 'cancelled' })]).closed, 'cancelled');

  const sent = task({ status: 'sent', sent_at: ago(DAY) });
  const reply = msg(PHONE_A, ago(HOUR * 3));
  const optOut = placeOne([sent], { optOutKeys: new Set([canonical(PHONE_A)]), replies: repliesOf([reply]) });
  assert.deepEqual([optOut.column, optOut.closed], ['closed', 'optout'], 'não contatar vence a resposta');

  const step3 = task({ id: 70, status: 'sent', step: 3, sent_at: ago(8 * DAY), created_at: ago(9 * DAY) });
  assert.equal(placeOne([step3]).closed, 'no_reply');
  assert.equal(placeOne([{ ...step3, sent_at: ago(6 * DAY) }]).column, 'follow_3', '6 dias ainda espera');
  const farewell = task({ id: 71, status: 'draft', step: 4, created_at: ago(DAY) });
  assert.equal(placeOne([step3, farewell]).column, 'follow_3', 'despedida na fila: ainda não acabou');
  const step2 = task({ id: 72, status: 'sent', step: 2, sent_at: ago(10 * DAY), created_at: ago(11 * DAY) });
  assert.equal(placeOne([step2]).column, 'follow_2', 'a regra dos 7 dias é só do passo 3 em diante');
});

// Previsão de envio

function etaInput(over: Partial<EtaInput> = {}): EtaInput {
  return {
    items: [], now: NOW, hours: DEFAULT_BUSINESS_HOURS, capAt: () => 10, sentToday: 0, nextSendAfter: null, gapSeconds: 120,
    running: true, ...over,
  };
}

const item = (id: number, over: Partial<{ status: string; scheduled_at: string | null }> = {}) => (
  { id, status: 'approved', scheduled_at: ago(HOUR), ...over }
);

test('eta: teto do dia cheio vai para o próximo dia útil às 9h, com o intervalo entre envios', () => {
  const etas = estimateEtas(etaInput({ items: [item(1), item(2)], sentToday: 10 }));
  assert.equal(etas.get(1), '2026-09-17T12:00:00.000Z');   // quinta, 9h em São Paulo
  assert.equal(etas.get(2), '2026-09-17T12:02:00.000Z');
});

test('eta: dentro do horário respeita next_send_after e scheduled_at no futuro', () => {
  const etas = estimateEtas(etaInput({
    items: [item(1), item(2), item(3, { scheduled_at: later(3 * HOUR) })], nextSendAfter: later(5 * 60_000),
  }));
  assert.equal(etas.get(1), later(5 * 60_000));
  assert.equal(etas.get(2), later(7 * 60_000));
  assert.equal(etas.get(3), later(3 * HOUR));
});

test('eta: depois das 19h e no sábado à noite vai para a próxima abertura (domingo fechado)', () => {
  const evening = new Date('2026-09-16T22:30:00.000Z');   // quarta 19h30
  assert.equal(estimateEtas(etaInput({ now: evening, items: [item(1, { scheduled_at: null })] })).get(1), '2026-09-17T12:00:00.000Z');
  const saturday = new Date('2026-09-19T22:30:00.000Z');  // sábado 19h30
  assert.equal(estimateEtas(etaInput({ now: saturday, items: [item(1)] })).get(1), '2026-09-21T12:00:00.000Z');
  const almost = new Date('2026-09-16T21:59:00.000Z');    // 18h59: o segundo passa das 19h
  const etas = estimateEtas(etaInput({ now: almost, items: [item(1), item(2)] }));
  assert.equal(etas.get(1), '2026-09-16T21:59:00.000Z');
  assert.equal(etas.get(2), '2026-09-17T12:00:00.000Z');
});

test('eta: teto por dia (inclusive o que está saindo), rampa por data, pausado e enviando', () => {
  const capped = estimateEtas(etaInput({ items: [item(1), item(2), item(3)], capAt: () => 2, sentToday: 1 }));
  assert.equal(capped.get(1), NOW.toISOString());
  assert.equal(capped.get(2), '2026-09-17T12:00:00.000Z');
  assert.equal(capped.get(3), '2026-09-17T12:02:00.000Z');

  const sending = estimateEtas(etaInput({ items: [item(9, { status: 'sending' }), item(1)], capAt: () => 2, sentToday: 1 }));
  assert.equal(sending.get(9), NOW.toISOString());
  assert.equal(sending.get(1), '2026-09-17T12:00:00.000Z', 'o que está saindo ocupa a vaga de hoje');

  const rampEnds = Date.parse('2026-09-17T00:00:00.000Z');
  const ramp = estimateEtas(etaInput({ items: [item(1), item(2), item(3)], capAt: (at) => (at.getTime() < rampEnds ? 1 : 3), sentToday: 1 }));
  assert.equal(ramp.get(1), '2026-09-17T12:00:00.000Z');
  assert.equal(ramp.get(3), '2026-09-17T12:04:00.000Z');

  const paused = estimateEtas(etaInput({ items: [item(9, { status: 'sending' }), item(1)], running: false }));
  assert.equal(paused.get(1), null);
  assert.equal(paused.get(9), NOW.toISOString());
});

// Precisam de você

test('precisam de você: última fala do cliente há mais de 2h e menos de 30 dias, em qualquer variante', () => {
  const G = '5543999990007';
  const rows: DashMessage[] = [
    msg(PHONE_A, ago(3 * HOUR)),
    msg(PHONE_B, ago(HOUR)),
    msg(PHONE_C, ago(31 * DAY)),
    msg(PHONE_D, ago(5 * HOUR)), msg(PHONE_D, ago(4 * HOUR), { from_me: true, status: 'read' }),
    msg(PHONE_E, ago(5 * HOUR)), msg(PHONE_E, ago(4 * HOUR), { from_me: true, type: 'reaction', status: 'sent' }),
    msg(PHONE_F, ago(5 * HOUR), { from_me: true, status: 'read' }), msg(PHONE_F, ago(4 * HOUR), { type: 'reaction' }),
    msg('554399990007', ago(6 * HOUR)), msg(G, ago(5.5 * HOUR), { from_me: true, status: 'failed' }),
  ];
  const deals = [deal(1, PHONE_A), deal(2, PHONE_B), deal(3, PHONE_C), deal(4, PHONE_D), deal(5, PHONE_E), deal(6, PHONE_F), deal(7, G)];
  const waiting = waitingDeals(deals, latestTurnByKey(rows), NOW);
  assert.deepEqual(waiting.map((w) => w.deal.id), [1, 5, 7]);
});

test('precisam de você no painel: soma os bloqueados, só negócio aberto, prévia com o fim da fala', () => {
  const longText = `${'bla '.repeat(40)}qual o valor do ensaio?`;
  const d = buildDashboard(sources({
    tasks: [task({ id: 5, deal_id: 30, phone: PHONE_C, status: 'blocked', step: 2, last_error: 'block:baileys_offline' })],
    deals: [deal(21, PHONE_A), deal(22, PHONE_B, { stage: 'won' }), deal(23, PHONE_D, { converted: true }), deal(30, PHONE_C)],
    turns: [msg(PHONE_A, ago(3 * HOUR), { body: longText }), msg(PHONE_B, ago(3 * HOUR)), msg(PHONE_D, ago(3 * HOUR))],
  }));
  assert.equal(d.kpis.waiting_studio, 1);
  assert.equal(d.kpis.blocked, 1);
  assert.equal(d.kpis.needs_you, 2);
  assert.equal(d.needs_you_list.length, 1);
  const [w] = d.needs_you_list;
  assert.equal(w.deal_id, 21);
  assert.equal(w.stage_name, 'Orçamento enviado');
  assert.equal(w.last_customer_at, ago(3 * HOUR));
  assert.ok(w.preview.endsWith('qual o valor do ensaio?'));
  assert.ok(w.preview.length <= 100);
  const problem = column(d, 'follow_2').cards[0];
  assert.equal(problem.chip, 'problem');
  assert.equal(problem.error, 'block:baileys_offline');
});

// Planejamento das buscas

test('buscas: janela curta perto da última mensagem da conversa e respostas só de quem a conversa andou', () => {
  const since = NOW.getTime() - 30 * DAY;
  const conv = lastAtByKey([
    { phone: PHONE_A, last_message_at: ago(5 * HOUR) }, { phone: PHONE_A_12, last_message_at: ago(2 * HOUR) },
    { phone: PHONE_B, last_message_at: ago(40 * DAY) }, { phone: 'x', last_message_at: ago(HOUR) },
  ]);
  assert.equal(conv.get(canonical(PHONE_A)), NOW.getTime() - 2 * HOUR, 'maior valor entre 12 e 13 dígitos');
  const windows = turnWindows([deal(1, PHONE_A), deal(2, PHONE_A), deal(3, PHONE_B), deal(4, PHONE_C)], conv, since);
  assert.deepEqual(windows, [{ key: canonical(PHONE_A), phone: PHONE_A, since: iso(NOW.getTime() - 2 * HOUR - 60_000) }]);
  const onlyReaction = [msg(PHONE_A, ago(2 * HOUR), { type: 'reaction' })];
  assert.equal(missingTurnWindows(windows, onlyReaction).length, 1);
  assert.equal(missingTurnWindows(windows, [msg(PHONE_A, ago(2 * HOUR))]).length, 0);

  const flows = groupFlows([
    task({ id: 1, deal_id: 1, status: 'sent', sent_at: ago(3 * DAY) }),
    task({ id: 2, deal_id: 1, status: 'sent', step: 2, sent_at: ago(DAY) }),
    task({ id: 3, deal_id: 2, phone: PHONE_B, status: 'sent', sent_at: ago(2 * DAY) }),
    task({ id: 4, deal_id: 3, phone: PHONE_C, status: 'draft' }),
  ]);
  const replyConv = new Map([[canonical(PHONE_A), NOW.getTime() - HOUR], [canonical(PHONE_B), NOW.getTime() - 2 * DAY + 2000]]);
  assert.deepEqual(replyWindows(flows, replyConv, NOW), [{ key: canonical(PHONE_A), phone: PHONE_A, since: ago(3 * DAY) }]);
});

// Painel inteiro

test('painel: limite de 60 cards por coluna, ordem pela previsão, números e avanço no funil', () => {
  const queue = Array.from({ length: 65 }, (_, i) => task({
    id: 100 + i, deal_id: 100 + i, phone: `55439999${String(1000 + i).padStart(5, '0')}`, status: 'approved',
    scheduled_at: iso(NOW.getTime() - (65 - i) * 60_000),
  }));
  const deals = queue.map((t) => deal(t.deal_id, String(t.phone)));
  const d = buildDashboard(sources({
    tasks: [
      ...queue,
      task({ id: 1, deal_id: 1, phone: PHONE_B, status: 'sent', sent_at: ago(HOUR) }),
      task({ id: 2, deal_id: 2, phone: PHONE_C, status: 'sent', sent_at: ago(2 * DAY) }),
      task({ id: 3, deal_id: 3, phone: PHONE_D, status: 'sent', sent_at: ago(3 * DAY), step: 2 }),
      task({ id: 4, deal_id: 4, phone: PHONE_E, status: 'draft', track: 'pre_quote' }),
      task({ id: 5, deal_id: 999, phone: PHONE_F, status: 'draft' }),
    ],
    deals: [...deals, deal(1, PHONE_B), deal(2, PHONE_C, { stage: 'won' }), deal(3, PHONE_D, { converted_job_id: 77 }), deal(4, PHONE_E, { stage: 'contact' })],
  }));
  const follow1 = column(d, 'follow_1');
  assert.equal(follow1.label, 'Follow 01');
  assert.equal(follow1.count, 65 + 1 + 1 + 1, 'fila, enviado de hoje, enviado ganho e rascunho antes do orçamento; negócio excluído fica fora');
  assert.equal(follow1.cards.length, COLUMN_LIMIT);
  assert.equal(follow1.cards[0].chip, 'queued');
  assert.equal(follow1.cards[0].task_id, 100, 'quem sai primeiro no topo');
  assert.equal(follow1.cards[0].eta, NOW.toISOString());
  assert.equal(follow1.cards[1].eta, iso(NOW.getTime() + (105 + 10) * 1000), 'intervalo médio de 60 a 150s mais meio tick');
  assert.equal(follow1.cards[8].eta?.slice(0, 10), '2026-09-16', 'já saiu 1 hoje: cabem mais 9 no teto de 10');
  assert.equal(follow1.cards[9].eta, '2026-09-17T12:00:00.000Z', 'o 10º da fila vai para amanhã às 9h');
  assert.deepEqual(d.board.columns.map((c) => c.label), ['Follow 01', 'Follow 02', 'Follow 03', 'Respondeu', 'Encerrado']);
  assert.equal(column(d, 'follow_2').count, 1);
  assert.equal(d.kpis.scheduled, 65);
  assert.equal(d.kpis.drafts, 2);
  assert.equal(d.kpis.effective_cap, 10);
  assert.equal(d.kpis.sent_today, 1);
  assert.equal(d.kpis.days_to_drain, 7);
  assert.equal(d.kpis.next_send_at, NOW.toISOString(), 'o primeiro da fila sai agora');
  assert.equal(d.kpis.advanced_14d, 2, 'ganho e convertido contam; aberto não');
  assert.equal(d.tz, 'America/Sao_Paulo');
  assert.equal(d.server_time, NOW.toISOString());
});

test('painel desligado ou pausado: sem previsão, e o card na fila continua na coluna do passo', () => {
  const { config: cfg, state } = config({ paused_at: ago(HOUR), paused_reason: 'manual' });
  const d = buildDashboard(sources({ config: cfg, state, tasks: [task({ status: 'approved' })], deals: [deal(11, PHONE_A)] }));
  const card = column(d, 'follow_1').cards[0];
  assert.equal(card.chip, 'queued');
  assert.equal(card.eta, null);
  assert.equal(d.kpis.next_send_at, null);
});

// Carregador (consultas) e rota, com Supabase falso em memória

type Row = Record<string, any>;
type Pred = (row: Row) => boolean;

function norm(v: unknown): unknown {
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) return Date.parse(v);
  if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v;
}

function cmp(a: unknown, b: unknown): number {
  const x = norm(a);
  const y = norm(b);
  if (typeof x === 'number' && typeof y === 'number') return x - y;
  return String(x).localeCompare(String(y));
}

function eqv(a: unknown, b: unknown): boolean {
  if (a === null || a === undefined || b === null || b === undefined) return (a ?? null) === (b ?? null);
  if (typeof a === 'boolean' || typeof b === 'boolean') return String(a) === String(b);
  return cmp(a, b) === 0;
}

const OPS: Record<string, (value: unknown, operand: any) => boolean> = {
  eq: (v, o) => eqv(v, o),
  gt: (v, o) => v != null && cmp(v, o) > 0,
  gte: (v, o) => v != null && cmp(v, o) >= 0,
  lt: (v, o) => v != null && cmp(v, o) < 0,
  lte: (v, o) => v != null && cmp(v, o) <= 0,
  is: (v, o) => (o === null || o === 'null' ? v == null : String(v) === String(o)),
  in: (v, o) => (o as unknown[]).some((x) => eqv(v, x)),
};

function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(current);
      current = '';
    } else current += ch;
  }
  if (current) out.push(current);
  return out;
}

function parseTerm(term: string): Pred {
  const logic = /^(and|or)\((.*)\)$/.exec(term);
  if (logic) return parseLogic(logic[2], logic[1] as 'and' | 'or');
  const parts = term.split('.');
  const negate = parts[1] === 'not';
  const op = parts[negate ? 2 : 1];
  const raw = parts.slice(negate ? 3 : 2).join('.');
  const operand = op === 'in' ? raw.replace(/^\(|\)$/g, '').split(',') : raw;
  return (row) => OPS[op](row[parts[0]], operand) !== negate;
}

function parseLogic(expr: string, mode: 'and' | 'or'): Pred {
  const preds = splitTop(expr).map(parseTerm);
  return mode === 'or' ? (row) => preds.some((p) => p(row)) : (row) => preds.every((p) => p(row));
}

interface LogEntry { table: string; filters: string[]; columns: string }

class FakeDb {
  tables: Record<string, Row[]>;
  log: LogEntry[] = [];
  constructor(tables: Record<string, Row[]>) { this.tables = tables; }
  from(table: string) { return new FakeQuery(this, table); }
}

class FakeQuery {
  db: FakeDb;
  table: string;
  columns = '*';
  preds: Pred[] = [];
  filters: string[] = [];
  orders: Array<[string, boolean]> = [];
  rangeFrom = 0;
  rangeTo: number | null = null;
  lim: number | null = null;
  maybe = false;

  constructor(db: FakeDb, table: string) {
    this.db = db;
    this.table = table;
  }

  select(columns = '*') { this.columns = columns; return this; }
  add(desc: string, pred: Pred) { this.filters.push(desc); this.preds.push(pred); return this; }
  eq(c: string, v: unknown) { return this.add(`${c}=eq.${v}`, (r) => OPS.eq(r[c], v)); }
  gt(c: string, v: unknown) { return this.add(`${c}=gt.${v}`, (r) => OPS.gt(r[c], v)); }
  gte(c: string, v: unknown) { return this.add(`${c}=gte.${v}`, (r) => OPS.gte(r[c], v)); }
  lte(c: string, v: unknown) { return this.add(`${c}=lte.${v}`, (r) => OPS.lte(r[c], v)); }
  is(c: string, v: unknown) { return this.add(`${c}=is.${v}`, (r) => OPS.is(r[c], v)); }
  in(c: string, v: unknown[]) { return this.add(`${c}=in.(${v.join(',')})`, (r) => OPS.in(r[c], v)); }
  or(expr: string) { return this.add(`or=(${expr})`, parseLogic(expr, 'or')); }
  order(c: string, opts?: { ascending?: boolean }) { this.orders.push([c, opts?.ascending !== false]); return this; }
  range(from: number, to: number) { this.rangeFrom = from; this.rangeTo = to; return this; }
  limit(n: number) { this.lim = n; return this; }
  maybeSingle() { this.maybe = true; return this; }

  then(resolve: (v: any) => any, reject?: (e: any) => any) {
    return Promise.resolve().then(() => this.execute()).then(resolve, reject);
  }

  project(row: Row): Row {
    if (this.columns === '*') return structuredClone(row);
    const out: Row = {};
    for (const c of this.columns.split(',').map((s) => s.trim())) out[c] = row[c] ?? null;
    return out;
  }

  execute() {
    this.db.log.push({ table: this.table, filters: [...this.filters], columns: this.columns });
    const rows = (this.db.tables[this.table] || []).filter((r) => this.preds.every((p) => p(r)));
    rows.sort((a, b) => {
      for (const [c, asc] of this.orders) {
        const diff = cmp(a[c], b[c]);
        if (diff !== 0) return asc ? diff : -diff;
      }
      return 0;
    });
    let page = rows.slice(this.rangeFrom, this.rangeTo === null ? undefined : this.rangeTo + 1);
    if (this.lim !== null) page = page.slice(0, this.lim);
    const data = page.map((r) => this.project(r));
    return { data: this.maybe ? (data[0] ?? null) : data, error: null };
  }
}

function dbRow(t: BoardTask, over: Row = {}): Row {
  return { ...t, user_id: OWNER, kind: 'cadence', message: 'texto do follow-up', stage_id: 'proposal', ...over };
}

function seedDb(): FakeDb {
  const configRow = {
    user_id: OWNER, enabled: true, mode: 'approval', ladder_stage_ids: ['proposal', 'negotiation'], step_delays_hours: [24, 48],
    pre_quote_stage_ids: ['contact'], pre_quote_delays_hours: [24, 72], business_hours: DEFAULT_BUSINESS_HOURS, daily_cap: 10,
    min_gap_seconds: 60, max_gap_seconds: 150, allow_baileys: false, next_send_after: null, paused_at: null, first_enabled_at: null,
  };
  const sentAt = ago(DAY);
  return new FakeDb({
    followup_cadence_config: [configRow, { ...configRow, user_id: OTHER, daily_cap: 99 }],
    deal_stages: stagesFixture().map((s) => ({ ...s, user_id: OWNER })),
    deals: [
      { ...deal(11, PHONE_A), user_id: OWNER },
      { ...deal(12, PHONE_B), user_id: OWNER },
      { ...deal(13, PHONE_C, { stage: 'won' }), user_id: OWNER },
      { ...deal(14, PHONE_D), user_id: OWNER },
      { ...deal(91, PHONE_A), user_id: OTHER },
    ],
    scheduled_followups: [
      dbRow(task({ id: 1, deal_id: 11, status: 'sent', sent_at: sentAt, created_at: ago(2 * DAY), sent_message_id: 'wamid.um' })),
      dbRow(task({ id: 2, deal_id: 12, phone: PHONE_B, status: 'sent', sent_at: sentAt, created_at: ago(2 * DAY), sent_message_id: 'wamid.dois' })),
      dbRow(task({ id: 3, deal_id: 13, phone: PHONE_C, status: 'cancelled', created_at: ago(3 * DAY), last_error: 'cancel:deal_closed' })),
      dbRow(task({ id: 4, deal_id: 14, phone: PHONE_D, status: 'approved', created_at: ago(40 * DAY), scheduled_at: ago(39 * DAY) })),
      dbRow(task({ id: 5, deal_id: 11, status: 'draft', created_at: ago(60 * DAY) })),
      dbRow(task({ id: 6, deal_id: 91, status: 'draft' }), { user_id: OTHER }),
      dbRow(task({ id: 7, deal_id: 12, phone: PHONE_B, status: 'sent', sent_at: ago(HOUR) }), { kind: 'legacy' }),
    ],
    wa_conversations: [
      { user_id: OWNER, phone: PHONE_A_12, last_message_at: ago(3 * HOUR) },
      { user_id: OWNER, phone: PHONE_B, last_message_at: iso(Date.parse(sentAt) + 1000) },
      { user_id: OTHER, phone: PHONE_A, last_message_at: ago(HOUR) },
    ],
    wa_messages: [
      { user_id: OWNER, phone: PHONE_A_12, from_me: false, timestamp: ago(3 * HOUR), type: 'text', status: 'received', body: 'Pode me mandar as datas?', message_id: 'm1' },
      { user_id: OWNER, phone: PHONE_A, from_me: true, timestamp: sentAt, type: 'text', status: 'delivered', body: 'Oi!', message_id: 'wamid.um' },
      { user_id: OWNER, phone: PHONE_B, from_me: true, timestamp: sentAt, type: 'text', status: 'read', body: 'Oi!', message_id: 'wamid.dois' },
      { user_id: OTHER, phone: PHONE_A, from_me: false, timestamp: ago(HOUR), type: 'text', status: 'received', body: 'outra conta', message_id: 'x1' },
    ],
    followup_optouts: [{ user_id: OWNER, phone_key: canonical(PHONE_D), revoked_at: null }],
  });
}

test('carregador: toda consulta filtra a conta, tarefas só da cadência, colunas certas e cache de 30s', async () => {
  const db = seedDb();
  let clock = 1_000_000;
  const load = createDashboardLoader({ db, now: () => NOW, clock: () => clock });
  const d = await load(OWNER);

  assert.deepEqual(d.board.columns.map((c) => [c.key, c.count]), [
    ['follow_1', 1], ['follow_2', 0], ['follow_3', 0], ['replied', 1], ['closed', 2],
  ]);
  const replied = column(d, 'replied').cards[0];
  assert.equal(replied.deal_id, 11);
  assert.equal(replied.reply_preview, 'Pode me mandar as datas?');
  const sent = column(d, 'follow_1').cards[0];
  assert.equal(sent.deal_id, 12);
  assert.equal(sent.chip, 'sent');
  assert.equal(sent.delivery, 'read');
  const closed = column(d, 'closed').cards.map((c) => [c.deal_id, c.closed_reason]);
  assert.deepEqual(closed.sort(), [[13, 'cancelled'], [14, 'optout']]);
  assert.equal(d.kpis.sent_today, 0);
  assert.equal(d.kpis.sent_7d, 2);
  assert.equal(d.kpis.replied_7d, 1);
  assert.equal(d.kpis.advanced_14d, 0, 'o ganho recebeu só tarefa cancelada');
  assert.equal(d.kpis.waiting_studio, 1, 'o cliente A escreveu há 3h e ninguém respondeu');
  assert.equal(d.needs_you_list[0].deal_id, 11);

  assert.ok(db.log.length >= 8);
  for (const entry of db.log) {
    assert.ok(entry.filters.includes(`user_id=eq.${OWNER}`), `sem filtro de conta: ${entry.table} ${entry.filters.join('&')}`);
    if (entry.table === 'scheduled_followups') assert.ok(entry.filters.includes('kind=eq.cadence'), 'tarefa sem filtro de kind');
    if (entry.table === 'wa_messages') assert.notEqual(entry.columns, '*');
  }
  const windowed = db.log.filter((e) => e.table === 'wa_messages' && e.filters.some((f) => f.startsWith('or=(and(phone.in.(')));
  assert.ok(windowed.length >= 2, 'busca por janela de telefone (última fala e respostas)');

  const before = db.log.length;
  await load(OWNER);
  assert.equal(db.log.length, before, 'dentro de 30s vem do cache');
  clock += 30_001;
  await load(OWNER);
  assert.ok(db.log.length > before, 'depois de 30s consulta de novo');
});

test('rota GET /api/followups/dashboard: mesmo middleware do overview e resposta do painel', async (t) => {
  const db = seedDb();
  const app = express();
  app.use(express.json());
  const requireAuth = (req: any, _res: any, next: any) => {
    const member = req.headers['x-role'] === 'member';
    Object.assign(req, { userId: OWNER, realUserId: member ? OTHER : OWNER, isMember: member, isPlatformAdmin: false,
      isImpersonating: false, memberPermissions: member ? { vendas: false } : null });
    next();
  };
  const requirePermission = (module: string) => (req: any, res: any, next: any) => {
    if (req.isMember && (req.memberPermissions || {})[module] === false) return res.status(403).json({ error: 'sem permissão' });
    return next();
  };
  const pass = (_req: any, _res: any, next: any) => next();
  registerFollowUpRoutes(app, {
    db: db as any, requireAuth, requirePermission, requireOwnerOrPlatformAdmin: pass, denyProductionOnly: pass,
    services: {} as FollowUpServices, now: () => NOW,
  });
  const server: Server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/followups/dashboard`;

  const res = await fetch(base);
  assert.equal(res.status, 200);
  const body = await res.json() as FollowUpDashboard;
  assert.deepEqual(Object.keys(body).sort(), ['board', 'kpis', 'needs_you_list', 'server_time', 'tz']);
  assert.equal(body.board.columns.length, 5);
  assert.equal(body.kpis.needs_you, 1);

  const denied = await fetch(base, { headers: { 'x-role': 'member' } });
  assert.equal(denied.status, 403);
});

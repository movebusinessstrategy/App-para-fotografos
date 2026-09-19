import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  activityFromRpcRow,
  advanceTargetFor,
  CADENCE_MAX_STEPS,
  CLOCK_TOLERANCE_MS,
  customerSpokeAfter,
  delayHoursForStep,
  effectiveDailyCap,
  housekeepLiveTasks,
  initialStatusFor,
  LIVE_TASK_LOOKBACK_DAYS,
  nextErrorState,
  nextStageAfterStep,
  parseCadenceConfig,
  preQuoteDelayHours,
  preQuoteSentInEpisode,
  preQuoteStepCount,
  preQuoteStepFor,
  resolveExpiredLease,
  selectEligibleDeals,
  shouldCancelBeforeSend,
  STALE_APPROVAL_HOURS,
  stepCount,
  stepForStage,
  studioTurn,
  suggestLadder,
  suggestPreQuote,
  suggestTrackerStages,
  trackForStage,
  validateConfigInput,
} from './followup-cadence.js';
import type { CadenceTaskLite, DealActivity, SelectInput, SendSnapshot } from './followup-cadence.js';
import { DEFAULT_FOLLOWUP_CONFIG, DEFAULT_TRACKER_CONFIG } from './src/features/followups/types.js';
import type { CadenceTaskRow, FollowUpConfig, FollowUpRuntimeState } from './src/features/followups/types.js';
import { canonicalPhoneKey } from './lib/br-phone.js';
import type { StageRow } from './lib/stage-rules.js';

const HOUR = 3_600_000;
// Sexta-feira, 12:00 em São Paulo: dentro do horário comercial padrão.
const NOW = new Date('2026-09-18T15:00:00.000Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * HOUR).toISOString();

const stage = (id: string, name: string, position: number, extra: Partial<StageRow> = {}): StageRow => ({
  id, name, position, is_final: false, is_won: false, process_id: null, ...extra,
});

// Funil real da Pitori (ids, nomes e posições).
const STAGES: StageRow[] = [
  stage('lead', 'Entrou em Contato', 0),
  stage('contact', 'Conversa Iniciada', 1),
  stage('proposal', 'Orçamento Enviado', 2),
  stage('negotiation', '01 Follow Up', 3),
  stage('02-follow-up', '02 Follow Up', 4),
  stage('won', 'Fechado Ganho', 4, { is_final: true, is_won: true }),
  stage('03-follow-up', '03 Follow Up', 5),
  stage('lost', 'Perdido', 5, { is_final: true }),
  stage('04-follow-up', '04 Follow Up', 6),
  stage('aguardando-sinal', 'Aguardando Sinal', 7),
  stage('prod-agendado', 'Agendado', 0),
];

const LADDER = ['proposal', 'negotiation', '02-follow-up', '03-follow-up'];
const CONFIG: FollowUpConfig = {
  ...DEFAULT_FOLLOWUP_CONFIG,
  enabled: true,
  ladder_stage_ids: LADDER,
  step_delays_hours: [24, 48, 72, 120],
  after_last_stage_id: '04-follow-up',
};

const PHONE = '5511912340001';
const PHONE_12 = '551112340001';
const PHONE_B = '5511912340002';

function activity(over: Partial<DealActivity> = {}): DealActivity {
  const contactPhone = over.contactPhone ?? PHONE;
  return {
    dealId: 1, stage: 'proposal', contactName: 'Cliente Teste', contactPhone, phoneKey: canonicalPhoneKey(contactPhone),
    stageEnteredAt: hoursAgo(30), lastStudioAt: hoursAgo(26), lastStudioType: 'document', lastStudioBody: 'orcamento.pdf',
    lastStudioMessageId: 'wamid.studio', lastCustomerAt: hoursAgo(27), lastCustomerReactionAt: null, lastInvisibleOutAt: null,
    invisibleRead: false, needsHuman: false, alreadyCustomer: false, ...over,
  };
}

function lite(over: Partial<CadenceTaskLite> = {}): CadenceTaskLite {
  return {
    id: 100, deal_id: 1, status: 'draft', step: 1, basis_at: hoursAgo(26), sent_at: null, created_at: hoursAgo(1),
    phone: PHONE, phone_key: null, stage_id: 'proposal', ...over,
  };
}

function select(activities: DealActivity[], extra: Partial<SelectInput> = {}) {
  return selectEligibleDeals({
    config: CONFIG, stages: STAGES, activities, cadenceTasks: [], liveLegacyDealIds: new Set(), optoutKeys: new Set(),
    now: NOW, ...extra,
  });
}

function reasonOf(result: ReturnType<typeof select>, dealId: number) {
  return result.skipped.find((s) => s.dealId === dealId)?.reason ?? null;
}

// Escada

test('escada da Pitori: passo por etapa, próxima etapa e atraso', () => {
  assert.equal(CADENCE_MAX_STEPS, 4);
  assert.equal(stepCount(CONFIG), 4);
  assert.equal(stepForStage('proposal', CONFIG), 1);
  assert.equal(stepForStage('negotiation', CONFIG), 2);
  assert.equal(stepForStage('02-follow-up', CONFIG), 3);
  assert.equal(stepForStage('03-follow-up', CONFIG), 4);
  assert.equal(stepForStage('04-follow-up', CONFIG), null);
  assert.equal(stepForStage('lead', CONFIG), null);
  assert.equal(nextStageAfterStep(1, CONFIG), 'negotiation');
  assert.equal(nextStageAfterStep(3, CONFIG), '03-follow-up');
  assert.equal(nextStageAfterStep(4, CONFIG), '04-follow-up');
  assert.equal(delayHoursForStep(1, CONFIG), 24);
  assert.equal(delayHoursForStep(4, CONFIG), 120);
});

test('escada com menos atrasos que etapas corta os passos sem atraso', () => {
  const short = { ...CONFIG, step_delays_hours: [24, 48, 72] };
  assert.equal(stepCount(short), 3);
  assert.equal(stepForStage('03-follow-up', short), null);
  assert.equal(nextStageAfterStep(3, short), '04-follow-up');
  assert.equal(stepCount({ ...CONFIG, ladder_stage_ids: [] }), 0);
  assert.equal(nextStageAfterStep(1, { ...CONFIG, ladder_stage_ids: ['proposal'], after_last_stage_id: null }), null);
});

// Seleção

test('deal elegível no passo 1 com todos os campos', () => {
  const result = select([activity()]);
  assert.deepEqual(result.skipped, []);
  assert.equal(result.eligible.length, 1);
  const e = result.eligible[0];
  assert.equal(e.dealId, 1);
  assert.equal(e.step, 1);
  assert.equal(e.stageId, 'proposal');
  assert.equal(e.nextStageId, 'negotiation');
  assert.equal(e.basisAt, hoursAgo(26));
  assert.equal(e.basisMessageId, 'wamid.studio');
  assert.equal(e.dueAt, hoursAgo(2));
  assert.equal(e.phoneKey, PHONE_12);
  assert.equal(e.contactPhone, PHONE);
  assert.equal(e.contactName, 'Cliente Teste');
  assert.equal(e.invisibleBasis, false);
  assert.equal(e.invisibleRead, false);
  assert.equal(Math.round(e.silenceHours), 26);
  assert.equal(e.lastCustomerAt, hoursAgo(27));
  assert.equal(e.customerReactedAfterBasis, false);
});

test('disabled: cadência desligada ou sem passos', () => {
  const off = select([activity(), activity({ dealId: 2 })], { config: { ...CONFIG, enabled: false } });
  assert.deepEqual(off.eligible, []);
  assert.deepEqual(off.skipped, [{ dealId: 1, reason: 'disabled' }, { dealId: 2, reason: 'disabled' }]);
  const empty = select([activity()], { config: { ...CONFIG, ladder_stage_ids: [] } });
  assert.equal(reasonOf(empty, 1), 'disabled');
});

test('closed_stage: etapa final ou desconhecida', () => {
  const result = select([activity({ dealId: 1, stage: 'won' }), activity({ dealId: 2, stage: 'sumiu', contactPhone: PHONE_B })]);
  assert.equal(reasonOf(result, 1), 'closed_stage');
  assert.equal(reasonOf(result, 2), 'closed_stage');
});

test('stage_not_in_ladder: etapa aberta fora da escada', () => {
  const result = select([activity({ dealId: 1, stage: 'contact' }), activity({ dealId: 2, stage: '04-follow-up', contactPhone: PHONE_B })]);
  assert.equal(reasonOf(result, 1), 'stage_not_in_ladder');
  assert.equal(reasonOf(result, 2), 'stage_not_in_ladder');
});

test('already_customer e needs_human', () => {
  const result = select([activity({ dealId: 1, alreadyCustomer: true }), activity({ dealId: 2, needsHuman: true, contactPhone: PHONE_B })]);
  assert.equal(reasonOf(result, 1), 'already_customer');
  assert.equal(reasonOf(result, 2), 'needs_human');
});

test('optout pela chave canônica do telefone', () => {
  const result = select([activity()], { optoutKeys: new Set([PHONE_12]) });
  assert.equal(reasonOf(result, 1), 'optout');
});

test('live_cadence_task: mesmo deal ou mesmo telefone; tarefa encerrada não trava', () => {
  const sameDeal = select([activity()], { cadenceTasks: [lite({ status: 'approved', basis_at: hoursAgo(80) })] });
  assert.equal(reasonOf(sameDeal, 1), 'live_cadence_task');
  const samePhone = select([activity()], { cadenceTasks: [lite({ deal_id: 9, status: 'blocked', phone: PHONE_12, basis_at: hoursAgo(80) })] });
  assert.equal(reasonOf(samePhone, 1), 'live_cadence_task');
  const closed = select([activity()], { cadenceTasks: [lite({ status: 'cancelled', basis_at: hoursAgo(80) })] });
  assert.equal(closed.eligible.length, 1);
});

test('live_legacy_task', () => {
  const result = select([activity()], { liveLegacyDealIds: new Set([1]) });
  assert.equal(reasonOf(result, 1), 'live_legacy_task');
});

test('no_studio_turn e customer_spoke_last', () => {
  const result = select([
    activity({ dealId: 1, lastStudioAt: null, lastInvisibleOutAt: null }),
    activity({ dealId: 2, contactPhone: PHONE_B, lastCustomerAt: hoursAgo(25) }),
    activity({ dealId: 3, contactPhone: '5511912340003', lastCustomerAt: hoursAgo(26) }),
  ]);
  assert.equal(reasonOf(result, 1), 'no_studio_turn');
  assert.equal(reasonOf(result, 2), 'customer_spoke_last');
  assert.equal(reasonOf(result, 3), 'customer_spoke_last');
});

test('too_old e too_soon (passo 2 com 47h fica de fora, com 48h entra)', () => {
  const result = select([
    activity({ dealId: 1, lastStudioAt: hoursAgo(721), lastCustomerAt: hoursAgo(800) }),
    activity({ dealId: 2, contactPhone: PHONE_B, stage: 'negotiation', lastStudioAt: hoursAgo(47), lastCustomerAt: hoursAgo(60) }),
    activity({ dealId: 3, contactPhone: '5511912340003', stage: 'negotiation', lastStudioAt: hoursAgo(48), lastCustomerAt: hoursAgo(60) }),
  ]);
  assert.equal(reasonOf(result, 1), 'too_old');
  assert.equal(reasonOf(result, 2), 'too_soon');
  assert.deepEqual(result.eligible.map((e) => [e.dealId, e.step]), [[3, 2]]);
});

test('episode_done é por telefone: outro deal do mesmo número com o mesmo basis', () => {
  const skippedTask = lite({ id: 5, deal_id: 7, status: 'skipped', phone: PHONE_12, basis_at: hoursAgo(26) });
  const result = select([activity({ dealId: 8 })], { cadenceTasks: [skippedTask] });
  assert.equal(reasonOf(result, 8), 'episode_done');
  const otherBasis = select([activity({ dealId: 8 })], { cadenceTasks: [{ ...skippedTask, basis_at: hoursAgo(90) }] });
  assert.equal(otherBasis.eligible.length, 1);
});

test('step_already_sent é por telefone: passo igual ou maior enviado depois da última fala do cliente', () => {
  const sent = lite({ id: 6, deal_id: 7, status: 'sent', step: 2, phone: PHONE_12, basis_at: hoursAgo(120), sent_at: hoursAgo(26) });
  const result = select([activity({ dealId: 8 })], { cadenceTasks: [sent] });
  assert.equal(reasonOf(result, 8), 'step_already_sent');
  const olderThanCustomer = select([activity({ dealId: 8 })], { cadenceTasks: [{ ...sent, sent_at: hoursAgo(28) }] });
  assert.equal(olderThanCustomer.eligible.length, 1);
});

test('duplicate_phone com 12 e 13 dígitos: vence a entrada mais recente na etapa', () => {
  const result = select([
    activity({ dealId: 1, contactPhone: PHONE_12, stageEnteredAt: hoursAgo(40) }),
    activity({ dealId: 2, contactPhone: PHONE, stageEnteredAt: hoursAgo(30) }),
  ]);
  assert.deepEqual(result.eligible.map((e) => e.dealId), [2]);
  assert.equal(reasonOf(result, 1), 'duplicate_phone');
  assert.equal(result.skipped.length, 1);
});

test('cliente respondeu depois do passo 1 e o card está em negotiation: elegível para o passo 2', () => {
  const sentStep1 = lite({ id: 6, status: 'sent', step: 1, basis_at: hoursAgo(130), sent_at: hoursAgo(100) });
  const result = select(
    [activity({ stage: 'negotiation', lastCustomerAt: hoursAgo(80), lastStudioAt: hoursAgo(50) })],
    { cadenceTasks: [sentStep1] },
  );
  assert.equal(result.eligible.length, 1);
  assert.equal(result.eligible[0].step, 2);
  assert.equal(result.eligible[0].nextStageId, '02-follow-up');
  assert.equal(result.eligible[0].dueAt, hoursAgo(2));
});

test('passo 2 sem resposta do cliente: o próprio follow-up do passo 1 é o basis', () => {
  const sentStep1 = lite({ id: 6, status: 'sent', step: 1, basis_at: hoursAgo(80), sent_at: hoursAgo(50) });
  const result = select(
    [activity({ stage: 'negotiation', lastCustomerAt: hoursAgo(90), lastStudioAt: hoursAgo(50) })],
    { cadenceTasks: [sentStep1] },
  );
  assert.deepEqual(result.eligible.map((e) => e.step), [2]);
});

test('IA oficial (invisível) depois do cliente vira o basis; dentro de 5s não é invisível', () => {
  const invisible = select([activity({ lastStudioAt: hoursAgo(40), lastCustomerAt: hoursAgo(30), lastInvisibleOutAt: hoursAgo(26), invisibleRead: true })]);
  const e = invisible.eligible[0];
  assert.equal(e.invisibleBasis, true);
  assert.equal(e.invisibleRead, true);
  assert.equal(e.basisAt, hoursAgo(26));
  assert.equal(e.basisMessageId, null);

  const echoAt = new Date(Date.parse(hoursAgo(26)) + 3000).toISOString();
  const echo = select([activity({ lastInvisibleOutAt: echoAt, invisibleRead: true })]);
  assert.equal(echo.eligible[0].invisibleBasis, false);
  assert.equal(echo.eligible[0].invisibleRead, false);
  assert.equal(echo.eligible[0].basisMessageId, 'wamid.studio');
});

test('studioTurn: maior instante e tolerância de relógio', () => {
  assert.equal(studioTurn({ lastStudioAt: null, lastInvisibleOutAt: null }), null);
  const onlyInvisible = studioTurn({ lastStudioAt: null, lastInvisibleOutAt: hoursAgo(3) });
  assert.deepEqual(onlyInvisible, { at: new Date(hoursAgo(3)), invisible: true });
  const visibleLater = studioTurn({ lastStudioAt: hoursAgo(2), lastInvisibleOutAt: hoursAgo(3) });
  assert.deepEqual(visibleLater, { at: new Date(hoursAgo(2)), invisible: false });
  const edge = new Date(Date.parse(hoursAgo(2)) + CLOCK_TOLERANCE_MS).toISOString();
  assert.equal(studioTurn({ lastStudioAt: hoursAgo(2), lastInvisibleOutAt: edge })?.invisible, false);
});

test('reação do cliente depois do basis marca customerReactedAfterBasis', () => {
  const after = select([activity({ lastCustomerReactionAt: hoursAgo(10) })]);
  assert.equal(after.eligible[0].customerReactedAfterBasis, true);
  const before = select([activity({ lastCustomerReactionAt: hoursAgo(30) })]);
  assert.equal(before.eligible[0].customerReactedAfterBasis, false);
});

test('saída ordenada por dueAt', () => {
  const result = select([
    activity({ dealId: 1, stageEnteredAt: hoursAgo(10), lastStudioAt: hoursAgo(25), lastCustomerAt: hoursAgo(30) }),
    activity({ dealId: 2, contactPhone: PHONE_B, stageEnteredAt: hoursAgo(20), stage: 'negotiation', lastStudioAt: hoursAgo(60), lastCustomerAt: hoursAgo(70) }),
    activity({ dealId: 3, contactPhone: '5511912340003', stageEnteredAt: hoursAgo(5), lastStudioAt: hoursAgo(40), lastCustomerAt: hoursAgo(50) }),
  ]);
  assert.deepEqual(result.eligible.map((e) => e.dealId), [3, 2, 1]);
  assert.deepEqual(result.eligible.map((e) => e.dueAt), [hoursAgo(16), hoursAgo(12), hoursAgo(1)]);
});

test('activityFromRpcRow converte snake_case, datas e chave do telefone', () => {
  const a = activityFromRpcRow({
    deal_id: '42', stage: 'proposal', contact_name: 'Cliente', contact_phone: PHONE, phone_key: null,
    stage_entered_at: '2026-09-17T10:00:00.123456+00:00', last_studio_at: '2026-09-17T11:00:00+00:00',
    last_studio_type: 'document', last_studio_body: 'orcamento.pdf', last_studio_message_id: 'wamid.x',
    last_customer_at: '2026-09-17T09:00:00+00:00', last_customer_reaction_at: '2026-09-17T12:00:00+00:00',
    last_invisible_out_at: null, invisible_read: false, needs_human: true, already_customer: true,
  });
  assert.deepEqual(a, {
    dealId: 42, stage: 'proposal', contactName: 'Cliente', contactPhone: PHONE, phoneKey: PHONE_12,
    stageEnteredAt: '2026-09-17T10:00:00.123Z', lastStudioAt: '2026-09-17T11:00:00.000Z', lastStudioType: 'document',
    lastStudioBody: 'orcamento.pdf', lastStudioMessageId: 'wamid.x', lastCustomerAt: '2026-09-17T09:00:00.000Z',
    lastCustomerReactionAt: '2026-09-17T12:00:00.000Z', lastInvisibleOutAt: null, invisibleRead: false,
    needsHuman: true, alreadyCustomer: true,
  });
  assert.equal(activityFromRpcRow({ deal_id: 1, contact_phone: PHONE, phone_key: '551112340001' }).phoneKey, PHONE_12);
});

// initialStatusFor

test('initialStatusFor só aprova sozinho no automático limpo', () => {
  const clean = { invisibleBasis: false };
  const auto = { manual: false, enabled: true };
  assert.deepEqual(initialStatusFor('auto', clean, [], auto), { status: 'approved', approved_by: 'auto' });
  assert.deepEqual(initialStatusFor('auto', clean, [], { manual: true, enabled: true }), { status: 'draft', approved_by: null });
  assert.deepEqual(initialStatusFor('auto', clean, [], { manual: false, enabled: false }), { status: 'draft', approved_by: null });
  assert.deepEqual(initialStatusFor('auto', { invisibleBasis: true }, [], auto), { status: 'draft', approved_by: null });
  assert.deepEqual(initialStatusFor('auto', clean, ['preco'], auto), { status: 'draft', approved_by: null });
  assert.deepEqual(initialStatusFor('approval', clean, [], auto), { status: 'draft', approved_by: null });
});

// Faxina

test('housekeepLiveTasks: cada motivo, na ordem', () => {
  const base = activity();
  const run = (a: DealActivity | null, t: Partial<CadenceTaskLite> = {}, optout = new Set<string>(), truncated = false) =>
    housekeepLiveTasks({ tasks: [lite(t)], activities: a ? [a] : [], stages: STAGES, optoutKeys: optout, truncated });
  assert.deepEqual(run(base), []);
  assert.deepEqual(run(null), [{ id: 100, reason: 'stage_changed' }]);
  assert.deepEqual(run(null, {}, new Set(), true), []);
  assert.deepEqual(run({ ...base, stage: 'negotiation' }), [{ id: 100, reason: 'stage_changed' }]);
  assert.deepEqual(run({ ...base, alreadyCustomer: true }), [{ id: 100, reason: 'already_customer' }]);
  assert.deepEqual(run(base, {}, new Set([PHONE_12])), [{ id: 100, reason: 'optout' }]);
  assert.deepEqual(run({ ...base, needsHuman: true }), [{ id: 100, reason: 'needs_human' }]);
  assert.deepEqual(run({ ...base, lastCustomerAt: hoursAgo(1) }), [{ id: 100, reason: 'customer_replied' }]);
  assert.deepEqual(run({ ...base, lastStudioAt: hoursAgo(1) }), [{ id: 100, reason: 'studio_spoke' }]);
  assert.deepEqual(run({ ...base, lastInvisibleOutAt: hoursAgo(1) }), [{ id: 100, reason: 'studio_spoke' }]);
  assert.deepEqual(run({ ...base, alreadyCustomer: true, needsHuman: true, stage: 'lost' }), [{ id: 100, reason: 'stage_changed' }]);
});

test('housekeepLiveTasks ignora sending e terminais e tolera 5s de relógio', () => {
  const moved = { ...activity(), stage: 'negotiation' };
  for (const status of ['sending', 'sent', 'skipped', 'cancelled', 'failed'] as const) {
    assert.deepEqual(housekeepLiveTasks({ tasks: [lite({ status })], activities: [moved], stages: STAGES, optoutKeys: new Set(), truncated: false }), []);
  }
  const within = new Date(Date.parse(hoursAgo(26)) + 4000).toISOString();
  const result = housekeepLiveTasks({ tasks: [lite()], activities: [activity({ lastStudioAt: within, lastCustomerAt: within })], stages: STAGES, optoutKeys: new Set(), truncated: false });
  assert.deepEqual(result, []);
});

// Envio

function taskRow(over: Partial<CadenceTaskRow> = {}): CadenceTaskRow {
  return {
    id: 7, user_id: 'u1', deal_id: 1, phone: PHONE, phone_key: PHONE_12, wa_number: '5511900000000', message: 'Oi!',
    stage_id: 'proposal', scheduled_at: hoursAgo(1), sent_at: null, status: 'sending', created_at: hoursAgo(3),
    contact_name: 'Cliente', attempts: 0, kind: 'cadence', step: 1, basis_at: hoursAgo(26), basis_message_id: 'wamid.studio',
    draft_text: 'Oi!', approved_at: hoursAgo(2), approved_by: 'owner', claimed_at: hoursAgo(0), claimed_by: 'w1',
    lease_expires_at: null, channel_used: null, sent_message_id: null, last_error: null, generation_meta: {},
    updated_at: hoursAgo(2), ...over,
  };
}

function snap(over: Partial<SendSnapshot> = {}): SendSnapshot {
  return {
    deal: { id: 1, stage: 'proposal', converted: false, converted_job_id: null, contact_name: 'Cliente' },
    stages: STAGES, lastCustomerAt: hoursAgo(30), lastStudioAt: hoursAgo(26), lastInvisibleOutAt: null,
    optedOut: false, alreadyCustomer: false, needsHuman: false,
    conversationPhone: PHONE, conversationWaNumber: '5511900000000', seenBaileysPhones: [], ...over,
  };
}

const STATE: FollowUpRuntimeState = parseCadenceConfig(null).state;
const decide = (t: Partial<CadenceTaskRow> = {}, s: Partial<SendSnapshot> = {}, c: Partial<FollowUpConfig> = {},
  st: Partial<FollowUpRuntimeState> = {}, now = NOW) => shouldCancelBeforeSend(taskRow(t), snap(s), { ...CONFIG, ...c }, { ...STATE, ...st }, now);
const deal = snap().deal!;

test('shouldCancelBeforeSend: cada motivo', () => {
  assert.deepEqual(decide(), { action: 'send' });
  assert.deepEqual(decide({}, { deal: null }), { action: 'cancel', reason: 'deal_missing' });
  assert.deepEqual(decide({}, { deal: { ...deal, converted: true } }), { action: 'cancel', reason: 'deal_closed' });
  assert.deepEqual(decide({}, { deal: { ...deal, converted_job_id: 55 } }), { action: 'cancel', reason: 'deal_closed' });
  assert.deepEqual(decide({ stage_id: 'won' }, { deal: { ...deal, stage: 'won' } }), { action: 'cancel', reason: 'deal_closed' });
  assert.deepEqual(decide({}, { alreadyCustomer: true }), { action: 'cancel', reason: 'already_customer' });
  assert.deepEqual(decide({}, { optedOut: true }), { action: 'cancel', reason: 'optout' });
  assert.deepEqual(decide({}, { deal: { ...deal, stage: 'negotiation' } }), { action: 'cancel', reason: 'stage_changed' });
  assert.deepEqual(decide({}, { lastCustomerAt: hoursAgo(1) }), { action: 'cancel', reason: 'customer_replied' });
  assert.deepEqual(decide({}, { lastStudioAt: hoursAgo(1) }), { action: 'cancel', reason: 'studio_spoke' });
  assert.deepEqual(decide({}, { lastInvisibleOutAt: hoursAgo(1) }), { action: 'cancel', reason: 'studio_spoke' });
  assert.deepEqual(decide({}, { needsHuman: true }), { action: 'cancel', reason: 'needs_human' });
  assert.deepEqual(decide({}, {}, { enabled: false }), { action: 'hold', reason: 'disabled' });
  assert.deepEqual(decide({}, {}, {}, { paused_at: hoursAgo(1) }), { action: 'hold', reason: 'paused' });
  assert.deepEqual(decide({}, {}, {}, {}, new Date('2026-09-18T23:30:00.000Z')), { action: 'hold', reason: 'outside_hours' });
  assert.deepEqual(decide({ approved_at: hoursAgo(73) }), { action: 'stale', reason: 'stale_approval' });
  assert.deepEqual(decide({ approved_at: null, updated_at: hoursAgo(73) }), { action: 'stale', reason: 'stale_approval' });
  assert.deepEqual(decide({ approved_at: hoursAgo(71) }), { action: 'send' });
  assert.equal(STALE_APPROVAL_HOURS, 72);
});

test('shouldCancelBeforeSend: cancelamento vence espera, e a primeira regra vence', () => {
  const night = new Date('2026-09-18T23:30:00.000Z');
  assert.deepEqual(decide({}, { lastCustomerAt: hoursAgo(1) }, {}, {}, night), { action: 'cancel', reason: 'customer_replied' });
  assert.deepEqual(decide({}, { needsHuman: true }, { enabled: false }), { action: 'cancel', reason: 'needs_human' });
  assert.deepEqual(decide({ approved_at: hoursAgo(100) }, {}, { enabled: false }), { action: 'hold', reason: 'disabled' });
  assert.deepEqual(decide({}, { deal: null, optedOut: true, alreadyCustomer: true }), { action: 'cancel', reason: 'deal_missing' });
  assert.deepEqual(decide({}, { optedOut: true, deal: { ...deal, stage: 'negotiation' } }), { action: 'cancel', reason: 'optout' });
  const within = new Date(Date.parse(hoursAgo(26)) + 4000).toISOString();
  assert.deepEqual(decide({}, { lastCustomerAt: within, lastStudioAt: within }), { action: 'send' });
});

test('resolveExpiredLease só marca enviado com prova', () => {
  const proof = { message_ids: ['wamid.1'], delivered_text: 'Oi!', channel: 'meta_text' as const };
  assert.equal(resolveExpiredLease(taskRow({ generation_meta: { delivery: proof } })), 'mark_sent');
  assert.equal(resolveExpiredLease(taskRow({ generation_meta: { delivery: { ...proof, message_ids: [] } } })), 'block');
  assert.equal(resolveExpiredLease(taskRow({ generation_meta: {} })), 'block');
  assert.equal(resolveExpiredLease(taskRow({ generation_meta: null as unknown as CadenceTaskRow['generation_meta'] })), 'block');
});

test('nextErrorState e customerSpokeAfter', () => {
  assert.deepEqual(nextErrorState(2, 'ok', 3), { consecutive: 0, pause: false });
  assert.deepEqual(nextErrorState(1, 'error', 3), { consecutive: 2, pause: false });
  assert.deepEqual(nextErrorState(2, 'error', 3), { consecutive: 3, pause: true });
  assert.deepEqual(nextErrorState(-4, 'error', 1), { consecutive: 1, pause: true });
  assert.equal(customerSpokeAfter(hoursAgo(10), null), false);
  assert.equal(customerSpokeAfter(hoursAgo(10), hoursAgo(9)), true);
  assert.equal(customerSpokeAfter(hoursAgo(10), new Date(Date.parse(hoursAgo(10)) + 5000).toISOString()), false);
  assert.equal(customerSpokeAfter(hoursAgo(10), hoursAgo(11)), false);
});

// Teto e rampa

test('effectiveDailyCap na rampa de 14 dias e fora dela', () => {
  const cfg = { ...CONFIG, daily_cap: 40 };
  assert.deepEqual(effectiveDailyCap(cfg, STATE, NOW), { cap: 40, warmupUntil: null });
  const first = '2026-09-10T12:00:00.000Z';
  assert.deepEqual(effectiveDailyCap(cfg, { ...STATE, first_enabled_at: first }, NOW), { cap: 10, warmupUntil: '2026-09-24T12:00:00.000Z' });
  assert.deepEqual(effectiveDailyCap({ ...cfg, daily_cap: 5 }, { ...STATE, first_enabled_at: first }, NOW), { cap: 5, warmupUntil: '2026-09-24T12:00:00.000Z' });
  assert.deepEqual(effectiveDailyCap(cfg, { ...STATE, first_enabled_at: first }, new Date('2026-09-24T12:00:00.000Z')), { cap: 40, warmupUntil: null });
});

// Config

test('parseCadenceConfig sem linha devolve padrão e estado vazio', () => {
  const parsed = parseCadenceConfig(null);
  assert.equal(parsed.exists, false);
  assert.deepEqual(parsed.config, DEFAULT_FOLLOWUP_CONFIG);
  assert.notEqual(parsed.config, DEFAULT_FOLLOWUP_CONFIG);
  parsed.config.ladder_stage_ids.push('x');
  assert.deepEqual(DEFAULT_FOLLOWUP_CONFIG.ladder_stage_ids, []);
  assert.deepEqual(parsed.state, {
    next_send_after: null, consecutive_errors: 0, paused_at: null, paused_reason: null, last_error: null,
    last_block_code: null, last_block_message: null, last_block_at: null, last_sweep_at: null, last_sweep_summary: null,
    first_enabled_at: null, external_ai_consent_at: null, external_ai_consent_by: null,
  });
});

test('parseCadenceConfig faz coerção e clamp nas faixas', () => {
  const { config, exists } = parseCadenceConfig({
    enabled: true, mode: 'turbo', ladder_stage_ids: [' proposal ', 'proposal', 'negotiation', '02-follow-up', '03-follow-up', 'x'],
    step_delays_hours: [0, 2000, 'x', 48, 12, 7], after_last_stage_id: ' 04-follow-up ',
    business_hours: '{"tz":"America/Sao_Paulo","days":[5,1,1],"start":"08:00","end":"18:00"}',
    daily_cap: 999, min_gap_seconds: 10, max_gap_seconds: 20, max_consecutive_errors: 0, allow_meta_text: 'sim',
    allow_baileys: true, template_id: '42', max_silence_hours: 5000, sweep_interval_minutes: 1, max_drafts_per_sweep: 100,
    extra_instructions: 'fale ###SKIP### curto', optout_detection: false, tracker_enabled: true, wa_number: '+55 (43) 91234-5678',
    tracker_config: null,
  });
  assert.equal(exists, true);
  assert.equal(config.mode, 'approval');
  assert.deepEqual(config.ladder_stage_ids, LADDER);
  assert.deepEqual(config.step_delays_hours, [1, 720, 48, 12]);
  assert.equal(config.after_last_stage_id, '04-follow-up');
  assert.deepEqual(config.business_hours, { tz: 'America/Sao_Paulo', days: [1, 5], start: '08:00', end: '18:00', holidays: [] });
  assert.equal(config.daily_cap, 200);
  assert.equal(config.min_gap_seconds, 30);
  assert.equal(config.max_gap_seconds, 30);
  assert.equal(config.max_consecutive_errors, 1);
  assert.equal(config.allow_meta_text, true);
  assert.equal(config.allow_baileys, true);
  assert.equal(config.template_id, 42);
  assert.equal(config.max_silence_hours, 2160);
  assert.equal(config.sweep_interval_minutes, 15);
  assert.equal(config.max_drafts_per_sweep, 60);
  assert.equal(config.extra_instructions, 'fale SKIP curto');
  assert.equal(config.optout_detection, false);
  assert.equal(config.wa_number, '5543912345678');
  assert.deepEqual(config.tracker_config, DEFAULT_TRACKER_CONFIG);
  const bad = parseCadenceConfig({ business_hours: { tz: 'Marte/Base', days: [1], start: '09:00', end: '19:00' }, step_delays_hours: 'x', wa_number: '123' });
  assert.deepEqual(bad.config.business_hours, DEFAULT_FOLLOWUP_CONFIG.business_hours);
  assert.deepEqual(bad.config.step_delays_hours, [24, 48, 72, 120]);
  assert.equal(bad.config.wa_number, null);
});

test('parseCadenceConfig: tracker_config com merge no padrão e só chaves conhecidas', () => {
  const { config } = parseCadenceConfig({
    tracker_config: {
      entry_stage_id: 'lead', contact_stage_id: 'contact', proposal_stage_id: null, promote_to_contact_from: ['lead', 'lead', 3],
      quote_keywords: 'orcamento', recreate_after_lost: 'sim', generic_pdf_is_quote: true,
      ignored_phones: ['+55 (43) 99999-1111', '123', '5543999991111'], desconhecida: 1,
    },
  });
  assert.deepEqual(config.tracker_config, {
    ...DEFAULT_TRACKER_CONFIG, entry_stage_id: 'lead', contact_stage_id: 'contact', proposal_stage_id: null,
    promote_to_contact_from: ['lead'], generic_pdf_is_quote: true, ignored_phones: ['5543999991111'],
  });
  assert.equal('desconhecida' in config.tracker_config, false);
});

test('parseCadenceConfig: estado vem das colunas com tipos saneados', () => {
  const { state } = parseCadenceConfig({
    next_send_after: '2026-09-18T15:00:00.500123+00:00', consecutive_errors: '-3', paused_at: 'lixo', paused_reason: 'sono',
    last_error: 'falhou', last_block_code: 'quality_not_green', last_block_message: 'Qualidade caiu', last_block_at: null,
    last_sweep_at: '2026-09-18T14:00:00+00:00', last_sweep_summary: { eligible: 3, generated: '2', finished_at: '2026-09-18T14:01:00Z' },
    first_enabled_at: '2026-09-10T12:00:00Z', external_ai_consent_at: '2026-09-11T12:00:00Z', external_ai_consent_by: 'owner-id',
  });
  assert.deepEqual(state, {
    next_send_after: '2026-09-18T15:00:00.500Z', consecutive_errors: 0, paused_at: null, paused_reason: null,
    last_error: 'falhou', last_block_code: 'quality_not_green', last_block_message: 'Qualidade caiu', last_block_at: null,
    last_sweep_at: '2026-09-18T14:00:00.000Z',
    last_sweep_summary: { eligible: 3, generated: 2, auto_approved: 0, ai_skipped: 0, handoffs: 0, already_drafted: 0,
      optouts_detected: 0, housekept: 0, errors: 0, finished_at: '2026-09-18T14:01:00.000Z' },
    first_enabled_at: '2026-09-10T12:00:00.000Z', external_ai_consent_at: '2026-09-11T12:00:00.000Z', external_ai_consent_by: 'owner-id',
  });
});

const CTX = { stages: STAGES, eligibleTemplateIds: new Set([99]), confirmAuto: false, dedupeMigrationReady: false };
const PITORI_PATCH = {
  enabled: true, ladder_stage_ids: LADDER, step_delays_hours: [24, 48, 72, 120], after_last_stage_id: '04-follow-up',
  template_id: 99, wa_number: '5543900000000',
  tracker_config: { entry_stage_id: 'lead', contact_stage_id: 'contact', proposal_stage_id: 'proposal',
    promote_to_contact_from: ['lead'], promote_to_proposal_from: ['lead', 'contact'], ignored_phones: ['5543900000001'] },
  confirm_auto: false, consent_to_external_ai: true, disable_legacy_on_ladder: true,
};

function errorsOf(patch: Record<string, unknown>, ctx: Partial<typeof CTX> = {}) {
  const result = validateConfigInput(DEFAULT_FOLLOWUP_CONFIG, patch, { ...CTX, ...ctx });
  assert.equal(result.ok, false, `esperava erro para ${JSON.stringify(patch)}`);
  return result.ok ? {} : result.errors;
}

test('validateConfigInput aceita a config da Pitori e ignora chaves de controle', () => {
  const result = validateConfigInput(DEFAULT_FOLLOWUP_CONFIG, PITORI_PATCH, CTX);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.config.ladder_stage_ids, LADDER);
  assert.equal(result.config.after_last_stage_id, '04-follow-up');
  assert.equal(result.config.template_id, 99);
  assert.equal(result.config.tracker_config.contact_stage_id, 'contact');
  assert.deepEqual(result.config.tracker_config.quote_keywords, DEFAULT_TRACKER_CONFIG.quote_keywords);
  assert.equal('confirm_auto' in result.config, false);
  assert.deepEqual(result.warnings, ['Com o 1º passo em 24h ou mais, quase sempre fora da janela grátis: sai por template ou QR.']);
});

test('validateConfigInput rejeita escada inválida', () => {
  assert.match(errorsOf({ ladder_stage_ids: ['proposal', 'won'] }).ladder_stage_ids, /Etapa final/);
  assert.match(errorsOf({ ladder_stage_ids: ['prod-agendado'] }).ladder_stage_ids, /funil de vendas/);
  assert.match(errorsOf({ ladder_stage_ids: ['proposal', 'proposal'] }).ladder_stage_ids, /repetir/);
  assert.match(errorsOf({ ladder_stage_ids: [...LADDER, '04-follow-up'] }).ladder_stage_ids, /no máximo 4/);
  assert.match(errorsOf({ ladder_stage_ids: ['negotiation', 'proposal'] }).ladder_stage_ids, /ordem do funil/);
  assert.match(errorsOf({ ladder_stage_ids: ['nao-existe'] }).ladder_stage_ids, /não encontrada/);
  assert.ok(errorsOf({ ladder_stage_ids: 'proposal' }).ladder_stage_ids);
});

test('validateConfigInput rejeita atrasos, intervalos e teto fora da faixa', () => {
  for (const delays of [[], [0], [721], [24.5], [24, 48, 72, 120, 200], 'x']) {
    assert.ok(errorsOf({ step_delays_hours: delays }).step_delays_hours, JSON.stringify(delays));
  }
  assert.ok(errorsOf({ min_gap_seconds: 200, max_gap_seconds: 100 }).max_gap_seconds);
  assert.ok(errorsOf({ max_gap_seconds: 1801 }).max_gap_seconds);
  assert.ok(errorsOf({ min_gap_seconds: 29 }).min_gap_seconds);
  assert.equal(errorsOf({ daily_cap: 0 }).daily_cap, 'Use um número inteiro de 1 a 200.');
  assert.ok(errorsOf({ daily_cap: 201 }).daily_cap);
  assert.ok(errorsOf({ max_consecutive_errors: 11 }).max_consecutive_errors);
  assert.ok(errorsOf({ max_silence_hours: 23 }).max_silence_hours);
  assert.ok(errorsOf({ sweep_interval_minutes: 14 }).sweep_interval_minutes);
  assert.ok(errorsOf({ max_drafts_per_sweep: 61 }).max_drafts_per_sweep);
  assert.ok(errorsOf({ enabled: 'sim' }).enabled);
});

test('validateConfigInput: template não elegível, QR sem 085, horário, número e instruções', () => {
  assert.equal(errorsOf({ template_id: 5 }).template_id, 'Escolha um template de marketing aprovado com {{1}} (nome) e {{2}} (mensagem).');
  assert.equal(errorsOf({ allow_baileys: true }).allow_baileys, 'Aplique a migration 085 antes de enviar pelo QR.');
  assert.ok(errorsOf({ business_hours: { tz: 'America/Sao_Paulo', days: [], start: '09:00', end: '19:00' } }).business_hours);
  assert.ok(errorsOf({ business_hours: { ...DEFAULT_FOLLOWUP_CONFIG.business_hours, start: '19:00', end: '09:00' } }).business_hours);
  assert.ok(errorsOf({ wa_number: '12345' }).wa_number);
  assert.ok(errorsOf({ extra_instructions: 'use ###SKIP###' }).extra_instructions);
  assert.ok(errorsOf({ extra_instructions: 'a'.repeat(1001) }).extra_instructions);
  const ok = validateConfigInput(DEFAULT_FOLLOWUP_CONFIG, { wa_number: '+55 (43) 90000-0000', template_id: null }, CTX);
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.config.wa_number, '5543900000000');
});

test('validateConfigInput: etapa depois do último passo', () => {
  const withLadder = (after: unknown) => ({ ladder_stage_ids: LADDER, after_last_stage_id: after });
  assert.ok(errorsOf(withLadder('03-follow-up')).after_last_stage_id);
  assert.ok(errorsOf(withLadder('contact')).after_last_stage_id);
  assert.ok(errorsOf(withLadder('lost')).after_last_stage_id);
  assert.ok(errorsOf(withLadder('prod-agendado')).after_last_stage_id);
  assert.equal(validateConfigInput(DEFAULT_FOLLOWUP_CONFIG, withLadder('aguardando-sinal'), CTX).ok, true);
  assert.equal(validateConfigInput(DEFAULT_FOLLOWUP_CONFIG, withLadder(null), CTX).ok, true);
});

test('validateConfigInput: modo automático exige confirmação só na troca', () => {
  const refused = validateConfigInput(DEFAULT_FOLLOWUP_CONFIG, { mode: 'auto' }, CTX);
  assert.equal(refused.ok, false);
  if (!refused.ok) {
    assert.equal(refused.autoConfirmRequired, true);
    assert.ok(refused.errors.mode);
  }
  assert.equal(validateConfigInput(DEFAULT_FOLLOWUP_CONFIG, { mode: 'auto' }, { ...CTX, confirmAuto: true }).ok, true);
  assert.equal(validateConfigInput({ ...DEFAULT_FOLLOWUP_CONFIG, mode: 'auto' }, { daily_cap: 30 }, CTX).ok, true);
  const invalid = validateConfigInput(DEFAULT_FOLLOWUP_CONFIG, { mode: 'turbo' }, CTX);
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.equal(invalid.autoConfirmRequired, false);
});

test('validateConfigInput: tracker_config em merge raso e erros por campo', () => {
  const current = { ...DEFAULT_FOLLOWUP_CONFIG, tracker_config: { ...DEFAULT_TRACKER_CONFIG, contact_stage_id: 'contact' } };
  const merged = validateConfigInput(current, { tracker_config: { proposal_stage_id: 'proposal', extra: 1 } }, CTX);
  assert.equal(merged.ok, true);
  if (merged.ok) {
    assert.equal(merged.config.tracker_config.contact_stage_id, 'contact');
    assert.equal(merged.config.tracker_config.proposal_stage_id, 'proposal');
    assert.equal('extra' in merged.config.tracker_config, false);
  }
  const bad = errorsOf({ tracker_config: { contact_stage_id: 'won', promote_to_proposal_from: ['prod-agendado'] } });
  assert.equal(bad['tracker_config.contact_stage_id'], 'Escolha uma etapa de venda aberta.');
  assert.ok(bad['tracker_config.promote_to_proposal_from']);
  assert.equal(bad.tracker_config, bad['tracker_config.contact_stage_id']);
  assert.ok(errorsOf({ tracker_config: { quote_keywords: ['x'.repeat(41)] } })['tracker_config.quote_keywords']);
  assert.ok(errorsOf({ tracker_config: { quote_exclusions: Array.from({ length: 31 }, (_, i) => `p${i}`) } })['tracker_config.quote_exclusions']);
  assert.ok(errorsOf({ tracker_config: { ignored_phones: ['123'] } })['tracker_config.ignored_phones']);
  assert.ok(errorsOf({ tracker_config: { recreate_after_lost: 'sim' } })['tracker_config.recreate_after_lost']);
  assert.ok(errorsOf({ tracker_config: 'x' }).tracker_config);
  const phones = validateConfigInput(DEFAULT_FOLLOWUP_CONFIG, { tracker_config: { ignored_phones: ['+55 (43) 90000-0001', '5543900000001'] } }, CTX);
  assert.equal(phones.ok, true);
  if (phones.ok) assert.deepEqual(phones.config.tracker_config.ignored_phones, ['5543900000001']);
});

test('validateConfigInput: avisos', () => {
  const noChannel = validateConfigInput(DEFAULT_FOLLOWUP_CONFIG, { ladder_stage_ids: LADDER.slice(0, 3), step_delays_hours: [12, 48] }, CTX);
  assert.equal(noChannel.ok, true);
  if (noChannel.ok) {
    assert.deepEqual(noChannel.warnings, [
      'Sem template aprovado e com o QR desligado: fora da janela de 24h nada sai.',
      'Passos sem atraso configurado ficam de fora.',
    ]);
  }
  const qr = validateConfigInput(DEFAULT_FOLLOWUP_CONFIG, { allow_baileys: true, step_delays_hours: [20] }, { ...CTX, dedupeMigrationReady: true });
  assert.equal(qr.ok, true);
  if (qr.ok) assert.deepEqual(qr.warnings, ['O envio pelo QR usa cliente não oficial. Mantenha o teto diário baixo.']);
});

test('validateConfigInput recusa corpo que não é objeto', () => {
  for (const patch of [null, 'x', [1], 3]) {
    const result = validateConfigInput(DEFAULT_FOLLOWUP_CONFIG, patch, CTX);
    assert.equal(result.ok, false);
  }
});

test('mensagens de validação sem travessão', () => {
  const all = { ...errorsOf({ ladder_stage_ids: ['won'], step_delays_hours: [], after_last_stage_id: 'x', daily_cap: 0,
    min_gap_seconds: 1, max_gap_seconds: 1, template_id: 1, allow_baileys: true, extra_instructions: '###', wa_number: '1',
    business_hours: {}, mode: 'x', tracker_config: { contact_stage_id: 'x', quote_keywords: 1, ignored_phones: 1 } }) };
  assert.ok(Object.keys(all).length >= 12);
  for (const message of Object.values(all)) assert.equal(/[–—]/.test(message), false, message);
  const source = readFileSync(new URL('./followup-cadence.ts', import.meta.url), 'utf8');
  assert.equal(/[–—]/.test(source), false);
});

// Sugestões

test('suggestLadder e suggestTrackerStages no funil da Pitori', () => {
  assert.deepEqual(suggestLadder(STAGES), {
    ladder_stage_ids: LADDER, step_delays_hours: [24, 48, 72, 120], after_last_stage_id: '04-follow-up',
  });
  assert.deepEqual(suggestTrackerStages(STAGES), { entry_stage_id: 'lead', contact_stage_id: 'contact', proposal_stage_id: 'proposal' });
});

test('suggestLadder em conta nova com ids proposal-<uuid>', () => {
  const uid = '0b7c1d2e-1111-4222-8333-944455556666';
  const fresh: StageRow[] = [
    stage(`lead-${uid}`, 'Lead Novo', 0),
    stage(`contact-${uid}`, 'Contato Feito', 1),
    stage(`proposal-${uid}`, 'Proposta Enviada', 2),
    stage(`negotiation-${uid}`, 'Em Negociação', 3),
    stage(`won-${uid}`, 'Fechado Ganho', 4, { is_final: true, is_won: true }),
    stage(`lost-${uid}`, 'Perdido', 5, { is_final: true }),
    stage(`prod-etapa-1-${uid}`, 'Etapa 1', 0, { process_id: `proc-1-${uid}` }),
  ];
  assert.deepEqual(suggestLadder(fresh), {
    ladder_stage_ids: [`proposal-${uid}`, `negotiation-${uid}`], step_delays_hours: [24, 48], after_last_stage_id: null,
  });
  assert.deepEqual(suggestTrackerStages(fresh), {
    entry_stage_id: `lead-${uid}`, contact_stage_id: `contact-${uid}`, proposal_stage_id: `proposal-${uid}`,
  });
});

test('suggestLadder em funil sem etapa de orçamento devolve escada vazia', () => {
  const plain = [stage('novo', 'Novo', 0), stage('atendimento', 'Atendimento', 1), stage('fechado', 'Fechado', 2, { is_final: true, is_won: true })];
  const suggestion = suggestLadder(plain);
  assert.deepEqual(suggestion.ladder_stage_ids, []);
  assert.equal(suggestion.after_last_stage_id, null);
  assert.deepEqual(suggestion.step_delays_hours, [24, 48, 72, 120]);
  assert.deepEqual(suggestTrackerStages(plain), { entry_stage_id: 'novo', contact_stage_id: null, proposal_stage_id: null });
  assert.deepEqual(suggestLadder([]).ladder_stage_ids, []);
});

// Pureza do módulo

test('o módulo só importa tipos e helpers puros permitidos', () => {
  assert.equal(LIVE_TASK_LOOKBACK_DAYS, 60);
  const source = readFileSync(new URL('./followup-cadence.ts', import.meta.url), 'utf8');
  const imports = [...source.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
  const allowed = new Set(['./src/features/followups/types.js', './lib/stage-rules.js', './lib/br-phone.js', './lib/business-hours.js']);
  assert.ok(imports.length > 0);
  for (const spec of imports) assert.ok(allowed.has(spec), spec);
  assert.equal(/Date\.now\(|new Date\(\)/.test(source), false);
});

// Trilha antes do orçamento

const PQ_CONFIG: FollowUpConfig = { ...CONFIG, pre_quote_stage_ids: ['contact'], pre_quote_delays_hours: [24, 72] };

// Conversa Iniciada: o cliente perguntou, o estúdio respondeu com uma pergunta e a conversa parou.
function pqActivity(over: Partial<DealActivity> = {}): DealActivity {
  return activity({
    dealId: 7, stage: 'contact', lastStudioType: 'text', lastStudioBody: 'Qual tipo de ensaio você procura?',
    lastStudioAt: hoursAgo(26), lastCustomerAt: hoursAgo(27), ...over,
  });
}

function pqSent(over: Partial<CadenceTaskLite> = {}): CadenceTaskLite {
  return lite({ id: 300, deal_id: 7, status: 'sent', step: 1, track: 'pre_quote', stage_id: 'contact',
    basis_at: hoursAgo(100), sent_at: hoursAgo(80), created_at: hoursAgo(81), ...over });
}

test('antes do orçamento: trilha por etapa, contagem de toques e atrasos', () => {
  assert.equal(trackForStage('contact', PQ_CONFIG), 'pre_quote');
  assert.equal(trackForStage('proposal', PQ_CONFIG), 'ladder');
  assert.equal(trackForStage('lead', PQ_CONFIG), null);
  assert.equal(trackForStage('contact', CONFIG), null, 'desligada por padrão');
  assert.equal(preQuoteStepCount(CONFIG), 0);
  assert.equal(preQuoteStepCount(PQ_CONFIG), 2);
  assert.equal(preQuoteStepCount({ ...PQ_CONFIG, pre_quote_delays_hours: [48] }), 1);
  assert.equal(preQuoteDelayHours(1, PQ_CONFIG), 24);
  assert.equal(preQuoteDelayHours(2, PQ_CONFIG), 72);
  assert.equal(preQuoteStepFor(0, PQ_CONFIG), 1);
  assert.equal(preQuoteStepFor(1, PQ_CONFIG), 2);
  assert.equal(preQuoteStepFor(2, PQ_CONFIG), null);
  assert.equal(advanceTargetFor({ track: 'pre_quote', step: 1 }, PQ_CONFIG), null, 'nunca move o card');
  assert.equal(advanceTargetFor({ track: 'ladder', step: 1 }, PQ_CONFIG), 'negotiation');
  assert.equal(advanceTargetFor({ step: 4 }, PQ_CONFIG), '04-follow-up', 'sem track = escada');
});

test('antes do orçamento: episódio conta só toques enviados depois da última fala do cliente, no mesmo telefone', () => {
  const tasks = [
    pqSent({ id: 1, sent_at: hoursAgo(50) }),
    pqSent({ id: 2, sent_at: hoursAgo(200) }),                        // antes da fala do cliente: episódio antigo
    pqSent({ id: 3, sent_at: hoursAgo(40), status: 'skipped' }),      // não saiu
    pqSent({ id: 4, sent_at: hoursAgo(30), phone: PHONE_B }),         // outro telefone
    lite({ id: 5, status: 'sent', step: 1, sent_at: hoursAgo(20) }),  // escada
    pqSent({ id: 6, sent_at: hoursAgo(10), phone: PHONE_12 }),        // mesmo número com 12 dígitos
  ];
  assert.equal(preQuoteSentInEpisode(tasks, canonicalPhoneKey(PHONE), hoursAgo(100)), 2);
  assert.equal(preQuoteSentInEpisode(tasks, canonicalPhoneKey(PHONE), null), 3);
  assert.equal(preQuoteSentInEpisode(tasks, canonicalPhoneKey(PHONE), hoursAgo(5)), 0, 'cliente respondeu: episódio novo');
});

test('antes do orçamento: deal em Conversa Iniciada com o estúdio por último entra no toque 1, sem próxima etapa', () => {
  const result = select([pqActivity()], { config: PQ_CONFIG });
  assert.equal(result.eligible.length, 1);
  const e = result.eligible[0];
  assert.equal(e.track, 'pre_quote');
  assert.equal(e.step, 1);
  assert.equal(e.stageId, 'contact');
  assert.equal(e.nextStageId, null);
  assert.equal(e.dueAt, new Date(Date.parse(hoursAgo(26)) + 24 * HOUR).toISOString());
});

test('antes do orçamento: cliente falou por último, cedo demais, desligada e cliente antigo ficam de fora', () => {
  assert.equal(reasonOf(select([pqActivity({ lastCustomerAt: hoursAgo(25) })], { config: PQ_CONFIG }), 7), 'customer_spoke_last');
  assert.equal(reasonOf(select([pqActivity({ lastStudioAt: hoursAgo(23) })], { config: PQ_CONFIG }), 7), 'too_soon');
  assert.equal(reasonOf(select([pqActivity()]), 7), 'stage_not_in_ladder', 'sem a trilha ligada');
  assert.equal(reasonOf(select([pqActivity({ alreadyCustomer: true })], { config: PQ_CONFIG }), 7), 'already_customer');
  assert.equal(reasonOf(select([pqActivity({ needsHuman: true })], { config: PQ_CONFIG }), 7), 'needs_human');
  assert.equal(reasonOf(select([pqActivity()], { config: PQ_CONFIG, optoutKeys: new Set([canonicalPhoneKey(PHONE)]) }), 7), 'optout');
  assert.equal(reasonOf(select([pqActivity({ lastStudioAt: hoursAgo(800), lastCustomerAt: hoursAgo(801) })], { config: PQ_CONFIG }), 7), 'too_old');
  assert.equal(reasonOf(select([pqActivity()], { config: PQ_CONFIG, liveLegacyDealIds: new Set([7]) }), 7), 'live_legacy_task');
  assert.equal(reasonOf(select([pqActivity()], { config: PQ_CONFIG, cadenceTasks: [lite({ deal_id: 9, phone: PHONE })] }), 7),
    'live_cadence_task', 'outro deal vivo do mesmo telefone');
  const onlyPreQuote = { ...PQ_CONFIG, ladder_stage_ids: [], after_last_stage_id: null };
  assert.equal(select([pqActivity()], { config: onlyPreQuote }).eligible.length, 1, 'trilha sozinha, sem escada');
});

test('antes do orçamento: toque 2 usa o próprio toque 1 como basis e o atraso de 72h; depois do 2 acabou', () => {
  const touch1 = pqSent({ basis_at: hoursAgo(120), sent_at: hoursAgo(73) });
  const a = pqActivity({ lastStudioAt: hoursAgo(73), lastCustomerAt: hoursAgo(130) });
  const second = select([a], { config: PQ_CONFIG, cadenceTasks: [touch1] });
  assert.equal(second.eligible[0]?.step, 2);
  assert.equal(second.eligible[0]?.track, 'pre_quote');
  assert.equal(reasonOf(select([pqActivity({ lastStudioAt: hoursAgo(71), lastCustomerAt: hoursAgo(130) })],
    { config: PQ_CONFIG, cadenceTasks: [touch1] }), 7), 'too_soon');
  const touch2 = pqSent({ id: 301, step: 2, basis_at: hoursAgo(73), sent_at: hoursAgo(1) });
  const done = select([pqActivity({ lastStudioAt: hoursAgo(1), lastCustomerAt: hoursAgo(130) })],
    { config: { ...PQ_CONFIG, pre_quote_delays_hours: [1, 1] }, cadenceTasks: [touch1, touch2], now: new Date(NOW.getTime() + 2 * HOUR) });
  assert.equal(reasonOf(done, 7), 'step_already_sent');
  const replied = select([pqActivity({ lastStudioAt: hoursAgo(30), lastCustomerAt: hoursAgo(31) })],
    { config: PQ_CONFIG, cadenceTasks: [touch1, { ...touch2, sent_at: hoursAgo(40) }] });
  assert.equal(replied.eligible[0]?.step, 1, 'cliente respondeu depois dos toques: conta do zero');
});

test('antes do orçamento: toque enviado não trava a escada e o episódio é por trilha', () => {
  const touch1 = pqSent({ basis_at: hoursAgo(26), sent_at: hoursAgo(26), step: 2 });
  const inLadder = select([activity({ dealId: 7 })], { cadenceTasks: [touch1] });
  assert.equal(inLadder.eligible[0]?.step, 1, 'passo 1 da escada mesmo com o toque 2 enviado');
  assert.equal(inLadder.eligible[0]?.track, 'ladder');
  const cancelledPq = pqSent({ status: 'cancelled', sent_at: null, basis_at: hoursAgo(26), step: 1 });
  assert.equal(select([activity({ dealId: 7 })], { cadenceTasks: [cancelledPq] }).eligible.length, 1, 'mesmo basis em outra trilha');
  const sameTrack = pqSent({ status: 'skipped', sent_at: null, basis_at: hoursAgo(26), step: 1 });
  assert.equal(reasonOf(select([pqActivity()], { config: PQ_CONFIG, cadenceTasks: [sameTrack] }), 7), 'episode_done');
});

test('antes do orçamento: faxina cancela quando o card saiu da etapa (ex.: foi para proposal)', () => {
  const draft = pqSent({ status: 'draft', sent_at: null, basis_at: hoursAgo(26) });
  const plan = housekeepLiveTasks({ tasks: [draft], activities: [activity({ dealId: 7 })], stages: STAGES, optoutKeys: new Set(), truncated: false });
  assert.deepEqual(plan, [{ id: 300, reason: 'stage_changed' }]);
});

test('validateConfigInput: etapas e atrasos antes do orçamento', () => {
  const ok = validateConfigInput(DEFAULT_FOLLOWUP_CONFIG, { ...PITORI_PATCH, pre_quote_stage_ids: ['contact'], pre_quote_delays_hours: [24, 72] }, CTX);
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.deepEqual(ok.config.pre_quote_stage_ids, ['contact']);
    assert.deepEqual(ok.config.pre_quote_delays_hours, [24, 72]);
  }
  const base = { ...PITORI_PATCH };
  assert.match(errorsOf({ ...base, pre_quote_stage_ids: ['lead', 'contact', 'lead'] }).pre_quote_stage_ids, /no máximo 2/);
  assert.match(errorsOf({ ...base, pre_quote_stage_ids: ['contact', 'contact'] }).pre_quote_stage_ids, /repetir/);
  assert.match(errorsOf({ ...base, pre_quote_stage_ids: ['won'] }).pre_quote_stage_ids, /abertas/);
  assert.match(errorsOf({ ...base, pre_quote_stage_ids: ['prod-agendado'] }).pre_quote_stage_ids, /abertas/);
  assert.match(errorsOf({ ...base, pre_quote_stage_ids: ['proposal'] }).pre_quote_stage_ids, /escada/);
  assert.match(errorsOf({ ...base, pre_quote_stage_ids: ['aguardando-sinal'] }).pre_quote_stage_ids, /antes da 1ª etapa/);
  assert.match(errorsOf({ ...base, pre_quote_stage_ids: ['nao-existe'] }).pre_quote_stage_ids, /não encontrada/);
  assert.match(errorsOf({ ...base, pre_quote_stage_ids: 'contact' }).pre_quote_stage_ids, /lista/);
  assert.match(errorsOf({ ...base, pre_quote_delays_hours: [] }).pre_quote_delays_hours, /1 ou 2/);
  assert.match(errorsOf({ ...base, pre_quote_delays_hours: [24, 48, 72] }).pre_quote_delays_hours, /1 ou 2/);
  assert.match(errorsOf({ ...base, pre_quote_delays_hours: [0] }).pre_quote_delays_hours, /1 a 720/);
  assert.match(errorsOf({ ...base, pre_quote_delays_hours: [24, 721] }).pre_quote_delays_hours, /1 a 720/);
  // Sem escada, qualquer etapa aberta serve.
  const noLadder = validateConfigInput(DEFAULT_FOLLOWUP_CONFIG, { pre_quote_stage_ids: ['aguardando-sinal'] }, CTX);
  assert.equal(noLadder.ok, true);
  const messages = Object.values(errorsOf({ ...base, pre_quote_stage_ids: ['won', 'won', 'x'], pre_quote_delays_hours: [] }));
  for (const message of messages) assert.equal(/[–—]/.test(message), false, message);
});

test('parseCadenceConfig: antes do orçamento com padrão, corte e clamp', () => {
  assert.deepEqual(parseCadenceConfig({}).config.pre_quote_stage_ids, []);
  assert.deepEqual(parseCadenceConfig({}).config.pre_quote_delays_hours, [24, 72]);
  const parsed = parseCadenceConfig({ pre_quote_stage_ids: ['contact', ' lead ', 'contact', 'x'], pre_quote_delays_hours: '[0, 900, 5]' }).config;
  assert.deepEqual(parsed.pre_quote_stage_ids, ['contact', 'lead']);
  assert.deepEqual(parsed.pre_quote_delays_hours, [1, 720]);
});

test('suggestPreQuote: etapa de contato antes da escada; sem contato, vazio', () => {
  assert.deepEqual(suggestPreQuote(STAGES), { pre_quote_stage_ids: ['contact'], pre_quote_delays_hours: [24, 72] });
  const plain = [stage('novo', 'Novo', 0), stage('fechado', 'Fechado', 2, { is_final: true, is_won: true })];
  assert.deepEqual(suggestPreQuote(plain), { pre_quote_stage_ids: [], pre_quote_delays_hours: [24, 72] });
  const contactAfter = [stage('proposal', 'Orçamento Enviado', 0), stage('contact', 'Conversa Iniciada', 3)];
  assert.deepEqual(suggestPreQuote(contactAfter).pre_quote_stage_ids, [], 'contato depois da escada não entra');
});

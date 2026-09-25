import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createCadenceSender, LEASE_SECONDS } from './followup-sender.js';
import type { CadenceSenderRepo, CadenceTaskPatch, OutboundRecord, SenderTransport } from './followup-sender.js';
import { approvalFor } from './followup-channel.js';
import type { CadenceTemplate, GraphResult, SenderChannelHealth } from './followup-channel.js';
import type { SendSnapshot } from './followup-cadence.js';
import { DEFAULT_FOLLOWUP_CONFIG } from './src/features/followups/types.js';
import type { CadenceTaskRow, FollowUpConfig, FollowUpRuntimeState, MoveInput, MoveResult } from './src/features/followups/types.js';
import { canonicalPhoneKey } from './lib/br-phone.js';
import { fixedTemplateBody, fixedTemplateName, renderFixedMessage } from './followup-fixed.js';
import type { StageRow } from './lib/stage-rules.js';

const HOUR = 3_600_000;
const MINUTE = 60_000;
// Sexta-feira, 12:00 em São Paulo: dentro do horário comercial padrão.
const T0 = new Date('2026-09-18T15:00:00.000Z');
const USER = 'user-1';
// Números fictícios.
const MAIN = '5543900001111';
const CUSTOMER = '5543911112222';
const CUSTOMER_JID = '554311112222';
const DASH_PATTERN = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);

const stage = (id: string, position: number, extra: Partial<StageRow> = {}): StageRow => ({
  id, name: id, position, is_final: false, is_won: false, process_id: null, ...extra,
});
const STAGES: StageRow[] = [
  stage('lead', 0), stage('contact', 1), stage('proposal', 2), stage('negotiation', 3), stage('02-follow-up', 4),
  stage('03-follow-up', 5), stage('04-follow-up', 6), stage('won', 7, { is_final: true, is_won: true }), stage('lost', 8, { is_final: true }),
];

const BASE_CONFIG: FollowUpConfig = {
  ...DEFAULT_FOLLOWUP_CONFIG, enabled: true,
  ladder_stage_ids: ['proposal', 'negotiation', '02-follow-up', '03-follow-up'], after_last_stage_id: '04-follow-up',
  max_consecutive_errors: 3,
};

const BASE_STATE: FollowUpRuntimeState = {
  next_send_after: null, consecutive_errors: 0, paused_at: null, paused_reason: null, last_error: null, last_block_code: null,
  last_block_message: null, last_block_at: null, last_sweep_at: null, last_sweep_summary: null, first_enabled_at: null,
  external_ai_consent_at: '2026-09-01T12:00:00.000Z', external_ai_consent_by: 'owner',
};

const TEMPLATE: CadenceTemplate = {
  id: 40, name: 'retomada_ensaio', language: 'pt_BR', bodyText: 'Oi, {{1}}! {{2}}', status: 'APPROVED',
  category: 'MARKETING', headerText: null, buttons: [],
};

type Over = { meta?: Partial<SenderChannelHealth['meta']>; baileys?: Partial<SenderChannelHealth['baileys']> } & Partial<Omit<SenderChannelHealth, 'meta' | 'baileys'>>;
function health(over: Over = {}): SenderChannelHealth {
  const { meta, baileys, ...rest } = over;
  return {
    meta: { configured: true, phoneNumberId: 'pnid-1', waNumber: MAIN, token: 'tok', tokenExpiresAt: null, operational: true, qualityRating: 'GREEN', ...meta },
    baileys: { status: 'close', waNumber: MAIN, paired: true, ...baileys },
    mainWaNumber: MAIN, preferredChannel: 'auto', dedupeReady: true, ...rest,
  };
}

let nextId = 1;
function task(over: Partial<CadenceTaskRow> = {}): CadenceTaskRow {
  const id = over.id ?? nextId++;
  const at = (h: number) => new Date(T0.getTime() - h * HOUR).toISOString();
  return {
    id, user_id: USER, deal_id: 100 + id, phone: CUSTOMER, phone_key: canonicalPhoneKey(CUSTOMER), wa_number: MAIN,
    message: 'Oi, Ana! Conseguiu dar uma olhada no orçamento do ensaio?', stage_id: 'proposal', scheduled_at: at(1),
    sent_at: null, status: 'approved', created_at: at(2), contact_name: 'Ana Souza', attempts: 0, kind: 'cadence', step: 1,
    basis_at: at(9), basis_message_id: 'wamid.basis', draft_text: null, approved_at: at(1), approved_by: 'owner',
    claimed_at: null, claimed_by: null, lease_expires_at: null, channel_used: null, sent_message_id: null, last_error: null,
    generation_meta: { approval: { channel_class: 'text', render: null, template_id: null } }, updated_at: at(1), ...over,
  };
}

interface Call { name: string; args: unknown[] }

function world(opts: {
  tasks?: CadenceTaskRow[]; config?: Partial<FollowUpConfig>; state?: Partial<FollowUpRuntimeState>; health?: SenderChannelHealth;
  template?: CadenceTemplate | null; snapshot?: (t: CadenceTaskRow, w: any) => Partial<SendSnapshot>; fixedTemplates?: CadenceTemplate[];
  graph?: GraphResult[]; baileysSend?: (text: string, w: any) => Promise<string>; graphSend?: () => Promise<GraphResult>;
  finishFails?: boolean; proofFails?: boolean;
} = {}) {
  const w: any = {
    now: new Date(T0), config: { ...BASE_CONFIG, ...opts.config }, state: { ...BASE_STATE, ...opts.state },
    tasks: (opts.tasks ?? []).map((t) => structuredClone(t)), health: opts.health ?? health(), template: opts.template ?? null,
    calls: [] as Call[], finishes: [] as Array<{ id: number; patch: CadenceTaskPatch }>, forced: [] as Array<{ id: number; patch: CadenceTaskPatch }>,
    states: [] as Array<Partial<FollowUpRuntimeState>>, outbound: [] as OutboundRecord[], graph: [] as Array<Record<string, unknown>>,
    baileys: [] as Array<{ jid: string; text: string }>, typing: [] as boolean[], sleeps: [] as number[], moves: [] as MoveInput[],
    advances: [] as Array<{ id: number; state: string; result: MoveResult | null }>, logs: [] as Array<{ event: string; data?: any }>,
    graphResults: [...(opts.graph ?? [])], msgSeq: 0,
  };
  const call = (name: string, ...args: unknown[]) => w.calls.push({ name, args });
  const find = (id: number) => w.tasks.find((t: CadenceTaskRow) => t.id === id) as CadenceTaskRow;
  const applyPatch = (t: CadenceTaskRow, patch: CadenceTaskPatch) => {
    const { release_claim, generation_meta_merge, ...fields } = patch;
    Object.assign(t, fields);
    if (generation_meta_merge) t.generation_meta = { ...t.generation_meta, ...generation_meta_merge };
    if (release_claim) Object.assign(t, { claimed_at: null, claimed_by: null, lease_expires_at: null });
  };
  const repo: CadenceSenderRepo = {
    async listActiveConfigs() {
      call('listActiveConfigs');
      if (!w.config.enabled || w.state.paused_at) return [];
      return [{ userId: USER, config: structuredClone(w.config), state: structuredClone(w.state) }];
    },
    async claim(userId, workerId, leaseSeconds, gapSeconds, dayStartIso) {
      call('claim', userId, workerId, leaseSeconds, gapSeconds, dayStartIso);
      const nowMs = w.now.getTime();
      const t = w.tasks.find((x: CadenceTaskRow) => Date.parse(x.scheduled_at) <= nowMs
        && (x.status === 'approved' || (x.status === 'sending' && Date.parse(String(x.lease_expires_at)) < nowMs)));
      if (!t) return null;
      t.generation_meta = { ...t.generation_meta, prev_status: t.status, prev_claimed_at: t.claimed_at };
      Object.assign(t, { status: 'sending', claimed_at: w.now.toISOString(), claimed_by: workerId,
        lease_expires_at: new Date(nowMs + leaseSeconds * 1000).toISOString(), attempts: t.attempts + 1 });
      return structuredClone(t);
    },
    async loadSendSnapshot(t, waNumbers) {
      call('loadSendSnapshot', t.id, waNumbers);
      const base: SendSnapshot = {
        deal: { id: t.deal_id, stage: t.stage_id, converted: false, converted_job_id: null, contact_name: t.contact_name },
        stages: STAGES, lastCustomerAt: new Date(T0.getTime() - 10 * HOUR).toISOString(), lastStudioAt: t.basis_at,
        lastInvisibleOutAt: null, optedOut: false, alreadyCustomer: false, needsHuman: false,
        conversationPhone: CUSTOMER, conversationWaNumber: MAIN, seenBaileysPhones: [],
      };
      return { ...base, ...(opts.snapshot ? opts.snapshot(t, w) : {}) };
    },
    async loadHealth() { call('loadHealth'); return w.health; },
    async loadTemplate(_u, id) { call('loadTemplate', id); return w.template; },
    async loadTemplateByName(_u, name) { call('loadTemplateByName', name); return (opts.fixedTemplates ?? []).find((t) => t.name === name) ?? null; },
    async recordDeliveryProof(t, proof) {
      call('recordDeliveryProof', t.id, proof);
      if (opts.proofFails) return false;
      const row = find(t.id);
      if (row.status !== 'sending' || row.claimed_at !== t.claimed_at) return false;
      row.generation_meta = { ...row.generation_meta, delivery: { ...proof, proof_at: w.now.toISOString() } };
      row.sent_message_id = proof.message_ids[0];
      return true;
    },
    async persistOutbound(r) { call('persistOutbound', r.messageId); w.outbound.push(r); },
    async finish(t, patch) {
      call('finish', t.id, patch.status);
      w.finishes.push({ id: t.id, patch });
      const row = find(t.id);
      if (opts.finishFails || row.status !== 'sending' || row.claimed_at !== t.claimed_at) return false;
      applyPatch(row, patch);
      return true;
    },
    async forceMarkSent(t, patch) { call('forceMarkSent', t.id); w.forced.push({ id: t.id, patch }); applyPatch(find(t.id), patch); },
    async listPendingAdvances(_u, nowIso) {
      call('listPendingAdvances');
      return w.tasks.filter((t: CadenceTaskRow) => t.status === 'sent' && t.generation_meta.advance?.state === 'pending'
        && Date.parse(t.generation_meta.advance.due_at) <= Date.parse(nowIso)).map((t: CadenceTaskRow) => structuredClone(t));
    },
    async markAdvance(t, state, result) {
      call('markAdvance', t.id, state, result);
      w.advances.push({ id: t.id, state, result });
      const row = find(t.id);
      row.generation_meta = { ...row.generation_meta, advance: { ...(row.generation_meta.advance as any), state, result } };
    },
    async updateState(_u, patch) { call('updateState', patch); w.states.push(patch); Object.assign(w.state, patch); },
  };
  const transport: SenderTransport = {
    async graphSend(phoneNumberId, token, payload) {
      call('graphSend', phoneNumberId, token);
      w.graph.push(payload);
      if (opts.graphSend) return opts.graphSend();
      return w.graphResults.shift() ?? { ok: true, messageId: `wamid.out${++w.msgSeq}` };
    },
    async baileysSendText(key, jid, text) {
      call('baileysSendText', key, jid);
      w.baileys.push({ jid, text });
      return opts.baileysSend ? opts.baileysSend(text, w) : `BAE5${++w.msgSeq}`;
    },
    async baileysTyping(_k, _j, on) { call('baileysTyping', on); w.typing.push(on); },
  };
  const sender = createCadenceSender({
    now: () => new Date(w.now), sleep: async (ms) => { w.sleeps.push(ms); }, random: () => 0.5, workerId: 'worker-1',
    repo, transport,
    funnel: { async moveDealStage(i) { call('moveDealStage'); w.moves.push(i); return 'moved'; } },
    log: (event, data) => w.logs.push({ event, data }),
  });
  w.sender = sender;
  w.names = () => w.calls.map((c: Call) => c.name);
  w.count = (name: string) => w.calls.filter((c: Call) => c.name === name).length;
  w.task = find;
  return w;
}

test('envia 1 por tick pela API oficial, com prova, histórico e avanço pendente', async () => {
  const w = world({ tasks: [task({ id: 1 }), task({ id: 2 })] });
  await w.sender.tick();
  assert.equal(w.count('claim'), 1);
  assert.equal(w.count('graphSend'), 1);
  const [claimCall] = w.calls.filter((c: Call) => c.name === 'claim');
  assert.equal(claimCall.args[2], LEASE_SECONDS);
  assert.equal(claimCall.args[3], 105);   // pickGapSeconds(60, 150, 0.5)
  assert.equal(claimCall.args[4], '2026-09-18T03:00:00.000Z');   // meia-noite em São Paulo
  assert.deepEqual(w.graph[0], {
    messaging_product: 'whatsapp', recipient_type: 'individual', to: CUSTOMER, type: 'text',
    text: { body: 'Oi, Ana! Conseguiu dar uma olhada no orçamento do ensaio?', preview_url: false },
  });
  const sent = w.task(1);
  assert.equal(sent.status, 'sent');
  assert.equal(sent.channel_used, 'meta_text');
  assert.equal(sent.sent_message_id, 'wamid.out1');
  assert.deepEqual(sent.generation_meta.delivery.message_ids, ['wamid.out1']);
  assert.equal(sent.generation_meta.delivery.recovered, false);
  assert.equal(sent.generation_meta.delivery.proof_at, T0.toISOString());
  assert.deepEqual(sent.generation_meta.advance, { state: 'pending', due_at: new Date(T0.getTime() + 15 * MINUTE).toISOString() });
  assert.equal(w.task(2).status, 'approved');
  assert.deepEqual(w.outbound, [{
    userId: USER, phone: CUSTOMER, waNumber: MAIN, messageId: 'wamid.out1',
    body: 'Oi, Ana! Conseguiu dar uma olhada no orçamento do ensaio?', channel: 'meta_text', timestampIso: T0.toISOString(),
  }]);
  assert.deepEqual(w.states.at(-1), { consecutive_errors: 0, last_block_code: null, last_block_message: null });
  assert.equal(w.moves.length, 0);
});

test('sem canal: não faz claim e grava o bloqueio da conta uma vez só', async () => {
  const w = world({ tasks: [task({ id: 1 })], health: health({ meta: { tokenExpiresAt: '2026-09-17T12:00:00.000Z' } }) });
  await w.sender.tick();
  await w.sender.tick();
  assert.equal(w.count('claim'), 0);
  assert.equal(w.count('graphSend'), 0);
  assert.equal(w.states.length, 1);
  assert.equal(w.states[0].last_block_code, 'meta_token_expired');
  assert.equal(w.states[0].last_block_message, 'Token da API oficial venceu em 17/09. Reconecte em Configurações > Integrações > WhatsApp.');
  assert.equal(w.task(1).status, 'approved');
});

test('cliente respondeu depois do basis: cancela sem encostar no WhatsApp', async () => {
  const w = world({ tasks: [task({ id: 1 })], snapshot: () => ({ lastCustomerAt: new Date(T0.getTime() - HOUR).toISOString() }) });
  assert.equal(await w.sender.runTenant(USER), 'cancelled');
  assert.equal(w.task(1).status, 'cancelled');
  assert.equal(w.task(1).last_error, 'cancel:customer_replied');
  assert.equal(w.task(1).generation_meta.cancel_reason, 'customer_replied');
  assert.equal(w.count('graphSend') + w.count('baileysSendText'), 0);
  assert.deepEqual(w.states.at(-1), { next_send_after: new Date(T0.getTime() + 5000).toISOString() });
});

function expiredLease(over: Partial<CadenceTaskRow>): CadenceTaskRow {
  return task({
    id: 1, status: 'sending', claimed_at: new Date(T0.getTime() - 10 * MINUTE).toISOString(),
    lease_expires_at: new Date(T0.getTime() - 5 * MINUTE).toISOString(), attempts: 1, ...over,
  });
}

test('lease vencido com prova: marca enviado sem chamar transporte', async () => {
  const proofAt = new Date(T0.getTime() - 9 * MINUTE).toISOString();
  const w = world({ tasks: [expiredLease({ generation_meta: { delivery: { message_ids: ['wamid.old'], delivered_text: 'Oi, Ana!', channel: 'meta_text', proof_at: proofAt } } })] });
  assert.equal(await w.sender.runTenant(USER), 'sent_recovered');
  const row = w.task(1);
  assert.equal(row.status, 'sent');
  assert.equal(row.sent_message_id, 'wamid.old');
  assert.equal(row.channel_used, 'meta_text');
  assert.equal(row.generation_meta.delivery.recovered, true);
  assert.equal(row.generation_meta.delivery.proof_at, proofAt);
  assert.equal(w.count('graphSend') + w.count('baileysSendText') + w.count('loadSendSnapshot'), 0);
});

test('lease vencido sem prova: bloqueia sem chamar transporte e conta erro', async () => {
  const w = world({ tasks: [expiredLease({})] });
  assert.equal(await w.sender.runTenant(USER), 'ambiguous');
  assert.equal(w.task(1).status, 'blocked');
  assert.equal(w.task(1).last_error, 'Envio interrompido. Confira a conversa antes de reenviar.');
  assert.equal(w.count('graphSend') + w.count('baileysSendText'), 0);
  assert.equal(w.state.consecutive_errors, 1);
});

test('timeout da Graph: bloqueia como ambíguo e não reenvia no tick seguinte', async () => {
  const w = world({ tasks: [task({ id: 1 })], graph: [{ ok: false, httpStatus: 0, code: null, message: 'timeout', ambiguous: true }] });
  await w.sender.tick();
  w.now = new Date(T0.getTime() + 10 * MINUTE);
  await w.sender.tick();
  assert.equal(w.count('graphSend'), 1);
  assert.equal(w.task(1).status, 'blocked');
  assert.equal(w.count('persistOutbound'), 0);
  assert.equal(w.state.consecutive_errors, 1);
});

test('a prova de cada balão é gravada antes do histórico; pausa entre balões', async () => {
  const w = world({ tasks: [task({ id: 1, message: 'Oi, Ana!\n\nConseguiu dar uma olhada no orçamento?' })] });
  await w.sender.tick();
  const order = w.names().filter((n: string) => ['graphSend', 'recordDeliveryProof', 'persistOutbound', 'finish'].includes(n));
  assert.deepEqual(order, ['graphSend', 'recordDeliveryProof', 'persistOutbound', 'graphSend', 'recordDeliveryProof', 'persistOutbound', 'finish']);
  const proofs = w.calls.filter((c: Call) => c.name === 'recordDeliveryProof').map((c: Call) => c.args[1]);
  assert.deepEqual(proofs[0], { message_ids: ['wamid.out1'], channel: 'meta_text', delivered_text: 'Oi, Ana!' });
  assert.deepEqual(proofs[1], { message_ids: ['wamid.out1', 'wamid.out2'], channel: 'meta_text',
    delivered_text: 'Oi, Ana!\n\nConseguiu dar uma olhada no orçamento?' });
  assert.deepEqual(w.sleeps, [2250]);
  assert.deepEqual(w.outbound.map((r: OutboundRecord) => r.body), ['Oi, Ana!', 'Conseguiu dar uma olhada no orçamento?']);
  assert.equal(w.task(1).sent_message_id, 'wamid.out1');
});

test('pausa a conta no 3º erro seguido', async () => {
  const fail: GraphResult = { ok: false, httpStatus: 500, code: 1, message: 'erro interno' };
  const w = world({ tasks: [task({ id: 1 }), task({ id: 2 }), task({ id: 3 }), task({ id: 4 })], graph: [fail, fail, fail, fail] });
  for (let i = 0; i < 4; i++) await w.sender.tick();
  assert.equal(w.count('graphSend'), 3);
  const counted = w.states.filter((s: any) => s.consecutive_errors !== undefined).map((s: any) => s.consecutive_errors);
  assert.deepEqual(counted, [1, 2, 3]);
  assert.equal(w.state.paused_reason, 'error_streak');
  assert.equal(w.state.paused_at, T0.toISOString());
  assert.equal(w.task(1).status, 'approved');
  assert.equal(w.task(1).scheduled_at, new Date(T0.getTime() + 5 * MINUTE).toISOString());
  assert.equal(w.task(1).last_error, 'Falha temporária no envio. Nova tentativa em 5 min.');
});

test('transitório na 3ª tentativa vira failed', async () => {
  const w = world({ tasks: [task({ id: 1, attempts: 2 })], graph: [{ ok: false, httpStatus: 502, code: null, message: 'bad gateway' }] });
  assert.equal(await w.sender.runTenant(USER), 'error_transient');
  assert.equal(w.task(1).status, 'failed');
  assert.equal(w.task(1).generation_meta.failure.code, null);
  assert.equal(w.state.consecutive_errors, 1);
});

test('janela fechou na Meta: volta para rascunho e não tenta template no mesmo ciclo', async () => {
  const w = world({
    tasks: [task({ id: 1 })], template: TEMPLATE, config: { template_id: 40 },
    graph: [{ ok: false, httpStatus: 400, code: 131047, message: 'Re-engagement message' }],
  });
  assert.equal(await w.sender.runTenant(USER), 'review');
  assert.equal(w.count('graphSend'), 1);
  assert.equal(w.graph[0].type, 'text');
  const row = w.task(1);
  assert.equal(row.status, 'draft');
  assert.equal(row.approved_at, null);
  assert.equal(row.last_error, 'A janela de 24h fechou. Revise a versão em template.');
  assert.equal(w.state.consecutive_errors, 0);
});

test('finish falha depois do envio: forceMarkSent com forced e aviso na conta', async () => {
  const w = world({ tasks: [task({ id: 1 })], finishFails: true });
  assert.equal(await w.sender.runTenant(USER), 'sent');
  assert.equal(w.forced.length, 1);
  assert.equal(w.forced[0].patch.generation_meta_merge?.delivery?.forced, true);
  assert.equal(w.task(1).status, 'sent');
  assert.deepEqual(w.states.at(-1), {
    consecutive_errors: 0, last_block_code: null, last_block_message: null,
    last_error: 'Um follow-up foi enviado enquanto a tarefa era editada. Confira a conversa.',
  });
});

test('prova recusada (lease perdida): para, registra o balão que saiu e marca enviado à força', async () => {
  const w = world({ tasks: [task({ id: 1, message: 'Oi, Ana!\n\nConseguiu ver?' })], proofFails: true });
  await w.sender.tick();
  assert.equal(w.count('graphSend'), 1);
  assert.equal(w.outbound.length, 1);
  assert.ok(w.logs.some((l: any) => l.event === 'cadence_lease_lost'));
  assert.equal(w.task(1).status, 'sent');
});

test('etapa só anda no advancePending, uma vez, 15 min depois do envio', async () => {
  const w = world({ tasks: [task({ id: 1 })] });
  await w.sender.tick();
  assert.equal(w.moves.length, 0);
  w.state.next_send_after = null;
  w.now = new Date(T0.getTime() + 14 * MINUTE);
  await w.sender.tick();
  assert.equal(w.moves.length, 0);
  w.now = new Date(T0.getTime() + 16 * MINUTE);
  await w.sender.tick();
  assert.equal(w.moves.length, 1);
  assert.deepEqual(w.moves[0], {
    userId: USER, dealId: 101, toStageId: 'negotiation', expectedFromStage: 'proposal', allowFrom: ['proposal'],
    reason: 'cadence_step', evidence: { task_id: 1, step: 1 },
  });
  assert.deepEqual(w.advances, [{ id: 1, state: 'done', result: 'moved' }]);
  await w.sender.tick();
  assert.equal(w.moves.length, 1);
});

test('passo 4 sem etapa depois do último: avanço fica skipped', async () => {
  const w = world({ tasks: [task({ id: 1, step: 4, stage_id: '03-follow-up' })], config: { after_last_stage_id: null } });
  await w.sender.tick();
  assert.equal(w.task(1).status, 'sent');
  assert.equal(w.task(1).generation_meta.advance.state, 'skipped');
  // Avanço que ficou pendente e a configuração mudou depois.
  const w2 = world({ config: { after_last_stage_id: null }, tasks: [task({
    id: 7, step: 4, stage_id: '03-follow-up', status: 'sent',
    generation_meta: { advance: { state: 'pending', due_at: new Date(T0.getTime() - MINUTE).toISOString() } },
  })] });
  await w2.sender.tick();
  assert.equal(w2.moves.length, 0);
  assert.deepEqual(w2.advances, [{ id: 7, state: 'skipped', result: null }]);
});

test('antes do orçamento: envia sem nunca mover o card, nem com avanço pendente antigo', async () => {
  const config = { pre_quote_stage_ids: ['contact'], pre_quote_delays_hours: [24, 72] };
  const w = world({ config, tasks: [task({ id: 1, track: 'pre_quote', step: 1, stage_id: 'contact',
    message: 'Oi, Ana! Me conta que tipo de ensaio você tem em mente?' })] });
  await w.sender.tick();
  assert.equal(w.task(1).status, 'sent');
  assert.equal(w.task(1).generation_meta.advance.state, 'skipped');
  w.state.next_send_after = null;
  w.now = new Date(T0.getTime() + 20 * MINUTE);
  await w.sender.tick();
  assert.equal(w.moves.length, 0);
  assert.equal(w.count('moveDealStage'), 0);
  // Mesmo que uma linha antiga tenha ficado com avanço pendente, a trilha não move.
  const w2 = world({ config, tasks: [task({ id: 8, track: 'pre_quote', step: 2, stage_id: 'contact', status: 'sent',
    generation_meta: { advance: { state: 'pending', due_at: new Date(T0.getTime() - MINUTE).toISOString() } } })] });
  await w2.sender.tick();
  assert.equal(w2.moves.length, 0);
  assert.deepEqual(w2.advances, [{ id: 8, state: 'skipped', result: null }]);
});

test('antes do orçamento: card saiu da etapa (foi para proposal) cancela com stage_changed', async () => {
  const w = world({ config: { pre_quote_stage_ids: ['contact'] }, tasks: [task({ id: 1, track: 'pre_quote', stage_id: 'contact' })],
    snapshot: (t) => ({ deal: { id: t.deal_id, stage: 'proposal', converted: false, converted_job_id: null, contact_name: t.contact_name } }) });
  assert.equal(await w.sender.runTenant(USER), 'cancelled');
  assert.equal(w.task(1).status, 'cancelled');
  assert.equal(w.task(1).last_error, 'cancel:stage_changed');
  assert.equal(w.count('graphSend') + w.count('baileysSendText') + w.count('moveDealStage'), 0);
});

test('aprovado como texto e agora só sai como template: volta para rascunho', async () => {
  const w = world({
    tasks: [task({ id: 1 })], template: TEMPLATE, config: { template_id: 40 },
    snapshot: () => ({ lastCustomerAt: new Date(T0.getTime() - 40 * HOUR).toISOString() }),
  });
  assert.equal(await w.sender.runTenant(USER), 'review');
  assert.equal(w.task(1).status, 'draft');
  assert.equal(w.task(1).last_error, 'Vai sair como template (fora da janela de 24h). Revise o texto final.');
  assert.equal(w.count('graphSend'), 0);
});

test('template aprovado com o mesmo texto renderizado: sai como template e o histórico guarda o texto final', async () => {
  const base = task({ id: 1 });
  const approval = approvalFor({ channel: 'meta_template', template: TEMPLATE, contactName: base.contact_name, text: base.message, step: 1 });
  const w = world({
    tasks: [{ ...base, generation_meta: { approval } }], template: TEMPLATE, config: { template_id: 40 },
    snapshot: () => ({ lastCustomerAt: new Date(T0.getTime() - 40 * HOUR).toISOString() }),
  });
  assert.equal(await w.sender.runTenant(USER), 'sent');
  assert.equal(w.graph[0].type, 'template');
  assert.deepEqual((w.graph[0].template as any).components[0].parameters[0], { type: 'text', text: 'Ana' });
  assert.equal(w.outbound[0].body, approval.render);
  assert.equal(w.task(1).channel_used, 'meta_template');
  assert.equal(w.task(1).generation_meta.delivery.delivered_text, approval.render);
});

test('QR: digitando, espera proporcional, JID sem o 9 para DDD 43', async () => {
  const w = world({
    tasks: [task({ id: 1 })], config: { allow_baileys: true },
    health: health({ baileys: { status: 'open' } }),
    snapshot: () => ({ lastCustomerAt: new Date(T0.getTime() - 40 * HOUR).toISOString() }),
  });
  assert.equal(await w.sender.runTenant(USER), 'sent');
  assert.deepEqual(w.typing, [true, false]);
  assert.deepEqual(w.baileys, [{ jid: CUSTOMER_JID, text: 'Oi, Ana! Conseguiu dar uma olhada no orçamento do ensaio?' }]);
  assert.equal(w.sleeps[0], Math.min(1200 + 35 * 'Oi, Ana! Conseguiu dar uma olhada no orçamento do ensaio?'.length, 6000));
  assert.equal(w.calls.find((c: Call) => c.name === 'baileysSendText').args[0], USER);
  assert.equal(w.task(1).channel_used, 'baileys');
  assert.equal(w.count('graphSend'), 0);
});

test('QR caiu no envio: volta para a fila e conta erro; timeout do QR é ambíguo', async () => {
  const offline = world({
    tasks: [task({ id: 1 })], config: { allow_baileys: true }, health: health({ baileys: { status: 'open' } }),
    snapshot: () => ({ lastCustomerAt: new Date(T0.getTime() - 40 * HOUR).toISOString() }),
    baileysSend: async () => { throw new Error('WhatsApp não conectado. Escaneie o QR Code primeiro.'); },
  });
  assert.equal(await offline.sender.runTenant(USER), 'error_baileys_offline');
  assert.equal(offline.task(1).status, 'approved');
  assert.equal(offline.state.consecutive_errors, 1);
  const timeout = world({
    tasks: [task({ id: 1 })], config: { allow_baileys: true }, health: health({ baileys: { status: 'open' } }),
    snapshot: () => ({ lastCustomerAt: new Date(T0.getTime() - 40 * HOUR).toISOString() }),
    baileysSend: async () => { throw new Error('BAILEYS_TIMEOUT'); },
  });
  assert.equal(await timeout.sender.runTenant(USER), 'ambiguous');
  assert.equal(timeout.task(1).status, 'blocked');
});

test('segundo balão falha: conta como enviado com o que saiu', async () => {
  const w = world({
    tasks: [task({ id: 1, message: 'Oi, Ana!\n\nConseguiu ver?' })],
    graph: [{ ok: true, messageId: 'wamid.a' }, { ok: false, httpStatus: 500, code: null, message: 'x' }],
  });
  assert.equal(await w.sender.runTenant(USER), 'sent');
  assert.deepEqual(w.task(1).generation_meta.delivery.message_ids, ['wamid.a']);
  assert.equal(w.task(1).generation_meta.delivery.delivered_text, 'Oi, Ana!');
  assert.equal(w.state.consecutive_errors, 0);
});

test('prazo de 120s por tarefa: para antes do próximo balão', async () => {
  const w = world({
    tasks: [task({ id: 1, message: 'Oi, Ana!\n\nConseguiu ver?' })], config: { allow_baileys: true },
    health: health({ baileys: { status: 'open' } }),
    snapshot: () => ({ lastCustomerAt: new Date(T0.getTime() - 40 * HOUR).toISOString() }),
    baileysSend: async (_text, ww) => { ww.now = new Date(ww.now.getTime() + 125_000); return 'BAE5-1'; },
  });
  assert.equal(await w.sender.runTenant(USER), 'sent');
  assert.equal(w.baileys.length, 1);
  assert.deepEqual(w.task(1).generation_meta.delivery.message_ids, ['BAE5-1']);
});

test('não entregável e marketing limitado viram failed sem contar erro; ritmo da Meta conta e espera 15 min', async () => {
  const undeliverable = world({ tasks: [task({ id: 1 })], graph: [{ ok: false, httpStatus: 400, code: 131026, message: 'x' }] });
  await undeliverable.sender.tick();
  assert.equal(undeliverable.task(1).status, 'failed');
  assert.equal(undeliverable.task(1).generation_meta.failure.code, 131026);
  assert.equal(undeliverable.state.consecutive_errors, 0);
  const capped = world({ tasks: [task({ id: 1 })], graph: [{ ok: false, httpStatus: 400, code: 131049, message: 'x' }] });
  await capped.sender.tick();
  assert.equal(capped.task(1).status, 'failed');
  assert.equal(capped.task(1).last_error, 'A Meta limitou marketing para este contato.');
  const rate = world({ tasks: [task({ id: 1 })], graph: [{ ok: false, httpStatus: 429, code: 130429, message: 'x' }] });
  await rate.sender.tick();
  assert.equal(rate.task(1).status, 'approved');
  assert.equal(rate.state.next_send_after, new Date(T0.getTime() + 15 * MINUTE).toISOString());
  assert.equal(rate.state.consecutive_errors, 1);
});

test('token recusado pela Meta: volta para a fila, grava o bloqueio e conta erro', async () => {
  const w = world({ tasks: [task({ id: 1 })], graph: [{ ok: false, httpStatus: 401, code: 190, message: 'expired' }] });
  assert.equal(await w.sender.runTenant(USER), 'error_channel_auth');
  assert.equal(w.task(1).status, 'approved');
  assert.equal(w.state.last_block_code, 'meta_token_expired');
  assert.equal(w.state.consecutive_errors, 1);
});

test('aprovação velha volta para rascunho; fora do horário devolve e agenda a próxima abertura', async () => {
  const stale = world({ tasks: [task({ id: 1, approved_at: new Date(T0.getTime() - 73 * HOUR).toISOString() })] });
  assert.equal(await stale.sender.runTenant(USER), 'stale');
  assert.equal(stale.task(1).status, 'draft');
  assert.equal(stale.task(1).last_error, 'Aprovado há mais de 72h. Revise antes de enviar.');
  // O relógio passa das 19h entre o portão e a revalidação.
  const late = world({ tasks: [task({ id: 1 })], snapshot: (_t, w) => { w.now = new Date('2026-09-18T22:30:00.000Z'); return {}; } });
  assert.equal(await late.sender.runTenant(USER), 'hold_outside_hours');
  assert.equal(late.task(1).status, 'approved');
  assert.equal(late.state.next_send_after, '2026-09-19T12:00:00.000Z');   // sábado, 09:00 em São Paulo
});

test('aprovada no automático com a conta já em modo aprovação: volta para rascunho e não envia', async () => {
  const w = world({ tasks: [task({ id: 1, approved_by: 'auto' })], config: { mode: 'approval' } });
  assert.equal(await w.sender.runTenant(USER), 'review');
  assert.equal(w.task(1).status, 'draft');
  assert.equal(w.task(1).approved_by, null);
  assert.equal(w.task(1).last_error, 'O modo automático foi desligado. Revise antes de enviar.');
});

test('portão: pausado, fora do horário e ritmo não chegam ao claim', async () => {
  const pacing = world({ tasks: [task({ id: 1 })], state: { next_send_after: new Date(T0.getTime() + MINUTE).toISOString() } });
  assert.equal(await pacing.sender.runTenant(USER), 'pacing');
  const night = world({ tasks: [task({ id: 1 })] });
  night.now = new Date('2026-09-18T23:00:00.000Z');
  assert.equal(await night.sender.runTenant(USER), 'outside_hours');
  const paused = world({ tasks: [task({ id: 1 })], state: { paused_at: T0.toISOString(), paused_reason: 'manual' } });
  assert.equal(await paused.sender.runTenant(USER), 'inactive');
  for (const w of [pacing, night, paused]) assert.equal(w.count('claim'), 0);
});

test('conversa em outro número: bloqueia só a tarefa', async () => {
  const w = world({ tasks: [task({ id: 1 })], snapshot: () => ({ conversationWaNumber: '5511988887777' }) });
  assert.equal(await w.sender.runTenant(USER), 'blocked_task');
  assert.equal(w.task(1).status, 'blocked');
  assert.equal(w.task(1).generation_meta.block_code, 'number_mismatch');
});

test('erro ao carregar o snapshot: nada saiu, volta para a fila', async () => {
  const w = world({ tasks: [task({ id: 1 })], snapshot: () => { throw new Error('falha no banco 5543911112222'); } });
  assert.equal(await w.sender.runTenant(USER), 'error_transient');
  assert.equal(w.task(1).status, 'approved');
  const log = w.logs.find((l: any) => l.event === 'cadence_prepare_failed');
  assert.ok(!String(log.data.error).includes('5543911112222'));
  assert.equal(log.data.phone, '…2222');
});

test('kick não sobrepõe a mesma conta', async () => {
  let release: (r: GraphResult) => void = () => {};
  const pending = new Promise<GraphResult>((resolve) => { release = resolve; });
  const w = world({ tasks: [task({ id: 1 }), task({ id: 2 })], graphSend: () => pending });
  w.sender.kick(USER);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(w.count('graphSend'), 1);
  w.sender.kick(USER);
  await w.sender.tick();
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(w.count('claim'), 1);
  release({ ok: true, messageId: 'wamid.k' });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(w.task(1).status, 'sent');
});

test('uma conta com erro não derruba o tick das outras', async () => {
  const w = world({ tasks: [task({ id: 1 })] });
  const original = w.sender;
  assert.ok(original);
  w.health = null;   // loadHealth devolve lixo: tenantBlock lança dentro de runEntry
  await w.sender.tick();
  assert.ok(w.logs.some((l: any) => l.event === 'cadence_sender_tenant_failed'));
});

// Mensagens fixas (087)

const FIXED_TEXT = 'Oiiii [nome], tudo bem 🥰?\n\nVamos ver uma data para as suas fotos?';
const FIXED_REF = { source: FIXED_TEXT, template_name: fixedTemplateName(1, FIXED_TEXT) };
const FIXED_TEMPLATE: CadenceTemplate = {
  id: 77, name: FIXED_REF.template_name, language: 'pt_BR', bodyText: fixedTemplateBody(FIXED_TEXT), status: 'APPROVED',
  category: 'MARKETING', headerText: null, buttons: [],
};
const OUTSIDE = () => ({ lastCustomerAt: new Date(T0.getTime() - 40 * HOUR).toISOString() });
const TEXT_APPROVAL = { channel_class: 'text' as const, render: null, template_id: null };
// Aprovadas pelo automático: a conta precisa estar no automático para saírem.
const AUTO: Partial<FollowUpConfig> = { mode: 'auto' };

function fixedTask(over: Partial<CadenceTaskRow> = {}): CadenceTaskRow {
  const name = over.contact_name === undefined ? 'Ana Souza' : over.contact_name;
  const first = name ? name.split(' ')[0] : null;
  return task({
    contact_name: name, message: renderFixedMessage(FIXED_TEXT, first), approved_by: 'auto',
    generation_meta: { approval: TEXT_APPROVAL, fixed: FIXED_REF }, ...over,
  });
}

test('mensagem fixa dentro da janela: um balão só, exatamente o texto aprovado', async () => {
  const w = world({ config: { mode: 'auto', message_mode: 'fixed', fixed_messages: [FIXED_TEXT] }, tasks: [fixedTask({ id: 1 })] });
  assert.equal(await w.sender.runTenant(USER), 'sent');
  assert.equal(w.graph.length, 1);
  assert.deepEqual(w.graph[0].text, { body: 'Oiiii Ana, tudo bem 🥰?\n\nVamos ver uma data para as suas fotos?', preview_url: false });
  assert.equal(w.outbound[0].body, 'Oiiii Ana, tudo bem 🥰?\n\nVamos ver uma data para as suas fotos?');
  assert.equal(w.task(1).generation_meta.delivery.delivered_text, w.task(1).message);
  assert.equal(w.task(1).generation_meta.fixed_fallback, undefined, 'texto livre não é template');
  assert.equal(w.sleeps.length, 0, 'sem pausa entre balões');
});

test('mensagem fixa fora da janela: sai pelo template do passo com o primeiro nome e o texto final é o aprovado', async () => {
  const w = world({ config: AUTO, tasks: [fixedTask({ id: 1 })], fixedTemplates: [FIXED_TEMPLATE], snapshot: OUTSIDE });
  assert.equal(await w.sender.runTenant(USER), 'sent');
  assert.equal(w.graph[0].type, 'template');
  assert.deepEqual(w.graph[0].template, {
    name: FIXED_REF.template_name, language: { code: 'pt_BR' }, components: [{ type: 'body', parameters: [{ type: 'text', text: 'Ana' }] }],
  });
  assert.equal(w.outbound[0].body, w.task(1).message);
  assert.equal(w.task(1).generation_meta.delivery.delivered_text, w.task(1).message);
  assert.equal(w.task(1).generation_meta.fixed_fallback, false);
  assert.equal(w.task(1).channel_used, 'meta_template');
});

test('mensagem fixa fora da janela com o template do passo em análise: vai pelo template geral e marca a reserva', async () => {
  const w = world({
    tasks: [fixedTask({ id: 1 })], fixedTemplates: [{ ...FIXED_TEMPLATE, status: 'PENDING' }], template: TEMPLATE,
    config: { ...AUTO, template_id: 40 }, snapshot: OUTSIDE,
  });
  assert.equal(await w.sender.runTenant(USER), 'sent');
  assert.equal((w.graph[0].template as any).name, 'retomada_ensaio');
  assert.equal((w.graph[0].template as any).components[0].parameters[0].text, 'Ana');
  assert.equal(w.task(1).generation_meta.fixed_fallback, true);
  // Aprovado por uma pessoa como texto: a reserva muda o texto, então volta para revisão.
  const human = world({
    tasks: [fixedTask({ id: 2, approved_by: 'owner' })], fixedTemplates: [{ ...FIXED_TEMPLATE, status: 'PENDING' }], template: TEMPLATE,
    config: { template_id: 40 }, snapshot: OUTSIDE,
  });
  assert.equal(await human.sender.runTenant(USER), 'review');
  assert.equal(human.task(2).status, 'draft');
  assert.equal(human.count('graphSend'), 0);
});

test('mensagem fixa fora da janela sem template aprovado nem geral: só a tarefa espera, com o motivo', async () => {
  const w = world({ config: AUTO, tasks: [fixedTask({ id: 1 })], fixedTemplates: [{ ...FIXED_TEMPLATE, status: 'PENDING' }], snapshot: OUTSIDE });
  assert.equal(await w.sender.runTenant(USER), 'blocked_task');
  assert.equal(w.task(1).status, 'blocked');
  assert.equal(w.task(1).last_error, 'Template do Follow 01 aguardando aprovação da Meta.');
  assert.equal(w.task(1).generation_meta.block_code, 'fixed_template_pending');
  assert.equal(w.count('graphSend'), 0);
});

test('mensagem fixa sem o primeiro nome e template com {{1}}: bloqueia pedindo o nome no card', async () => {
  const w = world({ config: AUTO, tasks: [fixedTask({ id: 1, contact_name: null })], fixedTemplates: [FIXED_TEMPLATE], snapshot: OUTSIDE });
  assert.equal(await w.sender.runTenant(USER), 'blocked_task');
  assert.equal(w.task(1).last_error, 'Sem o nome do cliente para o template: complete o nome no card.');
  assert.equal(w.task(1).generation_meta.block_code, 'contact_name_missing');
  // Dentro da janela o texto sem nome sai normalmente.
  const inside = world({ config: AUTO, tasks: [fixedTask({ id: 2, contact_name: null })], fixedTemplates: [FIXED_TEMPLATE] });
  assert.equal(await inside.sender.runTenant(USER), 'sent');
  assert.equal(inside.outbound[0].body, 'Oiiii, tudo bem 🥰?\n\nVamos ver uma data para as suas fotos?');
});

test('mensagem fixa editada deixa de ser fixa: segue o fluxo normal do template geral', async () => {
  const edited = fixedTask({ id: 1, message: 'Oi, Ana! Texto que alguém editou.', approved_by: 'owner' });
  const w = world({ tasks: [edited], fixedTemplates: [FIXED_TEMPLATE], template: TEMPLATE, config: { template_id: 40 }, snapshot: OUTSIDE });
  assert.equal(await w.sender.runTenant(USER), 'review');
  assert.equal(w.task(1).last_error, 'Vai sair como template (fora da janela de 24h). Revise o texto final.');
});

test('mensagem fixa pelo QR: um balão só com o texto exato', async () => {
  const w = world({
    tasks: [fixedTask({ id: 1 })], config: { ...AUTO, allow_baileys: true }, health: health({ baileys: { status: 'open' } }), snapshot: OUTSIDE,
  });
  assert.equal(await w.sender.runTenant(USER), 'sent');
  assert.deepEqual(w.baileys, [{ jid: CUSTOMER_JID, text: 'Oiiii Ana, tudo bem 🥰?\n\nVamos ver uma data para as suas fotos?' }]);
});

test('código sem travessão e sem banco, rede, server.ts ou Baileys direto', () => {
  for (const file of ['followup-sender.ts', 'followup-sender.test.ts', 'followup-channel.ts']) {
    const source = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');
    assert.ok(!DASH_PATTERN.test(source), `${file} tem travessão`);
  }
  for (const file of ['followup-sender.ts', 'followup-channel.ts']) {
    const source = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');
    assert.ok(!/from '[^']*(supabase|server|baileys-manager)[^']*'/.test(source), file);
    assert.ok(!/\bfetch\(/.test(source), file);
    assert.ok(!/markConversationHumanActive/.test(source), file);
  }
});

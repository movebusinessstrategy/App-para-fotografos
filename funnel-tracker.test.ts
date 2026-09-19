import assert from 'node:assert/strict';
import test from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { brazilianPhoneVariants, canonicalPhoneKey, samePhone } from './lib/br-phone.js';
import type { StageRow } from './lib/stage-rules.js';
import {
  createFunnelTracker,
  createSupabaseFunnelRepo,
  decideFromHistory,
  decideFunnelActions,
  groupInbound,
  isBaileysBotMessage,
  parseFunnelConfig,
  pickDeal,
  type CasUpdateResult,
  type FunnelActivityEntry,
  type FunnelContext,
  type FunnelDealState,
  type FunnelDeps,
  type FunnelMessageEvent,
  type FunnelRepo,
  type OutboundHistoryRow,
} from './funnel-tracker.js';

// Números fictícios (nenhum dado real de cliente).
const USER = '11111111-1111-4111-8111-111111111111';
const ACTOR = '22222222-2222-4222-8222-222222222222';
const MAIN = '554300000001';
const POSVENDA = '554300000002';
const PHONE13 = '5543991112222';
const PHONE12 = '554391112222';
const NOW = '2026-09-19T12:05:00.000Z';
const AT = '2026-09-19T12:00:00.000Z';

const NAMES: Record<string, string> = {
  lead: 'Entrou em Contato', contact: 'Conversa Iniciada', proposal: 'Orçamento Enviado', negotiation: 'Negociação',
};

const stage = (id: string, position: number, extra: Partial<StageRow> = {}): StageRow => ({
  id, name: NAMES[id] ?? id, position, is_final: false, is_won: false, process_id: null, ...extra,
});

const STAGES: StageRow[] = [
  stage('prod-agendado', 0),
  stage('lost', 0, { is_final: true }),
  stage('won', 1, { is_final: true, is_won: true }),
  stage('lead', 1),
  stage('contact', 2),
  stage('proposal', 3),
  stage('negotiation', 4),
  stage('producao-x', 0, { process_id: 'proc-1' }),
];

function configRow(overrides: Record<string, unknown> = {}, tracker: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    user_id: USER, enabled: false, optout_detection: true, tracker_enabled: true, wa_number: MAIN,
    tracker_config: { entry_stage_id: null, contact_stage_id: 'contact', proposal_stage_id: 'proposal', ...tracker },
    ...overrides,
  };
}

const CFG = parseFunnelConfig(configRow(), STAGES);
const NO_MATERIALS = new Set<string>();
const MATERIALS = new Set(['gestante estudio pitori']);

function evt(overrides: Partial<FunnelMessageEvent> = {}): FunnelMessageEvent {
  return {
    userId: USER, waNumber: MAIN, slot: 'main', phone: PHONE13, messageId: 'wamid.in.1', occurredAt: AT,
    direction: 'in', origin: 'customer', provider: 'meta', type: 'text', body: 'Oi, quero saber do ensaio',
    filename: null, mimeType: null, contactName: 'Cliente Teste', isBot: false, ...overrides,
  };
}

const outEvt = (overrides: Partial<FunnelMessageEvent> = {}): FunnelMessageEvent => evt({
  direction: 'out', origin: 'human_app', messageId: 'wamid.out.1', body: 'Oi! Tudo bem?', contactName: null, ...overrides,
});

const quotePdf = (name = 'GESTANTE 2026 - ESTÚDIO PITORI..pdf'): Partial<FunnelMessageEvent> => ({
  type: 'document', filename: name, body: name, mimeType: 'application/pdf',
});

function deal(overrides: Partial<FunnelDealState> = {}): FunnelDealState {
  return {
    id: 10, stage: 'lead', converted: false, converted_job_id: null, current_stage_entered_at: '2026-09-19T11:00:00.000Z',
    contact_name: 'Cliente Teste', contact_phone: PHONE13, stage_history: [], title: 'Cliente Teste', ...overrides,
  };
}

function ctx(overrides: Partial<FunnelContext> = {}): FunnelContext {
  return { deal: null, allDealsLost: false, isExistingCustomer: false, isOwnOrIgnored: false, syntheticEcho: false, ...overrides };
}

const decide = (e: FunnelMessageEvent, c: FunnelContext, cfg = CFG, materials = NO_MATERIALS) => decideFunnelActions(e, c, STAGES, cfg, materials);
const ignoreReason = (actions: ReturnType<typeof decide>) => (actions.length === 1 && actions[0].kind === 'ignore' ? actions[0].reason : null);

// ════════════════════════════════════════════════════════════════════
// Parte pura
// ════════════════════════════════════════════════════════════════════
test('contato novo cria lead na 1ª etapa aberta, ignorando prod- e won/lost empatados', () => {
  assert.equal(CFG.entryStageId, 'lead');
  assert.deepEqual(decide(evt(), ctx()), [{ kind: 'create_deal', stageId: 'lead', title: 'Cliente Teste', contactName: 'Cliente Teste' }]);
  assert.deepEqual(decide(evt({ contactName: '   ' }), ctx()), [{ kind: 'create_deal', stageId: 'lead', title: PHONE13, contactName: null }]);
});

test('create_deal_on_inbound=false ou tracker desligado: não cria', () => {
  const noCreate = parseFunnelConfig(configRow({}, { create_deal_on_inbound: false }), STAGES);
  assert.equal(ignoreReason(decide(evt(), ctx(), noCreate)), 'create_disabled');
  const trackerOff = parseFunnelConfig(configRow({ tracker_enabled: false }), STAGES);
  assert.equal(ignoreReason(decide(evt(), ctx(), trackerOff)), 'create_disabled');
});

test('entrada em deal de proposal só cancela a cadência (entrada nunca move etapa)', () => {
  assert.deepEqual(decide(evt(), ctx({ deal: deal({ stage: 'proposal' }) })), [{ kind: 'cancel_cadence', reason: 'customer_replied' }]);
  assert.deepEqual(decide(evt(), ctx({ deal: deal({ stage: 'won' }) })), [{ kind: 'cancel_cadence', reason: 'customer_replied' }]);
});

test('reaction não conta; unsupported de entrada conta como fala do cliente, de saída não', () => {
  assert.equal(ignoreReason(decide(evt({ type: 'reaction' }), ctx({ deal: deal() }))), 'non_turn');
  assert.equal(ignoreReason(decide(evt({ type: 'revoke' }), ctx())), 'non_turn');
  assert.deepEqual(decide(evt({ type: 'unsupported', body: null }), ctx({ deal: deal() })), [{ kind: 'cancel_cadence', reason: 'customer_replied' }]);
  assert.equal(ignoreReason(decide(outEvt({ type: 'unsupported' }), ctx({ deal: deal() }))), 'non_turn');
});

test('saída de texto: lead vai para contact; contact fica', () => {
  assert.deepEqual(decide(outEvt(), ctx({ deal: deal() })), [{ kind: 'move', toStageId: 'contact', fromStageId: 'lead', reason: 'studio_reply' }]);
  assert.equal(ignoreReason(decide(outEvt(), ctx({ deal: deal({ stage: 'contact' }) }))), 'no_promotion');
  assert.equal(ignoreReason(decide(outEvt(), ctx({ deal: deal({ stage: 'proposal' }) }))), 'no_promotion');
});

test('PDF de orçamento: lead e contact vão para proposal; negotiation, ganho e convertido ficam', () => {
  const pdf = outEvt(quotePdf());
  assert.deepEqual(decide(pdf, ctx({ deal: deal() }), CFG, MATERIALS), [{ kind: 'move', toStageId: 'proposal', fromStageId: 'lead', reason: 'quote_sent' }]);
  assert.deepEqual(decide(pdf, ctx({ deal: deal({ stage: 'contact' }) }), CFG, MATERIALS), [{ kind: 'move', toStageId: 'proposal', fromStageId: 'contact', reason: 'quote_sent' }]);
  const keyword = outEvt(quotePdf('Orçamento ensaio newborn.pdf'));
  assert.equal(decide(keyword, ctx({ deal: deal({ stage: 'contact' }) }))[0].kind, 'move');
  assert.equal(ignoreReason(decide(pdf, ctx({ deal: deal({ stage: 'negotiation' }) }), CFG, MATERIALS)), 'no_promotion');
  assert.equal(ignoreReason(decide(pdf, ctx({ deal: deal({ stage: 'won' }) }), CFG, MATERIALS)), 'deal_closed');
  assert.equal(ignoreReason(decide(pdf, ctx({ deal: deal({ converted_job_id: 7 }) }), CFG, MATERIALS)), 'deal_closed');
  assert.equal(ignoreReason(decide(pdf, ctx({ deal: deal({ converted: true }) }), CFG, MATERIALS)), 'deal_closed');
  // Dicas não é orçamento: em lead vira só conversa iniciada.
  const tips = outEvt(quotePdf('DICAS GESTANTE.pdf'));
  assert.deepEqual(decide(tips, ctx({ deal: deal() }), CFG, MATERIALS)[0], { kind: 'move', toStageId: 'contact', fromStageId: 'lead', reason: 'studio_reply' });
  // quoteHint (PDF da Aurora) basta.
  assert.equal((decide(outEvt({ type: 'document', quoteHint: true, origin: 'agent' }), ctx({ deal: deal() }))[0] as { toStageId: string }).toStageId, 'proposal');
});

test('saída sem deal nunca cria lead', () => {
  assert.equal(ignoreReason(decide(outEvt(), ctx())), 'no_deal');
});

test('evento velho (antes de entrar na etapa, com 5s de folga) é ignorado', () => {
  const entered = deal({ current_stage_entered_at: AT });
  assert.equal(ignoreReason(decide(outEvt({ occurredAt: '2026-09-19T11:59:50.000Z' }), ctx({ deal: entered }))), 'stale_event');
  assert.equal(decide(outEvt({ occurredAt: '2026-09-19T11:59:57.000Z' }), ctx({ deal: entered }))[0].kind, 'move');
});

test('envio da própria cadência não move etapa', () => {
  assert.equal(ignoreReason(decide(outEvt({ origin: 'cadence' }), ctx({ deal: deal() }))), 'cadence');
});

test('IA oficial (meta_bot): eco sintético e contagem desligada ignoram; senão lead vai para contact', () => {
  const bot = outEvt({ origin: 'meta_bot', isBot: true, body: null });
  assert.equal(ignoreReason(decide(bot, ctx({ deal: deal(), syntheticEcho: true }))), 'synthetic_echo');
  const countOff = parseFunnelConfig(configRow({}, { count_bot_as_studio_reply: false }), STAGES);
  assert.equal(ignoreReason(decide(bot, ctx({ deal: deal() }), countOff)), 'meta_bot_ignored');
  assert.deepEqual(decide(bot, ctx({ deal: deal() })), [{ kind: 'move', toStageId: 'contact', fromStageId: 'lead', reason: 'studio_reply' }]);
});

test('config desligada, pós-venda e telefone fora de 10 a 13 dígitos são ignorados', () => {
  assert.equal(ignoreReason(decide(evt(), ctx(), parseFunnelConfig(null, STAGES))), 'disabled');
  const allOff = parseFunnelConfig(configRow({ tracker_enabled: false, optout_detection: false }), STAGES);
  assert.equal(ignoreReason(decide(evt(), ctx(), allOff)), 'disabled');
  assert.equal(ignoreReason(decide(evt({ slot: 'posvenda' }), ctx())), 'not_main_slot');
  assert.equal(ignoreReason(decide(evt({ phone: '55439911122223' }), ctx())), 'invalid_phone');
  assert.equal(ignoreReason(decide(evt({ phone: '439911122' }), ctx())), 'invalid_phone');
});

test('opt-out: registra e cancela, sem criar lead e sem cancelamento duplicado', () => {
  const stop = evt({ body: 'Por favor, parem de me mandar mensagem' });
  assert.deepEqual(decide(stop, ctx()).map((a) => a.kind), ['opt_out', 'cancel_cadence']);
  const withDeal = decide(stop, ctx({ deal: deal() }));
  assert.deepEqual(withDeal, [
    { kind: 'opt_out', optKind: 'hard', pattern: (withDeal[0] as { pattern: string }).pattern },
    { kind: 'cancel_cadence', reason: 'optout' },
  ]);
  const detectionOff = parseFunnelConfig(configRow({ optout_detection: false }), STAGES);
  assert.deepEqual(decide(stop, ctx({ deal: deal() }), detectionOff), [{ kind: 'cancel_cadence', reason: 'customer_replied' }]);
});

test('número próprio ou ignorado não vira lead', () => {
  assert.equal(ignoreReason(decide(evt(), ctx({ isOwnOrIgnored: true }))), 'own_number');
  assert.equal(ignoreReason(decide(outEvt(), ctx({ isOwnOrIgnored: true, deal: deal() }))), 'own_number');
});

test('só perdidos: mensagem anterior à perda (reentregue ou duplicada) não recria o lead', () => {
  const lostAfter = deal({ stage: 'lost', current_stage_entered_at: '2026-09-19T12:30:00.000Z' });
  assert.deepEqual(decide(evt(), ctx({ deal: lostAfter, allDealsLost: true })), [{ kind: 'cancel_cadence', reason: 'customer_replied' }]);
  const within = deal({ stage: 'lost', current_stage_entered_at: '2026-09-19T11:59:57.000Z' });
  assert.deepEqual(decide(evt(), ctx({ deal: within, allDealsLost: true })), [{ kind: 'cancel_cadence', reason: 'customer_replied' }]);
  const lostBefore = deal({ stage: 'lost', current_stage_entered_at: '2026-09-19T11:59:00.000Z' });
  assert.equal(decide(evt(), ctx({ deal: lostBefore, allDealsLost: true }))[0].kind, 'create_deal');
  assert.equal(decide(evt(), ctx({ deal: deal({ stage: 'lost', current_stage_entered_at: null as unknown as string }), allDealsLost: true }))[0].kind, 'create_deal');
});

test('cliente existente, só perdidos e só ganho', () => {
  assert.equal(ignoreReason(decide(evt(), ctx({ isExistingCustomer: true }))), 'existing_customer');
  const lost = deal({ stage: 'lost' });
  assert.equal(decide(evt(), ctx({ deal: lost, allDealsLost: true }))[0].kind, 'create_deal');
  const noRecreate = parseFunnelConfig(configRow({}, { recreate_after_lost: false }), STAGES);
  assert.deepEqual(decide(evt(), ctx({ deal: lost, allDealsLost: true }), noRecreate), [{ kind: 'cancel_cadence', reason: 'customer_replied' }]);
  assert.deepEqual(decide(evt(), ctx({ deal: deal({ stage: 'won' }) })), [{ kind: 'cancel_cadence', reason: 'customer_replied' }]);
  const skipOff = parseFunnelConfig(configRow({}, { skip_existing_customers: false }), STAGES);
  assert.equal(decide(evt(), ctx({ isExistingCustomer: true }), skipOff)[0].kind, 'create_deal');
});

test('parseFunnelConfig: id inválido vira null e as listas derivam de entrada e contato', () => {
  const cfg = parseFunnelConfig(configRow({}, {
    entry_stage_id: 'nao-existe', contact_stage_id: 'won', proposal_stage_id: 'prod-agendado',
  }), STAGES);
  assert.equal(cfg.contactStageId, null);
  assert.equal(cfg.proposalStageId, null);
  assert.equal(cfg.entryStageId, 'lead');
  assert.deepEqual(cfg.promoteToContactFrom, ['lead']);
  assert.deepEqual(cfg.promoteToProposalFrom, ['lead']);
  assert.equal(parseFunnelConfig(configRow({}, { contact_stage_id: 'producao-x' }), STAGES).contactStageId, null);

  assert.deepEqual(CFG.promoteToProposalFrom, ['lead', 'contact']);
  assert.deepEqual(CFG.keywords.slice(0, 2), ['orcamento', 'pacote']);
  assert.equal(CFG.countBotAsStudioReply, true);
  assert.equal(CFG.recreateAfterLost, true);
  assert.equal(CFG.skipExistingCustomers, true);

  const explicit = parseFunnelConfig(configRow({}, {
    entry_stage_id: 'lead', promote_to_contact_from: ['lead', 'won', 'x'], ignored_phones: ['(43) 9 0000-0003', '12'],
  }), STAGES);
  assert.deepEqual(explicit.promoteToContactFrom, ['lead']);
  assert.deepEqual(explicit.ignoredPhones, ['43900000003']);

  const asString = parseFunnelConfig({ tracker_enabled: true, tracker_config: JSON.stringify({ contact_stage_id: 'contact' }) }, STAGES);
  assert.equal(asString.contactStageId, 'contact');
  assert.equal(asString.optOutDetection, true);

  const none = parseFunnelConfig(null, STAGES);
  assert.equal(none.trackerEnabled || none.cadenceEnabled || none.optOutDetection, false);
});

test('pickDeal prefere o aberto mais recente e marca só perdidos', () => {
  const older = deal({ id: 1, current_stage_entered_at: '2026-09-01T00:00:00.000Z' });
  const newer = deal({ id: 2, current_stage_entered_at: '2026-09-10T00:00:00.000Z' });
  const won = deal({ id: 3, stage: 'won', current_stage_entered_at: '2026-09-15T00:00:00.000Z' });
  const lostA = deal({ id: 4, stage: 'lost', current_stage_entered_at: '2026-09-02T00:00:00.000Z' });
  const lostB = deal({ id: 5, stage: 'lost', current_stage_entered_at: '2026-09-03T00:00:00.000Z' });
  assert.deepEqual(pickDeal([older, won, newer], STAGES), { deal: newer, allDealsLost: false });
  assert.deepEqual(pickDeal([won, lostA], STAGES), { deal: won, allDealsLost: false });
  assert.deepEqual(pickDeal([lostA, lostB], STAGES), { deal: lostB, allDealsLost: true });
  assert.equal(pickDeal([deal({ stage: 'lost', converted: true })], STAGES).allDealsLost, false);
  assert.deepEqual(pickDeal([], STAGES), { deal: null, allDealsLost: false });
});

test('decideFromHistory: orçamento vence, falha e reação não contam', () => {
  const text: OutboundHistoryRow = { message_id: 'a', type: 'text', body: 'Oi', timestamp: '2026-09-19T11:10:00.000Z' };
  const pdf: OutboundHistoryRow = { message_id: 'b', type: 'document', body: 'Orçamento ensaio.pdf', timestamp: '2026-09-19T11:20:00.000Z' };
  assert.deepEqual(decideFromHistory(deal(), [text, pdf], STAGES, CFG, NO_MATERIALS), { toStageId: 'proposal', reason: 'quote_sent', row: pdf });
  assert.deepEqual(decideFromHistory(deal(), [text], STAGES, CFG, NO_MATERIALS), { toStageId: 'contact', reason: 'studio_reply', row: text });
  assert.equal(decideFromHistory(deal(), [{ ...text, status: 'failed' }, { ...text, type: 'reaction' }], STAGES, CFG, NO_MATERIALS), null);
  assert.equal(decideFromHistory(deal({ stage: 'won' }), [text, pdf], STAGES, CFG, NO_MATERIALS), null);
  assert.equal(decideFromHistory(deal({ stage: 'contact' }), [text], STAGES, CFG, NO_MATERIALS), null);
});

test('groupInbound agrupa por telefone canônico e descarta reação e telefone inválido', () => {
  const groups = groupInbound([
    { phone: PHONE13, timestamp: '2026-09-19T12:00:00.000Z', type: 'text' },
    { phone: PHONE12, timestamp: '2026-09-19T10:00:00.000Z', type: 'text' },
    { phone: '5543900001111', timestamp: '2026-09-19T11:00:00.000Z', type: 'reaction' },
    { phone: '123', timestamp: '2026-09-19T11:00:00.000Z', type: 'text' },
  ]);
  assert.deepEqual(groups, [{ key: canonicalPhoneKey(PHONE13), phone: PHONE13, first: '2026-09-19T10:00:00.000Z', last: '2026-09-19T12:00:00.000Z', count: 2 }]);
});

test('isBaileysBotMessage', () => {
  assert.equal(isBaileysBotMessage({ is1PBizBotMessage: true }), true);
  assert.equal(isBaileysBotMessage({ message: { messageContextInfo: { botMetadata: { x: 1 } } } }), true);
  assert.equal(isBaileysBotMessage({ message: { conversation: 'oi' } }), false);
  assert.equal(isBaileysBotMessage(null), false);
});

// ════════════════════════════════════════════════════════════════════
// Aplicador com repositório em memória
// ════════════════════════════════════════════════════════════════════
interface MemMessage { phone: string; wa_number?: string; message_id: string; type: string; body: string | null; timestamp: string; status?: string }
interface MemState {
  config: Record<string, unknown> | null; configError: Error | null; stages: StageRow[]; deals: FunnelDealState[];
  outbound: MemMessage[]; inbound: Array<{ phone: string; timestamp: string; type?: string }>;
  customerKeys: Set<string>; materialKeys: Set<string>; marketing: Set<string>; names: Map<string, string>;
  cancelResult: number | 'schema_missing'; echoNear: boolean; nextCas: CasUpdateResult | null;
}

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const clone = <T>(value: T): T => (value == null ? value : structuredClone(value));

function memoryRepo(init: Partial<MemState> = {}) {
  const state: MemState = {
    config: null, configError: null, stages: STAGES, deals: [], outbound: [], inbound: [], customerKeys: new Set(),
    materialKeys: NO_MATERIALS, marketing: new Set(), names: new Map(), cancelResult: 1, echoNear: false, nextCas: null, ...init,
  };
  const calls: Record<string, number> = {};
  const writes: Array<{ op: string; args: unknown[] }> = [];
  const count = (name: string) => { calls[name] = (calls[name] ?? 0) + 1; };
  const write = (op: string, args: unknown[]) => { count(op); writes.push({ op, args }); };
  let nextId = 100;

  const repo: FunnelRepo = {
    async loadConfigRow() { count('loadConfigRow'); await tick(); if (state.configError) throw state.configError; return clone(state.config); },
    async loadStages() { count('loadStages'); return state.stages; },
    async loadMaterialKeys() { count('loadMaterialKeys'); return state.materialKeys; },
    async loadCustomerKeys() { count('loadCustomerKeys'); return state.customerKeys; },
    async loadDeal(_userId, dealId) { count('loadDeal'); return clone(state.deals.find((d) => d.id === dealId)) ?? null; },
    async findDealsByPhone(_userId, variants, limit = 20) {
      count('findDealsByPhone');
      await tick();
      return state.deals.filter((d) => variants.includes(String(d.contact_phone))).slice(0, limit).map(clone);
    },
    async scanDealsByPhone(_userId, phone) { count('scanDealsByPhone'); return state.deals.filter((d) => samePhone(d.contact_phone, phone)).map(clone); },
    async insertDeal(row) {
      write('insertDeal', [row]);
      await tick();
      const id = nextId++;
      state.deals.push({
        id, stage: String(row.stage), converted: false, converted_job_id: null, current_stage_entered_at: String(row.current_stage_entered_at),
        contact_name: (row.contact_name as string | null) ?? null, contact_phone: String(row.contact_phone), stage_history: row.stage_history,
        title: String(row.title),
      });
      return { id };
    },
    async casUpdateStage(userId, dealId, expected, patch) {
      write('casUpdateStage', [userId, dealId, expected, patch]);
      if (state.nextCas) { const forced = state.nextCas; state.nextCas = null; return forced; }
      const target = state.deals.find((d) => d.id === dealId && d.stage === expected);
      if (!target) return 'no_rows';
      Object.assign(target, { stage: patch.stage, current_stage_entered_at: patch.current_stage_entered_at, stage_history: patch.stage_history });
      return 'ok';
    },
    async updateContactName(...args) { write('updateContactName', args); },
    async cancelCadenceByPhone(...args) { write('cancelCadenceByPhone', args); return state.cancelResult; },
    async upsertOptOut(...args) { write('upsertOptOut', args); return 'ok'; },
    async hasOutboundNear() { count('hasOutboundNear'); return state.echoNear; },
    async loadOutboundSince(_userId, variants, sinceIso, limit, waNumbers) {
      count('loadOutboundSince');
      return state.outbound
        .filter((m) => variants.includes(m.phone) && m.timestamp >= sinceIso && (!waNumbers || !m.wa_number || waNumbers.includes(m.wa_number)))
        .sort((a, b) => a.timestamp.localeCompare(b.timestamp)).slice(0, limit)
        .map(({ message_id, type, body, timestamp, status }) => ({ message_id, type, body, timestamp, status: status ?? 'sent' }));
    },
    async listDealsInStages(_userId, stageIds, limit) {
      count('listDealsInStages');
      return state.deals.filter((d) => stageIds.includes(d.stage) && !d.converted && d.converted_job_id == null).slice(0, limit).map(clone);
    },
    async listRecentInbound(_userId, _waNumbers, sinceIso) {
      count('listRecentInbound');
      return state.inbound.filter((m) => m.timestamp >= sinceIso).sort((a, b) => b.timestamp.localeCompare(a.timestamp)).map(clone);
    },
    async loadConversationNames(_userId, phones) {
      const keys = new Set(phones.map((p) => canonicalPhoneKey(p)));
      return new Map([...state.names].filter(([key]) => keys.has(key)));
    },
    async loadMarketingMappedStages() { count('loadMarketingMappedStages'); return state.marketing; },
    async logActivity(entry: FunnelActivityEntry) { write('logActivity', [entry]); },
  };
  const opsOf = (op: string) => writes.filter((w) => w.op === op);
  return { repo, state, calls, writes, opsOf };
}

// Cópia da trava de server.ts (acquireDealMutationLock).
function realLock() {
  const locks = new Map<string, Promise<void>>();
  const keys: string[] = [];
  const acquire = async (userId: string, keyPart: string | null): Promise<() => void> => {
    if (!keyPart) return () => {};
    keys.push(keyPart);
    const key = `${userId}:${keyPart}`;
    const previous = locks.get(key) || Promise.resolve();
    let unlock!: () => void;
    const current = new Promise<void>((resolve) => { unlock = resolve; });
    locks.set(key, current);
    await previous;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      unlock();
      if (locks.get(key) === current) locks.delete(key);
    };
  };
  return { acquire, keys };
}

function makeDeps(overrides: Partial<FunnelDeps> = {}) {
  const lock = realLock();
  const events = { recordStageEvent: [] as unknown[][], syncStageLabel: [] as unknown[][], warns: [] as unknown[][] };
  let nowMs = Date.parse(NOW);
  const deps: FunnelDeps = {
    phoneVariants: brazilianPhoneVariants,
    acquireLock: lock.acquire,
    recordStageEvent: async (...args) => { events.recordStageEvent.push(args); },
    syncStageLabel: (...args) => { events.syncStageLabel.push(args); },
    ownNumbers: async () => [MAIN, POSVENDA],
    now: () => new Date(nowMs),
    log: { warn: (...args: unknown[]) => { events.warns.push(args); }, log: () => {} },
    ...overrides,
  };
  return { deps, lock, events, advance: (ms: number) => { nowMs += ms; } };
}

function setup(init: Partial<MemState> = {}, depOverrides: Partial<FunnelDeps> = {}) {
  const mem = memoryRepo({ config: configRow(), ...init });
  const env = makeDeps(depOverrides);
  return { ...mem, ...env, tracker: createFunnelTracker(mem.repo, env.deps) };
}

const move = (overrides: Record<string, unknown> = {}) => ({
  userId: USER, dealId: 10, toStageId: 'contact', expectedFromStage: 'lead', reason: 'studio_reply' as const, ...overrides,
});

test('dois observe simultâneos do mesmo contato (12 e 13 dígitos) geram 1 insert', async () => {
  const t = setup();
  const [a, b] = await Promise.all([
    t.tracker.observe(evt({ phone: PHONE12, messageId: 'm1' })),
    t.tracker.observe(evt({ phone: PHONE13, messageId: 'm2' })),
  ]);
  assert.equal(t.opsOf('insertDeal').length, 1);
  assert.deepEqual(t.lock.keys, [`create:${PHONE13}`, `create:${PHONE13}`]);
  assert.deepEqual([a.created, b.created].sort(), [false, true]);
  assert.equal(a.dealId, b.dealId);
  assert.equal(t.tracker.stats().created, 1);
});

test('deal gravado com 12 dígitos e evento com 13: sem insert, só cancela', async () => {
  const t = setup({ deals: [deal({ id: 7, contact_phone: PHONE12 })] });
  const result = await t.tracker.observe(evt({ phone: PHONE13 }));
  assert.equal(t.opsOf('insertDeal').length, 0);
  assert.deepEqual(result.actions, ['cancel_cadence']);
  assert.equal(result.dealId, 7);
  assert.equal(t.calls.loadCustomerKeys, undefined);
});

test('formato antigo achado só pela varredura: sem insert', async () => {
  const t = setup({ deals: [deal({ id: 8, contact_phone: '(43) 99111-2222', contact_name: null, title: '43991112222' })] });
  const result = await t.tracker.observe(evt());
  assert.equal(t.opsOf('insertDeal').length, 0);
  assert.equal(result.created, false);
  assert.equal(result.dealId, 8);
  assert.deepEqual(t.opsOf('updateContactName')[0].args, [USER, 8, 'Cliente Teste', true]);
});

test('insert grava stage_history em ARRAY e contact_phone no formato do provedor', async () => {
  const t = setup();
  const result = await t.tracker.observe(evt({ phone: PHONE12 }));
  assert.equal(result.created, true);
  const row = t.opsOf('insertDeal')[0].args[0] as Record<string, unknown>;
  assert.equal(row.contact_phone, PHONE12);
  assert.equal(row.stage, 'lead');
  assert.equal(row.value, 0);
  assert.equal(row.user_id, USER);
  assert.ok(Array.isArray(row.stage_history));
  assert.deepEqual(row.stage_history, [{ stage_id: 'lead', stage_name: 'Entrou em Contato', entered_at: AT, left_at: null }]);
  assert.equal(row.current_stage_entered_at, AT);
  assert.equal(row.created_at, NOW);
});

test('cliente existente sem deal não vira lead; só perdidos com recreate vira', async () => {
  const customer = setup({ customerKeys: new Set([canonicalPhoneKey(PHONE13)]) });
  const skipped = await customer.tracker.observe(evt());
  assert.deepEqual(skipped.actions, ['ignore']);
  assert.equal(customer.opsOf('insertDeal').length, 0);

  const lostOnly = setup({ deals: [deal({ id: 3, stage: 'lost' })] });
  const recreated = await lostOnly.tracker.observe(evt());
  assert.equal(recreated.created, true);
  assert.equal(lostOnly.opsOf('insertDeal').length, 1);

  const lostLater = setup({ deals: [deal({ id: 5, stage: 'lost', current_stage_entered_at: '2026-09-19T12:30:00.000Z' })] });
  const old = await lostLater.tracker.observe(evt());
  assert.deepEqual(old.actions, ['cancel_cadence']);
  assert.equal(old.created, false);
  assert.equal(old.dealId, 5);
  assert.equal(lostLater.opsOf('insertDeal').length, 0);

  const wonOnly = setup({ deals: [deal({ id: 4, stage: 'won' })] });
  const kept = await wonOnly.tracker.observe(evt());
  assert.equal(kept.created, false);
  assert.equal(wonOnly.opsOf('insertDeal').length, 0);
});

test('número próprio, pós-venda e ignorado não consultam deals', async () => {
  const t = setup({ config: configRow({}, { ignored_phones: ['5543900000009'] }) });
  await t.tracker.observe(evt({ phone: POSVENDA }));
  await t.tracker.observe(evt({ phone: '5543900000009' }));
  await t.tracker.observe(evt({ phone: MAIN }));
  await t.tracker.observe(evt({ slot: 'posvenda' }));
  assert.equal(t.calls.findDealsByPhone, undefined);
  assert.equal(t.writes.length, 0);
});

test('moveDealStage: CAS sem linhas é conflict, sem evento e sem etiqueta', async () => {
  const t = setup({ deals: [deal()], nextCas: 'no_rows' });
  assert.equal(await t.tracker.moveDealStage(move()), 'conflict');
  assert.equal(t.events.recordStageEvent.length, 0);
  assert.equal(t.events.syncStageLabel.length, 0);
  assert.equal(t.opsOf('logActivity').length, 0);
  assert.equal(t.tracker.stats().failures, 0);
});

test('moveDealStage: erro no UPDATE (gatilho de marketing) é conflict e conta falha', async () => {
  const t = setup({ deals: [deal()], nextCas: { error: { code: 'P0001', message: 'MARKETING_FACT_IDEMPOTENCY_CONFLICT' } } });
  assert.equal(await t.tracker.moveDealStage(move()), 'conflict');
  assert.equal(t.tracker.stats().failures, 1);
  assert.equal(t.tracker.stats().lastError, 'P0001');
  assert.equal(t.events.recordStageEvent.length, 0);
  assert.equal(t.events.syncStageLabel.length, 0);
});

test('moveDealStage: grava histórico em array e chama evento e etiqueta uma vez', async () => {
  const history = JSON.stringify([{ stage_id: 'lead', stage_name: 'Entrou em Contato', entered_at: '2026-09-19T11:00:00.000Z', left_at: null }]);
  const t = setup({ deals: [deal({ stage_history: history })] });
  assert.equal(await t.tracker.moveDealStage(move({ evidence: { origin: 'meta_bot', message_id: 'x' } })), 'moved');
  assert.deepEqual(t.events.recordStageEvent, [[USER, 10, 'lead', 'contact', '2026-09-19T11:00:00.000Z']]);
  assert.equal(t.events.syncStageLabel.length, 1);
  assert.deepEqual(t.events.syncStageLabel[0].slice(0, 4), [USER, PHONE13, 'lead', 'contact']);
  const patch = t.opsOf('casUpdateStage')[0].args[3] as Record<string, unknown>;
  assert.deepEqual(Object.keys(patch).sort(), ['current_stage_entered_at', 'stage', 'stage_entered_at', 'stage_history', 'updated_at']);
  assert.deepEqual(patch.stage_history, [
    { stage_id: 'lead', stage_name: 'Entrou em Contato', entered_at: '2026-09-19T11:00:00.000Z', left_at: NOW },
    { stage_id: 'contact', stage_name: 'Conversa Iniciada', entered_at: NOW, left_at: null },
  ]);
  const activity = t.opsOf('logActivity')[0].args[0] as FunnelActivityEntry;
  assert.equal(activity.summary, 'Funil automático: Conversa Iniciada (IA oficial do WhatsApp respondeu)');
  assert.equal(activity.summary.includes('—'), false);
  assert.equal(activity.details.from, 'lead');
  assert.equal(t.tracker.stats().moved, 1);
});

test('moveDealStage recusa etapa fechada, para trás, allowFrom e convertido; noop e conflict', async () => {
  const t = setup({ deals: [deal(), deal({ id: 11, stage: 'proposal' }), deal({ id: 12, converted_job_id: 5 })] });
  assert.equal(await t.tracker.moveDealStage(move({ toStageId: 'won' })), 'refused');
  assert.equal(await t.tracker.moveDealStage(move({ dealId: 11, expectedFromStage: 'proposal' })), 'refused');
  assert.equal(await t.tracker.moveDealStage(move({ allowFrom: ['contact'] })), 'refused');
  assert.equal(await t.tracker.moveDealStage(move({ dealId: 12 })), 'refused');
  assert.equal(await t.tracker.moveDealStage(move({ toStageId: 'lead' })), 'noop');
  assert.equal(await t.tracker.moveDealStage(move({ dealId: 999 })), 'conflict');
  assert.equal(await t.tracker.moveDealStage(move({ expectedFromStage: 'contact', toStageId: 'proposal' })), 'conflict');
  assert.equal(t.opsOf('casUpdateStage').length, 0);
});

test('observe: saída move lead para contact com evidência do evento', async () => {
  const t = setup({ deals: [deal()] });
  const result = await t.tracker.observe(outEvt());
  assert.deepEqual(result.moved, { from: 'lead', to: 'contact' });
  assert.deepEqual(result.actions, ['move']);
  const activity = t.opsOf('logActivity')[0].args[0] as FunnelActivityEntry;
  assert.equal(activity.summary, 'Funil automático: Conversa Iniciada (o estúdio respondeu)');
  assert.equal(activity.details.message_id, 'wamid.out.1');
  assert.equal('body' in activity.details, false);
});

test('observe: IA oficial com eco sintético não move', async () => {
  const t = setup({ deals: [deal()], echoNear: true });
  const result = await t.tracker.observe(outEvt({ origin: 'meta_bot', body: null, isBot: true }));
  assert.equal(result.moved, null);
  assert.equal(t.calls.hasOutboundNear, 1);
  assert.equal(t.opsOf('casUpdateStage').length, 0);
});

test('observe: resposta da IA oficial pelo QR (botMetadata) promove, sem teste de eco', async () => {
  const t = setup({ deals: [deal()], echoNear: true });
  const result = await t.tracker.observe(outEvt({ origin: 'meta_bot', provider: 'baileys', isBot: true, messageId: 'ABCD1234' }));
  assert.deepEqual(result.moved, { from: 'lead', to: 'contact' });
  assert.equal(t.calls.hasOutboundNear, undefined);
});

test('cancelamento usa a chave canônica do telefone e o instante da fala', async () => {
  const t = setup({ deals: [deal({ stage: 'proposal' })] });
  await t.tracker.observe(evt({ phone: PHONE13 }));
  assert.deepEqual(t.opsOf('cancelCadenceByPhone')[0].args, [USER, canonicalPhoneKey(PHONE13), AT, 'customer_replied']);
  assert.equal(t.tracker.stats().cancelled, 1);
});

test('opt-out grava e cancela as vivas', async () => {
  const t = setup({ deals: [deal({ stage: 'proposal' })] });
  const result = await t.tracker.observe(evt({ body: 'Não tenho mais interesse, obrigada' }));
  assert.deepEqual(result.actions, ['opt_out', 'cancel_cadence']);
  const record = t.opsOf('upsertOptOut')[0].args[1] as Record<string, unknown>;
  assert.equal(record.kind, 'soft');
  assert.equal(record.dealId, 10);
  assert.equal(record.messageId, 'wamid.in.1');
  assert.equal(t.opsOf('cancelCadenceByPhone')[0].args[3], 'optout');
  assert.equal(t.tracker.stats().optouts, 1);
});

test('schema ausente no cancelamento não lança nem conta falha', async () => {
  const t = setup({ deals: [deal()], cancelResult: 'schema_missing' });
  const result = await t.tracker.observe(evt());
  assert.equal(result.error, undefined);
  assert.equal(t.tracker.stats().failures, 0);
  assert.equal(t.tracker.stats().cancelled, 0);
});

test('repo lançando: observe resolve com error e conta falha', async () => {
  const t = setup({ configError: Object.assign(new Error('boom 5543991112222'), { code: undefined }) });
  const result = await t.tracker.observe(evt());
  assert.ok(result.error);
  assert.equal(result.error?.includes('5543991112222'), false);
  assert.equal(t.tracker.stats().failures, 1);
  assert.equal(t.tracker.stats().observed, 1);

  const actionFails = setup({ deals: [deal()] });
  actionFails.repo.cancelCadenceByPhone = async () => { throw Object.assign(new Error('x'), { code: 'XX000' }); };
  const partial = await actionFails.tracker.observe(evt());
  assert.equal(partial.error, 'XX000');
  assert.equal(actionFails.tracker.stats().failures, 1);
});

test('eco anterior à entrada: cria o lead e já promove', async () => {
  const t = setup({ outbound: [{ phone: PHONE13, wa_number: MAIN, message_id: 'wamid.echo', type: 'text', body: 'Oi!', timestamp: '2026-09-19T11:59:00.000Z' }] });
  const result = await t.tracker.observe(evt());
  assert.equal(result.created, true);
  assert.deepEqual(result.moved, { from: 'lead', to: 'contact' });
  assert.equal(t.state.deals[0].stage, 'contact');

  const quote = setup({
    materialKeys: MATERIALS,
    outbound: [{ phone: PHONE13, message_id: 'wamid.pdf', type: 'document', body: 'GESTANTE 2026 - ESTÚDIO PITORI.pdf', timestamp: '2026-09-19T11:58:00.000Z' }],
  });
  const quoted = await quote.tracker.observe(evt());
  assert.deepEqual(quoted.moved, { from: 'lead', to: 'proposal' });
});

test('sem config: no máximo 1 consulta por conta a cada 60s', async () => {
  const t = setup({ config: null });
  await t.tracker.observe(evt());
  await t.tracker.observe(outEvt());
  await t.tracker.observe(evt());
  assert.equal(t.calls.loadConfigRow, 1);
  assert.equal(t.calls.loadStages, undefined);
  assert.equal(t.calls.findDealsByPhone, undefined);
  t.advance(61_000);
  const result = await t.tracker.observe(evt());
  assert.equal(t.calls.loadConfigRow, 2);
  assert.deepEqual(result, { trackerEnabled: false, actions: [], dealId: null, created: false, moved: null });
});

test('isEnabled usa cache, invalida e dá false em erro', async () => {
  const t = setup();
  assert.equal(await t.tracker.isEnabled(USER), true);
  assert.equal(await t.tracker.isEnabled(USER), true);
  assert.equal(t.calls.loadConfigRow, 1);
  t.tracker.invalidate(USER);
  t.state.config = configRow({ tracker_enabled: false });
  assert.equal(await t.tracker.isEnabled(USER), false);
  assert.equal(t.calls.loadConfigRow, 2);

  const broken = setup({ configError: new Error('down') });
  assert.equal(await broken.tracker.isEnabled(USER), false);
  broken.state.configError = null;
  assert.equal(await broken.tracker.isEnabled(USER), true);
});

// Cenário do reconcile: d1 (lead, estúdio falou), d2 (contact, mandou orçamento), d3 (lead, sem saída).
const P1 = '5543988880011';
const P2 = '5543988880022';
const P3 = '5543988880033';
const NEW_A = '5543988880001';
const LOST_L = '5543955550005';
const CUSTOMER_C = '5543977770003';

function reconcileState(): Partial<MemState> {
  return {
    deals: [
      deal({ id: 1, stage: 'lead', contact_phone: P1, current_stage_entered_at: '2026-09-19T10:00:00.000Z', title: 'D1' }),
      deal({ id: 2, stage: 'contact', contact_phone: P2, current_stage_entered_at: '2026-09-19T09:00:00.000Z', title: 'D2' }),
      deal({ id: 3, stage: 'lead', contact_phone: P3, current_stage_entered_at: '2026-09-19T11:00:00.000Z', title: 'D3' }),
      deal({ id: 4, stage: 'lost', contact_phone: LOST_L, current_stage_entered_at: '2026-09-19T07:00:00.000Z', title: 'Perdido' }),
    ],
    outbound: [
      { phone: P1, wa_number: MAIN, message_id: 'o1', type: 'text', body: 'Oi!', timestamp: '2026-09-19T10:30:00.000Z' },
      { phone: P2, wa_number: MAIN, message_id: 'o2', type: 'document', body: 'Orçamento Gestante.pdf', timestamp: '2026-09-19T09:30:00.000Z' },
    ],
    inbound: [
      { phone: NEW_A, timestamp: '2026-09-19T12:00:00.000Z', type: 'text' },
      { phone: NEW_A, timestamp: '2026-09-19T11:00:00.000Z', type: 'audio' },
      { phone: NEW_A, timestamp: '2026-09-19T10:00:00.000Z', type: 'text' },
      { phone: P1, timestamp: '2026-09-19T09:50:00.000Z', type: 'text' },
      { phone: POSVENDA, timestamp: '2026-09-19T09:40:00.000Z', type: 'text' },
      { phone: CUSTOMER_C, timestamp: '2026-09-19T09:30:00.000Z', type: 'text' },
      { phone: '5543966660004', timestamp: '2026-09-19T09:20:00.000Z', type: 'reaction' },
      { phone: LOST_L, timestamp: '2026-09-19T08:00:00.000Z', type: 'text' },
      { phone: '5543944440006', timestamp: '2026-08-01T08:00:00.000Z', type: 'text' },
    ],
    customerKeys: new Set([canonicalPhoneKey(CUSTOMER_C)]),
    names: new Map([[canonicalPhoneKey(NEW_A), 'Contato Novo']]),
    marketing: new Set(['proposal']),
  };
}

test('reconcilePreview não escreve e lista mover e criar', async () => {
  const t = setup(reconcileState());
  const preview = await t.tracker.reconcilePreview(USER, {});
  assert.equal(t.writes.length, 0);
  assert.equal(preview.generated_at, NOW);
  assert.deepEqual(preview.to_contact.map((i) => [i.deal_id, i.from_stage, i.to_stage, i.fires_marketing_event]), [[1, 'lead', 'contact', false]]);
  assert.deepEqual(preview.to_proposal.map((i) => [i.deal_id, i.to_stage, i.fires_marketing_event, i.evidence.filename]), [[2, 'proposal', true, 'Orçamento Gestante.pdf']]);
  assert.deepEqual(preview.to_create, [
    { phone: NEW_A, contact_name: 'Contato Novo', first_inbound_at: '2026-09-19T10:00:00.000Z', last_inbound_at: '2026-09-19T12:00:00.000Z', inbound_count: 3 },
    { phone: LOST_L, contact_name: null, first_inbound_at: '2026-09-19T08:00:00.000Z', last_inbound_at: '2026-09-19T08:00:00.000Z', inbound_count: 1 },
  ]);
  assert.equal(preview.scanned, 3);
});

test('reconcilePreview não oferece recriar perdido que não escreveu depois da perda', async () => {
  const state = reconcileState();
  state.deals = state.deals!.map((d) => (d.id === 4 ? { ...d, current_stage_entered_at: '2026-09-19T09:00:00.000Z' } : d));
  const t = setup(state);
  const preview = await t.tracker.reconcilePreview(USER, {});
  assert.deepEqual(preview.to_create.map((i) => i.phone), [NEW_A]);
  const applied = await setup(state).tracker.reconcileApply(USER, { create_phones: [LOST_L] }, ACTOR);
  assert.equal(applied.created, 0);
  const control = await setup(reconcileState()).tracker.reconcileApply(USER, { create_phones: [LOST_L] }, ACTOR);
  assert.equal(control.created, 1);
});

test('reconcileApply pula quem dispara evento de anúncio sem include_marketing', async () => {
  const t = setup(reconcileState());
  const result = await t.tracker.reconcileApply(USER, { deal_ids: [1, 2, 3, 999], create_phones: [NEW_A, '5543911110000'] }, ACTOR);
  assert.deepEqual(result, { moved: 1, noop: 1, conflicts: 1, refused: 0, created: 1, skipped_marketing: 1 });
  assert.equal(t.state.deals.find((d) => d.id === 1)?.stage, 'contact');
  assert.equal(t.state.deals.find((d) => d.id === 2)?.stage, 'contact');
  const activity = t.opsOf('logActivity')[0].args[0] as FunnelActivityEntry;
  assert.equal(activity.actorId, ACTOR);
  assert.equal(activity.summary, 'Funil automático: Conversa Iniciada (revisão do funil)');
  const inserted = t.opsOf('insertDeal')[0].args[0] as Record<string, unknown>;
  assert.equal(inserted.contact_phone, NEW_A);
  assert.equal(inserted.contact_name, 'Contato Novo');
  assert.equal(inserted.current_stage_entered_at, '2026-09-19T12:00:00.000Z');

  const withMarketing = setup(reconcileState());
  const all = await withMarketing.tracker.reconcileApply(USER, { deal_ids: [2], include_marketing: true }, ACTOR);
  assert.equal(all.moved, 1);
  assert.equal(withMarketing.state.deals.find((d) => d.id === 2)?.stage, 'proposal');
});

test('mapeamento de anúncio ilegível: trata como disparando (fail-closed)', async () => {
  const t = setup(reconcileState());
  t.repo.loadMarketingMappedStages = async () => { throw new Error('down'); };
  const preview = await t.tracker.reconcilePreview(USER, {});
  assert.equal(preview.to_contact[0].fires_marketing_event, true);
});

// ════════════════════════════════════════════════════════════════════
// Repositório Supabase com banco falso
// ════════════════════════════════════════════════════════════════════
interface FakeOp { table?: string; rpc?: string; args?: unknown; method: string; payload?: unknown; columns?: string; filters: unknown[][] }
type FakeResponse = { data?: unknown; error?: { code?: string; message?: string } | null };

function fakeDb(respond: (op: FakeOp) => FakeResponse = () => ({ data: [] })) {
  const ops: FakeOp[] = [];
  const chainFor = (op: FakeOp) => {
    const chain: Record<string, unknown> = {};
    for (const name of ['eq', 'in', 'lt', 'lte', 'gt', 'gte', 'or', 'not', 'is', 'order', 'limit', 'range', 'neq', 'maybeSingle', 'single']) {
      chain[name] = (...args: unknown[]) => { op.filters.push([name, ...args]); return chain; };
    }
    chain.select = (columns: string) => { if (!op.method) op.method = 'select'; op.columns = columns; return chain; };
    chain.insert = (payload: unknown) => { op.method = 'insert'; op.payload = payload; return chain; };
    chain.update = (payload: unknown) => { op.method = 'update'; op.payload = payload; return chain; };
    chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve()
      .then(() => { const r = respond(op); return { data: r.data ?? null, error: r.error ?? null }; })
      .then(resolve, reject);
    return chain;
  };
  const db = {
    from(table: string) { const op: FakeOp = { table, method: '', filters: [] }; ops.push(op); return chainFor(op); },
    rpc(name: string, args: unknown) { const op: FakeOp = { rpc: name, args, method: 'rpc', filters: [] }; ops.push(op); return chainFor(op); },
  };
  return { db: db as unknown as SupabaseClient, ops };
}

const filterOf = (op: FakeOp, name: string) => op.filters.filter((f) => f[0] === name).map((f) => f.slice(1));

test('supabase: cancelCadenceByPhone não toca generation_meta nem sending/legacy', async () => {
  const { db, ops } = fakeDb(() => ({ data: [{ id: 1 }, { id: 2 }] }));
  const repo = createSupabaseFunnelRepo(db, () => new Date(NOW));
  assert.equal(await repo.cancelCadenceByPhone(USER, '554391112222', AT, 'customer_replied'), 2);
  const [op] = ops;
  assert.equal(op.table, 'scheduled_followups');
  assert.deepEqual(op.payload, { status: 'cancelled', last_error: 'cancel:customer_replied', updated_at: NOW });
  assert.deepEqual(filterOf(op, 'eq'), [['user_id', USER], ['kind', 'cadence'], ['phone_key', '554391112222']]);
  assert.deepEqual(filterOf(op, 'in'), [['status', ['draft', 'approved', 'blocked']]]);
  assert.deepEqual(filterOf(op, 'lt'), [['basis_at', AT]]);

  const missing = createSupabaseFunnelRepo(fakeDb(() => ({ error: { code: '42703', message: 'column kind does not exist' } })).db);
  assert.equal(await missing.cancelCadenceByPhone(USER, '554391112222', AT, 'optout'), 'schema_missing');
  const broken = createSupabaseFunnelRepo(fakeDb(() => ({ error: { code: '57014', message: 'timeout' } })).db);
  await assert.rejects(() => broken.cancelCadenceByPhone(USER, '554391112222', AT, 'optout'), { code: '57014' });
});

test('supabase: casUpdateStage separa erro de 0 linhas', async () => {
  const ok = createSupabaseFunnelRepo(fakeDb(() => ({ data: [{ id: 10 }] })).db);
  assert.equal(await ok.casUpdateStage(USER, 10, 'lead', { stage: 'contact' }), 'ok');
  const none = fakeDb(() => ({ data: [] }));
  assert.equal(await createSupabaseFunnelRepo(none.db).casUpdateStage(USER, 10, 'lead', { stage: 'contact' }), 'no_rows');
  assert.deepEqual(filterOf(none.ops[0], 'eq'), [['user_id', USER], ['id', 10], ['stage', 'lead']]);
  const failed = createSupabaseFunnelRepo(fakeDb(() => ({ error: { code: 'P0001', message: 'MARKETING_FACT_IDEMPOTENCY_CONFLICT' } })).db);
  assert.deepEqual(await failed.casUpdateStage(USER, 10, 'lead', { stage: 'contact' }), { error: { code: 'P0001', message: 'MARKETING_FACT_IDEMPOTENCY_CONFLICT' } });
});

test('supabase: migration ausente vira null ou vazio', async () => {
  for (const code of ['42P01', 'PGRST205', '42703', 'PGRST204']) {
    const repo = createSupabaseFunnelRepo(fakeDb(() => ({ error: { code, message: 'x' } })).db);
    assert.equal(await repo.loadConfigRow(USER), null);
    assert.deepEqual([...await repo.loadMarketingMappedStages(USER)], []);
  }
  for (const code of ['42883', 'PGRST202']) {
    const repo = createSupabaseFunnelRepo(fakeDb(() => ({ error: { code, message: 'x' } })).db);
    assert.deepEqual([...await repo.loadCustomerKeys(USER)], []);
  }
  const other = createSupabaseFunnelRepo(fakeDb(() => ({ error: { code: '28P01', message: 'auth' } })).db);
  await assert.rejects(() => other.loadConfigRow(USER));
  const keys = fakeDb((op) => (op.rpc ? { data: [{ phone_key: '554391112222' }, { phone_key: '' }] } : {}));
  assert.deepEqual([...await createSupabaseFunnelRepo(keys.db).loadCustomerKeys(USER)], ['554391112222']);
  assert.deepEqual(keys.ops[0].args, { p_user_id: USER });
});

test('supabase: opt-out com chave canônica, texto cortado e 23505 como ok', async () => {
  const { db, ops } = fakeDb(() => ({ error: { code: '23505', message: 'duplicate' } }));
  const repo = createSupabaseFunnelRepo(db);
  const result = await repo.upsertOptOut(USER, { phone: PHONE13, dealId: 10, kind: 'hard', pattern: 'x', text: 'a'.repeat(500), messageId: 'm1' });
  assert.equal(result, 'ok');
  const payload = ops[0].payload as Record<string, unknown>;
  assert.equal(payload.phone_key, canonicalPhoneKey(PHONE13));
  assert.equal((payload.detected_text as string).length, 300);
  assert.equal(payload.created_by, 'funnel_tracker');
  assert.equal(payload.source_message_id, 'm1');
  assert.equal(String(payload.reason).includes('—'), false);
  const missing = createSupabaseFunnelRepo(fakeDb(() => ({ error: { code: '42P01', message: 'x' } })).db);
  assert.equal(await missing.upsertOptOut(USER, { phone: PHONE13, dealId: null, kind: 'soft', pattern: 'x', text: null, messageId: null }), 'schema_missing');
});

test('supabase: insertDeal, loadDeal e atividade', async () => {
  const insert = createSupabaseFunnelRepo(fakeDb(() => ({ data: { id: 55 } })).db);
  assert.deepEqual(await insert.insertDeal({ title: 'x' }), { id: 55 });
  const failed = createSupabaseFunnelRepo(fakeDb(() => ({ error: { code: '23502', message: 'null' } })).db);
  assert.deepEqual(await failed.insertDeal({ title: 'x' }), { error: { code: '23502', message: 'null' } });

  const loaded = createSupabaseFunnelRepo(fakeDb(() => ({
    data: { id: '9', stage: 'lead', converted: null, converted_job_id: null, current_stage_entered_at: null, stage_entered_at: AT, contact_phone: PHONE13, title: 'T' },
  })).db);
  const state = await loaded.loadDeal(USER, 9);
  assert.equal(state?.id, 9);
  assert.equal(state?.current_stage_entered_at, AT);
  assert.equal(state?.converted, false);

  const log = fakeDb(() => ({ error: { code: '42P01', message: 'x' } }));
  await createSupabaseFunnelRepo(log.db).logActivity({ userId: USER, dealId: 9, actorId: 'sistema', summary: 's', details: { reason: 'backfill' } });
  const payload = log.ops[0].payload as Record<string, unknown>;
  assert.equal(payload.actor_user_id, null);
  assert.equal(payload.action, 'funnel_auto');
  assert.equal(payload.entity_id, '9');
  assert.deepEqual(payload.details, { automatic: true, source: 'funnel_tracker', reason: 'backfill' });
});

test('supabase: entradas recentes paginam em blocos de 1000', async () => {
  const pages = [Array.from({ length: 1000 }, () => ({ phone: PHONE13, timestamp: AT, type: 'text' })), [{ phone: PHONE12, timestamp: AT, type: 'text' }]];
  const { db, ops } = fakeDb(() => ({ data: pages.shift() ?? [] }));
  const rows = await createSupabaseFunnelRepo(db).listRecentInbound(USER, brazilianPhoneVariants(MAIN), AT, 5000);
  assert.equal(rows.length, 1001);
  assert.deepEqual(ops.map((op) => filterOf(op, 'range')[0]), [[0, 999], [1000, 1999]]);
  assert.deepEqual(filterOf(ops[0], 'eq'), [['user_id', USER], ['from_me', false]]);
});

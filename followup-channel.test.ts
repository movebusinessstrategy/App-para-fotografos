import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  approvalFor,
  approvalMatches,
  channelClass,
  chooseChannel,
  classifyBaileysError,
  classifyGraphError,
  countTemplateVars,
  metaUsable,
  renderTemplate,
  sanitizeTemplateParam,
  splitBalloons,
  templateParams,
  templatePayload,
  tenantBlock,
  toChannelHealthDTO,
  validateCadenceTemplate,
  windowOpen,
} from './followup-channel.js';
import type { CadenceTemplate, SenderChannelHealth } from './followup-channel.js';
import { toTemplateHook } from './followup-draft.js';
import { DEFAULT_FOLLOWUP_CONFIG } from './src/features/followups/types.js';
import type { CadenceTaskRow, FollowUpConfig } from './src/features/followups/types.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
// Sexta-feira, 12:00 em São Paulo.
const NOW = new Date('2026-09-18T15:00:00.000Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * HOUR).toISOString();
const inHours = (h: number) => new Date(NOW.getTime() + h * HOUR).toISOString();

// Números fictícios: principal (13 e 12 dígitos) e outro número qualquer.
const MAIN = '5543900001111';
const MAIN_12 = '554300001111';
const OTHER = '5511988887777';

const DASH_PATTERN = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);

type HealthOver = { meta?: Partial<SenderChannelHealth['meta']>; baileys?: Partial<SenderChannelHealth['baileys']> }
  & Partial<Omit<SenderChannelHealth, 'meta' | 'baileys'>>;

function health(over: HealthOver = {}): SenderChannelHealth {
  const { meta, baileys, ...rest } = over;
  return {
    meta: { configured: true, phoneNumberId: 'pnid-1', waNumber: MAIN, token: 'tok', tokenExpiresAt: null, operational: true, qualityRating: 'GREEN', ...meta },
    baileys: { status: 'close', waNumber: MAIN, paired: true, ...baileys },
    mainWaNumber: MAIN, preferredChannel: 'auto', dedupeReady: true,
    ...rest,
  };
}

const CONFIG: FollowUpConfig = { ...DEFAULT_FOLLOWUP_CONFIG, enabled: true };
const config = (over: Partial<FollowUpConfig> = {}): FollowUpConfig => ({ ...CONFIG, ...over });

const TEMPLATE: CadenceTemplate = {
  id: 40, name: 'retomada_ensaio', language: 'pt_BR', bodyText: 'Oi, {{1}}! {{2}}', status: 'APPROVED',
  category: 'MARKETING', headerText: null, buttons: [],
};
const template = (over: Partial<CadenceTemplate> = {}): CadenceTemplate => ({ ...TEMPLATE, ...over });

function choose(i: { lastCustomerAt?: string | null; conv?: string; h?: SenderChannelHealth; c?: FollowUpConfig; t?: CadenceTemplate | null }) {
  return chooseChannel({
    now: NOW, lastCustomerAt: i.lastCustomerAt === undefined ? hoursAgo(2) : i.lastCustomerAt,
    conversationWaNumber: i.conv ?? MAIN, health: i.h ?? health(), config: i.c ?? CONFIG, template: i.t === undefined ? null : i.t,
  });
}

function task(over: Partial<CadenceTaskRow> = {}): CadenceTaskRow {
  return {
    id: 1, user_id: 'u1', deal_id: 10, phone: '5543911112222', phone_key: '554311112222', wa_number: MAIN,
    message: 'Oi, Ana! Conseguiu dar uma olhada no orçamento do ensaio?', stage_id: 'proposal', scheduled_at: hoursAgo(1),
    sent_at: null, status: 'sending', created_at: hoursAgo(3), contact_name: 'ana souza', attempts: 1, kind: 'cadence', step: 1,
    basis_at: hoursAgo(30), basis_message_id: null, draft_text: null, approved_at: hoursAgo(2), approved_by: 'owner',
    claimed_at: NOW.toISOString(), claimed_by: 'w1', lease_expires_at: inHours(0.1), channel_used: null, sent_message_id: null,
    last_error: null, generation_meta: {}, updated_at: hoursAgo(2), ...over,
  };
}

// Template

test('validateCadenceTemplate: só MARKETING aprovado com {{1}} e {{2}} e nada mais', () => {
  assert.deepEqual(validateCadenceTemplate(TEMPLATE), { ok: true });
  // 37 'saudao': variável nomeada.
  assert.deepEqual(validateCadenceTemplate(template({ name: 'saudao', bodyText: 'Olá! Aqui é da {{empresa}}.' })),
    { ok: false, reason: 'Troque variáveis com nome por {{1}} e {{2}}.' });
  // 35 'confirmacao_agendamento': UTILITY.
  assert.deepEqual(validateCadenceTemplate(template({ category: 'UTILITY' })), { ok: false, reason: 'Use um template da categoria Marketing.' });
  assert.deepEqual(validateCadenceTemplate(template({ bodyText: 'Oi {{1}}, {{2}} e {{3}}' })),
    { ok: false, reason: 'O template precisa de {{1}} (nome) e {{2}} (mensagem), e só elas.' });
  assert.deepEqual(validateCadenceTemplate(template({ bodyText: 'Oi {{1}}!' })),
    { ok: false, reason: 'O template precisa de {{1}} (nome) e {{2}} (mensagem), e só elas.' });
  assert.deepEqual(validateCadenceTemplate(template({ buttons: [{ type: 'URL', url: 'https://exemplo.com/{{1}}' }] })),
    { ok: false, reason: 'Cabeçalho e botões não podem ter variáveis.' });
  assert.deepEqual(validateCadenceTemplate(template({ headerText: 'Olá {{1}}' })),
    { ok: false, reason: 'Cabeçalho e botões não podem ter variáveis.' });
  assert.deepEqual(validateCadenceTemplate(template({ status: 'PENDING' })), { ok: false, reason: 'Template ainda não aprovado pela Meta.' });
});

test('validateCadenceTemplate: status vem antes de categoria; cabeçalho sem variável passa', () => {
  assert.equal((validateCadenceTemplate(template({ status: 'REJECTED', category: 'UTILITY' })) as any).reason, 'Template ainda não aprovado pela Meta.');
  assert.deepEqual(validateCadenceTemplate(template({ headerText: 'Estúdio', buttons: [{ type: 'QUICK_REPLY', text: 'Quero saber' }] })), { ok: true });
  assert.deepEqual(validateCadenceTemplate(template({ bodyText: 'Oi {{ 1 }}! {{2}}' })), { ok: true });
});

// Predicados

test('metaUsable: token, id do número, operação e margem de 5 min no vencimento', () => {
  assert.equal(metaUsable(health(), NOW), true);
  assert.equal(metaUsable(health({ meta: { tokenExpiresAt: inHours(4 / 60) } }), NOW), false);
  assert.equal(metaUsable(health({ meta: { tokenExpiresAt: inHours(10 / 60) } }), NOW), true);
  assert.equal(metaUsable(health({ meta: { token: null } }), NOW), false);
  assert.equal(metaUsable(health({ meta: { phoneNumberId: null } }), NOW), false);
  assert.equal(metaUsable(health({ meta: { operational: false } }), NOW), false);
});

test('windowOpen: 24h menos 30 min de margem', () => {
  assert.equal(windowOpen(hoursAgo(23.4), NOW), true);
  assert.equal(windowOpen(hoursAgo(23.6), NOW), false);
  assert.equal(windowOpen(null, NOW), false);
  assert.equal(windowOpen(hoursAgo(23.9), NOW, 0), true);
});

// chooseChannel

test('chooseChannel 1: janela aberta com a API oficial => texto', () => {
  assert.deepEqual(choose({}), { ok: true, channel: 'meta_text', waNumber: MAIN });
});

test('chooseChannel 2: fora da janela com QR aberto e permitido => QR', () => {
  const h = health({ baileys: { status: 'open', waNumber: MAIN_12 } });
  assert.deepEqual(choose({ lastCustomerAt: hoursAgo(30), h, c: config({ allow_baileys: true }) }),
    { ok: true, channel: 'baileys', waNumber: MAIN_12 });
});

test('chooseChannel 3: QR fechado e template elegível => template', () => {
  const d = choose({ lastCustomerAt: hoursAgo(30), c: config({ allow_baileys: true, template_id: 40 }), t: TEMPLATE });
  assert.deepEqual(d, { ok: true, channel: 'meta_template', waNumber: MAIN });
});

test('chooseChannel 4: token vencido sem QR => bloqueio da conta com a data', () => {
  const d = choose({ h: health({ meta: { tokenExpiresAt: '2026-09-17T12:00:00.000Z' } }) });
  assert.deepEqual(d, {
    ok: false, scope: 'tenant', code: 'meta_token_expired',
    message: 'Token da API oficial venceu em 17/09. Reconecte em Configurações > Integrações > WhatsApp.',
  });
});

test('chooseChannel 5: QR aberto mas desligado na cadência e sem template => bloqueado, só esta tarefa', () => {
  const d = choose({ lastCustomerAt: hoursAgo(30), h: health({ baileys: { status: 'open' } }) });
  assert.equal(d.ok, false);
  assert.equal((d as any).code, 'baileys_disabled');
  // A API oficial ainda envia dentro da janela: a tarefa sai da fila, a conta não para.
  assert.equal((d as any).scope, 'task');
});

test('chooseChannel 6: conversa em outro número => number_mismatch da tarefa', () => {
  const d = choose({ conv: OTHER });
  assert.equal((d as any).code, 'number_mismatch');
  assert.equal((d as any).scope, 'task');
});

test('chooseChannel 7: janela aberta, API oficial fora do ar e QR => QR', () => {
  const h = health({ meta: { operational: false }, baileys: { status: 'open' } });
  assert.deepEqual(choose({ h, c: config({ allow_baileys: true }) }), { ok: true, channel: 'baileys', waNumber: MAIN });
});

test('chooseChannel 8: template PENDING => bloqueado com o motivo', () => {
  const d = choose({ lastCustomerAt: hoursAgo(30), c: config({ template_id: 40 }), t: template({ status: 'PENDING' }) });
  assert.equal((d as any).code, 'template_not_eligible');
  assert.equal((d as any).message, 'O template escolhido não serve para retomada: Template ainda não aprovado pela Meta.');
});

test('chooseChannel 9: qualidade YELLOW bloqueia a API oficial', () => {
  const d = choose({ h: health({ meta: { qualityRating: 'YELLOW' } }) });
  assert.deepEqual(d, {
    ok: false, scope: 'tenant', code: 'quality_not_green',
    message: 'A qualidade do número na Meta caiu (YELLOW). Envios pausados para proteger o número.',
  });
  // Qualidade ainda não medida não é queda.
  assert.equal(choose({ h: health({ meta: { qualityRating: null } }) }).ok, true);
  assert.equal(choose({ h: health({ meta: { qualityRating: 'UNKNOWN' } }) }).ok, true);
});

test('chooseChannel: allow_baileys sem a migration 085 não usa o QR', () => {
  const h = health({ baileys: { status: 'open' }, dedupeReady: false });
  const d = choose({ lastCustomerAt: hoursAgo(30), h, c: config({ allow_baileys: true }) });
  assert.equal(d.ok, false);
  assert.equal((d as any).code, 'window_closed_no_template');
  assert.equal((d as any).scope, 'task');
  assert.equal((d as any).message, 'Fora da janela de 24h e sem template aprovado. Aprove um template de retomada ou ligue o envio pelo QR.');
});

test('chooseChannel: texto livre desligado vai direto ao template mesmo com janela aberta', () => {
  const d = choose({ c: config({ allow_meta_text: false, template_id: 40 }), t: TEMPLATE });
  assert.equal((d as any).channel, 'meta_template');
});

test('chooseChannel: número principal com e sem o 9 casa', () => {
  assert.deepEqual(choose({ conv: MAIN_12 }), { ok: true, channel: 'meta_text', waNumber: MAIN });
});

// tenantBlock

test('tenantBlock: nulo com a API oficial ou com o QR; senão o primeiro bloqueio da conta', () => {
  assert.equal(tenantBlock(health(), CONFIG, null, NOW), null);
  const qrOnly = health({ meta: { configured: false, token: null, phoneNumberId: null, waNumber: null }, baileys: { status: 'open' } });
  assert.equal(tenantBlock(qrOnly, config({ allow_baileys: true }), null, NOW), null);
  assert.equal(tenantBlock(health({ meta: { tokenExpiresAt: hoursAgo(30) } }), CONFIG, null, NOW)?.code, 'meta_token_expired');
  const offline = health({ meta: { configured: false, token: null, phoneNumberId: null, waNumber: null } });
  assert.deepEqual(tenantBlock(offline, config({ allow_baileys: true }), null, NOW),
    { code: 'baileys_offline', message: 'QR desconectado. Reconecte pela engrenagem do chat.' });
  assert.equal(tenantBlock(offline, CONFIG, null, NOW)?.code, 'no_channel');
  assert.equal(tenantBlock(health({ meta: { qualityRating: 'RED' } }), CONFIG, null, NOW)?.code, 'quality_not_green');
});

test('tenantBlock: API oficial em outro número que não o principal não conta como canal', () => {
  const block = tenantBlock(health({ meta: { waNumber: OTHER } }), CONFIG, null, NOW);
  assert.equal(block?.code, 'no_channel');
  assert.ok(block?.message.includes('engrenagem do chat'));
});

// Saúde para o painel

test('toChannelHealthDTO: preferência do chat em QR com a API oficial como único canal gera nota', () => {
  const dto = toChannelHealthDTO(health({ preferredChannel: 'baileys' }), CONFIG, null, NOW);
  assert.ok(dto.notes.includes('A cadência envia pela API oficial mesmo com a preferência do chat em QR.'));
  assert.deepEqual(dto.can_send, { inside_24h: true, outside_24h: false });
  assert.equal(dto.level, 'degraded');
  assert.equal(dto.meta.token_state, 'no_expiry');
  assert.equal(dto.preferred_channel, 'baileys');
  assert.deepEqual(dto.template, { configured: false, approved: false, eligible: false, name: null, reason: null });
});

test('toChannelHealthDTO: token vencido, vencendo e ok; nível pelo que pode sair', () => {
  const expired = toChannelHealthDTO(health({ meta: { tokenExpiresAt: hoursAgo(1) } }), CONFIG, null, NOW);
  assert.equal(expired.meta.token_state, 'expired');
  assert.equal(expired.meta.days_left, 0);
  assert.equal(expired.level, 'down');
  const expiring = toChannelHealthDTO(health({ meta: { tokenExpiresAt: inHours(3 * 24 + 1) } }), config({ template_id: 40 }), TEMPLATE, NOW);
  assert.equal(expiring.meta.token_state, 'expiring');
  assert.equal(expiring.meta.days_left, 3);
  assert.equal(expiring.level, 'degraded');
  const ok = toChannelHealthDTO(health({ meta: { tokenExpiresAt: inHours(60 * 24) } }), config({ template_id: 40 }), TEMPLATE, NOW);
  assert.equal(ok.meta.token_state, 'ok');
  assert.deepEqual(ok.can_send, { inside_24h: true, outside_24h: true });
  assert.equal(ok.level, 'ok');
  assert.deepEqual(ok.template, { configured: true, approved: true, eligible: true, name: 'retomada_ensaio', reason: null });
  assert.equal(toChannelHealthDTO(health({ meta: { token: null, configured: false } }), CONFIG, null, NOW).meta.token_state, 'none');
});

test('toChannelHealthDTO: notas do QR apontam para a engrenagem do chat e template inelegível traz o motivo', () => {
  const dto = toChannelHealthDTO(health({ dedupeReady: false }), config({ allow_baileys: true, template_id: 37 }),
    template({ id: 37, name: 'saudao', bodyText: 'Oi! Aqui é da {{empresa}}.' }), NOW);
  assert.ok(dto.notes.includes('WhatsApp (QR) desconectado. Reconecte pela engrenagem do chat.'));
  assert.ok(dto.notes.includes('Aplique a migration 085 antes de enviar pelo QR.'));
  assert.deepEqual(dto.template, { configured: true, approved: true, eligible: false, name: 'saudao', reason: 'Troque variáveis com nome por {{1}} e {{2}}.' });
  assert.deepEqual(dto.baileys, { status: 'close', phone: MAIN, allowed: true, dedupe_ready: false });
  const missing = toChannelHealthDTO(health(), config({ template_id: 99 }), null, NOW);
  assert.equal(missing.template.reason, 'O template escolhido não foi encontrado.');
  const yellow = toChannelHealthDTO(health({ meta: { qualityRating: 'YELLOW' } }), CONFIG, null, NOW);
  assert.equal(yellow.level, 'down');
  assert.ok(yellow.notes[0].startsWith('A qualidade do número na Meta caiu (YELLOW).'));
  for (const note of [...dto.notes, ...yellow.notes]) assert.ok(!DASH_PATTERN.test(note));
});

// Aprovação

test('approvalFor: texto para canais de texto; template grava o texto renderizado', () => {
  const text = 'Oi, Ana!\n\nConseguiu dar uma olhada no orçamento do ensaio?';
  assert.deepEqual(approvalFor({ channel: 'meta_text', template: TEMPLATE, contactName: 'Ana', text, step: 1 }),
    { channel_class: 'text', render: null, template_id: null });
  assert.deepEqual(approvalFor({ channel: 'blocked', template: null, contactName: 'Ana', text, step: 1 }),
    { channel_class: 'text', render: null, template_id: null });
  const a = approvalFor({ channel: 'meta_template', template: TEMPLATE, contactName: 'ana souza', text, step: 1 });
  assert.equal(a.channel_class, 'template');
  assert.equal(a.template_id, 40);
  assert.equal(a.render, `Oi, Ana! ${toTemplateHook(text, 1)}`);
});

test('approvalMatches: classe diferente ou render diferente volta para revisão', () => {
  const t = task();
  // Aprovado como texto (sem approval gravada) e agora sairia como template.
  assert.deepEqual(approvalMatches(t, 'meta_template', TEMPLATE),
    { ok: false, message: 'Vai sair como template (fora da janela de 24h). Revise o texto final.' });
  assert.deepEqual(approvalMatches(t, 'meta_text', null), { ok: true });
  assert.deepEqual(approvalMatches(t, 'baileys', null), { ok: true });
  const approval = approvalFor({ channel: 'meta_template', template: TEMPLATE, contactName: t.contact_name, text: t.message, step: 1 });
  const approved = task({ generation_meta: { approval } });
  assert.deepEqual(approvalMatches(approved, 'meta_template', TEMPLATE), { ok: true });
  assert.deepEqual(approvalMatches(approved, 'meta_text', null), { ok: false, message: 'Vai sair como texto livre. Revise antes de enviar.' });
  const edited = task({ generation_meta: { approval }, message: 'Oi, Ana! Passando para saber se ficou alguma dúvida sobre os pacotes.' });
  assert.deepEqual(approvalMatches(edited, 'meta_template', TEMPLATE),
    { ok: false, message: 'Vai sair como template (fora da janela de 24h). Revise o texto final.' });
  assert.equal(approvalMatches(approved, 'meta_template', template({ id: 41 })).ok, false);
  assert.equal(approvalMatches(approved, 'meta_template', null).ok, false);
});

test('channelClass e templateParams', () => {
  assert.equal(channelClass('meta_template'), 'template');
  assert.equal(channelClass('meta_text'), 'text');
  assert.equal(channelClass('baileys'), 'text');
  assert.deepEqual(templateParams(null, 'Oi! Conseguiu ver o orçamento que te mandei ontem?', 1),
    ['tudo bem', 'Conseguiu ver o orçamento que te mandei ontem?']);
  assert.equal(templateParams('ANA PAULA', 'texto', 2)[0], 'Ana');
});

// Erros

test('classifyGraphError: tabela de códigos, ambíguo e transitório', () => {
  const err = (code: number | null, extra: Record<string, unknown> = {}) => ({ ok: false as const, httpStatus: 400, code, message: 'x', ...extra });
  const table: Array<[number, string]> = [
    [190, 'channel_auth'], [131031, 'channel_auth'], [133010, 'channel_config'], [131030, 'channel_config'],
    [131047, 'window_closed'], [131026, 'undeliverable'], [131021, 'undeliverable'], [131049, 'marketing_capped'],
    [131048, 'rate_limited'], [130429, 'rate_limited'], [131056, 'rate_limited'],
    [132000, 'template_invalid'], [132001, 'template_invalid'], [132005, 'template_invalid'], [132007, 'template_invalid'],
    [132012, 'template_invalid'], [132015, 'template_invalid'], [132016, 'template_invalid'], [132018, 'template_invalid'],
  ];
  for (const [code, cls] of table) assert.equal(classifyGraphError(err(code)), cls, String(code));
  assert.equal(classifyGraphError(err(null, { httpStatus: 0, ambiguous: true })), 'ambiguous');
  assert.equal(classifyGraphError(err(190, { ambiguous: true })), 'ambiguous');
  assert.equal(classifyGraphError(err(1, { httpStatus: 500 })), 'transient');
  assert.equal(classifyGraphError(err(null, { httpStatus: 503 })), 'transient');
});

test('classifyBaileysError: timeout é ambíguo, desconectado é offline, o resto é ambíguo', () => {
  assert.equal(classifyBaileysError(new Error('BAILEYS_TIMEOUT')), 'ambiguous');
  assert.equal(classifyBaileysError(new Error('WhatsApp não conectado. Escaneie o QR Code primeiro.')), 'baileys_offline');
  assert.equal(classifyBaileysError(new Error('Connection Closed')), 'baileys_offline');
  assert.equal(classifyBaileysError('not connected'), 'baileys_offline');
  assert.equal(classifyBaileysError(new Error('socket hang up')), 'ambiguous');
  assert.equal(classifyBaileysError(undefined), 'ambiguous');
});

// Payloads

test('sanitizeTemplateParam: sem quebra, tab ou 5 espaços, até 200 caracteres, nunca vazio', () => {
  assert.equal(sanitizeTemplateParam('linha 1\nlinha 2\tfim'), 'linha 1 linha 2 fim');
  assert.equal(sanitizeTemplateParam('a     b'), 'a b');
  assert.equal(sanitizeTemplateParam('a    b'), 'a    b');
  assert.equal(sanitizeTemplateParam('   '), '-');
  assert.equal(sanitizeTemplateParam(''), '-');
  assert.equal(sanitizeTemplateParam('x'.repeat(250)).length, 200);
  const emoji = 'a'.repeat(199) + '\u{1F60A}';
  assert.equal(sanitizeTemplateParam(emoji), 'a'.repeat(199));
});

test('countTemplateVars, templatePayload e renderTemplate espelham o server.ts', () => {
  assert.equal(countTemplateVars('Oi, {{1}}! {{2}}'), 2);
  assert.equal(countTemplateVars('Sem variável'), 0);
  assert.deepEqual(templatePayload(TEMPLATE, ['Ana', 'Linha\ncom quebra']), {
    name: 'retomada_ensaio', language: { code: 'pt_BR' },
    components: [{ type: 'body', parameters: [{ type: 'text', text: 'Ana' }, { type: 'text', text: 'Linha com quebra' }] }],
  });
  assert.deepEqual(templatePayload(template({ bodyText: 'Olá!', language: '' }), ['x']), { name: 'retomada_ensaio', language: { code: 'pt_BR' } });
  assert.deepEqual((templatePayload(TEMPLATE, ['Ana']) as any).components[0].parameters[1], { type: 'text', text: '-' });
  assert.equal(renderTemplate('Oi, {{1}}! {{2}}', ['Ana', 'Tudo certo?']), 'Oi, Ana! Tudo certo?');
  assert.equal(renderTemplate('Oi, {{1}}! {{3}}', ['Ana']), 'Oi, Ana! {{3}}');
});

test('splitBalloons: até 2 balões, o resto junta no segundo', () => {
  assert.deepEqual(splitBalloons('Oi, Ana!\n\nConseguiu ver?'), ['Oi, Ana!', 'Conseguiu ver?']);
  assert.deepEqual(splitBalloons('um\n\ndois\n \ntrês'), ['um', 'dois\n\ntrês']);
  assert.deepEqual(splitBalloons('linha 1\nlinha 2'), ['linha 1\nlinha 2']);
  assert.deepEqual(splitBalloons('   '), []);
});

test('código sem travessão e sem acesso a banco, rede ou server.ts', () => {
  for (const file of ['followup-channel.ts', 'followup-channel.test.ts']) {
    const source = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');
    assert.ok(!DASH_PATTERN.test(source), `${file} tem travessão`);
  }
  const source = readFileSync(new URL('./followup-channel.ts', import.meta.url), 'utf8');
  assert.ok(!/supabase|server\.js|baileys-manager|fetch\(/i.test(source));
});

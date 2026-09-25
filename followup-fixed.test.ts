import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  checkFixedMessages, countNameMarkers, ensureFixedTemplates, FIXED_NOT_CREATED, fixedRefFor, fixedRefOf, fixedSteps,
  fixedTemplateBody, fixedTemplateName, fixedTemplatesInfo, fixedTextFor, NO_META_ACCOUNT_REASON, parseFixedMessages,
  renderFixedMessage,
} from './followup-fixed.js';
import type { EnsureFixedDeps, FixedTemplatePort, FixedTemplateRow } from './followup-fixed.js';

// Os três follow-ups que o dono aprovou (texto dele, sem dados de cliente).
const F1 = 'Oiiii [nome], tudo bem 🥰?\n\nVamos ver uma data para as suas fotos?';
const F2 = 'Oiiii [nome], tudo bem? 🥰';
const F3 = 'Oi, [nome]! 🥰\nVi que tivemos dificuldade em continuar nossa conversa por aqui e fiquei em dúvida se ainda está nos seus planos fazer o ensaio.\n\nMe fala com sinceridade: você ainda tem interesse em seguir com suas fotos?\n\nSe quiser, posso te ajudar a garantir uma data linda pra vocês. Mas, se não for mais o momento ideal, posso tirar seu nome da lista de prioridade sem problemas.';
const DASH_PATTERN = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);
const NOW = new Date('2026-09-25T15:00:00.000Z');
const USER = 'user-1';

const sha6 = (text: string) => createHash('sha1').update(text, 'utf8').digest('hex').slice(0, 6);

// Texto

test('renderFixedMessage: os três follow-ups do dono com o primeiro nome saem exatamente iguais', () => {
  assert.equal(renderFixedMessage(F1, 'Maria'), 'Oiiii Maria, tudo bem 🥰?\n\nVamos ver uma data para as suas fotos?');
  assert.equal(renderFixedMessage(F2, 'Maria'), 'Oiiii Maria, tudo bem? 🥰');
  assert.equal(renderFixedMessage(F3, 'Maria'), F3.replace('[nome]', 'Maria'));
});

test('renderFixedMessage: sem nome, o marcador sai e a pontuação fica certa', () => {
  assert.equal(renderFixedMessage(F1, null), 'Oiiii, tudo bem 🥰?\n\nVamos ver uma data para as suas fotos?');
  assert.equal(renderFixedMessage(F2, ''), 'Oiiii, tudo bem? 🥰');
  assert.ok(renderFixedMessage(F3, undefined).startsWith('Oi! 🥰\nVi que tivemos dificuldade'));
  const cases: Array<[string, string]> = [
    ['Tudo bem, [nome]?', 'Tudo bem?'],
    ['Oi, [nome], tudo bem?', 'Oi, tudo bem?'],
    ['Olá [nome] tudo bem', 'Olá tudo bem'],
    ['Bom dia [nome]!', 'Bom dia!'],
    ['Oi!\n[nome], tudo bem?', 'Oi!\nTudo bem?'],
    ['[nome], tudo bem?', 'Tudo bem?'],
    ['Sem marcador nenhum.', 'Sem marcador nenhum.'],
  ];
  for (const [text, expected] of cases) assert.equal(renderFixedMessage(text, null), expected, text);
});

test('renderFixedMessage: aceita [nome], {nome} e {{nome}} sem diferenciar maiúsculas', () => {
  for (const marker of ['[nome]', '{nome}', '{{nome}}', '[NOME]', '{Nome}', '{{ nome }}', '[ nome ]']) {
    assert.equal(renderFixedMessage(`Oi ${marker}, tudo bem?`, 'Ana'), 'Oi Ana, tudo bem?', marker);
    assert.equal(renderFixedMessage(`Oi ${marker}, tudo bem?`, null), 'Oi, tudo bem?', marker);
  }
  assert.equal(renderFixedMessage('Oi\r\n[nome]!\r\n', 'Ana'), 'Oi\nAna!', 'quebra de linha do Windows vira \\n e as pontas somem');
  assert.equal(renderFixedMessage('Oi $& [nome]', '$1'), 'Oi $& $1', 'nome com cifrão não vira padrão de troca');
});

test('fixedTemplateBody troca o marcador por {{1}} (0 ou 1 variável)', () => {
  assert.equal(fixedTemplateBody(F1), 'Oiiii {{1}}, tudo bem 🥰?\n\nVamos ver uma data para as suas fotos?');
  assert.equal(fixedTemplateBody('Oi {{NOME}}!'), 'Oi {{1}}!');
  assert.equal(fixedTemplateBody('Sem nome aqui.'), 'Sem nome aqui.');
  assert.equal(countNameMarkers(F3), 1);
  assert.equal(countNameMarkers('Sem nome'), 0);
});

test('fixedTemplateName: passo e o começo do sha1 do texto; texto novo = template novo', () => {
  assert.equal(fixedTemplateName(1, F1), `retomada_passo1_${sha6(F1)}`);
  assert.match(fixedTemplateName(3, F3), /^retomada_passo3_[0-9a-f]{6}$/);
  assert.notEqual(fixedTemplateName(1, F1), fixedTemplateName(2, F1));
  assert.notEqual(fixedTemplateName(2, F2), fixedTemplateName(2, `${F2} `.replace('🥰', '😍')));
  assert.equal(fixedTemplateName(2, `  ${F2}\r\n`), fixedTemplateName(2, F2), 'pontas e quebra do Windows não mudam o nome');
});

// Passos e config

test('fixedSteps e fixedTextFor: índice+1 = passo, só textos preenchidos, só no modo fixo', () => {
  const steps = fixedSteps([F1, '', F3, 'Oi! Última', 'quinto ignorado']);
  assert.deepEqual(steps.map((s) => s.step), [1, 3, 4]);
  assert.equal(steps[0].name, fixedTemplateName(1, F1));
  assert.equal(steps[0].variables, 1);
  assert.equal(steps[2].variables, 0);
  const config = { message_mode: 'fixed' as const, fixed_messages: [F1, F2, F3] };
  assert.equal(fixedTextFor(config, 2), F2);
  assert.equal(fixedTextFor(config, 4), null);
  assert.equal(fixedTextFor({ ...config, message_mode: 'ai' }, 1), null, 'modo IA não usa texto fixo');
  assert.deepEqual(fixedRefFor(config, 3), { source: F3, template_name: fixedTemplateName(3, F3) });
  assert.equal(fixedRefFor(config, 4), null);
});

test('fixedRefOf: só vale enquanto o texto é exatamente o renderizado', () => {
  const ref = { source: F2, template_name: fixedTemplateName(2, F2) };
  assert.deepEqual(fixedRefOf({ fixed: ref }, 'Oiiii Ana, tudo bem? 🥰', 'Ana'), ref);
  assert.deepEqual(fixedRefOf({ fixed: ref }, 'Oiiii, tudo bem? 🥰', null), ref);
  assert.equal(fixedRefOf({ fixed: ref }, 'Oiiii Ana, tudo bem? 🥰 Editado', 'Ana'), null, 'editado deixa de ser a mensagem fixa');
  assert.equal(fixedRefOf({ fixed: ref }, 'Oiiii Ana, tudo bem? 🥰', 'Bia'), null, 'nome diferente do texto');
  assert.equal(fixedRefOf({}, 'x', null), null);
  assert.equal(fixedRefOf(null, 'x', null), null);
  assert.equal(fixedRefOf({ fixed: { source: 1 as unknown as string, template_name: 'x' } }, 'x', null), null);
});

test('parseFixedMessages: leitura tolerante (até 4, sem vazio no fim, até 1024 caracteres)', () => {
  assert.deepEqual(parseFixedMessages([F1, ' ', '', null]), [F1]);
  assert.deepEqual(parseFixedMessages([F1, '', F3]), [F1, '', F3], 'buraco no meio fica; a validação barra na gravação');
  assert.deepEqual(parseFixedMessages(['a', 'b', 'c', 'd', 'e']), ['a', 'b', 'c', 'd']);
  assert.equal(parseFixedMessages(['x'.repeat(2000)])[0].length, 1024);
  assert.deepEqual(parseFixedMessages('nada'), []);
  assert.deepEqual(parseFixedMessages(null), []);
});

test('checkFixedMessages: regras do PUT (lista, ordem, tamanho, ###, marcador e o template da Meta)', () => {
  assert.deepEqual(checkFixedMessages([F1, F2, F3, ''], 'fixed'), { ok: true, value: [F1, F2, F3] });
  assert.deepEqual(checkFixedMessages([], 'ai'), { ok: true, value: [] });
  assert.deepEqual(checkFixedMessages([F1], 'ai'), { ok: true, value: [F1] }, 'modo IA pode guardar textos');
  const errorOf = (value: unknown, mode = 'fixed') => {
    const result = checkFixedMessages(value, mode);
    assert.equal(result.ok, false, JSON.stringify(value));
    return result.ok ? '' : result.error;
  };
  assert.match(errorOf([]), /pelo menos o Follow 01/);
  assert.match(errorOf(['', '  ']), /pelo menos o Follow 01/);
  assert.match(errorOf('texto'), /lista de textos/);
  assert.match(errorOf([1]), /lista de textos/);
  assert.match(errorOf(['a', 'b', 'c', 'd', 'e']), /no máximo 4/);
  assert.match(errorOf([F1, '', F3]), /em ordem/);
  assert.match(errorOf([F1, 'x'.repeat(1025)]), /^Follow 02: use no máximo 1024 caracteres\.$/);
  assert.match(errorOf(['Oi ###SKIP### [nome]!']), /^Follow 01: não use ###\.$/);
  assert.match(errorOf(['Oi [nome] e {nome}!']), /Follow 01: use \[nome\] no máximo uma vez/);
  assert.match(errorOf(['Oi {{2}} [nome]!']), /não use \{\{ \}\} fora do \[nome\]/);
  assert.match(errorOf(['[nome], tudo bem?']), /não comece nem termine com \[nome\]/);
  assert.match(errorOf(['Tudo bem, [nome]']), /não comece nem termine com \[nome\]/);
  for (const text of [F1, F2, F3]) assert.equal(checkFixedMessages([text], 'fixed').ok, true, text);
  for (const message of [errorOf([]), errorOf([F1, '', F3]), errorOf(['[nome]!'])]) assert.ok(!DASH_PATTERN.test(message), message);
});

test('fixedTemplatesInfo: status do cache, NONE vira sem motivo e passo sem linha é NOT_CREATED com o erro lembrado', () => {
  const texts = [F1, F2, F3];
  const rows: FixedTemplateRow[] = [
    { name: fixedTemplateName(1, F1), status: 'approved', rejectionReason: 'NONE' },
    { name: fixedTemplateName(2, F2), status: 'REJECTED', rejectionReason: 'INVALID_FORMAT' },
  ];
  assert.deepEqual(fixedTemplatesInfo(texts, rows, { [fixedTemplateName(3, F3)]: 'Nome já usado' }), [
    { step: 1, name: fixedTemplateName(1, F1), status: 'APPROVED', reason: null },
    { step: 2, name: fixedTemplateName(2, F2), status: 'REJECTED', reason: 'INVALID_FORMAT' },
    { step: 3, name: fixedTemplateName(3, F3), status: FIXED_NOT_CREATED, reason: 'Nome já usado' },
  ]);
  assert.deepEqual(fixedTemplatesInfo([], rows), []);
});

// Criação e acompanhamento na Meta (rede e banco falsos)

interface FakeCall { url: string; method: string; body: any; headers: Record<string, string> }

function metaWorld(opts: {
  rows?: FixedTemplateRow[]; account?: { wabaId: string; token: string } | null; replies?: Array<{ status: number; body: unknown } | Error>;
  rowsFail?: boolean; insertFail?: boolean;
} = {}) {
  const w = {
    calls: [] as FakeCall[], inserted: [] as Array<Record<string, unknown>>, updated: [] as Array<{ name: string; patch: Record<string, unknown> }>,
    logs: [] as Array<{ event: string; data?: Record<string, unknown> }>, accountLoads: 0, replies: [...(opts.replies ?? [])],
  };
  const port: FixedTemplatePort = {
    async rows() { if (opts.rowsFail) throw new Error('banco fora'); return structuredClone(opts.rows ?? []); },
    async account() { w.accountLoads += 1; return opts.account === undefined ? { wabaId: 'waba-1', token: 'token-secreto' } : opts.account; },
    async insert(row) { if (opts.insertFail) throw new Error('insert falhou'); w.inserted.push(structuredClone(row)); },
    async update(_u, name, patch) { w.updated.push({ name, patch: structuredClone(patch) }); },
  };
  const fetchFake = (async (url: string, init: RequestInit) => {
    w.calls.push({ url, method: String(init.method), body: init.body ? JSON.parse(String(init.body)) : null, headers: init.headers as Record<string, string> });
    const reply = w.replies.shift();
    if (!reply) throw new Error('sem resposta configurada');
    if (reply instanceof Error) throw reply;
    return { ok: reply.status >= 200 && reply.status < 300, status: reply.status, json: async () => reply.body } as Response;
  }) as unknown as typeof fetch;
  const deps: EnsureFixedDeps = { port, fetch: fetchFake, log: (event, data) => w.logs.push({ event, data }), now: () => NOW };
  return { w, deps };
}

test('ensureFixedTemplates: sem linha no cache cria na Meta (MARKETING, pt_BR, exemplo Maria) e grava a linha', async () => {
  const { w, deps } = metaWorld({ replies: [
    { status: 200, body: { id: '111', status: 'PENDING', category: 'MARKETING' } },
    { status: 200, body: { id: '222', status: 'APPROVED', category: 'MARKETING' } },
  ] });
  const infos = await ensureFixedTemplates(USER, [F1, 'Sem nome, tudo certo?'], deps);
  assert.deepEqual(infos, [
    { step: 1, name: fixedTemplateName(1, F1), status: 'PENDING', reason: null },
    { step: 2, name: fixedTemplateName(2, 'Sem nome, tudo certo?'), status: 'APPROVED', reason: null },
  ]);
  assert.equal(w.calls[0].url, 'https://graph.facebook.com/v21.0/waba-1/message_templates');
  assert.equal(w.calls[0].method, 'POST');
  assert.equal(w.calls[0].headers.Authorization, 'Bearer token-secreto');
  assert.deepEqual(w.calls[0].body, {
    name: fixedTemplateName(1, F1), category: 'MARKETING', language: 'pt_BR',
    components: [{ type: 'BODY', text: 'Oiiii {{1}}, tudo bem 🥰?\n\nVamos ver uma data para as suas fotos?', example: { body_text: [['Maria']] } }],
  });
  assert.deepEqual(w.calls[1].body.components, [{ type: 'BODY', text: 'Sem nome, tudo certo?' }], 'sem variável não leva exemplo');
  assert.deepEqual(w.inserted[0], {
    user_id: USER, name: fixedTemplateName(1, F1), meta_template_id: '111', category: 'MARKETING', language: 'pt_BR',
    body_text: 'Oiiii {{1}}, tudo bem 🥰?\n\nVamos ver uma data para as suas fotos?', example_values: ['Maria'], status: 'PENDING',
    rejection_reason: null, updated_at: NOW.toISOString(),
  });
  assert.deepEqual(w.inserted[1].example_values, []);
  assert.equal(w.accountLoads, 1, 'conta carregada uma vez por rodada');
  assert.ok(!JSON.stringify(w.logs).includes('token-secreto'), 'o token nunca vai para o log');
});

test('ensureFixedTemplates: em análise consulta o status pelo nome e atualiza; aprovado e recusado não consultam', async () => {
  const name1 = fixedTemplateName(1, F1);
  const { w, deps } = metaWorld({
    rows: [
      { name: name1, status: 'PENDING', metaTemplateId: null },
      { name: fixedTemplateName(2, F2), status: 'APPROVED' },
      { name: fixedTemplateName(3, F3), status: 'REJECTED', rejectionReason: 'Parece promoção' },
    ],
    replies: [{ status: 200, body: { data: [
      { name: `${name1}_outro`, status: 'PENDING', language: 'pt_BR' },
      { id: '999', name: name1, status: 'APPROVED', language: 'pt_BR', rejected_reason: 'NONE' },
    ] } }],
  });
  const infos = await ensureFixedTemplates(USER, [F1, F2, F3], deps);
  assert.deepEqual(infos.map((i) => [i.step, i.status, i.reason]), [[1, 'APPROVED', null], [2, 'APPROVED', null], [3, 'REJECTED', 'Parece promoção']]);
  assert.equal(w.calls.length, 1);
  assert.equal(w.calls[0].method, 'GET');
  assert.equal(w.calls[0].url, `https://graph.facebook.com/v21.0/waba-1/message_templates?name=${name1}&fields=id,name,status,language,category,rejected_reason`);
  assert.deepEqual(w.updated, [{ name: name1, patch: { status: 'APPROVED', rejection_reason: null, updated_at: NOW.toISOString(), meta_template_id: '999' } }]);
  assert.ok(w.logs.some((l) => l.event === 'cadence_fixed_template_status'));
});

test('ensureFixedTemplates: status igual não grava; IN_APPEAL também é consultado', async () => {
  const name = fixedTemplateName(1, F1);
  const { w, deps } = metaWorld({ rows: [{ name, status: 'IN_APPEAL', metaTemplateId: '5' }],
    replies: [{ status: 200, body: { data: [{ id: '5', name, status: 'IN_APPEAL', language: 'pt_BR' }] } }] });
  const [info] = await ensureFixedTemplates(USER, [F1], deps);
  assert.equal(info.status, 'IN_APPEAL');
  assert.equal(w.calls.length, 1);
  assert.equal(w.updated.length, 0);
});

test('ensureFixedTemplates: sem conta da API oficial não chama a Meta e explica o motivo', async () => {
  const { w, deps } = metaWorld({ account: null });
  const infos = await ensureFixedTemplates(USER, [F1, F2], deps);
  assert.deepEqual(infos.map((i) => [i.status, i.reason]), [[FIXED_NOT_CREATED, NO_META_ACCOUNT_REASON], [FIXED_NOT_CREATED, NO_META_ACCOUNT_REASON]]);
  assert.equal(w.calls.length, 0);
  assert.ok(!DASH_PATTERN.test(NO_META_ACCOUNT_REASON));
});

test('ensureFixedTemplates: criação recusada adota o template de mesmo nome que já está na Meta', async () => {
  const name = fixedTemplateName(1, F1);
  const { w, deps } = metaWorld({ replies: [
    { status: 400, body: { error: { code: 100, error_subcode: 2388024, message: 'Content in this language already exists' } } },
    { status: 200, body: { data: [{ id: '77', name, status: 'APPROVED', language: 'pt_BR', category: 'UTILITY' }] } },
  ] });
  const [info] = await ensureFixedTemplates(USER, [F1], deps);
  assert.equal(info.status, 'APPROVED');
  assert.equal(w.inserted[0].meta_template_id, '77');
  assert.equal(w.inserted[0].category, 'UTILITY', 'a Meta pode reclassificar; vale o que ela diz');
});

test('ensureFixedTemplates: erro da Meta sem template lembra o motivo; rede e timeout não lançam', async () => {
  const bad = metaWorld({ replies: [
    { status: 400, body: { error: { message: 'Invalid parameter', error_user_msg: 'O corpo tem variáveis demais.' } } },
    { status: 200, body: { data: [] } },
  ] });
  const [info] = await ensureFixedTemplates(USER, [F1], bad.deps);
  assert.deepEqual(info, { step: 1, name: fixedTemplateName(1, F1), status: FIXED_NOT_CREATED, reason: 'O corpo tem variáveis demais.' });
  assert.equal(bad.w.inserted.length, 0);
  assert.ok(bad.w.logs.some((l) => l.event === 'cadence_fixed_template_create_failed'));

  const timeout = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
  const net = metaWorld({ replies: [timeout, new Error('socket hang up')] });
  const [slow] = await ensureFixedTemplates(USER, [F1], net.deps);
  assert.equal(slow.status, FIXED_NOT_CREATED);
  assert.equal(slow.reason, 'A Meta não respondeu a tempo.');

  const pendingDown = metaWorld({ rows: [{ name: fixedTemplateName(1, F1), status: 'PENDING' }], replies: [new Error('rede caiu')] });
  const [kept] = await ensureFixedTemplates(USER, [F1], pendingDown.deps);
  assert.equal(kept.status, 'PENDING', 'sem resposta da Meta o status fica como estava');
});

test('ensureFixedTemplates: falha ao ler o cache devolve vazio; falha ao gravar segue com o status da Meta', async () => {
  const rowsDown = metaWorld({ rowsFail: true });
  assert.deepEqual(await ensureFixedTemplates(USER, [F1], rowsDown.deps), []);
  assert.equal(rowsDown.w.calls.length, 0);
  const insertDown = metaWorld({ insertFail: true, replies: [{ status: 200, body: { id: '1', status: 'PENDING' } }] });
  const [info] = await ensureFixedTemplates(USER, [F1], insertDown.deps);
  assert.equal(info.status, 'PENDING');
  assert.ok(insertDown.w.logs.some((l) => l.event === 'cadence_fixed_template_save_failed'));
  assert.deepEqual(await ensureFixedTemplates(USER, [], rowsDown.deps), []);
});

test('código sem travessão e sem banco ou servidor direto', () => {
  for (const file of ['followup-fixed.ts', 'followup-fixed.test.ts']) {
    const source = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');
    assert.ok(!DASH_PATTERN.test(source), `${file} tem travessão`);
  }
  const source = readFileSync(new URL('./followup-fixed.ts', import.meta.url), 'utf8');
  assert.ok(!/from '[^']*(supabase|server|baileys-manager)[^']*'/.test(source));
  assert.ok(!/(?<![.\w])fetch\(/.test(source), 'rede só pela dependência injetada (deps.fetch)');
});

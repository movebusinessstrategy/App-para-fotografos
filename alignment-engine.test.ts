import test from 'node:test';
import assert from 'node:assert/strict';
import { AlignmentEngine, applyAlignmentDecision, nextAlignmentField, nextAlignmentText, validateAlignmentDecision, type AlignmentMessage, type AlignmentDecision, type AlignmentStore } from './alignment-engine.js';
import { buildAlignmentSteps, validateAlignmentConfig } from './src/features/alignment/playbook.js';
import type { AlignmentConfig, AlignmentSession } from './src/features/alignment/types.js';

const config: AlignmentConfig = { kind: 'gestante', slot: 'posvenda', packageName: 'Pacote de teste', environments: 'Estúdio interno', productions: 2, hasVideo: false, babyMaterial: '', contractChecked: true };
const message = (body = 'Quero fotos claras', id = 'in-1'): AlignmentMessage => ({ message_id: id, body, from_me: false, type: 'text', timestamp: new Date(Date.now() - 90_000).toISOString() });
const decision = (field = 'intencao', value = 'Fotos claras'): AlignmentDecision => ({ action: 'answer', reason: '', answers: [{ field, value, messageId: 'in-1', quote: 'fotos claras' }] });
function session(): AlignmentSession {
  return { id: 'session-1', user_id: 'owner-a', job_id: 1, phone: '5543999990000', wa_number: '5543999990001', status: 'active', revision: 0,
    updated_at: new Date().toISOString(), data: { config, steps: [...buildAlignmentSteps(config), { id: 'confirmacao', title: 'Confirmação', question: '', materials: [] }],
      answers: {}, asked: 'intencao', seen: [], sent: [], startedAt: new Date(Date.now() - 300_000).toISOString(), pending: null, reason: null, attempts: 0 } };
}
function fixture(initial = session()) {
  let row = structuredClone(initial);
  let messages = [message()];
  const sent: string[] = [];
  let failure: 'send' | 'record' | null = null;
  let evaluator: (s: AlignmentSession) => Promise<AlignmentDecision> = async () => decision();
  const store: AlignmentStore = {
    async get(id, owner) { assert.equal(id, row.id); assert.equal(owner, row.user_id); return structuredClone(row); },
    async save(s, status, data) {
      if (row.revision !== s.revision || row.status !== s.status || row.user_id !== s.user_id) return null;
      row = { ...row, status, data: structuredClone(data), revision: row.revision + 1 };
      return structuredClone(row);
    },
    async messages(s) { assert.equal(s.wa_number, row.wa_number); return structuredClone(messages); },
    async recordSent() { if (failure === 'record') throw new Error('Database unavailable'); },
    async checkJob() {},
  };
  const engine = new AlignmentEngine(store, {
    async check() {}, async send(_s, text) { sent.push(text); if (failure === 'send') throw new Error('Unknown send outcome'); return 'out-1'; },
  }, async s => evaluator(s));
  return { engine, store, sent, row: () => structuredClone(row), messages: (next: AlignmentMessage[]) => { messages = next; },
    failure: (value: typeof failure) => { failure = value; }, evaluate: (fn: typeof evaluator) => { evaluator = fn; } };
}

test('não pergunta música em pacotes sem vídeo, nem confunde revelação e chá', () => {
  for (const kind of ['anunciacao', 'revelacao', 'cha_revelacao'] as const) {
    assert.ok(!buildAlignmentSteps({ ...config, kind }).some(s => s.id === 'musica'));
    assert.ok(buildAlignmentSteps({ ...config, kind, hasVideo: true }).some(s => s.id === 'musica'));
  }
  assert.match(buildAlignmentSteps({ ...config, kind: 'revelacao' })[1].question, /não é permitido/);
  assert.equal(buildAlignmentSteps({ ...config, kind: 'cha_revelacao' })[0].id, 'local');
});
test('newborn respeita três produções e pacote/idade desconhecidos não iniciam', () => {
  assert.match(buildAlignmentSteps({ ...config, kind: 'newborn', productions: 3 })[0].question, /escolher 3/);
  assert.throws(() => validateAlignmentConfig({ ...config, packageName: '' }), /pacote/);
  assert.throws(() => validateAlignmentConfig({ ...config, kind: 'baby', babyMaterial: '' }), /idade/);
  assert.throws(() => validateAlignmentConfig({ ...config, contractChecked: false }), /contrato/);
});
test('informação já combinada é preservada e pulada', () => {
  const s = session(); s.data.answers.intencao = { value: 'Fotos claras', source: 'operator', messageIds: [] };
  assert.equal(nextAlignmentField(s.data), 'ambiente');
  assert.match(nextAlignmentText(s.data), /Estúdio interno/);
});
test('não aceita fatos sem citação da cliente nem confirmação prematura', () => {
  const s = session();
  assert.throws(() => validateAlignmentDecision(decision('intencao', 'Inventado'), s, [message('Bom dia')]), /evidência/);
  assert.throws(() => validateAlignmentDecision(decision('confirmacao'), s, [message()]), /resumo/);
  assert.throws(() => validateAlignmentDecision(decision(), s, [{ ...message(), from_me: true }]), /evidência/);
});
test('corrigir escolha invalida confirmação antiga', () => {
  const s = session(); s.data.asked = 'confirmacao'; s.data.answers.confirmacao = { value: 'Sim', source: 'client', messageIds: ['old'] };
  const updated = applyAlignmentDecision(s, [message()], decision());
  assert.equal(updated.answers.confirmacao, undefined);
  assert.equal(updated.answers.intencao.value, 'Fotos claras');
});
test('mensagem duplicada não gera segundo envio', async () => {
  const f = fixture(); await f.engine.process(f.row()); await f.engine.process(f.row());
  assert.equal(f.sent.length, 1); assert.equal(f.row().data.answers.intencao.value, 'Fotos claras');
  assert.equal(f.row().data.asked, 'ambiente'); assert.equal(f.row().status, 'active');
});
test('dois workers concorrentes só enviam uma pergunta', async () => {
  const f = fixture(); await Promise.all([f.engine.process(f.row()), f.engine.process(f.row())]); assert.equal(f.sent.length, 1);
});
test('cliente que vai escolher depois continua aguardando sem cobrar ou chamar a equipe', async () => {
  const f = fixture(); f.messages([message('Vou olhar com calma')]);
  f.evaluate(async () => ({ action: 'wait', reason: 'Escolhendo', answers: [] }));
  await f.engine.process(f.row()); await f.engine.process(f.row());
  assert.equal(f.sent.length, 0); assert.equal(f.row().status, 'active');
});
test('pausa durante inferência impede envio', async () => {
  const f = fixture(); f.evaluate(async s => { await f.store.save(s, 'paused', s.data); return decision(); });
  await f.engine.process(f.row()); assert.equal(f.sent.length, 0); assert.equal(f.row().status, 'paused');
});
test('mensagem nova durante inferência espera uma nova leitura', async () => {
  const f = fixture(); f.evaluate(async () => { f.messages([message(), message('Na verdade, prefiro contraste', 'in-2')]); return decision(); });
  await f.engine.process(f.row()); assert.equal(f.sent.length, 0); assert.equal(f.row().status, 'active');
  assert.equal(f.row().data.answers.intencao, undefined);
});
test('equipe assumiu, dúvida e mídia ilegível interrompem sem responder', async () => {
  const human = fixture(); human.messages([{ ...message('Vou cuidar disso'), from_me: true }]);
  await human.engine.process(human.row()); assert.equal(human.row().status, 'needs_human'); assert.equal(human.sent.length, 0);
  const media = fixture(); media.messages([{ ...message(''), type: 'image' }]);
  await media.engine.process(media.row()); assert.equal(media.row().status, 'needs_human');
  const question = fixture(); question.evaluate(async () => ({ action: 'human', reason: 'Cliente pediu mudança de data.', answers: [] }));
  await question.engine.process(question.row()); assert.equal(question.row().status, 'needs_human'); assert.equal(question.sent.length, 0);
});
test('falha de envio ou do inbox mantém pendência e nunca repete envio', async () => {
  for (const kind of ['send', 'record'] as const) {
    const f = fixture(); f.failure(kind); await f.engine.process(f.row());
    assert.equal(f.row().status, 'needs_human'); assert.ok(f.row().data.pending);
    if (kind === 'record') assert.equal(f.row().data.pending?.messageId, 'out-1');
    await f.engine.process(f.row()); assert.equal(f.sent.length, 1);
  }
});
test('confirmação final vai para revisão da equipe e para de conversar', async () => {
  const s = session();
  for (const step of s.data.steps.filter(x => x.id !== 'confirmacao')) s.data.answers[step.id] = { value: 'Escolha confirmada', source: 'operator', messageIds: [] };
  s.data.asked = 'confirmacao';
  const f = fixture(s); f.messages([message('Sim, está certo')]);
  f.evaluate(async () => ({ action: 'answer', reason: '', answers: [{ field: 'confirmacao', value: 'Confirmado', messageId: 'in-1', quote: 'Sim, está certo' }] }));
  await f.engine.process(f.row()); assert.equal(f.row().status, 'review'); assert.equal(nextAlignmentField(f.row().data), null);
  assert.equal(f.sent.length, 1);
});

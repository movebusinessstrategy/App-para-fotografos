import test from 'node:test';
import assert from 'node:assert/strict';
import { applyDossierAnswers, planFromPreparation, validatedReferenceNotes } from './dossier-workflow.js';
import { buildAlignmentPreparation } from './src/features/alignment/context.js';
import { fixtureExtraction, simulationSources } from './scripts/alignment-simulation.js';

const prepare = () => planFromPreparation(buildAlignmentPreparation(fixtureExtraction, simulationSources, 'posvenda', true));
test('a área assistida mostra somente as perguntas que faltam', () => {
  const plan = prepare();
  assert.deepEqual(plan.questions.map(q => q.id), ['looks', 'edicao']);
  assert.equal(plan.choices.find(c => c.id === 'pacote')?.value, 'Gestante Memória');
  assert.match(plan.questions[0].message, /drive.google.com/);
});
test('a resposta da equipe completa o dossiê sem alterar as escolhas anteriores', () => {
  const before = prepare();
  const after = applyDossierAnswers(before, { looks: 'Vestido claro', pacote: 'Pacote inexistente', confirmacao: 'sim' });
  assert.deepEqual(after.questions.map(q => q.id), ['edicao']);
  assert.equal(after.preparation.answers.looks.source, 'operator');
  assert.equal(after.preparation.answers.ambiente.source, 'history');
  assert.equal(after.preparation.config.packageName, 'Gestante Memória');
  assert.equal(after.preparation.answers.confirmacao, undefined);
  assert.equal(before.questions.length, 2);
});
test('não inventa uma quantidade de produções quando o pacote é desconhecido', () => {
  const preparation = buildAlignmentPreparation({ config: [{ field: 'kind', value: 'newborn', sourceId: 'x', quote: 'newborn' }], answers: [], issues: [] }, [{ id: 'x', label: 'Trabalho', text: 'newborn' }], 'posvenda', false);
  const plan = planFromPreparation(preparation);
  assert.doesNotMatch(plan.questions[0].question, /escolher 1/);
});
test('legenda de referência exige uma explicação literal da própria cliente', () => {
  const messages = [{ message_id: 'photo', from_me: false }, { message_id: 'text', from_me: false, body: 'Gostei da luz suave desta foto.' }];
  const notes = validatedReferenceNotes(messages, ['photo'], [{ foto_indice: 0, fala_indice: 1, trecho: 'Gostei da luz suave', detalhe: 'Aproveitar a luz suave.' }]);
  assert.equal(notes.photo.messageId, 'text');
  assert.equal(notes.photo.caption, 'Aproveitar a luz suave.');
});
test('não usa comprovante, fala do estúdio ou trecho inventado como referência', () => {
  const messages = [{ message_id: 'payment' }, { message_id: 'photo' }, { message_id: 'text', from_me: true, body: 'Use luz suave' }];
  const raw = [
    { foto_indice: 0, fala_indice: 2, trecho: 'Use luz suave', detalhe: 'Comprovante não é referência' },
    { foto_indice: 1, fala_indice: 2, trecho: 'Use luz suave', detalhe: 'Sugestão não é escolha' },
    { foto_indice: 1, fala_indice: 1, trecho: 'Inventado', detalhe: 'Sem evidência' },
  ];
  assert.deepEqual(validatedReferenceNotes(messages, ['photo'], raw), {});
});
test('foto sem explicação permanece sem legenda inventada', () => {
  assert.deepEqual(validatedReferenceNotes([{ message_id: 'photo' }], ['photo'], []), {});
});

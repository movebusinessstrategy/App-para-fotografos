import assert from 'node:assert/strict';
import test from 'node:test';
import { conversationCustomer, customerPhoneMatches, parsePaymentAmount, preferredSession, scheduleConflicts, sessionWasCompleted } from './src/features/chat/utils/conversationCustomer';
import type { Client, Deal, Job, ProductionStageV2 } from './src/types';

const job = (id: number, props: Partial<Job> = {}): Job => ({ id, client_id: 1, job_type: 'Natal', job_name: 'Natal 2026', status: 'scheduled', job_date: '2026-10-23', job_time: '14:00', job_end_time: '15:00', ...props } as Job);

test('associa telefone formatado, código do país e nono dígito sem confundir DDD', () => {
  assert.ok(customerPhoneMatches('+55 (43) 99909-3114', '43 9909-3114'));
  assert.ok(!customerPhoneMatches('43999093114', '11999093114'));
  assert.ok(!customerPhoneMatches('', ''));
  assert.ok(!customerPhoneMatches('99093114', '43999093114'));
});

test('venda convertida encontra a cliente e todos os ensaios, mesmo com telefone antigo no cadastro', () => {
  const clients = [{ id: 1, phone: '11911112222' }, { id: 2, phone: '43911112222' }] as Client[];
  const deals = [{ id: '7', contact_phone: '43999093114', converted_client_id: 1, converted_job_id: 10 }] as Deal[];
  const jobs = [job(10, { deal_id: 7 }), job(11), job(12, { client_id: 2 })];
  const context = conversationCustomer('554399093114', clients, deals, jobs);
  assert.deepEqual(context.clients.map(item => item.id), [1]);
  assert.deepEqual(context.jobs.map(item => item.id), [10, 11]);
});

test('jobs de uma venda continuam visíveis mesmo antes de completar o vínculo da cliente', () => {
  const context = conversationCustomer('43999093114', [], [{ id: '7', contact_phone: '43999093114' }] as Deal[], [job(10, { client_id: null as any, deal_id: 7 }), job(11)]);
  assert.deepEqual(context.jobs.map(item => item.id), [10]);
});

test('conta realizados sem incluir cancelamentos, pré-reservas ou apenas datas passadas', () => {
  const stages = [{ id: 'done', process_id: 'photo', name: 'Ensaio Realizado', position: 2 }, { id: 'editing', process_id: 'photo', name: 'Edição', position: 3 }] as ProductionStageV2[];
  assert.ok(sessionWasCompleted(job(1, { status: 'completed' }), stages));
  assert.ok(sessionWasCompleted(job(1, { production_stage: 'editing' }), stages));
  assert.ok(!sessionWasCompleted(job(1, { status: 'cancelled', production_stage: 'editing' }), stages));
  assert.ok(!sessionWasCompleted(job(1, { status: 'pre_reserved', production_stage: 'done' }), stages));
  assert.ok(!sessionWasCompleted(job(1, { job_date: '2020-01-01' }), stages));
});

test('prefere o próximo ensaio ativo e mantém trabalhos sem data disponíveis', () => {
  const jobs = [job(1, { job_date: '2026-10-25' }), job(2, { status: 'cancelled', job_date: '2026-10-20' }), job(3, { job_date: '2026-10-23' })];
  assert.equal(preferredSession(jobs, '2026-10-10')?.id, 3);
  assert.equal(preferredSession([job(4, { job_date: '' })])?.id, 4);
});

test('pagamento aceita reais com vírgula, impede valor inválido e soma sem substituir sinal', () => {
  assert.equal(parsePaymentAmount('347,00'), 347);
  assert.equal(parsePaymentAmount('R$ 1.347,50'), 1347.5);
  assert.equal(parsePaymentAmount('347.00'), 347);
  assert.equal(100 + parsePaymentAmount('347,00'), 447);
  for (const value of ['-20', 'NaN', '1e9', '12,345', '0', '']) assert.equal(parsePaymentAmount(value), 0, value);
});

test('agenda detecta sobreposição, ignora o próprio ensaio e permite horários consecutivos', () => {
  const jobs = [job(1), job(2), job(3, { status: 'cancelled' }), job(4, { job_date: '2026-10-24' })];
  assert.deepEqual(scheduleConflicts(jobs, 1, '2026-10-23', '14:30', '15:30').map(item => item.id), [2]);
  assert.equal(scheduleConflicts(jobs, 1, '2026-10-23', '15:00', '16:00').length, 0);
  assert.equal(scheduleConflicts([job(2, { job_time: '', job_end_time: '' })], 1, '2026-10-23', '15:00', '16:00').length, 1);
});

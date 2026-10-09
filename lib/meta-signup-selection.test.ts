import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveMetaSignupSelection, selectMetaSignupPhone, parseMetaSignupSession } from './meta-signup-selection.js';

const current = { waba_id: '490', phone_number_id: '497' };
const authorized = ['424', '232', '490'];

test('reconexão preserva o número atual quando a primeira WABA é de teste', () => {
  assert.deepEqual(resolveMetaSignupSelection(authorized, {}, current), current);
});
test('seleção explícita da Meta prevalece sobre ordem e conta anterior', () => {
  const chosen = { waba_id: '232', phone_number_id: '999' };
  assert.deepEqual(resolveMetaSignupSelection(authorized, chosen, current), chosen);
});
test('não substitui silenciosamente uma conta que perdeu autorização', () => {
  assert.throws(() => resolveMetaSignupSelection(['424'], {}, current), /não foi autorizada/);
});
test('primeira conexão exige escolha quando há múltiplas contas ou números', () => {
  assert.throws(() => resolveMetaSignupSelection(authorized, {}, null), /várias contas/);
  assert.throws(() => resolveMetaSignupSelection([], {}, null), /nenhuma seleção/);
  assert.deepEqual(resolveMetaSignupSelection(['490'], {}, null), { waba_id: '490' });
  assert.throws(() => selectMetaSignupPhone([{ id: '1' }, { id: '2' }]), /não confirmou/);
});
test('número pedido deve pertencer à WABA; nunca usa o primeiro como fallback', () => {
  assert.throws(() => selectMetaSignupPhone([{ id: '123' }], '497'), /não confirmou/);
  assert.deepEqual(selectMetaSignupPhone([{ id: '123' }, { id: '497' }], '497'), { id: '497' });
  assert.deepEqual(selectMetaSignupPhone([{ id: '497' }]), { id: '497' });
});
test('token de sistema aceita seleção explícita sem escopos granulares', () => {
  assert.deepEqual(resolveMetaSignupSelection([], current, null), current);
  assert.throws(() => resolveMetaSignupSelection(authorized, { phone_number_id: '497' }, current), /conta e o número/);
});
test('captura seleção concluída somente das origens oficiais da Meta', () => {
  const event = { type: 'WA_EMBEDDED_SIGNUP', event: 'FINISH', data: current };
  assert.deepEqual(parseMetaSignupSession('https://www.facebook.com', JSON.stringify(event)), current);
  assert.deepEqual(parseMetaSignupSession('https://web.facebook.com', { ...event, event: 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING' }), current);
  for (const origin of ['https://facebook.com.evil.test', 'https://evil.test']) {
    assert.equal(parseMetaSignupSession(origin, event), null);
  }
  for (const raw of ['bad json', null, { ...event, event: 'CANCEL' }, { ...event, data: { waba_id: '490' } }]) {
    assert.equal(parseMetaSignupSession('https://www.facebook.com', raw), null);
  }
});

test('Coexistência aceita o retorno documentado com apenas waba_id e exige telefone único', () => {
  const event = { type: 'WA_EMBEDDED_SIGNUP', event: 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING', data: { waba_id: '232' } };
  const selection = parseMetaSignupSession('https://www.facebook.com', event);
  assert.deepEqual(selection, { waba_id: '232' });
  assert.deepEqual(resolveMetaSignupSelection(authorized, selection!, current), { waba_id: '232' });
  assert.deepEqual(selectMetaSignupPhone([{ id: '999' }], selection?.phone_number_id), { id: '999' });
  assert.throws(() => selectMetaSignupPhone([{ id: '999' }, { id: '888' }], selection?.phone_number_id), /não confirmou/);
});

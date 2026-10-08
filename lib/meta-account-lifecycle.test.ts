import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMetaAccountUpdate, isMetaAccountOffboarded, META_RECONNECT_MESSAGE } from './meta-account-lifecycle.js';
const now = '2026-10-08T17:00:00Z';
test('offboarding encerra importação e invalida estado operacional sem apagar progresso', () => {
  for (const event of ['ACCOUNT_OFFBOARDED', 'PARTNER_REMOVED']) {
    const previous = { meta_operational: true, history: { progress: 55 }, phone_status: { platform_type: 'CLOUD_API', status: 'CONNECTED' } };
    const patch = buildMetaAccountUpdate({ event }, previous, now);
    assert.equal(patch.sync_status, 'failed'); assert.equal(patch.sync_error, META_RECONNECT_MESSAGE);
    assert.equal(patch.sync_details.meta_operational, false);
    assert.deepEqual(patch.sync_details.history, { progress: 55 });
    assert.equal(patch.sync_details.phone_status.status, 'DISCONNECTED');
    assert.equal(isMetaAccountOffboarded(patch.sync_details), true);
    assert.equal(previous.phone_status.status, 'CONNECTED');
  }
});
test('atualização comum não invalida a conta; revalidação oficial permite novo histórico', () => {
  const patch = buildMetaAccountUpdate({ event: 'ACCOUNT_UPDATED' }, { meta_operational: true }, now);
  assert.equal('sync_status' in patch, false);
  assert.equal(isMetaAccountOffboarded(patch.sync_details), false);
  assert.equal(isMetaAccountOffboarded({ account_update: { payload: { event: 'ACCOUNT_OFFBOARDED' } }, meta_operational: true }), false);
});

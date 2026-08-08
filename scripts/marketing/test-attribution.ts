import assert from 'node:assert/strict';
import { metaWhatsAppTouchpointRow } from '../../marketing-attribution.js';

const row = metaWhatsAppTouchpointRow({
  userId: '00000000-0000-0000-0000-000000000001',
  phone: '5516999999999',
  waNumber: '5516111111111',
  messageId: 'wamid.test',
  messageTimestamp: '1786190400',
  referral: {
    source_url: 'https://www.facebook.com/ads/example',
    source_type: 'ad',
    source_id: '123456789',
    headline: 'Ensaio fotográfico',
    ctwa_clid: 'AR-test-click-id',
  },
});

assert.ok(row);
assert.equal(row.source, 'meta_click_to_whatsapp');
assert.equal(row.ctwa_clid, 'AR-test-click-id');
assert.equal(row.ad_id, '123456789');
assert.equal(row.external_event_id, 'wamid.test');
assert.deepEqual(row.metadata, { source_type: 'ad', headline: 'Ensaio fotográfico' });
assert.equal(metaWhatsAppTouchpointRow({ userId: 'u', phone: 'p', referral: null }), null);
assert.equal(metaWhatsAppTouchpointRow({ userId: 'u', phone: 'p', referral: { headline: 'sem origem' } }), null);

console.log('marketing attribution parser: ok');


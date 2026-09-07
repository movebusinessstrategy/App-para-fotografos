import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildSmbAppDataPayload,
  normalizeMetaWebhookPayload,
  normalizeSyncTypes,
  parseChannelPreference,
  selectWhatsAppChannel,
} from './meta-whatsapp-coexistence.js';
import { isMetaPhoneOperational } from './meta-whatsapp-channel.js';
import { singleActiveMetaAccount } from './meta-whatsapp-runtime.js';

test('normaliza todos entries, changes, messages e statuses do mesmo webhook', () => {
  const events = normalizeMetaWebhookPayload({
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'waba-1',
        changes: [{
          field: 'messages',
          value: {
            metadata: { phone_number_id: 'phone-1', display_phone_number: '+55 11 99999-0000' },
            contacts: [{ wa_id: '5511888880001', profile: { name: 'Cliente Um' } }],
            messages: [
              { id: 'wamid.1', from: '5511888880001', timestamp: '1787220000', type: 'text', text: { body: 'Oi' } },
              { id: 'wamid.2', from: '5511888880002', timestamp: '1787220001', type: 'image', image: { id: 'media-2', caption: 'Foto' } },
            ],
            statuses: [{ id: 'wamid.out', status: 'delivered', timestamp: '1787220002' }],
          },
        }],
      },
      {
        id: 'waba-2',
        changes: [{
          field: 'account_update',
          value: { phone_number_id: 'phone-2', event: 'PARTNER_APP_INSTALLED' },
        }],
      },
    ],
  });

  assert.equal(events.length, 4);
  assert.deepEqual(events.map(event => event.kind), ['status', 'message', 'message', 'account_update']);
  assert.equal(events[2].message?.mediaId, 'media-2');
  assert.equal(events[1].message?.raw._contact_name, 'Cliente Um');
  assert.equal(events[3].phoneNumberId, 'phone-2');
});

test('normaliza history, app-state e ecos enviados pelo celular', () => {
  const events = normalizeMetaWebhookPayload({
    entry: [{
      id: 'waba-1',
      changes: [
        {
          field: 'history',
          value: {
            metadata: { phone_number_id: 'phone-1', display_phone_number: '5511999990000' },
            history: [{
              phase: 'complete',
              chunk_order: 2,
              progress: 100,
              threads: [{
                id: '5511888880000',
                messages: [
                  { id: 'history-1', from: '5511888880000', to: '5511999990000', type: 'text', text: { body: 'Antiga' } },
                  { id: 'history-2', from: '5511999990000', to: '5511888880000', type: 'text', text: { body: 'Resposta antiga' } },
                  { id: 'history-3', type: 'text', text: { body: 'Sem from/to' }, history_context: { status: 'received' } },
                ],
              }],
            }],
          },
        },
        {
          field: 'smb_message_echoes',
          value: {
            metadata: { phone_number_id: 'phone-1', display_phone_number: '5511999990000' },
            message_echoes: [{ id: 'echo-1', from: '5511999990000', to: '5511888880000', type: 'text', text: { body: 'Do celular' } }],
          },
        },
        {
          field: 'smb_app_state_sync',
          value: { phone_number_id: 'phone-1', state: 'FINISHED' },
        },
      ],
    }],
  });

  assert.deepEqual(events.map(event => event.kind), ['history', 'history', 'history', 'smb_message_echo', 'smb_app_state_sync']);
  assert.equal(events[0].message?.fromMe, false);
  assert.equal(events[0].message?.raw.history_context && (events[0].message?.raw.history_context as { id?: string }).id, '5511888880000');
  assert.equal((events[0].message?.raw.history_context as { progress?: number }).progress, 100);
  assert.equal(events.slice(0, 3).filter(event => (
    (event.message?.raw.history_context as { sync_checkpoint?: boolean }).sync_checkpoint === true
  )).length, 1);
  assert.equal(events[1].message?.fromMe, true);
  assert.equal(events[1].message?.customerPhone, '5511888880000');
  assert.equal(events[2].message?.customerPhone, '5511888880000');
  assert.equal(events[3].message?.fromMe, true);
  assert.equal(events[3].message?.customerPhone, '5511888880000');
});

test('gera chaves estáveis e distintas para retries e mudanças de status', () => {
  const payload = {
    entry: [{ id: 'waba', changes: [{ field: 'messages', value: {
      metadata: { phone_number_id: 'phone' },
      statuses: [
        { id: 'wamid.1', status: 'sent', timestamp: '1' },
        { id: 'wamid.1', status: 'read', timestamp: '2' },
      ],
    } }] }],
  };
  const first = normalizeMetaWebhookPayload(payload);
  const retry = normalizeMetaWebhookPayload(payload);

  assert.equal(first[0].eventKey, retry[0].eventKey);
  assert.notEqual(first[0].eventKey, first[1].eventKey);

  const otherTenant = normalizeMetaWebhookPayload({
    ...payload,
    entry: [{ ...(payload.entry[0]), id: 'waba-other' }],
  });
  assert.notEqual(first[0].eventKey, otherTenant[0].eventKey);
});

test('valida sync types e monta smb_app_data sem aceitar valores arbitrários', () => {
  assert.deepEqual(normalizeSyncTypes(undefined), ['smb_app_state_sync', 'history']);
  assert.deepEqual(normalizeSyncTypes(['history', 'history', 'invalid']), ['history']);
  assert.deepEqual(buildSmbAppDataPayload('history'), {
    messaging_product: 'whatsapp',
    sync_type: 'history',
  });
});

test('seleção de canal é por conta e não faz fallback silencioso quando explícita', () => {
  assert.equal(parseChannelPreference('meta'), 'meta');
  assert.equal(parseChannelPreference('global'), null);
  assert.equal(selectWhatsAppChannel('meta', { meta: false, baileys: true }), null);
  assert.equal(selectWhatsAppChannel('baileys', { meta: true, baileys: false }), null);
  assert.equal(selectWhatsAppChannel('auto', { meta: true, baileys: true }), 'meta');
  assert.equal(selectWhatsAppChannel('auto', { meta: true, baileys: false }), 'meta');
});

test('só considera Meta operacional com Cloud API conectada e Coexistence confirmado', () => {
  assert.equal(isMetaPhoneOperational({
    platform_type: 'CLOUD_API', status: 'CONNECTED', is_on_biz_app: true,
  }, 'coexistence'), true);
  assert.equal(isMetaPhoneOperational({
    platform_type: 'CLOUD_API', status: 'DISCONNECTED', is_on_biz_app: true,
  }, 'coexistence'), false);
  assert.equal(isMetaPhoneOperational({
    platform_type: 'CLOUD_API', status: 'CONNECTED', is_on_biz_app: null,
  }, 'coexistence'), false);
  assert.equal(isMetaPhoneOperational({
    platform_type: 'CLOUD_API', status: 'CONNECTED', is_on_biz_app: null,
  }, 'cloud_api'), true);
});

test('rejeita phone_number_id ambíguo em vez de escolher tenant arbitrário', () => {
  assert.equal(singleActiveMetaAccount([], 'phone_number_id p1'), null);
  assert.deepEqual(singleActiveMetaAccount([{ user_id: 'tenant-1' }], 'phone_number_id p1'), { user_id: 'tenant-1' });
  assert.throws(
    () => singleActiveMetaAccount([{ user_id: 'tenant-1' }, { user_id: 'tenant-2' }], 'phone_number_id p1'),
    /mais de uma conta ativa/,
  );
});

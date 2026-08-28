import assert from 'node:assert/strict';
import test from 'node:test';
import {
  captureMarketingWhatsAppContact,
  marketingWhatsAppContactRpcArgs,
} from './lib/marketing-whatsapp-contact.js';

const USER_ID = '56dd4834-ed5e-42b6-9a79-dc896a9a756f';

test('normaliza somente os identificadores necessários para o RPC', () => {
  const args = marketingWhatsAppContactRpcArgs({
    userId: ` ${USER_ID} `,
    phone: '+55 (43) 99999-1111',
    waNumber: '+55 43 3333-4444',
    messageId: ' wamid.123 ',
    messageBody: ' Olá, referência GP-A1B2C3 ',
    occurredAt: '2026-08-28T10:30:00-03:00',
    ctwaClid: ' real-click-id ',
    wabaId: ' real-waba ',
    referral: {
      source_url: 'https://www.facebook.com/ads/private?lead=secret#contact',
      source_id: ' ad-123 ',
      source_type: ' ad ',
      media_type: ' image ',
    },
  });

  assert.deepEqual(args, {
    p_user_id: USER_ID,
    p_phone: '5543999991111',
    p_wa_number: '554333334444',
    p_message_id: 'wamid.123',
    p_message_body: 'Olá, referência GP-A1B2C3',
    p_occurred_at: '2026-08-28T13:30:00.000Z',
    p_ctwa_clid: 'real-click-id',
    p_waba_id: 'real-waba',
    p_referral_attribution: {
      source_url: 'https://www.facebook.com',
      ad_id: 'ad-123',
      source_type: 'ad',
      media_type: 'image',
    },
  });
});

test('rejeita evento sem tenant, mensagem ou telefone', () => {
  const base = { userId: USER_ID, phone: '5543999991111', waNumber: '554333334444', messageId: 'm1' };
  assert.equal(marketingWhatsAppContactRpcArgs({ ...base, userId: '' }), null);
  assert.equal(marketingWhatsAppContactRpcArgs({ ...base, phone: '' }), null);
  assert.equal(marketingWhatsAppContactRpcArgs({ ...base, phone: '5543' }), null);
  assert.equal(marketingWhatsAppContactRpcArgs({ ...base, messageId: '' }), null);
  assert.equal(marketingWhatsAppContactRpcArgs({ ...base, waNumber: '' }), null);
});

test('devolve o estado idempotente retornado pelo banco', async () => {
  const calls: unknown[] = [];
  const db = {
    rpc: async (name: string, args: unknown) => {
      calls.push({ name, args });
      return { data: [{ result_status: 'duplicate' }], error: null };
    },
  } as any;

  const result = await captureMarketingWhatsAppContact(db, {
    userId: USER_ID, phone: '5543999991111', waNumber: '554333334444', messageId: 'm1',
  });

  assert.equal(result.status, 'duplicate');
  assert.equal((calls[0] as any).name, 'capture_marketing_whatsapp_contact');
});

test('migration ausente desativa a captura sem quebrar o recebimento', async () => {
  const db = {
    rpc: async () => ({ data: null, error: { code: 'PGRST202', message: 'function missing' } }),
  } as any;

  const result = await captureMarketingWhatsAppContact(db, {
    userId: USER_ID, phone: '5543999991111', waNumber: '554333334444', messageId: 'm1',
  });

  assert.equal(result.status, 'migration_missing');
});

test('não confunde mensagem ampla com migration ausente sem código específico', async () => {
  const databaseError = {
    code: 'XX000',
    message: 'capture_marketing_whatsapp_contact failed near marketing_conversion_outbox',
  };
  const db = {
    rpc: async () => ({ data: null, error: databaseError }),
  } as any;

  await assert.rejects(
    () => captureMarketingWhatsAppContact(db, {
      userId: USER_ID, phone: '5543999991111', waNumber: '554333334444', messageId: 'm2',
    }),
    error => error === databaseError,
  );
});

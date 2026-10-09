import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldProcessMessageUpsert, isHistoricalUpsert } from './whatsapp-upsert-policy.js';
import { messageHistoryAnchor, conversationIsNewer, historyChatUpdate } from './whatsapp-history-integrity.js';

test('mensagens offline são preservadas sem responder entradas antigas; ecos próprios mantêm handoff', () => {
  for (const fromMe of [true, false]) {
    assert.equal(shouldProcessMessageUpsert('append', fromMe), true);
    assert.equal(isHistoricalUpsert('append', fromMe), !fromMe);
    assert.equal(shouldProcessMessageUpsert('notify', fromMe), true);
    assert.equal(isHistoricalUpsert('notify', fromMe), false);
  }
  assert.equal(shouldProcessMessageUpsert('unknown', false), false);
});

test('pedido de histórico mantém o telefone exato e extrai a chave nativa da mensagem Meta', () => {
  const phone = '5511990001234';
  const id = '3A0123456789ABCDEF01';
  const bytes = Buffer.concat([Buffer.from([0x1c, 0x18, phone.length]), Buffer.from(phone), Buffer.from([0x15, 0x02, 0, 0x12, 0x18, id.length]), Buffer.from(id), Buffer.from([0])]);
  const timestamp = '2026-10-09T13:00:00Z';
  const anchor = messageHistoryAnchor({ phone, message_id: 'wamid.' + bytes.toString('base64'), from_me: false, timestamp });
  assert.deepEqual(anchor, { phone, id, fromMe: false, timestampMs: Date.parse(timestamp) });
  assert.equal(messageHistoryAnchor({ phone, message_id: 'wamid.invalid', from_me: false, timestamp }), null);
});

test('histórico antigo não rebaixa data nem contagem de leitura de uma conversa nova', () => {
  const payload = { last_message_at: '2026-10-08T13:00:00Z', unread_count: 4, contact_name: 'Contato', archived: false };
  assert.deepEqual(historyChatUpdate(payload, '2026-10-09T13:00:00Z'), { contact_name: 'Contato', archived: false });
  assert.deepEqual(historyChatUpdate(payload, '2026-10-07T13:00:00Z'), payload);
  assert.equal(conversationIsNewer('2026-10-09T13:00:00+00:00', '2026-10-09T13:00:00.000Z'), false);
  assert.equal(conversationIsNewer('2026-10-09T13:00:01+00:00', '2026-10-09T13:00:00.000Z'), true);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { incomingContentType, unwrapIncomingContent } from './whatsapp-message-content.js';

test('texto com messageContextInfo na frente (resposta da IA da Meta) é reconhecido', () => {
  const message = {
    messageContextInfo: { botMetadata: { personaId: 'meta_ai' } },
    extendedTextMessage: { text: 'Oi! Posso te ajudar com o ensaio?' },
  };
  const content = unwrapIncomingContent(message);
  assert.equal(incomingContentType(content), 'extendedTextMessage');
  assert.equal(content.extendedTextMessage.text, 'Oi! Posso te ajudar com o ensaio?');
});

test('envelopes de bot, temporária e documento com legenda são abertos', () => {
  const bot = unwrapIncomingContent({ botInvokeMessage: { message: { conversation: 'Resposta da IA' } } });
  assert.equal(incomingContentType(bot), 'conversation');
  assert.equal(bot.conversation, 'Resposta da IA');

  const ephemeral = unwrapIncomingContent({ ephemeralMessage: { message: { conversation: 'some em 24h' } } });
  assert.equal(incomingContentType(ephemeral), 'conversation');

  const doc = unwrapIncomingContent({
    documentWithCaptionMessage: { message: { documentMessage: { fileName: 'GESTANTE 2026.pdf', caption: 'Segue' } } },
  });
  assert.equal(incomingContentType(doc), 'documentMessage');
  assert.equal(doc.documentMessage.fileName, 'GESTANTE 2026.pdf');
});

test('mensagem só de metadados ou vazia não tem tipo', () => {
  assert.equal(incomingContentType(unwrapIncomingContent({ messageContextInfo: {} })), '');
  assert.equal(incomingContentType(unwrapIncomingContent({ senderKeyDistributionMessage: {} })), '');
  assert.equal(incomingContentType(unwrapIncomingContent(undefined)), '');
});

test('mensagem simples continua igual', () => {
  const content = unwrapIncomingContent({ conversation: 'oi' });
  assert.equal(incomingContentType(content), 'conversation');
  assert.equal(content.conversation, 'oi');
});

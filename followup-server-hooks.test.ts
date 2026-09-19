// Ganchos mínimos da cadência e do funil dentro do server.ts (não dá para importar o
// servidor no teste): confere a ordem das travas no código-fonte.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const server = readFileSync(new URL('./server.ts', import.meta.url), 'utf8');

function bodyOf(signature: string, size = 15000): string {
  const start = server.indexOf(signature);
  assert.ok(start >= 0, `não achei ${signature}`);
  return server.slice(start, start + size);
}

test('Aurora/Lia: opt-out passa a conversa para uma pessoa antes de reservar a mensagem', () => {
  const body = bodyOf('async function runAutonomousReply(');
  const optout = body.indexOf('await isOptedOut(supabaseAdmin, userId, phone)');
  const claim = body.indexOf('if (!await claimAgentMessage(userId, phone, waNumber, claimedMessageId)) return;');
  assert.ok(optout > 0 && claim > optout);
  assert.match(body.slice(optout, claim), /markConversationForHuman\(userId, phone, waNumber, 'pessoa'\)/);
});

test('Baileys: o funil observa a mensagem mesmo quando o insert em wa_messages falha', () => {
  const at = server.indexOf("provider: 'baileys', type: msgType");
  assert.ok(at > 0);
  const guard = server.lastIndexOf('if (', server.lastIndexOf('await observeFunnel({', at));
  const line = server.slice(guard, server.indexOf('\n', guard));
  assert.equal(line.trim(), "if (!isHistory && slot === 'main') {");
});

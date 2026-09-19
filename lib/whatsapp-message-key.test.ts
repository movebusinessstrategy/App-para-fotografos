import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { waMessageKeyId } from './whatsapp-message-key.js';

const sql = readFileSync(new URL('../migrations/085_wa_message_key_dedupe.sql', import.meta.url), 'utf8');

// Telefone e ids sintéticos: nenhum dado real de cliente.
const FAKE_PHONE = '5543900000000';
const FAKE_BSUID = 'BR.1234567890123456';
const IPHONE_ID = '3A0123456789ABCDEF01';
const WEB_ID = '3EB0ABCDEF0123456789AB';

type WamidParts = { head?: number[]; remote?: string; kind?: number; flag?: number; key?: Buffer; tail?: number[] };

function wamidBytes(parts: WamidParts = {}): Buffer {
  const remote = Buffer.from(parts.remote ?? FAKE_PHONE, 'latin1');
  const key = parts.key ?? Buffer.from(IPHONE_ID, 'latin1');
  return Buffer.concat([
    Buffer.from(parts.head ?? [0x1c, 0x18, remote.length]), remote,
    Buffer.from([0x15, parts.kind ?? 0x02, 0x00, parts.flag ?? 0x12, 0x18, key.length]), key,
    Buffer.from(parts.tail ?? [0x00]),
  ]);
}

const wamid = (parts: WamidParts = {}, encoding: 'base64' | 'base64url' = 'base64') =>
  `wamid.${wamidBytes(parts).toString(encoding)}`;

test('wamid recebido (telefone, 0x12) devolve o key.id', () => {
  assert.equal(waMessageKeyId(wamid()), IPHONE_ID);
  const android = '0123456789ABCDEF0123456789ABCDEF';
  assert.equal(waMessageKeyId(wamid({ key: Buffer.from(android) })), android);
});

test('eco do app (remote BR., 0x11) devolve o key.id do Baileys', () => {
  const echo = wamid({ remote: FAKE_BSUID, kind: 0x14, flag: 0x11, key: Buffer.from(WEB_ID) });
  assert.equal(waMessageKeyId(echo), WEB_ID);
});

test('base64 url-safe e sem padding dá o mesmo resultado do padrão', () => {
  // remote de 12 bytes força '+' e '/' no base64 padrão deste caso
  const parts = { key: Buffer.from('3EB0>?>?>?>?>?>?'), remote: 'ûÿþ'.repeat(4) };
  const standard = wamid(parts);
  const urlSafe = wamid(parts, 'base64url');
  assert.notEqual(standard, urlSafe);
  assert.equal(waMessageKeyId(standard), '3EB0>?>?>?>?>?>?');
  assert.equal(waMessageKeyId(urlSafe), '3EB0>?>?>?>?>?>?');
  assert.equal(waMessageKeyId(standard.replace(/=+$/, '')), '3EB0>?>?>?>?>?>?');
});

test('não-wamid volta igual; null e undefined viram null', () => {
  for (const value of [WEB_ID, '', 'auto-1726700000000-5543900000000', 'blast-1', 'WAMID.HBgM', ' wamid.HBgM']) {
    assert.equal(waMessageKeyId(value), value);
  }
  assert.equal(waMessageKeyId(null), null);
  assert.equal(waMessageKeyId(undefined), null);
});

test('wamid inválido volta o próprio valor', () => {
  const nonAscii = Buffer.from(IPHONE_ID);
  nonAscii[4] = 0xc3;
  const withSpace = Buffer.from(IPHONE_ID);
  withSpace[4] = 0x20;
  const truncated = wamidBytes().subarray(0, 3 + FAKE_PHONE.length + 6 + 5);
  const cases = [
    'wamid.', 'wamid.???', 'wamid.AAAA', 'wamid.A', 'wamid.HBgM=A', 'wamid.HBg M', 'wamid.HBgMA===',
    wamid({ head: [0x1d, 0x18, FAKE_PHONE.length] }),
    wamid({ head: [0x1c, 0x19, FAKE_PHONE.length] }),
    wamid({ key: Buffer.from('3A01234') }),
    wamid({ key: Buffer.from('A'.repeat(65)) }),
    wamid({ key: nonAscii }),
    wamid({ key: withSpace }),
    wamid({ head: [0x1c, 0x18, 0x80] }),
    `wamid.${truncated.toString('base64')}`,
    `wamid.${Buffer.from([0x1c, 0x18]).toString('base64')}`,
  ];
  for (const value of cases) assert.equal(waMessageKeyId(value), value, value);
});

test('limites do key.id: 8 e 64 caracteres passam', () => {
  assert.equal(waMessageKeyId(wamid({ key: Buffer.from('ABCDEFGH') })), 'ABCDEFGH');
  assert.equal(waMessageKeyId(wamid({ key: Buffer.from('B'.repeat(64)) })), 'B'.repeat(64));
});

test('nunca lança com lixo aleatório atrás de wamid.', () => {
  let seed = 42;
  const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648);
  for (let n = 0; n < 2000; n += 1) {
    const bytes = Buffer.from(Array.from({ length: next() % 80 }, () => next() % 256));
    if (n % 2 === 0 && bytes.length > 2) bytes.set([0x1c, 0x18], 0);
    const value = `wamid.${bytes.toString(n % 3 === 0 ? 'base64url' : 'base64')}`;
    assert.equal(typeof waMessageKeyId(value), 'string');
  }
});

// Tira comentários e corpos $tag$...$tag$ para olhar só os comandos de topo.
function topLevelStatements(source: string): string[] {
  const noBodies = source.replace(/\$(\w*)\$[\s\S]*?\$\1\$/g, '$$body$$');
  const noComments = noBodies.replace(/--[^\n]*/g, '');
  return noComments.split(';').map((s) => s.trim().toLowerCase().replace(/\s+/g, ' ')).filter(Boolean);
}

test('085: função IMMUTABLE com fallback, GRANT para service_role e índice CONCURRENTLY fora de transação', () => {
  assert.match(sql, /create or replace function public\.wa_message_key_id\(raw text\)/i);
  assert.match(sql, /language plpgsql\s+immutable\s+parallel safe/i);
  assert.match(sql, /exception when others then\s+return raw;/i);
  assert.match(sql, /grant execute on function public\.wa_message_key_id\(text\) to service_role;/i);
  assert.doesNotMatch(sql, /^\s*revoke/im);
  assert.match(sql, /rodar SOZINHO, fora de transação, fora do pico/);
  assert.match(sql, /drop index if exists public\.wa_messages_key_id_uidx/i);

  const statements = topLevelStatements(sql);
  const indexAt = statements.findIndex((s) => s.startsWith('create unique index concurrently if not exists wa_messages_key_id_uidx'));
  assert.ok(indexAt >= 0, 'CREATE UNIQUE INDEX CONCURRENTLY presente e ativo');
  assert.match(statements[indexAt], /on public\.wa_messages \(user_id, public\.wa_message_key_id\(message_id\)\) where message_id is not null$/);

  let depth = 0;
  for (const statement of statements.slice(0, indexAt)) {
    if (/^(begin|start transaction)\b/.test(statement)) depth += 1;
    if (/^(commit|end|rollback)\b/.test(statement)) depth -= 1;
  }
  assert.equal(depth, 0, 'nenhum BEGIN aberto envolvendo o CREATE INDEX');
  assert.ok(statements.slice(indexAt + 1).every((s) => !/^(commit|end|rollback)\b/.test(s)), 'nada fecha transação depois do índice');
});

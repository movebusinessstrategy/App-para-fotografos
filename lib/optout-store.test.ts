import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalPhoneKey } from './br-phone.js';
import { isMissingSchemaError, isOptedOut, loadOptOutKeys, optOutSetHas } from './optout-store.js';

type Row = Record<string, unknown>;
type DbError = { code: string; message: string };

// Supabase falso em memória: aplica eq/is/order/range/limit sobre as linhas.
function fakeDb(opts: { rows?: Row[]; error?: DbError; throws?: boolean }) {
  const calls: Array<{ table: string; ranges: Array<[number, number]> }> = [];
  const db = {
    from(table: string) {
      const preds: Array<(r: Row) => boolean> = [];
      const call = { table, ranges: [] as Array<[number, number]> };
      let slice: [number, number] | null = null;
      const chain: any = {
        select: () => chain,
        eq: (col: string, value: unknown) => { preds.push((r) => r[col] === value); return chain; },
        is: (col: string, value: unknown) => { preds.push((r) => (r[col] ?? null) === value); return chain; },
        order: () => chain,
        range: (from: number, to: number) => { slice = [from, to + 1]; call.ranges.push([from, to]); return chain; },
        limit: (n: number) => { slice = [0, n]; return chain; },
        then: (resolve: any, reject: any) => {
          calls.push(call);
          if (opts.throws) return Promise.reject(new Error('rede caiu')).then(resolve, reject);
          if (opts.error) return Promise.resolve({ data: null, error: opts.error }).then(resolve, reject);
          const matched = (opts.rows || []).filter((r) => preds.every((p) => p(r)));
          const data = slice ? matched.slice(slice[0], slice[1]) : matched;
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        },
      };
      return chain;
    },
  };
  return { db: db as any, calls };
}

const USER = 'tenant-1';
const CLIENT_13 = '5543988887777';
const CLIENT_12 = '554388887777';

const optout = (phone: string, extra: Row = {}): Row => ({
  id: Math.floor(Math.random() * 1e9), user_id: USER, phone_key: canonicalPhoneKey(phone), revoked_at: null, ...extra,
});

test('tabela ausente: Set vazio e ninguém marcado', async () => {
  for (const code of ['42P01', 'PGRST205', '42703']) {
    const { db } = fakeDb({ error: { code, message: 'relation "followup_optouts" does not exist' } });
    assert.equal((await loadOptOutKeys(db, USER)).size, 0, code);
    assert.equal(await isOptedOut(db, USER, CLIENT_13), false, code);
  }
});

test('outro erro: loadOptOutKeys lança e isOptedOut falha fechado', async () => {
  const { db } = fakeDb({ error: { code: '57014', message: 'canceling statement due to statement timeout' } });
  await assert.rejects(() => loadOptOutKeys(db, USER), (err: any) => err.code === '57014' && /followup_optouts/.test(err.message));
  assert.equal(await isOptedOut(db, USER, CLIENT_13), true);

  const broken = fakeDb({ throws: true });
  assert.equal(await isOptedOut(broken.db, USER, CLIENT_13), true);
  await assert.rejects(() => loadOptOutKeys(broken.db, USER));
});

test('loadOptOutKeys traz só os ativos da própria conta', async () => {
  const { db } = fakeDb({
    rows: [
      optout(CLIENT_13),
      optout('5511977776666', { revoked_at: '2026-09-10T10:00:00Z' }),
      optout('5521966665555', { user_id: 'outra-conta' }),
    ],
  });
  assert.deepEqual([...(await loadOptOutKeys(db, USER))], [CLIENT_12]);
});

test('loadOptOutKeys pagina além do corte de 1000 linhas do PostgREST', async () => {
  const rows = Array.from({ length: 2500 }, (_, i) => ({ id: i, user_id: USER, phone_key: String(554300000000 + i), revoked_at: null }));
  const { db, calls } = fakeDb({ rows });
  const keys = await loadOptOutKeys(db, USER);
  assert.equal(keys.size, 2500);
  assert.deepEqual(calls.map((c) => c.ranges[0]), [[0, 999], [1000, 1999], [2000, 2999]]);
});

test('optOutSetHas casa 12 e 13 dígitos e formatos com máscara', () => {
  const keys = new Set([canonicalPhoneKey(CLIENT_13)]);
  for (const phone of [CLIENT_13, CLIENT_12, '43988887777', '4388887777', '+55 (43) 98888-7777']) {
    assert.equal(optOutSetHas(keys, phone), true, phone);
  }
  assert.equal(optOutSetHas(keys, '5543988886666'), false);
  assert.equal(optOutSetHas(keys, ''), false);
  assert.equal(optOutSetHas(keys, null), false);
  assert.equal(optOutSetHas(new Set([canonicalPhoneKey(CLIENT_12)]), CLIENT_13), true);
});

test('isOptedOut acha o opt-out gravado com 12 dígitos a partir de 13 e vice-versa', async () => {
  const { db } = fakeDb({ rows: [optout(CLIENT_12)] });
  assert.equal(await isOptedOut(db, USER, CLIENT_13), true);
  assert.equal(await isOptedOut(db, USER, CLIENT_12), true);
  assert.equal(await isOptedOut(db, 'outra-conta', CLIENT_13), false);
  assert.equal(await isOptedOut(db, USER, '5543988886666'), false);
  assert.equal(await isOptedOut(db, USER, ''), false);

  const revoked = fakeDb({ rows: [optout(CLIENT_13, { revoked_at: '2026-09-18T10:00:00Z' })] });
  assert.equal(await isOptedOut(revoked.db, USER, CLIENT_13), false);
});

test('isMissingSchemaError só reconhece tabela ou coluna ausente', () => {
  assert.equal(isMissingSchemaError({ code: 'PGRST205' }), true);
  assert.equal(isMissingSchemaError({ code: '23505' }), false);
  assert.equal(isMissingSchemaError(null), false);
  assert.equal(isMissingSchemaError(new Error('x')), false);
});

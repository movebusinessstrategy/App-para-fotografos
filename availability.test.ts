import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { nonOverlappingTask } from './lib/non-overlapping-task.ts';
import { CONNECTION_ERROR, fetchWithTimeout, withTimeout } from './src/utils/requestTimeout.ts';
import { startVisiblePoll } from './src/utils/poll.ts';

test('consultas periódicas compartilham uma execução pendente e recuperam após erro', async () => {
  let reject!: (reason: Error) => void;
  let calls = 0;
  const run = nonOverlappingTask(() => {
    calls++;
    return new Promise<void>((_resolve, fail) => { reject = fail; });
  });
  const first = run();
  assert.equal(run(), first);
  await Promise.resolve();
  assert.equal(calls, 1);
  reject(new Error('database unavailable'));
  await assert.rejects(first);
  const next = run();
  await Promise.resolve();
  assert.equal(calls, 2);
  reject(new Error('still unavailable'));
  await assert.rejects(next);
});

test('espera de sessão termina mesmo quando a operação não responde', async () => {
  await assert.rejects(withTimeout(new Promise(() => {}), 5), { message: CONNECTION_ERROR });
  assert.equal(await withTimeout(Promise.resolve('ok'), 50), 'ok');
});

test('timeout cancela a leitura HTTP e respeita cancelamento externo', async (t) => {
  t.mock.method(globalThis, 'fetch', async (_input, init) => new Promise((_resolve, reject) => {
    const signal = init!.signal!;
    if (signal.aborted) reject(signal.reason);
    else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  }));
  await assert.rejects(fetchWithTimeout('https://example.test', {}, 5), { message: CONNECTION_ERROR });
  const controller = new AbortController();
  const response = fetchWithTimeout('https://example.test', { signal: controller.signal }, 1000);
  controller.abort(new Error('user cancelled'));
  await assert.rejects(response, { message: 'user cancelled' });
});

test('poll não acumula chamadas durante espera nem reinicia após desmontar', async (t) => {
  const page = Object.assign(new EventTarget(), { hidden: false });
  Object.defineProperty(globalThis, 'document', { value: page, configurable: true });
  t.after(() => { Reflect.deleteProperty(globalThis, 'document'); });
  t.mock.timers.enable({ apis: ['setInterval'] });
  let finish!: () => void;
  let calls = 0;
  const stop = startVisiblePoll(() => {
    calls++;
    return new Promise<void>((resolve) => { finish = resolve; });
  }, 10);
  t.mock.timers.tick(10);
  t.mock.timers.tick(100);
  page.dispatchEvent(new Event('visibilitychange'));
  assert.equal(calls, 1);
  finish();
  await Promise.resolve();
  page.hidden = true;
  t.mock.timers.tick(100);
  assert.equal(calls, 1);
  page.hidden = false;
  page.dispatchEvent(new Event('visibilitychange'));
  assert.equal(calls, 2);
  stop();
  finish();
  await Promise.resolve();
  t.mock.timers.tick(100);
  page.dispatchEvent(new Event('visibilitychange'));
  assert.equal(calls, 2);
});

test('extensão renova uma única vez e persiste a sessão antes de liberar os consumidores', async () => {
  const storage = { fp_token: 'old', fp_refresh_token: 'refresh', fp_token_expires: 0 };
  let fetches = 0;
  let saved = false;
  const context = vm.createContext({
    Date, Promise, Error, AbortSignal,
    fetch: async (_url: string, init: RequestInit) => {
      fetches++;
      assert.ok(init.signal);
      return { ok: true, status: 200, json: async () => ({ access_token: 'new', refresh_token: 'next', expires_in: 3600 }) };
    },
    chrome: {
      runtime: { onMessage: { addListener() {} } },
      storage: { local: {
        get(_keys: string[], callback: (value: object) => void) { callback(storage); },
        async set(value: object) { await Promise.resolve(); Object.assign(storage, value); saved = true; },
      } },
    },
  });
  vm.runInContext(readFileSync(new URL('./whatsapp-extension/background.js', import.meta.url), 'utf8'), context);
  const [a, b] = await Promise.all([
    vm.runInContext('getAuth()', context), vm.runInContext('getAuth()', context),
  ]);
  assert.equal(fetches, 1);
  assert.equal(saved, true);
  assert.equal(a.token, 'new');
  assert.equal(b.token, 'new');
  await vm.runInContext('getAuth()', context);
  assert.equal(fetches, 1);
});

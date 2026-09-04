import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';

const owner = { user: { id: 'owner-test' }, access_token: 'test-only-token' };
let getSession = async (): Promise<any> => ({ data: { session: owner }, error: null });
let fetchProfile = async (): Promise<Response> => new Response('{}');
let onAuthEvent: (event: string, session: any) => void = () => {};

mock.module('./src/integrations/supabase/client.ts', {
  namedExports: { supabase: { auth: {
    getSession: () => getSession(),
    onAuthStateChange: (callback: typeof onAuthEvent) => {
      onAuthEvent = callback;
      return { data: { subscription: { unsubscribe() {} } } };
    },
    signOut: async () => {},
  } } },
});
mock.module('./src/utils/authFetch.ts', { namedExports: { authFetch: () => fetchProfile() } });
const { AuthProvider, useAuth } = await import('./src/contexts/AuthContext.tsx');

test('bootstrap não libera permissões quando a API falha, recupera e descarta resposta de outra sessão', async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/' });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  let current: ReturnType<typeof useAuth>;
  function Probe() { current = useAuth(); return null; }
  const root = createRoot(document.getElementById('root')!);
  const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
  try {
    fetchProfile = async () => new Response('{}', { status: 503 });
    await act(async () => { root.render(createElement(AuthProvider, null, createElement(Probe))); });
    await settle();
    assert.equal(current!.loading, false);
    assert.ok(current!.authError);
    assert.equal(current!.canAccess('finance'), false);

    fetchProfile = async () => new Response(JSON.stringify({ isMember: true, permissions: { finance: false }, isPlatformAdmin: false }));
    onAuthEvent('SIGNED_IN', owner);
    await settle();
    assert.equal(current!.authError, null);
    assert.equal(current!.isMember, true);
    assert.equal(current!.canAccess('finance'), false);
    assert.equal(current!.canAccess('vendas'), true);

    let complete!: (response: Response) => void;
    fetchProfile = () => new Promise(resolve => { complete = resolve; });
    onAuthEvent('SIGNED_IN', { ...owner, user: { id: 'different-user' } });
    await settle();
    assert.equal(current!.loading, true);
    onAuthEvent('SIGNED_OUT', null);
    await settle();
    await act(async () => { complete(new Response(JSON.stringify({ isPlatformAdmin: true }))); });
    assert.equal(current!.user, null);
    assert.equal(current!.isPlatformAdmin, false);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    for (const key of ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT']) Reflect.deleteProperty(globalThis, key);
  }
});

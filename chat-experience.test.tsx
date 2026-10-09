import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { conversationMatchesSearch } from './src/features/chat/utils/conversationSearch';

const pending: { url: string; signal?: AbortSignal | null; resolve: (response: Response) => void }[] = [];
mock.module('./src/utils/authFetch.ts', { namedExports: {
  authFetch: (url: string, options: RequestInit = {}) => {
    if (options.method === 'POST') return Promise.resolve(Response.json({ queued: false }));
    return new Promise<Response>(resolve => pending.push({ url, signal: options.signal, resolve }));
  },
} });
const { useConversations } = await import('./src/features/chat/hooks/useConversations');
const { useMessages } = await import('./src/features/chat/hooks/useMessages');
const { ThemeProvider, useTheme } = await import('./src/contexts/ThemeContext');

function mount() {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/' });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true });
  const root = createRoot(document.getElementById('root')!);
  return { root, async close() {
    await act(async () => root.unmount());
    dom.window.close();
    for (const key of ['window', 'document', 'localStorage', 'IS_REACT_ACT_ENVIRONMENT']) Reflect.deleteProperty(globalThis, key);
    pending.length = 0;
  } };
}

const conversation = { phone: '5511998765432', contact_name: 'Márcia', last_message: 'Olá', last_message_at: null, unread_count: 0 };

test('busca reconhece acentos, telefone formatado e versões com e sem nono dígito', () => {
  for (const query of ['marcia', '(11) 99876-5432', '11 9876-5432', '5511998765432']) {
    assert.equal(conversationMatchesSearch(conversation, query), true, query);
  }
  assert.equal(conversationMatchesSearch(conversation, 'outro cliente'), false);
});

test('busca mantém a lista, cancela requisição antiga e preserva resultados diante de erro', async () => {
  const view = mount();
  let state: ReturnType<typeof useConversations>;
  function Probe({ search = '', slot = 'main' }: { search?: string; slot?: 'main' | 'posvenda' }) {
    state = useConversations(slot, search); return null;
  }
  try {
    await act(async () => view.root.render(createElement(Probe)));
    await act(async () => pending[0].resolve(Response.json([conversation])));
    await act(async () => view.root.render(createElement(Probe, { search: 'mar' })));
    assert.equal(state!.loading, false);
    assert.equal(state!.searching, true);
    assert.equal(state!.conversations.length, 1);
    await act(async () => view.root.render(createElement(Probe, { search: 'marcia' })));
    assert.equal(pending[1].signal?.aborted, true);
    await act(async () => pending[2].resolve(Response.json([conversation])));
    await act(async () => pending[1].resolve(Response.json([])));
    assert.equal(state!.conversations.length, 1);
    await act(async () => { void state!.refresh(); });
    await act(async () => pending[3].resolve(new Response('{}', { status: 503 })));
    assert.ok(state!.error);
    assert.equal(state!.conversations.length, 1);
    await act(async () => view.root.render(createElement(Probe, { slot: 'posvenda' })));
    assert.equal(state!.conversations.length, 0);
    assert.ok(pending[4].url.includes('slot=posvenda'));
  } finally { await view.close(); }
});

test('resposta atrasada de outra conversa não substitui as mensagens atuais', async () => {
  const view = mount();
  let state: ReturnType<typeof useMessages>;
  function Probe({ phone }: { phone: string | null }) { state = useMessages(phone); return null; }
  try {
    await act(async () => view.root.render(createElement(Probe, { phone: '111' })));
    await act(async () => view.root.render(createElement(Probe, { phone: '222' })));
    assert.equal(pending[0].signal?.aborted, true);
    await act(async () => pending[1].resolve(Response.json([{ message_id: 'new', timestamp: '2026-10-08', body: 'Atual' }])));
    await act(async () => pending[0].resolve(Response.json([{ message_id: 'old', timestamp: '2026-10-07', body: 'Antiga' }])));
    assert.equal(state!.messages[0].message_id, 'new');
    await act(async () => view.root.render(createElement(Probe, { phone: null })));
    assert.equal(state!.messages.length, 0);
    assert.equal(state!.loading, false);
  } finally { await view.close(); }
});

test('tema do atendimento acompanha o aplicativo nos dois controles e após reabrir', async () => {
  const view = mount();
  let state: ReturnType<typeof useTheme>;
  function Probe() { state = useTheme(); return null; }
  const render = () => view.root.render(createElement(ThemeProvider, null, createElement(Probe)));
  try {
    localStorage.setItem('theme', 'light'); localStorage.setItem('wa-theme', 'dark');
    await act(async () => render());
    assert.equal(state!.waTheme, 'light');
    assert.equal(document.documentElement.dataset.theme, 'light');
    await act(async () => state!.toggleTheme());
    assert.equal(state!.waTheme, 'dark');
    assert.equal(document.documentElement.classList.contains('dark'), true);
    assert.equal(document.documentElement.dataset.theme, undefined);
    await act(async () => state!.toggleWaTheme());
    assert.equal(state!.theme, 'light');
    await act(async () => view.root.render(null));
    await act(async () => render());
    assert.equal(state!.theme, 'light');
    assert.equal(state!.waTheme, 'light');
  } finally { await view.close(); }
});

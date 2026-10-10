import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { useChatDraft } from './src/features/chat/hooks/useChatDraft';
import { useChatViewport } from './src/features/chat/hooks/useChatViewport';

function mount() {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { pretendToBeVisual: true });
  const viewport = new dom.window.EventTarget();
  Object.assign(viewport, { height: 844, offsetTop: 0, scale: 1 });
  Object.defineProperty(dom.window, 'visualViewport', { value: viewport });
  Object.defineProperty(dom.window, 'innerHeight', { value: 844, configurable: true });
  let mobile = true;
  dom.window.matchMedia = (() => ({ matches: mobile })) as any;
  Object.assign(globalThis, { window: dom.window, document: dom.window.document,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    requestAnimationFrame: (callback: FrameRequestCallback) => { callback(0); return 1; },
    cancelAnimationFrame: () => {}, IS_REACT_ACT_ENVIRONMENT: true });
  const root = createRoot(document.getElementById('root')!);
  return { root, viewport, desktop() { mobile = false; }, async close() {
    await act(async () => root.unmount()); dom.window.close();
    for (const key of ['window', 'document', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'IS_REACT_ACT_ENVIRONMENT']) Reflect.deleteProperty(globalThis, key);
  } };
}

test('rascunhos voltam com o contato e não se misturam entre contatos e setores', async () => {
  const view = mount();
  let draft: ReturnType<typeof useChatDraft>;
  function Probe({ conversation }: { conversation: string }) { draft = useChatDraft(conversation); return null; }
  const open = (conversation: string) => act(async () => view.root.render(createElement(Probe, { conversation })));
  try {
    await open('main:ellen');
    await act(async () => draft![1]('Olá Ellen'));
    await open('main:'); assert.equal(draft![0], '');
    await open('main:natal'); assert.equal(draft![0], '');
    await act(async () => draft![1]('Olá Natal'));
    await open('posvenda:ellen'); assert.equal(draft![0], '');
    await open('main:ellen'); assert.equal(draft![0], 'Olá Ellen');
    await act(async () => draft![1](text => text + '\nTudo bem?'));
    assert.equal(draft![0], 'Olá Ellen\nTudo bem?');
    await act(async () => draft![1](''));
    await open('main:natal'); assert.equal(draft![0], 'Olá Natal');
    await open('main:ellen'); assert.equal(draft![0], '');
  } finally { await view.close(); }
});

test('teclado reduz a área do chat e fecha restaura a altura; zoom e desktop são respeitados', async () => {
  const view = mount();
  function Probe() { const ref = useChatViewport(); return createElement('div', { ref, id: 'chat', style: { position: 'fixed' } }); }
  const resize = async (height: number, offsetTop = 0, scale = 1) => {
    Object.assign(view.viewport, { height, offsetTop, scale });
    await act(async () => view.viewport.dispatchEvent(new window.Event('resize')));
  };
  try {
    await act(async () => view.root.render(createElement(Probe)));
    const chat = document.getElementById('chat')!;
    assert.equal(chat.style.height, '844px'); assert.equal(chat.dataset.keyboardOpen, 'false');
    await resize(450, 24); assert.equal(chat.style.height, '450px'); assert.equal(chat.style.top, '24px'); assert.equal(chat.dataset.keyboardOpen, 'true');
    await resize(250, 80, 2); assert.equal(chat.style.height, '450px');
    await resize(844); assert.equal(chat.style.height, '844px'); assert.equal(chat.dataset.keyboardOpen, 'false');
    view.desktop(); await resize(900); assert.equal(chat.style.height, ''); assert.equal(chat.style.top, ''); assert.equal(chat.dataset.keyboardOpen, undefined);
    await act(async () => view.root.render(null));
    await resize(400); assert.equal(chat.style.height, '');
  } finally { await view.close(); }
});

test('rotas fora do chat não recebem ajuste do teclado', async () => {
  const view = mount();
  function Probe() { const ref = useChatViewport(false); return createElement('div', { ref, id: 'chat' }); }
  try {
    await act(async () => view.root.render(createElement(Probe)));
    Object.assign(view.viewport, { height: 400 });
    await act(async () => view.viewport.dispatchEvent(new window.Event('resize')));
    assert.equal(document.getElementById('chat')!.style.height, '');
  } finally { await view.close(); }
});

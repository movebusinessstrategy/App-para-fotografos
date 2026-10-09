import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { DndContext } from '@dnd-kit/core';

mock.module('./src/components/vendas/dealAvatar.ts', { namedExports: {
  useDealAvatar: () => null, getInitials: () => 'MD', getAvatarBg: () => '#B08830',
} });
let inboxProps: Record<string, unknown>;
mock.module('./src/features/chat/components/InboxView.tsx', { namedExports: {
  InboxView: (props: Record<string, unknown>) => {
    inboxProps = props;
    return createElement('button', { 'aria-label': 'Mensagem' });
  },
} });
const { DealCard } = await import('./src/components/vendas/DealCard');
const { ChatPopup } = await import('./src/components/vendas/ChatPopup');

function mount() {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/vendas' });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
  const root = createRoot(document.getElementById('root')!);
  return { root, dom, async close() {
    await act(async () => root.unmount()); dom.window.close();
    for (const key of ['window', 'document', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT']) Reflect.deleteProperty(globalThis, key);
  } };
}

test('ícone de chat abre apenas a conversa; clique e teclado no card abrem detalhes', async () => {
  const view = mount();
  let details = 0;
  let chats = 0;
  let pointerEvents = 0;
  try {
    await act(async () => view.root.render(createElement('div', { onPointerDown: () => pointerEvents++ }, createElement(DndContext, null, createElement(DealCard, {
      deal: { id: 'demo', title: 'Ensaio', contact_name: 'Márcia', contact_phone: '5511998765432', stage: 'new' } as any,
      onClick: () => details++, onChatClick: () => chats++,
    })))));
    const chat = document.querySelector<HTMLButtonElement>('button[aria-label="Conversar com Márcia"]')!;
    const card = document.querySelector<HTMLElement>('[role="button"]')!;
    await act(async () => {
      chat.dispatchEvent(new view.dom.window.Event('pointerdown', { bubbles: true }));
      chat.click();
      chat.dispatchEvent(new view.dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    assert.equal(chats, 1);
    assert.equal(details, 0);
    assert.equal(pointerEvents, 0);
    await act(async () => card.click());
    await act(async () => card.dispatchEvent(new view.dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    assert.equal(details, 2);
    assert.equal(window.location.pathname, '/vendas');
  } finally { await view.close(); }
});

test('painel reutiliza atendimento, fecha com Escape, mantém rota e restaura foco e rolagem', async () => {
  const view = mount();
  const trigger = document.createElement('button'); document.body.prepend(trigger); trigger.focus();
  document.body.style.overflow = 'auto';
  let closed = 0;
  try {
    await act(async () => view.root.render(createElement(ChatPopup, {
      phone: '+55 (11) 99876-5432', contactName: 'Márcia', deals: [], stages: [], clients: [],
      onDealUpdated() {}, onClose: () => closed++,
    })));
    assert.ok(document.querySelector('[role="dialog"][aria-label="Conversa de Márcia"]'));
    assert.equal(inboxProps!.embedded, true);
    assert.equal(inboxProps!.initialPhone, '5511998765432');
    assert.equal(document.activeElement?.getAttribute('aria-label'), 'Fechar conversa');
    assert.equal(document.body.style.overflow, 'hidden');
    await act(async () => document.querySelector('[aria-label="Mensagem"]')!.dispatchEvent(new view.dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    assert.equal(closed, 1);
    assert.equal(window.location.pathname, '/vendas');
    await act(async () => view.root.render(null));
    assert.equal(document.activeElement, trigger);
    assert.equal(document.body.style.overflow, 'auto');
  } finally { await view.close(); }
});

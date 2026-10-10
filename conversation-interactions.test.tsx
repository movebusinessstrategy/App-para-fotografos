import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import { JSDOM } from 'jsdom';
import React, { act, createElement, useState } from 'react';
import type { Message } from './src/features/chat/types';

let finance = { payments: [{ id: 'signal', amount: 100, payment_date: '2026-10-01', payment_method: 'Pix' }], totalPago: 100, jobAmount: 700 };
let writes: { url: string; body: any }[] = [];
let failWrite = false;
let refreshFailure = false;
let pendingSend: ((response: Response) => void) | null = null;
let remoteMessages: Message[] = [];
let jobs = [{ id: 1, client_id: 1, job_type: 'Natal', job_name: 'Natal 2026', job_date: '2026-10-23', job_time: '14:00', job_end_time: '15:00', amount: 700, status: 'scheduled' }];

mock.module('./src/utils/authFetch.ts', { namedExports: { authFetch: async (url: string, options: RequestInit = {}) => {
  if (url === '/api/inbox/send') return new Promise<Response>(resolve => { pendingSend = resolve; });
  if (options.method === 'POST' && url.endsWith('/sync')) return Response.json({ queued: false });
  if (options.method === 'POST' || options.method === 'PUT') {
    const body = JSON.parse(String(options.body)); writes.push({ url, body });
    if (failWrite) return Response.json({ error: 'Falha simulada' }, { status: 503 });
    if (url.endsWith('/payments')) finance = { ...finance, totalPago: finance.totalPago + body.amount, payments: [...finance.payments, { id: `p${finance.payments.length + 1}`, ...body }] };
    else jobs = jobs.map(job => job.id === 1 ? { ...job, ...body } : job);
    return Response.json({ payment: { id: 'persisted' }, calendar_sync_status: 'not_connected' });
  }
  if (url === '/api/jobs') return Response.json(jobs);
  return Response.json(remoteMessages);
} } });
mock.module('./src/utils/useApi.ts', { namedExports: { useApi: () => {
  const [, update] = useState(0);
  return { data: finance, isLoading: false, error: null, mutate: async () => {
    if (refreshFailure) throw Error('Falha ao atualizar');
    update(value => value + 1);
    return finance;
  } };
} } });
mock.module('./src/contexts/AuthContext.tsx', { namedExports: { useAuth: () => ({ canAccess: () => true }) } });

async function mount() {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/' });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(document.getElementById('root')!);
  return { root, dom, async close() {
    await act(async () => root.unmount()); dom.window.close();
    for (const key of ['window', 'document', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT']) Reflect.deleteProperty(globalThis, key);
  } };
}
function button(label: string) { return [...document.querySelectorAll<HTMLButtonElement>('button')].find(element => element.textContent?.trim() === label)!; }
async function enter(view: Awaited<ReturnType<typeof mount>>, label: string, value: string) {
  const input = [...document.querySelectorAll<HTMLInputElement>('input')].find(element => element.parentElement?.textContent?.startsWith(label))!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(view.dom.window.HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new view.dom.window.Event('input', { bubbles: true }));
    input.dispatchEvent(new view.dom.window.Event('change', { bubbles: true }));
  });
}
async function submit(view: Awaited<ReturnType<typeof mount>>) {
  await act(async () => document.querySelector('form')!.dispatchEvent(new view.dom.window.Event('submit', { bubbles: true, cancelable: true })));
}

test('conversa longa abre no fim após carregar, acompanha mídia e mensagens novas e respeita a leitura antiga', async () => {
  const view = await mount();
  const { useChatScroll } = await import('./src/features/chat/hooks/useChatScroll');
  let scroll: ReturnType<typeof useChatScroll>;
  function Probe({ loading, messages, phone = 'a' }: { loading: boolean; messages: Message[]; phone?: string }) {
    scroll = useChatScroll(phone, loading, messages);
    return createElement('div', { ref: scroll.containerRef, onScroll: scroll.onScroll }, createElement('div', { ref: scroll.contentRef }));
  }
  const message = (id: string, from_me = false) => ({ message_id: id, from_me } as Message);
  try {
    await act(async () => view.root.render(createElement(Probe, { loading: true, messages: [] })));
    const el = document.querySelector('#root > div') as HTMLDivElement;
    let height = 4000;
    Object.defineProperties(el, { scrollHeight: { get: () => height }, clientHeight: { value: 600 } });
    await act(async () => view.root.render(createElement(Probe, { loading: false, messages: [message('last')] })));
    assert.equal(el.scrollTop, 4000, 'primeiro carregamento deve ir ao fim mesmo com 80 mensagens');
    el.scrollTop = 0;
    await act(async () => scroll!.onScroll());
    height = 4100;
    await act(async () => view.root.render(createElement(Probe, { loading: false, messages: [message('last'), message('new')] })));
    assert.equal(el.scrollTop, 0, 'mensagem recebida não interrompe a leitura');
    assert.equal(scroll!.showScrollButton, true);
    await act(async () => view.root.render(createElement(Probe, { loading: false, messages: [message('last'), message('new'), message('mine', true)] })));
    assert.equal(el.scrollTop, 4100);
    await act(async () => view.root.render(createElement(Probe, { phone: 'b', loading: true, messages: [] })));
    el.scrollTop = 0;
    await act(async () => view.root.render(createElement(Probe, { phone: 'b', loading: false, messages: [message('last-b')] })));
    assert.equal(el.scrollTop, 4100, 'trocar de cliente reinicia a posição no fim');
  } finally { await view.close(); }
});

test('falha no envio remove a mensagem temporária; o poll não apaga o envio em andamento', async () => {
  const view = await mount();
  const { useMessages } = await import('./src/features/chat/hooks/useMessages');
  let state: ReturnType<typeof useMessages>;
  function Probe() { state = useMessages('5511999990000'); return null; }
  try {
    remoteMessages = [];
    await act(async () => view.root.render(createElement(Probe)));
    let send: Promise<void>;
    await act(async () => { send = state!.sendText('Mensagem de teste'); send.catch(() => {}); });
    assert.equal(state!.messages[0].status, 'sending');
    await act(async () => state!.refreshMessages());
    assert.equal(state!.messages[0].status, 'sending');
    await act(async () => { pendingSend!(Response.json({ error: 'Canal indisponível' }, { status: 409 })); await assert.rejects(send!, /Canal indisponível/); });
    assert.equal(state!.messages.length, 0);
  } finally { await view.close(); }
});

test('pagamento de R$347 é persistido uma vez, soma ao sinal de R$100 e mantém o histórico', async () => {
  const view = await mount();
  const { ConversationPayment } = await import('./src/features/chat/components/ConversationPayment');
  writes = []; failWrite = false; refreshFailure = false;
  try {
    await act(async () => view.root.render(createElement(ConversationPayment, { job: jobs[0] as any, onUpdate: async () => {} })));
    await act(async () => button('Registrar pagamento').click());
    await enter(view, 'Valor recebido', '347,00');
    assert.equal(button('Registrar R$ 347,00').disabled, false);
    await submit(view);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].url, '/api/jobs/1/payments');
    assert.equal(writes[0].body.amount, 347);
    assert.equal(finance.totalPago, 447);
    assert.ok(document.body.textContent?.includes('447,00'));
    assert.equal(finance.payments[0].id, 'signal');
  } finally { await view.close(); }
});

test('pagamento já gravado não fica disponível para duplicação quando atualizar o painel falha', async () => {
  const view = await mount();
  const { ConversationPayment } = await import('./src/features/chat/components/ConversationPayment');
  writes = []; refreshFailure = true;
  try {
    await act(async () => view.root.render(createElement(ConversationPayment, { job: jobs[0] as any, onUpdate: async () => {} })));
    await act(async () => button('Registrar pagamento').click());
    await enter(view, 'Valor recebido', '10,00'); await submit(view);
    assert.equal(writes.length, 1);
    assert.equal(document.querySelector('form'), null);
    assert.ok(document.body.textContent?.includes('Pagamento registrado. Atualize o painel'));
  } finally { refreshFailure = false; await view.close(); }
});

test('agenda envia apenas data e horários, preserva dados do ensaio e informa Google desconectado', async () => {
  const view = await mount();
  const { ConversationSchedule } = await import('./src/features/chat/components/ConversationSchedule');
  writes = []; failWrite = false;
  try {
    await act(async () => view.root.render(createElement(ConversationSchedule, { job: jobs[0] as any, allJobs: jobs as any, onUpdate: async () => {} })));
    await act(async () => button('Alterar agendamento').click());
    await enter(view, 'Data selecionada', '2026-10-24');
    await enter(view, 'Início', '16:00');
    await submit(view);
    assert.deepEqual(writes[0].body, { job_date: '2026-10-24', job_time: '16:00', job_end_time: '17:00' });
    assert.equal(jobs[0].amount, 700);
    assert.ok(document.body.textContent?.includes('Conecte o Google Agenda para sincronizar'));
  } finally { await view.close(); }
});

(function () {
  'use strict';
  if (document.getElementById('fp-kanban')) return;

  // ===== CORES =====
  const COLS = [
    { bg: '#dbeafe', text: '#1d4ed8', dot: '#3b82f6' },
    { bg: '#fef9c3', text: '#854d0e', dot: '#eab308' },
    { bg: '#f3e8ff', text: '#6b21a8', dot: '#a855f7' },
    { bg: '#ffedd5', text: '#9a3412', dot: '#f97316' },
    { bg: '#fce7f3', text: '#9d174d', dot: '#ec4899' },
    { bg: '#d1fae5', text: '#065f46', dot: '#10b981' },
    { bg: '#e0f2fe', text: '#075985', dot: '#0ea5e9' },
    { bg: '#f1f5f9', text: '#475569', dot: '#94a3b8' },
  ];
  const C = (i) => COLS[(i || 0) % COLS.length];
  const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0 });
  const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const digits = (s) => String(s || '').replace(/\D/g, '');
  const initials = (n) => { const w = String(n || '?').trim().split(/\s+/); return (w[0][0] + (w[1]?.[0] || '')).toUpperCase(); };
  const fmtDate = (s) => { try { return new Date(s).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }); } catch { return ''; } };
  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  // ===== STATE =====
  let deals = [], stages = [];
  let teamMembers = [];
  let currentMemberId = null;
  let chatPhone = null, chatDeal = null, chatStages = [];
  let chatKey = null;
  let modalContext = { fromChat: false };
  let draggingId = null;
  let draggingInboxIdx = null;
  let dragMoved = false;
  let pointerDrag = null;
  let inboxItems = [];   // conversas varridas da lista do WA
  let contactPhotos = loadContactPhotos();
  let chatPhoneByName = loadChatPhoneByName();
  let suppressChatListClickUntil = 0;
  let q = '';
  let kanbanVisible = true;

  // ===== BG MESSAGES =====
  const bg = (msg) => new Promise((ok, fail) => {
    chrome.runtime.sendMessage(msg, (r) => {
      if (chrome.runtime.lastError) return fail(new Error(chrome.runtime.lastError.message));
      if (r?.error) return fail(new Error(r.error));
      ok(r);
    });
  });

  // ===== TOAST =====
  let toastT;
  const toast = (msg, err) => {
    const el = document.getElementById('fp-toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.toggle('err', !!err);
    el.classList.add('on');
    clearTimeout(toastT);
    toastT = setTimeout(() => el.classList.remove('on'), 2600);
  };

  function loadContactPhotos() {
    try {
      const v2 = JSON.parse(localStorage.getItem('fp_contact_photos_v2') || '{}') || {};
      // v1 usava chave de 8 dígitos (colidia). Migramos como fallback de leitura
      // sob a chave antiga — cada chat que for reaberto grava a versão correta em v2.
      try {
        const v1 = JSON.parse(localStorage.getItem('fp_contact_photos_v1') || '{}') || {};
        for (const [k, v] of Object.entries(v1)) {
          if (v && !v2[k]) v2[k] = v;
        }
      } catch { /* ignora v1 corrompido */ }
      return v2;
    } catch {
      return {};
    }
  }

  function saveContactPhotos() {
    try {
      localStorage.setItem('fp_contact_photos_v2', JSON.stringify(contactPhotos));
    } catch {
      // Cache visual: se o navegador bloquear, seguimos com iniciais.
    }
  }

  function phonePhotoKey(phone) {
    const normalized = normalizeWhatsappPhone(phone);
    return normalized && normalized.length >= 10 ? normalized : '';
  }

  function legacyPhotoKey(phone) {
    return digits(phone || '').slice(-8);
  }

  // Cache nome → telefone. Necessário porque o WhatsApp Web parou de expor o JID
  // no DOM da sidebar para contatos salvos — a única forma de obter o número
  // é abrindo o drawer de info do contato, então cacheamos o resultado.
  function loadChatPhoneByName() {
    try {
      const raw = JSON.parse(localStorage.getItem('fp_chat_phones_v1') || '{}') || {};
      return new Map(Object.entries(raw));
    } catch {
      return new Map();
    }
  }

  function saveChatPhoneByName() {
    try {
      localStorage.setItem('fp_chat_phones_v1', JSON.stringify(Object.fromEntries(chatPhoneByName)));
    } catch { /* ignora cache cheio */ }
  }

  function chatNameKey(name) {
    return String(name || '').trim().toLowerCase();
  }

  function rememberChatPhoneByName(name, phone) {
    const key = chatNameKey(name);
    if (!key) return;
    const normalized = digits(phone || '');
    if (normalized.length < 8) return;
    const value = normalized.startsWith('55') || normalized.length > 11 ? normalized : `55${normalized}`;
    if (chatPhoneByName.get(key) === value) return;
    chatPhoneByName.set(key, value);
    saveChatPhoneByName();
  }

  function getCachedPhoneByName(name) {
    const key = chatNameKey(name);
    return key ? (chatPhoneByName.get(key) || null) : null;
  }

  function rememberContactPhoto(phone, photo) {
    const key = phonePhotoKey(phone);
    if (!key || !photo || String(photo).length > 20000) return;
    contactPhotos[key] = photo;
    saveContactPhotos();
  }

  function getCachedContactPhoto(phone) {
    const key = phonePhotoKey(phone);
    if (key && contactPhotos[key]) return contactPhotos[key];
    // Fallback para fotos salvas antes do bump de chave (cache v1)
    const legacy = legacyPhotoKey(phone);
    if (legacy && contactPhotos[legacy]) return contactPhotos[legacy];
    return null;
  }

  // ===== CRIAR DOM BASE =====
  function build() {
    // Kanban
    const k = document.createElement('div');
    k.id = 'fp-kanban';
    k.innerHTML = `
      <div id="fp-kh">
        <span id="fp-kh-title">Pipeline de Vendas</span>
        <div id="fp-kh-search">
          <svg width="13" height="13" fill="none" stroke="#aaa" stroke-width="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          <input id="fp-q" type="text" placeholder="Buscar lead..." />
        </div>
        <button id="fp-kh-refresh" title="Recarregar">↺</button>
        <button id="fp-kh-add">+ Novo Lead</button>
        <button id="fp-kh-logout" title="Sair da conta">⏻</button>
      </div>
      <div id="fp-board"></div>
    `;
    document.body.appendChild(k);

    // Injeção dos botões DENTRO da barra de ícones nativa do WhatsApp.
    // O mount real acontece em mountNativeRail() — chamado no startObserver
    // porque a sidebar é renderizada pelo React do WhatsApp.
    mountNativeRail();

    // Toast
    const t = document.createElement('div');
    t.id = 'fp-toast';
    document.body.appendChild(t);

    // Modal
    const m = document.createElement('div');
    m.id = 'fp-modal';
    m.classList.add('fp-hidden');
    m.innerHTML = `
      <div class="fp-mbox">
        <h3>Novo Lead</h3>
        <div class="fp-mf"><label class="fp-ml">Nome</label><input class="fp-mi" id="fp-mn" placeholder="Nome do contato" /></div>
        <div class="fp-mf"><label class="fp-ml">Telefone</label><input class="fp-mi" id="fp-mp" placeholder="5511999999999" /></div>
        <div class="fp-mf"><label class="fp-ml">Valor (R$)</label><input class="fp-mi" id="fp-mv" type="number" placeholder="0" /></div>
        <div class="fp-mf"><label class="fp-ml">Etapa do funil</label><select class="fp-mi" id="fp-msid"></select></div>
        <div class="fp-mf"><label class="fp-ml">Vendedor responsável</label><select class="fp-mi" id="fp-massign"></select></div>
        <div class="fp-mrow">
          <button class="fp-btn-w" id="fp-mc">Cancelar</button>
          <button class="fp-btn-g" id="fp-ms">Criar</button>
        </div>
      </div>
    `;
    document.body.appendChild(m);

    // Eventos base — addEventListener (não .onclick) para sobreviver à CSP do WA
    document.getElementById('fp-kh-refresh').addEventListener('click', () => loadKanban());
    document.getElementById('fp-kh-add').addEventListener('click', () => openModal());
    document.getElementById('fp-kh-logout').addEventListener('click', confirmLogout);
    document.getElementById('fp-q').addEventListener('input', (e) => { q = e.target.value.toLowerCase(); renderBoard(); });
    document.getElementById('fp-mc').addEventListener('click', closeModal);
    document.getElementById('fp-ms').addEventListener('click', saveNewDeal);
    m.addEventListener('click', (e) => { if (e.target === m) closeModal(); });

    // Drop global
    window.__fpDrop = drop;

    // Ajusta posição baseada na largura do painel lateral do WA
    adjustPosition();
    window.addEventListener('resize', () => {
      adjustPosition();
      positionChatStrip();
    });
  }

  function adjustPosition() {
    const side = document.querySelector('#side, #pane-side, [data-testid="chat-list"]')?.getBoundingClientRect();
    const left = side ? Math.round(side.right) : 380;
    document.getElementById('fp-kanban')?.style.setProperty('--fp-side-width', left + 'px');
    const k = document.getElementById('fp-kanban');
    if (k) k.style.left = left + 'px';
    const ag = document.getElementById('fp-agenda');
    if (ag) ag.style.left = left + 'px';
  }

  // Acha o container da barra de ícones nativa do WhatsApp (Chats, Status, Comunidades…).
  // O WhatsApp não tem um seletor estável — usamos heurística: a sidebar é uma
  // <nav> à esquerda contendo vários botões com aria-label.
  function findWaSidebar() {
    // Tenta achar um <nav> com vários botões/ícones
    const navs = document.querySelectorAll('nav, header > div');
    for (const n of navs) {
      const rect = n.getBoundingClientRect();
      if (rect.width > 0 && rect.width < 110 && rect.height > 200) {
        const btns = n.querySelectorAll('[role="button"], button');
        if (btns.length >= 3) return n;
      }
    }
    // Fallback: procura um elemento que tem botão com aria-label "Conversas" ou similar
    const chatBtn = document.querySelector('[aria-label*="onversas" i], [aria-label*="hats" i]');
    return chatBtn?.closest('nav, header, [role="navigation"]') || null;
  }

  function mountNativeRail() {
    if (document.getElementById('fp-rail-mounted')?.isConnected) return;
    const sidebar = findWaSidebar();
    if (!sidebar) return; // tenta de novo no próximo MutationObserver tick

    // Acha o botão de Conversas, depois sobe pela árvore até achar o WRAPPER
    // que é IRMÃO direto dos wrappers dos outros ícones (Status, Communities…).
    const chatBtn = sidebar.querySelector('[aria-label*="onversas" i], [aria-label*="hats" i]');
    if (!chatBtn) return;

    let wrapper = chatBtn;
    let parent = wrapper.parentElement;
    for (let depth = 0; depth < 8 && parent; depth++) {
      const siblings = Array.from(parent.children);
      const buttonish = siblings.filter(s =>
        s !== wrapper && (s.matches('button, [role="button"], a') || s.querySelector('button, [role="button"], a'))
      );
      if (buttonish.length >= 2 && parent !== sidebar) {
        // parent é o "grupo de cima" — wrapper é o irmão Chats, buttonish são os outros
        break;
      }
      wrapper = parent;
      parent = wrapper.parentElement;
    }
    if (!parent) return;

    // Cria o container — mesma estrutura visual dos wrappers nativos
    const container = document.createElement(wrapper.tagName.toLowerCase() === 'div' ? 'div' : 'div');
    container.id = 'fp-rail-mounted';
    container.className = 'fp-rail-nat';
    container.innerHTML = `
      <button id="fp-rail-pipeline" class="fp-rail-nat-btn" title="Pipeline de vendas" aria-label="Pipeline de vendas">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="6" height="18" rx="1.5"/><rect x="10.5" y="3" width="6" height="13" rx="1.5"/><rect x="18" y="3" width="3" height="8" rx="1"/></svg>
      </button>
      <button id="fp-rail-agenda" class="fp-rail-nat-btn" title="Agenda" aria-label="Agenda">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
      </button>
    `;
    container.querySelector('#fp-rail-pipeline')?.addEventListener('click', showKanban);
    container.querySelector('#fp-rail-agenda')?.addEventListener('click', showAgenda);

    // Posiciona DEPOIS do último wrapper de ícone do "grupo de cima",
    // ANTES de qualquer divisor/espaço/rodapé que vier em seguida.
    const siblings = Array.from(parent.children);
    const buttonWrappers = siblings.filter(s =>
      s.matches('button, [role="button"], a') || s.querySelector('button, [role="button"], a')
    );
    const lastButtonWrapper = buttonWrappers[buttonWrappers.length - 1];
    if (lastButtonWrapper) {
      // Acha primeiro irmão NÃO-botão depois do último (geralmente o divisor)
      const lastIdx = siblings.indexOf(lastButtonWrapper);
      const divider = siblings.slice(lastIdx + 1).find(s =>
        !s.matches('button, [role="button"], a') && !s.querySelector('button, [role="button"], a')
      );
      if (divider) {
        parent.insertBefore(container, divider);
      } else {
        lastButtonWrapper.insertAdjacentElement('afterend', container);
      }
      console.log('[FocalPoint] rail montada — pai:', parent.tagName, 'siblings:', siblings.length, 'lastWrapper:', lastButtonWrapper);
    } else {
      parent.appendChild(container);
    }
  }

  // ===== KANBAN =====
  async function loadKanban() {
    showBoardState('<div class="fp-spin"></div><span>Carregando pipeline...</span>');
    try {
      const [dr, sr, tm, me] = await Promise.all([
        bg({ type: 'GET_ALL_DEALS' }),
        bg({ type: 'GET_STAGES' }),
        bg({ type: 'GET_TEAM_MEMBERS' }).catch(() => []),
        bg({ type: 'GET_ME' }).catch(() => null),
      ]);
      deals = dr || [];
      stages = sr || [];
      teamMembers = Array.isArray(tm) ? tm.filter(m => m.is_active !== false) : [];
      currentMemberId = me?.currentMember?.id || null;
      renderBoard();
    } catch (err) {
      if (/autenticado|login/i.test(err.message)) {
        showBoardState(`
          <svg width="36" height="36" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
          <p style="font-weight:700;color:#111b21">Faça login para ver o pipeline</p>
          <button class="fp-btn-g" id="fp-login-btn" style="padding:9px 22px">Fazer login</button>
        `);
        // CSP do WhatsApp Web bloqueia onclick inline — precisa addEventListener
        document.getElementById('fp-login-btn')?.addEventListener('click', () => {
          chrome.runtime.sendMessage({ type: 'OPEN_LOGIN_TAB' });
        });
      } else {
        showBoardState(`<p style="color:#e53935">${esc(err.message)}</p><button class="fp-btn-w" id="fp-retry-btn" style="padding:8px 18px">Tentar novamente</button>`);
        document.getElementById('fp-retry-btn')?.addEventListener('click', loadKanban);
      }
    }
  }

  function showBoardState(html) {
    const b = document.getElementById('fp-board');
    if (b) b.innerHTML = `<div class="fp-board-state">${html}</div>`;
  }

  function orderedStages(list = stages) {
    const src = Array.isArray(list) ? list : [];
    return [...src.filter(s => !s.is_final), ...src.filter(s => s.is_final)];
  }

  function firstOpenStage(list = stages) {
    const ordered = orderedStages(list);
    return ordered.find(s => !s.is_final) || ordered[0] || null;
  }

  async function ensureStagesForUi() {
    let list = orderedStages(chatStages.length ? chatStages : stages);
    if (list.length) return list;

    const sr = await bg({ type: 'GET_STAGES' });
    stages = sr || [];
    if (!chatStages.length) chatStages = stages;
    return orderedStages(stages);
  }

  function renderBoard() {
    const b = document.getElementById('fp-board');
    if (!b) return;
    const all = orderedStages(stages);
    if (!all.length) { showBoardState('<p>Nenhuma etapa encontrada.</p>'); return; }

    // Atualiza a inbox lendo o DOM do WA
    inboxItems = scanWhatsappInbox().filter(it => matchesInbox(it));

    // ── Coluna Inbox: campo de novo número + lista de conversas do WA ──
    const inboxHtml = `
      <div class="fpc fpc-inbox-col">
        <div class="fpc-hd">
          <div class="fpc-title" style="color:#075e54">
            <span class="fpc-dot" style="background:#25d366"></span>💬 Inbox WhatsApp
          </div>
          <div class="fpc-meta">${inboxItems.length} conversa${inboxItems.length !== 1 ? 's' : ''}</div>
        </div>
        <div class="fpc-newcontact">
          <input id="fp-inbox-phone" type="tel" placeholder="55 11 99999-9999" class="fp-inbox-input" />
          <button id="fp-inbox-open" class="fp-btn-g">Abrir</button>
        </div>
        <div class="fpc-body" id="fpb-inbox">
          ${inboxItems.length
            ? inboxItems.map((it, idx) => inboxCard(it, idx)).join('')
            : '<div class="fpc-empty">Sem conversas novas no WhatsApp</div>'}
        </div>
      </div>
    `;

    // ── Colunas das etapas ──
    const stagesHtml = all.map((s, i) => {
      const c = C(s.position ?? i);
      const sd = deals.filter(d => d.stage === s.id && matches(d));
      const total = sd.reduce((t, d) => t + (d.value || 0), 0);
      const hasLeadsWithPhone = sd.some(d => d.contact_phone);
      return `
        <div class="fpc" data-stage-id="${s.id}">
          <div class="fpc-hd">
            <div class="fpc-title" style="color:${c.text}">
              <span class="fpc-dot" style="background:${c.dot}"></span>${esc(s.name)}
            </div>
            <div class="fpc-meta-row">
              <span class="fpc-meta">${sd.length} lead${sd.length !== 1 ? 's' : ''} · ${brl.format(total)}</span>
              ${hasLeadsWithPhone ? `<button class="fpc-blast" data-stage-id="${esc(s.id)}" title="Disparar follow-up em massa pra esta etapa">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/></svg>
              </button>` : ''}
            </div>
          </div>
          <div class="fpc-body" id="fpb-${s.id}" data-stage-id="${s.id}">
            ${sd.length ? sd.map(d => card(d, c)).join('') : '<div class="fpc-empty">Nenhum lead aqui</div>'}
          </div>
        </div>`;
    }).join('');

    b.innerHTML = inboxHtml + stagesHtml;

    // Drag/drop por dataset (CSP-safe — sem onclick/ondrop inline)
    bindBoardDragScroll(b);
    b.querySelectorAll('.fpc-body[data-stage-id]').forEach(bindStageDropZone);
    b.querySelectorAll('.fpc-card[data-id]').forEach(bindCard);
    b.querySelectorAll('.fpc-inbox-card').forEach(bindInboxCard);
    b.querySelectorAll('.fpc-blast[data-stage-id]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const sid = btn.getAttribute('data-stage-id');
        const stage = stages.find(s => s.id === sid);
        if (stage) openMassFollowUpModal(stage);
      });
    });
    bindInboxNewContact();
  }

  function bindBoardDragScroll(board) {
    if (!board || board.dataset.fpDragScrollBound) return;
    board.dataset.fpDragScrollBound = '1';

    board.addEventListener('dragover', (e) => {
      if (!draggingId && draggingInboxIdx === null) return;

      const rect = board.getBoundingClientRect();
      const edge = 80;
      const speed = 24;

      if (e.clientX > rect.right - edge) board.scrollLeft += speed;
      else if (e.clientX < rect.left + edge) board.scrollLeft -= speed;
    });
  }

  function matchesInbox(it) {
    if (!q) return true;
    return `${it.name} ${it.preview || ''}`.toLowerCase().includes(q);
  }

  function inboxCard(item, idx) {
    const sub = item.preview || '—';
    const avatar = item.photo
      ? `<div class="fpc-av fpc-av-img"><img src="${esc(item.photo)}" alt="" /></div>`
      : `<div class="fpc-av" style="background:#25d366">${esc(initials(item.name))}</div>`;
    return `
      <div class="fpc-card fpc-inbox-card" data-idx="${idx}">
        <div class="fpc-card-top">
          ${avatar}
          <div class="fpc-info">
            <div class="fpc-name">${esc(item.name)}</div>
            <div class="fpc-sub">${esc(sub)}</div>
          </div>
          <div class="fpc-date">${esc(item.time)}</div>
        </div>
        ${item.unread ? `<div class="fpc-card-bot"><span class="fpc-unread-badge">● ${item.unread} nova${item.unread > 1 ? 's' : ''}</span></div>` : ''}
      </div>`;
  }

  function bindInboxCard(el) {
    const idx = Number(el.dataset.idx);
    el.addEventListener('pointerdown', (e) => startPointerCardDrag(e, el, idx, 'inbox'));
    el.addEventListener('dragstart', e => {
      dragMoved = true;
      draggingId = null;
      draggingInboxIdx = idx;
      el.classList.add('dragging');
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.dropEffect = 'move';
        e.dataTransfer.setData('text/plain', `inbox:${idx}`);
        e.dataTransfer.setData('application/x-focalpoint-inbox-idx', String(idx));
      }
    });
    el.addEventListener('dragend', () => {
      el.classList.remove('dragging');
      document.querySelectorAll('.dp-over').forEach(x => x.classList.remove('dp-over'));
      setTimeout(() => {
        draggingInboxIdx = null;
        dragMoved = false;
      }, 80);
    });

    el.addEventListener('click', (e) => {
      if (dragMoved) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      const it = inboxItems[idx];
      if (!it) return;
      hideKanban();
      // O WhatsApp Web recicla os elementos da sidebar (lista virtualizada).
      // A referência salva em it.el pode agora estar mostrando outro contato.
      // Re-localiza pelo nome no momento do clique.
      const currentItem = findInboxItemByName(it.name) || it.el;
      const ok = simulateRealClick(currentItem);
      console.log('[FocalPoint] Click no card da inbox:', it.name, 'sucesso:', ok, 'usou ref atual:', currentItem !== it.el);
    });
  }

  function findInboxItemByName(name) {
    const cleanName = String(name || '').trim();
    if (!cleanName) return null;
    const items = chatListItems();
    for (const item of items) {
      const titleEl = item.querySelector('span[title]');
      const itemName = (titleEl?.getAttribute('title') || titleEl?.textContent || '').trim();
      if (itemName === cleanName) return item;
    }
    return null;
  }

  function bindInboxNewContact() {
    const input = document.getElementById('fp-inbox-phone');
    const btn = document.getElementById('fp-inbox-open');
    if (!input || !btn) return;

    const trigger = async () => {
      const p = digits(input.value);
      if (!p || p.length < 10) {
        toast('Número inválido — inclua DDD (ex: 11999999999)', true);
        return;
      }
      const full = p.startsWith('55') ? p : '55' + p;
      await openByNumberInApp(full);
    };

    btn.addEventListener('click', trigger);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') trigger(); });
  }

  function normalizeWhatsappPhone(phone) {
    const p = digits(phone);
    if (!p) return '';
    return p.startsWith('55') || p.length > 11 ? p : `55${p}`;
  }

  function chatListItems() {
    return Array.from(document.querySelectorAll('#pane-side [role="listitem"], #pane-side [data-testid="cell-frame-container"], [data-testid="cell-frame-container"]'));
  }

  function extractPhoneFromChatListItem(el, label = '') {
    const labelDigits = digits(label);
    if (labelDigits.length >= 8 && labelDigits.length <= 15) return normalizeWhatsappPhone(labelDigits);

    const candidates = [];
    const collectAttrs = (node) => {
      if (!node?.getAttributeNames) return;
      for (const attr of node.getAttributeNames()) {
        const value = node.getAttribute(attr);
        if (value && /(?:\d{8,15}@|\+?\d[\d\s\-()+]{7,})/.test(value)) candidates.push(value);
      }
    };

    collectAttrs(el);
    el.querySelectorAll?.('[data-id], [data-jid], [data-remote-jid], [href], [title], [aria-label]').forEach(collectAttrs);

    for (const value of candidates) {
      const jid = String(value).match(/(\d{8,15})@(?:c\.us|s\.whatsapp\.net)/);
      if (jid) return normalizeWhatsappPhone(jid[1]);
      const phone = String(value).match(/\+?\d[\d\s\-()+]{7,}/);
      if (phone) {
        const clean = digits(phone[0]);
        if (clean.length >= 8 && clean.length <= 15) return normalizeWhatsappPhone(clean);
      }
    }

    return '';
  }

  function chatItemLooksEmpty(el) {
    const text = (el?.textContent || '').toLowerCase();
    return /nenhum|não encontrado|no result|no chat|not found/.test(text);
  }

  function findChatItem(phoneFull, contactName, allowFirstPhoneResult = false) {
    const phoneTail = digits(phoneFull).slice(-8);
    const cleanName = String(contactName || '').trim().toLowerCase();
    const items = chatListItems();

    for (const item of items) {
      const text = item.textContent || '';
      const textDigits = digits(text);
      if (phoneTail && textDigits.includes(phoneTail)) return item;
      if (cleanName && text.toLowerCase().includes(cleanName)) return item;
    }

    if (allowFirstPhoneResult && items.length === 1 && !chatItemLooksEmpty(items[0])) return items[0];
    return null;
  }

  function setWhatsappSearchText(searchInput, text) {
    if (!searchInput) return;
    searchInput.focus();
    if (searchInput.tagName === 'INPUT') {
      // Input controlado pelo React: precisa do setter nativo + evento "input"
      const proto = window.HTMLInputElement?.prototype;
      const setter = proto && Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(searchInput, text || '');
      else searchInput.value = text || '';
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      document.execCommand('selectAll', false, null);
      document.execCommand('delete', false, null);
      if (text) document.execCommand('insertText', false, text);
    }
  }

  // Fallback para número NOVO (sem conversa prévia, não está na agenda):
  // abre o painel "Nova conversa" (ícone de compor no topo da sidebar),
  // digita o número e clica no resultado. Não interfere com conversas existentes.
  async function openNewChatViaCompose(phoneFull) {
    const phoneDigits = digits(phoneFull);
    if (!phoneDigits || phoneDigits.length < 10) return false;
    console.log('[FocalPoint] Nova Conversa fallback:', phoneFull);

    const composeBtn =
      document.querySelector('button[aria-label*="Nova conversa" i]') ||
      document.querySelector('[aria-label*="Nova conversa" i][role="button"]') ||
      document.querySelector('button[aria-label*="New chat" i]') ||
      document.querySelector('[aria-label*="New chat" i][role="button"]') ||
      document.querySelector('span[data-icon*="new-chat" i]')?.closest('button, [role="button"]') ||
      document.querySelector('span[data-icon="chat"]')?.closest('button, [role="button"]');

    console.log('[FocalPoint] composeBtn:', composeBtn);
    if (!composeBtn) return false;

    simulateRealClick(composeBtn);
    await sleep(700);

    // Input da tela "Nova conversa" — pode ser <input> ou contenteditable
    const findComposeSearch = () => {
      const inputs = [...document.querySelectorAll('input[type="text"], input:not([type]), div[contenteditable="true"][role="textbox"]')];
      for (const el of inputs) {
        if (!el.offsetWidth) continue;
        const label = (el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('title') || '').toLowerCase();
        if (/esquisar nome|esquisar contato|search name|search contact/i.test(label)) return el;
      }
      // fallback: qualquer input/contenteditable visível que NÃO seja o input principal da sidebar nem o compositor
      for (const el of inputs) {
        if (!el.offsetWidth) continue;
        if (el.closest('#main')) continue;
        const label = (el.getAttribute('aria-label') || el.getAttribute('placeholder') || '').toLowerCase();
        if (/esquisar|search/i.test(label)) return el;
      }
      return null;
    };

    const composeSearch = findComposeSearch();
    console.log('[FocalPoint] composeSearch:', composeSearch?.tagName, composeSearch?.getAttribute('aria-label'));
    if (!composeSearch) {
      document.querySelector('button[aria-label="Voltar"], [aria-label="Back"]')?.click();
      return false;
    }

    composeSearch.focus();
    if (composeSearch.tagName === 'INPUT') {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(composeSearch, phoneFull);
      composeSearch.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      document.execCommand('selectAll', false, null);
      document.execCommand('delete', false, null);
      document.execCommand('insertText', false, phoneFull);
    }
    await sleep(1200);

    const phoneTail = phoneDigits.slice(-8);
    let target = null;

    // Procura "Conversar com" ou similar
    for (const el of document.querySelectorAll('div, span, [role="button"], [role="listitem"], [role="row"], li')) {
      if (!el.offsetWidth) continue;
      const t = (el.textContent || '').trim();
      if (!t || t.length > 200) continue;
      if (!/conversar com|iniciar conversa|chat with|send message|enviar mensagem/i.test(t)) continue;
      if (digits(t).includes(phoneTail)) {
        target = el.closest('[role="button"], [role="listitem"], [role="row"], li') || el;
        break;
      }
    }

    // Fallback: primeiro item de lista visível com phoneTail
    if (!target) {
      for (const item of document.querySelectorAll('[role="listitem"], [role="row"]')) {
        if (!item.offsetWidth) continue;
        if (digits(item.textContent || '').includes(phoneTail)) {
          target = item;
          break;
        }
      }
    }

    console.log('[FocalPoint] Nova Conversa target:', target);
    if (!target) {
      document.querySelector('button[aria-label="Voltar"], [aria-label="Back"]')?.click();
      return false;
    }

    simulateRealClick(target);
    await sleep(500);
    return true;
  }

  async function tryOpenSendRouteInApp(phoneFull) {
    const previousUrl = window.location.href;

    try {
      window.history.pushState({ fpOpenChat: true }, '', `/send?phone=${phoneFull}`);
      window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }));
      await sleep(1400);

      const openedPhone = digits(getWAChatPhone() || '');
      if (openedPhone && openedPhone.endsWith(phoneFull.slice(-8))) {
        toast('Conversa aberta');
        return true;
      }
    } catch {
      // Se o WhatsApp mudar a estratégia de roteamento, seguimos sem recarregar.
    }

    try { window.history.replaceState(window.history.state, '', previousUrl); } catch { /* ignora */ }
    return false;
  }

  // Localiza o painel da lista de chats do WhatsApp Web em várias versões
  function findChatListPanel() {
    return (
      document.querySelector('#pane-side') ||
      document.querySelector('#side') ||
      document.querySelector('[data-testid="chat-list"]') ||
      document.querySelector('[aria-label*="Lista de conversas" i]') ||
      document.querySelector('[aria-label*="Chat list" i]') ||
      null
    );
  }

  // Abre conversa do WhatsApp Web na mesma aba, sem recarregar.
  async function openByNumberInApp(phoneFull, contactName = '') {
    phoneFull = normalizeWhatsappPhone(phoneFull);

    // Esconde kanban/agenda primeiro — eles cobrem o WhatsApp e impedem
    // que cliques na lista/busca funcionem.
    if (kanbanVisible) hideKanban();
    hideAgenda();

    // Espera um tick pro WA reagir ao Esc/scroll antes de procurar a sidebar
    await sleep(120);

    const sideEl = findChatListPanel();
    if (!sideEl) {
      toast('Lista do WhatsApp não encontrada. Recarregue a página do WhatsApp.', true);
      return;
    }

    // 1) Busca direta no DOM já carregado
    const visibleItem = findChatItem(phoneFull, contactName);
    if (visibleItem) {
      hideKanban();
      simulateRealClick(visibleItem);
      toast('Conversa aberta');
      return true;
    }

    // 2) Usa a busca interna do WhatsApp sem navegar/recarregar.
    // WhatsApp Web 2026 mudou de contenteditable pra <input> — testamos ambos.
    const searchInput =
      document.querySelector('#side input[aria-label*="esquisar" i]') ||
      document.querySelector('input[aria-label*="esquisar" i]') ||
      document.querySelector('input[placeholder*="esquisar" i]') ||
      document.querySelector('input[aria-label*="search" i]') ||
      document.querySelector('#side div[contenteditable="true"][role="textbox"]') ||
      document.querySelector('div[role="textbox"][contenteditable="true"][title]') ||
      document.querySelector('[data-testid="chat-list-search"] div[contenteditable="true"]');

    if (!searchInput) {
      toast('Não achei a barra de busca do WhatsApp. Tente recarregar.', true);
      return;
    }

    hideKanban();

    const terms = [phoneFull, contactName]
      .map(term => String(term || '').trim())
      .filter((term, idx, arr) => term && arr.indexOf(term) === idx);

    for (const term of terms) {
      setWhatsappSearchText(searchInput, term);
      await sleep(900);

      const match = findChatItem(phoneFull, contactName, digits(term).length >= 8);
      if (match) {
        simulateRealClick(match);
        toast('Conversa aberta');
        await sleep(600);
        setWhatsappSearchText(searchInput, '');
        return true;
      }
    }

    setWhatsappSearchText(searchInput, '');
    if (phoneFull && await tryOpenSendRouteInApp(phoneFull)) return true;
    // Último recurso: cria conversa nova via UI "Nova conversa"
    if (phoneFull && await openNewChatViaCompose(phoneFull)) {
      toast('Conversa aberta');
      return true;
    }

    toast('Não encontrei essa conversa no WhatsApp sem recarregar.', true);
    return false;
  }

  function matches(d) {
    if (!q) return true;
    return `${d.contact_name || d.title || ''} ${d.contact_phone || ''} ${getDealShootType(d)}`.toLowerCase().includes(q);
  }

  function getDealShootType(deal) {
    const notes = String(deal?.notes || '');
    const match = notes.match(/(?:^|\n)\s*Tipo de ensaio:\s*(.+)\s*(?:\n|$)/i);
    return match?.[1]?.trim() || '';
  }

  function stripDealMetaFromNotes(notes) {
    return String(notes || '')
      .replace(/(?:^|\n)\s*Tipo de ensaio:\s*.+(?=\n|$)/i, '')
      .replace(/^\n+/, '')
      .trim();
  }

  function buildDealNotes(shootType, notes) {
    const cleanType = String(shootType || '').trim();
    const cleanNotes = String(notes || '').trim();
    return [cleanType ? `Tipo de ensaio: ${cleanType}` : '', cleanNotes].filter(Boolean).join('\n');
  }

  function card(d, c) {
    const name = d.contact_name || d.title || 'Sem nome';
    const phone = d.contact_phone || '';
    const photo = getCachedContactPhoto(phone);
    const type = getDealShootType(d);
    const phoneLabel = phone ? `+${digits(phone).replace(/(\d{2})(\d{2})(\d{5})(\d{4})/, '$1 ($2) $3-$4')}` : '';
    const sub = [type, phoneLabel || stripDealMetaFromNotes(d.notes)?.substring(0, 40)].filter(Boolean).join(' · ');
    const avatar = photo
      ? `<div class="fpc-av fpc-av-img"><img src="${esc(photo)}" alt="" /></div>`
      : `<div class="fpc-av" style="background:${c.dot}">${esc(initials(name))}</div>`;
    const seller = d.assigned_to ? teamMembers.find(m => m.id === d.assigned_to) : null;
    const sellerBadge = seller
      ? `<span class="fpc-seller" style="background:${esc(seller.color || '#6366f1')}" title="${esc(seller.name)}">${esc(initials(seller.name))}</span>`
      : '';
    return `
      <div class="fpc-card" data-id="${d.id}" data-phone="${esc(phone)}">
        <div class="fpc-card-top">
          ${avatar}
          <div class="fpc-info">
            <div class="fpc-name">${esc(name)}</div>
            <div class="fpc-sub">${esc(sub)}</div>
          </div>
          <div class="fpc-date">${fmtDate(d.updated_at || d.created_at)}</div>
        </div>
        <div class="fpc-card-bot">
          <span class="fpc-val">${d.value ? brl.format(d.value) : '—'}</span>
          <div class="fpc-actions">
            ${sellerBadge}
            ${phone ? `<button class="fpc-open fpc-followup" data-action="followup" data-phone="${esc(phone)}" title="Enviar mensagem de follow-up da etapa">Follow-up</button>` : ''}
            ${phone ? `<button class="fpc-open" data-action="open" data-phone="${esc(phone)}">Chat</button>` : ''}
            <button class="fpc-open" data-action="edit">Editar</button>
            <button class="fpc-open" data-action="move">Mover</button>
          </div>
        </div>
      </div>`;
  }

  function bindCard(el) {
    const id = Number(el.dataset.id);
    const phone = el.dataset.phone;
    const name = el.querySelector('.fpc-name')?.textContent?.trim() || '';
    const deal = deals.find(d => Number(d.id) === id);

    el.addEventListener('pointerdown', (e) => startPointerCardDrag(e, el, id));

    el.addEventListener('dragstart', e => {
      dragMoved = true;
      draggingId = id;
      draggingInboxIdx = null;
      el.classList.add('dragging');
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.dropEffect = 'move';
        e.dataTransfer.setData('text/plain', String(id));
        e.dataTransfer.setData('application/x-focalpoint-deal-id', String(id));
      }
    });
    el.addEventListener('drag', () => {
      dragMoved = true;
    });
    el.addEventListener('dragend', () => {
      el.classList.remove('dragging');
      document.querySelectorAll('.dp-over').forEach(x => x.classList.remove('dp-over'));
      setTimeout(() => {
        draggingId = null;
        draggingInboxIdx = null;
        dragMoved = false;
      }, 80);
    });

    el.querySelector('[data-action="open"]')?.addEventListener('click', e => {
      e.stopPropagation();
      openChat(phone, name);
    });
    el.querySelector('[data-action="followup"]')?.addEventListener('click', e => {
      e.stopPropagation();
      if (deal) sendFollowUp(deal);
    });
    el.querySelector('[data-action="edit"]')?.addEventListener('click', e => {
      e.stopPropagation();
      if (deal) openDealEditModal(deal);
    });
    el.querySelector('[data-action="move"]')?.addEventListener('click', e => {
      e.stopPropagation();
      if (!deal) return;
      openStageMenu(e.currentTarget, stages, deal.stage, (sid) => moveDealToStage(deal.id, sid), 'Mover card para');
    });

    el.addEventListener('click', (e) => {
      if (dragMoved) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      openChat(phone, name);
    });
  }

  function startPointerCardDrag(event, cardEl, itemId, kind = 'deal') {
    if (event.button !== 0) return;
    if (event.target.closest('button, input, textarea, select, a')) return;

    const rect = cardEl.getBoundingClientRect();
    pointerDrag = {
      id: itemId,
      kind,
      cardEl,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      ghost: null,
      overZone: null,
    };

    const onMove = (e) => updatePointerCardDrag(e);
    const onUp = (e) => {
      document.removeEventListener('pointermove', onMove, true);
      document.removeEventListener('pointerup', onUp, true);
      finishPointerCardDrag(e);
    };

    document.addEventListener('pointermove', onMove, true);
    document.addEventListener('pointerup', onUp, true);
  }

  function updatePointerCardDrag(event) {
    if (!pointerDrag) return;

    const dx = event.clientX - pointerDrag.startX;
    const dy = event.clientY - pointerDrag.startY;
    if (!pointerDrag.ghost && Math.hypot(dx, dy) < 6) return;

    event.preventDefault();
    dragMoved = true;
    draggingId = pointerDrag.kind === 'deal' ? pointerDrag.id : null;
    draggingInboxIdx = pointerDrag.kind === 'inbox' ? pointerDrag.id : null;

    if (!pointerDrag.ghost) {
      pointerDrag.cardEl.classList.add('dragging');
      const ghost = pointerDrag.cardEl.cloneNode(true);
      ghost.classList.add('fpc-card-ghost');
      ghost.style.width = `${pointerDrag.cardEl.getBoundingClientRect().width}px`;
      document.body.appendChild(ghost);
      pointerDrag.ghost = ghost;
    }

    pointerDrag.ghost.style.left = `${event.clientX - pointerDrag.offsetX}px`;
    pointerDrag.ghost.style.top = `${event.clientY - pointerDrag.offsetY}px`;

    const board = document.getElementById('fp-board');
    if (board) {
      const boardRect = board.getBoundingClientRect();
      if (event.clientX > boardRect.right - 80) board.scrollLeft += 24;
      else if (event.clientX < boardRect.left + 80) board.scrollLeft -= 24;
    }

    pointerDrag.ghost.style.display = 'none';
    const under = document.elementFromPoint(event.clientX, event.clientY);
    pointerDrag.ghost.style.display = '';
    const zone = under?.closest?.('.fpc-body[data-stage-id]') || under?.closest?.('.fpc[data-stage-id]')?.querySelector('.fpc-body[data-stage-id]');

    if (zone !== pointerDrag.overZone) {
      pointerDrag.overZone?.classList.remove('dp-over');
      zone?.classList.add('dp-over');
      pointerDrag.overZone = zone || null;
    }
  }

  function finishPointerCardDrag(event) {
    if (!pointerDrag) return;

    const { id, kind, cardEl, ghost, overZone } = pointerDrag;
    ghost?.remove();
    cardEl.classList.remove('dragging');
    document.querySelectorAll('.dp-over').forEach(x => x.classList.remove('dp-over'));

    pointerDrag = null;
    draggingId = null;
    draggingInboxIdx = null;

    if (dragMoved && overZone?.dataset.stageId) {
      event.preventDefault();
      event.stopPropagation();
      if (kind === 'inbox') addInboxItemToStage(id, overZone.dataset.stageId);
      else moveDealToStage(id, overZone.dataset.stageId);
    }

    setTimeout(() => { dragMoved = false; }, 220);
  }

  // Primeiro nome do contato (pra usar no template "Olá {nome}!").
  function firstNameOf(deal) {
    const full = (deal?.contact_name || deal?.title || '').trim();
    if (!full) return '';
    // Remove emoji/caracteres especiais e pega só a primeira palavra alfabética
    const cleaned = full.replace(/[^\p{L}\s'-]/gu, '').trim();
    return cleaned.split(/\s+/)[0] || '';
  }

  // Tenta escrever um texto no compositor de mensagens do WhatsApp Web
  // (contenteditable). Preserva mensagem caso o user já estivesse digitando.
  function setWhatsappComposer(text) {
    if (!text) return false;
    const composer =
      document.querySelector('#main footer div[contenteditable="true"]') ||
      document.querySelector('div[role="textbox"][contenteditable="true"][data-tab]') ||
      document.querySelector('footer [contenteditable="true"]');
    if (!composer) return false;
    composer.focus();
    document.execCommand('selectAll', false, null);
    document.execCommand('delete', false, null);
    document.execCommand('insertText', false, text);
    return true;
  }

  // Follow-up individual de 1 card: reaproveita o modal de massa pra dar UX
  // consistente — user vê a mensagem, edita se quiser, e dispara. Se a etapa
  // não tem template, o textarea abre vazio pra digitar na hora.
  function sendFollowUp(deal) {
    if (!deal?.contact_phone) return toast('Lead sem telefone', true);
    const stage = stages.find(s => s.id === deal.stage) || { id: deal.stage, name: deal.stage, follow_up_message: '' };
    openMassFollowUpModal(stage, [deal]);
  }

  // Estado da fila de follow-up em massa
  let massQueue = null; // { deals: [], message: string, idx: 0 }

  function openMassFollowUpModal(stage, customDeals = null) {
    document.getElementById('fp-mass-modal')?.remove();
    const stageDeals = (customDeals || deals.filter(d => d.stage === stage.id))
      .filter(d => d.contact_phone);
    if (!stageDeals.length) return toast('Nenhum lead com telefone', true);

    const template = stage.follow_up_message?.trim() || `Oi {nome}, tudo bem? Passando pra ver se você tem alguma dúvida 😊`;
    const singleMode = stageDeals.length === 1;

    const modal = document.createElement('div');
    modal.id = 'fp-mass-modal';
    modal.className = 'fp-info-overlay';
    modal.innerHTML = `
      <div class="fp-mass-box">
        <div class="fp-mass-head">
          <div>
            <div class="fp-mass-title">${singleMode ? 'Enviar follow-up' : 'Follow-up em massa'}</div>
            <div class="fp-mass-sub">${singleMode
              ? `Para <strong>${esc(stageDeals[0].contact_name || stageDeals[0].title || 'cliente')}</strong>`
              : `Etapa: <strong>${esc(stage.name)}</strong> · ${stageDeals.length} leads`}</div>
          </div>
          <button class="fp-info-close" id="fp-mass-close">✕</button>
        </div>

        <div class="fp-mass-body">
          <!-- Mensagem -->
          <div class="fp-mass-section">
            <label class="fp-mass-label">Mensagem</label>
            <div class="fp-mass-toolbar">
              <button class="fp-mass-chip" data-insert="{nome}" title="Insere o primeiro nome do contato">+ Nome</button>
              <button class="fp-mass-chip" data-insert="Bom dia! " title="Inserir saudação no início">Bom dia</button>
              <button class="fp-mass-chip" data-insert="Boa tarde! " title="Inserir saudação no início">Boa tarde</button>
              <button class="fp-mass-chip" data-insert="Boa noite! " title="Inserir saudação no início">Boa noite</button>
            </div>
            <textarea id="fp-mass-text" class="fp-mass-textarea" rows="4" placeholder="Escreva a mensagem. Use {nome} pra personalizar.">${esc(template)}</textarea>
            <div class="fp-mass-preview">
              <span class="fp-mass-preview-label">Prévia pra <strong id="fp-mass-preview-name">${esc(firstNameOf(stageDeals[0]) || 'cliente')}</strong>:</span>
              <div class="fp-mass-preview-box" id="fp-mass-preview-box"></div>
            </div>
          </div>

          ${singleMode ? '' : `
          <!-- Lista de leads (só no modo massa) -->
          <div class="fp-mass-section">
            <div class="fp-mass-label-row">
              <label class="fp-mass-label">Selecionar leads</label>
              <button class="fp-mass-link" id="fp-mass-toggle-all">Marcar/desmarcar todos</button>
            </div>
            <div class="fp-mass-list">
              ${stageDeals.map(d => {
                const photo = getCachedContactPhoto(d.contact_phone);
                const initialsTxt = initials(d.contact_name || d.title || '');
                const avatar = photo
                  ? `<img class="fp-mass-avt" src="${esc(photo)}" alt="" />`
                  : `<div class="fp-mass-avt fp-mass-avt-ini">${esc(initialsTxt)}</div>`;
                return `
                  <label class="fp-mass-row" data-deal-id="${d.id}">
                    <input type="checkbox" class="fp-mass-chk" checked data-deal-id="${d.id}" />
                    ${avatar}
                    <div class="fp-mass-row-info">
                      <div class="fp-mass-row-name">${esc(d.contact_name || d.title || 'Sem nome')}</div>
                      <div class="fp-mass-row-phone">${esc(d.contact_phone || '')}</div>
                    </div>
                  </label>
                `;
              }).join('')}
            </div>
          </div>
          `}
        </div>

        <div class="fp-mass-foot">
          <button class="fp-btn-w" id="fp-mass-cancel">Cancelar</button>
          <button class="fp-btn-g" id="fp-mass-start">
            ${singleMode ? 'Abrir conversa e colar' : `Iniciar fila <span id="fp-mass-count">(${stageDeals.length})</span>`}
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const textarea = modal.querySelector('#fp-mass-text');
    const previewBox = modal.querySelector('#fp-mass-preview-box');
    const previewName = modal.querySelector('#fp-mass-preview-name');
    const countSpan = modal.querySelector('#fp-mass-count');

    const updatePreview = () => {
      const tpl = textarea.value;
      const first = firstNameOf(stageDeals[0]);
      const rendered = tpl.replace(/\{nome\}/gi, first).replace(/\{primeiro_nome\}/gi, first).replace(/\{name\}/gi, first);
      previewBox.textContent = rendered;
      if (previewName) previewName.textContent = first || 'cliente';
      // Destaca onde o {nome} aparece com fundo dourado
      const escaped = rendered.replace(/[&<>"']/g, m => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[m]));
      const highlighted = first ? escaped.replace(new RegExp(`(${first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'), '<mark>$1</mark>') : escaped;
      previewBox.innerHTML = highlighted;
    };

    const updateCount = () => {
      if (singleMode || !countSpan) return;
      const checked = modal.querySelectorAll('.fp-mass-chk:checked').length;
      countSpan.textContent = `(${checked})`;
    };

    updatePreview();
    textarea.addEventListener('input', updatePreview);

    modal.querySelectorAll('.fp-mass-chip[data-insert]').forEach((b) => {
      b.addEventListener('click', () => {
        const insert = b.getAttribute('data-insert');
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        textarea.value = textarea.value.slice(0, start) + insert + textarea.value.slice(end);
        textarea.focus();
        textarea.selectionStart = textarea.selectionEnd = start + insert.length;
        updatePreview();
      });
    });

    modal.querySelectorAll('.fp-mass-chk').forEach((c) => c.addEventListener('change', updateCount));

    modal.querySelector('#fp-mass-toggle-all')?.addEventListener('click', () => {
      const all = modal.querySelectorAll('.fp-mass-chk');
      const allChecked = Array.from(all).every(c => c.checked);
      all.forEach(c => { c.checked = !allChecked; });
      updateCount();
    });

    const close = () => modal.remove();
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
    modal.querySelector('#fp-mass-close')?.addEventListener('click', close);
    modal.querySelector('#fp-mass-cancel')?.addEventListener('click', close);

    modal.querySelector('#fp-mass-start')?.addEventListener('click', () => {
      const message = textarea.value.trim();
      if (!message) return toast('Mensagem vazia', true);
      const selected = singleMode
        ? stageDeals
        : Array.from(modal.querySelectorAll('.fp-mass-chk:checked'))
            .map((c) => stageDeals.find(d => String(d.id) === c.getAttribute('data-deal-id')))
            .filter(Boolean);
      if (!selected.length) return toast('Selecione pelo menos 1 lead', true);
      close();
      startMassFollowUpQueue(selected, message);
    });
  }

  async function startMassFollowUpQueue(targetDeals, template) {
    massQueue = { deals: targetDeals, message: template, idx: 0 };
    showMassQueueWidget();
    await openCurrentMassQueueLead();
  }

  function showMassQueueWidget() {
    document.getElementById('fp-mass-widget')?.remove();
    const w = document.createElement('div');
    w.id = 'fp-mass-widget';
    w.innerHTML = `
      <div class="fp-mw-info">
        <div class="fp-mw-title">Follow-up em massa</div>
        <div class="fp-mw-prog" id="fp-mw-prog">—</div>
      </div>
      <button class="fp-mw-btn fp-mw-skip" id="fp-mw-skip">Pular</button>
      <button class="fp-mw-btn fp-mw-next" id="fp-mw-next">Próximo →</button>
      <button class="fp-mw-btn fp-mw-stop" id="fp-mw-stop" title="Encerrar fila">✕</button>
    `;
    document.body.appendChild(w);
    w.querySelector('#fp-mw-next')?.addEventListener('click', () => advanceMassQueue(false));
    w.querySelector('#fp-mw-skip')?.addEventListener('click', () => advanceMassQueue(true));
    w.querySelector('#fp-mw-stop')?.addEventListener('click', stopMassQueue);
  }

  function updateMassWidget() {
    const prog = document.getElementById('fp-mw-prog');
    if (!prog || !massQueue) return;
    const cur = massQueue.deals[massQueue.idx];
    const name = cur ? (cur.contact_name || cur.title || cur.contact_phone) : '—';
    prog.innerHTML = `${massQueue.idx + 1}/${massQueue.deals.length} · <strong>${esc(name)}</strong>`;
  }

  async function openCurrentMassQueueLead() {
    if (!massQueue) return;
    const deal = massQueue.deals[massQueue.idx];
    if (!deal) { stopMassQueue(); return; }
    updateMassWidget();

    const first = firstNameOf(deal);
    const msg = massQueue.message
      .replace(/\{nome\}/gi, first)
      .replace(/\{primeiro_nome\}/gi, first)
      .replace(/\{name\}/gi, first);

    const ok = await openByNumberInApp(deal.contact_phone, deal.contact_name || '');
    if (!ok) return; // toast já mostrado pelo openByNumberInApp

    for (let i = 0; i < 12; i++) {
      await sleep(180);
      if (setWhatsappComposer(msg)) {
        toast('Revise e envie. Depois clique "Próximo →"');
        return;
      }
    }
    toast('Conversa aberta, cole a mensagem manualmente. Depois clique "Próximo →"', true);
  }

  async function advanceMassQueue(skipped) {
    if (!massQueue) return;
    massQueue.idx += 1;
    if (massQueue.idx >= massQueue.deals.length) {
      stopMassQueue();
      toast('🎉 Fila concluída!');
      return;
    }
    await openCurrentMassQueueLead();
  }

  function stopMassQueue() {
    massQueue = null;
    document.getElementById('fp-mass-widget')?.remove();
  }

  async function moveDealToStage(dealId, stageId) {
    const deal = deals.find(d => Number(d.id) === Number(dealId));
    if (!deal || deal.stage === stageId) return;
    const targetStage = stages.find(s => s.id === stageId);

    if (isWonStage(targetStage)) {
      openWonConversionModal(deal);
      return;
    }
    if (isLostStage(targetStage)) {
      openLostDealModal(deal, stageId);
      return;
    }

    const prev = deal.stage;
    deal.stage = stageId;
    renderBoard();

    try {
      await bg({ type: 'MOVE_STAGE', dealId, stageId });
      const sn = stages.find(s => s.id === stageId)?.name || stageId;
      toast(`Movido para "${sn}"!`);
    } catch (err) {
      deal.stage = prev;
      renderBoard();
      toast(err.message, true);
    }
  }

  async function resolveInboxItemContact(item) {
    const nameLooksLikePhone = /^\+?\d[\d\s\-()+]{5,}$/.test(String(item?.name || '').trim());
    let phone = item?.phone || extractPhoneFromChatListItem(item?.el, item?.name);
    let name = nameLooksLikePhone ? '' : cleanWhatsappNameCandidate(item?.name) || item?.name || '';
    let photo = item?.photo || null;

    if (item?.el && (!phone || !name)) {
      suppressChatListClickUntil = Date.now() + 1600;
      simulateRealClick(item.el);
      await sleep(900);

      const parsed = extractCadastroFromVisibleConversation();
      const contact = getCurrentChatContact(phone);
      phone = parsed.phone || digits(getWAChatPhone() || '') || contact.phone || phone;
      name = parsed.name || cleanWhatsappNameCandidate(contact.name) || name || item.name || phone;
      photo = getWAChatPhoto() || photo;
      setTimeout(() => { suppressChatListClickUntil = 0; }, 100);
    }

    phone = normalizeWhatsappPhone(phone);
    if (!name || /^\+?\d[\d\s\-()+]{5,}$/.test(name)) name = phone || item?.name || 'Contato WhatsApp';
    return { name, phone, photo };
  }

  async function addInboxItemToStage(idx, stageId) {
    const item = inboxItems[idx];
    if (!item) return;

    const targetStage = stages.find(s => s.id === stageId);
    const createStage = (isWonStage(targetStage) || isLostStage(targetStage))
      ? (firstOpenStage(stages)?.id || stageId)
      : stageId;

    toast('Buscando dados da conversa...');
    const contact = await resolveInboxItemContact(item);
    if (!contact.phone) {
      openModal('', contact.name || item.name, createStage, true);
      toast('Não consegui detectar o telefone. Complete os dados para adicionar ao funil.', true);
      return;
    }

    rememberContactPhoto(contact.phone, contact.photo);

    try {
      const existing = await bg({ type: 'GET_DEAL_BY_PHONE', phone: contact.phone }).catch(() => null);
      if (existing?.deal) {
        const deal = existing.deal;
        const local = deals.find(d => Number(d.id) === Number(deal.id));
        if (local) Object.assign(local, deal);
        else deals.push(deal);

        if (isWonStage(targetStage)) {
          openWonConversionModal(local || deal);
        } else if (isLostStage(targetStage)) {
          openLostDealModal(local || deal, stageId);
        } else {
          await moveDealToStage(deal.id, stageId);
        }
        return;
      }

      const created = await bg({
        type: 'CREATE_DEAL',
        data: {
          name: contact.name || contact.phone,
          phone: contact.phone,
          value: 0,
          source: 'whatsapp-inbox',
          stage: createStage,
        },
      });

      toast(targetStage ? `Adicionado em "${targetStage.name}"` : 'Adicionado ao pipeline');
      await loadKanban();

      const createdDeal =
        deals.find(d => Number(d.id) === Number(created?.id)) ||
        deals.find(d => digits(d.contact_phone || '').endsWith(contact.phone.slice(-8)));
      if (isWonStage(targetStage) && createdDeal) openWonConversionModal(createdDeal);
      if (isLostStage(targetStage) && createdDeal) openLostDealModal(createdDeal, stageId);
    } catch (err) {
      toast(err.message, true);
    }
  }

  async function drop(stageId, col, event) {
    document.querySelectorAll('.dp-over').forEach(x => x.classList.remove('dp-over'));

    const inboxRaw =
      draggingInboxIdx !== null
        ? String(draggingInboxIdx)
        : event?.dataTransfer?.getData('application/x-focalpoint-inbox-idx') ||
          String(event?.dataTransfer?.getData('text/plain') || '').match(/^inbox:(\d+)$/)?.[1] ||
          '';
    const inboxIdx = inboxRaw !== '' ? Number(inboxRaw) : NaN;
    if (Number.isFinite(inboxIdx)) {
      await addInboxItemToStage(inboxIdx, stageId);
      draggingId = null;
      draggingInboxIdx = null;
      return;
    }

    const droppedId =
      draggingId ||
      Number(event?.dataTransfer?.getData('application/x-focalpoint-deal-id')) ||
      Number(event?.dataTransfer?.getData('text/plain'));

    if (!droppedId) return;
    await moveDealToStage(droppedId, stageId);
    draggingId = null;
    draggingInboxIdx = null;
  }

  function bindStageDropZone(zone) {
    const stageId = zone.dataset.stageId;
    const targets = [zone, zone.closest('.fpc')].filter(Boolean);

    targets.forEach(target => {
      target.addEventListener('dragenter', (e) => {
        e.preventDefault();
        zone.classList.add('dp-over');
      });
      target.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        zone.classList.add('dp-over');
      });
      target.addEventListener('dragleave', (e) => {
        if (!target.contains(e.relatedTarget)) zone.classList.remove('dp-over');
      });
      target.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        drop(stageId, zone, e);
      });
    });
  }

  // ===== ABRIR CHAT NO WA =====
  // O WhatsApp Web roda React. element.click() puro NÃO dispara handlers —
  // precisamos sintetizar mousedown+mouseup+click reais com bubbling.
  function simulateRealClick(el) {
    if (!el) return false;
    // O alvo clicável geralmente é um filho com role=button ou listitem
    const target =
      el.querySelector('[role="button"]') ||
      el.querySelector('[tabindex]') ||
      el;
    const rect = target.getBoundingClientRect();
    const opts = {
      bubbles: true,
      cancelable: true,
      view: window,
      button: 0,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
    };
    target.dispatchEvent(new MouseEvent('mousedown', opts));
    target.dispatchEvent(new MouseEvent('mouseup', opts));
    target.dispatchEvent(new MouseEvent('click', opts));
    return true;
  }

  async function openChat(phone, name = '') {
    if (!phone) return;
    await openByNumberInApp(phone, name);
  }

  // Desselecciona o chat ativo no WhatsApp Web — devolve à tela inicial.
  // Garante que notificações de mensagens novas continuem chegando normalmente
  // e que a próxima abertura de chat reative `detectState`.
  function deselectWhatsappChat() {
    chatKey = null;
    chatPhone = null;
    chatDeal = null;
    removeChatStrip();
    // Tenta clicar no logo do WhatsApp ou disparar Esc duas vezes (fecha pesquisa+chat)
    try { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); } catch {}
    try { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); } catch {}
  }

  function setRailActive(id) {
    document.querySelectorAll('#fp-rail .fp-rail-btn').forEach((b) => b.classList.remove('fp-rail-active'));
    if (id) document.getElementById(id)?.classList.add('fp-rail-active');
  }

  function hideKanban() {
    kanbanVisible = false;
    document.getElementById('fp-kanban')?.classList.add('fp-hidden');
    setRailActive(null);
    // Se voltamos a uma conversa que já estava aberta, restaura a faixa removida ao abrir o kanban
    if (document.getElementById('fp-chat-strip') || !chatKey) return;
    if (chatDeal) {
      injectChatStrip(chatDeal, chatStages.length ? chatStages : stages);
    } else if (chatPhone) {
      injectAddStrip(chatPhone);
    }
  }

  function showKanban() {
    // Garante que a conversa ativa seja fechada — o user fica visualmente "na home"
    // do WhatsApp ao alternar pro funil. Notificações continuam funcionando.
    deselectWhatsappChat();
    kanbanVisible = true;
    adjustPosition();
    hideAgenda();
    document.getElementById('fp-kanban')?.classList.remove('fp-hidden');
    setRailActive('fp-rail-pipeline');
    // A faixa do chat tem z-index altíssimo e cobriria o cabeçalho do funil
    removeChatStrip();
    loadKanban();
  }

  // ===== AGENDA =====
  let agendaState = { year: new Date().getFullYear(), month: new Date().getMonth() + 1, events: [] };

  function buildAgendaOverlay() {
    if (document.getElementById('fp-agenda')) return;
    const el = document.createElement('div');
    el.id = 'fp-agenda';
    el.className = 'fp-hidden';
    el.innerHTML = `
      <div id="fp-ag-h">
        <button id="fp-ag-prev" title="Mês anterior">‹</button>
        <h3 id="fp-ag-title">—</h3>
        <button id="fp-ag-next" title="Próximo mês">›</button>
        <div style="flex:1"></div>
        <button id="fp-ag-today">Hoje</button>
      </div>
      <div id="fp-ag-weekdays"></div>
      <div id="fp-ag-grid"></div>
      <div id="fp-ag-day-list"></div>
    `;
    document.body.appendChild(el);
    el.querySelector('#fp-ag-prev')?.addEventListener('click', () => navigateAgenda(-1));
    el.querySelector('#fp-ag-next')?.addEventListener('click', () => navigateAgenda(1));
    el.querySelector('#fp-ag-today')?.addEventListener('click', () => {
      const n = new Date();
      agendaState.year = n.getFullYear();
      agendaState.month = n.getMonth() + 1;
      loadAgenda();
    });
  }

  function navigateAgenda(delta) {
    let m = agendaState.month + delta;
    let y = agendaState.year;
    if (m < 1) { m = 12; y -= 1; }
    if (m > 12) { m = 1; y += 1; }
    agendaState.year = y;
    agendaState.month = m;
    loadAgenda();
  }

  async function loadAgenda() {
    buildAgendaOverlay();
    const titleEl = document.getElementById('fp-ag-title');
    const monthName = new Date(agendaState.year, agendaState.month - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
    if (titleEl) titleEl.textContent = monthName.charAt(0).toUpperCase() + monthName.slice(1);

    try {
      const res = await bg({ type: 'GET_AGENDA', year: agendaState.year, month: agendaState.month });
      console.log('[FocalPoint] agenda response:', res);
      agendaState.events = res?.events || [];
    } catch (err) {
      console.error('[FocalPoint] agenda erro:', err);
      agendaState.events = [];
    }
    renderAgendaGrid();
  }

  // Paleta de cores por tipo de trabalho — visual estilo Google Calendar
  const AGENDA_COLORS = {
    'Newborn':         { bg: '#fce7f3', text: '#9d174d', dot: '#ec4899' },
    'Gestante':        { bg: '#f3e8ff', text: '#6b21a8', dot: '#a855f7' },
    'Família':         { bg: '#dcfce7', text: '#166534', dot: '#22c55e' },
    'Smash the Cake':  { bg: '#fef3c7', text: '#92400e', dot: '#f59e0b' },
    'Aniversário':     { bg: '#fee2e2', text: '#991b1b', dot: '#ef4444' },
    'Acompanhamento':  { bg: '#dbeafe', text: '#1e40af', dot: '#3b82f6' },
    'Casamento':       { bg: '#cffafe', text: '#155e75', dot: '#06b6d4' },
    'default':         { bg: '#e0e7ff', text: '#3730a3', dot: '#6366f1' },
  };
  function agendaColor(type) {
    return AGENDA_COLORS[type] || AGENDA_COLORS.default;
  }

  function renderAgendaGrid() {
    const grid = document.getElementById('fp-ag-grid');
    const wkd = document.getElementById('fp-ag-weekdays');
    const dayList = document.getElementById('fp-ag-day-list');
    if (!grid || !wkd || !dayList) return;

    wkd.innerHTML = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map(d => `<span>${d}</span>`).join('');

    const { year, month, events } = agendaState;
    const firstWeekday = new Date(year, month - 1, 1).getDay();
    const lastDay = new Date(year, month, 0).getDate();
    const prevLastDay = new Date(year, month - 1, 0).getDate();
    const today = new Date();
    const isCurrentMonth = today.getFullYear() === year && (today.getMonth() + 1) === month;

    // Agrupa eventos por dia, ordena por horário
    const byDay = new Map();
    events.forEach((e) => {
      const day = Number(String(e.date).slice(8, 10));
      if (!day) return;
      if (!byDay.has(day)) byDay.set(day, []);
      byDay.get(day).push(e);
    });
    byDay.forEach((list) => list.sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99')));

    // Total de células: completa 6 linhas (42 células) pra grid não pular
    const totalCells = 42;
    let html = '';

    // Dias do mês anterior (cinza)
    for (let i = firstWeekday - 1; i >= 0; i--) {
      html += `<div class="fp-ag-cell fp-ag-other"><span class="fp-ag-day-num">${prevLastDay - i}</span></div>`;
    }

    // Dias do mês atual
    for (let d = 1; d <= lastDay; d++) {
      const list = byDay.get(d) || [];
      const isToday = isCurrentMonth && today.getDate() === d;
      const visible = list.slice(0, 3);
      const extra = list.length - visible.length;
      html += `
        <div class="fp-ag-cell ${isToday ? 'fp-ag-today-cell' : ''}" data-day="${d}">
          <span class="fp-ag-day-num">${d}</span>
          <div class="fp-ag-chips">
            ${visible.map((e) => {
              const c = agendaColor(e.type);
              const time = e.time ? e.time.slice(0, 5) : '';
              return `<span class="fp-ag-chip" style="background:${c.bg};color:${c.text}" title="${esc((time ? time + ' · ' : '') + (e.title || ''))}">
                ${time ? `<span class="fp-ag-chip-time">${time}</span>` : ''}
                <span class="fp-ag-chip-title">${esc(e.title || '')}</span>
              </span>`;
            }).join('')}
            ${extra > 0 ? `<span class="fp-ag-chip-more">+${extra} mais</span>` : ''}
          </div>
        </div>
      `;
    }

    // Dias do próximo mês (preencher até 42 células)
    const filled = firstWeekday + lastDay;
    const remaining = totalCells - filled;
    for (let d = 1; d <= remaining; d++) {
      html += `<div class="fp-ag-cell fp-ag-other"><span class="fp-ag-day-num">${d}</span></div>`;
    }

    grid.innerHTML = html;

    grid.querySelectorAll('.fp-ag-cell[data-day]').forEach((cell) => {
      cell.addEventListener('click', () => {
        const day = Number(cell.getAttribute('data-day'));
        renderAgendaDayList(day);
        grid.querySelectorAll('.fp-ag-cell').forEach((c) => c.classList.remove('fp-ag-selected'));
        cell.classList.add('fp-ag-selected');
      });
    });

    // Por padrão mostra hoje (se está no mês atual) ou o primeiro dia com evento, ou dia 1
    const firstWithEvent = Array.from(byDay.keys()).sort((a, b) => a - b)[0];
    const initialDay = isCurrentMonth ? today.getDate() : (firstWithEvent || 1);
    renderAgendaDayList(initialDay);
    grid.querySelector(`.fp-ag-cell[data-day="${initialDay}"]`)?.classList.add('fp-ag-selected');
  }

  function renderAgendaDayList(day) {
    const list = document.getElementById('fp-ag-day-list');
    if (!list) return;
    const items = (agendaState.events || [])
      .filter((e) => Number(String(e.date).slice(8, 10)) === day)
      .sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99'));
    const dateStr = new Date(agendaState.year, agendaState.month - 1, day).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });

    if (items.length === 0) {
      list.innerHTML = `
        <div class="fp-ag-day-header">${dateStr}</div>
        <div class="fp-ag-empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="40" height="40" style="opacity:0.4;margin-bottom:8px"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
          <p>Nada marcado pra esse dia.</p>
        </div>
      `;
      return;
    }

    list.innerHTML = `
      <div class="fp-ag-day-header">${dateStr} <span class="fp-ag-day-count">${items.length}</span></div>
      ${items.map((e) => {
        const c = agendaColor(e.type);
        const timeStr = e.time
          ? (e.end_time ? `${e.time.slice(0, 5)} – ${e.end_time.slice(0, 5)}` : e.time.slice(0, 5))
          : 'Dia inteiro';
        return `
          <div class="fp-ag-event" style="border-left:3px solid ${c.dot}">
            <div class="fp-ag-event-time">${timeStr}</div>
            <div class="fp-ag-event-body">
              <div class="fp-ag-event-title">${esc(e.title)}</div>
              <div class="fp-ag-event-sub">${esc([e.type, e.client_name].filter(Boolean).join(' · ') || '')}</div>
            </div>
            ${e.status ? `<span class="fp-ag-event-status fp-ag-st-${esc(e.status)}">${esc(e.status)}</span>` : ''}
          </div>
        `;
      }).join('')}
    `;
  }

  function showAgenda() {
    deselectWhatsappChat();
    if (kanbanVisible) {
      kanbanVisible = false;
      document.getElementById('fp-kanban')?.classList.add('fp-hidden');
    }
    removeChatStrip();
    buildAgendaOverlay();
    adjustPosition(); // garante que a agenda começa DEPOIS da lista de chats do WA
    document.getElementById('fp-agenda')?.classList.remove('fp-hidden');
    setRailActive('fp-rail-agenda');
    loadAgenda();
    // Re-ajusta caso o WA termine de renderizar tarde
    setTimeout(adjustPosition, 200);
    setTimeout(adjustPosition, 800);
  }

  function hideAgenda() {
    document.getElementById('fp-agenda')?.classList.add('fp-hidden');
  }

  // ===== LOGOUT =====
  function confirmLogout() {
    if (!confirm('Sair da conta? Você precisará logar novamente.')) return;
    chrome.storage.local.remove(
      ['fp_token', 'fp_refresh_token', 'fp_user_name', 'fp_user_email', 'fp_token_expires'],
      () => {
        toast('Saiu da conta.');
        // Força tela de "Faça login" no kanban
        showBoardState(`
          <svg width="36" height="36" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
          <p style="font-weight:700;color:#111b21">Faça login para ver o pipeline</p>
          <button class="fp-btn-g" id="fp-login-btn" style="padding:9px 22px">Fazer login</button>
        `);
        document.getElementById('fp-login-btn')?.addEventListener('click', () => {
          chrome.runtime.sendMessage({ type: 'OPEN_LOGIN_TAB' });
        });
      },
    );
  }

  // ===== FAIXA CRM NO CHAT =====
  // Classifica uma etapa final em ganho/perda/neutro com base no nome
  function classifyFinalStage(s) {
    const n = (s?.name || '').toLowerCase();
    if (/ganho|ganhou|fechad|vendid|conclu|won/.test(n)) return 'won';
    if (/perd|cancel|sem interesse|desistiu|lost/.test(n)) return 'lost';
    return 'neutral';
  }

  function isWonStage(stage) {
    return !!stage?.is_won || classifyFinalStage(stage) === 'won';
  }

  function isLostStage(stage) {
    return classifyFinalStage(stage) === 'lost' || (!!stage?.is_final && !stage?.is_won);
  }

  function removeStageMenu() {
    document.getElementById('fp-stage-menu')?.remove();
  }

  function openStageMenu(anchor, stgs, currentStageId, onPick, title = 'Mover para etapa') {
    removeStageMenu();

    const list = orderedStages(stgs && stgs.length ? stgs : stages);
    if (!anchor || !list.length) {
      toast('Nenhuma etapa encontrada no funil', true);
      return;
    }

    const menu = document.createElement('div');
    menu.id = 'fp-stage-menu';
    menu.className = 'fp-stage-menu';
    menu.innerHTML = `
      <div class="fp-stage-menu-title">${esc(title)}</div>
      ${list.map((s, idx) => {
        const c = C(s.position ?? idx);
        const active = s.id === currentStageId;
        return `
          <button type="button" class="fp-stage-menu-btn ${active ? 'fp-active' : ''}" data-sid="${esc(s.id)}">
            <span class="fp-stage-menu-dot" style="background:${c.dot}"></span>
            <span class="fp-stage-menu-name">${esc(s.name)}</span>
            ${active ? '<span class="fp-stage-menu-check">✓</span>' : ''}
          </button>`;
      }).join('')}
    `;
    document.body.appendChild(menu);

    const rect = anchor.getBoundingClientRect();
    const menuWidth = 240;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - menuWidth - 8));
    const top = Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - menu.offsetHeight - 8));
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;

    const cleanup = () => {
      menu.remove();
      document.removeEventListener('click', onOutside, true);
      document.removeEventListener('keydown', onEsc, true);
    };
    const onOutside = (event) => {
      if (!menu.contains(event.target) && event.target !== anchor && !anchor.contains(event.target)) cleanup();
    };
    const onEsc = (event) => {
      if (event.key === 'Escape') cleanup();
    };

    menu.querySelectorAll('.fp-stage-menu-btn').forEach(btn => {
      bindPress(btn, () => {
        const stage = list.find(s => s.id === btn.dataset.sid);
        cleanup();
        if (stage) onPick(stage.id, stage.name);
      });
    });

    setTimeout(() => {
      document.addEventListener('click', onOutside, true);
      document.addEventListener('keydown', onEsc, true);
    }, 0);
  }

  function bindPress(el, handler) {
    if (!el) return;
    let lastRun = 0;
    const run = (event) => {
      event.preventDefault();
      event.stopPropagation();

      const now = Date.now();
      if (now - lastRun < 250) return;
      lastRun = now;
      handler(event);
    };

    el.addEventListener('pointerdown', run, true);
    el.addEventListener('click', run, true);
  }

  function positionChatStrip(strip = document.getElementById('fp-chat-strip')) {
    if (!strip) return;

    const main = document.querySelector('#main');
    const header = getChatHeaderEl();
    const mainRect = main?.getBoundingClientRect();
    const headerRect = header?.getBoundingClientRect();

    if (!mainRect) return;

    const candidates = [headerRect, mainRect]
      .filter(rect => rect && rect.width > 120 && rect.height > 20)
      .sort((a, b) => b.width - a.width);
    const rect = candidates[0] || mainRect;
    const viewportPad = 8;
    const minUsefulWidth = Math.min(560, window.innerWidth - (viewportPad * 2));

    let left = Math.max(viewportPad, Math.round(rect.left));
    let right = Math.max(viewportPad, Math.round(window.innerWidth - rect.right));
    let width = window.innerWidth - left - right;

    if (width < minUsefulWidth) {
      if (window.innerWidth - left - viewportPad >= minUsefulWidth) {
        right = viewportPad;
      } else {
        left = Math.max(viewportPad, window.innerWidth - minUsefulWidth - viewportPad);
        right = viewportPad;
      }
      width = window.innerWidth - left - right;
    }

    strip.classList.toggle('fp-chat-strip-compact', width < 680);
    strip.style.setProperty('--fp-chat-strip-left', `${left}px`);
    strip.style.setProperty('--fp-chat-strip-right', `${right}px`);
    strip.style.setProperty('--fp-chat-strip-top', `${Math.round(headerRect?.bottom || mainRect.top)}px`);
  }

  function mountChatStrip(strip) {
    document.body.appendChild(strip);
    positionChatStrip(strip);
    setTimeout(() => positionChatStrip(strip), 80);
    setTimeout(() => positionChatStrip(strip), 600);
    setTimeout(() => positionChatStrip(strip), 1400);
  }

  function injectChatStrip(deal, stgs) {
    removeChatStrip();
    const stage = stgs.find(s => s.id === deal?.stage);
    const c = C(stage?.position ?? 0);

    // Pega as etapas de Ganho e Perda (primeira de cada tipo)
    const finals = stgs.filter(s => s.is_final);
    const wonStage  = finals.find(s => classifyFinalStage(s) === 'won');
    const lostStage = finals.find(s => classifyFinalStage(s) === 'lost');
    const isAtWon  = wonStage  && deal.stage === wonStage.id;
    const isAtLost = lostStage && deal.stage === lostStage.id;

    const strip = document.createElement('div');
    strip.id = 'fp-chat-strip';
    strip.innerHTML = `
      <button class="fp-strip-badge fp-strip-stage-picker" id="fp-strip-stage-picker"
              style="background:${c.bg};color:${c.text}" title="Mover no pipeline">
        <span class="fp-strip-dot" style="background:${c.dot}"></span>
        ${esc(stage?.name || 'Sem fase')}
        <span class="fp-strip-caret">▾</span>
      </button>

      <button class="fp-strip-stage-btn" id="fp-strip-info" title="Ver dados do cliente">
        ℹ Informações
      </button>
      <button class="fp-strip-stage-btn" id="fp-strip-edit" title="Editar lead">
        ✎ Editar
      </button>

      ${wonStage ? `
        <button class="fp-strip-stage-btn fp-btn-won ${isAtWon ? 'fp-active-won' : ''}"
                id="fp-strip-won" data-sid="${wonStage.id}" title="Marcar como ${esc(wonStage.name)}">
          ✓ Ganho
        </button>` : ''}

      ${lostStage ? `
        <button class="fp-strip-stage-btn fp-btn-lost ${isAtLost ? 'fp-active-lost' : ''}"
                id="fp-strip-lost" data-sid="${lostStage.id}" title="Marcar como ${esc(lostStage.name)}">
          ✕ Perda
        </button>` : ''}

      <button class="fp-strip-stage-btn" id="fp-strip-funil"
              style="background:#111b21;color:#fff;border-color:#111b21">
        ⬡ Voltar ao Funil
      </button>
    `;

    // Ganho / Perda — mover fase
    const moveTo = async (sid, label) => {
      if (!sid || sid === deal.stage) return;
      const targetStage = stgs.find(s => s.id === sid);
      if (isWonStage(targetStage)) {
        openWonConversionModal(deal);
        return;
      }
      if (isLostStage(targetStage)) {
        openLostDealModal(deal, sid);
        return;
      }
      try {
        await bg({ type: 'MOVE_STAGE', dealId: deal.id, stageId: sid });
        deal.stage = sid;
        chatDeal = deal;
        const gd = deals.find(d => d.id === deal.id);
        if (gd) gd.stage = sid;
        toast(`Marcado como ${label}`);
        injectChatStrip(deal, stgs);
      } catch (err) { toast(err.message, true); }
    };
    bindPress(strip.querySelector('#fp-strip-stage-picker'), (e) => {
      openStageMenu(e.currentTarget, stgs, deal.stage, moveTo, 'Mover para etapa');
    });
    bindPress(strip.querySelector('#fp-strip-won'), () => moveTo(wonStage.id, wonStage.name));
    bindPress(strip.querySelector('#fp-strip-lost'), () => moveTo(lostStage.id, lostStage.name));

    bindPress(strip.querySelector('#fp-strip-info'), () => openClientInfoModal(deal, stage));
    bindPress(strip.querySelector('#fp-strip-edit'), () => openDealEditModal(deal));
    bindPress(strip.querySelector('#fp-strip-funil'), showKanban);

    mountChatStrip(strip);
  }

  // ===== MODAL DE INFORMAÇÕES DO CLIENTE =====
  function openClientInfoModal(deal, stage) {
    // Remove modal anterior, se houver
    document.getElementById('fp-info-modal')?.remove();

    const name = deal.contact_name || deal.title || 'Sem nome';
    const phone = deal.contact_phone || '—';
    const phoneFmt = phone !== '—' ? `+${digits(phone).replace(/(\d{2})(\d{2})(\d{5})(\d{4})/, '$1 ($2) $3-$4')}` : '—';
    const value = deal.value ? brl.format(deal.value) : '—';
    const created = deal.created_at ? new Date(deal.created_at).toLocaleDateString('pt-BR') : '—';
    const updated = deal.updated_at ? new Date(deal.updated_at).toLocaleDateString('pt-BR') : '—';
    const notes = (deal.notes || '').trim();
    const stageColor = C(stage?.position ?? 0);
    const initialsTxt = initials(name);

    const m = document.createElement('div');
    m.id = 'fp-info-modal';
    m.className = 'fp-info-overlay';
    m.innerHTML = `
      <div class="fp-info-box">
        <div class="fp-info-header">
          <div class="fp-info-avatar" style="background:${stageColor.dot}">${esc(initialsTxt)}</div>
          <div class="fp-info-headinfo">
            <div class="fp-info-name">${esc(name)}</div>
            <div class="fp-info-stage" style="background:${stageColor.bg};color:${stageColor.text}">
              ${esc(stage?.name || 'Sem fase')}
            </div>
          </div>
          <button class="fp-info-close" id="fp-info-close">✕</button>
        </div>
        <div class="fp-info-body">
          <div class="fp-info-row"><span class="fp-info-label">Telefone</span><span>${esc(phoneFmt)}</span></div>
          <div class="fp-info-row"><span class="fp-info-label">Valor</span><span>${esc(value)}</span></div>
          ${deal.lost_reason ? `<div class="fp-info-row"><span class="fp-info-label">Motivo da perda</span><span>${esc(deal.lost_reason)}</span></div>` : ''}
          <div class="fp-info-row"><span class="fp-info-label">Cadastrado em</span><span>${esc(created)}</span></div>
          <div class="fp-info-row"><span class="fp-info-label">Última atualização</span><span>${esc(updated)}</span></div>
          ${deal.lost_notes ? `
            <div class="fp-info-notes">
              <div class="fp-info-label" style="margin-bottom:6px">Observações da perda</div>
              <pre class="fp-info-notes-text">${esc(deal.lost_notes)}</pre>
            </div>` : ''}
          ${notes ? `
            <div class="fp-info-notes">
              <div class="fp-info-label" style="margin-bottom:6px">Anotações</div>
              <pre class="fp-info-notes-text">${esc(notes)}</pre>
            </div>` : ''}
        </div>
      </div>
    `;
    document.body.appendChild(m);

    m.addEventListener('click', (e) => { if (e.target === m) m.remove(); });
    m.querySelector('#fp-info-close')?.addEventListener('click', () => m.remove());
  }

  function removeChatStrip() {
    document.getElementById('fp-chat-strip')?.remove();
    removeStageMenu();
  }

  async function onChatOpened(phone) {
    const cleanPhone = digits(phone || '');
    const chatName = getWAChatName();
    const nextKey = cleanPhone ? `phone:${cleanPhone}` : (chatName ? `name:${chatName}` : '');
    if (!nextKey || nextKey === chatKey) return;

    chatKey = nextKey;
    chatPhone = cleanPhone || null;
    chatDeal = null;
    rememberContactPhoto(cleanPhone, getWAChatPhoto());

    if (!cleanPhone) {
      if (!chatStages.length && !stages.length) {
        try { chatStages = await ensureStagesForUi(); } catch { /* sem etapas, o modal ainda permite tentar */ }
      }
      injectAddStrip(null);
      return;
    }

    try {
      const result = await bg({ type: 'GET_DEAL_BY_PHONE', phone: cleanPhone });
      chatStages = result.stages || stages;
      chatDeal = result.deal;

      if (chatDeal) {
        injectChatStrip(chatDeal, chatStages);
      } else {
        // Contato sem deal — mostra strip mínima com botão "Adicionar"
        injectAddStrip(cleanPhone);
      }
    } catch {
      // silencia — não atrapalha o chat
    }
  }

  async function createDealFromChat(phone, stageId, stageName) {
    const contact = await waitForChatContact(phone);
    const cleanPhone = contact.phone;
    const name = contact.name;
    rememberContactPhoto(cleanPhone, getWAChatPhoto());

    if (!cleanPhone) {
      openModal('', name, stageId, true);
      toast('Preencha o telefone para adicionar ao pipeline', true);
      return;
    }

    try {
      if (!currentMemberId) await loadTeamAndMe();
      await bg({
        type: 'CREATE_DEAL',
        data: { name, phone: cleanPhone, value: 0, source: 'whatsapp-extension', stage: stageId, assigned_to: currentMemberId || null },
      });
      toast(stageName ? `Adicionado em "${stageName}"` : 'Adicionado ao pipeline');
      await loadKanban();
      chatKey = null;
      chatPhone = null;
      onChatOpened(cleanPhone);
    } catch (err) {
      toast(err.message, true);
    }
  }

  function injectAddStrip(phone) {
    removeChatStrip();
    const strip = document.createElement('div');
    strip.id = 'fp-chat-strip';
    strip.innerHTML = `
      <span class="fp-strip-label">Não está no pipeline</span>
      <button class="fp-strip-stage-btn fp-strip-primary-add" id="fp-strip-add">
        + Adicionar ao Pipeline <span class="fp-strip-caret">▾</span>
      </button>
      <button class="fp-strip-stage-btn" id="fp-strip-add-details" title="Informar nome, telefone e valor">Criar com dados</button>
      <button class="fp-strip-stage-btn" id="fp-strip-funil2" style="background:#111b21;color:#fff;border-color:#111b21">⬡ Voltar ao Funil</button>
    `;

    bindPress(strip.querySelector('#fp-strip-add'), async (e) => {
      try {
        const list = await ensureStagesForUi();
        openStageMenu(e.currentTarget, list, null, (sid, label) => createDealFromChat(phone, sid, label), 'Adicionar em etapa');
      } catch (err) {
        toast(err.message, true);
      }
    });
    bindPress(strip.querySelector('#fp-strip-add-details'), async () => {
      const contact = await waitForChatContact(phone);
      openModal(contact.phone, contact.name, firstOpenStage(chatStages.length ? chatStages : stages)?.id, true);
    });
    bindPress(strip.querySelector('#fp-strip-funil2'), showKanban);

    mountChatStrip(strip);
  }

  function openDealEditModal(deal) {
    document.getElementById('fp-deal-edit-modal')?.remove();

    const ordered = orderedStages(stages);
    const shootType = getDealShootType(deal);
    const notes = stripDealMetaFromNotes(deal.notes || '');

    const modal = document.createElement('div');
    modal.id = 'fp-deal-edit-modal';
    modal.className = 'fp-info-overlay';
    modal.innerHTML = `
      <div class="fp-deal-edit-box">
        <div class="fp-deal-edit-header">
          <div>
            <div class="fp-deal-edit-title">Editar Lead</div>
            <div class="fp-deal-edit-sub">${esc(deal.contact_name || deal.title || 'Sem nome')}</div>
          </div>
          <button class="fp-info-close" id="fp-deal-edit-close">✕</button>
        </div>
        <div class="fp-deal-edit-body">
          <div class="fp-mf"><label class="fp-ml">Nome</label><input class="fp-mi" id="fp-ed-name" value="${esc(deal.contact_name || deal.title || '')}" /></div>
          <div class="fp-mf"><label class="fp-ml">Telefone</label><input class="fp-mi" id="fp-ed-phone" value="${esc(digits(deal.contact_phone || ''))}" /></div>
          <div class="fp-mf"><label class="fp-ml">Tipo de ensaio</label><input class="fp-mi" id="fp-ed-type" value="${esc(shootType)}" placeholder="Ex: Gestante, newborn, família..." /></div>
          <div class="fp-mf"><label class="fp-ml">Valor (R$)</label><input class="fp-mi" id="fp-ed-value" type="number" value="${Number(deal.value) || 0}" /></div>
          <div class="fp-mf"><label class="fp-ml">E-mail</label><input class="fp-mi" id="fp-ed-email" value="${esc(deal.contact_email || '')}" /></div>
          <div class="fp-mf"><label class="fp-ml">Origem</label><input class="fp-mi" id="fp-ed-source" value="${esc(deal.lead_source || '')}" placeholder="WhatsApp, Instagram..." /></div>
          <div class="fp-mf"><label class="fp-ml">Etapa do funil</label><select class="fp-mi" id="fp-ed-stage">
            ${ordered.map(s => `<option value="${esc(s.id)}" ${s.id === deal.stage ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}
          </select></div>
          <div class="fp-mf"><label class="fp-ml">Vendedor responsável</label><select class="fp-mi" id="fp-ed-assign"></select></div>
          <div class="fp-mf"><label class="fp-ml">Observações</label><textarea class="fp-mi fp-edit-notes" id="fp-ed-notes" placeholder="Detalhes do atendimento, pacote, data provável...">${esc(notes)}</textarea></div>
        </div>
        <div class="fp-mrow fp-deal-edit-actions">
          <button class="fp-btn-w" id="fp-deal-edit-cancel">Cancelar</button>
          <button class="fp-btn-g" id="fp-deal-edit-save">Salvar</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    // Popula o select de vendedor (current value e lista) + re-popula após fetch
    populateAssigneeSelect('fp-ed-assign', deal.assigned_to);
    loadTeamAndMe().then(() => populateAssigneeSelect('fp-ed-assign', deal.assigned_to));

    const close = () => modal.remove();
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
    modal.querySelector('#fp-deal-edit-close')?.addEventListener('click', close);
    modal.querySelector('#fp-deal-edit-cancel')?.addEventListener('click', close);
    modal.querySelector('#fp-deal-edit-save')?.addEventListener('click', () => saveDealEdit(deal, modal));
  }

  async function saveDealEdit(deal, modal) {
    const name = modal.querySelector('#fp-ed-name')?.value.trim() || deal.contact_phone || deal.title || 'Lead';
    const phone = digits(modal.querySelector('#fp-ed-phone')?.value || '');
    const shootType = modal.querySelector('#fp-ed-type')?.value.trim() || '';
    const value = Number(modal.querySelector('#fp-ed-value')?.value) || 0;
    const email = modal.querySelector('#fp-ed-email')?.value.trim() || null;
    const source = modal.querySelector('#fp-ed-source')?.value.trim() || null;
    const stage = modal.querySelector('#fp-ed-stage')?.value || deal.stage;
    const assigned_to = modal.querySelector('#fp-ed-assign')?.value || null;
    const notes = modal.querySelector('#fp-ed-notes')?.value.trim() || '';

    if (!phone) return toast('Telefone é obrigatório', true);

    const btn = modal.querySelector('#fp-deal-edit-save');
    if (btn) {
      btn.textContent = 'Salvando...';
      btn.disabled = true;
    }
    const previousPhone = deal.contact_phone;

    const updates = {
      title: name,
      contact_name: name,
      contact_phone: phone,
      contact_email: email,
      lead_source: source,
      value,
      stage,
      assigned_to,
      notes: buildDealNotes(shootType, notes),
    };

    try {
      await bg({ type: 'UPDATE_DEAL', dealId: deal.id, data: updates });
      Object.assign(deal, updates, { updated_at: new Date().toISOString() });
      const globalDeal = deals.find(d => Number(d.id) === Number(deal.id));
      if (globalDeal && globalDeal !== deal) Object.assign(globalDeal, updates, { updated_at: deal.updated_at });
      if (chatDeal && Number(chatDeal.id) === Number(deal.id)) Object.assign(chatDeal, updates);
      rememberContactPhoto(phone, getCachedContactPhoto(previousPhone) || getWAChatPhoto());
      modal.remove();
      renderBoard();
      if (chatDeal && Number(chatDeal.id) === Number(deal.id)) {
        injectChatStrip(chatDeal, chatStages.length ? chatStages : stages);
      }
      toast('Lead atualizado!');
    } catch (err) {
      toast(err.message, true);
      if (btn) {
        btn.textContent = 'Salvar';
        btn.disabled = false;
      }
    }
  }

  const LOST_REASONS = ['Preço', 'Concorrência', 'Sem resposta', 'Desistiu', 'Data indisponível', 'Outro'];

  function openLostDealModal(deal, stageId) {
    document.getElementById('fp-lost-modal')?.remove();

    const targetStage = stages.find(s => s.id === stageId) || stages.find(isLostStage);
    const currentReason = deal.lost_reason || LOST_REASONS[0];

    const modal = document.createElement('div');
    modal.id = 'fp-lost-modal';
    modal.className = 'fp-info-overlay';
    modal.innerHTML = `
      <div class="fp-lost-box">
        <div class="fp-lost-header">
          <div>
            <div class="fp-lost-kicker">Perdido</div>
            <div class="fp-lost-title">Registrar motivo da perda</div>
            <div class="fp-lost-sub">${esc(deal.contact_name || deal.title || 'Lead')} será movido para "${esc(targetStage?.name || 'Perdido')}".</div>
          </div>
          <button class="fp-info-close" id="fp-lost-close">✕</button>
        </div>
        <div class="fp-lost-body">
          <div class="fp-mf">
            <label class="fp-ml">Motivo *</label>
            <select class="fp-mi" id="fp-lost-reason">
              ${LOST_REASONS.map(reason => `<option ${reason === currentReason ? 'selected' : ''}>${esc(reason)}</option>`).join('')}
            </select>
          </div>
          <div class="fp-mf">
            <label class="fp-ml">Observações</label>
            <textarea class="fp-mi fp-edit-notes" id="fp-lost-notes" placeholder="Ex: achou caro, fechou com concorrente, não respondeu...">${esc(deal.lost_notes || '')}</textarea>
          </div>
        </div>
        <div class="fp-mrow fp-lost-actions">
          <button class="fp-btn-w" id="fp-lost-cancel">Cancelar</button>
          <button class="fp-btn-lost-save" id="fp-lost-save">Salvar perda</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const close = () => modal.remove();
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
    modal.querySelector('#fp-lost-close')?.addEventListener('click', close);
    modal.querySelector('#fp-lost-cancel')?.addEventListener('click', close);
    modal.querySelector('#fp-lost-save')?.addEventListener('click', () => saveLostDeal(deal, modal, targetStage?.id || stageId));
  }

  async function saveLostDeal(deal, modal, stageId) {
    const reason = modal.querySelector('#fp-lost-reason')?.value.trim();
    const notes = modal.querySelector('#fp-lost-notes')?.value.trim() || '';
    const targetStage = stages.find(s => s.id === stageId) || stages.find(isLostStage);
    const targetId = targetStage?.id || stageId || 'lost';

    if (!reason) {
      toast('Informe o motivo da perda', true);
      return;
    }

    const btn = modal.querySelector('#fp-lost-save');
    if (btn) {
      btn.textContent = 'Salvando...';
      btn.disabled = true;
    }

    try {
      await bg({
        type: 'LOST_DEAL',
        dealId: deal.id,
        data: { reason, notes, stageId: targetId },
      });

      const updates = {
        stage: targetId,
        lost_reason: reason,
        lost_notes: notes,
        temperature: 'cold',
        temperature_locked: true,
        updated_at: new Date().toISOString(),
      };
      Object.assign(deal, updates);
      const globalDeal = deals.find(d => Number(d.id) === Number(deal.id));
      if (globalDeal && globalDeal !== deal) Object.assign(globalDeal, updates);
      if (chatDeal && Number(chatDeal.id) === Number(deal.id)) Object.assign(chatDeal, updates);

      modal.remove();
      await loadKanban();
      if (chatDeal && Number(chatDeal.id) === Number(deal.id)) {
        injectChatStrip(chatDeal, chatStages.length ? chatStages : stages);
      }
      toast(`Marcado como perda: ${reason}`);
    } catch (err) {
      toast(err.message, true);
      if (btn) {
        btn.textContent = 'Salvar perda';
        btn.disabled = false;
      }
    }
  }

  function todayISO() {
    return new Date().toISOString().slice(0, 10);
  }

  function autoPaymentStatus(total, sinal) {
    const amount = Number(total) || 0;
    const paid = Number(sinal) || 0;
    if (paid <= 0) return 'pending';
    if (paid >= amount) return 'paid';
    return 'partial';
  }

  async function loadClientsForConversion(modal) {
    const select = modal.querySelector('#fp-win-client-select');
    if (!select) return;

    try {
      const clients = await bg({ type: 'GET_CLIENTS' });
      select.innerHTML = '<option value="">Selecione um cliente</option>' + (clients || [])
        .map(c => `<option value="${esc(c.id)}">${esc(c.name || 'Cliente')} ${c.phone ? `- ${esc(c.phone)}` : ''}</option>`)
        .join('');
    } catch {
      select.innerHTML = '<option value="">Não foi possível carregar clientes</option>';
    }
  }

  function normalizeCadastroText(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function cleanCadastroValue(value) {
    return String(value || '')
      .replace(/[\u200e\u200f]/g, '')
      .replace(/^[\s:：?\-–—.,;|/\\]+/g, '')
      .replace(/^[^A-Za-z0-9À-ÿ@]+/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  const CADASTRO_PATTERNS = [
    { field: 'baby', pattern: /^\s*(?:nome\s*\/?\s*idade\s+do\s+beb[êe]\(?s?\)?|nome\s+(?:e\s+)?idade\s+do\s+beb[êe]\(?s?\)?|nome\s+do\s+beb[êe]\(?s?\)?|beb[êe]\(?s?\)?)\s*[^A-Za-z0-9À-ÿ]*(.*)$/i },
    { field: 'birthDate', pattern: /^\s*(?:data\s+de\s+nascimento|data\s+nascimento|nascimento|dt\.?\s*nascimento)\s*[^A-Za-z0-9À-ÿ]*(.*)$/i },
    { field: 'address', pattern: /^\s*(?:endere[çc]o\s+completo|endere[çc]o|moradia)\s*[^A-Za-z0-9À-ÿ]*(.*)$/i },
    { field: 'packageChoice', pattern: /^\s*(?:pacote\s+escolhido|pacote|combo\s+escolhido|combo|produto\s+escolhido)\s*[^A-Za-z0-9À-ÿ]*(.*)$/i },
    { field: 'found', pattern: /^\s*(?:como\s+(?:nos\s+)?(?:conheceu|achou)|por\s+onde\s+(?:nos\s+)?conheceu|origem)\s*[^A-Za-z0-9À-ÿ]*(.*)$/i },
    { field: 'instagram', pattern: /^\s*(?:rede\s+social|instagram|insta|social)\s*[^A-Za-z0-9À-ÿ@]*(.*)$/i },
    { field: 'document', pattern: /^\s*(?:cpf\s*\/?\s*cnpj|cpf|cnpj|documento)\s*[^A-Za-z0-9À-ÿ]*(.*)$/i },
    { field: 'phone', pattern: /^\s*(?:telefone|celular|whats\s*app|whatsapp|fone)\s*[^A-Za-z0-9À-ÿ]*(.*)$/i },
    { field: 'email', pattern: /^\s*(?:e\s*-?\s*mail|email)\s*[^A-Za-z0-9À-ÿ@]*(.*)$/i },
    { field: 'name', pattern: /^\s*(?:nome\s+completo|nome|cliente|respons[aá]vel)\s*[^A-Za-z0-9À-ÿ]*(.*)$/i },
  ];

  function matchCadastroLine(line) {
    const text = String(line || '').trim();
    if (!text) return null;
    for (const cfg of CADASTRO_PATTERNS) {
      const match = text.match(cfg.pattern);
      if (match) return { field: cfg.field, value: cleanCadastroValue(match[1] || '') };
    }
    return null;
  }

  function isCadastroLabelLine(line) {
    const parsed = matchCadastroLine(line);
    if (!parsed) return false;
    const bareAnswer = ['instagram', 'facebook', 'google', 'indicacao', 'site', 'whatsapp', 'outro'];
    if (!parsed.value && bareAnswer.includes(normalizeCadastroText(line))) return false;
    return true;
  }

  function getVisibleChatTextBlocks() {
    const main = document.querySelector('#main');
    if (!main) return [];

    const selectors = [
      '[data-pre-plain-text]',
      '[data-testid="msg-container"]',
      '.selectable-text.copyable-text',
      '.copyable-text',
      'div[role="row"]',
    ].join(',');

    const seen = new Set();
    const blocks = [];
    for (const el of main.querySelectorAll(selectors)) {
      if (el.closest('#fp-kanban, #fp-modal, #fp-won-modal, #fp-chat-strip, #fp-stage-menu')) continue;
      const text = String(el.innerText || el.textContent || '')
        .replace(/[\u200e\u200f]/g, '')
        .trim();
      if (!text || text.length < 3) continue;
      if (/^\d{1,2}:\d{2}\s*$/.test(text)) continue;
      if (seen.has(text)) continue;
      seen.add(text);
      blocks.push(text);
    }

    return blocks;
  }

  function parseBRDateToISO(value) {
    const text = String(value || '').trim();
    const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
    if (iso) return iso[0];

    const br = text.match(/\b(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})\b/);
    if (!br) return '';

    const day = br[1].padStart(2, '0');
    const month = br[2].padStart(2, '0');
    let year = br[3];
    if (year.length === 2) year = `${Number(year) > 30 ? '19' : '20'}${year}`;
    return `${year}-${month}-${day}`;
  }

  function cleanInstagram(value) {
    const text = String(value || '').trim();
    const match = text.match(/(?:instagram\.com\/)?@?([a-z0-9._]+)/i);
    return match ? match[1].replace(/[.,;]+$/g, '') : text.replace(/^@/, '');
  }

  function inferCityFromAddress(address) {
    const parts = String(address || '')
      .split(',')
      .map(part => part.trim())
      .filter(Boolean);
    const last = parts[parts.length - 1] || '';
    if (!last || /\d/.test(last) || last.length < 3) return '';
    return last.replace(/\b\w/g, char => char.toUpperCase());
  }

  function appendUniqueNoteLines(current, lines) {
    const existing = String(current || '').trim();
    const chunks = existing ? [existing] : [];
    const normalizedExisting = normalizeCadastroText(existing);
    for (const line of lines.filter(Boolean)) {
      if (!normalizedExisting.includes(normalizeCadastroText(line))) chunks.push(line);
    }
    return chunks.join('\n').trim();
  }

  function extractCadastroFromVisibleConversation() {
    const text = getVisibleChatTextBlocks().join('\n');
    if (!text.trim()) return {};

    const data = {};
    const lines = text
      .split(/\n+/)
      .map(line => line.trim())
      .filter(Boolean);

    for (let i = 0; i < lines.length; i += 1) {
      const parsed = matchCadastroLine(lines[i]);
      if (!parsed) continue;

      let value = parsed.value;
      if (!value) {
        const next = lines.slice(i + 1).find(line => line && !isCadastroLabelLine(line));
        value = cleanCadastroValue(next || '');
      }
      if (value) data[parsed.field] = value;
    }

    if (!data.email) data.email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || '';
    if (!data.document) {
      const cpf = text.match(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/);
      if (cpf) data.document = cpf[0];
    }
    if (!data.phone) {
      const phone = text.match(/\b(?:55)?\d{10,11}\b/);
      if (phone) data.phone = phone[0];
    }

    data.birthDate = parseBRDateToISO(data.birthDate);
    data.document = data.document ? digits(data.document) : '';
    data.phone = data.phone ? digits(data.phone) : '';
    data.instagram = data.instagram ? cleanInstagram(data.instagram) : '';

    return data;
  }

  function setModalValue(modal, selector, value) {
    if (!value) return false;
    const el = modal.querySelector(selector);
    if (!el) return false;
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }

  function setSelectByText(select, value) {
    if (!select || !value) return false;
    const wanted = normalizeCadastroText(value);
    const option = Array.from(select.options).find(opt => {
      const label = normalizeCadastroText(opt.value || opt.textContent);
      return label && (wanted.includes(label) || label.includes(wanted));
    });
    if (option) {
      select.value = option.value;
      return true;
    }

    const other = Array.from(select.options).find(opt => normalizeCadastroText(opt.value || opt.textContent) === 'outro');
    if (other) {
      select.value = other.value;
      return true;
    }
    return false;
  }

  function applyConversationCadastroToWonModal(modal) {
    const data = extractCadastroFromVisibleConversation();
    modal.__fpParsedConversationData = data;

    let filled = 0;
    if (setModalValue(modal, '#fp-win-client-name', data.name)) filled += 1;
    const jobName = modal.querySelector('#fp-win-job-name');
    if (data.name && jobName && (!jobName.value.trim() || /^\+?\d[\d\s\-()+]{5,}$/.test(jobName.value.trim()))) {
      setModalValue(modal, '#fp-win-job-name', data.name);
    }
    if (setModalValue(modal, '#fp-win-client-phone', data.phone)) filled += 1;
    if (setModalValue(modal, '#fp-win-client-email', data.email)) filled += 1;
    if (setModalValue(modal, '#fp-win-client-doc', data.document)) filled += 1;
    if (setModalValue(modal, '#fp-win-client-birth', data.birthDate)) filled += 1;
    if (setModalValue(modal, '#fp-win-client-instagram', data.instagram)) filled += 1;
    if (setModalValue(modal, '#fp-win-client-address', data.address)) filled += 1;

    const inferredCity = inferCityFromAddress(data.address);
    if (inferredCity && setModalValue(modal, '#fp-win-client-city', inferredCity)) filled += 1;
    if (setSelectByText(modal.querySelector('#fp-win-client-found'), data.found)) filled += 1;

    const jobNoteLines = [
      data.baby ? `Nome/idade do bebê: ${data.baby}` : '',
      data.packageChoice ? `Pacote informado na conversa: ${data.packageChoice}` : '',
    ];
    const jobNotes = modal.querySelector('#fp-win-job-notes');
    if (jobNotes && jobNoteLines.some(Boolean)) {
      jobNotes.value = appendUniqueNoteLines(jobNotes.value, jobNoteLines);
      filled += 1;
    }

    return filled;
  }

  function catalogTypeLabel(type) {
    if (type === 'combo') return 'Combo';
    if (type === 'servico') return 'Serviço';
    return 'Produto';
  }

  function normalizeCatalogForConversion(catalog) {
    const groups = [
      { type: 'combo', list: catalog?.combos || [], valueKey: 'preco_final' },
      { type: 'servico', list: catalog?.servicos || [], valueKey: 'preco_base' },
      { type: 'produto', list: catalog?.produtos || [], valueKey: 'preco_venda' },
    ];
    return groups.flatMap(group => (group.list || [])
      .filter(item => item && item.ativo !== false)
      .map(item => ({
        type: group.type,
        id: String(item.id || ''),
        name: item.nome || item.name || 'Item sem nome',
        value: Number(item[group.valueKey]) || 0,
      }))
      .filter(item => item.id && item.name)
    );
  }

  function selectedCatalogItems(modal) {
    return Array.isArray(modal.__fpSelectedCatalogItems) ? modal.__fpSelectedCatalogItems : [];
  }

  function selectedCatalogTotal(modal) {
    return selectedCatalogItems(modal).reduce((sum, item) => {
      return sum + ((Number(item.value) || 0) * (Number(item.quantity) || 1));
    }, 0);
  }

  function updateWonSummary(modal) {
    const amount = selectedCatalogTotal(modal);
    const amountInput = modal.querySelector('#fp-win-job-amount');
    if (amountInput) amountInput.value = amount ? amount.toFixed(2) : '0';

    const sinal = Number(modal.querySelector('#fp-win-sinal')?.value) || 0;
    const rest = Math.max(0, amount - sinal);
    const totalLabel = modal.querySelector('#fp-win-total-label');
    const sinalLabel = modal.querySelector('#fp-win-sinal-label');
    const restLabel = modal.querySelector('#fp-win-rest-label');
    if (totalLabel) totalLabel.textContent = brl.format(amount);
    if (sinalLabel) sinalLabel.textContent = brl.format(sinal);
    if (restLabel) restLabel.textContent = brl.format(rest);
  }

  function renderSelectedCatalogItems(modal) {
    const listEl = modal.querySelector('#fp-win-catalog-list');
    const items = selectedCatalogItems(modal);
    if (!listEl) return;

    if (!items.length) {
      listEl.innerHTML = '<div class="fp-catalog-empty">Nenhum produto, serviço ou combo selecionado.</div>';
    } else {
      listEl.innerHTML = items.map((item, index) => {
        const qty = Number(item.quantity) || 1;
        const total = (Number(item.value) || 0) * qty;
        return `
          <div class="fp-catalog-item">
            <div class="fp-catalog-item-main">
              <span class="fp-catalog-chip">${catalogTypeLabel(item.type)}</span>
              <strong>${esc(item.name)}</strong>
              <small>${qty}x ${brl.format(Number(item.value) || 0)} = ${brl.format(total)}</small>
            </div>
            ${item.existing
              ? '<span class="fp-catalog-linked">Vinculado</span>'
              : `<button type="button" class="fp-catalog-remove" data-remove-catalog-index="${index}">Remover</button>`}
          </div>
        `;
      }).join('');
      listEl.querySelectorAll('[data-remove-catalog-index]').forEach(btn => {
        btn.addEventListener('click', () => {
          const index = Number(btn.dataset.removeCatalogIndex);
          modal.__fpSelectedCatalogItems = selectedCatalogItems(modal).filter((_, i) => i !== index);
          renderSelectedCatalogItems(modal);
        });
      });
    }

    updateWonSummary(modal);
  }

  async function loadCatalogForConversion(modal) {
    const select = modal.querySelector('#fp-win-catalog-select');
    if (!select) return;

    select.disabled = true;
    select.innerHTML = '<option value="">Carregando catálogo...</option>';
    try {
      const catalog = await bg({ type: 'GET_CATALOG' });
      const items = normalizeCatalogForConversion(catalog);
      modal.__fpCatalogItems = items;
      if (!items.length) {
        select.innerHTML = '<option value="">Nenhum item ativo no catálogo</option>';
        return;
      }
      select.disabled = false;
      select.innerHTML = '<option value="">Selecione um item</option>' + items
        .map((item, index) => `<option value="${index}">${esc(catalogTypeLabel(item.type))} - ${esc(item.name)} (${esc(brl.format(item.value))})</option>`)
        .join('');
      autoAddCatalogFromConversation(modal);
    } catch (err) {
      select.innerHTML = '<option value="">Erro ao carregar catálogo</option>';
      toast(err.message || 'Não foi possível carregar o catálogo', true);
    }
  }

  function seedWonCatalogItems(modal, deal) {
    const items = Array.isArray(deal.items) ? deal.items : [];
    modal.__fpSelectedCatalogItems = items
      .map(item => ({
        type: item.catalog_type,
        id: String(item.catalog_id || ''),
        name: item.catalog_name || 'Item do catálogo',
        value: Number(item.catalog_value) || 0,
        quantity: Number(item.quantidade) || 1,
        existing: true,
      }))
      .filter(item => item.type && item.id && item.name);
    renderSelectedCatalogItems(modal);
  }

  function addCatalogItemToWonModal(modal) {
    const select = modal.querySelector('#fp-win-catalog-select');
    const qtyInput = modal.querySelector('#fp-win-catalog-qty');
    const catalog = Array.isArray(modal.__fpCatalogItems) ? modal.__fpCatalogItems : [];
    const selected = catalog[Number(select?.value)];
    const quantity = Math.max(1, Number(qtyInput?.value) || 1);
    if (!selected) {
      toast('Selecione um produto, serviço ou combo', true);
      return;
    }

    modal.__fpSelectedCatalogItems = [
      ...selectedCatalogItems(modal),
      { ...selected, quantity, existing: false },
    ];
    if (select) select.value = '';
    if (qtyInput) qtyInput.value = '1';
    renderSelectedCatalogItems(modal);
  }

  function packageMatchScore(item, packageChoice) {
    const choice = normalizeCadastroText(packageChoice);
    const name = normalizeCadastroText(item.name);
    const choiceDigits = digits(packageChoice);
    const numericOnly = !!choiceDigits && choice === choiceDigits;
    let score = 0;

    if (!choice || !name) return 0;
    if (name === choice) score += 80;
    if (!numericOnly && name.includes(choice)) score += 40;
    if (!numericOnly && choice.includes(name)) score += 20;
    if (choiceDigits && new RegExp(`(^|\\D)0*${choiceDigits}(\\D|$)`).test(String(item.name))) score += 45;
    if (/\b(pacote|combo)\b/.test(name)) score += 8;
    if (item.type === 'combo') score += 6;

    return score;
  }

  function autoAddCatalogFromConversation(modal) {
    const data = modal.__fpParsedConversationData || {};
    const packageChoice = data.packageChoice;
    const items = Array.isArray(modal.__fpCatalogItems) ? modal.__fpCatalogItems : [];
    if (!packageChoice || !items.length || selectedCatalogItems(modal).length) return;

    const ranked = items
      .map(item => ({ item, score: packageMatchScore(item, packageChoice) }))
      .filter(entry => entry.score >= 40)
      .sort((a, b) => b.score - a.score);
    const match = ranked[0]?.item;
    if (!match) return;

    modal.__fpSelectedCatalogItems = [
      ...selectedCatalogItems(modal),
      { ...match, quantity: 1, existing: false, autoMatched: true },
    ];
    renderSelectedCatalogItems(modal);
  }

  function openWonConversionModal(deal) {
    document.getElementById('fp-won-modal')?.remove();

    const shootType = getDealShootType(deal) || 'Gestante';
    const notes = stripDealMetaFromNotes(deal.notes || '');

    const modal = document.createElement('div');
    modal.id = 'fp-won-modal';
    modal.className = 'fp-info-overlay';
    modal.innerHTML = `
      <div class="fp-won-box">
        <div class="fp-won-header">
          <div>
            <div class="fp-won-kicker">Fechado Ganho</div>
            <div class="fp-won-title">Converter "${esc(deal.title || deal.contact_name || 'Lead')}" em venda</div>
            <div class="fp-won-sub">Preencha os dados do cliente e do ensaio antes de marcar como ganho.</div>
          </div>
          <button class="fp-info-close" id="fp-won-close">✕</button>
        </div>

        <div class="fp-won-body">
          <div class="fp-won-mode">
            <label><input type="radio" name="fp-win-mode" value="new" checked /> Novo cliente</label>
            <label><input type="radio" name="fp-win-mode" value="existing" /> Cliente existente</label>
          </div>

          <div class="fp-won-existing fp-hidden">
            <div class="fp-mf"><label class="fp-ml">Cliente existente</label><select class="fp-mi" id="fp-win-client-select"><option>Carregando...</option></select></div>
          </div>

          <div class="fp-won-section fp-won-client-section">
            <div class="fp-won-section-title">Dados do cliente</div>
            <div class="fp-won-grid">
              <div class="fp-mf"><label class="fp-ml">Nome *</label><input class="fp-mi" id="fp-win-client-name" value="${esc(deal.contact_name || deal.title || '')}" /></div>
              <div class="fp-mf"><label class="fp-ml">Telefone *</label><input class="fp-mi" id="fp-win-client-phone" value="${esc(digits(deal.contact_phone || ''))}" /></div>
              <div class="fp-mf"><label class="fp-ml">E-mail</label><input class="fp-mi" id="fp-win-client-email" value="${esc(deal.contact_email || '')}" /></div>
              <div class="fp-mf"><label class="fp-ml">CPF/CNPJ</label><input class="fp-mi" id="fp-win-client-doc" /></div>
              <div class="fp-mf"><label class="fp-ml">Nascimento</label><input class="fp-mi" id="fp-win-client-birth" type="date" /></div>
              <div class="fp-mf"><label class="fp-ml">Instagram</label><input class="fp-mi" id="fp-win-client-instagram" value="${esc(deal.contact_instagram || '')}" /></div>
            </div>
            <div class="fp-mf"><label class="fp-ml">Endereço</label><input class="fp-mi" id="fp-win-client-address" /></div>
            <div class="fp-won-grid fp-won-grid-3">
              <div class="fp-mf"><label class="fp-ml">Cidade</label><input class="fp-mi" id="fp-win-client-city" /></div>
              <div class="fp-mf"><label class="fp-ml">Estado</label><input class="fp-mi" id="fp-win-client-state" maxlength="2" /></div>
              <div class="fp-mf"><label class="fp-ml">CEP</label><input class="fp-mi" id="fp-win-client-zip" /></div>
            </div>
            <div class="fp-won-grid">
              <div class="fp-mf"><label class="fp-ml">Como conheceu</label>
                <select class="fp-mi" id="fp-win-client-found">
                  <option value="">Selecione</option><option>Instagram</option><option>Facebook</option><option>Google</option><option>Indicação</option><option>Site</option><option>WhatsApp</option><option>Outro</option>
                </select>
              </div>
              <div class="fp-mf"><label class="fp-ml">Observações do cliente</label><input class="fp-mi" id="fp-win-client-notes" value="${esc(notes)}" /></div>
            </div>
          </div>

          <label class="fp-won-check"><input type="checkbox" id="fp-win-create-job" checked /> Criar trabalho/ensaio junto</label>

          <div class="fp-won-section fp-won-job-section">
            <div class="fp-won-section-title">Dados do trabalho</div>
            <div class="fp-won-grid fp-won-grid-4">
              <div class="fp-mf"><label class="fp-ml">Tipo *</label>
                <select class="fp-mi" id="fp-win-job-type">
                  ${['Gestante','Newborn','Família','Casamento','Ensaio Externo','Aniversário','Batizado','Corporativo','Outro'].map(type => `<option ${type === shootType ? 'selected' : ''}>${type}</option>`).join('')}
                </select>
              </div>
              <div class="fp-mf"><label class="fp-ml">Data *</label><input class="fp-mi" id="fp-win-job-date" type="date" value="${todayISO()}" /></div>
              <div class="fp-mf"><label class="fp-ml">Início</label><input class="fp-mi" id="fp-win-job-time" type="time" value="09:00" /></div>
              <div class="fp-mf"><label class="fp-ml">Término</label><input class="fp-mi" id="fp-win-job-end" type="time" /></div>
            </div>
            <div class="fp-mf"><label class="fp-ml">Nome do trabalho</label><input class="fp-mi" id="fp-win-job-name" value="${esc(deal.title || deal.contact_name || '')}" /></div>
            <div class="fp-mf"><label class="fp-ml">Local do ensaio</label><input class="fp-mi" id="fp-win-job-location" /></div>
            <div class="fp-won-catalog">
              <div class="fp-won-section-title">Produtos, serviços e combos</div>
              <div class="fp-catalog-row">
                <select class="fp-mi" id="fp-win-catalog-select"><option value="">Carregando catálogo...</option></select>
                <input class="fp-mi fp-catalog-qty" id="fp-win-catalog-qty" type="number" min="1" value="1" title="Quantidade" />
                <button class="fp-btn-g fp-catalog-add" type="button" id="fp-win-catalog-add">Adicionar</button>
              </div>
              <div class="fp-catalog-list" id="fp-win-catalog-list"></div>
            </div>
            <div class="fp-won-grid fp-won-grid-4">
              <div class="fp-mf"><label class="fp-ml">Valor total</label><input class="fp-mi" id="fp-win-job-amount" type="number" value="0" readonly /></div>
              <div class="fp-mf"><label class="fp-ml">Sinal pago</label><input class="fp-mi" id="fp-win-sinal" type="number" value="0" /></div>
              <div class="fp-mf"><label class="fp-ml">Forma de pagamento</label>
                <select class="fp-mi" id="fp-win-payment-method"><option>Pix</option><option>Cartão de Crédito</option><option>Cartão de Débito</option><option>Dinheiro</option><option>Boleto</option><option>Transferência</option></select>
              </div>
              <div class="fp-mf"><label class="fp-ml">Status</label>
                <select class="fp-mi" id="fp-win-job-status"><option value="scheduled">Agendado</option><option value="in_progress">Em Andamento</option><option value="editing">Em Edição</option><option value="completed">Concluído</option><option value="delivered">Entregue</option><option value="cancelled">Cancelado</option></select>
              </div>
            </div>
            <div class="fp-won-summary">
              <span>Total: <strong id="fp-win-total-label">${brl.format(0)}</strong></span>
              <span>Sinal: <strong id="fp-win-sinal-label">${brl.format(0)}</strong></span>
              <span>Restante: <strong id="fp-win-rest-label">${brl.format(0)}</strong></span>
            </div>
            <div class="fp-mf"><label class="fp-ml">Observações do trabalho</label><textarea class="fp-mi fp-edit-notes" id="fp-win-job-notes">${esc(notes)}</textarea></div>
          </div>
        </div>

        <div class="fp-mrow fp-won-actions">
          <button class="fp-btn-w" id="fp-won-cancel">Cancelar</button>
          <button class="fp-btn-g" id="fp-won-save">Converter e salvar</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    seedWonCatalogItems(modal, deal);
    applyConversationCadastroToWonModal(modal);
    loadClientsForConversion(modal);
    loadCatalogForConversion(modal);

    const close = () => modal.remove();
    const updateMode = () => {
      const mode = modal.querySelector('input[name="fp-win-mode"]:checked')?.value || 'new';
      modal.querySelector('.fp-won-existing')?.classList.toggle('fp-hidden', mode !== 'existing');
      modal.querySelector('.fp-won-client-section')?.classList.toggle('fp-hidden', mode !== 'new');
    };
    const updateJobVisibility = () => {
      const enabled = modal.querySelector('#fp-win-create-job')?.checked;
      modal.querySelector('.fp-won-job-section')?.classList.toggle('fp-hidden', !enabled);
    };

    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
    modal.querySelector('#fp-won-close')?.addEventListener('click', close);
    modal.querySelector('#fp-won-cancel')?.addEventListener('click', close);
    modal.querySelectorAll('input[name="fp-win-mode"]').forEach(input => input.addEventListener('change', updateMode));
    modal.querySelector('#fp-win-create-job')?.addEventListener('change', updateJobVisibility);
    modal.querySelector('#fp-win-catalog-add')?.addEventListener('click', () => addCatalogItemToWonModal(modal));
    modal.querySelector('#fp-win-sinal')?.addEventListener('input', () => updateWonSummary(modal));
    modal.querySelector('#fp-won-save')?.addEventListener('click', () => saveWonConversion(deal, modal));
    updateMode();
    updateJobVisibility();
    updateWonSummary(modal);
  }

  function val(modal, selector) {
    return modal.querySelector(selector)?.value?.trim() || '';
  }

  async function saveWonConversion(deal, modal) {
    const mode = modal.querySelector('input[name="fp-win-mode"]:checked')?.value || 'new';
    const createJob = !!modal.querySelector('#fp-win-create-job')?.checked;
    const createClient = mode === 'new';
    const existingClientId = mode === 'existing' ? Number(val(modal, '#fp-win-client-select')) || undefined : undefined;

    const client = createClient ? {
      name: val(modal, '#fp-win-client-name') || deal.title,
      phone: digits(val(modal, '#fp-win-client-phone') || deal.contact_phone || ''),
      email: val(modal, '#fp-win-client-email'),
      document: val(modal, '#fp-win-client-doc'),
      birth_date: val(modal, '#fp-win-client-birth'),
      address: val(modal, '#fp-win-client-address'),
      city: val(modal, '#fp-win-client-city'),
      state: val(modal, '#fp-win-client-state').toUpperCase(),
      zip_code: val(modal, '#fp-win-client-zip'),
      instagram: val(modal, '#fp-win-client-instagram'),
      how_found: val(modal, '#fp-win-client-found'),
      notes: val(modal, '#fp-win-client-notes'),
    } : undefined;

    if (createClient && (!client.name || !client.phone)) {
      toast('Nome e telefone do cliente são obrigatórios', true);
      return;
    }
    if (mode === 'existing' && !existingClientId) {
      toast('Selecione um cliente existente', true);
      return;
    }

    const catalogItems = selectedCatalogItems(modal);
    const amount = selectedCatalogTotal(modal);
    if (createJob && !catalogItems.length) {
      toast('Adicione pelo menos um produto, serviço ou combo', true);
      return;
    }

    const sinalAmount = Number(val(modal, '#fp-win-sinal')) || 0;
    const catalogNotes = catalogItems.length
      ? `Itens do catálogo:\n${catalogItems.map(item => `- ${catalogTypeLabel(item.type)}: ${item.name} (${Number(item.quantity) || 1}x ${brl.format(Number(item.value) || 0)})`).join('\n')}`
      : '';
    const jobNotes = [
      val(modal, '#fp-win-job-notes'),
      catalogNotes,
      val(modal, '#fp-win-job-location') ? `Local do ensaio: ${val(modal, '#fp-win-job-location')}` : '',
      sinalAmount > 0 ? `Sinal pago: ${brl.format(sinalAmount)}` : '',
    ].filter(Boolean).join('\n');

    const job = createJob ? {
      job_type: val(modal, '#fp-win-job-type') || 'Gestante',
      job_date: val(modal, '#fp-win-job-date') || todayISO(),
      job_time: val(modal, '#fp-win-job-time') || null,
      job_end_time: val(modal, '#fp-win-job-end') || null,
      job_name: val(modal, '#fp-win-job-name') || deal.title,
      amount,
      payment_method: val(modal, '#fp-win-payment-method') || 'Pix',
      payment_status: autoPaymentStatus(amount, sinalAmount),
      status: val(modal, '#fp-win-job-status') || 'scheduled',
      notes: jobNotes,
    } : undefined;

    const btn = modal.querySelector('#fp-won-save');
    if (btn) {
      btn.textContent = 'Convertendo...';
      btn.disabled = true;
    }

    try {
      const pendingItems = createJob ? catalogItems.filter(item => !item.existing) : [];
      if (pendingItems.length && btn) btn.textContent = 'Salvando itens...';
      for (const item of pendingItems) {
        const result = await bg({
          type: 'ADD_DEAL_ITEM',
          dealId: deal.id,
          data: {
            catalog_type: item.type,
            catalog_id: item.id,
            catalog_name: item.name,
            catalog_value: Number(item.value) || 0,
            quantidade: Number(item.quantity) || 1,
          },
        });
        item.existing = true;
        if (result?.item?.id) item.serverId = result.item.id;
      }

      if (btn) btn.textContent = 'Convertendo...';
      await bg({
        type: 'CONVERT_DEAL',
        dealId: deal.id,
        data: { existingClientId, createClient, createJob, client, job, sinalAmount: sinalAmount > 0 ? sinalAmount : undefined },
      });
      deal.stage = (stages.find(isWonStage) || stages.find(s => s.id === 'won'))?.id || deal.stage;
      deal.converted = true;
      deal.converted_at = new Date().toISOString();
      if (createJob) {
        deal.value = amount;
        deal.items = catalogItems;
      }
      modal.remove();
      await loadKanban();
      if (chatDeal && Number(chatDeal.id) === Number(deal.id)) {
        chatDeal = { ...chatDeal, ...deal };
        injectChatStrip(chatDeal, chatStages.length ? chatStages : stages);
      }
      toast('Venda convertida com sucesso!');
    } catch (err) {
      toast(err.message, true);
      if (btn) {
        btn.textContent = 'Converter e salvar';
        btn.disabled = false;
      }
    }
  }

  // ===== DETECTAR CHAT =====
  // WhatsApp Web 2024+ removeu muitos data-testid. Usamos fallbacks em cadeia.

  // Seletores do HEADER do chat aberto (em #main). Múltiplos pra resistir a updates.
  function getChatHeaderEl() {
    // Só headers DENTRO da conversa ativa — o fallback genérico `header[class*="header"]`
    // pegava o header da sidebar e contaminava o nome com texto de outros chats.
    return (
      document.querySelector('#main header') ||
      document.querySelector('[data-testid="conversation-header"]') ||
      null
    );
  }

  // Procura um data-id de WhatsApp ("xxx@c.us" ou "xxx@s.whatsapp.net") em qualquer
  // lugar do DOM do chat ativo — é a fonte mais confiável do número.
  function getPhoneFromDataIds() {
    const main = document.querySelector('#main');
    if (!main) return null;
    // Procura JID em qualquer atributo relevante; conversas antigas podem ter
    // [data-jid] ou JID em [data-id] de containers sem mensagens carregadas.
    const all = main.querySelectorAll('[data-id], [data-jid], [data-remote-jid]');
    for (const el of all) {
      for (const attr of ['data-id', 'data-jid', 'data-remote-jid']) {
        const value = el.getAttribute(attr) || '';
        if (!value) continue;
        const m = value.match(/(?:^|[_:])(\d{8,15})@(?:c\.us|s\.whatsapp\.net|lid)/);
        if (m) return m[1];
      }
    }
    return null;
  }

  // Tenta extrair telefone do título da janela (formato comum: "(N) Contato — WhatsApp")
  function getPhoneFromDocTitle() {
    const t = (document.title || '').replace(/\([0-9]+\)\s*/, '');
    const d = t.replace(/[\s\-\+\(\)]/g, '');
    if (/^\d{8,15}$/.test(d)) return d;
    const m = t.match(/\+?\d[\d\s\-\(\)]{7,}/);
    if (m) { const dd = digits(m[0]); if (dd.length >= 8) return dd; }
    return null;
  }

  // Item da sidebar marcado como ativo — fonte confiável de telefone mesmo quando
  // o #main ainda não carregou nenhuma mensagem da conversa aberta.
  // WhatsApp Web migrou de role="listitem" para role="row" — mantém ambos.
  const CHAT_LIST_ITEM_SELECTOR = '[role="row"], [role="listitem"], [data-testid="cell-frame-container"]';

  function getSelectedChatListItem() {
    const side = document.querySelector('#pane-side') || document.querySelector('#side');
    if (!side) return null;

    // 1) Direto via aria-selected/aria-current — o elemento pode ser o próprio row ou um descendente
    const directlySelected =
      side.querySelector(`${CHAT_LIST_ITEM_SELECTOR}[aria-selected="true"]`) ||
      side.querySelector(`${CHAT_LIST_ITEM_SELECTOR}[aria-current="true"]`);
    if (directlySelected) return directlySelected;

    const anyAriaSelected = side.querySelector('[aria-selected="true"], [aria-current="true"]');
    const wrapped = anyAriaSelected?.closest(CHAT_LIST_ITEM_SELECTOR);
    if (wrapped) return wrapped;

    // 2) Fallback: bate o nome do header com os itens visíveis da sidebar.
    const headerName = (getWAChatRawTitle() || '').trim().toLowerCase();
    if (!headerName) return null;
    const items = side.querySelectorAll(CHAT_LIST_ITEM_SELECTOR);
    const matches = [];
    for (const el of items) {
      const titleEl = el.querySelector('span[title]');
      const itemName = (titleEl?.getAttribute('title') || titleEl?.textContent || '').trim().toLowerCase();
      if (itemName && itemName === headerName) matches.push(el);
    }
    return matches.length === 1 ? matches[0] : null;
  }

  function getWAChatPhone() {
    // 1) Tenta o header (contatos não salvos aparecem como número)
    const header = getChatHeaderEl();
    if (header) {
      // Vários spans podem ter o nome/número
      for (const el of header.querySelectorAll('span[dir="auto"], span[title], span')) {
        const txt = (el.getAttribute('title') || el.textContent || '').trim();
        if (!txt) continue;
        const d = txt.replace(/[\s\-\+\(\)]/g, '');
        if (/^\d{8,15}$/.test(d)) return d;
        const m = txt.match(/\+?\d[\d\s\-\(\)]{7,}/);
        if (m) { const dd = digits(m[0]); if (dd.length >= 8) return dd; }
      }
    }
    // 2) data-id em mensagens (funciona pra contatos salvos com conversa carregada)
    const fromData = getPhoneFromDataIds();
    if (fromData) return fromData;
    // 3) Item selecionado na sidebar (funciona em conversas antigas/sem mensagens carregadas)
    const selectedItem = getSelectedChatListItem();
    if (selectedItem) {
      const fromList = extractPhoneFromChatListItem(selectedItem, '');
      if (fromList) return digits(fromList);
    }
    // 4) Cache nome → telefone (populado por leituras anteriores do drawer)
    const headerName = getWAChatName();
    const cached = getCachedPhoneByName(headerName);
    if (cached) return cached;
    // 5) título da janela
    const fromTitle = getPhoneFromDocTitle();
    if (fromTitle) return fromTitle;
    return null;
  }

  // Drawer aberto à direita após clicar no nome do contato no header.
  // Heurística: visível, posicionado na metade direita da tela, largura entre 200-700px,
  // contém botão "Fechar".
  function findOpenContactDrawer() {
    const candidates = document.querySelectorAll('section, aside, [role="complementary"], [data-testid*="drawer"]');
    for (const d of candidates) {
      if (!d.offsetWidth || !d.offsetHeight) continue;
      const rect = d.getBoundingClientRect();
      if (rect.right < window.innerWidth - 50) continue;
      if (rect.left < window.innerWidth / 2) continue;
      if (rect.width < 200 || rect.width > 700) continue;
      const close = d.querySelector('[aria-label="Fechar"], [aria-label="Close"], [aria-label*="fechar" i], [aria-label*="close" i]');
      if (close) return { drawer: d, close };
    }
    return null;
  }

  function extractPhoneFromDrawer(drawer) {
    for (const el of drawer.querySelectorAll('span, div')) {
      const txt = (el.textContent || '').trim();
      if (!txt || txt.length > 30) continue;
      const m = txt.match(/\+?\d[\d\s\-()]{8,20}/);
      if (!m) continue;
      const d = digits(m[0]);
      if (d.length >= 10 && d.length <= 15) return d;
    }
    return null;
  }

  // Abre o drawer do contato (clicando no header), lê o telefone, fecha.
  // Cacheia por nome para que abertura subsequentes sejam instantâneas.
  async function readPhoneFromContactDrawer(maxMs = 1500) {
    const header = getChatHeaderEl();
    if (!header) return null;

    const headerName = getWAChatName();
    const cached = getCachedPhoneByName(headerName);
    if (cached) return cached;

    let info = findOpenContactDrawer();
    let openedByUs = false;
    if (!info) {
      const clickable =
        header.querySelector('[role="button"]') ||
        header.querySelector('div[tabindex]') ||
        header;
      simulateRealClick(clickable);
      openedByUs = true;
    }

    const start = Date.now();
    let phone = null;
    while (!phone && Date.now() - start < maxMs) {
      await sleep(120);
      info = info || findOpenContactDrawer();
      if (!info) continue;
      phone = extractPhoneFromDrawer(info.drawer);
    }

    if (openedByUs && info?.close) {
      simulateRealClick(info.close);
    }

    if (phone) rememberChatPhoneByName(headerName, phone);
    return phone ? (phone.startsWith('55') || phone.length > 11 ? phone : `55${phone}`) : null;
  }

  function getWAChatName() {
    const header = getChatHeaderEl();
    if (header) {
      // Usa SÓ o atributo `title` (não o textContent, que concatena nome de ícones
      // tipo "ic-push-pin" do indicador de mensagem fixada).
      for (const titled of header.querySelectorAll('span[title]')) {
        const titleAttr = titled.getAttribute('title');
        if (!titleAttr) continue;
        const titleName = cleanWhatsappNameCandidate(titleAttr);
        if (titleName) return titleName;
      }

      for (const el of header.querySelectorAll('span[dir="auto"]')) {
        const name = cleanWhatsappNameCandidate(el.textContent || '');
        if (name) return name;
      }
    }

    return getWAChatProfileName();
  }

  function isVisibleElement(el) {
    if (!el || el.closest?.('#fp-kanban, #fp-modal, #fp-won-modal, #fp-chat-strip, #fp-stage-menu, #fp-info-modal, #fp-deal-edit-modal')) {
      return false;
    }
    const rect = el.getBoundingClientRect?.();
    if (!rect || rect.width <= 0 || rect.height <= 0) return false;
    if (rect.bottom < 0 || rect.top > window.innerHeight) return false;
    if (rect.right < 0 || rect.left > window.innerWidth) return false;
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0;
  }

  function elementOwnText(el) {
    if (!el) return '';
    const title = el.getAttribute?.('title');
    if (title) return title.trim();

    const own = Array.from(el.childNodes || [])
      .filter(node => node.nodeType === Node.TEXT_NODE)
      .map(node => node.nodeValue || '')
      .join('')
      .trim();

    return own || (el.textContent || '').trim();
  }

  function extractTildeProfileName(value) {
    const raw = String(value || '').replace(/[\u200e\u200f]/g, '').trim();
    if (!raw.includes('~')) return null;

    const match = raw.match(/(?:^|\s)~\s*([^\n\r•|]+?)(?=\s{2,}|$)/);
    const cleaned = String(match?.[1] || raw)
      .replace(/^.*~/, '')
      .replace(/\s*n[aã]o\s+est[aá]\s+nos\s+seus\s+contatos.*$/i, '')
      .replace(/\s*est[aá]\s+nos\s+seus\s+contatos.*$/i, '')
      .replace(/\s*nenhum\s+grupo.*$/i, '')
      .replace(/\s*ferramentas\s+de\s+seguran[çc]a.*$/i, '')
      .replace(/\s*bloquear.*$/i, '')
      .replace(/\s+n[aã]o$/i, '')
      .trim();
    const candidate = cleanWhatsappNameCandidate(cleaned);
    return candidate;
  }

  function elementNameTexts(el) {
    const values = [
      el.getAttribute?.('title') || '',
      el.getAttribute?.('aria-label') || '',
      elementOwnText(el),
    ];

    const text = (el.textContent || '').trim();
    if (text && text.length <= 120) values.push(text);

    return values
      .map(v => String(v || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean);
  }

  function cleanWhatsappNameCandidate(value) {
    let name = String(value || '')
      .replace(/[\u200e\u200f]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (!name) return null;
    name = name.replace(/^~+/, '').trim();
    if (!name || name.length > 60) return null;
    if (/^\+?\d[\d\s\-\+\(\)]{5,}$/.test(name)) return null;
    if (/^(hoje|ontem|online|digitando|mensagem|recado|dados do contato|info\.? do contato|informações do contato|notificações|silenciar notificações)$/i.test(name)) return null;
    // Status do header do WhatsApp ("visto por último hoje às 16:44", "digitando...", etc.)
    if (/^(visto por último|última vez|last seen|typing|gravando|recording|escrevendo)/i.test(name)) return null;
    if (/\bàs \d{1,2}[:.]\d{2}/i.test(name)) return null;
    // Labels do WhatsApp Business
    if (/^(conta comercial|conta business|conta verificada|verified business|business account|empresa local|negócio local|categoria do negócio)/i.test(name)) return null;
    if (/^clique aqui/i.test(name)) return null;
    // Nomes de ícones internos do WhatsApp ("ic-push-pin", "ic-locked" etc.) que vazam pra textContent
    if (/\bic-[a-z]/.test(name)) return null;
    if (/(push-pin|data-icon)/i.test(name)) return null;
    // Mensagens de sistema do grupo
    if (/\b(saiu|entrou|removeu|adicionou|convidou|left|joined|removed|added)\b/i.test(name) && name.length > 25) return null;
    return name;
  }

  function getWAChatProfileName() {
    const roots = [
      document.querySelector('[data-testid*="drawer"]'),
      document.querySelector('[role="complementary"]'),
      document.querySelector('aside'),
      document.querySelector('#main'),
      document.body,
    ].filter(Boolean);

    const seen = new Set();
    for (const root of roots) {
      const els = root.querySelectorAll('span[title], div[title], span[dir="auto"], div[dir="auto"], span, div');
      for (const el of els) {
        if (seen.has(el) || !isVisibleElement(el)) continue;
        seen.add(el);

        for (const raw of elementNameTexts(el)) {
          const tildeName = extractTildeProfileName(raw);
          if (tildeName) return tildeName;
        }
      }
    }

    return null;
  }

  function getWAChatPhoto() {
    // Só usamos a foto vinculada ao header. Imagens dentro de mensagens, stickers
    // e avatares de remetentes podem ter o mesmo tamanho e contaminariam o cache.
    const header = getChatHeaderEl();
    const headerImg = header?.querySelector('img[src]');
    if (headerImg?.src && /^(https?:|blob:|data:)/i.test(headerImg.src)) return headerImg.src;
    return null;
  }

  function getWAChatRawTitle() {
    const header = getChatHeaderEl();
    if (!header) return null;

    // Usa só o atributo title (textContent concatena nome de ícones técnicos)
    for (const titled of header.querySelectorAll('span[title]')) {
      const title = titled.getAttribute('title')?.trim();
      if (title) return title;
    }

    for (const el of header.querySelectorAll('span[dir="auto"], span')) {
      const txt = el.textContent?.trim();
      if (txt) return txt;
    }
    return null;
  }

  function getCurrentChatContact(fallbackPhone) {
    const rawTitle = getWAChatRawTitle();
    const rawTitleDigits = digits(rawTitle || '');
    const phone =
      digits(fallbackPhone || '') ||
      digits(chatPhone || '') ||
      digits(getWAChatPhone() || '') ||
      (rawTitleDigits.length >= 8 ? rawTitleDigits : '');

    const headerName = getWAChatName();
    const cleanRawTitle = cleanWhatsappNameCandidate(rawTitle);
    const name = headerName || cleanRawTitle || phone || 'Contato WhatsApp';

    return { name, phone };
  }

  // O header do WhatsApp leva algumas centenas de ms para popular o nome após abrir o chat.
  // Sem isso, "Criar com dados" puxa só o número ou um status como "visto por último".
  async function waitForChatContact(fallbackPhone, maxMs = 1500) {
    const isWeakName = (name) => {
      if (!name) return true;
      if (name === 'Contato WhatsApp') return true;
      if (/^\+?\d[\d\s\-()+]{5,}$/.test(name)) return true;
      return false;
    };
    const isWeakPhone = (phone) => !phone || digits(phone).length < 8;
    const start = Date.now();
    let contact = getCurrentChatContact(fallbackPhone);
    while ((isWeakName(contact.name) || isWeakPhone(contact.phone)) && Date.now() - start < maxMs) {
      await sleep(140);
      contact = getCurrentChatContact(fallbackPhone);
    }
    // Último recurso: abre o drawer do contato e lê o telefone de lá.
    // O WhatsApp Web deixou de expor o JID no DOM da sidebar para contatos salvos.
    if (isWeakPhone(contact.phone) && !isWeakName(contact.name)) {
      const drawerPhone = await readPhoneFromContactDrawer(1800);
      if (drawerPhone) contact = { ...contact, phone: drawerPhone };
    }
    if (!isWeakPhone(contact.phone) && !isWeakName(contact.name)) {
      rememberChatPhoneByName(contact.name, contact.phone);
    }
    return contact;
  }

  // ===== LER A INBOX DO WHATSAPP WEB =====
  // Varre a lista lateral de conversas e devolve [{name, preview, time, unread, photo, el}, ...]
  // Filtra fora conversas que já viraram deal (matching pelo nome).
  function scanWhatsappInbox() {
    const sideEl = document.querySelector('#pane-side') || document.querySelector('#side');
    if (!sideEl) return [];

    const items = sideEl.querySelectorAll(CHAT_LIST_ITEM_SELECTOR);
    const dealNames = new Set(deals.map(d => (d.contact_name || d.title || '').trim().toLowerCase()).filter(Boolean));
    const dealPhones = new Set(
      deals
        .map(d => normalizeWhatsappPhone(d.contact_phone || ''))
        .filter(p => p && p.length >= 8)
    );
    const out = [];
    const seen = new Set();

    for (const el of items) {
      const nameEl = el.querySelector('span[title]');
      if (!nameEl) continue;
      const name = (nameEl.getAttribute('title') || nameEl.textContent || '').trim();
      if (!name) continue;

      if (dealNames.has(name.toLowerCase())) continue;

      const phone = extractPhoneFromChatListItem(el, name);
      if (phone && dealPhones.has(phone)) continue;

      const key = `${name}|${el.getBoundingClientRect().top}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const allSpans = el.querySelectorAll('span[dir]');
      let preview = '';
      for (const s of allSpans) {
        const txt = s.textContent?.trim() || '';
        if (txt && txt !== name) { preview = txt; break; }
      }

      let time = '';
      for (const s of el.querySelectorAll('span')) {
        const t = s.textContent?.trim() || '';
        if (/^\d{1,2}:\d{2}$/.test(t) || /^(ontem|hoje)$/i.test(t) || /-feira$/i.test(t) || /^\d{1,2}\/\d{1,2}/.test(t)) {
          time = t; break;
        }
      }

      let unread = 0;
      const badge = el.querySelector('[aria-label*="não lida" i], [aria-label*="unread" i], span[data-icon="unread-count"]');
      if (badge) {
        const n = parseInt(badge.textContent || '1', 10);
        unread = Number.isFinite(n) ? n : 1;
      }

      const imgEl = el.querySelector('img[src]');
      const photo = imgEl?.getAttribute('src') || null;

      out.push({ name, preview, time, unread, photo, phone, el });
    }
    return out;
  }

  function isChatOpen() {
    // Múltiplos sinais que confirmam que há uma conversa aberta no painel principal
    return !!(
      getChatHeaderEl() ||
      document.querySelector('#main footer') ||                      // compositor da mensagem
      document.querySelector('#main [contenteditable="true"]') ||    // input de texto
      document.querySelector('[data-testid="conversation-panel-body"]') ||
      document.querySelector('[data-testid="msg-container"]') ||
      document.querySelector('[data-testid="conversation-compose-box"]')
    );
  }

  let detectDebounce;
  function detectState() {
    // Kanban visível = usuário está navegando o funil, não a conversa
    if (kanbanVisible) return;

    if (isChatOpen()) {
      const phone = getWAChatPhone();
      const name = getWAChatName();
      if (phone) {
        console.log('[FocalPoint] Chat detectado:', phone);
        onChatOpened(phone);
      } else if (name) {
        console.log('[FocalPoint] Chat detectado sem telefone:', name);
        onChatOpened(null);
      } else if (!phone && !chatKey) {
        if (!window.__fpWarnedNoPhone) {
          window.__fpWarnedNoPhone = true;
          console.warn('[FocalPoint] Chat aberto mas não consegui detectar telefone. Header:', getChatHeaderEl());
        }
      }
    } else if (chatKey && document.getElementById('fp-chat-strip')) {
      positionChatStrip();
    } else {
      chatPhone = null;
      chatKey = null;
      removeChatStrip();
    }
  }

  function startObserver() {
    document.addEventListener('click', (e) => {
      // Ignora clicks dentro do próprio kanban (cards, botões etc.)
      if (e.target.closest('#fp-kanban, #fp-modal, #fp-deal-edit-modal, #fp-fab, #fp-chat-strip, #fp-stage-menu')) return;

      const item = e.target.closest('[role="listitem"], [data-testid="cell-frame-container"]');
      if (item) {
        if (Date.now() < suppressChatListClickUntil) return;
        // Usuário clicou na lista do WhatsApp → esconde o kanban pra liberar #main
        if (kanbanVisible) hideKanban();
        clearTimeout(detectDebounce);
        detectDebounce = setTimeout(detectState, 700);
      }
    }, true);

    new MutationObserver(() => {
      // Garante que a rail nativa sobreviva às re-renderizações da sidebar
      if (!document.getElementById('fp-rail-mounted')?.isConnected) mountNativeRail();
      if (kanbanVisible) return;
      positionChatStrip();
      clearTimeout(detectDebounce);
      detectDebounce = setTimeout(detectState, 500);
    }).observe(document.body, { childList: true, subtree: true });
  }

  // ===== MODAL =====
  function populateModalStages(defaultStageId) {
    const select = document.getElementById('fp-msid');
    if (!select) return;

    const list = orderedStages(chatStages.length ? chatStages : stages);
    if (!list.length) {
      select.innerHTML = '<option value="">Carregando etapas...</option>';
      select.disabled = true;
      return;
    }

    select.disabled = false;
    select.innerHTML = list.map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');
    const fallback = list.find(s => s.id === defaultStageId)?.id || firstOpenStage(list)?.id || list[0]?.id || '';
    select.value = fallback;
  }

  function refreshModalStages(defaultStageId) {
    populateModalStages(defaultStageId);
    const hasStages = orderedStages(chatStages.length ? chatStages : stages).length > 0;
    if (hasStages) return;

    bg({ type: 'GET_STAGES' })
      .then((sr) => {
        stages = sr || [];
        if (!chatStages.length) chatStages = stages;
        populateModalStages(defaultStageId);
      })
      .catch((err) => toast(err.message, true));
  }

  async function loadTeamAndMe() {
    try {
      const [members, me] = await Promise.all([
        bg({ type: 'GET_TEAM_MEMBERS' }).catch(() => []),
        bg({ type: 'GET_ME' }).catch(() => null),
      ]);
      teamMembers = Array.isArray(members) ? members.filter(m => m.is_active !== false) : [];
      currentMemberId = me?.currentMember?.id || null;
    } catch { /* silencioso — sem equipe, o select fica como "sem responsável" */ }
  }

  function populateAssigneeSelect(selectId, currentValue) {
    const select = document.getElementById(selectId);
    if (!select) return;
    const value = currentValue || '';
    const opts = ['<option value="">Sem responsável</option>']
      .concat(teamMembers.map(m => `<option value="${esc(m.id)}">${esc(m.name)}</option>`));
    select.innerHTML = opts.join('');
    select.value = value;
  }

  function openModal(phone, name, stageId, fromChat = false) {
    const m = document.getElementById('fp-modal');
    if (!m) return;
    modalContext = { fromChat: !!fromChat };

    if (fromChat) {
      const contact = getCurrentChatContact(phone);
      const parsed = extractCadastroFromVisibleConversation();
      phone = parsed.phone || phone || contact.phone;
      name = parsed.name || name || contact.name;
    }

    const phoneInput = document.getElementById('fp-mp');
    const nameInput = document.getElementById('fp-mn');
    if (phoneInput) phoneInput.value = phone ? digits(phone) : '';
    if (nameInput) nameInput.value = name || '';
    refreshModalStages(stageId);
    // Vendedor: default no usuário logado se já conhecido, e re-carrega lista em background
    populateAssigneeSelect('fp-massign', currentMemberId);
    loadTeamAndMe().then(() => populateAssigneeSelect('fp-massign', currentMemberId));
    m.classList.remove('fp-hidden');
    setTimeout(() => document.getElementById('fp-mn')?.focus(), 50);
  }

  function closeModal() {
    const m = document.getElementById('fp-modal');
    if (!m) return;
    m.classList.add('fp-hidden');
    ['fp-mn', 'fp-mp', 'fp-mv'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    modalContext = { fromChat: false };
  }

  async function saveNewDeal() {
    let name = document.getElementById('fp-mn')?.value.trim();
    const phone = digits(document.getElementById('fp-mp')?.value || '');
    const value = Number(document.getElementById('fp-mv')?.value) || 0;
    const stage = document.getElementById('fp-msid')?.value || undefined;
    const assigned_to = document.getElementById('fp-massign')?.value || null;
    if (!name && phone) name = phone;
    if (!name) return toast('Nome é obrigatório', true);
    if (!phone) return toast('Telefone é obrigatório', true);
    const btn = document.getElementById('fp-ms');
    btn.textContent = 'Criando...'; btn.disabled = true;
    try {
      const shouldRefreshChat =
        modalContext.fromChat ||
        (chatPhone && digits(chatPhone).includes(phone.slice(-8))) ||
        (digits(getWAChatPhone() || '').includes(phone.slice(-8)));

      if (shouldRefreshChat) rememberContactPhoto(phone, getWAChatPhoto());
      await bg({ type: 'CREATE_DEAL', data: { name, phone, value, source: 'whatsapp-extension', stage, assigned_to } });
      toast('Lead criado!');
      closeModal();
      await loadKanban();
      // Se temos um chat aberto para esse número, atualiza a faixa
      if (shouldRefreshChat) {
        chatKey = null;
        chatPhone = null; // força reload
        onChatOpened(phone);
      }
    } catch (err) { toast(err.message, true); }
    finally { btn.textContent = 'Criar'; btn.disabled = false; }
  }

  // ===== INIT =====
  function init() {
    build();
    startObserver();
    showKanban();
    adjustPosition();
    // Re-ajusta quando o WA termina de renderizar
    setTimeout(adjustPosition, 2000);
    setTimeout(adjustPosition, 4000);
    // Carrega vendedores em background — modal e "Adicionar ao Pipeline" já abrem com o valor certo
    loadTeamAndMe();
  }

  if (document.readyState === 'complete') setTimeout(init, 1800);
  else window.addEventListener('load', () => setTimeout(init, 1800));
})();

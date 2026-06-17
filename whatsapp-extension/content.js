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
  // Tempo parado na etapa do funil — mesmos limites da pipeline de vendas do app (12h = atenção/amarelo, 24h = atrasado/vermelho)
  const staleness = (enteredAt) => {
    if (!enteredAt) return null;
    const hours = (Date.now() - new Date(enteredAt).getTime()) / 3_600_000;
    if (hours >= 24) return 'urgent';
    if (hours >= 12) return 'warning';
    return null;
  };
  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  // ===== STATE =====
  let deals = [], stages = [];
  let teamMembers = [];
  let currentMemberId = null;
  let chatPhone = null, chatDeal = null, chatStages = [];
  let chatKey = null;
  let modalContext = { fromChat: false };
  // Pickers do modal "Novo Lead" — instâncias fpSelect
  let modalStageSel = null;
  let modalAssignSel = null;
  let modalSourceSel = null;
  let modalTypeSel = null;
  let draggingId = null;
  let draggingInboxIdx = null;
  let dragMoved = false;
  let pointerDrag = null;
  let inboxItems = [];   // conversas varridas da lista do WA
  let contactPhotos = loadContactPhotos();
  let chatPhoneByName = loadChatPhoneByName();
  let suppressChatListClickUntil = 0;
  // Após ESC, suprime a re-detecção da faixa do chat por um instante pra
  // ela não voltar sozinha enquanto o WhatsApp fecha a conversa.
  let suppressChatStripUntil = 0;
  let q = '';
  let kanbanVisible = true;
  // Filtro de período do Pipeline: 'all' | 'today' | '7d' | '30d' | 'custom'
  // Pra 'custom', usa kanbanCustomRange = { from, to }
  let kanbanPeriod = 'all';
  let kanbanCustomRange = null;
  // Filtro de responsável do Pipeline: '' (todos) | id do membro | 'none' (sem ninguém)
  let kanbanAssignee = '';

  const LEAD_SOURCE_OPTIONS = ['WhatsApp', 'Anúncio', 'Indicação', 'Instagram', 'Facebook', 'Google', 'Site', 'Cliente antigo', 'Outro'];

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

  // ===== SALE CELEBRATION =====
  const saleSoundUrl = () => {
    try { return chrome.runtime.getURL('sounds/venda-realizada.webm'); }
    catch { return ''; }
  };
  const ensureSaleCelebrationStyle = () => {
    if (document.getElementById('fp-sale-celebration-style')) return;
    const style = document.createElement('style');
    style.id = 'fp-sale-celebration-style';
    style.textContent = `
      .fp-sale-confetti-layer{position:fixed;inset:0;z-index:2147483647;pointer-events:none;overflow:hidden}
      .fp-sale-confetti-piece{position:absolute;left:50%;top:50%;width:var(--w);height:var(--h);border-radius:2px;background:var(--c);opacity:0;transform:translate(-50%,-50%) rotate(0deg);animation:fp-sale-confetti-burst var(--dur) cubic-bezier(.18,.75,.32,1) forwards;animation-delay:var(--delay);box-shadow:0 0 10px rgba(255,255,255,.24)}
      @keyframes fp-sale-confetti-burst{0%{opacity:1;transform:translate(-50%,-50%) scale(.45) rotate(0deg)}72%{opacity:1}100%{opacity:0;transform:translate(calc(-50% + var(--tx)),calc(-50% + var(--ty))) scale(1) rotate(var(--rot))}}
    `;
    document.head.appendChild(style);
  };
  const celebrateSale = () => {
    const src = saleSoundUrl();
    if (src) {
      try {
        const audio = new Audio(src);
        audio.volume = 0.78;
        audio.play().catch(() => {});
      } catch {}
    }

    ensureSaleCelebrationStyle();
    const layer = document.createElement('div');
    layer.className = 'fp-sale-confetti-layer';
    document.body.appendChild(layer);
    const colors = ['#F1C665', '#10B981', '#38BDF8', '#EC4899', '#F97316', '#8B5CF6', '#FFFFFF'];
    for (let i = 0; i < 92; i += 1) {
      const piece = document.createElement('span');
      const angle = Math.random() * Math.PI * 2;
      const distance = 140 + Math.random() * Math.max(window.innerWidth, window.innerHeight) * 0.58;
      const tx = Math.cos(angle) * distance;
      const ty = Math.sin(angle) * distance + 110 + Math.random() * 160;
      piece.className = 'fp-sale-confetti-piece';
      piece.style.setProperty('--tx', `${tx.toFixed(1)}px`);
      piece.style.setProperty('--ty', `${ty.toFixed(1)}px`);
      piece.style.setProperty('--rot', `${Math.round((Math.random() * 920) - 460)}deg`);
      piece.style.setProperty('--dur', `${(1150 + Math.random() * 850).toFixed(0)}ms`);
      piece.style.setProperty('--delay', `${(Math.random() * 120).toFixed(0)}ms`);
      piece.style.setProperty('--w', `${(6 + Math.random() * 7).toFixed(1)}px`);
      piece.style.setProperty('--h', `${(8 + Math.random() * 14).toFixed(1)}px`);
      piece.style.setProperty('--c', colors[i % colors.length]);
      layer.appendChild(piece);
    }
    setTimeout(() => layer.remove(), 2400);
  };

  // ─── Tradução de status (vindo do backend em inglês) ─────────────────
  const STATUS_LABELS_PT = {
    scheduled:   'Agendado',
    in_progress: 'Em andamento',
    editing:     'Em edição',
    completed:   'Concluído',
    delivered:   'Entregue',
    cancelled:   'Cancelado',
    paid:        'Pago',
    pending:     'Pendente',
    partial:     'Parcial',
  };
  const prettyStatus = (s) => STATUS_LABELS_PT[s] || s || '';

  // ─── fpSelect: dropdown custom (substitui <select> nativo) ───────────
  // Uso:
  //   const sel = fpSelect({ items: [{value, label}], value, placeholder, searchable, onChange });
  //   container.appendChild(sel.element);
  //   sel.getValue(); sel.setValue(v); sel.setItems(arr);
  // Fecha o modal só quando o clique COMEÇA e TERMINA no fundo (overlay).
  // Antes: arrastar a barra de rolagem (ou selecionar texto) e soltar o mouse
  // fora da caixa disparava 'click' no overlay → o modal fechava sozinho no
  // meio do preenchimento (ex: na hora de fechar uma venda).
  function bindOverlayClose(overlayEl, closeFn) {
    let downOnOverlay = false;
    overlayEl.addEventListener('mousedown', (e) => { downOnOverlay = (e.target === overlayEl); });
    overlayEl.addEventListener('click', (e) => {
      if (e.target === overlayEl && downOnOverlay) closeFn();
      downOnOverlay = false;
    });
  }

  function fpSelect({ items = [], value = '', placeholder = 'Selecione…', searchable = false, onChange } = {}) {
    const wrap = document.createElement('div');
    wrap.className = 'fp-fselect';
    let _items = items.slice();
    let currentValue = value;
    let currentItem = _items.find((it) => String(it.value) === String(value)) || null;

    function getLabel() {
      return currentItem ? (currentItem.label || currentItem.value) : '';
    }

    function render() {
      const lbl = getLabel();
      wrap.innerHTML = `
        <button type="button" class="fp-fselect-trigger ${lbl ? '' : 'fp-fselect-empty'}">
          <span class="fp-fselect-value">${lbl ? esc(lbl) : esc(placeholder)}</span>
          <svg class="fp-fselect-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
      `;
      wrap.querySelector('.fp-fselect-trigger').addEventListener('click', openMenu);
    }

    function openMenu() {
      document.querySelectorAll('.fp-fselect-menu').forEach((m) => m.remove());
      const trigger = wrap.querySelector('.fp-fselect-trigger');
      const rect = trigger.getBoundingClientRect();
      const menu = document.createElement('div');
      menu.className = 'fp-fselect-menu';
      menu.style.left = `${rect.left}px`;
      menu.style.top = `${rect.bottom + 6}px`;
      menu.style.minWidth = `${rect.width}px`;
      const showSearch = searchable || _items.length > 6;
      menu.innerHTML = `
        ${showSearch ? `
          <div class="fp-fselect-search">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
            <input type="text" placeholder="Buscar…" autocomplete="off" />
          </div>
        ` : ''}
        <div class="fp-fselect-list"></div>
      `;
      document.body.appendChild(menu);

      function renderList(filter = '') {
        const f = filter.trim().toLowerCase();
        const filtered = f
          ? _items.filter((it) => String(it.label || it.value).toLowerCase().includes(f))
          : _items;
        const list = menu.querySelector('.fp-fselect-list');
        if (filtered.length === 0) {
          list.innerHTML = `<div class="fp-fselect-empty-msg">Nenhum resultado</div>`;
          return;
        }
        list.innerHTML = filtered.map((it) => {
          const active = String(it.value) === String(currentValue);
          return `
            <button type="button" class="fp-fselect-item ${active ? 'fp-fselect-item-active' : ''}" data-val="${esc(it.value)}">
              ${it.swatch ? `<span class="fp-fselect-swatch" style="background:${esc(it.swatch)}"></span>` : ''}
              <span class="fp-fselect-item-label">${esc(it.label || it.value)}</span>
              ${active ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="5 12 10 17 20 7"/></svg>` : ''}
            </button>
          `;
        }).join('');
        list.querySelectorAll('.fp-fselect-item').forEach((btn) => {
          btn.addEventListener('click', () => {
            const v = btn.getAttribute('data-val');
            const item = _items.find((it) => String(it.value) === v) || { value: v, label: v };
            currentValue = item.value;
            currentItem = item;
            render();
            close();
            if (onChange) onChange(currentValue, item);
          });
        });
      }
      renderList();
      const searchInput = menu.querySelector('.fp-fselect-search input');
      if (searchInput) {
        searchInput.addEventListener('input', () => renderList(searchInput.value));
        setTimeout(() => searchInput.focus(), 30);
      }
      function close() {
        menu.remove();
        document.removeEventListener('mousedown', onDoc, true);
        document.removeEventListener('keydown', onKey, true);
        window.removeEventListener('scroll', onScroll, true);
      }
      function onDoc(e) { if (!menu.contains(e.target) && !wrap.contains(e.target)) close(); }
      function onKey(e) { if (e.key === 'Escape') close(); }
      // Rolar DENTRO do menu não fecha (bug antigo: fechava ao rolar a lista
      // pra ver as últimas opções). Rolagem fora (página/modal) reposiciona o
      // menu pra seguir o campo; só fecha se o campo sair da tela.
      function onScroll(e) {
        if (menu.contains(e.target)) return;
        const r = trigger.getBoundingClientRect();
        if (!r.height || r.bottom < 0 || r.top > window.innerHeight) { close(); return; }
        menu.style.left = `${r.left}px`;
        menu.style.top = `${r.bottom + 6}px`;
      }
      setTimeout(() => {
        document.addEventListener('mousedown', onDoc, true);
        document.addEventListener('keydown', onKey, true);
        window.addEventListener('scroll', onScroll, true);
      }, 0);
    }

    render();

    return {
      element: wrap,
      getValue: () => currentValue,
      getLabel,
      getItems: () => _items.slice(),
      setValue: (v) => {
        currentValue = v;
        currentItem = _items.find((it) => String(it.value) === String(v)) || null;
        render();
      },
      setItems: (arr) => {
        _items = arr.slice();
        currentItem = _items.find((it) => String(it.value) === String(currentValue)) || null;
        render();
      },
    };
  }

  // ─── fpConfirm: modal de confirmação premium (substitui window.confirm) ──
  // Retorna Promise<boolean>. Uso:
  //   const ok = await fpConfirm({ title, message, danger: true });
  //   if (ok) { ... }
  function fpConfirm({ title = 'Tem certeza?', message = '', confirmLabel = 'Confirmar', cancelLabel = 'Cancelar', danger = false } = {}) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'fp-info-overlay fp-confirm-overlay';
      overlay.innerHTML = `
        <div class="fp-confirm-box ${danger ? 'fp-confirm-danger' : ''}">
          <div class="fp-confirm-icon">
            ${danger
              ? `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`
              : `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`}
          </div>
          <div class="fp-confirm-body">
            <div class="fp-confirm-title">${esc(title)}</div>
            ${message ? `<div class="fp-confirm-msg">${esc(message)}</div>` : ''}
          </div>
          <div class="fp-confirm-foot">
            <button type="button" class="fp-btn-w fp-confirm-cancel">${esc(cancelLabel)}</button>
            <button type="button" class="${danger ? 'fp-btn-danger-solid' : 'fp-btn-g'} fp-confirm-ok">${esc(confirmLabel)}</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
      const cleanup = (val) => {
        overlay.remove();
        document.removeEventListener('keydown', onKey, true);
        resolve(val);
      };
      function onKey(e) {
        if (e.key === 'Escape') cleanup(false);
        if (e.key === 'Enter' && document.activeElement?.classList?.contains('fp-confirm-ok')) cleanup(true);
      }
      overlay.querySelector('.fp-confirm-cancel').addEventListener('click', () => cleanup(false));
      overlay.querySelector('.fp-confirm-ok').addEventListener('click', () => cleanup(true));
      overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(false); });
      document.addEventListener('keydown', onKey, true);
      setTimeout(() => overlay.querySelector('.fp-confirm-ok')?.focus(), 30);
    });
  }

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
      <div id="fp-kpi">
        <div id="fp-kpi-period">
          <span class="fp-kpi-period-label">Período:</span>
          <button class="fp-kpi-chip" data-period="all">Tudo</button>
          <button class="fp-kpi-chip" data-period="today">Hoje</button>
          <button class="fp-kpi-chip" data-period="7d">7 dias</button>
          <button class="fp-kpi-chip" data-period="30d">30 dias</button>
          <button class="fp-kpi-chip fp-kpi-chip-custom" data-period="custom">📅 Personalizado</button>
          <span id="fp-kpi-range-label"></span>
        </div>
        <div id="fp-kpi-assignee" style="display:flex;flex-wrap:wrap;align-items:center;gap:4px;margin-top:4px"></div>
        <div id="fp-kpi-stats">
          <div class="fp-kpi-stat" title="Total de leads no período">
            <span class="fp-kpi-num" id="fp-kpi-total">—</span>
            <span class="fp-kpi-label">Total</span>
          </div>
          <div class="fp-kpi-stat fp-kpi-stat-open" title="Leads em etapas abertas (não-finais)">
            <span class="fp-kpi-num" id="fp-kpi-open">—</span>
            <span class="fp-kpi-label">Em aberto</span>
          </div>
          <div class="fp-kpi-stat fp-kpi-stat-won" title="Leads convertidos em ganho">
            <span class="fp-kpi-num" id="fp-kpi-won">—</span>
            <span class="fp-kpi-label">Ganho</span>
          </div>
          <div class="fp-kpi-stat fp-kpi-stat-lost" title="Leads perdidos">
            <span class="fp-kpi-num" id="fp-kpi-lost">—</span>
            <span class="fp-kpi-label">Perdido</span>
          </div>
          <div class="fp-kpi-stat fp-kpi-stat-conv" title="Conversão = ganho / (ganho + perdido)">
            <span class="fp-kpi-num" id="fp-kpi-conv">—</span>
            <span class="fp-kpi-label">Conversão</span>
          </div>
        </div>
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
        <div class="fp-mf"><label class="fp-ml">Origem</label><div id="fp-msource-slot"></div></div>
        <div class="fp-mf"><label class="fp-ml">Tipo de ensaio</label><div id="fp-mtype-slot"></div></div>
        <div class="fp-mf"><label class="fp-ml">Etapa do funil</label><div id="fp-msid-slot"></div></div>
        <div class="fp-mf"><label class="fp-ml">Vendedor responsável</label><div id="fp-massign-slot"></div></div>
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
    document.querySelectorAll('.fp-kpi-chip').forEach((b) => {
      b.addEventListener('click', () => {
        const period = b.getAttribute('data-period');
        if (period === 'custom') {
          openCustomRangePicker();
          return;
        }
        kanbanPeriod = period;
        renderBoard();
      });
    });
    document.getElementById('fp-mc').addEventListener('click', closeModal);
    document.getElementById('fp-ms').addEventListener('click', saveNewDeal);
    bindOverlayClose(m, closeModal);

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
    // Quando o kanban está aberto, o #side da lista de chats fica display:none
    // (via body.fp-kanban-open). Nesse caso, pegamos a largura da nav vertical
    // do WhatsApp (onde a rail dos botões fica) pra o kanban não cobri-la.
    let leftPx;
    const kanbanOpen = document.body.classList.contains('fp-kanban-open');
    if (kanbanOpen) {
      const navEl = document.getElementById('fp-rail-mounted')?.closest('nav, header')
        || document.querySelector('header[role="banner"], nav[role="navigation"]');
      const nav = navEl?.getBoundingClientRect();
      leftPx = nav ? Math.round(nav.right) : 72;
    } else {
      const side = document.querySelector('#side, #pane-side, [data-testid="chat-list"]')?.getBoundingClientRect();
      leftPx = side ? Math.round(side.right) : 380;
    }
    const left = leftPx;
    // Expõe globalmente a largura da sidebar do WA pros overlays (Pipeline,
    // Produção, Tarefas, Agenda) começarem logo após ela (left: var(--fp-side-width)).
    document.documentElement.style.setProperty('--fp-side-width', left + 'px');
    document.getElementById('fp-kanban')?.style.setProperty('--fp-side-width', left + 'px');
    const k = document.getElementById('fp-kanban');
    if (k) k.style.left = left + 'px';
    const ag = document.getElementById('fp-agenda');
    if (ag) ag.style.left = left + 'px';
    const pr = document.getElementById('fp-production');
    if (pr) pr.style.left = left + 'px';
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
      <button id="fp-rail-tasks" class="fp-rail-nat-btn" title="Tarefas" aria-label="Tarefas">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>
      </button>
      <button id="fp-rail-production" class="fp-rail-nat-btn" title="Produção" aria-label="Produção">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
      </button>
      <button id="fp-rail-agenda" class="fp-rail-nat-btn" title="Agenda" aria-label="Agenda">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
      </button>
    `;
    container.querySelector('#fp-rail-pipeline')?.addEventListener('click', showKanban);
    container.querySelector('#fp-rail-tasks')?.addEventListener('click', showTasks);
    container.querySelector('#fp-rail-production')?.addEventListener('click', showProduction);
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

  // ===== NÃO-LIDAS POR CONTATO (badge nos cards) =====
  // Lê os badges de "não lida" direto do DOM da lista do WhatsApp Web — assim
  // ler a conversa (ou marcar como não lida) no WA reflete aqui sozinho no
  // próximo tick do refresh (≤5s), nos dois sentidos. Limitação: a lista do
  // WA é virtualizada, mas não-lidas sobem pro topo e ficam no DOM.
  let unreadByContact = new Map();

  function normNameKey(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  }

  function computeUnreadByContact() {
    const map = new Map();
    let items = [];
    try { items = scanWhatsappInbox(); } catch { return map; }
    for (const it of items) {
      const n = Number(it?.unread) || 0;
      if (n <= 0) continue;
      const ph = digits(it.phone || '');
      if (ph.length >= 8) map.set('p:' + ph.slice(-8), n);
      const nk = normNameKey(it.name);
      if (nk) map.set('n:' + nk, n);
    }
    return map;
  }

  function getUnreadForDeal(d) {
    const ph = digits(d?.contact_phone || '');
    if (ph.length >= 8) {
      const v = unreadByContact.get('p:' + ph.slice(-8));
      if (v) return v;
    }
    const nk = normNameKey(d?.contact_name || d?.title);
    return nk ? (unreadByContact.get('n:' + nk) || 0) : 0;
  }

  // ===== KANBAN =====
  let lastBoardSig = '';
  async function loadKanban(opts) {
    const silent = !!(opts && opts.silent === true);
    if (!silent) showBoardState('<div class="fp-spin"></div><span>Carregando pipeline...</span>');
    try {
      const [dr, sr, tm, me] = await Promise.all([
        bg({ type: 'GET_ALL_DEALS' }),
        bg({ type: 'GET_STAGES' }),
        bg({ type: 'GET_TEAM_MEMBERS' }).catch(() => []),
        bg({ type: 'GET_ME' }).catch(() => null),
      ]);
      const nextDeals = dr || [];
      const nextStages = sr || [];
      const nextMembers = Array.isArray(tm) ? tm.filter(m => m.is_active !== false) : [];
      const nextMemberId = me?.currentMember?.id || null;
      // No refresh silencioso (polling de 5s), só rebuilda o board se algo
      // mudou de fato — evita flash/reset de rolagem quando nada mudou.
      // As não-lidas entram na assinatura: ler/marcar não lida no WA re-renderiza.
      const nextUnread = computeUnreadByContact();
      const unreadSig = [...nextUnread.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([k, v]) => `${k}:${v}`).join('|');
      const sig = JSON.stringify([nextDeals, nextStages, nextMembers, nextMemberId, unreadSig]);
      if (silent && sig === lastBoardSig) return;
      lastBoardSig = sig;
      unreadByContact = nextUnread;
      deals = nextDeals;
      stages = nextStages;
      teamMembers = nextMembers;
      currentMemberId = nextMemberId;
      renderBoard();
    } catch (err) {
      if (silent) return; // refresh em segundo plano falhou — mantém o board atual
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
    // Guarda a rolagem: um refresh em 2º plano não deve jogar o board pro início.
    const prevScrollLeft = b.scrollLeft;
    const prevScrollTop = b.scrollTop;
    renderKpi();
    renderAssigneeFilter();
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
          <input id="fp-inbox-phone" type="text" placeholder="Nome ou número…" class="fp-inbox-input" autocomplete="off" />
          <button id="fp-inbox-open" class="fp-btn-g">Abrir</button>
        </div>
        <div id="fp-inbox-results" style="display:none;margin:0 0 6px;border:1px solid var(--fp-border,#e5e7eb);border-radius:8px;overflow:hidden;background:#fff;max-height:220px;overflow-y:auto"></div>
        <div class="fpc-body" id="fpb-inbox">
          ${inboxItems.length
            ? inboxItems.map((it, idx) => inboxCard(it, idx)).join('')
            : '<div class="fpc-empty">Sem conversas novas no WhatsApp</div>'}
        </div>
      </div>
    `;

    // ── Colunas das etapas ──
    // Lead com etapa órfã (pipeline recriada no app → ids mudaram) cai na
    // primeira coluna aberta em vez de sumir do board.
    const knownStageIds = new Set(all.map(s => s.id));
    const firstOpenId = (all.find(s => !s.is_final) || all[0])?.id;
    const stagesHtml = all.map((s, i) => {
      const c = C(s.position ?? i);
      const sd = deals.filter(d => (
        d.stage === s.id ||
        (s.id === firstOpenId && d.stage && !knownStageIds.has(d.stage) && !d.converted)
      ) && matches(d));
      const total = sd.reduce((t, d) => t + (d.value || 0), 0);
      // Funcionário sem permissão "Financeiro" recebe os deals com value=null
      // (zerado no backend) — aí escondemos o total em R$ em vez de mostrar "R$ 0".
      const hasValues = sd.some(d => d.value != null);
      const hasLeadsWithPhone = sd.some(d => d.contact_phone);
      return `
        <div class="fpc" data-stage-id="${s.id}">
          <div class="fpc-hd">
            <div class="fpc-title" style="color:${c.text}">
              <span class="fpc-dot" style="background:${c.dot}"></span>${esc(s.name)}
            </div>
            <div class="fpc-meta-row">
              <span class="fpc-meta">${sd.length} lead${sd.length !== 1 ? 's' : ''}${hasValues ? ` · ${brl.format(total)}` : ''}</span>
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
    b.scrollLeft = prevScrollLeft;
    b.scrollTop = prevScrollTop;

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
    const resultsBox = document.getElementById('fp-inbox-results');
    if (!input || !btn) return;

    const closeResults = () => { if (resultsBox) { resultsBox.style.display = 'none'; resultsBox.innerHTML = ''; } };

    // Considera "número" se o texto digitado é só dígitos/sinais de telefone.
    const looksLikeNumber = (raw) => /^[\d\s()+\-.]+$/.test(raw) && digits(raw).length >= 8;

    const openContact = async (d) => {
      closeResults();
      input.value = '';
      await openByNumberInApp(d.contact_phone, d.contact_name || d.title || '');
    };

    // Busca por NOME no pipeline (deals com telefone). Mostra os que batem.
    const searchByName = (raw) => {
      if (!resultsBox) return;
      const q = normalizeNameForMatch(raw);
      if (!q) { closeResults(); return; }
      const matches = deals
        .filter((d) => d.contact_phone && normalizeNameForMatch(d.contact_name || d.title || '').includes(q))
        .slice(0, 8);
      if (!matches.length) {
        resultsBox.innerHTML = `<div style="padding:8px 10px;font-size:12px;color:#888">Nenhum contato com esse nome no pipeline</div>`;
        resultsBox.style.display = 'block';
        return;
      }
      resultsBox.innerHTML = matches.map((d, i) =>
        `<button class="fp-inbox-result" data-i="${i}" style="display:flex;flex-direction:column;align-items:flex-start;gap:1px;width:100%;text-align:left;padding:7px 10px;border:0;border-bottom:1px solid #f0f0f0;background:#fff;cursor:pointer">
          <span style="font-size:13px;font-weight:600;color:#111b21">${esc(d.contact_name || d.title || 'Contato')}</span>
          <span style="font-size:11px;color:#888">${esc(d.contact_phone)}</span>
        </button>`).join('');
      resultsBox.style.display = 'block';
      resultsBox.querySelectorAll('.fp-inbox-result').forEach((b) => {
        b.addEventListener('click', () => openContact(matches[Number(b.getAttribute('data-i'))]));
        b.addEventListener('mouseenter', () => { b.style.background = '#f5f6f6'; });
        b.addEventListener('mouseleave', () => { b.style.background = '#fff'; });
      });
    };

    const trigger = async () => {
      const raw = input.value.trim();
      if (!raw) return;
      if (looksLikeNumber(raw)) {
        const p = digits(raw);
        if (p.length < 10) { toast('Número inválido — inclua DDD (ex: 11999999999)', true); return; }
        closeResults();
        const full = p.startsWith('55') ? p : '55' + p;
        await openByNumberInApp(full);
        return;
      }
      // Nome: se só 1 bate, abre direto; senão mostra a lista pra escolher.
      const q = normalizeNameForMatch(raw);
      const matches = deals.filter((d) => d.contact_phone && normalizeNameForMatch(d.contact_name || d.title || '').includes(q));
      if (matches.length === 1) { await openContact(matches[0]); return; }
      searchByName(raw);
    };

    // Busca ao vivo enquanto digita um nome (não dispara pra número).
    input.addEventListener('input', () => {
      const raw = input.value.trim();
      if (!raw || looksLikeNumber(raw)) { closeResults(); return; }
      searchByName(raw);
    });
    btn.addEventListener('click', trigger);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') trigger(); });
    // Fecha a lista ao clicar fora — listener ÚNICO (bindInboxNewContact roda a
    // cada render; busca os elementos por id no clique pra não acumular handlers).
    if (!window.__fpInboxOutsideBound) {
      window.__fpInboxOutsideBound = true;
      document.addEventListener('mousedown', (e) => {
        const box = document.getElementById('fp-inbox-results');
        const inp = document.getElementById('fp-inbox-phone');
        if (box && box.style.display !== 'none' && !box.contains(e.target) && e.target !== inp) {
          box.style.display = 'none'; box.innerHTML = '';
        }
      });
    }
  }

  function normalizeWhatsappPhone(phone) {
    const p = digits(phone);
    if (!p) return '';
    return p.startsWith('55') || p.length > 11 ? p : `55${p}`;
  }

  function phoneVariants(phone) {
    const full = normalizeWhatsappPhone(phone);
    const variants = new Set();
    if (full) variants.add(full);
    if (full.startsWith('55') && full.length === 13) {
      variants.add(full.slice(0, 4) + full.slice(5));
    }
    if (full.startsWith('55') && full.length === 12) {
      variants.add(full.slice(0, 4) + '9' + full.slice(4));
    }
    const raw = digits(phone);
    if (raw) variants.add(raw);
    return [...variants].filter(Boolean);
  }

  function phonesMatch(expected, actual) {
    const expectedVariants = phoneVariants(expected);
    const actualVariants = phoneVariants(actual);
    if (!expectedVariants.length || !actualVariants.length) return false;
    return expectedVariants.some((e) => actualVariants.includes(e));
  }

  function normalizeNameForMatch(name) {
    return String(name || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function namesMatch(expected, actual) {
    const a = normalizeNameForMatch(expected);
    const b = normalizeNameForMatch(actual);
    if (!a || !b) return false;
    if (a.length < 3 || b.length < 3) return false;
    if (a === b) return true;
    // Comparação por PALAVRA INTEIRA — nunca substring. Assim "Ana" casa com
    // "Ana Silva", mas NÃO com "Luana"/"Mariana"/"Joana". Todos os tokens do
    // nome mais curto precisam existir como palavra no mais longo, e ao menos
    // um token com 3+ letras (evita casar só por "de"/"da").
    const at = a.split(' ').filter(Boolean);
    const bt = b.split(' ').filter(Boolean);
    const [short, long] = at.length <= bt.length ? [at, bt] : [bt, at];
    const longSet = new Set(long);
    return short.every((t) => longSet.has(t)) && short.some((t) => t.length >= 3);
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
    const wantName = normalizeNameForMatch(contactName);
    const items = chatListItems();

    // 1) Match por TELEFONE — autoritativo. Extrai o número real do item
    //    (JID / título / aria-label) e compara com phonesMatch (trata o 9º
    //    dígito). NÃO usamos mais "includes" do final de 8 dígitos no texto da
    //    linha, que casava por engano com dígitos da última mensagem/horário.
    for (const item of items) {
      const itemPhone = extractPhoneFromChatListItem(item);
      if (itemPhone && phonesMatch(phoneFull, itemPhone)) return item;
    }

    // 2) Fallback por NOME — SOMENTE igualdade exata do título da conversa.
    //    Substring é proibido: "Ana" não pode abrir "Luana"/"Mariana"/"Joana".
    //    (era a causa de clicar num card e abrir a conversa de outra pessoa.)
    if (wantName && wantName.length >= 3) {
      for (const item of items) {
        const titleEl = item.querySelector('span[title]');
        const itemName = normalizeNameForMatch(titleEl?.getAttribute('title') || titleEl?.textContent || '');
        if (itemName && itemName === wantName) return item;
      }
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

      // Poll em vez de espera fixa: detecta o chat aberto o quanto antes
      // (caso comum ~300-600ms; antes era sempre 1400ms). Total máx ~2.6s,
      // mais tolerante que o sleep antigo em conexões lentas.
      const tail = phoneFull.slice(-8);
      for (let i = 0; i < 12; i++) {
        await sleep(i < 4 ? 150 : 250);
        const openedPhone = digits(getWAChatPhone() || '');
        if (openedPhone && openedPhone.endsWith(tail)) {
          toast('Conversa aberta');
          return true;
        }
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

    // 1) Se a conversa já está visível na lista, clica direto (instantâneo).
    const visibleItem = findChatItem(phoneFull, contactName);
    if (visibleItem) {
      hideKanban();
      simulateRealClick(visibleItem);
      toast('Conversa aberta');
      return true;
    }

    // 2) Abre PELO NÚMERO, via a rota interna do WhatsApp Web (/send?phone=),
    //    SEM digitar na busca. É o caminho principal — confiável e não depende
    //    de achar o contato pelo nome.
    hideKanban();
    if (phoneFull && await tryOpenSendRouteInApp(phoneFull)) return true;

    // 3) Fallback: busca interna do WhatsApp (caso a rota por número falhe).
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
      // Sem barra de busca: tenta abrir/criar a conversa pelo número.
      if (phoneFull && await openNewChatViaCompose(phoneFull)) {
        toast('Conversa aberta');
        return true;
      }
      toast('Não achei a barra de busca do WhatsApp. Tente recarregar.', true);
      return false;
    }

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
    // Último recurso: cria conversa nova via UI "Nova conversa"
    if (phoneFull && await openNewChatViaCompose(phoneFull)) {
      toast('Conversa aberta');
      return true;
    }

    toast('Não encontrei essa conversa no WhatsApp sem recarregar.', true);
    return false;
  }

  // Filtro de responsável: '' = todos; 'none' = sem ninguém; senão = id do membro.
  function matchesAssignee(d) {
    if (!kanbanAssignee) return true;
    if (kanbanAssignee === 'none') return !d.assigned_to;
    return d.assigned_to === kanbanAssignee;
  }

  function matches(d) {
    if (!matchesPeriod(d) || !matchesAssignee(d)) return false;
    if (!q) return true;
    const txt = `${d.contact_name || d.title || ''} ${d.contact_phone || ''} ${getDealShootType(d)}`.toLowerCase();
    return txt.includes(q);
  }

  // Monta os chips de filtro por responsável (Todos / cada vendedor / Sem ninguém),
  // mutuamente exclusivos. Reaproveita o estilo dos chips de período.
  function renderAssigneeFilter() {
    const el = document.getElementById('fp-kpi-assignee');
    if (!el) return;
    if (!teamMembers.length) { el.innerHTML = ''; return; }
    const chip = (val, label) =>
      `<button class="fp-kpi-chip${kanbanAssignee === val ? ' fp-kpi-chip-active' : ''}" data-assignee="${esc(val)}">${esc(label)}</button>`;
    el.innerHTML =
      `<span class="fp-kpi-period-label">Responsável:</span>` +
      chip('', 'Todos') +
      teamMembers.map((m) => chip(m.id, m.name)).join('') +
      chip('none', 'Sem ninguém');
    el.querySelectorAll('.fp-kpi-chip').forEach((b) => {
      b.addEventListener('click', () => {
        kanbanAssignee = b.getAttribute('data-assignee') || '';
        renderBoard();
      });
    });
  }

  // Retorna {from, to} (Date objects) do filtro atual; null se 'all'
  function getKanbanPeriodRange() {
    if (kanbanPeriod === 'all') return null;
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (kanbanPeriod === 'today') {
      const end = new Date(today); end.setDate(end.getDate() + 1);
      return { from: today, to: end };
    }
    if (kanbanPeriod === '7d') {
      const from = new Date(today); from.setDate(from.getDate() - 6);
      const to = new Date(today); to.setDate(to.getDate() + 1);
      return { from, to };
    }
    if (kanbanPeriod === '30d') {
      const from = new Date(today); from.setDate(from.getDate() - 29);
      const to = new Date(today); to.setDate(to.getDate() + 1);
      return { from, to };
    }
    if (kanbanPeriod === 'custom' && kanbanCustomRange) {
      const from = new Date(kanbanCustomRange.from + 'T00:00:00');
      const to = new Date(kanbanCustomRange.to + 'T00:00:00');
      to.setDate(to.getDate() + 1);
      return { from, to };
    }
    return null;
  }

  function matchesPeriod(d) {
    const range = getKanbanPeriodRange();
    if (!range) return true;
    if (!d.created_at) return false;
    const t = new Date(d.created_at).getTime();
    return t >= range.from.getTime() && t < range.to.getTime();
  }

  function renderKpi() {
    const totalEl = document.getElementById('fp-kpi-total');
    if (!totalEl) return;

    // Aplica período + responsável (não a busca) — KPI reflete o filtro ativo
    const inPeriod = deals.filter((d) => matchesPeriod(d) && matchesAssignee(d));
    const stageById = new Map(stages.map((s) => [s.id, s]));
    const isWonStage = (s) => s && s.is_final && s.is_won;
    const isLostStage = (s) => s && s.is_final && !s.is_won;

    const total = inPeriod.length;
    const won = inPeriod.filter((d) => isWonStage(stageById.get(d.stage))).length;
    const lost = inPeriod.filter((d) => isLostStage(stageById.get(d.stage))).length;
    const open = total - won - lost;
    const closed = won + lost;
    const conv = closed > 0 ? Math.round((won / closed) * 100) : 0;

    totalEl.textContent = total;
    document.getElementById('fp-kpi-open').textContent = open;
    document.getElementById('fp-kpi-won').textContent = won;
    document.getElementById('fp-kpi-lost').textContent = lost;
    document.getElementById('fp-kpi-conv').textContent = closed > 0 ? `${conv}%` : '—';

    // Estado visual dos chips de PERÍODO (escopo no #fp-kpi-period pra não mexer
    // nos chips de responsável, que têm seu próprio destaque em renderAssigneeFilter).
    document.querySelectorAll('#fp-kpi-period .fp-kpi-chip').forEach((b) => {
      b.classList.toggle('fp-kpi-chip-active', b.getAttribute('data-period') === kanbanPeriod);
    });

    // Label de range customizado
    const rangeLabel = document.getElementById('fp-kpi-range-label');
    if (rangeLabel) {
      if (kanbanPeriod === 'custom' && kanbanCustomRange) {
        const f = new Date(kanbanCustomRange.from + 'T00:00:00').toLocaleDateString('pt-BR');
        const t = new Date(kanbanCustomRange.to + 'T00:00:00').toLocaleDateString('pt-BR');
        rangeLabel.textContent = `${f} → ${t}`;
        rangeLabel.style.display = '';
      } else {
        rangeLabel.style.display = 'none';
      }
    }
  }

  function openCustomRangePicker() {
    document.getElementById('fp-kpi-custom-pop')?.remove();
    const btn = document.querySelector('.fp-kpi-chip-custom');
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const today = new Date().toISOString().slice(0, 10);
    const monthAgo = new Date(); monthAgo.setDate(monthAgo.getDate() - 30);
    const from = kanbanCustomRange?.from || monthAgo.toISOString().slice(0, 10);
    const to = kanbanCustomRange?.to || today;
    const pop = document.createElement('div');
    pop.id = 'fp-kpi-custom-pop';
    pop.style.left = `${rect.left}px`;
    pop.style.top = `${rect.bottom + 6}px`;
    pop.innerHTML = `
      <div class="fp-kpi-pop-row">
        <label>De <input type="date" id="fp-kpi-pop-from" value="${from}" /></label>
        <label>Até <input type="date" id="fp-kpi-pop-to" value="${to}" /></label>
      </div>
      <div class="fp-kpi-pop-row">
        <button class="fp-btn-w" id="fp-kpi-pop-cancel">Cancelar</button>
        <button class="fp-btn-g" id="fp-kpi-pop-apply">Aplicar</button>
      </div>
    `;
    document.body.appendChild(pop);
    const close = () => {
      pop.remove();
      document.removeEventListener('mousedown', onDoc, true);
    };
    const onDoc = (e) => { if (!pop.contains(e.target) && !btn.contains(e.target)) close(); };
    pop.querySelector('#fp-kpi-pop-cancel').addEventListener('click', close);
    pop.querySelector('#fp-kpi-pop-apply').addEventListener('click', () => {
      const f = pop.querySelector('#fp-kpi-pop-from').value;
      const t = pop.querySelector('#fp-kpi-pop-to').value;
      if (!f || !t || f > t) return toast('Faixa de datas inválida.', true);
      kanbanCustomRange = { from: f, to: t };
      kanbanPeriod = 'custom';
      close();
      renderBoard();
    });
    setTimeout(() => document.addEventListener('mousedown', onDoc, true), 0);
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

  // ===== TIPOS DE ENSAIO (lista mestre) =====
  // Vem do app (Configurações → Oportunidades → "Tipos de ensaio e valor
  // mínimo"). Carregada 1x no init; se a API falhar ou estiver vazia, cai na
  // lista padrão abaixo (a mesma do app).
  const DEFAULT_TIPOS_ENSAIO = ['Gestante', 'Newborn', 'Acompanhamento', 'Smash the Cake', 'Aniversário', 'Família', 'Casamento', 'Batizado', 'Corporativo', 'Ensaio Externo', 'Marca Pessoal', 'Outros'];
  let tiposEnsaioCache = null;

  function getTiposEnsaio() {
    return (Array.isArray(tiposEnsaioCache) && tiposEnsaioCache.length > 0)
      ? tiposEnsaioCache
      : DEFAULT_TIPOS_ENSAIO;
  }

  async function loadTiposEnsaio() {
    try {
      const rows = await bg({ type: 'GET_TIPOS_ENSAIO' });
      const nomes = (Array.isArray(rows) ? rows : [])
        .map((r) => String(r?.tipo_nome || '').trim())
        .filter(Boolean);
      if (nomes.length > 0) tiposEnsaioCache = nomes;
    } catch {
      /* mantém o fallback padrão */
    }
  }

  function card(d, c) {
    const name = d.contact_name || d.title || 'Sem nome';
    const phone = d.contact_phone || '';
    const photo = getCachedContactPhoto(phone);
    const type = getDealShootType(d);
    const phoneLabel = phone ? `+${digits(phone).replace(/(\d{2})(\d{2})(\d{5})(\d{4})/, '$1 ($2) $3-$4')}` : '';
    const sub = [type, phoneLabel || stripDealMetaFromNotes(d.notes)?.substring(0, 40)].filter(Boolean).join(' · ');
    // Alerta de tempo parado só em etapas ABERTAS: card em ganho/perda já
    // fechou — não há ação a tomar, então não fica amarelo/vermelho.
    const dealStage = stages.find(s => s.id === d.stage);
    const st = dealStage?.is_final ? null : staleness(d.current_stage_entered_at);
    const avatarInner = photo
      ? `<div class="fpc-av fpc-av-img"><img src="${esc(photo)}" alt="" /></div>`
      : `<div class="fpc-av" style="background:${c.dot}">${esc(initials(name))}</div>`;
    const unreadCount = getUnreadForDeal(d);
    const unreadBadge = unreadCount > 0
      ? `<span class="fpc-unread-count" title="${unreadCount} não lida${unreadCount > 1 ? 's' : ''}">${unreadCount > 99 ? '99+' : unreadCount}</span>`
      : '';
    const avatar = `<div class="fpc-av-wrap">${avatarInner}${unreadBadge}${st ? `<span class="fpc-stale-dot fpc-stale-dot-${st}"></span>` : ''}</div>`;
    const staleTag = st
      ? `<span class="fpc-stale-tag fpc-stale-tag-${st}" title="Parado nesta etapa há ${st === 'urgent' ? '24h ou mais' : '12h ou mais'}">${st === 'urgent' ? '+24h' : '+12h'}</span>`
      : '';
    const seller = d.assigned_to ? teamMembers.find(m => m.id === d.assigned_to) : null;
    const sellerBadge = seller
      ? `<span class="fpc-seller" style="background:${esc(seller.color || '#6366f1')}" title="${esc(seller.name)}">${esc(initials(seller.name))}</span>`
      : '';
    return `
      <div class="fpc-card${st ? ` fpc-stale-${st}` : ''}" data-id="${d.id}" data-phone="${esc(phone)}">
        <div class="fpc-card-top">
          ${avatar}
          <div class="fpc-info">
            <div class="fpc-name">${esc(name)}</div>
            <div class="fpc-sub">${esc(sub)}</div>
          </div>
          <div class="fpc-date">${staleTag}<span>${fmtDate(d.updated_at || d.created_at)}</span></div>
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

  // Popup da conversa removido: reenquadrar o #main do WhatsApp como
  // popup não é viável de forma estável (briga com o layout/React do
  // WhatsApp). O card do funil abre a conversa normal.

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
      fastDetect();
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
      else if (kind === 'job') moveJobToProductionStage(id, overZone.dataset.stageId);
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
  function findWhatsappComposer() {
    return (
      document.querySelector('#main footer div[contenteditable="true"]') ||
      document.querySelector('div[role="textbox"][contenteditable="true"][data-tab]') ||
      document.querySelector('footer [contenteditable="true"]')
    );
  }

  function findWhatsappComposers() {
    return [
      ...document.querySelectorAll('#main footer div[contenteditable="true"], footer [contenteditable="true"]'),
    ].filter(Boolean);
  }

  function selectEditableContents(el) {
    const sel = window.getSelection?.();
    if (!sel) return;
    const range = document.createRange();
    range.selectNodeContents(el);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function placeCursorAtEnd(el) {
    const sel = window.getSelection?.();
    if (!sel) return;
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function notifyComposerInput(composer, text, inputType = 'insertText') {
    try {
      composer.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        composed: true,
        inputType,
        data: text || null,
      }));
    } catch {
      composer.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  function clearWhatsappComposer(composer) {
    composer.focus();
    document.execCommand('selectAll', false, null);
    document.execCommand('delete', false, null);
    selectEditableContents(composer);
    document.execCommand('delete', false, null);
    composer.textContent = '';
    composer.innerHTML = '';
    notifyComposerInput(composer, '', 'deleteContentBackward');
  }

  function setComposerDomWithBreaks(composer, text) {
    const lines = String(text).split('\n');
    composer.textContent = '';
    lines.forEach((line, idx) => {
      if (idx > 0) composer.appendChild(document.createElement('br'));
      composer.appendChild(document.createTextNode(line));
    });
    placeCursorAtEnd(composer);
  }

  function composerPreservedLineBreaks(composer, text) {
    if (!String(text).includes('\n')) return true;
    const visibleText = String(composer.innerText || composer.textContent || '')
      .replace(/\u00a0/g, ' ')
      .replace(/\r\n?/g, '\n');
    return visibleText.includes('\n') || !!composer.querySelector('br');
  }

  function composerPlainText(composer) {
    let out = '';
    const walk = (node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        out += node.nodeValue || '';
        return;
      }
      if (node.nodeName === 'BR') {
        out += '\n';
        return;
      }
      node.childNodes?.forEach(walk);
    };
    walk(composer);
    return out || String(composer.innerText || composer.textContent || '');
  }

  function composerMatchesText(composer, text) {
    const expected = String(text || '').replace(/\r\n?/g, '\n').trim();
    const actual = String(composerPlainText(composer))
      .replace(/\u00a0/g, ' ')
      .replace(/\r\n?/g, '\n')
      .trim();
    const compactExpected = expected.replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n');
    const compactActual = actual.replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n');
    return compactActual === compactExpected;
  }

  function compareMessageText(text) {
    return String(text || '')
      .replace(/\r\n?/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n[ \t]+/g, '\n')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function collapseRepeatedMessage(text) {
    let current = String(text || '').replace(/\r\n?/g, '\n').trim();
    for (let pass = 0; pass < 3; pass += 1) {
      const len = current.length;
      let changed = false;
      for (let i = 1; i < len; i += 1) {
        const left = current.slice(0, i).trim();
        const right = current.slice(i).trim();
        if (!left || !right) continue;
        if (compareMessageText(left) !== compareMessageText(right)) continue;
        const leftBreaks = (left.match(/\n/g) || []).length;
        const rightBreaks = (right.match(/\n/g) || []).length;
        current = rightBreaks > leftBreaks ? right : left;
        changed = true;
        break;
      }
      if (!changed) break;
    }
    return current;
  }

  async function setWhatsappComposer(text) {
    const normalized = collapseRepeatedMessage(text);
    if (!normalized) return false;
    const composers = findWhatsappComposers();
    const composer = findWhatsappComposer() || composers[0];
    if (!composer) return false;

    // O WhatsApp Web às vezes mantém estado interno depois de uma inserção via
    // execCommand. Limpamos todos os editáveis do rodapé e escrevemos uma vez só.
    (composers.length ? composers : [composer]).forEach(clearWhatsappComposer);
    await sleep(80);
    composer.focus();
    setComposerDomWithBreaks(composer, normalized);
    notifyComposerInput(composer, normalized);
    await sleep(80);

    const ok = composerMatchesText(composer, normalized) && composerPreservedLineBreaks(composer, normalized);
    if (!ok) {
      (composers.length ? composers : [composer]).forEach(clearWhatsappComposer);
    }
    return ok;
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
  let massQueue = null; // { deals: [], message: string, idx: 0, apiSend: boolean }

  function openMassFollowUpModal(stage, customDeals = null) {
    document.getElementById('fp-mass-modal')?.remove();
    // Respeita o filtro ATIVO do board (responsável + período + busca) via
    // matches(): se o Luan filtra "Responsável: Luan", o disparo em massa só vai
    // pros leads DELE naquela etapa — não pra todo mundo.
    const stageDeals = (customDeals || deals.filter(d => d.stage === stage.id && matches(d)))
      .filter(d => d.contact_phone);
    if (!stageDeals.length) return toast('Nenhum lead com telefone pro filtro atual', true);

    const template = collapseRepeatedMessage(stage.follow_up_message || '') || `Oi {nome}, tudo bem? Passando pra ver se você tem alguma dúvida 😊`;
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
            <div class="fp-mass-label-row">
              <label class="fp-mass-label">Mensagem</label>
              <button type="button" class="fp-mass-link" id="fp-mass-save-default">Salvar como padrão da etapa</button>
            </div>
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

        <div class="fp-mass-auto-row">
          <label class="fp-mass-auto-label">
            <input type="checkbox" id="fp-mass-auto" />
            <span>Enviar automaticamente</span>
            <span class="fp-mass-auto-hint">(${singleMode ? 'envia direto sem pedir confirmação' : 'manda pra todos com intervalo de 4s entre cada'})</span>
          </label>
          <label class="fp-mass-auto-label">
            <input type="checkbox" id="fp-mass-move-next" checked />
            <span>Mover para a próxima etapa após enviar</span>
            <span class="fp-mass-auto-hint">(nunca move pra ganho/perda)</span>
          </label>
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
    bindOverlayClose(modal, close);
    modal.querySelector('#fp-mass-close')?.addEventListener('click', close);
    modal.querySelector('#fp-mass-cancel')?.addEventListener('click', close);

    // Salva o texto atual como mensagem padrão de follow-up da etapa.
    modal.querySelector('#fp-mass-save-default')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const msg = collapseRepeatedMessage(textarea.value);
      if (!msg) return toast('Mensagem vazia', true);
      if (msg !== textarea.value.trim()) {
        textarea.value = msg;
        updatePreview();
      }
      const original = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Salvando…';
      try {
        await bg({ type: 'SAVE_STAGE_FOLLOWUP', stageId: stage.id, text: msg });
        stage.follow_up_message = msg;
        btn.textContent = '✓ Salvo como padrão';
        setTimeout(() => { btn.textContent = original; btn.disabled = false; }, 2500);
      } catch (err) {
        toast(err?.message || 'Erro ao salvar', true);
        btn.textContent = original;
        btn.disabled = false;
      }
    });

    modal.querySelector('#fp-mass-start')?.addEventListener('click', () => {
      const message = collapseRepeatedMessage(textarea.value);
      if (!message) return toast('Mensagem vazia', true);
      if (message !== textarea.value.trim()) {
        textarea.value = message;
        updatePreview();
      }
      const selected = singleMode
        ? stageDeals
        : Array.from(modal.querySelectorAll('.fp-mass-chk:checked'))
            .map((c) => stageDeals.find(d => String(d.id) === c.getAttribute('data-deal-id')))
            .filter(Boolean);
      if (!selected.length) return toast('Selecione pelo menos 1 lead', true);
      const autoSend = modal.querySelector('#fp-mass-auto')?.checked || false;
      const moveNext = modal.querySelector('#fp-mass-move-next')?.checked || false;
      close();
      startMassFollowUpQueue(selected, message, autoSend, moveNext);
    });
  }

  async function startMassFollowUpQueue(targetDeals, template, autoSend = false, moveNext = false) {
    let apiSend = false;
    if (autoSend) {
      try {
        const status = await bg({ type: 'GET_WHATSAPP_STATUS' });
        apiSend = status?.connected === true || status?.whatsapp?.connected === true;
      } catch {}
    }
    massQueue = { deals: targetDeals, message: collapseRepeatedMessage(template), idx: 0, autoSend, apiSend, moveNext };
    showMassQueueWidget(autoSend);
    await openCurrentMassQueueLead();
  }

  // Após follow-up confirmado: avança o lead pra PRÓXIMA etapa aberta.
  // Nunca move pra etapa final (ganho/perda) — fechamento é decisão manual.
  // Fire-and-forget: erro aqui não interrompe a fila de envios.
  function moveMassLeadToNextStage(deal) {
    try {
      const ordered = orderedStages(stages);
      const curIdx = ordered.findIndex(s => s.id === deal.stage);
      const cur = curIdx >= 0 ? ordered[curIdx] : null;
      if (!cur || cur.is_final) return;
      const next = ordered.find((s, i) => i > curIdx && !s.is_final);
      if (!next) return; // já está na última etapa aberta
      deal.stage = next.id;
      deal.current_stage_entered_at = new Date().toISOString();
      bg({ type: 'MOVE_STAGE', dealId: deal.id, stageId: next.id })
        .then(() => toast(`→ ${firstNameOf(deal) || 'Lead'} movido pra "${next.name}"`))
        .catch(() => {});
    } catch { /* não interrompe a fila */ }
  }

  function showMassQueueWidget(autoSend) {
    document.getElementById('fp-mass-widget')?.remove();
    const w = document.createElement('div');
    w.id = 'fp-mass-widget';
    w.innerHTML = `
      <div class="fp-mw-info">
        <div class="fp-mw-title">${autoSend ? 'Enviando automaticamente' : 'Follow-up em massa'}</div>
        <div class="fp-mw-prog" id="fp-mw-prog">—</div>
      </div>
      ${autoSend ? '' : '<button class="fp-mw-btn fp-mw-skip" id="fp-mw-skip">Pular</button>'}
      ${autoSend ? '' : '<button class="fp-mw-btn fp-mw-next" id="fp-mw-next">Próximo →</button>'}
      <button class="fp-mw-btn fp-mw-stop" id="fp-mw-stop" title="Parar fila">✕ Parar</button>
    `;
    document.body.appendChild(w);
    w.querySelector('#fp-mw-next')?.addEventListener('click', () => advanceMassQueue(false));
    w.querySelector('#fp-mw-skip')?.addEventListener('click', () => advanceMassQueue(true));
    w.querySelector('#fp-mw-stop')?.addEventListener('click', stopMassQueue);
  }

  // Tenta clicar no botão "Enviar" do WhatsApp Web. Cobre versões com
  // aria-label "Enviar", ícone data-icon="send" e fallback de Enter no composer.
  function clickWhatsappSendButton() {
    const candidates = [
      '#main footer [aria-label*="Enviar" i]',
      '#main footer [aria-label*="Send" i]',
      '#main footer [data-icon="send"]',
      '#main footer [data-tab="11"]',
      '#main [data-testid="compose-btn-send"]',
    ];
    for (const sel of candidates) {
      const btn = document.querySelector(sel);
      const real = btn?.closest('button, [role="button"]') || btn;
      if (real) { simulateRealClick(real); return true; }
    }
    // Fallback: dispara Enter no composer
    const composer =
      document.querySelector('#main footer div[contenteditable="true"]') ||
      document.querySelector('footer [contenteditable="true"]');
    if (composer) {
      composer.focus();
      const ev = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true });
      composer.dispatchEvent(ev);
      return true;
    }
    return false;
  }

  function updateMassWidget() {
    const prog = document.getElementById('fp-mw-prog');
    if (!prog || !massQueue) return;
    const cur = massQueue.deals[massQueue.idx];
    const name = cur ? (cur.contact_name || cur.title || cur.contact_phone) : '—';
    prog.innerHTML = `${massQueue.idx + 1}/${massQueue.deals.length} · <strong>${esc(name)}</strong>`;
  }

  async function waitForExpectedChat(deal, maxMs = 2800) {
    const expectedPhone = deal?.contact_phone || '';
    const expectedName = deal?.contact_name || deal?.title || '';
    const started = Date.now();
    let sawDifferentPhone = '';
    let lastName = '';

    while (Date.now() - started < maxMs) {
      await sleep(160);
      const openedPhone = getWAChatPhone();
      const openedName = getWAChatName();
      if (openedName) lastName = openedName;

      if (openedPhone) {
        if (phonesMatch(expectedPhone, openedPhone)) {
          return { ok: true, confidence: 'phone', openedPhone, openedName };
        }
        sawDifferentPhone = openedPhone;
      }

      if (!openedPhone && expectedName && openedName && namesMatch(expectedName, openedName)) {
        return { ok: true, confidence: 'name', openedPhone, openedName };
      }
    }

    return {
      ok: false,
      openedPhone: sawDifferentPhone,
      openedName: lastName,
      reason: sawDifferentPhone
        ? `Conversa aberta não bate com o telefone esperado (${sawDifferentPhone})`
        : 'Não consegui confirmar a conversa aberta',
    };
  }

  async function sendMassFollowupViaApi(deal, msg) {
    const phone = deal?.contact_phone || '';
    if (!phone) throw new Error('Lead sem telefone');
    return bg({ type: 'SEND_WHATSAPP_TEXT', phone, text: msg });
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

    if (massQueue?.autoSend && massQueue?.apiSend) {
      try {
        await sendMassFollowupViaApi(deal, msg);
        toast(`✓ Enviado com segurança pra ${first || deal.contact_phone}`);
        await sleep(1600);
        if (!massQueue) return;
        advanceMassQueue(false);
      } catch (err) {
        toast(err?.message || 'Falha no envio seguro — parei a fila', true);
        stopMassQueue();
      }
      return;
    }

    const ok = await openByNumberInApp(deal.contact_phone, deal.contact_name || '');
    if (!ok) {
      // Falhou em abrir o chat — em modo auto, pula pro próximo
      if (massQueue?.autoSend) {
        await sleep(800);
        advanceMassQueue(true);
      }
      return;
    }

    const checked = await waitForExpectedChat(deal);
    if (!checked.ok) {
      toast(`Travei por segurança: ${checked.reason}`, true);
      stopMassQueue();
      return;
    }

    let composed = false;
    for (let i = 0; i < 12; i++) {
      await sleep(180);
      if (await setWhatsappComposer(msg)) { composed = true; break; }
    }
    if (!composed) {
      toast('Não consegui colar a mensagem — pulando…', true);
      if (massQueue?.autoSend) {
        await sleep(800);
        advanceMassQueue(true);
      }
      return;
    }

    if (massQueue?.autoSend) {
      // Pequeno delay pro user ver a mensagem antes de disparar
      await sleep(1200);
      if (!massQueue) return; // user pode ter parado
      const sent = clickWhatsappSendButton();
      if (sent) {
        toast(`✓ Enviado pra ${first || deal.contact_phone}`);
      } else {
        toast('Não consegui clicar em Enviar — pare a fila e veja', true);
        stopMassQueue();
        return;
      }
      // Aguarda antes de pular pro próximo (anti-spam do WhatsApp)
      await sleep(4000);
      if (!massQueue) return;
      advanceMassQueue(false);
    } else {
      toast('Revise e envie. Depois clique "Próximo →"');
    }
  }

  async function advanceMassQueue(skipped) {
    if (!massQueue) return;
    // Envio confirmado (não pulado): move o lead pra próxima etapa, se ligado.
    // Cobre os 3 caminhos — API, auto-clique e manual (botão "Próximo →").
    if (!skipped && massQueue.moveNext) {
      const sentDeal = massQueue.deals[massQueue.idx];
      if (sentDeal) moveMassLeadToNextStage(sentDeal);
    }
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
          source: 'WhatsApp',
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
    document.querySelectorAll('.fp-rail-btn, .fp-rail-nat-btn').forEach((b) => b.classList.remove('fp-rail-active'));
    if (id) document.getElementById(id)?.classList.add('fp-rail-active');
  }

  // Esconde TODOS os overlays do app pra não ter dois aparecendo ao mesmo tempo
  function hideAllOverlays() {
    document.getElementById('fp-kanban')?.classList.add('fp-hidden');
    document.getElementById('fp-agenda')?.classList.add('fp-hidden');
    document.getElementById('fp-tasks')?.classList.add('fp-hidden');
    document.getElementById('fp-production')?.classList.add('fp-hidden');
    // Tarefas é o único que afeta o layout do WA (painel lateral) —
    // tira a classe pra liberar o #main de volta ao tamanho normal
    document.body.classList.remove('fp-tasks-open');
  }

  function hideKanban() {
    kanbanVisible = false;
    document.getElementById('fp-kanban')?.classList.add('fp-hidden');
    document.body.classList.remove('fp-kanban-open');
    adjustPosition();
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
    document.body.classList.add('fp-kanban-open');
    adjustPosition();
    hideAllOverlays();
    document.getElementById('fp-kanban')?.classList.remove('fp-hidden');
    setRailActive('fp-rail-pipeline');
    // A faixa do chat tem z-index altíssimo e cobriria o cabeçalho do funil
    removeChatStrip();
    // Abre o funil INSTANTÂNEO com o cache, e atualiza em segundo plano.
    if (deals.length || stages.length) {
      renderBoard();
      loadKanban({ silent: true });
    } else {
      loadKanban();
    }
  }

  // ===== AGENDA =====
  // view: 'month' | 'week' | 'day'
  // anchor: data de referência (Date) — usada pra calcular mês/semana/dia visível
  const _now = new Date();
  let agendaState = { view: 'month', anchor: new Date(_now.getFullYear(), _now.getMonth(), _now.getDate()), events: [] };
  let agendaTimeLineInterval = null;

  function buildAgendaOverlay() {
    if (document.getElementById('fp-agenda')) return;
    const el = document.createElement('div');
    el.id = 'fp-agenda';
    el.className = 'fp-hidden';
    el.innerHTML = `
      <div id="fp-ag-h">
        <button id="fp-ag-prev" title="Anterior" class="fp-ag-nav">‹</button>
        <button id="fp-ag-next" title="Próximo" class="fp-ag-nav">›</button>
        <button id="fp-ag-today">Hoje</button>
        <h3 id="fp-ag-title">—</h3>
        <div style="flex:1"></div>
        <div id="fp-ag-views">
          <button class="fp-ag-view-btn" data-view="month">Mês</button>
          <button class="fp-ag-view-btn" data-view="week">Semana</button>
          <button class="fp-ag-view-btn" data-view="day">Dia</button>
        </div>
        <button id="fp-ag-refresh" class="fp-icon-btn" title="Atualizar">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>
        </button>
        <button id="fp-ag-back-pipeline" title="Voltar pro Pipeline">⬡ Pipeline</button>
      </div>
      <div id="fp-ag-content"></div>
    `;
    document.body.appendChild(el);
    el.querySelector('#fp-ag-prev')?.addEventListener('click', () => navigateAgenda(-1));
    el.querySelector('#fp-ag-next')?.addEventListener('click', () => navigateAgenda(1));
    el.querySelector('#fp-ag-today')?.addEventListener('click', () => {
      const n = new Date();
      agendaState.anchor = new Date(n.getFullYear(), n.getMonth(), n.getDate());
      loadAgenda();
    });
    el.querySelectorAll('.fp-ag-view-btn').forEach((b) => {
      b.addEventListener('click', () => {
        const v = b.getAttribute('data-view');
        if (v === agendaState.view) return;
        agendaState.view = v;
        loadAgenda();
      });
    });
    el.querySelector('#fp-ag-refresh')?.addEventListener('click', loadAgenda);
    el.querySelector('#fp-ag-back-pipeline')?.addEventListener('click', showKanban);
  }

  function navigateAgenda(delta) {
    const d = new Date(agendaState.anchor);
    if (agendaState.view === 'month') {
      d.setMonth(d.getMonth() + delta);
    } else if (agendaState.view === 'week') {
      d.setDate(d.getDate() + delta * 7);
    } else {
      d.setDate(d.getDate() + delta);
    }
    agendaState.anchor = d;
    loadAgenda();
  }

  async function loadAgenda() {
    buildAgendaOverlay();

    // Atualiza botão de view ativo
    document.querySelectorAll('.fp-ag-view-btn').forEach((b) => {
      b.classList.toggle('fp-ag-view-active', b.getAttribute('data-view') === agendaState.view);
    });

    // Atualiza título conforme view
    const titleEl = document.getElementById('fp-ag-title');
    if (titleEl) titleEl.textContent = formatAgendaTitle();

    // Determina range de meses pra buscar (semana e dia podem cruzar mês)
    const rangeMonths = monthsToFetch();
    try {
      const results = await Promise.all(rangeMonths.map((rm) =>
        bg({ type: 'GET_AGENDA', year: rm.year, month: rm.month }).catch(() => ({ events: [] }))
      ));
      const merged = [];
      results.forEach((r) => (r?.events || []).forEach((e) => merged.push(e)));
      // Dedup por id
      const seen = new Set();
      agendaState.events = merged.filter((e) => {
        if (seen.has(e.id)) return false;
        seen.add(e.id);
        return true;
      });
      console.log('[FocalPoint] agenda events:', agendaState.events.length);
    } catch (err) {
      console.error('[FocalPoint] agenda erro:', err);
      agendaState.events = [];
    }
    renderAgendaGrid();
    startAgendaTimeLineTicker();
  }

  function formatAgendaTitle() {
    const d = agendaState.anchor;
    if (agendaState.view === 'month') {
      const s = d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
      return s.charAt(0).toUpperCase() + s.slice(1);
    }
    if (agendaState.view === 'week') {
      const start = startOfWeek(d);
      const end = new Date(start); end.setDate(end.getDate() + 6);
      const sameMonth = start.getMonth() === end.getMonth();
      if (sameMonth) {
        const m = start.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
        return `${start.getDate()} – ${end.getDate()} ${m.charAt(0).toUpperCase() + m.slice(1)}`;
      }
      const a = start.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' });
      const b = end.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short', year: 'numeric' });
      return `${a} – ${b}`;
    }
    return d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }

  function monthsToFetch() {
    const d = agendaState.anchor;
    if (agendaState.view === 'month') return [{ year: d.getFullYear(), month: d.getMonth() + 1 }];
    if (agendaState.view === 'day') return [{ year: d.getFullYear(), month: d.getMonth() + 1 }];
    // Week: pega início e fim e busca os meses relevantes (1 ou 2)
    const s = startOfWeek(d);
    const e = new Date(s); e.setDate(e.getDate() + 6);
    const ms = new Set([`${s.getFullYear()}-${s.getMonth() + 1}`, `${e.getFullYear()}-${e.getMonth() + 1}`]);
    return Array.from(ms).map((k) => {
      const [y, m] = k.split('-').map(Number);
      return { year: y, month: m };
    });
  }

  function startOfWeek(d) {
    const r = new Date(d);
    r.setDate(r.getDate() - r.getDay()); // domingo = 0
    r.setHours(0, 0, 0, 0);
    return r;
  }

  function ymd(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
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
    const content = document.getElementById('fp-ag-content');
    if (!content) return;
    if (agendaState.view === 'month') return renderMonthView(content);
    if (agendaState.view === 'week') return renderWeekView(content);
    if (agendaState.view === 'day') return renderDayView(content);
  }

  function renderMonthView(content) {
    const d = agendaState.anchor;
    const year = d.getFullYear();
    const month = d.getMonth() + 1;
    content.innerHTML = `
      <div id="fp-ag-weekdays"></div>
      <div id="fp-ag-grid"></div>
      <div id="fp-ag-day-list"></div>
    `;
    const grid = document.getElementById('fp-ag-grid');
    const wkd = document.getElementById('fp-ag-weekdays');
    wkd.innerHTML = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map((d) => `<span>${d}</span>`).join('');

    const events = agendaState.events;
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

  // ─── Time grid (Semana / Dia) ─────────────────────────────────────────────
  const HOUR_HEIGHT = 48; // px por hora
  const DAY_START_HOUR = 0;
  const DAY_END_HOUR = 24;

  function parseTimeToMinutes(t) {
    if (!t) return null;
    const m = String(t).match(/^(\d{1,2}):(\d{2})/);
    if (!m) return null;
    return Number(m[1]) * 60 + Number(m[2]);
  }

  // Total de "linhas de hora" visíveis (00:00 → 23:00). Não rendemos o slot
  // entre 23:00 e meia-noite pra não deixar aquele espaço vazio no rodapé.
  const VISIBLE_HOURS = 23;

  function eventToBlock(ev) {
    const startMin = parseTimeToMinutes(ev.time) ?? (9 * 60); // 9h default se sem hora
    const endMin = ev.end_time ? (parseTimeToMinutes(ev.end_time) ?? startMin + 60) : startMin + 60;
    // Clamp pra não estourar do grid (eventos a partir de 23h ficam comprimidos no fim)
    const maxMin = VISIBLE_HOURS * 60;
    const clampedTop = Math.min(startMin, maxMin - 15);
    const clampedSpan = Math.min(endMin - clampedTop, maxMin - clampedTop);
    return {
      top: (clampedTop / 60) * HOUR_HEIGHT,
      height: Math.max(22, (clampedSpan / 60) * HOUR_HEIGHT),
      startMin,
    };
  }

  function buildTimeGridColumn(dateStr, dayEvents) {
    const blocks = dayEvents
      .map((ev) => ({ ev, ...eventToBlock(ev) }))
      .sort((a, b) => a.startMin - b.startMin);

    const events = blocks.map(({ ev, top, height }) => {
      const c = agendaColor(ev.type);
      const timeStr = ev.time
        ? (ev.end_time ? `${ev.time.slice(0, 5)}–${ev.end_time.slice(0, 5)}` : ev.time.slice(0, 5))
        : '';
      return `
        <div class="fp-ag-tg-event" data-event-id="${esc(ev.id || '')}" style="top:${top}px;height:${height}px;background:${c.bg};color:${c.text};border-left:3px solid ${c.dot}">
          <div class="fp-ag-tg-event-time">${esc(timeStr)}</div>
          <div class="fp-ag-tg-event-title">${esc(ev.title || '')}</div>
          ${ev.client_name ? `<div class="fp-ag-tg-event-sub">${esc(ev.client_name)}</div>` : ''}
        </div>
      `;
    }).join('');

    return `
      <div class="fp-ag-tg-col" data-date="${esc(dateStr)}" style="height:${HOUR_HEIGHT * VISIBLE_HOURS}px">
        ${Array.from({ length: VISIBLE_HOURS }).map((_, h) => `
          <div class="fp-ag-tg-slot" data-hour="${h}" data-date="${esc(dateStr)}" style="height:${HOUR_HEIGHT}px"></div>
        `).join('')}
        ${events}
      </div>
    `;
  }

  function timeAxisColumn() {
    const html = Array.from({ length: VISIBLE_HOURS }).map((_, h) => {
      const label = h === 0 ? '' : `${String(h).padStart(2, '0')}:00`;
      return `<div class="fp-ag-tg-hour-label" style="height:${HOUR_HEIGHT}px">${label}</div>`;
    }).join('');
    // Label "23:00" fica no rodapé como marcador de fim — não ocupa altura.
    return `<div class="fp-ag-tg-axis">${html}<div class="fp-ag-tg-hour-end">${String(VISIBLE_HOURS).padStart(2, '0')}:00</div></div>`;
  }

  function eventsForDate(dateStr) {
    return (agendaState.events || [])
      .filter((e) => String(e.date).slice(0, 10) === dateStr)
      .sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99'));
  }

  function renderWeekView(content) {
    const start = startOfWeek(agendaState.anchor);
    const days = Array.from({ length: 7 }).map((_, i) => {
      const d = new Date(start); d.setDate(d.getDate() + i);
      return d;
    });
    const today = new Date(); today.setHours(0, 0, 0, 0);

    content.innerHTML = `
      <div class="fp-ag-tg-header">
        <div class="fp-ag-tg-axis-spacer"></div>
        ${days.map((d) => {
          const isToday = d.getTime() === today.getTime();
          const wk = d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '');
          return `
            <div class="fp-ag-tg-day-head ${isToday ? 'fp-ag-tg-today' : ''}" data-date="${ymd(d)}">
              <span class="fp-ag-tg-day-wk">${wk}</span>
              <span class="fp-ag-tg-day-num ${isToday ? 'fp-ag-tg-day-num-today' : ''}">${d.getDate()}</span>
            </div>
          `;
        }).join('')}
      </div>
      <div class="fp-ag-tg-scroll">
        <div class="fp-ag-tg-body">
          ${timeAxisColumn()}
          ${days.map((d) => buildTimeGridColumn(ymd(d), eventsForDate(ymd(d)))).join('')}
          <div class="fp-ag-tg-now" id="fp-ag-tg-now"></div>
        </div>
      </div>
    `;
    wireTimeGridInteractions(content);
    scrollToReasonableHour(content);
  }

  function renderDayView(content) {
    const d = agendaState.anchor;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const isToday = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() === today.getTime();
    const dStr = ymd(d);

    content.innerHTML = `
      <div class="fp-ag-tg-header fp-ag-tg-header-day">
        <div class="fp-ag-tg-axis-spacer"></div>
        <div class="fp-ag-tg-day-head ${isToday ? 'fp-ag-tg-today' : ''}">
          <span class="fp-ag-tg-day-wk">${d.toLocaleDateString('pt-BR', { weekday: 'long' })}</span>
          <span class="fp-ag-tg-day-num ${isToday ? 'fp-ag-tg-day-num-today' : ''}">${d.getDate()}</span>
        </div>
      </div>
      <div class="fp-ag-tg-scroll">
        <div class="fp-ag-tg-body fp-ag-tg-body-day">
          ${timeAxisColumn()}
          ${buildTimeGridColumn(dStr, eventsForDate(dStr))}
          <div class="fp-ag-tg-now" id="fp-ag-tg-now"></div>
        </div>
      </div>
    `;
    wireTimeGridInteractions(content);
    scrollToReasonableHour(content);
  }

  function wireTimeGridInteractions(content) {
    // Clique num slot vazio: cria novo agendamento
    content.querySelectorAll('.fp-ag-tg-slot').forEach((slot) => {
      slot.addEventListener('click', (e) => {
        // Não dispara se clicou em cima de um evento (eventos têm z-index maior)
        if (e.target.closest('.fp-ag-tg-event')) return;
        const date = slot.getAttribute('data-date');
        const hour = slot.getAttribute('data-hour');
        const time = `${String(hour).padStart(2, '0')}:00`;
        openQuickJobModal({ date, time });
      });
    });
    // Clique num evento: abre o modal em modo edição
    content.querySelectorAll('.fp-ag-tg-event').forEach((block) => {
      block.addEventListener('click', (e) => {
        e.stopPropagation();
        const eventId = block.getAttribute('data-event-id');
        const event = (agendaState.events || []).find((ev) => String(ev.id) === eventId);
        if (event) openQuickJobModal({ existing: event });
      });
    });
  }

  // ───── Mini-modal de criação/edição rápida de agendamento ─────
  // POST /api/jobs (novo) ou PUT /api/jobs/:id (edição). Suporta DELETE.
  // Args: { date, time } pra criação, ou { existing } pra edição.
  function openQuickJobModal({ date, time, existing, onSaved } = {}) {
    // Remove qualquer instância anterior
    document.getElementById('fp-quickjob-overlay')?.remove();

    const isEdit = !!existing;
    const jobId = existing?.job_id;
    // Callback de pós-save/delete: default recarrega Agenda; chamador pode
    // sobrescrever pra recarregar outra tela (Produção, etc).
    const reload = onSaved || loadAgenda;

    const types = getTiposEnsaio();

    // Valores iniciais — vêm do evento existente OU do slot clicado
    const initType = existing?.type && types.includes(existing.type) ? existing.type : (existing?.type || 'Outro');
    const initName = existing?.title || 'Sessão';
    const initDate = existing?.date || date;
    const initStart = (existing?.time || time || '09:00').slice(0, 5);
    const initEnd = existing?.end_time
      ? existing.end_time.slice(0, 5)
      : (() => {
          const [h, m] = initStart.split(':').map(Number);
          return `${String(Math.min(h + 1, 23)).padStart(2, '0')}:${String(m || 0).padStart(2, '0')}`;
        })();
    const initClientName = existing?.client_name || '';
    const initClientId = existing?.client_id || null;
    const initStatus = existing?.status || 'scheduled';

    const dateLabel = new Date(initDate + 'T00:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });

    // Garantir que o "tipo" atual está no select mesmo se for customizado
    const typeOptions = types.includes(initType)
      ? types
      : [initType, ...types];

    const overlay = document.createElement('div');
    overlay.id = 'fp-quickjob-overlay';
    overlay.className = 'fp-info-overlay';
    overlay.innerHTML = `
      <div class="fp-quickjob-box">
        <div class="fp-quickjob-head">
          <div>
            <div class="fp-quickjob-kicker">
              ${isEdit
                ? `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 113 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>Editar agendamento`
                : `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>Novo agendamento`}
            </div>
            <div class="fp-quickjob-date">${esc(dateLabel)}</div>
          </div>
          <button class="fp-info-close" data-qj-close>×</button>
        </div>
        <div class="fp-quickjob-body">
          <div class="fp-mf">
            <span class="fp-ml">Tipo</span>
            <div data-slot="type"></div>
          </div>
          <div class="fp-mf">
            <span class="fp-ml">Nome / título</span>
            <input class="fp-mi" id="fp-qj-name" placeholder="Ex: Sessão newborn — Marina" value="${esc(initName)}" />
          </div>
          <div class="fp-mrow">
            <div class="fp-mf" style="flex:1">
              <span class="fp-ml">Data</span>
              <input class="fp-mi" id="fp-qj-date" type="date" value="${esc(initDate)}" />
            </div>
            <div class="fp-mf" style="flex:1">
              <span class="fp-ml">Início</span>
              <input class="fp-mi" id="fp-qj-start" type="time" value="${esc(initStart)}" />
            </div>
            <div class="fp-mf" style="flex:1">
              <span class="fp-ml">Fim</span>
              <input class="fp-mi" id="fp-qj-end" type="time" value="${esc(initEnd)}" />
            </div>
          </div>
          <div class="fp-mf">
            <span class="fp-ml">Cliente <span style="opacity:0.6;font-weight:500">(opcional — busca ou cria novo)</span></span>
            <input class="fp-mi ${initClientId ? 'fp-qj-client-picked' : ''}" id="fp-qj-client" placeholder="Digite o nome do cliente" autocomplete="off" value="${esc(initClientName)}" />
            <div id="fp-qj-client-results" class="fp-qj-results"></div>
          </div>
          ${isEdit ? `
            <div class="fp-mf">
              <span class="fp-ml">Status</span>
              <div data-slot="status"></div>
            </div>
          ` : `
            <div class="fp-mf">
              <span class="fp-ml">Valor (opcional)</span>
              <input class="fp-mi" id="fp-qj-amount" type="number" min="0" step="50" placeholder="0" />
            </div>
          `}
        </div>
        <div class="fp-quickjob-foot">
          ${isEdit ? `
            <button class="fp-btn-w fp-qj-delete" id="fp-qj-delete">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
              Excluir
            </button>
          ` : ''}
          <div style="flex:1"></div>
          <button class="fp-btn-w" data-qj-close>Cancelar</button>
          <button class="fp-btn-g" id="fp-qj-save">
            ${isEdit
              ? `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px"><polyline points="20 6 9 17 4 12"/></svg>Salvar`
              : 'Agendar'}
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    // ─── Substitui <select> nativos pelo fpSelect premium ───
    const typeSelect = fpSelect({
      items: typeOptions.map((t) => ({ value: t, label: t })),
      value: initType,
      placeholder: 'Selecione um tipo',
      searchable: typeOptions.length > 5,
    });
    overlay.querySelector('[data-slot="type"]').appendChild(typeSelect.element);

    let statusSelect = null;
    if (isEdit) {
      statusSelect = fpSelect({
        items: [
          { value: 'scheduled',   label: 'Agendado' },
          { value: 'in_progress', label: 'Em andamento' },
          { value: 'completed',   label: 'Concluído' },
          { value: 'cancelled',   label: 'Cancelado' },
        ],
        value: initStatus,
        placeholder: 'Selecione o status',
      });
      overlay.querySelector('[data-slot="status"]').appendChild(statusSelect.element);
    }

    const close = () => overlay.remove();
    overlay.querySelectorAll('[data-qj-close]').forEach((b) => b.addEventListener('click', close));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

    // Busca de cliente (debounced)
    const clientInput = overlay.querySelector('#fp-qj-client');
    const clientResults = overlay.querySelector('#fp-qj-client-results');
    let selectedClientId = initClientId;
    let clientCache = null;
    let searchTimer;

    async function ensureClients() {
      if (clientCache) return clientCache;
      try {
        clientCache = await bg({ type: 'GET_CLIENTS' });
      } catch {
        clientCache = [];
      }
      return clientCache;
    }

    clientInput.addEventListener('input', () => {
      selectedClientId = null;
      clientInput.classList.remove('fp-qj-client-picked');
      clearTimeout(searchTimer);
      searchTimer = setTimeout(async () => {
        const q = clientInput.value.trim().toLowerCase();
        if (!q) { clientResults.innerHTML = ''; return; }
        const all = await ensureClients();
        const matches = (all || [])
          .filter((c) => (c.name || '').toLowerCase().includes(q))
          .slice(0, 6);
        if (matches.length === 0) {
          clientResults.innerHTML = `<div class="fp-qj-result fp-qj-result-empty">Nenhum encontrado — vai criar um novo com esse nome.</div>`;
          return;
        }
        clientResults.innerHTML = matches.map((c) => `
          <button type="button" class="fp-qj-result" data-cid="${esc(c.id)}" data-cname="${esc(c.name)}">
            <strong>${esc(c.name)}</strong>
            ${c.phone ? `<span>${esc(c.phone)}</span>` : ''}
          </button>
        `).join('');
        clientResults.querySelectorAll('.fp-qj-result').forEach((b) => {
          b.addEventListener('click', () => {
            selectedClientId = b.getAttribute('data-cid');
            clientInput.value = b.getAttribute('data-cname');
            clientInput.classList.add('fp-qj-client-picked');
            clientResults.innerHTML = '';
          });
        });
      }, 200);
    });

    overlay.querySelector('#fp-qj-save').addEventListener('click', async () => {
      const btn = overlay.querySelector('#fp-qj-save');
      btn.disabled = true;
      btn.textContent = 'Salvando…';

      const typed = clientInput.value.trim();
      let clientId = selectedClientId;

      // Se digitou um nome mas não selecionou nenhum (e não é o cliente original), cria leve
      if (typed && !clientId && typed !== initClientName) {
        try {
          const created = await bg({ type: 'CREATE_CLIENT_QUICK', data: { name: typed } });
          clientId = created?.id || null;
        } catch {}
      } else if (!typed) {
        clientId = null; // limpou o campo: desvincula cliente
      }

      const payload = {
        job_type: typeSelect.getValue(),
        job_name: overlay.querySelector('#fp-qj-name').value || 'Sessão',
        job_date: overlay.querySelector('#fp-qj-date').value || initDate,
        job_time: overlay.querySelector('#fp-qj-start').value || null,
        job_end_time: overlay.querySelector('#fp-qj-end').value || null,
        client_id: clientId,
      };

      try {
        if (isEdit) {
          payload.status = statusSelect.getValue();
          await bg({ type: 'UPDATE_JOB', jobId, data: payload });
          toast('Agendamento atualizado!');
        } else {
          payload.status = 'scheduled';
          payload.amount = Number(overlay.querySelector('#fp-qj-amount')?.value) || 0;
          payload.payment_method = '';
          payload.payment_status = 'pending';
          payload.notes = '';
          await bg({ type: 'CREATE_JOB', data: payload });
          toast('Agendamento criado!');
        }
        close();
        reload();
      } catch (err) {
        console.error('[FocalPoint] erro ao salvar job:', err);
        btn.disabled = false;
        btn.textContent = isEdit ? 'Salvar' : 'Agendar';
        toast(err?.message || 'Erro ao salvar agendamento', true);
      }
    });

    overlay.querySelector('#fp-qj-delete')?.addEventListener('click', async () => {
      const ok = await fpConfirm({
        title: 'Excluir agendamento?',
        message: 'Essa ação não pode ser desfeita. O agendamento sai da sua agenda imediatamente.',
        confirmLabel: 'Sim, excluir',
        cancelLabel: 'Manter',
        danger: true,
      });
      if (!ok) return;
      const btn = overlay.querySelector('#fp-qj-delete');
      btn.disabled = true;
      btn.textContent = 'Excluindo…';
      try {
        await bg({ type: 'DELETE_JOB', jobId });
        toast('Agendamento excluído.');
        close();
        reload();
      } catch (err) {
        btn.disabled = false;
        btn.textContent = 'Excluir';
        toast(err?.message || 'Erro ao excluir', true);
      }
    });

    setTimeout(() => overlay.querySelector('#fp-qj-name')?.focus(), 80);
  }

  // Tenta scrollar pra perto da hora atual (ou 8h se for outro dia)
  function scrollToReasonableHour(content) {
    const scroller = content.querySelector('.fp-ag-tg-scroll');
    if (!scroller) return;
    const now = new Date();
    const hour = now.getHours();
    scroller.scrollTop = Math.max(0, (hour - 1) * HOUR_HEIGHT);
  }

  function startAgendaTimeLineTicker() {
    clearInterval(agendaTimeLineInterval);
    updateAgendaTimeLine();
    agendaTimeLineInterval = setInterval(updateAgendaTimeLine, 60000);
  }

  function updateAgendaTimeLine() {
    const line = document.getElementById('fp-ag-tg-now');
    if (!line) return;
    // Só mostra a linha vermelha se "hoje" está visível na view atual
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let showFor = false;
    let column = null;

    if (agendaState.view === 'day') {
      const a = agendaState.anchor;
      const dayDate = new Date(a.getFullYear(), a.getMonth(), a.getDate());
      showFor = dayDate.getTime() === today.getTime();
      column = document.querySelector('.fp-ag-tg-col');
    } else if (agendaState.view === 'week') {
      const start = startOfWeek(agendaState.anchor);
      const end = new Date(start); end.setDate(end.getDate() + 7);
      showFor = today >= start && today < end;
      column = document.querySelector(`.fp-ag-tg-col[data-date="${ymd(today)}"]`);
    }

    if (!showFor || !column) {
      line.style.display = 'none';
      return;
    }
    const minutes = now.getHours() * 60 + now.getMinutes();
    const top = (minutes / 60) * HOUR_HEIGHT;
    const rect = column.getBoundingClientRect();
    const bodyRect = column.parentElement.getBoundingClientRect();
    line.style.display = 'block';
    line.style.top = `${top}px`;
    line.style.left = `${rect.left - bodyRect.left}px`;
    line.style.width = `${rect.width}px`;
  }

  function renderAgendaDayList(day) {
    const list = document.getElementById('fp-ag-day-list');
    if (!list) return;
    const anchor = agendaState.anchor;
    const items = (agendaState.events || [])
      .filter((e) => Number(String(e.date).slice(8, 10)) === day)
      .sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99'));
    const dateStr = new Date(anchor.getFullYear(), anchor.getMonth(), day).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });

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
          <div class="fp-ag-event" data-event-id="${esc(e.id || '')}" style="border-left:3px solid ${c.dot}; cursor:pointer">
            <div class="fp-ag-event-time">${timeStr}</div>
            <div class="fp-ag-event-body">
              <div class="fp-ag-event-title">${esc(e.title)}</div>
              <div class="fp-ag-event-sub">${esc([e.type, e.client_name].filter(Boolean).join(' · ') || '')}</div>
            </div>
            ${e.status ? `<span class="fp-ag-event-status fp-ag-st-${esc(e.status)}">${esc(prettyStatus(e.status))}</span>` : ''}
          </div>
        `;
      }).join('')}
    `;

    // Clique num item: abre o modal em modo edição
    list.querySelectorAll('.fp-ag-event[data-event-id]').forEach((row) => {
      row.addEventListener('click', () => {
        const eventId = row.getAttribute('data-event-id');
        const event = (agendaState.events || []).find((ev) => String(ev.id) === eventId);
        if (event) openQuickJobModal({ existing: event });
      });
    });
  }

  function showAgenda() {
    deselectWhatsappChat();
    kanbanVisible = false;
    hideAllOverlays();
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

  // ============================================================
  // ===== TAREFAS =====
  // ============================================================
  // Filtros: 'mine' (default — só atribuídas a mim), 'all' (equipe inteira),
  // 'overdue' (vencidas), 'today' (vencem hoje). Sempre esconde concluídas
  // a não ser que o toggle "Mostrar concluídas" esteja ligado.
  let tasksState = {
    filter: 'mine',     // mine | all | overdue | today | completed
    tasks: [],
    members: [],
    clients: [],        // pra busca de cliente no modal de tarefa
    me: null,
    loading: false,
  };

  function buildTasksOverlay() {
    if (document.getElementById('fp-tasks')) return;
    const el = document.createElement('div');
    el.id = 'fp-tasks';
    el.className = 'fp-hidden';
    el.innerHTML = `
      <div id="fp-tk-h">
        <h3 id="fp-tk-title">Tarefas</h3>
        <div style="flex:1"></div>
        <button id="fp-tk-refresh" class="fp-icon-btn" title="Atualizar">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>
        </button>
        <button id="fp-tk-new" class="fp-btn-g">+ Nova</button>
      </div>
      <div id="fp-tk-filters">
        <button class="fp-tk-filter-btn" data-filter="mine">Minhas</button>
        <button class="fp-tk-filter-btn" data-filter="all">Equipe</button>
        <button class="fp-tk-filter-btn" data-filter="overdue">Atrasadas</button>
        <button class="fp-tk-filter-btn" data-filter="today">Hoje</button>
        <button class="fp-tk-filter-btn" data-filter="completed">Concluídas</button>
      </div>
      <div id="fp-tk-list"></div>
    `;
    document.body.appendChild(el);

    el.querySelectorAll('.fp-tk-filter-btn').forEach((b) => {
      b.addEventListener('click', () => {
        tasksState.filter = b.getAttribute('data-filter');
        renderTasks();
      });
    });
    el.querySelector('#fp-tk-refresh').addEventListener('click', loadTasks);
    el.querySelector('#fp-tk-new').addEventListener('click', () => openTaskModal(null));
  }

  async function loadTasks() {
    tasksState.loading = true;
    renderTasksLoading();
    try {
      const data = await bg({ type: 'GET_TASKS_DATA' });
      tasksState.tasks = data.tasks || [];
      tasksState.members = data.members || [];
      tasksState.clients = data.clients || [];
      tasksState.me = data.me || null;
    } catch (err) {
      console.error('[FocalPoint] erro carregando tarefas:', err);
      tasksState.tasks = [];
    }
    tasksState.loading = false;
    renderTasks();
  }

  function renderTasksLoading() {
    const list = document.getElementById('fp-tk-list');
    if (!list) return;
    list.innerHTML = `<div class="fp-tk-loading"><div class="fp-spin"></div></div>`;
  }

  function renderTasks() {
    const list = document.getElementById('fp-tk-list');
    if (!list) return;

    // Atualiza estado visual dos filtros
    document.querySelectorAll('.fp-tk-filter-btn').forEach((b) => {
      b.classList.toggle('fp-tk-filter-active', b.getAttribute('data-filter') === tasksState.filter);
    });

    const meId = tasksState.me?.currentMember?.id || null;
    const memberById = new Map(tasksState.members.map((m) => [m.id, m]));
    const clientById = new Map((tasksState.clients || []).map((c) => [c.id, c]));
    const todayStr = new Date().toISOString().slice(0, 10);

    // Esconde concluídas por padrão; só aparecem se o filtro for "completed"
    let items = tasksState.tasks.slice();
    if (tasksState.filter !== 'completed') items = items.filter((t) => !t.completed_at);

    if (tasksState.filter === 'mine') {
      items = items.filter((t) => meId && t.assignee_id === meId);
    } else if (tasksState.filter === 'overdue') {
      items = items.filter((t) => t.due_date && t.due_date.slice(0, 10) < todayStr);
    } else if (tasksState.filter === 'today') {
      items = items.filter((t) => t.due_date && t.due_date.slice(0, 10) === todayStr);
    } else if (tasksState.filter === 'completed') {
      items = items.filter((t) => !!t.completed_at);
    }

    items.sort((a, b) => {
      const ad = a.due_date || '9999-12-31';
      const bd = b.due_date || '9999-12-31';
      return ad.localeCompare(bd);
    });

    if (items.length === 0) {
      list.innerHTML = `
        <div class="fp-tk-empty">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>
          <p>Nenhuma tarefa por aqui.</p>
        </div>
      `;
      return;
    }

    list.innerHTML = items.map((t) => {
      const assignee = t.assignee_id ? memberById.get(t.assignee_id) : null;
      const client = t.client_id ? clientById.get(t.client_id) : null;
      const isMine = meId && t.assignee_id === meId;
      const isDone = !!t.completed_at;
      const dueStr = t.due_date ? t.due_date.slice(0, 10) : '';
      const overdue = !isDone && dueStr && dueStr < todayStr;
      const dueLabel = dueStr ? new Date(dueStr + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }) : 'sem prazo';
      return `
        <div class="fp-tk-item ${isDone ? 'fp-tk-done' : ''} ${overdue ? 'fp-tk-overdue' : ''} ${isMine ? 'fp-tk-mine' : ''}" data-id="${esc(t.id)}">
          <button class="fp-tk-check" data-toggle title="${isDone ? 'Reabrir' : 'Concluir'}">
            ${isDone
              ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" width="14" height="14"><polyline points="20 6 9 17 4 12"/></svg>`
              : ''}
          </button>
          <div class="fp-tk-body" data-edit>
            <div class="fp-tk-title-line">${esc(t.title || 'Sem título')}</div>
            ${client ? `<div class="fp-tk-client">👥 ${esc(client.name)}</div>` : ''}
            ${t.description ? `<div class="fp-tk-desc">${esc(t.description)}</div>` : ''}
            <div class="fp-tk-meta">
              <span class="fp-tk-due ${overdue ? 'fp-tk-due-late' : ''}">📅 ${esc(dueLabel)}</span>
              ${assignee ? `<span class="fp-tk-assignee">👤 ${esc(assignee.name)}</span>` : '<span class="fp-tk-assignee fp-tk-assignee-none">sem responsável</span>'}
              ${isMine ? '<span class="fp-tk-pill-mine">Pra mim</span>' : ''}
            </div>
          </div>
          <button class="fp-tk-delete" data-delete title="Excluir">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 01-2 2H9a2 2 0 01-2-2L5 6"/></svg>
          </button>
        </div>
      `;
    }).join('');

    list.querySelectorAll('.fp-tk-item').forEach((row) => {
      const id = row.getAttribute('data-id');
      const task = tasksState.tasks.find((t) => String(t.id) === String(id));
      row.querySelector('[data-toggle]').addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          await bg({ type: 'TOGGLE_TASK', taskId: id, completed: !task.completed_at });
          task.completed_at = task.completed_at ? null : new Date().toISOString();
          renderTasks();
        } catch (err) {
          toast(err?.message || 'Erro', true);
        }
      });
      row.querySelector('[data-edit]').addEventListener('click', () => openTaskModal(task));
      row.querySelector('[data-delete]').addEventListener('click', async (e) => {
        e.stopPropagation();
        const ok = await fpConfirm({
          title: 'Excluir tarefa?',
          message: `"${task.title || 'Sem título'}" será removida da equipe.`,
          confirmLabel: 'Excluir',
          danger: true,
        });
        if (!ok) return;
        try {
          await bg({ type: 'DELETE_TASK', taskId: id });
          tasksState.tasks = tasksState.tasks.filter((t) => String(t.id) !== String(id));
          renderTasks();
          toast('Tarefa excluída.');
        } catch (err) {
          toast(err?.message || 'Erro', true);
        }
      });
    });
  }

  // Modal de criar/editar tarefa.
  // Opção `prefillClientId`/`prefillClientName` pra abrir o modal já com um
  // cliente vinculado (usado quando criar tarefa direto da conversa do WA).
  function openTaskModal(task, opts = {}) {
    document.getElementById('fp-task-overlay')?.remove();
    const isEdit = !!task;
    const meId = tasksState.me?.currentMember?.id || null;
    const today = new Date();
    const defaultDue = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).toISOString().slice(0, 10);

    const initTitle = task?.title || '';
    const initDesc = task?.description || '';
    const initDue = (task?.due_date || defaultDue).slice(0, 10);
    const initAssignee = task?.assignee_id || meId || '';
    const initClientId = task?.client_id || opts.prefillClientId || '';

    const overlay = document.createElement('div');
    overlay.id = 'fp-task-overlay';
    overlay.className = 'fp-info-overlay';
    overlay.innerHTML = `
      <div class="fp-quickjob-box">
        <div class="fp-quickjob-head">
          <div>
            <div class="fp-quickjob-kicker">${isEdit ? 'Editar tarefa' : 'Nova tarefa'}</div>
            <div class="fp-quickjob-date">${isEdit ? esc(task.title || '') : 'Quem faz o quê?'}</div>
          </div>
          <button class="fp-info-close" data-tk-close>×</button>
        </div>
        <div class="fp-quickjob-body">
          <div class="fp-mf">
            <span class="fp-ml">Título</span>
            <input class="fp-mi" id="fp-tk-input-title" placeholder="Ex: Editar fotos da Marina" value="${esc(initTitle)}" />
          </div>
          <div class="fp-mf">
            <span class="fp-ml">Descrição (opcional)</span>
            <textarea class="fp-mi" id="fp-tk-input-desc" rows="2" placeholder="Detalhes que ajudem quem vai executar">${esc(initDesc)}</textarea>
          </div>
          <div class="fp-mrow">
            <div class="fp-mf" style="flex:1">
              <span class="fp-ml">Prazo</span>
              <input class="fp-mi" id="fp-tk-input-due" type="date" value="${esc(initDue)}" />
            </div>
            <div class="fp-mf" style="flex:1">
              <span class="fp-ml">Responsável</span>
              <div id="fp-tk-assignee-slot"></div>
            </div>
          </div>
          <div class="fp-mf">
            <span class="fp-ml">Cliente vinculado <span style="opacity:0.6;font-weight:500">(opcional — aparece na conversa do WhatsApp)</span></span>
            <div id="fp-tk-client-slot"></div>
          </div>
        </div>
        <div class="fp-quickjob-foot">
          ${isEdit ? `<button class="fp-btn-w fp-qj-delete" id="fp-tk-input-delete">Excluir</button>` : ''}
          <div style="flex:1"></div>
          <button class="fp-btn-w" data-tk-close>Cancelar</button>
          <button class="fp-btn-g" id="fp-tk-input-save">${isEdit ? 'Salvar' : 'Criar'}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const memberItems = [{ value: '', label: 'Sem responsável' }]
      .concat((tasksState.members || []).map((m) => ({ value: m.id, label: m.name })));
    const assigneeSelect = fpSelect({
      items: memberItems,
      value: initAssignee,
      placeholder: 'Quem faz',
      searchable: true,
    });
    overlay.querySelector('#fp-tk-assignee-slot').appendChild(assigneeSelect.element);

    // Garante que clients estejam carregados (modal pode ser aberto sem ir em Tarefas antes)
    if (!tasksState.clients || tasksState.clients.length === 0) {
      bg({ type: 'GET_CLIENTS' }).then((cs) => {
        tasksState.clients = cs || [];
        const items = [{ value: '', label: 'Nenhum' }]
          .concat(tasksState.clients.map((c) => ({ value: c.id, label: c.name })));
        clientSelect.setItems(items);
      }).catch(() => {});
    }
    const clientItems = [{ value: '', label: 'Nenhum' }]
      .concat((tasksState.clients || []).map((c) => ({ value: c.id, label: c.name })));
    const clientSelect = fpSelect({
      items: clientItems,
      value: initClientId,
      placeholder: opts.prefillClientName ? opts.prefillClientName : 'Buscar cliente…',
      searchable: true,
    });
    overlay.querySelector('#fp-tk-client-slot').appendChild(clientSelect.element);

    const close = () => overlay.remove();
    overlay.querySelectorAll('[data-tk-close]').forEach((b) => b.addEventListener('click', close));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    overlay.querySelector('#fp-tk-input-save').addEventListener('click', async () => {
      const title = overlay.querySelector('#fp-tk-input-title').value.trim();
      const description = overlay.querySelector('#fp-tk-input-desc').value.trim();
      const due_date = overlay.querySelector('#fp-tk-input-due').value;
      const assignee_id = assigneeSelect.getValue() || null;
      const client_id = clientSelect.getValue() || null;
      if (!title) return toast('Coloca um título.', true);
      if (!due_date) return toast('Define um prazo.', true);
      const btn = overlay.querySelector('#fp-tk-input-save');
      btn.disabled = true; btn.textContent = 'Salvando…';
      try {
        if (isEdit) {
          await bg({ type: 'UPDATE_TASK', taskId: task.id, data: { title, description, due_date, assignee_id, client_id, job_id: task.job_id, stage_id: task.stage_id } });
          toast('Tarefa atualizada.');
        } else {
          await bg({ type: 'CREATE_TASK', data: { title, description, due_date, assignee_id, client_id } });
          toast('Tarefa criada.');
        }
        close();
        if (opts.onSaved) opts.onSaved();
        else loadTasks();
      } catch (err) {
        btn.disabled = false; btn.textContent = isEdit ? 'Salvar' : 'Criar';
        toast(err?.message || 'Erro ao salvar', true);
      }
    });

    overlay.querySelector('#fp-tk-input-delete')?.addEventListener('click', async () => {
      const ok = await fpConfirm({ title: 'Excluir tarefa?', confirmLabel: 'Excluir', danger: true });
      if (!ok) return;
      try {
        await bg({ type: 'DELETE_TASK', taskId: task.id });
        toast('Tarefa excluída.');
        close();
        loadTasks();
      } catch (err) {
        toast(err?.message || 'Erro', true);
      }
    });

    setTimeout(() => overlay.querySelector('#fp-tk-input-title')?.focus(), 80);
  }

  function showTasks() {
    // Tarefas ocupa a área toda do chat, igual aos demais overlays.
    deselectWhatsappChat();
    kanbanVisible = false;
    hideAllOverlays();
    buildTasksOverlay();
    adjustPosition();
    document.getElementById('fp-tasks')?.classList.remove('fp-hidden');
    setRailActive('fp-rail-tasks');
    removeChatStrip();
    loadTasks();
    setTimeout(adjustPosition, 200);
  }

  // Esconde Agenda/Produção/Tarefas quando o usuário clica num chat da
  // sidebar do WhatsApp — assim ele consegue ler/responder sem que o
  // overlay continue cobrindo o campo de mensagem.
  // (Pipeline é tratado separadamente via hideKanban().)
  function hideOverlaysForChatNav() {
    ['fp-agenda', 'fp-production', 'fp-tasks'].forEach((id) => {
      const el = document.getElementById(id);
      if (el && !el.classList.contains('fp-hidden')) el.classList.add('fp-hidden');
    });
    document.body.classList.remove('fp-tasks-open');
    setRailActive(null);
  }

  // ============================================================
  // ===== PRODUÇÃO — estrutura v2 (processes = pastas) =========
  // ============================================================
  let productionState = {
    processes: [],     // "pastas" — cada uma é uma aba no topo
    stages: [],        // stages v2 — pertencem a um process_id
    jobs: [],
    clients: [],
    members: [],
    openProcessId: null, // null + view='sales' = aba "Vendas recentes" aberta
    view: 'kanban',      // 'kanban' | 'sales'
    salesPeriod: 7,      // dias pra filtrar em "Vendas recentes"
    salesData: null,     // resposta do GET_SALES_OVERVIEW
    salesLoading: false,
    loading: false,
  };

  function buildProductionOverlay() {
    if (document.getElementById('fp-production')) return;
    const el = document.createElement('div');
    el.id = 'fp-production';
    el.className = 'fp-hidden';
    el.innerHTML = `
      <div id="fp-pr-h">
        <h3 id="fp-pr-title">Produção</h3>
        <div style="flex:1"></div>
        <button id="fp-pr-refresh" class="fp-icon-btn" title="Atualizar">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>
        </button>
      </div>
      <div id="fp-pr-tabs"></div>
      <div id="fp-pr-board"></div>
    `;
    document.body.appendChild(el);
    el.querySelector('#fp-pr-refresh').addEventListener('click', loadProduction);
  }

  async function loadProduction() {
    productionState.loading = true;
    const board = document.getElementById('fp-pr-board');
    if (board) board.innerHTML = `<div class="fp-tk-loading"><div class="fp-spin"></div></div>`;
    const tabs = document.getElementById('fp-pr-tabs');
    if (tabs) tabs.innerHTML = '';
    try {
      const data = await bg({ type: 'GET_PRODUCTION_DATA' });
      productionState.processes = (data.processes || []).slice().sort((a, b) => (a.position || 0) - (b.position || 0));
      productionState.stages = data.stages || [];
      productionState.jobs = data.jobs || [];
      productionState.clients = data.clients || [];
      productionState.members = data.members || [];
      // Mantém a pasta aberta se ainda existir; senão pega a primeira
      const stillExists = productionState.processes.find((p) => p.id === productionState.openProcessId);
      if (!stillExists) productionState.openProcessId = productionState.processes[0]?.id || null;
    } catch (err) {
      console.error('[FocalPoint] erro produção:', err);
      productionState.processes = [];
      productionState.stages = [];
      productionState.jobs = [];
    }
    productionState.loading = false;
    renderProduction();
  }

  function renderProduction() {
    const tabsEl = document.getElementById('fp-pr-tabs');
    const boardEl = document.getElementById('fp-pr-board');
    if (!tabsEl || !boardEl) return;

    if (productionState.processes.length === 0) {
      tabsEl.innerHTML = '';
      boardEl.innerHTML = `<div class="fp-board-state"><p>Sem pastas de produção configuradas.<br/>Crie no app web em Produção → Configurar.</p></div>`;
      return;
    }

    // ─── Renderiza as abas (pastas) ───────────────────────────────────
    const jobCountByProcess = new Map();
    productionState.processes.forEach((p) => jobCountByProcess.set(p.id, 0));
    const stagesByProcess = new Map();
    productionState.processes.forEach((p) => stagesByProcess.set(p.id, []));
    productionState.stages.forEach((s) => {
      if (stagesByProcess.has(s.process_id)) stagesByProcess.get(s.process_id).push(s);
    });
    productionState.jobs.forEach((j) => {
      if (!j.production_stage) return;
      const stage = productionState.stages.find((s) => s.id === j.production_stage);
      if (stage && jobCountByProcess.has(stage.process_id)) {
        jobCountByProcess.set(stage.process_id, jobCountByProcess.get(stage.process_id) + 1);
      }
    });

    // Aba especial "Vendas recentes" sempre no topo
    const isSalesActive = productionState.view === 'sales';
    const salesTabHtml = `
      <button class="fp-pr-tab fp-pr-tab-sales ${isSalesActive ? 'fp-pr-tab-active' : ''}"
              data-view="sales">
        <span class="fp-pr-tab-emoji">📥</span>
        <span class="fp-pr-tab-name">Vendas recentes</span>
      </button>
    `;

    tabsEl.innerHTML = salesTabHtml + productionState.processes.map((p) => {
      const isActive = !isSalesActive && p.id === productionState.openProcessId;
      const count = jobCountByProcess.get(p.id) || 0;
      const isSpecial = !!p.is_special;
      const color = p.color || '#94a3b8';
      const bgInactive = isSpecial ? '#D4A94A' : color;
      return `
        <button class="fp-pr-tab ${isActive ? 'fp-pr-tab-active' : ''} ${isSpecial ? 'fp-pr-tab-special' : ''}"
                data-pid="${esc(p.id)}"
                style="${isActive ? '' : `background:${bgInactive};color:#fff;border-color:transparent`}">
          ${isSpecial ? '<span class="fp-pr-tab-star">★</span>' : ''}
          <span class="fp-pr-tab-name">${esc(p.name)}</span>
          ${count > 0 ? `<span class="fp-pr-tab-count">${count}</span>` : ''}
        </button>
      `;
    }).join('');
    tabsEl.querySelectorAll('.fp-pr-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.getAttribute('data-view') === 'sales') {
          productionState.view = 'sales';
          renderProduction();
          loadSalesOverview();
        } else {
          productionState.view = 'kanban';
          productionState.openProcessId = btn.getAttribute('data-pid');
          renderProduction();
        }
      });
    });

    // ─── Se aba "Vendas recentes" está ativa, renderiza esse painel ──
    if (isSalesActive) {
      renderSalesOverview(boardEl);
      return;
    }

    // ─── Renderiza o kanban da pasta ativa ────────────────────────────
    const activeProcess = productionState.processes.find((p) => p.id === productionState.openProcessId);
    if (!activeProcess) {
      boardEl.innerHTML = `<div class="fp-board-state"><p>Selecione uma pasta acima.</p></div>`;
      return;
    }

    const procStages = (stagesByProcess.get(activeProcess.id) || [])
      .slice()
      .sort((a, b) => (a.position || 0) - (b.position || 0));

    boardEl.className = activeProcess.is_special ? 'fp-pr-board-special' : '';

    if (procStages.length === 0) {
      boardEl.innerHTML = `<div class="fp-board-state"><p>Nenhuma etapa nesta pasta.<br/>Configure no app web.</p></div>`;
      return;
    }

    const clientById = new Map(productionState.clients.map((c) => [c.id, c]));
    const memberById = new Map(productionState.members.map((m) => [m.id, m]));
    const jobsByStage = new Map();
    procStages.forEach((s) => jobsByStage.set(s.id, []));
    productionState.jobs.forEach((j) => {
      if (j.production_stage && jobsByStage.has(j.production_stage)) {
        jobsByStage.get(j.production_stage).push(j);
      }
    });

    boardEl.innerHTML = procStages.map((stage) => {
      const jobs = jobsByStage.get(stage.id) || [];
      const expectedH = Number(stage.expected_hours) || 0;
      return `
        <div class="fp-pr-col" data-stage-id="${esc(stage.id)}">
          <div class="fp-pr-col-hd">
            <div class="fp-pr-col-title">
              <span class="fp-pr-col-name">${esc(stage.name)}</span>
              <span class="fp-pr-col-badge">${jobs.length}</span>
            </div>
            <div class="fp-pr-col-meta">
              ${expectedH > 0 ? `⏱ ${expectedH}h previsto` : 'sem tempo previsto'}
            </div>
          </div>
          <div class="fpc-body fp-pr-col-body" data-stage-id="${esc(stage.id)}">
            ${jobs.length === 0
              ? '<div class="fp-pr-empty">Vazio</div>'
              : jobs.map((j) => productionCardHtml(j, clientById, memberById, stage)).join('')}
          </div>
        </div>
      `;
    }).join('');

    // Wire drag-drop + click pra editar pra cada card
    boardEl.querySelectorAll('.fp-pr-card[data-job-id]').forEach((el) => {
      const jobId = el.getAttribute('data-job-id');
      el.addEventListener('pointerdown', (e) => startPointerCardDrag(e, el, jobId, 'job'));
      el.addEventListener('click', (e) => {
        if (dragMoved) return; // foi drag, não conta como click
        const job = productionState.jobs.find((j) => String(j.id) === jobId);
        if (job) openProductionJobEditor(job);
      });
    });
  }

  // Reaproveita o modal de criar/editar agendamento (openQuickJobModal) pra
  // editar o job clicado no kanban de Produção. Cobre tipo, nome, data,
  // hora, cliente, status — e tem botão de excluir. Após salvar, recarrega
  // o board de Produção (em vez do default que recarrega a Agenda).
  function openProductionJobEditor(job) {
    const clientById = new Map((productionState.clients || []).map((c) => [c.id, c]));
    const client = job.client_id ? clientById.get(job.client_id) : null;
    openQuickJobModal({
      existing: {
        job_id: job.id,
        title: job.job_name,
        type: job.job_type,
        date: String(job.job_date || '').slice(0, 10),
        time: job.job_time,
        end_time: job.job_end_time,
        client_id: job.client_id,
        client_name: client?.name || '',
        status: job.status,
      },
      onSaved: () => loadProduction(),
    });
  }

  function productionCardHtml(job, clientById, memberById, stage) {
    const client = job.client_id ? clientById.get(job.client_id) : null;
    const assignee = job.assignee_id ? memberById?.get(job.assignee_id) : null;
    const clientName = job.client_name || (client ? client.name : '');
    const dateLabel = job.job_date
      ? new Date(String(job.job_date).slice(0, 10) + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
      : '';

    // Cálculo de staleness (atrasado/atenção) igual o app web
    let stalenessClass = '';
    let stalenessTag = '';
    let elapsedTag = '';
    const enteredAt = job.production_stage_entered_at;
    const expectedH = Number(stage?.expected_hours) || 0;
    if (enteredAt && expectedH > 0) {
      const elapsedH = (Date.now() - new Date(enteredAt).getTime()) / 3_600_000;
      const progress = elapsedH / expectedH;
      if (progress >= 1.0) { stalenessClass = 'fp-pr-card-urgent'; stalenessTag = '<span class="fp-pr-tag-urgent">ATRASADO</span>'; }
      else if (progress >= 0.5) { stalenessClass = 'fp-pr-card-warning'; stalenessTag = '<span class="fp-pr-tag-warning">ATENÇÃO</span>'; }
      const elapsedLabel = elapsedH < 1 ? `${Math.floor(elapsedH * 60)}min` : elapsedH < 24 ? `${Math.floor(elapsedH)}h` : `${Math.floor(elapsedH / 24)}d`;
      elapsedTag = `<span class="fp-pr-elapsed ${stalenessClass}">⏱ ${esc(elapsedLabel)}</span>`;
    }

    const paymentTag = job.payment_status === 'paid'
      ? '<span class="fp-pr-tag-paid">Pago</span>'
      : (job.amount > 0 ? '<span class="fp-pr-tag-pending">Pendente</span>' : '');

    const assigneeChip = assignee
      ? `<div class="fp-pr-assignee" style="background:${esc(assignee.color || '#64748b')}">
           <span class="fp-pr-assignee-ini">${esc((assignee.name || '').split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase())}</span>
           <span class="fp-pr-assignee-name">${esc(assignee.name)}</span>
         </div>`
      : '';

    return `
      <div class="fp-pr-card ${stalenessClass}" data-job-id="${esc(job.id)}">
        <div class="fp-pr-card-top">
          <div class="fp-pr-card-info">
            <div class="fp-pr-card-name">${esc(clientName || job.job_name || 'Trabalho')}</div>
            <div class="fp-pr-card-type">📷 ${esc(job.job_type || 'Sessão')}</div>
          </div>
        </div>
        ${assigneeChip}
        <div class="fp-pr-card-bot">
          <div class="fp-pr-card-bot-left">
            ${dateLabel ? `<span class="fp-pr-date">📅 ${esc(dateLabel)}</span>` : ''}
            ${paymentTag}
          </div>
          <div class="fp-pr-card-bot-right">
            ${stalenessTag}
            ${elapsedTag}
          </div>
        </div>
      </div>
    `;
  }

  // ─── Painel "Vendas recentes" ─────────────────────────────────────
  async function loadSalesOverview() {
    productionState.salesLoading = true;
    renderProduction();
    try {
      const data = await bg({ type: 'GET_SALES_OVERVIEW', days: productionState.salesPeriod });
      productionState.salesData = data;
    } catch (err) {
      console.error('[FocalPoint] erro vendas recentes:', err);
      productionState.salesData = { sales: [], days: productionState.salesPeriod, error: err.message };
    }
    productionState.salesLoading = false;
    renderProduction();
  }

  function renderSalesOverview(boardEl) {
    if (productionState.salesLoading) {
      boardEl.innerHTML = `<div class="fp-tk-loading"><div class="fp-spin"></div></div>`;
      return;
    }
    const data = productionState.salesData || { sales: [] };
    const sales = data.sales || [];

    boardEl.className = 'fp-pr-sales';

    const pendingCount = sales.filter((s) => !s.in_production && s.job_id).length;
    const inProdCount = sales.filter((s) => s.in_production).length;
    const noJobCount = sales.filter((s) => !s.job_id).length;

    const headerHtml = `
      <div class="fp-pr-sales-header">
        <div class="fp-pr-sales-chips">
          ${[
            { d: 7,  label: '7 dias' },
            { d: 14, label: '14 dias' },
            { d: 30, label: '30 dias' },
            { d: 90, label: '90 dias' },
          ].map((p) => `
            <button class="fp-pr-sales-chip ${productionState.salesPeriod === p.d ? 'fp-pr-sales-chip-active' : ''}" data-days="${p.d}">${p.label}</button>
          `).join('')}
        </div>
        <div class="fp-pr-sales-summary">
          <span class="fp-pr-sales-pill fp-pr-sales-pill-pending"><strong>${pendingCount}</strong> pendentes</span>
          <span class="fp-pr-sales-pill fp-pr-sales-pill-active"><strong>${inProdCount}</strong> em produção</span>
          ${noJobCount > 0 ? `<span class="fp-pr-sales-pill fp-pr-sales-pill-nojob"><strong>${noJobCount}</strong> sem job</span>` : ''}
        </div>
      </div>
    `;

    if (sales.length === 0) {
      boardEl.innerHTML = `
        ${headerHtml}
        <div class="fp-board-state"><p>Nenhuma venda nos últimos ${data.days || productionState.salesPeriod} dias.</p></div>
      `;
      wireSalesChips(boardEl);
      return;
    }

    boardEl.innerHTML = `
      ${headerHtml}
      <div class="fp-pr-sales-list">
        ${sales.map((s) => salesRowHtml(s)).join('')}
      </div>
    `;

    wireSalesChips(boardEl);

    // Wire ações de cada linha
    boardEl.querySelectorAll('.fp-pr-sales-row').forEach((row) => {
      const dealId = row.getAttribute('data-deal-id');
      const jobId = row.getAttribute('data-job-id');
      const sale = sales.find((s) => String(s.deal_id) === dealId);

      row.querySelector('[data-action="send"]')?.addEventListener('click', async () => {
        await sendSaleToProduction(sale);
      });

      row.querySelector('[data-action="edit"]')?.addEventListener('click', () => {
        openSaleEditMenu(row.querySelector('[data-action="edit"]'), sale);
      });
    });
  }

  function wireSalesChips(boardEl) {
    boardEl.querySelectorAll('.fp-pr-sales-chip').forEach((b) => {
      b.addEventListener('click', () => {
        productionState.salesPeriod = Number(b.getAttribute('data-days'));
        loadSalesOverview();
      });
    });
  }

  function salesRowHtml(s) {
    const valueLabel = (s.value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0 });
    const whenLabel = s.converted_at
      ? new Date(s.converted_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
      : '—';
    const jobDateLabel = s.job_date
      ? new Date(String(s.job_date).slice(0, 10) + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
      : '';

    let statusHtml, actionHtml;
    if (!s.job_id) {
      statusHtml = `<span class="fp-pr-sales-status fp-pr-sales-status-nojob">Sem job criado</span>`;
      actionHtml = '<span class="fp-pr-sales-empty-action">—</span>';
    } else if (s.in_production) {
      statusHtml = `<span class="fp-pr-sales-status fp-pr-sales-status-in"><span class="fp-pr-sales-dot fp-pr-sales-dot-in"></span>Em produção · ${esc(s.production_stage_name || '')}</span>`;
      actionHtml = `<button class="fp-btn-w fp-pr-sales-btn" data-action="edit">Editar</button>`;
    } else {
      statusHtml = `<span class="fp-pr-sales-status fp-pr-sales-status-pending"><span class="fp-pr-sales-dot fp-pr-sales-dot-pending"></span>Pendente</span>`;
      actionHtml = `<button class="fp-btn-g fp-pr-sales-btn" data-action="send">→ Enviar pra produção</button>`;
    }

    return `
      <div class="fp-pr-sales-row ${s.in_production ? 'fp-pr-sales-row-inactive' : ''} ${!s.job_id ? 'fp-pr-sales-row-nojob' : ''}" data-deal-id="${esc(s.deal_id)}" data-job-id="${esc(s.job_id || '')}">
        <div class="fp-pr-sales-info">
          <div class="fp-pr-sales-name">${esc(s.client_name)}</div>
          <div class="fp-pr-sales-meta">
            <span>${esc(valueLabel)}</span>
            <span>· vendido ${esc(whenLabel)}</span>
            ${jobDateLabel ? `<span>· sessão ${esc(jobDateLabel)}</span>` : ''}
          </div>
        </div>
        ${statusHtml}
        ${actionHtml}
      </div>
    `;
  }

  // Envia o job pra primeira etapa do primeiro processo de produção
  async function sendSaleToProduction(sale) {
    if (!sale?.job_id) return toast('Sem job pra enviar.', true);
    const firstProcess = productionState.processes
      .filter((p) => !p.is_special)
      .sort((a, b) => (a.position || 0) - (b.position || 0))[0];
    if (!firstProcess) return toast('Configure um processo de produção primeiro.', true);
    const firstStage = productionState.stages
      .filter((s) => s.process_id === firstProcess.id)
      .sort((a, b) => (a.position || 0) - (b.position || 0))[0];
    if (!firstStage) return toast('Sem etapa nesse processo.', true);

    try {
      await bg({ type: 'MOVE_JOB_PRODUCTION_STAGE', jobId: sale.job_id, stageId: firstStage.id });
      toast(`Enviado pra "${firstStage.name}"`);
      loadSalesOverview();
      // Recarrega jobs em segundo plano pro kanban refletir
      bg({ type: 'GET_PRODUCTION_DATA' }).then((data) => {
        productionState.jobs = data.jobs || [];
      }).catch(() => {});
    } catch (err) {
      toast(err?.message || 'Erro ao enviar', true);
    }
  }

  // Menu pequeno pra editar/mover/tirar de produção
  function openSaleEditMenu(anchorBtn, sale) {
    document.querySelectorAll('.fp-pr-sales-menu').forEach((m) => m.remove());
    const rect = anchorBtn.getBoundingClientRect();
    const menu = document.createElement('div');
    menu.className = 'fp-pr-sales-menu';
    menu.style.right = `${Math.round(window.innerWidth - rect.right)}px`;
    menu.style.top = `${Math.round(rect.bottom + 6)}px`;
    menu.innerHTML = `
      <button class="fp-pr-sales-menu-item" data-act="move">Mover de etapa</button>
      <button class="fp-pr-sales-menu-item" data-act="remove">Tirar da produção</button>
      <button class="fp-pr-sales-menu-item fp-pr-sales-menu-danger" data-act="back">Voltar pra fila de edição</button>
    `;
    document.body.appendChild(menu);

    const close = () => {
      menu.remove();
      document.removeEventListener('mousedown', onDoc, true);
    };
    const onDoc = (e) => { if (!menu.contains(e.target) && !anchorBtn.contains(e.target)) close(); };
    setTimeout(() => document.addEventListener('mousedown', onDoc, true), 0);

    menu.querySelector('[data-act="move"]').addEventListener('click', async () => {
      close();
      openMoveStageDialog(sale);
    });
    menu.querySelector('[data-act="remove"]').addEventListener('click', async () => {
      close();
      const ok = await fpConfirm({
        title: 'Tirar da produção?',
        message: `O trabalho de ${sale.client_name} vai sair da produção (mas continua salvo).`,
        confirmLabel: 'Tirar',
        danger: true,
      });
      if (!ok) return;
      try {
        await bg({ type: 'MOVE_JOB_PRODUCTION_STAGE', jobId: sale.job_id, stageId: null });
        toast('Tirado da produção.');
        loadSalesOverview();
        bg({ type: 'GET_PRODUCTION_DATA' }).then((data) => {
          productionState.jobs = data.jobs || [];
        }).catch(() => {});
      } catch (err) {
        toast(err?.message || 'Erro', true);
      }
    });
    menu.querySelector('[data-act="back"]').addEventListener('click', async () => {
      close();
      // "Voltar pra fila de edição" = mover pra primeira etapa de novo
      sendSaleToProduction(sale);
    });
  }

  function openMoveStageDialog(sale) {
    document.getElementById('fp-pr-move-overlay')?.remove();
    const allStages = productionState.stages.slice().sort((a, b) => (a.position || 0) - (b.position || 0));
    const processById = new Map(productionState.processes.map((p) => [p.id, p]));

    const overlay = document.createElement('div');
    overlay.id = 'fp-pr-move-overlay';
    overlay.className = 'fp-info-overlay';
    overlay.innerHTML = `
      <div class="fp-quickjob-box" style="width:380px">
        <div class="fp-quickjob-head">
          <div>
            <div class="fp-quickjob-kicker">Mover de etapa</div>
            <div class="fp-quickjob-date">${esc(sale.client_name)}</div>
          </div>
          <button class="fp-info-close" data-close>×</button>
        </div>
        <div class="fp-quickjob-body">
          <div class="fp-mf">
            <span class="fp-ml">Para qual etapa?</span>
            <div id="fp-pr-move-slot"></div>
          </div>
        </div>
        <div class="fp-quickjob-foot">
          <div style="flex:1"></div>
          <button class="fp-btn-w" data-close>Cancelar</button>
          <button class="fp-btn-g" id="fp-pr-move-save">Mover</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const items = allStages.map((s) => ({
      value: s.id,
      label: `${processById.get(s.process_id)?.name || '?'} → ${s.name}`,
    }));
    const select = fpSelect({ items, value: sale.production_stage_id, searchable: true, placeholder: 'Escolher etapa' });
    overlay.querySelector('#fp-pr-move-slot').appendChild(select.element);

    const close = () => overlay.remove();
    overlay.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    overlay.querySelector('#fp-pr-move-save').addEventListener('click', async () => {
      const stageId = select.getValue();
      if (!stageId) return toast('Escolhe uma etapa.', true);
      try {
        await bg({ type: 'MOVE_JOB_PRODUCTION_STAGE', jobId: sale.job_id, stageId });
        toast('Movido.');
        close();
        loadSalesOverview();
        bg({ type: 'GET_PRODUCTION_DATA' }).then((data) => {
          productionState.jobs = data.jobs || [];
        }).catch(() => {});
      } catch (err) {
        toast(err?.message || 'Erro', true);
      }
    });
  }

  async function moveJobToProductionStage(jobId, stageId) {
    const job = productionState.jobs.find((j) => String(j.id) === String(jobId));
    if (!job || job.production_stage === stageId) return;
    const prev = job.production_stage;
    job.production_stage = stageId; // otimista
    renderProduction();
    try {
      await bg({ type: 'MOVE_JOB_PRODUCTION_STAGE', jobId, stageId });
      toast('Movido.');
    } catch (err) {
      job.production_stage = prev;
      renderProduction();
      toast(err?.message || 'Erro ao mover', true);
    }
  }

  function showProduction() {
    deselectWhatsappChat();
    kanbanVisible = false;
    hideAllOverlays();
    removeChatStrip();
    buildProductionOverlay();
    adjustPosition();
    document.getElementById('fp-production')?.classList.remove('fp-hidden');
    setRailActive('fp-rail-production');
    loadProduction();
    setTimeout(adjustPosition, 200);
  }

  // ===== LOGOUT =====
  async function confirmLogout() {
    const ok = await fpConfirm({
      title: 'Sair da conta?',
      message: 'Você precisará entrar de novo pra acessar seus dados.',
      confirmLabel: 'Sair',
      cancelLabel: 'Cancelar',
      danger: true,
    });
    if (!ok) return;
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
    // Reposiciona linha de tarefas logo abaixo (se existir)
    positionChatTasksRow();
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
    // Trava de segurança: se o telefone do deal não bate com o chat aberto,
    // NÃO renderiza. Evita exibir dados de cliente errado se o caller passou
    // deal incorreto por engano de matching.
    const dealPhoneDigits = digits(deal?.contact_phone || '');
    const chatPhoneDigits = digits(chatPhone || '');
    if (deal && dealPhoneDigits && chatPhoneDigits && dealPhoneDigits !== chatPhoneDigits) {
      console.warn('[fp-extension] injectChatStrip abortado — phone mismatch:',
        { deal_phone: dealPhoneDigits, chat_phone: chatPhoneDigits });
      return;
    }
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
          ${deal.lead_source ? `<div class="fp-info-row"><span class="fp-info-label">Origem</span><span>${esc(deal.lead_source)}</span></div>` : ''}
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

    bindOverlayClose(m, () => m.remove());
    m.querySelector('#fp-info-close')?.addEventListener('click', () => m.remove());
  }

  function removeChatStrip() {
    document.getElementById('fp-chat-strip')?.remove();
    document.getElementById('fp-chat-tasks')?.remove();
    removeStageMenu();
  }

  async function onChatOpened(phone) {
    const cleanPhone = digits(phone || '');
    const chatName = getWAChatName();
    // A chave inclui o NOME do header (atualiza rápido e é a identidade VISÍVEL da
    // conversa) + telefone. Assim, trocar de conversa SEMPRE re-detecta. Antes a
    // chave era só o telefone; se ele fosse lido "atrasado" (mensagens da conversa
    // anterior ainda na tela = telefone antigo), a chave não mudava e o strip
    // ficava preso na pessoa errada até dar refresh.
    const nextKey = `${chatName || ''}|${cleanPhone || ''}`;
    if ((!chatName && !cleanPhone) || nextKey === chatKey) return;

    chatKey = nextKey;
    chatPhone = cleanPhone || null;
    chatDeal = null;
    rememberContactPhoto(cleanPhone, getWAChatPhoto());

    // Só exibe/usa um deal cujo NOME bate com o header visível. Protege contra o
    // telefone "atrasado": se o telefone resolveu pra um deal de OUTRA pessoa
    // (conversa anterior), o nome não bate → não mostra (espera as mensagens
    // novas carregarem e o próximo detectState corrigir).
    const headerNm = normalizeNameForMatch(chatName || '');
    // "Mesma pessoa?" — tolerante: nome contém o outro OU compartilham ao menos um
    // token (nome/sobrenome com 3+ letras). Só reprova quando são nomes CLARAMENTE
    // diferentes (sinal de telefone atrasado apontando pra outra conversa).
    const nameMatchesHeader = (d) => {
      if (!headerNm) return true;
      const dn = normalizeNameForMatch(d?.contact_name || d?.title || '');
      if (!dn || headerNm.includes(dn) || dn.includes(headerNm)) return true;
      const toks = (s) => s.split(' ').filter((w) => w.length >= 3);
      const a = toks(headerNm), b = new Set(toks(dn));
      return a.some((w) => b.has(w));
    };

    if (!cleanPhone) {
      if (!chatStages.length && !stages.length) {
        try { chatStages = await ensureStagesForUi(); } catch { /* sem etapas, o modal ainda permite tentar */ }
      }
      injectAddStrip(null);
      return;
    }

    try {
      // Mostra a faixa NA HORA a partir do cache (o deal já veio do funil).
      // CRÍTICO: usar APENAS match exato — match por 8 dígitos finais causava
      // falso positivo entre dois clientes com finais iguais, e ao clicar
      // "Ganho" a conversão saía pro deal errado. Bug reportado 2026-06-03.
      const stgsNow = chatStages.length ? chatStages : stages;
      const pd = digits(cleanPhone);
      const cachedDeal = stgsNow.length
        ? deals.find((d) => {
            const dd = digits(d.contact_phone || '');
            return dd && pd && dd === pd;
          })
        : null;
      if (cachedDeal && nameMatchesHeader(cachedDeal)) {
        chatDeal = cachedDeal;
        chatStages = stgsNow;
        injectChatStrip(chatDeal, chatStages);
      }

      // Busca a versão completa (deal + etapas + tarefas) e atualiza.
      const result = await bg({ type: 'GET_DEAL_BY_PHONE', phone: cleanPhone });
      if (chatPhone !== cleanPhone) return; // trocou de chat enquanto carregava
      chatStages = result.stages || stages;

      // Validação extra: o deal retornado precisa bater EXATAMENTE com o chat
      // aberto. Se o backend retornou outro deal (raríssimo, mas possível),
      // ignora pra não exibir/converter pessoa errada.
      const returnedDealPhone = digits(result.deal?.contact_phone || '');
      if (result.deal && returnedDealPhone && returnedDealPhone !== pd) {
        console.warn('[fp-extension] deal-by-phone retornou phone diferente:',
          { expected: pd, got: returnedDealPhone });
        chatDeal = null;
      } else if (result.deal && !nameMatchesHeader(result.deal)) {
        // Telefone "atrasado": resolveu pra um deal cujo nome não bate com o
        // header visível → não usa (o próximo detectState pega a pessoa certa).
        console.warn('[fp-extension] deal-by-phone com nome diferente do header — ignorado');
        chatDeal = null;
      } else {
        chatDeal = result.deal;
      }
      chatPendingTasks = result.pending_tasks || [];

      if (chatDeal) {
        injectChatStrip(chatDeal, chatStages);
        injectPendingTasksRow(chatDeal);
      } else {
        // Contato sem deal — mostra strip mínima com botão "Adicionar"
        injectAddStrip(cleanPhone);
      }
    } catch (err) {
      console.warn('[fp-extension] onChatOpened falhou:', err);
    }
  }

  // Mostra tarefas pendentes vinculadas ao cliente desse deal, logo abaixo da
  // faixa do CRM. Click numa tarefa abre o modal de edição.
  let chatPendingTasks = [];
  function injectPendingTasksRow(deal) {
    document.getElementById('fp-chat-tasks')?.remove();
    const tasks = chatPendingTasks || [];
    if (!tasks.length) return;

    const row = document.createElement('div');
    row.id = 'fp-chat-tasks';
    const todayStr = new Date().toISOString().slice(0, 10);
    row.innerHTML = `
      <span class="fp-chat-tasks-label">📋 ${tasks.length} ${tasks.length === 1 ? 'tarefa' : 'tarefas'} pendentes:</span>
      ${tasks.map((t) => {
        const dueStr = (t.due_date || '').slice(0, 10);
        const overdue = dueStr && dueStr < todayStr;
        const dueLabel = dueStr ? new Date(dueStr + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }) : '';
        return `
          <button class="fp-chat-task ${overdue ? 'fp-chat-task-overdue' : ''}" data-tid="${esc(t.id)}" title="${esc(t.title)}">
            <span class="fp-chat-task-check" data-toggle="${esc(t.id)}"></span>
            <span class="fp-chat-task-title">${esc(t.title)}</span>
            ${dueLabel ? `<span class="fp-chat-task-due">${esc(dueLabel)}</span>` : ''}
          </button>
        `;
      }).join('')}
      <button class="fp-chat-task-new" id="fp-chat-task-new" title="Criar tarefa pra esse cliente">+ Tarefa</button>
    `;
    document.body.appendChild(row);
    positionChatTasksRow();

    row.querySelectorAll('.fp-chat-task').forEach((btn) => {
      const tid = btn.getAttribute('data-tid');
      btn.querySelector('[data-toggle]')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          await bg({ type: 'TOGGLE_TASK', taskId: tid, completed: true });
          chatPendingTasks = chatPendingTasks.filter((t) => String(t.id) !== String(tid));
          injectPendingTasksRow(deal);
          toast('Tarefa concluída.');
        } catch (err) { toast(err?.message || 'Erro', true); }
      });
      btn.addEventListener('click', (e) => {
        if (e.target.closest('[data-toggle]')) return;
        // Pra editar, precisa do registro completo — recarrega tasksState
        bg({ type: 'GET_TASKS_DATA' }).then((data) => {
          tasksState.tasks = data.tasks || [];
          tasksState.members = data.members || [];
          tasksState.clients = data.clients || [];
          tasksState.me = data.me || null;
          const full = tasksState.tasks.find((t) => String(t.id) === String(tid));
          if (full) openTaskModal(full, { onSaved: () => onChatOpened(deal.contact_phone) });
        });
      });
    });

    row.querySelector('#fp-chat-task-new')?.addEventListener('click', () => {
      openTaskModal(null, {
        prefillClientId: deal.client_id,
        prefillClientName: deal.contact_name || deal.title || '',
        onSaved: () => onChatOpened(deal.contact_phone),
      });
    });
  }

  function positionChatTasksRow() {
    const row = document.getElementById('fp-chat-tasks');
    const strip = document.getElementById('fp-chat-strip');
    if (!row || !strip) return;
    const stripRect = strip.getBoundingClientRect();
    row.style.top = `${Math.round(stripRect.bottom)}px`;
    row.style.left = strip.style.getPropertyValue('--fp-chat-strip-left') || `${stripRect.left}px`;
    row.style.right = strip.style.getPropertyValue('--fp-chat-strip-right') || '0px';
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
        data: { name, phone: cleanPhone, value: 0, source: 'WhatsApp', stage: stageId, assigned_to: currentMemberId || null },
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
          <div class="fp-mf"><label class="fp-ml">Tipo de ensaio</label><div id="fp-ed-type-slot"></div></div>
          ${deal.value != null ? `<div class="fp-mf"><label class="fp-ml">Valor (R$)</label><input class="fp-mi" id="fp-ed-value" type="number" value="${Number(deal.value) || 0}" /></div>` : ''}
          <div class="fp-mf"><label class="fp-ml">E-mail</label><input class="fp-mi" id="fp-ed-email" value="${esc(deal.contact_email || '')}" /></div>
          <div class="fp-mf"><label class="fp-ml">Origem</label><div id="fp-ed-source-slot"></div></div>
          <div class="fp-mf"><label class="fp-ml">Etapa do funil</label><div id="fp-ed-stage-slot"></div></div>
          <div class="fp-mf"><label class="fp-ml">Vendedor responsável</label><div id="fp-ed-assign-slot"></div></div>
          <div class="fp-mf"><label class="fp-ml">Observações</label><textarea class="fp-mi fp-edit-notes" id="fp-ed-notes" placeholder="Detalhes do atendimento, pacote, data provável...">${esc(notes)}</textarea></div>
        </div>
        <div class="fp-mrow fp-deal-edit-actions">
          <button class="fp-btn-w" id="fp-deal-edit-cancel">Cancelar</button>
          <button class="fp-btn-g" id="fp-deal-edit-save">Salvar</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    // Picker de etapa (fpSelect) — guarda instância no slot pra ler depois
    const stageSlot = modal.querySelector('#fp-ed-stage-slot');
    const stageSel = fpSelect({
      items: ordered.map((s) => ({ value: s.id, label: s.name, swatch: s.color || undefined })),
      value: deal.stage,
      placeholder: 'Etapa do funil',
      searchable: ordered.length > 5,
    });
    stageSlot.appendChild(stageSel.element);
    stageSlot._fpSel = stageSel;

    // Tipo de ensaio e Origem como DROPDOWN (igual ao "Novo Lead"), não mais
    // texto livre. Inclui o valor atual na lista se for legado fora do padrão.
    const typeBase = getTiposEnsaio();
    const typeItems = [{ value: '', label: 'Selecione (opcional)' }]
      .concat(((shootType && !typeBase.includes(shootType)) ? [shootType, ...typeBase] : typeBase).map((t) => ({ value: t, label: t })));
    const typeSlot = modal.querySelector('#fp-ed-type-slot');
    const typeSel = fpSelect({ items: typeItems, value: shootType || '', placeholder: 'Selecione (opcional)', searchable: typeBase.length > 6 });
    typeSlot.appendChild(typeSel.element);
    typeSlot._fpSel = typeSel;

    const curSource = deal.lead_source || '';
    const sourceItems = [{ value: '', label: 'Sem origem definida' }]
      .concat(((curSource && !LEAD_SOURCE_OPTIONS.includes(curSource)) ? [curSource, ...LEAD_SOURCE_OPTIONS] : LEAD_SOURCE_OPTIONS).map((s) => ({ value: s, label: s })));
    const sourceSlot = modal.querySelector('#fp-ed-source-slot');
    const sourceSel = fpSelect({ items: sourceItems, value: curSource, placeholder: 'Escolher origem', searchable: false });
    sourceSlot.appendChild(sourceSel.element);
    sourceSlot._fpSel = sourceSel;

    // Popula o select de vendedor (current value e lista) + re-popula após fetch
    populateAssigneeSelect('fp-ed-assign', deal.assigned_to);
    loadTeamAndMe().then(() => populateAssigneeSelect('fp-ed-assign', deal.assigned_to));

    const close = () => modal.remove();
    bindOverlayClose(modal, close);
    modal.querySelector('#fp-deal-edit-close')?.addEventListener('click', close);
    modal.querySelector('#fp-deal-edit-cancel')?.addEventListener('click', close);
    modal.querySelector('#fp-deal-edit-save')?.addEventListener('click', () => saveDealEdit(deal, modal));
  }

  async function saveDealEdit(deal, modal) {
    const name = modal.querySelector('#fp-ed-name')?.value.trim() || deal.contact_phone || deal.title || 'Lead';
    const phone = digits(modal.querySelector('#fp-ed-phone')?.value || '');
    const shootType = (modal.querySelector('#fp-ed-type-slot')?._fpSel?.getValue() || '').trim();
    // Campo de valor só existe pra quem tem permissão "Financeiro" (senão vem null
    // do backend e o input nem é renderizado) — aí NÃO mexe no value do deal.
    const valueEl = modal.querySelector('#fp-ed-value');
    const email = modal.querySelector('#fp-ed-email')?.value.trim() || null;
    const source = (modal.querySelector('#fp-ed-source-slot')?._fpSel?.getValue() || '').trim() || null;
    const stage = modal.querySelector('#fp-ed-stage-slot')?._fpSel?.getValue() || deal.stage;
    const assigned_to = modal.querySelector('#fp-ed-assign-slot')?._fpSel?.getValue() || null;
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
      ...(valueEl ? { value: Number(valueEl.value) || 0 } : {}),
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

  const LOST_REASONS = ['Não quis fechar', 'Preço', 'Concorrência', 'Sem resposta', 'Desistiu', 'Data indisponível', 'Outro'];

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
            <div id="fp-lost-reason-slot"></div>
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

    const reasonSel = fpSelect({
      items: LOST_REASONS.map((r) => ({ value: r, label: r })),
      value: currentReason,
      placeholder: 'Selecione o motivo',
    });
    const reasonSlot = modal.querySelector('#fp-lost-reason-slot');
    reasonSlot.appendChild(reasonSel.element);
    reasonSlot._fpSel = reasonSel;

    const close = () => modal.remove();
    bindOverlayClose(modal, close);
    modal.querySelector('#fp-lost-close')?.addEventListener('click', close);
    modal.querySelector('#fp-lost-cancel')?.addEventListener('click', close);
    modal.querySelector('#fp-lost-save')?.addEventListener('click', () => saveLostDeal(deal, modal, targetStage?.id || stageId));
  }

  async function saveLostDeal(deal, modal, stageId) {
    const reason = modal.querySelector('#fp-lost-reason-slot')?._fpSel?.getValue()?.trim();
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
    const slot = modal.querySelector('#fp-win-client-select-slot');
    if (!slot) return;

    const placeholder = (label) => {
      const sel = fpSelect({ items: [{ value: '', label }], value: '', placeholder: label });
      slot.innerHTML = '';
      slot.appendChild(sel.element);
      slot._fpSel = sel;
    };

    try {
      const clients = await bg({ type: 'GET_CLIENTS' });
      const items = [{ value: '', label: 'Selecione um cliente' }]
        .concat((clients || []).map((c) => ({
          value: String(c.id),
          label: `${c.name || 'Cliente'}${c.phone ? ` — ${c.phone}` : ''}`,
        })));
      const sel = fpSelect({
        items,
        value: '',
        placeholder: 'Buscar cliente…',
        searchable: true,
      });
      slot.innerHTML = '';
      slot.appendChild(sel.element);
      slot._fpSel = sel;
    } catch {
      placeholder('Não foi possível carregar clientes');
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

  // Aceita tanto <select> nativo quanto um slot com fpSelect (._fpSel) — usa
  // o conteúdo textual da opção pra fazer match com o valor extraído da conversa.
  function setSelectByText(target, value) {
    if (!target || !value) return false;
    const wanted = normalizeCadastroText(value);

    // Caminho fpSelect: aceita o slot (com _fpSel) ou a própria instância
    const fp = target._fpSel || (typeof target.getValue === 'function' ? target : null);
    if (fp) {
      const items = fp.getItems();
      const item = items.find((it) => {
        const lbl = normalizeCadastroText(it.label || it.value);
        return lbl && (wanted.includes(lbl) || lbl.includes(wanted));
      }) || items.find((it) => normalizeCadastroText(it.label || it.value) === 'outro');
      if (item) {
        fp.setValue(item.value);
        return true;
      }
      return false;
    }

    // Caminho legado <select>
    const select = target;
    if (!select.options) return false;
    const wantedOpt = Array.from(select.options).find((opt) => {
      const label = normalizeCadastroText(opt.value || opt.textContent);
      return label && (wanted.includes(label) || label.includes(wanted));
    });
    if (wantedOpt) {
      select.value = wantedOpt.value;
      return true;
    }
    const other = Array.from(select.options).find((opt) => normalizeCadastroText(opt.value || opt.textContent) === 'outro');
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
    if (setSelectByText(modal.querySelector('#fp-win-client-found-slot'), data.found)) filled += 1;

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
    const slot = modal.querySelector('#fp-win-catalog-select-slot');
    if (!slot) return;

    const placeholder = (label) => {
      const sel = fpSelect({ items: [{ value: '', label }], value: '', placeholder: label });
      slot.innerHTML = '';
      slot.appendChild(sel.element);
      slot._fpSel = sel;
    };
    placeholder('Carregando catálogo…');

    try {
      const catalog = await bg({ type: 'GET_CATALOG' });
      const items = normalizeCatalogForConversion(catalog);
      modal.__fpCatalogItems = items;
      if (!items.length) {
        placeholder('Nenhum item ativo no catálogo');
        return;
      }
      const opts = [{ value: '', label: 'Selecione um item' }]
        .concat(items.map((item, index) => ({
          value: String(index),
          label: `${catalogTypeLabel(item.type)} — ${item.name} (${brl.format(item.value)})`,
        })));
      const sel = fpSelect({
        items: opts,
        value: '',
        placeholder: 'Buscar produto/serviço/combo…',
        searchable: true,
      });
      slot.innerHTML = '';
      slot.appendChild(sel.element);
      slot._fpSel = sel;
      autoAddCatalogFromConversation(modal);
    } catch (err) {
      placeholder('Erro ao carregar catálogo');
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
    const sel = modal.querySelector('#fp-win-catalog-select-slot')?._fpSel;
    const qtyInput = modal.querySelector('#fp-win-catalog-qty');
    const catalog = Array.isArray(modal.__fpCatalogItems) ? modal.__fpCatalogItems : [];
    const selectedIdx = sel?.getValue();
    const selected = catalog[Number(selectedIdx)];
    const quantity = Math.max(1, Number(qtyInput?.value) || 1);
    if (!selected) {
      toast('Selecione um produto, serviço ou combo', true);
      return;
    }

    modal.__fpSelectedCatalogItems = [
      ...selectedCatalogItems(modal),
      { ...selected, quantity, existing: false },
    ];
    if (sel) sel.setValue('');
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

          <div class="fp-won-grid">
            <div class="fp-mf"><label class="fp-ml">Data da venda</label><input class="fp-mi" id="fp-win-sold-date" type="date" value="${todayISO()}" max="${todayISO()}" /></div>
            <div class="fp-mf"><label class="fp-ml" style="opacity:.65;text-transform:none;font-weight:500">Venda antiga? Escolha o dia real do fechamento — os relatórios usam esta data.</label></div>
          </div>

          <div class="fp-won-existing fp-hidden">
            <div class="fp-mf"><label class="fp-ml">Cliente existente</label><div id="fp-win-client-select-slot"></div></div>
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
                <div id="fp-win-client-found-slot"></div>
              </div>
              <div class="fp-mf"><label class="fp-ml">Observações do cliente</label><input class="fp-mi" id="fp-win-client-notes" value="${esc(notes)}" /></div>
            </div>
          </div>

          <label class="fp-won-check"><input type="checkbox" id="fp-win-create-job" checked /> Criar trabalho/ensaio junto</label>

          <div class="fp-won-section fp-won-job-section">
            <div class="fp-won-section-title">Dados do trabalho</div>
            <div class="fp-won-grid fp-won-grid-4">
              <div class="fp-mf"><label class="fp-ml">Tipo *</label>
                <div id="fp-win-job-type-slot"></div>
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
                <div id="fp-win-catalog-select-slot"></div>
                <input class="fp-mi fp-catalog-qty" id="fp-win-catalog-qty" type="number" min="1" value="1" title="Quantidade" />
                <button class="fp-btn-g fp-catalog-add" type="button" id="fp-win-catalog-add">Adicionar</button>
              </div>
              <div class="fp-catalog-list" id="fp-win-catalog-list"></div>
            </div>
            <div class="fp-won-grid fp-won-grid-4">
              <div class="fp-mf"><label class="fp-ml">Valor total</label><input class="fp-mi" id="fp-win-job-amount" type="number" value="0" readonly /></div>
              <div class="fp-mf"><label class="fp-ml">Sinal pago</label><input class="fp-mi" id="fp-win-sinal" type="number" value="0" /></div>
              <div class="fp-mf"><label class="fp-ml">Forma de pagamento</label>
                <div id="fp-win-payment-method-slot"></div>
              </div>
              <div class="fp-mf"><label class="fp-ml">Status</label>
                <div id="fp-win-job-status-slot"></div>
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

    // ─── Pickers premium (substituem os <select> nativos) ───
    const foundOpts = ['Instagram', 'Facebook', 'Google', 'Indicação', 'Site', 'WhatsApp', 'Outro'];
    const foundSel = fpSelect({
      items: [{ value: '', label: 'Selecione' }, ...foundOpts.map((o) => ({ value: o, label: o }))],
      value: '',
      placeholder: 'Selecione',
    });
    const foundSlot = modal.querySelector('#fp-win-client-found-slot');
    foundSlot.appendChild(foundSel.element);
    foundSlot._fpSel = foundSel;

    // Lista mestre (mesma do app); inclui o tipo atual do lead se foi removido
    const jobTypes = (() => {
      const base = getTiposEnsaio();
      return shootType && !base.includes(shootType) ? [shootType, ...base] : base;
    })();
    const typeSel = fpSelect({
      items: jobTypes.map((t) => ({ value: t, label: t })),
      value: jobTypes.includes(shootType) ? shootType : jobTypes[0],
      placeholder: 'Tipo de ensaio',
    });
    const typeSlot = modal.querySelector('#fp-win-job-type-slot');
    typeSlot.appendChild(typeSel.element);
    typeSlot._fpSel = typeSel;

    const paymentSel = fpSelect({
      items: [
        { value: 'Pix', label: 'Pix' },
        { value: 'Cartão de Crédito', label: 'Cartão de Crédito' },
        { value: 'Cartão de Débito', label: 'Cartão de Débito' },
        { value: 'Dinheiro', label: 'Dinheiro' },
        { value: 'Boleto', label: 'Boleto' },
        { value: 'Transferência', label: 'Transferência' },
      ],
      value: 'Pix',
      placeholder: 'Forma de pagamento',
    });
    const paymentSlot = modal.querySelector('#fp-win-payment-method-slot');
    paymentSlot.appendChild(paymentSel.element);
    paymentSlot._fpSel = paymentSel;

    const statusSel = fpSelect({
      items: [
        { value: 'scheduled',   label: 'Agendado' },
        { value: 'in_progress', label: 'Em andamento' },
        { value: 'editing',     label: 'Em edição' },
        { value: 'completed',   label: 'Concluído' },
        { value: 'delivered',   label: 'Entregue' },
        { value: 'cancelled',   label: 'Cancelado' },
      ],
      value: 'scheduled',
      placeholder: 'Status',
    });
    const statusSlot = modal.querySelector('#fp-win-job-status-slot');
    statusSlot.appendChild(statusSel.element);
    statusSlot._fpSel = statusSel;

    // Cliente existente e catálogo são populados depois (load*ForConversion)
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

    bindOverlayClose(modal, close);
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
    const el = modal.querySelector(selector);
    if (!el) return '';
    // Slot do fpSelect? Lê pelo helper
    if (el._fpSel) return String(el._fpSel.getValue() || '').trim();
    return el.value?.trim() || '';
  }

  async function saveWonConversion(deal, modal) {
    const mode = modal.querySelector('input[name="fp-win-mode"]:checked')?.value || 'new';
    const createJob = !!modal.querySelector('#fp-win-create-job')?.checked;
    const createClient = mode === 'new';
    const existingClientId = mode === 'existing' ? Number(val(modal, '#fp-win-client-select-slot')) || undefined : undefined;

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
      how_found: val(modal, '#fp-win-client-found-slot'),
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
      job_type: val(modal, '#fp-win-job-type-slot') || 'Gestante',
      job_date: val(modal, '#fp-win-job-date') || todayISO(),
      job_time: val(modal, '#fp-win-job-time') || null,
      job_end_time: val(modal, '#fp-win-job-end') || null,
      job_name: val(modal, '#fp-win-job-name') || deal.title,
      amount,
      payment_method: val(modal, '#fp-win-payment-method-slot') || 'Pix',
      payment_status: autoPaymentStatus(amount, sinalAmount),
      status: val(modal, '#fp-win-job-status-slot') || 'scheduled',
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
      const soldDate = val(modal, '#fp-win-sold-date');
      await bg({
        type: 'CONVERT_DEAL',
        dealId: deal.id,
        data: { existingClientId, createClient, createJob, client, job, sinalAmount: sinalAmount > 0 ? sinalAmount : undefined, converted_at: soldDate || undefined },
      });
      deal.stage = (stages.find(isWonStage) || stages.find(s => s.id === 'won'))?.id || deal.stage;
      deal.converted = true;
      deal.converted_at = soldDate ? `${soldDate}T12:00:00.000Z` : new Date().toISOString();
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
      celebrateSale();
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

    // Limpa "handle do Instagram colado" — ex.: "Clélia liaborgesfotografia"
    // ou "Maria fotografiaoficial". Se tem pelo menos um token capitalizado
    // e outro token todo minúsculo, longo, sem separador, é quase sempre o
    // @handle/empresa colado. Mantém só os tokens "de nome".
    const tokens = name.split(/\s+/);
    if (tokens.length > 1) {
      const hasCapitalized = tokens.some((t) => /^[A-ZÀ-Ý]/.test(t));
      if (hasCapitalized) {
        const isHandle = (tok) =>
          /^[a-z][a-z0-9_.]{7,}$/.test(tok) || // tudo minúsculo, 8+ chars
          /(fotografia|fotograf|studio|estudio|oficial|official|photo|photos|atelier)$/i.test(tok) && tok.length > 6;
        const filtered = tokens.filter((tok) => !isHandle(tok));
        if (filtered.length && filtered.length !== tokens.length) {
          name = filtered.join(' ');
        }
      }
    }

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
  function isFullscreenOverlayVisible() {
    if (kanbanVisible) return true;
    const ids = ['fp-agenda', 'fp-production', 'fp-tasks'];
    return ids.some((id) => {
      const el = document.getElementById(id);
      return el && !el.classList.contains('fp-hidden');
    });
  }

  function detectState() {
    // Logo após ESC, mantém a faixa escondida até a janela de supressão
    // passar — assim ela não pisca de volta enquanto o chat fecha.
    if (Date.now() < suppressChatStripUntil) { removeChatStrip(); return; }
    // Algum overlay TELA-CHEIA (Pipeline/Agenda/Produção/Tarefas) aberto =
    // não monta strip do chat.
    if (isFullscreenOverlayVisible()) return;

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

  // Varre rápido (a cada 80ms por ~3s) pra montar a faixa do lead assim
  // que o WhatsApp renderiza o chat — sem o atraso fixo do debounce.
  let detectPoll = null;
  function fastDetect() {
    clearTimeout(detectDebounce);
    if (detectPoll) clearInterval(detectPoll);
    let n = 0;
    detectState();
    // Mesma janela de ~3s pra pegar o chat enquanto o WhatsApp renderiza, mas
    // com METADE das varreduras (150ms em vez de 80ms) — menos CPU e menos "pisca".
    detectPoll = setInterval(() => {
      detectState();
      if (++n >= 20) { clearInterval(detectPoll); detectPoll = null; }
    }, 150);
  }

  function startObserver() {
    document.addEventListener('click', (e) => {
      // Ignora clicks dentro do próprio kanban (cards, botões etc.)
      if (e.target.closest('#fp-kanban, #fp-modal, #fp-deal-edit-modal, #fp-fab, #fp-chat-strip, #fp-stage-menu')) return;

      // Clique no ícone "Conversas/Chats" nativo do WhatsApp → fecha
      // qualquer overlay do CRM e volta pras mensagens. Sem isso, estando
      // no Pipeline (ou Tarefas/Produção/Agenda) o ícone do WhatsApp não
      // trocava de tela — o overlay continuava por cima.
      const chatsNav = e.target.closest('[aria-label*="onversas" i], [aria-label*="hats" i]');
      if (chatsNav && !e.target.closest('#fp-rail-mounted')) {
        suppressChatStripUntil = 0;
        if (kanbanVisible) hideKanban();
        hideOverlaysForChatNav();
        fastDetect();
        return;
      }

      const item = e.target.closest('[role="listitem"], [data-testid="cell-frame-container"]');
      if (item) {
        if (Date.now() < suppressChatListClickUntil) return;
        // Usuário clicou na lista do WhatsApp → libera o #main em qualquer
        // overlay aberto (Pipeline, Tarefas, Agenda, Produção). Sem isso
        // o overlay continuaria cobrindo o campo de mensagem e o usuário
        // não conseguiria responder.
        suppressChatStripUntil = 0;
        if (kanbanVisible) hideKanban();
        hideOverlaysForChatNav();
        fastDetect();
      }
    }, true);

    // ESC no WhatsApp Web fecha a conversa — esconde a faixa do CRM junto.
    // Remove na hora e suprime a re-detecção por um instante pra ela não
    // voltar sozinha enquanto o WhatsApp termina de fechar o chat.
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && document.getElementById('fp-chat-strip')) {
        suppressChatStripUntil = Date.now() + 1200;
        chatKey = null;
        chatPhone = null;
        chatDeal = null;
        if (detectPoll) { clearInterval(detectPoll); detectPoll = null; }
        clearTimeout(detectDebounce);
        removeChatStrip();
      }
    }, true);

    let lastStripPos = 0;
    new MutationObserver(() => {
      // Garante que a rail nativa sobreviva às re-renderizações da sidebar
      if (!document.getElementById('fp-rail-mounted')?.isConnected) mountNativeRail();
      if (kanbanVisible) return;
      // O WhatsApp re-renderiza o DOM dezenas de vezes/seg (digitando, rolando).
      // positionChatStrip faz getBoundingClientRect (reflow) — limitamos a ~8x/seg
      // pra não travar a digitação. A detecção do chat já é debounced (500ms).
      const now = Date.now();
      if (now - lastStripPos >= 120) { lastStripPos = now; positionChatStrip(); }
      clearTimeout(detectDebounce);
      detectDebounce = setTimeout(detectState, 500);
    }).observe(document.body, { childList: true, subtree: true });
  }

  // ===== MODAL =====
  function populateModalStages(defaultStageId) {
    const slot = document.getElementById('fp-msid-slot');
    if (!slot) return;

    const list = orderedStages(chatStages.length ? chatStages : stages);
    const items = list.map((s) => ({ value: s.id, label: s.name, swatch: s.color || undefined }));
    const fallback = list.find((s) => s.id === defaultStageId)?.id || firstOpenStage(list)?.id || list[0]?.id || '';

    if (!modalStageSel) {
      modalStageSel = fpSelect({
        items,
        value: fallback,
        placeholder: list.length ? 'Selecione a etapa' : 'Carregando etapas…',
      });
      slot.innerHTML = '';
      slot.appendChild(modalStageSel.element);
    } else {
      modalStageSel.setItems(items);
      modalStageSel.setValue(fallback);
    }
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

  function populateAssigneeSelect(slotId, currentValue) {
    const slot = document.getElementById(slotId + '-slot') || document.getElementById(slotId);
    if (!slot) return;
    const value = currentValue || '';
    const items = [{ value: '', label: 'Sem responsável' }]
      .concat(teamMembers.map((m) => ({ value: m.id, label: m.name })));

    // O id determina qual instância armazenamos (modal Novo Lead vs. edição)
    const isNew = slotId === 'fp-massign';
    const existing = isNew ? modalAssignSel : null;
    if (existing) {
      existing.setItems(items);
      existing.setValue(value);
      return;
    }
    const sel = fpSelect({
      items,
      value,
      placeholder: 'Sem responsável',
      searchable: teamMembers.length > 5,
    });
    slot.innerHTML = '';
    slot.appendChild(sel.element);
    if (isNew) modalAssignSel = sel;
    // Para selects de edição (não-Novo-Lead), guardamos a instância no próprio slot
    else slot._fpSel = sel;
  }

  function populateSourceSelect(currentValue) {
    const slot = document.getElementById('fp-msource-slot');
    if (!slot) return;
    const value = currentValue || '';
    const items = [{ value: '', label: 'Sem origem definida' }]
      .concat(LEAD_SOURCE_OPTIONS.map((source) => ({ value: source, label: source })));

    if (modalSourceSel) {
      modalSourceSel.setItems(items);
      modalSourceSel.setValue(value);
      return;
    }

    const sel = fpSelect({
      items,
      value,
      placeholder: 'Escolher origem',
      searchable: false,
    });
    slot.innerHTML = '';
    slot.appendChild(sel.element);
    modalSourceSel = sel;
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
    populateSourceSelect(fromChat ? 'WhatsApp' : '');
    // Tipo de ensaio: lista mestre (mesma dos outros formulários)
    const typeSlot = document.getElementById('fp-mtype-slot');
    if (typeSlot) {
      const typeSel = fpSelect({
        items: [{ value: '', label: 'Selecione (opcional)' }, ...getTiposEnsaio().map((t) => ({ value: t, label: t }))],
        value: '',
        placeholder: 'Selecione (opcional)',
        searchable: false,
      });
      typeSlot.innerHTML = '';
      typeSlot.appendChild(typeSel.element);
      modalTypeSel = typeSel;
    }
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
    modalSourceSel?.setValue('');
    modalTypeSel?.setValue('');
    modalContext = { fromChat: false };
  }

  async function saveNewDeal() {
    let name = document.getElementById('fp-mn')?.value.trim();
    const phone = digits(document.getElementById('fp-mp')?.value || '');
    const value = Number(document.getElementById('fp-mv')?.value) || 0;
    const source = modalSourceSel?.getValue() || (modalContext.fromChat ? 'WhatsApp' : null);
    const shootType = modalTypeSel?.getValue() || '';
    const stage = modalStageSel?.getValue() || undefined;
    const assigned_to = modalAssignSel?.getValue() || null;
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
      // Tipo de ensaio vai como meta nas notas (formato lido por getDealShootType)
      await bg({ type: 'CREATE_DEAL', data: { name, phone, value, source, stage, assigned_to, notes: shootType ? buildDealNotes(shootType, '') : undefined } });
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
  // Auto-refresh (tempo real): a cada 5s atualiza em silêncio o funil aberto,
  // pra refletir mudanças feitas no app/por outra pessoa sem recarregar a página.
  // Pausa durante arraste de card (o rebuild do DOM cortaria o drag) e quando a
  // aba do navegador está oculta. O loadKanban silencioso só rebuilda se mudou.
  let liveRefreshTimer = null;
  function startLiveRefresh() {
    if (liveRefreshTimer) return;
    liveRefreshTimer = setInterval(() => {
      if (document.hidden) return;
      if (pointerDrag !== null || draggingId !== null || draggingInboxIdx !== null) return;
      const kanbanEl = document.getElementById('fp-kanban');
      if (kanbanEl && !kanbanEl.classList.contains('fp-hidden')) {
        loadKanban({ silent: true });
      }
    }, 12000);
  }

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
    // Lista mestre de tipos de ensaio (selects dos modais usam — fallback se falhar)
    loadTiposEnsaio();
    startLiveRefresh();
  }

  if (document.readyState === 'complete') setTimeout(init, 1800);
  else window.addEventListener('load', () => setTimeout(init, 1800));
})();

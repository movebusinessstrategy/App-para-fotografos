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

  // ===== STATE =====
  let deals = [], stages = [];
  let chatPhone = null, chatDeal = null, chatStages = [];
  let draggingId = null;
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
        <button id="fp-kh-refresh">↺</button>
        <button id="fp-kh-add">+ Novo Lead</button>
      </div>
      <div id="fp-board"></div>
    `;
    document.body.appendChild(k);

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
        <div class="fp-mrow">
          <button class="fp-btn-w" id="fp-mc">Cancelar</button>
          <button class="fp-btn-g" id="fp-ms">Criar</button>
        </div>
      </div>
    `;
    document.body.appendChild(m);

    // Eventos base
    document.getElementById('fp-kh-refresh').onclick = () => loadKanban();
    document.getElementById('fp-kh-add').onclick = () => openModal();
    document.getElementById('fp-q').oninput = (e) => { q = e.target.value.toLowerCase(); renderBoard(); };
    document.getElementById('fp-mc').onclick = closeModal;
    document.getElementById('fp-ms').onclick = saveNewDeal;
    m.onclick = (e) => { if (e.target === m) closeModal(); };

    // Drop global
    window.__fpDrop = drop;

    // Ajusta posição baseada na largura do painel lateral do WA
    adjustPosition();
    window.addEventListener('resize', adjustPosition);
  }

  function adjustPosition() {
    const side = document.querySelector('#side, #pane-side, [data-testid="chat-list"]')?.getBoundingClientRect();
    const left = side ? Math.round(side.right) : 380;
    document.getElementById('fp-kanban')?.style.setProperty('--fp-side-width', left + 'px');
    const k = document.getElementById('fp-kanban');
    if (k) k.style.left = left + 'px';
  }

  // ===== KANBAN =====
  async function loadKanban() {
    showBoardState('<div class="fp-spin"></div><span>Carregando pipeline...</span>');
    try {
      const [dr, sr] = await Promise.all([bg({ type: 'GET_ALL_DEALS' }), bg({ type: 'GET_STAGES' })]);
      deals = dr || [];
      stages = sr || [];
      renderBoard();
    } catch (err) {
      if (/autenticado|login/i.test(err.message)) {
        showBoardState(`
          <svg width="36" height="36" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
          <p style="font-weight:700;color:#111b21">Faça login para ver o pipeline</p>
          <button class="fp-btn-g" style="padding:9px 22px" onclick="chrome.runtime.sendMessage({type:'OPEN_LOGIN_TAB'})">Fazer login</button>
        `);
      } else {
        showBoardState(`<p style="color:#e53935">${esc(err.message)}</p><button class="fp-btn-w" style="padding:8px 18px" onclick="window.__fpReload()">Tentar novamente</button>`);
        window.__fpReload = loadKanban;
      }
    }
  }

  function showBoardState(html) {
    const b = document.getElementById('fp-board');
    if (b) b.innerHTML = `<div class="fp-board-state">${html}</div>`;
  }

  function renderBoard() {
    const b = document.getElementById('fp-board');
    if (!b) return;
    const active = stages.filter(s => !s.is_final);
    const finals = stages.filter(s => s.is_final);
    const all = [...active, ...finals];
    if (!all.length) { showBoardState('<p>Nenhuma etapa encontrada.</p>'); return; }

    b.innerHTML = all.map((s, i) => {
      const c = C(s.position ?? i);
      const sd = deals.filter(d => d.stage === s.id && matches(d));
      const total = sd.reduce((t, d) => t + (d.value || 0), 0);
      return `
        <div class="fpc">
          <div class="fpc-hd">
            <div class="fpc-title" style="color:${c.text}">
              <span class="fpc-dot" style="background:${c.dot}"></span>${esc(s.name)}
            </div>
            <div class="fpc-meta">${sd.length} lead${sd.length !== 1 ? 's' : ''} · ${brl.format(total)}</div>
          </div>
          <div class="fpc-body" id="fpb-${s.id}"
            ondragover="event.preventDefault();this.classList.add('dp-over')"
            ondragleave="this.classList.remove('dp-over')"
            ondrop="window.__fpDrop('${s.id}',this)">
            ${sd.length ? sd.map(d => card(d, c)).join('') : '<div class="fpc-empty">Nenhum lead aqui</div>'}
          </div>
        </div>`;
    }).join('');

    b.querySelectorAll('.fpc-card').forEach(bindCard);
  }

  function matches(d) {
    if (!q) return true;
    return `${d.contact_name || d.title || ''} ${d.contact_phone || ''}`.toLowerCase().includes(q);
  }

  function card(d, c) {
    const name = d.contact_name || d.title || 'Sem nome';
    const phone = d.contact_phone || '';
    const sub = phone ? `+${digits(phone).replace(/(\d{2})(\d{2})(\d{5})(\d{4})/, '$1 ($2) $3-$4')}` : (d.notes?.split('\n')[0]?.substring(0, 40) || '');
    return `
      <div class="fpc-card" draggable="true" data-id="${d.id}" data-phone="${esc(phone)}">
        <div class="fpc-card-top">
          <div class="fpc-av" style="background:${c.dot}">${esc(initials(name))}</div>
          <div class="fpc-info">
            <div class="fpc-name">${esc(name)}</div>
            <div class="fpc-sub">${esc(sub)}</div>
          </div>
          <div class="fpc-date">${fmtDate(d.updated_at || d.created_at)}</div>
        </div>
        <div class="fpc-card-bot">
          <span class="fpc-val">${d.value ? brl.format(d.value) : '—'}</span>
          ${phone ? `<button class="fpc-open" data-phone="${esc(phone)}">Abrir chat →</button>` : ''}
        </div>
      </div>`;
  }

  function bindCard(el) {
    const id = Number(el.dataset.id);
    const phone = el.dataset.phone;

    el.addEventListener('dragstart', e => {
      draggingId = id;
      el.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    el.addEventListener('dragend', () => {
      el.classList.remove('dragging');
      document.querySelectorAll('.dp-over').forEach(x => x.classList.remove('dp-over'));
    });

    const ob = el.querySelector('.fpc-open');
    if (ob) ob.addEventListener('click', e => { e.stopPropagation(); openChat(phone); });

    el.addEventListener('click', () => openChat(phone));
  }

  async function drop(stageId, col) {
    col.classList.remove('dp-over');
    if (!draggingId) return;
    const deal = deals.find(d => d.id === draggingId);
    if (!deal || deal.stage === stageId) { draggingId = null; return; }

    const prev = deal.stage;
    deal.stage = stageId;
    renderBoard();

    try {
      await bg({ type: 'MOVE_STAGE', dealId: draggingId, stageId });
      const sn = stages.find(s => s.id === stageId)?.name || stageId;
      toast(`Movido para "${sn}"!`);
    } catch (err) {
      deal.stage = prev;
      renderBoard();
      toast(err.message, true);
    }
    draggingId = null;
  }

  // ===== ABRIR CHAT NO WA =====
  function openChat(phone) {
    if (!phone) return;
    const p = digits(phone);

    // Tenta clicar na conversa na lista do WA
    const items = document.querySelectorAll('[data-testid="cell-frame-container"], [role="listitem"]');
    for (const item of items) {
      const t = digits(item.textContent || '');
      if (t.includes(p.slice(-8))) {
        item.click();
        hideKanban();
        return;
      }
    }

    // Fallback: abre via wa.me
    hideKanban();
    window.location.href = `https://web.whatsapp.com/send?phone=${p}`;
  }

  function hideKanban() {
    kanbanVisible = false;
    const k = document.getElementById('fp-kanban');
    if (k) k.classList.add('fp-hidden');
  }

  function showKanban() {
    kanbanVisible = true;
    adjustPosition();
    const k = document.getElementById('fp-kanban');
    if (k) k.classList.remove('fp-hidden');
    loadKanban();
  }

  // ===== FAIXA CRM NO CHAT =====
  function injectChatStrip(deal, stgs) {
    removeChatStrip();
    const stage = stgs.find(s => s.id === deal?.stage);
    const c = C(stage?.position ?? 0);

    const strip = document.createElement('div');
    strip.id = 'fp-chat-strip';

    const activeSt = stgs.filter(s => !s.is_final);
    const finalSt = stgs.filter(s => s.is_final);
    const all = [...activeSt, ...finalSt];

    strip.innerHTML = `
      <span class="fp-strip-label">Fase:</span>
      <span class="fp-strip-badge" style="background:${c.bg};color:${c.text}">
        <span class="fp-strip-dot" style="background:${c.dot}"></span>
        ${esc(stage?.name || 'Sem fase')}
      </span>
      <span class="fp-strip-sep">|</span>
      <div class="fp-strip-stages">
        ${all.map(s => {
          const sc = C(s.position ?? 0);
          const active = s.id === (deal?.stage);
          return `<button class="fp-strip-stage-btn ${active ? 'fp-active' : ''}" data-sid="${s.id}" title="${esc(s.name)}"
            style="${active ? `border-color:${sc.dot};background:${sc.bg};color:${sc.text}` : ''}">
            ${esc(s.name)}
          </button>`;
        }).join('')}
      </div>
      <button class="fp-strip-stage-btn" id="fp-strip-funil" style="margin-left:auto;background:#111b21;color:#fff;border-color:#111b21">⬡ Funil</button>
    `;

    strip.querySelectorAll('[data-sid]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!deal) return;
        const sid = btn.dataset.sid;
        if (sid === deal.stage) return;
        btn.textContent = '...';
        btn.disabled = true;
        try {
          await bg({ type: 'MOVE_STAGE', dealId: deal.id, stageId: sid });
          deal.stage = sid;
          chatDeal = deal;
          // Atualiza no array global
          const gd = deals.find(d => d.id === deal.id);
          if (gd) gd.stage = sid;
          const sn = stgs.find(s => s.id === sid)?.name || sid;
          toast(`Fase: ${sn}`);
          injectChatStrip(deal, stgs);
        } catch (err) { toast(err.message, true); injectChatStrip(deal, stgs); }
      });
    });

    document.getElementById('fp-strip-funil')?.addEventListener('click', showKanban);

    // Injeta após o header do chat
    const target =
      document.querySelector('[data-testid="conversation-panel-wrapper"]') ||
      document.querySelector('#main') ||
      document.querySelector('[data-testid="conversation-header"]')?.parentElement;

    if (target) {
      const header = target.querySelector('[data-testid="conversation-header"]') || target.firstElementChild;
      if (header?.nextSibling) {
        target.insertBefore(strip, header.nextSibling);
      } else {
        target.prepend(strip);
      }
    }
  }

  function removeChatStrip() {
    document.getElementById('fp-chat-strip')?.remove();
  }

  async function onChatOpened(phone) {
    if (!phone || phone === chatPhone) return;
    chatPhone = phone;
    chatDeal = null;

    try {
      const result = await bg({ type: 'GET_DEAL_BY_PHONE', phone });
      chatStages = result.stages || stages;
      chatDeal = result.deal;

      if (chatDeal) {
        injectChatStrip(chatDeal, chatStages);
      } else {
        // Contato sem deal — mostra strip mínima com botão "Adicionar"
        injectAddStrip(phone);
      }
    } catch {
      // silencia — não atrapalha o chat
    }
  }

  function injectAddStrip(phone) {
    removeChatStrip();
    const strip = document.createElement('div');
    strip.id = 'fp-chat-strip';
    strip.innerHTML = `
      <span class="fp-strip-label">Não está no pipeline</span>
      <button class="fp-strip-stage-btn" id="fp-strip-add">+ Adicionar ao Pipeline</button>
      <button class="fp-strip-stage-btn" id="fp-strip-funil2" style="margin-left:auto;background:#111b21;color:#fff;border-color:#111b21">⬡ Funil</button>
    `;

    strip.querySelector('#fp-strip-add')?.addEventListener('click', () => {
      openModal(phone, getWAChatName());
    });
    strip.querySelector('#fp-strip-funil2')?.addEventListener('click', showKanban);

    const target = document.querySelector('[data-testid="conversation-panel-wrapper"]') || document.querySelector('#main');
    if (target) {
      const header = target.querySelector('[data-testid="conversation-header"]') || target.firstElementChild;
      if (header?.nextSibling) target.insertBefore(strip, header.nextSibling);
      else target.prepend(strip);
    }
  }

  // ===== DETECTAR CHAT =====
  function getWAChatPhone() {
    const sels = ['[data-testid="conversation-title"]', '#main header span[dir="auto"]', 'header span[dir="auto"]'];
    for (const s of sels) {
      for (const el of document.querySelectorAll(s)) {
        const t = el.textContent?.trim() || '';
        const d = t.replace(/[\s\-\+\(\)]/g, '');
        if (/^\d{8,15}$/.test(d)) return d;
        const m = t.match(/\+?\d[\d\s\-\(\)]{7,}/);
        if (m) { const dd = digits(m[0]); if (dd.length >= 8) return dd; }
      }
    }
    return null;
  }

  function getWAChatName() {
    const sels = ['[data-testid="conversation-title"]', '#main header span[dir="auto"]'];
    for (const s of sels) {
      const el = document.querySelector(s);
      const t = el?.textContent?.trim();
      if (t && !/^\+?\d[\d\s\-\+\(\)]{5,}$/.test(t)) return t;
    }
    return null;
  }

  function isChatOpen() {
    return !!(
      document.querySelector('[data-testid="conversation-panel-body"]') ||
      document.querySelector('[data-testid="msg-container"]') ||
      document.querySelector('[data-testid="conversation-compose-box"]')
    );
  }

  let detectDebounce;
  function detectState() {
    if (kanbanVisible) return; // usuário está vendo o kanban, não precisa detectar

    if (isChatOpen()) {
      const phone = getWAChatPhone();
      if (phone && phone !== chatPhone) onChatOpened(phone);
    } else {
      // Sem chat aberto — volta ao kanban automaticamente
      chatPhone = null;
      removeChatStrip();
    }
  }

  function startObserver() {
    document.addEventListener('click', (e) => {
      const item = e.target.closest('[role="listitem"], [data-testid="cell-frame-container"]');
      if (item) {
        clearTimeout(detectDebounce);
        detectDebounce = setTimeout(detectState, 700);
      }
    }, true);

    new MutationObserver(() => {
      if (kanbanVisible) return;
      clearTimeout(detectDebounce);
      detectDebounce = setTimeout(detectState, 500);
    }).observe(document.body, { childList: true, subtree: true });
  }

  // ===== MODAL =====
  function openModal(phone, name) {
    const m = document.getElementById('fp-modal');
    if (!m) return;
    if (phone) document.getElementById('fp-mp').value = phone;
    if (name) document.getElementById('fp-mn').value = name;
    m.classList.remove('fp-hidden');
    setTimeout(() => document.getElementById('fp-mn')?.focus(), 50);
  }

  function closeModal() {
    const m = document.getElementById('fp-modal');
    if (!m) return;
    m.classList.add('fp-hidden');
    ['fp-mn', 'fp-mp', 'fp-mv'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  }

  async function saveNewDeal() {
    const name = document.getElementById('fp-mn')?.value.trim();
    const phone = digits(document.getElementById('fp-mp')?.value || '');
    const value = Number(document.getElementById('fp-mv')?.value) || 0;
    if (!name) return toast('Nome é obrigatório', true);
    if (!phone) return toast('Telefone é obrigatório', true);
    const btn = document.getElementById('fp-ms');
    btn.textContent = 'Criando...'; btn.disabled = true;
    try {
      await bg({ type: 'CREATE_DEAL', data: { name, phone, value, source: 'whatsapp-extension' } });
      toast('Lead criado!');
      closeModal();
      await loadKanban();
      // Se temos um chat aberto para esse número, atualiza a faixa
      if (chatPhone && digits(chatPhone).includes(phone.slice(-8))) {
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
  }

  if (document.readyState === 'complete') setTimeout(init, 1800);
  else window.addEventListener('load', () => setTimeout(init, 1800));
})();

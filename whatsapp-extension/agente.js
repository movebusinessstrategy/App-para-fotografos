// Lia — assistente de atendimento. Widget isolado no WhatsApp Web.
// Lê a conversa aberta, pede uma sugestão ao backend e (se o usuário
// aprovar) insere/envia no compositor. Mantido separado do content.js.

(function () {
  'use strict';
  if (window.__fpAgenteLoaded) return;
  window.__fpAgenteLoaded = true;

  // ── Estilos ──────────────────────────────────────────────────────
  const style = document.createElement('style');
  style.textContent = `
    @keyframes fpa-twinkle {
      0%, 100% { transform: scale(1); opacity: 1; }
      50% { transform: scale(.78); opacity: .5; }
    }
    #fpa-fab {
      position: fixed; right: 24px; bottom: 104px;
      width: 54px; height: 54px; border-radius: 50%;
      background: #D4A94A; color: #fff;
      border: none; cursor: pointer; z-index: 2147483000;
      box-shadow: 0 4px 16px rgba(0,0,0,.28);
      display: flex; align-items: center; justify-content: center;
      transition: transform .15s ease;
    }
    #fpa-fab:hover { transform: scale(1.08); }
    #fpa-fab svg { animation: fpa-twinkle 1.8s ease-in-out infinite; }
    #fpa-panel {
      position: fixed; right: 24px; bottom: 170px; width: 340px;
      max-height: 72vh; background: #fff; border-radius: 16px;
      box-shadow: 0 10px 40px rgba(0,0,0,.30); z-index: 2147483000;
      display: none; flex-direction: column; overflow: hidden;
      font-family: -apple-system, "Segoe UI", Roboto, sans-serif;
    }
    #fpa-panel.fpa-open { display: flex; }
    .fpa-head {
      background: #D4A94A; color: #fff; padding: 11px 14px;
      display: flex; align-items: center; justify-content: space-between;
    }
    .fpa-head-id { display: flex; align-items: center; gap: 10px; }
    .fpa-avatar {
      width: 32px; height: 32px; border-radius: 50%;
      background: rgba(255,255,255,.22);
      display: flex; align-items: center; justify-content: center;
    }
    .fpa-head-txt { display: flex; flex-direction: column; line-height: 1.15; }
    .fpa-name { font-size: 15px; font-weight: 700; }
    .fpa-sub { font-size: 11px; opacity: .85; }
    .fpa-x {
      background: none; border: none; color: #fff; font-size: 17px;
      cursor: pointer; line-height: 1; padding: 2px 4px;
    }
    .fpa-body { padding: 14px; overflow-y: auto; }
    .fpa-hint { font-size: 12.5px; color: #666; margin: 0 0 12px; line-height: 1.45; }
    .fpa-btn {
      width: 100%; padding: 10px; border: none; border-radius: 10px;
      cursor: pointer; font-size: 14px; font-weight: 600;
      font-family: inherit; transition: background .12s ease;
    }
    .fpa-btn:disabled { opacity: .55; cursor: default; }
    .fpa-btn-primary { background: #D4A94A; color: #fff; }
    .fpa-btn-primary:hover:not(:disabled) { background: #c39b3f; }
    .fpa-btn-ghost { background: #f0f0f0; color: #333; }
    .fpa-btn-ghost:hover:not(:disabled) { background: #e6e6e6; }
    #fpa-insert { margin-top: 8px; }
    .fpa-textarea {
      width: 100%; box-sizing: border-box; border: 1px solid #ddd;
      border-radius: 10px; padding: 10px; font-size: 13.5px;
      resize: vertical; min-height: 110px; font-family: inherit;
      margin: 12px 0 10px; color: #222; line-height: 1.45;
    }
    .fpa-textarea:focus { outline: 2px solid rgba(212,169,74,.4); border-color: #D4A94A; }
    .fpa-spin { text-align: center; padding: 16px 0; color: #999; font-size: 13px; }
    .fpa-err {
      background: #fdecea; color: #c0392b; font-size: 12.5px;
      padding: 9px 10px; border-radius: 8px; margin-top: 10px; line-height: 1.4;
    }
    .fpa-ok { color: #2e7d32; font-size: 12.5px; margin-top: 10px; text-align: center; }
  `;
  document.documentElement.appendChild(style);

  // ── Comunicação com o background (proxy da API) ───────────────────
  function bg(message) {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(message, (resp) => {
          if (chrome.runtime.lastError) {
            return reject(new Error(chrome.runtime.lastError.message));
          }
          if (resp && resp.error) return reject(new Error(resp.error));
          resolve(resp);
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  // ── Leitura da conversa aberta no WhatsApp Web ────────────────────
  function extractText(el) {
    let out = '';
    el.childNodes.forEach((n) => {
      if (n.nodeType === Node.TEXT_NODE) out += n.textContent;
      else if (n.nodeName === 'IMG') out += n.getAttribute('alt') || '';
      else if (n.nodeName === 'BR') out += '\n';
      else out += extractText(n);
    });
    return out;
  }

  const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

  // Acha o container rolável das mensagens — é nele que o WhatsApp "desmonta"
  // (virtualiza) as mensagens antigas e carrega mais quando a gente rola pra cima.
  function getScroller(main) {
    let el = main.querySelector('[data-pre-plain-text]') || main.querySelector('div[role="row"]');
    el = el && el.parentElement;
    while (el && el !== main) {
      if (el.scrollHeight > el.clientHeight + 40) {
        const oy = getComputedStyle(el).overflowY;
        if (oy === 'auto' || oy === 'scroll') return el;
      }
      el = el.parentElement;
    }
    return null;
  }

  // "[HH:MM, DD/MM/AAAA] Nome: " → timestamp (pra ordenar em ordem cronológica).
  function parseTs(node) {
    const pre = node.getAttribute && node.getAttribute('data-pre-plain-text');
    if (!pre) return null;
    const m = pre.match(/\[(\d{1,2}):(\d{2})(?::(\d{2}))?,\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})\]/);
    if (!m) return null;
    const year = m[6].length === 2 ? 2000 + Number(m[6]) : Number(m[6]);
    return new Date(year, Number(m[5]) - 1, Number(m[4]), Number(m[1]), Number(m[2]), Number(m[3] || 0)).getTime();
  }

  // Lê a conversa aberta INTEIRA: rola pra cima carregando o histórico que o
  // WhatsApp mantém fora do DOM, junta tudo sem repetir e devolve em ordem
  // cronológica (as últimas `limit` mensagens). null = nenhuma conversa aberta.
  async function readConversation(limit) {
    const main = document.querySelector('#main');
    if (!main) return null;

    const mainRect = main.getBoundingClientRect();
    const mid = mainRect.left + mainRect.width / 2;

    function classify(node) {
      if (node.closest && node.closest('.message-out')) return 'assistant';
      if (node.closest && node.closest('.message-in')) return 'user';
      const r = node.getBoundingClientRect();
      if (!r.width) return 'user';
      return r.left + r.width / 2 > mid ? 'assistant' : 'user';
    }

    // chave = pré-texto (hora + remetente) + conteúdo → dedup estável entre passadas.
    const byKey = new Map();
    let seq = 0;
    const snapshot = () => {
      main.querySelectorAll('[data-pre-plain-text]').forEach((node) => {
        const text = extractText(node).trim();
        if (!text) return;
        const key = (node.getAttribute('data-pre-plain-text') || '') + '|' + text;
        if (byKey.has(key)) return;
        byKey.set(key, { role: classify(node), content: text, ts: parseTs(node), seq: seq++ });
      });
    };

    snapshot(); // o que já está montado (mensagens mais recentes)

    // Rola pro topo várias vezes pra forçar o WhatsApp a montar o histórico.
    // Para quando já temos contexto suficiente OU duas passadas seguidas sem novidade.
    const target = limit + 10;
    const scroller = getScroller(main);
    if (scroller) {
      let stable = 0;
      for (let i = 0; i < 12 && byKey.size < target; i++) {
        const before = byKey.size;
        scroller.scrollTop = 0;
        await sleepMs(320);
        snapshot();
        if (byKey.size === before) { if (++stable >= 2) break; } else { stable = 0; }
      }
      scroller.scrollTop = scroller.scrollHeight; // volta pro fim (última mensagem)
      await sleepMs(120);
      snapshot();
    }

    let msgs = [...byKey.values()];
    const haveTs = msgs.some((m) => m.ts != null);
    if (haveTs) {
      // Ordem cronológica pelo horário; empate mantém a ordem de aparição.
      msgs.sort((a, b) => {
        if (a.ts == null && b.ts == null) return a.seq - b.seq;
        if (a.ts == null) return 1;
        if (b.ts == null) return -1;
        return a.ts - b.ts || a.seq - b.seq;
      });
      msgs = msgs.map((m) => ({ role: m.role, content: m.content }));
    } else {
      // DOM sem timestamps (layout diferente do WhatsApp): cai pro modo simples.
      msgs = [];
      main.querySelectorAll('span.selectable-text').forEach((node) => {
        const text = extractText(node).trim();
        if (text) msgs.push({ role: classify(node), content: text });
      });
      if (msgs.length === 0) {
        main.querySelectorAll('div[role="row"]').forEach((row) => {
          const t = (row.innerText || '').trim();
          if (t && t.length > 1) msgs.push({ role: classify(row), content: t });
        });
      }
    }

    if (msgs.length === 0) {
      console.warn(
        '[AgenteIA] Nenhuma mensagem extraída. Diagnóstico —',
        'data-pre-plain-text:', main.querySelectorAll('[data-pre-plain-text]').length,
        '| selectable-text:', main.querySelectorAll('span.selectable-text').length,
        '| message-in:', main.querySelectorAll('.message-in').length,
        '| message-out:', main.querySelectorAll('.message-out').length,
        '| role=row:', main.querySelectorAll('div[role="row"]').length,
      );
    } else {
      console.log('[AgenteIA] mensagens lidas:', msgs.length, '(contexto completo)');
    }

    return msgs.slice(-limit);
  }

  // ── Escrita / envio no compositor do WhatsApp Web ─────────────────
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function getComposer() {
    return (
      document.querySelector('#main footer div[contenteditable="true"]') ||
      document.querySelector('div[role="textbox"][contenteditable="true"][data-tab]') ||
      document.querySelector('footer [contenteditable="true"]')
    );
  }

  // O compositor do WhatsApp Web não aceita quebra de linha injetada por
  // script de forma confiável — insere em um parágrafo só (as quebras
  // viram espaço, sem deixar o texto grudado).
  function insertIntoComposer(text) {
    const composer = getComposer();
    if (!composer) return false;
    composer.focus();
    document.execCommand('selectAll', false, null);
    document.execCommand('delete', false, null);
    const oneLine = String(text).replace(/\s*\n+\s*/g, ' ').trim();
    document.execCommand('insertText', false, oneLine);
    return true;
  }

  function clickSendButton() {
    const icon = document.querySelector(
      '#main footer [data-icon="send"], #main footer [data-icon="wds-ic-send-filled"], ' +
        '#main footer button[aria-label="Enviar"], #main footer button[aria-label="Send"]',
    );
    if (icon) {
      (icon.closest('button') || icon).click();
      return true;
    }
    return false;
  }

  // Insere e envia. Lança erro se não conseguiu enviar (o texto fica no campo).
  async function sendSuggestion(text) {
    if (!insertIntoComposer(text)) {
      throw new Error('Não achei o campo de mensagem. Clique na conversa e tente de novo.');
    }
    await sleep(240); // espera o WhatsApp renderizar o botão de enviar
    clickSendButton();
    await sleep(420);
    const composer = getComposer();
    if (composer && (composer.textContent || '').trim()) {
      throw new Error('Inseri a mensagem, mas não consegui enviar sozinho. Revise e clique enviar no WhatsApp.');
    }
    return true;
  }

  // ── UI ────────────────────────────────────────────────────────────
  // Ícone "sparkles": estrela de 4 pontas grande + uma pequena.
  function sparkleSvg(size) {
    return (
      `<svg width="${size}" height="${size}" viewBox="0 0 24 24" ` +
      `fill="currentColor" aria-hidden="true">` +
      `<path d="M10 4 Q10 13 19 13 Q10 13 10 22 Q10 13 1 13 Q10 13 10 4 Z"/>` +
      `<path d="M18.5 1.5 Q18.5 5.5 22.5 5.5 Q18.5 5.5 18.5 9.5 ` +
      `Q18.5 5.5 14.5 5.5 Q18.5 5.5 18.5 1.5 Z"/>` +
      `</svg>`
    );
  }

  const fab = document.createElement('button');
  fab.id = 'fpa-fab';
  fab.title = 'Lia — assistente de atendimento';
  fab.innerHTML = sparkleSvg(26);

  const panel = document.createElement('div');
  panel.id = 'fpa-panel';
  panel.innerHTML = `
    <div class="fpa-head">
      <div class="fpa-head-id">
        <span class="fpa-avatar">${sparkleSvg(18)}</span>
        <div class="fpa-head-txt">
          <span class="fpa-name">Lia</span>
          <span class="fpa-sub">Assistente de atendimento</span>
        </div>
      </div>
      <button class="fpa-x" id="fpa-close" title="Fechar">✕</button>
    </div>
    <div class="fpa-body">
      <p class="fpa-hint">Eu leio a conversa aberta e sugiro a resposta. Você revisa, ajusta se quiser e envia.</p>
      <button class="fpa-btn fpa-btn-primary" id="fpa-gen">Gerar sugestão</button>
      <div id="fpa-spin" class="fpa-spin" style="display:none;">Gerando sugestão…</div>
      <div id="fpa-result" style="display:none;">
        <textarea class="fpa-textarea" id="fpa-text" placeholder="A sugestão aparece aqui…"></textarea>
        <button class="fpa-btn fpa-btn-primary" id="fpa-send">Enviar resposta</button>
        <button class="fpa-btn fpa-btn-ghost" id="fpa-insert">Inserir sem enviar</button>
        <div id="fpa-ok" class="fpa-ok" style="display:none;"></div>
      </div>
      <div id="fpa-err" class="fpa-err" style="display:none;"></div>
    </div>
  `;

  document.body.appendChild(fab);
  document.body.appendChild(panel);

  const $ = (id) => panel.querySelector(id);
  const elGen = $('#fpa-gen');
  const elSpin = $('#fpa-spin');
  const elResult = $('#fpa-result');
  const elText = $('#fpa-text');
  const elSend = $('#fpa-send');
  const elInsert = $('#fpa-insert');
  const elErr = $('#fpa-err');
  const elOk = $('#fpa-ok');

  function showError(msg) {
    elErr.textContent = msg;
    elErr.style.display = 'block';
  }
  function clearError() {
    elErr.style.display = 'none';
  }
  function clearSuggestion() {
    elText.value = '';
    elResult.style.display = 'none';
    elGen.textContent = 'Gerar sugestão';
  }

  fab.addEventListener('click', () => panel.classList.toggle('fpa-open'));
  $('#fpa-close').addEventListener('click', () => panel.classList.remove('fpa-open'));

  async function generate() {
    clearError();
    elOk.style.display = 'none';

    // Encerra cedo mostrando um aviso e devolvendo a UI ao estado normal.
    const fail = (msg) => {
      elSpin.style.display = 'none';
      elGen.disabled = false;
      showError(msg);
    };

    // Lê a conversa INTEIRA (rola pra cima carregando o histórico). Como isso
    // leva 1–3s, já mostra o spinner com o aviso de leitura.
    elGen.disabled = true;
    elResult.style.display = 'none';
    elSpin.textContent = 'Lendo a conversa…';
    elSpin.style.display = 'block';

    let msgs;
    try {
      msgs = await readConversation(60);
    } catch (e) {
      return fail('Não consegui ler a conversa. Clique na conversa e tente de novo.');
    }
    if (msgs === null) return fail('Abra uma conversa no WhatsApp antes de gerar a sugestão.');
    if (msgs.length === 0) return fail('Não encontrei mensagens de texto nessa conversa.');
    if (!msgs.some((m) => m.role === 'user')) {
      return fail('A conversa não tem nenhuma mensagem do cliente para responder.');
    }
    if (msgs[msgs.length - 1].role !== 'user') {
      return fail('A última mensagem da conversa é sua — espere o cliente responder.');
    }

    elSpin.textContent = 'Gerando sugestão…';
    try {
      const resp = await bg({ type: 'AGENT_SUGGEST', messages: msgs });
      elText.value = (resp && resp.reply) || '';
      elResult.style.display = 'block';
      elGen.textContent = 'Gerar de novo';
    } catch (e) {
      showError(e && e.message ? e.message : 'Erro ao gerar a sugestão.');
    } finally {
      elGen.disabled = false;
      elSpin.style.display = 'none';
      elSpin.textContent = 'Gerando sugestão…';
    }
  }
  elGen.addEventListener('click', generate);

  // Enviar: insere no compositor e envia; some com a sugestão ao concluir.
  elSend.addEventListener('click', async () => {
    clearError();
    elOk.style.display = 'none';
    const text = elText.value.trim();
    if (!text) {
      showError('A sugestão está vazia.');
      return;
    }
    elSend.disabled = true;
    elInsert.disabled = true;
    elSend.textContent = 'Enviando…';
    try {
      await sendSuggestion(text);
      elOk.textContent = '✓ Enviado!';
      elOk.style.display = 'block';
      setTimeout(() => {
        elOk.style.display = 'none';
        clearSuggestion();
      }, 1500);
    } catch (e) {
      showError(e && e.message ? e.message : 'Erro ao enviar.');
    } finally {
      elSend.disabled = false;
      elInsert.disabled = false;
      elSend.textContent = 'Enviar resposta';
    }
  });

  // Inserir sem enviar: só joga no campo, pra você ajustar no WhatsApp.
  elInsert.addEventListener('click', () => {
    clearError();
    elOk.style.display = 'none';
    const text = elText.value.trim();
    if (!text) {
      showError('A sugestão está vazia.');
      return;
    }
    if (insertIntoComposer(text)) {
      elOk.textContent = '✓ Inserido — revise e envie pelo WhatsApp.';
      elOk.style.display = 'block';
      setTimeout(() => {
        elOk.style.display = 'none';
      }, 4000);
    } else {
      showError('Não achei o campo de mensagem. Clique na conversa e tente de novo.');
    }
  });
})();

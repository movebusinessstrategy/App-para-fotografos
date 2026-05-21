// Agente IA — widget isolado no WhatsApp Web.
// Lê a conversa aberta, pede uma sugestão de resposta ao backend e
// (se o usuário aprovar) insere no compositor. O envio é sempre manual.
// Mantido separado do content.js de propósito, pra não acoplar nada.

(function () {
  'use strict';
  if (window.__fpAgenteLoaded) return;
  window.__fpAgenteLoaded = true;

  // ── Estilos ──────────────────────────────────────────────────────
  const style = document.createElement('style');
  style.textContent = `
    #fpa-fab {
      position: fixed; right: 24px; bottom: 104px;
      width: 54px; height: 54px; border-radius: 50%;
      background: #D4A94A; color: #fff; font-size: 25px;
      border: none; cursor: pointer; z-index: 2147483000;
      box-shadow: 0 4px 16px rgba(0,0,0,.28);
      display: flex; align-items: center; justify-content: center;
      transition: transform .15s ease;
    }
    #fpa-fab:hover { transform: scale(1.08); }
    #fpa-panel {
      position: fixed; right: 24px; bottom: 170px; width: 340px;
      max-height: 72vh; background: #fff; border-radius: 16px;
      box-shadow: 0 10px 40px rgba(0,0,0,.30); z-index: 2147483000;
      display: none; flex-direction: column; overflow: hidden;
      font-family: -apple-system, "Segoe UI", Roboto, sans-serif;
    }
    #fpa-panel.fpa-open { display: flex; }
    .fpa-head {
      background: #D4A94A; color: #fff; padding: 12px 14px;
      display: flex; align-items: center; justify-content: space-between;
    }
    .fpa-head b { font-size: 15px; font-weight: 700; }
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
    .fpa-ok { color: #2e7d32; font-size: 12.5px; margin-top: 8px; text-align: center; }
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
  // Extrai texto preservando emojis (alt das imagens) e quebras de linha.
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

  // Retorna null se não há conversa aberta; [] se aberta mas sem mensagens.
  function readConversation(limit) {
    const main = document.querySelector('#main');
    if (!main) return null;
    const nodes = main.querySelectorAll('div.message-in, div.message-out');
    const msgs = [];
    nodes.forEach((node) => {
      const span = node.querySelector('span.selectable-text');
      if (!span) return; // mídia, áudio, etc — sem texto
      const text = extractText(span).trim();
      if (!text) return;
      msgs.push({
        role: node.classList.contains('message-in') ? 'user' : 'assistant',
        content: text,
      });
    });
    return msgs.slice(-limit);
  }

  // ── Escrita no compositor do WhatsApp Web ─────────────────────────
  function insertIntoComposer(text) {
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

  // ── UI ────────────────────────────────────────────────────────────
  const fab = document.createElement('button');
  fab.id = 'fpa-fab';
  fab.title = 'Agente IA — sugerir resposta';
  fab.textContent = '🤖';

  const panel = document.createElement('div');
  panel.id = 'fpa-panel';
  panel.innerHTML = `
    <div class="fpa-head">
      <b>🤖 Agente IA</b>
      <button class="fpa-x" id="fpa-close" title="Fechar">✕</button>
    </div>
    <div class="fpa-body">
      <p class="fpa-hint">Eu leio a conversa aberta e sugiro a resposta. Você revisa, ajusta se quiser e envia.</p>
      <button class="fpa-btn fpa-btn-primary" id="fpa-gen">Gerar sugestão</button>
      <div id="fpa-spin" class="fpa-spin" style="display:none;">Gerando sugestão…</div>
      <div id="fpa-result" style="display:none;">
        <textarea class="fpa-textarea" id="fpa-text" placeholder="A sugestão aparece aqui…"></textarea>
        <button class="fpa-btn fpa-btn-primary" id="fpa-insert">Inserir no WhatsApp</button>
        <div id="fpa-ok" class="fpa-ok" style="display:none;">✓ Inserido — revise e envie pelo WhatsApp.</div>
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

  fab.addEventListener('click', () => {
    panel.classList.toggle('fpa-open');
  });
  $('#fpa-close').addEventListener('click', () => {
    panel.classList.remove('fpa-open');
  });

  async function generate() {
    clearError();
    elOk.style.display = 'none';
    const msgs = readConversation(25);
    if (msgs === null) {
      showError('Abra uma conversa no WhatsApp antes de gerar a sugestão.');
      return;
    }
    if (msgs.length === 0) {
      showError('Não encontrei mensagens de texto nessa conversa.');
      return;
    }
    if (!msgs.some((m) => m.role === 'user')) {
      showError('A conversa não tem nenhuma mensagem do cliente para responder.');
      return;
    }

    elGen.disabled = true;
    elSpin.style.display = 'block';
    elResult.style.display = 'none';
    try {
      const resp = await bg({ type: 'AGENT_SUGGEST', messages: msgs });
      const reply = (resp && resp.reply) || '';
      elText.value = reply;
      elResult.style.display = 'block';
      elGen.textContent = 'Gerar de novo';
    } catch (e) {
      showError(e && e.message ? e.message : 'Erro ao gerar a sugestão.');
    } finally {
      elGen.disabled = false;
      elSpin.style.display = 'none';
    }
  }

  elGen.addEventListener('click', generate);

  elInsert.addEventListener('click', () => {
    clearError();
    const text = elText.value.trim();
    if (!text) {
      showError('A sugestão está vazia.');
      return;
    }
    const ok = insertIntoComposer(text);
    if (ok) {
      elOk.style.display = 'block';
      setTimeout(() => {
        elOk.style.display = 'none';
      }, 4000);
    } else {
      showError('Não achei o campo de mensagem. Clique na conversa e tente de novo.');
    }
  });
})();

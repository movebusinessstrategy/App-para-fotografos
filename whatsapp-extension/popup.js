const SUPABASE_URL = 'https://rxzxmwvnovhrerbsmkqj.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ4enhtd3Zub3ZocmVyYnNta3FqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMyNzg0OTAsImV4cCI6MjA4ODg1NDQ5MH0.vS93umaTw9xVwoQMTFmSQGgAt9JZqeV2PLS_hrufMFM';

const DEFAULT_API_BASE = 'https://app-para-fotografos.onrender.com';

const body = document.getElementById('body-content');

// Tira "/" final e valida formato
function normalizeApiBase(url) {
  return String(url || '').trim().replace(/\/+$/, '');
}

// Resolve a URL "boa" da API: se o que está no storage for localhost
// (sobrou de algum teste local), força produção. Mantém custom URLs
// não-localhost (ex.: staging) intactas.
function resolveApiBase(stored) {
  const v = normalizeApiBase(stored);
  if (!v) return DEFAULT_API_BASE;
  if (/(^https?:\/\/)?(localhost|127\.0\.0\.1|0\.0\.0\.0)(:|\/|$)/i.test(v)) {
    return DEFAULT_API_BASE;
  }
  return v;
}

async function checkApiHealth(apiBase) {
  try {
    const r = await fetch(`${apiBase}/api/health`, { method: 'GET' });
    if (!r.ok) return false;
    const j = await r.json().catch(() => ({}));
    return j.ok === true;
  } catch {
    return false;
  }
}

function renderLogin(errorMsg, currentApiBase) {
  // Hardcoda o servidor padrão. O bloco "Avançado" só fica visível pra dev/debug
  // (auto-aberto quando há erro de conexão).
  const apiBase = currentApiBase || DEFAULT_API_BASE;
  const showAdvanced = !!errorMsg && /servidor|conex/i.test(errorMsg);
  body.innerHTML = `
    <div class="field">
      <label>E-mail</label>
      <input type="email" id="email-input" placeholder="seu@email.com" autocomplete="email" />
    </div>
    <div class="field">
      <label>Senha</label>
      <input type="password" id="password-input" placeholder="••••••••" autocomplete="current-password" />
    </div>
    <button class="btn-primary" id="login-btn">Entrar</button>
    ${errorMsg ? `<div class="status error">${escHtml(errorMsg)}</div>` : ''}
    <details id="advanced-toggle" ${showAdvanced ? 'open' : ''} style="margin-top:6px;">
      <summary style="font-size:11px;color:#94a3b8;cursor:pointer;user-select:none;">Avançado</summary>
      <div class="field" style="margin-top:8px;">
        <label>URL do servidor</label>
        <input type="text" id="api-base-input" placeholder="${DEFAULT_API_BASE}" value="${escHtml(apiBase)}" autocomplete="off" />
        <span class="hint">Use o padrão. Só altere pra apontar pra outro backend (debug).</span>
      </div>
    </details>
  `;

  const loginBtn = document.getElementById('login-btn');
  const apiBaseInput = document.getElementById('api-base-input');
  const emailInput = document.getElementById('email-input');
  const passwordInput = document.getElementById('password-input');

  passwordInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') loginBtn.click();
  });

  loginBtn.addEventListener('click', async () => {
    const apiBase = normalizeApiBase(apiBaseInput.value) || DEFAULT_API_BASE;
    const email = emailInput.value.trim();
    const password = passwordInput.value;

    if (!email || !password) {
      renderLogin('Preencha e-mail e senha.', apiBase);
      return;
    }

    loginBtn.textContent = 'Testando servidor...';
    loginBtn.disabled = true;

    // 1) Valida que o backend responde
    const healthy = await checkApiHealth(apiBase);
    if (!healthy) {
      renderLogin(`Servidor não respondeu em ${apiBase}/api/health. Confira a URL.`, apiBase);
      return;
    }

    loginBtn.textContent = 'Entrando...';

    try {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (!res.ok || !data.access_token) {
        throw new Error(data.error_description || data.msg || 'E-mail ou senha incorretos.');
      }

      const userName = data.user?.user_metadata?.full_name || data.user?.email || email;
      chrome.storage.local.set({
        fp_api_base: apiBase,
        fp_token: data.access_token,
        fp_refresh_token: data.refresh_token,
        fp_user_name: userName,
        fp_user_email: data.user?.email || email,
        fp_token_expires: Date.now() + (data.expires_in * 1000),
      }, () => {
        renderLoggedIn(userName, data.user?.email || email, apiBase, true);
      });

    } catch (err) {
      renderLogin(err.message, apiBase);
    }
  });

  setTimeout(() => emailInput.focus(), 50);
}

function renderLoggedIn(name, email, apiBase, justLoggedIn = false) {
  body.innerHTML = `
    <div class="logged-card">
      <div>
        <div class="logged-name">${escHtml(name)}</div>
        <div class="logged-email">${escHtml(email)}</div>
      </div>
      <div class="logged-badge">
        <span class="logged-dot"></span>
        Conectado ao CRM
      </div>
    </div>
    <div class="server-row">
      <span class="server-label">Servidor:</span>
      <code class="server-url">${escHtml(apiBase)}</code>
    </div>
    <div class="status ok">${justLoggedIn ? '✓ Login realizado! Fechando…' : '✓ Extensão pronta! Abra uma conversa no WhatsApp.'}</div>
    <button class="btn-logout" id="logout-btn">Sair e mudar servidor</button>
  `;

  document.getElementById('logout-btn').addEventListener('click', () => {
    chrome.storage.local.remove(
      ['fp_token', 'fp_refresh_token', 'fp_user_name', 'fp_user_email', 'fp_token_expires'],
      () => renderLogin(null, apiBase),
    );
  });

  // Se este popup foi aberto como janela (chrome.windows.create do botão "Fazer login"
  // dentro do WhatsApp Web), fecha automaticamente após o login.
  if (justLoggedIn) {
    chrome.windows.getCurrent((win) => {
      if (win && win.type === 'popup') {
        setTimeout(() => window.close(), 900);
      }
    });
  }
}

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Boot
chrome.storage.local.get(
  ['fp_token', 'fp_user_name', 'fp_user_email', 'fp_token_expires', 'fp_api_base'],
  async (result) => {
    const apiBase = resolveApiBase(result.fp_api_base);

    // Se mudou de localhost → prod, persiste a correção pra não cair nesse ramo de novo
    if (apiBase !== normalizeApiBase(result.fp_api_base)) {
      chrome.storage.local.set({ fp_api_base: apiBase });
    }

    if (result.fp_token && result.fp_user_name) {
      const expires = result.fp_token_expires || 0;
      if (Date.now() < expires - 300000) {
        renderLoggedIn(result.fp_user_name, result.fp_user_email, apiBase);
        return;
      }
      try {
        await refreshToken();
        renderLoggedIn(result.fp_user_name, result.fp_user_email, apiBase);
        return;
      } catch {
        // refresh falhou, mostra login
      }
    }
    renderLogin(null, apiBase);
  },
);

async function refreshToken() {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(['fp_refresh_token'], async (result) => {
      if (!result.fp_refresh_token) return reject(new Error('Sem refresh token'));

      try {
        const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY },
          body: JSON.stringify({ refresh_token: result.fp_refresh_token }),
        });
        const data = await res.json();
        if (!res.ok || !data.access_token) throw new Error('Refresh falhou');

        chrome.storage.local.set({
          fp_token: data.access_token,
          fp_refresh_token: data.refresh_token,
          fp_token_expires: Date.now() + (data.expires_in * 1000),
        });
        resolve(data.access_token);
      } catch (err) {
        reject(err);
      }
    });
  });
}

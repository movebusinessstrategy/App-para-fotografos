const SUPABASE_URL = 'https://rxzxmwvnovhrerbsmkqj.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ4enhtd3Zub3ZocmVyYnNta3FqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMyNzg0OTAsImV4cCI6MjA4ODg1NDQ5MH0.vS93umaTw9xVwoQMTFmSQGgAt9JZqeV2PLS_hrufMFM';

const body = document.getElementById('body-content');

function renderLogin(errorMsg) {
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
    ${errorMsg ? `<div class="status error">${errorMsg}</div>` : ''}
  `;

  const loginBtn = document.getElementById('login-btn');
  const emailInput = document.getElementById('email-input');
  const passwordInput = document.getElementById('password-input');

  // Enter no campo de senha faz login
  passwordInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') loginBtn.click();
  });

  loginBtn.addEventListener('click', async () => {
    const email = emailInput.value.trim();
    const password = passwordInput.value;

    if (!email || !password) {
      renderLogin('Preencha e-mail e senha.');
      return;
    }

    loginBtn.textContent = 'Entrando...';
    loginBtn.disabled = true;

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

      // Salva token e dados do usuário
      const userName = data.user?.user_metadata?.full_name || data.user?.email || email;
      chrome.storage.local.set({
        fp_token: data.access_token,
        fp_refresh_token: data.refresh_token,
        fp_user_name: userName,
        fp_user_email: data.user?.email || email,
        fp_token_expires: Date.now() + (data.expires_in * 1000),
      }, () => {
        renderLoggedIn(userName, data.user?.email || email);
      });

    } catch (err) {
      renderLogin(err.message);
    }
  });

  // Foca no email ao abrir
  setTimeout(() => emailInput.focus(), 50);
}

function renderLoggedIn(name, email) {
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
    <div class="status ok">✓ Extensão pronta! Abra uma conversa no WhatsApp.</div>
    <button class="btn-logout" id="logout-btn">Sair da conta</button>
  `;

  document.getElementById('logout-btn').addEventListener('click', () => {
    chrome.storage.local.remove(['fp_token', 'fp_refresh_token', 'fp_user_name', 'fp_user_email', 'fp_token_expires'], () => {
      renderLogin();
    });
  });
}

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Verifica se já está logado ao abrir o popup
chrome.storage.local.get(['fp_token', 'fp_user_name', 'fp_user_email', 'fp_token_expires'], async (result) => {
  if (result.fp_token && result.fp_user_name) {
    // Verifica se token ainda é válido (com 5min de margem)
    const expires = result.fp_token_expires || 0;
    if (Date.now() < expires - 300000) {
      renderLoggedIn(result.fp_user_name, result.fp_user_email);
      return;
    }
    // Token expirado — tenta renovar com refresh token
    try {
      await refreshToken();
      renderLoggedIn(result.fp_user_name, result.fp_user_email);
      return;
    } catch {
      // refresh falhou, mostra login
    }
  }
  renderLogin();
});

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

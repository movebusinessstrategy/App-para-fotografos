// Service Worker — gerencia comunicação com FocalPoint API

const API_BASE = 'https://app-para-fotografos.onrender.com';

const SUPABASE_URL = 'https://rxzxmwvnovhrerbsmkqj.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ4enhtd3Zub3ZocmVyYnNta3FqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMyNzg0OTAsImV4cCI6MjA4ODg1NDQ5MH0.vS93umaTw9xVwoQMTFmSQGgAt9JZqeV2PLS_hrufMFM';

async function getAuth() {
  return new Promise(async (resolve, reject) => {
    chrome.storage.local.get(['fp_token', 'fp_refresh_token', 'fp_token_expires', 'fp_api_base'], async (result) => {
      if (!result.fp_token) return reject(new Error('Não autenticado — faça login no ícone da extensão.'));

      const expires = result.fp_token_expires || 0;
      // Se token ainda válido (com 2min de margem), usa ele
      if (Date.now() < expires - 120000) {
        return resolve({ token: result.fp_token, apiBase: result.fp_api_base || API_BASE });
      }

      // Tenta renovar
      try {
        if (!result.fp_refresh_token) throw new Error('Sessão expirada. Faça login novamente.');
        const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY },
          body: JSON.stringify({ refresh_token: result.fp_refresh_token }),
        });
        const data = await res.json();
        if (!res.ok || !data.access_token) throw new Error('Sessão expirada. Faça login novamente.');

        chrome.storage.local.set({
          fp_token: data.access_token,
          fp_refresh_token: data.refresh_token,
          fp_token_expires: Date.now() + (data.expires_in * 1000),
        });
        resolve({ token: data.access_token, apiBase: result.fp_api_base || API_BASE });
      } catch (err) {
        reject(err);
      }
    });
  });
}

async function apiFetch(path, options = {}) {
  const { token, apiBase } = await getAuth();
  if (!token) throw new Error('Não autenticado — configure o token no popup da extensão.');

  let response;
  try {
    response = await fetch(`${apiBase}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(options.headers || {}),
      },
    });
  } catch (networkErr) {
    // Erro de rede (CORS, host bloqueado, servidor fora do ar)
    throw new Error(`Falha ao acessar ${apiBase}. Confira a URL no popup. Detalhe: ${networkErr.message}`);
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const msg = body.error || `HTTP ${response.status}`;
    throw new Error(`${msg} (em ${apiBase}${path})`);
  }

  return response.json();
}

// Escuta mensagens dos content scripts
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message).then(sendResponse).catch((err) => {
    sendResponse({ error: err.message });
  });
  return true; // indica resposta assíncrona
});

async function handleMessage(message) {
  switch (message.type) {
    case 'OPEN_LOGIN_TAB': {
      const url = chrome.runtime.getURL('popup.html');
      chrome.windows.create({
        url,
        type: 'popup',
        width: 360,
        height: 560,
      });
      return { ok: true };
    }
    case 'GET_DEAL_BY_PHONE': {
      const encoded = encodeURIComponent(message.phone);
      return apiFetch(`/api/extension/deal-by-phone?phone=${encoded}`);
    }
    case 'MOVE_STAGE': {
      return apiFetch(`/api/extension/deals/${message.dealId}/stage`, {
        method: 'PATCH',
        body: JSON.stringify({ stageId: message.stageId }),
      });
    }
    case 'CREATE_DEAL': {
      return apiFetch('/api/deals/quick', {
        method: 'POST',
        body: JSON.stringify(message.data),
      });
    }
    case 'UPDATE_DEAL': {
      return apiFetch(`/api/deals/${message.dealId}`, {
        method: 'PUT',
        body: JSON.stringify(message.data),
      });
    }
    case 'CONVERT_DEAL': {
      return apiFetch(`/api/deals/${message.dealId}/convert`, {
        method: 'POST',
        body: JSON.stringify(message.data),
      });
    }
    case 'LOST_DEAL': {
      return apiFetch(`/api/deals/${message.dealId}/lost`, {
        method: 'POST',
        body: JSON.stringify(message.data),
      });
    }
    case 'GET_TEAM_MEMBERS': {
      return apiFetch('/api/team-members');
    }
    case 'GET_ME': {
      return apiFetch('/api/me');
    }
    case 'GET_CLIENTS': {
      return apiFetch('/api/clients');
    }
    case 'GET_CATALOG': {
      const [produtos, servicos, combos] = await Promise.all([
        apiFetch('/api/produtos'),
        apiFetch('/api/servicos'),
        apiFetch('/api/combos'),
      ]);
      return { produtos, servicos, combos };
    }
    case 'ADD_DEAL_ITEM': {
      return apiFetch(`/api/deals/${message.dealId}/items`, {
        method: 'POST',
        body: JSON.stringify(message.data),
      });
    }
    case 'ADD_NOTE': {
      return apiFetch(`/api/extension/deals/${message.dealId}/notes`, {
        method: 'POST',
        body: JSON.stringify({ text: message.text }),
      });
    }
    case 'GET_STAGES': {
      return apiFetch('/api/pipeline/stages');
    }
    case 'GET_ALL_DEALS': {
      return apiFetch('/api/deals');
    }
    case 'GET_AGENDA': {
      const params = new URLSearchParams();
      if (message.year) params.set('year', String(message.year));
      if (message.month) params.set('month', String(message.month));
      const qs = params.toString();
      return apiFetch(`/api/extension/agenda${qs ? `?${qs}` : ''}`);
    }
    default:
      throw new Error(`Tipo de mensagem desconhecido: ${message.type}`);
  }
}

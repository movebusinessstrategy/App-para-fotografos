// Service Worker — gerencia comunicação com FocalPoint API

const API_BASE = 'https://app-para-fotografos.onrender.com';

const SUPABASE_URL = 'https://rxzxmwvnovhrerbsmkqj.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ4enhtd3Zub3ZocmVyYnNta3FqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMyNzg0OTAsImV4cCI6MjA4ODg1NDQ5MH0.vS93umaTw9xVwoQMTFmSQGgAt9JZqeV2PLS_hrufMFM';

// Se o storage ficou com URL de localhost (sobrou de teste local), ignora
// e força a URL de produção. Custom URLs não-localhost são respeitadas.
function resolveApiBase(stored) {
  const v = String(stored || '').trim().replace(/\/+$/, '');
  if (!v) return API_BASE;
  if (/(^https?:\/\/)?(localhost|127\.0\.0\.1|0\.0\.0\.0)(:|\/|$)/i.test(v)) {
    // Limpa o storage pra não cair aqui de novo
    try { chrome.storage.local.set({ fp_api_base: API_BASE }); } catch {}
    return API_BASE;
  }
  return v;
}

async function getAuth() {
  return new Promise(async (resolve, reject) => {
    chrome.storage.local.get(['fp_token', 'fp_refresh_token', 'fp_token_expires', 'fp_api_base'], async (result) => {
      if (!result.fp_token) return reject(new Error('Não autenticado — faça login no ícone da extensão.'));

      const apiBase = resolveApiBase(result.fp_api_base);
      const expires = result.fp_token_expires || 0;
      // Se token ainda válido (com 2min de margem), usa ele
      if (Date.now() < expires - 120000) {
        return resolve({ token: result.fp_token, apiBase });
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
        resolve({ token: data.access_token, apiBase });
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
    case 'CREATE_JOB': {
      return apiFetch('/api/jobs', {
        method: 'POST',
        body: JSON.stringify(message.data),
      });
    }
    case 'UPDATE_JOB': {
      return apiFetch(`/api/jobs/${message.jobId}`, {
        method: 'PUT',
        body: JSON.stringify(message.data),
      });
    }
    case 'DELETE_JOB': {
      return apiFetch(`/api/jobs/${message.jobId}`, {
        method: 'DELETE',
      });
    }
    case 'CREATE_CLIENT_QUICK': {
      // Cria um cliente "leve" só com nome (e telefone, se vier). Demais
      // campos podem ser preenchidos depois pelo app.
      return apiFetch('/api/clients', {
        method: 'POST',
        body: JSON.stringify(message.data),
      });
    }
    case 'GET_TASKS_DATA': {
      // Junta tasks + team-members + me + clients numa chamada — a extensão
      // precisa dos quatro pra montar a tela (filtrar "minhas", mostrar
      // avatar do responsável, escolher cliente vinculado).
      const [tasks, members, me, clients] = await Promise.all([
        apiFetch('/api/tasks'),
        apiFetch('/api/team-members').catch(() => []),
        apiFetch('/api/me').catch(() => null),
        apiFetch('/api/clients').catch(() => []),
      ]);
      return { tasks, members, me, clients };
    }
    case 'CREATE_TASK': {
      return apiFetch('/api/tasks', {
        method: 'POST',
        body: JSON.stringify(message.data),
      });
    }
    case 'UPDATE_TASK': {
      return apiFetch(`/api/tasks/${message.taskId}`, {
        method: 'PUT',
        body: JSON.stringify(message.data),
      });
    }
    case 'TOGGLE_TASK': {
      return apiFetch(`/api/tasks/${message.taskId}/complete`, {
        method: 'PATCH',
        body: JSON.stringify({ completed: !!message.completed }),
      });
    }
    case 'DELETE_TASK': {
      return apiFetch(`/api/tasks/${message.taskId}`, {
        method: 'DELETE',
      });
    }
    case 'GET_PRODUCTION_DATA': {
      // Usa a estrutura v2 (mesma do app web): processes = "pastas", cada
      // processo tem stages-v2 ordenados por position. Job.production_stage
      // aponta pra um stage v2.
      const [processes, stages, jobs, clients, members] = await Promise.all([
        apiFetch('/api/production/processes').catch(() => []),
        apiFetch('/api/production/stages-v2').catch(() => []),
        apiFetch('/api/jobs'),
        apiFetch('/api/clients').catch(() => []),
        apiFetch('/api/team-members').catch(() => []),
      ]);
      return { processes, stages, jobs, clients, members };
    }
    case 'MOVE_JOB_PRODUCTION_STAGE': {
      return apiFetch(`/api/jobs/${message.jobId}`, {
        method: 'PUT',
        body: JSON.stringify({ production_stage: message.stageId }),
      });
    }
    case 'GET_SALES_OVERVIEW': {
      const days = Number(message.days) || 7;
      return apiFetch(`/api/extension/sales-overview?days=${days}`);
    }
    case 'AGENT_SUGGEST': {
      // Recebe a conversa lida do WhatsApp Web e devolve a resposta sugerida.
      return apiFetch('/api/agent/suggest', {
        method: 'POST',
        body: JSON.stringify({ messages: message.messages || [] }),
      });
    }
    default:
      throw new Error(`Tipo de mensagem desconhecido: ${message.type}`);
  }
}

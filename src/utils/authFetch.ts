import { supabase } from "../integrations/supabase/client";
import { fetchWithTimeout, withTimeout } from './requestTimeout';

// Se definido (ex: no Vercel apontando para o Render), todas as chamadas /api/...
// serão prefixadas com essa URL. Em desenvolvimento e no Render fica vazio.
const API_BASE = (import.meta.env.VITE_API_BASE_URL as string) || '';

// Chaves usadas pelo painel ADM para impersonar. Lê do sessionStorage
// para que feche a aba = sai da impersonação. Compartilhado com ImpersonationContext.
// Membro tem prioridade sobre dono — só um header é enviado.
export const IMPERSONATION_STORAGE_KEY        = 'platform_admin_impersonate_owner_id';
export const IMPERSONATION_MEMBER_STORAGE_KEY = 'platform_admin_impersonate_member_id';

async function buildHeaders(token?: string): Promise<HeadersInit> {
  const accessToken = token ?? (await withTimeout(supabase.auth.getSession())).data.session?.access_token ?? '';
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${accessToken}`,
  };
  if (typeof window !== 'undefined') {
    const memberId = sessionStorage.getItem(IMPERSONATION_MEMBER_STORAGE_KEY);
    const ownerId  = sessionStorage.getItem(IMPERSONATION_STORAGE_KEY);
    if (memberId)      headers['X-Impersonate-Member-Id'] = memberId;
    else if (ownerId)  headers['X-Impersonate-Owner-Id']  = ownerId;
  }
  return headers;
}

// Mantido para compatibilidade
export const getAuthHeaders = () => buildHeaders();

// Dispara um evento global quando o backend recusa por motivo de billing
// (402 = pagamento necessário, ou 403 com `limit_reached`).
// O componente <BillingGate> no AppLayout escuta e mostra modal de upgrade.
async function notifyBillingBlock(res: Response): Promise<void> {
  if (res.status !== 402 && res.status !== 403) return;
  try {
    const clone = res.clone();
    const data = await clone.json();
    if (res.status === 402 || data?.limit_reached) {
      window.dispatchEvent(new CustomEvent('billing:blocked', {
        detail: { ...data, httpStatus: res.status },
      }));
    }
  } catch { /* response sem JSON, ignora */ }
}

let refreshInFlight: ReturnType<typeof supabase.auth.refreshSession> | null = null;

function refreshSessionOnce() {
  if (!refreshInFlight) {
    refreshInFlight = supabase.auth.refreshSession().finally(() => { refreshInFlight = null; });
  }
  return withTimeout(refreshInFlight);
}

function request(url: string, options: RequestInit) {
  const method = (options.method || 'GET').toUpperCase();
  // Não introduzimos repetição ou cancelamento automático em gravações/envios.
  return method === 'GET' ? fetchWithTimeout(url, options) : fetch(url, options);
}

export const authFetch = async (url: string, options: RequestInit = {}): Promise<Response> => {
  const headers = await buildHeaders();
  let res = await request(`${API_BASE}${url}`, {
    ...options,
    headers: { ...headers, ...(options.headers || {}) },
  });

  // Race condition no startup: o token pode estar vazio ou expirado.
  // Renova a sessão e tenta uma vez antes de desistir.
  if (res.status === 401) {
    const { data: { session: refreshed } } = await refreshSessionOnce();
    if (refreshed?.access_token) {
      const freshHeaders = await buildHeaders(refreshed.access_token);
      res = await request(`${API_BASE}${url}`, {
        ...options,
        headers: { ...freshHeaders, ...(options.headers || {}) },
      });
    }
  }

  await notifyBillingBlock(res);
  return res;
};

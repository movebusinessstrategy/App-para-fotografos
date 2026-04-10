import { supabase } from "../integrations/supabase/client";

// Se definido (ex: no Vercel apontando para o Render), todas as chamadas /api/...
// serão prefixadas com essa URL. Em desenvolvimento e no Render fica vazio.
const API_BASE = (import.meta.env.VITE_API_BASE_URL as string) || '';

async function buildHeaders(token?: string): Promise<HeadersInit> {
  const accessToken = token ?? (await supabase.auth.getSession()).data.session?.access_token ?? '';
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${accessToken}`,
  };
}

// Mantido para compatibilidade
export const getAuthHeaders = () => buildHeaders();

export const authFetch = async (url: string, options: RequestInit = {}): Promise<Response> => {
  const headers = await buildHeaders();
  const res = await fetch(`${API_BASE}${url}`, {
    ...options,
    headers: { ...headers, ...(options.headers || {}) },
  });

  // Race condition no startup: o token pode estar vazio ou expirado.
  // Renova a sessão e tenta uma vez antes de desistir.
  if (res.status === 401) {
    const { data: { session: refreshed } } = await supabase.auth.refreshSession();
    if (!refreshed?.access_token) return res; // sem sessão válida — retorna 401 original

    const freshHeaders = await buildHeaders(refreshed.access_token);
    return fetch(`${API_BASE}${url}`, {
      ...options,
      headers: { ...freshHeaders, ...(options.headers || {}) },
    });
  }

  return res;
};

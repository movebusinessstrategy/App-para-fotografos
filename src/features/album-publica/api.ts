// Fetch das rotas públicas do álbum — SEM auth de estúdio. A cliente abre
// /a/:token no celular. Suporta token de sessão (quando o álbum exige login),
// gerado pelo POST /login do próprio álbum — guardado em localStorage por token.
const API_BASE = (import.meta.env.VITE_API_BASE_URL as string) || "";

export class ErroApiPublica extends Error {
  status: number;
  constructor(status: number, mensagem: string) {
    super(mensagem);
    this.status = status;
  }
}

const SESSION_KEY = "ap_session:"; // chave: ap_session:<share_token>

export function lerSessao(shareToken: string): string | null {
  try {
    return localStorage.getItem(SESSION_KEY + shareToken);
  } catch {
    return null;
  }
}

export function salvarSessao(shareToken: string, sessionToken: string): void {
  try {
    localStorage.setItem(SESSION_KEY + shareToken, sessionToken);
  } catch {
    /* localStorage indisponível — segue sem persistir */
  }
}

export function limparSessao(shareToken: string): void {
  try {
    localStorage.removeItem(SESSION_KEY + shareToken);
  } catch {
    /* idem */
  }
}

async function requisitar<T>(path: string, options: RequestInit = {}, shareToken?: string): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((options.headers as Record<string, string>) || {}),
  };
  if (shareToken) {
    const sess = lerSessao(shareToken);
    if (sess) headers.Authorization = `Bearer ${sess}`;
  }
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (!res.ok) {
    const corpo = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new ErroApiPublica(res.status, corpo?.error || `Erro ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const publicGet = <T>(path: string, shareToken?: string) => requisitar<T>(path, {}, shareToken);

export const publicPut = <T>(path: string, body?: unknown, shareToken?: string) =>
  requisitar<T>(
    path,
    { method: "PUT", body: body !== undefined ? JSON.stringify(body) : undefined },
    shareToken,
  );

export const publicPost = <T>(path: string, body?: unknown, shareToken?: string) =>
  requisitar<T>(
    path,
    { method: "POST", body: body !== undefined ? JSON.stringify(body) : undefined },
    shareToken,
  );

// Fetch das rotas públicas do álbum — SEM auth de estúdio. A cliente abre
// /a/:token no celular e tudo é validado pelo share_token nas rotas públicas.
const API_BASE = (import.meta.env.VITE_API_BASE_URL as string) || "";

export class ErroApiPublica extends Error {
  status: number;
  constructor(status: number, mensagem: string) {
    super(mensagem);
    this.status = status;
  }
}

async function requisitar<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((options.headers as Record<string, string>) || {}),
  };
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (!res.ok) {
    const corpo = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new ErroApiPublica(res.status, corpo?.error || `Erro ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const publicGet = <T>(path: string) => requisitar<T>(path);

export const publicPut = <T>(path: string, body?: unknown) =>
  requisitar<T>(path, {
    method: "PUT",
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

export const publicPost = <T>(path: string, body?: unknown) =>
  requisitar<T>(path, {
    method: "POST",
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

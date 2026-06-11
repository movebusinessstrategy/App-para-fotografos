// Fetch das rotas públicas da galeria — SEM auth (cliente final acessa via share_token).
// Mesma base URL do authFetch (VITE_API_BASE_URL), só que sem token nem headers extras.
const API_BASE = (import.meta.env.VITE_API_BASE_URL as string) || "";

export class ErroApiPublica extends Error {
  status: number;
  constructor(status: number, mensagem: string) {
    super(mensagem);
    this.status = status;
  }
}

async function requisitar<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  if (!res.ok) {
    const corpo = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new ErroApiPublica(res.status, corpo?.error || `Erro ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const publicGet = <T>(path: string) => requisitar<T>(path);

export const publicPost = <T>(path: string, body?: unknown) =>
  requisitar<T>(path, {
    method: "POST",
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

import useSWR, { SWRConfiguration, SWRResponse, mutate as globalMutate } from "swr";
import { authFetch } from "./authFetch";

// Fetcher genérico. Lança erro pra SWR pegar.
async function defaultFetcher<T = unknown>(url: string): Promise<T> {
  const res = await authFetch(url);
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return res.json() as Promise<T>;
}

// Wrapper sobre useSWR. Aceita url string ou null pra desativar.
// Retorna { data, error, isLoading, mutate } (o mutate é local, só revalida essa chave).
export function useApi<T = unknown>(
  url: string | null,
  config?: SWRConfiguration<T>,
): SWRResponse<T, Error> {
  return useSWR<T, Error>(url, defaultFetcher, config);
}

// Config p/ telas "ao vivo" (Produção, Vendas): revalida a cada 5s pra
// dar sensação de tempo real. O dedupingInterval baixo (2s) é OBRIGATÓRIO:
// o SWRConfig global usa dedupingInterval de 60s, que engoliria o polling
// (o FETCH dedupado só refetcharia ~1x/min). Aqui sobrescrevemos só nesses
// hooks. O SWR já pausa o polling sozinho quando a aba está oculta.
export const liveRefresh: SWRConfiguration = { refreshInterval: 5000, dedupingInterval: 2000 };

// Helper pra invalidar cache de uma URL (chama após POST/PUT/DELETE).
export function refreshApi(url: string) {
  return globalMutate(url);
}

// Helper pra invalidar várias URLs de uma vez (ex: muta um job → invalida jobs E financeiro)
export function refreshAll(urls: string[]) {
  return Promise.all(urls.map(u => globalMutate(u)));
}

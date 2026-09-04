// Polling que PAUSA quando a aba está escondida (document.hidden) e dispara uma
// atualização imediata assim que ela volta a ficar visível. Reduz drasticamente
// as requisições inúteis (ninguém está olhando a aba) sem perder a sensação de
// tempo real. Retorna uma função de limpeza (chame no cleanup do useEffect).
export function startVisiblePoll(fn: () => void | Promise<unknown>, intervalMs: number): () => void {
  let running = false;
  let stopped = false;
  const tick = async () => {
    if (stopped || running || document.hidden) return;
    running = true;
    try { await fn(); }
    catch { /* A próxima atualização tenta novamente, sem rejeição solta. */ }
    finally { running = false; }
  };
  const id = setInterval(tick, intervalMs);
  const onVisible = () => { void tick(); };
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    stopped = true;
    clearInterval(id);
    document.removeEventListener("visibilitychange", onVisible);
  };
}

// Polling que PAUSA quando a aba está escondida (document.hidden) e dispara uma
// atualização imediata assim que ela volta a ficar visível. Reduz drasticamente
// as requisições inúteis (ninguém está olhando a aba) sem perder a sensação de
// tempo real. Retorna uma função de limpeza (chame no cleanup do useEffect).
export function startVisiblePoll(fn: () => void, intervalMs: number): () => void {
  const tick = () => { if (!document.hidden) fn(); };
  const id = setInterval(tick, intervalMs);
  const onVisible = () => { if (!document.hidden) fn(); };
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    clearInterval(id);
    document.removeEventListener("visibilitychange", onVisible);
  };
}

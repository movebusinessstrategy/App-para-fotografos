// Compartilha a execução atual até ela terminar, inclusive quando falha.
// O relógio pode continuar disparando sem acumular trabalho no banco.
export function nonOverlappingTask<T>(task: () => Promise<T>): () => Promise<T> {
  let running: Promise<T> | null = null;
  return () => {
    if (!running) {
      running = Promise.resolve().then(task).finally(() => { running = null; });
    }
    return running;
  };
}

export const CONNECTION_ERROR = 'O serviço está demorando para responder. Tente novamente em alguns instantes.';

export function withTimeout<T>(operation: PromiseLike<T>, timeoutMs = 15_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(CONNECTION_ERROR)), timeoutMs);
    Promise.resolve(operation).then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

// Cancela a requisição, preservando também o cancelamento de quem chamou.
export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 15_000,
): Promise<Response> {
  const controller = new AbortController();
  const source = init.signal ?? (input instanceof Request ? input.signal : undefined);
  const cancel = () => controller.abort(source?.reason);
  if (source?.aborted) cancel();
  else source?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => controller.abort(new Error(CONNECTION_ERROR)), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    source?.removeEventListener('abort', cancel);
  }
}

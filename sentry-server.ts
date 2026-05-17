// Inicialização do Sentry no backend (Node).
// Opt-in: só ativa se SENTRY_DSN estiver definido no .env.
// Dynamic import: se o pacote não estiver instalado, ignora silenciosamente.

export async function initSentry(): Promise<any> {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return null;

  try {
    // String em variável evita que o bundler/TS exija o pacote em build time.
    const sentryModule = "@sentry/node";
    // @ts-ignore — opcional, instalado via `npm install` quando ativar
    const Sentry = await import(sentryModule);
    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV || "development",
      release: process.env.APP_VERSION || "dev",
      tracesSampleRate: 0.1,
      integrations: [],
    });
    console.info("[Sentry] backend inicializado");
    return Sentry;
  } catch {
    console.warn("[Sentry] SENTRY_DSN definido mas @sentry/node não está instalado. Rode `npm install`.");
    return null;
  }
}

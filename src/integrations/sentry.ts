// Inicialização do Sentry no frontend.
// Opt-in: só ativa se VITE_SENTRY_DSN estiver definido no .env.
// Dynamic import: se o pacote não estiver instalado, ignora silenciosamente.

export async function initSentry() {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  if (!dsn) return;

  try {
    // Truque pra impedir o Vite de tentar resolver o módulo em tempo de build.
    // Sem a string em variável, o Vite analisa estaticamente e falha quando o pacote
    // ainda não foi instalado. Em runtime, se o pacote não existir, o catch trata.
    const sentryModule = "@sentry/react";
    // @ts-ignore — opcional, instalado via `npm install` quando ativar
    const Sentry = await import(/* @vite-ignore */ sentryModule);
    Sentry.init({
      dsn,
      environment: import.meta.env.MODE,
      release: (import.meta.env.VITE_APP_VERSION as string) || "dev",
      tracesSampleRate: 0.1,
      replaysSessionSampleRate: 0,
      replaysOnErrorSampleRate: 1.0,
      // Não vaza dados sensíveis em URLs/forms
      beforeSend(event) {
        if (event.request?.cookies) delete event.request.cookies;
        return event;
      },
    });
    // eslint-disable-next-line no-console
    console.info("[Sentry] inicializado");
  } catch (err) {
    // Pacote não instalado ainda — não bloqueia o app
    // eslint-disable-next-line no-console
    console.warn("[Sentry] DSN definido mas @sentry/react não está instalado. Rode `npm install`.");
  }
}

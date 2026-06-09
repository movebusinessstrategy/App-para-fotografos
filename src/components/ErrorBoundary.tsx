import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

// Rede de segurança global. Sem isto, QUALQUER erro de render (ou falha ao
// baixar um "chunk" de JS) derrubava a árvore inteira do React → TELA BRANCA.
//
// Caso mais comum: "chunk sumido". Cada página é carregada sob demanda (lazy).
// Quando sai um DEPLOY NOVO, os arquivos .js mudam de nome (hash novo). Um
// navegador com o index.html em cache (ou no meio da sessão) pede o arquivo
// ANTIGO, que não existe mais → o import dinâmico falha. Aqui detectamos isso e
// recarregamos a página 1x pra pegar o build novo (guard de 10s evita loop).

const CHUNK_ERROR_RE =
  /dynamically imported module|module script|failed to fetch|loading chunk|importing a module script failed|mime type|unexpected token '<'/i;

function isChunkLoadError(err: unknown): boolean {
  const e = err as { message?: string; name?: string } | null;
  const msg = e?.message ? String(e.message) : String(err ?? "");
  const name = e?.name ? String(e.name) : "";
  return CHUNK_ERROR_RE.test(msg) || /chunk/i.test(name);
}

// Recarrega a página no máximo 1x a cada 10s (guard contra loop). Usado pelo
// ErrorBoundary e pelo listener de `vite:preloadError` no main.tsx.
export function reloadOnceForChunk(): boolean {
  try {
    const KEY = "fp-chunk-reload-ts";
    const last = Number(sessionStorage.getItem(KEY) || 0);
    if (Date.now() - last > 10_000) {
      sessionStorage.setItem(KEY, String(Date.now()));
      window.location.reload();
      return true;
    }
  } catch {
    /* sessionStorage indisponível — ignora */
  }
  return false;
}

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  // O projeto não tem @types/react completo pra classes — declaramos os
  // membros do Component explicitamente pro TS (em runtime já existem).
  declare props: Props;
  declare state: State;

  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Erro de chunk = build novo trocou os arquivos. Recarrega 1x pra pegá-los.
    if (isChunkLoadError(error) && reloadOnceForChunk()) return;
    // Loga o erro real (DevTools e, se ativo, Sentry) pra a gente diagnosticar.
    console.error("[ErrorBoundary]", error, info?.componentStack);
    try {
      (window as unknown as { Sentry?: { captureException?: (e: unknown) => void } })
        .Sentry?.captureException?.(error);
    } catch {
      /* ignora */
    }
  }

  handleReload = () => {
    try {
      sessionStorage.removeItem("fp-chunk-reload-ts");
    } catch {
      /* ignora */
    }
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div
        className="min-h-screen flex items-center justify-center px-6"
        style={{ background: "linear-gradient(135deg, #1a1207 0%, #2d1f08 40%, #1a1207 100%)" }}
      >
        <div className="flex flex-col items-center gap-4 text-center" style={{ maxWidth: 360 }}>
          <div style={{ fontSize: 40 }}>⚠️</div>
          <h1 className="text-white text-lg font-semibold">Algo não carregou direito</h1>
          <p className="text-white/70 text-sm">
            Pode ter sido uma atualização do sistema ou uma falha de conexão. Recarregar
            costuma resolver.
          </p>
          <button
            onClick={this.handleReload}
            className="mt-2 px-5 py-2.5 rounded-lg font-semibold"
            style={{ background: "#d4a94a", color: "#1a1207", cursor: "pointer", border: "none" }}
          >
            Recarregar
          </button>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;

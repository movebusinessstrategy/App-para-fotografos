import type { ReactNode } from "react";
import { BookOpen, CheckCircle2, ImageOff, Loader2 } from "lucide-react";
import { ROSA } from "../utils";

// Telas de estado do álbum público (carregando / token inválido / aprovado).
// Tela cheia, mobile-first, paleta rosa como a galeria pública.

function TelaCentral({ children }: { children: ReactNode }) {
  return (
    <div className="h-full overflow-y-auto bg-[#FAF8F6] text-neutral-900">
      <div className="min-h-full flex flex-col items-center justify-center px-6 py-12 text-center">
        {children}
      </div>
    </div>
  );
}

function IconeRedondo({ children }: { children: ReactNode }) {
  return (
    <div
      className="w-16 h-16 rounded-full flex items-center justify-center mb-5"
      style={{ backgroundColor: `${ROSA}1A`, color: ROSA }}
    >
      {children}
    </div>
  );
}

export function TelaCarregando() {
  return (
    <TelaCentral>
      <Loader2 size={32} className="animate-spin" style={{ color: ROSA }} />
      <p className="mt-4 text-sm text-neutral-500">Carregando álbum…</p>
    </TelaCentral>
  );
}

export function TelaTokenInvalido() {
  return (
    <TelaCentral>
      <IconeRedondo>
        <ImageOff size={28} />
      </IconeRedondo>
      <h1 className="font-serif text-2xl">Álbum não encontrado</h1>
      <p className="mt-2 text-sm text-neutral-500 max-w-xs">
        Este link não existe ou expirou. Confirme com seu fotógrafo o link correto.
      </p>
    </TelaCentral>
  );
}

export function TelaPreparacao({ estudio }: { estudio?: string | null }) {
  return (
    <TelaCentral>
      <IconeRedondo>
        <BookOpen size={28} />
      </IconeRedondo>
      <h1 className="font-serif text-2xl">Álbum em preparação</h1>
      <p className="mt-2 text-sm text-neutral-500 max-w-xs">
        {estudio ? `${estudio} ainda está` : "Seu fotógrafo ainda está"} montando seu álbum.
        Volte em breve!
      </p>
    </TelaCentral>
  );
}

export function TelaAprovado({ estudio }: { estudio?: string | null }) {
  return (
    <TelaCentral>
      <IconeRedondo>
        <CheckCircle2 size={30} />
      </IconeRedondo>
      <h1 className="font-serif text-3xl">Álbum aprovado!</h1>
      <p className="mt-2 text-sm text-neutral-500 max-w-xs">
        {estudio || "Seu fotógrafo"} já recebeu sua aprovação e vai dar continuidade.
        Obrigado!
      </p>
    </TelaCentral>
  );
}

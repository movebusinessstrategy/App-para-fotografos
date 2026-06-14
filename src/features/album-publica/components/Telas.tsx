import type { ReactNode } from "react";
import { BookOpen, CheckCircle2, ImageOff, Loader2 } from "lucide-react";

// Telas de estado do álbum público (carregando / token inválido / em preparação
// / aprovado), no tema premium da marca: palco escuro com brilho dourado,
// tipografia serifada (Cormorant) e acento ouro.

const STAGE_BG = "radial-gradient(125% 85% at 50% -5%, #211e1a 0%, #131210 45%, #0a0a0a 100%)";

export function PalcoPremium({ children }: { children: ReactNode }) {
  return (
    <div className="h-full overflow-y-auto text-luxury-cream" style={{ background: STAGE_BG }}>
      <div className="min-h-full flex flex-col items-center justify-center px-6 py-12 text-center">
        {children}
      </div>
    </div>
  );
}

function AuraDourada({ children }: { children: ReactNode }) {
  return (
    <div className="relative mb-6 flex items-center justify-center">
      <div
        className="absolute h-24 w-24 rounded-full blur-2xl"
        style={{ background: "radial-gradient(circle, rgba(241,198,101,.35), rgba(241,198,101,0) 70%)" }}
      />
      <div className="relative flex h-16 w-16 items-center justify-center rounded-full border border-gold-400/30 bg-white/5 text-gold-400 backdrop-blur-sm">
        {children}
      </div>
    </div>
  );
}

export function TelaCarregando({ legenda }: { legenda?: string }) {
  return (
    <PalcoPremium>
      <AuraDourada>
        <Loader2 size={26} className="animate-spin" />
      </AuraDourada>
      <p className="text-sm tracking-wide text-luxury-cream/70">{legenda || "Preparando seu álbum…"}</p>
    </PalcoPremium>
  );
}

export function TelaTokenInvalido() {
  return (
    <PalcoPremium>
      <AuraDourada>
        <ImageOff size={26} />
      </AuraDourada>
      <h1 className="font-serif text-3xl font-light">Álbum não encontrado</h1>
      <p className="mt-3 max-w-xs text-sm text-luxury-cream/60">
        Este link não existe ou expirou. Confirme com seu fotógrafo o endereço correto.
      </p>
    </PalcoPremium>
  );
}

export function TelaPreparacao({ estudio }: { estudio?: string | null }) {
  return (
    <PalcoPremium>
      <AuraDourada>
        <BookOpen size={26} />
      </AuraDourada>
      <h1 className="font-serif text-3xl font-light">Álbum em preparação</h1>
      <p className="mt-3 max-w-xs text-sm text-luxury-cream/60">
        {estudio ? `${estudio} ainda está` : "Seu fotógrafo ainda está"} montando seu álbum com todo cuidado.
        Volte em breve.
      </p>
    </PalcoPremium>
  );
}

export function TelaAprovado({ estudio }: { estudio?: string | null }) {
  return (
    <PalcoPremium>
      <AuraDourada>
        <CheckCircle2 size={30} />
      </AuraDourada>
      <h1 className="font-serif text-4xl font-light">Álbum aprovado</h1>
      <p className="mt-3 max-w-sm text-sm text-luxury-cream/60">
        {estudio || "Seu fotógrafo"} já recebeu sua aprovação e vai dar continuidade à produção.
        Obrigado pela confiança.
      </p>
      <div className="mt-6 h-px w-16 bg-gradient-to-r from-transparent via-gold-400/60 to-transparent" />
    </PalcoPremium>
  );
}

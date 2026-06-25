import type { ReactNode } from "react";
import { ShieldCheck } from "lucide-react";
import type { GaleriaPublica } from "../types";
import { formatarBRL, nomeEstudio } from "../utils";

type Props = {
  galeria: GaleriaPublica;
  mostrarAvisoProtecao: boolean;
};

function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full bg-white border border-brand-200 px-3 py-1 text-xs font-medium text-brand-700 shadow-sm">
      {children}
    </span>
  );
}

export function CabecalhoGaleria({ galeria, mostrarAvisoProtecao }: Props) {
  const estudio = nomeEstudio(galeria.studio_name);
  return (
    <header className="mx-auto max-w-3xl px-4 pt-8 pb-5 text-center">
      {galeria.studio_logo_url ? (
        <img
          src={galeria.studio_logo_url}
          alt={estudio}
          className="mx-auto h-12 max-w-[160px] object-contain mb-2"
        />
      ) : (
        <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-brand-600">
          {estudio}
        </p>
      )}
      <h1 className="mt-1 font-serif text-3xl sm:text-4xl font-medium text-neutral-900">
        {galeria.title}
      </h1>
      <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
        <Chip>
          {galeria.included_count}{" "}
          {galeria.included_count === 1 ? "foto incluída" : "fotos incluídas"}
        </Chip>
        <Chip>extra {formatarBRL(galeria.extra_price)}</Chip>
      </div>
      {mostrarAvisoProtecao && (
        <p className="mt-3 inline-flex items-center gap-1 text-[11px] text-neutral-400">
          <ShieldCheck size={12} />
          fotos protegidas
        </p>
      )}
    </header>
  );
}

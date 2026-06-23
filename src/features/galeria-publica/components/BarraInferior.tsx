import { Loader2 } from "lucide-react";
import type { TotaisSelecao } from "../types";
import { formatarBRL } from "../utils";

type Props = {
  totais: TotaisSelecao;
  finalizando: boolean;
  onFinalizar: () => void;
};

export function BarraInferior({ totais, finalizando, onFinalizar }: Props) {
  const rotuloEscolhidas =
    totais.selecionadas === 1 ? "1 escolhida" : `${totais.selecionadas} escolhidas`;

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-neutral-200 bg-white/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
        <div className="min-w-0 text-sm">
          <p className="font-semibold text-neutral-900">{rotuloEscolhidas}</p>
          <p className="truncate text-xs text-neutral-500">
            {totais.extras} {totais.extras === 1 ? "extra" : "extras"} ·{" "}
            {totais.desconto > 0 && (
              <span className="text-neutral-400 line-through">{formatarBRL(totais.subtotal)} </span>
            )}
            <span className={totais.desconto > 0 ? "font-medium text-emerald-600" : ""}>
              {formatarBRL(totais.valor)}
            </span>{" "}
            a pagar
            {totais.descontoPct > 0 && (
              <span className="text-emerald-600"> (−{totais.descontoPct}%)</span>
            )}
          </p>
        </div>
        <button
          type="button"
          disabled={totais.selecionadas === 0 || finalizando}
          onClick={onFinalizar}
          className="flex shrink-0 items-center gap-2 rounded-full bg-[#D4537E] px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-[#D4537E]/30 transition-colors hover:bg-[#c24470] disabled:opacity-50"
        >
          {finalizando && <Loader2 size={14} className="animate-spin" />}
          Finalizar seleção
        </button>
      </div>
    </div>
  );
}

import { Loader2 } from "lucide-react";
import type { TotaisSelecao } from "../types";
import { formatarBRL } from "../utils";

type Props = {
  totais: TotaisSelecao;
  precoExtra: number;
  finalizando: boolean;
  erro: string | null;
  onConfirmar: () => void;
  onFechar: () => void;
};

function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-neutral-500">{rotulo}</span>
      <span className="font-medium text-neutral-900">{valor}</span>
    </div>
  );
}

export function ModalFinalizar({ totais, precoExtra, finalizando, erro, onConfirmar, onFechar }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onFechar} />
      <div className="relative w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl">
        <h2 className="font-serif text-xl text-neutral-900">Confirmar seleção</h2>
        <p className="mt-1 text-xs text-neutral-500">
          Confira as contas antes de enviar para o fotógrafo.
        </p>

        <div className="mt-4 space-y-2 rounded-xl bg-neutral-50 p-4">
          <Linha rotulo="Fotos escolhidas" valor={String(totais.selecionadas)} />
          <Linha rotulo="Incluídas no pacote" valor={String(totais.incluidas)} />
          <Linha
            rotulo="Fotos extras"
            valor={`${totais.extras} × ${formatarBRL(precoExtra)}`}
          />
          {totais.desconto > 0 && (
            <>
              <Linha rotulo="Subtotal" valor={formatarBRL(totais.subtotal)} />
              <div className="flex items-center justify-between text-sm">
                <span className="text-emerald-600">
                  {totais.descontoPct > 0 ? `Desconto (${totais.descontoPct}%)` : "Desconto"}
                </span>
                <span className="font-medium text-emerald-600">− {formatarBRL(totais.desconto)}</span>
              </div>
            </>
          )}
          <div className="border-t border-neutral-200 pt-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-neutral-900">Total a pagar</span>
              <span className="text-base font-bold text-[#D4537E]">
                {formatarBRL(totais.valor)}
              </span>
            </div>
          </div>
        </div>

        <p className="mt-3 text-[11px] text-neutral-400">
          {totais.valor > 0
            ? "Você vai para o pagamento agora — a seleção só é confirmada depois que o pagamento for aprovado."
            : "Após finalizar, a seleção não poderá mais ser alterada."}
        </p>

        {erro && <p className="mt-2 text-xs font-medium text-red-600">{erro}</p>}

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onFechar}
            disabled={finalizando}
            className="flex-1 rounded-full border border-neutral-200 py-2.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
          >
            Voltar
          </button>
          <button
            type="button"
            onClick={onConfirmar}
            disabled={finalizando}
            className="flex flex-1 items-center justify-center gap-2 rounded-full bg-[#D4537E] py-2.5 text-sm font-semibold text-white hover:bg-[#c24470] disabled:opacity-50"
          >
            {finalizando && <Loader2 size={14} className="animate-spin" />}
            Finalizar
          </button>
        </div>
      </div>
    </div>
  );
}

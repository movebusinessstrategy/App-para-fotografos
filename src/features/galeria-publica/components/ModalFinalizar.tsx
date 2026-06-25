import { useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import type { TotaisSelecao } from "../types";
import { formatarBRL } from "../utils";

type Props = {
  totais: TotaisSelecao;
  precoExtra: number;
  finalizando: boolean;
  erro: string | null;
  mostrarCupom: boolean;
  cupom: string;
  cupomStatus: "idle" | "loading" | "ok" | "invalid";
  onCupomChange: (v: string) => void;
  onAplicarCupom: () => void;
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

export function ModalFinalizar({
  totais, precoExtra, finalizando, erro,
  mostrarCupom, cupom, cupomStatus, onCupomChange, onAplicarCupom,
  onConfirmar, onFechar,
}: Props) {
  // Double-check: a cliente precisa confirmar que entende que não dá pra trocar depois.
  const [confirmado, setConfirmado] = useState(false);
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
              <span className="text-base font-bold text-[#6F4E37]">
                {formatarBRL(totais.valor)}
              </span>
            </div>
          </div>
        </div>

        {mostrarCupom && (
          <div className="mt-3">
            <label className="text-xs font-medium text-neutral-600">Tem um cupom de desconto?</label>
            <div className="mt-1 flex gap-2">
              <input
                type="text"
                value={cupom}
                onChange={(e) => onCupomChange(e.target.value.toUpperCase())}
                placeholder="Código"
                disabled={finalizando}
                className="flex-1 rounded-lg border border-neutral-200 px-3 py-2 text-sm uppercase outline-none focus:border-[#6F4E37]"
              />
              <button
                type="button"
                onClick={onAplicarCupom}
                disabled={finalizando || cupomStatus === "loading" || !cupom.trim()}
                className="flex items-center justify-center rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {cupomStatus === "loading" ? <Loader2 size={14} className="animate-spin" /> : "Aplicar"}
              </button>
            </div>
            {cupomStatus === "ok" && totais.cupomAplicado && (
              <p className="mt-1 text-xs font-medium text-emerald-600">Cupom {totais.cupomAplicado} aplicado ✓</p>
            )}
            {cupomStatus === "invalid" && (
              <p className="mt-1 text-xs font-medium text-red-600">Cupom inválido.</p>
            )}
          </div>
        )}

        {totais.valor > 0 && (
          <p className="mt-3 text-[11px] text-neutral-400">
            Você vai para o pagamento agora — a seleção só é confirmada depois que o pagamento for aprovado.
          </p>
        )}

        {/* Aviso forte + double-check de conscientização: não dá pra trocar depois */}
        <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3">
          <div className="flex items-start gap-2">
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-600" />
            <p className="text-xs font-semibold text-amber-800">
              Só finalize depois de revisar! Depois de finalizar, <span className="underline">não tem como trocar</span> as fotos escolhidas.
            </p>
          </div>
          <label className="mt-2 flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={confirmado}
              onChange={(e) => setConfirmado(e.target.checked)}
              disabled={finalizando}
              className="mt-0.5 h-4 w-4 accent-[#6F4E37]"
            />
            <span className="text-xs text-amber-800">
              Revisei minha seleção e entendo que não poderei trocar as fotos depois de finalizar.
            </span>
          </label>
        </div>

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
            disabled={finalizando || !confirmado}
            title={!confirmado ? "Marque a confirmação acima para finalizar" : undefined}
            className="flex flex-1 items-center justify-center gap-2 rounded-full bg-[#6F4E37] py-2.5 text-sm font-semibold text-white hover:bg-[#553A29] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {finalizando && <Loader2 size={14} className="animate-spin" />}
            Finalizar
          </button>
        </div>
      </div>
    </div>
  );
}

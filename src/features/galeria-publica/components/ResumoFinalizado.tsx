import { CheckCircle2, CreditCard, Loader2 } from "lucide-react";
import { useStatusPagamento } from "../hooks/useStatusPagamento";
import type { TotaisSelecao } from "../types";
import { formatarBRL } from "../utils";

type Props = {
  token: string;
  totais: TotaisSelecao;
};

// Banner mostrado quando a cliente reabre uma galeria já finalizada:
// resumo da seleção + situação do pagamento (com botão pagar se houver link).
export function ResumoFinalizado({ token, totais }: Props) {
  const temExtras = totais.valor > 0;
  const { status, url } = useStatusPagamento(token, temExtras);
  const pago = status === "paid";

  return (
    <div className="mx-auto mb-5 max-w-xl px-4">
      <div className="rounded-2xl border border-neutral-200 bg-white p-4 text-center shadow-sm">
        <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-neutral-900">
          <CheckCircle2 size={16} className="text-[#6F4E37]" />
          Seleção enviada!
        </p>
        <p className="mt-1 text-xs text-neutral-500">
          {totais.selecionadas} {totais.selecionadas === 1 ? "foto escolhida" : "fotos escolhidas"}{" "}
          · {totais.extras} {totais.extras === 1 ? "extra" : "extras"} ·{" "}
          {formatarBRL(totais.valor)}
          {totais.descontoPct > 0 && (
            <span className="text-emerald-600"> (−{totais.descontoPct}% aplicado)</span>
          )}
        </p>
        {temExtras && <SituacaoPagamento pago={pago} url={url} valor={totais.valor} />}
      </div>
    </div>
  );
}

function SituacaoPagamento({ pago, url, valor }: { pago: boolean; url: string | null; valor: number }) {
  if (pago) {
    return (
      <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700">
        <CheckCircle2 size={14} />
        Pagamento confirmado
      </p>
    );
  }
  return (
    <div className="mt-3 space-y-2">
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-full bg-[#6F4E37] px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-[#6F4E37]/30 hover:bg-[#553A29]"
        >
          <CreditCard size={15} />
          Pagar {formatarBRL(valor)} com Mercado Pago
        </a>
      ) : (
        <p className="text-xs font-medium text-amber-600">
          Pagamento de {formatarBRL(valor)} pendente
        </p>
      )}
      <p className="flex items-center justify-center gap-1.5 text-[11px] text-neutral-400">
        <Loader2 size={11} className="animate-spin" />
        Aguardando confirmação do pagamento…
      </p>
    </div>
  );
}

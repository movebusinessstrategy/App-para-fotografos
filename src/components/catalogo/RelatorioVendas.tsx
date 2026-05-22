import React, { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, Package, ShoppingCart } from "lucide-react";
import { authFetch } from "../../utils/authFetch";

interface RelatorioData {
  periodo: { ano: number; mes: number };
  resumo: { totalVendido: number; numTrabalhos: number; ticketMedio: number };
  produtos: { nome: string; tipo: string; quantidade: number; valor: number }[];
  compras: Record<"analise" | "aprovado" | "comprado" | "cancelado", { qtd: number; custo: number }>;
}

const TH = "text-left px-5 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide";

const fmt = (v: number) =>
  (v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 0 });

function shiftMonth(mes: string, delta: number): string {
  const [y, m] = mes.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function StatCard({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 px-5 py-4">
      <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-1">{label}</p>
      <p className={`text-2xl font-bold ${accent}`}>{value}</p>
    </div>
  );
}

const STATUS = [
  { id: "analise" as const, label: "Em análise", cls: "text-amber-700 dark:text-amber-400" },
  { id: "aprovado" as const, label: "Aprovado", cls: "text-blue-700 dark:text-blue-400" },
  { id: "comprado" as const, label: "Comprado", cls: "text-green-700 dark:text-green-400" },
];

export function RelatorioVendas() {
  const [mes, setMes] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [data, setData] = useState<RelatorioData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    authFetch(`/api/relatorios/vendas?mes=${mes}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancel) setData(d); })
      .catch(() => {})
      .finally(() => { if (!cancel) setLoading(false); });
    return () => { cancel = true; };
  }, [mes]);

  const [ano, mm] = mes.split("-").map(Number);
  const mesLabel = new Date(ano, mm - 1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

  return (
    <div className="space-y-5">
      {/* Seletor de mês */}
      <div className="flex items-center justify-center gap-3">
        <button onClick={() => setMes((m) => shiftMonth(m, -1))} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500"><ChevronLeft size={18} /></button>
        <span className="text-sm font-semibold text-gray-800 dark:text-gray-100 capitalize w-48 text-center">{mesLabel}</span>
        <button onClick={() => setMes((m) => shiftMonth(m, 1))} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500"><ChevronRight size={18} /></button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-40"><Loader2 size={22} className="animate-spin text-gold-500" /></div>
      ) : !data ? (
        <p className="text-center text-sm text-gray-400 py-10">Não foi possível carregar o relatório.</p>
      ) : (
        <>
          {/* Resumo geral de vendas */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <StatCard label="Vendido no mês" value={fmt(data.resumo.totalVendido)} accent="text-gold-600 dark:text-gold-400" />
            <StatCard label="Trabalhos vendidos" value={String(data.resumo.numTrabalhos)} accent="text-gray-900 dark:text-white" />
            <StatCard label="Ticket médio" value={fmt(data.resumo.ticketMedio)} accent="text-gray-900 dark:text-white" />
          </div>

          {/* Produtos vendidos no mês */}
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center gap-2">
              <Package size={16} className="text-gold-600" />
              <h4 className="font-semibold text-gray-800 dark:text-gray-100">Produtos vendidos no mês</h4>
            </div>
            {data.produtos.length === 0 ? (
              <p className="text-center text-sm text-gray-400 py-10">Nenhum produto vendido neste mês.</p>
            ) : (
              <table className="w-full text-sm">
                <thead><tr className="border-b border-gray-100 dark:border-gray-800">
                  <th className={TH}>Item</th>
                  <th className={`${TH} text-center`}>Qtd</th>
                  <th className={`${TH} text-right`}>Valor</th>
                </tr></thead>
                <tbody>
                  {data.produtos.map((p) => (
                    <tr key={p.nome} className="border-b border-gray-50 dark:border-gray-800/50">
                      <td className="px-5 py-3 font-medium text-gray-900 dark:text-white">{p.nome}</td>
                      <td className="px-5 py-3 text-center text-gray-600 dark:text-gray-300">{p.quantidade}</td>
                      <td className="px-5 py-3 text-right font-semibold text-gray-900 dark:text-white">{fmt(p.valor)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr className="border-t border-gray-100 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-800/30">
                  <td className="px-5 py-2.5 text-xs font-semibold uppercase tracking-wide text-gray-400">Total</td>
                  <td className="px-5 py-2.5 text-center text-sm font-bold text-gray-700 dark:text-gray-200">{data.produtos.reduce((s, p) => s + p.quantidade, 0)}</td>
                  <td className="px-5 py-2.5 text-right text-sm font-bold text-gray-900 dark:text-white">{fmt(data.produtos.reduce((s, p) => s + p.valor, 0))}</td>
                </tr></tfoot>
              </table>
            )}
          </div>

          {/* Pedidos de compra do mês */}
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center gap-2">
              <ShoppingCart size={16} className="text-gold-600" />
              <h4 className="font-semibold text-gray-800 dark:text-gray-100">Pedidos de compra do mês</h4>
            </div>
            <div className="divide-y divide-gray-50 dark:divide-gray-800/50">
              {STATUS.map((st) => {
                const v = data.compras[st.id];
                return (
                  <div key={st.id} className="px-5 py-3 flex items-center gap-3">
                    <span className={`text-sm font-semibold flex-1 ${st.cls}`}>{st.label}</span>
                    <span className="text-sm text-gray-500 dark:text-gray-400">{v.qtd} pedido(s)</span>
                    <span className="text-sm font-semibold text-gray-900 dark:text-white w-28 text-right">{fmt(v.custo)}</span>
                  </div>
                );
              })}
            </div>
            <p className="px-5 py-2 text-[11px] text-gray-400 border-t border-gray-100 dark:border-gray-800">
              Valor estimado pelo preço de custo dos produtos.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

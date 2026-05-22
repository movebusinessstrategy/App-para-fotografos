import React, { useEffect, useState } from "react";
import { Package, ShoppingCart, X, Loader2, AlertTriangle, Trash2 } from "lucide-react";
import { catalogoApi } from "../../services/api/catalogo";
import { Produto, Compra, CompraStatus } from "../../types";

const TH = "text-left px-5 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide";

const STATUS_CFG: Record<CompraStatus, { label: string; cls: string }> = {
  analise:   { label: "Em análise", cls: "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400" },
  aprovado:  { label: "Aprovado",   cls: "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400" },
  comprado:  { label: "Comprado",   cls: "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400" },
  cancelado: { label: "Cancelado",  cls: "bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400" },
};

export function EstoqueTab({ produtos, onChanged }: { produtos: Produto[]; onChanged: () => void }) {
  const [compras, setCompras] = useState<Compra[]>([]);
  const [loading, setLoading] = useState(true);
  const [pedirFor, setPedirFor] = useState<Produto | null>(null);
  const [qtd, setQtd] = useState(1);
  const [obs, setObs] = useState("");
  const [busy, setBusy] = useState(false);

  const loadCompras = async () => {
    try { setCompras(await catalogoApi.getCompras()); }
    catch { /* tabela compras ainda não existe */ }
    finally { setLoading(false); }
  };
  useEffect(() => { loadCompras(); }, []);

  const controlados = produtos.filter((p) => p.controla_estoque);
  const pendentes = compras.filter((c) => c.status === "analise" || c.status === "aprovado");

  function abrirPedido(p: Produto) {
    setPedirFor(p);
    const falta = (p.estoque_minimo ?? 0) - (p.estoque ?? 0);
    setQtd(Math.max(1, falta > 0 ? falta : 1));
    setObs("");
  }

  async function criarCompra() {
    if (!pedirFor) return;
    setBusy(true);
    try {
      await catalogoApi.createCompra({ produto_id: pedirFor.id, quantidade: qtd, observacao: obs || undefined });
      setPedirFor(null);
      await loadCompras();
    } finally { setBusy(false); }
  }

  async function mudarStatus(c: Compra, status: CompraStatus) {
    await catalogoApi.updateCompra(c.id, { status });
    await loadCompras();
    if (status === "comprado") onChanged(); // o estoque do produto mudou
  }

  async function excluir(c: Compra) {
    setCompras((prev) => prev.filter((x) => x.id !== c.id));
    await catalogoApi.deleteCompra(c.id);
  }

  if (loading) {
    return <div className="flex items-center justify-center h-40"><Loader2 size={22} className="animate-spin text-gold-500" /></div>;
  }

  return (
    <div className="space-y-5">
      {/* ── Estoque dos produtos ── */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center gap-2">
          <Package size={16} className="text-gold-600" />
          <h4 className="font-semibold text-gray-800 dark:text-gray-100">Estoque dos produtos</h4>
        </div>
        {controlados.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-14 gap-1.5 text-gray-400">
            <Package size={30} strokeWidth={1.5} />
            <p className="text-sm">Nenhum produto com controle de estoque.</p>
            <p className="text-xs">Edite um produto e marque "Controlar estoque deste produto".</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead><tr className="border-b border-gray-100 dark:border-gray-800">
              <th className={TH}>Produto</th>
              <th className={`${TH} text-center`}>Estoque</th>
              <th className={`${TH} text-center`}>Mínimo</th>
              <th className={`${TH} text-center`}>Situação</th>
              <th className="px-5 py-3" />
            </tr></thead>
            <tbody>
              {controlados.map((p) => {
                const est = p.estoque ?? 0;
                const min = p.estoque_minimo ?? 0;
                const falta = est <= 0;
                const baixo = !falta && est <= min;
                return (
                  <tr key={p.id} className="border-b border-gray-50 dark:border-gray-800/50">
                    <td className="px-5 py-3 font-medium text-gray-900 dark:text-white">{p.nome}</td>
                    <td className="px-5 py-3 text-center">
                      <span className={`text-sm font-bold ${falta ? "text-red-600 dark:text-red-400" : baixo ? "text-amber-600 dark:text-amber-400" : "text-green-600 dark:text-green-400"}`}>{est}</span>
                    </td>
                    <td className="px-5 py-3 text-center text-gray-500 dark:text-gray-400">{min}</td>
                    <td className="px-5 py-3 text-center">
                      {falta ? (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-700 dark:text-red-400"><AlertTriangle size={12} /> Em falta</span>
                      ) : baixo ? (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700 dark:text-amber-400"><AlertTriangle size={12} /> Baixo</span>
                      ) : (
                        <span className="text-xs font-medium text-green-700 dark:text-green-400">OK</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <button
                        onClick={() => abrirPedido(p)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-gold-50 dark:bg-gold-900/20 text-gold-700 dark:text-gold-300 hover:bg-gold-100 dark:hover:bg-gold-900/40"
                      >
                        <ShoppingCart size={12} /> Pedir compra
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Pedidos de compra ── */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center gap-2">
          <ShoppingCart size={16} className="text-gold-600" />
          <h4 className="font-semibold text-gray-800 dark:text-gray-100">Pedidos de compra</h4>
          {pendentes.length > 0 && <span className="ml-auto text-xs text-gray-400">{pendentes.length} em andamento</span>}
        </div>
        {compras.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-14 gap-1.5 text-gray-400">
            <ShoppingCart size={30} strokeWidth={1.5} />
            <p className="text-sm">Nenhum pedido de compra ainda.</p>
            <p className="text-xs">Clique em "Pedir compra" num produto acima.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50 dark:divide-gray-800/50">
            {compras.map((c) => {
              const cfg = STATUS_CFG[c.status];
              return (
                <div key={c.id} className="px-5 py-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-900 dark:text-white truncate">{c.produto_nome}</span>
                      <span className="text-xs text-gray-400 flex-shrink-0">× {c.quantidade}</span>
                      {c.job_id && (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 flex-shrink-0">Automático</span>
                      )}
                    </div>
                    {c.cliente_nome && <p className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">Cliente: {c.cliente_nome}</p>}
                    {c.observacao && <p className="text-xs text-gray-400 truncate mt-0.5">{c.observacao}</p>}
                  </div>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${cfg.cls}`}>{cfg.label}</span>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {c.status === "analise" && (
                      <button onClick={() => mudarStatus(c, "aprovado")} className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700">Aprovar</button>
                    )}
                    {c.status === "aprovado" && (
                      <button onClick={() => mudarStatus(c, "comprado")} className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-green-600 text-white hover:bg-green-700">Marcar comprado</button>
                    )}
                    {(c.status === "analise" || c.status === "aprovado") && (
                      <button onClick={() => mudarStatus(c, "cancelado")} title="Cancelar pedido" className="p-1.5 rounded-lg text-gray-400 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/20"><X size={14} /></button>
                    )}
                    <button onClick={() => excluir(c)} title="Excluir pedido" className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"><Trash2 size={14} /></button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Modal: pedir compra ── */}
      {pedirFor && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => !busy && setPedirFor(null)}>
          <div className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-sm shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
              <h3 className="font-bold text-gray-900 dark:text-white">Pedir compra</h3>
              <button onClick={() => setPedirFor(null)} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400"><X size={18} /></button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div>
                <p className="text-xs text-gray-400 mb-0.5">Produto</p>
                <p className="font-medium text-gray-900 dark:text-white">{pedirFor.nome}</p>
                <p className="text-xs text-gray-400 mt-0.5">Estoque atual: {pedirFor.estoque ?? 0} · mínimo: {pedirFor.estoque_minimo ?? 0}</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Quantidade a comprar</label>
                <input
                  type="number" min={1} value={qtd}
                  onChange={(e) => setQtd(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 outline-none focus:border-gold-400"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Observação (opcional)</label>
                <input
                  value={obs}
                  onChange={(e) => setObs(e.target.value)}
                  placeholder="Ex: comprar no fornecedor X"
                  className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 outline-none focus:border-gold-400"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 px-5 py-4 border-t border-gray-100 dark:border-gray-800">
              <button onClick={() => setPedirFor(null)} disabled={busy} className="px-4 py-2 text-sm font-medium rounded-xl text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800">Cancelar</button>
              <button onClick={criarCompra} disabled={busy} className="px-4 py-2 text-sm font-semibold rounded-xl bg-gold-600 text-white hover:bg-gold-700 disabled:opacity-50 flex items-center gap-1.5">
                {busy && <Loader2 size={14} className="animate-spin" />} Enviar pra análise
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

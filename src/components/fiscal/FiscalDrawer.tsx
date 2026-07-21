// Drawer lateral do card fiscal (mesmo padrão do JobDetailDrawer).
// Elegível: mostra o pacote aberto (serviço x produto), pagamentos e emite a
// NFS-e só da parte de SERVIÇO (inteligência tributária: produto sai em NF-e
// à parte). Nota emitida: detalhe + PDF/XML.
import React, { useEffect, useMemo, useState } from "react";
import {
  X, Camera, Calendar, CheckCircle2, Receipt, Loader2, Download, FileText,
  Layers, Package, Briefcase, AlertTriangle, Info,
} from "lucide-react";
import { cn } from "../../utils/cn";
import {
  Elegivel, Invoice, FiscalConfig, JobFinanceiro, CatalogItem,
  api, brl, dataBr, baixarArquivo,
} from "./fiscalShared";

const CATALOG_CFG: Record<CatalogItem["catalog_type"], { icon: React.ReactNode; bg: string; border: string; color: string; label: string }> = {
  combo:   { icon: <Layers size={13} />,    bg: "bg-amber-50 dark:bg-amber-900/20",   border: "border-amber-200 dark:border-amber-800",   color: "text-amber-600 dark:text-amber-400",   label: "Combo" },
  produto: { icon: <Package size={13} />,   bg: "bg-blue-50 dark:bg-blue-900/20",     border: "border-blue-200 dark:border-blue-800",     color: "text-blue-600 dark:text-blue-400",     label: "Produto" },
  servico: { icon: <Briefcase size={13} />, bg: "bg-purple-50 dark:bg-purple-900/20", border: "border-purple-200 dark:border-purple-800", color: "text-purple-600 dark:text-purple-400", label: "Serviço" },
};

const inputCls =
  "w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-900 dark:text-white outline-none focus:border-gold-300 dark:focus:border-gold-500 focus:ring-2 focus:ring-gold-100 dark:focus:ring-gold-500/20 transition-all";

function Rotulo({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">{children}</p>;
}

// ─── Drawer de ELEGÍVEL (abrir e emitir) ─────────────────────────────────────
export function FiscalDrawerElegivel({ item, cfg, onClose, onEmitted }: {
  item: Elegivel; cfg: FiscalConfig; onClose: () => void; onEmitted: () => void;
}) {
  const [fin, setFin] = useState<JobFinanceiro | null>(null);
  const [finLoading, setFinLoading] = useState(true);
  const [incluidos, setIncluidos] = useState<Set<string>>(new Set());
  const [valorManual, setValorManual] = useState<string | null>(null);
  const [nome, setNome] = useState(item.client_name || "");
  const [doc, setDoc] = useState(item.tomador_doc || "");
  const [email, setEmail] = useState(item.tomador_email || "");
  const [salvarCpf, setSalvarCpf] = useState(true);
  const [descricao, setDescricao] = useState(
    `${cfg.servico_discriminacao || "Serviço de fotografia — ensaio fotográfico."}${item.job_name ? ` (${item.job_name})` : ""}`,
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [okInfo, setOkInfo] = useState<{ id: string; chave?: string; numero?: string | null } | null>(null);

  const cpfFaltava = item.faltas.includes("cpf");
  const prod = cfg.environment === "production";

  useEffect(() => {
    let vivo = true;
    api<JobFinanceiro>(`/api/jobs/${item.job_id}/financeiro`)
      .then((f) => {
        if (!vivo) return;
        setFin(f);
        // Padrão tributário: SERVIÇO entra na NFS-e; PRODUTO fica fora (vai em NF-e à parte).
        const todos = [...(f.dealItems || []), ...(f.jobItems || [])];
        setIncluidos(new Set(todos.filter((i) => i.catalog_type !== "produto").map((i) => i.id)));
      })
      .catch(() => { if (vivo) setFin(null); })
      .finally(() => { if (vivo) setFinLoading(false); });
    return () => { vivo = false; };
  }, [item.job_id]);

  const itens = useMemo(() => [...(fin?.dealItems || []), ...(fin?.jobItems || [])], [fin]);
  const temItens = itens.length > 0;
  const sub = (i: CatalogItem) => i.catalog_value * i.quantidade;

  const somaIncluidos = itens.filter((i) => incluidos.has(i.id)).reduce((s, i) => s + sub(i), 0);
  const somaFora = itens.filter((i) => !incluidos.has(i.id)).reduce((s, i) => s + sub(i), 0);
  const valorNota = valorManual !== null ? Number(valorManual) : (temItens ? somaIncluidos : (fin?.jobAmount ?? item.valor));

  const toggle = (id: string) => {
    setValorManual(null);
    setIncluidos((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };

  const emitir = async () => {
    setErr(""); setBusy(true);
    try {
      const r = await api<{ id: string; chave_acesso?: string; numero?: string | null }>("/api/fiscal/nfse", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          job_id: item.job_id, client_id: item.client_id,
          valor: valorNota, discriminacao: descricao,
          salvar_cpf: cpfFaltava && salvarCpf,
          tomador: { cpfCnpj: doc, razaoSocial: nome, email: email || undefined },
        }),
      });
      setOkInfo({ id: r.id, chave: r.chave_acesso, numero: r.numero });
    } catch (e: any) { setErr(e?.message || "Erro ao emitir."); }
    finally { setBusy(false); }
  };

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm" onClick={busy ? undefined : onClose} />
      <div className="fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col bg-white shadow-2xl dark:bg-gray-900">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-gray-200 px-5 py-4 dark:border-gray-700">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white truncate">{item.client_name || "(sem nome)"}</h2>
            <p className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              <span className="flex items-center gap-1"><Camera size={11} /> {item.job_name || "Ensaio"}</span>
              <span className="flex items-center gap-1"><Calendar size={11} /> {dataBr(item.job_date)}</span>
            </p>
          </div>
          <button onClick={onClose} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-200 flex-shrink-0">
            <X size={18} />
          </button>
        </div>

        {okInfo ? (
          <div className="flex-1 overflow-y-auto px-5 py-6 space-y-4">
            <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 font-semibold">
              <CheckCircle2 size={20} /> NFS-e emitida com sucesso!
            </div>
            {okInfo.numero && <p className="text-sm text-gray-600 dark:text-gray-300">Número da nota: <b>{okInfo.numero}</b></p>}
            {okInfo.chave && <p className="text-[11px] text-gray-400 break-all">Chave: {okInfo.chave}</p>}
            {somaFora > 0 && (
              <div className="rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 px-3 py-2.5 text-[12px] text-blue-700 dark:text-blue-300 flex gap-2">
                <Info size={14} className="flex-shrink-0 mt-0.5" />
                <span>Produtos ({brl(somaFora)}) ficaram FORA desta nota — emita a NF-e de produto na sua plataforma atual pra fechar o total do pacote.</span>
              </div>
            )}
            <div className="flex gap-2 pt-1">
              <button onClick={() => baixarArquivo(`/api/fiscal/nfse/${okInfo.id}/pdf`, "nfse.pdf")}
                className="flex items-center gap-1.5 px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-200">
                <Download size={15} /> PDF
              </button>
              <button onClick={() => baixarArquivo(`/api/fiscal/nfse/${okInfo.id}/xml`, "nfse.xml")}
                className="flex items-center gap-1.5 px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-200">
                <FileText size={15} /> XML
              </button>
              <button onClick={onEmitted} className="ml-auto px-4 py-2 bg-gold-600 hover:bg-gold-700 text-white rounded-xl text-sm font-semibold">Fechar</button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
              {/* Resumo financeiro */}
              {finLoading ? (
                <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-12 rounded-xl animate-pulse bg-gray-100 dark:bg-gray-800" />)}</div>
              ) : fin && (
                <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                  <div className="grid grid-cols-3 divide-x divide-gray-200 dark:divide-gray-700">
                    <div className="p-3 text-center">
                      <p className="text-[10px] font-semibold text-gray-400 uppercase mb-1">Pacote</p>
                      <p className="text-sm font-bold text-gray-900 dark:text-white">{brl(fin.jobAmount)}</p>
                    </div>
                    <div className="p-3 text-center bg-emerald-50/50 dark:bg-emerald-900/10">
                      <p className="text-[10px] font-semibold text-emerald-500 uppercase mb-1">Pago</p>
                      <p className="text-sm font-bold text-emerald-700 dark:text-emerald-400">{brl(fin.totalPago)}</p>
                    </div>
                    <div className="p-3 text-center">
                      <p className="text-[10px] font-semibold text-gray-400 uppercase mb-1">Situação</p>
                      <p className={cn("text-sm font-bold", fin.payment_status === "paid" ? "text-emerald-600" : fin.payment_status === "partial" ? "text-amber-600" : "text-orange-600")}>
                        {fin.payment_status === "paid" ? "Pago" : fin.payment_status === "partial" ? "Parcial" : "Pendente"}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Pacote aberto: o que entra na NFS-e (serviço) e o que fica fora (produto) */}
              {temItens ? (
                <section>
                  <Rotulo>O que entra nesta NFS-e (serviço)</Rotulo>
                  <div className="space-y-1.5">
                    {itens.map((it) => {
                      const c = CATALOG_CFG[it.catalog_type] || CATALOG_CFG.servico;
                      const on = incluidos.has(it.id);
                      return (
                        <label key={it.id} className={cn("flex items-center gap-2 px-3 py-2 rounded-xl border cursor-pointer transition-opacity", c.bg, c.border, !on && "opacity-45")}>
                          <input type="checkbox" checked={on} onChange={() => toggle(it.id)} className="accent-[#D4A94A]" />
                          <span className={cn("flex-shrink-0", c.color)}>{c.icon}</span>
                          <span className="flex-1 text-sm text-gray-800 dark:text-gray-100 truncate min-w-0">
                            {it.catalog_name}{it.quantidade > 1 ? ` ×${it.quantidade}` : ""}
                          </span>
                          <span className={cn("text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full bg-white/70 dark:bg-black/20", c.color)}>{c.label}</span>
                          <span className="text-sm font-semibold text-gray-700 dark:text-gray-200 flex-shrink-0">{brl(sub(it))}</span>
                        </label>
                      );
                    })}
                  </div>
                  <div className="mt-2 space-y-1 text-[12px]">
                    <div className="flex justify-between text-gray-600 dark:text-gray-300">
                      <span>NFS-e de serviço (esta nota)</span><b>{brl(somaIncluidos)}</b>
                    </div>
                    {somaFora > 0 && (
                      <div className="flex justify-between text-blue-600 dark:text-blue-400">
                        <span className="flex items-center gap-1"><Package size={11} /> Produto — NF-e à parte (plataforma atual)</span><b>{brl(somaFora)}</b>
                      </div>
                    )}
                  </div>
                  <p className="text-[11px] text-gray-400 mt-1.5">
                    Separar serviço de produto é o seu planejamento tributário: produto paga menos imposto em NF-e própria. Desmarque itens pra tirá-los desta nota.
                  </p>
                </section>
              ) : fin?.packageItem ? (
                <section>
                  <Rotulo>Pacote (sem itens separados)</Rotulo>
                  <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-3 py-2.5 text-[12px] text-amber-700 dark:text-amber-300 flex gap-2">
                    <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
                    <span>“{fin.packageItem.name}” não tem itens separados por tipo. Se parte do valor for produto (álbum, quadro), ajuste o valor da nota abaixo e emita a NF-e do produto à parte.</span>
                  </div>
                </section>
              ) : null}

              {/* Dados do tomador */}
              <section className="space-y-3">
                <Rotulo>Dados da nota</Rotulo>
                <div>
                  <span className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">Cliente (tomador)</span>
                  <input className={inputCls} value={nome} onChange={(e) => setNome(e.target.value)} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <span className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">CPF/CNPJ</span>
                    <input className={inputCls} value={doc} onChange={(e) => setDoc(e.target.value)} placeholder="000.000.000-00" />
                    {cpfFaltava && <span className="block text-[10px] text-amber-600 dark:text-amber-400 mt-0.5">Estava faltando no cadastro.</span>}
                  </div>
                  <div>
                    <span className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">E-mail (opcional)</span>
                    <input className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} />
                  </div>
                </div>
                {cpfFaltava && (
                  <label className="flex items-center gap-2 text-[12px] text-gray-600 dark:text-gray-300">
                    <input type="checkbox" checked={salvarCpf} onChange={(e) => setSalvarCpf(e.target.checked)} className="accent-[#D4A94A]" />
                    Salvar este CPF no cadastro do cliente
                  </label>
                )}
                <div>
                  <span className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">Valor da NFS-e (R$)</span>
                  <input type="number" step="0.01" className={inputCls} value={valorManual !== null ? valorManual : String(valorNota || "")}
                    onChange={(e) => setValorManual(e.target.value)} />
                  {temItens && valorManual !== null && Number(valorManual) !== somaIncluidos && (
                    <button onClick={() => setValorManual(null)} className="text-[11px] text-gold-600 dark:text-gold-400 mt-0.5">
                      Voltar pro valor dos itens marcados ({brl(somaIncluidos)})
                    </button>
                  )}
                </div>
                <div>
                  <span className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">Descrição na nota</span>
                  <textarea className={inputCls} rows={2} value={descricao} onChange={(e) => setDescricao(e.target.value)} />
                </div>
                {err && <div className="text-sm text-rose-600 bg-rose-50 dark:bg-rose-900/20 px-3 py-2 rounded-xl">{err}</div>}
              </section>
            </div>

            {/* Footer */}
            <div className="border-t border-gray-200 dark:border-gray-700 px-5 py-4 space-y-2">
              <div className={cn("text-[12px] px-3 py-2 rounded-xl font-medium",
                prod ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
                     : "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300")}>
                {prod ? "PRODUÇÃO — nota fiscal real, vale na prefeitura." : "HOMOLOGAÇÃO — nota de teste, não vale na prefeitura."}
              </div>
              <button onClick={emitir} disabled={busy || !nome || !doc || !(valorNota > 0)}
                className="w-full flex items-center justify-center gap-1.5 px-4 py-2.5 bg-gold-600 hover:bg-gold-700 disabled:opacity-50 text-white rounded-xl text-sm font-semibold">
                {busy ? <Loader2 size={16} className="animate-spin" /> : <Receipt size={16} />}
                Emitir NFS-e de {brl(valorNota || 0)}
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}

// ─── Drawer de NOTA EMITIDA (detalhe) ────────────────────────────────────────
export function FiscalDrawerNota({ nota, onClose, onExcluir }: {
  nota: Invoice; onClose: () => void; onExcluir: () => void;
}) {
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col bg-white shadow-2xl dark:bg-gray-900">
        <div className="flex items-start justify-between border-b border-gray-200 px-5 py-4 dark:border-gray-700">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white truncate">{nota.tomador_nome || "Nota fiscal"}</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              {nota.numero ? `NFS-e nº ${nota.numero} · ` : ""}{new Date(nota.emitida_em || nota.created_at).toLocaleDateString("pt-BR")}
              {nota.ambiente === "sandbox" ? " · TESTE" : ""}
            </p>
          </div>
          <button onClick={onClose} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-200 flex-shrink-0">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="grid grid-cols-2 divide-x divide-gray-200 dark:divide-gray-700">
              <div className="p-3 text-center">
                <p className="text-[10px] font-semibold text-gray-400 uppercase mb-1">Valor</p>
                <p className="text-sm font-bold text-gray-900 dark:text-white">{brl(nota.valor)}</p>
              </div>
              <div className="p-3 text-center bg-emerald-50/50 dark:bg-emerald-900/10">
                <p className="text-[10px] font-semibold text-emerald-500 uppercase mb-1">Status</p>
                <p className="text-sm font-bold text-emerald-700 dark:text-emerald-400 flex items-center justify-center gap-1">
                  <CheckCircle2 size={13} /> Autorizada
                </p>
              </div>
            </div>
          </div>

          <section>
            <Rotulo>Tomador</Rotulo>
            <p className="text-sm text-gray-800 dark:text-gray-100">{nota.tomador_nome || "—"}</p>
            <p className="text-xs text-gray-400">{nota.tomador_doc || ""}</p>
          </section>

          {nota.discriminacao && (
            <section>
              <Rotulo>Descrição</Rotulo>
              <p className="text-sm text-gray-700 dark:text-gray-200">{nota.discriminacao}</p>
            </section>
          )}

          {nota.chave_acesso && (
            <section>
              <Rotulo>Chave de acesso</Rotulo>
              <p className="text-[11px] text-gray-400 break-all font-mono">{nota.chave_acesso}</p>
            </section>
          )}

          <div className="flex gap-2">
            <button onClick={() => baixarArquivo(`/api/fiscal/nfse/${nota.id}/pdf`, `nfse-${nota.numero || nota.id}.pdf`)}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gold-50 dark:hover:bg-gold-900/20">
              <Download size={15} /> PDF (DANFSe)
            </button>
            <button onClick={() => baixarArquivo(`/api/fiscal/nfse/${nota.id}/xml`, `nfse-${nota.numero || nota.id}.xml`)}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gold-50 dark:hover:bg-gold-900/20">
              <FileText size={15} /> XML
            </button>
          </div>

          {nota.ambiente === "production" && (
            <p className="text-[11px] text-gray-400">
              Precisa cancelar esta nota na prefeitura? Por enquanto o cancelamento oficial é no portal nfse.gov.br (1 minuto).
            </p>
          )}
        </div>

        <div className="border-t border-gray-200 dark:border-gray-700 px-5 py-3">
          <button onClick={onExcluir}
            className="w-full px-4 py-2 rounded-xl text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 border border-red-200 dark:border-red-900 transition-colors">
            Excluir registro do app
          </button>
        </div>
      </div>
    </>
  );
}

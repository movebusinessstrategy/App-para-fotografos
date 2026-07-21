import React, { useEffect, useMemo, useState } from "react";
import {
  Receipt, Building2, ShieldCheck, Plus, RefreshCw, Download, XCircle,
  CheckCircle2, Clock, AlertTriangle, Loader2, Save, Upload, FileText, Search, X,
} from "lucide-react";
import ConfirmModal from "../components/shared/ConfirmModal";
import { FiscalKanban } from "../components/fiscal/FiscalKanban";
import { FiscalDrawerElegivel, FiscalDrawerNota } from "../components/fiscal/FiscalDrawer";
import {
  FiscalConfig, Invoice, Elegivel, api, brl, baixarArquivo,
} from "../components/fiscal/fiscalShared";

const STATUS_META: Record<string, { label: string; cls: string; icon: React.ElementType }> = {
  autorizada:  { label: "Autorizada", cls: "text-emerald-700 bg-emerald-50 dark:text-emerald-300 dark:bg-emerald-900/30", icon: CheckCircle2 },
  processando: { label: "Processando", cls: "text-amber-700 bg-amber-50 dark:text-amber-300 dark:bg-amber-900/30", icon: Clock },
  rejeitada:   { label: "Rejeitada", cls: "text-rose-700 bg-rose-50 dark:text-rose-300 dark:bg-rose-900/30", icon: AlertTriangle },
  erro:        { label: "Erro", cls: "text-rose-700 bg-rose-50 dark:text-rose-300 dark:bg-rose-900/30", icon: AlertTriangle },
  cancelada:   { label: "Cancelada", cls: "text-gray-600 bg-gray-100 dark:text-gray-300 dark:bg-gray-800", icon: XCircle },
};

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-gray-400 mt-0.5">{hint}</span>}
    </label>
  );
}
const inputCls =
  "w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white outline-none focus:border-gold-400";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4">
      <h3 className="text-sm font-bold text-gray-800 dark:text-gray-100 mb-3">{title}</h3>
      {children}
    </div>
  );
}

function AmbienteBadge({ env }: { env?: string }) {
  const prod = env === "production";
  return (
    <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${prod ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"}`}>
      {prod ? "Produção" : "Homologação (teste)"}
    </span>
  );
}

interface StageOpt { id: string; label: string }

type Confirmacao = {
  open: boolean; title: string; message: string; onConfirm: () => void;
};
const CONF_FECHADA: Confirmacao = { open: false, title: "", message: "", onConfirm: () => {} };

// ═════════════════════════════════════════════════════════════════════════════
export default function FiscalPage() {
  const [tab, setTab] = useState<"emitir" | "notas" | "config">("emitir");
  const [cfg, setCfg] = useState<FiscalConfig>({ environment: "sandbox", simples_nacional: true });
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [elegiveis, setElegiveis] = useState<Elegivel[]>([]);
  const [etapaMinima, setEtapaMinima] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [busca, setBusca] = useState("");
  const [drawerElegivel, setDrawerElegivel] = useState<Elegivel | null>(null);
  const [drawerNota, setDrawerNota] = useState<Invoice | null>(null);
  const [confirmacao, setConfirmacao] = useState<Confirmacao>(CONF_FECHADA);
  const [avulsaOpen, setAvulsaOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [c, inv, ele] = await Promise.all([
        api<FiscalConfig | null>("/api/fiscal/config"),
        api<Invoice[]>("/api/fiscal/nfse"),
        api<{ itens: Elegivel[]; etapa_minima: string | null }>("/api/fiscal/elegiveis").catch(() => ({ itens: [], etapa_minima: null })),
      ]);
      if (c) setCfg({ environment: "sandbox", simples_nacional: true, ...c });
      setInvoices(inv || []);
      setElegiveis(ele.itens || []);
      setEtapaMinima(ele.etapa_minima || null);
    } catch (e: any) {
      setMsg({ type: "err", text: e?.message || "Erro ao carregar." });
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const set = (k: keyof FiscalConfig, v: unknown) => setCfg((p) => ({ ...p, [k]: v }));

  const saveConfig = async () => {
    setSaving(true); setMsg(null);
    try {
      const saved = await api<FiscalConfig>("/api/fiscal/config", {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cfg),
      });
      setCfg({ environment: "sandbox", simples_nacional: true, ...saved });
      setMsg({ type: "ok", text: "Configuração salva." });
      load();
    } catch (e: any) { setMsg({ type: "err", text: e?.message || "Erro ao salvar." }); }
    finally { setSaving(false); }
  };

  const enviarCertificado = async (file: File, senha: string) => {
    setSaving(true); setMsg(null);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).split(",")[1] || "");
        r.onerror = reject;
        r.readAsDataURL(file);
      });
      const r = await api<{ titular?: string }>("/api/fiscal/certificado", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pfxBase64: base64, senha }),
      });
      setMsg({ type: "ok", text: `Certificado OK${r.titular ? ` (${r.titular})` : ""}. Emissão liberada.` });
      await load();
    } catch (e: any) { setMsg({ type: "err", text: e?.message || "Erro ao enviar certificado." }); }
    finally { setSaving(false); }
  };

  const podeEmitir = !!(cfg.cnpj && cfg.codigo_cidade && cfg.certificado_enviado);

  // Busca filtra os 3 grupos por nome do cliente / número da nota.
  const q = busca.trim().toLowerCase();
  const filtrados = useMemo(() => {
    const bate = (s?: string | null) => !q || String(s || "").toLowerCase().includes(q);
    const ele = elegiveis.filter((i) => bate(i.client_name) || bate(i.job_name));
    return {
      prontos: ele.filter((i) => i.faltas.length === 0),
      incompletos: ele.filter((i) => i.faltas.length > 0),
      emitidas: invoices.filter((n) => n.status === "autorizada" && (bate(n.tomador_nome) || bate(n.numero))).slice(0, 60),
    };
  }, [elegiveis, invoices, q]);

  // ── Ações com confirmação ──────────────────────────────────────────────────
  const pedirDispensa = (it: Elegivel) => setConfirmacao({
    open: true,
    title: "Tirar da fila de nota",
    message: `Tirar "${it.client_name || it.job_name || "este ensaio"}" da fila? Ele não vai mais aparecer pra emitir nota (o ensaio continua intacto na Produção).`,
    onConfirm: async () => {
      try {
        await api("/api/fiscal/dispensar", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ job_id: it.job_id, tomador_nome: it.client_name }),
        });
        load();
      } catch (e: any) { setMsg({ type: "err", text: e?.message || "Erro." }); }
    },
  });

  const pedirExclusaoNota = (n: Invoice) => setConfirmacao({
    open: true,
    title: "Excluir registro da nota",
    message: n.ambiente === "production" && n.status === "autorizada"
      ? `Excluir o registro da nota ${n.numero ? `nº ${n.numero} ` : ""}do app? ATENÇÃO: isso NÃO cancela a nota na prefeitura — pra cancelar de verdade, use o portal nfse.gov.br. Esta ação não pode ser desfeita.`
      : `Excluir o registro ${n.numero ? `da nota nº ${n.numero} ` : ""}do app? Esta ação não pode ser desfeita.`,
    onConfirm: async () => {
      try {
        const r = await api<{ aviso?: string | null }>(`/api/fiscal/nfse/${n.id}`, { method: "DELETE" });
        setDrawerNota(null);
        if (r.aviso) setMsg({ type: "ok", text: r.aviso });
        load();
      } catch (e: any) { setMsg({ type: "err", text: e?.message || "Erro ao excluir." }); }
    },
  });

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 md:px-6 py-4 border-b border-gray-200 dark:border-gray-800">
        <div className="flex items-center gap-2">
          <Receipt className="w-5 h-5 text-gold-500" />
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Nota Fiscal</h1>
          <AmbienteBadge env={cfg.environment} />
        </div>
        <div className="flex items-center gap-2">
          {tab === "emitir" && (
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500" size={16} />
              <input
                type="text" value={busca} onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar cliente..."
                className="pl-9 pr-8 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl outline-none text-sm text-gray-700 dark:text-gray-200 w-48 md:w-64 focus:border-gold-300 dark:focus:border-gold-500 focus:ring-2 focus:ring-gold-100 dark:focus:ring-gold-500/20 transition-all placeholder:text-gray-400 dark:placeholder:text-gray-500"
              />
              {busca && (
                <button type="button" onClick={() => setBusca("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300">
                  <X size={14} />
                </button>
              )}
            </div>
          )}
          <button onClick={() => setAvulsaOpen(true)} disabled={!podeEmitir}
            className="flex items-center gap-1.5 px-3 py-2 bg-gold-600 hover:bg-gold-700 disabled:opacity-50 text-white rounded-xl text-sm font-semibold">
            <Plus size={16} /> Avulsa
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 px-4 md:px-6 pt-3 border-b border-gray-200 dark:border-gray-800">
        {([["emitir", "Quadro"], ["notas", "Histórico"], ["config", "Configuração"]] as const).map(([k, lbl]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === k ? "border-gold-500 text-gold-600 dark:text-gold-400" : "border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-200"}`}>
            {lbl}
          </button>
        ))}
      </div>

      {msg && (
        <div className={`mx-4 md:mx-6 mt-3 text-sm px-3 py-2 rounded-lg flex items-start justify-between gap-2 ${msg.type === "ok" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" : "bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300"}`}>
          <span>{msg.text}</span>
          <button onClick={() => setMsg(null)} className="flex-shrink-0 opacity-60 hover:opacity-100"><X size={14} /></button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-gray-400"><Loader2 className="animate-spin" /></div>
        ) : tab === "emitir" ? (
          !podeEmitir ? (
            <div className="text-center py-16">
              <ShieldCheck className="mx-auto mb-3 text-gray-300" size={40} />
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
                Pra emitir, complete a configuração (CNPJ, código IBGE) e envie o certificado A1.
              </p>
              <button onClick={() => setTab("config")} className="px-4 py-2 bg-gold-600 hover:bg-gold-700 text-white rounded-xl text-sm font-semibold">
                Ir pra Configuração
              </button>
            </div>
          ) : (
            <>
              {etapaMinima && (
                <p className="text-[12px] text-gray-400 mb-3">
                  Ensaios entram no quadro ao chegar na etapa “{etapaMinima}” da Produção (mude na Configuração).
                </p>
              )}
              <FiscalKanban
                prontos={filtrados.prontos}
                incompletos={filtrados.incompletos}
                emitidas={filtrados.emitidas}
                onAbrirElegivel={setDrawerElegivel}
                onAbrirNota={setDrawerNota}
                onDispensar={pedirDispensa}
                onExcluirNota={pedirExclusaoNota}
              />
            </>
          )
        ) : tab === "notas" ? (
          <NotasTab invoices={invoices} onRefresh={load} onAbrir={setDrawerNota} />
        ) : (
          <ConfigTab cfg={cfg} set={set} saving={saving} onSave={saveConfig} onEnviarCertificado={enviarCertificado} />
        )}
      </div>

      {/* Drawers */}
      {drawerElegivel && (
        <FiscalDrawerElegivel item={drawerElegivel} cfg={cfg}
          onClose={() => setDrawerElegivel(null)}
          onEmitted={() => { setDrawerElegivel(null); load(); }} />
      )}
      {drawerNota && (
        <FiscalDrawerNota nota={drawerNota}
          onClose={() => setDrawerNota(null)}
          onExcluir={() => pedirExclusaoNota(drawerNota)} />
      )}
      {avulsaOpen && (
        <AvulsaModal cfg={cfg} onClose={() => setAvulsaOpen(false)}
          onEmitted={() => { setAvulsaOpen(false); load(); }} />
      )}

      <ConfirmModal
        open={confirmacao.open}
        title={confirmacao.title}
        message={confirmacao.message}
        confirmLabel="Excluir"
        cancelLabel="Cancelar"
        variant="danger"
        onCancel={() => setConfirmacao(CONF_FECHADA)}
        onConfirm={() => { const fn = confirmacao.onConfirm; setConfirmacao(CONF_FECHADA); fn(); }}
      />
    </div>
  );
}

// ─── Modal: emissão avulsa (sem ensaio vinculado) ────────────────────────────
function AvulsaModal({ cfg, onClose, onEmitted }: { cfg: FiscalConfig; onClose: () => void; onEmitted: () => void }) {
  const [nome, setNome] = useState("");
  const [doc, setDoc] = useState("");
  const [email, setEmail] = useState("");
  const [valor, setValor] = useState("");
  const [descricao, setDescricao] = useState(cfg.servico_discriminacao || "Serviço de fotografia — ensaio fotográfico.");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [okInfo, setOkInfo] = useState<{ id: string; numero?: string | null } | null>(null);
  const prod = cfg.environment === "production";

  const emitir = async () => {
    setErr(""); setBusy(true);
    try {
      const r = await api<{ id: string; numero?: string | null }>("/api/fiscal/nfse", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ valor: Number(valor), discriminacao: descricao, tomador: { cpfCnpj: doc, razaoSocial: nome, email: email || undefined } }),
      });
      setOkInfo(r);
    } catch (e: any) { setErr(e?.message || "Erro ao emitir."); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={busy ? undefined : onClose} />
      <div className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-md border border-gray-200 dark:border-gray-800 max-h-[90vh] overflow-y-auto">
        <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800">
          <h3 className="font-bold text-gray-900 dark:text-white flex items-center gap-2"><Receipt size={16} className="text-gold-500" /> NFS-e avulsa</h3>
          <div className={`mt-2 text-[12px] px-2.5 py-1.5 rounded-lg font-medium ${prod ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" : "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"}`}>
            {prod ? "PRODUÇÃO — nota real." : "HOMOLOGAÇÃO — nota de teste."}
          </div>
        </div>
        {okInfo ? (
          <div className="p-5 space-y-3">
            <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 font-semibold">
              <CheckCircle2 size={18} /> Nota emitida!{okInfo.numero ? ` Nº ${okInfo.numero}` : ""}
            </div>
            <div className="flex gap-2">
              <button onClick={() => baixarArquivo(`/api/fiscal/nfse/${okInfo.id}/pdf`, "nfse.pdf")}
                className="flex items-center gap-1.5 px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-700 dark:text-gray-200"><Download size={15} /> PDF</button>
              <button onClick={onEmitted} className="ml-auto px-4 py-2 bg-gold-600 hover:bg-gold-700 text-white rounded-xl text-sm font-semibold">Fechar</button>
            </div>
          </div>
        ) : (
          <>
            <div className="p-5 space-y-3">
              <Field label="Cliente (tomador)"><input className={inputCls} value={nome} onChange={(e) => setNome(e.target.value)} /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="CPF/CNPJ"><input className={inputCls} value={doc} onChange={(e) => setDoc(e.target.value)} /></Field>
                <Field label="E-mail (opcional)"><input className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
              </div>
              <Field label="Valor do serviço (R$)"><input type="number" step="0.01" className={inputCls} value={valor} onChange={(e) => setValor(e.target.value)} /></Field>
              <Field label="Descrição"><textarea className={inputCls} rows={2} value={descricao} onChange={(e) => setDescricao(e.target.value)} /></Field>
              {err && <div className="text-sm text-rose-600 bg-rose-50 dark:bg-rose-900/20 px-3 py-2 rounded-lg">{err}</div>}
            </div>
            <div className="px-5 py-4 border-t border-gray-100 dark:border-gray-800 flex justify-end gap-2">
              <button onClick={onClose} className="px-4 py-2 text-sm text-gray-500">Cancelar</button>
              <button onClick={emitir} disabled={busy || !nome || !doc || !(Number(valor) > 0)}
                className="flex items-center gap-1.5 px-4 py-2 bg-gold-600 hover:bg-gold-700 disabled:opacity-50 text-white rounded-xl text-sm font-semibold">
                {busy ? <Loader2 size={16} className="animate-spin" /> : <Receipt size={16} />} Emitir
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Aba: Histórico (todas as notas, inclusive erro/cancelada) ───────────────
function NotasTab({ invoices, onRefresh, onAbrir }: { invoices: Invoice[]; onRefresh: () => void; onAbrir: (n: Invoice) => void }) {
  const [busy, setBusy] = useState<string | null>(null);

  const refreshOne = async (id: string) => {
    setBusy(id);
    try { await api(`/api/fiscal/nfse/${id}/refresh`, { method: "POST" }); onRefresh(); }
    finally { setBusy(null); }
  };

  if (invoices.length === 0) {
    return <div className="text-center py-16 text-gray-400 text-sm">Nenhuma nota emitida ainda.</div>;
  }

  return (
    <div className="overflow-x-auto bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl">
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase text-gray-400 border-b border-gray-100 dark:border-gray-800">
          <tr>
            <th className="px-4 py-3">Cliente</th><th className="px-4 py-3">Valor</th>
            <th className="px-4 py-3">Número</th><th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">Data</th><th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody>
          {invoices.map((inv) => {
            const meta = STATUS_META[inv.status] || STATUS_META.processando;
            const Icon = meta.icon;
            const temDoc = inv.status === "autorizada" && (inv.chave_acesso || inv.pdf_url);
            return (
              <tr key={inv.id} onClick={() => inv.status === "autorizada" && onAbrir(inv)}
                className={`border-b border-gray-50 dark:border-gray-800/50 ${inv.status === "autorizada" ? "cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/40" : ""}`}>
                <td className="px-4 py-3">
                  <div className="font-medium text-gray-900 dark:text-white">{inv.tomador_nome || "—"}</div>
                  <div className="text-[11px] text-gray-400">{inv.tomador_doc}</div>
                  {inv.ambiente === "sandbox" && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">teste</span>}
                  {inv.error_message && <div className="text-[11px] text-rose-500 mt-0.5 max-w-xs truncate" title={inv.error_message}>{inv.error_message}</div>}
                </td>
                <td className="px-4 py-3 font-semibold text-gray-900 dark:text-white">{brl(inv.valor)}</td>
                <td className="px-4 py-3 text-gray-600 dark:text-gray-300">{inv.numero || "—"}</td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${meta.cls}`}><Icon size={11} /> {meta.label}</span>
                </td>
                <td className="px-4 py-3 text-gray-500 text-xs">{new Date(inv.emitida_em || inv.created_at).toLocaleDateString("pt-BR")}</td>
                <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-end gap-1.5">
                    {temDoc && (
                      <>
                        <button onClick={() => baixarArquivo(`/api/fiscal/nfse/${inv.id}/pdf`, `nfse-${inv.numero || inv.id}.pdf`)} title="PDF"
                          className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500"><Download size={15} /></button>
                        <button onClick={() => baixarArquivo(`/api/fiscal/nfse/${inv.id}/xml`, `nfse-${inv.numero || inv.id}.xml`)} title="XML"
                          className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500"><FileText size={15} /></button>
                      </>
                    )}
                    <button onClick={() => refreshOne(inv.id)} disabled={busy === inv.id} title="Atualizar"
                      className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500">
                      <RefreshCw size={15} className={busy === inv.id ? "animate-spin" : ""} />
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Aba: Configuração ───────────────────────────────────────────────────────
function ConfigTab({ cfg, set, saving, onSave, onEnviarCertificado }: {
  cfg: FiscalConfig; set: (k: keyof FiscalConfig, v: unknown) => void; saving: boolean;
  onSave: () => void; onEnviarCertificado: (f: File, s: string) => void;
}) {
  const [pfx, setPfx] = useState<File | null>(null);
  const [senha, setSenha] = useState("");
  const [etapas, setEtapas] = useState<StageOpt[]>([]);
  const [avancado, setAvancado] = useState(false);

  useEffect(() => {
    Promise.all([
      api<any[]>("/api/production/processes").catch(() => []),
      api<any[]>("/api/production/stages-v2").catch(() => []),
    ]).then(([procs, stages]) => {
      const pos = new Map((procs || []).map((p: any) => [p.id, p.position ?? 0]));
      const nomeProc = new Map((procs || []).map((p: any) => [p.id, p.name]));
      const ord = [...(stages || [])].sort((a: any, b: any) =>
        ((pos.get(a.process_id) ?? 0) - (pos.get(b.process_id) ?? 0)) || ((a.position ?? 0) - (b.position ?? 0)));
      setEtapas(ord.map((s: any) => ({ id: s.id, label: `${nomeProc.get(s.process_id) ? nomeProc.get(s.process_id) + " · " : ""}${s.name}` })));
    });
  }, []);

  return (
    <div className="max-w-3xl space-y-6">
      <div className="grid grid-cols-2 gap-3">
        <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm ${cfg.cnpj && cfg.codigo_cidade ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-900/20 dark:text-emerald-300" : "border-gray-200 dark:border-gray-700 text-gray-500"}`}>
          <Building2 size={16} /> Dados do estúdio {cfg.cnpj && cfg.codigo_cidade ? "✓" : "—"}
        </div>
        <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm ${cfg.certificado_enviado ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-900/20 dark:text-emerald-300" : "border-gray-200 dark:border-gray-700 text-gray-500"}`}>
          <ShieldCheck size={16} /> Certificado A1 {cfg.certificado_enviado ? "✓" : "—"}
        </div>
      </div>

      <Section title="Ambiente">
        <div className="flex gap-2">
          {(["sandbox", "production"] as const).map((env) => (
            <button key={env} onClick={() => set("environment", env)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium border ${cfg.environment === env ? "border-gold-500 bg-gold-50 text-gold-700 dark:bg-gold-900/20 dark:text-gold-300" : "border-gray-200 dark:border-gray-700 text-gray-500"}`}>
              {env === "sandbox" ? "Homologação (teste)" : "Produção (vale na prefeitura)"}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-gray-400 mt-1">Comece em homologação. Depois de 1 nota de teste OK, troque pra produção e salve.</p>
      </Section>

      <Section title="Quando liberar a nota">
        <Field label="Liberar emissão a partir da etapa (Produção)"
          hint="Ensaios que chegarem nesta etapa (ou depois dela) entram no quadro.">
          <select className={inputCls} value={cfg.emit_stage_id || ""} onChange={(e) => set("emit_stage_id", e.target.value || null)}>
            <option value="">— 2ª etapa do kanban (padrão) —</option>
            {etapas.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </Field>
      </Section>

      <Section title="Dados do estúdio (emitente)">
        <div className="grid grid-cols-2 gap-3">
          <Field label="CNPJ"><input className={inputCls} value={cfg.cnpj || ""} onChange={(e) => set("cnpj", e.target.value)} /></Field>
          <Field label="Inscrição Municipal"><input className={inputCls} value={cfg.inscricao_municipal || ""} onChange={(e) => set("inscricao_municipal", e.target.value)} /></Field>
          <Field label="Razão social"><input className={inputCls} value={cfg.razao_social || ""} onChange={(e) => set("razao_social", e.target.value)} /></Field>
          <Field label="Nome fantasia"><input className={inputCls} value={cfg.nome_fantasia || ""} onChange={(e) => set("nome_fantasia", e.target.value)} /></Field>
          <Field label="E-mail"><input className={inputCls} value={cfg.email || ""} onChange={(e) => set("email", e.target.value)} /></Field>
          <Field label="Telefone"><input className={inputCls} value={cfg.telefone || ""} onChange={(e) => set("telefone", e.target.value)} /></Field>
          <Field label="Cidade"><input className={inputCls} value={cfg.cidade || ""} onChange={(e) => set("cidade", e.target.value)} /></Field>
          <Field label="Código IBGE da cidade" hint="7 dígitos (Cambé = 4103701)"><input className={inputCls} value={cfg.codigo_cidade || ""} onChange={(e) => set("codigo_cidade", e.target.value)} /></Field>
          <Field label="UF"><input className={inputCls} maxLength={2} value={cfg.estado || ""} onChange={(e) => set("estado", e.target.value.toUpperCase())} /></Field>
          <Field label="CEP"><input className={inputCls} value={cfg.cep || ""} onChange={(e) => set("cep", e.target.value)} /></Field>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 mt-3">
          <input type="checkbox" checked={cfg.simples_nacional ?? true} onChange={(e) => set("simples_nacional", e.target.checked)} /> Simples Nacional (ME/EPP)
        </label>
      </Section>

      <Section title="Serviço (o que sai na nota)">
        <Field label="Descrição padrão do serviço">
          <textarea className={inputCls} rows={2} value={cfg.servico_discriminacao || ""} onChange={(e) => set("servico_discriminacao", e.target.value)} placeholder="Ex.: Serviço de fotografia — ensaio fotográfico." />
        </Field>
        <button onClick={() => setAvancado(!avancado)} className="text-[12px] text-gold-600 dark:text-gold-400 mt-2">
          {avancado ? "Esconder" : "Mostrar"} campos avançados
        </button>
        {avancado && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-2">
            <Field label="Cód. trib. nacional" hint="Fotografia = 130301"><input className={inputCls} value={cfg.ctrib_nac || ""} onChange={(e) => set("ctrib_nac", e.target.value)} placeholder="130301" /></Field>
            <Field label="Cód. NBS" hint="Fotografia = 114082000"><input className={inputCls} value={cfg.cnbs || ""} onChange={(e) => set("cnbs", e.target.value)} placeholder="114082000" /></Field>
            <Field label="% tributos SN" hint="Informativo"><input type="number" step="0.01" className={inputCls} value={cfg.ptottrib_sn ?? 2} onChange={(e) => set("ptottrib_sn", Number(e.target.value))} /></Field>
            <Field label="Série da DPS" hint="Não mude sem precisar"><input className={inputCls} value={cfg.dps_serie || "00010"} onChange={(e) => set("dps_serie", e.target.value)} /></Field>
          </div>
        )}
      </Section>

      <button onClick={onSave} disabled={saving} className="flex items-center gap-1.5 px-4 py-2 bg-gold-600 hover:bg-gold-700 disabled:opacity-50 text-white rounded-xl text-sm font-semibold">
        <Save size={16} /> Salvar configuração
      </button>

      <Section title="Certificado digital A1">
        <p className="text-[12px] text-gray-500 dark:text-gray-400 mb-2">
          O arquivo .pfx/.p12 fica guardado criptografado e a senha nunca aparece pra ninguém. É ele que assina as notas.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Arquivo .pfx / .p12">
            <input type="file" accept=".pfx,.p12" onChange={(e) => setPfx(e.target.files?.[0] || null)} className="text-sm text-gray-600 dark:text-gray-300" />
          </Field>
          <Field label="Senha do certificado">
            <input type="password" className={inputCls} value={senha} onChange={(e) => setSenha(e.target.value)} />
          </Field>
          <button onClick={() => pfx && senha && onEnviarCertificado(pfx, senha)} disabled={saving || !pfx || !senha}
            className="flex items-center gap-1.5 px-4 py-2 border border-gray-200 dark:border-gray-700 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-200 disabled:opacity-50">
            <Upload size={16} /> Enviar certificado
          </button>
        </div>
        {cfg.certificado_enviado && (
          <p className="text-[11px] text-gray-400 mt-2">
            {cfg.certificado_titular ? `${cfg.certificado_titular} · ` : ""}
            {cfg.certificado_validade ? `válido até ${new Date(cfg.certificado_validade + "T12:00:00").toLocaleDateString("pt-BR")}` : "enviado"}.
          </p>
        )}
      </Section>
    </div>
  );
}

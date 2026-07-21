import React, { useEffect, useState } from "react";
import {
  Receipt, Building2, ShieldCheck, Plus, RefreshCw, Download, XCircle,
  CheckCircle2, Clock, AlertTriangle, Loader2, Save, Upload, FileText, Zap,
} from "lucide-react";
import { authFetch } from "../utils/authFetch";

// ─── Tipos ───────────────────────────────────────────────────────────────────
interface FiscalConfig {
  provider?: string;
  environment?: "sandbox" | "production";
  cnpj?: string; inscricao_municipal?: string; inscricao_estadual?: string;
  razao_social?: string; nome_fantasia?: string;
  simples_nacional?: boolean; incentivo_cultural?: boolean;
  email?: string; telefone?: string;
  cep?: string; logradouro?: string; numero?: string; complemento?: string;
  bairro?: string; codigo_cidade?: string; cidade?: string; estado?: string;
  servico_discriminacao?: string;
  dps_serie?: string; emit_stage_id?: string | null;
  ctrib_nac?: string; cnbs?: string; ptottrib_sn?: number;
  empresa_cadastrada?: boolean; certificado_enviado?: boolean;
  certificado_validade?: string | null; certificado_titular?: string | null;
}

interface Invoice {
  id: string; status: string; valor: number; numero?: string | null;
  tomador_nome?: string; tomador_doc?: string; discriminacao?: string;
  chave_acesso?: string | null; ambiente?: string | null;
  pdf_url?: string | null; xml_url?: string | null; xml_nfse?: string | null;
  error_message?: string | null;
  created_at: string; emitida_em?: string | null; job_id?: number | null;
}

interface Elegivel {
  job_id: number; client_id: number | null; client_name: string | null;
  job_name: string | null; job_date: string | null; valor: number;
  stage_id: string; stage_name: string;
  tomador_doc: string; tomador_email: string; faltas: string[];
}

interface StageOpt { id: string; label: string }

// ─── Helpers ─────────────────────────────────────────────────────────────────
async function api<T = any>(path: string, opts?: RequestInit): Promise<T> {
  const res = await authFetch(path, opts);
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && (data.error || data.message)) || "Erro na requisição.");
  return data as T;
}

const brl = (n: number) =>
  `R$ ${Number(n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;
const dataBr = (s?: string | null) => (s ? new Date(s + (s.length === 10 ? "T12:00:00" : "")).toLocaleDateString("pt-BR") : "—");

async function baixarArquivo(path: string, nome: string) {
  const res = await authFetch(path);
  if (!res.ok) {
    const j = await res.json().catch(() => null);
    alert((j && j.error) || "Não consegui baixar o arquivo.");
    return;
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = nome; a.target = "_blank";
  if (blob.type.includes("pdf")) { window.open(url, "_blank"); }
  else { a.click(); }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

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
  const [emitindo, setEmitindo] = useState<Elegivel | null | "avulsa">(null);

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
      const r = await api<{ titular?: string; validade?: string }>("/api/fiscal/certificado", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pfxBase64: base64, senha }),
      });
      setMsg({ type: "ok", text: `Certificado OK${r.titular ? ` (${r.titular})` : ""}. Emissão liberada.` });
      await load();
    } catch (e: any) { setMsg({ type: "err", text: e?.message || "Erro ao enviar certificado." }); }
    finally { setSaving(false); }
  };

  const podeEmitir = !!(cfg.cnpj && cfg.codigo_cidade && cfg.certificado_enviado);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-4 md:px-6 py-4 border-b border-gray-200 dark:border-gray-800">
        <div className="flex items-center gap-2">
          <Receipt className="w-5 h-5 text-gold-500" />
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Nota Fiscal</h1>
          <AmbienteBadge env={cfg.environment} />
        </div>
        <button onClick={() => setEmitindo("avulsa")} disabled={!podeEmitir}
          className="flex items-center gap-1.5 px-3 py-2 bg-gold-600 hover:bg-gold-700 disabled:opacity-50 text-white rounded-lg text-sm font-semibold">
          <Plus size={16} /> Emitir avulsa
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 px-4 md:px-6 pt-3 border-b border-gray-200 dark:border-gray-800">
        {([["emitir", `Prontas pra emitir${elegiveis.length ? ` (${elegiveis.length})` : ""}`], ["notas", "Notas emitidas"], ["config", "Configuração"]] as const).map(([k, lbl]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === k ? "border-gold-500 text-gold-600 dark:text-gold-400" : "border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-200"}`}>
            {lbl}
          </button>
        ))}
      </div>

      {msg && (
        <div className={`mx-4 md:mx-6 mt-3 text-sm px-3 py-2 rounded-lg ${msg.type === "ok" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" : "bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300"}`}>
          {msg.text}
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-gray-400"><Loader2 className="animate-spin" /></div>
        ) : tab === "emitir" ? (
          <EmitirKanban itens={elegiveis} invoices={invoices} etapaMinima={etapaMinima} podeEmitir={podeEmitir}
            onEmitir={(item) => setEmitindo(item)} onIrConfig={() => setTab("config")} />
        ) : tab === "notas" ? (
          <NotasTab invoices={invoices} onRefresh={load} />
        ) : (
          <ConfigTab cfg={cfg} set={set} saving={saving} onSave={saveConfig} onEnviarCertificado={enviarCertificado} />
        )}
      </div>

      {emitindo && (
        <EmitirModal cfg={cfg} item={emitindo === "avulsa" ? null : emitindo}
          onClose={() => setEmitindo(null)}
          onEmitted={() => { setEmitindo(null); load(); }} />
      )}
    </div>
  );
}

// ─── Aba: Kanban de emissão ──────────────────────────────────────────────────
// 3 colunas: Fazer nota (dados completos) | Faltando dados | Nota emitida.
function EmitirKanban({ itens, invoices, etapaMinima, podeEmitir, onEmitir, onIrConfig }: {
  itens: Elegivel[]; invoices: Invoice[]; etapaMinima: string | null; podeEmitir: boolean;
  onEmitir: (i: Elegivel) => void; onIrConfig: () => void;
}) {
  if (!podeEmitir) {
    return (
      <div className="text-center py-16">
        <ShieldCheck className="mx-auto mb-3 text-gray-300" size={40} />
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
          Pra emitir, complete a configuração (CNPJ, código IBGE da cidade) e envie o certificado A1.
        </p>
        <button onClick={onIrConfig} className="px-4 py-2 bg-gold-600 hover:bg-gold-700 text-white rounded-lg text-sm font-semibold">
          Ir pra Configuração
        </button>
      </div>
    );
  }

  const prontos = itens.filter((i) => i.faltas.length === 0);
  const incompletos = itens.filter((i) => i.faltas.length > 0);
  const emitidas = invoices.filter((n) => n.status === "autorizada").slice(0, 40);

  return (
    <div>
      {etapaMinima && (
        <p className="text-[12px] text-gray-400 mb-3 flex items-center gap-1">
          <Zap size={12} /> Ensaios entram no quadro quando chegam na etapa “{etapaMinima}” da Produção (mude na Configuração).
        </p>
      )}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
        <KanbanCol titulo="Fazer nota" cor="bg-gold-500" qtd={prontos.length}
          vazio="Ninguém esperando nota agora.">
          {prontos.map((it) => (
            <CardElegivel key={it.job_id} it={it} onEmitir={() => onEmitir(it)} acao="Emitir" />
          ))}
        </KanbanCol>

        <KanbanCol titulo="Faltando dados" cor="bg-amber-500" qtd={incompletos.length}
          vazio="Nenhum cadastro incompleto. 👌">
          {incompletos.map((it) => (
            <CardElegivel key={it.job_id} it={it} onEmitir={() => onEmitir(it)} acao="Completar e emitir" />
          ))}
        </KanbanCol>

        <KanbanCol titulo="Nota emitida" cor="bg-emerald-500" qtd={emitidas.length}
          vazio="As notas emitidas aparecem aqui.">
          {emitidas.map((n) => (
            <div key={n.id} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl px-3 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="font-semibold text-gray-900 dark:text-white text-sm truncate">{n.tomador_nome || "—"}</div>
                <div className="font-bold text-sm text-gray-900 dark:text-white shrink-0">{brl(n.valor)}</div>
              </div>
              <div className="flex items-center justify-between mt-1">
                <div className="text-[11px] text-gray-400">
                  {n.numero ? `Nº ${n.numero} · ` : ""}{new Date(n.emitida_em || n.created_at).toLocaleDateString("pt-BR")}
                  {n.ambiente === "sandbox" && <span className="ml-1 px-1 py-0.5 rounded bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">teste</span>}
                </div>
                <div className="flex gap-1">
                  <button onClick={() => baixarArquivo(`/api/fiscal/nfse/${n.id}/pdf`, `nfse-${n.numero || n.id}.pdf`)} title="PDF"
                    className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500"><Download size={13} /></button>
                  <button onClick={() => baixarArquivo(`/api/fiscal/nfse/${n.id}/xml`, `nfse-${n.numero || n.id}.xml`)} title="XML"
                    className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500"><FileText size={13} /></button>
                </div>
              </div>
            </div>
          ))}
        </KanbanCol>
      </div>
    </div>
  );
}

function KanbanCol({ titulo, cor, qtd, vazio, children }: {
  titulo: string; cor: string; qtd: number; vazio: string; children: React.ReactNode;
}) {
  return (
    <div className="bg-gray-50 dark:bg-gray-950/60 border border-gray-200 dark:border-gray-800 rounded-2xl p-3">
      <div className="flex items-center gap-2 mb-3 px-1">
        <span className={`w-2.5 h-2.5 rounded-full ${cor}`} />
        <span className="text-sm font-bold text-gray-800 dark:text-gray-100">{titulo}</span>
        <span className="text-[11px] font-semibold text-gray-400 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-full px-2 py-0.5">{qtd}</span>
      </div>
      <div className="space-y-2 min-h-[60px]">
        {qtd === 0 ? <p className="text-[12px] text-gray-400 px-1 py-4 text-center">{vazio}</p> : children}
      </div>
    </div>
  );
}

function CardElegivel({ it, onEmitir, acao }: { it: Elegivel; onEmitir: () => void; acao: string }) {
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="font-semibold text-gray-900 dark:text-white text-sm truncate">{it.client_name || "(sem nome)"}</div>
        <div className="font-bold text-sm text-gray-900 dark:text-white shrink-0">{it.valor > 0 ? brl(it.valor) : "—"}</div>
      </div>
      <div className="text-[11px] text-gray-400 truncate mt-0.5">
        {it.job_name || "Ensaio"} · {dataBr(it.job_date)} · {it.stage_name}
      </div>
      {it.faltas.length > 0 && (
        <div className="flex gap-1 mt-1.5">
          {it.faltas.map((f) => (
            <span key={f} className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 font-medium">
              falta {f === "cpf" ? "CPF" : f}
            </span>
          ))}
        </div>
      )}
      <button onClick={onEmitir}
        className="mt-2 w-full flex items-center justify-center gap-1.5 px-3 py-1.5 bg-gold-600 hover:bg-gold-700 text-white rounded-lg text-[13px] font-semibold">
        <Receipt size={14} /> {acao}
      </button>
    </div>
  );
}

// ─── Modal: Emitir NFS-e ─────────────────────────────────────────────────────
function EmitirModal({ cfg, item, onClose, onEmitted }: {
  cfg: FiscalConfig; item: Elegivel | null; onClose: () => void; onEmitted: () => void;
}) {
  const descPadrao = () => {
    const base = cfg.servico_discriminacao || "Serviço de fotografia — ensaio fotográfico";
    return item?.job_name ? `${base} (${item.job_name})` : base;
  };
  const [nome, setNome] = useState(item?.client_name || "");
  const [doc, setDoc] = useState(item?.tomador_doc || "");
  const [email, setEmail] = useState(item?.tomador_email || "");
  const [valor, setValor] = useState(item ? String(item.valor || "") : "");
  const [descricao, setDescricao] = useState(descPadrao());
  const [salvarCpf, setSalvarCpf] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [okInfo, setOkInfo] = useState<{ id: string; chave?: string; numero?: string | null } | null>(null);

  const cpfFaltava = !!item && item.faltas.includes("cpf");
  const prod = cfg.environment === "production";

  const emitir = async () => {
    setErr(""); setBusy(true);
    try {
      const r = await api<{ id: string; chave_acesso?: string; numero?: string | null }>("/api/fiscal/nfse", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          job_id: item?.job_id || null, client_id: item?.client_id || null,
          valor: Number(valor), discriminacao: descricao,
          salvar_cpf: cpfFaltava && salvarCpf,
          tomador: { cpfCnpj: doc, razaoSocial: nome, email: email || undefined },
        }),
      });
      setOkInfo({ id: r.id, chave: r.chave_acesso, numero: r.numero });
    } catch (e: any) { setErr(e?.message || "Erro ao emitir."); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={busy ? undefined : onClose} />
      <div className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-md border border-gray-200 dark:border-gray-800 max-h-[90vh] overflow-y-auto">
        <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800">
          <h3 className="font-bold text-gray-900 dark:text-white flex items-center gap-2"><Receipt size={16} className="text-gold-500" /> Emitir NFS-e</h3>
          <div className={`mt-2 text-[12px] px-2.5 py-1.5 rounded-lg font-medium ${prod ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" : "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"}`}>
            {prod ? "PRODUÇÃO — nota fiscal REAL, vale na prefeitura." : "HOMOLOGAÇÃO — nota de teste, não vale na prefeitura."}
          </div>
        </div>

        {okInfo ? (
          <div className="p-5 space-y-3">
            <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 font-semibold">
              <CheckCircle2 size={18} /> Nota emitida com sucesso!
            </div>
            {okInfo.numero && <p className="text-sm text-gray-600 dark:text-gray-300">Número: <b>{okInfo.numero}</b></p>}
            {okInfo.chave && <p className="text-[11px] text-gray-400 break-all">Chave: {okInfo.chave}</p>}
            <div className="flex gap-2 pt-1">
              <button onClick={() => baixarArquivo(`/api/fiscal/nfse/${okInfo.id}/pdf`, "nfse.pdf")}
                className="flex items-center gap-1.5 px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-200">
                <Download size={15} /> PDF
              </button>
              <button onClick={() => baixarArquivo(`/api/fiscal/nfse/${okInfo.id}/xml`, "nfse.xml")}
                className="flex items-center gap-1.5 px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-200">
                <FileText size={15} /> XML
              </button>
              <button onClick={onEmitted} className="ml-auto px-4 py-2 bg-gold-600 hover:bg-gold-700 text-white rounded-lg text-sm font-semibold">Fechar</button>
            </div>
          </div>
        ) : (
          <>
            <div className="p-5 space-y-3">
              <Field label="Cliente (tomador)"><input className={inputCls} value={nome} onChange={(e) => setNome(e.target.value)} /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="CPF/CNPJ" hint={cpfFaltava ? "Estava faltando no cadastro." : undefined}>
                  <input className={inputCls} value={doc} onChange={(e) => setDoc(e.target.value)} placeholder="000.000.000-00" />
                </Field>
                <Field label="E-mail (opcional)"><input className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
              </div>
              {cpfFaltava && (
                <label className="flex items-center gap-2 text-[12px] text-gray-600 dark:text-gray-300">
                  <input type="checkbox" checked={salvarCpf} onChange={(e) => setSalvarCpf(e.target.checked)} />
                  Salvar este CPF no cadastro do cliente
                </label>
              )}
              <Field label="Valor do serviço (R$)"><input type="number" step="0.01" className={inputCls} value={valor} onChange={(e) => setValor(e.target.value)} /></Field>
              <Field label="Descrição na nota"><textarea className={inputCls} rows={2} value={descricao} onChange={(e) => setDescricao(e.target.value)} /></Field>
              {err && <div className="text-sm text-rose-600 bg-rose-50 dark:bg-rose-900/20 px-3 py-2 rounded-lg">{err}</div>}
            </div>
            <div className="px-5 py-4 border-t border-gray-100 dark:border-gray-800 flex justify-end gap-2">
              <button onClick={onClose} disabled={busy} className="px-4 py-2 text-sm text-gray-500">Cancelar</button>
              <button onClick={emitir} disabled={busy || !nome || !doc || !(Number(valor) > 0)}
                className="flex items-center gap-1.5 px-4 py-2 bg-gold-600 hover:bg-gold-700 disabled:opacity-50 text-white rounded-lg text-sm font-semibold">
                {busy ? <Loader2 size={16} className="animate-spin" /> : <Receipt size={16} />} Emitir
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Aba: Notas emitidas ─────────────────────────────────────────────────────
function NotasTab({ invoices, onRefresh }: { invoices: Invoice[]; onRefresh: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);

  const refreshOne = async (id: string) => {
    setBusy(id);
    try { await api(`/api/fiscal/nfse/${id}/refresh`, { method: "POST" }); onRefresh(); }
    finally { setBusy(null); }
  };
  const cancelOne = async (id: string) => {
    const justificativa = window.prompt("Motivo do cancelamento (mín. 15 caracteres):") || "";
    if (justificativa.trim().length < 15) return;
    setBusy(id);
    try { await api(`/api/fiscal/nfse/${id}/cancelar`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ justificativa }) }); onRefresh(); }
    catch (e: any) { alert(e?.message || "Erro ao cancelar."); }
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
              <tr key={inv.id} className="border-b border-gray-50 dark:border-gray-800/50">
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
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1.5">
                    {temDoc && (
                      <>
                        <button onClick={() => baixarArquivo(`/api/fiscal/nfse/${inv.id}/pdf`, `nfse-${inv.numero || inv.id}.pdf`)} title="PDF (DANFSe)"
                          className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500"><Download size={15} /></button>
                        <button onClick={() => baixarArquivo(`/api/fiscal/nfse/${inv.id}/xml`, `nfse-${inv.numero || inv.id}.xml`)} title="XML (documento fiscal)"
                          className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500"><FileText size={15} /></button>
                      </>
                    )}
                    <button onClick={() => refreshOne(inv.id)} disabled={busy === inv.id} title="Atualizar status"
                      className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500">
                      <RefreshCw size={15} className={busy === inv.id ? "animate-spin" : ""} />
                    </button>
                    {inv.status === "autorizada" && (
                      <button onClick={() => cancelOne(inv.id)} disabled={busy === inv.id} title="Cancelar nota"
                        className="p-1.5 rounded hover:bg-rose-50 dark:hover:bg-rose-900/20 text-rose-500"><XCircle size={15} /></button>
                    )}
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
    // Etapas da Produção (na ordem do kanban) pro seletor "liberar nota a partir de".
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
      {/* Status */}
      <div className="grid grid-cols-2 gap-3">
        <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm ${cfg.cnpj && cfg.codigo_cidade ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-900/20 dark:text-emerald-300" : "border-gray-200 dark:border-gray-700 text-gray-500"}`}>
          <Building2 size={16} /> Dados do estúdio {cfg.cnpj && cfg.codigo_cidade ? "✓" : "—"}
        </div>
        <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm ${cfg.certificado_enviado ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-900/20 dark:text-emerald-300" : "border-gray-200 dark:border-gray-700 text-gray-500"}`}>
          <ShieldCheck size={16} /> Certificado A1 {cfg.certificado_enviado ? "✓" : "—"}
        </div>
      </div>

      {/* Ambiente */}
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

      {/* Quando liberar a nota */}
      <Section title="Quando liberar a nota">
        <Field label="Liberar emissão a partir da etapa (Produção)"
          hint="Ensaios que chegarem nesta etapa (ou depois dela) entram na fila 'Prontas pra emitir'.">
          <select className={inputCls} value={cfg.emit_stage_id || ""} onChange={(e) => set("emit_stage_id", e.target.value || null)}>
            <option value="">— 2ª etapa do kanban (padrão) —</option>
            {etapas.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </Field>
      </Section>

      {/* Emitente */}
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

      {/* Serviço */}
      <Section title="Serviço (o que sai na nota)">
        <Field label="Descrição padrão do serviço">
          <textarea className={inputCls} rows={2} value={cfg.servico_discriminacao || ""} onChange={(e) => set("servico_discriminacao", e.target.value)} placeholder="Ex.: Serviço de fotografia — ensaio fotográfico." />
        </Field>
        <button onClick={() => setAvancado(!avancado)} className="text-[12px] text-gold-600 dark:text-gold-400 mt-2">
          {avancado ? "Esconder" : "Mostrar"} campos avançados
        </button>
        {avancado && (
          <div className="grid grid-cols-3 gap-3 mt-2">
            <Field label="Cód. tributação nacional" hint="Fotografia = 130301"><input className={inputCls} value={cfg.ctrib_nac || ""} onChange={(e) => set("ctrib_nac", e.target.value)} placeholder="130301" /></Field>
            <Field label="Cód. NBS" hint="Fotografia = 114082000"><input className={inputCls} value={cfg.cnbs || ""} onChange={(e) => set("cnbs", e.target.value)} placeholder="114082000" /></Field>
            <Field label="% tributos SN" hint="Informativo na nota"><input type="number" step="0.01" className={inputCls} value={cfg.ptottrib_sn ?? 2} onChange={(e) => set("ptottrib_sn", Number(e.target.value))} /></Field>
            <Field label="Série da DPS" hint="Não mude sem precisar"><input className={inputCls} value={cfg.dps_serie || "00010"} onChange={(e) => set("dps_serie", e.target.value)} /></Field>
          </div>
        )}
      </Section>

      <button onClick={onSave} disabled={saving} className="flex items-center gap-1.5 px-4 py-2 bg-gold-600 hover:bg-gold-700 disabled:opacity-50 text-white rounded-lg text-sm font-semibold">
        <Save size={16} /> Salvar configuração
      </button>

      {/* Certificado */}
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
            className="flex items-center gap-1.5 px-4 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-200 disabled:opacity-50">
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

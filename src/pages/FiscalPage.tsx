import React, { useEffect, useMemo, useState } from "react";
import {
  Receipt, Building2, ShieldCheck, Plus, RefreshCw, Download, XCircle,
  CheckCircle2, Clock, AlertTriangle, Loader2, Save, Upload,
} from "lucide-react";
import { authFetch } from "../utils/authFetch";

// ─── Tipos ───────────────────────────────────────────────────────────────────
interface FiscalConfig {
  provider?: string;
  environment?: "sandbox" | "production";
  ativo?: boolean;
  cnpj?: string; inscricao_municipal?: string; inscricao_estadual?: string;
  razao_social?: string; nome_fantasia?: string;
  regime_tributario?: number | null; simples_nacional?: boolean; incentivo_cultural?: boolean;
  email?: string; telefone?: string;
  cep?: string; logradouro?: string; numero?: string; complemento?: string;
  bairro?: string; codigo_cidade?: string; cidade?: string; estado?: string;
  servico_codigo?: string; servico_cnae?: string; servico_discriminacao?: string;
  iss_aliquota?: number;
  empresa_cadastrada?: boolean; certificado_enviado?: boolean; certificado_validade?: string | null;
}

interface Invoice {
  id: string; status: string; valor: number; numero?: string | null;
  tomador_nome?: string; tomador_doc?: string; discriminacao?: string;
  pdf_url?: string | null; xml_url?: string | null; error_message?: string | null;
  created_at: string; emitida_em?: string | null; job_id?: string | null;
}

interface JobLite {
  id: string; job_name?: string; client_name?: string; amount?: number;
  job_date?: string | null; status?: string;
}

// ─── Helpers de API ──────────────────────────────────────────────────────────
async function api<T = any>(path: string, opts?: RequestInit): Promise<T> {
  const res = await authFetch(path, opts);
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && (data.error || data.message)) || "Erro na requisição.");
  return data as T;
}

const brl = (n: number) =>
  `R$ ${Number(n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;

const STATUS_META: Record<string, { label: string; cls: string; icon: React.ElementType }> = {
  autorizada:  { label: "Autorizada", cls: "text-emerald-700 bg-emerald-50 dark:text-emerald-300 dark:bg-emerald-900/30", icon: CheckCircle2 },
  processando: { label: "Processando", cls: "text-amber-700 bg-amber-50 dark:text-amber-300 dark:bg-amber-900/30", icon: Clock },
  rejeitada:   { label: "Rejeitada", cls: "text-rose-700 bg-rose-50 dark:text-rose-300 dark:bg-rose-900/30", icon: AlertTriangle },
  erro:        { label: "Erro", cls: "text-rose-700 bg-rose-50 dark:text-rose-300 dark:bg-rose-900/30", icon: AlertTriangle },
  cancelada:   { label: "Cancelada", cls: "text-gray-600 bg-gray-100 dark:text-gray-300 dark:bg-gray-800", icon: XCircle },
};

// ─── Campo de formulário ─────────────────────────────────────────────────────
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

// ═════════════════════════════════════════════════════════════════════════════
export default function FiscalPage() {
  const [tab, setTab] = useState<"config" | "notas">("config");
  const [cfg, setCfg] = useState<FiscalConfig>({ environment: "sandbox", simples_nacional: true });
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [emitOpen, setEmitOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [c, inv] = await Promise.all([
        api<FiscalConfig | null>("/api/fiscal/config"),
        api<Invoice[]>("/api/fiscal/nfse"),
      ]);
      if (c) setCfg({ environment: "sandbox", simples_nacional: true, ...c });
      setInvoices(inv || []);
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
    } catch (e: any) { setMsg({ type: "err", text: e?.message || "Erro ao salvar." }); }
    finally { setSaving(false); }
  };

  const cadastrarEmpresa = async () => {
    setSaving(true); setMsg(null);
    try {
      await api("/api/fiscal/empresa", { method: "POST" });
      setMsg({ type: "ok", text: "Empresa cadastrada no provedor." });
      await load();
    } catch (e: any) { setMsg({ type: "err", text: e?.message || "Erro ao cadastrar empresa." }); }
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
      await api("/api/fiscal/certificado", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pfxBase64: base64, senha }),
      });
      setMsg({ type: "ok", text: "Certificado enviado." });
      await load();
    } catch (e: any) { setMsg({ type: "err", text: e?.message || "Erro ao enviar certificado." }); }
    finally { setSaving(false); }
  };

  const podeEmitir = cfg.empresa_cadastrada && cfg.certificado_enviado;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-4 md:px-6 py-4 border-b border-gray-200 dark:border-gray-800">
        <div className="flex items-center gap-2">
          <Receipt className="w-5 h-5 text-gold-500" />
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Nota Fiscal</h1>
          <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${cfg.environment === "production" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"}`}>
            {cfg.environment === "production" ? "Produção" : "Homologação"}
          </span>
        </div>
        {tab === "notas" && (
          <button onClick={() => setEmitOpen(true)} disabled={!podeEmitir}
            className="flex items-center gap-1.5 px-3 py-2 bg-gold-600 hover:bg-gold-700 disabled:opacity-50 text-white rounded-lg text-sm font-semibold">
            <Plus size={16} /> Emitir nota
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 px-4 md:px-6 pt-3 border-b border-gray-200 dark:border-gray-800">
        {([["config", "Configuração"], ["notas", "Notas emitidas"]] as const).map(([k, lbl]) => (
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
        ) : tab === "config" ? (
          <ConfigTab cfg={cfg} set={set} saving={saving} onSave={saveConfig}
            onCadastrarEmpresa={cadastrarEmpresa} onEnviarCertificado={enviarCertificado} />
        ) : (
          <NotasTab invoices={invoices} onRefresh={load} />
        )}
      </div>

      {emitOpen && (
        <EmitModal cfg={cfg} onClose={() => setEmitOpen(false)}
          onEmitted={() => { setEmitOpen(false); setTab("notas"); load(); }} />
      )}
    </div>
  );
}

// ─── Aba: Configuração ───────────────────────────────────────────────────────
function ConfigTab({ cfg, set, saving, onSave, onCadastrarEmpresa, onEnviarCertificado }: {
  cfg: FiscalConfig; set: (k: keyof FiscalConfig, v: unknown) => void; saving: boolean;
  onSave: () => void; onCadastrarEmpresa: () => void; onEnviarCertificado: (f: File, s: string) => void;
}) {
  const [pfx, setPfx] = useState<File | null>(null);
  const [senha, setSenha] = useState("");

  return (
    <div className="max-w-3xl space-y-6">
      {/* Status */}
      <div className="grid grid-cols-2 gap-3">
        <StatusChip ok={!!cfg.empresa_cadastrada} icon={Building2} label="Empresa no provedor" />
        <StatusChip ok={!!cfg.certificado_enviado} icon={ShieldCheck} label="Certificado A1" />
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
        <p className="text-[11px] text-gray-400 mt-1">Comece em homologação. Só troque pra produção depois que testar uma nota.</p>
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
        </div>
        <div className="flex gap-4 mt-3">
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input type="checkbox" checked={cfg.simples_nacional ?? true} onChange={(e) => set("simples_nacional", e.target.checked)} /> Simples Nacional
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input type="checkbox" checked={!!cfg.incentivo_cultural} onChange={(e) => set("incentivo_cultural", e.target.checked)} /> Incentivador cultural
          </label>
        </div>
      </Section>

      {/* Endereço */}
      <Section title="Endereço do estúdio">
        <div className="grid grid-cols-2 gap-3">
          <Field label="CEP"><input className={inputCls} value={cfg.cep || ""} onChange={(e) => set("cep", e.target.value)} /></Field>
          <Field label="Cidade"><input className={inputCls} value={cfg.cidade || ""} onChange={(e) => set("cidade", e.target.value)} /></Field>
          <Field label="Código IBGE da cidade" hint="7 dígitos (ex.: 3550308 = São Paulo)"><input className={inputCls} value={cfg.codigo_cidade || ""} onChange={(e) => set("codigo_cidade", e.target.value)} /></Field>
          <Field label="UF"><input className={inputCls} maxLength={2} value={cfg.estado || ""} onChange={(e) => set("estado", e.target.value.toUpperCase())} /></Field>
          <Field label="Logradouro"><input className={inputCls} value={cfg.logradouro || ""} onChange={(e) => set("logradouro", e.target.value)} /></Field>
          <Field label="Número"><input className={inputCls} value={cfg.numero || ""} onChange={(e) => set("numero", e.target.value)} /></Field>
          <Field label="Bairro"><input className={inputCls} value={cfg.bairro || ""} onChange={(e) => set("bairro", e.target.value)} /></Field>
          <Field label="Complemento"><input className={inputCls} value={cfg.complemento || ""} onChange={(e) => set("complemento", e.target.value)} /></Field>
        </div>
      </Section>

      {/* Serviço */}
      <Section title="Serviço (NFS-e)">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Código do serviço municipal" hint="Item da lista LC 116 (fotografia). Pegue com seu contador."><input className={inputCls} value={cfg.servico_codigo || ""} onChange={(e) => set("servico_codigo", e.target.value)} /></Field>
          <Field label="CNAE"><input className={inputCls} value={cfg.servico_cnae || ""} onChange={(e) => set("servico_cnae", e.target.value)} /></Field>
          <Field label="Alíquota ISS (%)"><input type="number" step="0.01" className={inputCls} value={cfg.iss_aliquota ?? 0} onChange={(e) => set("iss_aliquota", Number(e.target.value))} /></Field>
        </div>
        <Field label="Descrição padrão do serviço">
          <textarea className={inputCls} rows={2} value={cfg.servico_discriminacao || ""} onChange={(e) => set("servico_discriminacao", e.target.value)} placeholder="Ex.: Serviço de fotografia — ensaio fotográfico." />
        </Field>
      </Section>

      <div className="flex items-center gap-3">
        <button onClick={onSave} disabled={saving} className="flex items-center gap-1.5 px-4 py-2 bg-gold-600 hover:bg-gold-700 disabled:opacity-50 text-white rounded-lg text-sm font-semibold">
          <Save size={16} /> Salvar configuração
        </button>
        <button onClick={onCadastrarEmpresa} disabled={saving || !cfg.cnpj} className="flex items-center gap-1.5 px-4 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-200">
          <Building2 size={16} /> Cadastrar empresa no provedor
        </button>
      </div>

      {/* Certificado */}
      <Section title="Certificado digital A1">
        <p className="text-[12px] text-gray-500 dark:text-gray-400 mb-2">O arquivo .pfx e a senha vão direto pro provedor (PlugNotas) — não ficam guardados aqui.</p>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Arquivo .pfx">
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
        {cfg.certificado_validade && <p className="text-[11px] text-gray-400 mt-2">Válido até {new Date(cfg.certificado_validade).toLocaleDateString("pt-BR")}.</p>}
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4">
      <h3 className="text-sm font-bold text-gray-800 dark:text-gray-100 mb-3">{title}</h3>
      {children}
    </div>
  );
}
function StatusChip({ ok, icon: Icon, label }: { ok: boolean; icon: React.ElementType; label: string }) {
  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm ${ok ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-900/20 dark:text-emerald-300" : "border-gray-200 dark:border-gray-700 text-gray-500"}`}>
      <Icon size={16} /> {label} {ok ? "✓" : "—"}
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
    return <div className="text-center py-16 text-gray-400 text-sm">Nenhuma nota emitida ainda. Configure o estúdio e emita a primeira após o ensaio realizado.</div>;
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
            return (
              <tr key={inv.id} className="border-b border-gray-50 dark:border-gray-800/50">
                <td className="px-4 py-3">
                  <div className="font-medium text-gray-900 dark:text-white">{inv.tomador_nome || "—"}</div>
                  <div className="text-[11px] text-gray-400">{inv.tomador_doc}</div>
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
                    {inv.pdf_url && <a href={inv.pdf_url} target="_blank" rel="noreferrer" title="PDF" className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500"><Download size={15} /></a>}
                    <button onClick={() => refreshOne(inv.id)} disabled={busy === inv.id} title="Atualizar status" className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500">
                      <RefreshCw size={15} className={busy === inv.id ? "animate-spin" : ""} />
                    </button>
                    {inv.status === "autorizada" && (
                      <button onClick={() => cancelOne(inv.id)} disabled={busy === inv.id} title="Cancelar nota" className="p-1.5 rounded hover:bg-rose-50 dark:hover:bg-rose-900/20 text-rose-500"><XCircle size={15} /></button>
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

// ─── Modal: Emitir nota ──────────────────────────────────────────────────────
function EmitModal({ cfg, onClose, onEmitted }: { cfg: FiscalConfig; onClose: () => void; onEmitted: () => void }) {
  const [jobs, setJobs] = useState<JobLite[]>([]);
  const [jobId, setJobId] = useState("");
  const [nome, setNome] = useState("");
  const [doc, setDoc] = useState("");
  const [email, setEmail] = useState("");
  const [valor, setValor] = useState("");
  const [discriminacao, setDiscriminacao] = useState(cfg.servico_discriminacao || "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    // Só ensaios REALIZADOS (a nota sai depois do ensaio, não no sinal).
    api<JobLite[]>("/api/jobs").then((all) => {
      const hoje = new Date().toISOString().slice(0, 10);
      setJobs((all || []).filter((j) => j.status === "completed" || (j.job_date && j.job_date <= hoje)));
    }).catch(() => {});
  }, []);

  const realizados = useMemo(() => jobs, [jobs]);

  const pickJob = (id: string) => {
    setJobId(id);
    const j = jobs.find((x) => x.id === id);
    if (j) {
      if (j.client_name) setNome(j.client_name);
      if (j.amount) setValor(String(j.amount));
      if (!discriminacao) setDiscriminacao(`${cfg.servico_discriminacao || "Serviço de fotografia"}${j.job_name ? ` — ${j.job_name}` : ""}`);
    }
  };

  const emitir = async () => {
    setErr(""); setBusy(true);
    try {
      await api("/api/fiscal/nfse", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          job_id: jobId || null, valor: Number(valor),
          discriminacao, enviarEmail: !!email,
          tomador: { cpfCnpj: doc, razaoSocial: nome, email: email || undefined },
        }),
      });
      onEmitted();
    } catch (e: any) { setErr(e?.message || "Erro ao emitir."); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-md border border-gray-200 dark:border-gray-800 max-h-[90vh] overflow-y-auto">
        <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800">
          <h3 className="font-bold text-gray-900 dark:text-white">Emitir NFS-e</h3>
          <p className="text-[11px] text-gray-400">Após o ensaio realizado, pelo valor cheio do serviço.</p>
        </div>
        <div className="p-5 space-y-3">
          {realizados.length > 0 && (
            <Field label="Vincular a um ensaio realizado (opcional)">
              <select className={inputCls} value={jobId} onChange={(e) => pickJob(e.target.value)}>
                <option value="">— Sem vínculo —</option>
                {realizados.map((j) => (
                  <option key={j.id} value={j.id}>{j.client_name || j.job_name || j.id} · {j.job_date || ""}</option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Cliente (tomador)"><input className={inputCls} value={nome} onChange={(e) => setNome(e.target.value)} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="CPF/CNPJ"><input className={inputCls} value={doc} onChange={(e) => setDoc(e.target.value)} /></Field>
            <Field label="E-mail (opcional)"><input className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          </div>
          <Field label="Valor do serviço (R$)"><input type="number" step="0.01" className={inputCls} value={valor} onChange={(e) => setValor(e.target.value)} /></Field>
          <Field label="Discriminação"><textarea className={inputCls} rows={2} value={discriminacao} onChange={(e) => setDiscriminacao(e.target.value)} /></Field>
          {err && <div className="text-sm text-rose-600 bg-rose-50 dark:bg-rose-900/20 px-3 py-2 rounded-lg">{err}</div>}
        </div>
        <div className="px-5 py-4 border-t border-gray-100 dark:border-gray-800 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-500">Cancelar</button>
          <button onClick={emitir} disabled={busy || !nome || !doc || !valor}
            className="flex items-center gap-1.5 px-4 py-2 bg-gold-600 hover:bg-gold-700 disabled:opacity-50 text-white rounded-lg text-sm font-semibold">
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Receipt size={16} />} Emitir
          </button>
        </div>
      </div>
    </div>
  );
}

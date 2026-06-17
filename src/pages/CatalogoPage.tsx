import React, { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Package, Briefcase, Layers, Building2, Plus, Search,
  Pencil, Trash2, X, Loader2, CheckCircle, XCircle,
  ChevronDown, ChevronUp, Tag, RefreshCw, AlertCircle,
} from "lucide-react";
import { catalogoApi } from "../services/api/catalogo";
import {
  Produto, Fornecedor, Servico, Combo, ComboItem,
  CategoriaCatalogo, TipoEnsaio, UnidadeProduto,
} from "../types";
import { SearchableSelect } from "../components/ui/SearchableSelect";
import { EstoqueTab } from "../components/catalogo/EstoqueTab";
import { RelatorioVendas } from "../components/catalogo/RelatorioVendas";
import { useAuth } from "../contexts/AuthContext";

// ═══════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════
const INPUT = "w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 outline-none focus:border-gold-400 transition-colors";
const LABEL = "block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1";
const UNIDADES: UnidadeProduto[] = ["un", "cx", "pct", "par", "kit"];

type Aba = "produtos" | "servicos" | "combos";
type SubProdutos = "produtos" | "categorias" | "fornecedores" | "estoque" | "relatorio";
type SubServicos = "servicos" | "tipos";

/** Controlled number input: shows empty while editing, resets to 0 on blur if empty */
function NumInput({
  value, onChange, placeholder = "0", className = "", ...rest
}: { value: number; onChange: (n: number) => void; placeholder?: string; className?: string } &
  Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type" | "placeholder">) {
  const [raw, setRaw] = useState(value > 0 ? String(value) : "");
  const focused = useRef(false);

  // Sync from parent only when not focused (e.g. opening modal for existing item)
  useEffect(() => {
    if (!focused.current) setRaw(value > 0 ? String(value) : "");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <input
      {...rest}
      type="number"
      placeholder={placeholder}
      className={`${INPUT} ${className}`}
      value={raw}
      onFocus={() => { focused.current = true; }}
      onChange={(e) => {
        setRaw(e.target.value);
        const n = parseFloat(e.target.value);
        onChange(isNaN(n) ? 0 : n);
      }}
      onBlur={() => {
        focused.current = false;
        const n = parseFloat(raw);
        if (raw === "" || isNaN(n)) { setRaw(""); onChange(0); }
      }}
    />
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className={LABEL}>{children}</label>;
}

function ModalShell({ title, onClose, children, footer, onSubmit }: {
  title: string; onClose: () => void;
  children: React.ReactNode; footer: React.ReactNode;
  onSubmit?: React.FormEventHandler<HTMLFormElement>;
}) {
  const cls = "bg-white dark:bg-gray-900 rounded-2xl w-full max-w-lg shadow-xl flex flex-col max-h-[92vh]";
  const inner = (
    <>
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex-shrink-0">
        <h2 className="font-bold text-gray-900 dark:text-white">{title}</h2>
        <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400"><X size={18} /></button>
      </div>
      <div className="flex-1 overflow-y-auto px-6 py-4">{children}</div>
      <div className="flex justify-end gap-2 px-6 py-4 border-t border-gray-100 dark:border-gray-800 flex-shrink-0">{footer}</div>
    </>
  );
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      {onSubmit
        ? <form onSubmit={onSubmit} className={cls}>{inner}</form>
        : <div className={cls}>{inner}</div>}
    </div>
  );
}

function SaveBtn({ saving }: { saving: boolean }) {
  return (
    <button type="submit" disabled={saving}
      className="px-5 py-2 text-sm rounded-xl bg-gold-600 hover:bg-gold-700 disabled:opacity-50 text-white font-medium flex items-center gap-2">
      {saving && <Loader2 size={14} className="animate-spin" />}Salvar
    </button>
  );
}

function CancelBtn({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className="px-4 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800">
      Cancelar
    </button>
  );
}

// ═══════════════════════════════════════════════════════════
// MODAL: CATEGORIA
// ═══════════════════════════════════════════════════════════
const CORES: { hex: string; label: string }[] = [
  { hex: "#6B7280", label: "Cinza" },
  { hex: "#EF4444", label: "Vermelho" },
  { hex: "#F97316", label: "Laranja" },
  { hex: "#EAB308", label: "Amarelo" },
  { hex: "#22C55E", label: "Verde" },
  { hex: "#06B6D4", label: "Ciano" },
  { hex: "#3B82F6", label: "Azul" },
  { hex: "#8B5CF6", label: "Roxo" },
  { hex: "#EC4899", label: "Rosa" },
  { hex: "#D4A94A", label: "Dourado" },
  { hex: "#0F172A", label: "Preto" },
  { hex: "#F8FAFC", label: "Branco" },
];

function CategoriaModal({ item, onSave, onClose }: {
  item: Partial<CategoriaCatalogo> | null;
  onSave: (d: Partial<CategoriaCatalogo>) => Promise<void>;
  onClose: () => void;
}) {
  const [nome, setNome] = useState(item?.nome ?? "");
  const [cor, setCor] = useState(item?.cor ?? "#6B7280");
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try { await onSave({ ...(item?.id ? { id: item.id } : {}), nome, cor }); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-sm shadow-xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800">
          <h2 className="font-bold text-gray-900 dark:text-white">{item?.id ? "Editar Categoria" : "Nova Categoria"}</h2>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400"><X size={18} /></button>
        </div>
        <form onSubmit={submit} className="px-6 py-4 space-y-4">
          <div>
            <FieldLabel>Nome *</FieldLabel>
            <input required value={nome} onChange={(e) => setNome(e.target.value)} className={INPUT} placeholder="Ex: Álbum / Fotolivro" />
          </div>
          <div>
            <FieldLabel>Cor</FieldLabel>
            {/* Grade de presets */}
            <div className="grid grid-cols-6 gap-2 mb-3">
              {CORES.map((c) => (
                <button key={c.hex} type="button" onClick={() => setCor(c.hex)}
                  title={c.label}
                  style={{ background: c.hex }}
                  className={`
                    relative w-full aspect-square rounded-xl transition-all duration-150 border-2 shadow-sm
                    ${cor === c.hex
                      ? "border-gray-900 dark:border-white scale-110 shadow-md"
                      : "border-transparent hover:border-gray-400 dark:hover:border-gray-500 hover:scale-105"}
                    ${c.hex === "#F8FAFC" ? "border-gray-200 dark:border-gray-600" : ""}
                  `}
                >
                  {cor === c.hex && (
                    <span className="absolute inset-0 flex items-center justify-center">
                      <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                        <path d="M2 7l4 4 6-7" stroke={c.hex === "#F8FAFC" || c.hex === "#EAB308" ? "#111" : "#fff"} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </span>
                  )}
                </button>
              ))}
            </div>
            {/* Cor personalizada */}
            <div className="flex items-center gap-3 p-3 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-100 dark:border-gray-700">
              <label className="relative cursor-pointer flex-shrink-0" title="Escolher cor personalizada">
                <span className="block w-8 h-8 rounded-lg border-2 border-gray-300 dark:border-gray-600 shadow-sm overflow-hidden" style={{ background: cor }}>
                  <input type="color" value={cor} onChange={(e) => setCor(e.target.value)}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
                </span>
              </label>
              <div className="flex-1">
                <p className="text-xs text-gray-400 dark:text-gray-500 mb-0.5">Personalizada</p>
                <input
                  type="text"
                  value={cor}
                  onChange={(e) => { const v = e.target.value; if (/^#[0-9A-Fa-f]{0,6}$/.test(v)) setCor(v); }}
                  onBlur={(e) => { if (!/^#[0-9A-Fa-f]{6}$/.test(e.target.value)) setCor("#6B7280"); }}
                  maxLength={7}
                  placeholder="#000000"
                  className="text-sm font-mono text-gray-700 dark:text-gray-300 bg-transparent outline-none w-full"
                />
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <CancelBtn onClick={onClose} />
            <SaveBtn saving={saving} />
          </div>
        </form>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// MODAL: TIPO DE ENSAIO
// ═══════════════════════════════════════════════════════════
function TipoEnsaioModal({ item, onSave, onClose }: {
  item: Partial<TipoEnsaio> | null;
  onSave: (d: Partial<TipoEnsaio>) => Promise<void>;
  onClose: () => void;
}) {
  const [nome, setNome] = useState(item?.nome ?? "");
  const [saving, setSaving] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try { await onSave({ ...(item?.id ? { id: item.id } : {}), nome }); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-sm shadow-xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800">
          <h2 className="font-bold text-gray-900 dark:text-white">{item?.id ? "Editar Tipo" : "Novo Tipo de Ensaio"}</h2>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400"><X size={18} /></button>
        </div>
        <form onSubmit={submit} className="px-6 py-4 space-y-4">
          <div>
            <FieldLabel>Nome *</FieldLabel>
            <input required value={nome} onChange={(e) => setNome(e.target.value)} className={INPUT} placeholder="Ex: Newborn Premium" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <CancelBtn onClick={onClose} />
            <SaveBtn saving={saving} />
          </div>
        </form>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// MODAL: FORNECEDOR
// ═══════════════════════════════════════════════════════════
function FornecedorModal({ item, onSave, onClose }: {
  item: Partial<Fornecedor> | null;
  onSave: (d: Partial<Fornecedor>) => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState<Partial<Fornecedor>>(
    item ?? { tipo_pessoa: "PJ", nome: "" }
  );
  const [saving, setSaving] = useState(false);
  const [cnpjLoading, setCnpjLoading] = useState(false);
  const [cnpjError, setCnpjError] = useState("");

  const set = (k: keyof Fornecedor, v: unknown) => setForm((f) => ({ ...f, [k]: v }));
  const isPJ = (form.tipo_pessoa ?? "PJ") === "PJ";

  const lookupCnpj = async () => {
    const raw = (form.cnpj ?? "").replace(/\D/g, "");
    if (raw.length !== 14) { setCnpjError("CNPJ inválido"); return; }
    setCnpjLoading(true); setCnpjError("");
    try {
      const data = await catalogoApi.lookupCnpj(raw) as any;
      setForm((f) => ({
        ...f,
        nome: data.razao_social || data.nome_fantasia || f.nome,
        email: data.email || f.email,
        contato: data.nome_fantasia || f.contato,
        whatsapp: data.ddd_telefone_1 ? data.ddd_telefone_1.replace(/\D/g, "") : f.whatsapp,
      }));
    } catch (e: any) {
      setCnpjError(e.message || "Erro ao consultar");
    } finally {
      setCnpjLoading(false);
    }
  };

  // Auto-lookup when CNPJ reaches 14 digits
  useEffect(() => {
    const raw = (form.cnpj ?? "").replace(/\D/g, "");
    if (isPJ && raw.length === 14) lookupCnpj();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.cnpj]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try { await onSave(form); } finally { setSaving(false); }
  };

  return (
    <ModalShell
      title={item?.id ? "Editar Fornecedor" : "Novo Fornecedor"}
      onClose={onClose}
      onSubmit={submit}
      footer={<><CancelBtn onClick={onClose} /><SaveBtn saving={saving} /></>}
    >
      <div className="space-y-4">
        {/* PF / PJ toggle */}
        <div>
          <FieldLabel>Tipo de pessoa</FieldLabel>
          <div className="flex bg-gray-100 dark:bg-gray-800 p-1 rounded-xl gap-1 w-fit">
            {(["PJ", "PF"] as const).map((t) => (
              <button key={t} type="button" onClick={() => set("tipo_pessoa", t)}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${form.tipo_pessoa === t || (!form.tipo_pessoa && t === "PJ")
                  ? "bg-white dark:bg-gray-700 text-gold-700 dark:text-gold-300 shadow-sm"
                  : "text-gray-500 dark:text-gray-400 hover:text-gray-700"}`}>
                {t === "PJ" ? "Pessoa Jurídica" : "Pessoa Física"}
              </button>
            ))}
          </div>
        </div>

        {/* CNPJ / CPF */}
        {isPJ ? (
          <div>
            <FieldLabel>CNPJ</FieldLabel>
            <div className="flex gap-2">
              <input value={form.cnpj ?? ""} onChange={(e) => { set("cnpj", e.target.value); setCnpjError(""); }}
                placeholder="00.000.000/0001-00" maxLength={18} className={`${INPUT} flex-1`} />
              <button type="button" onClick={lookupCnpj} disabled={cnpjLoading}
                title="Consultar Receita Federal"
                className="px-3 rounded-xl border border-gray-200 dark:border-gray-700 text-gray-500 hover:text-gold-600 hover:border-gold-400 disabled:opacity-50 transition-colors flex-shrink-0">
                {cnpjLoading ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
              </button>
            </div>
            {cnpjError && (
              <p className="flex items-center gap-1 text-xs text-red-500 mt-1">
                <AlertCircle size={12} />{cnpjError}
              </p>
            )}
          </div>
        ) : (
          <div>
            <FieldLabel>CPF</FieldLabel>
            <input value={form.cpf ?? ""} onChange={(e) => set("cpf", e.target.value)} placeholder="000.000.000-00" maxLength={14} className={INPUT} />
          </div>
        )}

        {/* Nome */}
        <div>
          <FieldLabel>Nome / Razão Social *</FieldLabel>
          <input required value={form.nome ?? ""} onChange={(e) => set("nome", e.target.value)} className={INPUT} />
        </div>

        {/* Contato */}
        <div>
          <FieldLabel>Contato / Responsável</FieldLabel>
          <input value={form.contato ?? ""} onChange={(e) => set("contato", e.target.value)} className={INPUT} />
        </div>

        {/* WhatsApp + Email */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <FieldLabel>WhatsApp</FieldLabel>
            <input value={form.whatsapp ?? ""} onChange={(e) => set("whatsapp", e.target.value)} className={INPUT} />
          </div>
          <div>
            <FieldLabel>E-mail</FieldLabel>
            <input type="email" value={form.email ?? ""} onChange={(e) => set("email", e.target.value)} className={INPUT} />
          </div>
        </div>

        {/* Observações */}
        <div>
          <FieldLabel>Observações</FieldLabel>
          <textarea rows={2} value={form.observacoes ?? ""} onChange={(e) => set("observacoes", e.target.value)} className={`${INPUT} resize-none`} />
        </div>
      </div>
    </ModalShell>
  );
}

// ═══════════════════════════════════════════════════════════
// MODAL: PRODUTO
// ═══════════════════════════════════════════════════════════
function ProdutoModal({ item, fornecedores, categorias, onSave, onClose }: {
  item: Partial<Produto> | null;
  fornecedores: Fornecedor[];
  categorias: CategoriaCatalogo[];
  onSave: (d: Partial<Produto>) => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState<Partial<Produto>>(
    item ?? { nome: "", categoria: "", preco_custo: 0, preco_venda: 0, unidade: "un", estoque: 0, ativo: true }
  );
  const [saving, setSaving] = useState(false);
  const set = (k: keyof Produto, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

  // Markup = (venda - custo) / venda
  const markup = form.preco_venda && form.preco_venda > 0
    ? (((form.preco_venda - (form.preco_custo ?? 0)) / form.preco_venda) * 100).toFixed(1)
    : "-";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try { await onSave(form); } finally { setSaving(false); }
  };

  const categoriaOpts = categorias.map((c) => ({ value: c.nome, label: c.nome }));
  const fornecedorOpts = [{ value: "", label: "Nenhum" }, ...fornecedores.map((f) => ({ value: f.id, label: f.nome }))];
  const unidadeOpts = UNIDADES.map((u) => ({ value: u, label: u }));

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <form onSubmit={submit} className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-xl shadow-xl flex flex-col max-h-[92vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex-shrink-0">
          <h2 className="font-bold text-gray-900 dark:text-white">{item?.id ? "Editar Produto" : "Novo Produto"}</h2>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400"><X size={18} /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {/* Nome */}
          <div>
            <FieldLabel>Nome *</FieldLabel>
            <input required value={form.nome ?? ""} onChange={(e) => set("nome", e.target.value)} className={INPUT} />
          </div>

          {/* Categoria + Unidade */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <FieldLabel>Categoria</FieldLabel>
              <SearchableSelect
                value={form.categoria ?? ""}
                onChange={(v) => set("categoria", v)}
                options={categoriaOpts}
                placeholder="Selecionar..."
              />
            </div>
            <div>
              <FieldLabel>Unidade</FieldLabel>
              <SearchableSelect
                value={form.unidade ?? "un"}
                onChange={(v) => set("unidade", v as UnidadeProduto)}
                options={unidadeOpts}
                placeholder="Unidade"
              />
            </div>
          </div>

          {/* Preços */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <FieldLabel>Custo (R$)</FieldLabel>
              <NumInput value={form.preco_custo ?? 0} onChange={(n) => set("preco_custo", n)} step="0.01" />
            </div>
            <div>
              <FieldLabel>Venda (R$)</FieldLabel>
              <NumInput value={form.preco_venda ?? 0} onChange={(n) => set("preco_venda", n)} step="0.01" />
            </div>
            <div>
              <FieldLabel>Markup</FieldLabel>
              <div className={`${INPUT} text-gray-400`}>{markup !== "-" ? `${markup}%` : "-"}</div>
            </div>
          </div>

          {/* Fornecedor + Prazo */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <FieldLabel>Fornecedor</FieldLabel>
              <SearchableSelect
                value={form.fornecedor_id ?? ""}
                onChange={(v) => set("fornecedor_id", v || undefined)}
                options={fornecedorOpts}
                placeholder="Nenhum"
              />
            </div>
            <div>
              <FieldLabel>Prazo entrega (dias)</FieldLabel>
              <NumInput value={form.prazo_entrega ?? 0} onChange={(n) => set("prazo_entrega", n || undefined)} />
            </div>
          </div>

          {/* Controle de estoque */}
          <div className="border-t border-gray-100 dark:border-gray-800 pt-4">
            <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-2">Controle de estoque</p>
            <div className="grid grid-cols-3 gap-1.5">
              {([
                { id: "nenhum", label: "Não controlar" },
                { id: "estoque", label: "Estoque" },
                { id: "encomenda", label: "Sob encomenda" },
              ] as const).map((opt) => {
                const mode = form.sob_encomenda ? "encomenda" : form.controla_estoque ? "estoque" : "nenhum";
                const active = mode === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => {
                      set("controla_estoque", opt.id === "estoque");
                      set("sob_encomenda", opt.id === "encomenda");
                    }}
                    className={`py-2 px-2 rounded-xl text-xs font-semibold border transition-colors ${
                      active
                        ? "bg-gold-50 dark:bg-gold-900/20 border-gold-400 text-gold-700 dark:text-gold-300"
                        : "border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300"
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
            {form.controla_estoque && (
              <>
                <p className="text-xs text-gray-400 mt-2">Dá baixa automática quando o produto é adicionado a um trabalho e avisa quando o estoque fica baixo.</p>
                <div className="grid grid-cols-2 gap-3 mt-2">
                  <div>
                    <FieldLabel>Estoque atual</FieldLabel>
                    <NumInput value={form.estoque ?? 0} onChange={(n) => set("estoque", n)} />
                  </div>
                  <div>
                    <FieldLabel>Estoque mínimo (alerta)</FieldLabel>
                    <NumInput value={form.estoque_minimo ?? 0} onChange={(n) => set("estoque_minimo", n)} />
                  </div>
                </div>
              </>
            )}
            {form.sob_encomenda && (
              <p className="text-xs text-gray-400 mt-2">Sem estoque de prateleira. Cada vez que o produto é adicionado a um trabalho, gera um pedido de compra automático - já com o nome do cliente.</p>
            )}
          </div>

          {/* Descrição */}
          <div>
            <FieldLabel>Descrição</FieldLabel>
            <textarea rows={2} value={form.descricao ?? ""} onChange={(e) => set("descricao", e.target.value)} className={`${INPUT} resize-none`} />
          </div>

          {/* Dados fiscais */}
          <div className="border-t border-gray-100 dark:border-gray-800 pt-4">
            <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-3">Dados fiscais (opcional - NFe)</p>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <FieldLabel>NCM</FieldLabel>
                <input value={form.ncm ?? ""} onChange={(e) => set("ncm", e.target.value)} placeholder="0000.00.00" className={INPUT} />
              </div>
              <div>
                <FieldLabel>CFOP</FieldLabel>
                <input value={form.cfop ?? ""} onChange={(e) => set("cfop", e.target.value)} placeholder="5102" className={INPUT} />
              </div>
              <div>
                <FieldLabel>Origem</FieldLabel>
                <SearchableSelect
                  value={form.origem ?? ""}
                  onChange={(v) => set("origem", v || undefined)}
                  options={[
                    { value: "", label: "Não informado" },
                    { value: "0", label: "0 - Nacional" },
                    { value: "1", label: "1 - Estrangeira (importação direta)" },
                    { value: "2", label: "2 - Estrangeira (adquirida no mercado interno)" },
                  ]}
                  placeholder="Origem"
                />
              </div>
            </div>
          </div>

          {/* Ativo */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.ativo ?? true} onChange={(e) => set("ativo", e.target.checked)} className="w-4 h-4 accent-gold-500" />
            <span className="text-sm text-gray-700 dark:text-gray-300">Produto ativo</span>
          </label>
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-gray-100 dark:border-gray-800 flex-shrink-0">
          <CancelBtn onClick={onClose} />
          <SaveBtn saving={saving} />
        </div>
      </form>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// MODAL: SERVIÇO
// ═══════════════════════════════════════════════════════════
function ServicoModal({ item, tiposEnsaio, onSave, onClose }: {
  item: Partial<Servico> | null;
  tiposEnsaio: TipoEnsaio[];
  onSave: (d: Partial<Servico>) => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState<Partial<Servico>>(
    item ?? { nome: "", tipo_ensaio: "", preco_base: 0, inclui_edicao: true, ativo: true }
  );
  const [saving, setSaving] = useState(false);
  const set = (k: keyof Servico, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try { await onSave(form); } finally { setSaving(false); }
  };

  const tipoOpts = tiposEnsaio.map((t) => ({ value: t.nome, label: t.nome }));

  return (
    <ModalShell
      title={item?.id ? "Editar Serviço" : "Novo Serviço"}
      onClose={onClose}
      onSubmit={submit}
      footer={<><CancelBtn onClick={onClose} /><SaveBtn saving={saving} /></>}
    >
      <div className="space-y-4">
        <div>
          <FieldLabel>Nome do serviço *</FieldLabel>
          <input required value={form.nome ?? ""} onChange={(e) => set("nome", e.target.value)}
            placeholder="Ex: Newborn Completo Premium" className={INPUT} />
        </div>

        <div>
          <FieldLabel>Tipo de ensaio</FieldLabel>
          <SearchableSelect
            value={form.tipo_ensaio ?? ""}
            onChange={(v) => set("tipo_ensaio", v)}
            options={tipoOpts}
            placeholder={tipoOpts.length === 0 ? "Cadastre tipos na aba Tipos de Ensaio" : "Selecionar..."}
          />
        </div>

        <div>
          <FieldLabel>Preço base (R$)</FieldLabel>
          <NumInput value={form.preco_base ?? 0} onChange={(n) => set("preco_base", n)} step="0.01" />
        </div>

        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={form.inclui_edicao ?? true} onChange={(e) => set("inclui_edicao", e.target.checked)} className="w-4 h-4 accent-gold-500" />
          <span className="text-sm text-gray-700 dark:text-gray-300">Inclui edição</span>
        </label>

        {/* Dados fiscais */}
        <div className="border-t border-gray-100 dark:border-gray-800 pt-4">
          <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-3">Dados fiscais (opcional - NFS-e)</p>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <FieldLabel>CNAE</FieldLabel>
              <input value={form.cnae ?? ""} onChange={(e) => set("cnae", e.target.value)} placeholder="74.20-0-01" className={INPUT} />
            </div>
            <div>
              <FieldLabel>Cód. serviço</FieldLabel>
              <input value={form.codigo_servico ?? ""} onChange={(e) => set("codigo_servico", e.target.value)} placeholder="LC 116" className={INPUT} />
            </div>
            <div>
              <FieldLabel>ISS (%)</FieldLabel>
              <NumInput value={form.iss_aliquota ?? 0} onChange={(n) => set("iss_aliquota", n || undefined)} step="0.01" placeholder="5.00" />
            </div>
          </div>
        </div>

        <div>
          <FieldLabel>Descrição</FieldLabel>
          <textarea rows={2} value={form.descricao ?? ""} onChange={(e) => set("descricao", e.target.value)} className={`${INPUT} resize-none`} />
        </div>

        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={form.ativo ?? true} onChange={(e) => set("ativo", e.target.checked)} className="w-4 h-4 accent-gold-500" />
          <span className="text-sm text-gray-700 dark:text-gray-300">Serviço ativo</span>
        </label>
      </div>
    </ModalShell>
  );
}

// ═══════════════════════════════════════════════════════════
// MODAL: COMBO
// ═══════════════════════════════════════════════════════════
const ComboModal: React.FC<{
  item: Partial<Combo> | null;
  produtos: Produto[];
  servicos: Servico[];
  onSave: (d: Partial<Combo>) => Promise<void>;
  onClose: () => void;
}> = ({ item, produtos, servicos, onSave, onClose }) => {
  const [form, setForm] = useState<Partial<Combo>>(item ?? { nome: "", desconto: 0, itens: [], ativo: true });
  const [saving, setSaving] = useState(false);
  const [niTipo, setNiTipo] = useState<"produto" | "servico">("servico");
  const [niId, setNiId] = useState("");
  const [niQtd, setNiQtd] = useState(1);

  const set = (k: keyof Combo, v: unknown) => setForm((f) => ({ ...f, [k]: v }));
  const itens = form.itens ?? [];

  const addItem = () => {
    if (!niId) return;
    const found = niTipo === "produto" ? produtos.find((p) => p.id === niId) : servicos.find((s) => s.id === niId);
    if (!found) return;
    const preco = niTipo === "produto" ? (found as Produto).preco_venda : (found as Servico).preco_base;
    const novoItem: ComboItem = { id: `new-${Date.now()}`, combo_id: form.id ?? "", tipo: niTipo, item_id: niId, nome: found.nome, quantidade: niQtd, preco_unitario: preco };
    set("itens", [...itens, novoItem]);
    setNiId(""); setNiQtd(1);
  };

  const totalP = itens.filter((i) => i.tipo === "produto").reduce((a, i) => a + i.preco_unitario * i.quantidade, 0);
  const totalS = itens.filter((i) => i.tipo === "servico").reduce((a, i) => a + i.preco_unitario * i.quantidade, 0);
  const subtotal = totalP + totalS;
  const desconto = form.desconto ?? 0;
  const final = Math.max(0, subtotal - desconto);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try { await onSave({ ...form, total_produtos: totalP, total_servicos: totalS, subtotal, preco_final: final }); }
    finally { setSaving(false); }
  };

  const available = niTipo === "produto" ? produtos.filter((p) => p.ativo) : servicos.filter((s) => s.ativo);
  const itemOpts = available.map((i) => ({ value: i.id, label: i.nome }));

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <form onSubmit={submit} className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-2xl shadow-xl flex flex-col max-h-[92vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex-shrink-0">
          <h2 className="font-bold text-gray-900 dark:text-white">{item?.id ? "Editar Combo" : "Novo Combo"}</h2>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400"><X size={18} /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <FieldLabel>Nome *</FieldLabel>
              <input required value={form.nome ?? ""} onChange={(e) => set("nome", e.target.value)} placeholder="Ex: Newborn + Álbum + Pendrive" className={INPUT} />
            </div>
            <div>
              <FieldLabel>Desconto (R$)</FieldLabel>
              <NumInput value={form.desconto ?? 0} onChange={(n) => set("desconto", n)} step="0.01" />
            </div>
            <div className="flex items-end pb-1">
              <label className="flex items-center gap-2 cursor-pointer py-2">
                <input type="checkbox" checked={form.ativo ?? true} onChange={(e) => set("ativo", e.target.checked)} className="w-4 h-4 accent-gold-500" />
                <span className="text-sm text-gray-700 dark:text-gray-300">Combo ativo</span>
              </label>
            </div>
          </div>

          {/* Adicionar item */}
          <div>
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">Itens do combo</p>
            <div className="flex items-center gap-2 mb-3">
              <select value={niTipo} onChange={(e) => { setNiTipo(e.target.value as "produto" | "servico"); setNiId(""); }}
                className="px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 outline-none focus:border-gold-400 flex-shrink-0 w-28">
                <option value="servico">Serviço</option>
                <option value="produto">Produto</option>
              </select>
              <div className="flex-1">
                <SearchableSelect value={niId} onChange={setNiId} options={itemOpts} placeholder="Selecionar..." />
              </div>
              <input type="number" min={1} value={niQtd} onChange={(e) => setNiQtd(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-16 px-2 py-2 text-sm text-center border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 outline-none focus:border-gold-400 flex-shrink-0" />
              <button type="button" onClick={addItem} disabled={!niId}
                className="px-3 py-2 rounded-xl bg-gold-600 hover:bg-gold-700 disabled:opacity-40 text-white text-sm font-medium flex-shrink-0">
                <Plus size={16} />
              </button>
            </div>
            {itens.length === 0 ? (
              <div className="flex items-center justify-center py-6 rounded-xl border border-dashed border-gray-200 dark:border-gray-700 text-gray-400 text-sm">Nenhum item adicionado</div>
            ) : (
              <div className="space-y-1.5">
                {itens.map((it) => (
                  <div key={it.id} className="flex items-center gap-3 px-3 py-2 rounded-xl bg-gray-50 dark:bg-gray-800">
                    {it.tipo === "produto" ? <Package size={14} className="text-blue-400 flex-shrink-0" /> : <Briefcase size={14} className="text-gold-500 flex-shrink-0" />}
                    <span className="flex-1 text-sm text-gray-800 dark:text-gray-200">{it.nome}</span>
                    <span className="text-xs text-gray-400">×{it.quantidade}</span>
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300 min-w-[80px] text-right">
                      R$ {(it.preco_unitario * it.quantidade).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                    </span>
                    <button type="button" onClick={() => set("itens", itens.filter((i) => i.id !== it.id))}
                      className="p-1 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-gray-400 hover:text-red-500"><X size={13} /></button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Resumo */}
          <div className="rounded-xl bg-gray-50 dark:bg-gray-800/60 p-4 space-y-2 text-sm">
            <div className="flex justify-between text-gray-500 dark:text-gray-400"><span>Serviços</span><span>R$ {totalS.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</span></div>
            <div className="flex justify-between text-gray-500 dark:text-gray-400"><span>Produtos</span><span>R$ {totalP.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</span></div>
            {desconto > 0 && <div className="flex justify-between text-red-500 dark:text-red-400"><span>Desconto</span><span>- R$ {desconto.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</span></div>}
            <div className="flex justify-between font-bold text-gray-900 dark:text-white border-t border-gray-200 dark:border-gray-700 pt-2 mt-1">
              <span>Total</span><span className="text-gold-600">R$ {final.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</span>
            </div>
          </div>

          <div>
            <FieldLabel>Descrição</FieldLabel>
            <textarea rows={2} value={form.descricao ?? ""} onChange={(e) => set("descricao", e.target.value)} className={`${INPUT} resize-none`} />
          </div>
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-gray-100 dark:border-gray-800 flex-shrink-0">
          <CancelBtn onClick={onClose} />
          <SaveBtn saving={saving} />
        </div>
      </form>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════
// COMBO CARD
// ═══════════════════════════════════════════════════════════
const ComboCard: React.FC<{ combo: Combo; onEdit: () => void; onDelete: () => void | Promise<void> }> = ({ combo, onEdit, onDelete }) => {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 p-5 hover:shadow-sm transition-shadow">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="font-semibold text-gray-900 dark:text-white truncate">{combo.nome}</h4>
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0 ${combo.ativo ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400" : "bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400"}`}>
              {combo.ativo ? "Ativo" : "Inativo"}
            </span>
          </div>
          {combo.descricao && <p className="text-xs text-gray-400 mt-0.5 line-clamp-1">{combo.descricao}</p>}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button onClick={onEdit} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-gold-600"><Pencil size={14} /></button>
          <button onClick={onDelete} className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-gray-400 hover:text-red-500"><Trash2 size={14} /></button>
        </div>
      </div>
      <div className="mt-3">
        <p className="text-[10px] text-gray-400 uppercase tracking-wide">Valor do combo</p>
        <p className="text-2xl font-bold text-gold-600">R$ {combo.preco_final.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</p>
        {combo.desconto > 0 && <p className="text-xs text-gray-400 mt-0.5">subtotal R$ {combo.subtotal.toLocaleString("pt-BR", { minimumFractionDigits: 2 })} − R$ {combo.desconto.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</p>}
      </div>
      {combo.itens?.length > 0 && (
        <div className="mt-3 border-t border-gray-100 dark:border-gray-800 pt-3">
          <button onClick={() => setExpanded((v) => !v)} className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
            {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            {combo.itens.length} {combo.itens.length === 1 ? "item" : "itens"}
          </button>
          {expanded && (
            <div className="mt-2 space-y-1">
              {combo.itens.map((it) => (
                <div key={it.id} className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                  {it.tipo === "produto" ? <Package size={12} className="text-blue-400" /> : <Briefcase size={12} className="text-gold-500" />}
                  <span className="flex-1">{it.nome}</span>
                  <span>×{it.quantidade}</span>
                  <span className="font-medium">R$ {(it.preco_unitario * it.quantidade).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════
// SUB-TAB BAR
// ═══════════════════════════════════════════════════════════
function SubTabBar({ tabs, active, onChange }: {
  tabs: { id: string; label: string }[];
  active: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="flex gap-1 mb-4 border-b border-gray-100 dark:border-gray-800">
      {tabs.map((t) => (
        <button key={t.id} onClick={() => onChange(t.id)}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${active === t.id
            ? "border-gold-500 text-gold-600 dark:text-gold-400"
            : "border-transparent text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"}`}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// CONFIRM DIALOG
// ═══════════════════════════════════════════════════════════
function ConfirmDialog({ title, message, onConfirm, onCancel, loading }: {
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
}) {
  return (
    <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-sm shadow-2xl p-6 flex flex-col gap-5">
        <div className="flex items-start gap-4">
          <div className="p-2.5 rounded-xl bg-red-50 dark:bg-red-900/20 flex-shrink-0">
            <Trash2 size={20} className="text-red-500" />
          </div>
          <div>
            <h3 className="font-bold text-gray-900 dark:text-white mb-1">{title}</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">{message}</p>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} disabled={loading}
            className="px-4 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50">
            Cancelar
          </button>
          <button onClick={onConfirm} disabled={loading}
            className="px-4 py-2 text-sm rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-medium flex items-center gap-2">
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
            Excluir
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// ERROR MODAL
// ═══════════════════════════════════════════════════════════
function ErrorModal({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-sm shadow-2xl p-6 flex flex-col gap-5">
        <div className="flex items-start gap-4">
          <div className="p-2.5 rounded-xl bg-red-50 dark:bg-red-900/20 flex-shrink-0">
            <AlertCircle size={20} className="text-red-500" />
          </div>
          <div className="flex-1">
            <h3 className="font-bold text-gray-900 dark:text-white mb-1">Erro ao salvar</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 break-words">{message}</p>
          </div>
        </div>
        <div className="flex justify-end">
          <button onClick={onClose}
            className="px-5 py-2 text-sm rounded-xl bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 font-medium">
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// PÁGINA PRINCIPAL
// ═══════════════════════════════════════════════════════════
export default function CatalogoPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { isMember } = useAuth();
  const aba = (searchParams.get("aba") as Aba) ?? "produtos";
  const subP = (searchParams.get("sub") as SubProdutos) ?? "produtos";
  const subS = (searchParams.get("subS") as SubServicos) ?? "servicos";

  const setAba = (a: Aba) => setSearchParams({ aba: a });
  const setSubP = (s: SubProdutos) => setSearchParams({ aba: "produtos", sub: s });
  const setSubS = (s: SubServicos) => setSearchParams({ aba: "servicos", subS: s });

  // Data
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [fornecedores, setFornecedores] = useState<Fornecedor[]>([]);
  const [servicos, setServicos] = useState<Servico[]>([]);
  const [combos, setCombos] = useState<Combo[]>([]);
  const [categorias, setCategorias] = useState<CategoriaCatalogo[]>([]);
  const [tiposEnsaio, setTiposEnsaio] = useState<TipoEnsaio[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [saveError, setSaveError] = useState("");

  // Modais
  const [editProduto, setEditProduto] = useState<Partial<Produto> | null | false>(false);
  const [editFornecedor, setEditFornecedor] = useState<Partial<Fornecedor> | null | false>(false);
  const [editServico, setEditServico] = useState<Partial<Servico> | null | false>(false);
  const [editCombo, setEditCombo] = useState<Partial<Combo> | null | false>(false);
  const [editCategoria, setEditCategoria] = useState<Partial<CategoriaCatalogo> | null | false>(false);
  const [editTipo, setEditTipo] = useState<Partial<TipoEnsaio> | null | false>(false);

  // ConfirmDialog state
  const [confirmCfg, setConfirmCfg] = useState<{ title: string; message: string; onConfirm: () => void } | null>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);

  const askConfirm = (title: string, message: string, onConfirm: () => Promise<void>) => {
    setConfirmCfg({
      title,
      message,
      onConfirm: async () => {
        setConfirmLoading(true);
        try { await onConfirm(); } finally { setConfirmLoading(false); setConfirmCfg(null); }
      },
    });
  };

  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [p, f, s, c, cat, tipos] = await Promise.all([
        catalogoApi.getProdutos(),
        catalogoApi.getFornecedores(),
        catalogoApi.getServicos(),
        catalogoApi.getCombos(),
        catalogoApi.getCategorias(),
        catalogoApi.getTiposEnsaio(),
      ]);
      setProdutos(p); setFornecedores(f); setServicos(s); setCombos(c);
      setCategorias(cat); setTiposEnsaio(tipos);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);
  useEffect(() => { setSearch(""); }, [aba, subP, subS]);

  // ── Botão "Novo" por contexto ──
  const novoLabel = aba === "produtos"
    ? subP === "categorias" ? "Nova Categoria" : subP === "fornecedores" ? "Novo Fornecedor" : "Novo Produto"
    : aba === "servicos"
    ? subS === "tipos" ? "Novo Tipo" : "Novo Serviço"
    : "Novo Combo";

  const handleNovo = () => {
    if (aba === "produtos") {
      if (subP === "categorias") setEditCategoria({});
      else if (subP === "fornecedores") setEditFornecedor({});
      else setEditProduto({});
    } else if (aba === "servicos") {
      if (subS === "tipos") setEditTipo({});
      else setEditServico({});
    } else {
      setEditCombo({});
    }
  };

  // ── Saves ──
  const makeSave = <T extends { id?: string }>(
    updateFn: (id: string, d: T) => Promise<unknown>,
    createFn: (d: T) => Promise<unknown>,
    closeFn: () => void,
  ) => async (d: T) => {
    setSaveError("");
    try {
      if (d.id) await updateFn(d.id, d); else await createFn(d);
      closeFn();
      await load(true);
    } catch (e: any) {
      setSaveError(e.message || "Erro ao salvar");
    }
  };

  const saveProduto = makeSave<Partial<Produto>>(
    (id, d) => catalogoApi.updateProduto(id, d),
    (d) => catalogoApi.createProduto(d),
    () => setEditProduto(false),
  );
  const saveFornecedor = makeSave<Partial<Fornecedor>>(
    (id, d) => catalogoApi.updateFornecedor(id, d),
    (d) => catalogoApi.createFornecedor(d),
    () => setEditFornecedor(false),
  );
  const saveServico = makeSave<Partial<Servico>>(
    (id, d) => catalogoApi.updateServico(id, d),
    (d) => catalogoApi.createServico(d),
    () => setEditServico(false),
  );
  const saveCombo = makeSave<Partial<Combo>>(
    (id, d) => catalogoApi.updateCombo(id, d),
    (d) => catalogoApi.createCombo(d),
    () => setEditCombo(false),
  );
  const saveCategoria = makeSave<Partial<CategoriaCatalogo>>(
    (id, d) => catalogoApi.updateCategoria(id, d),
    (d) => catalogoApi.createCategoria(d),
    () => setEditCategoria(false),
  );
  const saveTipo = makeSave<Partial<TipoEnsaio>>(
    (id, d) => catalogoApi.updateTipoEnsaio(id, d),
    (d) => catalogoApi.createTipoEnsaio(d),
    () => setEditTipo(false),
  );

  // ── Dados filtrados ──
  const q = search.toLowerCase();
  const filtProdutos = produtos.filter((p) => !q || p.nome.toLowerCase().includes(q) || (p.categoria ?? "").toLowerCase().includes(q) || (p.fornecedor_nome ?? "").toLowerCase().includes(q));
  const filtFornecedores = fornecedores.filter((f) => !q || f.nome.toLowerCase().includes(q) || (f.email ?? "").toLowerCase().includes(q));
  const filtServicos = servicos.filter((s) => !q || s.nome.toLowerCase().includes(q) || (s.tipo_ensaio ?? "").toLowerCase().includes(q));
  const filtCombos = combos.filter((c) => !q || c.nome.toLowerCase().includes(q));
  const filtCategorias = categorias.filter((c) => !q || c.nome.toLowerCase().includes(q));
  const filtTipos = tiposEnsaio.filter((t) => !q || t.nome.toLowerCase().includes(q));

  // ── Abas ──
  const ABAS: { id: Aba; label: string; icon: React.ReactNode }[] = [
    { id: "produtos", label: "Produtos", icon: <Package size={15} /> },
    { id: "servicos", label: "Serviços", icon: <Briefcase size={15} /> },
    { id: "combos", label: "Combos", icon: <Layers size={15} /> },
  ];

  const tableHeaderCls = "text-left px-5 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide";
  const tableRowCls = "border-b border-gray-50 dark:border-gray-800/50 hover:bg-gray-50 dark:hover:bg-gray-800/30";

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-2xl font-bold text-gray-800 dark:text-white">Catálogo</h3>
          <p className="text-gray-500 dark:text-gray-400 text-sm">Produtos, serviços e combos do seu estúdio.</p>
        </div>
        {!(aba === "produtos" && (subP === "estoque" || subP === "relatorio")) && (
          <button onClick={handleNovo}
            className="flex items-center gap-2 px-4 py-2 bg-gold-600 hover:bg-gold-700 text-white text-sm font-medium rounded-xl transition-colors">
            <Plus size={16} />{novoLabel}
          </button>
        )}
      </div>

      {/* Abas + Busca */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex bg-gray-100 dark:bg-gray-800 p-1 rounded-xl gap-1 w-fit">
          {ABAS.map((a) => (
            <button key={a.id} onClick={() => setAba(a.id)}
              className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${aba === a.id
                ? "bg-white dark:bg-gray-700 text-gold-700 dark:text-gold-300 shadow-sm"
                : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"}`}>
              {a.icon}{a.label}
            </button>
          ))}
        </div>
        <div className="relative max-w-xs w-full">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input placeholder="Buscar..." value={search} onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 placeholder-gray-400 focus:border-gold-400 outline-none" />
          {search && <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"><X size={13} /></button>}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-48"><Loader2 size={24} className="animate-spin text-gold-500" /></div>
      ) : (
        <>
          {/* ─── PRODUTOS ─── */}
          {aba === "produtos" && (
            <div>
              <SubTabBar
                tabs={[
                  { id: "produtos", label: "Produtos" }, { id: "categorias", label: "Categorias" },
                  { id: "fornecedores", label: "Fornecedores" }, { id: "estoque", label: "Estoque" },
                  // Relatório (mostra valores de venda) — só o DONO vê.
                  ...(isMember ? [] : [{ id: "relatorio", label: "Relatório" }]),
                ]}
                active={subP}
                onChange={(s) => setSubP(s as SubProdutos)}
              />

              {/* Sub: Estoque */}
              {subP === "estoque" && (
                <EstoqueTab produtos={produtos} onChanged={() => load(true)} />
              )}

              {/* Sub: Relatório (só dono) */}
              {subP === "relatorio" && !isMember && <RelatorioVendas />}

              {/* Sub: Produtos */}
              {subP === "produtos" && (
                <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 overflow-hidden">
                  {filtProdutos.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 gap-3 text-gray-400"><Package size={32} strokeWidth={1.5} /><p className="text-sm">Nenhum produto encontrado</p></div>
                  ) : (
                    <table className="w-full text-sm">
                      <thead><tr className="border-b border-gray-100 dark:border-gray-800">
                        <th className={tableHeaderCls}>Nome</th>
                        <th className={`${tableHeaderCls} hidden md:table-cell`}>Categoria</th>
                        <th className={`${tableHeaderCls} text-right`}>Custo</th>
                        <th className={`${tableHeaderCls} text-right`}>Venda</th>
                        <th className={`${tableHeaderCls} text-right hidden sm:table-cell`}>Markup</th>
                        <th className={`${tableHeaderCls} text-center hidden lg:table-cell`}>Prazo</th>
                        <th className={`${tableHeaderCls} text-center`}>Estoque</th>
                        <th className={`${tableHeaderCls} text-center`}>Status</th>
                        <th className="px-5 py-3" />
                      </tr></thead>
                      <tbody>
                        {filtProdutos.map((p) => (
                          <tr key={p.id} className={tableRowCls}>
                            <td className="px-5 py-3">
                              <div className="font-medium text-gray-900 dark:text-white">{p.nome}</div>
                              {p.fornecedor_nome && <div className="text-xs text-gray-400 mt-0.5">{p.fornecedor_nome}</div>}
                            </td>
                            <td className="px-5 py-3 text-gray-500 dark:text-gray-400 hidden md:table-cell">
                              {p.categoria ? (
                                <span className="inline-flex items-center gap-1">
                                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: categorias.find((c) => c.nome === p.categoria)?.cor ?? "#6B7280" }} />
                                  {p.categoria}
                                </span>
                              ) : "-"}
                            </td>
                            <td className="px-5 py-3 text-right text-gray-700 dark:text-gray-300">R$ {p.preco_custo.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</td>
                            <td className="px-5 py-3 text-right font-semibold text-gray-900 dark:text-white">R$ {p.preco_venda.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</td>
                            <td className="px-5 py-3 text-right hidden sm:table-cell">
                              {p.margem_lucro != null ? (
                                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${p.margem_lucro >= 30 ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400" : p.margem_lucro >= 10 ? "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400" : "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400"}`}>
                                  {p.margem_lucro.toFixed(1)}%
                                </span>
                              ) : "-"}
                            </td>
                            <td className="px-5 py-3 text-center text-gray-500 dark:text-gray-400 hidden lg:table-cell">
                              {p.prazo_entrega ? `${p.prazo_entrega}d` : "-"}
                            </td>
                            <td className="px-5 py-3 text-center">
                              {p.controla_estoque ? (
                                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                                  (p.estoque ?? 0) <= 0
                                    ? "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400"
                                    : (p.estoque ?? 0) <= (p.estoque_minimo ?? 0)
                                    ? "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400"
                                    : "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400"
                                }`}>{p.estoque ?? 0}</span>
                              ) : p.sob_encomenda ? (
                                <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400">Encomenda</span>
                              ) : (
                                <span className="text-gray-300 dark:text-gray-600">-</span>
                              )}
                            </td>
                            <td className="px-5 py-3 text-center">
                              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${p.ativo ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400" : "bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400"}`}>{p.ativo ? "Ativo" : "Inativo"}</span>
                            </td>
                            <td className="px-5 py-3">
                              <div className="flex items-center justify-end gap-1">
                                <button onClick={() => setEditProduto(p)} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-gold-600"><Pencil size={14} /></button>
                                <button onClick={() => askConfirm("Excluir produto", `Tem certeza que deseja excluir "${p.nome}"? Esta ação não pode ser desfeita.`, async () => { await catalogoApi.deleteProduto(p.id); setProdutos((x) => x.filter((i) => i.id !== p.id)); })}
                                  className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-gray-400 hover:text-red-500"><Trash2 size={14} /></button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}

              {/* Sub: Categorias */}
              {subP === "categorias" && (
                <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 overflow-hidden">
                  {filtCategorias.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 gap-3 text-gray-400"><Tag size={32} strokeWidth={1.5} /><p className="text-sm">Nenhuma categoria cadastrada</p></div>
                  ) : (
                    <table className="w-full text-sm">
                      <thead><tr className="border-b border-gray-100 dark:border-gray-800">
                        <th className={tableHeaderCls}>Nome</th>
                        <th className={`${tableHeaderCls} text-center`}>Produtos</th>
                        <th className="px-5 py-3" />
                      </tr></thead>
                      <tbody>
                        {filtCategorias.map((cat) => (
                          <tr key={cat.id} className={tableRowCls}>
                            <td className="px-5 py-3">
                              <div className="flex items-center gap-2">
                                <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: cat.cor ?? "#6B7280" }} />
                                <span className="font-medium text-gray-900 dark:text-white">{cat.nome}</span>
                              </div>
                            </td>
                            <td className="px-5 py-3 text-center text-gray-500 dark:text-gray-400">
                              {produtos.filter((p) => p.categoria === cat.nome).length}
                            </td>
                            <td className="px-5 py-3">
                              <div className="flex items-center justify-end gap-1">
                                <button onClick={() => setEditCategoria(cat)} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-gold-600"><Pencil size={14} /></button>
                                <button onClick={() => askConfirm("Excluir categoria", `Tem certeza que deseja excluir "${cat.nome}"? Produtos vinculados perderão essa categoria.`, async () => { await catalogoApi.deleteCategoria(cat.id); setCategorias((x) => x.filter((i) => i.id !== cat.id)); })}
                                  className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-gray-400 hover:text-red-500"><Trash2 size={14} /></button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}

              {/* Sub: Fornecedores */}
              {subP === "fornecedores" && (
                <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 overflow-hidden">
                  {filtFornecedores.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 gap-3 text-gray-400"><Building2 size={32} strokeWidth={1.5} /><p className="text-sm">Nenhum fornecedor cadastrado</p></div>
                  ) : (
                    <table className="w-full text-sm">
                      <thead><tr className="border-b border-gray-100 dark:border-gray-800">
                        <th className={tableHeaderCls}>Nome</th>
                        <th className={`${tableHeaderCls} hidden sm:table-cell`}>Tipo</th>
                        <th className={`${tableHeaderCls} hidden md:table-cell`}>Contato</th>
                        <th className="px-5 py-3" />
                      </tr></thead>
                      <tbody>
                        {filtFornecedores.map((f) => (
                          <tr key={f.id} className={tableRowCls}>
                            <td className="px-5 py-3">
                              <div className="font-medium text-gray-900 dark:text-white">{f.nome}</div>
                              {f.email && <div className="text-xs text-gray-400 mt-0.5">{f.email}</div>}
                            </td>
                            <td className="px-5 py-3 hidden sm:table-cell">
                              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${f.tipo_pessoa === "PF" ? "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400" : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400"}`}>
                                {f.tipo_pessoa === "PF" ? "Pessoa Física" : "Pessoa Jurídica"}
                              </span>
                            </td>
                            <td className="px-5 py-3 text-gray-500 dark:text-gray-400 hidden md:table-cell">{f.contato || f.whatsapp || "-"}</td>
                            <td className="px-5 py-3">
                              <div className="flex items-center justify-end gap-1">
                                <button onClick={() => setEditFornecedor(f)} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-gold-600"><Pencil size={14} /></button>
                                <button onClick={() => askConfirm("Excluir fornecedor", `Tem certeza que deseja excluir "${f.nome}"? Esta ação não pode ser desfeita.`, async () => { await catalogoApi.deleteFornecedor(f.id); setFornecedores((x) => x.filter((i) => i.id !== f.id)); })}
                                  className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-gray-400 hover:text-red-500"><Trash2 size={14} /></button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ─── SERVIÇOS ─── */}
          {aba === "servicos" && (
            <div>
              <SubTabBar
                tabs={[{ id: "servicos", label: "Serviços" }, { id: "tipos", label: "Tipos de Ensaio" }]}
                active={subS}
                onChange={(s) => setSubS(s as SubServicos)}
              />

              {subS === "servicos" && (
                <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 overflow-hidden">
                  {filtServicos.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 gap-3 text-gray-400"><Briefcase size={32} strokeWidth={1.5} /><p className="text-sm">Nenhum serviço encontrado</p></div>
                  ) : (
                    <table className="w-full text-sm">
                      <thead><tr className="border-b border-gray-100 dark:border-gray-800">
                        <th className={tableHeaderCls}>Nome</th>
                        <th className={`${tableHeaderCls} hidden md:table-cell`}>Tipo</th>
                        <th className={`${tableHeaderCls} text-right`}>Preço base</th>
                        <th className={`${tableHeaderCls} text-center hidden sm:table-cell`}>Edição</th>
                        <th className={`${tableHeaderCls} text-center`}>Status</th>
                        <th className="px-5 py-3" />
                      </tr></thead>
                      <tbody>
                        {filtServicos.map((s) => (
                          <tr key={s.id} className={tableRowCls}>
                            <td className="px-5 py-3">
                              <div className="font-medium text-gray-900 dark:text-white">{s.nome}</div>
                              {s.descricao && <div className="text-xs text-gray-400 mt-0.5 truncate max-w-[180px]">{s.descricao}</div>}
                            </td>
                            <td className="px-5 py-3 text-gray-500 dark:text-gray-400 hidden md:table-cell">{s.tipo_ensaio || "-"}</td>
                            <td className="px-5 py-3 text-right font-semibold text-gray-900 dark:text-white">R$ {s.preco_base.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</td>
                            <td className="px-5 py-3 text-center hidden sm:table-cell">
                              {s.inclui_edicao ? <CheckCircle size={16} className="mx-auto text-green-500" /> : <XCircle size={16} className="mx-auto text-gray-300 dark:text-gray-600" />}
                            </td>
                            <td className="px-5 py-3 text-center">
                              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${s.ativo ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400" : "bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400"}`}>{s.ativo ? "Ativo" : "Inativo"}</span>
                            </td>
                            <td className="px-5 py-3">
                              <div className="flex items-center justify-end gap-1">
                                <button onClick={() => setEditServico(s)} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-gold-600"><Pencil size={14} /></button>
                                <button onClick={() => askConfirm("Excluir serviço", `Tem certeza que deseja excluir "${s.nome}"? Esta ação não pode ser desfeita.`, async () => { await catalogoApi.deleteServico(s.id); setServicos((x) => x.filter((i) => i.id !== s.id)); })}
                                  className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-gray-400 hover:text-red-500"><Trash2 size={14} /></button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}

              {subS === "tipos" && (
                <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 overflow-hidden">
                  {filtTipos.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 gap-3 text-gray-400"><Tag size={32} strokeWidth={1.5} /><p className="text-sm">Nenhum tipo de ensaio cadastrado</p></div>
                  ) : (
                    <table className="w-full text-sm">
                      <thead><tr className="border-b border-gray-100 dark:border-gray-800">
                        <th className={tableHeaderCls}>Nome</th>
                        <th className={`${tableHeaderCls} text-center`}>Serviços</th>
                        <th className="px-5 py-3" />
                      </tr></thead>
                      <tbody>
                        {filtTipos.map((t) => (
                          <tr key={t.id} className={tableRowCls}>
                            <td className="px-5 py-3 font-medium text-gray-900 dark:text-white">{t.nome}</td>
                            <td className="px-5 py-3 text-center text-gray-500 dark:text-gray-400">{servicos.filter((s) => s.tipo_ensaio === t.nome).length}</td>
                            <td className="px-5 py-3">
                              <div className="flex items-center justify-end gap-1">
                                <button onClick={() => setEditTipo(t)} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-gold-600"><Pencil size={14} /></button>
                                <button onClick={() => askConfirm("Excluir tipo de ensaio", `Tem certeza que deseja excluir "${t.nome}"? Serviços vinculados perderão esse tipo.`, async () => { await catalogoApi.deleteTipoEnsaio(t.id); setTiposEnsaio((x) => x.filter((i) => i.id !== t.id)); })}
                                  className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-gray-400 hover:text-red-500"><Trash2 size={14} /></button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ─── COMBOS ─── */}
          {aba === "combos" && (
            filtCombos.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 gap-3 text-gray-400"><Layers size={32} strokeWidth={1.5} /><p className="text-sm">Nenhum combo encontrado</p></div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {filtCombos.map((c) => (
                  <ComboCard key={c.id} combo={c} onEdit={() => setEditCombo(c)}
                    onDelete={() => askConfirm("Excluir combo", `Tem certeza que deseja excluir "${c.nome}"? Esta ação não pode ser desfeita.`, async () => { await catalogoApi.deleteCombo(c.id); setCombos((x) => x.filter((i) => i.id !== c.id)); })} />
                ))}
              </div>
            )
          )}
        </>
      )}

      {/* Modais */}
      {editProduto !== false && <ProdutoModal item={editProduto} fornecedores={fornecedores} categorias={categorias} onSave={saveProduto} onClose={() => setEditProduto(false)} />}
      {editFornecedor !== false && <FornecedorModal item={editFornecedor} onSave={saveFornecedor} onClose={() => setEditFornecedor(false)} />}
      {editServico !== false && <ServicoModal item={editServico} tiposEnsaio={tiposEnsaio} onSave={saveServico} onClose={() => setEditServico(false)} />}
      {editCombo !== false && <ComboModal key={editCombo?.id ?? 'new'} item={editCombo} produtos={produtos} servicos={servicos} onSave={saveCombo} onClose={() => setEditCombo(false)} />}
      {editCategoria !== false && <CategoriaModal item={editCategoria} onSave={saveCategoria} onClose={() => setEditCategoria(false)} />}
      {editTipo !== false && <TipoEnsaioModal item={editTipo} onSave={saveTipo} onClose={() => setEditTipo(false)} />}

      {confirmCfg && (
        <ConfirmDialog
          title={confirmCfg.title}
          message={confirmCfg.message}
          onConfirm={confirmCfg.onConfirm}
          onCancel={() => setConfirmCfg(null)}
          loading={confirmLoading}
        />
      )}
      {saveError && <ErrorModal message={saveError} onClose={() => setSaveError("")} />}
    </div>
  );
}

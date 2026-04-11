import React, { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Package,
  Briefcase,
  Layers,
  Building2,
  Plus,
  Search,
  Pencil,
  Trash2,
  X,
  Loader2,
  CheckCircle,
  XCircle,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { catalogoApi } from "../services/api/catalogo";
import {
  Produto,
  Fornecedor,
  Servico,
  Combo,
  ComboItem,
  CategoriaProduto,
  CATEGORIA_LABELS,
  TIPO_ENSAIO_LABELS,
  UnidadeProduto,
} from "../types";

// ═══════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════
const UNIDADES: UnidadeProduto[] = ["un", "cx", "pct", "par", "kit"];
const CATEGORIAS = Object.entries(CATEGORIA_LABELS) as [CategoriaProduto, string][];
const TIPOS_ENSAIO = Object.entries(TIPO_ENSAIO_LABELS);

type Aba = "produtos" | "servicos" | "combos";
type SubAbaProdutos = "produtos" | "fornecedores";

// ═══════════════════════════════════════════════════════════
// MODAL PRODUTO
// ═══════════════════════════════════════════════════════════
function ProdutoModal({
  item,
  fornecedores,
  onSave,
  onClose,
}: {
  item: Partial<Produto> | null;
  fornecedores: Fornecedor[];
  onSave: (d: Partial<Produto>) => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState<Partial<Produto>>(
    item ?? { nome: "", categoria: "outros", preco_custo: 0, preco_venda: 0, unidade: "un", estoque: 0, ativo: true }
  );
  const [saving, setSaving] = useState(false);
  const set = (k: keyof Produto, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

  const margem =
    form.preco_venda && form.preco_custo && form.preco_custo > 0
      ? (((form.preco_venda - form.preco_custo) / form.preco_custo) * 100).toFixed(1)
      : "—";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try { await onSave(form); } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-lg shadow-xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800">
          <h2 className="font-bold text-gray-900 dark:text-white">{item?.id ? "Editar Produto" : "Novo Produto"}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400"><X size={18} /></button>
        </div>
        <form onSubmit={submit} className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Nome *</label>
            <input required value={form.nome ?? ""} onChange={(e) => set("nome", e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 outline-none focus:border-gold-400" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Categoria</label>
              <select value={form.categoria} onChange={(e) => set("categoria", e.target.value as CategoriaProduto)}
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 outline-none focus:border-gold-400">
                {CATEGORIAS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Unidade</label>
              <select value={form.unidade} onChange={(e) => set("unidade", e.target.value as UnidadeProduto)}
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 outline-none focus:border-gold-400">
                {UNIDADES.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Custo (R$)</label>
              <input type="number" min={0} step="0.01" value={form.preco_custo ?? 0}
                onChange={(e) => set("preco_custo", parseFloat(e.target.value) || 0)}
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 outline-none focus:border-gold-400" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Venda (R$)</label>
              <input type="number" min={0} step="0.01" value={form.preco_venda ?? 0}
                onChange={(e) => set("preco_venda", parseFloat(e.target.value) || 0)}
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 outline-none focus:border-gold-400" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Margem</label>
              <div className="px-3 py-2 text-sm rounded-xl bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-700">
                {margem !== "—" ? `${margem}%` : "—"}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Fornecedor</label>
              <select value={form.fornecedor_id ?? ""} onChange={(e) => set("fornecedor_id", e.target.value || undefined)}
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 outline-none focus:border-gold-400">
                <option value="">Nenhum</option>
                {fornecedores.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Estoque</label>
              <input type="number" min={0} value={form.estoque ?? 0} onChange={(e) => set("estoque", parseInt(e.target.value) || 0)}
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 outline-none focus:border-gold-400" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Descrição</label>
            <textarea rows={2} value={form.descricao ?? ""} onChange={(e) => set("descricao", e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 outline-none focus:border-gold-400 resize-none" />
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.ativo ?? true} onChange={(e) => set("ativo", e.target.checked)} className="w-4 h-4 accent-gold-500" />
            <span className="text-sm text-gray-700 dark:text-gray-300">Produto ativo</span>
          </label>
        </form>
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-gray-100 dark:border-gray-800">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800">Cancelar</button>
          <button onClick={submit as unknown as React.MouseEventHandler} disabled={saving}
            className="px-5 py-2 text-sm rounded-xl bg-gold-600 hover:bg-gold-700 disabled:opacity-50 text-white font-medium flex items-center gap-2">
            {saving && <Loader2 size={14} className="animate-spin" />} Salvar
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// MODAL FORNECEDOR
// ═══════════════════════════════════════════════════════════
function FornecedorModal({ item, onSave, onClose }: { item: Partial<Fornecedor> | null; onSave: (d: Partial<Fornecedor>) => Promise<void>; onClose: () => void }) {
  const [form, setForm] = useState<Partial<Fornecedor>>(item ?? { nome: "" });
  const [saving, setSaving] = useState(false);
  const set = (k: keyof Fornecedor, v: unknown) => setForm((f) => ({ ...f, [k]: v }));
  const submit = async (e: React.FormEvent) => { e.preventDefault(); setSaving(true); try { await onSave(form); } finally { setSaving(false); } };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-md shadow-xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800">
          <h2 className="font-bold text-gray-900 dark:text-white">{item?.id ? "Editar Fornecedor" : "Novo Fornecedor"}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400"><X size={18} /></button>
        </div>
        <form onSubmit={submit} className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Nome *</label>
            <input required value={form.nome ?? ""} onChange={(e) => set("nome", e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 outline-none focus:border-gold-400" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">CNPJ</label>
              <input value={form.cnpj ?? ""} onChange={(e) => set("cnpj", e.target.value)} placeholder="00.000.000/0001-00"
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 outline-none focus:border-gold-400" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Prazo entrega (dias)</label>
              <input type="number" min={0} value={form.prazo_entrega ?? ""} onChange={(e) => set("prazo_entrega", e.target.value ? parseInt(e.target.value) : undefined)}
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 outline-none focus:border-gold-400" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Contato</label>
            <input value={form.contato ?? ""} onChange={(e) => set("contato", e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 outline-none focus:border-gold-400" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">WhatsApp</label>
              <input value={form.whatsapp ?? ""} onChange={(e) => set("whatsapp", e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 outline-none focus:border-gold-400" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">E-mail</label>
              <input type="email" value={form.email ?? ""} onChange={(e) => set("email", e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 outline-none focus:border-gold-400" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Observações</label>
            <textarea rows={2} value={form.observacoes ?? ""} onChange={(e) => set("observacoes", e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 outline-none focus:border-gold-400 resize-none" />
          </div>
        </form>
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-gray-100 dark:border-gray-800">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800">Cancelar</button>
          <button onClick={submit as unknown as React.MouseEventHandler} disabled={saving}
            className="px-5 py-2 text-sm rounded-xl bg-gold-600 hover:bg-gold-700 disabled:opacity-50 text-white font-medium flex items-center gap-2">
            {saving && <Loader2 size={14} className="animate-spin" />} Salvar
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// MODAL SERVIÇO
// ═══════════════════════════════════════════════════════════
function ServicoModal({ item, onSave, onClose }: { item: Partial<Servico> | null; onSave: (d: Partial<Servico>) => Promise<void>; onClose: () => void }) {
  const [form, setForm] = useState<Partial<Servico>>(
    item ?? { nome: "", tipo_ensaio: "newborn", preco_base: 0, inclui_edicao: true, ativo: true }
  );
  const [saving, setSaving] = useState(false);
  const set = (k: keyof Servico, v: unknown) => setForm((f) => ({ ...f, [k]: v }));
  const submit = async (e: React.FormEvent) => { e.preventDefault(); setSaving(true); try { await onSave(form); } finally { setSaving(false); } };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-lg shadow-xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800">
          <h2 className="font-bold text-gray-900 dark:text-white">{item?.id ? "Editar Serviço" : "Novo Serviço"}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400"><X size={18} /></button>
        </div>
        <form onSubmit={submit} className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Nome do serviço *</label>
            <input required value={form.nome ?? ""} onChange={(e) => set("nome", e.target.value)} placeholder="Ex: Newborn Completo Premium"
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 outline-none focus:border-gold-400" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Tipo de ensaio</label>
            <select value={form.tipo_ensaio ?? "newborn"} onChange={(e) => set("tipo_ensaio", e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 outline-none focus:border-gold-400">
              {TIPOS_ENSAIO.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Preço base (R$)</label>
            <input type="number" min={0} step="0.01" value={form.preco_base ?? 0} onChange={(e) => set("preco_base", parseFloat(e.target.value) || 0)}
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 outline-none focus:border-gold-400" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Qtd. fotos entregues</label>
              <input type="number" min={0} value={form.qtd_fotos_entrega ?? ""} onChange={(e) => set("qtd_fotos_entrega", e.target.value ? parseInt(e.target.value) : undefined)}
                placeholder="Ex: 30" className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 outline-none focus:border-gold-400" />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 cursor-pointer pb-2">
                <input type="checkbox" checked={form.inclui_edicao ?? true} onChange={(e) => set("inclui_edicao", e.target.checked)} className="w-4 h-4 accent-gold-500" />
                <span className="text-sm text-gray-700 dark:text-gray-300">Inclui edição</span>
              </label>
            </div>
          </div>
          <div className="border-t border-gray-100 dark:border-gray-800 pt-3">
            <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-3">Dados fiscais (opcional)</p>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">CNAE</label>
                <input value={form.cnae ?? ""} onChange={(e) => set("cnae", e.target.value)} placeholder="74.20-0-01"
                  className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 outline-none focus:border-gold-400" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Cód. serviço</label>
                <input value={form.codigo_servico ?? ""} onChange={(e) => set("codigo_servico", e.target.value)} placeholder="LC 116"
                  className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 outline-none focus:border-gold-400" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Alíquota ISS (%)</label>
                <input type="number" min={0} max={100} step="0.01" value={form.iss_aliquota ?? ""} onChange={(e) => set("iss_aliquota", e.target.value ? parseFloat(e.target.value) : undefined)}
                  placeholder="5.00" className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 outline-none focus:border-gold-400" />
              </div>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Descrição</label>
            <textarea rows={2} value={form.descricao ?? ""} onChange={(e) => set("descricao", e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 outline-none focus:border-gold-400 resize-none" />
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.ativo ?? true} onChange={(e) => set("ativo", e.target.checked)} className="w-4 h-4 accent-gold-500" />
            <span className="text-sm text-gray-700 dark:text-gray-300">Serviço ativo</span>
          </label>
        </form>
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-gray-100 dark:border-gray-800">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800">Cancelar</button>
          <button onClick={submit as unknown as React.MouseEventHandler} disabled={saving}
            className="px-5 py-2 text-sm rounded-xl bg-gold-600 hover:bg-gold-700 disabled:opacity-50 text-white font-medium flex items-center gap-2">
            {saving && <Loader2 size={14} className="animate-spin" />} Salvar
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// MODAL COMBO
// ═══════════════════════════════════════════════════════════
function ComboModal({ item, produtos, servicos, onSave, onClose }: {
  item: Partial<Combo> | null;
  produtos: Produto[];
  servicos: Servico[];
  onSave: (d: Partial<Combo>) => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState<Partial<Combo>>(item ?? { nome: "", desconto: 0, itens: [], ativo: true });
  const [saving, setSaving] = useState(false);
  const [newItemTipo, setNewItemTipo] = useState<"produto" | "servico">("servico");
  const [newItemId, setNewItemId] = useState("");
  const [newItemQtd, setNewItemQtd] = useState(1);

  const set = (k: keyof Combo, v: unknown) => setForm((f) => ({ ...f, [k]: v }));
  const itens = form.itens ?? [];

  const addItem = () => {
    if (!newItemId) return;
    const found = newItemTipo === "produto" ? produtos.find((p) => p.id === newItemId) : servicos.find((s) => s.id === newItemId);
    if (!found) return;
    const preco = newItemTipo === "produto" ? (found as Produto).preco_venda : (found as Servico).preco_base;
    const novoItem: ComboItem = { id: `new-${Date.now()}`, combo_id: form.id ?? "", tipo: newItemTipo, item_id: newItemId, nome: found.nome, quantidade: newItemQtd, preco_unitario: preco };
    set("itens", [...itens, novoItem]);
    setNewItemId("");
    setNewItemQtd(1);
  };

  const totalProdutos = itens.filter((i) => i.tipo === "produto").reduce((acc, i) => acc + i.preco_unitario * i.quantidade, 0);
  const totalServicos = itens.filter((i) => i.tipo === "servico").reduce((acc, i) => acc + i.preco_unitario * i.quantidade, 0);
  const subtotal = totalProdutos + totalServicos;
  const desconto = form.desconto ?? 0;
  const precoFinal = Math.max(0, subtotal - desconto);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try { await onSave({ ...form, total_produtos: totalProdutos, total_servicos: totalServicos, subtotal, preco_final: precoFinal }); }
    finally { setSaving(false); }
  };

  const available = newItemTipo === "produto" ? produtos.filter((p) => p.ativo) : servicos.filter((s) => s.ativo);

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-2xl shadow-xl flex flex-col max-h-[92vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800">
          <h2 className="font-bold text-gray-900 dark:text-white">{item?.id ? "Editar Combo" : "Novo Combo"}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400"><X size={18} /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Nome do combo *</label>
              <input required value={form.nome ?? ""} onChange={(e) => set("nome", e.target.value)} placeholder="Ex: Newborn + Álbum + Pendrive"
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 outline-none focus:border-gold-400" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Desconto (R$)</label>
              <input type="number" min={0} step="0.01" value={form.desconto ?? 0} onChange={(e) => set("desconto", parseFloat(e.target.value) || 0)}
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 outline-none focus:border-gold-400" />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 cursor-pointer pb-2">
                <input type="checkbox" checked={form.ativo ?? true} onChange={(e) => set("ativo", e.target.checked)} className="w-4 h-4 accent-gold-500" />
                <span className="text-sm text-gray-700 dark:text-gray-300">Combo ativo</span>
              </label>
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">Itens do combo</p>
            <div className="flex gap-2 mb-3">
              <select value={newItemTipo} onChange={(e) => { setNewItemTipo(e.target.value as "produto" | "servico"); setNewItemId(""); }}
                className="px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 outline-none focus:border-gold-400 flex-shrink-0">
                <option value="servico">Serviço</option>
                <option value="produto">Produto</option>
              </select>
              <select value={newItemId} onChange={(e) => setNewItemId(e.target.value)}
                className="flex-1 px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 outline-none focus:border-gold-400">
                <option value="">Selecionar...</option>
                {available.map((i) => <option key={i.id} value={i.id}>{i.nome}</option>)}
              </select>
              <input type="number" min={1} value={newItemQtd} onChange={(e) => setNewItemQtd(parseInt(e.target.value) || 1)}
                className="w-16 px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 outline-none focus:border-gold-400 text-center" />
              <button type="button" onClick={addItem} disabled={!newItemId}
                className="px-3 py-2 rounded-xl bg-gold-600 hover:bg-gold-700 disabled:opacity-40 text-white text-sm font-medium">
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
          <div className="rounded-xl bg-gray-50 dark:bg-gray-800/60 p-4 space-y-2 text-sm">
            <div className="flex justify-between text-gray-500 dark:text-gray-400"><span>Serviços</span><span>R$ {totalServicos.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</span></div>
            <div className="flex justify-between text-gray-500 dark:text-gray-400"><span>Produtos</span><span>R$ {totalProdutos.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</span></div>
            {desconto > 0 && <div className="flex justify-between text-red-500 dark:text-red-400"><span>Desconto</span><span>- R$ {desconto.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</span></div>}
            <div className="flex justify-between font-bold text-gray-900 dark:text-white border-t border-gray-200 dark:border-gray-700 pt-2 mt-1">
              <span>Total do combo</span>
              <span className="text-gold-600">R$ {precoFinal.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</span>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Descrição</label>
            <textarea rows={2} value={form.descricao ?? ""} onChange={(e) => set("descricao", e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 outline-none focus:border-gold-400 resize-none" />
          </div>
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-gray-100 dark:border-gray-800">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800">Cancelar</button>
          <button onClick={submit as unknown as React.MouseEventHandler} disabled={saving}
            className="px-5 py-2 text-sm rounded-xl bg-gold-600 hover:bg-gold-700 disabled:opacity-50 text-white font-medium flex items-center gap-2">
            {saving && <Loader2 size={14} className="animate-spin" />} Salvar
          </button>
        </div>
      </div>
    </div>
  );
}

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
      <div className="flex items-end gap-3 mt-3">
        <div>
          <p className="text-[10px] text-gray-400 uppercase tracking-wide">Valor do combo</p>
          <p className="text-2xl font-bold text-gold-600">R$ {combo.preco_final.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</p>
        </div>
        {combo.desconto > 0 && (
          <p className="text-xs text-gray-400 mb-1">(subtotal R$ {combo.subtotal.toLocaleString("pt-BR", { minimumFractionDigits: 2 })} − R$ {combo.desconto.toLocaleString("pt-BR", { minimumFractionDigits: 2 })})</p>
        )}
      </div>
      {combo.itens && combo.itens.length > 0 && (
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
// PÁGINA PRINCIPAL — CATÁLOGO
// ═══════════════════════════════════════════════════════════
export default function CatalogoPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const aba = (searchParams.get("aba") as Aba) ?? "produtos";
  const subAbaProdutos = (searchParams.get("sub") as SubAbaProdutos) ?? "produtos";

  const setAba = (a: Aba) => setSearchParams({ aba: a });
  const setSubAba = (s: SubAbaProdutos) => setSearchParams({ aba: "produtos", sub: s });

  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [fornecedores, setFornecedores] = useState<Fornecedor[]>([]);
  const [servicos, setServicos] = useState<Servico[]>([]);
  const [combos, setCombos] = useState<Combo[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const [editProduto, setEditProduto] = useState<Partial<Produto> | null | false>(false);
  const [editFornecedor, setEditFornecedor] = useState<Partial<Fornecedor> | null | false>(false);
  const [editServico, setEditServico] = useState<Partial<Servico> | null | false>(false);
  const [editCombo, setEditCombo] = useState<Partial<Combo> | null | false>(false);

  const load = async () => {
    setLoading(true);
    try {
      const [p, f, s, c] = await Promise.all([
        catalogoApi.getProdutos(),
        catalogoApi.getFornecedores(),
        catalogoApi.getServicos(),
        catalogoApi.getCombos(),
      ]);
      setProdutos(p);
      setFornecedores(f);
      setServicos(s);
      setCombos(c);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);
  useEffect(() => { setSearch(""); }, [aba, subAbaProdutos]);

  // ── Labels e botão "Novo" por aba ──
  const novoLabel = aba === "produtos"
    ? subAbaProdutos === "fornecedores" ? "Novo Fornecedor" : "Novo Produto"
    : aba === "servicos" ? "Novo Serviço" : "Novo Combo";

  const handleNovo = () => {
    if (aba === "produtos") {
      if (subAbaProdutos === "fornecedores") setEditFornecedor({});
      else setEditProduto({});
    } else if (aba === "servicos") {
      setEditServico({});
    } else {
      setEditCombo({});
    }
  };

  // ── Saves ──
  const saveProduto = async (d: Partial<Produto>) => {
    if (d.id) await catalogoApi.updateProduto(d.id, d); else await catalogoApi.createProduto(d);
    await load(); setEditProduto(false);
  };
  const saveFornecedor = async (d: Partial<Fornecedor>) => {
    if (d.id) await catalogoApi.updateFornecedor(d.id, d); else await catalogoApi.createFornecedor(d);
    await load(); setEditFornecedor(false);
  };
  const saveServico = async (d: Partial<Servico>) => {
    if (d.id) await catalogoApi.updateServico(d.id, d); else await catalogoApi.createServico(d);
    await load(); setEditServico(false);
  };
  const saveCombo = async (d: Partial<Combo>) => {
    if (d.id) await catalogoApi.updateCombo(d.id, d); else await catalogoApi.createCombo(d);
    await load(); setEditCombo(false);
  };

  // ── Dados filtrados ──
  const q = search.toLowerCase();
  const filtProdutos = produtos.filter((p) => !q || p.nome.toLowerCase().includes(q) || (p.fornecedor_nome ?? "").toLowerCase().includes(q));
  const filtFornecedores = fornecedores.filter((f) => !q || f.nome.toLowerCase().includes(q) || (f.email ?? "").toLowerCase().includes(q));
  const filtServicos = servicos.filter((s) => !q || s.nome.toLowerCase().includes(q) || (TIPO_ENSAIO_LABELS[s.tipo_ensaio] ?? "").toLowerCase().includes(q));
  const filtCombos = combos.filter((c) => !q || c.nome.toLowerCase().includes(q));

  const ABAS: { id: Aba; label: string; icon: React.ReactNode }[] = [
    { id: "produtos", label: "Produtos", icon: <Package size={15} /> },
    { id: "servicos", label: "Serviços", icon: <Briefcase size={15} /> },
    { id: "combos", label: "Combos", icon: <Layers size={15} /> },
  ];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-2xl font-bold text-gray-800 dark:text-white">Catálogo</h3>
          <p className="text-gray-500 dark:text-gray-400 text-sm">Produtos, serviços e combos do seu estúdio.</p>
        </div>
        <button onClick={handleNovo}
          className="flex items-center gap-2 px-4 py-2 bg-gold-600 hover:bg-gold-700 text-white text-sm font-medium rounded-xl transition-colors">
          <Plus size={16} />{novoLabel}
        </button>
      </div>

      {/* Abas principais */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex bg-gray-100 dark:bg-gray-800 p-1 rounded-xl gap-1 w-fit">
          {ABAS.map((a) => (
            <button key={a.id} onClick={() => setAba(a.id)}
              className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${aba === a.id
                ? "bg-white dark:bg-gray-700 text-gold-700 dark:text-gold-300 shadow-sm"
                : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
              }`}>
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
          {/* ─── ABA PRODUTOS ─── */}
          {aba === "produtos" && (
            <div>
              {/* Sub-abas Produtos / Fornecedores */}
              <div className="flex gap-1 mb-4 border-b border-gray-100 dark:border-gray-800">
                {(["produtos", "fornecedores"] as SubAbaProdutos[]).map((s) => (
                  <button key={s} onClick={() => setSubAba(s)}
                    className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${subAbaProdutos === s
                      ? "border-gold-500 text-gold-600 dark:text-gold-400"
                      : "border-transparent text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                    }`}>
                    {s === "produtos" ? "Produtos" : "Fornecedores"}
                  </button>
                ))}
              </div>

              {subAbaProdutos === "produtos" ? (
                <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 overflow-hidden">
                  {filtProdutos.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 gap-3 text-gray-400"><Package size={32} strokeWidth={1.5} /><p className="text-sm">Nenhum produto encontrado</p></div>
                  ) : (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-100 dark:border-gray-800">
                          <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Nome</th>
                          <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide hidden md:table-cell">Categoria</th>
                          <th className="text-right px-5 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Custo</th>
                          <th className="text-right px-5 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Venda</th>
                          <th className="text-right px-5 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide hidden sm:table-cell">Margem</th>
                          <th className="text-center px-5 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Status</th>
                          <th className="px-5 py-3" />
                        </tr>
                      </thead>
                      <tbody>
                        {filtProdutos.map((p) => (
                          <tr key={p.id} className="border-b border-gray-50 dark:border-gray-800/50 hover:bg-gray-50 dark:hover:bg-gray-800/30">
                            <td className="px-5 py-3">
                              <div className="font-medium text-gray-900 dark:text-white">{p.nome}</div>
                              {p.fornecedor_nome && <div className="text-xs text-gray-400 mt-0.5">{p.fornecedor_nome}</div>}
                            </td>
                            <td className="px-5 py-3 text-gray-500 dark:text-gray-400 hidden md:table-cell">{CATEGORIA_LABELS[p.categoria] ?? p.categoria}</td>
                            <td className="px-5 py-3 text-right text-gray-700 dark:text-gray-300">R$ {p.preco_custo.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</td>
                            <td className="px-5 py-3 text-right font-semibold text-gray-900 dark:text-white">R$ {p.preco_venda.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</td>
                            <td className="px-5 py-3 text-right hidden sm:table-cell">
                              {p.margem_lucro != null ? (
                                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${p.margem_lucro >= 30 ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400" : p.margem_lucro >= 10 ? "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400" : "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400"}`}>
                                  {p.margem_lucro.toFixed(1)}%
                                </span>
                              ) : "—"}
                            </td>
                            <td className="px-5 py-3 text-center">
                              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${p.ativo ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400" : "bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400"}`}>
                                {p.ativo ? "Ativo" : "Inativo"}
                              </span>
                            </td>
                            <td className="px-5 py-3">
                              <div className="flex items-center justify-end gap-1">
                                <button onClick={() => setEditProduto(p)} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-gold-600"><Pencil size={14} /></button>
                                <button onClick={async () => { if (!confirm("Excluir produto?")) return; await catalogoApi.deleteProduto(p.id); setProdutos((prev) => prev.filter((x) => x.id !== p.id)); }}
                                  className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-gray-400 hover:text-red-500"><Trash2 size={14} /></button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              ) : (
                <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 overflow-hidden">
                  {filtFornecedores.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 gap-3 text-gray-400"><Building2 size={32} strokeWidth={1.5} /><p className="text-sm">Nenhum fornecedor cadastrado</p></div>
                  ) : (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-100 dark:border-gray-800">
                          <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Nome</th>
                          <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide hidden md:table-cell">Contato</th>
                          <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide hidden lg:table-cell">CNPJ</th>
                          <th className="text-center px-5 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide hidden sm:table-cell">Prazo</th>
                          <th className="px-5 py-3" />
                        </tr>
                      </thead>
                      <tbody>
                        {filtFornecedores.map((f) => (
                          <tr key={f.id} className="border-b border-gray-50 dark:border-gray-800/50 hover:bg-gray-50 dark:hover:bg-gray-800/30">
                            <td className="px-5 py-3">
                              <div className="font-medium text-gray-900 dark:text-white">{f.nome}</div>
                              {f.email && <div className="text-xs text-gray-400 mt-0.5">{f.email}</div>}
                            </td>
                            <td className="px-5 py-3 text-gray-500 dark:text-gray-400 hidden md:table-cell">{f.contato || f.whatsapp || "—"}</td>
                            <td className="px-5 py-3 text-gray-500 dark:text-gray-400 hidden lg:table-cell">{f.cnpj || "—"}</td>
                            <td className="px-5 py-3 text-center text-gray-500 dark:text-gray-400 hidden sm:table-cell">{f.prazo_entrega ? `${f.prazo_entrega}d` : "—"}</td>
                            <td className="px-5 py-3">
                              <div className="flex items-center justify-end gap-1">
                                <button onClick={() => setEditFornecedor(f)} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-gold-600"><Pencil size={14} /></button>
                                <button onClick={async () => { if (!confirm("Excluir fornecedor?")) return; await catalogoApi.deleteFornecedor(f.id); setFornecedores((prev) => prev.filter((x) => x.id !== f.id)); }}
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

          {/* ─── ABA SERVIÇOS ─── */}
          {aba === "servicos" && (
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 overflow-hidden">
              {filtServicos.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 gap-3 text-gray-400"><Briefcase size={32} strokeWidth={1.5} /><p className="text-sm">Nenhum serviço encontrado</p></div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 dark:border-gray-800">
                      <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Nome</th>
                      <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide hidden md:table-cell">Tipo</th>
                      <th className="text-right px-5 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Preço base</th>
                      <th className="text-center px-5 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide hidden sm:table-cell">Edição</th>
                      <th className="text-center px-5 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide hidden lg:table-cell">Fotos</th>
                      <th className="text-center px-5 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Status</th>
                      <th className="px-5 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {filtServicos.map((s) => (
                      <tr key={s.id} className="border-b border-gray-50 dark:border-gray-800/50 hover:bg-gray-50 dark:hover:bg-gray-800/30">
                        <td className="px-5 py-3">
                          <div className="font-medium text-gray-900 dark:text-white">{s.nome}</div>
                          {s.descricao && <div className="text-xs text-gray-400 mt-0.5 truncate max-w-[200px]">{s.descricao}</div>}
                        </td>
                        <td className="px-5 py-3 text-gray-500 dark:text-gray-400 hidden md:table-cell">{TIPO_ENSAIO_LABELS[s.tipo_ensaio] ?? s.tipo_ensaio}</td>
                        <td className="px-5 py-3 text-right font-semibold text-gray-900 dark:text-white">R$ {s.preco_base.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</td>
                        <td className="px-5 py-3 text-center hidden sm:table-cell">
                          {s.inclui_edicao ? <CheckCircle size={16} className="mx-auto text-green-500" /> : <XCircle size={16} className="mx-auto text-gray-300 dark:text-gray-600" />}
                        </td>
                        <td className="px-5 py-3 text-center text-gray-500 dark:text-gray-400 hidden lg:table-cell">{s.qtd_fotos_entrega ?? "—"}</td>
                        <td className="px-5 py-3 text-center">
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${s.ativo ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400" : "bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400"}`}>
                            {s.ativo ? "Ativo" : "Inativo"}
                          </span>
                        </td>
                        <td className="px-5 py-3">
                          <div className="flex items-center justify-end gap-1">
                            <button onClick={() => setEditServico(s)} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-gold-600"><Pencil size={14} /></button>
                            <button onClick={async () => { if (!confirm("Excluir serviço?")) return; await catalogoApi.deleteServico(s.id); setServicos((prev) => prev.filter((x) => x.id !== s.id)); }}
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

          {/* ─── ABA COMBOS ─── */}
          {aba === "combos" && (
            filtCombos.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 gap-3 text-gray-400"><Layers size={32} strokeWidth={1.5} /><p className="text-sm">Nenhum combo encontrado</p></div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {filtCombos.map((c) => (
                  <ComboCard key={c.id} combo={c} onEdit={() => setEditCombo(c)}
                    onDelete={async () => { if (!confirm("Excluir combo?")) return; await catalogoApi.deleteCombo(c.id); setCombos((prev) => prev.filter((x) => x.id !== c.id)); }} />
                ))}
              </div>
            )
          )}
        </>
      )}

      {/* Modais */}
      {editProduto !== false && <ProdutoModal item={editProduto} fornecedores={fornecedores} onSave={saveProduto} onClose={() => setEditProduto(false)} />}
      {editFornecedor !== false && <FornecedorModal item={editFornecedor} onSave={saveFornecedor} onClose={() => setEditFornecedor(false)} />}
      {editServico !== false && <ServicoModal item={editServico} onSave={saveServico} onClose={() => setEditServico(false)} />}
      {editCombo !== false && <ComboModal item={editCombo} produtos={produtos} servicos={servicos} onSave={saveCombo} onClose={() => setEditCombo(false)} />}
    </div>
  );
}

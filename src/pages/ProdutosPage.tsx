import React, { useEffect, useState } from "react";
import {
  Package,
  Plus,
  Search,
  Pencil,
  Trash2,
  X,
  ChevronDown,
  Building2,
  Loader2,
} from "lucide-react";
import { catalogoApi } from "../services/api/catalogo";
import {
  Produto,
  Fornecedor,
  CategoriaProduto,
  CATEGORIA_LABELS,
  UnidadeProduto,
} from "../types";

const UNIDADES: UnidadeProduto[] = ["un", "cx", "pct", "par", "kit"];
const CATEGORIAS = Object.entries(CATEGORIA_LABELS) as [CategoriaProduto, string][];

const EMPTY_PRODUTO: Partial<Produto> = {
  nome: "",
  descricao: "",
  categoria: "outros",
  preco_custo: 0,
  preco_venda: 0,
  unidade: "un",
  estoque: 0,
  ativo: true,
};

const EMPTY_FORNECEDOR: Partial<Fornecedor> = {
  nome: "",
  cnpj: "",
  contato: "",
  whatsapp: "",
  email: "",
  prazo_entrega: undefined,
  observacoes: "",
};

// ── Modal de produto ─────────────────────────────────────────────────────────
function ProdutoModal({
  item,
  fornecedores,
  onSave,
  onClose,
}: {
  item: Partial<Produto> | null;
  fornecedores: Fornecedor[];
  onSave: (data: Partial<Produto>) => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState<Partial<Produto>>(item ?? EMPTY_PRODUTO);
  const [saving, setSaving] = useState(false);

  const set = (k: keyof Produto, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

  const margem =
    form.preco_venda && form.preco_custo && form.preco_custo > 0
      ? (((form.preco_venda - form.preco_custo) / form.preco_custo) * 100).toFixed(1)
      : "—";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave(form);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-lg shadow-xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800">
          <h2 className="font-bold text-gray-900 dark:text-white">
            {item?.id ? "Editar Produto" : "Novo Produto"}
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {/* Nome */}
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Nome *</label>
            <input
              required
              value={form.nome ?? ""}
              onChange={(e) => set("nome", e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 outline-none focus:border-gold-400"
            />
          </div>

          {/* Categoria + Unidade */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Categoria</label>
              <select
                value={form.categoria}
                onChange={(e) => set("categoria", e.target.value as CategoriaProduto)}
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 outline-none focus:border-gold-400"
              >
                {CATEGORIAS.map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Unidade</label>
              <select
                value={form.unidade}
                onChange={(e) => set("unidade", e.target.value as UnidadeProduto)}
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 outline-none focus:border-gold-400"
              >
                {UNIDADES.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
          </div>

          {/* Preços */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Custo (R$)</label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={form.preco_custo ?? 0}
                onChange={(e) => set("preco_custo", parseFloat(e.target.value) || 0)}
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 outline-none focus:border-gold-400"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Venda (R$)</label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={form.preco_venda ?? 0}
                onChange={(e) => set("preco_venda", parseFloat(e.target.value) || 0)}
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 outline-none focus:border-gold-400"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Margem</label>
              <div className="px-3 py-2 text-sm rounded-xl bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-700">
                {margem !== "—" ? `${margem}%` : "—"}
              </div>
            </div>
          </div>

          {/* Fornecedor + Estoque */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Fornecedor</label>
              <select
                value={form.fornecedor_id ?? ""}
                onChange={(e) => set("fornecedor_id", e.target.value || undefined)}
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 outline-none focus:border-gold-400"
              >
                <option value="">Nenhum</option>
                {fornecedores.map((f) => (
                  <option key={f.id} value={f.id}>{f.nome}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Estoque</label>
              <input
                type="number"
                min={0}
                value={form.estoque ?? 0}
                onChange={(e) => set("estoque", parseInt(e.target.value) || 0)}
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 outline-none focus:border-gold-400"
              />
            </div>
          </div>

          {/* Descrição */}
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Descrição</label>
            <textarea
              rows={2}
              value={form.descricao ?? ""}
              onChange={(e) => set("descricao", e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 outline-none focus:border-gold-400 resize-none"
            />
          </div>

          {/* Ativo */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={form.ativo ?? true}
              onChange={(e) => set("ativo", e.target.checked)}
              className="w-4 h-4 accent-gold-500"
            />
            <span className="text-sm text-gray-700 dark:text-gray-300">Produto ativo</span>
          </label>
        </form>

        <div className="flex justify-end gap-2 px-6 py-4 border-t border-gray-100 dark:border-gray-800">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800">
            Cancelar
          </button>
          <button
            onClick={handleSubmit as unknown as React.MouseEventHandler}
            disabled={saving}
            className="px-5 py-2 text-sm rounded-xl bg-gold-600 hover:bg-gold-700 disabled:opacity-50 text-white font-medium flex items-center gap-2"
          >
            {saving && <Loader2 size={14} className="animate-spin" />}
            Salvar
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Modal de fornecedor ──────────────────────────────────────────────────────
function FornecedorModal({
  item,
  onSave,
  onClose,
}: {
  item: Partial<Fornecedor> | null;
  onSave: (data: Partial<Fornecedor>) => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState<Partial<Fornecedor>>(item ?? EMPTY_FORNECEDOR);
  const [saving, setSaving] = useState(false);

  const set = (k: keyof Fornecedor, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave(form);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-md shadow-xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800">
          <h2 className="font-bold text-gray-900 dark:text-white">
            {item?.id ? "Editar Fornecedor" : "Novo Fornecedor"}
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Nome *</label>
            <input
              required
              value={form.nome ?? ""}
              onChange={(e) => set("nome", e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 outline-none focus:border-gold-400"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">CNPJ</label>
              <input
                value={form.cnpj ?? ""}
                onChange={(e) => set("cnpj", e.target.value)}
                placeholder="00.000.000/0001-00"
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 outline-none focus:border-gold-400"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Prazo entrega (dias)</label>
              <input
                type="number"
                min={0}
                value={form.prazo_entrega ?? ""}
                onChange={(e) => set("prazo_entrega", e.target.value ? parseInt(e.target.value) : undefined)}
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 outline-none focus:border-gold-400"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Contato</label>
            <input
              value={form.contato ?? ""}
              onChange={(e) => set("contato", e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 outline-none focus:border-gold-400"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">WhatsApp</label>
              <input
                value={form.whatsapp ?? ""}
                onChange={(e) => set("whatsapp", e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 outline-none focus:border-gold-400"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">E-mail</label>
              <input
                type="email"
                value={form.email ?? ""}
                onChange={(e) => set("email", e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 outline-none focus:border-gold-400"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Observações</label>
            <textarea
              rows={2}
              value={form.observacoes ?? ""}
              onChange={(e) => set("observacoes", e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 outline-none focus:border-gold-400 resize-none"
            />
          </div>
        </form>

        <div className="flex justify-end gap-2 px-6 py-4 border-t border-gray-100 dark:border-gray-800">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800">
            Cancelar
          </button>
          <button
            onClick={handleSubmit as unknown as React.MouseEventHandler}
            disabled={saving}
            className="px-5 py-2 text-sm rounded-xl bg-gold-600 hover:bg-gold-700 disabled:opacity-50 text-white font-medium flex items-center gap-2"
          >
            {saving && <Loader2 size={14} className="animate-spin" />}
            Salvar
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Página principal ─────────────────────────────────────────────────────────
type Tab = "produtos" | "fornecedores";

export default function ProdutosPage() {
  const [tab, setTab] = useState<Tab>("produtos");
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [fornecedores, setFornecedores] = useState<Fornecedor[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const [editingProduto, setEditingProduto] = useState<Partial<Produto> | null | false>(false);
  const [editingFornecedor, setEditingFornecedor] = useState<Partial<Fornecedor> | null | false>(false);

  const load = async () => {
    setLoading(true);
    try {
      const [p, f] = await Promise.all([
        catalogoApi.getProdutos(),
        catalogoApi.getFornecedores(),
      ]);
      setProdutos(p);
      setFornecedores(f);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const filteredProdutos = produtos.filter((p) => {
    const q = search.toLowerCase();
    return !q || p.nome.toLowerCase().includes(q) || (p.fornecedor_nome ?? "").toLowerCase().includes(q);
  });

  const filteredFornecedores = fornecedores.filter((f) => {
    const q = search.toLowerCase();
    return !q || f.nome.toLowerCase().includes(q) || (f.email ?? "").toLowerCase().includes(q);
  });

  const handleSaveProduto = async (data: Partial<Produto>) => {
    if (data.id) {
      await catalogoApi.updateProduto(data.id, data);
    } else {
      await catalogoApi.createProduto(data);
    }
    await load();
    setEditingProduto(false);
  };

  const handleDeleteProduto = async (id: string) => {
    if (!confirm("Excluir este produto?")) return;
    await catalogoApi.deleteProduto(id);
    setProdutos((prev) => prev.filter((p) => p.id !== id));
  };

  const handleSaveFornecedor = async (data: Partial<Fornecedor>) => {
    if (data.id) {
      await catalogoApi.updateFornecedor(data.id, data);
    } else {
      await catalogoApi.createFornecedor(data);
    }
    await load();
    setEditingFornecedor(false);
  };

  const handleDeleteFornecedor = async (id: string) => {
    if (!confirm("Excluir este fornecedor?")) return;
    await catalogoApi.deleteFornecedor(id);
    setFornecedores((prev) => prev.filter((f) => f.id !== id));
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-2xl font-bold text-gray-800 dark:text-white">Produtos</h3>
          <p className="text-gray-500 dark:text-gray-400 text-sm">Catálogo de produtos físicos e fornecedores.</p>
        </div>
        <button
          onClick={() => tab === "produtos" ? setEditingProduto({}) : setEditingFornecedor({})}
          className="flex items-center gap-2 px-4 py-2 bg-gold-600 hover:bg-gold-700 text-white text-sm font-medium rounded-xl transition-colors"
        >
          <Plus size={16} />
          {tab === "produtos" ? "Novo Produto" : "Novo Fornecedor"}
        </button>
      </div>

      {/* Tabs + Search */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex bg-gray-100 dark:bg-gray-800 p-1 rounded-xl gap-1">
          {(["produtos", "fornecedores"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => { setTab(t); setSearch(""); }}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors capitalize ${
                tab === t
                  ? "bg-white dark:bg-gray-700 text-gold-700 dark:text-gold-300 shadow-sm"
                  : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
              }`}
            >
              {t === "produtos" ? "Produtos" : "Fornecedores"}
            </button>
          ))}
        </div>

        <div className="relative flex-1 max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            placeholder="Buscar..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 placeholder-gray-400 focus:border-gold-400 outline-none"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center h-48">
          <Loader2 size={24} className="animate-spin text-gold-500" />
        </div>
      ) : tab === "produtos" ? (
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 overflow-hidden">
          {filteredProdutos.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-gray-400">
              <Package size={32} strokeWidth={1.5} />
              <p className="text-sm">Nenhum produto encontrado</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 dark:border-gray-800">
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Nome</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide hidden md:table-cell">Categoria</th>
                  <th className="text-right px-5 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Custo</th>
                  <th className="text-right px-5 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Venda</th>
                  <th className="text-right px-5 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide hidden sm:table-cell">Margem</th>
                  <th className="text-center px-5 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide hidden lg:table-cell">Estoque</th>
                  <th className="text-center px-5 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Status</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody>
                {filteredProdutos.map((p) => (
                  <tr key={p.id} className="border-b border-gray-50 dark:border-gray-800/50 hover:bg-gray-50 dark:hover:bg-gray-800/30">
                    <td className="px-5 py-3">
                      <div className="font-medium text-gray-900 dark:text-white">{p.nome}</div>
                      {p.fornecedor_nome && (
                        <div className="text-xs text-gray-400 mt-0.5">{p.fornecedor_nome}</div>
                      )}
                    </td>
                    <td className="px-5 py-3 text-gray-500 dark:text-gray-400 hidden md:table-cell">
                      {CATEGORIA_LABELS[p.categoria] ?? p.categoria}
                    </td>
                    <td className="px-5 py-3 text-right text-gray-700 dark:text-gray-300">
                      R$ {p.preco_custo.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-5 py-3 text-right font-semibold text-gray-900 dark:text-white">
                      R$ {p.preco_venda.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-5 py-3 text-right hidden sm:table-cell">
                      {p.margem_lucro != null ? (
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${p.margem_lucro >= 30 ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400" : p.margem_lucro >= 10 ? "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400" : "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400"}`}>
                          {p.margem_lucro.toFixed(1)}%
                        </span>
                      ) : "—"}
                    </td>
                    <td className="px-5 py-3 text-center text-gray-500 dark:text-gray-400 hidden lg:table-cell">
                      {p.estoque ?? "—"} {p.unidade}
                    </td>
                    <td className="px-5 py-3 text-center">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${p.ativo ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400" : "bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400"}`}>
                        {p.ativo ? "Ativo" : "Inativo"}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => setEditingProduto(p)}
                          className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-gold-600"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={() => handleDeleteProduto(p.id)}
                          className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-gray-400 hover:text-red-500"
                        >
                          <Trash2 size={14} />
                        </button>
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
          {filteredFornecedores.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-gray-400">
              <Building2 size={32} strokeWidth={1.5} />
              <p className="text-sm">Nenhum fornecedor cadastrado</p>
            </div>
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
                {filteredFornecedores.map((f) => (
                  <tr key={f.id} className="border-b border-gray-50 dark:border-gray-800/50 hover:bg-gray-50 dark:hover:bg-gray-800/30">
                    <td className="px-5 py-3">
                      <div className="font-medium text-gray-900 dark:text-white">{f.nome}</div>
                      {f.email && <div className="text-xs text-gray-400 mt-0.5">{f.email}</div>}
                    </td>
                    <td className="px-5 py-3 text-gray-500 dark:text-gray-400 hidden md:table-cell">
                      {f.contato || f.whatsapp || "—"}
                    </td>
                    <td className="px-5 py-3 text-gray-500 dark:text-gray-400 hidden lg:table-cell">
                      {f.cnpj || "—"}
                    </td>
                    <td className="px-5 py-3 text-center text-gray-500 dark:text-gray-400 hidden sm:table-cell">
                      {f.prazo_entrega ? `${f.prazo_entrega}d` : "—"}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => setEditingFornecedor(f)}
                          className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-gold-600"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={() => handleDeleteFornecedor(f.id)}
                          className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-gray-400 hover:text-red-500"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Modais */}
      {editingProduto !== false && (
        <ProdutoModal
          item={editingProduto}
          fornecedores={fornecedores}
          onSave={handleSaveProduto}
          onClose={() => setEditingProduto(false)}
        />
      )}
      {editingFornecedor !== false && (
        <FornecedorModal
          item={editingFornecedor}
          onSave={handleSaveFornecedor}
          onClose={() => setEditingFornecedor(false)}
        />
      )}
    </div>
  );
}

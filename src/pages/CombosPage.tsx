import React, { useEffect, useState } from "react";
import {
  Layers,
  Plus,
  Search,
  Pencil,
  Trash2,
  X,
  Loader2,
  Package,
  Briefcase,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { catalogoApi } from "../services/api/catalogo";
import { Combo, ComboItem, Produto, Servico, TIPO_ENSAIO_LABELS, CATEGORIA_LABELS } from "../types";

type NewItem = { tipo: "produto" | "servico"; item_id: string; quantidade: number };

const EMPTY_COMBO: Partial<Combo> = {
  nome: "",
  descricao: "",
  desconto: 0,
  itens: [],
  ativo: true,
};

// ── Modal de combo ───────────────────────────────────────────────────────────
function ComboModal({
  item,
  produtos,
  servicos,
  onSave,
  onClose,
}: {
  item: Partial<Combo> | null;
  produtos: Produto[];
  servicos: Servico[];
  onSave: (data: Partial<Combo>) => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState<Partial<Combo>>(item ?? EMPTY_COMBO);
  const [saving, setSaving] = useState(false);
  const [newItem, setNewItem] = useState<NewItem>({ tipo: "servico", item_id: "", quantidade: 1 });

  const set = (k: keyof Combo, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

  const itens = form.itens ?? [];

  const addItem = () => {
    if (!newItem.item_id) return;
    const found =
      newItem.tipo === "produto"
        ? produtos.find((p) => p.id === newItem.item_id)
        : servicos.find((s) => s.id === newItem.item_id);
    if (!found) return;

    const preco = newItem.tipo === "produto"
      ? (found as Produto).preco_venda
      : (found as Servico).preco_base;

    const novoItem: ComboItem = {
      id: `new-${Date.now()}`,
      combo_id: form.id ?? "",
      tipo: newItem.tipo,
      item_id: newItem.item_id,
      nome: found.nome,
      quantidade: newItem.quantidade,
      preco_unitario: preco,
    };

    set("itens", [...itens, novoItem]);
    setNewItem({ tipo: "servico", item_id: "", quantidade: 1 });
  };

  const removeItem = (id: string) => {
    set("itens", itens.filter((i) => i.id !== id));
  };

  const totalProdutos = itens
    .filter((i) => i.tipo === "produto")
    .reduce((acc, i) => acc + i.preco_unitario * i.quantidade, 0);

  const totalServicos = itens
    .filter((i) => i.tipo === "servico")
    .reduce((acc, i) => acc + i.preco_unitario * i.quantidade, 0);

  const subtotal = totalProdutos + totalServicos;
  const desconto = form.desconto ?? 0;
  const precoFinal = Math.max(0, subtotal - desconto);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave({
        ...form,
        total_produtos: totalProdutos,
        total_servicos: totalServicos,
        subtotal,
        preco_final: precoFinal,
      });
    } finally {
      setSaving(false);
    }
  };

  const availableItems = newItem.tipo === "produto"
    ? produtos.filter((p) => p.ativo)
    : servicos.filter((s) => s.ativo);

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-2xl shadow-xl flex flex-col max-h-[92vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800">
          <h2 className="font-bold text-gray-900 dark:text-white">
            {item?.id ? "Editar Combo" : "Novo Combo"}
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          {/* Info básica */}
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Nome do combo *</label>
              <input
                required
                value={form.nome ?? ""}
                onChange={(e) => set("nome", e.target.value)}
                placeholder="Ex: Newborn + Álbum + Pendrive"
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 outline-none focus:border-gold-400"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Desconto (R$)</label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={form.desconto ?? 0}
                onChange={(e) => set("desconto", parseFloat(e.target.value) || 0)}
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 outline-none focus:border-gold-400"
              />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 cursor-pointer pb-2">
                <input
                  type="checkbox"
                  checked={form.ativo ?? true}
                  onChange={(e) => set("ativo", e.target.checked)}
                  className="w-4 h-4 accent-gold-500"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">Combo ativo</span>
              </label>
            </div>
          </div>

          {/* Itens do combo */}
          <div>
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">Itens do combo</p>

            {/* Adicionar item */}
            <div className="flex gap-2 mb-3">
              <select
                value={newItem.tipo}
                onChange={(e) => setNewItem({ tipo: e.target.value as "produto" | "servico", item_id: "", quantidade: 1 })}
                className="px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 outline-none focus:border-gold-400 flex-shrink-0"
              >
                <option value="servico">Serviço</option>
                <option value="produto">Produto</option>
              </select>
              <select
                value={newItem.item_id}
                onChange={(e) => setNewItem((n) => ({ ...n, item_id: e.target.value }))}
                className="flex-1 px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 outline-none focus:border-gold-400"
              >
                <option value="">Selecionar...</option>
                {availableItems.map((i) => (
                  <option key={i.id} value={i.id}>{i.nome}</option>
                ))}
              </select>
              <input
                type="number"
                min={1}
                value={newItem.quantidade}
                onChange={(e) => setNewItem((n) => ({ ...n, quantidade: parseInt(e.target.value) || 1 }))}
                className="w-16 px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 outline-none focus:border-gold-400 text-center"
              />
              <button
                type="button"
                onClick={addItem}
                disabled={!newItem.item_id}
                className="px-3 py-2 rounded-xl bg-gold-600 hover:bg-gold-700 disabled:opacity-40 text-white text-sm font-medium"
              >
                <Plus size={16} />
              </button>
            </div>

            {/* Lista de itens */}
            {itens.length === 0 ? (
              <div className="flex items-center justify-center py-6 rounded-xl border border-dashed border-gray-200 dark:border-gray-700 text-gray-400 text-sm">
                Nenhum item adicionado
              </div>
            ) : (
              <div className="space-y-1.5">
                {itens.map((item) => (
                  <div key={item.id} className="flex items-center gap-3 px-3 py-2 rounded-xl bg-gray-50 dark:bg-gray-800">
                    {item.tipo === "produto"
                      ? <Package size={14} className="text-blue-400 flex-shrink-0" />
                      : <Briefcase size={14} className="text-gold-500 flex-shrink-0" />
                    }
                    <span className="flex-1 text-sm text-gray-800 dark:text-gray-200">{item.nome}</span>
                    <span className="text-xs text-gray-400">×{item.quantidade}</span>
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300 min-w-[80px] text-right">
                      R$ {(item.preco_unitario * item.quantidade).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeItem(item.id)}
                      className="p-1 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-gray-400 hover:text-red-500"
                    >
                      <X size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Resumo de preços */}
          <div className="rounded-xl bg-gray-50 dark:bg-gray-800/60 p-4 space-y-2 text-sm">
            <div className="flex justify-between text-gray-500 dark:text-gray-400">
              <span>Serviços</span>
              <span>R$ {totalServicos.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</span>
            </div>
            <div className="flex justify-between text-gray-500 dark:text-gray-400">
              <span>Produtos</span>
              <span>R$ {totalProdutos.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</span>
            </div>
            {desconto > 0 && (
              <div className="flex justify-between text-red-500 dark:text-red-400">
                <span>Desconto</span>
                <span>- R$ {desconto.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</span>
              </div>
            )}
            <div className="flex justify-between font-bold text-gray-900 dark:text-white border-t border-gray-200 dark:border-gray-700 pt-2 mt-1">
              <span>Total do combo</span>
              <span className="text-gold-600">R$ {precoFinal.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</span>
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
        </div>

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

// ── Card de combo ─────────────────────────────────────────────────────────
const ComboCard: React.FC<{
  combo: Combo;
  onEdit: () => void;
  onDelete: () => void | Promise<void>;
}> = ({ combo, onEdit, onDelete }) => {
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
          {combo.descricao && (
            <p className="text-xs text-gray-400 mt-0.5 line-clamp-1">{combo.descricao}</p>
          )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button onClick={onEdit} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-gold-600">
            <Pencil size={14} />
          </button>
          <button onClick={onDelete} className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-gray-400 hover:text-red-500">
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* Preço */}
      <div className="flex items-end gap-3 mt-3">
        <div>
          <p className="text-[10px] text-gray-400 uppercase tracking-wide">Valor do combo</p>
          <p className="text-2xl font-bold text-gold-600">
            R$ {combo.preco_final.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
          </p>
        </div>
        {combo.desconto > 0 && (
          <p className="text-xs text-gray-400 mb-1">
            (subtotal R$ {combo.subtotal.toLocaleString("pt-BR", { minimumFractionDigits: 2 })} − desconto R$ {combo.desconto.toLocaleString("pt-BR", { minimumFractionDigits: 2 })})
          </p>
        )}
      </div>

      {/* Itens colapsáveis */}
      {combo.itens && combo.itens.length > 0 && (
        <div className="mt-3 border-t border-gray-100 dark:border-gray-800 pt-3">
          <button
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
          >
            {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            {combo.itens.length} {combo.itens.length === 1 ? "item" : "itens"}
          </button>
          {expanded && (
            <div className="mt-2 space-y-1">
              {combo.itens.map((item) => (
                <div key={item.id} className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                  {item.tipo === "produto"
                    ? <Package size={12} className="text-blue-400" />
                    : <Briefcase size={12} className="text-gold-500" />
                  }
                  <span className="flex-1">{item.nome}</span>
                  <span>×{item.quantidade}</span>
                  <span className="font-medium">R$ {(item.preco_unitario * item.quantidade).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Página ─────────────────────────────────────────────────────────────────
export default function CombosPage() {
  const [combos, setCombos] = useState<Combo[]>([]);
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [servicos, setServicos] = useState<Servico[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Partial<Combo> | null | false>(false);

  const load = async () => {
    setLoading(true);
    try {
      const [c, p, s] = await Promise.all([
        catalogoApi.getCombos(),
        catalogoApi.getProdutos(),
        catalogoApi.getServicos(),
      ]);
      setCombos(c);
      setProdutos(p);
      setServicos(s);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const filtered = combos.filter((c) => {
    const q = search.toLowerCase();
    return !q || c.nome.toLowerCase().includes(q);
  });

  const handleSave = async (data: Partial<Combo>) => {
    if (data.id) {
      await catalogoApi.updateCombo(data.id, data);
    } else {
      await catalogoApi.createCombo(data);
    }
    await load();
    setEditing(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Excluir este combo?")) return;
    await catalogoApi.deleteCombo(id);
    setCombos((prev) => prev.filter((c) => c.id !== id));
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-2xl font-bold text-gray-800 dark:text-white">Combos</h3>
          <p className="text-gray-500 dark:text-gray-400 text-sm">Pacotes com serviços e produtos agrupados.</p>
        </div>
        <button
          onClick={() => setEditing({})}
          className="flex items-center gap-2 px-4 py-2 bg-gold-600 hover:bg-gold-700 text-white text-sm font-medium rounded-xl transition-colors"
        >
          <Plus size={16} />
          Novo Combo
        </button>
      </div>

      {/* Search */}
      <div className="relative max-w-xs">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        <input
          placeholder="Buscar combo..."
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

      {/* Grid */}
      {loading ? (
        <div className="flex items-center justify-center h-48">
          <Loader2 size={24} className="animate-spin text-gold-500" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3 text-gray-400">
          <Layers size={32} strokeWidth={1.5} />
          <p className="text-sm">Nenhum combo encontrado</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((combo) => (
            <ComboCard
              key={combo.id}
              combo={combo}
              onEdit={() => setEditing(combo)}
              onDelete={() => handleDelete(combo.id)}
            />
          ))}
        </div>
      )}

      {editing !== false && (
        <ComboModal
          item={editing}
          produtos={produtos}
          servicos={servicos}
          onSave={handleSave}
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  );
}

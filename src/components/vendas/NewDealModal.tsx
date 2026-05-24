import React, { useEffect, useMemo, useState } from "react";
import { Plus, Search, X, Trash2, Package, Tag, Layers } from "lucide-react";
import { PipelineStage, Client, DealPriority } from "../../types";
import { authFetch } from "../../utils/authFetch";
import { useApi } from "../../utils/useApi";
import { SearchableSelect } from "../ui/SearchableSelect";
import { cn } from "../../utils/cn";
import { normalizeText } from "../../utils/normalizeText";
import { useSellers } from "../../hooks/useSellers";
import { SellerPicker } from "./SellerPicker";

interface NewDealModalProps {
  open: boolean;
  stages: PipelineStage[];
  clients: Client[];
  onClose: () => void;
  onCreated: (options?: { silent?: boolean }) => void | Promise<void>;
}

type CatalogType = "combo" | "produto" | "servico";

interface CatalogItem {
  id: string;
  nome: string;
  value: number;
}

interface PendingItem {
  catalog_type: CatalogType;
  catalog_id: string;
  catalog_name: string;
  catalog_value: number;
  quantidade: number;
}

const CATALOG_LABELS: Record<CatalogType, string> = {
  combo: "Combos",
  produto: "Produtos",
  servico: "Serviços",
};

const CATALOG_ICONS: Record<CatalogType, React.ReactNode> = {
  combo: <Layers size={11} />,
  produto: <Package size={11} />,
  servico: <Tag size={11} />,
};

export function NewDealModal({ open, stages, clients, onClose, onCreated }: NewDealModalProps) {
  const { sellers, currentMemberId } = useSellers();
  const [form, setForm] = useState({
    title: "",
    client_id: "",
    value: "",
    expected_close_date: "",
    priority: "medium" as DealPriority,
    stage: stages[0]?.id || "",
    notes: "",
    assigned_to: null as string | null,
  });
  const [items, setItems] = useState<PendingItem[]>([]);
  const [loading, setLoading] = useState(false);

  // Quando o modal abre e ainda não tem responsável, usa o usuário logado como default
  useEffect(() => {
    if (open && !form.assigned_to && currentMemberId) {
      setForm(f => ({ ...f, assigned_to: currentMemberId }));
    }
  }, [open, currentMemberId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Catálogos via SWR - cache compartilhado entre componentes
  const { data: produtosData } = useApi<any[]>(open ? "/api/produtos" : null);
  const { data: servicosData } = useApi<any[]>(open ? "/api/servicos" : null);
  const { data: combosData } = useApi<any[]>(open ? "/api/combos" : null);
  const produtos = useMemo(() => Array.isArray(produtosData) ? produtosData : [], [produtosData]);
  const servicos = useMemo(() => Array.isArray(servicosData) ? servicosData : [], [servicosData]);
  const combos = useMemo(() => Array.isArray(combosData) ? combosData : [], [combosData]);

  const [showAdder, setShowAdder] = useState(false);
  const [adderType, setAdderType] = useState<CatalogType>("combo");
  const [adderSearch, setAdderSearch] = useState("");

  const clientOptions = useMemo(() => [
    { value: "", label: "Sem cliente" },
    ...clients.map((c) => ({ value: String(c.id), label: c.name || "Sem nome" })),
  ], [clients]);

  const catalogList: CatalogItem[] = useMemo(() => {
    if (adderType === "produto") return produtos.filter(p => p.ativo).map(p => ({ id: String(p.id), nome: p.nome, value: p.preco_venda }));
    if (adderType === "servico") return servicos.filter(s => s.ativo).map(s => ({ id: String(s.id), nome: s.nome, value: s.preco_base }));
    return combos.filter(c => c.ativo).map(c => ({ id: String(c.id), nome: c.nome, value: c.preco_final }));
  }, [adderType, produtos, servicos, combos]);

  const filteredCatalog = useMemo(() => {
    const q = normalizeText(adderSearch);
    if (!q) return catalogList;
    return catalogList.filter(i => normalizeText(i.nome).includes(q));
  }, [catalogList, adderSearch]);

  const itemsTotal = items.reduce((s, i) => s + i.catalog_value * i.quantidade, 0);
  const valueToUse = items.length > 0 ? itemsTotal : (Number(form.value) || 0);

  const addItem = (it: CatalogItem) => {
    setItems(prev => [...prev, {
      catalog_type: adderType,
      catalog_id: it.id,
      catalog_name: it.nome,
      catalog_value: it.value,
      quantidade: 1,
    }]);
    setShowAdder(false);
    setAdderSearch("");
  };

  const removeItem = (idx: number) => setItems(prev => prev.filter((_, i) => i !== idx));

  const updateQuantity = (idx: number, q: number) => {
    if (q < 1) return;
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, quantidade: q } : it));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) return;

    setLoading(true);
    try {
      // 1. Cria o deal
      const dealRes = await authFetch("/api/deals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          client_id: form.client_id ? Number(form.client_id) : null,
          value: valueToUse,
        }),
      });
      const created = dealRes.ok ? await dealRes.json() : null;

      // 2. Adiciona itens (em paralelo)
      if (created?.id && items.length > 0) {
        await Promise.all(items.map(it => authFetch(`/api/deals/${created.id}/items`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(it),
        })));
      }

      setForm({
        title: "",
        client_id: "",
        value: "",
        expected_close_date: "",
        priority: "medium",
        stage: stages[0]?.id || "",
        notes: "",
        assigned_to: currentMemberId || null,
      });
      setItems([]);
      onCreated();
      onClose();
    } catch (error) {
      console.error("Erro ao criar negócio:", error);
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30 dark:bg-black/60" onClick={onClose} />
      <div className="relative bg-white dark:bg-gray-900 rounded-xl shadow-xl dark:shadow-2xl dark:shadow-black/30 w-full max-w-md border border-transparent dark:border-gray-800 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-800 flex-shrink-0">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">Novo Negócio</h2>
          <button onClick={onClose} className="p-1 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4 overflow-y-auto">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Nome do Negócio *
            </label>
            <input
              required
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="Ex: Proposta Website"
              className="w-full border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 outline-none focus:border-gray-400 dark:focus:border-gray-600 focus:ring-1 focus:ring-gray-400 dark:focus:ring-gray-600"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Cliente
            </label>
            <SearchableSelect
              value={form.client_id}
              onChange={(v) => setForm({ ...form, client_id: v })}
              showSearchIcon
              placeholder="Selecionar cliente (opcional)"
              searchPlaceholder="Buscar cliente..."
              emptyMessage="Nenhum cliente encontrado"
              triggerClassName="py-2"
              options={clientOptions}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Vendedor responsável
            </label>
            <SellerPicker
              sellers={sellers}
              value={form.assigned_to}
              onChange={(id) => setForm({ ...form, assigned_to: id })}
            />
          </div>

          {/* ── Itens do catálogo ── */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Itens
            </label>

            {items.length > 0 && (
              <div className="space-y-1.5 mb-2">
                {items.map((it, idx) => (
                  <div key={idx} className="flex items-center gap-2 px-2.5 py-2 bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-lg">
                    <span className="text-gray-400 flex-shrink-0">{CATALOG_ICONS[it.catalog_type]}</span>
                    <span className="text-sm text-gray-800 dark:text-gray-100 flex-1 truncate">{it.catalog_name}</span>
                    <input
                      type="number"
                      min={1}
                      value={it.quantidade}
                      onChange={(e) => updateQuantity(idx, Number(e.target.value))}
                      className="w-12 text-xs text-center border border-gray-200 dark:border-gray-700 rounded bg-white dark:bg-gray-900 outline-none px-1 py-0.5"
                    />
                    <span className="text-sm font-semibold text-gray-700 dark:text-gray-200 whitespace-nowrap">
                      R$ {(it.catalog_value * it.quantidade).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeItem(idx)}
                      className="p-1 text-gray-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 rounded transition-colors"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {!showAdder ? (
              <button
                type="button"
                onClick={() => setShowAdder(true)}
                className="w-full flex items-center justify-center gap-1.5 px-3 py-2 border border-dashed border-gray-300 dark:border-gray-600 hover:border-gold-400 hover:bg-gold-50/50 dark:hover:bg-gold-900/10 rounded-lg text-sm text-gray-600 dark:text-gray-300 transition-colors"
              >
                <Plus size={13} />
                Adicionar produto, serviço ou combo
              </button>
            ) : (
              <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-2.5 space-y-2 bg-gray-50/50 dark:bg-gray-800/30">
                <div className="flex gap-1">
                  {(["combo", "produto", "servico"] as CatalogType[]).map(type => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setAdderType(type)}
                      className={cn(
                        "flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs font-semibold rounded-md transition-colors",
                        adderType === type
                          ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm"
                          : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                      )}
                    >
                      {CATALOG_ICONS[type]}
                      {CATALOG_LABELS[type]}
                    </button>
                  ))}
                </div>
                <div className="relative">
                  <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    value={adderSearch}
                    onChange={(e) => setAdderSearch(e.target.value)}
                    placeholder={`Buscar em ${CATALOG_LABELS[adderType].toLowerCase()}...`}
                    className="w-full pl-8 pr-2 py-1.5 text-xs border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-900 outline-none focus:border-gold-400"
                    autoFocus
                  />
                </div>
                <div className="max-h-40 overflow-y-auto space-y-0.5">
                  {filteredCatalog.length === 0 ? (
                    <p className="text-xs text-gray-400 text-center py-3">Nenhum item encontrado.</p>
                  ) : filteredCatalog.map(it => (
                    <button
                      key={it.id}
                      type="button"
                      onClick={() => addItem(it)}
                      className="w-full flex items-center justify-between gap-2 px-2 py-1.5 text-xs hover:bg-white dark:hover:bg-gray-700 rounded transition-colors text-left"
                    >
                      <span className="text-gray-700 dark:text-gray-200 truncate">{it.nome}</span>
                      <span className="text-gray-500 dark:text-gray-400 font-semibold whitespace-nowrap">
                        R$ {it.value.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                      </span>
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => { setShowAdder(false); setAdderSearch(""); }}
                  className="w-full text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 py-1"
                >
                  Cancelar
                </button>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Valor {items.length > 0 && <span className="text-[10px] font-normal text-gray-400">(soma dos itens)</span>}
              </label>
              {items.length > 0 ? (
                <div className="w-full border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 rounded-lg px-3 py-2 text-sm font-semibold text-gray-900 dark:text-white">
                  R$ {itemsTotal.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                </div>
              ) : (
                <input
                  type="number"
                  value={form.value}
                  onChange={(e) => setForm({ ...form, value: e.target.value })}
                  placeholder="0"
                  className="w-full border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 outline-none focus:border-gray-400 dark:focus:border-gray-600 focus:ring-1 focus:ring-gray-400 dark:focus:ring-gray-600"
                />
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Previsão de Fechamento
              </label>
              <input
                type="date"
                value={form.expected_close_date}
                onChange={(e) => setForm({ ...form, expected_close_date: e.target.value })}
                className="w-full border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white outline-none focus:border-gray-400 dark:focus:border-gray-600 focus:ring-1 focus:ring-gray-400 dark:focus:ring-gray-600 [color-scheme:light] dark:[color-scheme:dark]"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Prioridade
              </label>
              <select
                value={form.priority}
                onChange={(e) => setForm({ ...form, priority: e.target.value as DealPriority })}
                className="w-full border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white outline-none focus:border-gray-400 dark:focus:border-gray-600 focus:ring-1 focus:ring-gray-400 dark:focus:ring-gray-600"
              >
                <option value="low">Baixa</option>
                <option value="medium">Média</option>
                <option value="high">Alta</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Etapa Inicial
              </label>
              <select
                value={form.stage}
                onChange={(e) => setForm({ ...form, stage: e.target.value })}
                className="w-full border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white outline-none focus:border-gray-400 dark:focus:border-gray-600 focus:ring-1 focus:ring-gray-400 dark:focus:ring-gray-600"
              >
                {stages.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Notas
            </label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={2}
              placeholder="Observações iniciais..."
              className="w-full border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 outline-none focus:border-gray-400 dark:focus:border-gray-600 focus:ring-1 focus:ring-gray-400 dark:focus:ring-gray-600 resize-none"
            />
          </div>

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 py-2 bg-gray-900 dark:bg-white text-white dark:text-gray-900 rounded-lg text-sm font-medium hover:bg-gray-800 dark:hover:bg-gray-100 disabled:opacity-50 transition-colors"
            >
              {loading ? "Criando..." : "Criar Negócio"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

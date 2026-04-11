import React, { useEffect, useState } from "react";
import {
  Briefcase,
  Plus,
  Search,
  Pencil,
  Trash2,
  X,
  Loader2,
  CheckCircle,
  XCircle,
} from "lucide-react";
import { catalogoApi } from "../services/api/catalogo";
import { Servico, TIPO_ENSAIO_LABELS } from "../types";

const TIPOS_ENSAIO = Object.entries(TIPO_ENSAIO_LABELS);

const EMPTY_SERVICO: Partial<Servico> = {
  nome: "",
  descricao: "",
  tipo_ensaio: "newborn",
  preco_base: 0,
  inclui_edicao: true,
  qtd_fotos_entrega: undefined,
  ativo: true,
};

// ── Modal ──────────────────────────────────────────────────────────────────
function ServicoModal({
  item,
  onSave,
  onClose,
}: {
  item: Partial<Servico> | null;
  onSave: (data: Partial<Servico>) => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState<Partial<Servico>>(item ?? EMPTY_SERVICO);
  const [saving, setSaving] = useState(false);

  const set = (k: keyof Servico, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

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
            {item?.id ? "Editar Serviço" : "Novo Serviço"}
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {/* Nome */}
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Nome do serviço *</label>
            <input
              required
              value={form.nome ?? ""}
              onChange={(e) => set("nome", e.target.value)}
              placeholder="Ex: Newborn Completo Premium"
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 outline-none focus:border-gold-400"
            />
          </div>

          {/* Tipo de ensaio */}
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Tipo de ensaio</label>
            <select
              value={form.tipo_ensaio ?? "newborn"}
              onChange={(e) => set("tipo_ensaio", e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 outline-none focus:border-gold-400"
            >
              {TIPOS_ENSAIO.map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </div>

          {/* Preço base */}
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Preço base (R$)</label>
            <input
              type="number"
              min={0}
              step="0.01"
              value={form.preco_base ?? 0}
              onChange={(e) => set("preco_base", parseFloat(e.target.value) || 0)}
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 outline-none focus:border-gold-400"
            />
          </div>

          {/* Edição + Qtd fotos */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Qtd. fotos entregues</label>
              <input
                type="number"
                min={0}
                value={form.qtd_fotos_entrega ?? ""}
                onChange={(e) => set("qtd_fotos_entrega", e.target.value ? parseInt(e.target.value) : undefined)}
                placeholder="Ex: 30"
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 outline-none focus:border-gold-400"
              />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 cursor-pointer pb-2">
                <input
                  type="checkbox"
                  checked={form.inclui_edicao ?? true}
                  onChange={(e) => set("inclui_edicao", e.target.checked)}
                  className="w-4 h-4 accent-gold-500"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">Inclui edição</span>
              </label>
            </div>
          </div>

          {/* Fiscal (opcional) */}
          <div className="border-t border-gray-100 dark:border-gray-800 pt-3">
            <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-3">Dados fiscais (opcional)</p>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">CNAE</label>
                <input
                  value={form.cnae ?? ""}
                  onChange={(e) => set("cnae", e.target.value)}
                  placeholder="74.20-0-01"
                  className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 outline-none focus:border-gold-400"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Cód. serviço</label>
                <input
                  value={form.codigo_servico ?? ""}
                  onChange={(e) => set("codigo_servico", e.target.value)}
                  placeholder="LC 116"
                  className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 outline-none focus:border-gold-400"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Alíquota ISS (%)</label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                  value={form.iss_aliquota ?? ""}
                  onChange={(e) => set("iss_aliquota", e.target.value ? parseFloat(e.target.value) : undefined)}
                  placeholder="5.00"
                  className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 outline-none focus:border-gold-400"
                />
              </div>
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

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={form.ativo ?? true}
              onChange={(e) => set("ativo", e.target.checked)}
              className="w-4 h-4 accent-gold-500"
            />
            <span className="text-sm text-gray-700 dark:text-gray-300">Serviço ativo</span>
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

// ── Página ─────────────────────────────────────────────────────────────────
export default function ServicosPage() {
  const [servicos, setServicos] = useState<Servico[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Partial<Servico> | null | false>(false);

  const load = async () => {
    setLoading(true);
    try {
      const data = await catalogoApi.getServicos();
      setServicos(data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const filtered = servicos.filter((s) => {
    const q = search.toLowerCase();
    return !q || s.nome.toLowerCase().includes(q) || (TIPO_ENSAIO_LABELS[s.tipo_ensaio] ?? s.tipo_ensaio).toLowerCase().includes(q);
  });

  const handleSave = async (data: Partial<Servico>) => {
    if (data.id) {
      await catalogoApi.updateServico(data.id, data);
    } else {
      await catalogoApi.createServico(data);
    }
    await load();
    setEditing(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Excluir este serviço?")) return;
    await catalogoApi.deleteServico(id);
    setServicos((prev) => prev.filter((s) => s.id !== id));
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-2xl font-bold text-gray-800 dark:text-white">Serviços</h3>
          <p className="text-gray-500 dark:text-gray-400 text-sm">Catálogo de serviços fotográficos oferecidos.</p>
        </div>
        <button
          onClick={() => setEditing({})}
          className="flex items-center gap-2 px-4 py-2 bg-gold-600 hover:bg-gold-700 text-white text-sm font-medium rounded-xl transition-colors"
        >
          <Plus size={16} />
          Novo Serviço
        </button>
      </div>

      {/* Search */}
      <div className="relative max-w-xs">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        <input
          placeholder="Buscar serviço..."
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

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center h-48">
          <Loader2 size={24} className="animate-spin text-gold-500" />
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 overflow-hidden">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-gray-400">
              <Briefcase size={32} strokeWidth={1.5} />
              <p className="text-sm">Nenhum serviço encontrado</p>
            </div>
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
                {filtered.map((s) => (
                  <tr key={s.id} className="border-b border-gray-50 dark:border-gray-800/50 hover:bg-gray-50 dark:hover:bg-gray-800/30">
                    <td className="px-5 py-3">
                      <div className="font-medium text-gray-900 dark:text-white">{s.nome}</div>
                      {s.descricao && <div className="text-xs text-gray-400 mt-0.5 truncate max-w-[200px]">{s.descricao}</div>}
                    </td>
                    <td className="px-5 py-3 text-gray-500 dark:text-gray-400 hidden md:table-cell">
                      {TIPO_ENSAIO_LABELS[s.tipo_ensaio] ?? s.tipo_ensaio}
                    </td>
                    <td className="px-5 py-3 text-right font-semibold text-gray-900 dark:text-white">
                      R$ {s.preco_base.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-5 py-3 text-center hidden sm:table-cell">
                      {s.inclui_edicao
                        ? <CheckCircle size={16} className="mx-auto text-green-500" />
                        : <XCircle size={16} className="mx-auto text-gray-300 dark:text-gray-600" />
                      }
                    </td>
                    <td className="px-5 py-3 text-center text-gray-500 dark:text-gray-400 hidden lg:table-cell">
                      {s.qtd_fotos_entrega ?? "—"}
                    </td>
                    <td className="px-5 py-3 text-center">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${s.ativo ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400" : "bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400"}`}>
                        {s.ativo ? "Ativo" : "Inativo"}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => setEditing(s)}
                          className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-gold-600"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={() => handleDelete(s.id)}
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

      {editing !== false && (
        <ServicoModal
          item={editing}
          onSave={handleSave}
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  );
}

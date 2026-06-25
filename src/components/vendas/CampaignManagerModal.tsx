import React, { useState, useEffect } from "react";
import { X, Plus, Trash2, Check, Sparkles } from "lucide-react";
import { SaleCampaign } from "../../types";
import { authFetch } from "../../utils/authFetch";
import { ConfirmModal } from "../ui/ConfirmModal";

// Mesma paleta das etiquetas do funil, para consistência visual.
const CAMPAIGN_COLORS = [
  "#16A34A", // verde (Natal)
  "#DB2777", // rosa (Dia das Mães)
  "#2563EB", // azul (Dia dos Pais)
  "#111827", // preto (Black Friday)
  "#F59E0B", // âmbar (Dia das Crianças)
  "#A855F7", // roxo (Páscoa)
  "#EF4444", // vermelho
  "#14B8A6", // teal
  "#6366F1", // índigo
  "#EC4899", // pink
  "#6B7280", // cinza
  "#0F172A", // slate
];

interface CampaignManagerModalProps {
  open: boolean;
  onClose: () => void;
  /** Chamado após criar/editar/excluir, para o pai recarregar a lista. */
  onUpdated: () => void;
}

/** Converte timestamptz (ou null) para o valor de um <input type="date"> (YYYY-MM-DD). */
function toDateInput(value?: string | null): string {
  if (!value) return "";
  return String(value).slice(0, 10);
}

export function CampaignManagerModal({ open, onClose, onUpdated }: CampaignManagerModalProps) {
  const [campaigns, setCampaigns] = useState<SaleCampaign[]>([]);
  const [loading, setLoading] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(CAMPAIGN_COLORS[0]);
  const [showNewColors, setShowNewColors] = useState(false);
  const [creating, setCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<SaleCampaign | null>(null);

  const load = () => {
    setLoading(true);
    authFetch("/api/sale-campaigns")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setCampaigns(Array.isArray(d) ? d : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (open) load();
  }, [open]);

  if (!open) return null;

  const createCampaign = async () => {
    const name = newName.trim();
    if (!name || creating) return;
    setCreating(true);
    try {
      await authFetch("/api/sale-campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, color: newColor }),
      });
      setNewName("");
      setNewColor(CAMPAIGN_COLORS[0]);
      setShowNewColors(false);
      load();
      onUpdated();
    } finally {
      setCreating(false);
    }
  };

  const patchCampaign = async (id: string, patch: Partial<SaleCampaign>) => {
    setCampaigns((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
    try {
      await authFetch(`/api/sale-campaigns/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      onUpdated();
    } catch {
      load();
    }
  };

  const removeCampaign = async (id: string) => {
    try {
      await authFetch(`/api/sale-campaigns/${id}`, { method: "DELETE" });
    } finally {
      setDeleteTarget(null);
      load();
      onUpdated();
    }
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-2xl max-h-[88vh] flex flex-col animate-in fade-in zoom-in-95 duration-200">
        {/* Cabeçalho */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
          <div className="flex items-center gap-2">
            <Sparkles size={18} className="text-pink-500" />
            <div>
              <h3 className="text-base font-semibold text-gray-900 dark:text-white">Vendas Especiais / Campanhas</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Crie campanhas (Natal, Dia das Mães...) para marcar e medir suas vendas.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <X size={18} />
          </button>
        </div>

        {/* Criar nova */}
        <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/40">
          <div className="flex items-center gap-2">
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowNewColors((s) => !s)}
                className="w-8 h-8 rounded-lg border border-gray-200 dark:border-gray-700 flex-shrink-0"
                style={{ backgroundColor: newColor }}
                title="Escolher cor"
              />
              {showNewColors && (
                <div className="absolute z-10 mt-1 p-2 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 grid grid-cols-6 gap-1 w-48">
                  {CAMPAIGN_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => {
                        setNewColor(color);
                        setShowNewColors(false);
                      }}
                      className="w-6 h-6 rounded-full flex items-center justify-center"
                      style={{ backgroundColor: color }}
                    >
                      {newColor === color && <Check size={12} className="text-white drop-shadow" />}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") createCampaign();
              }}
              placeholder="Nome da campanha (ex.: Natal 2026)"
              className="flex-1 px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-pink-500/40"
            />
            <button
              onClick={createCampaign}
              disabled={!newName.trim() || creating}
              className="flex items-center gap-1 px-3 py-2 rounded-lg text-sm font-medium bg-pink-600 hover:bg-pink-700 text-white disabled:opacity-50"
            >
              <Plus size={16} /> Adicionar
            </button>
          </div>
        </div>

        {/* Lista */}
        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-2">
          {loading && <p className="text-sm text-gray-400 py-6 text-center">Carregando…</p>}
          {!loading && campaigns.length === 0 && (
            <p className="text-sm text-gray-400 py-6 text-center">Nenhuma campanha ainda. Crie a primeira acima.</p>
          )}
          {campaigns.map((c) => (
            <React.Fragment key={c.id}>
              <CampaignRow
                campaign={c}
                colors={CAMPAIGN_COLORS}
                onPatch={(patch) => patchCampaign(c.id, patch)}
                onDelete={() => setDeleteTarget(c)}
              />
            </React.Fragment>
          ))}
        </div>

        <div className="px-5 py-3 border-t border-gray-100 dark:border-gray-800 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-gray-900 dark:bg-white text-white dark:text-gray-900 hover:opacity-90"
          >
            Concluído
          </button>
        </div>
      </div>

      <ConfirmModal
        open={!!deleteTarget}
        title="Excluir campanha"
        message={`Excluir "${deleteTarget?.name}"? As vendas marcadas com ela ficarão como "Sem campanha".`}
        confirmText="Excluir"
        variant="danger"
        onConfirm={() => deleteTarget && removeCampaign(deleteTarget.id)}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

// ─── Linha editável de campanha ──────────────────────────────────────────────

interface CampaignRowProps {
  campaign: SaleCampaign;
  colors: string[];
  onPatch: (patch: Partial<SaleCampaign>) => void;
  onDelete: () => void;
}

function CampaignRow({ campaign, colors, onPatch, onDelete }: CampaignRowProps) {
  const [name, setName] = useState(campaign.name);
  const [showColors, setShowColors] = useState(false);

  useEffect(() => {
    setName(campaign.name);
  }, [campaign.name]);

  const saveName = () => {
    const trimmed = name.trim();
    if (trimmed && trimmed !== campaign.name) onPatch({ name: trimmed });
    else setName(campaign.name);
  };

  return (
    <div className="flex flex-wrap items-center gap-2 p-2 rounded-lg border border-gray-100 dark:border-gray-800 hover:border-gray-200 dark:hover:border-gray-700">
      {/* Cor */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setShowColors((s) => !s)}
          className="w-7 h-7 rounded-full border border-gray-200 dark:border-gray-700 flex-shrink-0"
          style={{ backgroundColor: campaign.color }}
          title="Cor"
        />
        {showColors && (
          <div className="absolute z-10 mt-1 p-2 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 grid grid-cols-6 gap-1 w-48">
            {colors.map((color) => (
              <button
                key={color}
                type="button"
                onClick={() => {
                  onPatch({ color });
                  setShowColors(false);
                }}
                className="w-6 h-6 rounded-full flex items-center justify-center"
                style={{ backgroundColor: color }}
              >
                {campaign.color === color && <Check size={12} className="text-white drop-shadow" />}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Nome */}
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={saveName}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        className="flex-1 min-w-[8rem] px-2 py-1.5 text-sm rounded-lg border border-transparent hover:border-gray-200 dark:hover:border-gray-700 focus:border-pink-500 bg-transparent text-gray-900 dark:text-white focus:outline-none"
      />

      {/* Período */}
      <div className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
        <input
          type="date"
          value={toDateInput(campaign.starts_at)}
          onChange={(e) => onPatch({ starts_at: e.target.value || null })}
          className="px-2 py-1 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-200"
          title="Início"
        />
        <span>→</span>
        <input
          type="date"
          value={toDateInput(campaign.ends_at)}
          onChange={(e) => onPatch({ ends_at: e.target.value || null })}
          className="px-2 py-1 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-200"
          title="Fim"
        />
      </div>

      {/* Ativa */}
      <label className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={campaign.active !== false}
          onChange={(e) => onPatch({ active: e.target.checked })}
          className="accent-pink-600"
        />
        Ativa
      </label>

      {/* Excluir */}
      <button
        onClick={onDelete}
        className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
        title="Excluir"
      >
        <Trash2 size={15} />
      </button>
    </div>
  );
}

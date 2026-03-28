import React, { useEffect, useState } from "react";
import { Channel, Lead, PipelineStage } from "../../types/vendas";

interface LeadEditModalProps {
  open: boolean;
  lead: Lead | null;
  stages: PipelineStage[];
  onClose: () => void;
  onSave: (lead: Lead) => void;
  onDelete: (id: string) => void;
}

const inputClass =
  "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100";

export function LeadEditModal({ open, lead, stages, onClose, onSave, onDelete }: LeadEditModalProps) {
  const [draft, setDraft] = useState<Lead | null>(null);

  useEffect(() => {
    setDraft(lead);
  }, [lead]);

  if (!open || !draft) return null;

  const handleChange = <K extends keyof Lead>(key: K, value: Lead[K]) => {
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const handleSubmit = () => {
    if (draft) onSave(draft);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 backdrop-blur-sm">
      <div className="w-full max-w-2xl rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-800">
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4 dark:border-gray-700">
          <div>
            <p className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">Editar lead</p>
            <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">{draft.name}</h3>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-700"
          >
            ✕
          </button>
        </div>

        <div className="grid grid-cols-2 gap-4 px-5 py-4">
          <div className="space-y-1">
            <label className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">Nome</label>
            <input
              className={inputClass}
              value={draft.name}
              onChange={(e) => handleChange("name", e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">Telefone/WhatsApp</label>
            <input
              className={inputClass}
              value={draft.phone || ""}
              onChange={(e) => handleChange("phone", e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">Instagram</label>
            <input
              className={inputClass}
              value={draft.instagramHandle || ""}
              onChange={(e) => handleChange("instagramHandle", e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">Canal</label>
            <select
              className={inputClass}
              value={draft.channel}
              onChange={(e) => handleChange("channel", e.target.value as Channel)}
            >
              <option value="whatsapp">WhatsApp</option>
              <option value="instagram">Instagram</option>
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">Tipo de ensaio</label>
            <input
              className={inputClass}
              value={draft.serviceType}
              onChange={(e) => handleChange("serviceType", e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">Valor orçado</label>
            <input
              type="number"
              className={inputClass}
              value={draft.estimatedValue}
              onChange={(e) => handleChange("estimatedValue", Number(e.target.value))}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">Origem</label>
            <input
              className={inputClass}
              value={draft.source || ""}
              onChange={(e) => handleChange("source", e.target.value)}
              placeholder="Instagram, WhatsApp, Indicação..."
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">Status atual</label>
            <select
              className={inputClass}
              value={draft.status || "inbox"}
              onChange={(e) => handleChange("status", e.target.value as Lead["status"])}
            >
              <option value="inbox">Inbox/Análise</option>
              <option value="pipeline">No Funil</option>
              <option value="archived">Arquivado</option>
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">Etapa do funil</label>
            <select
              className={inputClass}
              value={draft.stage}
              onChange={(e) => handleChange("stage", e.target.value as PipelineStage)}
            >
              {stages.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div className="col-span-2 space-y-1">
            <label className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">Notas / Observações</label>
            <textarea
              className={`${inputClass} h-24 resize-none`}
              value={draft.notes}
              onChange={(e) => handleChange("notes", e.target.value)}
            />
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-gray-200 px-5 py-4 dark:border-gray-700">
          <button
            onClick={() => draft && onDelete(draft.id)}
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-rose-600 transition hover:bg-rose-50 dark:border-gray-700 dark:text-rose-400 dark:hover:bg-rose-500/10"
          >
            Excluir lead
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-600 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              Cancelar
            </button>
            <button
              onClick={handleSubmit}
              className="rounded-lg bg-blue-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-600"
            >
              Salvar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

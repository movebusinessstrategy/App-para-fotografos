import React, { useEffect, useState } from "react";
import { motion } from "motion/react";
import { Plus } from "lucide-react";

import { Deal } from "../../types";
import { authFetch } from "../../utils/authFetch";

interface LostDealModalProps {
  deal: Deal | null;
  stageId: string | undefined;
  onClose: () => void;
  onSaved: () => void;
}

const REASONS = ["Preço", "Concorrência", "Sem resposta", "Desistiu", "Outro"];

export function LostDealModal({ deal, stageId, onClose, onSaved }: LostDealModalProps) {
  const [reason, setReason] = useState(REASONS[0]);
  const [notes, setNotes] = useState("");

  useEffect(() => {
    setReason(REASONS[0]);
    setNotes("");
  }, [deal]);

  if (!deal) return null;

  const submit = async () => {
    await authFetch(`/api/deals/${deal.id}/lost`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason, notes, stageId }),
    });
    onSaved();
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[90] flex items-center justify-center p-4">
      <motion.div 
        initial={{ scale: 0.96, opacity: 0 }} 
        animate={{ scale: 1, opacity: 1 }} 
        className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl dark:shadow-black/40 w-full max-w-lg overflow-hidden border border-transparent dark:border-gray-800"
      >
        {/* Header */}
        <div className="p-6 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between bg-rose-50/80 dark:bg-rose-950/30">
          <div>
            <p className="text-xs uppercase text-rose-600 dark:text-rose-400 font-semibold">Perdido</p>
            <h3 className="text-xl font-bold text-gray-900 dark:text-white">Registrar motivo</h3>
          </div>
          <button 
            onClick={onClose} 
            className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          >
            <Plus className="rotate-45" size={24} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          {/* Reason Select */}
          <div>
            <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase mb-1">
              Motivo
            </label>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-rose-500 dark:focus:ring-rose-400 focus:border-transparent"
            >
              {REASONS.map((opt) => (
                <option key={opt} className="bg-white dark:bg-gray-800">
                  {opt}
                </option>
              ))}
            </select>
          </div>

          {/* Notes Textarea */}
          <div>
            <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase mb-1">
              Observações
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 outline-none focus:ring-2 focus:ring-rose-500 dark:focus:ring-rose-400 focus:border-transparent resize-none"
              rows={3}
              placeholder="Contexto adicional"
            />
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3">
            <button 
              onClick={onClose} 
              className="px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              Cancelar
            </button>
            <button 
              onClick={submit} 
              className="px-4 py-2 rounded-lg bg-rose-600 dark:bg-rose-500 text-white text-sm font-semibold hover:bg-rose-700 dark:hover:bg-rose-600 transition-colors"
            >
              Salvar
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

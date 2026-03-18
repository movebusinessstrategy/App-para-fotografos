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
      <motion.div initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
        <div className="p-6 border-b border-gray-100 flex items-center justify-between bg-rose-50/80">
          <div>
            <p className="text-xs uppercase text-rose-600 font-semibold">Perdido</p>
            <h3 className="text-xl font-bold text-gray-900">Registrar motivo</h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><Plus className="rotate-45" size={24} /></button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Motivo</label>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
            >
              {REASONS.map((opt) => (
                <option key={opt}>{opt}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Observações</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
              rows={3}
              placeholder="Contexto adicional"
            />
          </div>

          <div className="flex justify-end gap-3">
            <button onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-200 text-sm font-semibold">Cancelar</button>
            <button onClick={submit} className="px-4 py-2 rounded-lg bg-rose-600 text-white text-sm font-semibold">Salvar</button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

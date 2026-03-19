import React, { useState } from "react";
import { format } from "date-fns";
import { motion } from "motion/react";
import { Plus } from "lucide-react";

import { authFetch } from "../../utils/authFetch";
import { Job, Client } from "../../types";

interface JobFormModalProps {
  clientId?: number;
  job: Job | null;
  initialDate?: string;
  clients?: Client[];
  onClose: () => void;
  onSave: () => void;
}

export default function JobFormModal({
  clientId: initialClientId,
  job,
  initialDate,
  clients = [],
  onClose,
  onSave,
}: JobFormModalProps) {
  const [clientId, setClientId] = useState(initialClientId || job?.client_id || undefined);
  const [formData, setFormData] = useState({
    job_type: job?.job_type || "Gestante",
    job_date: job?.job_date || initialDate || format(new Date(), "yyyy-MM-dd"),
    job_time: job?.job_time || "09:00",
    job_end_time: job?.job_end_time || "",
    job_name: job?.job_name || "",
    amount: job ? job.amount : ("" as number | ""),
    payment_method: job?.payment_method || "Pix",
    payment_status: job?.payment_status || "paid",
    status: job?.status || "scheduled",
    notes: job?.notes || "",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const method = job ? "PUT" : "POST";
    const url = job ? `/api/jobs/${job.id}` : "/api/jobs";

    await authFetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...formData, client_id: clientId }),
    });
    onSave();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && e.target instanceof HTMLInputElement && e.target.type !== "submit") {
      e.preventDefault();
      const form = e.currentTarget as HTMLFormElement;
      const elements = Array.from(form.elements).filter(
        (el) =>
          (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) &&
          !el.disabled &&
          el.type !== "hidden"
      ) as HTMLElement[];

      const index = elements.indexOf(e.target as any);
      if (index > -1 && index < elements.length - 1) {
        elements[index + 1].focus();
      }
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl dark:shadow-black/40 w-full max-w-lg overflow-hidden border border-transparent dark:border-gray-800"
      >
        <div className="p-6 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between bg-gray-50/50 dark:bg-gray-800/50">
          <h3 className="text-lg font-bold text-gray-800 dark:text-white">
            {job ? "Editar Trabalho" : "Registrar Novo Trabalho"}
          </h3>
          <button onClick={onClose} className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
            <Plus className="rotate-45" size={24} />
          </button>
        </div>
        <form onSubmit={handleSubmit} onKeyDown={handleKeyDown} className="p-6 space-y-4">
          {!initialClientId && !job && (
            <div>
              <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase mb-1">Cliente</label>
              <select
                value={clientId || ""}
                onChange={(e) => setClientId(e.target.value ? Number(e.target.value) : undefined)}
                className="w-full px-4 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-400"
              >
                <option value="" className="dark:bg-gray-800">Tarefa (Sem Cliente vinculado)</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id} className="dark:bg-gray-800">
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase mb-1">Nome do Ensaio/Trabalho</label>
              <input
                required
                type="text"
                placeholder="Ex: Ensaio Gestante Maria"
                value={formData.job_name}
                onChange={(e) => setFormData({ ...formData, job_name: e.target.value })}
                className="w-full px-4 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 outline-none focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-400"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase mb-1">Tipo</label>
                <select
                  value={formData.job_type}
                  onChange={(e) => setFormData({ ...formData, job_type: e.target.value })}
                  className="w-full px-4 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-400"
                >
                  <option className="dark:bg-gray-800">Gestante</option>
                  <option className="dark:bg-gray-800">Newborn</option>
                  <option className="dark:bg-gray-800">Acompanhamento</option>
                  <option className="dark:bg-gray-800">Smash the Cake</option>
                  <option className="dark:bg-gray-800">Aniversário</option>
                  <option className="dark:bg-gray-800">Batizado</option>
                  <option className="dark:bg-gray-800">Família</option>
                  <option className="dark:bg-gray-800">Marca Pessoal</option>
                  <option className="dark:bg-gray-800">Evento Externo</option>
                  <option className="dark:bg-gray-800">Outros</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase mb-1">Status do Ensaio</label>
                <select
                  value={formData.status}
                  onChange={(e) => setFormData({ ...formData, status: e.target.value as any })}
                  className="w-full px-4 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-400"
                >
                  <option value="scheduled" className="dark:bg-gray-800">Agendado</option>
                  <option value="completed" className="dark:bg-gray-800">Concluído</option>
                  <option value="cancelled" className="dark:bg-gray-800">Cancelado</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase mb-1">Data</label>
                <input
                  required
                  type="date"
                  value={formData.job_date}
                  onChange={(e) => setFormData({ ...formData, job_date: e.target.value })}
                  className="w-full px-4 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-400 [color-scheme:light] dark:[color-scheme:dark]"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase mb-1">Início</label>
                <input
                  required
                  type="time"
                  value={formData.job_time}
                  onChange={(e) => setFormData({ ...formData, job_time: e.target.value })}
                  className="w-full px-4 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-400 [color-scheme:light] dark:[color-scheme:dark]"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase mb-1">Fim (Opcional)</label>
                <input
                  type="time"
                  value={formData.job_end_time}
                  onChange={(e) => setFormData({ ...formData, job_end_time: e.target.value })}
                  className="w-full px-4 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-400 [color-scheme:light] dark:[color-scheme:dark]"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase mb-1">Valor (R$)</label>
                <input
                  type="number"
                  value={formData.amount}
                  onChange={(e) =>
                    setFormData({ ...formData, amount: e.target.value === "" ? "" : (Number(e.target.value) as number) })
                  }
                  className="w-full px-4 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-400 [color-scheme:light] dark:[color-scheme:dark]"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase mb-1">Pagamento</label>
                <select
                  value={formData.payment_method}
                  onChange={(e) => setFormData({ ...formData, payment_method: e.target.value })}
                  className="w-full px-4 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-400"
                >
                  <option className="dark:bg-gray-800">Pix</option>
                  <option className="dark:bg-gray-800">Cartão</option>
                  <option className="dark:bg-gray-800">Dinheiro</option>
                  <option className="dark:bg-gray-800">Boleto</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase mb-1">Observações</label>
              <textarea
                rows={2}
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                className="w-full px-4 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 outline-none focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-400 resize-none"
                placeholder="Detalhes adicionais..."
              />
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-4">
            <button 
              type="button" 
              onClick={onClose} 
              className="px-6 py-2 text-gray-500 dark:text-gray-400 font-medium hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="px-8 py-2 bg-indigo-600 dark:bg-indigo-500 text-white rounded-xl font-bold hover:bg-indigo-700 dark:hover:bg-indigo-600 transition-colors"
            >
              {job ? "Salvar Alterações" : "Registrar Trabalho"}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

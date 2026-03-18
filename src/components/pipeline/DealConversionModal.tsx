import React, { useEffect, useState } from "react";
import { motion } from "motion/react";
import { Plus } from "lucide-react";

import { Deal } from "../../types";
import { authFetch } from "../../utils/authFetch";

interface DealConversionModalProps {
  deal: Deal | null;
  onClose: () => void;
  onConverted: () => void;
}

export function DealConversionModal({ deal, onClose, onConverted }: DealConversionModalProps) {
  const [createClient, setCreateClient] = useState(true);
  const [createJob, setCreateJob] = useState(true);
  const [clientData, setClientData] = useState({ name: "", phone: "", email: "" });
  const [jobData, setJobData] = useState({
    job_type: "Gestante",
    job_date: new Date().toISOString().slice(0, 10),
    job_time: "09:00",
    job_end_time: "",
    job_name: "",
    amount: 0,
    payment_method: "Pix",
    payment_status: "pending",
    status: "scheduled",
    notes: "",
  });

  useEffect(() => {
    setClientData({
      name: deal?.contact_name || deal?.title || "",
      phone: deal?.contact_phone || "",
      email: deal?.contact_email || "",
    });
    setJobData((prev) => ({
      ...prev,
      job_name: deal?.title || "",
      amount: deal?.value || 0,
      notes: deal?.notes || "",
    }));
  }, [deal]);

  if (!deal) return null;

  const submit = async () => {
    await authFetch(`/api/deals/${deal.id}/convert`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        createClient,
        createJob,
        client: clientData,
        job: createJob ? jobData : undefined,
      }),
    });
    onConverted();
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[90] flex items-center justify-center p-4">
      <motion.div initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl overflow-hidden">
        <div className="p-6 border-b border-gray-100 flex items-center justify-between bg-emerald-50/70">
          <div>
            <p className="text-xs uppercase text-emerald-600 font-semibold">Fechado Ganho</p>
            <h3 className="text-xl font-bold text-gray-900">Converter deal</h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><Plus className="rotate-45" size={24} /></button>
        </div>

        <div className="p-6 space-y-6">
          <div className="flex flex-wrap gap-3 items-center">
            <label className="flex items-center gap-2 text-sm font-semibold text-gray-700">
              <input type="checkbox" checked={createClient} onChange={(e) => setCreateClient(e.target.checked)} />
              Criar cliente
            </label>
            <label className="flex items-center gap-2 text-sm font-semibold text-gray-700">
              <input type="checkbox" checked={createJob} onChange={(e) => setCreateJob(e.target.checked)} />
              Criar job
            </label>
          </div>

          {createClient && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 border border-gray-100 rounded-xl p-4">
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Nome</label>
                <input
                  value={clientData.name}
                  onChange={(e) => setClientData((p) => ({ ...p, name: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Telefone</label>
                <input
                  value={clientData.phone}
                  onChange={(e) => setClientData((p) => ({ ...p, phone: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Email</label>
                <input
                  value={clientData.email}
                  onChange={(e) => setClientData((p) => ({ ...p, email: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
                />
              </div>
            </div>
          )}

          {createJob && (
            <div className="border border-gray-100 rounded-xl p-4 space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Tipo</label>
                  <input
                    value={jobData.job_type}
                    onChange={(e) => setJobData((p) => ({ ...p, job_type: e.target.value }))}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Data</label>
                  <input
                    type="date"
                    value={jobData.job_date}
                    onChange={(e) => setJobData((p) => ({ ...p, job_date: e.target.value }))}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Início</label>
                    <input
                      type="time"
                      value={jobData.job_time}
                      onChange={(e) => setJobData((p) => ({ ...p, job_time: e.target.value }))}
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Fim</label>
                    <input
                      type="time"
                      value={jobData.job_end_time}
                      onChange={(e) => setJobData((p) => ({ ...p, job_end_time: e.target.value }))}
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
                    />
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Valor</label>
                  <input
                    type="number"
                    value={jobData.amount}
                    onChange={(e) => setJobData((p) => ({ ...p, amount: Number(e.target.value) }))}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Pagamento</label>
                  <select
                    value={jobData.payment_method}
                    onChange={(e) => setJobData((p) => ({ ...p, payment_method: e.target.value }))}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
                  >
                    <option>Pix</option>
                    <option>Cartão</option>
                    <option>Dinheiro</option>
                    <option>Boleto</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Status</label>
                  <select
                    value={jobData.status}
                    onChange={(e) => setJobData((p) => ({ ...p, status: e.target.value }))}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
                  >
                    <option value="scheduled">Agendado</option>
                    <option value="completed">Concluído</option>
                    <option value="cancelled">Cancelado</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Notas</label>
                <textarea
                  value={jobData.notes}
                  onChange={(e) => setJobData((p) => ({ ...p, notes: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
                  rows={2}
                />
              </div>
            </div>
          )}

          <div className="flex justify-end gap-3">
            <button onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-200 text-sm font-semibold">Cancelar</button>
            <button onClick={submit} className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold flex items-center gap-2">
              <CheckIcon /> Converter
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function CheckIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
    </svg>
  );
}

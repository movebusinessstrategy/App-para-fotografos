import React, { useState } from "react";
import { format } from "date-fns";
import { motion, AnimatePresence } from "motion/react";
import { Check, Copy, MessageSquare, Phone, Plus, RefreshCw, Sparkles, Trash2, AlertTriangle, X } from "lucide-react";

import { cn } from "../../utils/cn";
import { authFetch } from "../../utils/authFetch";
import { Client, Opportunity } from "../../types";

interface ContactOpportunityModalProps {
  opportunity: Opportunity;
  client: Client | null;
  onClose: () => void;
  onUpdate: () => void;
  onDiscard: (oppId: number) => Promise<void>;
}

export default function ContactOpportunityModal({ opportunity, client, onClose, onUpdate, onDiscard }: ContactOpportunityModalProps) {
  const [copied, setCopied] = useState(false);
  const [converting, setConverting] = useState(false);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const [discarding, setDiscarding] = useState(false);

  const handleCopyPhone = () => {
    if (client?.phone) {
      navigator.clipboard.writeText(client.phone);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleWhatsApp = () => {
    if (client?.phone) {
      const phone = client.phone.replace(/\D/g, "");
      const message = encodeURIComponent(
        `Olá ${client.name}! Tudo bem? Notei que está chegando a época de fazermos o ensaio de ${opportunity.type}. Vamos agendar?`
      );
      window.open(`https://wa.me/55${phone}?text=${message}`, "_blank");
    }
  };

  const handleConvert = async () => {
    setConverting(true);
    try {
      await authFetch(`/api/opportunities/${opportunity.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "converted" }),
      });

      if (client) {
        await authFetch("/api/leads", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            client_name: client.name,
            job_type_interest: opportunity.type,
            contact_date: new Date().toISOString().split("T")[0],
            estimated_value: opportunity.estimated_value || 0,
            status: "new",
            notes: `Convertido da oportunidade: ${opportunity.type}`,
            stage_id: 1,
          }),
        });
      }

      onUpdate();
      onClose();
    } catch (error) {
      console.error("Erro ao converter:", error);
    } finally {
      setConverting(false);
    }
  };

  const handleDiscard = async () => {
    setDiscarding(true);
    try {
      await onDiscard(opportunity.id);
      onClose();
    } catch (error) {
      console.error("Erro ao descartar:", error);
    } finally {
      setDiscarding(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden"
        >
          <div className="p-6 border-b border-gray-100 flex items-center justify-between bg-indigo-50">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600">
                <Sparkles size={20} />
              </div>
              <div>
                <h3 className="font-bold text-gray-900">Nova Oportunidade</h3>
                <p className="text-xs text-indigo-600 font-medium uppercase tracking-wider">{opportunity.type}</p>
              </div>
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
              <Plus size={24} className="rotate-45" />
            </button>
          </div>

          <div className="p-6 space-y-6">
            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 bg-gray-50 rounded-xl border border-gray-100">
                <div>
                  <p className="text-xs text-gray-500 font-medium">Cliente</p>
                  <p className="font-bold text-gray-900">{client?.name || "Carregando..."}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-gray-500 font-medium">Data Sugerida</p>
                  <p className="font-bold text-gray-900">{format(new Date(opportunity.suggested_date), "dd/MM/yyyy")}</p>
                </div>
              </div>

              <div className="flex items-center justify-between p-4 bg-gray-50 rounded-xl border border-gray-100">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-green-100 flex items-center justify-center text-green-600">
                    <Phone size={16} />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 font-medium">Telefone</p>
                    <p className="font-bold text-gray-900">{client?.phone || "N/A"}</p>
                  </div>
                </div>
                <button
                  onClick={handleCopyPhone}
                  className={cn(
                    "p-2 rounded-lg transition-all",
                    copied ? "bg-green-500 text-white" : "bg-white text-gray-400 hover:text-indigo-600 border border-gray-200"
                  )}
                >
                  {copied ? <Check size={16} /> : <Copy size={16} />}
                </button>
              </div>
            </div>

            <div className="space-y-3">
              <p className="text-sm font-medium text-gray-700">Ações de Contato</p>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={handleWhatsApp}
                  className="flex items-center justify-center gap-2 py-3 bg-green-500 text-white rounded-xl font-bold hover:bg-green-600 transition-all shadow-sm"
                >
                  <MessageSquare size={18} />
                  WhatsApp
                </button>
                <button
                  onClick={() => window.open(`tel:${client?.phone}`, "_self")}
                  className="flex items-center justify-center gap-2 py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-all shadow-sm"
                >
                  <Phone size={18} />
                  Ligar
                </button>
              </div>
            </div>

            <div className="p-4 bg-amber-50 rounded-xl border border-amber-100 space-y-2">
              <div className="flex items-center gap-2 text-amber-700">
                <Sparkles size={16} />
                <p className="text-xs font-bold uppercase tracking-wider">Sugestão de Abordagem</p>
              </div>
              <p className="text-sm text-amber-800 italic leading-relaxed">
                "Olá {client?.name.split(" ")[0]}! Tudo bem? Notei que está chegando a época de fazermos o ensaio de {opportunity.type}. Vamos agendar?"
              </p>
            </div>
          </div>

          {/* Footer */}
          <div className="p-6 bg-gray-50 border-t border-gray-100">
            <div className="flex gap-3">
              <button
                onClick={onClose}
                className="flex-1 py-3 text-gray-600 font-bold hover:bg-gray-100 rounded-xl transition-all"
              >
                Depois
              </button>
              <button
                onClick={() => setShowDiscardConfirm(true)}
                className="py-3 px-4 text-red-500 font-bold hover:bg-red-50 rounded-xl transition-all border border-red-200 flex items-center justify-center gap-2"
              >
                <Trash2 size={18} />
                Descartar
              </button>
              <button
                onClick={handleConvert}
                disabled={converting}
                className="flex-1 py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-all shadow-md flex items-center justify-center disabled:opacity-50"
              >
                {converting ? (
                  <RefreshCw size={18} className="animate-spin" />
                ) : (
                  "Converter em Lead"
                )}
              </button>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Popup de confirmação separado */}
      <AnimatePresence>
        {showDiscardConfirm && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[70] p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ duration: 0.15 }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden"
            >
              <div className="p-6 text-center">
                <div className="w-14 h-14 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <AlertTriangle size={28} className="text-red-500" />
                </div>
                <h3 className="text-lg font-bold text-gray-900 mb-2">Descartar Oportunidade?</h3>
                <p className="text-sm text-gray-500">
                  A oportunidade de <span className="font-semibold">{opportunity.type}</span> para{" "}
                  <span className="font-semibold">{client?.name}</span> será removida.
                </p>
              </div>
              <div className="flex border-t border-gray-100">
                <button
                  onClick={() => setShowDiscardConfirm(false)}
                  className="flex-1 py-4 text-gray-600 font-bold hover:bg-gray-50 transition-all border-r border-gray-100"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleDiscard}
                  disabled={discarding}
                  className="flex-1 py-4 text-red-500 font-bold hover:bg-red-50 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {discarding ? (
                    <RefreshCw size={18} className="animate-spin" />
                  ) : (
                    <>
                      <Trash2 size={18} />
                      Descartar
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}

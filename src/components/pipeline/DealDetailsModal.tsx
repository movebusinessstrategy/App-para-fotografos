// src/components/vendas/DealDetailsModal.tsx
import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  X, 
  Save, 
  Trash2, 
  Trophy, 
  XCircle, 
  User, 
  Phone, 
  Mail, 
  Instagram,
  StickyNote,
  DollarSign,
  Calendar
} from "lucide-react";
import { Deal, Client, PipelineStage } from "../../types";
import { authFetch } from "../../utils/authFetch";
import { DealConversionModal } from "./DealConversionModal";

interface DealDetailsModalProps {
  deal: Deal | null;
  stages: PipelineStage[];
  clients: Client[];
  onClose: () => void;
  onUpdated: () => void;
}

export function DealDetailsModal({ 
  deal, 
  stages, 
  clients, 
  onClose, 
  onUpdated 
}: DealDetailsModalProps) {
  const [formData, setFormData] = useState<Partial<Deal>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showConversionModal, setShowConversionModal] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  // Carrega dados do deal quando abre
  useEffect(() => {
    if (deal) {
      setFormData({
        title: deal.title || "",
        value: deal.value || 0,
        stage: deal.stage || "",
        client_id: deal.client_id || null,
        contact_name: deal.contact_name || "",
        contact_phone: deal.contact_phone || "",
        contact_email: deal.contact_email || "",
        contact_instagram: deal.contact_instagram || "",
        notes: deal.notes || "",
        expected_close_date: deal.expected_close_date || "",
      });
      setHasChanges(false);
    }
  }, [deal]);

  if (!deal) return null;

  const currentStage = stages.find(s => s.id === deal.stage);
  const isWon = currentStage?.stage_type === "won";
  const isLost = currentStage?.stage_type === "lost";
  const isFinal = currentStage?.is_final;

  const handleChange = (field: keyof Deal, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    setHasChanges(true);
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await authFetch(`/api/deals/${deal.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      onUpdated();
      setHasChanges(false);
    } catch (error) {
      console.error("Erro ao salvar deal:", error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm("Tem certeza que deseja excluir este negócio?")) return;
    
    setIsDeleting(true);
    try {
      await authFetch(`/api/deals/${deal.id}`, { method: "DELETE" });
      onUpdated();
      onClose();
    } catch (error) {
      console.error("Erro ao excluir deal:", error);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleMarkAsWon = () => {
    setShowConversionModal(true);
  };

  const handleMarkAsLost = async () => {
    const lostStage = stages.find(s => s.stage_type === "lost");
    if (!lostStage) {
      alert("Stage 'Perdido' não encontrado. Configure nas etapas.");
      return;
    }

    setIsSaving(true);
    try {
      await authFetch(`/api/deals/${deal.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage: lostStage.id }),
      });
      onUpdated();
      onClose();
    } catch (error) {
      console.error("Erro ao marcar como perdido:", error);
    } finally {
      setIsSaving(false);
    }
  };

  const inputClasses = "w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-transparent transition-colors";
  const selectClasses = "w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-transparent transition-colors";
  const labelClasses = "block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase mb-1";

  const linkedClient = clients.find(c => c.id === formData.client_id);

  return (
    <>
      <AnimatePresence>
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[80] flex items-center justify-center p-4">
          <motion.div
            initial={{ scale: 0.96, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.96, opacity: 0 }}
            className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl dark:shadow-black/40 w-full max-w-2xl overflow-hidden border border-transparent dark:border-gray-800"
          >
            {/* Header com status */}
            <div className={`p-6 border-b border-gray-100 dark:border-gray-800 ${
              isWon ? "bg-emerald-50/70 dark:bg-emerald-950/30" :
              isLost ? "bg-red-50/70 dark:bg-red-950/30" :
              "bg-gray-50/70 dark:bg-gray-800/50"
            }`}>
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  {isFinal && (
                    <span className={`inline-block px-2 py-0.5 text-xs font-semibold rounded-full mb-2 ${
                      isWon 
                        ? "bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300" 
                        : "bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-300"
                    }`}>
                      {isWon ? "✓ Ganho" : "✗ Perdido"}
                    </span>
                  )}
                  <input
                    value={formData.title || ""}
                    onChange={(e) => handleChange("title", e.target.value)}
                    className="text-xl font-bold text-gray-900 dark:text-white bg-transparent border-none outline-none w-full"
                    placeholder="Título do negócio"
                  />
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    Criado em {new Date(deal.created_at).toLocaleDateString("pt-BR")}
                  </p>
                </div>
                <button
                  onClick={onClose}
                  className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors p-1"
                >
                  <X size={24} />
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="p-6 space-y-6 max-h-[60vh] overflow-y-auto">
              {/* Valor e Stage */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelClasses}>
                    <DollarSign size={12} className="inline mr-1" />
                    Valor
                  </label>
                  <input
                    type="number"
                    value={formData.value || 0}
                    onChange={(e) => handleChange("value", Number(e.target.value))}
                    className={inputClasses}
                    placeholder="0,00"
                  />
                </div>
                <div>
                  <label className={labelClasses}>Etapa</label>
                  <select
                    value={formData.stage || ""}
                    onChange={(e) => handleChange("stage", e.target.value)}
                    className={selectClasses}
                    disabled={isFinal}
                  >
                    {stages.filter(s => !s.is_final).map((stage) => (
                      <option key={stage.id} value={stage.id} className="bg-white dark:bg-gray-800">
                        {stage.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Cliente vinculado */}
              <div>
                <label className={labelClasses}>
                  <User size={12} className="inline mr-1" />
                  Cliente Vinculado
                </label>
                <select
                  value={formData.client_id || ""}
                  onChange={(e) => handleChange("client_id", e.target.value || null)}
                  className={selectClasses}
                >
                  <option value="" className="bg-white dark:bg-gray-800">
                    Nenhum cliente vinculado
                  </option>
                  {clients.map((client) => (
                    <option key={client.id} value={client.id} className="bg-white dark:bg-gray-800">
                      {client.name} {client.phone ? `- ${client.phone}` : ""}
                    </option>
                  ))}
                </select>
                {linkedClient && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    📧 {linkedClient.email || "Sem email"} • 📱 {linkedClient.phone || "Sem telefone"}
                  </p>
                )}
              </div>

              {/* Dados de Contato (se não tem cliente vinculado) */}
              {!formData.client_id && (
                <div className="p-4 bg-gray-50 dark:bg-gray-800/50 rounded-xl space-y-4">
                  <p className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase">
                    Dados de Contato (Lead)
                  </p>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className={labelClasses}>
                        <User size={12} className="inline mr-1" />
                        Nome
                      </label>
                      <input
                        value={formData.contact_name || ""}
                        onChange={(e) => handleChange("contact_name", e.target.value)}
                        className={inputClasses}
                        placeholder="Nome do contato"
                      />
                    </div>
                    <div>
                      <label className={labelClasses}>
                        <Phone size={12} className="inline mr-1" />
                        Telefone
                      </label>
                      <input
                        value={formData.contact_phone || ""}
                        onChange={(e) => handleChange("contact_phone", e.target.value)}
                        className={inputClasses}
                        placeholder="(00) 00000-0000"
                      />
                    </div>
                    <div>
                      <label className={labelClasses}>
                        <Mail size={12} className="inline mr-1" />
                        Email
                      </label>
                      <input
                        type="email"
                        value={formData.contact_email || ""}
                        onChange={(e) => handleChange("contact_email", e.target.value)}
                        className={inputClasses}
                        placeholder="email@exemplo.com"
                      />
                    </div>
                    <div>
                      <label className={labelClasses}>
                        <Instagram size={12} className="inline mr-1" />
                        Instagram
                      </label>
                      <input
                        value={formData.contact_instagram || ""}
                        onChange={(e) => handleChange("contact_instagram", e.target.value)}
                        className={inputClasses}
                        placeholder="@usuario"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Data prevista de fechamento */}
              <div>
                <label className={labelClasses}>
                  <Calendar size={12} className="inline mr-1" />
                  Previsão de Fechamento
                </label>
                <input
                  type="date"
                  value={formData.expected_close_date || ""}
                  onChange={(e) => handleChange("expected_close_date", e.target.value)}
                  className={`${inputClasses} [color-scheme:light] dark:[color-scheme:dark]`}
                />
              </div>

              {/* Notas */}
              <div>
                <label className={labelClasses}>
                  <StickyNote size={12} className="inline mr-1" />
                  Notas / Observações
                </label>
                <textarea
                  value={formData.notes || ""}
                  onChange={(e) => handleChange("notes", e.target.value)}
                  className={`${inputClasses} resize-none`}
                  rows={3}
                  placeholder="Anotações sobre o negócio..."
                />
              </div>
            </div>

            {/* Footer Actions */}
            <div className="p-6 border-t border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/30">
              <div className="flex items-center justify-between">
                {/* Ações destrutivas à esquerda */}
                <div className="flex gap-2">
                  <button
                    onClick={handleDelete}
                    disabled={isDeleting}
                    className="px-3 py-2 rounded-lg text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors flex items-center gap-1"
                  >
                    <Trash2 size={16} />
                    {isDeleting ? "Excluindo..." : "Excluir"}
                  </button>
                </div>

                {/* Ações principais à direita */}
                <div className="flex gap-2">
                  {!isFinal && (
                    <>
                      <button
                        onClick={handleMarkAsLost}
                        className="px-4 py-2 rounded-lg text-sm font-medium border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors flex items-center gap-1"
                      >
                        <XCircle size={16} />
                        Perdido
                      </button>
                      <button
                        onClick={handleMarkAsWon}
                        className="px-4 py-2 rounded-lg text-sm font-medium bg-emerald-600 dark:bg-emerald-500 text-white hover:bg-emerald-700 dark:hover:bg-emerald-600 transition-colors flex items-center gap-1"
                      >
                        <Trophy size={16} />
                        Converter
                      </button>
                    </>
                  )}
                  <button
                    onClick={handleSave}
                    disabled={isSaving || !hasChanges}
                    className="px-4 py-2 rounded-lg text-sm font-medium bg-gray-900 dark:bg-white text-white dark:text-gray-900 hover:bg-gray-800 dark:hover:bg-gray-100 transition-colors flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Save size={16} />
                    {isSaving ? "Salvando..." : "Salvar"}
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </AnimatePresence>

      {/* Modal de Conversão */}
      {showConversionModal && (
        <DealConversionModal
          deal={deal}
          clients={clients}
          onClose={() => setShowConversionModal(false)}
          onConverted={() => {
            setShowConversionModal(false);
            onUpdated();
            onClose();
          }}
        />
      )}
    </>
  );
}

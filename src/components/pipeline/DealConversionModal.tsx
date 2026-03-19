import React, { useEffect, useState } from "react";
import { motion } from "motion/react";
import { Plus, User, Briefcase, ChevronDown, ChevronUp } from "lucide-react";

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
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [expandedSections, setExpandedSections] = useState({
    client: true,
    job: true,
  });

  // Dados completos do cliente
  const [clientData, setClientData] = useState({
    name: "",
    phone: "",
    email: "",
    document: "",
    birth_date: "",
    address: "",
    city: "",
    state: "",
    zip_code: "",
    instagram: "",
    how_found: "",
    notes: "",
  });

  // Dados do Job
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
    location: "",
    notes: "",
  });

  useEffect(() => {
    if (deal) {
      setClientData((prev) => ({
        ...prev,
        name: deal.contact_name || deal.title || "",
        phone: deal.contact_phone || "",
        email: deal.contact_email || "",
        instagram: deal.contact_instagram || "",
        notes: deal.notes || "",
      }));
      setJobData((prev) => ({
        ...prev,
        job_name: deal.title || "",
        amount: deal.value || 0,
        notes: deal.notes || "",
      }));
    }
  }, [deal]);

  if (!deal) return null;

  const toggleSection = (section: "client" | "job") => {
    setExpandedSections((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  const submit = async () => {
    setIsSubmitting(true);
    try {
      await authFetch(`/api/deals/${deal.id}/convert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          createClient,
          createJob,
          client: createClient ? clientData : undefined,
          job: createJob ? jobData : undefined,
        }),
      });
      onConverted();
    } catch (error) {
      console.error("Erro ao converter deal:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const inputClasses = "w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 outline-none focus:ring-2 focus:ring-emerald-500 dark:focus:ring-emerald-400 focus:border-transparent transition-colors";
  
  const selectClasses = "w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-emerald-500 dark:focus:ring-emerald-400 focus:border-transparent transition-colors";

  const labelClasses = "block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase mb-1";

  const howFoundOptions = [
    "Instagram",
    "Facebook", 
    "Google",
    "Indicação",
    "Site",
    "WhatsApp",
    "Outro",
  ];

  const brazilianStates = [
    "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA",
    "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN",
    "RS", "RO", "RR", "SC", "SP", "SE", "TO"
  ];

  const jobTypes = [
    "Gestante",
    "Newborn",
    "Família",
    "Casamento",
    "Ensaio Externo",
    "Aniversário",
    "Batizado",
    "Corporativo",
    "Outro",
  ];

  const canSubmit = createClient ? (clientData.name && clientData.phone) : true;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[90] flex items-center justify-center p-4">
      <motion.div 
        initial={{ scale: 0.96, opacity: 0 }} 
        animate={{ scale: 1, opacity: 1 }} 
        className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl dark:shadow-black/40 w-full max-w-4xl overflow-hidden border border-transparent dark:border-gray-800"
      >
        {/* Header */}
        <div className="p-6 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between bg-emerald-50/70 dark:bg-emerald-950/30">
          <div>
            <p className="text-xs uppercase text-emerald-600 dark:text-emerald-400 font-semibold tracking-wide">
              Fechado Ganho
            </p>
            <h3 className="text-xl font-bold text-gray-900 dark:text-white">
              Converter deal em venda
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Preencha os dados para cadastrar o cliente e agendar o trabalho
            </p>
          </div>
          <button 
            onClick={onClose} 
            className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors p-1"
          >
            <Plus className="rotate-45" size={24} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4 max-h-[65vh] overflow-y-auto">
          {/* Checkboxes */}
          <div className="flex flex-wrap gap-4 items-center p-4 bg-gray-50 dark:bg-gray-800/50 rounded-xl">
            <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-300 cursor-pointer select-none">
              <input 
                type="checkbox" 
                checked={createClient} 
                onChange={(e) => setCreateClient(e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-emerald-600 focus:ring-emerald-500 dark:focus:ring-emerald-400 bg-white dark:bg-gray-800"
              />
              <User size={16} className="text-blue-500" />
              Cadastrar cliente
            </label>
            <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-300 cursor-pointer select-none">
              <input 
                type="checkbox" 
                checked={createJob} 
                onChange={(e) => setCreateJob(e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-emerald-600 focus:ring-emerald-500 dark:focus:ring-emerald-400 bg-white dark:bg-gray-800"
              />
              <Briefcase size={16} className="text-purple-500" />
              Criar trabalho/ensaio
            </label>
          </div>

          {/* ==================== SEÇÃO CLIENTE ==================== */}
          {createClient && (
            <div className="border border-gray-100 dark:border-gray-800 rounded-xl overflow-hidden">
              {/* Section Header */}
              <button
                type="button"
                onClick={() => toggleSection("client")}
                className="w-full flex items-center justify-between p-4 bg-blue-50/50 dark:bg-blue-950/20 hover:bg-blue-50 dark:hover:bg-blue-950/30 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-900/50 flex items-center justify-center">
                    <User size={16} className="text-blue-600 dark:text-blue-400" />
                  </div>
                  <span className="font-semibold text-gray-900 dark:text-white">Dados do Cliente</span>
                  <span className="text-xs text-gray-400 dark:text-gray-500">• campos com * são obrigatórios</span>
                </div>
                {expandedSections.client ? (
                  <ChevronUp size={18} className="text-gray-400" />
                ) : (
                  <ChevronDown size={18} className="text-gray-400" />
                )}
              </button>

              {expandedSections.client && (
                <div className="p-4 space-y-4 bg-gray-50/50 dark:bg-gray-800/30">
                  {/* Linha 1: Nome, Telefone, Email */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className={labelClasses}>Nome *</label>
                      <input
                        value={clientData.name}
                        onChange={(e) => setClientData((p) => ({ ...p, name: e.target.value }))}
                        className={inputClasses}
                        placeholder="Nome completo"
                      />
                    </div>
                    <div>
                      <label className={labelClasses}>Telefone *</label>
                      <input
                        value={clientData.phone}
                        onChange={(e) => setClientData((p) => ({ ...p, phone: e.target.value }))}
                        className={inputClasses}
                        placeholder="(00) 00000-0000"
                      />
                    </div>
                    <div>
                      <label className={labelClasses}>Email</label>
                      <input
                        type="email"
                        value={clientData.email}
                        onChange={(e) => setClientData((p) => ({ ...p, email: e.target.value }))}
                        className={inputClasses}
                        placeholder="email@exemplo.com"
                      />
                    </div>
                  </div>

                  {/* Linha 2: CPF/CNPJ, Data de Nascimento, Instagram */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className={labelClasses}>CPF/CNPJ</label>
                      <input
                        value={clientData.document}
                        onChange={(e) => setClientData((p) => ({ ...p, document: e.target.value }))}
                        className={inputClasses}
                        placeholder="000.000.000-00"
                      />
                    </div>
                    <div>
                      <label className={labelClasses}>Data de Nascimento</label>
                      <input
                        type="date"
                        value={clientData.birth_date}
                        onChange={(e) => setClientData((p) => ({ ...p, birth_date: e.target.value }))}
                        className={`${inputClasses} [color-scheme:light] dark:[color-scheme:dark]`}
                      />
                    </div>
                    <div>
                      <label className={labelClasses}>Instagram</label>
                      <input
                        value={clientData.instagram}
                        onChange={(e) => setClientData((p) => ({ ...p, instagram: e.target.value }))}
                        className={inputClasses}
                        placeholder="@usuario"
                      />
                    </div>
                  </div>

                  {/* Linha 3: Endereço */}
                  <div>
                    <label className={labelClasses}>Endereço</label>
                    <input
                      value={clientData.address}
                      onChange={(e) => setClientData((p) => ({ ...p, address: e.target.value }))}
                      className={inputClasses}
                      placeholder="Rua, número, complemento"
                    />
                  </div>

                  {/* Linha 4: Cidade, Estado, CEP */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className={labelClasses}>Cidade</label>
                      <input
                        value={clientData.city}
                        onChange={(e) => setClientData((p) => ({ ...p, city: e.target.value }))}
                        className={inputClasses}
                        placeholder="Cidade"
                      />
                    </div>
                    <div>
                      <label className={labelClasses}>Estado</label>
                      <select
                        value={clientData.state}
                        onChange={(e) => setClientData((p) => ({ ...p, state: e.target.value }))}
                        className={selectClasses}
                      >
                        <option value="" className="bg-white dark:bg-gray-800">Selecione</option>
                        {brazilianStates.map((state) => (
                          <option key={state} value={state} className="bg-white dark:bg-gray-800">
                            {state}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className={labelClasses}>CEP</label>
                      <input
                        value={clientData.zip_code}
                        onChange={(e) => setClientData((p) => ({ ...p, zip_code: e.target.value }))}
                        className={inputClasses}
                        placeholder="00000-000"
                      />
                    </div>
                  </div>

                  {/* Linha 5: Como conheceu */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className={labelClasses}>Como conheceu</label>
                      <select
                        value={clientData.how_found}
                        onChange={(e) => setClientData((p) => ({ ...p, how_found: e.target.value }))}
                        className={selectClasses}
                      >
                        <option value="" className="bg-white dark:bg-gray-800">Selecione</option>
                        {howFoundOptions.map((opt) => (
                          <option key={opt} value={opt} className="bg-white dark:bg-gray-800">
                            {opt}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Linha 6: Observações do cliente */}
                  <div>
                    <label className={labelClasses}>Observações do Cliente</label>
                    <textarea
                      value={clientData.notes}
                      onChange={(e) => setClientData((p) => ({ ...p, notes: e.target.value }))}
                      className={`${inputClasses} resize-none`}
                      rows={2}
                      placeholder="Informações adicionais sobre o cliente..."
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ==================== SEÇÃO JOB ==================== */}
          {createJob && (
            <div className="border border-gray-100 dark:border-gray-800 rounded-xl overflow-hidden">
              {/* Section Header */}
              <button
                type="button"
                onClick={() => toggleSection("job")}
                className="w-full flex items-center justify-between p-4 bg-purple-50/50 dark:bg-purple-950/20 hover:bg-purple-50 dark:hover:bg-purple-950/30 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-purple-100 dark:bg-purple-900/50 flex items-center justify-center">
                    <Briefcase size={16} className="text-purple-600 dark:text-purple-400" />
                  </div>
                  <span className="font-semibold text-gray-900 dark:text-white">Dados do Trabalho</span>
                </div>
                {expandedSections.job ? (
                  <ChevronUp size={18} className="text-gray-400" />
                ) : (
                  <ChevronDown size={18} className="text-gray-400" />
                )}
              </button>

              {expandedSections.job && (
                <div className="p-4 space-y-4 bg-gray-50/50 dark:bg-gray-800/30">
                  {/* Linha 1: Tipo, Data, Horários */}
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div>
                      <label className={labelClasses}>Tipo *</label>
                      <select
                        value={jobData.job_type}
                        onChange={(e) => setJobData((p) => ({ ...p, job_type: e.target.value }))}
                        className={selectClasses}
                      >
                        {jobTypes.map((type) => (
                          <option key={type} value={type} className="bg-white dark:bg-gray-800">
                            {type}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className={labelClasses}>Data *</label>
                      <input
                        type="date"
                        value={jobData.job_date}
                        onChange={(e) => setJobData((p) => ({ ...p, job_date: e.target.value }))}
                        className={`${inputClasses} [color-scheme:light] dark:[color-scheme:dark]`}
                      />
                    </div>
                    <div>
                      <label className={labelClasses}>Início</label>
                      <input
                        type="time"
                        value={jobData.job_time}
                        onChange={(e) => setJobData((p) => ({ ...p, job_time: e.target.value }))}
                        className={`${inputClasses} [color-scheme:light] dark:[color-scheme:dark]`}
                      />
                    </div>
                    <div>
                      <label className={labelClasses}>Término</label>
                      <input
                        type="time"
                        value={jobData.job_end_time}
                        onChange={(e) => setJobData((p) => ({ ...p, job_end_time: e.target.value }))}
                        className={`${inputClasses} [color-scheme:light] dark:[color-scheme:dark]`}
                      />
                    </div>
                  </div>

                  {/* Linha 2: Local do ensaio */}
                  <div>
                    <label className={labelClasses}>Local do Ensaio</label>
                    <input
                      value={jobData.location}
                      onChange={(e) => setJobData((p) => ({ ...p, location: e.target.value }))}
                      className={inputClasses}
                      placeholder="Endereço ou nome do local"
                    />
                  </div>

                  {/* Linha 3: Valor, Forma de pagamento, Status pagamento */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className={labelClasses}>Valor *</label>
                      <input
                        type="number"
                        value={jobData.amount}
                        onChange={(e) => setJobData((p) => ({ ...p, amount: Number(e.target.value) }))}
                        className={`${inputClasses} [color-scheme:light] dark:[color-scheme:dark]`}
                        placeholder="0,00"
                      />
                    </div>
                    <div>
                      <label className={labelClasses}>Forma de Pagamento</label>
                      <select
                        value={jobData.payment_method}
                        onChange={(e) => setJobData((p) => ({ ...p, payment_method: e.target.value }))}
                        className={selectClasses}
                      >
                        <option className="bg-white dark:bg-gray-800">Pix</option>
                        <option className="bg-white dark:bg-gray-800">Cartão de Crédito</option>
                        <option className="bg-white dark:bg-gray-800">Cartão de Débito</option>
                        <option className="bg-white dark:bg-gray-800">Dinheiro</option>
                        <option className="bg-white dark:bg-gray-800">Boleto</option>
                        <option className="bg-white dark:bg-gray-800">Transferência</option>
                      </select>
                    </div>
                    <div>
                      <label className={labelClasses}>Status do Pagamento</label>
                      <select
                        value={jobData.payment_status}
                        onChange={(e) => setJobData((p) => ({ ...p, payment_status: e.target.value }))}
                        className={selectClasses}
                      >
                        <option value="pending" className="bg-white dark:bg-gray-800">Pendente</option>
                        <option value="partial" className="bg-white dark:bg-gray-800">Parcial</option>
                        <option value="paid" className="bg-white dark:bg-gray-800">Pago</option>
                      </select>
                    </div>
                  </div>

                  {/* Linha 4: Status do trabalho */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className={labelClasses}>Status do Trabalho</label>
                      <select
                        value={jobData.status}
                        onChange={(e) => setJobData((p) => ({ ...p, status: e.target.value }))}
                        className={selectClasses}
                      >
                        <option value="scheduled" className="bg-white dark:bg-gray-800">Agendado</option>
                        <option value="in_progress" className="bg-white dark:bg-gray-800">Em Andamento</option>
                        <option value="editing" className="bg-white dark:bg-gray-800">Em Edição</option>
                        <option value="completed" className="bg-white dark:bg-gray-800">Concluído</option>
                        <option value="delivered" className="bg-white dark:bg-gray-800">Entregue</option>
                        <option value="cancelled" className="bg-white dark:bg-gray-800">Cancelado</option>
                      </select>
                    </div>
                  </div>

                  {/* Linha 5: Notas do trabalho */}
                  <div>
                    <label className={labelClasses}>Observações do Trabalho</label>
                    <textarea
                      value={jobData.notes}
                      onChange={(e) => setJobData((p) => ({ ...p, notes: e.target.value }))}
                      className={`${inputClasses} resize-none`}
                      rows={2}
                      placeholder="Detalhes sobre o ensaio, preferências, etc..."
                    />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-6 border-t border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/30">
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-400 dark:text-gray-500">
              {createClient && createJob && "Cliente e trabalho serão criados automaticamente"}
              {createClient && !createJob && "Apenas o cliente será cadastrado"}
              {!createClient && createJob && "Apenas o trabalho será criado"}
              {!createClient && !createJob && "Nenhuma ação será realizada"}
            </p>
            <div className="flex gap-3">
              <button 
                onClick={onClose} 
                className="px-5 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-sm font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                Cancelar
              </button>
              <button 
                onClick={submit} 
                disabled={!canSubmit || isSubmitting}
                className="px-5 py-2.5 rounded-xl bg-emerald-600 dark:bg-emerald-500 text-white text-sm font-semibold flex items-center gap-2 hover:bg-emerald-700 dark:hover:bg-emerald-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? (
                  <>
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Convertendo...
                  </>
                ) : (
                  <>
                    <CheckIcon /> Converter e Salvar
                  </>
                )}
              </button>
            </div>
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

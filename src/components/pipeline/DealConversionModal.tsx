// src/components/vendas/DealConversionModal.tsx
import React, { useEffect, useState, useMemo } from "react";
import { motion } from "motion/react";
import { Plus, User, Briefcase, ChevronDown, ChevronUp, Link2, DollarSign } from "lucide-react";

import { Deal, Client } from "../../types";
import { authFetch } from "../../utils/authFetch";

interface DealConversionModalProps {
  deal: Deal | null;
  clients?: Client[]; // ← ADICIONAR para vincular cliente existente
  onClose: () => void;
  onConverted: () => void;
}

export function DealConversionModal({ 
  deal, 
  clients = [],
  onClose, 
  onConverted 
}: DealConversionModalProps) {
  const [conversionMode, setConversionMode] = useState<"new" | "existing">("new");
  const [selectedClientId, setSelectedClientId] = useState<number | null>(null);
  const [createClient, setCreateClient] = useState(true);
  const [createJob, setCreateJob] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sinalAmount, setSinalAmount] = useState(0);
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
      if (deal.client_id) {
        setConversionMode("existing");
        setSelectedClientId(deal.client_id);
        setCreateClient(false);
      }
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
      setSinalAmount(0);
    }
  }, [deal]);

  // Deriva o payment_status automaticamente do sinal
  const autoPaymentStatus = useMemo(() => {
    const total = jobData.amount || 0;
    if (sinalAmount <= 0) return "pending";
    if (sinalAmount >= total) return "paid";
    return "partial";
  }, [sinalAmount, jobData.amount]);

  // Sincroniza payment_status com o sinal
  useEffect(() => {
    setJobData(prev => ({ ...prev, payment_status: autoPaymentStatus }));
  }, [autoPaymentStatus]);

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
      const jobPayload = createJob ? {
        ...jobData,
        payment_status: autoPaymentStatus,
        notes: [
          jobData.notes,
          sinalAmount > 0 ? `Sinal pago: R$ ${sinalAmount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '',
        ].filter(Boolean).join('\n').trim(),
      } : undefined;

      await authFetch(`/api/deals/${deal.id}/convert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          existingClientId: conversionMode === "existing" ? selectedClientId : undefined,
          createClient: conversionMode === "new" && createClient,
          createJob,
          client: conversionMode === "new" && createClient ? clientData : undefined,
          job: jobPayload,
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

  const canSubmit = conversionMode === "existing" 
    ? selectedClientId !== null 
    : (createClient ? (clientData.name && clientData.phone) : true);

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
              🎉 Fechado Ganho
            </p>
            <h3 className="text-xl font-bold text-gray-900 dark:text-white">
              Converter "{deal.title}" em venda
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Vincule a um cliente existente ou cadastre um novo
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
          
          {/* ====== MODO DE CONVERSÃO ====== */}
          <div className="p-4 bg-gray-50 dark:bg-gray-800/50 rounded-xl space-y-3">
            <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase">
              Como deseja registrar este cliente?
            </label>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => {
                  setConversionMode("existing");
                  setCreateClient(false);
                }}
                className={`flex-1 p-3 rounded-xl border-2 transition-all flex items-center gap-2 ${
                  conversionMode === "existing"
                    ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300"
                    : "border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600"
                }`}
              >
                <Link2 size={18} />
                <div className="text-left">
                  <p className="font-semibold text-sm">Vincular a cliente existente</p>
                  <p className="text-xs opacity-70">Selecione da sua base</p>
                </div>
              </button>
              <button
                type="button"
                onClick={() => {
                  setConversionMode("new");
                  setCreateClient(true);
                }}
                className={`flex-1 p-3 rounded-xl border-2 transition-all flex items-center gap-2 ${
                  conversionMode === "new"
                    ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300"
                    : "border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600"
                }`}
              >
                <User size={18} />
                <div className="text-left">
                  <p className="font-semibold text-sm">Cadastrar novo cliente</p>
                  <p className="text-xs opacity-70">Preencha os dados abaixo</p>
                </div>
              </button>
            </div>
          </div>

          {/* ====== RESUMO FINANCEIRO ====== */}
          {(() => {
            const total = jobData.amount || 0;
            const restante = Math.max(0, total - sinalAmount);
            const pct = total > 0 ? Math.min(100, (sinalAmount / total) * 100) : 0;
            const pctFormatted = pct.toFixed(0);
            const barColor = pct >= 100 ? 'bg-emerald-500' : pct >= 50 ? 'bg-amber-400' : 'bg-blue-400';
            return (
              <div className="border border-emerald-200 dark:border-emerald-800 rounded-xl overflow-hidden">
                <div className="bg-emerald-50 dark:bg-emerald-950/30 px-4 py-3 flex items-center gap-2 border-b border-emerald-100 dark:border-emerald-800">
                  <DollarSign size={14} className="text-emerald-600 dark:text-emerald-400" />
                  <span className="text-xs font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wide">Resumo Financeiro</span>
                  {deal?.items && deal.items.length > 0 && (
                    <span className="ml-auto text-[10px] text-emerald-600 dark:text-emerald-500 font-medium">
                      {deal.items.length} {deal.items.length === 1 ? 'item' : 'itens'} vinculados
                    </span>
                  )}
                </div>
                <div className="p-4 space-y-4 bg-white dark:bg-gray-900">
                  {/* Linha: Total / Sinal / Restante */}
                  <div className="grid grid-cols-3 gap-3">
                    <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-3">
                      <p className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase mb-1">Valor Total</p>
                      <p className="text-base font-bold text-gray-900 dark:text-white">
                        R$ {total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                      </p>
                    </div>
                    <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-3 border border-blue-100 dark:border-blue-800">
                      <p className="text-[10px] font-semibold text-blue-500 dark:text-blue-400 uppercase mb-1">Sinal Pago</p>
                      <input
                        type="number"
                        min={0}
                        max={total}
                        step={0.01}
                        value={sinalAmount || ""}
                        onChange={e => setSinalAmount(parseFloat(e.target.value) || 0)}
                        placeholder="0,00"
                        className="w-full bg-transparent text-base font-bold text-blue-700 dark:text-blue-300 outline-none placeholder-blue-300 dark:placeholder-blue-700 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      />
                    </div>
                    <div className={`rounded-xl p-3 ${restante === 0 && total > 0 ? 'bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-800' : 'bg-orange-50 dark:bg-orange-900/20 border border-orange-100 dark:border-orange-800'}`}>
                      <p className={`text-[10px] font-semibold uppercase mb-1 ${restante === 0 && total > 0 ? 'text-emerald-500' : 'text-orange-500'}`}>Restante</p>
                      <p className={`text-base font-bold ${restante === 0 && total > 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-orange-700 dark:text-orange-300'}`}>
                        R$ {restante.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                      </p>
                    </div>
                  </div>

                  {/* Barra de progresso */}
                  {total > 0 && (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-gray-400 dark:text-gray-500">Progresso do pagamento</span>
                        <span className={`font-bold ${pct >= 100 ? 'text-emerald-600 dark:text-emerald-400' : pct >= 50 ? 'text-amber-600 dark:text-amber-400' : 'text-blue-600 dark:text-blue-400'}`}>
                          {pctFormatted}% pago
                        </span>
                      </div>
                      <div className="h-2.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-300 ${barColor}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <p className="text-[11px] text-gray-400 dark:text-gray-500 text-center">
                        {pct >= 100
                          ? '✓ Pagamento completo'
                          : sinalAmount > 0
                          ? `Falta R$ ${restante.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} para quitação`
                          : 'Nenhum sinal registrado'}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {/* ====== SELECIONAR CLIENTE EXISTENTE ====== */}
          {conversionMode === "existing" && (
            <div className="border border-gray-100 dark:border-gray-800 rounded-xl p-4 bg-blue-50/30 dark:bg-blue-950/10">
              <label className={labelClasses}>
                <Link2 size={12} className="inline mr-1" />
                Selecione o Cliente
              </label>
              <select
                value={selectedClientId || ""}
                onChange={(e) => setSelectedClientId(e.target.value ? Number(e.target.value) : null)}
                className={selectClasses}
              >
                <option value="" className="bg-white dark:bg-gray-800">
                  -- Selecione um cliente --
                </option>
                {clients.map((client) => (
                  <option key={client.id} value={client.id} className="bg-white dark:bg-gray-800">
                    {client.name} {client.phone ? `- ${client.phone}` : ""} {client.email ? `(${client.email})` : ""}
                  </option>
                ))}
              </select>
              {selectedClientId && (
                <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-2">
                  ✓ O deal será vinculado a este cliente
                </p>
              )}
            </div>
          )}

          {/* Checkbox criar trabalho */}
          <div className="flex items-center p-4 bg-gray-50 dark:bg-gray-800/50 rounded-xl">
            <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-300 cursor-pointer select-none">
              <input 
                type="checkbox" 
                checked={createJob} 
                onChange={(e) => setCreateJob(e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-emerald-600 focus:ring-emerald-500 dark:focus:ring-emerald-400 bg-white dark:bg-gray-800"
              />
              <Briefcase size={16} className="text-purple-500" />
              Criar trabalho/ensaio junto
            </label>
          </div>

          {/* ==================== SEÇÃO CLIENTE (só se for novo) ==================== */}
          {conversionMode === "new" && createClient && (
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
                  <span className="font-semibold text-gray-900 dark:text-white">Dados do Novo Cliente</span>
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
                      <label className={labelClasses}>Valor Total *</label>
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
                      <div className={`px-3 py-2 rounded-lg text-sm font-semibold border ${
                        autoPaymentStatus === 'paid'
                          ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
                          : autoPaymentStatus === 'partial'
                          ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800'
                          : 'bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-700'
                      }`}>
                        {autoPaymentStatus === 'paid' ? '✓ Pago' : autoPaymentStatus === 'partial' ? '◑ Parcial' : '○ Pendente'}
                        <p className="text-[10px] font-normal opacity-70 mt-0.5">Calculado pelo sinal</p>
                      </div>
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
              {conversionMode === "existing" && selectedClientId && "Deal será vinculado ao cliente selecionado"}
              {conversionMode === "existing" && !selectedClientId && "Selecione um cliente para continuar"}
              {conversionMode === "new" && createClient && createJob && "Novo cliente e trabalho serão criados"}
              {conversionMode === "new" && createClient && !createJob && "Apenas o novo cliente será cadastrado"}
              {conversionMode === "new" && !createClient && createJob && "Apenas o trabalho será criado"}
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

import React, { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Save, Loader2, UserPlus } from "lucide-react";
import { authFetch } from "../../../utils/authFetch";
import { Deal, PipelineStage } from "../../../types";

interface Props {
  phone: string;
  contactName?: string | null;
  deals: Deal[];
  stages: PipelineStage[];
  onDealUpdated: () => void;
}

export function CrmPanel({ phone, contactName, deals, stages, onDealUpdated }: Props) {
  const [savingStage, setSavingStage] = useState(false);
  const [savingNote, setSavingNote] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [stagesOpen, setStagesOpen] = useState(true);
  const [creating, setCreating] = useState(false);

  // Deal vinculado a esse telefone
  const deal = deals.find(
    (d) => d.contact_phone?.replace(/\D/g, "") === phone.replace(/\D/g, "")
  );

  useEffect(() => {
    setNoteText(deal?.notes || "");
  }, [deal?.id]);

  const activeStages = stages.filter((s) => !s.is_final);
  const finalStages = stages.filter((s) => s.is_final);

  const currentStage = stages.find((s) => s.id === deal?.stage);

  const handleStageChange = async (stageId: string) => {
    if (!deal || savingStage) return;
    setSavingStage(true);
    try {
      await authFetch(`/api/deals/${deal.id}`, {
        method: "PATCH",
        body: JSON.stringify({ stage: stageId }),
      });
      onDealUpdated();
    } finally {
      setSavingStage(false);
    }
  };

  const handleSaveNote = async () => {
    if (!deal || savingNote) return;
    setSavingNote(true);
    try {
      await authFetch(`/api/deals/${deal.id}`, {
        method: "PATCH",
        body: JSON.stringify({ notes: noteText }),
      });
      onDealUpdated();
    } finally {
      setSavingNote(false);
    }
  };

  const handleCreateDeal = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const firstStage = activeStages[0];
      await authFetch("/api/deals", {
        method: "POST",
        body: JSON.stringify({
          title: contactName || phone,
          contact_name: contactName || null,
          contact_phone: phone,
          stage: firstStage?.id || "new",
          value: 0,
          priority: "medium",
        }),
      });
      onDealUpdated();
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0 bg-white dark:bg-gray-800 border-l border-gray-200 dark:border-gray-700 overflow-y-auto">
      {/* Header */}
      <div className="px-4 py-4 border-b border-gray-100 dark:border-gray-700">
        <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">CRM</p>
        <p className="text-base font-bold text-gray-900 dark:text-white truncate">
          {contactName || phone}
        </p>
        {contactName && <p className="text-xs text-gray-400 mt-0.5">{phone}</p>}

        {/* Badge de fase atual */}
        {currentStage && (
          <div className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold"
            style={{ background: `${currentStage.color}22`, color: currentStage.color }}>
            <span className="w-2 h-2 rounded-full" style={{ background: currentStage.color }} />
            {currentStage.name}
          </div>
        )}
      </div>

      {!deal ? (
        /* Sem deal — botão criar */
        <div className="flex flex-col items-center justify-center flex-1 gap-4 px-5 text-center">
          <div className="w-12 h-12 rounded-full bg-indigo-50 dark:bg-indigo-900/30 flex items-center justify-center">
            <UserPlus size={22} className="text-indigo-500" />
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">Sem lead no pipeline</p>
            <p className="text-xs text-gray-400 mt-1">Adicione esta conversa ao funil de vendas</p>
          </div>
          <button
            onClick={handleCreateDeal}
            disabled={creating}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition-colors"
          >
            {creating ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />}
            Adicionar ao funil
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-1 py-2">
          {/* Fases */}
          <div className="px-4">
            <button
              onClick={() => setStagesOpen((v) => !v)}
              className="flex items-center justify-between w-full py-2"
            >
              <span className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Fase do Lead
              </span>
              {stagesOpen ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
            </button>

            {stagesOpen && (
              <div className="flex flex-col gap-1 pb-3">
                {activeStages.map((stage) => {
                  const isActive = deal.stage === stage.id;
                  return (
                    <button
                      key={stage.id}
                      onClick={() => handleStageChange(stage.id)}
                      disabled={savingStage}
                      className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-left transition-all ${
                        isActive
                          ? "font-semibold"
                          : "text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                      }`}
                      style={isActive ? { background: `${stage.color}18`, color: stage.color } : {}}
                    >
                      <span
                        className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                        style={{ background: stage.color }}
                      />
                      {stage.name}
                      {isActive && savingStage && <Loader2 size={12} className="animate-spin ml-auto" />}
                    </button>
                  );
                })}

                {finalStages.length > 0 && (
                  <>
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider px-1 mt-2 mb-1">Finalizar</p>
                    {finalStages.map((stage) => {
                      const isActive = deal.stage === stage.id;
                      return (
                        <button
                          key={stage.id}
                          onClick={() => handleStageChange(stage.id)}
                          disabled={savingStage}
                          className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-left transition-all ${
                            isActive ? "font-semibold" : "text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                          }`}
                          style={isActive ? { background: `${stage.color}18`, color: stage.color } : {}}
                        >
                          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: stage.color }} />
                          {stage.name}
                        </button>
                      );
                    })}
                  </>
                )}
              </div>
            )}
          </div>

          <div className="mx-4 h-px bg-gray-100 dark:bg-gray-700" />

          {/* Valor */}
          <div className="px-4 py-3">
            <p className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Valor Estimado</p>
            <p className="text-xl font-bold text-indigo-600">
              {new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(deal.value || 0)}
            </p>
          </div>

          <div className="mx-4 h-px bg-gray-100 dark:bg-gray-700" />

          {/* Anotações */}
          <div className="px-4 py-3 flex flex-col gap-2">
            <p className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Anotações</p>
            <textarea
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder="Escreva sobre essa conversa..."
              rows={4}
              className="w-full text-sm text-gray-700 dark:text-gray-200 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2.5 outline-none resize-none focus:border-indigo-400 transition-colors"
            />
            <button
              onClick={handleSaveNote}
              disabled={savingNote || noteText === (deal.notes || "")}
              className="flex items-center justify-center gap-2 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white text-sm font-semibold rounded-lg transition-colors"
            >
              {savingNote ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
              Salvar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

import React, { useState, useEffect } from "react";
import { format } from "date-fns";
import { X, Trash2, CheckCircle, XCircle } from "lucide-react";
import { ConfirmModal } from "../ui/ConfirmModal";
import { Deal, Client, PipelineStage, DealActivity, StageHistoryEntry } from "../../types";
import { authFetch } from "../../utils/authFetch";

interface DealDetailDrawerProps {
  deal: Deal | null;
  client?: Client;
  stages: PipelineStage[];
  onClose: () => void;
  onUpdate: (options?: { silent?: boolean }) => void | Promise<void>;
}

export function DealDetailDrawer({
  deal,
  client,
  stages,
  onClose,
  onUpdate,
}: DealDetailDrawerProps) {
  const [activities, setActivities] = useState<DealActivity[]>([]);
  const [loadingActivities, setLoadingActivities] = useState(false);
  const [newActivity, setNewActivity] = useState({ type: "note", description: "" });
  const [followUp, setFollowUp] = useState("");
  const [notes, setNotes] = useState("");
  const [history, setHistory] = useState<StageHistoryEntry[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState(false);
  const [confirmModal, setConfirmModal] = useState<{
    open: boolean;
    onConfirm: () => void;
    title: string;
    message: string;
    variant?: "danger" | "warning";
  }>({ open: false, onConfirm: () => {}, title: "", message: "" });

  useEffect(() => {
    if (deal) {
      setFollowUp(deal.next_follow_up || "");
      setNotes(deal.notes || "");
      setHistory([]);
      setHistoryError(false);
      loadActivities();
      loadHistory();
    }
  }, [deal]);

  const loadActivities = async () => {
    if (!deal) return;
    const dealId = String(deal.id);
    setLoadingActivities(true);
    try {
      const res = await authFetch(`/api/deals/${dealId}/activities`);
      setActivities(await res.json());
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingActivities(false);
    }
  };

  const addActivity = async () => {
    if (!deal || !newActivity.description.trim()) return;
    const dealId = String(deal.id);
    await authFetch(`/api/deals/${dealId}/activities`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newActivity),
    });
    setNewActivity({ type: "note", description: "" });
    loadActivities();
    onUpdate();
  };

  const loadHistory = async () => {
    if (!deal) return;
    const dealId = String(deal.id);
    setLoadingHistory(true);
    try {
      const res = await authFetch(`/api/deals/${dealId}/history`);
      const data = await res.json();
      setHistory(Array.isArray(data) ? data : []);
      setHistoryError(false);
    } catch (e) {
      console.error(e);
      setHistory([]);
      setHistoryError(true);
    } finally {
      setLoadingHistory(false);
    }
  };

  const updateDeal = async (data: Partial<Deal>) => {
    if (!deal) return;
    const dealId = String(deal.id);
    await authFetch(`/api/deals/${dealId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    onUpdate();
  };

  const deleteDeal = () => {
    if (!deal) return;
    const dealId = String(deal.id);
    setConfirmModal({
      open: true,
      title: "Excluir negócio",
      message: "Tem certeza que deseja excluir este negócio?",
      variant: "danger",
      onConfirm: async () => {
        await authFetch(`/api/deals/${dealId}`, { method: "DELETE" });
        onClose();
        onUpdate();
      },
    });
  };

  const markAsWon = async () => {
    const wonStage = stages.find((s) => s.is_final && s.is_won);
    if (wonStage) {
      await updateDeal({ stage: wonStage.id });
      onClose();
    }
  };

  const markAsLost = async () => {
    const lostStage = stages.find((s) => s.is_final && !s.is_won);
    if (lostStage) {
      await updateDeal({ stage: lostStage.id });
      onClose();
    }
  };

  if (!deal) return null;

  const currentStage = stages.find((s) => s.id === deal.stage);
  const safeHistory = Array.isArray(history) ? history : [];

  const formatDuration = (start: string, end?: string | null) => {
    const startDate = new Date(start);
    const endDate = end ? new Date(end) : new Date();
    const diffMs = Math.max(0, endDate.getTime() - startDate.getTime());
    const minutes = Math.floor(diffMs / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    if (days > 0) return `${days} dia${days > 1 ? "s" : ""}`;
    if (hours > 0) return `${hours} h`;
    return `${Math.max(1, minutes)} min`;
  };

  const timeSince = (start: string) => {
    const startDate = new Date(start);
    const diffMs = Math.max(0, Date.now() - startDate.getTime());
    const minutes = Math.floor(diffMs / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    if (days > 0) return `${days} dia${days > 1 ? "s" : ""}`;
    if (hours > 0) return `${hours} h`;
    return `${Math.max(1, minutes)} min`;
  };

  return (
    <>
      <div className="fixed inset-0 z-50 flex justify-end">
        <div className="absolute inset-0 bg-black/30 dark:bg-black/60" onClick={onClose} />
        <div className="relative w-full max-w-lg bg-white dark:bg-gray-900 h-full shadow-xl dark:shadow-2xl dark:shadow-black/40 overflow-y-auto">
          {/* Header */}
          <div className="sticky top-0 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 p-4 z-10">
            <div className="flex items-start justify-between">
              <div className="flex-1 min-w-0">
                <h2 className="text-lg font-bold text-gray-900 dark:text-white truncate">{deal.title}</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Etapa: {currentStage?.name || deal.stage}
                </p>
              </div>
              <button
                onClick={onClose}
                className="p-1 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 rounded transition-colors"
              >
                <X size={20} />
              </button>
            </div>
          </div>

          <div className="p-4 space-y-6">
            {/* Histórico do Lead */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                  Histórico do Lead
                </label>
                {loadingHistory && (
                  <span className="text-[11px] text-gray-400 dark:text-gray-500">Carregando...</span>
                )}
              </div>
              <div className="space-y-4">
                {historyError && !loadingHistory && (
                  <p className="text-xs text-red-500 dark:text-red-400">Histórico não disponível</p>
                )}
                {!historyError && !loadingHistory && safeHistory.length === 0 && (
                  <p className="text-xs text-gray-400 dark:text-gray-500">Sem histórico registrado</p>
                )}
                {safeHistory.map((entry, idx) => {
                  const isCurrent = !entry.left_at;
                  const isLast = idx === safeHistory.length - 1;
                  return (
                    <div
                      key={`${entry.stage_id}-${entry.entered_at}-${idx}`}
                      className="flex gap-3"
                    >
                      <div className="flex flex-col items-center">
                        <span
                          className={`w-3 h-3 rounded-full ${
                            isCurrent ? "bg-emerald-500" : "bg-gray-300 dark:bg-gray-600"
                          }`}
                        />
                        {!isLast && (
                          <span className="flex-1 w-px bg-gray-200 dark:bg-gray-700 mt-1 mb-1" />
                        )}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-gray-900 dark:text-white">
                            {entry.stage_name || entry.stage_id}
                          </span>
                          {isCurrent && (
                            <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400">
                              Atual
                            </span>
                          )}
                        </div>
                        <p
                          className={`text-xs ${
                            isCurrent ? "text-emerald-700 dark:text-emerald-400" : "text-gray-500 dark:text-gray-400"
                          }`}
                        >
                          {isCurrent
                            ? `há ${timeSince(entry.entered_at)}`
                            : formatDuration(entry.entered_at, entry.left_at)}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Info principal */}
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Valor</label>
                <p className="text-lg font-bold text-gray-900 dark:text-white">
                  R$ {(deal.value || 0).toLocaleString("pt-BR")}
                </p>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Previsão</label>
                <p className="text-sm text-gray-900 dark:text-white">
                  {deal.expected_close_date
                    ? format(new Date(deal.expected_close_date), "dd/MM/yyyy")
                    : "-"}
                </p>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Prioridade</label>
                <p className="text-sm text-gray-900 dark:text-white capitalize">{deal.priority || "Média"}</p>
              </div>
            </div>

            {/* Cliente */}
            <div>
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Cliente</label>
              <p className="text-sm text-gray-900 dark:text-white">
                {client?.name || deal.client_name || "Não informado"}
              </p>
            </div>

            {/* Follow-up */}
            <div>
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase block mb-1">
                Próximo Follow-up
              </label>
              <div className="flex gap-2">
                <input
                  type="date"
                  value={followUp}
                  onChange={(e) => setFollowUp(e.target.value)}
                  className="flex-1 border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white outline-none focus:border-gray-400 dark:focus:border-gray-600 [color-scheme:light] dark:[color-scheme:dark]"
                />
                <button
                  onClick={() => updateDeal({ next_follow_up: followUp })}
                  className="px-3 py-2 bg-gray-900 dark:bg-white text-white dark:text-gray-900 text-sm rounded-lg hover:bg-gray-800 dark:hover:bg-gray-100 transition-colors"
                >
                  Salvar
                </button>
              </div>
            </div>

            {/* Atividades */}
            <div>
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase block mb-2">
                Atividades
              </label>
              
              <div className="space-y-2 max-h-48 overflow-y-auto mb-3">
                {loadingActivities ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400">Carregando...</p>
                ) : activities.length === 0 ? (
                  <p className="text-sm text-gray-400 dark:text-gray-500">Nenhuma atividade registrada</p>
                ) : (
                  activities.map((act) => (
                    <div key={act.id} className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
                      <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 mb-1">
                        <span className="font-medium uppercase">{act.type}</span>
                        <span>•</span>
                        <span>{format(new Date(act.created_at), "dd/MM/yyyy HH:mm")}</span>
                      </div>
                      <p className="text-sm text-gray-700 dark:text-gray-300">{act.description}</p>
                    </div>
                  ))
                )}
              </div>

              <div className="flex gap-2">
                <select
                  value={newActivity.type}
                  onChange={(e) => setNewActivity({ ...newActivity, type: e.target.value })}
                  className="border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 rounded-lg px-2 py-2 text-sm text-gray-900 dark:text-white outline-none focus:border-gray-400 dark:focus:border-gray-600"
                >
                  <option value="note">Nota</option>
                  <option value="call">Ligação</option>
                  <option value="email">Email</option>
                  <option value="meeting">Reunião</option>
                </select>
                <input
                  value={newActivity.description}
                  onChange={(e) => setNewActivity({ ...newActivity, description: e.target.value })}
                  placeholder="Descrição da atividade..."
                  className="flex-1 border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 outline-none focus:border-gray-400 dark:focus:border-gray-600"
                  onKeyDown={(e) => e.key === "Enter" && addActivity()}
                />
                <button
                  onClick={addActivity}
                  className="px-3 py-2 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 text-sm rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 border border-transparent dark:border-gray-700 transition-colors"
                >
                  +
                </button>
              </div>
            </div>

            {/* Notas */}
            <div>
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase block mb-1">
                Notas
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                onBlur={() => updateDeal({ notes })}
                rows={3}
                className="w-full border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 outline-none focus:border-gray-400 dark:focus:border-gray-600 resize-none"
                placeholder="Anotações sobre o negócio..."
              />
            </div>

            {/* Ações */}
            <div className="border-t border-gray-200 dark:border-gray-800 pt-4 space-y-2">
              <div className="flex gap-2">
                <button
                  onClick={markAsWon}
                  className="flex-1 flex items-center justify-center gap-2 py-2 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 rounded-lg hover:bg-green-100 dark:hover:bg-green-900/30 text-sm font-medium transition-colors"
                >
                  <CheckCircle size={16} />
                  Marcar como Ganho
                </button>
                <button
                  onClick={markAsLost}
                  className="flex-1 flex items-center justify-center gap-2 py-2 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30 text-sm font-medium transition-colors"
                >
                  <XCircle size={16} />
                  Marcar como Perdido
                </button>
              </div>
              <button
                onClick={deleteDeal}
                className="w-full flex items-center justify-center gap-2 py-2 text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg text-sm transition-colors"
              >
                <Trash2 size={16} />
                Excluir Negócio
              </button>
            </div>
          </div>
        </div>
      </div>

      <ConfirmModal
        open={confirmModal.open}
        title={confirmModal.title}
        message={confirmModal.message}
        confirmText="Confirmar"
        variant={confirmModal.variant || "danger"}
        onConfirm={() => {
          confirmModal.onConfirm();
          setConfirmModal((prev) => ({ ...prev, open: false }));
        }}
        onCancel={() =>
          setConfirmModal((prev) => ({ ...prev, open: false }))
        }
      />
    </>
  );
}

import React, { useState, useRef, useMemo, useEffect } from "react";
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
} from "@dnd-kit/core";
import { SortableContext } from "@dnd-kit/sortable";
import { Send, X, Loader2, CheckCircle2, AlertCircle, Rocket } from "lucide-react";

import { Deal, PipelineStage, Client } from "../../types";
import { authFetch } from "../../utils/authFetch";
import { DealCard } from "./DealCard";
import { DealDetailDrawer } from "./DealDetailDrawer";

interface FunilTabProps {
  deals: Deal[];
  stages: PipelineStage[];
  clients: Client[];
  onUpdate: (options?: { silent?: boolean }) => void | Promise<void>;
}

// ─── Follow-up Blast Modal ───────────────────────────────────────────────────

interface BlastResult {
  sent: number;
  failed: number;
  total: number;
  errors: string[];
}

interface FollowUpModalProps {
  stage: PipelineStage;
  dealsInStage: Deal[];
  onClose: () => void;
}

function FollowUpModal({ stage, dealsInStage, onClose }: FollowUpModalProps) {
  const withPhone = dealsInStage.filter((d) => d.contact_phone?.trim());
  const [message, setMessage] = useState(stage.follow_up_message || "");
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<BlastResult | null>(null);
  const [error, setError] = useState("");
  const [confirmed, setConfirmed] = useState(false);

  // Salva template sem disparar
  const handleSaveTemplate = async () => {
    if (!message.trim()) return;
    setSaving(true);
    setError("");
    try {
      const res = await authFetch(`/api/pipeline/stages/${stage.id}/follow-up`, {
        method: "PATCH",
        body: JSON.stringify({ message }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.error === "MIGRATION_NEEDED") {
          setError("Para salvar templates, adicione a coluna follow_up_message na tabela deal_stages no Supabase.\nSQL: ALTER TABLE deal_stages ADD COLUMN IF NOT EXISTS follow_up_message TEXT;");
        } else {
          setError(data.error || "Erro ao salvar");
        }
      }
    } catch {
      setError("Erro de conexão");
    } finally {
      setSaving(false);
    }
  };

  // Dispara para todos
  const handleBlast = async () => {
    if (!message.trim() || withPhone.length === 0) return;
    setSending(true);
    setError("");
    setResult(null);
    try {
      const res = await authFetch(`/api/pipeline/stages/${stage.id}/blast`, {
        method: "POST",
        body: JSON.stringify({ message }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Erro ao disparar");
      } else {
        setResult(data);
      }
    } catch {
      setError("Erro de conexão");
    } finally {
      setSending(false);
      setConfirmed(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
          <div className="flex items-center gap-2">
            <Rocket size={18} className="text-gold-500" />
            <div>
              <h2 className="font-bold text-gray-900 dark:text-white text-sm">Follow-up em massa</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">{stage.name}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {/* Contadores */}
          <div className="flex gap-3">
            <div className="flex-1 rounded-xl bg-gray-50 dark:bg-gray-800 p-3 text-center">
              <p className="text-2xl font-bold text-gray-900 dark:text-white">{dealsInStage.length}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">cards na etapa</p>
            </div>
            <div className="flex-1 rounded-xl bg-gold-50 dark:bg-gold-900/20 p-3 text-center">
              <p className="text-2xl font-bold text-gold-600 dark:text-gold-400">{withPhone.length}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">com telefone</p>
            </div>
          </div>

          {withPhone.length === 0 && (
            <div className="rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-3 text-sm text-amber-700 dark:text-amber-400">
              Nenhum contato nesta etapa tem telefone cadastrado.
            </div>
          )}

          {/* Textarea */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide">
              Mensagem
            </label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={5}
              placeholder={"Olá {nome}, tudo bem?\n\nVi que ainda não finalizamos..."}
              className="w-full rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm text-gray-800 dark:text-gray-200 px-4 py-3 outline-none focus:ring-2 focus:ring-gold-400 resize-none placeholder-gray-400"
            />
            <p className="text-[11px] text-gray-400">
              Use <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">{"{nome}"}</code> para personalizar com o nome de cada contato.
            </p>
          </div>

          {/* Prévia da lista */}
          {withPhone.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                Quem vai receber
              </p>
              <div className="max-h-32 overflow-y-auto rounded-xl border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-800">
                {withPhone.map((d) => (
                  <div key={d.id} className="flex items-center justify-between px-3 py-1.5 text-xs">
                    <span className="text-gray-700 dark:text-gray-300 truncate">{d.contact_name || d.title}</span>
                    <span className="text-gray-400 ml-2 flex-shrink-0">{d.contact_phone}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Resultado */}
          {result && (
            <div className={`rounded-xl p-4 text-sm space-y-1 ${
              result.failed === 0
                ? "bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800"
                : "bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800"
            }`}>
              <div className="flex items-center gap-2 font-semibold">
                {result.failed === 0
                  ? <CheckCircle2 size={15} className="text-green-600" />
                  : <AlertCircle size={15} className="text-amber-600" />}
                <span>{result.sent} de {result.total} enviados com sucesso</span>
              </div>
              {result.failed > 0 && (
                <p className="text-xs text-amber-700 dark:text-amber-400 ml-5">
                  Falhas: {result.errors.join(", ")}
                </p>
              )}
            </div>
          )}

          {error && (
            <div className="rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-3 text-xs text-red-700 dark:text-red-400 whitespace-pre-wrap">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex-shrink-0">
          <button
            onClick={handleSaveTemplate}
            disabled={saving || !message.trim()}
            className="px-4 py-2 text-xs font-semibold rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40 transition-colors"
          >
            {saving ? <Loader2 size={13} className="animate-spin inline mr-1" /> : null}
            Salvar template
          </button>

          <div className="flex-1" />

          {!confirmed && !result ? (
            <button
              onClick={() => setConfirmed(true)}
              disabled={!message.trim() || withPhone.length === 0}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-gold-600 hover:bg-gold-700 text-white disabled:opacity-40 transition-colors"
            >
              <Rocket size={13} />
              Disparar para {withPhone.length} contato{withPhone.length !== 1 ? "s" : ""}
            </button>
          ) : confirmed && !result ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">Tem certeza?</span>
              <button
                onClick={() => setConfirmed(false)}
                className="px-3 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                Cancelar
              </button>
              <button
                onClick={handleBlast}
                disabled={sending}
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-gold-600 hover:bg-gold-700 text-white disabled:opacity-40 transition-colors"
              >
                {sending
                  ? <><Loader2 size={13} className="animate-spin" /> Enviando...</>
                  : <><Send size={13} /> Confirmar envio</>}
              </button>
            </div>
          ) : (
            <button
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
            >
              Fechar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── FunilTab ────────────────────────────────────────────────────────────────

export function FunilTab({ deals, stages, clients, onUpdate }: FunilTabProps) {
  const [localDeals, setLocalDeals] = useState<Deal[]>(deals);
  const [activeDeal, setActiveDeal] = useState<Deal | null>(null);
  const [selectedDeal, setSelectedDeal] = useState<Deal | null>(null);
  const [blastStage, setBlastStage] = useState<PipelineStage | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  useEffect(() => {
    setLocalDeals(deals);
    setSelectedDeal((prev) => {
      if (!prev) return prev;
      return deals.find((d) => d.id === prev.id) ?? prev;
    });
  }, [deals]);

  const clientMap = useMemo(() => {
    const map = new Map<number, Client>();
    clients.forEach((c) => map.set(c.id, c));
    return map;
  }, [clients]);

  const activeStages = stages.filter((s) => !s.is_final);

  const dealsByStage = useMemo(() => {
    const map: Record<string, Deal[]> = {};
    activeStages.forEach((s) => (map[s.id] = []));
    localDeals.forEach((d) => {
      if (map[d.stage]) map[d.stage].push(d);
    });
    return map;
  }, [localDeals, activeStages]);

  const handleDragStart = (event: DragStartEvent) => {
    const deal = localDeals.find((d) => String(d.id) === String(event.active.id));
    setActiveDeal(deal || null);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveDeal(null);
    const { active, over } = event;
    if (!over) return;

    const dealId = String(active.id);
    let newStageId = String(over.id);

    const targetDeal = localDeals.find((d) => String(d.id) === newStageId);
    if (targetDeal) newStageId = targetDeal.stage || newStageId;

    const deal = localDeals.find((d) => String(d.id) === dealId);
    const targetStage = stages.find((s) => s.id === newStageId);
    if (!deal || !targetStage || deal.stage === newStageId) return;

    const previousDeals = localDeals.map((d) => ({ ...d }));
    setLocalDeals((prev) =>
      prev.map((d) => (String(d.id) === dealId ? { ...d, stage: newStageId } : d))
    );

    try {
      await authFetch(`/api/deals/${dealId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage: newStageId }),
      });
      onUpdate({ silent: true });
    } catch {
      setLocalDeals(previousDeals);
    }
  };

  return (
    <>
      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="h-full flex flex-col">
          <div ref={boardRef} className="flex-1 overflow-x-auto overflow-y-hidden pb-4">
            <div className="flex gap-4 h-full px-1" style={{ minWidth: "max-content" }}>
              {activeStages.map((stage) => (
                <React.Fragment key={stage.id}>
                  <StageColumn
                    stage={stage}
                    deals={dealsByStage[stage.id] || []}
                    clientMap={clientMap}
                    onDealClick={setSelectedDeal}
                    onFollowUp={() => setBlastStage(stage)}
                  />
                </React.Fragment>
              ))}
            </div>
          </div>
        </div>

        <DragOverlay>
          {activeDeal && (
            <div className="bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg p-3 shadow-lg w-[260px] opacity-95">
              <div className="font-medium text-gray-900 dark:text-white text-sm">{activeDeal.title}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                R$ {(activeDeal.value || 0).toLocaleString("pt-BR")}
              </div>
            </div>
          )}
        </DragOverlay>
      </DndContext>

      <DealDetailDrawer
        deal={selectedDeal}
        client={selectedDeal?.client_id ? clientMap.get(selectedDeal.client_id) : undefined}
        clients={clients}
        stages={stages}
        onClose={() => setSelectedDeal(null)}
        onUpdate={onUpdate}
      />

      {blastStage && (
        <FollowUpModal
          stage={blastStage}
          dealsInStage={dealsByStage[blastStage.id] || []}
          onClose={() => setBlastStage(null)}
        />
      )}
    </>
  );
}

// ─── StageColumn ─────────────────────────────────────────────────────────────

interface StageColumnProps {
  stage: PipelineStage;
  deals: Deal[];
  clientMap: Map<number, Client>;
  onDealClick: (deal: Deal) => void;
  onFollowUp: () => void;
}

function StageColumn({ stage, deals, clientMap, onDealClick, onFollowUp }: StageColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  const totalValue = deals.reduce((sum, d) => sum + (d.value || 0), 0);

  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col flex-shrink-0 w-[280px] min-w-[280px] h-full rounded-lg border transition-colors ${
        isOver
          ? "border-gray-400 dark:border-gray-500 bg-gray-50 dark:bg-gray-800/80"
          : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900"
      }`}
    >
      {/* Header */}
      <div className="flex-shrink-0 p-3 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-gray-900 dark:text-white text-sm truncate">
            {stage.name}
          </h3>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded-full">
              {deals.length}
            </span>
            <button
              onClick={onFollowUp}
              title="Disparar follow-up em massa"
              className="p-1 rounded-md text-gray-400 hover:text-gold-500 hover:bg-gold-50 dark:hover:bg-gold-900/20 transition-colors"
            >
              <Rocket size={14} />
            </button>
          </div>
        </div>
        <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          R$ {totalValue.toLocaleString("pt-BR")}
        </div>
      </div>

      {/* Cards */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        <SortableContext items={deals.map((d) => d.id.toString())}>
          {deals.map((deal) => (
            <React.Fragment key={deal.id}>
              <DealCard
                deal={deal}
                client={deal.client_id ? clientMap.get(deal.client_id) : undefined}
                onClick={() => onDealClick(deal)}
              />
            </React.Fragment>
          ))}
        </SortableContext>

        {deals.length === 0 && (
          <div className="flex items-center justify-center h-20 border border-dashed border-gray-200 dark:border-gray-700 rounded-lg">
            <span className="text-xs text-gray-400 dark:text-gray-500">Arraste negócios aqui</span>
          </div>
        )}
      </div>
    </div>
  );
}

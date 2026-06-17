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

import { Deal, PipelineStage, Client, PipelineLabel, TeamMember } from "../../types";
import { authFetch } from "../../utils/authFetch";
import { DealCard } from "./DealCard";
import { DealDetailDrawer } from "./DealDetailDrawer";
import { useSellers } from "../../hooks/useSellers";
import { SellerAvatar } from "./SellerPicker";
import { useAuth } from "../../contexts/AuthContext";

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

// ─── FunilTab ────────────────────────────────────────────────────────────────

export function FunilTab({ deals, stages, clients, onUpdate }: FunilTabProps) {
  const { canAccess } = useAuth();
  const canSeeFinance = canAccess('finance'); // funcionário sem permissão não vê R$ dos negócios
  const [localDeals, setLocalDeals] = useState<Deal[]>(deals);
  const [activeDeal, setActiveDeal] = useState<Deal | null>(null);
  const [selectedDeal, setSelectedDeal] = useState<Deal | null>(null);
  const [pipelineLabels, setPipelineLabels] = useState<PipelineLabel[]>([]);
  const [sellerFilter, setSellerFilter] = useState<string | 'all' | 'none'>('all');
  const boardRef = useRef<HTMLDivElement>(null);
  // Polling de 5s do parent: enquanto o usuário arrasta (ou nos ~2s seguintes
  // a um movimento local), não deixamos o board ser resetado por um poll com
  // dado antigo — senão o card "pula" de volta antes do servidor confirmar.
  const isDraggingRef = useRef(false);
  const lastLocalMoveRef = useRef(0);

  const { sellers, byId: sellerById } = useSellers();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  useEffect(() => {
    // Mantém o drawer (selectedDeal) sempre sincronizado com o dado novo.
    setSelectedDeal((prev) => {
      if (!prev) return prev;
      return deals.find((d) => d.id === prev.id) ?? prev;
    });
    // Não sobrescreve o board no meio de um arraste, nem por ~2s após um
    // movimento local (janela pra o PUT confirmar e o poll trazer o estado certo).
    if (isDraggingRef.current) return;
    if (Date.now() - lastLocalMoveRef.current < 2000) return;
    setLocalDeals(deals);
  }, [deals]);

  useEffect(() => {
    authFetch('/api/pipeline/labels').then(r => r.json()).then(d => setPipelineLabels(Array.isArray(d) ? d : [])).catch(() => {});
  }, []);

  const labelMap = useMemo(() => {
    const map = new Map<string, PipelineLabel>();
    pipelineLabels.forEach(l => map.set(l.id, l));
    return map;
  }, [pipelineLabels]);

  const clientMap = useMemo(() => {
    const map = new Map<number, Client>();
    clients.forEach((c) => map.set(c.id, c));
    return map;
  }, [clients]);

  const activeStages = stages.filter((s) => !s.is_final);

  const filteredDeals = useMemo(() => {
    if (sellerFilter === 'all') return localDeals;
    if (sellerFilter === 'none') return localDeals.filter(d => !d.assigned_to);
    return localDeals.filter(d => d.assigned_to === sellerFilter);
  }, [localDeals, sellerFilter]);

  const dealsByStage = useMemo(() => {
    const map: Record<string, Deal[]> = {};
    activeStages.forEach((s) => (map[s.id] = []));
    // Lead com etapa órfã (pipeline recriada → ids mudaram) cai na PRIMEIRA
    // coluna aberta em vez de sumir. Etapas finais (ganho/perda) existem em
    // `stages`, então não são tratadas como órfãs.
    const knownStageIds = new Set(stages.map((s) => s.id));
    const fallbackId = activeStages[0]?.id;
    filteredDeals.forEach((d) => {
      if (map[d.stage]) map[d.stage].push(d);
      else if (fallbackId && !knownStageIds.has(d.stage)) map[fallbackId].push(d);
    });
    // Ordena cada etapa pelo tempo parado nela: quem entrou há mais
    // tempo fica no topo (lead "travado" aparece primeiro).
    const enteredAt = (d: Deal) =>
      new Date(
        (d as any).current_stage_entered_at ||
          (d as any).stage_entered_at ||
          d.created_at ||
          0,
      ).getTime();
    Object.values(map).forEach((arr) =>
      arr.sort((a, b) => enteredAt(a) - enteredAt(b)),
    );
    return map;
  }, [filteredDeals, activeStages, stages]);

  const handleDragStart = (event: DragStartEvent) => {
    isDraggingRef.current = true;
    const deal = localDeals.find((d) => String(d.id) === String(event.active.id));
    setActiveDeal(deal || null);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    isDraggingRef.current = false;
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
    lastLocalMoveRef.current = Date.now();
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
          {sellers.length > 0 && (
            <div className="flex items-center gap-2 px-3 sm:px-2 pt-2 pb-2 sm:pb-3 overflow-x-auto">
              <span className="hidden sm:inline text-xs font-medium text-gray-500 dark:text-gray-400 flex-shrink-0 pl-1">Vendedor:</span>
              <button
                onClick={() => setSellerFilter('all')}
                className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                  sellerFilter === 'all'
                    ? 'bg-gray-900 dark:bg-white text-white dark:text-gray-900'
                    : 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-gray-300'
                }`}
              >
                Todos
              </button>
              {sellers.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setSellerFilter(s.id)}
                  className={`flex-shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                    sellerFilter === s.id
                      ? 'bg-gray-900 dark:bg-white text-white dark:text-gray-900'
                      : 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-gray-300'
                  }`}
                >
                  <SellerAvatar member={s} size={18} />
                  {s.name.split(/\s+/)[0]}
                </button>
              ))}
              <button
                onClick={() => setSellerFilter('none')}
                className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                  sellerFilter === 'none'
                    ? 'bg-gray-900 dark:bg-white text-white dark:text-gray-900'
                    : 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300'
                }`}
              >
                Sem responsável
              </button>
            </div>
          )}
          <div ref={boardRef} className="flex-1 overflow-x-auto overflow-y-hidden pb-4 snap-x snap-mandatory sm:snap-none">
            <div className="flex gap-2 sm:gap-4 h-full px-2 sm:px-1" style={{ minWidth: "max-content" }}>
              {activeStages.map((stage) => (
                <React.Fragment key={stage.id}>
                  <StageColumn
                    stage={stage}
                    deals={dealsByStage[stage.id] || []}
                    clientMap={clientMap}
                    onDealClick={setSelectedDeal}
                    labelMap={labelMap}
                    sellerById={sellerById}
                    canSeeFinance={canSeeFinance}
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
              {canSeeFinance && (
                <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  R$ {(activeDeal.value || 0).toLocaleString("pt-BR")}
                </div>
              )}
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
    </>
  );
}

// ─── StageColumn ─────────────────────────────────────────────────────────────

interface StageColumnProps {
  stage: PipelineStage;
  deals: Deal[];
  clientMap: Map<number, Client>;
  onDealClick: (deal: Deal) => void;
  labelMap: Map<string, PipelineLabel>;
  sellerById: Map<string, TeamMember>;
  canSeeFinance: boolean;
}

function StageColumn({ stage, deals, clientMap, onDealClick, labelMap, sellerById, canSeeFinance }: StageColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  const totalValue = deals.reduce((sum, d) => sum + (d.value || 0), 0);

  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col flex-shrink-0 snap-center w-[85vw] sm:w-[280px] max-w-[320px] sm:min-w-[280px] h-full rounded-lg border transition-colors ${
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
          <span className="text-xs text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded-full">
            {deals.length}
          </span>
        </div>
        {canSeeFinance && (
          <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            R$ {totalValue.toLocaleString("pt-BR")}
          </div>
        )}
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
                labelMap={labelMap}
                seller={deal.assigned_to ? sellerById.get(deal.assigned_to) : undefined}
                canSeeFinance={canSeeFinance}
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

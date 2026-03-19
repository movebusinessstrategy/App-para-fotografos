import React, { useState, useRef, useMemo } from "react";
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
import { SortableContext, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

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

export function FunilTab({ deals, stages, clients, onUpdate }: FunilTabProps) {
  const [localDeals, setLocalDeals] = useState<Deal[]>(deals);
  const [activeDeal, setActiveDeal] = useState<Deal | null>(null);
  const [creatingStage, setCreatingStage] = useState(false);
  const [selectedDeal, setSelectedDeal] = useState<Deal | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  React.useEffect(() => {
    setLocalDeals(deals);
  }, [deals]);

  const clientMap = useMemo(() => {
    const map = new Map<number, Client>();
    clients.forEach((c) => map.set(c.id, c));
    return map;
  }, [clients]);

  // Filtrar apenas etapas não-finais para o kanban principal
  const activeStages = stages.filter((s) => !s.is_final);

  const dealsByStage = useMemo(() => {
    const map: Record<string, Deal[]> = {};
    activeStages.forEach((s) => (map[s.id] = []));
    localDeals.forEach((d) => {
      if (map[d.stage]) {
        map[d.stage].push(d);
      }
    });
    return map;
  }, [localDeals, activeStages]);

  const handleDragStart = (event: DragStartEvent) => {
    const dealId = String(event.active.id);
    const deal = localDeals.find((d) => String(d.id) === dealId);
    setActiveDeal(deal || null);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveDeal(null);
    const { active, over } = event;
    if (!over) return;

    const dealId = String(active.id);
    let newStageId = String(over.id);

    const targetDeal = localDeals.find((d) => String(d.id) === newStageId);
    if (targetDeal) {
      newStageId = targetDeal?.stage || newStageId;
    }

    const deal = localDeals.find((d) => String(d.id) === dealId);
    const targetStage = stages.find((s) => s.id === newStageId);

    if (!deal || !targetStage || deal.stage === newStageId) return;

    const previousDeals = localDeals.map((d) => ({ ...d }));

    // Atualiza localmente primeiro (otimistic update)
    setLocalDeals((prev) =>
      prev.map((d) => (String(d.id) === dealId ? { ...d, stage: newStageId } : d))
    );

    // Persiste no backend
    try {
      await authFetch(`/api/deals/${dealId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage: newStageId }),
      });
      onUpdate({ silent: true });
    } catch (error) {
      console.error("Erro ao mover negócio:", error);
      setLocalDeals(previousDeals);
    }
  };


  return (
    <>
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        {/* Container principal com scroll horizontal */}
        <div className="h-full flex flex-col">
          <div
            ref={boardRef}
            className="flex-1 overflow-x-auto overflow-y-hidden pb-4"
          >
            <div
              className="flex gap-4 h-full px-1"
              style={{ minWidth: "max-content" }}
            >
              {activeStages.map((stage) => (
                <React.Fragment key={stage.id}>
                  <StageColumn
                    stage={stage}
                    deals={dealsByStage[stage.id] || []}
                    clientMap={clientMap}
                    onDealClick={setSelectedDeal}
                  />
                </React.Fragment>
              ))}

              {/* Coluna para adicionar nova etapa */}
            </div>
          </div>

          {/* Scrollbar horizontal customizada */}
          <div className="h-2 bg-gray-100 dark:bg-gray-800 rounded-full mx-4 mb-2 overflow-hidden md:hidden">
            <div className="h-full bg-gray-300 dark:bg-gray-600 rounded-full w-1/3" />
          </div>
        </div>

        <DragOverlay>
          {activeDeal && (
            <div className="bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg p-3 shadow-lg dark:shadow-black/30 w-[260px] opacity-95">
              <div className="font-medium text-gray-900 dark:text-white text-sm">
                {activeDeal.title}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                R$ {(activeDeal.value || 0).toLocaleString("pt-BR")}
              </div>
            </div>
          )}
        </DragOverlay>
      </DndContext>

      <DealDetailDrawer
        deal={selectedDeal}
        client={
          selectedDeal?.client_id
            ? clientMap.get(selectedDeal.client_id)
            : undefined
        }
        stages={stages}
        onClose={() => setSelectedDeal(null)}
        onUpdate={onUpdate}
      />
    </>
  );
}

interface StageColumnProps {
  stage: PipelineStage;
  deals: Deal[];
  clientMap: Map<number, Client>;
  onDealClick: (deal: Deal) => void;
}

function StageColumn({
  stage,
  deals,
  clientMap,
  onDealClick,
}: StageColumnProps) {
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
          <span className="text-xs text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded-full">
            {deals.length}
          </span>
        </div>
        <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          R$ {totalValue.toLocaleString("pt-BR")}
        </div>
      </div>

      {/* Cards - área scrollável vertical */}
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

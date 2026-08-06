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
import { Settings2 } from "lucide-react";

import { Deal, PipelineStage, Client, PipelineLabel, TeamMember, SaleCampaign } from "../../types";
import { authFetch } from "../../utils/authFetch";
import { DealCard } from "./DealCard";
import { DealDetailDrawer } from "./DealDetailDrawer";
import { CampaignManagerModal } from "./CampaignManagerModal";
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
  const [campaigns, setCampaigns] = useState<SaleCampaign[]>([]);
  const [sellerFilter, setSellerFilter] = useState<string | 'all' | 'none'>('all');
  const [campaignFilter, setCampaignFilter] = useState<string | 'all'>('all');
  const [showCampaignManager, setShowCampaignManager] = useState(false);
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
    // Só troca a REFERÊNCIA se o dado mudou de verdade: o poll de 12s cria
    // objetos novos idênticos e a troca de identidade resetava formulários
    // abertos (drawer/modal de conversão) no meio da digitação.
    setSelectedDeal((prev) => {
      if (!prev) return prev;
      const fresh = deals.find((d) => d.id === prev.id);
      if (!fresh) return prev;
      return JSON.stringify(fresh) === JSON.stringify(prev) ? prev : fresh;
    });
    // Não sobrescreve o board no meio de um arraste, nem por ~2s após um
    // movimento local (janela pra o PUT confirmar e o poll trazer o estado certo).
    if (isDraggingRef.current) return;
    if (Date.now() - lastLocalMoveRef.current < 2000) return;
    setLocalDeals(deals);
  }, [deals]);

  const loadCampaigns = () => {
    authFetch('/api/sale-campaigns').then(r => r.ok ? r.json() : []).then(d => setCampaigns(Array.isArray(d) ? d : [])).catch(() => {});
  };

  useEffect(() => {
    authFetch('/api/pipeline/labels').then(r => r.json()).then(d => setPipelineLabels(Array.isArray(d) ? d : [])).catch(() => {});
    loadCampaigns();
  }, []);

  const labelMap = useMemo(() => {
    const map = new Map<string, PipelineLabel>();
    pipelineLabels.forEach(l => map.set(l.id, l));
    return map;
  }, [pipelineLabels]);

  const campaignMap = useMemo(() => {
    const map = new Map<string, SaleCampaign>();
    campaigns.forEach(c => map.set(c.id, c));
    return map;
  }, [campaigns]);

  const clientMap = useMemo(() => {
    const map = new Map<number, Client>();
    clients.forEach((c) => map.set(c.id, c));
    return map;
  }, [clients]);

  const activeStages = stages.filter((s) => !s.is_final);

  const filteredDeals = useMemo(() => {
    let result = localDeals;
    if (sellerFilter === 'none') result = result.filter(d => !d.assigned_to);
    else if (sellerFilter !== 'all') result = result.filter(d => d.assigned_to === sellerFilter);
    if (campaignFilter !== 'all') result = result.filter(d => d.campaign_id === campaignFilter);
    return result;
  }, [localDeals, sellerFilter, campaignFilter]);

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
          <div className={`flex items-center gap-2 px-3 sm:px-2 pb-2 sm:pb-3 overflow-x-auto ${sellers.length > 0 ? '' : 'pt-2'}`}>
            <span className="hidden sm:inline text-xs font-medium text-gray-500 dark:text-gray-400 flex-shrink-0 pl-1">Campanha:</span>
            {campaigns.length > 0 && (
              <>
                <button
                  onClick={() => setCampaignFilter('all')}
                  className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                    campaignFilter === 'all'
                      ? 'bg-gray-900 dark:bg-white text-white dark:text-gray-900'
                      : 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-gray-300'
                  }`}
                >
                  Todas
                </button>
                {campaigns.map((c) => {
                  const active = campaignFilter === c.id;
                  return (
                    <button
                      key={c.id}
                      onClick={() => setCampaignFilter(c.id)}
                      className={`flex-shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                        active
                          ? 'bg-gray-900 dark:bg-white text-white dark:text-gray-900'
                          : 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-gray-300'
                      }`}
                    >
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: c.color }} />
                      {c.name}
                    </button>
                  );
                })}
              </>
            )}
            <button
              onClick={() => setShowCampaignManager(true)}
              className="flex-shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border border-dashed border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:border-pink-400 hover:text-pink-600 transition-colors"
              title="Criar / editar campanhas (vendas especiais)"
            >
              <Settings2 size={13} /> Gerenciar campanhas
            </button>
          </div>
          <div ref={boardRef} className="flex-1 overflow-x-auto overflow-y-hidden bg-[#f5f4f1] pb-5 pt-1 dark:bg-[#111111] snap-x snap-mandatory sm:snap-none">
            <div className="flex h-full gap-3 px-3 sm:gap-5 sm:px-4" style={{ minWidth: "max-content" }}>
              {activeStages.map((stage) => (
                <React.Fragment key={stage.id}>
                  <StageColumn
                    stage={stage}
                    deals={dealsByStage[stage.id] || []}
                    clientMap={clientMap}
                    onDealClick={setSelectedDeal}
                    labelMap={labelMap}
                    campaignMap={campaignMap}
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

      <CampaignManagerModal
        open={showCampaignManager}
        onClose={() => setShowCampaignManager(false)}
        onUpdated={loadCampaigns}
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
  campaignMap: Map<string, SaleCampaign>;
  sellerById: Map<string, TeamMember>;
  canSeeFinance: boolean;
}

function StageColumn({ stage, deals, clientMap, onDealClick, labelMap, campaignMap, sellerById, canSeeFinance }: StageColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  const totalValue = deals.reduce((sum, d) => sum + (d.value || 0), 0);

  return (
    <div
      ref={setNodeRef}
      className={`flex h-full w-[85vw] max-w-[330px] flex-shrink-0 snap-center flex-col rounded-[1.6rem] border transition-colors sm:min-w-[300px] sm:w-[300px] ${
        isOver
          ? "border-gold-500/45 bg-gold-500/[0.07] dark:bg-gold-500/[0.06]"
          : "border-black/[0.055] bg-white/50 dark:border-white/[0.06] dark:bg-white/[0.025]"
      }`}
    >
      {/* Header */}
      <div className="flex-shrink-0 px-4 pb-3 pt-4">
        <div className="flex items-center justify-between">
          <div className="flex min-w-0 items-center gap-2">
            <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: stage.color || '#D4A94A' }} />
            <h3 className="truncate text-[12px] font-bold uppercase tracking-[0.1em] text-gray-700 dark:text-gray-200">{stage.name}</h3>
          </div>
          <span className="rounded-full bg-black/[0.055] px-2 py-0.5 text-[10px] font-semibold text-gray-500 dark:bg-white/[0.07] dark:text-gray-400">
            {deals.length}
          </span>
        </div>
        {canSeeFinance && (
          <p className="mt-2 text-[11px] font-medium tabular-nums text-gray-400 dark:text-gray-500">R$ {totalValue.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</p>
        )}
      </div>

      {/* Cards */}
      <div className="flex-1 space-y-3 overflow-y-auto px-2.5 pb-3">
        <SortableContext items={deals.map((d) => d.id.toString())}>
          {deals.map((deal) => (
            <React.Fragment key={deal.id}>
              <DealCard
                deal={deal}
                client={deal.client_id ? clientMap.get(deal.client_id) : undefined}
                onClick={() => onDealClick(deal)}
                labelMap={labelMap}
                campaignMap={campaignMap}
                seller={deal.assigned_to ? sellerById.get(deal.assigned_to) : undefined}
                canSeeFinance={canSeeFinance}
              />
            </React.Fragment>
          ))}
        </SortableContext>

        {deals.length === 0 && (
          <div className="flex h-24 items-center justify-center rounded-2xl border border-dashed border-black/10 dark:border-white/10">
            <span className="text-[11px] text-gray-400 dark:text-gray-600">Arraste uma oportunidade</span>
          </div>
        )}
      </div>
    </div>
  );
}

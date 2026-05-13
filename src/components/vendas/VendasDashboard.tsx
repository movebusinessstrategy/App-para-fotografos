import React, { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { BarChart3, LayoutGrid, Plus, MessageSquare, Settings, History } from "lucide-react";
import { FunilTab } from "./FunilTab";
import { NewDealModal } from "./NewDealModal";
import { StageCustomizer } from "./StageCustomizer";
import { useApi, refreshApi } from "../../utils/useApi";
import { Deal, PipelineStage, Client } from "../../types";

// Lazy: cada tab vira um chunk próprio, baixado só quando o usuário clicar.
// FunilTab fica eager porque é a tab default (Kanban) — render instantâneo.
const AnalisesTab = lazy(() => import("./AnalisesTab").then(m => ({ default: m.AnalisesTab })));
const HistoricoTab = lazy(() => import("./HistoricoTab").then(m => ({ default: m.HistoricoTab })));
const InboxView = lazy(() => import("../../features/chat/components/InboxView").then(m => ({ default: m.InboxView })));

function TabFallback() {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="flex flex-col items-center gap-3 text-gray-400">
        <div className="w-8 h-8 border-2 border-gray-200 border-t-gold-500 rounded-full animate-spin" />
        <span className="text-sm">Carregando...</span>
      </div>
    </div>
  );
}

type Tab = "inbox" | "kanban" | "historico" | "analises";

export function VendasDashboard() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = (searchParams.get("tab") as Tab) || "kanban";
  const initialPhone = searchParams.get("phone") || "";

  const [tab, setTab] = useState<Tab>(initialTab);
  const [newDealOpen, setNewDealOpen] = useState(false);
  const [customizerOpen, setCustomizerOpen] = useState(false);

  const { data: dealsData, isLoading: dealsLoading, mutate: mutateDeals } = useApi<Deal[]>("/api/deals");
  const { data: stagesData } = useApi<PipelineStage[]>("/api/pipeline/stages");
  const { data: clientsData } = useApi<Client[]>("/api/clients");

  const deals = useMemo(() => Array.isArray(dealsData) ? dealsData : [], [dealsData]);
  const stages = useMemo(() => Array.isArray(stagesData) ? stagesData : [], [stagesData]);
  const clients = useMemo(() => Array.isArray(clientsData) ? clientsData : [], [clientsData]);
  const loading = dealsLoading && !dealsData;

  // Substitui o antigo fetchData() — revalida tudo
  const fetchData = (_options?: { silent?: boolean }) => {
    mutateDeals();
    refreshApi("/api/pipeline/stages");
    refreshApi("/api/clients");
  };

  // Reage à mudança nos params da URL (ex: clique no botão WA de um DealCard)
  useEffect(() => {
    const tabParam = searchParams.get("tab") as Tab | null;
    if (tabParam && tabParam !== tab) {
      setTab(tabParam);
    }
  }, [searchParams]);

  const activeDeals = deals.filter((d) => {
    const stage = stages.find((s) => s.id === d.stage);
    return !stage?.is_final;
  });

  const TABS = [
    { id: "kanban" as Tab, label: "Kanban", icon: LayoutGrid },
    { id: "historico" as Tab, label: "Histórico", icon: History },
    { id: "analises" as Tab, label: "Análises", icon: BarChart3 },
    { id: "inbox" as Tab, label: "Inbox", icon: MessageSquare },
  ];

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Vendas</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            {activeDeals.length} lead{activeDeals.length !== 1 ? "s" : ""} ativos no pipeline
          </p>
        </div>

        <div className="flex items-center gap-2">
          {tab === "kanban" && (
            <button
              onClick={() => setCustomizerOpen(true)}
              className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600 text-sm font-medium transition-colors"
            >
              <Settings size={15} />
              Configurar funil
            </button>
          )}
          <button
            onClick={() => setNewDealOpen(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gold-600 hover:bg-gold-700 text-white text-sm font-semibold transition-colors"
          >
            <Plus size={16} />
            Novo Lead
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 px-6 py-2.5 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
              tab === id
                ? "bg-gold-50 dark:bg-gold-900/30 text-gold-700 dark:text-gold-300"
                : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
            }`}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
      </div>

      {/* Conteúdo — flex-1 para preencher o espaço restante */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="flex flex-col items-center gap-3 text-gray-400">
              <div className="w-8 h-8 border-2 border-gray-200 border-t-gold-500 rounded-full animate-spin" />
              <span className="text-sm">Carregando...</span>
            </div>
          </div>
        ) : tab === "kanban" ? (
          <FunilTab
            deals={deals}
            stages={stages}
            clients={clients}
            onUpdate={fetchData}
          />
        ) : (
          <Suspense fallback={<TabFallback />}>
            {tab === "inbox" ? (
              <InboxView
                deals={deals}
                stages={stages}
                initialPhone={initialPhone}
                onDealUpdated={() => fetchData({ silent: true })}
              />
            ) : tab === "historico" ? (
              <HistoricoTab
                deals={deals}
                stages={stages}
                clients={clients}
              />
            ) : (
              <div className="h-full overflow-y-auto p-6">
                <AnalisesTab deals={deals} stages={stages} />
              </div>
            )}
          </Suspense>
        )}
      </div>

      <NewDealModal
        open={newDealOpen}
        stages={stages}
        clients={clients}
        onClose={() => setNewDealOpen(false)}
        onCreated={() => { setNewDealOpen(false); fetchData(); }}
      />

      <StageCustomizer
        open={customizerOpen}
        stages={stages}
        onClose={() => setCustomizerOpen(false)}
        onUpdated={() => fetchData({ silent: true })}
      />
    </div>
  );
}

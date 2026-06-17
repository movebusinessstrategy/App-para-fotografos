import React, { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { BarChart3, LayoutGrid, MessageCircle, Plus, Settings, History, RefreshCw } from "lucide-react";
import { FunilTab } from "./FunilTab";
import { NewDealModal } from "./NewDealModal";
import { StageCustomizer } from "./StageCustomizer";
import { useApi, refreshApi, liveRefresh } from "../../utils/useApi";
import { Deal, PipelineStage, Client } from "../../types";
import { useAuth } from "../../contexts/AuthContext";

// Lazy: cada tab vira um chunk próprio, baixado só quando o usuário clicar.
// FunilTab fica eager porque é a tab default (Kanban) - render instantâneo.
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
type HistoryFilter = "todos" | "ativos" | "convertidos" | "perdidos";

export function VendasDashboard() {
  const { canAccess } = useAuth();
  const canSeeAnalises = canAccess('vendas_analises'); // aba Análises — pode desmarcar por funcionário
  const canSeeFinance = canAccess('finance'); // mostra/esconde os valores R$ dentro das telas de Vendas
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = (searchParams.get("tab") as Tab) || "kanban";
  const initialPhone = searchParams.get("phone") || "";

  const [tab, setTab] = useState<Tab>(initialTab);
  const [historyInitialFilter, setHistoryInitialFilter] = useState<HistoryFilter>("todos");
  const [newDealOpen, setNewDealOpen] = useState(false);
  const [customizerOpen, setCustomizerOpen] = useState(false);

  // Atualiza sozinho a cada 5s (tempo real). O FunilTab segura o board
  // durante/logo após um arraste pra um poll antigo não "puxar" o card de volta.
  const { data: dealsData, isLoading: dealsLoading, mutate: mutateDeals } = useApi<Deal[]>("/api/deals", liveRefresh);
  const { data: stagesData } = useApi<PipelineStage[]>("/api/pipeline/stages");
  const { data: clientsData } = useApi<Client[]>("/api/clients");

  const deals = useMemo(() => Array.isArray(dealsData) ? dealsData : [], [dealsData]);
  const stages = useMemo(() => Array.isArray(stagesData) ? stagesData : [], [stagesData]);
  const clients = useMemo(() => Array.isArray(clientsData) ? clientsData : [], [clientsData]);
  const loading = dealsLoading && !dealsData;

  const [refreshing, setRefreshing] = useState(false);

  // Substitui o antigo fetchData() - revalida tudo
  const fetchData = async (_options?: { silent?: boolean }) => {
    setRefreshing(true);
    try {
      await Promise.all([
        mutateDeals(),
        refreshApi("/api/pipeline/stages"),
        refreshApi("/api/clients"),
      ]);
    } finally {
      // Pequeno delay pra animação do ícone ficar perceptível
      setTimeout(() => setRefreshing(false), 300);
    }
  };

  // Abre modal "Novo Lead" se chegar com ?novo=1 (atalho vindo de outras páginas, ex: Produção)
  useEffect(() => {
    if (searchParams.get("novo") === "1") {
      setNewDealOpen(true);
      // Limpa o param pra não reabrir em F5
      const next = new URLSearchParams(searchParams);
      next.delete("novo");
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  // Revalida automaticamente quando a aba volta a ficar visível (foco).
  // Cobre o caso de você ter mexido em outra aba/dispositivo/extensão.
  useEffect(() => {
    const onFocus = () => {
      if (document.visibilityState === 'visible') {
        mutateDeals();
        refreshApi("/api/pipeline/stages");
      }
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [mutateDeals]);

  // Reage à mudança nos params da URL (ex: clique no botão WA de um DealCard)
  useEffect(() => {
    const tabParam = searchParams.get("tab") as Tab | null;
    if (tabParam && tabParam !== tab) {
      setTab(tabParam);
    }
  }, [searchParams]);

  // Funcionário sem permissão de Análises não fica preso nessa aba (ex: ?tab=analises).
  useEffect(() => {
    if (tab === "analises" && !canSeeAnalises) setTab("kanban");
  }, [tab, canSeeAnalises]);

  const activeDeals = deals.filter((d) => {
    const stage = stages.find((s) => s.id === d.stage);
    return !stage?.is_final;
  });

  const TABS = [
    { id: "kanban" as Tab, label: "Kanban", icon: LayoutGrid },
    { id: "inbox" as Tab, label: "Conversas", icon: MessageCircle },
    { id: "historico" as Tab, label: "Histórico", icon: History },
    // Análises pode ser desmarcada por funcionário (permissão "vendas_analises").
    ...(canSeeAnalises ? [{ id: "analises" as Tab, label: "Análises", icon: BarChart3 }] : []),
  ];

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-gray-50 dark:bg-gray-900">
      {/* Header - compacto no mobile */}
      <div className="flex items-center justify-between gap-2 px-3 sm:px-6 py-3 sm:py-4 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
        <div className="min-w-0 flex-1">
          <h1 className="text-base sm:text-xl font-bold text-gray-900 dark:text-white truncate">Vendas</h1>
          <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 mt-0.5 truncate">
            {activeDeals.length} lead{activeDeals.length !== 1 ? "s" : ""} ativos
          </p>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
          <button
            onClick={() => fetchData()}
            disabled={refreshing}
            title="Atualizar"
            className="flex items-center justify-center w-9 h-9 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600 disabled:opacity-60 transition-colors"
          >
            <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />
          </button>
          {tab === "kanban" && (
            <button
              onClick={() => setCustomizerOpen(true)}
              title="Configurar funil"
              className="flex items-center justify-center w-9 h-9 sm:w-auto sm:gap-2 sm:px-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600 text-sm font-medium transition-colors"
            >
              <Settings size={15} />
              <span className="hidden sm:inline">Configurar funil</span>
            </button>
          )}
          <button
            onClick={() => setNewDealOpen(true)}
            title="Novo Lead"
            className="flex items-center justify-center h-9 w-9 sm:w-auto sm:gap-2 sm:px-4 rounded-lg bg-gold-600 hover:bg-gold-700 text-white text-sm font-semibold transition-colors"
          >
            <Plus size={16} />
            <span className="hidden sm:inline">Novo Lead</span>
          </button>
        </div>
      </div>

      {/* Tabs - scroll horizontal se necessário no mobile, sem quebrar */}
      <div className="flex gap-1 px-3 sm:px-6 py-2 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex-shrink-0 overflow-x-auto">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => {
              if (id === "historico") setHistoryInitialFilter("todos");
              setTab(id);
            }}
            className={`flex items-center gap-2 px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg text-sm font-semibold whitespace-nowrap transition-colors ${
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

      {/* Conteúdo - flex-1 para preencher o espaço restante */}
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
                initialFilter={historyInitialFilter}
                onUpdate={() => fetchData({ silent: true })}
              />
            ) : tab === "analises" && canSeeAnalises ? (
              <div className="h-full overflow-y-auto p-6">
                <AnalisesTab
                  deals={deals}
                  stages={stages}
                  canSeeMoney={canSeeFinance}
                  onOpenHistory={() => {
                    setHistoryInitialFilter("perdidos");
                    setTab("historico");
                    const next = new URLSearchParams(searchParams);
                    next.set("tab", "historico");
                    setSearchParams(next, { replace: true });
                  }}
                />
              </div>
            ) : null}
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

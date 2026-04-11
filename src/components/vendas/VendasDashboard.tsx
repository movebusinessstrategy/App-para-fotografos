import React, { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { BarChart3, LayoutGrid, Plus, MessageSquare, Settings } from "lucide-react";
import { FunilTab } from "./FunilTab";
import { AnalisesTab } from "./AnalisesTab";
import { NewDealModal } from "./NewDealModal";
import { StageCustomizer } from "./StageCustomizer";
import { InboxView } from "./inbox/InboxView";
import { authFetch } from "../../utils/authFetch";
import { Deal, PipelineStage, Client } from "../../types";

type Tab = "inbox" | "kanban" | "analises";

export function VendasDashboard() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = (searchParams.get("tab") as Tab) || "inbox";
  const initialPhone = searchParams.get("phone") || "";

  const [tab, setTab] = useState<Tab>(initialTab);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [newDealOpen, setNewDealOpen] = useState(false);
  const [customizerOpen, setCustomizerOpen] = useState(false);

  const fetchData = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) setLoading(true);
    try {
      const [dealsRes, stagesRes, clientsRes] = await Promise.all([
        authFetch("/api/deals").then((r) => (r.ok ? r.json() : [])),
        authFetch("/api/pipeline/stages").then((r) => (r.ok ? r.json() : [])),
        authFetch("/api/clients").then((r) => (r.ok ? r.json() : [])),
      ]);
      setDeals(Array.isArray(dealsRes) ? dealsRes : []);
      setStages(Array.isArray(stagesRes) ? stagesRes : []);
      setClients(Array.isArray(clientsRes) ? clientsRes : []);
    } catch {
      // silencia erros de rede
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

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
    { id: "inbox" as Tab, label: "Inbox", icon: MessageSquare },
    { id: "kanban" as Tab, label: "Kanban", icon: LayoutGrid },
    { id: "analises" as Tab, label: "Análises", icon: BarChart3 },
  ];

  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-gray-900">
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

      {/* Conteúdo — altura explícita para que InboxView/FunilTab possam usar h-full internamente */}
      <div className="overflow-hidden" style={{ height: 'calc(100vh - 264px)', minHeight: '380px' }}>
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="flex flex-col items-center gap-3 text-gray-400">
              <div className="w-8 h-8 border-2 border-gray-200 border-t-gold-500 rounded-full animate-spin" />
              <span className="text-sm">Carregando...</span>
            </div>
          </div>
        ) : tab === "inbox" ? (
          <InboxView
            deals={deals}
            stages={stages}
            initialPhone={initialPhone}
            onDealUpdated={() => fetchData({ silent: true })}
          />
        ) : tab === "kanban" ? (
          <FunilTab
            deals={deals}
            stages={stages}
            clients={clients}
            onUpdate={fetchData}
          />
        ) : (
          <div className="h-full overflow-y-auto p-6">
            <AnalisesTab deals={deals} stages={stages} />
          </div>
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

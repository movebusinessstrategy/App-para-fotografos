import React, { useEffect, useState } from "react";
import { Plus, Settings } from "lucide-react";
import { authFetch } from "../utils/authFetch";
import { Client, Deal, PipelineStage } from "../types";
import { FunilTab } from "../components/vendas/FunilTab";
import { ListaTab } from "../components/vendas/ListaTab";
import { AnalisesTab } from "../components/vendas/AnalisesTab";
import { StageCustomizer } from "../components/vendas/StageCustomizer";
import { NewDealModal } from "../components/vendas/NewDealModal";

type TabType = "funil" | "lista" | "analises";

export default function VendasPage() {
  const [activeTab, setActiveTab] = useState<TabType>("funil");
  const [deals, setDeals] = useState<Deal[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [loading, setLoading] = useState(true);
  const [stageCustomizerOpen, setStageCustomizerOpen] = useState(false);
  const [newDealModalOpen, setNewDealModalOpen] = useState(false);

  const fetchData = async (options?: { silent?: boolean }) => {
    if (!options?.silent) setLoading(true);
    try {
      const [dealsRes, clientsRes, stagesRes] = await Promise.all([
        authFetch("/api/deals"),
        authFetch("/api/clients"),
        authFetch("/api/pipeline/stages"),
      ]);
      setDeals(await dealsRes.json());
      setClients(await clientsRes.json());
      setStages(await stagesRes.json());
    } catch (error) {
      console.error("Erro ao carregar dados:", error);
    } finally {
      if (!options?.silent) setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const sortedStages = [...stages].sort((a, b) => a.position - b.position);

  const tabs: { id: TabType; label: string }[] = [
    { id: "funil", label: "Funil" },
    { id: "lista", label: "Lista" },
    { id: "analises", label: "Análises" },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 dark:border-gray-100" />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between pb-4 border-b border-gray-200 dark:border-gray-800">
        <div className="flex items-center gap-6">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Vendas</h1>
          <nav className="flex gap-1">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                  activeTab === tab.id
                    ? "bg-gray-900 dark:bg-white text-white dark:text-gray-900"
                    : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setStageCustomizerOpen(true)}
            className="p-2 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
            title="Personalizar etapas"
          >
            <Settings size={20} />
          </button>
          <button
            onClick={() => setNewDealModalOpen(true)}
            className="flex items-center gap-2 bg-gray-900 dark:bg-white text-white dark:text-gray-900 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-800 dark:hover:bg-gray-100 transition-colors"
          >
            <Plus size={18} />
            Negócio
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 pt-4 min-h-0">
        {activeTab === "funil" && (
          <FunilTab
            deals={deals}
            stages={sortedStages}
            clients={clients}
            onUpdate={(options) => fetchData(options)}
          />
        )}
        {activeTab === "lista" && (
          <ListaTab
            deals={deals}
            stages={sortedStages}
            clients={clients}
            onUpdate={(options) => fetchData(options)}
          />
        )}
        {activeTab === "analises" && (
          <AnalisesTab deals={deals} stages={sortedStages} />
        )}
      </div>

      {/* Modals */}
      <StageCustomizer
        open={stageCustomizerOpen}
        stages={sortedStages}
        onClose={() => setStageCustomizerOpen(false)}
        onUpdated={() => fetchData()}
      />
      <NewDealModal
        open={newDealModalOpen}
        stages={sortedStages.filter((s) => !s.is_final)}
        clients={clients}
        onClose={() => setNewDealModalOpen(false)}
        onCreated={() => fetchData()}
      />
    </div>
  );
}

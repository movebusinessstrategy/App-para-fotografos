import React, { Suspense, lazy, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useApi, refreshApi } from "../utils/useApi";
import { Deal, PipelineStage } from "../types";

// Página DEDICADA do 2º WhatsApp (pós-venda/alinhamento) — equipe separada.
// Mesmo InboxView, travado no slot 'posvenda': só as conversas do 2º número,
// respostas saem pelo 2º número. Botão "→ Vendas" no header devolve o cliente
// pro funil como NOVO lead (nova oportunidade).
const InboxView = lazy(() =>
  import("../features/chat/components/InboxView").then(m => ({ default: m.InboxView }))
);

function PageFallback() {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="flex flex-col items-center gap-3 text-gray-400">
        <div className="w-8 h-8 border-2 border-gray-200 border-t-gold-500 rounded-full animate-spin" />
        <span className="text-sm">Carregando Pós-venda...</span>
      </div>
    </div>
  );
}

export default function PosVendaPage() {
  const [searchParams] = useSearchParams();
  const initialPhone = searchParams.get("phone") || undefined;

  const { data: dealsData, mutate: mutateDeals } = useApi<Deal[]>("/api/deals");
  const { data: stagesData } = useApi<PipelineStage[]>("/api/pipeline/stages");

  const deals = useMemo(() => (Array.isArray(dealsData) ? dealsData : []), [dealsData]);
  const stages = useMemo(() => (Array.isArray(stagesData) ? stagesData : []), [stagesData]);

  const onDealUpdated = () => {
    mutateDeals();
    refreshApi("/api/pipeline/stages");
  };

  return (
    <div className="h-full flex flex-col min-h-0 overflow-hidden">
      <Suspense fallback={<PageFallback />}>
        <InboxView
          deals={deals}
          stages={stages}
          initialPhone={initialPhone}
          onDealUpdated={onDealUpdated}
          slot="posvenda"
        />
      </Suspense>
    </div>
  );
}

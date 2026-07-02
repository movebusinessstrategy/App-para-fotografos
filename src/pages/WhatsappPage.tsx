import React, { Suspense, lazy, useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useApi, refreshApi } from "../utils/useApi";
import { Deal, PipelineStage } from "../types";

// InboxView é o componente que já existia dentro de /vendas?tab=inbox.
// Esta página dá uma rota dedicada (/whatsapp) pra ele rodar em tela cheia,
// sem competir com Kanban/Histórico/Análises por espaço de tabs.
const InboxView = lazy(() =>
  import("../features/chat/components/InboxView").then(m => ({ default: m.InboxView }))
);

function PageFallback() {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="flex flex-col items-center gap-3 text-gray-400">
        <div className="w-8 h-8 border-2 border-gray-200 border-t-gold-500 rounded-full animate-spin" />
        <span className="text-sm">Carregando WhatsApp...</span>
      </div>
    </div>
  );
}

export default function WhatsappPage() {
  const [searchParams] = useSearchParams();
  const initialPhone = searchParams.get("phone") || undefined;
  // Setores como "pastas" DENTRO da tela (sem ícone extra no menu):
  // Atendimento (vendas) | Pós-venda. O key remonta o chat ao trocar de setor.
  const [setor, setSetor] = React.useState<'main' | 'posvenda'>('main');
  const [phoneOverride, setPhoneOverride] = React.useState<string | undefined>(undefined);

  // Os mesmos endpoints que VendasDashboard usa — SWR cacheia entre páginas,
  // então quem já abriu /vendas antes não paga nada aqui.
  const { data: dealsData, mutate: mutateDeals } = useApi<Deal[]>("/api/deals");
  const { data: stagesData } = useApi<PipelineStage[]>("/api/pipeline/stages");

  const deals = useMemo(() => Array.isArray(dealsData) ? dealsData : [], [dealsData]);
  const stages = useMemo(() => Array.isArray(stagesData) ? stagesData : [], [stagesData]);

  const onDealUpdated = () => {
    mutateDeals();
    refreshApi("/api/pipeline/stages");
  };

  // Revalida quando volta o foco da aba — pega mensagens novas que chegaram
  // enquanto o user tava em outra aba do browser.
  useEffect(() => {
    const onFocus = () => {
      if (document.visibilityState === "visible") mutateDeals();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [mutateDeals]);

  return (
    <div className="h-full flex flex-col min-h-0 overflow-hidden">
      <Suspense fallback={<PageFallback />}>
        <InboxView
          key={setor}
          deals={deals}
          stages={stages}
          initialPhone={phoneOverride ?? initialPhone}
          onDealUpdated={onDealUpdated}
          slot={setor}
          onSlotChange={(s, p) => { setPhoneOverride(p); setSetor(s); }}
        />
      </Suspense>
    </div>
  );
}

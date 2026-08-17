import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertCircle,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Clock3,
  MousePointerClick,
  RefreshCw,
  ShoppingBag,
  TrendingUp,
} from "lucide-react";

import {
  fetchGoogleAdsApi,
  formatCompactNumber,
  formatCurrency,
  formatGoogleAdsDate,
  GoogleAdsCampaign,
  GoogleAdsCampaignsResponse,
  GoogleAdsOverview,
  GoogleAdsStatus,
  microsToCurrency,
} from "../../features/google-ads/api";
import { cn } from "../../utils/cn";

type GoogleAdsPanelProps = {
  from: string;
  to: string;
  hideValues: boolean;
};

type PanelData = {
  status: GoogleAdsStatus;
  overview: GoogleAdsOverview | null;
  campaigns: GoogleAdsCampaign[];
};

function buildQuery(from: string, to: string, limit?: number) {
  const query = new URLSearchParams({ from, to });
  if (limit) query.set("limit", String(limit));
  return query.toString();
}

function hasPerformanceData(overview: GoogleAdsOverview, campaigns: GoogleAdsCampaign[]) {
  const totals = overview.totals;
  return totals.impressions > 0 || totals.clicks > 0 || Number(totals.cost_micros) > 0
    || totals.conversions > 0 || campaigns.length > 0;
}

function formatPercent(value: number) {
  return `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(value)}%`;
}

function calculateCtr(clicks: number, impressions: number) {
  return impressions > 0 ? (clicks / impressions) * 100 : 0;
}

function formatConversions(value: number) {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(value || 0);
}

function formatPanelRange(from: string, to: string) {
  const formatDate = (value: string) => value.split("-").reverse().join("/");
  return `${formatDate(from)} a ${formatDate(to)}`;
}

export default function GoogleAdsPanel({ from, to, hideValues }: GoogleAdsPanelProps) {
  const [data, setData] = useState<PanelData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);
  const requestSequence = useRef(0);
  const hasData = useRef(false);

  const load = useCallback(async () => {
    const sequence = requestSequence.current + 1;
    requestSequence.current = sequence;
    setLoading(!hasData.current);
    setRefreshing(hasData.current);
    setError(false);
    try {
      const status = await fetchGoogleAdsApi<GoogleAdsStatus>("/api/marketing/google-ads/status");
      if (requestSequence.current !== sequence) return;
      if (!status.linked || status.state === "config_missing" || status.state === "unlinked") {
        setData({ status, overview: null, campaigns: [] });
        hasData.current = true;
        return;
      }
      const overviewQuery = buildQuery(from, to);
      const campaignQuery = buildQuery(from, to, 8);
      const [overview, campaignResponse] = await Promise.all([
        fetchGoogleAdsApi<GoogleAdsOverview>(`/api/marketing/google-ads/overview?${overviewQuery}`),
        fetchGoogleAdsApi<GoogleAdsCampaignsResponse>(`/api/marketing/google-ads/campaigns?${campaignQuery}`),
      ]);
      if (requestSequence.current !== sequence) return;
      setData({ status, overview, campaigns: campaignResponse.campaigns });
      hasData.current = true;
    } catch {
      if (requestSequence.current === sequence) setError(true);
    } finally {
      if (requestSequence.current === sequence) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [from, to]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <GoogleAdsPanelSkeleton />;
  if (error && !data) return <GoogleAdsPanelError onRetry={load} />;
  if (!data) return null;

  if (!data.status.linked || data.status.state === "config_missing" || data.status.state === "unlinked") {
    return <GoogleAdsPanelSetup state={data.status.state} />;
  }

  if (!data.overview) return <GoogleAdsPanelError onRetry={load} />;

  const isEmpty = !hasPerformanceData(data.overview, data.campaigns);
  const currency = data.overview.currency_code || data.status.account?.currency_code || "BRL";

  return (
    <section className="overflow-hidden rounded-[1.75rem] border border-gray-200 bg-white shadow-[0_18px_50px_-42px_rgba(0,0,0,0.5)] dark:border-white/[0.07] dark:bg-white/[0.035]">
      <GoogleAdsPanelHeader
        status={data.status}
        from={from}
        to={to}
        refreshing={refreshing}
        onRefresh={load}
      />

      {(data.status.state === "stale" || data.status.state === "sync_error") && (
        <div className="mx-5 mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-200 sm:mx-6">
          {data.status.state === "stale" ? <Clock3 size={15} className="mt-0.5 flex-shrink-0" /> : <AlertCircle size={15} className="mt-0.5 flex-shrink-0" />}
          <span>{data.status.state === "stale"
            ? "Os números abaixo são os últimos dados importados e podem estar desatualizados."
            : "A última tentativa de atualização falhou. Os dados anteriores foram preservados."}</span>
        </div>
      )}

      {error && (
        <div className="mx-5 mt-4 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-300 sm:mx-6">
          <AlertCircle size={15} /> Não foi possível renovar este painel. Os dados anteriores continuam visíveis.
        </div>
      )}

      {isEmpty ? (
        <GoogleAdsPanelEmpty />
      ) : (
        <div className="p-5 sm:p-6">
          <PerformanceMetrics overview={data.overview} currency={currency} hideValues={hideValues} />
          <AttributionMetrics overview={data.overview} currency={currency} hideValues={hideValues} />
          <CampaignTable campaigns={data.campaigns} currency={currency} hideValues={hideValues} />
        </div>
      )}
    </section>
  );
}

function GoogleAdsPanelHeader({ status, from, to, refreshing, onRefresh }: {
  status: GoogleAdsStatus;
  from: string;
  to: string;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const healthy = status.state === "healthy";
  return (
    <header className="flex flex-col gap-4 border-b border-gray-100 px-5 py-5 dark:border-white/[0.07] sm:flex-row sm:items-center sm:justify-between sm:px-6">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-700 ring-1 ring-blue-100 dark:bg-blue-950/40 dark:text-blue-300 dark:ring-blue-900/60">
          <BarChart3 size={20} />
        </span>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-semibold tracking-tight text-gray-950 dark:text-white">Google Ads</h2>
            <span className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider",
              healthy
                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
                : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
            )}>
              {healthy ? <CheckCircle2 size={10} /> : <Clock3 size={10} />}
              {healthy ? "Atualizado" : "Atenção"}
            </span>
          </div>
          <p className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">
            {formatPanelRange(from, to)} · atualizado em {formatGoogleAdsDate(status.last_synced_at)}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          aria-label="Recarregar painel do Google Ads"
          className="flex h-9 w-9 items-center justify-center rounded-xl border border-gray-200 text-gray-500 transition-colors hover:border-gray-300 hover:text-gray-900 disabled:opacity-50 dark:border-gray-700 dark:text-gray-400 dark:hover:text-white"
        >
          <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
        </button>
        <Link
          to="/configuracoes/integracoes/google-ads"
          className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-gray-200 px-3 text-xs font-semibold text-gray-700 transition-colors hover:border-blue-300 hover:text-blue-700 dark:border-gray-700 dark:text-gray-300 dark:hover:border-blue-800 dark:hover:text-blue-300"
        >
          Integração <ArrowRight size={12} />
        </Link>
      </div>
    </header>
  );
}

function PerformanceMetrics({ overview, currency, hideValues }: {
  overview: GoogleAdsOverview;
  currency: string;
  hideValues: boolean;
}) {
  const totals = overview.totals;
  const cost = microsToCurrency(totals.cost_micros);
  const avgCpc = microsToCurrency(totals.avg_cpc_micros);
  const ctr = calculateCtr(totals.clicks, totals.impressions);
  return (
    <div>
      <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-blue-600 dark:text-blue-400">Performance dos anúncios</p>
      <div className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-gray-200 bg-gray-200 dark:border-gray-700 dark:bg-gray-700 sm:grid-cols-3 lg:grid-cols-6">
        <MetricCell label="Investimento" value={formatCurrency(cost, currency, hideValues)} />
        <MetricCell label="Impressões" value={formatCompactNumber(totals.impressions)} />
        <MetricCell label="Cliques" value={formatCompactNumber(totals.clicks)} icon={<MousePointerClick size={12} />} />
        <MetricCell label="CTR" value={formatPercent(ctr)} />
        <MetricCell label="CPC médio" value={formatCurrency(avgCpc, currency, hideValues)} />
        <MetricCell label="Conversões nativas Ads" value={formatConversions(totals.conversions)} />
      </div>
    </div>
  );
}

function AttributionMetrics({ overview, currency, hideValues }: {
  overview: GoogleAdsOverview;
  currency: string;
  hideValues: boolean;
}) {
  const attribution = overview.crm_attribution;
  const verified = Boolean(attribution?.valid && attribution.click_mapping_verified === true);
  if (!attribution || !verified) return <AttributionUnavailable />;

  const cac = microsToCurrency(attribution.cac_micros);
  const roas = attribution.roas;
  return (
    <div className="mt-5 rounded-2xl bg-[#12110f] p-5 text-white">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
        <div>
          <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-gold-300">Resultado reconhecido pelo CRM</p>
          <h3 className="mt-1 text-sm font-semibold">Anúncio e venda são leituras diferentes</h3>
        </div>
        <p className="max-w-md text-[10px] leading-relaxed text-white/45 sm:text-right">Vínculo de clique, conta, campanha e venda validado pelo CRM.</p>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <DarkAttributionMetric
          icon={<ShoppingBag size={14} />}
          label="Vendas CRM atribuídas"
          value={String(attribution.attributed_sales ?? 0)}
          hint="vendas com vínculo verificável"
        />
        <DarkAttributionMetric
          icon={<MousePointerClick size={14} />}
          label="CAC"
          value={formatCurrency(cac, currency, hideValues)}
          hint={cac !== null ? "investimento por venda atribuída" : "Sem base suficiente para cálculo"}
        />
        <DarkAttributionMetric
          icon={<TrendingUp size={14} />}
          label="ROAS"
          value={roas !== null && Number.isFinite(roas) ? `${roas.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}x` : "—"}
          hint={roas !== null ? "receita atribuída ÷ investimento" : "Sem base suficiente para cálculo"}
        />
      </div>
    </div>
  );
}

function AttributionUnavailable() {
  return (
    <div className="mt-5 rounded-2xl border border-gray-200 bg-gray-50 p-5 dark:border-gray-700 dark:bg-gray-900/40">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-white text-gray-500 shadow-sm dark:bg-gray-800 dark:text-gray-300">
          <ShoppingBag size={15} />
        </span>
        <div>
          <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-gray-500 dark:text-gray-400">Atribuição do CRM indisponível</p>
          <h3 className="mt-1 text-sm font-semibold text-gray-900 dark:text-white">Vendas atribuídas, CAC e ROAS ainda não são exibidos</h3>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-gray-500 dark:text-gray-400">
            Esses indicadores só serão liberados quando o CRM comprovar a ligação entre um identificador de clique do Google, a conta e campanha vinculadas e uma venda ganha. As métricas acima continuam sendo os dados nativos informados pelo Google Ads.
          </p>
        </div>
      </div>
    </div>
  );
}

function CampaignTable({ campaigns, currency, hideValues }: {
  campaigns: GoogleAdsCampaign[];
  currency: string;
  hideValues: boolean;
}) {
  if (campaigns.length === 0) return null;
  return (
    <div className="mt-5">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-gray-400">Campanhas no período</p>
          <h3 className="mt-1 text-sm font-semibold text-gray-900 dark:text-white">Onde o investimento aconteceu</h3>
        </div>
        <span className="text-[10px] text-gray-400">até 8 campanhas</span>
      </div>
      <div className="mt-3 overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
        <table className="min-w-[680px] w-full text-left text-xs">
          <thead className="bg-gray-50 text-[9px] uppercase tracking-wider text-gray-500 dark:bg-gray-900/50 dark:text-gray-400">
            <tr>
              <th className="px-4 py-3 font-semibold">Campanha</th>
              <th className="px-3 py-3 text-right font-semibold">Investimento</th>
              <th className="px-3 py-3 text-right font-semibold">Impressões</th>
              <th className="px-3 py-3 text-right font-semibold">Cliques</th>
              <th className="px-4 py-3 text-right font-semibold">Conv. nativas Ads</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {campaigns.map((campaign) => (
              <tr key={campaign.campaign_id} className="text-gray-700 dark:text-gray-300">
                <td className="max-w-[260px] px-4 py-3">
                  <p className="truncate font-medium text-gray-900 dark:text-white" title={campaign.campaign_name}>{campaign.campaign_name}</p>
                  <p className="mt-0.5 text-[10px] text-gray-400">{formatCampaignStatus(campaign.campaign_status)}</p>
                </td>
                <td className="px-3 py-3 text-right tabular-nums">{formatCurrency(microsToCurrency(campaign.cost_micros), currency, hideValues)}</td>
                <td className="px-3 py-3 text-right tabular-nums">{formatCompactNumber(campaign.impressions)}</td>
                <td className="px-3 py-3 text-right tabular-nums">{formatCompactNumber(campaign.clicks)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{formatConversions(campaign.conversions)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function formatCampaignStatus(status: string | null) {
  const labels: Record<string, string> = { ENABLED: "Ativa", PAUSED: "Pausada", REMOVED: "Removida" };
  if (!status) return "Status indisponível";
  return labels[status.toUpperCase()] || "Status informado pelo Google Ads";
}

function MetricCell({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="min-w-0 bg-white px-3.5 py-4 dark:bg-[#171717]">
      <p className="flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wider text-gray-400">{icon}{label}</p>
      <p className="mt-2 truncate text-lg font-semibold tracking-tight text-gray-950 tabular-nums dark:text-white" title={value}>{value}</p>
    </div>
  );
}

function DarkAttributionMetric({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: string; hint: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.045] p-3.5">
      <p className="flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-wider text-white/45">{icon}{label}</p>
      <p className="mt-2 text-xl font-semibold tabular-nums">{value}</p>
      <p className="mt-1 text-[10px] leading-relaxed text-white/40">{hint}</p>
    </div>
  );
}

function GoogleAdsPanelSetup({ state }: { state: GoogleAdsStatus["state"] }) {
  const configMissing = state === "config_missing";
  return (
    <section className="rounded-[1.75rem] border border-dashed border-gray-300 bg-white/60 p-6 dark:border-gray-700 dark:bg-white/[0.025] sm:p-7">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300"><BarChart3 size={20} /></span>
          <div>
            <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-blue-600 dark:text-blue-400">Google Ads</p>
            <h2 className="mt-1 font-semibold text-gray-950 dark:text-white">{configMissing ? "Integração em preparação" : "Conta de anúncios ainda não vinculada"}</h2>
            <p className="mt-1 max-w-xl text-xs leading-relaxed text-gray-500 dark:text-gray-400">
              {configMissing
                ? "O painel aparecerá aqui quando a configuração segura estiver concluída."
                : "Depois que a conta autorizada do estúdio for vinculada, o histórico passa a aparecer neste espaço."}
            </p>
          </div>
        </div>
        <Link to="/configuracoes/integracoes/google-ads" className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-700 hover:text-blue-600 dark:text-blue-300">
          Ver integração <ArrowRight size={12} />
        </Link>
      </div>
    </section>
  );
}

function GoogleAdsPanelEmpty() {
  return (
    <div className="px-6 py-10 text-center">
      <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-gray-100 text-gray-400 dark:bg-gray-800"><BarChart3 size={22} /></span>
      <h3 className="mt-3 text-sm font-semibold text-gray-900 dark:text-white">Sem atividade neste período</h3>
      <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-gray-500 dark:text-gray-400">Não encontramos investimento, impressões, cliques ou conversões nativas nas datas selecionadas.</p>
    </div>
  );
}

function GoogleAdsPanelError({ onRetry }: { onRetry: () => void }) {
  return (
    <section className="rounded-[1.75rem] border border-red-200 bg-red-50/60 p-6 dark:border-red-900/50 dark:bg-red-950/10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <AlertCircle size={20} className="mt-0.5 flex-shrink-0 text-red-600 dark:text-red-400" />
          <div>
            <h2 className="text-sm font-semibold text-red-800 dark:text-red-200">Não foi possível carregar o Google Ads</h2>
            <p className="mt-1 text-xs text-red-700/75 dark:text-red-300/70">Os outros dados do dashboard não foram afetados.</p>
          </div>
        </div>
        <button type="button" onClick={onRetry} className="inline-flex items-center justify-center gap-2 rounded-xl border border-red-200 bg-white px-4 py-2 text-xs font-semibold text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
          <RefreshCw size={13} /> Tentar novamente
        </button>
      </div>
    </section>
  );
}

function GoogleAdsPanelSkeleton() {
  return (
    <section className="animate-pulse overflow-hidden rounded-[1.75rem] border border-gray-200 bg-white dark:border-gray-700 dark:bg-white/[0.035]" aria-label="Carregando dados do Google Ads">
      <div className="flex items-center gap-3 border-b border-gray-100 px-6 py-5 dark:border-gray-800">
        <div className="h-10 w-10 rounded-xl bg-gray-100 dark:bg-gray-800" />
        <div className="space-y-2"><div className="h-4 w-28 rounded bg-gray-100 dark:bg-gray-800" /><div className="h-3 w-44 rounded bg-gray-100 dark:bg-gray-800" /></div>
      </div>
      <div className="grid grid-cols-2 gap-px bg-gray-100 p-6 dark:bg-gray-800 sm:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, index) => <div key={index} className="h-20 bg-gray-50 dark:bg-gray-900" />)}
      </div>
    </section>
  );
}

import React, { useMemo, useEffect, useState } from "react";
import { Deal, PipelineStage, SaleCampaign } from "../../types";
import { authFetch } from "../../utils/authFetch";
import { TrendingUp, TrendingDown, Clock, DollarSign, Target, BarChart3, XCircle, ExternalLink, Sparkles } from "lucide-react";

interface AnalisesTabProps {
  deals: Deal[];
  stages: PipelineStage[];
  onOpenHistory?: () => void;
  // Funcionário sem permissão "Financeiro" vê as contagens/taxas, mas não os R$.
  canSeeMoney?: boolean;
}

export function AnalisesTab({ deals, stages, onOpenHistory, canSeeMoney = true }: AnalisesTabProps) {
  const [campaigns, setCampaigns] = useState<SaleCampaign[]>([]);

  useEffect(() => {
    authFetch('/api/sale-campaigns').then(r => r.ok ? r.json() : []).then(d => setCampaigns(Array.isArray(d) ? d : [])).catch(() => {});
  }, []);

  const stats = useMemo(() => {
    const activeStages = stages.filter((s) => !s.is_final);
    const wonStage = stages.find((s) => s.is_final && s.is_won);
    const lostStage = stages.find((s) => s.is_final && !s.is_won);

    const activeDeals = deals.filter((d) => activeStages.some((s) => s.id === d.stage));
    const wonDeals = deals.filter((d) => d.stage === wonStage?.id);
    const lostDeals = deals.filter((d) => d.stage === lostStage?.id);

    const totalActive = activeDeals.reduce((sum, d) => sum + (d.value || 0), 0);
    const totalWon = wonDeals.reduce((sum, d) => sum + (d.value || 0), 0);
    const totalLost = lostDeals.reduce((sum, d) => sum + (d.value || 0), 0);

    const winRate = wonDeals.length + lostDeals.length > 0
      ? (wonDeals.length / (wonDeals.length + lostDeals.length)) * 100
      : 0;

    const avgDealValue = activeDeals.length > 0
      ? totalActive / activeDeals.length
      : 0;

    // Por etapa
    const byStage = activeStages.map((stage) => {
      const stageDeals = deals.filter((d) => d.stage === stage.id);
      const total = stageDeals.reduce((sum, d) => sum + (d.value || 0), 0);
      return {
        name: stage.name,
        count: stageDeals.length,
        value: total,
      };
    });

    // Por campanha (venda especial) — agrupa os GANHOS por campaign_id.
    const campaignById = new Map<string, SaleCampaign>();
    campaigns.forEach(c => campaignById.set(c.id, c));
    const campaignAgg = new Map<string, { name: string; color: string; count: number; value: number }>();
    const NO_CAMPAIGN_KEY = "__none__";
    wonDeals.forEach((deal) => {
      const cid = deal.campaign_id || null;
      const key = cid || NO_CAMPAIGN_KEY;
      const meta = cid ? campaignById.get(cid) : null;
      const name = meta?.name || (cid ? "Campanha removida" : "Sem campanha");
      const color = meta?.color || "#9CA3AF";
      const current = campaignAgg.get(key) || { name, color, count: 0, value: 0 };
      current.count += 1;
      current.value += deal.value || 0;
      campaignAgg.set(key, current);
    });
    const byCampaign = Array.from(campaignAgg.values()).sort((a, b) => b.value - a.value || b.count - a.count);

    const lostReasonMap = new Map<string, { count: number; value: number; notes: number }>();
    lostDeals.forEach((deal) => {
      const reason = deal.lost_reason?.trim() || "Sem motivo informado";
      const current = lostReasonMap.get(reason) || { count: 0, value: 0, notes: 0 };
      current.count += 1;
      current.value += deal.value || 0;
      if (deal.lost_notes?.trim()) current.notes += 1;
      lostReasonMap.set(reason, current);
    });

    const lostReasons = Array.from(lostReasonMap.entries())
      .map(([reason, data]) => ({ reason, ...data }))
      .sort((a, b) => b.count - a.count || b.value - a.value);

    // Previsão por mês
    const byMonth: Record<string, { count: number; value: number }> = {};
    activeDeals.forEach((d) => {
      if (d.expected_close_date) {
        const month = d.expected_close_date.slice(0, 7);
        if (!byMonth[month]) byMonth[month] = { count: 0, value: 0 };
        byMonth[month].count++;
        byMonth[month].value += d.value || 0;
      }
    });

    return {
      totalActive,
      totalWon,
      totalLost,
      activeCount: activeDeals.length,
      wonCount: wonDeals.length,
      lostCount: lostDeals.length,
      winRate,
      avgDealValue,
      byStage,
      byCampaign,
      lostReasons,
      byMonth: Object.entries(byMonth)
        .sort(([a], [b]) => a.localeCompare(b))
        .slice(0, 6),
    };
  }, [deals, stages, campaigns]);

  const formatCurrency = (value: number) =>
    canSeeMoney ? `R$ ${value.toLocaleString("pt-BR", { minimumFractionDigits: 0 })}` : "•••";

  const formatMonth = (month: string) => {
    const [year, m] = month.split("-");
    const months = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
    return `${months[parseInt(m) - 1]}/${year.slice(2)}`;
  };

  return (
    <div className="space-y-6 overflow-y-auto h-full pb-4">
      {/* Cards principais */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
          <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400 mb-2">
            <DollarSign size={18} />
            <span className="text-xs font-medium uppercase">No Funil</span>
          </div>
          <div className="text-2xl font-bold text-gray-900 dark:text-white">{formatCurrency(stats.totalActive)}</div>
          <div className="text-sm text-gray-500 dark:text-gray-400">{stats.activeCount} negócios</div>
        </div>

        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
          <div className="flex items-center gap-2 text-green-600 dark:text-green-400 mb-2">
            <TrendingUp size={18} />
            <span className="text-xs font-medium uppercase">Ganhos</span>
          </div>
          <div className="text-2xl font-bold text-gray-900 dark:text-white">{formatCurrency(stats.totalWon)}</div>
          <div className="text-sm text-gray-500 dark:text-gray-400">{stats.wonCount} negócios</div>
        </div>

        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
          <div className="flex items-center gap-2 text-red-600 dark:text-red-400 mb-2">
            <TrendingDown size={18} />
            <span className="text-xs font-medium uppercase">Perdidos</span>
          </div>
          <div className="text-2xl font-bold text-gray-900 dark:text-white">{formatCurrency(stats.totalLost)}</div>
          <div className="text-sm text-gray-500 dark:text-gray-400">{stats.lostCount} negócios</div>
        </div>

        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
          <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400 mb-2">
            <Target size={18} />
            <span className="text-xs font-medium uppercase">Taxa de Conversão</span>
          </div>
          <div className="text-2xl font-bold text-gray-900 dark:text-white">{stats.winRate.toFixed(1)}%</div>
          <div className="text-sm text-gray-500 dark:text-gray-400">ganhos/total fechados</div>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2 min-w-0">
            <XCircle size={18} className="text-red-600 dark:text-red-400 flex-shrink-0" />
            <h3 className="font-semibold text-gray-900 dark:text-white">Motivos de Perda</h3>
          </div>
          {onOpenHistory && (
            <button
              type="button"
              onClick={onOpenHistory}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            >
              <ExternalLink size={12} />
              Ver no histórico
            </button>
          )}
        </div>

        {stats.lostReasons.length > 0 ? (
          <div className="space-y-3">
            {stats.lostReasons.map((item) => {
              const width = Math.max(8, (item.count / Math.max(...stats.lostReasons.map((r) => r.count), 1)) * 100);
              return (
                <div key={item.reason}>
                  <div className="flex items-center justify-between gap-3 mb-1">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">{item.reason}</p>
                      <p className="text-[11px] text-gray-400 dark:text-gray-500">
                        {item.count} negócio{item.count === 1 ? "" : "s"}
                        {item.notes > 0 ? ` · ${item.notes} com observação` : ""}
                      </p>
                    </div>
                    <span className="text-sm font-semibold text-gray-900 dark:text-white whitespace-nowrap">
                      {formatCurrency(item.value)}
                    </span>
                  </div>
                  <div className="h-2 bg-red-50 dark:bg-red-900/20 rounded-full overflow-hidden">
                    <div className="h-full bg-red-500 dark:bg-red-400 rounded-full" style={{ width: `${width}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-6">
            Nenhum negócio perdido com motivo registrado ainda.
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Por etapa */}
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-4">
            <BarChart3 size={18} className="text-gray-500 dark:text-gray-400" />
            <h3 className="font-semibold text-gray-900 dark:text-white">Por Etapa</h3>
          </div>
          <div className="space-y-3">
            {stats.byStage.map((stage) => (
              <div key={stage.name} className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm text-gray-700 dark:text-gray-300">{stage.name}</span>
                    <span className="text-xs text-gray-500 dark:text-gray-400">{stage.count} negócios</span>
                  </div>
                  <div className="h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gray-900 dark:bg-white rounded-full"
                      style={{
                        width: `${Math.min((stage.value / (stats.totalActive || 1)) * 100, 100)}%`,
                      }}
                    />
                  </div>
                </div>
                <span className="text-sm font-medium text-gray-900 dark:text-white ml-4 w-24 text-right">
                  {formatCurrency(stage.value)}
                </span>
              </div>
            ))}
            {stats.byStage.length === 0 && (
              <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-4">Sem dados</p>
            )}
          </div>
        </div>

        {/* Previsão */}
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-4">
            <Clock size={18} className="text-gray-500 dark:text-gray-400" />
            <h3 className="font-semibold text-gray-900 dark:text-white">Previsão de Fechamento</h3>
          </div>
          <div className="space-y-3">
            {stats.byMonth.map(([month, data]) => (
              <div key={month} className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm text-gray-700 dark:text-gray-300">{formatMonth(month)}</span>
                    <span className="text-xs text-gray-500 dark:text-gray-400">{data.count} negócios</span>
                  </div>
                  <div className="h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gray-700 dark:bg-gray-300 rounded-full"
                      style={{
                        width: `${Math.min((data.value / (stats.totalActive || 1)) * 100, 100)}%`,
                      }}
                    />
                  </div>
                </div>
                <span className="text-sm font-medium text-gray-900 dark:text-white ml-4 w-24 text-right">
                  {formatCurrency(data.value)}
                </span>
              </div>
            ))}
            {stats.byMonth.length === 0 && (
              <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-4">
                Sem previsões de fechamento definidas
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Vendas por Campanha */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
        <div className="flex items-center gap-2 mb-4">
          <Sparkles size={18} className="text-gray-500 dark:text-gray-400" />
          <h3 className="font-semibold text-gray-900 dark:text-white">Vendas por Campanha</h3>
        </div>
        {stats.byCampaign.length > 0 ? (
          <div className="space-y-3">
            {stats.byCampaign.map((item) => {
              const maxValue = Math.max(...stats.byCampaign.map((c) => c.value), 1);
              const width = Math.max(8, (item.value / maxValue) * 100);
              return (
                <div key={item.name}>
                  <div className="flex items-center justify-between gap-3 mb-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: item.color }} />
                      <span className="text-sm text-gray-700 dark:text-gray-300 truncate">{item.name}</span>
                      <span className="text-xs text-gray-400 dark:text-gray-500 flex-shrink-0">
                        {item.count} venda{item.count === 1 ? "" : "s"}
                      </span>
                    </div>
                    <span className="text-sm font-semibold text-gray-900 dark:text-white whitespace-nowrap">
                      {formatCurrency(item.value)}
                    </span>
                  </div>
                  <div className="h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${width}%`, backgroundColor: item.color }} />
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-6">
            Nenhuma venda ganha vinculada a campanha ainda.
          </p>
        )}
      </div>

      {/* Ticket médio */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-1">
              Ticket Médio dos Negócios Ativos
            </div>
            <div className="text-2xl font-bold text-gray-900 dark:text-white">
              {formatCurrency(stats.avgDealValue)}
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-1">
              Total de Negócios
            </div>
            <div className="text-2xl font-bold text-gray-900 dark:text-white">{deals.length}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

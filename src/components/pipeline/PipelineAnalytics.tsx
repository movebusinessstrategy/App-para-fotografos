import React from "react";
import { Pie, PieChart, Cell, ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis } from "recharts";

import { PipelineAnalytics, PipelineStage } from "../../types";
import { cn } from "../../utils/cn";

const COLORS = ["#4F46E5", "#22C55E", "#F97316", "#EF4444", "#06B6D4", "#A855F7"];

interface Props {
  analytics: PipelineAnalytics | null;
  stages: PipelineStage[];
}

export function PipelineAnalyticsPanel({ analytics, stages }: Props) {
  if (!analytics) return null;

  const lostData = Object.entries(analytics.lostReasons || {}).map(([name, value]) => ({ name, value }));
  const tempData = [
    { name: "Quente", value: analytics.temperatureDistribution.hot || 0 },
    { name: "Morno", value: analytics.temperatureDistribution.warm || 0 },
    { name: "Frio", value: analytics.temperatureDistribution.cold || 0 },
  ];

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-6 shadow-sm dark:shadow-black/20 space-y-4">
      {/* Stats Row */}
      <div className="flex flex-wrap gap-4">
        <Stat label="Taxa de conversão" value={`${Math.round((analytics.conversionRate || 0) * 100)}%`} highlight />
        <Stat label="Faturamento previsto (quentes)" value={`R$ ${analytics.forecastHotValue.toLocaleString("pt-BR")}`} />
        <Stat label="Leads estagnados" value={analytics.stalledDeals} warn={analytics.stalledDeals > 0} />
        <Stat label="Follow-ups atrasados" value={analytics.overdueFollowUps} warn={analytics.overdueFollowUps > 0} />
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Lost Reasons Chart */}
        <div className="border border-gray-100 dark:border-gray-800 rounded-xl p-4 bg-white dark:bg-gray-800/50">
          <p className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Motivos de perda</p>
          {lostData.length === 0 ? (
            <p className="text-xs text-gray-400 dark:text-gray-500">Sem registros</p>
          ) : (
            <div className="h-52">
              <ResponsiveContainer>
                <PieChart>
                  <Pie dataKey="value" data={lostData} innerRadius={40} outerRadius={70} paddingAngle={2}>
                    {lostData.map((_, index) => (
                      <Cell key={index} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip 
                    formatter={(val: any) => val}
                    contentStyle={{
                      backgroundColor: 'var(--tooltip-bg, #fff)',
                      borderColor: 'var(--tooltip-border, #e5e7eb)',
                      borderRadius: '8px',
                    }}
                    wrapperClassName="[&_.recharts-tooltip-wrapper]:!bg-white dark:[&_.recharts-tooltip-wrapper]:!bg-gray-800"
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Temperature Distribution Chart */}
        <div className="border border-gray-100 dark:border-gray-800 rounded-xl p-4 bg-white dark:bg-gray-800/50">
          <p className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Distribuição por temperatura</p>
          <div className="h-52">
            <ResponsiveContainer>
              <BarChart data={tempData}>
                <XAxis 
                  dataKey="name" 
                  tick={{ fontSize: 12, fill: 'currentColor' }} 
                  tickLine={{ stroke: 'currentColor' }}
                  axisLine={{ stroke: 'currentColor' }}
                  className="text-gray-600 dark:text-gray-400"
                />
                <YAxis 
                  allowDecimals={false} 
                  tick={{ fontSize: 12, fill: 'currentColor' }} 
                  tickLine={{ stroke: 'currentColor' }}
                  axisLine={{ stroke: 'currentColor' }}
                  className="text-gray-600 dark:text-gray-400"
                />
                <Tooltip 
                  contentStyle={{
                    backgroundColor: 'var(--tooltip-bg, #fff)',
                    borderColor: 'var(--tooltip-border, #e5e7eb)',
                    borderRadius: '8px',
                  }}
                  cursor={{ fill: 'rgba(99, 102, 241, 0.1)' }}
                />
                <Bar dataKey="value" radius={[6, 6, 0, 0]} fill="#6366F1" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Average Stage Time */}
        <div className="border border-gray-100 dark:border-gray-800 rounded-xl p-4 bg-white dark:bg-gray-800/50 space-y-2">
          <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">Tempo médio por etapa (h)</p>
          <div className="space-y-2 max-h-52 overflow-y-auto">
            {analytics.avgStageTime.map((item) => {
              const stage = stages.find((s) => s.id === item.stageId);
              return (
                <div key={item.stageId} className="flex items-center justify-between">
                  <span className="text-sm text-gray-600 dark:text-gray-400">{stage?.name || item.stageId}</span>
                  <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">{item.hours}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, highlight, warn }: { label: string; value: string | number; highlight?: boolean; warn?: boolean }) {
  return (
    <div
      className={cn(
        "flex-1 min-w-[180px] bg-gray-50 dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-xl px-4 py-3",
        highlight && "bg-indigo-50 dark:bg-indigo-950/30 border-indigo-100 dark:border-indigo-900/50",
        warn && "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900/50"
      )}
    >
      <p className={cn(
        "text-xs font-semibold uppercase",
        highlight ? "text-indigo-600 dark:text-indigo-400" : warn ? "text-amber-600 dark:text-amber-400" : "text-gray-500 dark:text-gray-400"
      )}>
        {label}
      </p>
      <p className={cn(
        "text-lg font-bold",
        highlight ? "text-indigo-700 dark:text-indigo-300" : warn ? "text-amber-700 dark:text-amber-300" : "text-gray-800 dark:text-white"
      )}>
        {value}
      </p>
    </div>
  );
}

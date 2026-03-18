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
    <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm space-y-4">
      <div className="flex flex-wrap gap-4">
        <Stat label="Taxa de conversão" value={`${Math.round((analytics.conversionRate || 0) * 100)}%`} highlight />
        <Stat label="Faturamento previsto (quentes)" value={`R$ ${analytics.forecastHotValue.toLocaleString("pt-BR")}`} />
        <Stat label="Leads estagnados" value={analytics.stalledDeals} warn={analytics.stalledDeals > 0} />
        <Stat label="Follow-ups atrasados" value={analytics.overdueFollowUps} warn={analytics.overdueFollowUps > 0} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="border border-gray-100 rounded-xl p-4">
          <p className="text-sm font-semibold text-gray-700 mb-3">Motivos de perda</p>
          {lostData.length === 0 ? (
            <p className="text-xs text-gray-400">Sem registros</p>
          ) : (
            <div className="h-52">
              <ResponsiveContainer>
                <PieChart>
                  <Pie dataKey="value" data={lostData} innerRadius={40} outerRadius={70} paddingAngle={2}>
                    {lostData.map((_, index) => (
                      <Cell key={index} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(val: any) => val} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="border border-gray-100 rounded-xl p-4">
          <p className="text-sm font-semibold text-gray-700 mb-3">Distribuição por temperatura</p>
          <div className="h-52">
            <ResponsiveContainer>
              <BarChart data={tempData}>
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Bar dataKey="value" radius={[6, 6, 0, 0]} fill="#6366F1" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="border border-gray-100 rounded-xl p-4 space-y-2">
          <p className="text-sm font-semibold text-gray-700">Tempo médio por etapa (h)</p>
          <div className="space-y-2 max-h-52 overflow-y-auto">
            {analytics.avgStageTime.map((item) => {
              const stage = stages.find((s) => s.id === item.stageId);
              return (
                <div key={item.stageId} className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">{stage?.name || item.stageId}</span>
                  <span className="text-sm font-semibold text-gray-800">{item.hours}</span>
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
        "flex-1 min-w-[180px] bg-gray-50 border border-gray-100 rounded-xl px-4 py-3",
        highlight && "bg-indigo-50 border-indigo-100",
        warn && "bg-amber-50 border-amber-200"
      )}
    >
      <p className="text-xs font-semibold text-gray-500 uppercase">{label}</p>
      <p className="text-lg font-bold text-gray-800">{value}</p>
    </div>
  );
}

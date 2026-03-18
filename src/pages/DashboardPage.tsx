import React, { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { format } from "date-fns";
import {
  Area,
  AreaChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AlertCircle,
  ArrowDownRight,
  ArrowUpRight,
  Calendar as CalendarIcon,
  CheckCircle2,
  DollarSign,
  Eye,
  EyeOff,
  MessageSquare,
  Sparkles,
  Trello,
  Users,
  X,
} from "lucide-react";

import { LayoutOutletContext } from "../components/layout/AppLayout";
import { authFetch } from "../utils/authFetch";
import { cn } from "../utils/cn";
import { parseDate } from "../utils/date";
import { Client, DashboardStats, Job, Opportunity } from "../types";

function StatCard({ 
  title, 
  value, 
  icon, 
  trend, 
  trendUp, 
  hidden 
}: { 
  title: string; 
  value: string | number; 
  icon: React.ReactNode; 
  trend: string; 
  trendUp: boolean;
  hidden?: boolean;
}) {
  return (
    <div className="bg-white dark:bg-gray-900 p-6 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div className="w-12 h-12 bg-gray-50 dark:bg-gray-800 rounded-xl flex items-center justify-center">{icon}</div>
        {trend ? (
          <div
            className={cn(
              "flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-lg",
              trendUp 
                ? "bg-emerald-50 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400" 
                : "bg-red-50 dark:bg-red-500/20 text-red-600 dark:text-red-400"
            )}
          >
            {trendUp ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
            {trend}
          </div>
        ) : null}
      </div>
      <p className="text-gray-500 dark:text-gray-400 text-sm font-medium">{title}</p>
      <h4 className="text-2xl font-bold mt-1 text-gray-900 dark:text-white">
        {hidden ? "R$ •••••" : value}
      </h4>
    </div>
  );
}

function Dashboard({
  stats,
  jobs,
  clients,
  opportunities,
  onContactOpp,
  onDismissOpp,
}: {
  stats: DashboardStats | null;
  jobs: Job[];
  clients: Client[];
  opportunities: Opportunity[];
  onContactOpp: (opp: Opportunity, client: Client | null) => void;
  onDismissOpp: (oppId: number) => void;
}) {
  const [revenueRange, setRevenueRange] = useState<"7" | "30" | "60" | "90" | "180" | "365" | "custom">("30");
  const [hideValues, setHideValues] = useState(() => {
    const saved = localStorage.getItem("dashboard_hide_values");
    return saved === "true";
  });
  const [confirmDiscardId, setConfirmDiscardId] = useState<number | null>(null);

  const today = new Date();
  const defaultEnd = format(today, "yyyy-MM-dd");
  const defaultStart30 = format(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 29), "yyyy-MM-dd");

  const [customStartDate, setCustomStartDate] = useState<string>(defaultStart30);
  const [customEndDate, setCustomEndDate] = useState<string>(defaultEnd);

  const toggleHideValues = () => {
    const newValue = !hideValues;
    setHideValues(newValue);
    localStorage.setItem("dashboard_hide_values", String(newValue));
  };

  if (!stats) return null;

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case "urgent":
        return "text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/20 border-red-100 dark:border-red-500/30";
      case "active":
        return "text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/20 border-amber-100 dark:border-amber-500/30";
      default:
        return "text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-500/20 border-indigo-100 dark:border-indigo-500/30";
    }
  };

  const revenueMap = new Map((stats.dailyRevenue || []).map((item) => [item.date, Number(item.total || 0)]));

  let startDate = new Date();
  let endDate = new Date();

  if (revenueRange === "custom") {
    const parsedStart = parseDate(customStartDate);
    const parsedEnd = parseDate(customEndDate);

    startDate = parsedStart || new Date();
    endDate = parsedEnd || new Date();
  } else {
    const rangeDays = Number(revenueRange);
    endDate = new Date();
    startDate = new Date();
    startDate.setDate(endDate.getDate() - (rangeDays - 1));
  }

  startDate.setHours(0, 0, 0, 0);
  endDate.setHours(0, 0, 0, 0);

  if (startDate > endDate) {
    const temp = startDate;
    startDate = endDate;
    endDate = temp;
  }

  const diffTime = endDate.getTime() - startDate.getTime();
  const rangeDays = Math.floor(diffTime / (1000 * 60 * 60 * 24)) + 1;

  const chartData = Array.from({ length: rangeDays }, (_, index) => {
    const currentDate = new Date(startDate);
    currentDate.setDate(startDate.getDate() + index);

    const yyyy = currentDate.getFullYear();
    const mm = String(currentDate.getMonth() + 1).padStart(2, "0");
    const dd = String(currentDate.getDate()).padStart(2, "0");
    const isoDate = `${yyyy}-${mm}-${dd}`;

    return {
      date: isoDate,
      label: `${dd}/${mm}`,
      total: revenueMap.get(isoDate) || 0,
    };
  });

  const revenueSelectedPeriod = chartData.reduce((sum, item) => sum + item.total, 0);

  const scheduledJobs = jobs.filter((job) => {
    if (!job.job_date) return false;
    const date = parseDate(job.job_date);
    if (!date) return false;
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    return date >= todayStart && job.status !== "cancelled";
  });

  const futureRevenue30 = scheduledJobs
    .filter((job) => {
      const date = parseDate(job.job_date);
      if (!date) return false;
      const limit = new Date();
      limit.setDate(limit.getDate() + 30);
      return date <= limit;
    })
    .reduce((sum, job) => sum + Number(job.amount || 0), 0);

  const futureRevenue90 = scheduledJobs
    .filter((job) => {
      const date = parseDate(job.job_date);
      if (!date) return false;
      const limit = new Date();
      limit.setDate(limit.getDate() + 90);
      return date <= limit;
    })
    .reduce((sum, job) => sum + Number(job.amount || 0), 0);

  const futureRevenueByMonthMap = new Map<string, number>();

  scheduledJobs.forEach((job) => {
    const date = parseDate(job.job_date);
    if (!date) return;

    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const key = `${yyyy}-${mm}`;

    futureRevenueByMonthMap.set(key, (futureRevenueByMonthMap.get(key) || 0) + Number(job.amount || 0));
  });

  const futureRevenueByMonth = Array.from(futureRevenueByMonthMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(0, 6)
    .map(([month, total]) => ({
      month,
      label: `${month.slice(5, 7)}/${month.slice(0, 4)}`,
      total,
    }));

  const formatValue = (value: number) => {
    if (hideValues) return "R$ •••••";
    return `R$ ${value.toLocaleString("pt-BR")}`;
  };

  return (
    <div className="space-y-8">
      {/* Header com botão de esconder valores */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-800 dark:text-white">Dashboard</h2>
          <p className="text-gray-500 dark:text-gray-400 mt-1">Visão geral do seu negócio</p>
        </div>
        <button
          onClick={toggleHideValues}
          className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-xl font-semibold transition-all",
            hideValues
              ? "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
              : "bg-indigo-50 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-500/30"
          )}
          title={hideValues ? "Mostrar valores" : "Esconder valores"}
        >
          {hideValues ? <EyeOff size={18} /> : <Eye size={18} />}
          {hideValues ? "Mostrar valores" : "Esconder valores"}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
        <StatCard title="Leads Ativos" value={stats.activeLeads} icon={<Trello className="text-blue-600 dark:text-blue-400" />} trend="" trendUp />
        <StatCard title="Vendas no Mês" value={stats.totalJobsMonth} icon={<CheckCircle2 className="text-emerald-600 dark:text-emerald-400" />} trend="" trendUp />
        <StatCard title="Clientes do Mês" value={stats.totalClientsMonth} icon={<Users className="text-violet-600 dark:text-violet-400" />} trend="" trendUp />
        <StatCard
          title={revenueRange === "custom" ? "Faturamento no Período" : `Faturamento ${rangeDays} dias`}
          value={formatValue(revenueSelectedPeriod)}
          icon={<DollarSign className="text-amber-600 dark:text-amber-400" />}
          trend=""
          trendUp
          hidden={hideValues}
        />
        <StatCard
          title="Futuro 30 dias"
          value={formatValue(futureRevenue30)}
          icon={<CalendarIcon className="text-green-600 dark:text-green-400" />}
          trend=""
          trendUp
          hidden={hideValues}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Gráfico de faturamento - mantém o gradiente colorido */}
        <div className="lg:col-span-2 rounded-[28px] p-6 md:p-8 shadow-lg overflow-hidden relative bg-gradient-to-br from-indigo-600 via-blue-600 to-violet-600">
          <div className="absolute inset-0 opacity-20 pointer-events-none">
            <div className="absolute -top-10 -right-10 w-56 h-56 rounded-full bg-white/20 blur-2xl" />
            <div className="absolute bottom-0 left-0 w-72 h-72 rounded-full bg-cyan-300/20 blur-3xl" />
          </div>

          <div className="relative z-10">
            <div className="flex items-center justify-between gap-4 flex-wrap mb-6">
              <div>
                <p className="text-white/80 text-sm font-medium">Faturamento</p>
                <h3 className="text-white text-4xl md:text-5xl font-bold tracking-tight">
                  {hideValues ? "R$ •••••" : `R$ ${revenueSelectedPeriod.toLocaleString("pt-BR")}`}
                </h3>
                <p className="text-white/80 text-sm mt-2">
                  {format(startDate, "dd/MM/yyyy")} até {format(endDate, "dd/MM/yyyy")}
                </p>
              </div>

              <div className="flex items-center gap-3 flex-wrap">
                <select
                  value={revenueRange}
                  onChange={(e) => setRevenueRange(e.target.value as any)}
                  className="text-sm bg-white/15 text-white rounded-xl px-3 py-2 outline-none border border-white/20 backdrop-blur-md"
                >
                  <option value="7" className="text-black">
                    Últimos 7 dias
                  </option>
                  <option value="30" className="text-black">
                    Mensal (30 dias)
                  </option>
                  <option value="60" className="text-black">
                    60 dias
                  </option>
                  <option value="90" className="text-black">
                    Trimestral (90 dias)
                  </option>
                  <option value="180" className="text-black">
                    Semestral (180 dias)
                  </option>
                  <option value="365" className="text-black">
                    Anual (365 dias)
                  </option>
                  <option value="custom" className="text-black">
                    Período personalizado
                  </option>
                </select>

                {revenueRange === "custom" && (
                  <>
                    <input
                      type="date"
                      value={customStartDate}
                      onChange={(e) => setCustomStartDate(e.target.value)}
                      className="text-sm bg-white/15 text-white rounded-xl px-3 py-2 outline-none border border-white/20 backdrop-blur-md [color-scheme:dark]"
                    />
                    <span className="text-white/70 text-sm">até</span>
                    <input
                      type="date"
                      value={customEndDate}
                      onChange={(e) => setCustomEndDate(e.target.value)}
                      className="text-sm bg-white/15 text-white rounded-xl px-3 py-2 outline-none border border-white/20 backdrop-blur-md [color-scheme:dark]"
                    />
                  </>
                )}
              </div>
            </div>

            <div className="h-72 md:h-80">
              {hideValues ? (
                <div className="h-full flex items-center justify-center">
                  <div className="text-center text-white/60">
                    <EyeOff size={48} className="mx-auto mb-4 opacity-50" />
                    <p className="text-lg font-medium">Valores ocultos</p>
                    <p className="text-sm">Clique em "Mostrar valores" para visualizar o gráfico</p>
                  </div>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={320}>
                  <AreaChart data={chartData}>
                    <defs>
                      <linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="rgba(255,255,255,0.45)" />
                        <stop offset="100%" stopColor="rgba(255,255,255,0.05)" />
                      </linearGradient>
                    </defs>

                    <XAxis
                      dataKey="label"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontSize: 12, fill: "rgba(255,255,255,0.75)" }}
                      interval={Math.max(0, Math.floor(chartData.length / 8))}
                    />
                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: "rgba(255,255,255,0.65)" }} />
                    <Tooltip
                      formatter={(value: any) => [`R$ ${Number(value || 0).toLocaleString("pt-BR")}`, "Faturamento"]}
                      labelFormatter={(label: any, payload: any) => {
                        const item = payload?.[0]?.payload;
                        return item?.date ? `Data: ${item.date}` : label;
                      }}
                      contentStyle={{
                        borderRadius: "16px",
                        border: "1px solid rgba(255,255,255,0.15)",
                        background: "rgba(15, 23, 42, 0.88)",
                        color: "#fff",
                        boxShadow: "0 10px 30px rgba(0,0,0,0.25)",
                        backdropFilter: "blur(10px)",
                      }}
                      labelStyle={{ color: "#cbd5e1" }}
                    />
                    <Area type="monotone" dataKey="total" stroke="rgba(255,255,255,0)" fill="url(#revenueFill)" />
                    <Line
                      type="monotone"
                      dataKey="total"
                      stroke="#FFFFFF"
                      strokeWidth={4}
                      dot={false}
                      activeDot={{ r: 6, fill: "#FFFFFF", stroke: "rgba(255,255,255,0.35)", strokeWidth: 8 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </div>

        {/* Card de Oportunidades */}
        <div className="bg-white dark:bg-gray-900 p-6 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm flex flex-col">
          <div className="flex items-center justify-between mb-6">
            <h3 className="font-bold text-gray-800 dark:text-white flex items-center gap-2">
              <Sparkles className="text-amber-500 dark:text-amber-400" size={18} />
              Próximas Oportunidades
            </h3>
            <span className="bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400 text-[10px] font-bold px-2 py-0.5 rounded-full">{opportunities.length}</span>
          </div>
          <div className="flex-1 space-y-4 overflow-y-auto max-h-[350px] pr-2 custom-scrollbar">
            {opportunities.map((opp) => (
              <div
                key={opp.id}
                className={cn(
                  "p-3 rounded-xl border transition-colors relative group",
                  opp.priority === "urgent"
                    ? "bg-red-50/50 dark:bg-red-500/10 border-red-100 dark:border-red-500/30 hover:border-red-200 dark:hover:border-red-500/50"
                    : opp.priority === "active"
                      ? "bg-amber-50/50 dark:bg-amber-500/10 border-amber-100 dark:border-amber-500/30 hover:border-amber-200 dark:hover:border-amber-500/50"
                      : "bg-gray-50 dark:bg-gray-800 border-gray-100 dark:border-gray-700 hover:border-indigo-200 dark:hover:border-indigo-500/50"
                )}
              >
                {/* Modal de confirmação inline */}
                {confirmDiscardId === opp.id ? (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
                      <AlertCircle size={16} />
                      <p className="text-xs font-medium">Descartar esta oportunidade?</p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setConfirmDiscardId(null)}
                        className="flex-1 py-1.5 text-xs font-bold text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-all border border-gray-200 dark:border-gray-600"
                      >
                        Cancelar
                      </button>
                      <button
                        onClick={() => {
                          onDismissOpp(opp.id);
                          setConfirmDiscardId(null);
                        }}
                        className="flex-1 py-1.5 text-xs font-bold bg-red-500 text-white rounded-lg hover:bg-red-600 transition-all flex items-center justify-center gap-1"
                      >
                        <X size={12} />
                        Confirmar
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    {/* Botão de descartar */}
                    <button
                      onClick={() => setConfirmDiscardId(opp.id)}
                      className="absolute top-2 right-2 p-1 text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/20 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                      title="Descartar oportunidade"
                    >
                      <X size={14} />
                    </button>

                    <div className="flex items-center justify-between mb-1 pr-6">
                      <span className="font-bold text-sm text-gray-900 dark:text-white">{opp.client_name}</span>
                      <span
                        className={cn(
                          "text-[10px] font-bold px-2 py-0.5 rounded-full uppercase",
                          getPriorityColor(opp.priority || "future")
                        )}
                      >
                        {opp.type}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                        <CalendarIcon size={12} />
                        {opp.priority === "urgent" ? "Atrasado: " : "Sugerido: "}
                        {format(new Date(opp.suggested_date), "dd/MM/yyyy")}
                      </div>
                      <div className="flex items-center gap-2">
                        {opp.priority === "urgent" && <AlertCircle size={12} className="text-red-500 dark:text-red-400 animate-pulse" />}
                        {opp.priority === "active" && <Sparkles size={12} className="text-amber-500 dark:text-amber-400" />}
                        <button
                          onClick={() => {
                            const client = clients.find((c) => c.id === opp.client_id) || null;
                            onContactOpp(opp, client);
                          }}
                          className="flex items-center gap-1.5 px-3 py-1 bg-indigo-600 dark:bg-indigo-500 text-white text-[10px] font-bold rounded-lg hover:bg-indigo-700 dark:hover:bg-indigo-600 transition-all shadow-sm"
                        >
                          <MessageSquare size={12} />
                          Contatar
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            ))}
            {opportunities.length === 0 && <div className="text-center py-12 text-gray-400 dark:text-gray-500 italic text-sm">Nenhuma oportunidade detectada no momento.</div>}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Tabela de Trabalhos Recentes */}
        <div className="lg:col-span-2 bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm overflow-hidden">
          <div className="p-6 border-b border-gray-50 dark:border-gray-800 flex items-center justify-between">
            <h3 className="font-bold text-gray-800 dark:text-white">Trabalhos Recentes</h3>
            <button className="text-sm text-indigo-600 dark:text-indigo-400 font-medium hover:underline">Ver todos</button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wider">
                <tr>
                  <th className="px-6 py-4 font-medium">Cliente</th>
                  <th className="px-6 py-4 font-medium">Tipo</th>
                  <th className="px-6 py-4 font-medium">Data</th>
                  <th className="px-6 py-4 font-medium">Valor</th>
                  <th className="px-6 py-4 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                {jobs.slice(0, 5).map((job) => (
                  <tr key={job.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                    <td className="px-6 py-4 font-medium text-gray-900 dark:text-white">{job.client_name || job.job_name || "Tarefa"}</td>
                    <td className="px-6 py-4 text-gray-600 dark:text-gray-300">{job.job_type}</td>
                    <td className="px-6 py-4 text-gray-500 dark:text-gray-400">
                      {job.job_date && !isNaN(new Date(job.job_date).getTime())
                        ? format(new Date(job.job_date), "dd/MM/yyyy")
                        : "-"}
                    </td>
                    <td className="px-6 py-4 font-semibold text-gray-900 dark:text-white">
                      {hideValues ? "R$ •••••" : `R$ ${(job.amount ?? 0).toLocaleString("pt-BR")}`}
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={cn(
                          "px-2 py-1 rounded-full text-[10px] font-bold uppercase",
                          job.payment_status === "paid" 
                            ? "bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400" 
                            : "bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400"
                        )}
                      >
                        {job.payment_status === "paid" ? "Pago" : "Pendente"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Card de Faturamento Futuro */}
        <div className="bg-white dark:bg-gray-900 p-6 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm">
          <h3 className="font-bold text-gray-800 dark:text-white mb-2">Faturamento Futuro</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">Baseado nos ensaios já agendados.</p>

          <div className="grid grid-cols-1 gap-3 mb-6">
            <div className="p-4 rounded-xl bg-green-50 dark:bg-green-500/10 border border-green-100 dark:border-green-500/30">
              <div className="text-xs font-bold uppercase text-green-700 dark:text-green-400 mb-1">Próximos 30 dias</div>
              <div className="text-2xl font-bold text-green-800 dark:text-green-300">
                {hideValues ? "R$ •••••" : `R$ ${futureRevenue30.toLocaleString("pt-BR")}`}
              </div>
            </div>

            <div className="p-4 rounded-xl bg-blue-50 dark:bg-blue-500/10 border border-blue-100 dark:border-blue-500/30">
              <div className="text-xs font-bold uppercase text-blue-700 dark:text-blue-400 mb-1">Próximos 90 dias</div>
              <div className="text-2xl font-bold text-blue-800 dark:text-blue-300">
                {hideValues ? "R$ •••••" : `R$ ${futureRevenue90.toLocaleString("pt-BR")}`}
              </div>
            </div>
          </div>

          <div className="space-y-3">
            {futureRevenueByMonth.length > 0 ? (
              futureRevenueByMonth.map((item) => (
                <div key={item.month} className="flex items-center justify-between text-sm border-b border-gray-50 dark:border-gray-800 pb-2">
                  <span className="text-gray-600 dark:text-gray-400 font-medium">{item.label}</span>
                  <span className="font-bold text-gray-900 dark:text-white">
                    {hideValues ? "R$ •••••" : `R$ ${item.total.toLocaleString("pt-BR")}`}
                  </span>
                </div>
              ))
            ) : (
              <div className="text-sm text-gray-400 dark:text-gray-500 italic">Nenhum faturamento futuro encontrado.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { openContactModal } = useOutletContext<LayoutOutletContext>();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchDashboard = async () => {
    setLoading(true);
    try {
      const [statsRes, clientsRes, jobsRes, oppsRes] = await Promise.all([
        authFetch("/api/stats"),
        authFetch("/api/clients"),
        authFetch("/api/jobs"),
        authFetch("/api/opportunities"),
      ]);

      setStats(await statsRes.json());
      setClients(await clientsRes.json());
      setJobs(await jobsRes.json());
      setOpportunities(await oppsRes.json());
    } catch (error) {
      console.error("Erro ao buscar dados do dashboard:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboard();
  }, []);

  const removeOpportunityLocally = (oppId: number) => {
    setOpportunities(prev => prev.filter(opp => opp.id !== oppId));
  };

  const handleDismissOpp = async (oppId: number) => {
    try {
      await authFetch(`/api/opportunities/${oppId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "dismissed" }),
      });
      removeOpportunityLocally(oppId);
    } catch (error) {
      console.error("Erro ao descartar oportunidade:", error);
    }
  };

  const handleContactOpp = (opp: Opportunity, client: Client | null) => {
    openContactModal({
      opportunity: opp,
      client,
      onUpdate: fetchDashboard,
      onDiscardSuccess: removeOpportunityLocally,
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 dark:border-indigo-400" />
      </div>
    );
  }

  return (
    <Dashboard
      stats={stats}
      jobs={jobs}
      clients={clients}
      opportunities={opportunities}
      onContactOpp={handleContactOpp}
      onDismissOpp={handleDismissOpp}
    />
  );
}

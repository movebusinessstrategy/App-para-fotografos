import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import {
  addDays, addMonths, endOfMonth, format, getDay, getDaysInMonth,
  isSameDay, isWithinInterval, parseISO, startOfMonth, subDays,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  AlertTriangle, ArrowRight, Calendar as CalendarIcon, Camera, Check, ChevronLeft, ChevronRight,
  DollarSign, Eye, EyeOff, FileClock, FileText, Lightbulb, PieChart as PieIcon,
  Sparkles, Target, TrendingDown, TrendingUp, Trophy, Wallet, X,
} from "lucide-react";

import { motion, animate } from "motion/react";

import { LayoutOutletContext } from "../components/layout/AppLayout";
import { authFetch } from "../utils/authFetch";
import { cn } from "../utils/cn";
import { Client, Opportunity } from "../types";
import { useAuth } from "../contexts/AuthContext";

// ─── Types ───────────────────────────────────────────────────────────────────

interface JobLite {
  id: number;
  client_name: string | null;
  job_type: string;
  job_date: string;
  job_time?: string;
  amount: number;
  production_stage?: string | null;
}

interface Analytics {
  period?: {
    start_date: string;
    end_date: string;
    previous_start_date: string;
    previous_end_date: string;
    days: number;
  };
  attention: number;
  jobs: {
    today: { count: number; list: JobLite[] };
    next7Days: { count: number; list: JobLite[] };
    thisMonth: { total: number; completed: number; scheduled: number; cancelled: number };
    late: { count: number; list: JobLite[] };
    awaitingContract: { count: number; list: JobLite[] };
    awaitingSelection: { count: number; list: JobLite[] };
    byType?: Array<{ type: string; count: number; total: number }>;
  };
  sales: {
    activeCount: number;
    activeValue: number;
    byStage: Array<{ id: string; name: string; color: string; count: number; total_value: number; position: number; is_final: boolean; is_won: boolean }>;
    conversion: Array<{ stage_id: string; stage_name: string; entered: number; advanced: number; lost: number; conversion_rate: number | null }>;
    hotDeals: Array<{ id: number; title: string; client_name: string | null; value: number; stage_name: string; temperature: 'hot' | 'warm' | 'cold' }>;
  };
  production: {
    processes: Array<{
      id: string; name: string; color: string; is_special: boolean; total_jobs: number;
      stages: Array<{ id: string; name: string; color: string; count: number; late_count: number; expected_hours: number }>;
    }>;
  };
  opportunities: {
    total: number; urgent: number; active: number; future: number;
    list: Array<{ id: number; client_id: number; client_name: string | null; type: string; suggested_date: string; priority: 'urgent' | 'active' | 'future' }>;
  };
  finance: {
    revenueThisMonth: number;
    revenueLastMonth: number;
    futureRevenue: number;
    toReceiveOpen: number;
    sinalRecebidoOpen: number;
    openJobsCount: number;
    expensesThisMonth: number;
    dailyRevenue: Array<{ date: string; total: number }>;
  };
}

type DatePreset = "month" | "7d" | "15d" | "30d" | "custom";
type DashboardDateRange = { from: string; to: string };

// ─── Helpers ─────────────────────────────────────────────────────────────────

const formatBRL = (value: number, hide: boolean) =>
  hide ? "R$ •••••" : `R$ ${(value || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const formatBRLShort = (value: number, hide: boolean) => {
  if (hide) return "R$ •••";
  if (value >= 1000) return `R$ ${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k`;
  return `R$ ${(value || 0).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`;
};

const toDateOnly = (date: Date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

const fromDateOnly = (value: string) => {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
};

function buildPresetRange(preset: DatePreset): DashboardDateRange {
  const today = new Date();
  if (preset === "7d") return { from: toDateOnly(subDays(today, 6)), to: toDateOnly(today) };
  if (preset === "15d") return { from: toDateOnly(subDays(today, 14)), to: toDateOnly(today) };
  if (preset === "30d") return { from: toDateOnly(subDays(today, 29)), to: toDateOnly(today) };
  return { from: toDateOnly(startOfMonth(today)), to: toDateOnly(endOfMonth(today)) };
}

function formatRangeLabel(range: DashboardDateRange) {
  const from = fromDateOnly(range.from);
  const to = fromDateOnly(range.to);
  if (range.from === range.to) return format(from, "dd 'de' MMMM yyyy", { locale: ptBR });
  if (from.getFullYear() === to.getFullYear()) {
    return `${format(from, "dd MMM", { locale: ptBR })} - ${format(to, "dd MMM yyyy", { locale: ptBR })}`;
  }
  return `${format(from, "dd MMM yyyy", { locale: ptBR })} - ${format(to, "dd MMM yyyy", { locale: ptBR })}`;
}

function formatRangeShort(range: DashboardDateRange) {
  return `${format(fromDateOnly(range.from), "dd/MM/yy")} - ${format(fromDateOnly(range.to), "dd/MM/yy")}`;
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const navigate = useNavigate();
  const { canAccess } = useAuth();
  const canSeeFinance = canAccess('finance'); // dono ou funcionário com permissão "Financeiro"
  const { openContactModal } = useOutletContext<LayoutOutletContext>();
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [vendasA, setVendasA] = useState<any | null>(null); // /api/vendas/analytics (meta + ticket 6m)
  const [hideValuesPref, setHideValues] = useState(() => localStorage.getItem("dashboard_hide_values") === "true");
  // Sem permissão de Financeiro: valores SEMPRE mascarados (sobra funil, hot deals).
  const hideValues = !canSeeFinance || hideValuesPref;
  const [datePreset, setDatePreset] = useState<DatePreset>("month");
  const [dateRange, setDateRange] = useState<DashboardDateRange>(() => buildPresetRange("month"));
  const fetchSeq = useRef(0);

  const toggleHideValues = () => {
    setHideValues(prev => {
      const next = !prev;
      localStorage.setItem("dashboard_hide_values", String(next));
      return next;
    });
  };

  const fetchAll = async () => {
    const seq = fetchSeq.current + 1;
    fetchSeq.current = seq;
    const fullPageLoading = !analytics;
    setLoading(fullPageLoading);
    setRefreshing(!fullPageLoading);
    try {
      const qs = new URLSearchParams({ from: dateRange.from, to: dateRange.to });
      const [aRes, oRes, cRes] = await Promise.all([
        authFetch(`/api/dashboard/analytics?${qs.toString()}`),
        authFetch("/api/opportunities"),
        authFetch("/api/clients"),
      ]);
      if (fetchSeq.current !== seq) return;
      if (aRes.ok) { setAnalytics(await aRes.json()); setLoadError(false); }
      else setLoadError(true); // API com erro → mostra retry, não spinner eterno
      if (oRes.ok) setOpportunities(await oRes.json());
      if (cRes.ok) setClients(await cRes.json());
      // Central de vendas (meta vs realizado + ticket médio, 6 meses) — best-effort
      if (canSeeFinance) {
        authFetch(`/api/vendas/analytics?${qs.toString()}`)
          .then(r => (r.ok ? r.json() : null))
          .then(d => { if (fetchSeq.current === seq && d) setVendasA(d); })
          .catch(() => {});
      }
    } catch (err) {
      console.error(err);
      if (fetchSeq.current === seq) setLoadError(true);
    } finally {
      if (fetchSeq.current === seq) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  };

  useEffect(() => { fetchAll(); }, [dateRange.from, dateRange.to]);

  const applyPreset = (preset: DatePreset) => {
    setDatePreset(preset);
    if (preset !== "custom") setDateRange(buildPresetRange(preset));
  };

  const applyCustomRange = (range: DashboardDateRange) => {
    setDatePreset("custom");
    setDateRange(range);
  };

  const removeOpportunityLocally = (oppId: number) =>
    setOpportunities(prev => prev.filter(o => o.id !== oppId));

  const handleDismissOpp = async (oppId: number) => {
    try {
      await authFetch(`/api/opportunities/${oppId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "dismissed" }),
      });
      removeOpportunityLocally(oppId);
    } catch (err) {
      console.error(err);
    }
  };

  const handleContactOpp = (opp: Opportunity) => {
    const client = clients.find(c => c.id === opp.client_id) || null;
    openContactModal({
      opportunity: opp,
      client,
      onUpdate: fetchAll,
      onDiscardSuccess: removeOpportunityLocally,
    });
  };

  if (!analytics && loadError) {
    // Falha na API (deploy no meio, rede...) — retry em vez de spinner eterno
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <p className="text-sm text-gray-500 dark:text-gray-400">Não consegui carregar os dados agora.</p>
        <button
          onClick={() => { setLoadError(false); fetchAll(); }}
          className="px-4 py-2 rounded-xl bg-gold-500 hover:bg-gold-600 text-white text-sm font-semibold"
        >
          Tentar de novo
        </button>
      </div>
    );
  }
  if (loading || !analytics) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gold-500" />
      </div>
    );
  }

  const a = analytics;
  const periodLabel = formatRangeLabel(dateRange);
  const periodDelta = a.finance.revenueLastMonth > 0
    ? Math.round(((a.finance.revenueThisMonth - a.finance.revenueLastMonth) / a.finance.revenueLastMonth) * 100)
    : null;
  // ── Visão de diretoria (derivados) ────────────────────────────────────────
  const lucro = a.finance.revenueThisMonth - a.finance.expensesThisMonth;
  const margem = a.finance.revenueThisMonth > 0 ? (lucro / a.finance.revenueThisMonth) * 100 : 0;
  const wonAgg = a.sales.byStage.filter(s => s.is_won);
  const lostAgg = a.sales.byStage.filter(s => s.is_final && !s.is_won);
  const wonCount = wonAgg.reduce((x, s) => x + s.count, 0);
  const wonValue = wonAgg.reduce((x, s) => x + s.total_value, 0);
  const lostCount = lostAgg.reduce((x, s) => x + s.count, 0);
  const convPeriodo = wonCount + lostCount > 0 ? Math.round((wonCount / (wonCount + lostCount)) * 100) : null;
  const insights = computeInsights(a, periodDelta, canSeeFinance, hideValues);

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-gray-900 dark:text-white">
            Visão geral
          </h1>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 capitalize">{periodLabel}</p>
          {refreshing && (
            <p className="text-[11px] text-gold-600 dark:text-gold-400 mt-1">Atualizando dados...</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DashboardPeriodFilter
            preset={datePreset}
            range={dateRange}
            onPreset={applyPreset}
            onCustomRange={applyCustomRange}
          />
          {canSeeFinance && (
          <button
            onClick={toggleHideValues}
            className="p-2 rounded-full text-gray-400 hover:text-gold-500 hover:bg-gold-500/10 transition-colors"
            title={hideValues ? "Mostrar valores" : "Esconder valores"}
          >
            {hideValues ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
          )}
        </div>
      </div>

      {/* ══ O PULSO: uma faixa única, sem 4 caixinhas ══ */}
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="rounded-3xl bg-white/70 dark:bg-white/[0.045] backdrop-blur-sm shadow-[0_1px_2px_rgba(0,0,0,0.04)] dark:shadow-none overflow-hidden"
      >
        <div className="grid grid-cols-2 xl:grid-cols-4 divide-y xl:divide-y-0 xl:divide-x divide-black/5 dark:divide-white/[0.06]">
          {canSeeFinance ? (<>
            <KpiCell label="Faturamento" num={a.finance.revenueThisMonth} render={(n) => formatBRL(n, hideValues)} deltaPct={periodDelta} spark={a.finance.dailyRevenue} />
            <KpiCell label="Lucro" num={lucro} render={(n) => formatBRL(n, hideValues)} hint={hideValues ? 'Entrada − Saída' : `Margem de ${margem.toFixed(0)}%`} negative={lucro < 0} />
            <KpiCell label="A receber" num={a.finance.toReceiveOpen} render={(n) => formatBRL(n, hideValues)} hint={`${a.finance.openJobsCount} ensaio${a.finance.openJobsCount === 1 ? '' : 's'} · sinal ${formatBRLShort(a.finance.sinalRecebidoOpen, hideValues)} pago`} />
            <KpiCell label="Vendas fechadas" num={wonCount} render={(n) => String(Math.round(n))} hint={`${formatBRLShort(wonValue, hideValues)}${convPeriodo !== null ? ` · ${convPeriodo}% de conversão` : ''}`} spark={vendasA?.daily} sparkKey="count" />
          </>) : (<>
            <KpiCell label="Ensaios no período" num={a.jobs.thisMonth.total} render={(n) => String(Math.round(n))} hint={`${a.jobs.thisMonth.completed} feitos · ${a.jobs.thisMonth.scheduled} agendados`} />
            <KpiCell label="Funil ativo" num={a.sales.activeCount} render={(n) => String(Math.round(n))} hint="leads em aberto" />
            <KpiCell label="Pendências" num={a.attention} render={(n) => String(Math.round(n))} hint="atrasos, contratos e seleção" />
            <KpiCell label="Hoje" num={a.jobs.today.count} render={(n) => String(Math.round(n))} hint={a.jobs.today.count === 0 ? 'sem ensaios hoje' : 'ensaios agendados'} />
          </>)}
        </div>
      </motion.div>

      {canSeeFinance && (
        <div className="flex flex-wrap gap-2">
          <MiniStat label="Ensaios" value={String(a.jobs.thisMonth.total)} onClick={() => navigate('/jobs')} />
          <MiniStat label="Funil ativo" value={`${a.sales.activeCount} · ${formatBRLShort(a.sales.activeValue, hideValues)}`} onClick={() => navigate('/vendas')} />
          <MiniStat label="Hoje" value={a.jobs.today.count === 0 ? 'livre' : `${a.jobs.today.count} ensaio${a.jobs.today.count === 1 ? '' : 's'}`} onClick={() => navigate('/calendar')} />
          <MiniStat label="Pendências" value={String(a.attention)} tone={a.attention > 0 ? 'warn' : 'ok'} onClick={() => navigate('/jobs')} />
        </div>
      )}

      {/* ══ Evolução (grande, com linhas-guia) + Precisa de você ══ */}
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-3">
        {canSeeFinance ? (
          <Card>
            <div className="flex items-start justify-between mb-1">
              <div>
                <p className="text-[11px] uppercase tracking-widest text-gray-400 dark:text-gray-500 font-semibold">Evolução do faturamento</p>
                <p className="text-2xl font-bold text-gray-900 dark:text-white tabular-nums mt-1">
                  <AnimatedNumber value={a.finance.revenueThisMonth} format={(n) => formatBRL(n, hideValues)} />
                  {periodDelta !== null && (
                    <span className={cn("ml-2 text-xs font-bold align-middle", periodDelta >= 0 ? "text-emerald-500" : "text-red-400")}>
                      {periodDelta >= 0 ? '↑' : '↓'} {Math.abs(periodDelta)}% vs anterior
                    </span>
                  )}
                </p>
              </div>
              <span className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 mt-1">{formatRangeShort(dateRange)}</span>
            </div>
            <div className="-mx-2">
              <ResponsiveContainer width="100%" height={220} minWidth={0}>
                <AreaChart data={a.finance.dailyRevenue}>
                  <defs>
                    <linearGradient id="revGold" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#F1C665" stopOpacity={0.45} />
                      <stop offset="100%" stopColor="#F1C665" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="currentColor" strokeOpacity={0.07} />
                  <XAxis dataKey="date" tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(d) => format(parseISO(String(d)), 'dd/MM')} interval="preserveStartEnd" />
                  <YAxis tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => hideValues ? '•••' : `R$ ${Number(v) >= 1000 ? `${(Number(v) / 1000).toFixed(0)}k` : Number(v).toFixed(0)}`} width={50} />
                  <Tooltip
                    contentStyle={{ background: 'rgba(20, 20, 20, 0.95)', border: '1px solid rgba(241, 198, 101, 0.3)', borderRadius: 12, color: '#fff', fontSize: 12 }}
                    formatter={(v: any) => hideValues ? ['•••', 'Receita'] : [`R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, 'Receita']}
                    labelFormatter={(d) => format(parseISO(String(d)), "dd 'de' MMMM", { locale: ptBR })}
                  />
                  <Area type="monotone" dataKey="total" stroke="#F1C665" strokeWidth={2.5} fill="url(#revGold)" dot={false} activeDot={{ r: 4, fill: '#F1C665', stroke: '#fff', strokeWidth: 2 }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>
        ) : (
          <Card>
            <div className="flex items-center justify-between mb-4">
              <CardHeader icon={<Target size={16} />} title="Funil de vendas" inline />
              <button onClick={() => navigate("/vendas")} className="text-[10px] uppercase tracking-wider text-gold-500 hover:text-gold-400 inline-flex items-center gap-1">
                Detalhes <ArrowRight size={10} />
              </button>
            </div>
            <SalesFunnel byStage={a.sales.byStage} conversion={a.sales.conversion} hideValues={hideValues} />
          </Card>
        )}

        <Card>
          <div className="flex items-center justify-between mb-3">
            <CardHeader icon={<AlertTriangle size={16} />} title="Precisa de você" inline />
            {a.attention > 0 && (
              <span className="text-[10px] font-bold text-amber-500 bg-amber-500/15 px-2 py-0.5 rounded-full">{a.attention}</span>
            )}
          </div>
          <AttentionList a={a} canSeeFinance={canSeeFinance} hideValues={hideValues} onNavigate={navigate} />
        </Card>
      </div>

      {/* ══ Meta vs Realizado + Ticket médio (6 meses) — os gráficos da referência ══ */}
      {canSeeFinance && vendasA?.mensal?.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <Card>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[11px] uppercase tracking-widest text-gray-400 dark:text-gray-500 font-semibold">Meta vs realizado · 6 meses</p>
              {Number(vendasA.metaTime) > 0 && (
                <span className="flex items-center gap-3 text-[10px] text-gray-400 dark:text-gray-500">
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-gray-300 dark:bg-gray-600" /> Meta</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-emerald-500" /> Realizado</span>
                </span>
              )}
            </div>
            <MonthlyBars mensal={vendasA.mensal} hideValues={hideValues} />
            {Number(vendasA.metaTime) === 0 && (
              <p className="mt-1 text-[11px] text-gray-400 dark:text-gray-500">Defina a meta de cada vendedor em Configurações → Equipe pra comparar com o realizado.</p>
            )}
          </Card>
          <Card>
            <p className="text-[11px] uppercase tracking-widest text-gray-400 dark:text-gray-500 font-semibold mb-2">Ticket médio · 6 meses</p>
            <TicketLine mensal={vendasA.mensal} hideValues={hideValues} />
          </Card>
        </div>
      )}

      {/* ══ Funil + Onde o dinheiro nasce + Agenda ══ */}
      <div className={cn("grid grid-cols-1 gap-3", canSeeFinance ? "lg:grid-cols-3" : "lg:grid-cols-2")}>
        {canSeeFinance && (
          <Card>
            <div className="flex items-center justify-between mb-4">
              <CardHeader icon={<Target size={16} />} title="Funil de vendas" inline />
              <button onClick={() => navigate("/vendas")} className="text-[10px] uppercase tracking-wider text-gold-500 hover:text-gold-400 inline-flex items-center gap-1">
                Detalhes <ArrowRight size={10} />
              </button>
            </div>
            <SalesFunnel byStage={a.sales.byStage} conversion={a.sales.conversion} hideValues={hideValues} />
          </Card>
        )}

        {canSeeFinance && (
          <Card>
            <CardHeader icon={<Camera size={16} />} title="Onde o dinheiro nasce" inline />
            <TypeBars byType={a.jobs.byType || []} hideValues={hideValues} />
          </Card>
        )}

        <Card>
          <div className="flex items-center justify-between mb-3">
            <CardHeader icon={<CalendarIcon size={16} />} title={a.jobs.today.count > 0 ? "Hoje" : "Próximos ensaios"} inline />
            <button onClick={() => navigate("/calendar")} className="text-[10px] uppercase tracking-wider text-gold-500 hover:text-gold-400 inline-flex items-center gap-1">
              Agenda <ArrowRight size={10} />
            </button>
          </div>
          <AgendaList a={a} hideValues={hideValues} />
        </Card>
      </div>

      {/* ══ Recompra ══ */}
      {(opportunities.length > 0 || a.opportunities.total > 0) && (
        <Card>
          <div className="flex items-center justify-between mb-3">
            <CardHeader icon={<Sparkles size={16} />} title="Clientes prontos pra comprar de novo" inline />
            <span className="text-[10px] font-bold text-gold-500 bg-gold-500/15 dark:bg-gold-500/20 px-2 py-0.5 rounded-full">
              {a.opportunities.total}
            </span>
          </div>
          <InternalOpportunities
            opportunities={opportunities}
            summary={a.opportunities}
            onContact={handleContactOpp}
            onDismiss={handleDismissOpp}
          />
        </Card>
      )}
    </div>
  );
}

// ─── Dashboard period filter ─────────────────────────────────────────────────

const PRESETS: Array<{ id: DatePreset; label: string }> = [
  { id: "month", label: "Mês atual" },
  { id: "7d", label: "7 dias" },
  { id: "15d", label: "15 dias" },
  { id: "30d", label: "30 dias" },
];

const WEEKDAYS = ["D", "S", "T", "Q", "Q", "S", "S"];

function DashboardPeriodFilter({
  preset, range, onPreset, onCustomRange,
}: {
  preset: DatePreset;
  range: DashboardDateRange;
  onPreset: (preset: DatePreset) => void;
  onCustomRange: (range: DashboardDateRange) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex items-center rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#161616] p-1 shadow-sm">
        {PRESETS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onPreset(item.id)}
            className={cn(
              "px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap",
              preset === item.id
                ? "bg-gold-500/15 text-gold-700 dark:text-gold-300"
                : "text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div ref={ref} className="relative">
        <button
          type="button"
          onClick={() => setOpen(v => !v)}
          className={cn(
            "inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold transition-colors shadow-sm",
            preset === "custom"
              ? "border-gold-300 bg-gold-500/15 text-gold-700 dark:border-gold-500/40 dark:text-gold-300"
              : "border-gray-200 dark:border-gray-800 bg-white dark:bg-[#161616] text-gray-600 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-700"
          )}
        >
          <CalendarIcon size={14} />
          <span>{preset === "custom" ? formatRangeShort(range) : "Período"}</span>
        </button>

        {open && (
          <DateRangePopover
            range={range}
            onApply={(next) => {
              onCustomRange(next);
              setOpen(false);
            }}
            onClose={() => setOpen(false)}
          />
        )}
      </div>
    </div>
  );
}

function DateRangePopover({
  range, onApply, onClose,
}: {
  range: DashboardDateRange;
  onApply: (range: DashboardDateRange) => void;
  onClose: () => void;
}) {
  const [cursor, setCursor] = useState(() => startOfMonth(fromDateOnly(range.from)));
  const [draftFrom, setDraftFrom] = useState<Date | null>(() => fromDateOnly(range.from));
  const [draftTo, setDraftTo] = useState<Date | null>(() => fromDateOnly(range.to));

  const commitDay = (day: Date) => {
    const clean = new Date(day.getFullYear(), day.getMonth(), day.getDate());
    if (!draftFrom || draftTo) {
      setDraftFrom(clean);
      setDraftTo(null);
      return;
    }
    if (clean < draftFrom) {
      setDraftTo(draftFrom);
      setDraftFrom(clean);
      return;
    }
    setDraftTo(clean);
  };

  const canApply = !!draftFrom && !!draftTo;
  const draftLabel = canApply
    ? formatRangeLabel({ from: toDateOnly(draftFrom), to: toDateOnly(draftTo) })
    : draftFrom
    ? `${format(draftFrom, "dd/MM/yyyy")} - selecione o fim`
    : "Selecione o início";

  return (
    <div className="absolute right-0 top-full z-50 mt-2 w-[min(92vw,640px)] rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#161616] shadow-2xl overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-100 dark:border-gray-800">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-wider text-gold-600 dark:text-gold-400">Período personalizado</p>
          <p className="text-sm text-gray-700 dark:text-gray-200 truncate capitalize">{draftLabel}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          title="Fechar"
        >
          <X size={16} />
        </button>
      </div>

      <div className="flex items-center justify-between px-4 py-3">
        <button
          type="button"
          onClick={() => setCursor(c => addMonths(c, -1))}
          className="p-2 rounded-lg text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          title="Mês anterior"
        >
          <ChevronLeft size={16} />
        </button>
        <div className="text-sm font-semibold text-gray-900 dark:text-white capitalize">
          {format(cursor, "MMMM yyyy", { locale: ptBR })}
          <span className="hidden sm:inline text-gray-400 dark:text-gray-500"> / </span>
          <span className="hidden sm:inline">{format(addMonths(cursor, 1), "MMMM yyyy", { locale: ptBR })}</span>
        </div>
        <button
          type="button"
          onClick={() => setCursor(c => addMonths(c, 1))}
          className="p-2 rounded-lg text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          title="Próximo mês"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 px-4 pb-4">
        <RangeMonth month={cursor} from={draftFrom} to={draftTo} onPick={commitDay} />
        <RangeMonth month={addMonths(cursor, 1)} from={draftFrom} to={draftTo} onPick={commitDay} className="hidden sm:block" />
      </div>

      <div className="flex items-center justify-between gap-3 px-4 py-3 bg-gray-50 dark:bg-gray-900/70 border-t border-gray-100 dark:border-gray-800">
        <button
          type="button"
          onClick={() => {
            const rawToday = new Date();
            const today = new Date(rawToday.getFullYear(), rawToday.getMonth(), rawToday.getDate());
            setDraftFrom(subDays(today, 6));
            setDraftTo(today);
            setCursor(startOfMonth(today));
          }}
          className="text-xs font-semibold text-gray-500 dark:text-gray-400 hover:text-gold-600 dark:hover:text-gold-300 transition-colors"
        >
          Usar últimos 7 dias
        </button>
        <button
          type="button"
          disabled={!canApply}
          onClick={() => {
            if (!draftFrom || !draftTo) return;
            onApply({ from: toDateOnly(draftFrom), to: toDateOnly(draftTo) });
          }}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gold-600 hover:bg-gold-700 disabled:opacity-40 disabled:hover:bg-gold-600 text-white text-xs font-bold transition-colors"
        >
          <Check size={14} />
          Aplicar
        </button>
      </div>
    </div>
  );
}

function RangeMonth({
  month, from, to, onPick, className,
}: {
  month: Date;
  from: Date | null;
  to: Date | null;
  onPick: (day: Date) => void;
  className?: string;
}) {
  const start = startOfMonth(month);
  const daysInMonth = getDaysInMonth(month);
  const startWeekday = getDay(start);
  const totalCells = Math.ceil((startWeekday + daysInMonth) / 7) * 7;
  const selectedInterval = from && to ? { start: from, end: to } : null;

  return (
    <div className={className}>
      <p className="mb-2 text-center text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 capitalize">
        {format(month, "MMMM", { locale: ptBR })}
      </p>
      <div className="grid grid-cols-7 mb-1">
        {WEEKDAYS.map((d, idx) => (
          <div key={`${d}-${idx}`} className="text-center text-[10px] font-bold text-gray-400 dark:text-gray-500 py-1">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-y-1">
        {Array.from({ length: totalCells }).map((_, i) => {
          const dayNum = i - startWeekday + 1;
          if (dayNum < 1 || dayNum > daysInMonth) return <div key={i} className="h-9" />;

          const day = new Date(month.getFullYear(), month.getMonth(), dayNum);
          const isStart = !!from && isSameDay(day, from);
          const isEnd = !!to && isSameDay(day, to);
          const inRange = !!selectedInterval && isWithinInterval(day, selectedInterval);

          return (
            <button
              key={i}
              type="button"
              onClick={() => onPick(day)}
              className={cn(
                "h-9 text-sm font-semibold transition-colors",
                inRange ? "bg-gold-500/12 text-gold-800 dark:text-gold-200" : "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800",
                isStart && "rounded-l-full bg-gold-600 text-white hover:bg-gold-600 dark:text-white",
                isEnd && "rounded-r-full bg-gold-600 text-white hover:bg-gold-600 dark:text-white",
                isStart && isEnd && "rounded-full",
              )}
            >
              {dayNum}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Card primitives ─────────────────────────────────────────────────────────

// Entrada em CASCATA: cada card guarda seu lugar na fila no primeiro render e
// entra com um pequeno atraso — o dashboard "monta" na frente do usuário.
let cardEntrySeq = 0;

function Card({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) {
  const entryDelay = useRef((cardEntrySeq++ % 12) * 0.05).current;
  const Comp: any = onClick ? motion.button : motion.div;
  return (
    <Comp
      onClick={onClick}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: entryDelay, ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ y: -2 }}
      whileTap={onClick ? { scale: 0.985 } : undefined}
      className={cn(
        "relative overflow-hidden rounded-3xl p-5 text-left w-full",
        "bg-white/70 dark:bg-white/[0.045] backdrop-blur-sm",
        "shadow-[0_1px_2px_rgba(0,0,0,0.04)] dark:shadow-none",
        "transition-shadow hover:shadow-md hover:shadow-black/5 dark:hover:bg-white/[0.06]",
        onClick && "cursor-pointer"
      )}
    >
      <div className="relative">{children}</div>
    </Comp>
  );
}

// Número que CONTA até o valor (motion) — o "pulso de vida" dos KPIs.
function AnimatedNumber({ value, format }: { value: number; format: (n: number) => string }) {
  const [display, setDisplay] = useState(0);
  const fromRef = useRef(0);
  useEffect(() => {
    const controls = animate(fromRef.current, value, {
      duration: 0.9,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => setDisplay(v),
    });
    fromRef.current = value;
    return () => controls.stop();
  }, [value]);
  return <>{format(display)}</>;
}

function CardHeader({ icon, title, inline }: { icon: React.ReactNode; title: string; inline?: boolean }) {
  return (
    <div className={cn("flex items-center gap-2", !inline && "mb-2")}>
      <span className="w-7 h-7 rounded-lg bg-gold-500/10 dark:bg-gold-500/15 ring-1 ring-gold-500/30 flex items-center justify-center text-gold-600 dark:text-gold-400 flex-shrink-0">
        {icon}
      </span>
      <p className="text-xs font-bold text-gold-700 dark:text-gold-400 tracking-tight truncate">{title}</p>
    </div>
  );
}

function CardValue({ value, num, render }: { value?: string; num?: number; render?: (n: number) => string }) {
  return (
    <p className="text-2xl font-bold text-gray-900 dark:text-white tabular-nums tracking-tight truncate">
      {num !== undefined
        ? <AnimatedNumber value={num} format={(v) => (render ? render(v) : String(Math.round(v)))} />
        : value}
    </p>
  );
}

function CardHint({ children, tone }: { children: React.ReactNode; tone?: 'pos' | 'neg' }) {
  return (
    <p className={cn(
      "text-[11px] mt-1 truncate",
      tone === 'pos' && 'text-emerald-500 dark:text-emerald-400',
      tone === 'neg' && 'text-red-500 dark:text-red-400',
      !tone && 'text-gray-500 dark:text-gray-400',
    )}>
      {children}
    </p>
  );
}

// ─── Section wrapper ─────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-xs font-bold uppercase tracking-wider text-gold-600 dark:text-gold-400 mb-3 ml-1">
        {title}
      </h2>
      {children}
    </section>
  );
}

// ─── Pending card ────────────────────────────────────────────────────────────

function PendingCard({
  tone, title, count, list, onOpen,
}: {
  tone: 'red' | 'amber' | 'blue';
  title: string;
  count: number;
  list: JobLite[];
  onOpen: () => void;
}) {
  const dotCls = {
    red: 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]',
    amber: 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.6)]',
    blue: 'bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.6)]',
  }[tone];

  return (
    <button
      onClick={onOpen}
      className="relative overflow-hidden bg-white dark:bg-[#161616] border border-black/5 dark:border-white/5 rounded-2xl p-4 text-left transition-all hover:border-gold-300 dark:hover:border-gold-500/50 group w-full"
    >
      <span className="absolute top-0 left-0 h-px w-16 bg-gradient-to-r from-gold-500 to-transparent" aria-hidden />
      <span className="absolute top-0 left-0 w-px h-16 bg-gradient-to-b from-gold-500 to-transparent" aria-hidden />
      <div className="relative">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-gray-600 dark:text-gray-300 flex items-center gap-2">
            <span className={cn("w-1.5 h-1.5 rounded-full", dotCls)} />
            {title}
          </span>
          <ArrowRight size={12} className="text-gray-300 dark:text-gray-700 group-hover:text-gold-500 transition-colors" />
        </div>
        <div className="flex items-baseline gap-3">
          <p className="text-2xl font-bold text-gray-900 dark:text-white tabular-nums">{count}</p>
          {list.length > 0 && (
            <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate min-w-0">
              {list[0].client_name || 'Sem cliente'}{count > 1 && ` · +${count - 1}`}
            </p>
          )}
        </div>
      </div>
    </button>
  );
}

// ─── Sales funnel ────────────────────────────────────────────────────────────

// ─── Visão de diretoria: componentes ─────────────────────────────────────────

// Card herói: número grande + variação % + mini-gráfico. O "10 segundos" do dono.
function HeroCard({ icon, title, num, render, deltaPct, hint, spark, negative }: {
  icon: React.ReactNode;
  title: string;
  num: number;
  render: (n: number) => string;
  deltaPct?: number | null;
  hint?: string;
  spark?: Array<{ date: string; total: number }>;
  negative?: boolean;
}) {
  const sparkId = `spk-${title.replace(/\W/g, '')}`;
  return (
    <Card>
      <CardHeader icon={icon} title={title} />
      <p className={cn(
        "text-[25px] leading-8 font-bold tabular-nums tracking-tight truncate",
        negative ? "text-red-500" : "text-gray-900 dark:text-white"
      )}>
        <AnimatedNumber value={num} format={render} />
      </p>
      {deltaPct !== null && deltaPct !== undefined ? (
        <span className={cn(
          "inline-flex items-center gap-1 mt-1 px-1.5 py-0.5 rounded-md text-[11px] font-bold tabular-nums",
          deltaPct >= 0
            ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
            : "bg-red-500/10 text-red-500"
        )}>
          {deltaPct >= 0 ? '↑' : '↓'} {Math.abs(deltaPct)}% <span className="font-medium opacity-70">vs anterior</span>
        </span>
      ) : hint ? (
        <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400 truncate">{hint}</p>
      ) : null}
      {spark && spark.length > 1 && (
        <div className="mt-2 -mx-2 -mb-1 h-10 pointer-events-none">
          <ResponsiveContainer width="100%" height={40}>
            <AreaChart data={spark}>
              <defs>
                <linearGradient id={sparkId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#F1C665" stopOpacity={0.45} />
                  <stop offset="100%" stopColor="#F1C665" stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area type="monotone" dataKey="total" stroke="#F1C665" strokeWidth={1.5} fill={`url(#${sparkId})`} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}

const TYPE_COLORS = ['#D4A94A', '#8A6620', '#4B3F72', '#1B6B4A', '#7A3045', '#2C5364', '#F1C665'];

// Donut de faturamento por tipo de ensaio (período) com total no centro.
function TypeDonut({ byType, hideValues }: { byType: Array<{ type: string; count: number; total: number }>; hideValues: boolean }) {
  const top = byType.slice(0, 6);
  const restTotal = byType.slice(6).reduce((x, t) => x + t.total, 0);
  const data = restTotal > 0 ? [...top, { type: 'Outros', count: 0, total: restTotal }] : top;
  const total = data.reduce((x, t) => x + t.total, 0);

  if (data.length === 0 || total <= 0) {
    return <p className="text-sm text-gray-500 dark:text-gray-400 italic py-10 text-center">Sem ensaios com valor no período.</p>;
  }

  return (
    <div className="mt-2">
      <div className="relative h-[170px]">
        <ResponsiveContainer width="100%" height={170}>
          <PieChart>
            <Pie
              data={data}
              dataKey="total"
              nameKey="type"
              innerRadius={55}
              outerRadius={80}
              paddingAngle={2}
              stroke="none"
              animationDuration={900}
            >
              {data.map((_, i) => <Cell key={i} fill={TYPE_COLORS[i % TYPE_COLORS.length]} />)}
            </Pie>
            <Tooltip
              contentStyle={{ background: 'rgba(20,20,20,0.95)', border: '1px solid rgba(241,198,101,0.3)', borderRadius: 12, color: '#fff', fontSize: 12 }}
              formatter={(v: any, name: any) => [hideValues ? '•••' : `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, name]}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500">Total</span>
          <span className="text-sm font-bold text-gray-900 dark:text-white tabular-nums">{formatBRLShort(total, hideValues)}</span>
        </div>
      </div>
      <ul className="mt-2 space-y-1">
        {data.map((t, i) => (
          <li key={t.type} className="flex items-center gap-2 text-[12px]">
            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: TYPE_COLORS[i % TYPE_COLORS.length] }} />
            <span className="flex-1 truncate text-gray-600 dark:text-gray-300">{t.type}</span>
            <span className="tabular-nums font-semibold text-gray-900 dark:text-white">{Math.round((t.total / total) * 100)}%</span>
            <span className="tabular-nums text-gray-500 dark:text-gray-400 w-16 text-right">{formatBRLShort(t.total, hideValues)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Tabela de desempenho por tipo: receita, volume e ticket médio.
function TypeTable({ byType, hideValues }: { byType: Array<{ type: string; count: number; total: number }>; hideValues: boolean }) {
  const rows = byType.slice(0, 6);
  if (rows.length === 0) {
    return <p className="text-sm text-gray-500 dark:text-gray-400 italic py-8 text-center">Sem ensaios no período.</p>;
  }
  const max = Math.max(1, ...rows.map(r => r.total));
  return (
    <div className="mt-2 space-y-0.5">
      <div className="grid grid-cols-[1fr_52px_84px_84px] gap-2 px-2 pb-1 text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500">
        <span>Tipo</span><span className="text-right">Qtd</span><span className="text-right">Receita</span><span className="text-right">Ticket médio</span>
      </div>
      {rows.map((r, i) => (
        <motion.div
          key={r.type}
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.4, delay: 0.1 + i * 0.06 }}
          className="relative grid grid-cols-[1fr_52px_84px_84px] gap-2 items-center px-2 py-2 rounded-lg overflow-hidden"
        >
          <span
            className="absolute inset-y-0 left-0 bg-gold-500/[0.07] dark:bg-gold-500/10 rounded-lg"
            style={{ width: `${(r.total / max) * 100}%` }}
            aria-hidden
          />
          <span className="relative text-[13px] font-medium text-gray-900 dark:text-white truncate">{r.type}</span>
          <span className="relative text-[12px] tabular-nums text-right text-gray-600 dark:text-gray-300">{r.count}</span>
          <span className="relative text-[12px] tabular-nums text-right font-semibold text-gray-900 dark:text-white">{formatBRLShort(r.total, hideValues)}</span>
          <span className="relative text-[12px] tabular-nums text-right text-gray-500 dark:text-gray-400">{formatBRLShort(r.count > 0 ? r.total / r.count : 0, hideValues)}</span>
        </motion.div>
      ))}
    </div>
  );
}

// Insights de AÇÃO gerados dos próprios dados — o que fazer agora.
type Insight = { tone: 'pos' | 'warn' | 'info'; title: string; sub: string };

function computeInsights(a: Analytics, periodDelta: number | null, canSeeFinance: boolean, hideValues: boolean): Insight[] {
  const out: Insight[] = [];
  if (canSeeFinance && periodDelta !== null) {
    out.push(periodDelta >= 0
      ? { tone: 'pos', title: `Faturamento ${periodDelta}% acima do período anterior`, sub: 'Mantenha o que está funcionando — campanhas e follow-ups em dia.' }
      : { tone: 'warn', title: `Faturamento ${Math.abs(periodDelta)}% abaixo do período anterior`, sub: 'Reforce os follow-ups do funil e reative oportunidades internas.' });
  }
  const gargalo = a.sales.conversion
    .filter(c => c.entered >= 3 && c.conversion_rate !== null)
    .sort((x, y) => (x.conversion_rate! - y.conversion_rate!))[0];
  if (gargalo && gargalo.conversion_rate! < 60) {
    out.push({ tone: 'warn', title: `Gargalo em "${gargalo.stage_name}": só ${gargalo.conversion_rate}% avançam`, sub: 'É onde os leads mais param — priorize os follow-ups dessa etapa.' });
  }
  if (a.jobs.late.count > 0) {
    out.push({ tone: 'warn', title: `${a.jobs.late.count} ensaio${a.jobs.late.count === 1 ? '' : 's'} atrasado${a.jobs.late.count === 1 ? '' : 's'} na produção`, sub: 'Passaram do prazo da etapa — destrave hoje.' });
  }
  if (canSeeFinance && a.finance.toReceiveOpen > 0) {
    out.push({ tone: 'info', title: `${formatBRLShort(a.finance.toReceiveOpen, hideValues)} a receber em ${a.finance.openJobsCount} ensaio${a.finance.openJobsCount === 1 ? '' : 's'}`, sub: 'Combine os saldos antes das entregas.' });
  }
  if (a.opportunities.urgent > 0) {
    out.push({ tone: 'pos', title: `${a.opportunities.urgent} cliente${a.opportunities.urgent === 1 ? '' : 's'} no momento de recomprar`, sub: 'Oportunidades internas urgentes — um oi hoje vira venda.' });
  }
  if (out.length === 0) {
    out.push({ tone: 'pos', title: 'Tudo em dia por aqui', sub: 'Sem pendências críticas — bom momento pra prospectar novos leads.' });
  }
  return out.slice(0, 3);
}

function ActionInsights({ items }: { items: Insight[] }) {
  const toneStyles: Record<Insight['tone'], { bg: string; icon: React.ReactNode }> = {
    pos: { bg: 'bg-emerald-500/12 text-emerald-500', icon: <TrendingUp size={14} /> },
    warn: { bg: 'bg-amber-500/12 text-amber-500', icon: <AlertTriangle size={14} /> },
    info: { bg: 'bg-gold-500/15 text-gold-600 dark:text-gold-400', icon: <Wallet size={14} /> },
  };
  return (
    <ul className="mt-2 space-y-2.5">
      {items.map((it, i) => (
        <motion.li
          key={it.title}
          initial={{ opacity: 0, x: 10 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.4, delay: 0.15 + i * 0.1 }}
          className="flex items-start gap-3"
        >
          <span className={cn("w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0", toneStyles[it.tone].bg)}>
            {toneStyles[it.tone].icon}
          </span>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-gray-900 dark:text-white leading-snug">{it.title}</p>
            <p className="text-[11.5px] text-gray-500 dark:text-gray-400 leading-snug mt-0.5">{it.sub}</p>
          </div>
        </motion.li>
      ))}
    </ul>
  );
}

// Pílula de contexto — informação sem virar mais um quadrado na tela.
function MiniStat({ label, value, tone, onClick }: { label: string; value: string; tone?: 'warn' | 'ok'; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[12px] transition-colors",
        tone === 'warn'
          ? "border-amber-400/40 bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20"
          : "border-black/10 dark:border-white/10 bg-white dark:bg-[#161616] text-gray-600 dark:text-gray-300 hover:border-gold-400/60"
      )}
    >
      <span className="text-gray-400 dark:text-gray-500">{label}</span>
      <span className="font-bold text-gray-900 dark:text-white tabular-nums">{value}</span>
    </button>
  );
}

// "Precisa de você": UMA lista com tudo que pede ação do dono, cada linha
// clicável levando pro lugar certo. Substitui os cards espalhados de pendência.
function AttentionList({ a, canSeeFinance, hideValues, onNavigate }: {
  a: Analytics; canSeeFinance: boolean; hideValues: boolean; onNavigate: (to: string) => void;
}) {
  type Item = { tone: 'red' | 'amber' | 'blue' | 'gold' | 'green'; title: string; sub: string; to: string };
  const items: Item[] = [];
  if (a.jobs.late.count > 0) items.push({ tone: 'red', title: `${a.jobs.late.count} ensaio${a.jobs.late.count === 1 ? '' : 's'} atrasado${a.jobs.late.count === 1 ? '' : 's'} na produção`, sub: 'Passaram do prazo da etapa — destrave primeiro.', to: '/jobs' });
  if (a.jobs.awaitingContract.count > 0) items.push({ tone: 'amber', title: `${a.jobs.awaitingContract.count} venda${a.jobs.awaitingContract.count === 1 ? '' : 's'} sem contrato assinado`, sub: 'Garanta a assinatura antes do ensaio.', to: '/contratos' });
  if (a.jobs.awaitingSelection.count > 0) items.push({ tone: 'blue', title: `${a.jobs.awaitingSelection.count} cliente${a.jobs.awaitingSelection.count === 1 ? '' : 's'} com seleção de fotos parada`, sub: 'Um lembrete gentil acelera a entrega.', to: '/jobs' });
  if (canSeeFinance && a.finance.toReceiveOpen > 0) items.push({ tone: 'gold', title: `${formatBRLShort(a.finance.toReceiveOpen, hideValues)} a receber em ${a.finance.openJobsCount} ensaio${a.finance.openJobsCount === 1 ? '' : 's'}`, sub: 'Combine os saldos antes das entregas.', to: '/finance' });
  if (a.opportunities.urgent > 0) items.push({ tone: 'green', title: `${a.opportunities.urgent} cliente${a.opportunities.urgent === 1 ? '' : 's'} no momento de recomprar`, sub: 'Um oi hoje vira venda — veja a lista abaixo.', to: '/oportunidades' });

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 gap-2 text-center">
        <span className="w-11 h-11 rounded-full bg-emerald-500/12 text-emerald-500 flex items-center justify-center"><Check size={20} /></span>
        <p className="text-sm font-semibold text-gray-900 dark:text-white">Tudo em dia</p>
        <p className="text-[12px] text-gray-500 dark:text-gray-400">Nenhuma pendência crítica — bom momento pra vender.</p>
      </div>
    );
  }

  const toneDot: Record<Item['tone'], string> = {
    red: 'bg-red-500', amber: 'bg-amber-500', blue: 'bg-sky-500', gold: 'bg-gold-500', green: 'bg-emerald-500',
  };
  return (
    <ul className="space-y-1">
      {items.slice(0, 5).map((it, i) => (
        <motion.li key={it.title} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.35, delay: 0.1 + i * 0.07 }}>
          <button
            onClick={() => onNavigate(it.to)}
            className="w-full flex items-center gap-3 px-2.5 py-2.5 rounded-xl text-left hover:bg-gold-500/5 dark:hover:bg-gold-500/10 transition-colors group"
          >
            <span className={cn("w-2 h-2 rounded-full flex-shrink-0", toneDot[it.tone])} />
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-semibold text-gray-900 dark:text-white leading-snug">{it.title}</span>
              <span className="block text-[11.5px] text-gray-500 dark:text-gray-400 leading-snug">{it.sub}</span>
            </span>
            <ChevronRight size={14} className="text-gray-300 dark:text-gray-600 group-hover:text-gold-500 flex-shrink-0" />
          </button>
        </motion.li>
      ))}
    </ul>
  );
}

// Barras horizontais de receita por tipo de ensaio — direto, sem donut confuso.
function TypeBars({ byType, hideValues }: { byType: Array<{ type: string; count: number; total: number }>; hideValues: boolean }) {
  const rows = byType.slice(0, 5);
  if (rows.length === 0) {
    return <p className="text-sm text-gray-500 dark:text-gray-400 italic py-8 text-center">Sem ensaios com valor no período.</p>;
  }
  const max = Math.max(1, ...rows.map(r => r.total));
  return (
    <div className="mt-3 space-y-3">
      {rows.map((r, i) => (
        <div key={r.type}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[12px] font-medium text-gray-700 dark:text-gray-300 truncate">{r.type}</span>
            <span className="text-[12px] tabular-nums flex-shrink-0">
              <b className="text-gray-900 dark:text-white">{formatBRLShort(r.total, hideValues)}</b>
              <span className="text-gray-400 dark:text-gray-500"> · {r.count}x</span>
            </span>
          </div>
          <div className="h-2 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${(r.total / max) * 100}%` }}
              transition={{ duration: 0.7, delay: 0.15 + i * 0.08, ease: [0.22, 1, 0.36, 1] }}
              className="h-full rounded-full bg-gradient-to-r from-gold-400 to-gold-500"
            />
          </div>
        </div>
      ))}
    </div>
  );
}

// Agenda enxuta: hoje (ou os próximos), nome + tipo + hora + valor.
function AgendaList({ a, hideValues }: { a: Analytics; hideValues: boolean }) {
  const list = (a.jobs.today.count > 0 ? a.jobs.today.list : a.jobs.next7Days.list).slice(0, 5);
  if (list.length === 0) {
    return <p className="text-sm text-gray-500 dark:text-gray-400 italic py-8 text-center">Nada agendado pros próximos dias.</p>;
  }
  return (
    <div className="space-y-1">
      {list.map((j, i) => (
        <motion.div
          key={j.id}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.1 + i * 0.06 }}
          className="flex items-center justify-between gap-3 px-2 py-2 rounded-xl hover:bg-gold-500/5 dark:hover:bg-gold-500/10 transition-colors"
        >
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold text-gray-900 dark:text-white truncate">{j.client_name || 'Sem cliente'}</p>
            <p className="text-[11.5px] text-gray-500 dark:text-gray-400 truncate">
              {a.jobs.today.count === 0 && j.job_date ? `${format(parseISO(j.job_date), 'dd/MM')} · ` : ''}{j.job_type}{j.job_time ? ` · ${j.job_time}` : ''}
            </p>
          </div>
          <span className="text-[12px] font-bold text-gold-500 tabular-nums flex-shrink-0">{formatBRLShort(j.amount, hideValues)}</span>
        </motion.div>
      ))}
    </div>
  );
}

// Célula da faixa de KPIs — número + variação + mini-gráfico, SEM caixa própria.
function KpiCell({ label, num, render, deltaPct, hint, spark, sparkKey = 'total', negative }: {
  label: string;
  num: number;
  render: (n: number) => string;
  deltaPct?: number | null;
  hint?: string;
  spark?: Array<Record<string, any>>;
  sparkKey?: string;
  negative?: boolean;
}) {
  const gid = `kpi-${label.replace(/\W/g, '')}`;
  return (
    <div className="px-5 py-4 min-w-0">
      <p className="text-[11px] uppercase tracking-widest text-gray-400 dark:text-gray-500 font-semibold truncate">{label}</p>
      <p className={cn("mt-1.5 text-[25px] leading-8 font-bold tabular-nums tracking-tight truncate", negative ? "text-red-500" : "text-gray-900 dark:text-white")}>
        <AnimatedNumber value={num} format={render} />
      </p>
      {deltaPct !== null && deltaPct !== undefined ? (
        <p className={cn("mt-0.5 text-[11px] font-bold tabular-nums", deltaPct >= 0 ? "text-emerald-500" : "text-red-400")}>
          {deltaPct >= 0 ? '↑' : '↓'} {Math.abs(deltaPct)}% <span className="font-medium text-gray-400 dark:text-gray-500">vs período anterior</span>
        </p>
      ) : hint ? (
        <p className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400 truncate">{hint}</p>
      ) : null}
      {spark && spark.length > 1 && (
        <div className="mt-2 h-9 -mb-1 pointer-events-none">
          <ResponsiveContainer width="100%" height={36}>
            <AreaChart data={spark} margin={{ top: 2, bottom: 0, left: 0, right: 0 }}>
              <defs>
                <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#F1C665" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="#F1C665" stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area type="monotone" dataKey={sparkKey} stroke="#F1C665" strokeWidth={1.5} fill={`url(#${gid})`} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

// Meta vs Realizado (6 meses): meta em cinza, realizado verde quando bate,
// âmbar quando não; dourado quando a conta ainda não tem meta configurada.
function MonthlyBars({ mensal, hideValues }: { mensal: Array<{ month: string; meta: number; realizado: number }>; hideValues: boolean }) {
  const hasMeta = mensal.some(m => Number(m.meta) > 0);
  const data = mensal.map(m => ({ ...m, label: format(parseISO(`${m.month}-01`), 'MMM', { locale: ptBR }) }));
  return (
    <ResponsiveContainer width="100%" height={190}>
      <BarChart data={data} barGap={3}>
        <CartesianGrid vertical={false} stroke="currentColor" strokeOpacity={0.07} />
        <XAxis dataKey="label" tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} width={44} tickFormatter={(v) => hideValues ? '•••' : `${Number(v) >= 1000 ? `${(Number(v) / 1000).toFixed(0)}k` : v}`} />
        <Tooltip
          cursor={{ fill: 'rgba(212,169,74,0.06)' }}
          contentStyle={{ background: 'rgba(20,20,20,0.95)', border: '1px solid rgba(241,198,101,0.3)', borderRadius: 12, color: '#fff', fontSize: 12 }}
          formatter={(v: any, name: any) => [hideValues ? '•••' : `R$ ${Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`, name === 'meta' ? 'Meta' : 'Realizado']}
        />
        {hasMeta && <Bar dataKey="meta" fill="rgba(148,163,184,0.28)" radius={[4, 4, 0, 0]} />}
        <Bar dataKey="realizado" radius={[4, 4, 0, 0]} animationDuration={900}>
          {data.map((m, i) => (
            <Cell key={i} fill={hasMeta ? (m.realizado >= m.meta ? '#10b981' : '#f59e0b') : '#D4A94A'} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// Ticket médio ao longo do tempo, com etiqueta no último ponto (ref. visual).
function TicketLine({ mensal, hideValues }: { mensal: Array<{ month: string; ticket: number }>; hideValues: boolean }) {
  const data = mensal.map(m => ({ label: format(parseISO(`${m.month}-01`), 'MMM', { locale: ptBR }), ticket: Math.round(Number(m.ticket) || 0) }));
  const last = data[data.length - 1];
  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={190}>
        <LineChart data={data} margin={{ top: 14, right: 14, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="currentColor" strokeOpacity={0.07} />
          <XAxis dataKey="label" tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} width={44} tickFormatter={(v) => hideValues ? '•••' : `R$ ${Number(v) >= 1000 ? `${(Number(v) / 1000).toFixed(1)}k` : v}`} />
          <Tooltip
            contentStyle={{ background: 'rgba(20,20,20,0.95)', border: '1px solid rgba(16,185,129,0.35)', borderRadius: 12, color: '#fff', fontSize: 12 }}
            formatter={(v: any) => [hideValues ? '•••' : `R$ ${Number(v).toLocaleString('pt-BR')}`, 'Ticket médio']}
          />
          <Line type="monotone" dataKey="ticket" stroke="#10b981" strokeWidth={2.5} dot={{ r: 3, fill: '#10b981', strokeWidth: 0 }} activeDot={{ r: 5 }} animationDuration={900} />
        </LineChart>
      </ResponsiveContainer>
      {last && last.ticket > 0 && !hideValues && (
        <span className="absolute top-0 right-2 px-2 py-0.5 rounded-md bg-emerald-500 text-white text-[11px] font-bold tabular-nums shadow-md">
          R$ {last.ticket.toLocaleString('pt-BR')}
        </span>
      )}
    </div>
  );
}

// Funil de vendas HONESTO e vivo:
// - Etapas abertas = foto de AGORA (quantos leads estão em cada uma), com a
//   forma afunilada de verdade (barras centralizadas) e animação de entrada.
// - Ganhos/perdidos = fechados NO PERÍODO selecionado, rotulados como tal.
// - Conversão geral do período embaixo — o número que o dono quer ver.
function SalesFunnel({
  byStage, conversion, hideValues,
}: {
  byStage: Analytics['sales']['byStage'];
  conversion: Analytics['sales']['conversion'];
  hideValues: boolean;
}) {
  const stages = byStage.filter(s => !s.is_final).sort((a, b) => a.position - b.position);
  const wonStages = byStage.filter(s => s.is_won);
  const lostStages = byStage.filter(s => s.is_final && !s.is_won);
  const wonCount = wonStages.reduce((acc, s) => acc + s.count, 0);
  const wonValue = wonStages.reduce((acc, s) => acc + s.total_value, 0);
  const lostCount = lostStages.reduce((acc, s) => acc + s.count, 0);
  const activeCount = stages.reduce((acc, s) => acc + s.count, 0);
  const activeValue = stages.reduce((acc, s) => acc + s.total_value, 0);
  const closed = wonCount + lostCount;
  const convGeral = closed > 0 ? Math.round((wonCount / closed) * 100) : null;

  if (stages.length === 0) {
    return (
      <p className="text-sm text-gray-500 dark:text-gray-400 italic py-8 text-center">
        Sem etapas configuradas no funil.
      </p>
    );
  }

  const max = Math.max(1, ...stages.map(s => s.count));

  return (
    <div className="space-y-2">
      {/* Cabeçalho honesto: o que está em jogo AGORA */}
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500">No funil agora</span>
        <span className="text-[11px] font-semibold text-gray-600 dark:text-gray-300 tabular-nums">
          {activeCount} lead{activeCount === 1 ? '' : 's'}{hideValues ? '' : ` · ${formatBRLShort(activeValue, hideValues)}`}
        </span>
      </div>

      {/* Barras centralizadas = silhueta de funil de verdade */}
      <div className="space-y-1.5">
        {stages.map((s, i) => {
          const conv = conversion.find(c => c.stage_id === s.id);
          const widthPct = s.count > 0 ? Math.max((s.count / max) * 100, 14) : 6;
          return (
            <div key={s.id}>
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-[11px] font-medium text-gray-600 dark:text-gray-300 truncate">{s.name}</span>
                <div className="flex items-center gap-2 flex-shrink-0 tabular-nums">
                  <span className="text-xs font-bold text-gray-900 dark:text-white">{s.count}</span>
                  <span className="text-[10px] text-gray-500 dark:text-gray-400 w-14 text-right">{formatBRLShort(s.total_value, hideValues)}</span>
                </div>
              </div>
              <div className="flex justify-center">
                <motion.div
                  initial={{ width: 0, opacity: 0 }}
                  animate={{ width: `${widthPct}%`, opacity: 1 }}
                  transition={{ duration: 0.7, delay: 0.15 + i * 0.08, ease: [0.22, 1, 0.36, 1] }}
                  className={cn(
                    "h-5 rounded-md flex items-center justify-center",
                    s.count > 0
                      ? "bg-gradient-to-r from-gold-400/80 via-gold-500 to-gold-400/80 shadow-[0_2px_8px_-2px_rgba(212,169,74,0.5)]"
                      : "bg-gray-100 dark:bg-gray-800"
                  )}
                >
                  {s.count > 0 && (
                    <span className="text-[10px] font-bold text-white drop-shadow-sm">{s.count}</span>
                  )}
                </motion.div>
              </div>
              {conv && conv.conversion_rate !== null && conv.entered > 0 && (
                <div className="flex justify-center mt-0.5">
                  <span className={cn(
                    "text-[9px] font-semibold tabular-nums",
                    conv.conversion_rate < 40 ? "text-red-400" :
                    conv.conversion_rate < 70 ? "text-amber-500" : "text-emerald-500"
                  )}>
                    ↓ {conv.conversion_rate}% avançam
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Fechados NO PERÍODO — rotulado, sem misturar com a foto de agora */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.15 + stages.length * 0.08 }}
        className="pt-2 mt-1 border-t border-gray-200 dark:border-gray-800 space-y-1.5"
      >
        <span className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500">Fechados no período</span>
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">🏆 Ganhos</span>
          <div className="flex items-center gap-2 tabular-nums">
            <span className="text-xs font-bold text-emerald-700 dark:text-emerald-400">{wonCount}</span>
            <span className="text-[10px] text-emerald-600 dark:text-emerald-500 w-14 text-right">{formatBRLShort(wonValue, hideValues)}</span>
          </div>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium text-gray-500 dark:text-gray-400">Perdidos</span>
          <span className="text-xs font-bold text-gray-500 dark:text-gray-400 tabular-nums">{lostCount}</span>
        </div>
        {convGeral !== null && (
          <div className="flex items-center justify-between pt-1">
            <span className="text-[11px] font-semibold text-gray-600 dark:text-gray-300">Conversão do período</span>
            <span className={cn(
              "text-sm font-bold tabular-nums",
              convGeral >= 50 ? "text-emerald-500" : convGeral >= 25 ? "text-amber-500" : "text-red-400"
            )}>
              {convGeral}%
            </span>
          </div>
        )}
      </motion.div>
    </div>
  );
}

// ─── Internal opportunities (with scroll) ────────────────────────────────────

function InternalOpportunities({
  opportunities, summary, onContact, onDismiss,
}: {
  opportunities: Opportunity[];
  summary: Analytics['opportunities'];
  onContact: (o: Opportunity) => void;
  onDismiss: (id: number) => void;
}) {
  return (
    <div className="flex flex-col" style={{ maxHeight: 280 }}>
      {summary.total > 0 && (
        <div className="grid grid-cols-3 gap-2 mb-2 flex-shrink-0">
          <Stat label="Urgentes" value={summary.urgent} tone="red" />
          <Stat label="Em breve" value={summary.active} tone="amber" />
          <Stat label="Futuras" value={summary.future} tone="gray" />
        </div>
      )}
      <div className="flex-1 overflow-y-auto -mx-1 px-1">
        {opportunities.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-sm text-gray-500 dark:text-gray-400">Nenhuma oportunidade ativa.</p>
          </div>
        ) : (
          <ul className="space-y-1">
            {opportunities.map(opp => {
              const date = opp.suggested_date ? parseISO(opp.suggested_date) : null;
              const dotColor =
                opp.priority === 'urgent' ? 'bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.5)]' :
                opp.priority === 'active' ? 'bg-amber-500 shadow-[0_0_6px_rgba(245,158,11,0.5)]' :
                'bg-gray-400 dark:bg-gray-600';
              return (
                <li
                  key={opp.id}
                  className="group flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-gold-500/5 dark:hover:bg-gold-500/10 transition-colors"
                >
                  <span className={cn("w-1.5 h-1.5 rounded-full flex-shrink-0", dotColor)} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                      {opp.client_name || 'Cliente'}
                    </p>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
                      {opp.type}{date && ` · ${format(date, 'dd/MM', { locale: ptBR })}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                    <button
                      onClick={() => onContact(opp)}
                      className="px-2.5 py-1 text-[11px] font-medium text-gold-700 dark:text-gold-300 bg-gold-500/15 hover:bg-gold-500/25 rounded-full transition-colors"
                    >
                      Contatar
                    </button>
                    <button
                      onClick={() => onDismiss(opp.id)}
                      className="p-1 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 rounded-full transition-colors"
                      title="Descartar"
                    >
                      <X size={13} />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: 'red' | 'amber' | 'gray' }) {
  const valueCls = {
    red: 'text-red-500',
    amber: 'text-amber-500',
    gray: 'text-gray-700 dark:text-gray-300',
  }[tone];
  return (
    <div className="bg-black/[0.025] dark:bg-white/[0.04] border border-black/5 dark:border-white/5 rounded-xl px-3 py-2 text-center">
      <p className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-400">{label}</p>
      <p className={cn("text-lg font-bold tabular-nums", valueCls)}>{value}</p>
    </div>
  );
}

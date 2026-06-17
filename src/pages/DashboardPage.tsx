import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import {
  addDays, addMonths, endOfMonth, format, getDay, getDaysInMonth,
  isSameDay, isWithinInterval, parseISO, startOfMonth, subDays,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  ArrowRight, Calendar as CalendarIcon, Camera, Check, ChevronLeft, ChevronRight,
  DollarSign, Eye, EyeOff, FileClock, FileText, Sparkles, Target, TrendingDown, TrendingUp, X,
} from "lucide-react";

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
  const { isMember } = useAuth(); // funcionário não vê valores em dinheiro
  const { openContactModal } = useOutletContext<LayoutOutletContext>();
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [hideValuesPref, setHideValues] = useState(() => localStorage.getItem("dashboard_hide_values") === "true");
  // Funcionário SEMPRE com valores mascarados (pega o que sobrou: funil, hot deals).
  const hideValues = isMember || hideValuesPref;
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
      if (aRes.ok) setAnalytics(await aRes.json());
      if (oRes.ok) setOpportunities(await oRes.json());
      if (cRes.ok) setClients(await cRes.json());
    } catch (err) {
      console.error(err);
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
          {!isMember && (
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

      {/* Top: 4 KPIs + Funnel side-by-side */}
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-3">
        {/* Left column: KPIs grid + Linha do tempo */}
        <div className="space-y-3">
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            {!isMember && (<>
            <Card>
              <CardHeader icon={<DollarSign size={16} />} title="Entrada" />
              <CardValue value={formatBRL(a.finance.revenueThisMonth, hideValues)} />
              {periodDelta !== null ? (
                <CardHint tone={periodDelta >= 0 ? 'pos' : 'neg'}>
                  {periodDelta >= 0 ? '↑' : '↓'} {Math.abs(periodDelta)}% vs período anterior
                </CardHint>
              ) : (
                <CardHint>Recebido no período</CardHint>
              )}
            </Card>

            <Card>
              <CardHeader icon={<TrendingDown size={16} />} title="Saída" />
              <CardValue value={formatBRL(a.finance.expensesThisMonth, hideValues)} />
              <CardHint>Despesas pagas no período</CardHint>
            </Card>
            </>)}

            <Card>
              <CardHeader icon={<Camera size={16} />} title="Ensaios no período" />
              <CardValue value={String(a.jobs.thisMonth.total)} />
              <CardHint>{a.jobs.thisMonth.completed} feitos · {a.jobs.thisMonth.scheduled} agendados</CardHint>
            </Card>

            <Card onClick={() => navigate("/vendas")}>
              <CardHeader icon={<Target size={16} />} title="Funil ativo" />
              <CardValue value={String(a.sales.activeCount)} />
              <CardHint>{isMember ? 'leads ativos' : `${formatBRLShort(a.sales.activeValue, hideValues)} em pipeline`}</CardHint>
            </Card>

            {!isMember && (<>
            <Card>
              <CardHeader icon={<Check size={16} />} title="Sinal recebido" />
              <CardValue value={formatBRL(a.finance.sinalRecebidoOpen, hideValues)} />
              <CardHint>Já pago em ensaios em produção</CardHint>
            </Card>

            <Card>
              <CardHeader icon={<TrendingUp size={16} />} title="A receber" />
              <CardValue value={formatBRL(a.finance.toReceiveOpen, hideValues)} />
              <CardHint>
                Saldo de {a.finance.openJobsCount} ensaio{a.finance.openJobsCount === 1 ? '' : 's'} em produção
              </CardHint>
            </Card>
            </>)}

            <Card>
              <CardHeader icon={<FileClock size={16} />} title="Pendências" />
              <CardValue value={String(a.attention)} />
              <CardHint>Atrasados + contratos + seleção</CardHint>
            </Card>

            <Card onClick={() => navigate("/calendar")}>
              <CardHeader icon={<CalendarIcon size={16} />} title="Hoje" />
              <CardValue value={String(a.jobs.today.count)} />
              <CardHint>{a.jobs.today.count === 0 ? 'Sem ensaios hoje' : a.jobs.today.count === 1 ? 'ensaio agendado' : 'ensaios agendados'}</CardHint>
            </Card>
          </div>

          {/* Linha do tempo (receita ao longo do tempo) — só o dono vê valores */}
          {!isMember && (
          <Card>
            <div className="flex items-center justify-between mb-3">
              <CardHeader icon={<TrendingUp size={16} />} title="Linha do tempo" inline />
              <span className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500">{formatRangeShort(dateRange)}</span>
            </div>
            <div className="-mx-2">
              <ResponsiveContainer width="100%" height={140} minWidth={0}>
                <AreaChart data={a.finance.dailyRevenue}>
                  <defs>
                    <linearGradient id="revGold" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#F1C665" stopOpacity={0.5} />
                      <stop offset="100%" stopColor="#F1C665" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="date"
                    tick={{ fill: '#6b7280', fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(d) => format(parseISO(String(d)), 'dd/MM')}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tick={{ fill: '#6b7280', fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) => hideValues ? '•••' : `R$ ${Number(v) >= 1000 ? `${(Number(v) / 1000).toFixed(0)}k` : Number(v).toFixed(0)}`}
                    width={50}
                  />
                  <Tooltip
                    contentStyle={{
                      background: 'rgba(20, 20, 20, 0.95)',
                      border: '1px solid rgba(241, 198, 101, 0.3)',
                      borderRadius: 12,
                      color: '#fff',
                      fontSize: 12,
                    }}
                    formatter={(v: any) => hideValues ? ['•••', 'Receita'] : [`R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, 'Receita']}
                    labelFormatter={(d) => format(parseISO(String(d)), "dd 'de' MMMM", { locale: ptBR })}
                  />
                  <Area
                    type="monotone"
                    dataKey="total"
                    stroke="#F1C665"
                    strokeWidth={2}
                    fill="url(#revGold)"
                    activeDot={{ r: 4, fill: '#F1C665', stroke: '#fff', strokeWidth: 2 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>
          )}
        </div>

        {/* Right column: Funnel */}
        <Card>
          <div className="flex items-center justify-between mb-4">
            <CardHeader icon={<Target size={16} />} title="Funil de vendas" inline />
            <button
              onClick={() => navigate("/vendas")}
              className="text-[10px] uppercase tracking-wider text-gold-500 hover:text-gold-400 inline-flex items-center gap-1"
            >
              Detalhes <ArrowRight size={10} />
            </button>
          </div>
          <SalesFunnel
            byStage={a.sales.byStage}
            conversion={a.sales.conversion}
            hideValues={hideValues}
          />
        </Card>
      </div>

      {/* Pendências (3 cards minimalistas) */}
      {(a.jobs.late.count > 0 || a.jobs.awaitingContract.count > 0 || a.jobs.awaitingSelection.count > 0) && (
        <Section title="Pendências">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <PendingCard
              tone="red"
              title="Atrasados"
              count={a.jobs.late.count}
              list={a.jobs.late.list}
              onOpen={() => navigate("/jobs")}
            />
            <PendingCard
              tone="amber"
              title="Aguardando contrato"
              count={a.jobs.awaitingContract.count}
              list={a.jobs.awaitingContract.list}
              onOpen={() => navigate("/contratos")}
            />
            <PendingCard
              tone="blue"
              title="Aguardando seleção"
              count={a.jobs.awaitingSelection.count}
              list={a.jobs.awaitingSelection.list}
              onOpen={() => navigate("/jobs")}
            />
          </div>
        </Section>
      )}

      {/* Hoje + Oportunidades lado a lado */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {a.jobs.today.count > 0 && (
          <Card>
            <div className="flex items-center justify-between mb-3">
              <CardHeader icon={<CalendarIcon size={16} />} title="Hoje" inline />
              <button
                onClick={() => navigate("/calendar")}
                className="text-[10px] uppercase tracking-wider text-gold-500 hover:text-gold-400 inline-flex items-center gap-1"
              >
                Agenda <ArrowRight size={10} />
              </button>
            </div>
            <div className="space-y-2">
              {a.jobs.today.list.slice(0, 5).map(j => (
                <div key={j.id} className="flex items-center justify-between gap-3 py-2 border-b border-gray-100 dark:border-gray-800/60 last:border-0">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{j.client_name || 'Sem cliente'}</p>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
                      {j.job_type}{j.job_time && ` · ${j.job_time}`}
                    </p>
                  </div>
                  <span className="text-xs font-bold text-gold-500 tabular-nums flex-shrink-0">
                    {formatBRLShort(j.amount, hideValues)}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        )}

        <Card>
          <div className="flex items-center justify-between mb-3">
            <CardHeader icon={<Sparkles size={16} />} title="Oportunidades internas" inline />
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
      </div>
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

function Card({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) {
  const Comp: any = onClick ? 'button' : 'div';
  return (
    <Comp
      onClick={onClick}
      className={cn(
        "relative overflow-hidden bg-white dark:bg-[#161616] border border-black/5 dark:border-white/5 rounded-2xl p-4 text-left transition-all w-full",
        onClick && "hover:border-gold-300 dark:hover:border-gold-500/50 cursor-pointer"
      )}
    >
      {/* Subtle gold corner accent (Apple-meets-spy theme) */}
      <span className="absolute top-0 left-0 h-px w-16 bg-gradient-to-r from-gold-500 to-transparent" aria-hidden />
      <span className="absolute top-0 left-0 w-px h-16 bg-gradient-to-b from-gold-500 to-transparent" aria-hidden />
      <div className="relative">{children}</div>
    </Comp>
  );
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

function CardValue({ value }: { value: string }) {
  return <p className="text-2xl font-bold text-gray-900 dark:text-white tabular-nums tracking-tight truncate">{value}</p>;
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

function SalesFunnel({
  byStage, conversion, hideValues,
}: {
  byStage: Analytics['sales']['byStage'];
  conversion: Analytics['sales']['conversion'];
  hideValues: boolean;
}) {
  const stages = byStage.filter(s => !s.is_final).sort((a, b) => a.position - b.position);
  const wonStages = byStage.filter(s => s.is_won);
  const wonCount = wonStages.reduce((acc, s) => acc + s.count, 0);
  const wonValue = wonStages.reduce((acc, s) => acc + s.total_value, 0);

  if (stages.length === 0) {
    return (
      <p className="text-sm text-gray-500 dark:text-gray-400 italic py-8 text-center">
        Sem etapas configuradas no funil.
      </p>
    );
  }

  const max = Math.max(1, ...stages.map(s => s.count), wonCount);

  return (
    <div className="space-y-3">
      {stages.map(s => {
        const conv = conversion.find(c => c.stage_id === s.id);
        const widthPct = (s.count / max) * 100;
        return (
          <div key={s.id}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] font-medium text-gray-600 dark:text-gray-300 truncate">{s.name}</span>
              <div className="flex items-center gap-2 flex-shrink-0 tabular-nums">
                <span className="text-xs font-bold text-gray-900 dark:text-white">{s.count}</span>
                <span className="text-[10px] text-gray-500 dark:text-gray-400">{formatBRLShort(s.total_value, hideValues)}</span>
                {conv && conv.conversion_rate !== null && conv.entered > 0 && (
                  <span className={cn(
                    "text-[10px] font-bold w-9 text-right",
                    conv.conversion_rate < 40 ? "text-red-500" :
                    conv.conversion_rate < 70 ? "text-amber-500" : "text-emerald-500"
                  )}>
                    {conv.conversion_rate}%
                  </span>
                )}
              </div>
            </div>
            <div className="h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-gold-400 to-gold-500 transition-all"
                style={{ width: `${Math.max(widthPct, s.count > 0 ? 4 : 0)}%` }}
              />
            </div>
          </div>
        );
      })}

      {wonCount > 0 && (
        <div className="pt-2 border-t border-gray-200 dark:border-gray-800">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">Fechados</span>
            <div className="flex items-center gap-2 flex-shrink-0 tabular-nums">
              <span className="text-xs font-bold text-emerald-700 dark:text-emerald-400">{wonCount}</span>
              <span className="text-[10px] text-emerald-600 dark:text-emerald-500">{formatBRLShort(wonValue, hideValues)}</span>
            </div>
          </div>
          <div className="h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-500"
              style={{ width: `${Math.max((wonCount / max) * 100, 4)}%` }}
            />
          </div>
        </div>
      )}
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

import React, { useEffect, useState } from "react";
import { endOfMonth, endOfWeek, format, startOfMonth, startOfWeek } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ResponsiveContainer, BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, PieChart, Pie, Cell, AreaChart, Area, CartesianGrid } from "recharts";
import { BadgeDollarSign, BarChart3, Calendar as CalendarIcon, Camera, CheckCircle2, Filter, Landmark, PieChart as PieChartIcon, Plus, RefreshCw, Shield, Sparkles, TrendingUp, Wallet } from "lucide-react";

import { authFetch } from "../utils/authFetch";
import { cn } from "../utils/cn";
import { parseDate } from "../utils/date";
import { DashboardStats, Job } from "../types";

export default function FinancePage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchJobs = async () => {
    setLoading(true);
    try {
      const res = await authFetch('/api/jobs');
      setJobs(await res.json());
    } catch (error) {
      console.error('Erro ao carregar financeiro:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchJobs();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 dark:border-indigo-400" />
      </div>
    );
  }

  return <Finance stats={null} jobs={jobs} />;
}

type FinancialRuleConfig = {
  label: string;
  baseValue: number;
  keepInBank: number;
  variableGraphics: number;
  extras: number;
  emergencyFund: number;
  investments: number;
  reinvestment: number;
  trafficReference: number;
  proLabore: number;
  personalDistribution: number;
};

type FinancialJobDistribution = {
  job: Job;
  date: Date;
  grossRevenue: number;
  keepInBank: number;
  variableGraphics: number;
  extras: number;
  emergencyFund: number;
  investments: number;
  reinvestment: number;
  proLabore: number;
  personalDistribution: number;
  hasSpecificConfig: boolean;
  matchedRuleLabel: string;
};

type FinancialPeriodSummary = {
  key: string;
  label: string;
  start: Date;
  end: Date;
  jobsCount: number;
  grossRevenue: number;
  keepInBank: number;
  variableGraphics: number;
  extras: number;
  emergencyFund: number;
  investments: number;
  reinvestment: number;
  traffic: number;
  proLabore: number;
  personalDistribution: number;
  netProfit: number;
  unconfiguredJobs: number;
};

type FinanceTotals = {
  grossRevenue: number;
  keepInBank: number;
  variableGraphics: number;
  extras: number;
  emergencyFund: number;
  investments: number;
  reinvestment: number;
  proLabore: number;
  personalDistribution: number;
  unconfiguredJobs: number;
};

const MONTHLY_TRAFFIC_BUDGET = 3000;

const FINANCIAL_RULES: Record<string, FinancialRuleConfig> = {
  'GESTANTE BASIC': { label: 'Gestante Basic', baseValue: 1150, keepInBank: 357.5, variableGraphics: 30, extras: 0, emergencyFund: 115, investments: 115, reinvestment: 140, trafficReference: 115, proLabore: 57.5, personalDistribution: 230 },
  'GESTANTE PREMIUM': { label: 'Gestante Premium', baseValue: 1490, keepInBank: 455, variableGraphics: 40, extras: 0, emergencyFund: 150, investments: 150, reinvestment: 175, trafficReference: 150, proLabore: 75, personalDistribution: 345 },
  'GESTANTE SUPER PREMIUM': { label: 'Gestante Super Premium', baseValue: 1900, keepInBank: 565, variableGraphics: 40, extras: 0, emergencyFund: 190, investments: 190, reinvestment: 215, trafficReference: 190, proLabore: 95, personalDistribution: 525 },
  'NEWBORN PREMIUM': { label: 'Newborn Premium', baseValue: 1550, keepInBank: 600, variableGraphics: 25, extras: 0, emergencyFund: 184, investments: 184, reinvestment: 92, trafficReference: 184, proLabore: 92, personalDistribution: 504 },
  'NEWBORN SUPER PREMIUM': { label: 'Newborn Super Premium', baseValue: 2900, keepInBank: 1274, variableGraphics: 30, extras: 350, emergencyFund: 326, investments: 326, reinvestment: 163, trafficReference: 326, proLabore: 163, personalDistribution: 682 },
  'ACOMPANHAMENTO COMPLETO': { label: 'Acompanhamento Completo', baseValue: 2720, keepInBank: 1170, variableGraphics: 0, extras: 0, emergencyFund: 120, investments: 120, reinvestment: 300, trafficReference: 120, proLabore: 60, personalDistribution: 830 },
  'ACOMPANHAMENTO AVULSO': { label: 'Acompanhamento Avulso', baseValue: 720, keepInBank: 318, variableGraphics: 0, extras: 0, emergencyFund: 38, investments: 57, reinvestment: 60, trafficReference: 0, proLabore: 38, personalDistribution: 247 },
  'SMASH THE CAKE BASIC': { label: 'Smash the Cake Basic', baseValue: 1290, keepInBank: 545, variableGraphics: 30, extras: 0, emergencyFund: 130, investments: 130, reinvestment: 65, trafficReference: 130, proLabore: 65, personalDistribution: 235 },
  'SMASH THE CAKE PREMIUM': { label: 'Smash the Cake Premium', baseValue: 1900, keepInBank: 710, variableGraphics: 40, extras: 350, emergencyFund: 190, investments: 190, reinvestment: 95, trafficReference: 190, proLabore: 95, personalDistribution: 180 },
  'REVELACAO BASIC': { label: 'Revelação Basic', baseValue: 550, keepInBank: 240, variableGraphics: 0, extras: 0, emergencyFund: 55, investments: 0, reinvestment: 55, trafficReference: 55, proLabore: 27.5, personalDistribution: 117.5 },
  'REVELACAO PREMIUM': { label: 'Revelação Premium', baseValue: 850, keepInBank: 355, variableGraphics: 0, extras: 0, emergencyFund: 85, investments: 0, reinvestment: 85, trafficReference: 85, proLabore: 42.5, personalDistribution: 197.5 },
  'REVELACAO SUPER PREMIUM': { label: 'Revelação Super Premium', baseValue: 1100, keepInBank: 440, variableGraphics: 0, extras: 0, emergencyFund: 110, investments: 0, reinvestment: 110, trafficReference: 110, proLabore: 55, personalDistribution: 285 },
  'ANIVERSARIO BASIC': { label: 'Aniversário Basic', baseValue: 1900, keepInBank: 690, variableGraphics: 10, extras: 0, emergencyFund: 147, investments: 77, reinvestment: 200, trafficReference: 77, proLabore: 38.5, personalDistribution: 563.5 },
  'ANIVERSARIO PREMIUM': { label: 'Aniversário Premium', baseValue: 2500, keepInBank: 850, variableGraphics: 10, extras: 300, emergencyFund: 102, investments: 102, reinvestment: 250, trafficReference: 102, proLabore: 51, personalDistribution: 800 },
  'ANIVERSARIO BASIC DOMINGO E FERIADO': { label: 'Aniversário Basic (Domingo e Feriado)', baseValue: 2200, keepInBank: 690, variableGraphics: 10, extras: 0, emergencyFund: 147, investments: 77, reinvestment: 200, trafficReference: 77, proLabore: 38.5, personalDistribution: 563.5 },
  'ANIVERSARIO PREMIUM DOMINGO E FERIADOS': { label: 'Aniversário Premium (Domingo e Feriados)', baseValue: 2800, keepInBank: 850, variableGraphics: 10, extras: 300, emergencyFund: 102, investments: 102, reinvestment: 250, trafficReference: 102, proLabore: 51, personalDistribution: 800 },
};

const FALLBACK_FINANCIAL_RULE = {
  emergencyFund: 0.10,
  investments: 0.15,
  reinvestment: 0.15,
  proLabore: 0.10,
  personalDistribution: 0.50,
};

function normalizeFinancialRuleKey(value: string | undefined | null) {
  return (value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[()]/g, ' ')
    .replace(/[^A-Z0-9]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function formatCurrency(value: number) {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}

function resolveFinancialRule(jobType: string) {
  const normalizedType = normalizeFinancialRuleKey(jobType);
  const exactRule = FINANCIAL_RULES[normalizedType];

  if (exactRule) {
    return exactRule;
  }

  return Object.entries(FINANCIAL_RULES).find(([key]) =>
    normalizedType.includes(key) || key.includes(normalizedType)
  )?.[1] || null;
}

function calculateJobFinancialDistribution(job: Job): FinancialJobDistribution | null {
  const date = parseDate(job.job_date);
  if (!date || job.status === 'cancelled') return null;

  const grossRevenue = Number(job.amount || 0);
  const rule = resolveFinancialRule(job.job_type);

  if (!rule) {
    return {
      job,
      date,
      grossRevenue,
      keepInBank: 0,
      variableGraphics: 0,
      extras: 0,
      emergencyFund: roundCurrency(grossRevenue * FALLBACK_FINANCIAL_RULE.emergencyFund),
      investments: roundCurrency(grossRevenue * FALLBACK_FINANCIAL_RULE.investments),
      reinvestment: roundCurrency(grossRevenue * FALLBACK_FINANCIAL_RULE.reinvestment),
      proLabore: roundCurrency(grossRevenue * FALLBACK_FINANCIAL_RULE.proLabore),
      personalDistribution: roundCurrency(grossRevenue * FALLBACK_FINANCIAL_RULE.personalDistribution),
      hasSpecificConfig: false,
      matchedRuleLabel: 'Sem configuração específica',
    };
  }

  const scale = rule.baseValue > 0 ? grossRevenue / rule.baseValue : 1;

  return {
    job,
    date,
    grossRevenue,
    keepInBank: roundCurrency(rule.keepInBank * scale),
    variableGraphics: roundCurrency(rule.variableGraphics * scale),
    extras: roundCurrency(rule.extras * scale),
    emergencyFund: roundCurrency(rule.emergencyFund * scale),
    investments: roundCurrency(rule.investments * scale),
    reinvestment: roundCurrency(rule.reinvestment * scale),
    proLabore: roundCurrency(rule.proLabore * scale),
    personalDistribution: roundCurrency(rule.personalDistribution * scale),
    hasSpecificConfig: true,
    matchedRuleLabel: rule.label,
  };
}

function getPeriodRange(
  period: 'current_month' | 'last_90_days' | 'current_year' | 'all' | 'custom',
  jobs: FinancialJobDistribution[],
  customStartDate: string,
  customEndDate: string
) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (period === 'current_month') {
    return { start: startOfMonth(today), end: endOfMonth(today) };
  }

  if (period === 'last_90_days') {
    const start = new Date(today);
    start.setDate(start.getDate() - 89);
    return { start, end: today };
  }

  if (period === 'current_year') {
    return {
      start: new Date(today.getFullYear(), 0, 1),
      end: new Date(today.getFullYear(), 11, 31),
    };
  }

  if (period === 'custom') {
    const parsedStart = parseDate(customStartDate) || startOfMonth(today);
    const parsedEnd = parseDate(customEndDate) || today;
    return parsedStart <= parsedEnd
      ? { start: parsedStart, end: parsedEnd }
      : { start: parsedEnd, end: parsedStart };
  }

  if (jobs.length === 0) {
    return { start: startOfMonth(today), end: endOfMonth(today) };
  }

  const sortedDates = [...jobs].sort((a, b) => a.date.getTime() - b.date.getTime());
  return { start: sortedDates[0].date, end: sortedDates[sortedDates.length - 1].date };
}

function getOverlapTraffic(start: Date, end: Date) {
  let cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  const lastMonth = new Date(end.getFullYear(), end.getMonth(), 1);
  let total = 0;

  while (cursor <= lastMonth) {
    const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    const overlapStart = start > monthStart ? start : monthStart;
    const overlapEnd = end < monthEnd ? end : monthEnd;

    if (overlapStart <= overlapEnd) {
      const overlapDays = Math.floor((overlapEnd.getTime() - overlapStart.getTime()) / (1000 * 60 * 60 * 24)) + 1;
      const daysInMonth = monthEnd.getDate();
      total += (MONTHLY_TRAFFIC_BUDGET * overlapDays) / daysInMonth;
    }

    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  }

  return roundCurrency(total);
}

function createEmptyFinancialSummary(key: string, label: string, start: Date, end: Date): FinancialPeriodSummary {
  return {
    key,
    label,
    start,
    end,
    jobsCount: 0,
    grossRevenue: 0,
    keepInBank: 0,
    variableGraphics: 0,
    extras: 0,
    emergencyFund: 0,
    investments: 0,
    reinvestment: 0,
    traffic: 0,
    proLabore: 0,
    personalDistribution: 0,
    netProfit: 0,
    unconfiguredJobs: 0,
  };
}

function summarizeFinancialPeriod(summary: FinancialPeriodSummary) {
  summary.traffic = getOverlapTraffic(summary.start, summary.end);
  summary.netProfit = roundCurrency(
    summary.grossRevenue
      - summary.keepInBank
      - summary.variableGraphics
      - summary.extras
      - summary.emergencyFund
      - summary.investments
      - summary.reinvestment
      - summary.traffic
      - summary.proLabore
  );
  return summary;
}

function addJobToFinancialSummary(summary: FinancialPeriodSummary, item: FinancialJobDistribution) {
  summary.jobsCount += 1;
  summary.grossRevenue += item.grossRevenue;
  summary.keepInBank += item.keepInBank;
  summary.variableGraphics += item.variableGraphics;
  summary.extras += item.extras;
  summary.emergencyFund += item.emergencyFund;
  summary.investments += item.investments;
  summary.reinvestment += item.reinvestment;
  summary.proLabore += item.proLabore;
  summary.personalDistribution += item.personalDistribution;
  if (!item.hasSpecificConfig) {
    summary.unconfiguredJobs += 1;
  }
}

function buildWeeklyFinancialSummaries(
  jobs: FinancialJobDistribution[],
  rangeStart: Date,
  rangeEnd: Date
) {
  const summaries: FinancialPeriodSummary[] = [];
  let cursor = startOfWeek(rangeStart, { weekStartsOn: 1 });

  while (cursor <= rangeEnd) {
    const intervalStart = cursor < rangeStart ? rangeStart : cursor;
    const rawWeekEnd = endOfWeek(cursor, { weekStartsOn: 1 });
    const intervalEnd = rawWeekEnd > rangeEnd ? rangeEnd : rawWeekEnd;
    const key = format(intervalStart, 'yyyy-MM-dd');
    const label = `${format(intervalStart, 'dd/MM')} - ${format(intervalEnd, 'dd/MM')}`;
    const summary = createEmptyFinancialSummary(key, label, intervalStart, intervalEnd);

    jobs.forEach((item) => {
      if (item.date >= intervalStart && item.date <= intervalEnd) {
        addJobToFinancialSummary(summary, item);
      }
    });

    summaries.push(summarizeFinancialPeriod(summary));
    cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 7);
  }

  return summaries;
}

function buildMonthlyFinancialSummaries(
  jobs: FinancialJobDistribution[],
  rangeStart: Date,
  rangeEnd: Date
) {
  const summaries: FinancialPeriodSummary[] = [];
  let cursor = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), 1);
  const lastMonth = new Date(rangeEnd.getFullYear(), rangeEnd.getMonth(), 1);

  while (cursor <= lastMonth) {
    const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    const intervalStart = monthStart < rangeStart ? rangeStart : monthStart;
    const intervalEnd = monthEnd > rangeEnd ? rangeEnd : monthEnd;
    const key = format(monthStart, 'yyyy-MM');
    const label = format(monthStart, 'MMMM yyyy', { locale: ptBR });
    const summary = createEmptyFinancialSummary(key, label, intervalStart, intervalEnd);

    jobs.forEach((item) => {
      if (item.date >= intervalStart && item.date <= intervalEnd) {
        addJobToFinancialSummary(summary, item);
      }
    });

    summaries.push(summarizeFinancialPeriod(summary));
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  }

  return summaries;
}

function intervalsOverlap(startA: Date, endA: Date, startB: Date, endB: Date) {
  return startA <= endB && endA >= startB;
}

function filteredWeeklyRowsReference(
  selectedWeek: string,
  rows: FinancialPeriodSummary[],
  start: Date,
  end: Date
) {
  if (selectedWeek === 'all') return true;
  const selectedRow = rows.find((row) => row.key === selectedWeek);
  return selectedRow ? intervalsOverlap(start, end, selectedRow.start, selectedRow.end) : false;
}

function filteredMonthlyRowsReference(
  selectedMonth: string,
  rows: FinancialPeriodSummary[],
  start: Date,
  end: Date
) {
  if (selectedMonth === 'all') return true;
  const selectedRow = rows.find((row) => row.key === selectedMonth);
  return selectedRow ? intervalsOverlap(start, end, selectedRow.start, selectedRow.end) : false;
}


// --- Finance Component ---
function Finance({ stats: _stats, jobs }: { stats: DashboardStats | null, jobs: Job[] }) {
  const validJobs = jobs
    .map(calculateJobFinancialDistribution)
    .filter((item): item is FinancialJobDistribution => item !== null);

  const [periodFilter, setPeriodFilter] = useState<'current_month' | 'last_90_days' | 'current_year' | 'all' | 'custom'>('current_month');
  const [customStartDate, setCustomStartDate] = useState(format(startOfMonth(new Date()), 'yyyy-MM-dd'));
  const [customEndDate, setCustomEndDate] = useState(format(endOfMonth(new Date()), 'yyyy-MM-dd'));
  const [selectedWeek, setSelectedWeek] = useState('all');
  const [selectedMonth, setSelectedMonth] = useState('all');
  const [selectedJobType, setSelectedJobType] = useState('all');

  const { start: periodStart, end: periodEnd } = getPeriodRange(periodFilter, validJobs, customStartDate, customEndDate);

  const jobTypeOptions = Array.from(new Set(validJobs.map((item) => item.job.job_type))).sort((a, b) => a.localeCompare(b));

  const jobsByPeriodAndType = validJobs.filter((item) => {
    const inPeriod = item.date >= periodStart && item.date <= periodEnd;
    const matchesType = selectedJobType === 'all' || item.job.job_type === selectedJobType;
    return inPeriod && matchesType;
  });

  const weeklyBaseRows = buildWeeklyFinancialSummaries(jobsByPeriodAndType, periodStart, periodEnd);
  const monthlyBaseRows = buildMonthlyFinancialSummaries(jobsByPeriodAndType, periodStart, periodEnd);

  useEffect(() => {
    if (!weeklyBaseRows.some((row) => row.key === selectedWeek)) {
      setSelectedWeek('all');
    }
  }, [selectedWeek, weeklyBaseRows]);

  useEffect(() => {
    if (!monthlyBaseRows.some((row) => row.key === selectedMonth)) {
      setSelectedMonth('all');
    }
  }, [selectedMonth, monthlyBaseRows]);

  const filteredWeeklyRows = weeklyBaseRows.filter((row) => {
    const matchesWeek = selectedWeek === 'all' || row.key === selectedWeek;
    const matchesMonth = selectedMonth === 'all' || filteredMonthlyRowsReference(selectedMonth, monthlyBaseRows, row.start, row.end);
    return matchesWeek && matchesMonth;
  });

  const filteredMonthlyRows = monthlyBaseRows.filter((row) => {
    const matchesMonth = selectedMonth === 'all' || row.key === selectedMonth;
    const matchesWeek = selectedWeek === 'all' || filteredWeeklyRowsReference(selectedWeek, weeklyBaseRows, row.start, row.end);
    return matchesMonth && matchesWeek;
  });

  const summarySource = jobsByPeriodAndType.filter((item) => {
    const weekMatch = selectedWeek === 'all'
      || filteredWeeklyRows.some((row) => item.date >= row.start && item.date <= row.end);
    const monthMatch = selectedMonth === 'all'
      || filteredMonthlyRows.some((row) => item.date >= row.start && item.date <= row.end);
    return weekMatch && monthMatch;
  });

  const selectedStart = selectedWeek !== 'all'
    ? filteredWeeklyRows[0]?.start || periodStart
    : selectedMonth !== 'all'
      ? filteredMonthlyRows[0]?.start || periodStart
      : periodStart;
  const selectedEnd = selectedWeek !== 'all'
    ? filteredWeeklyRows[filteredWeeklyRows.length - 1]?.end || periodEnd
    : selectedMonth !== 'all'
      ? filteredMonthlyRows[filteredMonthlyRows.length - 1]?.end || periodEnd
      : periodEnd;

  const totals = summarySource.reduce<FinanceTotals>((acc, item) => {
    acc.grossRevenue += item.grossRevenue;
    acc.keepInBank += item.keepInBank;
    acc.variableGraphics += item.variableGraphics;
    acc.extras += item.extras;
    acc.emergencyFund += item.emergencyFund;
    acc.investments += item.investments;
    acc.reinvestment += item.reinvestment;
    acc.proLabore += item.proLabore;
    acc.personalDistribution += item.personalDistribution;
    acc.unconfiguredJobs += item.hasSpecificConfig ? 0 : 1;
    return acc;
  }, {
    grossRevenue: 0,
    keepInBank: 0,
    variableGraphics: 0,
    extras: 0,
    emergencyFund: 0,
    investments: 0,
    reinvestment: 0,
    proLabore: 0,
    personalDistribution: 0,
    unconfiguredJobs: 0,
  });

  const selectedTraffic = getOverlapTraffic(selectedStart, selectedEnd);
  const totalNetProfit = roundCurrency(
    totals.grossRevenue
      - totals.keepInBank
      - totals.variableGraphics
      - totals.extras
      - totals.emergencyFund
      - totals.investments
      - totals.reinvestment
      - selectedTraffic
      - totals.proLabore
  );

  const periodLabel = `${format(selectedStart, 'dd/MM/yyyy')} até ${format(selectedEnd, 'dd/MM/yyyy')}`;
  const compositionData = [
    { name: 'Manter no banco', value: totals.keepInBank, color: '#4F46E5' },
    { name: 'Caixa', value: totals.emergencyFund, color: '#14B8A6' },
    { name: 'Investimentos', value: totals.investments, color: '#0EA5E9' },
    { name: 'Reinvestimento', value: totals.reinvestment, color: '#F59E0B' },
    { name: 'Tráfego', value: selectedTraffic, color: '#8B5CF6' },
    { name: 'Pró-labore', value: totals.proLabore, color: '#F97316' },
    { name: 'Distribuição', value: totals.personalDistribution, color: '#10B981' },
  ].filter((item) => item.value > 0);

  const weeklyChartData = filteredWeeklyRows.map((row) => ({
    label: row.label,
    faturamento: roundCurrency(row.grossRevenue),
    lucro: roundCurrency(row.netProfit),
    banco: roundCurrency(row.keepInBank),
  }));

  const monthlyChartData = filteredMonthlyRows.map((row) => ({
    label: row.label
      .split(' ')
      .map((part, index) => (index === 0 ? part.slice(0, 3) : part))
      .join(' '),
    faturamento: roundCurrency(row.grossRevenue),
    lucro: roundCurrency(row.netProfit),
    distribuicao: roundCurrency(row.personalDistribution),
  }));

  const categoryComparisonData = [
    { label: 'Banco', value: totals.keepInBank, color: '#4F46E5' },
    { label: 'Caixa', value: totals.emergencyFund, color: '#14B8A6' },
    { label: 'Invest.', value: totals.investments, color: '#0EA5E9' },
    { label: 'Reinv.', value: totals.reinvestment, color: '#F59E0B' },
    { label: 'Pró-labore', value: totals.proLabore, color: '#F97316' },
    { label: 'Distrib.', value: totals.personalDistribution, color: '#10B981' },
  ];

  const strongestCategory = [...compositionData].sort((a, b) => b.value - a.value)[0] || null;
  const bestMonth = [...filteredMonthlyRows].sort((a, b) => b.netProfit - a.netProfit)[0] || null;
  const bestWeek = [...filteredWeeklyRows].sort((a, b) => b.grossRevenue - a.grossRevenue)[0] || null;

  return (
    <div className="space-y-10">
      <FinanceHeader
        periodLabel={periodLabel}
        summaryCount={summarySource.length}
        periodFilter={periodFilter}
        setPeriodFilter={setPeriodFilter}
        selectedWeek={selectedWeek}
        setSelectedWeek={setSelectedWeek}
        selectedMonth={selectedMonth}
        setSelectedMonth={setSelectedMonth}
        selectedJobType={selectedJobType}
        setSelectedJobType={setSelectedJobType}
        weeklyBaseRows={weeklyBaseRows}
        monthlyBaseRows={monthlyBaseRows}
        jobTypeOptions={jobTypeOptions}
      />

      {periodFilter === 'custom' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-white/95 dark:bg-gray-900/95 border border-white dark:border-gray-800 rounded-[24px] px-5 py-4 shadow-[0_18px_45px_rgba(15,23,42,0.06)] dark:shadow-[0_18px_45px_rgba(0,0,0,0.3)]">
            <label className="block text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-2">Data inicial</label>
            <input
              type="date"
              value={customStartDate}
              onChange={(e) => setCustomStartDate(e.target.value)}
              className="w-full bg-transparent outline-none text-sm font-medium text-gray-700 dark:text-gray-200"
            />
          </div>
          <div className="bg-white/95 dark:bg-gray-900/95 border border-white dark:border-gray-800 rounded-[24px] px-5 py-4 shadow-[0_18px_45px_rgba(15,23,42,0.06)] dark:shadow-[0_18px_45px_rgba(0,0,0,0.3)]">
            <label className="block text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-2">Data final</label>
            <input
              type="date"
              value={customEndDate}
              onChange={(e) => setCustomEndDate(e.target.value)}
              className="w-full bg-transparent outline-none text-sm font-medium text-gray-700 dark:text-gray-200"
            />
          </div>
        </div>
      )}

      {totals.unconfiguredJobs > 0 && (
        <div className="bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-500/10 dark:to-orange-500/10 border border-amber-100 dark:border-amber-500/20 rounded-[24px] px-5 py-4 text-sm text-amber-800 dark:text-amber-300 shadow-[0_12px_28px_rgba(245,158,11,0.08)] dark:shadow-none">
          {totals.unconfiguredJobs} ensaio(s) foram calculados com a regra padrão, sem configuração financeira específica do tipo de ensaio.
        </div>
      )}

      <FinanceSummaryCards totals={totals} selectedTraffic={selectedTraffic} totalNetProfit={totalNetProfit} />

      <FinanceCharts
        weeklyChartData={weeklyChartData}
        monthlyChartData={monthlyChartData}
        compositionData={compositionData}
        categoryComparisonData={categoryComparisonData}
      />

      <FinanceInsights
        strongestCategory={strongestCategory}
        totals={totals}
        selectedTraffic={selectedTraffic}
        totalNetProfit={totalNetProfit}
        bestMonth={bestMonth}
        bestWeek={bestWeek}
      />

      <FinanceTable
        title="Distribuição semanal"
        subtitle="Rateio proporcional por semana dentro do período selecionado."
        rows={filteredWeeklyRows}
      />

      <FinanceTable
        title="Distribuição mensal"
        subtitle="Consolidação mensal com tráfego fixo em R$ 3.000,00 por mês."
        rows={filteredMonthlyRows}
      />
    </div>
  );
}

function FinanceHeader({
  periodLabel,
  summaryCount,
  periodFilter,
  setPeriodFilter,
  selectedWeek,
  setSelectedWeek,
  selectedMonth,
  setSelectedMonth,
  selectedJobType,
  setSelectedJobType,
  weeklyBaseRows,
  monthlyBaseRows,
  jobTypeOptions,
}: {
  periodLabel: string,
  summaryCount: number,
  periodFilter: 'current_month' | 'last_90_days' | 'current_year' | 'all' | 'custom',
  setPeriodFilter: (value: 'current_month' | 'last_90_days' | 'current_year' | 'all' | 'custom') => void,
  selectedWeek: string,
  setSelectedWeek: (value: string) => void,
  selectedMonth: string,
  setSelectedMonth: (value: string) => void,
  selectedJobType: string,
  setSelectedJobType: (value: string) => void,
  weeklyBaseRows: FinancialPeriodSummary[],
  monthlyBaseRows: FinancialPeriodSummary[],
  jobTypeOptions: string[],
}) {
  return (
    <div className="relative overflow-hidden rounded-[32px] border border-white/70 dark:border-gray-700/50 bg-gradient-to-br from-slate-900 via-indigo-900 to-sky-900 px-6 py-7 text-white shadow-[0_24px_80px_rgba(30,41,59,0.28)] md:px-8">
      <div className="absolute inset-0 opacity-40">
        <div className="absolute -top-20 left-10 h-52 w-52 rounded-full bg-cyan-300/20 blur-3xl" />
        <div className="absolute right-0 top-0 h-56 w-56 rounded-full bg-indigo-200/20 blur-3xl" />
        <div className="absolute bottom-0 left-1/3 h-40 w-40 rounded-full bg-emerald-300/10 blur-3xl" />
      </div>

      <div className="relative z-10 flex flex-col gap-8">
        <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-white/80">
              <BadgeDollarSign size={14} />
              Painel financeiro
            </div>
            <h3 className="mt-4 text-3xl font-bold tracking-tight md:text-4xl">Financeiro do estúdio com visão clara do caixa</h3>
            <p className="mt-3 max-w-xl text-sm leading-6 text-white/75 md:text-base">
              Acompanhe faturamento, distribuição e resultado líquido por período com leitura rápida e organizada.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-white/12 bg-white/10 px-4 py-3 backdrop-blur-sm">
              <div className="text-[11px] uppercase tracking-[0.18em] text-white/55">Período ativo</div>
              <div className="mt-2 text-sm font-semibold text-white">{periodLabel}</div>
            </div>
            <div className="rounded-2xl border border-white/12 bg-white/10 px-4 py-3 backdrop-blur-sm">
              <div className="text-[11px] uppercase tracking-[0.18em] text-white/55">Ensaios no recorte</div>
              <div className="mt-2 text-sm font-semibold text-white">{summaryCount} considerados</div>
            </div>
          </div>
        </div>

        <div className="rounded-[28px] border border-white/10 bg-white/10 p-4 backdrop-blur-md">
          <div className="mb-3 flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-white">Filtros do financeiro</p>
              <p className="text-xs text-white/60">Refine o período, o agrupamento e o tipo de ensaio.</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <FinanceFilterSelect
              icon={<Filter size={16} className="text-white/55" />}
              value={periodFilter}
              onChange={(value) => setPeriodFilter(value as 'current_month' | 'last_90_days' | 'current_year' | 'all' | 'custom')}
              options={[
                { value: 'current_month', label: 'Mês atual' },
                { value: 'last_90_days', label: 'Últimos 90 dias' },
                { value: 'current_year', label: 'Ano atual' },
                { value: 'all', label: 'Todo o histórico' },
                { value: 'custom', label: 'Período personalizado' },
              ]}
              dark
            />

            <FinanceFilterSelect
              value={selectedWeek}
              onChange={setSelectedWeek}
              options={[
                { value: 'all', label: 'Todas as semanas' },
                ...weeklyBaseRows.map((row) => ({ value: row.key, label: row.label })),
              ]}
              dark
            />

            <FinanceFilterSelect
              value={selectedMonth}
              onChange={setSelectedMonth}
              options={[
                { value: 'all', label: 'Todos os meses' },
                ...monthlyBaseRows.map((row) => ({ value: row.key, label: row.label })),
              ]}
              dark
            />

            <FinanceFilterSelect
              value={selectedJobType}
              onChange={setSelectedJobType}
              options={[
                { value: 'all', label: 'Todos os ensaios' },
                ...jobTypeOptions.map((jobType) => ({ value: jobType, label: jobType })),
              ]}
              dark
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function FinanceFilterSelect({
  value,
  onChange,
  options,
  icon,
  dark = false,
}: {
  value: string,
  onChange: (value: string) => void,
  options: { value: string, label: string }[],
  icon?: React.ReactNode,
  dark?: boolean,
}) {
  return (
    <div className={cn(
      "flex items-center gap-2 rounded-2xl px-3 py-2.5 shadow-sm transition-colors",
      dark
        ? "border border-white/12 bg-slate-950/15 text-white"
        : "border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
    )}>
      {icon}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          "bg-transparent text-sm font-medium outline-none",
          dark ? "text-white" : "text-gray-700 dark:text-gray-200"
        )}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} className="bg-white dark:bg-gray-800 text-gray-900 dark:text-white">
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function FinanceSummaryCards({
  totals,
  selectedTraffic,
  totalNetProfit,
}: {
  totals: FinanceTotals,
  selectedTraffic: number,
  totalNetProfit: number,
}) {
  const cards = [
    { title: 'Faturamento total', value: formatCurrency(totals.grossRevenue), icon: <BadgeDollarSign size={18} />, accent: 'primary' as const, note: 'Entrada bruta do período' },
    { title: 'Manter no banco', value: formatCurrency(totals.keepInBank), icon: <Landmark size={18} />, accent: 'indigo' as const, note: 'Reserva operacional' },
    { title: 'Caixa de emergência', value: formatCurrency(totals.emergencyFund), icon: <Shield size={18} />, accent: 'teal' as const, note: 'Proteção de caixa' },
    { title: 'Investimentos', value: formatCurrency(totals.investments), icon: <TrendingUp size={18} />, accent: 'sky' as const, note: 'Expansão e melhorias' },
    { title: 'Reinvestimento', value: formatCurrency(totals.reinvestment), icon: <RefreshCw size={18} />, accent: 'amber' as const, note: 'Crescimento contínuo' },
    { title: 'Tráfego', value: formatCurrency(selectedTraffic), icon: <BarChart3 size={18} />, accent: 'violet' as const, note: 'Mídia e aquisição' },
    { title: 'Pró-labore', value: formatCurrency(totals.proLabore), icon: <Wallet size={18} />, accent: 'orange' as const, note: 'Remuneração fixa' },
    { title: 'Distribuição pessoal', value: formatCurrency(totals.personalDistribution), icon: <Sparkles size={18} />, accent: 'emerald' as const, note: 'Lucro pessoal' },
    { title: 'Variável 1/2 gráficos', value: formatCurrency(totals.variableGraphics), icon: <Camera size={18} />, accent: 'slate' as const, note: 'Produção variável' },
    { title: 'Extras', value: formatCurrency(totals.extras), icon: <Plus size={18} />, accent: 'rose' as const, note: 'Álbuns e adicionais' },
    { title: 'Lucro líquido final', value: formatCurrency(totalNetProfit), icon: <CheckCircle2 size={18} />, accent: totalNetProfit >= 0 ? 'emerald' as const : 'rose' as const, note: 'Resultado final do período' },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => (
        <div key={card.title}>
          <FinanceSummaryCard
            title={card.title}
            value={card.value}
            note={card.note}
            icon={card.icon}
            accent={card.accent}
          />
        </div>
      ))}
    </div>
  );
}

function FinanceSummaryCard({
  title,
  value,
  note,
  icon,
  accent = 'slate',
}: {
  title: string,
  value: string,
  note: string,
  icon: React.ReactNode,
  accent?: 'primary' | 'indigo' | 'teal' | 'sky' | 'amber' | 'violet' | 'orange' | 'emerald' | 'slate' | 'rose',
}) {
  const accentStyles = {
    primary: 'border-indigo-200/70 dark:border-indigo-500/30 bg-gradient-to-br from-indigo-600 via-indigo-600 to-blue-600 text-white shadow-[0_20px_45px_rgba(79,70,229,0.22)]',
    indigo: 'border-indigo-100 dark:border-gray-800 bg-white dark:bg-gray-900 text-gray-900 dark:text-white',
    teal: 'border-teal-100 dark:border-gray-800 bg-white dark:bg-gray-900 text-gray-900 dark:text-white',
    sky: 'border-sky-100 dark:border-gray-800 bg-white dark:bg-gray-900 text-gray-900 dark:text-white',
    amber: 'border-amber-100 dark:border-gray-800 bg-white dark:bg-gray-900 text-gray-900 dark:text-white',
    violet: 'border-violet-100 dark:border-gray-800 bg-white dark:bg-gray-900 text-gray-900 dark:text-white',
    orange: 'border-orange-100 dark:border-gray-800 bg-white dark:bg-gray-900 text-gray-900 dark:text-white',
    emerald: 'border-emerald-100 dark:border-gray-800 bg-white dark:bg-gray-900 text-gray-900 dark:text-white',
    slate: 'border-slate-100 dark:border-gray-800 bg-white dark:bg-gray-900 text-gray-900 dark:text-white',
    rose: 'border-rose-100 dark:border-gray-800 bg-white dark:bg-gray-900 text-gray-900 dark:text-white',
  } as const;

  const dotStyles = {
    primary: 'bg-white/20 text-white',
    indigo: 'bg-indigo-50 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400',
    teal: 'bg-teal-50 dark:bg-teal-500/20 text-teal-600 dark:text-teal-400',
    sky: 'bg-sky-50 dark:bg-sky-500/20 text-sky-600 dark:text-sky-400',
    amber: 'bg-amber-50 dark:bg-amber-500/20 text-amber-600 dark:text-amber-400',
    violet: 'bg-violet-50 dark:bg-violet-500/20 text-violet-600 dark:text-violet-400',
    orange: 'bg-orange-50 dark:bg-orange-500/20 text-orange-600 dark:text-orange-400',
    emerald: 'bg-emerald-50 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400',
    slate: 'bg-slate-100 dark:bg-slate-500/20 text-slate-600 dark:text-slate-400',
    rose: 'bg-rose-50 dark:bg-rose-500/20 text-rose-600 dark:text-rose-400',
  } as const;

  return (
    <div className={cn(
      "group relative overflow-hidden rounded-[26px] border p-5 shadow-[0_18px_45px_rgba(15,23,42,0.06)] dark:shadow-[0_18px_45px_rgba(0,0,0,0.2)] transition-transform duration-200 hover:-translate-y-0.5",
      accentStyles[accent]
    )}>
      <div className="absolute right-0 top-0 h-24 w-24 rounded-full bg-current/5 blur-2xl" />
      <div className="relative z-10 flex items-start justify-between gap-4">
        <div>
          <p className={cn("text-sm font-medium", accent === 'primary' ? "text-indigo-100" : "text-gray-500 dark:text-gray-400")}>{title}</p>
          <p className="mt-3 text-[1.7rem] font-bold tracking-tight">{value}</p>
          <p className={cn("mt-2 text-xs", accent === 'primary' ? "text-white/70" : "text-gray-400 dark:text-gray-500")}>{note}</p>
        </div>
        <div className={cn("flex h-11 w-11 items-center justify-center rounded-2xl", dotStyles[accent])}>
          {icon}
        </div>
      </div>
    </div>
  );
}

function FinanceCharts({
  weeklyChartData,
  monthlyChartData,
  compositionData,
  categoryComparisonData,
}: {
  weeklyChartData: { label: string, faturamento: number, lucro: number, banco: number }[],
  monthlyChartData: { label: string, faturamento: number, lucro: number, distribuicao: number }[],
  compositionData: { name: string, value: number, color: string }[],
  categoryComparisonData: { label: string, value: number, color: string }[],
}) {
  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
      <FinanceChartCard
        title="Distribuição semanal"
        subtitle="Faturamento e lucro líquido por semana"
        icon={<BarChart3 size={16} />}
        className="xl:col-span-7"
      >
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={weeklyChartData} barGap={10}>
              <CartesianGrid vertical={false} stroke="currentColor" strokeDasharray="3 3" className="text-gray-200 dark:text-gray-700" />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: 'currentColor', fontSize: 12 }} className="text-gray-500 dark:text-gray-400" />
              <YAxis tickLine={false} axisLine={false} tick={{ fill: 'currentColor', fontSize: 12 }} className="text-gray-400 dark:text-gray-500" tickFormatter={(value) => `R$ ${Math.round(value / 1000)}k`} />
              <Tooltip content={<FinanceChartTooltip />} cursor={{ fill: 'rgba(99, 102, 241, 0.06)' }} />
              <Bar dataKey="faturamento" name="Faturamento" fill="#4F46E5" radius={[10, 10, 0, 0]} />
              <Bar dataKey="lucro" name="Lucro líquido" fill="#10B981" radius={[10, 10, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </FinanceChartCard>

      <FinanceChartCard
        title="Composição do financeiro"
        subtitle="Como o dinheiro está distribuído no período"
        icon={<PieChartIcon size={16} />}
        className="xl:col-span-5"
      >
        <div className="grid grid-cols-1 items-center gap-4 lg:grid-cols-[minmax(0,220px)_1fr]">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Tooltip content={<FinanceChartTooltip />} />
                <Pie data={compositionData} dataKey="value" nameKey="name" innerRadius={65} outerRadius={95} paddingAngle={3}>
                  {compositionData.map((entry) => (
                    <Cell key={entry.name} fill={entry.color} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="space-y-3">
            {compositionData.map((item) => (
              <div key={item.name} className="flex items-center justify-between gap-4 rounded-2xl bg-gray-50 dark:bg-gray-800 px-4 py-3">
                <div className="flex items-center gap-3">
                  <span className="h-3 w-3 rounded-full" style={{ backgroundColor: item.color }} />
                  <span className="text-sm font-medium text-gray-600 dark:text-gray-300">{item.name}</span>
                </div>
                <span className="text-sm font-semibold text-gray-900 dark:text-white">{formatCurrency(item.value)}</span>
              </div>
            ))}
          </div>
        </div>
      </FinanceChartCard>

      <FinanceChartCard
        title="Evolução mensal"
        subtitle="Leitura suave do faturamento versus lucro"
        icon={<TrendingUp size={16} />}
        className="xl:col-span-7"
      >
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={monthlyChartData}>
              <defs>
                <linearGradient id="financeRevenueGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#4F46E5" stopOpacity={0.28} />
                  <stop offset="95%" stopColor="#4F46E5" stopOpacity={0.02} />
                </linearGradient>
                <linearGradient id="financeProfitGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10B981" stopOpacity={0.18} />
                  <stop offset="95%" stopColor="#10B981" stopOpacity={0.01} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="currentColor" strokeDasharray="3 3" className="text-gray-200 dark:text-gray-700" />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: 'currentColor', fontSize: 12 }} className="text-gray-500 dark:text-gray-400" />
              <YAxis tickLine={false} axisLine={false} tick={{ fill: 'currentColor', fontSize: 12 }} className="text-gray-400 dark:text-gray-500" tickFormatter={(value) => `R$ ${Math.round(value / 1000)}k`} />
              <Tooltip content={<FinanceChartTooltip />} />
              <Area type="monotone" dataKey="faturamento" stroke="#4F46E5" strokeWidth={3} fill="url(#financeRevenueGradient)" />
              <Area type="monotone" dataKey="lucro" stroke="#10B981" strokeWidth={3} fill="url(#financeProfitGradient)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </FinanceChartCard>

      <FinanceChartCard
        title="Comparativo por categoria"
        subtitle="Principais destinos do dinheiro"
        icon={<Wallet size={16} />}
        className="xl:col-span-5"
      >
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={categoryComparisonData} layout="vertical" margin={{ left: 10, right: 10 }}>
              <CartesianGrid horizontal={false} stroke="currentColor" className="text-gray-100 dark:text-gray-800" />
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="label" tickLine={false} axisLine={false} tick={{ fill: 'currentColor', fontSize: 12 }} className="text-gray-500 dark:text-gray-400" width={82} />
              <Tooltip content={<FinanceChartTooltip />} cursor={{ fill: 'rgba(99, 102, 241, 0.06)' }} />
              <Bar dataKey="value" radius={[0, 10, 10, 0]}>
                {categoryComparisonData.map((entry) => (
                  <Cell key={entry.label} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </FinanceChartCard>
    </div>
  );
}

function FinanceChartCard({
  title,
  subtitle,
  icon,
  className,
  children,
}: {
  title: string,
  subtitle: string,
  icon: React.ReactNode,
  className?: string,
  children: React.ReactNode,
}) {
  return (
    <div className={cn("rounded-[30px] border border-white dark:border-gray-800 bg-white/95 dark:bg-gray-900/95 p-5 shadow-[0_20px_55px_rgba(15,23,42,0.07)] dark:shadow-[0_20px_55px_rgba(0,0,0,0.3)]", className)}>
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h4 className="text-lg font-bold text-gray-900 dark:text-white">{title}</h4>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{subtitle}</p>
        </div>
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-indigo-50 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400">
          {icon}
        </div>
      </div>
      {children}
    </div>
  );
}

function FinanceChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-2xl border border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-3 shadow-xl">
      {label && <p className="mb-2 text-sm font-semibold text-gray-900 dark:text-white">{label}</p>}
      <div className="space-y-1.5">
        {payload.map((entry: any) => (
          <div key={entry.name} className="flex items-center justify-between gap-4 text-sm">
            <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: entry.color }} />
              {entry.name}
            </div>
            <span className="font-semibold text-gray-900 dark:text-white">{formatCurrency(Number(entry.value || 0))}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function FinanceInsights({
  strongestCategory,
  totals,
  selectedTraffic,
  totalNetProfit,
  bestMonth,
  bestWeek,
}: {
  strongestCategory: { name: string, value: number, color: string } | null,
  totals: FinanceTotals,
  selectedTraffic: number,
  totalNetProfit: number,
  bestMonth: FinancialPeriodSummary | null,
  bestWeek: FinancialPeriodSummary | null,
}) {
  const insights = [
    {
      title: 'Maior destino do dinheiro',
      value: strongestCategory ? strongestCategory.name : 'Sem dados',
      detail: strongestCategory ? formatCurrency(strongestCategory.value) : 'Nenhuma distribuição encontrada',
      icon: <PieChartIcon size={18} />,
      tone: 'indigo',
    },
    {
      title: 'Caixa total protegido',
      value: formatCurrency(totals.emergencyFund),
      detail: 'Separado para segurança do negócio',
      icon: <Shield size={18} />,
      tone: 'teal',
    },
    {
      title: 'Reinvestimento previsto',
      value: formatCurrency(totals.reinvestment + selectedTraffic + totals.investments),
      detail: 'Soma de reinvestimento, tráfego e investimentos',
      icon: <TrendingUp size={18} />,
      tone: 'sky',
    },
    {
      title: 'Lucro distribuído',
      value: formatCurrency(totals.personalDistribution),
      detail: `Lucro líquido atual: ${formatCurrency(totalNetProfit)}`,
      icon: <Sparkles size={18} />,
      tone: 'emerald',
    },
    {
      title: 'Melhor mês do recorte',
      value: bestMonth ? bestMonth.label : 'Sem dados',
      detail: bestMonth ? `Lucro líquido de ${formatCurrency(bestMonth.netProfit)}` : 'Sem movimentação mensal',
      icon: <CalendarIcon size={18} />,
      tone: 'amber',
    },
    {
      title: 'Semana com maior faturamento',
      value: bestWeek ? bestWeek.label : 'Sem dados',
      detail: bestWeek ? `Faturamento bruto de ${formatCurrency(bestWeek.grossRevenue)}` : 'Sem movimentação semanal',
      icon: <BarChart3 size={18} />,
      tone: 'violet',
    },
  ] as const;

  const toneStyles = {
    indigo: 'bg-indigo-50 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400',
    teal: 'bg-teal-50 dark:bg-teal-500/20 text-teal-600 dark:text-teal-400',
    sky: 'bg-sky-50 dark:bg-sky-500/20 text-sky-600 dark:text-sky-400',
    emerald: 'bg-emerald-50 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400',
    amber: 'bg-amber-50 dark:bg-amber-500/20 text-amber-600 dark:text-amber-400',
    violet: 'bg-violet-50 dark:bg-violet-500/20 text-violet-600 dark:text-violet-400',
  } as const;

  return (
    <div className="rounded-[30px] border border-white dark:border-gray-800 bg-white/95 dark:bg-gray-900/95 p-6 shadow-[0_20px_55px_rgba(15,23,42,0.07)] dark:shadow-[0_20px_55px_rgba(0,0,0,0.3)]">
      <div className="mb-5 flex items-center justify-between gap-4">
        <div>
          <h4 className="text-lg font-bold text-gray-900 dark:text-white">Resumo visual</h4>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Os indicadores mais úteis para leitura rápida do financeiro.</p>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {insights.map((insight) => (
          <div key={insight.title} className="rounded-[24px] border border-gray-100 dark:border-gray-800 bg-gradient-to-br from-white to-gray-50 dark:from-gray-900 dark:to-gray-800 p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-gray-500 dark:text-gray-400">{insight.title}</p>
                <p className="mt-3 text-xl font-bold text-gray-900 dark:text-white">{insight.value}</p>
                <p className="mt-2 text-sm text-gray-400 dark:text-gray-500">{insight.detail}</p>
              </div>
              <div className={cn("flex h-11 w-11 items-center justify-center rounded-2xl", toneStyles[insight.tone])}>
                {insight.icon}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FinanceTable({
  title,
  subtitle,
  rows,
}: {
  title: string,
  subtitle: string,
  rows: FinancialPeriodSummary[],
}) {
  return (
    <div className="overflow-hidden rounded-[30px] border border-white dark:border-gray-800 bg-white/95 dark:bg-gray-900/95 shadow-[0_20px_55px_rgba(15,23,42,0.07)] dark:shadow-[0_20px_55px_rgba(0,0,0,0.3)]">
      <div className="flex items-center justify-between gap-4 border-b border-gray-100 dark:border-gray-800 px-6 py-5">
        <div>
          <h4 className="font-bold text-gray-800 dark:text-white">{title}</h4>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{subtitle}</p>
        </div>
        <div className="hidden rounded-full bg-gray-100 dark:bg-gray-800 px-3 py-1 text-xs font-semibold text-gray-500 dark:text-gray-400 md:block">
          {rows.length} linha(s)
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[1400px] text-left">
          <thead className="sticky top-0 z-[1] bg-gray-50/95 dark:bg-gray-800/95 text-[11px] uppercase tracking-wider text-gray-500 dark:text-gray-400 backdrop-blur">
            <tr>
              <th className="px-5 py-4 font-semibold">Período</th>
              <th className="px-5 py-4 font-semibold text-right">Faturamento</th>
              <th className="px-5 py-4 font-semibold text-right">Manter banco</th>
              <th className="px-5 py-4 font-semibold text-right">Variável gráficos</th>
              <th className="px-5 py-4 font-semibold text-right">Extras</th>
              <th className="px-5 py-4 font-semibold text-right">Caixa</th>
              <th className="px-5 py-4 font-semibold text-right">Investimentos</th>
              <th className="px-5 py-4 font-semibold text-right">Reinvestimento</th>
              <th className="px-5 py-4 font-semibold text-right">Tráfego</th>
              <th className="px-5 py-4 font-semibold text-right">Pró-labore</th>
              <th className="px-5 py-4 font-semibold text-right">Distribuição</th>
              <th className="px-5 py-4 font-semibold text-right">Lucro líquido final</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {rows.map((row, index) => (
              <tr key={row.key} className={cn(
                "transition-colors hover:bg-indigo-50/40 dark:hover:bg-indigo-500/10",
                index % 2 === 0 ? "bg-white dark:bg-gray-900" : "bg-gray-50/35 dark:bg-gray-800/35"
              )}>
                <td className="px-5 py-4">
                  <div className="font-semibold text-gray-800 dark:text-white">{row.label}</div>
                  <div className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                    {row.jobsCount} ensaio(s)
                    {row.unconfiguredJobs > 0 && ` · ${row.unconfiguredJobs} sem configuração`}
                  </div>
                </td>
                <td className="px-5 py-4 text-right font-semibold text-gray-900 dark:text-white">{formatCurrency(row.grossRevenue)}</td>
                <td className="px-5 py-4 text-right text-gray-600 dark:text-gray-300">{formatCurrency(row.keepInBank)}</td>
                <td className="px-5 py-4 text-right text-gray-600 dark:text-gray-300">{formatCurrency(row.variableGraphics)}</td>
                <td className="px-5 py-4 text-right text-gray-600 dark:text-gray-300">{formatCurrency(row.extras)}</td>
                <td className="px-5 py-4 text-right text-gray-600 dark:text-gray-300">{formatCurrency(row.emergencyFund)}</td>
                <td className="px-5 py-4 text-right text-gray-600 dark:text-gray-300">{formatCurrency(row.investments)}</td>
                <td className="px-5 py-4 text-right text-gray-600 dark:text-gray-300">{formatCurrency(row.reinvestment)}</td>
                <td className="px-5 py-4 text-right text-gray-600 dark:text-gray-300">{formatCurrency(row.traffic)}</td>
                <td className="px-5 py-4 text-right text-gray-600 dark:text-gray-300">{formatCurrency(row.proLabore)}</td>
                <td className="px-5 py-4 text-right">
                  <span className="inline-flex rounded-full bg-emerald-50 dark:bg-emerald-500/20 px-3 py-1 text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                    {formatCurrency(row.personalDistribution)}
                  </span>
                </td>
                <td className={cn("px-5 py-4 text-right font-semibold", row.netProfit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400")}>
                  {formatCurrency(row.netProfit)}
                </td>
              </tr>
            ))}

            {rows.length === 0 && (
              <tr>
                <td colSpan={12} className="px-4 py-10 text-center text-sm text-gray-400 dark:text-gray-500">
                  Nenhum ensaio encontrado para os filtros selecionados.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

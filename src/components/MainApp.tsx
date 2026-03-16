/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { useAuth } from "../contexts/AuthContext";
import { supabase } from "../integrations/supabase/client";
import { 
  LayoutDashboard, 
  Users, 
  Calendar, 
  DollarSign, 
  Trello, 
  Settings,
  Plus,
  Search,
  ChevronRight,
  MoreVertical,
  Filter,
  ArrowUpRight,
  ArrowDownRight,
  Camera,
  Clock,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Trash2,
  Edit2,
  Copy,
  MessageSquare,
  Sparkles,
  Calendar as CalendarIcon,
  ChevronDown,
  ExternalLink,
  Phone,
  Check,
  Download,
  Upload,
  FileText,
  Landmark,
  Shield,
  BadgeDollarSign,
  TrendingUp,
  Wallet,
  PieChart as PieChartIcon,
  BarChart3
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  BarChart,
  Bar,
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  Tooltip, 
  ResponsiveContainer, 
  PieChart, 
  Pie, 
  Cell,
  Area,
  AreaChart,
  CartesianGrid
} from 'recharts';
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval, isSameDay, addMonths, subMonths, addDays, subDays } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

import { Client, Job, FunnelStage, Lead, DashboardStats, Opportunity, OpportunityRule } from '../types';
import ImportProgressModal from './ImportProgressModal';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
// Helper para obter headers de autenticação
const getAuthHeaders = async (): Promise<HeadersInit> => {
  const { data: { session } } = await supabase.auth.getSession();
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${session?.access_token || ''}`
  };
};

// Helper para fetch autenticado
const authFetch = async (url: string, options: RequestInit = {}): Promise<Response> => {
  const headers = await getAuthHeaders();
  return fetch(url, {
    ...options,
    headers: {
      ...headers,
      ...(options.headers || {})
    }
  });
};

const parseDate = (dateStr: string | undefined | null) => {
  if (!dateStr) return null;
  try {
    // Handle YYYY-MM-DD format specifically to avoid timezone shifts
    const parts = dateStr.split('T')[0].split('-');
    if (parts.length === 3) {
      const [year, month, day] = parts.map(Number);
      const date = new Date(year, month - 1, day);
      if (!isNaN(date.getTime())) return date;
    }
    const date = new Date(dateStr);
    return isNaN(date.getTime()) ? null : date;
  } catch (e) {
    return null;
  }
};

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

type Page = 'dashboard' | 'clients' | 'calendar' | 'finance' | 'sales' | 'settings';

export default function MainApp() {
  const { user, signOut } = useAuth();
  const [activePage, setActivePage] = useState<Page>('dashboard');
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [funnel, setFunnel] = useState<{ stages: FunnelStage[], leads: Lead[] }>({ stages: [], leads: [] });
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [opportunityRules, setOpportunityRules] = useState<OpportunityRule[]>([]);
  const [selectedOppForContact, setSelectedOppForContact] = useState<{ opp: Opportunity, client: Client | null } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [statsRes, clientsRes, jobsRes, funnelRes, oppsRes, rulesRes] = await Promise.all([
        authFetch('/api/stats'),
        authFetch('/api/clients'),
        authFetch('/api/jobs'),
        authFetch('/api/funnel'),
        authFetch('/api/opportunities'),
        authFetch('/api/opportunity-rules')
      ]);
      
      setStats(await statsRes.json());
      setClients(await clientsRes.json());
      setJobs(await jobsRes.json());
      setFunnel(await funnelRes.json());
      setOpportunities(await oppsRes.json());
      setOpportunityRules(await rulesRes.json());
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const renderPage = () => {
    switch (activePage) {
      case 'dashboard': return <Dashboard stats={stats} jobs={jobs} clients={clients} opportunities={opportunities} onContactOpp={(opp, client) => setSelectedOppForContact({ opp, client })} />;
      case 'clients': return <Clients clients={clients} onUpdate={fetchData} onContactOpp={(opp, client) => setSelectedOppForContact({ opp, client })} />;
      case 'calendar': return <CalendarPage jobs={jobs} clients={clients} onUpdate={fetchData} />;
      case 'finance': return <Finance stats={stats} jobs={jobs} />;
      case 'sales': return <Sales funnel={funnel} opportunities={opportunities} onUpdate={fetchData} onContactOpp={(opp, client) => setSelectedOppForContact({ opp, client })} />;
      case 'settings': return <SettingsPage rules={opportunityRules} onUpdate={fetchData} />;
      default: return <Dashboard stats={stats} jobs={jobs} clients={clients} opportunities={opportunities} onContactOpp={(opp, client) => setSelectedOppForContact({ opp, client })} />;
    }
  };

  return (
    <div className="flex h-screen bg-[#F8F9FA] text-[#1A1A1A] font-sans">
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r border-gray-200 flex flex-col">
        <div className="p-6 flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white">
            <Camera size={24} />
          </div>
          <h1 className="text-xl font-bold tracking-tight">FocalPoint</h1>
        </div>

        <nav className="flex-1 px-4 py-4 space-y-1">
          <NavItem 
            icon={<LayoutDashboard size={20} />} 
            label="Dashboard" 
            active={activePage === 'dashboard'} 
            onClick={() => setActivePage('dashboard')} 
          />
          <NavItem 
            icon={<Users size={20} />} 
            label="Clientes" 
            active={activePage === 'clients'} 
            onClick={() => setActivePage('clients')} 
          />
          <NavItem 
            icon={<Calendar size={20} />} 
            label="Agenda" 
            active={activePage === 'calendar'} 
            onClick={() => setActivePage('calendar')} 
          />
          <NavItem 
            icon={<DollarSign size={20} />} 
            label="Financeiro" 
            active={activePage === 'finance'} 
            onClick={() => setActivePage('finance')} 
          />
          <NavItem 
            icon={<Trello size={20} />} 
            label="Vendas" 
            active={activePage === 'sales'} 
            onClick={() => setActivePage('sales')} 
          />
        </nav>

        <div className="p-4 border-t border-gray-100">
          <button 
            onClick={() => setActivePage('settings')}
            className={cn(
              "flex items-center gap-3 w-full px-4 py-3 rounded-xl transition-all duration-200",
              activePage === 'settings' 
                ? "bg-indigo-50 text-indigo-700 font-semibold" 
                : "text-gray-500 hover:bg-gray-50 hover:text-gray-900"
            )}
          >
            <Settings size={20} />
            <span className="font-medium">Configurações</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto">
        <header className="h-16 bg-white border-bottom border-gray-200 px-8 flex items-center justify-between sticky top-0 z-10">
          <h2 className="text-lg font-semibold capitalize">{activePage === 'sales' ? 'Funil de Vendas' : activePage}</h2>
          <div className="flex items-center gap-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
              <input 
                type="text" 
                placeholder="Buscar..." 
                className="pl-10 pr-4 py-2 bg-gray-100 border-none rounded-full text-sm focus:ring-2 focus:ring-indigo-500 w-64"
              />
            </div>
            <div className="flex items-center gap-3">
  <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700 font-bold text-xs">
    {user?.email?.charAt(0).toUpperCase() || 'U'}
  </div>
  <button
    onClick={signOut}
    className="text-sm text-gray-500 hover:text-red-600 font-medium"
  >
    Sair
  </button>
</div>

          </div>
        </header>

        <div className="p-8">
          <AnimatePresence mode="wait">
            <motion.div
              key={activePage}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              {loading ? (
                <div className="flex items-center justify-center h-64">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
                </div>
              ) : renderPage()}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>

      {/* Modals */}
      {selectedOppForContact && (
        <ContactOpportunityModal 
          opportunity={selectedOppForContact.opp}
          client={selectedOppForContact.client}
          onClose={() => setSelectedOppForContact(null)}
          onUpdate={fetchData}
        />
      )}
    </div>
  );
}

function NavItem({ icon, label, active, onClick }: { icon: React.ReactNode, label: string, active: boolean, onClick: () => void }) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "flex items-center gap-3 w-full px-4 py-3 rounded-xl transition-all duration-200",
        active 
          ? "bg-indigo-50 text-indigo-700 font-semibold" 
          : "text-gray-500 hover:bg-gray-50 hover:text-gray-900"
      )}
    >
      {icon}
      <span>{label}</span>
      {active && <motion.div layoutId="active-pill" className="ml-auto w-1.5 h-1.5 rounded-full bg-indigo-600" />}
    </button>
  );
}

// --- Dashboard Component ---
function Dashboard({ stats, jobs, clients, opportunities, onContactOpp }: { stats: DashboardStats | null, jobs: Job[], clients: Client[], opportunities: Opportunity[], onContactOpp: (opp: Opportunity, client: Client | null) => void }) {
  const [revenueRange, setRevenueRange] = useState<'7' | '30' | '60' | '90' | '180' | '365' | 'custom'>('30');

  const today = new Date();
  const defaultEnd = format(today, 'yyyy-MM-dd');
  const defaultStart30 = format(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 29), 'yyyy-MM-dd');

  const [customStartDate, setCustomStartDate] = useState<string>(defaultStart30);
  const [customEndDate, setCustomEndDate] = useState<string>(defaultEnd);

  if (!stats) return null;

  const COLORS = ['#4F46E5', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6'];

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'urgent': return 'text-red-600 bg-red-50 border-red-100';
      case 'active': return 'text-amber-600 bg-amber-50 border-amber-100';
      default: return 'text-indigo-600 bg-indigo-50 border-indigo-100';
    }
  };

  const revenueMap = new Map(
    (stats.dailyRevenue || []).map(item => [item.date, Number(item.total || 0)])
  );

  let startDate = new Date();
  let endDate = new Date();

  if (revenueRange === 'custom') {
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
    const mm = String(currentDate.getMonth() + 1).padStart(2, '0');
    const dd = String(currentDate.getDate()).padStart(2, '0');
    const isoDate = `${yyyy}-${mm}-${dd}`;

    return {
      date: isoDate,
      label: `${dd}/${mm}`,
      total: revenueMap.get(isoDate) || 0
    };
  });

  const revenueSelectedPeriod = chartData.reduce((sum, item) => sum + item.total, 0);

  const scheduledJobs = jobs.filter(job => {
    if (!job.job_date) return false;
    const date = parseDate(job.job_date);
    if (!date) return false;
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    return date >= todayStart && job.status !== 'cancelled';
  });

  const futureRevenue30 = scheduledJobs
    .filter(job => {
      const date = parseDate(job.job_date);
      if (!date) return false;
      const limit = new Date();
      limit.setDate(limit.getDate() + 30);
      return date <= limit;
    })
    .reduce((sum, job) => sum + Number(job.amount || 0), 0);

  const futureRevenue90 = scheduledJobs
    .filter(job => {
      const date = parseDate(job.job_date);
      if (!date) return false;
      const limit = new Date();
      limit.setDate(limit.getDate() + 90);
      return date <= limit;
    })
    .reduce((sum, job) => sum + Number(job.amount || 0), 0);

  const futureRevenueByMonthMap = new Map<string, number>();

  scheduledJobs.forEach(job => {
    const date = parseDate(job.job_date);
    if (!date) return;

    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const key = `${yyyy}-${mm}`;

    futureRevenueByMonthMap.set(
      key,
      (futureRevenueByMonthMap.get(key) || 0) + Number(job.amount || 0)
    );
  });

  const futureRevenueByMonth = Array.from(futureRevenueByMonthMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(0, 6)
    .map(([month, total]) => ({
      month,
      label: `${month.slice(5, 7)}/${month.slice(0, 4)}`,
      total
    }));

  return (
    <div className="space-y-8">
      {/* Stats Grid */}
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-6">
        <StatCard 
          title="Leads Ativos" 
          value={stats.activeLeads} 
          icon={<Trello className="text-blue-600" />} 
          trend="" 
          trendUp={true} 
        />
        <StatCard 
          title="Vendas no Mês" 
          value={stats.totalJobsMonth} 
          icon={<CheckCircle2 className="text-emerald-600" />} 
          trend="" 
          trendUp={true} 
        />
        <StatCard 
          title="Clientes do Mês" 
          value={stats.totalClientsMonth} 
          icon={<Users className="text-violet-600" />} 
          trend="" 
          trendUp={true} 
        />
        <StatCard 
          title={revenueRange === 'custom' ? 'Faturamento no Período' : `Faturamento ${rangeDays} dias`}
          value={`R$ ${revenueSelectedPeriod.toLocaleString('pt-BR')}`} 
          icon={<DollarSign className="text-amber-600" />} 
          trend="" 
          trendUp={true} 
        />
        <StatCard 
          title="Futuro 30 dias" 
          value={`R$ ${futureRevenue30.toLocaleString('pt-BR')}`} 
          icon={<CalendarIcon className="text-green-600" />} 
          trend="" 
          trendUp={true} 
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Revenue Chart */}
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
          R$ {revenueSelectedPeriod.toLocaleString('pt-BR')}
        </h3>
        <p className="text-white/80 text-sm mt-2">
          {format(startDate, 'dd/MM/yyyy')} até {format(endDate, 'dd/MM/yyyy')}
        </p>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <select
          value={revenueRange}
          onChange={(e) => setRevenueRange(e.target.value as '7' | '30' | '60' | '90' | '180' | '365' | 'custom')}
          className="text-sm bg-white/15 text-white rounded-xl px-3 py-2 outline-none border border-white/20 backdrop-blur-md"
        >
          <option value="7" className="text-black">Últimos 7 dias</option>
          <option value="30" className="text-black">Mensal (30 dias)</option>
          <option value="60" className="text-black">60 dias</option>
          <option value="90" className="text-black">Trimestral (90 dias)</option>
          <option value="180" className="text-black">Semestral (180 dias)</option>
          <option value="365" className="text-black">Anual (365 dias)</option>
          <option value="custom" className="text-black">Período personalizado</option>
        </select>

        {revenueRange === 'custom' && (
          <>
            <input
              type="date"
              value={customStartDate}
              onChange={(e) => setCustomStartDate(e.target.value)}
              className="text-sm bg-white/15 text-white rounded-xl px-3 py-2 outline-none border border-white/20 backdrop-blur-md"
            />
            <span className="text-white/70 text-sm">até</span>
            <input
              type="date"
              value={customEndDate}
              onChange={(e) => setCustomEndDate(e.target.value)}
              className="text-sm bg-white/15 text-white rounded-xl px-3 py-2 outline-none border border-white/20 backdrop-blur-md"
            />
          </>
        )}
      </div>
    </div>

    <div className="h-72 md:h-80">
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
            tick={{ fontSize: 12, fill: 'rgba(255,255,255,0.75)' }}
            interval={Math.max(0, Math.floor(chartData.length / 8))}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 12, fill: 'rgba(255,255,255,0.65)' }}
          />
          <Tooltip
            formatter={(value: any) => [`R$ ${Number(value || 0).toLocaleString('pt-BR')}`, 'Faturamento']}
            labelFormatter={(label: any, payload: any) => {
              const item = payload?.[0]?.payload;
              return item?.date ? `Data: ${item.date}` : label;
            }}
            contentStyle={{
              borderRadius: '16px',
              border: '1px solid rgba(255,255,255,0.15)',
              background: 'rgba(15, 23, 42, 0.88)',
              color: '#fff',
              boxShadow: '0 10px 30px rgba(0,0,0,0.25)',
              backdropFilter: 'blur(10px)'
            }}
            labelStyle={{ color: '#cbd5e1' }}
          />
          <Area
            type="monotone"
            dataKey="total"
            stroke="rgba(255,255,255,0)"
            fill="url(#revenueFill)"
          />
          <Line
            type="monotone"
            dataKey="total"
            stroke="#FFFFFF"
            strokeWidth={4}
            dot={false}
            activeDot={{ r: 6, fill: '#FFFFFF', stroke: 'rgba(255,255,255,0.35)', strokeWidth: 8 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  </div>
</div>

        {/* Opportunities List */}
        <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm flex flex-col">
          <div className="flex items-center justify-between mb-6">
            <h3 className="font-bold text-gray-800 flex items-center gap-2">
              <Sparkles className="text-amber-500" size={18} />
              Próximas Oportunidades
            </h3>
            <span className="bg-amber-100 text-amber-700 text-[10px] font-bold px-2 py-0.5 rounded-full">
              {opportunities.length}
            </span>
          </div>
          <div className="flex-1 space-y-4 overflow-y-auto max-h-[350px] pr-2 custom-scrollbar">
            {opportunities.map((opp) => (
              <div key={opp.id} className={cn(
                "p-3 rounded-xl border transition-colors",
                opp.priority === 'urgent' ? "bg-red-50/50 border-red-100 hover:border-red-200" : 
                opp.priority === 'active' ? "bg-amber-50/50 border-amber-100 hover:border-amber-200" :
                "bg-gray-50 border-gray-100 hover:border-indigo-200"
              )}>
                <div className="flex items-center justify-between mb-1">
                  <span className="font-bold text-sm text-gray-900">{opp.client_name}</span>
                  <span className={cn(
                    "text-[10px] font-bold px-2 py-0.5 rounded-full uppercase",
                    getPriorityColor(opp.priority || 'future')
                  )}>
                    {opp.type}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1 text-xs text-gray-500">
                    <CalendarIcon size={12} />
                    {opp.priority === 'urgent' ? 'Atrasado: ' : 'Sugerido: '} {format(new Date(opp.suggested_date), 'dd/MM/yyyy')}
                  </div>
                  <div className="flex items-center gap-2">
                    {opp.priority === 'urgent' && <AlertCircle size={12} className="text-red-500 animate-pulse" />}
                    {opp.priority === 'active' && <Sparkles size={12} className="text-amber-500" />}
                    <button 
                      onClick={() => {
                        const client = clients.find(c => c.id === opp.client_id) || null;
                        onContactOpp(opp, client);
                      }}
                      className="flex items-center gap-1.5 px-3 py-1 bg-indigo-600 text-white text-[10px] font-bold rounded-lg hover:bg-indigo-700 transition-all shadow-sm"
                    >
                      <MessageSquare size={12} />
                      Contatar
                    </button>
                  </div>
                </div>
              </div>
            ))}
            {opportunities.length === 0 && (
              <div className="text-center py-12 text-gray-400 italic text-sm">
                Nenhuma oportunidade detectada no momento.
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Recent Activity */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="p-6 border-b border-gray-50 flex items-center justify-between">
            <h3 className="font-bold text-gray-800">Trabalhos Recentes</h3>
            <button className="text-sm text-indigo-600 font-medium hover:underline">Ver todos</button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider">
                <tr>
                  <th className="px-6 py-4 font-medium">Cliente</th>
                  <th className="px-6 py-4 font-medium">Tipo</th>
                  <th className="px-6 py-4 font-medium">Data</th>
                  <th className="px-6 py-4 font-medium">Valor</th>
                  <th className="px-6 py-4 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {jobs.slice(0, 5).map((job) => (
                  <tr key={job.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4 font-medium">{job.client_name || job.job_name || 'Tarefa'}</td>
                    <td className="px-6 py-4 text-gray-600">{job.job_type}</td>
                    <td className="px-6 py-4 text-gray-500">
  {job.job_date && !isNaN(new Date(job.job_date).getTime())
    ? format(new Date(job.job_date), 'dd/MM/yyyy')
    : '-'}
</td>
                    <td className="px-6 py-4 font-semibold">R$ {(job.amount ?? 0).toLocaleString('pt-BR')}</td>
                    <td className="px-6 py-4">
                      <span className={cn(
                        "px-2 py-1 rounded-full text-[10px] font-bold uppercase",
                        job.payment_status === 'paid' ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                      )}>
                        {job.payment_status === 'paid' ? 'Pago' : 'Pendente'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

                <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm">
          <h3 className="font-bold text-gray-800 mb-2">Faturamento Futuro</h3>
          <p className="text-sm text-gray-500 mb-6">
            Baseado nos ensaios já agendados.
          </p>

          <div className="grid grid-cols-1 gap-3 mb-6">
            <div className="p-4 rounded-xl bg-green-50 border border-green-100">
              <div className="text-xs font-bold uppercase text-green-700 mb-1">Próximos 30 dias</div>
              <div className="text-2xl font-bold text-green-800">
                R$ {futureRevenue30.toLocaleString('pt-BR')}
              </div>
            </div>

            <div className="p-4 rounded-xl bg-blue-50 border border-blue-100">
              <div className="text-xs font-bold uppercase text-blue-700 mb-1">Próximos 90 dias</div>
              <div className="text-2xl font-bold text-blue-800">
                R$ {futureRevenue90.toLocaleString('pt-BR')}
              </div>
            </div>
          </div>

          <div className="space-y-3">
            {futureRevenueByMonth.length > 0 ? (
              futureRevenueByMonth.map((item) => (
                <div key={item.month} className="flex items-center justify-between text-sm border-b border-gray-50 pb-2">
                  <span className="text-gray-600 font-medium">{item.label}</span>
                  <span className="font-bold text-gray-900">
                    R$ {item.total.toLocaleString('pt-BR')}
                  </span>
                </div>
              ))
            ) : (
              <div className="text-sm text-gray-400 italic">
                Nenhum faturamento futuro encontrado.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ title, value, icon, trend, trendUp }: { title: string, value: string | number, icon: React.ReactNode, trend: string, trendUp: boolean }) {
  return (
    <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div className="w-12 h-12 bg-gray-50 rounded-xl flex items-center justify-center">
          {icon}
        </div>
        {trend ? (
          <div className={cn(
            "flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-lg",
            trendUp ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-600"
          )}>
            {trendUp ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
            {trend}
          </div>
        ) : null}
      </div>
      <p className="text-gray-500 text-sm font-medium">{title}</p>
      <h4 className="text-2xl font-bold mt-1">{value}</h4>
    </div>
  );
}

// --- Clients Component ---
function Clients({ clients, onUpdate, onContactOpp }: { clients: Client[], onUpdate: () => void, onContactOpp: (opp: Opportunity, client: Client | null) => void }) {
  const [showModal, setShowModal] = useState(false);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [lastContactFilter, setLastContactFilter] = useState<string>('all');
  const [customMonth, setCustomMonth] = useState<string>('');
  const [customYear, setCustomYear] = useState<string>('');
  const [customDay, setCustomDay] = useState<string>('');
  const [searchName, setSearchName] = useState('');
  const [jobTypeFilter, setJobTypeFilter] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(50);
  const [selectedClientIds, setSelectedClientIds] = useState<number[]>([]);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importTotal, setImportTotal] = useState(0);
  const [importProcessed, setImportProcessed] = useState(0);
  const [importDone, setImportDone] = useState(false);
  const [importSummary, setImportSummary] = useState<{
    importedClientsCount: number;
    updatedClientsCount: number;
    importedJobsCount: number;
    updatedJobsCount: number;
  } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const importIntervalRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

  const handleCloseImportModal = () => {
    setImportModalOpen(false);
    setImportSummary(null);
    setImportError(null);
    setImportProcessed(0);
    setImportDone(false);
  };

  useEffect(() => {
    return () => {
      if (importIntervalRef.current) {
        clearInterval(importIntervalRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (
      importModalOpen &&
      importDone &&
      importProcessed >= importTotal &&
      !importError
    ) {
      const timeout = setTimeout(() => {
        handleCloseImportModal();
      }, 2000);
      return () => clearTimeout(timeout);
    }
  }, [importModalOpen, importDone, importProcessed, importTotal, importError]);

  const handleDelete = async (id: number) => {
    await authFetch(`/api/clients/${id}`, { method: 'DELETE' });
    onUpdate();
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };
  const toggleClientSelection = (clientId: number) => {
  setSelectedClientIds((prev) =>
    prev.includes(clientId)
      ? prev.filter((id) => id !== clientId)
      : [...prev, clientId]
  );
};

const toggleSelectAllVisible = () => {
  const visibleIds = paginatedClients.map((client) => client.id);
  const allVisibleSelected = visibleIds.every((id) => selectedClientIds.includes(id));

  if (allVisibleSelected) {
    setSelectedClientIds((prev) => prev.filter((id) => !visibleIds.includes(id)));
  } else {
    setSelectedClientIds((prev) => Array.from(new Set([...prev, ...visibleIds])));
  }
};

const handleDeleteSelected = async () => {
  if (selectedClientIds.length === 0) {
    alert('Selecione pelo menos um cliente.');
    return;
  }

  const confirmed = confirm(`Deseja excluir ${selectedClientIds.length} cliente(s)?`);
  if (!confirmed) return;

  try {
    await Promise.all(
      selectedClientIds.map((id) =>
        authFetch(`/api/clients/${id}`, { method: 'DELETE' })
      )
    );

    setSelectedClientIds([]);
    onUpdate();
  } catch (error) {
    console.error('Erro ao excluir clientes selecionados:', error);
    alert('Ocorreu um erro ao excluir os clientes selecionados.');
  }
};

const handleExportSelectedCSV = () => {
  if (selectedClientIds.length === 0) {
    alert('Selecione pelo menos um cliente.');
    return;
  }

  const selectedClients = clients.filter((client) => selectedClientIds.includes(client.id));

  const headers = ['id', 'name', 'phone', 'email', 'instagram', 'status', 'tier', 'total_invested'];

  const csvRows = [
    headers.join(','),
    ...selectedClients.map((client) =>
      [
        client.id,
        `"${client.name || ''}"`,
        `"${client.phone || ''}"`,
        `"${client.email || ''}"`,
        `"${client.instagram || ''}"`,
        `"${client.status || ''}"`,
        `"${client.tier || ''}"`,
        client.total_invested ?? 0
      ].join(',')
    )
  ];

  const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', 'clientes_selecionados.csv');
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  URL.revokeObjectURL(url);
};

  const getActivityDates = (client: Client) => {
    const dates: Date[] = [];
    const contactDate = parseDate(client.last_contact_date);
    if (contactDate) dates.push(contactDate);
    
    if (client.jobs) {
      client.jobs.forEach(j => {
        const jobDate = parseDate(j.job_date);
        if (jobDate) dates.push(jobDate);
      });
    }
    return dates;
  };

  const getLatestActivityDate = (client: Client) => {
    const dates = getActivityDates(client);
    if (dates.length === 0) return null;
    return new Date(Math.max(...dates.map(d => d.getTime())));
  };

    const filteredClients = clients.filter(client => {
    const activityDates = getActivityDates(client);

    const matchesSearchName = client.name
      ?.toLowerCase()
      .includes(searchName.trim().toLowerCase());

    if (!matchesSearchName) return false;

    if (jobTypeFilter !== 'all') {
      const hasMatchingJobType = client.jobs?.some(job => job.job_type === jobTypeFilter);
      if (!hasMatchingJobType) return false;
    }

    if (customMonth || customYear || customDay) {
      if (activityDates.length === 0) return false;
      return activityDates.some(date => {
        const monthMatch = customMonth ? (date.getMonth() + 1).toString() === customMonth : true;
        const yearMatch = customYear ? date.getFullYear().toString() === customYear : true;
        const dayMatch = customDay ? date.getDate().toString() === customDay : true;
        return monthMatch && yearMatch && dayMatch;
      });
    }

    if (lastContactFilter === 'all') return true;

    const latestDate = getLatestActivityDate(client);
    if (!latestDate) return false;

    const now = new Date();
    const diffDays = Math.floor((now.getTime() - latestDate.getTime()) / (1000 * 60 * 60 * 24));

    if (lastContactFilter === '7days') return diffDays <= 7;
    if (lastContactFilter === '30days') return diffDays <= 30;
    if (lastContactFilter === '90days') return diffDays <= 90;
    return true;
  });

  const totalPages = Math.max(1, Math.ceil(filteredClients.length / itemsPerPage));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const startIndex = (safeCurrentPage - 1) * itemsPerPage;
  const paginatedClients = filteredClients.slice(startIndex, startIndex + itemsPerPage);
  const visibleClientIds = paginatedClients.map((client) => client.id);
const allVisibleSelected =
  visibleClientIds.length > 0 &&
  visibleClientIds.every((id) => selectedClientIds.includes(id));

const jobTypeOptions = [
  'Gestante',
  'Newborn',
  'Acompanhamento',
  'Smash the Cake',
  'Aniversário',
  'Batizado',
  'Família',
  'Marca Pessoal',
  'Natal',
  'Evento Externo',
  'Outros'
];

useEffect(() => {
  setCurrentPage(1);
}, [searchName, jobTypeFilter, lastContactFilter, customMonth, customYear, customDay, itemsPerPage]);

const getTierColor = (tier: string) => {
    switch (tier) {
      case 'Diamond': return 'bg-blue-100 text-blue-700 border-blue-200';
      case 'Platinum': return 'bg-purple-100 text-purple-700 border-purple-200';
      case 'Gold': return 'bg-amber-100 text-amber-700 border-amber-200';
      case 'Silver': return 'bg-slate-200 text-slate-700 border-slate-300';
      default: return 'bg-orange-100 text-orange-700 border-orange-200';
    }
  };

  const handleExportCSV = () => {
    window.open('/api/clients/export/csv', '_blank');
  };

  const handleImportCSV = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const csvData = event.target?.result;
      if (typeof csvData !== 'string') return;

      const totalRows = Math.max(
        1,
        csvData
          .split(/\r?\n/)
          .filter((line) => line.trim().length > 0).length - 1
      );
      setImportTotal(totalRows);
      setImportProcessed(0);
      setImportDone(false);
      setImportSummary(null);
      setImportError(null);
      setImportModalOpen(true);

      if (importIntervalRef.current) clearInterval(importIntervalRef.current);
      importIntervalRef.current = setInterval(() => {
        setImportProcessed((prev) => {
          const next = prev + Math.max(1, Math.floor(totalRows / 40));
          return Math.min(totalRows - 1, next);
        });
      }, 150);

      try {
        const res = await authFetch('/api/clients/import/csv', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ csvData })
        });
        const data = await res.json();
        if (data.success) {
          setImportProcessed(totalRows);
          setImportDone(true);
          setImportSummary({
            importedClientsCount: data.importedClientsCount,
            updatedClientsCount: data.updatedClientsCount,
            importedJobsCount: data.importedJobsCount,
            updatedJobsCount: data.updatedJobsCount,
          });
          onUpdate();
        } else {
          throw new Error(data.error || 'Erro ao importar CSV');
        }
      } catch (error) {
        console.error('Error importing CSV:', error);
        setImportDone(true);
        setImportError('Erro ao importar CSV. Verifique o formato do arquivo.');
      } finally {
        if (importIntervalRef.current) {
          clearInterval(importIntervalRef.current);
          importIntervalRef.current = null;
        }
        setImportProcessed(totalRows);
      }
    };
    reader.readAsText(file);
    // Reset input
    e.target.value = '';
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-2xl font-bold text-gray-800">Clientes</h3>
          <p className="text-gray-500 mt-1">Gerencie sua base de contatos e histórico.</p>
          <p className="text-sm text-gray-500 mt-2">
            <span className="font-semibold text-gray-700">{paginatedClients.length}</span> contatos exibidos de <span className="font-semibold text-gray-700">{clients.length}</span> na base
            {filteredClients.length !== clients.length && (
              <span> · <span className="font-semibold text-gray-700">{filteredClients.length}</span> encontrados com os filtros</span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
  <div className="relative">
    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
    <input
      type="text"
      value={searchName}
      onChange={(e) => setSearchName(e.target.value)}
      placeholder="Buscar por nome do cliente..."
      className="pl-9 pr-4 py-2 bg-white border border-gray-200 rounded-xl shadow-sm outline-none text-sm text-gray-700 w-72"
    />
  </div>

  <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-3 py-2 shadow-sm">
    <FileText size={16} className="text-gray-400" />
    <select
      value={jobTypeFilter}
      onChange={(e) => setJobTypeFilter(e.target.value)}
      className="text-sm bg-transparent border-none outline-none text-gray-600 font-medium"
    >
      <option value="all">Todos os ensaios</option>
      {jobTypeOptions.map((jobType) => (
        <option key={jobType} value={jobType}>{jobType}</option>
      ))}
    </select>
  </div>

  <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-3 py-2 shadow-sm">
    <Filter size={16} className="text-gray-400" />
    <select 
      value={lastContactFilter}
      onChange={(e) => {
        setLastContactFilter(e.target.value);
        setCustomMonth('');
        setCustomYear('');
        setCustomDay('');
      }}
      className="text-sm bg-transparent border-none outline-none text-gray-600 font-medium"
    >
      <option value="all">Último Contato: Todos</option>
      <option value="7days">Últimos 7 dias</option>
      <option value="30days">Últimos 30 dias</option>
      <option value="90days">Últimos 90 dias</option>
      <option value="custom">Personalizado...</option>
    </select>
  </div>

  <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-3 py-2 shadow-sm">
    <span className="text-sm text-gray-500 font-medium">Por página</span>
    <select
      value={itemsPerPage}
      onChange={(e) => setItemsPerPage(Number(e.target.value))}
      className="text-sm bg-transparent border-none outline-none text-gray-600 font-medium"
    >
      <option value={50}>50</option>
      <option value={100}>100</option>
      <option value={200}>200</option>
    </select>
  </div>

  <button
    onClick={() => {
      setSearchName('');
      setJobTypeFilter('all');
      setLastContactFilter('all');
      setCustomMonth('');
      setCustomYear('');
      setCustomDay('');
      setCurrentPage(1);
    }}
    className="px-3 py-2 text-sm text-indigo-600 font-bold hover:bg-indigo-50 rounded-xl transition-colors"
  >
    Limpar filtros
  </button>

          {lastContactFilter === 'custom' && (
            <motion.div 
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              className="flex items-center gap-2"
            >
              <select 
                value={customMonth}
                onChange={(e) => setCustomMonth(e.target.value)}
                className="text-sm bg-white border border-gray-200 rounded-xl px-3 py-2 shadow-sm outline-none text-gray-600 font-medium"
              >
                <option value="">Mês (Todos)</option>
                {Array.from({ length: 12 }, (_, i) => (
                  <option key={i + 1} value={i + 1}>{format(new Date(2024, i, 1), 'MMMM', { locale: ptBR })}</option>
                ))}
              </select>
              <select 
                value={customYear}
                onChange={(e) => setCustomYear(e.target.value)}
                className="text-sm bg-white border border-gray-200 rounded-xl px-3 py-2 shadow-sm outline-none text-gray-600 font-medium"
              >
                <option value="">Ano (Todos)</option>
                <option value="2026">2026</option>
                <option value="2025">2025</option>
                <option value="2024">2024</option>
                <option value="2023">2023</option>
                <option value="2022">2022</option>
              </select>
              <select 
                value={customDay}
                onChange={(e) => setCustomDay(e.target.value)}
                className="text-sm bg-white border border-gray-200 rounded-xl px-3 py-2 shadow-sm outline-none text-gray-600 font-medium"
              >
                <option value="">Dia (Todos)</option>
                {Array.from({ length: 31 }, (_, i) => (
                  <option key={i + 1} value={i + 1}>{i + 1}</option>
                ))}
              </select>
              {(customMonth || customYear || customDay) && (
                <button 
                  onClick={() => {
                    setCustomMonth('');
                    setCustomYear('');
                    setCustomDay('');
                  }}
                  className="text-xs text-indigo-600 font-bold hover:underline px-2"
                >
                  Limpar
                </button>
              )}
            </motion.div>
          )}

          <button 
            onClick={onUpdate}
            className="p-2 text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition-colors"
            title="Atualizar lista"
          >
            <RefreshCw size={20} />
          </button>
          
          <div className="flex items-center gap-2">
  <div className="flex bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
    <button 
      onClick={handleExportCSV}
      className="p-2 text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 transition-colors border-r border-gray-100"
      title="Exportar todos os clientes (CSV)"
    >
      <Download size={20} />
    </button>

    <button 
      onClick={handleExportSelectedCSV}
      className="p-2 text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 transition-colors border-r border-gray-100"
      title="Exportar clientes selecionados"
    >
      <FileText size={20} />
    </button>

    <label className="p-2 text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 transition-colors cursor-pointer" title="Importar Clientes (CSV)">
      <Upload size={20} />
      <input 
        type="file" 
        accept=".csv" 
        onChange={handleImportCSV} 
        className="hidden" 
      />
    </label>
  </div>

  <button
    onClick={handleDeleteSelected}
    disabled={selectedClientIds.length === 0}
    className="px-3 py-2 rounded-xl border border-red-200 text-red-600 font-semibold hover:bg-red-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
  >
    Excluir selecionados
  </button>
</div>

          <button 
            onClick={() => { setSelectedClient(null); setShowModal(true); }}
            className="bg-indigo-600 text-white px-4 py-2 rounded-xl font-semibold flex items-center gap-2 hover:bg-indigo-700 transition-colors"
          >
            <Plus size={20} />
            Novo Cliente
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {selectedClientIds.length > 0 && (
  <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-indigo-50">
    <div className="text-sm font-semibold text-indigo-700">
      {selectedClientIds.length} cliente(s) selecionado(s)
    </div>

    <div className="flex items-center gap-2">
      <button
        onClick={handleExportSelectedCSV}
        className="px-3 py-2 text-sm font-semibold text-indigo-600 bg-white border border-indigo-200 rounded-xl hover:bg-indigo-50"
      >
        Exportar selecionados
      </button>

      <button
        onClick={handleDeleteSelected}
        className="px-3 py-2 text-sm font-semibold text-red-600 bg-white border border-red-200 rounded-xl hover:bg-red-50"
      >
        Excluir selecionados
      </button>

      <button
        onClick={() => setSelectedClientIds([])}
        className="px-3 py-2 text-sm font-semibold text-gray-600 bg-white border border-gray-200 rounded-xl hover:bg-gray-50"
      >
        Limpar seleção
      </button>
    </div>
  </div>
)}
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider">
  <tr>
    <th className="px-4 py-4 font-medium w-12">
      <input
        type="checkbox"
        checked={allVisibleSelected}
        onChange={toggleSelectAllVisible}
        className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
      />
    </th>
    <th className="px-6 py-4 font-medium">Nome / Nível</th>
    <th className="px-6 py-4 font-medium">Contato</th>
    <th className="px-6 py-4 font-medium">Investimento</th>
    <th className="px-6 py-4 font-medium">Status</th>
    <th className="px-6 py-4 font-medium text-right">Ações</th>
  </tr>
</thead>
            <tbody className="divide-y divide-gray-50">
              {paginatedClients.map((client) => (
                <tr key={client.id} className="hover:bg-gray-50 transition-colors group">
                  <td className="px-4 py-4">
  <input
    type="checkbox"
    checked={selectedClientIds.includes(client.id)}
    onChange={() => toggleClientSelection(client.id)}
    className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
  />
</td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <div className="font-semibold text-gray-900">{client.name}</div>
                      <span className={cn(
                        "text-[10px] font-bold px-2 py-0.5 rounded border uppercase",
                        getTierColor(client.tier || 'Bronze')
                      )}>
                        {client.tier}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1 mt-1">
                      <div className="text-xs text-gray-500">Desde {format(parseDate(client.created_at) || new Date(), 'MMM yyyy', { locale: ptBR })}</div>
                      
                      {/* Show matching jobs if filtering */}
                      {(customMonth || customYear || customDay) && client.jobs?.filter(j => {
                        const date = parseDate(j.job_date);
                        if (!date) return false;
                        const monthMatch = customMonth ? (date.getMonth() + 1).toString() === customMonth : true;
                        const yearMatch = customYear ? date.getFullYear().toString() === customYear : true;
                        const dayMatch = customDay ? date.getDate().toString() === customDay : true;
                        return monthMatch && yearMatch && dayMatch;
                      }).map(job => (
                        <div key={job.id} className="flex items-center gap-1 bg-indigo-50 text-indigo-700 text-[9px] font-bold px-1.5 py-0.5 rounded border border-indigo-100">
                          <CheckCircle2 size={10} />
                          {job.job_type} ({format(parseDate(job.job_date)!, 'dd/MM/yy')})
                        </div>
                      ))}

                      {client.opportunities?.map((opp) => (
                        <button 
                          key={opp.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            onContactOpp(opp, client);
                          }}
                          className={cn(
                            "flex items-center gap-1.5 text-[10px] font-bold px-2.5 py-1 rounded-lg border transition-all animate-pulse shadow-md",
                            opp.priority === 'urgent' ? "bg-red-600 text-white border-red-700" : 
                            opp.priority === 'active' ? "bg-amber-600 text-white border-amber-700" :
                            "bg-indigo-600 text-white border-indigo-700"
                          )}
                          title={`Sugerido para: ${format(new Date(opp.suggested_date), 'dd/MM/yyyy')}`}
                        >
                          <Sparkles size={12} />
                          <span className="uppercase tracking-wider">Oportunidade: {opp.type}</span>
                        </button>
                      ))}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2 group/phone">
                      <div className="text-sm text-gray-700">{client.phone}</div>
                      <button 
                        onClick={() => copyToClipboard(client.phone)}
                        className="p-1 text-gray-400 hover:text-indigo-600 opacity-0 group-hover/phone:opacity-100 transition-opacity"
                        title="Copiar WhatsApp"
                      >
                        <Copy size={14} />
                      </button>
                    </div>
                    <div className="text-xs text-gray-500">{client.email}</div>
                    {getLatestActivityDate(client) && (
                      <div className="text-[10px] text-indigo-500 font-medium mt-1">
                        Última atividade: {format(getLatestActivityDate(client)!, 'dd/MM/yyyy')}
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <div className="font-semibold text-gray-900">R$ {(client.total_invested ?? 0).toLocaleString('pt-BR')}</div>
                    <div className="text-xs text-gray-500">{client.jobs?.length || 0} trabalhos realizados</div>
                  </td>
                  <td className="px-6 py-4">
                    <span className={cn(
                      "px-2 py-1 rounded-full text-[10px] font-bold uppercase",
                      client.status === 'active' ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-600"
                    )}>
                      {client.status === 'active' ? 'Ativo' : 'Inativo'}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button 
                        onClick={() => { setSelectedClient(client); setShowModal(true); }}
                        className="p-2 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg"
                        title="Editar Perfil"
                      >
                        <Edit2 size={18} />
                      </button>
                      <button 
                        onClick={() => handleDelete(client.id)}
                        className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                        title="Excluir Cliente"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
                </div>

        <div className="flex flex-col md:flex-row items-center justify-between gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50/50">
          <div className="text-sm text-gray-500">
            <span className="font-bold text-gray-700">{paginatedClients.length}</span> contatos exibidos de <span className="font-bold text-gray-700">{clients.length}</span> na base
            {filteredClients.length !== clients.length && (
              <span> · <span className="font-bold text-gray-700">{filteredClients.length}</span> encontrados com os filtros</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              disabled={safeCurrentPage === 1}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              className="px-3 py-2 text-sm font-medium rounded-xl border border-gray-200 bg-white disabled:opacity-40"
            >
              Anterior
            </button>

            <div className="px-3 py-2 text-sm font-bold text-gray-700">
              Página {safeCurrentPage} de {totalPages}
            </div>

            <button
              disabled={safeCurrentPage === totalPages}
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              className="px-3 py-2 text-sm font-medium rounded-xl border border-gray-200 bg-white disabled:opacity-40"
            >
              Próxima
            </button>
          </div>
        </div>
      </div>

      {showModal && (
        <ClientModal 
          client={selectedClient} 
          onClose={() => setShowModal(false)} 
          onSave={() => { setShowModal(false); onUpdate(); }} 
          onContactOpp={onContactOpp}
        />
      )}

      <ImportProgressModal
        open={importModalOpen}
        total={importTotal}
        processed={importProcessed}
        done={importDone}
        summary={importSummary}
        error={importError}
        onClose={handleCloseImportModal}
      />
    </div>
  );
}

function ClientModal({ client: initialClient, onClose, onSave, onContactOpp }: { client: Client | null, onClose: () => void, onSave: () => void, onContactOpp: (opp: Opportunity, client: Client | null) => void }) {
  const [activeTab, setActiveTab] = useState<'info' | 'history' | 'opportunities'>('info');
  const [client, setClient] = useState<Client | null>(initialClient);
  const [showJobModal, setShowJobModal] = useState(false);
  const [editingJob, setEditingJob] = useState<Job | null>(null);
  const [formData, setFormData] = useState({
    name: initialClient?.name || '',
    phone: initialClient?.phone || '',
    email: initialClient?.email || '',
    birth_date: initialClient?.birth_date || '',
    cpf: initialClient?.cpf || '',
    cep: initialClient?.cep || '',
    address: initialClient?.address || '',
    neighborhood: initialClient?.neighborhood || '',
    city: initialClient?.city || '',
    state: initialClient?.state || '',
    age: initialClient?.age ?? '',
    child_name: initialClient?.child_name || '',
    instagram: initialClient?.instagram || '',
    closing_date: initialClient?.closing_date || '',
    first_contact_date: initialClient?.first_contact_date || '',
    last_contact_date: initialClient?.last_contact_date || '',
    notes: initialClient?.notes || '',
    lead_source: initialClient?.lead_source || 'Instagram',
    status: initialClient?.status || 'active'
  });

  useEffect(() => {
    if (initialClient) {
      fetchClientDetails();
    }
  }, [initialClient]);

  useEffect(() => {
    if (formData.birth_date) {
      const birthDate = new Date(formData.birth_date);
      const today = new Date();
      let age = today.getFullYear() - birthDate.getFullYear();
      const monthDiff = today.getMonth() - birthDate.getMonth();
      if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
        age--;
      }
      if (age >= 0 && age !== formData.age) {
        setFormData(prev => ({ ...prev, age }));
      }
    }
  }, [formData.birth_date]);

  useEffect(() => {
    const cep = formData.cep.replace(/\D/g, '');
    if (cep.length === 8) {
      const fetchAddress = async () => {
        try {
          const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
          const data = await res.json();
          if (!data.erro) {
            setFormData(prev => ({
              ...prev,
              address: data.logradouro,
              neighborhood: data.bairro,
              city: data.localidade,
              state: data.uf
            }));
          }
        } catch (error) {
          console.error("Erro ao buscar CEP:", error);
        }
      };
      fetchAddress();
    }
  }, [formData.cep]);

  const fetchClientDetails = async () => {
    if (!initialClient) return;
    const res = await authFetch(`/api/clients/${initialClient.id}`);
    setClient(await res.json());
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const method = initialClient ? 'PUT' : 'POST';
    const url = initialClient ? `/api/clients/${initialClient.id}` : '/api/clients';
    
    try {
      const response = await authFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });
      
      if (!response.ok) {
        throw new Error('Erro ao salvar cliente');
      }
      
      onSave();
    } catch (error) {
      console.error('Erro ao salvar:', error);
      alert('Ocorreu um erro ao salvar o cliente. Por favor, tente novamente.');
    }
  };

  const handleJobSaved = async () => {
    setShowJobModal(false);
    setEditingJob(null);
    await fetchClientDetails();
    onSave();
  };

  const handleEditJob = (job: Job) => {
    setEditingJob(job);
    setShowJobModal(true);
  };

  const handleDeleteJob = async (jobId: number) => {
    await authFetch(`/api/jobs/${jobId}`, { method: 'DELETE' });
    await fetchClientDetails();
    onSave();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && e.target instanceof HTMLInputElement && e.target.type !== 'submit') {
      e.preventDefault();
      const form = e.currentTarget as HTMLFormElement;
      const elements = Array.from(form.elements).filter(el => 
        (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) && 
        !el.disabled && el.type !== 'hidden'
      ) as HTMLElement[];
      
      const index = elements.indexOf(e.target as any);
      if (index > -1 && index < elements.length - 1) {
        elements[index + 1].focus();
      }
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <motion.div 
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl overflow-hidden max-h-[90vh] flex flex-col"
      >
        <div className="p-6 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
          <div className="flex items-center gap-4">
            <h3 className="text-xl font-bold">{initialClient ? 'Perfil do Cliente' : 'Novo Cliente'}</h3>
            {client?.tier && (
              <span className="text-xs font-bold px-2 py-0.5 rounded border border-indigo-200 bg-indigo-50 text-indigo-700 uppercase">
                Nível {client.tier}
              </span>
            )}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <Plus className="rotate-45" size={24} />
          </button>
        </div>

        {initialClient && (
          <div className="flex border-b border-gray-100 px-6 bg-white">
            <button 
              onClick={() => setActiveTab('info')}
              className={cn(
                "px-4 py-3 text-sm font-semibold transition-colors border-b-2",
                activeTab === 'info' ? "border-indigo-600 text-indigo-600" : "border-transparent text-gray-400"
              )}
            >
              Dados Pessoais
            </button>
            <button 
              onClick={() => setActiveTab('history')}
              className={cn(
                "px-4 py-3 text-sm font-semibold transition-colors border-b-2",
                activeTab === 'history' ? "border-indigo-600 text-indigo-600" : "border-transparent text-gray-400"
              )}
            >
              Histórico de Trabalhos
            </button>
            <button 
              onClick={() => setActiveTab('opportunities')}
              className={cn(
                "px-4 py-3 text-sm font-semibold transition-colors border-b-2",
                activeTab === 'opportunities' ? "border-indigo-600 text-indigo-600" : "border-transparent text-gray-400"
              )}
            >
              Oportunidades
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === 'info' ? (
            <form onSubmit={handleSubmit} onKeyDown={handleKeyDown} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="md:col-span-2">
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Nome Completo</label>
                  <input 
                    required
                    type="text" 
                    value={formData.name}
                    onChange={e => setFormData({...formData, name: e.target.value})}
                    className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">CPF</label>
                  <input 
                    type="text" 
                    value={formData.cpf}
                    onChange={e => setFormData({...formData, cpf: e.target.value})}
                    placeholder="000.000.000-00"
                    className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>
                
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Telefone</label>
                  <input 
                    type="text" 
                    value={formData.phone}
                    onChange={e => setFormData({...formData, phone: e.target.value})}
                    className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">E-mail</label>
                  <input 
                    type="email" 
                    value={formData.email}
                    onChange={e => setFormData({...formData, email: e.target.value})}
                    className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Instagram</label>
                  <input 
                    type="text" 
                    value={formData.instagram}
                    onChange={e => setFormData({...formData, instagram: e.target.value})}
                    placeholder="@usuario"
                    className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Data de Nascimento</label>
                  <input 
                    type="date" 
                    value={formData.birth_date}
                    onChange={e => setFormData({...formData, birth_date: e.target.value})}
                    className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Idade</label>
                  <input 
                    type="number" 
                    value={formData.age}
                    onChange={e => setFormData({...formData, age: e.target.value === '' ? '' : Number(e.target.value)})}
                    className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Nome do Filho(a)</label>
                  <input 
                    type="text" 
                    value={formData.child_name}
                    onChange={e => setFormData({...formData, child_name: e.target.value})}
                    className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">CEP</label>
                  <input 
                    type="text" 
                    value={formData.cep}
                    onChange={e => setFormData({...formData, cep: e.target.value})}
                    className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Endereço</label>
                  <input 
                    type="text" 
                    value={formData.address}
                    onChange={e => setFormData({...formData, address: e.target.value})}
                    className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Bairro</label>
                  <input 
                    type="text" 
                    value={formData.neighborhood}
                    onChange={e => setFormData({...formData, neighborhood: e.target.value})}
                    className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Cidade</label>
                  <input 
                    type="text" 
                    value={formData.city}
                    onChange={e => setFormData({...formData, city: e.target.value})}
                    className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">UF</label>
                  <input 
                    type="text" 
                    value={formData.state}
                    onChange={e => setFormData({...formData, state: e.target.value})}
                    maxLength={2}
                    className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none uppercase"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Data de Fechamento</label>
                  <input 
                    type="date" 
                    value={formData.closing_date}
                    onChange={e => setFormData({...formData, closing_date: e.target.value})}
                    className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Origem do Lead</label>
                  <select 
                    value={formData.lead_source}
                    onChange={e => setFormData({...formData, lead_source: e.target.value})}
                    className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
                  >
                    <option>Instagram</option>
                    <option>WhatsApp</option>
                    <option>Patrocinado</option>
                    <option>Indicação</option>
                    <option>Google</option>
                    <option>Outros</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Status</label>
                  <select 
                    value={formData.status}
                    onChange={e => setFormData({...formData, status: e.target.value})}
                    className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
                  >
                    <option value="active">Ativo</option>
                    <option value="inactive">Inativo</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Observações</label>
                <textarea 
                  rows={3}
                  value={formData.notes}
                  onChange={e => setFormData({...formData, notes: e.target.value})}
                  className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none resize-none"
                />
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <button type="button" onClick={onClose} className="px-6 py-2 text-gray-600 font-medium">Cancelar</button>
                <button type="submit" className="px-8 py-2 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-colors">
                  {initialClient ? 'Salvar Alterações' : 'Salvar Cliente'}
                </button>
              </div>
            </form>
          ) : activeTab === 'history' ? (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h4 className="font-bold text-gray-800">Trabalhos Realizados</h4>
                <button 
                  onClick={() => { setEditingJob(null); setShowJobModal(true); }}
                  className="text-sm bg-indigo-600 text-white px-4 py-2 rounded-xl font-bold flex items-center gap-2 hover:bg-indigo-700 transition-colors"
                >
                  <Plus size={16} /> Registrar Novo Trabalho
                </button>
              </div>

              <div className="space-y-3">
                {client?.jobs?.map(job => (
                  <div key={job.id} className="flex items-center justify-between p-4 bg-white border border-gray-100 rounded-xl shadow-sm hover:border-indigo-200 transition-colors">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 bg-indigo-50 rounded-lg flex items-center justify-center text-indigo-600">
                        <Camera size={20} />
                      </div>
                      <div>
                        <div className="font-bold text-gray-900">{job.job_name}</div>
                        <div className="text-xs text-gray-500">{job.job_type} • {job.job_date && !isNaN(new Date(job.job_date).getTime())
  ? format(new Date(job.job_date), 'dd/MM/yyyy')
  : '-'}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <div className="font-bold text-gray-900">R$ {(job.amount ?? 0).toLocaleString('pt-BR')}</div>
                        <div className="flex items-center gap-2 justify-end">
                          <span className={cn(
                            "text-[10px] font-bold uppercase px-2 py-0.5 rounded",
                            job.status === 'completed' ? "bg-emerald-100 text-emerald-700" : 
                            job.status === 'cancelled' ? "bg-red-100 text-red-700" : 
                            "bg-blue-100 text-blue-700"
                          )}>
                            {job.status === 'completed' ? 'Concluído' : job.status === 'cancelled' ? 'Cancelado' : 'Agendado'}
                          </span>
                          <div className="text-[10px] font-bold uppercase text-gray-400">{job.payment_method} • {job.payment_status === 'paid' ? 'Pago' : 'Pendente'}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        {job.status === 'scheduled' && (
                          <button 
                            onClick={async () => {
                              await authFetch(`/api/jobs/${job.id}`, {
                                method: 'PUT',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ ...job, status: 'completed' })
                              });
                              fetchClientDetails();
                              onSave();
                            }}
                            className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                            title="Marcar como Concluído"
                          >
                            <Check size={16} />
                          </button>
                        )}
                        <button 
                          onClick={() => handleEditJob(job)}
                          className="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                          title="Editar"
                        >
                          <Edit2 size={16} />
                        </button>
                        <button 
                          onClick={() => handleDeleteJob(job.id)}
                          className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          title="Excluir"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
                {(!client?.jobs || client.jobs.length === 0) && (
                  <div className="text-center py-12 bg-gray-50 rounded-2xl border border-dashed border-gray-200 text-gray-400 italic">
                    Nenhum trabalho registrado ainda.
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h4 className="font-bold text-gray-800">Oportunidades de Venda</h4>
                <div className="text-xs text-gray-500 italic">Geradas automaticamente com base no histórico</div>
              </div>

              <div className="space-y-3">
                {client?.opportunities?.map(opp => (
                  <div key={opp.id} className={cn(
                    "p-4 rounded-xl border transition-all",
                    opp.priority === 'urgent' ? "bg-red-50/30 border-red-100" : 
                    opp.priority === 'active' ? "bg-amber-50/30 border-amber-100" :
                    "bg-white border-gray-100"
                  )}>
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div className={cn(
                          "w-10 h-10 rounded-lg flex items-center justify-center",
                          opp.priority === 'urgent' ? "bg-red-100 text-red-600" : 
                          opp.priority === 'active' ? "bg-amber-100 text-amber-600" :
                          "bg-indigo-50 text-indigo-600"
                        )}>
                          <Sparkles size={20} />
                        </div>
                        <div>
                          <div className="font-bold text-gray-900">{opp.type}</div>
                          <div className="text-xs text-gray-500">
                            Sugerido para: {format(new Date(opp.suggested_date), 'dd/MM/yyyy')}
                          </div>
                        </div>
                      </div>
                      <div className={cn(
                        "text-[10px] font-bold px-2 py-1 rounded-full uppercase",
                        opp.priority === 'urgent' ? "bg-red-100 text-red-700" : 
                        opp.priority === 'active' ? "bg-amber-100 text-amber-700" :
                        "bg-indigo-100 text-indigo-700"
                      )}>
                        {opp.priority === 'urgent' ? 'Urgente' : opp.priority === 'active' ? 'Ativo' : 'Futuro'}
                      </div>
                    </div>
                    
                    <div className="flex items-center justify-between pt-3 border-t border-gray-100/50">
                      <div className="text-xs font-bold text-gray-400 uppercase">Status: {opp.status}</div>
                      <div className="flex gap-2">
                        <button 
                          onClick={async () => {
                            await authFetch(`/api/opportunities/${opp.id}`, {
                              method: 'PUT',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ status: 'dismissed' })
                            });
                            fetchClientDetails();
                            onSave();
                          }}
                          className="text-xs font-bold text-gray-400 hover:text-red-600 px-3 py-1 rounded-lg hover:bg-red-50 transition-all"
                        >
                          Ignorar
                        </button>
                        <button 
                          onClick={() => {
                            if (client) {
                              onContactOpp(opp, client);
                            }
                          }}
                          className="flex items-center gap-1.5 px-3 py-1 bg-indigo-600 text-white text-[10px] font-bold rounded-lg hover:bg-indigo-700 transition-all shadow-sm"
                        >
                          <MessageSquare size={12} />
                          Contatar
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
                {(!client?.opportunities || client.opportunities.length === 0) && (
                  <div className="text-center py-12 bg-gray-50 rounded-2xl border border-dashed border-gray-200 text-gray-400 italic">
                    Nenhuma oportunidade gerada para este cliente ainda.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </motion.div>

      {showJobModal && client && (
        <JobFormModal 
          clientId={client.id} 
          job={editingJob} 
          onClose={() => { setShowJobModal(false); setEditingJob(null); }} 
          onSave={handleJobSaved} 
        />
      )}

    </div>
  );
}

function JobFormModal({ clientId: initialClientId, job, initialDate, clients = [], onClose, onSave }: { clientId?: number, job: Job | null, initialDate?: string, clients?: Client[], onClose: () => void, onSave: () => void }) {
  const [clientId, setClientId] = useState(initialClientId || job?.client_id || undefined);
  const [formData, setFormData] = useState({
    job_type: job?.job_type || 'Gestante',
    job_date: job?.job_date || initialDate || format(new Date(), 'yyyy-MM-dd'),
    job_time: job?.job_time || '09:00',
    job_end_time: job?.job_end_time || '',
    job_name: job?.job_name || '',
    amount: job ? job.amount : '',
    payment_method: job?.payment_method || 'Pix',
    payment_status: job?.payment_status || 'paid',
    status: job?.status || 'scheduled',
    notes: job?.notes || ''
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const method = job ? 'PUT' : 'POST';
    const url = job ? `/api/jobs/${job.id}` : '/api/jobs';
    
    await authFetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...formData, client_id: clientId })
    });
    onSave();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && e.target instanceof HTMLInputElement && e.target.type !== 'submit') {
      e.preventDefault();
      const form = e.currentTarget as HTMLFormElement;
      const elements = Array.from(form.elements).filter(el => 
        (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) && 
        !el.disabled && el.type !== 'hidden'
      ) as HTMLElement[];
      
      const index = elements.indexOf(e.target as any);
      if (index > -1 && index < elements.length - 1) {
        elements[index + 1].focus();
      }
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
      <motion.div 
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden"
      >
        <div className="p-6 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
          <h3 className="text-lg font-bold text-gray-800">
            {job ? 'Editar Trabalho' : 'Registrar Novo Trabalho'}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <Plus className="rotate-45" size={24} />
          </button>
        </div>
        <form onSubmit={handleSubmit} onKeyDown={handleKeyDown} className="p-6 space-y-4">
          {!initialClientId && !job && (
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Cliente</label>
              <select 
                value={clientId || ''}
                onChange={e => setClientId(e.target.value ? Number(e.target.value) : undefined)}
                className="w-full px-4 py-2 bg-white border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="">Tarefa (Sem Cliente vinculado)</option>
                {clients.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          )}
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Nome do Ensaio/Trabalho</label>
              <input 
                required
                type="text" 
                placeholder="Ex: Ensaio Gestante Maria"
                value={formData.job_name}
                onChange={e => setFormData({...formData, job_name: e.target.value})}
                className="w-full px-4 py-2 bg-white border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Tipo</label>
                <select 
                  value={formData.job_type}
                  onChange={e => setFormData({...formData, job_type: e.target.value})}
                  className="w-full px-4 py-2 bg-white border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option>Gestante</option>
                  <option>Newborn</option>
                  <option>Acompanhamento</option>
                  <option>Smash the Cake</option>
                  <option>Aniversário</option>
                  <option>Batizado</option>
                  <option>Família</option>
                  <option>Marca Pessoal</option>
                  <option>Evento Externo</option>
                  <option>Outros</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Status do Ensaio</label>
                <select 
                  value={formData.status}
                  onChange={e => setFormData({...formData, status: e.target.value as any})}
                  className="w-full px-4 py-2 bg-white border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="scheduled">Agendado</option>
                  <option value="completed">Concluído</option>
                  <option value="cancelled">Cancelado</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Data</label>
                <input 
                  required
                  type="date" 
                  value={formData.job_date}
                  onChange={e => setFormData({...formData, job_date: e.target.value})}
                  className="w-full px-4 py-2 bg-white border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Início</label>
                <input 
                  required
                  type="time" 
                  value={formData.job_time}
                  onChange={e => setFormData({...formData, job_time: e.target.value})}
                  className="w-full px-4 py-2 bg-white border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Fim (Opcional)</label>
                <input 
                  type="time" 
                  value={formData.job_end_time}
                  onChange={e => setFormData({...formData, job_end_time: e.target.value})}
                  className="w-full px-4 py-2 bg-white border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Valor (R$)</label>
                <input 
                  type="number" 
                  value={formData.amount}
                  onChange={e => setFormData({...formData, amount: e.target.value === '' ? '' : Number(e.target.value)})}
                  className="w-full px-4 py-2 bg-white border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Pagamento</label>
                <select 
                  value={formData.payment_method}
                  onChange={e => setFormData({...formData, payment_method: e.target.value})}
                  className="w-full px-4 py-2 bg-white border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option>Pix</option>
                  <option>Cartão</option>
                  <option>Dinheiro</option>
                  <option>Boleto</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Observações</label>
              <textarea 
                rows={2}
                value={formData.notes}
                onChange={e => setFormData({...formData, notes: e.target.value})}
                className="w-full px-4 py-2 bg-white border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                placeholder="Detalhes adicionais..."
              />
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-4">
            <button type="button" onClick={onClose} className="px-6 py-2 text-gray-500 font-medium">Cancelar</button>
            <button type="submit" className="px-8 py-2 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-colors">
              {job ? 'Salvar Alterações' : 'Registrar Trabalho'}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

// --- Calendar Component ---
function CalendarPage({ jobs, clients, onUpdate }: { jobs: Job[], clients: Client[], onUpdate: () => void }) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [view, setView] = useState<'day' | 'week' | 'month'>('month');
  const [editingJob, setEditingJob] = useState<Job | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | undefined>(undefined);
  const [showJobModal, setShowJobModal] = useState(false);
  const [draggedJob, setDraggedJob] = useState<Job | null>(null);

  const next = () => {
    if (view === 'month') setCurrentDate(addMonths(currentDate, 1));
    else if (view === 'week') setCurrentDate(addDays(currentDate, 7));
    else setCurrentDate(addDays(currentDate, 1));
  };

  const prev = () => {
    if (view === 'month') setCurrentDate(subMonths(currentDate, 1));
    else if (view === 'week') setCurrentDate(subDays(currentDate, 7));
    else setCurrentDate(subDays(currentDate, 1));
  };

  const handleJobClick = (job: Job, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingJob(job);
    setSelectedDate(undefined);
    setShowJobModal(true);
  };

  const handleDayClick = (date: Date) => {
    setEditingJob(null);
    setSelectedDate(format(date, 'yyyy-MM-dd'));
    setShowJobModal(true);
  };

  const handleDragStart = (e: React.DragEvent, job: Job) => {
    setDraggedJob(job);
    e.dataTransfer.setData('jobId', job.id.toString());
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDrop = async (e: React.DragEvent, date: Date) => {
    e.preventDefault();
    if (!draggedJob) return;

    const newDate = format(date, 'yyyy-MM-dd');
    if (draggedJob.job_date === newDate) return;

    try {
      await authFetch(`/api/jobs/${draggedJob.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...draggedJob,
          job_date: newDate
        })
      });
      onUpdate();
    } catch (error) {
      console.error('Erro ao reagendar:', error);
    } finally {
      setDraggedJob(null);
    }
  };

  const renderMonthView = () => {
    const monthStart = startOfMonth(currentDate);
    const monthEnd = endOfMonth(monthStart);
    const days = eachDayOfInterval({ start: monthStart, end: monthEnd });

    return (
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="grid grid-cols-7 bg-gray-50 border-b border-gray-100">
          {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map(day => (
            <div key={day} className="px-4 py-3 text-center text-xs font-bold text-gray-400 uppercase tracking-widest">{day}</div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {Array.from({ length: monthStart.getDay() }).map((_, i) => (
            <div key={`empty-${i}`} className="h-32 border-b border-r border-gray-50 bg-gray-50/30" />
          ))}
          
          {days.map(day => {
            const dayJobs = jobs.filter(j => {
              const jobDate = parseDate(j.job_date);
              return jobDate && isSameDay(jobDate, day);
            });
            return (
              <div 
                key={day.toString()} 
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => handleDrop(e, day)}
                onClick={() => handleDayClick(day)}
                className="h-32 border-b border-r border-gray-50 p-2 hover:bg-gray-50 transition-colors cursor-pointer group/day"
              >
                <div className="flex items-center justify-between mb-1">
                  <div className={cn(
                    "text-sm font-bold w-7 h-7 flex items-center justify-center rounded-full",
                    isSameDay(day, new Date()) ? "bg-indigo-600 text-white" : "text-gray-400 group-hover/day:text-indigo-600"
                  )}>
                    {format(day, 'd')}
                  </div>
                  <Plus size={14} className="text-gray-300 opacity-0 group-hover/day:opacity-100 transition-opacity" />
                </div>
                <div className="space-y-1 overflow-y-auto max-h-20 scrollbar-hide">
                  {dayJobs.map(job => (
                    <button 
                      key={job.id} 
                      draggable
                      onDragStart={(e) => handleDragStart(e, job)}
                      onClick={(e) => handleJobClick(job, e)}
                      className="w-full text-left text-[10px] p-1 bg-indigo-50 text-indigo-700 rounded border border-indigo-100 truncate font-medium flex items-center gap-1 hover:bg-indigo-100 transition-colors cursor-move"
                    >
                      {job.google_event_id && <CalendarIcon size={10} className="text-indigo-400 shrink-0" />}
                      {job.job_time && (
                        <span className="font-bold shrink-0">
                          {job.job_time}{job.job_end_time ? `-${job.job_end_time}` : ''}
                        </span>
                      )}
                      <span className="truncate">
                        {job.client_name ? `${job.client_name} - ${job.job_type}` : (job.job_name || job.job_type)}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderWeekView = () => {
    const weekStart = startOfWeek(currentDate, { weekStartsOn: 0 });
    const weekEnd = endOfWeek(weekStart, { weekStartsOn: 0 });
    const days = eachDayOfInterval({ start: weekStart, end: weekEnd });

    return (
      <div className="grid grid-cols-1 md:grid-cols-7 gap-4">
        {days.map(day => {
          const dayJobs = jobs.filter(j => {
            const jobDate = parseDate(j.job_date);
            return jobDate && isSameDay(jobDate, day);
          });
          return (
            <div 
              key={day.toString()} 
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => handleDrop(e, day)}
              onClick={() => handleDayClick(day)}
              className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden flex flex-col min-h-[400px] cursor-pointer group/day"
            >
              <div className={cn(
                "p-4 border-b border-gray-50 text-center relative",
                isSameDay(day, new Date()) ? "bg-indigo-50" : "bg-gray-50/50"
              )}>
                <Plus size={16} className="absolute top-4 right-4 text-gray-300 opacity-0 group-hover/day:opacity-100 transition-opacity" />
                <div className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-1">
                  {format(day, 'EEE', { locale: ptBR })}
                </div>
                <div className={cn(
                  "text-xl font-bold inline-flex items-center justify-center w-10 h-10 rounded-full",
                  isSameDay(day, new Date()) ? "bg-indigo-600 text-white" : "text-gray-700"
                )}>
                  {format(day, 'd')}
                </div>
              </div>
              <div className="flex-1 p-3 space-y-3 overflow-y-auto">
                {dayJobs.sort((a, b) => (a.job_time || '').localeCompare(b.job_time || '')).map(job => (
                  <button 
                    key={job.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, job)}
                    onClick={(e) => handleJobClick(job, e)}
                    className="w-full text-left p-3 bg-white border border-gray-100 rounded-xl shadow-sm hover:border-indigo-200 hover:shadow-md transition-all group cursor-move"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full uppercase">
                        {job.job_time || '00:00'}{job.job_end_time ? ` - ${job.job_end_time}` : ''}
                      </span>
                      {job.google_event_id && <CalendarIcon size={12} className="text-indigo-400" />}
                    </div>
                    <div className="font-bold text-gray-900 text-sm mb-1 group-hover:text-indigo-600 transition-colors">
                      {job.client_name || job.job_name || 'Tarefa'}
                    </div>
                    <div className="text-xs text-gray-500 flex items-center gap-1">
                      <Camera size={12} />
                      {job.job_type}
                    </div>
                  </button>
                ))}
                {dayJobs.length === 0 && (
                  <div className="h-full flex items-center justify-center text-gray-300 italic text-xs text-center px-4">
                    Nenhum compromisso
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const renderDayView = () => {
    const dayJobs = jobs.filter(j => {
      const jobDate = parseDate(j.job_date);
      return jobDate && isSameDay(jobDate, currentDate);
    });

    return (
      <div className="max-w-2xl mx-auto space-y-4">
        <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="text-4xl font-bold text-indigo-600">
              {format(currentDate, 'd')}
            </div>
            <div>
              <div className="text-lg font-bold text-gray-800 capitalize">
                {format(currentDate, 'EEEE', { locale: ptBR })}
              </div>
              <div className="text-gray-500">
                {format(currentDate, 'MMMM yyyy', { locale: ptBR })}
              </div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-sm font-bold text-gray-400 uppercase tracking-widest">Compromissos</div>
            <div className="text-2xl font-bold text-gray-900">{dayJobs.length}</div>
          </div>
        </div>

        <div className="space-y-3">
          {dayJobs.sort((a, b) => (a.job_time || '').localeCompare(b.job_time || '')).map(job => (
            <button 
              key={job.id}
              onClick={(e) => handleJobClick(job, e)}
              className="w-full text-left p-5 bg-white border border-gray-100 rounded-2xl shadow-sm hover:border-indigo-200 hover:shadow-md transition-all flex items-center gap-6 group"
            >
              <div className="w-24 text-center border-r border-gray-100 pr-6">
                <div className="text-xl font-bold text-gray-900">{job.job_time || '00:00'}</div>
                {job.job_end_time && <div className="text-xs text-gray-400">até {job.job_end_time}</div>}
                <div className="text-[10px] font-bold text-gray-400 uppercase mt-1">Horário</div>
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <h4 className="text-lg font-bold text-gray-900 group-hover:text-indigo-600 transition-colors">
                    {job.client_name || job.job_name || 'Tarefa'}
                  </h4>
                  {job.google_event_id && <CalendarIcon size={16} className="text-indigo-400" />}
                </div>
                <div className="flex items-center gap-4 text-sm text-gray-500">
                  <div className="flex items-center gap-1.5">
                    <Camera size={16} className="text-gray-400" />
                    {job.job_type}
                  </div>
                  {job.notes && (
                    <div className="flex items-center gap-1.5 truncate max-w-xs">
                      <MessageSquare size={16} className="text-gray-400" />
                      <span className="truncate">{job.notes}</span>
                    </div>
                  )}
                </div>
              </div>
              <ChevronRight className="text-gray-300 group-hover:text-indigo-600 transition-colors" />
            </button>
          ))}
          {dayJobs.length === 0 && (
            <div className="bg-gray-50 rounded-2xl border border-dashed border-gray-200 p-12 text-center">
              <CalendarIcon size={48} className="mx-auto text-gray-300 mb-4" />
              <p className="text-gray-500 font-medium">Nenhum compromisso agendado para este dia.</p>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h3 className="text-2xl font-bold text-gray-800">Agenda</h3>
          <p className="text-gray-500">Controle seus ensaios e compromissos.</p>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <button 
            onClick={() => { setEditingJob(null); setSelectedDate(undefined); setShowJobModal(true); }}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 shadow-md shadow-indigo-100 transition-all"
          >
            <Plus size={20} />
            Novo Compromisso
          </button>

          <div className="flex bg-white p-1 rounded-xl border border-gray-100 shadow-sm">
            <button 
              onClick={() => setView('day')}
              className={cn(
                "px-4 py-1.5 text-sm font-bold rounded-lg transition-all",
                view === 'day' ? "bg-indigo-600 text-white shadow-md" : "text-gray-400 hover:text-gray-600"
              )}
            >
              Dia
            </button>
            <button 
              onClick={() => setView('week')}
              className={cn(
                "px-4 py-1.5 text-sm font-bold rounded-lg transition-all",
                view === 'week' ? "bg-indigo-600 text-white shadow-md" : "text-gray-400 hover:text-gray-600"
              )}
            >
              Semana
            </button>
            <button 
              onClick={() => setView('month')}
              className={cn(
                "px-4 py-1.5 text-sm font-bold rounded-lg transition-all",
                view === 'month' ? "bg-indigo-600 text-white shadow-md" : "text-gray-400 hover:text-gray-600"
              )}
            >
              Mês
            </button>
          </div>

          <div className="flex items-center gap-2 bg-white p-1 rounded-xl border border-gray-100 shadow-sm">
            <button onClick={prev} className="p-2 hover:bg-gray-50 rounded-lg text-gray-600">
              <ChevronRight className="rotate-180" size={20} />
            </button>
            <span className="font-bold text-gray-700 min-w-32 text-center capitalize text-sm">
              {view === 'day' ? format(currentDate, "dd 'de' MMMM", { locale: ptBR }) :
               view === 'week' ? `Semana de ${format(startOfWeek(currentDate, { weekStartsOn: 0 }), 'dd/MM')}` :
               format(currentDate, 'MMMM yyyy', { locale: ptBR })}
            </span>
            <button onClick={next} className="p-2 hover:bg-gray-50 rounded-lg text-gray-600">
              <ChevronRight size={20} />
            </button>
          </div>
          
          <button 
            onClick={() => setCurrentDate(new Date())}
            className="px-4 py-2 bg-white border border-gray-100 rounded-xl text-sm font-bold text-indigo-600 hover:bg-gray-50 shadow-sm transition-all"
          >
            Hoje
          </button>
        </div>
      </div>

      <motion.div
        key={view + currentDate.toISOString()}
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.3 }}
      >
        {view === 'month' && renderMonthView()}
        {view === 'week' && renderWeekView()}
        {view === 'day' && renderDayView()}
      </motion.div>

      {showJobModal && (
        <JobFormModal 
          clients={clients}
          job={editingJob}
          initialDate={selectedDate}
          onClose={() => { setShowJobModal(false); setEditingJob(null); setSelectedDate(undefined); }}
          onSave={() => { setShowJobModal(false); setEditingJob(null); setSelectedDate(undefined); onUpdate(); }}
        />
      )}
    </div>
  );
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
          <div className="bg-white/95 border border-white rounded-[24px] px-5 py-4 shadow-[0_18px_45px_rgba(15,23,42,0.06)]">
            <label className="block text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">Data inicial</label>
            <input
              type="date"
              value={customStartDate}
              onChange={(e) => setCustomStartDate(e.target.value)}
              className="w-full bg-transparent outline-none text-sm font-medium text-gray-700"
            />
          </div>
          <div className="bg-white/95 border border-white rounded-[24px] px-5 py-4 shadow-[0_18px_45px_rgba(15,23,42,0.06)]">
            <label className="block text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">Data final</label>
            <input
              type="date"
              value={customEndDate}
              onChange={(e) => setCustomEndDate(e.target.value)}
              className="w-full bg-transparent outline-none text-sm font-medium text-gray-700"
            />
          </div>
        </div>
      )}

      {totals.unconfiguredJobs > 0 && (
        <div className="bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-100 rounded-[24px] px-5 py-4 text-sm text-amber-800 shadow-[0_12px_28px_rgba(245,158,11,0.08)]">
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
    <div className="relative overflow-hidden rounded-[32px] border border-white/70 bg-gradient-to-br from-slate-900 via-indigo-900 to-sky-900 px-6 py-7 text-white shadow-[0_24px_80px_rgba(30,41,59,0.28)] md:px-8">
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
        : "border border-gray-200 bg-white text-gray-900"
    )}>
      {icon}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          "bg-transparent text-sm font-medium outline-none",
          dark ? "text-white" : "text-gray-700"
        )}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
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
    primary: 'border-indigo-200/70 bg-gradient-to-br from-indigo-600 via-indigo-600 to-blue-600 text-white shadow-[0_20px_45px_rgba(79,70,229,0.22)]',
    indigo: 'border-indigo-100 bg-white text-gray-900',
    teal: 'border-teal-100 bg-white text-gray-900',
    sky: 'border-sky-100 bg-white text-gray-900',
    amber: 'border-amber-100 bg-white text-gray-900',
    violet: 'border-violet-100 bg-white text-gray-900',
    orange: 'border-orange-100 bg-white text-gray-900',
    emerald: 'border-emerald-100 bg-white text-gray-900',
    slate: 'border-slate-100 bg-white text-gray-900',
    rose: 'border-rose-100 bg-white text-gray-900',
  } as const;

  const dotStyles = {
    primary: 'bg-white/20 text-white',
    indigo: 'bg-indigo-50 text-indigo-600',
    teal: 'bg-teal-50 text-teal-600',
    sky: 'bg-sky-50 text-sky-600',
    amber: 'bg-amber-50 text-amber-600',
    violet: 'bg-violet-50 text-violet-600',
    orange: 'bg-orange-50 text-orange-600',
    emerald: 'bg-emerald-50 text-emerald-600',
    slate: 'bg-slate-100 text-slate-600',
    rose: 'bg-rose-50 text-rose-600',
  } as const;

  return (
    <div className={cn(
      "group relative overflow-hidden rounded-[26px] border p-5 shadow-[0_18px_45px_rgba(15,23,42,0.06)] transition-transform duration-200 hover:-translate-y-0.5",
      accentStyles[accent]
    )}>
      <div className="absolute right-0 top-0 h-24 w-24 rounded-full bg-current/5 blur-2xl" />
      <div className="relative z-10 flex items-start justify-between gap-4">
        <div>
          <p className={cn("text-sm font-medium", accent === 'primary' ? "text-indigo-100" : "text-gray-500")}>{title}</p>
          <p className="mt-3 text-[1.7rem] font-bold tracking-tight">{value}</p>
          <p className={cn("mt-2 text-xs", accent === 'primary' ? "text-white/70" : "text-gray-400")}>{note}</p>
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
              <CartesianGrid vertical={false} stroke="#E5E7EB" strokeDasharray="3 3" />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: '#6B7280', fontSize: 12 }} />
              <YAxis tickLine={false} axisLine={false} tick={{ fill: '#9CA3AF', fontSize: 12 }} tickFormatter={(value) => `R$ ${Math.round(value / 1000)}k`} />
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
              <div key={item.name} className="flex items-center justify-between gap-4 rounded-2xl bg-gray-50 px-4 py-3">
                <div className="flex items-center gap-3">
                  <span className="h-3 w-3 rounded-full" style={{ backgroundColor: item.color }} />
                  <span className="text-sm font-medium text-gray-600">{item.name}</span>
                </div>
                <span className="text-sm font-semibold text-gray-900">{formatCurrency(item.value)}</span>
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
              <CartesianGrid vertical={false} stroke="#E5E7EB" strokeDasharray="3 3" />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: '#6B7280', fontSize: 12 }} />
              <YAxis tickLine={false} axisLine={false} tick={{ fill: '#9CA3AF', fontSize: 12 }} tickFormatter={(value) => `R$ ${Math.round(value / 1000)}k`} />
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
              <CartesianGrid horizontal={false} stroke="#EEF2FF" />
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="label" tickLine={false} axisLine={false} tick={{ fill: '#6B7280', fontSize: 12 }} width={82} />
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
    <div className={cn("rounded-[30px] border border-white bg-white/95 p-5 shadow-[0_20px_55px_rgba(15,23,42,0.07)]", className)}>
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h4 className="text-lg font-bold text-gray-900">{title}</h4>
          <p className="mt-1 text-sm text-gray-500">{subtitle}</p>
        </div>
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
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
    <div className="rounded-2xl border border-gray-100 bg-white px-4 py-3 shadow-xl">
      {label && <p className="mb-2 text-sm font-semibold text-gray-900">{label}</p>}
      <div className="space-y-1.5">
        {payload.map((entry: any) => (
          <div key={entry.name} className="flex items-center justify-between gap-4 text-sm">
            <div className="flex items-center gap-2 text-gray-500">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: entry.color }} />
              {entry.name}
            </div>
            <span className="font-semibold text-gray-900">{formatCurrency(Number(entry.value || 0))}</span>
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
    indigo: 'bg-indigo-50 text-indigo-600',
    teal: 'bg-teal-50 text-teal-600',
    sky: 'bg-sky-50 text-sky-600',
    emerald: 'bg-emerald-50 text-emerald-600',
    amber: 'bg-amber-50 text-amber-600',
    violet: 'bg-violet-50 text-violet-600',
  } as const;

  return (
    <div className="rounded-[30px] border border-white bg-white/95 p-6 shadow-[0_20px_55px_rgba(15,23,42,0.07)]">
      <div className="mb-5 flex items-center justify-between gap-4">
        <div>
          <h4 className="text-lg font-bold text-gray-900">Resumo visual</h4>
          <p className="mt-1 text-sm text-gray-500">Os indicadores mais úteis para leitura rápida do financeiro.</p>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {insights.map((insight) => (
          <div key={insight.title} className="rounded-[24px] border border-gray-100 bg-gradient-to-br from-white to-gray-50 p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-gray-500">{insight.title}</p>
                <p className="mt-3 text-xl font-bold text-gray-900">{insight.value}</p>
                <p className="mt-2 text-sm text-gray-400">{insight.detail}</p>
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
    <div className="overflow-hidden rounded-[30px] border border-white bg-white/95 shadow-[0_20px_55px_rgba(15,23,42,0.07)]">
      <div className="flex items-center justify-between gap-4 border-b border-gray-100 px-6 py-5">
        <div>
          <h4 className="font-bold text-gray-800">{title}</h4>
          <p className="mt-1 text-sm text-gray-500">{subtitle}</p>
        </div>
        <div className="hidden rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-500 md:block">
          {rows.length} linha(s)
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[1400px] text-left">
          <thead className="sticky top-0 z-[1] bg-gray-50/95 text-[11px] uppercase tracking-wider text-gray-500 backdrop-blur">
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
          <tbody className="divide-y divide-gray-100">
            {rows.map((row, index) => (
              <tr key={row.key} className={cn("transition-colors hover:bg-indigo-50/40", index % 2 === 0 ? "bg-white" : "bg-gray-50/35")}>
                <td className="px-5 py-4">
                  <div className="font-semibold text-gray-800">{row.label}</div>
                  <div className="mt-1 text-xs text-gray-400">
                    {row.jobsCount} ensaio(s)
                    {row.unconfiguredJobs > 0 && ` · ${row.unconfiguredJobs} sem configuração`}
                  </div>
                </td>
                <td className="px-5 py-4 text-right font-semibold text-gray-900">{formatCurrency(row.grossRevenue)}</td>
                <td className="px-5 py-4 text-right text-gray-600">{formatCurrency(row.keepInBank)}</td>
                <td className="px-5 py-4 text-right text-gray-600">{formatCurrency(row.variableGraphics)}</td>
                <td className="px-5 py-4 text-right text-gray-600">{formatCurrency(row.extras)}</td>
                <td className="px-5 py-4 text-right text-gray-600">{formatCurrency(row.emergencyFund)}</td>
                <td className="px-5 py-4 text-right text-gray-600">{formatCurrency(row.investments)}</td>
                <td className="px-5 py-4 text-right text-gray-600">{formatCurrency(row.reinvestment)}</td>
                <td className="px-5 py-4 text-right text-gray-600">{formatCurrency(row.traffic)}</td>
                <td className="px-5 py-4 text-right text-gray-600">{formatCurrency(row.proLabore)}</td>
                <td className="px-5 py-4 text-right">
                  <span className="inline-flex rounded-full bg-emerald-50 px-3 py-1 text-sm font-semibold text-emerald-700">
                    {formatCurrency(row.personalDistribution)}
                  </span>
                </td>
                <td className={cn("px-5 py-4 text-right font-semibold", row.netProfit >= 0 ? "text-emerald-600" : "text-red-600")}>
                  {formatCurrency(row.netProfit)}
                </td>
              </tr>
            ))}

            {rows.length === 0 && (
              <tr>
                <td colSpan={12} className="px-4 py-10 text-center text-sm text-gray-400">
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

// --- Sales Component ---
function Sales({ funnel, opportunities, onUpdate, onContactOpp }: { funnel: { stages: FunnelStage[], leads: Lead[] }, opportunities: Opportunity[], onUpdate: () => void, onContactOpp: (opp: Opportunity, client: Client | null) => void }) {
  const [showModal, setShowModal] = useState(false);
  const [activeTab, setActiveTab] = useState<'funnel' | 'opportunities'>('funnel');

  const moveLead = async (leadId: number, newStageId: number) => {
    await authFetch(`/api/leads/${leadId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage_id: newStageId })
    });
    onUpdate();
  };

  return (
    <div className="space-y-6 h-[calc(100vh-12rem)] flex flex-col">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-6">
          <div>
            <h3 className="text-2xl font-bold text-gray-800">Vendas</h3>
            <p className="text-gray-500">Gerencie seus leads e oportunidades.</p>
          </div>
          <div className="flex bg-white p-1 rounded-xl border border-gray-100 shadow-sm">
            <button 
              onClick={() => setActiveTab('funnel')}
              className={cn(
                "px-4 py-1.5 text-sm font-bold rounded-lg transition-all",
                activeTab === 'funnel' ? "bg-indigo-600 text-white shadow-md" : "text-gray-400 hover:text-gray-600"
              )}
            >
              Funil de Leads
            </button>
            <button 
              onClick={() => setActiveTab('opportunities')}
              className={cn(
                "px-4 py-1.5 text-sm font-bold rounded-lg transition-all",
                activeTab === 'opportunities' ? "bg-indigo-600 text-white shadow-md" : "text-gray-400 hover:text-gray-600"
              )}
            >
              Oportunidades
            </button>
          </div>
        </div>
        {activeTab === 'funnel' && (
          <button 
            onClick={() => setShowModal(true)}
            className="bg-indigo-600 text-white px-4 py-2 rounded-xl font-semibold flex items-center gap-2 hover:bg-indigo-700 transition-colors"
          >
            <Plus size={20} /> Novo Lead
          </button>
        )}
      </div>

      {activeTab === 'funnel' ? (
        <div className="flex-1 overflow-x-auto pb-4">
          <div className="flex gap-6 h-full min-w-max">
            {funnel.stages.map(stage => (
              <div key={stage.id} className="w-72 flex flex-col bg-gray-100/50 rounded-2xl p-4">
                <div className="flex items-center justify-between mb-4 px-1">
                  <h4 className="font-bold text-gray-700 flex items-center gap-2">
                    {stage.name}
                    <span className="bg-gray-200 text-gray-500 text-[10px] px-2 py-0.5 rounded-full">
                      {funnel.leads.filter(l => l.stage_id === stage.id).length}
                    </span>
                  </h4>
                  <button className="text-gray-400 hover:text-gray-600"><MoreVertical size={16} /></button>
                </div>
                
                <div className="flex-1 space-y-3 overflow-y-auto scrollbar-hide">
                  {funnel.leads.filter(l => l.stage_id === stage.id).map(lead => (
                    <motion.div 
                      layoutId={`lead-${lead.id}`}
                      key={lead.id} 
                      className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow cursor-grab active:cursor-grabbing group"
                    >
                      <div className="flex justify-between items-start mb-2">
                        <h5 className="font-bold text-gray-900 text-sm">{lead.client_name}</h5>
                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          {funnel.stages.find(s => s.position === stage.position + 1) && (
                            <button onClick={() => moveLead(lead.id, funnel.stages.find(s => s.position === stage.position + 1)!.id)} className="p-1 text-gray-400 hover:text-indigo-600"><ChevronRight size={14} /></button>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 mb-3">
                        <span className="text-[10px] bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full font-bold uppercase">{lead.job_type_interest}</span>
                      </div>
                      <div className="flex items-center justify-between text-[10px] text-gray-400">
                        <div className="flex items-center gap-1">
                          <Clock size={12} />
                          {format(new Date(lead.contact_date), 'dd/MM')}
                        </div>
                        <div className="font-bold text-gray-700">
                          R$ {(lead.estimated_value ?? 0).toLocaleString('pt-BR')}
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <OpportunitiesKanban opportunities={opportunities} onUpdate={onUpdate} onContactOpp={onContactOpp} />
      )}

      {showModal && (
        <LeadModal 
          stages={funnel.stages}
          onClose={() => setShowModal(false)} 
          onSave={() => { setShowModal(false); onUpdate(); }} 
        />
      )}
    </div>
  );
}

function LeadModal({ stages, onClose, onSave }: { stages: FunnelStage[], onClose: () => void, onSave: () => void }) {
  const [formData, setFormData] = useState({
    client_name: '',
    job_type_interest: 'Gestante',
    contact_date: format(new Date(), 'yyyy-MM-dd'),
    estimated_value: '',
    stage_id: stages[0]?.id || 1,
    notes: ''
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await authFetch('/api/leads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formData)
    });
    onSave();
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <motion.div 
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden"
      >
        <div className="p-6 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-xl font-bold">Novo Lead</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <Plus className="rotate-45" size={24} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nome do Lead</label>
            <input 
              required
              type="text" 
              value={formData.client_name}
              onChange={e => setFormData({...formData, client_name: e.target.value})}
              className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Interesse</label>
              <select 
                value={formData.job_type_interest}
                onChange={e => setFormData({...formData, job_type_interest: e.target.value})}
                className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
              >
                <option>Gestante</option>
                <option>Newborn</option>
                <option>Acompanhamento</option>
                <option>Aniversário</option>
                <option>Marca Pessoal</option>
                <option>Outros</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Valor Estimado</label>
              <input 
                type="number" 
                value={formData.estimated_value}
                onChange={e => setFormData({...formData, estimated_value: e.target.value === '' ? '' : Number(e.target.value)})}
                className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Etapa Inicial</label>
            <select 
              value={formData.stage_id}
              onChange={e => setFormData({...formData, stage_id: Number(e.target.value)})}
              className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
            >
              {stages.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Observações</label>
            <textarea 
              value={formData.notes}
              onChange={e => setFormData({...formData, notes: e.target.value})}
              className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none resize-none"
              rows={3}
            />
          </div>
          <div className="flex justify-end gap-3 pt-4">
            <button type="button" onClick={onClose} className="px-6 py-2 text-gray-500 font-medium">Cancelar</button>
            <button type="submit" className="px-8 py-2 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-colors">
              Salvar Lead
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

// --- Opportunities Kanban Component ---
function OpportunitiesKanban({ opportunities, onUpdate, onContactOpp }: { opportunities: Opportunity[], onUpdate: () => void, onContactOpp: (opp: Opportunity, client: Client | null) => void }) {
  const columns = [
    { id: 'urgent', name: 'Urgentes', color: 'bg-red-50 text-red-700 border-red-100' },
    { id: 'active', name: 'Ativas', color: 'bg-amber-50 text-amber-700 border-amber-100' },
    { id: 'future', name: 'Futuras', color: 'bg-indigo-50 text-indigo-700 border-indigo-100' }
  ];

  const handleStatusChange = async (id: number, status: string) => {
    await authFetch(`/api/opportunities/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
    onUpdate();
  };

  return (
    <div className="flex-1 overflow-x-auto pb-4">
      <div className="flex gap-6 h-full min-w-max">
        {columns.map(col => (
          <div key={col.id} className="w-80 flex flex-col bg-gray-100/50 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-4 px-1">
              <h4 className={cn("font-bold flex items-center gap-2 px-3 py-1 rounded-full text-xs uppercase tracking-wider", col.color)}>
                {col.name}
                <span className="opacity-50">
                  {opportunities.filter(o => o.priority === col.id && o.status === 'future').length}
                </span>
              </h4>
            </div>
            
            <div className="flex-1 space-y-3 overflow-y-auto scrollbar-hide">
              {opportunities.filter(o => o.priority === col.id && o.status === 'future').map(opp => (
                <motion.div 
                  layoutId={`opp-${opp.id}`}
                  key={opp.id} 
                  className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow group"
                >
                  <div className="flex justify-between items-start mb-2">
                    <h5 className="font-bold text-gray-900 text-sm">{opp.client_name}</h5>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button 
                        onClick={() => handleStatusChange(opp.id, 'dismissed')}
                        className="p-1 text-gray-400 hover:text-red-600"
                        title="Ignorar"
                      >
                        <Plus className="rotate-45" size={14} />
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-[10px] bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full font-bold uppercase">{opp.type}</span>
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-gray-400">
                    <div className="flex items-center gap-1">
                      <Clock size={12} />
                      {format(new Date(opp.suggested_date), 'dd/MM/yyyy')}
                    </div>
                    <button 
                      onClick={async () => {
                        const res = await authFetch(`/api/clients/${opp.client_id}`);
                        const client = await res.json();
                        onContactOpp(opp, client);
                      }}
                      className="flex items-center gap-1.5 px-3 py-1 bg-indigo-600 text-white text-[10px] font-bold rounded-lg hover:bg-indigo-700 transition-all shadow-sm"
                    >
                      <MessageSquare size={12} />
                      Contatar
                    </button>
                  </div>
                </motion.div>
              ))}
              {opportunities.filter(o => o.priority === col.id && o.status === 'future').length === 0 && (
                <div className="text-center py-8 text-gray-400 italic text-xs">
                  Vazio
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// --- Settings Page Component ---
function SettingsPage({ rules, onUpdate }: { rules: OpportunityRule[], onUpdate: () => void }) {
  const [editingRule, setEditingRule] = useState<OpportunityRule | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [googleConnected, setGoogleConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [googleConfig, setGoogleConfig] = useState<{
    hasClientId: boolean;
    hasClientSecret: boolean;
    clientIdPreview: string;
    clientIdLength: number;
    currentRedirectUri: string;
    envAppUrl: string;
  } | null>(null);

  const fetchGoogleConfig = async () => {
    try {
      const res = await authFetch('/api/auth/google/config-check');
      const data = await res.json();
      setGoogleConfig(data);
    } catch (error) {
      console.error('Error fetching Google config:', error);
    }
  };

  const checkGoogleStatus = async () => {
    try {
      const res = await authFetch('/api/auth/google/status');
      const data = await res.json();
      setGoogleConnected(data.connected);
    } catch (error) {
      console.error('Error checking Google status:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    checkGoogleStatus();
    fetchGoogleConfig();

    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'GOOGLE_AUTH_SUCCESS') {
        checkGoogleStatus();
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const handleConnectGoogle = async () => {
    try {
      const res = await authFetch('/api/auth/google/url');
      const { url } = await res.json();
      window.open(url, 'google_auth_popup', 'width=600,height=700');
    } catch (error) {
      console.error('Error getting Google auth URL:', error);
    }
  };

  const handleDisconnectGoogle = async () => {
    if (confirm('Deseja desconectar sua conta do Google Calendar?')) {
      await authFetch('/api/auth/google/disconnect', { method: 'POST' });
      checkGoogleStatus();
    }
  };

  const handleSyncAll = async () => {
    setLoading(true);
    try {
      const res = await authFetch('/api/auth/google/sync-all', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        alert(`${data.pushed} trabalhos enviados e ${data.pulled} eventos importados do Google Calendar!`);
      } else {
        alert('Erro ao sincronizar trabalhos.');
      }
    } catch (error) {
      console.error('Error syncing all jobs:', error);
      alert('Erro ao conectar com o servidor.');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (confirm('Deseja excluir esta regra?')) {
      await authFetch(`/api/opportunity-rules/${id}`, { method: 'DELETE' });
      onUpdate();
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-2xl font-bold text-gray-800">Configurações</h3>
          <p className="text-gray-500">Gerencie as regras de automação e integrações.</p>
        </div>
        <button 
          onClick={() => { setEditingRule(null); setShowModal(true); }}
          className="bg-indigo-600 text-white px-4 py-2 rounded-xl font-semibold flex items-center gap-2 hover:bg-indigo-700"
        >
          <Plus size={20} /> Nova Regra
        </button>
      </div>

      {/* Google Calendar Integration */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-indigo-50 rounded-xl flex items-center justify-center text-indigo-600">
              <Calendar size={24} />
            </div>
            <div>
              <h4 className="font-bold text-gray-800">Google Calendar</h4>
              <p className="text-sm text-gray-500">Sincronize seus agendamentos automaticamente com o Google Calendar.</p>
              <p className="text-[10px] text-gray-400 mt-1">
                Certifique-se de adicionar a URL de callback no Google Cloud Console: <br/>
                <code className="bg-gray-100 px-1 rounded">{window.location.origin}/api/auth/google/callback</code>
              </p>
              <p className="text-[10px] text-gray-400 mt-1 italic">
                Dica: O Google exige que a URL seja exatamente igual, incluindo o protocolo (https://).
              </p>
              {googleConfig && googleConfig.hasClientId && (
                <div className="mt-2 p-2 bg-gray-50 rounded-lg border border-gray-200">
                  <p className="text-[10px] font-mono text-gray-600">
                    <span className="font-bold">ID do Cliente (Início...Fim):</span> {googleConfig.clientIdPreview}
                  </p>
                  <p className="text-[10px] font-mono text-gray-600">
                    <span className="font-bold">Tamanho:</span> {googleConfig.clientIdLength} caracteres
                  </p>
                  <p className="text-[10px] text-gray-400 mt-1 italic">
                    Verifique se o ID acima corresponde exatamente ao do seu Google Cloud Console.
                  </p>
                </div>
              )}
              {googleConfig && (!googleConfig.hasClientId || !googleConfig.hasClientSecret) && (
                <p className="text-[10px] text-red-500 font-bold mt-1 flex items-center gap-1">
                  <AlertCircle size={10} /> Credenciais (Client ID/Secret) não configuradas no ambiente!
                </p>
              )}
            </div>
          </div>
          {loading ? (
            <div className="animate-spin text-indigo-600">
              <RefreshCw size={20} />
            </div>
          ) : googleConnected ? (
            <div className="flex items-center gap-4">
              <button 
                onClick={handleSyncAll}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-50 text-indigo-600 rounded-xl font-bold hover:bg-indigo-100 transition-colors text-sm"
              >
                <RefreshCw size={16} /> Sincronizar Tudo
              </button>
              <div className="flex items-center gap-3 border-l border-gray-100 pl-4">
                <span className="flex items-center gap-1 text-emerald-600 text-sm font-bold bg-emerald-50 px-3 py-1 rounded-full">
                  <CheckCircle2 size={16} /> Conectado
                </span>
                <button 
                  onClick={handleDisconnectGoogle}
                  className="text-red-600 hover:text-red-700 text-sm font-bold"
                >
                  Desconectar
                </button>
              </div>
            </div>
          ) : (
            <button 
              onClick={handleConnectGoogle}
              className="bg-white border border-gray-200 text-gray-700 px-4 py-2 rounded-xl font-bold hover:bg-gray-50 transition-colors flex items-center gap-2"
            >
              Conectar Google Calendar
            </button>
          )}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-widest">Gatilho (Tipo de Ensaio)</th>
              <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-widest">Oportunidade Gerada</th>
              <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-widest">Tempo (Dias)</th>
              <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-widest">Status</th>
              <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-widest text-right">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {rules.map(rule => (
              <tr key={rule.id} className="hover:bg-gray-50/50 transition-colors">
                <td className="px-6 py-4">
                  <span className="font-bold text-gray-900">{rule.trigger_job_type}</span>
                </td>
                <td className="px-6 py-4">
                  <span className="text-indigo-600 font-medium">{rule.target_job_type}</span>
                </td>
                <td className="px-6 py-4 text-gray-500">{rule.days_offset} dias</td>
                <td className="px-6 py-4">
                  <span className={cn(
                    "px-2 py-1 rounded-full text-[10px] font-bold uppercase",
                    rule.is_active ? "bg-emerald-50 text-emerald-600" : "bg-gray-100 text-gray-400"
                  )}>
                    {rule.is_active ? 'Ativa' : 'Inativa'}
                  </span>
                </td>
                <td className="px-6 py-4 text-right">
                  <div className="flex justify-end gap-2">
                    <button 
                      onClick={() => { setEditingRule(rule); setShowModal(true); }}
                      className="p-2 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                    >
                      <Edit2 size={16} />
                    </button>
                    <button 
                      onClick={() => handleDelete(rule.id)}
                      className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showModal && (
        <RuleModal 
          rule={editingRule} 
          onClose={() => setShowModal(false)} 
          onSave={() => { setShowModal(false); onUpdate(); }} 
        />
      )}
    </div>
  );
}

function RuleModal({ rule, onClose, onSave }: { rule: OpportunityRule | null, onClose: () => void, onSave: () => void }) {
  const [formData, setFormData] = useState({
    trigger_job_type: rule?.trigger_job_type || 'Gestante',
    target_job_type: rule?.target_job_type || 'Newborn',
    days_offset: rule?.days_offset || 30,
    is_active: rule ? Boolean(rule.is_active) : true
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const method = rule ? 'PUT' : 'POST';
    const url = rule ? `/api/opportunity-rules/${rule.id}` : '/api/opportunity-rules';
    
    await authFetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...formData,
        is_active: formData.is_active ? 1 : 0
      })
    });
    onSave();
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
      <motion.div 
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-md overflow-hidden"
      >
        <div className="p-6 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
          <h3 className="text-lg font-bold text-gray-800">
            {rule ? 'Editar Regra' : 'Nova Regra de Oportunidade'}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <Plus className="rotate-45" size={24} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Tipo de Ensaio (Gatilho)</label>
            <select 
              value={formData.trigger_job_type}
              onChange={e => setFormData({...formData, trigger_job_type: e.target.value})}
              className="w-full px-4 py-2 bg-white border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option>Gestante</option>
              <option>Newborn</option>
              <option>Acompanhamento</option>
              <option>Smash the Cake</option>
              <option>Aniversário</option>
              <option>Família</option>
              <option>Outros</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Oportunidade a Gerar</label>
            <input 
              required
              type="text" 
              value={formData.target_job_type}
              onChange={e => setFormData({...formData, target_job_type: e.target.value})}
              className="w-full px-4 py-2 bg-white border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Dias após o ensaio</label>
            <input 
              required
              type="number" 
              value={formData.days_offset}
              onChange={e => setFormData({...formData, days_offset: Number(e.target.value)})}
              className="w-full px-4 py-2 bg-white border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div className="flex items-center gap-2">
            <input 
              type="checkbox" 
              id="is_active"
              checked={formData.is_active}
              onChange={e => setFormData({...formData, is_active: e.target.checked})}
              className="w-4 h-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500"
            />
            <label htmlFor="is_active" className="text-sm font-medium text-gray-700">Regra Ativa</label>
          </div>
          <div className="flex justify-end gap-3 pt-4">
            <button type="button" onClick={onClose} className="px-6 py-2 text-gray-500 font-medium">Cancelar</button>
            <button type="submit" className="px-8 py-2 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-colors">
              Salvar Regra
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

function ContactOpportunityModal({ opportunity, client, onClose, onUpdate }: { opportunity: Opportunity, client: Client | null, onClose: () => void, onUpdate: () => void }) {
  const [copied, setCopied] = useState(false);
  const [converting, setConverting] = useState(false);

  const handleCopyPhone = () => {
    if (client?.phone) {
      navigator.clipboard.writeText(client.phone);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleWhatsApp = () => {
    if (client?.phone) {
      const phone = client.phone.replace(/\D/g, '');
      const message = encodeURIComponent(`Olá ${client.name}! Tudo bem? Notei que está chegando a época de fazermos o ensaio de ${opportunity.type}. Vamos agendar?`);
      window.open(`https://wa.me/55${phone}?text=${message}`, '_blank');
    }
  };

  const handleConvert = async () => {
    setConverting(true);
    try {
      // 1. Convert opportunity to lead
      await authFetch(`/api/opportunities/${opportunity.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'converted' })
      });

      // 2. Create a new lead for this client
      if (client) {
        await authFetch('/api/leads', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            client_name: client.name,
            job_type_interest: opportunity.type,
            contact_date: new Date().toISOString().split('T')[0],
            estimated_value: opportunity.estimated_value || 0,
            status: 'new',
            notes: `Convertido da oportunidade: ${opportunity.type}`,
            stage_id: 1
          })
        });
      }

      onUpdate();
      onClose();
    } catch (error) {
      console.error('Erro ao converter:', error);
    } finally {
      setConverting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden"
      >
        <div className="p-6 border-b border-gray-100 flex items-center justify-between bg-indigo-50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600">
              <Sparkles size={20} />
            </div>
            <div>
              <h3 className="font-bold text-gray-900">Nova Oportunidade</h3>
              <p className="text-xs text-indigo-600 font-medium uppercase tracking-wider">{opportunity.type}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <Plus size={24} className="rotate-45" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 bg-gray-50 rounded-xl border border-gray-100">
              <div>
                <p className="text-xs text-gray-500 font-medium">Cliente</p>
                <p className="font-bold text-gray-900">{client?.name || 'Carregando...'}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-gray-500 font-medium">Data Sugerida</p>
                <p className="font-bold text-gray-900">{format(new Date(opportunity.suggested_date), 'dd/MM/yyyy')}</p>
              </div>
            </div>

            <div className="flex items-center justify-between p-4 bg-gray-50 rounded-xl border border-gray-100">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-green-100 flex items-center justify-center text-green-600">
                  <Phone size={16} />
                </div>
                <div>
                  <p className="text-xs text-gray-500 font-medium">Telefone</p>
                  <p className="font-bold text-gray-900">{client?.phone || 'N/A'}</p>
                </div>
              </div>
              <button 
                onClick={handleCopyPhone}
                className={cn(
                  "p-2 rounded-lg transition-all",
                  copied ? "bg-green-500 text-white" : "bg-white text-gray-400 hover:text-indigo-600 border border-gray-200"
                )}
              >
                {copied ? <Check size={16} /> : <Copy size={16} />}
              </button>
            </div>
          </div>

          <div className="space-y-3">
            <p className="text-sm font-medium text-gray-700">Ações de Contato</p>
            <div className="grid grid-cols-2 gap-3">
              <button 
                onClick={handleWhatsApp}
                className="flex items-center justify-center gap-2 py-3 bg-green-500 text-white rounded-xl font-bold hover:bg-green-600 transition-all shadow-sm"
              >
                <MessageSquare size={18} />
                WhatsApp
              </button>
              <button 
                onClick={() => window.open(`tel:${client?.phone}`, '_self')}
                className="flex items-center justify-center gap-2 py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-all shadow-sm"
              >
                <Phone size={18} />
                Ligar
              </button>
            </div>
          </div>

          <div className="p-4 bg-amber-50 rounded-xl border border-amber-100 space-y-2">
            <div className="flex items-center gap-2 text-amber-700">
              <Sparkles size={16} />
              <p className="text-xs font-bold uppercase tracking-wider">Sugestão de Abordagem</p>
            </div>
            <p className="text-sm text-amber-800 italic leading-relaxed">
              "Olá {client?.name.split(' ')[0]}! Tudo bem? Notei que está chegando a época de fazermos o ensaio de {opportunity.type}. Vamos agendar?"
            </p>
          </div>
        </div>

        <div className="p-6 bg-gray-50 border-t border-gray-100 flex gap-3">
          <button 
            onClick={onClose}
            className="flex-1 py-3 text-gray-600 font-bold hover:bg-gray-100 rounded-xl transition-all"
          >
            Depois
          </button>
          <button 
            onClick={handleConvert}
            disabled={converting}
            className="flex-2 py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-all shadow-md flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {converting ? (
              <RefreshCw size={18} className="animate-spin" />
            ) : (
              <>
                <ExternalLink size={18} />
                Converter em Lead
              </>
            )}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

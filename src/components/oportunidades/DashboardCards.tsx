import React from 'react';
import { Gift, Calendar, Target, TrendingUp } from 'lucide-react';

interface DashboardCardsProps {
  anivHoje: number;
  anivSemana: number;
  totalPendentes: number;
  taxaConversao: number;
  loading?: boolean;
}

function Card({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string | number; color: string }) {
  return (
    <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 p-6 flex items-center gap-4">
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${color}`}>
        {icon}
      </div>
      <div>
        <p className="text-sm text-gray-500 dark:text-gray-400">{label}</p>
        <p className="text-2xl font-bold text-gray-900 dark:text-white">{value}</p>
      </div>
    </div>
  );
}

export function DashboardCards({ anivHoje, anivSemana, totalPendentes, taxaConversao, loading }: DashboardCardsProps) {
  if (loading) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 p-6 h-24 animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <Card icon={<Gift size={22} className="text-pink-600" />} label="Aniversariantes Hoje" value={anivHoje} color="bg-pink-50 dark:bg-pink-500/20" />
      <Card icon={<Calendar size={22} className="text-indigo-600" />} label="Aniversariantes Semana" value={anivSemana} color="bg-indigo-50 dark:bg-indigo-500/20" />
      <Card icon={<Target size={22} className="text-amber-600" />} label="Oportunidades Pendentes" value={totalPendentes} color="bg-amber-50 dark:bg-amber-500/20" />
      <Card icon={<TrendingUp size={22} className="text-emerald-600" />} label="Taxa de Conversão" value={`${taxaConversao}%`} color="bg-emerald-50 dark:bg-emerald-500/20" />
    </div>
  );
}

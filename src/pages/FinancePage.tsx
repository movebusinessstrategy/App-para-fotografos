import React, { useState } from 'react';
import {
  LayoutDashboard, ArrowUpCircle, ArrowDownCircle,
  GitMerge, BarChart3, FileText, Settings,
} from 'lucide-react';

import VisaoGeral from '../components/financeiro/VisaoGeral';
import ContasReceber from '../components/financeiro/ContasReceber';
import ContasPagar from '../components/financeiro/ContasPagar';
import Conciliacao from '../components/financeiro/Conciliacao';
import DRE from '../components/financeiro/DRE';
import Relatorios from '../components/financeiro/Relatorios';
import Configuracoes from '../components/financeiro/Configuracoes';

type TabKey = 'visao' | 'receber' | 'pagar' | 'conciliacao' | 'dre' | 'relatorios' | 'config';

interface Tab {
  key: TabKey;
  label: string;
  icon: React.ElementType;
}

const TABS: Tab[] = [
  { key: 'visao',       label: 'Visão Geral',   icon: LayoutDashboard },
  { key: 'receber',     label: 'A Receber',      icon: ArrowUpCircle },
  { key: 'pagar',       label: 'A Pagar',        icon: ArrowDownCircle },
  { key: 'conciliacao', label: 'Conciliação',    icon: GitMerge },
  { key: 'dre',         label: 'DRE',            icon: BarChart3 },
  { key: 'relatorios',  label: 'Relatórios',     icon: FileText },
  { key: 'config',      label: 'Configurações',  icon: Settings },
];

export default function FinancePage() {
  const [tab, setTab] = useState<TabKey>('visao');
  // A página inteira já exige a permissão 'finance' (PermissionRoute). Quem chega
  // aqui pode ver todas as abas, inclusive Relatórios.
  const visibleTabs = TABS;

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar */}
      <div className="border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 md:px-6 overflow-x-auto">
        <nav className="flex gap-0 min-w-max">
          {visibleTabs.map(t => {
            const Icon = t.icon;
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`flex items-center gap-1.5 px-3 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                  active
                    ? 'border-violet-500 text-violet-600 dark:text-violet-400'
                    : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:border-gray-300 dark:hover:border-gray-600'
                }`}
              >
                <Icon className="w-4 h-4 flex-shrink-0" />
                <span className="hidden sm:inline">{t.label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        {tab === 'visao'       && <VisaoGeral />}
        {tab === 'receber'     && <ContasReceber />}
        {tab === 'pagar'       && <ContasPagar />}
        {tab === 'conciliacao' && <Conciliacao />}
        {tab === 'dre'         && <DRE />}
        {tab === 'relatorios'  && <Relatorios />}
        {tab === 'config'      && <Configuracoes />}
      </div>
    </div>
  );
}

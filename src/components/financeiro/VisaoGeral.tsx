import React, { useEffect, useState, useCallback } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, Bar, Legend,
} from 'recharts';
import {
  TrendingUp, TrendingDown, Wallet, AlertCircle,
  RefreshCw, ChevronRight, ArrowUpCircle, ArrowDownCircle,
} from 'lucide-react';
import { authFetch } from '../../utils/authFetch';
import { fmtBRL, fmtDate } from './finUtils';

interface DashboardData {
  kpis: {
    receita_mes: number;
    despesa_mes: number;
    lucro_mes: number;
    saldo_contas: number;
    receitas_pendentes: number;
    despesas_pendentes: number;
    receitas_atrasadas: number;
    despesas_atrasadas: number;
  };
  fluxo_12m: Array<{
    mes: string;
    receitas: number;
    despesas: number;
    lucro: number;
  }>;
  proximos_recebimentos: Array<{
    id: string;
    descricao: string;
    valor: number;
    data_vencimento: string;
    status: string;
  }>;
  proximas_despesas: Array<{
    id: string;
    descricao: string;
    valor: number;
    data_vencimento: string;
    status: string;
  }>;
}

const KpiCard = ({
  label, value, sub, icon: Icon, color, trend,
}: {
  label: string; value: string; sub?: string;
  icon: React.ElementType; color: string; trend?: 'up' | 'down' | 'neutral';
}) => (
  <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 flex flex-col gap-2">
    <div className="flex items-center justify-between">
      <span className="text-xs font-medium text-gray-500 dark:text-gray-400">{label}</span>
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${color}`}>
        <Icon className="w-4 h-4" />
      </div>
    </div>
    <div className="text-xl font-bold text-gray-900 dark:text-white">{value}</div>
    {sub && <div className="text-xs text-gray-500 dark:text-gray-400">{sub}</div>}
  </div>
);

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3 shadow-lg text-sm">
      <p className="font-semibold text-gray-700 dark:text-gray-300 mb-1">{label}</p>
      {payload.map((p: any) => (
        <p key={p.name} style={{ color: p.color }}>
          {p.name}: {fmtBRL(p.value)}
        </p>
      ))}
    </div>
  );
};

export default function VisaoGeral() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState('');
  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await authFetch('/api/fin/dashboard');
      if (res.ok) setData(await res.json());
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  const syncJobs = async () => {
    setSyncing(true);
    try {
      const res = await authFetch('/api/fin/sync-jobs', { method: 'POST' });
      const data = await res.json();
      const msgs: string[] = [];
      if ((data.criadas || 0) > 0) msgs.push(`${data.criadas} receita(s) criada(s)`);
      if ((data.atualizadas || 0) > 0) msgs.push(`${data.atualizadas} receita(s) atualizada(s)`);
      if ((data.removidas || 0) > 0) msgs.push(`${data.removidas} fora da produção removida(s)`);
      if (msgs.length === 0) msgs.push('Tudo já está sincronizado');
      setSyncMsg(msgs.join(' · '));
      setTimeout(() => setSyncMsg(''), 4000);
      await load();
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    load();
    // Sincroniza com a Produção em segundo plano - sem precisar clicar no botão
    (async () => {
      try {
        await authFetch('/api/fin/sync-jobs', { method: 'POST' });
        load(true); // recarrega sem piscar o skeleton
      } catch { /* sync falhou - segue com os dados atuais */ }
    })();
  }, [load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-violet-600" />
      </div>
    );
  }

  const k = data?.kpis;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Visão Geral</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">Resumo financeiro do mês atual</p>
        </div>
        <div className="flex items-center gap-3">
          {syncMsg && (
            <span className="text-xs text-green-600 dark:text-green-400 font-medium animate-pulse">
              {syncMsg}
            </span>
          )}
          <button
            onClick={syncJobs}
            disabled={syncing}
            className="flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
            Sincronizar Jobs
          </button>
        </div>
      </div>

      {/* KPI Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard
          label="Receita do Mês"
          value={fmtBRL(k?.receita_mes ?? 0)}
          icon={TrendingUp}
          color="bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400"
        />
        <KpiCard
          label="Despesas do Mês"
          value={fmtBRL(k?.despesa_mes ?? 0)}
          icon={TrendingDown}
          color="bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400"
        />
        <KpiCard
          label="Lucro do Mês"
          value={fmtBRL(k?.lucro_mes ?? 0)}
          icon={Wallet}
          color={(k?.lucro_mes ?? 0) >= 0
            ? 'bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400'
            : 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400'}
        />
        <KpiCard
          label="Saldo em Contas"
          value={fmtBRL(k?.saldo_contas ?? 0)}
          icon={Wallet}
          color="bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"
        />
      </div>

      {/* Alertas */}
      {((k?.receitas_atrasadas ?? 0) > 0 || (k?.despesas_atrasadas ?? 0) > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {(k?.receitas_atrasadas ?? 0) > 0 && (
            <div className="flex items-center gap-3 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
              <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
              <div className="text-sm">
                <span className="font-semibold text-red-700 dark:text-red-300">
                  {fmtBRL(k?.receitas_atrasadas ?? 0)}
                </span>
                <span className="text-red-600 dark:text-red-400"> em recebimentos atrasados</span>
              </div>
            </div>
          )}
          {(k?.despesas_atrasadas ?? 0) > 0 && (
            <div className="flex items-center gap-3 p-3 rounded-lg bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800">
              <AlertCircle className="w-5 h-5 text-orange-500 flex-shrink-0" />
              <div className="text-sm">
                <span className="font-semibold text-orange-700 dark:text-orange-300">
                  {fmtBRL(k?.despesas_atrasadas ?? 0)}
                </span>
                <span className="text-orange-600 dark:text-orange-400"> em despesas atrasadas</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Fluxo de Caixa 12 meses */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">
          Fluxo de Caixa - últimos 12 meses
        </h3>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={data?.fluxo_12m ?? []} margin={{ top: 0, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-gray-100 dark:stroke-gray-700" />
            <XAxis dataKey="mes" tick={{ fontSize: 11 }} className="text-gray-500 dark:text-gray-400" />
            <YAxis
              tickFormatter={v => `R$${(v / 1000).toFixed(0)}k`}
              tick={{ fontSize: 11 }}
              className="text-gray-500 dark:text-gray-400"
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend formatter={v => v.charAt(0).toUpperCase() + v.slice(1)} />
            <Bar dataKey="receitas" name="Receitas" fill="#10b981" radius={[4, 4, 0, 0]} />
            <Bar dataKey="despesas" name="Despesas" fill="#f43f5e" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Próximos lançamentos */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Recebimentos */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <div className="flex items-center gap-2 mb-3">
            <ArrowUpCircle className="w-4 h-4 text-emerald-500" />
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
              Próximos Recebimentos
            </h3>
          </div>
          {data?.proximos_recebimentos?.length ? (
            <div className="space-y-2">
              {data.proximos_recebimentos.slice(0, 5).map(r => (
                <div key={r.id} className="flex items-center justify-between py-1.5 border-b border-gray-100 dark:border-gray-700 last:border-0">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{r.descricao}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{fmtDate(r.data_vencimento)}</p>
                  </div>
                  <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400 ml-2 flex-shrink-0">
                    {fmtBRL(r.valor)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-400 dark:text-gray-500 py-4 text-center">
              Nenhum recebimento próximo
            </p>
          )}
          {(k?.receitas_pendentes ?? 0) > 0 && (
            <div className="mt-3 pt-2 border-t border-gray-100 dark:border-gray-700 flex justify-between text-xs text-gray-500 dark:text-gray-400">
              <span>Total pendente</span>
              <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                {fmtBRL(k?.receitas_pendentes ?? 0)}
              </span>
            </div>
          )}
        </div>

        {/* Despesas */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <div className="flex items-center gap-2 mb-3">
            <ArrowDownCircle className="w-4 h-4 text-red-500" />
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
              Próximas Despesas
            </h3>
          </div>
          {data?.proximas_despesas?.length ? (
            <div className="space-y-2">
              {data.proximas_despesas.slice(0, 5).map(d => (
                <div key={d.id} className="flex items-center justify-between py-1.5 border-b border-gray-100 dark:border-gray-700 last:border-0">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{d.descricao}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{fmtDate(d.data_vencimento)}</p>
                  </div>
                  <span className="text-sm font-semibold text-red-600 dark:text-red-400 ml-2 flex-shrink-0">
                    {fmtBRL(d.valor)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-400 dark:text-gray-500 py-4 text-center">
              Nenhuma despesa próxima
            </p>
          )}
          {(k?.despesas_pendentes ?? 0) > 0 && (
            <div className="mt-3 pt-2 border-t border-gray-100 dark:border-gray-700 flex justify-between text-xs text-gray-500 dark:text-gray-400">
              <span>Total pendente</span>
              <span className="font-semibold text-red-600 dark:text-red-400">
                {fmtBRL(k?.despesas_pendentes ?? 0)}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

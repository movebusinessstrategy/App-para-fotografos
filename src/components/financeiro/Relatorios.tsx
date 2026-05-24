import React, { useState } from 'react';
import { Download, BarChart3, TrendingUp, Users, Tag } from 'lucide-react';
import { FinSelect } from './FinInputs';
import { authFetch } from '../../utils/authFetch';
import { fmtBRL, exportCSV } from './finUtils';

const MESES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

type RelatorioTipo = 'receitas_categoria' | 'despesas_categoria' | 'receitas_cliente' | 'fluxo_mensal';

interface RelatorioCfg {
  key: RelatorioTipo;
  label: string;
  desc: string;
  icon: React.ElementType;
  color: string;
}

const RELATORIOS: RelatorioCfg[] = [
  { key: 'receitas_categoria', label: 'Receitas por Categoria', desc: 'Receitas agrupadas por categoria no período', icon: Tag, color: 'text-emerald-500' },
  { key: 'despesas_categoria', label: 'Despesas por Categoria', desc: 'Despesas agrupadas por categoria no período', icon: Tag, color: 'text-red-500' },
  { key: 'receitas_cliente', label: 'Receitas por Cliente', desc: 'Ranking de clientes por receita gerada', icon: Users, color: 'text-blue-500' },
  { key: 'fluxo_mensal', label: 'Fluxo Mensal', desc: 'Receitas x despesas mês a mês no período', icon: BarChart3, color: 'text-violet-500' },
];

interface ResultadoLinha {
  [key: string]: string | number;
}

export default function Relatorios() {
  const hoje = new Date();
  const [ano, setAno] = useState(hoje.getFullYear());
  const [mesInicio, setMesInicio] = useState(1);
  const [mesFim, setMesFim] = useState(hoje.getMonth() + 1);
  const [tipo, setTipo] = useState<RelatorioTipo>('receitas_categoria');
  const [resultado, setResultado] = useState<ResultadoLinha[] | null>(null);
  const [loading, setLoading] = useState(false);

  const anos = Array.from({ length: 5 }, (_, i) => hoje.getFullYear() - i);

  const gerar = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        tipo,
        ano: String(ano),
        mes_inicio: String(mesInicio),
        mes_fim: String(mesFim),
      });
      const res = await authFetch(`/api/fin/relatorios?${params}`);
      if (res.ok) setResultado(await res.json());
    } finally {
      setLoading(false);
    }
  };

  const baixarCSV = () => {
    if (!resultado?.length) return;
    const cfg = RELATORIOS.find(r => r.key === tipo)!;
    exportCSV(resultado, `${cfg.key}_${ano}.csv`);
  };

  const cfg = RELATORIOS.find(r => r.key === tipo)!;
  const colunas = resultado?.length ? Object.keys(resultado[0]) : [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Relatórios</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">Gere relatórios detalhados e exporte para CSV</p>
      </div>

      {/* Cards de relatório */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {RELATORIOS.map(r => {
          const Icon = r.icon;
          const selected = tipo === r.key;
          return (
            <button
              key={r.key}
              onClick={() => { setTipo(r.key); setResultado(null); }}
              className={`text-left p-4 rounded-xl border transition-all ${
                selected
                  ? 'border-violet-500 bg-violet-50 dark:bg-violet-900/20 shadow-sm'
                  : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-600'
              }`}
            >
              <Icon className={`w-5 h-5 mb-2 ${r.color}`} />
              <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">{r.label}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{r.desc}</p>
            </button>
          );
        })}
      </div>

      {/* Filtros de período */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
        <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Período</p>
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Ano</label>
            <FinSelect
              value={String(ano)}
              onChange={v => setAno(parseInt(v))}
              nullable={false}
              options={anos.map(a => ({ value: String(a), label: String(a) }))}
              className="w-24"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">De</label>
            <FinSelect
              value={String(mesInicio)}
              onChange={v => setMesInicio(parseInt(v))}
              nullable={false}
              options={MESES.map((m, i) => ({ value: String(i + 1), label: m }))}
              className="w-36"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Até</label>
            <FinSelect
              value={String(mesFim)}
              onChange={v => setMesFim(parseInt(v))}
              nullable={false}
              options={MESES.map((m, i) => ({ value: String(i + 1), label: m }))}
              className="w-36"
            />
          </div>
          <button
            onClick={gerar}
            disabled={loading}
            className="px-4 py-1.5 text-sm rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50"
          >
            {loading ? 'Gerando...' : 'Gerar Relatório'}
          </button>
        </div>
      </div>

      {/* Resultado */}
      {resultado !== null && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <cfg.icon className={`w-4 h-4 ${cfg.color}`} />
              <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">{cfg.label}</span>
              <span className="text-xs text-gray-400">
                {MESES[mesInicio - 1]} - {MESES[mesFim - 1]} {ano}
              </span>
            </div>
            {resultado.length > 0 && (
              <button
                onClick={baixarCSV}
                className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                <Download className="w-4 h-4" /> Baixar CSV
              </button>
            )}
          </div>

          {resultado.length === 0 ? (
            <div className="text-center py-10 text-gray-400 dark:text-gray-500 text-sm">
              Sem dados para o período selecionado.
            </div>
          ) : (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400">
                    {colunas.map(col => (
                      <th key={col} className={`px-4 py-3 font-medium ${typeof resultado[0][col] === 'number' ? 'text-right' : 'text-left'}`}>
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {resultado.map((row, i) => (
                    <tr key={i} className="border-b border-gray-50 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700/30 last:border-0">
                      {colunas.map(col => {
                        const val = row[col];
                        const isNum = typeof val === 'number';
                        const isMoney = isNum && (col.toLowerCase().includes('valor') || col.toLowerCase().includes('total') || col.toLowerCase().includes('receita') || col.toLowerCase().includes('despesa'));
                        return (
                          <td key={col} className={`px-4 py-3 ${isNum ? 'text-right font-medium' : 'text-left'} text-gray-800 dark:text-gray-200`}>
                            {isMoney ? fmtBRL(val as number) : String(val ?? '-')}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

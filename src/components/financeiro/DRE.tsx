import React, { useEffect, useState, useCallback } from 'react';
import { TrendingUp, TrendingDown, Minus, ChevronDown, ChevronRight } from 'lucide-react';
import { authFetch } from '../../utils/authFetch';
import { fmtBRL, exportCSV } from './finUtils';

interface DRELinha {
  grupo_id: string;
  grupo_nome: string;
  tipo: string;
  operacao: string;
  ordem: number;
  total_parcial_apos: string | null;
  categorias: Array<{
    categoria_id: string | null;
    categoria_nome: string;
    total: number;
  }>;
  total_grupo: number;
}

interface DREData {
  periodo: string;
  linhas: DRELinha[];
  totais_parciais: Record<string, number>;
  resultado_liquido: number;
}

const MESES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

export default function DRE() {
  const hoje = new Date();
  const [ano, setAno] = useState(hoje.getFullYear());
  const [mes, setMes] = useState<number | null>(hoje.getMonth() + 1);
  const [data, setData] = useState<DREData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ ano: String(ano) });
      if (mes) params.set('mes', String(mes));
      const res = await authFetch(`/api/fin/dre?${params}`);
      if (res.ok) setData(await res.json());
    } finally {
      setLoading(false);
    }
  }, [ano, mes]);

  useEffect(() => { load(); }, [load]);

  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const exportar = () => {
    if (!data) return;
    const linhas: any[] = [];
    data.linhas.forEach(l => {
      linhas.push({ Grupo: l.grupo_nome, Categoria: '', Valor: l.total_grupo });
      l.categorias.forEach(c => {
        linhas.push({ Grupo: '', Categoria: c.categoria_nome, Valor: c.total });
      });
      if (l.total_parcial_apos) {
        linhas.push({ Grupo: l.total_parcial_apos, Categoria: '', Valor: data.totais_parciais[l.total_parcial_apos] ?? '' });
      }
    });
    linhas.push({ Grupo: 'RESULTADO LÍQUIDO', Categoria: '', Valor: data.resultado_liquido });
    exportCSV(linhas, `dre_${ano}${mes ? `_${String(mes).padStart(2, '0')}` : ''}.csv`);
  };

  const anos = Array.from({ length: 5 }, (_, i) => hoje.getFullYear() - i);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">DRE</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Demonstrativo de Resultado do Exercício
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={mes ?? ''}
            onChange={e => setMes(e.target.value ? parseInt(e.target.value) : null)}
            className="text-sm px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500"
          >
            <option value="">Ano inteiro</option>
            {MESES.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
          </select>
          <select
            value={ano}
            onChange={e => setAno(parseInt(e.target.value))}
            className="text-sm px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500"
          >
            {anos.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          <button
            onClick={exportar}
            className="text-sm px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            Exportar CSV
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-40">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-violet-600" />
        </div>
      ) : !data ? (
        <div className="text-center py-12 text-gray-400 dark:text-gray-500 text-sm">
          Sem dados para o período selecionado.
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div className="px-4 py-3 bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700">
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
              {data.periodo}
            </p>
          </div>

          <div className="divide-y divide-gray-100 dark:divide-gray-700/50">
            {data.linhas.map(linha => {
              const isExpanded = expanded.has(linha.grupo_id);
              const isPositive = linha.total_grupo >= 0;
              const isReceita = linha.tipo === 'receita';

              return (
                <React.Fragment key={linha.grupo_id}>
                  {/* Linha do grupo */}
                  <button
                    onClick={() => toggleExpand(linha.grupo_id)}
                    className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/30 text-left"
                  >
                    <div className="flex items-center gap-2">
                      {isExpanded
                        ? <ChevronDown className="w-4 h-4 text-gray-400" />
                        : <ChevronRight className="w-4 h-4 text-gray-400" />
                      }
                      <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">
                        {linha.grupo_nome}
                      </span>
                    </div>
                    <span className={`text-sm font-bold ${
                      isReceita
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : linha.total_grupo > 0
                          ? 'text-red-600 dark:text-red-400'
                          : 'text-gray-500 dark:text-gray-400'
                    }`}>
                      {linha.operacao === 'subtrai' && linha.total_grupo > 0 ? '−' : ''}
                      {fmtBRL(Math.abs(linha.total_grupo))}
                    </span>
                  </button>

                  {/* Detalhamento por categoria */}
                  {isExpanded && linha.categorias.map(cat => (
                    <div
                      key={cat.categoria_id ?? cat.categoria_nome}
                      className="flex items-center justify-between px-4 py-2 pl-10 bg-gray-50/50 dark:bg-gray-700/20"
                    >
                      <span className="text-xs text-gray-600 dark:text-gray-400">{cat.categoria_nome}</span>
                      <span className="text-xs font-medium text-gray-700 dark:text-gray-300">{fmtBRL(cat.total)}</span>
                    </div>
                  ))}

                  {/* Total parcial */}
                  {linha.total_parcial_apos && (
                    <div className="flex items-center justify-between px-4 py-3 bg-gray-100 dark:bg-gray-700/60">
                      <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                        {linha.total_parcial_apos}
                      </span>
                      <span className={`text-sm font-bold ${
                        (data.totais_parciais[linha.total_parcial_apos] ?? 0) >= 0
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-red-600 dark:text-red-400'
                      }`}>
                        {fmtBRL(data.totais_parciais[linha.total_parcial_apos] ?? 0)}
                      </span>
                    </div>
                  )}
                </React.Fragment>
              );
            })}

            {/* Resultado Líquido */}
            <div className={`flex items-center justify-between px-4 py-4 ${
              data.resultado_liquido >= 0
                ? 'bg-emerald-50 dark:bg-emerald-900/20'
                : 'bg-red-50 dark:bg-red-900/20'
            }`}>
              <div className="flex items-center gap-2">
                {data.resultado_liquido >= 0
                  ? <TrendingUp className="w-5 h-5 text-emerald-500" />
                  : <TrendingDown className="w-5 h-5 text-red-500" />
                }
                <span className="text-base font-bold text-gray-900 dark:text-white">
                  Resultado Líquido
                </span>
              </div>
              <span className={`text-base font-bold ${
                data.resultado_liquido >= 0
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-red-600 dark:text-red-400'
              }`}>
                {fmtBRL(data.resultado_liquido)}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

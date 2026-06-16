import React, { useState } from 'react';
import { Download, BarChart3, Users, Tag, Camera, ChevronDown, ChevronRight, Package, Image } from 'lucide-react';
import { FinSelect } from './FinInputs';
import { authFetch } from '../../utils/authFetch';
import { fmtBRL, exportCSV } from './finUtils';

const MESES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

type RelatorioTipo = 'vendas_tipo' | 'receitas_categoria' | 'despesas_categoria' | 'receitas_cliente' | 'fluxo_mensal';

interface RelatorioCfg {
  key: RelatorioTipo;
  label: string;
  desc: string;
  icon: React.ElementType;
  color: string;
}

const RELATORIOS: RelatorioCfg[] = [
  { key: 'vendas_tipo', label: 'Vendas por Tipo de Ensaio', desc: 'Ensaios vendidos por categoria, com pacotes e extras (foto avulsa, álbum, produtos)', icon: Camera, color: 'text-gold-500' },
  { key: 'receitas_categoria', label: 'Receitas por Categoria', desc: 'Receitas agrupadas por categoria no período', icon: Tag, color: 'text-emerald-500' },
  { key: 'despesas_categoria', label: 'Despesas por Categoria', desc: 'Despesas agrupadas por categoria no período', icon: Tag, color: 'text-red-500' },
  { key: 'receitas_cliente', label: 'Receitas por Cliente', desc: 'Ranking de clientes por receita gerada', icon: Users, color: 'text-blue-500' },
  { key: 'fluxo_mensal', label: 'Fluxo Mensal', desc: 'Receitas x despesas mês a mês no período', icon: BarChart3, color: 'text-violet-500' },
];

interface VendaPacote { nome: string; quantidade: number; valor: number }
interface VendaExtra { nome: string; tipo: string; quantidade: number; valor: number }
interface VendaCategoria { tipo: string; numEnsaios: number; valorEnsaios: number; valorExtras: number; valorTotal: number; pacotes: VendaPacote[]; extras: VendaExtra[] }
interface VendasReport { totais: { numEnsaios: number; valorEnsaios: number; valorExtras: number; valorTotal: number }; categorias: VendaCategoria[] }

interface ResultadoLinha {
  [key: string]: string | number;
}

export default function Relatorios() {
  const hoje = new Date();
  const [ano, setAno] = useState(hoje.getFullYear());
  const [mesInicio, setMesInicio] = useState(1);
  const [mesFim, setMesFim] = useState(hoje.getMonth() + 1);
  const [tipo, setTipo] = useState<RelatorioTipo>('vendas_tipo');
  const [resultado, setResultado] = useState<ResultadoLinha[] | null>(null);
  const [vendas, setVendas] = useState<VendasReport | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);

  const anos = Array.from({ length: 5 }, (_, i) => hoje.getFullYear() - i);

  const gerar = async () => {
    setLoading(true);
    try {
      if (tipo === 'vendas_tipo') {
        const params = new URLSearchParams({ ano: String(ano), mes_inicio: String(mesInicio), mes_fim: String(mesFim) });
        const res = await authFetch(`/api/relatorios/vendas-por-tipo?${params}`);
        if (res.ok) { setVendas(await res.json()); setResultado(null); }
      } else {
        const params = new URLSearchParams({ tipo, ano: String(ano), mes_inicio: String(mesInicio), mes_fim: String(mesFim) });
        const res = await authFetch(`/api/fin/relatorios?${params}`);
        if (res.ok) { setResultado(await res.json()); setVendas(null); }
      }
    } finally {
      setLoading(false);
    }
  };

  const baixarCSV = () => {
    if (tipo === 'vendas_tipo') {
      if (!vendas?.categorias.length) return;
      const rows: ResultadoLinha[] = [];
      for (const c of vendas.categorias) {
        rows.push({ Categoria: c.tipo, Item: 'TOTAL DA CATEGORIA', Tipo: '', Qtd: c.numEnsaios, 'Valor Ensaios': c.valorEnsaios, 'Valor Extras': c.valorExtras, 'Valor Total': c.valorTotal });
        for (const p of c.pacotes) rows.push({ Categoria: c.tipo, Item: p.nome, Tipo: 'pacote', Qtd: p.quantidade, 'Valor Ensaios': p.valor, 'Valor Extras': 0, 'Valor Total': p.valor });
        for (const e of c.extras) rows.push({ Categoria: c.tipo, Item: e.nome, Tipo: e.tipo, Qtd: e.quantidade, 'Valor Ensaios': 0, 'Valor Extras': e.valor, 'Valor Total': e.valor });
      }
      exportCSV(rows, `vendas_por_tipo_${ano}.csv`);
      return;
    }
    if (!resultado?.length) return;
    const cfg = RELATORIOS.find(r => r.key === tipo)!;
    exportCSV(resultado, `${cfg.key}_${ano}.csv`);
  };

  const toggleCat = (tipoCat: string) =>
    setExpanded(prev => { const n = new Set(prev); n.has(tipoCat) ? n.delete(tipoCat) : n.add(tipoCat); return n; });

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
              onClick={() => { setTipo(r.key); setResultado(null); setVendas(null); setExpanded(new Set()); }}
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
      {(resultado !== null || vendas !== null) && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <cfg.icon className={`w-4 h-4 ${cfg.color}`} />
              <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">{cfg.label}</span>
              <span className="text-xs text-gray-400">
                {MESES[mesInicio - 1]} - {MESES[mesFim - 1]} {ano}
              </span>
            </div>
            {((tipo === 'vendas_tipo' ? (vendas?.categorias.length || 0) : (resultado?.length || 0)) > 0) && (
              <button
                onClick={baixarCSV}
                className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                <Download className="w-4 h-4" /> Baixar CSV
              </button>
            )}
          </div>

          {/* ── Vendas por Tipo de Ensaio (hierárquico) ── */}
          {tipo === 'vendas_tipo' && vendas && (
            vendas.categorias.length === 0 ? (
              <div className="text-center py-10 text-gray-400 dark:text-gray-500 text-sm">Nenhum ensaio vendido no período.</div>
            ) : (
              <div className="space-y-3">
                {/* Totais */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3">
                    <p className="text-[11px] uppercase font-semibold text-gray-400">Ensaios vendidos</p>
                    <p className="text-xl font-bold text-gray-900 dark:text-white">{vendas.totais.numEnsaios}</p>
                  </div>
                  <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3">
                    <p className="text-[11px] uppercase font-semibold text-gray-400">Valor dos ensaios</p>
                    <p className="text-xl font-bold text-gray-900 dark:text-white">{fmtBRL(vendas.totais.valorEnsaios)}</p>
                  </div>
                  <div className="bg-white dark:bg-gray-800 border border-emerald-100 dark:border-emerald-900/30 rounded-xl px-4 py-3">
                    <p className="text-[11px] uppercase font-semibold text-emerald-500">Extras (avulsas/álbum/produtos)</p>
                    <p className="text-xl font-bold text-emerald-600 dark:text-emerald-400">{fmtBRL(vendas.totais.valorExtras)}</p>
                  </div>
                  <div className="bg-white dark:bg-gray-800 border border-gold-200 dark:border-gold-900/30 rounded-xl px-4 py-3">
                    <p className="text-[11px] uppercase font-semibold text-gold-500">Total geral</p>
                    <p className="text-xl font-bold text-gold-600 dark:text-gold-400">{fmtBRL(vendas.totais.valorTotal)}</p>
                  </div>
                </div>

                {/* Categorias (tipo de ensaio) */}
                {vendas.categorias.map((c) => {
                  const open = expanded.has(c.tipo);
                  return (
                    <div key={c.tipo} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
                      <button onClick={() => toggleCat(c.tipo)} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/40 text-left">
                        {open ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
                        <span className="flex-1 font-semibold text-gray-800 dark:text-gray-100">{c.tipo}</span>
                        <span className="text-xs text-gray-400">{c.numEnsaios} ensaio{c.numEnsaios === 1 ? '' : 's'}</span>
                        <span className="text-sm text-gray-500 dark:text-gray-400 hidden sm:inline">ensaios {fmtBRL(c.valorEnsaios)}</span>
                        <span className="text-sm text-emerald-600 dark:text-emerald-400 hidden sm:inline">extras {fmtBRL(c.valorExtras)}</span>
                        <span className="text-sm font-bold text-gold-600 dark:text-gold-400 w-24 text-right">{fmtBRL(c.valorTotal)}</span>
                      </button>
                      {open && (
                        <div className="border-t border-gray-100 dark:border-gray-700 px-4 py-3 space-y-3">
                          <div>
                            <p className="text-[11px] uppercase font-semibold text-gray-400 mb-1.5 flex items-center gap-1"><Package size={12} /> Pacotes vendidos</p>
                            {c.pacotes.length === 0 ? <p className="text-xs text-gray-400 italic">Sem pacotes detalhados (valor do ensaio contado pelo total do trabalho).</p> : (
                              <div className="space-y-1">
                                {c.pacotes.map((p, i) => (
                                  <div key={i} className="flex items-center gap-2 text-sm">
                                    <span className="flex-1 text-gray-700 dark:text-gray-200 truncate">{p.nome}</span>
                                    <span className="text-xs text-gray-400">{p.quantidade}x</span>
                                    <span className="font-medium text-gray-700 dark:text-gray-300 w-24 text-right">{fmtBRL(p.valor)}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                          <div>
                            <p className="text-[11px] uppercase font-semibold text-emerald-500 mb-1.5 flex items-center gap-1"><Image size={12} /> Extras vendidos</p>
                            {c.extras.length === 0 ? <p className="text-xs text-gray-400 italic">Nenhum extra vendido nessa categoria.</p> : (
                              <div className="space-y-1">
                                {c.extras.map((e, i) => (
                                  <div key={i} className="flex items-center gap-2 text-sm">
                                    <span className="flex-1 text-gray-700 dark:text-gray-200 truncate">{e.nome}</span>
                                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-400">{e.tipo}</span>
                                    <span className="text-xs text-gray-400">{e.quantidade}x</span>
                                    <span className="font-medium text-emerald-600 dark:text-emerald-400 w-24 text-right">{fmtBRL(e.valor)}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )
          )}

          {/* ── Demais relatórios (tabela plana) ── */}
          {tipo !== 'vendas_tipo' && resultado && (resultado.length === 0 ? (
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
          ))}
        </div>
      )}
    </div>
  );
}

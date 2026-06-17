import React, { useState } from 'react';
import { Download, BarChart3, Users, Tag, Camera, ChevronDown, ChevronRight, Package, AlertCircle, ArrowDownCircle, ArrowUpCircle, User } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { authFetch } from '../../utils/authFetch';
import { fmtBRL, exportCSV } from './finUtils';
import { DateRangePicker, buildPresetRange, fromDateOnly, type DateRange } from '../ui/DateRangePicker';

type RelatorioTipo = 'vendas_tipo' | 'receitas_categoria' | 'despesas_categoria' | 'receitas_cliente' | 'fluxo_mensal';

interface RelatorioCfg {
  key: RelatorioTipo;
  label: string;
  desc: string;
  icon: React.ElementType;
  color: string;
}

const RELATORIOS: RelatorioCfg[] = [
  { key: 'vendas_tipo', label: 'Vendas por Tipo de Ensaio', desc: 'Ensaios realizados por categoria, com pacotes, pessoas e produtos vendidos', icon: Camera, color: 'text-gold-500' },
  { key: 'receitas_categoria', label: 'Receitas por Categoria', desc: 'Receitas agrupadas por categoria no período', icon: Tag, color: 'text-emerald-500' },
  { key: 'despesas_categoria', label: 'Despesas por Categoria', desc: 'Despesas agrupadas por categoria no período', icon: Tag, color: 'text-red-500' },
  { key: 'receitas_cliente', label: 'Receitas por Cliente', desc: 'Ranking de clientes por receita gerada', icon: Users, color: 'text-blue-500' },
  { key: 'fluxo_mensal', label: 'Fluxo Mensal', desc: 'Receitas x despesas mês a mês no período', icon: BarChart3, color: 'text-violet-500' },
];

interface VendaProduto { nome: string; tipo: string; qtd?: number; quantidade?: number; valor: number }
interface VendaCliente { nome: string; data: string; valor: number; produtos: VendaProduto[]; totalProdutos: number }
interface VendaPacote { nome: string; quantidade: number; valor: number; clientes: VendaCliente[] }
interface VendaCategoria {
  tipo: string; numEnsaios: number;
  valorEnsaios: number; valorExtras: number; valorTotal: number; valorProdutos: number;
  pacotes: VendaPacote[]; produtos: VendaProduto[];
}
interface VendasReport {
  totais: { numEnsaios: number; valorEnsaios: number; valorExtras: number; valorTotal: number; valorProdutos: number };
  categorias: VendaCategoria[];
}
interface EntradaSaida { entrada: number; saida: number; lucro: number }

interface ResultadoLinha {
  [key: string]: string | number;
}

const fmtData = (d: string) => {
  if (!d) return '-';
  try { return format(fromDateOnly(d), 'dd/MM/yyyy'); } catch { return d; }
};
const qtdProd = (p: VendaProduto) => p.quantidade ?? p.qtd ?? 1;

export default function Relatorios() {
  const [range, setRange] = useState<DateRange>(() => buildPresetRange('month'));
  const [tipo, setTipo] = useState<RelatorioTipo>('vendas_tipo');
  const [resultado, setResultado] = useState<ResultadoLinha[] | null>(null);
  const [vendas, setVendas] = useState<VendasReport | null>(null);
  const [entradaSaida, setEntradaSaida] = useState<EntradaSaida | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [expandedPkg, setExpandedPkg] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);

  const rangeLabel =
    `${format(fromDateOnly(range.from), 'dd MMM yyyy', { locale: ptBR })} – ${format(fromDateOnly(range.to), 'dd MMM yyyy', { locale: ptBR })}`;

  const gerar = async () => {
    setLoading(true);
    try {
      // Entrada x Saída do período (sempre, junto de qualquer relatório).
      authFetch(`/api/relatorios/entrada-saida?from=${range.from}&to=${range.to}`)
        .then(r => r.ok ? r.json() : null)
        .then(d => setEntradaSaida(d))
        .catch(() => setEntradaSaida(null));

      if (tipo === 'vendas_tipo') {
        const params = new URLSearchParams({ from: range.from, to: range.to });
        const res = await authFetch(`/api/relatorios/vendas-por-tipo?${params}`);
        if (res.ok) { setVendas(await res.json()); setResultado(null); }
      } else {
        const params = new URLSearchParams({ tipo, from: range.from, to: range.to });
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
        rows.push({ Categoria: c.tipo, Linha: 'TOTAL DA CATEGORIA', Pacote: '', Cliente: '', Data: '', Qtd: c.numEnsaios, Faturamento: c.valorTotal, 'Produtos (fora do faturamento)': c.valorProdutos, 'Produtos detalhe': '' });
        for (const p of c.pacotes) {
          rows.push({ Categoria: c.tipo, Linha: 'Pacote', Pacote: p.nome, Cliente: '', Data: '', Qtd: p.quantidade, Faturamento: p.valor, 'Produtos (fora do faturamento)': 0, 'Produtos detalhe': '' });
          for (const cl of p.clientes) {
            rows.push({
              Categoria: c.tipo, Linha: 'Pessoa', Pacote: p.nome, Cliente: cl.nome, Data: cl.data, Qtd: 1,
              Faturamento: cl.valor, 'Produtos (fora do faturamento)': cl.totalProdutos,
              'Produtos detalhe': cl.produtos.map(x => `${x.nome} ${qtdProd(x)}x (${fmtBRL(x.valor)})`).join(' | '),
            });
          }
        }
        // Resumo de produtos da categoria (fora do faturamento), espelhando a UI
        for (const pr of c.produtos) {
          rows.push({ Categoria: c.tipo, Linha: 'Produto (fora do faturamento)', Pacote: '', Cliente: '', Data: '', Qtd: qtdProd(pr), Faturamento: 0, 'Produtos (fora do faturamento)': pr.valor, 'Produtos detalhe': pr.nome });
        }
      }
      exportCSV(rows, `vendas_por_tipo_${range.from}_a_${range.to}.csv`);
      return;
    }
    if (!resultado?.length) return;
    const cfg = RELATORIOS.find(r => r.key === tipo)!;
    exportCSV(resultado, `${cfg.key}_${range.from}_a_${range.to}.csv`);
  };

  const toggleCat = (tipoCat: string) =>
    setExpanded(prev => { const n = new Set(prev); n.has(tipoCat) ? n.delete(tipoCat) : n.add(tipoCat); return n; });
  const togglePkg = (key: string) =>
    setExpandedPkg(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });

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
              onClick={() => { setTipo(r.key); setResultado(null); setVendas(null); setExpanded(new Set()); setExpandedPkg(new Set()); }}
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
        <div className="flex items-baseline justify-between gap-2 mb-3">
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Período</p>
          {tipo === 'vendas_tipo' && (
            <p className="text-xs text-gray-400 dark:text-gray-500">Conta pelos ensaios <span className="font-medium">realizados</span> no período (data do ensaio)</p>
          )}
        </div>
        <div className="flex flex-wrap gap-3 items-center justify-between">
          <DateRangePicker range={range} onChange={setRange} />
          <button
            onClick={gerar}
            disabled={loading}
            className="px-4 py-2 text-sm rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 whitespace-nowrap"
          >
            {loading ? 'Gerando...' : 'Gerar Relatório'}
          </button>
        </div>
      </div>

      {/* Resultado */}
      {(resultado !== null || vendas !== null) && (
        <div className="space-y-3">
          {/* Entrada x Saída x Lucro do período */}
          {entradaSaida && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="bg-white dark:bg-gray-800 border border-emerald-100 dark:border-emerald-900/30 rounded-xl px-4 py-3 flex items-center gap-3">
                <span className="w-9 h-9 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 flex items-center justify-center"><ArrowUpCircle className="w-5 h-5 text-emerald-500" /></span>
                <div className="min-w-0">
                  <p className="text-[11px] uppercase font-semibold text-emerald-500">Entrada (recebido)</p>
                  <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400 truncate">{fmtBRL(entradaSaida.entrada)}</p>
                </div>
              </div>
              <div className="bg-white dark:bg-gray-800 border border-red-100 dark:border-red-900/30 rounded-xl px-4 py-3 flex items-center gap-3">
                <span className="w-9 h-9 rounded-lg bg-red-50 dark:bg-red-900/20 flex items-center justify-center"><ArrowDownCircle className="w-5 h-5 text-red-500" /></span>
                <div className="min-w-0">
                  <p className="text-[11px] uppercase font-semibold text-red-500">Saída (despesas pagas)</p>
                  <p className="text-lg font-bold text-red-600 dark:text-red-400 truncate">{fmtBRL(entradaSaida.saida)}</p>
                </div>
              </div>
              <div className="bg-white dark:bg-gray-800 border border-gold-200 dark:border-gold-900/30 rounded-xl px-4 py-3 flex items-center gap-3">
                <span className="w-9 h-9 rounded-lg bg-gold-50 dark:bg-gold-900/20 flex items-center justify-center"><BarChart3 className="w-5 h-5 text-gold-500" /></span>
                <div className="min-w-0">
                  <p className="text-[11px] uppercase font-semibold text-gold-500">Lucro do período</p>
                  <p className={`text-lg font-bold truncate ${entradaSaida.lucro >= 0 ? 'text-gold-600 dark:text-gold-400' : 'text-red-600 dark:text-red-400'}`}>{fmtBRL(entradaSaida.lucro)}</p>
                </div>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <cfg.icon className={`w-4 h-4 ${cfg.color}`} />
              <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">{cfg.label}</span>
              <span className="text-xs text-gray-400">{rangeLabel}</span>
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
              <div className="text-center py-10 text-gray-400 dark:text-gray-500 text-sm">Nenhum ensaio realizado no período.</div>
            ) : (
              <div className="space-y-3">
                {/* Totais */}
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3">
                    <p className="text-[11px] uppercase font-semibold text-gray-400">Ensaios realizados</p>
                    <p className="text-xl font-bold text-gray-900 dark:text-white">{vendas.totais.numEnsaios}</p>
                  </div>
                  <div className="bg-white dark:bg-gray-800 border border-gold-200 dark:border-gold-900/30 rounded-xl px-4 py-3">
                    <p className="text-[11px] uppercase font-semibold text-gold-500">Faturamento (ensaios)</p>
                    <p className="text-xl font-bold text-gold-600 dark:text-gold-400">{fmtBRL(vendas.totais.valorTotal)}</p>
                  </div>
                  <div className="bg-white dark:bg-gray-800 border border-amber-200 dark:border-amber-900/30 rounded-xl px-4 py-3">
                    <p className="text-[11px] uppercase font-semibold text-amber-500 flex items-center gap-1"><AlertCircle size={12} /> Produtos vendidos</p>
                    <p className="text-xl font-bold text-amber-600 dark:text-amber-400">{fmtBRL(vendas.totais.valorProdutos)}</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">não somado no faturamento</p>
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
                        {c.valorProdutos > 0 && (
                          <span className="text-xs text-amber-600 dark:text-amber-400 hidden sm:inline flex items-center gap-1"><AlertCircle size={11} /> produtos {fmtBRL(c.valorProdutos)}</span>
                        )}
                        <span className="text-sm font-bold text-gold-600 dark:text-gold-400 w-24 text-right">{fmtBRL(c.valorTotal)}</span>
                      </button>
                      {open && (
                        <div className="border-t border-gray-100 dark:border-gray-700 px-4 py-3 space-y-3">
                          {/* Pacotes → pessoas */}
                          <div>
                            <p className="text-[11px] uppercase font-semibold text-gray-400 mb-1.5 flex items-center gap-1"><Package size={12} /> Pacotes &amp; pessoas</p>
                            {c.pacotes.length === 0 ? <p className="text-xs text-gray-400 italic">Sem pacotes detalhados.</p> : (
                              <div className="space-y-1">
                                {c.pacotes.map((p, i) => {
                                  const pkgKey = `${c.tipo}::${p.nome}`;
                                  const pOpen = expandedPkg.has(pkgKey);
                                  return (
                                    <div key={i} className="rounded-lg border border-gray-100 dark:border-gray-700/60 overflow-hidden">
                                      <button onClick={() => togglePkg(pkgKey)} className="w-full flex items-center gap-2 px-2.5 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-700/40 text-left">
                                        {pOpen ? <ChevronDown className="w-3.5 h-3.5 text-gray-400" /> : <ChevronRight className="w-3.5 h-3.5 text-gray-400" />}
                                        <span className="flex-1 text-gray-700 dark:text-gray-200 truncate font-medium">{p.nome}</span>
                                        <span className="text-xs text-gray-400">{p.quantidade}x</span>
                                        <span className="font-semibold text-gray-700 dark:text-gray-300 w-24 text-right">{fmtBRL(p.valor)}</span>
                                      </button>
                                      {pOpen && (
                                        <div className="bg-gray-50/60 dark:bg-gray-900/30 px-2.5 py-2 space-y-1.5">
                                          {p.clientes.map((cl, j) => (
                                            <div key={j} className="text-sm">
                                              <div className="flex items-center gap-2">
                                                <User size={12} className="text-gray-400 flex-shrink-0" />
                                                <span className="flex-1 text-gray-700 dark:text-gray-200 truncate">{cl.nome}</span>
                                                <span className="text-[11px] text-gray-400">{fmtData(cl.data)}</span>
                                                <span className="font-medium text-gray-600 dark:text-gray-300 w-20 text-right">{fmtBRL(cl.valor)}</span>
                                              </div>
                                              {cl.totalProdutos > 0 && (
                                                <div className="ml-5 mt-1 rounded-md bg-amber-50 dark:bg-amber-900/15 border border-amber-100 dark:border-amber-900/30 px-2 py-1">
                                                  <p className="text-[10px] font-semibold text-amber-600 dark:text-amber-400 flex items-center gap-1">
                                                    <AlertCircle size={10} /> Comprou a mais (não incluído no faturamento): {fmtBRL(cl.totalProdutos)}
                                                  </p>
                                                  <ul className="mt-0.5 space-y-0.5">
                                                    {cl.produtos.map((pr, k) => (
                                                      <li key={k} className="text-[11px] text-amber-700/90 dark:text-amber-300/90 flex items-center gap-1">
                                                        <span className="flex-1 truncate">{pr.nome} · {qtdProd(pr)}x</span>
                                                        <span>{fmtBRL(pr.valor)}</span>
                                                      </li>
                                                    ))}
                                                  </ul>
                                                </div>
                                              )}
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>

                          {/* Produtos da categoria (resumo, fora do faturamento) */}
                          {c.produtos.length > 0 && (
                            <div>
                              <p className="text-[11px] uppercase font-semibold text-amber-500 mb-1.5 flex items-center gap-1"><AlertCircle size={12} /> Produtos vendidos nessa categoria <span className="text-gray-400 normal-case font-normal">(fora do faturamento)</span></p>
                              <div className="space-y-1">
                                {c.produtos.map((e, i) => (
                                  <div key={i} className="flex items-center gap-2 text-sm">
                                    <span className="flex-1 text-gray-700 dark:text-gray-200 truncate">{e.nome}</span>
                                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-400">{e.tipo}</span>
                                    <span className="text-xs text-gray-400">{qtdProd(e)}x</span>
                                    <span className="font-medium text-amber-600 dark:text-amber-400 w-24 text-right">{fmtBRL(e.valor)}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
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

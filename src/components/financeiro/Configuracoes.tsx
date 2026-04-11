import React, { useEffect, useState, useCallback } from 'react';
import { Plus, Trash2, Edit2, Save, X, Tag, Wallet, CreditCard, BarChart3 } from 'lucide-react';
import { authFetch } from '../../utils/authFetch';
import {
  CATEGORIAS_RECEITA_PADRAO, CATEGORIAS_DESPESA_PADRAO,
  MEIOS_PADRAO, GRUPOS_DRE_PADRAO,
} from './finUtils';

interface Categoria { id: string; nome: string; cor: string; tipo: string; }
interface Meio { id: string; nome: string; tipo: string; taxa_percentual: number; taxa_fixa: number; prazo_recebimento: number; }
interface Conta { id: string; nome: string; tipo: string; banco?: string; saldo_inicial: number; }
interface GrupoDRE { id: string; nome: string; tipo: string; operacao: string; ordem: number; total_parcial_apos?: string; }

type SecaoAtiva = 'categorias' | 'meios' | 'contas' | 'dre';

export default function Configuracoes() {
  const [secao, setSecao] = useState<SecaoAtiva>('categorias');
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [meios, setMeios] = useState<Meio[]>([]);
  const [contas, setContas] = useState<Conta[]>([]);
  const [gruposDRE, setGruposDRE] = useState<GrupoDRE[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Forms
  const [novaCategoria, setNovaCategoria] = useState({ nome: '', cor: '#6366f1', tipo: 'receita' });
  const [novaMeio, setNovaMeio] = useState({ nome: '', tipo: 'pix', taxa_percentual: '0', taxa_fixa: '0', prazo_recebimento: '0' });
  const [novaConta, setNovaConta] = useState({ nome: '', tipo: 'corrente', banco: '', saldo_inicial: '0' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cRes, mRes, ctRes, dRes] = await Promise.all([
        authFetch('/api/fin/categorias'),
        authFetch('/api/fin/meios'),
        authFetch('/api/fin/contas'),
        authFetch('/api/fin/grupos-dre'),
      ]);
      if (cRes.ok) setCategorias(await cRes.json());
      if (mRes.ok) setMeios(await mRes.json());
      if (ctRes.ok) setContas(await ctRes.json());
      if (dRes.ok) setGruposDRE(await dRes.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Categorias ──────────────────────────────────────────────
  const addCategoria = async () => {
    if (!novaCategoria.nome) return;
    setSaving(true);
    try {
      const res = await authFetch('/api/fin/categorias', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(novaCategoria),
      });
      if (res.ok) {
        const nova = await res.json();
        setCategorias(prev => [...prev, nova]);
        setNovaCategoria(f => ({ ...f, nome: '' }));
      }
    } finally { setSaving(false); }
  };

  const delCategoria = async (id: string) => {
    if (!confirm('Excluir categoria?')) return;
    const res = await authFetch(`/api/fin/categorias/${id}`, { method: 'DELETE' });
    if (res.ok) setCategorias(prev => prev.filter(c => c.id !== id));
  };

  const seedCategorias = async () => {
    setSaving(true);
    try {
      for (const c of [...CATEGORIAS_RECEITA_PADRAO, ...CATEGORIAS_DESPESA_PADRAO]) {
        const tipo = CATEGORIAS_RECEITA_PADRAO.includes(c) ? 'receita' : 'despesa';
        await authFetch('/api/fin/categorias', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...c, tipo }),
        });
      }
      await load();
    } finally { setSaving(false); }
  };

  // ── Meios ───────────────────────────────────────────────────
  const addMeio = async () => {
    if (!novaMeio.nome) return;
    setSaving(true);
    try {
      const res = await authFetch('/api/fin/meios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nome: novaMeio.nome,
          tipo: novaMeio.tipo,
          taxa_percentual: parseFloat(novaMeio.taxa_percentual),
          taxa_fixa: parseFloat(novaMeio.taxa_fixa),
          prazo_recebimento: parseInt(novaMeio.prazo_recebimento),
        }),
      });
      if (res.ok) {
        const novo = await res.json();
        setMeios(prev => [...prev, novo]);
        setNovaMeio(f => ({ ...f, nome: '' }));
      }
    } finally { setSaving(false); }
  };

  const delMeio = async (id: string) => {
    if (!confirm('Excluir meio de pagamento?')) return;
    const res = await authFetch(`/api/fin/meios/${id}`, { method: 'DELETE' });
    if (res.ok) setMeios(prev => prev.filter(m => m.id !== id));
  };

  const seedMeios = async () => {
    setSaving(true);
    try {
      for (const m of MEIOS_PADRAO) {
        await authFetch('/api/fin/meios', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(m),
        });
      }
      await load();
    } finally { setSaving(false); }
  };

  // ── Contas ──────────────────────────────────────────────────
  const addConta = async () => {
    if (!novaConta.nome) return;
    setSaving(true);
    try {
      const res = await authFetch('/api/fin/contas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nome: novaConta.nome,
          tipo: novaConta.tipo,
          banco: novaConta.banco || null,
          saldo_inicial: parseFloat(novaConta.saldo_inicial),
        }),
      });
      if (res.ok) {
        const nova = await res.json();
        setContas(prev => [...prev, nova]);
        setNovaConta({ nome: '', tipo: 'corrente', banco: '', saldo_inicial: '0' });
      }
    } finally { setSaving(false); }
  };

  const delConta = async (id: string) => {
    if (!confirm('Excluir conta?')) return;
    const res = await authFetch(`/api/fin/contas/${id}`, { method: 'DELETE' });
    if (res.ok) setContas(prev => prev.filter(c => c.id !== id));
  };

  const SECOES: Array<{ key: SecaoAtiva; label: string; icon: React.ElementType }> = [
    { key: 'categorias', label: 'Categorias', icon: Tag },
    { key: 'meios', label: 'Meios de Pagamento', icon: CreditCard },
    { key: 'contas', label: 'Contas', icon: Wallet },
    { key: 'dre', label: 'Grupos DRE', icon: BarChart3 },
  ];

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Configurações Financeiras</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">Gerencie categorias, meios de pagamento e contas</p>
      </div>

      {/* Abas internas */}
      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700">
        {SECOES.map(s => {
          const Icon = s.icon;
          return (
            <button
              key={s.key}
              onClick={() => setSecao(s.key)}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
                secao === s.key
                  ? 'border-violet-500 text-violet-600 dark:text-violet-400'
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
              }`}
            >
              <Icon className="w-4 h-4" />
              {s.label}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-32">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-violet-600" />
        </div>
      ) : (
        <>
          {/* ── CATEGORIAS ────────────────────────────────── */}
          {secao === 'categorias' && (
            <div className="space-y-4">
              {categorias.length === 0 && (
                <div className="text-center py-6">
                  <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">Nenhuma categoria cadastrada.</p>
                  <button
                    onClick={seedCategorias}
                    disabled={saving}
                    className="text-sm px-4 py-2 rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50"
                  >
                    Criar categorias padrão
                  </button>
                </div>
              )}
              {categorias.length > 0 && (
                <>
                  {(['receita', 'despesa'] as const).map(tipo => {
                    const cats = categorias.filter(c => c.tipo === tipo);
                    if (!cats.length) return null;
                    return (
                      <div key={tipo}>
                        <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
                          {tipo === 'receita' ? 'Receitas' : 'Despesas'}
                        </p>
                        <div className="space-y-1">
                          {cats.map(c => (
                            <div key={c.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
                              <div className="flex items-center gap-2">
                                <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: c.cor }} />
                                <span className="text-sm text-gray-800 dark:text-gray-200">{c.nome}</span>
                              </div>
                              <button onClick={() => delCategoria(c.id)} className="text-gray-400 hover:text-red-500">
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </>
              )}
              {/* Formulário nova categoria */}
              <div className="flex gap-2 pt-2">
                <input
                  value={novaCategoria.nome}
                  onChange={e => setNovaCategoria(f => ({ ...f, nome: e.target.value }))}
                  placeholder="Nome da categoria"
                  className="flex-1 px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
                <select
                  value={novaCategoria.tipo}
                  onChange={e => setNovaCategoria(f => ({ ...f, tipo: e.target.value }))}
                  className="px-2 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500"
                >
                  <option value="receita">Receita</option>
                  <option value="despesa">Despesa</option>
                </select>
                <input
                  type="color"
                  value={novaCategoria.cor}
                  onChange={e => setNovaCategoria(f => ({ ...f, cor: e.target.value }))}
                  className="w-10 h-9 rounded-lg border border-gray-200 dark:border-gray-700 cursor-pointer"
                />
                <button
                  onClick={addCategoria}
                  disabled={saving || !novaCategoria.nome}
                  className="px-3 py-1.5 text-sm rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* ── MEIOS ─────────────────────────────────────── */}
          {secao === 'meios' && (
            <div className="space-y-4">
              {meios.length === 0 && (
                <div className="text-center py-6">
                  <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">Nenhum meio de pagamento cadastrado.</p>
                  <button
                    onClick={seedMeios}
                    disabled={saving}
                    className="text-sm px-4 py-2 rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50"
                  >
                    Criar meios padrão
                  </button>
                </div>
              )}
              {meios.length > 0 && (
                <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400">
                        <th className="text-left px-4 py-3 font-medium">Nome</th>
                        <th className="text-left px-4 py-3 font-medium">Tipo</th>
                        <th className="text-right px-4 py-3 font-medium">Taxa %</th>
                        <th className="text-right px-4 py-3 font-medium">Taxa Fixa</th>
                        <th className="text-right px-4 py-3 font-medium">Prazo (dias)</th>
                        <th className="px-4 py-3" />
                      </tr>
                    </thead>
                    <tbody>
                      {meios.map(m => (
                        <tr key={m.id} className="border-b border-gray-50 dark:border-gray-700/50 last:border-0">
                          <td className="px-4 py-2.5 font-medium text-gray-800 dark:text-gray-200">{m.nome}</td>
                          <td className="px-4 py-2.5 text-gray-500 dark:text-gray-400">{m.tipo}</td>
                          <td className="px-4 py-2.5 text-right text-gray-700 dark:text-gray-300">{m.taxa_percentual}%</td>
                          <td className="px-4 py-2.5 text-right text-gray-700 dark:text-gray-300">R$ {m.taxa_fixa.toFixed(2)}</td>
                          <td className="px-4 py-2.5 text-right text-gray-700 dark:text-gray-300">{m.prazo_recebimento}</td>
                          <td className="px-4 py-2.5">
                            <button onClick={() => delMeio(m.id)} className="text-gray-400 hover:text-red-500">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {/* Formulário novo meio */}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                <input
                  value={novaMeio.nome}
                  onChange={e => setNovaMeio(f => ({ ...f, nome: e.target.value }))}
                  placeholder="Nome"
                  className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
                <select
                  value={novaMeio.tipo}
                  onChange={e => setNovaMeio(f => ({ ...f, tipo: e.target.value }))}
                  className="px-2 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500"
                >
                  {['pix', 'dinheiro', 'transferencia', 'debito', 'credito', 'boleto', 'link_pagamento'].map(t => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
                <input
                  value={novaMeio.taxa_percentual}
                  onChange={e => setNovaMeio(f => ({ ...f, taxa_percentual: e.target.value }))}
                  placeholder="Taxa %"
                  type="number"
                  step="0.01"
                  className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
                <input
                  value={novaMeio.prazo_recebimento}
                  onChange={e => setNovaMeio(f => ({ ...f, prazo_recebimento: e.target.value }))}
                  placeholder="Prazo dias"
                  type="number"
                  className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
                <button
                  onClick={addMeio}
                  disabled={saving || !novaMeio.nome}
                  className="flex items-center justify-center gap-1 px-3 py-1.5 text-sm rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50"
                >
                  <Plus className="w-4 h-4" /> Adicionar
                </button>
              </div>
            </div>
          )}

          {/* ── CONTAS ────────────────────────────────────── */}
          {secao === 'contas' && (
            <div className="space-y-4">
              {contas.length === 0 && (
                <p className="text-sm text-gray-500 dark:text-gray-400 py-4 text-center">
                  Nenhuma conta cadastrada. Adicione suas contas bancárias abaixo.
                </p>
              )}
              {contas.length > 0 && (
                <div className="space-y-2">
                  {contas.map(c => (
                    <div key={c.id} className="flex items-center justify-between px-4 py-3 rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
                      <div>
                        <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{c.nome}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {c.tipo}{c.banco ? ` · ${c.banco}` : ''} · Saldo inicial: R$ {c.saldo_inicial.toFixed(2)}
                        </p>
                      </div>
                      <button onClick={() => delConta(c.id)} className="text-gray-400 hover:text-red-500">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <input
                  value={novaConta.nome}
                  onChange={e => setNovaConta(f => ({ ...f, nome: e.target.value }))}
                  placeholder="Nome da conta"
                  className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
                <select
                  value={novaConta.tipo}
                  onChange={e => setNovaConta(f => ({ ...f, tipo: e.target.value }))}
                  className="px-2 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500"
                >
                  <option value="corrente">Corrente</option>
                  <option value="poupanca">Poupança</option>
                  <option value="investimento">Investimento</option>
                  <option value="carteira">Carteira</option>
                </select>
                <input
                  value={novaConta.saldo_inicial}
                  onChange={e => setNovaConta(f => ({ ...f, saldo_inicial: e.target.value }))}
                  placeholder="Saldo inicial"
                  type="number"
                  step="0.01"
                  className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
                <button
                  onClick={addConta}
                  disabled={saving || !novaConta.nome}
                  className="flex items-center justify-center gap-1 px-3 py-1.5 text-sm rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50"
                >
                  <Plus className="w-4 h-4" /> Adicionar
                </button>
              </div>
            </div>
          )}

          {/* ── GRUPOS DRE ────────────────────────────────── */}
          {secao === 'dre' && (
            <div className="space-y-4">
              {gruposDRE.length === 0 && (
                <div className="text-center py-6">
                  <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">Nenhum grupo DRE configurado.</p>
                  <button
                    onClick={async () => {
                      setSaving(true);
                      try {
                        for (const g of GRUPOS_DRE_PADRAO) {
                          await authFetch('/api/fin/grupos-dre', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(g),
                          });
                        }
                        await load();
                      } finally { setSaving(false); }
                    }}
                    disabled={saving}
                    className="text-sm px-4 py-2 rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50"
                  >
                    Criar estrutura padrão
                  </button>
                </div>
              )}
              {gruposDRE.length > 0 && (
                <div className="space-y-2">
                  {gruposDRE.sort((a, b) => a.ordem - b.ordem).map(g => (
                    <div key={g.id} className="flex items-center justify-between px-4 py-3 rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-bold text-gray-400 dark:text-gray-500 w-5 text-center">{g.ordem}</span>
                        <div>
                          <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{g.nome}</p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            {g.tipo} · {g.operacao}
                            {g.total_parcial_apos ? ` → ${g.total_parcial_apos}` : ''}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

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
  const [editandoMeio, setEditandoMeio] = useState<Meio | null>(null);

  const saveMeio = async () => {
    if (!editandoMeio) return;
    setSaving(true);
    try {
      const res = await authFetch(`/api/fin/meios/${editandoMeio.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nome: editandoMeio.nome,
          tipo: editandoMeio.tipo,
          taxa_percentual: Number(editandoMeio.taxa_percentual),
          taxa_fixa: Number(editandoMeio.taxa_fixa),
          prazo_recebimento: Number(editandoMeio.prazo_recebimento),
        }),
      });
      if (res.ok) {
        setMeios(prev => prev.map(m => m.id === editandoMeio.id ? editandoMeio : m));
        setEditandoMeio(null);
      }
    } finally { setSaving(false); }
  };

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
  const [editandoConta, setEditandoConta] = useState<Conta | null>(null);

  const saveConta = async () => {
    if (!editandoConta) return;
    setSaving(true);
    try {
      const res = await authFetch(`/api/fin/contas/${editandoConta.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nome: editandoConta.nome,
          tipo: editandoConta.tipo,
          banco: editandoConta.banco || null,
          saldo_inicial: Number(editandoConta.saldo_inicial),
        }),
      });
      if (res.ok) {
        setContas(prev => prev.map(c => c.id === editandoConta.id ? editandoConta : c));
        setEditandoConta(null);
      }
    } finally { setSaving(false); }
  };

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

  // ── Grupos DRE ──────────────────────────────────────────────
  const [novoGrupo, setNovoGrupo] = useState({
    nome: '', tipo: 'despesa', operacao: 'subtrai', ordem: 0, total_parcial_apos: '',
  });
  const [editandoGrupo, setEditandoGrupo] = useState<GrupoDRE | null>(null);

  const addGrupo = async () => {
    if (!novoGrupo.nome) return;
    setSaving(true);
    try {
      const res = await authFetch('/api/fin/grupos-dre', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nome: novoGrupo.nome,
          tipo: novoGrupo.tipo,
          operacao: novoGrupo.operacao,
          ordem: Number(novoGrupo.ordem),
          total_parcial_apos: novoGrupo.total_parcial_apos || null,
        }),
      });
      if (res.ok) {
        const novo = await res.json();
        setGruposDRE(prev => [...prev, novo].sort((a, b) => a.ordem - b.ordem));
        setNovoGrupo({ nome: '', tipo: 'despesa', operacao: 'subtrai', ordem: 0, total_parcial_apos: '' });
      }
    } finally { setSaving(false); }
  };

  const saveGrupo = async () => {
    if (!editandoGrupo) return;
    setSaving(true);
    try {
      const res = await authFetch(`/api/fin/grupos-dre/${editandoGrupo.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nome: editandoGrupo.nome,
          tipo: editandoGrupo.tipo,
          operacao: editandoGrupo.operacao,
          ordem: Number(editandoGrupo.ordem),
          total_parcial_apos: editandoGrupo.total_parcial_apos || null,
        }),
      });
      if (res.ok) {
        setGruposDRE(prev => prev.map(g => g.id === editandoGrupo.id ? editandoGrupo : g).sort((a, b) => a.ordem - b.ordem));
        setEditandoGrupo(null);
      }
    } finally { setSaving(false); }
  };

  const delGrupo = async (id: string) => {
    if (!confirm('Excluir grupo DRE?')) return;
    const res = await authFetch(`/api/fin/grupos-dre/${id}`, { method: 'DELETE' });
    if (res.ok) setGruposDRE(prev => prev.filter(g => g.id !== id));
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
                  <button onClick={seedMeios} disabled={saving} className="text-sm px-4 py-2 rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50">
                    Criar meios padrão
                  </button>
                </div>
              )}
              <div className="space-y-2">
                {meios.map(m => (
                  <div key={m.id} className="rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 overflow-hidden">
                    {editandoMeio?.id === m.id ? (
                      <div className="p-4 space-y-3">
                        <div className="grid grid-cols-2 gap-2">
                          <div className="col-span-2">
                            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Nome</label>
                            <input value={editandoMeio.nome} onChange={e => setEditandoMeio(p => p ? { ...p, nome: e.target.value } : null)}
                              className="w-full text-sm px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500" />
                          </div>
                          <div>
                            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Tipo</label>
                            <select value={editandoMeio.tipo} onChange={e => setEditandoMeio(p => p ? { ...p, tipo: e.target.value } : null)}
                              className="w-full text-sm px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500">
                              {['pix', 'dinheiro', 'transferencia', 'debito', 'credito', 'boleto', 'link_pagamento'].map(t => <option key={t} value={t}>{t}</option>)}
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Taxa % <span className="text-gray-400">(ex: 2.99 para cartão)</span></label>
                            <input type="number" step="0.01" value={editandoMeio.taxa_percentual} onChange={e => setEditandoMeio(p => p ? { ...p, taxa_percentual: Number(e.target.value) } : null)}
                              className="w-full text-sm px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500" />
                          </div>
                          <div>
                            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Taxa Fixa R$ <span className="text-gray-400">(ex: 1.50)</span></label>
                            <input type="number" step="0.01" value={editandoMeio.taxa_fixa} onChange={e => setEditandoMeio(p => p ? { ...p, taxa_fixa: Number(e.target.value) } : null)}
                              className="w-full text-sm px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500" />
                          </div>
                          <div>
                            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Prazo de recebimento <span className="text-gray-400">(dias para cair na conta)</span></label>
                            <input type="number" value={editandoMeio.prazo_recebimento} onChange={e => setEditandoMeio(p => p ? { ...p, prazo_recebimento: Number(e.target.value) } : null)}
                              className="w-full text-sm px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500" />
                          </div>
                        </div>
                        <div className="flex gap-2 justify-end">
                          <button onClick={() => setEditandoMeio(null)} className="flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">
                            <X className="w-3.5 h-3.5" /> Cancelar
                          </button>
                          <button onClick={saveMeio} disabled={saving} className="flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50">
                            <Save className="w-3.5 h-3.5" /> Salvar
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between px-4 py-3">
                        <div>
                          <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{m.nome}</p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            {m.tipo}
                            {m.taxa_percentual > 0 ? ` · ${m.taxa_percentual}%` : ''}
                            {m.taxa_fixa > 0 ? ` + R$ ${m.taxa_fixa.toFixed(2)}` : ''}
                            {m.prazo_recebimento > 0 ? ` · ${m.prazo_recebimento}d para receber` : ''}
                          </p>
                        </div>
                        <div className="flex items-center gap-1">
                          <button onClick={() => setEditandoMeio(m)} className="p-1.5 rounded-lg text-gray-400 hover:text-violet-600 hover:bg-violet-50 dark:hover:bg-violet-900/20">
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button onClick={() => delMeio(m.id)} className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              {/* Formulário novo meio */}
              <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-600 p-4 space-y-3">
                <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Adicionar meio de pagamento</p>
                <div className="grid grid-cols-2 gap-2">
                  <div className="col-span-2">
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Nome</label>
                    <input value={novaMeio.nome} onChange={e => setNovaMeio(f => ({ ...f, nome: e.target.value }))} placeholder="Ex: Pix, Cartão de Crédito..."
                      className="w-full px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Tipo</label>
                    <select value={novaMeio.tipo} onChange={e => setNovaMeio(f => ({ ...f, tipo: e.target.value }))}
                      className="w-full px-2.5 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500">
                      {['pix', 'dinheiro', 'transferencia', 'debito', 'credito', 'boleto', 'link_pagamento'].map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Taxa % <span className="text-gray-400">(cobrada pela operadora)</span></label>
                    <input type="number" step="0.01" value={novaMeio.taxa_percentual} onChange={e => setNovaMeio(f => ({ ...f, taxa_percentual: e.target.value }))} placeholder="0"
                      className="w-full px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Taxa Fixa R$ <span className="text-gray-400">(por transação)</span></label>
                    <input type="number" step="0.01" value={novaMeio.taxa_fixa} onChange={e => setNovaMeio(f => ({ ...f, taxa_fixa: e.target.value }))} placeholder="0"
                      className="w-full px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Prazo <span className="text-gray-400">(dias para cair na conta)</span></label>
                    <input type="number" value={novaMeio.prazo_recebimento} onChange={e => setNovaMeio(f => ({ ...f, prazo_recebimento: e.target.value }))} placeholder="0"
                      className="w-full px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500" />
                  </div>
                </div>
                <div className="flex justify-end">
                  <button onClick={addMeio} disabled={saving || !novaMeio.nome} className="flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50">
                    <Plus className="w-4 h-4" /> Adicionar
                  </button>
                </div>
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

              {/* Lista de contas */}
              {contas.length > 0 && (
                <div className="space-y-2">
                  {contas.map(c => (
                    <div key={c.id} className="rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 overflow-hidden">
                      {editandoConta?.id === c.id ? (
                        /* Modo edição */
                        <div className="p-4 space-y-3">
                          <div className="grid grid-cols-2 gap-2">
                            <div className="col-span-2">
                              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                                Nome <span className="text-gray-400 font-normal">— como você identifica essa conta (ex: "Nubank", "Caixa Empresa")</span>
                              </label>
                              <input
                                value={editandoConta.nome}
                                onChange={e => setEditandoConta(prev => prev ? { ...prev, nome: e.target.value } : null)}
                                className="w-full text-sm px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500"
                              />
                            </div>
                            <div>
                              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                                Tipo <span className="text-gray-400 font-normal">— natureza da conta</span>
                              </label>
                              <select
                                value={editandoConta.tipo}
                                onChange={e => setEditandoConta(prev => prev ? { ...prev, tipo: e.target.value } : null)}
                                className="w-full text-sm px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500"
                              >
                                <option value="corrente">Corrente</option>
                                <option value="poupanca">Poupança</option>
                                <option value="investimento">Investimento</option>
                                <option value="carteira">Carteira / Caixa</option>
                              </select>
                            </div>
                            <div>
                              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                                Banco <span className="text-gray-400 font-normal">— opcional (ex: "Bradesco", "Inter")</span>
                              </label>
                              <input
                                value={editandoConta.banco || ''}
                                onChange={e => setEditandoConta(prev => prev ? { ...prev, banco: e.target.value } : null)}
                                placeholder="Opcional"
                                className="w-full text-sm px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500"
                              />
                            </div>
                            <div className="col-span-2">
                              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                                Saldo Inicial <span className="text-gray-400 font-normal">— quanto havia nessa conta quando você a cadastrou aqui</span>
                              </label>
                              <input
                                value={editandoConta.saldo_inicial}
                                onChange={e => setEditandoConta(prev => prev ? { ...prev, saldo_inicial: Number(e.target.value) } : null)}
                                type="number"
                                step="0.01"
                                className="w-full text-sm px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500"
                              />
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <button
                              onClick={() => saveConta(editandoConta)}
                              disabled={saving}
                              className="flex-1 text-sm py-1.5 rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50"
                            >
                              Salvar
                            </button>
                            <button
                              onClick={() => setEditandoConta(null)}
                              className="flex-1 text-sm py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                            >
                              Cancelar
                            </button>
                          </div>
                        </div>
                      ) : (
                        /* Modo leitura */
                        <div className="flex items-center justify-between px-4 py-3">
                          <div>
                            <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{c.nome}</p>
                            <p className="text-xs text-gray-500 dark:text-gray-400">
                              {c.tipo}{c.banco ? ` · ${c.banco}` : ''} · Saldo inicial: R$ {c.saldo_inicial.toFixed(2)}
                            </p>
                          </div>
                          <div className="flex gap-2">
                            <button onClick={() => setEditandoConta(c)} className="text-gray-400 hover:text-violet-500">
                              <Edit2 className="w-4 h-4" />
                            </button>
                            <button onClick={() => delConta(c.id)} className="text-gray-400 hover:text-red-500">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Formulário de adição */}
              <div className="rounded-xl border border-dashed border-gray-200 dark:border-gray-700 p-4 space-y-3">
                <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Nova conta</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="md:col-span-2">
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                      Nome <span className="text-gray-400 font-normal">— como você identifica essa conta (ex: "Nubank", "Caixa Empresa")</span>
                    </label>
                    <input
                      value={novaConta.nome}
                      onChange={e => setNovaConta(f => ({ ...f, nome: e.target.value }))}
                      placeholder="Ex: Conta Principal"
                      className="w-full px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                      Tipo <span className="text-gray-400 font-normal">— natureza da conta</span>
                    </label>
                    <select
                      value={novaConta.tipo}
                      onChange={e => setNovaConta(f => ({ ...f, tipo: e.target.value }))}
                      className="w-full px-2 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500"
                    >
                      <option value="corrente">Corrente</option>
                      <option value="poupanca">Poupança</option>
                      <option value="investimento">Investimento</option>
                      <option value="carteira">Carteira / Caixa</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                      Banco <span className="text-gray-400 font-normal">— opcional (ex: "Bradesco", "Inter")</span>
                    </label>
                    <input
                      value={novaConta.banco || ''}
                      onChange={e => setNovaConta(f => ({ ...f, banco: e.target.value }))}
                      placeholder="Opcional"
                      className="w-full px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                      Saldo Inicial <span className="text-gray-400 font-normal">— quanto havia na conta ao cadastrá-la aqui</span>
                    </label>
                    <input
                      value={novaConta.saldo_inicial}
                      onChange={e => setNovaConta(f => ({ ...f, saldo_inicial: e.target.value }))}
                      placeholder="0,00"
                      type="number"
                      step="0.01"
                      className="w-full px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <button
                      onClick={addConta}
                      disabled={saving || !novaConta.nome}
                      className="w-full flex items-center justify-center gap-1 px-3 py-2 text-sm rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50"
                    >
                      <Plus className="w-4 h-4" /> Adicionar Conta
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── GRUPOS DRE ────────────────────────────────── */}
          {secao === 'dre' && (
            <div className="space-y-4">
              {/* Seed */}
              {gruposDRE.length === 0 && (
                <div className="text-center py-4 bg-violet-50 dark:bg-violet-900/10 rounded-xl border border-violet-200 dark:border-violet-800">
                  <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">Nenhum grupo configurado. Comece com a estrutura padrão.</p>
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

              {/* Lista */}
              <div className="space-y-2">
                {gruposDRE.sort((a, b) => a.ordem - b.ordem).map(g => (
                  <div key={g.id} className="rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 overflow-hidden">
                    {editandoGrupo?.id === g.id ? (
                      /* Modo edição */
                      <div className="p-4 space-y-3">
                        <div className="grid grid-cols-2 gap-2">
                          <div className="col-span-2">
                            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Nome</label>
                            <input
                              value={editandoGrupo.nome}
                              onChange={e => setEditandoGrupo(prev => prev ? { ...prev, nome: e.target.value } : null)}
                              className="w-full text-sm px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500"
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Tipo</label>
                            <select
                              value={editandoGrupo.tipo}
                              onChange={e => setEditandoGrupo(prev => prev ? { ...prev, tipo: e.target.value } : null)}
                              className="w-full text-sm px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500"
                            >
                              <option value="receita">Receita</option>
                              <option value="deducao">Dedução</option>
                              <option value="custo">Custo</option>
                              <option value="despesa">Despesa</option>
                              <option value="imposto">Imposto</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Operação</label>
                            <select
                              value={editandoGrupo.operacao}
                              onChange={e => setEditandoGrupo(prev => prev ? { ...prev, operacao: e.target.value } : null)}
                              className="w-full text-sm px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500"
                            >
                              <option value="soma">Soma (+)</option>
                              <option value="subtrai">Subtrai (−)</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Ordem</label>
                            <input
                              type="number" min={1}
                              value={editandoGrupo.ordem}
                              onChange={e => setEditandoGrupo(prev => prev ? { ...prev, ordem: Number(e.target.value) } : null)}
                              className="w-full text-sm px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500"
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Total parcial após (opcional)</label>
                            <input
                              value={editandoGrupo.total_parcial_apos || ''}
                              onChange={e => setEditandoGrupo(prev => prev ? { ...prev, total_parcial_apos: e.target.value } : null)}
                              placeholder="ex: Receita Líquida"
                              className="w-full text-sm px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500"
                            />
                          </div>
                        </div>
                        <div className="flex gap-2 justify-end">
                          <button onClick={() => setEditandoGrupo(null)} className="flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">
                            <X className="w-3.5 h-3.5" /> Cancelar
                          </button>
                          <button onClick={saveGrupo} disabled={saving} className="flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50">
                            <Save className="w-3.5 h-3.5" /> Salvar
                          </button>
                        </div>
                      </div>
                    ) : (
                      /* Modo leitura */
                      <div className="flex items-center justify-between px-4 py-3">
                        <div className="flex items-center gap-3">
                          <span className="text-xs font-bold text-gray-400 dark:text-gray-500 w-5 text-center">{g.ordem}</span>
                          <div>
                            <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{g.nome}</p>
                            <p className="text-xs text-gray-500 dark:text-gray-400">
                              {g.tipo} · {g.operacao === 'subtrai' ? 'Subtrai (−)' : 'Soma (+)'}
                              {g.total_parcial_apos ? ` → ${g.total_parcial_apos}` : ''}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <button onClick={() => setEditandoGrupo(g)} className="p-1.5 rounded-lg text-gray-400 hover:text-violet-600 hover:bg-violet-50 dark:hover:bg-violet-900/20">
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button onClick={() => delGrupo(g.id)} className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Formulário novo grupo */}
              <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-600 p-4 space-y-3">
                <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Adicionar grupo</p>
                <div className="grid grid-cols-2 gap-2">
                  <div className="col-span-2">
                    <input
                      value={novoGrupo.nome}
                      onChange={e => setNovoGrupo(f => ({ ...f, nome: e.target.value }))}
                      placeholder="Nome do grupo (ex: (-) Custos Diretos)"
                      className="w-full text-sm px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500"
                    />
                  </div>
                  <div>
                    <select
                      value={novoGrupo.tipo}
                      onChange={e => setNovoGrupo(f => ({ ...f, tipo: e.target.value }))}
                      className="w-full text-sm px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500"
                    >
                      <option value="receita">Receita</option>
                      <option value="deducao">Dedução</option>
                      <option value="custo">Custo</option>
                      <option value="despesa">Despesa</option>
                      <option value="imposto">Imposto</option>
                    </select>
                  </div>
                  <div>
                    <select
                      value={novoGrupo.operacao}
                      onChange={e => setNovoGrupo(f => ({ ...f, operacao: e.target.value }))}
                      className="w-full text-sm px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500"
                    >
                      <option value="soma">Soma (+)</option>
                      <option value="subtrai">Subtrai (−)</option>
                    </select>
                  </div>
                  <div>
                    <input
                      type="number" min={1}
                      value={novoGrupo.ordem}
                      onChange={e => setNovoGrupo(f => ({ ...f, ordem: Number(e.target.value) }))}
                      placeholder="Ordem"
                      className="w-full text-sm px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500"
                    />
                  </div>
                  <div>
                    <input
                      value={novoGrupo.total_parcial_apos}
                      onChange={e => setNovoGrupo(f => ({ ...f, total_parcial_apos: e.target.value }))}
                      placeholder="Total parcial após (opcional)"
                      className="w-full text-sm px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500"
                    />
                  </div>
                </div>
                <div className="flex justify-end">
                  <button
                    onClick={addGrupo}
                    disabled={saving || !novoGrupo.nome}
                    className="flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50"
                  >
                    <Plus className="w-4 h-4" /> Adicionar
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

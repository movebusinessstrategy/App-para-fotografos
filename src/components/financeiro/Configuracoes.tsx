import React, { useEffect, useState, useCallback } from 'react';
import { Plus, Trash2, Edit2, Save, X, Tag, Wallet, CreditCard, BarChart3, AlertCircle, RefreshCw, Lock } from 'lucide-react';
import { authFetch } from '../../utils/authFetch';
import {
  CATEGORIAS_RECEITA_PADRAO, CATEGORIAS_DESPESA_PADRAO,
  MEIOS_PADRAO, GRUPOS_DRE_PADRAO, fmtBRL, parseBRLMoney,
} from './finUtils';
import { MoneyInput, NumInput, FinSelect } from './FinInputs';

interface Categoria { id: string; nome: string; cor: string; tipo: string; grupo_dre_id?: string | null; }
interface Meio { id: string; nome: string; tipo: string; taxa_percentual: number; taxa_fixa: number; prazo_recebimento: number; }
interface Conta {
  id: string;
  nome: string;
  tipo: string;
  banco?: string;
  banco_codigo?: string;
  conta_ref?: string;
  saldo_inicial: number;
  tem_extrato?: boolean;
  saldo_extrato_em?: string | null;
}
interface GrupoDRE { id: string; nome: string; tipo: string; operacao: string; ordem: number; total_parcial_apos?: string; }
interface InfinitePaySetupPreview {
  pronto?: boolean;
  preview_token?: string;
  acoes?: { criar_conta?: boolean; renomear_meio?: boolean };
  conta?: { nome?: string; tipo?: string } | null;
  meio?: { nome?: string; tipo?: string } | null;
  conflitos?: unknown[];
  avisos?: unknown[];
  message?: string;
  error?: string;
}

type SecaoAtiva = 'categorias' | 'meios' | 'contas' | 'dre';

const CONTA_TIPO_LABEL: Record<string, string> = {
  corrente: 'Conta corrente',
  poupanca: 'Poupança',
  investimento: 'Investimento',
  carteira: 'Carteira / caixa',
  intermediador: 'Intermediadora / adquirente',
};

async function responseJson<T>(response: Response, fallback: string): Promise<T> {
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message = body?.message || body?.error || fallback;
    throw new Error(message);
  }
  return body as T;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function normalizedName(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function setupIssueText(issue: unknown) {
  if (typeof issue === 'string') return issue;
  if (issue && typeof issue === 'object') {
    const record = issue as Record<string, unknown>;
    return String(record.message || record.error || record.nome || 'Conflito de configuração');
  }
  return String(issue || 'Conflito de configuração');
}

export default function Configuracoes() {
  const [secao, setSecao] = useState<SecaoAtiva>('categorias');
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [meios, setMeios] = useState<Meio[]>([]);
  const [contas, setContas] = useState<Conta[]>([]);
  const [gruposDRE, setGruposDRE] = useState<GrupoDRE[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [infinitePayPreview, setInfinitePayPreview] = useState<InfinitePaySetupPreview | null>(null);
  const [infinitePayLoading, setInfinitePayLoading] = useState(false);

  // Forms
  const [novaCategoria, setNovaCategoria] = useState({ nome: '', cor: '#6366f1', tipo: 'receita', grupo_dre_id: '' });
  const [editandoCategoria, setEditandoCategoria] = useState<Categoria | null>(null);
  const [novaMeio, setNovaMeio] = useState({ nome: '', tipo: 'pix', taxa_percentual: '0', taxa_fixa: '0', prazo_recebimento: '0' });
  const [novaConta, setNovaConta] = useState({
    nome: '', tipo: 'corrente', banco: '', banco_codigo: '', conta_ref: '', saldo_inicial: '0',
  });

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const [cRes, mRes, ctRes, dRes] = await Promise.all([
        authFetch('/api/fin/categorias'),
        authFetch('/api/fin/meios'),
        authFetch('/api/fin/contas'),
        authFetch('/api/fin/grupos-dre'),
      ]);
      const [categoryRows, methodRows, accountRows, dreRows] = await Promise.all([
        responseJson<Categoria[]>(cRes, 'Não foi possível carregar as categorias.'),
        responseJson<Meio[]>(mRes, 'Não foi possível carregar os meios de pagamento.'),
        responseJson<Conta[]>(ctRes, 'Não foi possível carregar as contas.'),
        responseJson<GrupoDRE[]>(dRes, 'Não foi possível carregar os grupos da DRE.'),
      ]);
      if (![categoryRows, methodRows, accountRows, dreRows].every(Array.isArray)) {
        throw new Error('O financeiro retornou dados em um formato inesperado.');
      }
      setCategorias(categoryRows);
      setMeios(methodRows);
      setContas(accountRows);
      setGruposDRE(dreRows);
    } catch (error) {
      setCategorias([]);
      setMeios([]);
      setContas([]);
      setGruposDRE([]);
      setLoadError(errorMessage(error, 'Não foi possível carregar as configurações financeiras.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Categorias ──────────────────────────────────────────────
  const addCategoria = async () => {
    if (!novaCategoria.nome) return;
    setSaving(true);
    setActionError('');
    try {
      const res = await authFetch('/api/fin/categorias', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...novaCategoria,
          grupo_dre_id: novaCategoria.grupo_dre_id || null,
        }),
      });
      const nova = await responseJson<Categoria>(res, 'Não foi possível criar a categoria.');
      setCategorias(prev => [...prev, nova]);
      setNovaCategoria(f => ({ ...f, nome: '', grupo_dre_id: '' }));
    } catch (error) {
      setActionError(errorMessage(error, 'Não foi possível criar a categoria.'));
    } finally { setSaving(false); }
  };

  const saveCategoria = async () => {
    if (!editandoCategoria) return;
    setSaving(true);
    setActionError('');
    try {
      const res = await authFetch(`/api/fin/categorias/${editandoCategoria.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nome: editandoCategoria.nome,
          cor: editandoCategoria.cor,
          tipo: editandoCategoria.tipo,
          grupo_dre_id: editandoCategoria.grupo_dre_id || null,
        }),
      });
      await responseJson(res, 'Não foi possível atualizar a categoria.');
      setCategorias(prev => prev.map(c => c.id === editandoCategoria.id ? editandoCategoria : c));
      setEditandoCategoria(null);
    } catch (error) {
      setActionError(errorMessage(error, 'Não foi possível atualizar a categoria.'));
    } finally { setSaving(false); }
  };

  const delCategoria = async (id: string) => {
    if (!confirm('Excluir categoria?')) return;
    setActionError('');
    try {
      const res = await authFetch(`/api/fin/categorias/${id}`, { method: 'DELETE' });
      await responseJson(res, 'Não foi possível excluir a categoria.');
      setCategorias(prev => prev.filter(c => c.id !== id));
    } catch (error) {
      setActionError(errorMessage(error, 'Não foi possível excluir a categoria.'));
    }
  };

  const seedCategorias = async () => {
    setSaving(true);
    setActionError('');
    try {
      for (const c of [...CATEGORIAS_RECEITA_PADRAO, ...CATEGORIAS_DESPESA_PADRAO]) {
        const tipo = CATEGORIAS_RECEITA_PADRAO.includes(c) ? 'receita' : 'despesa';
        const response = await authFetch('/api/fin/categorias', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...c, tipo }),
        });
        await responseJson(response, `Não foi possível criar a categoria ${c.nome}.`);
      }
      await load();
    } catch (error) {
      setActionError(errorMessage(error, 'Não foi possível criar as categorias padrão.'));
    } finally { setSaving(false); }
  };

  // ── Meios ───────────────────────────────────────────────────
  const [editandoMeio, setEditandoMeio] = useState<Meio | null>(null);

  const saveMeio = async () => {
    if (!editandoMeio) return;
    const percentage = parseBRLMoney(editandoMeio.taxa_percentual);
    const fixedFee = parseBRLMoney(editandoMeio.taxa_fixa);
    if (percentage === null || fixedFee === null) {
      setActionError('Informe taxas válidas. Exemplo: 3,49.');
      return;
    }
    setSaving(true);
    setActionError('');
    try {
      const res = await authFetch(`/api/fin/meios/${editandoMeio.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nome: editandoMeio.nome,
          tipo: editandoMeio.tipo,
          taxa_percentual: percentage,
          taxa_fixa: fixedFee,
          prazo_recebimento: Number(editandoMeio.prazo_recebimento),
        }),
      });
      await responseJson(res, 'Não foi possível atualizar o meio de pagamento.');
      setMeios(prev => prev.map(m => m.id === editandoMeio.id
        ? { ...editandoMeio, taxa_percentual: percentage, taxa_fixa: fixedFee }
        : m));
      setEditandoMeio(null);
    } catch (error) {
      setActionError(errorMessage(error, 'Não foi possível atualizar o meio de pagamento.'));
    } finally { setSaving(false); }
  };

  const addMeio = async () => {
    if (!novaMeio.nome) return;
    const percentage = parseBRLMoney(novaMeio.taxa_percentual);
    const fixedFee = parseBRLMoney(novaMeio.taxa_fixa);
    const settlementDays = Number(novaMeio.prazo_recebimento);
    if (percentage === null || fixedFee === null || !Number.isInteger(settlementDays)) {
      setActionError('Revise as taxas e o prazo de recebimento.');
      return;
    }
    setSaving(true);
    setActionError('');
    try {
      const res = await authFetch('/api/fin/meios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nome: novaMeio.nome,
          tipo: novaMeio.tipo,
          taxa_percentual: percentage,
          taxa_fixa: fixedFee,
          prazo_recebimento: settlementDays,
        }),
      });
      const novo = await responseJson<Meio>(res, 'Não foi possível criar o meio de pagamento.');
      setMeios(prev => [...prev, novo]);
      setNovaMeio(f => ({ ...f, nome: '' }));
    } catch (error) {
      setActionError(errorMessage(error, 'Não foi possível criar o meio de pagamento.'));
    } finally { setSaving(false); }
  };

  const delMeio = async (id: string) => {
    if (!confirm('Excluir meio de pagamento?')) return;
    setActionError('');
    try {
      const res = await authFetch(`/api/fin/meios/${id}`, { method: 'DELETE' });
      await responseJson(res, 'Não foi possível excluir o meio de pagamento.');
      setMeios(prev => prev.filter(m => m.id !== id));
    } catch (error) {
      setActionError(errorMessage(error, 'Não foi possível excluir o meio de pagamento.'));
    }
  };

  const seedMeios = async () => {
    setSaving(true);
    setActionError('');
    try {
      for (const m of MEIOS_PADRAO) {
        const response = await authFetch('/api/fin/meios', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(m),
        });
        await responseJson(response, `Não foi possível criar o meio ${m.nome}.`);
      }
      await load();
    } catch (error) {
      setActionError(errorMessage(error, 'Não foi possível criar os meios padrão.'));
    } finally { setSaving(false); }
  };

  // ── Contas ──────────────────────────────────────────────────
  const [editandoConta, setEditandoConta] = useState<Conta | null>(null);

  const saveConta = async () => {
    if (!editandoConta) return;
    const openingBalance = parseBRLMoney(editandoConta.saldo_inicial);
    if (openingBalance === null) {
      setActionError('Informe um saldo inicial válido. Exemplo: 1.234,56.');
      return;
    }
    const payload: Record<string, string | number | null> = {
      nome: editandoConta.nome,
      tipo: editandoConta.tipo,
      banco: editandoConta.banco || null,
      saldo_inicial: openingBalance,
    };
    if (!editandoConta.tem_extrato) {
      payload.banco_codigo = editandoConta.banco_codigo || null;
      payload.conta_ref = editandoConta.conta_ref || null;
    }
    setSaving(true);
    setActionError('');
    try {
      const res = await authFetch(`/api/fin/contas/${editandoConta.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      await responseJson(res, 'Não foi possível atualizar a conta.');
      setContas(prev => prev.map(c => c.id === editandoConta.id
        ? { ...editandoConta, saldo_inicial: openingBalance }
        : c));
      setEditandoConta(null);
    } catch (error) {
      setActionError(errorMessage(error, 'Não foi possível atualizar a conta.'));
    } finally { setSaving(false); }
  };

  const addConta = async () => {
    if (!novaConta.nome) return;
    const openingBalance = parseBRLMoney(novaConta.saldo_inicial);
    if (openingBalance === null) {
      setActionError('Informe um saldo inicial válido. Exemplo: 1.234,56.');
      return;
    }
    setSaving(true);
    setActionError('');
    try {
      const res = await authFetch('/api/fin/contas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nome: novaConta.nome,
          tipo: novaConta.tipo,
          banco: novaConta.banco || null,
          banco_codigo: novaConta.banco_codigo || null,
          conta_ref: novaConta.conta_ref || null,
          saldo_inicial: openingBalance,
        }),
      });
      const nova = await responseJson<Conta>(res, 'Não foi possível criar a conta.');
      setContas(prev => [...prev, nova]);
      setNovaConta({ nome: '', tipo: 'corrente', banco: '', banco_codigo: '', conta_ref: '', saldo_inicial: '0' });
    } catch (error) {
      setActionError(errorMessage(error, 'Não foi possível criar a conta.'));
    } finally { setSaving(false); }
  };

  const delConta = async (id: string) => {
    if (!confirm('Excluir conta?')) return;
    setActionError('');
    try {
      const res = await authFetch(`/api/fin/contas/${id}`, { method: 'DELETE' });
      await responseJson(res, 'Não foi possível desativar a conta.');
      setContas(prev => prev.filter(c => c.id !== id));
    } catch (error) {
      setActionError(errorMessage(error, 'Não foi possível desativar a conta.'));
    }
  };

  const previewInfinitePaySetup = async () => {
    setInfinitePayLoading(true);
    setActionError('');
    try {
      const response = await authFetch('/api/fin/infinitepay/setup/preview');
      const body = await response.json().catch(() => null) as InfinitePaySetupPreview | null;
      if (!response.ok) {
        if (body?.conflitos?.length) setInfinitePayPreview(body);
        throw new Error(body?.message || body?.error || 'Não foi possível preparar a configuração da InfinitePay.');
      }
      if (!body) throw new Error('A prévia da InfinitePay retornou um formato inesperado.');
      setInfinitePayPreview(body);
    } catch (error) {
      setActionError(errorMessage(error, 'Não foi possível preparar a configuração da InfinitePay.'));
    } finally {
      setInfinitePayLoading(false);
    }
  };

  const applyInfinitePaySetup = async () => {
    if (!infinitePayPreview?.preview_token) return;
    setInfinitePayLoading(true);
    setActionError('');
    try {
      const response = await authFetch('/api/fin/infinitepay/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmar: true, preview_token: infinitePayPreview.preview_token }),
      });
      await responseJson(response, 'Não foi possível concluir a configuração da InfinitePay.');
      setInfinitePayPreview(null);
      await load();
    } catch (error) {
      setActionError(errorMessage(error, 'Não foi possível concluir a configuração da InfinitePay.'));
    } finally {
      setInfinitePayLoading(false);
    }
  };

  // ── Grupos DRE ──────────────────────────────────────────────
  const [novoGrupo, setNovoGrupo] = useState({
    nome: '', tipo: 'despesa', operacao: 'subtrai', ordem: 0, total_parcial_apos: '',
  });
  const [editandoGrupo, setEditandoGrupo] = useState<GrupoDRE | null>(null);

  const addGrupo = async () => {
    if (!novoGrupo.nome) return;
    setSaving(true);
    setActionError('');
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
      const novo = await responseJson<GrupoDRE>(res, 'Não foi possível criar o grupo da DRE.');
      setGruposDRE(prev => [...prev, novo].sort((a, b) => a.ordem - b.ordem));
      setNovoGrupo({ nome: '', tipo: 'despesa', operacao: 'subtrai', ordem: 0, total_parcial_apos: '' });
    } catch (error) {
      setActionError(errorMessage(error, 'Não foi possível criar o grupo da DRE.'));
    } finally { setSaving(false); }
  };

  const saveGrupo = async () => {
    if (!editandoGrupo) return;
    setSaving(true);
    setActionError('');
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
      await responseJson(res, 'Não foi possível atualizar o grupo da DRE.');
      setGruposDRE(prev => prev.map(g => g.id === editandoGrupo.id ? editandoGrupo : g).sort((a, b) => a.ordem - b.ordem));
      setEditandoGrupo(null);
    } catch (error) {
      setActionError(errorMessage(error, 'Não foi possível atualizar o grupo da DRE.'));
    } finally { setSaving(false); }
  };

  const delGrupo = async (id: string) => {
    if (!confirm('Excluir grupo DRE?')) return;
    setActionError('');
    try {
      const res = await authFetch(`/api/fin/grupos-dre/${id}`, { method: 'DELETE' });
      await responseJson(res, 'Não foi possível excluir o grupo da DRE.');
      setGruposDRE(prev => prev.filter(g => g.id !== id));
    } catch (error) {
      setActionError(errorMessage(error, 'Não foi possível excluir o grupo da DRE.'));
    }
  };

  const seedGrupos = async () => {
    setSaving(true);
    setActionError('');
    try {
      for (const group of GRUPOS_DRE_PADRAO) {
        const response = await authFetch('/api/fin/grupos-dre', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(group),
        });
        await responseJson(response, `Não foi possível criar o grupo ${group.nome}.`);
      }
      await load();
    } catch (error) {
      setActionError(errorMessage(error, 'Não foi possível criar a estrutura padrão da DRE.'));
    } finally {
      setSaving(false);
    }
  };

  const dreOptionsForCategory = (tipo: string) => gruposDRE
    .filter(group => tipo === 'receita' ? group.tipo === 'receita' : group.tipo !== 'receita')
    .map(group => ({ value: group.id, label: group.nome }));

  const hasLinkPaymentMethod = meios.some(meio =>
    meio.tipo === 'link_pagamento' || normalizedName(meio.nome).includes('link')
  );
  const hasInfinitePayAccount = contas.some(conta =>
    conta.tipo === 'intermediador' && normalizedName(conta.nome).includes('infinitepay')
  );

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
              onClick={() => { setSecao(s.key); setActionError(''); }}
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

      {actionError && (
        <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-800 dark:bg-rose-900/20 dark:text-rose-300">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>{actionError}</span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-32">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-violet-600" />
        </div>
      ) : loadError ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-5 text-center dark:border-rose-800 dark:bg-rose-900/20">
          <AlertCircle className="mx-auto mb-2 h-6 w-6 text-rose-500" />
          <p className="text-sm font-medium text-rose-800 dark:text-rose-200">Não foi possível mostrar as configurações</p>
          <p className="mt-1 text-xs text-rose-700 dark:text-rose-300">{loadError}</p>
          <button
            onClick={load}
            className="mx-auto mt-4 flex items-center gap-2 rounded-lg border border-rose-300 px-3 py-1.5 text-sm font-medium text-rose-700 hover:bg-rose-100 dark:border-rose-700 dark:text-rose-200 dark:hover:bg-rose-900/30"
          >
            <RefreshCw className="h-4 w-4" /> Tentar novamente
          </button>
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
                            <div key={c.id} className="rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 overflow-hidden">
                              {editandoCategoria?.id === c.id ? (
                                <div className="p-3 space-y-2">
                                  <div className="flex gap-2">
                                    <input
                                      value={editandoCategoria.nome}
                                      onChange={e => setEditandoCategoria(prev => prev ? { ...prev, nome: e.target.value } : null)}
                                      className="flex-1 text-sm px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500"
                                    />
                                    <FinSelect
                                      value={editandoCategoria.tipo}
                                      onChange={v => setEditandoCategoria(prev => prev ? { ...prev, tipo: v, grupo_dre_id: '' } : null)}
                                      nullable={false}
                                      options={[{ value: 'receita', label: 'Receita' }, { value: 'despesa', label: 'Despesa' }]}
                                      className="w-32"
                                    />
                                    <input
                                      type="color"
                                      value={editandoCategoria.cor}
                                      onChange={e => setEditandoCategoria(prev => prev ? { ...prev, cor: e.target.value } : null)}
                                      className="w-9 h-9 rounded-lg border border-gray-200 dark:border-gray-700 cursor-pointer p-0.5 bg-white dark:bg-gray-900"
                                    />
                                  </div>
                                  <div>
                                    <label className="mb-1 block text-xs text-gray-500 dark:text-gray-400">Grupo na DRE</label>
                                    <FinSelect
                                      value={editandoCategoria.grupo_dre_id || ''}
                                      onChange={v => setEditandoCategoria(prev => prev ? { ...prev, grupo_dre_id: v || null } : null)}
                                      options={dreOptionsForCategory(editandoCategoria.tipo)}
                                      placeholder="Sem grupo definido"
                                    />
                                  </div>
                                  <div className="flex gap-2">
                                    <button onClick={saveCategoria} disabled={saving} className="flex-1 text-sm py-1.5 rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50">Salvar</button>
                                    <button onClick={() => setEditandoCategoria(null)} className="flex-1 text-sm py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">Cancelar</button>
                                  </div>
                                </div>
                              ) : (
                                <div className="flex items-center justify-between px-3 py-2">
                                  <div className="flex min-w-0 items-center gap-2">
                                    <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: c.cor }} />
                                    <div className="min-w-0">
                                      <p className="truncate text-sm text-gray-800 dark:text-gray-200">{c.nome}</p>
                                      <p className="truncate text-[11px] text-gray-400">
                                        {gruposDRE.find(group => group.id === c.grupo_dre_id)?.nome || 'Sem grupo na DRE'}
                                      </p>
                                    </div>
                                  </div>
                                  <div className="flex gap-2">
                                    <button onClick={() => setEditandoCategoria(c)} className="text-gray-400 hover:text-violet-500">
                                      <Edit2 className="w-4 h-4" />
                                    </button>
                                    <button onClick={() => delCategoria(c.id)} className="text-gray-400 hover:text-red-500">
                                      <Trash2 className="w-4 h-4" />
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </>
              )}

              {/* Formulário nova categoria */}
              <div className="rounded-xl border border-dashed border-gray-200 dark:border-gray-700 p-4 space-y-2">
                <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Nova categoria</p>
                <div className="flex flex-wrap gap-2">
                  <input
                    value={novaCategoria.nome}
                    onChange={e => setNovaCategoria(f => ({ ...f, nome: e.target.value }))}
                    placeholder="Nome da categoria"
                    className="min-w-44 flex-1 px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500"
                  />
                  <FinSelect
                    value={novaCategoria.tipo}
                    onChange={v => setNovaCategoria(f => ({ ...f, tipo: v, grupo_dre_id: '' }))}
                    nullable={false}
                    options={[{ value: 'receita', label: 'Receita' }, { value: 'despesa', label: 'Despesa' }]}
                    className="w-32"
                  />
                  <FinSelect
                    value={novaCategoria.grupo_dre_id}
                    onChange={v => setNovaCategoria(f => ({ ...f, grupo_dre_id: v }))}
                    options={dreOptionsForCategory(novaCategoria.tipo)}
                    placeholder="Grupo da DRE"
                    className="min-w-48 flex-1"
                  />
                  <input
                    type="color"
                    value={novaCategoria.cor}
                    onChange={e => setNovaCategoria(f => ({ ...f, cor: e.target.value }))}
                    title="Cor da categoria"
                    className="w-9 h-9 rounded-lg border border-gray-200 dark:border-gray-700 cursor-pointer p-0.5 bg-white dark:bg-gray-800"
                  />
                  <button
                    onClick={addCategoria}
                    disabled={saving || !novaCategoria.nome}
                    className="px-3 py-1.5 text-sm rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 flex items-center gap-1"
                  >
                    <Plus className="w-4 h-4" /> Adicionar
                  </button>
                </div>
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
                            <FinSelect
                              value={editandoMeio.tipo}
                              onChange={v => setEditandoMeio(p => p ? { ...p, tipo: v } : null)}
                              nullable={false}
                              options={[
                                { value: 'pix', label: 'PIX' },
                                { value: 'dinheiro', label: 'Dinheiro' },
                                { value: 'transferencia', label: 'Transferência' },
                                { value: 'debito', label: 'Débito' },
                                { value: 'credito', label: 'Crédito' },
                                { value: 'boleto', label: 'Boleto' },
                                { value: 'link_pagamento', label: 'Link de Pagamento' },
                              ]}
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Taxa % <span className="text-gray-400">(ex: 2.99 para cartão)</span></label>
                            <NumInput value={String(editandoMeio.taxa_percentual)} onChange={v => setEditandoMeio(p => p ? { ...p, taxa_percentual: parseBRLMoney(v) ?? 0 } : null)} placeholder="0" className="text-sm" />
                          </div>
                          <div>
                            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Taxa Fixa R$ <span className="text-gray-400">(ex: 1.50)</span></label>
                            <MoneyInput value={String(editandoMeio.taxa_fixa)} onChange={v => setEditandoMeio(p => p ? { ...p, taxa_fixa: parseBRLMoney(v) ?? 0 } : null)} className="text-sm" />
                          </div>
                          <div>
                            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Prazo de recebimento <span className="text-gray-400">(dias para cair na conta)</span></label>
                            <NumInput value={String(editandoMeio.prazo_recebimento)} onChange={v => setEditandoMeio(p => p ? { ...p, prazo_recebimento: parseInt(v) || 0 } : null)} placeholder="0" allowDecimal={false} className="text-sm" />
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
                    <input value={novaMeio.nome} onChange={e => setNovaMeio(f => ({ ...f, nome: e.target.value }))} placeholder="Ex: Pix, Link InfinitePay..."
                      className="w-full px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Tipo</label>
                    <FinSelect
                      value={novaMeio.tipo}
                      onChange={v => setNovaMeio(f => ({ ...f, tipo: v }))}
                      nullable={false}
                      options={[
                        { value: 'pix', label: 'PIX' },
                        { value: 'dinheiro', label: 'Dinheiro' },
                        { value: 'transferencia', label: 'Transferência' },
                        { value: 'debito', label: 'Débito' },
                        { value: 'credito', label: 'Crédito' },
                        { value: 'boleto', label: 'Boleto' },
                        { value: 'link_pagamento', label: 'Link de Pagamento' },
                      ]}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Taxa % <span className="text-gray-400">(cobrada pela operadora)</span></label>
                    <NumInput value={novaMeio.taxa_percentual} onChange={v => setNovaMeio(f => ({ ...f, taxa_percentual: v }))} placeholder="0" className="text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Taxa Fixa R$ <span className="text-gray-400">(por transação)</span></label>
                    <MoneyInput value={novaMeio.taxa_fixa} onChange={v => setNovaMeio(f => ({ ...f, taxa_fixa: v }))} className="text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Prazo <span className="text-gray-400">(dias para cair na conta)</span></label>
                    <NumInput value={novaMeio.prazo_recebimento} onChange={v => setNovaMeio(f => ({ ...f, prazo_recebimento: v }))} placeholder="0" allowDecimal={false} className="text-sm" />
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
              {hasLinkPaymentMethod && !hasInfinitePayAccount && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-900/20">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600 dark:text-amber-400" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-amber-900 dark:text-amber-100">Falta configurar a conta InfinitePay</p>
                      <p className="mt-1 text-xs leading-relaxed text-amber-800 dark:text-amber-200">
                        Existe um meio de recebimento por link, mas não há uma conta InfinitePay intermediadora. Sem ela, o pagamento do cliente pode ser confundido com o repasse posterior ao Nubank ou Itaú.
                      </p>
                      <button
                        onClick={previewInfinitePaySetup}
                        disabled={infinitePayLoading}
                        className="mt-3 flex items-center gap-2 rounded-lg bg-amber-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-amber-800 disabled:opacity-50"
                      >
                        <RefreshCw className={`h-4 w-4 ${infinitePayLoading ? 'animate-spin' : ''}`} />
                        Ver prévia da configuração
                      </button>
                    </div>
                  </div>
                </div>
              )}

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
                                Nome <span className="text-gray-400 font-normal">- como você identifica essa conta (ex: "Nubank", "Caixa Empresa")</span>
                              </label>
                              <input
                                value={editandoConta.nome}
                                onChange={e => setEditandoConta(prev => prev ? { ...prev, nome: e.target.value } : null)}
                                className="w-full text-sm px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500"
                              />
                            </div>
                            <div>
                              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                                Tipo <span className="text-gray-400 font-normal">- natureza da conta</span>
                              </label>
                              <FinSelect
                                value={editandoConta.tipo}
                                onChange={v => setEditandoConta(prev => prev ? { ...prev, tipo: v } : null)}
                                nullable={false}
                                options={[
                                  { value: 'corrente', label: 'Corrente' },
                                  { value: 'poupanca', label: 'Poupança' },
                                  { value: 'investimento', label: 'Investimento' },
                                  { value: 'carteira', label: 'Carteira / Caixa' },
                                  { value: 'intermediador', label: 'Intermediadora / adquirente' },
                                ]}
                              />
                            </div>
                            <div>
                              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                                Banco <span className="text-gray-400 font-normal">- opcional (ex: "Bradesco", "Inter")</span>
                              </label>
                              <input
                                value={editandoConta.banco || ''}
                                onChange={e => setEditandoConta(prev => prev ? { ...prev, banco: e.target.value } : null)}
                                placeholder="Opcional"
                                className="w-full text-sm px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500"
                              />
                            </div>
                            <div>
                              <label className="mb-1 flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                                Código no OFX <span className="text-gray-400 font-normal">- opcional</span>
                                {editandoConta.tem_extrato && <Lock className="h-3 w-3" />}
                              </label>
                              <input
                                value={editandoConta.banco_codigo || ''}
                                onChange={e => setEditandoConta(prev => prev ? { ...prev, banco_codigo: e.target.value } : null)}
                                disabled={!!editandoConta.tem_extrato}
                                placeholder="Ex: 341"
                                className="w-full text-sm px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500 dark:disabled:bg-gray-800"
                              />
                            </div>
                            <div>
                              <label className="mb-1 flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                                Identificação da conta <span className="text-gray-400 font-normal">- valor completo do OFX</span>
                                {editandoConta.tem_extrato && <Lock className="h-3 w-3" />}
                              </label>
                              <input
                                value={editandoConta.conta_ref || ''}
                                onChange={e => setEditandoConta(prev => prev ? { ...prev, conta_ref: e.target.value } : null)}
                                disabled={!!editandoConta.tem_extrato}
                                placeholder="Deixe vazio para detectar no primeiro OFX"
                                className="w-full text-sm px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500 dark:disabled:bg-gray-800"
                              />
                            </div>
                            {editandoConta.tem_extrato && (
                              <div className="col-span-2 flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-300">
                                <Lock className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                                <span>O código bancário e a identificação foram confirmados pelo extrato. Eles ficam somente leitura para não associar futuros OFX à conta errada.</span>
                              </div>
                            )}
                            <div className="col-span-2">
                              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                                Saldo Inicial <span className="text-gray-400 font-normal">- quanto havia nessa conta quando você a cadastrou aqui</span>
                              </label>
                              <MoneyInput
                                value={String(editandoConta.saldo_inicial)}
                                onChange={v => setEditandoConta(prev => prev ? { ...prev, saldo_inicial: parseBRLMoney(v) ?? 0 } : null)}
                                className="text-sm"
                              />
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <button
                              onClick={() => saveConta()}
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
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{c.nome}</p>
                              {c.tem_extrato && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                                  <Lock className="h-2.5 w-2.5" /> Identidade confirmada pelo OFX
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-gray-500 dark:text-gray-400">
                              {CONTA_TIPO_LABEL[c.tipo] || c.tipo}{c.banco ? ` · ${c.banco}` : ''} · Saldo inicial: {fmtBRL(c.saldo_inicial)}
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
                      Nome <span className="text-gray-400 font-normal">- como você identifica essa conta (ex: "Nubank", "Caixa Empresa")</span>
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
                      Tipo <span className="text-gray-400 font-normal">- natureza da conta</span>
                    </label>
                    <FinSelect
                      value={novaConta.tipo}
                      onChange={v => setNovaConta(f => ({ ...f, tipo: v }))}
                      nullable={false}
                      options={[
                        { value: 'corrente', label: 'Corrente' },
                        { value: 'poupanca', label: 'Poupança' },
                        { value: 'investimento', label: 'Investimento' },
                        { value: 'carteira', label: 'Carteira / Caixa' },
                        { value: 'intermediador', label: 'Intermediadora / adquirente' },
                      ]}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                      Banco <span className="text-gray-400 font-normal">- opcional (ex: "Bradesco", "Inter")</span>
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
                      Código no OFX <span className="text-gray-400 font-normal">- opcional</span>
                    </label>
                    <input
                      value={novaConta.banco_codigo}
                      onChange={e => setNovaConta(f => ({ ...f, banco_codigo: e.target.value }))}
                      placeholder="Ex: 341"
                      className="w-full px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                      Identificação da conta <span className="text-gray-400 font-normal">- valor completo do OFX</span>
                    </label>
                    <input
                      value={novaConta.conta_ref}
                      onChange={e => setNovaConta(f => ({ ...f, conta_ref: e.target.value }))}
                      placeholder="Deixe vazio para detectar no primeiro OFX"
                      className="w-full px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                      Saldo Inicial <span className="text-gray-400 font-normal">- quanto havia na conta ao cadastrá-la aqui</span>
                    </label>
                    <MoneyInput
                      value={novaConta.saldo_inicial}
                      onChange={v => setNovaConta(f => ({ ...f, saldo_inicial: v }))}
                      className="text-sm"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <p className="mb-3 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                      Para pagamentos por link, cadastre a conta <strong>InfinitePay</strong> como intermediadora.
                      O repasse para Nubank ou Itaú será tratado como transferência interna, sem duplicar a receita.
                    </p>
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
                    onClick={seedGrupos}
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
                            <FinSelect
                              value={editandoGrupo.tipo}
                              onChange={v => setEditandoGrupo(prev => prev ? { ...prev, tipo: v } : null)}
                              nullable={false}
                              options={[
                                { value: 'receita', label: 'Receita' },
                                { value: 'deducao', label: 'Dedução' },
                                { value: 'custo', label: 'Custo' },
                                { value: 'despesa', label: 'Despesa' },
                                { value: 'imposto', label: 'Imposto' },
                              ]}
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Operação</label>
                            <FinSelect
                              value={editandoGrupo.operacao}
                              onChange={v => setEditandoGrupo(prev => prev ? { ...prev, operacao: v } : null)}
                              nullable={false}
                              options={[
                                { value: 'soma', label: 'Soma (+)' },
                                { value: 'subtrai', label: 'Subtrai (−)' },
                              ]}
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Ordem</label>
                            <NumInput value={String(editandoGrupo.ordem)} onChange={v => setEditandoGrupo(prev => prev ? { ...prev, ordem: parseInt(v) || 0 } : null)} placeholder="1" allowDecimal={false} className="text-sm" />
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
                    <FinSelect
                      value={novoGrupo.tipo}
                      onChange={v => setNovoGrupo(f => ({ ...f, tipo: v }))}
                      nullable={false}
                      options={[
                        { value: 'receita', label: 'Receita' },
                        { value: 'deducao', label: 'Dedução' },
                        { value: 'custo', label: 'Custo' },
                        { value: 'despesa', label: 'Despesa' },
                        { value: 'imposto', label: 'Imposto' },
                      ]}
                    />
                  </div>
                  <div>
                    <FinSelect
                      value={novoGrupo.operacao}
                      onChange={v => setNovoGrupo(f => ({ ...f, operacao: v }))}
                      nullable={false}
                      options={[
                        { value: 'soma', label: 'Soma (+)' },
                        { value: 'subtrai', label: 'Subtrai (−)' },
                      ]}
                    />
                  </div>
                  <div>
                    <NumInput value={String(novoGrupo.ordem)} onChange={v => setNovoGrupo(f => ({ ...f, ordem: parseInt(v) || 0 }))} placeholder="Ordem" allowDecimal={false} className="text-sm" />
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

      {infinitePayPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !infinitePayLoading && setInfinitePayPreview(null)}>
          <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-xl dark:bg-gray-800" onClick={event => event.stopPropagation()}>
            <div className="flex items-start justify-between border-b border-gray-100 px-5 py-4 dark:border-gray-700">
              <div>
                <h3 className="font-semibold text-gray-900 dark:text-white">Configurar InfinitePay</h3>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Prévia sem alterações automáticas</p>
              </div>
              <button
                onClick={() => setInfinitePayPreview(null)}
                disabled={infinitePayLoading}
                className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 disabled:opacity-50 dark:hover:bg-gray-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-4 px-5 py-4">
              {infinitePayPreview.pronto ? (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300">
                  A InfinitePay já está configurada corretamente. Nenhuma alteração é necessária.
                </div>
              ) : (
                <div className="space-y-2">
                  {infinitePayPreview.acoes?.criar_conta && (
                    <div className="rounded-xl border border-gray-200 px-4 py-3 dark:border-gray-700">
                      <p className="text-sm font-medium text-gray-900 dark:text-white">Criar conta InfinitePay</p>
                      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Será criada como “Intermediadora / adquirente”, separada das contas Nubank e Itaú.</p>
                    </div>
                  )}
                  {infinitePayPreview.acoes?.renomear_meio && (
                    <div className="rounded-xl border border-gray-200 px-4 py-3 dark:border-gray-700">
                      <p className="text-sm font-medium text-gray-900 dark:text-white">Identificar o meio como Link InfinitePay</p>
                      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">A taxa e o prazo atuais serão preservados; apenas a identificação será ajustada.</p>
                    </div>
                  )}
                </div>
              )}

              {(infinitePayPreview.conflitos?.length || 0) > 0 && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 dark:border-rose-800 dark:bg-rose-900/20">
                  <p className="text-xs font-semibold text-rose-800 dark:text-rose-200">A configuração precisa de escolha manual</p>
                  <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-rose-700 dark:text-rose-300">
                    {infinitePayPreview.conflitos?.map((issue, index) => <li key={index}>{setupIssueText(issue)}</li>)}
                  </ul>
                </div>
              )}

              {(infinitePayPreview.avisos?.length || 0) > 0 && (
                <ul className="list-disc space-y-1 pl-4 text-xs text-amber-700 dark:text-amber-300">
                  {infinitePayPreview.avisos?.map((warning, index) => <li key={index}>{setupIssueText(warning)}</li>)}
                </ul>
              )}

              {!infinitePayPreview.pronto && (
                <p className="text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                  Esta ação não altera recebimentos antigos e não cria receitas. Ela apenas prepara a conta intermediadora para os próximos registros e conciliações.
                </p>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-gray-100 px-5 py-4 dark:border-gray-700">
              <button
                onClick={() => setInfinitePayPreview(null)}
                disabled={infinitePayLoading}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-700"
              >
                Fechar
              </button>
              {!infinitePayPreview.pronto && infinitePayPreview.preview_token && (infinitePayPreview.conflitos?.length || 0) === 0 && (
                <button
                  onClick={applyInfinitePaySetup}
                  disabled={infinitePayLoading}
                  className="flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
                >
                  <Save className="h-4 w-4" /> Confirmar configuração
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

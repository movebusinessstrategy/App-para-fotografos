import React, { useEffect, useState, useCallback } from 'react';
import { Plus, CheckCircle2, Search, Trash2, X, AlertTriangle, Edit2, Save, XCircle, RefreshCw } from 'lucide-react';
import { MoneyInput, FinSelect, DatePicker } from './FinInputs';
import { authFetch } from '../../utils/authFetch';
import {
  fmtBRL, fmtDate, STATUS_RECEITA_LABEL, STATUS_RECEITA_COLOR,
  exportCSV, parseBRLMoney, todayInSaoPaulo,
} from './finUtils';

interface Receita {
  id: string;
  descricao: string;
  valor_bruto: number;
  valor_liquido: number;
  data_vencimento: string | null;
  data_pagamento?: string | null;
  data_recebimento_real?: string | null;
  status: string;
  categoria_id: string | null;
  categoria_nome?: string;
  meio_id: string | null;
  meio_nome?: string;
  cliente_nome?: string;
  conta_id?: string | null;
  origem_automatica?: boolean;
  origem_ref?: string | null;
  ofx_vinculado?: boolean;
}

interface Categoria { id: string; nome: string; cor: string; }
interface Meio { id: string; nome: string; tipo?: string; }
interface Conta { id: string; nome: string; tipo?: string; banco?: string | null; }

const STATUSES = ['abertos', 'todos', 'pendente', 'recebido', 'atrasado', 'cancelado'];

const valorLiquido = (receita: Receita) => Number(receita.valor_liquido ?? receita.valor_bruto ?? 0);

const motivoGerenciamento = (receita: Receita) => {
  if (receita.ofx_vinculado) return 'Conciliado pelo extrato';
  if (receita.origem_automatica || receita.origem_ref?.startsWith('job_')) return 'Gerenciado pelo trabalho';
  return null;
};

const mensagemErro = async (response: Response, fallback: string) => {
  const body = await response.json().catch(() => ({}));
  return body?.message || body?.error || fallback;
};

const responseRows = async <T,>(response: Response, fallback: string): Promise<T[]> => {
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.message || body?.error || fallback);
  if (!Array.isArray(body)) throw new Error('O financeiro retornou dados em um formato inesperado.');
  return body as T[];
};

const erroDesconhecido = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

const normalizeName = (value: string) => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]/g, '');

const isInfinitePayIdentity = (value: string) => {
  const normalized = normalizeName(value);
  return normalized.includes('infinitepay')
    || normalized.includes('infinitypay')
    || normalized.includes('cloudwalk');
};

const meioUsaInfinitePay = (meio?: Meio) => {
  if (!meio) return false;
  const name = normalizeName(meio.nome);
  return meio.tipo === 'link_pagamento' || name.includes('infinitepay') || name.includes('link');
};

const contaInfinitePay = (conta: Conta) => (
  conta.tipo === 'intermediador' && isInfinitePayIdentity(`${conta.nome} ${conta.banco || ''}`)
);

const emptyForm = {
  descricao: '',
  valor_bruto: '',
  data_vencimento: '',
  categoria_id: '',
  meio_id: '',
  cliente_nome: '',
};

export default function ContasReceber() {
  const [receitas, setReceitas] = useState<Receita[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [meios, setMeios] = useState<Meio[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [busca, setBusca] = useState('');
  const [statusFiltro, setStatusFiltro] = useState('abertos');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [editando, setEditando] = useState<Receita | null>(null);
  const [receberFor, setReceberFor] = useState<Receita | null>(null);
  const [dataReceb, setDataReceb] = useState('');
  const [dataDisponivel, setDataDisponivel] = useState('');
  const [contas, setContas] = useState<Conta[]>([]);
  const [contaReceb, setContaReceb] = useState('');
  const [actionError, setActionError] = useState('');

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setLoadError('');
    try {
      const [rRes, cRes, mRes, ctRes] = await Promise.all([
        authFetch('/api/fin/receitas'),
        authFetch('/api/fin/categorias?tipo=receita'),
        authFetch('/api/fin/meios'),
        authFetch('/api/fin/contas'),
      ]);
      const [receiptRows, categoryRows, methodRows, accountRows] = await Promise.all([
        responseRows<Receita>(rRes, 'Não foi possível carregar as receitas.'),
        responseRows<Categoria>(cRes, 'Não foi possível carregar as categorias.'),
        responseRows<Meio>(mRes, 'Não foi possível carregar os meios de recebimento.'),
        responseRows<Conta>(ctRes, 'Não foi possível carregar as contas.'),
      ]);
      setReceitas(receiptRows);
      setCategorias(categoryRows);
      setMeios(methodRows);
      setContas(accountRows);
      return true;
    } catch (error) {
      setReceitas([]);
      setCategorias([]);
      setMeios([]);
      setContas([]);
      setLoadError(erroDesconhecido(error, 'Não foi possível carregar as contas a receber.'));
      return false;
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!receberFor) return;
    const method = meios.find(item => item.id === receberFor.meio_id);
    const eligibleAccounts = meioUsaInfinitePay(method) ? contas.filter(contaInfinitePay) : contas;
    const savedAccount = eligibleAccounts.some(conta => conta.id === receberFor.conta_id)
      ? receberFor.conta_id || ''
      : '';
    setContaReceb(savedAccount);
  }, [receberFor, contas, meios]);

  const marcarRecebido = async (id: string, dataPagamento: string, dataCaixa: string, contaId: string) => {
    setActionError('');
    if (!contaId) {
      setActionError('Selecione a conta que recebeu o valor.');
      return;
    }
    if (!dataPagamento || !dataCaixa) {
      setActionError('Informe as datas do recebimento.');
      return;
    }
    if (dataCaixa < dataPagamento) {
      setActionError('A disponibilidade do valor não pode anteceder o pagamento do cliente.');
      return;
    }
    setSaving(true);
    try {
      const res = await authFetch(`/api/fin/receitas/${id}/receber`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data_pagamento: dataPagamento,
          data_recebimento_real: dataCaixa,
          conta_id: contaId,
        }),
      });
      if (!res.ok) {
        setActionError(await mensagemErro(res, 'Não foi possível registrar o recebimento.'));
        return;
      }
      const refreshed = await load(true);
      if (refreshed) setReceberFor(null);
    } catch (error) {
      setActionError(erroDesconhecido(error, 'Não foi possível registrar o recebimento.'));
    } finally {
      setSaving(false);
    }
  };

  const deletar = async () => {
    if (!confirmDelete) return;
    setActionError('');
    const receita = receitas.find(item => item.id === confirmDelete);
    if (receita && motivoGerenciamento(receita)) {
      setConfirmDelete(null);
      return;
    }
    setSaving(true);
    try {
      const res = await authFetch(`/api/fin/receitas/${confirmDelete}`, { method: 'DELETE' });
      if (!res.ok) {
        setActionError(await mensagemErro(res, 'Não foi possível excluir o lançamento.'));
        return;
      }
      setReceitas(prev => prev.filter(r => r.id !== confirmDelete));
      setConfirmDelete(null);
    } catch (error) {
      setActionError(erroDesconhecido(error, 'Não foi possível excluir o lançamento.'));
    } finally {
      setSaving(false);
    }
  };

  const salvar = async () => {
    if (!form.descricao || !form.valor_bruto) return;
    const valor = parseBRLMoney(form.valor_bruto);
    if (valor === null || valor <= 0) {
      setActionError('Informe um valor válido e maior que zero. Exemplo: 1.234,56.');
      return;
    }
    setSaving(true);
    setActionError('');
    try {
      const body = {
        descricao: form.descricao,
        valor_bruto: valor,
        status: 'pendente',
        data_vencimento: form.data_vencimento || null,
        categoria_id: form.categoria_id || null,
        meio_id: form.meio_id || null,
        cliente_nome: form.cliente_nome || null,
      };
      const res = await authFetch('/api/fin/receitas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setActionError(await mensagemErro(res, 'Não foi possível criar a receita.'));
        return;
      }
      const refreshed = await load();
      if (refreshed) {
        setShowForm(false);
        setForm(emptyForm);
      }
    } catch (error) {
      setActionError(erroDesconhecido(error, 'Não foi possível criar a receita.'));
    } finally {
      setSaving(false);
    }
  };

  const saveEdit = async () => {
    if (!editando) return;
    if (motivoGerenciamento(editando)) {
      setEditando(null);
      return;
    }
    const valor = parseBRLMoney(editando.valor_bruto);
    if (valor === null || valor <= 0) {
      setActionError('Informe um valor válido e maior que zero.');
      return;
    }
    setActionError('');
    setSaving(true);
    try {
      const res = await authFetch(`/api/fin/receitas/${editando.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          descricao: editando.descricao,
          valor_bruto: valor,
          data_vencimento: editando.data_vencimento,
          categoria_id: editando.categoria_id,
          meio_id: editando.meio_id,
          cliente_nome: editando.cliente_nome,
        }),
      });
      if (!res.ok) {
        setActionError(await mensagemErro(res, 'Não foi possível atualizar a receita.'));
        return;
      }
      const refreshed = await load(true);
      if (refreshed) setEditando(null);
    } catch (error) {
      setActionError(erroDesconhecido(error, 'Não foi possível atualizar a receita.'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-violet-600" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="space-y-5">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Contas a Receber</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">Recebimentos previstos e realizados</p>
        </div>
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-center dark:border-rose-800 dark:bg-rose-900/20">
          <AlertTriangle className="mx-auto mb-2 h-7 w-7 text-rose-500" />
          <p className="text-sm font-semibold text-rose-800 dark:text-rose-200">Os lançamentos não puderam ser carregados</p>
          <p className="mt-1 text-xs text-rose-700 dark:text-rose-300">{loadError}</p>
          <button
            onClick={() => load()}
            className="mx-auto mt-4 flex items-center gap-2 rounded-lg border border-rose-300 px-3 py-1.5 text-sm font-medium text-rose-700 hover:bg-rose-100 dark:border-rose-700 dark:text-rose-200 dark:hover:bg-rose-900/30"
          >
            <RefreshCw className="h-4 w-4" /> Tentar novamente
          </button>
        </div>
      </div>
    );
  }

  const filtradas = receitas.filter(r => {
    const matchBusca = !busca || r.descricao.toLowerCase().includes(busca.toLowerCase()) || (r.cliente_nome ?? '').toLowerCase().includes(busca.toLowerCase());
    const matchStatus = statusFiltro === 'todos'
      || (statusFiltro === 'abertos' ? ['pendente', 'atrasado'].includes(r.status) : r.status === statusFiltro);
    return matchBusca && matchStatus;
  });

  const totalFiltrado = filtradas.filter(r => r.status !== 'cancelado').reduce((acc, r) => acc + valorLiquido(r), 0);
  const totalAberto = receitas.filter(r => ['pendente', 'atrasado'].includes(r.status)).reduce((acc, r) => acc + valorLiquido(r), 0);
  const totalRecebido = receitas.filter(r => r.status === 'recebido').reduce((acc, r) => acc + valorLiquido(r), 0);
  const meioRecebimento = meios.find(meio => meio.id === receberFor?.meio_id);
  const recebimentoViaInfinitePay = meioUsaInfinitePay(meioRecebimento);
  const contasRecebimento = recebimentoViaInfinitePay ? contas.filter(contaInfinitePay) : contas;
  const meioNovoLancamento = meios.find(meio => meio.id === form.meio_id);
  const novoLancamentoViaLink = meioUsaInfinitePay(meioNovoLancamento);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Contas a Receber</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {filtradas.length} lançamento{filtradas.length !== 1 ? 's' : ''} · {fmtBRL(totalFiltrado)} líquido no filtro · cancelados não somam
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => exportCSV(filtradas.map(r => ({
              Descrição: r.descricao, 'Valor bruto': r.valor_bruto, 'Valor líquido': valorLiquido(r), Vencimento: r.data_vencimento ?? '',
              Status: STATUS_RECEITA_LABEL[r.status] ?? r.status, Cliente: r.cliente_nome ?? '',
            })), 'contas_receber.csv')}
            className="text-sm px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            Exportar CSV
          </button>
          <button
            onClick={() => { setActionError(''); setShowForm(true); }}
            className="flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg bg-violet-600 text-white hover:bg-violet-700"
          >
            <Plus className="w-4 h-4" /> Novo
          </button>
        </div>
      </div>

      {actionError && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-800 dark:bg-rose-900/20 dark:text-rose-300">
          {actionError}
        </div>
      )}

      <div className="grid grid-cols-2 divide-x divide-gray-100 overflow-hidden rounded-xl border border-gray-200 bg-white dark:divide-gray-700 dark:border-gray-700 dark:bg-gray-800">
        <div className="px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">A receber</p>
          <p className="mt-1 text-lg font-semibold text-amber-700 dark:text-amber-400">{fmtBRL(totalAberto)}</p>
          <p className="text-xs text-gray-400">pendente + atrasado</p>
        </div>
        <div className="px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Já recebido</p>
          <p className="mt-1 text-lg font-semibold text-emerald-700 dark:text-emerald-400">{fmtBRL(totalRecebido)}</p>
          <p className="text-xs text-gray-400">valor líquido após taxas</p>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={busca}
            onChange={e => setBusca(e.target.value)}
            placeholder="Buscar descrição ou cliente..."
            className="w-full pl-9 pr-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500"
          />
        </div>
        <div className="flex gap-1">
          {STATUSES.map(s => (
            <button
              key={s}
              onClick={() => setStatusFiltro(s)}
              className={`text-xs px-2.5 py-1.5 rounded-lg border font-medium transition-colors ${
                statusFiltro === s
                  ? 'bg-violet-600 border-violet-600 text-white'
                  : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
              }`}
            >
              {s === 'abertos' ? 'Em aberto' : s === 'todos' ? 'Todos' : STATUS_RECEITA_LABEL[s]}
            </button>
          ))}
        </div>
      </div>

      {/* Tabela */}
      {filtradas.length === 0 ? (
        <div className="text-center py-12 text-gray-400 dark:text-gray-500">
          <p className="text-sm">Nenhum lançamento encontrado</p>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400">
                <th className="text-left px-4 py-3 font-medium">Cliente</th>
                <th className="text-left px-4 py-3 font-medium">Descrição</th>
                <th className="text-left px-4 py-3 font-medium">Vencimento</th>
                <th className="text-right px-4 py-3 font-medium">Valor</th>
                <th className="text-center px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {filtradas.map(r => (
                editando?.id === r.id ? (
                  // ── Linha de edição inline ────────────────────────────────
                  <tr key={r.id} className="border-b border-violet-100 dark:border-violet-900/30 bg-violet-50/30 dark:bg-violet-900/10">
                    <td className="px-3 py-2">
                      <input
                        value={editando.cliente_nome ?? ''}
                        onChange={e => setEditando(ed => ed ? { ...ed, cliente_nome: e.target.value } : ed)}
                        className="w-full px-2 py-1 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-violet-500"
                        placeholder="Cliente"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        value={editando.descricao}
                        onChange={e => setEditando(ed => ed ? { ...ed, descricao: e.target.value } : ed)}
                        className="w-full px-2 py-1 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-violet-500"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <DatePicker
                        value={editando.data_vencimento ?? ''}
                        onChange={v => setEditando(ed => ed ? { ...ed, data_vencimento: v } : ed)}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <MoneyInput
                        value={String(editando.valor_bruto)}
                        onChange={v => setEditando(ed => ed ? { ...ed, valor_bruto: parseBRLMoney(v) ?? 0 } : ed)}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_RECEITA_COLOR[editando.status] ?? ''}`}>
                        {STATUS_RECEITA_LABEL[editando.status] ?? editando.status}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1 justify-end">
                        <button onClick={saveEdit} disabled={saving} className="p-1 rounded-md text-emerald-600 hover:bg-emerald-50 disabled:opacity-50 dark:hover:bg-emerald-900/30">
                          <Save className="w-4 h-4" />
                        </button>
                        <button onClick={() => setEditando(null)} className="p-1 rounded-md text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700">
                          <XCircle className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  // ── Linha normal ──────────────────────────────────────────
                  <tr key={r.id} className="border-b border-gray-50 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700/30 last:border-0">
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-800 dark:text-gray-200">{r.cliente_nome || '-'}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-gray-700 dark:text-gray-300">{r.descricao}</p>
                      {r.categoria_nome && <p className="text-xs text-gray-400">{r.categoria_nome}</p>}
                      {motivoGerenciamento(r) && (
                        <p className="mt-0.5 text-[10px] font-medium text-violet-600 dark:text-violet-300">
                          {motivoGerenciamento(r)}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-300">{fmtDate(r.data_vencimento)}</td>
                    <td className="px-4 py-3 text-right">
                      <p className="font-semibold text-gray-900 dark:text-white">{fmtBRL(valorLiquido(r))}</p>
                      {Math.abs(valorLiquido(r) - Number(r.valor_bruto || 0)) > 0.005 && (
                        <p className="text-[10px] text-gray-400">bruto {fmtBRL(Number(r.valor_bruto || 0))}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_RECEITA_COLOR[r.status] ?? ''}`}>
                        {STATUS_RECEITA_LABEL[r.status] ?? r.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 justify-end">
                        {!motivoGerenciamento(r) && (r.status === 'pendente' || r.status === 'atrasado') && (
                          <button
                            onClick={() => {
                              const hoje = todayInSaoPaulo();
                              setActionError('');
                              setDataReceb(hoje);
                              setDataDisponivel(hoje);
                              setReceberFor(r);
                            }}
                            title="Marcar como recebido"
                            className="p-1 rounded-md text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/30"
                          >
                            <CheckCircle2 className="w-4 h-4" />
                          </button>
                        )}
                        {!motivoGerenciamento(r) && (
                          <>
                            <button
                              onClick={() => { setActionError(''); setEditando(r); }}
                              title="Editar"
                              className="p-1 rounded-md text-gray-400 hover:text-violet-600 hover:bg-violet-50 dark:hover:bg-violet-900/20"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => { setActionError(''); setConfirmDelete(r.id); }}
                              title="Excluir"
                              className="p-1 rounded-md text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal: marcar como recebido (escolher a data real) */}
      {receberFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setReceberFor(null)}>
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700">
              <h3 className="font-semibold text-gray-900 dark:text-white">Marcar como recebido</h3>
              <button onClick={() => setReceberFor(null)} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400"><X className="w-4 h-4" /></button>
            </div>
            <div className="px-5 py-4 space-y-3">
              {actionError && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:bg-rose-900/20 dark:text-rose-300">{actionError}</p>}
              <div>
                <p className="text-xs text-gray-400 mb-0.5">Lançamento</p>
                <p className="font-medium text-gray-900 dark:text-white">{receberFor.cliente_nome || receberFor.descricao}</p>
                <p className="text-sm text-gray-500 dark:text-gray-400">{fmtBRL(valorLiquido(receberFor))} líquido</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                  {recebimentoViaInfinitePay ? 'Data em que o cliente pagou' : 'Data do recebimento'}
                </label>
                <DatePicker value={dataReceb} onChange={setDataReceb} />
              </div>
              {recebimentoViaInfinitePay && (
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Data em que o valor ficou disponível na InfinitePay</label>
                  <DatePicker value={dataDisponivel} onChange={setDataDisponivel} />
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                  {recebimentoViaInfinitePay ? 'Conta intermediadora que recebeu' : 'Banco / conta que recebeu'}
                </label>
                <FinSelect
                  value={contaReceb}
                  onChange={setContaReceb}
                  options={contasRecebimento.map(c => ({ value: c.id, label: c.nome }))}
                  placeholder={contasRecebimento.length ? 'Selecione a conta' : 'Crie a conta em Configurações'}
                />
              </div>
              {recebimentoViaInfinitePay ? (
                <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs leading-relaxed text-blue-700 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-300">
                  Registre aqui o pagamento do cliente na conta InfinitePay. Quando o valor for enviado para Nubank ou Itaú, esse movimento deve entrar como <strong>transferência entre contas</strong>, não como uma nova receita.
                </div>
              ) : (
                <p className="text-xs text-gray-400">Informe a data e a conta em que o dinheiro entrou. Isso permite cruzar o recebimento com o extrato bancário.</p>
              )}
              {recebimentoViaInfinitePay && contasRecebimento.length === 0 && (
                <p className="text-xs font-medium text-amber-700 dark:text-amber-300">Cadastre a InfinitePay como conta “Intermediadora / adquirente” em Configurações antes de confirmar.</p>
              )}
            </div>
            <div className="flex justify-end gap-2 px-5 py-4 border-t border-gray-100 dark:border-gray-700">
              <button onClick={() => setReceberFor(null)} className="px-4 py-2 text-sm font-medium rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700">Cancelar</button>
              <button
                onClick={() => marcarRecebido(
                  receberFor.id,
                  dataReceb,
                  recebimentoViaInfinitePay ? dataDisponivel : dataReceb,
                  contaReceb,
                )}
                disabled={saving || !dataReceb || (recebimentoViaInfinitePay && !dataDisponivel) || !contaReceb}
                className="px-4 py-2 text-sm font-semibold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
              >{saving ? 'Registrando...' : 'Confirmar'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal confirmação de exclusão */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-sm p-6 flex flex-col items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
              <AlertTriangle className="w-6 h-6 text-red-500" />
            </div>
            <div className="text-center">
              <p className="font-semibold text-gray-900 dark:text-white">Excluir lançamento?</p>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Essa ação não pode ser desfeita.</p>
            </div>
            {actionError && <p className="w-full rounded-lg bg-rose-50 px-3 py-2 text-center text-xs text-rose-700 dark:bg-rose-900/20 dark:text-rose-300">{actionError}</p>}
            <div className="flex gap-3 w-full">
              <button
                onClick={() => setConfirmDelete(null)}
                className="flex-1 px-4 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                Cancelar
              </button>
              <button
                onClick={deletar}
                disabled={saving}
                className="flex-1 px-4 py-2 text-sm rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
              >
                {saving ? 'Excluindo...' : 'Excluir'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal novo lançamento */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
              <h3 className="font-semibold text-gray-900 dark:text-white">Nova Receita</h3>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="px-6 py-4 space-y-4 max-h-[70vh] overflow-y-auto">
              {actionError && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:bg-rose-900/20 dark:text-rose-300">{actionError}</p>}
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Descrição *</label>
                <input
                  value={form.descricao}
                  onChange={e => setForm(f => ({ ...f, descricao: e.target.value }))}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500"
                  placeholder="Ex: Ensaio família Silva"
                  autoFocus
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Valor *</label>
                  <MoneyInput value={form.valor_bruto} onChange={v => setForm(f => ({ ...f, valor_bruto: v }))} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Vencimento</label>
                  <DatePicker
                    value={form.data_vencimento}
                    onChange={v => setForm(f => ({ ...f, data_vencimento: v }))}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Categoria</label>
                  <FinSelect
                    value={form.categoria_id}
                    onChange={v => setForm(f => ({ ...f, categoria_id: v }))}
                    options={categorias.map(c => ({ value: c.id, label: c.nome }))}
                    placeholder="Categoria"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Forma de Pagto.</label>
                  <FinSelect
                    value={form.meio_id}
                    onChange={v => setForm(f => ({ ...f, meio_id: v }))}
                    options={meios.map(m => ({ value: m.id, label: m.nome }))}
                    placeholder="Selecionar"
                  />
                </div>
              </div>
              {novoLancamentoViaLink && (
                <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs leading-relaxed text-blue-700 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-300">
                  No pagamento por link, o cliente paga pela InfinitePay. Ao marcar como recebido, escolha a conta InfinitePay; o envio posterior ao banco será uma transferência interna.
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Cliente</label>
                <input
                  value={form.cliente_nome}
                  onChange={e => setForm(f => ({ ...f, cliente_nome: e.target.value }))}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500"
                  placeholder="Nome do cliente"
                />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
              <button
                onClick={() => setShowForm(false)}
                className="px-4 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                Cancelar
              </button>
              <button
                onClick={salvar}
                disabled={saving || !form.descricao || !form.valor_bruto}
                className="px-4 py-2 text-sm rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50"
              >
                {saving ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

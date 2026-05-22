import React, { useEffect, useState, useCallback } from 'react';
import { Plus, CheckCircle2, Search, Trash2, X, AlertTriangle, Edit2, Save, XCircle } from 'lucide-react';
import { MoneyInput, FinSelect, Toggle, DatePicker } from './FinInputs';
import { authFetch } from '../../utils/authFetch';
import {
  fmtBRL, fmtDate, STATUS_RECEITA_LABEL, STATUS_RECEITA_COLOR,
  exportCSV,
} from './finUtils';

interface Receita {
  id: string;
  descricao: string;
  valor_bruto: number;
  valor_liquido: number;
  data_vencimento: string | null;
  data_recebimento: string | null;
  status: string;
  categoria_id: string | null;
  categoria_nome?: string;
  meio_id: string | null;
  meio_nome?: string;
  cliente_nome?: string;
  recorrente: boolean;
}

interface Categoria { id: string; nome: string; cor: string; }
interface Meio { id: string; nome: string; }

const STATUSES = ['todos', 'pendente', 'recebido', 'atrasado', 'cancelado'];

const emptyForm = {
  descricao: '',
  valor_bruto: '',
  data_vencimento: '',
  categoria_id: '',
  meio_id: '',
  cliente_nome: '',
  recorrente: false,
  recorrencia_tipo: 'mensal',
  recorrencia_qtd: '1',
};

export default function ContasReceber() {
  const [receitas, setReceitas] = useState<Receita[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [meios, setMeios] = useState<Meio[]>([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState('');
  const [statusFiltro, setStatusFiltro] = useState('todos');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [editando, setEditando] = useState<Receita | null>(null);
  const [receberFor, setReceberFor] = useState<Receita | null>(null);
  const [dataReceb, setDataReceb] = useState('');

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [rRes, cRes, mRes] = await Promise.all([
        authFetch('/api/fin/receitas'),
        authFetch('/api/fin/categorias?tipo=receita'),
        authFetch('/api/fin/meios'),
      ]);
      if (rRes.ok) setReceitas(await rRes.json());
      if (cRes.ok) setCategorias(await cRes.json());
      if (mRes.ok) setMeios(await mRes.json());
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    // Sincroniza com a Produção em segundo plano — limpa o que está fora dela
    (async () => {
      try {
        await authFetch('/api/fin/sync-jobs', { method: 'POST' });
        load(true);
      } catch { /* segue com os dados atuais */ }
    })();
  }, [load]);

  const marcarRecebido = async (id: string, data: string) => {
    const res = await authFetch(`/api/fin/receitas/${id}/receber`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data_pagamento: data }),
    });
    if (res.ok) {
      setReceitas(prev => prev.map(r =>
        r.id === id ? { ...r, status: 'recebido', data_recebimento: data } : r
      ));
    }
    setReceberFor(null);
  };

  const deletar = async () => {
    if (!confirmDelete) return;
    const res = await authFetch(`/api/fin/receitas/${confirmDelete}`, { method: 'DELETE' });
    if (res.ok) setReceitas(prev => prev.filter(r => r.id !== confirmDelete));
    setConfirmDelete(null);
  };

  const salvar = async () => {
    if (!form.descricao || !form.valor_bruto) return;
    setSaving(true);
    try {
      const valor = parseFloat(form.valor_bruto.replace(',', '.'));
      const body = {
        descricao: form.descricao,
        valor_bruto: valor,
        valor_liquido: valor,
        status: 'pendente',
        data_vencimento: form.data_vencimento || null,
        categoria_id: form.categoria_id || null,
        meio_id: form.meio_id || null,
        cliente_nome: form.cliente_nome || null,
        recorrente: form.recorrente,
        recorrencia_tipo: form.recorrente ? form.recorrencia_tipo : null,
        recorrencia_qtd: form.recorrente ? parseInt(form.recorrencia_qtd) : null,
      };
      const res = await authFetch('/api/fin/receitas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        await load();
        setShowForm(false);
        setForm(emptyForm);
      }
    } finally {
      setSaving(false);
    }
  };

  const saveEdit = async () => {
    if (!editando) return;
    const res = await authFetch(`/api/fin/receitas/${editando.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        descricao: editando.descricao,
        valor_bruto: editando.valor_bruto,
        valor_liquido: editando.valor_liquido ?? editando.valor_bruto,
        data_vencimento: editando.data_vencimento,
        categoria_id: editando.categoria_id,
        meio_id: editando.meio_id,
        cliente_nome: editando.cliente_nome,
        status: editando.status,
      }),
    });
    if (res.ok) {
      setReceitas(prev => prev.map(r => r.id === editando.id ? editando : r));
      setEditando(null);
    }
  };

  const filtradas = receitas.filter(r => {
    const matchBusca = !busca || r.descricao.toLowerCase().includes(busca.toLowerCase()) || (r.cliente_nome ?? '').toLowerCase().includes(busca.toLowerCase());
    const matchStatus = statusFiltro === 'todos' || r.status === statusFiltro;
    return matchBusca && matchStatus;
  });

  const totalFiltrado = filtradas.reduce((acc, r) => acc + (r.valor_bruto || 0), 0);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Contas a Receber</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {filtradas.length} lançamento{filtradas.length !== 1 ? 's' : ''} · {fmtBRL(totalFiltrado)}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => exportCSV(filtradas.map(r => ({
              Descrição: r.descricao, Valor: r.valor_bruto, Vencimento: r.data_vencimento ?? '',
              Status: STATUS_RECEITA_LABEL[r.status] ?? r.status, Cliente: r.cliente_nome ?? '',
            })), 'contas_receber.csv')}
            className="text-sm px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            Exportar CSV
          </button>
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg bg-violet-600 text-white hover:bg-violet-700"
          >
            <Plus className="w-4 h-4" /> Novo
          </button>
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
              {s === 'todos' ? 'Todos' : STATUS_RECEITA_LABEL[s]}
            </button>
          ))}
        </div>
      </div>

      {/* Tabela */}
      {loading ? (
        <div className="flex items-center justify-center h-40">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-violet-600" />
        </div>
      ) : filtradas.length === 0 ? (
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
                        onChange={v => setEditando(ed => ed ? { ...ed, valor_bruto: parseFloat(v.replace(',', '.')) || 0 } : ed)}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <FinSelect
                        value={editando.status}
                        onChange={v => setEditando(ed => ed ? { ...ed, status: v } : ed)}
                        nullable={false}
                        options={[
                          { value: 'pendente', label: 'Pendente' },
                          { value: 'recebido', label: 'Recebido' },
                          { value: 'atrasado', label: 'Atrasado' },
                          { value: 'cancelado', label: 'Cancelado' },
                        ]}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1 justify-end">
                        <button onClick={saveEdit} className="p-1 rounded-md text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/30">
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
                      <p className="font-medium text-gray-800 dark:text-gray-200">{r.cliente_nome || '—'}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-gray-700 dark:text-gray-300">{r.descricao}</p>
                      {r.categoria_nome && <p className="text-xs text-gray-400">{r.categoria_nome}</p>}
                    </td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-300">{fmtDate(r.data_vencimento)}</td>
                    <td className="px-4 py-3 text-right font-semibold text-gray-900 dark:text-white">{fmtBRL(r.valor_bruto)}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_RECEITA_COLOR[r.status] ?? ''}`}>
                        {STATUS_RECEITA_LABEL[r.status] ?? r.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 justify-end">
                        {(r.status === 'pendente' || r.status === 'atrasado') && (
                          <button
                            onClick={() => { setReceberFor(r); setDataReceb(new Date().toISOString().split('T')[0]); }}
                            title="Marcar como recebido"
                            className="p-1 rounded-md text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/30"
                          >
                            <CheckCircle2 className="w-4 h-4" />
                          </button>
                        )}
                        <button
                          onClick={() => setEditando(r)}
                          title="Editar"
                          className="p-1 rounded-md text-gray-400 hover:text-violet-600 hover:bg-violet-50 dark:hover:bg-violet-900/20"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setConfirmDelete(r.id)}
                          title="Excluir"
                          className="p-1 rounded-md text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
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
              <div>
                <p className="text-xs text-gray-400 mb-0.5">Lançamento</p>
                <p className="font-medium text-gray-900 dark:text-white">{receberFor.cliente_nome || receberFor.descricao}</p>
                <p className="text-sm text-gray-500 dark:text-gray-400">{fmtBRL(receberFor.valor_bruto)}</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Data do recebimento</label>
                <DatePicker value={dataReceb} onChange={setDataReceb} />
              </div>
              <p className="text-xs text-gray-400">Coloque a data real em que o dinheiro entrou — assim o faturamento conta no mês certo.</p>
            </div>
            <div className="flex justify-end gap-2 px-5 py-4 border-t border-gray-100 dark:border-gray-700">
              <button onClick={() => setReceberFor(null)} className="px-4 py-2 text-sm font-medium rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700">Cancelar</button>
              <button onClick={() => { if (dataReceb) marcarRecebido(receberFor.id, dataReceb); }} className="px-4 py-2 text-sm font-semibold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700">Confirmar</button>
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
            <div className="flex gap-3 w-full">
              <button
                onClick={() => setConfirmDelete(null)}
                className="flex-1 px-4 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                Cancelar
              </button>
              <button
                onClick={deletar}
                className="flex-1 px-4 py-2 text-sm rounded-lg bg-red-600 text-white hover:bg-red-700"
              >
                Excluir
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
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Cliente</label>
                <input
                  value={form.cliente_nome}
                  onChange={e => setForm(f => ({ ...f, cliente_nome: e.target.value }))}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500"
                  placeholder="Nome do cliente"
                />
              </div>
              <div className="flex items-center justify-between px-3 py-3 rounded-xl bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700">
                <Toggle
                  checked={form.recorrente}
                  onChange={v => setForm(f => ({ ...f, recorrente: v }))}
                  label="Receita recorrente"
                  description="Repete automaticamente no período escolhido"
                />
              </div>
              {form.recorrente && (
                <div className="grid grid-cols-2 gap-3 pl-1">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Frequência</label>
                    <FinSelect
                      value={form.recorrencia_tipo}
                      onChange={v => setForm(f => ({ ...f, recorrencia_tipo: v }))}
                      nullable={false}
                      options={[
                        { value: 'semanal', label: 'Semanal' },
                        { value: 'mensal', label: 'Mensal' },
                        { value: 'trimestral', label: 'Trimestral' },
                        { value: 'anual', label: 'Anual' },
                      ]}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Repetições</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={form.recorrencia_qtd === '1' ? '' : form.recorrencia_qtd}
                      onChange={e => setForm(f => ({ ...f, recorrencia_qtd: e.target.value.replace(/[^0-9]/g, '') || '1' }))}
                      placeholder="1"
                      className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500"
                    />
                  </div>
                </div>
              )}
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

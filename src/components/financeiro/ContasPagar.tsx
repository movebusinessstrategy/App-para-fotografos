import React, { useEffect, useState, useCallback } from 'react';
import { Plus, CheckCircle2, Search, Trash2, X, AlertTriangle, Edit2, Save, XCircle, RefreshCw } from 'lucide-react';
import { MoneyInput, FinSelect, Toggle, DatePicker } from './FinInputs';
import { authFetch } from '../../utils/authFetch';
import {
  fmtBRL, fmtDate, STATUS_DESPESA_LABEL, STATUS_DESPESA_COLOR,
  exportCSV,
} from './finUtils';

interface Despesa {
  id: string;
  descricao: string;
  valor: number;
  data_vencimento: string | null;
  data_pagamento: string | null;
  status: string;
  categoria_id: string | null;
  categoria_nome?: string;
  meio_id: string | null;
  meio_nome?: string;
  fornecedor?: string;
  observacoes?: string;
  recorrente: boolean;
  frequencia_recorrencia?: string;
}

interface Categoria { id: string; nome: string; cor: string; }
interface Meio { id: string; nome: string; }

const STATUSES = ['todos', 'pendente', 'pago', 'atrasado', 'cancelado'];

const emptyForm = {
  descricao: '',
  valor: '',
  data_vencimento: '',
  data_pagamento: '',
  categoria_id: '',
  meio_id: '',
  fornecedor: '',
  tipo_pessoa: 'PF',
  recorrente: false,
  recorrencia_tipo: 'mensal',
  recorrencia_qtd: '1',
};

// detecta se o meio selecionado é cartão (pela label)
function isMeioCartao(meioId: string, meios: Meio[]) {
  const m = meios.find(m => m.id === meioId);
  return m ? /cart[aã]o/i.test(m.nome) : false;
}

export default function ContasPagar() {
  const [despesas, setDespesas] = useState<Despesa[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [meios, setMeios] = useState<Meio[]>([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState('');
  const [statusFiltro, setStatusFiltro] = useState('todos');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [editando, setEditando] = useState<Despesa | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [dRes, cRes, mRes] = await Promise.all([
        authFetch('/api/fin/despesas'),
        authFetch('/api/fin/categorias?tipo=despesa'),
        authFetch('/api/fin/meios'),
      ]);
      if (dRes.ok) setDespesas(await dRes.json());
      if (cRes.ok) setCategorias(await cRes.json());
      if (mRes.ok) setMeios(await mRes.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const marcarPago = async (id: string) => {
    const hoje = new Date().toISOString().split('T')[0];
    const res = await authFetch(`/api/fin/despesas/${id}/pagar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data_pagamento: hoje }),
    });
    if (res.ok) {
      setDespesas(prev => prev.map(d =>
        d.id === id ? { ...d, status: 'pago', data_pagamento: hoje } : d
      ));
    }
  };

  const deletar = async () => {
    if (!confirmDelete) return;
    const res = await authFetch(`/api/fin/despesas/${confirmDelete}`, { method: 'DELETE' });
    if (res.ok) setDespesas(prev => prev.filter(d => d.id !== confirmDelete));
    setConfirmDelete(null);
  };

  const salvar = async () => {
    if (!form.descricao || !form.valor) return;
    setSaving(true);
    try {
      const ehCartao = isMeioCartao(form.meio_id, meios);
      const body = {
        descricao: form.descricao,
        valor: parseFloat(form.valor.replace(',', '.')),
        status: 'pendente',
        data_vencimento: form.data_vencimento || null,
        data_pagamento: form.data_pagamento || null,
        categoria_id: form.categoria_id || null,
        meio_id: form.meio_id || null,
        fornecedor: ehCartao ? null : (form.fornecedor || null),
        observacoes: [
          form.tipo_pessoa ? `Tipo: ${form.tipo_pessoa}` : '',
          ehCartao && form.fornecedor ? `Cartão: ${form.fornecedor}` : '',
        ].filter(Boolean).join(' | ') || null,
        recorrente: form.recorrente,
        recorrencia_tipo: form.recorrente ? form.recorrencia_tipo : null,
        recorrencia_qtd: form.recorrente ? parseInt(form.recorrencia_qtd) : null,
      };
      const res = await authFetch('/api/fin/despesas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        await load();
        setShowForm(false);
        setForm(emptyForm);
      } else {
        const err = await res.json().catch(() => ({}));
        console.error('Erro ao salvar despesa:', err);
      }
    } finally {
      setSaving(false);
    }
  };

  const saveEdit = async () => {
    if (!editando) return;
    const res = await authFetch(`/api/fin/despesas/${editando.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        descricao: editando.descricao,
        valor: editando.valor,
        data_vencimento: editando.data_vencimento,
        data_pagamento: editando.data_pagamento,
        categoria_id: editando.categoria_id,
        meio_id: editando.meio_id,
        fornecedor: editando.fornecedor,
        status: editando.status,
      }),
    });
    if (res.ok) {
      setDespesas(prev => prev.map(d => d.id === editando.id ? editando : d));
      setEditando(null);
    }
  };

  const filtradas = despesas.filter(d => {
    const matchBusca = !busca || d.descricao.toLowerCase().includes(busca.toLowerCase()) || (d.fornecedor ?? '').toLowerCase().includes(busca.toLowerCase());
    const matchStatus = statusFiltro === 'todos' || d.status === statusFiltro;
    return matchBusca && matchStatus;
  });

  const totalFiltrado = filtradas.reduce((acc, d) => acc + (d.valor || 0), 0);
  const ehCartaoForm = isMeioCartao(form.meio_id, meios);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Contas a Pagar</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {filtradas.length} lançamento{filtradas.length !== 1 ? 's' : ''} · {fmtBRL(totalFiltrado)}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => exportCSV(filtradas.map(d => ({
              Descrição: d.descricao, Valor: d.valor, Vencimento: d.data_vencimento ?? '',
              Status: STATUS_DESPESA_LABEL[d.status] ?? d.status, Fornecedor: d.fornecedor ?? '',
            })), 'contas_pagar.csv')}
            className="text-sm px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            Exportar CSV
          </button>
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg bg-violet-600 text-white hover:bg-violet-700"
          >
            <Plus className="w-4 h-4" /> Nova
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
            placeholder="Buscar descrição ou fornecedor..."
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
              {s === 'todos' ? 'Todos' : STATUS_DESPESA_LABEL[s]}
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
                <th className="text-left px-4 py-3 font-medium">Descrição</th>
                <th className="text-left px-4 py-3 font-medium">Fornecedor</th>
                <th className="text-left px-4 py-3 font-medium">Vencimento</th>
                <th className="text-right px-4 py-3 font-medium">Valor</th>
                <th className="text-center px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {filtradas.map(d => (
                editando?.id === d.id ? (
                  // ── Linha de edição inline ──────────────────────────────
                  <tr key={d.id} className="border-b border-violet-100 dark:border-violet-900/30 bg-violet-50/30 dark:bg-violet-900/10">
                    <td className="px-3 py-2">
                      <input
                        value={editando.descricao}
                        onChange={e => setEditando(ed => ed ? { ...ed, descricao: e.target.value } : ed)}
                        className="w-full px-2 py-1 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-violet-500"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        value={editando.fornecedor ?? ''}
                        onChange={e => setEditando(ed => ed ? { ...ed, fornecedor: e.target.value } : ed)}
                        className="w-full px-2 py-1 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-violet-500"
                        placeholder="Fornecedor"
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
                        value={String(editando.valor)}
                        onChange={v => setEditando(ed => ed ? { ...ed, valor: parseFloat(v.replace(',', '.')) || 0 } : ed)}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <FinSelect
                        value={editando.status}
                        onChange={v => setEditando(ed => ed ? { ...ed, status: v } : ed)}
                        nullable={false}
                        options={[
                          { value: 'pendente', label: 'Pendente' },
                          { value: 'pago', label: 'Pago' },
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
                  // ── Linha normal ────────────────────────────────────────
                  <tr key={d.id} className="border-b border-gray-50 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700/30 last:border-0">
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-800 dark:text-gray-200">{d.descricao}</p>
                      {d.categoria_nome && <p className="text-xs text-gray-400">{d.categoria_nome}</p>}
                      {d.recorrente && (
                        <span className="inline-flex items-center gap-1 text-xs text-violet-500">
                          <RefreshCw className="w-3 h-3" /> Recorrente
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-300">{d.fornecedor ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-300">{fmtDate(d.data_vencimento)}</td>
                    <td className="px-4 py-3 text-right font-semibold text-gray-900 dark:text-white">{fmtBRL(d.valor)}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_DESPESA_COLOR[d.status] ?? ''}`}>
                        {STATUS_DESPESA_LABEL[d.status] ?? d.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 justify-end">
                        {(d.status === 'pendente' || d.status === 'atrasado') && (
                          <button
                            onClick={() => marcarPago(d.id)}
                            title="Marcar como pago"
                            className="p-1 rounded-md text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/30"
                          >
                            <CheckCircle2 className="w-4 h-4" />
                          </button>
                        )}
                        <button
                          onClick={() => setEditando(d)}
                          title="Editar"
                          className="p-1 rounded-md text-gray-400 hover:text-violet-600 hover:bg-violet-50 dark:hover:bg-violet-900/20"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setConfirmDelete(d.id)}
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

      {/* Modal nova despesa */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
              <h3 className="font-semibold text-gray-900 dark:text-white">Nova Despesa</h3>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="px-6 py-4 space-y-4 max-h-[75vh] overflow-y-auto">

              {/* Descrição */}
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Descrição *</label>
                <input
                  value={form.descricao}
                  onChange={e => setForm(f => ({ ...f, descricao: e.target.value }))}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500"
                  placeholder="Ex: Assinatura Adobe"
                  autoFocus
                />
              </div>

              {/* Valor + Vencimento */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Valor *</label>
                  <MoneyInput value={form.valor} onChange={v => setForm(f => ({ ...f, valor: v }))} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Vencimento</label>
                  <DatePicker
                    value={form.data_vencimento}
                    onChange={v => setForm(f => ({ ...f, data_vencimento: v }))}
                  />
                </div>
              </div>

              {/* Data de pagamento */}
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Data de Pagamento</label>
                <DatePicker
                  value={form.data_pagamento}
                  onChange={v => setForm(f => ({ ...f, data_pagamento: v }))}
                  placeholder="Selecionar data de pagamento"
                />
              </div>

              {/* Categoria + Meio */}
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

              {/* Fornecedor / Nome do Cartão (contextual) */}
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                  {ehCartaoForm ? 'Nome do Cartão' : 'Fornecedor'}
                </label>
                <input
                  value={form.fornecedor}
                  onChange={e => setForm(f => ({ ...f, fornecedor: e.target.value }))}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500"
                  placeholder={ehCartaoForm ? 'Ex: Nubank, Itaú Visa...' : 'Nome do fornecedor'}
                />
              </div>

              {/* PF / PJ */}
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">Tipo de Pessoa</label>
                <div className="flex gap-2">
                  {(['PF', 'PJ'] as const).map(tipo => (
                    <button
                      key={tipo}
                      type="button"
                      onClick={() => setForm(f => ({ ...f, tipo_pessoa: tipo }))}
                      className={`flex-1 py-2 text-sm rounded-lg border font-medium transition-colors ${
                        form.tipo_pessoa === tipo
                          ? 'bg-violet-600 border-violet-600 text-white'
                          : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                      }`}
                    >
                      {tipo === 'PF' ? 'Pessoa Física (PF)' : 'Pessoa Jurídica (PJ)'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Recorrente */}
              <div className="flex items-center justify-between px-3 py-3 rounded-xl bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700">
                <Toggle
                  checked={form.recorrente}
                  onChange={v => setForm(f => ({ ...f, recorrente: v }))}
                  label="Despesa recorrente"
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
                disabled={saving || !form.descricao || !form.valor}
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

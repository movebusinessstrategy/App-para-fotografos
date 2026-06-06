import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  Upload, Link2, Check, X, AlertCircle, RefreshCw, FileText, Plus,
} from 'lucide-react';
import { authFetch } from '../../utils/authFetch';
import { fmtBRL, fmtDate } from './finUtils';
import { FinSelect } from './FinInputs';

interface Transacao {
  id: string;
  data: string;
  descricao: string;
  valor: number;
  tipo: 'credito' | 'debito';
  conciliado: boolean;
  status_conciliacao?: string;
  receita_id?: string | null;
  despesa_id?: string | null;
  origem?: string;
}

interface Conta { id: string; nome: string; }

interface OFXImportResult {
  importadas: number;
  duplicadas: number;
  conciliadas?: number;
  ignoradas_saldo?: number;
  total?: number;
  erros?: number;
}

export default function Conciliacao() {
  const [transacoes, setTransacoes] = useState<Transacao[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<OFXImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importProgress, setImportProgress] = useState<{ done: number; total: number } | null>(null);
  const [filtro, setFiltro] = useState<'todas' | 'pendentes' | 'conciliadas'>('pendentes');
  const [contas, setContas] = useState<Conta[]>([]);
  const [contaId, setContaId] = useState<string>('');
  // Conciliação manual
  const [conciliarFor, setConciliarFor] = useState<Transacao | null>(null);
  const [modo, setModo] = useState<'vincular' | 'criar'>('vincular');
  const [categorias, setCategorias] = useState<{ id: string; nome: string }[]>([]);
  const [lancamentos, setLancamentos] = useState<any[]>([]);
  const [novaDesc, setNovaDesc] = useState('');
  const [novaCategoria, setNovaCategoria] = useState('');
  const [buscaLanc, setBuscaLanc] = useState('');
  const [savingConc, setSavingConc] = useState(false);
  const [concError, setConcError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authFetch('/api/fin/ofx/transacoes');
      if (res.ok) {
        const rows = await res.json();
        setTransacoes((rows || []).map((r: any) => ({
          ...r,
          conciliado: r.conciliado ?? r.status_conciliacao === 'conciliado',
        })));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const loadContas = useCallback(async () => {
    const res = await authFetch('/api/fin/contas');
    if (!res.ok) return;
    const data: Conta[] = await res.json();
    setContas(data || []);
    setContaId(prev => prev || data?.[0]?.id || '');
  }, []);

  useEffect(() => { load(); loadContas(); }, [load, loadContas]);

  const importarOFX = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!contaId) {
      setImportError('Selecione (ou crie em Configurações) uma conta antes de importar o OFX.');
      if (fileRef.current) fileRef.current.value = '';
      return;
    }
    setImporting(true);
    setImportResult(null);
    setImportError(null);
    setImportProgress(null);
    try {
      const text = await file.text();

      const enviarLote = async (conteudo: string) => {
        const res = await authFetch('/api/fin/ofx/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ conteudo, conta_id: contaId }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || `Falha ao importar (erro ${res.status}).`);
        return data as OFXImportResult;
      };

      // Conta as transações (mesmo padrão do parser do backend) p/ enviar em
      // lotes e mostrar progresso "X de N". Se não casar nada, manda inteiro.
      const blocos = text.match(/<STMTTRN>[\s\S]*?<\/STMTTRN>/g) || [];
      const total = blocos.length;
      const acc: OFXImportResult = { importadas: 0, duplicadas: 0, conciliadas: 0, ignoradas_saldo: 0, total: 0 };
      const somar = (d: OFXImportResult) => {
        acc.importadas += d.importadas || 0;
        acc.duplicadas += d.duplicadas || 0;
        acc.conciliadas = (acc.conciliadas || 0) + (d.conciliadas || 0);
        acc.ignoradas_saldo = (acc.ignoradas_saldo || 0) + (d.ignoradas_saldo || 0);
        acc.total = (acc.total || 0) + (d.total || 0);
      };

      if (total === 0) {
        somar(await enviarLote(text));
      } else {
        const LOTE = 25;
        setImportProgress({ done: 0, total });
        for (let i = 0; i < total; i += LOTE) {
          somar(await enviarLote(blocos.slice(i, i + LOTE).join('\n')));
          setImportProgress({ done: Math.min(i + LOTE, total), total });
        }
      }

      setImportResult(acc);
      await load();
    } catch (err: any) {
      setImportError(err?.message || 'Não foi possível ler ou enviar o arquivo OFX.');
    } finally {
      setImporting(false);
      setImportProgress(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  // Ao abrir o modal de conciliação manual, carrega categorias + candidatos.
  useEffect(() => {
    if (!conciliarFor) return;
    const isCredito = conciliarFor.tipo === 'credito';
    setModo('vincular');
    setNovaDesc(conciliarFor.descricao || '');
    setNovaCategoria('');
    setBuscaLanc('');
    setConcError(null);
    (async () => {
      const [catRes, lancRes] = await Promise.all([
        authFetch(`/api/fin/categorias?tipo=${isCredito ? 'receita' : 'despesa'}`),
        authFetch(isCredito ? '/api/fin/receitas' : '/api/fin/despesas'),
      ]);
      if (catRes.ok) setCategorias(await catRes.json());
      if (lancRes.ok) {
        const all = await lancRes.json();
        setLancamentos((all || []).filter((l: any) => l.status !== 'cancelado'));
      }
    })();
  }, [conciliarFor]);

  const valorLanc = (l: any) => Number(l.valor_liquido ?? l.valor_bruto ?? l.valor ?? 0);
  const descLanc = (l: any) => l.descricao || l.cliente_nome || '—';

  const vincularExistente = async (lancId: string) => {
    if (!conciliarFor) return;
    setSavingConc(true); setConcError(null);
    try {
      const body = conciliarFor.tipo === 'credito'
        ? { transacao_id: conciliarFor.id, receita_id: lancId }
        : { transacao_id: conciliarFor.id, despesa_id: lancId };
      const res = await authFetch('/api/fin/ofx/conciliar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) { setConciliarFor(null); await load(); }
      else setConcError(data?.error || 'Falha ao conciliar.');
    } catch { setConcError('Falha ao conciliar.'); }
    finally { setSavingConc(false); }
  };

  const criarLancamento = async () => {
    if (!conciliarFor) return;
    setSavingConc(true); setConcError(null);
    try {
      const res = await authFetch('/api/fin/ofx/criar-lancamento', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transacao_id: conciliarFor.id, descricao: novaDesc, categoria_id: novaCategoria || null }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) { setConciliarFor(null); await load(); }
      else setConcError(data?.error || 'Falha ao criar lançamento.');
    } catch { setConcError('Falha ao criar lançamento.'); }
    finally { setSavingConc(false); }
  };

  const ignorarTransacao = async (t: Transacao) => {
    const res = await authFetch('/api/fin/ofx/conciliar', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transacao_id: t.id, ignorar: true }),
    });
    if (res.ok) await load();
  };

  const desfazer = async (t: Transacao) => {
    const res = await authFetch('/api/fin/ofx/desconciliar', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transacao_id: t.id }),
    });
    if (res.ok) await load();
  };

  const filtradas = transacoes.filter(t => {
    if (filtro === 'pendentes') return !t.conciliado;
    if (filtro === 'conciliadas') return t.conciliado;
    return true;
  });

  const pendentes = transacoes.filter(t => !t.conciliado).length;
  const totalCredito = transacoes.filter(t => !t.conciliado && t.tipo === 'credito').reduce((a, t) => a + t.valor, 0);
  const totalDebito = transacoes.filter(t => !t.conciliado && t.tipo === 'debito').reduce((a, t) => a + t.valor, 0);

  return (
    <div className="space-y-4">
      {/* Popup de progresso da importação */}
      {importing && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40">
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 w-80 max-w-[90vw] shadow-xl text-center">
            <RefreshCw className="w-8 h-8 text-violet-600 animate-spin mx-auto mb-3" />
            <p className="font-semibold text-gray-900 dark:text-white mb-1">Importando extrato…</p>
            {importProgress && importProgress.total > 0 ? (
              <>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
                  {importProgress.done} de {importProgress.total} transações
                </p>
                <div className="w-full h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-violet-600 transition-all duration-200"
                    style={{ width: `${Math.round((importProgress.done / importProgress.total) * 100)}%` }}
                  />
                </div>
              </>
            ) : (
              <p className="text-sm text-gray-500 dark:text-gray-400">Processando arquivo…</p>
            )}
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Conciliação Bancária</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {pendentes} transaç{pendentes !== 1 ? 'ões' : 'ão'} pendente{pendentes !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex gap-2 items-center">
          {contas.length > 0 && (
            <select
              value={contaId}
              onChange={(e) => setContaId(e.target.value)}
              title="Conta de destino do extrato"
              className="text-sm px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200"
            >
              {contas.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          )}
          <input
            ref={fileRef}
            type="file"
            accept=".ofx,.OFX"
            onChange={importarOFX}
            className="hidden"
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={importing || !contaId}
            title={!contaId ? 'Crie uma conta em Configurações para importar' : undefined}
            className="flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50"
          >
            {importing ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <Upload className="w-4 h-4" />
            )}
            {importing ? 'Importando...' : 'Importar OFX'}
          </button>
        </div>
      </div>

      {/* Resultado import */}
      {importResult && (
        <div className="flex items-start gap-3 p-4 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800">
          <Check className="w-5 h-5 text-emerald-500 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-emerald-700 dark:text-emerald-300">
            <span className="font-semibold">OFX importado:</span>{' '}
            {importResult.importadas} nova{importResult.importadas !== 1 ? 's' : ''},{' '}
            {importResult.duplicadas} duplicada{importResult.duplicadas !== 1 ? 's' : ''} ignorada{importResult.duplicadas !== 1 ? 's' : ''}.
            {importResult.conciliadas ? ` ${importResult.conciliadas} conciliada${importResult.conciliadas !== 1 ? 's' : ''} automaticamente.` : ''}
            {importResult.ignoradas_saldo ? ` ${importResult.ignoradas_saldo} linha${importResult.ignoradas_saldo !== 1 ? 's' : ''} de saldo ignorada${importResult.ignoradas_saldo !== 1 ? 's' : ''}.` : ''}
            {importResult.erros > 0 && ` ${importResult.erros} erro(s).`}
          </div>
          <button onClick={() => setImportResult(null)} className="ml-auto text-emerald-500 hover:text-emerald-700">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Erro import */}
      {importError && (
        <div className="flex items-start gap-3 p-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-red-700 dark:text-red-300">{importError}</div>
          <button onClick={() => setImportError(null)} className="ml-auto text-red-500 hover:text-red-700">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* KPIs pendentes */}
      {pendentes > 0 && (
        <div>
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Pendentes</p>
              <p className="text-lg font-bold text-gray-800 dark:text-gray-100">{pendentes}</p>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Entradas a conciliar</p>
              <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400">{fmtBRL(totalCredito)}</p>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Saídas a conciliar</p>
              <p className="text-lg font-bold text-red-600 dark:text-red-400">{fmtBRL(totalDebito)}</p>
            </div>
          </div>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
            Soma de toda a movimentação ainda não conciliada (inclui transferências e aplicações). Não é o saldo da conta.
          </p>
        </div>
      )}

      {/* Filtros */}
      <div className="flex gap-1">
        {(['todas', 'pendentes', 'conciliadas'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFiltro(f)}
            className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition-colors capitalize ${
              filtro === f
                ? 'bg-violet-600 border-violet-600 text-white'
                : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
            }`}
          >
            {f === 'todas' ? 'Todas' : f === 'pendentes' ? 'Pendentes' : 'Conciliadas'}
          </button>
        ))}
      </div>

      {/* Instruções OFX */}
      {transacoes.length === 0 && !loading && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-dashed border-gray-300 dark:border-gray-600 p-8 text-center">
          <FileText className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Nenhum extrato importado
          </p>
          <p className="text-xs text-gray-400 dark:text-gray-500">
            Exporte o extrato do seu banco em formato OFX e importe aqui para conciliar as transações.
          </p>
          <button
            onClick={() => fileRef.current?.click()}
            className="mt-4 text-sm px-4 py-2 rounded-lg bg-violet-600 text-white hover:bg-violet-700"
          >
            Importar OFX
          </button>
        </div>
      )}

      {/* Lista */}
      {loading ? (
        <div className="flex items-center justify-center h-40">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-violet-600" />
        </div>
      ) : filtradas.length > 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400">
                <th className="text-left px-4 py-3 font-medium">Data</th>
                <th className="text-left px-4 py-3 font-medium">Descrição</th>
                <th className="text-right px-4 py-3 font-medium">Valor</th>
                <th className="text-center px-4 py-3 font-medium">Status</th>
                <th className="text-center px-4 py-3 font-medium">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtradas.map(t => (
                <tr key={t.id} className="border-b border-gray-50 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700/30 last:border-0">
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-300 whitespace-nowrap">
                    {fmtDate(t.data)}
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-800 dark:text-gray-200">{t.descricao}</p>
                    <p className="text-xs text-gray-400">{t.origem}</p>
                  </td>
                  <td className={`px-4 py-3 text-right font-semibold ${
                    t.tipo === 'credito'
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-red-600 dark:text-red-400'
                  }`}>
                    {t.tipo === 'credito' ? '+' : '-'}{fmtBRL(t.valor)}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {t.conciliado ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300">
                        <Check className="w-3 h-3" /> Conciliado
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">
                        <AlertCircle className="w-3 h-3" /> Pendente
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center whitespace-nowrap">
                    {!t.conciliado && (
                      <div className="flex items-center gap-1 justify-center">
                        <button
                          onClick={() => setConciliarFor(t)}
                          className="text-xs px-2 py-1 rounded-md bg-violet-600 text-white hover:bg-violet-700"
                        >Conciliar</button>
                        <button
                          onClick={() => ignorarTransacao(t)}
                          title="Ignorar esta transação"
                          className="text-xs px-2 py-1 rounded-md text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
                        >Ignorar</button>
                      </div>
                    )}
                    {t.conciliado && (
                      <button
                        onClick={() => desfazer(t)}
                        title="Desfazer a conciliação — volta a transação para pendente"
                        className="text-xs px-2 py-1 rounded-md text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
                      >Desfazer</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {/* Modal: conciliação manual (vincular a existente ou criar novo) */}
      {conciliarFor && (() => {
        const isCredito = conciliarFor.tipo === 'credito';
        const q = buscaLanc.trim().toLowerCase();
        const candidatos = lancamentos
          .filter(l => !q || descLanc(l).toLowerCase().includes(q))
          .sort((a, b) => Math.abs(valorLanc(a) - conciliarFor.valor) - Math.abs(valorLanc(b) - conciliarFor.valor))
          .slice(0, 50);
        return (
          <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 p-4" onClick={() => setConciliarFor(null)}>
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-lg max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
              <div className="flex items-start justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700">
                <div className="min-w-0">
                  <h3 className="font-semibold text-gray-900 dark:text-white">Conciliar transação</h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                    {fmtDate(conciliarFor.data)} · {conciliarFor.descricao} ·{' '}
                    <span className={isCredito ? 'text-emerald-600' : 'text-red-600'}>
                      {isCredito ? '+' : '-'}{fmtBRL(conciliarFor.valor)}
                    </span>
                  </p>
                </div>
                <button onClick={() => setConciliarFor(null)} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400"><X className="w-4 h-4" /></button>
              </div>

              <div className="flex gap-1 px-5 pt-3">
                <button onClick={() => setModo('vincular')} className={`text-xs px-3 py-1.5 rounded-lg border font-medium ${modo === 'vincular' ? 'bg-violet-600 border-violet-600 text-white' : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300'}`}>
                  <Link2 className="w-3 h-3 inline mr-1" />Vincular a existente
                </button>
                <button onClick={() => setModo('criar')} className={`text-xs px-3 py-1.5 rounded-lg border font-medium ${modo === 'criar' ? 'bg-violet-600 border-violet-600 text-white' : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300'}`}>
                  <Plus className="w-3 h-3 inline mr-1" />Criar {isCredito ? 'receita' : 'despesa'}
                </button>
              </div>

              {concError && (
                <p className="mx-5 mt-3 text-xs text-red-600 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">{concError}</p>
              )}

              <div className="px-5 py-4 overflow-y-auto">
                {modo === 'vincular' ? (
                  <>
                    <input
                      value={buscaLanc}
                      onChange={e => setBuscaLanc(e.target.value)}
                      placeholder={`Buscar ${isCredito ? 'receita' : 'despesa'}...`}
                      className="w-full mb-3 px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200"
                    />
                    {candidatos.length === 0 ? (
                      <p className="text-sm text-gray-400 text-center py-6">Nenhum lançamento encontrado.</p>
                    ) : (
                      <div className="space-y-1">
                        {candidatos.map(l => {
                          const exato = Math.abs(valorLanc(l) - conciliarFor.valor) < 0.005;
                          return (
                            <button
                              key={l.id}
                              disabled={savingConc}
                              onClick={() => vincularExistente(l.id)}
                              className={`w-full flex items-center justify-between gap-3 px-3 py-2 rounded-lg border text-left hover:bg-gray-50 dark:hover:bg-gray-700/40 disabled:opacity-50 ${exato ? 'border-emerald-300 dark:border-emerald-700' : 'border-gray-200 dark:border-gray-700'}`}
                            >
                              <span className="min-w-0">
                                <span className="block text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{descLanc(l)}</span>
                                <span className="block text-xs text-gray-400">{[l.data_vencimento ? fmtDate(l.data_vencimento) : null, l.status].filter(Boolean).join(' · ')}</span>
                              </span>
                              <span className="text-sm font-semibold whitespace-nowrap text-gray-700 dark:text-gray-200">
                                {fmtBRL(valorLanc(l))}{exato && <Check className="w-3 h-3 inline ml-1 text-emerald-500" />}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Descrição</label>
                      <input value={novaDesc} onChange={e => setNovaDesc(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Categoria</label>
                      <FinSelect value={novaCategoria} onChange={setNovaCategoria} options={categorias.map(c => ({ value: c.id, label: c.nome }))} placeholder="Selecione a categoria" />
                    </div>
                    <div className="flex gap-4 text-sm text-gray-500 dark:text-gray-400">
                      <div>Valor: <span className="font-semibold text-gray-800 dark:text-gray-200">{fmtBRL(conciliarFor.valor)}</span></div>
                      <div>Data: <span className="font-semibold text-gray-800 dark:text-gray-200">{fmtDate(conciliarFor.data)}</span></div>
                    </div>
                    <p className="text-xs text-gray-400">Cria {isCredito ? 'uma receita recebida' : 'uma despesa paga'} na conta do extrato e concilia automaticamente.</p>
                    <div className="flex justify-end">
                      <button onClick={criarLancamento} disabled={savingConc || !novaCategoria} className="px-4 py-2 text-sm font-semibold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50">
                        {savingConc ? 'Criando...' : 'Criar e conciliar'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

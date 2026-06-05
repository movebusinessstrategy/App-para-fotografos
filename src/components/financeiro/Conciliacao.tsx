import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  Upload, Link2, Check, X, AlertCircle, RefreshCw, FileText,
} from 'lucide-react';
import { authFetch } from '../../utils/authFetch';
import { fmtBRL, fmtDate } from './finUtils';

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
  total?: number;
  erros?: number;
}

export default function Conciliacao() {
  const [transacoes, setTransacoes] = useState<Transacao[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<OFXImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<'todas' | 'pendentes' | 'conciliadas'>('pendentes');
  const [contas, setContas] = useState<Conta[]>([]);
  const [contaId, setContaId] = useState<string>('');
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
    try {
      const text = await file.text();
      const res = await authFetch('/api/fin/ofx/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conteudo: text, conta_id: contaId }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setImportResult(data);
        await load();
      } else {
        setImportError(data?.error || `Falha ao importar (erro ${res.status}).`);
      }
    } catch {
      setImportError('Não foi possível ler ou enviar o arquivo OFX.');
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const conciliar = async (transacaoId: string, tipo: 'receita' | 'despesa', lancamentoId: string) => {
    const res = await authFetch('/api/fin/ofx/conciliar', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transacao_id: transacaoId, tipo, lancamento_id: lancamentoId }),
    });
    if (res.ok) {
      setTransacoes(prev => prev.map(t =>
        t.id === transacaoId ? { ...t, conciliado: true } : t
      ));
    }
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
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Créditos pendentes</p>
            <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400">{fmtBRL(totalCredito)}</p>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Débitos pendentes</p>
            <p className="text-lg font-bold text-red-600 dark:text-red-400">{fmtBRL(totalDebito)}</p>
          </div>
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

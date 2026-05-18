import React, { useState, useRef } from "react";
import { FileSignature, Download, AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { authFetch } from "../../utils/authFetch";

interface PageResult {
  page: number;
  processed: number;
  imported: number;
  skipped_duplicates: number;
  failed: number;
  errors: Array<{ doc_id: string; reason: string }>;
  total: number;
  last_page: number;
  has_more: boolean;
  next_page: number | null;
}

interface Totals {
  processed: number;
  imported: number;
  skipped_duplicates: number;
  failed: number;
  errors: Array<{ doc_id: string; reason: string }>;
  pagesDone: number;
  totalPages: number;
  totalDocs: number;
}

const EMPTY_TOTALS: Totals = {
  processed: 0, imported: 0, skipped_duplicates: 0, failed: 0,
  errors: [], pagesDone: 0, totalPages: 0, totalDocs: 0,
};

export default function IntegracaoAutentique() {
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [totals, setTotals] = useState<Totals>(EMPTY_TOTALS);
  const [currentPageLabel, setCurrentPageLabel] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef(false);

  async function runImport() {
    setRunning(true);
    setDone(false);
    setError(null);
    setTotals(EMPTY_TOTALS);
    cancelRef.current = false;

    let page = 1;
    let agg = { ...EMPTY_TOTALS };

    try {
      while (true) {
        if (cancelRef.current) break;
        setCurrentPageLabel(`Processando página ${page}...`);

        const r = await authFetch('/api/contracts/autentique-import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ page }),
        });
        if (!r.ok) {
          const data = await r.json().catch(() => ({}));
          throw new Error(data.error || `Erro HTTP ${r.status}`);
        }
        const result: PageResult = await r.json();

        agg = {
          processed: agg.processed + result.processed,
          imported: agg.imported + result.imported,
          skipped_duplicates: agg.skipped_duplicates + result.skipped_duplicates,
          failed: agg.failed + result.failed,
          errors: [...agg.errors, ...result.errors].slice(0, 100),
          pagesDone: page,
          totalPages: result.last_page,
          totalDocs: result.total,
        };
        setTotals({ ...agg });

        if (!result.has_more) break;
        page = result.next_page || page + 1;
        // Pequena pausa entre páginas pra UI respirar
        await new Promise(r => setTimeout(r, 200));
      }

      setDone(true);
      setCurrentPageLabel('');
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-5 max-w-3xl">
      {/* Header */}
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-5">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-gold-50 dark:bg-gold-900/30 flex items-center justify-center flex-shrink-0">
            <FileSignature className="w-5 h-5 text-gold-600 dark:text-gold-400" />
          </div>
          <div className="flex-1">
            <h2 className="text-base font-bold text-gray-900 dark:text-white">Importar histórico do Autentique</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Puxa todos os contratos da sua conta Autentique e cria clientes + histórico de
              sessões aqui no app. Detecta duplicatas (mesmo cliente + mesma data) e não puxa
              pra produção.
            </p>
          </div>
        </div>
      </div>

      {/* Como funciona */}
      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-4">
        <p className="text-xs font-semibold text-blue-900 dark:text-blue-300 uppercase tracking-wider mb-2">Como funciona</p>
        <ul className="text-sm text-blue-800 dark:text-blue-200 space-y-1.5 list-disc list-inside">
          <li>Lista todos os contratos da sua conta Autentique (paginado, 60 por vez)</li>
          <li>Baixa cada PDF assinado e extrai: <strong>nome, e-mail, CPF, telefone, endereço, tipo de ensaio, valor, data</strong></li>
          <li>Match de cliente por <strong>e-mail OU CPF</strong>. Se não bater, cria cliente novo</li>
          <li><strong>Dedup</strong>: pula se já tem ensaio do mesmo cliente naquela data</li>
          <li>Jobs criados ficam <strong>fora da produção</strong> e marcados como pagos/concluídos (histórico)</li>
        </ul>
      </div>

      {/* Pré-requisitos / aviso */}
      <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-4 flex items-start gap-3">
        <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
        <div className="text-sm text-amber-900 dark:text-amber-200">
          <strong>Antes de começar:</strong> tenha a <em>API key do Autentique</em> configurada em
          Integrações. Esse processo pode levar vários minutos pra contas com 500+ contratos
          (cada PDF é baixado e processado). Pode rodar quantas vezes quiser — duplicatas são
          ignoradas.
        </div>
      </div>

      {/* Botão de ação */}
      <div className="flex items-center gap-3">
        <button
          onClick={runImport}
          disabled={running}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-gold-600 hover:bg-gold-700 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold rounded-xl shadow-sm transition-colors"
        >
          {running ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
          {running ? 'Importando…' : done ? 'Rodar de novo' : 'Iniciar importação'}
        </button>
        {running && (
          <button
            onClick={() => { cancelRef.current = true; }}
            className="px-4 py-2.5 text-sm font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-xl transition-colors"
          >
            Parar
          </button>
        )}
      </div>

      {/* Progresso */}
      {(running || done || totals.processed > 0) && (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-5 space-y-4">
          {running && currentPageLabel && (
            <p className="text-sm text-gray-600 dark:text-gray-300 flex items-center gap-2">
              <Loader2 size={14} className="animate-spin text-gold-500" />
              {currentPageLabel}
            </p>
          )}

          {totals.totalPages > 0 && (
            <div>
              <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mb-1.5">
                <span>{totals.pagesDone} de {totals.totalPages} páginas</span>
                <span>{totals.processed} de {totals.totalDocs} contratos</span>
              </div>
              <div className="h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gold-500 transition-all"
                  style={{ width: `${totals.totalPages > 0 ? (totals.pagesDone / totals.totalPages) * 100 : 0}%` }}
                />
              </div>
            </div>
          )}

          <div className="grid grid-cols-3 gap-3">
            <Stat label="Importados" value={totals.imported} color="text-emerald-600 dark:text-emerald-400" />
            <Stat label="Duplicatas puladas" value={totals.skipped_duplicates} color="text-gray-500" />
            <Stat label="Falhas" value={totals.failed} color={totals.failed > 0 ? "text-red-500" : "text-gray-500"} />
          </div>

          {done && !error && (
            <div className="flex items-start gap-2 p-3 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg">
              <CheckCircle2 size={16} className="text-emerald-600 dark:text-emerald-400 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-emerald-900 dark:text-emerald-200">
                Importação concluída! <strong>{totals.imported}</strong> contratos viraram histórico
                de cliente + sessão.
              </p>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
              <AlertCircle size={16} className="text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-900 dark:text-red-200">{error}</p>
            </div>
          )}

          {totals.errors.length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
                Ver erros ({totals.errors.length})
              </summary>
              <div className="mt-2 max-h-60 overflow-y-auto space-y-1 text-xs font-mono bg-gray-50 dark:bg-gray-800 p-3 rounded-lg">
                {totals.errors.map((e, i) => (
                  <div key={i} className="text-gray-600 dark:text-gray-400">
                    <span className="text-gray-400">{e.doc_id}:</span> {e.reason}
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3">
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{label}</p>
    </div>
  );
}

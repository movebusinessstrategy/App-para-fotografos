import React, { useEffect, useMemo, useState, useRef } from "react";
import { FileSignature, Download, AlertCircle, CheckCircle2, Loader2, Eye, ChevronLeft, ChevronRight } from "lucide-react";
import { authFetch } from "../../utils/authFetch";

interface PreviewItem {
  doc_id: string;
  doc_name: string;
  client_name: string | null;
  client_email: string | null;
  job_type: string | null;
  job_date: string;
  existing_client_id: number | null;
  existing_client_name: string | null;
  will_duplicate: boolean;
  has_name: boolean;
}

interface PreviewPage {
  page: number;
  items: PreviewItem[];
  total: number;
  last_page: number;
  has_more: boolean;
  next_page: number | null;
}

interface ImportResult {
  page: number;
  processed: number;
  imported: number;
  skipped_duplicates: number;
  failed: number;
  errors: Array<{ doc_id: string; reason: string }>;
  has_more?: boolean;
  next_page?: number;
}

const formatDate = (iso: string) => {
  if (!iso) return '-';
  try { return new Date(iso + 'T00:00:00').toLocaleDateString('pt-BR'); } catch { return iso; }
};

export default function IntegracaoAutentique() {
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<PreviewPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [results, setResults] = useState<ImportResult[]>([]);

  async function loadPage(p: number) {
    setLoading(true);
    setError(null);
    setChecked(new Set());
    try {
      const r = await authFetch(`/api/contracts/autentique-list?page=${p}`);
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${r.status}`);
      }
      const data: PreviewPage = await r.json();
      setPreview(data);
      setPage(data.page);
      // Pré-marca os que NÃO vão duplicar e têm nome
      const auto = new Set<string>();
      data.items.forEach(it => { if (it.has_name && !it.will_duplicate) auto.add(it.doc_id); });
      setChecked(auto);
    } catch (err: any) {
      setError(err.message);
      setPreview(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadPage(1); }, []);

  const stats = useMemo(() => {
    if (!preview) return { dup: 0, novo: 0, semNome: 0 };
    return {
      dup: preview.items.filter(i => i.will_duplicate).length,
      novo: preview.items.filter(i => i.has_name && !i.will_duplicate).length,
      semNome: preview.items.filter(i => !i.has_name).length,
    };
  }, [preview]);

  function toggle(id: string) {
    setChecked(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (!preview) return;
    const eligible = preview.items.filter(i => i.has_name && !i.will_duplicate).map(i => i.doc_id);
    if (eligible.every(id => checked.has(id))) {
      setChecked(new Set());
    } else {
      setChecked(new Set(eligible));
    }
  }

  async function importSelected() {
    if (!preview || checked.size === 0) return;
    setImporting(true);
    setError(null);
    try {
      const r = await authFetch('/api/contracts/autentique-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ page, doc_ids: Array.from(checked) }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error || `HTTP ${r.status}`);
      }
      const result: ImportResult = await r.json();
      setResults(prev => [...prev, result]);
      // Recarrega a mesma página pra mostrar tudo como "duplicata" agora
      await loadPage(page);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setImporting(false);
    }
  }

  async function importAllPages() {
    if (!preview) return;
    setImporting(true);
    setError(null);
    let curr = 1;
    try {
      const total = preview.last_page;
      while (true) {
        const r = await authFetch('/api/contracts/autentique-import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ page: curr }),
        });
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          throw new Error(d.error || `HTTP ${r.status}`);
        }
        const result: ImportResult = await r.json();
        setResults(prev => [...prev, result]);
        if (!result.has_more) break;
        curr = result.next_page || curr + 1;
        await new Promise(r => setTimeout(r, 200));
      }
      await loadPage(1);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setImporting(false);
    }
  }

  const totalImported = results.reduce((a, r) => a + r.imported, 0);
  const totalSkipped = results.reduce((a, r) => a + r.skipped_duplicates, 0);
  const totalFailed = results.reduce((a, r) => a + r.failed, 0);

  return (
    <div className="space-y-5 max-w-5xl">
      {/* Header */}
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-5">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-gold-50 dark:bg-gold-900/30 flex items-center justify-center flex-shrink-0">
            <FileSignature className="w-5 h-5 text-gold-600 dark:text-gold-400" />
          </div>
          <div className="flex-1">
            <h2 className="text-base font-bold text-gray-900 dark:text-white">Importar do Autentique</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Lista os contratos da sua conta Autentique e importa como histórico de cliente +
              sessão. <strong>Não baixa PDFs</strong> - usa só metadados (instantâneo).
            </p>
          </div>
        </div>
      </div>

      {/* Status atual */}
      {preview && (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex gap-3 flex-wrap text-sm">
              <span className="px-3 py-1.5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-semibold">
                Página {preview.page} de {preview.last_page}
              </span>
              <span className="px-3 py-1.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 font-semibold">
                Total Autentique: <strong>{preview.total}</strong>
              </span>
              <span className="px-3 py-1.5 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 font-semibold">
                Novos: <strong>{stats.novo}</strong>
              </span>
              <span className="px-3 py-1.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500 font-semibold">
                Duplicatas: <strong>{stats.dup}</strong>
              </span>
              {stats.semNome > 0 && (
                <span className="px-3 py-1.5 rounded-full bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 font-semibold">
                  Sem nome: <strong>{stats.semNome}</strong>
                </span>
              )}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => loadPage(page - 1)} disabled={page <= 1 || loading || importing}
                className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 disabled:opacity-40 hover:border-gold-400"
              >
                <ChevronLeft size={14} className="inline" />
              </button>
              <button
                onClick={() => loadPage(page + 1)} disabled={page >= preview.last_page || loading || importing}
                className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 disabled:opacity-40 hover:border-gold-400"
              >
                <ChevronRight size={14} className="inline" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Erros */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-3 flex items-start gap-2">
          <AlertCircle size={16} className="text-red-500 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-900 dark:text-red-200">{error}</p>
        </div>
      )}

      {/* Resultado agregado */}
      {results.length > 0 && (
        <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle2 size={16} className="text-emerald-600 dark:text-emerald-400" />
            <strong className="text-emerald-900 dark:text-emerald-200">Importação acumulada</strong>
          </div>
          <div className="flex gap-3 flex-wrap text-sm text-emerald-900 dark:text-emerald-200">
            <span><strong>{totalImported}</strong> importados</span>
            <span><strong>{totalSkipped}</strong> duplicatas puladas</span>
            {totalFailed > 0 && <span className="text-red-700 dark:text-red-300"><strong>{totalFailed}</strong> falhas</span>}
          </div>
        </div>
      )}

      {/* Tabela */}
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
        {loading ? (
          <div className="py-16 text-center text-gray-400">
            <Loader2 size={20} className="inline animate-spin text-gold-500 mr-2" />
            Carregando contratos...
          </div>
        ) : !preview ? (
          <div className="py-16 text-center text-gray-400 text-sm">Sem dados</div>
        ) : preview.items.length === 0 ? (
          <div className="py-16 text-center text-gray-400 text-sm">Nenhum contrato nessa página</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-800">
                <tr className="text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  <th className="px-3 py-2.5 w-10">
                    <input
                      type="checkbox"
                      checked={stats.novo > 0 && preview.items.filter(i => i.has_name && !i.will_duplicate).every(i => checked.has(i.doc_id))}
                      onChange={toggleAll}
                      className="accent-gold-600"
                    />
                  </th>
                  <th className="px-3 py-2.5">Contrato (Autentique)</th>
                  <th className="px-3 py-2.5">Cliente detectado</th>
                  <th className="px-3 py-2.5">E-mail</th>
                  <th className="px-3 py-2.5">Tipo</th>
                  <th className="px-3 py-2.5">Data</th>
                  <th className="px-3 py-2.5">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {preview.items.map(it => {
                  const canCheck = it.has_name && !it.will_duplicate;
                  return (
                    <tr key={it.doc_id} className={!canCheck ? 'opacity-60' : ''}>
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={checked.has(it.doc_id)}
                          onChange={() => toggle(it.doc_id)}
                          disabled={!canCheck}
                          className="accent-gold-600"
                        />
                      </td>
                      <td className="px-3 py-2 text-gray-700 dark:text-gray-300 text-xs max-w-[220px] truncate" title={it.doc_name}>
                        {it.doc_name || '-'}
                      </td>
                      <td className="px-3 py-2 text-gray-900 dark:text-white font-medium">
                        {it.client_name || <span className="text-red-500 italic">sem nome</span>}
                        {it.existing_client_name && it.existing_client_name !== it.client_name && (
                          <div className="text-[10px] text-emerald-600 dark:text-emerald-400 mt-0.5">
                            ↳ já existe como "{it.existing_client_name}"
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-gray-500 dark:text-gray-400 text-xs">
                        {it.client_email || '-'}
                      </td>
                      <td className="px-3 py-2 text-gray-500 dark:text-gray-400 text-xs">
                        {it.job_type || <span className="opacity-50">Outro</span>}
                      </td>
                      <td className="px-3 py-2 text-gray-500 dark:text-gray-400 text-xs whitespace-nowrap">
                        {formatDate(it.job_date)}
                      </td>
                      <td className="px-3 py-2">
                        {!it.has_name ? (
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900/30 text-red-600">
                            sem nome
                          </span>
                        ) : it.will_duplicate ? (
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-500">
                            duplicata
                          </span>
                        ) : it.existing_client_id ? (
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">
                            vincula
                          </span>
                        ) : (
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300">
                            novo
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Botões de ação */}
      {preview && preview.items.length > 0 && (
        <div className="flex justify-between items-center gap-3 flex-wrap">
          <p className="text-sm text-gray-500">
            <strong>{checked.size}</strong> selecionado(s) nessa página
          </p>
          <div className="flex gap-2">
            <button
              onClick={importSelected}
              disabled={checked.size === 0 || importing}
              className="inline-flex items-center gap-2 px-4 py-2 bg-gold-600 hover:bg-gold-700 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold rounded-xl text-sm transition-colors"
            >
              {importing ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              Importar selecionados ({checked.size})
            </button>
            <button
              onClick={importAllPages}
              disabled={importing}
              className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold rounded-xl text-sm transition-colors"
            >
              {importing ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />}
              Importar TODAS as páginas ({preview.total})
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

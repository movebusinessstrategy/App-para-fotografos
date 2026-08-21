import React, { useEffect, useState, useCallback } from 'react';
import {
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, Bar, Legend,
} from 'recharts';
import {
  TrendingUp, TrendingDown, Wallet, AlertCircle,
  RefreshCw, ArrowUpCircle, ArrowDownCircle, X,
} from 'lucide-react';
import { authFetch } from '../../utils/authFetch';
import { fmtBRL, fmtDate } from './finUtils';

interface DashboardData {
  saldo_fonte?: string;
  kpis: {
    receita_mes: number;
    despesa_mes: number;
    lucro_mes: number;
    saldo_contas: number;
    receitas_pendentes: number;
    despesas_pendentes: number;
    receitas_atrasadas: number;
    despesas_atrasadas: number;
    saldo_fonte?: string;
  };
  saldos_contas?: Array<{
    conta_id: string;
    nome: string;
    saldo_extrato_em?: string | null;
    saldo_fonte?: string;
  }>;
  fluxo_12m: Array<{
    mes: string;
    receitas: number;
    despesas: number;
    lucro: number;
  }>;
  proximos_recebimentos: Array<{
    id: string;
    descricao: string;
    valor: number;
    data_vencimento: string;
    status: string;
  }>;
  proximas_despesas: Array<{
    id: string;
    descricao: string;
    valor: number;
    data_vencimento: string;
    status: string;
  }>;
}

interface SyncJobPreview {
  job_id?: string;
  criadas?: number;
  atualizadas?: number;
  arquivadas?: number;
  conflitos?: number;
  overpaid_amount?: number;
  warnings?: string[];
}

interface SyncPreview {
  token: string;
  version: string | number;
  summary: Record<string, unknown>;
  jobs: SyncJobPreview[];
}

const numberField = (record: Record<string, unknown>, ...keys: string[]) => {
  for (const key of keys) {
    const value = Number(record[key]);
    if (Number.isFinite(value)) return value;
  }
  return 0;
};

const normalizeSyncPreview = (body: any): SyncPreview | null => {
  const token = String(body?.preview_token || body?.token || '').trim();
  const version = body?.preview_versao ?? body?.preview_version ?? body?.version;
  if (!token || version === undefined || version === null) return null;
  const summary = body?.resumo || body?.summary || body || {};
  const jobs = Array.isArray(body?.jobs) ? body.jobs : Array.isArray(body?.items) ? body.items : [];
  return { token, version, summary, jobs };
};

const syncResultMessage = (payload: any) => {
  const summary = (payload?.resumo || payload?.summary || payload || {}) as Record<string, unknown>;
  const messages: string[] = [];
  const created = numberField(summary, 'criadas', 'created');
  const updated = numberField(summary, 'atualizadas', 'updated');
  const archived = numberField(summary, 'arquivadas', 'archived');
  const reopened = numberField(summary, 'reabertas', 'reopened');
  if (created > 0) messages.push(`${created} receita(s) criada(s)`);
  if (updated > 0) messages.push(`${updated} receita(s) atualizada(s)`);
  if (archived > 0) messages.push(`${archived} projeção(ões) antiga(s) arquivada(s)`);
  if (reopened > 0) messages.push(`${reopened} conciliação(ões) devolvida(s) para revisão`);
  const warnings = Array.isArray(payload?.warnings) ? payload.warnings : [];
  if (warnings.length > 0) messages.push(warnings.join(' · '));
  return messages.length > 0 ? messages.join(' · ') : 'Tudo já estava sincronizado';
};

const KpiCard = ({
  label, value, sub, icon: Icon, color, trend,
}: {
  label: string; value: string; sub?: string;
  icon: React.ElementType; color: string; trend?: 'up' | 'down' | 'neutral';
}) => (
  <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 flex flex-col gap-2">
    <div className="flex items-center justify-between">
      <span className="text-xs font-medium text-gray-500 dark:text-gray-400">{label}</span>
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${color}`}>
        <Icon className="w-4 h-4" />
      </div>
    </div>
    <div className="text-xl font-bold text-gray-900 dark:text-white">{value}</div>
    {sub && <div className="text-xs text-gray-500 dark:text-gray-400">{sub}</div>}
  </div>
);

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3 shadow-lg text-sm">
      <p className="font-semibold text-gray-700 dark:text-gray-300 mb-1">{label}</p>
      {payload.map((p: any) => (
        <p key={p.name} style={{ color: p.color }}>
          {p.name}: {fmtBRL(p.value)}
        </p>
      ))}
    </div>
  );
};

export default function VisaoGeral() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState('');
  const [syncFailed, setSyncFailed] = useState(false);
  const [syncPreview, setSyncPreview] = useState<SyncPreview | null>(null);
  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setLoadError('');
    try {
      const res = await authFetch('/api/fin/dashboard');
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(body?.message || body?.error || 'Não foi possível carregar o resumo financeiro.');
      }
      if (
        !body?.kpis
        || !Array.isArray(body.fluxo_12m)
        || !Array.isArray(body.proximos_recebimentos)
        || !Array.isArray(body.proximas_despesas)
      ) {
        throw new Error('O resumo financeiro retornou dados em um formato inesperado.');
      }
      setData(body as DashboardData);
      return true;
    } catch (error) {
      setData(null);
      setLoadError(error instanceof Error && error.message
        ? error.message
        : 'Não foi possível carregar o resumo financeiro.');
      return false;
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  const previewSyncJobs = async () => {
    setSyncing(true);
    setSyncFailed(false);
    setSyncMsg('');
    try {
      const res = await authFetch('/api/fin/sync-jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dry_run: true }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || body.error || 'Não foi possível preparar a atualização.');
      const preview = normalizeSyncPreview(body);
      if (!preview) throw new Error('A prévia não retornou uma confirmação válida. Nenhuma alteração foi feita.');
      setSyncPreview(preview);
    } catch (error) {
      setSyncFailed(true);
      setSyncMsg(error instanceof Error ? error.message : 'Não foi possível preparar a atualização.');
    } finally {
      setSyncing(false);
    }
  };

  const confirmSyncJobs = async () => {
    if (!syncPreview) return;
    setSyncing(true);
    setSyncFailed(false);
    setSyncMsg('');
    try {
      const res = await authFetch('/api/fin/sync-jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          confirmar: true,
          preview_token: syncPreview.token,
          preview_versao: syncPreview.version,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 409 || body?.error === 'SYNC_PREVIEW_STALE') {
          setSyncPreview(null);
          throw new Error('A prévia ficou desatualizada. Gere uma nova análise antes de confirmar.');
        }
        throw new Error(body.message || body.error || 'Não foi possível confirmar a atualização.');
      }
      setSyncPreview(null);
      const refreshed = await load();
      if (!refreshed) {
        setSyncFailed(true);
        setSyncMsg('A atualização foi executada, mas o resumo não pôde ser recarregado.');
        return;
      }
      setSyncMsg(syncResultMessage(body));
      setTimeout(() => setSyncMsg(''), 4000);
    } catch (error) {
      setSyncFailed(true);
      setSyncMsg(error instanceof Error ? error.message : 'Não foi possível confirmar a atualização.');
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-violet-600" />
      </div>
    );
  }

  if (loadError || !data) {
    return (
      <div className="space-y-5">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Visão Geral</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">Resumo financeiro do mês atual</p>
        </div>
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-center dark:border-rose-800 dark:bg-rose-900/20">
          <AlertCircle className="mx-auto mb-2 h-7 w-7 text-rose-500" />
          <p className="text-sm font-semibold text-rose-800 dark:text-rose-200">Os valores não puderam ser carregados</p>
          <p className="mt-1 text-xs text-rose-700 dark:text-rose-300">{loadError || 'O servidor não retornou o resumo financeiro.'}</p>
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

  const k = data.kpis;
  const saldoFonte = data.saldo_fonte || k.saldo_fonte;
  const saldoVemDoExtrato = saldoFonte === 'extrato' || saldoFonte === 'bancario';
  const saldoMisto = saldoFonte === 'misto';
  const saldoLabel = saldoVemDoExtrato ? 'Saldo bancário' : saldoMisto ? 'Saldo em contas' : 'Saldo projetado';
  const datasExtrato = (data.saldos_contas || [])
    .filter(conta => conta.saldo_fonte === 'extrato' && conta.saldo_extrato_em)
    .map(conta => conta.saldo_extrato_em as string)
    .sort();
  const referenciaMaisAntiga = datasExtrato[0] ? fmtDate(datasExtrato[0]) : null;
  let saldoSub = 'calculado pelos lançamentos financeiros';
  if (saldoMisto) saldoSub = referenciaMaisAntiga
    ? `parte por extrato; referência mais antiga em ${referenciaMaisAntiga}`
    : 'parte confirmada por extrato; parte projetada';
  if (saldoVemDoExtrato) saldoSub = referenciaMaisAntiga
    ? `extratos com referência mais antiga em ${referenciaMaisAntiga}`
    : 'confirmado pelos extratos importados';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Visão Geral</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">Resumo financeiro do mês atual</p>
        </div>
        <div className="flex items-center gap-3">
          {syncMsg && (
            <span className={`text-xs font-medium ${syncFailed ? 'text-rose-600 dark:text-rose-400' : 'text-green-600 dark:text-green-400'}`}>
              {syncMsg}
            </span>
          )}
          <button
            onClick={previewSyncJobs}
            disabled={syncing}
            className="flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
            Prévia da atualização
          </button>
        </div>
      </div>

      {/* KPI Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard
          label="Receita do Mês"
          value={fmtBRL(k?.receita_mes ?? 0)}
          icon={TrendingUp}
          color="bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400"
        />
        <KpiCard
          label="Despesas do Mês"
          value={fmtBRL(k?.despesa_mes ?? 0)}
          icon={TrendingDown}
          color="bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400"
        />
        <KpiCard
          label="Lucro do Mês"
          value={fmtBRL(k?.lucro_mes ?? 0)}
          icon={Wallet}
          color={(k?.lucro_mes ?? 0) >= 0
            ? 'bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400'
            : 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400'}
        />
        <KpiCard
          label={saldoLabel}
          value={fmtBRL(k?.saldo_contas ?? 0)}
          sub={saldoSub}
          icon={Wallet}
          color="bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"
        />
      </div>

      {/* Alertas */}
      {((k?.receitas_atrasadas ?? 0) > 0 || (k?.despesas_atrasadas ?? 0) > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {(k?.receitas_atrasadas ?? 0) > 0 && (
            <div className="flex items-center gap-3 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
              <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
              <div className="text-sm">
                <span className="font-semibold text-red-700 dark:text-red-300">
                  {fmtBRL(k?.receitas_atrasadas ?? 0)}
                </span>
                <span className="text-red-600 dark:text-red-400"> em recebimentos atrasados</span>
              </div>
            </div>
          )}
          {(k?.despesas_atrasadas ?? 0) > 0 && (
            <div className="flex items-center gap-3 p-3 rounded-lg bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800">
              <AlertCircle className="w-5 h-5 text-orange-500 flex-shrink-0" />
              <div className="text-sm">
                <span className="font-semibold text-orange-700 dark:text-orange-300">
                  {fmtBRL(k?.despesas_atrasadas ?? 0)}
                </span>
                <span className="text-orange-600 dark:text-orange-400"> em despesas atrasadas</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Fluxo de Caixa 12 meses */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">
          Fluxo de Caixa - últimos 12 meses
        </h3>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={data?.fluxo_12m ?? []} margin={{ top: 0, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-gray-100 dark:stroke-gray-700" />
            <XAxis dataKey="mes" tick={{ fontSize: 11 }} className="text-gray-500 dark:text-gray-400" />
            <YAxis
              tickFormatter={v => `R$${(v / 1000).toFixed(0)}k`}
              tick={{ fontSize: 11 }}
              className="text-gray-500 dark:text-gray-400"
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend formatter={v => v.charAt(0).toUpperCase() + v.slice(1)} />
            <Bar dataKey="receitas" name="Receitas" fill="#10b981" radius={[4, 4, 0, 0]} />
            <Bar dataKey="despesas" name="Despesas" fill="#f43f5e" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Próximos lançamentos */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Recebimentos */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <div className="flex items-center gap-2 mb-3">
            <ArrowUpCircle className="w-4 h-4 text-emerald-500" />
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
              Próximos Recebimentos
            </h3>
          </div>
          {data?.proximos_recebimentos?.length ? (
            <div className="space-y-2">
              {data.proximos_recebimentos.slice(0, 5).map(r => (
                <div key={r.id} className="flex items-center justify-between py-1.5 border-b border-gray-100 dark:border-gray-700 last:border-0">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{r.descricao}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{fmtDate(r.data_vencimento)}</p>
                  </div>
                  <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400 ml-2 flex-shrink-0">
                    {fmtBRL(r.valor)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-400 dark:text-gray-500 py-4 text-center">
              Nenhum recebimento próximo
            </p>
          )}
          {(k?.receitas_pendentes ?? 0) > 0 && (
            <div className="mt-3 pt-2 border-t border-gray-100 dark:border-gray-700 flex justify-between text-xs text-gray-500 dark:text-gray-400">
              <span>Total pendente</span>
              <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                {fmtBRL(k?.receitas_pendentes ?? 0)}
              </span>
            </div>
          )}
        </div>

        {/* Despesas */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <div className="flex items-center gap-2 mb-3">
            <ArrowDownCircle className="w-4 h-4 text-red-500" />
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
              Próximas Despesas
            </h3>
          </div>
          {data?.proximas_despesas?.length ? (
            <div className="space-y-2">
              {data.proximas_despesas.slice(0, 5).map(d => (
                <div key={d.id} className="flex items-center justify-between py-1.5 border-b border-gray-100 dark:border-gray-700 last:border-0">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{d.descricao}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{fmtDate(d.data_vencimento)}</p>
                  </div>
                  <span className="text-sm font-semibold text-red-600 dark:text-red-400 ml-2 flex-shrink-0">
                    {fmtBRL(d.valor)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-400 dark:text-gray-500 py-4 text-center">
              Nenhuma despesa próxima
            </p>
          )}
          {(k?.despesas_pendentes ?? 0) > 0 && (
            <div className="mt-3 pt-2 border-t border-gray-100 dark:border-gray-700 flex justify-between text-xs text-gray-500 dark:text-gray-400">
              <span>Total pendente</span>
              <span className="font-semibold text-red-600 dark:text-red-400">
                {fmtBRL(k?.despesas_pendentes ?? 0)}
              </span>
            </div>
          )}
        </div>
      </div>

      {syncPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !syncing && setSyncPreview(null)}>
          <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-xl dark:bg-gray-800" onClick={event => event.stopPropagation()}>
            <div className="flex items-start justify-between border-b border-gray-100 px-5 py-4 dark:border-gray-700">
              <div>
                <h3 className="font-semibold text-gray-900 dark:text-white">Confirmar atualização dos recebimentos</h3>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Esta é apenas a prévia. Nada foi alterado até você confirmar.</p>
              </div>
              <button
                onClick={() => setSyncPreview(null)}
                disabled={syncing}
                className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 disabled:opacity-50 dark:hover:bg-gray-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="max-h-[65vh] space-y-4 overflow-y-auto px-5 py-4">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {[
                  ['Trabalhos analisados', numberField(syncPreview.summary, 'jobs_analisados', 'jobsAnalyzed')],
                  ['Receitas a criar', numberField(syncPreview.summary, 'criadas', 'created')],
                  ['Receitas a atualizar', numberField(syncPreview.summary, 'atualizadas', 'updated')],
                  ['Projeções a arquivar', numberField(syncPreview.summary, 'arquivadas', 'archived')],
                  ['Conflitos', numberField(syncPreview.summary, 'conflitos', 'conflicts')],
                  ['Pagamentos excedentes', numberField(syncPreview.summary, 'overpaid', 'overpaid_count')],
                ].map(([label, value]) => (
                  <div key={String(label)} className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-gray-900/40">
                    <p className="text-[11px] text-gray-500 dark:text-gray-400">{label}</p>
                    <p className="mt-0.5 text-lg font-semibold text-gray-900 dark:text-white">{value}</p>
                  </div>
                ))}
              </div>

              {syncPreview.jobs.some(job => (job.conflitos || 0) > 0 || (job.overpaid_amount || 0) > 0 || (job.warnings?.length || 0) > 0) && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-800 dark:bg-amber-900/20">
                  <p className="text-xs font-semibold text-amber-800 dark:text-amber-200">Itens que merecem revisão</p>
                  <div className="mt-2 max-h-44 space-y-2 overflow-y-auto">
                    {syncPreview.jobs
                      .filter(job => (job.conflitos || 0) > 0 || (job.overpaid_amount || 0) > 0 || (job.warnings?.length || 0) > 0)
                      .map((job, index) => (
                        <div key={job.job_id || index} className="text-xs leading-relaxed text-amber-700 dark:text-amber-300">
                          <span className="font-medium">Trabalho {job.job_id || index + 1}:</span>{' '}
                          {(job.conflitos || 0) > 0 ? `${job.conflitos} conflito(s). ` : ''}
                          {(job.overpaid_amount || 0) > 0 ? `Excedente ${fmtBRL(job.overpaid_amount || 0)}. ` : ''}
                          {job.warnings?.join(' · ')}
                        </div>
                      ))}
                  </div>
                </div>
              )}

              <p className="text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                Confirme somente se estas contagens fizerem sentido. Se os dados mudarem antes da execução, o sistema recusará esta prévia e pedirá uma nova análise.
              </p>
            </div>
            <div className="flex justify-end gap-2 border-t border-gray-100 px-5 py-4 dark:border-gray-700">
              <button
                onClick={() => setSyncPreview(null)}
                disabled={syncing}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-700"
              >
                Cancelar
              </button>
              <button
                onClick={confirmSyncJobs}
                disabled={syncing}
                className="flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
              >
                <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
                Confirmar atualização
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

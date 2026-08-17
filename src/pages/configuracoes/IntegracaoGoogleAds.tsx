import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertCircle,
  ArrowUpRight,
  BarChart3,
  CheckCircle2,
  ChevronLeft,
  Clock3,
  RefreshCw,
  ShieldCheck,
  Unplug,
  Wrench,
} from "lucide-react";

import { useAuth } from "../../contexts/AuthContext";
import {
  fetchGoogleAdsApi,
  formatGoogleAdsDate,
  GoogleAdsState,
  GoogleAdsStatus,
} from "../../features/google-ads/api";
import { cn } from "../../utils/cn";

const STATE_COPY: Record<GoogleAdsState, {
  label: string;
  title: string;
  description: string;
  tone: "success" | "warning" | "neutral";
}> = {
  config_missing: {
    label: "Em preparação",
    title: "A integração ainda está sendo preparada",
    description: "A equipe do CRM precisa concluir a configuração segura antes de vincular uma conta de anúncios.",
    tone: "neutral",
  },
  unlinked: {
    label: "Aguardando vínculo",
    title: "Nenhuma conta de anúncios foi vinculada",
    description: "Peça à equipe do CRM para associar a conta autorizada do seu estúdio. Nenhuma outra conta ficará visível aqui.",
    tone: "neutral",
  },
  healthy: {
    label: "Atualizado",
    title: "Dados do Google Ads disponíveis",
    description: "O dashboard está usando os dados importados da conta de anúncios vinculada ao seu estúdio.",
    tone: "success",
  },
  sync_error: {
    label: "Falha na atualização",
    title: "A última atualização não foi concluída",
    description: "Os dados anteriores continuam preservados. Tente atualizar novamente ou fale com o suporte se o problema persistir.",
    tone: "warning",
  },
  stale: {
    label: "Dados desatualizados",
    title: "Está na hora de atualizar os anúncios",
    description: "A conta segue vinculada, mas os números exibidos podem não refletir as últimas alterações das campanhas.",
    tone: "warning",
  },
};

function StatusIcon({ state }: { state: GoogleAdsState }) {
  if (state === "healthy") return <CheckCircle2 size={20} />;
  if (state === "stale") return <Clock3 size={20} />;
  if (state === "sync_error") return <AlertCircle size={20} />;
  if (state === "config_missing") return <Wrench size={20} />;
  return <Unplug size={20} />;
}

function StatusSkeleton() {
  return (
    <div className="animate-pulse space-y-4" aria-label="Carregando integração do Google Ads">
      <div className="h-6 w-36 rounded-full bg-gray-100 dark:bg-gray-800" />
      <div className="h-8 w-3/4 rounded-lg bg-gray-100 dark:bg-gray-800" />
      <div className="h-4 w-full rounded bg-gray-100 dark:bg-gray-800" />
      <div className="h-4 w-4/5 rounded bg-gray-100 dark:bg-gray-800" />
    </div>
  );
}

export default function IntegracaoGoogleAds() {
  const { isMember, isImpersonating } = useAuth();
  const canManage = !isMember && !isImpersonating;
  const [status, setStatus] = useState<GoogleAdsStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    setError(null);
    try {
      setStatus(await fetchGoogleAdsApi<GoogleAdsStatus>("/api/marketing/google-ads/status"));
    } catch {
      setError("Não conseguimos consultar a integração agora.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  const sync = async () => {
    setSyncing(true);
    setNotice(null);
    setError(null);
    try {
      await fetchGoogleAdsApi("/api/marketing/google-ads/sync", {
        method: "POST",
        body: JSON.stringify({}),
      });
      setNotice("Dados atualizados com sucesso.");
      await loadStatus();
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : "Não foi possível atualizar os dados.");
    } finally {
      setSyncing(false);
    }
  };

  const copy = status ? STATE_COPY[status.state] : null;
  const canSyncNow = Boolean(status?.can_sync && canManage && !syncing);

  return (
    <div className="max-w-4xl space-y-4">
      <Link
        to="/configuracoes/integracoes"
        className="inline-flex items-center gap-1 text-sm text-gray-500 transition-colors hover:text-gray-800 dark:hover:text-gray-200"
      >
        <ChevronLeft size={16} /> Voltar para integrações
      </Link>

      <section className="relative overflow-hidden rounded-[1.75rem] border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-800 sm:p-8">
        <div className="pointer-events-none absolute -right-24 -top-24 h-56 w-56 rounded-full bg-blue-500/10 blur-3xl" aria-hidden />
        <div className="relative">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
            <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-blue-700 ring-1 ring-blue-100 dark:bg-blue-950/40 dark:text-blue-300 dark:ring-blue-900">
              <BarChart3 size={27} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-blue-600 dark:text-blue-400">Mídia paga</p>
              <h1 className="mt-1 text-2xl font-semibold tracking-[-0.03em] text-gray-950 dark:text-white">Google Ads</h1>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-gray-600 dark:text-gray-400">
                Acompanhe investimento, impressões, cliques, CPC e conversões nativas da conta vinculada. Vendas atribuídas, CAC e ROAS só ficam disponíveis depois de um vínculo de clique verificável pelo CRM.
              </p>
            </div>
          </div>

          <div className="mt-7 border-t border-gray-100 pt-6 dark:border-gray-700/80">
            {loading ? (
              <StatusSkeleton />
            ) : error && !status ? (
              <div className="rounded-2xl border border-red-200 bg-red-50 p-5 dark:border-red-900/50 dark:bg-red-950/20">
                <div className="flex items-start gap-3 text-red-700 dark:text-red-300">
                  <AlertCircle className="mt-0.5 flex-shrink-0" size={19} />
                  <div>
                    <p className="font-semibold">Não foi possível carregar</p>
                    <p className="mt-1 text-sm text-red-600/80 dark:text-red-300/75">{error}</p>
                    <button type="button" onClick={loadStatus} className="mt-3 text-sm font-semibold underline underline-offset-4">
                      Tentar novamente
                    </button>
                  </div>
                </div>
              </div>
            ) : status && copy ? (
              <div className="space-y-5">
                <div className={cn(
                  "rounded-2xl border p-5",
                  copy.tone === "success" && "border-emerald-200 bg-emerald-50/70 dark:border-emerald-900/50 dark:bg-emerald-950/20",
                  copy.tone === "warning" && "border-amber-200 bg-amber-50/70 dark:border-amber-900/50 dark:bg-amber-950/20",
                  copy.tone === "neutral" && "border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/30",
                )}>
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex items-start gap-3">
                      <span className={cn(
                        "mt-0.5 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl",
                        copy.tone === "success" && "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
                        copy.tone === "warning" && "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
                        copy.tone === "neutral" && "bg-white text-gray-500 shadow-sm dark:bg-gray-800 dark:text-gray-300",
                      )}>
                        <StatusIcon state={status.state} />
                      </span>
                      <div>
                        <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-gray-500 dark:text-gray-400">{copy.label}</span>
                        <h2 className="mt-1 font-semibold text-gray-950 dark:text-white">{copy.title}</h2>
                        <p className="mt-1 max-w-xl text-sm leading-relaxed text-gray-600 dark:text-gray-400">{copy.description}</p>
                      </div>
                    </div>
                    {status.linked && (
                      <button
                        type="button"
                        onClick={sync}
                        disabled={!canSyncNow}
                        className="inline-flex min-h-10 flex-shrink-0 items-center justify-center gap-2 rounded-xl bg-gray-950 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-black disabled:cursor-not-allowed disabled:opacity-45 dark:bg-white dark:text-gray-950 dark:hover:bg-gray-100"
                      >
                        <RefreshCw size={15} className={syncing ? "animate-spin" : ""} />
                        {syncing ? "Atualizando…" : "Atualizar dados"}
                      </button>
                    )}
                  </div>

                  {status.linked && (
                    <dl className="mt-5 grid gap-3 border-t border-black/[0.06] pt-4 text-sm dark:border-white/[0.07] sm:grid-cols-3">
                      <div>
                        <dt className="text-xs text-gray-500 dark:text-gray-400">Conta vinculada</dt>
                        <dd className="mt-1 truncate font-medium text-gray-900 dark:text-white">{status.account?.name || "Conta do estúdio"}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-gray-500 dark:text-gray-400">Identificação</dt>
                        <dd className="mt-1 font-mono text-xs font-medium text-gray-900 dark:text-white">{status.account?.customer_id_masked || "Protegida"}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-gray-500 dark:text-gray-400">Última atualização</dt>
                        <dd className="mt-1 font-medium text-gray-900 dark:text-white">{formatGoogleAdsDate(status.last_synced_at)}</dd>
                      </div>
                    </dl>
                  )}
                </div>

                {!canManage && status.linked && (
                  <p className="text-xs text-gray-500 dark:text-gray-400">Somente o dono da conta pode iniciar uma atualização manual.</p>
                )}
                {status.cooldown_seconds_remaining > 0 && canManage && (
                  <p className="text-xs text-gray-500 dark:text-gray-400">Uma nova atualização estará disponível em alguns minutos.</p>
                )}
              </div>
            ) : null}

            {(error || notice) && status && (
              <div role="status" className={cn(
                "mt-4 flex items-center gap-2 rounded-xl border px-4 py-3 text-sm",
                error
                  ? "border-red-200 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-300"
                  : "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-emerald-300",
              )}>
                {error ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />}
                {error || notice}
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        <InfoCard icon={<ShieldCheck size={17} />} title="Acesso isolado">Você vê apenas os dados vinculados ao seu próprio estúdio.</InfoCard>
        <InfoCard icon={<RefreshCw size={17} />} title="Atualização controlada">Os dados são importados e guardados com histórico de sincronização.</InfoCard>
        <InfoCard icon={<ArrowUpRight size={17} />} title="Atribuição condicionada">Vendas, CAC e ROAS permanecem ocultos até o CRM validar o vínculo entre clique, campanha e venda.</InfoCard>
      </section>
    </div>
  );
}

function InfoCard({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">{icon}</span>
      <h3 className="mt-3 text-sm font-semibold text-gray-900 dark:text-white">{title}</h3>
      <p className="mt-1 text-xs leading-relaxed text-gray-500 dark:text-gray-400">{children}</p>
    </div>
  );
}

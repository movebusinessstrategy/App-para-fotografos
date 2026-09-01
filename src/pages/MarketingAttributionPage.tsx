import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowUpRight,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  Clock3,
  ExternalLink,
  Eye,
  Link2,
  Loader2,
  MessageCircle,
  MousePointerClick,
  RefreshCw,
  Route,
  Search,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';

import type { AttributionLeadRecord, AttributionSourceKey } from '../../lib/marketing-attribution-report';
import type { MarketingAttributionApiResponse } from '../../lib/marketing-attribution-query';
import { authFetch } from '../utils/authFetch';
import { cn } from '../utils/cn';

const PERIODS = [7, 30, 90, 180] as const;

const SOURCE_STYLES: Record<AttributionSourceKey, string> = {
  google_ads: 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-300',
  meta_ads: 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-500/20 dark:bg-violet-500/10 dark:text-violet-300',
  organic: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300',
  referral: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300',
  direct: 'border-gray-200 bg-gray-50 text-gray-600 dark:border-white/10 dark:bg-white/5 dark:text-gray-300',
  other: 'border-gray-200 bg-gray-50 text-gray-600 dark:border-white/10 dark:bg-white/5 dark:text-gray-300',
};

function formatDate(value: string | null, includeTime = false): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'short',
    ...(includeTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(new Date(value));
}

function formatPhone(value: string | null): string {
  const digits = String(value || '').replace(/\D/g, '');
  const local = digits.startsWith('55') ? digits.slice(2) : digits;
  if (local.length !== 11) return value || 'Sem telefone';
  return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
}

function compactPath(value: string | null): string {
  if (!value) return 'Página não identificada';
  try {
    const url = new URL(value, window.location.origin);
    return `${url.pathname}${url.search}`;
  } catch {
    return value;
  }
}

type KpiCardProps = {
  label: string;
  value: string | number;
  detail: string;
  icon: typeof MessageCircle;
};

function KpiCard({ label, value, detail, icon: Icon }: KpiCardProps) {
  return (
    <div className="rounded-2xl border border-black/[0.06] bg-white p-5 shadow-sm shadow-black/[0.02] dark:border-white/[0.07] dark:bg-[#111]">
      <div className="mb-5 flex items-start justify-between gap-4">
        <p className="text-sm font-medium text-gray-500 dark:text-gray-400">{label}</p>
        <span className="rounded-xl bg-[#f5efe4] p-2 text-[#8a611c] dark:bg-gold-400/10 dark:text-gold-300">
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <p className="text-3xl font-semibold tracking-tight text-gray-950 dark:text-white">{value}</p>
      <p className="mt-1 text-xs leading-relaxed text-gray-500 dark:text-gray-400">{detail}</p>
    </div>
  );
}

type HealthItemProps = {
  label: string;
  detail: string;
  status: 'ok' | 'pending' | 'error';
};

function HealthItem({ label, detail, status }: HealthItemProps) {
  const Icon = status === 'ok' ? CheckCircle2 : status === 'error' ? CircleAlert : Clock3;
  const iconClass = status === 'ok'
    ? 'text-emerald-500'
    : status === 'error' ? 'text-red-500' : 'text-amber-500';
  return (
    <div className="flex items-start gap-3 py-3">
      <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', iconClass)} />
      <div className="min-w-0">
        <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{label}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-gray-500 dark:text-gray-400">{detail}</p>
      </div>
    </div>
  );
}

function integrationHealth(data: MarketingAttributionApiResponse, provider: string): HealthItemProps {
  const integration = data.report.integrations.find(item => item.provider === provider);
  const label = provider === 'google' ? 'Google Ads' : provider === 'meta' ? 'Meta Ads' : 'Google Analytics 4';
  if (!integration) return { label, status: 'pending', detail: 'Destino ainda não vinculado ao envio do CRM.' };
  if (integration.last_error) return { label, status: 'error', detail: 'A última validação encontrou um erro.' };
  if (integration.enabled) return { label, status: 'ok', detail: 'Integração ativa e pronta para receber eventos.' };
  if (integration.configured) return { label, status: 'pending', detail: 'Destino configurado, aguardando validação para ativar.' };
  return { label, status: 'pending', detail: 'Configuração ainda incompleta.' };
}

function SourceDistribution({ data }: { data: MarketingAttributionApiResponse }) {
  const rows = data.report.sources.filter(row => row.contacts > 0);
  return (
    <section className="rounded-2xl border border-black/[0.06] bg-white p-5 shadow-sm shadow-black/[0.02] dark:border-white/[0.07] dark:bg-[#111]">
      <div className="mb-5">
        <h2 className="text-base font-semibold text-gray-950 dark:text-white">Origem dos contatos</h2>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Distribuição dos contatos confirmados no período.</p>
      </div>
      {rows.length === 0 ? (
        <p className="rounded-xl bg-gray-50 px-4 py-8 text-center text-sm text-gray-500 dark:bg-white/[0.03] dark:text-gray-400">
          Ainda não há contatos atribuídos neste período.
        </p>
      ) : (
        <div className="space-y-4">
          {rows.map(row => (
            <div key={row.key}>
              <div className="mb-1.5 flex items-center justify-between gap-4 text-sm">
                <span className="font-medium text-gray-700 dark:text-gray-200">{row.label}</span>
                <span className="tabular-nums text-gray-500 dark:text-gray-400">{row.contacts} · {row.percent}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-gray-100 dark:bg-white/[0.06]">
                <div className="h-full rounded-full bg-[#b88938]" style={{ width: `${Math.max(row.percent, 2)}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function TrackingHealth({ data }: { data: MarketingAttributionApiResponse }) {
  const siteOk = Boolean(data.site?.enabled && data.site?.measurement_enabled);
  const collectionOk = data.collection.page_views && data.collection.site_clicks;
  return (
    <section className="rounded-2xl border border-black/[0.06] bg-white p-5 shadow-sm shadow-black/[0.02] dark:border-white/[0.07] dark:bg-[#111]">
      <div className="mb-2">
        <h2 className="text-base font-semibold text-gray-950 dark:text-white">Saúde do rastreamento</h2>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">O que já está conversando com o CRM.</p>
      </div>
      <div className="divide-y divide-black/[0.05] dark:divide-white/[0.06]">
        <HealthItem
          label="Site do Estúdio"
          status={siteOk ? 'ok' : 'pending'}
          detail={siteOk ? 'Ponte first-party ativa e isolada para o Estúdio Gi Pitori.' : 'A ponte ainda não está completamente habilitada.'}
        />
        <HealthItem label="CRM Trilha" status="ok" detail="Contato real do WhatsApp vira fato de conversão, sem contar só o clique." />
        <HealthItem
          label="Jornada no site"
          status={collectionOk ? 'ok' : 'pending'}
          detail={collectionOk ? 'Páginas e cliques estão sendo coletados.' : data.collection.note}
        />
        {['google', 'meta', 'ga4'].map(provider => <HealthItem key={provider} {...integrationHealth(data, provider)} />)}
      </div>
    </section>
  );
}

function Journey({ record }: { record: AttributionLeadRecord }) {
  return (
    <div className="border-t border-black/[0.05] bg-gray-50/70 px-4 py-4 dark:border-white/[0.06] dark:bg-white/[0.02] md:px-5">
      <div className="relative space-y-4 before:absolute before:bottom-2 before:left-[7px] before:top-2 before:w-px before:bg-gray-200 dark:before:bg-white/10">
        {record.journey.map(event => (
          <div key={event.id} className="relative flex gap-3 pl-0">
            <span className={cn(
              'relative z-10 mt-1 h-[15px] w-[15px] shrink-0 rounded-full border-[3px] border-gray-50 dark:border-[#151515]',
              event.kind === 'milestone' ? 'bg-[#b88938]' : 'bg-gray-400 dark:bg-gray-500',
            )} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{event.label}</p>
                <time className="text-xs text-gray-400">{formatDate(event.occurred_at, true)}</time>
              </div>
              {(event.page_path || event.detail) && (
                <p className="mt-1 break-all text-xs text-gray-500 dark:text-gray-400">
                  {[compactPath(event.page_path), event.detail].filter(Boolean).join(' · ')}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function LeadRow({ record }: { record: AttributionLeadRecord }) {
  const [open, setOpen] = useState(false);
  const phoneDigits = String(record.contact_phone || '').replace(/\D/g, '');
  return (
    <article className="overflow-hidden rounded-2xl border border-black/[0.06] bg-white shadow-sm shadow-black/[0.02] dark:border-white/[0.07] dark:bg-[#111]">
      <div className="p-4 md:p-5">
        <div className="grid gap-5 lg:grid-cols-[1.1fr_1.2fr_.8fr_auto] lg:items-center">
          <div className="min-w-0">
            <span className={cn('inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold', SOURCE_STYLES[record.source])}>
              {record.source_label}
            </span>
            <p className="mt-3 truncate font-semibold text-gray-950 dark:text-white">{record.contact_name}</p>
            <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{formatPhone(record.contact_phone)}</p>
          </div>

          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-400">Campanha</p>
            <p className="mt-1 truncate text-sm font-medium text-gray-800 dark:text-gray-200">{record.campaign || 'Campanha não identificada'}</p>
            <p className="mt-1 truncate text-xs text-gray-500 dark:text-gray-400">
              {record.keyword ? `Busca: ${record.keyword}` : compactPath(record.landing_page)}
            </p>
          </div>

          <div className="grid grid-cols-3 gap-2 text-center lg:text-left">
            <div>
              <p className="text-lg font-semibold tabular-nums text-gray-900 dark:text-gray-100">{record.page_view_count}</p>
              <p className="text-[11px] text-gray-400">páginas</p>
            </div>
            <div>
              <p className="text-lg font-semibold tabular-nums text-gray-900 dark:text-gray-100">{record.click_count}</p>
              <p className="text-[11px] text-gray-400">cliques</p>
            </div>
            <div>
              <p className="text-lg font-semibold tabular-nums text-gray-900 dark:text-gray-100">{record.session_count}</p>
              <p className="text-[11px] text-gray-400">sessões</p>
            </div>
          </div>

          <div className="flex items-center gap-2 lg:justify-end">
            {phoneDigits && (
              <a
                href={`/whatsapp?phone=${encodeURIComponent(phoneDigits)}`}
                className="inline-flex h-10 items-center gap-2 rounded-xl border border-black/[0.07] px-3 text-xs font-medium text-gray-700 transition hover:bg-gray-50 dark:border-white/10 dark:text-gray-200 dark:hover:bg-white/5"
              >
                <MessageCircle className="h-4 w-4" />
                Conversa
              </a>
            )}
            <button
              type="button"
              onClick={() => setOpen(value => !value)}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-gray-950 px-3 text-xs font-medium text-white transition hover:bg-gray-800 dark:bg-white dark:text-gray-950 dark:hover:bg-gray-200"
            >
              Jornada
              {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 border-t border-black/[0.05] pt-4 text-xs text-gray-500 dark:border-white/[0.06] dark:text-gray-400">
          <span>Primeiro acesso: {formatDate(record.first_seen_at, true)}</span>
          <span>Última atividade: {formatDate(record.last_seen_at, true)}</span>
          {record.funnel_stage && <span>Etapa: {record.funnel_stage}</span>}
          {record.has_purchase && <span className="font-medium text-emerald-600 dark:text-emerald-400">Venda confirmada</span>}
        </div>
      </div>
      {open && <Journey record={record} />}
    </article>
  );
}

function LoadingState() {
  return (
    <div className="flex min-h-[360px] items-center justify-center rounded-2xl border border-black/[0.06] bg-white dark:border-white/[0.07] dark:bg-[#111]">
      <div className="text-center">
        <Loader2 className="mx-auto h-6 w-6 animate-spin text-[#b88938]" />
        <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">Organizando a jornada dos leads…</p>
      </div>
    </div>
  );
}

export default function MarketingAttributionPage() {
  const [days, setDays] = useState<number>(30);
  const [data, setData] = useState<MarketingAttributionApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await authFetch(`/api/marketing/attribution-report?days=${days}`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || 'Falha ao carregar o rastreamento.');
      setData(payload as MarketingAttributionApiResponse);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Falha ao carregar o rastreamento.');
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => { load(); }, [load]);

  const records = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return data?.report.records || [];
    return (data?.report.records || []).filter(record => [
      record.contact_name,
      record.contact_phone,
      record.campaign,
      record.keyword,
      record.source_label,
    ].some(value => String(value || '').toLowerCase().includes(term)));
  }, [data, search]);

  const summary = data?.report.summary;

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-6 pb-10">
      <header className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
        <div className="max-w-3xl">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-[#d9c39b]/50 bg-[#f7f1e7] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#8a611c] dark:border-gold-400/20 dark:bg-gold-400/10 dark:text-gold-300">
            <ShieldCheck className="h-3.5 w-3.5" />
            Atribuição first-party
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-gray-950 dark:text-white md:text-3xl">Rastreamento de aquisição</h1>
          <p className="mt-2 text-sm leading-relaxed text-gray-500 dark:text-gray-400">
            Veja de onde cada contato veio, qual campanha trouxe a conversa e o caminho percorrido até virar lead ou venda.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-xl border border-black/[0.07] bg-white p-1 dark:border-white/10 dark:bg-[#111]">
            {PERIODS.map(period => (
              <button
                key={period}
                type="button"
                onClick={() => setDays(period)}
                className={cn(
                  'rounded-lg px-3 py-2 text-xs font-medium transition',
                  period === days
                    ? 'bg-gray-950 text-white dark:bg-white dark:text-gray-950'
                    : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white',
                )}
              >
                {period} dias
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="inline-flex h-[42px] items-center gap-2 rounded-xl border border-black/[0.07] bg-white px-3 text-xs font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-50 dark:border-white/10 dark:bg-[#111] dark:text-gray-200 dark:hover:bg-white/5"
          >
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
            Atualizar
          </button>
        </div>
      </header>

      {loading && !data ? <LoadingState /> : error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">
          <div className="flex items-start gap-3">
            <CircleAlert className="mt-0.5 h-5 w-5 shrink-0" />
            <div>
              <p className="font-semibold">Não foi possível carregar o painel.</p>
              <p className="mt-1">{error}</p>
            </div>
          </div>
        </div>
      ) : data && !data.configured ? (
        <div className="rounded-2xl border border-black/[0.06] bg-white px-6 py-14 text-center dark:border-white/[0.07] dark:bg-[#111]">
          <Link2 className="mx-auto h-7 w-7 text-[#b88938]" />
          <h2 className="mt-4 text-lg font-semibold text-gray-950 dark:text-white">Rastreamento ainda não configurado</h2>
          <p className="mx-auto mt-2 max-w-lg text-sm text-gray-500 dark:text-gray-400">Este painel está sendo liberado primeiro para o Estúdio Gi Pitori, sem afetar as outras contas.</p>
        </div>
      ) : data && summary ? (
        <>
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard label="Contatos confirmados" value={summary.contacts} detail="Mensagens reais recebidas, sem contar apenas o clique." icon={MessageCircle} />
            <KpiCard label="Origem identificada" value={`${summary.attribution_rate}%`} detail={`${summary.attributed_contacts} de ${summary.contacts} contatos com origem reconhecida.`} icon={Route} />
            <KpiCard label="Cliques rastreados" value={summary.tracked_clicks} detail="Interações registradas no site dentro do período." icon={MousePointerClick} />
            <KpiCard label="Visitante → contato" value={`${summary.contact_rate}%`} detail={`${summary.contacts} contatos entre ${summary.visitors} jornadas identificadas.`} icon={ArrowUpRight} />
          </section>

          {!data.collection.page_views && (
            <div className="flex items-start gap-3 rounded-2xl border border-amber-200/80 bg-amber-50/80 p-4 text-amber-900 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200">
              <Sparkles className="mt-0.5 h-4 w-4 shrink-0" />
              <p className="text-xs leading-relaxed">
                <strong>Leitura atual:</strong> o clique no WhatsApp e a conversa confirmada já são rastreados. A sequência completa de páginas e demais cliques começa a aparecer depois da ativação segura do coletor de navegação.
              </p>
            </div>
          )}

          <div className="grid gap-4 xl:grid-cols-2">
            <SourceDistribution data={data} />
            <TrackingHealth data={data} />
          </div>

          <section>
            <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-950 dark:text-white">Jornada por contato</h2>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{records.length} registros encontrados no período selecionado.</p>
              </div>
              <label className="relative block w-full md:w-80">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input
                  value={search}
                  onChange={event => setSearch(event.target.value)}
                  placeholder="Buscar contato, campanha ou origem"
                  className="h-11 w-full rounded-xl border border-black/[0.07] bg-white pl-10 pr-4 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-[#b88938]/60 focus:ring-2 focus:ring-[#b88938]/10 dark:border-white/10 dark:bg-[#111] dark:text-white"
                />
              </label>
            </div>

            {records.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-black/10 bg-white/60 px-6 py-14 text-center dark:border-white/10 dark:bg-white/[0.02]">
                <Eye className="mx-auto h-6 w-6 text-gray-400" />
                <p className="mt-3 text-sm font-medium text-gray-700 dark:text-gray-200">Nenhuma jornada encontrada</p>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Tente outro período ou limpe a busca.</p>
              </div>
            ) : (
              <div className="space-y-3">{records.map(record => <LeadRow key={record.lead_id} record={record} />)}</div>
            )}
          </section>

          <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-black/[0.06] pt-5 text-[11px] text-gray-400 dark:border-white/[0.07]">
            <span>Atualizado em {formatDate(data.generated_at, true)}</span>
            <span className="inline-flex items-center gap-1.5"><ExternalLink className="h-3.5 w-3.5" /> Dados isolados por conta no CRM Trilha</span>
          </footer>
        </>
      ) : null}
    </div>
  );
}

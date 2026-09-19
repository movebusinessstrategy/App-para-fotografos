import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Ban, GitCompareArrows, Loader2, Settings, ShieldAlert, Sparkles } from 'lucide-react';
import { DealDetailDrawer } from '../../components/vendas/DealDetailDrawer';
import { useAuth } from '../../contexts/AuthContext';
import type { Client, Deal, PipelineStage } from '../../types';
import { cn } from '../../utils/cn';
import { Toast, type ToastState } from '../galeria/Toast';
import { api, errorMessage, errorStatus, isSweepStarted, type SweepBody } from './api';
import { ChannelHealthBanner } from './ChannelHealthBanner';
import { ConfigDrawer } from './ConfigDrawer';
import { formatDay } from './format';
import { useFollowUpConfig, useFollowUpOverview } from './hooks';
import {
  CONSENT_MEMBER_TEXT, CONSENT_OWNER_TEXT, MIGRATION_REQUIRED_TEXT, NETWORK_ERROR_TEXT, TONE_CLASSES,
} from './labels';
import { OptOutsDrawer } from './OptOutsDrawer';
import { QueueList } from './QueueList';
import { ReconcileModal } from './ReconcileModal';
import { StatsStrip } from './StatsStrip';
import type { FollowUpOverview, FollowUpStep, QueueTab } from './types';

interface Props {
  deals: Deal[];
  stages: PipelineStage[];
  clients: Client[];
  onDealUpdated: () => void;
}

type Notify = (t: ToastState) => void;

// ─── Deep link (?config=1&stage=<id>&deal=<id>) ──────────────────────────────

function positiveId(raw: string | null): number | null {
  const n = Number(raw);
  return raw && Number.isInteger(n) && n > 0 ? n : null;
}

function useDeepLink(onConfig: (stageId: string | null) => void, onDeal: (dealId: number) => void) {
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const config = searchParams.get('config');
    const stage = searchParams.get('stage');
    const deal = searchParams.get('deal');
    if (!config && !stage && !deal) return;
    if (config === '1' || stage) onConfig(stage || null);
    const dealId = positiveId(deal);
    if (dealId) onDeal(dealId);
    // Limpa os params para não reabrir no F5 (mesmo padrão do ?novo=1 em Vendas).
    const next = new URLSearchParams(searchParams);
    next.delete('config');
    next.delete('stage');
    next.delete('deal');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams, onConfig, onDeal]);
}

function useToast() {
  const [toast, setToast] = useState<ToastState | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);
  return { toast, setToast, clear: () => setToast(null) };
}

function sweepStartedText(eligible: number, willGenerate: number): string {
  if (willGenerate === 0) return 'Nenhuma conversa parada precisa de follow-up agora.';
  return `A IA está lendo ${eligible} conversas. Os rascunhos aparecem aqui em instantes.`;
}

function useSweep(notify: Notify, refresh: () => void) {
  const [busy, setBusy] = useState(false);
  const run = async (body: SweepBody) => {
    setBusy(true);
    try {
      const res = await api.sweep(body);
      if (isSweepStarted(res)) notify({ kind: 'success', message: sweepStartedText(res.eligible_total, res.will_generate) });
    } catch (err) {
      notify({ kind: 'error', message: errorMessage(err) });
    } finally {
      setBusy(false);
      refresh();
    }
  };
  return { busy, run };
}

function useResume(notify: Notify, refresh: () => void) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      await api.setSending(false);
      notify({ kind: 'success', message: 'Envios retomados.' });
    } catch (err) {
      notify({ kind: 'error', message: errorMessage(err) });
    } finally {
      setBusy(false);
      refresh();
    }
  };
  return { busy, run };
}

// ─── Faixas ──────────────────────────────────────────────────────────────────

function Banner({ tone, children }: { tone: keyof typeof TONE_CLASSES; children: ReactNode }) {
  return <div className={cn('rounded-2xl border p-3 text-[12px]', TONE_CLASSES[tone])}>{children}</div>;
}

function ConsentBanner({ overview, impersonating, busy, onAuthorize }: {
  overview: FollowUpOverview; impersonating: boolean; busy: boolean; onAuthorize: () => void;
}) {
  if (overview.consent.external_ai) return null;
  if (!overview.can_edit_config) return <Banner tone="amber"><ShieldAlert size={13} className="mr-1 inline" />{CONSENT_MEMBER_TEXT}</Banner>;
  return (
    <Banner tone="amber">
      <p className="flex items-start gap-1.5"><ShieldAlert size={14} className="mt-0.5 flex-shrink-0" />{CONSENT_OWNER_TEXT}</p>
      {impersonating
        ? <p className="mt-2 font-semibold">No modo suporte, só o dono da conta pode autorizar.</p>
        : (
          <button type="button" onClick={onAuthorize} disabled={busy}
            className="mt-2 flex items-center gap-1.5 rounded-lg bg-gold-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-gold-700 disabled:opacity-60">
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} Autorizar e gerar rascunhos
          </button>
        )}
    </Banner>
  );
}

function WarmupNote({ sending }: { sending: FollowUpOverview['sending'] }) {
  if (!sending.warmup_until) return null;
  return (
    <Banner tone="blue">
      Aquecimento do número: até {sending.effective_cap} envios por dia até {formatDay(sending.warmup_until)}.
    </Banner>
  );
}

function DisabledNotice({ overview, onConfigure }: { overview: FollowUpOverview; onConfigure: () => void }) {
  if (overview.enabled) return null;
  return (
    <Banner tone="slate">
      <p className="font-semibold">Os follow-ups da IA estão desligados nesta conta.</p>
      {overview.can_edit_config
        ? <button type="button" onClick={onConfigure} className="mt-1.5 font-bold text-gold-700 hover:text-gold-600 dark:text-gold-400">Configurar e ativar</button>
        : <p className="mt-1">Peça ao dono da conta para ativar.</p>}
    </Banner>
  );
}

function LegacyNotice({ overview }: { overview: FollowUpOverview }) {
  const stages = overview.legacy_automation ?? [];
  if (stages.length === 0) return null;
  return (
    <Banner tone="amber">
      A mensagem fixa antiga ainda está ligada em: {stages.map((s) => s.stage_name).join(', ')}. Desligue na configuração para o cliente não receber duas mensagens.
    </Banner>
  );
}

// ─── Barra de ações ──────────────────────────────────────────────────────────

const ACTION_BTN = 'flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-gray-700 transition-colors hover:border-gray-300 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:border-gray-600';

function sweepBlockReason(o: FollowUpOverview, busy: boolean): string | null {
  if (!o.consent.external_ai) return 'Falta autorizar a leitura das conversas pela IA.';
  if (o.sweep.running || busy) return 'A IA já está lendo as conversas.';
  return null;
}

interface ActionsProps {
  overview: FollowUpOverview;
  sweeping: boolean;
  onSweep: () => void;
  onConfigure: () => void;
  onOptOuts: () => void;
  onReconcile: () => void;
}

function PanelActions({ overview, sweeping, onSweep, onConfigure, onOptOuts, onReconcile }: ActionsProps) {
  const blocked = sweepBlockReason(overview, sweeping);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {overview.can_approve && (
        <button type="button" onClick={onSweep} disabled={!!blocked} title={blocked ?? undefined}
          className={cn(ACTION_BTN, 'border-gold-600 bg-gold-600 text-white hover:bg-gold-700 dark:border-gold-600 dark:bg-gold-600 dark:text-white')}>
          {sweeping ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
          {overview.enabled ? 'Gerar rascunhos agora' : 'Gerar rascunhos de teste'}
        </button>
      )}
      <button type="button" onClick={onConfigure} className={ACTION_BTN}><Settings size={14} /> Configurar</button>
      <button type="button" onClick={onOptOuts} className={ACTION_BTN}><Ban size={14} /> Não contatar</button>
      {overview.can_edit_config && (
        <button type="button" onClick={onReconcile} className={ACTION_BTN}><GitCompareArrows size={14} /> Revisar funil (prévia)</button>
      )}
    </div>
  );
}

// ─── Estados da página ───────────────────────────────────────────────────────

function Centered({ children }: { children: ReactNode }) {
  return <div className="flex h-full items-center justify-center p-6 text-center text-[13px] text-gray-500 dark:text-gray-400">{children}</div>;
}

function LoadState({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  if (!error) return <Centered><Loader2 size={22} className="animate-spin text-gray-400" /></Centered>;
  if (errorStatus(error) === 403) return <Centered>Você não tem acesso aos follow-ups.</Centered>;
  return (
    <Centered>
      <div>
        <p>{NETWORK_ERROR_TEXT}</p>
        <button type="button" onClick={onRetry} className="mt-2 font-bold text-gold-700 hover:text-gold-600 dark:text-gold-400">Tentar de novo</button>
      </div>
    </Centered>
  );
}

// ─── Painel ──────────────────────────────────────────────────────────────────

function findDeal(deals: Deal[], id: number | null): Deal | null {
  if (id === null) return null;
  return deals.find((d) => Number(d.id) === id) ?? null;
}

export function FollowUpsPanel({ deals, stages, clients, onDealUpdated }: Props) {
  const { isImpersonating } = useAuth();
  const overviewSwr = useFollowUpOverview();
  const configSwr = useFollowUpConfig(true);
  const { toast, setToast, clear } = useToast();
  const [tab, setTab] = useState<QueueTab>('draft');
  const [step, setStep] = useState<FollowUpStep | null>(null);
  const [dealFilter, setDealFilter] = useState<number | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [focusStage, setFocusStage] = useState<string | null>(null);
  const [optOutsOpen, setOptOutsOpen] = useState(false);
  const [reconcileOpen, setReconcileOpen] = useState(false);
  const [openDealId, setOpenDealId] = useState<number | null>(null);

  const { mutate: mutateOverview } = overviewSwr;
  const refreshOverview = useCallback(() => { void mutateOverview(); }, [mutateOverview]);
  const sweep = useSweep(setToast, refreshOverview);
  const resume = useResume(setToast, refreshOverview);

  const openConfig = useCallback((stageId: string | null) => { setFocusStage(stageId); setConfigOpen(true); }, []);
  const filterDeal = useCallback((dealId: number) => { setDealFilter(dealId); setTab('draft'); setStep(null); }, []);
  useDeepLink(openConfig, filterDeal);

  const overview = overviewSwr.data;
  if (!overview) return <LoadState error={overviewSwr.error} onRetry={refreshOverview} />;
  if (overview.migration_required) return <Centered>{MIGRATION_REQUIRED_TEXT}</Centered>;

  const cfg = configSwr.data?.config;
  const gap = cfg ? { min: cfg.min_gap_seconds, max: cfg.max_gap_seconds } : null;
  const openDeal = findDeal(deals, openDealId);
  const openDealClient = openDeal?.client_id ? clients.find((c) => c.id === openDeal.client_id) : undefined;
  const openDealById = (id: number) => {
    if (findDeal(deals, id)) { setOpenDealId(id); return; }
    setToast({ kind: 'info', message: 'Este negócio não aparece no funil agora. Atualize a página e tente de novo.' });
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl space-y-3 p-3 sm:p-4">
        <ConsentBanner overview={overview} impersonating={isImpersonating} busy={sweep.busy}
          onAuthorize={() => void sweep.run({ consent_to_external_ai: true })} />
        <WarmupNote sending={overview.sending} />
        <ChannelHealthBanner health={overview.channels} sending={overview.sending} enabled={overview.enabled} mode={overview.mode}
          canResume={overview.can_approve} resuming={resume.busy} onResume={() => void resume.run()} />
        <DisabledNotice overview={overview} onConfigure={() => openConfig(null)} />
        <LegacyNotice overview={overview} />
        <StatsStrip overview={overview} activeTab={tab} onPickTab={setTab} onOpenOptOuts={() => setOptOutsOpen(true)} />
        <PanelActions overview={overview} sweeping={sweep.busy} onSweep={() => void sweep.run({})}
          onConfigure={() => openConfig(null)} onOptOuts={() => setOptOutsOpen(true)} onReconcile={() => setReconcileOpen(true)} />
        <QueueList overview={overview} tab={tab} onTabChange={setTab} step={step} onStepChange={setStep}
          dealId={dealFilter} onClearDeal={() => setDealFilter(null)} gap={gap}
          onOpenDeal={openDealById} onToast={setToast} onOverviewChanged={refreshOverview} />
      </div>

      <ConfigDrawer open={configOpen} focusStageId={focusStage} impersonating={isImpersonating}
        onClose={() => setConfigOpen(false)} onToast={setToast}
        onSaved={() => { refreshOverview(); onDealUpdated(); }} />
      <OptOutsDrawer open={optOutsOpen} canRemove={overview.can_edit_config} onClose={() => setOptOutsOpen(false)}
        onToast={setToast} onChanged={refreshOverview} />
      <ReconcileModal open={reconcileOpen} stages={stages} onClose={() => setReconcileOpen(false)} onToast={setToast}
        onApplied={() => { refreshOverview(); onDealUpdated(); }} />
      {openDeal && (
        <DealDetailDrawer deal={openDeal} client={openDealClient} clients={clients} stages={stages}
          onClose={() => setOpenDealId(null)} onUpdate={() => onDealUpdated()} />
      )}
      <Toast toast={toast} onClose={clear} />
    </div>
  );
}

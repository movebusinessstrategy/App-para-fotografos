import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCheck, Loader2, Search, X } from 'lucide-react';
import { ConfirmModal } from '../../components/ui/ConfirmModal';
import { cn } from '../../utils/cn';
import type { ToastState } from '../galeria/Toast';
import { api, errorMessage } from './api';
import { DraftCard } from './DraftCard';
import { approveAllConfirmText, businessDaysLabel } from './format';
import { useFollowUpQueue } from './hooks';
import { NETWORK_ERROR_TEXT, QUEUE_EMPTY_TEXT, QUEUE_TAB_LABELS, QUEUE_TABS, STEP_LABELS } from './labels';
import { FOLLOWUP_STEPS, type ApproveAllRequest, type CadenceStatus, type FollowUpDraftItem, type FollowUpOverview, type FollowUpStep, type QueueTab } from './types';

// Quais status continuam visíveis em cada aba depois de uma ação.
const TAB_STATUSES: Record<QueueTab, CadenceStatus[]> = {
  draft: ['draft'],
  approved: ['approved', 'sending'],
  blocked: ['blocked', 'failed'],
  sent_today: ['sent'],
  skipped: ['skipped'],
  cancelled: ['cancelled'],
};

const TAB_COUNTS: Record<QueueTab, (o: FollowUpOverview) => number> = {
  draft: (o) => o.counts.draft,
  approved: (o) => o.counts.approved + o.counts.sending,
  blocked: (o) => o.counts.blocked + o.counts.failed_7d,
  sent_today: (o) => o.sending.sent_today,
  skipped: (o) => o.counts.skipped_7d,
  cancelled: (o) => o.counts.cancelled_7d,
};

function neverSwept(o: FollowUpOverview): boolean {
  return !o.sweep.running && !o.sweep.last_summary && !o.sweep.finished_at;
}

function emptyText(tab: QueueTab, step: FollowUpStep | null, filtered: boolean, o: FollowUpOverview): string {
  if (filtered) return 'Nada encontrado com este filtro.';
  if (tab !== 'draft') return QUEUE_EMPTY_TEXT[tab];
  if (neverSwept(o)) return 'Nenhum rascunho ainda. Clique em Gerar rascunhos agora para a IA ler as conversas paradas.';
  if (step) return `Nenhum rascunho no passo ${step}.`;
  return QUEUE_EMPTY_TEXT.draft;
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function approveAllResultText(r: { approved: number; excluded: Record<string, number>; estimated_business_days: number }): string {
  const left = Object.values(r.excluded ?? {}).reduce((a, b) => a + (Number(b) || 0), 0);
  const base = r.approved === 1 ? '1 follow-up aprovado' : `${r.approved} follow-ups aprovados`;
  const days = r.approved > 0 ? ` (${businessDaysLabel(r.estimated_business_days)} para sair tudo)` : '';
  const extra = left > 0 ? ` ${left} ficaram de fora porque a conversa mudou, o card mudou de etapa ou o contato pediu para não receber.` : '';
  return `${base}${days}.${extra}`;
}

// ─── Pedaços ─────────────────────────────────────────────────────────────────

function QueueTabs({ tab, overview, onChange }: { tab: QueueTab; overview: FollowUpOverview; onChange: (t: QueueTab) => void }) {
  return (
    <div className="flex gap-1 overflow-x-auto">
      {QUEUE_TABS.map((t) => (
        <button key={t} type="button" onClick={() => onChange(t)}
          className={cn(
            'flex items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-[12px] font-semibold transition-colors',
            t === tab ? 'bg-gold-50 text-gold-700 dark:bg-gold-900/30 dark:text-gold-300' : 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700',
          )}>
          {QUEUE_TAB_LABELS[t]}
          <span className="rounded-full bg-white/80 px-1.5 text-[10px] text-gray-600 dark:bg-black/20 dark:text-gray-300">{TAB_COUNTS[t](overview)}</span>
        </button>
      ))}
    </div>
  );
}

function StepChips({ step, overview, onChange }: { step: FollowUpStep | null; overview: FollowUpOverview; onChange: (s: FollowUpStep | null) => void }) {
  const chip = (active: boolean) => cn(
    'whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-semibold',
    active ? 'border-gold-400 bg-gold-50 text-gold-800 dark:bg-gold-900/30 dark:text-gold-200' : 'border-gray-200 text-gray-600 hover:border-gray-300 dark:border-gray-700 dark:text-gray-300',
  );
  return (
    <div className="flex gap-1.5 overflow-x-auto">
      <button type="button" onClick={() => onChange(null)} className={chip(step === null)}>Todos {overview.counts.draft}</button>
      {FOLLOWUP_STEPS.map((s) => (
        <button key={s} type="button" onClick={() => onChange(s)} className={chip(step === s)}>
          {STEP_LABELS[s]} {overview.counts.draft_by_step?.[s] ?? 0}
        </button>
      ))}
    </div>
  );
}

interface ToolbarProps {
  search: string;
  onSearch: (v: string) => void;
  dealId: number | null;
  onClearDeal: () => void;
  showApproveAll: boolean;
  approveAllLabel: string;
  approveAllBlocked: string | null;
  onApproveAll: () => void;
}

function QueueToolbar(p: ToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="flex min-w-[180px] flex-1 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 dark:border-gray-700 dark:bg-gray-800">
        <Search size={13} className="text-gray-400" />
        <input value={p.search} onChange={(e) => p.onSearch(e.target.value)} placeholder="Buscar por nome ou telefone"
          className="w-full bg-transparent text-[12px] text-gray-900 outline-none dark:text-white" />
      </label>
      {p.dealId !== null && (
        <span className="flex items-center gap-1 rounded-full border border-gold-300 bg-gold-50 px-2.5 py-1 text-[11px] font-semibold text-gold-800 dark:border-gold-700 dark:bg-gold-900/30 dark:text-gold-200">
          Só o negócio #{p.dealId}
          <button type="button" onClick={p.onClearDeal} aria-label="Limpar filtro"><X size={12} /></button>
        </span>
      )}
      {p.showApproveAll && (
        <button type="button" onClick={p.onApproveAll} disabled={!!p.approveAllBlocked} title={p.approveAllBlocked ?? undefined}
          className="flex items-center gap-1.5 rounded-lg bg-gold-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-gold-700 disabled:cursor-not-allowed disabled:opacity-50">
          <CheckCheck size={14} /> {p.approveAllLabel}
        </button>
      )}
    </div>
  );
}

function SelectionBar({ count, busy, onApprove, onClear }: { count: number; busy: boolean; onApprove: () => void; onClear: () => void }) {
  if (count === 0) return null;
  return (
    <div className="sticky bottom-0 z-10 flex items-center justify-between gap-2 rounded-xl border border-gold-300 bg-white/95 px-3 py-2 shadow-lg backdrop-blur dark:border-gold-700 dark:bg-gray-900/95">
      <button type="button" onClick={onClear} className="text-[12px] font-semibold text-gray-500 hover:text-gray-800 dark:hover:text-gray-200">Limpar seleção</button>
      <button type="button" onClick={onApprove} disabled={busy}
        className="flex items-center gap-1.5 rounded-lg bg-gold-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-gold-700 disabled:opacity-60">
        {busy ? <Loader2 size={13} className="animate-spin" /> : <CheckCheck size={13} />} Aprovar selecionados ({count})
      </button>
    </div>
  );
}

// ─── Estado ──────────────────────────────────────────────────────────────────

function useIdSet() {
  const [ids, setIds] = useState<Set<number>>(() => new Set());
  const toggle = useCallback((id: number) => setIds((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  }), []);
  const set = useCallback((id: number, on: boolean) => setIds((prev) => {
    if (prev.has(id) === on) return prev;
    const next = new Set(prev);
    if (on) next.add(id); else next.delete(id);
    return next;
  }), []);
  const clear = useCallback(() => setIds((prev) => (prev.size ? new Set() : prev)), []);
  return { ids, toggle, set, clear };
}

interface BulkDeps {
  onToast: (t: ToastState) => void;
  after: () => void;
}

function useBulkApprove({ onToast, after }: BulkDeps) {
  const [busy, setBusy] = useState(false);
  const run = async (req: ApproveAllRequest) => {
    setBusy(true);
    try {
      const res = await api.approveAll(req);
      onToast({ kind: 'success', message: approveAllResultText(res) });
    } catch (err) {
      onToast({ kind: 'error', message: errorMessage(err) });
    } finally {
      setBusy(false);
      after();
    }
  };
  return { busy, run };
}

// ─── Lista ───────────────────────────────────────────────────────────────────

export interface QueueListProps {
  overview: FollowUpOverview;
  tab: QueueTab;
  onTabChange: (t: QueueTab) => void;
  step: FollowUpStep | null;
  onStepChange: (s: FollowUpStep | null) => void;
  dealId: number | null;
  onClearDeal: () => void;
  gap: { min: number; max: number } | null;
  onOpenDeal: (dealId: number) => void;
  onToast: (t: ToastState) => void;
  onOverviewChanged: () => void;
}

function bulkCountFor(o: FollowUpOverview, step: FollowUpStep | null): number {
  if (!step) return o.counts.draft;
  return o.counts.draft_by_step?.[step] ?? 0;
}

function approveAllBlockReason(o: FollowUpOverview, count: number): string | null {
  if (!o.enabled) return 'Ligue os follow-ups da IA antes de aprovar.';
  if (count === 0) return 'Nenhum rascunho para aprovar.';
  return null;
}

export function QueueList(p: QueueListProps) {
  const { overview, tab, step, dealId } = p;
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search, 300);
  const editing = useIdSet();
  const selection = useIdSet();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const draftStep = tab === 'draft' ? step : null;
  const queue = useFollowUpQueue({ status: tab, step: draftStep, stageId: null, dealId, search: debounced }, editing.ids.size > 0);

  const { clear: clearSelection } = selection;
  useEffect(() => { clearSelection(); }, [tab, draftStep, dealId, debounced, clearSelection]);

  const refreshAll = () => { void queue.refresh(); p.onOverviewChanged(); };
  const bulk = useBulkApprove({ onToast: p.onToast, after: () => { selection.clear(); refreshAll(); } });

  const onChanged = (item: FollowUpDraftItem) => {
    if (TAB_STATUSES[tab].includes(item.status)) queue.replaceLocal(item); else queue.removeLocal(item.id);
    refreshAll();
  };

  const filtered = !!debounced.trim() || dealId !== null;
  const bulkCount = bulkCountFor(overview, draftStep);
  const generatedBefore = queue.serverTime ?? overview.server_time;
  const canBulk = tab === 'draft' && overview.can_approve;
  const selectable = canBulk && overview.enabled;
  const confirmText = useMemo(() => approveAllConfirmText({
    count: bulkCount, step: draftStep, effectiveCap: overview.sending.effective_cap,
    remainingToday: overview.sending.remaining, gap: p.gap,
  }), [bulkCount, draftStep, overview.sending.effective_cap, overview.sending.remaining, p.gap]);

  return (
    <section className="space-y-3">
      <QueueTabs tab={tab} overview={overview} onChange={p.onTabChange} />
      {tab === 'draft' && <StepChips step={step} overview={overview} onChange={p.onStepChange} />}
      <QueueToolbar search={search} onSearch={setSearch} dealId={dealId} onClearDeal={p.onClearDeal}
        showApproveAll={canBulk && !filtered}
        approveAllLabel={draftStep ? `Aprovar todos do passo ${draftStep}` : 'Aprovar todos'}
        approveAllBlocked={approveAllBlockReason(overview, bulkCount)} onApproveAll={() => setConfirmOpen(true)} />
      <QueueBody p={p} queue={queue} emptyMessage={emptyText(tab, draftStep, filtered, overview)}
        selectable={selectable} selected={selection.ids} onToggleSelect={selection.toggle}
        onChanged={onChanged} onConflict={refreshAll} onEditingChange={editing.set} />
      <SelectionBar count={selection.ids.size} busy={bulk.busy} onClear={selection.clear}
        onApprove={() => void bulk.run({ generated_before: generatedBefore, ids: [...selection.ids] })} />
      <ConfirmModal open={confirmOpen} title="Aprovar follow-ups" message={confirmText} confirmText="Aprovar"
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => { setConfirmOpen(false); void bulk.run({ generated_before: generatedBefore, ...(draftStep ? { step: draftStep } : {}) }); }} />
    </section>
  );
}

type QueueState = ReturnType<typeof useFollowUpQueue>;

interface BodyProps {
  p: QueueListProps;
  queue: QueueState;
  emptyMessage: string;
  selectable: boolean;
  selected: Set<number>;
  onToggleSelect: (id: number) => void;
  onChanged: (item: FollowUpDraftItem) => void;
  onConflict: () => void;
  onEditingChange: (id: number, editing: boolean) => void;
}

function QueueBody({ p, queue, emptyMessage, selectable, selected, onToggleSelect, onChanged, onConflict, onEditingChange }: BodyProps) {
  if (queue.error && queue.items.length === 0) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-[12px] text-red-700 dark:border-red-800/60 dark:bg-red-950/30 dark:text-red-300">
        <p>{NETWORK_ERROR_TEXT}</p>
        <button type="button" onClick={() => void queue.refresh()} className="mt-2 font-bold underline">Tentar de novo</button>
      </div>
    );
  }
  if (queue.isLoading && queue.items.length === 0) {
    return <div className="flex justify-center py-10 text-gray-400"><Loader2 size={20} className="animate-spin" /></div>;
  }
  if (queue.items.length === 0) {
    return <p className="rounded-xl border border-dashed border-gray-200 p-6 text-center text-[13px] text-gray-500 dark:border-gray-700 dark:text-gray-400">{emptyMessage}</p>;
  }
  return (
    <div className="space-y-3">
      {queue.items.map((item) => (
        <DraftCard key={item.id} item={item} canApprove={p.overview.can_approve} enabled={p.overview.enabled}
          selectable={selectable} selected={selected.has(item.id)} onToggleSelect={onToggleSelect}
          onChanged={onChanged} onConflict={onConflict} onOpenDeal={p.onOpenDeal}
          onEditingChange={onEditingChange} onToast={p.onToast} />
      ))}
      {queue.hasMore && (
        <button type="button" onClick={() => void queue.loadMore()} disabled={queue.isValidating}
          className="w-full rounded-xl border border-gray-200 py-2 text-[12px] font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-60 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800">
          Carregar mais
        </button>
      )}
    </div>
  );
}

import { useState, type ReactNode } from 'react';
import { Clock3, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import type { Deal, PipelineStage } from '../../types';
import { cn } from '../../utils/cn';
import { api, errorMessage, errorStatus } from './api';
import { formatDayTime } from './format';
import { useDealFollowUp } from './hooks';
import {
  CHANNEL_LABELS, CHANNEL_RULE_TEXT, MIGRATION_REQUIRED_TEXT, STEP_LABELS, TONE_CLASSES, lastErrorText, statusLabel,
  type Tone,
} from './labels';
import type { DealFollowUpState, FollowUpDraftItem } from './types';

interface Props {
  deal: Deal;
  stage?: PipelineStage;
  onOpenQueue: () => void;
  onConfigure: () => void;
}

// Sem acesso (produção restrita) ou negócio fora do escopo: o card some em silêncio.
const HIDDEN_STATUSES = new Set([401, 403, 404]);
const CANCELLABLE = new Set(['draft', 'approved', 'blocked']);

interface Line { key: string; tone: Tone; text: string }

function stateLines(s: DealFollowUpState, stageName: string): Line[] {
  if (s.opted_out) return [{ key: 'optout', tone: 'slate', text: 'Contato marcado como não contatar' }];
  if (!s.configured) return [{ key: 'config', tone: 'slate', text: 'Os follow-ups da IA ainda não foram configurados nesta conta.' }];
  const lines: Line[] = [];
  if (!s.enabled) lines.push({ key: 'off', tone: 'slate', text: 'Follow-ups da IA desligados nesta conta. Os rascunhos ficam só como teste.' });
  if (s.stage_role === 'outside') lines.push({ key: 'outside', tone: 'slate', text: `Esta etapa${stageName ? ` (${stageName})` : ''} não faz parte da cadência` });
  if (s.stage_role === 'after_last') lines.push({ key: 'after', tone: 'slate', text: 'Este card já passou por todos os passos da cadência.' });
  return lines;
}

const ACTIVE_TEXT: Record<string, (i: FollowUpDraftItem) => string> = {
  draft: (i) => `Cadência da IA: ${STEP_LABELS[i.step]} · rascunho aguardando aprovação`,
  approved: () => 'Aprovado, sai em horário comercial',
  sending: () => 'Enviando agora',
  blocked: (i) => `Bloqueado: ${lastErrorText(i.last_error) || 'veja o motivo na fila'}`,
};

const ACTIVE_TONES: Record<string, Tone> = { draft: 'gold', approved: 'blue', sending: 'amber', blocked: 'red' };

function activeText(i: FollowUpDraftItem): string {
  const fn = ACTIVE_TEXT[i.status];
  return fn ? fn(i) : `${STEP_LABELS[i.step]} · ${statusLabel(i.status).label}`;
}

function lastText(i: FollowUpDraftItem): string {
  if (i.status === 'sent' && i.sent_at) {
    const channel = i.channel_used ? ` pelo ${CHANNEL_LABELS[i.channel_used]}` : '';
    return `Último follow-up: enviado em ${formatDayTime(i.sent_at)}${channel}`;
  }
  const reason = lastErrorText(i.last_error);
  return `Último follow-up: ${statusLabel(i.status).label}${reason ? ` (${reason})` : ''}`;
}

function lastToShow(s: DealFollowUpState): FollowUpDraftItem | null {
  if (!s.last || s.last.id === s.active?.id) return null;
  return s.last;
}

function nextEligible(s: DealFollowUpState): string | null {
  if (s.active || s.opted_out || s.stage_role !== 'step') return null;
  return s.next_eligible_at;
}

function useCancel(onDone: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await work();
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

function CancelButton({ busy, onClick }: { busy: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} disabled={busy}
      className="flex-shrink-0 rounded-lg border border-current/20 px-2.5 py-1.5 text-[10px] font-bold hover:bg-white/40 disabled:opacity-50 dark:hover:bg-black/10">
      {busy ? 'Cancelando...' : 'Cancelar envio'}
    </button>
  );
}

function ActiveBlock({ item, busy, onCancel, onOpenQueue }: { item: FollowUpDraftItem; busy: boolean; onCancel: () => void; onOpenQueue: () => void }) {
  return (
    <div className={cn('rounded-xl border px-3 py-2.5', TONE_CLASSES[ACTIVE_TONES[item.status] ?? 'slate'])}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-bold">{activeText(item)}</p>
          {item.text && <p className="mt-1.5 line-clamp-2 rounded-lg bg-white/45 px-2.5 py-1.5 text-[10px] italic dark:bg-black/10">{item.text}</p>}
          <button type="button" onClick={onOpenQueue} className="mt-1.5 text-[11px] font-bold underline-offset-2 hover:underline">Revisar na fila</button>
        </div>
        {CANCELLABLE.has(item.status) && <CancelButton busy={busy} onClick={onCancel} />}
      </div>
    </div>
  );
}

function LegacyBlock({ task, busy, onCancel }: { task: NonNullable<DealFollowUpState['legacy_pending']>; busy: boolean; onCancel: () => void }) {
  return (
    <div className={cn('rounded-xl border px-3 py-2.5', TONE_CLASSES.blue)}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold">Mensagem fixa da etapa (automação antiga)</p>
          <p className="mt-1 flex items-center gap-1.5 text-[11px]"><Clock3 size={12} />Programada para {formatDayTime(task.scheduled_at) || '-'}</p>
        </div>
        {task.status === 'pending' && <CancelButton busy={busy} onClick={onCancel} />}
      </div>
    </div>
  );
}

function CardShell({ loading, onRefresh, onConfigure, children }: { loading: boolean; onRefresh: () => void; onConfigure: () => void; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800/45">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-gold-500/15 text-gold-700 dark:text-gold-300"><Sparkles size={17} /></span>
          <div>
            <h3 className="text-sm font-semibold text-gray-950 dark:text-white">Follow-up da IA</h3>
            <p className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">Retomada automática quando o cliente para de responder.</p>
          </div>
        </div>
        <button type="button" onClick={onRefresh} disabled={loading} title="Atualizar estado"
          className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-50 dark:hover:bg-gray-800 dark:hover:text-gray-200">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>
      <div className="mt-3 space-y-2">{children}</div>
      <div className="mt-3 flex flex-col gap-2 border-t border-gray-100 pt-3 dark:border-gray-700 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[10px] leading-relaxed text-gray-500 dark:text-gray-400">{CHANNEL_RULE_TEXT}</p>
        <button type="button" onClick={onConfigure} className="flex-shrink-0 text-left text-[11px] font-semibold text-gold-700 hover:text-gold-600 dark:text-gold-400 dark:hover:text-gold-300">
          Configurar follow-ups →
        </button>
      </div>
    </section>
  );
}

function StateBody({ state, stageName, onOpenQueue, onCancelTask, onCancelLegacy, busy, error }: {
  state: DealFollowUpState; stageName: string; onOpenQueue: () => void;
  onCancelTask: (id: number) => void; onCancelLegacy: () => void; busy: boolean; error: string;
}) {
  const active = state.active;
  const last = lastToShow(state);
  const next = nextEligible(state);
  return (
    <>
      {stateLines(state, stageName).map((l) => (
        <p key={l.key} className={cn('rounded-xl border px-3 py-2 text-[11px] font-semibold', TONE_CLASSES[l.tone])}>{l.text}</p>
      ))}
      {active && <ActiveBlock item={active} busy={busy} onCancel={() => onCancelTask(active.id)} onOpenQueue={onOpenQueue} />}
      {last && <p className="text-[11px] text-gray-600 dark:text-gray-300">{lastText(last)}</p>}
      {next && (
        <p className="flex items-center gap-1.5 text-[11px] text-gray-600 dark:text-gray-300">
          <Clock3 size={12} />Próximo follow-up a partir de {formatDayTime(next)}, se o cliente continuar calado
        </p>
      )}
      {state.legacy_pending && <LegacyBlock task={state.legacy_pending} busy={busy} onCancel={onCancelLegacy} />}
      {error && <p className="text-[11px] font-semibold text-red-600 dark:text-red-400">{error}</p>}
    </>
  );
}

function ErrorBody({ error }: { error: unknown }) {
  const text = errorStatus(error) === 503
    ? MIGRATION_REQUIRED_TEXT
    : 'Não foi possível consultar os follow-ups agora. Isso não confirma nem cancela um envio.';
  return <p className={cn('rounded-xl border px-3 py-2 text-[11px]', TONE_CLASSES.slate)}>{text}</p>;
}

export function DealFollowUpCard({ deal, stage, onOpenQueue, onConfigure }: Props) {
  const { data, error, isValidating, mutate } = useDealFollowUp(deal?.id);
  const cancel = useCancel(() => { void mutate(); });
  const status = errorStatus(error);
  if (status !== null && HIDDEN_STATUSES.has(status)) return null;
  if (!deal) return null;

  const refresh = () => { void mutate(); };
  return (
    <CardShell loading={isValidating} onRefresh={refresh} onConfigure={onConfigure}>
      {data
        ? <StateBody state={data} stageName={stage?.name ?? ''} onOpenQueue={onOpenQueue} busy={cancel.busy} error={cancel.error}
            onCancelTask={(id) => void cancel.run(() => api.skip(id, 'step'))}
            onCancelLegacy={() => void cancel.run(() => api.cancelLegacyPending(deal.id))} />
        : error ? <ErrorBody error={error} /> : <div className="flex justify-center py-3"><Loader2 size={16} className="animate-spin text-gray-400" /></div>}
    </CardShell>
  );
}

import { Loader2 } from 'lucide-react';
import { cn } from '../../utils/cn';
import { formatSweepMoment, relativeFromNow } from './format';
import type { FollowUpOverview, QueueTab, SweepState } from './types';

interface Chip {
  key: string;
  label: string;
  tab: QueueTab | null;
  value: (o: FollowUpOverview) => string;
}

const CHIPS: Chip[] = [
  { key: 'draft', label: 'Para aprovar', tab: 'draft', value: (o) => String(o.counts.draft) },
  { key: 'approved', label: 'Na fila de envio', tab: 'approved', value: (o) => String(o.counts.approved + o.counts.sending) },
  { key: 'blocked', label: 'Com problema', tab: 'blocked', value: (o) => String(o.counts.blocked + o.counts.failed_7d) },
  { key: 'sent_today', label: 'Enviados hoje', tab: 'sent_today', value: (o) => `${o.sending.sent_today}/${o.sending.effective_cap}` },
  { key: 'optouts', label: 'Não contatar', tab: null, value: (o) => String(o.counts.optouts) },
];

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function summaryText(sweep: SweepState): string | null {
  const s = sweep.last_summary;
  const at = s?.finished_at ?? sweep.finished_at;
  if (!s || !at) return null;
  const parts = [`Última leitura das conversas: ${formatSweepMoment(at)}`, plural(s.generated, 'rascunho', 'rascunhos')];
  if (s.ai_skipped > 0) parts.push(`${s.ai_skipped} a IA achou melhor não mandar`);
  if (s.errors > 0) parts.push(plural(s.errors, 'erro', 'erros'));
  return parts.join(' · ');
}

function SweepLine({ sweep, enabled }: { sweep: SweepState; enabled: boolean }) {
  if (sweep.running) {
    const p = sweep.progress;
    return (
      <p className="flex items-center gap-1.5 text-[11px] text-gold-700 dark:text-gold-300">
        <Loader2 size={12} className="animate-spin" />
        {p ? `Lendo as conversas: ${p.done} de ${p.total}` : 'Lendo as conversas...'}
      </p>
    );
  }
  const text = summaryText(sweep);
  const next = enabled && sweep.next_auto_at ? ` · próxima leitura automática ${relativeFromNow(sweep.next_auto_at)}` : '';
  if (!text) return null;
  return <p className="text-[11px] text-gray-500 dark:text-gray-400">{text}{next}</p>;
}

interface Props {
  overview: FollowUpOverview;
  activeTab: QueueTab;
  onPickTab: (tab: QueueTab) => void;
  onOpenOptOuts: () => void;
}

export function StatsStrip({ overview, activeTab, onPickTab, onOpenOptOuts }: Props) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {CHIPS.map((chip) => (
          <button key={chip.key} type="button" onClick={() => (chip.tab ? onPickTab(chip.tab) : onOpenOptOuts())}
            className={cn(
              'rounded-xl border px-3 py-2 text-left transition-colors',
              chip.tab === activeTab
                ? 'border-gold-300 bg-gold-50 dark:border-gold-700 dark:bg-gold-900/30'
                : 'border-gray-200 bg-white hover:border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:hover:border-gray-600',
            )}>
            <span className="block text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{chip.label}</span>
            <span className="block text-lg font-bold text-gray-900 dark:text-white">{chip.value(overview)}</span>
          </button>
        ))}
      </div>
      <SweepLine sweep={overview.sweep} enabled={overview.enabled} />
    </div>
  );
}

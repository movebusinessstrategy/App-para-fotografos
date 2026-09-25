import type { ComponentType, ReactNode } from 'react';
import { CalendarClock, Hand, MessageCircleReply, Send, TrendingUp } from 'lucide-react';
import { cn } from '../../utils/cn';
import { drainText, nextSendText, plural } from './DashboardFormat';
import type { FollowUpDashboardKpis, FollowUpOverview, QueueTab } from './types';

// Faixa de números do Painel. Cada card responde uma pergunta curta do dono.

type Icon = ComponentType<{ size?: number; className?: string }>;

interface CardProps {
  icon: Icon;
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  highlight?: boolean;
  className?: string;
  onClick?: () => void;
  children?: ReactNode;
}

const CARD_BASE = 'rounded-2xl border p-3 text-left transition-colors';
const CARD_IDLE = 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800';
const CARD_ALERT = 'border-amber-300 bg-amber-50 dark:border-amber-700/70 dark:bg-amber-950/30';
const CARD_CLICK = 'hover:border-gold-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 dark:hover:border-gold-700';

function KpiCard({ icon: Icon, label, value, hint, highlight, className, onClick, children }: CardProps) {
  const classes = cn(CARD_BASE, highlight ? CARD_ALERT : CARD_IDLE, onClick && CARD_CLICK, className);
  const body = (
    <>
      <span className={cn('flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide',
        highlight ? 'text-amber-700 dark:text-amber-300' : 'text-gray-500 dark:text-gray-400')}>
        <Icon size={13} /> {label}
      </span>
      <span className="mt-1 block text-xl font-bold leading-tight text-gray-900 dark:text-white">{value}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] leading-snug text-gray-500 dark:text-gray-400">{hint}</span>}
    </>
  );
  if (!onClick) return <div className={classes}>{body}</div>;
  return <button type="button" onClick={onClick} className={classes}>{body}</button>;
}

function ProgressBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <span className="mt-2 block h-1.5 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700" role="progressbar"
      aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}>
      <span className={cn('block h-full rounded-full', pct >= 100 ? 'bg-emerald-500' : 'bg-gold-500')} style={{ width: `${pct}%` }} />
    </span>
  );
}

interface NextCtx { kpis: FollowUpDashboardKpis; overview: FollowUpOverview; now: Date; tz: string }

// Primeira regra que casar diz o que mostrar embaixo do "Enviados hoje".
const NEXT_SEND_RULES: Array<(c: NextCtx) => string | null> = [
  (c) => (c.overview.enabled ? null : 'Envios desligados'),
  (c) => (c.overview.sending.paused_reason === 'manual' || c.overview.sending.paused_reason === 'error_streak' ? 'Envios pausados' : null),
  (c) => (c.kpis.next_send_at ? `Próximo envio ${nextSendText(c.kpis.next_send_at, c.now, c.tz)}` : null),
  (c) => (c.kpis.scheduled === 0 ? 'Nada na fila de envio' : null),
];

function nextSendLine(c: NextCtx): string {
  for (const rule of NEXT_SEND_RULES) {
    const text = rule(c);
    if (text) return text;
  }
  return 'Sem previsão de envio agora';
}

function needsYouHint(k: FollowUpDashboardKpis): string {
  if (k.needs_you === 0) return 'Ninguém esperando o estúdio';
  const parts = [plural(k.waiting_studio, 'cliente esperando', 'clientes esperando')];
  if (k.blocked > 0) parts.push(plural(k.blocked, 'com problema', 'com problema'));
  return parts.join(' · ');
}

function scheduledHint(k: FollowUpDashboardKpis): string {
  const parts = [drainText(k.days_to_drain) || 'Nada na fila de envio'];
  if (k.drafts > 0) parts.push(plural(k.drafts, 'rascunho para aprovar', 'rascunhos para aprovar'));
  return parts.join(' · ');
}

export interface DashboardKpisProps {
  kpis: FollowUpDashboardKpis;
  overview: FollowUpOverview;
  now: Date;
  tz: string;
  onOpenQueue: (tab: QueueTab) => void;
  onJumpToNeedsYou: () => void;
}

export function DashboardKpis({ kpis, overview, now, tz, onOpenQueue, onJumpToNeedsYou }: DashboardKpisProps) {
  const replyHint = kpis.sent_7d > 0 ? `${kpis.replied_7d} de ${kpis.sent_7d} enviados` : 'Nenhum envio nos últimos 7 dias';
  return (
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
      <KpiCard icon={Send} label="Enviados hoje" className="col-span-2 lg:col-span-1" onClick={() => onOpenQueue('sent_today')}
        value={<>{kpis.sent_today}<span className="text-[13px] font-semibold text-gray-400"> de {kpis.effective_cap}</span></>}
        hint={nextSendLine({ kpis, overview, now, tz })}>
        <ProgressBar value={kpis.sent_today} max={kpis.effective_cap} />
      </KpiCard>
      <KpiCard icon={CalendarClock} label="Programados" value={kpis.scheduled} hint={scheduledHint(kpis)}
        onClick={() => onOpenQueue('approved')} />
      <KpiCard icon={MessageCircleReply} label="Responderam (7 dias)" value={`${kpis.reply_rate_7d}%`} hint={replyHint} />
      <KpiCard icon={TrendingUp} label="Avançaram no funil" value={kpis.advanced_14d}
        hint="Ganhos ou convertidos depois de um follow-up, nos últimos 14 dias" />
      <KpiCard icon={Hand} label="Precisam de você" value={kpis.needs_you} highlight={kpis.needs_you > 0}
        hint={needsYouHint(kpis)} onClick={onJumpToNeedsYou} />
    </div>
  );
}

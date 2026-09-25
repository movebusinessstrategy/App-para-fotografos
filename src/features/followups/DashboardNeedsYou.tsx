import type { RefObject } from 'react';
import { ChevronRight, CircleCheck, Hand, TriangleAlert } from 'lucide-react';
import { cn } from '../../utils/cn';
import { plural, waitingLabel } from './DashboardFormat';
import type { FollowUpDashboardKpis, FollowUpDashboardWaiting, QueueTab } from './types';

// Clientes que falaram por último há mais de 2 horas e ainda esperam o estúdio, mais o
// atalho para os follow-ups com problema. Clicar abre o negócio.

interface RowProps { item: FollowUpDashboardWaiting; now: Date; tz: string; onOpenDeal: (dealId: number) => void }

function WaitingRow({ item, now, tz, onOpenDeal }: RowProps) {
  return (
    <li>
      <button type="button" onClick={() => onOpenDeal(item.deal_id)}
        className="flex w-full items-start gap-2 rounded-xl px-2 py-2 text-left transition-colors hover:bg-amber-100/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 dark:hover:bg-amber-900/20">
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className="truncate text-[12px] font-semibold text-gray-900 dark:text-white">{item.contact_name || 'Sem nome'}</span>
            <span className="shrink-0 text-[11px] font-semibold text-amber-700 dark:text-amber-300">
              {waitingLabel(item.last_customer_at, now, tz)}
            </span>
          </span>
          <span className="block truncate text-[11px] text-gray-500 dark:text-gray-400">{item.stage_name || 'Sem etapa'}</span>
          {item.preview && <span className="mt-0.5 block line-clamp-2 text-[11px] italic text-gray-600 dark:text-gray-300">{item.preview}</span>}
        </span>
        <ChevronRight size={14} className="mt-1 shrink-0 text-gray-400" />
      </button>
    </li>
  );
}

export interface DashboardNeedsYouProps {
  items: FollowUpDashboardWaiting[];
  kpis: FollowUpDashboardKpis;
  now: Date;
  tz: string;
  sectionRef?: RefObject<HTMLElement | null>;
  onOpenDeal: (dealId: number) => void;
  onOpenQueue: (tab: QueueTab) => void;
}

export function DashboardNeedsYou({ items, kpis, now, tz, sectionRef, onOpenDeal, onOpenQueue }: DashboardNeedsYouProps) {
  const busy = kpis.needs_you > 0;
  const more = Math.max(0, kpis.waiting_studio - items.length);
  return (
    <section ref={sectionRef} tabIndex={-1} aria-label="Precisam de você"
      className={cn('scroll-mt-4 rounded-2xl border p-3 outline-none sm:p-4',
        busy ? 'border-amber-300 bg-amber-50/70 dark:border-amber-700/70 dark:bg-amber-950/20' : 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800')}>
      <h3 className="flex items-center gap-1.5 text-[13px] font-bold text-gray-900 dark:text-white">
        <Hand size={14} className={busy ? 'text-amber-600' : 'text-gray-400'} /> Precisam de você
      </h3>
      <p className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">
        Clientes que mandaram a última mensagem há mais de 2 horas e ainda não tiveram resposta.
      </p>
      {items.length === 0 ? (
        <p className="mt-3 flex items-center gap-1.5 text-[12px] text-emerald-700 dark:text-emerald-300">
          <CircleCheck size={14} /> Ninguém esperando resposta. Tudo em dia.
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-amber-200/70 dark:divide-amber-900/40">
          {items.map((item) => <WaitingRow key={item.deal_id} item={item} now={now} tz={tz} onOpenDeal={onOpenDeal} />)}
        </ul>
      )}
      {more > 0 && <p className="mt-2 text-[11px] text-gray-500 dark:text-gray-400">E mais {plural(more, 'cliente esperando', 'clientes esperando')}.</p>}
      {kpis.blocked > 0 && (
        <button type="button" onClick={() => onOpenQueue('blocked')}
          className="mt-3 flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-[12px] font-semibold text-red-700 hover:bg-red-100 dark:border-red-800/60 dark:bg-red-950/30 dark:text-red-300">
          <TriangleAlert size={13} /> {plural(kpis.blocked, 'follow-up com problema', 'follow-ups com problema')}. Ver na Fila
        </button>
      )}
    </section>
  );
}

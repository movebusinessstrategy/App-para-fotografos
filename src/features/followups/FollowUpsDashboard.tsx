import { useRef } from 'react';
import { RefreshCw, SquareKanban } from 'lucide-react';
import { cn } from '../../utils/cn';
import { errorStatus } from './api';
import { momentLabel } from './DashboardFormat';
import { DashboardKpis } from './DashboardKpis';
import { DashboardNeedsYou } from './DashboardNeedsYou';
import { useFollowUpDashboard } from './hooks';
import { KanbanBoard } from './KanbanBoard';
import type { FollowUpDashboard, FollowUpOverview, QueueTab } from './types';

// Painel dos follow-ups: números no topo, o quadro do fluxo (Follow 01, 02, 03, Respondeu,
// Encerrado) e quem precisa de resposta do estúdio. Atualiza sozinho a cada 30s.

const LOAD_ERROR_TEXT = 'Não foi possível carregar o painel agora. Nada foi enviado nem cancelado por isso.';
const STALE_TEXT = 'Não foi possível atualizar agora. Mostrando os últimos dados.';

interface Props {
  overview: FollowUpOverview;
  onOpenDeal: (dealId: number) => void;
  onOpenQueue: (tab: QueueTab) => void;
}

function DashboardSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Carregando o painel">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className={cn('h-24 animate-pulse rounded-2xl bg-gray-200/70 dark:bg-gray-800', i === 0 && 'col-span-2 lg:col-span-1')} />
        ))}
      </div>
      <div className="h-[34rem] animate-pulse rounded-2xl bg-gray-200/70 dark:bg-gray-800" />
    </div>
  );
}

function DashboardError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const text = errorStatus(error) === 403 ? 'Você não tem acesso aos follow-ups.' : LOAD_ERROR_TEXT;
  return (
    <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-[12px] text-red-700 dark:border-red-800/60 dark:bg-red-950/30 dark:text-red-300">
      <p>{text}</p>
      <button type="button" onClick={onRetry} className="mt-2 font-bold underline-offset-2 hover:underline">Tentar de novo</button>
    </div>
  );
}

interface BoardCardProps { data: FollowUpDashboard; now: Date; refreshing: boolean; stale: boolean; onRefresh: () => void; onOpenDeal: (id: number) => void }

function BoardCard({ data, now, refreshing, stale, onRefresh, onOpenDeal }: BoardCardProps) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800 sm:p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="flex items-center gap-1.5 text-[13px] font-bold text-gray-900 dark:text-white">
            <SquareKanban size={14} className="text-gold-600" /> Fluxo dos follow-ups
          </h3>
          <p className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">
            Cada negócio aparece uma vez, no passo do último follow-up. Clique no card para abrir o negócio.
          </p>
          {stale && <p className="mt-1 text-[11px] font-semibold text-amber-700 dark:text-amber-300">{STALE_TEXT}</p>}
        </div>
        <button type="button" onClick={onRefresh} title="Atualizar agora"
          className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-100">
          <RefreshCw size={12} className={cn(refreshing && 'animate-spin')} /> Atualizado às {momentLabel(data.server_time, now, data.tz)}
        </button>
      </div>
      <KanbanBoard columns={data.board.columns} now={now} tz={data.tz} onOpenDeal={onOpenDeal} />
    </section>
  );
}

export function FollowUpsDashboard({ overview, onOpenDeal, onOpenQueue }: Props) {
  const { data, error, isValidating, mutate } = useFollowUpDashboard();
  const needsYouRef = useRef<HTMLElement | null>(null);
  const refresh = () => { void mutate(); };

  if (!data) return error ? <DashboardError error={error} onRetry={refresh} /> : <DashboardSkeleton />;

  const now = new Date();
  const jumpToNeedsYou = () => {
    needsYouRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    needsYouRef.current?.focus({ preventScroll: true });
  };
  return (
    <div className="space-y-3">
      <DashboardKpis kpis={data.kpis} overview={overview} now={now} tz={data.tz} onOpenQueue={onOpenQueue} onJumpToNeedsYou={jumpToNeedsYou} />
      <BoardCard data={data} now={now} refreshing={isValidating} stale={!!error} onRefresh={refresh} onOpenDeal={onOpenDeal} />
      <DashboardNeedsYou items={data.needs_you_list} kpis={data.kpis} now={now} tz={data.tz} sectionRef={needsYouRef}
        onOpenDeal={onOpenDeal} onOpenQueue={onOpenQueue} />
    </div>
  );
}

import type { ComponentType } from 'react';
import {
  Ban, Check, CheckCheck, Clock3, Loader2, MessageCircleReply, PenLine, Send, TriangleAlert,
} from 'lucide-react';
import { cn } from '../../utils/cn';
import { COLUMN_EMPTY_TEXT, DELIVERY_LABELS, chipView, type ChipView } from './DashboardFormat';
import { TONE_CLASSES } from './labels';
import type { KanbanCard, KanbanChip, KanbanColumn, KanbanColumnKey } from './types';

// Quadro do fluxo: cada negócio uma vez, na coluna do último follow-up. Colunas com altura
// fixa e rolagem própria; no celular o quadro rola para o lado.

type Icon = ComponentType<{ size?: number; className?: string }>;

const COLUMN_DOT: Record<KanbanColumnKey, string> = {
  follow_1: 'bg-gold-300',
  follow_2: 'bg-gold-500',
  follow_3: 'bg-gold-700',
  replied: 'bg-emerald-500',
  closed: 'bg-gray-400',
};

const CHIP_ICONS: Record<KanbanChip, Icon> = {
  queued: Clock3,
  sending: Send,
  draft: PenLine,
  sent: Check,
  problem: TriangleAlert,
  replied: MessageCircleReply,
  closed: Ban,
};

// Entregue e lido usam o duplo check; lido fica azul como no WhatsApp.
// Falha de entrega já aparece no texto do chip ("Não entregue"), sem ícone extra.
function DeliveryIcon({ card }: { card: KanbanCard }) {
  if (card.chip !== 'sent' || !card.delivery || card.delivery === 'failed') return null;
  const label = DELIVERY_LABELS[card.delivery];
  if (card.delivery === 'sent') return <Check size={12} className="mt-px shrink-0 text-gray-400" aria-label={label} />;
  return <CheckCheck size={12} className={cn('mt-px shrink-0', card.delivery === 'read' ? 'text-sky-500' : 'text-gray-400')} aria-label={label} />;
}

// Em coluna estreita o texto quebra dentro do chip em vez de sumir.
function Chip({ card, view }: { card: KanbanCard; view: ChipView }) {
  const Icon = CHIP_ICONS[card.chip] ?? Clock3;
  const spinning = card.chip === 'sending';
  return (
    <span title={view.title ?? undefined}
      className={cn('inline-flex max-w-full items-start gap-1 rounded-lg border px-1.5 py-0.5 text-[10px] font-semibold leading-snug', TONE_CLASSES[view.tone])}>
      {spinning ? <Loader2 size={11} className="mt-px shrink-0 animate-spin" /> : <Icon size={11} className="mt-px shrink-0" />}
      <span className="min-w-0 break-words">{view.text}</span>
      <DeliveryIcon card={card} />
    </span>
  );
}

interface CardProps { card: KanbanCard; now: Date; tz: string; onOpen: (dealId: number) => void }

function KanbanCardView({ card, now, tz, onOpen }: CardProps) {
  const view = chipView(card, now, tz);
  return (
    <button type="button" onClick={() => onOpen(card.deal_id)}
      className="w-full rounded-xl border border-gray-200 bg-white p-2.5 text-left shadow-sm transition-colors hover:border-gold-300 hover:shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 dark:border-gray-700 dark:bg-gray-800 dark:hover:border-gold-700">
      <div className="flex items-start justify-between gap-1.5">
        <p className="min-w-0 truncate text-[12px] font-semibold text-gray-900 dark:text-white">{card.contact_name || 'Sem nome'}</p>
        {card.step === 4 && (
          <span className="shrink-0 rounded bg-gray-100 px-1 text-[9px] font-bold uppercase text-gray-500 dark:bg-gray-700 dark:text-gray-300">Passo 4</span>
        )}
      </div>
      <p className="truncate text-[11px] text-gray-500 dark:text-gray-400">{card.stage_name || 'Sem etapa'}</p>
      {card.track === 'pre_quote' && (
        <span className="mt-1 inline-block rounded-full bg-blue-50 px-1.5 py-0.5 text-[9px] font-semibold text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
          Antes do orçamento
        </span>
      )}
      <div className="mt-1.5"><Chip card={card} view={view} /></div>
      {card.reply_preview && (
        <p className="mt-1.5 line-clamp-2 rounded-lg bg-emerald-50/70 px-2 py-1 text-[11px] text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
          {card.reply_preview}
        </p>
      )}
    </button>
  );
}

interface ColumnProps { column: KanbanColumn; now: Date; tz: string; onOpenDeal: (dealId: number) => void }

function KanbanColumnView({ column, now, tz, onOpenDeal }: ColumnProps) {
  const hidden = Math.max(0, column.count - column.cards.length);
  return (
    <section aria-label={column.label}
      className="flex h-[30rem] min-w-0 flex-col rounded-2xl border border-gray-200 bg-gray-50/80 dark:border-gray-700 dark:bg-gray-900/40">
      <header className="flex items-center justify-between gap-2 border-b border-gray-200 px-3 py-2 dark:border-gray-700">
        <h4 className="flex min-w-0 items-center gap-1.5 truncate text-[12px] font-bold text-gray-800 dark:text-gray-100">
          <span className={cn('h-2 w-2 shrink-0 rounded-full', COLUMN_DOT[column.key])} />
          {column.label}
        </h4>
        <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-bold tabular-nums text-gray-700 shadow-sm dark:bg-gray-800 dark:text-gray-200">
          {column.count}
        </span>
      </header>
      <div className="flex-1 space-y-2 overflow-y-auto p-2">
        {column.cards.length === 0 && (
          <p className="px-2 py-8 text-center text-[11px] text-gray-400 dark:text-gray-500">{COLUMN_EMPTY_TEXT[column.key]}</p>
        )}
        {column.cards.map((card) => (
          <KanbanCardView key={card.deal_id} card={card} now={now} tz={tz} onOpen={onOpenDeal} />
        ))}
        {hidden > 0 && (
          <p className="py-1 text-center text-[11px] font-semibold text-gray-500 dark:text-gray-400" title="Os demais aparecem na aba Fila">
            +{hidden}
          </p>
        )}
      </div>
    </section>
  );
}

export interface KanbanBoardProps { columns: KanbanColumn[]; now: Date; tz: string; onOpenDeal: (dealId: number) => void }

// A largura que vale é a do próprio quadro (a tela de Vendas tem menu lateral): com 56rem
// ou mais as cinco colunas dividem o espaço; abaixo disso cada coluna tem 15rem e o quadro
// rola para o lado.
export function KanbanBoard({ columns, now, tz, onOpenDeal }: KanbanBoardProps) {
  return (
    <div className="@container">
      <div className="-mx-3 overflow-x-auto px-3 pb-1 sm:mx-0 sm:px-0">
        <div className="grid auto-cols-[15rem] grid-flow-col gap-3 @4xl:auto-cols-auto @4xl:grid-flow-row @4xl:grid-cols-5">
          {columns.map((column) => (
            <KanbanColumnView key={column.key} column={column} now={now} tz={tz} onOpenDeal={onOpenDeal} />
          ))}
        </div>
      </div>
    </div>
  );
}

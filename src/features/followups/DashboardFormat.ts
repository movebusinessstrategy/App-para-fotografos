import { DEFAULT_TZ, relativeFromNow } from './format';
import { WEEKDAY_SHORT, lastErrorText, type Tone } from './labels';
import type { DashboardDelivery, KanbanCard, KanbanChip, KanbanClosedReason } from './types';

// Textos e formatação do Painel (testados em DashboardFormat.test.ts). Datas sempre no
// fuso do horário comercial do estúdio, que vem na resposta do painel. Sem travessão.

const DAY_MS = 86_400_000;
const NOW_SLACK_MS = 60_000;

interface Parts { year: number; month: number; day: number; hour: number; minute: string; weekday: number }

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short',
    });
    formatters.set(tz, f);
  }
  return f;
}

function parts(d: Date, tz: string): Parts {
  const map: Record<string, string> = {};
  for (const p of formatterFor(tz).formatToParts(d)) map[p.type] = p.value;
  return {
    year: Number(map.year), month: Number(map.month), day: Number(map.day), hour: Number(map.hour) % 24, minute: map.minute,
    weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(map.weekday),
  };
}

function toDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

// Dias de calendário entre as duas datas, no fuso do estúdio (0 = mesmo dia).
function dayDiff(d: Date, now: Date, tz: string): number {
  const a = parts(d, tz);
  const b = parts(now, tz);
  return Math.round((Date.UTC(a.year, a.month - 1, a.day) - Date.UTC(b.year, b.month - 1, b.day)) / DAY_MS);
}

function clock(p: Parts): string {
  return `${p.hour}:${p.minute}`;
}

// '9h' na hora cheia, '14:32' no resto.
function shortClock(p: Parts): string {
  return p.minute === '00' ? `${p.hour}h` : clock(p);
}

const NEAR_DAYS: Record<number, string> = { [-1]: 'ontem', 0: 'hoje', 1: 'amanhã' };

// 'hoje', 'amanhã', 'ontem', 'sáb' (até 6 dias à frente) ou '28/09'.
function dayWord(d: Date, now: Date, tz: string): string {
  const diff = dayDiff(d, now, tz);
  if (NEAR_DAYS[diff]) return NEAR_DAYS[diff];
  const p = parts(d, tz);
  if (diff > 1 && diff < 7) return WEEKDAY_SHORT[p.weekday] ?? `${pad(p.day)}/${pad(p.month)}`;
  return `${pad(p.day)}/${pad(p.month)}`;
}

function isNowish(d: Date, now: Date): boolean {
  return d.getTime() <= now.getTime() + NOW_SLACK_MS;
}

// Previsão de saída: 'hoje 10:20', 'amanhã 9:05', 'sáb 9:00', '28/09 9:00' ou 'agora'.
export function etaLabel(iso: string | null | undefined, now: Date = new Date(), tz: string = DEFAULT_TZ): string {
  const d = toDate(iso);
  if (!d) return '';
  if (isNowish(d, now)) return 'agora';
  return `${dayWord(d, now, tz)} ${clock(parts(d, tz))}`;
}

// Momento que já passou: '14:02' hoje, 'ontem 14:02' ou '23/09 14:02'.
export function momentLabel(iso: string | null | undefined, now: Date = new Date(), tz: string = DEFAULT_TZ): string {
  const d = toDate(iso);
  if (!d) return '';
  const p = parts(d, tz);
  const diff = dayDiff(d, now, tz);
  if (diff === 0) return clock(p);
  if (diff === -1) return `ontem ${clock(p)}`;
  return `${pad(p.day)}/${pad(p.month)} ${clock(p)}`;
}

// Complemento de "Próximo envio": 'às 14:32', 'amanhã às 9h', 'sáb às 9h', '28/09 às 9h' ou 'agora'.
export function nextSendText(iso: string | null | undefined, now: Date = new Date(), tz: string = DEFAULT_TZ): string {
  const d = toDate(iso);
  if (!d) return '';
  if (isNowish(d, now)) return 'agora';
  const time = `às ${shortClock(parts(d, tz))}`;
  return dayDiff(d, now, tz) === 0 ? time : `${dayWord(d, now, tz)} ${time}`;
}

// 'esperando há 3 h', 'esperando há 2 dias' ou, de uma semana para trás, 'esperando desde 10/09'.
export function waitingLabel(iso: string | null | undefined, now: Date = new Date(), tz: string = DEFAULT_TZ): string {
  const rel = relativeFromNow(iso, now, tz);
  if (!rel) return '';
  return rel.startsWith('há ') ? `esperando ${rel}` : `esperando desde ${rel}`;
}

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function drainText(days: number): string {
  if (!(days > 0)) return '';
  return days === 1 ? 'fila zera em ~1 dia útil' : `fila zera em ~${days} dias úteis`;
}

export const DELIVERY_LABELS: Record<DashboardDelivery, string> = {
  sent: 'Enviado',
  delivered: 'Entregue',
  read: 'Lido',
  failed: 'Falhou',
};

export const CLOSED_REASON_LABELS: Record<KanbanClosedReason, string> = {
  optout: 'Não contatar',
  skipped: 'Pulado',
  cancelled: 'Cancelado',
  no_reply: 'Sem resposta',
};

export const COLUMN_EMPTY_TEXT: Record<string, string> = {
  follow_1: 'Ninguém no primeiro follow-up.',
  follow_2: 'Ninguém no segundo follow-up.',
  follow_3: 'Ninguém no terceiro follow-up.',
  replied: 'Nenhuma resposta nos últimos 14 dias.',
  closed: 'Nada encerrado nos últimos 30 dias.',
};

export interface ChipView { text: string; tone: Tone; title: string | null }

interface ChipCtx { card: KanbanCard; now: Date; tz: string }

function closedTitle(card: KanbanCard): string | null {
  if (card.closed_reason === 'no_reply') return 'O último passo saiu há mais de 7 dias e o cliente não respondeu.';
  return lastErrorText(card.error) || null;
}

const CHIP_VIEWS: Record<KanbanChip, (c: ChipCtx) => ChipView> = {
  queued: ({ card, now, tz }) => ({
    text: card.eta ? `Na fila · sai ${etaLabel(card.eta, now, tz)}` : 'Na fila', tone: 'blue',
    title: card.eta ? null : 'Envios pausados ou desligados: sem previsão agora.',
  }),
  sending: () => ({ text: 'Enviando agora', tone: 'amber', title: null }),
  draft: () => ({ text: 'Rascunho', tone: 'gold', title: 'Aguardando alguém aprovar na Fila.' }),
  sent: ({ card, now, tz }) => (card.delivery === 'failed'
    ? { text: `Não entregue ${momentLabel(card.sent_at, now, tz)}`.trim(), tone: 'red', title: 'O WhatsApp não entregou esta mensagem.' }
    : { text: `Enviado ${momentLabel(card.sent_at, now, tz)}`.trim(), tone: 'slate', title: card.delivery ? DELIVERY_LABELS[card.delivery] : null }),
  problem: ({ card }) => ({ text: 'Com problema', tone: 'red', title: lastErrorText(card.error) || 'Veja o motivo na Fila.' }),
  replied: ({ card, now, tz }) => ({ text: `Respondeu ${momentLabel(card.replied_at, now, tz)}`.trim(), tone: 'emerald', title: null }),
  closed: ({ card }) => ({
    text: card.closed_reason ? CLOSED_REASON_LABELS[card.closed_reason] : 'Encerrado', tone: 'slate', title: closedTitle(card),
  }),
};

export function chipView(card: KanbanCard, now: Date = new Date(), tz: string = DEFAULT_TZ): ChipView {
  const view = CHIP_VIEWS[card.chip] ?? CHIP_VIEWS.draft;
  return view({ card, now, tz });
}

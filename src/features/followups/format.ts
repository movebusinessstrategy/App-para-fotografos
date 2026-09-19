import type { FollowUpStep } from './types';
import { WEEKDAY_SHORT } from './labels';

// Formatação pura da tela de follow-ups (testada em format.test.ts).

export const DEFAULT_TZ = 'America/Sao_Paulo';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

function toDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function plural(n: number, singular: string, pluralText: string): string {
  return `${n} ${n === 1 ? singular : pluralText}`;
}

// Quantos dias úteis para sair `count` envios, com `cap` por dia e `remainingToday` ainda livres hoje.
export function estimateBusinessDays(count: number, cap: number, remainingToday: number): number {
  const total = Math.max(0, Math.floor(Number(count) || 0));
  if (total === 0) return 0;
  const perDay = Math.max(1, Math.floor(Number(cap) || 0));
  const today = Math.min(perDay, Math.max(0, Math.floor(Number(remainingToday) || 0)));
  if (today === 0) return Math.ceil(total / perDay);
  if (total <= today) return 1;
  return 1 + Math.ceil((total - today) / perDay);
}

export function businessDaysLabel(days: number): string {
  if (days <= 1) return 'cerca de 1 dia útil';
  return `cerca de ${days} dias úteis`;
}

export function hoursSilentLabel(hours: number): string {
  const h = Math.max(0, Number(hours) || 0);
  if (h < 1) return 'calado há menos de 1 hora';
  if (h < 24) return `calado há ${plural(Math.floor(h), 'hora', 'horas')}`;
  return `calado há ${plural(Math.floor(h / 24), 'dia', 'dias')}`;
}

function relativeUnit(absMs: number): string {
  if (absMs < HOUR_MS) return `${Math.round(absMs / 60_000)} min`;
  if (absMs < DAY_MS) return `${Math.round(absMs / HOUR_MS)} h`;
  return plural(Math.round(absMs / DAY_MS), 'dia', 'dias');
}

export function relativeFromNow(iso: string | null | undefined, now: Date = new Date(), tz: string = DEFAULT_TZ): string {
  const d = toDate(iso);
  if (!d) return '';
  const diff = d.getTime() - now.getTime();
  const abs = Math.abs(diff);
  if (abs < 60_000) return 'agora';
  if (abs >= 7 * DAY_MS) return formatDay(d.toISOString(), tz);
  const unit = relativeUnit(abs);
  return diff < 0 ? `há ${unit}` : `em ${unit}`;
}

interface LocalParts { year: string; month: string; day: string; hour: string; minute: string; weekday: number }

function localParts(d: Date, tz: string): LocalParts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short',
  });
  const map: Record<string, string> = {};
  for (const p of fmt.formatToParts(d)) map[p.type] = p.value;
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(map.weekday);
  return { year: map.year, month: map.month, day: map.day, hour: map.hour, minute: map.minute, weekday };
}

// 'dd/mm'
export function formatDay(iso: string | null | undefined, tz: string = DEFAULT_TZ): string {
  const d = toDate(iso);
  if (!d) return '';
  const p = localParts(d, tz);
  return `${p.day}/${p.month}`;
}

// 'dd/mm/aaaa'
export function formatFullDate(iso: string | null | undefined, tz: string = DEFAULT_TZ): string {
  const d = toDate(iso);
  if (!d) return '';
  const p = localParts(d, tz);
  return `${p.day}/${p.month}/${p.year}`;
}

// 'dd/mm HH:mm'
export function formatDayTime(iso: string | null | undefined, tz: string = DEFAULT_TZ): string {
  const d = toDate(iso);
  if (!d) return '';
  const p = localParts(d, tz);
  return `${p.day}/${p.month} ${p.hour}:${p.minute}`;
}

// 'seg, 09:00'
export function formatWeekdayTime(iso: string | null | undefined, tz: string = DEFAULT_TZ): string {
  const d = toDate(iso);
  if (!d) return '';
  const p = localParts(d, tz);
  return `${WEEKDAY_SHORT[p.weekday] ?? ''}, ${p.hour}:${p.minute}`;
}

// 'hoje 10:42', 'ontem 18:03' ou 'dd/mm HH:mm'
export function formatSweepMoment(iso: string | null | undefined, now: Date = new Date(), tz: string = DEFAULT_TZ): string {
  const d = toDate(iso);
  if (!d) return '';
  const p = localParts(d, tz);
  const time = `${p.hour}:${p.minute}`;
  const dayKey = (x: Date) => { const q = localParts(x, tz); return `${q.year}-${q.month}-${q.day}`; };
  const key = `${p.year}-${p.month}-${p.day}`;
  if (key === dayKey(now)) return `hoje ${time}`;
  if (key === dayKey(new Date(now.getTime() - DAY_MS))) return `ontem ${time}`;
  return `${p.day}/${p.month} ${time}`;
}

function minutesText(seconds: number): string {
  const m = Math.round((seconds / 60) * 10) / 10;
  return String(m).replace('.', ',');
}

// '1 a 2,5 minutos' ou '30 a 45 segundos'
export function gapRangeLabel(minSeconds: number, maxSeconds: number): string {
  const min = Math.max(0, Number(minSeconds) || 0);
  const max = Math.max(min, Number(maxSeconds) || 0);
  if (max < 60) return `${min} a ${max} segundos`;
  return `${minutesText(min)} a ${minutesText(max)} minutos`;
}

export interface ApproveAllTextInput {
  count: number;
  step: FollowUpStep | null;
  effectiveCap: number;
  remainingToday: number;
  gap: { min: number; max: number } | null;
}

export function approveAllConfirmText(i: ApproveAllTextInput): string {
  const what = i.count === 1 ? '1 follow-up' : `${i.count} follow-ups`;
  const scope = i.step ? ` do passo ${i.step}` : '';
  const gap = i.gap ? `, com ${gapRangeLabel(i.gap.min, i.gap.max)} entre cada um` : '';
  const days = businessDaysLabel(estimateBusinessDays(i.count, i.effectiveCap, i.remainingToday));
  return `Aprovar ${what}${scope}? Eles saem em horário comercial, no máximo ${i.effectiveCap} por dia${gap} (${days}). Se o cliente responder antes, o envio é cancelado.`;
}

// Dígitos do telefone para o deep link do chat (/vendas?tab=inbox&phone=).
export function phoneDigits(phone: string | null | undefined): string {
  return String(phone ?? '').replace(/\D/g, '');
}

// Lista separada por vírgula ou quebra de linha, sem vazios e sem repetidos.
export function parseListInput(text: string): string[] {
  const seen = new Set<string>();
  for (const raw of String(text ?? '').split(/[,\n;]/)) {
    const v = raw.trim();
    if (v) seen.add(v);
  }
  return [...seen];
}

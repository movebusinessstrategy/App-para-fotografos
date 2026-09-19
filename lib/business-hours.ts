// Relógio de horário comercial no fuso do estúdio, usado pela cadência, pelo
// sender e pelo follow-up legado. Só usa Intl: nada de biblioteca de datas.
import type { BusinessHours } from '../src/features/followups/types.js';

interface LocalParts { year: number; month: number; day: number; hour: number; minute: number; weekday: number }

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const HM_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE_KEY_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const SCAN_DAYS = 21;
const MINUTE_MS = 60_000;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(tz: string): Intl.DateTimeFormat {
  let formatter = formatters.get(tz);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', weekday: 'short', year: 'numeric', month: '2-digit',
      day: '2-digit', hour: '2-digit', minute: '2-digit',
    });
    formatters.set(tz, formatter);
  }
  return formatter;
}

function localParts(at: Date, tz: string): LocalParts {
  const values: Record<string, string> = {};
  for (const part of formatterFor(tz).formatToParts(at)) values[part.type] = part.value;
  return {
    year: Number(values.year), month: Number(values.month), day: Number(values.day),
    hour: Number(values.hour) % 24, minute: Number(values.minute), weekday: WEEKDAYS[values.weekday] ?? 0,
  };
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function dateKeyOf(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function hmToMinutes(hm: string): number {
  const [h, m] = hm.split(':');
  return Number(h) * 60 + Number(m);
}

// Diferença entre o relógio local e o UTC no instante t (resolução de minuto).
function offsetMs(t: number, tz: string): number {
  const floored = Math.floor(t / MINUTE_MS) * MINUTE_MS;
  const p = localParts(new Date(floored), tz);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - floored;
}

// Horário de parede no fuso tz para instante UTC: palpite e uma segunda passada.
function zonedWallToUtc(year: number, month: number, day: number, minuteOfDay: number, tz: string): Date {
  const wall = Date.UTC(year, month - 1, day, 0, minuteOfDay);
  const guess = wall - offsetMs(wall, tz);
  return new Date(wall - offsetMs(guess, tz));
}

function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz.trim()) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function normalizeDays(raw: unknown): number[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const valid = raw.every((d) => Number.isInteger(d) && d >= 0 && d <= 6);
  return valid ? Array.from(new Set(raw as number[])).sort((a, b) => a - b) : null;
}

function normalizeHolidays(raw: unknown): string[] | null {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) return null;
  const valid = raw.every((d) => typeof d === 'string' && DATE_KEY_PATTERN.test(d));
  return valid ? Array.from(new Set(raw as string[])) : null;
}

function validRange(start: unknown, end: unknown): boolean {
  if (typeof start !== 'string' || typeof end !== 'string') return false;
  if (!HM_PATTERN.test(start) || !HM_PATTERN.test(end)) return false;
  return hmToMinutes(start) < hmToMinutes(end);
}

export function normalizeBusinessHours(raw: unknown): BusinessHours | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (!isValidTimeZone(r.tz) || !validRange(r.start, r.end)) return null;
  const days = normalizeDays(r.days);
  const holidays = normalizeHolidays(r.holidays);
  if (!days || !holidays) return null;
  return { tz: r.tz, days, start: r.start as string, end: r.end as string, holidays };
}

export function localDateKey(at: Date, tz: string): string {
  const p = localParts(at, tz);
  return dateKeyOf(p.year, p.month, p.day);
}

function isHoliday(key: string, h: BusinessHours): boolean {
  return (h.holidays || []).includes(key);
}

export function isWithinBusinessHours(at: Date, h: BusinessHours): boolean {
  const p = localParts(at, h.tz);
  if (!h.days.includes(p.weekday)) return false;
  if (isHoliday(dateKeyOf(p.year, p.month, p.day), h)) return false;
  const minute = p.hour * 60 + p.minute;
  return minute >= hmToMinutes(h.start) && minute < hmToMinutes(h.end);
}

// Primeira abertura da janela em ou depois de `from`, pulando dias fora de
// `days` e feriados. Varre no calendário local para não errar na virada do dia.
export function nextWindowOpening(from: Date, h: BusinessHours): Date {
  const base = localParts(from, h.tz);
  const startMinute = hmToMinutes(h.start);
  for (let offset = 0; offset < SCAN_DAYS; offset++) {
    const calendar = new Date(Date.UTC(base.year, base.month - 1, base.day + offset));
    const year = calendar.getUTCFullYear();
    const month = calendar.getUTCMonth() + 1;
    const day = calendar.getUTCDate();
    if (!h.days.includes(calendar.getUTCDay()) || isHoliday(dateKeyOf(year, month, day), h)) continue;
    const opening = zonedWallToUtc(year, month, day, startMinute, h.tz);
    if (opening.getTime() >= from.getTime()) return opening;
  }
  throw new Error(`Nenhuma abertura de horário comercial nos próximos ${SCAN_DAYS} dias`);
}

export function nextSendSlot(i: { earliest: Date; now: Date; hours: BusinessHours; jitterSeconds: number }): Date {
  const base = new Date(Math.max(i.earliest.getTime(), i.now.getTime()));
  if (isWithinBusinessHours(base, i.hours)) return base;
  const opening = nextWindowOpening(base, i.hours);
  const windowSeconds = (hmToMinutes(i.hours.end) - hmToMinutes(i.hours.start)) * 60;
  const jitter = Math.max(0, Math.min(Math.floor(Number(i.jitterSeconds) || 0), windowSeconds - 60));
  return new Date(opening.getTime() + jitter * 1000);
}

// FNV-1a de 32 bits: o mesmo texto sempre dá o mesmo atraso.
export function stableJitterSeconds(key: string, maxSeconds: number): number {
  const max = Math.floor(Number(maxSeconds) || 0);
  if (max <= 0) return 0;
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(String(key ?? ''))) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % (max + 1);
}

export function pickGapSeconds(min: number, max: number, rand: () => number = Math.random): number {
  const upper = Math.max(min, max);
  const picked = min + Math.floor(rand() * (upper - min + 1));
  return Math.min(picked, upper);
}

export function localDayStartUtc(now: Date, tz: string): Date {
  const p = localParts(now, tz);
  return zonedWallToUtc(p.year, p.month, p.day, 0, tz);
}

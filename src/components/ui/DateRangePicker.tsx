import React, { useEffect, useRef, useState } from "react";
import {
  addMonths, endOfMonth, format, getDay, getDaysInMonth,
  isSameDay, isWithinInterval, startOfMonth, subDays,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import { Calendar as CalendarIcon, Check, ChevronLeft, ChevronRight, X } from "lucide-react";
import { cn } from "../../utils/cn";

// Seletor de período no estilo do app: atalhos (Mês / 7 / 15 / 30 dias) + um
// calendário de verdade pra escolher um intervalo livre (ex.: do dia 1 ao 15).
// Datas trafegam como "YYYY-MM-DD" (date-only, sem fuso) pra casar com os filtros.

export type DateRange = { from: string; to: string };
type Preset = "month" | "7d" | "15d" | "30d" | "custom";

const WEEKDAYS = ["D", "S", "T", "Q", "Q", "S", "S"];

const PRESETS: Array<{ id: Exclude<Preset, "custom">; label: string }> = [
  { id: "month", label: "Mês atual" },
  { id: "7d", label: "7 dias" },
  { id: "15d", label: "15 dias" },
  { id: "30d", label: "30 dias" },
];

export const toDateOnly = (date: Date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

export const fromDateOnly = (value: string) => {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
};

export function buildPresetRange(preset: Exclude<Preset, "custom">): DateRange {
  const today = new Date();
  if (preset === "7d") return { from: toDateOnly(subDays(today, 6)), to: toDateOnly(today) };
  if (preset === "15d") return { from: toDateOnly(subDays(today, 14)), to: toDateOnly(today) };
  if (preset === "30d") return { from: toDateOnly(subDays(today, 29)), to: toDateOnly(today) };
  return { from: toDateOnly(startOfMonth(today)), to: toDateOnly(endOfMonth(today)) };
}

function rangeMatchesPreset(range: DateRange): Preset {
  for (const p of PRESETS) {
    const r = buildPresetRange(p.id);
    if (r.from === range.from && r.to === range.to) return p.id;
  }
  return "custom";
}

function formatRangeShort(range: DateRange) {
  return `${format(fromDateOnly(range.from), "dd/MM/yy")} - ${format(fromDateOnly(range.to), "dd/MM/yy")}`;
}

function formatRangeLabel(range: DateRange) {
  const from = fromDateOnly(range.from);
  const to = fromDateOnly(range.to);
  if (range.from === range.to) return format(from, "dd 'de' MMMM yyyy", { locale: ptBR });
  if (from.getFullYear() === to.getFullYear())
    return `${format(from, "dd MMM", { locale: ptBR })} - ${format(to, "dd MMM yyyy", { locale: ptBR })}`;
  return `${format(from, "dd MMM yyyy", { locale: ptBR })} - ${format(to, "dd MMM yyyy", { locale: ptBR })}`;
}

export function DateRangePicker({
  range, onChange,
}: {
  range: DateRange;
  onChange: (range: DateRange) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const preset = rangeMatchesPreset(range);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex items-center rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-1 shadow-sm">
        {PRESETS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onChange(buildPresetRange(item.id))}
            className={cn(
              "px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap",
              preset === item.id
                ? "bg-gold-500/15 text-gold-700 dark:text-gold-300"
                : "text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div ref={ref} className="relative">
        <button
          type="button"
          onClick={() => setOpen(v => !v)}
          className={cn(
            "inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold transition-colors shadow-sm",
            preset === "custom"
              ? "border-gold-300 bg-gold-500/15 text-gold-700 dark:border-gold-500/40 dark:text-gold-300"
              : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600"
          )}
        >
          <CalendarIcon size={14} />
          <span>{preset === "custom" ? formatRangeShort(range) : "Personalizado"}</span>
        </button>

        {open && (
          <DateRangePopover
            range={range}
            onApply={(next) => { onChange(next); setOpen(false); }}
            onClose={() => setOpen(false)}
          />
        )}
      </div>
    </div>
  );
}

function DateRangePopover({
  range, onApply, onClose,
}: {
  range: DateRange;
  onApply: (range: DateRange) => void;
  onClose: () => void;
}) {
  const [cursor, setCursor] = useState(() => startOfMonth(fromDateOnly(range.from)));
  const [draftFrom, setDraftFrom] = useState<Date | null>(() => fromDateOnly(range.from));
  const [draftTo, setDraftTo] = useState<Date | null>(() => fromDateOnly(range.to));

  const commitDay = (day: Date) => {
    const clean = new Date(day.getFullYear(), day.getMonth(), day.getDate());
    if (!draftFrom || draftTo) { setDraftFrom(clean); setDraftTo(null); return; }
    if (clean < draftFrom) { setDraftTo(draftFrom); setDraftFrom(clean); return; }
    setDraftTo(clean);
  };

  const canApply = !!draftFrom && !!draftTo;
  const draftLabel = canApply
    ? formatRangeLabel({ from: toDateOnly(draftFrom!), to: toDateOnly(draftTo!) })
    : draftFrom
    ? `${format(draftFrom, "dd/MM/yyyy")} - selecione o fim`
    : "Selecione o início";

  return (
    <div className="absolute left-0 top-full z-50 mt-2 w-[min(92vw,640px)] rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-2xl overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-100 dark:border-gray-800">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-wider text-gold-600 dark:text-gold-400">Período personalizado</p>
          <p className="text-sm text-gray-700 dark:text-gray-200 truncate capitalize">{draftLabel}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          title="Fechar"
        >
          <X size={16} />
        </button>
      </div>

      <div className="flex items-center justify-between px-4 py-3">
        <button
          type="button"
          onClick={() => setCursor(c => addMonths(c, -1))}
          className="p-2 rounded-lg text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          title="Mês anterior"
        >
          <ChevronLeft size={16} />
        </button>
        <div className="text-sm font-semibold text-gray-900 dark:text-white capitalize">
          {format(cursor, "MMMM yyyy", { locale: ptBR })}
          <span className="hidden sm:inline text-gray-400 dark:text-gray-500"> / </span>
          <span className="hidden sm:inline">{format(addMonths(cursor, 1), "MMMM yyyy", { locale: ptBR })}</span>
        </div>
        <button
          type="button"
          onClick={() => setCursor(c => addMonths(c, 1))}
          className="p-2 rounded-lg text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          title="Próximo mês"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 px-4 pb-4">
        <RangeMonth month={cursor} from={draftFrom} to={draftTo} onPick={commitDay} />
        <RangeMonth month={addMonths(cursor, 1)} from={draftFrom} to={draftTo} onPick={commitDay} className="hidden sm:block" />
      </div>

      <div className="flex items-center justify-between gap-3 px-4 py-3 bg-gray-50 dark:bg-gray-900/70 border-t border-gray-100 dark:border-gray-800">
        <button
          type="button"
          onClick={() => {
            const rawToday = new Date();
            const today = new Date(rawToday.getFullYear(), rawToday.getMonth(), rawToday.getDate());
            setDraftFrom(today);
            setDraftTo(today);
            setCursor(startOfMonth(today));
          }}
          className="text-xs font-semibold text-gray-500 dark:text-gray-400 hover:text-gold-600 dark:hover:text-gold-300 transition-colors"
        >
          Só hoje
        </button>
        <button
          type="button"
          disabled={!canApply}
          onClick={() => {
            if (!draftFrom || !draftTo) return;
            onApply({ from: toDateOnly(draftFrom), to: toDateOnly(draftTo) });
          }}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gold-600 hover:bg-gold-700 disabled:opacity-40 disabled:hover:bg-gold-600 text-white text-xs font-bold transition-colors"
        >
          <Check size={14} />
          Aplicar
        </button>
      </div>
    </div>
  );
}

function RangeMonth({
  month, from, to, onPick, className,
}: {
  month: Date;
  from: Date | null;
  to: Date | null;
  onPick: (day: Date) => void;
  className?: string;
}) {
  const start = startOfMonth(month);
  const daysInMonth = getDaysInMonth(month);
  const startWeekday = getDay(start);
  const totalCells = Math.ceil((startWeekday + daysInMonth) / 7) * 7;
  const selectedInterval = from && to ? { start: from, end: to } : null;

  return (
    <div className={className}>
      <p className="mb-2 text-center text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 capitalize">
        {format(month, "MMMM", { locale: ptBR })}
      </p>
      <div className="grid grid-cols-7 mb-1">
        {WEEKDAYS.map((d, idx) => (
          <div key={`${d}-${idx}`} className="text-center text-[10px] font-bold text-gray-400 dark:text-gray-500 py-1">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-y-1">
        {Array.from({ length: totalCells }).map((_, i) => {
          const dayNum = i - startWeekday + 1;
          if (dayNum < 1 || dayNum > daysInMonth) return <div key={i} className="h-9" />;

          const day = new Date(month.getFullYear(), month.getMonth(), dayNum);
          const isStart = !!from && isSameDay(day, from);
          const isEnd = !!to && isSameDay(day, to);
          const inRange = !!selectedInterval && isWithinInterval(day, selectedInterval);

          return (
            <button
              key={i}
              type="button"
              onClick={() => onPick(day)}
              className={cn(
                "h-9 text-sm font-semibold transition-colors",
                inRange ? "bg-gold-500/12 text-gold-800 dark:text-gold-200" : "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800",
                isStart && "rounded-l-full bg-gold-600 text-white hover:bg-gold-600 dark:text-white",
                isEnd && "rounded-r-full bg-gold-600 text-white hover:bg-gold-600 dark:text-white",
                isStart && isEnd && "rounded-full",
              )}
            >
              {dayNum}
            </button>
          );
        })}
      </div>
    </div>
  );
}

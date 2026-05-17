import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  addMonths,
  format,
  getDaysInMonth,
  getDay,
  isSameDay,
  isToday,
  setDate,
  setHours,
  setMinutes,
  startOfMonth,
  subMonths,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import { Calendar, ChevronLeft, ChevronRight, Clock } from "lucide-react";
import { cn } from "../../utils/cn";

interface DateTimePickerProps {
  value: string; // ISO string or ""
  onChange: (iso: string) => void;
  placeholder?: string;
  className?: string;
}

const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

export function DateTimePicker({
  value,
  onChange,
  placeholder = "Selecionar data e hora",
  className,
}: DateTimePickerProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});

  const parsed = value ? new Date(value) : null;
  const [cursor, setCursor] = useState<Date>(parsed ?? new Date());
  const [hour, setHourState] = useState(parsed ? parsed.getHours() : 9);
  const [minute, setMinuteState] = useState(parsed ? parsed.getMinutes() : 0);

  // Sync internal state when value changes externally
  useEffect(() => {
    if (value) {
      const d = new Date(value);
      setCursor(d);
      setHourState(d.getHours());
      setMinuteState(d.getMinutes());
    }
  }, [value]);

  function recalcPosition() {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const dropHeight = 420; // calendar is taller than select
    const gap = 12;
    const spaceBelow = window.innerHeight - rect.bottom - gap;
    const spaceAbove = rect.top - gap;
    const openUpward = spaceBelow < dropHeight && spaceAbove > spaceBelow;
    const availableHeight = Math.max(openUpward ? spaceAbove : spaceBelow, 280);
    setDropdownStyle({
      position: "fixed",
      left: rect.left,
      width: Math.max(rect.width, 288), // min 288px (w-72)
      maxHeight: availableHeight,
      zIndex: 9999,
      ...(openUpward
        ? { bottom: window.innerHeight - rect.top + 4 }
        : { top: rect.bottom + 4 }),
    });
  }

  function handleToggle() {
    if (!open) recalcPosition();
    setOpen((v) => !v);
  }

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        triggerRef.current?.contains(e.target as Node) ||
        dropdownRef.current?.contains(e.target as Node)
      )
        return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Reposition on scroll / resize
  useEffect(() => {
    if (!open) return;
    const handler = () => recalcPosition();
    window.addEventListener("scroll", handler, true);
    window.addEventListener("resize", handler);
    return () => {
      window.removeEventListener("scroll", handler, true);
      window.removeEventListener("resize", handler);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // ── Calendar helpers ──────────────────────────────────────────────────────────

  const firstDayOfMonth = startOfMonth(cursor);
  const daysInMonth = getDaysInMonth(cursor);
  const startWeekday = getDay(firstDayOfMonth);
  const totalCells = Math.ceil((startWeekday + daysInMonth) / 7) * 7;

  const selectedDate = parsed
    ? new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate())
    : null;

  function commitDay(day: number) {
    let d = setDate(cursor, day);
    d = setHours(d, hour);
    d = setMinutes(d, minute);
    d.setSeconds(0);
    onChange(d.toISOString());
    setCursor(d);
  }

  function commitTime(h: number, m: number) {
    if (!parsed) return;
    let d = setHours(parsed, h);
    d = setMinutes(d, m);
    d.setSeconds(0);
    onChange(d.toISOString());
  }

  function clampHour(raw: string) {
    const n = Math.max(0, Math.min(23, Number(raw.replace(/\D/g, "")) || 0));
    setHourState(n);
    commitTime(n, minute);
  }

  function clampMinute(raw: string) {
    const n = Math.max(0, Math.min(59, Number(raw.replace(/\D/g, "")) || 0));
    setMinuteState(n);
    commitTime(hour, n);
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className={cn("relative", className)}>
      {/* Trigger */}
      <button
        ref={triggerRef}
        type="button"
        onClick={handleToggle}
        className={cn(
          "flex w-full items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition-colors outline-none",
          parsed
            ? "border-gold-400 bg-gold-50 dark:bg-gold-900/20 text-gold-700 dark:text-gold-300 font-semibold"
            : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-400 dark:text-gray-500 hover:border-gray-300 dark:hover:border-gray-600"
        )}
      >
        <Calendar size={14} className="flex-shrink-0" />
        <span className="flex-1 text-left truncate">
          {parsed
            ? format(parsed, "dd 'de' MMMM 'de' yyyy 'às' HH:mm", { locale: ptBR })
            : placeholder}
        </span>
      </button>

      {/* Dropdown — portal to escape overflow:hidden */}
      {open &&
        createPortal(
          <div
            ref={dropdownRef}
            style={dropdownStyle}
            className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-2xl overflow-y-auto"
          >
            {/* Month navigation */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800">
              <button
                type="button"
                onClick={() => setCursor((c) => subMonths(c, 1))}
                className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400 transition-colors"
              >
                <ChevronLeft size={15} />
              </button>
              <span className="text-sm font-semibold text-gray-800 dark:text-white capitalize">
                {format(cursor, "MMMM yyyy", { locale: ptBR })}
              </span>
              <button
                type="button"
                onClick={() => setCursor((c) => addMonths(c, 1))}
                className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400 transition-colors"
              >
                <ChevronRight size={15} />
              </button>
            </div>

            {/* Calendar grid */}
            <div className="px-3 pt-2 pb-1">
              <div className="grid grid-cols-7 mb-1">
                {WEEKDAYS.map((d) => (
                  <div
                    key={d}
                    className="text-center text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase py-1"
                  >
                    {d}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-y-0.5">
                {Array.from({ length: totalCells }).map((_, i) => {
                  const dayNum = i - startWeekday + 1;
                  if (dayNum < 1 || dayNum > daysInMonth) return <div key={i} />;
                  const cellDate = new Date(cursor.getFullYear(), cursor.getMonth(), dayNum);
                  const isSelected = selectedDate ? isSameDay(cellDate, selectedDate) : false;
                  const isTodayCell = isToday(cellDate);
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => commitDay(dayNum)}
                      className={cn(
                        "flex items-center justify-center h-8 w-8 mx-auto rounded-full text-sm transition-colors",
                        isSelected
                          ? "bg-gold-600 text-white font-semibold"
                          : isTodayCell
                          ? "border border-gold-400 text-gold-600 dark:text-gold-400 font-semibold hover:bg-gold-50 dark:hover:bg-gold-900/20"
                          : "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
                      )}
                    >
                      {dayNum}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Time selector */}
            <div className="border-t border-gray-100 dark:border-gray-800 px-4 py-3 flex items-center gap-3">
              <Clock size={14} className="text-gray-400 flex-shrink-0" />
              <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Hora
              </span>
              <div className="flex items-center gap-1 ml-auto">
                {/* Hour */}
                <div className="flex flex-col items-center">
                  <button
                    type="button"
                    onClick={() => { const n = (hour + 1) % 24; setHourState(n); commitTime(n, minute); }}
                    className="text-gray-400 hover:text-gold-600 dark:hover:text-gold-400 transition-colors px-1"
                  >
                    <ChevronLeft size={12} className="-rotate-90" />
                  </button>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={String(hour).padStart(2, "0")}
                    onChange={(e) => setHourState(Number(e.target.value) || 0)}
                    onBlur={(e) => clampHour(e.target.value)}
                    className="w-9 text-center text-sm font-semibold bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg py-1 outline-none focus:border-gold-400 text-gray-800 dark:text-white"
                  />
                  <button
                    type="button"
                    onClick={() => { const n = (hour - 1 + 24) % 24; setHourState(n); commitTime(n, minute); }}
                    className="text-gray-400 hover:text-gold-600 dark:hover:text-gold-400 transition-colors px-1"
                  >
                    <ChevronLeft size={12} className="rotate-90" />
                  </button>
                </div>

                <span className="text-lg font-bold text-gray-400 dark:text-gray-500 mb-0.5">:</span>

                {/* Minute */}
                <div className="flex flex-col items-center">
                  <button
                    type="button"
                    onClick={() => { const n = (minute + 5) % 60; setMinuteState(n); commitTime(hour, n); }}
                    className="text-gray-400 hover:text-gold-600 dark:hover:text-gold-400 transition-colors px-1"
                  >
                    <ChevronLeft size={12} className="-rotate-90" />
                  </button>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={String(minute).padStart(2, "0")}
                    onChange={(e) => setMinuteState(Number(e.target.value) || 0)}
                    onBlur={(e) => clampMinute(e.target.value)}
                    className="w-9 text-center text-sm font-semibold bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg py-1 outline-none focus:border-gold-400 text-gray-800 dark:text-white"
                  />
                  <button
                    type="button"
                    onClick={() => { const n = (minute - 5 + 60) % 60; setMinuteState(n); commitTime(hour, n); }}
                    className="text-gray-400 hover:text-gold-600 dark:hover:text-gold-400 transition-colors px-1"
                  >
                    <ChevronLeft size={12} className="rotate-90" />
                  </button>
                </div>
              </div>

              {/* Quick presets */}
              <div className="flex flex-col gap-1 ml-2">
                {([[8, 0], [12, 0], [18, 0]] as [number, number][]).map(([h, m]) => (
                  <button
                    key={`${h}:${m}`}
                    type="button"
                    onClick={() => { setHourState(h); setMinuteState(m); commitTime(h, m); }}
                    className={cn(
                      "text-[11px] font-semibold px-2 py-0.5 rounded-md transition-colors",
                      hour === h && minute === m
                        ? "bg-gold-600 text-white"
                        : "bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gold-50 dark:hover:bg-gold-900/20 hover:text-gold-600 dark:hover:text-gold-400"
                    )}
                  >
                    {String(h).padStart(2, "0")}h
                  </button>
                ))}
              </div>
            </div>

            {/* Confirm */}
            <div className="px-4 pb-3">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={!parsed}
                className="w-full py-1.5 text-sm font-semibold rounded-xl bg-gold-600 hover:bg-gold-700 text-white disabled:opacity-40 transition-colors"
              >
                {parsed
                  ? `Confirmar — ${format(parsed, "dd/MM 'às' HH:mm", { locale: ptBR })}`
                  : "Selecione uma data"}
              </button>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}

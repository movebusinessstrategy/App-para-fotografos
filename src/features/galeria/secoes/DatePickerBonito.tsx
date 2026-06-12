import React, { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface DatePickerBonitoProps {
  value: string;
  onChange: (iso: string) => void;
  presets?: number[]; // dias a partir de hoje pra atalhos rápidos
  minDate?: string;   // iso "YYYY-MM-DD"
  className?: string;
}

const MES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];
const DIA = ["D", "S", "T", "Q", "Q", "S", "S"];

function toIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function parseIso(iso: string): Date | null {
  if (!iso) return null;
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return isNaN(d.getTime()) ? null : d;
}

function todayPlus(days: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return toIso(d);
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// Calendário visual com mês navegável + atalhos rápidos (hoje / +N dias).
// Usado em qualquer lugar que precise selecionar uma data sem o picker
// nativo do browser (que é feio e quebra a estética).
export function DatePickerBonito({
  value, onChange, presets = [7, 15, 30], minDate, className,
}: DatePickerBonitoProps) {
  const [open, setOpen] = useState(false);
  const selected = useMemo(() => parseIso(value), [value]);
  const [view, setView] = useState<Date>(() => selected || new Date());
  const ref = useRef<HTMLDivElement>(null);

  // Sincroniza view com value quando muda externamente.
  useEffect(() => {
    if (selected) setView(new Date(selected.getFullYear(), selected.getMonth(), 1));
  }, [value]);

  // Fecha ao clicar fora.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const min = useMemo(() => parseIso(minDate || ""), [minDate]);
  const today = new Date(); today.setHours(0, 0, 0, 0);

  // Mês exibido — grid 6 semanas x 7 dias.
  const dias = useMemo(() => {
    const first = new Date(view.getFullYear(), view.getMonth(), 1);
    const lastDay = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
    const startWeekday = first.getDay(); // 0=Dom
    const arr: { date: Date; outOfMonth: boolean }[] = [];
    // Dias do mês anterior
    for (let i = startWeekday - 1; i >= 0; i--) {
      const d = new Date(view.getFullYear(), view.getMonth(), -i);
      arr.push({ date: d, outOfMonth: true });
    }
    // Dias do mês
    for (let d = 1; d <= lastDay; d++) {
      arr.push({ date: new Date(view.getFullYear(), view.getMonth(), d), outOfMonth: false });
    }
    // Completa última semana
    while (arr.length % 7 !== 0) {
      const last = arr[arr.length - 1].date;
      arr.push({ date: new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1), outOfMonth: true });
    }
    return arr;
  }, [view]);

  const labelTrigger = selected
    ? selected.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" })
    : "Sem prazo";

  const pickPreset = (days: number) => {
    onChange(todayPlus(days));
    setOpen(false);
  };

  const pickDay = (d: Date) => {
    if (min && d < min) return;
    onChange(toIso(d));
    setOpen(false);
  };

  return (
    <div ref={ref} className={"relative inline-block " + (className || "")}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm hover:border-gray-400 dark:hover:border-gray-500"
      >
        <span className="font-medium">{labelTrigger}</span>
      </button>

      {open && (
        <div className="absolute z-30 mt-2 w-72 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-xl p-3 left-0">
          {/* Atalhos */}
          <div className="flex flex-wrap gap-1.5 mb-3">
            <PresetButton label="Hoje" onClick={() => pickPreset(0)} />
            {presets.map((d) => (
              <PresetButton key={d} label={`+${d} dias`} onClick={() => pickPreset(d)} />
            ))}
          </div>

          {/* Header mês */}
          <div className="flex items-center justify-between mb-2">
            <button
              type="button"
              onClick={() => setView(new Date(view.getFullYear(), view.getMonth() - 1, 1))}
              className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              <ChevronLeft size={15} />
            </button>
            <span className="text-sm font-medium">
              {MES[view.getMonth()]} {view.getFullYear()}
            </span>
            <button
              type="button"
              onClick={() => setView(new Date(view.getFullYear(), view.getMonth() + 1, 1))}
              className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              <ChevronRight size={15} />
            </button>
          </div>

          {/* Grid de dias */}
          <div className="grid grid-cols-7 gap-1 mb-1 text-center text-[10px] text-gray-400 font-medium">
            {DIA.map((d, i) => <span key={i}>{d}</span>)}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {dias.map(({ date, outOfMonth }, idx) => {
              const isSelected = selected && sameDay(date, selected);
              const isToday = sameDay(date, today);
              const disabled = min ? date < min : false;
              return (
                <button
                  key={idx}
                  type="button"
                  disabled={disabled}
                  onClick={() => pickDay(date)}
                  className={
                    "text-xs h-8 rounded-lg flex items-center justify-center transition-colors " +
                    (isSelected
                      ? "bg-violet-600 text-white font-semibold"
                      : disabled
                        ? "text-gray-300 dark:text-gray-700 cursor-not-allowed"
                        : outOfMonth
                          ? "text-gray-300 dark:text-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800"
                          : isToday
                            ? "text-violet-600 dark:text-violet-300 font-semibold ring-1 ring-violet-200 dark:ring-violet-800 hover:bg-violet-50 dark:hover:bg-violet-900/30"
                            : "text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800")
                  }
                >
                  {date.getDate()}
                </button>
              );
            })}
          </div>

          {value && (
            <div className="mt-2 pt-2 border-t border-gray-100 dark:border-gray-800">
              <button
                type="button"
                onClick={() => { onChange(""); setOpen(false); }}
                className="w-full text-xs text-gray-500 hover:text-red-600 dark:hover:text-red-400 py-1"
              >
                Remover prazo
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PresetButton({ label, onClick }: { label: string; onClick: () => void; key?: React.Key | null }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="px-2.5 py-1 text-xs font-medium rounded-lg bg-gray-100 hover:bg-violet-100 dark:bg-gray-800 dark:hover:bg-violet-900/30 text-gray-700 dark:text-gray-200 hover:text-violet-700 dark:hover:text-violet-300 transition-colors"
    >
      {label}
    </button>
  );
}

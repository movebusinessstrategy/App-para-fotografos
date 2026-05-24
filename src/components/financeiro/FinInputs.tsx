import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check, ChevronLeft, ChevronRight, Calendar } from 'lucide-react';
import { fmtBRL } from './finUtils';

const BASE =
  'w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 ' +
  'bg-white dark:bg-gray-900 text-gray-900 dark:text-white ' +
  'focus:outline-none focus:ring-2 focus:ring-violet-500 appearance-none';

// ── MoneyInput (R$ 1.000,00) ─────────────────────────────────────────────────
interface MoneyInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> {
  value: string;
  onChange: (raw: string) => void;
  className?: string;
}

export function MoneyInput({ value, onChange, className, ...rest }: MoneyInputProps) {
  const [focused, setFocused] = useState(false);
  const numericVal = parseFloat(value.replace(',', '.')) || 0;

  return (
    <input
      {...rest}
      type="text"
      inputMode="decimal"
      value={
        focused
          ? value
          : numericVal === 0
          ? ''
          : fmtBRL(numericVal)
      }
      placeholder={focused ? '0,00' : rest.placeholder ?? 'R$ 0,00'}
      className={`${BASE} ${className ?? ''}`}
      onChange={e => onChange(e.target.value.replace(/[^0-9,.]/g, ''))}
      onFocus={e => {
        setFocused(true);
        if (numericVal === 0) onChange('');
        setTimeout(() => e.target.select(), 0);
      }}
      onBlur={() => {
        setFocused(false);
        const raw = value.replace(',', '.');
        if (!raw || isNaN(parseFloat(raw))) onChange('0');
      }}
    />
  );
}

// ── NumInput (sem spinners, comportamento limpo) ──────────────────────────────
interface NumInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> {
  value: string | number;
  onChange: (raw: string) => void;
  className?: string;
  allowDecimal?: boolean;
}

export function NumInput({ value, onChange, className, allowDecimal = true, ...rest }: NumInputProps) {
  const strVal = String(value);
  const numVal = parseFloat(strVal.replace(',', '.'));

  return (
    <input
      {...rest}
      type="text"
      inputMode={allowDecimal ? 'decimal' : 'numeric'}
      value={strVal === '0' ? '' : strVal}
      placeholder={rest.placeholder ?? '0'}
      className={`${BASE} ${className ?? ''}`}
      onChange={e => {
        const pattern = allowDecimal ? /[^0-9,.]/g : /[^0-9]/g;
        onChange(e.target.value.replace(pattern, ''));
      }}
      onFocus={e => {
        if (numVal === 0 || strVal === '0') onChange('');
        setTimeout(() => e.target.select(), 0);
      }}
      onBlur={() => {
        const raw = strVal.replace(',', '.');
        if (!raw || isNaN(parseFloat(raw))) onChange('0');
      }}
    />
  );
}

// ── FinSelect (dropdown com portal - não corta dentro de modal) ───────────────
export interface SelectOption {
  value: string;
  label: string;
}

interface FinSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  nullable?: boolean;
}

export function FinSelect({
  value,
  onChange,
  options,
  placeholder = 'Selecionar',
  className,
  disabled,
  nullable = true,
}: FinSelectProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  // Fecha ao clicar fora
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        dropRef.current && !dropRef.current.contains(e.target as Node) &&
        btnRef.current && !btnRef.current.contains(e.target as Node)
      ) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Recalcula posição ao scrollar ou redimensionar
  useEffect(() => {
    if (!open) return;
    const update = () => {
      if (btnRef.current) {
        const r = btnRef.current.getBoundingClientRect();
        setPos({ top: r.bottom + 4, left: r.left, width: r.width });
      }
    };
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => { window.removeEventListener('scroll', update, true); window.removeEventListener('resize', update); };
  }, [open]);

  const handleOpen = () => {
    if (disabled) return;
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 4, left: r.left, width: r.width });
    }
    setOpen(v => !v);
  };

  const selected = options.find(o => o.value === value);

  return (
    <div className={`relative ${className ?? ''}`}>
      <button
        ref={btnRef}
        type="button"
        disabled={disabled}
        onClick={handleOpen}
        className={[
          'w-full flex items-center justify-between gap-2 px-3 py-2 text-sm rounded-lg',
          'border border-gray-200 dark:border-gray-700',
          'bg-white dark:bg-gray-900',
          'focus:outline-none focus:ring-2 focus:ring-violet-500',
          'transition-colors',
          disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:border-violet-400 dark:hover:border-violet-500',
        ].join(' ')}
      >
        <span className={selected ? 'text-gray-900 dark:text-white' : 'text-gray-400 dark:text-gray-500'}>
          {selected?.label ?? placeholder}
        </span>
        <ChevronDown className={`w-4 h-4 text-gray-400 flex-shrink-0 transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && createPortal(
        <div
          ref={dropRef}
          style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width, zIndex: 9999 }}
          className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-2xl overflow-hidden"
        >
          <div className="max-h-52 overflow-y-auto">
            {nullable && (
              <button
                type="button"
                onClick={() => { onChange(''); setOpen(false); }}
                className={[
                  'w-full text-left px-3 py-2.5 text-sm transition-colors',
                  !value
                    ? 'bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-300 font-medium'
                    : 'text-gray-400 dark:text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800',
                ].join(' ')}
              >
                {placeholder}
              </button>
            )}
            {options.map(opt => (
              <button
                key={opt.value}
                type="button"
                onClick={() => { onChange(opt.value); setOpen(false); }}
                className={[
                  'w-full flex items-center justify-between px-3 py-2.5 text-sm transition-colors',
                  opt.value === value
                    ? 'bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-300 font-medium'
                    : 'text-gray-800 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800',
                ].join(' ')}
              >
                {opt.label}
                {opt.value === value && <Check className="w-3.5 h-3.5 flex-shrink-0" />}
              </button>
            ))}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

// ── DatePicker customizado ────────────────────────────────────────────────────
interface DatePickerProps {
  value: string; // YYYY-MM-DD
  onChange: (date: string) => void;
  placeholder?: string;
  className?: string;
}

const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const DIAS_SEMANA = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];

function parseDateSafe(value: string): Date | null {
  if (!value) return null;
  const d = new Date(value + 'T12:00:00');
  return isNaN(d.getTime()) ? null : d;
}

export function DatePicker({ value, onChange, placeholder = 'Selecionar data', className }: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  const selectedDate = parseDateSafe(value);
  const today = new Date();

  const [viewYear, setViewYear] = useState(selectedDate?.getFullYear() ?? today.getFullYear());
  const [viewMonth, setViewMonth] = useState(selectedDate?.getMonth() ?? today.getMonth());

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        dropRef.current && !dropRef.current.contains(e.target as Node) &&
        btnRef.current && !btnRef.current.contains(e.target as Node)
      ) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleOpen = () => {
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      // Abre acima se não couber embaixo
      const calH = 320;
      const spaceBelow = window.innerHeight - r.bottom;
      const top = spaceBelow > calH ? r.bottom + 4 : r.top - calH - 4;
      setPos({ top, left: r.left });
    }
    setOpen(v => !v);
  };

  const prevMonth = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
    else setViewMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
    else setViewMonth(m => m + 1);
  };

  // Dias do mês
  const firstDay = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  // Preenche até múltiplo de 7
  while (cells.length % 7 !== 0) cells.push(null);

  const selectDay = (day: number) => {
    const d = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    onChange(d);
    setOpen(false);
  };

  const isSelected = (day: number) => {
    if (!selectedDate) return false;
    return selectedDate.getFullYear() === viewYear &&
      selectedDate.getMonth() === viewMonth &&
      selectedDate.getDate() === day;
  };

  const isToday = (day: number) =>
    today.getFullYear() === viewYear && today.getMonth() === viewMonth && today.getDate() === day;

  const displayValue = selectedDate
    ? selectedDate.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
    : '';

  return (
    <div className={`relative ${className ?? ''}`}>
      <button
        ref={btnRef}
        type="button"
        onClick={handleOpen}
        className={[
          'w-full flex items-center justify-between gap-2 px-3 py-2 text-sm rounded-lg',
          'border border-gray-200 dark:border-gray-700',
          'bg-white dark:bg-gray-900',
          'focus:outline-none focus:ring-2 focus:ring-violet-500',
          'cursor-pointer hover:border-violet-400 dark:hover:border-violet-500 transition-colors',
        ].join(' ')}
      >
        <span className={displayValue ? 'text-gray-900 dark:text-white' : 'text-gray-400 dark:text-gray-500'}>
          {displayValue || placeholder}
        </span>
        <Calendar className="w-4 h-4 text-gray-400 flex-shrink-0" />
      </button>

      {open && createPortal(
        <div
          ref={dropRef}
          style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 9999, width: 280 }}
          className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-2xl overflow-hidden"
        >
          {/* Cabeçalho mes/ano */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800">
            <button type="button" onClick={prevMonth} className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
              <ChevronLeft className="w-4 h-4 text-gray-500" />
            </button>
            <span className="text-sm font-semibold text-gray-800 dark:text-white">
              {MESES[viewMonth]} {viewYear}
            </span>
            <button type="button" onClick={nextMonth} className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
              <ChevronRight className="w-4 h-4 text-gray-500" />
            </button>
          </div>

          {/* Dias da semana */}
          <div className="grid grid-cols-7 px-3 pt-2">
            {DIAS_SEMANA.map(d => (
              <div key={d} className="text-center text-xs font-medium text-gray-400 dark:text-gray-500 py-1">
                {d}
              </div>
            ))}
          </div>

          {/* Grade de dias */}
          <div className="grid grid-cols-7 px-3 pb-3 gap-y-0.5">
            {cells.map((day, i) => (
              <div key={i} className="flex items-center justify-center">
                {day !== null ? (
                  <button
                    type="button"
                    onClick={() => selectDay(day)}
                    className={[
                      'w-8 h-8 rounded-full text-xs font-medium transition-colors',
                      isSelected(day)
                        ? 'bg-violet-600 text-white'
                        : isToday(day)
                        ? 'bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300'
                        : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800',
                    ].join(' ')}
                  >
                    {day}
                  </button>
                ) : null}
              </div>
            ))}
          </div>

          {/* Botão hoje */}
          <div className="px-3 pb-3">
            <button
              type="button"
              onClick={() => {
                const t = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
                onChange(t);
                setOpen(false);
              }}
              className="w-full py-1.5 text-xs font-medium text-violet-600 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-900/20 rounded-lg transition-colors"
            >
              Hoje
            </button>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

// ── Toggle (substitui checkbox) ───────────────────────────────────────────────
interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  description?: string;
}

export function Toggle({ checked, onChange, label, description }: ToggleProps) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex items-center gap-3 group text-left w-full"
    >
      <span
        className={[
          'relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors duration-200',
          checked ? 'bg-violet-600' : 'bg-gray-200 dark:bg-gray-700',
        ].join(' ')}
      >
        <span
          className={[
            'inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-sm transition-transform duration-200',
            checked ? 'translate-x-[18px]' : 'translate-x-[3px]',
          ].join(' ')}
        />
      </span>
      {label && (
        <span className="flex flex-col">
          <span className="text-sm text-gray-700 dark:text-gray-300 font-medium">{label}</span>
          {description && <span className="text-xs text-gray-400 dark:text-gray-500">{description}</span>}
        </span>
      )}
    </button>
  );
}

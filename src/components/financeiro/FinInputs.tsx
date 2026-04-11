import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';
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

// ── FinSelect (dropdown customizado) ─────────────────────────────────────────
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
  nullable?: boolean; // se true, mostra o placeholder como opção selecionável
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
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const selected = options.find(o => o.value === value);

  return (
    <div ref={ref} className={`relative ${className ?? ''}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(v => !v)}
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

      {open && (
        <div className="absolute z-[9999] top-full left-0 right-0 mt-1 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl overflow-hidden">
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
        </div>
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
      {/* Track */}
      <span
        className={[
          'relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors duration-200',
          checked ? 'bg-violet-600' : 'bg-gray-200 dark:bg-gray-700',
        ].join(' ')}
      >
        {/* Thumb */}
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

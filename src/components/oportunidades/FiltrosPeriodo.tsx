import React from 'react';
import { cn } from '../../utils/cn';

interface FiltrosPeriodoProps {
  value: 'hoje' | 'semana' | 'mes';
  onChange: (v: 'hoje' | 'semana' | 'mes') => void;
}

const options = [
  { value: 'hoje', label: 'Hoje' },
  { value: 'semana', label: 'Esta Semana' },
  { value: 'mes', label: 'Este Mês' },
] as const;

export function FiltrosPeriodo({ value, onChange }: FiltrosPeriodoProps) {
  return (
    <div className="flex gap-2">
      {options.map(opt => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={cn(
            'px-4 py-2 rounded-xl text-sm font-medium transition-all',
            value === opt.value
              ? 'bg-indigo-600 text-white shadow-sm'
              : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700 hover:border-indigo-300 dark:hover:border-indigo-600'
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

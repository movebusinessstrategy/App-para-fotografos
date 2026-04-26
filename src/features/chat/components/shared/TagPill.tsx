import React from 'react';
import { X } from 'lucide-react';

interface Props {
  label: string;
  color?: string;
  onRemove?: () => void;
}

export function TagPill({ label, color, onRemove }: Props) {
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium"
      style={
        color
          ? { background: `${color}28`, color }
          : {
              background: 'rgba(181,193,157,0.14)',
              color: '#B5C19D',
            }
      }
    >
      {!color && <span className="w-1.5 h-1.5 rounded-full bg-[#B5C19D] flex-shrink-0" />}
      {label}
      {onRemove && (
        <button
          onClick={onRemove}
          className="ml-0.5 opacity-50 hover:opacity-100 transition-opacity"
        >
          <X size={10} />
        </button>
      )}
    </span>
  );
}

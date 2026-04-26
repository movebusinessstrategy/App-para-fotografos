import React from 'react';
import { LayoutGrid, ArrowRight } from 'lucide-react';
import { Deal, PipelineStage } from '../../../types';

interface Props {
  deal: Deal;
  stage: PipelineStage | undefined;
}

export function LinkedSessionBanner({ deal, stage }: Props) {
  return (
    <div
      className="mx-4 my-3 px-3 py-2.5 rounded-xl flex items-center justify-between gap-3"
      style={{
        background: 'rgba(181,193,157,0.08)',
        border: '1px solid rgba(181,193,157,0.16)',
      }}
    >
      <div className="flex items-center gap-2 min-w-0">
        <LayoutGrid size={13} style={{ color: '#B5C19D', flexShrink: 0 }} />
        <div className="min-w-0">
          <p className="text-[11px] font-semibold truncate" style={{ color: '#B5C19D' }}>
            {deal.title}
          </p>
          {stage && (
            <p className="text-[10px]" style={{ color: '#758966' }}>
              {stage.name}
            </p>
          )}
        </div>
      </div>
      <div className="flex-shrink-0 flex items-center gap-1 text-[10px] font-semibold" style={{ color: '#758966' }}>
        {deal.value > 0 &&
          new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(deal.value)}
        <ArrowRight size={11} />
      </div>
    </div>
  );
}

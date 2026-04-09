import React from 'react';
import { Gift } from 'lucide-react';
import { Aniversariante } from '../../types';
import { AniversarianteCard } from './AniversarianteCard';

interface AniversariantesListProps {
  data: Aniversariante[];
  loading: boolean;
  onWhatsApp: (a: Aniversariante) => void;
  onCupom: (a: Aniversariante) => void;
  onCriarOportunidade: (a: Aniversariante) => void;
}

export function AniversariantesList({ data, loading, onWhatsApp, onCupom, onCriarOportunidade }: AniversariantesListProps) {
  if (loading) {
    return (
      <div className="space-y-3">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 p-4 h-20 animate-pulse" />
        ))}
      </div>
    );
  }

  if (!data.length) {
    return (
      <div className="text-center py-16">
        <div className="w-16 h-16 bg-gray-50 dark:bg-gray-800 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <Gift size={28} className="text-gray-400" />
        </div>
        <p className="text-gray-500 dark:text-gray-400 font-medium">Nenhum aniversariante neste período</p>
        <p className="text-gray-400 dark:text-gray-500 text-sm mt-1">Adicione datas de nascimento nas fichas dos clientes</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {data.map((a, i) => (
        <React.Fragment key={`${a.tipo}-${a.clienteId}-${i}`}>
          <AniversarianteCard
            aniversariante={a}
            onWhatsApp={onWhatsApp}
            onCupom={onCupom}
            onCriarOportunidade={onCriarOportunidade}
          />
        </React.Fragment>
      ))}
    </div>
  );
}

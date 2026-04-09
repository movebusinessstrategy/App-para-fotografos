import React from 'react';
import { Gift, MessageCircle, Ticket, Plus, Baby } from 'lucide-react';
import { Aniversariante } from '../../types';
import { cn } from '../../utils/cn';

interface AniversarianteCardProps {
  aniversariante: Aniversariante;
  onWhatsApp: (a: Aniversariante) => void;
  onCupom: (a: Aniversariante) => void;
  onCriarOportunidade: (a: Aniversariante) => void;
}

const nivelColors: Record<string, string> = {
  Diamond: 'bg-cyan-50 dark:bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 border-cyan-200 dark:border-cyan-500/30',
  Platinum: 'bg-purple-50 dark:bg-purple-500/20 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-500/30',
  Gold: 'bg-amber-50 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-500/30',
  Silver: 'bg-gray-50 dark:bg-gray-700/50 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-600',
  Bronze: 'bg-orange-50 dark:bg-orange-500/20 text-orange-700 dark:text-orange-300 border-orange-200 dark:border-orange-500/30',
  active: 'bg-emerald-50 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30',
};

export function AniversarianteCard({ aniversariante: a, onWhatsApp, onCupom, onCriarOportunidade }: AniversarianteCardProps) {
  const hoje = a.diasParaAniversario === 0;
  const dataFormatada = new Date(a.dataNascimento + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  const nivelKey = a.nivel || 'Bronze';
  const nivelClass = nivelColors[nivelKey] || nivelColors.Bronze;

  return (
    <div className={cn(
      'bg-white dark:bg-gray-900 rounded-2xl border p-4 transition-all',
      hoje
        ? 'border-pink-200 dark:border-pink-500/40 shadow-md shadow-pink-50 dark:shadow-pink-500/10'
        : 'border-gray-100 dark:border-gray-800'
    )}>
      <div className="flex items-center gap-4">
        {/* Avatar */}
        <div className={cn(
          'w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0',
          hoje ? 'bg-pink-100 dark:bg-pink-500/20' : 'bg-gray-50 dark:bg-gray-800'
        )}>
          {a.tipo === 'MAE'
            ? <Gift size={22} className={hoje ? 'text-pink-600' : 'text-gray-500 dark:text-gray-400'} />
            : <Baby size={22} className={hoje ? 'text-blue-600' : 'text-gray-500 dark:text-gray-400'} />
          }
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-1.5 mb-0.5">
            <span className="font-semibold text-gray-900 dark:text-white text-sm truncate">{a.nome}</span>
            <span className={cn('px-1.5 py-0.5 rounded text-xs font-medium border',
              a.tipo === 'MAE'
                ? 'bg-pink-50 dark:bg-pink-500/20 text-pink-700 dark:text-pink-300 border-pink-200 dark:border-pink-500/30'
                : 'bg-blue-50 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-500/30'
            )}>
              {a.tipo === 'MAE' ? 'Mae' : 'Filho(a)'}
            </span>
            <span className={cn('px-1.5 py-0.5 rounded text-xs font-medium border', nivelClass)}>
              {nivelKey}
            </span>
            {hoje && (
              <span className="px-1.5 py-0.5 rounded text-xs font-bold bg-pink-500 text-white animate-pulse">
                HOJE!
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {a.tipo === 'FILHO' && a.clienteNome !== a.nome && (
              <span className="mr-1">Filho(a) de {a.clienteNome} ·</span>
            )}
            {hoje
              ? `Completando ${a.idade + 1} ${a.idade + 1 === 1 ? 'ano' : 'anos'} hoje!`
              : `Faz ${a.idade + 1} ${a.idade + 1 === 1 ? 'ano' : 'anos'} em ${dataFormatada} (em ${a.diasParaAniversario} dias)`
            }
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button
            onClick={() => onWhatsApp(a)}
            title="WhatsApp"
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-emerald-50 hover:border-emerald-300 hover:text-emerald-700 dark:hover:bg-emerald-500/10 dark:hover:border-emerald-500/40 dark:hover:text-emerald-400 transition-all"
          >
            <MessageCircle size={13} />
            <span className="hidden sm:inline">WhatsApp</span>
          </button>
          <button
            onClick={() => onCupom(a)}
            title="Gerar Cupom"
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-indigo-50 hover:border-indigo-300 hover:text-indigo-700 dark:hover:bg-indigo-500/10 dark:hover:border-indigo-500/40 dark:hover:text-indigo-400 transition-all"
          >
            <Ticket size={13} />
            <span className="hidden sm:inline">Cupom</span>
          </button>
          <button
            onClick={() => onCriarOportunidade(a)}
            title="Criar Oportunidade"
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-xs font-medium text-white transition-colors"
          >
            <Plus size={13} />
            <span className="hidden sm:inline">Oferta</span>
          </button>
        </div>
      </div>
    </div>
  );
}

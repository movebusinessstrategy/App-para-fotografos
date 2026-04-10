import React, { useState } from 'react';
import { X, Ticket } from 'lucide-react';
import { Aniversariante } from '../../types';
import { oportunidadesApi } from '../../services/api/oportunidades';

interface GerarCupomModalProps {
  aniversariante: Aniversariante | null;
  onClose: () => void;
  onSuccess: (cupom: any) => void;
}

export function GerarCupomModal({ aniversariante, onClose, onSuccess }: GerarCupomModalProps) {
  const [tipoDesconto, setTipoDesconto] = useState<'PERCENTUAL' | 'VALOR_FIXO'>('PERCENTUAL');
  const [valorDesconto, setValorDesconto] = useState('15');
  const [dataValidade, setDataValidade] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return d.toISOString().split('T')[0];
  });
  const [loading, setLoading] = useState(false);
  const [cupomGerado, setCupomGerado] = useState<any>(null);

  if (!aniversariante) return null;

  const handleGerar = async () => {
    setLoading(true);
    try {
      const cupom = await oportunidadesApi.createCupom({
        cliente_id: aniversariante.clienteId,
        tipo_desconto: tipoDesconto,
        valor_desconto: Number(valorDesconto),
        data_validade: dataValidade,
      } as any);
      setCupomGerado(cupom);
      onSuccess(cupom);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between p-6 border-b border-gray-100 dark:border-gray-800">
          <div className="flex items-center gap-3">
            <Ticket size={20} className="text-gold-500" />
            <h2 className="font-bold text-gray-900 dark:text-white">Gerar Cupom</h2>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400">
            <X size={18} />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <p className="text-sm text-gray-500 dark:text-gray-400">Para: <span className="font-semibold text-gray-900 dark:text-white">{aniversariante.nome}</span></p>
          </div>

          {cupomGerado ? (
            <div className="text-center py-6">
              <div className="w-16 h-16 bg-emerald-50 dark:bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <Ticket size={28} className="text-emerald-600" />
              </div>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">Cupom gerado com sucesso!</p>
              <p className="text-3xl font-bold text-gold-600 tracking-widest font-mono">{cupomGerado.codigo}</p>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
                {tipoDesconto === 'PERCENTUAL' ? `${valorDesconto}% de desconto` : `R$ ${valorDesconto} de desconto`}
                {' '} · válido até {new Date(dataValidade + 'T12:00:00').toLocaleDateString('pt-BR')}
              </p>
            </div>
          ) : (
            <>
              <div>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1 block">Tipo de desconto</label>
                <div className="flex gap-2">
                  {(['PERCENTUAL', 'VALOR_FIXO'] as const).map(t => (
                    <button
                      key={t}
                      onClick={() => setTipoDesconto(t)}
                      className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-all ${tipoDesconto === t ? 'bg-gold-600 border-gold-600 text-white' : 'border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300'}`}
                    >
                      {t === 'PERCENTUAL' ? '% Percentual' : 'R$ Valor Fixo'}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1 block">
                  {tipoDesconto === 'PERCENTUAL' ? 'Percentual (%)' : 'Valor (R$)'}
                </label>
                <input
                  type="number"
                  value={valorDesconto}
                  onChange={e => setValorDesconto(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm"
                />
              </div>

              <div>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1 block">Válido até</label>
                <input
                  type="date"
                  value={dataValidade}
                  onChange={e => setDataValidade(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm"
                />
              </div>

              <button
                onClick={handleGerar}
                disabled={loading}
                className="w-full py-3 bg-gold-600 hover:bg-gold-700 disabled:opacity-50 text-white rounded-xl font-medium text-sm transition-colors"
              >
                {loading ? 'Gerando...' : 'Gerar Cupom'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

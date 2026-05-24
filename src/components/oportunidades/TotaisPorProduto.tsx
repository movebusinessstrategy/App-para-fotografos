import { useEffect, useState } from 'react';
import { TrendingUp, Loader2, AlertCircle } from 'lucide-react';
import { authFetch } from '../../utils/authFetch';

interface Bucket {
  total_estimado: number;
  total_convertido: number;
  qtd_aberta: number;
  qtd_convertida: number;
  usando_estimativa?: boolean;
}

const brl = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export function TotaisPorProduto() {
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    authFetch('/api/oportunidades/totais-por-produto')
      .then(async r => {
        if (!r.ok) {
          const e = await r.json().catch(() => ({}));
          throw new Error(e.error || `HTTP ${r.status}`);
        }
        return r.json();
      })
      .then(setBuckets)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-6 flex items-center gap-2 text-sm text-gray-400">
        <Loader2 size={14} className="animate-spin" /> Carregando totais...
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 rounded-2xl p-4 flex items-center gap-2 text-sm text-rose-700 dark:text-rose-300">
        <AlertCircle size={14} />
        Erro ao carregar totais: {error}
      </div>
    );
  }

  const totalEstimado = buckets.reduce((s, b) => s + b.total_estimado, 0);
  const totalConvertido = buckets.reduce((s, b) => s + b.total_convertido, 0);
  const qtdAberta = buckets.reduce((s, b) => s + b.qtd_aberta, 0);
  const qtdConvertida = buckets.reduce((s, b) => s + b.qtd_convertida, 0);
  const usandoEstimativa = buckets.some(b => b.usando_estimativa);

  return (
    <div className="bg-gradient-to-br from-gold-50 to-white dark:from-gold-500/10 dark:to-gray-900 border border-gold-200 dark:border-gold-500/20 rounded-2xl p-5 flex items-center justify-between gap-4 flex-wrap">
      <div>
        <p className="text-xs font-bold uppercase tracking-wider text-gold-700 dark:text-gold-400 mb-1">
          Oportunidades pra vender
        </p>
        <p className="text-3xl sm:text-4xl font-extrabold text-gray-900 dark:text-white">
          {brl(totalEstimado)}
        </p>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          {qtdAberta} oportunidade{qtdAberta === 1 ? '' : 's'} em aberto
          {usandoEstimativa && ' · estimado pelo pacote base'}
        </p>
      </div>
      {totalConvertido > 0 && (
        <div className="text-right">
          <p className="text-xs font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 mb-1 flex items-center gap-1 justify-end">
            <TrendingUp size={11} /> Convertido
          </p>
          <p className="text-xl sm:text-2xl font-bold text-emerald-600 dark:text-emerald-400">
            {brl(totalConvertido)}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            {qtdConvertida} fechada{qtdConvertida === 1 ? '' : 's'}
          </p>
        </div>
      )}
    </div>
  );
}

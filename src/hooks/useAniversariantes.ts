import { useCallback, useEffect, useState } from 'react';
import { Aniversariante } from '../types';
import { oportunidadesApi } from '../services/api/oportunidades';

export function useAniversariantes(periodo: 'hoje' | 'semana' | 'mes' = 'hoje') {
  const [data, setData] = useState<Aniversariante[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await oportunidadesApi.getAniversariantes(periodo);
      setData(result);
    } catch (e: any) {
      setError(e.message || 'Erro ao carregar aniversariantes');
    } finally {
      setLoading(false);
    }
  }, [periodo]);

  useEffect(() => { fetch(); }, [fetch]);

  return { data, loading, error, refetch: fetch };
}

import { useCallback, useEffect, useState } from 'react';
import { Oportunidade } from '../types';
import { oportunidadesApi } from '../services/api/oportunidades';

export function useOportunidades() {
  const [data, setData] = useState<Oportunidade[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await oportunidadesApi.getOportunidades();
      setData(result);
    } catch (e: any) {
      setError(e.message || 'Erro ao carregar oportunidades');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  const update = async (id: string, updates: Partial<Oportunidade>) => {
    await oportunidadesApi.updateOportunidade(id, updates);
    setData(prev => prev.map(o => o.id === id ? { ...o, ...updates } : o));
  };

  return { data, loading, error, refetch: fetch, update };
}

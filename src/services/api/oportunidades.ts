import { authFetch } from '../../utils/authFetch';
import { Aniversariante, Cupom, Filho, Oportunidade } from '../../types';

export const oportunidadesApi = {
  getDashboard: async () => {
    const res = await authFetch('/api/oportunidades/dashboard');
    return res.json();
  },

  getAniversariantes: async (periodo: 'hoje' | 'semana' | 'mes' = 'hoje'): Promise<Aniversariante[]> => {
    const res = await authFetch(`/api/oportunidades/aniversariantes?periodo=${periodo}`);
    return res.json();
  },

  getSmashTheCake: async () => {
    const res = await authFetch('/api/oportunidades/smash-the-cake');
    return res.json();
  },

  getAcompanhamentos: async () => {
    const res = await authFetch('/api/oportunidades/acompanhamentos');
    return res.json();
  },

  getNewborn: async () => {
    const res = await authFetch('/api/oportunidades/newborn');
    return res.json();
  },

  getAniversario: async () => {
    const res = await authFetch('/api/oportunidades/aniversario');
    return res.json();
  },

  getOportunidades: async (): Promise<Oportunidade[]> => {
    const res = await authFetch('/api/oportunidades');
    return res.json();
  },

  createOportunidade: async (data: Partial<Oportunidade>) => {
    const res = await authFetch('/api/oportunidades', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return res.json();
  },

  updateOportunidade: async (id: string, data: Partial<Oportunidade>) => {
    const res = await authFetch(`/api/oportunidades/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
    return res.json();
  },

  getFilhos: async (clienteId: number): Promise<Filho[]> => {
    const res = await authFetch(`/api/filhos/cliente/${clienteId}`);
    return res.json();
  },

  createFilho: async (data: { cliente_id: number; nome: string; data_nascimento: string; sexo?: string }): Promise<Filho> => {
    const res = await authFetch('/api/filhos', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return res.json();
  },

  deleteFilho: async (id: string) => {
    const res = await authFetch(`/api/filhos/${id}`, { method: 'DELETE' });
    return res.json();
  },

  createCupom: async (data: Partial<Cupom>): Promise<Cupom> => {
    const res = await authFetch('/api/cupons', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return res.json();
  },

  updateMaeNascimento: async (clienteId: number, mae_nascimento: string) => {
    const res = await authFetch(`/api/clients/${clienteId}/mae-nascimento`, {
      method: 'PATCH',
      body: JSON.stringify({ mae_nascimento }),
    });
    return res.json();
  },
};

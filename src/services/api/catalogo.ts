import { authFetch } from '../../utils/authFetch';
import { Fornecedor, Produto, Servico, Combo } from '../../types';

export const catalogoApi = {
  // ── Fornecedores ────────────────────────────────────────────────
  getFornecedores: async (): Promise<Fornecedor[]> => {
    const res = await authFetch('/api/fornecedores');
    return res.json();
  },

  createFornecedor: async (data: Partial<Fornecedor>): Promise<Fornecedor> => {
    const res = await authFetch('/api/fornecedores', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return res.json();
  },

  updateFornecedor: async (id: string, data: Partial<Fornecedor>): Promise<Fornecedor> => {
    const res = await authFetch(`/api/fornecedores/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
    return res.json();
  },

  deleteFornecedor: async (id: string): Promise<void> => {
    await authFetch(`/api/fornecedores/${id}`, { method: 'DELETE' });
  },

  // ── Produtos ─────────────────────────────────────────────────────
  getProdutos: async (): Promise<Produto[]> => {
    const res = await authFetch('/api/produtos');
    return res.json();
  },

  createProduto: async (data: Partial<Produto>): Promise<Produto> => {
    const res = await authFetch('/api/produtos', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return res.json();
  },

  updateProduto: async (id: string, data: Partial<Produto>): Promise<Produto> => {
    const res = await authFetch(`/api/produtos/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
    return res.json();
  },

  deleteProduto: async (id: string): Promise<void> => {
    await authFetch(`/api/produtos/${id}`, { method: 'DELETE' });
  },

  // ── Serviços ─────────────────────────────────────────────────────
  getServicos: async (): Promise<Servico[]> => {
    const res = await authFetch('/api/servicos');
    return res.json();
  },

  createServico: async (data: Partial<Servico>): Promise<Servico> => {
    const res = await authFetch('/api/servicos', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return res.json();
  },

  updateServico: async (id: string, data: Partial<Servico>): Promise<Servico> => {
    const res = await authFetch(`/api/servicos/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
    return res.json();
  },

  deleteServico: async (id: string): Promise<void> => {
    await authFetch(`/api/servicos/${id}`, { method: 'DELETE' });
  },

  // ── Combos ───────────────────────────────────────────────────────
  getCombos: async (): Promise<Combo[]> => {
    const res = await authFetch('/api/combos');
    return res.json();
  },

  createCombo: async (data: Partial<Combo>): Promise<Combo> => {
    const res = await authFetch('/api/combos', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return res.json();
  },

  updateCombo: async (id: string, data: Partial<Combo>): Promise<Combo> => {
    const res = await authFetch(`/api/combos/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
    return res.json();
  },

  deleteCombo: async (id: string): Promise<void> => {
    await authFetch(`/api/combos/${id}`, { method: 'DELETE' });
  },
};

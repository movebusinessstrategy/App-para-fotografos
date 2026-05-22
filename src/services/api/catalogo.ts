import { authFetch } from '../../utils/authFetch';
import { Fornecedor, Produto, Servico, Combo, CategoriaCatalogo, TipoEnsaio, Compra } from '../../types';

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || body.message || `Erro ${res.status}`);
  }
  return res.json();
}

export const catalogoApi = {
  // ── Fornecedores ────────────────────────────────────────────────
  getFornecedores: async (): Promise<Fornecedor[]> => {
    const res = await authFetch('/api/fornecedores');
    return handle<Fornecedor[]>(res);
  },

  createFornecedor: async (data: Partial<Fornecedor>): Promise<Fornecedor> => {
    const res = await authFetch('/api/fornecedores', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return handle<Fornecedor>(res);
  },

  updateFornecedor: async (id: string, data: Partial<Fornecedor>): Promise<Fornecedor> => {
    const res = await authFetch(`/api/fornecedores/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
    return handle<Fornecedor>(res);
  },

  deleteFornecedor: async (id: string): Promise<void> => {
    const res = await authFetch(`/api/fornecedores/${id}`, { method: 'DELETE' });
    await handle<void>(res);
  },

  // ── Produtos ─────────────────────────────────────────────────────
  getProdutos: async (): Promise<Produto[]> => {
    const res = await authFetch('/api/produtos');
    return handle<Produto[]>(res);
  },

  createProduto: async (data: Partial<Produto>): Promise<Produto> => {
    const res = await authFetch('/api/produtos', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return handle<Produto>(res);
  },

  updateProduto: async (id: string, data: Partial<Produto>): Promise<Produto> => {
    const res = await authFetch(`/api/produtos/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
    return handle<Produto>(res);
  },

  deleteProduto: async (id: string): Promise<void> => {
    const res = await authFetch(`/api/produtos/${id}`, { method: 'DELETE' });
    await handle<void>(res);
  },

  // ── Serviços ─────────────────────────────────────────────────────
  getServicos: async (): Promise<Servico[]> => {
    const res = await authFetch('/api/servicos');
    return handle<Servico[]>(res);
  },

  createServico: async (data: Partial<Servico>): Promise<Servico> => {
    const res = await authFetch('/api/servicos', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return handle<Servico>(res);
  },

  updateServico: async (id: string, data: Partial<Servico>): Promise<Servico> => {
    const res = await authFetch(`/api/servicos/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
    return handle<Servico>(res);
  },

  deleteServico: async (id: string): Promise<void> => {
    const res = await authFetch(`/api/servicos/${id}`, { method: 'DELETE' });
    await handle<void>(res);
  },

  // ── Categorias Produto ───────────────────────────────────────────
  getCategorias: async (): Promise<CategoriaCatalogo[]> => {
    const res = await authFetch('/api/categorias-produto');
    return handle<CategoriaCatalogo[]>(res);
  },

  createCategoria: async (data: Partial<CategoriaCatalogo>): Promise<CategoriaCatalogo> => {
    const res = await authFetch('/api/categorias-produto', { method: 'POST', body: JSON.stringify(data) });
    return handle<CategoriaCatalogo>(res);
  },

  updateCategoria: async (id: string, data: Partial<CategoriaCatalogo>): Promise<CategoriaCatalogo> => {
    const res = await authFetch(`/api/categorias-produto/${id}`, { method: 'PUT', body: JSON.stringify(data) });
    return handle<CategoriaCatalogo>(res);
  },

  deleteCategoria: async (id: string): Promise<void> => {
    const res = await authFetch(`/api/categorias-produto/${id}`, { method: 'DELETE' });
    await handle<void>(res);
  },

  // ── Tipos de Ensaio ──────────────────────────────────────────────
  getTiposEnsaio: async (): Promise<TipoEnsaio[]> => {
    const res = await authFetch('/api/tipos-ensaio');
    return handle<TipoEnsaio[]>(res);
  },

  createTipoEnsaio: async (data: Partial<TipoEnsaio>): Promise<TipoEnsaio> => {
    const res = await authFetch('/api/tipos-ensaio', { method: 'POST', body: JSON.stringify(data) });
    return handle<TipoEnsaio>(res);
  },

  updateTipoEnsaio: async (id: string, data: Partial<TipoEnsaio>): Promise<TipoEnsaio> => {
    const res = await authFetch(`/api/tipos-ensaio/${id}`, { method: 'PUT', body: JSON.stringify(data) });
    return handle<TipoEnsaio>(res);
  },

  deleteTipoEnsaio: async (id: string): Promise<void> => {
    const res = await authFetch(`/api/tipos-ensaio/${id}`, { method: 'DELETE' });
    await handle<void>(res);
  },

  // ── CNPJ lookup ──────────────────────────────────────────────────
  lookupCnpj: async (cnpj: string): Promise<Record<string, unknown>> => {
    const res = await authFetch(`/api/cnpj/${cnpj.replace(/\D/g, '')}`);
    if (!res.ok) throw new Error((await res.json()).error || 'CNPJ não encontrado');
    return res.json();
  },

  // ── Combos ───────────────────────────────────────────────────────
  getCombos: async (): Promise<Combo[]> => {
    const res = await authFetch('/api/combos');
    return handle<Combo[]>(res);
  },

  createCombo: async (data: Partial<Combo>): Promise<Combo> => {
    const res = await authFetch('/api/combos', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return handle<Combo>(res);
  },

  updateCombo: async (id: string, data: Partial<Combo>): Promise<Combo> => {
    const res = await authFetch(`/api/combos/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
    return handle<Combo>(res);
  },

  deleteCombo: async (id: string): Promise<void> => {
    const res = await authFetch(`/api/combos/${id}`, { method: 'DELETE' });
    await handle<void>(res);
  },

  // ── Compras (reposição de estoque) ───────────────────────────────
  getCompras: async (): Promise<Compra[]> => {
    const res = await authFetch('/api/compras');
    return handle<Compra[]>(res);
  },

  createCompra: async (data: { produto_id: string; quantidade: number; observacao?: string }): Promise<Compra> => {
    const res = await authFetch('/api/compras', { method: 'POST', body: JSON.stringify(data) });
    return handle<Compra>(res);
  },

  updateCompra: async (id: string, data: Partial<Compra>): Promise<Compra> => {
    const res = await authFetch(`/api/compras/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
    return handle<Compra>(res);
  },

  deleteCompra: async (id: string): Promise<void> => {
    const res = await authFetch(`/api/compras/${id}`, { method: 'DELETE' });
    await handle<void>(res);
  },

  backfillCompras: async (): Promise<{ created: number; message?: string }> => {
    const res = await authFetch('/api/compras/backfill', { method: 'POST' });
    return handle<{ created: number; message?: string }>(res);
  },
};

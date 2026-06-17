// Utilitários compartilhados do módulo financeiro

export const fmtBRL = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);

export const fmtDate = (d: string | null | undefined) => {
  if (!d) return '—';
  return new Date(d + 'T12:00:00').toLocaleDateString('pt-BR');
};

export const STATUS_RECEITA_LABEL: Record<string, string> = {
  pendente: 'Pendente', recebido: 'Recebido', atrasado: 'Atrasado', cancelado: 'Cancelado',
};
export const STATUS_RECEITA_COLOR: Record<string, string> = {
  pendente: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300',
  recebido: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300',
  atrasado: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',
  cancelado: 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400',
};
export const STATUS_DESPESA_LABEL: Record<string, string> = {
  pendente: 'Pendente', pago: 'Pago', atrasado: 'Atrasado', cancelado: 'Cancelado',
};
export const STATUS_DESPESA_COLOR: Record<string, string> = {
  pendente: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300',
  pago: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300',
  atrasado: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',
  cancelado: 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400',
};

export const CATEGORIAS_RECEITA_PADRAO = [
  { nome: 'Ensaio fotográfico', cor: '#f59e0b' },
  { nome: 'Venda de produto', cor: '#6366f1' },
  { nome: 'Combo / Pacote', cor: '#8b5cf6' },
  { nome: 'Cobertura de evento', cor: '#0ea5e9' },
  { nome: 'Edição / Pós-produção', cor: '#ec4899' },
  { nome: 'Outros (receita)', cor: '#6b7280' },
];

export const CATEGORIAS_DESPESA_PADRAO = [
  { nome: 'Equipamento', cor: '#f43f5e' },
  { nome: 'Aluguel estúdio', cor: '#f97316' },
  { nome: 'Software / Assinatura', cor: '#8b5cf6' },
  { nome: 'Marketing', cor: '#ec4899' },
  { nome: 'Transporte / Gasolina', cor: '#6366f1' },
  { nome: 'Impostos', cor: '#ef4444' },
  { nome: 'Contador', cor: '#0ea5e9' },
  { nome: 'Props / Cenografia', cor: '#f59e0b' },
  { nome: 'Material gráfico', cor: '#10b981' },
  { nome: 'Fornecedor produto', cor: '#a855f7' },
  { nome: 'Internet / Telefone', cor: '#14b8a6' },
  { nome: 'Outros (despesa)', cor: '#6b7280' },
];

export const MEIOS_PADRAO = [
  { nome: 'PIX', tipo: 'pix', taxa_percentual: 0, taxa_fixa: 0, prazo_recebimento: 0 },
  { nome: 'Dinheiro', tipo: 'dinheiro', taxa_percentual: 0, taxa_fixa: 0, prazo_recebimento: 0 },
  { nome: 'Transferência', tipo: 'transferencia', taxa_percentual: 0, taxa_fixa: 0, prazo_recebimento: 0 },
  { nome: 'Cartão Débito', tipo: 'debito', taxa_percentual: 1.99, taxa_fixa: 0, prazo_recebimento: 1 },
  { nome: 'Cartão Crédito 1x', tipo: 'credito', taxa_percentual: 4.99, taxa_fixa: 0, prazo_recebimento: 30 },
  { nome: 'Cartão Crédito 2x', tipo: 'credito', taxa_percentual: 5.99, taxa_fixa: 0, prazo_recebimento: 60 },
  { nome: 'Cartão Crédito 3x', tipo: 'credito', taxa_percentual: 6.99, taxa_fixa: 0, prazo_recebimento: 90 },
  { nome: 'Boleto', tipo: 'boleto', taxa_percentual: 0, taxa_fixa: 3.5, prazo_recebimento: 2 },
  { nome: 'Link de Pagamento', tipo: 'link_pagamento', taxa_percentual: 4.49, taxa_fixa: 0, prazo_recebimento: 30 },
];

export const GRUPOS_DRE_PADRAO = [
  { nome: '(+) Receita Bruta', tipo: 'receita', operacao: 'soma', ordem: 1, campos_automaticos: [] },
  { nome: '(-) Deduções', tipo: 'deducao', operacao: 'subtrai', ordem: 2, total_parcial_apos: 'Receita Líquida', campos_automaticos: ['taxas_recebimento'] },
  { nome: '(-) Custos Diretos', tipo: 'custo', operacao: 'subtrai', ordem: 3, total_parcial_apos: 'Lucro Bruto', campos_automaticos: [] },
  { nome: '(-) Despesas Operacionais', tipo: 'despesa', operacao: 'subtrai', ordem: 4, total_parcial_apos: 'Resultado Operacional', campos_automaticos: [] },
  { nome: '(-) Impostos', tipo: 'imposto', operacao: 'subtrai', ordem: 5, total_parcial_apos: 'Resultado Líquido', campos_automaticos: [] },
];

export function exportCSV(linhas: any[], nomeArquivo: string) {
  if (!linhas.length) return;
  const keys = Object.keys(linhas[0]);
  // Aspas RFC-4180: campo com ; " ou quebra de linha vai entre "..." (e aspas
  // internas viram ""), senão um nome com ";" quebraria as colunas do arquivo.
  const cell = (v: any) => {
    const s = String(v ?? '');
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = keys.map(cell).join(';');
  const rows = linhas.map(l => keys.map(k => cell(l[k])).join(';')).join('\n');
  const blob = new Blob(['\uFEFF' + header + '\n' + rows], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = nomeArquivo; a.click();
  URL.revokeObjectURL(url);
}

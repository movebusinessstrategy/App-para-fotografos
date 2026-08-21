// Utilitários compartilhados do módulo financeiro

/**
 * Converte valores monetários digitados/colados no padrão brasileiro sem
 * confundir separador de milhar com casas decimais.
 *
 * Exemplos aceitos: `1.234,56`, `R$ 1.234,56`, `1234,56` e o valor canônico
 * `1234.56` usado internamente pelos inputs.
 */
export function parseBRLMoney(value: string | number | null | undefined): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;

  const source = String(value ?? '').trim();
  if (!source) return null;

  const negative = source.includes('-') || /^\(.*\)$/.test(source);
  const digitsAndSeparators = source.replace(/[^0-9,.]/g, '');
  if (!/\d/.test(digitsAndSeparators)) return null;

  const lastComma = digitsAndSeparators.lastIndexOf(',');
  const lastDot = digitsAndSeparators.lastIndexOf('.');
  const hasBothSeparators = lastComma >= 0 && lastDot >= 0;

  let normalized: string;
  if (hasBothSeparators) {
    const decimalSeparator = lastComma > lastDot ? ',' : '.';
    const decimalIndex = digitsAndSeparators.lastIndexOf(decimalSeparator);
    const integer = digitsAndSeparators.slice(0, decimalIndex).replace(/[^0-9]/g, '') || '0';
    const decimals = digitsAndSeparators.slice(decimalIndex + 1).replace(/[^0-9]/g, '');
    normalized = decimals ? `${integer}.${decimals}` : integer;
  } else if (lastComma >= 0) {
    const integer = digitsAndSeparators.slice(0, lastComma).replace(/[^0-9]/g, '') || '0';
    const decimals = digitsAndSeparators.slice(lastComma + 1).replace(/[^0-9]/g, '');
    normalized = decimals ? `${integer}.${decimals}` : integer;
  } else if (lastDot >= 0) {
    const groups = digitsAndSeparators.split('.');
    const usesThousands = groups.length > 2
      ? groups.slice(1).every(group => group.length === 3)
      : groups[1]?.length === 3;
    normalized = usesThousands ? groups.join('') : digitsAndSeparators;
  } else {
    normalized = digitsAndSeparators;
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  return negative ? -parsed : parsed;
}

/** Data civil de hoje em São Paulo, sem conversão acidental para UTC. */
export function todayInSaoPaulo(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

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
  { nome: 'Cartão Débito', tipo: 'debito', taxa_percentual: 0, taxa_fixa: 0, prazo_recebimento: 0 },
  { nome: 'Boleto', tipo: 'boleto', taxa_percentual: 0, taxa_fixa: 0, prazo_recebimento: 0 },
  // Cartão de crédito no estúdio significa link da InfinitePay. Taxa e prazo
  // começam zerados porque variam por plano e devem ser configurados com o real.
  { nome: 'Link InfinitePay', tipo: 'link_pagamento', taxa_percentual: 0, taxa_fixa: 0, prazo_recebimento: 0 },
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

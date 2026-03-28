import Papa from 'papaparse';

export interface CSVClientRow {
  'Data de Fechamento'?: string;
  'NOME'?: string;
  'CPF'?: string;
  'NASCIMENTO'?: string;
  'E-MAIL'?: string;
  'Telefone'?: string;
  'CEP'?: string;
  'Endereco'?: string;
  'Bairro'?: string;
  'Cidade'?: string;
  'UF'?: string;
  'ENSAIO'?: string;
  'PACOTE'?: string;
  'DATA DO ENSAIO'?: string;
  'HORÁRIO'?: string;
  'VALOR'?: string;
  'Filho(a)'?: string;
  'Instagram'?: string;
  'Como Conheceu'?: string;
}

export function parseCSV(csvData: string): Promise<CSVClientRow[]> {
  return new Promise((resolve, reject) => {
    Papa.parse<CSVClientRow>(csvData, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => resolve(results.data),
      error: (error) => reject(error)
    });
  });
}

// Converte data BR (dd/mm/yyyy) para ISO (yyyy-mm-dd)
export function parseDateBR(dateStr: string | undefined): string | null {
  if (!dateStr) return null;
  const parts = dateStr.trim().split('/');
  if (parts.length !== 3) return null;
  const [day, month, year] = parts;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

// Converte valor BR (R$ 1.490,00 ou 1490) para number
export function parseValueBR(valueStr: string | undefined): number {
  if (!valueStr) return 0;
  const cleaned = valueStr
    .replace(/R\$\s*/gi, '')
    .replace(/\./g, '')
    .replace(',', '.')
    .trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

// Limpa telefone
export function cleanPhone(phone: string | undefined): string {
  if (!phone) return '';
  return phone.replace(/\D/g, '');
}

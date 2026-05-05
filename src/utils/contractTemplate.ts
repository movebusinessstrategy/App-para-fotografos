// Substitui {{variavel}} no texto pelo valor de `vars`.
// - undefined/null → mantém o placeholder (chama atenção visual de que falta dado)
// - string vazia "" → remove o placeholder E o espaço imediatamente antes
//   (caso "autoriza" — "A CONTRATANTE {{autorizacao_imagem}} autoriza"
//    vira "A CONTRATANTE autoriza" em vez de "A CONTRATANTE  autoriza")
// - qualquer outro valor → substitui pelo texto
export function substituteVariables(
  body: string,
  vars: Record<string, string | number | undefined | null>,
): string {
  return body.replace(/( ?)\{\{(\w+)\}\}/g, (match, leadingSpace, key) => {
    const v = vars[key];
    if (v === undefined || v === null) return match;
    const str = String(v);
    if (str === '') return ''; // come o espaço antes pra evitar "  " duplo
    return leadingSpace + str;
  });
}

// Variáveis canônicas usadas pelos modelos.
// Mantém em sync com /tmp/templatize_contracts.py e TemplatesManager.tsx.
export const TEMPLATE_VARIABLES = [
  'cliente_nome', 'cliente_cpf', 'cliente_endereco', 'cliente_telefone', 'cliente_email',
  'servico_data', 'servico_hora', 'servico_endereco',
  'valor_total', 'valor_extenso',
  'autorizacao_imagem', 'ano',
] as const;

export type TemplateVariable = typeof TEMPLATE_VARIABLES[number];

// Helpers de formatação de valor (usado pelo checkbox "Sessão no domingo")
export function parseBRL(value: string | number | undefined | null): number {
  if (value == null) return 0;
  if (typeof value === 'number') return value;
  // "1.290,00" → 1290
  const cleaned = String(value).replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, '');
  const n = Number(cleaned);
  return isNaN(n) ? 0 : n;
}

export function formatBRL(n: number): string {
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export const SUNDAY_SURCHARGE = 300;

import { Client, ContractTemplate, Job } from '../types';

// Monta o contract_data inicial a partir do cliente, trabalho (opcional) e modelo.
// Aplica acréscimo de R$300 quando sundaySession=true.
export function buildContractDataFromTemplate(
  client: Client | null,
  job: Job | null,
  template: ContractTemplate | null,
  opts: { sundaySession?: boolean } = {},
): Record<string, any> {
  const cd: Record<string, any> = {};

  if (client) {
    cd.clientName = client.name || '';
    cd.clientCPF = client.cpf || '';
    cd.clientPhone = client.phone || '';
    cd.clientEmail = client.email || '';
    cd.clientCEP = client.cep || '';
    const addr = client.address || '';
    const city = client.city || '';
    const state = client.state || '';
    cd.clientAddress = [addr, [city, state].filter(Boolean).join('/')].filter(Boolean).join(' - ');
  }

  if (job) {
    cd.serviceType = job.job_type || '';
    cd.serviceDate = job.job_date || '';
    cd.serviceTime = job.job_time || '';
  }

  if (template) {
    const defs = template.default_data || {};
    if (template.name && !cd.serviceType) {
      cd.serviceType = template.name;
    }
    let baseValue = 0;
    if (defs.valor_total) {
      baseValue = parseBRL(defs.valor_total as string);
    } else if (job?.amount) {
      baseValue = job.amount;
    }
    if (opts.sundaySession) baseValue += SUNDAY_SURCHARGE;
    if (baseValue > 0) cd.serviceValue = formatBRL(baseValue);
    if (defs.valor_extenso && !opts.sundaySession) cd.serviceValueWords = String(defs.valor_extenso);
    if (defs.prazo_entrega_dias) cd.deliveryDays = Number(defs.prazo_entrega_dias);
  } else if (job?.amount) {
    cd.serviceValue = formatBRL(job.amount);
  }

  cd.imageAuthorization = 'autoriza';
  return cd;
}

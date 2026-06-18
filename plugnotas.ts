// Cliente da API do PlugNotas (TecnoSpeed) — emissão de NFS-e (serviço).
// Modelo "software house": uma chave da plataforma, N emitentes (cada estúdio
// com seu CNPJ + certificado A1). Doc: https://docs.plugnotas.com.br
//
// Ambientes:
//   sandbox    → https://api.sandbox.plugnotas.com.br  (mock, não vai pra prefeitura)
//   production → https://api.plugnotas.com.br
// Auth: header `x-api-key`. No sandbox existe um token público pra testes.

const SANDBOX_URL = 'https://api.sandbox.plugnotas.com.br';
const PRODUCTION_URL = 'https://api.plugnotas.com.br';
// Token público de sandbox do PlugNotas (só pra homologação/testes).
const SANDBOX_PUBLIC_KEY = '2da392a6-79d2-4304-a8b7-959572c7e44d';

export type PlugEnv = 'sandbox' | 'production';

function baseUrl(env: PlugEnv): string {
  return env === 'production' ? PRODUCTION_URL : SANDBOX_URL;
}

// Em produção exige a chave real da plataforma (env PLUGNOTAS_API_KEY).
// No sandbox cai pro token público se a env não estiver setada.
function apiKey(env: PlugEnv): string {
  const k = process.env.PLUGNOTAS_API_KEY;
  if (env === 'production') {
    if (!k) throw new Error('PLUGNOTAS_API_KEY não configurada (produção).');
    return k;
  }
  return k || SANDBOX_PUBLIC_KEY;
}

export interface PlugResult<T = any> {
  ok: boolean;
  status: number;
  data: T;
}

async function request<T = any>(
  env: PlugEnv,
  method: string,
  path: string,
  body?: unknown,
): Promise<PlugResult<T>> {
  const res = await fetch(baseUrl(env) + path, {
    method,
    headers: {
      'x-api-key': apiKey(env),
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data: any = null;
  const text = await res.text();
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { ok: res.ok, status: res.status, data };
}

// ── Empresa (emitente) ───────────────────────────────────────────────────────
// Cadastra o estúdio como emitente. Idempotente do lado do PlugNotas: se já
// existe o CNPJ, use PATCH /empresa/{cnpj} pra atualizar.
export interface EmpresaPayload {
  cpfCnpj: string;
  inscricaoMunicipal?: string;
  inscricaoEstadual?: string;
  razaoSocial: string;
  nomeFantasia?: string;
  simplesNacional?: boolean;
  regimeTributario?: number;
  incentivoFiscal?: boolean;
  incentivadorCultural?: boolean;
  email?: string;
  endereco: {
    logradouro: string;
    numero: string;
    complemento?: string;
    bairro: string;
    codigoCidade: string; // IBGE
    descricaoCidade?: string;
    estado: string;
    cep: string;
  };
  telefone?: { ddd: string; numero: string };
  // Config por tipo de documento (NFS-e): RPS, código de serviço etc. opcional aqui.
  nfse?: Record<string, unknown>;
}

export function cadastrarEmpresa(env: PlugEnv, payload: EmpresaPayload) {
  return request(env, 'POST', '/empresa', payload);
}

export function atualizarEmpresa(env: PlugEnv, cnpj: string, payload: Partial<EmpresaPayload>) {
  return request(env, 'PATCH', `/empresa/${cnpj}`, payload);
}

export function consultarEmpresa(env: PlugEnv, cnpj: string) {
  return request(env, 'GET', `/empresa/${cnpj}`);
}

// ── Certificado A1 (.pfx) ────────────────────────────────────────────────────
// Upload multipart: o PlugNotas guarda o certificado; nós nunca persistimos o
// arquivo nem a senha. `pfx` é o conteúdo binário do .pfx.
export async function enviarCertificado(
  env: PlugEnv,
  cnpj: string,
  pfx: Buffer | Uint8Array,
  senha: string,
): Promise<PlugResult> {
  const form = new FormData();
  form.append('arquivo', new Blob([pfx]), 'certificado.pfx');
  form.append('senha', senha);
  form.append('cpfCnpj', cnpj);
  const res = await fetch(baseUrl(env) + '/certificado', {
    method: 'POST',
    headers: { 'x-api-key': apiKey(env) }, // sem Content-Type: o FormData define o boundary
    body: form as any,
  });
  let data: any = null;
  const text = await res.text();
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { ok: res.ok, status: res.status, data };
}

// ── NFS-e ────────────────────────────────────────────────────────────────────
// O PlugNotas recebe um ARRAY de notas. Retorna documentos com `id` pra consulta.
export function emitirNfse(env: PlugEnv, notas: unknown[]) {
  return request(env, 'POST', '/nfse', notas);
}

export function consultarNfse(env: PlugEnv, id: string) {
  return request(env, 'GET', `/nfse/${id}`);
}

// Cancelamento exige justificativa (mín. ~15 caracteres em muitas prefeituras).
export function cancelarNfse(env: PlugEnv, id: string, justificativa: string) {
  return request(env, 'POST', `/nfse/${id}/cancelamento`, { justificativa });
}

// PDF/XML da nota autorizada (links diretos do PlugNotas).
export function urlPdfNfse(env: PlugEnv, id: string) {
  return `${baseUrl(env)}/nfse/${id}/pdf`;
}
export function urlXmlNfse(env: PlugEnv, id: string) {
  return `${baseUrl(env)}/nfse/${id}/xml`;
}

// ── Montagem do payload de NFS-e a partir da config do estúdio + dados da nota ─
// Regra do negócio: emitir DEPOIS do ensaio realizado, pelo valor cheio do
// serviço (o sinal de 30% é só pagamento, não gera nota separada).
export interface FiscalConfigRow {
  cnpj: string;
  inscricao_municipal?: string;
  razao_social: string;
  nome_fantasia?: string;
  simples_nacional?: boolean;
  regime_tributario?: number;
  incentivo_cultural?: boolean;
  email?: string;
  telefone?: string;
  cep?: string; logradouro?: string; numero?: string; complemento?: string;
  bairro?: string; codigo_cidade?: string; cidade?: string; estado?: string;
  servico_codigo?: string;
  servico_cnae?: string;
  servico_discriminacao?: string;
  iss_aliquota?: number;
}

export interface NotaInput {
  idIntegracao: string;          // id idempotente nosso (ex.: fiscal_invoices.id)
  valor: number;                 // valor cheio do serviço
  discriminacao: string;
  tomador: {
    cpfCnpj: string;
    razaoSocial: string;
    email?: string;
    endereco?: {
      logradouro?: string; numero?: string; bairro?: string;
      codigoCidade?: string; estado?: string; cep?: string;
    };
  };
  enviarEmail?: boolean;
}

const onlyDigits = (s?: string) => (s || '').replace(/\D/g, '');

export function montarNfse(cfg: FiscalConfigRow, nota: NotaInput): Record<string, unknown> {
  const tel = onlyDigits(cfg.telefone);
  return {
    idIntegracao: nota.idIntegracao,
    enviarEmail: nota.enviarEmail ?? false,
    prestador: {
      cpfCnpj: onlyDigits(cfg.cnpj),
      inscricaoMunicipal: cfg.inscricao_municipal,
      razaoSocial: cfg.razao_social,
      nomeFantasia: cfg.nome_fantasia,
      simplesNacional: cfg.simples_nacional ?? true,
      regimeTributario: cfg.regime_tributario,
      incentivadorCultural: cfg.incentivo_cultural ?? false,
      email: cfg.email,
      endereco: {
        logradouro: cfg.logradouro,
        numero: cfg.numero,
        complemento: cfg.complemento,
        bairro: cfg.bairro,
        codigoCidade: cfg.codigo_cidade,
        descricaoCidade: cfg.cidade,
        estado: cfg.estado,
        cep: onlyDigits(cfg.cep),
      },
      ...(tel ? { telefone: { ddd: tel.slice(0, 2), numero: tel.slice(2) } } : {}),
    },
    tomador: {
      cpfCnpj: onlyDigits(nota.tomador.cpfCnpj),
      razaoSocial: nota.tomador.razaoSocial,
      email: nota.tomador.email,
      ...(nota.tomador.endereco ? {
        endereco: {
          logradouro: nota.tomador.endereco.logradouro,
          numero: nota.tomador.endereco.numero,
          bairro: nota.tomador.endereco.bairro,
          codigoCidade: nota.tomador.endereco.codigoCidade,
          estado: nota.tomador.endereco.estado,
          cep: onlyDigits(nota.tomador.endereco.cep),
        },
      } : {}),
    },
    servico: [
      {
        codigo: cfg.servico_codigo,
        cnae: cfg.servico_cnae,
        discriminacao: nota.discriminacao || cfg.servico_discriminacao || 'Serviço de fotografia',
        iss: {
          aliquota: cfg.iss_aliquota ?? 0,
          retido: false,
        },
        valor: {
          servico: nota.valor,
        },
      },
    ],
  };
}

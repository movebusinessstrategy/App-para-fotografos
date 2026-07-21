// Tipos e helpers compartilhados do módulo Nota Fiscal.
import { authFetch } from "../../utils/authFetch";

export interface FiscalConfig {
  provider?: string;
  environment?: "sandbox" | "production";
  cnpj?: string; inscricao_municipal?: string; inscricao_estadual?: string;
  razao_social?: string; nome_fantasia?: string;
  simples_nacional?: boolean; incentivo_cultural?: boolean;
  email?: string; telefone?: string;
  cep?: string; logradouro?: string; numero?: string; complemento?: string;
  bairro?: string; codigo_cidade?: string; cidade?: string; estado?: string;
  servico_discriminacao?: string;
  dps_serie?: string; emit_stage_id?: string | null;
  ctrib_nac?: string; cnbs?: string; ptottrib_sn?: number;
  empresa_cadastrada?: boolean; certificado_enviado?: boolean;
  certificado_validade?: string | null; certificado_titular?: string | null;
}

export interface Invoice {
  id: string; status: string; valor: number; numero?: string | null;
  tomador_nome?: string; tomador_doc?: string; discriminacao?: string;
  chave_acesso?: string | null; ambiente?: string | null;
  pdf_url?: string | null; xml_url?: string | null;
  error_message?: string | null;
  created_at: string; emitida_em?: string | null; job_id?: number | null;
}

export interface Elegivel {
  job_id: number; client_id: number | null; client_name: string | null;
  job_name: string | null; job_date: string | null; valor: number;
  stage_id: string; stage_name: string;
  tomador_doc: string; tomador_email: string; faltas: string[];
}

// Shape do GET /api/jobs/:id/financeiro (fonte: JobDetailDrawer).
export interface CatalogItem {
  id: string;
  catalog_type: "combo" | "produto" | "servico";
  catalog_id: string;
  catalog_name: string;
  catalog_value: number;
  quantidade: number;
  discount_value?: number;
}
export interface JobPayment {
  id: string; amount: number; description: string | null;
  payment_date: string; payment_method: string;
}
export interface JobFinanceiro {
  dealItems: CatalogItem[];
  jobItems: CatalogItem[];
  payments: JobPayment[];
  totalPago: number;
  jobAmount: number;
  payment_status: "pending" | "partial" | "paid";
  packageItem: { name: string; value: number; discount: number; source: "deal" | "job" } | null;
}

export async function api<T = any>(path: string, opts?: RequestInit): Promise<T> {
  const res = await authFetch(path, opts);
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && (data.error || data.message)) || "Erro na requisição.");
  return data as T;
}

export const brl = (n: number) =>
  (n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 });

export const dataBr = (s?: string | null) =>
  s ? new Date(s + (s.length === 10 ? "T12:00:00" : "")).toLocaleDateString("pt-BR") : "—";

export async function baixarArquivo(path: string, nome: string) {
  const res = await authFetch(path);
  if (!res.ok) {
    const j = await res.json().catch(() => null);
    alert((j && j.error) || "Não consegui baixar o arquivo.");
    return;
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  if (blob.type.includes("pdf")) {
    window.open(url, "_blank");
  } else {
    const a = document.createElement("a");
    a.href = url; a.download = nome;
    a.click();
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

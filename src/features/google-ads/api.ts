import { authFetch } from "../../utils/authFetch";

export type GoogleAdsState = "config_missing" | "unlinked" | "healthy" | "sync_error" | "stale";

export interface GoogleAdsAccountSummary {
  customer_id_masked: string;
  name: string | null;
  currency_code: string | null;
  time_zone: string | null;
}

export interface GoogleAdsStatus {
  state: GoogleAdsState;
  linked: boolean;
  account: GoogleAdsAccountSummary | null;
  last_synced_at: string | null;
  last_error: string | null;
  stale_after_hours: number;
  can_sync: boolean;
  cooldown_seconds_remaining: number;
}

export interface GoogleAdsTotals {
  impressions: number;
  clicks: number;
  cost_micros: string;
  conversions: number;
  conversions_value: number;
  ctr: number;
  avg_cpc_micros: string;
}

export interface GoogleAdsCrmAttribution {
  valid: boolean;
  click_mapping_verified: boolean;
  attributed_sales: number | null;
  attributed_revenue_micros: string | null;
  cac_micros: string | null;
  roas: number | null;
}

export interface GoogleAdsOverview {
  state: GoogleAdsState;
  date_range: { from: string; to: string };
  currency_code: string | null;
  time_zone: string | null;
  totals: GoogleAdsTotals;
  crm_attribution: GoogleAdsCrmAttribution | null;
}

export interface GoogleAdsCampaign extends GoogleAdsTotals {
  campaign_id: string;
  campaign_name: string;
  campaign_status: string | null;
}

export interface GoogleAdsCampaignsResponse {
  state: GoogleAdsState;
  date_range: { from: string; to: string };
  currency_code: string | null;
  time_zone: string | null;
  campaigns: GoogleAdsCampaign[];
}

type ApiEnvelope<T> = T | { success: boolean; data: T; error?: string };

function unwrapPayload<T>(payload: ApiEnvelope<T>): T {
  if (typeof payload === "object" && payload !== null && "data" in payload) {
    return (payload as { data: T }).data;
  }
  return payload as T;
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const payload = await response.json();
    if (typeof payload?.error === "string") return payload.error;
  } catch {
    // A mensagem amigável é definida pelo chamador.
  }
  return "Não foi possível concluir a solicitação.";
}

export async function fetchGoogleAdsApi<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await authFetch(url, options);
  if (!response.ok) throw new Error(await readErrorMessage(response));
  return unwrapPayload(await response.json() as ApiEnvelope<T>);
}

export function microsToCurrency(value: string | null | undefined): number | null {
  if (value === null || value === undefined || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed / 1_000_000 : null;
}

export function formatCurrency(value: number | null, currencyCode = "BRL", hidden = false): string {
  if (hidden) return "••••";
  if (value === null || !Number.isFinite(value)) return "—";
  try {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: currencyCode || "BRL",
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `R$ ${value.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}`;
  }
}

export function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 }).format(value || 0);
}

export function formatGoogleAdsDate(value: string | null): string {
  if (!value) return "Ainda não atualizado";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Data indisponível";
  return date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

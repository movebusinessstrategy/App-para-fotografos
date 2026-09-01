import type { SupabaseClient } from '@supabase/supabase-js';

import {
  buildMarketingAttributionReport,
  type MarketingAttributionReport,
  type MarketingConversionFactRow,
  type MarketingDealRow,
  type MarketingIntegrationRow,
  type MarketingTouchpointRow,
} from './marketing-attribution-report.js';

const ALLOWED_PERIODS = new Set([7, 30, 90, 180]);
const DAY_MS = 24 * 60 * 60 * 1000;

const TOUCHPOINT_COLUMNS = [
  'id', 'lead_id', 'deal_id', 'channel', 'source', 'phone', 'source_url',
  'ctwa_clid', 'gclid', 'gbraid', 'wbraid', 'fbclid', 'fbc', 'fbp',
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
  'ad_id', 'adset_id', 'campaign_external_id', 'consent_status', 'metadata',
  'ga_session_id', 'contact_confirmed_at', 'first_seen_at', 'last_seen_at',
].join(',');

const FACT_COLUMNS = 'id,lead_id,deal_id,event_name,event_id,occurred_at,value,currency';
const DEAL_COLUMNS = 'id,marketing_lead_id,title,contact_name,contact_phone,stage,converted,converted_at';
const INTEGRATION_COLUMNS = [
  'provider', 'enabled', 'destination_id', 'conversion_action_id',
  'last_tested_at', 'last_error', 'provider_config',
].join(',');

type MarketingSiteStatus = {
  name: string;
  enabled: boolean;
  measurement_enabled: boolean;
};

export type MarketingAttributionApiResponse = {
  configured: boolean;
  generated_at: string;
  period: { days: number; from: string; to: string };
  site: MarketingSiteStatus | null;
  collection: {
    whatsapp_clicks: boolean;
    page_views: boolean;
    site_clicks: boolean;
    note: string;
  };
  report: MarketingAttributionReport;
};

function emptyReport(): MarketingAttributionReport {
  return {
    summary: {
      visitors: 0,
      contacts: 0,
      attributed_contacts: 0,
      attribution_rate: 0,
      contact_rate: 0,
      google_ads_contacts: 0,
      meta_ads_contacts: 0,
      organic_contacts: 0,
      direct_contacts: 0,
      tracked_clicks: 0,
      page_views: 0,
    },
    sources: [],
    records: [],
    integrations: [],
  };
}

export function normalizeMarketingAttributionDays(value: unknown): number {
  const candidate = Number(Array.isArray(value) ? value[0] : value);
  return ALLOWED_PERIODS.has(candidate) ? candidate : 30;
}

export function emptyMarketingAttributionResponse(
  days: number,
  now = new Date(),
): MarketingAttributionApiResponse {
  const from = new Date(now.getTime() - days * DAY_MS).toISOString();
  return {
    configured: false,
    generated_at: now.toISOString(),
    period: { days, from, to: now.toISOString() },
    site: null,
    collection: {
      whatsapp_clicks: false,
      page_views: false,
      site_clicks: false,
      note: 'Mensuração ainda não configurada para esta conta.',
    },
    report: emptyReport(),
  };
}

function dataOrThrow<T>(
  result: { data: T[] | null; error: { code?: string; message?: string } | null },
  label: string,
): T[] {
  if (result.error) {
    const code = result.error.code || 'QUERY_FAILED';
    throw new Error(`${label}:${code}`);
  }
  return result.data || [];
}

function uniqueTouchpoints(rows: MarketingTouchpointRow[]): MarketingTouchpointRow[] {
  return [...new Map(rows.map(row => [String(row.id), row])).values()];
}

function currentLeadIds(
  touchpoints: MarketingTouchpointRow[],
  facts: MarketingConversionFactRow[],
): Set<string> {
  const ids = [
    ...touchpoints.map(row => row.lead_id),
    ...facts.map(row => row.lead_id),
  ].filter((value): value is string => Boolean(value));
  return new Set(ids);
}

function activeSite(rows: MarketingSiteStatus[]): MarketingSiteStatus | null {
  return rows.find(row => row.measurement_enabled)
    || rows.find(row => row.enabled)
    || rows[0]
    || null;
}

export async function loadMarketingAttributionReport(
  supabase: SupabaseClient,
  userId: string,
  days: number,
  now = new Date(),
): Promise<MarketingAttributionApiResponse> {
  const to = now.toISOString();
  const from = new Date(now.getTime() - days * DAY_MS).toISOString();
  const historyFrom = new Date(now.getTime() - 180 * DAY_MS).toISOString();

  const [currentTouchResult, factResult, historyTouchResult, dealResult, integrationResult, siteResult] = await Promise.all([
    supabase.from('marketing_touchpoints').select(TOUCHPOINT_COLUMNS)
      .eq('user_id', userId).gte('last_seen_at', from).order('last_seen_at', { ascending: false }).limit(5000),
    supabase.from('marketing_conversion_facts').select(FACT_COLUMNS)
      .eq('user_id', userId).gte('occurred_at', from).order('occurred_at', { ascending: false }).limit(2000),
    supabase.from('marketing_touchpoints').select(TOUCHPOINT_COLUMNS)
      .eq('user_id', userId).gte('last_seen_at', historyFrom).order('last_seen_at', { ascending: false }).limit(5000),
    supabase.from('deals').select(DEAL_COLUMNS)
      .eq('user_id', userId).not('marketing_lead_id', 'is', null).limit(2000),
    supabase.from('marketing_integrations').select(INTEGRATION_COLUMNS)
      .eq('user_id', userId).limit(20),
    supabase.from('marketing_sites').select('name,enabled,measurement_enabled')
      .eq('user_id', userId).order('created_at', { ascending: false }).limit(10),
  ]);

  const currentTouchpoints = dataOrThrow<MarketingTouchpointRow>(currentTouchResult as any, 'touchpoints_current');
  const facts = dataOrThrow<MarketingConversionFactRow>(factResult as any, 'conversion_facts');
  const historyTouchpoints = dataOrThrow<MarketingTouchpointRow>(historyTouchResult as any, 'touchpoints_history');
  const deals = dataOrThrow<MarketingDealRow>(dealResult as any, 'deals');
  const integrations = dataOrThrow<MarketingIntegrationRow>(integrationResult as any, 'integrations');
  const sites = dataOrThrow<MarketingSiteStatus>(siteResult as any, 'sites');
  const leadIds = currentLeadIds(currentTouchpoints, facts);
  const reportTouchpoints = uniqueTouchpoints([
    ...currentTouchpoints,
    ...historyTouchpoints.filter(row => row.lead_id && leadIds.has(row.lead_id)),
  ]);

  return {
    configured: true,
    generated_at: to,
    period: { days, from, to },
    site: activeSite(sites),
    collection: {
      whatsapp_clicks: true,
      page_views: false,
      site_clicks: false,
      note: 'Cliques no WhatsApp já aparecem. A navegação completa passa a ser mostrada após ativar o coletor de páginas e cliques.',
    },
    report: buildMarketingAttributionReport({
      touchpoints: reportTouchpoints,
      facts,
      deals,
      integrations,
      periodStart: from,
    }),
  };
}

import { GoogleAdsRestClient, normalizeGoogleAdsCustomerId } from './google-ads-rest.js';

export const GOOGLE_ADS_STALE_AFTER_HOURS = 48;
export const GOOGLE_ADS_SYNC_COOLDOWN_SECONDS = 300;

export type GoogleAdsConnectionState = 'config_missing' | 'unlinked' | 'healthy' | 'sync_error' | 'stale';

export type GoogleAdsDateRange = { from: string; to: string };

export type GoogleAdsAccount = {
  customerId: string;
  descriptiveName: string | null;
  currencyCode: string | null;
  timeZone: string | null;
  status: string | null;
  manager: boolean;
  testAccount: boolean;
};

export type GoogleAdsMetricRow = {
  user_id: string;
  customer_id: string;
  campaign_id: string;
  campaign_name: string;
  campaign_status: string | null;
  metric_date: string;
  impressions: string;
  clicks: string;
  cost_micros: string;
  conversions: string;
  conversions_value: string;
  currency_code: string;
  time_zone: string;
  synced_at: string;
  updated_at: string;
};

export type GoogleAdsRangeReplacement = {
  p_user_id: string;
  p_customer_id: string;
  p_date_from: string;
  p_date_to: string;
  p_rows: Array<Omit<GoogleAdsMetricRow, 'user_id' | 'customer_id'>>;
};

export class GoogleAdsValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GoogleAdsValidationError';
  }
}

export function assertTenantGoogleAdsRequestHasNoCustomerId(body: unknown): void {
  if (!body || typeof body !== 'object') return;
  const hasSnakeCase = Object.prototype.hasOwnProperty.call(body, 'customer_id');
  const hasCamelCase = Object.prototype.hasOwnProperty.call(body, 'customerId');
  if (hasSnakeCase || hasCamelCase) {
    throw new GoogleAdsValidationError('customer_id não é aceito nesta rota');
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function utcDate(value: string): Date | null {
  if (!ISO_DATE.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value ? null : parsed;
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function daysAgo(today: Date, days: number): string {
  return isoDay(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - days)));
}

export function resolveGoogleAdsDateRange(input: {
  from?: unknown;
  to?: unknown;
  today?: Date;
  defaultDays?: number;
  maxDays?: number;
}): GoogleAdsDateRange {
  const today = input.today || new Date();
  const toValue = typeof input.to === 'string' && input.to ? input.to : isoDay(today);
  const fromValue = typeof input.from === 'string' && input.from
    ? input.from
    : daysAgo(today, Math.max(1, (input.defaultDays || 30) - 1));
  const from = utcDate(fromValue);
  const to = utcDate(toValue);
  if (!from || !to) throw new GoogleAdsValidationError('Use datas no formato YYYY-MM-DD');
  if (from > to) throw new GoogleAdsValidationError('A data inicial deve ser anterior à data final');
  const inclusiveDays = Math.floor((to.getTime() - from.getTime()) / 86_400_000) + 1;
  if (inclusiveDays > (input.maxDays || 366)) {
    throw new GoogleAdsValidationError(`O período máximo é de ${input.maxDays || 366} dias`);
  }
  return { from: fromValue, to: toValue };
}

export function maskGoogleAdsCustomerId(value: string): string {
  const customerId = normalizeGoogleAdsCustomerId(value);
  if (!customerId) return '•••-•••-••••';
  return `•••-•••-${customerId.slice(-4)}`;
}

export function googleAdsConnectionState(input: {
  configured: boolean;
  linked: boolean;
  lastSyncedAt?: string | null;
  lastError?: string | null;
  now?: Date;
  staleAfterHours?: number;
}): GoogleAdsConnectionState {
  if (!input.configured) return 'config_missing';
  if (!input.linked) return 'unlinked';
  if (input.lastError) return 'sync_error';
  if (!input.lastSyncedAt) return 'stale';
  const syncedAt = new Date(input.lastSyncedAt).getTime();
  const maxAge = (input.staleAfterHours || GOOGLE_ADS_STALE_AFTER_HOURS) * 3_600_000;
  if (!Number.isFinite(syncedAt) || (input.now || new Date()).getTime() - syncedAt > maxAge) return 'stale';
  return 'healthy';
}

export function googleAdsCooldownRemaining(lastStartedAt: string | null | undefined, now = new Date()): number {
  if (!lastStartedAt) return 0;
  const elapsedSeconds = Math.floor((now.getTime() - new Date(lastStartedAt).getTime()) / 1000);
  if (!Number.isFinite(elapsedSeconds)) return 0;
  return Math.max(0, GOOGLE_ADS_SYNC_COOLDOWN_SECONDS - elapsedSeconds);
}

function cleanText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function resourceCustomerId(value: unknown): string | null {
  const match = String(value || '').match(/customers\/(\d{10})$/);
  return match?.[1] || normalizeGoogleAdsCustomerId(value);
}

function parseAccount(row: any, prefix: 'customer' | 'customerClient'): GoogleAdsAccount | null {
  const source = row?.[prefix];
  const customerId = prefix === 'customer'
    ? normalizeGoogleAdsCustomerId(source?.id)
    : resourceCustomerId(source?.clientCustomer);
  if (!source || !customerId) return null;
  return {
    customerId,
    descriptiveName: cleanText(source.descriptiveName),
    currencyCode: cleanText(source.currencyCode),
    timeZone: cleanText(source.timeZone),
    status: cleanText(source.status),
    manager: source.manager === true,
    testAccount: source.testAccount === true,
  };
}

export async function fetchGoogleAdsAccount(client: GoogleAdsRestClient, customerId: string): Promise<GoogleAdsAccount> {
  const query = [
    'SELECT customer.id, customer.descriptive_name, customer.currency_code,',
    'customer.time_zone, customer.status, customer.manager, customer.test_account',
    'FROM customer LIMIT 1',
  ].join(' ');
  const account = parseAccount((await client.search(customerId, query))[0], 'customer');
  if (!account) throw new Error('Conta Google Ads não encontrada');
  return account;
}

export async function fetchGoogleAdsHierarchy(client: GoogleAdsRestClient): Promise<GoogleAdsAccount[]> {
  const query = [
    'SELECT customer_client.client_customer, customer_client.descriptive_name,',
    'customer_client.currency_code, customer_client.time_zone, customer_client.status,',
    'customer_client.manager, customer_client.test_account, customer_client.level',
    'FROM customer_client WHERE customer_client.level <= 1',
  ].join(' ');
  const rows = await client.search(client.config.loginCustomerId, query);
  return rows.map((row) => parseAccount(row, 'customerClient')).filter(Boolean) as GoogleAdsAccount[];
}

function metricString(value: unknown, fallback = '0'): string {
  const candidate = String(value ?? fallback);
  return /^-?\d+(?:\.\d+)?$/.test(candidate) ? candidate : fallback;
}

function metricInteger(value: unknown, name: string): string {
  const candidate = String(value ?? '0');
  if (!/^\d+$/.test(candidate)) throw new Error(`Google Ads retornou ${name} inválido`);
  return candidate;
}

function requiredMetricDimension(value: unknown, name: string): string {
  const normalized = cleanText(value);
  if (!normalized) throw new Error(`Google Ads não retornou ${name}`);
  return normalized;
}

export function mapGoogleAdsMetricRows(input: {
  userId: string;
  customerId: string;
  rows: any[];
  syncedAt?: string;
}): GoogleAdsMetricRow[] {
  const customerId = normalizeGoogleAdsCustomerId(input.customerId);
  if (!customerId) throw new GoogleAdsValidationError('Google Ads customer_id inválido');
  const syncedAt = input.syncedAt || new Date().toISOString();
  return input.rows.map((row) => ({
    user_id: input.userId,
    customer_id: customerId,
    campaign_id: metricInteger(row?.campaign?.id, 'o ID da campanha'),
    campaign_name: requiredMetricDimension(row?.campaign?.name, 'o nome da campanha'),
    campaign_status: cleanText(row?.campaign?.status),
    metric_date: requiredMetricDimension(row?.segments?.date, 'a data da métrica'),
    impressions: metricInteger(row?.metrics?.impressions, 'impressões'),
    clicks: metricInteger(row?.metrics?.clicks, 'cliques'),
    cost_micros: metricInteger(row?.metrics?.costMicros, 'custo em micros'),
    conversions: metricString(row?.metrics?.conversions),
    conversions_value: metricString(row?.metrics?.conversionsValue),
    currency_code: requiredMetricDimension(row?.customer?.currencyCode, 'a moeda'),
    time_zone: requiredMetricDimension(row?.customer?.timeZone, 'o fuso horário'),
    synced_at: syncedAt,
    updated_at: syncedAt,
  }));
}

export function scopeGoogleAdsMetricRows(rows: any[], userId: string, customerId: string): any[] {
  const normalizedCustomerId = normalizeGoogleAdsCustomerId(customerId);
  if (!normalizedCustomerId) return [];
  return rows.filter((row) => (
    String(row?.user_id || '') === userId
    && normalizeGoogleAdsCustomerId(row?.customer_id) === normalizedCustomerId
  ));
}

export function buildGoogleAdsRangeReplacement(input: {
  userId: string;
  customerId: string;
  range: GoogleAdsDateRange;
  rows: GoogleAdsMetricRow[];
}): GoogleAdsRangeReplacement {
  const customerId = normalizeGoogleAdsCustomerId(input.customerId);
  if (!input.userId || !customerId) throw new GoogleAdsValidationError('Escopo Google Ads inválido');
  resolveGoogleAdsDateRange({ from: input.range.from, to: input.range.to, maxDays: 90 });
  const payloadRows = input.rows.map(({ user_id, customer_id, ...row }) => {
    if (user_id !== input.userId || normalizeGoogleAdsCustomerId(customer_id) !== customerId) {
      throw new GoogleAdsValidationError('Métrica fora do escopo do tenant');
    }
    if (row.metric_date < input.range.from || row.metric_date > input.range.to) {
      throw new GoogleAdsValidationError('Métrica fora do período solicitado');
    }
    return row;
  });
  return {
    p_user_id: input.userId,
    p_customer_id: customerId,
    p_date_from: input.range.from,
    p_date_to: input.range.to,
    p_rows: payloadRows,
  };
}

export async function fetchGoogleAdsDailyMetrics(input: {
  client: GoogleAdsRestClient;
  userId: string;
  customerId: string;
  range: GoogleAdsDateRange;
  syncedAt?: string;
}): Promise<GoogleAdsMetricRow[]> {
  const query = [
    'SELECT segments.date, customer.currency_code, customer.time_zone,',
    'campaign.id, campaign.name, campaign.status, metrics.impressions, metrics.clicks,',
    'metrics.cost_micros, metrics.conversions, metrics.conversions_value',
    'FROM campaign',
    `WHERE segments.date BETWEEN '${input.range.from}' AND '${input.range.to}'`,
  ].join(' ');
  const rows = await input.client.searchStream(input.customerId, query);
  return mapGoogleAdsMetricRows({ ...input, rows });
}

function integer(value: unknown): bigint {
  const candidate = String(value ?? '0');
  return /^-?\d+$/.test(candidate) ? BigInt(candidate) : 0n;
}

function decimal(value: unknown): number {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

export type GoogleAdsTotals = {
  impressions: number;
  clicks: number;
  cost_micros: string;
  conversions: number;
  conversions_value: number;
  ctr: number;
  avg_cpc_micros: string;
};

export function aggregateGoogleAdsOverview(rows: any[]): GoogleAdsTotals {
  let impressions = 0n;
  let clicks = 0n;
  let costMicros = 0n;
  let conversions = 0;
  let conversionsValue = 0;
  for (const row of rows) {
    impressions += integer(row.impressions);
    clicks += integer(row.clicks);
    costMicros += integer(row.cost_micros);
    conversions += decimal(row.conversions);
    conversionsValue += decimal(row.conversions_value);
  }
  const impressionsNumber = Number(impressions);
  const clicksNumber = Number(clicks);
  return {
    impressions: impressionsNumber,
    clicks: clicksNumber,
    cost_micros: costMicros.toString(),
    conversions,
    conversions_value: conversionsValue,
    ctr: ratio(clicksNumber, impressionsNumber),
    avg_cpc_micros: clicks > 0n ? (costMicros / clicks).toString() : '0',
  };
}

export type GoogleAdsCampaignSummary = GoogleAdsTotals & {
  campaign_id: string;
  campaign_name: string;
  campaign_status: string | null;
};

export function aggregateGoogleAdsCampaigns(rows: any[]): GoogleAdsCampaignSummary[] {
  const groups = new Map<string, any[]>();
  for (const row of rows) {
    const key = String(row.campaign_id);
    groups.set(key, [...(groups.get(key) || []), row]);
  }
  return Array.from(groups.entries()).map(([campaignId, group]) => ({
    campaign_id: campaignId,
    campaign_name: String(group[0]?.campaign_name || 'Campanha sem nome'),
    campaign_status: cleanText(group[0]?.campaign_status),
    ...aggregateGoogleAdsOverview(group),
  })).sort((a, b) => {
    const costA = integer(a.cost_micros);
    const costB = integer(b.cost_micros);
    if (costA === costB) return a.campaign_name.localeCompare(b.campaign_name, 'pt-BR');
    return costB > costA ? 1 : -1;
  });
}

export function computeCrmAttribution(input: {
  valid: boolean;
  verifiedClickMapping?: boolean;
  attributedSales: number;
  attributedRevenueMicros: string;
  costMicros: string;
}) {
  const valid = input.valid && input.verifiedClickMapping === true;
  const cost = integer(input.costMicros);
  const attributedSales = valid ? input.attributedSales : 0;
  const revenue = valid ? integer(input.attributedRevenueMicros) : 0n;
  const cac = valid && attributedSales > 0 ? cost / BigInt(attributedSales) : null;
  const roas = valid && cost > 0n ? Number(revenue) / Number(cost) : null;
  return {
    valid,
    click_mapping_verified: valid,
    attributed_sales: attributedSales,
    attributed_revenue_micros: revenue.toString(),
    cac_micros: cac?.toString() || null,
    roas: roas !== null && Number.isFinite(roas) ? roas : null,
  };
}

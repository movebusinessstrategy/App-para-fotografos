export type AttributionSourceKey =
  | 'google_ads'
  | 'meta_ads'
  | 'organic'
  | 'referral'
  | 'direct'
  | 'other';

export type MarketingTouchpointRow = {
  id: number;
  lead_id: string | null;
  deal_id: number | null;
  channel: 'website' | 'whatsapp' | 'manual' | 'import' | string;
  source: string | null;
  phone: string | null;
  source_url: string | null;
  ctwa_clid: string | null;
  gclid: string | null;
  gbraid: string | null;
  wbraid: string | null;
  fbclid: string | null;
  fbc: string | null;
  fbp: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  ad_id: string | null;
  adset_id: string | null;
  campaign_external_id: string | null;
  consent_status: 'granted' | 'denied' | 'unknown' | string;
  metadata: Record<string, unknown> | null;
  ga_session_id: string | null;
  contact_confirmed_at: string | null;
  first_seen_at: string;
  last_seen_at: string;
};

export type MarketingConversionFactRow = {
  id: number;
  lead_id: string;
  deal_id: number | null;
  event_name: 'Contact' | 'Lead' | 'Schedule' | 'Purchase' | string;
  event_id: string;
  occurred_at: string;
  value: number | string | null;
  currency: string | null;
};

export type MarketingDealRow = {
  id: number;
  marketing_lead_id: string | null;
  title: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  stage: string | null;
  converted: boolean | null;
  converted_at: string | null;
};

export type MarketingIntegrationRow = {
  provider: 'google' | 'meta' | 'ga4' | string;
  enabled: boolean;
  destination_id: string | null;
  conversion_action_id: string | null;
  last_tested_at: string | null;
  last_error: string | null;
  provider_config: Record<string, unknown> | null;
};

export type AttributionJourneyEvent = {
  id: string;
  kind: 'page_view' | 'site_click' | 'message' | 'milestone';
  label: string;
  occurred_at: string;
  page_path: string | null;
  detail: string | null;
  campaign?: string | null;
  source_label?: string;
};

export type AttributionLeadRecord = {
  lead_id: string;
  deal_id: number | null;
  contact_name: string;
  contact_phone: string | null;
  funnel_stage: string | null;
  source: AttributionSourceKey;
  source_label: string;
  campaign: string | null;
  campaign_id: string | null;
  adset_id: string | null;
  ad_id: string | null;
  content: string | null;
  keyword: string | null;
  landing_page: string | null;
  first_seen_at: string;
  last_seen_at: string;
  contact_confirmed_at: string | null;
  click_count: number;
  page_view_count: number;
  session_count: number;
  sessions_estimated: boolean;
  message_count: number;
  campaigns: string[];
  pages: string[];
  consent_status: string;
  has_contact: boolean;
  has_qualified_lead: boolean;
  has_schedule: boolean;
  has_purchase: boolean;
  journey: AttributionJourneyEvent[];
};

export type MarketingAttributionReport = {
  summary: {
    visitors: number;
    contacts: number;
    attributed_contacts: number;
    attribution_rate: number;
    contact_rate: number;
    google_ads_contacts: number;
    meta_ads_contacts: number;
    organic_contacts: number;
    direct_contacts: number;
    tracked_clicks: number;
    page_views: number;
  };
  sources: Array<{
    key: AttributionSourceKey;
    label: string;
    contacts: number;
    percent: number;
  }>;
  records: AttributionLeadRecord[];
  integrations: Array<{
    provider: string;
    enabled: boolean;
    configured: boolean;
    last_tested_at: string | null;
    last_error: string | null;
    state: string | null;
  }>;
};

type BuildReportInput = {
  touchpoints: MarketingTouchpointRow[];
  facts: MarketingConversionFactRow[];
  deals: MarketingDealRow[];
  integrations: MarketingIntegrationRow[];
  periodStart?: string;
};

const SOURCE_LABELS: Record<AttributionSourceKey, string> = {
  google_ads: 'Google Ads',
  meta_ads: 'Meta Ads',
  organic: 'Orgânico',
  referral: 'Referência',
  direct: 'Direto / sem identificação',
  other: 'Outra origem',
};

const PAID_MEDIUMS = new Set([
  'cpc', 'ppc', 'paid', 'paid_search', 'paid_social', 'social_paid', 'ads', 'display',
]);
const GOOGLE_SOURCES = new Set(['google', 'google_ads', 'googleads', 'adwords']);
const META_SOURCES = new Set(['meta', 'facebook', 'instagram', 'fb', 'ig']);
const ORGANIC_SOURCES = new Set(['google', 'bing', 'yahoo', 'duckduckgo', 'instagram', 'facebook']);

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalized(value: unknown): string {
  return clean(value).toLowerCase().replace(/[\s-]+/g, '_');
}

function hasGoogleClickId(row: MarketingTouchpointRow): boolean {
  return Boolean(clean(row.gclid) || clean(row.gbraid) || clean(row.wbraid));
}

function hasMetaClickId(row: MarketingTouchpointRow): boolean {
  return Boolean(clean(row.ctwa_clid) || clean(row.fbclid) || clean(row.fbc));
}

function isPaidMedium(row: MarketingTouchpointRow): boolean {
  return PAID_MEDIUMS.has(normalized(row.utm_medium));
}

function isGooglePaidUtm(row: MarketingTouchpointRow): boolean {
  return GOOGLE_SOURCES.has(normalized(row.utm_source)) && isPaidMedium(row);
}

function isMetaPaidUtm(row: MarketingTouchpointRow): boolean {
  return META_SOURCES.has(normalized(row.utm_source)) && isPaidMedium(row);
}

function isOrganic(row: MarketingTouchpointRow): boolean {
  const medium = normalized(row.utm_medium);
  const source = normalized(row.utm_source);
  return medium === 'organic' || (ORGANIC_SOURCES.has(source) && !isPaidMedium(row));
}

function isReferral(row: MarketingTouchpointRow): boolean {
  return normalized(row.utm_medium) === 'referral';
}

const SOURCE_RULES: Array<{
  key: AttributionSourceKey;
  matches: (row: MarketingTouchpointRow) => boolean;
}> = [
  { key: 'google_ads', matches: hasGoogleClickId },
  { key: 'meta_ads', matches: hasMetaClickId },
  { key: 'google_ads', matches: isGooglePaidUtm },
  { key: 'meta_ads', matches: isMetaPaidUtm },
  { key: 'organic', matches: isOrganic },
  { key: 'referral', matches: isReferral },
];

export function classifyAttributionSource(row?: MarketingTouchpointRow): AttributionSourceKey {
  if (!row) return 'direct';
  return SOURCE_RULES.find(rule => rule.matches(row))?.key || 'direct';
}

function pickAttributionTouchpoint(rows: MarketingTouchpointRow[]): MarketingTouchpointRow | undefined {
  const ordered = [...rows].sort((a, b) => Date.parse(a.first_seen_at) - Date.parse(b.first_seen_at));
  return ordered.find(row => classifyAttributionSource(row) !== 'direct') || ordered[0];
}

function metadataText(row: MarketingTouchpointRow, key: string): string | null {
  const value = row.metadata?.[key];
  return clean(value) || null;
}

function pathFromUrl(value: string | null): string | null {
  const candidate = clean(value);
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    return `${parsed.pathname}${parsed.search}` || '/';
  } catch {
    return candidate.startsWith('/') ? candidate : null;
  }
}

function touchpointPage(row?: MarketingTouchpointRow): string | null {
  if (!row) return null;
  return metadataText(row, 'page_path') || pathFromUrl(row.source_url);
}

function touchpointEventName(row: MarketingTouchpointRow): string {
  const explicitName = metadataText(row, 'event_name');
  if (explicitName) return explicitName;
  const marker = metadataText(row, 'cta_id');
  if (marker === '__page_view__') return 'PageView';
  if (marker === '__site_click__') return 'SiteClick';
  return '';
}

function touchpointKind(row: MarketingTouchpointRow): AttributionJourneyEvent['kind'] {
  if (row.channel === 'whatsapp') return 'message';
  if (touchpointEventName(row) === 'PageView') return 'page_view';
  return 'site_click';
}

function touchpointLabel(row: MarketingTouchpointRow): string {
  if (row.channel === 'whatsapp') return 'Mensagem recebida no WhatsApp';
  const eventName = touchpointEventName(row);
  if (eventName === 'PageView') return 'Visualizou uma página';
  if (eventName === 'SiteClick') return 'Clicou no site';
  if (eventName === 'WhatsAppClick' || row.channel === 'website') return 'Clicou para conversar no WhatsApp';
  return 'Interação registrada';
}

function touchpointDetail(row: MarketingTouchpointRow): string | null {
  return metadataText(row, 'element_text')
    || metadataText(row, 'cta_location')
    || metadataText(row, 'cta_id');
}

function touchpointJourney(row: MarketingTouchpointRow): AttributionJourneyEvent {
  return {
    id: `touchpoint:${row.id}`,
    kind: touchpointKind(row),
    label: touchpointLabel(row),
    occurred_at: row.first_seen_at,
    page_path: touchpointPage(row),
    detail: touchpointDetail(row),
    campaign: clean(row.utm_campaign) || null,
    source_label: SOURCE_LABELS[classifyAttributionSource(row)],
  };
}

const FACT_LABELS: Record<string, string> = {
  Contact: 'Contato confirmado',
  Lead: 'Lead qualificado',
  Schedule: 'Ensaio agendado',
  Purchase: 'Venda confirmada',
};

function factJourney(row: MarketingConversionFactRow): AttributionJourneyEvent {
  return {
    id: `fact:${row.id}`,
    kind: 'milestone',
    label: FACT_LABELS[row.event_name] || row.event_name,
    occurred_at: row.occurred_at,
    page_path: null,
    detail: row.event_name === 'Purchase' && Number(row.value) > 0
      ? `${row.currency || 'BRL'} ${Number(row.value).toFixed(2)}`
      : null,
  };
}

function sortedJourney(
  touchpoints: MarketingTouchpointRow[],
  facts: MarketingConversionFactRow[],
): AttributionJourneyEvent[] {
  return [
    ...touchpoints.map(touchpointJourney),
    ...facts.map(factJourney),
  ].sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at));
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map(clean).filter(Boolean))];
}

function earliest(values: string[]): string {
  return [...values].sort((a, b) => Date.parse(a) - Date.parse(b))[0] || new Date(0).toISOString();
}

function latest(values: string[]): string {
  return [...values].sort((a, b) => Date.parse(b) - Date.parse(a))[0] || new Date(0).toISOString();
}

function hasFact(facts: MarketingConversionFactRow[], eventName: string): boolean {
  return facts.some(fact => fact.event_name === eventName);
}

function leadPhone(touchpoints: MarketingTouchpointRow[], deal?: MarketingDealRow): string | null {
  const incomingPhones = uniqueStrings(touchpoints.filter(row => row.channel === 'whatsapp').map(row => clean(row.phone).replace(/\D/g, '')));
  if (incomingPhones.length > 1) return null;
  return incomingPhones[0]
    || clean(deal?.contact_phone)
    || clean(touchpoints.find(row => row.phone)?.phone)
    || null;
}

function contactName(deal?: MarketingDealRow): string {
  const name = clean(deal?.contact_name) || clean(deal?.title);
  return /^[\d\s()+-]+$/.test(name) ? '' : name;
}

function websiteSessions(rows: MarketingTouchpointRow[]): { count: number; estimated: boolean } {
  if (rows.length === 0) return { count: 0, estimated: false };
  const known = rows.filter(row => clean(row.ga_session_id));
  if (known.length === rows.length) {
    // Session IDs are timestamps, so two different journeys may share one.
    return { count: uniqueStrings(known.map(row => `${row.lead_id}:${row.ga_session_id}`)).length, estimated: false };
  }
  const previousByJourney = new Map<string, number>();
  let count = 0;
  for (const row of [...rows].sort((a, b) => Date.parse(a.first_seen_at) - Date.parse(b.first_seen_at))) {
    const key = row.lead_id || String(row.id);
    const time = Date.parse(row.first_seen_at);
    const previous = previousByJourney.get(key);
    if (previous === undefined || time - previous >= 30 * 60 * 1000) count += 1;
    previousByJourney.set(key, time);
  }
  return { count, estimated: true };
}

function consentStatus(touchpoints: MarketingTouchpointRow[]): string {
  if (touchpoints.some(row => row.consent_status === 'granted')) return 'granted';
  if (touchpoints.some(row => row.consent_status === 'denied')) return 'denied';
  return 'unknown';
}

function buildRecord(
  leadId: string,
  touchpoints: MarketingTouchpointRow[],
  facts: MarketingConversionFactRow[],
  deal?: MarketingDealRow,
  periodStart?: string,
): AttributionLeadRecord {
  const attribution = pickAttributionTouchpoint(touchpoints);
  const source = classifyAttributionSource(attribution);
  const eventTimes = [
    ...touchpoints.flatMap(row => [row.first_seen_at, row.last_seen_at]),
    ...facts.map(row => row.occurred_at),
  ];
  const periodTouchpoints = periodStart
    ? touchpoints.filter(row => Date.parse(row.last_seen_at) >= Date.parse(periodStart))
    : touchpoints;
  const websiteEvents = periodTouchpoints.filter(row => row.channel === 'website');
  const pageViews = websiteEvents.filter(row => touchpointEventName(row) === 'PageView');
  const clicks = websiteEvents.filter(row => touchpointEventName(row) !== 'PageView');
  const contactFact = facts.find(row => row.event_name === 'Contact');
  const phone = leadPhone(touchpoints, deal);
  const sessions = websiteSessions(websiteEvents);
  const messages = periodTouchpoints.filter(row => row.channel === 'whatsapp');
  const confirmedAt = earliest([
    ...facts.filter(row => row.event_name === 'Contact').map(row => row.occurred_at),
    ...touchpoints.flatMap(row => row.contact_confirmed_at ? [row.contact_confirmed_at] : []),
  ]);

  return {
    lead_id: leadId,
    deal_id: deal?.id ?? facts.find(row => row.deal_id)?.deal_id ?? null,
    contact_name: phone ? contactName(deal) || 'Contato identificado' : 'Visitante anônimo',
    contact_phone: phone,
    funnel_stage: clean(deal?.stage) || null,
    source,
    source_label: SOURCE_LABELS[source],
    campaign: clean(attribution?.utm_campaign) || null,
    campaign_id: clean(attribution?.campaign_external_id) || null,
    adset_id: clean(attribution?.adset_id) || null,
    ad_id: clean(attribution?.ad_id) || null,
    content: clean(attribution?.utm_content) || null,
    keyword: clean(attribution?.utm_term) || null,
    landing_page: touchpointPage(attribution || touchpoints[0]),
    first_seen_at: earliest(eventTimes),
    last_seen_at: latest(eventTimes),
    contact_confirmed_at: confirmedAt === new Date(0).toISOString() ? null : confirmedAt,
    click_count: clicks.length,
    page_view_count: pageViews.length,
    session_count: sessions.count,
    sessions_estimated: sessions.estimated,
    message_count: messages.length,
    campaigns: uniqueStrings(touchpoints.map(row => row.utm_campaign)),
    pages: uniqueStrings(periodTouchpoints.map(touchpointPage)),
    consent_status: consentStatus(touchpoints),
    has_contact: Boolean(contactFact || touchpoints.some(row => row.contact_confirmed_at)),
    has_qualified_lead: hasFact(facts, 'Lead'),
    has_schedule: hasFact(facts, 'Schedule'),
    has_purchase: hasFact(facts, 'Purchase'),
    journey: sortedJourney(touchpoints, facts),
  };
}

function recordsFromInput(input: BuildReportInput): AttributionLeadRecord[] {
  const leadIds = uniqueStrings([
    ...input.touchpoints.map(row => row.lead_id),
    ...input.facts.map(row => row.lead_id),
  ]);
  const dealMap = new Map(
    input.deals
      .filter(row => clean(row.marketing_lead_id))
      .map(row => [clean(row.marketing_lead_id), row]),
  );

  const groups = new Map<string, string[]>();
  for (const leadId of leadIds) {
    const phones = uniqueStrings(input.touchpoints
      .filter(row => row.lead_id === leadId && row.channel === 'whatsapp')
      .map(row => clean(row.phone).replace(/\D/g, '')));
    // Only explicit incoming-message identity can join separate journeys.
    const key = phones.length === 1 ? `phone:${phones[0]}` : `lead:${leadId}`;
    groups.set(key, [...(groups.get(key) || []), leadId]);
  }
  return [...groups.values()].map(ids => buildRecord(
    ids[0],
    input.touchpoints.filter(row => row.lead_id && ids.includes(row.lead_id)),
    input.facts.filter(row => ids.includes(row.lead_id)),
    ids.map(id => dealMap.get(id)).find(Boolean),
    input.periodStart,
  )).sort((a, b) => Date.parse(b.last_seen_at) - Date.parse(a.last_seen_at));
}

function percent(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 1000) / 10 : 0;
}

function sourceSummary(records: AttributionLeadRecord[]) {
  const contacts = records.filter(record => record.has_contact);
  return (Object.keys(SOURCE_LABELS) as AttributionSourceKey[]).map(key => {
    const count = contacts.filter(record => record.source === key).length;
    return { key, label: SOURCE_LABELS[key], contacts: count, percent: percent(count, contacts.length) };
  });
}

function integrationSummary(rows: MarketingIntegrationRow[]) {
  return rows.map(row => ({
    provider: row.provider,
    enabled: Boolean(row.enabled),
    configured: Boolean(clean(row.destination_id) || clean(row.conversion_action_id)),
    last_tested_at: row.last_tested_at,
    last_error: clean(row.last_error) || null,
    state: clean(row.provider_config?.state) || null,
  }));
}

export function buildMarketingAttributionReport(input: BuildReportInput): MarketingAttributionReport {
  const records = recordsFromInput(input);
  const contacts = records.filter(record => record.has_contact);
  const attributed = contacts.filter(record => !['direct', 'other'].includes(record.source));
  const countSource = (source: AttributionSourceKey) => contacts.filter(record => record.source === source).length;

  return {
    summary: {
      visitors: records.length,
      contacts: contacts.length,
      attributed_contacts: attributed.length,
      attribution_rate: percent(attributed.length, contacts.length),
      contact_rate: percent(contacts.length, records.length),
      google_ads_contacts: countSource('google_ads'),
      meta_ads_contacts: countSource('meta_ads'),
      organic_contacts: countSource('organic'),
      direct_contacts: countSource('direct') + countSource('other'),
      tracked_clicks: records.reduce((sum, record) => sum + record.click_count, 0),
      page_views: records.reduce((sum, record) => sum + record.page_view_count, 0),
    },
    sources: sourceSummary(records),
    records,
    integrations: integrationSummary(input.integrations),
  };
}

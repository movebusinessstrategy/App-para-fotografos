import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildMarketingAttributionReport,
  classifyAttributionSource,
  type MarketingConversionFactRow,
  type MarketingDealRow,
  type MarketingIntegrationRow,
  type MarketingTouchpointRow,
} from './lib/marketing-attribution-report.js';

const NOW = '2026-09-01T20:00:00.000Z';
const OLD = '2026-06-01T20:00:00.000Z';

function touchpoint(overrides: Partial<MarketingTouchpointRow> = {}): MarketingTouchpointRow {
  return {
    id: 1,
    lead_id: '11111111-1111-4111-8111-111111111111',
    deal_id: null,
    channel: 'website',
    source: 'site_bridge',
    phone: null,
    source_url: 'https://example.com/ensaio-gestante',
    ctwa_clid: null,
    gclid: null,
    gbraid: null,
    wbraid: null,
    fbclid: null,
    fbc: null,
    fbp: null,
    utm_source: null,
    utm_medium: null,
    utm_campaign: null,
    utm_content: null,
    utm_term: null,
    ad_id: null,
    adset_id: null,
    campaign_external_id: null,
    consent_status: 'granted',
    metadata: { event_name: 'WhatsAppClick', page_path: '/ensaio-gestante', cta_location: 'hero' },
    ga_session_id: '1234567890',
    contact_confirmed_at: null,
    first_seen_at: NOW,
    last_seen_at: NOW,
    ...overrides,
  };
}

function fact(overrides: Partial<MarketingConversionFactRow> = {}): MarketingConversionFactRow {
  return {
    id: 10,
    lead_id: '11111111-1111-4111-8111-111111111111',
    deal_id: 42,
    event_name: 'Contact',
    event_id: 'contact:message-1',
    occurred_at: NOW,
    value: 0,
    currency: 'BRL',
    ...overrides,
  };
}

test('classifica clique pago do Google por identificador ou UTM', () => {
  assert.equal(classifyAttributionSource(touchpoint({ gclid: 'google-click' })), 'google_ads');
  assert.equal(classifyAttributionSource(touchpoint({ utm_source: 'google', utm_medium: 'cpc' })), 'google_ads');
});

test('classifica Meta Ads por fbclid ou ctwa_clid', () => {
  assert.equal(classifyAttributionSource(touchpoint({ fbclid: 'meta-click' })), 'meta_ads');
  assert.equal(classifyAttributionSource(touchpoint({ ctwa_clid: 'ctwa-click' })), 'meta_ads');
});

test('separa orgânico e acesso direto', () => {
  assert.equal(classifyAttributionSource(touchpoint({ utm_source: 'google', utm_medium: 'organic' })), 'organic');
  assert.equal(classifyAttributionSource(touchpoint()), 'direct');
});

test('monta jornada, origem e vínculo com o negócio sem misturar leads', () => {
  const leadId = '11111111-1111-4111-8111-111111111111';
  const touchpoints = [
    touchpoint({
      id: 1,
      gclid: 'google-click',
      utm_source: 'google',
      utm_medium: 'cpc',
      utm_campaign: 'Gestante Londrina',
      utm_term: 'ensaio gestante londrina',
      campaign_external_id: '21125216764',
    }),
    touchpoint({
      id: 2,
      channel: 'whatsapp',
      phone: '5543999990000',
      source_url: null,
      metadata: { event_name: 'Contact' },
    }),
  ];
  const deals: MarketingDealRow[] = [{
    id: 42,
    marketing_lead_id: leadId,
    title: 'Gestante - Maria',
    contact_name: 'Maria',
    contact_phone: '5543999990000',
    stage: 'novo-lead',
    converted: false,
    converted_at: null,
  }];
  const integrations: MarketingIntegrationRow[] = [{
    provider: 'google',
    enabled: false,
    destination_id: '8275091764',
    conversion_action_id: '7742807279',
    last_tested_at: null,
    last_error: null,
    provider_config: { state: 'validation' },
  }];

  const report = buildMarketingAttributionReport({ touchpoints, facts: [fact()], deals, integrations });
  const record = report.records[0];

  assert.equal(report.summary.contacts, 1);
  assert.equal(report.summary.google_ads_contacts, 1);
  assert.equal(record.contact_name, 'Maria');
  assert.equal(record.source, 'google_ads');
  assert.equal(record.campaign, 'Gestante Londrina');
  assert.equal(record.keyword, 'ensaio gestante londrina');
  assert.deepEqual(record.pages, ['/ensaio-gestante']);
  assert.equal(record.journey.length, 3);
  assert.equal(report.integrations[0].state, 'validation');
});

test('mantém a origem antiga, mas conta somente cliques dentro do período', () => {
  const report = buildMarketingAttributionReport({
    periodStart: '2026-08-01T00:00:00.000Z',
    touchpoints: [
      touchpoint({ id: 1, gclid: 'old-google-click', first_seen_at: OLD, last_seen_at: OLD }),
      touchpoint({ id: 2, channel: 'whatsapp', source_url: null, first_seen_at: NOW, last_seen_at: NOW }),
    ],
    facts: [fact()],
    deals: [],
    integrations: [],
  });

  assert.equal(report.records[0].source, 'google_ads');
  assert.equal(report.records[0].click_count, 0);
  assert.equal(report.summary.tracked_clicks, 0);
});

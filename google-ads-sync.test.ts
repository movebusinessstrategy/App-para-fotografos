import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  GoogleAdsValidationError,
  aggregateGoogleAdsCampaigns,
  aggregateGoogleAdsOverview,
  assertTenantGoogleAdsRequestHasNoCustomerId,
  buildGoogleAdsRangeReplacement,
  computeCrmAttribution,
  googleAdsConnectionState,
  googleAdsCooldownRemaining,
  mapGoogleAdsMetricRows,
  resolveGoogleAdsDateRange,
  scopeGoogleAdsMetricRows,
} from './google-ads-sync.js';

test('status distingue config_missing e unlinked sem mascarar o problema', () => {
  assert.equal(googleAdsConnectionState({ configured: false, linked: true }), 'config_missing');
  assert.equal(googleAdsConnectionState({ configured: true, linked: false }), 'unlinked');
});

test('status distingue saudável, erro e desatualizado', () => {
  const now = new Date('2026-08-16T12:00:00.000Z');
  assert.equal(googleAdsConnectionState({
    configured: true, linked: true, lastSyncedAt: '2026-08-16T11:00:00.000Z', now,
  }), 'healthy');
  assert.equal(googleAdsConnectionState({
    configured: true, linked: true, lastSyncedAt: '2026-08-16T11:00:00.000Z', lastError: 'erro', now,
  }), 'sync_error');
  assert.equal(googleAdsConnectionState({
    configured: true, linked: true, lastSyncedAt: '2026-08-13T11:00:00.000Z', now,
  }), 'stale');
});

test('intervalo valida formato, ordem e limite', () => {
  assert.deepEqual(resolveGoogleAdsDateRange({
    today: new Date('2026-08-16T12:00:00.000Z'), defaultDays: 30, maxDays: 90,
  }), { from: '2026-07-18', to: '2026-08-16' });
  assert.throws(
    () => resolveGoogleAdsDateRange({ from: '2026-08-17', to: '2026-08-16' }),
    GoogleAdsValidationError,
  );
  assert.throws(
    () => resolveGoogleAdsDateRange({ from: '2026-01-01', to: '2026-08-16', maxDays: 90 }),
    /período máximo é de 90 dias/,
  );
});

test('cooldown impede repetição por cinco minutos', () => {
  const now = new Date('2026-08-16T12:00:00.000Z');
  assert.equal(googleAdsCooldownRemaining('2026-08-16T11:59:00.000Z', now), 240);
  assert.equal(googleAdsCooldownRemaining('2026-08-16T11:50:00.000Z', now), 0);
});

test('mapeamento diário carimba tenant e conta do vínculo, sem aceitar dimensão externa', () => {
  const rows = mapGoogleAdsMetricRows({
    userId: 'tenant-a',
    customerId: '123-456-7890',
    syncedAt: '2026-08-16T12:00:00.000Z',
    rows: [{
      segments: { date: '2026-08-15' },
      customer: { currencyCode: 'BRL', timeZone: 'America/Sao_Paulo' },
      campaign: { id: '99', name: 'Gestantes', status: 'ENABLED' },
      metrics: { impressions: '1000', clicks: '25', costMicros: '12500000', conversions: 3, conversionsValue: 900 },
    }],
  });

  assert.equal(rows[0].user_id, 'tenant-a');
  assert.equal(rows[0].customer_id, '1234567890');
  assert.equal(rows[0].cost_micros, '12500000');
  assert.equal(rows[0].currency_code, 'BRL');
  assert.equal(rows[0].time_zone, 'America/Sao_Paulo');
});

test('defesa adicional remove linhas de outro tenant ou customer_id', () => {
  const rows = [
    { user_id: 'tenant-a', customer_id: '1234567890', campaign_id: '1' },
    { user_id: 'tenant-b', customer_id: '1234567890', campaign_id: '2' },
    { user_id: 'tenant-a', customer_id: '9999999999', campaign_id: '3' },
  ];
  assert.deepEqual(
    scopeGoogleAdsMetricRows(rows, 'tenant-a', '1234567890').map((row) => row.campaign_id),
    ['1'],
  );
});

test('rota do tenant rejeita customer_id arbitrário em vez de ignorá-lo', () => {
  assert.doesNotThrow(() => assertTenantGoogleAdsRequestHasNoCustomerId({ from: '2026-08-01' }));
  assert.throws(
    () => assertTenantGoogleAdsRequestHasNoCustomerId({ customer_id: '9999999999' }),
    /customer_id não é aceito/,
  );
  assert.throws(
    () => assertTenantGoogleAdsRequestHasNoCustomerId({ customerId: '9999999999' }),
    /customer_id não é aceito/,
  );
});

test('substituição atômica mantém escopo e permite apagar um range que voltou vazio', () => {
  const replacement = buildGoogleAdsRangeReplacement({
    userId: 'tenant-a',
    customerId: '1234567890',
    range: { from: '2026-08-01', to: '2026-08-16' },
    rows: [],
  });
  assert.deepEqual(replacement, {
    p_user_id: 'tenant-a',
    p_customer_id: '1234567890',
    p_date_from: '2026-08-01',
    p_date_to: '2026-08-16',
    p_rows: [],
  });
});

test('substituição atômica rejeita linha de outro tenant antes de chamar o banco', () => {
  assert.throws(() => buildGoogleAdsRangeReplacement({
    userId: 'tenant-a',
    customerId: '1234567890',
    range: { from: '2026-08-01', to: '2026-08-16' },
    rows: [{
      user_id: 'tenant-b', customer_id: '1234567890', campaign_id: '1', campaign_name: 'Outra',
      campaign_status: 'ENABLED', metric_date: '2026-08-10', impressions: '1', clicks: '1',
      cost_micros: '1', conversions: '0', conversions_value: '0', currency_code: 'BRL',
      time_zone: 'America/Sao_Paulo', synced_at: '2026-08-16T12:00:00.000Z',
      updated_at: '2026-08-16T12:00:00.000Z',
    }],
  }), /fora do escopo do tenant/);
});

test('agregações preservam custo inteiro em micros e calculam CTR/CPC', () => {
  const rows = [
    { campaign_id: '1', campaign_name: 'A', impressions: '100', clicks: '10', cost_micros: '1000001', conversions: '1.5', conversions_value: '20' },
    { campaign_id: '1', campaign_name: 'A', impressions: '300', clicks: '20', cost_micros: '2000002', conversions: '2.5', conversions_value: '30' },
  ];
  const overview = aggregateGoogleAdsOverview(rows);
  assert.equal(overview.cost_micros, '3000003');
  assert.equal(overview.ctr, 0.075);
  assert.equal(overview.avg_cpc_micros, '100000');
  assert.equal(aggregateGoogleAdsCampaigns(rows)[0].cost_micros, '3000003');
});

test('CAC e ROAS só são publicados quando a atribuição CRM é válida', () => {
  assert.deepEqual(computeCrmAttribution({
    valid: true, verifiedClickMapping: true,
    attributedSales: 2, attributedRevenueMicros: '900000000', costMicros: '300000000',
  }), {
    valid: true,
    click_mapping_verified: true,
    attributed_sales: 2,
    attributed_revenue_micros: '900000000',
    cac_micros: '150000000',
    roas: 3,
  });
  assert.equal(computeCrmAttribution({
    valid: false, attributedSales: 2, attributedRevenueMicros: '900000000', costMicros: '300000000',
  }).cac_micros, null);
});

test('CAC e ROAS ficam indisponíveis sem prova clique -> customer/campaign', () => {
  assert.deepEqual(computeCrmAttribution({
    valid: true,
    attributedSales: 4,
    attributedRevenueMicros: '1200000000',
    costMicros: '300000000',
  }), {
    valid: false,
    click_mapping_verified: false,
    attributed_sales: 0,
    attributed_revenue_micros: '0',
    cac_micros: null,
    roas: null,
  });
});

test('rotas tenant leem tabelas Ads só pelo service role com escopo explícito', () => {
  const source = readFileSync(new URL('./server.ts', import.meta.url), 'utf8');
  const start = source.indexOf("app.get('/api/marketing/google-ads/status'");
  const end = source.indexOf("app.get('/api/platform/google-ads/hierarchy'");
  assert.ok(start > 0 && end > start);
  const tenantRoutes = source.slice(start, end);
  assert.doesNotMatch(tenantRoutes, /\(req as any\)\.supabase/);
  assert.doesNotMatch(tenantRoutes, /marketing_touchpoints/);
  assert.match(tenantRoutes, /getGoogleAdsTenantContext\(supabaseAdmin, userId\)/);
  assert.match(tenantRoutes, /listGoogleAdsMetricRows\(supabaseAdmin, userId, link\.customer_id, range\)/);
});

test('unlink é atômico e preserva métricas e histórico de sync', () => {
  const sql = readFileSync(new URL('./migrations/072_google_ads_mcc.sql', import.meta.url), 'utf8');
  const start = sql.indexOf('create or replace function public.unlink_google_ads_customer_from_tenant');
  const end = sql.indexOf('\n$$;', start);
  assert.ok(start > 0 && end > start);
  const unlinkFunction = sql.slice(start, end);
  assert.match(unlinkFunction, /delete from public\.google_ads_connections/);
  assert.match(unlinkFunction, /delete from public\.google_ads_customer_links/);
  assert.doesNotMatch(unlinkFunction, /delete from public\.google_ads_campaign_daily_metrics/);
  assert.doesNotMatch(unlinkFunction, /delete from public\.google_ads_sync_runs/);
  assert.doesNotMatch(sql, /create policy google_ads_/);
});

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

function requireConfig() {
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('VITE_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios');
  }
}

async function exactCount(client, table, configure = (query) => query) {
  const query = configure(client.from(table).select('*', { count: 'exact', head: true }));
  const { count, error } = await query;
  if (error || count === null) return { available: false, error: error?.code || 'schema_missing' };
  return { available: true, count };
}

function configured(names) {
  return Object.fromEntries(names.map((name) => [name, Boolean(process.env[name])]));
}

async function loadSchemaDefinitions() {
  const response = await fetch(`${supabaseUrl.replace(/\/$/, '')}/rest/v1/`, {
    headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` },
  });
  if (!response.ok) throw new Error(`OpenAPI indisponível (${response.status})`);
  const schema = await response.json();
  return schema.definitions || schema.components?.schemas || {};
}

function tableShape(definitions, table, expectedColumns) {
  const properties = definitions[table]?.properties || {};
  const missing = expectedColumns.filter((column) => !properties[column]);
  return { available: Boolean(definitions[table]), missing_columns: missing };
}

async function main() {
  requireConfig();
  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const definitions = await loadSchemaDefinitions();
  const { data: whatsappRows, error: whatsappError } = await client
    .from('whatsapp_business_accounts')
    .select('mode,is_active');
  const activeModes = (whatsappRows || [])
    .filter((row) => row.is_active)
    .reduce((counts, row) => {
      const mode = row.mode || 'unknown';
      counts[mode] = (counts[mode] || 0) + 1;
      return counts;
    }, {});

  const report = {
    database: {
      deals: await exactCount(client, 'deals'),
      converted_deals: await exactCount(client, 'deals', (query) => query.not('converted_at', 'is', null)),
      deals_with_declared_source: await exactCount(client, 'deals', (query) => query.not('lead_source', 'is', null)),
      google_calendar_connections: await exactCount(client, 'google_auth'),
      marketing_touchpoints: await exactCount(client, 'marketing_touchpoints'),
      marketing_conversion_outbox: await exactCount(client, 'marketing_conversion_outbox'),
      whatsapp_business_accounts: whatsappError
        ? { available: false, error: whatsappError.code || 'query_failed' }
        : { available: true, total: whatsappRows?.length || 0, active_modes: activeModes },
      schema: {
        deals: tableShape(definitions, 'deals', ['id', 'user_id', 'converted_at']),
        marketing_touchpoints: tableShape(definitions, 'marketing_touchpoints', [
          'user_id', 'deal_id', 'channel', 'source', 'external_event_id', 'phone',
          'source_url', 'ctwa_clid', 'gclid', 'fbclid', 'ad_id', 'metadata', 'last_seen_at',
        ]),
        marketing_integrations: tableShape(definitions, 'marketing_integrations', [
          'user_id', 'provider', 'enabled', 'account_id', 'destination_id',
          'conversion_action_id', 'credentials_encrypted',
        ]),
        marketing_conversion_outbox: tableShape(definitions, 'marketing_conversion_outbox', [
          'user_id', 'deal_id', 'provider', 'event_name', 'event_id', 'occurred_at',
          'value', 'currency', 'status', 'attempts', 'next_attempt_at', 'sent_at',
        ]),
      },
    },
    runtime: {
      whatsapp_meta: configured(['META_APP_ID', 'META_APP_SECRET', 'META_WA_CONFIG_ID']),
      meta_conversions: configured(['META_DATASET_ID', 'META_CONVERSIONS_ACCESS_TOKEN']),
      google_data_manager: configured([
        'GOOGLE_ADS_CUSTOMER_ID',
        'GOOGLE_ADS_CONVERSION_ACTION_ID',
        'GOOGLE_DATA_MANAGER_PROJECT_ID',
      ]),
    },
  };
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

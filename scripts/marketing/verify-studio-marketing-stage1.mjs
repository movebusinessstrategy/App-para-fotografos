import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(resolve('package.json'));
const { createClient } = require('@supabase/supabase-js');

const PROJECT_REF = 'rxzxmwvnovhrerbsmkqj';
const TENANT_ID = 'b6608c80-b993-444e-8ba8-ddde5bd18ac0';
const SITE_KEY_ID = 'gipitori-web-20260828-v1';
const ORIGIN = 'https://www.gipitorifotografias.com.br';
const PUBLIC_WHATSAPP = '5543996817638';
const LEGACY_WHATSAPP = '554396817638';
const EXPECTED_INTEGRATIONS = {
  ga4: ['343775244', 'G-74HJXH09FF'],
  google: ['8275091764', null],
  meta: ['106504936590336', '104939529371497'],
};

function requiredEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name}_AUSENTE`);
  return value;
}

function assertProject(url) {
  if (new URL(url).hostname.split('.')[0] !== PROJECT_REF) {
    throw new Error('PROJETO_SUPABASE_INCORRETO');
  }
}

async function exactCount(client, table, configure = (query) => query) {
  const query = configure(client.from(table).select('*', { count: 'exact', head: true }));
  const { count, error } = await query;
  if (error || count === null) throw error || new Error(`${table}_CONTAGEM_INDISPONIVEL`);
  return count;
}

function stableHash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

async function legacyOutboxSnapshot(client) {
  const { data, error } = await client
    .from('marketing_conversion_outbox')
    .select('id,provider,status,marketing_site_id,integration_id')
    .eq('user_id', TENANT_ID)
    .is('marketing_site_id', null)
    .is('integration_id', null)
    .order('id');
  if (error || !data || data.length !== 58) {
    throw error || new Error('OUTBOX_LEGADA_DIVERGIU');
  }
  return { count: data.length, sha256: stableHash(data) };
}

async function nonTargetSnapshot(client) {
  const tables = ['deals', 'jobs', 'deal_stages', 'whatsapp_business_accounts'];
  const values = await Promise.all(tables.map((table) => exactCount(
    client,
    table,
    (query) => query.neq('user_id', TENANT_ID),
  )));
  return Object.fromEntries(tables.map((table, index) => [table, values[index]]));
}

async function snapshot(client) {
  const tenant = (query) => query.eq('user_id', TENANT_ID);
  const v2Outbox = (query) => tenant(query).not('marketing_site_id', 'is', null);
  const entries = await Promise.all([
    exactCount(client, 'marketing_touchpoints', tenant),
    exactCount(client, 'marketing_bridge_nonces', tenant),
    exactCount(client, 'marketing_conversion_facts', tenant),
    exactCount(client, 'marketing_consent_ledger', tenant),
    exactCount(client, 'marketing_conversion_outbox', v2Outbox),
  ]);
  return {
    ...Object.fromEntries([
    'touchpoints', 'nonces', 'facts', 'consent_ledger', 'v2_outbox',
    ].map((name, index) => [name, entries[index]])),
    legacy_outbox: await legacyOutboxSnapshot(client),
    non_target: await nonTargetSnapshot(client),
  };
}

function resultStatus(data) {
  const row = Array.isArray(data) ? data[0] : data;
  return String(row?.result_status || row?.status || '');
}

async function assertDisabledConfiguration(client) {
  const { data: site, error } = await client
    .from('marketing_sites')
    .select('id,enabled,measurement_enabled')
    .eq('user_id', TENANT_ID)
    .eq('site_key_id', SITE_KEY_ID)
    .single();
  if (error || !site || site.enabled || site.measurement_enabled) {
    throw error || new Error('SITE_NAO_ESTA_DESATIVADO');
  }
  const [channelResult, mappingResult, integrationResult, ownership] = await Promise.all([
    client.from('marketing_acquisition_channels')
      .select('marketing_site_id,external_account_id,enabled')
      .eq('user_id', TENANT_ID)
      .eq('marketing_site_id', site.id),
    client.from('marketing_stage_event_mappings')
      .select('stage_id,event_name,enabled')
      .eq('user_id', TENANT_ID),
    client.from('marketing_integrations')
      .select('marketing_site_id,provider,enabled,account_id,destination_id')
      .eq('user_id', TENANT_ID)
      .eq('marketing_site_id', site.id),
    exactCount(client, 'marketing_destination_ownership', (query) => query.eq('user_id', TENANT_ID)),
  ]);
  const firstError = channelResult.error || mappingResult.error || integrationResult.error;
  if (firstError) throw firstError;
  const channels = channelResult.data || [];
  const mappings = mappingResult.data || [];
  const integrations = integrationResult.data || [];
  const channelIds = (channels || []).map((row) => row.external_account_id).sort();
  if (stableHash(channelIds) !== stableHash([LEGACY_WHATSAPP, PUBLIC_WHATSAPP].sort())
      || channels.some((row) => row.enabled || row.marketing_site_id !== site.id)) {
    throw new Error('CANAIS_STAGE1_DIVERGIRAM');
  }
  if (mappings?.length !== 1
      || mappings[0].stage_id !== 'proposal'
      || mappings[0].event_name !== 'Lead'
      || mappings[0].enabled) {
    throw new Error('MAPEAMENTO_STAGE1_DIVERGIU');
  }
  const integrationState = integrations.map((row) => [
    row.provider,
    row.account_id,
    row.destination_id || null,
  ]).sort(([left], [right]) => left.localeCompare(right));
  const expectedIntegrationState = Object.entries(EXPECTED_INTEGRATIONS)
    .map(([provider, values]) => [provider, ...values])
    .sort(([left], [right]) => left.localeCompare(right));
  if (integrations.length !== 3
      || integrations.some((row) => row.enabled || row.marketing_site_id !== site.id)
      || stableHash(integrationState) !== stableHash(expectedIntegrationState)
      || ownership !== 0) {
    throw new Error('INTEGRACOES_STAGE1_DIVERGIRAM');
  }
  return site.id;
}

async function rejectedSiteIntake(client) {
  const { data, error } = await client.rpc('register_marketing_site_intake', {
    p_site_key_id: SITE_KEY_ID,
    p_origin: ORIGIN,
    p_nonce_hash: randomBytes(32).toString('hex'),
    p_body_sha256: randomBytes(32).toString('hex'),
    p_signed_at: new Date().toISOString(),
    p_touchpoint: {
      event_name: 'WhatsAppClick',
      event_id: randomUUID(),
      external_event_id: randomUUID(),
      consent_status: 'denied',
      consent_snapshot: {
        analytics_storage: 'denied',
        ad_storage: 'denied',
        ad_user_data: 'denied',
        ad_personalization: 'denied',
      },
    },
  });
  if (error) throw error;
  const status = resultStatus(data);
  if (status !== 'rejected_or_replayed') throw new Error(`SITE_INTAKE_INESPERADO_${status}`);
  return status;
}

async function disabledWhatsAppCapture(client) {
  const { data, error } = await client.rpc('capture_marketing_whatsapp_contact', {
    p_user_id: TENANT_ID,
    p_phone: '5543999999999',
    p_wa_number: PUBLIC_WHATSAPP,
    p_message_id: `stage1-disabled-${randomUUID()}`,
    p_message_body: 'teste sintetico sem referencia',
    p_occurred_at: new Date().toISOString(),
    p_ctwa_clid: null,
    p_waba_id: null,
    p_referral_attribution: {},
  });
  if (error) throw error;
  const status = resultStatus(data);
  if (status !== 'disabled') throw new Error(`WHATSAPP_CAPTURE_INESPERADO_${status}`);
  return status;
}

async function main() {
  const url = requiredEnv('VITE_SUPABASE_URL');
  assertProject(url);
  const client = createClient(url, requiredEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const siteId = await assertDisabledConfiguration(client);
  const before = await snapshot(client);
  const siteIntake = await rejectedSiteIntake(client);
  const whatsappCapture = await disabledWhatsAppCapture(client);
  const after = await snapshot(client);
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    throw new Error('TESTE_SINTETICO_ALTEROU_CONTAGENS');
  }
  console.log(JSON.stringify({
    status: 'stage1_fail_closed_verified',
    project_ref: PROJECT_REF,
    tenant_id: TENANT_ID,
    site_id: siteId,
    synthetic_results: {
      site_intake: siteIntake,
      whatsapp_capture: whatsappCapture,
    },
    before,
    after,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

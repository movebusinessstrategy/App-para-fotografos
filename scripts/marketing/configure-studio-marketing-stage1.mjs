import { execFile as execFileCallback } from 'node:child_process';
import { createCipheriv, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

const require = createRequire(resolve('package.json'));
const { createClient } = require('@supabase/supabase-js');
const execFile = promisify(execFileCallback);

const PROJECT_REF = 'rxzxmwvnovhrerbsmkqj';
const TENANT_ID = 'b6608c80-b993-444e-8ba8-ddde5bd18ac0';
const EMAIL = 'gipitorifotografias@gmail.com';
const SITE_KEY_ID = 'gipitori-web-20260828-v1';
const ORIGIN = 'https://www.gipitorifotografias.com.br';
const SIGNING_SERVICE = 'codex-estudio-gi-pitori-marketing-site-signing';
const REFERENCE_SERVICE = 'codex-estudio-gi-pitori-marketing-bridge-reference';
const REFERENCE_ACCOUNT = 'app-para-fotografos.onrender.com';
const BASELINE_NON_TARGET = {
  deals: 360,
  jobs: 59,
  deal_stages: 60,
  whatsapp_business_accounts: 2,
  marketing_touchpoints: 0,
  marketing_integrations: 0,
  marketing_conversion_outbox: 2,
};
const CHANNELS = ['5543996817638', '554396817638'];
const INTEGRATIONS = {
  meta: {
    account_id: '106504936590336',
    destination_id: '104939529371497',
    conversion_action_id: null,
    event_mappings: {
      Lead: { event_name: 'LeadSubmitted' },
      Purchase: { event_name: 'Purchase' },
    },
    provider_config: {
      state: 'stage1_disabled',
      whatsapp_business_account_id: '490388050815924',
    },
  },
  google: {
    account_id: '8275091764',
    destination_id: null,
    conversion_action_id: null,
    event_mappings: {},
    provider_config: { state: 'stage1_disabled', customer_id: '8275091764' },
  },
  ga4: {
    account_id: '343775244',
    destination_id: 'G-74HJXH09FF',
    conversion_action_id: null,
    event_mappings: {},
    provider_config: { state: 'stage1_disabled', property_id: '343775244' },
  },
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

async function exactTenant(client) {
  const result = await client.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (result.error) throw result.error;
  const matches = (result.data?.users || []).filter(
    (user) => String(user.email || '').toLowerCase() === EMAIL,
  );
  if (matches.length !== 1 || matches[0].id !== TENANT_ID) {
    throw new Error('TENANT_EXATO_NAO_CONFIRMADO');
  }
}

async function counts(client, table) {
  const global = await client.from(table).select('*', { count: 'exact', head: true });
  const target = await client.from(table).select('*', { count: 'exact', head: true }).eq('user_id', TENANT_ID);
  if (global.error || target.error || global.count === null || target.count === null) {
    throw new Error(`${table}_CONTAGEM_INDISPONIVEL`);
  }
  return { global: global.count, target: target.count, non_target: global.count - target.count };
}

async function assertLegacyIsolation(client, expectedSnapshot = null) {
  const report = {};
  for (const [table, minimumNonTarget] of Object.entries(BASELINE_NON_TARGET)) {
    const current = await counts(client, table);
    if (current.non_target < minimumNonTarget) {
      throw new Error(`${table}_OUTRO_TENANT_ABAIXO_DO_BACKUP`);
    }
    if (expectedSnapshot && current.non_target !== expectedSnapshot[table].non_target) {
      throw new Error(`${table}_OUTRO_TENANT_DIVERGIU`);
    }
    report[table] = current;
  }
  const legacyOutbox = await client
    .from('marketing_conversion_outbox')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', TENANT_ID)
    .is('marketing_site_id', null)
    .is('integration_id', null);
  if (legacyOutbox.error || legacyOutbox.count !== 58) {
    throw new Error('OUTBOX_LEGADA_DO_ESTUDIO_DIVERGIU');
  }
  return report;
}

async function keychainRead(service, account) {
  try {
    const result = await execFile('security', [
      'find-generic-password', '-s', service, '-a', account, '-w',
    ]);
    return result.stdout.trim() || null;
  } catch {
    return null;
  }
}

async function keychainWrite(service, account, value) {
  await execFile('security', [
    'add-generic-password', '-U', '-s', service, '-a', account, '-w', value,
  ]);
}

async function getOrCreateSecret(service, account) {
  const existing = await keychainRead(service, account);
  if (existing) return existing;
  const secret = randomBytes(32).toString('base64url');
  await keychainWrite(service, account, secret);
  return secret;
}

function encryptionKey() {
  const hex = requiredEnv('WA_TOKEN_ENCRYPTION_KEY');
  if (!/^[0-9a-f]{64}$/i.test(hex)) throw new Error('WA_TOKEN_ENCRYPTION_KEY_INVALIDA');
  return Buffer.from(hex, 'hex');
}

function encryptStrict(plaintext) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return `enc:v1:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${ciphertext.toString('base64')}`;
}

async function existingRows(client, table, configure) {
  const query = configure(client.from(table).select('*'));
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

async function insertOne(client, createdRows, table, row) {
  const { data, error } = await client.from(table).insert(row).select('*').single();
  if (error || !data) throw error || new Error(`${table}_INSERT_SEM_RETORNO`);
  createdRows.push({ table, id: data.id });
  return data;
}

async function ensureSite(client, createdRows, encryptedSecret) {
  const existing = await existingRows(client, 'marketing_sites', (query) => query.eq('site_key_id', SITE_KEY_ID));
  if (existing.length > 1) throw new Error('SITE_KEY_DUPLICADA');
  if (existing.length === 1) {
    const site = existing[0];
    if (site.user_id !== TENANT_ID || site.enabled || site.measurement_enabled) {
      throw new Error('SITE_EXISTENTE_INCOMPATIVEL');
    }
    return site;
  }
  return insertOne(client, createdRows, 'marketing_sites', {
    user_id: TENANT_ID,
    name: 'Site Estúdio Gi Pitori',
    site_key_id: SITE_KEY_ID,
    signing_secret_ciphertext: encryptedSecret,
    allowed_origins: [ORIGIN],
    enabled: false,
    measurement_enabled: false,
    key_version: 1,
  });
}

async function ensureChannels(client, createdRows, siteId) {
  for (const externalAccountId of CHANNELS) {
    const rows = await existingRows(client, 'marketing_acquisition_channels', (query) => query
      .eq('user_id', TENANT_ID)
      .eq('channel', 'whatsapp')
      .eq('external_account_id', externalAccountId));
    if (rows.length > 1) throw new Error('CANAL_DUPLICADO');
    if (rows.length === 1) {
      if (rows[0].marketing_site_id !== siteId || rows[0].enabled) throw new Error('CANAL_INCOMPATIVEL');
      continue;
    }
    await insertOne(client, createdRows, 'marketing_acquisition_channels', {
      user_id: TENANT_ID,
      marketing_site_id: siteId,
      channel: 'whatsapp',
      external_account_id: externalAccountId,
      enabled: false,
    });
  }
}

async function ensureStageMapping(client, createdRows) {
  const rows = await existingRows(client, 'marketing_stage_event_mappings', (query) => query
    .eq('user_id', TENANT_ID)
    .eq('stage_id', 'proposal')
    .eq('event_name', 'Lead'));
  if (rows.length > 1) throw new Error('MAPEAMENTO_DUPLICADO');
  if (rows.length === 1) {
    if (rows[0].enabled) throw new Error('MAPEAMENTO_JA_ATIVO');
    return;
  }
  await insertOne(client, createdRows, 'marketing_stage_event_mappings', {
    user_id: TENANT_ID,
    stage_id: 'proposal',
    event_name: 'Lead',
    enabled: false,
  });
}

async function assertDestinationFree(client, provider, destinationId) {
  if (!destinationId) return;
  const rows = await existingRows(client, 'marketing_integrations', (query) => query
    .eq('provider', provider)
    .eq('destination_id', destinationId));
  const foreign = rows.filter((row) => row.user_id !== TENANT_ID);
  if (foreign.length) throw new Error(`${provider}_DESTINO_JA_PERTENCE_A_OUTRO_TENANT`);
}

async function ensureIntegration(client, createdRows, siteId, provider, config) {
  await assertDestinationFree(client, provider, config.destination_id);
  const rows = await existingRows(client, 'marketing_integrations', (query) => query
    .eq('user_id', TENANT_ID)
    .eq('marketing_site_id', siteId)
    .eq('provider', provider));
  if (rows.length > 1) throw new Error(`${provider}_INTEGRACAO_DUPLICADA`);
  if (rows.length === 1) {
    const row = rows[0];
    const sameDestination = (row.destination_id || null) === config.destination_id;
    if (row.enabled || row.account_id !== config.account_id || !sameDestination) {
      throw new Error(`${provider}_INTEGRACAO_INCOMPATIVEL`);
    }
    return row;
  }
  return insertOne(client, createdRows, 'marketing_integrations', {
    user_id: TENANT_ID,
    marketing_site_id: siteId,
    provider,
    enabled: false,
    account_id: config.account_id,
    destination_id: config.destination_id,
    conversion_action_id: config.conversion_action_id,
    credentials_encrypted: encryptStrict(JSON.stringify({ provider, state: 'not_configured' })),
    event_mappings: config.event_mappings,
    provider_config: config.provider_config,
    last_error: 'STAGE1_DISABLED_PENDING_CREDENTIALS',
  });
}

async function rollbackCreated(client, createdRows) {
  for (const row of [...createdRows].reverse()) {
    await client.from(row.table).delete().eq('id', row.id).eq('user_id', TENANT_ID);
  }
}

async function verifyStage1(client, siteId) {
  const [sites, channels, mappings, integrations, ownership, facts, v2Outbox] = await Promise.all([
    existingRows(client, 'marketing_sites', (q) => q.eq('user_id', TENANT_ID).eq('id', siteId)),
    existingRows(client, 'marketing_acquisition_channels', (q) => q.eq('user_id', TENANT_ID).eq('marketing_site_id', siteId)),
    existingRows(client, 'marketing_stage_event_mappings', (q) => q.eq('user_id', TENANT_ID)),
    existingRows(client, 'marketing_integrations', (q) => q.eq('user_id', TENANT_ID).eq('marketing_site_id', siteId)),
    existingRows(client, 'marketing_destination_ownership', (q) => q.eq('user_id', TENANT_ID)),
    existingRows(client, 'marketing_conversion_facts', (q) => q.eq('user_id', TENANT_ID)),
    existingRows(client, 'marketing_conversion_outbox', (q) => q.eq('user_id', TENANT_ID).not('marketing_site_id', 'is', null)),
  ]);
  const disabled = sites.every((row) => !row.enabled && !row.measurement_enabled)
    && channels.every((row) => !row.enabled)
    && mappings.every((row) => !row.enabled)
    && integrations.every((row) => !row.enabled);
  if (sites.length !== 1 || channels.length !== 2 || mappings.length !== 1 || integrations.length !== 3) {
    throw new Error('CONFIGURACAO_STAGE1_INCOMPLETA');
  }
  if (!disabled || ownership.length || facts.length || v2Outbox.length) {
    throw new Error('STAGE1_NAO_ESTA_FAIL_CLOSED');
  }
  return {
    site_id: siteId,
    sites: sites.length,
    channels: channels.length,
    stage_mappings: mappings.length,
    integrations: integrations.length,
    ownership: ownership.length,
    facts: facts.length,
    v2_outbox: v2Outbox.length,
    all_disabled: disabled,
  };
}

async function main() {
  const supabaseUrl = requiredEnv('VITE_SUPABASE_URL');
  const serviceRoleKey = requiredEnv('SUPABASE_SERVICE_ROLE_KEY');
  assertProject(supabaseUrl);
  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  await exactTenant(client);
  const pre = await assertLegacyIsolation(client);
  const signingSecret = await getOrCreateSecret(SIGNING_SERVICE, SITE_KEY_ID);
  await getOrCreateSecret(REFERENCE_SERVICE, REFERENCE_ACCOUNT);
  const createdRows = [];
  try {
    const site = await ensureSite(client, createdRows, encryptStrict(signingSecret));
    await ensureChannels(client, createdRows, site.id);
    await ensureStageMapping(client, createdRows);
    for (const [provider, config] of Object.entries(INTEGRATIONS)) {
      await ensureIntegration(client, createdRows, site.id, provider, config);
    }
    const stage1 = await verifyStage1(client, site.id);
    const post = await assertLegacyIsolation(client, pre);
    console.log(JSON.stringify({
      status: 'configured_disabled',
      project_ref: PROJECT_REF,
      tenant_id: TENANT_ID,
      site_key_id: SITE_KEY_ID,
      stage1,
      pre_counts: pre,
      post_counts: post,
      signing_secret_keychain_service: SIGNING_SERVICE,
      bridge_reference_keychain_service: REFERENCE_SERVICE,
    }, null, 2));
  } catch (error) {
    await rollbackCreated(client, createdRows);
    throw error;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';

const TARGET_PHONE = process.argv[2] || process.env.WABA_AUDIT_PHONE || '';
const GRAPH = 'https://graph.facebook.com/v21.0';
const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

function requireConfig() {
  const required = {
    VITE_SUPABASE_URL: supabaseUrl,
    SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
    WABA_AUDIT_PHONE: TARGET_PHONE,
  };
  const missing = Object.entries(required).filter(([, value]) => !value).map(([name]) => name);
  if (missing.length) throw new Error(`Configuração ausente: ${missing.join(', ')}`);
}

function decryptToken(blob) {
  if (!blob?.startsWith('enc:v1:')) return blob || null;
  const keyHex = process.env.WA_TOKEN_ENCRYPTION_KEY || '';
  if (!/^[a-f\d]{64}$/i.test(keyHex)) return null;
  const [, , ivBase64, tagBase64, ciphertextBase64] = blob.split(':');
  if (!ivBase64 || !tagBase64 || !ciphertextBase64) return null;
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    Buffer.from(keyHex, 'hex'),
    Buffer.from(ivBase64, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(tagBase64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextBase64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

async function graphGet(path, token) {
  try {
    const response = await fetch(`${GRAPH}/${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await response.json().catch(() => null);
    return { ok: response.ok, status: response.status, data };
  } catch (error) {
    return { ok: false, status: 0, error: error instanceof Error ? error.message : String(error) };
  }
}

function latestTimestamp(rows, fromMe) {
  return rows.find((row) => row.from_me === fromMe)?.timestamp || null;
}

function countBy(rows, field) {
  return rows.reduce((counts, row) => {
    const key = row[field] || 'unknown';
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function parseR2Reference(reference) {
  const match = String(reference || '').match(/^r2:\/\/([^/]+)\/(.+)$/);
  return match ? { logicalBucket: match[1], path: match[2] } : null;
}

function createR2Client() {
  const accountId = process.env.R2_ACCOUNT_ID || '';
  const accessKeyId = process.env.R2_ACCESS_KEY_ID || '';
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY || '';
  if (!accountId || !accessKeyId || !secretAccessKey) return null;
  return new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
  });
}

async function checkR2Sample(rows) {
  const reference = rows.map((row) => parseR2Reference(row.media_url)).find(Boolean);
  const client = createR2Client();
  const bucket = process.env.R2_BUCKET || '';
  if (!reference) return { applicable: false, reason: 'no_r2_media_in_sample' };
  if (!client || !bucket) return { applicable: true, ok: false, reason: 'r2_runtime_config_missing' };
  try {
    const result = await client.send(new HeadObjectCommand({
      Bucket: bucket,
      Key: `${reference.logicalBucket}/${reference.path}`,
    }));
    return {
      applicable: true,
      ok: true,
      content_length: result.ContentLength || null,
      content_type: result.ContentType || null,
    };
  } catch (error) {
    return {
      applicable: true,
      ok: false,
      reason: error instanceof Error ? error.name : String(error),
    };
  }
}

async function loadAccount(client) {
  const { data, error } = await client
    .from('whatsapp_business_accounts')
    .select('user_id,waba_id,phone_number_id,phone_number,access_token,token_expires_at,connected_at,is_active,mode')
    .eq('phone_number', TARGET_PHONE)
    .eq('is_active', true)
    .maybeSingle();
  if (error) throw new Error(`Falha ao ler conta WABA: ${error.message}`);
  if (!data) throw new Error(`Nenhuma WABA ativa encontrada para ${TARGET_PHONE}`);
  return data;
}

async function loadMessageEvidence(client, account) {
  const waNumber = account.phone_number.replace(/\D/g, '');
  const { data: messages, error: messageError } = await client
    .from('wa_messages')
    .select('timestamp,from_me,type,status,media_url,wa_number')
    .eq('user_id', account.user_id)
    .order('timestamp', { ascending: false })
    .limit(500);
  if (messageError) throw new Error(`Falha ao ler mensagens: ${messageError.message}`);

  const { data: conversations, error: conversationError } = await client
    .from('wa_conversations')
    .select('wa_number')
    .eq('user_id', account.user_id)
    .order('last_message_at', { ascending: false })
    .limit(1000);
  if (conversationError) throw new Error(`Falha ao contar conversas: ${conversationError.message}`);

  const rows = (messages || []).filter((row) => row.wa_number === waNumber);
  const matchingConversations = (conversations || []).filter((row) => row.wa_number === waNumber);
  const connectedAt = account.connected_at ? new Date(account.connected_at).getTime() : 0;
  const inboundAt = latestTimestamp(rows, false);
  const outboundAt = latestTimestamp(rows, true);
  const mediaRows = rows.filter((row) => row.media_url);
  const r2Rows = mediaRows.filter((row) => parseR2Reference(row.media_url));

  return {
    wa_number_matches_account: true,
    conversations_sampled: matchingConversations.length,
    conversations_scan_limited: (conversations || []).length === 1000,
    messages_sampled: rows.length,
    inbound_sampled: rows.filter((row) => !row.from_me).length,
    outbound_sampled: rows.filter((row) => row.from_me).length,
    latest_inbound_at: inboundAt,
    latest_outbound_at: outboundAt,
    inbound_after_waba_connection: Boolean(inboundAt && new Date(inboundAt).getTime() >= connectedAt),
    outbound_after_waba_connection: Boolean(outboundAt && new Date(outboundAt).getTime() >= connectedAt),
    message_types: countBy(rows, 'type'),
    outbound_statuses: countBy(rows.filter((row) => row.from_me), 'status'),
    media_references: mediaRows.length,
    r2_media_references: r2Rows.length,
    r2_sample: await checkR2Sample(r2Rows),
  };
}

async function loadGraphEvidence(account, token) {
  const appId = process.env.META_APP_ID || '';
  const appSecret = process.env.META_APP_SECRET || '';
  const [waba, phone, subscriptions, tokenDebug] = await Promise.all([
    graphGet(`${account.waba_id}?fields=id,name`, token),
    graphGet(`${account.phone_number_id}?fields=id,display_phone_number,verified_name,code_verification_status,quality_rating,platform_type`, token),
    graphGet(`${account.waba_id}/subscribed_apps`, token),
    appId && appSecret
      ? graphGet(`debug_token?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(`${appId}|${appSecret}`)}`, token)
      : Promise.resolve({ ok: false, status: 0, data: null }),
  ]);
  const apps = Array.isArray(subscriptions.data?.data) ? subscriptions.data.data : [];
  const app = apps.find((item) => String(item?.whatsapp_business_api_data?.id || item?.id) === String(appId));
  const subscribedFields = app?.subscribed_fields || app?.whatsapp_business_api_data?.subscribed_fields || [];
  const granularScopes = tokenDebug.data?.data?.granular_scopes || [];
  const scopeNames = granularScopes.map((scope) => scope.scope);

  return {
    token_decrypted: Boolean(token),
    token_valid: tokenDebug.data?.data?.is_valid === true,
    required_scopes: {
      whatsapp_business_messaging: scopeNames.includes('whatsapp_business_messaging'),
      whatsapp_business_management: scopeNames.includes('whatsapp_business_management'),
    },
    waba_accessible: waba.ok,
    phone_accessible: phone.ok,
    platform_type: phone.data?.platform_type || null,
    code_verification_status: phone.data?.code_verification_status || null,
    quality_rating: phone.data?.quality_rating || null,
    app_subscribed: Boolean(app),
    messages_field_subscribed: subscribedFields.length === 0 ? null : subscribedFields.includes('messages'),
    graph_statuses: {
      waba: waba.status,
      phone: phone.status,
      subscriptions: subscriptions.status,
      token_debug: tokenDebug.status,
    },
  };
}

async function main() {
  requireConfig();
  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const account = await loadAccount(client);
  const token = decryptToken(account.access_token);
  if (!token) throw new Error('Token WABA não pôde ser decifrado com a chave atual');
  const [graph, persistence] = await Promise.all([
    loadGraphEvidence(account, token),
    loadMessageEvidence(client, account),
  ]);
  const report = {
    audited_at: new Date().toISOString(),
    account: {
      active: account.is_active === true,
      mode: account.mode || 'cloud_api',
      connected_at: account.connected_at,
      token_expires_at: account.token_expires_at,
      target_phone: TARGET_PHONE,
    },
    graph,
    persistence,
  };
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

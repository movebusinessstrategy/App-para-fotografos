import { execFile as execFileCallback } from 'node:child_process';
import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt as scryptCallback } from 'node:crypto';
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { gzip as gzipCallback, gunzip as gunzipCallback } from 'node:zlib';

const require = createRequire(resolve('package.json'));
const { createClient } = require('@supabase/supabase-js');

const execFile = promisify(execFileCallback);
const gzip = promisify(gzipCallback);
const gunzip = promisify(gunzipCallback);
const scrypt = promisify(scryptCallback);

const EXPECTED_PROJECT_REF = 'rxzxmwvnovhrerbsmkqj';
const EXPECTED_TENANT_ID = 'b6608c80-b993-444e-8ba8-ddde5bd18ac0';
const EXPECTED_EMAIL = 'gipitorifotografias@gmail.com';
const TABLES = [
  'deals',
  'jobs',
  'deal_stages',
  'whatsapp_business_accounts',
  'marketing_touchpoints',
  'marketing_integrations',
  'marketing_conversion_outbox',
];
const PAGE_SIZE = 500;

function requiredEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} ausente`);
  return value;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function projectRef(url) {
  const hostname = new URL(url).hostname;
  const [ref] = hostname.split('.');
  return ref;
}

async function resolveExactTenant(client) {
  const matches = [];
  for (let page = 1; page <= 20; page += 1) {
    const result = await client.auth.admin.listUsers({ page, perPage: 1000 });
    if (result.error) throw result.error;
    const users = result.data?.users || [];
    matches.push(...users.filter((user) => String(user.email || '').toLowerCase() === EXPECTED_EMAIL));
    if (users.length < 1000) break;
  }
  if (matches.length !== 1 || matches[0].id !== EXPECTED_TENANT_ID) {
    throw new Error('TENANT_EXATO_NAO_CONFIRMADO');
  }
  return matches[0].id;
}

async function fetchRows(client, table, tenantId) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await client
      .from(table)
      .select('*')
      .eq('user_id', tenantId)
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`${table}:${error.code || error.message}`);
    rows.push(...(data || []));
    if ((data || []).length < PAGE_SIZE) return rows;
  }
}

async function exactCount(client, table, tenantId = null) {
  let query = client.from(table).select('*', { count: 'exact', head: true });
  if (tenantId) query = query.eq('user_id', tenantId);
  const { count, error } = await query;
  if (error || count === null) throw new Error(`${table}:count:${error?.code || 'unknown'}`);
  return count;
}

function watermark(rows) {
  const ids = rows.map((row) => row.id).filter((value) => value !== null && value !== undefined);
  const times = rows
    .flatMap((row) => [row.updated_at, row.created_at, row.converted_at])
    .filter(Boolean)
    .sort();
  return {
    last_id: ids.length ? ids.at(-1) : null,
    last_timestamp: times.length ? times.at(-1) : null,
  };
}

async function captureSnapshot(client, tenantId) {
  const tables = {};
  for (const table of TABLES) {
    const rows = await fetchRows(client, table, tenantId);
    const globalCount = await exactCount(client, table);
    const targetCount = await exactCount(client, table, tenantId);
    if (rows.length !== targetCount) throw new Error(`${table}:PAGINACAO_INCONSISTENTE`);
    tables[table] = {
      rows,
      counts: {
        global: globalCount,
        target: targetCount,
        non_target: globalCount - targetCount,
      },
      row_sha256: sha256(JSON.stringify(rows)),
      watermark: watermark(rows),
    };
  }
  return tables;
}

function snapshotFingerprint(tables) {
  return sha256(JSON.stringify(Object.fromEntries(TABLES.map((table) => [table, {
    counts: tables[table].counts,
    row_sha256: tables[table].row_sha256,
  }]))));
}

async function loadOpenApi(supabaseUrl, serviceRoleKey) {
  const response = await fetch(`${supabaseUrl.replace(/\/$/, '')}/rest/v1/`, {
    headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` },
  });
  if (!response.ok) throw new Error(`OPENAPI_${response.status}`);
  return response.json();
}

async function deriveKey(passphrase, salt) {
  return scrypt(passphrase, salt, 32);
}

async function encryptPayload(payload, aadObject, passphrase) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const aad = Buffer.from(JSON.stringify(aadObject));
  const key = await deriveKey(passphrase, salt);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(payload), cipher.final()]);
  return { salt, iv, aad, tag: cipher.getAuthTag(), ciphertext };
}

async function verifyEnvelope(envelope, passphrase, expectedPayloadHash) {
  const salt = Buffer.from(envelope.salt, 'base64');
  const iv = Buffer.from(envelope.iv, 'base64');
  const aad = Buffer.from(envelope.aad, 'base64');
  const tag = Buffer.from(envelope.tag, 'base64');
  const ciphertext = Buffer.from(envelope.ciphertext, 'base64');
  const key = await deriveKey(passphrase, salt);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(aad);
  decipher.setAuthTag(tag);
  const compressed = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  const plain = await gunzip(compressed);
  if (sha256(plain) !== expectedPayloadHash) throw new Error('BACKUP_HASH_INVALIDO');
  JSON.parse(plain.toString('utf8'));
}

async function saveKeychain(service, account, passphrase) {
  await execFile('security', [
    'add-generic-password',
    '-U',
    '-s', service,
    '-a', account,
    '-w', passphrase,
  ]);
}

async function removeKeychain(service, account) {
  await execFile('security', ['delete-generic-password', '-s', service, '-a', account]).catch(() => {});
}

async function writeAtomic(path, data, mode = 0o600) {
  const temporary = `${path}.tmp`;
  await writeFile(temporary, data, { mode });
  await rename(temporary, path);
}

function publicTableManifest(tables) {
  return Object.fromEntries(TABLES.map((table) => [table, {
    counts: tables[table].counts,
    row_sha256: tables[table].row_sha256,
    watermark: tables[table].watermark,
  }]));
}

async function main() {
  const supabaseUrl = requiredEnv('VITE_SUPABASE_URL');
  const serviceRoleKey = requiredEnv('SUPABASE_SERVICE_ROLE_KEY');
  if (projectRef(supabaseUrl) !== EXPECTED_PROJECT_REF) throw new Error('PROJETO_SUPABASE_INCORRETO');

  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const tenantId = await resolveExactTenant(client);
  const first = await captureSnapshot(client, tenantId);
  const second = await captureSnapshot(client, tenantId);
  if (snapshotFingerprint(first) !== snapshotFingerprint(second)) {
    throw new Error('SNAPSHOT_MUDOU_DURANTE_BACKUP');
  }

  const capturedAt = new Date().toISOString();
  const openapi = await loadOpenApi(supabaseUrl, serviceRoleKey);
  const payload = Buffer.from(JSON.stringify({
    format: 'studio-marketing-tenant-backup-v1',
    project_ref: EXPECTED_PROJECT_REF,
    tenant_id: tenantId,
    captured_at: capturedAt,
    tables: Object.fromEntries(TABLES.map((table) => [table, second[table].rows])),
    openapi,
  }));
  const compressed = await gzip(payload, { level: 9 });
  const payloadHash = sha256(payload);
  const snapshotHash = snapshotFingerprint(second);
  const stamp = capturedAt.replace(/[:.]/g, '-');
  const folder = resolve('private-backups', `estudio-gi-pitori-marketing-pre074-${stamp}`);
  const envelopePath = join(folder, 'tenant-backup.aes256gcm.json');
  const manifestPath = join(folder, 'manifest.json');
  const keychainService = `codex-estudio-gi-pitori-marketing-pre074-${stamp}`;
  const keychainAccount = EXPECTED_EMAIL;
  const passphrase = randomBytes(32).toString('base64url');
  const aad = {
    format: 'studio-marketing-tenant-backup-v1',
    project_ref: EXPECTED_PROJECT_REF,
    tenant_id: tenantId,
    captured_at: capturedAt,
    payload_sha256: payloadHash,
    snapshot_sha256: snapshotHash,
  };
  const encrypted = await encryptPayload(compressed, aad, passphrase);
  const envelope = {
    format: 'aes-256-gcm+scrypt+gzip-v1',
    salt: encrypted.salt.toString('base64'),
    iv: encrypted.iv.toString('base64'),
    aad: encrypted.aad.toString('base64'),
    tag: encrypted.tag.toString('base64'),
    ciphertext: encrypted.ciphertext.toString('base64'),
  };
  await verifyEnvelope(envelope, passphrase, payloadHash);

  await mkdir(folder, { recursive: false, mode: 0o700 });
  let keySaved = false;
  try {
    await saveKeychain(keychainService, keychainAccount, passphrase);
    keySaved = true;
    const envelopeBytes = Buffer.from(JSON.stringify(envelope));
    await writeAtomic(envelopePath, envelopeBytes);
    const manifest = {
      ...aad,
      encrypted_file: basename(envelopePath),
      encrypted_sha256: sha256(envelopeBytes),
      keychain: { service: keychainService, account: keychainAccount },
      verified_in_memory: true,
      tables: publicTableManifest(second),
    };
    await writeAtomic(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(JSON.stringify({
      status: 'backup_verified',
      folder,
      manifest: manifestPath,
      encrypted_file: envelopePath,
      keychain_service: keychainService,
      snapshot_sha256: snapshotHash,
      counts: Object.fromEntries(TABLES.map((table) => [table, second[table].counts])),
    }, null, 2));
  } catch (error) {
    await unlink(`${envelopePath}.tmp`).catch(() => {});
    await unlink(`${manifestPath}.tmp`).catch(() => {});
    if (keySaved) await removeKeychain(keychainService, keychainAccount);
    throw error;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

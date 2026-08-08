import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { dirname, join, resolve } from 'node:path';
import { createGzip, gunzipSync } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { createClient } from '@supabase/supabase-js';

const PAGE_SIZE = 1000;
const TABLE_PAGE_SIZES = new Map([['wa_messages', 500]]);
const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

function requireConfig() {
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('VITE_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios');
  }
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function requestHeaders(extra = {}) {
  return {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    ...extra,
  };
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const message = await response.text();
    throw new Error(`${response.status} ${response.statusText}: ${message.slice(0, 500)}`);
  }
  return response.json();
}

async function discoverPublicTables() {
  const spec = await fetchJson(`${supabaseUrl}/rest/v1/`, {
    headers: requestHeaders({ Accept: 'application/openapi+json' }),
  });
  return { spec, tables: Object.keys(spec.definitions || {}).sort() };
}

async function createNdjsonGzip(path) {
  await mkdir(dirname(path), { recursive: true });
  const gzip = createGzip({ level: 9 });
  const output = createWriteStream(path, { mode: 0o600 });
  const completion = pipeline(gzip, output);
  return { completion, gzip };
}

async function writeJsonLine(stream, value) {
  if (stream.write(`${JSON.stringify(value)}\n`)) return;
  await once(stream, 'drain');
}

function singlePrimaryKey(definition) {
  const keys = Object.entries(definition?.properties || {})
    .filter(([, property]) => property?.description?.includes('<pk/>'))
    .map(([name]) => name);
  return keys.length === 1 ? keys[0] : null;
}

function configurePage(url, primaryKey, offset, lastKey, pageSize) {
  url.searchParams.set('select', '*');
  url.searchParams.set('limit', String(pageSize));
  if (!primaryKey) {
    url.searchParams.set('offset', String(offset));
    return;
  }
  url.searchParams.set('order', `${primaryKey}.asc`);
  if (lastKey != null) url.searchParams.set(primaryKey, `gt.${lastKey}`);
}

async function exportPublicTable(table, definition, outputDir) {
  const path = join(outputDir, 'tables', `${table}.ndjson.gz`);
  const { completion, gzip } = await createNdjsonGzip(path);
  const primaryKey = singlePrimaryKey(definition);
  const pageSize = TABLE_PAGE_SIZES.get(table) || PAGE_SIZE;
  let lastKey = null;
  let offset = 0;
  let rowsWritten = 0;

  for (;;) {
    const url = new URL(`${supabaseUrl}/rest/v1/${encodeURIComponent(table)}`);
    configurePage(url, primaryKey, offset, lastKey, pageSize);
    const rows = await fetchJson(url, { headers: requestHeaders({ 'Accept-Profile': 'public' }) });
    for (const row of rows) await writeJsonLine(gzip, row);
    rowsWritten += rows.length;
    if (rows.length < pageSize) break;
    if (primaryKey) lastKey = rows.at(-1)?.[primaryKey];
    offset += pageSize;
  }

  gzip.end();
  await completion;
  return { path, rows: rowsWritten, table };
}

async function exportAuthUsers(client, outputDir) {
  const path = join(outputDir, 'auth-users.ndjson.gz');
  const { completion, gzip } = await createNdjsonGzip(path);
  let page = 1;
  let rows = 0;

  for (;;) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: PAGE_SIZE });
    if (error) throw error;
    const users = data?.users || [];
    for (const user of users) await writeJsonLine(gzip, user);
    rows += users.length;
    if (users.length < PAGE_SIZE) break;
    page += 1;
  }

  gzip.end();
  await completion;
  return { path, rows };
}

function isStorageFolder(item) {
  return item?.id == null && item?.metadata == null;
}

async function listStoragePrefix(client, bucket, prefix, stream, counters) {
  let offset = 0;
  for (;;) {
    const { data, error } = await client.storage.from(bucket).list(prefix, {
      limit: PAGE_SIZE,
      offset,
      sortBy: { column: 'name', order: 'asc' },
    });
    if (error) throw error;
    const items = data || [];
    for (const item of items) {
      const path = prefix ? `${prefix}/${item.name}` : item.name;
      if (isStorageFolder(item)) {
        await listStoragePrefix(client, bucket, path, stream, counters);
        continue;
      }
      const size = Number(item?.metadata?.size || 0);
      counters.objects += 1;
      counters.bytes += size;
      await writeJsonLine(stream, { bucket, path, size, ...item });
    }
    if (items.length < PAGE_SIZE) return;
    offset += PAGE_SIZE;
  }
}

async function exportStorageManifest(client, outputDir) {
  const path = join(outputDir, 'storage-objects.ndjson.gz');
  const { completion, gzip } = await createNdjsonGzip(path);
  const { data: buckets, error } = await client.storage.listBuckets();
  if (error) throw error;
  const totals = { buckets: buckets?.length || 0, bytes: 0, objects: 0 };

  for (const bucket of buckets || []) {
    await listStoragePrefix(client, bucket.name, '', gzip, totals);
  }

  gzip.end();
  await completion;
  return { path, ...totals };
}

async function gzipJson(path, value) {
  const tempPath = `${path}.json`;
  await writeFile(tempPath, JSON.stringify(value), { mode: 0o600 });
  const input = await import('node:fs').then(({ createReadStream }) => createReadStream(tempPath));
  await pipeline(input, createGzip({ level: 9 }), createWriteStream(path, { mode: 0o600 }));
  await import('node:fs/promises').then(({ unlink }) => unlink(tempPath));
}

async function fileDigest(path) {
  const data = await readFile(path);
  const decoded = gunzipSync(data);
  const lines = decoded.length ? decoded.toString('utf8').trimEnd().split('\n').length : 0;
  return {
    bytes: data.length,
    lines,
    sha256: createHash('sha256').update(data).digest('hex'),
  };
}

async function listBackupFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listBackupFiles(path));
    if (entry.isFile() && entry.name.endsWith('.gz')) files.push(path);
  }
  return files.sort();
}

async function buildVerification(outputDir) {
  const files = await listBackupFiles(outputDir);
  const verification = [];
  for (const path of files) {
    verification.push({ file: path.slice(outputDir.length + 1), ...await fileDigest(path) });
  }
  return verification;
}

async function main() {
  requireConfig();
  const outputDir = resolve(process.argv[2] || join('private-backups', `supabase-${timestamp()}`));
  await mkdir(outputDir, { recursive: true, mode: 0o700 });

  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { spec, tables } = await discoverPublicTables();
  await gzipJson(join(outputDir, 'public-openapi.json.gz'), spec);

  const tableExports = [];
  for (const table of tables) {
    const result = await exportPublicTable(table, spec.definitions?.[table], outputDir);
    tableExports.push({ table: result.table, rows: result.rows });
    console.log(`table ${result.table}: ${result.rows}`);
  }

  const auth = await exportAuthUsers(client, outputDir);
  const storage = await exportStorageManifest(client, outputDir);
  const verification = await buildVerification(outputDir);
  const totalBytes = verification.reduce((sum, item) => sum + item.bytes, 0);
  const manifest = {
    created_at: new Date().toISOString(),
    format: 'supabase-logical-backup-v1',
    project_ref: new URL(supabaseUrl).hostname.split('.')[0],
    tables: tableExports,
    auth_users: auth.rows,
    storage,
    verification,
    compressed_bytes: totalBytes,
  };
  await writeFile(join(outputDir, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 });

  const manifestStat = await stat(join(outputDir, 'manifest.json'));
  console.log(JSON.stringify({ outputDir, manifestBytes: manifestStat.size, ...manifest }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

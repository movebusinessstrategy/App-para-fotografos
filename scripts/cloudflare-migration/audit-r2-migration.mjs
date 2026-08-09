import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { createGunzip, gunzipSync } from 'node:zlib';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { createClient } from '@supabase/supabase-js';

const HEAD_CONCURRENCY = 12;
const GET_CONCURRENCY = 4;
const PAGE_SIZE = 500;
const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const accountId = process.env.R2_ACCOUNT_ID || '';
const accessKeyId = process.env.R2_ACCESS_KEY_ID || '';
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY || '';
const r2Bucket = process.env.R2_BUCKET || '';

function requireConfig() {
  const values = { supabaseUrl, serviceRoleKey, accountId, accessKeyId, secretAccessKey, r2Bucket };
  const missing = Object.entries(values).filter(([, value]) => !value).map(([name]) => name);
  if (missing.length) throw new Error(`Configuração ausente: ${missing.join(', ')}`);
}

function requireLocalConfig() {
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Configuração ausente: supabaseUrl, serviceRoleKey');
  }
}

function objectKey(item) {
  return `${item.bucket}/${String(item.path).replace(/^\/+/, '')}`;
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

async function bodySha256(body) {
  const hash = createHash('sha256');
  for await (const chunk of body || []) hash.update(chunk);
  return hash.digest('hex');
}

function errorMessage(error) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    return [error.message, error.code, error.details, error.hint].filter(Boolean).join(' | ') || JSON.stringify(error);
  }
  return String(error);
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function readGzipNdjson(path) {
  const text = gunzipSync(await readFile(path)).toString('utf8').trim();
  return text ? text.split('\n').map(JSON.parse) : [];
}

async function readNdjson(path) {
  const text = (await readFile(path, 'utf8')).trim();
  return text ? text.split('\n').map(JSON.parse) : [];
}

async function runPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function next() {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index]);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => next()));
  return results;
}

async function compressedDigest(path) {
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
    bytes += chunk.length;
  }
  return { bytes, sha256: hash.digest('hex') };
}

async function validateGzipLines(path) {
  const input = createReadStream(path).pipe(createGunzip());
  const decoder = new StringDecoder('utf8');
  let pending = '';
  let count = 0;
  for await (const chunk of input) {
    pending += decoder.write(chunk);
    const lines = pending.split('\n');
    pending = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      JSON.parse(line);
      count += 1;
    }
  }
  pending += decoder.end();
  if (pending.trim()) {
    JSON.parse(pending);
    count += 1;
  }
  return count;
}

async function auditLocalBackup(directory, manifest) {
  const checks = await runPool(manifest.verification || [], GET_CONCURRENCY, async (expected) => {
    const path = join(directory, expected.file);
    try {
      const digest = await compressedDigest(path);
      const lines = await validateGzipLines(path);
      const ok = digest.bytes === expected.bytes
        && digest.sha256 === expected.sha256
        && lines === expected.lines;
      return { file: expected.file, ok, bytes: digest.bytes, lines };
    } catch (error) {
      return { file: expected.file, ok: false, error: errorMessage(error) };
    }
  });
  return {
    files: checks.length,
    valid: checks.filter((item) => item.ok).length,
    failures: checks.filter((item) => !item.ok),
  };
}

function copiedDigests(stateRows) {
  const digests = new Map();
  for (const row of stateRows) {
    if (row.status === 'copied' && row.key && row.sha256) digests.set(row.key, row.sha256);
  }
  return digests;
}

async function headMigratedObject(s3, item, digests) {
  const key = objectKey(item);
  const expectedSha = digests.get(key) || null;
  try {
    const head = await s3.send(new HeadObjectCommand({ Bucket: r2Bucket, Key: key }));
    const ok = Number(head.ContentLength || 0) === Number(item.size || 0)
      && Boolean(expectedSha)
      && head.Metadata?.sha256 === expectedSha;
    return { key, ok, bytes: Number(head.ContentLength || 0), expectedSha };
  } catch (error) {
    return { key, ok: false, expectedSha, error: errorMessage(error) };
  }
}

async function auditMigratedObjects(s3, objects, stateRows) {
  const digests = copiedDigests(stateRows);
  const checks = await runPool(objects, HEAD_CONCURRENCY, (item) => headMigratedObject(s3, item, digests));
  return {
    expected: objects.length,
    authoritative_checksums: digests.size,
    valid: checks.filter((item) => item.ok).length,
    bytes: checks.filter((item) => item.ok).reduce((sum, item) => sum + item.bytes, 0),
    failures: checks.filter((item) => !item.ok),
  };
}

async function auditBackupObject(s3, item) {
  try {
    const response = await s3.send(new GetObjectCommand({ Bucket: r2Bucket, Key: item.key }));
    const digest = await bodySha256(response.Body);
    const ok = Number(response.ContentLength || 0) === Number(item.bytes || 0) && digest === item.sha256;
    return { key: item.key, ok, bytes: Number(response.ContentLength || 0) };
  } catch (error) {
    return { key: item.key, ok: false, error: errorMessage(error) };
  }
}

async function auditDatabaseBackup(s3, report) {
  const checks = await runPool(report.objects || [], GET_CONCURRENCY, (item) => auditBackupObject(s3, item));
  return {
    expected: checks.length,
    valid: checks.filter((item) => item.ok).length,
    bytes: checks.filter((item) => item.ok).reduce((sum, item) => sum + item.bytes, 0),
    failures: checks.filter((item) => !item.ok),
  };
}

async function loadMediaRows(supabase) {
  const rows = [];
  let lastId = 0;
  for (;;) {
    const { data, error } = await supabase.from('wa_messages')
      .select('id,media_url')
      .not('media_url', 'is', null)
      .gt('id', lastId)
      .order('id', { ascending: true })
      .limit(PAGE_SIZE);
    if (error) throw error;
    const page = data || [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
    lastId = Number(page.at(-1).id);
  }
}

function r2KeyFromReference(reference) {
  const match = String(reference || '').match(/^r2:\/\/([^/]+)\/(.+)$/);
  return match ? `${match[1]}/${match[2]}` : null;
}

async function auditRuntimeKey(s3, key) {
  try {
    const head = await s3.send(new HeadObjectCommand({ Bucket: r2Bucket, Key: key }));
    return { key, ok: Number(head.ContentLength || 0) > 0 };
  } catch (error) {
    return { key, ok: false, error: errorMessage(error) };
  }
}

async function auditCurrentMediaReferences(s3, supabase) {
  const rows = await loadMediaRows(supabase);
  const invalid = rows.filter((row) => !r2KeyFromReference(row.media_url));
  const keys = [...new Set(rows.map((row) => r2KeyFromReference(row.media_url)).filter(Boolean))];
  const checks = await runPool(keys, HEAD_CONCURRENCY, (key) => auditRuntimeKey(s3, key));
  return {
    rows: rows.length,
    r2_references: rows.length - invalid.length,
    unique_objects: keys.length,
    valid_objects: checks.filter((item) => item.ok).length,
    invalid_references: invalid.map((row) => ({ id: row.id, scheme: String(row.media_url).split(':')[0] || 'unknown' })),
    missing_objects: checks.filter((item) => !item.ok),
  };
}

async function auditRuntimeRoundTrip(s3) {
  const key = `migration-audits/${Date.now()}-${randomUUID()}.txt`;
  const body = Buffer.from(`crm-trilha-r2-audit:${randomUUID()}`);
  const digest = sha256(body);
  await s3.send(new PutObjectCommand({
    Bucket: r2Bucket,
    Key: key,
    Body: body,
    ContentLength: body.length,
    ContentType: 'text/plain',
    Metadata: { sha256: digest, purpose: 'migration-audit' },
  }));
  const response = await s3.send(new GetObjectCommand({ Bucket: r2Bucket, Key: key }));
  const downloadedSha = await bodySha256(response.Body);
  await s3.send(new DeleteObjectCommand({ Bucket: r2Bucket, Key: key }));
  return { upload: true, read: downloadedSha === digest, delete: true, bytes: body.length };
}

function auditStatus(sections) {
  const failures = [
    ...sections.local_backup.failures,
    ...sections.migrated_objects.failures,
    ...sections.database_backup.failures,
    ...sections.current_media.invalid_references,
    ...sections.current_media.missing_objects,
  ];
  return failures.length === 0 && Object.values(sections.round_trip).every((value) => value !== false)
    ? 'passed'
    : 'failed';
}

async function main() {
  const localOnly = process.argv.includes('--local-only');
  if (localOnly) requireLocalConfig();
  else requireConfig();
  const directoryArg = process.argv.find((argument) => argument.includes('supabase-'));
  if (!directoryArg) throw new Error('Informe o diretório do backup Supabase');
  const directory = resolve(directoryArg);
  const manifest = await readJson(join(directory, 'manifest.json'));
  if (localOnly) {
    const localBackup = await auditLocalBackup(directory, manifest);
    const status = localBackup.failures.length === 0 ? 'passed' : 'failed';
    const report = {
      created_at: new Date().toISOString(),
      backup: basename(directory),
      status,
      local_backup: localBackup,
    };
    const reportPath = join(directory, 'local-backup-audit-report.json');
    await writeFile(reportPath, JSON.stringify(report, null, 2), { mode: 0o600 });
    console.log(JSON.stringify({ reportPath, ...report }, null, 2));
    if (status !== 'passed') process.exitCode = 1;
    return;
  }
  const storageObjects = await readGzipNdjson(join(directory, 'storage-objects.ndjson.gz'));
  const stateRows = await readNdjson(join(directory, 'r2-migration-state.ndjson'));
  const databaseReport = await readJson(join(directory, 'r2-database-backup-report.json'));
  const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
  });
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const sections = {};
  console.log('audit local_backup');
  sections.local_backup = await auditLocalBackup(directory, manifest);
  console.log('audit migrated_objects');
  sections.migrated_objects = await auditMigratedObjects(s3, storageObjects, stateRows);
  console.log('audit database_backup');
  sections.database_backup = await auditDatabaseBackup(s3, databaseReport);
  console.log('audit current_media');
  sections.current_media = await auditCurrentMediaReferences(s3, supabase);
  console.log('audit round_trip');
  sections.round_trip = await auditRuntimeRoundTrip(s3);
  const report = {
    created_at: new Date().toISOString(),
    backup: basename(directory),
    bucket: r2Bucket,
    status: auditStatus(sections),
    sections,
  };
  const reportPath = join(directory, 'r2-audit-report.json');
  await writeFile(reportPath, JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ reportPath, ...report }, null, 2));
  if (report.status !== 'passed') process.exitCode = 1;
}

main().catch((error) => {
  console.error(errorMessage(error));
  process.exitCode = 1;
});

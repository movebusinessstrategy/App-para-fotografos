import { createHash } from 'node:crypto';
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createClient } from '@supabase/supabase-js';

const CONCURRENCY = 6;
const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const accountId = process.env.R2_ACCOUNT_ID || '';
const accessKeyId = process.env.R2_ACCESS_KEY_ID || '';
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY || '';
const r2Bucket = process.env.R2_BUCKET || '';

function requireConfig() {
  const missing = [];
  if (!supabaseUrl) missing.push('VITE_SUPABASE_URL');
  if (!serviceRoleKey) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (!accountId) missing.push('R2_ACCOUNT_ID');
  if (!accessKeyId) missing.push('R2_ACCESS_KEY_ID');
  if (!secretAccessKey) missing.push('R2_SECRET_ACCESS_KEY');
  if (!r2Bucket) missing.push('R2_BUCKET');
  if (missing.length) throw new Error(`Configuração ausente: ${missing.join(', ')}`);
}

function loadObjects(path) {
  return readFile(path)
    .then((data) => gunzipSync(data).toString('utf8').trim())
    .then((text) => text ? text.split('\n').map(JSON.parse) : []);
}

function objectKey(item) {
  return `${item.bucket}/${String(item.path).replace(/^\/+/, '')}`;
}

function contentType(item) {
  return item?.metadata?.mimetype
    || item?.metadata?.contentType
    || item?.metadata?.['content-type']
    || 'application/octet-stream';
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function requestedLimit() {
  const argument = process.argv.find((value) => value.startsWith('--limit='));
  if (!argument) return null;
  const limit = Number(argument.split('=')[1]);
  if (!Number.isInteger(limit) || limit < 1) throw new Error('--limit deve ser um inteiro positivo');
  return limit;
}

async function matchesExisting(s3, item) {
  const expectedSha = item.expectedSha || '';
  try {
    const head = await s3.send(new HeadObjectCommand({ Bucket: r2Bucket, Key: objectKey(item) }));
    return Number(head.ContentLength || 0) === Number(item.size || 0)
      && Boolean(expectedSha)
      && head.Metadata?.sha256 === expectedSha;
  } catch (error) {
    if (error?.$metadata?.httpStatusCode === 404 || error?.name === 'NotFound') return false;
    throw error;
  }
}

async function copyObject(context, item) {
  const itemWithDigest = { ...item, expectedSha: context.copiedDigests.get(objectKey(item)) };
  if (await matchesExisting(context.s3, itemWithDigest)) {
    return { status: 'skipped', bytes: Number(item.size || 0), key: objectKey(item) };
  }

  const { data, error } = await context.supabase.storage.from(item.bucket).download(item.path);
  if (error || !data) throw new Error(error?.message || 'download vazio');
  const buffer = Buffer.from(await data.arrayBuffer());
  const digest = sha256(buffer);
  if (buffer.length !== Number(item.size || 0)) {
    throw new Error(`tamanho divergente: manifesto=${item.size}, download=${buffer.length}`);
  }

  await context.s3.send(new PutObjectCommand({
    Bucket: r2Bucket,
    Key: objectKey(item),
    Body: buffer,
    ContentLength: buffer.length,
    ContentType: contentType(item),
    Metadata: {
      sha256: digest,
      'source-bucket': String(item.bucket),
      'source-size': String(buffer.length),
    },
  }));

  const head = await context.s3.send(new HeadObjectCommand({ Bucket: r2Bucket, Key: objectKey(item) }));
  if (Number(head.ContentLength || 0) !== buffer.length || head.Metadata?.sha256 !== digest) {
    throw new Error('verificação R2 falhou após o upload');
  }
  return { status: 'copied', bytes: buffer.length, key: objectKey(item), sha256: digest };
}

async function loadCopiedDigests(path) {
  try {
    const text = (await readFile(path, 'utf8')).trim();
    const rows = text ? text.split('\n').map(JSON.parse) : [];
    return new Map(rows
      .filter((row) => row.status === 'copied' && row.key && row.sha256)
      .map((row) => [row.key, row.sha256]));
  } catch (error) {
    if (error?.code === 'ENOENT') return new Map();
    throw error;
  }
}

async function appendState(path, result) {
  await appendFile(path, `${JSON.stringify({ at: new Date().toISOString(), ...result })}\n`, { mode: 0o600 });
}

async function runPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function next() {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => next()));
  return results;
}

function summarize(results) {
  return results.reduce((summary, result) => {
    summary[result.status] = (summary[result.status] || 0) + 1;
    summary.bytes += Number(result.bytes || 0);
    return summary;
  }, { bytes: 0, copied: 0, failed: 0, skipped: 0 });
}

async function main() {
  requireConfig();
  const execute = process.argv.includes('--execute');
  const manifestArg = process.argv.find((arg) => arg.endsWith('storage-objects.ndjson.gz'));
  if (!manifestArg) throw new Error('Informe o caminho de storage-objects.ndjson.gz');
  const manifestPath = resolve(manifestArg);
  const outputDir = resolve(manifestPath, '..');
  const statePath = resolve(outputDir, 'r2-migration-state.ndjson');
  const reportPath = resolve(outputDir, 'r2-migration-report.json');
  const allObjects = await loadObjects(manifestPath);
  const limit = requestedLimit();
  const objects = limit ? allObjects.slice(0, limit) : allObjects;
  const copiedDigests = await loadCopiedDigests(statePath);

  console.log(JSON.stringify({ execute, objects: objects.length, totalObjects: allObjects.length, bucket: r2Bucket }, null, 2));
  if (!execute) {
    console.log('Simulação concluída. Use --execute somente após criar o bucket e validar as credenciais.');
    return;
  }

  const context = {
    supabase: createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    }),
    s3: new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      forcePathStyle: true,
      credentials: { accessKeyId, secretAccessKey },
    }),
    copiedDigests,
  };
  let completed = 0;
  const results = await runPool(objects, CONCURRENCY, async (item) => {
    let result;
    try {
      result = await copyObject(context, item);
    } catch (error) {
      result = { status: 'failed', bytes: 0, key: objectKey(item), error: errorMessage(error) };
    }
    await appendState(statePath, result);
    completed += 1;
    if (completed % 100 === 0 || completed === objects.length) {
      console.log(`progresso ${completed}/${objects.length}`);
    }
    return result;
  });

  const summary = summarize(results);
  const report = {
    created_at: new Date().toISOString(),
    source_manifest: manifestPath,
    destination_bucket: r2Bucket,
    objects: objects.length,
    summary,
    failures: results.filter((result) => result.status === 'failed'),
  };
  await writeFile(reportPath, JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ reportPath, ...report }, null, 2));
  if (summary.failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(errorMessage(error));
  process.exitCode = 1;
});

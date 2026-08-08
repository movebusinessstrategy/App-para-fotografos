import { createHash } from 'node:crypto';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, join, relative, resolve, sep } from 'node:path';
import { HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

const CONCURRENCY = 4;
const accountId = process.env.R2_ACCOUNT_ID || '';
const accessKeyId = process.env.R2_ACCESS_KEY_ID || '';
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY || '';
const r2Bucket = process.env.R2_BUCKET || '';
const ROOT_FILES = new Set([
  'auth-users.ndjson.gz',
  'manifest.json',
  'public-openapi.json.gz',
  'r2-migration-report.json',
  'storage-objects.ndjson.gz',
]);

function requireConfig() {
  const missing = [];
  if (!accountId) missing.push('R2_ACCOUNT_ID');
  if (!accessKeyId) missing.push('R2_ACCESS_KEY_ID');
  if (!secretAccessKey) missing.push('R2_SECRET_ACCESS_KEY');
  if (!r2Bucket) missing.push('R2_BUCKET');
  if (missing.length) throw new Error(`Configuração ausente: ${missing.join(', ')}`);
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function normalizedRelativePath(root, path) {
  return relative(root, path).split(sep).join('/');
}

async function listTableFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return entries.filter((entry) => entry.isFile()).map((entry) => join(directory, entry.name));
}

async function backupFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const rootFiles = entries
    .filter((entry) => entry.isFile() && ROOT_FILES.has(entry.name))
    .map((entry) => join(directory, entry.name));
  const tables = entries.find((entry) => entry.isDirectory() && entry.name === 'tables');
  if (!tables) throw new Error('Diretório tables não encontrado no backup');
  return [...rootFiles, ...await listTableFiles(join(directory, tables.name))];
}

function objectKey(directory, file) {
  return `database-backups/${basename(directory)}/${normalizedRelativePath(directory, file)}`;
}

async function matchesExisting(s3, key, size, digest) {
  try {
    const head = await s3.send(new HeadObjectCommand({ Bucket: r2Bucket, Key: key }));
    return Number(head.ContentLength || 0) === size && head.Metadata?.sha256 === digest;
  } catch (error) {
    if (error?.$metadata?.httpStatusCode === 404 || error?.name === 'NotFound') return false;
    throw error;
  }
}

async function uploadFile(s3, directory, file) {
  const buffer = await readFile(file);
  const digest = sha256(buffer);
  const key = objectKey(directory, file);
  if (await matchesExisting(s3, key, buffer.length, digest)) {
    return { status: 'skipped', key, bytes: buffer.length, sha256: digest };
  }
  await s3.send(new PutObjectCommand({
    Bucket: r2Bucket,
    Key: key,
    Body: buffer,
    ContentLength: buffer.length,
    ContentType: file.endsWith('.json') ? 'application/json' : 'application/gzip',
    Metadata: { sha256: digest, 'backup-created-at': basename(directory) },
  }));
  if (!await matchesExisting(s3, key, buffer.length, digest)) throw new Error(`verificação falhou: ${key}`);
  return { status: 'copied', key, bytes: buffer.length, sha256: digest };
}

async function runPool(items, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function next() {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index]);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => next()));
  return results;
}

function summarize(results) {
  return results.reduce((summary, result) => {
    summary[result.status] += 1;
    summary.bytes += result.bytes;
    return summary;
  }, { bytes: 0, copied: 0, skipped: 0 });
}

async function main() {
  requireConfig();
  const execute = process.argv.includes('--execute');
  const directoryArg = process.argv.find((argument) => argument.includes('supabase-'));
  if (!directoryArg) throw new Error('Informe o diretório do backup Supabase');
  const directory = resolve(directoryArg);
  const directoryStats = await stat(directory);
  if (!directoryStats.isDirectory()) throw new Error('O caminho informado não é um diretório');
  const files = await backupFiles(directory);
  console.log(JSON.stringify({ execute, files: files.length, backup: basename(directory), bucket: r2Bucket }, null, 2));
  if (!execute) return;

  const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
  });
  const results = await runPool(files, (file) => uploadFile(s3, directory, file));
  const report = {
    created_at: new Date().toISOString(),
    destination_bucket: r2Bucket,
    destination_prefix: `database-backups/${basename(directory)}/`,
    files: files.length,
    summary: summarize(results),
    objects: results,
  };
  const reportPath = join(directory, 'r2-database-backup-report.json');
  await writeFile(reportPath, JSON.stringify(report, null, 2), { mode: 0o600 });
  const reportResult = await uploadFile(s3, directory, reportPath);
  console.log(JSON.stringify({ reportPath, reportObject: reportResult, ...report.summary }, null, 2));
}

main().catch((error) => {
  console.error(errorMessage(error));
  process.exitCode = 1;
});

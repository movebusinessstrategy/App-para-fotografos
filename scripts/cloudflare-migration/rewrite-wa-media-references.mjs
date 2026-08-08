import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createClient } from '@supabase/supabase-js';

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

function storageReference(path) {
  return `r2://wa-media/${path.replace(/^\/+/, '')}`;
}

function safeDecode(value) {
  try { return decodeURIComponent(value); } catch { return value; }
}

function publicWaMediaPath(reference) {
  if (!/^https?:\/\//.test(reference)) return null;
  const pathname = new URL(reference).pathname;
  const markers = ['/storage/v1/object/public/wa-media/', '/storage/v1/object/sign/wa-media/'];
  const marker = markers.find((candidate) => pathname.includes(candidate));
  if (!marker) return null;
  return safeDecode(pathname.slice(pathname.indexOf(marker) + marker.length));
}

function parseDataUrl(reference) {
  const match = reference.match(/^data:([^;]+);base64,(.+)$/s);
  if (!match) return null;
  return { buffer: Buffer.from(match[2], 'base64'), mimetype: match[1] };
}

function extensionForMime(mimetype) {
  return String(mimetype || 'application/octet-stream').split('/')[1]?.split(/[;+]/)[0] || 'bin';
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

async function ensureR2Object(s3, path) {
  const head = await s3.send(new HeadObjectCommand({ Bucket: r2Bucket, Key: `wa-media/${path}` }));
  if (Number(head.ContentLength || 0) <= 0) throw new Error('objeto vazio no R2');
}

async function moveDataUrl(s3, row, parsed) {
  const digest = sha256(parsed.buffer);
  const path = `${row.user_id}/legacy/${row.id}-${digest.slice(0, 16)}.${extensionForMime(parsed.mimetype)}`;
  await s3.send(new PutObjectCommand({
    Bucket: r2Bucket,
    Key: `wa-media/${path}`,
    Body: parsed.buffer,
    ContentLength: parsed.buffer.length,
    ContentType: parsed.mimetype,
    Metadata: { sha256: digest, 'source-row': String(row.id) },
  }));
  await ensureR2Object(s3, path);
  return path;
}

async function prepareUpdate(s3, row) {
  const reference = String(row.media_url || '');
  if (!reference || reference.startsWith('r2://')) return { status: 'already_r2', row };
  const publicPath = publicWaMediaPath(reference);
  if (publicPath) {
    await ensureR2Object(s3, publicPath);
    return { status: 'ready', row, media_url: storageReference(publicPath) };
  }
  const dataUrl = parseDataUrl(reference);
  if (!dataUrl) return { status: 'untouched', row };
  const path = await moveDataUrl(s3, row, dataUrl);
  return { status: 'ready', row, media_url: storageReference(path) };
}

async function loadRows(supabase) {
  const rows = [];
  let lastId = 0;
  for (;;) {
    const { data, error } = await supabase.from('wa_messages')
      .select('id,user_id,phone,wa_number,media_url')
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

async function runPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function next() {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      try {
        results[index] = await worker(items[index]);
      } catch (error) {
        results[index] = { status: 'failed', row: items[index], error: error?.message || String(error) };
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => next()));
  return results;
}

async function applyUpdates(supabase, updates) {
  for (let index = 0; index < updates.length; index += 100) {
    const rows = updates.slice(index, index + 100).map((item) => ({
      id: item.row.id,
      user_id: item.row.user_id,
      phone: item.row.phone,
      wa_number: item.row.wa_number,
      media_url: item.media_url,
    }));
    const { error } = await supabase.from('wa_messages').upsert(rows, { onConflict: 'id' });
    if (error) throw error;
  }
}

function summarize(results) {
  return results.reduce((summary, result) => {
    summary[result.status] = (summary[result.status] || 0) + 1;
    return summary;
  }, {});
}

async function main() {
  requireConfig();
  const execute = process.argv.includes('--execute');
  const reportArg = process.argv.find((arg) => arg.startsWith('--report='));
  const reportPath = resolve(reportArg?.slice('--report='.length) || 'private-backups/wa-media-reference-report.json');
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
  });
  const rows = await loadRows(supabase);
  const results = await runPool(rows, 10, (row) => prepareUpdate(s3, row));
  const ready = results.filter((result) => result.status === 'ready');
  if (execute) await applyUpdates(supabase, ready);

  const report = {
    created_at: new Date().toISOString(),
    execute,
    scanned: rows.length,
    updates: ready.length,
    summary: summarize(results),
    failures: results.filter((result) => result.status === 'failed')
      .map((result) => ({ id: result.row.id, error: result.error })),
  };
  await writeFile(reportPath, JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ reportPath, ...report }, null, 2));
  if (report.failures.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

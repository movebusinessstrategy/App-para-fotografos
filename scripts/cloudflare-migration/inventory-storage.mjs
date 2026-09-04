// Inventário de arquivos, sem exportar tabelas do CRM nem alterar a origem.
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { setTimeout as delay } from 'node:timers/promises';
import { createClient } from '@supabase/supabase-js';

const TARGETS = ['job-covers', 'galeria-originais', 'galeria-previews', 'album-assets', 'agente-materiais', 'agente-audios', 'videos'];
const PAGE_SIZE = 100;
let requests = 0;
const client = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
  global: { fetch: async (url, options) => {
    if (++requests > 500) throw new Error('Limite de consultas do inventário atingido');
    await delay(200);
    return fetch(url, { ...options, signal: AbortSignal.timeout(15000) });
  } },
});

async function listPrefix(bucket, prefix, objects, depth = 0) {
  if (depth > 12) throw new Error('Profundidade inesperada no armazenamento');
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await client.storage.from(bucket).list(prefix, {
      limit: PAGE_SIZE, offset, sortBy: { column: 'name', order: 'asc' },
    });
    if (error) throw error;
    for (const item of data || []) {
      const path = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.id == null && item.metadata == null) {
        await listPrefix(bucket, path, objects, depth + 1);
      } else {
        objects.push({ ...item, bucket, path, size: Number(item.metadata?.size || 0) });
      }
    }
    if ((data || []).length < PAGE_SIZE) return;
  }
}

async function main() {
  if (!process.argv[2]) throw new Error('Informe uma pasta privada para o inventário');
  const directory = resolve(process.argv[2]);
  const { data, error } = await client.storage.listBuckets();
  if (error) throw error;
  const available = new Set((data || []).map((bucket) => bucket.name));
  const objects = [];
  const summary = [];
  for (const bucket of TARGETS.filter((name) => available.has(name))) {
    const first = objects.length;
    await listPrefix(bucket, '', objects);
    const rows = objects.slice(first);
    const result = { bucket, objects: rows.length, bytes: rows.reduce((sum, row) => sum + row.size, 0) };
    summary.push(result);
    console.log(JSON.stringify(result));
  }
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const manifest = objects.map((row) => JSON.stringify(row)).join('\n') + '\n';
  await writeFile(resolve(directory, 'storage-objects.ndjson.gz'), gzipSync(manifest), { mode: 0o600 });
  await writeFile(resolve(directory, 'inventory.json'), JSON.stringify({
    completedAt: new Date().toISOString(), complete: true, requests, summary,
    absentBuckets: TARGETS.filter((name) => !available.has(name)),
  }, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ complete: true, requests, objects: objects.length }));
}

main().catch((error) => {
  // Não imprime URLs assinadas, chaves de objetos ou respostas com dados privados.
  console.error(JSON.stringify({ complete: false, requests, error: error.name || 'StorageError', status: error.statusCode || null }));
  process.exitCode = 1;
});

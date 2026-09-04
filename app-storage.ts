import type { Express } from 'express';
import { supabaseAdmin } from './supabase.js';
import {
  createSignedUploadUrl, downloadObject, getServeUrl, isR2Bucket,
  removeObjects, uploadObject,
} from './object-storage.js';

// Somente os buckets que já são públicos no aplicativo. Originais, WhatsApp
// e materiais privados continuam autorizados pelas respectivas rotas.
const PUBLIC_BUCKETS = new Set(['job-covers', 'galeria-previews', 'album-assets']);
const readyBuckets = new Set<string>();

export function isPublicStorageObject(bucket: string, path: string): boolean {
  if (!PUBLIC_BUCKETS.has(bucket) || !path || /[\\\x00-\x1f]/.test(path)) return false;
  return path.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
}

function publicStorageUrl(bucket: string, path: string): string {
  if (!isPublicStorageObject(bucket, path)) throw new Error('Arquivo não público');
  const base = (process.env.APP_PUBLIC_URL || 'https://crmtrilha.com.br').replace(/\/$/, '');
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  return `${base}/api/public/storage/${bucket}/${encodedPath}`;
}

/** Capas antigas usam o R2 após o corte sem reescrever registros do banco. */
export function resolvePublicStorageUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const source = new URL(process.env.VITE_SUPABASE_URL || '');
    if (url.origin !== source.origin) return value;
    const match = url.pathname.match(/^\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/);
    if (!match || !isR2Bucket(match[1])) return value;
    const path = decodeURIComponent(match[2]);
    return isPublicStorageObject(match[1], path) ? publicStorageUrl(match[1], path) : value;
  } catch { return value; }
}

function adminStorage() {
  if (!supabaseAdmin) throw new Error('Storage indisponível');
  return supabaseAdmin.storage;
}

async function storageResult<T>(operation: () => Promise<T>) {
  try { return { data: await operation(), error: null }; }
  catch (error) {
    return { data: null, error: { message: error instanceof Error ? error.message : 'Falha no armazenamento' } };
  }
}

/** Preserva o contrato de dados/erros das rotas na migração de cada bucket. */
export function appStorageBucket(bucket: string) {
  if (!isR2Bucket(bucket)) return adminStorage().from(bucket);
  return {
    upload(path: string, body: Buffer, options: { contentType?: string; upsert?: boolean } = {}) {
      return storageResult(async () => {
        await uploadObject(bucket, path, body, options);
        return { path };
      });
    },
    download(path: string) {
      return storageResult(async () => new Blob([new Uint8Array(await downloadObject(bucket, path))]));
    },
    remove(paths: string[]) {
      return storageResult(async () => { await removeObjects(bucket, paths); return []; });
    },
    createSignedUrl(path: string, expiresIn: number) {
      return storageResult(async () => {
        const signedUrl = await getServeUrl(bucket, path, { expiresIn });
        if (!signedUrl) throw new Error('Falha ao assinar arquivo');
        return { signedUrl };
      });
    },
    createSignedUploadUrl(path: string) {
      return storageResult(async () => ({ signedUrl: await createSignedUploadUrl(bucket, path) }));
    },
    getPublicUrl(path: string) {
      return { data: { publicUrl: publicStorageUrl(bucket, path) } };
    },
  };
}

export async function ensureAppStorageBucket(
  bucket: string,
  options: { public: boolean; fileSizeLimit?: number },
): Promise<void> {
  if (isR2Bucket(bucket) || readyBuckets.has(bucket)) return;
  const storage = adminStorage();
  const { data, error } = await storage.listBuckets();
  if (error) throw error;
  if (!data?.some((item) => item.name === bucket)) {
    const created = await storage.createBucket(bucket, options);
    if (created.error) throw created.error;
  }
  readyBuckets.add(bucket);
}

export function registerPublicStorageRoutes(app: Express): void {
  app.get('/api/public/storage/:bucket/*', async (req, res) => {
    const { bucket } = req.params;
    const path = req.params[0];
    if (!isPublicStorageObject(bucket, path) || !isR2Bucket(bucket)) {
      res.status(404).end();
      return;
    }
    try {
      // Apenas assina; arquivo vai do R2 ao navegador, sem leitura do banco.
      const url = await getServeUrl(bucket, path, { expiresIn: 3600 });
      if (!url) { res.status(404).end(); return; }
      res.setHeader('Cache-Control', 'public, max-age=300');
      res.redirect(302, url);
    } catch {
      res.status(503).json({ error: 'Arquivo temporariamente indisponível.' });
    }
  });
}

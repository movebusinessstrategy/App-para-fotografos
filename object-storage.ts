// object-storage.ts
// Camada única de armazenamento de OBJETOS (fotos da galeria/álbum).
//
// Por quê: as fotos são o que pesa e o que gera EGRESS (cliente abrindo a
// galeria). No Cloudflare R2 o egress é grátis — mover as fotos pra lá evita
// o próximo upgrade do Supabase conforme o volume cresce.
//
// Como: um "logical bucket" (galeria-originais, galeria-previews, album-assets)
// é roteado pro R2 OU pro Supabase Storage, por env, SEM o resto do código
// precisar saber onde o objeto vive.
//
// SEGURANÇA/COMPATIBILIDADE:
// - Enquanto NÃO houver credenciais do R2 (env vazio), TUDO cai no Supabase —
//   comportamento idêntico ao de hoje. É seguro fazer deploy assim (dormente).
// - Um bucket só vira "R2" quando estiver em R2_BUCKETS. A migração é faseada:
//   (1) módulo dormente; (2) copiar as fotos antigas Supabase→R2; (3) só então
//   pôr o bucket em R2_BUCKETS → upload e serving passam pro R2 de uma vez
//   (sem período "meio no Supabase, meio no R2" pro mesmo bucket).
//
// Env (todas OPCIONAIS — ausência = fica no Supabase):
//   R2_ACCOUNT_ID          id da conta Cloudflare
//   R2_ACCESS_KEY_ID       chave do token S3 (R2)
//   R2_SECRET_ACCESS_KEY   segredo do token S3 (R2) — NUNCA no chat/git
//   R2_BUCKET              nome do bucket físico no R2 (ex.: fotos-crm)
//   R2_PUBLIC_BASE_URL     (opc.) domínio público/r2.dev pra servir preview sem assinar
//   R2_BUCKETS             lista (vírgula) de logical buckets no R2 (ex.:
//                          "galeria-originais,galeria-previews,album-assets")

import { createHash } from 'node:crypto';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { supabaseAdmin } from './supabase';

// ── Config R2 (só liga se TODAS as chaves essenciais estiverem presentes) ──
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID || '';
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || '';
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || '';
const R2_BUCKET = process.env.R2_BUCKET || '';
const R2_PUBLIC_BASE_URL = (process.env.R2_PUBLIC_BASE_URL || '').replace(/\/$/, '');
const R2_BUCKETS = new Set(
  (process.env.R2_BUCKETS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
);

const r2Configured = !!(R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET);

let _s3: S3Client | null = null;
function s3(): S3Client {
  if (!_s3) {
    _s3 = new S3Client({
      region: 'auto',
      endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      forcePathStyle: true,
      credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
    });
  }
  return _s3;
}

/** Este logical bucket está roteado pro R2? (senão → Supabase Storage) */
export function isR2Bucket(bucket: string): boolean {
  return r2Configured && R2_BUCKETS.has(bucket);
}

/** Referência permanente gravada no banco; a URL assinada é gerada só na leitura. */
export function objectStorageReference(bucket: string, path: string): string {
  return `r2://${bucket}/${path.replace(/^\/+/, '')}`;
}

export function parseObjectStorageReference(reference: string): { bucket: string; path: string } | null {
  const match = String(reference || '').match(/^r2:\/\/([^/]+)\/(.+)$/);
  if (!match) return null;
  return { bucket: match[1], path: match[2] };
}

/** Diagnóstico legível — usado por rota de health/admin. */
export function storageStatus() {
  return {
    r2_configured: r2Configured,
    r2_buckets: [...R2_BUCKETS],
    r2_public_base_url: R2_PUBLIC_BASE_URL || null,
  };
}

// No R2 usamos 1 bucket físico e o logical bucket vira prefixo da key.
// Assim o usuário cria UM bucket só e a estrutura (galeria-originais/…,
// album-assets/…) fica preservada dentro dele.
function r2Key(bucket: string, path: string): string {
  return `${bucket}/${path.replace(/^\/+/, '')}`;
}

function sb() {
  if (!supabaseAdmin) throw new Error('Storage indisponível (service role ausente)');
  return supabaseAdmin;
}

async function streamToBuffer(body: any): Promise<Buffer> {
  // AWS SDK v3 no Node devolve um stream. transformToByteArray existe no runtime.
  if (body?.transformToByteArray) return Buffer.from(await body.transformToByteArray());
  const chunks: Buffer[] = [];
  for await (const chunk of body) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

// ── API pública (mesma forma pros dois backends) ──────────────────────────

/** Sobe um objeto (server-side). upsert=true sobrescreve. */
export async function uploadObject(
  bucket: string,
  path: string,
  body: Buffer,
  opts: { contentType?: string; upsert?: boolean } = {},
): Promise<void> {
  if (isR2Bucket(bucket)) {
    const digest = createHash('sha256').update(body).digest('hex');
    await s3().send(new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: r2Key(bucket, path),
      Body: body,
      ContentLength: body.length,
      ContentType: opts.contentType,
      Metadata: { sha256: digest, 'logical-bucket': bucket },
    }));
    return;
  }
  const { error } = await sb().storage.from(bucket).upload(path, body, {
    contentType: opts.contentType,
    upsert: opts.upsert ?? false,
  });
  if (error) throw new Error(error.message);
}

/** URL assinada de UPLOAD pro navegador subir direto (originais da galeria). */
export async function createSignedUploadUrl(
  bucket: string,
  path: string,
  opts: { expiresIn?: number; contentType?: string } = {},
): Promise<string> {
  if (isR2Bucket(bucket)) {
    return getSignedUrl(
      s3(),
      new PutObjectCommand({ Bucket: R2_BUCKET, Key: r2Key(bucket, path), ContentType: opts.contentType }),
      { expiresIn: opts.expiresIn ?? 3600 },
    );
  }
  const { data, error } = await sb().storage.from(bucket).createSignedUploadUrl(path);
  if (error || !data) throw new Error(error?.message || 'Falha ao assinar upload');
  return data.signedUrl;
}

/** Baixa o objeto pro servidor (ex.: original pra aplicar marca d'água). */
export async function downloadObject(bucket: string, path: string): Promise<Buffer> {
  if (isR2Bucket(bucket)) {
    const out = await s3().send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: r2Key(bucket, path) }));
    return streamToBuffer(out.Body);
  }
  const { data, error } = await sb().storage.from(bucket).download(path);
  if (error || !data) throw new Error(`download falhou: ${error?.message || 'arquivo vazio'}`);
  return Buffer.from(await data.arrayBuffer());
}

/**
 * URL pro NAVEGADOR carregar o objeto.
 * - `publicUrl` (previews): Supabase → URL pública permanente; R2 → domínio
 *   público (R2_PUBLIC_BASE_URL) se houver, senão cai pra URL assinada.
 * - assinada (privado): sempre expira (default 1h).
 */
export async function getServeUrl(
  bucket: string,
  path: string,
  opts: { publicUrl?: boolean; expiresIn?: number } = {},
): Promise<string | null> {
  if (!path) return null;
  if (isR2Bucket(bucket)) {
    const key = r2Key(bucket, path);
    if (opts.publicUrl && R2_PUBLIC_BASE_URL) return `${R2_PUBLIC_BASE_URL}/${key}`;
    return getSignedUrl(
      s3(),
      new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }),
      { expiresIn: opts.expiresIn ?? 3600 },
    );
  }
  if (opts.publicUrl) {
    return sb().storage.from(bucket).getPublicUrl(path).data.publicUrl || null;
  }
  const { data, error } = await sb().storage.from(bucket).createSignedUrl(path, opts.expiresIn ?? 3600);
  if (error || !data) return null;
  return data.signedUrl;
}

/** Resolve uma referência permanente do banco para uma URL utilizável pelo navegador. */
export async function resolveObjectUrl(reference: string | null | undefined, expiresIn = 3600): Promise<string | null> {
  if (!reference) return null;
  const parsed = parseObjectStorageReference(reference);
  if (!parsed) return reference;
  return getServeUrl(parsed.bucket, parsed.path, { expiresIn });
}

/** Baixa data URL, URL HTTP ou referência r2:// sem espalhar regra de provider. */
export async function downloadStoredObject(reference: string | null | undefined): Promise<Buffer | null> {
  if (!reference) return null;
  const parsed = parseObjectStorageReference(reference);
  if (parsed) return downloadObject(parsed.bucket, parsed.path);
  if (reference.startsWith('data:')) {
    const base64 = reference.split(',')[1] || '';
    return base64 ? Buffer.from(base64, 'base64') : null;
  }
  if (!/^https?:\/\//.test(reference)) return null;
  const response = await fetch(reference);
  if (!response.ok) return null;
  return Buffer.from(await response.arrayBuffer());
}

/** Remove objetos (lida com lotes; o caller pode passar a lista inteira). */
export async function removeObjects(bucket: string, paths: string[]): Promise<void> {
  const list = (paths || []).filter(Boolean);
  if (!list.length) return;
  if (isR2Bucket(bucket)) {
    // DeleteObjects aceita até 1000 por request.
    for (let i = 0; i < list.length; i += 1000) {
      const chunk = list.slice(i, i + 1000);
      await s3().send(new DeleteObjectsCommand({
        Bucket: R2_BUCKET,
        Delete: { Objects: chunk.map((p) => ({ Key: r2Key(bucket, p) })) },
      }));
    }
    return;
  }
  for (let i = 0; i < list.length; i += 100) {
    await sb().storage.from(bucket).remove(list.slice(i, i + 100));
  }
}

/**
 * Soma bytes sob um prefixo (uso de storage por tenant).
 * - R2: ListObjectsV2 é recursivo/flat → soma direto (com paginação).
 * - Supabase: list é por nível → recursivo por pasta (igual ao original).
 */
export async function sumPrefixBytes(bucket: string, prefix: string): Promise<number> {
  if (isR2Bucket(bucket)) {
    let total = 0;
    let token: string | undefined;
    do {
      const out = await s3().send(new ListObjectsV2Command({
        Bucket: R2_BUCKET,
        Prefix: r2Key(bucket, prefix ? `${prefix}/` : ''),
        ContinuationToken: token,
      }));
      for (const o of out.Contents || []) total += Number(o.Size || 0);
      token = out.IsTruncated ? out.NextContinuationToken : undefined;
    } while (token);
    return total;
  }
  return sumSupabasePrefix(bucket, prefix, 0);
}

async function sumSupabasePrefix(bucket: string, prefix: string, depth: number): Promise<number> {
  if (depth > 6) return 0;
  let total = 0;
  try {
    let offset = 0;
    for (;;) {
      const { data } = await sb().storage.from(bucket).list(prefix, { limit: 1000, offset });
      const items = data || [];
      for (const item of items) {
        const isFolder = (item as any).id == null && (item as any).metadata == null;
        if (isFolder) {
          total += await sumSupabasePrefix(bucket, prefix ? `${prefix}/${item.name}` : item.name, depth + 1);
        } else {
          total += Number((item as any).metadata?.size || 0);
        }
      }
      if (items.length < 1000) break;
      offset += 1000;
      if (offset > 200000) break;
    }
  } catch { /* fail-open */ }
  return total;
}

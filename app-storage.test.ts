import assert from 'node:assert/strict';
import test, { mock } from 'node:test';

const migrated = new Set(['job-covers', 'galeria-previews', 'galeria-originais', 'album-assets', 'agente-materiais', 'agente-audios']);
const objects = new Map<string, Buffer>();
let unavailable = false;
let databaseCalls = 0;
let signs = 0;
const legacyBucket = { provider: 'supabase' };
mock.module('./supabase.ts', { namedExports: { supabaseAdmin: { storage: {
  from: () => { databaseCalls++; return legacyBucket; },
  listBuckets: async () => { databaseCalls++; return { data: [{ name: 'legacy' }], error: null }; },
  createBucket: async () => { throw new Error('unexpected bucket creation'); },
} } } });
mock.module('./object-storage.ts', { namedExports: {
  isR2Bucket: (bucket: string) => migrated.has(bucket),
  uploadObject: async (bucket: string, path: string, body: Buffer) => {
    if (unavailable) throw new Error('R2 unavailable');
    objects.set(`${bucket}/${path}`, body);
  },
  downloadObject: async (bucket: string, path: string) => {
    const body = objects.get(`${bucket}/${path}`);
    if (!body) throw new Error('Object not found');
    return body;
  },
  removeObjects: async (bucket: string, paths: string[]) => {
    for (const path of paths) objects.delete(`${bucket}/${path}`);
  },
  createSignedUploadUrl: async (bucket: string, path: string) => `https://objects.test/upload/${bucket}/${path}`,
  getServeUrl: async (bucket: string, path: string) => {
    if (unavailable) throw new Error('R2 unavailable');
    signs++;
    return `https://objects.test/read/${bucket}/${path}?expires=3600`;
  },
} });
const { appStorageBucket, ensureAppStorageBucket, isPublicStorageObject, registerPublicStorageRoutes, resolvePublicStorageUrl } = await import('./app-storage.ts');

test('arquivos migrados fazem upload, leitura, assinatura e exclusão sem acessar Supabase', async () => {
  const initialCalls = databaseCalls;
  for (const bucket of migrated) {
    await ensureAppStorageBucket(bucket, { public: false });
    const storage = appStorageBucket(bucket);
    const path = 'tenant/arquivo.jpg';
    assert.equal((await storage.upload(path, Buffer.from('image'), { upsert: true })).error, null);
    const downloaded = await storage.download(path);
    assert.equal(Buffer.from(await downloaded.data!.arrayBuffer()).toString(), 'image');
    assert.match((await storage.createSignedUrl(path, 3600)).data!.signedUrl, /objects.test\/read/);
    assert.match((await storage.createSignedUploadUrl(path)).data!.signedUrl, /objects.test\/upload/);
    assert.equal((await storage.remove([path])).error, null);
    assert.ok((await storage.download(path)).error);
  }
  assert.equal(databaseCalls, initialCalls);
});

test('bucket não migrado preserva o cliente original e a preparação fica em cache', async () => {
  assert.equal(appStorageBucket('legacy'), legacyBucket);
  const before = databaseCalls;
  await ensureAppStorageBucket('legacy', { public: true });
  await ensureAppStorageBucket('legacy', { public: true });
  assert.equal(databaseCalls, before + 1);
});

test('falha de upload não cai no Supabase nem retorna sucesso', async () => {
  const before = databaseCalls;
  unavailable = true;
  try {
    const result = await appStorageBucket('album-assets').upload('tenant/photo', Buffer.from('image'));
    assert.equal(result.data, null);
    assert.equal(result.error?.message, 'R2 unavailable');
    assert.equal(databaseCalls, before);
  } finally { unavailable = false; }
});

test('links permanentes bloqueiam buckets privados e caminhos que escapam do prefixo', () => {
  const url = appStorageBucket('galeria-previews').getPublicUrl('tenant/foto com espaço.jpg').data.publicUrl;
  assert.ok(url.endsWith('/api/public/storage/galeria-previews/tenant/foto%20com%20espa%C3%A7o.jpg'));
  assert.ok(!url.includes('expires='));
  for (const bucket of ['wa-media', 'galeria-originais', 'agente-materiais', 'agente-audios', 'database-backups']) {
    assert.equal(isPublicStorageObject(bucket, 'tenant/file'), false);
  }
  for (const path of ['../file', 'tenant/../file', 'tenant/./file', '/file', 'tenant//file', 'tenant\\file', 'file\u0000']) {
    assert.equal(isPublicStorageObject('album-assets', path), false);
  }
  assert.throws(() => appStorageBucket('galeria-originais').getPublicUrl('tenant/original'));
});

test('capas antigas mudam só quando o bucket do projeto foi migrado', () => {
  const previous = process.env.VITE_SUPABASE_URL;
  process.env.VITE_SUPABASE_URL = 'https://project.test';
  try {
    const url = 'https://project.test/storage/v1/object/public/job-covers/tenant/foto%20capa.jpg';
    assert.ok(resolvePublicStorageUrl(url)!.endsWith('/api/public/storage/job-covers/tenant/foto%20capa.jpg'));
    const external = url.replace('project.test', 'external.test');
    assert.equal(resolvePublicStorageUrl(external), external);
    const legacy = url.replace('job-covers', 'legacy');
    assert.equal(resolvePublicStorageUrl(legacy), legacy);
    const privateUrl = url.replace('job-covers', 'galeria-originais');
    assert.equal(resolvePublicStorageUrl(privateUrl), privateUrl);
    assert.equal(resolvePublicStorageUrl(null), null);
  } finally {
    if (previous === undefined) delete process.env.VITE_SUPABASE_URL;
    else process.env.VITE_SUPABASE_URL = previous;
  }
});

test('redirecionamento não consulta banco e recusa pedidos privados', async () => {
  let handler: any;
  registerPublicStorageRoutes({ get: (_route: string, callback: any) => { handler = callback; } } as any);
  const response = () => ({
    statusCode: 200, location: '', headers: {} as Record<string, string>,
    status(code: number) { this.statusCode = code; return this; },
    end() {}, json() {},
    setHeader(name: string, value: string) { this.headers[name] = value; },
    redirect(code: number, url: string) { this.statusCode = code; this.location = url; },
  });
  const before = databaseCalls;
  const publicResponse = response();
  await handler({ params: { bucket: 'galeria-previews', 0: 'tenant/foto.jpg' } }, publicResponse);
  assert.equal(publicResponse.statusCode, 302);
  assert.match(publicResponse.location, /objects.test\/read\/galeria-previews/);
  assert.equal(publicResponse.headers['Cache-Control'], 'public, max-age=300');
  const beforeDenied = signs;
  const denied = response();
  await handler({ params: { bucket: 'galeria-originais', 0: 'tenant/original' } }, denied);
  assert.equal(denied.statusCode, 404);
  assert.equal(signs, beforeDenied);
  unavailable = true;
  try {
    const failure = response();
    await handler({ params: { bucket: 'album-assets', 0: 'tenant/file' } }, failure);
    assert.equal(failure.statusCode, 503);
  } finally { unavailable = false; }
  assert.equal(databaseCalls, before);
});

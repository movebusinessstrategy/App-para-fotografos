// Sessão da cliente / convidados na galeria de proofing.
//
// Token opaco assinado com HMAC-SHA256 (não é JWT — formato proprietário
// menor): "gs:v1:<payload_b64url>:<sig_b64url>", onde payload é JSON
// { gid, aid, role, exp } (gallery_id, access_user_id, role, expira em
// epoch ms). Chave: GALLERY_SESSION_KEY (hex 64) ou WA_TOKEN_ENCRYPTION_KEY
// como fallback. Sem nada configurado: usa uma chave estática — funciona
// localmente, mas em produção SEMPRE setar a env.

import crypto from 'crypto';

const PREFIX = 'gs:v1:';
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias

export interface GallerySessionPayload {
  gid: string;
  aid: string;
  role: 'owner' | 'guest';
  exp: number;
}

let warnedFallback = false;

function getKey(): Buffer | null {
  const hex = process.env.GALLERY_SESSION_KEY || process.env.WA_TOKEN_ENCRYPTION_KEY;
  if (hex && hex.length === 64) {
    try { return Buffer.from(hex, 'hex'); } catch { /* cai pro fallback */ }
  }
  // SEM chave válida: em produção, FALHA FECHADA — não derivamos uma chave
  // de valor público (APP_PUBLIC_URL é descobrível e permitiria FORJAR
  // session tokens). Nesse caso retornamos null → todo token é rejeitado e
  // nenhum é emitido. Em dev, usamos um fallback estático só pra não travar.
  if (process.env.NODE_ENV === 'production') {
    if (!warnedFallback) {
      warnedFallback = true;
      console.error('[gallery-session] CRÍTICO: GALLERY_SESSION_KEY/WA_TOKEN_ENCRYPTION_KEY ausente em produção — sessões da galeria DESABILITADAS (login não funciona até configurar uma chave de 64 hex).');
    }
    return null;
  }
  if (!warnedFallback) {
    warnedFallback = true;
    console.warn('[gallery-session] aviso (dev): sem chave de sessão configurada — usando fallback inseguro. NÃO use isso em produção.');
  }
  return crypto.createHash('sha256').update('gallery-fallback-' + (process.env.APP_PUBLIC_URL || '')).digest();
}

function b64urlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? 0 : 4 - (s.length % 4);
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(pad), 'base64');
}

// Indica se há uma chave válida pra assinar sessões (pro boot avisar).
export function isGallerySessionConfigured(): boolean {
  return getKey() !== null;
}

export function signGallerySession(
  data: { gid: string; aid: string; role: 'owner' | 'guest' },
): string | null {
  const key = getKey();
  if (!key) return null; // sem chave segura → não emite sessão (prod)
  const payload: GallerySessionPayload = { ...data, exp: Date.now() + TTL_MS };
  const payloadBuf = Buffer.from(JSON.stringify(payload), 'utf8');
  const payloadStr = b64urlEncode(payloadBuf);
  const sig = crypto.createHmac('sha256', key).update(payloadStr).digest();
  return PREFIX + payloadStr + ':' + b64urlEncode(sig);
}

export function verifyGallerySession(token: string | null | undefined): GallerySessionPayload | null {
  if (!token || !token.startsWith(PREFIX)) return null;
  const key = getKey();
  if (!key) return null; // sem chave segura → rejeita todo token (prod)
  const rest = token.slice(PREFIX.length);
  const [payloadStr, sigStr] = rest.split(':');
  if (!payloadStr || !sigStr) return null;

  const expected = crypto.createHmac('sha256', key).update(payloadStr).digest();
  const provided = b64urlDecode(sigStr);
  if (expected.length !== provided.length || !crypto.timingSafeEqual(expected, provided)) return null;

  try {
    const payload = JSON.parse(b64urlDecode(payloadStr).toString('utf8')) as GallerySessionPayload;
    if (!payload.gid || !payload.aid || !payload.exp || payload.exp < Date.now()) return null;
    if (payload.role !== 'owner' && payload.role !== 'guest') return null;
    return payload;
  } catch {
    return null;
  }
}

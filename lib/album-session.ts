// Sessão do cliente / convidados no álbum (diagramação).
//
// Mesmo desenho da galeria (lib/gallery-session.ts), mas independente: token
// opaco assinado com HMAC-SHA256 no formato "as:v1:<payload_b64url>:<sig_b64url>",
// onde payload é JSON { aid, uid, role, exp } (album_id, access_user_id, role,
// expira em epoch ms). Chave: GALLERY_SESSION_KEY (hex 64) ou
// WA_TOKEN_ENCRYPTION_KEY como fallback (mesma chave da galeria — uma só pra
// administrar). Sem chave válida: em produção FALHA FECHADA (rejeita todo
// token e não emite nenhum); em dev usa fallback estático só pra não travar.

import crypto from 'crypto';

const PREFIX = 'as:v1:';
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias

export interface AlbumSessionPayload {
  aid: string; // album_id
  uid: string; // access_user_id
  role: 'owner' | 'guest';
  exp: number;
}

let warnedFallback = false;

function getKey(): Buffer | null {
  const hex = process.env.GALLERY_SESSION_KEY || process.env.WA_TOKEN_ENCRYPTION_KEY;
  if (hex && hex.length === 64) {
    try { return Buffer.from(hex, 'hex'); } catch { /* cai pro fallback */ }
  }
  // SEM chave válida: em produção FALHA FECHADA — não derivamos chave de valor
  // público (APP_PUBLIC_URL é descobrível e permitiria FORJAR tokens).
  if (process.env.NODE_ENV === 'production') {
    if (!warnedFallback) {
      warnedFallback = true;
      console.error('[album-session] CRÍTICO: GALLERY_SESSION_KEY/WA_TOKEN_ENCRYPTION_KEY ausente em produção — sessões do álbum DESABILITADAS (login não funciona até configurar uma chave de 64 hex).');
    }
    return null;
  }
  if (!warnedFallback) {
    warnedFallback = true;
    console.warn('[album-session] aviso (dev): sem chave de sessão configurada — usando fallback inseguro. NÃO use isso em produção.');
  }
  return crypto.createHash('sha256').update('album-fallback-' + (process.env.APP_PUBLIC_URL || '')).digest();
}

function b64urlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? 0 : 4 - (s.length % 4);
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(pad), 'base64');
}

// Chave de ASSINATURA do álbum: derivada da chave-mãe (compartilhada com a
// galeria) com um rótulo de domínio. Isso isola CRIPTOGRAFICAMENTE os tokens
// do álbum dos da galeria — um token assinado num domínio não verifica no
// outro, mesmo com a mesma chave-mãe e mesmo payload. Não dependemos do
// prefixo (texto não assinado) nem dos nomes dos campos pra separar os
// domínios. A galeria continua usando a chave-mãe direta (não a tocamos), então
// nenhuma sessão de galeria existente é invalidada.
const ALBUM_DOMAIN = 'album-session-domain:v1';
function signingKey(): Buffer | null {
  const master = getKey();
  if (!master) return null;
  return crypto.createHmac('sha256', master).update(ALBUM_DOMAIN).digest();
}

// Indica se há uma chave válida pra assinar sessões (pro boot avisar).
export function isAlbumSessionConfigured(): boolean {
  return getKey() !== null;
}

export function signAlbumSession(
  data: { aid: string; uid: string; role: 'owner' | 'guest' },
): string | null {
  const key = signingKey();
  if (!key) return null; // sem chave segura → não emite sessão (prod)
  const payload: AlbumSessionPayload = { ...data, exp: Date.now() + TTL_MS };
  const payloadBuf = Buffer.from(JSON.stringify(payload), 'utf8');
  const payloadStr = b64urlEncode(payloadBuf);
  const sig = crypto.createHmac('sha256', key).update(payloadStr).digest();
  return PREFIX + payloadStr + ':' + b64urlEncode(sig);
}

export function verifyAlbumSession(token: string | null | undefined): AlbumSessionPayload | null {
  if (!token || !token.startsWith(PREFIX)) return null;
  const key = signingKey();
  if (!key) return null; // sem chave segura → rejeita todo token (prod)
  const rest = token.slice(PREFIX.length);
  const [payloadStr, sigStr] = rest.split(':');
  if (!payloadStr || !sigStr) return null;

  const expected = crypto.createHmac('sha256', key).update(payloadStr).digest();
  const provided = b64urlDecode(sigStr);
  if (expected.length !== provided.length || !crypto.timingSafeEqual(expected, provided)) return null;

  try {
    const payload = JSON.parse(b64urlDecode(payloadStr).toString('utf8')) as AlbumSessionPayload;
    if (!payload.aid || !payload.uid || !payload.exp || payload.exp < Date.now()) return null;
    if (payload.role !== 'owner' && payload.role !== 'guest') return null;
    return payload;
  } catch {
    return null;
  }
}

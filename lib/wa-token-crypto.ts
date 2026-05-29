// AES-256-GCM dos access_tokens do WhatsApp Cloud API.
//
// Formato do blob cifrado: "enc:v1:<iv_b64>:<tag_b64>:<ciphertext_b64>"
// O prefixo "enc:v1:" permite migração lazy — encryptIfNeeded/decryptIfNeeded
// olham o prefixo. Sem prefixo = plaintext (linha antiga, ainda funciona).
//
// Chave: env WA_TOKEN_ENCRYPTION_KEY (hex de 64 chars = 32 bytes).
// Gerar com: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
//
// IMPORTANTE: se a chave mudar, todos os tokens antigos viram lixo —
// usuários precisam reconectar. Não rotacionar sem migration de dados.

import crypto from 'crypto';

const ALGO = 'aes-256-gcm';
const PREFIX = 'enc:v1:';

function getKey(): Buffer | null {
  const hex = process.env.WA_TOKEN_ENCRYPTION_KEY;
  if (!hex) return null;
  if (hex.length !== 64) {
    console.error('[wa-token-crypto] WA_TOKEN_ENCRYPTION_KEY deve ter 64 chars hex (32 bytes). Ignorando.');
    return null;
  }
  try {
    return Buffer.from(hex, 'hex');
  } catch {
    console.error('[wa-token-crypto] WA_TOKEN_ENCRYPTION_KEY não é hex válido. Ignorando.');
    return null;
  }
}

/** Cifra um plaintext. Se a chave não tá configurada, retorna o plaintext intocado
 *  (útil em dev quando o usuário ainda não setou a env — fluxo continua funcionando,
 *  só não tem proteção em repouso). */
export function encryptIfNeeded(plaintext: string | null | undefined): string | null {
  if (!plaintext) return plaintext ?? null;
  if (plaintext.startsWith(PREFIX)) return plaintext; // já cifrado
  const key = getKey();
  if (!key) return plaintext;

  const iv = crypto.randomBytes(12); // GCM recomenda 12 bytes
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;
}

/** Decifra um blob "enc:v1:...". Se vier sem prefixo (plaintext legacy),
 *  retorna como veio — permite ler dados antigos antes da migração lazy. */
export function decryptIfNeeded(blob: string | null | undefined): string | null {
  if (!blob) return blob ?? null;
  if (!blob.startsWith(PREFIX)) return blob; // plaintext legacy
  const key = getKey();
  if (!key) {
    console.error('[wa-token-crypto] Token cifrado mas WA_TOKEN_ENCRYPTION_KEY não setada — não consigo decifrar.');
    return null;
  }

  try {
    const [, , ivB64, tagB64, ctB64] = blob.split(':');
    if (!ivB64 || !tagB64 || !ctB64) return null;
    const iv = Buffer.from(ivB64, 'base64');
    const tag = Buffer.from(tagB64, 'base64');
    const ct = Buffer.from(ctB64, 'base64');
    const decipher = crypto.createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    return pt.toString('utf8');
  } catch (err) {
    console.error('[wa-token-crypto] Falha ao decifrar token:', (err as Error).message);
    return null;
  }
}

/** True se a env tá configurada — usado por endpoints que precisam alertar
 *  o admin no setup (e pelo upsert pra decidir se marca token_encrypted=true). */
export function isEncryptionConfigured(): boolean {
  return getKey() !== null;
}

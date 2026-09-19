// Id de chave (key.id) embutido no wamid da Meta. Espelho exato da função SQL
// public.wa_message_key_id (migration 085): os dois precisam devolver o mesmo
// valor para qualquer entrada, senão o dedupe entre canais some.
//
// O wamid é base64 de uma struct Thrift Compact do MessageKey do WhatsApp:
//   1C 18 LL <remote> 15 XX 00 (11|12) 18 LL <key.id> 00
// remote é o telefone do cliente ou 'BR.<id>' (ecos do app); 11 = fromMe,
// 12 = recebida. key.id é o mesmo id que o Baileys grava em message_id.
// O formato não é documentado pela Meta: qualquer falha devolve o próprio valor
// (sem dedupe, mas nada quebra).

const WAMID_PREFIX = 'wamid.';
const BASE64_BODY = /^[A-Za-z0-9+/_-]+={0,2}$/;
const THRIFT_STRUCT_FIELD = 0x1c;
const THRIFT_BINARY_FIELD = 0x18;
const MAX_SINGLE_BYTE_LENGTH = 0x7f;
const KEY_ID_MIN = 8;
const KEY_ID_MAX = 64;
const ASCII_FIRST = 0x21;
const ASCII_LAST = 0x7e;

// O Buffer aceita base64 malformado em silêncio; o decode do Postgres não.
// Validar antes mantém os dois lados iguais.
function decodeWamidBody(body: string): Buffer | null {
  if (!BASE64_BODY.test(body)) return null;
  const clean = body.replace(/=+$/, '').replace(/-/g, '+').replace(/_/g, '/');
  if (clean.length % 4 === 1) return null;
  return Buffer.from(clean, 'base64');
}

function isPrintableAscii(byte: number): boolean {
  return byte >= ASCII_FIRST && byte <= ASCII_LAST;
}

function keyIdFromBytes(bytes: Buffer): string | null {
  if (bytes.length < 3 || bytes[0] !== THRIFT_STRUCT_FIELD || bytes[1] !== THRIFT_BINARY_FIELD) return null;
  const remoteLength = bytes[2];
  if (remoteLength > MAX_SINGLE_BYTE_LENGTH) return null;
  const fieldAt = bytes.indexOf(THRIFT_BINARY_FIELD, 3 + remoteLength);
  if (fieldAt < 0 || fieldAt + 1 >= bytes.length) return null;
  const keyLength = bytes[fieldAt + 1];
  const keyStart = fieldAt + 2;
  if (keyLength < KEY_ID_MIN || keyLength > KEY_ID_MAX || keyStart + keyLength > bytes.length) return null;
  const key = bytes.subarray(keyStart, keyStart + keyLength);
  return key.every(isPrintableAscii) ? key.toString('latin1') : null;
}

export function waMessageKeyId(messageId: string | null | undefined): string | null {
  if (typeof messageId !== 'string') return null;
  if (!messageId.startsWith(WAMID_PREFIX)) return messageId;
  const bytes = decodeWamidBody(messageId.slice(WAMID_PREFIX.length));
  return (bytes && keyIdFromBytes(bytes)) ?? messageId;
}

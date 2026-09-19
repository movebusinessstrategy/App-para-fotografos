// Telefone brasileiro em um lugar só, para cadência, rastreador e envio
// falarem a mesma língua. Módulo puro: sem banco e sem rede.

export function digitsOnly(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '');
}

// 55 + DDD + 9 + 8 dígitos (13 no total), o formato gravado em scheduled_followups.phone.
export function normalizeBrazilianPhone13(value: unknown): string {
  const d = digitsOnly(value);
  if (d.startsWith('55')) return d.length === 12 ? d.slice(0, 4) + '9' + d.slice(4) : d;
  if (d.length === 11) return '55' + d;
  if (d.length === 10) return '55' + d.slice(0, 2) + '9' + d.slice(2);
  return d;
}

function variantsOfTail(tail: string): string[] {
  if (tail.length === 10) {
    const withNine = `${tail.slice(0, 2)}9${tail.slice(2)}`;
    return [withNine, `55${withNine}`];
  }
  if (tail.length === 11 && tail[2] === '9') {
    const withoutNine = `${tail.slice(0, 2)}${tail.slice(3)}`;
    return [withoutNine, `55${withoutNine}`];
  }
  return [];
}

// Cópia fiel de brazilianPhoneVariants do server.ts (mesma ordem de inserção).
export function brazilianPhoneVariants(value: unknown): string[] {
  const raw = digitsOnly(value);
  if (!raw) return [];
  const tail = raw.startsWith('55') && raw.length >= 12 ? raw.slice(2) : raw;
  const variants = new Set<string>();
  for (const candidate of [raw, tail, `55${tail}`, ...variantsOfTail(tail)]) {
    if (candidate) variants.add(candidate);
  }
  return Array.from(variants);
}

// Espelho exato do SQL public.followup_phone_key (083). Não é o wa_phone_key.
export function canonicalPhoneKey(value: unknown): string {
  const d = digitsOnly(value);
  const k = d.length === 10 || d.length === 11 ? '55' + d : d;
  if (k.length === 13 && k.startsWith('55') && k[4] === '9') return k.slice(0, 4) + k.slice(5);
  return k;
}

export function samePhone(a: unknown, b: unknown): boolean {
  const left = new Set(brazilianPhoneVariants(a));
  if (!left.size) return false;
  return brazilianPhoneVariants(b).some((variant) => left.has(variant));
}

export function maskPhone(value: unknown): string {
  const d = digitsOnly(value);
  return d.length < 4 ? '…' : '…' + d.slice(-4);
}

// Dígitos do JID do Baileys. Um telefone já visto pelo socket vence; sem ele,
// DDD 31 ou maior usa o JID sem o 9 extra e DDD de 11 a 28 mantém os 13 dígitos.
export function baileysJid(phone: string, seenBaileysPhones: string[]): string {
  const seen = (seenBaileysPhones || []).find((candidate) => samePhone(phone, candidate));
  if (seen) return digitsOnly(seen);
  const d = digitsOnly(phone);
  if (d.length !== 13 || !d.startsWith('55')) return d;
  const ddd = Number(d.slice(2, 4));
  if (ddd >= 31) return d.slice(0, 4) + d.slice(5);
  return d;
}

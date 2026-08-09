import { Conversation } from '../types';

function normalizeText(value: unknown): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/\s+/g, ' ')
    .trim();
}

function digitsOnly(value: unknown): string {
  return String(value || '').replace(/\D/g, '');
}

function brazilianPhoneVariants(value: unknown): string[] {
  const raw = digitsOnly(value);
  if (!raw) return [];

  const variants = new Set([raw]);
  const tail = raw.startsWith('55') && raw.length >= 12 ? raw.slice(2) : raw;
  variants.add(tail);
  variants.add(`55${tail}`);

  if (tail.length === 10) {
    const withNine = `${tail.slice(0, 2)}9${tail.slice(2)}`;
    variants.add(withNine);
    variants.add(`55${withNine}`);
  }
  if (tail.length === 11 && tail[2] === '9') {
    const withoutNine = `${tail.slice(0, 2)}${tail.slice(3)}`;
    variants.add(withoutNine);
    variants.add(`55${withoutNine}`);
  }
  return Array.from(variants);
}

function phoneMatchesQuery(phone: string, queryDigits: string): boolean {
  if (!queryDigits) return false;
  if (phone.includes(queryDigits)) return true;
  if (queryDigits.length < 10) return false;

  const phoneVariants = new Set(brazilianPhoneVariants(phone));
  return brazilianPhoneVariants(queryDigits).some((variant) => phoneVariants.has(variant));
}

export function conversationMatchesSearch(
  conversation: Conversation,
  query: string,
  resolvedName = '',
): boolean {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) return true;

  const phone = digitsOnly(conversation.phone);
  const queryDigits = digitsOnly(query);
  const names = [
    resolvedName,
    (conversation as any).contact_name,
    (conversation as any).push_name,
    (conversation as any).pushName,
    (conversation as any).name,
  ];
  const searchableText = normalizeText([...names, phone].join(' '));

  if (searchableText.includes(normalizedQuery)) return true;
  return phoneMatchesQuery(phone, queryDigits);
}

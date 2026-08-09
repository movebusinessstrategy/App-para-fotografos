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
  return Boolean(queryDigits && phone.includes(queryDigits));
}

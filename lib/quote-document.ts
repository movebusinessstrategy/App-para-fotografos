// Decide se um documento que o estúdio mandou é um orçamento. O nome do
// arquivo chega de muitas formas (acento decomposto, "(1)", "..pdf", ano
// diferente), então tudo vira uma chave simples antes de comparar.
import { AGENT_EXTRA_MATERIAL_NICHE } from '../agent-autonomy.js';

export interface QuoteRules { materialKeys: Set<string>; keywords: string[]; exclusions: string[]; genericPdfIsQuote: boolean }
export interface QuoteCandidate { direction: 'in' | 'out'; type: string | null; filename: string | null; body: string | null; mimeType: string | null; quoteHint?: boolean }

export function quoteNameKey(name: string | null | undefined): string {
  return String(name ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/(\.+\s*[a-z0-9]{2,4})+$/, '')
    .replace(/\(\s*\d+\s*\)/g, ' ')
    .replace(/\d+/g, ' ')
    .replace(/[^a-z]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function materialKeysFrom(rows: Array<{ nome_arquivo: string | null; tipo: string | null; nicho: string | null }>): Set<string> {
  const keys = new Set<string>();
  for (const row of rows || []) {
    if (row?.tipo !== 'pacote' || row.nicho === AGENT_EXTRA_MATERIAL_NICHE) continue;
    const key = quoteNameKey(row.nome_arquivo);
    if (key) keys.add(key);
  }
  return keys;
}

// Palavra ou frase inteira dentro da chave (as duas já normalizadas).
function containsPhrase(key: string, terms: string[]): boolean {
  const padded = ` ${key} `;
  return terms.some((term) => {
    const normalized = quoteNameKey(term);
    return !!normalized && padded.includes(` ${normalized} `);
  });
}

function isPdf(name: string, mimeType: string | null): boolean {
  const mime = String(mimeType ?? '').split(';')[0].trim().toLowerCase();
  if (mime === 'application/pdf') return true;
  return /\.+\s*pdf\s*$/i.test(name.trim());
}

export function isQuoteDocument(msg: QuoteCandidate, rules: QuoteRules): boolean {
  if (msg.direction !== 'out') return false;
  if (msg.quoteHint) return true;
  if (msg.type !== 'document') return false;
  const name = String(msg.filename ?? msg.body ?? '');
  const key = quoteNameKey(name);
  if (!key) return false;
  if (containsPhrase(key, rules.exclusions)) return false;
  if (rules.materialKeys.has(key)) return true;
  if (containsPhrase(key, rules.keywords)) return true;
  return rules.genericPdfIsQuote && isPdf(name, msg.mimeType);
}

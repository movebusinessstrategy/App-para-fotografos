/**
 * Remove acentos e normaliza texto para comparações
 * Ex: "João André" → "joao andre"
 */
export function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

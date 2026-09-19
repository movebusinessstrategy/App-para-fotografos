// Detecta pedido de parar de receber mensagens. HARD é pedido explícito;
// SOFT é desinteresse. Textos longos ficam de fora: pedido de saída é curto e
// conversa longa gera falso positivo.

export type OptOutKind = 'hard' | 'soft';

const MAX_NORMALIZED_LENGTH = 400;

const HARD_PATTERNS: readonly RegExp[] = [
  /\b(para|pare|parem|parar) de (me )?(mandar|enviar|chamar)\b/,
  /\bnao (me )?(mande|mandem|envie|enviem) mais\b/,
  /\b(me )?(tira|tire|remove|remova|exclui|exclua)\b.{0,20}\blista\b/,
  /descadastr/,
  /\bnao (entre|entrem) mais em contato\b/,
  /^(stop|pare|sair|parar)[.! ]*$/,
];

const SOFT_PATTERNS: readonly RegExp[] = [
  /\b(nao tenho|sem) (mais )?interesse\b(?! (em|no|na|nos|nas)\b)/,
  /\bdesisti\b/,
  /\bja (fechei|contratei|fiz)( o ensaio| as fotos)? com outr[oa]\b/,
  /\bnao (vou|vamos) (mais )?fazer\b/,
];

export function normalizeForMatch(text: string): string {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function firstMatch(text: string, patterns: readonly RegExp[]): RegExp | null {
  return patterns.find((pattern) => pattern.test(text)) ?? null;
}

export function detectOptOut(text: string | null | undefined): { kind: OptOutKind; pattern: string } | null {
  const normalized = normalizeForMatch(text ?? '');
  if (!normalized || normalized.length > MAX_NORMALIZED_LENGTH) return null;
  const hard = firstMatch(normalized, HARD_PATTERNS);
  if (hard) return { kind: 'hard', pattern: hard.source };
  const soft = firstMatch(normalized, SOFT_PATTERNS);
  if (soft) return { kind: 'soft', pattern: soft.source };
  return null;
}

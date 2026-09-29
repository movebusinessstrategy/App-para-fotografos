// Etiqueta legível e reversível: mantém a etapa e o histórico da oportunidade.
export const FUNNEL_EXCLUSION_PREFIX = 'Fora do funil:';

export function dealExclusionReason(deal: { labels?: unknown } | null | undefined): string | null {
  if (!Array.isArray(deal?.labels)) return null;
  return deal.labels.find((label: unknown) => typeof label === 'string' && label.startsWith(FUNNEL_EXCLUSION_PREFIX)) ?? null;
}

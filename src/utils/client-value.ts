export type ClientTier = 'Bronze' | 'Silver' | 'Gold' | 'Platinum' | 'Diamond';

export interface ClientValueJob {
  id?: string | number | null;
  deal_id?: string | number | null;
  status?: unknown;
  amount?: unknown;
}

export interface ClientValueSummary {
  totalInvestedCents: number;
  totalInvested: number;
  purchaseCount: number;
  tier: ClientTier;
}

const ELIGIBLE_STATUSES = new Set(['scheduled', 'completed']);

export function normalizeClientValueStatus(status: unknown): string {
  return String(status ?? '').trim().toLowerCase();
}

export function isClientValueEligibleStatus(status: unknown): boolean {
  return ELIGIBLE_STATUSES.has(normalizeClientValueStatus(status));
}

export function clientValueAmountCents(amount: unknown): number {
  const numeric = typeof amount === 'number' ? amount : Number(String(amount ?? '').trim());
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return Math.round(numeric * 100);
}

export function calculateClientTier(purchaseCount: number, totalInvestedCents: number): ClientTier {
  if (purchaseCount >= 10 || totalInvestedCents >= 1_500_000) return 'Diamond';
  if (purchaseCount >= 7 || totalInvestedCents >= 500_000) return 'Platinum';
  if (purchaseCount >= 4 || totalInvestedCents >= 150_000) return 'Gold';
  if (purchaseCount >= 2 || totalInvestedCents >= 50_000) return 'Silver';
  return 'Bronze';
}

function purchaseGroupKey(job: ClientValueJob, index: number): string {
  const dealId = String(job.deal_id ?? '').trim();
  if (dealId) return `deal:${dealId}`;

  const jobId = String(job.id ?? '').trim();
  return jobId ? `job:${jobId}` : `row:${index}`;
}

export function summarizeClientValue(jobs: readonly ClientValueJob[]): ClientValueSummary {
  const purchaseTotals = new Map<string, number>();
  let totalInvestedCents = 0;

  jobs.forEach((job, index) => {
    if (!isClientValueEligibleStatus(job.status)) return;

    const amountCents = clientValueAmountCents(job.amount);
    totalInvestedCents += amountCents;

    const groupKey = purchaseGroupKey(job, index);
    purchaseTotals.set(groupKey, (purchaseTotals.get(groupKey) ?? 0) + amountCents);
  });

  const purchaseCount = [...purchaseTotals.values()].filter((total) => total > 0).length;

  return {
    totalInvestedCents,
    totalInvested: totalInvestedCents / 100,
    purchaseCount,
    tier: calculateClientTier(purchaseCount, totalInvestedCents),
  };
}

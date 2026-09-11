export function moneyCents(value: unknown, label = 'Valor'): number {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number < 0 || number > 100_000_000) {
    throw new Error(`${label} inválido.`);
  }
  return Math.round((number + Number.EPSILON) * 100);
}

export function salePricing(gross: unknown, discount: unknown) {
  const grossCents = moneyCents(gross);
  const discountCents = moneyCents(discount, 'Desconto');
  if (discountCents > grossCents) throw new Error('O desconto não pode ultrapassar o valor da venda.');
  return { gross: grossCents / 100, discount: discountCents / 100, net: (grossCents - discountCents) / 100 };
}

// Largest remainder: the allocated cents always add up to the original total.
export function allocateMoney(total: number, weights: number[]): number[] {
  const cents = moneyCents(total);
  const units = weights.map(value => moneyCents(value));
  const sum = units.reduce((a, b) => a + b, 0);
  if (!units.length) return [];
  const normalized = sum > 0 ? units : units.map(() => 1);
  const divisor = sum || units.length;
  const shares = normalized.map(weight => cents * weight / divisor);
  const result = shares.map(Math.floor);
  const order = shares.map((value, index) => ({ index, remainder: value - result[index] }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  const remainder = cents - result.reduce((a, b) => a + b, 0);
  for (let index = 0; index < remainder; index++) result[order[index].index]++;
  return result.map(value => value / 100);
}

export function dealGross(deal: { value?: number; discount?: number; sale_gross_amount?: number | null }) {
  return Number(deal.sale_gross_amount ?? deal.value ?? 0);
}

export function jobSaleBase(job: { sale_gross_amount?: number | null; sale_discount_amount?: number }) {
  if (job.sale_gross_amount == null) return null;
  return salePricing(job.sale_gross_amount, job.sale_discount_amount).net;
}

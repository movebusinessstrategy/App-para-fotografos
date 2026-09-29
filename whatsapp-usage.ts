import type { Express, RequestHandler } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { decryptIfNeeded } from './lib/wa-token-crypto.js';
import { localDateKey, localDayStartUtc } from './lib/business-hours.js';

type Json = Record<string, any>;
const TZ = 'America/Sao_Paulo';
const GRAPH = 'https://graph.facebook.com/v21.0';
const FREE = new Set(['FREE_CUSTOMER_SERVICE', 'FREE_ENTRY_POINT', 'FREE_TIER']);
export type UsagePeriod = 'today' | '7days' | 'month';

export function usageWindow(period: UsagePeriod, now: Date) {
  const today = localDateKey(now, TZ);
  const day = period === 'month' ? `${today.slice(0, 7)}-01` : today;
  const start = localDayStartUtc(new Date(`${day}T12:00:00Z`), TZ).getTime();
  return { start: Math.floor((start - (period === '7days' ? 6 * 86400000 : 0)) / 1000), end: Math.floor(now.getTime() / 1000) };
}

function points(data: Json | null): Json[] {
  return (data?.pricing_analytics?.data ?? []).flatMap((group: Json) => group.data_points ?? []);
}

export function summarizeUsage(analytics: Json | null, pricing: Json | null) {
  const counts = analytics?.analytics?.data_points;
  const rows = points(pricing);
  const hasPricing = Array.isArray(pricing?.pricing_analytics?.data);
  const categories = new Map<string, { category: string; messages: number; cost: number; charged_messages: number; charged_cost: number }>();
  let charged = 0, free = 0, unclassified = 0, cost = 0;
  for (const row of rows) {
    const volume = Number(row.volume ?? 0);
    const amount = Number(row.cost ?? 0);
    if (!Number.isFinite(volume) || !Number.isFinite(amount)) throw new Error('INVALID_META_ANALYTICS');
    if (row.pricing_type === 'REGULAR') charged += volume;
    else if (FREE.has(row.pricing_type)) free += volume;
    else unclassified += volume;
    cost += amount;
    const key = String(row.pricing_category ?? 'UNKNOWN');
    const category = categories.get(key) ?? { category: key, messages: 0, cost: 0, charged_messages: 0, charged_cost: 0 };
    category.messages += volume;
    category.cost += amount;
    if (row.pricing_type === 'REGULAR') {
      category.charged_messages += volume;
      category.charged_cost += amount;
    }
    categories.set(key, category);
  }
  const sum = (key: string) => Array.isArray(counts) ? counts.reduce((n: number, p: Json) => n + Number(p[key] ?? 0), 0) : null;
  return {
    sent: sum('sent'), delivered: sum('delivered'),
    charged: hasPricing ? charged : null, free: hasPricing ? free : null,
    unclassified: hasPricing ? unclassified : null, cost: hasPricing ? Number(cost.toFixed(6)) : null,
    categories: [...categories.values()],
    latest_data_start: Math.max(0, ...rows.map(r => Number(r.start)), ...(counts ?? []).map((r: Json) => Number(r.start))) || null,
  };
}

async function graphGet(account: Json, fields: string, token: string, doFetch: typeof fetch): Promise<Json> {
  const url = `${GRAPH}/${encodeURIComponent(account.waba_id)}?${new URLSearchParams({ fields })}`;
  const response = await doFetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) });
  const body = await response.json() as Json;
  if (!response.ok || body.error) throw new Error('META_USAGE_UNAVAILABLE');
  return body;
}

export async function loadWhatsAppUsage(db: SupabaseClient, userId: string, period: UsagePeriod, now = new Date(), doFetch = fetch) {
  const { data, error } = await db.from('whatsapp_business_accounts')
    .select('waba_id,phone_number,display_name,access_token').eq('user_id', userId).eq('is_active', true).limit(2);
  if (error) throw new Error('WHATSAPP_ACCOUNT_UNAVAILABLE');
  if (data?.length !== 1) throw new Error('WHATSAPP_ACCOUNT_REQUIRED');
  const account = data[0];
  const phone = String(account.phone_number ?? '').replace(/\D/g, '');
  const token = decryptIfNeeded(account.access_token);
  if (!token || !phone || !account.waba_id) throw new Error('WHATSAPP_ACCOUNT_REQUIRED');
  const window = usageWindow(period, now);
  const base = `start(${window.start}).end(${window.end})`;
  const filter = `phone_numbers(["${phone}"])`;
  const results = await Promise.allSettled([
    graphGet(account, 'name,currency', token, doFetch),
    graphGet(account, `analytics.${base}.granularity(DAY).${filter}`, token, doFetch),
    graphGet(account, `pricing_analytics.${base}.granularity(DAILY).${filter}.dimensions(["PRICING_CATEGORY","PRICING_TYPE"])`, token, doFetch),
  ]);
  const value = (i: number) => results[i].status === 'fulfilled' ? (results[i] as PromiseFulfilledResult<Json>).value : null;
  const summary = summarizeUsage(value(1), value(2));
  const currency = value(0)?.currency ?? null;
  return {
    ...summary, cost: currency ? summary.cost : null, currency,
    account: { name: value(0)?.name ?? account.display_name, phone, waba_id: account.waba_id },
    period, start: new Date(window.start * 1000).toISOString(), end: now.toISOString(),
    fetched_at: now.toISOString(), timezone: TZ,
    partial: results.some(r => r.status === 'rejected'),
    invoice_paid: null,
  };
}

interface RouteDeps {
  db: SupabaseClient; requireAuth: RequestHandler; requireOwnerOrPlatformAdmin: RequestHandler;
  denyProductionOnly: RequestHandler; requirePermission: (permission: string) => RequestHandler;
}

export function registerWhatsAppUsageRoutes(app: Express, deps: RouteDeps) {
  const cache = new Map<string, { expires: number; value: Awaited<ReturnType<typeof loadWhatsAppUsage>> }>();
  app.get('/api/followups/whatsapp-usage', deps.requireAuth, deps.denyProductionOnly,
    deps.requirePermission('vendas'), deps.requireOwnerOrPlatformAdmin, async (req, res) => {
      res.setHeader('Cache-Control', 'private, no-store');
      const period = String(req.query.period ?? 'month');
      if (!['today', '7days', 'month'].includes(period)) { res.status(400).json({ error: 'Período inválido.' }); return; }
      const userId = (req as any).userId as string;
      const key = `${userId}:${period}`;
      try {
        const cached = cache.get(key);
        if (cached && cached.expires > Date.now()) { res.json(cached.value); return; }
        const value = await loadWhatsAppUsage(deps.db, userId, period as UsagePeriod);
        if (cache.size > 200) cache.clear();
        cache.set(key, { value, expires: Date.now() + 300000 });
        res.json(value);
      } catch {
        res.status(503).json({ error: 'Não foi possível consultar o consumo da Meta. Confira a conexão e as permissões da conta WhatsApp.' });
      }
    });
}

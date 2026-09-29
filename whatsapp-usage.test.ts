import assert from 'node:assert/strict';
import test from 'node:test';
import { loadWhatsAppUsage, summarizeUsage, usageWindow } from './whatsapp-usage.js';

test('separa enviada, entregue, tarifada e gratuita sem cobrar falha nem supor tarifa', () => {
  const actual = summarizeUsage({ analytics: { data_points: [{ sent: 12, delivered: 10 }] } },
    { pricing_analytics: { data: [{ data_points: [
      { pricing_type: 'REGULAR', pricing_category: 'MARKETING', volume: 8, cost: 0.5 },
      { pricing_type: 'FREE_ENTRY_POINT', pricing_category: 'SERVICE', volume: 2, cost: 0 },
    ] }] } });
  assert.equal(actual.sent, 12); assert.equal(actual.delivered, 10);
  assert.equal(actual.charged, 8); assert.equal(actual.free, 2); assert.equal(actual.cost, 0.5);
});
test('indisponível não vira zero e tipo desconhecido não vira gratuito', () => {
  assert.equal(summarizeUsage(null, null).cost, null);
  const result = summarizeUsage(null, { pricing_analytics: { data: [{ data_points: [
    { pricing_type: 'FUTURE_TYPE', volume: 4, cost: 0 },
  ] }] } });
  assert.equal(result.free, 0); assert.equal(result.unclassified, 4);
  assert.equal(summarizeUsage({ analytics: { data_points: [] } }, { pricing_analytics: { data: [] } }).cost, 0);
});
test('período segue Brasília na virada do mês', () => {
  const now = new Date('2026-10-01T01:00:00Z');
  assert.equal(new Date(usageWindow('month', now).start * 1000).toISOString(), '2026-09-01T03:00:00.000Z');
  assert.equal(new Date(usageWindow('today', now).start * 1000).toISOString(), '2026-09-30T03:00:00.000Z');
});

test('simulação considera só marketing tarifado, sem diluir a média com gratuitos', () => {
  const result = summarizeUsage(null, { pricing_analytics: { data: [{ data_points: [
    { pricing_type: 'REGULAR', pricing_category: 'MARKETING', volume: 10, cost: 0.6 },
    { pricing_type: 'FREE_ENTRY_POINT', pricing_category: 'MARKETING', volume: 5, cost: 0 },
  ] }] } });
  const marketing = result.categories[0];
  assert.equal(marketing.messages, 15);
  assert.equal(marketing.charged_cost / marketing.charged_messages, 0.06);
});

test('isola a conta, oculta o token e não apresenta falha parcial como custo zero', async () => {
  const filters: unknown[] = [];
  const query = { select() { return this; }, eq(...args: unknown[]) { filters.push(args); return this; },
    async limit() { return { data: [{ waba_id: 'account-1', phone_number: '554300000000', access_token: 'secret', display_name: 'Teste' }], error: null }; } };
  const db = { from(table: string) { assert.equal(table, 'whatsapp_business_accounts'); return query; } };
  const requests: string[] = [];
  const doFetch = async (url: any, init: any) => {
    requests.push(String(url));
    assert.equal(init.headers.Authorization, 'Bearer secret');
    const fields = new URL(url).searchParams.get('fields')!;
    if (fields.includes('pricing_analytics')) return new Response(JSON.stringify({ error: { message: 'permission' } }), { status: 403 });
    if (fields === 'name,currency') return Response.json({ name: 'Teste', currency: 'USD' });
    return Response.json({ analytics: { data_points: [{ sent: 12, delivered: 10 }] } });
  };
  const result = await loadWhatsAppUsage(db as any, 'tenant-1', 'month', new Date('2026-09-29T20:00:00Z'), doFetch as any);
  assert.deepEqual(filters, [['user_id', 'tenant-1'], ['is_active', true]]);
  assert.equal(result.sent, 12); assert.equal(result.cost, null); assert.equal(result.free, null);
  assert.equal(result.partial, true); assert.equal(JSON.stringify(result).includes('secret'), false);
  assert.equal(requests.some(url => url.includes('secret')), false);
  assert.equal(result.invoice_paid, null);
});

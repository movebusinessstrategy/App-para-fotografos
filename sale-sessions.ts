import { normalizeInviteEmail, normalizeRequiredJobSchedule } from './calendar-conversion.js';
import { allocateMoney, moneyCents, salePricing } from './src/utils/salePricing.js';

export function normalizeSaleSessions(raw: unknown, gross: number, discount: number, signal: number) {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 20) throw new Error('Informe de 1 a 20 ensaios.');
  const pricing = salePricing(gross, discount);
  if (moneyCents(signal, 'Sinal') > moneyCents(pricing.net)) throw new Error('O sinal não pode ultrapassar o total da venda.');
  const sessions = raw.map((session, index) => normalizeSession(session, index));
  const weights = sessions.map(session => session.gross_amount);
  if (weights.reduce((sum, value) => sum + moneyCents(value), 0) !== moneyCents(gross)) {
    throw new Error('A soma dos valores dos ensaios precisa ser igual ao valor da venda antes do desconto.');
  }
  const discounts = allocateMoney(discount, weights);
  const net = weights.map((value, index) => (moneyCents(value) - moneyCents(discounts[index])) / 100);
  const signals = allocateMoney(signal, net);
  return sessions.map((session, index) => ({ ...session, discount_amount: discounts[index], amount: net[index], signal_amount: signals[index] }));
}

function normalizeSession(raw: Record<string, unknown>, index: number) {
  if (!raw || typeof raw !== 'object') throw new Error('Ensaio inválido.');
  const type = String(raw.job_type || '').trim();
  if (!type) throw new Error(`Informe o tipo do ensaio ${index + 1}.`);
  const schedule = raw.schedule_later === true
    ? { job_type: type, job_date: null, job_time: null, job_end_time: null }
    : normalizeRequiredJobSchedule(raw);
  return {
    ...schedule, session_index: index,
    job_name: String(raw.job_name || type).trim().slice(0, 250),
    gross_amount: moneyCents(raw.gross_amount) / 100,
    notes: String(raw.notes || '').slice(0, 20000),
  };
}

export function conversionClient(body: any, deal: any) {
  const c = body.client || {};
  return {
    name: String(c.name || deal.contact_name || deal.title).trim(),
    phone: c.phone || deal.contact_phone || null,
    email: normalizeInviteEmail(c.email ?? deal.contact_email),
    cpf: c.document || c.cpf || null, birth_date: c.birth_date || null,
    address: c.address || null, address_number: c.address_number || null,
    address_complement: c.address_complement || null, neighborhood: c.neighborhood || null,
    city: c.city || null, state: c.state || null, cep: c.zip_code || c.cep || null,
    instagram: c.instagram || deal.contact_instagram || null,
    lead_source: c.lead_source || c.how_found || deal.lead_source || null,
    notes: String(c.notes || '').trim() || null,
  };
}

export async function convertSaleSessions({ db, userId, deal, body, updates, entryStage }: {
  db: any; userId: string; deal: any; body: any; updates: any; entryStage: string;
}) {
  const gross = moneyCents(body.gross_amount) / 100;
  const discount = moneyCents(body.discount, 'Desconto') / 100;
  const signal = moneyCents(body.sinalAmount, 'Sinal') / 100;
  const sessions = normalizeSaleSessions(body.sessions, gross, discount, signal);
  const inviteEmail = body.inviteEmail === undefined ? undefined : normalizeInviteEmail(body.inviteEmail);
  const { data, error } = await db.rpc('convert_deal_sessions', {
    p_user_id: userId, p_deal_id: Number(deal.id),
    p_payload: {
      sessions, gross_amount: gross, discount, signal_amount: signal,
      create_client: body.createClient === true,
      client: body.createClient ? conversionClient(body, deal) : null,
      client_id: body.existingClientId || deal.client_id || null,
      invite_email: inviteEmail, existing_job_id: body.existingJobId || null,
      force: body.force === true, payment_method: String(body.job?.payment_method || 'Pix'),
      items: normalizeSaleItems(body.items),
      updates, entry_stage: entryStage,
    },
  });
  if (error) {
    if (error.message === 'duplicate_job') {
      const duplicate = new Error('Este cliente já tem um ensaio do mesmo tipo nesta data.');
      Object.assign(duplicate, { code: 'duplicate_job', existing: JSON.parse(error.details || '[]') });
      throw duplicate;
    }
    if (/convert_deal_sessions|schema cache/i.test(error.message)) throw new Error('Atualização de ensaios da venda pendente no banco (migração 077).');
    throw new Error(error.message);
  }
  return data;
}

export function normalizeSaleItems(raw: unknown) {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > 100) throw new Error('Itens da venda inválidos.');
  return raw.map(item => {
    if (!item || typeof item !== 'object') throw new Error('Item do catálogo inválido.');
    if (!['combo', 'produto', 'servico'].includes(item.catalog_type) || !item.catalog_id || !item.catalog_name) throw new Error('Item do catálogo inválido.');
    const quantity = Number(item.quantidade ?? 1);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10000) throw new Error('Quantidade inválida.');
    return { catalog_type: item.catalog_type, catalog_id: String(item.catalog_id), catalog_name: String(item.catalog_name),
      catalog_value: moneyCents(item.catalog_value) / 100, quantidade: quantity };
  });
}

// Opt-out ("não quero mais receber") compartilhado pela cadência, pelo worker
// legado e pelo disparo em massa. Antes da migration 083 a tabela não existe:
// ninguém está marcado e nada quebra.
import type { SupabaseClient } from '@supabase/supabase-js';
import { canonicalPhoneKey } from './br-phone.js';

// Tabela ou coluna ausente (Postgres e cache de schema do PostgREST).
const MISSING_SCHEMA_CODES = new Set(['42P01', 'PGRST205', '42703']);
const PAGE_SIZE = 1000;
// Teto de segurança da paginação (100 mil opt-outs ativos por conta).
const MAX_PAGES = 100;

export function isMissingSchemaError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  return typeof code === 'string' && MISSING_SCHEMA_CODES.has(code);
}

function storeError(error: { code?: unknown; message?: unknown }): Error {
  return Object.assign(new Error(`followup_optouts: ${String(error.message ?? 'erro desconhecido')}`), { code: error.code });
}

async function fetchKeyPage(db: SupabaseClient, userId: string, page: number) {
  const from = page * PAGE_SIZE;
  return db
    .from('followup_optouts')
    .select('phone_key')
    .eq('user_id', userId)
    .is('revoked_at', null)
    .order('id', { ascending: true })
    .range(from, from + PAGE_SIZE - 1);
}

// Chaves (followup_phone_key) dos opt-outs ativos da conta. Pagina porque o
// PostgREST corta em 1000 linhas por resposta.
export async function loadOptOutKeys(db: SupabaseClient, userId: string): Promise<Set<string>> {
  const keys = new Set<string>();
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await fetchKeyPage(db, userId, page);
    if (error) {
      if (isMissingSchemaError(error)) return new Set();
      throw storeError(error);
    }
    const rows = (data || []) as Array<{ phone_key: unknown }>;
    for (const row of rows) if (row?.phone_key) keys.add(String(row.phone_key));
    if (rows.length < PAGE_SIZE) return keys;
  }
  throw new Error('followup_optouts: opt-outs demais para carregar de uma vez');
}

export function optOutSetHas(keys: Set<string>, phone: unknown): boolean {
  const key = canonicalPhoneKey(phone);
  return !!key && keys.has(key);
}

// Consulta pontual. Fail-closed: erro que não seja tabela ausente conta como
// opt-out, para nunca mandar mensagem a quem pode ter pedido para parar.
export async function isOptedOut(db: SupabaseClient, userId: string, phone: unknown): Promise<boolean> {
  const key = canonicalPhoneKey(phone);
  if (!key) return false;
  try {
    const { data, error } = await db
      .from('followup_optouts')
      .select('id')
      .eq('user_id', userId)
      .eq('phone_key', key)
      .is('revoked_at', null)
      .limit(1);
    if (error) return !isMissingSchemaError(error);
    return (data || []).length > 0;
  } catch {
    return true;
  }
}

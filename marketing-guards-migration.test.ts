import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (file: string): string => readFileSync(new URL(`./migrations/${file}`, import.meta.url), 'utf8');

const sql = read('084_marketing_guards.sql');
const base = read('074_marketing_measurement_bridge_v2.sql');

const CAPTURE = 'capture_marketing_whatsapp_contact(';
const QUEUE = 'queue_mapped_stage_conversions()';
const CAPTURE_MD5 = 'baf45a0f6071e132b47d8b6b85d30248';
const QUEUE_MD5 = '61ea03744fee2da293152c672e437297';

// Cabeçalho que o pg_get_functiondef de produção devolve (lido em 19/09/2026).
// Com ele e o corpo da 074 dá para reproduzir o md5 esperado sem banco.
const PROD_HEADERS: Record<string, string> = {
  [CAPTURE]: 'CREATE OR REPLACE FUNCTION public.capture_marketing_whatsapp_contact(p_user_id uuid, p_phone text, '
    + 'p_wa_number text, p_message_id text, p_message_body text, p_occurred_at timestamp with time zone, '
    + "p_ctwa_clid text DEFAULT NULL::text, p_waba_id text DEFAULT NULL::text, p_referral_attribution jsonb DEFAULT '{}'::jsonb)\n"
    + ' RETURNS TABLE(result_status text, touchpoint_id bigint, lead_id uuid, deal_id bigint, match_strategy text, '
    + 'queued_provider_count integer)\n'
    + ' LANGUAGE plpgsql\n SECURITY DEFINER\n'
    + " SET search_path TO 'pg_catalog', 'public', 'pg_temp'\n",
  [QUEUE]: 'CREATE OR REPLACE FUNCTION public.queue_mapped_stage_conversions()\n RETURNS trigger\n LANGUAGE plpgsql\n'
    + " SECURITY DEFINER\n SET search_path TO 'pg_catalog', 'public', 'pg_temp'\n",
};

const functionSql = (source: string, name: string): string => {
  const start = source.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
  assert.notEqual(start, -1, `${name} deve existir`);
  const end = source.indexOf('\n$$;\n', start);
  assert.notEqual(end, -1, `${name} deve terminar com $$;`);
  return source.slice(start, end + 4);
};

const prosrc = (fn: string): string => fn.slice(fn.indexOf('AS $$') + 5, fn.lastIndexOf('$$;'));

const md5 = (text: string): string => createHash('md5').update(text, 'utf8').digest('hex');

const dedent = (block: string): string => block.split('\n').map((line) => line.replace(/^ {2}/, '')).join('\n');

// Desfaz a guarda da captura: tira o comentário e o IF, e devolve o PERFORM à indentação original.
const withoutCaptureGuard = (fn: string): string => {
  const guardStart = fn.indexOf('  -- 084: guarda');
  const performStart = fn.indexOf('    PERFORM public.enqueue_marketing_event(', guardStart);
  const endIf = fn.indexOf('\n  END IF;', performStart);
  assert.ok(guardStart > 0 && performStart > guardStart && endIf > performStart, 'guarda da captura fora do formato');
  return fn.slice(0, guardStart) + dedent(fn.slice(performStart, endIf)) + fn.slice(endIf + '\n  END IF;'.length);
};

// Desfaz o bloco EXCEPTION do gatilho do mesmo jeito.
const withoutQueueGuard = (fn: string): string => {
  const guardStart = fn.indexOf('  -- 084: guarda');
  const performStart = fn.indexOf('    PERFORM public.enqueue_marketing_deal_event(', guardStart);
  const handler = fn.indexOf('\n  EXCEPTION WHEN others THEN', performStart);
  const blockEnd = fn.indexOf('\n  END;', handler);
  assert.ok(guardStart > 0 && performStart > guardStart && handler > performStart && blockEnd > handler,
    'bloco EXCEPTION do gatilho fora do formato');
  return fn.slice(0, guardStart) + dedent(fn.slice(performStart, handler)) + fn.slice(blockEnd + '\n  END;'.length);
};

test('migration é transacional, com lock_timeout e sem DROP', () => {
  assert.match(sql, /^BEGIN;$/m);
  assert.match(sql, /COMMIT;\s*$/);
  assert.match(sql, /SET LOCAL lock_timeout = '5s';/);
  assert.doesNotMatch(sql, /\bDROP\s+(FUNCTION|TRIGGER|TABLE|INDEX)/i);
  assert.equal(sql.match(/CREATE OR REPLACE FUNCTION/g)?.length, 2, 'só as duas funções guardadas');
});

test('checagem de drift aceita o md5 de produção ou o marcador 084 e vem antes de qualquer CREATE', () => {
  const checks: Array<[string, string, string]> = [
    ['capture_marketing_whatsapp_contact', CAPTURE_MD5,
      "'public.capture_marketing_whatsapp_contact(uuid,text,text,text,text,timestamptz,text,text,jsonb)'::regprocedure"],
    ['queue_mapped_stage_conversions', QUEUE_MD5, "'public.queue_mapped_stage_conversions()'::regprocedure"],
  ];
  const firstCreate = sql.indexOf('CREATE OR REPLACE FUNCTION');
  for (const [name, hash, regproc] of checks) {
    const raise = sql.indexOf(`RAISE EXCEPTION 'drift: ${name} mudou'`);
    assert.ok(raise > 0 && raise < firstCreate, `drift de ${name} precisa rodar antes dos CREATE`);
    const block = sql.slice(sql.lastIndexOf('DO $$', raise), raise);
    assert.ok(block.replace(/\s+/g, '').includes(`pg_get_functiondef(${regproc})`),
      `drift de ${name} lê o corpo pelo regprocedure exato`);
    assert.match(block, new RegExp(`IF md5\\(body\\) <> '${hash}'\\s+AND position\\('084: guarda' in body\\) = 0 THEN`));
  }
});

test('md5 esperado é o do corpo da 074 com o cabeçalho de produção', () => {
  for (const [name, hash] of [[CAPTURE, CAPTURE_MD5], [QUEUE, QUEUE_MD5]] as const) {
    const def = `${PROD_HEADERS[name]}AS $function$${prosrc(functionSql(base, name))}$function$\n`;
    assert.equal(md5(def), hash, `${name}: a 074 deixou de bater com produção`);
  }
});

test('captura: guarda NOT EXISTS do Contact imediatamente antes do PERFORM enqueue_marketing_event', () => {
  const fn = functionSql(sql, CAPTURE);
  assert.match(fn, /-- 084: guarda de idempotência/);
  assert.match(
    fn,
    /IF NOT EXISTS \(\s*SELECT 1\s+FROM public\.marketing_conversion_facts AS fact\s+WHERE fact\.user_id = contact_touchpoint\.user_id\s+AND fact\.marketing_site_id = contact_touchpoint\.marketing_site_id\s+AND fact\.event_id = concat\('lead:', contact_touchpoint\.lead_id, ':contact'\)\s*\) THEN\s*PERFORM public\.enqueue_marketing_event\(/,
  );
  assert.equal(fn.match(/PERFORM public\.enqueue_marketing_event\(/g)?.length, 1);
  assert.match(fn, /contact_touchpoint\.phone,\s+NULL\s+\);\s+END IF;/);
});

test('gatilho: EXCEPTION envolve só o PERFORM enqueue_marketing_deal_event e relança os outros erros', () => {
  const fn = functionSql(sql, QUEUE);
  assert.match(fn, /-- 084: guarda/);
  const inner = fn.match(/\n {2}BEGIN\n([\s\S]*?)\n {2}EXCEPTION WHEN others THEN/)?.[1] ?? '';
  assert.match(inner, /^\s*PERFORM public\.enqueue_marketing_deal_event\([^;]*\);\s*$/, 'o bloco só pode ter o PERFORM');
  assert.match(
    fn,
    /EXCEPTION WHEN others THEN\s+IF SQLERRM NOT LIKE '%MARKETING_FACT_IDEMPOTENCY_CONFLICT%' THEN\s+RAISE;\s+END IF;\s+RAISE WARNING '084: guarda de idempotência ignorou conflito do deal %', new\.id;\s+END;\s+RETURN new;/,
  );
});

test('diff em relação a produção é só a guarda e o bloco EXCEPTION', () => {
  assert.equal(withoutCaptureGuard(functionSql(sql, CAPTURE)), functionSql(base, CAPTURE));
  assert.equal(withoutQueueGuard(functionSql(sql, QUEUE)), functionSql(base, QUEUE));
});

test('SECURITY DEFINER, search_path e privilégios iguais aos de produção', () => {
  for (const name of [CAPTURE, QUEUE]) {
    const fn = functionSql(sql, name);
    assert.match(fn, /\nLANGUAGE plpgsql\nSECURITY DEFINER\nSET search_path = pg_catalog, public, pg_temp\nAS \$\$/);
  }
  const acl = (source: string): string[] => source.match(
    /(?:REVOKE|GRANT) [A-Z ]+ON FUNCTION public\.capture_marketing_whatsapp_contact\([\s\S]+?\) (?:FROM|TO) [^;]+;/g,
  ) ?? [];
  assert.deepEqual(acl(sql), acl(base));
  assert.equal(acl(sql).length, 2);
  assert.doesNotMatch(sql, /(?:REVOKE|GRANT) [A-Z, ]+ON FUNCTION public\.queue_mapped_stage_conversions/);
});

test('não recria enqueue_marketing_event nem enqueue_marketing_deal_event', () => {
  assert.doesNotMatch(sql, /CREATE (?:OR REPLACE )?FUNCTION public\.enqueue_marketing_event\b/i);
  assert.doesNotMatch(sql, /CREATE (?:OR REPLACE )?FUNCTION public\.enqueue_marketing_deal_event\b/i);
});

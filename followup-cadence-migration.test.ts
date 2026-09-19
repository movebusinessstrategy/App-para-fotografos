import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { brazilianPhoneVariants, canonicalPhoneKey } from './lib/br-phone.js';
import {
  CADENCE_STATUSES,
  CUSTOMER_NON_TURN_TYPES,
  DEFAULT_FOLLOWUP_CONFIG,
  DEFAULT_PRE_QUOTE_DELAYS_HOURS,
  LIVE_CADENCE_STATUSES,
  RETENTION_DAYS,
  STUDIO_NON_TURN_TYPES,
  WARMUP_DAILY_CAP,
  WARMUP_DAYS,
} from './src/features/followups/types.js';

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');

const raw = read('./migrations/083_followup_cadence.sql');
// O rollback manual mora em comentário; sem os comentários sobra só o que executa.
const sql = raw.replace(/--[^\n]*/g, '');
const fixtures = read('./scripts/followup-migration-gate-fixtures.sql');
const stubs = read('./scripts/followup-migration-gate-stubs.sql');
const gate = read('./scripts/followup-migration-gate.sh');

const DATA_FUNCTIONS = [
  'followup_customer_phone_keys(uuid)',
  'followup_cadence_candidates(uuid, text[], text[], integer, integer)',
  'claim_cadence_followup(uuid, text, integer, integer, timestamptz)',
  'followup_cadence_retention(uuid, integer)',
];

const escapeRe = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const between = (source: string, start: string, end: string): string => {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `trecho "${start}" deve existir`);
  const to = source.indexOf(end, from + start.length);
  assert.notEqual(to, -1, `trecho "${end}" deve vir depois de "${start}"`);
  return source.slice(from, to);
};

const functionSql = (name: string): string => {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  assert.notEqual(start, -1, `${name} deve existir`);
  const bodyStart = sql.indexOf('AS $$', start);
  const end = sql.indexOf('$$;', bodyStart + 5);
  assert.ok(bodyStart > start && end > bodyStart, `${name} deve ter corpo $$ ... $$;`);
  return sql.slice(start, end + 3);
};

// Subconsulta do LEFT JOIN LATERAL que termina em ") <alias> ON true".
const lateral = (body: string, alias: string): string => {
  const end = body.indexOf(`) ${alias} ON true`);
  assert.notEqual(end, -1, `lateral ${alias} deve existir`);
  const start = body.lastIndexOf('LEFT JOIN LATERAL (', end);
  assert.notEqual(start, -1, `lateral ${alias} deve abrir com LEFT JOIN LATERAL`);
  return body.slice(start, end);
};

const sqlArray = (fragment: string): string[] => {
  const match = fragment.match(/<> ALL \(ARRAY\[([^\]]*)\]\)/);
  assert.ok(match, 'lista de tipos deve existir');
  return match[1].split(',').map((item) => item.trim().replace(/^'|'$/g, ''));
};

const braces = (literal: string): string[] => {
  const inner = literal.replace(/^'\{|\}'$/g, '');
  return inner ? inner.split(',') : [];
};

// Decodifica o literal DEFAULT de cada tipo de coluna da config.
const DECODERS: Record<string, (literal: string) => unknown> = {
  boolean: (literal) => literal === 'true',
  integer: (literal) => Number(literal),
  text: (literal) => literal.replace(/^'|'$/g, ''),
  jsonb: (literal) => JSON.parse(literal.replace(/::jsonb$/, '').replace(/^'|'$/g, '')),
  'integer[]': (literal) => braces(literal.replace(/::integer\[\]$/, '')).map(Number),
  'text[]': (literal) => braces(literal.replace(/::text\[\]$/, '')),
};

const configColumns = (): Map<string, { type: string; literal: string | null }> => {
  const body = between(sql, 'CREATE TABLE IF NOT EXISTS public.followup_cadence_config (', '\n);');
  const columns = new Map<string, { type: string; literal: string | null }>();
  for (const line of body.split('\n')) {
    const match = line.match(/^ {2}(\w+) ([\w[\]]+)(?: NOT NULL)?(?: DEFAULT (.+?))?,?$/);
    if (match && match[1] !== 'CONSTRAINT') columns.set(match[1], { type: match[2], literal: match[3] ?? null });
  }
  return columns;
};

test('migration é transacional, aditiva e documenta o rollback só em comentário', () => {
  assert.match(sql, /^BEGIN;/m);
  assert.match(sql, /COMMIT;\s*$/);
  assert.match(sql, /SET LOCAL lock_timeout = '5s';/);
  assert.match(sql, /SET LOCAL statement_timeout = '120s';/);
  assert.doesNotMatch(sql, /DROP TABLE/i);
  assert.doesNotMatch(sql, /DROP COLUMN/i);
  assert.doesNotMatch(sql, /DROP FUNCTION/i);
  assert.doesNotMatch(sql, /DROP INDEX/i);

  const rollback = raw.slice(raw.indexOf('Rollback manual'));
  const order = [
    'DROP FUNCTION IF EXISTS public.followup_cadence_retention',
    'DROP TABLE IF EXISTS public.followup_cadence_config',
    'DROP INDEX IF EXISTS public.scheduled_followups_cadence_live_deal_uidx',
    'DROP COLUMN IF EXISTS phone_key',
    'DROP FUNCTION IF EXISTS public.followup_phone_variants',
    'DROP FUNCTION IF EXISTS public.followup_phone_key',
  ].map((step) => rollback.indexOf(step));
  order.forEach((position) => assert.notEqual(position, -1));
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'rollback na ordem: funções, tabelas, índices, coluna gerada, chave');
});

test('scheduled_followups ganha colunas de cadência e phone_key gerada', () => {
  [
    'attempts integer NOT NULL DEFAULT 0',
    "kind text NOT NULL DEFAULT 'legacy'",
    'step smallint',
    'basis_at timestamptz',
    'basis_message_id text',
    'draft_text text',
    'approved_at timestamptz',
    'approved_by text',
    'claimed_at timestamptz',
    'claimed_by text',
    'lease_expires_at timestamptz',
    'channel_used text',
    'sent_message_id text',
    'last_error text',
    "generation_meta jsonb NOT NULL DEFAULT '{}'::jsonb",
    'updated_at timestamptz NOT NULL DEFAULT now()',
    "track text NOT NULL DEFAULT 'ladder'",
  ].forEach((column) => assert.match(sql, new RegExp(`ADD COLUMN IF NOT EXISTS ${escapeRe(column)},`)));
  assert.match(sql, /ADD COLUMN IF NOT EXISTS phone_key text GENERATED ALWAYS AS \(public\.followup_phone_key\(phone\)\) STORED;/);
  assert.match(sql, /COMMENT ON COLUMN public\.scheduled_followups\.phone_key IS\s+'[^']*nunca gravar/);
});

test('CHECKs de scheduled_followups: forma da cadência sem pending/processing', () => {
  const shape = between(sql, 'ADD CONSTRAINT scheduled_followups_cadence_shape_check',
    'DROP CONSTRAINT IF EXISTS scheduled_followups_channel_used_check');
  assert.doesNotMatch(shape, /pending/);
  assert.doesNotMatch(shape, /processing/);
  CADENCE_STATUSES.forEach((status) => assert.match(shape, new RegExp(`'${status}'`)));
  ['status IS NOT NULL', 'step IS NOT NULL AND step BETWEEN 1 AND 4', 'basis_at IS NOT NULL',
    "jsonb_typeof(generation_meta) = 'object'", "(status <> 'approved' OR approved_at IS NOT NULL)"]
    .forEach((clause) => assert.ok(shape.includes(clause), clause));

  assert.match(sql, /scheduled_followups_kind_check CHECK \(kind IN \('legacy', 'cadence'\)\)/);
  assert.match(sql, /channel_used IS NULL OR channel_used IN \('meta_text', 'baileys', 'meta_template'\)/);
  for (const name of ['kind_check', 'cadence_shape_check', 'channel_used_check']) {
    assert.match(sql, new RegExp(`DROP CONSTRAINT IF EXISTS scheduled_followups_${name},\\s+ADD CONSTRAINT scheduled_followups_${name}`));
  }
});

test('índices únicos parciais: episódio por deal e por telefone, vivas incluem blocked', () => {
  const live = `WHERE kind = 'cadence' AND status IN (${LIVE_CADENCE_STATUSES.map((s) => `'${s}'`).join(', ')});`;
  assert.ok(live.includes("'blocked'"));
  const unique: Array<[string, string, string]> = [
    ['scheduled_followups_cadence_live_deal_uidx', '(user_id, deal_id)', live],
    ['scheduled_followups_cadence_live_phone_uidx', '(user_id, phone_key)', live],
    ['scheduled_followups_cadence_episode_uidx', '(user_id, deal_id, track, step, basis_at)', "WHERE kind = 'cadence';"],
    ['scheduled_followups_cadence_phone_episode_uidx', '(user_id, phone_key, track, basis_at)', "WHERE kind = 'cadence';"],
  ];
  for (const [name, columns, where] of unique) {
    assert.match(sql, new RegExp(
      `CREATE UNIQUE INDEX IF NOT EXISTS ${name}\\s+ON public\\.scheduled_followups ${escapeRe(columns)}\\s+${escapeRe(where)}`,
    ), name);
  }
  const indexes = sql.match(/CREATE (?:UNIQUE )?INDEX[^\n]*/g) ?? [];
  assert.ok(indexes.length >= 14);
  indexes.forEach((line) => assert.match(line, /INDEX IF NOT EXISTS /, line));
  assert.match(sql, /whatsapp_webhook_inbox_status_timeline_idx\s+ON public\.whatsapp_webhook_inbox \(user_id, received_at DESC\)\s+WHERE \(payload ->> 'kind'\) = 'status';/);
  assert.match(sql, /whatsapp_webhook_inbox_unprocessed_idx\s+ON public\.whatsapp_webhook_inbox \(user_id, received_at DESC\)\s+WHERE status <> 'processed';/);
  assert.match(sql, /followup_optouts_active_uidx\s+ON public\.followup_optouts \(user_id, phone_key\)\s+WHERE revoked_at IS NULL;/);
});

test('funções de dados: SECURITY DEFINER, search_path fixo e EXECUTE só para service_role', () => {
  assert.equal(sql.match(/SECURITY DEFINER/g)?.length, DATA_FUNCTIONS.length);
  for (const signature of DATA_FUNCTIONS) {
    const name = signature.slice(0, signature.indexOf('('));
    const header = functionSql(name).slice(0, functionSql(name).indexOf('AS $$'));
    assert.match(header, /SECURITY DEFINER SET search_path = public, pg_temp/, name);
    assert.match(sql, new RegExp(`REVOKE ALL ON FUNCTION public\\.${escapeRe(signature)} FROM PUBLIC, anon, authenticated;`), name);
    assert.match(sql, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${escapeRe(signature)} TO service_role;`), name);
  }
  assert.doesNotMatch(sql, /TO authenticated/);
  assert.doesNotMatch(sql, /TO anon/);
  assert.doesNotMatch(sql, /TO PUBLIC/i);
});

test('tabelas novas: FK para auth.users com cascata e RLS só de leitura', () => {
  for (const table of ['followup_cadence_config', 'followup_optouts']) {
    const body = between(sql, `CREATE TABLE IF NOT EXISTS public.${table} (`, '\n);');
    assert.match(body, /user_id uuid (?:NOT NULL |PRIMARY KEY )?REFERENCES auth\.users\(id\) ON DELETE CASCADE/, table);
    assert.match(sql, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY;`), table);
    assert.match(sql, new RegExp(`DROP POLICY IF EXISTS ${table}_select_own ON public\\.${table};`), table);
  }
  const policies = [...sql.matchAll(/CREATE POLICY (\w+) ON public\.(\w+)\s+FOR (\w+)/g)];
  assert.deepEqual(policies.map((p) => p[2]).sort(), ['followup_cadence_config', 'followup_optouts']);
  policies.forEach((p) => assert.equal(p[3], 'SELECT', p[1]));
  assert.equal(sql.match(/CREATE POLICY/g)?.length, policies.length, 'toda policy é FOR SELECT');
  assert.match(sql, /followup_optouts_kind_check CHECK \(kind IN \('hard', 'soft', 'manual'\)\)/);
  assert.match(sql, /followup_optouts_phone_key_check CHECK \(phone_key ~ '\^\[0-9\]\{8,15\}\$'\)/);
});

test('defaults da config batem com DEFAULT_FOLLOWUP_CONFIG e ficam desligados', () => {
  const columns = configColumns();
  const expected = DEFAULT_FOLLOWUP_CONFIG as unknown as Record<string, unknown>;
  for (const key of Object.keys(expected).filter((k) => k !== 'tracker_config')) {
    const column = columns.get(key);
    assert.ok(column, `coluna ${key} deve existir`);
    if (expected[key] === null) {
      assert.equal(column.literal, null, `${key} não tem DEFAULT (null no TS)`);
      continue;
    }
    const decode = DECODERS[column.type];
    assert.ok(decode, `tipo ${column.type} sem decodificador`);
    assert.deepEqual(decode(column.literal ?? ''), expected[key], key);
  }
  assert.equal(columns.get('tracker_config')?.literal, "'{}'::jsonb", 'tracker_config vazio = defaults do TS');
  assert.deepEqual(DECODERS.jsonb(columns.get('business_hours')?.literal ?? '').holidays, []);
  ['enabled', 'allow_baileys', 'tracker_enabled'].forEach((key) => assert.equal(columns.get(key)?.literal, 'false', key));
  assert.equal(columns.get('mode')?.literal, "'approval'");
});

test('tipos que não são turno batem com STUDIO_NON_TURN_TYPES e CUSTOMER_NON_TURN_TYPES', () => {
  const candidates = functionSql('followup_cadence_candidates');
  const studio = lateral(candidates, 'ls');
  const customer = lateral(candidates, 'lc');
  assert.deepEqual(sqlArray(studio), [...STUDIO_NON_TURN_TYPES]);
  assert.deepEqual(sqlArray(customer), [...CUSTOMER_NON_TURN_TYPES]);
  assert.match(studio, /m\.from_me IS TRUE/);
  assert.match(studio, /p_wa_numbers IS NULL OR m\.wa_number = ANY \(p_wa_numbers\)/);
  assert.match(studio, /coalesce\(m\.status, ''\) <> 'failed'/);
  assert.match(customer, /m\.from_me IS NOT TRUE/);
  assert.doesNotMatch(customer, /p_wa_numbers/, 'fala do cliente conta em qualquer número');
  assert.match(lateral(candidates, 'lf'), /f\.kind = 'legacy' AND f\.status = 'sent'/);
  assert.match(lateral(candidates, 'lr'), /m\.type = 'reaction'/);
  assert.match(candidates, /FILTER \(WHERE i\.payload #>> '\{status,status\}' = 'sent'\) AS sent_at/);
  assert.match(candidates, /interval '120 seconds'/);
  assert.match(candidates, /NOT EXISTS \(SELECT 1 FROM public\.wa_messages m WHERE m\.user_id = p_user_id AND m\.message_id = im\.wamid\)/);
});

test('claim e retenção seguem as constantes de types.ts', () => {
  const claim = functionSql('claim_cadence_followup');
  ['prev_status', 'prev_claimed_at', "f.kind = 'legacy'", `interval '${WARMUP_DAYS} days'`,
    `least(cfg.daily_cap, ${WARMUP_DAILY_CAP})`, 'greatest(p_gap_seconds, cfg.min_gap_seconds)']
    .forEach((fragment) => assert.ok(claim.includes(fragment), fragment));
  assert.equal(claim.match(/FOR UPDATE SKIP LOCKED/g)?.length, 2, 'trava a config e a tarefa');
  assert.match(claim, /RETURNS SETOF public\.scheduled_followups/);

  const retention = functionSql('followup_cadence_retention');
  assert.match(retention, new RegExp(`p_days integer DEFAULT ${RETENTION_DAYS}`));
  assert.match(retention, /greatest\(p_days, 30\)/);
  assert.match(retention, /generation_meta - 'context_tail'/);
  assert.match(retention, /f\.status IN \('sent', 'skipped', 'cancelled', 'failed'\)/);
});

test('vetores de telefone das fixtures SQL batem com lib/br-phone.ts', () => {
  const block = between(fixtures, '-- phone-vectors:begin', '-- phone-vectors:end');
  const vectors = [...block.matchAll(/\('([^']*)', '([^']*)', '\{([^}]*)\}'\)/g)];
  assert.ok(vectors.length >= 10, 'vetores suficientes');
  for (const [, input, key, variants] of vectors) {
    assert.equal(canonicalPhoneKey(input), key, `chave de ${input}`);
    assert.deepEqual([...brazilianPhoneVariants(input)].sort(), variants.split(',').sort(), `variantes de ${input}`);
  }
});

test('gate: stubs e fixtures só rodam no banco de ensaio; a 083 é aplicada duas vezes', () => {
  assert.match(gate, /^set -eu$/m);
  assert.match(gate, /ON_ERROR_STOP=1/);
  const steps = [...gate.matchAll(/^run_sql "\$ROOT\/([^"]+)"$/gm)].map((m) => m[1]);
  assert.deepEqual(steps, [
    'scripts/followup-migration-gate-stubs.sql',
    'migrations/083_followup_cadence.sql',
    'migrations/083_followup_cadence.sql',
    'scripts/followup-migration-gate-fixtures.sql',
  ]);
  assert.match(gate, /echo 'gate 083 ok'/);
  assert.match(stubs, /RAISE EXCEPTION 'stubs do gate 083/);
  assert.match(stubs, /ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;/);
  assert.match(fixtures, /RAISE EXCEPTION 'fixtures do gate 083/);
  assert.match(fixtures, /ROLLBACK;\s*$/);
});

test('trilha antes do orçamento: track com CHECK, toque 1 ou 2 e config com etapas fora da escada', () => {
  assert.match(sql, /ADD CONSTRAINT scheduled_followups_track_check CHECK \(track IN \('ladder', 'pre_quote'\) AND \(kind = 'cadence' OR track = 'ladder'\)\);/);
  const shape = between(sql, 'ADD CONSTRAINT scheduled_followups_cadence_shape_check', 'DROP CONSTRAINT IF EXISTS scheduled_followups_channel_used_check');
  assert.match(shape, /\(track <> 'pre_quote' OR step BETWEEN 1 AND 2\)/);
  const columns = configColumns();
  assert.equal(columns.get('pre_quote_stage_ids')?.literal, "'{}'::text[]", 'desligada por padrão');
  assert.deepEqual(DECODERS['integer[]'](columns.get('pre_quote_delays_hours')?.literal ?? ''), [...DEFAULT_PRE_QUOTE_DELAYS_HOURS]);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS pre_quote_stage_ids text\[\] NOT NULL DEFAULT '\{\}'::text\[\],/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS pre_quote_delays_hours integer\[\] NOT NULL DEFAULT '\{24,72\}'::integer\[\],/);
  assert.match(sql, /cardinality\(pre_quote_stage_ids\) <= 2 AND array_position\(pre_quote_stage_ids, NULL\) IS NULL\s+AND NOT \(pre_quote_stage_ids && ladder_stage_ids\)/);
  assert.match(sql, /cardinality\(pre_quote_delays_hours\) BETWEEN 1 AND 2/);
  assert.match(fixtures, /-- 9\. Trilha antes do orçamento/);
});

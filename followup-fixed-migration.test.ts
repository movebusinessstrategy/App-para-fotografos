import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { FIXED_MESSAGES_MAX, PRE_QUOTE_MAX_STAGES, PRE_QUOTE_MAX_STEPS } from './src/features/followups/types.js';

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');
const raw = read('./migrations/087_followup_fixed_messages.sql');
// O rollback manual mora em comentário; sem os comentários sobra só o que executa.
const sql = raw.replace(/--[^\n]*/g, '');
const base = read('./migrations/083_followup_cadence.sql').replace(/--[^\n]*/g, '');
const squash = (text: string): string => text.replace(/\s+/g, ' ').trim();
const DASH_PATTERN = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);

function shapeOf(source: string, end: string): string {
  const start = source.indexOf('ADD CONSTRAINT scheduled_followups_cadence_shape_check');
  assert.notEqual(start, -1, 'CHECK de forma presente');
  return squash(source.slice(start, source.indexOf(end, start)));
}

test('087: transacional, idempotente e só aditiva', () => {
  assert.match(sql, /^BEGIN;/m);
  assert.match(sql, /COMMIT;\s*$/);
  assert.match(sql, /SET LOCAL lock_timeout = '5s';/);
  assert.doesNotMatch(sql, /DROP TABLE|DROP COLUMN|DROP FUNCTION|DELETE FROM|UPDATE public\./i);
  for (const name of ['followup_cadence_config_message_mode_check', 'followup_cadence_config_fixed_messages_check',
    'followup_cadence_config_pre_quote_delays_check', 'scheduled_followups_cadence_shape_check']) {
    assert.match(sql, new RegExp(`DROP CONSTRAINT IF EXISTS ${name},\\s+ADD CONSTRAINT ${name}`), name);
  }
  assert.ok(!DASH_PATTERN.test(raw), 'sem travessão');
});

test('087: message_mode (ai ou fixed) e até 4 mensagens fixas sem NULL', () => {
  assert.match(sql, /ADD COLUMN IF NOT EXISTS message_mode text NOT NULL DEFAULT 'ai',/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS fixed_messages text\[\] NOT NULL DEFAULT '\{\}'::text\[\],/);
  assert.match(sql, /CHECK \(message_mode IN \('ai', 'fixed'\)\)/);
  assert.match(sql, new RegExp(`CHECK \\(cardinality\\(fixed_messages\\) <= ${FIXED_MESSAGES_MAX} AND array_position\\(fixed_messages, NULL\\) IS NULL\\)`));
});

test('087: trilha antes do orçamento vai até 3 toques; o CHECK de forma é o da 083 só com esse ajuste', () => {
  assert.equal(PRE_QUOTE_MAX_STEPS, 3);
  assert.equal(PRE_QUOTE_MAX_STAGES, 2, 'as etapas continuam no máximo 2 (CHECK da 083 intacto)');
  assert.match(sql, new RegExp(`cardinality\\(pre_quote_delays_hours\\) BETWEEN 1 AND ${PRE_QUOTE_MAX_STEPS}`));
  assert.match(sql, /1 <= ALL \(pre_quote_delays_hours\) AND 720 >= ALL \(pre_quote_delays_hours\)/);
  assert.doesNotMatch(sql, /followup_cadence_config_pre_quote_check/, 'o limite de etapas não muda');
  const before = shapeOf(base, 'DROP CONSTRAINT IF EXISTS scheduled_followups_channel_used_check').replace(/,$/, '');
  const after = shapeOf(sql, ';');
  assert.equal(after, before.replace("(track <> 'pre_quote' OR step BETWEEN 1 AND 2)", "(track <> 'pre_quote' OR step BETWEEN 1 AND 3)"));
  assert.ok(after.includes("(track <> 'pre_quote' OR step BETWEEN 1 AND 3)"));
});

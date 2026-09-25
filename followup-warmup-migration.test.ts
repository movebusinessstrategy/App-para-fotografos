import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync(new URL('./migrations/086_followup_warmup_only_qr.sql', import.meta.url), 'utf8');

test('086 recria só a função de claim, com a rampa condicionada ao QR', () => {
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.claim_cadence_followup/);
  assert.match(sql, /cap := CASE WHEN cfg\.allow_baileys AND cfg\.first_enabled_at IS NOT NULL/);
  assert.match(sql, /least\(cfg\.daily_cap, 10\) ELSE cfg\.daily_cap END/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.claim_cadence_followup\(uuid, text, integer, integer, timestamptz\) TO service_role/);
  assert.doesNotMatch(sql, /DROP|ALTER TABLE|DELETE|UPDATE public\.followup_cadence_config SET/i);
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync(new URL('./migrations/073_financial_reconciliation_v2.sql', import.meta.url), 'utf8');
const serverSource = readFileSync(new URL('./server.ts', import.meta.url), 'utf8');
const dashboardSource = readFileSync(
  new URL('./src/components/financeiro/VisaoGeral.tsx', import.meta.url),
  'utf8',
);

const functionBody = (name: string): string => {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION ${name}`);
  assert.notEqual(start, -1, `${name} deve existir`);
  const end = sql.indexOf('\n$$;', start);
  assert.notEqual(end, -1, `${name} deve terminar com $$;`);
  return sql.slice(start, end + 4);
};

test('migration explicita RLS e valida ownership dos vínculos OFX', () => {
  assert.match(sql, /ALTER TABLE fin_transacoes_ofx ENABLE ROW LEVEL SECURITY;/);
  assert.match(sql, /CREATE POLICY fin_transacoes_ofx_user\s+ON fin_transacoes_ofx\s+FOR SELECT/);
  assert.match(sql, /receita_id IS NULL OR fin_owned_revenue\(auth\.uid\(\)::text, receita_id\)/);
  assert.match(sql, /despesa_id IS NULL OR fin_owned_expense\(auth\.uid\(\)::text, despesa_id\)/);
  assert.match(sql, /importacao_id IS NULL OR fin_owned_import_batch\(auth\.uid\(\)::text, importacao_id, conta_id\)/);
  assert.match(functionBody('fin_owned_revenue'), /auth\.uid\(\)::text = p_user_id/);
  assert.match(functionBody('fin_owned_job_payment_ref'), /job\.user_id::text = p_user_id/);
  assert.match(sql, /REVOKE INSERT, UPDATE, DELETE ON fin_transacoes_ofx FROM authenticated;/);
  assert.match(sql, /CREATE TRIGGER trg_fin_guard_revenue_references/);
  assert.match(sql, /CREATE TRIGGER trg_fin_guard_expense_references/);
});

test('RPCs críticas são SECURITY DEFINER, usam search_path e aceitam server role', () => {
  const rpcNames = [
    'fin_reconcile_ofx_transaction',
    'fin_unreconcile_ofx_transaction',
    'fin_set_ofx_transfer_pair',
    'fin_unset_ofx_transfer_pair',
    'fin_apply_processor_settlement',
    'fin_undo_processor_settlement',
    'fin_import_ofx_batch_v2',
    'fin_rollback_ofx_import_batch',
    'fin_setup_infinitepay',
  ];
  rpcNames.forEach((name) => {
    const body = functionBody(name);
    assert.match(body, /SECURITY DEFINER/);
    assert.match(body, /SET search_path = pg_catalog, public, pg_temp/);
    assert.match(body, /fin_assert_request_user\(p_user_id\)/);
    assert.match(sql, new RegExp(`GRANT EXECUTE ON FUNCTION ${name}\\([^;]+\\) TO service_role;`));
  });
  assert.match(functionBody('fin_assert_request_user'), /auth\.role\(\) = 'service_role'/);
});

test('importação é auditável, corrige legado por igualdade imutável e não apaga fatos bancários', () => {
  const body = functionBody('fin_import_ofx_batch_v2');
  assert.match(sql, /REVOKE ALL ON FUNCTION fin_import_ofx_batch_v2\([^;]+\) FROM authenticated;/);
  assert.doesNotMatch(sql, /GRANT EXECUTE ON FUNCTION fin_import_ofx_batch_v2\([^;]+\) TO authenticated;/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION fin_import_ofx_batch_v2\([^;]+\) TO service_role;/);
  assert.match(body, /LEGACY_ACCOUNT_CORRECTION_CONFIRMATION_REQUIRED/);
  assert.match(body, /round\(source_tx\.valor \* 100\)/);
  assert.match(body, /source_tx\.data IS DISTINCT FROM/);
  assert.match(body, /legacy_balance_snapshots_archived/);
  assert.match(body, /LEGACY_ACCOUNT_CORRECTION_PREVIEW_STALE/);
  assert.match(body, /digest\(/);
  assert.match(body, /saldo_extrato_em < p_balance_date/);
  assert.match(body, /jsonb_array_length\(p_rows\) > 20000/);
  assert.match(sql, /legacy_receita_conflict/);
  assert.match(sql, /legacy_despesa_conflict/);
  assert.doesNotMatch(sql, /DELETE\s+FROM\s+fin_transacoes_ofx/i);
});

test('legado é adotado por conta e minuto e rollback apenas arquiva linhas seguras', () => {
  assert.match(sql, /legacy:' \|\| tx\.conta_id::text/);
  assert.match(sql, /date_trunc\('minute'/);
  assert.match(sql, /legacy_identity_unconfirmed/);
  const rollback = functionBody('fin_rollback_ofx_import_batch');
  assert.match(rollback, /revertido_em = now\(\)/);
  assert.match(rollback, /fin_conciliacao_alocacoes/);
  assert.match(rollback, /status_conciliacao IN \('transferencia', 'conciliado'\)/);
  assert.match(rollback, /p_expected_state JSONB/);
  assert.match(rollback, /ROLLBACK_PREVIEW_STALE/);
});

test('migration normaliza created_at antes de ler o histórico legado', () => {
  const createdAtGuard = sql.indexOf('ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ');
  const createdAtReady = sql.indexOf('ALTER COLUMN created_at SET NOT NULL');
  const firstCreatedAtRead = sql.indexOf('tx.created_at');
  assert.ok(createdAtGuard >= 0, 'created_at deve existir mesmo no schema legado');
  assert.ok(firstCreatedAtRead >= 0, 'a adoção deve ler created_at');
  assert.ok(createdAtGuard < firstCreatedAtRead, 'created_at deve existir antes da primeira leitura');
  assert.ok(createdAtReady < firstCreatedAtRead, 'created_at deve ser preenchida antes da primeira leitura');
  assert.match(sql, /SET created_at = coalesce\(\s*created_at,\s*importado_em,/);
  assert.match(sql, /ALTER COLUMN created_at SET DEFAULT now\(\),\s*ALTER COLUMN created_at SET NOT NULL/);
});

test('migration é transacional e tabelas auditáveis não aceitam escrita direta', () => {
  assert.match(sql, /^BEGIN;/m);
  assert.match(sql, /COMMIT;\s*$/);
  assert.match(sql, /REVOKE INSERT, UPDATE, DELETE ON fin_importacoes_extrato FROM authenticated, service_role;/);
  assert.match(sql, /REVOKE INSERT, UPDATE, DELETE ON fin_conciliacao_alocacoes FROM authenticated, service_role;/);
});

test('identidade bancária e configuração InfinitePay têm guardas no banco', () => {
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS uq_fin_contas_identidade_extrato/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS fin_contas_identidade_conflitos/);
  assert.match(sql, /CREATE TRIGGER trg_fin_guard_account_identity/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS conta_id UUID;/);
  const setup = functionBody('fin_setup_infinitepay');
  assert.match(setup, /'linkdepagamento'/);
  assert.match(setup, /conta_id = account\.id/);
});

test('grupo_dre_id é protegido por ownership e compatibilidade de tipo', () => {
  assert.match(sql, /CREATE TRIGGER trg_fin_guard_category_dre_link/);
  assert.match(sql, /DRE_GROUP_OWNERSHIP_MISMATCH/);
  assert.match(sql, /DRE_GROUP_TYPE_MISMATCH/);
  assert.match(sql, /CREATE TRIGGER trg_fin_guard_dre_group_type/);
});

test('API financeira mantém leitura no schema legado e encerra erros assíncronos', () => {
  assert.doesNotMatch(serverSource, /finMigrationMissing\(error, 'transferencia_par_id'\)/);
  assert.match(
    serverSource,
    /if \(finMigrationMissing\(error\)\) \{[\s\S]*?'conta_id,tipo,valor,data,descricao,status_conciliacao'/,
  );
  assert.match(serverSource, /async function finOptionalReceiptTransactions/);
  assert.match(serverSource, /'id,receita_id,revertido_em'[\s\S]*?'id,receita_id'/);
  ['contas', 'receitas', 'despesas', 'dashboard'].forEach((route) => {
    assert.ok(
      serverSource.includes(`app.get('/api/fin/${route}', requireAuth, finAsyncRoute(async`),
      `${route} deve encaminhar rejeições assíncronas ao Express`,
    );
  });
});

test('visão geral abandona requisição travada e oferece nova tentativa', () => {
  assert.match(dashboardSource, /const DASHBOARD_TIMEOUT_MS = 15_000/);
  assert.match(dashboardSource, /new AbortController\(\)/);
  assert.match(dashboardSource, /authFetch\('\/api\/fin\/dashboard', \{ signal: controller\.signal \}\)/);
  assert.match(dashboardSource, /demorou para responder\. Tente novamente\./);
  assert.match(dashboardSource, /> Tentar novamente\s*</);
});

-- Conciliação financeira v2: lotes auditáveis, fingerprints, sugestões seguras,
-- transferências internas e projeções idempotentes de pagamentos dos jobs.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION fin_normalize_identity_key(value TEXT)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT lower(regexp_replace(coalesce(value, ''), '[^[:alnum:]]', '', 'g'));
$$;

CREATE OR REPLACE FUNCTION fin_normalize_bank_key(value TEXT)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
PARALLEL SAFE
AS $$
  WITH normalized AS (
    SELECT fin_normalize_identity_key(value) AS compact
  )
  SELECT CASE
    WHEN compact ~ '^[0-9]+$' THEN coalesce(nullif(ltrim(compact, '0'), ''), '0')
    ELSE compact
  END
  FROM normalized;
$$;

CREATE OR REPLACE FUNCTION fin_is_balance_snapshot_text(value TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
PARALLEL SAFE
AS $$
  WITH normalized AS (
    SELECT regexp_replace(
      translate(
        upper(coalesce(value, '')),
        'ÁÀÃÂÄÉÈÊËÍÌÎÏÓÒÕÔÖÚÙÛÜÇÑ',
        'AAAAAEEEEIIIIOOOOOUUUUCN'
      ),
      '[^[:alnum:]]',
      '',
      'g'
    ) AS compact
  )
  SELECT compact ~ '^(SALDO($|TOTAL|ANTERIOR|EMCONTA|FINAL|INICIAL|ATUAL|DISPONIVEL|DODIA|DIA|CONTABIL|BLOQUEADO)|BALANCE($|TOTAL|AVAILABLE|CURRENT|OPENING|CLOSING|PREVIOUS|FORWARD|BROUGHTFORWARD|ACCOUNT|ASOF|END|BEGINNING))'
  FROM normalized;
$$;

CREATE TABLE IF NOT EXISTS fin_importacoes_extrato (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            TEXT NOT NULL,
  conta_id           UUID NOT NULL REFERENCES fin_contas(id) ON DELETE RESTRICT,
  nome_arquivo       TEXT NOT NULL,
  formato            TEXT NOT NULL DEFAULT 'ofx',
  hash_arquivo       TEXT NOT NULL,
  banco_codigo       TEXT,
  conta_ref          TEXT,
  data_inicio        DATE,
  data_fim           DATE,
  saldo_inicial      NUMERIC(14,2),
  saldo_final        NUMERIC(14,2),
  total_creditos     NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_debitos      NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_transacoes   INTEGER NOT NULL DEFAULT 0,
  status             TEXT NOT NULL DEFAULT 'processando',
  erro               TEXT,
  metadata           JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE fin_transacoes_ofx
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS trn_type TEXT,
  ADD COLUMN IF NOT EXISTS importacao_id UUID REFERENCES fin_importacoes_extrato(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS fingerprint TEXT,
  ADD COLUMN IF NOT EXISTS nome_contraparte TEXT,
  ADD COLUMN IF NOT EXISTS documento_contraparte TEXT,
  ADD COLUMN IF NOT EXISTS sugestao_tipo TEXT,
  ADD COLUMN IF NOT EXISTS sugestao_id TEXT,
  ADD COLUMN IF NOT EXISTS sugestao_score NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS sugestao_motivos JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS transferencia_par_id UUID REFERENCES fin_transacoes_ofx(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS revertido_em TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS revertido_motivo TEXT;

-- Algumas instalações antigas registram apenas `importado_em`. A v2 usa
-- `created_at` também ao adotar lotes e ao resolver vínculos duplicados, então
-- normaliza a coluna antes de qualquer leitura. O fallback pela data do
-- movimento é determinístico para instalações que não possuam nenhum timestamp.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'fin_transacoes_ofx'
      AND column_name = 'importado_em'
  ) THEN
    EXECUTE $backfill$
      UPDATE fin_transacoes_ofx
      SET created_at = coalesce(
        created_at,
        importado_em,
        data::timestamp AT TIME ZONE 'UTC',
        now()
      )
      WHERE created_at IS NULL
    $backfill$;
  ELSE
    UPDATE fin_transacoes_ofx
    SET created_at = coalesce(
      created_at,
      data::timestamp AT TIME ZONE 'UTC',
      now()
    )
    WHERE created_at IS NULL;
  END IF;
END;
$$;

ALTER TABLE fin_transacoes_ofx
  ALTER COLUMN created_at SET DEFAULT now(),
  ALTER COLUMN created_at SET NOT NULL;

ALTER TABLE fin_contas
  ADD COLUMN IF NOT EXISTS saldo_extrato NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS saldo_extrato_em DATE,
  ADD COLUMN IF NOT EXISTS banco_codigo TEXT,
  ADD COLUMN IF NOT EXISTS conta_ref TEXT,
  ADD COLUMN IF NOT EXISTS banco_codigo_normalizado TEXT
    GENERATED ALWAYS AS (fin_normalize_bank_key(banco_codigo)) STORED,
  ADD COLUMN IF NOT EXISTS conta_ref_normalizada TEXT
    GENERATED ALWAYS AS (fin_normalize_identity_key(conta_ref)) STORED,
  ADD COLUMN IF NOT EXISTS identidade_extrato_bloqueada BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE fin_meios
  ADD COLUMN IF NOT EXISTS conta_id UUID;
ALTER TABLE fin_meios
  DROP CONSTRAINT IF EXISTS fin_meios_conta_id_fkey;
ALTER TABLE fin_meios
  ADD CONSTRAINT fin_meios_conta_id_fkey
  FOREIGN KEY (conta_id) REFERENCES fin_contas(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS fin_contas_identidade_conflitos (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 TEXT NOT NULL,
  banco_codigo_normalizado TEXT NOT NULL,
  conta_ref_normalizada   TEXT NOT NULL,
  conta_ids               UUID[] NOT NULL,
  detected_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at             TIMESTAMPTZ,
  resolution_note         TEXT,
  UNIQUE (user_id, banco_codigo_normalizado, conta_ref_normalizada)
);

INSERT INTO fin_contas_identidade_conflitos (
  user_id,
  banco_codigo_normalizado,
  conta_ref_normalizada,
  conta_ids
)
SELECT
  user_id,
  banco_codigo_normalizado,
  conta_ref_normalizada,
  array_agg(id ORDER BY id)
FROM fin_contas
WHERE banco_codigo_normalizado <> ''
  AND conta_ref_normalizada <> ''
GROUP BY user_id, banco_codigo_normalizado, conta_ref_normalizada
HAVING count(*) > 1
ON CONFLICT (user_id, banco_codigo_normalizado, conta_ref_normalizada)
DO UPDATE SET
  conta_ids = EXCLUDED.conta_ids,
  detected_at = now(),
  resolved_at = NULL,
  resolution_note = NULL;

UPDATE fin_contas conta
SET identidade_extrato_bloqueada = true
FROM fin_contas_identidade_conflitos conflito
WHERE conflito.resolved_at IS NULL
  AND conflito.user_id = conta.user_id
  AND conflito.banco_codigo_normalizado = conta.banco_codigo_normalizado
  AND conflito.conta_ref_normalizada = conta.conta_ref_normalizada;

CREATE OR REPLACE FUNCTION fin_guard_account_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  next_bank TEXT := fin_normalize_bank_key(NEW.banco_codigo);
  next_account TEXT := fin_normalize_identity_key(NEW.conta_ref);
BEGIN
  IF next_bank = '' OR next_account = '' THEN
    RETURN NEW;
  END IF;
  IF NEW.identidade_extrato_bloqueada THEN
    IF EXISTS (
      SELECT 1
      FROM fin_contas_identidade_conflitos conflito
      WHERE conflito.user_id = NEW.user_id
        AND conflito.banco_codigo_normalizado = next_bank
        AND conflito.conta_ref_normalizada = next_account
        AND conflito.resolved_at IS NULL
        AND NEW.id = ANY(conflito.conta_ids)
    ) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'ACCOUNT_IDENTITY_BLOCK_FLAG_FORBIDDEN';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM fin_contas_identidade_conflitos conflito
    WHERE conflito.user_id = NEW.user_id
      AND conflito.banco_codigo_normalizado = next_bank
      AND conflito.conta_ref_normalizada = next_account
      AND conflito.resolved_at IS NULL
  ) OR EXISTS (
    SELECT 1
    FROM fin_contas conta
    WHERE conta.user_id = NEW.user_id
      AND conta.id <> NEW.id
      AND conta.banco_codigo_normalizado = next_bank
      AND conta.conta_ref_normalizada = next_account
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23505',
      MESSAGE = 'ACCOUNT_IDENTITY_CONFLICT';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fin_guard_account_identity ON fin_contas;
CREATE TRIGGER trg_fin_guard_account_identity
BEFORE INSERT OR UPDATE OF banco_codigo, conta_ref, identidade_extrato_bloqueada
ON fin_contas
FOR EACH ROW
EXECUTE FUNCTION fin_guard_account_identity();

-- Preserva o histórico: arquivar uma conta é preferível a apagar seus extratos.
ALTER TABLE fin_transacoes_ofx
  DROP CONSTRAINT IF EXISTS fin_transacoes_ofx_conta_id_fkey;
ALTER TABLE fin_transacoes_ofx
  ADD CONSTRAINT fin_transacoes_ofx_conta_id_fkey
  FOREIGN KEY (conta_id) REFERENCES fin_contas(id) ON DELETE RESTRICT;

ALTER TABLE fin_transacoes_ofx
  DROP CONSTRAINT IF EXISTS fin_transacoes_ofx_importacao_id_fkey;
ALTER TABLE fin_transacoes_ofx
  ADD CONSTRAINT fin_transacoes_ofx_importacao_id_fkey
  FOREIGN KEY (importacao_id) REFERENCES fin_importacoes_extrato(id) ON DELETE SET NULL;

ALTER TABLE fin_receitas
  ADD COLUMN IF NOT EXISTS origem_ref TEXT;

ALTER TABLE fin_despesas
  ADD COLUMN IF NOT EXISTS origem_ref TEXT;

CREATE TABLE IF NOT EXISTS fin_conciliacao_alocacoes (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            TEXT NOT NULL,
  transacao_id       UUID NOT NULL REFERENCES fin_transacoes_ofx(id) ON DELETE CASCADE,
  receita_id         UUID REFERENCES fin_receitas(id) ON DELETE RESTRICT,
  despesa_id         UUID REFERENCES fin_despesas(id) ON DELETE RESTRICT,
  job_payment_ref    TEXT,
  valor_alocado      NUMERIC(14,2) NOT NULL CHECK (valor_alocado > 0),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fin_conciliacao_alocacoes_destino_check
    CHECK (num_nonnulls(receita_id, despesa_id, job_payment_ref) = 1)
);

-- O mesmo arquivo na mesma conta é um único lote. Reenvio é idempotente.
CREATE UNIQUE INDEX IF NOT EXISTS uq_fin_importacoes_extrato_hash
  ON fin_importacoes_extrato(user_id, conta_id, hash_arquivo);

-- Adota o histórico anterior à v2 em lotes por minuto de importação. O banco
-- live possui dois envios separados por um minuto; mantê-los separados permite
-- sanear cada origem sem apagar ou realocar nada. `importado_em` existe em
-- algumas instalações legadas; nas demais, usa `created_at`.
DO $$
DECLARE
  imported_column TEXT;
BEGIN
  imported_column := CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'fin_transacoes_ofx'
      AND column_name = 'importado_em'
  ) THEN 'importado_em' ELSE 'created_at' END;

  EXECUTE format($adopt$
    INSERT INTO fin_importacoes_extrato (
      user_id, conta_id, nome_arquivo, formato, hash_arquivo,
      data_inicio, data_fim, total_creditos, total_debitos, total_transacoes,
      status, metadata
    )
    SELECT
      tx.user_id,
      tx.conta_id,
      'Extrato legado de ' || to_char(
        date_trunc('minute', coalesce(tx.%1$I, tx.created_at)),
        'DD/MM/YYYY HH24:MI'
      ),
      'legado',
      'legacy:' || tx.conta_id::text || ':' || to_char(
        date_trunc('minute', coalesce(tx.%1$I, tx.created_at)),
        'YYYYMMDDHH24MI'
      ),
      min(tx.data),
      max(tx.data),
      coalesce(sum(tx.valor) FILTER (WHERE tx.tipo = 'credito'), 0),
      coalesce(sum(tx.valor) FILTER (WHERE tx.tipo = 'debito'), 0),
      count(*)::integer,
      'concluida',
      jsonb_build_object(
        'legacy_adopted', true,
        'legacy_identity_unconfirmed', true,
        'adopted_at', now(),
        'imported_minute', date_trunc('minute', coalesce(tx.%1$I, tx.created_at)),
        'preserved_reconciled', count(*) FILTER (
          WHERE tx.receita_id IS NOT NULL OR tx.despesa_id IS NOT NULL
        ),
        'balance_snapshots', count(*) FILTER (WHERE fin_is_balance_snapshot_text(tx.descricao))
      )
    FROM fin_transacoes_ofx tx
    WHERE tx.importacao_id IS NULL
      AND tx.conta_id IS NOT NULL
    GROUP BY
      tx.user_id,
      tx.conta_id,
      date_trunc('minute', coalesce(tx.%1$I, tx.created_at))
    ON CONFLICT (user_id, conta_id, hash_arquivo)
    DO UPDATE SET
      data_inicio = EXCLUDED.data_inicio,
      data_fim = EXCLUDED.data_fim,
      total_creditos = EXCLUDED.total_creditos,
      total_debitos = EXCLUDED.total_debitos,
      total_transacoes = EXCLUDED.total_transacoes,
      metadata = fin_importacoes_extrato.metadata || EXCLUDED.metadata
  $adopt$, imported_column);

  EXECUTE format($link$
    UPDATE fin_transacoes_ofx tx
    SET importacao_id = lote.id,
        metadata = coalesce(tx.metadata, '{}'::jsonb) || jsonb_build_object(
          'legacy_adopted', true,
          'legacy_batch_id', lote.id,
          'legacy_identity_unconfirmed', true,
          'legacy_balance_snapshot', fin_is_balance_snapshot_text(tx.descricao)
        )
    FROM fin_importacoes_extrato lote
    WHERE tx.importacao_id IS NULL
      AND lote.user_id = tx.user_id
      AND lote.conta_id = tx.conta_id
      AND lote.hash_arquivo = 'legacy:' || tx.conta_id::text || ':' || to_char(
        date_trunc('minute', coalesce(tx.%1$I, tx.created_at)),
        'YYYYMMDDHH24MI'
      )
  $link$, imported_column);
END;
$$;

-- Mantém o UNIQUE legado (conta_id, fit_id) e cobre arquivos sem FITID.
CREATE UNIQUE INDEX IF NOT EXISTS uq_fin_ofx_fingerprint
  ON fin_transacoes_ofx(user_id, conta_id, fingerprint);

CREATE INDEX IF NOT EXISTS idx_fin_ofx_importacao
  ON fin_transacoes_ofx(user_id, importacao_id);

CREATE INDEX IF NOT EXISTS idx_fin_ofx_revisao
  ON fin_transacoes_ofx(user_id, status_conciliacao, data DESC);

CREATE INDEX IF NOT EXISTS idx_fin_ofx_transferencia_par
  ON fin_transacoes_ofx(transferencia_par_id)
  WHERE transferencia_par_id IS NOT NULL;

-- Uma receita/despesa só pode comprovar uma movimentação bancária. Caso o
-- legado tenha vínculos duplicados, preserva o conciliado mais antigo e devolve
-- os demais para revisão antes de ativar a proteção concorrente. O vínculo
-- retirado fica registrado na própria linha para auditoria e recuperação manual.
WITH ranked_receitas AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY user_id, receita_id
           ORDER BY (status_conciliacao = 'conciliado') DESC, created_at, id
         ) AS position
  FROM fin_transacoes_ofx
  WHERE receita_id IS NOT NULL
)
UPDATE fin_transacoes_ofx tx
SET receita_id = NULL,
    metadata = coalesce(tx.metadata, '{}'::jsonb) || jsonb_build_object(
      'legacy_receita_conflict', jsonb_build_object(
        'receita_id', tx.receita_id,
        'status_conciliacao', tx.status_conciliacao,
        'detached_at', now()
      )
    ),
    status_conciliacao = CASE
      WHEN tx.status_conciliacao = 'conciliado' THEN 'pendente'
      ELSE tx.status_conciliacao
    END,
    sugestao_tipo = NULL,
    sugestao_id = NULL,
    sugestao_score = NULL,
    sugestao_motivos = '[]'::jsonb
FROM ranked_receitas ranked
WHERE tx.id = ranked.id
  AND ranked.position > 1;

WITH ranked_despesas AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY user_id, despesa_id
           ORDER BY (status_conciliacao = 'conciliado') DESC, created_at, id
         ) AS position
  FROM fin_transacoes_ofx
  WHERE despesa_id IS NOT NULL
)
UPDATE fin_transacoes_ofx tx
SET despesa_id = NULL,
    metadata = coalesce(tx.metadata, '{}'::jsonb) || jsonb_build_object(
      'legacy_despesa_conflict', jsonb_build_object(
        'despesa_id', tx.despesa_id,
        'status_conciliacao', tx.status_conciliacao,
        'detached_at', now()
      )
    ),
    status_conciliacao = CASE
      WHEN tx.status_conciliacao = 'conciliado' THEN 'pendente'
      ELSE tx.status_conciliacao
    END,
    sugestao_tipo = NULL,
    sugestao_id = NULL,
    sugestao_score = NULL,
    sugestao_motivos = '[]'::jsonb
FROM ranked_despesas ranked
WHERE tx.id = ranked.id
  AND ranked.position > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_fin_ofx_receita
  ON fin_transacoes_ofx(user_id, receita_id)
  WHERE receita_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_fin_ofx_despesa
  ON fin_transacoes_ofx(user_id, despesa_id)
  WHERE despesa_id IS NOT NULL;

-- Índices completos funcionam com ON CONFLICT do PostgREST; NULL continua repetível.
CREATE UNIQUE INDEX IF NOT EXISTS uq_fin_receitas_origem_ref
  ON fin_receitas(user_id, origem_ref);

CREATE UNIQUE INDEX IF NOT EXISTS uq_fin_despesas_origem_ref
  ON fin_despesas(user_id, origem_ref);

CREATE UNIQUE INDEX IF NOT EXISTS uq_fin_contas_identidade_extrato
  ON fin_contas(user_id, banco_codigo_normalizado, conta_ref_normalizada)
  WHERE banco_codigo_normalizado <> ''
    AND conta_ref_normalizada <> ''
    AND identidade_extrato_bloqueada = false;

CREATE INDEX IF NOT EXISTS idx_fin_conciliacao_alocacoes_transacao
  ON fin_conciliacao_alocacoes(user_id, transacao_id);

CREATE INDEX IF NOT EXISTS idx_fin_conciliacao_alocacoes_receita
  ON fin_conciliacao_alocacoes(receita_id)
  WHERE receita_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_fin_conciliacao_alocacoes_despesa
  ON fin_conciliacao_alocacoes(despesa_id)
  WHERE despesa_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_fin_conciliacao_alocacoes_job_payment
  ON fin_conciliacao_alocacoes(user_id, job_payment_ref)
  WHERE job_payment_ref IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_fin_conciliacao_alocacao_receita
  ON fin_conciliacao_alocacoes(user_id, transacao_id, receita_id)
  WHERE receita_id IS NOT NULL;

-- Impede que dois créditos bancários concorrentes consumam o mesmo recebimento.
CREATE UNIQUE INDEX IF NOT EXISTS uq_fin_conciliacao_receita_destino
  ON fin_conciliacao_alocacoes(user_id, receita_id)
  WHERE receita_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_fin_conciliacao_alocacao_despesa
  ON fin_conciliacao_alocacoes(user_id, transacao_id, despesa_id)
  WHERE despesa_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_fin_conciliacao_despesa_destino
  ON fin_conciliacao_alocacoes(user_id, despesa_id)
  WHERE despesa_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_fin_conciliacao_alocacao_job_payment
  ON fin_conciliacao_alocacoes(user_id, transacao_id, job_payment_ref)
  WHERE job_payment_ref IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_fin_conciliacao_job_payment_destino
  ON fin_conciliacao_alocacoes(user_id, job_payment_ref)
  WHERE job_payment_ref IS NOT NULL;

CREATE OR REPLACE FUNCTION fin_owned_account(p_user_id TEXT, p_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT auth.uid() IS NOT NULL
    AND auth.uid()::text = p_user_id
    AND EXISTS (SELECT 1 FROM fin_contas WHERE id = p_id AND user_id = p_user_id);
$$;

CREATE OR REPLACE FUNCTION fin_owned_import_batch(p_user_id TEXT, p_id UUID, p_account_id UUID DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT auth.uid() IS NOT NULL
    AND auth.uid()::text = p_user_id
    AND EXISTS (
    SELECT 1 FROM fin_importacoes_extrato
    WHERE id = p_id
      AND user_id = p_user_id
      AND (p_account_id IS NULL OR conta_id = p_account_id)
  );
$$;

CREATE OR REPLACE FUNCTION fin_owned_ofx_transaction(p_user_id TEXT, p_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT auth.uid() IS NOT NULL
    AND auth.uid()::text = p_user_id
    AND EXISTS (SELECT 1 FROM fin_transacoes_ofx WHERE id = p_id AND user_id = p_user_id);
$$;

CREATE OR REPLACE FUNCTION fin_owned_revenue(p_user_id TEXT, p_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT auth.uid() IS NOT NULL
    AND auth.uid()::text = p_user_id
    AND EXISTS (SELECT 1 FROM fin_receitas WHERE id = p_id AND user_id = p_user_id);
$$;

CREATE OR REPLACE FUNCTION fin_owned_expense(p_user_id TEXT, p_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT auth.uid() IS NOT NULL
    AND auth.uid()::text = p_user_id
    AND EXISTS (SELECT 1 FROM fin_despesas WHERE id = p_id AND user_id = p_user_id);
$$;

CREATE OR REPLACE FUNCTION fin_owned_job_payment_ref(p_user_id TEXT, p_ref TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT auth.uid() IS NOT NULL
    AND auth.uid()::text = p_user_id
    AND EXISTS (
    SELECT 1
    FROM job_payments payment
    JOIN jobs job ON job.id = payment.job_id
    WHERE job.user_id::text = p_user_id
      AND p_ref = 'job_payment:' || payment.id::text
  );
$$;

CREATE OR REPLACE FUNCTION fin_guard_method_account_link()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NEW.conta_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM fin_contas account
    WHERE account.id = NEW.conta_id AND account.user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'METHOD_ACCOUNT_OWNERSHIP_MISMATCH';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fin_guard_method_account_link ON fin_meios;
CREATE TRIGGER trg_fin_guard_method_account_link
BEFORE INSERT OR UPDATE OF user_id, conta_id
ON fin_meios
FOR EACH ROW
EXECUTE FUNCTION fin_guard_method_account_link();

CREATE OR REPLACE FUNCTION fin_guard_revenue_references()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NEW.conta_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM fin_contas account
    WHERE account.id = NEW.conta_id AND account.user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'REVENUE_ACCOUNT_OWNERSHIP_MISMATCH';
  END IF;
  IF NEW.meio_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM fin_meios method
    WHERE method.id = NEW.meio_id AND method.user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'REVENUE_METHOD_OWNERSHIP_MISMATCH';
  END IF;
  IF NEW.categoria_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM fin_categorias category
    WHERE category.id = NEW.categoria_id
      AND category.user_id = NEW.user_id
      AND category.tipo = 'receita'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'REVENUE_CATEGORY_OWNERSHIP_MISMATCH';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fin_guard_revenue_references ON fin_receitas;
CREATE TRIGGER trg_fin_guard_revenue_references
BEFORE INSERT OR UPDATE OF user_id, conta_id, meio_id, categoria_id
ON fin_receitas
FOR EACH ROW
EXECUTE FUNCTION fin_guard_revenue_references();

CREATE OR REPLACE FUNCTION fin_guard_expense_references()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NEW.conta_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM fin_contas account
    WHERE account.id = NEW.conta_id AND account.user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'EXPENSE_ACCOUNT_OWNERSHIP_MISMATCH';
  END IF;
  IF NEW.meio_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM fin_meios method
    WHERE method.id = NEW.meio_id AND method.user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'EXPENSE_METHOD_OWNERSHIP_MISMATCH';
  END IF;
  IF NEW.categoria_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM fin_categorias category
    WHERE category.id = NEW.categoria_id
      AND category.user_id = NEW.user_id
      AND category.tipo = 'despesa'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'EXPENSE_CATEGORY_OWNERSHIP_MISMATCH';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fin_guard_expense_references ON fin_despesas;
CREATE TRIGGER trg_fin_guard_expense_references
BEFORE INSERT OR UPDATE OF user_id, conta_id, meio_id, categoria_id
ON fin_despesas
FOR EACH ROW
EXECUTE FUNCTION fin_guard_expense_references();

CREATE OR REPLACE FUNCTION fin_guard_category_dre_link()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  group_type TEXT;
BEGIN
  IF NEW.grupo_dre_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT tipo INTO group_type
  FROM fin_grupos_dre
  WHERE id = NEW.grupo_dre_id AND user_id = NEW.user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'DRE_GROUP_OWNERSHIP_MISMATCH';
  END IF;
  IF (NEW.tipo = 'receita' AND group_type <> 'receita')
     OR (NEW.tipo = 'despesa' AND group_type = 'receita') THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'DRE_GROUP_TYPE_MISMATCH';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fin_guard_category_dre_link ON fin_categorias;
CREATE TRIGGER trg_fin_guard_category_dre_link
BEFORE INSERT OR UPDATE OF user_id, tipo, grupo_dre_id
ON fin_categorias
FOR EACH ROW
EXECUTE FUNCTION fin_guard_category_dre_link();

CREATE OR REPLACE FUNCTION fin_guard_dre_group_type()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM fin_categorias category
    WHERE category.grupo_dre_id = NEW.id
      AND category.user_id = OLD.user_id
      AND (
        category.user_id IS DISTINCT FROM NEW.user_id
        OR (category.tipo = 'receita' AND NEW.tipo <> 'receita')
        OR (category.tipo = 'despesa' AND NEW.tipo = 'receita')
      )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'DRE_GROUP_HAS_INCOMPATIBLE_CATEGORIES';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fin_guard_dre_group_type ON fin_grupos_dre;
CREATE TRIGGER trg_fin_guard_dre_group_type
BEFORE UPDATE OF user_id, tipo
ON fin_grupos_dre
FOR EACH ROW
EXECUTE FUNCTION fin_guard_dre_group_type();

REVOKE ALL ON FUNCTION fin_owned_account(TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION fin_owned_import_batch(TEXT, UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION fin_owned_ofx_transaction(TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION fin_owned_revenue(TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION fin_owned_expense(TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION fin_owned_job_payment_ref(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fin_owned_account(TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION fin_owned_import_batch(TEXT, UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION fin_owned_ofx_transaction(TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION fin_owned_revenue(TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION fin_owned_expense(TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION fin_owned_job_payment_ref(TEXT, TEXT) TO authenticated;

ALTER TABLE fin_transacoes_ofx ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin_importacoes_extrato ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin_conciliacao_alocacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin_contas_identidade_conflitos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fin_transacoes_ofx_user ON fin_transacoes_ofx;
CREATE POLICY fin_transacoes_ofx_user
  ON fin_transacoes_ofx
  FOR SELECT
  USING (
    user_id = auth.uid()::text
    AND (conta_id IS NULL OR fin_owned_account(auth.uid()::text, conta_id))
    AND (importacao_id IS NULL OR fin_owned_import_batch(auth.uid()::text, importacao_id, conta_id))
    AND (receita_id IS NULL OR fin_owned_revenue(auth.uid()::text, receita_id))
    AND (despesa_id IS NULL OR fin_owned_expense(auth.uid()::text, despesa_id))
    AND (transferencia_par_id IS NULL OR fin_owned_ofx_transaction(auth.uid()::text, transferencia_par_id))
  );

DROP POLICY IF EXISTS fin_importacoes_extrato_user ON fin_importacoes_extrato;
CREATE POLICY fin_importacoes_extrato_user
  ON fin_importacoes_extrato
  USING (user_id = auth.uid()::text AND fin_owned_account(auth.uid()::text, conta_id))
  WITH CHECK (
    user_id = auth.uid()::text
    AND fin_owned_account(auth.uid()::text, conta_id)
  );

DROP POLICY IF EXISTS fin_conciliacao_alocacoes_user ON fin_conciliacao_alocacoes;
CREATE POLICY fin_conciliacao_alocacoes_user
  ON fin_conciliacao_alocacoes
  USING (
    user_id = auth.uid()::text
    AND fin_owned_ofx_transaction(auth.uid()::text, transacao_id)
    AND (receita_id IS NULL OR fin_owned_revenue(auth.uid()::text, receita_id))
    AND (despesa_id IS NULL OR fin_owned_expense(auth.uid()::text, despesa_id))
    AND (job_payment_ref IS NULL OR fin_owned_job_payment_ref(auth.uid()::text, job_payment_ref))
  )
  WITH CHECK (
    user_id = auth.uid()::text
    AND fin_owned_ofx_transaction(auth.uid()::text, transacao_id)
    AND (receita_id IS NULL OR fin_owned_revenue(auth.uid()::text, receita_id))
    AND (despesa_id IS NULL OR fin_owned_expense(auth.uid()::text, despesa_id))
    AND (job_payment_ref IS NULL OR fin_owned_job_payment_ref(auth.uid()::text, job_payment_ref))
  );

DROP POLICY IF EXISTS fin_contas_identidade_conflitos_user ON fin_contas_identidade_conflitos;
CREATE POLICY fin_contas_identidade_conflitos_user
  ON fin_contas_identidade_conflitos
  FOR SELECT
  USING (user_id = auth.uid()::text);

CREATE OR REPLACE FUNCTION fin_assert_request_user(p_user_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF auth.role() = 'service_role' THEN
    RETURN;
  END IF;
  IF auth.uid() IS NULL OR auth.uid()::text IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'FINANCE_USER_MISMATCH';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION fin_reconcile_ofx_transaction(
  p_user_id TEXT,
  p_transacao_id UUID,
  p_receita_id UUID DEFAULT NULL,
  p_despesa_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  tx fin_transacoes_ofx%ROWTYPE;
  receipt fin_receitas%ROWTYPE;
  expense fin_despesas%ROWTYPE;
  previous_state JSONB;
BEGIN
  PERFORM fin_assert_request_user(p_user_id);
  IF num_nonnulls(p_receita_id, p_despesa_id) <> 1 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'RECONCILIATION_TARGET_INVALID';
  END IF;
  SELECT * INTO tx FROM fin_transacoes_ofx
  WHERE id = p_transacao_id AND user_id = p_user_id
  FOR UPDATE;
  IF NOT FOUND OR tx.revertido_em IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'OFX_TRANSACTION_NOT_FOUND';
  END IF;
  IF tx.status_conciliacao NOT IN ('pendente', 'sugerido')
     OR tx.receita_id IS NOT NULL OR tx.despesa_id IS NOT NULL
     OR tx.transferencia_par_id IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'RECONCILIATION_CONFLICT';
  END IF;

  IF p_receita_id IS NOT NULL THEN
    IF tx.tipo <> 'credito' THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'RECONCILIATION_DIRECTION_MISMATCH';
    END IF;
    SELECT * INTO receipt FROM fin_receitas
    WHERE id = p_receita_id AND user_id = p_user_id
    FOR UPDATE;
    IF NOT FOUND OR receipt.status = 'cancelado' THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'RECONCILIATION_TARGET_NOT_FOUND';
    END IF;
    IF round(tx.valor * 100) <> round(coalesce(receipt.valor_liquido, receipt.valor_bruto) * 100) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'RECONCILIATION_AMOUNT_MISMATCH';
    END IF;
    IF EXISTS (
      SELECT 1 FROM fin_transacoes_ofx
      WHERE user_id = p_user_id AND receita_id = receipt.id AND id <> tx.id AND revertido_em IS NULL
    ) OR EXISTS (
      SELECT 1 FROM fin_conciliacao_alocacoes
      WHERE user_id = p_user_id AND receita_id = receipt.id
    ) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'RECONCILIATION_TARGET_ALREADY_LINKED';
    END IF;
    previous_state := jsonb_build_object(
      'type', 'receita', 'id', receipt.id, 'status', receipt.status,
      'data_pagamento', receipt.data_pagamento,
      'data_recebimento_real', receipt.data_recebimento_real,
      'conta_id', receipt.conta_id
    );
    UPDATE fin_receitas SET
      status = 'recebido',
      data_recebimento_real = tx.data,
      conta_id = tx.conta_id,
      updated_at = now()
    WHERE id = receipt.id AND user_id = p_user_id;
  ELSE
    IF tx.tipo <> 'debito' THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'RECONCILIATION_DIRECTION_MISMATCH';
    END IF;
    SELECT * INTO expense FROM fin_despesas
    WHERE id = p_despesa_id AND user_id = p_user_id
    FOR UPDATE;
    IF NOT FOUND OR expense.status = 'cancelado' THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'RECONCILIATION_TARGET_NOT_FOUND';
    END IF;
    IF round(tx.valor * 100) <> round(expense.valor * 100) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'RECONCILIATION_AMOUNT_MISMATCH';
    END IF;
    IF EXISTS (
      SELECT 1 FROM fin_transacoes_ofx
      WHERE user_id = p_user_id AND despesa_id = expense.id AND id <> tx.id AND revertido_em IS NULL
    ) OR EXISTS (
      SELECT 1 FROM fin_conciliacao_alocacoes
      WHERE user_id = p_user_id AND despesa_id = expense.id
    ) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'RECONCILIATION_TARGET_ALREADY_LINKED';
    END IF;
    previous_state := jsonb_build_object(
      'type', 'despesa', 'id', expense.id, 'status', expense.status,
      'data_pagamento', expense.data_pagamento, 'conta_id', expense.conta_id
    );
    UPDATE fin_despesas SET
      status = 'pago', data_pagamento = tx.data, conta_id = tx.conta_id, updated_at = now()
    WHERE id = expense.id AND user_id = p_user_id;
  END IF;

  UPDATE fin_transacoes_ofx SET
    status_conciliacao = 'conciliado',
    receita_id = p_receita_id,
    despesa_id = p_despesa_id,
    sugestao_tipo = NULL,
    sugestao_id = NULL,
    sugestao_score = NULL,
    sugestao_motivos = '[]'::jsonb,
    metadata = (coalesce(metadata, '{}'::jsonb) - 'reconciliation_previous')
      || jsonb_build_object('reconciliation_previous', previous_state)
  WHERE id = tx.id AND user_id = p_user_id;
  RETURN jsonb_build_object('success', true, 'transacao_id', tx.id);
END;
$$;

CREATE OR REPLACE FUNCTION fin_unreconcile_ofx_transaction(
  p_user_id TEXT,
  p_transacao_id UUID,
  p_next_status TEXT DEFAULT 'pendente',
  p_metadata_patch JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  tx fin_transacoes_ofx%ROWTYPE;
  previous_state JSONB;
  receipt fin_receitas%ROWTYPE;
  expense fin_despesas%ROWTYPE;
BEGIN
  PERFORM fin_assert_request_user(p_user_id);
  IF p_next_status NOT IN ('pendente', 'ignorado') THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'RECONCILIATION_STATUS_INVALID';
  END IF;
  IF jsonb_typeof(coalesce(p_metadata_patch, '{}'::jsonb)) <> 'object'
     OR EXISTS (
       SELECT 1 FROM jsonb_object_keys(coalesce(p_metadata_patch, '{}'::jsonb)) key
       WHERE key NOT IN ('ignoredReason', 'ignored_reason')
     ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'RECONCILIATION_METADATA_PATCH_INVALID';
  END IF;
  SELECT * INTO tx FROM fin_transacoes_ofx
  WHERE id = p_transacao_id AND user_id = p_user_id
  FOR UPDATE;
  IF NOT FOUND OR tx.revertido_em IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'OFX_TRANSACTION_NOT_FOUND';
  END IF;
  IF tx.status_conciliacao = 'transferencia' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TRANSFER_REQUIRES_OWN_UNDO';
  END IF;
  previous_state := tx.metadata -> 'reconciliation_previous';

  IF tx.receita_id IS NOT NULL THEN
    SELECT * INTO receipt FROM fin_receitas
    WHERE id = tx.receita_id AND user_id = p_user_id
    FOR UPDATE;
    IF FOUND AND receipt.origem_ref = 'ofx:' || tx.id::text THEN
      UPDATE fin_receitas SET status = 'cancelado', updated_at = now()
      WHERE id = receipt.id AND user_id = p_user_id;
    ELSIF FOUND AND previous_state ->> 'type' = 'receita'
          AND previous_state ->> 'id' = receipt.id::text THEN
      IF previous_state ->> 'status' NOT IN ('pendente', 'atrasado', 'recebido') THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'RECONCILIATION_SNAPSHOT_INVALID';
      END IF;
      IF nullif(previous_state ->> 'conta_id', '') IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM fin_contas
           WHERE id = (previous_state ->> 'conta_id')::uuid AND user_id = p_user_id
         ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'RECONCILIATION_SNAPSHOT_ACCOUNT_INVALID';
      END IF;
      UPDATE fin_receitas SET
        status = previous_state ->> 'status',
        data_pagamento = nullif(previous_state ->> 'data_pagamento', '')::date,
        data_recebimento_real = nullif(previous_state ->> 'data_recebimento_real', '')::date,
        conta_id = nullif(previous_state ->> 'conta_id', '')::uuid,
        updated_at = now()
      WHERE id = receipt.id AND user_id = p_user_id;
    ELSIF FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'RECONCILIATION_SNAPSHOT_MISSING';
    END IF;
  ELSIF tx.despesa_id IS NOT NULL THEN
    SELECT * INTO expense FROM fin_despesas
    WHERE id = tx.despesa_id AND user_id = p_user_id
    FOR UPDATE;
    IF FOUND AND expense.origem_ref = 'ofx:' || tx.id::text THEN
      UPDATE fin_despesas SET status = 'cancelado', updated_at = now()
      WHERE id = expense.id AND user_id = p_user_id;
    ELSIF FOUND AND previous_state ->> 'type' = 'despesa'
          AND previous_state ->> 'id' = expense.id::text THEN
      IF previous_state ->> 'status' NOT IN ('pendente', 'atrasado', 'pago') THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'RECONCILIATION_SNAPSHOT_INVALID';
      END IF;
      IF nullif(previous_state ->> 'conta_id', '') IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM fin_contas
           WHERE id = (previous_state ->> 'conta_id')::uuid AND user_id = p_user_id
         ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'RECONCILIATION_SNAPSHOT_ACCOUNT_INVALID';
      END IF;
      UPDATE fin_despesas SET
        status = previous_state ->> 'status',
        data_pagamento = nullif(previous_state ->> 'data_pagamento', '')::date,
        conta_id = nullif(previous_state ->> 'conta_id', '')::uuid,
        updated_at = now()
      WHERE id = expense.id AND user_id = p_user_id;
    ELSIF FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'RECONCILIATION_SNAPSHOT_MISSING';
    END IF;
  END IF;

  UPDATE fin_transacoes_ofx SET
    status_conciliacao = p_next_status,
    receita_id = NULL,
    despesa_id = NULL,
    sugestao_tipo = NULL,
    sugestao_id = NULL,
    sugestao_score = NULL,
    sugestao_motivos = '[]'::jsonb,
    metadata = (coalesce(metadata, '{}'::jsonb) - 'reconciliation_previous')
      || coalesce(p_metadata_patch, '{}'::jsonb)
  WHERE id = tx.id AND user_id = p_user_id;
  RETURN jsonb_build_object('success', true, 'transacao_id', tx.id);
END;
$$;

CREATE OR REPLACE FUNCTION fin_set_ofx_transfer_pair(
  p_user_id TEXT,
  p_left_id UUID,
  p_right_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  left_tx fin_transacoes_ofx%ROWTYPE;
  right_tx fin_transacoes_ofx%ROWTYPE;
  left_previous JSONB;
  right_previous JSONB;
BEGIN
  PERFORM fin_assert_request_user(p_user_id);
  IF p_left_id = p_right_id THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TRANSFER_PAIR_INVALID';
  END IF;
  PERFORM 1 FROM fin_transacoes_ofx
  WHERE user_id = p_user_id AND id = ANY(ARRAY[p_left_id, p_right_id])
  ORDER BY id
  FOR UPDATE;
  SELECT * INTO left_tx FROM fin_transacoes_ofx WHERE id = p_left_id AND user_id = p_user_id;
  SELECT * INTO right_tx FROM fin_transacoes_ofx WHERE id = p_right_id AND user_id = p_user_id;
  IF left_tx.id IS NULL OR right_tx.id IS NULL
     OR left_tx.revertido_em IS NOT NULL OR right_tx.revertido_em IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'OFX_TRANSACTION_NOT_FOUND';
  END IF;
  IF left_tx.conta_id = right_tx.conta_id OR left_tx.tipo = right_tx.tipo
     OR round(left_tx.valor * 100) <> round(right_tx.valor * 100)
     OR abs(left_tx.data - right_tx.data) > 5 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TRANSFER_PAIR_INVALID';
  END IF;
  IF left_tx.status_conciliacao NOT IN ('pendente', 'sugerido')
     OR right_tx.status_conciliacao NOT IN ('pendente', 'sugerido')
     OR left_tx.receita_id IS NOT NULL OR left_tx.despesa_id IS NOT NULL
     OR right_tx.receita_id IS NOT NULL OR right_tx.despesa_id IS NOT NULL
     OR left_tx.transferencia_par_id IS NOT NULL OR right_tx.transferencia_par_id IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TRANSFER_PAIR_CONFLICT';
  END IF;
  left_previous := jsonb_build_object(
    'status', left_tx.status_conciliacao,
    'sugestao_tipo', left_tx.sugestao_tipo,
    'sugestao_id', left_tx.sugestao_id,
    'sugestao_score', left_tx.sugestao_score,
    'sugestao_motivos', left_tx.sugestao_motivos
  );
  right_previous := jsonb_build_object(
    'status', right_tx.status_conciliacao,
    'sugestao_tipo', right_tx.sugestao_tipo,
    'sugestao_id', right_tx.sugestao_id,
    'sugestao_score', right_tx.sugestao_score,
    'sugestao_motivos', right_tx.sugestao_motivos
  );
  UPDATE fin_transacoes_ofx SET
    status_conciliacao = 'transferencia', transferencia_par_id = right_tx.id,
    sugestao_tipo = NULL, sugestao_id = NULL, sugestao_score = NULL,
    sugestao_motivos = '[]'::jsonb,
    metadata = coalesce(metadata, '{}'::jsonb)
      || jsonb_build_object('transfer_previous', left_previous)
  WHERE id = left_tx.id AND user_id = p_user_id;
  UPDATE fin_transacoes_ofx SET
    status_conciliacao = 'transferencia', transferencia_par_id = left_tx.id,
    sugestao_tipo = NULL, sugestao_id = NULL, sugestao_score = NULL,
    sugestao_motivos = '[]'::jsonb,
    metadata = coalesce(metadata, '{}'::jsonb)
      || jsonb_build_object('transfer_previous', right_previous)
  WHERE id = right_tx.id AND user_id = p_user_id;
  RETURN jsonb_build_object('success', true, 'left_id', left_tx.id, 'right_id', right_tx.id);
END;
$$;

CREATE OR REPLACE FUNCTION fin_unset_ofx_transfer_pair(p_user_id TEXT, p_transacao_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  tx fin_transacoes_ofx%ROWTYPE;
  counterpart fin_transacoes_ofx%ROWTYPE;
  previous JSONB;
BEGIN
  PERFORM fin_assert_request_user(p_user_id);
  SELECT * INTO tx FROM fin_transacoes_ofx
  WHERE id = p_transacao_id AND user_id = p_user_id
  FOR UPDATE;
  IF NOT FOUND OR tx.transferencia_par_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TRANSFER_PAIR_NOT_FOUND';
  END IF;
  PERFORM 1 FROM fin_transacoes_ofx
  WHERE user_id = p_user_id AND id = ANY(ARRAY[tx.id, tx.transferencia_par_id])
  ORDER BY id
  FOR UPDATE;
  SELECT * INTO tx FROM fin_transacoes_ofx WHERE id = p_transacao_id AND user_id = p_user_id;
  SELECT * INTO counterpart FROM fin_transacoes_ofx
  WHERE id = tx.transferencia_par_id AND user_id = p_user_id;
  IF counterpart.id IS NULL OR counterpart.transferencia_par_id IS DISTINCT FROM tx.id THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TRANSFER_PAIR_INCONSISTENT';
  END IF;

  previous := tx.metadata -> 'transfer_previous';
  UPDATE fin_transacoes_ofx SET
    status_conciliacao = coalesce(previous ->> 'status', 'pendente'),
    transferencia_par_id = NULL,
    sugestao_tipo = previous ->> 'sugestao_tipo',
    sugestao_id = previous ->> 'sugestao_id',
    sugestao_score = nullif(previous ->> 'sugestao_score', '')::numeric,
    sugestao_motivos = coalesce(previous -> 'sugestao_motivos', '[]'::jsonb),
    metadata = coalesce(metadata, '{}'::jsonb) - 'transfer_previous'
  WHERE id = tx.id AND user_id = p_user_id;

  previous := counterpart.metadata -> 'transfer_previous';
  UPDATE fin_transacoes_ofx SET
    status_conciliacao = coalesce(previous ->> 'status', 'pendente'),
    transferencia_par_id = NULL,
    sugestao_tipo = previous ->> 'sugestao_tipo',
    sugestao_id = previous ->> 'sugestao_id',
    sugestao_score = nullif(previous ->> 'sugestao_score', '')::numeric,
    sugestao_motivos = coalesce(previous -> 'sugestao_motivos', '[]'::jsonb),
    metadata = coalesce(metadata, '{}'::jsonb) - 'transfer_previous'
  WHERE id = counterpart.id AND user_id = p_user_id;
  RETURN jsonb_build_object('success', true, 'transacao_ids', jsonb_build_array(tx.id, counterpart.id));
END;
$$;

CREATE OR REPLACE FUNCTION fin_apply_processor_settlement(
  p_user_id TEXT,
  p_transacao_id UUID,
  p_receita_ids UUID[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  tx fin_transacoes_ofx%ROWTYPE;
  receipt_ids UUID[];
  receipt_count INTEGER;
  receipt_total NUMERIC(14,2);
  snapshots JSONB;
  previous_tx JSONB;
BEGIN
  PERFORM fin_assert_request_user(p_user_id);
  SELECT array_agg(DISTINCT receipt_id ORDER BY receipt_id)
  INTO receipt_ids
  FROM unnest(coalesce(p_receita_ids, ARRAY[]::UUID[])) receipt_id;
  receipt_count := coalesce(array_length(receipt_ids, 1), 0);
  IF receipt_count < 1 OR receipt_count > 100 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PROCESSOR_RECEIPT_SELECTION_INVALID';
  END IF;

  SELECT * INTO tx
  FROM fin_transacoes_ofx
  WHERE id = p_transacao_id AND user_id = p_user_id
  FOR UPDATE;
  IF NOT FOUND OR tx.revertido_em IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'OFX_TRANSACTION_NOT_FOUND';
  END IF;
  IF tx.tipo <> 'credito'
     OR tx.status_conciliacao NOT IN ('pendente', 'sugerido')
     OR tx.receita_id IS NOT NULL OR tx.despesa_id IS NOT NULL
     OR tx.transferencia_par_id IS NOT NULL
     OR EXISTS (
       SELECT 1 FROM fin_conciliacao_alocacoes
       WHERE user_id = p_user_id AND transacao_id = tx.id
     ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PROCESSOR_SETTLEMENT_CONFLICT';
  END IF;

  PERFORM 1
  FROM fin_receitas
  WHERE user_id = p_user_id AND id = ANY(receipt_ids)
  ORDER BY id
  FOR UPDATE;

  SELECT
    count(*)::integer,
    round(coalesce(sum(coalesce(receipt.valor_liquido, receipt.valor_bruto)), 0), 2),
    jsonb_agg(jsonb_build_object(
      'id', receipt.id,
      'status', receipt.status,
      'data_pagamento', receipt.data_pagamento,
      'data_recebimento_real', receipt.data_recebimento_real,
      'conta_id', receipt.conta_id,
      'updated_at', receipt.updated_at
    ) ORDER BY receipt.id)
  INTO receipt_count, receipt_total, snapshots
  FROM fin_receitas receipt
  JOIN fin_meios method
    ON method.id = receipt.meio_id
   AND method.user_id = p_user_id
   AND method.ativo = true
  WHERE receipt.user_id = p_user_id
    AND receipt.id = ANY(receipt_ids)
    AND receipt.status = 'recebido'
    AND receipt.job_id IS NOT NULL
    AND receipt.data_recebimento_real IS NOT NULL
    AND abs(receipt.data_recebimento_real - tx.data) <= 5
    AND (receipt.conta_id IS NULL OR receipt.conta_id <> tx.conta_id)
    AND (
      fin_normalize_identity_key(method.nome) IN (
        'link', 'linkdepagamento', 'linkinfinitepay',
        'cartaodecredito', 'cartaocredito', 'credito'
      )
      OR fin_normalize_identity_key(method.nome) LIKE '%infinitepay%'
      OR fin_normalize_identity_key(method.nome) LIKE '%infinitypay%'
      OR fin_normalize_identity_key(method.nome) LIKE '%cloudwalk%'
    )
    AND NOT EXISTS (
      SELECT 1 FROM fin_transacoes_ofx linked
      WHERE linked.user_id = p_user_id
        AND linked.receita_id = receipt.id
        AND linked.revertido_em IS NULL
    )
    AND NOT EXISTS (
      SELECT 1 FROM fin_conciliacao_alocacoes allocation
      WHERE allocation.user_id = p_user_id AND allocation.receita_id = receipt.id
    );

  IF receipt_count IS DISTINCT FROM array_length(receipt_ids, 1) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PROCESSOR_RECEIPT_NOT_ELIGIBLE';
  END IF;
  IF round(receipt_total * 100) <> round(tx.valor * 100) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PROCESSOR_AMOUNT_MISMATCH';
  END IF;

  previous_tx := jsonb_build_object(
    'status', tx.status_conciliacao,
    'sugestao_tipo', tx.sugestao_tipo,
    'sugestao_id', tx.sugestao_id,
    'sugestao_score', tx.sugestao_score,
    'sugestao_motivos', tx.sugestao_motivos
  );
  INSERT INTO fin_conciliacao_alocacoes (
    user_id, transacao_id, receita_id, valor_alocado
  )
  SELECT
    p_user_id,
    tx.id,
    receipt.id,
    coalesce(receipt.valor_liquido, receipt.valor_bruto)
  FROM fin_receitas receipt
  WHERE receipt.user_id = p_user_id AND receipt.id = ANY(receipt_ids);

  UPDATE fin_receitas SET
    status = 'recebido',
    conta_id = tx.conta_id,
    data_recebimento_real = tx.data,
    updated_at = now()
  WHERE user_id = p_user_id AND id = ANY(receipt_ids);

  UPDATE fin_transacoes_ofx SET
    status_conciliacao = 'transferencia',
    receita_id = NULL,
    despesa_id = NULL,
    transferencia_par_id = NULL,
    sugestao_tipo = NULL,
    sugestao_id = NULL,
    sugestao_score = NULL,
    sugestao_motivos = '[]'::jsonb,
    metadata = (coalesce(metadata, '{}'::jsonb) - 'processor_settlement_review')
      || jsonb_build_object('processor_settlement', jsonb_build_object(
        'provider', 'InfinitePay',
        'destination_account_id', tx.conta_id,
        'settlement_date', tx.data,
        'amount', tx.valor,
        'receipts', snapshots,
        'previous_transaction', previous_tx
      ))
  WHERE id = tx.id AND user_id = p_user_id;

  RETURN jsonb_build_object(
    'success', true,
    'transacao_id', tx.id,
    'receita_ids', to_jsonb(receipt_ids)
  );
END;
$$;

CREATE OR REPLACE FUNCTION fin_undo_processor_settlement(
  p_user_id TEXT,
  p_transacao_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  tx fin_transacoes_ofx%ROWTYPE;
  settlement JSONB;
  previous_tx JSONB;
  snapshot JSONB;
  receipt_ids UUID[];
BEGIN
  PERFORM fin_assert_request_user(p_user_id);
  SELECT * INTO tx
  FROM fin_transacoes_ofx
  WHERE id = p_transacao_id AND user_id = p_user_id
  FOR UPDATE;
  IF NOT FOUND OR tx.revertido_em IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'OFX_TRANSACTION_NOT_FOUND';
  END IF;
  settlement := tx.metadata -> 'processor_settlement';
  IF tx.status_conciliacao <> 'transferencia'
     OR tx.transferencia_par_id IS NOT NULL
     OR settlement IS NULL
     OR jsonb_typeof(settlement -> 'receipts') <> 'array' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PROCESSOR_SNAPSHOT_MISSING';
  END IF;

  SELECT array_agg((item ->> 'id')::uuid ORDER BY (item ->> 'id')::uuid)
  INTO receipt_ids
  FROM jsonb_array_elements(settlement -> 'receipts') item;
  IF coalesce(array_length(receipt_ids, 1), 0) = 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PROCESSOR_SNAPSHOT_MISSING';
  END IF;
  PERFORM 1 FROM fin_receitas
  WHERE user_id = p_user_id AND id = ANY(receipt_ids)
  ORDER BY id
  FOR UPDATE;
  IF (SELECT count(*) FROM fin_receitas WHERE user_id = p_user_id AND id = ANY(receipt_ids))
     <> array_length(receipt_ids, 1) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PROCESSOR_SNAPSHOT_INCOMPLETE';
  END IF;
  IF EXISTS (
    SELECT 1 FROM fin_conciliacao_alocacoes allocation
    WHERE allocation.user_id = p_user_id
      AND allocation.receita_id = ANY(receipt_ids)
      AND allocation.transacao_id <> tx.id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PROCESSOR_ALLOCATION_CHANGED';
  END IF;
  IF (
    SELECT count(*) FROM fin_conciliacao_alocacoes allocation
    WHERE allocation.user_id = p_user_id
      AND allocation.transacao_id = tx.id
      AND allocation.receita_id = ANY(receipt_ids)
  ) <> array_length(receipt_ids, 1)
     OR EXISTS (
       SELECT 1 FROM fin_conciliacao_alocacoes allocation
       WHERE allocation.user_id = p_user_id
         AND allocation.transacao_id = tx.id
         AND (allocation.receita_id IS NULL OR NOT (allocation.receita_id = ANY(receipt_ids)))
     ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PROCESSOR_ALLOCATION_CHANGED';
  END IF;

  FOR snapshot IN SELECT value FROM jsonb_array_elements(settlement -> 'receipts')
  LOOP
    IF snapshot ->> 'status' NOT IN ('pendente', 'atrasado', 'recebido') THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PROCESSOR_SNAPSHOT_INVALID';
    END IF;
    IF nullif(snapshot ->> 'conta_id', '') IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM fin_contas
         WHERE id = (snapshot ->> 'conta_id')::uuid AND user_id = p_user_id
       ) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PROCESSOR_SNAPSHOT_ACCOUNT_INVALID';
    END IF;
    UPDATE fin_receitas SET
      status = snapshot ->> 'status',
      data_pagamento = nullif(snapshot ->> 'data_pagamento', '')::date,
      data_recebimento_real = nullif(snapshot ->> 'data_recebimento_real', '')::date,
      conta_id = nullif(snapshot ->> 'conta_id', '')::uuid,
      updated_at = now()
    WHERE id = (snapshot ->> 'id')::uuid AND user_id = p_user_id;
  END LOOP;

  DELETE FROM fin_conciliacao_alocacoes
  WHERE user_id = p_user_id AND transacao_id = tx.id;

  previous_tx := settlement -> 'previous_transaction';
  UPDATE fin_transacoes_ofx SET
    status_conciliacao = CASE
      WHEN previous_tx ->> 'status' IN ('pendente', 'sugerido') THEN previous_tx ->> 'status'
      ELSE 'pendente'
    END,
    transferencia_par_id = NULL,
    sugestao_tipo = previous_tx ->> 'sugestao_tipo',
    sugestao_id = previous_tx ->> 'sugestao_id',
    sugestao_score = nullif(previous_tx ->> 'sugestao_score', '')::numeric,
    sugestao_motivos = coalesce(previous_tx -> 'sugestao_motivos', '[]'::jsonb),
    metadata = coalesce(metadata, '{}'::jsonb) - 'processor_settlement'
  WHERE id = tx.id AND user_id = p_user_id;

  RETURN jsonb_build_object(
    'success', true,
    'transacao_id', tx.id,
    'receita_ids', to_jsonb(receipt_ids)
  );
END;
$$;

CREATE OR REPLACE FUNCTION fin_import_ofx_batch_v2(
  p_user_id TEXT,
  p_conta_id UUID,
  p_batch JSONB,
  p_rows JSONB,
  p_bank_code TEXT,
  p_account_ref TEXT,
  p_balance NUMERIC DEFAULT NULL,
  p_balance_date DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  account fin_contas%ROWTYPE;
  batch fin_importacoes_extrato%ROWTYPE;
  existing_tx fin_transacoes_ofx%ROWTYPE;
  source_tx fin_transacoes_ofx%ROWTYPE;
  item JSONB;
  correction_snapshot JSONB;
  legacy_source_account_ids UUID[] := ARRAY[]::UUID[];
  legacy_source_account_id UUID;
  legacy_batch_ids UUID[] := ARRAY[]::UUID[];
  legacy_move_ids UUID[] := ARRAY[]::UUID[];
  legacy_linked_ids UUID[] := ARRAY[]::UUID[];
  legacy_snapshot_ids UUID[] := ARRAY[]::UUID[];
  legacy_missing_fit_ids TEXT[] := ARRAY[]::TEXT[];
  expected_correction_token TEXT;
  repeated_file BOOLEAN := false;
  account_linked BOOLEAN := false;
  balance_updated BOOLEAN := false;
  imported_count INTEGER := 0;
  duplicate_count INTEGER := 0;
  reactivated_count INTEGER := 0;
  legacy_match_count INTEGER := 0;
  legacy_moved_count INTEGER := 0;
  legacy_linked_moved_count INTEGER := 0;
  legacy_snapshot_archived_count INTEGER := 0;
  saved_ids JSONB := '[]'::jsonb;
  previous_batch_status TEXT;
BEGIN
  PERFORM fin_assert_request_user(p_user_id);
  IF fin_normalize_bank_key(p_bank_code) = ''
     OR fin_normalize_identity_key(p_account_ref) = '' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'OFX_ACCOUNT_IDENTITY_MISSING';
  END IF;
  IF jsonb_typeof(coalesce(p_rows, 'null'::jsonb)) <> 'array'
     OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'OFX_EMPTY_IMPORT';
  END IF;
  IF jsonb_array_length(p_rows) > 20000 THEN
    RAISE EXCEPTION USING ERRCODE = '54000', MESSAGE = 'OFX_IMPORT_TOO_LARGE';
  END IF;

  SELECT * INTO account
  FROM fin_contas
  WHERE id = p_conta_id AND user_id = p_user_id
  FOR UPDATE;
  IF NOT FOUND OR account.ativo = false THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'FIN_ACCOUNT_NOT_FOUND';
  END IF;
  IF account.identidade_extrato_bloqueada THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ACCOUNT_IDENTITY_CONFLICT';
  END IF;
  IF account.banco_codigo_normalizado <> ''
     AND account.banco_codigo_normalizado <> fin_normalize_bank_key(p_bank_code) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ACCOUNT_MISMATCH';
  END IF;
  IF account.conta_ref_normalizada <> ''
     AND account.conta_ref_normalizada <> fin_normalize_identity_key(p_account_ref) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ACCOUNT_MISMATCH';
  END IF;

  SELECT * INTO batch
  FROM fin_importacoes_extrato
  WHERE user_id = p_user_id
    AND conta_id = p_conta_id
    AND hash_arquivo = p_batch ->> 'hash_arquivo'
  FOR UPDATE;
  IF FOUND THEN
    repeated_file := true;
    previous_batch_status := batch.status;
  ELSE
    INSERT INTO fin_importacoes_extrato (
      user_id, conta_id, nome_arquivo, formato, hash_arquivo,
      banco_codigo, conta_ref, data_inicio, data_fim,
      saldo_inicial, saldo_final, total_creditos, total_debitos,
      total_transacoes, status, erro, metadata
    ) VALUES (
      p_user_id,
      p_conta_id,
      left(coalesce(p_batch ->> 'nome_arquivo', 'extrato.ofx'), 255),
      coalesce(p_batch ->> 'formato', 'ofx'),
      p_batch ->> 'hash_arquivo',
      p_bank_code,
      p_account_ref,
      nullif(p_batch ->> 'data_inicio', '')::date,
      nullif(p_batch ->> 'data_fim', '')::date,
      nullif(p_batch ->> 'saldo_inicial', '')::numeric,
      nullif(p_batch ->> 'saldo_final', '')::numeric,
      coalesce(nullif(p_batch ->> 'total_creditos', '')::numeric, 0),
      coalesce(nullif(p_batch ->> 'total_debitos', '')::numeric, 0),
      coalesce(nullif(p_batch ->> 'total_transacoes', '')::integer, 0),
      'processando',
      NULL,
      coalesce(p_batch -> 'metadata', '{}'::jsonb)
    ) RETURNING * INTO batch;
    previous_batch_status := NULL;
  END IF;

  BEGIN
    UPDATE fin_importacoes_extrato SET
      nome_arquivo = left(coalesce(p_batch ->> 'nome_arquivo', nome_arquivo), 255),
      formato = coalesce(p_batch ->> 'formato', formato),
      banco_codigo = p_bank_code,
      conta_ref = p_account_ref,
      data_inicio = nullif(p_batch ->> 'data_inicio', '')::date,
      data_fim = nullif(p_batch ->> 'data_fim', '')::date,
      saldo_inicial = nullif(p_batch ->> 'saldo_inicial', '')::numeric,
      saldo_final = nullif(p_batch ->> 'saldo_final', '')::numeric,
      total_creditos = coalesce(nullif(p_batch ->> 'total_creditos', '')::numeric, 0),
      total_debitos = coalesce(nullif(p_batch ->> 'total_debitos', '')::numeric, 0),
      total_transacoes = coalesce(nullif(p_batch ->> 'total_transacoes', '')::integer, 0),
      status = 'processando',
      erro = NULL,
      metadata = coalesce(metadata, '{}'::jsonb) || coalesce(p_batch -> 'metadata', '{}'::jsonb)
    WHERE id = batch.id AND user_id = p_user_id;

    IF account.banco_codigo_normalizado = '' OR account.conta_ref_normalizada = '' THEN
      IF EXISTS (
        SELECT 1 FROM fin_contas other
        WHERE other.user_id = p_user_id
          AND other.id <> account.id
          AND other.banco_codigo_normalizado = fin_normalize_bank_key(p_bank_code)
          AND other.conta_ref_normalizada = fin_normalize_identity_key(p_account_ref)
      ) THEN
        RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'ACCOUNT_ALREADY_LINKED';
      END IF;
      UPDATE fin_contas SET
        banco_codigo = CASE WHEN banco_codigo_normalizado = '' THEN p_bank_code ELSE banco_codigo END,
        conta_ref = CASE WHEN conta_ref_normalizada = '' THEN p_account_ref ELSE conta_ref END
      WHERE id = account.id AND user_id = p_user_id;
      account_linked := true;
    END IF;

    SELECT
      coalesce(array_agg(DISTINCT tx.conta_id), ARRAY[]::UUID[]),
      count(*)::integer
    INTO legacy_source_account_ids, legacy_match_count
    FROM fin_transacoes_ofx tx
    WHERE tx.user_id = p_user_id
      AND tx.conta_id <> p_conta_id
      AND tx.revertido_em IS NULL
      AND coalesce(tx.metadata, '{}'::jsonb) @> '{"legacy_identity_unconfirmed": true}'::jsonb
      AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements(p_rows) incoming
        WHERE incoming ->> 'fit_id' = tx.fit_id
      );

    IF cardinality(legacy_source_account_ids) > 1 THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'LEGACY_MULTIPLE_SOURCE_ACCOUNTS';
    END IF;
    IF legacy_match_count > 0
       AND coalesce((p_batch ->> 'confirmar_correcao_legado')::boolean, false) IS NOT TRUE THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'LEGACY_ACCOUNT_CORRECTION_CONFIRMATION_REQUIRED';
    END IF;
    IF legacy_match_count > 0 THEN
      legacy_source_account_id := legacy_source_account_ids[1];
      IF EXISTS (
        SELECT 1
        FROM fin_transacoes_ofx source_tx_check
        JOIN fin_transacoes_ofx target_tx_check
          ON target_tx_check.user_id = source_tx_check.user_id
         AND target_tx_check.conta_id = p_conta_id
         AND target_tx_check.fit_id = source_tx_check.fit_id
         AND target_tx_check.revertido_em IS NULL
        WHERE source_tx_check.user_id = p_user_id
          AND source_tx_check.conta_id = legacy_source_account_id
          AND source_tx_check.revertido_em IS NULL
          AND coalesce(source_tx_check.metadata, '{}'::jsonb)
            @> '{"legacy_identity_unconfirmed": true}'::jsonb
          AND EXISTS (
            SELECT 1 FROM jsonb_array_elements(p_rows) incoming
            WHERE incoming ->> 'fit_id' = source_tx_check.fit_id
          )
      ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'LEGACY_FITID_MULTIPLE_ACCOUNTS';
      END IF;

      SELECT coalesce(array_agg(DISTINCT importacao_id), ARRAY[]::UUID[])
      INTO legacy_batch_ids
      FROM fin_transacoes_ofx
      WHERE user_id = p_user_id
        AND conta_id = legacy_source_account_id
        AND importacao_id IS NOT NULL
        AND coalesce(metadata, '{}'::jsonb) @> '{"legacy_identity_unconfirmed": true}'::jsonb;

      PERFORM id
      FROM fin_transacoes_ofx
      WHERE user_id = p_user_id
        AND conta_id = legacy_source_account_id
        AND revertido_em IS NULL
        AND coalesce(metadata, '{}'::jsonb) @> '{"legacy_identity_unconfirmed": true}'::jsonb
      ORDER BY id
      FOR UPDATE;

      IF EXISTS (
        SELECT 1 FROM fin_transacoes_ofx legacy_tx
        WHERE legacy_tx.user_id = p_user_id
          AND legacy_tx.conta_id = legacy_source_account_id
          AND legacy_tx.revertido_em IS NULL
          AND coalesce(legacy_tx.metadata, '{}'::jsonb)
            @> '{"legacy_identity_unconfirmed": true}'::jsonb
          AND NOT fin_is_balance_snapshot_text(legacy_tx.descricao)
          AND NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements(p_rows) incoming
            WHERE incoming ->> 'fit_id' = legacy_tx.fit_id
          )
      ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'LEGACY_UNMATCHED_MOVEMENTS';
      END IF;
      IF EXISTS (
        SELECT 1 FROM fin_transacoes_ofx legacy_tx
        WHERE legacy_tx.user_id = p_user_id
          AND legacy_tx.conta_id = legacy_source_account_id
          AND legacy_tx.revertido_em IS NULL
          AND coalesce(legacy_tx.metadata, '{}'::jsonb)
            @> '{"legacy_identity_unconfirmed": true}'::jsonb
          AND fin_is_balance_snapshot_text(legacy_tx.descricao)
          AND NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements(p_rows) incoming
            WHERE incoming ->> 'fit_id' = legacy_tx.fit_id
          )
          AND (
            legacy_tx.receita_id IS NOT NULL
            OR legacy_tx.despesa_id IS NOT NULL
            OR legacy_tx.transferencia_par_id IS NOT NULL
            OR legacy_tx.status_conciliacao IN ('conciliado', 'transferencia')
            OR EXISTS (
              SELECT 1 FROM fin_conciliacao_alocacoes allocation
              WHERE allocation.user_id = p_user_id
                AND allocation.transacao_id = legacy_tx.id
            )
          )
      ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'LEGACY_LINKED_BALANCE_SNAPSHOT';
      END IF;

      IF EXISTS (
        SELECT 1
        FROM fin_transacoes_ofx legacy_tx
        JOIN LATERAL (
          SELECT incoming
          FROM jsonb_array_elements(p_rows) incoming
          WHERE incoming ->> 'fit_id' = legacy_tx.fit_id
          LIMIT 1
        ) matched ON true
        WHERE legacy_tx.user_id = p_user_id
          AND legacy_tx.conta_id = legacy_source_account_id
          AND legacy_tx.revertido_em IS NULL
          AND coalesce(legacy_tx.metadata, '{}'::jsonb)
            @> '{"legacy_identity_unconfirmed": true}'::jsonb
          AND (
            legacy_tx.tipo IS DISTINCT FROM (matched.incoming ->> 'tipo')
            OR round(legacy_tx.valor * 100)
              <> round((matched.incoming ->> 'valor')::numeric * 100)
            OR legacy_tx.data IS DISTINCT FROM (matched.incoming ->> 'data')::date
          )
      ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'LEGACY_IMMUTABLE_COLLISION';
      END IF;
      IF EXISTS (
        SELECT 1 FROM fin_transacoes_ofx legacy_tx
        WHERE legacy_tx.user_id = p_user_id
          AND legacy_tx.conta_id = legacy_source_account_id
          AND legacy_tx.revertido_em IS NULL
          AND coalesce(legacy_tx.metadata, '{}'::jsonb)
            @> '{"legacy_identity_unconfirmed": true}'::jsonb
          AND EXISTS (
            SELECT 1 FROM jsonb_array_elements(p_rows) incoming
            WHERE incoming ->> 'fit_id' = legacy_tx.fit_id
          )
          AND (
            legacy_tx.transferencia_par_id IS NOT NULL
            OR legacy_tx.status_conciliacao = 'transferencia'
            OR EXISTS (
              SELECT 1 FROM fin_conciliacao_alocacoes allocation
              WHERE allocation.user_id = p_user_id
                AND allocation.transacao_id = legacy_tx.id
            )
          )
      ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'LEGACY_COMPLEX_FINANCIAL_LINK';
      END IF;

      SELECT
        coalesce(array_agg(tx.id ORDER BY tx.id), ARRAY[]::UUID[]),
        coalesce(array_agg(tx.id ORDER BY tx.id) FILTER (
          WHERE tx.receita_id IS NOT NULL OR tx.despesa_id IS NOT NULL
        ), ARRAY[]::UUID[])
      INTO legacy_move_ids, legacy_linked_ids
      FROM fin_transacoes_ofx tx
      WHERE tx.user_id = p_user_id
        AND tx.conta_id = legacy_source_account_id
        AND tx.revertido_em IS NULL
        AND coalesce(tx.metadata, '{}'::jsonb) @> '{"legacy_identity_unconfirmed": true}'::jsonb
        AND EXISTS (
          SELECT 1 FROM jsonb_array_elements(p_rows) incoming
          WHERE incoming ->> 'fit_id' = tx.fit_id
        );

      SELECT coalesce(array_agg(tx.id ORDER BY tx.id), ARRAY[]::UUID[])
      INTO legacy_snapshot_ids
      FROM fin_transacoes_ofx tx
      WHERE tx.user_id = p_user_id
        AND tx.conta_id = legacy_source_account_id
        AND tx.revertido_em IS NULL
        AND coalesce(tx.metadata, '{}'::jsonb) @> '{"legacy_identity_unconfirmed": true}'::jsonb
        AND fin_is_balance_snapshot_text(tx.descricao)
        AND tx.receita_id IS NULL
        AND tx.despesa_id IS NULL
        AND tx.transferencia_par_id IS NULL
        AND tx.status_conciliacao <> 'conciliado'
        AND NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(p_rows) incoming
          WHERE incoming ->> 'fit_id' = tx.fit_id
        );

      SELECT coalesce(array_agg(fit_id ORDER BY fit_id), ARRAY[]::TEXT[])
      INTO legacy_missing_fit_ids
      FROM (
        SELECT DISTINCT incoming ->> 'fit_id' AS fit_id
        FROM jsonb_array_elements(p_rows) incoming
        WHERE NOT EXISTS (
          SELECT 1 FROM fin_transacoes_ofx target_tx
          WHERE target_tx.user_id = p_user_id
            AND target_tx.conta_id = p_conta_id
            AND target_tx.fit_id = incoming ->> 'fit_id'
            AND target_tx.revertido_em IS NULL
        )
          AND NOT EXISTS (
            SELECT 1 FROM fin_transacoes_ofx source_match
            WHERE source_match.user_id = p_user_id
              AND source_match.conta_id = legacy_source_account_id
              AND source_match.fit_id = incoming ->> 'fit_id'
              AND source_match.revertido_em IS NULL
              AND coalesce(source_match.metadata, '{}'::jsonb)
                @> '{"legacy_identity_unconfirmed": true}'::jsonb
          )
      ) missing;

      expected_correction_token := encode(digest(
        'legacy-account-correction-v1'
          || '|' || p_conta_id::text
          || '|' || coalesce(p_batch ->> 'hash_arquivo', '')
          || '|' || coalesce(array_to_string(legacy_source_account_ids, ','), '')
          || '|' || coalesce(array_to_string(legacy_move_ids, ','), '')
          || '|' || coalesce(array_to_string(legacy_linked_ids, ','), '')
          || '|' || coalesce(array_to_string(legacy_snapshot_ids, ','), '')
          || '|' || coalesce(array_to_string(legacy_missing_fit_ids, ','), ''),
        'sha256'
      ), 'hex');
      IF nullif(p_batch ->> 'correcao_preview_token', '') IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'LEGACY_ACCOUNT_CORRECTION_PREVIEW_REQUIRED';
      END IF;
      IF p_batch ->> 'correcao_preview_token' IS DISTINCT FROM expected_correction_token THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'LEGACY_ACCOUNT_CORRECTION_PREVIEW_STALE';
      END IF;
    END IF;

    FOR item IN SELECT value FROM jsonb_array_elements(p_rows)
    LOOP
      existing_tx.id := NULL;
      SELECT * INTO existing_tx
      FROM fin_transacoes_ofx
      WHERE conta_id = p_conta_id AND fit_id = item ->> 'fit_id'
      FOR UPDATE;
      IF FOUND THEN
        IF existing_tx.user_id IS DISTINCT FROM p_user_id
           OR existing_tx.tipo IS DISTINCT FROM item ->> 'tipo'
           OR round(existing_tx.valor * 100) <> round((item ->> 'valor')::numeric * 100)
           OR existing_tx.data IS DISTINCT FROM (item ->> 'data')::date THEN
          RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'FITID_COLLISION';
        END IF;
        IF existing_tx.revertido_em IS NOT NULL THEN
          UPDATE fin_transacoes_ofx SET
            importacao_id = batch.id,
            trn_type = item ->> 'trn_type',
            fingerprint = nullif(item ->> 'fingerprint', ''),
            descricao = item ->> 'descricao',
            nome_contraparte = item ->> 'nome_contraparte',
            documento_contraparte = item ->> 'documento_contraparte',
            status_conciliacao = 'pendente',
            receita_id = NULL,
            despesa_id = NULL,
            transferencia_par_id = NULL,
            sugestao_tipo = NULL,
            sugestao_id = NULL,
            sugestao_score = NULL,
            sugestao_motivos = '[]'::jsonb,
            metadata = (coalesce(item -> 'metadata', '{}'::jsonb) - 'rollback_previous')
              || jsonb_build_object('reactivated_from_batch', batch.id),
            revertido_em = NULL,
            revertido_motivo = NULL
          WHERE id = existing_tx.id AND user_id = p_user_id;
          reactivated_count := reactivated_count + 1;
        ELSE
          duplicate_count := duplicate_count + 1;
        END IF;
        saved_ids := saved_ids || jsonb_build_array(existing_tx.id);
        CONTINUE;
      END IF;

      source_tx.id := NULL;
      IF legacy_source_account_id IS NOT NULL THEN
        SELECT * INTO source_tx
        FROM fin_transacoes_ofx
        WHERE user_id = p_user_id
          AND conta_id = legacy_source_account_id
          AND fit_id = item ->> 'fit_id'
          AND revertido_em IS NULL
          AND coalesce(metadata, '{}'::jsonb) @> '{"legacy_identity_unconfirmed": true}'::jsonb
        FOR UPDATE;
      END IF;
      IF source_tx.id IS NOT NULL THEN
        IF source_tx.tipo IS DISTINCT FROM item ->> 'tipo'
           OR round(source_tx.valor * 100) <> round((item ->> 'valor')::numeric * 100)
           OR source_tx.data IS DISTINCT FROM (item ->> 'data')::date THEN
          RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'LEGACY_IMMUTABLE_COLLISION';
        END IF;
        IF source_tx.transferencia_par_id IS NOT NULL
           OR source_tx.status_conciliacao = 'transferencia'
           OR EXISTS (
             SELECT 1 FROM fin_conciliacao_alocacoes allocation
             WHERE allocation.user_id = p_user_id AND allocation.transacao_id = source_tx.id
           ) THEN
          RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'LEGACY_COMPLEX_FINANCIAL_LINK';
        END IF;

        correction_snapshot := jsonb_build_object(
          'source_account_id', source_tx.conta_id,
          'target_account_id', p_conta_id,
          'source_importacao_id', source_tx.importacao_id,
          'target_importacao_id', batch.id,
          'corrected_at', now(),
          'receipt_previous_account_id', (
            SELECT conta_id FROM fin_receitas
            WHERE id = source_tx.receita_id AND user_id = p_user_id
          ),
          'expense_previous_account_id', (
            SELECT conta_id FROM fin_despesas
            WHERE id = source_tx.despesa_id AND user_id = p_user_id
          )
        );
        IF source_tx.receita_id IS NOT NULL THEN
          UPDATE fin_receitas SET conta_id = p_conta_id, updated_at = now()
          WHERE id = source_tx.receita_id AND user_id = p_user_id;
          IF NOT FOUND THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'LEGACY_LINKED_REVENUE_NOT_OWNED';
          END IF;
        END IF;
        IF source_tx.despesa_id IS NOT NULL THEN
          UPDATE fin_despesas SET conta_id = p_conta_id, updated_at = now()
          WHERE id = source_tx.despesa_id AND user_id = p_user_id;
          IF NOT FOUND THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'LEGACY_LINKED_EXPENSE_NOT_OWNED';
          END IF;
        END IF;

        UPDATE fin_transacoes_ofx SET
          conta_id = p_conta_id,
          importacao_id = batch.id,
          trn_type = item ->> 'trn_type',
          fingerprint = nullif(item ->> 'fingerprint', ''),
          descricao = item ->> 'descricao',
          nome_contraparte = item ->> 'nome_contraparte',
          documento_contraparte = item ->> 'documento_contraparte',
          metadata = (coalesce(metadata, '{}'::jsonb) || coalesce(item -> 'metadata', '{}'::jsonb))
            || jsonb_build_object(
              'legacy_identity_unconfirmed', false,
              'legacy_account_correction', correction_snapshot
            ),
          revertido_em = NULL,
          revertido_motivo = NULL
        WHERE id = source_tx.id AND user_id = p_user_id;
        legacy_moved_count := legacy_moved_count + 1;
        IF source_tx.receita_id IS NOT NULL OR source_tx.despesa_id IS NOT NULL THEN
          legacy_linked_moved_count := legacy_linked_moved_count + 1;
        END IF;
        saved_ids := saved_ids || jsonb_build_array(source_tx.id);
        CONTINUE;
      END IF;

      IF nullif(item ->> 'fingerprint', '') IS NOT NULL THEN
        SELECT * INTO existing_tx
        FROM fin_transacoes_ofx
        WHERE user_id = p_user_id
          AND conta_id = p_conta_id
          AND fingerprint = item ->> 'fingerprint'
        FOR UPDATE;
        IF FOUND THEN
          IF existing_tx.tipo IS DISTINCT FROM item ->> 'tipo'
             OR round(existing_tx.valor * 100) <> round((item ->> 'valor')::numeric * 100)
             OR existing_tx.data IS DISTINCT FROM (item ->> 'data')::date THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'FINGERPRINT_COLLISION';
          END IF;
          duplicate_count := duplicate_count + 1;
          saved_ids := saved_ids || jsonb_build_array(existing_tx.id);
          CONTINUE;
        END IF;
      END IF;

      INSERT INTO fin_transacoes_ofx (
        user_id, conta_id, fit_id, tipo, trn_type, valor, data, descricao,
        importacao_id, fingerprint, nome_contraparte, documento_contraparte,
        status_conciliacao, sugestao_motivos, metadata
      ) VALUES (
        p_user_id,
        p_conta_id,
        item ->> 'fit_id',
        item ->> 'tipo',
        item ->> 'trn_type',
        (item ->> 'valor')::numeric,
        (item ->> 'data')::date,
        item ->> 'descricao',
        batch.id,
        nullif(item ->> 'fingerprint', ''),
        item ->> 'nome_contraparte',
        item ->> 'documento_contraparte',
        'pendente',
        '[]'::jsonb,
        coalesce(item -> 'metadata', '{}'::jsonb)
      ) RETURNING id INTO existing_tx.id;
      imported_count := imported_count + 1;
      saved_ids := saved_ids || jsonb_build_array(existing_tx.id);
    END LOOP;

    IF legacy_source_account_id IS NOT NULL THEN
      WITH archived AS (
        UPDATE fin_transacoes_ofx tx SET
          status_conciliacao = 'ignorado',
          sugestao_tipo = NULL,
          sugestao_id = NULL,
          sugestao_score = NULL,
          sugestao_motivos = '[]'::jsonb,
          revertido_em = now(),
          revertido_motivo = 'legacy_account_correction:' || batch.id::text,
          metadata = coalesce(tx.metadata, '{}'::jsonb) || jsonb_build_object(
            'legacy_balance_snapshot', true,
            'legacy_account_correction_batch_id', batch.id,
            'legacy_account_correction_target_id', p_conta_id,
            'archived_at', now()
          )
        WHERE tx.user_id = p_user_id
          AND tx.conta_id = legacy_source_account_id
          AND tx.revertido_em IS NULL
          AND coalesce(tx.metadata, '{}'::jsonb) @> '{"legacy_identity_unconfirmed": true}'::jsonb
          AND fin_is_balance_snapshot_text(tx.descricao)
          AND tx.receita_id IS NULL
          AND tx.despesa_id IS NULL
          AND tx.transferencia_par_id IS NULL
          AND tx.status_conciliacao <> 'conciliado'
          AND NOT EXISTS (
            SELECT 1 FROM fin_conciliacao_alocacoes allocation
            WHERE allocation.user_id = p_user_id AND allocation.transacao_id = tx.id
          )
          AND NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements(p_rows) incoming
            WHERE incoming ->> 'fit_id' = tx.fit_id
          )
        RETURNING id
      )
      SELECT count(*)::integer INTO legacy_snapshot_archived_count FROM archived;

      UPDATE fin_importacoes_extrato legacy_batch SET
        status = CASE WHEN EXISTS (
          SELECT 1 FROM fin_transacoes_ofx remaining
          WHERE remaining.user_id = p_user_id
            AND remaining.importacao_id = legacy_batch.id
            AND remaining.revertido_em IS NULL
        ) THEN 'reversao_parcial' ELSE 'revertida' END,
        metadata = coalesce(legacy_batch.metadata, '{}'::jsonb) || jsonb_build_object(
          'corrected_to_account_id', p_conta_id,
          'correction_import_batch_id', batch.id,
          'corrected_at', now()
        )
      WHERE legacy_batch.user_id = p_user_id
        AND legacy_batch.id = ANY(legacy_batch_ids);
    END IF;

    IF p_balance IS NOT NULL AND p_balance_date IS NOT NULL THEN
      UPDATE fin_contas SET saldo_extrato = p_balance, saldo_extrato_em = p_balance_date
      WHERE id = account.id AND user_id = p_user_id
        AND (saldo_extrato IS NULL OR saldo_extrato_em IS NULL OR saldo_extrato_em < p_balance_date);
      balance_updated := FOUND;
    END IF;

    UPDATE fin_importacoes_extrato SET
      status = 'concluida',
      erro = NULL,
      metadata = coalesce(metadata, '{}'::jsonb)
        || jsonb_build_object(
          'completed_at', now(),
          'atomic_import', true,
          'legacy_account_correction', jsonb_build_object(
            'source_account_id', legacy_source_account_id,
            'moved', legacy_moved_count,
            'linked_moved', legacy_linked_moved_count,
            'balance_snapshots_archived', legacy_snapshot_archived_count
          )
        )
    WHERE id = batch.id AND user_id = p_user_id;
  EXCEPTION WHEN OTHERS THEN
    UPDATE fin_importacoes_extrato SET
      status = coalesce(previous_batch_status, 'falhou'),
      erro = CASE WHEN previous_batch_status IS NULL THEN left(SQLERRM, 1000) ELSE erro END,
      metadata = coalesce(metadata, '{}'::jsonb)
        || jsonb_build_object('last_failed_attempt_at', now(), 'last_failed_attempt', SQLERRM)
    WHERE id = batch.id AND user_id = p_user_id;
    RETURN jsonb_build_object(
      'success', false,
      'batch_id', batch.id,
      'error_code', SQLERRM,
      'error_message', SQLERRM
    );
  END;

  RETURN jsonb_build_object(
    'success', true,
    'batch_id', batch.id,
    'repeated_file', repeated_file,
    'account_linked', account_linked,
    'balance_updated', balance_updated,
    'imported', imported_count,
    'reactivated', reactivated_count,
    'duplicates', duplicate_count,
    'legacy_source_account_id', legacy_source_account_id,
    'legacy_moved', legacy_moved_count,
    'legacy_linked_moved', legacy_linked_moved_count,
    'legacy_balance_snapshots_archived', legacy_snapshot_archived_count,
    'transaction_ids', saved_ids
  );
END;
$$;

DROP FUNCTION IF EXISTS fin_rollback_ofx_import_batch(TEXT, UUID);
CREATE OR REPLACE FUNCTION fin_rollback_ofx_import_batch(
  p_user_id TEXT,
  p_batch_id UUID,
  p_expected_state JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  batch fin_importacoes_extrato%ROWTYPE;
  account fin_contas%ROWTYPE;
  previous_batch fin_importacoes_extrato%ROWTYPE;
  blocker_ids JSONB;
  reverted_ids JSONB;
  actual_state JSONB;
  blocker_count INTEGER := 0;
  reverted_count INTEGER := 0;
  next_status TEXT;
BEGIN
  PERFORM fin_assert_request_user(p_user_id);
  SELECT * INTO batch
  FROM fin_importacoes_extrato
  WHERE id = p_batch_id AND user_id = p_user_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IMPORT_BATCH_NOT_FOUND';
  END IF;
  SELECT * INTO account FROM fin_contas
  WHERE id = batch.conta_id AND user_id = p_user_id
  FOR UPDATE;
  PERFORM 1 FROM fin_transacoes_ofx
  WHERE user_id = p_user_id AND importacao_id = batch.id
  ORDER BY id
  FOR UPDATE;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', tx.id::text,
    'status', tx.status_conciliacao,
    'revertida', tx.revertido_em IS NOT NULL,
    'bloqueada', (
      tx.receita_id IS NOT NULL
      OR tx.despesa_id IS NOT NULL
      OR tx.transferencia_par_id IS NOT NULL
      OR tx.status_conciliacao IN ('transferencia', 'conciliado')
      OR EXISTS (
        SELECT 1 FROM fin_conciliacao_alocacoes allocation
        WHERE allocation.user_id = p_user_id AND allocation.transacao_id = tx.id
      )
    ),
    'motivo', CASE
      WHEN tx.receita_id IS NOT NULL THEN 'receita_conciliada'
      WHEN tx.despesa_id IS NOT NULL THEN 'despesa_conciliada'
      WHEN tx.status_conciliacao = 'conciliado' THEN 'conciliacao_sem_destino'
      WHEN tx.transferencia_par_id IS NOT NULL OR tx.status_conciliacao = 'transferencia' THEN 'transferencia'
      WHEN EXISTS (
        SELECT 1 FROM fin_conciliacao_alocacoes allocation
        WHERE allocation.user_id = p_user_id AND allocation.transacao_id = tx.id
      ) THEN 'repasse_alocado'
      ELSE NULL
    END
  ) ORDER BY tx.id), '[]'::jsonb)
  INTO actual_state
  FROM fin_transacoes_ofx tx
  WHERE tx.user_id = p_user_id AND tx.importacao_id = batch.id;

  IF jsonb_typeof(coalesce(p_expected_state, 'null'::jsonb)) <> 'array'
     OR actual_state IS DISTINCT FROM p_expected_state THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ROLLBACK_PREVIEW_STALE';
  END IF;

  SELECT coalesce(jsonb_agg(tx.id ORDER BY tx.id), '[]'::jsonb), count(*)::integer
  INTO blocker_ids, blocker_count
  FROM fin_transacoes_ofx tx
  WHERE tx.user_id = p_user_id
    AND tx.importacao_id = batch.id
    AND tx.revertido_em IS NULL
    AND (
      tx.receita_id IS NOT NULL
      OR tx.despesa_id IS NOT NULL
      OR tx.transferencia_par_id IS NOT NULL
      OR tx.status_conciliacao IN ('transferencia', 'conciliado')
      OR EXISTS (
        SELECT 1 FROM fin_conciliacao_alocacoes allocation
        WHERE allocation.user_id = p_user_id AND allocation.transacao_id = tx.id
      )
    );

  WITH safe AS (
    SELECT tx.id
    FROM fin_transacoes_ofx tx
    WHERE tx.user_id = p_user_id
      AND tx.importacao_id = batch.id
      AND tx.revertido_em IS NULL
      AND tx.receita_id IS NULL
      AND tx.despesa_id IS NULL
      AND tx.transferencia_par_id IS NULL
      AND tx.status_conciliacao NOT IN ('transferencia', 'conciliado')
      AND NOT EXISTS (
        SELECT 1 FROM fin_conciliacao_alocacoes allocation
        WHERE allocation.user_id = p_user_id AND allocation.transacao_id = tx.id
      )
    FOR UPDATE
  ), reverted AS (
    UPDATE fin_transacoes_ofx tx SET
      revertido_em = now(),
      revertido_motivo = 'rollback_lote:' || batch.id::text,
      status_conciliacao = 'ignorado',
      sugestao_tipo = NULL,
      sugestao_id = NULL,
      sugestao_score = NULL,
      sugestao_motivos = '[]'::jsonb,
      metadata = coalesce(tx.metadata, '{}'::jsonb)
        || jsonb_build_object('rollback_previous', jsonb_build_object(
          'status_conciliacao', tx.status_conciliacao,
          'sugestao_tipo', tx.sugestao_tipo,
          'sugestao_id', tx.sugestao_id,
          'sugestao_score', tx.sugestao_score,
          'sugestao_motivos', tx.sugestao_motivos
        ))
    FROM safe
    WHERE tx.id = safe.id
    RETURNING tx.id
  )
  SELECT coalesce(jsonb_agg(id ORDER BY id), '[]'::jsonb), count(*)::integer
  INTO reverted_ids, reverted_count
  FROM reverted;

  next_status := CASE WHEN blocker_count > 0 THEN 'reversao_parcial' ELSE 'revertida' END;
  UPDATE fin_importacoes_extrato SET
    status = next_status,
    erro = CASE WHEN blocker_count > 0
      THEN blocker_count || ' movimentação(ões) possuem vínculo e foram preservadas.'
      ELSE NULL
    END,
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'rollback_at', now(),
      'rollback_reverted', reverted_count,
      'rollback_blocked', blocker_count,
      'rollback_blocker_ids', blocker_ids
    )
  WHERE id = batch.id AND user_id = p_user_id;

  IF blocker_count = 0
     AND batch.saldo_final IS NOT NULL
     AND account.saldo_extrato_em IS NOT DISTINCT FROM batch.data_fim
     AND round(account.saldo_extrato * 100) = round(batch.saldo_final * 100) THEN
    SELECT * INTO previous_batch
    FROM fin_importacoes_extrato candidate
    WHERE candidate.user_id = p_user_id
      AND candidate.conta_id = batch.conta_id
      AND candidate.id <> batch.id
      AND candidate.status = 'concluida'
      AND candidate.saldo_final IS NOT NULL
      AND candidate.data_fim IS NOT NULL
    ORDER BY candidate.data_fim DESC, candidate.created_at DESC
    LIMIT 1;
    UPDATE fin_contas SET
      saldo_extrato = CASE WHEN previous_batch.id IS NULL THEN NULL ELSE previous_batch.saldo_final END,
      saldo_extrato_em = CASE WHEN previous_batch.id IS NULL THEN NULL ELSE previous_batch.data_fim END
    WHERE id = account.id AND user_id = p_user_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'batch_id', batch.id,
    'status', next_status,
    'revertidas', reverted_count,
    'bloqueadas', blocker_count,
    'transacoes_revertidas', reverted_ids,
    'transacoes_bloqueadas', blocker_ids
  );
END;
$$;

CREATE OR REPLACE FUNCTION fin_setup_infinitepay(p_user_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  account_ids UUID[];
  method_ids UUID[];
  account fin_contas%ROWTYPE;
  method fin_meios%ROWTYPE;
  account_created BOOLEAN := false;
  method_renamed BOOLEAN := false;
  method_linked BOOLEAN := false;
BEGIN
  PERFORM fin_assert_request_user(p_user_id);
  PERFORM 1 FROM fin_contas WHERE user_id = p_user_id ORDER BY id FOR UPDATE;
  PERFORM 1 FROM fin_meios WHERE user_id = p_user_id ORDER BY id FOR UPDATE;

  SELECT array_agg(id ORDER BY id) INTO account_ids
  FROM fin_contas
  WHERE user_id = p_user_id
    AND ativo = true
    AND tipo = 'intermediador'
    AND (
      fin_normalize_identity_key(nome) LIKE '%infinitepay%'
      OR fin_normalize_identity_key(nome) LIKE '%infinitypay%'
      OR fin_normalize_identity_key(nome) LIKE '%cloudwalk%'
      OR fin_normalize_identity_key(banco) LIKE '%infinitepay%'
      OR fin_normalize_identity_key(banco) LIKE '%infinitypay%'
      OR fin_normalize_identity_key(banco) LIKE '%cloudwalk%'
    );
  IF EXISTS (
    SELECT 1 FROM fin_contas
    WHERE user_id = p_user_id
      AND ativo = true
      AND tipo <> 'intermediador'
      AND (
        fin_normalize_identity_key(nome) LIKE '%infinitepay%'
        OR fin_normalize_identity_key(nome) LIKE '%infinitypay%'
        OR fin_normalize_identity_key(nome) LIKE '%cloudwalk%'
        OR fin_normalize_identity_key(banco) LIKE '%infinitepay%'
        OR fin_normalize_identity_key(banco) LIKE '%infinitypay%'
        OR fin_normalize_identity_key(banco) LIKE '%cloudwalk%'
      )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INFINITEPAY_ACCOUNT_TYPE_CONFLICT';
  END IF;
  IF coalesce(array_length(account_ids, 1), 0) > 1 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INFINITEPAY_ACCOUNT_CONFLICT';
  END IF;

  SELECT array_agg(id ORDER BY id) INTO method_ids
  FROM fin_meios
  WHERE user_id = p_user_id
    AND ativo = true
    AND (
      fin_normalize_identity_key(nome) IN (
        'link', 'linkdepagamento', 'linkinfinitepay',
        'cartaodecredito', 'cartaocredito', 'credito'
      )
      OR fin_normalize_identity_key(nome) LIKE '%infinitepay%'
      OR fin_normalize_identity_key(nome) LIKE '%infinitypay%'
      OR fin_normalize_identity_key(nome) LIKE '%cloudwalk%'
    );
  IF coalesce(array_length(method_ids, 1), 0) = 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INFINITEPAY_METHOD_MISSING';
  END IF;
  IF array_length(method_ids, 1) > 1 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INFINITEPAY_METHOD_CONFLICT';
  END IF;

  IF coalesce(array_length(account_ids, 1), 0) = 0 THEN
    INSERT INTO fin_contas (user_id, nome, tipo, banco, saldo_inicial, ativo)
    VALUES (p_user_id, 'InfinitePay', 'intermediador', 'InfinitePay', 0, true)
    RETURNING * INTO account;
    account_created := true;
  ELSE
    SELECT * INTO account FROM fin_contas WHERE id = account_ids[1];
  END IF;
  SELECT * INTO method FROM fin_meios WHERE id = method_ids[1];
  method_renamed := method.nome <> 'Link InfinitePay';
  method_linked := method.conta_id IS DISTINCT FROM account.id;
  IF method_renamed OR method_linked THEN
    UPDATE fin_meios SET nome = 'Link InfinitePay', conta_id = account.id
    WHERE id = method.id AND user_id = p_user_id
    RETURNING * INTO method;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'ready', true,
    'account_created', account_created,
    'method_renamed', method_renamed,
    'method_linked', method_linked,
    'account', to_jsonb(account),
    'method', to_jsonb(method)
  );
END;
$$;

REVOKE ALL ON FUNCTION fin_assert_request_user(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION fin_reconcile_ofx_transaction(TEXT, UUID, UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION fin_unreconcile_ofx_transaction(TEXT, UUID, TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION fin_set_ofx_transfer_pair(TEXT, UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION fin_unset_ofx_transfer_pair(TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION fin_apply_processor_settlement(TEXT, UUID, UUID[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION fin_undo_processor_settlement(TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION fin_import_ofx_batch_v2(TEXT, UUID, JSONB, JSONB, TEXT, TEXT, NUMERIC, DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION fin_import_ofx_batch_v2(TEXT, UUID, JSONB, JSONB, TEXT, TEXT, NUMERIC, DATE) FROM authenticated;
REVOKE ALL ON FUNCTION fin_rollback_ofx_import_batch(TEXT, UUID, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION fin_setup_infinitepay(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fin_assert_request_user(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION fin_reconcile_ofx_transaction(TEXT, UUID, UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION fin_unreconcile_ofx_transaction(TEXT, UUID, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION fin_set_ofx_transfer_pair(TEXT, UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION fin_unset_ofx_transfer_pair(TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION fin_apply_processor_settlement(TEXT, UUID, UUID[]) TO authenticated;
GRANT EXECUTE ON FUNCTION fin_undo_processor_settlement(TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION fin_rollback_ofx_import_batch(TEXT, UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION fin_setup_infinitepay(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION fin_reconcile_ofx_transaction(TEXT, UUID, UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION fin_unreconcile_ofx_transaction(TEXT, UUID, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION fin_set_ofx_transfer_pair(TEXT, UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION fin_unset_ofx_transfer_pair(TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION fin_apply_processor_settlement(TEXT, UUID, UUID[]) TO service_role;
GRANT EXECUTE ON FUNCTION fin_undo_processor_settlement(TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION fin_import_ofx_batch_v2(TEXT, UUID, JSONB, JSONB, TEXT, TEXT, NUMERIC, DATE) TO service_role;
GRANT EXECUTE ON FUNCTION fin_rollback_ofx_import_batch(TEXT, UUID, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION fin_setup_infinitepay(TEXT) TO service_role;

REVOKE INSERT, UPDATE, DELETE ON fin_importacoes_extrato FROM authenticated, service_role;
REVOKE INSERT, UPDATE, DELETE ON fin_conciliacao_alocacoes FROM authenticated, service_role;
REVOKE INSERT, UPDATE, DELETE ON fin_transacoes_ofx FROM authenticated;
GRANT SELECT ON fin_importacoes_extrato TO authenticated, service_role;
GRANT SELECT ON fin_conciliacao_alocacoes TO authenticated, service_role;
GRANT SELECT ON fin_transacoes_ofx TO authenticated, service_role;
GRANT SELECT ON fin_contas_identidade_conflitos TO authenticated, service_role;

COMMENT ON COLUMN fin_transacoes_ofx.fingerprint IS
  'SHA-256 estável da identidade bancária; usa FITID ou campos OFX mais ordinal da ocorrência.';
COMMENT ON COLUMN fin_receitas.origem_ref IS
  'Chave externa idempotente, por exemplo job_payment:<id> ou job_balance:<job_id>.';
COMMENT ON COLUMN fin_despesas.origem_ref IS
  'Chave externa idempotente para criação e desfazimento seguro de despesas.';

COMMIT;

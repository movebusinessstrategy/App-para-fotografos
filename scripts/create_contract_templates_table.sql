-- ============================================================
-- MODELOS DE CONTRATO — Script de criação da tabela
-- Execute no Supabase SQL Editor (Dashboard > SQL Editor)
-- Idempotente: pode rodar de novo sem quebrar.
-- ============================================================

-- Modelos de contrato por usuário (templates reusáveis)
CREATE TABLE IF NOT EXISTS contract_templates (
  id              BIGSERIAL PRIMARY KEY,
  user_id         TEXT    NOT NULL,
  name            TEXT    NOT NULL,
  category        TEXT    NOT NULL,           -- ex: 'NEWBORN', 'GESTANTE', 'CASAL'
  body            TEXT    NOT NULL,           -- texto do contrato com placeholders {{var}}
  default_data    JSONB   NOT NULL DEFAULT '{}'::jsonb,  -- valores sugeridos: valor, prazo, etc
  is_default      BOOLEAN NOT NULL DEFAULT false,        -- modelo padrão da categoria
  is_legacy       BOOLEAN NOT NULL DEFAULT false,        -- modelo antigo (gerador JSX hardcoded)
  archived        BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS contract_templates_user_id_idx   ON contract_templates(user_id);
CREATE INDEX IF NOT EXISTS contract_templates_category_idx  ON contract_templates(category);

-- Coluna no contracts pra apontar pro modelo usado
ALTER TABLE contracts
  ADD COLUMN IF NOT EXISTS template_id BIGINT;

CREATE INDEX IF NOT EXISTS contracts_template_id_idx ON contracts(template_id);

-- ============================================================
-- Row Level Security (RLS)
-- ============================================================
ALTER TABLE contract_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "contract_templates_user" ON contract_templates;
CREATE POLICY "contract_templates_user"
  ON contract_templates
  USING (user_id = auth.uid()::text)
  WITH CHECK (user_id = auth.uid()::text);

-- ============================================================
-- MÓDULO DE CONTRATOS — Script de criação das tabelas
-- Execute no Supabase SQL Editor (Dashboard > SQL Editor)
-- Idempotente: pode rodar de novo sem quebrar.
-- ============================================================

-- 1. Configurações do estúdio (por usuário) + integração Autentique
CREATE TABLE IF NOT EXISTS studio_settings (
  user_id                  TEXT PRIMARY KEY,
  studio_name              TEXT,
  studio_cnpj              TEXT,
  studio_address           TEXT,
  studio_responsible       TEXT,
  studio_responsible_cpf   TEXT,
  studio_city              TEXT,
  down_payment_percent     INT  NOT NULL DEFAULT 30,
  installments             INT  NOT NULL DEFAULT 6,
  extra_photo_price        TEXT NOT NULL DEFAULT '35,00',
  delivery_days_selection  INT  NOT NULL DEFAULT 2,
  selection_deadline_days  INT  NOT NULL DEFAULT 5,
  delivery_days            INT  NOT NULL DEFAULT 30,
  signing_city             TEXT,
  autentique_api_key       TEXT,           -- chave da Autentique do tenant
  autentique_sandbox       BOOLEAN NOT NULL DEFAULT false,
  updated_at               TIMESTAMPTZ DEFAULT now()
);

-- 2. Contratos
CREATE TABLE IF NOT EXISTS contracts (
  id              BIGSERIAL PRIMARY KEY,
  user_id         TEXT NOT NULL,
  client_id       BIGINT NOT NULL,           -- FK lógica para clients(id)
  job_id          BIGINT,                    -- FK lógica opcional para jobs(id)
  status          TEXT NOT NULL DEFAULT 'draft',
                  -- valores: 'draft' | 'pending_signature' | 'signed' | 'cancelled'
  contract_data   JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- signers: [{ role: 'contratada'|'contratante', name, email, phone?, status: 'pending'|'signed', signed_at? }]
  signers         JSONB NOT NULL DEFAULT '[]'::jsonb,
  autentique_id   TEXT,                      -- id do documento na Autentique
  signed_at       TIMESTAMPTZ,
  signed_pdf_url  TEXT,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS contracts_user_id_idx    ON contracts(user_id);
CREATE INDEX IF NOT EXISTS contracts_status_idx     ON contracts(status);
CREATE INDEX IF NOT EXISTS contracts_client_id_idx  ON contracts(client_id);
CREATE INDEX IF NOT EXISTS contracts_job_id_idx     ON contracts(job_id);

-- ============================================================
-- Row Level Security (RLS) — cada usuário só vê seus dados
-- Mesmo padrão de scripts/create_financial_tables.sql
-- ============================================================
ALTER TABLE studio_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE contracts       ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "studio_settings_user" ON studio_settings;
CREATE POLICY "studio_settings_user"
  ON studio_settings
  USING (user_id = auth.uid()::text)
  WITH CHECK (user_id = auth.uid()::text);

DROP POLICY IF EXISTS "contracts_user" ON contracts;
CREATE POLICY "contracts_user"
  ON contracts
  USING (user_id = auth.uid()::text)
  WITH CHECK (user_id = auth.uid()::text);

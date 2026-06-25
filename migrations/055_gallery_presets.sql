-- migrations/055_gallery_presets.sql
-- Presets/categorias de galeria (ex.: "Gestante Basic", "Gestante Premium").
-- Cada preset guarda nº de fotos incluídas, valor da foto extra, prazo (em dias
-- a partir da criação) e a configuração de cobrança/descontos (config JSONB).
-- Ao criar uma galeria, escolher um preset preenche tudo automaticamente.
-- Execute no Supabase SQL Editor. Idempotente.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS gallery_presets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         TEXT NOT NULL,
  name            TEXT NOT NULL,
  category        TEXT,
  included_count  INT NOT NULL DEFAULT 0,
  extra_price     NUMERIC NOT NULL DEFAULT 0,
  deadline_days   INT,                         -- nº de dias até o prazo (null = sem prazo)
  config          JSONB NOT NULL DEFAULT '{}'::jsonb,  -- pricing_mode, cart_discount, discount_mode, discount_single_pct, discount_rules
  sort_order      INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gallery_presets_user ON gallery_presets(user_id);

ALTER TABLE gallery_presets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "gallery_presets_user_all" ON gallery_presets;
CREATE POLICY "gallery_presets_user_all"
  ON gallery_presets
  FOR ALL
  USING (user_id = auth.uid()::text)
  WITH CHECK (user_id = auth.uid()::text);

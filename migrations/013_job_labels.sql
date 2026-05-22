-- Paleta de etiquetas da Produção: etiquetas padronizadas (nome + cor)
-- reutilizáveis nos cards de trabalhos — estilo Trello.
-- Espelha a tabela pipeline_labels (paleta do funil de Vendas).
-- Execute no Supabase SQL Editor (Dashboard > SQL Editor). Idempotente.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS job_labels (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     TEXT NOT NULL,
  name        TEXT NOT NULL,
  color       TEXT NOT NULL DEFAULT '#6B7280',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_job_labels_user ON job_labels(user_id);

ALTER TABLE job_labels ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "job_labels_user_all" ON job_labels;
CREATE POLICY "job_labels_user_all"
  ON job_labels
  FOR ALL
  USING (user_id = auth.uid()::text)
  WITH CHECK (user_id = auth.uid()::text);

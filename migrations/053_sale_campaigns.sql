-- migrations/053_sale_campaigns.sql
-- Campanhas de "venda especial" (Natal, Dia das Mães, Black Friday...).
-- Cada negócio (deals) pode pertencer a UMA campanha via deals.campaign_id,
-- para agrupar e medir quanto cada campanha vendeu no período.
-- Espelha pipeline_labels (paleta do funil) + padrão de coluna idempotente.
-- Execute no Supabase SQL Editor. Idempotente.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS sale_campaigns (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     TEXT NOT NULL,
  name        TEXT NOT NULL,
  color       TEXT NOT NULL DEFAULT '#6B7280',
  starts_at   TIMESTAMPTZ,
  ends_at     TIMESTAMPTZ,
  active       BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sale_campaigns_user ON sale_campaigns(user_id);

ALTER TABLE sale_campaigns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sale_campaigns_user_all" ON sale_campaigns;
CREATE POLICY "sale_campaigns_user_all"
  ON sale_campaigns
  FOR ALL
  USING (user_id = auth.uid()::text)
  WITH CHECK (user_id = auth.uid()::text);

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS campaign_id UUID;

CREATE INDEX IF NOT EXISTS idx_deals_campaign ON deals(campaign_id);

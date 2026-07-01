-- migrations/057_whatsapp_stage_labels.sql
-- Mapa ESTÁVEL etapa do funil → etiqueta do WhatsApp Business (por conta).
-- O app CRIA e gerencia as próprias etiquetas do WhatsApp (via Baileys). Como o
-- Baileys não tem "getLabels", guardamos aqui o label_id que atribuímos a cada
-- etapa — precisa ser estável entre reinícios do servidor (o Render redeploya
-- direto): sem isso o id mudaria a cada boot e a "troca" de etiqueta acumularia
-- várias etiquetas no mesmo chat em vez de substituir.
-- Etiquetas SÓ existem em conta WhatsApp Business.
-- Execute no Supabase SQL Editor. Idempotente.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS whatsapp_stage_labels (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     TEXT NOT NULL,
  stage_id    TEXT NOT NULL,        -- id da etapa do funil (deal_stages.id)
  label_id    TEXT NOT NULL,        -- id da etiqueta no WhatsApp (numérico, atribuído pelo app)
  stage_name  TEXT,                 -- nome da etapa no momento da criação (referência)
  color       INT NOT NULL DEFAULT 4, -- índice de cor do WhatsApp Business (0..19)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, stage_id)
);

CREATE INDEX IF NOT EXISTS idx_wa_stage_labels_user ON whatsapp_stage_labels(user_id);

ALTER TABLE whatsapp_stage_labels ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "wa_stage_labels_user_all" ON whatsapp_stage_labels;
CREATE POLICY "wa_stage_labels_user_all"
  ON whatsapp_stage_labels
  FOR ALL
  USING (user_id = auth.uid()::text)
  WITH CHECK (user_id = auth.uid()::text);

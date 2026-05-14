-- ============================================================
-- TEMPLATES DE MENSAGEM DO WHATSAPP — Script de criação da tabela
-- Execute no Supabase SQL Editor (Dashboard > SQL Editor)
-- Idempotente: pode rodar de novo sem quebrar.
-- ============================================================

-- Cache local dos templates de mensagem do WhatsApp.
-- A fonte da verdade é o Meta; esta tabela acelera a UI e guarda o
-- vínculo com etapas do funil.
CREATE TABLE IF NOT EXISTS whatsapp_message_templates (
  id                BIGSERIAL PRIMARY KEY,
  user_id           TEXT    NOT NULL,
  meta_template_id  TEXT,                        -- id do template no Meta
  name              TEXT    NOT NULL,            -- nome (lowercase, underscores)
  category          TEXT    NOT NULL DEFAULT 'UTILITY',  -- UTILITY | MARKETING | AUTHENTICATION
  language          TEXT    NOT NULL DEFAULT 'pt_BR',
  body_text         TEXT    NOT NULL,            -- corpo com {{1}}, {{2}}, ...
  example_values    JSONB   NOT NULL DEFAULT '[]'::jsonb,  -- exemplos das variáveis
  status            TEXT    NOT NULL DEFAULT 'PENDING',     -- PENDING | APPROVED | REJECTED
  rejection_reason  TEXT,
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS wa_templates_user_id_idx ON whatsapp_message_templates(user_id);
-- nome é único por usuário (o Meta exige nome único por WABA)
CREATE UNIQUE INDEX IF NOT EXISTS wa_templates_user_name_idx
  ON whatsapp_message_templates(user_id, name);

-- Vínculo opcional: cada etapa do funil pode disparar um template específico
-- quando o follow-up cair fora da janela de 24h.
ALTER TABLE deal_stages
  ADD COLUMN IF NOT EXISTS follow_up_template_id BIGINT;

-- ============================================================
-- Row Level Security (RLS)
-- ============================================================
ALTER TABLE whatsapp_message_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "wa_templates_user" ON whatsapp_message_templates;
CREATE POLICY "wa_templates_user"
  ON whatsapp_message_templates
  USING (user_id = auth.uid()::text)
  WITH CHECK (user_id = auth.uid()::text);

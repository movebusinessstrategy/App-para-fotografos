-- ============================================================
-- SUPORTE A TEMPLATE NOS FOLLOW-UPS (Fase 3)
-- Execute no Supabase SQL Editor (Dashboard > SQL Editor)
-- Idempotente: pode rodar de novo sem quebrar.
-- ============================================================

-- O worker de follow-up precisa do nome do contato pra preencher
-- a variável {{1}} do template quando o envio cair fora da janela 24h.
ALTER TABLE scheduled_followups
  ADD COLUMN IF NOT EXISTS contact_name TEXT;

-- Observação: a coluna deal_stages.follow_up_template_id já foi criada
-- na migração create_whatsapp_templates_table.sql.

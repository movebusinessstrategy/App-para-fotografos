-- ============================================================
-- CABEÇALHO, RODAPÉ E BOTÕES NOS TEMPLATES DE WHATSAPP
-- Execute no Supabase SQL Editor (Dashboard > SQL Editor)
-- Idempotente: pode rodar de novo sem quebrar.
-- ============================================================

-- Componentes opcionais do template, todos estáticos (sem variáveis).
-- Só o corpo (body_text) usa {{N}} — assim o envio não precisa mudar.
ALTER TABLE whatsapp_message_templates
  ADD COLUMN IF NOT EXISTS header_text TEXT,                       -- cabeçalho de texto
  ADD COLUMN IF NOT EXISTS footer_text TEXT,                       -- rodapé
  ADD COLUMN IF NOT EXISTS buttons JSONB NOT NULL DEFAULT '[]'::jsonb;
  -- buttons: [{ type: 'QUICK_REPLY'|'URL'|'PHONE_NUMBER', text, url?, phone_number? }]

-- Campos extras do agente de IA:
--  - objective: objetivo e fluxo do atendimento (o que é "atendimento fechado")
--  - rules:     regras e limites — o que o agente NUNCA pode fazer ou falar
-- Execute no Supabase SQL Editor (Dashboard > SQL Editor). Idempotente.

ALTER TABLE ai_agent_config
  ADD COLUMN IF NOT EXISTS objective TEXT,
  ADD COLUMN IF NOT EXISTS rules     TEXT;

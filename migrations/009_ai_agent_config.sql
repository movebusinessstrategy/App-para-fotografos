-- Configuração do agente de IA de atendimento no WhatsApp.
-- Uma linha por conta: guarda a persona/tom de voz, a base de conhecimento
-- (pacotes, horários, políticas) e o liga/desliga das sugestões.
-- Execute no Supabase SQL Editor (Dashboard > SQL Editor). Idempotente.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS ai_agent_config (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     TEXT NOT NULL UNIQUE,
  enabled     BOOLEAN NOT NULL DEFAULT false,
  persona     TEXT,
  knowledge   TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE ai_agent_config ENABLE ROW LEVEL SECURITY;

-- Dono acessa a própria config via JWT; membros passam pelo backend
-- com a service role key (que ignora RLS).
DROP POLICY IF EXISTS "ai_agent_config_user_all" ON ai_agent_config;
CREATE POLICY "ai_agent_config_user_all"
  ON ai_agent_config
  FOR ALL
  USING (user_id = auth.uid()::text)
  WITH CHECK (user_id = auth.uid()::text);

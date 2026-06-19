-- Rode no SQL Editor do Supabase. Idempotente.
--
-- Nome do atendente que a Lia "assume" no atendimento. Usado na apresentação da
-- 1ª mensagem ("Meu nome é XXXXX, faço parte do time do ...").

ALTER TABLE ai_agent_config ADD COLUMN IF NOT EXISTS attendant_name text;

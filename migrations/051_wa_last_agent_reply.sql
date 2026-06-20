-- Rode no SQL Editor do Supabase. Idempotente.
--
-- Marca o momento em que a Lia (autônomo) respondeu pela última vez numa conversa.
-- Usado pelo painel "Atendimentos da Lia" (Fase 3) pra listar quem ela está
-- atendendo / passou pra humano. NULL = a Lia nunca respondeu essa conversa.

ALTER TABLE wa_conversations ADD COLUMN IF NOT EXISTS last_agent_reply_at timestamptz;

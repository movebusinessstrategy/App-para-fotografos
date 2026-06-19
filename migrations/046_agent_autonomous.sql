-- Rode no SQL Editor do Supabase. Idempotente.
--
-- Fase C — atendimento autônomo (semi-automático) da Lia.
-- auto_send: liga/desliga a Lia responder SOZINHA (nasce desligado, opt-in).
-- needs_human: marca a conversa quando a Lia decide passar pra equipe (preço,
--   fechamento, objeção forte, cliente pediu humano) — sinal INTERNO, o cliente
--   não recebe aviso de "vou te transferir".

ALTER TABLE ai_agent_config   ADD COLUMN IF NOT EXISTS auto_send   boolean NOT NULL DEFAULT false;
ALTER TABLE wa_conversations   ADD COLUMN IF NOT EXISTS needs_human boolean NOT NULL DEFAULT false;

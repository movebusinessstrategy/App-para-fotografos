-- Rode no SQL Editor do Supabase. Idempotente.
--
-- Marca se a ÚLTIMA mensagem da conversa foi enviada por nós (estúdio). Usado
-- na lista de conversas pra mostrar o ✓✓ antes do preview — igual ao WhatsApp —
-- pra saber "já respondi essa pessoa" sem abrir a conversa.

ALTER TABLE wa_conversations ADD COLUMN IF NOT EXISTS last_from_me boolean NOT NULL DEFAULT false;

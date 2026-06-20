-- Rode no SQL Editor do Supabase. Idempotente.
--
-- Reconhecer clientes antigos no atendimento autônomo: quando ligado, a Lia
-- cruza o telefone com a base de clientes (clients/jobs) e atende com
-- proximidade (nome, filho/bebê, ensaios anteriores). Opt-in por estúdio.

ALTER TABLE ai_agent_config ADD COLUMN IF NOT EXISTS use_client_history boolean NOT NULL DEFAULT false;

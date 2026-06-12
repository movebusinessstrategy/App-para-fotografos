-- Rode no SQL Editor do Supabase. Idempotente.
--
-- Galeria de proofing — presets de prazo personalizáveis.
-- Cada estúdio pode personalizar os atalhos do calendário do prazo
-- (default: 7, 15, 30 dias). Até 6 valores, entre 1 e 365.

ALTER TABLE gallery_settings ADD COLUMN IF NOT EXISTS deadline_presets JSONB NOT NULL DEFAULT '[7, 15, 30]'::jsonb;

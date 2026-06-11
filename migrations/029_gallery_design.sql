-- Rode no SQL Editor do Supabase. Idempotente.
--
-- Galeria de proofing — Fase 3 (Design).
-- Adiciona campos de aparência da galeria (capa, tipografia, cor) pra
-- cada estúdio personalizar como a página pública aparece pra cliente.

ALTER TABLE galleries ADD COLUMN IF NOT EXISTS cover_layout  TEXT NOT NULL DEFAULT 'classic';
  -- classic | cover | paper | photobook | artist
ALTER TABLE galleries ADD COLUMN IF NOT EXISTS font_family   TEXT NOT NULL DEFAULT 'sans';
  -- serifa | sans | manuscrita | slab
ALTER TABLE galleries ADD COLUMN IF NOT EXISTS primary_color TEXT NOT NULL DEFAULT '#D4537E';

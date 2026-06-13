-- Rode no SQL Editor do Supabase. Idempotente.
--
-- Diagramação de álbum — modo LIVRE (estilo DesignBox).
-- Cada página (capa, lâmina, contracapa) deixa de ser só slots fixos e
-- passa a guardar o desenho livre como JSON do fabric.js em canvas_json.
-- 'kind' separa capa / lâmina / contracapa. template_id/slots continuam
-- existindo (atalho de ponto de partida), mas canvas_json é a verdade.

ALTER TABLE album_spreads ADD COLUMN IF NOT EXISTS canvas_json JSONB;
ALTER TABLE album_spreads ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'spread';
  -- 'cover' (capa) | 'spread' (lâmina) | 'backcover' (contracapa)

-- album_assets guarda a URL utilizável direto pelo editor (foto LIMPA,
-- sem marca d'água, quando vem da galeria — é foto do próprio estúdio).
ALTER TABLE album_assets ADD COLUMN IF NOT EXISTS full_path TEXT;
  -- caminho do arquivo (sem marca) no bucket album-assets
ALTER TABLE album_assets ADD COLUMN IF NOT EXISTS source_ref TEXT;
  -- referência da origem (original_path da galeria) p/ idempotência do import

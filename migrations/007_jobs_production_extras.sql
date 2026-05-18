-- Extras pra Produção:
-- - position: ordem manual dentro da etapa (drag-and-drop estilo Trello)
-- - cover_image_url: imagem de referência (capa de álbum, edição, etc)
ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS position INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cover_image_url TEXT;

-- Índice ajuda na ordenação dentro da etapa
CREATE INDEX IF NOT EXISTS idx_jobs_stage_position
  ON jobs(production_stage, position)
  WHERE production_stage IS NOT NULL;

-- ============================================================================
-- 033_album
-- Rode no SQL Editor do Supabase. Idempotente.
-- ============================================================================
--
-- Diagramação de álbum — editor visual de lâminas (spreads = 2 páginas).
-- SAÍDA = só prévia visual pra aprovar (SEM PDF de gráfica).
-- Fotos vêm da galeria de proofing (selecionadas) E de upload próprio.
-- Fotógrafo E cliente montam. Link público em /a/:token.
-- Bucket: album-assets (PÚBLICO — saída é só prévia, original não precisa
-- de bucket privado).

-- Projeto de álbum (1 por job/galeria, ou avulso).
CREATE TABLE IF NOT EXISTS album_projects (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           TEXT NOT NULL,
  job_id            BIGINT,
  gallery_id        UUID,
  client_id         BIGINT,
  client_name       TEXT,
  client_email      TEXT,
  client_phone      TEXT,
  title             TEXT NOT NULL,
  size              TEXT NOT NULL DEFAULT 'sq30', -- sq30|sq20|land40x30|port20x30
  status            TEXT NOT NULL DEFAULT 'draft', -- draft|sent|approved
  share_token       TEXT UNIQUE NOT NULL,
  allow_client_edit BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_album_projects_user ON album_projects(user_id);
CREATE INDEX IF NOT EXISTS idx_album_projects_job ON album_projects(job_id);

-- Fotos disponíveis pra arrastar nos templates (upload próprio ou importadas
-- da galeria de proofing selecionadas).
CREATE TABLE IF NOT EXISTS album_assets (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  album_id      UUID NOT NULL REFERENCES album_projects(id) ON DELETE CASCADE,
  source        TEXT NOT NULL DEFAULT 'upload', -- upload|gallery
  preview_path  TEXT,
  thumb_path    TEXT,
  original_name TEXT,
  sort_order    INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_album_assets_album ON album_assets(album_id);

-- Lâminas do álbum (cada lâmina = 2 páginas, esquerda + direita).
-- slots = jsonb com qual asset ocupa cada posição do template.
CREATE TABLE IF NOT EXISTS album_spreads (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  album_id    UUID NOT NULL REFERENCES album_projects(id) ON DELETE CASCADE,
  position    INT NOT NULL DEFAULT 0,
  template_id TEXT NOT NULL DEFAULT 'classico',
  slots       JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_album_spreads_album ON album_spreads(album_id);

-- RLS habilitado (acesso só via service role no backend, igual à galeria —
-- toda query filtra por user_id na camada da aplicação).
ALTER TABLE album_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE album_assets   ENABLE ROW LEVEL SECURITY;
ALTER TABLE album_spreads  ENABLE ROW LEVEL SECURITY;

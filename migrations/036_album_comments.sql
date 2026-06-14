-- Rode no SQL Editor do Supabase. Idempotente.
--
-- Comentários do cliente no álbum: durante a revisão, o cliente pode pedir
-- ajustes ("gostei, mas troca essa foto da capa", "diminui essa", etc.) antes
-- de aprovar. O estúdio vê tudo e marca como resolvido.

CREATE TABLE IF NOT EXISTS album_comments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  album_id        UUID NOT NULL REFERENCES album_projects(id) ON DELETE CASCADE,
  access_user_id  UUID REFERENCES album_access_users(id) ON DELETE SET NULL,
  author_name     TEXT,            -- nome de quem comentou (mostra mesmo sem login)
  spread_position INT,             -- página referente (NULL = comentário geral)
  body            TEXT NOT NULL,
  resolved        BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_album_comments_album ON album_comments(album_id, created_at DESC);

ALTER TABLE album_comments ENABLE ROW LEVEL SECURITY;

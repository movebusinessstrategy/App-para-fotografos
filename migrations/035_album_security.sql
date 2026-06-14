-- Rode no SQL Editor do Supabase. Idempotente.
--
-- Diagramação de álbum — camada de segurança e auditoria.
-- Mesmo padrão da galeria (028): além do "link público com share_token",
-- o estúdio pode exigir login (e-mail + senha) e TODAS as ações do cliente
-- ficam registradas (entrou, abriu, editou, aprovou) — prova de que o
-- cliente realmente aprovou aquele layout.

-- Login de quem acessa o álbum. Pode ter mais de um por álbum
-- (cliente principal + convidados). Senha em bcrypt.
CREATE TABLE IF NOT EXISTS album_access_users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  album_id        UUID NOT NULL REFERENCES album_projects(id) ON DELETE CASCADE,
  email           TEXT NOT NULL,
  password_hash   TEXT NOT NULL,
  name            TEXT,
  role            TEXT NOT NULL DEFAULT 'owner', -- owner | guest
  invited_by      TEXT, -- user_id do estúdio que adicionou
  last_login_at   TIMESTAMPTZ,
  login_count     INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (album_id, email)
);
CREATE INDEX IF NOT EXISTS idx_alb_access_users_album ON album_access_users(album_id);

-- Log de tudo que aconteceu no álbum (cliente ou convidado).
-- Cada linha = uma ação. event in (login, login_fail, view_album,
-- edit_album, approve).
CREATE TABLE IF NOT EXISTS album_access_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  album_id        UUID NOT NULL REFERENCES album_projects(id) ON DELETE CASCADE,
  access_user_id  UUID REFERENCES album_access_users(id) ON DELETE SET NULL,
  event           TEXT NOT NULL,
  detail          TEXT, -- e-mail tentado, página editada, etc
  ip              TEXT,
  user_agent      TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_alb_access_log_album ON album_access_log(album_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alb_access_log_event ON album_access_log(album_id, event);

-- Álbum ganha controle de login (igual a galeria).
ALTER TABLE album_projects ADD COLUMN IF NOT EXISTS require_login BOOLEAN NOT NULL DEFAULT false;

-- RLS ligado nas tabelas novas. O backend acessa via service role (igual ao
-- resto do álbum); o cliente final passa pela API pública que valida a sessão.
ALTER TABLE album_access_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE album_access_log   ENABLE ROW LEVEL SECURITY;

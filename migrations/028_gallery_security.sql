-- Rode no SQL Editor do Supabase. Idempotente.
--
-- Galeria de proofing — camada de segurança e auditoria.
-- Substitui o "link público com share_token" por login (e-mail + senha)
-- com registro de todas as ações (visualizar, selecionar, comentar,
-- finalizar) — usado pelo estúdio pra prova judicial caso a cliente
-- alegue não ter selecionado certa foto.

-- Login de quem acessa a galeria. Pode ter mais de um por galeria
-- (cliente principal + convidados: pai, mãe, avó). Senha em bcrypt.
CREATE TABLE IF NOT EXISTS gallery_access_users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gallery_id      UUID NOT NULL REFERENCES galleries(id) ON DELETE CASCADE,
  email           TEXT NOT NULL,
  password_hash   TEXT NOT NULL,
  name            TEXT,
  role            TEXT NOT NULL DEFAULT 'owner', -- owner | guest
  invited_by      TEXT, -- user_id do estúdio que adicionou
  last_login_at   TIMESTAMPTZ,
  login_count     INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (gallery_id, email)
);
CREATE INDEX IF NOT EXISTS idx_gal_access_users_gallery ON gallery_access_users(gallery_id);

-- Log de tudo que aconteceu na galeria (cliente ou convidado).
-- Cada linha = uma ação. event in (login, login_fail, view_gallery,
-- view_photo, select_photo, unselect_photo, comment_photo, finalize,
-- pay_attempt, pay_success).
CREATE TABLE IF NOT EXISTS gallery_access_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gallery_id      UUID NOT NULL REFERENCES galleries(id) ON DELETE CASCADE,
  access_user_id  UUID REFERENCES gallery_access_users(id) ON DELETE SET NULL,
  event           TEXT NOT NULL,
  photo_id        UUID, -- preenchido em view_photo/select_photo/comment_photo
  detail          TEXT, -- comentário, valor pago, etc
  ip              TEXT,
  user_agent      TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gal_access_log_gallery ON gallery_access_log(gallery_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gal_access_log_event ON gallery_access_log(gallery_id, event);

-- Galeria ganha controle de login + de download.
ALTER TABLE galleries ADD COLUMN IF NOT EXISTS require_login BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE galleries ADD COLUMN IF NOT EXISTS download_mode TEXT NOT NULL DEFAULT 'off';
  -- off = cliente não baixa nada
  -- with_watermark = pode baixar preview marcado
  -- clean = pode baixar original sem marca (após pagamento ou ao final)

-- Modos de venda (Fase 2 — colunas já criadas pra evitar segunda
-- migration depois; ficam neutras enquanto a Fase 2 não está pronta).
ALTER TABLE galleries ADD COLUMN IF NOT EXISTS pricing_mode TEXT NOT NULL DEFAULT 'extra_avulso';
  -- no_charge | extra_avulso | upgrade_packs | sell_all
ALTER TABLE galleries ADD COLUMN IF NOT EXISTS cart_discount NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE galleries ADD COLUMN IF NOT EXISTS lock_after_deadline BOOLEAN NOT NULL DEFAULT true;

-- Pacotes de upgrade (modo upgrade_packs). Cliente escolhe um pacote
-- ao finalizar (ex.: "+10 fotos = R$200").
CREATE TABLE IF NOT EXISTS gallery_packs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gallery_id      UUID NOT NULL REFERENCES galleries(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  photo_count     INT NOT NULL,
  price           NUMERIC NOT NULL,
  sort_order      INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gal_packs_gallery ON gallery_packs(gallery_id);

-- Modo tudo-à-venda (preço por foto). Opcional; se vazio o preço da
-- foto é o extra_price padrão.
CREATE TABLE IF NOT EXISTS gallery_photo_prices (
  gallery_id      UUID NOT NULL REFERENCES galleries(id) ON DELETE CASCADE,
  photo_id        UUID NOT NULL REFERENCES gallery_photos(id) ON DELETE CASCADE,
  price           NUMERIC NOT NULL,
  PRIMARY KEY (gallery_id, photo_id)
);

-- RLS ligado em todas as tabelas novas. O backend acessa via service
-- role (igual ao resto da galeria), e o cliente final passa pela API
-- pública que valida a sessão.
ALTER TABLE gallery_access_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE gallery_access_log   ENABLE ROW LEVEL SECURITY;
ALTER TABLE gallery_packs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE gallery_photo_prices ENABLE ROW LEVEL SECURITY;

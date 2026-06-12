-- Rode no SQL Editor do Supabase. Idempotente.
--
-- Galeria de proofing — OAuth do Mercado Pago.
-- Substitui o "cola Access Token manualmente" por OAuth: cada estúdio
-- clica em "Conectar Mercado Pago" e autoriza no site oficial do MP.
-- Salvamos:
--   mp_refresh_token    (cifrado, vive ~6 meses, renova o access)
--   mp_user_id          (id da conta MP do estúdio — pra exibir)
--   mp_email            (e-mail da conta — "Conectado como ...")
--   mp_token_expires_at (timestamp da expiração do access)
-- mp_access_token (cifrado) já existia — agora é renovado automaticamente
-- quando estiver perto de vencer.

ALTER TABLE gallery_settings ADD COLUMN IF NOT EXISTS mp_refresh_token    TEXT;
ALTER TABLE gallery_settings ADD COLUMN IF NOT EXISTS mp_user_id          TEXT;
ALTER TABLE gallery_settings ADD COLUMN IF NOT EXISTS mp_email            TEXT;
ALTER TABLE gallery_settings ADD COLUMN IF NOT EXISTS mp_token_expires_at TIMESTAMPTZ;

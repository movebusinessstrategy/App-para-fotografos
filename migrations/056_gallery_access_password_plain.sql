-- migrations/056_gallery_access_password_plain.sql
-- Guarda a senha de acesso da galeria também em TEXTO (além do hash bcrypt),
-- pra que o estúdio possa VER a senha e reenviá-la igual pro cliente, além de
-- trocá-la quando quiser. É senha de proofing (baixo risco) e já é exibida/
-- enviada em texto pra cliente — o hash continua sendo usado no login.
-- Execute no Supabase SQL Editor. Idempotente.

ALTER TABLE gallery_access_users
  ADD COLUMN IF NOT EXISTS password_plain TEXT;

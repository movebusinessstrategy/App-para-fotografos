-- migrations/054_watermark_mode.sql
-- Marca d'água da logo: além do padrão diagonal repetido ('tiled'), permite
-- uma única logo grande centralizada ('centered'). Só vale quando
-- watermark_type = 'logo'. Coluna idempotente em gallery_settings.
-- Execute no Supabase SQL Editor. Idempotente.

ALTER TABLE gallery_settings
  ADD COLUMN IF NOT EXISTS watermark_mode TEXT NOT NULL DEFAULT 'tiled';

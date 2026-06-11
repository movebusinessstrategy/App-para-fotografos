-- Rode no SQL Editor do Supabase. Idempotente.
--
-- Corrige tabelas da galeria criadas com um schema parcial (uma versão
-- anterior do SQL foi aplicada antes da migration 026 — o CREATE TABLE
-- IF NOT EXISTS pulou as tabelas existentes e as colunas novas ficaram
-- de fora). Adiciona só o que falta e liga RLS (o backend acessa essas
-- tabelas via service role; RLS ligado bloqueia acesso direto via API).

ALTER TABLE galleries ADD COLUMN IF NOT EXISTS client_name TEXT;
ALTER TABLE galleries ADD COLUMN IF NOT EXISTS client_email TEXT;
ALTER TABLE galleries ADD COLUMN IF NOT EXISTS client_phone TEXT;
ALTER TABLE galleries ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE galleries ADD COLUMN IF NOT EXISTS view_count INT NOT NULL DEFAULT 0;
ALTER TABLE galleries ADD COLUMN IF NOT EXISTS last_viewed_at TIMESTAMPTZ;

ALTER TABLE gallery_selections ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

ALTER TABLE gallery_payments ADD COLUMN IF NOT EXISTS order_code TEXT;
ALTER TABLE gallery_payments ADD COLUMN IF NOT EXISTS payment_url TEXT;

ALTER TABLE galleries ENABLE ROW LEVEL SECURITY;
ALTER TABLE gallery_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE gallery_selections ENABLE ROW LEVEL SECURITY;
ALTER TABLE gallery_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE gallery_settings ENABLE ROW LEVEL SECURITY;

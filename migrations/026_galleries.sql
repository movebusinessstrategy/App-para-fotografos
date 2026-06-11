-- ============================================================================
-- 026_galleries
-- Rode no SQL Editor do Supabase. Idempotente.
-- ============================================================================

-- Galeria de proofing (selecao de fotos pelo cliente)
CREATE TABLE IF NOT EXISTS galleries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  job_id BIGINT,
  client_id BIGINT,
  client_name TEXT,
  client_email TEXT,
  client_phone TEXT,
  title TEXT NOT NULL,
  category TEXT,
  status TEXT NOT NULL DEFAULT 'draft', -- draft|sent|selected|delivered
  share_token TEXT UNIQUE NOT NULL,
  included_count INT NOT NULL DEFAULT 0,
  extra_price NUMERIC NOT NULL DEFAULT 0,
  cover_photo_id UUID,
  selection_deadline DATE,
  view_count INT NOT NULL DEFAULT 0,
  last_viewed_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  selected_at TIMESTAMPTZ,
  storage_bytes BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_galleries_user ON galleries(user_id);
CREATE INDEX IF NOT EXISTS idx_galleries_job ON galleries(job_id);

CREATE TABLE IF NOT EXISTS gallery_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gallery_id UUID NOT NULL REFERENCES galleries(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  original_path TEXT,
  preview_path TEXT,
  thumb_path TEXT,
  width INT, height INT, bytes BIGINT,
  process_status TEXT NOT NULL DEFAULT 'pending', -- pending|processing|done|error
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gphotos_gallery ON gallery_photos(gallery_id);

CREATE TABLE IF NOT EXISTS gallery_selections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gallery_id UUID NOT NULL REFERENCES galleries(id) ON DELETE CASCADE,
  photo_id UUID NOT NULL REFERENCES gallery_photos(id) ON DELETE CASCADE,
  selected BOOLEAN NOT NULL DEFAULT true,
  client_comment TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(gallery_id, photo_id)
);

CREATE TABLE IF NOT EXISTS gallery_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gallery_id UUID NOT NULL REFERENCES galleries(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  order_code TEXT,
  extra_count INT NOT NULL,
  amount NUMERIC NOT NULL,
  provider TEXT NOT NULL DEFAULT 'mercadopago',
  provider_ref TEXT,
  payment_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- pending|paid|failed|expired
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gpay_user ON gallery_payments(user_id);

CREATE TABLE IF NOT EXISTS gallery_settings (
  user_id TEXT PRIMARY KEY,
  watermark_type TEXT NOT NULL DEFAULT 'text', -- text|logo
  watermark_text TEXT,
  watermark_logo_path TEXT,
  watermark_opacity NUMERIC NOT NULL DEFAULT 0.3,
  watermark_include_client BOOLEAN NOT NULL DEFAULT false,
  sender_email TEXT,
  notify_studio_whatsapp BOOLEAN NOT NULL DEFAULT true,
  mp_access_token TEXT,
  categories JSONB NOT NULL DEFAULT '["Gestante","Newborn","Casamento","Família"]',
  protection JSONB NOT NULL DEFAULT '{"right_click":true,"drag":true,"notice":true}',
  custom_domain TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Rode no SQL Editor do Supabase. Idempotente.
--
-- Reestrutura os planos em 4 níveis. Galeria + Designer de Álbum só nos 2 de
-- cima (Studio/Premium), com limite de ARMAZENAMENTO em GB. O CRM (funil,
-- clientes, WhatsApp, contratos) entra em todos os planos.
--
-- Novas chaves em limits:
--   gallery   (bool)   — libera a Galeria de seleção
--   album     (bool)   — libera o Designer de Álbum
--   storage_gb(number) — teto de armazenamento de fotos (galeria + álbum)
--
-- SEGURO: não apaga planos antigos (tenants neles continuam válidos); só
-- redefine/insere os 4 e aposenta (is_active=false) free/business.

ALTER TABLE platform_plans ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

INSERT INTO platform_plans (slug, name, price_cents, sort_order, is_active, limits) VALUES
  ('start', 'Start', 5990, 1, true,
    '{"max_clients":-1,"max_jobs":-1,"max_team_members":1,"whatsapp":true,"contracts":true,"gallery":false,"album":false,"storage_gb":0}'::jsonb),
  ('pro', 'Pro', 9700, 2, true,
    '{"max_clients":-1,"max_jobs":-1,"max_team_members":3,"whatsapp":true,"contracts":true,"gallery":false,"album":false,"storage_gb":0}'::jsonb),
  ('studio', 'Studio', 14700, 3, true,
    '{"max_clients":-1,"max_jobs":-1,"max_team_members":3,"whatsapp":true,"contracts":true,"gallery":true,"album":true,"storage_gb":30}'::jsonb),
  ('premium', 'Premium', 19700, 4, true,
    '{"max_clients":-1,"max_jobs":-1,"max_team_members":5,"whatsapp":true,"contracts":true,"gallery":true,"album":true,"storage_gb":70}'::jsonb)
ON CONFLICT (slug) DO UPDATE SET
  name        = EXCLUDED.name,
  price_cents = EXCLUDED.price_cents,
  sort_order  = EXCLUDED.sort_order,
  is_active   = EXCLUDED.is_active,
  limits      = EXCLUDED.limits;

-- Aposenta os antigos (não some quem já está neles; só somem da venda).
UPDATE platform_plans SET is_active = false WHERE slug IN ('free', 'business');

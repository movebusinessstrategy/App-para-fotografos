-- Rode no SQL Editor do Supabase. Idempotente.
--
-- Galeria de proofing — MAIS tipos de desconto no carrinho.
-- Complementa a 033 (que trouxe none/flat/single_pct/progressive).
-- Agora discount_mode também aceita:
--
--   progressive_value → % progressivo por VALOR do carrinho (usa discount_value_rules)
--   deadline          → % "early bird" até uma data (deadline_discount_*)
--   buy_n_get_m       → a cada N fotos, M saem de graça (buy_n_group / buy_n_free)
--   coupon            → cliente digita um código no checkout (coupons[])
--
-- discount_value_rules: [{ "percent": 10, "min_value": 500 }, ...]
-- coupons:              [{ "code": "AMIGO10", "type": "pct"|"flat", "value": 10 }, ...]

ALTER TABLE galleries ADD COLUMN IF NOT EXISTS discount_value_rules JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE galleries ADD COLUMN IF NOT EXISTS deadline_discount_pct NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE galleries ADD COLUMN IF NOT EXISTS deadline_discount_until DATE;
ALTER TABLE galleries ADD COLUMN IF NOT EXISTS buy_n_group INTEGER NOT NULL DEFAULT 0;
ALTER TABLE galleries ADD COLUMN IF NOT EXISTS buy_n_free INTEGER NOT NULL DEFAULT 0;
ALTER TABLE galleries ADD COLUMN IF NOT EXISTS coupons JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Guarda o cupom usado no pagamento, pra recálculo pós-pagamento bater com o cobrado.
ALTER TABLE gallery_payments ADD COLUMN IF NOT EXISTS coupon_code TEXT;

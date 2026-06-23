-- Rode no SQL Editor do Supabase. Idempotente.
--
-- Galeria de proofing — descontos no carrinho (estilo Alboom Proof).
--
-- Antes só existia `cart_discount` (abatimento fixo em R$). Agora a galeria
-- escolhe um MODO de desconto:
--
--   none         → sem desconto
--   flat         → abatimento fixo em R$  (usa cart_discount; comportamento antigo)
--   single_pct   → desconto único em %    (usa discount_single_pct)
--   progressive  → desconto progressivo   (usa discount_rules: % a partir de N fotos)
--
-- discount_rules é um array JSON: [{ "percent": 13, "min_photos": 11 }, ...].
-- Default 'flat' preserva o comportamento das galerias já criadas (cart_discount
-- = 0 não muda nada; cart_discount > 0 segue abatendo igual a antes).

ALTER TABLE galleries ADD COLUMN IF NOT EXISTS discount_mode TEXT NOT NULL DEFAULT 'flat';
  -- none | flat | single_pct | progressive
ALTER TABLE galleries ADD COLUMN IF NOT EXISTS discount_single_pct NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE galleries ADD COLUMN IF NOT EXISTS discount_rules JSONB NOT NULL DEFAULT '[]'::jsonb;

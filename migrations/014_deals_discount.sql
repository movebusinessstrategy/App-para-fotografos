-- Desconto no pacote vendido: o negócio guarda o valor cheio em `value`
-- e o desconto absoluto (R$) em `discount`. O líquido = value - discount.
-- Usado na aba Financeiro da Produção (item "Pacote" editável).
-- Execute no Supabase SQL Editor. Idempotente.

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS discount NUMERIC DEFAULT 0;

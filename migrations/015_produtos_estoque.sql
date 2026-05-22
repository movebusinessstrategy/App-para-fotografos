-- Controle de estoque dos produtos.
-- A coluna `estoque` (quantidade atual) já existe na tabela produtos.
-- Aqui adicionamos:
--   controla_estoque — se TRUE, o produto entra no controle de estoque
--   estoque_minimo   — limite pra alertar reposição (estoque <= mínimo)
-- Execute no Supabase SQL Editor. Idempotente.

ALTER TABLE produtos
  ADD COLUMN IF NOT EXISTS controla_estoque BOOLEAN DEFAULT false;

ALTER TABLE produtos
  ADD COLUMN IF NOT EXISTS estoque_minimo NUMERIC DEFAULT 0;

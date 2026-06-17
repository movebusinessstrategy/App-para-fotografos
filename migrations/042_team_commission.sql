-- Rode no SQL Editor do Supabase. Idempotente.
--
-- Comissão de vendedor: cada membro da equipe ganha uma META de venda (R$) e um
-- percentual de COMISSÃO. Usado no relatório "Vendas por Vendedor" pra calcular
-- quanto pagar de comissão no período (vendas convertidas atribuídas a ele × %).

ALTER TABLE team_members ADD COLUMN IF NOT EXISTS meta_venda          numeric NOT NULL DEFAULT 0;
ALTER TABLE team_members ADD COLUMN IF NOT EXISTS comissao_percentual numeric NOT NULL DEFAULT 0;

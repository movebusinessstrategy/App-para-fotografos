-- ============================================================================
-- 022_oportunidade_produto
--
-- Liga oportunidade ↔ produto do catálogo (FK opcional). Permite agregar
-- "Total de Oportunidades por Produto" e mostrar quanto cada produto já
-- converteu em vendas (filtrando por opportunities.status convertido).
--
-- Rode no SQL Editor do Supabase. Idempotente.
-- ============================================================================

alter table opportunities
  add column if not exists produto_id uuid references produtos(id) on delete set null;

create index if not exists opportunities_produto_idx
  on opportunities(produto_id) where produto_id is not null;

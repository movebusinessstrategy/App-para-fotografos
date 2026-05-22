-- Liga as compras ao Financeiro: quando um pedido é marcado como "comprado",
-- o valor real pago vira uma despesa em fin_despesas.
--   valor_pago      — quanto foi pago de fato pelo pedido
--   fin_despesa_id  — despesa gerada no Financeiro (evita duplicar)
-- Execute no Supabase SQL Editor. Idempotente.

ALTER TABLE compras
  ADD COLUMN IF NOT EXISTS valor_pago NUMERIC;

ALTER TABLE compras
  ADD COLUMN IF NOT EXISTS fin_despesa_id UUID;

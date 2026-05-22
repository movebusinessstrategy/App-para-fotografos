-- Pedidos de compra (reposição de estoque) com etapa de aprovação.
-- Fluxo do status: analise -> aprovado -> comprado.
--   analise  — pedido criado, aguardando análise
--   aprovado — análise aprovada, pode comprar
--   comprado — comprado e recebido; o estoque do produto sobe
--   cancelado — pedido descartado
-- Execute no Supabase SQL Editor. Idempotente.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS compras (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       TEXT NOT NULL,
  produto_id    UUID REFERENCES produtos(id) ON DELETE SET NULL,
  produto_nome  TEXT NOT NULL,
  quantidade    NUMERIC NOT NULL DEFAULT 1,
  status        TEXT NOT NULL DEFAULT 'analise',
  observacao    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_compras_user ON compras(user_id);
CREATE INDEX IF NOT EXISTS idx_compras_status ON compras(user_id, status);

ALTER TABLE compras ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "compras_user_all" ON compras;
CREATE POLICY "compras_user_all"
  ON compras
  FOR ALL
  USING (user_id = auth.uid()::text)
  WITH CHECK (user_id = auth.uid()::text);

-- Produtos "sob encomenda": não têm estoque de prateleira — cada venda
-- gera um pedido de compra automático (ex: álbum 20x20).
-- Um produto é OU controla_estoque OU sob_encomenda (ou nenhum dos dois).
--
-- compras ganha vínculo com o trabalho/cliente que gerou o pedido:
--   job_id       — trabalho de origem (NULL = pedido manual)
--   job_item_id  — item do trabalho de origem (pra sincronizar/remover)
--   cliente_nome — nome do cliente (snapshot, pra exibir no pedido)
-- Execute no Supabase SQL Editor. Idempotente.

ALTER TABLE produtos
  ADD COLUMN IF NOT EXISTS sob_encomenda BOOLEAN DEFAULT false;

ALTER TABLE compras
  ADD COLUMN IF NOT EXISTS job_id BIGINT;

ALTER TABLE compras
  ADD COLUMN IF NOT EXISTS job_item_id TEXT;

ALTER TABLE compras
  ADD COLUMN IF NOT EXISTS cliente_nome TEXT;

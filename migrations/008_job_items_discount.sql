-- Desconto em items de job: valor cobrado pode ser menor que o catálogo.
-- discount_value é absoluto (R$ pra abater). Tela permite digitar como
-- % e converte; o que persiste é sempre o valor em real.
ALTER TABLE job_items
  ADD COLUMN IF NOT EXISTS discount_value NUMERIC DEFAULT 0;

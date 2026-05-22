-- Marca se um trabalho já foi sincronizado com o Financeiro alguma vez.
-- Assim, se o usuário apagar uma conta a receber, o sync NÃO recria —
-- o trabalho só é "puxado" uma única vez.
-- O UPDATE marca como sincronizados os trabalhos que já têm receita hoje.
-- Execute no Supabase SQL Editor. Idempotente.

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS fin_synced BOOLEAN DEFAULT false;

UPDATE jobs
  SET fin_synced = true
  WHERE id IN (SELECT DISTINCT job_id FROM fin_receitas WHERE job_id IS NOT NULL);

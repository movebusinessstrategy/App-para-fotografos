-- 064: Um negócio convertido pode originar no máximo um trabalho.
--
-- A aplicação já usa jobs.deal_id para pré-reserva e, a partir desta versão,
-- também para a conversão definitiva. O índice único fecha a corrida entre
-- duas instâncias do servidor: mesmo que ambas tentem converter ao mesmo
-- tempo, o banco não aceita dois ensaios para o mesmo deal.

CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_user_deal_unique
  ON public.jobs (user_id, deal_id)
  WHERE deal_id IS NOT NULL;

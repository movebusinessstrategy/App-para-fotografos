-- 060: Pré-reserva de data (extensão WhatsApp)
-- Um job com status 'pre_reserved' segura a data na agenda enquanto o lead
-- ainda negocia. deal_id rastreia de qual lead a reserva veio, pra conversão
-- confirmar (vira ensaio) ou a perda/exclusão liberar a data.
-- Rodar no SQL Editor do Supabase.

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS deal_id BIGINT;

CREATE INDEX IF NOT EXISTS idx_jobs_deal_pre_reserve
  ON jobs (user_id, deal_id)
  WHERE deal_id IS NOT NULL;

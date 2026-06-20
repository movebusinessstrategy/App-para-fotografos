-- Rode no SQL Editor do Supabase. Idempotente.
--
-- Contador de tentativas do follow-up. Usado pelo follow-up contextual da Lia
-- (Fase 2): se a IA ou o WhatsApp estiverem fora do ar na hora do disparo, o
-- worker reagenda +30min em vez de marcar 'failed' pra sempre (teto de 5 tentativas).

ALTER TABLE scheduled_followups ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;

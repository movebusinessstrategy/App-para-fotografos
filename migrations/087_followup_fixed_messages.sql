-- 087: mensagens fixas na cadência de follow-up e 3 toques antes do orçamento.
-- message_mode: 'ai' (a IA escreve cada retomada, como até aqui) ou 'fixed' (sai o texto
-- que o dono aprovou para o passo, com [nome] no lugar do primeiro nome). fixed_messages:
-- até 4 textos; índice+1 = passo da escada e toque antes do orçamento. Fora da janela de
-- 24h cada texto sai por um template próprio na Meta, criado e acompanhado pelo servidor.
-- A trilha antes do orçamento passa de 2 para 3 toques (as etapas continuam no máximo 2).
-- Aditiva e idempotente (pode rodar duas vezes). Aplicar ANTES do deploy do código novo.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

ALTER TABLE public.followup_cadence_config
  ADD COLUMN IF NOT EXISTS message_mode text NOT NULL DEFAULT 'ai',
  ADD COLUMN IF NOT EXISTS fixed_messages text[] NOT NULL DEFAULT '{}'::text[],
  DROP CONSTRAINT IF EXISTS followup_cadence_config_message_mode_check,
  ADD CONSTRAINT followup_cadence_config_message_mode_check CHECK (message_mode IN ('ai', 'fixed')),
  DROP CONSTRAINT IF EXISTS followup_cadence_config_fixed_messages_check,
  ADD CONSTRAINT followup_cadence_config_fixed_messages_check
    CHECK (cardinality(fixed_messages) <= 4 AND array_position(fixed_messages, NULL) IS NULL),
  DROP CONSTRAINT IF EXISTS followup_cadence_config_pre_quote_delays_check,
  ADD CONSTRAINT followup_cadence_config_pre_quote_delays_check
    CHECK (cardinality(pre_quote_delays_hours) BETWEEN 1 AND 3 AND array_position(pre_quote_delays_hours, NULL) IS NULL
      AND 1 <= ALL (pre_quote_delays_hours) AND 720 >= ALL (pre_quote_delays_hours));

COMMENT ON COLUMN public.followup_cadence_config.message_mode IS
  '087: ai = a IA escreve cada retomada; fixed = sai o texto de fixed_messages do passo, sem IA.';
COMMENT ON COLUMN public.followup_cadence_config.fixed_messages IS
  '087: até 4 textos aprovados pelo dono; índice+1 = passo da escada e toque antes do orçamento; [nome] = primeiro nome.';
COMMENT ON COLUMN public.followup_cadence_config.pre_quote_delays_hours IS
  '087: 1 a 3 atrasos em horas (1..720); índice+1 = toque antes do orçamento.';

-- Igual à 083, só a trilha antes do orçamento vai até o toque 3.
ALTER TABLE public.scheduled_followups
  DROP CONSTRAINT IF EXISTS scheduled_followups_cadence_shape_check,
  ADD CONSTRAINT scheduled_followups_cadence_shape_check CHECK (kind <> 'cadence' OR (
    status IS NOT NULL
    AND status IN ('draft', 'approved', 'sending', 'sent', 'skipped', 'cancelled', 'blocked', 'failed')
    AND step IS NOT NULL AND step BETWEEN 1 AND 4
    AND basis_at IS NOT NULL
    AND jsonb_typeof(generation_meta) = 'object'
    AND (track <> 'pre_quote' OR step BETWEEN 1 AND 3)
    AND (status <> 'approved' OR approved_at IS NOT NULL)));

COMMENT ON COLUMN public.scheduled_followups.track IS
  '083/087: ladder = escada depois do orçamento (move o card); pre_quote = antes do orçamento (toques 1 a 3, nunca move). Legado fica ladder.';

COMMIT;

-- Conferência depois de aplicar (só leitura)
-- select message_mode, fixed_messages, pre_quote_delays_hours from public.followup_cadence_config;
-- select conname, pg_get_constraintdef(oid) from pg_constraint
--  where conname in ('followup_cadence_config_message_mode_check', 'followup_cadence_config_fixed_messages_check',
--                    'followup_cadence_config_pre_quote_delays_check', 'scheduled_followups_cadence_shape_check');
--
-- Rollback manual (só funciona sem toque 3 gravado e com no máximo 2 atrasos antes do orçamento)
-- BEGIN;
-- ALTER TABLE public.scheduled_followups
--   DROP CONSTRAINT IF EXISTS scheduled_followups_cadence_shape_check,
--   ADD CONSTRAINT scheduled_followups_cadence_shape_check CHECK (kind <> 'cadence' OR (
--     status IS NOT NULL
--     AND status IN ('draft', 'approved', 'sending', 'sent', 'skipped', 'cancelled', 'blocked', 'failed')
--     AND step IS NOT NULL AND step BETWEEN 1 AND 4
--     AND basis_at IS NOT NULL
--     AND jsonb_typeof(generation_meta) = 'object'
--     AND (track <> 'pre_quote' OR step BETWEEN 1 AND 2)
--     AND (status <> 'approved' OR approved_at IS NOT NULL)));
-- ALTER TABLE public.followup_cadence_config
--   DROP CONSTRAINT IF EXISTS followup_cadence_config_pre_quote_delays_check,
--   ADD CONSTRAINT followup_cadence_config_pre_quote_delays_check
--     CHECK (cardinality(pre_quote_delays_hours) BETWEEN 1 AND 2 AND array_position(pre_quote_delays_hours, NULL) IS NULL
--       AND 1 <= ALL (pre_quote_delays_hours) AND 720 >= ALL (pre_quote_delays_hours)),
--   DROP CONSTRAINT IF EXISTS followup_cadence_config_fixed_messages_check,
--   DROP CONSTRAINT IF EXISTS followup_cadence_config_message_mode_check,
--   DROP COLUMN IF EXISTS fixed_messages,
--   DROP COLUMN IF EXISTS message_mode;
-- COMMIT;

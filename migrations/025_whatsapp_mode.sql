-- ============================================================================
-- 025_whatsapp_mode
--
-- Adiciona a coluna `mode` em whatsapp_business_accounts pra distinguir entre
-- os dois modos de onboarding suportados pelo Embedded Signup:
--
--   'cloud_api'   — fluxo tradicional Cloud API: registra o número via PIN
--                   (POST /{phone_number_id}/register). É o modo padrão e o
--                   único usado até agora; por isso o default e o backfill
--                   apontam pra ele.
--
--   'coexistence' — Embedded Signup v4 Coexistence: o número continua no
--                   WhatsApp Business app do cliente e a gente só consome
--                   mensagens via webhook. NÃO chama /register (chamaria
--                   quebraria a coexistência). Esse modo é escolhido quando
--                   o usuário marca a opção no popup do FB durante o ES.
--
-- Backfill: todas as rows existentes ficam com 'cloud_api' (via DEFAULT),
-- mantendo o comportamento atual intacto.
--
-- Rode no SQL Editor do Supabase. Idempotente.
-- ============================================================================

alter table whatsapp_business_accounts
  add column if not exists mode text not null default 'cloud_api';

-- Garante que só os dois valores válidos entrem na coluna.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'whatsapp_business_accounts_mode_check'
  ) then
    alter table whatsapp_business_accounts
      add constraint whatsapp_business_accounts_mode_check
      check (mode in ('cloud_api', 'coexistence'));
  end if;
end $$;

-- ============================================================================
-- 024_whatsapp_cloud_api_fixes
--
-- Endurece a tabela whatsapp_business_accounts pra produção:
--
-- 1. Permite múltiplas WABAs por user_id (antes: upsert sobrescrevia).
--    Constraint vira (user_id, waba_id) e existe a flag is_active pra escolher
--    qual está em uso (queries continuam usando .maybeSingle).
--
-- 2. token_expires_at: marca quando o long-lived access_token expira (60d).
--    Frontend usa isso pra mostrar aviso 14d antes de expirar.
--
-- 3. token_encrypted: flag indicando que o access_token na linha está
--    cifrado (formato "enc:v1:..."). Permite migração lazy — linhas antigas
--    em plaintext continuam funcionando até serem re-salvas.
--
-- Rode no SQL Editor do Supabase. Idempotente.
-- ============================================================================

-- Garante que a tabela existe (cria caso este seja um deploy novo).
create table if not exists whatsapp_business_accounts (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  waba_id           text,
  phone_number_id   text,
  phone_number      text,
  display_name      text,
  access_token      text,
  connected_at      timestamptz default now()
);

-- Colunas novas
alter table whatsapp_business_accounts
  add column if not exists is_active        boolean      not null default true,
  add column if not exists token_expires_at timestamptz,
  add column if not exists token_encrypted  boolean      not null default false;

-- Remove o constraint antigo (user_id único) se existir.
-- O nome varia conforme quando/como foi criado; tentamos os dois mais comuns.
alter table whatsapp_business_accounts
  drop constraint if exists whatsapp_business_accounts_user_id_key;
alter table whatsapp_business_accounts
  drop constraint if exists whatsapp_business_accounts_user_id_unique;

-- Cria o novo constraint composto (user_id, waba_id). Idempotente.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'whatsapp_business_accounts_user_id_waba_id_key'
  ) then
    alter table whatsapp_business_accounts
      add constraint whatsapp_business_accounts_user_id_waba_id_key
      unique (user_id, waba_id);
  end if;
end $$;

-- Índice pra acelerar busca do "active por user" — query mais comum.
create index if not exists idx_wba_user_active
  on whatsapp_business_accounts (user_id)
  where is_active = true;

-- Índice pra rastrear quem precisa de refresh em breve (cron futuro).
create index if not exists idx_wba_token_expires
  on whatsapp_business_accounts (token_expires_at)
  where is_active = true;

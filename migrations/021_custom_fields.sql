-- ============================================================================
-- 021_custom_fields
--
-- Permite que cada usuário defina campos personalizados pro cadastro de
-- cliente (ex: fotógrafa quer "DPP", dentista quer "convênio"). Os valores
-- ficam num jsonb em clients.custom_fields_data — sem precisar JOIN.
--
-- Rode no SQL Editor do Supabase. Idempotente.
-- ============================================================================

create table if not exists custom_fields (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  field_key    text not null,
  label        text not null,
  field_type   text not null default 'text' check (field_type in ('text','date','number','select','textarea')),
  options      jsonb not null default '[]'::jsonb,
  required     boolean not null default false,
  sort_order   integer not null default 0,
  archived     boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (user_id, field_key)
);

create index if not exists custom_fields_user_idx
  on custom_fields(user_id) where archived = false;

-- Trigger updated_at
create or replace function custom_fields_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists custom_fields_updated_at on custom_fields;
create trigger custom_fields_updated_at
  before update on custom_fields
  for each row execute function custom_fields_set_updated_at();

-- RLS: tudo passa pelo backend (service_role bypassa)
alter table custom_fields enable row level security;

-- Coluna jsonb em clients pra armazenar os valores. Inicia como {}
-- pra não quebrar reads de quem ainda não preencheu nenhum campo.
alter table clients
  add column if not exists custom_fields_data jsonb not null default '{}'::jsonb;

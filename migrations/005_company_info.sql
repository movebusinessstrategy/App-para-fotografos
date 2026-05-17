-- ============================================================================
-- Dados da empresa (usado em contratos, cobranças, comunicações)
-- Rode no SQL Editor do Supabase. Idempotente.
-- ============================================================================

create table if not exists company_info (
  user_id          uuid primary key references auth.users(id) on delete cascade,
  trade_name       text,           -- nome fantasia
  legal_name       text,           -- razão social
  cnpj             text,
  email            text,           -- email comercial
  phone            text,
  address_line     text,
  address_number   text,
  address_complement text,
  neighborhood     text,
  city             text,
  state            text,
  postal_code      text,
  logo_url         text,
  website          text,
  instagram        text,
  about            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

alter table company_info enable row level security;

-- Policy: dono lê/edita só os próprios dados
drop policy if exists "company_info_self_read" on company_info;
create policy "company_info_self_read" on company_info
  for select using (auth.uid() = user_id);

drop policy if exists "company_info_self_write" on company_info;
create policy "company_info_self_write" on company_info
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Trigger updated_at
create or replace function company_info_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists company_info_updated_at on company_info;
create trigger company_info_updated_at
  before update on company_info
  for each row execute function company_info_set_updated_at();

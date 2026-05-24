-- ============================================================================
-- 023_tipo_ensaio_precos
--
-- Pra cada tipo de ensaio (Gestante, Newborn, Smash, etc), o usuário define
-- o "valor mínimo" — o preço do pacote base. Usado pra estimar o potencial
-- de venda das oportunidades cujo `type` casa com esse nome, mesmo quando
-- a oportunidade individual não tem valor preenchido.
--
-- Rode no SQL Editor do Supabase. Idempotente.
-- ============================================================================

create table if not exists tipo_ensaio_precos (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  tipo_nome    text not null,
  preco_minimo numeric not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Unicidade case-insensitive por usuário (não pode duplicar "Newborn" e "newborn")
create unique index if not exists tipo_ensaio_precos_user_nome_idx
  on tipo_ensaio_precos(user_id, lower(tipo_nome));

-- Trigger updated_at
create or replace function tipo_ensaio_precos_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists tipo_ensaio_precos_updated_at on tipo_ensaio_precos;
create trigger tipo_ensaio_precos_updated_at
  before update on tipo_ensaio_precos
  for each row execute function tipo_ensaio_precos_set_updated_at();

alter table tipo_ensaio_precos enable row level security;

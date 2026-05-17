-- ============================================================================
-- Painel Platform-Admin — schema do super-admin do SaaS
--
-- Rode este arquivo INTEIRO no SQL Editor do Supabase.
-- É idempotente: pode rodar várias vezes sem quebrar.
--
-- IMPORTANTE: depois de aplicar, promova seu usuário a super-admin com:
--   insert into platform_admins (user_id, role)
--   values ('<SEU_AUTH_USER_ID>', 'super_admin');
--
-- Pegue seu user_id em: Authentication → Users → (clicar no seu e-mail)
-- ============================================================================

-- 1) Planos do SaaS
create table if not exists platform_plans (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  price_cents integer not null default 0,
  limits jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2) Conta de plataforma (1 linha por "dono"/tenant)
create table if not exists platform_accounts (
  owner_user_id uuid primary key references auth.users(id) on delete cascade,
  plan_id uuid references platform_plans(id) on delete set null,
  status text not null default 'active' check (status in ('active', 'suspended', 'deleted')),
  suspended_reason text,
  trial_ends_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists platform_accounts_status_idx on platform_accounts(status);
create index if not exists platform_accounts_plan_idx   on platform_accounts(plan_id);

-- 3) Super-admins da plataforma (você + suporte)
create table if not exists platform_admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  role       text not null default 'super_admin' check (role in ('super_admin', 'support')),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

-- 4) Log de auditoria de ações administrativas
create table if not exists platform_audit_log (
  id              bigserial primary key,
  admin_user_id   uuid not null references auth.users(id),
  action          text not null,
  target_owner_id uuid references auth.users(id),
  metadata        jsonb not null default '{}'::jsonb,
  ip              text,
  created_at      timestamptz not null default now()
);

create index if not exists platform_audit_log_admin_idx  on platform_audit_log(admin_user_id, created_at desc);
create index if not exists platform_audit_log_target_idx on platform_audit_log(target_owner_id, created_at desc);
create index if not exists platform_audit_log_action_idx on platform_audit_log(action, created_at desc);

-- ============================================================================
-- RLS: nenhum acesso direto via Supabase client. Tudo passa pelo backend
-- (service_role bypassa RLS). Habilitar RLS sem policies = ninguém lê/escreve.
-- ============================================================================
alter table platform_plans     enable row level security;
alter table platform_accounts  enable row level security;
alter table platform_admins    enable row level security;
alter table platform_audit_log enable row level security;

-- ============================================================================
-- Trigger updated_at automático
-- ============================================================================
create or replace function platform_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists platform_plans_updated_at on platform_plans;
create trigger platform_plans_updated_at
  before update on platform_plans
  for each row execute function platform_set_updated_at();

drop trigger if exists platform_accounts_updated_at on platform_accounts;
create trigger platform_accounts_updated_at
  before update on platform_accounts
  for each row execute function platform_set_updated_at();

-- ============================================================================
-- Seed de planos default (idempotente — só cria se não existir o slug)
-- limits.max_* = -1 significa ilimitado
-- ============================================================================
insert into platform_plans (slug, name, price_cents, sort_order, limits) values
  ('free',     'Free',     0,     0,
    '{"max_clients": 50,  "max_jobs": 30,  "max_team_members": 1,  "whatsapp": false, "contracts": false}'::jsonb),
  ('pro',      'Pro',      9700,  1,
    '{"max_clients": 500, "max_jobs": 500, "max_team_members": 2,  "whatsapp": true,  "contracts": true}'::jsonb),
  ('business', 'Business', 19700, 2,
    '{"max_clients": -1,  "max_jobs": -1,  "max_team_members": -1, "whatsapp": true,  "contracts": true}'::jsonb)
on conflict (slug) do nothing;

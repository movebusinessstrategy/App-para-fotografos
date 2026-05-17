-- ============================================================================
-- Billing Asaas — assinaturas, trial 7d, integração com gateway
--
-- Rode no SQL Editor do Supabase. Idempotente.
--
-- Modelo de negócio:
--   - Toda conta nasce com 7 dias de trial no plano "Pro".
--   - Após o trial, conta precisa de assinatura ativa (PIX recorrente ou cartão).
--   - Não existe mais plano Free permanente (mantido inativo apenas pra histórico).
--   - Super-admin pode estender trial até 14 dias caso a caso.
-- ============================================================================

-- 1) Desabilita o plano Free permanente (mantém linha pra histórico)
update platform_plans set is_active = false where slug = 'free';

-- 2) Colunas extras em platform_accounts
alter table platform_accounts
  add column if not exists asaas_customer_id text,
  add column if not exists asaas_subscription_id text,
  add column if not exists subscription_status text not null default 'trial'
    check (subscription_status in ('trial', 'active', 'past_due', 'cancelled', 'expired')),
  add column if not exists trial_started_at timestamptz,
  add column if not exists subscription_payment_method text,  -- 'PIX' | 'CREDIT_CARD'
  add column if not exists subscription_started_at timestamptz,
  add column if not exists subscription_renewed_at timestamptz,
  add column if not exists last_payment_at timestamptz;

create index if not exists platform_accounts_subscription_status_idx on platform_accounts(subscription_status);
create index if not exists platform_accounts_asaas_customer_idx on platform_accounts(asaas_customer_id);

-- 3) Histórico de pagamentos (cada cobrança vinda do webhook)
create table if not exists billing_payments (
  id                   uuid primary key default gen_random_uuid(),
  owner_user_id        uuid not null references auth.users(id) on delete cascade,
  asaas_payment_id     text not null unique,
  asaas_subscription_id text,
  asaas_customer_id    text,
  amount_cents         integer not null,
  status               text not null,           -- PENDING | RECEIVED | CONFIRMED | OVERDUE | REFUNDED ...
  billing_type         text,                    -- PIX | CREDIT_CARD | BOLETO
  due_date             date,
  paid_at              timestamptz,
  invoice_url          text,
  raw                  jsonb,                   -- payload do webhook pra debug
  created_at           timestamptz not null default now()
);
create index if not exists billing_payments_owner_idx on billing_payments(owner_user_id, created_at desc);
create index if not exists billing_payments_subscription_idx on billing_payments(asaas_subscription_id);

-- 4) Log de eventos do webhook (idempotência + auditoria)
create table if not exists billing_webhook_events (
  id           uuid primary key default gen_random_uuid(),
  event_id     text not null unique,            -- id do evento no Asaas
  event_type   text not null,
  payload      jsonb not null,
  processed_at timestamptz,
  error        text,
  created_at   timestamptz not null default now()
);

-- 5) RLS: nada acessível via client. Só backend (service_role).
alter table billing_payments         enable row level security;
alter table billing_webhook_events   enable row level security;

-- 6) Backfill: contas existentes sem subscription_status entram como "active"
--    com plano Business (gratuito vitalício pra não quebrar contas atuais).
--    Se preferir deixar todos em trial, descomente abaixo.
update platform_accounts
   set subscription_status = 'active',
       plan_id = (select id from platform_plans where slug = 'business' limit 1)
 where subscription_status = 'trial'
   and asaas_subscription_id is null
   and trial_started_at is null;

-- update platform_accounts
--    set trial_started_at = created_at,
--        trial_ends_at = created_at + interval '7 days',
--        plan_id = (select id from platform_plans where slug = 'pro' limit 1)
--  where subscription_status = 'trial' and asaas_subscription_id is null;

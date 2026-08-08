-- 066 — Origem de anúncios + fila transacional de conversões Meta/Google.
--
-- Objetivos:
-- 1. guardar a origem real recebida no WhatsApp sem criar um lead automaticamente;
-- 2. vincular os contatos pendentes quando o usuário cria o lead manualmente;
-- 3. registrar a venda no mesmo commit do deal, antes de qualquer chamada externa;
-- 4. permitir reenvio idempotente e diagnóstico sem duplicar conversões.

create table if not exists public.marketing_touchpoints (
  id                  bigserial primary key,
  user_id             uuid not null,
  deal_id             bigint,
  channel             text not null,
  source              text not null,
  external_event_id   text,
  phone               text,
  wa_number           text,
  source_url          text,
  ctwa_clid           text,
  gclid               text,
  gbraid              text,
  wbraid              text,
  fbclid              text,
  fbc                  text,
  fbp                  text,
  utm_source          text,
  utm_medium          text,
  utm_campaign        text,
  utm_content         text,
  utm_term            text,
  ad_id               text,
  adset_id            text,
  campaign_external_id text,
  consent_status      text not null default 'unknown',
  metadata            jsonb not null default '{}'::jsonb,
  first_seen_at       timestamptz not null default now(),
  last_seen_at        timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint marketing_touchpoints_channel_check
    check (channel in ('whatsapp', 'website', 'manual', 'import')),
  constraint marketing_touchpoints_consent_check
    check (consent_status in ('unknown', 'granted', 'denied')),
  constraint marketing_touchpoints_external_event_unique
    unique (user_id, channel, external_event_id)
);

create index if not exists marketing_touchpoints_phone_idx
  on public.marketing_touchpoints (user_id, phone, last_seen_at desc);

create index if not exists marketing_touchpoints_deal_idx
  on public.marketing_touchpoints (user_id, deal_id, last_seen_at desc)
  where deal_id is not null;

create table if not exists public.marketing_integrations (
  id                    bigserial primary key,
  user_id               uuid not null,
  provider              text not null,
  enabled               boolean not null default false,
  account_id            text,
  destination_id        text,
  conversion_action_id  text,
  credentials_encrypted text,
  last_tested_at        timestamptz,
  last_error            text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint marketing_integrations_provider_check
    check (provider in ('meta', 'google')),
  constraint marketing_integrations_user_provider_unique
    unique (user_id, provider)
);

create table if not exists public.marketing_conversion_outbox (
  id              bigserial primary key,
  user_id         uuid not null,
  deal_id         bigint not null,
  provider        text not null,
  event_name      text not null,
  event_id        text not null,
  occurred_at     timestamptz not null,
  value           numeric not null default 0,
  currency        text not null default 'BRL',
  status          text not null default 'pending',
  attempts        integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error      text,
  response        jsonb,
  sent_at         timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint marketing_conversion_provider_check
    check (provider in ('meta', 'google')),
  constraint marketing_conversion_status_check
    check (status in ('pending', 'processing', 'sent', 'retry', 'blocked_config', 'dead')),
  constraint marketing_conversion_currency_check
    check (currency ~ '^[A-Z]{3}$'),
  constraint marketing_conversion_event_unique
    unique (user_id, provider, event_id)
);

create index if not exists marketing_conversion_outbox_worker_idx
  on public.marketing_conversion_outbox (status, next_attempt_at, created_at)
  where status in ('pending', 'retry');

create index if not exists marketing_conversion_outbox_deal_idx
  on public.marketing_conversion_outbox (user_id, deal_id, created_at desc);

alter table public.marketing_touchpoints enable row level security;
alter table public.marketing_integrations enable row level security;
alter table public.marketing_conversion_outbox enable row level security;

drop policy if exists marketing_touchpoints_select_own on public.marketing_touchpoints;
create policy marketing_touchpoints_select_own on public.marketing_touchpoints
  for select using (auth.uid() = user_id);

drop policy if exists marketing_integrations_select_own on public.marketing_integrations;
create policy marketing_integrations_select_own on public.marketing_integrations
  for select using (auth.uid() = user_id);

drop policy if exists marketing_conversion_outbox_select_own on public.marketing_conversion_outbox;
create policy marketing_conversion_outbox_select_own on public.marketing_conversion_outbox
  for select using (auth.uid() = user_id);

create or replace function public.marketing_phone_key(raw_phone text)
returns text
language sql
immutable
as $$
  select case
    when length(regexp_replace(coalesce(raw_phone, ''), '\D', '', 'g')) >= 10
      then right(regexp_replace(raw_phone, '\D', '', 'g'), 11)
    else null
  end;
$$;

create or replace function public.link_pending_marketing_touchpoints()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.marketing_phone_key(new.contact_phone) is null then
    return new;
  end if;

  update public.marketing_touchpoints
     set deal_id = new.id,
         updated_at = now()
   where user_id = new.user_id
     and deal_id is null
     and public.marketing_phone_key(phone) = public.marketing_phone_key(new.contact_phone)
     and last_seen_at >= now() - interval '180 days';

  return new;
end;
$$;

drop trigger if exists deals_link_marketing_touchpoints on public.deals;
create trigger deals_link_marketing_touchpoints
after insert or update of contact_phone on public.deals
for each row
execute function public.link_pending_marketing_touchpoints();

create or replace function public.queue_deal_purchase_conversions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  conversion_event_id text;
begin
  if old.converted_at is not null or new.converted_at is null then
    return new;
  end if;

  conversion_event_id := concat(
    'deal:', new.id, ':purchase:',
    floor(extract(epoch from new.converted_at) * 1000)::bigint
  );

  insert into public.marketing_conversion_outbox (
    user_id, deal_id, provider, event_name, event_id,
    occurred_at, value, currency
  )
  select
    new.user_id, new.id, provider, 'Purchase', conversion_event_id,
    new.converted_at, greatest(coalesce(new.value, 0), 0), 'BRL'
  from unnest(array['meta'::text, 'google'::text]) as provider
  on conflict (user_id, provider, event_id) do nothing;

  return new;
end;
$$;

drop trigger if exists deals_queue_purchase_conversions on public.deals;
create trigger deals_queue_purchase_conversions
after update of converted_at on public.deals
for each row
execute function public.queue_deal_purchase_conversions();

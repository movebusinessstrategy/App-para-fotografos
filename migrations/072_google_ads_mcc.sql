-- 072 — Google Ads MCC central, com vínculo explícito de uma conta por tenant.
--
-- Segredos e credenciais da plataforma ficam SOMENTE nas variáveis de ambiente.
-- Estas tabelas guardam vínculos, métricas agregadas e auditoria de sincronização.
-- Não existe policy para usuários: toda leitura e escrita passa pelo backend com
-- service role e filtro explícito de user_id. Assim o JWT do tenant não consegue
-- consultar o customer_id bruto nem contornar a máscara da API.

create table if not exists public.google_ads_connections (
  user_id              uuid primary key,
  last_sync_status     text not null default 'never',
  last_sync_started_at timestamptz,
  last_synced_at       timestamptz,
  last_error           text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint google_ads_connections_sync_status_check
    check (last_sync_status in ('never', 'running', 'success', 'error'))
);

create table if not exists public.google_ads_customer_links (
  user_id             uuid primary key,
  customer_id         text not null unique,
  descriptive_name    text,
  currency_code       text,
  time_zone           text,
  account_status      text,
  linked_by_user_id   uuid not null,
  last_tested_at      timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint google_ads_customer_links_customer_id_check
    check (customer_id ~ '^\d{10}$'),
  constraint google_ads_customer_links_currency_check
    check (currency_code is null or currency_code ~ '^[A-Z]{3}$')
);

create table if not exists public.google_ads_campaign_daily_metrics (
  user_id          uuid not null,
  customer_id      text not null,
  campaign_id      text not null,
  campaign_name    text not null,
  campaign_status  text,
  metric_date      date not null,
  impressions      bigint not null default 0,
  clicks           bigint not null default 0,
  cost_micros      bigint not null default 0,
  conversions      numeric(20, 6) not null default 0,
  conversions_value numeric(24, 6) not null default 0,
  currency_code    text not null,
  time_zone        text not null,
  synced_at        timestamptz not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  primary key (user_id, customer_id, campaign_id, metric_date),
  constraint google_ads_metrics_customer_id_check check (customer_id ~ '^\d{10}$'),
  constraint google_ads_metrics_campaign_id_check check (campaign_id ~ '^\d+$'),
  constraint google_ads_metrics_nonnegative_check
    check (impressions >= 0 and clicks >= 0 and cost_micros >= 0),
  constraint google_ads_metrics_currency_check check (currency_code ~ '^[A-Z]{3}$')
);

create index if not exists google_ads_metrics_tenant_date_idx
  on public.google_ads_campaign_daily_metrics (user_id, metric_date desc);

create table if not exists public.google_ads_sync_runs (
  id              bigserial primary key,
  user_id         uuid not null,
  customer_id     text not null,
  triggered_by    uuid not null,
  date_from       date not null,
  date_to         date not null,
  status          text not null default 'running',
  rows_synced     integer not null default 0,
  error_code      text,
  error_message   text,
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  constraint google_ads_sync_runs_customer_id_check check (customer_id ~ '^\d{10}$'),
  constraint google_ads_sync_runs_status_check
    check (status in ('running', 'success', 'error')),
  constraint google_ads_sync_runs_range_check check (date_from <= date_to),
  constraint google_ads_sync_runs_rows_check check (rows_synced >= 0)
);

create index if not exists google_ads_sync_runs_tenant_idx
  on public.google_ads_sync_runs (user_id, started_at desc);

-- Vínculo + estado inicial entram juntos. Se a conta já estiver vinculada a
-- outro tenant, a constraint unique aborta a transação inteira.
create or replace function public.link_google_ads_customer_to_tenant(
  p_user_id uuid,
  p_customer_id text,
  p_descriptive_name text,
  p_currency_code text,
  p_time_zone text,
  p_account_status text,
  p_linked_by_user_id uuid,
  p_tested_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  previous_customer_id text;
begin
  if p_customer_id !~ '^\d{10}$' then
    raise exception 'customer_id invalido';
  end if;

  select customer_id into previous_customer_id
    from public.google_ads_customer_links
   where user_id = p_user_id
   for update;

  insert into public.google_ads_customer_links (
    user_id, customer_id, descriptive_name, currency_code, time_zone,
    account_status, linked_by_user_id, last_tested_at, updated_at
  ) values (
    p_user_id, p_customer_id, p_descriptive_name, p_currency_code, p_time_zone,
    p_account_status, p_linked_by_user_id, p_tested_at, p_tested_at
  )
  on conflict (user_id) do update set
    customer_id = excluded.customer_id,
    descriptive_name = excluded.descriptive_name,
    currency_code = excluded.currency_code,
    time_zone = excluded.time_zone,
    account_status = excluded.account_status,
    linked_by_user_id = excluded.linked_by_user_id,
    last_tested_at = excluded.last_tested_at,
    updated_at = excluded.updated_at;

  if previous_customer_id is distinct from p_customer_id then
    insert into public.google_ads_connections (
      user_id, last_sync_status, last_sync_started_at, last_synced_at,
      last_error, updated_at
    ) values (
      p_user_id, 'never', null, null, null, p_tested_at
    )
    on conflict (user_id) do update set
      last_sync_status = 'never',
      last_sync_started_at = null,
      last_synced_at = null,
      last_error = null,
      updated_at = excluded.updated_at;
  else
    insert into public.google_ads_connections (user_id, updated_at)
    values (p_user_id, p_tested_at)
    on conflict (user_id) do nothing;
  end if;
end;
$$;

revoke all on function public.link_google_ads_customer_to_tenant(
  uuid, text, text, text, text, text, uuid, timestamptz
) from public, anon, authenticated;
grant execute on function public.link_google_ads_customer_to_tenant(
  uuid, text, text, text, text, text, uuid, timestamptz
) to service_role;

-- Substitui um intervalo inteiro em uma única transação. Isso evita manter uma
-- linha antiga quando o Google corrige o relatório e deixa de retorná-la.
create or replace function public.replace_google_ads_campaign_daily_metrics(
  p_user_id uuid,
  p_customer_id text,
  p_date_from date,
  p_date_to date,
  p_rows jsonb,
  p_descriptive_name text,
  p_currency_code text,
  p_time_zone text,
  p_account_status text,
  p_finished_at timestamptz
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_count integer := 0;
begin
  if p_customer_id !~ '^\d{10}$' then
    raise exception 'customer_id invalido';
  end if;
  if p_date_from > p_date_to or (p_date_to - p_date_from) >= 90 then
    raise exception 'intervalo invalido';
  end if;
  if jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_rows, '[]'::jsonb)) > 100000 then
    raise exception 'payload de metricas invalido';
  end if;
  if exists (
    select 1
      from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as checked(metric_date date)
     where checked.metric_date is null
        or checked.metric_date < p_date_from
        or checked.metric_date > p_date_to
  ) then
    raise exception 'metrica fora do intervalo';
  end if;

  -- O lock impede que um relink concorrente receba status/métricas da conta
  -- anterior. O RPC de relink espera esta transação terminar e então reseta o
  -- estado da nova conta para "never".
  perform 1
    from public.google_ads_customer_links
   where user_id = p_user_id and customer_id = p_customer_id
   for update;
  if not found then
    raise exception 'vinculo Google Ads ausente ou alterado';
  end if;

  delete from public.google_ads_campaign_daily_metrics
   where user_id = p_user_id
     and customer_id = p_customer_id
     and metric_date between p_date_from and p_date_to;

  insert into public.google_ads_campaign_daily_metrics (
    user_id, customer_id, campaign_id, campaign_name, campaign_status,
    metric_date, impressions, clicks, cost_micros, conversions,
    conversions_value, currency_code, time_zone, synced_at, updated_at
  )
  select
    p_user_id, p_customer_id, row_data.campaign_id, row_data.campaign_name,
    row_data.campaign_status, row_data.metric_date, row_data.impressions,
    row_data.clicks, row_data.cost_micros, row_data.conversions,
    row_data.conversions_value, row_data.currency_code, row_data.time_zone,
    row_data.synced_at, row_data.updated_at
  from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as row_data(
    campaign_id text,
    campaign_name text,
    campaign_status text,
    metric_date date,
    impressions bigint,
    clicks bigint,
    cost_micros bigint,
    conversions numeric,
    conversions_value numeric,
    currency_code text,
    time_zone text,
    synced_at timestamptz,
    updated_at timestamptz
  );

  get diagnostics inserted_count = row_count;

  update public.google_ads_customer_links
     set descriptive_name = p_descriptive_name,
         currency_code = p_currency_code,
         time_zone = p_time_zone,
         account_status = p_account_status,
         last_tested_at = p_finished_at,
         updated_at = p_finished_at
   where user_id = p_user_id and customer_id = p_customer_id;

  update public.google_ads_connections
     set last_sync_status = 'success',
         last_synced_at = p_finished_at,
         last_error = null,
         updated_at = p_finished_at
   where user_id = p_user_id;
  if not found then
    raise exception 'estado da conexao Google Ads ausente';
  end if;

  return inserted_count;
end;
$$;

revoke all on function public.replace_google_ads_campaign_daily_metrics(
  uuid, text, date, date, jsonb, text, text, text, text, timestamptz
)
  from public, anon, authenticated;
grant execute on function public.replace_google_ads_campaign_daily_metrics(
  uuid, text, date, date, jsonb, text, text, text, text, timestamptz
)
  to service_role;

-- Só marca erro se o vínculo ainda aponta para a mesma conta que iniciou o
-- sync. Um relink concorrente não herda falha da conta anterior.
create or replace function public.mark_google_ads_sync_error(
  p_user_id uuid,
  p_customer_id text,
  p_error_message text,
  p_finished_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  perform 1
    from public.google_ads_customer_links
   where user_id = p_user_id and customer_id = p_customer_id
   for update;
  if not found then
    return false;
  end if;

  update public.google_ads_connections
     set last_sync_status = 'error',
         last_error = left(p_error_message, 500),
         updated_at = p_finished_at
   where user_id = p_user_id;
  return found;
end;
$$;

revoke all on function public.mark_google_ads_sync_error(uuid, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.mark_google_ads_sync_error(uuid, text, text, timestamptz)
  to service_role;

-- Desvincula conta + estado em uma única transação, mas preserva métricas e
-- sync_runs. O histórico só pode ser removido pelo fluxo separado de exclusão.
create or replace function public.unlink_google_ads_customer_from_tenant(
  p_user_id uuid
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  unlinked_customer_id text;
begin
  select customer_id into unlinked_customer_id
    from public.google_ads_customer_links
   where user_id = p_user_id
   for update;

  delete from public.google_ads_connections where user_id = p_user_id;
  delete from public.google_ads_customer_links where user_id = p_user_id;
  return unlinked_customer_id;
end;
$$;

revoke all on function public.unlink_google_ads_customer_from_tenant(uuid)
  from public, anon, authenticated;
grant execute on function public.unlink_google_ads_customer_from_tenant(uuid)
  to service_role;

alter table public.google_ads_connections enable row level security;
alter table public.google_ads_customer_links enable row level security;
alter table public.google_ads_campaign_daily_metrics enable row level security;
alter table public.google_ads_sync_runs enable row level security;

drop policy if exists google_ads_connections_select_own on public.google_ads_connections;
drop policy if exists google_ads_customer_links_select_own on public.google_ads_customer_links;
drop policy if exists google_ads_metrics_select_own on public.google_ads_campaign_daily_metrics;
drop policy if exists google_ads_sync_runs_select_own on public.google_ads_sync_runs;

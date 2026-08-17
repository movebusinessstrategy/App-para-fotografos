-- 073 — Fila auditável de solicitações de exclusão de dados.
--
-- O formulário público apenas registra uma solicitação pendente. Nenhum dado
-- operacional é excluído por esta migration ou pelo endpoint de cadastro.
-- A tabela não possui policies para anon/authenticated: somente o backend com
-- service_role pode inserir, consultar ou processar os protocolos.

create table if not exists public.data_deletion_requests (
  id                    uuid primary key default gen_random_uuid(),
  ticket_id             text not null unique,
  email                 text not null,
  scope                 text not null,
  reason                text,
  status                text not null default 'pending',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  processing_started_at timestamptz,
  completed_at          timestamptz,
  rejected_at           timestamptz,
  constraint data_deletion_requests_ticket_check
    check (ticket_id ~ '^DEL-[A-F0-9]{24}$'),
  constraint data_deletion_requests_email_check
    check (
      email = lower(btrim(email))
      and char_length(email) between 3 and 254
    ),
  constraint data_deletion_requests_scope_check
    check (scope in ('all', 'whatsapp_only', 'google_ads_only')),
  constraint data_deletion_requests_reason_check
    check (reason is null or char_length(reason) <= 1000),
  constraint data_deletion_requests_status_check
    check (status in ('pending', 'in_progress', 'completed', 'rejected'))
);

create index if not exists data_deletion_requests_email_created_idx
  on public.data_deletion_requests (email, created_at desc);

create index if not exists data_deletion_requests_status_created_idx
  on public.data_deletion_requests (status, created_at asc);

create or replace function public.touch_data_deletion_request_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists data_deletion_requests_touch_updated_at
  on public.data_deletion_requests;

create trigger data_deletion_requests_touch_updated_at
before update on public.data_deletion_requests
for each row execute function public.touch_data_deletion_request_updated_at();

alter table public.data_deletion_requests enable row level security;
alter table public.data_deletion_requests force row level security;

revoke all on table public.data_deletion_requests from anon, authenticated;
grant all on table public.data_deletion_requests to service_role;


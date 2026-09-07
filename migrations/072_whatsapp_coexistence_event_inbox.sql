-- 072 — Base durável para WhatsApp Coexistence, multiempresa e deduplicação.
--
-- A migration é aditiva: não remove constraints nem reatribui histórico legado.
-- O backend pode detectar estas tabelas/colunas e continuar no fluxo antigo caso
-- a migration ainda não tenha sido aplicada.

begin;

create extension if not exists pgcrypto;

-- Identidade estável do canal externo. phone_number_id prevalece porque é o
-- identificador canônico usado pelo Graph; WABA/legado são fallbacks explícitos.
create or replace function public.wa_channel_canonical_key(
  raw_provider text,
  raw_waba_id text,
  raw_phone_number_id text,
  raw_legacy_id text
)
returns text
language sql
immutable
parallel safe
as $$
  select lower(coalesce(nullif(btrim(raw_provider), ''), 'unknown')) || ':' ||
    case
      when nullif(btrim(raw_phone_number_id), '') is not null
        then 'phone:' || btrim(raw_phone_number_id)
      when nullif(btrim(raw_waba_id), '') is not null
        then 'waba:' || btrim(raw_waba_id)
      when nullif(btrim(raw_legacy_id), '') is not null
        then 'legacy:' || btrim(raw_legacy_id)
      else 'unresolved'
    end;
$$;

-- Uma linha por empresa + provedor + phone_number_id. A tabela legada
-- whatsapp_business_accounts continua intacta para rollback/fallback.
create table if not exists public.whatsapp_channel_accounts (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null,
  provider               text not null default 'meta',
  waba_id                text,
  phone_number_id        text,
  wa_number              text not null default '',
  preferred_channel      text not null default 'auto',
  mode                   text not null default 'cloud_api',
  is_active              boolean not null default true,
  legacy_account_id      text,
  canonical_key          text generated always as (
    public.wa_channel_canonical_key(provider, waba_id, phone_number_id, legacy_account_id)
  ) stored,
  sync_status            text not null default 'idle',
  sync_cursor            text,
  sync_attempts          integer not null default 0,
  sync_requested_at      timestamptz,
  sync_started_at        timestamptz,
  sync_updated_at        timestamptz,
  sync_completed_at      timestamptz,
  sync_lease_expires_at  timestamptz,
  sync_worker_id         text,
  sync_error             text,
  sync_details           jsonb not null default '{}'::jsonb,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint whatsapp_channel_accounts_provider_check
    check (provider ~ '^[a-z][a-z0-9_:-]{0,31}$'),
  constraint whatsapp_channel_accounts_identity_check
    check (
      nullif(btrim(phone_number_id), '') is not null
      or nullif(btrim(waba_id), '') is not null
      or nullif(btrim(legacy_account_id), '') is not null
    ),
  constraint whatsapp_channel_accounts_preferred_check
    check (preferred_channel in ('auto', 'meta', 'baileys')),
  constraint whatsapp_channel_accounts_sync_status_check
    check (sync_status in ('idle', 'pending', 'processing', 'synced', 'retry', 'failed', 'disabled')),
  constraint whatsapp_channel_accounts_attempts_check
    check (sync_attempts >= 0),
  constraint whatsapp_channel_accounts_details_check
    check (jsonb_typeof(sync_details) = 'object')
);

-- Compatibilidade caso a tabela tenha sido criada parcialmente fora do repo.
alter table public.whatsapp_channel_accounts add column if not exists provider text not null default 'meta';
alter table public.whatsapp_channel_accounts add column if not exists waba_id text;
alter table public.whatsapp_channel_accounts add column if not exists phone_number_id text;
alter table public.whatsapp_channel_accounts add column if not exists wa_number text not null default '';
alter table public.whatsapp_channel_accounts add column if not exists preferred_channel text not null default 'auto';
alter table public.whatsapp_channel_accounts add column if not exists mode text not null default 'cloud_api';
alter table public.whatsapp_channel_accounts add column if not exists is_active boolean not null default true;
alter table public.whatsapp_channel_accounts add column if not exists sync_status text not null default 'idle';
alter table public.whatsapp_channel_accounts add column if not exists sync_cursor text;
alter table public.whatsapp_channel_accounts add column if not exists sync_attempts integer not null default 0;
alter table public.whatsapp_channel_accounts add column if not exists sync_requested_at timestamptz;
alter table public.whatsapp_channel_accounts add column if not exists sync_started_at timestamptz;
alter table public.whatsapp_channel_accounts add column if not exists sync_updated_at timestamptz;
alter table public.whatsapp_channel_accounts add column if not exists sync_completed_at timestamptz;
alter table public.whatsapp_channel_accounts add column if not exists sync_lease_expires_at timestamptz;
alter table public.whatsapp_channel_accounts add column if not exists sync_worker_id text;
alter table public.whatsapp_channel_accounts add column if not exists sync_error text;
alter table public.whatsapp_channel_accounts add column if not exists sync_details jsonb not null default '{}'::jsonb;
alter table public.whatsapp_channel_accounts add column if not exists legacy_account_id text;
alter table public.whatsapp_channel_accounts add column if not exists created_at timestamptz not null default now();
alter table public.whatsapp_channel_accounts add column if not exists updated_at timestamptz not null default now();
alter table public.whatsapp_channel_accounts add column if not exists canonical_key text generated always as (
  public.wa_channel_canonical_key(provider, waba_id, phone_number_id, legacy_account_id)
) stored;

create unique index if not exists whatsapp_channel_accounts_identity_uidx
  on public.whatsapp_channel_accounts (user_id, provider, canonical_key);
create unique index if not exists whatsapp_channel_accounts_phone_uidx
  on public.whatsapp_channel_accounts (user_id, phone_number_id)
  where nullif(btrim(phone_number_id), '') is not null;
create index if not exists whatsapp_channel_accounts_sender_idx
  on public.whatsapp_channel_accounts (user_id, wa_number, is_active);
create index if not exists whatsapp_channel_accounts_sync_worker_idx
  on public.whatsapp_channel_accounts (
    sync_status, sync_requested_at, sync_lease_expires_at, updated_at
  )
  where sync_status in ('pending', 'processing', 'retry');

alter table public.whatsapp_channel_accounts enable row level security;
drop policy if exists whatsapp_channel_accounts_select_own on public.whatsapp_channel_accounts;
create policy whatsapp_channel_accounts_select_own on public.whatsapp_channel_accounts
  for select using (auth.uid() = user_id);
drop policy if exists whatsapp_channel_accounts_insert_own on public.whatsapp_channel_accounts;
create policy whatsapp_channel_accounts_insert_own on public.whatsapp_channel_accounts
  for insert with check (auth.uid() = user_id);
drop policy if exists whatsapp_channel_accounts_update_own on public.whatsapp_channel_accounts;
create policy whatsapp_channel_accounts_update_own on public.whatsapp_channel_accounts
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Snapshot mínimo de contatos recebido pelo smb_app_state_sync. Ele pode chegar
-- antes do histórico; por isso não depende de wa_conversations/wa_messages.
create table if not exists public.whatsapp_channel_contacts (
  id                  bigint generated by default as identity primary key,
  user_id             uuid not null,
  channel_account_id  uuid,
  phone_number_id     text not null,
  wa_number           text not null default '',
  contact_phone       text not null,
  contact_name        text,
  raw                 jsonb not null default '{}'::jsonb,
  synced_at           timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint whatsapp_channel_contacts_account_fk
    foreign key (channel_account_id)
    references public.whatsapp_channel_accounts(id)
    on delete set null,
  constraint whatsapp_channel_contacts_phone_check
    check (nullif(btrim(contact_phone), '') is not null),
  constraint whatsapp_channel_contacts_payload_check
    check (jsonb_typeof(raw) in ('object', 'array')),
  constraint whatsapp_channel_contacts_identity_unique
    unique (user_id, phone_number_id, contact_phone)
);

create index if not exists whatsapp_channel_contacts_account_idx
  on public.whatsapp_channel_contacts (user_id, channel_account_id, synced_at desc);
create index if not exists whatsapp_channel_contacts_lookup_idx
  on public.whatsapp_channel_contacts (user_id, wa_number, contact_phone);

alter table public.whatsapp_channel_contacts enable row level security;
drop policy if exists whatsapp_channel_contacts_select_own on public.whatsapp_channel_contacts;
create policy whatsapp_channel_contacts_select_own on public.whatsapp_channel_contacts
  for select using (auth.uid() = user_id);
-- Escritas são exclusivas do webhook/worker com service_role.

-- Inbox append-only de webhooks. event_key deve ser determinístico (por exemplo,
-- message_id; ou message_id+status+timestamp para atualizações de status).
create table if not exists public.whatsapp_webhook_inbox (
  id                     bigint generated by default as identity primary key,
  user_id                uuid not null,
  provider               text not null default 'meta',
  phone_number_id        text not null,
  wa_number              text not null default '',
  event_key              text not null,
  field                  text not null default 'messages',
  payload                jsonb not null,
  status                 text not null default 'pending',
  attempts               integer not null default 0,
  next_attempt_at        timestamptz not null default now(),
  processing_started_at  timestamptz,
  lease_expires_at       timestamptz,
  worker_id              text,
  last_error             text,
  received_at            timestamptz not null default now(),
  processed_at           timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint whatsapp_webhook_inbox_provider_check
    check (provider ~ '^[a-z][a-z0-9_:-]{0,31}$'),
  constraint whatsapp_webhook_inbox_event_key_check
    check (char_length(btrim(event_key)) between 1 and 500),
  constraint whatsapp_webhook_inbox_status_check
    check (status in ('pending', 'processing', 'processed', 'retry', 'dead')),
  constraint whatsapp_webhook_inbox_attempts_check
    check (attempts >= 0),
  constraint whatsapp_webhook_inbox_payload_check
    check (jsonb_typeof(payload) in ('object', 'array'))
);

create unique index if not exists whatsapp_webhook_inbox_event_uidx
  on public.whatsapp_webhook_inbox (user_id, phone_number_id, event_key);
create index if not exists whatsapp_webhook_inbox_worker_idx
  on public.whatsapp_webhook_inbox (
    status, next_attempt_at, lease_expires_at, received_at
  )
  where status in ('pending', 'processing', 'retry');
-- O runtime consulta pendentes por ordem de chegada e leases expirados em uma
-- consulta separada; estes índices evitam varrer a inbox inteira nos dois casos.
create index if not exists whatsapp_webhook_inbox_pending_idx
  on public.whatsapp_webhook_inbox (status, received_at)
  where status in ('pending', 'retry');
create index if not exists whatsapp_webhook_inbox_lease_idx
  on public.whatsapp_webhook_inbox (lease_expires_at, received_at)
  where status = 'processing';
create index if not exists whatsapp_webhook_inbox_tenant_timeline_idx
  on public.whatsapp_webhook_inbox (user_id, phone_number_id, received_at desc);

alter table public.whatsapp_webhook_inbox enable row level security;
drop policy if exists whatsapp_webhook_inbox_select_own on public.whatsapp_webhook_inbox;
create policy whatsapp_webhook_inbox_select_own on public.whatsapp_webhook_inbox
  for select using (auth.uid() = user_id);
-- INSERT/UPDATE/DELETE ficam sem policy: webhook e worker usam service_role.

-- Proveniência é opcional no histórico antigo e obrigatória apenas no runtime
-- novo. FKs usam ON DELETE SET NULL para nunca apagar mensagens/conversas.
do $$
begin
  if to_regclass('public.wa_messages') is not null then
    alter table public.wa_messages add column if not exists channel_account_id uuid;
    alter table public.wa_messages add column if not exists provider text;
    alter table public.wa_messages add column if not exists provider_message_id text;
    alter table public.wa_messages add column if not exists source_event_key text;
    alter table public.wa_messages add column if not exists webhook_inbox_id bigint;

    if not exists (
      select 1 from pg_constraint
      where conrelid = 'public.wa_messages'::regclass
        and conname = 'wa_messages_channel_account_fk'
    ) then
      alter table public.wa_messages
        add constraint wa_messages_channel_account_fk
        foreign key (channel_account_id)
        references public.whatsapp_channel_accounts(id)
        on delete set null not valid;
    end if;

    if not exists (
      select 1 from pg_constraint
      where conrelid = 'public.wa_messages'::regclass
        and conname = 'wa_messages_webhook_inbox_fk'
    ) then
      alter table public.wa_messages
        add constraint wa_messages_webhook_inbox_fk
        foreign key (webhook_inbox_id)
        references public.whatsapp_webhook_inbox(id)
        on delete set null not valid;
    end if;

    create unique index if not exists wa_messages_provider_message_uidx
      on public.wa_messages (user_id, wa_number, provider, provider_message_id)
      where nullif(btrim(provider), '') is not null
        and nullif(btrim(provider_message_id), '') is not null
        and nullif(btrim(wa_number), '') is not null;
    create index if not exists wa_messages_source_event_idx
      on public.wa_messages (user_id, source_event_key)
      where source_event_key is not null;
  end if;

  if to_regclass('public.wa_conversations') is not null then
    alter table public.wa_conversations add column if not exists channel_account_id uuid;
    alter table public.wa_conversations add column if not exists provider text;

    if not exists (
      select 1 from pg_constraint
      where conrelid = 'public.wa_conversations'::regclass
        and conname = 'wa_conversations_channel_account_fk'
    ) then
      alter table public.wa_conversations
        add constraint wa_conversations_channel_account_fk
        foreign key (channel_account_id)
        references public.whatsapp_channel_accounts(id)
        on delete set null not valid;
    end if;

    create index if not exists wa_conversations_channel_account_idx
      on public.wa_conversations (user_id, channel_account_id, last_message_at desc)
      where channel_account_id is not null;
  end if;
end;
$$;

-- Backfill somente do registro de conta; não altera mensagens nem conversas.
-- Se a tabela legada tiver schema diferente, o bloco é simplesmente ignorado.
do $$
begin
  if to_regclass('public.whatsapp_business_accounts') is not null
     and not exists (
       select 1
       from (values
         ('id'), ('user_id'), ('waba_id'), ('phone_number_id'),
         ('phone_number'), ('mode'), ('is_active')
       ) required(column_name)
       where not exists (
         select 1 from information_schema.columns c
         where c.table_schema = 'public'
           and c.table_name = 'whatsapp_business_accounts'
           and c.column_name = required.column_name
       )
     )
  then
    insert into public.whatsapp_channel_accounts (
      user_id, provider, waba_id, phone_number_id, wa_number,
      preferred_channel, mode, is_active, sync_status,
      sync_updated_at, sync_details, legacy_account_id
    )
    select
      a.user_id::text::uuid,
      'meta',
      nullif(btrim(a.waba_id::text), ''),
      nullif(btrim(a.phone_number_id::text), ''),
      regexp_replace(coalesce(a.phone_number::text, ''), '\D', '', 'g'),
      -- Nunca força Meta só porque a linha legada está ativa: há registros
      -- cloud_api desconectados. O runtime decide após diagnóstico operacional.
      'auto',
      coalesce(nullif(btrim(a.mode::text), ''), 'cloud_api'),
      coalesce(a.is_active, false),
      case when coalesce(a.is_active, false) then 'idle' else 'disabled' end,
      now(),
      jsonb_build_object('source', 'migration_072_legacy_backfill'),
      a.id::text
    from public.whatsapp_business_accounts a
    where a.user_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and (
        nullif(btrim(a.phone_number_id::text), '') is not null
        or nullif(btrim(a.waba_id::text), '') is not null
      )
    on conflict do nothing;
  end if;
end;
$$;

commit;

-- Rollback operacional (não executar junto): remover primeiro as colunas/FKs
-- opcionais do histórico e depois as três tabelas e wa_channel_canonical_key.

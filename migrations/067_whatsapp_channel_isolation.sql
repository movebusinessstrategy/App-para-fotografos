-- 067 — Isolamento imutável do histórico por número remetente.
--
-- Regra central: uma troca/reconexão de WhatsApp cria um novo canal. Ela nunca
-- recarimba conversas ou mensagens antigas com o número novo.

create or replace function public.wa_sender_key(raw_sender text)
returns text
language sql
immutable
parallel safe
as $$
  select regexp_replace(coalesce(raw_sender, ''), '\D', '', 'g');
$$;

create or replace function public.wa_phone_key(raw_phone text)
returns text
language sql
immutable
parallel safe
as $$
  with cleaned as (
    select regexp_replace(coalesce(raw_phone, ''), '\D', '', 'g') as value
  )
  select case
    when length(value) = 13
      and left(value, 2) = '55'
      and substr(value, 5, 1) = '9'
      then substr(value, 1, 4) || substr(value, 6)
    else value
  end
  from cleaned;
$$;

-- Repara apenas casos inequívocos: a mensagem aponta para um canal que não tem
-- conversa, e existe exatamente um outro canal com essa mesma pessoa.
with message_targets as (
  select
    m.id,
    min(public.wa_sender_key(c.wa_number)) as target_wa_number
  from public.wa_messages m
  join public.wa_conversations c
    on c.user_id = m.user_id
   and public.wa_phone_key(c.phone) = public.wa_phone_key(m.phone)
   and public.wa_sender_key(c.wa_number) <> ''
  group by m.id, m.wa_number
  having count(distinct public.wa_sender_key(c.wa_number)) = 1
     and bool_and(public.wa_sender_key(c.wa_number) <> public.wa_sender_key(m.wa_number))
)
update public.wa_messages m
   set wa_number = t.target_wa_number
  from message_targets t
 where m.id = t.id;

-- Conversas legadas sem remetente recebem o canal somente quando suas próprias
-- mensagens apontam para um único número.
with conversation_targets as (
  select
    c.id,
    min(public.wa_sender_key(m.wa_number)) as target_wa_number
  from public.wa_conversations c
  join public.wa_messages m
    on m.user_id = c.user_id
   and public.wa_phone_key(m.phone) = public.wa_phone_key(c.phone)
   and public.wa_sender_key(m.wa_number) <> ''
  where public.wa_sender_key(c.wa_number) = ''
  group by c.id
  having count(distinct public.wa_sender_key(m.wa_number)) = 1
)
update public.wa_conversations c
   set wa_number = t.target_wa_number
  from conversation_targets t
 where c.id = t.id
   and not exists (
     select 1
       from public.wa_conversations existing
      where existing.id <> c.id
        and existing.user_id = c.user_id
        and existing.phone = c.phone
        and public.wa_sender_key(existing.wa_number) = t.target_wa_number
   )
   and 1 = (
     select count(*)
       from public.wa_conversations blank_peer
      where blank_peer.user_id = c.user_id
        and blank_peer.phone = c.phone
        and public.wa_sender_key(blank_peer.wa_number) = ''
   );

alter table public.scheduled_followups
  add column if not exists wa_number text;

with followup_targets as (
  select
    f.id,
    min(public.wa_sender_key(m.wa_number)) as target_wa_number
  from public.scheduled_followups f
  join public.wa_messages m
    on m.user_id = f.user_id
   and public.wa_phone_key(m.phone) = public.wa_phone_key(f.phone)
   and public.wa_sender_key(m.wa_number) <> ''
  where public.wa_sender_key(f.wa_number) = ''
  group by f.id
  having count(distinct public.wa_sender_key(m.wa_number)) = 1
)
update public.scheduled_followups f
   set wa_number = t.target_wa_number
  from followup_targets t
 where f.id = t.id;

-- A restrição antiga (user_id, phone) impedia a mesma pessoa de ter uma
-- conversa independente em dois números do estúdio. Substitui por canal+fone.
do $$
declare
  constraint_row record;
  user_attnum smallint;
  phone_attnum smallint;
begin
  select attnum into user_attnum
    from pg_attribute
   where attrelid = 'public.wa_conversations'::regclass
     and attname = 'user_id';
  select attnum into phone_attnum
    from pg_attribute
   where attrelid = 'public.wa_conversations'::regclass
     and attname = 'phone';

  for constraint_row in
    select conname
      from pg_constraint
     where conrelid = 'public.wa_conversations'::regclass
       and contype = 'u'
       and cardinality(conkey) = 2
       and conkey @> array[user_attnum, phone_attnum]::smallint[]
  loop
    execute format(
      'alter table public.wa_conversations drop constraint %I',
      constraint_row.conname
    );
  end loop;
end;
$$;

create unique index if not exists wa_conversations_channel_phone_unique
  on public.wa_conversations (user_id, wa_number, phone)
  where public.wa_sender_key(wa_number) <> '';

create index if not exists wa_conversations_channel_phone_lookup
  on public.wa_conversations (user_id, wa_number, phone, last_message_at desc);

create index if not exists wa_messages_channel_phone_timeline
  on public.wa_messages (user_id, wa_number, phone, timestamp asc);

create index if not exists scheduled_followups_channel_pending
  on public.scheduled_followups (user_id, wa_number, status, scheduled_at);

alter table public.wa_conversations
  drop constraint if exists wa_conversations_requires_channel;
alter table public.wa_conversations
  add constraint wa_conversations_requires_channel
  check (btrim(coalesce(wa_number, '')) <> '') not valid;

alter table public.wa_messages
  drop constraint if exists wa_messages_requires_channel;
alter table public.wa_messages
  add constraint wa_messages_requires_channel
  check (btrim(coalesce(wa_number, '')) <> '') not valid;

create or replace function public.guard_wa_conversation_channel()
returns trigger
language plpgsql
as $$
begin
  if public.wa_sender_key(old.wa_number) <> ''
     and public.wa_sender_key(new.wa_number) <> public.wa_sender_key(old.wa_number)
  then
    raise exception 'wa_conversation_channel_is_immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists wa_conversations_channel_immutable on public.wa_conversations;
create trigger wa_conversations_channel_immutable
before update of wa_number on public.wa_conversations
for each row execute function public.guard_wa_conversation_channel();

create or replace function public.guard_wa_message_channel()
returns trigger
language plpgsql
as $$
begin
  if public.wa_sender_key(old.wa_number) <> ''
     and public.wa_sender_key(new.wa_number) <> public.wa_sender_key(old.wa_number)
     and current_setting('app.wa_channel_repair', true) <> 'on'
  then
    raise exception 'wa_message_channel_is_immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists wa_messages_channel_immutable on public.wa_messages;
create trigger wa_messages_channel_immutable
before update of wa_number on public.wa_messages
for each row execute function public.guard_wa_message_channel();

-- Único caminho permitido para reparar mensagens históricas: só move IDs
-- explícitos quando a pessoa existe exclusivamente no canal de destino.
create or replace function public.repair_wa_message_channel(
  p_user_id uuid,
  p_target_wa_number text,
  p_message_ids text[]
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  changed integer := 0;
  target_key text := public.wa_sender_key(p_target_wa_number);
begin
  if target_key = '' or coalesce(array_length(p_message_ids, 1), 0) = 0 then
    return 0;
  end if;

  perform set_config('app.wa_channel_repair', 'on', true);
  update public.wa_messages m
     set wa_number = target_key
   where m.user_id = p_user_id
     and m.message_id = any(p_message_ids)
     and exists (
       select 1
         from public.wa_conversations c
        where c.user_id = m.user_id
          and public.wa_phone_key(c.phone) = public.wa_phone_key(m.phone)
          and public.wa_sender_key(c.wa_number) = target_key
     )
     and not exists (
       select 1
         from public.wa_conversations c
        where c.user_id = m.user_id
          and public.wa_phone_key(c.phone) = public.wa_phone_key(m.phone)
          and public.wa_sender_key(c.wa_number) <> target_key
          and public.wa_sender_key(c.wa_number) <> ''
     );
  get diagnostics changed = row_count;
  return changed;
end;
$$;

revoke all on function public.repair_wa_message_channel(uuid, text, text[]) from public;
revoke all on function public.repair_wa_message_channel(uuid, text, text[]) from anon;
revoke all on function public.repair_wa_message_channel(uuid, text, text[]) from authenticated;
grant execute on function public.repair_wa_message_channel(uuid, text, text[]) to service_role;

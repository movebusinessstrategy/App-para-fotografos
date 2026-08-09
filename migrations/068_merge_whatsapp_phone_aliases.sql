-- 068 — Consolida aliases brasileiros do mesmo contato dentro de um canal.
--
-- As mensagens não são alteradas. Somente cards duplicados de conversa são
-- arquivados e removidos da lista ativa; o histórico continua sendo buscado
-- pelas variantes com e sem o nono dígito.

create table if not exists public.wa_conversation_alias_archive (
  id bigint primary key,
  user_id uuid not null,
  kept_conversation_id bigint not null,
  sender_key text not null,
  phone_key text not null,
  conversation jsonb not null,
  archived_at timestamptz not null default now()
);

alter table public.wa_conversation_alias_archive enable row level security;

-- Mantém no card vencedor o nome e os estados úteis encontrados nos aliases.
with ranked as (
  select
    c.*,
    first_value(c.id) over (
      partition by c.user_id,
        public.wa_sender_key(c.wa_number),
        public.wa_phone_key(c.phone)
      order by c.last_message_at desc nulls last,
        c.updated_at desc nulls last,
        c.id desc
    ) as keeper_id,
    count(*) over (
      partition by c.user_id,
        public.wa_sender_key(c.wa_number),
        public.wa_phone_key(c.phone)
    ) as group_size
  from public.wa_conversations c
  where public.wa_sender_key(c.wa_number) <> ''
    and public.wa_phone_key(c.phone) <> ''
), grouped as (
  select
    r.keeper_id,
    (
      array_agg(
        nullif(btrim(r.contact_name), '')
        order by r.last_message_at desc nulls last,
          r.updated_at desc nulls last,
          r.id desc
      ) filter (where nullif(btrim(r.contact_name), '') is not null)
    )[1] as contact_name,
    max(coalesce(r.unread_count, 0)) as unread_count,
    bool_or(coalesce(r.needs_human, false)) as needs_human,
    bool_and(coalesce(r.archived, false)) as archived,
    max(r.updated_at) as updated_at,
    max(r.last_agent_reply_at) as last_agent_reply_at
  from ranked r
  where r.group_size > 1
  group by r.keeper_id
)
update public.wa_conversations keeper
   set contact_name = coalesce(g.contact_name, keeper.contact_name),
       unread_count = greatest(coalesce(keeper.unread_count, 0), g.unread_count),
       needs_human = g.needs_human,
       archived = g.archived,
       updated_at = greatest(keeper.updated_at, g.updated_at),
       last_agent_reply_at = greatest(keeper.last_agent_reply_at, g.last_agent_reply_at)
  from grouped g
 where keeper.id = g.keeper_id;

-- Guarda uma cópia integral e recuperável antes de retirar aliases da lista.
with ranked as (
  select
    c.id,
    first_value(c.id) over (
      partition by c.user_id,
        public.wa_sender_key(c.wa_number),
        public.wa_phone_key(c.phone)
      order by c.last_message_at desc nulls last,
        c.updated_at desc nulls last,
        c.id desc
    ) as keeper_id,
    public.wa_sender_key(c.wa_number) as sender_key,
    public.wa_phone_key(c.phone) as phone_key,
    row_number() over (
      partition by c.user_id,
        public.wa_sender_key(c.wa_number),
        public.wa_phone_key(c.phone)
      order by c.last_message_at desc nulls last,
        c.updated_at desc nulls last,
        c.id desc
    ) as row_rank
  from public.wa_conversations c
  where public.wa_sender_key(c.wa_number) <> ''
    and public.wa_phone_key(c.phone) <> ''
)
insert into public.wa_conversation_alias_archive (
  id, user_id, kept_conversation_id, sender_key, phone_key, conversation, archived_at
)
select
  c.id,
  c.user_id,
  r.keeper_id,
  r.sender_key,
  r.phone_key,
  to_jsonb(c),
  now()
from ranked r
join public.wa_conversations c on c.id = r.id
where r.row_rank > 1
on conflict (id) do nothing;

with ranked as (
  select
    c.id,
    row_number() over (
      partition by c.user_id,
        public.wa_sender_key(c.wa_number),
        public.wa_phone_key(c.phone)
      order by c.last_message_at desc nulls last,
        c.updated_at desc nulls last,
        c.id desc
    ) as row_rank
  from public.wa_conversations c
  where public.wa_sender_key(c.wa_number) <> ''
    and public.wa_phone_key(c.phone) <> ''
)
delete from public.wa_conversations c
using ranked r
where c.id = r.id
  and r.row_rank > 1;

create unique index if not exists wa_conversations_canonical_channel_phone_unique
  on public.wa_conversations (
    user_id,
    public.wa_sender_key(wa_number),
    public.wa_phone_key(phone)
  )
  where public.wa_sender_key(wa_number) <> ''
    and public.wa_phone_key(phone) <> '';

-- Caminhos legados ainda podem tentar inserir a outra grafia do mesmo número.
-- Em vez de criar outro card, atualiza o card canônico e cancela o INSERT.
create or replace function public.merge_wa_conversation_phone_alias()
returns trigger
language plpgsql
as $$
declare
  existing_id bigint;
begin
  if public.wa_sender_key(new.wa_number) = ''
     or public.wa_phone_key(new.phone) = ''
  then
    return new;
  end if;

  select c.id
    into existing_id
    from public.wa_conversations c
   where c.user_id = new.user_id
     and public.wa_sender_key(c.wa_number) = public.wa_sender_key(new.wa_number)
     and public.wa_phone_key(c.phone) = public.wa_phone_key(new.phone)
   limit 1;

  if existing_id is null then
    return new;
  end if;

  update public.wa_conversations c
     set contact_name = coalesce(nullif(btrim(new.contact_name), ''), c.contact_name),
         last_message = case
           when c.last_message_at is null
             or coalesce(new.last_message_at, '-infinity'::timestamptz) >= c.last_message_at
             then coalesce(new.last_message, c.last_message)
           else c.last_message
         end,
         last_message_at = greatest(c.last_message_at, new.last_message_at),
         unread_count = greatest(coalesce(c.unread_count, 0), coalesce(new.unread_count, 0)),
         needs_human = coalesce(c.needs_human, false) or coalesce(new.needs_human, false),
         last_from_me = case
           when c.last_message_at is null
             or coalesce(new.last_message_at, '-infinity'::timestamptz) >= c.last_message_at
             then coalesce(new.last_from_me, c.last_from_me)
           else c.last_from_me
         end,
         last_agent_reply_at = greatest(c.last_agent_reply_at, new.last_agent_reply_at),
         archived = coalesce(new.archived, c.archived),
         updated_at = greatest(c.updated_at, new.updated_at, now())
   where c.id = existing_id;

  return null;
end;
$$;

drop trigger if exists wa_conversations_merge_phone_alias on public.wa_conversations;
create trigger wa_conversations_merge_phone_alias
before insert on public.wa_conversations
for each row execute function public.merge_wa_conversation_phone_alias();


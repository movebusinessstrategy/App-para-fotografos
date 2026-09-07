-- 071 — Portfólio seguro e estruturado da Lia.
--
-- Os links são cadastrados explicitamente pelo proprietário. Nada é extraído
-- das conversas ou do histórico de clientes. A lista começa vazia e não altera
-- o estado do atendimento autônomo.

begin;

alter table public.ai_agent_config
  add column if not exists portfolio_links jsonb not null default '[]'::jsonb;

create or replace function public.ai_agent_portfolio_links_valid(value jsonb)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
declare
  item jsonb;
  item_label text;
  item_url text;
  item_niche text;
begin
  if value is null or jsonb_typeof(value) <> 'array' then
    return false;
  end if;
  if jsonb_array_length(value) > 30 then
    return false;
  end if;

  for item in select jsonb_array_elements(value)
  loop
    if jsonb_typeof(item) <> 'object' or (item - 'label' - 'url' - 'niche') <> '{}'::jsonb then
      return false;
    end if;
    if jsonb_typeof(item -> 'label') <> 'string'
      or jsonb_typeof(item -> 'url') <> 'string'
      or jsonb_typeof(item -> 'niche') <> 'string' then
      return false;
    end if;

    item_label := btrim(item ->> 'label');
    item_url := btrim(item ->> 'url');
    item_niche := lower(btrim(item ->> 'niche'));

    if char_length(item_label) not between 1 and 120
      or item_label ~ '[[:cntrl:]]' then
      return false;
    end if;
    if char_length(item_url) not between 10 and 2048
      or item_url !~* '^https?://[^[:space:]]+$'
      or item_url ~* '^https?://[^/@[:space:]]+@' then
      return false;
    end if;
    if item_niche <> all (array[
      'geral', 'gestante', 'newborn', 'familia', 'smash_the_cake',
      'aniversario', 'infantil', 'casal', 'feminino', 'marca_pessoal',
      'revelacao', 'batizado'
    ]) then
      return false;
    end if;
  end loop;

  return true;
end;
$$;

alter table public.ai_agent_config
  drop constraint if exists ai_agent_config_portfolio_links_check;

alter table public.ai_agent_config
  add constraint ai_agent_config_portfolio_links_check
  check (public.ai_agent_portfolio_links_valid(portfolio_links));

comment on column public.ai_agent_config.portfolio_links is
  'Links de portfólio aprovados manualmente, no formato [{"label","url","niche"}]. Não extrair do histórico.';

commit;

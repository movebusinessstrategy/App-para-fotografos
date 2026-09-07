-- 075 — Libera no portfólio da Lia os nichos que já têm orçamento cadastrado.
--
-- A 071 fixou uma lista de nichos que ficou menor que a lista real de pacotes do
-- estúdio: acompanhamento do bebê (baby), chá de bebê/revelação e anunciação têm
-- PDF de orçamento e ensaios publicados, mas não podiam ter link aprovado. Quem
-- dizia "não conheço o trabalho de vocês" nesses nichos caía em hand-off.
--
-- Só muda a validação. Nenhum link é inserido aqui: quem cadastra é o dono.

begin;

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
  -- 30 não cabia mais: são 14 nichos com pacote, a 3 ou 4 ensaios cada.
  if jsonb_array_length(value) > 60 then
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

    if char_length(item_label) not between 1 and 200
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
      'revelacao', 'batizado', 'baby', 'cha_revelacao', 'anunciacao'
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

commit;

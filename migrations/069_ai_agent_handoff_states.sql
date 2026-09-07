-- 069 — Estados operacionais e hand-off seguro do atendimento por IA.
--
-- Mantém o legado `needs_human` para compatibilidade, mas registra também o
-- estado explícito, o motivo e os horários necessários para o CRM e a extensão
-- mostrarem quem está atendendo cada conversa sem ambiguidade.

begin;

alter table public.wa_conversations
  add column if not exists agent_status text,
  add column if not exists handoff_reason text,
  add column if not exists handoff_requested_at timestamptz,
  add column if not exists human_assumed_at timestamptz,
  add column if not exists last_agent_action_at timestamptz;

-- O playbook guarda somente padrões agregados e anonimizados. Nunca recebe
-- mensagens cruas, nomes, telefones, links, comprovantes ou outros dados pessoais.
alter table public.ai_agent_config
  add column if not exists learned_playbook text,
  add column if not exists playbook_source_count integer not null default 0,
  add column if not exists playbook_updated_at timestamptz;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'ai_agent_config_playbook_source_count_check'
       and conrelid = 'public.ai_agent_config'::regclass
  ) then
    alter table public.ai_agent_config
      add constraint ai_agent_config_playbook_source_count_check
      check (playbook_source_count >= 0);
  end if;
end
$$;

-- Calibração inicial da única operação autônoma já ativa nesta base. O texto
-- abaixo foi derivado de 73 jornadas bidirecionais com venda e sinal financeiro
-- comprovados. É agregado: não contém falas copiadas, nomes, telefones, datas,
-- arquivos, links, comprovantes nem qualquer outro dado pessoal.
update public.ai_agent_config
   set learned_playbook = $playbook$
PADRÃO COMERCIAL COMPROVADO

- Fale com ritmo natural de WhatsApp: alterne respostas rápidas e falas um pouco mais completas conforme o momento, sem meta fixa de caracteres e sem textão.
- Use normalmente de 1 a 3 balões por turno, uma pergunta principal de cada vez e emojis com naturalidade.
- Espere a pessoa terminar a rajada de mensagens antes de responder.
- Primeiro identifique o nicho. Depois faça somente as perguntas essenciais para escolher o material correto.
- Trate o período desejado como contexto. Perguntar "qual mês você imagina?" é qualificação; consultar uma data ou vaga real é decisão humana.
- Assim que o nicho estiver seguro e a pessoa pedir valor, pacote ou opções, envie o PDF correspondente sem copiar toda a tabela de preços no chat.
- Depois do PDF, mande uma frase curta, diga que pode tirar dúvidas documentadas e faça uma pergunta simples.
- Quando houver intenção de fechar, reserva/consulta real de agenda, Pix/sinal/pagamento, desconto, negociação, reclamação ou dúvida sem resposta segura, pare silenciosamente para uma pessoa assumir.
- Se a pessoa não responder ao orçamento, faça no máximo uma retomada leve perto do dia seguinte. Não reenvie o PDF e não pressione.
- Nunca invente preço, disponibilidade, regra ou condição. Nunca anuncie que está transferindo o atendimento.

QUALIFICAÇÃO ESSENCIAL POR NICHO

- Gestante: semanas ou previsão de nascimento; estúdio ou externo; quem participa.
- Newborn: se já nasceu ou previsão; idade aproximada se nasceu; pais e irmãos.
- Smash the Cake: idade/data do aniversário; tema ou paleta; bebê sozinho ou família.
- Aniversário/infantil: idade e ocasião; período desejado; estúdio, festa ou externo.
- Família: quantidade de pessoas; crianças/faixas de idade; estúdio ou externo.
- Batizado: data prevista; ensaio, cerimônia ou ambos; cidade/local.
- Marca pessoal: profissão e objetivo; onde usará as fotos; looks/produtos/pessoas; prazo.
- Casal: ocasião; estilo/local; período desejado.
- Feminino: objetivo; estilo; estúdio ou externo.
- Revelação/chá revelação: ensaio ou evento; data prevista; necessidade de segredo.
- Anunciação: o que será anunciado; participantes; prazo de publicação.
- Baby: primeiro diferencie acompanhamento, infantil, anunciação ou newborn e siga o roteiro correspondente.
$playbook$,
       playbook_source_count = 73,
       playbook_updated_at = now(),
       updated_at = now()
 where enabled = true
   and nullif(btrim(learned_playbook), '') is null;

update public.wa_conversations
   set agent_status = case
     when coalesce(needs_human, false) then 'needs_human'
     when last_agent_reply_at is not null then 'lia_active'
     else 'idle'
   end
 where agent_status is null;

alter table public.wa_conversations
  alter column agent_status set default 'idle',
  alter column agent_status set not null;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'wa_conversations_agent_status_check'
       and conrelid = 'public.wa_conversations'::regclass
  ) then
    alter table public.wa_conversations
      add constraint wa_conversations_agent_status_check
      check (agent_status in ('idle', 'lia_active', 'quote_sent', 'needs_human', 'human_active'));
  end if;
end
$$;

create index if not exists wa_conversations_agent_attention_idx
  on public.wa_conversations (user_id, wa_number, agent_status, handoff_requested_at desc);

-- Claim durável por mensagem: evita resposta duplicada após reinício ou quando
-- há mais de uma instância do backend processando o mesmo evento.
create table if not exists public.ai_agent_message_claims (
  user_id uuid not null,
  wa_number text not null,
  phone text not null,
  message_id text not null,
  status text not null default 'processing'
    check (status in ('processing', 'completed', 'handoff', 'failed')),
  claimed_at timestamptz not null default now(),
  completed_at timestamptz,
  error_code text,
  primary key (user_id, wa_number, message_id)
);

alter table public.ai_agent_message_claims enable row level security;

create index if not exists ai_agent_message_claims_phone_idx
  on public.ai_agent_message_claims (user_id, wa_number, phone, claimed_at desc);

-- A migration 068 instalou este trigger para consolidar aliases brasileiros.
-- Propaga também os novos estados quando uma escrita legada encontra o card
-- canônico, sem reatribuir conversas entre números/canais.
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
         agent_status = case
           when coalesce(c.needs_human, false) or coalesce(new.needs_human, false)
             then 'needs_human'
           when new.last_agent_action_at is not null
             and coalesce(new.last_agent_action_at, '-infinity'::timestamptz)
               >= coalesce(c.last_agent_action_at, '-infinity'::timestamptz)
             then coalesce(new.agent_status, c.agent_status)
           else c.agent_status
         end,
         handoff_reason = coalesce(new.handoff_reason, c.handoff_reason),
         handoff_requested_at = greatest(c.handoff_requested_at, new.handoff_requested_at),
         human_assumed_at = greatest(c.human_assumed_at, new.human_assumed_at),
         last_agent_action_at = greatest(c.last_agent_action_at, new.last_agent_action_at),
         archived = coalesce(new.archived, c.archived),
         updated_at = greatest(c.updated_at, new.updated_at, now())
   where c.id = existing_id;

  return null;
end;
$$;

commit;

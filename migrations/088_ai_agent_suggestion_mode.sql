-- 088 — Modo de sugestões por conversa: a IA redige, mas uma pessoa decide e envia.
-- O estado continua no mesmo histórico operacional do atendimento.
begin;

alter table public.wa_conversations
  drop constraint if exists wa_conversations_agent_status_check;

alter table public.wa_conversations
  add constraint wa_conversations_agent_status_check
  check (agent_status in (
    'idle', 'lia_active', 'quote_sent', 'needs_human', 'human_active', 'suggestions'
  ));

commit;

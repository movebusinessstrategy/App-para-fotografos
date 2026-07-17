-- 063 — activity_log: "quem fez o quê" nas ações de negócio.
--
-- Por que existe: já há um gatilho de auditoria no banco (audit_logs) que grava
-- INSERT/UPDATE/DELETE com o dado antes/depois. Ele responde O QUÊ e QUANDO, mas
-- grava o user_id da CONTA — nunca o membro da equipe que clicou. Então não dava
-- pra saber quem criou o ensaio duplicado, quem cancelou a venda, etc.
--
-- Esta tabela é gravada pelo SERVIDOR (que conhece o membro logado via
-- realUserId) nas ações que mexem em venda/ensaio. Complementa o audit_logs,
-- não substitui.

create table if not exists public.activity_log (
  id            bigserial primary key,
  user_id       uuid not null,          -- conta (dono) — chave de isolamento
  actor_user_id uuid,                   -- quem REALMENTE fez (login do membro ou do dono)
  action        text not null,          -- convert | job_delete | cancel_sale | deal_delete
  entity_type   text not null,          -- job | deal
  entity_id     text not null,
  summary       text not null,          -- frase pronta pra tela
  details       jsonb,
  created_at    timestamptz not null default now()
);

-- Busca do histórico de um ensaio/venda específico (é o acesso principal).
create index if not exists activity_log_entity_idx
  on public.activity_log (user_id, entity_type, entity_id, created_at desc);

-- Varredura por conta (auditoria geral / futura tela de atividade).
create index if not exists activity_log_user_idx
  on public.activity_log (user_id, created_at desc);

alter table public.activity_log enable row level security;

-- Só o dono enxerga a atividade da própria conta. O servidor escreve com a
-- service role (bypassa RLS), então não há policy de INSERT de propósito.
drop policy if exists activity_log_select_own on public.activity_log;
create policy activity_log_select_own on public.activity_log
  for select using (auth.uid() = user_id);

-- 070 — Laboratório de aprendizado supervisionado da Lia.
--
-- Casos são anonimizados e isolados por conta + número de WhatsApp. Simulações
-- nunca enviam mensagens. Uma lição só passa a influenciar o agente depois de
-- aprovação humana explícita e pode ser pausada ou reativada a qualquer momento.

begin;

create table if not exists public.ai_agent_learning_cases (
  user_id uuid not null,
  wa_number text not null,
  id text not null,
  category text not null default 'geral',
  messages jsonb not null default '[]'::jsonb,
  expected_action jsonb not null default '{}'::jsonb,
  source jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'corrected', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, wa_number, id),
  check (jsonb_typeof(messages) = 'array'),
  check (jsonb_array_length(messages) between 1 and 20),
  check (jsonb_typeof(expected_action) = 'object')
);

create table if not exists public.ai_agent_learning_simulations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  wa_number text not null,
  case_id text,
  source_type text not null default 'lab_case'
    check (source_type in ('lab_case', 'playground')),
  source_ref text,
  reply text not null default '',
  actual_action jsonb not null default '{}'::jsonb,
  evaluation jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (id, user_id, wa_number),
  foreign key (user_id, wa_number, case_id)
    references public.ai_agent_learning_cases (user_id, wa_number, id)
    on delete cascade,
  check (case_id is not null or source_type = 'playground'),
  check (jsonb_typeof(actual_action) = 'object'),
  check (jsonb_typeof(evaluation) = 'object')
);

create table if not exists public.ai_agent_learning_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  wa_number text not null,
  case_id text,
  simulation_id uuid,
  source_type text not null default 'lab_case'
    check (source_type in ('lab_case', 'playground')),
  source_ref text,
  decision text not null check (decision in ('approve', 'correct', 'reject')),
  category text not null default 'geral',
  context_excerpt text,
  assistant_result text,
  corrected_reply text,
  lesson text,
  approve_rule boolean not null default false,
  example_reply text,
  created_at timestamptz not null default now(),
  unique (id, user_id, wa_number),
  foreign key (user_id, wa_number, case_id)
    references public.ai_agent_learning_cases (user_id, wa_number, id)
    on delete cascade,
  foreign key (simulation_id, user_id, wa_number)
    references public.ai_agent_learning_simulations (id, user_id, wa_number)
    on delete restrict,
  check (case_id is not null or source_type = 'playground'),
  check (not approve_rule or nullif(btrim(lesson), '') is not null)
);

create table if not exists public.ai_agent_learning_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  wa_number text not null,
  source_feedback_id uuid,
  rule_text text not null check (char_length(btrim(rule_text)) between 1 and 600),
  category text not null default 'geral',
  active boolean not null default true,
  approval_count integer not null default 1 check (approval_count > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (source_feedback_id, user_id, wa_number)
    references public.ai_agent_learning_feedback (id, user_id, wa_number)
    on delete restrict
);

create index if not exists ai_learning_cases_status_idx
  on public.ai_agent_learning_cases (user_id, wa_number, status, updated_at desc);
create index if not exists ai_learning_simulations_case_idx
  on public.ai_agent_learning_simulations (user_id, wa_number, case_id, created_at desc);
create index if not exists ai_learning_feedback_case_idx
  on public.ai_agent_learning_feedback (user_id, wa_number, case_id, created_at desc);
create index if not exists ai_learning_rules_active_idx
  on public.ai_agent_learning_rules (user_id, wa_number, active, updated_at desc);

alter table public.ai_agent_learning_cases enable row level security;
alter table public.ai_agent_learning_simulations enable row level security;
alter table public.ai_agent_learning_feedback enable row level security;
alter table public.ai_agent_learning_rules enable row level security;

drop policy if exists ai_learning_cases_own on public.ai_agent_learning_cases;
create policy ai_learning_cases_own on public.ai_agent_learning_cases
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists ai_learning_simulations_own on public.ai_agent_learning_simulations;
create policy ai_learning_simulations_own on public.ai_agent_learning_simulations
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists ai_learning_feedback_own on public.ai_agent_learning_feedback;
create policy ai_learning_feedback_own on public.ai_agent_learning_feedback
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists ai_learning_rules_own on public.ai_agent_learning_rules;
create policy ai_learning_rules_own on public.ai_agent_learning_rules
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

commit;

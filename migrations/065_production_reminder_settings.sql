-- 065 — mensagem padrão do lembrete enviado manualmente pela Produção.
-- O número usado para testes não é persistido; somente o texto configurado.

create table if not exists public.production_reminder_settings (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  message    text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.production_reminder_settings enable row level security;

drop policy if exists production_reminder_settings_select_own on public.production_reminder_settings;
create policy production_reminder_settings_select_own on public.production_reminder_settings
  for select using (auth.uid() = user_id);

drop policy if exists production_reminder_settings_insert_own on public.production_reminder_settings;
create policy production_reminder_settings_insert_own on public.production_reminder_settings
  for insert with check (auth.uid() = user_id);

drop policy if exists production_reminder_settings_update_own on public.production_reminder_settings;
create policy production_reminder_settings_update_own on public.production_reminder_settings
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============================================================================
-- Vendedor responsável por lead da pipeline
--
-- Rode no SQL Editor do Supabase. Idempotente.
-- ============================================================================

-- 1) Coluna assigned_to: FK pra team_members, opcional
alter table deals
  add column if not exists assigned_to uuid references team_members(id) on delete set null;

create index if not exists deals_assigned_to_idx on deals(assigned_to);

-- 2) Backfill: deals existentes ficam sem responsável (NULL).
--    Se quiser atribuir tudo ao dono, descomente:
-- update deals d
--    set assigned_to = (
--      select tm.id from team_members tm
--       where tm.owner_user_id = d.user_id and tm.role = 'owner'
--       limit 1
--    )
--  where d.assigned_to is null;

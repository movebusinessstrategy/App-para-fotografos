-- ============================================================
-- TAREFAS
-- Execute no Supabase SQL Editor (Dashboard > SQL Editor)
-- Idempotente: pode rodar de novo sem quebrar.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS tasks (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      TEXT NOT NULL,
  title        TEXT NOT NULL,
  description  TEXT,
  assignee_id  UUID,
  job_id       INTEGER,
  stage_id     TEXT,
  due_date     TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Se a tabela já existia de uma versão antiga, CREATE TABLE IF NOT EXISTS
-- não adiciona colunas novas. Estes ALTERs completam o schema sem apagar dados.
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS user_id TEXT,
  ADD COLUMN IF NOT EXISTS title TEXT,
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS assignee_id UUID,
  ADD COLUMN IF NOT EXISTS job_id INTEGER,
  ADD COLUMN IF NOT EXISTS stage_id TEXT,
  ADD COLUMN IF NOT EXISTS due_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

UPDATE tasks SET created_at = now() WHERE created_at IS NULL;
UPDATE tasks SET updated_at = now() WHERE updated_at IS NULL;
UPDATE tasks SET due_date = COALESCE(created_at, now()) WHERE due_date IS NULL;

ALTER TABLE tasks
  ALTER COLUMN user_id SET NOT NULL,
  ALTER COLUMN title SET NOT NULL,
  ALTER COLUMN due_date SET NOT NULL,
  ALTER COLUMN created_at SET NOT NULL,
  ALTER COLUMN updated_at SET NOT NULL;

CREATE INDEX IF NOT EXISTS tasks_user_id_idx ON tasks(user_id);
CREATE INDEX IF NOT EXISTS tasks_due_date_idx ON tasks(due_date);
CREATE INDEX IF NOT EXISTS tasks_assignee_id_idx ON tasks(assignee_id);
CREATE INDEX IF NOT EXISTS tasks_job_id_idx ON tasks(job_id);
CREATE INDEX IF NOT EXISTS tasks_stage_id_idx ON tasks(stage_id);
CREATE INDEX IF NOT EXISTS tasks_open_due_date_idx
  ON tasks(user_id, due_date)
  WHERE completed_at IS NULL;

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tasks_user_select" ON tasks;
CREATE POLICY "tasks_user_select"
  ON tasks
  FOR SELECT
  USING (user_id = auth.uid()::text);

DROP POLICY IF EXISTS "tasks_user_insert" ON tasks;
CREATE POLICY "tasks_user_insert"
  ON tasks
  FOR INSERT
  WITH CHECK (user_id = auth.uid()::text);

DROP POLICY IF EXISTS "tasks_user_update" ON tasks;
CREATE POLICY "tasks_user_update"
  ON tasks
  FOR UPDATE
  USING (user_id = auth.uid()::text)
  WITH CHECK (user_id = auth.uid()::text);

DROP POLICY IF EXISTS "tasks_user_delete" ON tasks;
CREATE POLICY "tasks_user_delete"
  ON tasks
  FOR DELETE
  USING (user_id = auth.uid()::text);

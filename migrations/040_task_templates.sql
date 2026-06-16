-- 040_task_templates.sql — Padrões de tarefas (playbooks estilo ClickUp)
-- Rode no SQL Editor do Supabase. Idempotente (pode rodar mais de uma vez).
--
-- Estrutura: Padrão (task_templates) → Blocos/etapas (task_template_blocks)
-- → Tarefas e subtarefas (task_template_items, parent_id aponta a tarefa-mãe).
-- Ao "Aplicar padrão" numa venda, geramos linhas na tabela `tasks` (estendida).

-- 1) O PADRÃO (playbook). Ex.: "Ensaio Assinante".
CREATE TABLE IF NOT EXISTS task_templates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     TEXT NOT NULL,
  name        TEXT NOT NULL,
  description TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_task_templates_user ON task_templates(user_id);

-- 2) OS BLOCOS (etapas) de cada padrão. Cada bloco tem um título e uma
--    "observação" (a estrelinha ⭐ do seu fluxo).
CREATE TABLE IF NOT EXISTS task_template_blocks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL REFERENCES task_templates(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  note        TEXT,                       -- observação do bloco
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ttb_template ON task_template_blocks(template_id);

-- 3) TAREFAS e SUBTAREFAS do padrão. parent_id = tarefa-mãe (NULL = tarefa de
--    topo no bloco). Cada item pode ter responsável sugerido e prazo relativo.
CREATE TABLE IF NOT EXISTS task_template_items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id         UUID NOT NULL REFERENCES task_templates(id) ON DELETE CASCADE,
  block_id            UUID NOT NULL REFERENCES task_template_blocks(id) ON DELETE CASCADE,
  parent_id           UUID REFERENCES task_template_items(id) ON DELETE CASCADE,
  title               TEXT NOT NULL,
  description         TEXT,
  position            INTEGER NOT NULL DEFAULT 0,
  default_assignee_id UUID,                -- membro da equipe sugerido (team_members.id)
  due_offset_days     INTEGER,             -- prazo relativo: -2 = 2 dias antes; +5 = 5 dias depois; NULL = sem prazo
  due_offset_ref      TEXT DEFAULT 'ensaio', -- referência do prazo: 'ensaio' (data do ensaio) ou 'aplicacao' (dia que aplicou)
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tti_template ON task_template_items(template_id);
CREATE INDEX IF NOT EXISTS idx_tti_block    ON task_template_items(block_id);
CREATE INDEX IF NOT EXISTS idx_tti_parent   ON task_template_items(parent_id);

-- 4) EXTENSÕES na tabela `tasks`: hierarquia (bloco + subtarefa), ordem,
--    origem (qual padrão), e PRAZO AGORA OPCIONAL.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS block          TEXT;     -- nome da etapa/bloco
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS block_position INTEGER;  -- ordem do bloco
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS parent_task_id UUID REFERENCES tasks(id) ON DELETE CASCADE;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS position       INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS template_id    UUID;     -- qual padrão originou
ALTER TABLE tasks ALTER COLUMN due_date DROP NOT NULL;              -- prazo passa a ser opcional

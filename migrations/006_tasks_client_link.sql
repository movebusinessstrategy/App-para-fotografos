-- Vincula tarefa a um cliente diretamente — abre o caminho pra mostrar
-- tarefas pendentes no chat do WhatsApp quando o lead/cliente abrir.
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS client_id BIGINT REFERENCES clients(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_client_id ON tasks(client_id);

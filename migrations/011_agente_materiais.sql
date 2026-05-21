-- Materiais (PDFs) do agente de IA: pacotes e dicas por nicho de ensaio.
-- Os arquivos ficam no Supabase Storage (bucket privado 'agente-materiais',
-- criado pelo servidor); esta tabela guarda só os metadados.
-- Uma linha por (conta, nicho, tipo) — UNIQUE permite "substituir" via upsert.
-- Execute no Supabase SQL Editor (Dashboard > SQL Editor). Idempotente.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS agente_materiais (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       TEXT NOT NULL,
  nicho         TEXT NOT NULL,
  tipo          TEXT NOT NULL,            -- 'pacote' ou 'dicas'
  nome_arquivo  TEXT NOT NULL,
  path          TEXT NOT NULL,            -- caminho do arquivo no Storage
  tamanho       BIGINT,                   -- tamanho em bytes
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, nicho, tipo)
);

CREATE INDEX IF NOT EXISTS idx_agente_materiais_user ON agente_materiais(user_id);

ALTER TABLE agente_materiais ENABLE ROW LEVEL SECURITY;

-- Dono acessa os próprios materiais via JWT; membros passam pelo backend
-- com a service role key (que ignora RLS). O Storage é acessado só pelo
-- servidor (service role) — por isso não precisa de policy em storage.objects.
DROP POLICY IF EXISTS "agente_materiais_user_all" ON agente_materiais;
CREATE POLICY "agente_materiais_user_all"
  ON agente_materiais
  FOR ALL
  USING (user_id = auth.uid()::text)
  WITH CHECK (user_id = auth.uid()::text);

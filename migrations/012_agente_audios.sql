-- Áudios prontos do agente (respostas em nota de voz).
-- Os arquivos ficam no Supabase Storage (bucket privado 'agente-audios',
-- criado pelo servidor); esta tabela guarda só os metadados.
-- Execute no Supabase SQL Editor (Dashboard > SQL Editor). Idempotente.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS agente_audios (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     TEXT NOT NULL,
  titulo      TEXT NOT NULL,
  path        TEXT NOT NULL,            -- caminho do arquivo no Storage
  duracao     INTEGER,                  -- duração em segundos
  tamanho     BIGINT,                   -- tamanho em bytes
  mimetype    TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agente_audios_user ON agente_audios(user_id);

ALTER TABLE agente_audios ENABLE ROW LEVEL SECURITY;

-- Dono acessa os próprios áudios via JWT; membros passam pelo backend
-- com a service role key. O Storage é acessado só pelo servidor.
DROP POLICY IF EXISTS "agente_audios_user_all" ON agente_audios;
CREATE POLICY "agente_audios_user_all"
  ON agente_audios
  FOR ALL
  USING (user_id = auth.uid()::text)
  WITH CHECK (user_id = auth.uid()::text);

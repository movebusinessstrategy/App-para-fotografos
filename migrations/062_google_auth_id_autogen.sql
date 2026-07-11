-- 062: google_auth.id precisa AUTO-GERAR
--
-- Sintoma: reconectar o Google numa conta que tinha sido desconectada falhava
-- com "Erro ao salvar credenciais Google." (o INSERT do callback era recusado).
--
-- Causa: a coluna `id` (PK) ficou SEM default (provável perda do identity/serial
-- num restore/recriação da tabela). O callback grava sem informar `id`, então o
-- banco recusa por NOT NULL na PK. Contas com linha antiga (ex.: a que nunca
-- desconectou) seguiam sincronizando porque o caminho vira UPDATE, que não
-- precisa de id novo — por isso "só uma conta funcionava".
--
-- Fix: cria uma sequência, aponta ela pro próximo id livre e amarra como default
-- da coluna. Idempotente e seguro — não mexe nas linhas existentes.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relkind = 'S' AND relname = 'google_auth_id_seq') THEN
    CREATE SEQUENCE google_auth_id_seq OWNED BY google_auth.id;
  END IF;
END $$;

-- Próximo id = maior id atual + 1 (evita colisão com linhas já gravadas)
SELECT setval('google_auth_id_seq', COALESCE((SELECT MAX(id) FROM google_auth), 0) + 1, false);

-- A partir daqui todo INSERT sem id ganha um id automático
ALTER TABLE google_auth ALTER COLUMN id SET DEFAULT nextval('google_auth_id_seq');

-- migrations/058_alignment_dossiers.sql
-- Dossiê de alinhamento: ao marcar GANHO, a IA analisa a conversa do WhatsApp
-- e monta um resumo do que a cliente quer (falas de referência, preferências,
-- combinados, fotos de referência que ela mandou). A equipe de alinhamento/
-- pós-venda usa o dossiê (e o PDF) no card da produção — sem realinhar tudo.
-- content = JSON da análise; as fotos ficam referenciadas por message_id de
-- wa_messages (o PDF busca a mídia na hora, não duplica bytes aqui).
-- Execute no Supabase SQL Editor. Idempotente.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS alignment_dossiers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     TEXT NOT NULL,
  deal_id     BIGINT NOT NULL,
  job_id      BIGINT,                          -- ensaio criado na conversão (se houver)
  client_name TEXT,
  phone       TEXT,
  content     JSONB NOT NULL DEFAULT '{}'::jsonb,
  status      TEXT NOT NULL DEFAULT 'ready',   -- generating | ready | error
  error       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, deal_id)
);

CREATE INDEX IF NOT EXISTS idx_dossiers_user_job ON alignment_dossiers(user_id, job_id);

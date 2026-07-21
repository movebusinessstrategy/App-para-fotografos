-- Rode no SQL Editor do Supabase. Idempotente. Aditivo (não quebra nada existente).
--
-- Migration 044 — NFS-e Nacional (emissão direta na API do contribuinte, SEFIN/ADN).
-- O certificado A1 (.pfx + senha) fica CIFRADO (AES-256-GCM) em certificado_blob;
-- a master key vive só na env FISCAL_CERT_MASTER_KEY do servidor. Nunca em claro.

-- ── fiscal_config: campos do provider "nacional" ─────────────────────────────
ALTER TABLE fiscal_config
  ADD COLUMN IF NOT EXISTS certificado_blob    text,                    -- envelope AES-GCM (iv+tag+dados) base64
  ADD COLUMN IF NOT EXISTS certificado_titular text,                    -- CN do certificado (exibição)
  ADD COLUMN IF NOT EXISTS dps_serie           text    DEFAULT '00010', -- série dedicada do app (não colide com outros emissores)
  ADD COLUMN IF NOT EXISTS dps_proximo_numero  bigint  DEFAULT 1,       -- contador sequencial (reserva atômica via função abaixo)
  ADD COLUMN IF NOT EXISTS ctrib_nac           text    DEFAULT '130301',    -- cód. tributação nacional (fotografia)
  ADD COLUMN IF NOT EXISTS cnbs                text    DEFAULT '114082000', -- cód. NBS (fotografia)
  ADD COLUMN IF NOT EXISTS ptottrib_sn         numeric DEFAULT 2.00,    -- % total de tributos SN (ME/EPP, informativo na nota)
  ADD COLUMN IF NOT EXISTS emit_stage_pos      integer DEFAULT 2,       -- fallback: a partir de qual etapa (posição, 1=primeira)
  ADD COLUMN IF NOT EXISTS emit_stage_id       text;                    -- etapa escolhida (deal_stages.id 'prod-...'); tem prioridade sobre a posição

-- ── fiscal_invoices: campos da nota nacional ─────────────────────────────────
ALTER TABLE fiscal_invoices
  ADD COLUMN IF NOT EXISTS chave_acesso text,   -- chave oficial (50 dígitos)
  ADD COLUMN IF NOT EXISTS dps_id       text,
  ADD COLUMN IF NOT EXISTS dps_serie    text,
  ADD COLUMN IF NOT EXISTS dps_numero   bigint,
  ADD COLUMN IF NOT EXISTS ambiente     text,   -- 'sandbox' (homologação) | 'production'
  ADD COLUMN IF NOT EXISTS xml_nfse     text;   -- XML autorizado (documento com validade fiscal)

CREATE INDEX IF NOT EXISTS idx_fiscal_invoices_chave ON fiscal_invoices (chave_acesso);

-- Evita duas notas autorizadas pro MESMO ensaio no MESMO ambiente (idempotência).
CREATE UNIQUE INDEX IF NOT EXISTS uq_fiscal_invoices_job_ok
  ON fiscal_invoices (user_id, job_id, ambiente)
  WHERE job_id IS NOT NULL AND status IN ('autorizada', 'processando');

-- ── Reserva ATÔMICA do número da DPS (nunca calcular no app) ─────────────────
CREATE OR REPLACE FUNCTION fiscal_reservar_dps(p_user uuid)
RETURNS TABLE (numero bigint, serie text)
LANGUAGE sql AS $$
  UPDATE fiscal_config
     SET dps_proximo_numero = COALESCE(dps_proximo_numero, 1) + 1,
         updated_at = now()
   WHERE user_id = p_user
  RETURNING COALESCE(dps_proximo_numero, 2) - 1 AS numero, COALESCE(dps_serie, '00010') AS serie;
$$;

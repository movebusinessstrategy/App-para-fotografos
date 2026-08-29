BEGIN;

-- 074 — Ponte de mensuração first-party, isolada por tenant.
--
-- Esta migração evolui a 066 sem reescrever o histórico. Ela separa quatro
-- fatos de negócio que não podem ser inferidos por clique no site:
--   Contact  = primeira mensagem real confirmada;
--   Lead     = entrada em uma etapa explicitamente mapeada;
--   Schedule = trabalho efetivamente marcado como scheduled;
--   Purchase = negócio convertido.
--
-- Segredos e destinos pertencem sempre a uma integração/site do tenant. A
-- outbox congela tudo que será enviado e nunca depende de variáveis globais.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.marketing_sites (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                   uuid NOT NULL,
  name                      text NOT NULL,
  site_key_id               text NOT NULL,
  signing_secret_ciphertext text NOT NULL,
  allowed_origins           text[] NOT NULL DEFAULT '{}'::text[],
  enabled                   boolean NOT NULL DEFAULT false,
  measurement_enabled       boolean NOT NULL DEFAULT false,
  key_version               integer NOT NULL DEFAULT 1,
  last_rotated_at           timestamptz,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marketing_sites_name_check
    CHECK (nullif(btrim(name), '') IS NOT NULL),
  CONSTRAINT marketing_sites_key_check
    CHECK (nullif(btrim(site_key_id), '') IS NOT NULL),
  CONSTRAINT marketing_sites_secret_check
    CHECK (signing_secret_ciphertext ~ '^enc:v1:[^:]+:[^:]+:[^:]+$'),
  CONSTRAINT marketing_sites_origins_check
    CHECK (cardinality(allowed_origins) > 0),
  CONSTRAINT marketing_sites_key_version_check
    CHECK (key_version > 0),
  CONSTRAINT marketing_sites_measurement_gate_check
    CHECK (
      NOT measurement_enabled
      OR enabled
    ),
  CONSTRAINT marketing_sites_key_unique UNIQUE (site_key_id)
);

ALTER TABLE public.marketing_sites
  ADD COLUMN IF NOT EXISTS measurement_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE public.marketing_sites
  DROP CONSTRAINT IF EXISTS marketing_sites_measurement_gate_check;

ALTER TABLE public.marketing_sites
  ADD CONSTRAINT marketing_sites_measurement_gate_check
  CHECK (
    NOT measurement_enabled
    OR enabled
  );

CREATE INDEX IF NOT EXISTS marketing_sites_tenant_idx
  ON public.marketing_sites (user_id, enabled, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS marketing_sites_id_tenant_unique
  ON public.marketing_sites (id, user_id);

CREATE TABLE IF NOT EXISTS public.marketing_acquisition_channels (
  id                  bigserial PRIMARY KEY,
  user_id             uuid NOT NULL,
  marketing_site_id   uuid NOT NULL,
  channel             text NOT NULL DEFAULT 'whatsapp',
  external_account_id text NOT NULL,
  enabled             boolean NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marketing_acquisition_channel_check
    CHECK (channel = 'whatsapp'),
  CONSTRAINT marketing_acquisition_external_id_check
    CHECK (external_account_id ~ '^55[1-9][0-9]{9,10}$'),
  CONSTRAINT marketing_acquisition_channel_tenant_unique
    UNIQUE (user_id, channel, external_account_id),
  CONSTRAINT marketing_acquisition_site_tenant_fk
    FOREIGN KEY (marketing_site_id, user_id)
    REFERENCES public.marketing_sites (id, user_id)
    ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS marketing_acquisition_active_number_unique
  ON public.marketing_acquisition_channels (channel, external_account_id)
  WHERE enabled;

CREATE INDEX IF NOT EXISTS marketing_acquisition_site_idx
  ON public.marketing_acquisition_channels (user_id, marketing_site_id, enabled);

CREATE TABLE IF NOT EXISTS public.marketing_bridge_nonces (
  id                bigserial PRIMARY KEY,
  user_id           uuid NOT NULL,
  marketing_site_id uuid NOT NULL REFERENCES public.marketing_sites(id) ON DELETE CASCADE,
  nonce_hash        text NOT NULL,
  request_hash      text NOT NULL,
  origin            text NOT NULL,
  expires_at        timestamptz NOT NULL,
  consumed_at       timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marketing_bridge_nonces_hash_check
    CHECK (nonce_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT marketing_bridge_request_hash_check
    CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT marketing_bridge_origin_check
    CHECK (nullif(btrim(origin), '') IS NOT NULL),
  CONSTRAINT marketing_bridge_nonce_unique
    UNIQUE (marketing_site_id, nonce_hash)
);

CREATE INDEX IF NOT EXISTS marketing_bridge_nonces_expiry_idx
  ON public.marketing_bridge_nonces (expires_at);

CREATE INDEX IF NOT EXISTS marketing_bridge_nonces_tenant_idx
  ON public.marketing_bridge_nonces (user_id, marketing_site_id, consumed_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'marketing_bridge_nonces_site_tenant_fk'
      AND conrelid = 'public.marketing_bridge_nonces'::regclass
  ) THEN
    ALTER TABLE public.marketing_bridge_nonces
      ADD CONSTRAINT marketing_bridge_nonces_site_tenant_fk
      FOREIGN KEY (marketing_site_id, user_id)
      REFERENCES public.marketing_sites (id, user_id)
      ON DELETE CASCADE;
  END IF;
END;
$$;

ALTER TABLE public.marketing_touchpoints
  ADD COLUMN IF NOT EXISTS marketing_site_id uuid REFERENCES public.marketing_sites(id),
  ADD COLUMN IF NOT EXISTS lead_id uuid,
  ADD COLUMN IF NOT EXISTS bridge_payload_hash text,
  ADD COLUMN IF NOT EXISTS bridge_reference_hash text,
  ADD COLUMN IF NOT EXISTS ga_client_id text,
  ADD COLUMN IF NOT EXISTS ga_session_id text,
  ADD COLUMN IF NOT EXISTS client_user_agent text,
  ADD COLUMN IF NOT EXISTS whatsapp_business_account_id text,
  ADD COLUMN IF NOT EXISTS consent_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS contact_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS event_scope_key text GENERATED ALWAYS AS (
    coalesce(marketing_site_id::text, 'legacy')
    || '|'
    || coalesce(nullif(btrim(wa_number), ''), 'none')
  ) STORED;

ALTER TABLE public.marketing_touchpoints
  DROP CONSTRAINT IF EXISTS marketing_touchpoints_external_event_unique;

DROP INDEX IF EXISTS public.marketing_touchpoints_scope_event_unique;
CREATE UNIQUE INDEX marketing_touchpoints_scope_event_unique
  ON public.marketing_touchpoints (
    user_id,
    event_scope_key,
    channel,
    external_event_id
  );

-- Nenhum touchpoint legado é reclassificado ou preenchido nesta migração.
-- Apenas entradas criadas pela ponte v2 recebem lead_id, consentimento granular
-- e confirmação de contato. Isso preserva todas as outras contas sem inferir
-- fatos históricos nem fabricar identidades.

ALTER TABLE public.marketing_touchpoints
  DROP CONSTRAINT IF EXISTS marketing_touchpoints_bridge_hash_check;

ALTER TABLE public.marketing_touchpoints
  ADD CONSTRAINT marketing_touchpoints_bridge_hash_check
  CHECK (
    (bridge_payload_hash IS NULL OR bridge_payload_hash ~ '^[0-9a-f]{64}$')
    AND (
      bridge_reference_hash IS NULL
      OR bridge_reference_hash ~ '^[0-9a-f]{64}$'
    )
  );

ALTER TABLE public.marketing_touchpoints
  DROP CONSTRAINT IF EXISTS marketing_touchpoints_consent_snapshot_check;

ALTER TABLE public.marketing_touchpoints
  ADD CONSTRAINT marketing_touchpoints_consent_snapshot_check
  CHECK (
    jsonb_typeof(consent_snapshot) = 'object'
    AND coalesce(consent_snapshot ->> 'analytics_storage', 'unknown')
      IN ('unknown', 'granted', 'denied')
    AND coalesce(consent_snapshot ->> 'ad_storage', 'unknown')
      IN ('unknown', 'granted', 'denied')
    AND coalesce(consent_snapshot ->> 'ad_user_data', 'unknown')
      IN ('unknown', 'granted', 'denied')
    AND coalesce(consent_snapshot ->> 'ad_personalization', 'unknown')
      IN ('unknown', 'granted', 'denied')
  );

CREATE INDEX IF NOT EXISTS marketing_touchpoints_lead_idx
  ON public.marketing_touchpoints (user_id, lead_id, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS marketing_touchpoints_site_idx
  ON public.marketing_touchpoints (user_id, marketing_site_id, last_seen_at DESC)
  WHERE marketing_site_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS marketing_touchpoints_id_tenant_unique
  ON public.marketing_touchpoints (id, user_id);

DROP INDEX IF EXISTS public.marketing_touchpoints_bridge_reference_unique;
CREATE UNIQUE INDEX marketing_touchpoints_bridge_reference_unique
  ON public.marketing_touchpoints (user_id, bridge_reference_hash)
  WHERE bridge_reference_hash IS NOT NULL AND channel = 'website';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'marketing_touchpoints_site_tenant_fk'
      AND conrelid = 'public.marketing_touchpoints'::regclass
  ) THEN
    ALTER TABLE public.marketing_touchpoints
      ADD CONSTRAINT marketing_touchpoints_site_tenant_fk
      FOREIGN KEY (marketing_site_id, user_id)
      REFERENCES public.marketing_sites (id, user_id);
  END IF;
END;
$$;

ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS marketing_lead_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS deals_marketing_lead_tenant_unique
  ON public.deals (user_id, marketing_lead_id)
  WHERE marketing_lead_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS deals_id_tenant_unique
  ON public.deals (id, user_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'marketing_touchpoints_deal_tenant_fk'
      AND conrelid = 'public.marketing_touchpoints'::regclass
  ) THEN
    ALTER TABLE public.marketing_touchpoints
      ADD CONSTRAINT marketing_touchpoints_deal_tenant_fk
      FOREIGN KEY (deal_id, user_id)
      REFERENCES public.deals (id, user_id)
      NOT VALID;
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.marketing_stage_event_mappings (
  id          bigserial PRIMARY KEY,
  user_id     uuid NOT NULL,
  stage_id    text NOT NULL,
  event_name  text NOT NULL,
  enabled     boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marketing_stage_event_stage_check
    CHECK (nullif(btrim(stage_id), '') IS NOT NULL),
  CONSTRAINT marketing_stage_event_name_check
    CHECK (event_name IN ('Contact', 'Lead', 'Schedule', 'Purchase')),
  CONSTRAINT marketing_stage_event_unique
    UNIQUE (user_id, stage_id, event_name)
);

CREATE INDEX IF NOT EXISTS marketing_stage_event_enabled_idx
  ON public.marketing_stage_event_mappings (user_id, stage_id, event_name)
  WHERE enabled;

ALTER TABLE public.marketing_integrations
  ADD COLUMN IF NOT EXISTS marketing_site_id uuid,
  ADD COLUMN IF NOT EXISTS event_mappings jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS provider_config jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.marketing_integrations
  DROP CONSTRAINT IF EXISTS marketing_integrations_provider_check,
  DROP CONSTRAINT IF EXISTS marketing_integrations_user_provider_unique,
  DROP CONSTRAINT IF EXISTS marketing_integrations_enabled_destination_check,
  DROP CONSTRAINT IF EXISTS marketing_integrations_secret_ciphertext_check,
  DROP CONSTRAINT IF EXISTS marketing_integrations_event_mappings_check,
  DROP CONSTRAINT IF EXISTS marketing_integrations_provider_config_check;

ALTER TABLE public.marketing_integrations
  ADD CONSTRAINT marketing_integrations_provider_check
    CHECK (provider IN ('meta', 'google', 'ga4')),
  ADD CONSTRAINT marketing_integrations_enabled_destination_check
    CHECK (
      marketing_site_id IS NULL
      OR NOT enabled
      OR nullif(btrim(destination_id), '') IS NOT NULL
    ),
  ADD CONSTRAINT marketing_integrations_secret_ciphertext_check
    CHECK (
      marketing_site_id IS NULL
      OR coalesce(
        credentials_encrypted ~ '^enc:v1:[^:]+:[^:]+:[^:]+$',
        false
      )
    ),
  ADD CONSTRAINT marketing_integrations_event_mappings_check
    CHECK (jsonb_typeof(event_mappings) = 'object'),
  ADD CONSTRAINT marketing_integrations_provider_config_check
    CHECK (jsonb_typeof(provider_config) = 'object');

CREATE UNIQUE INDEX IF NOT EXISTS marketing_integrations_tenant_destination_unique
  ON public.marketing_integrations (user_id, provider, (btrim(destination_id)))
  WHERE nullif(btrim(destination_id), '') IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS marketing_integrations_id_tenant_unique
  ON public.marketing_integrations (id, user_id);

CREATE UNIQUE INDEX IF NOT EXISTS marketing_integrations_site_provider_unique
  ON public.marketing_integrations (user_id, marketing_site_id, provider)
  WHERE marketing_site_id IS NOT NULL AND enabled;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'marketing_integrations_site_tenant_fk'
      AND conrelid = 'public.marketing_integrations'::regclass
  ) THEN
    ALTER TABLE public.marketing_integrations
      ADD CONSTRAINT marketing_integrations_site_tenant_fk
      FOREIGN KEY (marketing_site_id, user_id)
      REFERENCES public.marketing_sites (id, user_id);
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.marketing_destination_ownership (
  id                  bigserial PRIMARY KEY,
  provider            text NOT NULL,
  resource_key        text NOT NULL,
  user_id             uuid NOT NULL,
  marketing_site_id   uuid NOT NULL,
  integration_id      bigint NOT NULL,
  verification_method text NOT NULL,
  verified_at         timestamptz NOT NULL,
  verified_by         uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marketing_destination_owner_provider_check
    CHECK (provider IN ('meta', 'google', 'ga4')),
  CONSTRAINT marketing_destination_owner_resource_check
    CHECK (
      nullif(btrim(resource_key), '') IS NOT NULL
      AND resource_key = lower(btrim(resource_key))
    ),
  CONSTRAINT marketing_destination_owner_method_check
    CHECK (verification_method IN ('api_readback', 'test_event', 'manual_audit')),
  CONSTRAINT marketing_destination_owner_global_unique
    UNIQUE (provider, resource_key),
  CONSTRAINT marketing_destination_owner_integration_fk
    FOREIGN KEY (integration_id, user_id)
    REFERENCES public.marketing_integrations (id, user_id)
    ON DELETE CASCADE,
  CONSTRAINT marketing_destination_owner_site_fk
    FOREIGN KEY (marketing_site_id, user_id)
    REFERENCES public.marketing_sites (id, user_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS marketing_destination_owner_site_idx
  ON public.marketing_destination_ownership (
    user_id, marketing_site_id, integration_id, provider
  );

CREATE TABLE IF NOT EXISTS public.marketing_consent_ledger (
  id                bigserial PRIMARY KEY,
  user_id           uuid NOT NULL,
  marketing_site_id uuid NOT NULL,
  lead_id           uuid NOT NULL,
  consent_type      text NOT NULL,
  status            text NOT NULL,
  occurred_at       timestamptz NOT NULL,
  source            text NOT NULL,
  evidence_hash     text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marketing_consent_type_check
    CHECK (consent_type IN (
      'analytics_storage', 'ad_storage', 'ad_user_data', 'ad_personalization'
    )),
  CONSTRAINT marketing_consent_status_check
    CHECK (status IN ('granted', 'denied')),
  CONSTRAINT marketing_consent_source_check
    CHECK (source IN ('site_bridge', 'server_webhook', 'consent_update')),
  CONSTRAINT marketing_consent_hash_check
    CHECK (evidence_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT marketing_consent_site_fk
    FOREIGN KEY (marketing_site_id, user_id)
    REFERENCES public.marketing_sites (id, user_id)
    ON DELETE CASCADE,
  CONSTRAINT marketing_consent_evidence_unique
    UNIQUE (
      user_id, marketing_site_id, lead_id, consent_type,
      occurred_at, status, evidence_hash
    )
);

CREATE INDEX IF NOT EXISTS marketing_consent_current_idx
  ON public.marketing_consent_ledger (
    user_id, marketing_site_id, lead_id, consent_type, occurred_at DESC, id DESC
  );

CREATE TABLE IF NOT EXISTS public.marketing_conversion_facts (
  id                bigserial PRIMARY KEY,
  user_id           uuid NOT NULL,
  marketing_site_id uuid NOT NULL,
  deal_id           bigint,
  touchpoint_id     bigint NOT NULL,
  lead_id           uuid NOT NULL,
  event_name        text NOT NULL,
  event_id          text NOT NULL,
  occurred_at       timestamptz NOT NULL,
  value             numeric NOT NULL DEFAULT 0,
  currency          text NOT NULL DEFAULT 'BRL',
  consent_snapshot  jsonb NOT NULL,
  user_data         jsonb NOT NULL,
  attribution_data  jsonb NOT NULL,
  event_data        jsonb NOT NULL,
  payload_hash      text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marketing_fact_event_name_check
    CHECK (event_name IN ('Contact', 'Lead', 'Schedule', 'Purchase')),
  CONSTRAINT marketing_fact_currency_check
    CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT marketing_fact_json_check
    CHECK (
      jsonb_typeof(consent_snapshot) = 'object'
      AND jsonb_typeof(user_data) = 'object'
      AND jsonb_typeof(attribution_data) = 'object'
      AND jsonb_typeof(event_data) = 'object'
    ),
  CONSTRAINT marketing_fact_hash_check
    CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT marketing_fact_site_fk
    FOREIGN KEY (marketing_site_id, user_id)
    REFERENCES public.marketing_sites (id, user_id)
    ON DELETE CASCADE,
  CONSTRAINT marketing_fact_touchpoint_tenant_fk
    FOREIGN KEY (touchpoint_id, user_id)
    REFERENCES public.marketing_touchpoints (id, user_id),
  CONSTRAINT marketing_fact_deal_tenant_fk
    FOREIGN KEY (deal_id, user_id)
    REFERENCES public.deals (id, user_id),
  CONSTRAINT marketing_fact_tenant_event_unique
    UNIQUE (user_id, marketing_site_id, event_id)
);

CREATE INDEX IF NOT EXISTS marketing_conversion_facts_replay_idx
  ON public.marketing_conversion_facts (
    user_id, marketing_site_id, occurred_at, id
  );

ALTER TABLE public.marketing_conversion_outbox
  ALTER COLUMN deal_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS integration_id bigint,
  ADD COLUMN IF NOT EXISTS marketing_site_id uuid,
  ADD COLUMN IF NOT EXISTS destination_id text,
  ADD COLUMN IF NOT EXISTS account_id text,
  ADD COLUMN IF NOT EXISTS conversion_action_id text,
  ADD COLUMN IF NOT EXISTS provider_event_name text,
  ADD COLUMN IF NOT EXISTS touchpoint_id bigint,
  ADD COLUMN IF NOT EXISTS lead_id uuid,
  ADD COLUMN IF NOT EXISTS event_source_url text,
  ADD COLUMN IF NOT EXISTS consent_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS user_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS attribution_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS event_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS payload_hash text,
  ADD COLUMN IF NOT EXISTS claim_token uuid,
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz;

-- A fila legada permanece intocada. O worker v2 só reclama tenants da allowlist
-- e exige integração + site exatos; nenhuma linha antiga é reclassificada aqui.

ALTER TABLE public.marketing_conversion_outbox
  DROP CONSTRAINT IF EXISTS marketing_conversion_provider_check,
  DROP CONSTRAINT IF EXISTS marketing_conversion_status_check,
  DROP CONSTRAINT IF EXISTS marketing_conversion_event_unique,
  DROP CONSTRAINT IF EXISTS marketing_conversion_event_name_check,
  DROP CONSTRAINT IF EXISTS marketing_conversion_json_snapshot_check,
  DROP CONSTRAINT IF EXISTS marketing_conversion_payload_hash_check;

ALTER TABLE public.marketing_conversion_outbox
  ADD CONSTRAINT marketing_conversion_provider_check
    CHECK (provider IN ('meta', 'google', 'ga4')),
  ADD CONSTRAINT marketing_conversion_status_check
    CHECK (status IN (
      'pending', 'processing', 'sent', 'retry', 'validation_only',
      'accepted_unverified', 'blocked_config', 'cancelled_consent', 'dead'
    )),
  ADD CONSTRAINT marketing_conversion_event_name_check
    CHECK (event_name IN ('Contact', 'Lead', 'Schedule', 'Purchase')),
  ADD CONSTRAINT marketing_conversion_json_snapshot_check
    CHECK (
      jsonb_typeof(consent_snapshot) = 'object'
      AND jsonb_typeof(user_data) = 'object'
      AND jsonb_typeof(attribution_data) = 'object'
      AND jsonb_typeof(event_data) = 'object'
    ),
  ADD CONSTRAINT marketing_conversion_payload_hash_check
    CHECK (payload_hash IS NULL OR payload_hash ~ '^[0-9a-f]{64}$');

CREATE UNIQUE INDEX IF NOT EXISTS marketing_conversion_integration_event_unique
  ON public.marketing_conversion_outbox (user_id, integration_id, event_id)
  WHERE integration_id IS NOT NULL;

DROP INDEX IF EXISTS public.marketing_conversion_claim_idx;
CREATE INDEX marketing_conversion_claim_idx
  ON public.marketing_conversion_outbox (status, next_attempt_at, claimed_at, created_at)
  WHERE status IN (
    'pending', 'retry', 'processing', 'validation_only', 'accepted_unverified'
  );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'marketing_conversion_integration_tenant_fk'
      AND conrelid = 'public.marketing_conversion_outbox'::regclass
  ) THEN
    ALTER TABLE public.marketing_conversion_outbox
      ADD CONSTRAINT marketing_conversion_integration_tenant_fk
      FOREIGN KEY (integration_id, user_id)
      REFERENCES public.marketing_integrations (id, user_id);
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'marketing_conversion_site_tenant_fk'
      AND conrelid = 'public.marketing_conversion_outbox'::regclass
  ) THEN
    ALTER TABLE public.marketing_conversion_outbox
      ADD CONSTRAINT marketing_conversion_site_tenant_fk
      FOREIGN KEY (marketing_site_id, user_id)
      REFERENCES public.marketing_sites (id, user_id);
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'marketing_conversion_touchpoint_tenant_fk'
      AND conrelid = 'public.marketing_conversion_outbox'::regclass
  ) THEN
    ALTER TABLE public.marketing_conversion_outbox
      ADD CONSTRAINT marketing_conversion_touchpoint_tenant_fk
      FOREIGN KEY (touchpoint_id, user_id)
      REFERENCES public.marketing_touchpoints (id, user_id)
      NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'marketing_conversion_deal_tenant_fk'
      AND conrelid = 'public.marketing_conversion_outbox'::regclass
  ) THEN
    ALTER TABLE public.marketing_conversion_outbox
      ADD CONSTRAINT marketing_conversion_deal_tenant_fk
      FOREIGN KEY (deal_id, user_id)
      REFERENCES public.deals (id, user_id)
      NOT VALID;
  END IF;
END;
$$;

ALTER TABLE public.marketing_sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_acquisition_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_bridge_nonces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_stage_event_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_touchpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_destination_ownership ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_consent_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_conversion_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_conversion_outbox ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS marketing_sites_select_own ON public.marketing_sites;
CREATE POLICY marketing_sites_select_own ON public.marketing_sites
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS marketing_acquisition_channels_select_own
  ON public.marketing_acquisition_channels;
CREATE POLICY marketing_acquisition_channels_select_own
  ON public.marketing_acquisition_channels
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS marketing_bridge_nonces_select_own ON public.marketing_bridge_nonces;
CREATE POLICY marketing_bridge_nonces_select_own ON public.marketing_bridge_nonces
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS marketing_stage_event_mappings_select_own ON public.marketing_stage_event_mappings;
CREATE POLICY marketing_stage_event_mappings_select_own ON public.marketing_stage_event_mappings
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS marketing_touchpoints_select_own ON public.marketing_touchpoints;
CREATE POLICY marketing_touchpoints_select_own ON public.marketing_touchpoints
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS marketing_integrations_select_own ON public.marketing_integrations;
CREATE POLICY marketing_integrations_select_own ON public.marketing_integrations
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS marketing_destination_ownership_select_own
  ON public.marketing_destination_ownership;
CREATE POLICY marketing_destination_ownership_select_own
  ON public.marketing_destination_ownership
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS marketing_consent_ledger_select_own
  ON public.marketing_consent_ledger;
CREATE POLICY marketing_consent_ledger_select_own
  ON public.marketing_consent_ledger
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS marketing_conversion_facts_select_own
  ON public.marketing_conversion_facts;
CREATE POLICY marketing_conversion_facts_select_own
  ON public.marketing_conversion_facts
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS marketing_conversion_outbox_select_own ON public.marketing_conversion_outbox;
CREATE POLICY marketing_conversion_outbox_select_own ON public.marketing_conversion_outbox
  FOR SELECT USING (auth.uid() = user_id);

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.marketing_sites FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.marketing_acquisition_channels
  FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.marketing_bridge_nonces FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.marketing_stage_event_mappings FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.marketing_touchpoints FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.marketing_integrations FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.marketing_destination_ownership
  FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.marketing_consent_ledger
  FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.marketing_conversion_facts
  FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.marketing_conversion_outbox FROM anon, authenticated;

REVOKE SELECT ON public.marketing_sites FROM anon, authenticated;
GRANT SELECT (
  id, user_id, name, site_key_id, allowed_origins, enabled,
  measurement_enabled, key_version, last_rotated_at, created_at, updated_at
) ON public.marketing_sites TO authenticated;

REVOKE SELECT ON public.marketing_bridge_nonces FROM anon, authenticated;

REVOKE SELECT ON public.marketing_integrations FROM anon, authenticated;
GRANT SELECT (
  id, user_id, marketing_site_id, provider, enabled, account_id,
  destination_id, conversion_action_id, last_tested_at, last_error,
  event_mappings, provider_config, created_at, updated_at
) ON public.marketing_integrations TO authenticated;

CREATE OR REPLACE FUNCTION public.marketing_json_hash(payload jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = pg_catalog, public, extensions
AS $$
  SELECT encode(digest(convert_to(payload::text, 'UTF8'), 'sha256'), 'hex');
$$;

CREATE OR REPLACE FUNCTION public.marketing_identity_hash(raw_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = pg_catalog, public, extensions
AS $$
  SELECT encode(
    digest(convert_to(lower(btrim(raw_value)), 'UTF8'), 'sha256'),
    'hex'
  );
$$;

DROP FUNCTION IF EXISTS public.marketing_outbox_payload_hash(
  uuid, bigint, uuid, text, text, text, jsonb, jsonb, jsonb, jsonb
);

CREATE OR REPLACE FUNCTION public.marketing_outbox_payload_hash(
  p_user_id uuid,
  p_integration_id bigint,
  p_marketing_site_id uuid,
  p_provider text,
  p_destination_id text,
  p_account_id text,
  p_conversion_action_id text,
  p_provider_event_name text,
  p_event_id text,
  p_consent jsonb,
  p_user_data jsonb,
  p_attribution jsonb,
  p_event_data jsonb
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
  SELECT public.marketing_json_hash(jsonb_build_object(
    'user_id', p_user_id,
    'integration_id', p_integration_id,
    'marketing_site_id', p_marketing_site_id,
    'provider', p_provider,
    'destination_id', p_destination_id,
    'account_id', p_account_id,
    'conversion_action_id', p_conversion_action_id,
    'provider_event_name', p_provider_event_name,
    'event_id', p_event_id,
    'consent', p_consent,
    'user_data', p_user_data,
    'attribution', p_attribution,
    'event_data', p_event_data
  ));
$$;

CREATE OR REPLACE FUNCTION public.marketing_sanitized_source_url(raw_url text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
  SELECT nullif(
    left(regexp_replace(btrim(coalesce(raw_url, '')), '[?#].*$', ''), 2000),
    ''
  );
$$;

CREATE OR REPLACE FUNCTION public.marketing_conversion_action_id(
  p_provider text,
  p_event_mappings jsonb,
  p_event_name text,
  p_fallback text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
  SELECT CASE
    WHEN p_provider = 'google'
    THEN p_event_mappings -> p_event_name ->> 'conversion_action_id'
    ELSE p_fallback
  END;
$$;

CREATE OR REPLACE FUNCTION public.marketing_provider_event_name(
  p_provider text,
  p_event_mappings jsonb,
  p_event_name text,
  p_has_ctwa boolean
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
  SELECT CASE
    WHEN p_provider = 'meta' AND p_has_ctwa THEN coalesce(
      p_event_mappings -> p_event_name ->> 'event_name',
      p_event_mappings ->> p_event_name
    )
    ELSE coalesce(
      p_event_mappings -> p_event_name ->> 'event_name',
      p_event_mappings ->> p_event_name,
      p_event_name
    )
  END;
$$;

CREATE OR REPLACE FUNCTION public.marketing_provider_event_is_fresh(
  p_provider text,
  p_occurred_at timestamptz
)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT coalesce(CASE p_provider
    WHEN 'meta' THEN p_occurred_at >= now() - interval '7 days'
    WHEN 'google' THEN p_occurred_at >= now() - interval '90 days'
    WHEN 'ga4' THEN p_occurred_at >= now() - interval '72 hours'
    ELSE false
  END, false);
$$;

CREATE OR REPLACE FUNCTION public.marketing_dead_error_is_transient(
  p_last_error text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
  SELECT coalesce(
    p_last_error IN (
      'PROVIDER_NETWORK_ERROR',
      'PROVIDER_REQUEST_TIMEOUT',
      'MARKETING_DISPATCH_ERROR',
      'GOOGLE_REQUEST_ID_MISSING'
    )
    OR p_last_error ~ '^PROVIDER_HTTP_(408|425|429|5[0-9]{2})$',
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.marketing_outbox_status_requires_delivery(
  p_status text,
  p_provider text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
  SELECT coalesce(
    p_status IN ('pending', 'retry', 'processing', 'validation_only'),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.marketing_brazil_e164(raw_phone text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
  WITH normalized AS (
    SELECT regexp_replace(coalesce(raw_phone, ''), '\D', '', 'g') AS digits
  )
  SELECT CASE
    WHEN digits ~ '^55[1-9][0-9]{9,10}$' THEN digits
    WHEN digits ~ '^[1-9][0-9]{9,10}$' THEN '55' || digits
    ELSE NULL
  END
  FROM normalized;
$$;

CREATE OR REPLACE FUNCTION public.marketing_latest_consent_status(
  p_user_id uuid,
  p_marketing_site_id uuid,
  p_lead_id uuid,
  p_consent_type text
)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT ledger.status
  FROM public.marketing_consent_ledger AS ledger
  WHERE ledger.user_id = p_user_id
    AND ledger.marketing_site_id = p_marketing_site_id
    AND ledger.lead_id = p_lead_id
    AND ledger.consent_type = p_consent_type
    AND ledger.occurred_at <= now()
  ORDER BY ledger.occurred_at DESC, ledger.id DESC
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.marketing_provider_consent_allowed(
  p_user_id uuid,
  p_marketing_site_id uuid,
  p_lead_id uuid,
  p_provider text
)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT coalesce(CASE p_provider
    WHEN 'ga4' THEN public.marketing_latest_consent_status(
      p_user_id, p_marketing_site_id, p_lead_id, 'analytics_storage'
    ) = 'granted'
    WHEN 'google' THEN public.marketing_latest_consent_status(
      p_user_id, p_marketing_site_id, p_lead_id, 'ad_user_data'
    ) = 'granted'
    WHEN 'meta' THEN
      public.marketing_latest_consent_status(
        p_user_id, p_marketing_site_id, p_lead_id, 'ad_user_data'
      ) = 'granted'
      AND public.marketing_latest_consent_status(
        p_user_id, p_marketing_site_id, p_lead_id, 'ad_personalization'
      ) = 'granted'
    ELSE false
  END, false);
$$;

CREATE OR REPLACE FUNCTION public.marketing_consent_snapshot_at(
  p_user_id uuid,
  p_marketing_site_id uuid,
  p_lead_id uuid,
  p_occurred_at timestamptz
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT jsonb_build_object(
    'analytics_storage', coalesce((
      SELECT ledger.status
      FROM public.marketing_consent_ledger AS ledger
      WHERE ledger.user_id = p_user_id
        AND ledger.marketing_site_id = p_marketing_site_id
        AND ledger.lead_id = p_lead_id
        AND ledger.consent_type = 'analytics_storage'
        AND ledger.occurred_at <= p_occurred_at
      ORDER BY ledger.occurred_at DESC, ledger.id DESC
      LIMIT 1
    ), 'unknown'),
    'ad_storage', coalesce((
      SELECT ledger.status
      FROM public.marketing_consent_ledger AS ledger
      WHERE ledger.user_id = p_user_id
        AND ledger.marketing_site_id = p_marketing_site_id
        AND ledger.lead_id = p_lead_id
        AND ledger.consent_type = 'ad_storage'
        AND ledger.occurred_at <= p_occurred_at
      ORDER BY ledger.occurred_at DESC, ledger.id DESC
      LIMIT 1
    ), 'unknown'),
    'ad_user_data', coalesce((
      SELECT ledger.status
      FROM public.marketing_consent_ledger AS ledger
      WHERE ledger.user_id = p_user_id
        AND ledger.marketing_site_id = p_marketing_site_id
        AND ledger.lead_id = p_lead_id
        AND ledger.consent_type = 'ad_user_data'
        AND ledger.occurred_at <= p_occurred_at
      ORDER BY ledger.occurred_at DESC, ledger.id DESC
      LIMIT 1
    ), 'unknown'),
    'ad_personalization', coalesce((
      SELECT ledger.status
      FROM public.marketing_consent_ledger AS ledger
      WHERE ledger.user_id = p_user_id
        AND ledger.marketing_site_id = p_marketing_site_id
        AND ledger.lead_id = p_lead_id
        AND ledger.consent_type = 'ad_personalization'
        AND ledger.occurred_at <= p_occurred_at
      ORDER BY ledger.occurred_at DESC, ledger.id DESC
      LIMIT 1
    ), 'unknown'),
    'evaluated_at', p_occurred_at
  );
$$;

REVOKE ALL ON FUNCTION public.marketing_latest_consent_status(
  uuid, uuid, uuid, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.marketing_latest_consent_status(
  uuid, uuid, uuid, text
) TO service_role;
REVOKE ALL ON FUNCTION public.marketing_provider_consent_allowed(
  uuid, uuid, uuid, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.marketing_provider_consent_allowed(
  uuid, uuid, uuid, text
) TO service_role;
REVOKE ALL ON FUNCTION public.marketing_consent_snapshot_at(
  uuid, uuid, uuid, timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.marketing_consent_snapshot_at(
  uuid, uuid, uuid, timestamptz
) TO service_role;

CREATE OR REPLACE FUNCTION public.record_marketing_touchpoint_consent()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  consent_name text;
  consent_value text;
  prior_value text;
  consent_source text;
  consent_time timestamptz;
  snapshot_hash text;
BEGIN
  IF new.marketing_site_id IS NULL OR new.lead_id IS NULL THEN
    RETURN new;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.marketing_sites AS site
    WHERE site.id = new.marketing_site_id
      AND site.user_id = new.user_id
  ) THEN
    RETURN new;
  END IF;

  consent_source := CASE new.consent_snapshot ->> 'source'
    WHEN 'site_bridge' THEN 'site_bridge'
    WHEN 'server_webhook' THEN 'server_webhook'
    ELSE 'consent_update'
  END;
  consent_time := CASE
    WHEN TG_OP = 'INSERT' THEN coalesce(new.first_seen_at, now())
    ELSE now()
  END;
  snapshot_hash := public.marketing_json_hash(new.consent_snapshot);

  FOREACH consent_name IN ARRAY ARRAY[
    'analytics_storage', 'ad_storage', 'ad_user_data', 'ad_personalization'
  ] LOOP
    consent_value := new.consent_snapshot ->> consent_name;
    prior_value := CASE
      WHEN TG_OP = 'UPDATE' THEN old.consent_snapshot ->> consent_name
      ELSE NULL
    END;
    IF consent_value IN ('granted', 'denied')
       AND consent_value IS DISTINCT FROM prior_value THEN
      INSERT INTO public.marketing_consent_ledger (
        user_id, marketing_site_id, lead_id, consent_type,
        status, occurred_at, source, evidence_hash
      ) VALUES (
        new.user_id, new.marketing_site_id, new.lead_id, consent_name,
        consent_value, consent_time, consent_source, snapshot_hash
      )
      ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;

  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS marketing_touchpoints_record_consent
  ON public.marketing_touchpoints;
DROP TRIGGER IF EXISTS marketing_touchpoints_aa_record_consent
  ON public.marketing_touchpoints;
CREATE TRIGGER marketing_touchpoints_aa_record_consent
AFTER INSERT OR UPDATE OF consent_snapshot, marketing_site_id, lead_id
ON public.marketing_touchpoints
FOR EACH ROW
EXECUTE FUNCTION public.record_marketing_touchpoint_consent();

CREATE OR REPLACE FUNCTION public.record_marketing_consent_change(
  p_user_id uuid,
  p_marketing_site_id uuid,
  p_lead_id uuid,
  p_consent_snapshot jsonb,
  p_occurred_at timestamptz,
  p_source text DEFAULT 'consent_update'
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  consent_name text;
  consent_value text;
  inserted_count integer := 0;
  affected integer := 0;
  safe_source text := CASE p_source
    WHEN 'site_bridge' THEN 'site_bridge'
    WHEN 'server_webhook' THEN 'server_webhook'
    ELSE 'consent_update'
  END;
BEGIN
  IF p_user_id IS NULL
     OR p_marketing_site_id IS NULL
     OR p_lead_id IS NULL
     OR jsonb_typeof(p_consent_snapshot) <> 'object'
     OR p_occurred_at IS NULL
     OR p_occurred_at < now() - interval '365 days'
     OR p_occurred_at > now() + interval '5 minutes'
     OR NOT EXISTS (
       SELECT 1
       FROM public.marketing_sites AS site
       WHERE site.id = p_marketing_site_id
         AND site.user_id = p_user_id
     ) THEN
    RETURN 0;
  END IF;

  FOREACH consent_name IN ARRAY ARRAY[
    'analytics_storage', 'ad_storage', 'ad_user_data', 'ad_personalization'
  ] LOOP
    consent_value := p_consent_snapshot ->> consent_name;
    IF consent_value IN ('granted', 'denied') THEN
      INSERT INTO public.marketing_consent_ledger (
        user_id, marketing_site_id, lead_id, consent_type,
        status, occurred_at, source, evidence_hash
      ) VALUES (
        p_user_id, p_marketing_site_id, p_lead_id, consent_name,
        consent_value, p_occurred_at, safe_source,
        public.marketing_json_hash(p_consent_snapshot)
      )
      ON CONFLICT DO NOTHING;
      GET DIAGNOSTICS affected = ROW_COUNT;
      inserted_count := inserted_count + affected;
    END IF;
  END LOOP;

  RETURN inserted_count;
END;
$$;

REVOKE ALL ON FUNCTION public.record_marketing_consent_change(
  uuid, uuid, uuid, jsonb, timestamptz, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_marketing_consent_change(
  uuid, uuid, uuid, jsonb, timestamptz, text
) TO service_role;

CREATE OR REPLACE FUNCTION public.record_marketing_site_consent_update(
  p_site_key_id text,
  p_origin text,
  p_bridge_reference_hash text,
  p_consent_snapshot jsonb,
  p_occurred_at timestamptz
)
RETURNS TABLE (result_status text, recorded_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  matched_count integer := 0;
  tenant_ids uuid[];
  site_ids uuid[];
  lead_ids uuid[];
  tenant_id uuid;
  site_id uuid;
  resolved_lead_id uuid;
  inserted_count integer := 0;
BEGIN
  IF nullif(btrim(p_site_key_id), '') IS NULL
     OR nullif(btrim(p_origin), '') IS NULL
     OR p_bridge_reference_hash !~ '^[0-9a-f]{64}$'
     OR p_occurred_at IS NULL
     OR p_occurred_at < now() - interval '365 days'
     OR p_occurred_at > now() + interval '5 minutes'
     OR jsonb_typeof(p_consent_snapshot) <> 'object'
     OR p_consent_snapshot = '{}'::jsonb THEN
    RETURN QUERY SELECT 'rejected_payload'::text, 0::integer;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_each_text(p_consent_snapshot) AS signal(name, status)
    WHERE signal.name NOT IN (
      'analytics_storage', 'ad_storage', 'ad_user_data', 'ad_personalization'
    )
       OR signal.status NOT IN ('granted', 'denied')
  ) THEN
    RETURN QUERY SELECT 'rejected_consent'::text, 0::integer;
    RETURN;
  END IF;

  SELECT
    count(*)::integer,
    array_agg(candidate.user_id),
    array_agg(candidate.marketing_site_id),
    array_agg(candidate.lead_id)
  INTO matched_count, tenant_ids, site_ids, lead_ids
  FROM (
    SELECT touch.user_id, touch.marketing_site_id, touch.lead_id
    FROM public.marketing_sites AS site
    JOIN public.marketing_touchpoints AS touch
      ON touch.user_id = site.user_id
     AND touch.marketing_site_id = site.id
     AND touch.channel = 'website'
     AND touch.bridge_reference_hash = p_bridge_reference_hash
     AND touch.lead_id IS NOT NULL
    WHERE site.site_key_id = p_site_key_id
      AND p_origin = ANY (site.allowed_origins)
    LIMIT 2
  ) AS candidate;

  IF matched_count <> 1 THEN
    RETURN QUERY SELECT 'rejected_reference'::text, 0::integer;
    RETURN;
  END IF;

  tenant_id := tenant_ids[1];
  site_id := site_ids[1];
  resolved_lead_id := lead_ids[1];

  PERFORM pg_advisory_xact_lock(hashtextextended(
    concat_ws(
      ':', tenant_id::text, site_id::text, resolved_lead_id::text, 'consent'
    ),
    0
  ));

  inserted_count := public.record_marketing_consent_change(
    tenant_id,
    site_id,
    resolved_lead_id,
    p_consent_snapshot,
    p_occurred_at,
    'site_bridge'
  );

  RETURN QUERY SELECT
    CASE WHEN inserted_count > 0 THEN 'recorded' ELSE 'duplicate' END,
    inserted_count;
END;
$$;

REVOKE ALL ON FUNCTION public.record_marketing_site_consent_update(
  text, text, text, jsonb, timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_marketing_site_consent_update(
  text, text, text, jsonb, timestamptz
) TO service_role;

CREATE OR REPLACE FUNCTION public.consume_marketing_bridge_nonce(
  p_site_key_id text,
  p_origin text,
  p_nonce_hash text,
  p_request_hash text,
  p_expires_at timestamptz
)
RETURNS TABLE (tenant_user_id uuid, marketing_site_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF p_nonce_hash !~ '^[0-9a-f]{64}$'
     OR p_request_hash !~ '^[0-9a-f]{64}$'
     OR p_expires_at <= now()
     OR p_expires_at > now() + interval '10 minutes' THEN
    RETURN;
  END IF;

  RETURN QUERY
  INSERT INTO public.marketing_bridge_nonces (
    user_id,
    marketing_site_id,
    nonce_hash,
    request_hash,
    origin,
    expires_at,
    consumed_at
  )
  SELECT
    site.user_id,
    site.id,
    p_nonce_hash,
    p_request_hash,
    p_origin,
    p_expires_at,
    now()
  FROM public.marketing_sites AS site
  WHERE site.site_key_id = p_site_key_id
    AND site.enabled
    AND site.measurement_enabled
    AND p_origin = ANY (site.allowed_origins)
  ON CONFLICT ON CONSTRAINT marketing_bridge_nonce_unique DO NOTHING
  RETURNING
    marketing_bridge_nonces.user_id,
    marketing_bridge_nonces.marketing_site_id;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_marketing_bridge_nonce(
  text, text, text, text, timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_marketing_bridge_nonce(
  text, text, text, text, timestamptz
) TO service_role;

CREATE OR REPLACE FUNCTION public.register_marketing_site_intake(
  p_site_key_id text,
  p_origin text,
  p_nonce_hash text,
  p_body_sha256 text,
  p_signed_at timestamptz,
  p_touchpoint jsonb
)
RETURNS TABLE (
  result_status text,
  touchpoint_id bigint,
  lead_id uuid,
  event_id text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  tenant_id uuid;
  site_id uuid;
  intake_event_id text;
  intake_lead_id uuid;
  intake_consent_status text;
  intake_consent_snapshot jsonb;
  intake_bridge_ref_hash text;
  intake_source_url text;
  inserted_touchpoint public.marketing_touchpoints%ROWTYPE;
BEGIN
  IF p_signed_at IS NULL
     OR abs(extract(epoch FROM (now() - p_signed_at))) > 300
     OR jsonb_typeof(p_touchpoint) <> 'object'
     OR p_body_sha256 !~ '^[0-9a-f]{64}$' THEN
    RETURN QUERY SELECT 'rejected_payload'::text, NULL::bigint, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  SELECT consumed.tenant_user_id, consumed.marketing_site_id
  INTO tenant_id, site_id
  FROM public.consume_marketing_bridge_nonce(
    p_site_key_id,
    p_origin,
    p_nonce_hash,
    p_body_sha256,
    now() + interval '5 minutes'
  ) AS consumed;

  IF tenant_id IS NULL OR site_id IS NULL THEN
    RETURN QUERY SELECT 'rejected_or_replayed'::text, NULL::bigint, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  intake_event_id := left(nullif(btrim(coalesce(
    p_touchpoint ->> 'external_event_id',
    p_touchpoint ->> 'event_id'
  )), ''), 500);
  IF intake_event_id IS NULL THEN
    RETURN QUERY SELECT 'rejected_event_id'::text, NULL::bigint, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  intake_lead_id := CASE
    WHEN coalesce(p_touchpoint ->> 'lead_id', '')
      ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    THEN (p_touchpoint ->> 'lead_id')::uuid
    ELSE gen_random_uuid()
  END;

  intake_consent_status := CASE p_touchpoint ->> 'consent_status'
    WHEN 'granted' THEN 'granted'
    WHEN 'denied' THEN 'denied'
    ELSE 'unknown'
  END;

  intake_consent_snapshot := (CASE
    WHEN jsonb_typeof(p_touchpoint -> 'consent_snapshot') = 'object'
    THEN p_touchpoint -> 'consent_snapshot'
    ELSE '{}'::jsonb
  END) || jsonb_build_object(
    'status', intake_consent_status,
    'analytics_storage', CASE
      WHEN p_touchpoint -> 'consent_snapshot' ->> 'analytics_storage'
        IN ('granted', 'denied')
      THEN p_touchpoint -> 'consent_snapshot' ->> 'analytics_storage'
      ELSE 'unknown'
    END,
    'ad_storage', CASE
      WHEN p_touchpoint -> 'consent_snapshot' ->> 'ad_storage'
        IN ('granted', 'denied')
      THEN p_touchpoint -> 'consent_snapshot' ->> 'ad_storage'
      ELSE 'unknown'
    END,
    'ad_user_data', CASE
      WHEN p_touchpoint -> 'consent_snapshot' ->> 'ad_user_data'
        IN ('granted', 'denied')
      THEN p_touchpoint -> 'consent_snapshot' ->> 'ad_user_data'
      ELSE 'unknown'
    END,
    'ad_personalization', CASE
      WHEN p_touchpoint -> 'consent_snapshot' ->> 'ad_personalization'
        IN ('granted', 'denied')
      THEN p_touchpoint -> 'consent_snapshot' ->> 'ad_personalization'
      ELSE 'unknown'
    END,
    'captured_at', p_signed_at,
    'source', 'site_bridge'
  );

  intake_bridge_ref_hash := CASE
    WHEN coalesce(p_touchpoint ->> 'bridge_reference_hash', '') ~ '^[0-9a-f]{64}$'
    THEN p_touchpoint ->> 'bridge_reference_hash'
    WHEN coalesce(p_touchpoint ->> 'bridge_reference', '') ~ '^[A-Za-z0-9_-]{8,64}$'
    THEN public.marketing_identity_hash(p_touchpoint ->> 'bridge_reference')
    ELSE NULL
  END;

  intake_source_url := CASE
    WHEN p_touchpoint ->> 'source_url' = p_origin
      OR p_touchpoint ->> 'source_url' LIKE p_origin || '/%'
      OR p_touchpoint ->> 'source_url' LIKE p_origin || '?%'
    THEN public.marketing_sanitized_source_url(p_touchpoint ->> 'source_url')
    ELSE NULL
  END;

  INSERT INTO public.marketing_touchpoints (
    user_id,
    marketing_site_id,
    lead_id,
    channel,
    source,
    external_event_id,
    phone,
    source_url,
    gclid,
    gbraid,
    wbraid,
    fbclid,
    fbc,
    fbp,
    utm_source,
    utm_medium,
    utm_campaign,
    utm_content,
    utm_term,
    ad_id,
    adset_id,
    campaign_external_id,
    consent_status,
    consent_snapshot,
    bridge_payload_hash,
    bridge_reference_hash,
    ga_client_id,
    ga_session_id,
    client_user_agent,
    metadata,
    first_seen_at,
    last_seen_at
  )
  VALUES (
    tenant_id,
    site_id,
    intake_lead_id,
    'website',
    'site_bridge',
    intake_event_id,
    NULL,
    intake_source_url,
    CASE WHEN intake_consent_snapshot ->> 'ad_storage' = 'granted'
      THEN left(nullif(btrim(p_touchpoint ->> 'gclid'), ''), 500) ELSE NULL END,
    CASE WHEN intake_consent_snapshot ->> 'ad_storage' = 'granted'
      THEN left(nullif(btrim(p_touchpoint ->> 'gbraid'), ''), 500) ELSE NULL END,
    CASE WHEN intake_consent_snapshot ->> 'ad_storage' = 'granted'
      THEN left(nullif(btrim(p_touchpoint ->> 'wbraid'), ''), 500) ELSE NULL END,
    CASE WHEN intake_consent_snapshot ->> 'ad_storage' = 'granted'
      THEN left(nullif(btrim(p_touchpoint ->> 'fbclid'), ''), 500) ELSE NULL END,
    CASE WHEN intake_consent_snapshot ->> 'ad_storage' = 'granted'
      THEN left(nullif(btrim(p_touchpoint ->> 'fbc'), ''), 500) ELSE NULL END,
    CASE WHEN intake_consent_snapshot ->> 'ad_storage' = 'granted'
      THEN left(nullif(btrim(p_touchpoint ->> 'fbp'), ''), 500) ELSE NULL END,
    left(nullif(btrim(p_touchpoint ->> 'utm_source'), ''), 500),
    left(nullif(btrim(p_touchpoint ->> 'utm_medium'), ''), 500),
    left(nullif(btrim(p_touchpoint ->> 'utm_campaign'), ''), 500),
    left(nullif(btrim(p_touchpoint ->> 'utm_content'), ''), 500),
    left(nullif(btrim(p_touchpoint ->> 'utm_term'), ''), 500),
    left(nullif(btrim(p_touchpoint ->> 'ad_id'), ''), 500),
    left(nullif(btrim(p_touchpoint ->> 'adset_id'), ''), 500),
    left(nullif(btrim(coalesce(
      p_touchpoint ->> 'campaign_external_id',
      p_touchpoint ->> 'campaign_id'
    )), ''), 500),
    intake_consent_status,
    intake_consent_snapshot,
    p_body_sha256,
    intake_bridge_ref_hash,
    CASE WHEN intake_consent_snapshot ->> 'analytics_storage' = 'granted'
      THEN left(nullif(btrim(p_touchpoint ->> 'ga_client_id'), ''), 200) ELSE NULL END,
    CASE WHEN intake_consent_snapshot ->> 'analytics_storage' = 'granted'
      THEN left(nullif(btrim(p_touchpoint ->> 'ga_session_id'), ''), 200) ELSE NULL END,
    CASE WHEN intake_consent_snapshot ->> 'ad_user_data' = 'granted'
      THEN left(nullif(btrim(p_touchpoint ->> 'client_user_agent'), ''), 1000) ELSE NULL END,
    jsonb_strip_nulls(jsonb_build_object(
      'intake_type', 'signed_site_bridge',
      'page_path', left(nullif(btrim(
        p_touchpoint -> 'metadata' ->> 'page_path'
      ), ''), 512),
      'cta_id', left(nullif(btrim(
        p_touchpoint -> 'metadata' ->> 'cta_id'
      ), ''), 120),
      'cta_location', left(nullif(btrim(
        p_touchpoint -> 'metadata' ->> 'cta_location'
      ), ''), 120)
    )),
    p_signed_at,
    p_signed_at
  )
  ON CONFLICT (
    user_id, event_scope_key, channel, external_event_id
  ) DO NOTHING
  RETURNING * INTO inserted_touchpoint;

  IF inserted_touchpoint.id IS NOT NULL THEN
    RETURN QUERY
    SELECT
      'created'::text,
      inserted_touchpoint.id,
      inserted_touchpoint.lead_id,
      inserted_touchpoint.external_event_id;
    RETURN;
  END IF;

  SELECT touch.*
  INTO inserted_touchpoint
  FROM public.marketing_touchpoints AS touch
  WHERE touch.user_id = tenant_id
    AND touch.marketing_site_id = site_id
    AND touch.channel = 'website'
    AND touch.external_event_id = intake_event_id
  LIMIT 1;

  RETURN QUERY
  SELECT
    CASE
      WHEN inserted_touchpoint.id IS NULL THEN 'conflict'
      WHEN inserted_touchpoint.bridge_payload_hash IS DISTINCT FROM p_body_sha256
        THEN 'conflict_payload'
      ELSE 'duplicate'
    END,
    inserted_touchpoint.id,
    inserted_touchpoint.lead_id,
    inserted_touchpoint.external_event_id;
END;
$$;

REVOKE ALL ON FUNCTION public.register_marketing_site_intake(
  text, text, text, text, timestamptz, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_marketing_site_intake(
  text, text, text, text, timestamptz, jsonb
) TO service_role;

CREATE OR REPLACE FUNCTION public.register_marketing_site_consent_update(
  p_site_key_id text,
  p_origin text,
  p_nonce_hash text,
  p_body_sha256 text,
  p_signed_at timestamptz,
  p_update jsonb
)
RETURNS TABLE (result_status text, event_id text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  nonce_tenant_id uuid;
  nonce_site_id uuid;
  update_event_id text;
  update_occurred_at timestamptz;
  consent_result text;
BEGIN
  IF p_signed_at IS NULL
     OR abs(extract(epoch FROM (now() - p_signed_at))) > 300
     OR p_nonce_hash !~ '^[0-9a-f]{64}$'
     OR p_body_sha256 !~ '^[0-9a-f]{64}$'
     OR jsonb_typeof(p_update) <> 'object'
     OR EXISTS (
       SELECT 1
       FROM jsonb_object_keys(p_update) AS field(name)
       WHERE field.name NOT IN (
         'event_id', 'occurred_at', 'bridge_reference_hash', 'consent_snapshot'
       )
     ) THEN
    RETURN QUERY SELECT 'rejected_payload'::text, NULL::text;
    RETURN;
  END IF;

  update_event_id := nullif(btrim(p_update ->> 'event_id'), '');
  IF update_event_id IS NULL
     OR update_event_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    RETURN QUERY SELECT 'rejected_event_id'::text, NULL::text;
    RETURN;
  END IF;

  BEGIN
    update_occurred_at := (p_update ->> 'occurred_at')::timestamptz;
  EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow THEN
    RETURN QUERY SELECT 'rejected_timestamp'::text, NULL::text;
    RETURN;
  END;

  INSERT INTO public.marketing_bridge_nonces (
    user_id, marketing_site_id, nonce_hash, request_hash,
    origin, expires_at, consumed_at
  )
  SELECT
    site.user_id, site.id, p_nonce_hash, p_body_sha256,
    p_origin, now() + interval '5 minutes', now()
  FROM public.marketing_sites AS site
  WHERE site.site_key_id = p_site_key_id
    AND p_origin = ANY (site.allowed_origins)
  ON CONFLICT ON CONSTRAINT marketing_bridge_nonce_unique DO NOTHING
  RETURNING user_id, marketing_site_id
  INTO nonce_tenant_id, nonce_site_id;

  IF nonce_tenant_id IS NULL OR nonce_site_id IS NULL THEN
    RETURN QUERY SELECT 'rejected_or_replayed'::text, NULL::text;
    RETURN;
  END IF;

  SELECT recorded.result_status
  INTO consent_result
  FROM public.record_marketing_site_consent_update(
    p_site_key_id,
    p_origin,
    p_update ->> 'bridge_reference_hash',
    p_update -> 'consent_snapshot',
    update_occurred_at
  ) AS recorded;

  RETURN QUERY SELECT
    CASE consent_result
      WHEN 'recorded' THEN 'created'
      WHEN 'duplicate' THEN 'duplicate'
      ELSE coalesce(consent_result, 'rejected_payload')
    END,
    update_event_id;
END;
$$;

REVOKE ALL ON FUNCTION public.register_marketing_site_consent_update(
  text, text, text, text, timestamptz, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_marketing_site_consent_update(
  text, text, text, text, timestamptz, jsonb
) TO service_role;

CREATE OR REPLACE FUNCTION public.enqueue_marketing_event(
  p_user_id uuid,
  p_deal_id bigint,
  p_touchpoint_id bigint,
  p_lead_id uuid,
  p_event_name text,
  p_event_id text,
  p_occurred_at timestamptz,
  p_value numeric DEFAULT 0,
  p_contact_phone text DEFAULT NULL,
  p_contact_email text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  touchpoint public.marketing_touchpoints%ROWTYPE;
  frozen_consent jsonb;
  frozen_user_data jsonb;
  frozen_attribution jsonb;
  frozen_event_data jsonb;
  existing_fact public.marketing_conversion_facts%ROWTYPE;
  fact_payload_hash text;
  persisted_fact_id bigint;
  queued_count integer := 0;
BEGIN
  IF p_event_name NOT IN ('Contact', 'Lead', 'Schedule', 'Purchase')
     OR nullif(btrim(p_event_id), '') IS NULL
     OR p_occurred_at IS NULL THEN
    RETURN 0;
  END IF;

  IF p_touchpoint_id IS NOT NULL THEN
    SELECT touch.*
    INTO touchpoint
    FROM public.marketing_touchpoints AS touch
    WHERE touch.id = p_touchpoint_id
      AND touch.user_id = p_user_id
      AND touch.first_seen_at <= p_occurred_at + interval '5 minutes'
      AND touch.first_seen_at >= p_occurred_at - interval '180 days';
  ELSE
    SELECT touch.*
    INTO touchpoint
    FROM public.marketing_touchpoints AS touch
    WHERE touch.user_id = p_user_id
      AND (
        (p_deal_id IS NOT NULL AND touch.deal_id = p_deal_id)
        OR (p_lead_id IS NOT NULL AND touch.lead_id = p_lead_id)
      )
      AND touch.first_seen_at <= p_occurred_at + interval '5 minutes'
      AND touch.first_seen_at >= p_occurred_at - interval '180 days'
    ORDER BY
      (touch.deal_id = p_deal_id) DESC,
      touch.last_seen_at DESC,
      touch.id DESC
    LIMIT 1;
  END IF;

  IF NOT FOUND OR touchpoint.lead_id IS NULL THEN
    RETURN 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.marketing_sites AS site
    WHERE site.id = touchpoint.marketing_site_id
      AND site.user_id = p_user_id
      AND site.enabled
      AND site.measurement_enabled
  ) THEN
    RETURN 0;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    concat_ws(
      ':',
      p_user_id::text,
      touchpoint.marketing_site_id::text,
      btrim(p_event_id)
    ),
    0
  ));

  SELECT stored.*
  INTO existing_fact
  FROM public.marketing_conversion_facts AS stored
  WHERE stored.user_id = p_user_id
    AND stored.marketing_site_id = touchpoint.marketing_site_id
    AND stored.event_id = p_event_id;

  IF FOUND THEN
    IF existing_fact.event_name IS DISTINCT FROM p_event_name
       OR existing_fact.lead_id IS DISTINCT FROM coalesce(p_lead_id, touchpoint.lead_id)
       OR (
         existing_fact.deal_id IS NOT NULL
         AND p_deal_id IS NOT NULL
         AND existing_fact.deal_id IS DISTINCT FROM p_deal_id
       )
       OR existing_fact.touchpoint_id IS DISTINCT FROM touchpoint.id
       OR existing_fact.value IS DISTINCT FROM greatest(coalesce(p_value, 0), 0) THEN
      RAISE EXCEPTION 'MARKETING_FACT_IDEMPOTENCY_CONFLICT';
    END IF;
    RETURN 0;
  END IF;

  frozen_consent := public.marketing_consent_snapshot_at(
    p_user_id,
    touchpoint.marketing_site_id,
    coalesce(p_lead_id, touchpoint.lead_id),
    p_occurred_at
  ) || jsonb_build_object(
    'legacy_status', touchpoint.consent_status,
    'touchpoint_id', touchpoint.id
  );

  frozen_user_data := CASE
    WHEN frozen_consent ->> 'ad_user_data' <> 'granted' THEN '{}'::jsonb
    ELSE jsonb_strip_nulls(jsonb_build_object(
    'ph', CASE
      WHEN public.marketing_brazil_e164(coalesce(p_contact_phone, touchpoint.phone)) IS NOT NULL
      THEN public.marketing_identity_hash(
        public.marketing_brazil_e164(coalesce(p_contact_phone, touchpoint.phone))
      )
      ELSE NULL
    END,
    'em', CASE
      WHEN nullif(btrim(p_contact_email), '') IS NOT NULL
      THEN public.marketing_identity_hash(p_contact_email)
      ELSE NULL
    END,
    'lead_id', coalesce(p_lead_id, touchpoint.lead_id)::text,
      'client_user_agent', touchpoint.client_user_agent
    ))
  END;

  frozen_attribution := jsonb_strip_nulls(jsonb_build_object(
    'ctwa_clid', CASE
      WHEN frozen_consent ->> 'ad_storage' = 'granted'
        AND frozen_consent ->> 'ad_user_data' = 'granted'
      THEN touchpoint.ctwa_clid ELSE NULL END,
    'gclid', CASE
      WHEN frozen_consent ->> 'ad_storage' = 'granted'
        AND frozen_consent ->> 'ad_user_data' = 'granted'
      THEN touchpoint.gclid ELSE NULL END,
    'gbraid', CASE
      WHEN frozen_consent ->> 'ad_storage' = 'granted'
        AND frozen_consent ->> 'ad_user_data' = 'granted'
      THEN touchpoint.gbraid ELSE NULL END,
    'wbraid', CASE
      WHEN frozen_consent ->> 'ad_storage' = 'granted'
        AND frozen_consent ->> 'ad_user_data' = 'granted'
      THEN touchpoint.wbraid ELSE NULL END,
    'fbclid', CASE
      WHEN frozen_consent ->> 'ad_storage' = 'granted'
        AND frozen_consent ->> 'ad_user_data' = 'granted'
      THEN touchpoint.fbclid ELSE NULL END,
    'fbc', CASE
      WHEN frozen_consent ->> 'ad_storage' = 'granted'
        AND frozen_consent ->> 'ad_user_data' = 'granted'
      THEN touchpoint.fbc ELSE NULL END,
    'fbp', CASE
      WHEN frozen_consent ->> 'ad_storage' = 'granted'
        AND frozen_consent ->> 'ad_user_data' = 'granted'
      THEN touchpoint.fbp ELSE NULL END,
    'utm_source', touchpoint.utm_source,
    'utm_medium', touchpoint.utm_medium,
    'utm_campaign', touchpoint.utm_campaign,
    'utm_content', touchpoint.utm_content,
    'utm_term', touchpoint.utm_term,
    'ad_id', CASE WHEN frozen_consent ->> 'ad_user_data' = 'granted'
      THEN touchpoint.ad_id ELSE NULL END,
    'adset_id', CASE WHEN frozen_consent ->> 'ad_user_data' = 'granted'
      THEN touchpoint.adset_id ELSE NULL END,
    'campaign_id', CASE WHEN frozen_consent ->> 'ad_user_data' = 'granted'
      THEN touchpoint.campaign_external_id ELSE NULL END,
    'bridge_payload_hash', touchpoint.bridge_payload_hash,
    'ga_client_id', CASE WHEN frozen_consent ->> 'analytics_storage' = 'granted'
      THEN touchpoint.ga_client_id ELSE NULL END,
    'ga_session_id', CASE WHEN frozen_consent ->> 'analytics_storage' = 'granted'
      THEN touchpoint.ga_session_id ELSE NULL END,
    'whatsapp_business_account_id', CASE
      WHEN frozen_consent ->> 'ad_user_data' = 'granted'
      THEN touchpoint.whatsapp_business_account_id ELSE NULL END
  ));

  frozen_event_data := jsonb_build_object(
    'event_name', p_event_name,
    'event_id', p_event_id,
    'occurred_at', p_occurred_at,
    'value', greatest(coalesce(p_value, 0), 0),
    'currency', 'BRL',
    'source_context', CASE
      WHEN p_event_name = 'Contact' THEN 'message'
      ELSE 'other'
    END,
    'source_url', public.marketing_sanitized_source_url(touchpoint.source_url)
  );

  fact_payload_hash := public.marketing_json_hash(jsonb_build_object(
    'user_id', p_user_id,
    'marketing_site_id', touchpoint.marketing_site_id,
    'event_id', p_event_id,
    'consent', frozen_consent,
    'user_data', frozen_user_data,
    'attribution', frozen_attribution,
    'event_data', frozen_event_data
  ));

  -- O fato de CRM é durável mesmo sem integração ativa. O fan-out abaixo pode
  -- ser repetido de forma explícita após a configuração, sem fabricar eventos.
  INSERT INTO public.marketing_conversion_facts (
    user_id,
    marketing_site_id,
    deal_id,
    touchpoint_id,
    lead_id,
    event_name,
    event_id,
    occurred_at,
    value,
    currency,
    consent_snapshot,
    user_data,
    attribution_data,
    event_data,
    payload_hash
  ) VALUES (
    p_user_id,
    touchpoint.marketing_site_id,
    p_deal_id,
    touchpoint.id,
    coalesce(p_lead_id, touchpoint.lead_id),
    p_event_name,
    p_event_id,
    p_occurred_at,
    greatest(coalesce(p_value, 0), 0),
    'BRL',
    frozen_consent,
    frozen_user_data,
    frozen_attribution,
    frozen_event_data,
    fact_payload_hash
  )
  ON CONFLICT (user_id, marketing_site_id, event_id) DO UPDATE
  SET payload_hash = marketing_conversion_facts.payload_hash
  WHERE marketing_conversion_facts.payload_hash = EXCLUDED.payload_hash
  RETURNING id INTO persisted_fact_id;

  IF persisted_fact_id IS NULL THEN
    RAISE EXCEPTION 'MARKETING_FACT_PAYLOAD_CONFLICT';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.marketing_conversion_outbox AS existing
    JOIN public.marketing_integrations AS integration
      ON integration.id = existing.integration_id
     AND integration.user_id = existing.user_id
     AND integration.provider = existing.provider
     AND integration.marketing_site_id = existing.marketing_site_id
    WHERE existing.user_id = p_user_id
      AND existing.marketing_site_id = touchpoint.marketing_site_id
      AND existing.event_id = p_event_id
      AND existing.payload_hash IS DISTINCT FROM public.marketing_outbox_payload_hash(
        p_user_id,
        integration.id,
        touchpoint.marketing_site_id,
        integration.provider,
        integration.destination_id,
        integration.account_id,
        public.marketing_conversion_action_id(
          integration.provider,
          integration.event_mappings,
          p_event_name,
          integration.conversion_action_id
        ),
        public.marketing_provider_event_name(
          integration.provider,
          integration.event_mappings,
          p_event_name,
          nullif(btrim(touchpoint.ctwa_clid), '') IS NOT NULL
        ),
        p_event_id,
        frozen_consent,
        CASE WHEN integration.provider = 'meta' THEN frozen_user_data ELSE '{}'::jsonb END,
        frozen_attribution,
        frozen_event_data
      )
  ) THEN
    RAISE EXCEPTION 'MARKETING_OUTBOX_PAYLOAD_CONFLICT';
  END IF;

  INSERT INTO public.marketing_conversion_outbox (
    user_id,
    deal_id,
    provider,
    event_name,
    event_id,
    occurred_at,
    value,
    currency,
    status,
    integration_id,
    marketing_site_id,
    destination_id,
    account_id,
    conversion_action_id,
    provider_event_name,
    touchpoint_id,
    lead_id,
    event_source_url,
    consent_snapshot,
    user_data,
    attribution_data,
    event_data,
    payload_hash
  )
  SELECT
    p_user_id,
    p_deal_id,
    integration.provider,
    p_event_name,
    p_event_id,
    p_occurred_at,
    greatest(coalesce(p_value, 0), 0),
    'BRL',
    'pending',
    integration.id,
    touchpoint.marketing_site_id,
    integration.destination_id,
    integration.account_id,
    public.marketing_conversion_action_id(
      integration.provider,
      integration.event_mappings,
      p_event_name,
      integration.conversion_action_id
    ),
    public.marketing_provider_event_name(
      integration.provider,
      integration.event_mappings,
      p_event_name,
      nullif(btrim(touchpoint.ctwa_clid), '') IS NOT NULL
    ),
    touchpoint.id,
    coalesce(p_lead_id, touchpoint.lead_id),
    public.marketing_sanitized_source_url(touchpoint.source_url),
    frozen_consent,
    CASE
      WHEN integration.provider = 'meta' THEN frozen_user_data
      ELSE '{}'::jsonb
    END,
    frozen_attribution,
    frozen_event_data,
    public.marketing_outbox_payload_hash(
      p_user_id,
      integration.id,
      touchpoint.marketing_site_id,
      integration.provider,
      integration.destination_id,
      integration.account_id,
      public.marketing_conversion_action_id(
        integration.provider,
        integration.event_mappings,
        p_event_name,
        integration.conversion_action_id
      ),
      public.marketing_provider_event_name(
        integration.provider,
        integration.event_mappings,
        p_event_name,
        nullif(btrim(touchpoint.ctwa_clid), '') IS NOT NULL
      ),
      p_event_id,
      frozen_consent,
      CASE
        WHEN integration.provider = 'meta' THEN frozen_user_data
        ELSE '{}'::jsonb
      END,
      frozen_attribution,
      frozen_event_data
    )
  FROM public.marketing_integrations AS integration
  WHERE integration.user_id = p_user_id
    AND integration.marketing_site_id = touchpoint.marketing_site_id
    AND integration.enabled
    AND nullif(btrim(integration.destination_id), '') IS NOT NULL
    AND integration.provider IN ('meta', 'google', 'ga4')
    AND public.marketing_provider_event_is_fresh(
      integration.provider,
      p_occurred_at
    )
    AND CASE integration.provider
      WHEN 'meta' THEN p_occurred_at - touchpoint.first_seen_at <= interval '7 days'
      WHEN 'google' THEN p_occurred_at - touchpoint.first_seen_at <= interval '90 days'
      WHEN 'ga4' THEN p_occurred_at - touchpoint.first_seen_at <= interval '90 days'
      ELSE false
    END
    AND public.marketing_provider_consent_allowed(
      p_user_id,
      touchpoint.marketing_site_id,
      coalesce(p_lead_id, touchpoint.lead_id),
      integration.provider
    )
    AND EXISTS (
      SELECT 1
      FROM public.marketing_destination_ownership AS ownership
      WHERE ownership.user_id = integration.user_id
        AND ownership.marketing_site_id = integration.marketing_site_id
        AND ownership.integration_id = integration.id
        AND ownership.provider = integration.provider
        AND ownership.verified_at <= now()
        AND ownership.resource_key = CASE
          WHEN integration.provider = 'google' THEN lower(concat(
            regexp_replace(coalesce(integration.account_id, ''), '\D', '', 'g'),
            ':',
            btrim(integration.event_mappings -> p_event_name ->> 'conversion_action_id')
          ))
          ELSE lower(btrim(integration.destination_id))
        END
    )
    AND (
      (
        integration.provider = 'ga4'
        AND frozen_consent ->> 'analytics_storage' = 'granted'
      )
      OR (
        integration.provider = 'google'
        AND frozen_consent ->> 'ad_user_data' = 'granted'
      )
      OR (
        integration.provider = 'meta'
        AND frozen_consent ->> 'ad_user_data' = 'granted'
        AND frozen_consent ->> 'ad_personalization' = 'granted'
      )
    )
    AND (
      integration.provider <> 'ga4'
      OR nullif(btrim(touchpoint.ga_client_id), '') IS NOT NULL
    )
    AND (
      integration.provider <> 'google'
      OR coalesce(
        nullif(btrim(touchpoint.gclid), ''),
        nullif(btrim(touchpoint.gbraid), ''),
        nullif(btrim(touchpoint.wbraid), '')
      ) IS NOT NULL
    )
    AND (
      integration.provider <> 'google'
      OR (
        nullif(btrim(
          integration.event_mappings -> p_event_name ->> 'conversion_action_id'
        ), '') IS NOT NULL
        AND coalesce(
          integration.event_mappings -> p_event_name ->> 'enabled',
          'true'
        ) = 'true'
      )
    )
    AND (
      integration.provider <> 'meta'
      OR nullif(btrim(touchpoint.ctwa_clid), '') IS NULL
      OR coalesce(
        integration.event_mappings -> p_event_name ->> 'event_name',
        integration.event_mappings ->> p_event_name
      ) IN ('LeadSubmitted', 'Purchase')
    )
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS queued_count = ROW_COUNT;
  RETURN queued_count;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_marketing_event(
  uuid, bigint, bigint, uuid, text, text, timestamptz, numeric, text, text
) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.replay_marketing_conversion_facts(
  p_user_id uuid,
  p_marketing_site_id uuid,
  p_after timestamptz,
  p_before timestamptz,
  p_limit integer DEFAULT 100
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  replayed_count integer := 0;
  safe_limit integer := least(greatest(coalesce(p_limit, 100), 1), 500);
BEGIN
  IF p_user_id IS NULL
     OR p_marketing_site_id IS NULL
     OR p_after IS NULL
     OR p_before IS NULL
     OR p_after >= p_before
     OR p_before - p_after > interval '366 days'
     OR NOT EXISTS (
       SELECT 1
       FROM public.marketing_sites AS site
       WHERE site.id = p_marketing_site_id
         AND site.user_id = p_user_id
         AND site.enabled
         AND site.measurement_enabled
     ) THEN
    RETURN 0;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.marketing_conversion_facts AS fact
    JOIN public.marketing_integrations AS integration
      ON integration.user_id = fact.user_id
     AND integration.marketing_site_id = fact.marketing_site_id
     AND integration.enabled
     AND integration.provider IN ('meta', 'google', 'ga4')
    JOIN public.marketing_conversion_outbox AS existing
      ON existing.user_id = fact.user_id
     AND existing.integration_id = integration.id
     AND existing.event_id = fact.event_id
    WHERE fact.user_id = p_user_id
      AND fact.marketing_site_id = p_marketing_site_id
      AND fact.occurred_at >= p_after
      AND fact.occurred_at < p_before
      AND public.marketing_provider_event_is_fresh(
        integration.provider,
        fact.occurred_at
      )
      AND (
        existing.status IN (
          'blocked_config', 'validation_only', 'cancelled_consent'
        )
        OR (
          existing.status = 'dead'
          AND public.marketing_dead_error_is_transient(existing.last_error)
        )
      )
      AND existing.payload_hash IS DISTINCT FROM public.marketing_outbox_payload_hash(
        fact.user_id,
        integration.id,
        fact.marketing_site_id,
        integration.provider,
        integration.destination_id,
        integration.account_id,
        public.marketing_conversion_action_id(
          integration.provider,
          integration.event_mappings,
          fact.event_name,
          integration.conversion_action_id
        ),
        public.marketing_provider_event_name(
          integration.provider,
          integration.event_mappings,
          fact.event_name,
          nullif(btrim(fact.attribution_data ->> 'ctwa_clid'), '') IS NOT NULL
        ),
        fact.event_id,
        fact.consent_snapshot,
        CASE WHEN integration.provider = 'meta' THEN fact.user_data ELSE '{}'::jsonb END,
        fact.attribution_data,
        fact.event_data
      )
  ) THEN
    RAISE EXCEPTION 'MARKETING_REPLAY_PAYLOAD_CONFLICT';
  END IF;

  WITH eligible AS MATERIALIZED (
    SELECT
      fact.id AS fact_id,
      fact.user_id,
      fact.deal_id,
      integration.provider,
      fact.event_name,
      fact.event_id,
      fact.occurred_at,
      fact.value,
      fact.currency,
      integration.id AS integration_id,
      fact.marketing_site_id,
      integration.destination_id,
      integration.account_id,
      public.marketing_conversion_action_id(
        integration.provider,
        integration.event_mappings,
        fact.event_name,
        integration.conversion_action_id
      ) AS conversion_action_id,
      public.marketing_provider_event_name(
        integration.provider,
        integration.event_mappings,
        fact.event_name,
        nullif(btrim(fact.attribution_data ->> 'ctwa_clid'), '') IS NOT NULL
      ) AS provider_event_name,
      fact.touchpoint_id,
      fact.lead_id,
      public.marketing_sanitized_source_url(
        fact.event_data ->> 'source_url'
      ) AS event_source_url,
      fact.consent_snapshot,
      CASE WHEN integration.provider = 'meta' THEN fact.user_data ELSE '{}'::jsonb END AS user_data,
      fact.attribution_data,
      fact.event_data,
      public.marketing_outbox_payload_hash(
        fact.user_id,
        integration.id,
        fact.marketing_site_id,
        integration.provider,
        integration.destination_id,
        integration.account_id,
        public.marketing_conversion_action_id(
          integration.provider,
          integration.event_mappings,
          fact.event_name,
          integration.conversion_action_id
        ),
        public.marketing_provider_event_name(
          integration.provider,
          integration.event_mappings,
          fact.event_name,
          nullif(btrim(fact.attribution_data ->> 'ctwa_clid'), '') IS NOT NULL
        ),
        fact.event_id,
        fact.consent_snapshot,
        CASE WHEN integration.provider = 'meta' THEN fact.user_data ELSE '{}'::jsonb END,
        fact.attribution_data,
        fact.event_data
      ) AS payload_hash
    FROM public.marketing_conversion_facts AS fact
    JOIN public.marketing_touchpoints AS touch
      ON touch.id = fact.touchpoint_id
     AND touch.user_id = fact.user_id
     AND touch.marketing_site_id = fact.marketing_site_id
    JOIN public.marketing_integrations AS integration
      ON integration.user_id = fact.user_id
     AND integration.marketing_site_id = fact.marketing_site_id
     AND integration.enabled
     AND integration.provider IN ('meta', 'google', 'ga4')
     AND nullif(btrim(integration.destination_id), '') IS NOT NULL
    WHERE fact.user_id = p_user_id
      AND fact.marketing_site_id = p_marketing_site_id
      AND fact.occurred_at >= p_after
      AND fact.occurred_at < p_before
      AND public.marketing_provider_event_is_fresh(
        integration.provider,
        fact.occurred_at
      )
      AND CASE integration.provider
        WHEN 'meta' THEN fact.occurred_at - touch.first_seen_at <= interval '7 days'
        WHEN 'google' THEN fact.occurred_at - touch.first_seen_at <= interval '90 days'
        WHEN 'ga4' THEN fact.occurred_at - touch.first_seen_at <= interval '90 days'
        ELSE false
      END
      AND public.marketing_provider_consent_allowed(
        fact.user_id, fact.marketing_site_id, fact.lead_id, integration.provider
      )
      AND (
        (integration.provider = 'ga4'
          AND fact.consent_snapshot ->> 'analytics_storage' = 'granted')
        OR (integration.provider = 'google'
          AND fact.consent_snapshot ->> 'ad_user_data' = 'granted')
        OR (integration.provider = 'meta'
          AND fact.consent_snapshot ->> 'ad_user_data' = 'granted'
          AND fact.consent_snapshot ->> 'ad_personalization' = 'granted')
      )
      AND (integration.provider <> 'ga4'
        OR nullif(btrim(fact.attribution_data ->> 'ga_client_id'), '') IS NOT NULL)
      AND (integration.provider <> 'google' OR coalesce(
        nullif(btrim(fact.attribution_data ->> 'gclid'), ''),
        nullif(btrim(fact.attribution_data ->> 'gbraid'), ''),
        nullif(btrim(fact.attribution_data ->> 'wbraid'), '')
      ) IS NOT NULL)
      AND (integration.provider <> 'google' OR (
        nullif(btrim(
          integration.event_mappings -> fact.event_name ->> 'conversion_action_id'
        ), '') IS NOT NULL
        AND coalesce(
          integration.event_mappings -> fact.event_name ->> 'enabled', 'true'
        ) = 'true'
      ))
      AND (integration.provider <> 'meta'
        OR nullif(btrim(fact.attribution_data ->> 'ctwa_clid'), '') IS NULL
        OR coalesce(
          integration.event_mappings -> fact.event_name ->> 'event_name',
          integration.event_mappings ->> fact.event_name
        ) IN ('LeadSubmitted', 'Purchase'))
      AND EXISTS (
        SELECT 1
        FROM public.marketing_destination_ownership AS ownership
        WHERE ownership.user_id = integration.user_id
          AND ownership.marketing_site_id = integration.marketing_site_id
          AND ownership.integration_id = integration.id
          AND ownership.provider = integration.provider
          AND ownership.verified_at <= now()
          AND ownership.resource_key = CASE
            WHEN integration.provider = 'google' THEN lower(concat(
              regexp_replace(coalesce(integration.account_id, ''), '\D', '', 'g'),
              ':',
              btrim(integration.event_mappings -> fact.event_name ->> 'conversion_action_id')
            ))
            ELSE lower(btrim(integration.destination_id))
          END
      )
  ), actionable AS (
    SELECT eligible.*
    FROM eligible
    LEFT JOIN public.marketing_conversion_outbox AS existing
      ON existing.user_id = eligible.user_id
     AND existing.integration_id = eligible.integration_id
     AND existing.event_id = eligible.event_id
    WHERE existing.id IS NULL
       OR (
         (
           existing.status IN (
             'blocked_config', 'validation_only', 'cancelled_consent'
           )
           OR (
             existing.status = 'dead'
             AND public.marketing_dead_error_is_transient(existing.last_error)
           )
         )
         AND existing.payload_hash = eligible.payload_hash
       )
    ORDER BY eligible.occurred_at, eligible.fact_id, eligible.provider
    LIMIT safe_limit
  )
  INSERT INTO public.marketing_conversion_outbox (
    user_id, deal_id, provider, event_name, event_id, occurred_at,
    value, currency, status, integration_id, marketing_site_id,
    destination_id, account_id, conversion_action_id, provider_event_name,
    touchpoint_id, lead_id, event_source_url, consent_snapshot, user_data,
    attribution_data, event_data, payload_hash
  )
  SELECT
    user_id, deal_id, provider, event_name, event_id, occurred_at,
    value, currency, 'pending', integration_id, marketing_site_id,
    destination_id, account_id, conversion_action_id, provider_event_name,
    touchpoint_id, lead_id, event_source_url, consent_snapshot, user_data,
    attribution_data, event_data, payload_hash
  FROM actionable
  ON CONFLICT (user_id, integration_id, event_id)
    WHERE integration_id IS NOT NULL
  DO UPDATE SET
    status = 'pending',
    attempts = 0,
    next_attempt_at = now(),
    last_error = NULL,
    response = NULL,
    sent_at = NULL,
    claim_token = NULL,
    claimed_at = NULL,
    updated_at = now()
  WHERE (
      marketing_conversion_outbox.status IN (
        'blocked_config', 'validation_only', 'cancelled_consent'
      )
      OR (
        marketing_conversion_outbox.status = 'dead'
        AND public.marketing_dead_error_is_transient(
          marketing_conversion_outbox.last_error
        )
      )
    )
    AND marketing_conversion_outbox.payload_hash = EXCLUDED.payload_hash;

  GET DIAGNOSTICS replayed_count = ROW_COUNT;

  RETURN replayed_count;
END;
$$;

REVOKE ALL ON FUNCTION public.replay_marketing_conversion_facts(
  uuid, uuid, timestamptz, timestamptz, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replay_marketing_conversion_facts(
  uuid, uuid, timestamptz, timestamptz, integer
) TO service_role;

CREATE OR REPLACE FUNCTION public.purge_marketing_measurement_history(
  p_user_id uuid,
  p_marketing_site_id uuid,
  p_before timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  nonce_count integer := 0;
  outbox_count integer := 0;
  fact_count integer := 0;
  touchpoint_count integer := 0;
  consent_count integer := 0;
BEGIN
  IF p_user_id IS NULL
     OR p_marketing_site_id IS NULL
     OR p_before IS NULL
     OR p_before > now() - interval '30 days'
     OR NOT EXISTS (
       SELECT 1
       FROM public.marketing_sites AS site
       WHERE site.id = p_marketing_site_id
         AND site.user_id = p_user_id
     ) THEN
    RETURN jsonb_build_object('status', 'rejected');
  END IF;

  DELETE FROM public.marketing_bridge_nonces AS nonce
  WHERE nonce.user_id = p_user_id
    AND nonce.marketing_site_id = p_marketing_site_id
    AND nonce.expires_at < least(p_before, now() - interval '7 days');
  GET DIAGNOSTICS nonce_count = ROW_COUNT;

  DELETE FROM public.marketing_conversion_outbox AS outbox
  WHERE outbox.user_id = p_user_id
    AND outbox.marketing_site_id = p_marketing_site_id
    AND outbox.occurred_at < p_before
    AND outbox.status IN (
      'sent', 'dead', 'blocked_config', 'cancelled_consent',
      'validation_only', 'accepted_unverified'
    );
  GET DIAGNOSTICS outbox_count = ROW_COUNT;

  DELETE FROM public.marketing_conversion_facts AS fact
  WHERE fact.user_id = p_user_id
    AND fact.marketing_site_id = p_marketing_site_id
    AND fact.occurred_at < p_before
    AND NOT EXISTS (
      SELECT 1
      FROM public.marketing_conversion_outbox AS outbox
      WHERE outbox.user_id = fact.user_id
        AND outbox.marketing_site_id = fact.marketing_site_id
        AND outbox.event_id = fact.event_id
    );
  GET DIAGNOSTICS fact_count = ROW_COUNT;

  DELETE FROM public.marketing_touchpoints AS touch
  WHERE touch.user_id = p_user_id
    AND touch.marketing_site_id = p_marketing_site_id
    AND touch.last_seen_at < p_before
    AND NOT EXISTS (
      SELECT 1
      FROM public.marketing_conversion_facts AS fact
      WHERE fact.user_id = touch.user_id
        AND fact.marketing_site_id = touch.marketing_site_id
        AND fact.touchpoint_id = touch.id
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.marketing_conversion_outbox AS outbox
      WHERE outbox.user_id = touch.user_id
        AND outbox.marketing_site_id = touch.marketing_site_id
        AND outbox.touchpoint_id = touch.id
    );
  GET DIAGNOSTICS touchpoint_count = ROW_COUNT;

  DELETE FROM public.marketing_consent_ledger AS ledger
  WHERE ledger.user_id = p_user_id
    AND ledger.marketing_site_id = p_marketing_site_id
    AND ledger.occurred_at < p_before
    AND (
      EXISTS (
        SELECT 1
        FROM public.marketing_consent_ledger AS newer
        WHERE newer.user_id = ledger.user_id
          AND newer.marketing_site_id = ledger.marketing_site_id
          AND newer.lead_id = ledger.lead_id
          AND newer.consent_type = ledger.consent_type
          AND (newer.occurred_at, newer.id) > (ledger.occurred_at, ledger.id)
      )
      OR (
        NOT EXISTS (
          SELECT 1
          FROM public.marketing_touchpoints AS touch
          WHERE touch.user_id = ledger.user_id
            AND touch.marketing_site_id = ledger.marketing_site_id
            AND touch.lead_id = ledger.lead_id
        )
        AND NOT EXISTS (
          SELECT 1
          FROM public.marketing_conversion_facts AS fact
          WHERE fact.user_id = ledger.user_id
            AND fact.marketing_site_id = ledger.marketing_site_id
            AND fact.lead_id = ledger.lead_id
        )
        AND NOT EXISTS (
          SELECT 1
          FROM public.marketing_conversion_outbox AS outbox
          WHERE outbox.user_id = ledger.user_id
            AND outbox.marketing_site_id = ledger.marketing_site_id
            AND outbox.lead_id = ledger.lead_id
        )
      )
    );
  GET DIAGNOSTICS consent_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'status', 'purged',
    'nonces', nonce_count,
    'outbox', outbox_count,
    'facts', fact_count,
    'touchpoints', touchpoint_count,
    'consent_entries', consent_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.purge_marketing_measurement_history(
  uuid, uuid, timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_marketing_measurement_history(
  uuid, uuid, timestamptz
) TO service_role;

CREATE OR REPLACE FUNCTION public.enqueue_marketing_deal_event(
  p_user_id uuid,
  p_deal_id bigint,
  p_lead_id uuid,
  p_event_name text,
  p_occurred_at timestamptz,
  p_value numeric,
  p_contact_phone text,
  p_contact_email text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  touchpoint_id bigint;
  resolved_lead_id uuid;
BEGIN
  SELECT touch.id, touch.lead_id
  INTO touchpoint_id, resolved_lead_id
  FROM public.marketing_touchpoints AS touch
  JOIN public.marketing_sites AS site
    ON site.id = touch.marketing_site_id
   AND site.user_id = touch.user_id
   AND site.enabled
   AND site.measurement_enabled
  WHERE touch.user_id = p_user_id
    AND (
      touch.deal_id = p_deal_id
      OR (p_lead_id IS NOT NULL AND touch.lead_id = p_lead_id)
    )
    AND touch.first_seen_at <= p_occurred_at + interval '5 minutes'
    AND touch.first_seen_at >= p_occurred_at - interval '180 days'
  ORDER BY
    (touch.deal_id = p_deal_id) DESC,
    touch.last_seen_at DESC,
    touch.id DESC
  LIMIT 1;

  IF NOT FOUND OR resolved_lead_id IS NULL THEN
    RETURN 0;
  END IF;

  RETURN public.enqueue_marketing_event(
    p_user_id,
    p_deal_id,
    touchpoint_id,
    coalesce(p_lead_id, resolved_lead_id),
    p_event_name,
    concat('lead:', coalesce(p_lead_id, resolved_lead_id), ':', lower(p_event_name)),
    p_occurred_at,
    p_value,
    p_contact_phone,
    p_contact_email
  );
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_marketing_deal_event(
  uuid, bigint, uuid, text, timestamptz, numeric, text, text
) FROM PUBLIC, anon, authenticated;

DROP FUNCTION IF EXISTS public.capture_marketing_whatsapp_contact(
  uuid, text, text, text, text, timestamptz, text, text
);
DROP FUNCTION IF EXISTS public.capture_marketing_whatsapp_contact(
  uuid, text, text, text, text, timestamptz, text, text, jsonb
);

CREATE OR REPLACE FUNCTION public.capture_marketing_whatsapp_contact(
  p_user_id uuid,
  p_phone text,
  p_wa_number text,
  p_message_id text,
  p_message_body text,
  p_occurred_at timestamptz,
  p_ctwa_clid text DEFAULT NULL,
  p_waba_id text DEFAULT NULL,
  p_referral_attribution jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE (
  result_status text,
  touchpoint_id bigint,
  lead_id uuid,
  deal_id bigint,
  match_strategy text,
  queued_provider_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  bridge_match text[];
  bridge_hash text;
  phone_e164 text;
  phone_key text;
  candidate_leads uuid[];
  candidate_deals bigint[];
  resolved_lead_id uuid;
  resolved_deal_id bigint;
  resolved_strategy text := 'new_unattributed';
  source_touchpoint public.marketing_touchpoints%ROWTYPE;
  contact_touchpoint public.marketing_touchpoints%ROWTYPE;
  message_was_known boolean := false;
  provider_count integer := 0;
  channel_e164 text;
  acquisition_site_id uuid;
  linked_deal_count integer := 0;
  safe_referral jsonb := '{}'::jsonb;
BEGIN
  phone_e164 := public.marketing_brazil_e164(p_phone);
  channel_e164 := public.marketing_brazil_e164(p_wa_number);
  phone_key := public.marketing_phone_key(phone_e164);
  IF p_user_id IS NULL
     OR phone_e164 IS NULL
     OR channel_e164 IS NULL
     OR nullif(btrim(p_message_id), '') IS NULL
     OR p_occurred_at IS NULL
     OR p_occurred_at < now() - interval '7 days'
     OR p_occurred_at > now() + interval '5 minutes' THEN
    RAISE EXCEPTION 'MARKETING_CONTACT_IDENTIFIERS_REQUIRED';
  END IF;

  IF jsonb_typeof(p_referral_attribution) = 'object' THEN
    safe_referral := jsonb_strip_nulls(jsonb_build_object(
      'source_url', CASE
        WHEN p_referral_attribution ->> 'source_url'
          ~ '^https?://[A-Za-z0-9.-]+(:[0-9]{1,5})?$'
        THEN left(p_referral_attribution ->> 'source_url', 500)
        ELSE NULL
      END,
      'ad_id', CASE
        WHEN p_referral_attribution ->> 'ad_id' ~ '^[A-Za-z0-9._:-]{1,255}$'
        THEN left(p_referral_attribution ->> 'ad_id', 255)
        ELSE NULL
      END,
      'source_type', CASE
        WHEN p_referral_attribution ->> 'source_type' ~ '^[A-Za-z0-9_-]{1,100}$'
        THEN p_referral_attribution ->> 'source_type'
        ELSE NULL
      END,
      'media_type', CASE
        WHEN p_referral_attribution ->> 'media_type' ~ '^[A-Za-z0-9_-]{1,100}$'
        THEN p_referral_attribution ->> 'media_type'
        ELSE NULL
      END
    ));
  END IF;

  SELECT site.id
  INTO acquisition_site_id
  FROM public.marketing_sites AS site
  JOIN public.marketing_acquisition_channels AS acquisition
    ON acquisition.marketing_site_id = site.id
   AND acquisition.user_id = site.user_id
   AND acquisition.channel = 'whatsapp'
   AND acquisition.external_account_id = channel_e164
   AND acquisition.enabled
  WHERE site.user_id = p_user_id
    AND site.enabled
    AND site.measurement_enabled
  LIMIT 1;

  IF acquisition_site_id IS NULL THEN
    RETURN QUERY
    SELECT
      'disabled'::text,
      NULL::bigint,
      NULL::uuid,
      NULL::bigint,
      'tenant_or_channel_disabled'::text,
      0::integer;
    RETURN;
  END IF;

  -- Serializa mensagens simultâneas da mesma conversa sem bloquear outros
  -- tenants, números de aquisição ou contatos.
  PERFORM pg_advisory_xact_lock(hashtextextended(
    concat_ws(':', p_user_id::text, phone_key),
    0
  ));

  -- O corpo é usado somente em memória para extrair REF:<token>. Ele nunca é
  -- gravado em touchpoint, metadata, outbox ou retorno desta RPC.
  bridge_match := regexp_match(
    coalesce(p_message_body, ''),
    'ref[[:space:]]*:[[:space:]]*([A-Za-z0-9_-]{8,64})',
    'i'
  );
  IF bridge_match IS NOT NULL THEN
    bridge_hash := public.marketing_identity_hash(bridge_match[1]);

    SELECT touch.*
    INTO source_touchpoint
    FROM public.marketing_touchpoints AS touch
    WHERE touch.user_id = p_user_id
      AND touch.channel = 'website'
      AND touch.marketing_site_id = acquisition_site_id
      AND touch.bridge_reference_hash = bridge_hash
      AND touch.last_seen_at >= p_occurred_at - interval '180 days'
      AND touch.last_seen_at <= p_occurred_at + interval '5 minutes'
    LIMIT 1;

    IF FOUND THEN
      resolved_lead_id := source_touchpoint.lead_id;
      resolved_deal_id := source_touchpoint.deal_id;
      resolved_strategy := 'bridge_reference';
    END IF;
  END IF;

  IF resolved_lead_id IS NULL AND nullif(btrim(p_ctwa_clid), '') IS NOT NULL THEN
    SELECT array_agg(candidate.lead_id)
    INTO candidate_leads
    FROM (
      SELECT DISTINCT touch.lead_id
      FROM public.marketing_touchpoints AS touch
      WHERE touch.user_id = p_user_id
        AND touch.ctwa_clid = p_ctwa_clid
        AND touch.marketing_site_id = acquisition_site_id
        AND (
          touch.channel <> 'whatsapp'
          OR public.marketing_brazil_e164(touch.wa_number) = channel_e164
        )
        AND touch.lead_id IS NOT NULL
        AND touch.last_seen_at >= p_occurred_at - interval '180 days'
        AND touch.last_seen_at <= p_occurred_at + interval '5 minutes'
      LIMIT 2
    ) AS candidate;

    IF coalesce(cardinality(candidate_leads), 0) = 1 THEN
      resolved_lead_id := candidate_leads[1];
      resolved_strategy := 'ctwa_clid';
    END IF;
  END IF;

  IF resolved_lead_id IS NULL THEN
    SELECT array_agg(candidate.lead_id)
    INTO candidate_leads
    FROM (
      SELECT DISTINCT touch.lead_id
      FROM public.marketing_touchpoints AS touch
      WHERE touch.user_id = p_user_id
        AND touch.lead_id IS NOT NULL
        AND public.marketing_phone_key(touch.phone) = phone_key
        AND touch.marketing_site_id = acquisition_site_id
        AND (
          touch.channel <> 'whatsapp'
          OR public.marketing_brazil_e164(touch.wa_number) = channel_e164
        )
        AND touch.last_seen_at >= p_occurred_at - interval '180 days'
        AND touch.last_seen_at <= p_occurred_at + interval '5 minutes'
      LIMIT 2
    ) AS candidate;

    IF coalesce(cardinality(candidate_leads), 0) = 1 THEN
      resolved_lead_id := candidate_leads[1];
      resolved_strategy := 'unique_phone';
    END IF;
  END IF;

  resolved_lead_id := coalesce(resolved_lead_id, gen_random_uuid());

  IF source_touchpoint.id IS NULL THEN
    SELECT touch.*
    INTO source_touchpoint
    FROM public.marketing_touchpoints AS touch
    WHERE touch.user_id = p_user_id
      AND touch.lead_id = resolved_lead_id
      AND touch.marketing_site_id = acquisition_site_id
      AND (
        touch.channel <> 'whatsapp'
        OR public.marketing_brazil_e164(touch.wa_number) = channel_e164
      )
      AND touch.last_seen_at >= p_occurred_at - interval '180 days'
      AND touch.last_seen_at <= p_occurred_at + interval '5 minutes'
    ORDER BY touch.last_seen_at DESC, touch.id DESC
    LIMIT 1;
  END IF;

  resolved_deal_id := coalesce(resolved_deal_id, source_touchpoint.deal_id);

  IF resolved_deal_id IS NULL THEN
    SELECT deal.id
    INTO resolved_deal_id
    FROM public.deals AS deal
    WHERE deal.user_id = p_user_id
      AND deal.marketing_lead_id = resolved_lead_id
    LIMIT 1;
  END IF;

  IF resolved_deal_id IS NULL THEN
    SELECT array_agg(candidate.id)
    INTO candidate_deals
    FROM (
      SELECT DISTINCT deal.id
      FROM public.deals AS deal
      WHERE deal.user_id = p_user_id
        AND deal.converted_at IS NULL
        AND public.marketing_phone_key(deal.contact_phone) = phone_key
        AND deal.updated_at >= p_occurred_at - interval '180 days'
        AND deal.updated_at <= p_occurred_at + interval '5 minutes'
      LIMIT 2
    ) AS candidate;

    IF coalesce(cardinality(candidate_deals), 0) = 1 THEN
      resolved_deal_id := candidate_deals[1];
    END IF;
  END IF;

  IF resolved_deal_id IS NOT NULL THEN
    UPDATE public.deals
    SET marketing_lead_id = resolved_lead_id
    WHERE id = resolved_deal_id
      AND user_id = p_user_id
      AND (marketing_lead_id IS NULL OR marketing_lead_id = resolved_lead_id);

    GET DIAGNOSTICS linked_deal_count = ROW_COUNT;
    IF linked_deal_count <> 1 THEN
      resolved_deal_id := NULL;
    END IF;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.marketing_touchpoints AS touch
    WHERE touch.user_id = p_user_id
      AND touch.channel = 'whatsapp'
      AND touch.marketing_site_id = acquisition_site_id
      AND public.marketing_brazil_e164(touch.wa_number) = channel_e164
      AND touch.external_event_id = left(btrim(p_message_id), 500)
  ) INTO message_was_known;

  INSERT INTO public.marketing_touchpoints (
    user_id,
    deal_id,
    marketing_site_id,
    lead_id,
    channel,
    source,
    external_event_id,
    phone,
    wa_number,
    source_url,
    ctwa_clid,
    gclid,
    gbraid,
    wbraid,
    fbclid,
    fbc,
    fbp,
    utm_source,
    utm_medium,
    utm_campaign,
    utm_content,
    utm_term,
    ad_id,
    adset_id,
    campaign_external_id,
    consent_status,
    consent_snapshot,
    bridge_payload_hash,
    bridge_reference_hash,
    ga_client_id,
    ga_session_id,
    client_user_agent,
    whatsapp_business_account_id,
    contact_confirmed_at,
    metadata,
    first_seen_at,
    last_seen_at
  )
  VALUES (
    p_user_id,
    resolved_deal_id,
    coalesce(source_touchpoint.marketing_site_id, acquisition_site_id),
    resolved_lead_id,
    'whatsapp',
    CASE
      WHEN resolved_strategy = 'bridge_reference' THEN 'website_whatsapp_message'
      WHEN nullif(btrim(p_ctwa_clid), '') IS NOT NULL THEN 'meta_click_to_whatsapp'
      ELSE 'whatsapp_inbound'
    END,
    left(btrim(p_message_id), 500),
    phone_e164,
    channel_e164,
    coalesce(source_touchpoint.source_url, safe_referral ->> 'source_url'),
    left(nullif(btrim(p_ctwa_clid), ''), 500),
    source_touchpoint.gclid,
    source_touchpoint.gbraid,
    source_touchpoint.wbraid,
    source_touchpoint.fbclid,
    source_touchpoint.fbc,
    source_touchpoint.fbp,
    source_touchpoint.utm_source,
    source_touchpoint.utm_medium,
    source_touchpoint.utm_campaign,
    source_touchpoint.utm_content,
    source_touchpoint.utm_term,
    coalesce(source_touchpoint.ad_id, safe_referral ->> 'ad_id'),
    source_touchpoint.adset_id,
    source_touchpoint.campaign_external_id,
    coalesce(source_touchpoint.consent_status, 'unknown'),
    CASE
      WHEN source_touchpoint.id IS NOT NULL
      THEN source_touchpoint.consent_snapshot
      ELSE jsonb_build_object(
        'status', 'unknown',
        'analytics_storage', 'unknown',
        'ad_storage', 'unknown',
        'ad_user_data', 'unknown',
        'ad_personalization', 'unknown',
        'captured_at', p_occurred_at,
        'source', 'whatsapp_inbound'
      )
    END,
    source_touchpoint.bridge_payload_hash,
    bridge_hash,
    source_touchpoint.ga_client_id,
    source_touchpoint.ga_session_id,
    source_touchpoint.client_user_agent,
    left(nullif(btrim(p_waba_id), ''), 200),
    p_occurred_at,
    jsonb_strip_nulls(jsonb_build_object(
      'capture', 'server_webhook',
      'match_strategy', resolved_strategy,
      'referral_source_type', safe_referral ->> 'source_type',
      'referral_media_type', safe_referral ->> 'media_type'
    )),
    p_occurred_at,
    p_occurred_at
  )
  ON CONFLICT (
    user_id, event_scope_key, channel, external_event_id
  ) DO UPDATE
  SET deal_id = coalesce(marketing_touchpoints.deal_id, EXCLUDED.deal_id),
      marketing_site_id = coalesce(
        marketing_touchpoints.marketing_site_id,
        EXCLUDED.marketing_site_id
      ),
      lead_id = CASE
        WHEN marketing_touchpoints.deal_id IS NULL
          AND resolved_strategy = 'bridge_reference'
        THEN EXCLUDED.lead_id
        ELSE marketing_touchpoints.lead_id
      END,
      wa_number = EXCLUDED.wa_number,
      source_url = coalesce(marketing_touchpoints.source_url, EXCLUDED.source_url),
      ctwa_clid = coalesce(marketing_touchpoints.ctwa_clid, EXCLUDED.ctwa_clid),
      ad_id = coalesce(marketing_touchpoints.ad_id, EXCLUDED.ad_id),
      metadata = marketing_touchpoints.metadata || EXCLUDED.metadata,
      consent_status = CASE
        WHEN marketing_touchpoints.consent_status = 'unknown'
        THEN EXCLUDED.consent_status
        ELSE marketing_touchpoints.consent_status
      END,
      consent_snapshot = CASE
        WHEN marketing_touchpoints.consent_status = 'unknown'
          AND EXCLUDED.consent_status = 'granted'
        THEN EXCLUDED.consent_snapshot
        ELSE marketing_touchpoints.consent_snapshot
      END,
      contact_confirmed_at = coalesce(
        marketing_touchpoints.contact_confirmed_at,
        EXCLUDED.contact_confirmed_at
      ),
      whatsapp_business_account_id = coalesce(
        marketing_touchpoints.whatsapp_business_account_id,
        EXCLUDED.whatsapp_business_account_id
      ),
      last_seen_at = greatest(marketing_touchpoints.last_seen_at, EXCLUDED.last_seen_at),
      updated_at = now()
  RETURNING * INTO contact_touchpoint;

  -- A chamada explícita cobre upgrades de consentimento; o trigger cobre
  -- inserts normais. A chave (tenant, integração, event_id) torna ambos seguros.
  PERFORM public.enqueue_marketing_event(
    contact_touchpoint.user_id,
    contact_touchpoint.deal_id,
    contact_touchpoint.id,
    contact_touchpoint.lead_id,
    'Contact',
    concat('lead:', contact_touchpoint.lead_id, ':contact'),
    contact_touchpoint.contact_confirmed_at,
    0,
    contact_touchpoint.phone,
    NULL
  );

  SELECT count(*)::integer
  INTO provider_count
  FROM public.marketing_conversion_outbox AS outbox
  WHERE outbox.user_id = contact_touchpoint.user_id
    AND outbox.event_id = concat('lead:', contact_touchpoint.lead_id, ':contact')
    AND outbox.event_name = 'Contact';

  RETURN QUERY
  SELECT
    CASE WHEN message_was_known THEN 'duplicate' ELSE 'captured' END,
    contact_touchpoint.id,
    contact_touchpoint.lead_id,
    contact_touchpoint.deal_id,
    resolved_strategy,
    provider_count;
END;
$$;

REVOKE ALL ON FUNCTION public.capture_marketing_whatsapp_contact(
  uuid, text, text, text, text, timestamptz, text, text, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.capture_marketing_whatsapp_contact(
  uuid, text, text, text, text, timestamptz, text, text, jsonb
) TO service_role;

CREATE OR REPLACE FUNCTION public.link_pending_marketing_touchpoints()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  phone_key text;
  candidate_ids uuid[];
  candidate_lead_id uuid;
  linked_deal_count integer := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.marketing_sites AS site
    WHERE site.user_id = new.user_id
      AND site.enabled
      AND site.measurement_enabled
  ) THEN
    RETURN new;
  END IF;

  IF new.marketing_lead_id IS NOT NULL THEN
    UPDATE public.marketing_touchpoints
    SET deal_id = new.id,
        updated_at = now()
    WHERE user_id = new.user_id
      AND lead_id = new.marketing_lead_id
      AND (deal_id IS NULL OR deal_id = new.id);
    RETURN new;
  END IF;

  phone_key := public.marketing_phone_key(new.contact_phone);
  IF phone_key IS NULL THEN
    RETURN new;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    concat_ws(':', new.user_id::text, phone_key),
    0
  ));

  SELECT array_agg(candidate.lead_id)
  INTO candidate_ids
  FROM (
    SELECT DISTINCT touch.lead_id
    FROM public.marketing_touchpoints AS touch
    JOIN public.marketing_sites AS site
      ON site.id = touch.marketing_site_id
     AND site.user_id = touch.user_id
     AND site.enabled
     AND site.measurement_enabled
    WHERE touch.user_id = new.user_id
      AND touch.deal_id IS NULL
      AND touch.lead_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.deals AS linked
        WHERE linked.user_id = new.user_id
          AND linked.marketing_lead_id = touch.lead_id
          AND linked.id <> new.id
      )
      AND public.marketing_phone_key(touch.phone) = phone_key
      AND touch.last_seen_at >= now() - interval '180 days'
    LIMIT 2
  ) AS candidate;

  -- Fail closed: zero ou mais de um lead possível não autoriza vínculo por
  -- telefone. Nenhum "mais recente" é escolhido por conveniência.
  IF coalesce(cardinality(candidate_ids), 0) <> 1 THEN
    RETURN new;
  END IF;

  candidate_lead_id := candidate_ids[1];

  BEGIN
    UPDATE public.deals
    SET marketing_lead_id = candidate_lead_id
    WHERE id = new.id
      AND user_id = new.user_id
      AND marketing_lead_id IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.deals AS linked
        WHERE linked.user_id = new.user_id
          AND linked.marketing_lead_id = candidate_lead_id
          AND linked.id <> new.id
      );
    GET DIAGNOSTICS linked_deal_count = ROW_COUNT;
  EXCEPTION WHEN unique_violation THEN
    RETURN new;
  END;

  IF linked_deal_count <> 1 THEN
    RETURN new;
  END IF;

  UPDATE public.marketing_touchpoints
  SET deal_id = new.id,
      updated_at = now()
  WHERE user_id = new.user_id
    AND lead_id = candidate_lead_id
    AND deal_id IS NULL;

  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS deals_link_marketing_touchpoints ON public.deals;
DROP TRIGGER IF EXISTS deals_aa_link_marketing_touchpoints ON public.deals;
CREATE TRIGGER deals_aa_link_marketing_touchpoints
AFTER INSERT OR UPDATE OF contact_phone, marketing_lead_id ON public.deals
FOR EACH ROW
EXECUTE FUNCTION public.link_pending_marketing_touchpoints();

CREATE OR REPLACE FUNCTION public.queue_confirmed_contact_conversions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  confirmed_at timestamptz;
  fact_already_recorded boolean := false;
BEGIN
  confirmed_at := new.contact_confirmed_at;

  IF confirmed_at IS NULL
     AND new.channel = 'whatsapp'
     AND new.source = 'meta_click_to_whatsapp'
     AND new.external_event_id IS NOT NULL THEN
    confirmed_at := new.first_seen_at;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.marketing_conversion_facts AS fact
    WHERE fact.user_id = new.user_id
      AND fact.marketing_site_id = new.marketing_site_id
      AND fact.event_id = concat('lead:', new.lead_id, ':contact')
  ) INTO fact_already_recorded;

  IF confirmed_at IS NULL OR new.lead_id IS NULL OR fact_already_recorded THEN
    RETURN new;
  END IF;

  PERFORM public.enqueue_marketing_event(
    new.user_id,
    new.deal_id,
    new.id,
    new.lead_id,
    'Contact',
    concat('lead:', new.lead_id, ':contact'),
    confirmed_at,
    0,
    new.phone,
    NULL
  );

  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS marketing_touchpoints_queue_confirmed_contact
  ON public.marketing_touchpoints;
CREATE TRIGGER marketing_touchpoints_queue_confirmed_contact
AFTER INSERT OR UPDATE OF contact_confirmed_at, consent_status, consent_snapshot, lead_id
ON public.marketing_touchpoints
FOR EACH ROW
EXECUTE FUNCTION public.queue_confirmed_contact_conversions();

CREATE OR REPLACE FUNCTION public.queue_mapped_stage_conversions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  mapped_event text;
BEGIN
  IF TG_OP = 'UPDATE'
     AND old.stage IS NOT DISTINCT FROM new.stage
     AND NOT (
       old.marketing_lead_id IS NULL
       AND new.marketing_lead_id IS NOT NULL
     ) THEN
    RETURN new;
  END IF;

  -- Por enquanto apenas Lead é acionável por etapa. Outros nomes permanecem
  -- reservados no schema para evolução explícita, nunca por inferência.
  SELECT mapping.event_name
  INTO mapped_event
  FROM public.marketing_stage_event_mappings AS mapping
  WHERE mapping.user_id = new.user_id
    AND mapping.stage_id = new.stage::text
    AND mapping.event_name = 'Lead'
    AND mapping.enabled
  LIMIT 1;

  IF mapped_event IS NULL THEN
    RETURN new;
  END IF;

  PERFORM public.enqueue_marketing_deal_event(
    new.user_id,
    new.id,
    new.marketing_lead_id,
    mapped_event,
    now(),
    greatest(coalesce(new.value, 0), 0),
    new.contact_phone,
    new.contact_email
  );

  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS deals_queue_lead_conversions ON public.deals;
DROP TRIGGER IF EXISTS deals_bb_queue_mapped_stage_conversions ON public.deals;
CREATE TRIGGER deals_bb_queue_mapped_stage_conversions
AFTER INSERT OR UPDATE OF stage, marketing_lead_id ON public.deals
FOR EACH ROW
EXECUTE FUNCTION public.queue_mapped_stage_conversions();

CREATE OR REPLACE FUNCTION public.queue_deal_schedule_conversions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  job_status text;
BEGIN
  IF new.converted_job_id IS NULL THEN
    RETURN new;
  END IF;

  IF TG_OP = 'UPDATE'
     AND old.converted_job_id IS NOT DISTINCT FROM new.converted_job_id
     AND NOT (
       old.marketing_lead_id IS NULL
       AND new.marketing_lead_id IS NOT NULL
     ) THEN
    RETURN new;
  END IF;

  SELECT job.status
  INTO job_status
  FROM public.jobs AS job
  WHERE job.id = new.converted_job_id
    AND job.user_id = new.user_id
  LIMIT 1;

  IF job_status <> 'scheduled' THEN
    RETURN new;
  END IF;

  PERFORM public.enqueue_marketing_deal_event(
    new.user_id,
    new.id,
    new.marketing_lead_id,
    'Schedule',
    now(),
    greatest(coalesce(new.value, 0), 0),
    new.contact_phone,
    new.contact_email
  );

  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS deals_queue_schedule_conversions ON public.deals;
CREATE TRIGGER deals_queue_schedule_conversions
AFTER INSERT OR UPDATE OF converted_job_id, marketing_lead_id ON public.deals
FOR EACH ROW
EXECUTE FUNCTION public.queue_deal_schedule_conversions();

CREATE OR REPLACE FUNCTION public.queue_job_schedule_conversions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  deal_row record;
BEGIN
  IF new.status <> 'scheduled'
     OR (TG_OP = 'UPDATE' AND old.status IS NOT DISTINCT FROM new.status) THEN
    RETURN new;
  END IF;

  FOR deal_row IN
    SELECT
      deal.id,
      deal.user_id,
      deal.marketing_lead_id,
      deal.value,
      deal.contact_phone,
      deal.contact_email
    FROM public.deals AS deal
    WHERE deal.user_id = new.user_id
      AND deal.converted_job_id = new.id
  LOOP
    PERFORM public.enqueue_marketing_deal_event(
      deal_row.user_id,
      deal_row.id,
      deal_row.marketing_lead_id,
      'Schedule',
      now(),
      greatest(coalesce(deal_row.value, 0), 0),
      deal_row.contact_phone,
      deal_row.contact_email
    );
  END LOOP;

  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS jobs_queue_schedule_conversions ON public.jobs;
CREATE TRIGGER jobs_queue_schedule_conversions
AFTER INSERT OR UPDATE OF status ON public.jobs
FOR EACH ROW
EXECUTE FUNCTION public.queue_job_schedule_conversions();

CREATE OR REPLACE FUNCTION public.queue_deal_purchase_conversions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF new.converted_at IS NULL THEN
    RETURN new;
  END IF;

  IF TG_OP = 'UPDATE'
     AND old.converted_at IS NOT NULL
     AND NOT (
       old.marketing_lead_id IS NULL
       AND new.marketing_lead_id IS NOT NULL
     ) THEN
    RETURN new;
  END IF;

  PERFORM public.enqueue_marketing_deal_event(
    new.user_id,
    new.id,
    new.marketing_lead_id,
    'Purchase',
    new.converted_at,
    greatest(coalesce(new.value, 0), 0),
    new.contact_phone,
    new.contact_email
  );

  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS deals_queue_purchase_conversions ON public.deals;
CREATE TRIGGER deals_queue_purchase_conversions
AFTER INSERT OR UPDATE OF converted_at, marketing_lead_id ON public.deals
FOR EACH ROW
EXECUTE FUNCTION public.queue_deal_purchase_conversions();

CREATE OR REPLACE FUNCTION public.guard_marketing_outbox_integration()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  integration public.marketing_integrations%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE'
     AND new.status = 'blocked_config'
     AND old.integration_id IS NOT DISTINCT FROM new.integration_id
     AND old.marketing_site_id IS NOT DISTINCT FROM new.marketing_site_id
     AND old.user_id IS NOT DISTINCT FROM new.user_id
     AND old.provider IS NOT DISTINCT FROM new.provider
     AND old.destination_id IS NOT DISTINCT FROM new.destination_id THEN
    RETURN new;
  END IF;

  -- Linhas legadas (anteriores à ponte v2) não possuem nenhum dos dois
  -- vínculos. A migration não as reclassifica nem interrompe workers antigos.
  IF new.integration_id IS NULL AND new.marketing_site_id IS NULL THEN
    RETURN new;
  END IF;

  IF new.integration_id IS NULL
     OR new.marketing_site_id IS NULL
     OR nullif(btrim(new.destination_id), '') IS NULL THEN
    IF public.marketing_outbox_status_requires_delivery(
      new.status,
      new.provider
    ) THEN
      new.status := 'blocked_config';
      new.last_error := 'DESTINATION_CONFIGURATION_REQUIRED';
    END IF;
    RETURN new;
  END IF;

  SELECT config.*
  INTO integration
  FROM public.marketing_integrations AS config
  WHERE config.id = new.integration_id
    AND config.user_id = new.user_id;

  IF NOT FOUND
     OR integration.provider IS DISTINCT FROM new.provider
     OR integration.marketing_site_id IS DISTINCT FROM new.marketing_site_id
     OR btrim(integration.destination_id) IS DISTINCT FROM btrim(new.destination_id) THEN
    RAISE EXCEPTION 'MARKETING_INTEGRATION_TENANT_MISMATCH';
  END IF;

  IF NOT integration.enabled
     AND public.marketing_outbox_status_requires_delivery(
       new.status,
       new.provider
     ) THEN
    new.status := 'blocked_config';
    new.last_error := 'INTEGRATION_DISABLED';
  END IF;

  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS marketing_outbox_guard_integration
  ON public.marketing_conversion_outbox;
CREATE TRIGGER marketing_outbox_guard_integration
BEFORE INSERT OR UPDATE OF integration_id, marketing_site_id, user_id, provider, destination_id, status
ON public.marketing_conversion_outbox
FOR EACH ROW
EXECUTE FUNCTION public.guard_marketing_outbox_integration();

DROP FUNCTION IF EXISTS public.claim_marketing_conversion_outbox(
  integer, integer
);

CREATE OR REPLACE FUNCTION public.claim_marketing_conversion_outbox(
  p_limit integer,
  p_lease_seconds integer,
  p_user_ids uuid[]
)
RETURNS SETOF public.marketing_conversion_outbox
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  batch_token uuid := gen_random_uuid();
  safe_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  safe_lease interval := make_interval(
    secs => least(greatest(coalesce(p_lease_seconds, 300), 30), 1800)
  );
  safe_user_ids uuid[] := coalesce(p_user_ids, '{}'::uuid[]);
BEGIN
  IF cardinality(safe_user_ids) = 0 THEN
    RETURN;
  END IF;

  -- Revogação/negação atual cancela somente entregas ainda não enviadas.
  -- Requests Google já aceitos continuam apenas em polling de status.
  UPDATE public.marketing_conversion_outbox AS outbox
  SET status = 'cancelled_consent',
      last_error = 'CURRENT_CONSENT_NOT_GRANTED',
      claim_token = NULL,
      claimed_at = NULL,
      updated_at = now()
  WHERE (
      outbox.status IN ('pending', 'retry', 'validation_only')
      OR (
        outbox.status = 'processing'
        AND outbox.claimed_at < now() - safe_lease
      )
    )
    AND outbox.user_id = ANY (safe_user_ids)
    AND outbox.marketing_site_id IS NOT NULL
    AND outbox.integration_id IS NOT NULL
    AND outbox.lead_id IS NOT NULL
    AND NOT public.marketing_provider_consent_allowed(
      outbox.user_id,
      outbox.marketing_site_id,
      outbox.lead_id,
      outbox.provider
    );

  UPDATE public.marketing_conversion_outbox AS outbox
  SET status = 'blocked_config',
      last_error = 'DESTINATION_CONFIGURATION_REQUIRED',
      claim_token = NULL,
      claimed_at = NULL,
      updated_at = now()
  WHERE public.marketing_outbox_status_requires_delivery(
      outbox.status,
      outbox.provider
    )
    AND outbox.user_id = ANY (safe_user_ids)
    AND outbox.marketing_site_id IS NOT NULL
    AND outbox.integration_id IS NOT NULL
    AND outbox.lead_id IS NOT NULL
    AND (
      outbox.status <> 'processing'
      OR outbox.claimed_at < now() - safe_lease
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.marketing_integrations AS integration
      JOIN public.marketing_sites AS site
        ON site.id = integration.marketing_site_id
       AND site.user_id = integration.user_id
      WHERE integration.id = outbox.integration_id
        AND integration.user_id = outbox.user_id
        AND integration.provider = outbox.provider
        AND integration.marketing_site_id = outbox.marketing_site_id
        AND integration.enabled
        AND site.enabled
        AND site.measurement_enabled
        AND nullif(btrim(integration.destination_id), '') IS NOT NULL
        AND btrim(integration.destination_id)
          IS NOT DISTINCT FROM btrim(outbox.destination_id)
        AND btrim(coalesce(integration.account_id, ''))
          IS NOT DISTINCT FROM btrim(coalesce(outbox.account_id, ''))
        AND btrim(coalesce(public.marketing_conversion_action_id(
          integration.provider,
          integration.event_mappings,
          outbox.event_name,
          integration.conversion_action_id
        ), '')) IS NOT DISTINCT FROM btrim(coalesce(outbox.conversion_action_id, ''))
        AND btrim(coalesce(public.marketing_provider_event_name(
          integration.provider,
          integration.event_mappings,
          outbox.event_name,
          nullif(btrim(outbox.attribution_data ->> 'ctwa_clid'), '') IS NOT NULL
        ), '')) IS NOT DISTINCT FROM btrim(coalesce(outbox.provider_event_name, ''))
    );

  UPDATE public.marketing_conversion_outbox AS outbox
  SET status = 'blocked_config',
      last_error = 'DESTINATION_OWNERSHIP_NOT_VERIFIED',
      claim_token = NULL,
      claimed_at = NULL,
      updated_at = now()
  WHERE public.marketing_outbox_status_requires_delivery(
      outbox.status,
      outbox.provider
    )
    AND outbox.user_id = ANY (safe_user_ids)
    AND outbox.marketing_site_id IS NOT NULL
    AND outbox.integration_id IS NOT NULL
    AND outbox.lead_id IS NOT NULL
    AND (
      outbox.status <> 'processing'
      OR outbox.claimed_at < now() - safe_lease
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.marketing_destination_ownership AS ownership
      WHERE ownership.user_id = outbox.user_id
        AND ownership.marketing_site_id = outbox.marketing_site_id
        AND ownership.integration_id = outbox.integration_id
        AND ownership.provider = outbox.provider
        AND ownership.verified_at <= now()
        AND ownership.resource_key = CASE
          WHEN outbox.provider = 'google' THEN lower(concat(
            regexp_replace(coalesce(outbox.account_id, ''), '\D', '', 'g'),
            ':',
            btrim(coalesce(outbox.conversion_action_id, ''))
          ))
          ELSE lower(btrim(coalesce(outbox.destination_id, '')))
        END
    );

  UPDATE public.marketing_conversion_outbox AS outbox
  SET status = 'dead',
      last_error = 'PROVIDER_EVENT_WINDOW_EXPIRED',
      claim_token = NULL,
      claimed_at = NULL,
      updated_at = now()
  WHERE (
      outbox.status IN ('pending', 'retry', 'validation_only')
      OR (
        outbox.status = 'processing'
        AND outbox.claimed_at < now() - safe_lease
      )
    )
    AND outbox.user_id = ANY (safe_user_ids)
    AND outbox.marketing_site_id IS NOT NULL
    AND outbox.integration_id IS NOT NULL
    AND NOT public.marketing_provider_event_is_fresh(
      outbox.provider,
      outbox.occurred_at
    );

  RETURN QUERY
  WITH candidates AS (
    SELECT outbox.id
    FROM public.marketing_conversion_outbox AS outbox
    JOIN public.marketing_integrations AS integration
      ON integration.id = outbox.integration_id
     AND integration.user_id = outbox.user_id
     AND integration.provider = outbox.provider
     AND integration.marketing_site_id = outbox.marketing_site_id
     AND btrim(integration.destination_id)
       IS NOT DISTINCT FROM btrim(outbox.destination_id)
     AND integration.enabled
    JOIN public.marketing_sites AS site
      ON site.id = integration.marketing_site_id
     AND site.user_id = integration.user_id
     AND site.enabled
     AND site.measurement_enabled
    WHERE (
      (
        outbox.status IN ('pending', 'retry', 'validation_only')
        AND outbox.next_attempt_at <= now()
      )
      OR (
        outbox.status = 'accepted_unverified'
        AND outbox.provider = 'google'
        AND outbox.next_attempt_at <= now()
      )
      OR (
        outbox.status = 'processing'
        AND outbox.claimed_at < now() - safe_lease
      )
    )
      AND outbox.user_id = ANY (safe_user_ids)
      AND (
        (
          outbox.status = 'accepted_unverified'
          AND outbox.provider = 'google'
        )
        OR public.marketing_provider_event_is_fresh(
          outbox.provider,
          outbox.occurred_at
        )
      )
      AND EXISTS (
        SELECT 1
        FROM public.marketing_destination_ownership AS ownership
        WHERE ownership.user_id = outbox.user_id
          AND ownership.marketing_site_id = outbox.marketing_site_id
          AND ownership.integration_id = outbox.integration_id
          AND ownership.provider = outbox.provider
          AND ownership.verified_at <= now()
          AND ownership.resource_key = CASE
            WHEN outbox.provider = 'google' THEN lower(concat(
              regexp_replace(coalesce(outbox.account_id, ''), '\D', '', 'g'),
              ':',
              btrim(coalesce(outbox.conversion_action_id, ''))
            ))
            ELSE lower(btrim(coalesce(outbox.destination_id, '')))
          END
      )
      AND (
        (
          outbox.status = 'accepted_unverified'
          AND outbox.provider = 'google'
        )
        OR public.marketing_provider_consent_allowed(
          outbox.user_id,
          outbox.marketing_site_id,
          outbox.lead_id,
          outbox.provider
        )
      )
    ORDER BY outbox.next_attempt_at, outbox.created_at, outbox.id
    FOR UPDATE OF outbox SKIP LOCKED
    LIMIT safe_limit
  ), claimed AS (
    UPDATE public.marketing_conversion_outbox AS outbox
    SET status = 'processing',
        attempts = outbox.attempts + 1,
        claim_token = batch_token,
        claimed_at = now(),
        next_attempt_at = now() + safe_lease,
        last_error = NULL,
        updated_at = now()
    FROM candidates
    WHERE outbox.id = candidates.id
    RETURNING outbox.*
  )
  SELECT claimed.*
  FROM claimed
  ORDER BY claimed.created_at, claimed.id;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_marketing_conversion_outbox(integer, integer, uuid[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_marketing_conversion_outbox(integer, integer, uuid[])
  TO service_role;

COMMIT;

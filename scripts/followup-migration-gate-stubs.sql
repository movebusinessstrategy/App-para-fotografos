-- Stubs do gate da 083 (scripts/followup-migration-gate.sh). SÓ para o Postgres local
-- descartável: recria o mínimo do Supabase (roles, auth.users, auth.uid() e os privilégios
-- padrão) e as tabelas que a 083 lê, com as colunas reais de produção (lidas em 19/09/2026).
-- Nunca rode isto no Supabase: a guarda abaixo aborta se achar um banco já povoado.
\set ON_ERROR_STOP 1
BEGIN;

DO $$
BEGIN
  IF to_regclass('public.deals') IS NOT NULL OR to_regnamespace('auth') IS NOT NULL THEN
    RAISE EXCEPTION 'stubs do gate 083: banco já tem public.deals ou o schema auth; use um Postgres local vazio';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;

CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
-- Como no Supabase: objetos novos em public nascem com privilégio para as três roles.
-- É isso que torna o REVOKE das funções SECURITY DEFINER da 083 obrigatório.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;

CREATE FUNCTION public.wa_phone_key(raw_phone text) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  WITH cleaned AS (SELECT regexp_replace(coalesce(raw_phone, ''), '\D', '', 'g') AS value)
  SELECT CASE WHEN length(value) = 13 AND left(value, 2) = '55' AND substr(value, 5, 1) = '9'
    THEN substr(value, 1, 4) || substr(value, 6) ELSE value END FROM cleaned;
$$;
CREATE FUNCTION public.wa_sender_key(raw_sender text) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT regexp_replace(coalesce(raw_sender, ''), '\D', '', 'g');
$$;

CREATE TABLE public.deal_stages (
  id text NOT NULL PRIMARY KEY, name text NOT NULL, color text DEFAULT '#E5E7EB'::text, "position" integer DEFAULT 0 NOT NULL,
  is_final boolean DEFAULT false, is_won boolean DEFAULT false, user_id uuid NOT NULL,
  created_at timestamptz DEFAULT now(), expected_hours numeric DEFAULT 0, process_id text,
  follow_up_message text, auto_follow_up_enabled boolean DEFAULT false, follow_up_delay_hours integer DEFAULT 2,
  follow_up_template_id bigint
);
CREATE TABLE public.deals (
  id serial PRIMARY KEY, user_id uuid NOT NULL, client_id integer,
  title text NOT NULL, value numeric DEFAULT 0, stage text DEFAULT 'lead'::text NOT NULL,
  stage_entered_at timestamptz DEFAULT now(), priority text DEFAULT 'medium'::text,
  temperature text DEFAULT 'warm'::text, temperature_score integer DEFAULT 50, temperature_locked boolean DEFAULT false,
  expected_close_date date, next_follow_up date, notes text, contact_name text, contact_phone text, contact_email text,
  lead_source text, lost_reason text, lost_notes text, converted boolean DEFAULT false,
  converted_at timestamptz, converted_client_id integer, converted_job_id integer,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
  current_stage_entered_at timestamptz, stage_history jsonb DEFAULT '[]'::jsonb, stage_id integer,
  catalog_type text, catalog_id text, catalog_name text, catalog_value numeric, labels text[] DEFAULT '{}'::text[],
  assigned_to uuid, discount numeric DEFAULT 0, campaign_id uuid, marketing_lead_id uuid, sale_gross_amount numeric(14,2)
);
CREATE TABLE public.clients (
  id bigserial PRIMARY KEY, name text NOT NULL, phone text, email text, birth_date text, cpf text, cep text, address text,
  neighborhood text, city text, state text, age integer, child_name text, instagram text, closing_date text, notes text,
  first_contact_date text, last_contact_date text, lead_source text, status text DEFAULT 'active'::text,
  created_at timestamptz DEFAULT now(), user_id uuid DEFAULT auth.uid() REFERENCES auth.users(id),
  custom_fields_data jsonb NOT NULL DEFAULT '{}'::jsonb, address_number text, address_complement text
);
CREATE TABLE public.jobs (
  id bigserial PRIMARY KEY, client_id bigint, job_type text NOT NULL,
  job_date text, job_time text, job_end_time text, job_name text, amount numeric(10,2), payment_method text,
  payment_status text, status text DEFAULT 'scheduled'::text, notes text, google_event_id text,
  created_at timestamptz DEFAULT now(), user_id uuid, production_stage_entered_at timestamptz,
  labels text[] DEFAULT '{}'::text[], production_stage text, assignee_id uuid, "position" integer DEFAULT 0,
  cover_image_url text, fin_synced boolean DEFAULT false, deal_id bigint, sale_session_index integer DEFAULT 0 NOT NULL,
  sale_gross_amount numeric(14,2), sale_discount_amount numeric(14,2) DEFAULT 0 NOT NULL
);
-- Só as colunas antigas: a 083 acrescenta as novas.
CREATE TABLE public.scheduled_followups (
  id bigserial PRIMARY KEY, user_id uuid NOT NULL,
  deal_id bigint NOT NULL, phone text NOT NULL, message text NOT NULL, stage_id text NOT NULL,
  scheduled_at timestamptz NOT NULL, sent_at timestamptz, status text DEFAULT 'pending'::text,
  created_at timestamptz DEFAULT now(), contact_name text, attempts integer DEFAULT 0 NOT NULL, wa_number text
);
CREATE TABLE public.wa_conversations (
  id bigserial PRIMARY KEY, user_id uuid NOT NULL,
  phone text NOT NULL, contact_name text, last_message text, last_message_at timestamptz DEFAULT now(),
  unread_count integer DEFAULT 0, created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(), wa_number text DEFAULT ''::text NOT NULL,
  needs_human boolean DEFAULT false NOT NULL, last_from_me boolean DEFAULT false NOT NULL,
  last_agent_reply_at timestamptz, archived boolean DEFAULT false, agent_status text DEFAULT 'idle'::text,
  handoff_reason text, handoff_requested_at timestamptz, human_assumed_at timestamptz,
  last_agent_action_at timestamptz, channel_account_id uuid, provider text
);
CREATE TABLE public.wa_messages (
  id bigserial PRIMARY KEY, user_id uuid NOT NULL,
  phone text NOT NULL, message_id text, body text, from_me boolean DEFAULT false, type text DEFAULT 'text'::text,
  "timestamp" timestamptz DEFAULT now(), status text DEFAULT 'sent'::text,
  created_at timestamptz DEFAULT now(), media_url text, wa_number text DEFAULT ''::text NOT NULL,
  duration integer, waveform text, transcription text, channel_account_id uuid, provider text,
  provider_message_id text, source_event_key text, webhook_inbox_id bigint
);
CREATE TABLE public.whatsapp_webhook_inbox (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, user_id uuid NOT NULL, provider text DEFAULT 'meta'::text NOT NULL,
  phone_number_id text NOT NULL, wa_number text DEFAULT ''::text NOT NULL, event_key text NOT NULL,
  field text DEFAULT 'messages'::text NOT NULL, payload jsonb NOT NULL, status text DEFAULT 'pending'::text NOT NULL,
  attempts integer DEFAULT 0 NOT NULL, next_attempt_at timestamptz DEFAULT now() NOT NULL,
  processing_started_at timestamptz, lease_expires_at timestamptz, worker_id text,
  last_error text, received_at timestamptz DEFAULT now() NOT NULL, processed_at timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL, updated_at timestamptz DEFAULT now() NOT NULL
);

-- Índices de produção que os planos da 083 usam.
CREATE INDEX idx_deal_stages_user_id ON public.deal_stages (user_id);
CREATE UNIQUE INDEX deals_id_tenant_unique ON public.deals (id, user_id);
CREATE INDEX idx_deals_user_stage ON public.deals (user_id, stage);
CREATE INDEX idx_clients_user_id ON public.clients (user_id);
CREATE UNIQUE INDEX idx_jobs_user_deal_session_unique ON public.jobs (user_id, deal_id, sale_session_index) WHERE deal_id IS NOT NULL;
CREATE INDEX scheduled_followups_channel_pending ON public.scheduled_followups (user_id, wa_number, status, scheduled_at);
CREATE INDEX idx_wa_conv_user_phone ON public.wa_conversations (user_id, phone);
CREATE UNIQUE INDEX wa_conversations_user_id_wa_number_phone_key ON public.wa_conversations (user_id, wa_number, phone);
CREATE UNIQUE INDEX wa_conversations_canonical_channel_phone_unique ON public.wa_conversations
  (user_id, public.wa_sender_key(wa_number), public.wa_phone_key(phone))
  WHERE public.wa_sender_key(wa_number) <> '' AND public.wa_phone_key(phone) <> '';
CREATE INDEX idx_wa_msgs ON public.wa_messages (user_id, phone, "timestamp" DESC);
CREATE INDEX idx_wa_msgs_message_id ON public.wa_messages (message_id);
CREATE INDEX wa_messages_channel_phone_timeline ON public.wa_messages (user_id, wa_number, phone, "timestamp");
CREATE UNIQUE INDEX wa_messages_user_id_message_id_key ON public.wa_messages (user_id, message_id);
CREATE UNIQUE INDEX whatsapp_webhook_inbox_event_uidx ON public.whatsapp_webhook_inbox (user_id, phone_number_id, event_key);
CREATE INDEX whatsapp_webhook_inbox_tenant_timeline_idx ON public.whatsapp_webhook_inbox (user_id, phone_number_id, received_at DESC);

-- RLS como em produção (scheduled_followups: ligado e sem policy).
ALTER TABLE public.deal_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scheduled_followups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wa_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wa_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_webhook_inbox ENABLE ROW LEVEL SECURITY;

-- As 4 linhas legadas de produção (mesmos status; dados fictícios). Precisam continuar
-- válidas depois da 083 (kind='legacy').
INSERT INTO auth.users (id) VALUES ('00000000-0000-4000-8000-0000000000aa');
INSERT INTO public.scheduled_followups (user_id, deal_id, phone, message, stage_id, scheduled_at, sent_at, status, contact_name, wa_number)
VALUES
  ('00000000-0000-4000-8000-0000000000aa', 1, '5511900000001', 'Oi {nome}, tudo bem?', 'stub-02', now() - interval '30 days', now() - interval '30 days', 'sent', 'Stub', '551130000009'),
  ('00000000-0000-4000-8000-0000000000aa', 2, '5511900000002', 'Oi {nome}, tudo bem?', 'stub-02', now() - interval '29 days', NULL, 'failed', 'Stub', '551130000009'),
  ('00000000-0000-4000-8000-0000000000aa', 3, '5511900000003', '###AGENT_FOLLOWUP###', 'stub-03', now() - interval '28 days', NULL, 'failed', NULL, '551130000009'),
  ('00000000-0000-4000-8000-0000000000aa', 4, '5511900000004', 'Oi {nome}, tudo bem?', 'stub-03', now() - interval '27 days', NULL, 'skipped_no_template', 'Stub', '551130000009');

COMMIT;

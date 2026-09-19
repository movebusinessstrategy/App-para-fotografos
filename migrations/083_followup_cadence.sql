-- 083: Cadência de follow-up por ESTADO, config do rastreador e opt-out.
-- Aditiva, idempotente (pode rodar duas vezes) e desligada por padrão: nada envia
-- enquanto followup_cadence_config.enabled e tracker_enabled ficarem false.
-- Aplicar à mão no SQL Editor. Decisão: NÃO há policy em scheduled_followups; as rotas
-- usam service_role e filtram user_id. As 4 funções de dados só o service_role executa.
-- Os 4 registros legados de scheduled_followups viram kind='legacy' e continuam válidos
-- em todos os CHECKs (o worker antigo segue lendo só status='pending').
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- followup_phone_key DIFERE de public.wa_phone_key: só ela prefixa 55 em 10/11 dígitos.
-- Não troque uma pela outra: a coluna gerada phone_key e os índices únicos dependem desta.
-- Espelho exato em TS: canonicalPhoneKey (lib/br-phone.ts).
CREATE OR REPLACE FUNCTION public.followup_phone_key(raw_phone text) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN length(k) = 13 AND left(k, 2) = '55' AND substr(k, 5, 1) = '9' THEN substr(k, 1, 4) || substr(k, 6) ELSE k END
    FROM (SELECT CASE WHEN length(d) IN (10, 11) THEN '55' || d ELSE d END AS k
            FROM (SELECT regexp_replace(coalesce(raw_phone, ''), '\D', '', 'g') AS d) s0) s1;
$$;
COMMENT ON FUNCTION public.followup_phone_key(text) IS
  '083: 55 + DDD + número sem o 9 extra; 10/11 dígitos ganham 55. DIFERE de wa_phone_key. Espelho: canonicalPhoneKey (lib/br-phone.ts).';

-- Mesmo conjunto de brazilianPhoneVariants (lib/br-phone.ts) para 8 ou mais dígitos; abaixo disso, vazio.
CREATE OR REPLACE FUNCTION public.followup_phone_variants(raw_phone text) RETURNS text[] LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN length(raw) < 8 THEN '{}'::text[] ELSE (
    SELECT coalesce(array_agg(DISTINCT v ORDER BY v), '{}'::text[]) FROM unnest(ARRAY[
      raw, tail, '55' || tail,
      CASE WHEN length(tail) = 10 THEN left(tail, 2) || '9' || substr(tail, 3) END,
      CASE WHEN length(tail) = 10 THEN '55' || left(tail, 2) || '9' || substr(tail, 3) END,
      CASE WHEN length(tail) = 11 AND substr(tail, 3, 1) = '9' THEN left(tail, 2) || substr(tail, 4) END,
      CASE WHEN length(tail) = 11 AND substr(tail, 3, 1) = '9' THEN '55' || left(tail, 2) || substr(tail, 4) END
    ]) AS u(v) WHERE v IS NOT NULL AND v <> '') END
    FROM (SELECT raw, CASE WHEN left(raw, 2) = '55' AND length(raw) >= 12 THEN substr(raw, 3) ELSE raw END AS tail
            FROM (SELECT regexp_replace(coalesce(raw_phone, ''), '\D', '', 'g') AS raw) s0) s1;
$$;
COMMENT ON FUNCTION public.followup_phone_variants(text) IS
  '083: variantes com e sem 55 e com e sem o 9 extra, ordenadas. Igual a brazilianPhoneVariants para 8 ou mais dígitos.';

-- scheduled_followups: colunas da cadência
ALTER TABLE public.scheduled_followups
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS step smallint,
  ADD COLUMN IF NOT EXISTS basis_at timestamptz,
  ADD COLUMN IF NOT EXISTS basis_message_id text,
  ADD COLUMN IF NOT EXISTS draft_text text,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by text,
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS claimed_by text,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS channel_used text,
  ADD COLUMN IF NOT EXISTS sent_message_id text,
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS generation_meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS track text NOT NULL DEFAULT 'ladder',
  ADD COLUMN IF NOT EXISTS phone_key text GENERATED ALWAYS AS (public.followup_phone_key(phone)) STORED;

COMMENT ON COLUMN public.scheduled_followups.kind IS
  '083: legacy = mensagem fixa por etapa (worker antigo, status pending/processing); cadence = rascunho da IA por estado.';
COMMENT ON COLUMN public.scheduled_followups.track IS
  '083: ladder = escada depois do orçamento (move o card); pre_quote = antes do orçamento (toques 1 e 2, nunca move). Legado fica ladder.';
COMMENT ON COLUMN public.scheduled_followups.basis_at IS
  '083: última fala do estúdio (visível, legado enviado ou IA oficial) que abriu o silêncio deste passo.';
COMMENT ON COLUMN public.scheduled_followups.message IS
  'Texto que sai de fato (editável na aprovação); vazio quando skipped.';
COMMENT ON COLUMN public.scheduled_followups.draft_text IS
  '083: texto original gerado pela IA; zerado pela retenção (followup_cadence_retention).';
COMMENT ON COLUMN public.scheduled_followups.phone_key IS
  '083: gerada a partir de phone por followup_phone_key; nunca gravar (nem em INSERT nem em UPDATE).';

-- Os NULLs de status e step são barrados de propósito: um CHECK com NULL passaria calado.
ALTER TABLE public.scheduled_followups
  DROP CONSTRAINT IF EXISTS scheduled_followups_kind_check,
  ADD CONSTRAINT scheduled_followups_kind_check CHECK (kind IN ('legacy', 'cadence')),
  DROP CONSTRAINT IF EXISTS scheduled_followups_cadence_shape_check,
  ADD CONSTRAINT scheduled_followups_cadence_shape_check CHECK (kind <> 'cadence' OR (
    status IS NOT NULL
    AND status IN ('draft', 'approved', 'sending', 'sent', 'skipped', 'cancelled', 'blocked', 'failed')
    AND step IS NOT NULL AND step BETWEEN 1 AND 4
    AND basis_at IS NOT NULL
    AND jsonb_typeof(generation_meta) = 'object'
    AND (track <> 'pre_quote' OR step BETWEEN 1 AND 2)
    AND (status <> 'approved' OR approved_at IS NOT NULL))),
  DROP CONSTRAINT IF EXISTS scheduled_followups_channel_used_check,
  ADD CONSTRAINT scheduled_followups_channel_used_check
    CHECK (channel_used IS NULL OR channel_used IN ('meta_text', 'baileys', 'meta_template')),
  DROP CONSTRAINT IF EXISTS scheduled_followups_track_check,
  ADD CONSTRAINT scheduled_followups_track_check CHECK (track IN ('ladder', 'pre_quote') AND (kind = 'cadence' OR track = 'ladder'));

-- Vivas = draft, approved, sending, blocked: no máximo uma por deal e uma por telefone.
CREATE UNIQUE INDEX IF NOT EXISTS scheduled_followups_cadence_live_deal_uidx
  ON public.scheduled_followups (user_id, deal_id)
  WHERE kind = 'cadence' AND status IN ('draft', 'approved', 'sending', 'blocked');
CREATE UNIQUE INDEX IF NOT EXISTS scheduled_followups_cadence_live_phone_uidx
  ON public.scheduled_followups (user_id, phone_key)
  WHERE kind = 'cadence' AND status IN ('draft', 'approved', 'sending', 'blocked');
-- Episódio: o mesmo silêncio nunca gera duas tarefas na mesma trilha, nem por deal nem por
-- telefone. Com track, o toque 1 antes do orçamento não colide com o passo 1 da escada.
CREATE UNIQUE INDEX IF NOT EXISTS scheduled_followups_cadence_episode_uidx
  ON public.scheduled_followups (user_id, deal_id, track, step, basis_at)
  WHERE kind = 'cadence';
CREATE UNIQUE INDEX IF NOT EXISTS scheduled_followups_cadence_phone_episode_uidx
  ON public.scheduled_followups (user_id, phone_key, track, basis_at)
  WHERE kind = 'cadence';
CREATE INDEX IF NOT EXISTS scheduled_followups_cadence_queue_idx
  ON public.scheduled_followups (user_id, status, scheduled_at)
  WHERE kind = 'cadence' AND status IN ('approved', 'sending');
CREATE INDEX IF NOT EXISTS scheduled_followups_cadence_panel_idx
  ON public.scheduled_followups (user_id, status, step, created_at DESC)
  WHERE kind = 'cadence';
CREATE INDEX IF NOT EXISTS scheduled_followups_cadence_sent_idx
  ON public.scheduled_followups (user_id, sent_at DESC)
  WHERE kind = 'cadence' AND status = 'sent';
CREATE INDEX IF NOT EXISTS scheduled_followups_user_deal_idx
  ON public.scheduled_followups (user_id, deal_id, created_at DESC);
CREATE INDEX IF NOT EXISTS scheduled_followups_phone_sent_idx
  ON public.scheduled_followups (user_id, phone_key, sent_at DESC)
  WHERE status = 'sent';
CREATE INDEX IF NOT EXISTS scheduled_followups_sent_message_idx
  ON public.scheduled_followups (user_id, sent_message_id)
  WHERE sent_message_id IS NOT NULL;

-- followup_cadence_config: uma linha por conta
CREATE TABLE IF NOT EXISTS public.followup_cadence_config (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  mode text NOT NULL DEFAULT 'approval',
  ladder_stage_ids text[] NOT NULL DEFAULT '{}'::text[],
  step_delays_hours integer[] NOT NULL DEFAULT '{24,48,72,120}'::integer[],
  after_last_stage_id text,
  pre_quote_stage_ids text[] NOT NULL DEFAULT '{}'::text[],
  pre_quote_delays_hours integer[] NOT NULL DEFAULT '{24,72}'::integer[],
  business_hours jsonb NOT NULL DEFAULT '{"tz":"America/Sao_Paulo","days":[1,2,3,4,5,6],"start":"09:00","end":"19:00","holidays":[]}'::jsonb,
  daily_cap integer NOT NULL DEFAULT 40,
  min_gap_seconds integer NOT NULL DEFAULT 60,
  max_gap_seconds integer NOT NULL DEFAULT 150,
  max_consecutive_errors integer NOT NULL DEFAULT 3,
  allow_meta_text boolean NOT NULL DEFAULT true,
  allow_baileys boolean NOT NULL DEFAULT false,
  template_id bigint,
  max_silence_hours integer NOT NULL DEFAULT 720,
  sweep_interval_minutes integer NOT NULL DEFAULT 60,
  max_drafts_per_sweep integer NOT NULL DEFAULT 20,
  extra_instructions text NOT NULL DEFAULT '',
  optout_detection boolean NOT NULL DEFAULT true,
  tracker_enabled boolean NOT NULL DEFAULT false,
  tracker_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  wa_number text,
  -- Estado: escrito só pelos workers e por rotas específicas.
  next_send_after timestamptz,
  consecutive_errors integer NOT NULL DEFAULT 0,
  paused_at timestamptz,
  paused_reason text,
  last_error text,
  last_block_code text,
  last_block_message text,
  last_block_at timestamptz,
  last_sweep_at timestamptz,
  last_sweep_summary jsonb,
  first_enabled_at timestamptz,
  external_ai_consent_at timestamptz,
  external_ai_consent_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text,
  CONSTRAINT followup_cadence_config_mode_check CHECK (mode IN ('approval', 'auto')),
  CONSTRAINT followup_cadence_config_ladder_check
    CHECK (cardinality(ladder_stage_ids) <= 4 AND array_position(ladder_stage_ids, NULL) IS NULL),
  CONSTRAINT followup_cadence_config_delays_check
    CHECK (cardinality(step_delays_hours) BETWEEN 1 AND 4 AND array_position(step_delays_hours, NULL) IS NULL
      AND 1 <= ALL (step_delays_hours) AND 720 >= ALL (step_delays_hours)),
  CONSTRAINT followup_cadence_config_hours_check CHECK (jsonb_typeof(business_hours) = 'object'),
  CONSTRAINT followup_cadence_config_cap_check CHECK (daily_cap BETWEEN 1 AND 200),
  CONSTRAINT followup_cadence_config_gap_check
    CHECK (min_gap_seconds BETWEEN 30 AND 900 AND max_gap_seconds >= min_gap_seconds AND max_gap_seconds <= 1800),
  CONSTRAINT followup_cadence_config_errors_check
    CHECK (max_consecutive_errors BETWEEN 1 AND 10 AND consecutive_errors >= 0),
  CONSTRAINT followup_cadence_config_silence_check CHECK (max_silence_hours BETWEEN 24 AND 2160),
  CONSTRAINT followup_cadence_config_sweep_check
    CHECK (sweep_interval_minutes BETWEEN 15 AND 1440 AND max_drafts_per_sweep BETWEEN 1 AND 60),
  CONSTRAINT followup_cadence_config_extra_check CHECK (char_length(extra_instructions) <= 1000),
  CONSTRAINT followup_cadence_config_tracker_check CHECK (jsonb_typeof(tracker_config) = 'object'),
  CONSTRAINT followup_cadence_config_paused_check
    CHECK (paused_reason IS NULL OR paused_reason IN ('error_streak', 'manual'))
);
-- Trilha antes do orçamento: colunas repetidas aqui para quem já tinha a tabela de uma versão anterior da 083.
ALTER TABLE public.followup_cadence_config
  ADD COLUMN IF NOT EXISTS pre_quote_stage_ids text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS pre_quote_delays_hours integer[] NOT NULL DEFAULT '{24,72}'::integer[],
  DROP CONSTRAINT IF EXISTS followup_cadence_config_pre_quote_check,
  ADD CONSTRAINT followup_cadence_config_pre_quote_check
    CHECK (cardinality(pre_quote_stage_ids) <= 2 AND array_position(pre_quote_stage_ids, NULL) IS NULL
      AND NOT (pre_quote_stage_ids && ladder_stage_ids)),
  DROP CONSTRAINT IF EXISTS followup_cadence_config_pre_quote_delays_check,
  ADD CONSTRAINT followup_cadence_config_pre_quote_delays_check
    CHECK (cardinality(pre_quote_delays_hours) BETWEEN 1 AND 2 AND array_position(pre_quote_delays_hours, NULL) IS NULL
      AND 1 <= ALL (pre_quote_delays_hours) AND 720 >= ALL (pre_quote_delays_hours));
COMMENT ON COLUMN public.followup_cadence_config.pre_quote_stage_ids IS
  '083: 0 a 2 etapas abertas antes da escada (ex.: Conversa Iniciada). Vazio = trilha antes do orçamento desligada.';

COMMENT ON TABLE public.followup_cadence_config IS
  '083: config da cadência de follow-up e do rastreador de funil, mais o estado dos workers. Escrita só via service_role.';

ALTER TABLE public.followup_cadence_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS followup_cadence_config_select_own ON public.followup_cadence_config;
CREATE POLICY followup_cadence_config_select_own ON public.followup_cadence_config
  FOR SELECT USING (auth.uid() = user_id);
-- INSERT/UPDATE/DELETE ficam sem policy: as rotas e os workers usam service_role.

-- followup_optouts: quem pediu para não receber
CREATE TABLE IF NOT EXISTS public.followup_optouts (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  phone_key text NOT NULL,
  phone text,
  deal_id bigint,
  kind text NOT NULL DEFAULT 'manual',
  reason text,
  detected_text text,
  source_message_id text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_by text,
  CONSTRAINT followup_optouts_kind_check CHECK (kind IN ('hard', 'soft', 'manual')),
  CONSTRAINT followup_optouts_phone_key_check CHECK (phone_key ~ '^[0-9]{8,15}$')
);
COMMENT ON TABLE public.followup_optouts IS
  '083: opt-out por telefone (phone_key = followup_phone_key). Ativo = revoked_at IS NULL. created_by: uuid do humano, funnel_tracker ou sweep_history.';
CREATE UNIQUE INDEX IF NOT EXISTS followup_optouts_active_uidx
  ON public.followup_optouts (user_id, phone_key)
  WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS followup_optouts_timeline_idx
  ON public.followup_optouts (user_id, created_at DESC);

ALTER TABLE public.followup_optouts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS followup_optouts_select_own ON public.followup_optouts;
CREATE POLICY followup_optouts_select_own ON public.followup_optouts
  FOR SELECT USING (auth.uid() = user_id);

-- whatsapp_webhook_inbox: status da IA oficial e fila não processada
CREATE INDEX IF NOT EXISTS whatsapp_webhook_inbox_status_timeline_idx
  ON public.whatsapp_webhook_inbox (user_id, received_at DESC)
  WHERE (payload ->> 'kind') = 'status';
CREATE INDEX IF NOT EXISTS whatsapp_webhook_inbox_unprocessed_idx
  ON public.whatsapp_webhook_inbox (user_id, received_at DESC)
  WHERE status <> 'processed';

-- Funções de dados (SECURITY DEFINER, só service_role)

-- Telefones de quem já é cliente: deal ganho ou convertido; cliente com ensaio não
-- cancelado (sem data, data fora do formato ISO, últimos 365 dias ou futuro); pré-reserva.
CREATE OR REPLACE FUNCTION public.followup_customer_phone_keys(p_user_id uuid) RETURNS TABLE (phone_key text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT DISTINCT s.k FROM (
    SELECT public.followup_phone_key(d.contact_phone) AS k FROM public.deals d
      LEFT JOIN public.deal_stages st ON st.id = d.stage AND st.user_id = d.user_id
     WHERE d.user_id = p_user_id
       AND (coalesce(d.converted, false) OR d.converted_job_id IS NOT NULL OR d.converted_at IS NOT NULL OR coalesce(st.is_won, false))
    UNION ALL
    SELECT public.followup_phone_key(c.phone) FROM public.clients c
     WHERE c.user_id = p_user_id AND EXISTS (SELECT 1 FROM public.jobs j WHERE j.user_id = p_user_id AND j.client_id = c.id
       AND coalesce(j.status, '') <> 'cancelled'
       AND (j.job_date IS NULL OR j.job_date !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
            OR left(j.job_date, 10) >= to_char(current_date - 365, 'YYYY-MM-DD')))
    UNION ALL
    SELECT public.followup_phone_key(d2.contact_phone) FROM public.jobs j2
      JOIN public.deals d2 ON d2.id = j2.deal_id AND d2.user_id = p_user_id
     WHERE j2.user_id = p_user_id AND j2.status = 'pre_reserved') s
  WHERE length(s.k) BETWEEN 10 AND 13;
$$;

-- Candidatos da varredura: um por deal aberto nas etapas pedidas, com o último turno
-- de cada lado. Estúdio: from_me no número principal, sem failed e fora de
-- STUDIO_NON_TURN_TYPES, ou legado enviado (o mais novo vence). Cliente: qualquer número,
-- fora de CUSTOMER_NON_TURN_TYPES. Invisível (IA oficial): status agrupado por wamid,
-- instante do 'sent' (ou o primeiro status), sem failed, sem linha em wa_messages e sem
-- from_me do mesmo telefone a 120s (ids sintéticos auto-/blast-).
CREATE OR REPLACE FUNCTION public.followup_cadence_candidates(p_user_id uuid, p_stage_ids text[], p_wa_numbers text[] DEFAULT NULL,
  p_lookback_hours integer DEFAULT 768, p_limit integer DEFAULT 500)
RETURNS TABLE (deal_id bigint, stage text, contact_name text, contact_phone text, phone_key text, stage_entered_at timestamptz,
  last_studio_at timestamptz, last_studio_type text, last_studio_body text, last_studio_message_id text, last_customer_at timestamptz,
  last_customer_reaction_at timestamptz, last_invisible_out_at timestamptz, invisible_read boolean, needs_human boolean,
  already_customer boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH od AS (
    SELECT d.id::bigint AS deal_id, d.stage::text AS stage, coalesce(nullif(btrim(d.contact_name), ''), d.title)::text AS contact_name,
           d.contact_phone::text AS contact_phone, public.followup_phone_key(d.contact_phone) AS phone_key,
           coalesce(d.current_stage_entered_at, d.stage_entered_at, d.updated_at, d.created_at) AS stage_entered_at,
           public.followup_phone_variants(d.contact_phone) AS variants
      FROM public.deals d
     WHERE d.user_id = p_user_id AND d.stage = ANY (p_stage_ids) AND NOT coalesce(d.converted, false) AND d.converted_job_id IS NULL
       AND length(public.followup_phone_key(d.contact_phone)) BETWEEN 10 AND 13),
  ck AS MATERIALIZED (SELECT k.phone_key FROM public.followup_customer_phone_keys(p_user_id) k),
  inv_msg AS (
    SELECT i.payload #>> '{status,id}' AS wamid, public.followup_phone_key(i.payload #>> '{status,recipient_id}') AS phone_key,
           min(to_timestamp((i.payload #>> '{status,timestamp}')::double precision)) FILTER (WHERE i.payload #>> '{status,status}' = 'sent') AS sent_at,
           min(to_timestamp((i.payload #>> '{status,timestamp}')::double precision)) AS first_at,
           bool_or(i.payload #>> '{status,status}' = 'read') AS was_read,
           bool_or(i.payload #>> '{status,status}' = 'failed') AS failed
      FROM public.whatsapp_webhook_inbox i
     WHERE i.user_id = p_user_id AND i.received_at >= now() - make_interval(hours => greatest(p_lookback_hours, 1))
       AND i.payload ->> 'kind' = 'status' AND i.payload #>> '{status,status}' IN ('sent', 'delivered', 'read', 'failed')
       AND i.payload #>> '{status,timestamp}' ~ '^[0-9]{9,11}$' AND (p_wa_numbers IS NULL OR i.wa_number = ANY (p_wa_numbers))
     GROUP BY 1, 2),
  inv_ok AS (
    SELECT im.phone_key, coalesce(im.sent_at, im.first_at) AS out_at, im.was_read FROM inv_msg im
     WHERE NOT im.failed AND im.phone_key IN (SELECT od.phone_key FROM od)
       AND NOT EXISTS (SELECT 1 FROM public.wa_messages m WHERE m.user_id = p_user_id AND m.message_id = im.wamid)
       AND NOT EXISTS (SELECT 1 FROM public.wa_messages m2 WHERE m2.user_id = p_user_id AND m2.from_me IS TRUE
             AND m2.phone = ANY (public.followup_phone_variants(im.phone_key))
             AND m2."timestamp" BETWEEN coalesce(im.sent_at, im.first_at) - interval '120 seconds'
                                    AND coalesce(im.sent_at, im.first_at) + interval '120 seconds')),
  invisible AS (
    SELECT io.phone_key, max(io.out_at) AS last_at, (array_agg(io.was_read ORDER BY io.out_at DESC))[1] AS was_read
      FROM inv_ok io GROUP BY io.phone_key)
  SELECT od.deal_id, od.stage, od.contact_name, od.contact_phone, od.phone_key, od.stage_entered_at,
    CASE WHEN lf.ts IS NOT NULL AND (ls.ts IS NULL OR lf.ts > ls.ts) THEN lf.ts ELSE ls.ts END,
    CASE WHEN lf.ts IS NOT NULL AND (ls.ts IS NULL OR lf.ts > ls.ts) THEN 'text' ELSE ls.type END,
    CASE WHEN lf.ts IS NOT NULL AND (ls.ts IS NULL OR lf.ts > ls.ts) THEN lf.body ELSE ls.body END,
    CASE WHEN lf.ts IS NOT NULL AND (ls.ts IS NULL OR lf.ts > ls.ts) THEN NULL ELSE ls.message_id END,
    lc.ts, lr.ts, inv.last_at, coalesce(inv.was_read, false), coalesce(wc.needs_human, false),
    EXISTS (SELECT 1 FROM ck WHERE ck.phone_key = od.phone_key)
  FROM od
  LEFT JOIN LATERAL (SELECT m."timestamp" AS ts, m.type::text AS type, left(m.body, 300) AS body, m.message_id::text AS message_id
      FROM public.wa_messages m WHERE m.user_id = p_user_id AND m.phone = ANY (od.variants) AND m.from_me IS TRUE
       AND (p_wa_numbers IS NULL OR m.wa_number = ANY (p_wa_numbers))
       AND coalesce(m.type, 'text') <> ALL (ARRAY['reaction','edit','revoke','unsupported']) AND coalesce(m.status, '') <> 'failed'
     ORDER BY m."timestamp" DESC NULLS LAST LIMIT 1) ls ON true
  LEFT JOIN LATERAL (SELECT f.sent_at AS ts, left(nullif(f.message, '###AGENT_FOLLOWUP###'), 300) AS body FROM public.scheduled_followups f
     WHERE f.user_id = p_user_id AND f.kind = 'legacy' AND f.status = 'sent' AND f.phone_key = od.phone_key AND f.sent_at IS NOT NULL
     ORDER BY f.sent_at DESC LIMIT 1) lf ON true
  LEFT JOIN LATERAL (SELECT m."timestamp" AS ts FROM public.wa_messages m WHERE m.user_id = p_user_id AND m.phone = ANY (od.variants)
       AND m.from_me IS NOT TRUE AND coalesce(m.type, 'text') <> ALL (ARRAY['reaction','edit','revoke'])
     ORDER BY m."timestamp" DESC NULLS LAST LIMIT 1) lc ON true
  LEFT JOIN LATERAL (SELECT max(m."timestamp") AS ts FROM public.wa_messages m WHERE m.user_id = p_user_id AND m.phone = ANY (od.variants)
       AND m.from_me IS NOT TRUE AND m.type = 'reaction') lr ON true
  LEFT JOIN LATERAL (SELECT bool_or(coalesce(c.needs_human, false) OR c.agent_status IN ('needs_human', 'human_active')) AS needs_human
      FROM public.wa_conversations c
     WHERE c.user_id = p_user_id AND c.phone = ANY (od.variants) AND (p_wa_numbers IS NULL OR c.wa_number = ANY (p_wa_numbers))) wc ON true
  LEFT JOIN invisible inv ON inv.phone_key = od.phone_key
  ORDER BY greatest(ls.ts, lf.ts, inv.last_at) DESC NULLS LAST, od.deal_id
  LIMIT greatest(least(coalesce(p_limit, 500), 2000), 1);
$$;

-- Claim do sender: serializa por conta (FOR UPDATE SKIP LOCKED na config), aplica o teto
-- efetivo (rampa de 14 dias depois de first_enabled_at) somando cadência e legado do dia,
-- aplica o intervalo e devolve 0 ou 1 tarefa em 'sending'. O status e o claimed_at
-- anteriores ficam em generation_meta para o sender decidir o que fazer com lease vencido.
CREATE OR REPLACE FUNCTION public.claim_cadence_followup(p_user_id uuid, p_worker_id text, p_lease_seconds integer,
  p_gap_seconds integer, p_day_start timestamptz)
RETURNS SETOF public.scheduled_followups LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  cfg public.followup_cadence_config%ROWTYPE;
  task public.scheduled_followups%ROWTYPE;
  sent_today integer;
  cap integer;
  now_ts timestamptz := now();
BEGIN
  SELECT * INTO cfg FROM public.followup_cadence_config WHERE user_id = p_user_id FOR UPDATE SKIP LOCKED;
  IF NOT FOUND OR NOT cfg.enabled OR cfg.paused_at IS NOT NULL THEN RETURN; END IF;
  IF cfg.next_send_after IS NOT NULL AND cfg.next_send_after > now_ts THEN RETURN; END IF;
  cap := CASE WHEN cfg.first_enabled_at IS NOT NULL AND cfg.first_enabled_at > now_ts - interval '14 days'
              THEN least(cfg.daily_cap, 10) ELSE cfg.daily_cap END;
  SELECT count(*) INTO sent_today FROM public.scheduled_followups f WHERE f.user_id = p_user_id
    AND ((f.kind = 'cadence' AND f.status IN ('sent', 'sending') AND coalesce(f.sent_at, f.claimed_at) >= p_day_start)
      OR (f.kind = 'legacy' AND f.status = 'sent' AND f.sent_at >= p_day_start));
  IF sent_today >= cap THEN RETURN; END IF;
  SELECT * INTO task FROM public.scheduled_followups f
   WHERE f.user_id = p_user_id AND f.kind = 'cadence' AND f.scheduled_at <= now_ts
     AND (f.status = 'approved' OR (f.status = 'sending' AND f.lease_expires_at < now_ts))
   ORDER BY f.scheduled_at, f.id LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN RETURN; END IF;
  UPDATE public.scheduled_followups SET status = 'sending', claimed_at = now_ts, claimed_by = p_worker_id,
    lease_expires_at = now_ts + make_interval(secs => greatest(p_lease_seconds, 30)), attempts = attempts + 1, updated_at = now_ts,
    generation_meta = generation_meta || jsonb_build_object('prev_status', task.status, 'prev_claimed_at', task.claimed_at)
   WHERE id = task.id RETURNING * INTO task;
  UPDATE public.followup_cadence_config
     SET next_send_after = now_ts + make_interval(secs => greatest(p_gap_seconds, cfg.min_gap_seconds))
   WHERE user_id = p_user_id;
  RETURN NEXT task;
END; $$;

-- Retenção (LGPD): zera o texto original da IA e o trecho de conversa guardado nas
-- tarefas terminais mais velhas que p_days (mínimo 30). Idempotente pelo marcador.
CREATE OR REPLACE FUNCTION public.followup_cadence_retention(p_user_id uuid, p_days integer DEFAULT 90) RETURNS integer
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH upd AS (
    UPDATE public.scheduled_followups f SET draft_text = NULL,
      generation_meta = (f.generation_meta - 'context_tail') || jsonb_build_object('retention_applied_at', now()), updated_at = now()
     WHERE f.user_id = p_user_id AND f.kind = 'cadence' AND f.status IN ('sent', 'skipped', 'cancelled', 'failed')
       AND f.updated_at < now() - make_interval(days => greatest(p_days, 30)) AND NOT (f.generation_meta ? 'retention_applied_at')
    RETURNING 1)
  SELECT count(*)::integer FROM upd;
$$;

-- O Supabase concede EXECUTE a anon/authenticated por padrão em funções novas: tira aqui.
REVOKE ALL ON FUNCTION public.followup_customer_phone_keys(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.followup_customer_phone_keys(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.followup_cadence_candidates(uuid, text[], text[], integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.followup_cadence_candidates(uuid, text[], text[], integer, integer) TO service_role;
REVOKE ALL ON FUNCTION public.claim_cadence_followup(uuid, text, integer, integer, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_cadence_followup(uuid, text, integer, integer, timestamptz) TO service_role;
REVOKE ALL ON FUNCTION public.followup_cadence_retention(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.followup_cadence_retention(uuid, integer) TO service_role;

COMMIT;

-- Conferência depois de aplicar (só leitura; troque os marcadores)
-- select * from public.followup_cadence_candidates('<uuid da conta>',
--   '{proposal,negotiation,02-follow-up,03-follow-up}', '{<numero principal 12 digitos>,<numero principal 13 digitos>}') limit 20;
-- explain analyze select * from public.followup_cadence_candidates('<uuid da conta>',
--   '{proposal,negotiation,02-follow-up,03-follow-up}', '{<numero principal 12 digitos>,<numero principal 13 digitos>}');
-- select count(*) from public.followup_customer_phone_keys('<uuid da conta>');
-- select kind, status, count(*) from public.scheduled_followups group by 1, 2;   -- legados: kind = 'legacy'
-- select public.followup_phone_key('+55 (43) 99999-0000'), public.followup_phone_variants('5543999990000');
--
-- Rollback manual (nesta ordem; as demais colunas novas PODEM ficar)
-- BEGIN;
-- DROP FUNCTION IF EXISTS public.followup_cadence_retention(uuid, integer);
-- DROP FUNCTION IF EXISTS public.claim_cadence_followup(uuid, text, integer, integer, timestamptz);
-- DROP FUNCTION IF EXISTS public.followup_cadence_candidates(uuid, text[], text[], integer, integer);
-- DROP FUNCTION IF EXISTS public.followup_customer_phone_keys(uuid);
-- DROP TABLE IF EXISTS public.followup_optouts;
-- DROP TABLE IF EXISTS public.followup_cadence_config;
-- DROP INDEX IF EXISTS public.whatsapp_webhook_inbox_status_timeline_idx;
-- DROP INDEX IF EXISTS public.whatsapp_webhook_inbox_unprocessed_idx;
-- DROP INDEX IF EXISTS public.scheduled_followups_cadence_live_deal_uidx;
-- DROP INDEX IF EXISTS public.scheduled_followups_cadence_live_phone_uidx;
-- DROP INDEX IF EXISTS public.scheduled_followups_cadence_episode_uidx;
-- DROP INDEX IF EXISTS public.scheduled_followups_cadence_phone_episode_uidx;
-- DROP INDEX IF EXISTS public.scheduled_followups_cadence_queue_idx;
-- DROP INDEX IF EXISTS public.scheduled_followups_cadence_panel_idx;
-- DROP INDEX IF EXISTS public.scheduled_followups_cadence_sent_idx;
-- DROP INDEX IF EXISTS public.scheduled_followups_user_deal_idx;
-- DROP INDEX IF EXISTS public.scheduled_followups_phone_sent_idx;
-- DROP INDEX IF EXISTS public.scheduled_followups_sent_message_idx;
-- ALTER TABLE public.scheduled_followups
--   DROP CONSTRAINT IF EXISTS scheduled_followups_kind_check,
--   DROP CONSTRAINT IF EXISTS scheduled_followups_cadence_shape_check,
--   DROP CONSTRAINT IF EXISTS scheduled_followups_channel_used_check,
--   DROP CONSTRAINT IF EXISTS scheduled_followups_track_check;
-- ALTER TABLE public.scheduled_followups DROP COLUMN IF EXISTS phone_key;   -- a coluna gerada depende da função
-- DROP FUNCTION IF EXISTS public.followup_phone_variants(text);
-- DROP FUNCTION IF EXISTS public.followup_phone_key(text);
-- COMMIT;

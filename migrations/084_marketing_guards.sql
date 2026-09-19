-- 084: guardas de marketing (captura de contato e conversão por etapa).
--
-- Por quê:
-- 1. capture_marketing_whatsapp_contact chama enqueue_marketing_event para o
--    Contact sem olhar se o fato já existe. Cada mensagem gera um touchpoint
--    novo, então a partir da 2ª mensagem do mesmo lead enqueue_marketing_event
--    lança MARKETING_FACT_IDEMPOTENCY_CONFLICT e a captura inteira volta atrás.
-- 2. queue_mapped_stage_conversions roda no gatilho AFTER de deals
--    (deals_bb_queue_mapped_stage_conversions). O mesmo erro ali aborta a
--    mudança de etapa do deal.
--
-- O que muda: só a guarda NOT EXISTS na captura e um bloco EXCEPTION que engole
-- apenas o conflito de idempotência no gatilho. O resto dos dois corpos é
-- idêntico ao de produção (074, conferido por md5 em 19/09/2026).
-- enqueue_marketing_event e enqueue_marketing_deal_event não são recriadas.
--
-- Idempotente: a checagem de drift aceita o corpo original (md5 de produção)
-- ou o já aplicado (marcador '084: guarda' no corpo).
-- Aplicação manual no SQL Editor, com aprovação do dono, antes de ligar
-- tracker_enabled.

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  body text := pg_get_functiondef(
    'public.capture_marketing_whatsapp_contact(uuid,text,text,text,text,timestamptz,text,text,jsonb)'::regprocedure
  );
BEGIN
  IF md5(body) <> 'baf45a0f6071e132b47d8b6b85d30248'
     AND position('084: guarda' in body) = 0 THEN
    RAISE EXCEPTION 'drift: capture_marketing_whatsapp_contact mudou';
  END IF;
END
$$;

DO $$
DECLARE
  body text := pg_get_functiondef('public.queue_mapped_stage_conversions()'::regprocedure);
BEGIN
  IF md5(body) <> '61ea03744fee2da293152c672e437297'
     AND position('084: guarda' in body) = 0 THEN
    RAISE EXCEPTION 'drift: queue_mapped_stage_conversions mudou';
  END IF;
END
$$;

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
  -- 084: guarda de idempotência, a mesma do gatilho
  -- queue_confirmed_contact_conversions. Com o fato já gravado,
  -- enqueue_marketing_event só devolveria 0 ou lançaria
  -- MARKETING_FACT_IDEMPOTENCY_CONFLICT (touchpoint novo a cada mensagem).
  IF NOT EXISTS (
    SELECT 1
    FROM public.marketing_conversion_facts AS fact
    WHERE fact.user_id = contact_touchpoint.user_id
      AND fact.marketing_site_id = contact_touchpoint.marketing_site_id
      AND fact.event_id = concat('lead:', contact_touchpoint.lead_id, ':contact')
  ) THEN
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
  END IF;

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

-- Função de gatilho: a ACL atual é preservada pelo CREATE OR REPLACE e a 074
-- não tinha REVOKE/GRANT para ela.
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

  -- 084: guarda de idempotência. O event_id do Lead é fixo por lead; voltar
  -- à etapa mapeada depois de outra mensagem, com outro valor ou com outro
  -- deal do mesmo lead dá conflito, e o erro abortaria a mudança de etapa.
  -- Só esse erro é engolido; qualquer outro continua subindo.
  BEGIN
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
  EXCEPTION WHEN others THEN
    IF SQLERRM NOT LIKE '%MARKETING_FACT_IDEMPOTENCY_CONFLICT%' THEN
      RAISE;
    END IF;
    RAISE WARNING '084: guarda de idempotência ignorou conflito do deal %', new.id;
  END;

  RETURN new;
END;
$$;

COMMIT;

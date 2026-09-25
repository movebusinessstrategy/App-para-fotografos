-- 086: a rampa de aquecimento (10 envios/dia nos 14 primeiros dias) passa a valer
-- só quando a cadência pode enviar pelo QR (allow_baileys). Pela API oficial a
-- Meta já limita o volume por conta; o teto configurado (daily_cap) vale desde o
-- 1º dia. Pedido do dono em 25/09/2026. Idempotente: só recria a função.
BEGIN;
SET LOCAL lock_timeout = '5s';

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
  -- 086: a rampa de 14 dias só vale quando a cadência pode enviar pelo QR.
  cap := CASE WHEN cfg.allow_baileys AND cfg.first_enabled_at IS NOT NULL AND cfg.first_enabled_at > now_ts - interval '14 days'
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

REVOKE ALL ON FUNCTION public.claim_cadence_followup(uuid, text, integer, integer, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_cadence_followup(uuid, text, integer, integer, timestamptz) TO service_role;

COMMIT;

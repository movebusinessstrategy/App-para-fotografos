-- Preserve the sale link when cancelling legacy jobs and make later refunds
-- idempotent across client retries.
BEGIN;

ALTER TABLE public.sale_refunds
  ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_sale_refunds_tenant_idempotency
  ON public.sale_refunds(user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE OR REPLACE FUNCTION public.cancel_sale_with_refund(
  p_user_id uuid,
  p_deal_id bigint,
  p_payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  d public.deals%ROWTYPE;
  existing public.sale_cancellations%ROWTYPE;
  cancellation_key uuid;
  paid_total numeric(14,2);
  expected numeric(14,2) := round(coalesce((p_payload->>'refund_expected')::numeric, 0), 2);
  paid_now numeric(14,2) := round(coalesce((p_payload->>'refund_paid')::numeric, 0), 2);
  refund_state text := coalesce(nullif(p_payload->>'refund_status', ''), 'none');
  due_date date := nullif(p_payload->>'refund_due_date', '')::date;
  refund_date date := nullif(p_payload->>'refund_date', '')::date;
  paid_expense uuid;
  remaining numeric(14,2);
  job_count integer;
BEGIN
  SELECT * INTO d FROM public.deals
    WHERE id = p_deal_id AND user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Venda não encontrada.'; END IF;

  -- Older sales only recorded deals.converted_job_id. Persist the reverse link
  -- before clearing converted_job_id so the cancelled card keeps its history.
  IF d.converted_job_id IS NOT NULL THEN
    UPDATE public.jobs SET deal_id = d.id, sale_session_index = 0
      WHERE id = d.converted_job_id AND user_id = p_user_id AND deal_id IS NULL;
  END IF;

  SELECT * INTO existing FROM public.sale_cancellations
    WHERE user_id = p_user_id AND deal_id = p_deal_id;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'success', true, 'already_cancelled', true, 'cancellation_id', existing.id,
      'refund_status', existing.refund_status,
      'refund_expected', existing.refund_expected, 'refund_paid', existing.refund_paid
    );
  END IF;

  IF refund_state NOT IN ('none', 'pending', 'partial', 'refunded') THEN
    RAISE EXCEPTION 'Situação da devolução inválida.';
  END IF;
  IF expected < 0 OR paid_now < 0 OR paid_now > expected THEN
    RAISE EXCEPTION 'Valores da devolução inválidos.';
  END IF;
  IF refund_state = 'none' AND (expected <> 0 OR paid_now <> 0) THEN
    RAISE EXCEPTION 'Uma venda sem devolução não pode ter valor devolvido.';
  END IF;
  IF refund_state = 'refunded' AND (expected <= 0 OR paid_now <> expected OR refund_date IS NULL) THEN
    RAISE EXCEPTION 'Informe o valor e a data da devolução concluída.';
  END IF;
  IF refund_state IN ('pending', 'partial') AND (expected <= paid_now OR due_date IS NULL) THEN
    RAISE EXCEPTION 'Informe o valor restante e a data prevista da devolução.';
  END IF;

  SELECT coalesce(sum(payment.amount), 0) INTO paid_total
  FROM public.job_payments payment
  JOIN public.jobs job ON job.id = payment.job_id
  WHERE job.user_id = p_user_id
    AND (job.deal_id = p_deal_id OR job.id = d.converted_job_id);
  IF expected > paid_total THEN
    RAISE EXCEPTION 'A devolução não pode ultrapassar o total recebido de R$ %.', paid_total;
  END IF;

  INSERT INTO public.sale_cancellations(
    user_id, deal_id, reason, refund_status, refund_expected, refund_paid,
    refund_due_date, created_by
  ) VALUES (
    p_user_id, p_deal_id, trim(p_payload->>'reason'), refund_state, expected,
    paid_now, due_date, p_user_id
  ) RETURNING id INTO cancellation_key;

  IF paid_now > 0 THEN
    INSERT INTO public.fin_despesas(
      descricao, valor, status, data_vencimento, data_pagamento, recorrente,
      user_id, origem_ref, sale_cancellation_id, updated_at
    ) VALUES (
      'Devolução de venda · ' || coalesce(d.title, 'Venda ' || d.id::text),
      paid_now, 'pago', refund_date, refund_date, false, p_user_id::text,
      'sale_refund_paid:' || cancellation_key::text, cancellation_key, now()
    ) RETURNING id INTO paid_expense;

    INSERT INTO public.sale_refunds(
      user_id, cancellation_id, amount, refund_date, payment_method, notes,
      fin_expense_id, created_by
    ) VALUES (
      p_user_id, cancellation_key, paid_now, refund_date,
      nullif(trim(p_payload->>'payment_method'), ''),
      nullif(trim(p_payload->>'refund_notes'), ''), paid_expense, p_user_id
    );
  END IF;

  remaining := expected - paid_now;
  IF remaining > 0 THEN
    INSERT INTO public.fin_despesas(
      descricao, valor, status, data_vencimento, data_pagamento, recorrente,
      user_id, origem_ref, sale_cancellation_id, updated_at
    ) VALUES (
      'Devolução pendente · ' || coalesce(d.title, 'Venda ' || d.id::text),
      remaining, 'pendente', due_date, null, false, p_user_id::text,
      'sale_refund_pending:' || cancellation_key::text, cancellation_key, now()
    );
  END IF;

  UPDATE public.jobs SET
    status = 'cancelled', production_stage = null,
    production_stage_entered_at = now()
  WHERE user_id = p_user_id
    AND (deal_id = p_deal_id OR id = d.converted_job_id);
  GET DIAGNOSTICS job_count = ROW_COUNT;

  UPDATE public.deals SET
    converted = false, converted_at = null, converted_job_id = null,
    stage = p_payload->>'stage', stage_history = p_payload->'stage_history',
    lost_reason = p_payload->>'reason', temperature = 'cold',
    temperature_locked = true, updated_at = now(), stage_entered_at = now(),
    current_stage_entered_at = now()
  WHERE id = p_deal_id AND user_id = p_user_id;

  RETURN jsonb_build_object(
    'success', true, 'cancellation_id', cancellation_key, 'jobs_cancelled', job_count,
    'received', paid_total, 'refund_expected', expected, 'refund_paid', paid_now,
    'refund_remaining', remaining, 'refund_status', refund_state
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_sale_with_refund(uuid,bigint,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_sale_with_refund(uuid,bigint,jsonb)
  TO service_role;

CREATE OR REPLACE FUNCTION public.record_sale_refund(
  p_user_id uuid,
  p_cancellation_id uuid,
  p_payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  cancellation public.sale_cancellations%ROWTYPE;
  existing_refund public.sale_refunds%ROWTYPE;
  refund_key uuid := gen_random_uuid();
  expense_key uuid;
  request_key text := nullif(trim(p_payload->>'idempotency_key'), '');
  amount_paid numeric(14,2) := round(coalesce((p_payload->>'amount')::numeric, 0), 2);
  paid_on date := nullif(p_payload->>'refund_date', '')::date;
  remaining numeric(14,2);
  next_status text;
BEGIN
  IF request_key IS NULL OR char_length(request_key) NOT BETWEEN 8 AND 128
    OR request_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$' THEN
    RAISE EXCEPTION 'Informe uma chave de idempotência válida para registrar a devolução.';
  END IF;

  SELECT * INTO cancellation FROM public.sale_cancellations
    WHERE id = p_cancellation_id AND user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cancelamento não encontrado.'; END IF;

  SELECT * INTO existing_refund FROM public.sale_refunds
    WHERE user_id = p_user_id AND idempotency_key = request_key;
  IF FOUND THEN
    IF existing_refund.cancellation_id <> cancellation.id THEN
      RAISE EXCEPTION 'Esta chave de idempotência já foi usada em outro cancelamento.';
    END IF;
    remaining := cancellation.refund_expected - cancellation.refund_paid;
    RETURN jsonb_build_object(
      'success', true, 'already_recorded', true, 'refund_id', existing_refund.id,
      'refund_paid', existing_refund.amount, 'refund_remaining', remaining,
      'refund_status', cancellation.refund_status
    );
  END IF;

  remaining := cancellation.refund_expected - cancellation.refund_paid;
  IF amount_paid <= 0 OR amount_paid > remaining OR paid_on IS NULL THEN
    RAISE EXCEPTION 'Valor ou data da devolução inválidos.';
  END IF;

  INSERT INTO public.fin_despesas(
    descricao, valor, status, data_vencimento, data_pagamento, recorrente,
    user_id, origem_ref, sale_cancellation_id, updated_at
  ) VALUES (
    'Devolução de venda · ' || cancellation.deal_id::text,
    amount_paid, 'pago', paid_on, paid_on, false, p_user_id::text,
    'sale_refund_paid:' || refund_key::text, cancellation.id, now()
  ) RETURNING id INTO expense_key;

  INSERT INTO public.sale_refunds(
    id, user_id, cancellation_id, amount, refund_date, payment_method,
    notes, fin_expense_id, created_by, idempotency_key
  ) VALUES (
    refund_key, p_user_id, cancellation.id, amount_paid, paid_on,
    nullif(trim(p_payload->>'payment_method'), ''),
    nullif(trim(p_payload->>'notes'), ''), expense_key, p_user_id, request_key
  );

  remaining := remaining - amount_paid;
  next_status := CASE WHEN remaining = 0 THEN 'refunded' ELSE 'partial' END;
  UPDATE public.sale_cancellations SET
    refund_paid = refund_paid + amount_paid,
    refund_status = next_status,
    updated_at = now()
  WHERE id = cancellation.id AND user_id = p_user_id;

  UPDATE public.fin_despesas SET
    valor = CASE WHEN remaining > 0 THEN remaining ELSE valor END,
    status = CASE WHEN remaining > 0 THEN 'pendente' ELSE 'cancelado' END,
    updated_at = now()
  WHERE user_id = p_user_id::text
    AND sale_cancellation_id = cancellation.id
    AND origem_ref = 'sale_refund_pending:' || cancellation.id::text;

  RETURN jsonb_build_object(
    'success', true, 'refund_id', refund_key, 'refund_paid', amount_paid,
    'refund_remaining', remaining, 'refund_status', next_status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_sale_refund(uuid,uuid,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_sale_refund(uuid,uuid,jsonb)
  TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;

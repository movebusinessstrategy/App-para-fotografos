-- Safe sale cancellation/refund tracking and post-conversion job splitting.
-- Additive migration: preserves jobs, contracts, payments and historical data.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.sale_cancellations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  deal_id bigint NOT NULL REFERENCES public.deals(id) ON DELETE RESTRICT,
  reason text NOT NULL,
  refund_status text NOT NULL DEFAULT 'none'
    CHECK (refund_status IN ('none', 'pending', 'partial', 'refunded')),
  refund_expected numeric(14,2) NOT NULL DEFAULT 0 CHECK (refund_expected >= 0),
  refund_paid numeric(14,2) NOT NULL DEFAULT 0 CHECK (refund_paid >= 0 AND refund_paid <= refund_expected),
  refund_due_date date,
  cancelled_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, deal_id)
);

CREATE TABLE IF NOT EXISTS public.sale_refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  cancellation_id uuid NOT NULL REFERENCES public.sale_cancellations(id) ON DELETE RESTRICT,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  refund_date date NOT NULL,
  payment_method text,
  notes text,
  fin_expense_id uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sale_payment_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  deal_id bigint NOT NULL REFERENCES public.deals(id) ON DELETE RESTRICT,
  job_payment_id uuid NOT NULL REFERENCES public.job_payments(id) ON DELETE RESTRICT,
  job_id bigint NOT NULL REFERENCES public.jobs(id) ON DELETE RESTRICT,
  amount numeric(14,2) NOT NULL CHECK (amount >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_payment_id, job_id)
);

CREATE INDEX IF NOT EXISTS idx_sale_cancellations_deal
  ON public.sale_cancellations(user_id, deal_id);
CREATE INDEX IF NOT EXISTS idx_sale_refunds_cancellation
  ON public.sale_refunds(user_id, cancellation_id);
CREATE INDEX IF NOT EXISTS idx_sale_payment_allocations_job
  ON public.sale_payment_allocations(user_id, job_id);
CREATE INDEX IF NOT EXISTS idx_sale_payment_allocations_payment
  ON public.sale_payment_allocations(job_payment_id);

ALTER TABLE public.fin_despesas
  ADD COLUMN IF NOT EXISTS sale_cancellation_id uuid REFERENCES public.sale_cancellations(id) ON DELETE RESTRICT;

ALTER TABLE public.sale_cancellations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_payment_allocations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sale_cancellations_tenant ON public.sale_cancellations;
CREATE POLICY sale_cancellations_tenant ON public.sale_cancellations
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS sale_refunds_tenant ON public.sale_refunds;
CREATE POLICY sale_refunds_tenant ON public.sale_refunds
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS sale_payment_allocations_tenant ON public.sale_payment_allocations;
CREATE POLICY sale_payment_allocations_tenant ON public.sale_payment_allocations
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

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
  refund_key uuid := gen_random_uuid();
  expense_key uuid;
  amount_paid numeric(14,2) := round(coalesce((p_payload->>'amount')::numeric, 0), 2);
  paid_on date := nullif(p_payload->>'refund_date', '')::date;
  remaining numeric(14,2);
  next_status text;
BEGIN
  SELECT * INTO cancellation FROM public.sale_cancellations
    WHERE id = p_cancellation_id AND user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cancelamento não encontrado.'; END IF;
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
    notes, fin_expense_id, created_by
  ) VALUES (
    refund_key, p_user_id, cancellation.id, amount_paid, paid_on,
    nullif(trim(p_payload->>'payment_method'), ''),
    nullif(trim(p_payload->>'notes'), ''), expense_key, p_user_id
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

CREATE OR REPLACE FUNCTION public.split_production_job(
  p_user_id uuid,
  p_job_id bigint,
  p_sessions jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  original public.jobs%ROWTYPE;
  d public.deals%ROWTYPE;
  session jsonb;
  job_key bigint;
  first_key bigint;
  jobs_result jsonb := '[]'::jsonb;
  session_count integer;
  existing_count integer;
  gross_total numeric(14,2);
  discount_total numeric(14,2);
  net_total numeric(14,2);
  expected_gross numeric(14,2);
  expected_discount numeric(14,2);
  extras numeric(14,2);
  payment public.job_payments%ROWTYPE;
  target public.jobs%ROWTYPE;
  cumulative numeric(14,2);
  allocated numeric(14,2);
  share numeric(14,2);
  paid_for_job numeric(14,2);
BEGIN
  SELECT * INTO original FROM public.jobs
    WHERE id = p_job_id AND user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ensaio não encontrado.'; END IF;
  IF original.deal_id IS NULL THEN
    RAISE EXCEPTION 'Este card não está vinculado a uma venda e não pode ser separado automaticamente.';
  END IF;
  SELECT * INTO d FROM public.deals
    WHERE id = original.deal_id AND user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Venda vinculada não encontrada.'; END IF;

  SELECT count(*) INTO existing_count FROM public.jobs
    WHERE user_id = p_user_id AND deal_id = d.id;
  IF existing_count > 1 THEN
    SELECT jsonb_agg(jsonb_build_object('id', id, 'job_type', job_type, 'job_name', job_name, 'job_date', job_date))
      INTO jobs_result FROM public.jobs WHERE user_id = p_user_id AND deal_id = d.id;
    RETURN jsonb_build_object('success', true, 'already_split', true, 'jobs', coalesce(jobs_result, '[]'::jsonb));
  END IF;

  session_count := jsonb_array_length(coalesce(p_sessions, '[]'::jsonb));
  IF session_count NOT BETWEEN 2 AND 20 THEN
    RAISE EXCEPTION 'Informe pelo menos dois ensaios.';
  END IF;
  SELECT round(sum((value->>'gross_amount')::numeric), 2),
         round(sum((value->>'discount_amount')::numeric), 2),
         round(sum((value->>'amount')::numeric), 2)
    INTO gross_total, discount_total, net_total
  FROM jsonb_array_elements(p_sessions);
  expected_gross := round(coalesce(d.sale_gross_amount, d.value + coalesce(d.discount, 0)), 2);
  expected_discount := round(coalesce(d.discount, 0), 2);
  IF gross_total <> expected_gross OR discount_total <> expected_discount
    OR net_total <> expected_gross - expected_discount THEN
    RAISE EXCEPTION 'A soma dos ensaios precisa manter o valor e o desconto da venda.';
  END IF;

  SELECT coalesce(sum(greatest(0, catalog_value * quantidade - coalesce(discount_value, 0))), 0)
    INTO extras FROM public.job_items WHERE job_id = original.id;

  FOR session IN SELECT value FROM jsonb_array_elements(p_sessions) LOOP
    IF trim(coalesce(session->>'job_type', '')) = '' OR trim(coalesce(session->>'job_name', '')) = ''
      OR (session->>'gross_amount')::numeric < 0 OR (session->>'discount_amount')::numeric < 0
      OR (session->>'amount')::numeric <> (session->>'gross_amount')::numeric - (session->>'discount_amount')::numeric THEN
      RAISE EXCEPTION 'Dados de um dos ensaios são inválidos.';
    END IF;
    IF (session->>'session_index')::integer = 0 THEN
      job_key := original.id;
      first_key := original.id;
      UPDATE public.jobs SET
        sale_session_index = 0, job_type = session->>'job_type', job_name = session->>'job_name',
        job_date = nullif(session->>'job_date', '')::date,
        sale_gross_amount = (session->>'gross_amount')::numeric,
        sale_discount_amount = (session->>'discount_amount')::numeric,
        amount = (session->>'amount')::numeric + extras,
        production_stage = coalesce(nullif(session->>'production_stage', ''), production_stage),
        production_stage_entered_at = now()
      WHERE id = original.id AND user_id = p_user_id;
    ELSE
      INSERT INTO public.jobs(
        user_id, client_id, deal_id, sale_session_index, job_type, job_name,
        job_date, job_time, job_end_time, amount, sale_gross_amount,
        sale_discount_amount, payment_method, payment_status, status, notes,
        production_stage, production_stage_entered_at, labels, assignee_id
      ) VALUES (
        p_user_id, original.client_id, d.id, (session->>'session_index')::integer,
        session->>'job_type', session->>'job_name', nullif(session->>'job_date', '')::date,
        null, null, (session->>'amount')::numeric, (session->>'gross_amount')::numeric,
        (session->>'discount_amount')::numeric, original.payment_method, 'pending',
        'scheduled', nullif(session->>'notes', ''),
        coalesce(nullif(session->>'production_stage', ''), original.production_stage),
        now(), original.labels, original.assignee_id
      ) RETURNING id INTO job_key;
    END IF;
    jobs_result := jobs_result || jsonb_build_array(jsonb_build_object(
      'id', job_key, 'job_type', session->>'job_type', 'job_name', session->>'job_name',
      'job_date', session->>'job_date'
    ));
  END LOOP;

  DELETE FROM public.sale_payment_allocations
    WHERE user_id = p_user_id AND deal_id = d.id;
  FOR payment IN SELECT * FROM public.job_payments WHERE job_id = original.id ORDER BY id LOOP
    cumulative := 0;
    allocated := 0;
    FOR target IN SELECT * FROM public.jobs
      WHERE user_id = p_user_id AND deal_id = d.id ORDER BY sale_session_index, id LOOP
      cumulative := cumulative + greatest(0, coalesce(target.sale_gross_amount, 0) - coalesce(target.sale_discount_amount, 0));
      share := CASE WHEN net_total = 0 THEN
        CASE WHEN target.id = first_key THEN payment.amount ELSE 0 END
      ELSE round(payment.amount * cumulative / net_total, 2) - allocated END;
      allocated := allocated + share;
      INSERT INTO public.sale_payment_allocations(user_id, deal_id, job_payment_id, job_id, amount)
        VALUES(p_user_id, d.id, payment.id, target.id, share);
    END LOOP;
  END LOOP;

  FOR target IN SELECT * FROM public.jobs WHERE user_id = p_user_id AND deal_id = d.id LOOP
    SELECT coalesce(sum(amount), 0) INTO paid_for_job
      FROM public.sale_payment_allocations WHERE user_id = p_user_id AND job_id = target.id;
    UPDATE public.jobs SET payment_status = CASE
      WHEN amount = 0 OR paid_for_job >= amount THEN 'paid'
      WHEN paid_for_job > 0 THEN 'partial' ELSE 'pending' END
    WHERE id = target.id AND user_id = p_user_id;
  END LOOP;

  UPDATE public.deals SET converted_job_id = first_key, updated_at = now()
    WHERE id = d.id AND user_id = p_user_id;
  RETURN jsonb_build_object('success', true, 'jobs', jobs_result);
END;
$$;

REVOKE ALL ON FUNCTION public.split_production_job(uuid,bigint,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.split_production_job(uuid,bigint,jsonb)
  TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;


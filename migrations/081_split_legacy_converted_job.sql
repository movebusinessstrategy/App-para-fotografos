-- Allow legacy sales linked only through deals.converted_job_id to be split.
-- Keep the product assignment and payment allocation behavior introduced in 080.
BEGIN;

ALTER TABLE public.deal_items
  ADD COLUMN IF NOT EXISTS job_id bigint REFERENCES public.jobs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_deal_items_job_id ON public.deal_items(job_id);

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
  deal_item_count integer;
  deal_assignment_count integer;
  distinct_deal_assignment_count integer;
  job_item_count integer;
  job_assignment_count integer;
  distinct_job_assignment_count integer;
  legacy_deal_count integer;
  extras numeric(14,2);
  allocation_total numeric(14,2);
  remaining_allocation_capacity numeric(14,2);
  payment_to_allocate numeric(14,2);
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
  IF original.deal_id IS NOT NULL THEN
    SELECT * INTO d FROM public.deals
      WHERE id = original.deal_id AND user_id = p_user_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Venda vinculada não encontrada.'; END IF;
  ELSE
    SELECT count(*) INTO legacy_deal_count FROM public.deals
      WHERE converted_job_id = original.id AND user_id = p_user_id;
    IF legacy_deal_count = 0 THEN
      RAISE EXCEPTION 'Este card não está vinculado a uma venda e não pode ser separado automaticamente.';
    END IF;
    IF legacy_deal_count > 1 THEN
      RAISE EXCEPTION 'Este card está vinculado a mais de uma venda. Revise os vínculos antes de separar.';
    END IF;
    SELECT * INTO d FROM public.deals
      WHERE converted_job_id = original.id AND user_id = p_user_id FOR UPDATE;
  END IF;

  SELECT count(*) INTO existing_count FROM public.jobs
    WHERE user_id = p_user_id AND (deal_id = d.id OR id = d.converted_job_id);
  IF existing_count > 1 THEN
    SELECT jsonb_agg(jsonb_build_object('id', id, 'job_type', job_type, 'job_name', job_name, 'job_date', job_date))
      INTO jobs_result FROM public.jobs
      WHERE user_id = p_user_id AND (deal_id = d.id OR id = d.converted_job_id);
    RETURN jsonb_build_object('success', true, 'already_split', true, 'jobs', coalesce(jobs_result, '[]'::jsonb));
  END IF;

  IF original.deal_id IS NULL THEN
    UPDATE public.jobs SET deal_id = d.id, sale_session_index = 0
      WHERE id = original.id AND user_id = p_user_id;
    original.deal_id := d.id;
  END IF;

  session_count := jsonb_array_length(coalesce(p_sessions, '[]'::jsonb));
  IF session_count NOT BETWEEN 2 AND 20 THEN
    RAISE EXCEPTION 'Informe pelo menos dois ensaios.';
  END IF;
  IF (SELECT count(DISTINCT (value->>'session_index')::integer) FROM jsonb_array_elements(p_sessions)) <> session_count
    OR (SELECT min((value->>'session_index')::integer) FROM jsonb_array_elements(p_sessions)) <> 0
    OR (SELECT max((value->>'session_index')::integer) FROM jsonb_array_elements(p_sessions)) <> session_count - 1 THEN
    RAISE EXCEPTION 'A ordem dos ensaios é inválida.';
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

  SELECT count(*) INTO deal_item_count FROM public.deal_items WHERE deal_id = d.id;
  SELECT count(*), count(DISTINCT assigned.item_id)
    INTO deal_assignment_count, distinct_deal_assignment_count
  FROM jsonb_array_elements(p_sessions) split_session
  CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(split_session.value->'deal_item_ids', '[]'::jsonb)) assigned(item_id);
  IF deal_assignment_count <> deal_item_count OR distinct_deal_assignment_count <> deal_item_count THEN
    RAISE EXCEPTION 'Escolha um único card para cada combo ou produto vendido.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_sessions) split_session
    CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(split_session.value->'deal_item_ids', '[]'::jsonb)) assigned(item_id)
    LEFT JOIN public.deal_items item ON item.id::text = assigned.item_id AND item.deal_id = d.id
    WHERE item.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Um dos produtos vendidos não pertence a esta venda.';
  END IF;

  SELECT count(*) INTO job_item_count FROM public.job_items WHERE job_id = original.id;
  SELECT count(*), count(DISTINCT assigned.item_id)
    INTO job_assignment_count, distinct_job_assignment_count
  FROM jsonb_array_elements(p_sessions) split_session
  CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(split_session.value->'job_item_ids', '[]'::jsonb)) assigned(item_id);
  IF job_assignment_count <> job_item_count OR distinct_job_assignment_count <> job_item_count THEN
    RAISE EXCEPTION 'Escolha um único card para cada item adicional.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_sessions) split_session
    CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(split_session.value->'job_item_ids', '[]'::jsonb)) assigned(item_id)
    LEFT JOIN public.job_items item ON item.id::text = assigned.item_id AND item.job_id = original.id
    WHERE item.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Um dos itens adicionais não pertence ao card atual.';
  END IF;

  FOR session IN SELECT value FROM jsonb_array_elements(p_sessions) LOOP
    IF trim(coalesce(session->>'job_type', '')) = '' OR trim(coalesce(session->>'job_name', '')) = ''
      OR (session->>'gross_amount')::numeric < 0 OR (session->>'discount_amount')::numeric < 0
      OR (session->>'amount')::numeric < 0
      OR (session->>'discount_amount')::numeric > (session->>'gross_amount')::numeric
      OR (session->>'amount')::numeric <> (session->>'gross_amount')::numeric - (session->>'discount_amount')::numeric THEN
      RAISE EXCEPTION 'Dados de um dos ensaios são inválidos.';
    END IF;
    IF (session->>'session_index')::integer = 0 THEN
      job_key := original.id;
      first_key := original.id;
      UPDATE public.jobs SET
        deal_id = d.id, sale_session_index = 0,
        job_type = session->>'job_type', job_name = session->>'job_name',
        job_date = nullif(session->>'job_date', '')::date,
        sale_gross_amount = (session->>'gross_amount')::numeric,
        sale_discount_amount = (session->>'discount_amount')::numeric,
        amount = (session->>'amount')::numeric,
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

    UPDATE public.deal_items SET job_id = job_key
      WHERE deal_id = d.id
        AND id::text IN (
          SELECT value FROM jsonb_array_elements_text(coalesce(session->'deal_item_ids', '[]'::jsonb))
        );
    UPDATE public.job_items SET job_id = job_key
      WHERE id::text IN (
        SELECT value FROM jsonb_array_elements_text(coalesce(session->'job_item_ids', '[]'::jsonb))
      );
    jobs_result := jobs_result || jsonb_build_array(jsonb_build_object(
      'id', job_key, 'job_type', session->>'job_type', 'job_name', session->>'job_name',
      'job_date', session->>'job_date'
    ));
  END LOOP;

  FOR target IN SELECT * FROM public.jobs
    WHERE user_id = p_user_id AND deal_id = d.id ORDER BY sale_session_index, id LOOP
    SELECT coalesce(sum(greatest(0, catalog_value * quantidade - coalesce(discount_value, 0))), 0)
      INTO extras FROM public.job_items WHERE job_id = target.id;
    UPDATE public.jobs SET amount = coalesce(sale_gross_amount, 0) - coalesce(sale_discount_amount, 0) + extras
      WHERE id = target.id AND user_id = p_user_id;
  END LOOP;
  SELECT coalesce(sum(amount), 0) INTO allocation_total FROM public.jobs
    WHERE user_id = p_user_id AND deal_id = d.id;
  remaining_allocation_capacity := greatest(0, allocation_total);

  DELETE FROM public.sale_payment_allocations
    WHERE user_id = p_user_id AND deal_id = d.id;
  -- Keep every source payment intact. Only the slice that fits in the final
  -- card totals is attributed; the difference remains unassigned credit.
  FOR payment IN SELECT * FROM public.job_payments
    WHERE job_id = original.id ORDER BY payment_date, created_at, id LOOP
    payment_to_allocate := least(
      greatest(0, coalesce(payment.amount, 0)),
      remaining_allocation_capacity
    );
    IF payment_to_allocate = 0 THEN CONTINUE; END IF;
    cumulative := 0;
    allocated := 0;
    FOR target IN SELECT * FROM public.jobs
      WHERE user_id = p_user_id AND deal_id = d.id ORDER BY sale_session_index, id LOOP
      cumulative := cumulative + greatest(0, target.amount);
      share := round(payment_to_allocate * cumulative / allocation_total, 2) - allocated;
      allocated := allocated + share;
      IF share > 0 THEN
        INSERT INTO public.sale_payment_allocations(user_id, deal_id, job_payment_id, job_id, amount)
          VALUES(p_user_id, d.id, payment.id, target.id, share);
      END IF;
    END LOOP;
    remaining_allocation_capacity := greatest(0, remaining_allocation_capacity - payment_to_allocate);
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

-- One commercial sale, independently scheduled/contracted production jobs.
-- Existing rows retain their values and the legacy session index (0).
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS sale_session_index integer NOT NULL DEFAULT 0;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS sale_gross_amount numeric(14,2);
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS sale_discount_amount numeric(14,2) NOT NULL DEFAULT 0;
ALTER TABLE public.jobs ALTER COLUMN job_date DROP NOT NULL;
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS discount numeric(14,2) NOT NULL DEFAULT 0;
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS sale_gross_amount numeric(14,2);
CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_user_deal_session_unique
  ON public.jobs(user_id, deal_id, sale_session_index) WHERE deal_id IS NOT NULL;
DROP INDEX IF EXISTS public.idx_jobs_user_deal_unique;

-- Only the trusted server may call these functions. Tenant identity comes from
-- requireAuth, never the submitted payload. Row locks serialize server instances.
CREATE OR REPLACE FUNCTION public.create_deal_priced(p_user_id uuid, p_payload jsonb, p_items jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  d public.deals%ROWTYPE := jsonb_populate_record(null::public.deals,p_payload);
  deal_key bigint;
BEGIN
  IF d.sale_gross_amount IS NULL OR d.discount IS NULL OR d.sale_gross_amount<0 OR d.discount<0 OR d.discount>d.sale_gross_amount THEN
    RAISE EXCEPTION 'Valores da venda inválidos.';
  END IF;
  IF d.client_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM clients WHERE id=d.client_id AND user_id=p_user_id) THEN
    RAISE EXCEPTION 'Selecione um cliente desta conta.';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM deal_stages WHERE id=d.stage AND user_id=p_user_id AND NOT coalesce(is_won,false) AND process_id IS NULL) THEN
    RAISE EXCEPTION 'Selecione uma etapa aberta desta conta.';
  END IF;
  IF jsonb_typeof(p_items)<>'array' OR jsonb_array_length(p_items)>100 THEN RAISE EXCEPTION 'Itens inválidos.'; END IF;
  IF jsonb_array_length(p_items)>0 AND (SELECT sum((value->>'catalog_value')::numeric*(value->>'quantidade')::integer) FROM jsonb_array_elements(p_items))<>d.sale_gross_amount THEN
    RAISE EXCEPTION 'O valor dos itens precisa corresponder ao valor da venda antes do desconto.';
  END IF;
  INSERT INTO public.deals(user_id,client_id,title,contact_name,contact_phone,contact_email,lead_source,value,sale_gross_amount,discount,
    stage,stage_entered_at,current_stage_entered_at,stage_history,priority,expected_close_date,next_follow_up,notes,assigned_to,campaign_id,updated_at)
  VALUES(p_user_id,d.client_id,d.title,d.contact_name,d.contact_phone,d.contact_email,d.lead_source,d.sale_gross_amount-d.discount,d.sale_gross_amount,d.discount,
    d.stage,now(),now(),d.stage_history,coalesce(d.priority,'medium'),d.expected_close_date,d.next_follow_up,d.notes,d.assigned_to,d.campaign_id,now()) RETURNING id INTO deal_key;
  INSERT INTO public.deal_items(deal_id,catalog_type,catalog_id,catalog_name,catalog_value,quantidade)
    SELECT deal_key,value->>'catalog_type',value->>'catalog_id',value->>'catalog_name',(value->>'catalog_value')::numeric,(value->>'quantidade')::integer FROM jsonb_array_elements(p_items);
  RETURN jsonb_build_object('id',deal_key,'items_saved',true);
END $$;
REVOKE ALL ON FUNCTION public.create_deal_priced(uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_deal_priced(uuid,jsonb,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.convert_deal_sessions(p_user_id uuid, p_deal_id bigint, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  d public.deals%ROWTYPE;
  c public.clients%ROWTYPE;
  s jsonb;
  u jsonb := p_payload->'updates';
  client_key bigint;
  job_key bigint;
  reserved_key bigint;
  reuse_key bigint := nullif(p_payload->>'existing_job_id', '')::bigint;
  first_key bigint;
  result_jobs jsonb := '[]';
  duplicates jsonb;
  gross numeric := (p_payload->>'gross_amount')::numeric;
  reduction numeric := (p_payload->>'discount')::numeric;
  signal numeric := (p_payload->>'signal_amount')::numeric;
  session_count integer;
BEGIN
  SELECT * INTO d FROM public.deals WHERE id=p_deal_id AND user_id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Venda não encontrada.'; END IF;
  IF EXISTS(SELECT 1 FROM jobs WHERE deal_id=d.id AND user_id=p_user_id AND sale_gross_amount IS NOT NULL AND status='cancelled') AND NOT coalesce(d.converted,false) THEN
    RAISE EXCEPTION 'Esta venda foi cancelada. Registre uma nova venda se o cliente contratar novamente.';
  END IF;
  IF d.converted OR d.converted_job_id IS NOT NULL THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'job_date',job_date,'job_type',job_type) ORDER BY sale_session_index),'[]')
      INTO result_jobs FROM public.jobs WHERE user_id=p_user_id AND deal_id=d.id;
    RETURN jsonb_build_object('success',true,'already_converted',true,'items_saved',true,'job_id',d.converted_job_id,'client_id',d.client_id,'jobs',result_jobs);
  END IF;
  session_count := jsonb_array_length(p_payload->'sessions');
  IF session_count NOT BETWEEN 1 AND 20 OR gross IS NULL OR reduction IS NULL OR signal IS NULL
    OR gross < 0 OR reduction < 0 OR reduction > gross OR signal < 0 OR signal > gross-reduction THEN
    RAISE EXCEPTION 'Valores da venda inválidos.';
  END IF;
  IF (SELECT sum((value->>'gross_amount')::numeric) FROM jsonb_array_elements(p_payload->'sessions')) <> gross
    OR (SELECT sum((value->>'discount_amount')::numeric) FROM jsonb_array_elements(p_payload->'sessions')) <> reduction
    OR (SELECT sum((value->>'signal_amount')::numeric) FROM jsonb_array_elements(p_payload->'sessions')) <> signal THEN
    RAISE EXCEPTION 'Rateio dos ensaios inválido.';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.deal_stages WHERE id=p_payload->>'entry_stage' AND user_id::text=p_user_id::text AND process_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Configure uma etapa de entrada na produção antes de fechar a venda.';
  END IF;
  client_key := nullif(p_payload->>'client_id','')::bigint;
  IF coalesce((p_payload->>'create_client')::boolean,false) THEN
    c := jsonb_populate_record(null::public.clients, p_payload->'client');
    INSERT INTO public.clients(name,phone,email,cpf,birth_date,address,address_number,address_complement,neighborhood,city,state,cep,instagram,lead_source,notes,status,user_id)
      VALUES(c.name,c.phone,c.email,c.cpf,c.birth_date,c.address,c.address_number,c.address_complement,c.neighborhood,c.city,c.state,c.cep,c.instagram,c.lead_source,c.notes,'active',p_user_id)
      RETURNING id INTO client_key;
  ELSIF NOT EXISTS(SELECT 1 FROM public.clients WHERE id=client_key AND user_id=p_user_id) THEN
    RAISE EXCEPTION 'Selecione um cliente desta conta.';
  END IF;
  SELECT id INTO reserved_key FROM public.jobs WHERE user_id=p_user_id AND deal_id=d.id AND status='pre_reserved' FOR UPDATE;
  IF reuse_key IS NOT NULL AND session_count <> 1 THEN RAISE EXCEPTION 'Vincule um ensaio existente em uma venda de ensaio único.'; END IF;
  FOR s IN SELECT value FROM jsonb_array_elements(p_payload->'sessions') LOOP
    IF (s->>'gross_amount')::numeric < 0 OR (s->>'discount_amount')::numeric < 0
      OR (s->>'amount')::numeric <> (s->>'gross_amount')::numeric-(s->>'discount_amount')::numeric
      OR (s->>'amount')::numeric < 0 OR (s->>'signal_amount')::numeric > (s->>'amount')::numeric THEN
      RAISE EXCEPTION 'Valor do ensaio inválido.';
    END IF;
    IF reuse_key IS NULL AND NOT coalesce((p_payload->>'force')::boolean,false) AND s->>'job_date' IS NOT NULL THEN
      SELECT jsonb_agg(jsonb_build_object('id',id,'job_name',job_name,'job_type',job_type,'job_date',job_date,'in_production',production_stage IS NOT NULL,'can_reuse',deal_id IS NULL AND session_count=1))
      INTO duplicates FROM public.jobs WHERE user_id=p_user_id AND client_id=client_key AND job_type=s->>'job_type'
        AND job_date=s->>'job_date' AND status='scheduled' AND id IS DISTINCT FROM reserved_key;
      IF duplicates IS NOT NULL THEN
        -- Raising rolls back a newly inserted client as well.
        RAISE EXCEPTION USING MESSAGE='duplicate_job', DETAIL=duplicates::text;
      END IF;
    END IF;
    job_key := null;
    IF (s->>'session_index')::integer=0 THEN job_key := coalesce(reuse_key,reserved_key); END IF;
    IF reuse_key IS NOT NULL THEN
      PERFORM 1 FROM public.jobs WHERE id=reuse_key AND user_id=p_user_id AND client_id=client_key
        AND deal_id IS NULL AND job_type=s->>'job_type' AND job_date=s->>'job_date'
        AND status='scheduled' FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'O ensaio existente não pode ser vinculado a esta venda.'; END IF;
      IF EXISTS(SELECT 1 FROM public.job_payments WHERE job_id=reuse_key) THEN
        RAISE EXCEPTION 'O ensaio existente já tem pagamentos. Revise o financeiro antes de vinculá-lo.';
      END IF;
    END IF;
    IF job_key IS NULL THEN
      INSERT INTO public.jobs(user_id,client_id,deal_id,sale_session_index,job_type,job_name,job_date,job_time,job_end_time,amount,sale_gross_amount,sale_discount_amount,payment_method,payment_status,status,notes,production_stage,production_stage_entered_at)
      VALUES(p_user_id,client_key,d.id,(s->>'session_index')::integer,s->>'job_type',s->>'job_name',(s->>'job_date')::date,
        s->>'job_time',s->>'job_end_time',(s->>'amount')::numeric,(s->>'gross_amount')::numeric,(s->>'discount_amount')::numeric,
        p_payload->>'payment_method','pending','scheduled',s->>'notes',p_payload->>'entry_stage',now()) RETURNING id INTO job_key;
    ELSE
      UPDATE public.jobs SET client_id=client_key,deal_id=d.id,sale_session_index=0,job_type=s->>'job_type',job_name=s->>'job_name',
        job_date=(s->>'job_date')::date,job_time=s->>'job_time',job_end_time=s->>'job_end_time',
        amount=(s->>'amount')::numeric,sale_gross_amount=(s->>'gross_amount')::numeric,sale_discount_amount=(s->>'discount_amount')::numeric,
        payment_method=p_payload->>'payment_method',status='scheduled',
        production_stage=coalesce(production_stage,p_payload->>'entry_stage'),production_stage_entered_at=coalesce(production_stage_entered_at,now())
        WHERE id=job_key AND user_id=p_user_id;
    END IF;
    IF first_key IS NULL THEN first_key := job_key; END IF;
    IF (s->>'signal_amount')::numeric > 0 THEN
      INSERT INTO public.job_payments(job_id,amount,description,payment_date,payment_method)
        VALUES(job_key,(s->>'signal_amount')::numeric,'Sinal — rateio da venda',left(u->>'converted_at',10)::date,p_payload->>'payment_method');
    END IF;
    UPDATE public.jobs SET payment_status=CASE WHEN amount=0 THEN 'paid' WHEN (s->>'signal_amount')::numeric=0 THEN 'pending'
      WHEN (s->>'signal_amount')::numeric>=amount THEN 'paid' ELSE 'partial' END WHERE id=job_key AND user_id=p_user_id;
    result_jobs := result_jobs || jsonb_build_array(jsonb_build_object('id',job_key,'job_type',s->>'job_type','job_date',s->>'job_date'));
  END LOOP;
  IF p_payload ? 'invite_email' THEN UPDATE public.clients SET email=p_payload->>'invite_email' WHERE id=client_key AND user_id=p_user_id; END IF;
  INSERT INTO public.deal_items(deal_id,catalog_type,catalog_id,catalog_name,catalog_value,quantidade)
    SELECT d.id,value->>'catalog_type',value->>'catalog_id',value->>'catalog_name',(value->>'catalog_value')::numeric,(value->>'quantidade')::integer
    FROM jsonb_array_elements(coalesce(p_payload->'items','[]'));
  UPDATE public.deals SET stage=u->>'stage',stage_entered_at=now(),current_stage_entered_at=now(),stage_history=u->'stage_history',
    converted=true,converted_at=(u->>'converted_at')::timestamptz,converted_client_id=client_key,converted_job_id=first_key,client_id=client_key,
    value=gross-reduction,sale_gross_amount=gross,discount=reduction,temperature='hot',temperature_locked=true,
    campaign_id=coalesce(nullif(u->>'campaign_id','')::uuid,campaign_id),updated_at=now() WHERE id=d.id AND user_id=p_user_id;
  RETURN jsonb_build_object('success',true,'items_saved',true,'job_id',first_key,'client_id',client_key,'jobs',result_jobs);
END;
$$;
REVOKE ALL ON FUNCTION public.convert_deal_sessions(uuid,bigint,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.convert_deal_sessions(uuid,bigint,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.update_deal_pricing(p_user_id uuid,p_deal_id bigint,p_gross numeric,p_discount numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  d public.deals%ROWTYPE;
  j public.jobs%ROWTYPE;
  weights numeric;
  cumulative numeric := 0;
  allocated numeric := 0;
  discount_allocated numeric := 0;
  next_gross numeric;
  next_discount numeric;
  extras numeric;
  paid numeric;
BEGIN
  SELECT * INTO d FROM public.deals WHERE id=p_deal_id AND user_id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Venda não encontrada.'; END IF;
  IF p_gross IS NULL OR p_discount IS NULL OR p_gross<0 OR p_discount<0 OR p_discount>p_gross THEN RAISE EXCEPTION 'Desconto inválido.'; END IF;
  p_gross := round(p_gross,2); p_discount := round(p_discount,2);
  SELECT sum(coalesce(sale_gross_amount,0)) INTO weights FROM public.jobs WHERE deal_id=d.id AND user_id=p_user_id;
  -- Old single-job conversions become explicit allocations on first edit.
  IF coalesce(weights,0)=0 THEN
    UPDATE public.jobs SET sale_gross_amount=1 WHERE user_id=p_user_id AND (deal_id=d.id OR id=d.converted_job_id);
    SELECT sum(sale_gross_amount) INTO weights FROM public.jobs WHERE user_id=p_user_id AND (deal_id=d.id OR id=d.converted_job_id);
  END IF;
  FOR j IN SELECT * FROM public.jobs WHERE user_id=p_user_id AND (deal_id=d.id OR id=d.converted_job_id) ORDER BY sale_session_index,id FOR UPDATE LOOP
    cumulative := cumulative+coalesce(j.sale_gross_amount,0);
    next_gross := round(p_gross*cumulative/weights,2)-allocated;
    allocated := allocated+next_gross;
    next_discount := CASE WHEN p_gross=0 THEN 0 ELSE round(p_discount*allocated/p_gross,2)-discount_allocated END;
    discount_allocated := discount_allocated+next_discount;
    SELECT coalesce(sum(greatest(0,catalog_value*quantidade-coalesce(discount_value,0))),0) INTO extras FROM public.job_items WHERE job_id=j.id;
    SELECT coalesce(sum(amount),0) INTO paid FROM public.job_payments WHERE job_id=j.id;
    UPDATE public.jobs SET deal_id=d.id,sale_gross_amount=next_gross,sale_discount_amount=next_discount,amount=next_gross-next_discount+extras,
      payment_status=CASE WHEN next_gross-next_discount+extras=0 OR paid>=next_gross-next_discount+extras THEN 'paid' WHEN paid>0 THEN 'partial' ELSE 'pending' END
      WHERE id=j.id AND user_id=p_user_id;
  END LOOP;
  UPDATE public.deals SET sale_gross_amount=p_gross,discount=p_discount,value=p_gross-p_discount,updated_at=now() WHERE id=d.id AND user_id=p_user_id;
  RETURN jsonb_build_object('success',true,'gross',p_gross,'discount',p_discount,'value',p_gross-p_discount);
END;
$$;
REVOKE ALL ON FUNCTION public.update_deal_pricing(uuid,bigint,numeric,numeric) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.update_deal_pricing(uuid,bigint,numeric,numeric) TO service_role;

CREATE OR REPLACE FUNCTION public.cancel_deal_sessions(p_user_id uuid,p_deal_id bigint,p_updates jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  PERFORM 1 FROM deals WHERE id=p_deal_id AND user_id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Venda não encontrada.'; END IF;
  IF NOT EXISTS(SELECT 1 FROM deal_stages WHERE id=p_updates->>'stage' AND user_id=p_user_id AND is_final AND NOT is_won) THEN
    RAISE EXCEPTION 'Etapa de cancelamento inválida.';
  END IF;
  UPDATE jobs SET status='cancelled',production_stage=null,google_event_id=null WHERE deal_id=p_deal_id AND user_id=p_user_id;
  UPDATE deals SET converted=false,converted_at=null,converted_job_id=null,stage=p_updates->>'stage',stage_history=p_updates->'stage_history',
    lost_reason=p_updates->>'reason',temperature='cold',temperature_locked=true,updated_at=now(),stage_entered_at=now(),current_stage_entered_at=now()
    WHERE id=p_deal_id AND user_id=p_user_id;
  -- Keep job links, contracts and payment history for audit. A cancelled sale
  -- cannot be converted again and accidentally create another set of cards.
END;
$$;
REVOKE ALL ON FUNCTION public.cancel_deal_sessions(uuid,bigint,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_deal_sessions(uuid,bigint,jsonb) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;

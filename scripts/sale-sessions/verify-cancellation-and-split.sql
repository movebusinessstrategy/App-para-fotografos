DO $$
DECLARE
  uid uuid := '11111111-1111-1111-1111-111111111111';
  deal_key bigint;
  job_key bigint;
  gestante_item uuid;
  newborn_item uuid;
  album_item uuid;
  legacy_deal_key bigint;
  legacy_job_key bigint;
  legacy_gestante_item uuid;
  legacy_newborn_item uuid;
  legacy_extra_item uuid;
  cancelled_legacy_deal_key bigint;
  cancelled_legacy_job_key bigint;
  cancelled_legacy_cancellation_key uuid;
  guard_deal_key bigint;
  guard_job_key bigint;
  guard_first_item uuid;
  guard_second_item uuid;
  result jsonb;
BEGIN
  INSERT INTO clients(name,user_id) VALUES('Cliente Teste',uid);
  INSERT INTO deal_stages(id,name,is_final,is_won,user_id,process_id)
    VALUES('entrada','Entrada',false,false,uid,'processo'),('perdido','Perdido',true,false,uid,null);
  INSERT INTO deals(user_id,client_id,title,value,sale_gross_amount,discount,stage,converted,converted_at)
    VALUES(uid,1,'Gestante e Newborn',2200,2200,0,'entrada',true,now()) RETURNING id INTO deal_key;
  INSERT INTO jobs(user_id,client_id,deal_id,sale_session_index,job_type,job_name,job_date,amount,sale_gross_amount,sale_discount_amount,payment_method,payment_status,status,production_stage)
    VALUES(uid,1,deal_key,0,'Gestante e Newborn','Gestante e Newborn','2026-10-01',2200,2200,0,'Pix','partial','scheduled','entrada') RETURNING id INTO job_key;
  UPDATE deals SET converted_job_id=job_key WHERE id=deal_key;
  INSERT INTO deal_items(deal_id,catalog_type,catalog_id,catalog_name,catalog_value,quantidade)
    VALUES(deal_key,'combo','combo-gestante','Gestante Premium',880,1) RETURNING id INTO gestante_item;
  INSERT INTO deal_items(deal_id,catalog_type,catalog_id,catalog_name,catalog_value,quantidade)
    VALUES(deal_key,'combo','combo-newborn','Newborn Premium',1320,1) RETURNING id INTO newborn_item;
  INSERT INTO job_items(job_id,catalog_type,catalog_id,catalog_name,catalog_value,quantidade,discount_value)
    VALUES(job_key,'produto','album-newborn','Álbum Newborn',300,1,0) RETURNING id INTO album_item;
  INSERT INTO job_payments(job_id,amount,description,payment_date,payment_method)
    VALUES(job_key,500,'Sinal','2026-09-16','Pix');

  result := split_production_job(uid,job_key,jsonb_build_array(
    jsonb_build_object('session_index',0,'job_type','Gestante','job_name','Ensaio Gestante','job_date','2026-10-01','production_stage','entrada','gross_amount',880,'discount_amount',0,'amount',880,
      'deal_item_ids',jsonb_build_array(gestante_item),'job_item_ids','[]'::jsonb),
    jsonb_build_object('session_index',1,'job_type','Newborn','job_name','Ensaio Newborn','job_date',null,'production_stage','entrada','gross_amount',1320,'discount_amount',0,'amount',1320,
      'deal_item_ids',jsonb_build_array(newborn_item),'job_item_ids',jsonb_build_array(album_item))
  ));
  ASSERT result->>'success'='true','split failed';
  ASSERT (SELECT count(*) FROM jobs WHERE deal_id=deal_key)=2,'split must create exactly two jobs';
  ASSERT (SELECT count(*) FROM jobs WHERE id=job_key AND job_type='Gestante')=1,'original job was not preserved';
  ASSERT (SELECT count(*) FROM deal_items i JOIN jobs j ON j.id=i.job_id WHERE i.id=gestante_item AND j.job_type='Gestante')=1,'gestante combo stayed on wrong card';
  ASSERT (SELECT count(*) FROM deal_items i JOIN jobs j ON j.id=i.job_id WHERE i.id=newborn_item AND j.job_type='Newborn')=1,'newborn combo stayed on wrong card';
  ASSERT (SELECT count(*) FROM job_items i JOIN jobs j ON j.id=i.job_id WHERE i.id=album_item AND j.job_type='Newborn')=1,'additional product stayed on wrong card';
  ASSERT (SELECT amount FROM jobs WHERE job_type='Gestante' AND deal_id=deal_key)=880,'gestante total incorrect';
  ASSERT (SELECT amount FROM jobs WHERE job_type='Newborn' AND deal_id=deal_key)=1620,'newborn total must include moved album';
  ASSERT (SELECT sum(amount) FROM job_payments)=500,'cash was duplicated';
  ASSERT (SELECT sum(amount) FROM sale_payment_allocations WHERE deal_id=deal_key)=500,'payment allocations do not close';
  ASSERT (SELECT sum(a.amount) FROM sale_payment_allocations a JOIN jobs j ON j.id=a.job_id WHERE j.job_type='Gestante')=176,'gestante allocation incorrect';
  ASSERT (SELECT sum(a.amount) FROM sale_payment_allocations a JOIN jobs j ON j.id=a.job_id WHERE j.job_type='Newborn')=324,'newborn allocation incorrect';

  -- Even a crafted payload whose global totals close cannot create a card with
  -- a discount above its gross value (and therefore a negative card amount).
  INSERT INTO deals(user_id,client_id,title,value,sale_gross_amount,discount,stage,converted,converted_at)
    VALUES(uid,1,'Venda para validar card negativo',700,1000,300,'entrada',true,now()) RETURNING id INTO guard_deal_key;
  INSERT INTO jobs(user_id,client_id,deal_id,sale_session_index,job_type,job_name,job_date,amount,payment_method,payment_status,status,production_stage)
    VALUES(uid,1,guard_deal_key,0,'Gestante e Newborn','Card protegido','2026-10-10',700,'Pix','pending','scheduled','entrada')
    RETURNING id INTO guard_job_key;
  UPDATE deals SET converted_job_id=guard_job_key WHERE id=guard_deal_key;
  INSERT INTO deal_items(deal_id,catalog_type,catalog_id,catalog_name,catalog_value,quantidade)
    VALUES(guard_deal_key,'combo','guard-first','Primeiro combo',100,1) RETURNING id INTO guard_first_item;
  INSERT INTO deal_items(deal_id,catalog_type,catalog_id,catalog_name,catalog_value,quantidade)
    VALUES(guard_deal_key,'combo','guard-second','Segundo combo',900,1) RETURNING id INTO guard_second_item;
  BEGIN
    PERFORM split_production_job(uid,guard_job_key,jsonb_build_array(
      jsonb_build_object('session_index',0,'job_type','Gestante','job_name','Card negativo','job_date','2026-10-10','production_stage','entrada','gross_amount',100,'discount_amount',200,'amount',-100,
        'deal_item_ids',jsonb_build_array(guard_first_item),'job_item_ids','[]'::jsonb),
      jsonb_build_object('session_index',1,'job_type','Newborn','job_name','Card positivo','job_date',null,'production_stage','entrada','gross_amount',900,'discount_amount',100,'amount',800,
        'deal_item_ids',jsonb_build_array(guard_second_item),'job_item_ids','[]'::jsonb)
    ));
    ASSERT false,'crafted negative card was accepted';
  EXCEPTION WHEN OTHERS THEN
    ASSERT SQLERRM='Dados de um dos ensaios são inválidos.',
      'crafted negative card returned an unexpected error';
  END;
  ASSERT (SELECT count(*) FROM jobs WHERE deal_id=guard_deal_key)=1,'invalid split left an extra card';
  ASSERT (SELECT amount FROM jobs WHERE id=guard_job_key)=700,'invalid split changed the original card';

  result := split_production_job(uid,job_key,'[]'::jsonb);
  ASSERT result->>'already_split'='true','split retry must be idempotent';
  ASSERT (SELECT count(*) FROM jobs WHERE deal_id=deal_key)=2,'split retry duplicated jobs';

  -- Legacy sales used deals.converted_job_id without filling jobs.deal_id.
  INSERT INTO deals(user_id,client_id,title,value,sale_gross_amount,discount,stage,converted,converted_at)
    VALUES(uid,1,'Gestante e Newborn legado',4243,4243,0,'entrada',true,now()) RETURNING id INTO legacy_deal_key;
  INSERT INTO jobs(user_id,client_id,job_type,job_name,job_date,amount,payment_method,payment_status,status,production_stage)
    VALUES(uid,1,'Gestante e Newborn','Gestante e Newborn legado','2026-11-01',5143,'Pix','partial','scheduled','entrada')
    RETURNING id INTO legacy_job_key;
  UPDATE deals SET converted_job_id=legacy_job_key WHERE id=legacy_deal_key;
  INSERT INTO deal_items(deal_id,catalog_type,catalog_id,catalog_name,catalog_value,quantidade)
    VALUES(legacy_deal_key,'combo','combo-gestante-legado','Gestante Premium',1490,1) RETURNING id INTO legacy_gestante_item;
  INSERT INTO deal_items(deal_id,catalog_type,catalog_id,catalog_name,catalog_value,quantidade)
    VALUES(legacy_deal_key,'combo','combo-newborn-legado','Newborn Super Premium',2753,1) RETURNING id INTO legacy_newborn_item;
  INSERT INTO job_items(job_id,catalog_type,catalog_id,catalog_name,catalog_value,quantidade,discount_value)
    VALUES(legacy_job_key,'produto','foto-digital-legado','Foto Digital e Revelada',30,30,0) RETURNING id INTO legacy_extra_item;
  INSERT INTO job_payments(job_id,amount,description,payment_date,payment_method)
    VALUES(legacy_job_key,3000,'Primeiro recebimento legado','2026-09-16','Pix'),
      (legacy_job_key,2144,'Segundo recebimento legado','2026-09-17','Pix');

  result := split_production_job(uid,legacy_job_key,jsonb_build_array(
    jsonb_build_object('session_index',0,'job_type','Gestante','job_name','Ensaio Gestante legado','job_date','2026-11-01','production_stage','entrada','gross_amount',1490,'discount_amount',0,'amount',1490,
      'deal_item_ids',jsonb_build_array(legacy_gestante_item),'job_item_ids',jsonb_build_array(legacy_extra_item)),
    jsonb_build_object('session_index',1,'job_type','Newborn','job_name','Ensaio Newborn legado','job_date',null,'production_stage','entrada','gross_amount',2753,'discount_amount',0,'amount',2753,
      'deal_item_ids',jsonb_build_array(legacy_newborn_item),'job_item_ids','[]'::jsonb)
  ));
  ASSERT result->>'success'='true','legacy split failed';
  ASSERT (SELECT deal_id FROM jobs WHERE id=legacy_job_key)=legacy_deal_key,'legacy job deal link was not backfilled';
  ASSERT (SELECT count(*) FROM jobs WHERE deal_id=legacy_deal_key)=2,'legacy split must create exactly two linked jobs';
  ASSERT (SELECT count(*) FROM jobs WHERE id=legacy_job_key AND job_type='Gestante')=1,'legacy original job was not preserved';
  ASSERT (SELECT count(*) FROM deal_items i JOIN jobs j ON j.id=i.job_id WHERE i.id=legacy_gestante_item AND j.id=legacy_job_key)=1,'legacy gestante combo stayed on wrong card';
  ASSERT (SELECT count(*) FROM deal_items i JOIN jobs j ON j.id=i.job_id WHERE i.id=legacy_newborn_item AND j.job_type='Newborn')=1,'legacy newborn combo stayed on wrong card';
  ASSERT (SELECT count(*) FROM job_items WHERE id=legacy_extra_item AND job_id=legacy_job_key)=1,'legacy additional product stayed on wrong card';
  ASSERT (SELECT sum(amount) FROM jobs WHERE deal_id=legacy_deal_key)=5143,'legacy split totals do not include the additional product';
  ASSERT (SELECT count(*) FROM job_payments WHERE job_id=legacy_job_key)=2,'legacy split duplicated payments';
  ASSERT (SELECT sum(amount) FROM job_payments WHERE job_id=legacy_job_key)=5144,'legacy split changed received cash';
  ASSERT (SELECT sum(amount) FROM sale_payment_allocations WHERE deal_id=legacy_deal_key)=5143,'legacy allocations must stop at the card total';
  ASSERT (SELECT sum(p.amount) FROM job_payments p WHERE p.job_id=legacy_job_key)
    - (SELECT sum(a.amount) FROM sale_payment_allocations a WHERE a.deal_id=legacy_deal_key)=1,
    'legacy excess must stay as unassigned credit';
  ASSERT NOT EXISTS(
    SELECT 1 FROM jobs j
    LEFT JOIN sale_payment_allocations a ON a.job_id=j.id AND a.user_id=uid
    WHERE j.deal_id=legacy_deal_key
    GROUP BY j.id,j.amount
    HAVING coalesce(sum(a.amount),0)>j.amount
  ),'a card received more payment than its final total';

  result := split_production_job(uid,legacy_job_key,'[]'::jsonb);
  ASSERT result->>'already_split'='true','legacy split retry must be idempotent';
  ASSERT (SELECT count(*) FROM jobs WHERE deal_id=legacy_deal_key)=2,'legacy split retry duplicated jobs';
  ASSERT (SELECT count(*) FROM deal_items WHERE deal_id=legacy_deal_key AND job_id IS NOT NULL)=2,'legacy split retry lost product destinations';
  ASSERT (SELECT count(*) FROM job_items WHERE id=legacy_extra_item AND job_id=legacy_job_key)=1,'legacy split retry moved the additional product';
  ASSERT (SELECT sum(amount) FROM job_payments WHERE job_id=legacy_job_key)=5144,'legacy split retry changed received cash';
  ASSERT (SELECT sum(amount) FROM sale_payment_allocations WHERE deal_id=legacy_deal_key)=5143,'legacy split retry changed allocations';

  result := cancel_sale_with_refund(uid,deal_key,jsonb_build_object(
    'reason','Cliente desistiu','refund_status','pending','refund_expected',500,
    'refund_paid',0,'refund_due_date','2026-09-20','stage','perdido','stage_history','[]'::jsonb
  ));
  ASSERT result->>'success'='true','cancel failed';
  ASSERT (SELECT count(*) FROM jobs WHERE deal_id=deal_key AND status='cancelled')=2,'all jobs must be cancelled';
  ASSERT (SELECT sum(amount) FROM job_payments WHERE job_id=job_key)=500,'cancel erased or changed cash';
  ASSERT (SELECT count(*) FROM sale_cancellations WHERE deal_id=deal_key)=1,'cancellation audit missing';
  ASSERT (SELECT count(*) FROM fin_despesas WHERE sale_cancellation_id IS NOT NULL AND status='pendente' AND valor=500)=1,'pending refund expense missing';

  result := record_sale_refund(uid,(SELECT id FROM sale_cancellations WHERE deal_id=deal_key),jsonb_build_object(
    'amount',500,'refund_date','2026-09-18','payment_method','Pix',
    'idempotency_key','original-refund-final-1'
  ));
  ASSERT result->>'refund_status'='refunded','refund should be completed';
  ASSERT (SELECT refund_paid FROM sale_cancellations WHERE deal_id=deal_key)=500,'paid refund total incorrect';
  ASSERT (SELECT count(*) FROM sale_refunds WHERE amount=500)=1,'refund audit missing';
  ASSERT (SELECT count(*) FROM fin_despesas WHERE sale_cancellation_id IS NOT NULL AND status='pago' AND valor=500)=1,'paid refund expense missing';

  result := cancel_sale_with_refund(uid,deal_key,jsonb_build_object('reason','retry'));
  ASSERT result->>'already_cancelled'='true','cancel retry must be idempotent';
  ASSERT (SELECT count(*) FROM fin_despesas WHERE sale_cancellation_id IS NOT NULL)=2,'cancel retry duplicated expenses';

  -- Cancelling a legacy card must persist its sale link before converted_job_id
  -- is cleared, otherwise the card can no longer load the refund context.
  INSERT INTO deals(user_id,client_id,title,value,sale_gross_amount,discount,stage,converted,converted_at)
    VALUES(uid,1,'Venda legada cancelada',600,600,0,'entrada',true,now())
    RETURNING id INTO cancelled_legacy_deal_key;
  INSERT INTO jobs(user_id,client_id,sale_session_index,job_type,job_name,job_date,amount,payment_method,payment_status,status,production_stage)
    VALUES(uid,1,7,'Newborn','Newborn legado cancelado','2026-12-01',600,'Pix','paid','scheduled','entrada')
    RETURNING id INTO cancelled_legacy_job_key;
  UPDATE deals SET converted_job_id=cancelled_legacy_job_key WHERE id=cancelled_legacy_deal_key;
  INSERT INTO job_payments(job_id,amount,description,payment_date,payment_method)
    VALUES(cancelled_legacy_job_key,600,'Pagamento da venda legada','2026-09-17','Pix');

  result := cancel_sale_with_refund(uid,cancelled_legacy_deal_key,jsonb_build_object(
    'reason','Cliente desistiu','refund_status','pending','refund_expected',600,
    'refund_paid',0,'refund_due_date','2026-09-25','stage','perdido','stage_history','[]'::jsonb
  ));
  ASSERT result->>'success'='true','legacy cancellation failed';
  ASSERT (SELECT converted_job_id FROM deals WHERE id=cancelled_legacy_deal_key) IS NULL,'legacy deal kept converted_job_id after cancellation';
  ASSERT (SELECT deal_id FROM jobs WHERE id=cancelled_legacy_job_key)=cancelled_legacy_deal_key,'legacy cancellation did not persist the job deal link';
  ASSERT (SELECT sale_session_index FROM jobs WHERE id=cancelled_legacy_job_key)=0,'legacy cancellation did not normalize the session index';
  ASSERT (SELECT status FROM jobs WHERE id=cancelled_legacy_job_key)='cancelled','legacy job was not cancelled';
  ASSERT (SELECT count(*) FROM jobs j JOIN deals d ON d.id=j.deal_id AND d.user_id=j.user_id
    WHERE j.id=cancelled_legacy_job_key AND d.id=cancelled_legacy_deal_key)=1,
    'cancelled legacy card can no longer recover its sale context';
  SELECT id INTO cancelled_legacy_cancellation_key FROM sale_cancellations
    WHERE user_id=uid AND deal_id=cancelled_legacy_deal_key;

  BEGIN
    PERFORM record_sale_refund(uid,cancelled_legacy_cancellation_key,jsonb_build_object(
      'amount',200,'refund_date','2026-09-18','payment_method','Pix'
    ));
    ASSERT false,'refund without idempotency key was accepted';
  EXCEPTION WHEN OTHERS THEN
    ASSERT SQLERRM='Informe uma chave de idempotência válida para registrar a devolução.',
      'refund without idempotency key returned an unexpected error';
  END;

  result := record_sale_refund(uid,cancelled_legacy_cancellation_key,jsonb_build_object(
    'amount',200,'refund_date','2026-09-18','payment_method','Pix',
    'idempotency_key','legacy-refund-part-1'
  ));
  ASSERT result->>'refund_status'='partial','first legacy refund should be partial';
  ASSERT (SELECT refund_paid FROM sale_cancellations WHERE id=cancelled_legacy_cancellation_key)=200,'first legacy refund total is incorrect';
  ASSERT (SELECT count(*) FROM sale_refunds WHERE cancellation_id=cancelled_legacy_cancellation_key)=1,'first legacy refund audit is missing';
  ASSERT (SELECT count(*) FROM fin_despesas WHERE sale_cancellation_id=cancelled_legacy_cancellation_key AND status='pago')=1,'first legacy refund expense is missing';
  ASSERT (SELECT valor FROM fin_despesas WHERE sale_cancellation_id=cancelled_legacy_cancellation_key AND status='pendente')=400,'pending legacy refund was not reduced';

  result := record_sale_refund(uid,cancelled_legacy_cancellation_key,jsonb_build_object(
    'amount',200,'refund_date','2026-09-18','payment_method','Pix',
    'idempotency_key','legacy-refund-part-1'
  ));
  ASSERT result->>'already_recorded'='true','same refund key must be idempotent';
  ASSERT (result->>'refund_remaining')::numeric=400,'idempotent retry returned the wrong remaining refund';
  ASSERT (SELECT refund_paid FROM sale_cancellations WHERE id=cancelled_legacy_cancellation_key)=200,'idempotent retry changed the paid refund';
  ASSERT (SELECT count(*) FROM sale_refunds WHERE cancellation_id=cancelled_legacy_cancellation_key)=1,'idempotent retry duplicated the refund';
  ASSERT (SELECT count(*) FROM fin_despesas WHERE sale_cancellation_id=cancelled_legacy_cancellation_key)=2,'idempotent retry duplicated an expense';

  result := record_sale_refund(uid,cancelled_legacy_cancellation_key,jsonb_build_object(
    'amount',400,'refund_date','2026-09-19','payment_method','Pix',
    'idempotency_key','legacy-refund-part-2'
  ));
  ASSERT result->>'refund_status'='refunded','second refund key should complete the refund';
  ASSERT (SELECT refund_paid FROM sale_cancellations WHERE id=cancelled_legacy_cancellation_key)=600,'second legacy refund total is incorrect';
  ASSERT (SELECT count(*) FROM sale_refunds WHERE cancellation_id=cancelled_legacy_cancellation_key)=2,'different refund key did not create the valid next installment';
  ASSERT (SELECT sum(amount) FROM sale_refunds WHERE cancellation_id=cancelled_legacy_cancellation_key)=600,'legacy refund installments do not close';
  ASSERT (SELECT count(*) FROM fin_despesas WHERE sale_cancellation_id=cancelled_legacy_cancellation_key AND status='pago')=2,'legacy paid refund expenses are incorrect';
  ASSERT (SELECT count(*) FROM fin_despesas WHERE sale_cancellation_id=cancelled_legacy_cancellation_key AND status='cancelado')=1,'legacy pending expense was not closed';
END;
$$;

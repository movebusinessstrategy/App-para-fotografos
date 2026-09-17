DO $$
DECLARE
  uid uuid := '11111111-1111-1111-1111-111111111111';
  deal_key bigint;
  job_key bigint;
  gestante_item uuid;
  newborn_item uuid;
  album_item uuid;
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

  result := split_production_job(uid,job_key,'[]'::jsonb);
  ASSERT result->>'already_split'='true','split retry must be idempotent';
  ASSERT (SELECT count(*) FROM jobs WHERE deal_id=deal_key)=2,'split retry duplicated jobs';

  result := cancel_sale_with_refund(uid,deal_key,jsonb_build_object(
    'reason','Cliente desistiu','refund_status','pending','refund_expected',500,
    'refund_paid',0,'refund_due_date','2026-09-20','stage','perdido','stage_history','[]'::jsonb
  ));
  ASSERT result->>'success'='true','cancel failed';
  ASSERT (SELECT count(*) FROM jobs WHERE deal_id=deal_key AND status='cancelled')=2,'all jobs must be cancelled';
  ASSERT (SELECT sum(amount) FROM job_payments)=500,'cancel erased or changed cash';
  ASSERT (SELECT count(*) FROM sale_cancellations WHERE deal_id=deal_key)=1,'cancellation audit missing';
  ASSERT (SELECT count(*) FROM fin_despesas WHERE sale_cancellation_id IS NOT NULL AND status='pendente' AND valor=500)=1,'pending refund expense missing';

  result := record_sale_refund(uid,(SELECT id FROM sale_cancellations WHERE deal_id=deal_key),jsonb_build_object(
    'amount',500,'refund_date','2026-09-18','payment_method','Pix'
  ));
  ASSERT result->>'refund_status'='refunded','refund should be completed';
  ASSERT (SELECT refund_paid FROM sale_cancellations WHERE deal_id=deal_key)=500,'paid refund total incorrect';
  ASSERT (SELECT count(*) FROM sale_refunds WHERE amount=500)=1,'refund audit missing';
  ASSERT (SELECT count(*) FROM fin_despesas WHERE sale_cancellation_id IS NOT NULL AND status='pago' AND valor=500)=1,'paid refund expense missing';

  result := cancel_sale_with_refund(uid,deal_key,jsonb_build_object('reason','retry'));
  ASSERT result->>'already_cancelled'='true','cancel retry must be idempotent';
  ASSERT (SELECT count(*) FROM fin_despesas WHERE sale_cancellation_id IS NOT NULL)=2,'cancel retry duplicated expenses';
END;
$$;

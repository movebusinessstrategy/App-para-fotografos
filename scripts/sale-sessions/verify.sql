\set ON_ERROR_STOP on
BEGIN;
INSERT INTO clients(id,user_id,name) VALUES(1001,'00000000-0000-4000-8000-000000000001','Cliente de teste');
INSERT INTO deal_stages(id,user_id,name,process_id,is_won) VALUES
 ('prod-test','00000000-0000-4000-8000-000000000001','Vendido','process-test',false),
 ('won-test','00000000-0000-4000-8000-000000000001','Venda ganha',null,true);
INSERT INTO deal_stages(id,user_id,name,process_id,is_won) VALUES
 ('lead','00000000-0000-4000-8000-000000000001','Negociação',null,false),
 ('lost-test','00000000-0000-4000-8000-000000000001','Cancelada',null,false);
UPDATE deal_stages SET is_final=true WHERE id='lost-test';
DO $$ DECLARE result jsonb; BEGIN
 result := create_deal_priced('00000000-0000-4000-8000-000000000001',
   '{"title":"Cadastro com desconto maior que o primeiro item","stage":"lead","sale_gross_amount":2500,"discount":1500}',
   '[{"catalog_type":"servico","catalog_id":"g","catalog_name":"Gestante","catalog_value":1000,"quantidade":1},{"catalog_type":"servico","catalog_id":"n","catalog_name":"Newborn","catalog_value":1500,"quantidade":1}]');
 ASSERT (SELECT discount=1500 AND value=1000 FROM deals WHERE id=(result->>'id')::bigint),'full discount preserved during creation';
 ASSERT (SELECT count(*) FROM deal_items WHERE deal_id=(result->>'id')::bigint)=2,'all items saved atomically';
 DELETE FROM deal_items WHERE deal_id=(result->>'id')::bigint;
 DELETE FROM deals WHERE id=(result->>'id')::bigint;
END $$;
INSERT INTO deals(id,user_id,title,value,stage) VALUES
 (9001,'00000000-0000-4000-8000-000000000001','Gestante + newborn',2500,'lead'),
 (9002,'00000000-0000-4000-8000-000000000001','Teste de falha',2500,'lead');
CREATE TEMP TABLE test_payload AS SELECT '{
 "client_id":1001,"gross_amount":2500,"discount":300,"signal_amount":500,
 "entry_stage":"prod-test","payment_method":"Pix",
 "updates":{"stage":"won-test","converted_at":"2026-09-10T12:00:00Z","stage_history":[]},
 "items":[{"catalog_type":"combo","catalog_id":"test","catalog_name":"Gestante + newborn","catalog_value":2500,"quantidade":1}],
 "sessions":[
 {"session_index":0,"job_type":"Gestante","job_name":"Gestante","job_date":"2026-10-15","job_time":"09:00","gross_amount":1000,"discount_amount":120,"amount":880,"signal_amount":200},
 {"session_index":1,"job_type":"Newborn","job_name":"Newborn","job_date":null,"job_time":null,"gross_amount":1500,"discount_amount":180,"amount":1320,"signal_amount":300}]
}'::jsonb AS body;
SELECT convert_deal_sessions('00000000-0000-4000-8000-000000000001',9001,body) IS NOT NULL AS converted FROM test_payload;
SELECT convert_deal_sessions('00000000-0000-4000-8000-000000000001',9001,body)->>'already_converted' AS idempotent FROM test_payload;
DO $$ BEGIN
 ASSERT (SELECT count(*) FROM jobs WHERE deal_id=9001)=2,'two cards';
 ASSERT (SELECT sum(amount) FROM jobs WHERE deal_id=9001)=2200,'net total';
 ASSERT (SELECT value FROM deals WHERE id=9001)=2200,'one net sale';
 ASSERT (SELECT count(*) FROM deals WHERE converted)=1,'one sale count';
 ASSERT (SELECT sum(amount) FROM job_payments)=500,'signal counted once';
 ASSERT (SELECT count(*) FROM deal_items WHERE deal_id=9001)=1,'item idempotency';
 ASSERT (SELECT job_date IS NULL AND job_time IS NULL FROM jobs WHERE deal_id=9001 AND job_type='Newborn'),'no invented date';
 ASSERT NOT has_function_privilege('authenticated','convert_deal_sessions(uuid,bigint,jsonb)','execute'),'no direct RPC access';
 BEGIN
   PERFORM convert_deal_sessions('00000000-0000-4000-8000-000000000002',9001,(SELECT body FROM test_payload));
   RAISE EXCEPTION 'tenant validation should fail';
 EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM='Venda não encontrada.'; END;
END $$;
-- Each card can move independently and have a separate contract.
UPDATE jobs SET production_stage='editing-test' WHERE deal_id=9001 AND job_type='Gestante';
INSERT INTO contracts(job_id,user_id,status) SELECT id,user_id,'draft' FROM jobs WHERE deal_id=9001;
DO $$ BEGIN
 ASSERT (SELECT production_stage FROM jobs WHERE deal_id=9001 AND job_type='Newborn')='prod-test','independent production';
 ASSERT (SELECT count(DISTINCT job_id) FROM contracts)=2,'independent contracts';
END $$;
-- Extras remain attached to their own session when the sale discount changes.
INSERT INTO job_items(job_id,catalog_value,quantidade,discount_value) SELECT id,100,1,10 FROM jobs WHERE deal_id=9001 AND job_type='Newborn';
SELECT update_deal_pricing('00000000-0000-4000-8000-000000000001',9001,2500,500);
DO $$ BEGIN
 ASSERT (SELECT sum(amount) FROM jobs WHERE deal_id=9001)=2090,'own extras counted once';
 ASSERT (SELECT value FROM deals WHERE id=9001)=2000,'sale excludes extras';
 ASSERT (SELECT sum(amount) FROM job_payments)=500,'discount is not cash';
END $$;
-- An error on the second card must roll back first card, client and signal.
CREATE FUNCTION pg_temp.fail_second_job() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.deal_id=9002 AND NEW.sale_session_index=1 THEN RAISE EXCEPTION 'forced_second_job_failure'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER sale_test_failure BEFORE INSERT ON jobs FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_second_job();
DO $$ DECLARE before_clients bigint; BEGIN
 SELECT count(*) INTO before_clients FROM clients;
 BEGIN
   PERFORM convert_deal_sessions('00000000-0000-4000-8000-000000000001',9002,
     (SELECT body || '{"force":true,"create_client":true,"client":{"name":"Rollback fixture"}}'::jsonb FROM test_payload));
   RAISE EXCEPTION 'rollback should fail';
 EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM='forced_second_job_failure'; END;
 ASSERT (SELECT count(*) FROM jobs WHERE deal_id=9002)=0,'no orphan job';
 ASSERT (SELECT count(*) FROM clients)=before_clients,'no orphan client';
 ASSERT (SELECT converted IS NOT TRUE FROM deals WHERE id=9002),'sale not partially won';
 ASSERT (SELECT sum(amount) FROM job_payments)=500,'no orphan payment';
END $$;
-- Cancelling the shared sale preserves all historical contracts and payments.
SELECT cancel_deal_sessions('00000000-0000-4000-8000-000000000001',9001,'{"stage":"lost-test","lost_reason":"Teste"}');
DO $$ BEGIN
 ASSERT (SELECT count(*) FROM jobs WHERE deal_id=9001 AND status='cancelled')=2,'all sessions cancelled';
 ASSERT (SELECT sum(amount) FROM job_payments)=500,'payment history preserved';
 ASSERT (SELECT count(*) FROM contracts)=2,'contract history preserved';
END $$;
ROLLBACK;
SELECT 'All sale-session database checks passed' AS result;

-- Fixtures do gate da 083: rodam DEPOIS dos stubs e da 083 aplicada duas vezes.
-- Tudo numa transação que termina em ROLLBACK (now() fica fixo, nada persiste).
-- Dados fictícios. Nunca rode isto no Supabase: a guarda abaixo aborta fora do banco de ensaio.
\set ON_ERROR_STOP 1
BEGIN;

DO $$
BEGIN
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'auth' AND table_name = 'users') <> 1 THEN
    RAISE EXCEPTION 'fixtures do gate 083: só rodam no banco de ensaio (auth.users de stub)';
  END IF;
END $$;

-- Contas: 1 candidatos e CHECKs; 2 outro tenant; 3 claim; 4 cascata; 5 retenção.
CREATE FUNCTION pg_temp.fx_u(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.fx_inbox_status(p_user uuid, p_wa text, p_id text, p_status text, p_at timestamptz, p_rcpt text)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.whatsapp_webhook_inbox (user_id, phone_number_id, wa_number, event_key, payload, status, received_at)
  VALUES (p_user, 'pn-' || p_wa, p_wa, p_id || ':' || p_status, jsonb_build_object('kind', 'status', 'status',
    jsonb_build_object('id', p_id, 'status', p_status, 'timestamp', extract(epoch FROM p_at)::bigint::text, 'recipient_id', p_rcpt)),
    'processed', p_at);
$$;
INSERT INTO auth.users (id) SELECT pg_temp.fx_u(n) FROM generate_series(1, 5) n;

-- 1. Chave e variantes de telefone. O teste followup-cadence-migration.test.ts confere
--    estes mesmos vetores contra canonicalPhoneKey e brazilianPhoneVariants (lib/br-phone.ts).
CREATE TEMP TABLE fx_phone_vectors (input text NOT NULL, key text NOT NULL, variants text[] NOT NULL);
INSERT INTO fx_phone_vectors (input, key, variants) VALUES
-- phone-vectors:begin
  ('554399900001', '554399900001', '{4399900001,43999900001,554399900001,5543999900001}'),
  ('5543999900001', '554399900001', '{4399900001,43999900001,554399900001,5543999900001}'),
  ('43999900001', '554399900001', '{4399900001,43999900001,554399900001,5543999900001}'),
  ('4399900001', '554399900001', '{4399900001,43999900001,554399900001,5543999900001}'),
  ('+55 (43) 99990-0001', '554399900001', '{4399900001,43999900001,554399900001,5543999900001}'),
  ('551187650000', '551187650000', '{1187650000,11987650000,551187650000,5511987650000}'),
  ('5511987650000', '551187650000', '{1187650000,11987650000,551187650000,5511987650000}'),
  ('5543899900001', '5543899900001', '{43899900001,5543899900001}'),
  ('5599990001', '555599990001', '{555599990001,5555999990001,5599990001,55999990001}'),
  ('55999990001', '555599990001', '{555599990001,5555999990001,5599990001,55999990001}'),
  ('12345678', '12345678', '{12345678,5512345678}'),
  ('1234567890123456', '1234567890123456', '{1234567890123456,551234567890123456}')
-- phone-vectors:end
;

DO $$
DECLARE v record;
BEGIN
  FOR v IN SELECT * FROM fx_phone_vectors LOOP
    ASSERT public.followup_phone_key(v.input) = v.key, format('chave de %s: %s', v.input, public.followup_phone_key(v.input));
    ASSERT (SELECT array_agg(x ORDER BY x) FROM unnest(public.followup_phone_variants(v.input)) x)
         = (SELECT array_agg(x ORDER BY x) FROM unnest(v.variants) x), format('variantes de %s', v.input);
  END LOOP;
  ASSERT public.followup_phone_key('554399900001') = public.followup_phone_key('5543999900001'), '12 e 13 dígitos dão a mesma chave';
  ASSERT public.followup_phone_key(NULL) = '' AND public.followup_phone_key('') = '', 'nulo e vazio viram texto vazio';
  ASSERT public.followup_phone_variants('1234567') = '{}'::text[] AND public.followup_phone_variants(NULL) = '{}'::text[],
    'menos de 8 dígitos não tem variante';
  -- A chave da 083 prefixa 55 em 11 dígitos; a wa_phone_key não. Por isso não se troca uma pela outra.
  ASSERT public.followup_phone_key('43999900001') <> public.wa_phone_key('43999900001'), 'followup_phone_key difere de wa_phone_key';
END $$;

-- 2. Linhas legadas: continuam válidas e o INSERT legado (sem kind) segue funcionando.
DO $$
DECLARE r public.scheduled_followups%ROWTYPE;
BEGIN
  ASSERT (SELECT count(*) FROM public.scheduled_followups
           WHERE user_id = '00000000-0000-4000-8000-0000000000aa' AND kind = 'legacy' AND generation_meta = '{}'::jsonb
             AND phone_key = public.followup_phone_key(phone) AND updated_at IS NOT NULL) = 4, 'as 4 linhas legadas viram kind legacy';
  INSERT INTO public.scheduled_followups (user_id, deal_id, phone, message, stage_id, scheduled_at, contact_name, wa_number)
  VALUES ('00000000-0000-4000-8000-0000000000aa', 5, '(11) 90000-0005', 'Oi {nome}', 'stub-02', now(), 'Stub', '551130000009')
  RETURNING * INTO r;
  ASSERT r.kind = 'legacy' AND r.status = 'pending' AND r.attempts = 0 AND r.phone_key = '551100000005', 'insert legado intacto';
END $$;

-- 3. Candidatos da varredura.
INSERT INTO public.deal_stages (id, name, "position", is_final, is_won, user_id) VALUES
  ('fx-lead', 'Lead', 0, false, false, pg_temp.fx_u(1)),
  ('fx-proposal', 'Proposta', 1, false, false, pg_temp.fx_u(1)),
  ('fx-negotiation', 'Negociação', 2, false, false, pg_temp.fx_u(1)),
  ('fx-won', 'Ganho', 3, true, true, pg_temp.fx_u(1)),
  ('fx-lost', 'Perdido', 4, true, false, pg_temp.fx_u(1)),
  ('fx2-proposal', 'Proposta', 1, false, false, pg_temp.fx_u(2));

INSERT INTO public.deals (id, user_id, title, stage, contact_name, contact_phone, converted, converted_job_id) VALUES
  (9101, pg_temp.fx_u(1), 'Deal A', 'fx-proposal', 'Cliente A', '(43) 99990-0001', false, NULL),
  (9102, pg_temp.fx_u(1), 'Deal B', 'fx-negotiation', 'Cliente B', '5543999900002', false, NULL),
  (9103, pg_temp.fx_u(1), 'Deal C', 'fx-proposal', 'Cliente C', '5543999900003', false, NULL),
  (9104, pg_temp.fx_u(1), 'Deal D', 'fx-proposal', 'Cliente D', '5543999900004', false, NULL),
  (9105, pg_temp.fx_u(1), 'Deal E', 'fx-proposal', 'Cliente E', '5543999900005', false, NULL),
  (9106, pg_temp.fx_u(1), 'Deal F', 'fx-proposal', 'Cliente F', '5543999900006', false, NULL),
  (9107, pg_temp.fx_u(1), 'Deal G', 'fx-proposal', 'Cliente G', '5543999900007', false, NULL),
  (9117, pg_temp.fx_u(1), 'Deal G ganho', 'fx-won', 'Cliente G', '(43) 9990-0007', false, NULL),
  (9108, pg_temp.fx_u(1), 'Deal H', 'fx-proposal', 'Cliente H', '5543999900008', false, NULL),
  (9109, pg_temp.fx_u(1), 'Deal I', 'fx-proposal', 'Cliente I', '5543999900009', false, NULL),
  (9110, pg_temp.fx_u(1), 'Deal J', 'fx-proposal', 'Cliente J', '5543999900010', false, NULL),
  (9111, pg_temp.fx_u(1), 'Deal K', 'fx-proposal', 'Cliente K', '5543999900011', true, NULL),
  (9112, pg_temp.fx_u(1), 'Deal K2', 'fx-proposal', 'Cliente K2', '5543999900012', false, 555),
  (9113, pg_temp.fx_u(1), 'Deal L', 'fx-lead', 'Cliente L', '5543999900013', false, NULL),
  (9114, pg_temp.fx_u(1), 'Deal M', 'fx-proposal', 'Cliente M', '12345', false, NULL),
  (9115, pg_temp.fx_u(1), 'Deal N', 'fx-proposal', 'Cliente N', '5543999900015', false, NULL),
  (9116, pg_temp.fx_u(1), 'Deal N pre', 'fx-lead', 'Cliente N', '5543999900015', false, NULL),
  (9118, pg_temp.fx_u(1), 'Titulo O', 'fx-proposal', '   ', '5543999900018', false, NULL),
  (9201, pg_temp.fx_u(2), 'Deal outro tenant', 'fx2-proposal', 'Outro', '5543999900001', false, NULL);

INSERT INTO public.wa_messages (user_id, phone, wa_number, message_id, body, from_me, type, "timestamp", status) VALUES
  -- A: estúdio gravado com 12 dígitos, cliente com 13
  (pg_temp.fx_u(1), '554399900001', '551130000001', 'fx.A.out', 'Segue o orçamento', true, 'text', now() - interval '30 hours', 'sent'),
  (pg_temp.fx_u(1), '5543999900001', '551130000001', 'fx.A.in', 'Obrigada', false, 'text', now() - interval '31 hours', 'received'),
  -- outro tenant com o mesmo telefone não conta
  (pg_temp.fx_u(2), '5543999900001', '551130000001', 'fx.U2.in', 'Oi', false, 'text', now() - interval '1 hour', 'received'),
  (pg_temp.fx_u(2), '554399900001', '551130000001', 'fx.U2.out', 'Oi', true, 'text', now() - interval '30 minutes', 'sent'),
  -- B: cliente respondeu no número de pós-venda; o estúdio falou lá também
  (pg_temp.fx_u(1), '554399900002', '551130000001', 'fx.B.out', 'Proposta', true, 'text', now() - interval '40 hours', 'sent'),
  (pg_temp.fx_u(1), '5543999900002', '551130000002', 'fx.B.in.w2', 'Vou ver', false, 'text', now() - interval '20 hours', 'received'),
  (pg_temp.fx_u(1), '5543999900002', '551130000002', 'fx.B.out.w2', 'Pos-venda', true, 'text', now() - interval '5 hours', 'sent'),
  -- C: failed, reação, unsupported e edit do estúdio não são turno; reação do cliente não é turno
  (pg_temp.fx_u(1), '5543999900003', '551130000001', 'fx.C.out1', 'Ola', true, 'text', now() - interval '50 hours', 'read'),
  (pg_temp.fx_u(1), '5543999900003', '551130000001', 'fx.C.out2', 'Falhou', true, 'text', now() - interval '10 hours', 'failed'),
  (pg_temp.fx_u(1), '5543999900003', '551130000001', 'fx.C.react', '+1', true, 'reaction', now() - interval '9 hours', 'sent'),
  (pg_temp.fx_u(1), '5543999900003', '551130000001', 'fx.C.unsup', NULL, true, 'unsupported', now() - interval '7 hours', 'sent'),
  (pg_temp.fx_u(1), '5543999900003', '551130000001', 'fx.C.edit', 'Ola!', true, 'edit', now() - interval '6 hours', 'sent'),
  (pg_temp.fx_u(1), '5543999900003', '551130000001', 'fx.C.in.react', '+1', false, 'reaction', now() - interval '8 hours', 'received'),
  -- D: fala visível antiga; a mensagem 'known' existe em wa_messages (reação, fora do turno)
  (pg_temp.fx_u(1), '554399900004', '551130000001', 'fx.D.out', 'Oi', true, 'text', now() - interval '72 hours', 'sent'),
  (pg_temp.fx_u(1), '554399900004', '551130000001', 'wamid.fx.D.known', '+1', true, 'reaction', now() - interval '60 hours', 'sent'),
  -- E: id sintético do legado/blast gravado com from_me
  (pg_temp.fx_u(1), '5543999900005', '551130000001', 'auto-fx-E', 'Oi', true, 'text', date_trunc('second', now()) - interval '6 hours', 'sent'),
  -- F, G, H, I, J, N: uma fala do estúdio
  (pg_temp.fx_u(1), '554399900006', '551130000001', 'fx.F.out', 'Oi', true, 'text', now() - interval '30 hours', 'sent'),
  (pg_temp.fx_u(1), '554399900007', '551130000001', 'fx.G.out', 'Oi', true, 'text', now() - interval '30 hours', 'sent'),
  (pg_temp.fx_u(1), '554399900008', '551130000001', 'fx.H.out', 'Oi', true, 'text', now() - interval '30 hours', 'sent'),
  (pg_temp.fx_u(1), '554399900008', '551130000001', 'fx.H.in.unsup', NULL, false, 'unsupported', now() - interval '3 hours', 'received'),
  (pg_temp.fx_u(1), '554399900009', '551130000001', 'fx.I.out', 'Oi', true, 'text', now() - interval '30 hours', 'sent'),
  (pg_temp.fx_u(1), '554399900010', '551130000001', 'fx.J.out', 'Oi', true, 'text', now() - interval '30 hours', 'sent'),
  (pg_temp.fx_u(1), '554399900015', '551130000001', 'fx.N.out', 'Oi', true, 'text', now() - interval '30 hours', 'sent');

-- Status da IA oficial (sem linha em wa_messages).
DO $$
BEGIN
  PERFORM pg_temp.fx_inbox_status(pg_temp.fx_u(1), '551130000001', 'wamid.fx.D.bot', 'sent', date_trunc('second', now()) - interval '5 hours', '554399900004');
  PERFORM pg_temp.fx_inbox_status(pg_temp.fx_u(1), '551130000001', 'wamid.fx.D.bot', 'delivered', date_trunc('second', now()) - interval '299 minutes', '554399900004');
  PERFORM pg_temp.fx_inbox_status(pg_temp.fx_u(1), '551130000001', 'wamid.fx.D.bot', 'read', date_trunc('second', now()) - interval '270 minutes', '554399900004');
  PERFORM pg_temp.fx_inbox_status(pg_temp.fx_u(1), '551130000001', 'wamid.fx.D.fail', 'sent', date_trunc('second', now()) - interval '2 hours', '554399900004');
  PERFORM pg_temp.fx_inbox_status(pg_temp.fx_u(1), '551130000001', 'wamid.fx.D.fail', 'failed', date_trunc('second', now()) - interval '2 hours' + interval '10 seconds', '554399900004');
  PERFORM pg_temp.fx_inbox_status(pg_temp.fx_u(1), '551130000001', 'wamid.fx.D.known', 'sent', date_trunc('second', now()) - interval '1 hour', '554399900004');
  PERFORM pg_temp.fx_inbox_status(pg_temp.fx_u(1), '551130000002', 'wamid.fx.D.w2', 'sent', date_trunc('second', now()) - interval '30 minutes', '5543999900004');
  PERFORM pg_temp.fx_inbox_status(pg_temp.fx_u(1), '551130000001', 'wamid.fx.E.real', 'sent', date_trunc('second', now()) - interval '6 hours' + interval '60 seconds', '554399900005');
  PERFORM pg_temp.fx_inbox_status(pg_temp.fx_u(2), '551130000001', 'wamid.fx.U2.bot', 'sent', date_trunc('second', now()) - interval '10 minutes', '554399900001');
END $$;
INSERT INTO public.whatsapp_webhook_inbox (user_id, phone_number_id, wa_number, event_key, payload, status, received_at) VALUES
  (pg_temp.fx_u(1), 'pn-551130000001', '551130000001', 'fx.D.badts', jsonb_build_object('kind', 'status', 'status',
     jsonb_build_object('id', 'wamid.fx.D.badts', 'status', 'sent', 'timestamp', 'agora', 'recipient_id', '554399900004')), 'processed', now()),
  (pg_temp.fx_u(1), 'pn-551130000001', '551130000001', 'fx.D.msg', jsonb_build_object('kind', 'message', 'message',
     jsonb_build_object('id', 'wamid.fx.D.msg', 'customerPhone', '554399900004', 'fromMe', false)), 'dead', now());

-- Legado enviado: F (mais novo que a fala visível), J (sentinela da Lia), mais os que não contam.
INSERT INTO public.scheduled_followups (user_id, deal_id, phone, message, stage_id, scheduled_at, sent_at, status, wa_number) VALUES
  (pg_temp.fx_u(1), 9106, '5543999900006', 'Passando para saber se ficou alguma duvida', 'fx-proposal',
     now() - interval '11 hours', now() - interval '10 hours', 'sent', '551130000001'),
  (pg_temp.fx_u(1), 9106, '5543999900006', 'Falhou', 'fx-proposal', now() - interval '2 hours', NULL, 'failed', '551130000001'),
  (pg_temp.fx_u(1), 9110, '5543999900010', '###AGENT_FOLLOWUP###', 'fx-proposal',
     now() - interval '3 hours', now() - interval '2 hours', 'sent', '551130000001');
INSERT INTO public.scheduled_followups (user_id, deal_id, phone, message, stage_id, scheduled_at, sent_at, status, wa_number,
  kind, step, basis_at, approved_at) VALUES
  (pg_temp.fx_u(1), 9106, '5543999900006', 'Cadencia enviada', 'fx-proposal', now() - interval '1 hour', now() - interval '1 hour', 'sent',
     '551130000001', 'cadence', 1, now() - interval '10 hours', now() - interval '2 hours');

INSERT INTO public.wa_conversations (user_id, phone, wa_number, needs_human, agent_status) VALUES
  (pg_temp.fx_u(1), '554399900001', '551130000001', false, 'idle'),
  (pg_temp.fx_u(1), '5543999900001', '551130000002', true, 'idle'),
  (pg_temp.fx_u(1), '554399900010', '551130000001', false, 'needs_human');

INSERT INTO public.clients (id, user_id, name, phone) VALUES
  (7001, pg_temp.fx_u(1), 'Cliente H', '+55 43 99990-0008'),
  (7002, pg_temp.fx_u(1), 'Cliente I', '43999900009'),
  (7003, pg_temp.fx_u(2), 'Outro', '5543999900001'),
  (7004, pg_temp.fx_u(1), 'Data fora do ISO', '5543999900020'),
  (7005, pg_temp.fx_u(1), 'Sem data', '5543999900021'),
  (7006, pg_temp.fx_u(1), 'Ensaio recente', '5543999900022'),
  (7007, pg_temp.fx_u(1), 'Sem telefone', NULL);
INSERT INTO public.jobs (id, user_id, client_id, deal_id, job_type, status, job_date) VALUES
  (8001, pg_temp.fx_u(1), 7001, NULL, 'ensaio', 'scheduled', to_char(current_date + 10, 'YYYY-MM-DD')),
  (8002, pg_temp.fx_u(1), 7002, NULL, 'ensaio', 'completed', to_char(current_date - 730, 'YYYY-MM-DD')),
  (8004, pg_temp.fx_u(1), 7002, NULL, 'ensaio', 'cancelled', to_char(current_date + 5, 'YYYY-MM-DD')),
  (8005, pg_temp.fx_u(2), 7003, NULL, 'ensaio', 'scheduled', to_char(current_date + 10, 'YYYY-MM-DD')),
  (8006, pg_temp.fx_u(1), 7004, NULL, 'ensaio', 'completed', '15/09/2020'),
  (8007, pg_temp.fx_u(1), 7005, NULL, 'ensaio', 'scheduled', NULL),
  (8008, pg_temp.fx_u(1), 7006, NULL, 'ensaio', 'delivered', to_char(current_date - 300, 'YYYY-MM-DD') || 'T10:00:00'),
  (8009, pg_temp.fx_u(1), 7007, NULL, 'ensaio', 'scheduled', NULL),
  (8003, pg_temp.fx_u(1), NULL, 9116, 'ensaio', 'pre_reserved', NULL);

DO $$
BEGIN
  ASSERT (SELECT array_agg(k.phone_key ORDER BY k.phone_key) FROM public.followup_customer_phone_keys(pg_temp.fx_u(1)) k)
       = ARRAY['554399900007', '554399900008', '554399900011', '554399900012', '554399900015',
               '554399900020', '554399900021', '554399900022'],
    'chaves de cliente: ganho, convertido, job recente/futuro/sem data/fora do ISO, pré-reserva';
  ASSERT (SELECT array_agg(k.phone_key) FROM public.followup_customer_phone_keys(pg_temp.fx_u(2)) k) = ARRAY['554399900001'],
    'cliente de outro tenant fica no outro tenant';
END $$;

CREATE TEMP TABLE fx_cand AS
  SELECT * FROM public.followup_cadence_candidates(pg_temp.fx_u(1), ARRAY['fx-proposal', 'fx-negotiation', 'fx2-proposal'],
    ARRAY['551130000001']);

DO $$
DECLARE c record;
BEGIN
  ASSERT (SELECT array_agg(deal_id ORDER BY deal_id) FROM fx_cand)
       = ARRAY[9101, 9102, 9103, 9104, 9105, 9106, 9107, 9108, 9109, 9110, 9115, 9118]::bigint[],
    'só deals abertos do tenant, nas etapas pedidas, com telefone válido';

  SELECT * INTO c FROM fx_cand WHERE deal_id = 9101;
  ASSERT c.phone_key = '554399900001' AND c.stage = 'fx-proposal' AND c.contact_name = 'Cliente A', 'A: identidade';
  ASSERT c.last_studio_at = now() - interval '30 hours' AND c.last_studio_type = 'text'
     AND c.last_studio_message_id = 'fx.A.out' AND c.last_studio_body = 'Segue o orçamento', 'A: estúdio gravado com 12 dígitos';
  ASSERT c.last_customer_at = now() - interval '31 hours', 'A: cliente gravado com 13 dígitos (e o outro tenant não conta)';
  ASSERT NOT c.already_customer AND NOT c.needs_human AND c.last_invisible_out_at IS NULL AND NOT c.invisible_read,
    'A: cliente de outro tenant, conversa do pós-venda com needs_human e status de outro tenant não contam';

  SELECT * INTO c FROM fx_cand WHERE deal_id = 9102;
  ASSERT c.last_customer_at = now() - interval '20 hours', 'B: resposta em OUTRO wa_number conta';
  ASSERT c.last_studio_at = now() - interval '40 hours', 'B: fala do estúdio em outro número não conta com filtro';

  SELECT * INTO c FROM fx_cand WHERE deal_id = 9103;
  ASSERT c.last_studio_at = now() - interval '50 hours' AND c.last_studio_message_id = 'fx.C.out1',
    'C: failed, reaction, unsupported e edit do estúdio são ignorados';
  ASSERT c.last_customer_at IS NULL AND c.last_customer_reaction_at = now() - interval '8 hours', 'C: reação do cliente não é turno';

  SELECT * INTO c FROM fx_cand WHERE deal_id = 9104;
  ASSERT c.last_studio_at = now() - interval '72 hours', 'D: fala visível';
  ASSERT c.last_invisible_out_at = date_trunc('second', now()) - interval '5 hours', 'D: instante do sent, não do read';
  ASSERT c.invisible_read, 'D: invisible_read vem do read da mesma mensagem';

  SELECT * INTO c FROM fx_cand WHERE deal_id = 9105;
  ASSERT c.last_invisible_out_at IS NULL, 'E: status com from_me do mesmo telefone a 60s é id sintético';
  ASSERT c.last_studio_at = date_trunc('second', now()) - interval '6 hours', 'E: a fala visível segue valendo';

  SELECT * INTO c FROM fx_cand WHERE deal_id = 9106;
  ASSERT c.last_studio_at = now() - interval '10 hours' AND c.last_studio_type = 'text' AND c.last_studio_message_id IS NULL
     AND c.last_studio_body = 'Passando para saber se ficou alguma duvida', 'F: legado enviado mais novo vence, sem message_id';

  SELECT * INTO c FROM fx_cand WHERE deal_id = 9107;
  ASSERT c.already_customer, 'G: deal ganho do mesmo telefone';
  SELECT * INTO c FROM fx_cand WHERE deal_id = 9108;
  ASSERT c.already_customer, 'H: cliente com job scheduled';
  ASSERT c.last_customer_at = now() - interval '3 hours', 'H: unsupported do cliente conta como turno';
  SELECT * INTO c FROM fx_cand WHERE deal_id = 9109;
  ASSERT NOT c.already_customer, 'I: job antigo e job cancelado não fazem cliente';

  SELECT * INTO c FROM fx_cand WHERE deal_id = 9110;
  ASSERT c.needs_human, 'J: agent_status needs_human no número principal';
  ASSERT c.last_studio_at = now() - interval '2 hours' AND c.last_studio_body IS NULL AND c.last_studio_message_id IS NULL,
    'J: sentinela da Lia enviada conta como fala, sem corpo';

  SELECT * INTO c FROM fx_cand WHERE deal_id = 9115;
  ASSERT c.already_customer, 'N: pré-reserva ligada a deal do mesmo telefone';
  SELECT * INTO c FROM fx_cand WHERE deal_id = 9118;
  ASSERT c.contact_name = 'Titulo O' AND c.last_studio_at IS NULL, 'O: nome em branco cai no título';
END $$;

DO $$
DECLARE c record;
BEGIN
  -- Sem filtro de número: o pós-venda entra em tudo.
  SELECT * INTO c FROM public.followup_cadence_candidates(pg_temp.fx_u(1), ARRAY['fx-proposal', 'fx-negotiation']) WHERE deal_id = 9102;
  ASSERT c.last_studio_at = now() - interval '5 hours', 'B sem filtro: fala no pós-venda conta';
  SELECT * INTO c FROM public.followup_cadence_candidates(pg_temp.fx_u(1), ARRAY['fx-proposal']) WHERE deal_id = 9104;
  ASSERT c.last_invisible_out_at = date_trunc('second', now()) - interval '30 minutes' AND NOT c.invisible_read,
    'D sem filtro: status do outro número é o mais novo e não foi lido';
  SELECT * INTO c FROM public.followup_cadence_candidates(pg_temp.fx_u(1), ARRAY['fx-proposal']) WHERE deal_id = 9101;
  ASSERT c.needs_human, 'A sem filtro: conversa do pós-venda com needs_human conta';

  -- Janela de busca dos status: 1h deixa só o 'known', que já está em wa_messages.
  SELECT * INTO c FROM public.followup_cadence_candidates(pg_temp.fx_u(1), ARRAY['fx-proposal'], ARRAY['551130000001'], 1)
   WHERE deal_id = 9104;
  ASSERT c.last_invisible_out_at IS NULL, 'D com lookback 1h: nada invisível';

  ASSERT (SELECT count(*) FROM public.followup_cadence_candidates(pg_temp.fx_u(1), ARRAY['fx-proposal'], NULL, 768, 2)) = 2, 'limite';
  ASSERT (SELECT count(*) FROM public.followup_cadence_candidates(pg_temp.fx_u(1), ARRAY['fx-proposal'], NULL, 768, 0)) = 1, 'limite mínimo 1';

  SELECT * INTO c FROM public.followup_cadence_candidates(pg_temp.fx_u(2), ARRAY['fx-proposal', 'fx2-proposal'], ARRAY['551130000001']);
  ASSERT c.deal_id = 9201 AND c.last_studio_at = now() - interval '30 minutes' AND c.last_customer_at = now() - interval '1 hour'
     AND c.already_customer AND c.last_invisible_out_at = date_trunc('second', now()) - interval '10 minutes',
    'outro tenant só vê o que é dele';
END $$;

-- 4. CHECKs e índices únicos de scheduled_followups.
DO $$
DECLARE cname text;
BEGIN
  BEGIN
    INSERT INTO public.scheduled_followups (user_id, deal_id, phone, message, stage_id, scheduled_at, kind, step, basis_at)
    VALUES (pg_temp.fx_u(1), 9601, '5543999900061', 'x', 'fx-proposal', now(), 'cadence', 1, now() - interval '1 day');
    ASSERT false, 'cadence com status padrão pending deveria violar o CHECK';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.scheduled_followups (user_id, deal_id, phone, message, stage_id, scheduled_at, status, kind, step, basis_at)
    VALUES (pg_temp.fx_u(1), 9601, '5543999900061', 'x', 'fx-proposal', now(), 'processing', 'cadence', 1, now() - interval '1 day');
    ASSERT false, 'cadence com processing deveria violar o CHECK';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.scheduled_followups (user_id, deal_id, phone, message, stage_id, scheduled_at, status, kind, step, basis_at)
    VALUES (pg_temp.fx_u(1), 9601, '5543999900061', 'x', 'fx-proposal', now(), NULL, 'cadence', 1, now() - interval '1 day');
    ASSERT false, 'cadence com status nulo deveria violar o CHECK';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.scheduled_followups (user_id, deal_id, phone, message, stage_id, scheduled_at, status, kind, step, basis_at)
    VALUES (pg_temp.fx_u(1), 9601, '5543999900061', 'x', 'fx-proposal', now(), 'draft', 'cadence', NULL, now() - interval '1 day');
    ASSERT false, 'cadence sem step deveria violar o CHECK';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.scheduled_followups (user_id, deal_id, phone, message, stage_id, scheduled_at, status, kind, step, basis_at)
    VALUES (pg_temp.fx_u(1), 9601, '5543999900061', 'x', 'fx-proposal', now(), 'draft', 'cadence', 5, now() - interval '1 day');
    ASSERT false, 'step 5 deveria violar o CHECK';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.scheduled_followups (user_id, deal_id, phone, message, stage_id, scheduled_at, status, kind, step, basis_at)
    VALUES (pg_temp.fx_u(1), 9601, '5543999900061', 'x', 'fx-proposal', now(), 'draft', 'cadence', 1, NULL);
    ASSERT false, 'cadence sem basis_at deveria violar o CHECK';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.scheduled_followups (user_id, deal_id, phone, message, stage_id, scheduled_at, status, kind, step, basis_at)
    VALUES (pg_temp.fx_u(1), 9601, '5543999900061', 'x', 'fx-proposal', now(), 'approved', 'cadence', 1, now() - interval '1 day');
    ASSERT false, 'approved sem approved_at deveria violar o CHECK';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.scheduled_followups (user_id, deal_id, phone, message, stage_id, scheduled_at, status, kind, step, basis_at, generation_meta)
    VALUES (pg_temp.fx_u(1), 9601, '5543999900061', 'x', 'fx-proposal', now(), 'draft', 'cadence', 1, now() - interval '1 day', '[]');
    ASSERT false, 'generation_meta fora de objeto deveria violar o CHECK';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.scheduled_followups (user_id, deal_id, phone, message, stage_id, scheduled_at, channel_used)
    VALUES (pg_temp.fx_u(1), 9601, '5543999900061', 'x', 'fx-proposal', now(), 'sms');
    ASSERT false, 'channel_used desconhecido deveria violar o CHECK';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.scheduled_followups (user_id, deal_id, phone, message, stage_id, scheduled_at, kind)
    VALUES (pg_temp.fx_u(1), 9601, '5543999900061', 'x', 'fx-proposal', now(), 'outro');
    ASSERT false, 'kind desconhecido deveria violar o CHECK';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.scheduled_followups (user_id, deal_id, phone, message, stage_id, scheduled_at, phone_key)
    VALUES (pg_temp.fx_u(1), 9601, '5543999900061', 'x', 'fx-proposal', now(), '554399900061');
    ASSERT false, 'phone_key é gerada e não aceita valor';
  EXCEPTION WHEN generated_always THEN NULL;
  END;

  -- Viva por deal (blocked ocupa a vaga).
  INSERT INTO public.scheduled_followups (user_id, deal_id, phone, message, stage_id, scheduled_at, status, kind, step, basis_at)
  VALUES (pg_temp.fx_u(1), 9602, '5543999900062', 'x', 'fx-proposal', now(), 'blocked', 'cadence', 1, now() - interval '2 days');
  BEGIN
    INSERT INTO public.scheduled_followups (user_id, deal_id, phone, message, stage_id, scheduled_at, status, kind, step, basis_at)
    VALUES (pg_temp.fx_u(1), 9602, '5543999900069', 'x', 'fx-proposal', now(), 'draft', 'cadence', 2, now() - interval '1 day');
    ASSERT false, 'segunda viva do mesmo deal deveria violar o índice';
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS cname = CONSTRAINT_NAME;
    ASSERT cname = 'scheduled_followups_cadence_live_deal_uidx', cname;
  END;
  UPDATE public.scheduled_followups SET status = 'cancelled' WHERE user_id = pg_temp.fx_u(1) AND deal_id = 9602 AND kind = 'cadence';
  INSERT INTO public.scheduled_followups (user_id, deal_id, phone, message, stage_id, scheduled_at, status, kind, step, basis_at)
  VALUES (pg_temp.fx_u(1), 9602, '5543999900069', 'x', 'fx-proposal', now(), 'draft', 'cadence', 2, now() - interval '1 day');

  -- Viva por telefone, com o telefone gravado em formatos diferentes.
  INSERT INTO public.scheduled_followups (user_id, deal_id, phone, message, stage_id, scheduled_at, status, kind, step, basis_at)
  VALUES (pg_temp.fx_u(1), 9603, '5543999900063', 'x', 'fx-proposal', now(), 'draft', 'cadence', 1, now() - interval '3 days');
  BEGIN
    INSERT INTO public.scheduled_followups (user_id, deal_id, phone, message, stage_id, scheduled_at, status, kind, step, basis_at)
    VALUES (pg_temp.fx_u(1), 9604, '554399900063', 'x', 'fx-proposal', now(), 'draft', 'cadence', 1, now() - interval '4 days');
    ASSERT false, 'segunda viva do mesmo telefone deveria violar o índice';
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS cname = CONSTRAINT_NAME;
    ASSERT cname = 'scheduled_followups_cadence_live_phone_uidx', cname;
  END;

  -- Episódio por deal.
  INSERT INTO public.scheduled_followups (user_id, deal_id, phone, message, stage_id, scheduled_at, status, kind, step, basis_at)
  VALUES (pg_temp.fx_u(1), 9605, '5543999900065', 'x', 'fx-proposal', now(), 'sent', 'cadence', 1, now() - interval '5 days');
  BEGIN
    INSERT INTO public.scheduled_followups (user_id, deal_id, phone, message, stage_id, scheduled_at, status, kind, step, basis_at)
    VALUES (pg_temp.fx_u(1), 9605, '5543999900066', 'x', 'fx-proposal', now(), 'skipped', 'cadence', 1, now() - interval '5 days');
    ASSERT false, 'mesmo (deal, step, basis_at) deveria violar o índice';
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS cname = CONSTRAINT_NAME;
    ASSERT cname = 'scheduled_followups_cadence_episode_uidx', cname;
  END;

  -- Episódio por telefone: deals diferentes, mesmo (phone_key, basis_at).
  INSERT INTO public.scheduled_followups (user_id, deal_id, phone, message, stage_id, scheduled_at, status, kind, step, basis_at)
  VALUES (pg_temp.fx_u(1), 9606, '5543999900068', 'x', 'fx-proposal', now(), 'sent', 'cadence', 1, now() - interval '6 days');
  BEGIN
    INSERT INTO public.scheduled_followups (user_id, deal_id, phone, message, stage_id, scheduled_at, status, kind, step, basis_at)
    VALUES (pg_temp.fx_u(1), 9607, '554399900068', 'x', 'fx-proposal', now(), 'sent', 'cadence', 1, now() - interval '6 days');
    ASSERT false, 'mesmo (phone_key, basis_at) em deals diferentes deveria violar o índice';
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS cname = CONSTRAINT_NAME;
    ASSERT cname = 'scheduled_followups_cadence_phone_episode_uidx', cname;
  END;

  -- Legado não entra nos índices de cadência.
  INSERT INTO public.scheduled_followups (user_id, deal_id, phone, message, stage_id, scheduled_at)
  VALUES (pg_temp.fx_u(1), 9603, '5543999900063', 'Oi', 'fx-proposal', now());
END $$;

-- 5. followup_cadence_config e followup_optouts.
DO $$
DECLARE cfg public.followup_cadence_config%ROWTYPE;
BEGIN
  INSERT INTO public.followup_cadence_config (user_id) VALUES (pg_temp.fx_u(1)) RETURNING * INTO cfg;
  ASSERT NOT cfg.enabled AND cfg.mode = 'approval' AND NOT cfg.allow_baileys AND NOT cfg.tracker_enabled AND cfg.allow_meta_text,
    'tudo desligado por padrão';
  ASSERT cfg.step_delays_hours = '{24,48,72,120}'::integer[] AND cfg.daily_cap = 40 AND cfg.min_gap_seconds = 60
     AND cfg.max_gap_seconds = 150 AND cfg.ladder_stage_ids = '{}'::text[] AND cfg.consecutive_errors = 0, 'defaults numéricos';
  ASSERT cfg.business_hours = '{"tz":"America/Sao_Paulo","days":[1,2,3,4,5,6],"start":"09:00","end":"19:00","holidays":[]}'::jsonb,
    'horário comercial padrão';

  BEGIN UPDATE public.followup_cadence_config SET mode = 'solto' WHERE user_id = pg_temp.fx_u(1);
    ASSERT false, 'mode'; EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN UPDATE public.followup_cadence_config SET ladder_stage_ids = '{a,b,c,d,e}' WHERE user_id = pg_temp.fx_u(1);
    ASSERT false, 'escada com 5'; EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN UPDATE public.followup_cadence_config SET ladder_stage_ids = ARRAY['a', NULL] WHERE user_id = pg_temp.fx_u(1);
    ASSERT false, 'escada com nulo'; EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN UPDATE public.followup_cadence_config SET step_delays_hours = '{}' WHERE user_id = pg_temp.fx_u(1);
    ASSERT false, 'atrasos vazios'; EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN UPDATE public.followup_cadence_config SET step_delays_hours = '{24,0}' WHERE user_id = pg_temp.fx_u(1);
    ASSERT false, 'atraso 0'; EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN UPDATE public.followup_cadence_config SET step_delays_hours = '{721}' WHERE user_id = pg_temp.fx_u(1);
    ASSERT false, 'atraso 721'; EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN UPDATE public.followup_cadence_config SET daily_cap = 0 WHERE user_id = pg_temp.fx_u(1);
    ASSERT false, 'teto 0'; EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN UPDATE public.followup_cadence_config SET min_gap_seconds = 10 WHERE user_id = pg_temp.fx_u(1);
    ASSERT false, 'intervalo mínimo 10'; EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN UPDATE public.followup_cadence_config SET min_gap_seconds = 120, max_gap_seconds = 90 WHERE user_id = pg_temp.fx_u(1);
    ASSERT false, 'máximo menor que mínimo'; EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN UPDATE public.followup_cadence_config SET paused_reason = 'cansou' WHERE user_id = pg_temp.fx_u(1);
    ASSERT false, 'motivo de pausa'; EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN UPDATE public.followup_cadence_config SET extra_instructions = repeat('a', 1001) WHERE user_id = pg_temp.fx_u(1);
    ASSERT false, 'instrução extra longa'; EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN UPDATE public.followup_cadence_config SET business_hours = '[]' WHERE user_id = pg_temp.fx_u(1);
    ASSERT false, 'horário fora de objeto'; EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN UPDATE public.followup_cadence_config SET tracker_config = '"x"' WHERE user_id = pg_temp.fx_u(1);
    ASSERT false, 'tracker fora de objeto'; EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN INSERT INTO public.followup_cadence_config (user_id) VALUES ('00000000-0000-4000-8000-0000000000ff');
    ASSERT false, 'config exige usuário existente'; EXCEPTION WHEN foreign_key_violation THEN NULL; END;

  BEGIN INSERT INTO public.followup_optouts (user_id, phone_key) VALUES (pg_temp.fx_u(1), '43-9999');
    ASSERT false, 'phone_key só dígitos'; EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN INSERT INTO public.followup_optouts (user_id, phone_key, kind) VALUES (pg_temp.fx_u(1), '554399900070', 'talvez');
    ASSERT false, 'kind do opt-out'; EXCEPTION WHEN check_violation THEN NULL; END;
  INSERT INTO public.followup_optouts (user_id, phone_key, kind, created_by) VALUES (pg_temp.fx_u(1), '554399900070', 'hard', 'funnel_tracker');
  BEGIN INSERT INTO public.followup_optouts (user_id, phone_key) VALUES (pg_temp.fx_u(1), '554399900070');
    ASSERT false, 'dois opt-outs ativos do mesmo telefone'; EXCEPTION WHEN unique_violation THEN NULL; END;
  UPDATE public.followup_optouts SET revoked_at = now(), revoked_by = 'fx' WHERE user_id = pg_temp.fx_u(1) AND phone_key = '554399900070';
  INSERT INTO public.followup_optouts (user_id, phone_key) VALUES (pg_temp.fx_u(1), '554399900070');
  ASSERT (SELECT kind FROM public.followup_optouts WHERE user_id = pg_temp.fx_u(1) AND revoked_at IS NULL) = 'manual', 'opt-out reativado';

  -- Cascata: apagar a conta leva config e opt-outs juntos.
  INSERT INTO public.followup_cadence_config (user_id) VALUES (pg_temp.fx_u(4));
  INSERT INTO public.followup_optouts (user_id, phone_key) VALUES (pg_temp.fx_u(4), '554399900071');
  DELETE FROM auth.users WHERE id = pg_temp.fx_u(4);
  ASSERT NOT EXISTS (SELECT 1 FROM public.followup_cadence_config WHERE user_id = pg_temp.fx_u(4))
     AND NOT EXISTS (SELECT 1 FROM public.followup_optouts WHERE user_id = pg_temp.fx_u(4)), 'ON DELETE CASCADE';
END $$;

-- 6. claim_cadence_followup (conta 3; a conta 2 tem uma tarefa para provar isolamento).
INSERT INTO public.followup_cadence_config (user_id, enabled, daily_cap, min_gap_seconds, max_gap_seconds) VALUES
  (pg_temp.fx_u(3), true, 40, 60, 150),
  (pg_temp.fx_u(2), true, 40, 60, 150);
INSERT INTO public.scheduled_followups (user_id, deal_id, phone, message, stage_id, scheduled_at, status, kind, step, basis_at, approved_at, approved_by)
VALUES
  (pg_temp.fx_u(3), 9701, '5543999900071', 'Oi', 'fx-proposal', now() - interval '2 minutes', 'approved', 'cadence', 1, now() - interval '30 hours', now(), 'fx'),
  (pg_temp.fx_u(3), 9702, '5543999900072', 'Oi', 'fx-proposal', now() + interval '1 hour', 'approved', 'cadence', 1, now() - interval '30 hours', now(), 'fx'),
  (pg_temp.fx_u(3), 9703, '5543999900073', 'Oi', 'fx-proposal', now() - interval '2 minutes', 'draft', 'cadence', 1, now() - interval '30 hours', NULL, NULL),
  (pg_temp.fx_u(2), 9801, '5543999900081', 'Oi', 'fx2-proposal', now() - interval '5 minutes', 'approved', 'cadence', 1, now() - interval '30 hours', now(), 'fx');

DO $$
DECLARE
  r public.scheduled_followups%ROWTYPE;
  n integer;
  ds timestamptz := now() - interval '30 minutes';
BEGIN
  SELECT count(*) INTO n FROM public.claim_cadence_followup(pg_temp.fx_u(1), 'fx-w0', 120, 90, ds);
  ASSERT n = 0, 'config desligada não entrega nada';

  SELECT * INTO r FROM public.claim_cadence_followup(pg_temp.fx_u(3), 'fx-w1', 120, 90, ds);
  ASSERT r.deal_id = 9701 AND r.status = 'sending' AND r.claimed_by = 'fx-w1' AND r.attempts = 1 AND r.claimed_at = now()
     AND r.lease_expires_at = now() + interval '120 seconds' AND r.updated_at = now(), 'claim devolve a tarefa em sending';
  ASSERT r.generation_meta ->> 'prev_status' = 'approved' AND jsonb_typeof(r.generation_meta -> 'prev_claimed_at') = 'null',
    'claim grava prev_status e prev_claimed_at';
  ASSERT (SELECT next_send_after FROM public.followup_cadence_config WHERE user_id = pg_temp.fx_u(3)) = now() + interval '90 seconds',
    'intervalo pedido maior que o mínimo da conta';

  INSERT INTO public.scheduled_followups (user_id, deal_id, phone, message, stage_id, scheduled_at, status, kind, step, basis_at, approved_at)
  VALUES (pg_temp.fx_u(3), 9704, '5543999900074', 'Oi', 'fx-proposal', now() - interval '1 minute', 'approved', 'cadence', 1,
          now() - interval '30 hours', now());
  SELECT count(*) INTO n FROM public.claim_cadence_followup(pg_temp.fx_u(3), 'fx-w1', 120, 90, ds);
  ASSERT n = 0, '2º claim imediato respeita o intervalo';

  UPDATE public.followup_cadence_config SET next_send_after = NULL, daily_cap = 1 WHERE user_id = pg_temp.fx_u(3);
  UPDATE public.scheduled_followups SET status = 'sent', sent_at = now() WHERE user_id = pg_temp.fx_u(3) AND deal_id = 9701 AND kind = 'cadence';
  SELECT count(*) INTO n FROM public.claim_cadence_followup(pg_temp.fx_u(3), 'fx-w1', 120, 90, ds);
  ASSERT n = 0, 'com daily_cap=1 e um enviado hoje não sai mais nada';

  UPDATE public.followup_cadence_config SET daily_cap = 40 WHERE user_id = pg_temp.fx_u(3);
  SELECT * INTO r FROM public.claim_cadence_followup(pg_temp.fx_u(3), 'fx-w2', 120, 30, ds);
  ASSERT r.deal_id = 9704, 'teto de volta a 40 libera a próxima';
  ASSERT (SELECT next_send_after FROM public.followup_cadence_config WHERE user_id = pg_temp.fx_u(3)) = now() + interval '60 seconds',
    'o intervalo mínimo da conta vence um pedido menor';

  -- Rampa: first_enabled_at recente derruba o teto de 40 para 10 (cadência + legado do dia).
  UPDATE public.followup_cadence_config SET next_send_after = NULL, first_enabled_at = now() - interval '1 day'
   WHERE user_id = pg_temp.fx_u(3);
  INSERT INTO public.scheduled_followups (user_id, deal_id, phone, message, stage_id, scheduled_at, sent_at, status)
  SELECT pg_temp.fx_u(3), 9750 + g, '55439999007' || g, 'Oi', 'fx-proposal', now() - interval '20 minutes', now() - interval '10 minutes', 'sent'
    FROM generate_series(0, 7) g;
  INSERT INTO public.scheduled_followups (user_id, deal_id, phone, message, stage_id, scheduled_at, sent_at, status) VALUES
    (pg_temp.fx_u(3), 9760, '5543999900760', 'Ontem', 'fx-proposal', now() - interval '3 hours', now() - interval '2 hours', 'sent'),
    (pg_temp.fx_u(3), 9761, '5543999900761', 'Falhou', 'fx-proposal', now() - interval '10 minutes', NULL, 'failed');
  INSERT INTO public.scheduled_followups (user_id, deal_id, phone, message, stage_id, scheduled_at, status, kind, step, basis_at, approved_at)
  VALUES (pg_temp.fx_u(3), 9705, '5543999900075', 'Oi', 'fx-proposal', now() - interval '1 minute', 'approved', 'cadence', 1,
          now() - interval '30 hours', now());
  SELECT count(*) INTO n FROM public.claim_cadence_followup(pg_temp.fx_u(3), 'fx-w3', 120, 90, ds);
  ASSERT n = 0, 'na rampa o teto efetivo é 10 (1 sent + 1 sending + 8 legados)';
  UPDATE public.followup_cadence_config SET first_enabled_at = now() - interval '15 days' WHERE user_id = pg_temp.fx_u(3);
  SELECT * INTO r FROM public.claim_cadence_followup(pg_temp.fx_u(3), 'fx-w3', 5, 90, ds);
  ASSERT r.deal_id = 9705 AND r.lease_expires_at = now() + interval '30 seconds', 'depois da rampa volta o teto cheio; lease mínimo 30s';

  -- Lease vencido volta com prev_status sending; lease válido não.
  UPDATE public.followup_cadence_config SET next_send_after = NULL WHERE user_id = pg_temp.fx_u(3);
  SELECT count(*) INTO n FROM public.claim_cadence_followup(pg_temp.fx_u(3), 'fx-w4', 120, 90, ds);
  ASSERT n = 0, 'sending com lease válido, draft e agendada no futuro não saem';
  UPDATE public.scheduled_followups SET lease_expires_at = now() - interval '1 second', claimed_at = now() - interval '10 minutes'
   WHERE user_id = pg_temp.fx_u(3) AND deal_id = 9705 AND kind = 'cadence';
  UPDATE public.followup_cadence_config SET next_send_after = NULL WHERE user_id = pg_temp.fx_u(3);
  SELECT * INTO r FROM public.claim_cadence_followup(pg_temp.fx_u(3), 'fx-w4', 120, 90, ds);
  ASSERT r.deal_id = 9705 AND r.attempts = 2 AND r.claimed_by = 'fx-w4' AND r.generation_meta ->> 'prev_status' = 'sending'
     AND (r.generation_meta ->> 'prev_claimed_at')::timestamptz = now() - interval '10 minutes', 'lease vencido volta ao sender';

  -- Pausa e desligado seguram; religado sai.
  INSERT INTO public.scheduled_followups (user_id, deal_id, phone, message, stage_id, scheduled_at, status, kind, step, basis_at, approved_at)
  VALUES (pg_temp.fx_u(3), 9706, '5543999900076', 'Oi', 'fx-proposal', now() - interval '1 minute', 'approved', 'cadence', 1,
          now() - interval '30 hours', now());
  UPDATE public.followup_cadence_config SET next_send_after = NULL, paused_at = now(), paused_reason = 'manual' WHERE user_id = pg_temp.fx_u(3);
  SELECT count(*) INTO n FROM public.claim_cadence_followup(pg_temp.fx_u(3), 'fx-w5', 120, 90, ds);
  ASSERT n = 0, 'pausado';
  UPDATE public.followup_cadence_config SET paused_at = NULL, paused_reason = NULL, enabled = false WHERE user_id = pg_temp.fx_u(3);
  SELECT count(*) INTO n FROM public.claim_cadence_followup(pg_temp.fx_u(3), 'fx-w5', 120, 90, ds);
  ASSERT n = 0, 'desligado';
  UPDATE public.followup_cadence_config SET enabled = true WHERE user_id = pg_temp.fx_u(3);
  SELECT * INTO r FROM public.claim_cadence_followup(pg_temp.fx_u(3), 'fx-w5', 120, 90, ds);
  ASSERT r.deal_id = 9706, 'religado sai';

  ASSERT (SELECT status FROM public.scheduled_followups WHERE user_id = pg_temp.fx_u(3) AND deal_id = 9702) = 'approved', 'futura intacta';
  ASSERT (SELECT status FROM public.scheduled_followups WHERE user_id = pg_temp.fx_u(3) AND deal_id = 9703) = 'draft', 'rascunho intacto';
  ASSERT (SELECT status FROM public.scheduled_followups WHERE user_id = pg_temp.fx_u(2) AND deal_id = 9801) = 'approved',
    'a conta 3 nunca pega tarefa da conta 2';
  SELECT * INTO r FROM public.claim_cadence_followup(pg_temp.fx_u(2), 'fx-w6', 120, 90, ds);
  ASSERT r.deal_id = 9801 AND r.user_id = pg_temp.fx_u(2), 'a conta 2 pega a dela';
END $$;

-- 7. Retenção (conta 5; a conta 2 tem uma linha velha que não pode ser tocada).
INSERT INTO public.scheduled_followups (user_id, deal_id, phone, message, stage_id, scheduled_at, sent_at, status, kind, step, basis_at,
  approved_at, draft_text, generation_meta, updated_at) VALUES
  (pg_temp.fx_u(5), 9901, '5543999900091', 'Oi', 'fx-proposal', now() - interval '100 days', now() - interval '100 days', 'sent', 'cadence', 1,
     now() - interval '101 days', now() - interval '100 days', 'original',
     '{"context_tail":[{"from_me":true,"body":"oi","type":"text","timestamp":"2026-01-01T00:00:00Z"}],"model":"fx-model"}', now() - interval '100 days'),
  (pg_temp.fx_u(5), 9902, '5543999900092', '', 'fx-proposal', now() - interval '40 days', NULL, 'cancelled', 'cadence', 1,
     now() - interval '41 days', NULL, 'cancelado', '{"context_tail":[]}', now() - interval '40 days'),
  (pg_temp.fx_u(5), 9903, '5543999900093', 'Oi', 'fx-proposal', now() - interval '100 days', NULL, 'draft', 'cadence', 1,
     now() - interval '101 days', NULL, 'vivo', '{"context_tail":[]}', now() - interval '100 days'),
  (pg_temp.fx_u(5), 9904, '5543999900094', 'Oi', 'fx-proposal', now(), now(), 'sent', 'cadence', 1,
     now() - interval '1 day', now(), 'recente', '{"context_tail":[]}', now()),
  (pg_temp.fx_u(2), 9905, '5543999900095', 'Oi', 'fx2-proposal', now() - interval '100 days', now() - interval '100 days', 'sent', 'cadence', 1,
     now() - interval '101 days', now() - interval '100 days', 'outro tenant', '{"context_tail":[]}', now() - interval '100 days');

DO $$
DECLARE r public.scheduled_followups%ROWTYPE;
BEGIN
  ASSERT public.followup_cadence_retention(pg_temp.fx_u(5), 90) = 1, 'só a linha sent com mais de 90 dias';
  SELECT * INTO r FROM public.scheduled_followups WHERE user_id = pg_temp.fx_u(5) AND deal_id = 9901;
  ASSERT r.draft_text IS NULL AND NOT (r.generation_meta ? 'context_tail') AND r.generation_meta ? 'retention_applied_at'
     AND r.generation_meta ->> 'model' = 'fx-model' AND r.message = 'Oi', 'retenção zera draft_text e context_tail e guarda o resto';
  ASSERT public.followup_cadence_retention(pg_temp.fx_u(5), 90) = 0, 'idempotente';
  ASSERT public.followup_cadence_retention(pg_temp.fx_u(5), 5) = 1, 'mínimo de 30 dias: pega a cancelada de 40 dias';
  ASSERT (SELECT draft_text FROM public.scheduled_followups WHERE user_id = pg_temp.fx_u(5) AND deal_id = 9903) = 'vivo', 'viva intacta';
  ASSERT (SELECT draft_text FROM public.scheduled_followups WHERE user_id = pg_temp.fx_u(5) AND deal_id = 9904) = 'recente', 'recente intacta';
  ASSERT (SELECT draft_text FROM public.scheduled_followups WHERE user_id = pg_temp.fx_u(2) AND deal_id = 9905) = 'outro tenant',
    'outro tenant intacto';
END $$;

-- 8. Segurança: SECURITY DEFINER só para service_role; RLS só de leitura nas tabelas novas.
DO $$
DECLARE fn text; role_name text; n integer; u1 uuid := pg_temp.fx_u(1); u3 uuid := pg_temp.fx_u(3);
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.followup_customer_phone_keys(uuid)',
    'public.followup_cadence_candidates(uuid,text[],text[],integer,integer)',
    'public.claim_cadence_followup(uuid,text,integer,integer,timestamptz)',
    'public.followup_cadence_retention(uuid,integer)'] LOOP
    FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      ASSERT NOT has_function_privilege(role_name, fn, 'EXECUTE'), format('%s não pode executar %s', role_name, fn);
    END LOOP;
    ASSERT has_function_privilege('service_role', fn, 'EXECUTE'), format('service_role executa %s', fn);
    ASSERT (SELECT prosecdef AND proconfig = ARRAY['search_path=public, pg_temp'] FROM pg_proc WHERE oid = fn::regprocedure),
      format('%s: SECURITY DEFINER com search_path fixo', fn);
  END LOOP;

  ASSERT (SELECT bool_and(relrowsecurity) FROM pg_class
           WHERE oid IN ('public.followup_cadence_config'::regclass, 'public.followup_optouts'::regclass)), 'RLS ligado';
  ASSERT (SELECT count(*) FROM pg_policies WHERE schemaname = 'public'
           AND tablename IN ('followup_cadence_config', 'followup_optouts')) = 2, 'uma policy por tabela';
  ASSERT (SELECT bool_and(cmd = 'SELECT') FROM pg_policies WHERE schemaname = 'public'
           AND tablename IN ('followup_cadence_config', 'followup_optouts')), 'policies só de leitura';
  ASSERT NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'scheduled_followups'),
    'scheduled_followups segue sem policy';
  ASSERT (SELECT count(*) FROM pg_constraint WHERE contype = 'f' AND confrelid = 'auth.users'::regclass AND confdeltype = 'c'
           AND conrelid IN ('public.followup_cadence_config'::regclass, 'public.followup_optouts'::regclass)) = 2, 'FK com cascata';

  -- Como authenticated: lê só a própria config, não escreve e não chama as funções.
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', u3::text, true);
  SELECT count(*) INTO n FROM public.followup_cadence_config;
  ASSERT n = 1, format('authenticated vê só a própria config (%s)', n);
  BEGIN
    UPDATE public.followup_cadence_config SET enabled = false;
    GET DIAGNOSTICS n = ROW_COUNT;
    ASSERT n = 0, 'authenticated não altera config';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.followup_optouts (user_id, phone_key) VALUES (u3, '554399900099');
    ASSERT false, 'authenticated não grava opt-out';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.claim_cadence_followup(u3, 'intruso', 120, 90, now());
    ASSERT false, 'authenticated não chama o claim';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;
  SET LOCAL ROLE service_role;
  SELECT count(*) INTO n FROM public.followup_cadence_candidates(u1, ARRAY['fx-proposal']);
  ASSERT n > 0, 'service_role chama as funções';
  RESET ROLE;
  ASSERT (SELECT enabled FROM public.followup_cadence_config WHERE user_id = u3), 'config da conta 3 intacta';
END $$;

ROLLBACK;

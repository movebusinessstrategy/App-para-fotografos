import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync(
  new URL('./migrations/074_marketing_measurement_bridge_v2.sql', import.meta.url),
  'utf8',
);

const functionBody = (name: string): string => {
  const marker = `CREATE OR REPLACE FUNCTION public.${name}`;
  const start = sql.indexOf(marker);
  assert.notEqual(start, -1, `${name} deve existir`);
  const end = sql.indexOf('\n$$;', start);
  assert.notEqual(end, -1, `${name} deve terminar com $$;`);
  return sql.slice(start, end + 4);
};

test('migration é transacional e preserva a evolução incremental da 066', () => {
  assert.match(sql, /^BEGIN;/m);
  assert.match(sql, /COMMIT;\s*$/);
  assert.doesNotMatch(sql, /DROP TABLE\s+(?:IF EXISTS\s+)?public\.marketing_/i);
  assert.match(sql, /ALTER TABLE public\.marketing_touchpoints/);
  assert.match(sql, /ALTER TABLE public\.marketing_conversion_outbox/);
});

test('sites e nonces implementam ponte assinada e proteção contra replay por tenant', () => {
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.marketing_sites/);
  assert.match(sql, /signing_secret_ciphertext text NOT NULL/);
  assert.match(sql, /allowed_origins\s+text\[\] NOT NULL/);
  assert.match(sql, /measurement_enabled\s+boolean NOT NULL DEFAULT false/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.marketing_acquisition_channels/);
  assert.match(sql, /external_account_id ~ '\^55\[1-9\]\[0-9\]\{9,10\}\$'/);
  assert.match(sql, /marketing_acquisition_active_number_unique/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.marketing_bridge_nonces/);
  assert.match(sql, /UNIQUE \(marketing_site_id, nonce_hash\)/);
  assert.match(sql, /FOREIGN KEY \(marketing_site_id, user_id\)[\s\S]+REFERENCES public\.marketing_sites \(id, user_id\)/);
  assert.match(sql, /nonce_hash ~ '\^\[0-9a-f\]\{64\}\$'/);

  const consume = functionBody('consume_marketing_bridge_nonce');
  assert.match(consume, /p_origin = ANY \(site\.allowed_origins\)/);
  assert.match(consume, /site\.measurement_enabled/);
  assert.match(consume, /p_expires_at > now\(\) \+ interval '10 minutes'/);
  assert.match(consume, /ON CONFLICT ON CONSTRAINT marketing_bridge_nonce_unique DO NOTHING/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.consume_marketing_bridge_nonce[\s\S]+TO service_role;/);
  assert.doesNotMatch(sql, /GRANT EXECUTE ON FUNCTION public\.consume_marketing_bridge_nonce[\s\S]+TO authenticated;/);
});

test('touchpoint, deal e outbox carregam identidade estável e snapshots congelados', () => {
  [
    'lead_id',
    'bridge_payload_hash',
    'bridge_reference_hash',
    'ga_client_id',
    'ga_session_id',
    'client_user_agent',
    'whatsapp_business_account_id',
    'consent_snapshot',
    'contact_confirmed_at',
  ].forEach((column) => {
    assert.match(sql, new RegExp(`ADD COLUMN IF NOT EXISTS ${column}`));
  });
  assert.match(sql, /ADD COLUMN IF NOT EXISTS marketing_lead_id uuid/);
  assert.match(sql, /deals_marketing_lead_tenant_unique/);
  [
    'integration_id',
    'destination_id',
    'provider_event_name',
    'touchpoint_id',
    'lead_id',
    'consent_snapshot',
    'user_data',
    'attribution_data',
    'event_data',
    'payload_hash',
    'claim_token',
    'claimed_at',
  ].forEach((column) => {
    assert.match(sql, new RegExp(`ADD COLUMN IF NOT EXISTS ${column}`));
  });
  assert.match(functionBody('enqueue_marketing_event'), /public\.marketing_json_hash\(jsonb_build_object/);
  assert.match(functionBody('enqueue_marketing_event'), /'ph',[\s\S]+public\.marketing_identity_hash/);
  assert.match(functionBody('enqueue_marketing_event'), /'fbc',[\s\S]+touchpoint\.fbc/);
  assert.match(functionBody('enqueue_marketing_event'), /'gclid',[\s\S]+touchpoint\.gclid/);
});

test('integrações são únicas por tenant, provider e destino, incluindo GA4', () => {
  assert.match(sql, /provider IN \('meta', 'google', 'ga4'\)/);
  assert.match(
    sql,
    /marketing_integrations_tenant_destination_unique[\s\S]+\(user_id, provider, \(btrim\(destination_id\)\)\)/,
  );
  assert.match(sql, /FOREIGN KEY \(integration_id, user_id\)/);
  assert.match(sql, /REFERENCES public\.marketing_integrations \(id, user_id\)/);
  assert.match(functionBody('guard_marketing_outbox_integration'), /MARKETING_INTEGRATION_TENANT_MISMATCH/);
});

test('migração não reclassifica dados legados de outras contas', () => {
  assert.doesNotMatch(sql, /UPDATE public\.marketing_integrations\s+SET enabled = false/);
  assert.doesNotMatch(sql, /UPDATE public\.marketing_touchpoints\s+SET lead_id/);
  assert.doesNotMatch(sql, /UPDATE public\.marketing_touchpoints\s+SET consent_snapshot/);
  assert.doesNotMatch(sql, /LEGACY_DESTINATION_REQUIRED/);
  assert.match(
    sql,
    /marketing_site_id IS NULL[\s\S]+OR NOT enabled[\s\S]+OR nullif\(btrim\(destination_id\), ''\) IS NOT NULL/,
  );
});

test('Contact exige mensagem real e não transforma clique no site em lead', () => {
  const body = functionBody('queue_confirmed_contact_conversions');
  assert.match(body, /new\.contact_confirmed_at/);
  assert.match(body, /new\.channel = 'whatsapp'/);
  assert.match(body, /new\.source = 'meta_click_to_whatsapp'/);
  assert.match(body, /new\.external_event_id IS NOT NULL/);
  assert.match(body, /'Contact'/);
  assert.doesNotMatch(body, /new\.channel = 'website'/);
});

test('intake do site é atômico, deriva tenant do site e não confia em user_id do payload', () => {
  const body = functionBody('register_marketing_site_intake');
  assert.match(body, /public\.consume_marketing_bridge_nonce/);
  assert.match(body, /p_origin/);
  assert.match(body, /tenant_id/);
  assert.match(body, /'website'/);
  assert.match(body, /'site_bridge'/);
  assert.match(body, /p_touchpoint ->> 'external_event_id'/);
  assert.match(body, /p_touchpoint ->> 'campaign_external_id'/);
  assert.match(body, /ON CONFLICT \([\s\S]+user_id, event_scope_key, channel, external_event_id[\s\S]+\) DO NOTHING/);
  assert.match(body, /bridge_payload_hash IS DISTINCT FROM p_body_sha256[\s\S]+conflict_payload/);
  assert.match(body, /'page_path'[\s\S]+p_touchpoint -> 'metadata'/);
  assert.doesNotMatch(body, /p_touchpoint\s*->>\s*'user_id'/);
  const persistedValues = body.slice(body.indexOf('  VALUES ('), body.indexOf('  ON CONFLICT'));
  assert.doesNotMatch(persistedValues, /p_touchpoint ->> 'phone'/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.register_marketing_site_intake[\s\S]+TO service_role;/);
});

test('RPC de WhatsApp usa referência exata, CTWA ou telefone único sem persistir mensagem', () => {
  const body = functionBody('capture_marketing_whatsapp_contact');
  assert.match(body, /MARKETING_CONTACT_IDENTIFIERS_REQUIRED/);
  assert.match(body, /channel_e164 := public\.marketing_brazil_e164\(p_wa_number\)/);
  assert.match(body, /JOIN public\.marketing_acquisition_channels AS acquisition/);
  assert.match(body, /acquisition\.external_account_id = channel_e164/);
  assert.match(body, /acquisition\.enabled/);
  assert.match(body, /'disabled'::text/);
  assert.match(body, /bridge_reference_hash = bridge_hash/);
  assert.match(body, /touch\.marketing_site_id = acquisition_site_id/);
  assert.match(body, /public\.marketing_brazil_e164\(touch\.wa_number\) = channel_e164/);
  assert.match(body, /pg_advisory_xact_lock/);
  assert.match(body, /GET DIAGNOSTICS linked_deal_count = ROW_COUNT/);
  assert.match(body, /IF linked_deal_count <> 1 THEN[\s\S]+resolved_deal_id := NULL/);
  assert.match(body, /touch\.ctwa_clid = p_ctwa_clid/);
  assert.match(body, /coalesce\(cardinality\(candidate_leads\), 0\) = 1/);
  assert.match(body, /p_occurred_at < now\(\) - interval '7 days'/);
  assert.match(body, /p_occurred_at > now\(\) \+ interval '5 minutes'/);
  assert.match(body, /touch\.last_seen_at <= p_occurred_at \+ interval '5 minutes'/);
  assert.match(body, /'Contact'/);
  assert.match(body, /p_referral_attribution jsonb/);
  assert.match(body, /safe_referral/);
  const persistedValues = body.slice(body.indexOf('  VALUES ('), body.indexOf('  ON CONFLICT'));
  assert.doesNotMatch(persistedValues, /p_message_body/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.capture_marketing_whatsapp_contact[\s\S]+TO service_role;/);
});

test('gatilhos globais permanecem inertes fora de site explicitamente habilitado', () => {
  const enqueue = functionBody('enqueue_marketing_event');
  const dealEnqueue = functionBody('enqueue_marketing_deal_event');
  const linker = functionBody('link_pending_marketing_touchpoints');

  assert.match(enqueue, /site\.id = touchpoint\.marketing_site_id/);
  assert.match(enqueue, /site\.user_id = p_user_id/);
  assert.match(enqueue, /site\.measurement_enabled/);
  assert.match(dealEnqueue, /JOIN public\.marketing_sites AS site/);
  assert.match(dealEnqueue, /site\.measurement_enabled/);
  assert.match(linker, /site\.user_id = new\.user_id/);
  assert.match(linker, /site\.measurement_enabled/);
});

test('integração e outbox ficam vinculadas ao site exato e quarentena não trava a fila', () => {
  const enqueue = functionBody('enqueue_marketing_event');
  const guard = functionBody('guard_marketing_outbox_integration');
  const claim = functionBody('claim_marketing_conversion_outbox');

  assert.match(sql, /ADD COLUMN IF NOT EXISTS marketing_site_id uuid/);
  assert.match(sql, /marketing_integrations_site_provider_unique[\s\S]+WHERE marketing_site_id IS NOT NULL AND enabled/);
  assert.match(enqueue, /integration\.marketing_site_id = touchpoint\.marketing_site_id/);
  assert.match(guard, /new\.status = 'blocked_config'/);
  assert.match(guard, /old\.integration_id IS NOT DISTINCT FROM new\.integration_id/);
  assert.match(guard, /integration\.marketing_site_id IS DISTINCT FROM new\.marketing_site_id/);
  assert.match(claim, /integration\.marketing_site_id = outbox\.marketing_site_id/);
  assert.match(claim, /outbox\.status = 'accepted_unverified'[\s\S]+outbox\.provider = 'google'/);
});

test('Meta CTWA só enfileira outcomes explicitamente mapeados', () => {
  const enqueue = functionBody('enqueue_marketing_event');
  assert.match(enqueue, /touchpoint\.ctwa_clid/);
  assert.match(enqueue, /IN \('LeadSubmitted', 'Purchase'\)/);
  assert.doesNotMatch(enqueue, /QualifiedLead/);
  assert.match(enqueue, /integration\.provider = 'meta'[\s\S]+ad_personalization'[\s\S]+granted/);
});

test('Lead só nasce em etapa explicitamente mapeada e não na criação automática do deal', () => {
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.marketing_stage_event_mappings/);
  const body = functionBody('queue_mapped_stage_conversions');
  assert.match(body, /mapping\.user_id = new\.user_id/);
  assert.match(body, /mapping\.stage_id = new\.stage::text/);
  assert.match(body, /mapping\.event_name = 'Lead'/);
  assert.match(body, /mapping\.enabled/);
  assert.match(body, /IF mapped_event IS NULL THEN[\s\S]+RETURN new;/);
  assert.doesNotMatch(sql, /INSERT INTO public\.marketing_stage_event_mappings\s*\(/);
  assert.doesNotMatch(sql, /Orçamento Enviado/i);
});

test('vínculo por telefone falha fechado quando existe ambiguidade', () => {
  const body = functionBody('link_pending_marketing_touchpoints');
  assert.match(body, /SELECT DISTINCT touch\.lead_id/);
  assert.match(body, /LIMIT 2/);
  assert.match(body, /coalesce\(cardinality\(candidate_ids\), 0\) <> 1/);
  assert.doesNotMatch(body, /ORDER BY touch\.last_seen_at[\s\S]+LIMIT 1/);
});

test('Schedule exige job scheduled e Purchase exige converted_at', () => {
  const fromDeal = functionBody('queue_deal_schedule_conversions');
  const fromJob = functionBody('queue_job_schedule_conversions');
  const purchase = functionBody('queue_deal_purchase_conversions');
  assert.match(fromDeal, /job\.status/);
  assert.match(fromDeal, /job_status <> 'scheduled'/);
  assert.match(fromJob, /new\.status <> 'scheduled'/);
  assert.match(fromJob, /deal\.converted_job_id = new\.id/);
  assert.match(purchase, /new\.converted_at IS NULL/);
  assert.match(purchase, /'Purchase'/);
});

test('vinculo tardio do lead recupera Lead, Schedule e Purchase sem depender de nova mudanca de etapa', () => {
  const lead = functionBody('queue_mapped_stage_conversions');
  const schedule = functionBody('queue_deal_schedule_conversions');
  const purchase = functionBody('queue_deal_purchase_conversions');

  [lead, schedule, purchase].forEach((body) => {
    assert.match(body, /old\.marketing_lead_id IS NULL/);
    assert.match(body, /new\.marketing_lead_id IS NOT NULL/);
  });

  assert.match(sql, /AFTER INSERT OR UPDATE OF stage, marketing_lead_id ON public\.deals/);
  assert.match(sql, /AFTER INSERT OR UPDATE OF converted_job_id, marketing_lead_id ON public\.deals/);
  assert.match(sql, /AFTER INSERT OR UPDATE OF converted_at, marketing_lead_id ON public\.deals/);
});

test('consentimento é granular por provider e nunca deriva granted do legado', () => {
  const enqueue = functionBody('enqueue_marketing_event');
  assert.match(sql, /'analytics_storage', 'unknown'/);
  assert.match(sql, /'ad_storage', 'unknown'/);
  assert.match(sql, /'ad_user_data', 'unknown'/);
  assert.match(sql, /'ad_personalization', 'unknown'/);
  assert.match(enqueue, /integration\.provider = 'ga4'[\s\S]+analytics_storage'[\s\S]+granted/);
  assert.match(enqueue, /integration\.provider = 'google'[\s\S]+ad_user_data'[\s\S]+granted/);
  assert.match(enqueue, /integration\.provider = 'meta'[\s\S]+ad_user_data'[\s\S]+granted/);
  assert.match(enqueue, /public\.marketing_consent_snapshot_at/);
  assert.match(enqueue, /frozen_consent ->> 'ad_user_data' <> 'granted'[\s\S]+'\{\}'::jsonb/);
  assert.doesNotMatch(enqueue, /touchpoint\.consent_status\s*=\s*'granted'/);
  assert.match(enqueue, /integration\.user_id = p_user_id/);
  assert.match(enqueue, /integration\.enabled/);
  assert.match(enqueue, /nullif\(btrim\(integration\.destination_id\), ''\) IS NOT NULL/);
});

test('GA4 exige client_id real e Google congela click IDs sem PII', () => {
  const enqueue = functionBody('enqueue_marketing_event');
  assert.match(enqueue, /'ga_client_id',[\s\S]+touchpoint\.ga_client_id/);
  assert.match(enqueue, /'ga_session_id',[\s\S]+touchpoint\.ga_session_id/);
  assert.match(enqueue, /integration\.provider <> 'ga4'[\s\S]+touchpoint\.ga_client_id/);
  assert.match(enqueue, /integration\.provider <> 'google'[\s\S]+touchpoint\.gclid/);
  assert.match(enqueue, /WHEN integration\.provider = 'meta' THEN frozen_user_data[\s\S]+ELSE '\{\}'::jsonb/);
});

test('Meta recebe user agent apenas da ponte assinada e nenhum IP é aceito', () => {
  const intake = functionBody('register_marketing_site_intake');
  const enqueue = functionBody('enqueue_marketing_event');
  assert.match(intake, /ad_user_data'[\s\S]+client_user_agent/);
  assert.match(enqueue, /'client_user_agent', touchpoint\.client_user_agent/);
  assert.doesNotMatch(sql, /client_ip_address|client_ip|p_ip_address/);
});

test('hash Meta usa telefone brasileiro E.164 e referência usa lowercase canônico', () => {
  const phone = functionBody('marketing_brazil_e164');
  const identity = functionBody('marketing_identity_hash');
  const enqueue = functionBody('enqueue_marketing_event');
  assert.match(phone, /WHEN digits ~ '\^55\[1-9\]\[0-9\]\{9,10\}\$' THEN digits/);
  assert.match(phone, /THEN '55' \|\| digits/);
  assert.match(identity, /lower\(btrim\(raw_value\)\)/);
  assert.match(enqueue, /marketing_brazil_e164\(coalesce\(p_contact_phone, touchpoint\.phone\)\)/);
  assert.doesNotMatch(enqueue, /marketing_identity_hash\(\s*public\.marketing_phone_key/);
});

test('IDs de evento são estáveis e não incorporam timestamps mutáveis', () => {
  const dealEnqueue = functionBody('enqueue_marketing_deal_event');
  const purchase = functionBody('queue_deal_purchase_conversions');
  assert.match(dealEnqueue, /concat\('lead:', coalesce\(p_lead_id, resolved_lead_id\), ':', lower\(p_event_name\)\)/);
  assert.doesNotMatch(dealEnqueue, /extract\(epoch/);
  assert.doesNotMatch(purchase, /extract\(epoch/);
  assert.match(sql, /marketing_conversion_integration_event_unique[\s\S]+\(user_id, integration_id, event_id\)/);
});

test('claim RPC usa lease, SKIP LOCKED e só entrega linhas da integração exata', () => {
  const claim = functionBody('claim_marketing_conversion_outbox');
  assert.match(claim, /integration\.id = outbox\.integration_id/);
  assert.match(claim, /integration\.user_id = outbox\.user_id/);
  assert.match(claim, /integration\.provider = outbox\.provider/);
  assert.match(claim, /btrim\(integration\.destination_id\)[\s\S]+IS NOT DISTINCT FROM btrim\(outbox\.destination_id\)/);
  assert.match(claim, /FOR UPDATE OF outbox SKIP LOCKED/);
  assert.match(claim, /outbox\.claimed_at < now\(\) - safe_lease/);
  assert.match(claim, /claim_token = batch_token/);
  assert.match(claim, /p_user_ids uuid\[\]/);
  assert.match(
    sql,
    /DROP FUNCTION IF EXISTS public\.claim_marketing_conversion_outbox\(\s*integer, integer\s*\);/,
  );
  assert.match(functionBody('guard_marketing_outbox_integration'), /new\.integration_id IS NULL AND new\.marketing_site_id IS NULL[\s\S]+RETURN new/);
  assert.match(claim, /outbox\.user_id = ANY \(safe_user_ids\)/);
  assert.match(claim, /outbox\.marketing_site_id IS NOT NULL/);
  assert.match(claim, /outbox\.integration_id IS NOT NULL/);
  assert.match(claim, /'pending', 'retry', 'validation_only'/);
  assert.match(claim, /DESTINATION_OWNERSHIP_NOT_VERIFIED/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.claim_marketing_conversion_outbox\(integer, integer, uuid\[\]\)[\s\S]+FROM PUBLIC, anon, authenticated;/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.claim_marketing_conversion_outbox\(integer, integer, uuid\[\]\)[\s\S]+TO service_role;/);
});

test('fatos, consentimento atual e ownership externo impedem perda ou mistura', () => {
  const enqueue = functionBody('enqueue_marketing_event');
  const claim = functionBody('claim_marketing_conversion_outbox');
  const replay = functionBody('replay_marketing_conversion_facts');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.marketing_conversion_facts/);
  assert.match(sql, /marketing_fact_tenant_event_unique[\s\S]+UNIQUE \(user_id, marketing_site_id, event_id\)/);
  assert.match(enqueue, /INSERT INTO public\.marketing_conversion_facts/);
  assert.match(replay, /public\.marketing_provider_consent_allowed/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.marketing_consent_ledger/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.record_marketing_consent_change/);
  assert.match(claim, /status = 'cancelled_consent'/);
  assert.match(claim, /public\.marketing_provider_consent_allowed/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.marketing_destination_ownership/);
  assert.match(sql, /marketing_destination_owner_global_unique[\s\S]+UNIQUE \(provider, resource_key\)/);
  assert.match(enqueue, /ownership\.integration_id = integration\.id/);
  assert.match(claim, /ownership\.integration_id = outbox\.integration_id/);
  assert.match(
    replay,
    /existing\.status IN \(\s*'blocked_config', 'validation_only', 'cancelled_consent'\s*\)/,
  );
  assert.match(replay, /MARKETING_REPLAY_PAYLOAD_CONFLICT/);
  assert.match(sql, /marketing_touchpoints_deal_tenant_fk[\s\S]+NOT VALID/);
  assert.match(sql, /marketing_conversion_touchpoint_tenant_fk[\s\S]+NOT VALID/);
  assert.match(sql, /marketing_fact_touchpoint_tenant_fk/);
});

test('Google exige ação explícita por evento e origem fica congelada', () => {
  const enqueue = functionBody('enqueue_marketing_event');
  assert.match(enqueue, /'source_context', CASE[\s\S]+p_event_name = 'Contact'[\s\S]+'message'[\s\S]+'other'/);
  assert.match(enqueue, /integration\.event_mappings -> p_event_name ->> 'conversion_action_id'/);
  assert.doesNotMatch(
    enqueue,
    /coalesce\(\s*integration\.event_mappings -> p_event_name ->> 'conversion_action_id',\s*integration\.conversion_action_id/,
  );
});

test('deduplicação considera site e número de aquisição', () => {
  const capture = functionBody('capture_marketing_whatsapp_contact');
  assert.match(sql, /event_scope_key text GENERATED ALWAYS AS/);
  assert.match(sql, /marketing_touchpoints_scope_event_unique[\s\S]+event_scope_key/);
  assert.match(capture, /ON CONFLICT \([\s\S]+user_id, event_scope_key, channel, external_event_id/);
  assert.match(capture, /touch\.marketing_site_id = acquisition_site_id[\s\S]+touch\.wa_number/);
});

test('segredos do site e integrações são ciphertext estrito e não ficam no SELECT cliente', () => {
  assert.match(sql, /signing_secret_ciphertext ~ '\^enc:v1:/);
  assert.match(sql, /credentials_encrypted ~ '\^enc:v1:/);
  assert.match(sql, /REVOKE SELECT ON public\.marketing_sites FROM anon, authenticated/);
  assert.match(sql, /REVOKE SELECT ON public\.marketing_bridge_nonces FROM anon, authenticated/);
  assert.match(sql, /REVOKE SELECT ON public\.marketing_integrations FROM anon, authenticated/);
  const siteGrant = sql.match(/GRANT SELECT \([\s\S]+?\) ON public\.marketing_sites TO authenticated;/)?.[0] || '';
  const integrationGrant = sql.match(/GRANT SELECT \([\s\S]+?\) ON public\.marketing_integrations TO authenticated;/)?.[0] || '';
  assert.doesNotMatch(siteGrant, /signing_secret_ciphertext/);
  assert.doesNotMatch(integrationGrant, /credentials_encrypted/);
});

test('RLS é explícita e não há credenciais globais embutidas', () => {
  [
    'marketing_sites',
    'marketing_bridge_nonces',
    'marketing_stage_event_mappings',
    'marketing_destination_ownership',
    'marketing_consent_ledger',
    'marketing_conversion_facts',
  ].forEach((table) => {
    assert.match(sql, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`));
    assert.match(sql, new RegExp(`auth\\.uid\\(\\) = user_id`));
  });
  assert.doesNotMatch(sql, /META_CAPI_TOKEN|GOOGLE_ADS_TOKEN|GA4_API_SECRET|process\.env/);
  assert.doesNotMatch(sql, /106504936590336|104939529371497|GTM-PZF6MBLS/);
  assert.match(sql, /REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.purge_marketing_measurement_history/);
  assert.match(sql, /p_before > now\(\) - interval '30 days'/);
});

test('isolamento de site e fallback de deal permanecem fail closed', () => {
  const capture = functionBody('capture_marketing_whatsapp_contact');
  const exactSiteMatches = capture.match(/touch\.marketing_site_id = acquisition_site_id/g) || [];
  assert.ok(exactSiteMatches.length >= 4);
  assert.doesNotMatch(capture, /touch\.marketing_site_id = acquisition_site_id\s+OR/);
  assert.match(capture, /deal\.converted_at IS NULL[\s\S]+marketing_phone_key\(deal\.contact_phone\)/);
});

test('consentimento assinado resolve identidade no servidor e funciona durante pausa', () => {
  const latest = functionBody('marketing_latest_consent_status');
  const trigger = functionBody('record_marketing_touchpoint_consent');
  const recorder = functionBody('record_marketing_consent_change');
  const signedUpdate = functionBody('record_marketing_site_consent_update');
  const registeredUpdate = functionBody('register_marketing_site_consent_update');
  const signature = signedUpdate.slice(0, signedUpdate.indexOf('RETURNS TABLE'));

  assert.match(latest, /ledger\.occurred_at <= now\(\)/);
  assert.doesNotMatch(trigger, /site\.enabled|site\.measurement_enabled/);
  assert.doesNotMatch(recorder, /site\.enabled|site\.measurement_enabled/);
  assert.doesNotMatch(signature, /p_user_id|p_lead_id/);
  assert.match(signedUpdate, /site\.site_key_id = p_site_key_id/);
  assert.match(signedUpdate, /p_origin = ANY \(site\.allowed_origins\)/);
  assert.match(signedUpdate, /touch\.bridge_reference_hash = p_bridge_reference_hash/);
  assert.match(signedUpdate, /matched_count <> 1/);
  assert.match(signedUpdate, /jsonb_each_text\(p_consent_snapshot\)/);
  assert.match(signedUpdate, /record_marketing_consent_change/);
  assert.doesNotMatch(signedUpdate, /site\.enabled|site\.measurement_enabled/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.record_marketing_site_consent_update[\s\S]+TO service_role;/);
  assert.match(registeredUpdate, /marketing_bridge_nonces/);
  assert.match(registeredUpdate, /record_marketing_site_consent_update/);
  assert.match(registeredUpdate, /p_update ->> 'bridge_reference_hash'/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.register_marketing_site_consent_update[\s\S]+TO service_role;/);
});

test('fila congela rota completa, expira janela e só revive falha transitória', () => {
  const hash = functionBody('marketing_outbox_payload_hash');
  const replay = functionBody('replay_marketing_conversion_facts');
  const claim = functionBody('claim_marketing_conversion_outbox');
  const transient = functionBody('marketing_dead_error_is_transient');

  ['p_account_id', 'p_conversion_action_id', 'p_provider_event_name'].forEach((field) => {
    assert.match(hash, new RegExp(`${field} text`));
  });
  assert.match(replay, /existing\.status = 'dead'[\s\S]+marketing_dead_error_is_transient/);
  assert.match(replay, /existing\.payload_hash = eligible\.payload_hash/);
  assert.match(replay, /marketing_provider_event_is_fresh/);
  assert.match(transient, /PROVIDER_NETWORK_ERROR/);
  assert.match(transient, /PROVIDER_HTTP_\(408\|425\|429\|5\[0-9\]\{2\}\)/);
  assert.match(claim, /integration\.enabled[\s\S]+site\.enabled[\s\S]+site\.measurement_enabled/);
  assert.match(claim, /PROVIDER_EVENT_WINDOW_EXPIRED/);
});

test('accepted_unverified é purgável e URLs não carregam query ou hash', () => {
  const sanitize = functionBody('marketing_sanitized_source_url');
  const intake = functionBody('register_marketing_site_intake');
  const enqueue = functionBody('enqueue_marketing_event');
  const purge = functionBody('purge_marketing_measurement_history');

  assert.match(sanitize, /regexp_replace[\s\S]+'\[\?#\]\.\*\$'/);
  assert.match(intake, /marketing_sanitized_source_url\(p_touchpoint ->> 'source_url'\)/);
  assert.match(enqueue, /marketing_sanitized_source_url\(touchpoint\.source_url\)/);
  assert.match(purge, /'validation_only', 'accepted_unverified'/);
  assert.match(purge, /NOT EXISTS \([\s\S]+marketing_touchpoints[\s\S]+marketing_conversion_facts[\s\S]+marketing_conversion_outbox/);
});

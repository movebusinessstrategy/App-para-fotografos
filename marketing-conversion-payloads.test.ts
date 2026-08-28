import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildGa4MeasurementRequest,
  buildGoogleDataManagerRequest,
  buildMetaConversionsRequest,
  MarketingPayloadError,
  type MarketingConversionOutboxRow,
  type MarketingIntegrationRow,
  type MarketingProvider,
} from './lib/marketing-conversion-payloads.js';

const CLAIM_TOKEN = '1dcb1e96-6b1f-4c5f-a4f5-72824cdd31b0';
const PAYLOAD_HASH = 'a'.repeat(64);
const TENANT_ID = '56dd4834-ed5e-42b6-9a79-dc896a9a756f';

function row(
  provider: MarketingProvider,
  overrides: Partial<MarketingConversionOutboxRow> = {},
): MarketingConversionOutboxRow {
  return {
    id: 91,
    user_id: TENANT_ID,
    deal_id: 44,
    lead_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    provider,
    event_name: 'Contact',
    event_id: 'lead:opaque-id:contact',
    occurred_at: new Date().toISOString(),
    value: 0,
    currency: 'BRL',
    status: 'processing',
    attempts: 1,
    integration_id: 7,
    marketing_site_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    destination_id: provider === 'ga4' ? 'G-ABC123XYZ' : 'destination-123',
    account_id: provider === 'google' ? '8275091764' : null,
    conversion_action_id: provider === 'google' ? '99887766' : null,
    provider_event_name: 'Contact',
    event_source_url: 'https://www.example.com/ensaio-de-gestante1?utm_campaign=private#cta',
    consent_snapshot: {
      status: 'granted',
      analytics_storage: 'granted',
      ad_user_data: 'granted',
      ad_personalization: 'granted',
    },
    user_data: {
      em: 'b'.repeat(64),
      ph: 'c'.repeat(64),
      lead_id: 'internal-lead-id',
      client_user_agent: 'Mozilla/5.0 Studio Browser',
    },
    attribution_data: {
      fbc: 'fb.1.1700000000.click',
      fbp: 'fb.1.1700000000.browser',
      gclid: 'real-google-click',
      ga_client_id: '1234567890.1700000000',
      utm_campaign: 'sensitive-campaign-name-never-emitted',
    },
    event_data: { event_name: 'Contact', source_context: 'message' },
    payload_hash: PAYLOAD_HASH,
    claim_token: CLAIM_TOKEN,
    ...overrides,
  };
}

function integration(
  provider: MarketingProvider,
  overrides: Partial<MarketingIntegrationRow> = {},
): MarketingIntegrationRow {
  return {
    id: 7,
    user_id: TENANT_ID,
    provider,
    enabled: true,
    marketing_site_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    account_id: provider === 'google' ? '8275091764' : null,
    destination_id: provider === 'ga4' ? 'G-ABC123XYZ' : 'destination-123',
    conversion_action_id: provider === 'google' ? '99887766' : null,
    credentials_encrypted: 'enc:v1:a:b:c',
    event_mappings: {},
    provider_config: provider === 'meta' ? { api_version: 'v25.0' } : {},
    ...overrides,
  };
}

function errorCode(error: unknown, code: string): boolean {
  return error instanceof MarketingPayloadError && error.code === code;
}

test('Meta usa chat para conversões confirmadas no WhatsApp/CRM sem CTWA', () => {
  const request = buildMetaConversionsRequest(
    row('meta'),
    integration('meta'),
    { access_token: 'meta-token' },
  );
  const event = (request.body.data as Record<string, unknown>[])[0];
  const serialized = JSON.stringify(request.body);

  assert.equal(request.url, 'https://graph.facebook.com/v25.0/destination-123/events');
  assert.equal(request.headers.Authorization, 'Bearer meta-token');
  assert.equal(event.event_name, 'Contact');
  assert.equal(event.event_id, 'lead:opaque-id:contact');
  assert.equal(event.action_source, 'chat');
  assert.equal('event_source_url' in event, false);
  assert.deepEqual(event.user_data, {
    fbc: 'fb.1.1700000000.click',
    fbp: 'fb.1.1700000000.browser',
    em: ['b'.repeat(64)],
    ph: ['c'.repeat(64)],
  });
  assert.doesNotMatch(serialized, /utm_campaign|lead_id|client_user_agent|sensitive-campaign|gestante/i);
});

test('Meta Purchase envia moeda e valor sem renomear o evento de negócio', () => {
  const request = buildMetaConversionsRequest(
    row('meta', {
      event_name: 'Purchase',
      event_id: 'deal:44:Purchase',
      value: 1490,
      event_data: { event_name: 'Purchase', source_context: 'other' },
    }),
    integration('meta'),
    { access_token: 'meta-token' },
  );
  const event = (request.body.data as Record<string, unknown>[])[0];

  assert.equal(event.event_name, 'Purchase');
  assert.equal(event.action_source, 'other');
  assert.deepEqual(event.custom_data, { currency: 'BRL', value: 1490 });
});

test('Meta business_messaging só usa CTWA real com WABA configurada e correspondente', () => {
  const request = buildMetaConversionsRequest(
    row('meta', {
      event_name: 'Lead',
      provider_event_name: 'LeadSubmitted',
      event_data: { event_name: 'Lead', source_context: 'other' },
      attribution_data: {
        ctwa_clid: 'AR-real-ctwa-click-id',
        whatsapp_business_account_id: '123456789012345',
        fbc: 'must-not-be-used-for-messaging',
      },
    }),
    integration('meta', {
      provider_config: {
        api_version: 'v25.0',
        whatsapp_business_account_id: '123456789012345',
      },
    }),
    { access_token: 'meta-token' },
  );
  const event = (request.body.data as Record<string, unknown>[])[0];

  assert.equal(event.event_name, 'LeadSubmitted');
  assert.equal(event.action_source, 'business_messaging');
  assert.equal(event.messaging_channel, 'whatsapp');
  assert.deepEqual(event.user_data, {
    whatsapp_business_account_id: '123456789012345',
    ctwa_clid: 'AR-real-ctwa-click-id',
  });
  assert.equal('event_source_url' in event, false);
});

test('Meta não usa CTWA quando WABA falta ou não pertence à integração', () => {
  const ctwaRow = row('meta', {
    provider_event_name: 'LeadSubmitted',
    attribution_data: {
      ctwa_clid: 'AR-real-ctwa-click-id',
      whatsapp_business_account_id: '123456789012345',
    },
  });
  assert.throws(
    () => buildMetaConversionsRequest(ctwaRow, integration('meta'), { access_token: 'token' }),
    error => errorCode(error, 'INVALID_CONFIGURATION'),
  );
  assert.throws(
    () => buildMetaConversionsRequest(
      ctwaRow,
      integration('meta', {
        provider_config: {
          api_version: 'v25.0',
          whatsapp_business_account_id: '999999999999999',
        },
      }),
      { access_token: 'token' },
    ),
    error => errorCode(error, 'DESTINATION_MISMATCH'),
  );
});

test('Meta business_messaging rejeita QualifiedLead e nomes genéricos sem validação real', () => {
  for (const providerEventName of ['QualifiedLead', 'Lead']) {
    assert.throws(
      () => buildMetaConversionsRequest(
        row('meta', {
          event_name: 'Lead',
          provider_event_name: providerEventName,
          event_data: { event_name: 'Lead', source_context: 'other' },
          attribution_data: {
            ctwa_clid: 'AR-real-ctwa-click-id',
            whatsapp_business_account_id: '123456789012345',
          },
        }),
        integration('meta', {
          provider_config: {
            api_version: 'v25.0',
            whatsapp_business_account_id: '123456789012345',
          },
        }),
        { access_token: 'token' },
      ),
      error => errorCode(error, 'INVALID_CONFIGURATION'),
    );
  }
});

test('Meta em validação exige test_event_code e nunca simula validateOnly', () => {
  assert.throws(
    () => buildMetaConversionsRequest(
      row('meta'),
      integration('meta'),
      { access_token: 'token' },
      { validateOnly: true },
    ),
    error => errorCode(error, 'INVALID_CONFIGURATION'),
  );
  const request = buildMetaConversionsRequest(
    row('meta'),
    integration('meta', { provider_config: { api_version: 'v25.0', test_event_code: 'TEST123' } }),
    { access_token: 'token' },
    { validateOnly: true },
  );
  assert.equal(request.body.test_event_code, 'TEST123');
});

test('GA4 usa client_id capturado, nomes genéricos e debug endpoint em validação', () => {
  const request = buildGa4MeasurementRequest(
    row('ga4', {
      event_name: 'Lead',
      event_id: 'deal:44:Lead',
      event_data: { event_name: 'Lead', source_context: 'other' },
    }),
    integration('ga4'),
    { api_secret: 'ga4-secret' },
    { validateOnly: true },
  );
  const event = (request.body.events as Record<string, unknown>[])[0];
  const serialized = JSON.stringify(request.body);

  assert.match(request.url, /^https:\/\/www\.google-analytics\.com\/debug\/mp\/collect\?/);
  assert.equal(request.body.client_id, '1234567890.1700000000');
  assert.equal(event.name, 'generate_lead');
  assert.equal(request.body.validation_behavior, 'ENFORCE_RECOMMENDATIONS');
  assert.deepEqual(request.body.consent, {
    ad_user_data: 'GRANTED',
    ad_personalization: 'GRANTED',
  });
  assert.doesNotMatch(serialized, /internal-lead-id|"em"|"ph"|utm_campaign/i);
});

test('GA4 Purchase inclui item genérico de sessão sem dado sensível', () => {
  const request = buildGa4MeasurementRequest(
    row('ga4', {
      event_name: 'Purchase',
      event_id: 'deal:44:Purchase',
      value: 1890,
      event_data: { event_name: 'Purchase', source_context: 'other' },
    }),
    integration('ga4'),
    { api_secret: 'ga4-secret' },
  );
  const event = (request.body.events as Record<string, unknown>[])[0];

  assert.equal(event.name, 'purchase');
  assert.deepEqual(event.params, {
    event_id: 'deal:44:Purchase',
    engagement_time_msec: 1,
    currency: 'BRL',
    value: 1890,
    transaction_id: 'deal:44:Purchase',
    items: [{
      item_id: 'studio_session',
      item_name: 'Studio session',
      quantity: 1,
      price: 1890,
    }],
  });
  assert.doesNotMatch(JSON.stringify(event), /gestant|gravid|matern/i);
});

test('GA4 rejeita evento antigo e omite session_id fora da sessão', () => {
  const oldOccurredAt = new Date(Date.now() - 73 * 60 * 60 * 1_000).toISOString();
  assert.throws(
    () => buildGa4MeasurementRequest(
      row('ga4', { occurred_at: oldOccurredAt }),
      integration('ga4'),
      { api_secret: 'secret' },
    ),
    error => errorCode(error, 'INVALID_SNAPSHOT'),
  );

  const occurredAt = new Date();
  const request = buildGa4MeasurementRequest(
    row('ga4', {
      occurred_at: occurredAt.toISOString(),
      attribution_data: {
        ga_client_id: '1234567890.1700000000',
        ga_session_id: String(Math.floor((occurredAt.getTime() - 31 * 60 * 1_000) / 1_000)),
      },
    }),
    integration('ga4'),
    { api_secret: 'secret' },
  );
  const event = (request.body.events as Record<string, any>[])[0];
  assert.equal(event.params.engagement_time_msec, 1);
  assert.equal('session_id' in event.params, false);
});

test('GA4 recusa atribuição sem client_id real em vez de fabricar identidade', () => {
  assert.throws(
    () => buildGa4MeasurementRequest(
      row('ga4', { attribution_data: {}, user_data: { lead_id: 'not-a-client-id' } }),
      integration('ga4'),
      { api_secret: 'secret' },
    ),
    error => errorCode(error, 'INVALID_CONFIGURATION'),
  );
});

test('consentimento é avaliado separadamente por provedor', () => {
  const snapshot = {
    status: 'denied',
    analytics_storage: 'granted',
    ad_user_data: 'denied',
  };
  const ga4 = buildGa4MeasurementRequest(
    row('ga4', { consent_snapshot: snapshot }),
    integration('ga4'),
    { api_secret: 'secret' },
  );
  assert.deepEqual(ga4.body.consent, {
    ad_user_data: 'DENIED',
    ad_personalization: 'DENIED',
  });
  assert.throws(
    () => buildMetaConversionsRequest(
      row('meta', { consent_snapshot: snapshot }),
      integration('meta'),
      { access_token: 'token' },
    ),
    error => errorCode(error, 'CONSENT_REQUIRED'),
  );
});

test('Google Data Manager usa somente click IDs e suporta validateOnly', () => {
  const request = buildGoogleDataManagerRequest(
    row('google', {
      event_name: 'Purchase',
      event_id: 'deal:44:Purchase',
      value: 2390,
      event_data: { event_name: 'Purchase', source_context: 'other' },
      attribution_data: {
        gclid: 'gclid-real',
        gbraid: 'gbraid-real',
        wbraid: 'wbraid-real',
      },
    }),
    integration('google', { provider_config: { login_account_id: '1122334455' } }),
    { access_token: 'google-oauth-token' },
    { validateOnly: true },
  );
  const destination = (request.body.destinations as Record<string, unknown>[])[0];
  const event = (request.body.events as Record<string, unknown>[])[0];
  const serialized = JSON.stringify(request.body);

  assert.equal(request.url, 'https://datamanager.googleapis.com/v1/events:ingest');
  assert.equal(request.body.validateOnly, true);
  assert.deepEqual(destination, {
    reference: 'conversion_destination',
    operatingAccount: { accountId: '8275091764', accountType: 'GOOGLE_ADS' },
    productDestinationId: '99887766',
    loginAccount: { accountId: '1122334455', accountType: 'GOOGLE_ADS' },
  });
  assert.deepEqual(event.adIdentifiers, {
    gclid: 'gclid-real',
    gbraid: 'gbraid-real',
    wbraid: 'wbraid-real',
  });
  assert.equal(event.transactionId, 'deal:44:Purchase');
  assert.equal(event.eventSource, 'OTHER');
  assert.equal(event.currency, 'BRL');
  assert.equal(event.conversionValue, 2390);
  assert.deepEqual(request.body.consent, {
    adUserData: 'CONSENT_GRANTED',
    adPersonalization: 'CONSENT_GRANTED',
  });
  assert.doesNotMatch(serialized, /"userData"|"user_data"|internal-lead-id|"em"|"ph"/i);
});

test('Google mapeia contexto message congelado para MESSAGE', () => {
  const request = buildGoogleDataManagerRequest(
    row('google'),
    integration('google'),
    { access_token: 'token' },
  );
  const event = (request.body.events as Record<string, unknown>[])[0];

  assert.equal(event.eventSource, 'MESSAGE');
});

test('todos os provedores falham fechado sem source_context válido e compatível', () => {
  assert.throws(
    () => buildMetaConversionsRequest(
      row('meta', { event_data: { event_name: 'Contact' } }),
      integration('meta'),
      { access_token: 'token' },
    ),
    error => errorCode(error, 'INVALID_SNAPSHOT'),
  );
  assert.throws(
    () => buildGoogleDataManagerRequest(
      row('google', { event_data: { event_name: 'Contact', source_context: 'website' } }),
      integration('google'),
      { access_token: 'token' },
    ),
    error => errorCode(error, 'INVALID_SNAPSHOT'),
  );
  assert.throws(
    () => buildGa4MeasurementRequest(
      row('ga4', { event_data: { event_name: 'Contact', source_context: 'other' } }),
      integration('ga4'),
      { api_secret: 'secret' },
    ),
    error => errorCode(error, 'INVALID_SNAPSHOT'),
  );
});

test('Google propaga ad_personalization denied e bloqueia ad_user_data denied', () => {
  const allowed = buildGoogleDataManagerRequest(
    row('google', {
      consent_snapshot: {
        status: 'granted',
        ad_user_data: 'granted',
        ad_personalization: 'denied',
      },
    }),
    integration('google'),
    { access_token: 'token' },
  );
  assert.deepEqual(allowed.body.consent, {
    adUserData: 'CONSENT_GRANTED',
    adPersonalization: 'CONSENT_DENIED',
  });
  assert.throws(
    () => buildGoogleDataManagerRequest(
      row('google', {
        consent_snapshot: {
          status: 'granted',
          ad_user_data: 'denied',
          ad_personalization: 'denied',
        },
      }),
      integration('google'),
      { access_token: 'token' },
    ),
    error => errorCode(error, 'CONSENT_REQUIRED'),
  );
});

test('consentimento granular unknown não é promovido para granted pelo status geral', () => {
  const snapshot = {
    status: 'granted',
    analytics_storage: 'granted',
    ad_user_data: 'granted',
    ad_personalization: 'unknown',
  };
  const ga4 = buildGa4MeasurementRequest(
    row('ga4', { consent_snapshot: snapshot }),
    integration('ga4'),
    { api_secret: 'secret' },
  );
  const google = buildGoogleDataManagerRequest(
    row('google', { consent_snapshot: snapshot }),
    integration('google'),
    { access_token: 'token' },
  );

  assert.deepEqual(ga4.body.consent, { ad_user_data: 'GRANTED' });
  assert.deepEqual(google.body.consent, {
    adUserData: 'CONSENT_GRANTED',
    adPersonalization: 'CONSENT_STATUS_UNSPECIFIED',
  });
});

test('Google recusa linha sem click ID real e integração de outro tenant', () => {
  assert.throws(
    () => buildGoogleDataManagerRequest(
      row('google', { attribution_data: {} }),
      integration('google'),
      { access_token: 'token' },
    ),
    error => errorCode(error, 'IDENTIFIER_REQUIRED'),
  );
  assert.throws(
    () => buildGoogleDataManagerRequest(
      row('google'),
      integration('google', { user_id: 'another-tenant' }),
      { access_token: 'token' },
    ),
    error => errorCode(error, 'DESTINATION_MISMATCH'),
  );
});

test('nenhum provedor aceita evento com nome sensível', () => {
  assert.throws(
    () => buildGoogleDataManagerRequest(
      row('google', { event_name: 'GestanteLead' as never }),
      integration('google'),
      { access_token: 'token' },
    ),
    error => errorCode(error, 'INVALID_EVENT'),
  );
});

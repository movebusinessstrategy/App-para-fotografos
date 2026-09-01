import type { SupabaseClient } from '@supabase/supabase-js';
import {
  MarketingSiteIntakeError,
  prepareMarketingSiteRequest,
  type PreparedMarketingSiteConsentUpdate,
  type PreparedMarketingSiteIntake,
  type PreparedMarketingSiteRequest,
} from './marketing-site-intake.js';

type MarketingSiteRow = {
  id: string;
  user_id: string;
  site_key_id: string;
  signing_secret_ciphertext: string;
  enabled: boolean;
};

type RegisteredIntakeRow = {
  result_status?: unknown;
  lead_id?: unknown;
  event_id?: unknown;
};

export type MarketingSiteConsentUpdateRpcArgs = {
  p_site_key_id: string;
  p_origin: string;
  p_nonce_hash: string;
  p_body_sha256: string;
  p_signed_at: string;
  p_update: {
    event_id: string;
    occurred_at: string;
    bridge_reference_hash: string;
    consent_snapshot: Record<string, string>;
  };
};

export type MarketingSiteConsentUpdateWriter = (
  args: MarketingSiteConsentUpdateRpcArgs,
) => Promise<{ data: unknown; error: unknown }>;

const ENCRYPTED_SECRET_PATTERN = /^enc:v1:[^:]+:[^:]+:[^:]+$/;

export type MarketingSiteRouteInput = {
  rawBody: Buffer;
  method: string;
  path: string;
  origin: string;
  siteKeyId: string;
  timestamp: string;
  nonce: string;
  signature: string;
};

export type MarketingSiteRouteDeps = {
  db: SupabaseClient;
  decryptSecret: (ciphertext: string) => string | null;
  bridgeReferenceSecret?: string | Buffer;
  registerConsentUpdate?: MarketingSiteConsentUpdateWriter;
};

export class MarketingSiteRouteError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = 'MarketingSiteRouteError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

function requiredHeader(value: unknown, label: string, maxLength: number): string {
  const clean = typeof value === 'string' ? value.trim() : '';
  if (!clean || clean.length > maxLength) {
    throw new MarketingSiteRouteError(401, 'INVALID_BRIDGE_AUTH', `${label} ausente ou inválido`);
  }
  return clean;
}

function normalizedOrigin(value: unknown): string {
  const clean = requiredHeader(value, 'Origin', 500);
  try {
    const parsed = new URL(clean);
    if (
      !['http:', 'https:'].includes(parsed.protocol)
      || parsed.username
      || parsed.password
      || clean !== parsed.origin
    ) throw new Error();
    return parsed.origin;
  } catch {
    throw new MarketingSiteRouteError(401, 'INVALID_BRIDGE_ORIGIN', 'Origin inválida');
  }
}

async function exactSite(db: SupabaseClient, siteKeyId: string): Promise<MarketingSiteRow> {
  const result = await db.from('marketing_sites')
    .select('id,user_id,site_key_id,signing_secret_ciphertext,enabled')
    .eq('site_key_id', siteKeyId)
    .eq('enabled', true)
    .limit(2);
  if (result.error) throw result.error;
  if (result.data?.length !== 1) {
    throw new MarketingSiteRouteError(401, 'UNKNOWN_BRIDGE', 'Ponte de mensuração inválida');
  }
  return result.data[0] as MarketingSiteRow;
}

function rpcTouchpoint(prepared: PreparedMarketingSiteIntake): Record<string, unknown> {
  const { user_id: _ignoredTenant, ...row } = prepared.touchpoint;
  return {
    ...row,
    event_id: prepared.event.event_id,
    campaign_id: prepared.event.campaign_id,
  };
}

function consentUpdateRpcArgs(
  site: MarketingSiteRow,
  origin: string,
  prepared: PreparedMarketingSiteConsentUpdate,
): MarketingSiteConsentUpdateRpcArgs {
  return {
    p_site_key_id: site.site_key_id,
    p_origin: origin,
    p_nonce_hash: prepared.verified_request.nonce_hash,
    p_body_sha256: prepared.verified_request.body_sha256,
    p_signed_at: prepared.verified_request.signed_at,
    p_update: {
      event_id: prepared.event.event_id,
      occurred_at: prepared.event.occurred_at,
      bridge_reference_hash: prepared.event.bridge_reference_hash,
      consent_snapshot: prepared.event.consent_snapshot,
    },
  };
}

function registeredRow(data: unknown): RegisteredIntakeRow {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== 'object') {
    throw new MarketingSiteRouteError(409, 'INTAKE_REJECTED', 'Clique não registrado');
  }
  return row as RegisteredIntakeRow;
}

function successfulStatus(value: unknown): 'created' | 'duplicate' {
  if (value === 'created' || value === 'duplicate') return value;
  throw new MarketingSiteRouteError(409, 'INTAKE_REJECTED', 'Clique rejeitado ou repetido');
}

async function writeClick(
  deps: MarketingSiteRouteDeps,
  site: MarketingSiteRow,
  origin: string,
  prepared: PreparedMarketingSiteIntake,
) {
  const registered = await deps.db.rpc('register_marketing_site_intake', {
    p_site_key_id: site.site_key_id,
    p_origin: origin,
    p_nonce_hash: prepared.verified_request.nonce_hash,
    p_body_sha256: prepared.verified_request.body_sha256,
    p_signed_at: prepared.verified_request.signed_at,
    p_touchpoint: rpcTouchpoint(prepared),
  });
  if (registered.error) throw registered.error;
  const row = registeredRow(registered.data);
  const status = successfulStatus(row.result_status);
  const leadId = typeof row.lead_id === 'string' ? row.lead_id : prepared.response.lead_id;
  const eventId = typeof row.event_id === 'string' ? row.event_id : prepared.response.event_id;
  return { ...prepared.response, status, lead_id: leadId, event_id: eventId };
}

async function writeConsentUpdate(
  deps: MarketingSiteRouteDeps,
  site: MarketingSiteRow,
  origin: string,
  prepared: PreparedMarketingSiteConsentUpdate,
) {
  const args = consentUpdateRpcArgs(site, origin, prepared);
  const registered = deps.registerConsentUpdate
    ? await deps.registerConsentUpdate(args)
    : await deps.db.rpc('register_marketing_site_consent_update', args);
  if (registered.error) throw registered.error;
  const row = registeredRow(registered.data);
  const status = successfulStatus(row.result_status);
  const eventId = typeof row.event_id === 'string' ? row.event_id : prepared.response.event_id;
  return { ...prepared.response, status, event_id: eventId };
}

function isConsentUpdate(
  prepared: PreparedMarketingSiteRequest,
): prepared is PreparedMarketingSiteConsentUpdate {
  return prepared.event.event_name === 'ConsentUpdate';
}

async function writePreparedRequest(
  deps: MarketingSiteRouteDeps,
  site: MarketingSiteRow,
  origin: string,
  prepared: PreparedMarketingSiteRequest,
) {
  if (isConsentUpdate(prepared)) {
    return writeConsentUpdate(deps, site, origin, prepared);
  }
  return writeClick(deps, site, origin, prepared);
}

async function prepareRoutedRequest(
  deps: MarketingSiteRouteDeps,
  input: MarketingSiteRouteInput,
): Promise<{ site: MarketingSiteRow; origin: string; prepared: PreparedMarketingSiteRequest }> {
  const siteKeyId = requiredHeader(input.siteKeyId, 'Site key', 200);
  const site = await exactSite(deps.db, siteKeyId);
  if (!ENCRYPTED_SECRET_PATTERN.test(site.signing_secret_ciphertext)) {
    throw new MarketingSiteRouteError(
      503,
      'BRIDGE_DISABLED',
      'Ponte de mensuração indisponível',
    );
  }
  const secret = deps.decryptSecret(site.signing_secret_ciphertext);
  if (!secret) throw new MarketingSiteRouteError(503, 'BRIDGE_DISABLED', 'Ponte de mensuração indisponível');
  const origin = normalizedOrigin(input.origin);

  let prepared: PreparedMarketingSiteRequest;
  try {
    prepared = prepareMarketingSiteRequest({
      rawBody: input.rawBody,
      timestamp: requiredHeader(input.timestamp, 'Timestamp', 20),
      nonce: requiredHeader(input.nonce, 'Nonce', 128),
      method: input.method,
      path: input.path,
      siteKeyId: site.site_key_id,
      origin,
      signature: requiredHeader(input.signature, 'Assinatura', 100),
      secret,
      bridgeReferenceSecret: deps.bridgeReferenceSecret,
      userId: site.user_id,
    });
  } catch (error) {
    if (error instanceof MarketingSiteIntakeError) throw error;
    throw new MarketingSiteRouteError(400, 'INVALID_INTAKE', 'Clique inválido');
  }
  return { site, origin, prepared };
}

export async function registerMarketingSiteEvent(
  deps: MarketingSiteRouteDeps,
  input: MarketingSiteRouteInput,
) {
  const routed = await prepareRoutedRequest(deps, input);
  return writePreparedRequest(deps, routed.site, routed.origin, routed.prepared);
}

export async function registerMarketingSiteClick(
  deps: MarketingSiteRouteDeps,
  input: MarketingSiteRouteInput,
) {
  const routed = await prepareRoutedRequest(deps, input);
  if (!('touchpoint' in routed.prepared) || routed.prepared.event.event_name !== 'WhatsAppClick') {
    throw new MarketingSiteRouteError(422, 'INVALID_EVENT', 'Somente WhatsAppClick é aceito nesta operação');
  }
  return writeClick(deps, routed.site, routed.origin, routed.prepared);
}

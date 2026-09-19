import { authFetch } from '../../utils/authFetch';
import type {
  ApproveAllRequest, ApproveAllResult, DealFollowUpState, FollowUpConfigPutRequest, FollowUpConfigPutResponse,
  FollowUpConfigResponse, FollowUpDraftItem, FollowUpErrorCode, FollowUpOptOut, FollowUpOverview,
  FollowUpQueueResponse, FollowUpStep, FollowUpTrack, PreviewMessage, QueueTab, ReconcileApplyRequest,
  ReconcileApplyResult, ReconcilePreview, SweepDryRun,
} from './types';

// Wrappers finos sobre authFetch (a impersonação depende dos headers que ele injeta).

export const FOLLOWUPS_BASE = '/api/followups';
export const OVERVIEW_URL = `${FOLLOWUPS_BASE}/overview`;
export const CONFIG_URL = `${FOLLOWUPS_BASE}/config`;

export class FollowUpApiError extends Error {
  status: number;
  code: FollowUpErrorCode | null;
  fields: Record<string, string> | null;

  constructor(message: string, status: number, code: FollowUpErrorCode | null, fields: Record<string, string> | null) {
    super(message);
    this.name = 'FollowUpApiError';
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

const GENERIC_ERROR = 'Não foi possível concluir agora. Tente de novo em instantes.';
const OFFLINE_ERROR = 'Sem conexão com o servidor. Nada foi alterado.';

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

async function readJson(res: Response): Promise<unknown> {
  try { return await res.json(); } catch { return null; }
}

function toApiError(status: number, data: unknown): FollowUpApiError {
  const body = (data && typeof data === 'object' ? data : {}) as { error?: unknown; code?: unknown; fields?: unknown };
  const message = typeof body.error === 'string' && body.error ? body.error : GENERIC_ERROR;
  const code = typeof body.code === 'string' ? (body.code as FollowUpErrorCode) : null;
  const fields = body.fields && typeof body.fields === 'object' ? (body.fields as Record<string, string>) : null;
  return new FollowUpApiError(message, status, code, fields);
}

async function call<T>(method: Method, url: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method };
  if (body !== undefined) init.body = JSON.stringify(body);
  let res: Response;
  try {
    res = await authFetch(url, init);
  } catch {
    throw new FollowUpApiError(OFFLINE_ERROR, 0, null, null);
  }
  const data = await readJson(res);
  if (!res.ok) throw toApiError(res.status, data);
  return data as T;
}

// Fetcher do SWR: mesmo formato de erro das ações.
export function fetchJson<T>(url: string): Promise<T> {
  return call<T>('GET', url);
}

function withQuery(path: string, params: Record<string, string | number | null | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== null && v !== undefined && v !== '') q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `${path}?${s}` : path;
}

export interface QueueQuery {
  status: QueueTab;
  step?: FollowUpStep | null;
  track?: FollowUpTrack | null;
  stage_id?: string | null;
  deal_id?: number | null;
  search?: string;
  offset?: number;
  limit?: number;
  preview?: number;
}

export function queueUrl(q: QueueQuery): string {
  return withQuery(`${FOLLOWUPS_BASE}/queue`, {
    status: q.status, step: q.step, track: q.track, stage_id: q.stage_id, deal_id: q.deal_id,
    search: q.search?.trim(), offset: q.offset, limit: q.limit, preview: q.preview,
  });
}

export function optOutsUrl(q: { search?: string; offset?: number; limit?: number }): string {
  return withQuery(`${FOLLOWUPS_BASE}/optouts`, { search: q.search?.trim(), offset: q.offset, limit: q.limit });
}

export function dealStateUrl(dealId: number | string): string {
  return `${FOLLOWUPS_BASE}/deal/${encodeURIComponent(String(dealId))}`;
}

export interface SweepBody {
  dry_run?: boolean;
  step?: FollowUpStep;
  track?: FollowUpTrack;
  deal_ids?: number[];
  limit?: number;
  consent_to_external_ai?: boolean;
}
export interface SweepStarted { started: true; eligible_total: number; will_generate: number }
export type SweepResponse = SweepDryRun | SweepStarted;

export function isSweepStarted(r: SweepResponse): r is SweepStarted {
  return (r as SweepStarted).started === true;
}

export type ItemResponse = { item: FollowUpDraftItem };
export type ApproveResponse = { item: FollowUpDraftItem; warning?: string };
export type RegenerateResponse = { item: FollowUpDraftItem; ai_suggests_skip?: { reason: string } };
export type SkipScope = 'step' | 'deal';

const itemUrl = (id: number, suffix = '') => `${FOLLOWUPS_BASE}/${encodeURIComponent(String(id))}${suffix}`;

export const api = {
  overview: () => call<FollowUpOverview>('GET', OVERVIEW_URL),
  queue: (q: QueueQuery) => call<FollowUpQueueResponse>('GET', queueUrl(q)),
  conversation: (id: number, limit = 30) =>
    call<{ messages: PreviewMessage[] }>('GET', withQuery(itemUrl(id, '/conversation'), { limit })),
  dealState: (dealId: number | string) => call<DealFollowUpState>('GET', dealStateUrl(dealId)),
  sweep: (body: SweepBody) => call<SweepResponse>('POST', `${FOLLOWUPS_BASE}/sweep`, body),
  patchText: (id: number, text: string) => call<ItemResponse>('PATCH', itemUrl(id), { text }),
  approve: (id: number, text?: string) => call<ApproveResponse>('POST', itemUrl(id, '/approve'), text === undefined ? {} : { text }),
  approveAll: (req: ApproveAllRequest) => call<ApproveAllResult>('POST', `${FOLLOWUPS_BASE}/approve-all`, req),
  skip: (id: number, scope: SkipScope = 'step', reason?: string) =>
    call<ItemResponse>('POST', itemUrl(id, '/skip'), { scope, ...(reason ? { reason } : {}) }),
  regenerate: (id: number, opts: { instruction?: string; force?: boolean } = {}) =>
    call<RegenerateResponse>('POST', itemUrl(id, '/regenerate'), opts),
  setSending: (paused: boolean) =>
    call<{ sending: FollowUpOverview['sending'] }>('POST', `${FOLLOWUPS_BASE}/sending`, { paused }),
  getConfig: () => call<FollowUpConfigResponse>('GET', CONFIG_URL),
  saveConfig: (body: FollowUpConfigPutRequest) => call<FollowUpConfigPutResponse>('PUT', CONFIG_URL, body),
  listOptOuts: (q: { search?: string; offset?: number; limit?: number }) =>
    call<{ items: FollowUpOptOut[]; total: number }>('GET', optOutsUrl(q)),
  addOptOut: (body: { deal_id?: number; phone?: string; reason?: string }) =>
    call<{ optout: FollowUpOptOut }>('POST', `${FOLLOWUPS_BASE}/optouts`, body),
  removeOptOut: (id: number) =>
    call<{ success: true }>('DELETE', `${FOLLOWUPS_BASE}/optouts/${encodeURIComponent(String(id))}`),
  reconcilePreview: (opts: { limit?: number; days?: number } = {}) =>
    call<ReconcilePreview>('GET', withQuery(`${FOLLOWUPS_BASE}/reconcile/preview`, opts)),
  reconcileApply: (req: ReconcileApplyRequest) =>
    call<ReconcileApplyResult>('POST', `${FOLLOWUPS_BASE}/reconcile/apply`, req),
  // Tarefa da automação antiga: usa a rota que já existe.
  cancelLegacyPending: (dealId: number | string) =>
    call<{ success: boolean }>('DELETE', `/api/deals/${encodeURIComponent(String(dealId))}/follow-ups/pending`),
};

// 409 que significam "o item mudou": a tela recarrega a lista em vez de mostrar erro.
const CHANGED_CODES: ReadonlySet<string> = new Set(['STAGE_CHANGED', 'ALREADY_CLAIMED', 'INVALID_STATUS', 'CONVERSATION_CHANGED']);

export function isItemChanged(err: unknown): boolean {
  return err instanceof FollowUpApiError && err.status === 409 && CHANGED_CODES.has(String(err.code));
}

export function errorMessage(err: unknown): string {
  if (err instanceof FollowUpApiError) return err.message;
  return GENERIC_ERROR;
}

export function errorStatus(err: unknown): number | null {
  const status = (err as { status?: unknown } | null)?.status;
  return typeof status === 'number' ? status : null;
}

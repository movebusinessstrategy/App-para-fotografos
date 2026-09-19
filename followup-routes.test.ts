import assert from 'node:assert/strict';
import test from 'node:test';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import {
  approvedByLabel, canApproveFollowUps, isMigrationMissing, parseDraftText, parseQueueQuery, registerFollowUpRoutes,
  requireFollowUpApprover, sendRouteError, toDraftItem, FollowUpRouteError,
} from './followup-routes.js';
import type { ApproverLabels, DealLite, FollowUpRouteCtx } from './followup-routes.js';
import type {
  ChannelHealth, FollowUpServices, ForecastInput, ForecastResult, RegenerateResult, SweepState,
} from './src/features/followups/types.js';
import { DEFAULT_BUSINESS_HOURS } from './src/features/followups/types.js';
import { canonicalPhoneKey } from './lib/br-phone.js';

// ─── Supabase falso em memória (subconjunto do PostgREST usado pelas rotas) ───

type Row = Record<string, any>;
type Pred = (row: Row) => boolean;

function norm(v: unknown): unknown {
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) return Date.parse(v);
  if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v;
}

function cmp(a: unknown, b: unknown): number {
  const x = norm(a);
  const y = norm(b);
  if (typeof x === 'number' && typeof y === 'number') return x - y;
  return String(x).localeCompare(String(y));
}

function eqv(a: unknown, b: unknown): boolean {
  if (a === null || a === undefined || b === null || b === undefined) return (a ?? null) === (b ?? null);
  if (typeof a === 'boolean' || typeof b === 'boolean') return String(a) === String(b);
  return cmp(a, b) === 0;
}

function likeRegex(pattern: string, flags: string): RegExp {
  const body = pattern.split(/[*%]/).map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp(`^${body}$`, flags);
}

function matchOp(value: unknown, op: string, operand: unknown): boolean {
  switch (op) {
    case 'eq': return eqv(value, operand);
    case 'neq': return !eqv(value, operand);
    case 'gt': return value != null && cmp(value, operand) > 0;
    case 'gte': return value != null && cmp(value, operand) >= 0;
    case 'lt': return value != null && cmp(value, operand) < 0;
    case 'lte': return value != null && cmp(value, operand) <= 0;
    case 'is': return operand === null || operand === 'null' ? value == null : String(value) === String(operand);
    case 'in': return (operand as unknown[]).some((o) => eqv(value, o));
    case 'like': return value != null && likeRegex(String(operand), '').test(String(value));
    case 'ilike': return value != null && likeRegex(String(operand), 'i').test(String(value));
    default: throw new Error(`operador não suportado no fake: ${op}`);
  }
}

function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(current);
      current = '';
    } else current += ch;
  }
  if (current) out.push(current);
  return out;
}

function listOperand(raw: string): string[] {
  return raw.replace(/^\(|\)$/g, '').split(',');
}

function parseTerm(term: string): Pred {
  const logic = /^(and|or)\((.*)\)$/.exec(term);
  if (logic) return parseLogic(logic[2], logic[1] as 'and' | 'or');
  const parts = term.split('.');
  const column = parts[0];
  let i = 1;
  const negate = parts[i] === 'not';
  if (negate) i++;
  const op = parts[i];
  const raw = parts.slice(i + 1).join('.');
  const operand = op === 'in' ? listOperand(raw) : raw;
  return (row) => matchOp(row[column], op, operand) !== negate;
}

function parseLogic(expr: string, mode: 'and' | 'or'): Pred {
  const preds = splitTop(expr).map(parseTerm);
  return mode === 'or' ? (row) => preds.some((p) => p(row)) : (row) => preds.every((p) => p(row));
}

interface LogEntry { table: string; op: string; payload: any; filters: string[] }
interface Failure { table: string; op?: string; error: any }

class FakeDb {
  tables: Record<string, Row[]>;
  log: LogEntry[] = [];
  failures: Failure[] = [];
  nextId = 5000;

  constructor(tables: Record<string, Row[]>) {
    this.tables = tables;
  }

  from(table: string): FakeQuery {
    if (!this.tables[table]) this.tables[table] = [];
    return new FakeQuery(this, table);
  }

  rows(table: string): Row[] {
    return this.tables[table] || [];
  }

  entries(table: string, op?: string): LogEntry[] {
    return this.log.filter((e) => e.table === table && (!op || e.op === op));
  }
}

class FakeQuery {
  db: FakeDb;
  table: string;
  op = 'select';
  payload: any = null;
  preds: Pred[] = [];
  filters: string[] = [];
  orders: Array<[string, boolean]> = [];
  rangeFrom = 0;
  rangeTo: number | null = null;
  lim: number | null = null;
  countMode = false;
  head = false;
  mode: '' | 'single' | 'maybe' = '';
  returning = false;
  conflictKey = 'id';

  constructor(db: FakeDb, table: string) {
    this.db = db;
    this.table = table;
  }

  select(_columns?: string, opts?: { count?: string; head?: boolean }) {
    if (this.op === 'select') {
      this.countMode = !!opts?.count;
      this.head = !!opts?.head;
    } else this.returning = true;
    return this;
  }
  insert(payload: any) { this.op = 'insert'; this.payload = payload; return this; }
  update(payload: any) { this.op = 'update'; this.payload = payload; return this; }
  upsert(payload: any, opts?: { onConflict?: string }) { this.op = 'upsert'; this.payload = payload; this.conflictKey = opts?.onConflict || 'id'; return this; }
  delete() { this.op = 'delete'; return this; }

  add(desc: string, pred: Pred) {
    this.filters.push(desc);
    this.preds.push(pred);
    return this;
  }
  eq(c: string, v: unknown) { return this.add(`${c}=eq.${v}`, (r) => matchOp(r[c], 'eq', v)); }
  neq(c: string, v: unknown) { return this.add(`${c}=neq.${v}`, (r) => matchOp(r[c], 'neq', v)); }
  gt(c: string, v: unknown) { return this.add(`${c}=gt.${v}`, (r) => matchOp(r[c], 'gt', v)); }
  gte(c: string, v: unknown) { return this.add(`${c}=gte.${v}`, (r) => matchOp(r[c], 'gte', v)); }
  lt(c: string, v: unknown) { return this.add(`${c}=lt.${v}`, (r) => matchOp(r[c], 'lt', v)); }
  lte(c: string, v: unknown) { return this.add(`${c}=lte.${v}`, (r) => matchOp(r[c], 'lte', v)); }
  is(c: string, v: unknown) { return this.add(`${c}=is.${v}`, (r) => matchOp(r[c], 'is', v)); }
  in(c: string, v: unknown[]) { return this.add(`${c}=in.(${v.join(',')})`, (r) => matchOp(r[c], 'in', v)); }
  like(c: string, v: string) { return this.add(`${c}=like.${v}`, (r) => matchOp(r[c], 'like', v)); }
  ilike(c: string, v: string) { return this.add(`${c}=ilike.${v}`, (r) => matchOp(r[c], 'ilike', v)); }
  not(c: string, op: string, v: unknown) {
    const operand = op === 'in' ? listOperand(String(v)) : v;
    return this.add(`${c}=not.${op}.${v}`, (r) => !matchOp(r[c], op, operand));
  }
  or(expr: string) { return this.add(`or=(${expr})`, parseLogic(expr, 'or')); }
  order(c: string, opts?: { ascending?: boolean }) { this.orders.push([c, opts?.ascending !== false]); return this; }
  range(from: number, to: number) { this.rangeFrom = from; this.rangeTo = to; return this; }
  limit(n: number) { this.lim = n; return this; }
  maybeSingle() { this.mode = 'maybe'; return this; }
  single() { this.mode = 'single'; return this; }

  then(resolve: (v: any) => any, reject?: (e: any) => any) {
    return Promise.resolve().then(() => this.execute()).then(resolve, reject);
  }

  matches(row: Row): boolean {
    return this.preds.every((p) => p(row));
  }

  execute(): { data: any; error: any; count: number | null } {
    this.db.log.push({ table: this.table, op: this.op, payload: this.payload, filters: [...this.filters] });
    const failure = this.db.failures.find((f) => f.table === this.table && (!f.op || f.op === this.op));
    if (failure) return { data: null, error: failure.error, count: null };
    const handlers: Record<string, () => { data: any; error: any; count: number | null }> = {
      select: () => this.runSelect(),
      update: () => this.runUpdate(),
      insert: () => this.runInsert(),
      upsert: () => this.runUpsert(),
      delete: () => this.runDelete(),
    };
    return handlers[this.op]();
  }

  sorted(rows: Row[]): Row[] {
    return [...rows].sort((a, b) => {
      for (const [column, asc] of this.orders) {
        const diff = cmp(a[column], b[column]);
        if (diff !== 0) return asc ? diff : -diff;
      }
      return 0;
    });
  }

  shape(rows: Row[]) {
    const copies = rows.map((r) => structuredClone(r));
    if (this.mode === 'maybe') {
      if (copies.length > 1) return { data: null, error: { code: 'PGRST116', message: 'mais de uma linha' }, count: null };
      return { data: copies[0] ?? null, error: null, count: null };
    }
    if (this.mode === 'single') {
      if (copies.length !== 1) return { data: null, error: { code: 'PGRST116', message: 'não é uma linha' }, count: null };
      return { data: copies[0], error: null, count: null };
    }
    return { data: copies, error: null, count: null };
  }

  runSelect() {
    const all = this.sorted(this.db.rows(this.table).filter((r) => this.matches(r)));
    const end = this.rangeTo === null ? undefined : this.rangeTo + 1;
    let page = all.slice(this.rangeFrom, end);
    if (this.lim !== null) page = page.slice(0, this.lim);
    if (this.head) return { data: null, error: null, count: all.length };
    const out = this.shape(page);
    return { ...out, count: this.countMode ? all.length : null };
  }

  runUpdate() {
    const matched = this.db.rows(this.table).filter((r) => this.matches(r));
    for (const row of matched) Object.assign(row, structuredClone(this.payload));
    return this.returning ? this.shape(matched) : { data: null, error: null, count: null };
  }

  runInsert() {
    const list = Array.isArray(this.payload) ? this.payload : [this.payload];
    const inserted: Row[] = [];
    for (const item of list) {
      const row: Row = { id: this.db.nextId++, created_at: NOW.toISOString(), revoked_at: null, ...structuredClone(item) };
      const clash = this.table === 'followup_optouts' && this.db.rows(this.table)
        .some((r) => r.user_id === row.user_id && r.phone_key === row.phone_key && r.revoked_at == null);
      if (clash) return { data: null, error: { code: '23505', message: 'duplicate key' }, count: null };
      this.db.tables[this.table].push(row);
      inserted.push(row);
    }
    return this.returning ? this.shape(inserted) : { data: null, error: null, count: null };
  }

  runUpsert() {
    const existing = this.db.rows(this.table).find((r) => r[this.conflictKey] === this.payload[this.conflictKey]);
    if (existing) Object.assign(existing, structuredClone(this.payload));
    else this.db.tables[this.table].push(structuredClone(this.payload));
    return { data: null, error: null, count: null };
  }

  runDelete() {
    const keep = this.db.rows(this.table).filter((r) => !this.matches(r));
    this.db.tables[this.table] = keep;
    return { data: null, error: null, count: null };
  }
}

// ─── Fixtures (telefones fictícios) ───

const NOW = new Date('2026-09-16T15:00:00.000Z'); // quarta, 12h em São Paulo
const OWNER = '00000000-0000-4000-8000-000000000001';
const MEMBER = '00000000-0000-4000-8000-000000000002';
const ADMIN = '00000000-0000-4000-8000-000000000003';
const OTHER_TENANT = '00000000-0000-4000-8000-000000000009';
const PHONE_A = '5543999990001';
const PHONE_B = '5543999990002';
const PHONE_C = '5543999990003';
const MAIN_WA = '5543999998888';

const ROLES: Record<string, FollowUpRouteCtx> = {
  owner: { userId: OWNER, realUserId: OWNER, isMember: false, isPlatformAdmin: false, isImpersonating: false, memberPermissions: null },
  member: { userId: OWNER, realUserId: MEMBER, isMember: true, isPlatformAdmin: false, isImpersonating: false, memberPermissions: { vendas: true } },
  approver: { userId: OWNER, realUserId: MEMBER, isMember: true, isPlatformAdmin: false, isImpersonating: false, memberPermissions: { vendas: true, vendas_followups: true } },
  support: { userId: OWNER, realUserId: ADMIN, isMember: false, isPlatformAdmin: true, isImpersonating: true, memberPermissions: null },
};

let seq = 100;

function task(over: Row = {}): Row {
  const phone = over.phone ?? PHONE_A;
  return {
    id: over.id ?? ++seq, user_id: OWNER, kind: 'cadence', track: 'ladder', deal_id: 11, phone, phone_key: canonicalPhoneKey(phone),
    wa_number: MAIN_WA, message: 'Oi Ana, conseguiu ver o orçamento?', draft_text: 'Oi Ana, conseguiu ver o orçamento?',
    stage_id: 'proposal', step: 1, status: 'draft', basis_at: '2026-09-14T15:00:00.000Z', basis_message_id: 'wamid.studio',
    scheduled_at: '2026-09-15T15:00:00.000Z', created_at: '2026-09-16T10:00:00.000Z', updated_at: '2026-09-16T10:00:00.000Z',
    sent_at: null, approved_at: null, approved_by: null, claimed_at: null, claimed_by: null, lease_expires_at: null,
    channel_used: null, sent_message_id: null, last_error: null, contact_name: 'Ana', attempts: 0,
    generation_meta: {
      outcome: 'draft', warnings: [], regenerations: 0, model: 'gpt-test',
      anchor: { last_studio_at: '2026-09-14T15:00:00.000Z', last_customer_at: '2026-09-14T14:00:00.000Z', last_invisible_out_at: null },
      context_tail: [
        { from_me: false, body: 'Quanto fica o ensaio?', type: 'text', timestamp: '2026-09-14T14:00:00.000Z' },
        { from_me: true, body: 'Te mandei o orçamento.', type: 'text', timestamp: '2026-09-14T15:00:00.000Z' },
      ],
    },
    ...over,
  };
}

function configRow(over: Row = {}): Row {
  return {
    user_id: OWNER, enabled: true, mode: 'approval', ladder_stage_ids: ['proposal', 'negotiation'], step_delays_hours: [24, 48],
    after_last_stage_id: 'followup-3', business_hours: DEFAULT_BUSINESS_HOURS, daily_cap: 40, min_gap_seconds: 60, max_gap_seconds: 150,
    max_consecutive_errors: 3, allow_meta_text: true, allow_baileys: false, template_id: null, max_silence_hours: 720,
    sweep_interval_minutes: 60, max_drafts_per_sweep: 20, extra_instructions: '', optout_detection: true, tracker_enabled: false,
    tracker_config: {}, wa_number: null, next_send_after: null, consecutive_errors: 2, paused_at: null, paused_reason: null,
    last_error: null, last_block_code: null, last_block_message: null, last_block_at: null, last_sweep_at: null,
    last_sweep_summary: null, first_enabled_at: '2026-08-01T12:00:00.000Z', external_ai_consent_at: '2026-09-10T12:00:00.000Z',
    external_ai_consent_by: OWNER, created_at: '2026-09-01T12:00:00.000Z', updated_at: '2026-09-01T12:00:00.000Z', updated_by: OWNER,
    ...over,
  };
}

function stages(): Row[] {
  const base = { user_id: OWNER, is_final: false, is_won: false, process_id: null, auto_follow_up_enabled: false };
  return [
    { ...base, id: 'lead', name: 'Entrou em contato', position: 0 },
    { ...base, id: 'contact', name: 'Conversa iniciada', position: 1 },
    { ...base, id: 'proposal', name: 'Orçamento enviado', position: 2 },
    { ...base, id: 'negotiation', name: 'Negociação', position: 3, auto_follow_up_enabled: true },
    { ...base, id: 'followup-3', name: '03 Follow Up', position: 4, auto_follow_up_enabled: true },
    { ...base, id: 'won', name: 'Ganho', position: 9, is_final: true, is_won: true },
    { ...base, id: 'lost', name: 'Perdido', position: 10, is_final: true },
    { ...base, id: 'prod-edicao', name: 'Edição', position: 20, auto_follow_up_enabled: true },
  ];
}

function deals(): Row[] {
  const base = { user_id: OWNER, temperature: 'warm', assigned_to: null, converted: false, converted_job_id: null };
  return [
    { ...base, id: 11, title: 'Ensaio Ana', contact_name: 'Ana', contact_phone: PHONE_A, stage: 'proposal' },
    { ...base, id: 12, title: 'Ensaio Bia', contact_name: 'Bia', contact_phone: PHONE_B, stage: 'proposal' },
    { ...base, id: 13, title: 'Ensaio Cris', contact_name: 'Cris', contact_phone: PHONE_C, stage: 'negotiation' },
    { ...base, id: 91, user_id: OTHER_TENANT, title: 'Outra conta', contact_name: 'Zé', contact_phone: PHONE_A, stage: 'proposal' },
  ];
}

function makeDb(over: Record<string, Row[]> = {}): FakeDb {
  return new FakeDb({
    followup_cadence_config: [configRow()],
    deal_stages: stages(),
    deals: deals(),
    scheduled_followups: [],
    wa_messages: [],
    followup_optouts: [],
    team_members: [{ owner_user_id: OWNER, member_user_id: MEMBER, name: 'Bia da equipe' }],
    ...over,
  });
}

function okHealth(): ChannelHealth {
  return {
    baileys: { status: 'not_initialized', phone: null, allowed: false, dedupe_ready: false },
    meta: { configured: true, operational: true, token_expires_at: null, token_state: 'no_expiry', days_left: null, quality_rating: 'GREEN' },
    template: { configured: false, approved: false, eligible: false, name: null, reason: null },
    preferred_channel: 'meta', can_send: { inside_24h: true, outside_24h: false }, level: 'degraded', notes: [],
  };
}

const IDLE_SWEEP: SweepState = { running: false, started_at: null, finished_at: null, progress: null, last_summary: null, next_auto_at: null };

function textForecast(items: ForecastInput[]): ForecastResult[] {
  return items.map((i) => ({ id: i.id, channel: 'meta_text', approval: { channel_class: 'text', render: null, template_id: null } }));
}

function fakeServices(over: Partial<FollowUpServices> = {}) {
  const calls: Record<string, any[][]> = {};
  const record = (name: string, args: any[]) => { (calls[name] ||= []).push(args); };
  const services: FollowUpServices = {
    runSweep: async (...args) => { record('runSweep', args); return { eligible: 0, generated: 0, auto_approved: 0, ai_skipped: 0, handoffs: 0, already_drafted: 0, optouts_detected: 0, housekept: 0, errors: 0, finished_at: NOW.toISOString() }; },
    countEligible: async (...args) => { record('countEligible', args); return { eligible_total: 30, by_step: { 1: 30, 2: 0, 3: 0, 4: 0 }, skipped_by_reason: {}, sample: [] }; },
    regenerate: async (...args) => { record('regenerate', args); return { status: 'updated' }; },
    kickSender: (...args) => { record('kickSender', args); },
    channelHealth: async () => okHealth(),
    forecast: async (...args) => { record('forecast', args); return textForecast(args[2]); },
    listTemplates: async () => [],
    dedupeReady: async () => false,
    businessWindow: () => ({ open: true, next_open_at: null }),
    sweepState: () => IDLE_SWEEP,
    invalidateConfig: (...args) => { record('invalidateConfig', args); },
    recordDeliveryFailure: async () => {},
    reconcilePreview: async (...args) => { record('reconcilePreview', args); return { generated_at: NOW.toISOString(), scanned: 0, to_contact: [], to_proposal: [], to_create: [] }; },
    reconcileApply: async (...args) => { record('reconcileApply', args); return { moved: 0, noop: 0, conflicts: 0, refused: 0, created: 0, skipped_marketing: 0 }; },
    ...over,
  };
  return { services, calls };
}

// Proxy que explode se alguma rota tocar em req.supabase (RLS sem policy leria vazio).
const FORBIDDEN_SUPABASE = new Proxy({}, { get() { throw new Error('req.supabase não pode ser usado nas rotas de follow-up'); } });

async function startApp(t: { after: (fn: () => Promise<void> | void) => void }, db: FakeDb, services: FollowUpServices, clock: { now: Date } = { now: NOW }) {
  const app = express();
  app.use(express.json());
  const requireAuth = (req: any, _res: any, next: any) => {
    Object.assign(req, ROLES[String(req.headers['x-role'] || 'owner')], { supabase: FORBIDDEN_SUPABASE });
    next();
  };
  const requirePermission = (module: string) => (req: any, res: any, next: any) => {
    if (!req.isMember || req.isPlatformAdmin) return next();
    if ((req.memberPermissions || {})[module] === false) return res.status(403).json({ error: 'sem permissão' });
    next();
  };
  const requireOwnerOrPlatformAdmin = (req: any, res: any, next: any) =>
    (!req.isMember || req.isPlatformAdmin ? next() : res.status(403).json({ error: 'Essa ação é restrita ao dono da conta.', owner_only: true }));
  const denyProductionOnly = (_req: any, _res: any, next: any) => next();
  registerFollowUpRoutes(app, {
    db: db as any, requireAuth, requirePermission, requireOwnerOrPlatformAdmin, denyProductionOnly, services, now: () => clock.now,
  });
  const server: Server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return async (method: string, path: string, body?: unknown, role = 'owner') => {
    const res = await fetch(base + path, {
      method, headers: { 'content-type': 'application/json', 'x-role': role }, body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
}

function findTask(db: FakeDb, id: number): Row {
  return db.rows('scheduled_followups').find((r) => r.id === id) as Row;
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

const tick = () => new Promise((r) => setTimeout(r, 20));

// ─── Funções puras ───

test('canApproveFollowUps e requireFollowUpApprover: concessão explícita para membro', () => {
  assert.equal(canApproveFollowUps(ROLES.owner), true);
  assert.equal(canApproveFollowUps(ROLES.member), false);
  assert.equal(canApproveFollowUps({ ...ROLES.member, memberPermissions: { vendas_followups: 'true' } }), false);
  assert.equal(canApproveFollowUps(ROLES.approver), true);
  assert.equal(canApproveFollowUps({ ...ROLES.member, isPlatformAdmin: true }), true);
  assert.equal(canApproveFollowUps(ROLES.support), true);

  const run = (ctx: FollowUpRouteCtx) => {
    const out: { status?: number; body?: any; next: boolean } = { next: false };
    const res: any = { status(code: number) { out.status = code; return res; }, json(body: any) { out.body = body; return res; } };
    requireFollowUpApprover(ctx as any, res, () => { out.next = true; });
    return out;
  };
  assert.equal(run(ROLES.owner).next, true);
  assert.equal(run(ROLES.approver).next, true);
  const denied = run(ROLES.member);
  assert.equal(denied.next, false);
  assert.equal(denied.status, 403);
  assert.deepEqual(denied.body, { error: 'Peça ao dono da conta para liberar a aprovação de follow-ups.', code: 'FORBIDDEN' });
});

test('parseQueueQuery aplica padrões e limites', () => {
  assert.deepEqual(parseQueueQuery({}), {
    status: 'draft', step: null, track: null, stage_id: null, deal_id: null, search: '', offset: 0, limit: 20, preview: 6,
  });
  assert.equal(parseQueueQuery({ track: 'pre_quote' }).track, 'pre_quote');
  assert.equal(parseQueueQuery({ track: 'outra' }).track, null);
  const q = parseQueueQuery({ status: 'blocked', step: '2', stage_id: ' proposal ', deal_id: '12', search: ` ${'a'.repeat(100)} `, offset: '-5', limit: '500', preview: '20' });
  assert.equal(q.status, 'blocked');
  assert.equal(q.step, 2);
  assert.equal(q.stage_id, 'proposal');
  assert.equal(q.deal_id, 12);
  assert.equal(q.search.length, 80);
  assert.equal(q.offset, 0);
  assert.equal(q.limit, 50);
  assert.equal(q.preview, 8);
  const odd = parseQueueQuery({ status: 'hacker', step: '5', deal_id: 'abc', limit: '0', preview: '0' });
  assert.equal(odd.status, 'draft');
  assert.equal(odd.step, null);
  assert.equal(odd.deal_id, null);
  assert.equal(odd.limit, 1);
  assert.equal(odd.preview, 0);
});

test('parseDraftText recusa vazio, longo e ###', () => {
  assert.equal(parseDraftText('  Oi!  '), 'Oi!');
  for (const bad of ['', '   ', null, 42, 'a'.repeat(1001), 'antes ### depois']) {
    assert.throws(() => parseDraftText(bad), (e: any) => e instanceof FollowUpRouteError && e.code === 'TEXT_INVALID' && e.status === 400);
  }
});

test('approvedByLabel distingue IA, suporte, quem vê, dono e equipe', () => {
  const labels: ApproverLabels = { ownerId: OWNER, viewerId: MEMBER, members: new Map([[ADMIN, 'Carla']]) };
  assert.equal(approvedByLabel({ approved_by: null, generation_meta: {} }, labels), null);
  assert.equal(approvedByLabel({ approved_by: 'auto', generation_meta: {} }, labels), 'IA (modo automático)');
  assert.equal(approvedByLabel({ approved_by: ADMIN, generation_meta: { impersonated: true } }, labels), 'Suporte');
  assert.equal(approvedByLabel({ approved_by: MEMBER, generation_meta: {} }, labels), 'Você');
  assert.equal(approvedByLabel({ approved_by: OWNER, generation_meta: {} }, labels), 'Dono da conta');
  assert.equal(approvedByLabel({ approved_by: ADMIN, generation_meta: {} }, labels), 'Carla');
  assert.equal(approvedByLabel({ approved_by: 'x-desconhecido', generation_meta: {} }, labels), 'Alguém da equipe');
  const ownerView: ApproverLabels = { ownerId: OWNER, viewerId: OWNER, members: new Map() };
  assert.equal(approvedByLabel({ approved_by: OWNER, generation_meta: {} }, ownerView), 'Você');
});

test('toDraftItem monta a prévia do template, o silêncio e o recorte da conversa', () => {
  const row = task({
    id: 7, status: 'approved', approved_by: 'auto', approved_at: '2026-09-16T11:00:00.000Z',
    generation_meta: { ...task().generation_meta, approved_via: 'auto', approval: { channel_class: 'template', render: 'Oi, Ana! Passando aqui.', template_id: 5 }, warnings: ['data'] },
  });
  const dealMap = new Map<number, DealLite>([[11, { id: 11, title: 'Ensaio Ana', contact_name: 'Ana', contact_phone: PHONE_A, stage: 'proposal', temperature: 'hot', assigned_to: null }]]);
  const stageMap = new Map([['proposal', { name: 'Orçamento enviado' }]]);
  const labels: ApproverLabels = { ownerId: OWNER, viewerId: OWNER, members: new Map() };
  const forecast = new Map<number, ForecastResult>([[7, { id: 7, channel: 'meta_template', approval: { channel_class: 'template', render: 'Oi, Ana! Fiquei pensando no seu ensaio.', template_id: 5 } }]]);
  const item = toDraftItem(row, dealMap, stageMap, labels, new Set([7]), forecast, { now: NOW, preview: 1 });
  assert.equal(item.channel_forecast, 'meta_template');
  assert.equal(item.template_preview, 'Oi, Ana! Fiquei pensando no seu ensaio.');
  assert.equal(item.approval_class, 'template');
  assert.equal(item.approved_by_label, 'IA (modo automático)');
  assert.equal(item.approved_via, 'auto');
  assert.equal(item.conversation_changed, true);
  assert.equal(item.deal.stage_name, 'Orçamento enviado');
  assert.equal(item.deal.temperature, 'hot');
  assert.equal(item.silence.hours, 48);
  assert.equal(item.silence.inside_24h, false);
  assert.deepEqual(item.preview.map((p) => p.body), ['Te mandei o orçamento.']);
  assert.deepEqual(item.ai.warnings, ['data']);
  assert.equal(item.text, row.message);
  assert.equal(item.original_text, row.draft_text);

  const plain = toDraftItem(task({ id: 8, deal_id: 999 }), new Map(), new Map(), labels, new Set(), new Map(), { now: NOW, preview: 0 });
  assert.equal(plain.template_preview, null);
  assert.equal(plain.channel_forecast, 'blocked');
  assert.deepEqual(plain.preview, []);
  assert.equal(plain.deal.title, 'Ana');
  assert.equal(plain.deal.stage_id, 'proposal');
  assert.equal(plain.conversation_changed, false);
});

test('isMigrationMissing e sendRouteError mapeiam os erros para o corpo padrão', () => {
  for (const code of ['42P01', '42703', '42883', 'PGRST202', 'PGRST204', 'PGRST205']) assert.equal(isMigrationMissing({ code }), true);
  assert.equal(isMigrationMissing(Object.assign(new Error('x'), { name: 'CadenceMigrationMissing' })), true);
  assert.equal(isMigrationMissing({ code: '23505' }), false);
  assert.equal(isMigrationMissing(null), false);

  const capture = (err: unknown) => {
    const out: { status?: number; body?: any } = {};
    const res: any = { status(code: number) { out.status = code; return res; }, json(body: any) { out.body = body; return res; } };
    sendRouteError(res, err);
    return out;
  };
  assert.deepEqual(capture(new Error('AI_CONSENT_REQUIRED')), {
    status: 409, body: { error: 'O dono da conta precisa autorizar o envio das conversas para a IA (OpenAI) antes de gerar rascunhos.', code: 'AI_CONSENT_REQUIRED' },
  });
  assert.equal(capture(new Error('SWEEP_RUNNING')).body.code, 'SWEEP_RUNNING');
  assert.equal(capture(new Error('REGEN_RUNNING')).status, 409);
  assert.deepEqual(capture({ code: '42P01', message: 'relation does not exist' }).body, { error: 'Falta aplicar a migration 083 no Supabase.', code: 'MIGRATION_REQUIRED' });
  assert.equal(capture({ code: '42P01' }).status, 503);
  const internal = capture(new Error('boom'));
  assert.equal(internal.status, 500);
  assert.equal(internal.body.code, 'INTERNAL');
  const withFields = capture(new FollowUpRouteError('Confira', 400, 'CONFIG_INVALID', { daily_cap: 'ruim' }));
  assert.deepEqual(withFields.body, { error: 'Confira', code: 'CONFIG_INVALID', fields: { daily_cap: 'ruim' } });
});

// ─── Overview ───

test('GET /overview com a 083 ausente responde 200 migration_required', async (t) => {
  const db = makeDb();
  db.failures.push({ table: 'followup_cadence_config', error: { code: '42P01', message: 'relation does not exist' } });
  const call = await startApp(t, db, fakeServices().services);
  const res = await call('GET', '/api/followups/overview');
  assert.equal(res.status, 200);
  assert.equal(res.body.migration_required, true);
  assert.equal(res.body.enabled, false);
  assert.equal(res.body.can_edit_config, true);
  assert.equal(res.body.counts.draft, 0);
});

test('GET /overview conta a fila, aplica a rampa e calcula permissões de quem vê', async (t) => {
  const db = makeDb({
    followup_cadence_config: [configRow({ first_enabled_at: '2026-09-10T12:00:00.000Z', paused_at: '2026-09-16T12:00:00.000Z', paused_reason: 'error_streak', last_error: 'erro x' })],
    scheduled_followups: [
      task({ id: 1, status: 'draft', step: 1 }), task({ id: 2, status: 'draft', step: 2 }), task({ id: 3, status: 'approved' }),
      task({ id: 4, status: 'blocked' }), task({ id: 5, status: 'sent', sent_at: '2026-09-16T13:00:00.000Z' }),
      task({ id: 6, status: 'sent', sent_at: '2026-09-15T13:00:00.000Z' }), task({ id: 7, status: 'failed', updated_at: '2026-09-15T13:00:00.000Z' }),
      task({ id: 8, status: 'failed', updated_at: '2026-09-01T13:00:00.000Z' }), task({ id: 9, status: 'skipped', updated_at: '2026-09-15T13:00:00.000Z' }),
      task({ id: 10, status: 'draft', user_id: OTHER_TENANT }), task({ id: 11, status: 'sent', kind: 'legacy', sent_at: '2026-09-16T13:00:00.000Z' }),
    ],
    followup_optouts: [{ id: 1, user_id: OWNER, phone_key: '554399990009', revoked_at: null }, { id: 2, user_id: OWNER, phone_key: '554399990008', revoked_at: '2026-09-01T00:00:00Z' }],
  });
  const call = await startApp(t, db, fakeServices().services);
  const owner = await call('GET', '/api/followups/overview');
  assert.equal(owner.status, 200);
  const o = owner.body;
  assert.equal(o.configured, true);
  assert.deepEqual(o.counts, {
    draft: 2, draft_by_step: { 1: 1, 2: 1, 3: 0, 4: 0 }, draft_by_track: { ladder: 2, pre_quote: 0 }, approved: 1, sending: 0, blocked: 1, failed_7d: 1,
    sent_today: 1, skipped_7d: 1, cancelled_7d: 0, optouts: 1,
  });
  assert.equal(o.sending.effective_cap, 10);
  assert.equal(o.sending.daily_cap, 40);
  assert.equal(o.sending.remaining, 9);
  assert.equal(o.sending.warmup_until, '2026-09-24T12:00:00.000Z');
  assert.equal(o.sending.paused_reason, 'error_streak');
  assert.equal(o.sending.paused, true);
  assert.equal(o.sending.last_error, 'erro x');
  assert.deepEqual(o.consent, { external_ai: true, at: '2026-09-10T12:00:00.000Z' });
  assert.deepEqual(o.legacy_automation.map((s: any) => s.stage_id), ['negotiation', 'followup-3']);
  assert.equal(o.can_edit_config, true);
  assert.equal(o.can_approve, true);

  const member = await call('GET', '/api/followups/overview', undefined, 'member');
  assert.equal(member.body.can_edit_config, false);
  assert.equal(member.body.can_approve, false);
  assert.equal(member.body.counts.draft, 2);
});

test('GET /overview: motivo de pausa segue a ordem disabled, pausa, teto, horário e canal', async (t) => {
  const db = makeDb({ followup_cadence_config: [configRow({ enabled: false })] });
  const { services } = fakeServices({ businessWindow: () => ({ open: false, next_open_at: '2026-09-17T12:00:00.000Z' }) });
  const call = await startApp(t, db, services);
  assert.equal((await call('GET', '/api/followups/overview')).body.sending.paused_reason, 'disabled');

  const db2 = makeDb();
  const call2 = await startApp(t, db2, services);
  const res = await call2('GET', '/api/followups/overview');
  assert.equal(res.body.sending.paused_reason, 'outside_hours');
  assert.equal(res.body.sending.next_window_at, '2026-09-17T12:00:00.000Z');

  const down = fakeServices({ channelHealth: async () => { throw new Error('graph fora'); } });
  const call3 = await startApp(t, makeDb(), down.services);
  const res3 = await call3('GET', '/api/followups/overview');
  assert.equal(res3.status, 200);
  assert.equal(res3.body.channels.level, 'down');
  assert.equal(res3.body.sending.paused_reason, 'no_channel');
});

// ─── Aprovação ───

test('POST /:id/approve: rascunho vira aprovado com a approval do forecast', async (t) => {
  const db = makeDb({ scheduled_followups: [task({ id: 21 })] });
  const { services, calls } = fakeServices();
  const call = await startApp(t, db, services);
  const res = await call('POST', '/api/followups/21/approve', {});
  assert.equal(res.status, 200);
  assert.equal(res.body.item.status, 'approved');
  assert.equal(res.body.warning, undefined);
  const row = findTask(db, 21);
  assert.equal(row.status, 'approved');
  assert.equal(row.approved_by, OWNER);
  assert.equal(row.approved_at, NOW.toISOString());
  assert.equal(row.generation_meta.approved_via, 'manual');
  assert.equal(row.generation_meta.impersonated, false);
  assert.deepEqual(row.generation_meta.approval, { channel_class: 'text', render: null, template_id: null });
  assert.deepEqual(calls.kickSender, [[OWNER]]);
  const forecastInput = calls.forecast[0][2][0];
  assert.equal(forecastInput.text, 'Oi Ana, conseguiu ver o orçamento?');
  assert.equal(forecastInput.last_customer_at, '2026-09-14T14:00:00.000Z');
});

test('POST /:id/approve com texto edita, grava quem editou e avisa do template', async (t) => {
  const db = makeDb({ scheduled_followups: [task({ id: 22, status: 'blocked', last_error: 'Sem canal' })] });
  const { services } = fakeServices({
    forecast: async (_u, _c, items) => items.map((i) => ({ id: i.id, channel: 'meta_template', approval: { channel_class: 'template', render: `Oi, Ana! ${i.text}`, template_id: 9 } })),
  });
  const call = await startApp(t, db, services);
  const res = await call('POST', '/api/followups/22/approve', { text: '  Oi Ana! Ficou alguma dúvida?  ' }, 'approver');
  assert.equal(res.status, 200);
  assert.equal(res.body.warning, 'Vai sair como template aprovado. Confira o texto final no card.');
  const row = findTask(db, 22);
  assert.equal(row.message, 'Oi Ana! Ficou alguma dúvida?');
  assert.equal(row.approved_by, MEMBER);
  assert.equal(row.last_error, null);
  assert.equal(row.generation_meta.edited_by, MEMBER);
  assert.equal(row.generation_meta.approval.render, 'Oi, Ana! Oi Ana! Ficou alguma dúvida?');
  assert.equal(res.body.item.approved_by_label, 'Você');
});

test('POST /:id/approve avisa quando nenhum canal está disponível', async (t) => {
  const db = makeDb({ scheduled_followups: [task({ id: 23 })] });
  const { services } = fakeServices({
    forecast: async (_u, _c, items) => items.map((i) => ({ id: i.id, channel: 'blocked', approval: { channel_class: 'text', render: null, template_id: null } })),
  });
  const call = await startApp(t, db, services);
  const res = await call('POST', '/api/followups/23/approve', {});
  assert.equal(res.status, 200);
  assert.equal(res.body.warning, 'Aprovado, mas nenhum canal está disponível agora. Se sair como template, volta para revisão.');
});

test('POST /:id/approve recusa enviado, etapa mudada, opt-out, conversa nova e cadência desligada', async (t) => {
  const db = makeDb({
    scheduled_followups: [
      task({ id: 31, status: 'sent', sent_at: '2026-09-16T12:00:00.000Z' }),
      task({ id: 32, deal_id: 13, phone: PHONE_C, stage_id: 'proposal' }),
      task({ id: 33, deal_id: 12, phone: PHONE_B }),
      task({ id: 34 }),
    ],
    followup_optouts: [{ id: 1, user_id: OWNER, phone_key: canonicalPhoneKey(PHONE_B), revoked_at: null }],
    wa_messages: [
      { user_id: OWNER, phone: '554399990001', wa_number: '5543000000000', from_me: false, type: 'text', timestamp: '2026-09-15T10:00:00.000Z' },
    ],
  });
  const { services, calls } = fakeServices();
  const call = await startApp(t, db, services);
  const sent = await call('POST', '/api/followups/31/approve', {});
  assert.equal(sent.status, 409);
  assert.equal(sent.body.code, 'INVALID_STATUS');
  const stage = await call('POST', '/api/followups/32/approve', {});
  assert.equal(stage.status, 409);
  assert.deepEqual(stage.body, { error: 'O card mudou de etapa. Gere de novo.', code: 'STAGE_CHANGED' });
  const optout = await call('POST', '/api/followups/33/approve', {});
  assert.equal(optout.status, 409);
  assert.equal(optout.body.code, 'OPTED_OUT');
  // Resposta do cliente em OUTRO número da conta também conta.
  const changed = await call('POST', '/api/followups/34/approve', {});
  assert.equal(changed.status, 409);
  assert.equal(changed.body.code, 'CONVERSATION_CHANGED');
  assert.equal(calls.kickSender, undefined);
  assert.equal(findTask(db, 34).status, 'draft');

  const off = makeDb({ followup_cadence_config: [configRow({ enabled: false })], scheduled_followups: [task({ id: 35 })] });
  const callOff = await startApp(t, off, services);
  const disabled = await callOff('POST', '/api/followups/35/approve', {});
  assert.equal(disabled.status, 409);
  assert.equal(disabled.body.code, 'FOLLOWUPS_DISABLED');
});

test('POST /:id/approve exige a concessão explícita e isola a conta', async (t) => {
  const db = makeDb({ scheduled_followups: [task({ id: 41 }), task({ id: 42, user_id: OTHER_TENANT })] });
  const call = await startApp(t, db, fakeServices().services);
  const member = await call('POST', '/api/followups/41/approve', {}, 'member');
  assert.equal(member.status, 403);
  assert.equal(member.body.code, 'FORBIDDEN');
  assert.equal(findTask(db, 41).status, 'draft');
  const foreign = await call('POST', '/api/followups/42/approve', {});
  assert.equal(foreign.status, 404);
  assert.equal(findTask(db, 42).status, 'draft');
  const approver = await call('POST', '/api/followups/41/approve', {}, 'approver');
  assert.equal(approver.status, 200);
});

test('POST /:id/approve em modo suporte marca impersonated e o rótulo Suporte', async (t) => {
  const db = makeDb({ scheduled_followups: [task({ id: 43 })] });
  const call = await startApp(t, db, fakeServices().services);
  const res = await call('POST', '/api/followups/43/approve', {}, 'support');
  assert.equal(res.status, 200);
  assert.equal(findTask(db, 43).approved_by, ADMIN);
  assert.equal(findTask(db, 43).generation_meta.impersonated, true);
  assert.equal(res.body.item.approved_by_label, 'Suporte');
});

test('POST /approve-all exige cadência ligada, respeita generated_before, exclusões e o teto de 200', async (t) => {
  const off = makeDb({ followup_cadence_config: [configRow({ enabled: false })], scheduled_followups: [task({ id: 50 })] });
  const callOff = await startApp(t, off, fakeServices().services);
  const disabled = await callOff('POST', '/api/followups/approve-all', { generated_before: NOW.toISOString() });
  assert.equal(disabled.status, 409);
  assert.equal(disabled.body.code, 'FOLLOWUPS_DISABLED');

  const rows: Row[] = [];
  for (let i = 0; i < 205; i++) rows.push(task({ id: 1000 + i, scheduled_at: new Date(Date.parse('2026-09-15T00:00:00Z') + i * 60_000).toISOString() }));
  rows.push(task({ id: 60, created_at: '2026-09-16T14:59:00.000Z', updated_at: '2026-09-16T14:59:00.000Z', scheduled_at: '2026-09-01T00:00:00Z' }));
  const db = makeDb({ scheduled_followups: rows });
  const { services, calls } = fakeServices();
  const call = await startApp(t, db, services);
  const missing = await call('POST', '/api/followups/approve-all', {});
  assert.equal(missing.status, 400);
  assert.ok(missing.body.fields.generated_before);
  const res = await call('POST', '/api/followups/approve-all', { generated_before: '2026-09-16T12:00:00.000Z' });
  assert.equal(res.status, 200);
  assert.equal(res.body.approved, 200);
  assert.equal(res.body.effective_cap, 40);
  assert.equal(res.body.estimated_business_days, 5);
  assert.equal(findTask(db, 60).status, 'draft');
  assert.equal(findTask(db, 1204).status, 'draft');
  assert.equal(findTask(db, 1000).generation_meta.approved_via, 'bulk');
  assert.deepEqual(findTask(db, 1000).generation_meta.approval, { channel_class: 'text', render: null, template_id: null });
  assert.equal(calls.forecast.length, 1);
  assert.deepEqual(calls.kickSender, [[OWNER]]);

  const member = await call('POST', '/api/followups/approve-all', { generated_before: NOW.toISOString() }, 'member');
  assert.equal(member.status, 403);
});

test('POST /approve-all conta as exclusões por etapa, opt-out e conversa nova', async (t) => {
  const db = makeDb({
    scheduled_followups: [
      task({ id: 71 }),
      task({ id: 72, deal_id: 13, phone: PHONE_C, stage_id: 'proposal' }),
      task({ id: 73, deal_id: 12, phone: PHONE_B }),
      task({ id: 74, deal_id: 12, phone: PHONE_B, status: 'blocked' }),
    ],
    followup_optouts: [{ id: 1, user_id: OWNER, phone_key: canonicalPhoneKey(PHONE_B), revoked_at: null }],
  });
  const call = await startApp(t, db, fakeServices().services);
  const res = await call('POST', '/api/followups/approve-all', { generated_before: NOW.toISOString(), include_blocked: true, exclude_ids: [999] });
  assert.equal(res.status, 200);
  assert.equal(res.body.approved, 1);
  assert.deepEqual(res.body.excluded, { conversation_changed: 0, opted_out: 2, stage_changed: 1 });
  assert.equal(findTask(db, 71).status, 'approved');

  db.rows('scheduled_followups').push(task({ id: 75 }));
  db.rows('wa_messages').push({ user_id: OWNER, phone: PHONE_A, wa_number: MAIN_WA, from_me: false, type: 'text', timestamp: '2026-09-16T11:00:00.000Z' });
  const again = await call('POST', '/api/followups/approve-all', { generated_before: NOW.toISOString(), ids: [75] });
  assert.equal(again.body.approved, 0);
  assert.equal(again.body.excluded.conversation_changed, 1);
});

// ─── Edição, pulo e gerar de novo ───

test('PATCH /:id devolve um aprovado para rascunho e recusa lease viva', async (t) => {
  const db = makeDb({
    scheduled_followups: [
      task({ id: 81, status: 'approved', approved_at: '2026-09-16T11:00:00.000Z', approved_by: OWNER,
        generation_meta: { ...task().generation_meta, approved_via: 'manual', approval: { channel_class: 'text', render: null, template_id: null } } }),
      task({ id: 82, status: 'approved', approved_at: '2026-09-16T11:00:00.000Z', approved_by: OWNER, claimed_at: '2026-09-16T14:59:00.000Z', lease_expires_at: '2026-09-16T15:05:00.000Z' }),
      task({ id: 83, status: 'sending', claimed_at: '2026-09-16T14:59:00.000Z', lease_expires_at: '2026-09-16T15:05:00.000Z' }),
    ],
  });
  const call = await startApp(t, db, fakeServices().services, { now: NOW });
  const res = await call('PATCH', '/api/followups/81', { text: 'Oi Ana! Novo texto.' }, 'member');
  assert.equal(res.status, 200);
  const row = findTask(db, 81);
  assert.equal(row.status, 'draft');
  assert.equal(row.approved_at, null);
  assert.equal(row.approved_by, null);
  assert.equal(row.message, 'Oi Ana! Novo texto.');
  assert.equal(row.draft_text, 'Oi Ana, conseguiu ver o orçamento?');
  assert.equal(row.generation_meta.edited_by, MEMBER);
  assert.equal(row.generation_meta.approval, undefined);
  assert.equal(row.generation_meta.approved_via, undefined);
  assert.equal(row.generation_meta.context_tail.length, 2);
  assert.equal(res.body.item.text, 'Oi Ana! Novo texto.');
  assert.equal(res.body.item.approval_class, null);

  const leased = await call('PATCH', '/api/followups/82', { text: 'Outro texto' });
  assert.equal(leased.status, 409);
  assert.equal(leased.body.code, 'ALREADY_CLAIMED');
  const sending = await call('PATCH', '/api/followups/83', { text: 'Outro texto' });
  assert.equal(sending.status, 409);
  const empty = await call('PATCH', '/api/followups/81', { text: '   ' });
  assert.equal(empty.status, 400);
  assert.equal(empty.body.code, 'TEXT_INVALID');
});

test('PATCH /:id perde a corrida quando a linha mudou depois da leitura', async (t) => {
  const db = makeDb({ scheduled_followups: [task({ id: 84 })] });
  const call = await startApp(t, db, fakeServices().services);
  // A linha muda entre a leitura e o update: simulado trocando o updated_at no primeiro select.
  const original = FakeQuery.prototype.runSelect;
  let armed = true;
  FakeQuery.prototype.runSelect = function (this: FakeQuery) {
    const out = original.call(this);
    if (armed && this.table === 'scheduled_followups' && out.data && !Array.isArray(out.data)) {
      armed = false;
      findTask(db, 84).updated_at = '2026-09-16T14:00:00.000Z';
    }
    return out;
  };
  t.after(() => { FakeQuery.prototype.runSelect = original; });
  const res = await call('PATCH', '/api/followups/84', { text: 'Texto novo' });
  assert.equal(res.status, 409);
  assert.equal(res.body.code, 'INVALID_STATUS');
  assert.equal(findTask(db, 84).message, 'Oi Ana, conseguiu ver o orçamento?');
});

test('POST /:id/skip com escopo deal pula e grava opt-out manual', async (t) => {
  const db = makeDb({ scheduled_followups: [task({ id: 91 })] });
  const call = await startApp(t, db, fakeServices().services);
  const res = await call('POST', '/api/followups/91/skip', { scope: 'deal' }, 'member');
  assert.equal(res.status, 200);
  const row = findTask(db, 91);
  assert.equal(row.status, 'skipped');
  assert.equal(row.message, '');
  assert.equal(row.last_error, 'Pulado pelo estúdio');
  assert.equal(row.generation_meta.skipped_by, 'user');
  const optouts = db.rows('followup_optouts');
  assert.equal(optouts.length, 1);
  assert.equal(optouts[0].phone_key, canonicalPhoneKey(PHONE_A));
  assert.equal(optouts[0].kind, 'manual');
  assert.equal(optouts[0].created_by, MEMBER);
  assert.equal(optouts[0].reason, 'Estúdio optou por não fazer follow-up');
  const again = await call('POST', '/api/followups/91/skip', {});
  assert.equal(again.status, 409);
});

test('POST /:id/regenerate mapeia cada resultado do serviço', async (t) => {
  const db = makeDb({ scheduled_followups: [task({ id: 95 })] });
  let next: RegenerateResult = { status: 'conflict' };
  const { services, calls } = fakeServices({ regenerate: async (...args) => { (calls.regenerate ||= []).push(args); return next; } });
  const call = await startApp(t, db, services);
  const expectations: Array<[RegenerateResult, number, string]> = [
    [{ status: 'conflict' }, 409, 'ALREADY_CLAIMED'],
    [{ status: 'conversation_changed' }, 409, 'CONVERSATION_CHANGED'],
    [{ status: 'invalid_status' }, 409, 'INVALID_STATUS'],
    [{ status: 'consent_required' }, 409, 'AI_CONSENT_REQUIRED'],
    [{ status: 'limit' }, 429, 'REGEN_LIMIT'],
    [{ status: 'error', message: 'timeout', retryable: true }, 502, 'AI_ERROR'],
  ];
  for (const [result, status, code] of expectations) {
    next = result;
    const res = await call('POST', '/api/followups/95/regenerate', { instruction: 'mais curto' });
    assert.equal(res.status, status, result.status);
    assert.equal(res.body.code, code);
  }
  next = { status: 'ai_suggests_skip', reason: 'Cliente disse que vai pensar' };
  const skip = await call('POST', '/api/followups/95/regenerate', {});
  assert.equal(skip.status, 200);
  assert.deepEqual(skip.body.ai_suggests_skip, { reason: 'Cliente disse que vai pensar' });
  assert.equal(skip.body.item.id, 95);
  next = { status: 'updated' };
  const ok = await call('POST', '/api/followups/95/regenerate', { force: true }, 'member');
  assert.equal(ok.status, 200);
  assert.equal(ok.body.ai_suggests_skip, undefined);
  const last = calls.regenerate[calls.regenerate.length - 1];
  assert.deepEqual(last, [OWNER, 95, { force: true, actorId: MEMBER }]);
  assert.equal(calls.regenerate[0][2].instruction, 'mais curto');
  const long = await call('POST', '/api/followups/95/regenerate', { instruction: 'x'.repeat(501) });
  assert.equal(long.status, 400);
  const missing = await call('POST', '/api/followups/999/regenerate', {});
  assert.equal(missing.status, 404);
});

test('REGEN_RUNNING lançado pelo serviço vira 409', async (t) => {
  const db = makeDb({ scheduled_followups: [task({ id: 96 })] });
  const call = await startApp(t, db, fakeServices({ regenerate: async () => { throw new Error('REGEN_RUNNING'); } }).services);
  const res = await call('POST', '/api/followups/96/regenerate', {});
  assert.equal(res.status, 409);
  assert.equal(res.body.code, 'REGEN_RUNNING');
});

// ─── Varredura manual ───

test('POST /sweep: sem consentimento 409, dry_run 200 e membro não consente', async (t) => {
  const db = makeDb({ followup_cadence_config: [configRow({ external_ai_consent_at: null, external_ai_consent_by: null })] });
  const { services, calls } = fakeServices();
  const call = await startApp(t, db, services);
  const denied = await call('POST', '/api/followups/sweep', {});
  assert.equal(denied.status, 409);
  assert.equal(denied.body.code, 'AI_CONSENT_REQUIRED');
  const dry = await call('POST', '/api/followups/sweep', { dry_run: true, step: 2 });
  assert.equal(dry.status, 200);
  assert.equal(dry.body.eligible_total, 30);
  assert.deepEqual(calls.countEligible[0][1], { manual: true, step: 2, dry_run: true });
  const member = await call('POST', '/api/followups/sweep', { consent_to_external_ai: true }, 'approver');
  assert.equal(member.status, 409);
  assert.equal(member.body.code, 'AI_CONSENT_REQUIRED');
  const support = await call('POST', '/api/followups/sweep', { consent_to_external_ai: true }, 'support');
  assert.equal(support.status, 409);
  assert.equal(db.rows('followup_cadence_config')[0].external_ai_consent_at, null);
  assert.equal(calls.runSweep, undefined);
  const noPerm = await call('POST', '/api/followups/sweep', {}, 'member');
  assert.equal(noPerm.status, 403);
});

test('POST /sweep: consentimento do dono grava, inicia em 202, trava a 2ª e espera 10 min', async (t) => {
  const db = makeDb({ followup_cadence_config: [configRow({ external_ai_consent_at: null, external_ai_consent_by: null })] });
  const gate = deferred<void>();
  const clock = { now: NOW };
  const { services, calls } = fakeServices({
    runSweep: async (...args) => { (calls.runSweep ||= []).push(args); await gate.promise; return {} as any; },
  });
  const call = await startApp(t, db, services, clock);
  const started = await call('POST', '/api/followups/sweep', { consent_to_external_ai: true });
  assert.equal(started.status, 202);
  assert.deepEqual(started.body, { started: true, eligible_total: 30, will_generate: 20 });
  const cfg = db.rows('followup_cadence_config')[0];
  assert.equal(cfg.external_ai_consent_at, NOW.toISOString());
  assert.equal(cfg.external_ai_consent_by, OWNER);
  assert.deepEqual(calls.invalidateConfig[0], [OWNER]);
  await tick();
  assert.deepEqual(calls.runSweep[0], [OWNER, { manual: true }]);

  const running = await call('POST', '/api/followups/sweep', {});
  assert.equal(running.status, 409);
  assert.equal(running.body.code, 'SWEEP_RUNNING');

  gate.resolve();
  await tick();
  clock.now = new Date(NOW.getTime() + 5 * 60_000);
  const tooSoon = await call('POST', '/api/followups/sweep', {});
  assert.equal(tooSoon.status, 429);
  assert.equal(tooSoon.body.code, 'SWEEP_TOO_SOON');

  const targeted = await call('POST', '/api/followups/sweep', { deal_ids: [11, 12], limit: 5 });
  assert.equal(targeted.status, 202);
  assert.equal(targeted.body.will_generate, 5);
  await tick();
  assert.deepEqual(calls.runSweep[1], [OWNER, { manual: true, deal_ids: [11, 12], limit: 5 }]);

  clock.now = new Date(NOW.getTime() + 11 * 60_000);
  const later = await call('POST', '/api/followups/sweep', {});
  assert.equal(later.status, 202);
  const tooMany = await call('POST', '/api/followups/sweep', { deal_ids: Array.from({ length: 51 }, (_, i) => i + 1) });
  assert.equal(tooMany.status, 400);
});

test('POST /sweep respeita o estado running do serviço', async (t) => {
  const db = makeDb();
  const { services } = fakeServices({ sweepState: () => ({ ...IDLE_SWEEP, running: true }) });
  const call = await startApp(t, db, services);
  const res = await call('POST', '/api/followups/sweep', {});
  assert.equal(res.status, 409);
  assert.equal(res.body.code, 'SWEEP_RUNNING');
});

// ─── Configuração ───

test('PUT /config: automático sem confirmação 400 e suporte não liga envios', async (t) => {
  const db = makeDb({ followup_cadence_config: [configRow({ enabled: false })] });
  const call = await startApp(t, db, fakeServices().services);
  const auto = await call('PUT', '/api/followups/config', { mode: 'auto' });
  assert.equal(auto.status, 400);
  assert.equal(auto.body.code, 'AUTO_CONFIRM_REQUIRED');
  assert.ok(auto.body.fields.mode);
  const support = await call('PUT', '/api/followups/config', { enabled: true }, 'support');
  assert.equal(support.status, 403);
  assert.deepEqual(support.body, { error: 'No modo suporte não dá para ligar os envios nem o modo automático.', code: 'FORBIDDEN' });
  const supportAuto = await call('PUT', '/api/followups/config', { mode: 'auto', confirm_auto: true }, 'support');
  assert.equal(supportAuto.status, 403);
  const member = await call('PUT', '/api/followups/config', { daily_cap: 10 }, 'approver');
  assert.equal(member.status, 403);
  assert.equal(db.entries('followup_cadence_config', 'upsert').length, 0);
  const supportTweak = await call('PUT', '/api/followups/config', { daily_cap: 12 }, 'support');
  assert.equal(supportTweak.status, 200);
});

test('PUT /config: allow_baileys sem a 085 volta 400 no campo', async (t) => {
  const db = makeDb();
  const call = await startApp(t, db, fakeServices({ dedupeReady: async () => false }).services);
  const res = await call('PUT', '/api/followups/config', { allow_baileys: true });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'CONFIG_INVALID');
  assert.equal(res.body.fields.allow_baileys, 'Aplique a migration 085 antes de enviar pelo QR.');
});

test('PUT /config grava só colunas editáveis, inicia a rampa e registra o consentimento', async (t) => {
  const db = makeDb({ followup_cadence_config: [configRow({ enabled: false, first_enabled_at: null, external_ai_consent_at: null, external_ai_consent_by: null, consecutive_errors: 2, paused_reason: null })] });
  const { services, calls } = fakeServices({ listTemplates: async () => [{ id: 9, name: 'retomada', language: 'pt_BR', status: 'APPROVED', category: 'MARKETING', eligible: true, reason: null, preview: 'Oi' }] });
  const call = await startApp(t, db, services);
  const res = await call('PUT', '/api/followups/config', {
    enabled: true, daily_cap: 25, template_id: 9, consent_to_external_ai: true, consecutive_errors: 0, paused_at: '2026-01-01T00:00:00Z',
    last_error: 'forjado', next_send_after: '2030-01-01T00:00:00Z',
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.config.enabled, true);
  assert.equal(res.body.config.template_id, 9);
  assert.equal(res.body.demoted_auto, 0);
  assert.deepEqual(res.body.legacy_disabled, []);
  const upserts = db.entries('followup_cadence_config', 'upsert');
  assert.equal(upserts.length, 1);
  const allowed = new Set([...Object.keys(res.body.config), 'user_id', 'updated_at', 'updated_by', 'first_enabled_at', 'external_ai_consent_at', 'external_ai_consent_by']);
  for (const key of Object.keys(upserts[0].payload)) assert.ok(allowed.has(key), `coluna de estado gravada: ${key}`);
  const cfg = db.rows('followup_cadence_config')[0];
  assert.equal(cfg.consecutive_errors, 2);
  assert.equal(cfg.paused_at, null);
  assert.equal(cfg.last_error, null);
  assert.equal(cfg.next_send_after, null);
  assert.equal(cfg.first_enabled_at, NOW.toISOString());
  assert.equal(cfg.external_ai_consent_at, NOW.toISOString());
  assert.equal(cfg.external_ai_consent_by, OWNER);
  assert.equal(cfg.updated_by, OWNER);
  assert.equal(cfg.daily_cap, 25);
  assert.deepEqual(calls.invalidateConfig, [[OWNER]]);

  const again = await call('PUT', '/api/followups/config', { daily_cap: 30 });
  assert.equal(again.status, 200);
  const second = db.entries('followup_cadence_config', 'upsert')[1].payload;
  assert.equal('first_enabled_at' in second, false);
  assert.equal('external_ai_consent_at' in second, false);
});

test('PUT /config: sair do automático ou desligar rebaixa só as aprovações da IA', async (t) => {
  const db = makeDb({
    followup_cadence_config: [configRow({ mode: 'auto' })],
    scheduled_followups: [
      task({ id: 101, status: 'approved', approved_by: 'auto', approved_at: '2026-09-16T11:00:00.000Z' }),
      task({ id: 102, status: 'approved', approved_by: OWNER, approved_at: '2026-09-16T11:00:00.000Z', deal_id: 12, phone: PHONE_B }),
      task({ id: 103, status: 'approved', approved_by: 'auto', approved_at: '2026-09-16T11:00:00.000Z', user_id: OTHER_TENANT }),
      task({ id: 104, status: 'sending', approved_by: 'auto', approved_at: '2026-09-16T11:00:00.000Z', deal_id: 13, phone: PHONE_C }),
    ],
  });
  const call = await startApp(t, db, fakeServices().services);
  const res = await call('PUT', '/api/followups/config', { mode: 'approval' });
  assert.equal(res.status, 200);
  assert.equal(res.body.demoted_auto, 1);
  assert.equal(findTask(db, 101).status, 'draft');
  assert.equal(findTask(db, 101).approved_at, null);
  assert.equal(findTask(db, 101).approved_by, null);
  assert.equal(findTask(db, 102).status, 'approved');
  assert.equal(findTask(db, 103).status, 'approved');
  assert.equal(findTask(db, 104).status, 'sending');

  findTask(db, 102).approved_by = 'auto';
  const off = await call('PUT', '/api/followups/config', { enabled: false });
  assert.equal(off.body.demoted_auto, 1);
  assert.equal(findTask(db, 102).status, 'draft');
  const noop = await call('PUT', '/api/followups/config', { daily_cap: 12 });
  assert.equal(noop.body.demoted_auto, 0);
});

test('PUT /config com disable_legacy_on_ladder desliga a mensagem fixa da escada', async (t) => {
  const db = makeDb();
  const call = await startApp(t, db, fakeServices().services);
  const res = await call('PUT', '/api/followups/config', { disable_legacy_on_ladder: true });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.legacy_disabled.sort(), ['followup-3', 'negotiation']);
  const byId = new Map(db.rows('deal_stages').map((s) => [s.id, s]));
  assert.equal(byId.get('negotiation')?.auto_follow_up_enabled, false);
  assert.equal(byId.get('followup-3')?.auto_follow_up_enabled, false);
  assert.equal(byId.get('prod-edicao')?.auto_follow_up_enabled, true);
  const update = db.entries('deal_stages', 'update')[0];
  assert.ok(update.filters.includes(`user_id=eq.${OWNER}`));
});

test('GET /config devolve etapas de venda, sugestão, templates e consentimento', async (t) => {
  const db = makeDb();
  const templates = [{ id: 9, name: 'retomada', language: 'pt_BR', status: 'APPROVED', category: 'MARKETING', eligible: true, reason: null, preview: 'Oi, Maria!' }];
  const call = await startApp(t, db, fakeServices({ listTemplates: async () => templates, dedupeReady: async () => true }).services);
  const res = await call('GET', '/api/followups/config', undefined, 'member');
  assert.equal(res.status, 200);
  assert.equal(res.body.exists, true);
  assert.equal(res.body.can_edit, false);
  assert.equal(res.body.dedupe_ready, true);
  assert.deepEqual(res.body.templates, templates);
  assert.equal(res.body.stages.some((s: any) => s.id === 'prod-edicao'), false);
  assert.deepEqual(res.body.suggested.ladder_stage_ids, ['proposal', 'negotiation', 'followup-3']);
  assert.equal(res.body.suggested.contact_stage_id, 'contact');
  assert.equal(res.body.suggested.entry_stage_id, 'lead');
  assert.deepEqual(res.body.consent, { external_ai: true, at: '2026-09-10T12:00:00.000Z' });
  assert.equal(res.body.defaults.daily_cap, 40);
});

// ─── Fila, conversa e card do negócio ───

test('GET /queue: aba Com problema junta blocked e failed recentes, com previsão e conversa nova', async (t) => {
  const db = makeDb({
    scheduled_followups: [
      task({ id: 111, status: 'blocked', updated_at: '2026-09-16T09:00:00.000Z' }),
      task({ id: 112, status: 'failed', updated_at: '2026-09-15T09:00:00.000Z', deal_id: 12, phone: PHONE_B, last_error: 'A Meta não entregou (código 131026: undeliverable).' }),
      task({ id: 113, status: 'failed', updated_at: '2026-09-01T09:00:00.000Z', deal_id: 13, phone: PHONE_C }),
      task({ id: 114, status: 'draft' }),
      task({ id: 115, status: 'blocked', user_id: OTHER_TENANT }),
    ],
    wa_messages: [{ user_id: OWNER, phone: PHONE_A, wa_number: MAIN_WA, from_me: false, type: 'text', timestamp: '2026-09-16T10:00:00.000Z' }],
  });
  const { services, calls } = fakeServices({
    forecast: async (...args) => { (calls.forecast ||= []).push(args); return args[2].map((i: ForecastInput) => ({ id: i.id, channel: 'meta_template', approval: { channel_class: 'template', render: `Oi, Ana! ${i.text}`, template_id: 9 } })); },
  });
  const call = await startApp(t, db, services);
  const res = await call('GET', '/api/followups/queue?status=blocked&preview=1');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.items.map((i: any) => i.id), [111, 112]);
  assert.equal(res.body.total, 2);
  assert.equal(res.body.server_time, NOW.toISOString());
  const blocked = res.body.items[0];
  assert.equal(blocked.conversation_changed, true);
  assert.equal(blocked.channel_forecast, 'meta_template');
  assert.equal(blocked.template_preview, 'Oi, Ana! Oi Ana, conseguiu ver o orçamento?');
  assert.equal(blocked.preview.length, 1);
  assert.equal(res.body.items[1].conversation_changed, false);
  assert.equal(res.body.items[1].channel_forecast, 'blocked');
  assert.deepEqual(calls.forecast[0][2].map((i: ForecastInput) => i.id), [111]);

  const drafts = await call('GET', '/api/followups/queue');
  assert.deepEqual(drafts.body.items.map((i: any) => i.id), [114]);
  const search = await call('GET', '/api/followups/queue?status=blocked&search=0002');
  assert.deepEqual(search.body.items.map((i: any) => i.id), [112]);
});

test('GET /:id/conversation é fail-closed no número principal', async (t) => {
  const db = makeDb({
    scheduled_followups: [task({ id: 121 }), task({ id: 122, wa_number: null })],
    wa_messages: [
      { user_id: OWNER, phone: PHONE_A, wa_number: MAIN_WA, from_me: false, type: 'text', body: 'Oi', timestamp: '2026-09-14T14:00:00.000Z' },
      { user_id: OWNER, phone: '554399990001', wa_number: MAIN_WA, from_me: true, type: 'audio', body: null, transcription: 'áudio transcrito', timestamp: '2026-09-14T15:00:00.000Z' },
      { user_id: OWNER, phone: PHONE_A, wa_number: '5543000000000', from_me: false, type: 'text', body: 'pós-venda', timestamp: '2026-09-15T14:00:00.000Z' },
      { user_id: OTHER_TENANT, phone: PHONE_A, wa_number: MAIN_WA, from_me: false, type: 'text', body: 'outra conta', timestamp: '2026-09-15T14:00:00.000Z' },
    ],
  });
  const call = await startApp(t, db, fakeServices().services);
  const res = await call('GET', '/api/followups/121/conversation?limit=10');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.messages.map((m: any) => m.body), ['Oi', 'áudio transcrito']);
  const none = await call('GET', '/api/followups/122/conversation');
  assert.deepEqual(none.body, { messages: [] });
  const missing = await call('GET', '/api/followups/abc/conversation');
  assert.equal(missing.status, 404);
});

test('GET /deal/:dealId devolve papel da etapa, tarefa viva, histórico, opt-out e legado', async (t) => {
  const db = makeDb({
    scheduled_followups: [
      task({ id: 131, status: 'sent', created_at: '2026-09-10T10:00:00.000Z', sent_at: '2026-09-10T12:00:00.000Z' }),
      task({ id: 132, status: 'draft', step: 1 }),
      { id: 133, user_id: OWNER, kind: 'legacy', deal_id: 11, status: 'pending', scheduled_at: '2026-09-17T12:00:00.000Z', phone: PHONE_A, created_at: '2026-09-16T00:00:00Z' },
    ],
    followup_optouts: [{ id: 1, user_id: OWNER, phone_key: canonicalPhoneKey(PHONE_A), revoked_at: null }],
  });
  const call = await startApp(t, db, fakeServices().services);
  const res = await call('GET', '/api/followups/deal/11', undefined, 'member');
  assert.equal(res.status, 200);
  assert.equal(res.body.stage_role, 'step');
  assert.equal(res.body.step, 1);
  assert.equal(res.body.active.id, 132);
  assert.equal(res.body.last.id, 131);
  assert.equal(res.body.opted_out, true);
  assert.equal(res.body.can_approve, false);
  assert.deepEqual(res.body.legacy_pending, { id: 133, status: 'pending', scheduled_at: '2026-09-17T12:00:00.000Z' });
  assert.equal(res.body.next_eligible_at, null);

  db.tables.scheduled_followups = [];
  db.rows('wa_messages').push({ user_id: OWNER, phone: PHONE_C, wa_number: MAIN_WA, from_me: true, type: 'text', status: 'sent', timestamp: '2026-09-15T12:00:00.000Z' });
  const next = await call('GET', '/api/followups/deal/13');
  assert.equal(next.body.stage_role, 'step');
  assert.equal(next.body.step, 2);
  assert.equal(next.body.next_eligible_at, '2026-09-17T12:00:00.000Z');
  assert.equal(next.body.active, null);
  const foreign = await call('GET', '/api/followups/deal/91');
  assert.equal(foreign.status, 404);
});

// ─── Trilha antes do orçamento ───

const PHONE_D = '5543999990004';
const PQ_CONFIG = { pre_quote_stage_ids: ['contact'], pre_quote_delays_hours: [24, 72] };

function contactDeal(): Row {
  return { user_id: OWNER, temperature: 'warm', assigned_to: null, converted: false, converted_job_id: null,
    id: 14, title: 'Ensaio Duda', contact_name: 'Duda', contact_phone: PHONE_D, stage: 'contact' };
}

test('PUT /config valida e grava as etapas e os atrasos antes do orçamento; legado de contact desligado junto', async (t) => {
  const db = makeDb();
  const call = await startApp(t, db, fakeServices().services);
  const overlap = await call('PUT', '/api/followups/config', { pre_quote_stage_ids: ['proposal'] });
  assert.equal(overlap.status, 400);
  assert.equal(overlap.body.code, 'CONFIG_INVALID');
  assert.match(overlap.body.fields.pre_quote_stage_ids, /escada/);
  const after = await call('PUT', '/api/followups/config', { pre_quote_stage_ids: ['followup-3'] });
  assert.equal(after.status, 400);
  assert.match(after.body.fields.pre_quote_stage_ids, /escada/, 'a etapa depois do último passo também não serve');
  const tooMany = await call('PUT', '/api/followups/config', { pre_quote_stage_ids: ['lead', 'contact'], pre_quote_delays_hours: [24, 72, 96] });
  assert.equal(tooMany.status, 400);
  assert.match(tooMany.body.fields.pre_quote_delays_hours, /1 ou 2/);
  const won = await call('PUT', '/api/followups/config', { pre_quote_stage_ids: ['won'] });
  assert.match(won.body.fields.pre_quote_stage_ids, /abertas/);

  db.rows('deal_stages').find((st) => st.id === 'contact')!.auto_follow_up_enabled = true;
  const ok = await call('PUT', '/api/followups/config', { ...PQ_CONFIG, disable_legacy_on_ladder: true });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.config.pre_quote_stage_ids, ['contact']);
  assert.deepEqual(ok.body.config.pre_quote_delays_hours, [24, 72]);
  assert.ok(ok.body.legacy_disabled.includes('contact'));
  const saved = db.rows('followup_cadence_config').find((r) => r.user_id === OWNER) as Row;
  assert.deepEqual(saved.pre_quote_stage_ids, ['contact']);
  assert.deepEqual(saved.pre_quote_delays_hours, [24, 72]);
});

test('GET /config sugere Conversa Iniciada para antes do orçamento', async (t) => {
  const call = await startApp(t, makeDb(), fakeServices().services);
  const res = await call('GET', '/api/followups/config');
  assert.deepEqual(res.body.suggested.pre_quote_stage_ids, ['contact']);
  assert.deepEqual(res.body.suggested.pre_quote_delays_hours, [24, 72]);
  assert.deepEqual(res.body.defaults.pre_quote_stage_ids, []);
});

test('GET /queue filtra por trilha e o item traz track e total de toques; overview separa as trilhas', async (t) => {
  const db = makeDb({
    followup_cadence_config: [configRow(PQ_CONFIG)],
    deals: [...deals(), contactDeal()],
    scheduled_followups: [
      task({ id: 141, status: 'draft' }),
      task({ id: 142, status: 'draft', track: 'pre_quote', deal_id: 14, phone: PHONE_D, stage_id: 'contact', step: 1 }),
    ],
  });
  const call = await startApp(t, db, fakeServices().services);
  const pq = await call('GET', '/api/followups/queue?track=pre_quote');
  assert.deepEqual(pq.body.items.map((i: any) => i.id), [142]);
  assert.equal(pq.body.items[0].track, 'pre_quote');
  assert.equal(pq.body.items[0].track_steps, 2);
  assert.equal(pq.body.items[0].deal.stage_name, 'Conversa iniciada');
  const ladder = await call('GET', '/api/followups/queue?track=ladder');
  assert.deepEqual(ladder.body.items.map((i: any) => i.id), [141]);
  assert.equal(ladder.body.items[0].track, 'ladder');
  assert.equal(ladder.body.items[0].track_steps, 2);
  const all = await call('GET', '/api/followups/queue');
  assert.equal(all.body.items.length, 2);
  const o = await call('GET', '/api/followups/overview');
  assert.deepEqual(o.body.counts.draft_by_track, { ladder: 1, pre_quote: 1 });
  assert.deepEqual(o.body.counts.draft_by_step, { 1: 1, 2: 0, 3: 0, 4: 0 }, 'draft_by_step é só da escada');
  assert.equal(o.body.counts.draft, 2);
});

test('POST /approve-all respeita o filtro por trilha', async (t) => {
  const db = makeDb({
    followup_cadence_config: [configRow(PQ_CONFIG)],
    deals: [...deals(), contactDeal()],
    scheduled_followups: [
      task({ id: 151, status: 'draft' }),
      task({ id: 152, status: 'draft', track: 'pre_quote', deal_id: 14, phone: PHONE_D, stage_id: 'contact', step: 1 }),
    ],
  });
  const call = await startApp(t, db, fakeServices().services);
  const res = await call('POST', '/api/followups/approve-all', { generated_before: NOW.toISOString(), track: 'pre_quote' });
  assert.equal(res.status, 200);
  assert.equal(res.body.approved, 1);
  assert.equal(findTask(db, 152).status, 'approved');
  assert.equal(findTask(db, 151).status, 'draft');
});

test('GET /deal/:dealId em Conversa Iniciada: papel pre_quote, próximo toque e atraso da trilha', async (t) => {
  const db = makeDb({
    followup_cadence_config: [configRow(PQ_CONFIG)],
    deals: [...deals(), contactDeal()],
    wa_messages: [
      { user_id: OWNER, phone: PHONE_D, wa_number: MAIN_WA, from_me: false, type: 'text', timestamp: '2026-09-10T12:00:00.000Z' },
      { user_id: OWNER, phone: PHONE_D, wa_number: MAIN_WA, from_me: true, type: 'text', status: 'sent', timestamp: '2026-09-15T12:00:00.000Z' },
    ],
  });
  const call = await startApp(t, db, fakeServices().services);
  const first = await call('GET', '/api/followups/deal/14');
  assert.equal(first.status, 200);
  assert.equal(first.body.stage_role, 'pre_quote');
  assert.equal(first.body.track, 'pre_quote');
  assert.equal(first.body.track_steps, 2);
  assert.equal(first.body.step, 1);
  assert.equal(first.body.next_eligible_at, '2026-09-16T12:00:00.000Z');

  db.rows('scheduled_followups').push(task({ id: 161, status: 'sent', track: 'pre_quote', deal_id: 14, phone: PHONE_D, stage_id: 'contact',
    step: 1, sent_at: '2026-09-15T12:00:00.000Z', created_at: '2026-09-15T11:00:00.000Z' }));
  const second = await call('GET', '/api/followups/deal/14');
  assert.equal(second.body.step, 2);
  assert.equal(second.body.next_eligible_at, '2026-09-18T12:00:00.000Z', '72h depois do toque 1');
  assert.equal(second.body.last.track, 'pre_quote');

  db.rows('scheduled_followups').push(task({ id: 162, status: 'sent', track: 'pre_quote', deal_id: 14, phone: PHONE_D, stage_id: 'contact',
    step: 2, sent_at: '2026-09-15T13:00:00.000Z', created_at: '2026-09-15T12:30:00.000Z' }));
  const done = await call('GET', '/api/followups/deal/14');
  assert.equal(done.body.step, null, 'os dois toques já saíram');
  assert.equal(done.body.next_eligible_at, null);
  const outside = await call('GET', '/api/followups/deal/11');
  assert.equal(outside.body.track, 'ladder');
});

// ─── Pausa, opt-outs e revisão do funil ───

test('POST /sending pausa e retoma zerando a sequência de erros', async (t) => {
  const db = makeDb();
  const { services, calls } = fakeServices();
  const call = await startApp(t, db, services);
  const pause = await call('POST', '/api/followups/sending', { paused: true }, 'approver');
  assert.equal(pause.status, 200);
  assert.equal(pause.body.sending.paused_reason, 'manual');
  assert.equal(db.rows('followup_cadence_config')[0].paused_reason, 'manual');
  const resume = await call('POST', '/api/followups/sending', { paused: false });
  assert.equal(resume.status, 200);
  const cfg = db.rows('followup_cadence_config')[0];
  assert.equal(cfg.paused_at, null);
  assert.equal(cfg.consecutive_errors, 0);
  assert.deepEqual(calls.kickSender, [[OWNER]]);
  assert.equal(resume.body.sending.paused, false);
  const bad = await call('POST', '/api/followups/sending', {});
  assert.equal(bad.status, 400);
  const member = await call('POST', '/api/followups/sending', { paused: false }, 'member');
  assert.equal(member.status, 403);
});

test('opt-outs: POST cancela as vivas pelo phone_key, GET lista e DELETE só para o dono', async (t) => {
  const db = makeDb({
    scheduled_followups: [
      task({ id: 141, status: 'approved', approved_at: '2026-09-16T11:00:00.000Z', approved_by: OWNER, phone: '554399990001' }),
      task({ id: 142, status: 'sending', deal_id: 12 }),
      task({ id: 143, status: 'draft', deal_id: 13, phone: PHONE_C }),
    ],
  });
  const call = await startApp(t, db, fakeServices().services);
  const created = await call('POST', '/api/followups/optouts', { deal_id: 11, reason: 'Pediu para parar' }, 'member');
  assert.equal(created.status, 201);
  assert.equal(created.body.optout.phone_key, canonicalPhoneKey(PHONE_A));
  assert.equal(created.body.optout.contact_name, 'Ana');
  assert.equal(created.body.optout.created_by_label, 'Você');
  assert.equal(findTask(db, 141).status, 'cancelled');
  assert.equal(findTask(db, 141).last_error, 'cancel:optout');
  assert.equal(findTask(db, 142).status, 'sending');
  assert.equal(findTask(db, 143).status, 'draft');
  const dup = await call('POST', '/api/followups/optouts', { phone: '(43) 99999-0001' });
  assert.equal(dup.status, 201);
  assert.equal(dup.body.optout.id, created.body.optout.id);
  const bad = await call('POST', '/api/followups/optouts', { phone: '123' });
  assert.equal(bad.status, 400);
  const none = await call('POST', '/api/followups/optouts', {});
  assert.equal(none.status, 400);

  const list = await call('GET', '/api/followups/optouts?search=Ana');
  assert.equal(list.body.total, 1);
  assert.equal(list.body.items[0].created_by_label, 'Bia da equipe');
  const byPhone = await call('GET', '/api/followups/optouts?search=9999');
  assert.equal(byPhone.body.total, 1);
  const nobody = await call('GET', '/api/followups/optouts?search=Zuleica');
  assert.deepEqual(nobody.body, { items: [], total: 0 });

  const memberDelete = await call('DELETE', `/api/followups/optouts/${created.body.optout.id}`, undefined, 'approver');
  assert.equal(memberDelete.status, 403);
  const removed = await call('DELETE', `/api/followups/optouts/${created.body.optout.id}`);
  assert.deepEqual(removed.body, { success: true });
  assert.equal(db.rows('followup_optouts')[0].revoked_by, OWNER);
  const again = await call('DELETE', `/api/followups/optouts/${created.body.optout.id}`);
  assert.equal(again.status, 404);
});

test('revisão do funil: só dono, com limites de entrada', async (t) => {
  const db = makeDb();
  const { services, calls } = fakeServices();
  const call = await startApp(t, db, services);
  const preview = await call('GET', '/api/followups/reconcile/preview?limit=50&days=7');
  assert.equal(preview.status, 200);
  assert.deepEqual(calls.reconcilePreview[0], [OWNER, { limit: 50, days: 7 }]);
  const member = await call('GET', '/api/followups/reconcile/preview', undefined, 'approver');
  assert.equal(member.status, 403);
  const apply = await call('POST', '/api/followups/reconcile/apply', { deal_ids: [11, 12], create_phones: ['(43) 99999-0003'], include_marketing: true });
  assert.equal(apply.status, 200);
  assert.deepEqual(calls.reconcileApply[0], [OWNER, { include_marketing: true, deal_ids: [11, 12], create_phones: ['43999990003'] }, OWNER]);
  const tooMany = await call('POST', '/api/followups/reconcile/apply', { deal_ids: Array.from({ length: 301 }, (_, i) => i + 1) });
  assert.equal(tooMany.status, 400);
  const badPhone = await call('POST', '/api/followups/reconcile/apply', { create_phones: ['12'] });
  assert.equal(badPhone.status, 400);
});

// ─── Garantias transversais ───

test('toda consulta filtra a conta e toda tarefa filtra kind; req.supabase nunca é usado', async (t) => {
  const db = makeDb({
    scheduled_followups: [task({ id: 151 }), task({ id: 152, status: 'approved', approved_by: 'auto', approved_at: '2026-09-16T11:00:00.000Z', deal_id: 12, phone: PHONE_B })],
    followup_cadence_config: [configRow({ mode: 'auto' })],
  });
  const call = await startApp(t, db, fakeServices().services);
  const requests: Array<[string, string, unknown?]> = [
    ['GET', '/api/followups/overview'], ['GET', '/api/followups/queue'], ['GET', '/api/followups/queue?status=approved'],
    ['GET', '/api/followups/151/conversation'], ['GET', '/api/followups/deal/11'], ['GET', '/api/followups/config'],
    ['PATCH', '/api/followups/151', { text: 'Texto' }], ['POST', '/api/followups/151/approve', {}],
    ['POST', '/api/followups/approve-all', { generated_before: NOW.toISOString() }], ['POST', '/api/followups/151/skip', {}],
    ['PUT', '/api/followups/config', { mode: 'approval' }], ['GET', '/api/followups/optouts'],
    ['POST', '/api/followups/optouts', { phone: PHONE_C }], ['POST', '/api/followups/sending', { paused: true }],
  ];
  for (const [method, path, body] of requests) {
    const res = await call(method, path, body);
    assert.ok(res.status < 500, `${method} ${path} => ${res.status} ${JSON.stringify(res.body)}`);
  }
  assert.ok(db.log.length > 20);
  for (const entry of db.log) {
    const scoped = entry.filters.some((f) => f === `user_id=eq.${OWNER}` || f === `owner_user_id=eq.${OWNER}`);
    const upsertOwn = entry.op === 'upsert' && entry.payload.user_id === OWNER;
    const insertOwn = entry.op === 'insert' && entry.payload.user_id === OWNER;
    assert.ok(scoped || upsertOwn || insertOwn, `sem filtro de conta: ${entry.table} ${entry.op} ${entry.filters.join('&')}`);
    if (entry.table !== 'scheduled_followups') continue;
    const kind = entry.filters.find((f) => f.startsWith('kind=eq.'));
    assert.ok(kind, `sem filtro de kind: ${entry.op} ${entry.filters.join('&')}`);
  }
  const legacy = db.entries('scheduled_followups').filter((e) => e.filters.includes('kind=eq.legacy'));
  assert.ok(legacy.every((e) => e.op === 'select' && e.filters.includes('status=eq.pending')));
});

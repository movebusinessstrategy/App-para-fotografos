export type FollowUpMode = 'approval' | 'auto';
export type FollowUpStep = 1 | 2 | 3 | 4;
export const FOLLOWUP_STEPS: readonly FollowUpStep[] = [1, 2, 3, 4];
// ladder = escada depois do orçamento (move o card); pre_quote = antes do orçamento (nunca move).
export type FollowUpTrack = 'ladder' | 'pre_quote';
export const FOLLOWUP_TRACKS: readonly FollowUpTrack[] = ['ladder', 'pre_quote'];
export const PRE_QUOTE_MAX_STEPS = 2;

export const WARMUP_DAILY_CAP = 10;
export const WARMUP_DAYS = 14;
export const ADVANCE_CONFIRM_MINUTES = 15;
export const RETENTION_DAYS = 90;

export type CadenceStatus = 'draft' | 'approved' | 'sending' | 'sent' | 'skipped' | 'cancelled' | 'blocked' | 'failed';
export const CADENCE_STATUSES: readonly CadenceStatus[] = ['draft', 'approved', 'sending', 'sent', 'skipped', 'cancelled', 'blocked', 'failed'];
export const LIVE_CADENCE_STATUSES: readonly CadenceStatus[] = ['draft', 'approved', 'sending', 'blocked'];
export const STUDIO_NON_TURN_TYPES: readonly string[] = ['reaction', 'edit', 'revoke', 'unsupported'];
export const CUSTOMER_NON_TURN_TYPES: readonly string[] = ['reaction', 'edit', 'revoke'];

export type ChannelKind = 'meta_text' | 'meta_template' | 'baileys';
export type ApprovalChannelClass = 'text' | 'template';
export type BlockCode = 'no_channel' | 'meta_token_expired' | 'meta_not_operational' | 'window_closed_no_template'
  | 'baileys_disabled' | 'baileys_offline' | 'number_mismatch' | 'template_invalid' | 'template_not_eligible' | 'quality_not_green';
export type PauseReason = 'error_streak' | 'manual';
export type CancelReason = 'deal_missing' | 'deal_closed' | 'optout' | 'stage_changed' | 'customer_replied'
  | 'studio_spoke' | 'user_skip' | 'undeliverable' | 'already_customer' | 'needs_human';
export type SkipOrigin = 'ai' | 'user';
export type DraftWarning = 'preco' | 'percentual' | 'desconto' | 'data' | 'horario' | 'vaga' | 'revela_automacao'
  | 'tempo_decorrido' | 'dois_pontos' | 'numero_nao_verificado' | 'link_nao_aprovado' | 'pdf_removido' | 'longo'
  | 'muitos_baloes' | 'reacao_cliente';

// days: 0=dom..6=sáb; start/end 'HH:MM' (end exclusivo); holidays: 'YYYY-MM-DD' no fuso tz.
export interface BusinessHours { tz: string; days: number[]; start: string; end: string; holidays: string[] }
export const DEFAULT_BUSINESS_HOURS: BusinessHours = { tz: 'America/Sao_Paulo', days: [1, 2, 3, 4, 5, 6], start: '09:00', end: '19:00', holidays: [] };
export const DEFAULT_STEP_DELAYS_HOURS: readonly number[] = [24, 48, 72, 120];
export const DEFAULT_PRE_QUOTE_DELAYS_HOURS: readonly number[] = [24, 72];

export interface TrackerConfig {
  create_deal_on_inbound: boolean;
  entry_stage_id: string | null;       // null => 1ª etapa de venda aberta por position
  contact_stage_id: string | null;     // null => desliga lead→contact
  proposal_stage_id: string | null;    // null => desliga →proposal
  promote_to_contact_from: string[];   // [] => [entry]
  promote_to_proposal_from: string[];  // [] => [entry, contact]
  quote_keywords: string[];
  quote_exclusions: string[];
  generic_pdf_is_quote: boolean;
  count_bot_as_studio_reply: boolean;
  recreate_after_lost: boolean;        // todos os deals do telefone perdidos => cria card novo
  skip_existing_customers: boolean;    // telefone de cliente (followup_customer_phone_keys) => não cria lead
  ignored_phones: string[];            // além dos números da própria conta, que são sempre ignorados
}
export const DEFAULT_TRACKER_CONFIG: TrackerConfig = {
  create_deal_on_inbound: true, entry_stage_id: null, contact_stage_id: null, proposal_stage_id: null,
  promote_to_contact_from: [], promote_to_proposal_from: [],
  quote_keywords: ['orcamento', 'pacote', 'pacotes', 'investimento', 'valores', 'proposta', 'tabela'],
  quote_exclusions: ['dicas', 'produtos', 'catalogo', 'producoes', 'contrato', 'comprovante', 'recibo', 'boleto', 'nota fiscal'],
  generic_pdf_is_quote: false, count_bot_as_studio_reply: true,
  recreate_after_lost: true, skip_existing_customers: true, ignored_phones: [],
};

// = colunas editáveis de followup_cadence_config
export interface FollowUpConfig {
  enabled: boolean;
  mode: FollowUpMode;
  ladder_stage_ids: string[];        // 0..4; índice+1 = passo
  step_delays_hours: number[];       // 1..4 itens, cada 1..720 (horas desde a última fala do estúdio)
  after_last_stage_id: string | null;
  pre_quote_stage_ids: string[];     // 0..2 etapas abertas ANTES da escada; nunca move o card
  pre_quote_delays_hours: number[];  // 1..2 itens, cada 1..720; índice+1 = toque
  business_hours: BusinessHours;
  daily_cap: number;                 // 1..200 (nos 14 dias depois de first_enabled_at vale min(daily_cap, WARMUP_DAILY_CAP))
  min_gap_seconds: number;           // 30..900
  max_gap_seconds: number;           // >= min, <= 1800
  max_consecutive_errors: number;    // 1..10
  allow_meta_text: boolean;
  allow_baileys: boolean;            // só com a migration 085 aplicada
  template_id: number | null;        // só template elegível (MARKETING, {{1}} e {{2}})
  max_silence_hours: number;         // 24..2160
  sweep_interval_minutes: number;    // 15..1440
  max_drafts_per_sweep: number;      // 1..60
  extra_instructions: string;        // <= 1000, sem '###'
  optout_detection: boolean;
  tracker_enabled: boolean;
  tracker_config: TrackerConfig;
  wa_number: string | null;          // null => número principal resolvido no servidor
}
export const DEFAULT_FOLLOWUP_CONFIG: FollowUpConfig = {
  enabled: false, mode: 'approval', ladder_stage_ids: [], step_delays_hours: [24, 48, 72, 120], after_last_stage_id: null,
  pre_quote_stage_ids: [], pre_quote_delays_hours: [24, 72],
  business_hours: DEFAULT_BUSINESS_HOURS, daily_cap: 40, min_gap_seconds: 60, max_gap_seconds: 150, max_consecutive_errors: 3,
  allow_meta_text: true, allow_baileys: false, template_id: null, max_silence_hours: 720,
  sweep_interval_minutes: 60, max_drafts_per_sweep: 20, extra_instructions: '', optout_detection: true,
  tracker_enabled: false, tracker_config: DEFAULT_TRACKER_CONFIG, wa_number: null,
};

export interface SweepSummary {
  eligible: number; generated: number; auto_approved: number; ai_skipped: number; handoffs: number;
  already_drafted: number; optouts_detected: number; housekept: number; errors: number; finished_at: string;
}
// = colunas de estado de followup_cadence_config (escritas só por worker e rotas específicas)
export interface FollowUpRuntimeState {
  next_send_after: string | null; consecutive_errors: number; paused_at: string | null; paused_reason: PauseReason | null;
  last_error: string | null; last_block_code: BlockCode | null; last_block_message: string | null; last_block_at: string | null;
  last_sweep_at: string | null; last_sweep_summary: SweepSummary | null;
  first_enabled_at: string | null; external_ai_consent_at: string | null; external_ai_consent_by: string | null;
}

export interface PreviewMessage { from_me: boolean; body: string; type: string; timestamp: string }

export interface CadenceApproval { channel_class: ApprovalChannelClass; render: string | null; template_id: number | null }

export interface CadenceGenerationMeta {
  version?: string;
  outcome?: 'draft' | 'skip' | 'handoff';
  skip_reason?: string | null;
  skipped_by?: SkipOrigin | null;
  handoff_reason?: string | null;
  warnings?: DraftWarning[];
  invisible_basis?: boolean;
  invisible_read?: boolean;
  anchor?: { last_studio_at: string | null; last_customer_at: string | null; last_invisible_out_at: string | null };
  context_tail?: PreviewMessage[];       // até 8; body <= 280; removido pela retenção
  model?: string | null; latency_ms?: number | null; usage?: unknown; cost_usd?: number | null;
  niche?: string | null; messages_used?: number;
  generated_at?: string; regenerations?: number;
  approved_via?: 'manual' | 'bulk' | 'auto';
  approval?: CadenceApproval;            // gravado em toda aprovação (manual, lote, auto)
  impersonated?: boolean;
  edited_at?: string; edited_by?: string;
  prev_status?: string | null; prev_claimed_at?: string | null;   // gravados pelo claim_cadence_followup
  delivery?: { message_ids: string[]; delivered_text: string; channel: ChannelKind; proof_at?: string; recovered?: boolean; forced?: boolean };
  advance?: { state: 'pending' | 'done' | 'skipped'; due_at: string; result?: 'moved' | 'noop' | 'conflict' | 'refused' | null };
  failure?: { code: number | null; title: string | null; at: string };
  cancel_reason?: CancelReason;
  block_code?: BlockCode;
  retention_applied_at?: string;
}

export interface CadenceTaskRow {
  id: number; user_id: string; deal_id: number; phone: string; phone_key: string | null; wa_number: string | null; message: string;
  stage_id: string; scheduled_at: string; sent_at: string | null; status: CadenceStatus; created_at: string;
  contact_name: string | null; attempts: number; kind: 'cadence'; track: FollowUpTrack; step: FollowUpStep; basis_at: string;
  basis_message_id: string | null; draft_text: string | null; approved_at: string | null; approved_by: string | null;
  claimed_at: string | null; claimed_by: string | null; lease_expires_at: string | null; channel_used: ChannelKind | null;
  sent_message_id: string | null; last_error: string | null; generation_meta: CadenceGenerationMeta; updated_at: string;
}

export interface ChannelHealth {
  baileys: { status: 'open' | 'connecting' | 'close' | 'not_initialized'; phone: string | null; allowed: boolean; dedupe_ready: boolean };
  meta: { configured: boolean; operational: boolean; token_expires_at: string | null;
          token_state: 'ok' | 'expiring' | 'expired' | 'no_expiry' | 'none'; days_left: number | null; quality_rating: string | null };
  template: { configured: boolean; approved: boolean; eligible: boolean; name: string | null; reason: string | null };
  preferred_channel: 'auto' | 'meta' | 'baileys' | null;
  can_send: { inside_24h: boolean; outside_24h: boolean };
  level: 'ok' | 'degraded' | 'down';
  notes: string[];                         // frases prontas pt-BR, sem travessão
}

export interface SweepRequest { manual: boolean; dry_run?: boolean; step?: FollowUpStep; track?: FollowUpTrack; deal_ids?: number[]; limit?: number }
export interface SweepDryRun {
  eligible_total: number; by_step: Record<FollowUpStep, number>; by_track: Record<FollowUpTrack, number>;
  skipped_by_reason: Record<string, number>;
  sample: Array<{ deal_id: number; title: string; step: FollowUpStep; track: FollowUpTrack; hours_silent: number }>;
}
export interface SweepState {
  running: boolean; started_at: string | null; finished_at: string | null;
  progress: { total: number; done: number } | null; last_summary: SweepSummary | null; next_auto_at: string | null;
}

export type OverviewPauseReason = 'disabled' | 'outside_hours' | 'daily_cap' | 'error_streak' | 'manual' | 'no_channel' | null;
export interface FollowUpOverview {
  migration_required?: true;
  configured: boolean; enabled: boolean; mode: FollowUpMode; tracker_enabled: boolean;
  can_edit_config: boolean; can_approve: boolean;
  consent: { external_ai: boolean; at: string | null };
  channels: ChannelHealth;
  // draft_by_step conta só a escada; a trilha antes do orçamento fica em draft_by_track.pre_quote
  counts: { draft: number; draft_by_step: Record<FollowUpStep, number>; draft_by_track: Record<FollowUpTrack, number>; approved: number; sending: number; blocked: number;
            failed_7d: number; sent_today: number; skipped_7d: number; cancelled_7d: number; optouts: number };
  sending: { sent_today: number; daily_cap: number; effective_cap: number; warmup_until: string | null; remaining: number;
             paused: boolean; paused_reason: OverviewPauseReason; last_error: string | null; last_block_message: string | null;
             next_window_at: string | null };
  sweep: SweepState;
  legacy_automation: Array<{ stage_id: string; stage_name: string }>;
  server_time: string;
}

// 'blocked' = aba "Com problema": status blocked + failed dos últimos 7 dias
export type QueueTab = 'draft' | 'approved' | 'blocked' | 'sent_today' | 'skipped' | 'cancelled';
export interface FollowUpDraftItem {
  id: number; deal_id: number; step: FollowUpStep; status: CadenceStatus;
  track: FollowUpTrack; track_steps: number;   // track_steps = total de toques da trilha na config atual
  text: string;                          // scheduled_followups.message
  original_text: string | null;          // scheduled_followups.draft_text
  scheduled_at: string; created_at: string; updated_at: string | null; sent_at: string | null;
  approved_at: string | null; approved_by_label: string | null; approved_via: 'manual' | 'bulk' | 'auto' | null;
  last_error: string | null; channel_used: ChannelKind | null;
  channel_forecast: ChannelKind | 'blocked';
  template_preview: string | null;       // texto renderizado quando channel_forecast === 'meta_template'
  approval_class: ApprovalChannelClass | null;
  deal: { id: number; title: string; contact_name: string | null; phone: string; stage_id: string; stage_name: string;
          temperature: string | null; assigned_to: string | null };          // nunca valores em R$
  silence: { basis_at: string; last_customer_at: string | null; hours: number; inside_24h: boolean };
  conversation_changed: boolean;          // inbound com turno depois de basis_at, em QUALQUER número da conta
  preview: PreviewMessage[];              // de generation_meta.context_tail
  ai: { outcome: 'draft' | 'skip' | 'handoff'; skip_reason: string | null; skipped_by: SkipOrigin | null;
        handoff_reason: string | null; warnings: DraftWarning[]; regenerations: number; model: string | null;
        invisible_basis: boolean; invisible_read: boolean };
}
export interface FollowUpQueueResponse { items: FollowUpDraftItem[]; total: number; offset: number; limit: number; server_time: string }

export interface DealFollowUpState {
  configured: boolean; enabled: boolean; mode: FollowUpMode;
  stage_role: 'step' | 'pre_quote' | 'after_last' | 'outside';
  step: FollowUpStep | null;                 // na trilha antes do orçamento: o próximo toque (null quando acabaram)
  track: FollowUpTrack | null; track_steps: number;
  next_eligible_at: string | null;
  active: FollowUpDraftItem | null; last: FollowUpDraftItem | null;
  opted_out: boolean; can_approve: boolean;
  legacy_pending: { id: number; status: string; scheduled_at: string } | null;
}

export interface FollowUpOptOut {
  id: number; phone: string | null; phone_key: string; contact_name: string | null; deal_id: number | null;
  kind: 'hard' | 'soft' | 'manual'; reason: string | null; detected_text: string | null;
  created_at: string; created_by_label: string | null;
}

export interface ApproveAllRequest {
  generated_before: string; step?: FollowUpStep; track?: FollowUpTrack; stage_id?: string; ids?: number[]; exclude_ids?: number[]; include_blocked?: boolean;
}
export interface ApproveAllResult {
  approved: number; excluded: { conversation_changed: number; opted_out: number; stage_changed: number };
  sent_today: number; daily_cap: number; effective_cap: number; estimated_business_days: number;
}
export type RegenerateResult =
  | { status: 'updated' }
  | { status: 'ai_suggests_skip'; reason: string }
  | { status: 'conversation_changed' }
  | { status: 'limit' }
  | { status: 'invalid_status' }
  | { status: 'conflict' }
  | { status: 'consent_required' }
  | { status: 'error'; message: string; retryable: boolean };

export interface ForecastInput { id: number; contact_name: string | null; text: string; step: FollowUpStep; last_customer_at: string | null; phone: string;
  track?: FollowUpTrack }
export interface ForecastResult { id: number; channel: ChannelKind | 'blocked'; approval: CadenceApproval }

export interface FollowUpTemplateOption {
  id: number; name: string; language: string; status: string; category: string | null;
  eligible: boolean; reason: string | null; preview: string | null;
}

export interface DeliveryFailureInput {
  userId: string; waNumber: string; messageId: string; timestamp: string | null;
  errors: Array<{ code: number | null; title: string | null }>;
}

export type MoveReason = 'studio_reply' | 'quote_sent' | 'cadence_step' | 'backfill';
export interface MoveInput {
  userId: string; dealId: number; toStageId: string; expectedFromStage: string; reason: MoveReason;
  allowFrom?: string[]; actorId?: string | null; evidence?: Record<string, unknown>;
}
export type MoveResult = 'moved' | 'noop' | 'conflict' | 'refused';

export interface ReconcileItem {
  deal_id: number; title: string; from_stage: string; to_stage: string; reason: 'studio_reply' | 'quote_sent';
  evidence: { message_id: string; at: string; filename: string | null };
  fires_marketing_event: boolean;         // etapa destino tem mapeamento de anúncio ligado
}
export interface ReconcileCreateItem {
  phone: string; contact_name: string | null; first_inbound_at: string; last_inbound_at: string; inbound_count: number;
}
export interface ReconcilePreview {
  generated_at: string; scanned: number; to_contact: ReconcileItem[]; to_proposal: ReconcileItem[]; to_create: ReconcileCreateItem[];
}
export interface ReconcileApplyRequest { deal_ids?: number[]; create_phones?: string[]; include_marketing?: boolean }
export interface ReconcileApplyResult { moved: number; noop: number; conflicts: number; refused: number; created: number; skipped_marketing: number }

export interface FollowUpConfigResponse {
  config: FollowUpConfig; defaults: FollowUpConfig; exists: boolean;
  stages: Array<{ id: string; name: string; position: number; is_final: boolean; is_won: boolean }>;
  templates: FollowUpTemplateOption[];
  suggested: { ladder_stage_ids: string[]; step_delays_hours: number[]; after_last_stage_id: string | null;
               pre_quote_stage_ids: string[]; pre_quote_delays_hours: number[];
               entry_stage_id: string | null; contact_stage_id: string | null; proposal_stage_id: string | null };
  legacy_automation: Array<{ stage_id: string; stage_name: string }>;
  consent: { external_ai: boolean; at: string | null };
  dedupe_ready: boolean;
  can_edit: boolean;
}
export type FollowUpConfigPutRequest = Omit<Partial<FollowUpConfig>, 'tracker_config'> & {
  tracker_config?: Partial<TrackerConfig>; confirm_auto?: boolean; disable_legacy_on_ladder?: boolean; consent_to_external_ai?: boolean;
};
export interface FollowUpConfigPutResponse { config: FollowUpConfig; warnings: string[]; legacy_disabled: string[]; demoted_auto: number }

export type FollowUpErrorCode = 'MIGRATION_REQUIRED' | 'NOT_FOUND' | 'INVALID_STATUS' | 'ALREADY_CLAIMED'
  | 'CONVERSATION_CHANGED' | 'STAGE_CHANGED' | 'OPTED_OUT' | 'FOLLOWUPS_DISABLED' | 'SWEEP_RUNNING' | 'REGEN_RUNNING'
  | 'SWEEP_TOO_SOON' | 'REGEN_LIMIT' | 'TEXT_INVALID' | 'CONFIG_INVALID' | 'AUTO_CONFIRM_REQUIRED'
  | 'AI_CONSENT_REQUIRED' | 'FORBIDDEN' | 'AI_ERROR' | 'INTERNAL';
export interface FollowUpErrorBody { error: string; code: FollowUpErrorCode; fields?: Record<string, string> }

// Implementado por followup-runtime.ts (WP07); consumido por followup-routes.ts (WP08).
export interface FollowUpServices {
  runSweep(userId: string, req: SweepRequest): Promise<SweepSummary>;     // lança Error('SWEEP_RUNNING') ou Error('AI_CONSENT_REQUIRED')
  countEligible(userId: string, req: SweepRequest): Promise<SweepDryRun>;
  regenerate(userId: string, taskId: number, opts: { instruction?: string; force?: boolean; actorId: string }): Promise<RegenerateResult>;
  kickSender(userId: string): void;
  channelHealth(userId: string, config: FollowUpConfig): Promise<ChannelHealth>;
  forecast(userId: string, config: FollowUpConfig, items: ForecastInput[]): Promise<ForecastResult[]>;
  listTemplates(userId: string): Promise<FollowUpTemplateOption[]>;
  dedupeReady(userId: string): Promise<boolean>;
  businessWindow(config: FollowUpConfig, now: Date): { open: boolean; next_open_at: string | null };
  sweepState(userId: string): SweepState;
  invalidateConfig(userId: string): void;
  recordDeliveryFailure(input: DeliveryFailureInput): Promise<void>;
  reconcilePreview(userId: string, opts: { limit?: number; days?: number }): Promise<ReconcilePreview>;
  reconcileApply(userId: string, req: ReconcileApplyRequest, actorId: string): Promise<ReconcileApplyResult>;
}

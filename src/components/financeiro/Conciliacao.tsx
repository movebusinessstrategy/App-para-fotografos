import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle, ArrowDownLeft, ArrowLeft, ArrowRight, ArrowRightLeft,
  ArrowUpRight, Check, FileText, History, Landmark, Link2, Plus, RefreshCw,
  Search, ShieldCheck, Sparkles, Undo2, Upload, X,
} from 'lucide-react';
import { authFetch } from '../../utils/authFetch';
import { fmtBRL, fmtDate } from './finUtils';
import { FinSelect } from './FinInputs';

type TransactionStatus = 'pendente' | 'sugerido' | 'conciliado' | 'transferencia' | 'ignorado';
type FilterStatus = 'revisar' | 'todas' | TransactionStatus;

interface Conta {
  id: string;
  nome: string;
  banco?: string | null;
}

interface Candidate {
  id: string;
  tipo?: string;
  descricao?: string;
  cliente_nome?: string;
  valor?: number | string;
  valor_liquido?: number | string;
  valor_bruto?: number | string;
  data?: string;
  data_pagamento?: string;
  data_recebimento_real?: string;
  data_vencimento?: string;
  status?: string;
  score?: number | string;
  confianca?: number | string;
  motivos?: string[] | string;
  job_nome?: string;
}

interface ProcessorReceipt {
  id: string;
  cliente_nome?: string;
  descricao?: string;
  job_nome?: string;
  valor_liquido: number;
  data_recebimento_real?: string;
}

interface ProcessorCandidateSet {
  receiptIds: string[];
  totalAmount: number;
  maxDateDistanceDays?: number;
  receipts: ProcessorReceipt[];
  reasons: string[];
}

interface ProcessorSettlement {
  status: string;
  reason: string;
  candidateSets: ProcessorCandidateSet[];
  eligibleReceipts: ProcessorReceipt[];
  consideredCandidateCount: number;
  truncated: boolean;
}

interface TransferCandidate {
  id: string;
  conta_id?: string;
  conta_nome?: string;
  data?: string;
  descricao?: string;
  valor: number;
  tipo?: 'credito' | 'debito';
  score?: number;
  motivos: string[];
}

interface TransferCandidatePayload {
  supported: boolean;
  candidates: TransferCandidate[];
}

interface Transacao {
  id: string;
  fit_id?: string;
  fingerprint?: string;
  conta_id?: string;
  conta_nome?: string;
  data: string;
  descricao?: string;
  valor: number | string;
  tipo: 'credito' | 'debito';
  conciliado?: boolean;
  status?: string;
  status_conciliacao?: string;
  receita_id?: string | null;
  despesa_id?: string | null;
  origem?: string;
  cliente_nome?: string;
  lancamento_descricao?: string;
  clientes_resumo?: string | null;
  recebimentos?: ProcessorReceipt[];
  sugestao_id?: string | null;
  sugestao_tipo?: string | null;
  sugestao_score?: number | string | null;
  sugestao_confianca?: number | string | null;
  sugestao_motivos?: string[] | string | null;
  sugestao?: Candidate | null;
  contraparte_sugerida_id?: string | null;
}

interface Summary {
  entradas?: number | string;
  saidas?: number | string;
  total?: number | string;
  a_revisar?: number | string;
  valor_a_revisar?: number | string;
  pendentes?: number | string;
  sugeridas?: number | string;
  conciliadas?: number | string;
  transferencias?: number | string;
  ignoradas?: number | string;
}

interface StatementBalance {
  valor?: number | string;
  saldo_final?: number | string;
  data?: string;
}

interface ListPayload {
  transacoes: Transacao[];
  resumo: Summary | null;
  saldo_extrato: StatementBalance | number | string | null;
}

interface LegacyCorrectionSummary {
  reassociar: number;
  conciliadas_preservadas: number;
  snapshots_saldo_arquivar: number;
  inserir_faltantes: number;
  legadas_preservadas: number;
}

interface LegacyCorrectionAccount {
  id?: string;
  nome?: string;
  banco?: string;
  banco_detectado?: string;
  conta_detectada?: string;
}

interface LegacyCorrectionPlan {
  correcao_necessaria: boolean;
  pode_corrigir: boolean;
  preview_token: string;
  conta_destino: LegacyCorrectionAccount | null;
  contas_origem: LegacyCorrectionAccount[];
  resumo: LegacyCorrectionSummary;
  bloqueios: string[];
  avisos: string[];
}

interface PreviewPayload extends ListPayload {
  periodo?: { inicio?: string; fim?: string } | null;
  banco_detectado?: string | null;
  conta_detectada?: string | null;
  avisos?: string[];
  bloqueado?: boolean;
  confirmacao_conta_necessaria?: boolean;
  rejeitadas?: unknown[];
  nome_arquivo?: string;
  correcao_legado?: LegacyCorrectionPlan | null;
}

interface ImportBatchSummary {
  total: number;
  ativas: number;
  revertidas: number;
  reversiveis: number;
  bloqueadas: number;
  balance_snapshots: number;
  valor_balance_snapshots: number;
  movimentos_reais: number;
  entradas_reais: number;
  saidas_reais: number;
}

interface ImportBatch {
  id: string;
  conta_id: string;
  nome_arquivo: string;
  banco_codigo?: string;
  conta_ref?: string;
  data_inicio?: string;
  data_fim?: string;
  created_at?: string;
  status?: string;
  erro?: string;
  total_transacoes: number;
  total_creditos: number;
  total_debitos: number;
  resumo_rollback: ImportBatchSummary;
  conta_legada_nao_confirmada: boolean;
}

interface ImportHistoryPagination {
  page: number;
  pageSize: number;
  total: number;
}

interface RollbackTransaction {
  id: string;
  status?: string;
  tipo?: string;
  valor: number;
  data?: string;
  descricao?: string;
  balance_snapshot: boolean;
  revertida: boolean;
  bloqueada: boolean;
  motivo_bloqueio?: string;
}

interface RollbackPreview {
  lote: ImportBatch;
  preview_token: string;
  resumo: ImportBatchSummary;
  avisos: string[];
  transacoes_bloqueadas: RollbackTransaction[];
  amostra_reversiveis: RollbackTransaction[];
  conta_legada_nao_confirmada: boolean;
}

interface ImportResult {
  importadas?: number;
  duplicadas?: number;
  conciliadas?: number;
  sugeridas?: number;
  ignoradas_saldo?: number;
  total?: number;
  erros?: number;
}

interface Notice {
  kind: 'success' | 'error';
  text: string;
}

interface TransactionRequestContext {
  transactionId: string;
  scope: string;
}

interface BatchRequestContext {
  batchId: string;
  accountId: string;
}

class FinancialRequestError extends Error {
  code: string;
  status: number;
  payload: Record<string, unknown>;

  constructor(message: string, code: string, status: number, payload: Record<string, unknown>) {
    super(message);
    this.name = 'FinancialRequestError';
    this.code = code;
    this.status = status;
    this.payload = payload;
  }
}

const PAGE_SIZE = 50;
const BASE64_CHUNK_SIZE = 32_768;
const MAX_OFX_FILE_SIZE = 10 * 1024 * 1024;

const FINANCIAL_ERROR_MESSAGES: Record<string, string> = {
  ACCOUNT_BINDING_CONFIRMATION_REQUIRED: 'Confirme o banco e a conta identificados no arquivo antes de importar este primeiro extrato.',
  ACCOUNT_IDENTITY_CONFLICT: 'Esta conta tem identificações bancárias conflitantes no histórico. Revise o cadastro antes de importar outro extrato.',
  ACCOUNT_MISMATCH: 'Este OFX pertence a outra conta. Selecione a conta bancária correspondente e gere uma nova prévia.',
  FITID_COLLISION: 'O banco reutilizou o identificador de uma movimentação diferente. Nada foi sobrescrito; exporte um novo OFX ou revise o arquivo com o banco.',
  LEGACY_ACCOUNT_CORRECTION_BLOCKED: 'Há vínculos no histórico que impedem a correção automática de conta. Nada foi movido; revise os bloqueios exibidos.',
  LEGACY_ACCOUNT_CORRECTION_CONFIRMATION_REQUIRED: 'Revise e confirme o plano de correção Itaú/Nubank antes de importar este extrato.',
  LEGACY_ACCOUNT_CORRECTION_PREVIEW_STALE: 'O histórico mudou desde a prévia. Confira o plano atualizado antes de confirmar novamente.',
  MIGRATION_NEEDED: 'A conciliação ainda não está pronta neste ambiente. Conclua a atualização do módulo financeiro antes de importar.',
  OFX_ACCOUNT_IDENTITY_MISSING: 'Este arquivo não informa banco nem número da conta. Exporte no banco um OFX identificado para evitar misturar contas.',
  OFX_MULTIPLE_ACCOUNTS: 'Este arquivo reúne mais de uma conta. Exporte e importe um OFX separado para cada conta bancária.',
  OFX_REJECTED_TRANSACTIONS: 'O arquivo contém movimentações inválidas. Exporte o OFX novamente no banco antes de importar.',
  ROLLBACK_CONFIRMATION_REQUIRED: 'Abra a prévia do lote e confirme a versão exibida antes de desfazer a importação.',
  ROLLBACK_PREVIEW_STALE: 'Os vínculos deste lote mudaram. A prévia foi atualizada; confira os números antes de confirmar novamente.',
};

const STATUS_META: Record<TransactionStatus, { label: string; className: string }> = {
  pendente: {
    label: 'Pendente',
    className: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-800',
  },
  sugerido: {
    label: 'Sugestão pronta',
    className: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-300 dark:border-blue-800',
  },
  conciliado: {
    label: 'Conciliado',
    className: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-300 dark:border-emerald-800',
  },
  transferencia: {
    label: 'Transferência',
    className: 'bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-900/20 dark:text-violet-300 dark:border-violet-800',
  },
  ignorado: {
    label: 'Ignorado',
    className: 'bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-700/60 dark:text-gray-300 dark:border-gray-600',
  },
};

const FILTERS: Array<{ value: FilterStatus; label: string }> = [
  { value: 'revisar', label: 'A revisar' },
  { value: 'sugerido', label: 'Sugestões' },
  { value: 'conciliado', label: 'Conciliadas' },
  { value: 'transferencia', label: 'Transferências' },
  { value: 'ignorado', label: 'Ignoradas' },
  { value: 'todas', label: 'Todas' },
];

function inputDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function initialPeriod() {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 89);
  return { from: inputDate(start), to: inputDate(end) };
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK_SIZE) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + BASE64_CHUNK_SIZE));
  }
  return btoa(binary);
}

function readNumber(source: Record<string, unknown> | null | undefined, keys: string[], fallback = 0) {
  for (const key of keys) {
    const value = Number(source?.[key]);
    if (Number.isFinite(value)) return value;
  }
  return fallback;
}

function readText(source: Record<string, unknown> | null | undefined, keys: string[]) {
  for (const key of keys) {
    const value = source?.[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return '';
}

function transactionStatus(transaction: Transacao): TransactionStatus {
  const raw = transaction.status_conciliacao || transaction.status;
  if (raw && Object.prototype.hasOwnProperty.call(STATUS_META, raw)) return raw as TransactionStatus;
  return transaction.conciliado ? 'conciliado' : 'pendente';
}

function needsReview(transaction: Transacao) {
  const status = transactionStatus(transaction);
  return status === 'pendente' || status === 'sugerido';
}

function transactionValue(transaction: Transacao) {
  const value = Number(transaction.valor);
  return Number.isFinite(value) ? value : 0;
}

function candidateValue(candidate: Candidate) {
  return readNumber(candidate as unknown as Record<string, unknown>, ['valor', 'valor_liquido', 'valor_bruto']);
}

function candidateDate(candidate: Candidate) {
  return readText(candidate as unknown as Record<string, unknown>, [
    'data', 'data_recebimento_real', 'data_pagamento', 'data_vencimento',
  ]);
}

function reasons(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === 'string') return value.split(/[;|]/).map(item => item.trim()).filter(Boolean);
  return [];
}

const REASON_LABELS: Record<string, string> = {
  valor_exato: 'Mesmo valor',
  mesma_data: 'Mesma data',
  data_proxima: 'Data próxima',
  nome_compativel: 'Nome compatível',
  conta_compativel: 'Conta compatível',
  valor_liquido_exato: 'Soma líquida exata',
  multiple_sets: 'Mais de um grupo possível',
  candidate_limit: 'Muitos recebimentos no período',
  search_limit: 'Muitas combinações possíveis',
  repasse_infinitepay: 'Repasse da InfinitePay',
  unique_set: 'Grupo com valor correspondente',
  no_exact_set: 'Nenhum grupo fecha o valor',
  invalid_credit: 'Crédito bancário inválido',
};

function reasonLabel(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return '';
  if (REASON_LABELS[normalized]) return REASON_LABELS[normalized];
  if (!normalized.includes('_')) return value;
  const readable = normalized.replaceAll('_', ' ');
  return `${readable.charAt(0).toUpperCase()}${readable.slice(1)}`;
}

function moneyCents(value: unknown) {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
}

function normalizedConfidence(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const percentage = number <= 1 ? number * 100 : number;
  return Math.max(0, Math.min(100, Math.round(percentage)));
}

function transactionConfidence(transaction: Transacao) {
  const value = transaction.sugestao_score ?? transaction.sugestao_confianca
    ?? transaction.sugestao?.score ?? transaction.sugestao?.confianca;
  return normalizedConfidence(value);
}

function suggestionId(transaction: Transacao) {
  return transaction.sugestao_id || transaction.sugestao?.id || null;
}

function suggestionType(transaction: Transacao) {
  return transaction.sugestao_tipo || transaction.sugestao?.tipo
    || (transaction.tipo === 'credito' ? 'receita' : 'despesa');
}

function firstArray(source: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    if (Array.isArray(source[key])) return source[key] as unknown[];
  }
  return [];
}

function normalizeProcessorReceipt(value: unknown): ProcessorReceipt | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  const id = readText(source, ['id', 'receita_id', 'receiptId', 'receipt_id']);
  if (!id) return null;
  return {
    id,
    cliente_nome: readText(source, ['cliente_nome', 'clientName', 'cliente', 'name']) || undefined,
    descricao: readText(source, ['descricao', 'description']) || undefined,
    job_nome: readText(source, ['job_nome', 'jobName']) || undefined,
    valor_liquido: readNumber(source, ['valor_liquido', 'netAmount', 'valor', 'amount']),
    data_recebimento_real: readText(source, [
      'data_recebimento_real', 'expectedDate', 'data', 'date',
    ]) || undefined,
  };
}

function uniqueProcessorReceipts(receipts: ProcessorReceipt[]) {
  return [...new Map(receipts.map(receipt => [receipt.id, receipt])).values()];
}

function normalizeReceiptIds(source: Record<string, unknown>, receipts: ProcessorReceipt[]) {
  const values = firstArray(source, ['receiptIds', 'receipt_ids', 'recebimento_ids', 'receita_ids']);
  const ids = values.map(String).filter(Boolean);
  return ids.length ? [...new Set(ids)] : receipts.map(receipt => receipt.id);
}

function normalizeProcessorCandidateSet(
  value: unknown,
  eligibleById: Map<string, ProcessorReceipt>,
): ProcessorCandidateSet | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  const embedded = firstArray(source, ['receipts', 'recebimentos', 'receiptDetails', 'receipt_details'])
    .map(normalizeProcessorReceipt)
    .filter((receipt): receipt is ProcessorReceipt => Boolean(receipt));
  const receiptIds = normalizeReceiptIds(source, embedded);
  if (!receiptIds.length) return null;
  const embeddedById = new Map(embedded.map(receipt => [receipt.id, receipt]));
  const receipts = receiptIds
    .map(id => embeddedById.get(id) || eligibleById.get(id))
    .filter((receipt): receipt is ProcessorReceipt => Boolean(receipt));
  const calculatedTotal = receipts.reduce((sum, receipt) => sum + receipt.valor_liquido, 0);
  return {
    receiptIds,
    receipts,
    totalAmount: readNumber(source, ['totalAmount', 'total_amount', 'total', 'valor_total', 'soma'], calculatedTotal),
    maxDateDistanceDays: readNumber(
      source,
      ['maxDateDistanceDays', 'max_date_distance_days', 'distancia_maxima_dias'],
      Number.NaN,
    ),
    reasons: reasons(source.motivos ?? source.reasons),
  };
}

function normalizeProcessorSettlement(value: unknown): ProcessorSettlement | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  const eligible = firstArray(source, [
    'eligibleReceipts', 'eligible_receipts', 'recebimentos_elegiveis', 'receitas_elegiveis',
  ]).map(normalizeProcessorReceipt).filter((receipt): receipt is ProcessorReceipt => Boolean(receipt));
  const eligibleById = new Map(eligible.map(receipt => [receipt.id, receipt]));
  const candidateSets = firstArray(source, ['candidateSets', 'candidate_sets', 'grupos_candidatos'])
    .map(item => normalizeProcessorCandidateSet(item, eligibleById))
    .filter((item): item is ProcessorCandidateSet => Boolean(item));
  const embeddedReceipts = candidateSets.flatMap(candidateSet => candidateSet.receipts);
  return {
    status: readText(source, ['status']),
    reason: readText(source, ['reason', 'motivo']),
    candidateSets,
    eligibleReceipts: uniqueProcessorReceipts([...eligible, ...embeddedReceipts]),
    consideredCandidateCount: readNumber(source, [
      'consideredCandidateCount', 'considered_candidate_count', 'quantidade_considerada',
      'recebimentos_elegiveis_total',
    ]),
    truncated: source.truncated === true
      || source.truncado === true
      || source.recebimentos_elegiveis_truncados === true,
  };
}

function normalizeTransferCandidate(value: unknown): TransferCandidate | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  const id = readText(source, ['id', 'transacao_id', 'transactionId', 'transaction_id']);
  if (!id) return null;
  const type = readText(source, ['tipo', 'type']);
  return {
    id,
    conta_id: readText(source, ['conta_id', 'accountId', 'account_id']) || undefined,
    conta_nome: readText(source, ['conta_nome', 'accountName', 'account_name']) || undefined,
    data: readText(source, ['data', 'date']) || undefined,
    descricao: readText(source, ['descricao', 'description']) || undefined,
    valor: readNumber(source, ['valor', 'amount']),
    tipo: type === 'credito' || type === 'debito' ? type : undefined,
    score: readNumber(source, ['score', 'confianca'], Number.NaN),
    motivos: reasons(source.motivos ?? source.reasons),
  };
}

function normalizeTransferCandidates(payload: unknown): TransferCandidatePayload {
  if (!payload || typeof payload !== 'object') return { supported: false, candidates: [] };
  const data = payload as Record<string, unknown>;
  const decision = data.decisao && typeof data.decisao === 'object'
    ? data.decisao as Record<string, unknown>
    : {};
  const keys = ['transferencias_candidatas', 'transferCandidates', 'transfer_candidates'];
  const owner = keys.some(key => Object.prototype.hasOwnProperty.call(data, key)) ? data : decision;
  const supported = keys.some(key => Object.prototype.hasOwnProperty.call(owner, key));
  const candidates = firstArray(owner, keys)
    .map(normalizeTransferCandidate)
    .filter((candidate): candidate is TransferCandidate => Boolean(candidate));
  return { supported, candidates };
}

function normalizeListPayload(payload: unknown): ListPayload {
  if (Array.isArray(payload)) return { transacoes: payload, resumo: null, saldo_extrato: null };
  const data = (payload || {}) as Record<string, unknown>;
  return {
    transacoes: Array.isArray(data.transacoes) ? data.transacoes as Transacao[] : [],
    resumo: data.resumo && typeof data.resumo === 'object' ? data.resumo as Summary : null,
    saldo_extrato: data.saldo_extrato as ListPayload['saldo_extrato'] ?? null,
  };
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function normalizeLegacyCorrectionAccount(value: unknown): LegacyCorrectionAccount | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  return {
    id: readText(source, ['id']) || undefined,
    nome: readText(source, ['nome']) || undefined,
    banco: readText(source, ['banco']) || undefined,
    banco_detectado: readText(source, ['banco_detectado']) || undefined,
    conta_detectada: readText(source, ['conta_detectada']) || undefined,
  };
}

function normalizeLegacyCorrectionPlan(value: unknown): LegacyCorrectionPlan | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  const summary = source.resumo && typeof source.resumo === 'object'
    ? source.resumo as Record<string, unknown>
    : {};
  return {
    correcao_necessaria: source.correcao_necessaria === true,
    pode_corrigir: source.pode_corrigir === true,
    preview_token: readText(source, ['preview_token']),
    conta_destino: normalizeLegacyCorrectionAccount(source.conta_destino),
    contas_origem: firstArray(source, ['contas_origem'])
      .map(normalizeLegacyCorrectionAccount)
      .filter((account): account is LegacyCorrectionAccount => Boolean(account)),
    resumo: {
      reassociar: readNumber(summary, ['reassociar']),
      conciliadas_preservadas: readNumber(summary, ['conciliadas_preservadas']),
      snapshots_saldo_arquivar: readNumber(summary, ['snapshots_saldo_arquivar']),
      inserir_faltantes: readNumber(summary, ['inserir_faltantes']),
      legadas_preservadas: readNumber(summary, ['legadas_preservadas']),
    },
    bloqueios: stringArray(source.bloqueios),
    avisos: stringArray(source.avisos),
  };
}

function normalizeImportBatchSummary(value: unknown): ImportBatchSummary {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    total: readNumber(source, ['total']),
    ativas: readNumber(source, ['ativas']),
    revertidas: readNumber(source, ['revertidas', 'reverted']),
    reversiveis: readNumber(source, ['reversiveis']),
    bloqueadas: readNumber(source, ['bloqueadas', 'blocked']),
    balance_snapshots: readNumber(source, ['balance_snapshots']),
    valor_balance_snapshots: readNumber(source, ['valor_balance_snapshots']),
    movimentos_reais: readNumber(source, ['movimentos_reais']),
    entradas_reais: readNumber(source, ['entradas_reais']),
    saidas_reais: readNumber(source, ['saidas_reais']),
  };
}

function normalizeImportBatch(value: unknown, summaryOverride?: ImportBatchSummary): ImportBatch | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  const id = readText(source, ['id']);
  if (!id) return null;
  const summary = summaryOverride || normalizeImportBatchSummary(source.resumo_rollback);
  return {
    id,
    conta_id: readText(source, ['conta_id']),
    nome_arquivo: readText(source, ['nome_arquivo']) || 'Arquivo OFX',
    banco_codigo: readText(source, ['banco_codigo']) || undefined,
    conta_ref: readText(source, ['conta_ref']) || undefined,
    data_inicio: readText(source, ['data_inicio']) || undefined,
    data_fim: readText(source, ['data_fim']) || undefined,
    created_at: readText(source, ['created_at']) || undefined,
    status: readText(source, ['status']) || undefined,
    erro: readText(source, ['erro']) || undefined,
    total_transacoes: readNumber(source, ['total_transacoes'], summary.total),
    total_creditos: readNumber(source, ['total_creditos']),
    total_debitos: readNumber(source, ['total_debitos']),
    resumo_rollback: summary,
    conta_legada_nao_confirmada: source.conta_legada_nao_confirmada === true,
  };
}

function normalizeRollbackTransaction(value: unknown): RollbackTransaction | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  const id = readText(source, ['id']);
  if (!id) return null;
  return {
    id,
    status: readText(source, ['status']) || undefined,
    tipo: readText(source, ['tipo']) || undefined,
    valor: readNumber(source, ['valor']),
    data: readText(source, ['data']) || undefined,
    descricao: readText(source, ['descricao']) || undefined,
    balance_snapshot: source.balance_snapshot === true,
    revertida: source.revertida === true,
    bloqueada: source.bloqueada === true,
    motivo_bloqueio: readText(source, ['motivo_bloqueio']) || undefined,
  };
}

function normalizeRollbackPreview(value: unknown): RollbackPreview | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  const summary = normalizeImportBatchSummary(source.resumo);
  const batch = normalizeImportBatch(source.lote, summary);
  const previewToken = readText(source, ['preview_token']);
  if (!batch || !previewToken) return null;
  return {
    lote: batch,
    preview_token: previewToken,
    resumo: summary,
    avisos: stringArray(source.avisos),
    transacoes_bloqueadas: firstArray(source, ['transacoes_bloqueadas', 'bloqueios'])
      .map(normalizeRollbackTransaction)
      .filter((transaction): transaction is RollbackTransaction => Boolean(transaction)),
    amostra_reversiveis: firstArray(source, ['amostra_reversiveis'])
      .map(normalizeRollbackTransaction)
      .filter((transaction): transaction is RollbackTransaction => Boolean(transaction)),
    conta_legada_nao_confirmada: source.conta_legada_nao_confirmada === true,
  };
}

function normalizeImportHistory(value: unknown) {
  if (!value || typeof value !== 'object') {
    return { batches: [], pagination: { page: 1, pageSize: 25, total: 0 } };
  }
  const source = value as Record<string, unknown>;
  const pagination = source.paginacao && typeof source.paginacao === 'object'
    ? source.paginacao as Record<string, unknown>
    : {};
  const batches = firstArray(source, ['importacoes'])
    .map(item => normalizeImportBatch(item))
    .filter((batch): batch is ImportBatch => Boolean(batch));
  return {
    batches,
    pagination: {
      page: Math.max(1, readNumber(pagination, ['pagina'], 1)),
      pageSize: Math.max(1, readNumber(pagination, ['por_pagina'], 25)),
      total: Math.max(batches.length, readNumber(pagination, ['total'], batches.length)),
    },
  };
}

function normalizePreviewPayload(payload: unknown, fileName: string): PreviewPayload {
  const base = normalizeListPayload(payload);
  const data = (payload || {}) as Record<string, unknown>;
  return {
    ...base,
    periodo: data.periodo && typeof data.periodo === 'object' ? data.periodo as PreviewPayload['periodo'] : null,
    banco_detectado: typeof data.banco_detectado === 'string' ? data.banco_detectado : null,
    conta_detectada: typeof data.conta_detectada === 'string' ? data.conta_detectada : null,
    avisos: Array.isArray(data.avisos) ? data.avisos.map(String) : [],
    bloqueado: data.bloqueado === true,
    confirmacao_conta_necessaria: data.confirmacao_conta_necessaria === true,
    rejeitadas: Array.isArray(data.rejeitadas) ? data.rejeitadas : [],
    nome_arquivo: fileName,
    correcao_legado: normalizeLegacyCorrectionPlan(data.correcao_legado),
  };
}

function financialScope(accountId: string, from: string, to: string) {
  return `${accountId}\u0000${from}\u0000${to}`;
}

function requestIsCurrent(
  requestId: number,
  currentRequestId: number,
  controller: AbortController,
  scope: string,
  currentScope: string,
) {
  return !controller.signal.aborted
    && requestId === currentRequestId
    && scope === currentScope;
}

function transactionContextMatches(
  context: TransactionRequestContext | null,
  transactionId: string,
  scope: string,
): context is TransactionRequestContext {
  return context?.transactionId === transactionId && context.scope === scope;
}

function batchContextMatches(
  context: BatchRequestContext | null,
  batchId: string,
  accountId: string,
): context is BatchRequestContext {
  return context?.batchId === batchId && context.accountId === accountId;
}

function batchRequestIsCurrent(
  requestId: number,
  currentRequestId: number,
  controller: AbortController,
  context: BatchRequestContext | null,
  batchId: string,
  accountId: string,
  currentAccountId: string,
) {
  return !controller.signal.aborted
    && requestId === currentRequestId
    && accountId === currentAccountId
    && batchContextMatches(context, batchId, accountId);
}

function isAbortError(error: unknown) {
  return error instanceof DOMException
    ? error.name === 'AbortError'
    : error instanceof Error && error.name === 'AbortError';
}

function humanizeFinancialError(error: unknown, fallback: string) {
  if (error instanceof FinancialRequestError) {
    return FINANCIAL_ERROR_MESSAGES[error.code] || error.message || fallback;
  }
  return error instanceof Error && error.message ? error.message : fallback;
}

function previewBlockingMessage(preview: PreviewPayload) {
  if (preview.rejeitadas?.length) {
    return 'O OFX contém movimentações inválidas e não pode ser importado. Exporte um novo arquivo no banco.';
  }
  if (!preview.banco_detectado && !preview.conta_detectada) {
    return 'O OFX não identifica banco nem conta. Exporte um arquivo identificado para evitar misturar extratos.';
  }
  return 'A conta identificada no OFX não corresponde à conta selecionada. Escolha a conta correta e gere uma nova prévia.';
}

function correctionConfirmationError(preview: PreviewPayload, confirmed: boolean) {
  const plan = preview.correcao_legado;
  if (!plan?.correcao_necessaria) return null;
  if (correctionPlanBlocked(plan)) {
    return 'Este histórico tem vínculos que impedem a correção automática. Nada foi movido; revise os bloqueios do plano.';
  }
  if (!plan.preview_token) return 'A prévia do plano não tem uma versão válida. Gere a prévia do OFX novamente.';
  if (!confirmed) return 'Confirme o plano de correção de conta antes de importar.';
  return null;
}

function correctionConfirmationBody(preview: PreviewPayload) {
  const plan = preview.correcao_legado;
  if (!plan?.correcao_necessaria) return {};
  return {
    confirmar_correcao_legado: true,
    correcao_preview_token: plan.preview_token,
  };
}

function refreshedPreviewFromImportError(error: unknown, fileName: string) {
  if (!(error instanceof FinancialRequestError)) return null;
  if (error.code !== 'LEGACY_ACCOUNT_CORRECTION_PREVIEW_STALE') return null;
  return normalizePreviewPayload(error.payload, fileName);
}

function refreshedRollbackPreviewFromError(error: unknown) {
  if (!(error instanceof FinancialRequestError)) return null;
  if (error.code !== 'ROLLBACK_PREVIEW_STALE') return null;
  return normalizeRollbackPreview(error.payload.preview);
}

function transactionReceipts(transaction: Transacao) {
  return Array.isArray(transaction.recebimentos) ? transaction.recebimentos : [];
}

function transactionClientsSummary(transaction: Transacao) {
  if (transaction.clientes_resumo?.trim()) return transaction.clientes_resumo.trim();
  const names = transactionReceipts(transaction)
    .map(receipt => receipt.cliente_nome?.trim())
    .filter((name): name is string => Boolean(name));
  return [...new Set(names)].join(', ');
}

function transactionSearchContent(transaction: Transacao) {
  const receiptContent = transactionReceipts(transaction)
    .flatMap(receipt => [receipt.cliente_nome, receipt.descricao, receipt.job_nome]);
  return [
    transaction.descricao,
    transaction.cliente_nome,
    transaction.lancamento_descricao,
    transaction.clientes_resumo,
    ...receiptContent,
  ].filter(Boolean).join(' ').toLowerCase();
}

function statementBalanceValue(balance: ListPayload['saldo_extrato']) {
  if (typeof balance === 'number' || typeof balance === 'string') {
    const value = Number(balance);
    return Number.isFinite(value) ? value : null;
  }
  if (!balance) return null;
  const value = readNumber(balance as Record<string, unknown>, ['valor', 'saldo_final'], Number.NaN);
  return Number.isFinite(value) ? value : null;
}

function statementBalanceDate(balance: ListPayload['saldo_extrato']) {
  if (!balance || typeof balance !== 'object') return '';
  return readText(balance as Record<string, unknown>, ['data']);
}

function summarize(transactions: Transacao[], summary: Summary | null, balance: ListPayload['saldo_extrato']) {
  const computedEntries = transactions.filter(item => item.tipo === 'credito').reduce((sum, item) => sum + transactionValue(item), 0);
  const computedExits = transactions.filter(item => item.tipo === 'debito').reduce((sum, item) => sum + transactionValue(item), 0);
  const reviewItems = transactions.filter(needsReview);
  const reviewValue = reviewItems.reduce((sum, item) => sum + transactionValue(item), 0);
  const summaryRecord = summary as unknown as Record<string, unknown> | null;
  const entries = summary ? readNumber(summaryRecord, ['entradas', 'creditos'], computedEntries) : computedEntries;
  const exits = summary ? readNumber(summaryRecord, ['saidas', 'debitos'], computedExits) : computedExits;
  const reviewCount = summary ? readNumber(summaryRecord, ['a_revisar', 'pendentes'], reviewItems.length) : reviewItems.length;
  const reviewAmount = summary ? readNumber(summaryRecord, ['valor_a_revisar'], reviewValue) : reviewValue;
  return { entries, exits, reviewCount, reviewAmount, balance: statementBalanceValue(balance) };
}

async function requestJson(url: string, init?: RequestInit) {
  const response = await authFetch(url, init);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const payload = data && typeof data === 'object' ? data as Record<string, unknown> : {};
    const code = typeof payload.error === 'string' ? payload.error : '';
    const message = typeof payload.message === 'string'
      ? payload.message
      : code && !/^[A-Z][A-Z0-9_]+$/.test(code)
        ? code
        : `Não foi possível concluir (erro ${response.status}).`;
    throw new FinancialRequestError(message, code, response.status, payload);
  }
  return data;
}

function reconcileBody(transaction: Transacao, id: string, type?: string | null) {
  const normalizedType = String(type || '').toLowerCase();
  if (normalizedType.includes('desp') || transaction.tipo === 'debito') {
    return { transacao_id: transaction.id, despesa_id: id };
  }
  return { transacao_id: transaction.id, receita_id: id };
}

function StatusBadge({ transaction }: { transaction: Transacao }) {
  const status = transactionStatus(transaction);
  const meta = STATUS_META[status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${meta.className}`}>
      {status === 'conciliado' && <Check className="h-3 w-3" />}
      {status === 'sugerido' && <Sparkles className="h-3 w-3" />}
      {status === 'transferencia' && <ArrowRightLeft className="h-3 w-3" />}
      {meta.label}
    </span>
  );
}

function Confidence({ value }: { value: number | null }) {
  if (value === null) return null;
  const tone = value >= 90
    ? 'text-emerald-700 bg-emerald-50 dark:text-emerald-300 dark:bg-emerald-900/20'
    : 'text-blue-700 bg-blue-50 dark:text-blue-300 dark:bg-blue-900/20';
  return <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${tone}`}>{value}% confiança</span>;
}

function Metric({ label, value, detail, tone = 'neutral' }: {
  label: string;
  value: string;
  detail?: string;
  tone?: 'neutral' | 'positive' | 'negative' | 'attention';
}) {
  const valueClass = {
    neutral: 'text-gray-900 dark:text-white',
    positive: 'text-emerald-700 dark:text-emerald-400',
    negative: 'text-rose-700 dark:text-rose-400',
    attention: 'text-amber-700 dark:text-amber-400',
  }[tone];
  return (
    <div className="min-w-0 px-4 py-4 md:px-5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-400 dark:text-gray-500">{label}</p>
      <p className={`mt-1 truncate text-lg font-semibold ${valueClass}`}>{value}</p>
      {detail && <p className="mt-0.5 truncate text-xs text-gray-400 dark:text-gray-500">{detail}</p>}
    </div>
  );
}

function legacyAccountLabel(account: LegacyCorrectionAccount) {
  const identity = [account.nome, account.banco].filter(Boolean).join(' · ');
  return identity || account.id || 'Conta anterior';
}

function correctionPlanBlocked(plan: LegacyCorrectionPlan | null | undefined) {
  return Boolean(plan?.correcao_necessaria && (!plan.pode_corrigir || plan.bloqueios.length));
}

function LegacyCorrectionPanel({ plan, accountName, confirmed, disabled, onConfirmed }: {
  plan: LegacyCorrectionPlan;
  accountName: string;
  confirmed: boolean;
  disabled: boolean;
  onConfirmed: (confirmed: boolean) => void;
}) {
  if (!plan.correcao_necessaria) return null;
  const blocked = correctionPlanBlocked(plan);
  const sourceAccounts = plan.contas_origem.map(legacyAccountLabel).join(', ') || 'outra conta do histórico';
  const destination = plan.conta_destino ? legacyAccountLabel(plan.conta_destino) : accountName;
  const summaryItems = [
    { label: 'Mover para a conta certa', value: plan.resumo.reassociar },
    { label: 'Preservar conciliações', value: plan.resumo.conciliadas_preservadas },
    { label: 'Arquivar fotos de saldo', value: plan.resumo.snapshots_saldo_arquivar },
    { label: 'Inserir faltantes', value: plan.resumo.inserir_faltantes },
  ];

  return (
    <div className={`mt-3 rounded-xl border px-4 py-4 ${blocked
      ? 'border-rose-200 bg-rose-50 dark:border-rose-800 dark:bg-rose-900/20'
      : 'border-violet-200 bg-violet-50 dark:border-violet-800 dark:bg-violet-900/20'}`}>
      <div className="flex items-start gap-2">
        <ArrowRightLeft className={`mt-0.5 h-4 w-4 shrink-0 ${blocked ? 'text-rose-600' : 'text-violet-600'}`} />
        <div>
          <p className={`text-sm font-semibold ${blocked ? 'text-rose-900 dark:text-rose-200' : 'text-violet-900 dark:text-violet-200'}`}>
            Correção auditável de conta necessária
          </p>
          <p className={`mt-1 text-xs leading-relaxed ${blocked ? 'text-rose-800 dark:text-rose-300' : 'text-violet-800 dark:text-violet-300'}`}>
            Este extrato apareceu antes em {sourceAccounts}. O plano abaixo corrige o destino para {destination} sem apagar o histórico.
          </p>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {summaryItems.map(item => (
          <div key={item.label} className="rounded-lg border border-white/70 bg-white/70 px-3 py-2 dark:border-gray-700 dark:bg-gray-900/50">
            <p className="text-lg font-semibold text-gray-900 dark:text-white">{item.value}</p>
            <p className="text-[10px] leading-tight text-gray-500 dark:text-gray-400">{item.label}</p>
          </div>
        ))}
      </div>

      {plan.resumo.legadas_preservadas > 0 && (
        <p className="mt-2 text-[11px] text-gray-600 dark:text-gray-300">
          {plan.resumo.legadas_preservadas} movimentação(ões) legada(s) sem correspondência serão preservadas na conta de origem.
        </p>
      )}

      {plan.bloqueios.length > 0 && (
        <div className="mt-3 space-y-1 text-xs text-rose-800 dark:text-rose-300">
          {plan.bloqueios.map((block, index) => <p key={`${block}-${index}`}>• {reasonLabel(block)}</p>)}
        </div>
      )}

      {!blocked && (
        <label className="mt-3 flex cursor-pointer items-start gap-3 rounded-lg border border-violet-200 bg-white/70 px-3 py-3 dark:border-violet-700 dark:bg-gray-900/50">
          <input
            type="checkbox"
            checked={confirmed}
            disabled={disabled}
            onChange={event => onConfirmed(event.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-violet-300 text-violet-700 focus:ring-violet-400"
          />
          <span className="text-xs font-medium leading-relaxed text-violet-900 dark:text-violet-200">
            Confirmo este plano: mover, preservar vínculos, arquivar saldos indevidos e inserir os movimentos faltantes conforme as quantidades acima.
          </span>
        </label>
      )}
    </div>
  );
}

function PreviewModal({ preview, accountName, confirming, onCancel, onConfirm }: {
  preview: PreviewPayload;
  accountName: string;
  confirming: boolean;
  onCancel: () => void;
  onConfirm: (accountLinkConfirmed: boolean, legacyCorrectionConfirmed: boolean) => void;
}) {
  const [accountLinkConfirmed, setAccountLinkConfirmed] = useState(false);
  const [legacyCorrectionConfirmed, setLegacyCorrectionConfirmed] = useState(false);
  const totals = summarize(preview.transacoes, preview.resumo, preview.saldo_extrato);
  const detected = [preview.banco_detectado, preview.conta_detectada].filter(Boolean).join(' · ');
  const period = [preview.periodo?.inicio, preview.periodo?.fim].filter(Boolean).map(value => fmtDate(value as string)).join(' até ');
  const accountConfirmationRequired = preview.confirmacao_conta_necessaria === true;
  const accountConfirmed = !accountConfirmationRequired || accountLinkConfirmed;
  const correctionPlan = preview.correcao_legado;
  const correctionRequired = correctionPlan?.correcao_necessaria === true;
  const correctionBlocked = correctionPlanBlocked(correctionPlan);
  const correctionConfirmed = !correctionRequired || legacyCorrectionConfirmed;
  const importBlocked = preview.bloqueado || correctionBlocked;

  useEffect(() => {
    setAccountLinkConfirmed(false);
    setLegacyCorrectionConfirmed(false);
  }, [preview.banco_detectado, preview.conta_detectada, preview.correcao_legado?.preview_token, preview.nome_arquivo]);

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-gray-950/45 p-3 backdrop-blur-[2px]" onClick={onCancel}>
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900" onClick={event => event.stopPropagation()}>
        <div className="flex items-start justify-between border-b border-gray-100 px-5 py-4 dark:border-gray-800">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-emerald-600" />
              <h3 className="font-semibold text-gray-900 dark:text-white">Revisar antes de importar</h3>
            </div>
            <p className="mt-1 truncate text-xs text-gray-500 dark:text-gray-400">{preview.nome_arquivo} · destino: {accountName}</p>
          </div>
          <button onClick={onCancel} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"><X className="h-4 w-4" /></button>
        </div>

        <div className="overflow-y-auto px-5 py-4">
          <div className="rounded-xl border border-gray-200 bg-gray-50/70 p-4 dark:border-gray-700 dark:bg-gray-800/40">
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Arquivo detectado</p>
                <p className="mt-1 text-sm font-medium text-gray-800 dark:text-gray-200">{detected || 'Conta não identificada no cabeçalho'}</p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Período</p>
                <p className="mt-1 text-sm font-medium text-gray-800 dark:text-gray-200">{period || 'Não informado'}</p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Movimentos</p>
                <p className="mt-1 text-sm font-medium text-gray-800 dark:text-gray-200">{preview.transacoes.length}</p>
              </div>
            </div>
          </div>

          {accountConfirmationRequired && !preview.bloqueado && (
            <label className="mt-3 flex cursor-pointer items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-800 dark:bg-amber-900/20">
              <input
                type="checkbox"
                checked={accountLinkConfirmed}
                disabled={confirming}
                onChange={event => setAccountLinkConfirmed(event.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-amber-300 text-gray-900 focus:ring-amber-400"
              />
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-amber-900 dark:text-amber-200">
                  Confirmo que este extrato pertence à conta {accountName}
                </span>
                <span className="mt-1 block text-xs leading-relaxed text-amber-800 dark:text-amber-300">
                  {detected
                    ? `O arquivo identifica ${detected}. Ao confirmar, essa identificação será vinculada à conta selecionada para validar as próximas importações.`
                    : 'O arquivo não informou uma identificação completa. Confira a conta selecionada antes de continuar.'}
                </span>
              </span>
            </label>
          )}

          {correctionPlan && (
            <LegacyCorrectionPanel
              plan={correctionPlan}
              accountName={accountName}
              confirmed={legacyCorrectionConfirmed}
              disabled={confirming}
              onConfirmed={setLegacyCorrectionConfirmed}
            />
          )}

          {preview.bloqueado && (
            <div className="mt-3 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs leading-relaxed text-rose-800 dark:border-rose-800 dark:bg-rose-900/20 dark:text-rose-300">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{previewBlockingMessage(preview)}</span>
            </div>
          )}

          {preview.avisos?.length ? (
            <div className="mt-3 space-y-1.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
              {preview.avisos.map((warning, index) => (
                <p key={`${warning}-${index}`} className="flex gap-2">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{warning}
                </p>
              ))}
            </div>
          ) : null}

          <div className="mt-4 grid grid-cols-2 divide-x divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 bg-white sm:grid-cols-4 sm:divide-y-0 dark:divide-gray-700 dark:border-gray-700 dark:bg-gray-900">
            <Metric label="Entradas" value={fmtBRL(totals.entries)} tone="positive" />
            <Metric label="Saídas" value={fmtBRL(totals.exits)} tone="negative" />
            <Metric label="Saldo no arquivo" value={totals.balance === null ? 'Não informado' : fmtBRL(totals.balance)} />
            <Metric
              label="Variação no período"
              value={fmtBRL(totals.entries - totals.exits)}
              detail="entradas menos saídas"
              tone={totals.entries >= totals.exits ? 'positive' : 'negative'}
            />
          </div>

          <div className="mt-4 overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700">
            <div className="grid grid-cols-[88px_minmax(0,1fr)_110px] gap-3 border-b border-gray-100 bg-gray-50 px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:border-gray-700 dark:bg-gray-800/60">
              <span>Data</span><span>Descrição</span><span className="text-right">Valor</span>
            </div>
            {preview.transacoes.slice(0, 8).map((transaction, index) => (
              <div key={transaction.id || transaction.fit_id || transaction.fingerprint || index} className="grid grid-cols-[88px_minmax(0,1fr)_110px] gap-3 border-b border-gray-100 px-3 py-2.5 text-sm last:border-0 dark:border-gray-800">
                <span className="text-gray-500">{fmtDate(transaction.data)}</span>
                <span className="truncate text-gray-700 dark:text-gray-200">{transaction.descricao || 'Sem descrição'}</span>
                <span className={`text-right font-semibold ${transaction.tipo === 'credito' ? 'text-emerald-600' : 'text-rose-600'}`}>
                  {transaction.tipo === 'credito' ? '+' : '-'}{fmtBRL(transactionValue(transaction))}
                </span>
              </div>
            ))}
            {preview.transacoes.length > 8 && (
              <p className="px-3 py-2 text-center text-xs text-gray-400">Mais {preview.transacoes.length - 8} movimentações no arquivo</p>
            )}
          </div>
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-gray-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between dark:border-gray-800">
          <p className="text-xs text-gray-400">
            {importBlocked
              ? 'Nada será gravado enquanto este bloqueio não for resolvido.'
              : accountConfirmationRequired && !accountLinkConfirmed
              ? 'Confirme a conta do extrato para liberar a importação.'
              : correctionRequired && !legacyCorrectionConfirmed
              ? 'Confirme o plano de correção para liberar a importação.'
              : 'Nenhuma informação foi gravada nesta prévia.'}
          </p>
          <div className="flex gap-2">
            <button onClick={onCancel} disabled={confirming} className="flex-1 rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-50 sm:flex-none dark:text-gray-300 dark:hover:bg-gray-800">Cancelar</button>
            <button onClick={() => onConfirm(accountLinkConfirmed, legacyCorrectionConfirmed)} disabled={confirming || importBlocked || !accountConfirmed || !correctionConfirmed || preview.transacoes.length === 0} className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-50 sm:flex-none dark:bg-white dark:text-gray-900">
              {confirming ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {importBlocked
                ? 'Importação bloqueada'
                : correctionRequired ? 'Confirmar plano e importar'
                : accountConfirmationRequired ? 'Confirmar vínculo e importar' : 'Confirmar importação'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function fmtDateTime(value?: string) {
  if (!value) return 'Data não informada';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo',
  }).format(date);
}

function importBatchStatus(batch: ImportBatch) {
  const summary = batch.resumo_rollback;
  if (summary.total > 0 && summary.ativas === 0 && summary.revertidas >= summary.total) {
    return { label: 'Desfeita', className: 'border-gray-200 bg-gray-100 text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300' };
  }
  if (summary.revertidas > 0) {
    return { label: 'Parcialmente desfeita', className: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300' };
  }
  if (batch.status === 'falhou') {
    return { label: 'Falhou', className: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-900/20 dark:text-rose-300' };
  }
  if (batch.status === 'processando') {
    return { label: 'Processando', className: 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-300' };
  }
  return { label: 'Importada', className: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300' };
}

function importBatchPeriod(batch: ImportBatch) {
  const values = [batch.data_inicio, batch.data_fim].filter(Boolean) as string[];
  if (!values.length) return 'Período não informado';
  if (values.length === 1 || values[0] === values[1]) return fmtDate(values[0]);
  return `${fmtDate(values[0])} a ${fmtDate(values[1])}`;
}

function ImportBatchRow({ batch, busy, onRollback }: {
  batch: ImportBatch;
  busy: boolean;
  onRollback: (batch: ImportBatch) => void;
}) {
  const status = importBatchStatus(batch);
  const summary = batch.resumo_rollback;
  const identity = [batch.banco_codigo, batch.conta_ref].filter(Boolean).join(' · ');
  const canReviewRollback = summary.ativas > 0;
  const inactiveActionLabel = summary.revertidas > 0 ? 'Já desfeita' : 'Sem movimentos';
  return (
    <div className="grid gap-3 border-t border-gray-100 px-4 py-4 first:border-t-0 lg:grid-cols-[minmax(0,1.6fr)_minmax(180px,0.8fr)_minmax(220px,1fr)_auto] lg:items-center dark:border-gray-800">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-sm font-semibold text-gray-900 dark:text-white">{batch.nome_arquivo}</p>
          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${status.className}`}>{status.label}</span>
        </div>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          {importBatchPeriod(batch)}{identity ? ` · ${identity}` : ''}
        </p>
        <p className="mt-0.5 text-[11px] text-gray-400">Importado em {fmtDateTime(batch.created_at)}</p>
        {batch.conta_legada_nao_confirmada && (
          <p className="mt-1 text-[11px] font-medium text-amber-700 dark:text-amber-300">Identidade bancária deste lote legado não confirmada.</p>
        )}
        {batch.status === 'falhou' && (
          <p className="mt-1 text-[11px] text-rose-600 dark:text-rose-300">A importação não foi concluída. Gere uma nova prévia antes de tentar novamente.</p>
        )}
      </div>
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Arquivo</p>
        <p className="mt-1 text-sm font-medium text-gray-800 dark:text-gray-200">{batch.total_transacoes || summary.total} movimento(s)</p>
        <p className="mt-0.5 text-[11px] text-gray-400">{fmtBRL(batch.total_creditos)} entrando · {fmtBRL(batch.total_debitos)} saindo</p>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg bg-gray-50 px-2 py-2 dark:bg-gray-800/60">
          <p className="text-sm font-semibold text-gray-900 dark:text-white">{summary.reversiveis}</p>
          <p className="text-[10px] text-gray-400">reversíveis</p>
        </div>
        <div className="rounded-lg bg-gray-50 px-2 py-2 dark:bg-gray-800/60">
          <p className="text-sm font-semibold text-amber-700 dark:text-amber-300">{summary.bloqueadas}</p>
          <p className="text-[10px] text-gray-400">com vínculo</p>
        </div>
        <div className="rounded-lg bg-gray-50 px-2 py-2 dark:bg-gray-800/60">
          <p className="text-sm font-semibold text-gray-600 dark:text-gray-300">{summary.revertidas}</p>
          <p className="text-[10px] text-gray-400">já desfeitas</p>
        </div>
      </div>
      <button
        onClick={() => onRollback(batch)}
        disabled={!canReviewRollback || busy}
        className="flex items-center justify-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-45 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
      >
        {busy ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Undo2 className="h-3.5 w-3.5" />}
        {canReviewRollback ? 'Desfazer importação' : inactiveActionLabel}
      </button>
    </div>
  );
}

function ImportHistoryPanel({
  batches, accountName, loading, error, busyBatchId, pagination, onRefresh, onPage, onRollback,
}: {
  batches: ImportBatch[];
  accountName: string;
  loading: boolean;
  error: string | null;
  busyBatchId: string | null;
  pagination: ImportHistoryPagination;
  onRefresh: () => void;
  onPage: (page: number) => void;
  onRollback: (batch: ImportBatch) => void;
}) {
  const pageCount = Math.max(1, Math.ceil(pagination.total / pagination.pageSize));
  return (
    <section className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
      <div className="flex flex-col gap-2 border-b border-gray-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between dark:border-gray-800">
        <div>
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-gray-500" />
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Histórico de importações OFX</h3>
          </div>
          <p className="mt-0.5 text-xs text-gray-400">Filtrado pela conta {accountName}. Lotes são desfeitos de forma reversível, nunca excluídos.</p>
        </div>
        <button onClick={onRefresh} disabled={loading} className="flex items-center gap-1.5 self-start rounded-lg px-2.5 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-100 disabled:opacity-50 sm:self-auto dark:text-gray-400 dark:hover:bg-gray-800">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />Atualizar
        </button>
      </div>
      {error && (
        <div className="flex items-start gap-2 border-b border-rose-100 bg-rose-50 px-4 py-3 text-xs text-rose-800 dark:border-rose-900 dark:bg-rose-900/20 dark:text-rose-300">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{error}
        </div>
      )}
      {loading && !batches.length ? (
        <div className="flex h-28 items-center justify-center text-sm text-gray-400"><RefreshCw className="mr-2 h-4 w-4 animate-spin" />Carregando lotes...</div>
      ) : batches.length ? (
        batches.map(batch => (
          <ImportBatchRow key={batch.id} batch={batch} busy={busyBatchId === batch.id} onRollback={onRollback} />
        ))
      ) : (
        <div className="px-5 py-8 text-center">
          <FileText className="mx-auto h-6 w-6 text-gray-300 dark:text-gray-600" />
          <p className="mt-2 text-sm font-medium text-gray-600 dark:text-gray-300">Nenhum OFX importado nesta conta</p>
          <p className="mt-0.5 text-xs text-gray-400">A primeira importação aparecerá aqui com seu histórico completo.</p>
        </div>
      )}
      {pagination.total > pagination.pageSize && (
        <div className="flex items-center justify-between border-t border-gray-100 px-4 py-3 text-xs text-gray-500 dark:border-gray-800 dark:text-gray-400">
          <span>Página {pagination.page} de {pageCount} · {pagination.total} lotes</span>
          <div className="flex gap-1">
            <button onClick={() => onPage(pagination.page - 1)} disabled={loading || pagination.page <= 1} className="rounded-lg border border-gray-200 px-2.5 py-1.5 font-medium disabled:opacity-40 dark:border-gray-700">Anterior</button>
            <button onClick={() => onPage(pagination.page + 1)} disabled={loading || pagination.page >= pageCount} className="rounded-lg border border-gray-200 px-2.5 py-1.5 font-medium disabled:opacity-40 dark:border-gray-700">Próxima</button>
          </div>
        </div>
      )}
    </section>
  );
}

const ROLLBACK_BLOCK_LABELS: Record<string, string> = {
  receita_conciliada: 'Ligada a uma receita',
  despesa_conciliada: 'Ligada a uma despesa',
  conciliacao_sem_destino: 'Conciliação ativa',
  transferencia: 'Ligada a uma transferência',
  repasse_alocado: 'Recebimentos alocados neste repasse',
};

function rollbackBlockLabel(reason?: string) {
  if (!reason) return 'Vínculo financeiro ativo';
  return ROLLBACK_BLOCK_LABELS[reason] || reasonLabel(reason);
}

function RollbackPreviewModal({ preview, accountName, confirming, error, onCancel, onConfirm }: {
  preview: RollbackPreview;
  accountName: string;
  confirming: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const summary = preview.resumo;
  const canRollback = summary.reversiveis > 0;

  useEffect(() => setConfirmed(false), [preview.preview_token]);

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-gray-950/45 p-3 backdrop-blur-[2px]" onClick={onCancel}>
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900" onClick={event => event.stopPropagation()}>
        <div className="flex items-start justify-between border-b border-gray-100 px-5 py-4 dark:border-gray-800">
          <div>
            <div className="flex items-center gap-2"><Undo2 className="h-4 w-4 text-amber-600" /><h3 className="font-semibold text-gray-900 dark:text-white">Revisar reversão do lote</h3></div>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{preview.lote.nome_arquivo} · {accountName}</p>
          </div>
          <button onClick={onCancel} disabled={confirming} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 disabled:opacity-50 dark:hover:bg-gray-800"><X className="h-4 w-4" /></button>
        </div>

        <div className="overflow-y-auto px-5 py-4">
          <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-300">
            Desfazer arquiva os movimentos livres deste lote e mantém o registro da importação. Movimentos já conciliados, transferências e repasses com clientes permanecem intactos até seus vínculos serem desfeitos.
          </p>

          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Metric label="Serão desfeitas" value={`${summary.reversiveis}`} tone="attention" />
            <Metric label="Vínculos preservados" value={`${summary.bloqueadas}`} />
            <Metric label="Já desfeitas" value={`${summary.revertidas}`} />
            <Metric label="Fotos de saldo" value={`${summary.balance_snapshots}`} />
          </div>

          <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-xs text-gray-600 dark:border-gray-700 dark:bg-gray-800/50 dark:text-gray-300">
            <p><strong className="text-gray-900 dark:text-white">Movimentos bancários livres:</strong> {summary.movimentos_reais} · entradas {fmtBRL(summary.entradas_reais)} · saídas {fmtBRL(summary.saidas_reais)}</p>
            {summary.balance_snapshots > 0 && <p className="mt-1">As {summary.balance_snapshots} fotos de saldo serão arquivadas; elas não são tratadas como entrada ou saída.</p>}
          </div>

          {preview.avisos.length > 0 && (
            <div className="mt-3 space-y-1.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
              {preview.avisos.map((warning, index) => <p key={`${warning}-${index}`} className="flex gap-2"><AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{warning}</p>)}
            </div>
          )}

          {preview.transacoes_bloqueadas.length > 0 && (
            <div className="mt-4 overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700">
              <div className="border-b border-gray-100 bg-gray-50 px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:border-gray-700 dark:bg-gray-800/60">Vínculos que serão preservados</div>
              {preview.transacoes_bloqueadas.slice(0, 8).map(transaction => (
                <div key={transaction.id} className="flex items-start justify-between gap-3 border-b border-gray-100 px-3 py-2.5 text-xs last:border-0 dark:border-gray-800">
                  <div className="min-w-0"><p className="truncate font-medium text-gray-800 dark:text-gray-200">{transaction.descricao || 'Movimentação sem descrição'}</p><p className="mt-0.5 text-gray-400">{rollbackBlockLabel(transaction.motivo_bloqueio)}{transaction.data ? ` · ${fmtDate(transaction.data)}` : ''}</p></div>
                  <span className="shrink-0 font-semibold text-gray-700 dark:text-gray-200">{fmtBRL(transaction.valor)}</span>
                </div>
              ))}
              {preview.transacoes_bloqueadas.length > 8 && <p className="px-3 py-2 text-center text-xs text-gray-400">Mais {preview.transacoes_bloqueadas.length - 8} vínculo(s) preservado(s)</p>}
            </div>
          )}

          {error && <div className="mt-3 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-800 dark:border-rose-800 dark:bg-rose-900/20 dark:text-rose-300"><AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{error}</div>}

          {canRollback ? (
            <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-800 dark:bg-amber-900/20">
              <input type="checkbox" checked={confirmed} disabled={confirming} onChange={event => setConfirmed(event.target.checked)} className="mt-0.5 h-4 w-4 rounded border-amber-300 text-amber-700 focus:ring-amber-400" />
              <span className="text-xs font-medium leading-relaxed text-amber-900 dark:text-amber-200">Confirmo desfazer {summary.reversiveis} movimentação(ões) livre(s) deste lote e preservar {summary.bloqueadas} vínculo(s) ativo(s).</span>
            </label>
          ) : (
            <p className="mt-4 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-xs text-gray-600 dark:border-gray-700 dark:bg-gray-800/50 dark:text-gray-300">
              Não há movimentos livres para desfazer. Desfaça primeiro os vínculos indicados acima, se quiser reverter o restante do lote.
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-gray-100 px-5 py-4 dark:border-gray-800">
          <button onClick={onCancel} disabled={confirming} className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-50 dark:text-gray-300 dark:hover:bg-gray-800">Cancelar</button>
          <button onClick={onConfirm} disabled={!canRollback || !confirmed || confirming} className="flex items-center justify-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50">
            {confirming ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />}
            Desfazer importação
          </button>
        </div>
      </div>
    </div>
  );
}

function processorReceiptTitle(receipt: ProcessorReceipt) {
  return receipt.cliente_nome || receipt.job_nome || receipt.descricao || 'Recebimento sem identificação';
}

function ProcessorReceiptLine({ receipt, selected, disabled, onToggle }: {
  receipt: ProcessorReceipt;
  selected?: boolean;
  disabled?: boolean;
  onToggle?: () => void;
}) {
  const content = (
    <>
      {onToggle && (
        <input
          type="checkbox"
          checked={Boolean(selected)}
          disabled={disabled}
          onChange={onToggle}
          className="mt-0.5 h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-gray-400"
        />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-semibold text-gray-800 dark:text-gray-200">{processorReceiptTitle(receipt)}</p>
        {(receipt.cliente_nome || receipt.job_nome) && receipt.descricao && (
          <p className="mt-0.5 truncate text-[11px] text-gray-400">{receipt.descricao}</p>
        )}
        {receipt.data_recebimento_real && (
          <p className="mt-0.5 text-[10px] text-gray-400">Previsto para {fmtDate(receipt.data_recebimento_real)}</p>
        )}
      </div>
      <span className="shrink-0 text-xs font-semibold text-gray-800 dark:text-gray-200">
        {fmtBRL(receipt.valor_liquido)}
      </span>
    </>
  );
  if (!onToggle) return <div className="flex items-start gap-2 py-2">{content}</div>;
  return (
    <label className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-2 hover:bg-gray-50 dark:hover:bg-gray-800/60">
      {content}
    </label>
  );
}

function settlementGuidance(settlement: ProcessorSettlement) {
  const messages: Record<string, string> = {
    multiple_sets: 'Mais de um grupo fecha o valor do banco. Confira os clientes e escolha somente o grupo que pertence a este repasse.',
    candidate_limit: 'Há muitos recebimentos próximos. Revise a lista e selecione somente os que compõem este repasse.',
    search_limit: 'Há muitas combinações possíveis. Revise a lista e confirme apenas quando a soma fechar exatamente.',
    no_exact_set: 'Nenhuma combinação segura fechou o valor do banco. Confira datas e taxas antes de conciliar.',
    invalid_credit: 'Este crédito não tem dados suficientes para montar o repasse com segurança.',
  };
  return messages[settlement.reason]
    || 'Confira os recebimentos abaixo antes de confirmar este repasse da InfinitePay.';
}

function manualSettlementDifferenceLabel(targetCents: number, selectedCents: number) {
  if (selectedCents === targetCents) return 'A soma líquida confere com o crédito do banco.';
  const difference = fmtBRL(Math.abs(targetCents - selectedCents) / 100);
  return selectedCents < targetCents
    ? `Faltam ${difference} para fechar o valor.`
    : `A seleção excede o crédito em ${difference}.`;
}

function processorCandidateSetIsActionable(candidateSet: ProcessorCandidateSet, targetCents: number) {
  if (!candidateSet.receiptIds.length) return false;
  if (candidateSet.receipts.length !== candidateSet.receiptIds.length) return false;
  const receiptTotal = candidateSet.receipts
    .reduce((sum, receipt) => sum + moneyCents(receipt.valor_liquido), 0);
  return receiptTotal === targetCents && moneyCents(candidateSet.totalAmount) === targetCents;
}

function ProcessorSettlementPanel({ transaction, settlement, saving, onConfirm }: {
  transaction: Transacao;
  settlement: ProcessorSettlement;
  saving: boolean;
  onConfirm: (receiptIds: string[]) => void;
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const targetCents = moneyCents(transaction.valor);
  const selectedSet = new Set(selectedIds);
  const selectedReceipts = settlement.eligibleReceipts.filter(receipt => selectedSet.has(receipt.id));
  const selectedCents = selectedReceipts.reduce((sum, receipt) => sum + moneyCents(receipt.valor_liquido), 0);
  const canConfirmManual = selectedIds.length > 0 && selectedCents === targetCents;
  const hasActionableGroup = settlement.candidateSets.some(candidateSet => (
    processorCandidateSetIsActionable(candidateSet, targetCents)
  ));
  const canSelectManually = !hasActionableGroup
    && ['candidate_limit', 'search_limit'].includes(settlement.reason)
    && settlement.eligibleReceipts.length > 0;
  const toggleReceipt = (receiptId: string) => {
    setSelectedIds(current => (
      current.includes(receiptId)
        ? current.filter(id => id !== receiptId)
        : [...current, receiptId]
    ));
  };

  return (
    <section className="mb-4 overflow-hidden rounded-xl border border-violet-200 bg-violet-50/45 dark:border-violet-800 dark:bg-violet-900/10">
      <div className="border-b border-violet-100 px-4 py-3 dark:border-violet-800/70">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <ArrowRightLeft className="h-4 w-4 text-violet-600 dark:text-violet-300" />
            <h4 className="text-sm font-semibold text-gray-900 dark:text-white">Repasse da InfinitePay</h4>
          </div>
          {settlement.reason && (
            <span className="rounded-full bg-white px-2 py-1 text-[10px] font-semibold text-violet-700 shadow-sm dark:bg-gray-900 dark:text-violet-300">
              {reasonLabel(settlement.reason)}
            </span>
          )}
        </div>
        <p className="mt-1.5 text-xs leading-relaxed text-gray-600 dark:text-gray-300">{settlementGuidance(settlement)}</p>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-500 dark:text-gray-400">
          <span>Crédito no banco: <strong className="text-gray-800 dark:text-gray-200">{fmtBRL(transactionValue(transaction))}</strong></span>
          {settlement.consideredCandidateCount > 0 && <span>{settlement.consideredCandidateCount} recebimento(s) considerado(s)</span>}
        </div>
      </div>

      {settlement.candidateSets.length > 0 && (
        <div className="space-y-3 p-3">
          {settlement.candidateSets.map((candidateSet, index) => {
            const actionable = processorCandidateSetIsActionable(candidateSet, targetCents);
            return (
              <div key={candidateSet.receiptIds.join('-') || index} className="rounded-xl border border-violet-100 bg-white p-3 dark:border-violet-800/70 dark:bg-gray-900">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold text-gray-800 dark:text-gray-200">Grupo {index + 1}</p>
                    <p className="mt-0.5 text-[11px] text-gray-400">{candidateSet.receiptIds.length} recebimento(s)</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Soma líquida</p>
                    <span className="text-sm font-semibold text-gray-900 dark:text-white">{fmtBRL(candidateSet.totalAmount)}</span>
                  </div>
                </div>
                {candidateSet.reasons.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {candidateSet.reasons.slice(0, 3).map(reason => (
                      <span key={reason} className="rounded-md bg-violet-50 px-1.5 py-0.5 text-[10px] text-violet-600 dark:bg-violet-900/20 dark:text-violet-300">
                        {reasonLabel(reason)}
                      </span>
                    ))}
                  </div>
                )}
                {candidateSet.receipts.length > 0 && (
                  <div className="mt-2 divide-y divide-gray-100 dark:divide-gray-800">
                    {candidateSet.receipts.map(receipt => <ProcessorReceiptLine key={receipt.id} receipt={receipt} />)}
                  </div>
                )}
                {candidateSet.receipts.length !== candidateSet.receiptIds.length && (
                  <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
                    Os detalhes deste grupo não foram carregados. Reanalise antes de confirmar.
                  </p>
                )}
                <div className="mt-3 flex justify-end">
                  <button
                    onClick={() => onConfirm(candidateSet.receiptIds)}
                    disabled={saving || !actionable}
                    className="flex items-center gap-2 rounded-lg bg-violet-600 px-3 py-2 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
                  >
                    {saving && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
                    Confirmar este grupo
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {canSelectManually && (
        <div className="border-t border-violet-100 p-3 dark:border-violet-800/70">
          <div className="rounded-xl border border-violet-100 bg-white p-3 dark:border-violet-800/70 dark:bg-gray-900">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-gray-800 dark:text-gray-200">Montar o grupo manualmente</p>
                <p className="mt-0.5 text-[11px] text-gray-400">Marque somente os recebimentos deste repasse.</p>
              </div>
              <span className={`text-sm font-semibold ${canConfirmManual ? 'text-emerald-600' : 'text-amber-600'}`}>
                {fmtBRL(selectedCents / 100)}
              </span>
            </div>
            <div className="mt-2 max-h-64 divide-y divide-gray-100 overflow-y-auto dark:divide-gray-800">
              {settlement.eligibleReceipts.map(receipt => (
                <ProcessorReceiptLine
                  key={receipt.id}
                  receipt={receipt}
                  selected={selectedSet.has(receipt.id)}
                  disabled={saving}
                  onToggle={() => toggleReceipt(receipt.id)}
                />
              ))}
            </div>
            <div className="mt-3 flex flex-col gap-2 border-t border-gray-100 pt-3 sm:flex-row sm:items-center sm:justify-between dark:border-gray-800">
              <p className="text-[11px] text-gray-400">
                {manualSettlementDifferenceLabel(targetCents, selectedCents)}
              </p>
              <button
                onClick={() => onConfirm(selectedIds)}
                disabled={saving || !canConfirmManual}
                className="flex items-center justify-center gap-2 rounded-lg bg-violet-600 px-3 py-2 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
              >
                {saving && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
                Confirmar grupo selecionado
              </button>
            </div>
          </div>
        </div>
      )}

      {!settlement.candidateSets.length && !canSelectManually && (
        <p className="px-4 py-4 text-xs text-gray-500 dark:text-gray-400">
          Revise os recebimentos, as taxas e as datas na conta InfinitePay. Nenhum grupo pode ser confirmado com segurança agora.
        </p>
      )}
    </section>
  );
}

interface ReconcileModalProps {
  transaction: Transacao;
  candidates: Candidate[];
  processorSettlement: ProcessorSettlement | null;
  loadingCandidates: boolean;
  mode: 'vincular' | 'criar';
  search: string;
  categories: Array<{ id: string; nome: string }>;
  newDescription: string;
  newCategory: string;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onMode: (mode: 'vincular' | 'criar') => void;
  onSearch: (value: string) => void;
  onDescription: (value: string) => void;
  onCategory: (value: string) => void;
  onLink: (candidate: Candidate) => void;
  onConfirmProcessorSettlement: (receiptIds: string[]) => void;
  onCreate: () => void;
}

function CandidateButton({ candidate, saving, onLink }: {
  candidate: Candidate;
  saving: boolean;
  onLink: (candidate: Candidate) => void;
}) {
  const confidence = normalizedConfidence(candidate.score ?? candidate.confianca);
  const candidateReasons = reasons(candidate.motivos);
  const date = candidateDate(candidate);
  return (
    <button onClick={() => onLink(candidate)} disabled={saving} className="w-full rounded-xl border border-gray-200 p-3 text-left transition-colors hover:border-gray-300 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:hover:border-gray-600 dark:hover:bg-gray-800/60">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-semibold text-gray-900 dark:text-white">{candidate.cliente_nome || candidate.descricao || 'Lançamento sem cliente'}</span>
            <Confidence value={confidence} />
          </div>
          {candidate.cliente_nome && candidate.descricao && <p className="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400">{candidate.descricao}</p>}
          <p className="mt-1 text-xs text-gray-400">{[date ? fmtDate(date) : '', candidate.status, candidate.job_nome].filter(Boolean).join(' · ')}</p>
        </div>
        <span className="shrink-0 text-sm font-semibold text-gray-800 dark:text-gray-200">{fmtBRL(candidateValue(candidate))}</span>
      </div>
      {candidateReasons.length ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {candidateReasons.slice(0, 4).map(reason => <span key={reason} className="rounded-md bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500 dark:bg-gray-800 dark:text-gray-400">{reasonLabel(reason)}</span>)}
        </div>
      ) : null}
    </button>
  );
}

function ReconcileModal(props: ReconcileModalProps) {
  const {
    transaction, candidates, processorSettlement, loadingCandidates, mode, search, categories,
    newDescription, newCategory, saving, error, onClose, onMode, onSearch,
    onDescription, onCategory, onLink, onConfirmProcessorSettlement, onCreate,
  } = props;
  const query = search.trim().toLowerCase();
  const visible = candidates.filter(candidate => {
    const haystack = [candidate.cliente_nome, candidate.descricao, candidate.job_nome].filter(Boolean).join(' ').toLowerCase();
    return !query || haystack.includes(query);
  });
  const isCredit = transaction.tipo === 'credito';
  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-gray-950/45 p-3 backdrop-blur-[2px]" onClick={onClose}>
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900" onClick={event => event.stopPropagation()}>
        <div className="flex items-start justify-between border-b border-gray-100 px-5 py-4 dark:border-gray-800">
          <div className="min-w-0">
            <h3 className="font-semibold text-gray-900 dark:text-white">Conciliar movimentação</h3>
            <p className="mt-1 truncate text-xs text-gray-500 dark:text-gray-400">
              {fmtDate(transaction.data)} · {transaction.descricao || 'Sem descrição'} ·{' '}
              <span className={isCredit ? 'text-emerald-600' : 'text-rose-600'}>{isCredit ? '+' : '-'}{fmtBRL(transactionValue(transaction))}</span>
            </p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"><X className="h-4 w-4" /></button>
        </div>

        <div className="flex gap-1 border-b border-gray-100 px-5 py-3 dark:border-gray-800">
          <button onClick={() => onMode('vincular')} className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${mode === 'vincular' ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900' : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800'}`}><Link2 className="mr-1 inline h-3.5 w-3.5" />Vincular existente</button>
          <button onClick={() => onMode('criar')} className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${mode === 'criar' ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900' : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800'}`}><Plus className="mr-1 inline h-3.5 w-3.5" />Criar {isCredit ? 'receita' : 'despesa'}</button>
        </div>

        {error && <p className="mx-5 mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:bg-rose-900/20 dark:text-rose-300">{error}</p>}

        <div className="overflow-y-auto px-5 py-4">
          {mode === 'vincular' ? (
            <>
              {processorSettlement && (
                <ProcessorSettlementPanel
                  key={transaction.id}
                  transaction={transaction}
                  settlement={processorSettlement}
                  saving={saving}
                  onConfirm={onConfirmProcessorSettlement}
                />
              )}
              <div className="relative mb-3">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
                <input value={search} onChange={event => onSearch(event.target.value)} placeholder="Buscar cliente ou lançamento" className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm text-gray-800 outline-none focus:border-gray-400 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-200" />
              </div>
              {loadingCandidates ? (
                <div className="flex items-center justify-center py-12 text-sm text-gray-400"><RefreshCw className="mr-2 h-4 w-4 animate-spin" />Buscando combinações seguras...</div>
              ) : visible.length ? (
                <div className="space-y-2">
                  {visible.map(candidate => <CandidateButton key={`${candidate.tipo || 'lancamento'}-${candidate.id}`} candidate={candidate} saving={saving} onLink={onLink} />)}
                </div>
              ) : (
                <p className="py-10 text-center text-sm text-gray-400">Nenhum candidato encontrado. Crie um lançamento somente se esta movimentação ainda não existir no sistema.</p>
              )}
            </>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">Descrição</label>
                <input value={newDescription} onChange={event => onDescription(event.target.value)} className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 outline-none focus:border-gray-400 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-200" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">Categoria</label>
                <FinSelect value={newCategory} onChange={onCategory} options={categories.map(category => ({ value: category.id, label: category.nome }))} placeholder="Selecione a categoria" />
              </div>
              <div className="rounded-xl bg-gray-50 px-4 py-3 text-sm dark:bg-gray-800/60">
                <div className="flex justify-between text-gray-500"><span>Valor bancário</span><strong className="text-gray-900 dark:text-white">{fmtBRL(transactionValue(transaction))}</strong></div>
                <p className="mt-2 text-xs text-gray-400">Será criado um lançamento já realizado, ligado a esta movimentação e à conta do extrato.</p>
              </div>
              <div className="flex justify-end">
                <button onClick={onCreate} disabled={saving || !newCategory} className="flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-50 dark:bg-white dark:text-gray-900">
                  {saving && <RefreshCw className="h-4 w-4 animate-spin" />}Criar e conciliar
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function transferCandidateIsCompatible(transaction: Transacao, candidate: TransferCandidate) {
  if (moneyCents(transaction.valor) !== moneyCents(candidate.valor)) return false;
  if (candidate.tipo && candidate.tipo === transaction.tipo) return false;
  if (candidate.conta_id && transaction.conta_id && candidate.conta_id === transaction.conta_id) return false;
  return true;
}

function TransferSelectionModal({ transaction, candidates, loading, saving, error, onClose, onConfirm }: {
  transaction: Transacao;
  candidates: TransferCandidate[];
  loading: boolean;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (candidate: TransferCandidate) => void;
}) {
  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-gray-950/45 p-3 backdrop-blur-[2px]" onClick={onClose}>
      <div className="flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900" onClick={event => event.stopPropagation()}>
        <div className="flex items-start justify-between border-b border-gray-100 px-5 py-4 dark:border-gray-800">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <ArrowRightLeft className="h-4 w-4 text-violet-600" />
              <h3 className="font-semibold text-gray-900 dark:text-white">Confirmar transferência entre contas</h3>
            </div>
            <p className="mt-1 truncate text-xs text-gray-500 dark:text-gray-400">
              {fmtDate(transaction.data)} · {transaction.descricao || 'Sem descrição'} · {fmtBRL(transactionValue(transaction))}
            </p>
          </div>
          <button onClick={onClose} disabled={saving} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 disabled:opacity-50 dark:hover:bg-gray-800"><X className="h-4 w-4" /></button>
        </div>

        {error && <p className="mx-5 mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:bg-rose-900/20 dark:text-rose-300">{error}</p>}

        <div className="overflow-y-auto px-5 py-4">
          <p className="mb-3 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
            Selecione explicitamente o movimento correspondente na outra conta. A confirmação só é aceita quando valor, direção e contas forem compatíveis.
          </p>
          {loading ? (
            <div className="flex items-center justify-center py-12 text-sm text-gray-400"><RefreshCw className="mr-2 h-4 w-4 animate-spin" />Buscando a outra ponta...</div>
          ) : candidates.length ? (
            <div className="space-y-2">
              {candidates.map(candidate => {
                const compatible = transferCandidateIsCompatible(transaction, candidate);
                const candidateReasons = candidate.motivos.map(reasonLabel);
                return (
                  <div key={candidate.id} className="rounded-xl border border-gray-200 p-3 dark:border-gray-700">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-gray-900 dark:text-white">{candidate.conta_nome || 'Outra conta bancária'}</p>
                        <p className="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400">{candidate.descricao || 'Sem descrição'}</p>
                        {candidate.data && <p className="mt-1 text-[11px] text-gray-400">{fmtDate(candidate.data)}</p>}
                      </div>
                      <span className="shrink-0 text-sm font-semibold text-gray-800 dark:text-gray-200">{fmtBRL(candidate.valor)}</span>
                    </div>
                    {candidateReasons.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {candidateReasons.slice(0, 3).map(reason => (
                          <span key={reason} className="rounded-md bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500 dark:bg-gray-800 dark:text-gray-400">{reason}</span>
                        ))}
                      </div>
                    )}
                    <div className="mt-3 flex items-center justify-between gap-3">
                      {!compatible && <span className="text-[11px] text-amber-600 dark:text-amber-300">Este movimento não confere com a transação.</span>}
                      <button
                        onClick={() => onConfirm(candidate)}
                        disabled={saving || !compatible}
                        className="ml-auto flex items-center gap-2 rounded-lg bg-violet-600 px-3 py-2 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
                      >
                        {saving && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
                        Confirmar esta contraparte
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-gray-300 px-4 py-8 text-center dark:border-gray-700">
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Nenhuma contraparte compatível foi encontrada</p>
              <p className="mx-auto mt-1 max-w-sm text-xs text-gray-400">Importe o OFX da outra conta ou amplie o período e tente novamente.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TransactionActions({ transaction, busy, onReview, onConfirm, onTransfer, onIgnore, onUndo }: {
  transaction: Transacao;
  busy: boolean;
  onReview: () => void;
  onConfirm: () => void;
  onTransfer: () => void;
  onIgnore: () => void;
  onUndo: () => void;
}) {
  const status = transactionStatus(transaction);
  if (status === 'conciliado' || status === 'transferencia' || status === 'ignorado') {
    return (
      <button onClick={onUndo} disabled={busy} className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-100 disabled:opacity-50 dark:text-gray-400 dark:hover:bg-gray-800">
        {status === 'ignorado' ? 'Restaurar' : 'Desfazer'}
      </button>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5 md:justify-end">
      {status === 'sugerido' && suggestionId(transaction) && (
        <button onClick={onConfirm} disabled={busy} className="rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">Confirmar sugestão</button>
      )}
      <button onClick={onReview} disabled={busy} className="rounded-lg bg-gray-900 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-gray-800 disabled:opacity-50 dark:bg-white dark:text-gray-900">Revisar</button>
      <button onClick={onTransfer} disabled={busy} className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-violet-700 hover:bg-violet-50 disabled:opacity-50 dark:text-violet-300 dark:hover:bg-violet-900/20">Transferência</button>
      <button onClick={onIgnore} disabled={busy} className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-100 disabled:opacity-50 dark:text-gray-400 dark:hover:bg-gray-800">Ignorar</button>
    </div>
  );
}

export default function Conciliacao() {
  const period = useMemo(initialPeriod, []);
  const [transactions, setTransactions] = useState<Transacao[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [statementBalance, setStatementBalance] = useState<ListPayload['saldo_extrato']>(null);
  const [accounts, setAccounts] = useState<Conta[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [accountId, setAccountId] = useState('');
  const [from, setFrom] = useState(period.from);
  const [to, setTo] = useState(period.to);
  const [statusFilter, setStatusFilter] = useState<FilterStatus>('revisar');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [confirmingImport, setConfirmingImport] = useState(false);
  const [reprocessing, setReprocessing] = useState(false);
  const [preview, setPreview] = useState<PreviewPayload | null>(null);
  const [previewAccountId, setPreviewAccountId] = useState('');
  const [selectedFile, setSelectedFile] = useState<{
    name: string;
    content: string;
    contentBase64: string;
    accountId: string;
  } | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);
  const [reconcileFor, setReconcileFor] = useState<Transacao | null>(null);
  const [mode, setMode] = useState<'vincular' | 'criar'>('vincular');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [processorSettlement, setProcessorSettlement] = useState<ProcessorSettlement | null>(null);
  const [transferFor, setTransferFor] = useState<Transacao | null>(null);
  const [transferCandidates, setTransferCandidates] = useState<TransferCandidate[]>([]);
  const [loadingTransferCandidates, setLoadingTransferCandidates] = useState(false);
  const [transferError, setTransferError] = useState<string | null>(null);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [candidateSearch, setCandidateSearch] = useState('');
  const [categories, setCategories] = useState<Array<{ id: string; nome: string }>>([]);
  const [newDescription, setNewDescription] = useState('');
  const [newCategory, setNewCategory] = useState('');
  const [savingReconciliation, setSavingReconciliation] = useState(false);
  const [reconciliationError, setReconciliationError] = useState<string | null>(null);
  const [importBatches, setImportBatches] = useState<ImportBatch[]>([]);
  const [importHistoryPagination, setImportHistoryPagination] = useState<ImportHistoryPagination>({
    page: 1,
    pageSize: 25,
    total: 0,
  });
  const [importHistoryLoading, setImportHistoryLoading] = useState(false);
  const [importHistoryError, setImportHistoryError] = useState<string | null>(null);
  const [rollbackPreview, setRollbackPreview] = useState<RollbackPreview | null>(null);
  const [rollbackLoadingId, setRollbackLoadingId] = useState<string | null>(null);
  const [rollbackConfirming, setRollbackConfirming] = useState(false);
  const [rollbackError, setRollbackError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const accountIdRef = useRef(accountId);
  const viewScopeRef = useRef(financialScope(accountId, from, to));
  const transactionsRequestIdRef = useRef(0);
  const transactionsAbortRef = useRef<AbortController | null>(null);
  const previewRequestIdRef = useRef(0);
  const previewAbortRef = useRef<AbortController | null>(null);
  const reconciliationRequestIdRef = useRef(0);
  const reconciliationAbortRef = useRef<AbortController | null>(null);
  const reconciliationContextRef = useRef<TransactionRequestContext | null>(null);
  const transferRequestIdRef = useRef(0);
  const transferAbortRef = useRef<AbortController | null>(null);
  const transferContextRef = useRef<TransactionRequestContext | null>(null);
  const importHistoryRequestIdRef = useRef(0);
  const importHistoryAbortRef = useRef<AbortController | null>(null);
  const rollbackPreviewRequestIdRef = useRef(0);
  const rollbackPreviewAbortRef = useRef<AbortController | null>(null);
  const rollbackConfirmRequestIdRef = useRef(0);
  const rollbackConfirmAbortRef = useRef<AbortController | null>(null);
  const rollbackContextRef = useRef<BatchRequestContext | null>(null);

  accountIdRef.current = accountId;
  viewScopeRef.current = financialScope(accountId, from, to);

  const clearTransactionData = useCallback(() => {
    setTransactions([]);
    setSummary(null);
    setStatementBalance(null);
  }, []);

  const invalidatePreview = useCallback(() => {
    previewRequestIdRef.current += 1;
    previewAbortRef.current?.abort();
    previewAbortRef.current = null;
    setPreview(null);
    setSelectedFile(null);
    setPreviewAccountId('');
    setPreviewing(false);
    if (fileRef.current) fileRef.current.value = '';
  }, []);

  const closeReconciliation = useCallback(() => {
    reconciliationRequestIdRef.current += 1;
    reconciliationAbortRef.current?.abort();
    reconciliationAbortRef.current = null;
    reconciliationContextRef.current = null;
    setReconcileFor(null);
    setCandidates([]);
    setProcessorSettlement(null);
    setCategories([]);
    setLoadingCandidates(false);
    setReconciliationError(null);
  }, []);

  const closeTransferReview = useCallback(() => {
    transferRequestIdRef.current += 1;
    transferAbortRef.current?.abort();
    transferAbortRef.current = null;
    transferContextRef.current = null;
    setTransferFor(null);
    setTransferCandidates([]);
    setLoadingTransferCandidates(false);
    setTransferError(null);
  }, []);

  const closeRollbackPreview = useCallback(() => {
    rollbackPreviewRequestIdRef.current += 1;
    rollbackPreviewAbortRef.current?.abort();
    rollbackPreviewAbortRef.current = null;
    rollbackConfirmRequestIdRef.current += 1;
    rollbackConfirmAbortRef.current?.abort();
    rollbackConfirmAbortRef.current = null;
    rollbackContextRef.current = null;
    setRollbackPreview(null);
    setRollbackLoadingId(null);
    setRollbackConfirming(false);
    setRollbackError(null);
  }, []);

  const loadTransactions = useCallback(async (selectedAccount: string, start: string, end: string) => {
    const scope = financialScope(selectedAccount, start, end);
    if (scope !== viewScopeRef.current) return;
    const requestId = ++transactionsRequestIdRef.current;
    transactionsAbortRef.current?.abort();
    const controller = new AbortController();
    transactionsAbortRef.current = controller;
    clearTransactionData();
    if (!selectedAccount) {
      transactionsAbortRef.current = null;
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const params = new URLSearchParams({ conta_id: selectedAccount, from: start, to: end });
      const payload = normalizeListPayload(await requestJson(
        `/api/fin/ofx/transacoes?${params.toString()}`,
        { signal: controller.signal },
      ));
      if (!requestIsCurrent(
        requestId,
        transactionsRequestIdRef.current,
        controller,
        scope,
        viewScopeRef.current,
      )) return;
      setTransactions(payload.transacoes);
      setSummary(payload.resumo);
      setStatementBalance(payload.saldo_extrato);
    } catch (error) {
      if (isAbortError(error) || !requestIsCurrent(
        requestId,
        transactionsRequestIdRef.current,
        controller,
        scope,
        viewScopeRef.current,
      )) return;
      clearTransactionData();
      setNotice({ kind: 'error', text: humanizeFinancialError(error, 'Não foi possível carregar o extrato desta conta.') });
    } finally {
      if (requestIsCurrent(
        requestId,
        transactionsRequestIdRef.current,
        controller,
        scope,
        viewScopeRef.current,
      )) {
        transactionsAbortRef.current = null;
        setLoading(false);
      }
    }
  }, [clearTransactionData]);

  const loadImportHistory = useCallback(async (selectedAccount: string, requestedPage = 1) => {
    const requestId = ++importHistoryRequestIdRef.current;
    importHistoryAbortRef.current?.abort();
    const controller = new AbortController();
    importHistoryAbortRef.current = controller;
    setImportBatches([]);
    setImportHistoryPagination({ page: requestedPage, pageSize: 25, total: 0 });
    setImportHistoryError(null);
    if (!selectedAccount || selectedAccount !== accountIdRef.current) {
      importHistoryAbortRef.current = null;
      setImportHistoryLoading(false);
      return;
    }
    setImportHistoryLoading(true);
    try {
      const params = new URLSearchParams({
        conta_id: selectedAccount,
        page: String(requestedPage),
        page_size: '25',
      });
      const data = await requestJson(`/api/fin/ofx/importacoes?${params.toString()}`, {
        signal: controller.signal,
      });
      if (!requestIsCurrent(
        requestId,
        importHistoryRequestIdRef.current,
        controller,
        selectedAccount,
        accountIdRef.current,
      )) return;
      const history = normalizeImportHistory(data);
      setImportBatches(history.batches);
      setImportHistoryPagination(history.pagination);
    } catch (error) {
      if (isAbortError(error) || !requestIsCurrent(
        requestId,
        importHistoryRequestIdRef.current,
        controller,
        selectedAccount,
        accountIdRef.current,
      )) return;
      setImportBatches([]);
      setImportHistoryPagination({ page: requestedPage, pageSize: 25, total: 0 });
      setImportHistoryError(humanizeFinancialError(error, 'Não foi possível carregar o histórico de importações desta conta.'));
    } finally {
      if (requestIsCurrent(
        requestId,
        importHistoryRequestIdRef.current,
        controller,
        selectedAccount,
        accountIdRef.current,
      )) {
        importHistoryAbortRef.current = null;
        setImportHistoryLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const data = await requestJson('/api/fin/contas');
        const loaded = Array.isArray(data) ? data as Conta[] : [];
        setAccounts(loaded);
        setAccountId(current => current || loaded[0]?.id || '');
      } catch (error) {
        setNotice({ kind: 'error', text: humanizeFinancialError(error, 'Não foi possível carregar as contas bancárias.') });
      } finally {
        setAccountsLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    void loadTransactions(accountId, from, to);
  }, [accountId, from, loadTransactions, to]);

  useEffect(() => {
    void loadImportHistory(accountId, 1);
  }, [accountId, loadImportHistory]);

  useEffect(() => {
    closeReconciliation();
    closeTransferReview();
  }, [accountId, closeReconciliation, closeTransferReview, from, to]);

  useEffect(() => () => {
    transactionsAbortRef.current?.abort();
    previewAbortRef.current?.abort();
    reconciliationAbortRef.current?.abort();
    transferAbortRef.current?.abort();
    importHistoryAbortRef.current?.abort();
    rollbackPreviewAbortRef.current?.abort();
    rollbackConfirmAbortRef.current?.abort();
  }, []);

  useEffect(() => {
    setPage(1);
  }, [accountId, from, search, statusFilter, to]);

  const totals = useMemo(
    () => summarize(transactions, summary, statementBalance),
    [statementBalance, summary, transactions],
  );
  const previewAccount = accounts.find(account => account.id === previewAccountId);
  const selectedAccount = accounts.find(account => account.id === accountId);

  const changeAccount = (nextAccountId: string) => {
    if (nextAccountId === accountId) return;
    invalidatePreview();
    closeReconciliation();
    closeTransferReview();
    closeRollbackPreview();
    setAccountId(nextAccountId);
  };

  const filteredTransactions = useMemo(() => {
    const query = search.trim().toLowerCase();
    return transactions.filter(transaction => {
      const status = transactionStatus(transaction);
      const statusMatches = statusFilter === 'todas'
        || (statusFilter === 'revisar' ? needsReview(transaction) : status === statusFilter);
      const haystack = transactionSearchContent(transaction);
      return statusMatches && (!query || haystack.includes(query));
    });
  }, [search, statusFilter, transactions]);

  const pageCount = Math.max(1, Math.ceil(filteredTransactions.length / PAGE_SIZE));
  const visibleTransactions = filteredTransactions.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  useEffect(() => {
    setPage(current => Math.min(current, pageCount));
  }, [pageCount]);

  const previewFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !accountId) return;
    const requestedAccountId = accountId;
    const requestId = ++previewRequestIdRef.current;
    previewAbortRef.current?.abort();
    const controller = new AbortController();
    previewAbortRef.current = controller;
    setPreview(null);
    setSelectedFile(null);
    setPreviewAccountId('');
    setNotice(null);
    if (file.size > MAX_OFX_FILE_SIZE) {
      setNotice({ kind: 'error', text: 'O arquivo deve ter no máximo 10 MB.' });
      previewAbortRef.current = null;
      setPreviewing(false);
      if (fileRef.current) fileRef.current.value = '';
      return;
    }
    setPreviewing(true);
    try {
      const [content, buffer] = await Promise.all([file.text(), file.arrayBuffer()]);
      if (!requestIsCurrent(
        requestId,
        previewRequestIdRef.current,
        controller,
        requestedAccountId,
        accountIdRef.current,
      )) return;
      const contentBase64 = arrayBufferToBase64(buffer);
      const body = {
        conteudo: content,
        conteudo_base64: contentBase64,
        conta_id: requestedAccountId,
        nome_arquivo: file.name,
      };
      const data = await requestJson('/api/fin/ofx/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!requestIsCurrent(
        requestId,
        previewRequestIdRef.current,
        controller,
        requestedAccountId,
        accountIdRef.current,
      )) return;
      setSelectedFile({ name: file.name, content, contentBase64, accountId: requestedAccountId });
      setPreviewAccountId(requestedAccountId);
      setPreview(normalizePreviewPayload(data, file.name));
    } catch (error) {
      if (isAbortError(error) || !requestIsCurrent(
        requestId,
        previewRequestIdRef.current,
        controller,
        requestedAccountId,
        accountIdRef.current,
      )) return;
      setPreview(null);
      setSelectedFile(null);
      setPreviewAccountId('');
      setNotice({ kind: 'error', text: humanizeFinancialError(error, 'Não foi possível ler este OFX.') });
    } finally {
      if (requestId === previewRequestIdRef.current) {
        previewAbortRef.current = null;
        setPreviewing(false);
      }
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const confirmImport = async (accountLinkConfirmed: boolean, legacyCorrectionConfirmed: boolean) => {
    if (!selectedFile || !preview || !previewAccountId) return;
    if (preview.bloqueado) {
      setNotice({ kind: 'error', text: previewBlockingMessage(preview) });
      return;
    }
    if (preview.confirmacao_conta_necessaria && !accountLinkConfirmed) {
      setNotice({ kind: 'error', text: 'Confirme que o extrato pertence à conta selecionada antes de importar.' });
      return;
    }
    const correctionError = correctionConfirmationError(preview, legacyCorrectionConfirmed);
    if (correctionError) {
      setNotice({ kind: 'error', text: correctionError });
      return;
    }
    const importAccountId = previewAccountId;
    if (selectedFile.accountId !== importAccountId || accountIdRef.current !== importAccountId) {
      invalidatePreview();
      setNotice({
        kind: 'error',
        text: 'A conta selecionada mudou depois da prévia. Selecione o OFX novamente para validar o destino correto.',
      });
      return;
    }
    const importFile = selectedFile;
    const importPreview = preview;
    setConfirmingImport(true);
    try {
      const accountConfirmation = importPreview.confirmacao_conta_necessaria && accountLinkConfirmed
        ? { confirmar_vinculo_conta: true }
        : {};
      const result = await requestJson('/api/fin/ofx/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conteudo: importFile.content,
          conteudo_base64: importFile.contentBase64,
          conta_id: importAccountId,
          nome_arquivo: importFile.name,
          ...accountConfirmation,
          ...correctionConfirmationBody(importPreview),
        }),
      }) as ImportResult;
      const imported = Number(result.importadas || 0);
      const duplicated = Number(result.duplicadas || 0);
      const suggested = Number(result.sugeridas || 0);
      setNotice({
        kind: 'success',
        text: `${imported} movimentação(ões) importada(s) · ${duplicated} duplicada(s) · ${suggested} sugestão(ões) para revisar.`,
      });
      const nextFrom = importPreview.periodo?.inicio || from;
      const nextTo = importPreview.periodo?.fim || to;
      setPreview(null);
      setSelectedFile(null);
      setPreviewAccountId('');
      await loadImportHistory(importAccountId, 1);
      if (accountIdRef.current === importAccountId) {
        setFrom(nextFrom);
        setTo(nextTo);
        if (nextFrom === from && nextTo === to) {
          await loadTransactions(importAccountId, nextFrom, nextTo);
        }
      }
    } catch (error) {
      const refreshedPreview = refreshedPreviewFromImportError(error, importFile.name);
      if (refreshedPreview && accountIdRef.current === importAccountId) setPreview(refreshedPreview);
      setNotice({ kind: 'error', text: humanizeFinancialError(error, 'A importação não foi concluída.') });
    } finally {
      setConfirmingImport(false);
    }
  };

  const openRollbackPreview = async (batch: ImportBatch) => {
    const selectedAccountId = accountIdRef.current;
    if (!selectedAccountId || (batch.conta_id && batch.conta_id !== selectedAccountId)) {
      setNotice({ kind: 'error', text: 'Este lote não pertence mais à conta selecionada. Atualize o histórico antes de continuar.' });
      return;
    }
    invalidatePreview();
    closeReconciliation();
    closeTransferReview();
    closeRollbackPreview();
    const requestId = ++rollbackPreviewRequestIdRef.current;
    const controller = new AbortController();
    const context = { batchId: batch.id, accountId: selectedAccountId };
    rollbackPreviewAbortRef.current = controller;
    rollbackContextRef.current = context;
    setRollbackLoadingId(batch.id);
    setRollbackError(null);
    try {
      const data = await requestJson(
        `/api/fin/ofx/importacoes/${encodeURIComponent(batch.id)}/rollback-preview`,
        { signal: controller.signal },
      );
      if (!batchRequestIsCurrent(
        requestId,
        rollbackPreviewRequestIdRef.current,
        controller,
        rollbackContextRef.current,
        batch.id,
        selectedAccountId,
        accountIdRef.current,
      )) return;
      const normalized = normalizeRollbackPreview(data);
      if (!normalized) throw new Error('O servidor não devolveu uma prévia válida para este lote.');
      if (normalized.lote.conta_id && normalized.lote.conta_id !== selectedAccountId) {
        throw new Error('A prévia pertence a outra conta. Atualize o histórico antes de continuar.');
      }
      setRollbackPreview(normalized);
    } catch (error) {
      if (isAbortError(error) || !batchRequestIsCurrent(
        requestId,
        rollbackPreviewRequestIdRef.current,
        controller,
        rollbackContextRef.current,
        batch.id,
        selectedAccountId,
        accountIdRef.current,
      )) return;
      setRollbackPreview(null);
      setNotice({ kind: 'error', text: humanizeFinancialError(error, 'Não foi possível preparar a reversão deste lote.') });
    } finally {
      if (batchRequestIsCurrent(
        requestId,
        rollbackPreviewRequestIdRef.current,
        controller,
        rollbackContextRef.current,
        batch.id,
        selectedAccountId,
        accountIdRef.current,
      )) {
        rollbackPreviewAbortRef.current = null;
        setRollbackLoadingId(null);
      }
    }
  };

  const confirmRollback = async () => {
    const activePreview = rollbackPreview;
    const context = rollbackContextRef.current;
    const selectedAccountId = accountIdRef.current;
    if (!activePreview || !batchContextMatches(context, activePreview.lote.id, selectedAccountId)) {
      setRollbackError('A conta ou o lote mudou desde a prévia. Feche e revise a importação novamente.');
      return;
    }
    const batchId = activePreview.lote.id;
    const requestId = ++rollbackConfirmRequestIdRef.current;
    rollbackConfirmAbortRef.current?.abort();
    const controller = new AbortController();
    rollbackConfirmAbortRef.current = controller;
    setRollbackConfirming(true);
    setRollbackError(null);
    try {
      const data = await requestJson(`/api/fin/ofx/importacoes/${encodeURIComponent(batchId)}/rollback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmar: true, preview_token: activePreview.preview_token }),
        signal: controller.signal,
      }) as Record<string, unknown>;
      if (!batchRequestIsCurrent(
        requestId,
        rollbackConfirmRequestIdRef.current,
        controller,
        rollbackContextRef.current,
        batchId,
        selectedAccountId,
        accountIdRef.current,
      )) return;
      const reverted = readNumber(data, ['revertidas', 'transacoes_revertidas', 'reverted']);
      const blocked = readNumber(data, ['bloqueadas', 'transacoes_bloqueadas', 'blocked']);
      closeRollbackPreview();
      setNotice({
        kind: 'success',
        text: `${reverted} movimentação(ões) desfeita(s) · ${blocked} vínculo(s) preservado(s). O lote continua disponível no histórico.`,
      });
      await Promise.all([
        loadImportHistory(selectedAccountId, importHistoryPagination.page),
        loadTransactions(selectedAccountId, from, to),
      ]);
    } catch (error) {
      if (isAbortError(error) || !batchRequestIsCurrent(
        requestId,
        rollbackConfirmRequestIdRef.current,
        controller,
        rollbackContextRef.current,
        batchId,
        selectedAccountId,
        accountIdRef.current,
      )) return;
      const refreshed = refreshedRollbackPreviewFromError(error);
      if (refreshed && refreshed.lote.id === batchId) setRollbackPreview(refreshed);
      setRollbackError(humanizeFinancialError(error, 'Não foi possível desfazer esta importação.'));
    } finally {
      if (batchRequestIsCurrent(
        requestId,
        rollbackConfirmRequestIdRef.current,
        controller,
        rollbackContextRef.current,
        batchId,
        selectedAccountId,
        accountIdRef.current,
      )) {
        rollbackConfirmAbortRef.current = null;
        setRollbackConfirming(false);
      }
    }
  };

  const reprocess = async () => {
    if (!accountId) return;
    setReprocessing(true);
    try {
      const data = await requestJson('/api/fin/ofx/reprocessar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conta_id: accountId }),
      });
      const record = data as Record<string, unknown>;
      const suggested = readNumber(record, ['sugeridas', 'sugestoes']);
      const reconciled = readNumber(record, ['conciliadas']);
      setNotice({ kind: 'success', text: `Análise atualizada: ${suggested} sugestão(ões) e ${reconciled} conciliação(ões) segura(s).` });
      await loadTransactions(accountId, from, to);
    } catch (error) {
      setNotice({ kind: 'error', text: humanizeFinancialError(error, 'Não foi possível reanalisar as pendências.') });
    } finally {
      setReprocessing(false);
    }
  };

  const openReconciliation = async (transaction: Transacao) => {
    closeReconciliation();
    const requestId = ++reconciliationRequestIdRef.current;
    const scope = viewScopeRef.current;
    const controller = new AbortController();
    reconciliationAbortRef.current = controller;
    reconciliationContextRef.current = { transactionId: transaction.id, scope };
    setReconcileFor(transaction);
    setMode('vincular');
    setCandidates([]);
    setProcessorSettlement(null);
    setCandidateSearch('');
    setNewDescription(transaction.descricao || '');
    setNewCategory('');
    setReconciliationError(null);
    setLoadingCandidates(true);
    try {
      const [candidateData, categoryData] = await Promise.all([
        requestJson(`/api/fin/ofx/candidatos/${transaction.id}`, { signal: controller.signal }),
        requestJson(
          `/api/fin/categorias?tipo=${transaction.tipo === 'credito' ? 'receita' : 'despesa'}`,
          { signal: controller.signal },
        ),
      ]);
      const context = reconciliationContextRef.current;
      if (!requestIsCurrent(
        requestId,
        reconciliationRequestIdRef.current,
        controller,
        scope,
        viewScopeRef.current,
      ) || !transactionContextMatches(context, transaction.id, scope)) return;
      const candidateList = Array.isArray(candidateData) ? candidateData : candidateData?.candidatos;
      setCandidates(Array.isArray(candidateList) ? candidateList : []);
      setProcessorSettlement(normalizeProcessorSettlement(
        candidateData?.decisao?.repasse_infinitepay ?? candidateData?.repasse_infinitepay,
      ));
      setCategories(Array.isArray(categoryData) ? categoryData : []);
    } catch (error) {
      if (isAbortError(error) || !requestIsCurrent(
        requestId,
        reconciliationRequestIdRef.current,
        controller,
        scope,
        viewScopeRef.current,
      )) return;
      const context = reconciliationContextRef.current;
      if (!transactionContextMatches(context, transaction.id, scope)) return;
      setCandidates([]);
      setProcessorSettlement(null);
      setCategories([]);
      setReconciliationError(humanizeFinancialError(error, 'Não foi possível buscar candidatos para esta movimentação.'));
    } finally {
      const context = reconciliationContextRef.current;
      if (requestIsCurrent(
        requestId,
        reconciliationRequestIdRef.current,
        controller,
        scope,
        viewScopeRef.current,
      ) && transactionContextMatches(context, transaction.id, scope)) {
        reconciliationAbortRef.current = null;
        setLoadingCandidates(false);
      }
    }
  };

  const linkCandidate = async (candidate: Candidate) => {
    const transaction = reconcileFor;
    const context = reconciliationContextRef.current;
    if (!transaction || !transactionContextMatches(context, transaction.id, viewScopeRef.current)) {
      setReconciliationError('Esta revisão não corresponde mais à movimentação aberta. Feche e revise novamente.');
      return;
    }
    setSavingReconciliation(true);
    setReconciliationError(null);
    try {
      await requestJson('/api/fin/ofx/conciliar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reconcileBody(transaction, candidate.id, candidate.tipo)),
      });
      if (transactionContextMatches(reconciliationContextRef.current, transaction.id, context.scope)) {
        closeReconciliation();
        setNotice({ kind: 'success', text: 'Movimentação conciliada com o lançamento selecionado.' });
        await loadTransactions(accountId, from, to);
      }
    } catch (error) {
      if (transactionContextMatches(reconciliationContextRef.current, transaction.id, context.scope)) {
        setReconciliationError(humanizeFinancialError(error, 'Não foi possível conciliar esta movimentação.'));
      }
    } finally {
      setSavingReconciliation(false);
    }
  };

  const confirmProcessorSettlement = async (receiptIds: string[]) => {
    const transaction = reconcileFor;
    const context = reconciliationContextRef.current;
    if (!transaction || !receiptIds.length) return;
    if (!transactionContextMatches(context, transaction.id, viewScopeRef.current)) {
      setReconciliationError('Este repasse não corresponde mais à movimentação aberta. Feche e revise novamente.');
      return;
    }
    setSavingReconciliation(true);
    setReconciliationError(null);
    try {
      await requestJson('/api/fin/ofx/transferencia', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transacao_id: transaction.id,
          recebimento_ids: receiptIds,
        }),
      });
      if (transactionContextMatches(reconciliationContextRef.current, transaction.id, context.scope)) {
        closeReconciliation();
        setNotice({ kind: 'success', text: 'Repasse da InfinitePay confirmado com os recebimentos selecionados.' });
        await loadTransactions(accountId, from, to);
      }
    } catch (error) {
      if (transactionContextMatches(reconciliationContextRef.current, transaction.id, context.scope)) {
        setReconciliationError(humanizeFinancialError(error, 'Não foi possível confirmar este repasse.'));
      }
    } finally {
      setSavingReconciliation(false);
    }
  };

  const createEntry = async () => {
    const transaction = reconcileFor;
    const context = reconciliationContextRef.current;
    if (!transaction || !transactionContextMatches(context, transaction.id, viewScopeRef.current)) {
      setReconciliationError('Esta revisão não corresponde mais à movimentação aberta. Feche e revise novamente.');
      return;
    }
    setSavingReconciliation(true);
    setReconciliationError(null);
    try {
      await requestJson('/api/fin/ofx/criar-lancamento', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transacao_id: transaction.id,
          descricao: newDescription,
          categoria_id: newCategory || null,
        }),
      });
      if (transactionContextMatches(reconciliationContextRef.current, transaction.id, context.scope)) {
        closeReconciliation();
        setNotice({ kind: 'success', text: 'Lançamento criado e conciliado.' });
        await loadTransactions(accountId, from, to);
      }
    } catch (error) {
      if (transactionContextMatches(reconciliationContextRef.current, transaction.id, context.scope)) {
        setReconciliationError(humanizeFinancialError(error, 'Não foi possível criar e conciliar o lançamento.'));
      }
    } finally {
      setSavingReconciliation(false);
    }
  };

  const confirmSuggestion = async (transaction: Transacao) => {
    const id = suggestionId(transaction);
    if (!id) {
      await openReconciliation(transaction);
      return;
    }
    setActionId(transaction.id);
    try {
      await requestJson('/api/fin/ofx/conciliar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reconcileBody(transaction, id, suggestionType(transaction))),
      });
      setNotice({ kind: 'success', text: 'Sugestão confirmada.' });
      await loadTransactions(accountId, from, to);
    } catch (error) {
      setNotice({ kind: 'error', text: humanizeFinancialError(error, 'Não foi possível confirmar a sugestão.') });
    } finally {
      setActionId(current => current === transaction.id ? null : current);
    }
  };

  const simpleAction = async (
    transaction: Transacao,
    url: string,
    body: Record<string, unknown>,
    successText: string,
  ) => {
    setActionId(transaction.id);
    try {
      await requestJson(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      setNotice({ kind: 'success', text: successText });
      await loadTransactions(accountId, from, to);
    } catch (error) {
      setNotice({ kind: 'error', text: humanizeFinancialError(error, 'Não foi possível concluir a ação.') });
    } finally {
      setActionId(current => current === transaction.id ? null : current);
    }
  };

  const markTransfer = (transaction: Transacao) => simpleAction(
    transaction,
    '/api/fin/ofx/transferencia',
    { transacao_id: transaction.id, contraparte_id: transaction.contraparte_sugerida_id || undefined },
    'Movimentação classificada como transferência interna.',
  );

  const openTransferReview = async (transaction: Transacao) => {
    closeTransferReview();
    const requestId = ++transferRequestIdRef.current;
    const scope = viewScopeRef.current;
    const controller = new AbortController();
    transferAbortRef.current = controller;
    transferContextRef.current = { transactionId: transaction.id, scope };
    setTransferFor(transaction);
    setTransferCandidates([]);
    setTransferError(null);
    setLoadingTransferCandidates(true);
    try {
      const payload = normalizeTransferCandidates(
        await requestJson(`/api/fin/ofx/candidatos/${transaction.id}`, { signal: controller.signal }),
      );
      const context = transferContextRef.current;
      if (!requestIsCurrent(
        requestId,
        transferRequestIdRef.current,
        controller,
        scope,
        viewScopeRef.current,
      ) || !transactionContextMatches(context, transaction.id, scope)) return;
      if (!payload.supported) {
        closeTransferReview();
        await markTransfer(transaction);
        return;
      }
      setTransferCandidates(payload.candidates);
    } catch (error) {
      if (isAbortError(error) || !requestIsCurrent(
        requestId,
        transferRequestIdRef.current,
        controller,
        scope,
        viewScopeRef.current,
      )) return;
      const context = transferContextRef.current;
      if (!transactionContextMatches(context, transaction.id, scope)) return;
      setTransferCandidates([]);
      setTransferError(humanizeFinancialError(error, 'Não foi possível buscar a outra ponta desta transferência.'));
    } finally {
      const context = transferContextRef.current;
      if (requestIsCurrent(
        requestId,
        transferRequestIdRef.current,
        controller,
        scope,
        viewScopeRef.current,
      ) && transactionContextMatches(context, transaction.id, scope)) {
        transferAbortRef.current = null;
        setLoadingTransferCandidates(false);
      }
    }
  };

  const confirmTransferCandidate = async (candidate: TransferCandidate) => {
    const transaction = transferFor;
    const context = transferContextRef.current;
    const candidateIsCurrent = transferCandidates.some(item => item.id === candidate.id);
    if (!transaction
      || !candidateIsCurrent
      || !transferCandidateIsCompatible(transaction, candidate)
      || !transactionContextMatches(context, transaction.id, viewScopeRef.current)) {
      setTransferError('Esta contraparte não corresponde mais à movimentação aberta. Feche e revise novamente.');
      return;
    }
    setActionId(transaction.id);
    setTransferError(null);
    try {
      await requestJson('/api/fin/ofx/transferencia', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transacao_id: transaction.id,
          contraparte_id: candidate.id,
        }),
      });
      if (transactionContextMatches(transferContextRef.current, transaction.id, context.scope)) {
        closeTransferReview();
        setNotice({ kind: 'success', text: 'Transferência confirmada entre as duas contas.' });
        await loadTransactions(accountId, from, to);
      }
    } catch (error) {
      if (transactionContextMatches(transferContextRef.current, transaction.id, context.scope)) {
        setTransferError(humanizeFinancialError(error, 'Não foi possível confirmar esta transferência.'));
      }
    } finally {
      setActionId(current => current === transaction.id ? null : current);
    }
  };

  const ignoreTransaction = (transaction: Transacao) => simpleAction(
    transaction,
    '/api/fin/ofx/conciliar',
    { transacao_id: transaction.id, ignorar: true },
    'Movimentação ignorada e retirada da fila de revisão.',
  );

  const undoTransaction = (transaction: Transacao) => {
    if (transactionStatus(transaction) === 'transferencia') {
      return simpleAction(
        transaction,
        '/api/fin/ofx/transferencia',
        { transacao_id: transaction.id, desfazer: true },
        'Transferência devolvida para revisão.',
      );
    }
    return simpleAction(
      transaction,
      '/api/fin/ofx/desconciliar',
      { transacao_id: transaction.id },
      'Movimentação devolvida para revisão.',
    );
  };

  if (accountsLoading) {
    return <div className="flex h-48 items-center justify-center text-sm text-gray-400"><RefreshCw className="mr-2 h-4 w-4 animate-spin" />Carregando contas...</div>;
  }

  if (!accounts.length) {
    return (
      <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-12 text-center dark:border-gray-700 dark:bg-gray-900">
        <Landmark className="mx-auto h-9 w-9 text-gray-300 dark:text-gray-600" />
        <h2 className="mt-3 text-base font-semibold text-gray-900 dark:text-white">Cadastre uma conta para começar</h2>
        <p className="mx-auto mt-1 max-w-md text-sm text-gray-500 dark:text-gray-400">Crie Itaú, Nubank e InfinitePay em Configurações. Cada extrato será validado e conciliado dentro da conta correta.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Landmark className="h-5 w-5 text-gray-700 dark:text-gray-300" />
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Conciliação bancária</h2>
          </div>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Extrato e lançamentos lado a lado, com decisões rastreáveis.</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <button onClick={reprocess} disabled={!accountId || reprocessing} className="flex items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800">
            <RefreshCw className={`h-4 w-4 ${reprocessing ? 'animate-spin' : ''}`} />Reanalisar pendências
          </button>
          <input ref={fileRef} type="file" accept=".ofx,.OFX,.qfx,.QFX" onChange={previewFile} className="hidden" />
          <button onClick={() => fileRef.current?.click()} disabled={!accountId || previewing || confirmingImport || rollbackConfirming || Boolean(rollbackPreview)} className="flex items-center justify-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-50 dark:bg-white dark:text-gray-900">
            {previewing ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {previewing ? 'Lendo arquivo...' : 'Pré-visualizar OFX'}
          </button>
        </div>
      </div>

      <div className="grid gap-3 rounded-xl border border-gray-200 bg-white p-3 sm:grid-cols-3 dark:border-gray-700 dark:bg-gray-900">
        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-400">Conta</span>
          <select
            value={accountId}
            disabled={previewing || confirmingImport || Boolean(preview) || rollbackConfirming || Boolean(rollbackPreview)}
            onChange={event => changeAccount(event.target.value)}
            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-800 outline-none focus:border-gray-400 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-200"
          >
            {accounts.map(account => <option key={account.id} value={account.id}>{account.nome}{account.banco ? ` · ${account.banco}` : ''}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-400">De</span>
          <input type="date" value={from} max={to} onChange={event => setFrom(event.target.value)} className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 outline-none focus:border-gray-400 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-200 [color-scheme:light] dark:[color-scheme:dark]" />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-400">Até</span>
          <input type="date" value={to} min={from} onChange={event => setTo(event.target.value)} className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 outline-none focus:border-gray-400 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-200 [color-scheme:light] dark:[color-scheme:dark]" />
        </label>
      </div>

      {notice && (
        <div className={`flex items-start gap-3 rounded-xl border px-4 py-3 text-sm ${notice.kind === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300' : 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-900/20 dark:text-rose-300'}`}>
          {notice.kind === 'success' ? <Check className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />}
          <span className="flex-1">{notice.text}</span>
          <button onClick={() => setNotice(null)}><X className="h-4 w-4" /></button>
        </div>
      )}

      <div className="grid grid-cols-2 divide-x divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 bg-white md:grid-cols-4 md:divide-y-0 dark:divide-gray-700 dark:border-gray-700 dark:bg-gray-900">
        <Metric
          label="Saldo final do extrato"
          value={totals.balance === null ? 'Não informado' : fmtBRL(totals.balance)}
          detail={statementBalanceDate(statementBalance) ? `em ${fmtDate(statementBalanceDate(statementBalance))}` : 'saldo informado pelo banco'}
        />
        <Metric label="Entradas no período" value={fmtBRL(totals.entries)} detail="créditos do extrato" tone="positive" />
        <Metric label="Saídas no período" value={fmtBRL(totals.exits)} detail="débitos do extrato" tone="negative" />
        <Metric label="A revisar" value={`${totals.reviewCount}`} detail={fmtBRL(totals.reviewAmount)} tone="attention" />
      </div>

      <ImportHistoryPanel
        batches={importBatches}
        accountName={selectedAccount?.nome || 'selecionada'}
        loading={importHistoryLoading}
        error={importHistoryError}
        busyBatchId={rollbackLoadingId}
        pagination={importHistoryPagination}
        onRefresh={() => void loadImportHistory(accountId, importHistoryPagination.page)}
        onPage={nextPage => void loadImportHistory(accountId, nextPage)}
        onRollback={batch => void openRollbackPreview(batch)}
      />

      <div className="space-y-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex gap-1 overflow-x-auto pb-1">
            {FILTERS.map(filter => (
              <button key={filter.value} onClick={() => setStatusFilter(filter.value)} className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${statusFilter === filter.value ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900' : 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'}`}>{filter.label}</button>
            ))}
          </div>
          <div className="relative w-full lg:w-72">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
            <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar descrição ou cliente" className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm text-gray-800 outline-none focus:border-gray-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200" />
          </div>
        </div>

        {loading ? (
          <div className="flex h-48 items-center justify-center rounded-xl border border-gray-200 bg-white text-sm text-gray-400 dark:border-gray-700 dark:bg-gray-900"><RefreshCw className="mr-2 h-4 w-4 animate-spin" />Carregando movimentações...</div>
        ) : visibleTransactions.length ? (
          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
            <div className="hidden grid-cols-[92px_minmax(0,1fr)_125px_170px_260px] gap-3 border-b border-gray-100 bg-gray-50/80 px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-400 md:grid dark:border-gray-700 dark:bg-gray-800/50">
              <span>Data</span><span>Movimentação</span><span className="text-right">Valor</span><span>Status</span><span className="text-right">Decisão</span>
            </div>
            {visibleTransactions.map(transaction => {
              const confidence = transactionConfidence(transaction);
              const transactionReasons = reasons(transaction.sugestao_motivos ?? transaction.sugestao?.motivos);
              const linkedReceipts = transactionReceipts(transaction);
              const linkedClients = transactionClientsSummary(transaction);
              return (
                <div key={transaction.id} className="grid gap-3 border-b border-gray-100 px-4 py-4 last:border-0 md:grid-cols-[92px_minmax(0,1fr)_125px_170px_260px] md:items-center dark:border-gray-800">
                  <div>
                    <span className="mb-0.5 block text-[10px] font-semibold uppercase text-gray-400 md:hidden">Data</span>
                    <span className="text-sm text-gray-600 dark:text-gray-300">{fmtDate(transaction.data)}</span>
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-gray-900 dark:text-white">{transaction.descricao || 'Sem descrição'}</p>
                    {linkedClients && (
                      <p className="mt-0.5 truncate text-xs font-medium text-violet-700 dark:text-violet-300">
                        Clientes do repasse: {linkedClients}
                      </p>
                    )}
                    {!linkedClients && (transaction.cliente_nome || transaction.lancamento_descricao) && (
                      <p className="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400">
                        {transaction.cliente_nome || transaction.lancamento_descricao}
                      </p>
                    )}
                    {linkedReceipts.length > 0 && (
                      <div className="mt-1.5 space-y-0.5 text-[11px] text-gray-500 dark:text-gray-400">
                        {linkedReceipts.slice(0, 3).map(receipt => (
                          <p key={receipt.id} className="truncate">
                            {processorReceiptTitle(receipt)} · {fmtBRL(receipt.valor_liquido)}
                            {receipt.data_recebimento_real ? ` · ${fmtDate(receipt.data_recebimento_real)}` : ''}
                          </p>
                        ))}
                        {linkedReceipts.length > 3 && (
                          <p className="font-medium text-violet-600 dark:text-violet-300">
                            + {linkedReceipts.length - 3} recebimento(s) neste repasse
                          </p>
                        )}
                      </div>
                    )}
                    {transactionReasons.length ? (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {transactionReasons.slice(0, 3).map(reason => <span key={reason} className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500 dark:bg-gray-800 dark:text-gray-400">{reasonLabel(reason)}</span>)}
                      </div>
                    ) : null}
                  </div>
                  <div className="md:text-right">
                    <span className="mb-0.5 block text-[10px] font-semibold uppercase text-gray-400 md:hidden">Valor</span>
                    <span className={`text-sm font-semibold ${transaction.tipo === 'credito' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                      {transaction.tipo === 'credito' ? <ArrowDownLeft className="mr-1 inline h-3.5 w-3.5" /> : <ArrowUpRight className="mr-1 inline h-3.5 w-3.5" />}
                      {fmtBRL(transactionValue(transaction))}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5"><StatusBadge transaction={transaction} /><Confidence value={confidence} /></div>
                  <TransactionActions
                    transaction={transaction}
                    busy={actionId === transaction.id}
                    onReview={() => openReconciliation(transaction)}
                    onConfirm={() => confirmSuggestion(transaction)}
                    onTransfer={() => openTransferReview(transaction)}
                    onIgnore={() => ignoreTransaction(transaction)}
                    onUndo={() => undoTransaction(transaction)}
                  />
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-gray-300 bg-white px-6 py-12 text-center dark:border-gray-700 dark:bg-gray-900">
            <FileText className="mx-auto h-8 w-8 text-gray-300 dark:text-gray-600" />
            <p className="mt-3 text-sm font-medium text-gray-700 dark:text-gray-300">Nenhuma movimentação neste recorte</p>
            <p className="mt-1 text-xs text-gray-400">Ajuste conta, período ou filtro — ou pré-visualize um novo OFX.</p>
          </div>
        )}

        {filteredTransactions.length > PAGE_SIZE && (
          <div className="flex flex-col gap-2 text-xs text-gray-500 sm:flex-row sm:items-center sm:justify-between dark:text-gray-400">
            <span>{(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filteredTransactions.length)} de {filteredTransactions.length}</span>
            <div className="flex gap-1">
              <button onClick={() => setPage(current => Math.max(1, current - 1))} disabled={page === 1} className="flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 font-medium disabled:opacity-40 dark:border-gray-700"><ArrowLeft className="h-3.5 w-3.5" />Anterior</button>
              <button onClick={() => setPage(current => Math.min(pageCount, current + 1))} disabled={page === pageCount} className="flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 font-medium disabled:opacity-40 dark:border-gray-700">Próxima<ArrowRight className="h-3.5 w-3.5" /></button>
            </div>
          </div>
        )}
      </div>

      {preview && previewAccountId && selectedFile?.accountId === previewAccountId && (
        <PreviewModal
          preview={preview}
          accountName={previewAccount?.nome || 'Conta validada na prévia'}
          confirming={confirmingImport}
          onCancel={() => {
            if (!confirmingImport) invalidatePreview();
          }}
          onConfirm={confirmImport}
        />
      )}
      {rollbackPreview && rollbackContextRef.current?.accountId === accountId && (
        <RollbackPreviewModal
          preview={rollbackPreview}
          accountName={selectedAccount?.nome || 'Conta selecionada'}
          confirming={rollbackConfirming}
          error={rollbackError}
          onCancel={() => {
            if (!rollbackConfirming) closeRollbackPreview();
          }}
          onConfirm={() => void confirmRollback()}
        />
      )}
      {reconcileFor && (
        <ReconcileModal
          transaction={reconcileFor}
          candidates={candidates}
          processorSettlement={processorSettlement}
          loadingCandidates={loadingCandidates}
          mode={mode}
          search={candidateSearch}
          categories={categories}
          newDescription={newDescription}
          newCategory={newCategory}
          saving={savingReconciliation}
          error={reconciliationError}
          onClose={() => {
            if (!savingReconciliation) closeReconciliation();
          }}
          onMode={setMode}
          onSearch={setCandidateSearch}
          onDescription={setNewDescription}
          onCategory={setNewCategory}
          onLink={linkCandidate}
          onConfirmProcessorSettlement={confirmProcessorSettlement}
          onCreate={createEntry}
        />
      )}
      {transferFor && (
        <TransferSelectionModal
          transaction={transferFor}
          candidates={transferCandidates}
          loading={loadingTransferCandidates}
          saving={actionId === transferFor.id}
          error={transferError}
          onClose={() => {
            if (actionId !== transferFor.id) closeTransferReview();
          }}
          onConfirm={confirmTransferCandidate}
        />
      )}
    </div>
  );
}

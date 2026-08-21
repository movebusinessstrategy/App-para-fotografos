import { createHash } from 'node:crypto';

export type OfxTransactionType = 'credito' | 'debito';

export type OfxMetadata = {
  encoding: string | null;
  charset: string | null;
  bankId: string | null;
  accountId: string | null;
  accountType: string | null;
  currency: string | null;
  dateStart: string | null;
  dateEnd: string | null;
  balanceAmount: number | null;
  balanceDate: string | null;
  availableBalanceAmount: number | null;
};

export type OfxAccountIdentity = {
  bankId: string | null;
  accountId: string | null;
  accountType: string | null;
  statementType: 'bank' | 'credit_card' | 'unknown';
};

export type ParsedOfxTransaction = {
  fitId: string;
  sourceFitId: string | null;
  fingerprint: string;
  type: OfxTransactionType;
  trnType: string | null;
  amount: number;
  signedAmount: number;
  date: string;
  description: string;
  name: string | null;
  memo: string | null;
  counterpartyName: string | null;
  counterpartyDocument: string | null;
  metadata: Record<string, string>;
};

export type RejectedOfxTransaction = {
  index: number;
  fitId: string | null;
  reason: 'missing_date' | 'invalid_date' | 'missing_amount' | 'invalid_amount';
  rawDate: string | null;
  rawAmount: string | null;
};

export type ParsedOfxResult = {
  fileFingerprint: string;
  metadata: OfxMetadata;
  accountIdentities: OfxAccountIdentity[];
  multipleAccounts: false;
  transactions: ParsedOfxTransaction[];
  rejected: RejectedOfxTransaction[];
  ignoredBalance: number;
  totals: {
    credits: number;
    debits: number;
    count: number;
  };
};

export class OfxMultipleAccountsError extends Error {
  readonly code = 'OFX_MULTIPLE_ACCOUNTS';
  readonly statusCode = 422;
  readonly multipleAccounts = true;

  constructor(
    readonly accountIdentities: OfxAccountIdentity[],
    readonly fileFingerprint: string,
  ) {
    super('O arquivo OFX contém mais de uma conta bancária. Importe um extrato por conta.');
    this.name = 'OfxMultipleAccountsError';
  }
}

export class OfxIncompleteAccountIdentityError extends Error {
  readonly code = 'OFX_INCOMPLETE_ACCOUNT_IDENTITY';
  readonly statusCode = 422;
  readonly incompleteAccountIdentity = true;

  constructor(
    readonly accountIdentities: OfxAccountIdentity[],
    readonly fileFingerprint: string,
  ) {
    super('O arquivo OFX possui um bloco de extrato sem identificação completa do banco e da conta. Exporte novamente um extrato identificado.');
    this.name = 'OfxIncompleteAccountIdentityError';
  }
}

type TransactionParseResult =
  | { kind: 'transaction'; transaction: ParsedOfxTransaction }
  | { kind: 'ignored_balance' }
  | { kind: 'rejected'; rejected: Omit<RejectedOfxTransaction, 'index'> };

const MATCH_STOP_WORDS = new Set([
  'banco', 'bank', 'pix', 'recebido', 'recebida', 'enviado', 'enviada', 'transf',
  'transferencia', 'pagamento', 'pgto', 'compra', 'credito', 'debito', 'ted', 'doc',
  'ltda', 'me', 'eireli', 'sa', 'infinitepay', 'infinitypay', 'infinite', 'pay',
]);

const canonicalContent = (content: string): string => String(content ?? '')
  .replace(/^\uFEFF/, '')
  .replace(/\0/g, '')
  .replace(/\r\n?/g, '\n')
  .trim();

const hashText = (value: string): string => createHash('sha256').update(value).digest('hex');

const decodeXmlEntities = (value: string): string => value.replace(
  /&(#x?[0-9a-f]+|amp|lt|gt|quot|apos);/gi,
  (_, entity: string) => {
    const normalized = entity.toLowerCase();
    if (normalized === 'amp') return '&';
    if (normalized === 'lt') return '<';
    if (normalized === 'gt') return '>';
    if (normalized === 'quot') return '"';
    if (normalized === 'apos') return "'";
    const radix = normalized.startsWith('#x') ? 16 : 10;
    const digits = normalized.replace(/^#x?/, '');
    const point = Number.parseInt(digits, radix);
    return Number.isFinite(point) ? String.fromCodePoint(point) : '';
  },
);

const normalizeWhitespace = (value: string): string => decodeXmlEntities(value)
  .replace(/\s+/g, ' ')
  .trim();

const normalizeForMatch = (value: string): string => normalizeWhitespace(value)
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const tagValue = (source: string, tag: string): string | null => {
  const escaped = escapeRegex(tag);
  const pattern = new RegExp(`<\\s*${escaped}\\b[^>]*>\\s*([^<\\r\\n]*)`, 'i');
  const match = source.match(pattern);
  const value = match?.[1] ? normalizeWhitespace(match[1]) : '';
  return value || null;
};

const tagBlock = (source: string, tag: string): string | null => {
  const escaped = escapeRegex(tag);
  const pattern = new RegExp(`<\\s*${escaped}\\b[^>]*>([\\s\\S]*?)<\\s*\\/\\s*${escaped}\\s*>`, 'i');
  return source.match(pattern)?.[1] ?? null;
};

const headerValue = (source: string, header: string): string | null => {
  const escaped = escapeRegex(header);
  const match = source.match(new RegExp(`^\\s*${escaped}\\s*:\\s*([^\\r\\n]+)`, 'im'));
  return match?.[1] ? normalizeWhitespace(match[1]) : null;
};

const transactionBlocks = (source: string): string[] => {
  const starts = [...source.matchAll(/<\s*STMTTRN\b[^>]*>/gi)];
  return starts.map((match, index) => {
    const contentStart = (match.index ?? 0) + match[0].length;
    const nextStart = starts[index + 1]?.index ?? source.length;
    const segment = source.slice(contentStart, nextStart);
    const closingIndex = segment.search(/<\s*\/\s*STMTTRN\s*>/i);
    return closingIndex >= 0 ? segment.slice(0, closingIndex) : segment;
  });
};

type OfxStatementSource = {
  content: string;
  statementType: OfxAccountIdentity['statementType'];
};

const statementTypeFromTag = (tag: string): OfxAccountIdentity['statementType'] => (
  tag.toUpperCase() === 'CCSTMTRS' ? 'credit_card' : 'bank'
);

const statementBlocks = (source: string): OfxStatementSource[] => {
  const starts = [...source.matchAll(/<\s*(CCSTMTRS|STMTRS)\b[^>]*>/gi)];
  return starts.map((match, index) => {
    const tag = match[1];
    const contentStart = (match.index ?? 0) + match[0].length;
    const nextStart = starts[index + 1]?.index ?? source.length;
    const segment = source.slice(contentStart, nextStart);
    const closing = new RegExp(`<\\s*\\/\\s*${escapeRegex(tag)}\\s*>`, 'i');
    const closingIndex = segment.search(closing);
    return {
      content: closingIndex >= 0 ? segment.slice(0, closingIndex) : segment,
      statementType: statementTypeFromTag(tag),
    };
  });
};

const parseCalendarDate = (year: number, month: number, day: number): string | null => {
  const date = new Date(Date.UTC(year, month - 1, day));
  const valid = date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
  return valid ? date.toISOString().slice(0, 10) : null;
};

export const parseOfxDate = (rawValue: unknown): string | null => {
  const raw = String(rawValue ?? '').trim();
  const compactMatch = raw.match(/^(\d{4})(\d{2})(\d{2})/);
  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/);
  const parts = compactMatch ?? isoMatch;
  if (!parts) return null;
  return parseCalendarDate(Number(parts[1]), Number(parts[2]), Number(parts[3]));
};

const canonicalDecimal = (raw: string): string | null => {
  const compact = raw.replace(/\s/g, '');
  if (!/^[+-]?(?:\d+(?:[.,]\d+)*|[.,]\d+)$/.test(compact)) return null;
  const sign = compact.startsWith('-') ? '-' : '';
  const unsigned = compact.replace(/^[+-]/, '');
  const separatorIndex = Math.max(unsigned.lastIndexOf('.'), unsigned.lastIndexOf(','));
  if (separatorIndex < 0) return `${sign}${unsigned}`;
  const integer = unsigned.slice(0, separatorIndex).replace(/[.,]/g, '') || '0';
  const fraction = unsigned.slice(separatorIndex + 1);
  return `${sign}${integer}.${fraction}`;
};

export const parseOfxAmount = (rawValue: unknown): number | null => {
  const canonical = canonicalDecimal(String(rawValue ?? '').trim());
  if (!canonical) return null;
  const amount = Number(canonical);
  return Number.isFinite(amount) ? amount : null;
};

const balanceBlock = (content: string, tag: string): string => tagBlock(content, tag) ?? '';

const parseNullableAmount = (raw: string | null): number | null => {
  if (!raw) return null;
  return parseOfxAmount(raw);
};

const extractMetadata = (content: string): OfxMetadata => {
  const ledger = balanceBlock(content, 'LEDGERBAL');
  const available = balanceBlock(content, 'AVAILBAL');
  return {
    encoding: headerValue(content, 'ENCODING'),
    charset: headerValue(content, 'CHARSET'),
    bankId: tagValue(content, 'BANKID'),
    accountId: tagValue(content, 'ACCTID'),
    accountType: tagValue(content, 'ACCTTYPE'),
    currency: tagValue(content, 'CURDEF'),
    dateStart: parseOfxDate(tagValue(content, 'DTSTART')),
    dateEnd: parseOfxDate(tagValue(content, 'DTEND')),
    balanceAmount: parseNullableAmount(tagValue(ledger || content, 'BALAMT')),
    balanceDate: parseOfxDate(tagValue(ledger || content, 'DTASOF')),
    availableBalanceAmount: parseNullableAmount(tagValue(available, 'BALAMT')),
  };
};

const compactBalanceText = (value: string): string => normalizeForMatch(value).replace(/\s/g, '');

const isBalanceSnapshotText = (value: string | null): boolean => {
  const compact = compactBalanceText(value ?? '');
  return /^saldo(?:$|total|anterior|emconta|final|inicial|atual|disponivel|dodia|dia|contabil|bloqueado)/.test(compact)
    || /^balance(?:$|total|available|current|opening|closing|previous|forward|broughtforward|account|asof|end|beginning)/.test(compact);
};

const isBalanceLine = (name: string | null, memo: string | null): boolean => {
  return isBalanceSnapshotText(name) || isBalanceSnapshotText(memo);
};

const extractDocument = (value: string): string | null => {
  const formatted = value.match(/\b\d{3}[.\s]?\d{3}[.\s]?\d{3}[-\s]?\d{2}\b|\b\d{2}[.\s]?\d{3}[.\s]?\d{3}[\/]?\d{4}[-\s]?\d{2}\b/);
  if (!formatted) return null;
  const digits = formatted[0].replace(/\D/g, '');
  return digits.length === 11 || digits.length === 14 ? digits : null;
};

const cleanCounterpartyName = (value: string): string | null => {
  const withoutPrefixes = value.replace(
    /^(pix|ted|doc|transfer[eê]ncia|transf\.?|pagamento|pgto|cr[eé]dito)\s*(recebid[oa]|enviad[oa])?\s*[-:]?\s*/i,
    '',
  );
  const withoutDocument = withoutPrefixes.replace(/[\d.\-/]{11,18}/g, '');
  const cleaned = normalizeWhitespace(withoutDocument.replace(/\s[-:]\s.*$/, ''));
  return cleaned || null;
};

const hasCounterpartyIdentity = (value: string | null): boolean => {
  if (!value) return false;
  return normalizeForMatch(value)
    .split(' ')
    .some((token) => token.length >= 2 && !MATCH_STOP_WORDS.has(token));
};

const inferCounterpartyName = (name: string | null, memo: string | null): string | null => {
  const cleanedName = name ? cleanCounterpartyName(name) : null;
  if (hasCounterpartyIdentity(cleanedName)) return cleanedName;
  return memo ? cleanCounterpartyName(memo) : cleanedName;
};

const CREDIT_TRANSACTION_TYPES = new Set(['CREDIT', 'DEP', 'DIRECTDEP', 'INT', 'DIV']);
const DEBIT_TRANSACTION_TYPES = new Set([
  'DEBIT', 'FEE', 'SRVCHG', 'ATM', 'POS', 'CHECK', 'PAYMENT', 'CASH',
  'DIRECTDEBIT', 'REPEATPMT',
]);

const transactionDirection = (trnType: string | null, rawAmount: number): OfxTransactionType => {
  const normalizedType = normalizeWhitespace(trnType ?? '').toUpperCase();
  if (CREDIT_TRANSACTION_TYPES.has(normalizedType)) return 'credito';
  if (DEBIT_TRANSACTION_TYPES.has(normalizedType)) return 'debito';
  return rawAmount >= 0 ? 'credito' : 'debito';
};

const amountWithDirection = (amount: number, type: OfxTransactionType): number => (
  type === 'credito' ? Math.abs(amount) : -Math.abs(amount)
);

export type OfxFingerprintInput = {
  bankId?: string | null;
  accountId?: string | null;
  fitId?: string | null;
  date: string;
  signedAmount: number;
  description?: string | null;
  trnType?: string | null;
  checkNumber?: string | null;
  referenceNumber?: string | null;
  name?: string | null;
  memo?: string | null;
  occurrenceOrdinal?: number;
};

export const fingerprintOfxTransaction = (input: OfxFingerprintInput): string => {
  const accountKey = `${normalizeForMatch(input.bankId ?? '')}|${normalizeForMatch(input.accountId ?? '')}`;
  const identity = input.fitId
    ? `fitid|${normalizeWhitespace(input.fitId).toLowerCase()}`
    : [
      'fields', input.date, input.signedAmount.toFixed(2),
      normalizeForMatch(input.trnType ?? ''), normalizeForMatch(input.checkNumber ?? ''),
      normalizeForMatch(input.referenceNumber ?? ''), normalizeForMatch(input.name ?? ''),
      normalizeForMatch(input.memo ?? input.description ?? ''), String(input.occurrenceOrdinal ?? 0),
    ].join('|');
  return hashText(`${accountKey}|${identity}`);
};

const rejection = (
  fitId: string | null,
  rawDate: string | null,
  rawAmount: string | null,
): Omit<RejectedOfxTransaction, 'index'> | null => {
  if (!rawDate) return { fitId, reason: 'missing_date', rawDate, rawAmount };
  if (!parseOfxDate(rawDate)) return { fitId, reason: 'invalid_date', rawDate, rawAmount };
  if (!rawAmount) return { fitId, reason: 'missing_amount', rawDate, rawAmount };
  const amount = parseOfxAmount(rawAmount);
  if (amount === null || amount === 0) return { fitId, reason: 'invalid_amount', rawDate, rawAmount };
  return null;
};

const transactionMetadata = (block: string, occurrenceOrdinal: number): Record<string, string> => {
  const entries = [
    ['checkNumber', tagValue(block, 'CHECKNUM')],
    ['referenceNumber', tagValue(block, 'REFNUM')],
    ['sic', tagValue(block, 'SIC')],
    ['occurrenceOrdinal', String(occurrenceOrdinal)],
  ].filter((entry): entry is [string, string] => Boolean(entry[1]));
  return Object.fromEntries(entries);
};

const parseTransaction = (
  block: string,
  metadata: OfxMetadata,
  occurrenceOrdinal: number,
): TransactionParseResult => {
  const sourceFitId = tagValue(block, 'FITID');
  const rawDate = tagValue(block, 'DTPOSTED');
  const rawAmount = tagValue(block, 'TRNAMT');
  const name = tagValue(block, 'NAME');
  const memo = tagValue(block, 'MEMO');
  if (isBalanceLine(name, memo)) return { kind: 'ignored_balance' };

  const invalid = rejection(sourceFitId, rawDate, rawAmount);
  if (invalid) return { kind: 'rejected', rejected: invalid };

  const date = parseOfxDate(rawDate)!;
  const rawSignedAmount = parseOfxAmount(rawAmount)!;
  const trnType = tagValue(block, 'TRNTYPE');
  const type = transactionDirection(trnType, rawSignedAmount);
  const signedAmount = amountWithDirection(rawSignedAmount, type);
  const checkNumber = tagValue(block, 'CHECKNUM');
  const referenceNumber = tagValue(block, 'REFNUM');
  const description = memo || name || trnType || 'Movimentação bancária';
  const fingerprint = fingerprintOfxTransaction({
    bankId: metadata.bankId,
    accountId: metadata.accountId,
    fitId: sourceFitId,
    date,
    signedAmount,
    description,
    trnType,
    checkNumber,
    referenceNumber,
    name,
    memo,
    occurrenceOrdinal,
  });
  return {
    kind: 'transaction',
    transaction: {
      fitId: sourceFitId || `hash:${fingerprint}`,
      sourceFitId,
      fingerprint,
      type,
      trnType,
      amount: Math.abs(signedAmount),
      signedAmount,
      date,
      description,
      name,
      memo,
      counterpartyName: inferCounterpartyName(name, memo),
      counterpartyDocument: extractDocument(`${name ?? ''} ${memo ?? ''}`),
      metadata: transactionMetadata(block, occurrenceOrdinal),
    },
  };
};

const fallbackOccurrenceKey = (block: string, metadata: OfxMetadata): string => [
  metadata.bankId ?? '', metadata.accountId ?? '', tagValue(block, 'DTPOSTED') ?? '',
  tagValue(block, 'TRNAMT') ?? '', tagValue(block, 'TRNTYPE') ?? '',
  tagValue(block, 'CHECKNUM') ?? '', tagValue(block, 'REFNUM') ?? '',
  tagValue(block, 'NAME') ?? '', tagValue(block, 'MEMO') ?? '',
].map(normalizeForMatch).join('|');

const nextOccurrenceOrdinal = (
  block: string,
  metadata: OfxMetadata,
  occurrences: Map<string, number>,
): number => {
  if (tagValue(block, 'FITID')) return 0;
  const key = fallbackOccurrenceKey(block, metadata);
  const ordinal = occurrences.get(key) ?? 0;
  occurrences.set(key, ordinal + 1);
  return ordinal;
};

const roundMoney = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

const transactionTotals = (transactions: ParsedOfxTransaction[]): ParsedOfxResult['totals'] => ({
  credits: roundMoney(transactions.filter((tx) => tx.type === 'credito').reduce((sum, tx) => sum + tx.amount, 0)),
  debits: roundMoney(transactions.filter((tx) => tx.type === 'debito').reduce((sum, tx) => sum + tx.amount, 0)),
  count: transactions.length,
});

const accountIdentity = (
  metadata: OfxMetadata,
  statementType: OfxAccountIdentity['statementType'],
): OfxAccountIdentity => ({
  bankId: metadata.bankId,
  accountId: metadata.accountId,
  accountType: metadata.accountType,
  statementType,
});

const accountIdentityKey = (identity: OfxAccountIdentity): string => [
  normalizeForMatch(identity.bankId ?? ''),
  normalizeForMatch(identity.accountId ?? ''),
  normalizeForMatch(identity.accountType ?? ''),
  identity.statementType,
].join('|');

const incompleteAccountIdentities = (identities: OfxAccountIdentity[]): OfxAccountIdentity[] => (
  identities.filter((identity) => {
    const missingAccount = !normalizeForMatch(identity.accountId ?? '');
    const missingBank = !normalizeForMatch(identity.bankId ?? '');
    return missingAccount || missingBank;
  })
);

const distinctAccountIdentities = (
  statements: OfxStatementSource[],
  fallbackMetadata: OfxMetadata,
): OfxAccountIdentity[] => {
  if (!statements.length) return [accountIdentity(fallbackMetadata, 'unknown')];
  const unique = new Map<string, OfxAccountIdentity>();
  statements.forEach((statement, index) => {
    const identity = accountIdentity(extractMetadata(statement.content), statement.statementType);
    const naturalKey = accountIdentityKey(identity);
    const key = naturalKey === '|' ? `unknown:${index}` : naturalKey;
    if (!unique.has(key)) unique.set(key, identity);
  });
  return [...unique.values()];
};

const metadataForStatement = (
  statement: OfxStatementSource,
  fallback: OfxMetadata,
): OfxMetadata => {
  const metadata = extractMetadata(statement.content);
  return {
    ...metadata,
    encoding: fallback.encoding,
    charset: fallback.charset,
    bankId: metadata.bankId ?? fallback.bankId,
    accountId: metadata.accountId ?? fallback.accountId,
  };
};

const parseStatementTransactions = (
  statements: OfxStatementSource[],
  fallbackContent: string,
  fallbackMetadata: OfxMetadata,
  onResult: (result: TransactionParseResult, index: number) => void,
): void => {
  const sources = statements.length
    ? statements
    : [{ content: fallbackContent, statementType: 'unknown' as const }];
  const occurrences = new Map<string, number>();
  let transactionIndex = 0;
  sources.forEach((statement) => {
    const metadata = statements.length ? metadataForStatement(statement, fallbackMetadata) : fallbackMetadata;
    transactionBlocks(statement.content).forEach((block) => {
      const ordinal = nextOccurrenceOrdinal(block, metadata, occurrences);
      onResult(parseTransaction(block, metadata, ordinal), transactionIndex);
      transactionIndex += 1;
    });
  });
};

export const parseOfx = (rawContent: string): ParsedOfxResult => {
  const content = canonicalContent(rawContent);
  const metadata = extractMetadata(content);
  const statements = statementBlocks(content);
  const accountIdentities = distinctAccountIdentities(statements, metadata);
  const fileFingerprint = hashText(content);
  const incompleteIdentities = incompleteAccountIdentities(accountIdentities);
  if (incompleteIdentities.length) {
    throw new OfxIncompleteAccountIdentityError(incompleteIdentities, fileFingerprint);
  }
  if (accountIdentities.length > 1) throw new OfxMultipleAccountsError(accountIdentities, fileFingerprint);
  const transactions: ParsedOfxTransaction[] = [];
  const rejected: RejectedOfxTransaction[] = [];
  let ignoredBalance = 0;

  parseStatementTransactions(statements, content, metadata, (parsed, index) => {
    if (parsed.kind === 'transaction') transactions.push(parsed.transaction);
    if (parsed.kind === 'ignored_balance') ignoredBalance += 1;
    if (parsed.kind === 'rejected') rejected.push({ index, ...parsed.rejected });
  });

  return {
    fileFingerprint,
    metadata,
    accountIdentities,
    multipleAccounts: false,
    transactions,
    rejected,
    ignoredBalance,
    totals: transactionTotals(transactions),
  };
};

export type LegacyAccountCorrectionIncoming = {
  fitId: string;
  type: OfxTransactionType;
  amount: number;
  date: string;
};

export type LegacyAccountCorrectionExisting = {
  id: string;
  fitId: string;
  accountId: string;
  type: OfxTransactionType;
  amount: number;
  date: string;
  description?: string | null;
  status?: string | null;
  receiptId?: string | null;
  expenseId?: string | null;
  transferPairId?: string | null;
  allocated?: boolean;
  reverted?: boolean;
  legacyUnconfirmed?: boolean;
};

export type LegacyAccountCorrectionPlan = {
  requiresCorrection: boolean;
  sourceAccountIds: string[];
  reassignTransactionIds: string[];
  linkedTransactionIds: string[];
  balanceSnapshotIds: string[];
  preservedLegacyIds: string[];
  missingIncomingFitIds: string[];
  immutableCollisions: Array<{ fitId: string; existingId: string }>;
  blockedReasons: string[];
};

const sameLegacyBankFact = (
  incoming: LegacyAccountCorrectionIncoming,
  existing: LegacyAccountCorrectionExisting,
): boolean => incoming.type === existing.type
  && Math.round(incoming.amount * 100) === Math.round(existing.amount * 100)
  && incoming.date === existing.date;

const sortedUniqueStrings = (values: string[]): string[] => [...new Set(values)].sort();

export const planLegacyAccountCorrection = (
  targetAccountId: string,
  incomingRows: LegacyAccountCorrectionIncoming[],
  existingRows: LegacyAccountCorrectionExisting[],
): LegacyAccountCorrectionPlan => {
  const incomingByFitId = new Map(incomingRows.map((row) => [row.fitId, row]));
  const targetFitIds = new Set(existingRows
    .filter((row) => !row.reverted && row.accountId === targetAccountId)
    .map((row) => row.fitId));
  const crossRows = existingRows.filter((row) => (
    !row.reverted
    && row.accountId !== targetAccountId
    && row.legacyUnconfirmed === true
    && incomingByFitId.has(row.fitId)
  ));
  const immutableCollisions = crossRows
    .filter((row) => !sameLegacyBankFact(incomingByFitId.get(row.fitId)!, row))
    .map((row) => ({ fitId: row.fitId, existingId: row.id }));
  const movable = crossRows.filter((row) => (
    sameLegacyBankFact(incomingByFitId.get(row.fitId)!, row)
    && !targetFitIds.has(row.fitId)
  ));
  const sourceAccountIds = sortedUniqueStrings(movable.map((row) => row.accountId));
  const sourceRows = existingRows.filter((row) => (
    !row.reverted
    && sourceAccountIds.includes(row.accountId)
    && row.legacyUnconfirmed === true
  ));
  const balanceSnapshotIds = sourceRows
    .filter((row) => (
      !incomingByFitId.has(row.fitId)
      && isBalanceSnapshotText(row.description ?? null)
      && !row.receiptId
      && !row.expenseId
      && !row.transferPairId
      && !row.allocated
      && !['conciliado', 'transferencia'].includes(row.status ?? '')
    ))
    .map((row) => row.id)
    .sort();
  const preservedLegacyIds = sourceRows
    .filter((row) => !incomingByFitId.has(row.fitId) && !isBalanceSnapshotText(row.description ?? null))
    .map((row) => row.id)
    .sort();
  const matchedFitIds = new Set([
    ...existingRows
      .filter((row) => !row.reverted && row.accountId === targetAccountId && incomingByFitId.has(row.fitId))
      .map((row) => row.fitId),
    ...crossRows.map((row) => row.fitId),
  ]);
  const blockedReasons = [
    sourceAccountIds.length > 1 ? 'multiple_source_accounts' : null,
    immutableCollisions.length ? 'immutable_collision' : null,
    crossRows.some((row) => targetFitIds.has(row.fitId)) ? 'fitid_multiple_accounts' : null,
    movable.some((row) => row.transferPairId || row.allocated) ? 'complex_financial_link' : null,
    sourceRows.some((row) => (
      !incomingByFitId.has(row.fitId)
      && isBalanceSnapshotText(row.description ?? null)
      && (
        row.receiptId
        || row.expenseId
        || row.transferPairId
        || row.allocated
        || ['conciliado', 'transferencia'].includes(row.status ?? '')
      )
    )) ? 'linked_balance_snapshot' : null,
    preservedLegacyIds.length ? 'unmatched_legacy_movements' : null,
  ].filter(Boolean) as string[];
  return {
    requiresCorrection: movable.length > 0,
    sourceAccountIds,
    reassignTransactionIds: movable.map((row) => row.id).sort(),
    linkedTransactionIds: movable
      .filter((row) => row.receiptId || row.expenseId)
      .map((row) => row.id)
      .sort(),
    balanceSnapshotIds,
    preservedLegacyIds,
    missingIncomingFitIds: incomingRows
      .filter((row) => !matchedFitIds.has(row.fitId))
      .map((row) => row.fitId)
      .sort(),
    immutableCollisions,
    blockedReasons,
  };
};

export type ReconciliationCandidateKind = 'receita' | 'despesa';

export type ReconciliationTransaction = {
  id: string;
  type: OfxTransactionType;
  amount: number;
  date: string;
  description?: string | null;
  counterpartyName?: string | null;
  accountId?: string | null;
};

export type ReconciliationCandidate = {
  id: string;
  kind: ReconciliationCandidateKind;
  amount: number;
  date: string | null;
  name?: string | null;
  description?: string | null;
  accountId?: string | null;
  available?: boolean;
};

export type ScoredReconciliationCandidate = {
  candidateId: string;
  kind: ReconciliationCandidateKind;
  score: number;
  reasons: string[];
  exactAmount: boolean;
  dateDistanceDays: number | null;
  nameSimilarity: number;
  eligibleForAuto: boolean;
};

export type ReconciliationDecision = {
  status: 'auto' | 'review' | 'unmatched';
  suggestionType: ReconciliationCandidateKind | null;
  suggestionId: string | null;
  score: number | null;
  reasons: string[];
  ambiguous: boolean;
  candidates: ScoredReconciliationCandidate[];
};

export type ReconciliationOptions = {
  strongThreshold?: number;
  reviewThreshold?: number;
  ambiguityMargin?: number;
  maxAutoDateDays?: number;
};

const dateDistanceDays = (left: string | null, right: string | null): number | null => {
  const leftDate = parseOfxDate(left);
  const rightDate = parseOfxDate(right);
  if (!leftDate || !rightDate) return null;
  return Math.abs(Date.parse(`${leftDate}T00:00:00Z`) - Date.parse(`${rightDate}T00:00:00Z`)) / 86_400_000;
};

const matchingTokens = (value: string): Set<string> => new Set(
  normalizeForMatch(value)
    .split(' ')
    .filter((token) => token.length >= 2 && !MATCH_STOP_WORDS.has(token)),
);

const tokenSimilarity = (left: string, right: string): number => {
  const leftTokens = matchingTokens(left);
  const rightTokens = matchingTokens(right);
  if (!leftTokens.size || !rightTokens.size) return 0;
  const overlap = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return overlap / Math.min(leftTokens.size, rightTokens.size);
};

const amountScore = (delta: number, amount: number): number => {
  if (delta <= 0.01) return 55;
  const relative = amount > 0 ? delta / amount : Number.POSITIVE_INFINITY;
  if (relative <= 0.01 && delta <= 5) return 30;
  if (relative <= 0.05) return 10;
  return 0;
};

const dateScore = (distance: number | null): number => {
  if (distance === 0) return 25;
  if (distance === 1) return 20;
  if (distance === 2) return 15;
  if (distance !== null && distance <= 5) return 8;
  if (distance !== null && distance <= 10) return 3;
  return 0;
};

const compatibleDirection = (
  transaction: ReconciliationTransaction,
  candidate: ReconciliationCandidate,
): boolean => (transaction.type === 'credito') === (candidate.kind === 'receita');

const scoreReasons = (
  exactAmount: boolean,
  distance: number | null,
  similarity: number,
  sameAccount: boolean,
  accountConflict: boolean,
): string[] => {
  const reasons: string[] = [];
  if (exactAmount) reasons.push('valor_exato');
  if (distance === 0) reasons.push('mesma_data');
  else if (distance !== null && distance <= 2) reasons.push('data_proxima');
  if (similarity >= 0.55) reasons.push('nome_compativel');
  if (sameAccount) reasons.push('conta_compativel');
  if (accountConflict) reasons.push('conta_divergente');
  return reasons;
};

export const scoreReconciliationCandidate = (
  transaction: ReconciliationTransaction,
  candidate: ReconciliationCandidate,
  options: ReconciliationOptions = {},
): ScoredReconciliationCandidate => {
  const strongThreshold = options.strongThreshold ?? 80;
  const maxAutoDateDays = options.maxAutoDateDays ?? 2;
  const delta = Math.abs(Number(transaction.amount) - Number(candidate.amount));
  const exactAmount = Number.isFinite(delta) && delta <= 0.01;
  const distance = dateDistanceDays(transaction.date, candidate.date);
  const txName = `${transaction.counterpartyName ?? ''} ${transaction.description ?? ''}`;
  const candidateName = `${candidate.name ?? ''} ${candidate.description ?? ''}`;
  const similarity = tokenSimilarity(txName, candidateName);
  const directionMatches = compatibleDirection(transaction, candidate);
  const available = candidate.available !== false;
  const sameAccount = Boolean(transaction.accountId && candidate.accountId === transaction.accountId);
  const accountConflict = Boolean(
    transaction.accountId && candidate.accountId && candidate.accountId !== transaction.accountId,
  );
  const eligibleCandidate = directionMatches && available && !accountConflict;
  const score = eligibleCandidate
    ? Math.min(100, amountScore(delta, Math.abs(Number(transaction.amount))) + dateScore(distance) + Math.round(similarity * 20))
    : 0;
  const eligibleForAuto = exactAmount
    && distance !== null
    && distance <= maxAutoDateDays
    && similarity >= 0.4
    && score >= strongThreshold
    && eligibleCandidate;
  return {
    candidateId: candidate.id,
    kind: candidate.kind,
    score,
    reasons: scoreReasons(exactAmount, distance, similarity, sameAccount, accountConflict),
    exactAmount,
    dateDistanceDays: distance,
    nameSimilarity: similarity,
    eligibleForAuto,
  };
};

const rankCandidates = (
  transaction: ReconciliationTransaction,
  candidates: ReconciliationCandidate[],
  options: ReconciliationOptions,
): ScoredReconciliationCandidate[] => candidates
  .map((candidate) => scoreReconciliationCandidate(transaction, candidate, options))
  .sort((left, right) => right.score - left.score || left.candidateId.localeCompare(right.candidateId));

const decisionStatus = (
  ranked: ScoredReconciliationCandidate[],
  options: ReconciliationOptions,
): Pick<ReconciliationDecision, 'status' | 'ambiguous'> => {
  const top = ranked[0];
  if (!top || top.score < (options.reviewThreshold ?? 50)) return { status: 'unmatched', ambiguous: false };
  const strong = ranked.filter((candidate) => candidate.eligibleForAuto);
  const second = ranked[1];
  const closeSecond = Boolean(second && top.score - second.score < (options.ambiguityMargin ?? 8));
  if (strong.length === 1 && strong[0].candidateId === top.candidateId && !closeSecond) {
    return { status: 'auto', ambiguous: false };
  }
  return { status: 'review', ambiguous: strong.length > 1 || closeSecond };
};

export const decideReconciliation = (
  transaction: ReconciliationTransaction,
  candidates: ReconciliationCandidate[],
  options: ReconciliationOptions = {},
): ReconciliationDecision => {
  const ranked = rankCandidates(transaction, candidates, options);
  const top = ranked[0] ?? null;
  const decision = decisionStatus(ranked, options);
  return {
    ...decision,
    suggestionType: top?.kind ?? null,
    suggestionId: top?.candidateId ?? null,
    score: top?.score ?? null,
    reasons: top?.reasons ?? [],
    candidates: ranked,
  };
};

export type InternalTransferTransaction = {
  id: string;
  accountId: string;
  accountName?: string | null;
  type: OfxTransactionType;
  amount: number;
  date: string;
  description?: string | null;
};

export type InternalTransferPair = {
  pairFingerprint: string;
  outgoingTransactionId: string;
  incomingTransactionId: string;
  fromAccountId: string;
  toAccountId: string;
  amount: number;
  outgoingDate: string;
  incomingDate: string;
  dateDistanceDays: number;
  score: number;
  confidence: 'high';
};

export type InternalTransferResult = {
  pairs: InternalTransferPair[];
  ambiguousTransactionIds: string[];
};

export type InternalTransferOptions = {
  maxDateDistanceDays?: number;
  amountTolerance?: number;
};

type TransferEdge = {
  debit: InternalTransferTransaction;
  credit: InternalTransferTransaction;
  distance: number;
  score: number;
  strongHint: boolean;
};

const hasSpecificTransferHint = (description: string | null | undefined): boolean => (
  /\b(resgate|aplicacao|aplicação)\b/i.test(description ?? '')
);

const mentionsOtherAccount = (
  transaction: InternalTransferTransaction,
  otherAccount: InternalTransferTransaction,
): boolean => {
  const accountName = normalizeForMatch(otherAccount.accountName ?? '');
  if (accountName.length < 4) return false;
  return normalizeForMatch(transaction.description ?? '').includes(accountName);
};

const hasStrongTransferEvidence = (
  debit: InternalTransferTransaction,
  credit: InternalTransferTransaction,
): boolean => hasSpecificTransferHint(debit.description)
  || hasSpecificTransferHint(credit.description)
  || mentionsOtherAccount(debit, credit)
  || mentionsOtherAccount(credit, debit);

const transferEdge = (
  debit: InternalTransferTransaction,
  credit: InternalTransferTransaction,
  options: InternalTransferOptions,
): TransferEdge | null => {
  if (debit.accountId === credit.accountId) return null;
  const tolerance = options.amountTolerance ?? 0.01;
  if (Math.abs(debit.amount - credit.amount) > tolerance) return null;
  const distance = dateDistanceDays(debit.date, credit.date);
  if (distance === null || distance > (options.maxDateDistanceDays ?? 2)) return null;
  const strongHint = hasStrongTransferEvidence(debit, credit);
  return { debit, credit, distance, strongHint, score: 90 - distance * 10 + (strongHint ? 10 : 0) };
};

const transferEdges = (
  transactions: InternalTransferTransaction[],
  options: InternalTransferOptions,
): TransferEdge[] => {
  const debits = transactions.filter((tx) => tx.type === 'debito');
  const credits = transactions.filter((tx) => tx.type === 'credito');
  const edges: TransferEdge[] = [];
  debits.forEach((debit) => credits.forEach((credit) => {
    const edge = transferEdge(debit, credit, options);
    if (edge) edges.push(edge);
  }));
  return edges;
};

const edgeCounts = (edges: TransferEdge[]): Map<string, number> => {
  const counts = new Map<string, number>();
  edges.forEach((edge) => {
    counts.set(edge.debit.id, (counts.get(edge.debit.id) ?? 0) + 1);
    counts.set(edge.credit.id, (counts.get(edge.credit.id) ?? 0) + 1);
  });
  return counts;
};

const transferPairFromEdge = (edge: TransferEdge): InternalTransferPair => ({
  pairFingerprint: hashText([
    edge.debit.id, edge.credit.id, edge.debit.accountId, edge.credit.accountId,
    edge.debit.amount.toFixed(2), edge.debit.date, edge.credit.date,
  ].join('|')),
  outgoingTransactionId: edge.debit.id,
  incomingTransactionId: edge.credit.id,
  fromAccountId: edge.debit.accountId,
  toAccountId: edge.credit.accountId,
  amount: roundMoney(edge.debit.amount),
  outgoingDate: edge.debit.date,
  incomingDate: edge.credit.date,
  dateDistanceDays: edge.distance,
  score: edge.score,
  confidence: 'high',
});

export const detectInternalTransfers = (
  transactions: InternalTransferTransaction[],
  options: InternalTransferOptions = {},
): InternalTransferResult => {
  const edges = transferEdges(transactions, options);
  const counts = edgeCounts(edges);
  const uniqueEdges = edges.filter((edge) => (
    edge.strongHint && counts.get(edge.debit.id) === 1 && counts.get(edge.credit.id) === 1
  ));
  const pairedIds = new Set(uniqueEdges.flatMap((edge) => [edge.debit.id, edge.credit.id]));
  const ambiguousIds = new Set(
    edges.flatMap((edge) => [edge.debit.id, edge.credit.id]).filter((id) => !pairedIds.has(id)),
  );
  return {
    pairs: uniqueEdges.map(transferPairFromEdge),
    ambiguousTransactionIds: [...ambiguousIds].sort(),
  };
};

export type JobProjectionInput = {
  userId: string;
  id: number;
  amount: number | string | null;
  dueDate?: string | null;
  clientId?: string | null;
  clientName?: string | null;
  description?: string | null;
  paymentMethod?: string | null;
};

export type JobPaymentProjectionInput = {
  id: string | number;
  amount: number | string | null;
  paymentDate?: string | null;
  description?: string | null;
  paymentMethod?: string | null;
};

export type ExistingProjectedRevenue = {
  origem_ref?: string | null;
  origem_automatica?: boolean | null;
};

export type ProjectedFinReceitaRow = {
  user_id: string;
  job_id: number;
  cliente_id: string | null;
  cliente_nome: string | null;
  descricao: string;
  valor_bruto: number;
  taxa_meio: number;
  valor_liquido: number;
  data_vencimento: string | null;
  data_pagamento: string | null;
  data_recebimento_real: string | null;
  status: 'pendente' | 'atrasado' | 'recebido';
  parcela: number;
  total_parcelas: number;
  origem_automatica: true;
  origem_ref: string;
};

export type JobRevenueProjection = {
  rows: ProjectedFinReceitaRow[];
  paymentMethodsByOriginRef: Record<string, string | null>;
  staleOriginRefs: string[];
  totalPaid: number;
  remainingBalance: number;
  overpaidAmount: number;
  paymentStatus: 'pending' | 'partial' | 'paid';
  rejectedPaymentIds: string[];
  duplicatePaymentIds: string[];
};

export type JobProjectionOptions = {
  today?: string;
};

const decimalToCents = (value: unknown): number | null => {
  const parsed = typeof value === 'number' ? value : parseOfxAmount(value);
  if (parsed === null || !Number.isFinite(parsed)) return null;
  return Math.round(parsed * 100);
};

export type ProcessorSettlementCredit = {
  id?: string | null;
  type: 'credito';
  amount: number | string;
  date: string;
  description?: string | null;
  counterpartyName?: string | null;
  accountId: string;
};

export type ProcessorSettlementReceipt = {
  id: string;
  netAmount: number | string;
  expectedDate: string;
  intermediaryAccountId?: string | null;
  allocated?: boolean;
};

export type ProcessorSettlementOptions = {
  maxDateDistanceDays?: number;
  maxCandidates?: number;
  maxStates?: number;
};

export type ProcessorSettlementCandidateSet = {
  receiptIds: string[];
  totalAmount: number;
  maxDateDistanceDays: number;
};

export type ProcessorSettlementDecision = {
  status: 'auto' | 'review' | 'unmatched';
  receiptIds: string[];
  candidateSets: ProcessorSettlementCandidateSet[];
  consideredCandidateCount: number;
  truncated: boolean;
  reason:
    | 'unique_set'
    | 'multiple_sets'
    | 'no_exact_set'
    | 'not_processor_credit'
    | 'candidate_limit'
    | 'search_limit'
    | 'invalid_credit';
};

type PreparedSettlementReceipt = {
  id: string;
  cents: number;
  dateDistanceDays: number;
  expectedDate: string;
};

type SubsetSearchResult = {
  paths: number[][];
  truncated: boolean;
};

const processorMentioned = (credit: ProcessorSettlementCredit): boolean => {
  const text = normalizeForMatch(`${credit.counterpartyName ?? ''} ${credit.description ?? ''}`);
  return text.includes('infinitepay')
    || text.includes('infinitypay')
    || text.includes('infinite pay')
    || text.includes('infinity pay');
};

const boundedInteger = (value: unknown, fallback: number, maximum: number): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(maximum, Math.floor(parsed)));
};

const receiptMatchesSettlementAccount = (
  credit: ProcessorSettlementCredit,
  receipt: ProcessorSettlementReceipt,
): boolean => !receipt.intermediaryAccountId
  || receipt.intermediaryAccountId !== credit.accountId;

const prepareSettlementReceipt = (
  credit: ProcessorSettlementCredit,
  receipt: ProcessorSettlementReceipt,
  maxDateDistanceDays: number,
): PreparedSettlementReceipt | null => {
  if (receipt.allocated) return null;
  const id = String(receipt.id ?? '').trim();
  const cents = decimalToCents(receipt.netAmount);
  if (!id || cents === null || cents <= 0) return null;
  if (!receiptMatchesSettlementAccount(credit, receipt)) return null;
  const distance = dateDistanceDays(credit.date, receipt.expectedDate);
  if (distance === null || distance > maxDateDistanceDays) return null;
  return { id, cents, dateDistanceDays: distance, expectedDate: receipt.expectedDate };
};

const prepareSettlementReceipts = (
  credit: ProcessorSettlementCredit,
  receipts: ProcessorSettlementReceipt[],
  maxDateDistanceDays: number,
): PreparedSettlementReceipt[] => {
  const unique = new Map<string, PreparedSettlementReceipt>();
  receipts.forEach((receipt) => {
    const prepared = prepareSettlementReceipt(credit, receipt, maxDateDistanceDays);
    if (prepared && !unique.has(prepared.id)) unique.set(prepared.id, prepared);
  });
  return [...unique.values()].sort((left, right) => (
    left.expectedDate.localeCompare(right.expectedDate) || left.id.localeCompare(right.id)
  ));
};

const mergeSubsetPaths = (existing: number[][] | undefined, incoming: number[][]): number[][] => (
  [...(existing ?? []), ...incoming].slice(0, 2)
);

const boundedSubsetSum = (
  candidates: PreparedSettlementReceipt[],
  targetCents: number,
  maxStates: number,
): SubsetSearchResult => {
  const states = new Map<number, number[][]>([[0, [[]]]]);
  for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
    const candidate = candidates[candidateIndex];
    const snapshot = [...states.entries()];
    for (const [sum, paths] of snapshot) {
      const nextSum = sum + candidate.cents;
      if (nextSum > targetCents) continue;
      const additions = paths.map((path) => [...path, candidateIndex]);
      const merged = mergeSubsetPaths(states.get(nextSum), additions);
      states.set(nextSum, merged);
      if (nextSum === targetCents && merged.length > 1) return { paths: merged, truncated: false };
      if (states.size > maxStates) return { paths: states.get(targetCents) ?? [], truncated: true };
    }
  }
  return { paths: states.get(targetCents) ?? [], truncated: false };
};

const settlementCandidateSet = (
  path: number[],
  candidates: PreparedSettlementReceipt[],
): ProcessorSettlementCandidateSet => {
  const receipts = path.map((index) => candidates[index]);
  const totalCents = receipts.reduce((sum, receipt) => sum + receipt.cents, 0);
  const maxDistance = receipts.reduce((maximum, receipt) => Math.max(maximum, receipt.dateDistanceDays), 0);
  return {
    receiptIds: receipts.map((receipt) => receipt.id),
    totalAmount: totalCents / 100,
    maxDateDistanceDays: maxDistance,
  };
};

const emptySettlementDecision = (
  reason: ProcessorSettlementDecision['reason'],
  consideredCandidateCount = 0,
): ProcessorSettlementDecision => ({
  status: 'unmatched',
  receiptIds: [],
  candidateSets: [],
  consideredCandidateCount,
  truncated: false,
  reason,
});

const settlementSearchDecision = (
  search: SubsetSearchResult,
  candidates: PreparedSettlementReceipt[],
): ProcessorSettlementDecision => {
  const candidateSets = search.paths.map((path) => settlementCandidateSet(path, candidates));
  if (search.truncated) {
    return {
      status: 'review', receiptIds: [], candidateSets,
      consideredCandidateCount: candidates.length, truncated: true, reason: 'search_limit',
    };
  }
  if (candidateSets.length > 1) {
    return {
      status: 'review', receiptIds: [], candidateSets,
      consideredCandidateCount: candidates.length, truncated: false, reason: 'multiple_sets',
    };
  }
  if (!candidateSets.length) return emptySettlementDecision('no_exact_set', candidates.length);
  return {
    status: 'auto',
    receiptIds: candidateSets[0].receiptIds,
    candidateSets,
    consideredCandidateCount: candidates.length,
    truncated: false,
    reason: 'unique_set',
  };
};

export const decideProcessorSettlement = (
  credit: ProcessorSettlementCredit,
  receipts: ProcessorSettlementReceipt[],
  options: ProcessorSettlementOptions = {},
): ProcessorSettlementDecision => {
  if (!processorMentioned(credit)) return emptySettlementDecision('not_processor_credit');
  const targetCents = decimalToCents(credit.amount);
  if (targetCents === null || targetCents <= 0 || !parseOfxDate(credit.date)) {
    return emptySettlementDecision('invalid_credit');
  }
  const maxDateDistanceDays = boundedInteger(options.maxDateDistanceDays, 5, 5);
  const candidates = prepareSettlementReceipts(credit, receipts, maxDateDistanceDays);
  const maxCandidates = boundedInteger(options.maxCandidates, 20, 24);
  if (candidates.length > maxCandidates) {
    return {
      status: 'review', receiptIds: [], candidateSets: [],
      consideredCandidateCount: candidates.length, truncated: true, reason: 'candidate_limit',
    };
  }
  const maxStates = boundedInteger(options.maxStates, 25_000, 100_000);
  const search = boundedSubsetSum(candidates, targetCents, Math.max(100, maxStates));
  return settlementSearchDecision(search, candidates);
};

const validIsoDate = (value: string | null | undefined): string | null => parseOfxDate(value);

const revenueBase = (job: JobProjectionInput) => ({
  user_id: job.userId,
  job_id: job.id,
  cliente_id: job.clientId ?? null,
  cliente_nome: job.clientName?.trim() || null,
  taxa_meio: 0,
  parcela: 1,
  total_parcelas: 1,
  origem_automatica: true as const,
});

const paymentOriginRef = (paymentId: string | number): string => `job_payment:${String(paymentId)}`;
const balanceOriginRef = (jobId: number): string => `job_balance:${jobId}`;

export const normalizePaymentMethod = (rawValue: unknown): string | null => {
  const value = normalizeWhitespace(String(rawValue ?? ''));
  if (!value) return null;
  const normalized = normalizeForMatch(value);
  const isCreditLink = normalized.includes('cartao de credito')
    || normalized.includes('cartao credito')
    || normalized.includes('credit card')
    || normalized === 'credito'
    || normalized.startsWith('credito ')
    || normalized.includes('infinitepay')
    || normalized.includes('infinitypay')
    || normalized === 'link'
    || normalized.includes('link de pagamento');
  return isCreditLink ? 'Link InfinitePay' : value;
};

type PreparedPayment = {
  id: string;
  cents: number;
  paymentDate: string | null;
  description: string | null;
  paymentMethod: string | null;
};

const preparePayments = (payments: JobPaymentProjectionInput[]) => {
  const valid: PreparedPayment[] = [];
  const rejectedPaymentIds: string[] = [];
  const duplicatePaymentIds: string[] = [];
  const seen = new Set<string>();
  payments.forEach((payment) => {
    const id = String(payment.id ?? '').trim();
    const cents = decimalToCents(payment.amount);
    if (!id || cents === null || cents <= 0) {
      rejectedPaymentIds.push(id || '(sem-id)');
      return;
    }
    if (seen.has(id)) {
      duplicatePaymentIds.push(id);
      return;
    }
    seen.add(id);
    valid.push({
      id,
      cents,
      paymentDate: validIsoDate(payment.paymentDate),
      description: payment.description?.trim() || null,
      paymentMethod: normalizePaymentMethod(payment.paymentMethod),
    });
  });
  return { valid, rejectedPaymentIds, duplicatePaymentIds };
};

const paymentRevenueRow = (
  job: JobProjectionInput,
  payment: PreparedPayment,
): ProjectedFinReceitaRow => {
  const amount = payment.cents / 100;
  const dueDate = payment.paymentDate ?? validIsoDate(job.dueDate);
  const baseDescription = job.description?.trim() || job.clientName?.trim() || `Job #${job.id}`;
  return {
    ...revenueBase(job),
    descricao: `${baseDescription} — ${payment.description || 'Pagamento'}`,
    valor_bruto: amount,
    valor_liquido: amount,
    data_vencimento: dueDate,
    data_pagamento: payment.paymentDate,
    data_recebimento_real: payment.paymentDate,
    status: 'recebido',
    origem_ref: paymentOriginRef(payment.id),
  };
};

const balanceStatus = (dueDate: string | null, today: string): 'pendente' | 'atrasado' => (
  dueDate && dueDate < today ? 'atrasado' : 'pendente'
);

const balanceRevenueRow = (
  job: JobProjectionInput,
  remainingCents: number,
  today: string,
): ProjectedFinReceitaRow => {
  const dueDate = validIsoDate(job.dueDate);
  const baseDescription = job.description?.trim() || job.clientName?.trim() || `Job #${job.id}`;
  return {
    ...revenueBase(job),
    descricao: `${baseDescription} — Saldo restante`,
    valor_bruto: remainingCents / 100,
    valor_liquido: remainingCents / 100,
    data_vencimento: dueDate,
    data_pagamento: null,
    data_recebimento_real: null,
    status: balanceStatus(dueDate, today),
    origem_ref: balanceOriginRef(job.id),
  };
};

const projectionPaymentStatus = (
  totalCents: number,
  paidCents: number,
  remainingCents: number,
): JobRevenueProjection['paymentStatus'] => {
  if (paidCents <= 0) return 'pending';
  if (remainingCents <= 0 && (totalCents > 0 || paidCents > 0)) return 'paid';
  return 'partial';
};

const staleProjectionRefs = (
  existing: ExistingProjectedRevenue[],
  desiredRefs: Set<string>,
  jobId: number,
): string[] => {
  const managedPrefixes = [`job_payment:`, `job_balance:${jobId}`];
  return existing
    .filter((row) => row.origem_automatica !== false && Boolean(row.origem_ref))
    .map((row) => row.origem_ref!)
    .filter((ref) => managedPrefixes.some((prefix) => ref.startsWith(prefix)) && !desiredRefs.has(ref));
};

export const projectJobPaymentsToReceitas = (
  job: JobProjectionInput,
  payments: JobPaymentProjectionInput[],
  existingRevenues: ExistingProjectedRevenue[] = [],
  options: JobProjectionOptions = {},
): JobRevenueProjection => {
  const prepared = preparePayments(payments);
  const totalCents = Math.max(0, decimalToCents(job.amount) ?? 0);
  const paidCents = prepared.valid.reduce((sum, payment) => sum + payment.cents, 0);
  const remainingCents = Math.max(0, totalCents - paidCents);
  const overpaidCents = Math.max(0, paidCents - totalCents);
  const rows = prepared.valid.map((payment) => paymentRevenueRow(job, payment));
  const today = validIsoDate(options.today) ?? new Date().toISOString().slice(0, 10);
  if (remainingCents > 0) rows.push(balanceRevenueRow(job, remainingCents, today));
  const paymentMethodsByOriginRef = Object.fromEntries(
    prepared.valid.map((payment) => [paymentOriginRef(payment.id), payment.paymentMethod]),
  );
  const desiredRefs = new Set(rows.map((row) => row.origem_ref));
  return {
    rows,
    paymentMethodsByOriginRef,
    staleOriginRefs: staleProjectionRefs(existingRevenues, desiredRefs, job.id),
    totalPaid: paidCents / 100,
    remainingBalance: remainingCents / 100,
    overpaidAmount: overpaidCents / 100,
    paymentStatus: projectionPaymentStatus(totalCents, paidCents, remainingCents),
    rejectedPaymentIds: prepared.rejectedPaymentIds,
    duplicatePaymentIds: prepared.duplicatePaymentIds,
  };
};

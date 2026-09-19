// Regras de etapa do funil de vendas, sem banco. O rastreador e a cadência só
// andam para frente e nunca mexem em etapa fechada ou de produção.

export interface StageRow { id: string; name: string; position: number; is_final: boolean | null; is_won: boolean | null; process_id?: string | null }
export interface StageHistoryEntry { stage_id: string; stage_name: string; entered_at: string; left_at: string | null }

function positionOf(s: StageRow): number {
  return Number(s.position) || 0;
}

export function isSalesStage(s: StageRow): boolean {
  return !s.id.startsWith('prod-') && !s.process_id;
}

export function isClosedStage(s: StageRow | undefined): boolean {
  if (!s) return true;
  return !!(s.is_final || s.is_won) || s.id === 'won' || s.id === 'lost';
}

export function isLostStage(s: StageRow | undefined): boolean {
  if (!s) return false;
  return !!(s.is_final && !s.is_won) || s.id === 'lost';
}

function isOpenSalesStage(s: StageRow | undefined): s is StageRow {
  return !!s && isSalesStage(s) && !isClosedStage(s);
}

export function canMoveForward(fromId: string, toId: string, stages: StageRow[]): boolean {
  const from = stages.find((s) => s.id === fromId);
  const to = stages.find((s) => s.id === toId);
  if (!isOpenSalesStage(from) || !isOpenSalesStage(to)) return false;
  return positionOf(to) > positionOf(from);
}

function isHistoryEntry(entry: unknown): entry is StageHistoryEntry {
  return !!entry && typeof entry === 'object' && typeof (entry as { stage_id?: unknown }).stage_id === 'string';
}

function historyArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== 'string') return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// deals.stage_history às vezes vem como STRING JSON (gravado por código antigo).
export function parseStageHistory(raw: unknown): StageHistoryEntry[] {
  return historyArray(raw).filter(isHistoryEntry).map((entry) => ({ ...entry }));
}

export function appendStageHistory(raw: unknown, stageId: string, stageName: string, nowIso: string): StageHistoryEntry[] {
  const history = parseStageHistory(raw);
  const last = history[history.length - 1];
  if (last && last.stage_id === stageId && !last.left_at) return history;
  if (last && !last.left_at) last.left_at = nowIso;
  history.push({ stage_id: stageId, stage_name: stageName, entered_at: nowIso, left_at: null });
  return history;
}

export function firstOpenSalesStage(stages: StageRow[]): StageRow | null {
  const open = stages.filter(isOpenSalesStage).sort((a, b) => {
    const byPosition = positionOf(a) - positionOf(b);
    if (byPosition !== 0) return byPosition;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return open[0] ?? null;
}

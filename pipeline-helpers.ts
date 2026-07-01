import { randomUUID } from 'crypto';
import { SupabaseClient } from '@supabase/supabase-js';

import { Deal, DealStage, DealTemperature, PipelineAnalytics, PipelineStage } from './src/types';

export const DEFAULT_STAGES: PipelineStage[] = [
  { id: 'lead', name: 'Lead Novo', color: '#E0F2FE', position: 0, is_final: false, is_won: false },
  { id: 'contact', name: 'Contato Feito', color: '#DBEAFE', position: 1, is_final: false, is_won: false },
  { id: 'proposal', name: 'Proposta Enviada', color: '#FEF3C7', position: 2, is_final: false, is_won: false },
  { id: 'negotiation', name: 'Em Negociação', color: '#F3E8FF', position: 3, is_final: false, is_won: false },
  { id: 'won', name: 'Fechado Ganho', color: '#DCFCE7', position: 4, is_final: true, is_won: true },
  { id: 'lost', name: 'Perdido', color: '#FEE2E2', position: 5, is_final: true, is_won: false },
];

// IDs prefixados com "prod-" para distinguir de etapas de vendas na mesma tabela.
// Padrão MÍNIMO pra contas novas: 2 etapas genéricas — o usuário renomeia/expande
// como quiser depois. Contas existentes (que já têm etapas no banco) não são afetadas.
export const DEFAULT_PRODUCTION_STAGES: PipelineStage[] = [
  { id: 'prod-etapa-1', name: 'Etapa 1', color: '#94a3b8', position: 0, is_final: false, is_won: false },
  { id: 'prod-etapa-2', name: 'Etapa 2', color: '#22c55e', position: 1, is_final: true,  is_won: true  },
];

const normalizeStage = (stage: any, fallback: PipelineStage): PipelineStage => ({
  id: String(stage.id ?? fallback.id),
  name: stage.name ?? fallback.name,
  color: stage.color ?? fallback.color,
  position: Number(stage.position ?? fallback.position),
  is_final: Boolean(stage.is_final ?? fallback.is_final),
  is_won: Boolean(stage.is_won ?? fallback.is_won),
  follow_up_message: stage.follow_up_message ?? null,
  auto_follow_up_enabled: Boolean(stage.auto_follow_up_enabled ?? false),
  follow_up_delay_hours: Number(stage.follow_up_delay_hours ?? 2),
  follow_up_template_id: stage.follow_up_template_id ?? null,
});

// A PRIMARY KEY de deal_stages/production_processes é o `id` SOZINHO (global, não
// por tenant). Portanto os ids padrão ('lead','won','proc-1','prod-etapa-1'...) só
// cabem UMA vez no sistema inteiro — a 1ª conta os pega e as demais falham no
// INSERT (duplicate key) e caem em defaults em memória (nunca persistem). Era a
// causa real de "só funciona pra 1 conta". Todo seed passa a usar id único por
// usuário: o user_id garante unicidade global.
const tid = (baseId: string, userId: string) => `${baseId}-${userId}`;

// Etapas de produção: IDs começam com "prod-"
export const ensureProductionStages = async (supabase: SupabaseClient, userId: string): Promise<PipelineStage[]> => {
  try {
    const { data, error } = await supabase
      .from('deal_stages')
      .select('*')
      .eq('user_id', userId)
      .like('id', 'prod-%')
      .order('position');

    if (error) {
      console.warn('[production stages] fallback to defaults:', error.message);
      return DEFAULT_PRODUCTION_STAGES;
    }

    if (!data || data.length === 0) {
      // IMPORTANTE: semeia COMPATÍVEL com a V2. O board de produção (V2) filtra
      // process_id não-nulo; se a V1 semear SEM process_id, essas linhas ficam
      // invisíveis pro board E colidem quando a V2 tenta reinserir os mesmos ids
      // (era a causa do "ganho some da produção" em contas novas). Por isso
      // garantimos o processo e semeamos com o process_id do processo padrão.
      const procs = await ensureProductionProcesses(supabase, userId);
      const procId = (procs as any[]).find((p) => !p.is_special)?.id || (procs as any[])[0]?.id || tid('proc-1', userId);
      const payload = DEFAULT_PRODUCTION_STAGES_V2.map((s) => ({ ...s, id: tid(s.id, userId), process_id: procId, user_id: userId }));
      const { error: insertError } = await supabase.from('deal_stages').insert(payload);
      if (insertError) {
        console.warn('Não foi possível inserir etapas de produção padrão:', insertError.message);
      }
      return payload as any;
    }

    return data.map((row: any) => {
      const fallback = DEFAULT_PRODUCTION_STAGES.find((s) => s.id === row.id) || DEFAULT_PRODUCTION_STAGES[0];
      return normalizeStage(row, fallback);
    });
  } catch (err) {
    console.error('ensureProductionStages error', err);
    return DEFAULT_PRODUCTION_STAGES;
  }
};

// Etapas de vendas: IDs que NÃO começam com "prod-"
export const ensurePipelineStages = async (supabase: SupabaseClient, userId: string): Promise<PipelineStage[]> => {
  try {
    const { data, error } = await supabase
      .from('deal_stages')
      .select('*')
      .eq('user_id', userId)
      .not('id', 'like', 'prod-%')
      .order('position');

    if (error) {
      console.warn('[deal_stages] fallback to defaults:', error.message);
      return DEFAULT_STAGES;
    }

    if (!data || data.length === 0) {
      const payload = DEFAULT_STAGES.map((s) => ({ ...s, id: tid(s.id, userId), user_id: userId }));
      const { error: insertError } = await supabase.from('deal_stages').insert(payload);
      if (insertError) {
        console.warn('Não foi possível inserir etapas padrão:', insertError.message);
      }
      return payload;
    }

    return data.map((row: any) => {
      const fallback = DEFAULT_STAGES.find((s) => s.id === row.id) || DEFAULT_STAGES[0];
      return normalizeStage(row, fallback);
    });
  } catch (err) {
    console.error('ensurePipelineStages error', err);
    return DEFAULT_STAGES;
  }
};

// Garante que a conta tenha uma etapa de GANHO (is_won) e uma de PERDA
// (is_final && !is_won). Contas que refizeram o funil podiam ficar SEM etapa de
// ganho — aí o convert mandava o negócio pra uma etapa "won" órfã (que não
// existia no funil) e o ganho sumia; a extensão nem mostrava a coluna de ganho.
// Idempotente: no caso normal (já tem ganho E perda) NÃO escreve nada. Recebe as
// stages já carregadas (de ensurePipelineStages) pra não fazer query extra.
const WON_NAME_RE = /ganho|ganhou|fechad|vendid|conclu|convert|won/i;
const LOST_NAME_RE = /perd|cancel|sem interesse|desist|lost/i;
// Evita casar "não convertido"/"sem fechar" como ganho (falso positivo do WON_RE).
const NEG_NAME_RE = /\bn[ãa]o\b|\bsem\b/i;
// Match forte de ganho — preferido quando há vários candidatos.
const STRONG_WON_RE = /ganho|convertid|vendid|fechad/i;

export const ensureWonLostStages = async (
  supabase: SupabaseClient,
  userId: string,
  stages: PipelineStage[],
): Promise<PipelineStage[]> => {
  const list = Array.isArray(stages) ? stages.map((s) => ({ ...s })) : [];
  const hasWon = list.some((s) => s.is_won);
  const hasLost = list.some((s) => s.is_final && !s.is_won);
  if (hasWon && hasLost) return list; // caso normal: nada a fazer

  const ops: any[] = [];
  try {
    if (!hasWon) {
      const wonCands = list.filter((s) =>
        WON_NAME_RE.test(s.name || '') && !LOST_NAME_RE.test(s.name || '') && !NEG_NAME_RE.test(s.name || ''));
      const cand = wonCands.find((s) => STRONG_WON_RE.test(s.name || '')) || wonCands[0];
      if (cand) {
        cand.is_won = true;
        cand.is_final = true;
        ops.push(
          supabase.from('deal_stages')
            .update({ is_won: true, is_final: true })
            .eq('id', cand.id).eq('user_id', userId),
        );
      } else {
        // Cria a etapa de ganho com id ÚNICO por tenant (a PK de deal_stages é
        // global; um id 'won' fixo só caberia em uma conta no sistema todo).
        const id = `${tid('won', userId)}-${randomUUID().slice(0, 4)}`;
        const position = list.length ? Math.max(...list.map((s) => Number(s.position ?? 0))) + 1 : 0;
        const row: any = { id, name: 'Fechado Ganho', color: '#DCFCE7', position, is_final: true, is_won: true, user_id: userId };
        ops.push(supabase.from('deal_stages').insert(row));
        list.push(normalizeStage(row, DEFAULT_STAGES[4]));
      }
    }
    if (!hasLost) {
      const cand = list.find((s) => !s.is_won && LOST_NAME_RE.test(s.name || ''));
      if (cand && !cand.is_final) {
        cand.is_final = true;
        ops.push(
          supabase.from('deal_stages')
            .update({ is_final: true })
            .eq('id', cand.id).eq('user_id', userId),
        );
      }
    }
    if (ops.length) await Promise.all(ops);
  } catch (err) {
    console.warn('ensureWonLostStages skipped', (err as any)?.message || err);
  }
  return list;
};

export const fetchActivityMetrics = async (
  supabase: SupabaseClient,
  userId: string,
  dealIds: number[],
) => {
  if (dealIds.length === 0) return new Map<number, { count: number; last: string | null }>();

  try {
    const { data, error } = await supabase
      .from('deal_activities')
      .select('deal_id, created_at')
      .in('deal_id', dealIds)
      .eq('user_id', userId);

    if (error) {
      console.warn('fetchActivityMetrics', error.message);
      return new Map();
    }

    const map = new Map<number, { count: number; last: string | null }>();
    (data || []).forEach((row: any) => {
      const entry = map.get(row.deal_id) || { count: 0, last: null as string | null };
      entry.count += 1;
      if (!entry.last || new Date(row.created_at) > new Date(entry.last)) {
        entry.last = row.created_at;
      }
      map.set(row.deal_id, entry);
    });
    return map;
  } catch (err) {
    console.error('fetchActivityMetrics error', err);
    return new Map();
  }
};

export const calculateTemperature = (
  deal: Deal,
  activity: { count: number; last: string | null } | undefined,
): { temperature: DealTemperature; score: number } => {
  if (deal.temperature_locked && deal.temperature) {
    return { temperature: deal.temperature as DealTemperature, score: deal.temperature_score || 0 };
  }

  const today = new Date();
  const lastActivity = activity?.last ? new Date(activity.last) : null;
  const daysSinceActivity = lastActivity ? (today.getTime() - lastActivity.getTime()) / (1000 * 60 * 60 * 24) : 999;
  const hasFollowUp = !!deal.next_follow_up;
  const followUpDate = deal.next_follow_up ? new Date(deal.next_follow_up) : null;
  const followUpOverdue = followUpDate ? followUpDate < today : false;

  let score = 20; // base
  score += Math.min(activity?.count || 0, 6) * 8;
  if (deal.value) score += Math.min(deal.value / 1000, 10);
  if (hasFollowUp) score += 10;
  if (followUpOverdue) score -= 20;
  if (daysSinceActivity < 2) score += 25;
  else if (daysSinceActivity < 7) score += 10;
  else if (daysSinceActivity > 14) score -= 15;

  const temperature: DealTemperature = score >= 65 ? 'hot' : score >= 40 ? 'warm' : 'cold';
  return { temperature, score: Math.round(score) };
};

export const recordStageEvent = async (
  supabase: SupabaseClient,
  userId: string,
  dealId: number,
  from_stage: DealStage | null,
  to_stage: DealStage,
  enteredAt?: string | null,
) => {
  try {
    const payload: any = {
      deal_id: dealId,
      from_stage,
      to_stage,
      user_id: userId,
    };

    if (enteredAt) {
      const durationMs = Date.now() - new Date(enteredAt).getTime();
      if (!Number.isNaN(durationMs)) payload.duration_ms = Math.max(durationMs, 0);
    }

    await supabase.from('deal_stage_events').insert(payload);
  } catch (err) {
    console.warn('recordStageEvent skipped', (err as any)?.message || err);
  }
};

export const computePipelineAnalytics = (
  deals: Deal[],
  stages: PipelineStage[],
  events: any[] = [],
): PipelineAnalytics => {
  const finalDeals = deals.filter((d) => stages.find((s) => s.id === d.stage)?.is_final);
  const wonDeals = finalDeals.filter((d) => stages.find((s) => s.id === d.stage)?.is_won);
  const conversionRate = finalDeals.length > 0 ? wonDeals.length / finalDeals.length : 0;

  const conversionByStage = stages.map((stage) => {
    const fromCount = events.filter((e) => e.from_stage === stage.id).length;
    const toCount = events.filter((e) => e.to_stage === stage.id).length;
    const rate = fromCount > 0 ? toCount / fromCount : 0;
    return { stageId: stage.id, rate, from: fromCount, to: toCount };
  });

  const now = Date.now();
  const stalledDeals = deals.filter((d) => {
    const entered = d.stage_entered_at || d.updated_at;
    const diffDays = entered ? (now - new Date(entered).getTime()) / (1000 * 60 * 60 * 24) : 0;
    return diffDays >= 7 && !stages.find((s) => s.id === d.stage)?.is_final;
  }).length;

  const avgStageTime = stages.map((stage) => {
    const inStage = deals.filter((d) => d.stage === stage.id);
    if (inStage.length === 0) return { stageId: stage.id, hours: 0 };
    const totalMs = inStage.reduce((sum, d) => {
      const entered = d.stage_entered_at || d.updated_at;
      if (!entered) return sum;
      return sum + Math.max(now - new Date(entered).getTime(), 0);
    }, 0);
    return { stageId: stage.id, hours: Math.round(totalMs / inStage.length / (1000 * 60 * 60)) };
  });

  const lostReasons: Record<string, number> = {};
  deals.forEach((d) => {
    if (d.lost_reason) lostReasons[d.lost_reason] = (lostReasons[d.lost_reason] || 0) + 1;
  });

  const temperatureDistribution: Record<DealTemperature, number> = { cold: 0, warm: 0, hot: 0 };
  deals.forEach((d) => {
    if (d.temperature === 'hot') temperatureDistribution.hot += 1;
    else if (d.temperature === 'warm') temperatureDistribution.warm += 1;
    else temperatureDistribution.cold += 1;
  });

  const forecastHotValue = deals
    .filter((d) => d.temperature === 'hot' && !stages.find((s) => s.id === d.stage)?.is_final)
    .reduce((sum, d) => sum + (d.value || 0), 0);

  const overdueFollowUps = deals.filter((d) => {
    if (!d.next_follow_up) return false;
    const next = new Date(d.next_follow_up);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return next < today && !stages.find((s) => s.id === d.stage)?.is_final;
  }).length;

  return {
    conversionRate,
    conversionByStage,
    stalledDeals,
    avgStageTime,
    lostReasons,
    temperatureDistribution,
    forecastHotValue,
    overdueFollowUps,
  };
};

export const stageIdOrDefault = (stages: PipelineStage[], maybe: DealStage | undefined | null) => {
  const ids = stages.map((s) => s.id);
  if (maybe && ids.includes(maybe)) return maybe;
  return stages[0]?.id || DEFAULT_STAGES[0].id;
};

export const createStageId = (name: string) => {
  const slug = name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  return slug || randomUUID();
};

// ========= PRODUCTION PROCESSES & STAGES V2 =========

export interface ProductionProcessDef {
  id: string;
  name: string;
  position: number;
  color: string;
}

export interface ProductionStageDef {
  id: string;
  name: string;
  position: number;
  color: string;
  process_id: string;
  expected_hours: number;
  is_final: boolean;
  is_won: boolean;
}

// Padrão MÍNIMO pra contas novas: 1 processo genérico (o usuário renomeia/expande).
// Os 6 processos detalhados antigos viraram nomes específicos demais —
// melhor deixar o user montar do zero a estrutura que faz sentido pro estúdio dele.
export const DEFAULT_PRODUCTION_PROCESSES: ProductionProcessDef[] = [
  { id: 'proc-1', name: 'Processo', position: 0, color: '#94a3b8' },
];

// Padrão MÍNIMO pra contas novas: 2 etapas genéricas no processo único.
// As 34 etapas anteriores eram opiniões fortes sobre fluxo (Fila de Edição,
// Vídeo a fazer, Avisou cliente, etc) — cada estúdio tem o próprio jeito.
// User configura/expande depois pelo Customizer.
export const DEFAULT_PRODUCTION_STAGES_V2: ProductionStageDef[] = [
  { id: 'prod-etapa-1', name: 'Etapa 1', position: 0, process_id: 'proc-1', color: '#94a3b8', is_final: false, is_won: false, expected_hours: 0 },
  { id: 'prod-etapa-2', name: 'Etapa 2', position: 1, process_id: 'proc-1', color: '#22c55e', is_final: true,  is_won: true,  expected_hours: 0 },
];

export const ensureProductionProcesses = async (supabase: SupabaseClient, userId: string): Promise<ProductionProcessDef[]> => {
  try {
    const { data, error } = await supabase
      .from('production_processes')
      .select('*')
      .eq('user_id', userId)
      .order('position');

    if (error) {
      console.warn('[production processes] error:', error.message);
      return DEFAULT_PRODUCTION_PROCESSES;
    }

    if (!data || data.length === 0) {
      const payload = DEFAULT_PRODUCTION_PROCESSES.map(p => ({ ...p, id: tid(p.id, userId), user_id: userId }));
      const { error: insErr } = await supabase.from('production_processes').insert(payload);
      if (insErr) console.warn('Não foi possível inserir processos padrão:', insErr.message);
      return payload;
    }

    return data;
  } catch (err) {
    console.error('ensureProductionProcesses error', err);
    return DEFAULT_PRODUCTION_PROCESSES;
  }
};

export const ensureProductionStagesV2 = async (supabase: SupabaseClient, userId: string): Promise<ProductionStageDef[]> => {
  try {
    let { data, error } = await supabase
      .from('deal_stages')
      .select('*')
      .eq('user_id', userId)
      .like('id', 'prod-%')
      .not('process_id', 'is', null)
      .order('position');

    if (error) {
      console.warn('[production stages v2] error:', error.message);
      return DEFAULT_PRODUCTION_STAGES_V2;
    }

    if (!data || data.length === 0) {
      const procs = await ensureProductionProcesses(supabase, userId);
      const procId = (procs as any[]).find((p) => !p.is_special)?.id || (procs as any[])[0]?.id || tid('proc-1', userId);
      // SELF-HEAL: se existem etapas prod-% ÓRFÃS (process_id nulo — semeadas pela
      // V1 antiga ao abrir "Configurar etapas"), NÃO tenta reinserir os mesmos ids
      // (colidiria por PK e o board ficaria vazio). Em vez disso, vincula-as ao
      // primeiro processo. Só quando NÃO há órfãs é que semeia as etapas padrão.
      const { data: orphans } = await supabase
        .from('deal_stages')
        .select('id')
        .eq('user_id', userId)
        .like('id', 'prod-%')
        .is('process_id', null);
      if (orphans && orphans.length > 0) {
        await supabase
          .from('deal_stages')
          .update({ process_id: procId })
          .eq('user_id', userId)
          .like('id', 'prod-%')
          .is('process_id', null);
      } else {
        // IDs únicos por tenant — a PK de deal_stages é global (id sozinho), então
        // 'prod-etapa-1' fixo só caberia em UMA conta no sistema todo.
        const payload = DEFAULT_PRODUCTION_STAGES_V2.map(s => ({ ...s, id: tid(s.id, userId), process_id: procId, user_id: userId }));
        const { error: insertError } = await supabase.from('deal_stages').insert(payload);
        if (insertError) console.warn('Não foi possível inserir etapas v2:', insertError.message);
      }
      // Re-lê o estado REAL persistido (não confia em defaults em memória, que era
      // o que fazia o job cair numa etapa que não existia no banco).
      const reread = await supabase
        .from('deal_stages')
        .select('*')
        .eq('user_id', userId)
        .like('id', 'prod-%')
        .not('process_id', 'is', null)
        .order('position');
      data = reread.data || [];
      if (!data.length) return DEFAULT_PRODUCTION_STAGES_V2;
    }

    return data.map((row: any) => ({
      id: row.id,
      name: row.name,
      position: Number(row.position ?? 0),
      color: row.color ?? '#94a3b8',
      process_id: row.process_id,
      expected_hours: Number(row.expected_hours ?? 0),
      is_final: Boolean(row.is_final),
      is_won: Boolean(row.is_won),
    }));
  } catch (err) {
    console.error('ensureProductionStagesV2 error', err);
    return DEFAULT_PRODUCTION_STAGES_V2;
  }
};

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

// IDs prefixados com "prod-" para distinguir de etapas de vendas na mesma tabela
export const DEFAULT_PRODUCTION_STAGES: PipelineStage[] = [
  { id: 'prod-agendado', name: 'Agendado', color: '#22c55e', position: 0, is_final: false, is_won: false },
  { id: 'prod-ensaio-realizado', name: 'Ensaio Realizado', color: '#fbbf24', position: 1, is_final: false, is_won: false },
  { id: 'prod-em-edicao', name: 'Em Edição', color: '#3b82f6', position: 2, is_final: false, is_won: false },
  { id: 'prod-entregue', name: 'Entregue', color: '#a855f7', position: 3, is_final: true, is_won: true },
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
});

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
      const payload = DEFAULT_PRODUCTION_STAGES.map((s) => ({ ...s, user_id: userId }));
      const { error: insertError } = await supabase.from('deal_stages').insert(payload);
      if (insertError) {
        console.warn('Não foi possível inserir etapas de produção padrão:', insertError.message);
      }
      return DEFAULT_PRODUCTION_STAGES;
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
      const payload = DEFAULT_STAGES.map((s) => ({ ...s, user_id: userId }));
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

export const DEFAULT_PRODUCTION_PROCESSES: ProductionProcessDef[] = [
  { id: 'proc-empresa',     name: 'Processo dentro da Empresa', position: 0, color: '#3b82f6' },
  { id: 'proc-fotos',       name: 'Processo de Enviar Fotos',   position: 1, color: '#0ea5e9' },
  { id: 'proc-edicao',      name: 'Processo de Edição',         position: 2, color: '#8b5cf6' },
  { id: 'proc-finalizacao', name: 'Processo de Finalização',    position: 3, color: '#f59e0b' },
  { id: 'proc-embalagem',   name: 'Processo de Embalagem',      position: 4, color: '#10b981' },
  { id: 'proc-posvenda',    name: 'Processo de Pós Venda',      position: 5, color: '#f43f5e' },
];

export const DEFAULT_PRODUCTION_STAGES_V2: ProductionStageDef[] = [
  // Empresa
  { id: 'prod-emp-1', name: 'Ensaio Vendido',    position: 0, process_id: 'proc-empresa', color: '#3b82f6', is_final: false, is_won: false, expected_hours: 0 },
  { id: 'prod-emp-2', name: 'Contrato',           position: 1, process_id: 'proc-empresa', color: '#3b82f6', is_final: false, is_won: false, expected_hours: 0 },
  { id: 'prod-emp-3', name: 'Alinhamento',        position: 2, process_id: 'proc-empresa', color: '#3b82f6', is_final: false, is_won: false, expected_hours: 0 },
  { id: 'prod-emp-4', name: 'Ensaio a Realizar',  position: 3, process_id: 'proc-empresa', color: '#3b82f6', is_final: false, is_won: false, expected_hours: 0 },
  { id: 'prod-emp-5', name: 'Ensaio Realizado',   position: 4, process_id: 'proc-empresa', color: '#22c55e', is_final: true,  is_won: true,  expected_hours: 0 },
  // Enviar Fotos
  { id: 'prod-foto-1', name: 'Importar foto no HD',              position: 0, process_id: 'proc-fotos', color: '#0ea5e9', is_final: false, is_won: false, expected_hours: 0 },
  { id: 'prod-foto-2', name: 'Fazer seleção',                    position: 1, process_id: 'proc-fotos', color: '#0ea5e9', is_final: false, is_won: false, expected_hours: 0 },
  { id: 'prod-foto-3', name: 'Enviado para cliente selecionar',  position: 2, process_id: 'proc-fotos', color: '#0ea5e9', is_final: false, is_won: false, expected_hours: 0 },
  { id: 'prod-foto-4', name: 'Cliente selecionou',               position: 3, process_id: 'proc-fotos', color: '#0ea5e9', is_final: false, is_won: false, expected_hours: 0 },
  { id: 'prod-foto-5', name: 'Pendência de pagamento',           position: 4, process_id: 'proc-fotos', color: '#0ea5e9', is_final: false, is_won: false, expected_hours: 0 },
  { id: 'prod-foto-6', name: 'Prontos para Editar',              position: 5, process_id: 'proc-fotos', color: '#22c55e', is_final: true,  is_won: true,  expected_hours: 0 },
  // Edição
  { id: 'prod-edit-1', name: 'Fila de Edição', position: 0, process_id: 'proc-edicao', color: '#8b5cf6', is_final: false, is_won: false, expected_hours: 0 },
  { id: 'prod-edit-2', name: 'Em Edição',       position: 1, process_id: 'proc-edicao', color: '#8b5cf6', is_final: false, is_won: false, expected_hours: 0 },
  { id: 'prod-edit-3', name: 'Editados',         position: 2, process_id: 'proc-edicao', color: '#8b5cf6', is_final: false, is_won: false, expected_hours: 0 },
  { id: 'prod-edit-4', name: 'Vídeo a fazer',    position: 3, process_id: 'proc-edicao', color: '#8b5cf6', is_final: false, is_won: false, expected_hours: 0 },
  { id: 'prod-edit-5', name: 'Revisado',         position: 4, process_id: 'proc-edicao', color: '#8b5cf6', is_final: false, is_won: false, expected_hours: 0 },
  { id: 'prod-edit-6', name: 'Aprovado',         position: 5, process_id: 'proc-edicao', color: '#8b5cf6', is_final: false, is_won: false, expected_hours: 0 },
  { id: 'prod-edit-7', name: 'Mandou Prévia',    position: 6, process_id: 'proc-edicao', color: '#22c55e', is_final: true,  is_won: true,  expected_hours: 0 },
  // Finalização
  { id: 'prod-final-1', name: 'Fila para Revelação',          position: 0, process_id: 'proc-finalizacao', color: '#f59e0b', is_final: false, is_won: false, expected_hours: 0 },
  { id: 'prod-final-2', name: 'Mandou Revelar',                position: 1, process_id: 'proc-finalizacao', color: '#f59e0b', is_final: false, is_won: false, expected_hours: 0 },
  { id: 'prod-final-3', name: 'Design sendo Desenvolvido',     position: 2, process_id: 'proc-finalizacao', color: '#f59e0b', is_final: false, is_won: false, expected_hours: 0 },
  { id: 'prod-final-4', name: 'Design Finalizar',              position: 3, process_id: 'proc-finalizacao', color: '#f59e0b', is_final: false, is_won: false, expected_hours: 0 },
  { id: 'prod-final-5', name: 'Enviado para o Cliente Aprovar', position: 4, process_id: 'proc-finalizacao', color: '#f59e0b', is_final: false, is_won: false, expected_hours: 0 },
  { id: 'prod-final-6', name: 'Aprovado',                      position: 5, process_id: 'proc-finalizacao', color: '#f59e0b', is_final: false, is_won: false, expected_hours: 0 },
  { id: 'prod-final-7', name: 'Mandou para a Produção',        position: 6, process_id: 'proc-finalizacao', color: '#f59e0b', is_final: false, is_won: false, expected_hours: 0 },
  { id: 'prod-final-8', name: 'Produto chegou no estúdio',     position: 7, process_id: 'proc-finalizacao', color: '#22c55e', is_final: true,  is_won: true,  expected_hours: 0 },
  // Embalagem
  { id: 'prod-emb-1', name: 'Aguardando Embalagem',         position: 0, process_id: 'proc-embalagem', color: '#10b981', is_final: false, is_won: false, expected_hours: 0 },
  { id: 'prod-emb-2', name: 'Embalado e Pronto',             position: 1, process_id: 'proc-embalagem', color: '#10b981', is_final: false, is_won: false, expected_hours: 0 },
  { id: 'prod-emb-3', name: 'Avisou cliente que está pronto', position: 2, process_id: 'proc-embalagem', color: '#10b981', is_final: false, is_won: false, expected_hours: 0 },
  { id: 'prod-emb-4', name: 'Combinou de Retirar',           position: 3, process_id: 'proc-embalagem', color: '#10b981', is_final: false, is_won: false, expected_hours: 0 },
  { id: 'prod-emb-5', name: 'Retirado',                      position: 4, process_id: 'proc-embalagem', color: '#22c55e', is_final: true,  is_won: true,  expected_hours: 0 },
  // Pós Venda
  { id: 'prod-pos-1', name: 'Perguntar se deu Certo as fotos',  position: 0, process_id: 'proc-posvenda', color: '#f43f5e', is_final: false, is_won: false, expected_hours: 0 },
  { id: 'prod-pos-2', name: 'Pedido de avaliação no Google',    position: 1, process_id: 'proc-posvenda', color: '#f43f5e', is_final: false, is_won: false, expected_hours: 0 },
  { id: 'prod-pos-3', name: 'Não pedimos avaliação',            position: 2, process_id: 'proc-posvenda', color: '#f43f5e', is_final: false, is_won: false, expected_hours: 0 },
  { id: 'prod-pos-4', name: 'Avaliaram no Google',              position: 3, process_id: 'proc-posvenda', color: '#22c55e', is_final: true,  is_won: true,  expected_hours: 0 },
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
      const payload = DEFAULT_PRODUCTION_PROCESSES.map(p => ({ ...p, user_id: userId }));
      await supabase.from('production_processes').insert(payload);
      return DEFAULT_PRODUCTION_PROCESSES;
    }

    return data;
  } catch (err) {
    console.error('ensureProductionProcesses error', err);
    return DEFAULT_PRODUCTION_PROCESSES;
  }
};

export const ensureProductionStagesV2 = async (supabase: SupabaseClient, userId: string): Promise<ProductionStageDef[]> => {
  try {
    const { data, error } = await supabase
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
      const payload = DEFAULT_PRODUCTION_STAGES_V2.map(s => ({ ...s, user_id: userId }));
      const { error: insertError } = await supabase.from('deal_stages').insert(payload);
      if (insertError) console.warn('Não foi possível inserir etapas v2:', insertError.message);
      return DEFAULT_PRODUCTION_STAGES_V2;
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

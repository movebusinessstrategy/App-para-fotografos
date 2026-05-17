import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import {
  DEFAULT_STAGES,
  calculateTemperature,
  computePipelineAnalytics,
  createStageId,
  ensurePipelineStages,
  fetchActivityMetrics,
  recordStageEvent,
  stageIdOrDefault,
} from '../pipeline-helpers.js';

// Helper functions
const calculateTier = (jobCount: number, totalInvested: number) => {
  if (jobCount >= 10 || totalInvested >= 15000) return 'Diamond';
  if (jobCount >= 7 || totalInvested >= 5000) return 'Platinum';
  if (jobCount >= 4 || totalInvested >= 1500) return 'Gold';
  if (jobCount >= 2 || totalInvested >= 500) return 'Silver';
  return 'Bronze';
};

const getPriority = (suggestedDate: string) => {
  const today = new Date();
  const target = new Date(suggestedDate);
  const diffDays = Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays > 15) return 'future';
  if (diffDays >= -15) return 'active';
  return 'urgent';
};

// Auth helper
const getUserId = (req: VercelRequest): string | null => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return null;
  try {
    const token = authHeader.split(' ')[1];
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
    return payload.sub || null;
  } catch {
    return null;
  }
};

// Create Supabase client with user token
const createSupabaseClient = (req: VercelRequest): SupabaseClient => {
  const token = req.headers.authorization?.split(' ')[1];
  return createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.VITE_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
};

const createAdminClient = (): SupabaseClient | null => {
  const url = process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey);
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const supabase = createSupabaseClient(req);
  const adminClient = createAdminClient() || supabase;
  const url = new URL(req.url!, `https://${req.headers.host}`);
  const path = url.pathname.replace('/api', '');
  const pathParts = path.split('/').filter(Boolean);

  const getStages = async () => ensurePipelineStages(supabase, userId);
  const loadDeals = async () => {
    const stages = await getStages();
    const [dealsRes, clientsRes] = await Promise.all([
      supabase.from('deals').select('*').eq('user_id', userId),
      supabase.from('clients').select('id, name').eq('user_id', userId),
    ]);

    const clientMap = new Map<number, string>();
    (clientsRes.data || []).forEach((c) => clientMap.set(c.id, c.name));

    const dealsRaw = dealsRes.data || [];
    let itemsMap = new Map<number, any[]>();
    if (dealsRaw.length) {
      const { data: allItems } = await adminClient
        .from('deal_items')
        .select('*')
        .in('deal_id', dealsRaw.map((d: any) => d.id));
      (allItems || []).forEach((item: any) => {
        const list = itemsMap.get(item.deal_id) || [];
        list.push(item);
        itemsMap.set(item.deal_id, list);
      });
    }

    const activityMap = await fetchActivityMetrics(supabase, userId, dealsRaw.map((d: any) => d.id));

    const deals = dealsRaw.map((deal: any) => {
      const activity = activityMap.get(deal.id);
      const { temperature, score } = calculateTemperature(deal, activity);
      return {
        ...deal,
        stage_entered_at: deal.stage_entered_at || deal.updated_at || deal.created_at,
        activity_count: activity?.count || 0,
        last_activity_at: activity?.last || null,
        temperature,
        temperature_score: score,
        client_name: deal.client_id ? clientMap.get(deal.client_id) || null : null,
        items: itemsMap.get(deal.id) || [],
      };
    });

    return { deals, stages };
  };

  try {
    // ============ CATÁLOGO ============
    if (pathParts[0] === 'produtos' && req.method === 'GET') {
      const { data, error } = await supabase
        .from('produtos')
        .select('*, fornecedores(nome)')
        .eq('user_id', userId)
        .order('nome');
      if (error) return res.status(500).json({ error: error.message });
      return res.json((data || []).map((p: any) => ({
        ...p,
        fornecedor_nome: p.fornecedores?.nome || null,
        fornecedores: undefined,
      })));
    }

    if (pathParts[0] === 'servicos' && req.method === 'GET') {
      const { data, error } = await supabase
        .from('servicos')
        .select('*')
        .eq('user_id', userId)
        .order('nome');
      if (error) return res.status(500).json({ error: error.message });
      return res.json(data || []);
    }

    if (pathParts[0] === 'combos' && req.method === 'GET') {
      const { data: combos, error } = await supabase
        .from('combos')
        .select('*')
        .eq('user_id', userId)
        .order('nome');
      if (error) return res.status(500).json({ error: error.message });
      if (!combos?.length) return res.json([]);

      const { data: itens, error: itensError } = await adminClient
        .from('combo_items')
        .select('*')
        .in('combo_id', combos.map((c: any) => c.id));
      if (itensError) console.error('[combos GET] combo_items error:', itensError.message);
      return res.json(combos.map((c: any) => ({
        ...c,
        itens: (itens || []).filter((i: any) => i.combo_id === c.id),
      })));
    }

    // ============ CLIENTS ============
    if (pathParts[0] === 'clients') {
      // GET /api/clients/export/csv
      if (pathParts[1] === 'export' && pathParts[2] === 'csv' && req.method === 'GET') {
        const { data } = await supabase.from('clients').select('*').eq('user_id', userId).order('name');
        const headers = data && data.length > 0 ? Object.keys(data[0]).join(',') : '';
        const rows = (data || []).map(row => Object.values(row).map(v => `"${v || ''}"`).join(',')).join('\n');
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=clientes.csv');
        return res.send(`${headers}\n${rows}`);
      }

      // POST /api/clients/import/csv
      if (pathParts[1] === 'import' && pathParts[2] === 'csv' && req.method === 'POST') {
        const { csvData } = req.body;
        if (!csvData) return res.status(400).json({ error: 'No CSV data provided' });
        // Simplified import - just return success for now
        return res.json({ success: true, importedClientsCount: 0, updatedClientsCount: 0, importedJobsCount: 0, updatedJobsCount: 0 });
      }

      // GET /api/clients/:id
      if (pathParts[1] && !isNaN(Number(pathParts[1])) && req.method === 'GET') {
        const clientId = pathParts[1];
        const { data: client } = await supabase.from('clients').select('*').eq('id', clientId).eq('user_id', userId).single();
        if (!client) return res.status(404).json({ error: 'Client not found' });

        const { data: jobs } = await supabase.from('jobs').select('*').eq('client_id', client.id).eq('user_id', userId).order('job_date', { ascending: false });
        const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        const { data: opportunities } = await supabase.from('opportunities').select('*').eq('client_id', client.id).eq('user_id', userId).lte('suggested_date', futureDate).order('suggested_date');

        const jobCount = jobs?.length || 0;
        const totalInvested = jobs?.reduce((sum, j) => sum + (j.amount || 0), 0) || 0;

        return res.json({
          ...client,
          jobs: jobs || [],
          opportunities: (opportunities || []).map(opp => ({ ...opp, priority: getPriority(opp.suggested_date) })),
          total_invested: totalInvested,
          tier: calculateTier(jobCount, totalInvested)
        });
      }

      // PUT /api/clients/:id
      if (pathParts[1] && !isNaN(Number(pathParts[1])) && req.method === 'PUT') {
        const { data: existing } = await supabase.from('clients').select('id').eq('id', pathParts[1]).eq('user_id', userId).single();
        if (!existing) return res.status(404).json({ error: 'Client not found' });
        await supabase.from('clients').update(req.body).eq('id', pathParts[1]);
        return res.json({ success: true });
      }

      // DELETE /api/clients/:id
      if (pathParts[1] && !isNaN(Number(pathParts[1])) && req.method === 'DELETE') {
        const clientId = pathParts[1];
        const { data: existing } = await supabase.from('clients').select('id').eq('id', clientId).eq('user_id', userId).single();
        if (!existing) return res.status(404).json({ error: 'Client not found' });
        await supabase.from('opportunities').delete().eq('client_id', clientId);
        await supabase.from('jobs').delete().eq('client_id', clientId);
        await supabase.from('clients').delete().eq('id', clientId);
        return res.json({ success: true });
      }

      // GET /api/clients
      if (req.method === 'GET') {
        const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        const [clientsRes, jobsRes, oppsRes] = await Promise.all([
          supabase.from('clients').select('*').eq('user_id', userId).order('name'),
          supabase.from('jobs').select('*').eq('user_id', userId).order('job_date', { ascending: false }),
          supabase.from('opportunities').select('*').eq('user_id', userId).eq('status', 'future').lte('suggested_date', futureDate).order('suggested_date'),
        ]);

        const clients = clientsRes.data || [];
        const jobs = jobsRes.data || [];
        const opps = oppsRes.data || [];

        const jobsByClient = new Map<number, any[]>();
        jobs.forEach(job => {
          const list = jobsByClient.get(job.client_id) || [];
          list.push(job);
          jobsByClient.set(job.client_id, list);
        });

        const oppsByClient = new Map<number, any[]>();
        opps.forEach(opp => {
          const list = oppsByClient.get(opp.client_id) || [];
          list.push({ ...opp, priority: getPriority(opp.suggested_date) });
          oppsByClient.set(opp.client_id, list);
        });

        const clientsWithStats = clients.map(client => {
          const clientJobs = jobsByClient.get(client.id) || [];
          const jobCount = clientJobs.length;
          const totalInvested = clientJobs.reduce((sum, j) => sum + (j.amount || 0), 0) || 0;
          return {
            ...client,
            jobs: clientJobs,
            opportunities: oppsByClient.get(client.id) || [],
            total_invested: totalInvested,
            tier: calculateTier(jobCount, totalInvested),
          };
        });

        return res.json(clientsWithStats);
      }

      // POST /api/clients
      if (req.method === 'POST') {
        const { data, error } = await supabase.from('clients').insert({ ...req.body, user_id: userId }).select().single();
        if (error) return res.status(500).json({ error: error.message });
        return res.json({ id: data.id });
      }
    }

    // ============ JOBS ============
    if (pathParts[0] === 'jobs') {
      // PUT /api/jobs/:id
      if (pathParts[1] && !isNaN(Number(pathParts[1])) && req.method === 'PUT') {
        const { data: existing } = await supabase.from('jobs').select('*').eq('id', pathParts[1]).eq('user_id', userId).single();
        if (!existing) return res.status(404).json({ error: 'Job not found' });
        const { client_id, job_type, job_date, job_time, job_end_time, job_name, amount, payment_method, payment_status, status, notes } = req.body;
        await supabase.from('jobs').update({
          client_id: client_id || null, job_type, job_date, job_time, job_end_time, job_name, amount, payment_method, payment_status, status: status || existing.status, notes
        }).eq('id', pathParts[1]);
        return res.json({ success: true });
      }

      // DELETE /api/jobs/:id
      if (pathParts[1] && !isNaN(Number(pathParts[1])) && req.method === 'DELETE') {
        const { data: job } = await supabase.from('jobs').select('id').eq('id', pathParts[1]).eq('user_id', userId).single();
        if (!job) return res.status(404).json({ error: 'Job not found' });
        await supabase.from('opportunities').delete().eq('trigger_job_id', pathParts[1]);
        await supabase.from('jobs').delete().eq('id', pathParts[1]);
        return res.json({ success: true });
      }

      // GET /api/jobs
      if (req.method === 'GET') {
        const { data } = await supabase.from('jobs').select('*, clients(name)').eq('user_id', userId).order('job_date', { ascending: false });
        const jobsFormatted = (data || []).map(j => ({ ...j, client_name: (j.clients as any)?.name || null }));
        return res.json(jobsFormatted);
      }

      // POST /api/jobs
      if (req.method === 'POST') {
        const { client_id, job_type, job_date, job_time, job_end_time, job_name, amount, payment_method, payment_status, status, notes } = req.body;
        const { data, error } = await supabase.from('jobs').insert({
          client_id: client_id || null, job_type, job_date, job_time, job_end_time, job_name, amount, payment_method, payment_status, status: status || 'scheduled', notes, user_id: userId
        }).select().single();
        if (error) return res.status(500).json({ error: error.message });
        return res.json({ id: data.id });
      }
    }

    // ============ STATS ============
    if (pathParts[0] === 'stats' && req.method === 'GET') {
      const now = new Date();
      const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

      const [clientsRes, jobsRes, leadsRes] = await Promise.all([
        supabase.from('clients').select('id, created_at').eq('user_id', userId),
        supabase.from('jobs').select('job_type, amount, job_date').eq('user_id', userId),
        supabase.from('leads').select('status').eq('user_id', userId),
      ]);

      const clients = clientsRes.data || [];
      const jobs = jobsRes.data || [];
      const leads = leadsRes.data || [];

      const revenueByTypeMap: Record<string, number> = {};
      jobs.forEach(j => { if (j.job_type && j.amount) revenueByTypeMap[j.job_type] = (revenueByTypeMap[j.job_type] || 0) + j.amount; });

      const dailyRevenueMap: Record<string, number> = {};
      jobs.forEach(j => { if (j.job_date && j.amount) dailyRevenueMap[j.job_date] = (dailyRevenueMap[j.job_date] || 0) + j.amount; });

      return res.json({
        totalClientsBase: clients.length,
        totalClientsMonth: clients.filter(c => c.created_at?.startsWith(currentMonth)).length,
        totalJobsMonth: jobs.filter(j => j.job_date?.startsWith(currentMonth)).length,
        activeLeads: leads.filter(l => l.status && !['closed', 'lost'].includes(l.status)).length,
        revenueByType: Object.entries(revenueByTypeMap).map(([job_type, total]) => ({ job_type, total })),
        dailyRevenue: Object.entries(dailyRevenueMap).map(([date, total]) => ({ date, total })).sort((a, b) => a.date.localeCompare(b.date))
      });
    }

    // ============ OPPORTUNITIES ============
    if (pathParts[0] === 'opportunities') {
      if (pathParts[1] && !isNaN(Number(pathParts[1])) && req.method === 'PUT') {
        const { data: existing } = await supabase.from('opportunities').select('id').eq('id', pathParts[1]).eq('user_id', userId).single();
        if (!existing) return res.status(404).json({ error: 'Opportunity not found' });
        const { status, notes, estimated_value } = req.body;
        const updates: any = {};
        if (status !== undefined) updates.status = status;
        if (notes !== undefined) updates.notes = notes;
        if (estimated_value !== undefined) updates.estimated_value = estimated_value;
        if (Object.keys(updates).length > 0) await supabase.from('opportunities').update(updates).eq('id', pathParts[1]);
        return res.json({ success: true });
      }

      if (req.method === 'GET') {
        const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        const { data } = await supabase.from('opportunities').select('*, clients(name)').eq('user_id', userId).not('status', 'in', '("converted","dismissed")').lte('suggested_date', futureDate).order('suggested_date');
        const oppsFormatted = (data || []).map(opp => ({ ...opp, client_name: (opp.clients as any)?.name || null, priority: getPriority(opp.suggested_date) }));
        return res.json(oppsFormatted);
      }
    }

    // ============ OPPORTUNITY RULES ============
    if (pathParts[0] === 'opportunity-rules') {
      if (pathParts[1] && !isNaN(Number(pathParts[1])) && req.method === 'PUT') {
        const { data: existing } = await supabase.from('opportunity_rules').select('id').eq('id', pathParts[1]).eq('user_id', userId).single();
        if (!existing) return res.status(404).json({ error: 'Rule not found' });
        const { trigger_job_type, target_job_type, days_offset, is_active } = req.body;
        await supabase.from('opportunity_rules').update({ trigger_job_type, target_job_type, days_offset, is_active }).eq('id', pathParts[1]);
        return res.json({ success: true });
      }

      if (pathParts[1] && !isNaN(Number(pathParts[1])) && req.method === 'DELETE') {
        const { data: existing } = await supabase.from('opportunity_rules').select('id').eq('id', pathParts[1]).eq('user_id', userId).single();
        if (!existing) return res.status(404).json({ error: 'Rule not found' });
        await supabase.from('opportunity_rules').delete().eq('id', pathParts[1]);
        return res.json({ success: true });
      }

      if (req.method === 'GET') {
        const { data } = await supabase.from('opportunity_rules').select('*').eq('user_id', userId);
        return res.json(data || []);
      }

      if (req.method === 'POST') {
        const { trigger_job_type, target_job_type, days_offset } = req.body;
        const { data, error } = await supabase.from('opportunity_rules').insert({ trigger_job_type, target_job_type, days_offset, user_id: userId }).select().single();
        if (error) return res.status(500).json({ error: error.message });
        return res.json({ id: data.id });
      }
    }

    // ============ FUNNEL & LEADS ============
    if (pathParts[0] === 'funnel' && req.method === 'GET') {
      const { data: stages } = await supabase.from('funnel_stages').select('*').eq('user_id', userId).order('position');
      const { data: leads } = await supabase.from('leads').select('*').eq('user_id', userId);
      return res.json({ stages: stages || [], leads: leads || [] });
    }

    if (pathParts[0] === 'leads') {
      if (pathParts[1] && !isNaN(Number(pathParts[1])) && req.method === 'PUT') {
        const { data: existing } = await supabase.from('leads').select('id').eq('id', pathParts[1]).eq('user_id', userId).single();
        if (!existing) return res.status(404).json({ error: 'Lead not found' });
        const { stage_id, status } = req.body;
        const updates: any = {};
        if (stage_id !== undefined) updates.stage_id = stage_id;
        if (status !== undefined) updates.status = status;
        if (Object.keys(updates).length > 0) await supabase.from('leads').update(updates).eq('id', pathParts[1]);
        return res.json({ success: true });
      }

      if (pathParts[1] && !isNaN(Number(pathParts[1])) && req.method === 'DELETE') {
        const { data: existing } = await supabase.from('leads').select('id').eq('id', pathParts[1]).eq('user_id', userId).single();
        if (!existing) return res.status(404).json({ error: 'Lead not found' });
        await supabase.from('leads').delete().eq('id', pathParts[1]);
        return res.json({ success: true });
      }

      if (req.method === 'POST') {
        const { client_name, job_type_interest, contact_date, estimated_value, status, notes, stage_id } = req.body;
        const { data, error } = await supabase.from('leads').insert({ client_name, job_type_interest, contact_date, estimated_value, status, notes, stage_id, user_id: userId }).select().single();
        if (error) return res.status(500).json({ error: error.message });
        return res.json({ id: data.id });
      }
    }

    // ============ PIPELINE STAGES ============
    if (pathParts[0] === 'pipeline' && pathParts[1] === 'stages') {
      if (req.method === 'GET') {
        const stages = await getStages();
        return res.json(stages);
      }

      if (req.method === 'POST') {
        const { name, color } = req.body;
        if (!name) return res.status(400).json({ error: 'Nome é obrigatório' });
        const stages = await getStages();
        const position = stages.filter((s) => !s.is_final).length;
        const payload: any = { id: createStageId(name), name, color: color || '#E5E7EB', position, is_final: false, is_won: false, user_id: userId };
        const { data, error } = await supabase.from('deal_stages').insert(payload).select().single();
        if (error) return res.status(500).json({ error: error.message });
        return res.json(data);
      }

      if (pathParts[2] === 'reorder' && req.method === 'PUT') {
        const { stageIds } = req.body as { stageIds: string[] };
        if (!Array.isArray(stageIds)) return res.status(400).json({ error: 'stageIds inválido' });
        const finals = (await getStages()).filter((s) => s.is_final);
        await Promise.all(stageIds.map((id: string, idx: number) => supabase.from('deal_stages').update({ position: idx }).eq('id', id).eq('user_id', userId)));
        await Promise.all(finals.map((stage, idx) => supabase.from('deal_stages').update({ position: stageIds.length + idx }).eq('id', stage.id).eq('user_id', userId)));
        return res.json({ success: true });
      }

      if (pathParts[2] && req.method === 'PUT') {
        const { name, color } = req.body;
        const stageId = pathParts[2];
        const stages = await getStages();
        const stage = stages.find((s) => s.id === stageId) || DEFAULT_STAGES.find((s) => s.id === stageId);
        if (!stage) return res.status(404).json({ error: 'Etapa não encontrada' });
        if (stage.is_final && name) return res.status(400).json({ error: 'Não é possível renomear etapa final' });
        const { error } = await supabase.from('deal_stages').update({ name: name || stage.name, color: color || stage.color }).eq('id', stageId).eq('user_id', userId);
        if (error) return res.status(500).json({ error: error.message });
        return res.json({ success: true });
      }

      if (pathParts[2] && req.method === 'DELETE') {
        const stageId = pathParts[2];
        const stages = await getStages();
        const stage = stages.find((s) => s.id === stageId);
        if (!stage) return res.status(404).json({ error: 'Etapa não encontrada' });
        if (stage.is_final) return res.status(400).json({ error: 'Etapa final não pode ser removida' });
        const fallback = stageIdOrDefault(stages, stages.find((s) => !s.is_final && s.id !== stageId)?.id);
        await supabase.from('deals').update({ stage: fallback }).eq('stage', stageId).eq('user_id', userId);
        await supabase.from('deal_stages').delete().eq('id', stageId).eq('user_id', userId);
        return res.json({ success: true });
      }
    }

    // ============ PIPELINE ANALYTICS ============
    if (pathParts[0] === 'pipeline' && pathParts[1] === 'analytics' && req.method === 'GET') {
      const { deals, stages } = await loadDeals();
      let events: any[] = [];
      try {
        const { data } = await supabase.from('deal_stage_events').select('*').eq('user_id', userId);
        events = data || [];
      } catch (err) {
        console.warn('deal_stage_events indisponível', err);
      }
      const analytics = computePipelineAnalytics(deals, stages, events);
      return res.json(analytics);
    }

    // ============ DEALS ============
    if (pathParts[0] === 'deals') {
      // Activities
      if (pathParts[2] === 'activities') {
        if (req.method === 'GET') {
          const { data } = await supabase.from('deal_activities').select('*').eq('deal_id', pathParts[1]).eq('user_id', userId).order('created_at', { ascending: false });
          return res.json(data || []);
        }
        if (req.method === 'POST') {
          const { data: existing } = await supabase.from('deals').select('id').eq('id', pathParts[1]).eq('user_id', userId).single();
          if (!existing) return res.status(404).json({ error: 'Deal not found' });
          const { type, description } = req.body;
          await supabase.from('deal_activities').insert({ deal_id: Number(pathParts[1]), user_id: userId, type, description: description || null });
          return res.json({ success: true });
        }
      }

      // Quick lead
      if (pathParts[1] === 'quick' && req.method === 'POST') {
        const stages = await getStages();
        const firstStage = stages.find((s) => !s.is_final) || DEFAULT_STAGES[0];
        const { name, phone, email, value, source, stage: requestedStage } = req.body;
        if (!name || !phone) return res.status(400).json({ error: 'Nome e telefone são obrigatórios' });
        const targetStage = (requestedStage && stages.find((s) => s.id === requestedStage)) || firstStage;
        const payload: any = {
          title: name,
          contact_name: name,
          contact_phone: phone,
          contact_email: email || null,
          lead_source: source || null,
          value: Number(value) || 0,
          stage: targetStage.id,
          stage_entered_at: new Date().toISOString(),
          priority: 'medium',
          user_id: userId,
          updated_at: new Date().toISOString(),
        };
        const { data, error } = await supabase.from('deals').insert(payload).select().single();
        if (error) {
          const retry = await supabase
            .from('deals')
            .insert({
              title: name,
              value: Number(value) || 0,
              stage: targetStage.id,
              priority: 'medium',
              notes: `Telefone: ${phone}${email ? ` | Email: ${email}` : ''}${source ? ` | Origem: ${source}` : ''}`,
              user_id: userId,
              updated_at: new Date().toISOString(),
            })
            .select()
            .single();
          if (retry.error || !retry.data) return res.status(500).json({ error: retry.error?.message || 'Erro ao criar lead' });
          return res.json({ id: retry.data.id, fallbackNotes: true });
        }
        return res.json({ id: data.id });
      }

      // Deal Items
      if (pathParts[2] === 'items' && req.method === 'POST') {
        const dealId = Number(pathParts[1]);
        if (!dealId) return res.status(400).json({ error: 'Deal inválido' });

        const { data: deal } = await supabase
          .from('deals')
          .select('id, value')
          .eq('id', dealId)
          .eq('user_id', userId)
          .single();
        if (!deal) return res.status(404).json({ error: 'Deal not found' });

        const { catalog_type, catalog_id, catalog_name, catalog_value, quantidade = 1 } = req.body;
        if (!catalog_type || !catalog_id || !catalog_name) {
          return res.status(400).json({ error: 'catalog_type, catalog_id, catalog_name são obrigatórios' });
        }

        const { data: newItem, error } = await adminClient
          .from('deal_items')
          .insert({
            deal_id: dealId,
            catalog_type,
            catalog_id,
            catalog_name,
            catalog_value: catalog_value || 0,
            quantidade,
          })
          .select()
          .single();
        if (error) return res.status(500).json({ error: error.message });

        const { data: allItems } = await adminClient
          .from('deal_items')
          .select('catalog_value, quantidade')
          .eq('deal_id', dealId);
        const total = (allItems || []).reduce((sum: number, item: any) => {
          return sum + ((Number(item.catalog_value) || 0) * (Number(item.quantidade) || 1));
        }, 0);

        await supabase
          .from('deals')
          .update({ value: total, updated_at: new Date().toISOString() })
          .eq('id', dealId)
          .eq('user_id', userId);

        return res.json({ item: newItem, total });
      }

      // Convert to won
      if (pathParts[2] === 'convert' && req.method === 'POST') {
        const stages = await getStages();
        const wonStage = stages.find((s) => s.is_won) || DEFAULT_STAGES.find((s) => s.is_won);
        const { createClient, createJob, client, job, sinalAmount, existingClientId } = req.body;
        const { data: deal } = await supabase.from('deals').select('*').eq('id', pathParts[1]).eq('user_id', userId).single();
        if (!deal) return res.status(404).json({ error: 'Deal not found' });

        let clientId = (existingClientId as number | null) || (deal.client_id as number | null);
        if (createClient) {
          const c = client || {};
          const clientNotes = [
            c.notes || '',
            c.how_found ? `Como conheceu: ${c.how_found}` : '',
          ].filter(Boolean).join('\n').trim();
          const payload = {
            name: c.name || deal.title,
            phone: c.phone || deal.contact_phone || null,
            email: c.email || deal.contact_email || null,
            cpf: c.document || null,
            birth_date: c.birth_date || null,
            address: c.address || null,
            city: c.city || null,
            state: c.state || null,
            cep: c.zip_code || null,
            instagram: c.instagram || deal.contact_instagram || null,
            notes: clientNotes || null,
            status: 'active',
            user_id: userId,
          } as any;
          const { data: newClient, error } = await supabase.from('clients').insert(payload).select().single();
          if (error) return res.status(500).json({ error: error.message });
          clientId = newClient?.id || clientId;
        }

        let jobId: number | null = null;
        if (createJob && job) {
          const payload = {
            client_id: clientId || null,
            job_type: job.job_type,
            job_date: job.job_date,
            job_time: job.job_time || null,
            job_end_time: job.job_end_time || null,
            job_name: job.job_name || deal.title,
            amount: job.amount || deal.value || 0,
            payment_method: job.payment_method || 'Pix',
            payment_status: job.payment_status || 'pending',
            status: job.status || 'scheduled',
            notes: [
              job.notes || '',
              sinalAmount && Number(sinalAmount) > 0 ? `Sinal pago: R$ ${Number(sinalAmount).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '',
            ].filter(Boolean).join('\n').trim(),
            user_id: userId,
          } as any;
          const { data: newJob, error } = await supabase.from('jobs').insert(payload).select().single();
          if (error) return res.status(500).json({ error: error.message });
          jobId = newJob?.id || null;

          if (jobId && sinalAmount && Number(sinalAmount) > 0) {
            await adminClient.from('job_payments').insert({
              job_id: jobId,
              amount: Number(sinalAmount),
              description: 'Sinal',
              payment_date: new Date().toISOString().slice(0, 10),
              payment_method: job.payment_method || 'Pix',
            }).select();
          }
        }

        const updates: any = {
          stage: wonStage?.id || 'won',
          stage_entered_at: new Date().toISOString(),
          converted: true,
          converted_at: new Date().toISOString(),
          converted_client_id: clientId,
          converted_job_id: jobId,
          client_id: clientId || deal.client_id,
          temperature: 'hot',
          temperature_locked: true,
        };
        const { error } = await supabase.from('deals').update(updates).eq('id', pathParts[1]).eq('user_id', userId);
        if (error) return res.status(500).json({ error: error.message });
        await recordStageEvent(supabase, userId, Number(pathParts[1]), deal.stage, updates.stage, deal.stage_entered_at);
        return res.json({ success: true, client_id: clientId, job_id: jobId });
      }

      // Mark as lost
      if (pathParts[2] === 'lost' && req.method === 'POST') {
        const stages = await getStages();
        const lostStage = stages.find((s) => s.id === req.body.stageId) || stages.find((s) => s.id === 'lost') || DEFAULT_STAGES.find((s) => s.id === 'lost');
        const { reason, notes } = req.body;
        const { data: deal } = await supabase.from('deals').select('*').eq('id', pathParts[1]).eq('user_id', userId).single();
        if (!deal) return res.status(404).json({ error: 'Deal not found' });
        const updates: any = {
          stage: lostStage?.id || 'lost',
          stage_entered_at: new Date().toISOString(),
          lost_reason: reason || null,
          lost_notes: notes || null,
          temperature: 'cold',
          temperature_locked: true,
        };
        const { error } = await supabase.from('deals').update(updates).eq('id', pathParts[1]).eq('user_id', userId);
        if (error) return res.status(500).json({ error: error.message });
        await recordStageEvent(supabase, userId, Number(pathParts[1]), deal.stage, updates.stage, deal.stage_entered_at);
        return res.json({ success: true });
      }

      if (pathParts[1] && !isNaN(Number(pathParts[1])) && req.method === 'PUT') {
        const { data: existing } = await supabase.from('deals').select('id, stage, stage_entered_at').eq('id', pathParts[1]).eq('user_id', userId).single();
        if (!existing) return res.status(404).json({ error: 'Deal not found' });
        const updates: any = { ...req.body, updated_at: new Date().toISOString() };
        if (updates.stage && updates.stage !== existing.stage) {
          updates.stage_entered_at = new Date().toISOString();
          await recordStageEvent(supabase, userId, Number(pathParts[1]), existing.stage, updates.stage, existing.stage_entered_at);
        }
        await supabase.from('deals').update(updates).eq('id', pathParts[1]).eq('user_id', userId);
        return res.json({ success: true });
      }

      if (pathParts[1] && !isNaN(Number(pathParts[1])) && req.method === 'DELETE') {
        const { data: existing } = await supabase.from('deals').select('id').eq('id', pathParts[1]).eq('user_id', userId).single();
        if (!existing) return res.status(404).json({ error: 'Deal not found' });
        await supabase.from('deals').delete().eq('id', pathParts[1]).eq('user_id', userId);
        return res.json({ success: true });
      }

      if (req.method === 'GET') {
        const { deals } = await loadDeals();
        return res.json(deals);
      }

      if (req.method === 'POST') {
        const stages = await getStages();
        const { client_id, title, value, stage, priority, expected_close_date, next_follow_up, notes } = req.body;
        const payload: any = {
          client_id: client_id || null,
          title,
          value: value || 0,
          stage: stageIdOrDefault(stages, stage),
          stage_entered_at: new Date().toISOString(),
          priority: priority || 'medium',
          expected_close_date: expected_close_date || null,
          next_follow_up: next_follow_up || null,
          notes: notes || null,
          user_id: userId,
          updated_at: new Date().toISOString(),
        };
        const { data, error } = await supabase.from('deals').insert(payload).select().single();
        if (error) {
          const retry = await supabase
            .from('deals')
            .insert({
              client_id: payload.client_id,
              title: payload.title,
              value: payload.value,
              stage: payload.stage,
              priority: payload.priority,
              expected_close_date: payload.expected_close_date,
              next_follow_up: payload.next_follow_up,
              notes: payload.notes,
              user_id: userId,
              updated_at: payload.updated_at,
            })
            .select()
            .single();
          if (retry.error || !retry.data) return res.status(500).json({ error: retry.error?.message || 'Erro ao criar deal' });
          return res.json({ id: retry.data.id });
        }
        return res.json({ id: data.id });
      }
    }

    return res.status(404).json({ error: 'Route not found', path });

  } catch (error: any) {
    console.error('API Error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
}

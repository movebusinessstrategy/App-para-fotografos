import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

// Supabase client
const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.VITE_SUPABASE_ANON_KEY!
);

// Auth middleware helper
const getUserId = (req: VercelRequest): string | null => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return null;
  // Decodifica o token JWT do Supabase para pegar o user_id
  try {
    const token = authHeader.split(' ')[1];
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
    return payload.sub || null;
  } catch {
    return null;
  }
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const userId = getUserId(req);
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Router simples baseado no path
  const path = req.url?.replace('/api', '') || '/';
  
  try {
    // ============ CLIENTS ============
    if (path === '/clients' && req.method === 'GET') {
      const { data, error } = await supabase
        .from('clients')
        .select('*')
        .eq('user_id', userId)
        .order('name');
      
      if (error) throw error;
      return res.json(data || []);
    }

    if (path === '/clients' && req.method === 'POST') {
      const { data, error } = await supabase
        .from('clients')
        .insert({ ...req.body, user_id: userId })
        .select()
        .single();
      
      if (error) throw error;
      return res.json({ id: data.id });
    }

    // ============ JOBS ============
    if (path === '/jobs' && req.method === 'GET') {
      const { data, error } = await supabase
        .from('jobs')
        .select('*, clients(name)')
        .eq('user_id', userId)
        .order('job_date', { ascending: false });
      
      if (error) throw error;
      
      const jobsFormatted = (data || []).map(j => ({
        ...j,
        client_name: (j.clients as any)?.name || null
      }));
      
      return res.json(jobsFormatted);
    }

    // ============ STATS ============
    if (path === '/stats' && req.method === 'GET') {
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

      return res.json({
        totalClientsBase: clients.length,
        totalClientsMonth: clients.filter(c => c.created_at?.startsWith(currentMonth)).length,
        totalJobsMonth: jobs.filter(j => j.job_date?.startsWith(currentMonth)).length,
        activeLeads: leads.filter(l => l.status && !['closed', 'lost'].includes(l.status)).length,
        revenueByType: [],
        dailyRevenue: []
      });
    }

    // ============ OPPORTUNITIES ============
    if (path === '/opportunities' && req.method === 'GET') {
      const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      
      const { data, error } = await supabase
        .from('opportunities')
        .select('*, clients(name)')
        .eq('user_id', userId)
        .lte('suggested_date', futureDate)
        .order('suggested_date');
      
      if (error) throw error;
      return res.json(data || []);
    }

    // Rota não encontrada
    return res.status(404).json({ error: 'Route not found' });

  } catch (error: any) {
    console.error('API Error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
}

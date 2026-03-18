import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import { google } from 'googleapis';
import dotenv from 'dotenv';
import Papa from 'papaparse';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseClient } from './supabase.js';
import {
  DEFAULT_STAGES,
  calculateTemperature,
  computePipelineAnalytics,
  createStageId,
  ensurePipelineStages,
  fetchActivityMetrics,
  recordStageEvent,
  stageIdOrDefault,
} from './pipeline-helpers.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ============ HELPER FUNCTIONS ============
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
  const diffTime = target.getTime() - today.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays > 15) return 'future';
  if (diffDays >= -15) return 'active';
  return 'urgent';
};

const generateOpportunities = async (
  supabase: SupabaseClient,
  clientId: number,
  jobType: string,
  jobDate: string,
  userId: string,
  jobId?: number
) => {
  try {
    const { data: rules } = await supabase
      .from('opportunity_rules')
      .select('*')
      .eq('trigger_job_type', jobType)
      .eq('is_active', 1)
      .eq('user_id', userId);

    if (!rules) return;

    for (const rule of rules) {
      const suggestedDate = new Date(jobDate);
      if (isNaN(suggestedDate.getTime())) continue;

      suggestedDate.setDate(suggestedDate.getDate() + rule.days_offset);
      const dateStr = suggestedDate.toISOString().split('T')[0];

      const { data: existingJob } = await supabase
        .from('jobs')
        .select('id')
        .eq('client_id', clientId)
        .eq('job_type', rule.target_job_type)
        .eq('user_id', userId)
        .gte('job_date', jobDate)
        .limit(1)
        .single();

      if (existingJob) continue;

      let existingOpp;
      if (jobId) {
        const { data } = await supabase
          .from('opportunities')
          .select('id')
          .eq('client_id', clientId)
          .eq('type', rule.target_job_type)
          .eq('trigger_job_id', jobId)
          .eq('user_id', userId)
          .limit(1)
          .single();
        existingOpp = data;
      } else {
        const { data } = await supabase
          .from('opportunities')
          .select('id')
          .eq('client_id', clientId)
          .eq('type', rule.target_job_type)
          .eq('suggested_date', dateStr)
          .eq('user_id', userId)
          .limit(1)
          .single();
        existingOpp = data;
      }

      if (!existingOpp) {
        await supabase.from('opportunities').insert({
          client_id: clientId,
          trigger_job_id: jobId || null,
          type: rule.target_job_type,
          suggested_date: dateStr,
          status: 'future',
          notes: `Gerada automaticamente a partir do ensaio ${jobType}`,
          user_id: userId
        });
      }
    }
  } catch (error) {
    console.error('Error generating opportunities:', error);
  }
};

// ============ GOOGLE AUTH HELPERS ============
const cleanCredential = (val: string | undefined) => {
  if (!val) return undefined;
  return val.replace(/^Status\s*/i, '').trim();
};

const getRedirectUri = (req: express.Request) => {
  if (process.env.APP_URL) {
    return `${process.env.APP_URL.replace(/\/$/, '')}/api/auth/google/callback`;
  }
  const protocol = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.get('host');
  return `${protocol}://${host}/api/auth/google/callback`;
};

const getOAuth2Client = (redirectUri?: string) => {
  return new google.auth.OAuth2(
    cleanCredential(process.env.GOOGLE_CLIENT_ID),
    cleanCredential(process.env.GOOGLE_CLIENT_SECRET),
    redirectUri
  );
};

const getGoogleAuth = async (supabase: SupabaseClient, userId: string) => {
  const { data: auth } = await supabase
    .from('google_auth')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (!auth || !auth.access_token) return null;

  const client = getOAuth2Client();
  client.setCredentials({
    access_token: auth.access_token,
    refresh_token: auth.refresh_token,
    expiry_date: auth.expiry_date
  });

  return client;
};

const deleteGoogleCalendarEvent = async (supabase: SupabaseClient, eventId: string, userId: string) => {
  const auth = await getGoogleAuth(supabase, userId);
  if (!auth) return;

  const calendar = google.calendar({ version: 'v3', auth });
  try {
    await calendar.events.delete({ calendarId: 'primary', eventId });
  } catch (error: any) {
    if (error.code !== 410 && error.code !== 404) {
      console.error('Error deleting Google Calendar event:', error);
    }
  }
};

const syncJobToGoogleCalendar = async (supabase: SupabaseClient, jobId: number, userId: string) => {
  const auth = await getGoogleAuth(supabase, userId);
  if (!auth) return;

  const { data: job } = await supabase
    .from('jobs')
    .select('*, clients(name, email)')
    .eq('id', jobId)
    .eq('user_id', userId)
    .single();

  if (!job || !job.job_date) return;

  if (job.status === 'cancelled' && job.google_event_id) {
    await deleteGoogleCalendarEvent(supabase, job.google_event_id, userId);
    await supabase.from('jobs').update({ google_event_id: null }).eq('id', jobId);
    return;
  }

  if (job.status === 'cancelled') return;

  const calendar = google.calendar({ version: 'v3', auth });
  const client = job.clients as any;

  const startDateTime = job.job_time
    ? `${job.job_date}T${job.job_time}:00`
    : `${job.job_date}T09:00:00`;

  let endDateTime;
  if (job.job_end_time) {
    endDateTime = new Date(`${job.job_date}T${job.job_end_time}:00`).toISOString();
  } else {
    endDateTime = new Date(new Date(startDateTime).getTime() + 60 * 60 * 1000).toISOString();
  }

  const summary = client?.name
    ? `${client.name} - ${job.job_type}`
    : (job.job_name || job.job_type);

  const event = {
    summary,
    description: job.notes || (client?.name ? `Ensaio ${job.job_type} para ${client.name}` : job.job_type),
    start: { dateTime: new Date(startDateTime).toISOString(), timeZone: 'America/Sao_Paulo' },
    end: { dateTime: endDateTime, timeZone: 'America/Sao_Paulo' },
    attendees: client?.email ? [{ email: client.email }] : [],
  };

  try {
    if (job.google_event_id) {
      try {
        await calendar.events.patch({ calendarId: 'primary', eventId: job.google_event_id, requestBody: event });
      } catch (patchError: any) {
        if (patchError.message?.includes('Event type cannot be changed') || patchError.code === 404) {
          const res = await calendar.events.insert({ calendarId: 'primary', requestBody: event });
          if (res.data.id) {
            await supabase.from('jobs').update({ google_event_id: res.data.id }).eq('id', jobId);
          }
        } else {
          throw patchError;
        }
      }
    } else {
      const res = await calendar.events.insert({ calendarId: 'primary', requestBody: event });
      if (res.data.id) {
        await supabase.from('jobs').update({ google_event_id: res.data.id }).eq('id', jobId);
      }
    }
  } catch (error) {
    console.error('Error syncing to Google Calendar:', error);
  }
};

const pullFromGoogleCalendar = async (supabase: SupabaseClient, userId: string) => {
  const auth = await getGoogleAuth(supabase, userId);
  if (!auth) return 0;

  const calendar = google.calendar({ version: 'v3', auth });
  try {
    const now = new Date();
    const timeMin = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const timeMax = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString();

    const response = await calendar.events.list({
      calendarId: 'primary',
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: 'startTime',
    });

    const events = response.data.items || [];
    let importedCount = 0;

    for (const event of events) {
      if (!event.id) continue;

      const { data: existingJob } = await supabase
        .from('jobs')
        .select('id')
        .eq('google_event_id', event.id)
        .eq('user_id', userId)
        .single();

      if (existingJob) continue;

      const summary = event.summary || 'Sem Título';
      const parts = summary.split(' - ');
      const clientName = parts[0];
      const jobType = parts.length > 1 ? parts[1] : 'Evento Externo';

      const { data: client } = await supabase
        .from('clients')
        .select('id')
        .eq('name', clientName)
        .eq('user_id', userId)
        .single();

      const start = event.start?.dateTime || event.start?.date;
      const end = event.end?.dateTime || event.end?.date;
      if (!start) continue;

      const startDate = start.split('T')[0];
      const startTime = start.includes('T') ? start.split('T')[1].substring(0, 5) : null;
      const endTime = (end && end.includes('T')) ? end.split('T')[1].substring(0, 5) : null;

      await supabase.from('jobs').insert({
        client_id: client?.id || null,
        job_type: jobType,
        job_date: startDate,
        job_time: startTime,
        job_end_time: endTime,
        job_name: summary,
        google_event_id: event.id,
        status: 'scheduled',
        notes: event.description || '',
        user_id: userId
      });
      importedCount++;
    }

    return importedCount;
  } catch (error) {
    console.error('Error pulling from Google Calendar:', error);
    return 0;
  }
};

// ============ START SERVER ============
async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: '50mb' }));

  // ============ AUTH MIDDLEWARE ============
  const requireAuth = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Não autorizado' });
    }

    const token = authHeader.substring(7);
    const supabase = createSupabaseClient(authHeader);

    try {
      const { data: { user }, error } = await supabase.auth.getUser(token);
      if (error || !user) {
        return res.status(401).json({ error: 'Não autorizado' });
      }

      (req as any).userId = user.id;
      (req as any).supabase = supabase;
      next();
    } catch (err) {
      console.error('Erro ao validar token:', err);
      return res.status(401).json({ error: 'Não autorizado' });
    }
  };

  // ============ GOOGLE AUTH ROUTES ============
  app.get('/api/auth/google/config-check', (req, res) => {
    const clientId = cleanCredential(process.env.GOOGLE_CLIENT_ID) || '';
    res.json({
      hasClientId: !!clientId,
      hasClientSecret: !!cleanCredential(process.env.GOOGLE_CLIENT_SECRET),
      clientIdPreview: clientId ? `${clientId.substring(0, 10)}...${clientId.substring(clientId.length - 10)}` : 'none',
      clientIdLength: clientId.length,
      currentRedirectUri: getRedirectUri(req),
      envAppUrl: process.env.APP_URL || 'not set'
    });
  });

  app.get('/api/auth/google/url', requireAuth, (req, res) => {
    const redirectUri = getRedirectUri(req);
    const client = getOAuth2Client(redirectUri);
    const userId = (req as any).userId;
    
    const url = client.generateAuthUrl({
      access_type: 'offline',
      scope: ['https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/calendar.readonly'],
      prompt: 'consent',
      redirect_uri: redirectUri,
      state: userId
    });
    res.json({ url });
  });

  app.get('/api/auth/google/callback', async (req, res) => {
    const { code, state: userId } = req.query;
    const redirectUri = getRedirectUri(req);
    const supabase = createSupabaseClient();

    if (!userId || typeof userId !== 'string') {
      return res.status(400).send('User ID não encontrado.');
    }

    try {
      const client = getOAuth2Client(redirectUri);
      const { tokens } = await client.getToken({ code: code as string, redirect_uri: redirectUri });

      await supabase.from('google_auth').upsert({
        user_id: userId,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expiry_date: tokens.expiry_date
      });

      res.send(`
        <html><body><script>
          window.opener.postMessage({ type: 'GOOGLE_AUTH_SUCCESS' }, '*');
          window.close();
        </script><p>Autenticação concluída! Esta janela fechará automaticamente.</p></body></html>
      `);
    } catch (error) {
      console.error('Error exchanging code for tokens:', error);
      res.status(500).send('Erro na autenticação com o Google.');
    }
  });

  app.get('/api/auth/google/status', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { data } = await supabase.from('google_auth').select('user_id').eq('user_id', userId).single();
    res.json({ connected: !!data });
  });

  app.post('/api/auth/google/disconnect', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    await supabase.from('google_auth').delete().eq('user_id', userId);
    res.json({ success: true });
  });

  app.post('/api/auth/google/sync-all', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const auth = await getGoogleAuth(supabase, userId);
    if (!auth) return res.status(401).json({ error: 'Google account not connected' });

    try {
      const importedCount = await pullFromGoogleCalendar(supabase, userId);
      const { data: jobs } = await supabase.from('jobs').select('id').eq('user_id', userId).neq('status', 'cancelled');

      for (const job of jobs || []) {
        await syncJobToGoogleCalendar(supabase, job.id, userId);
      }
      res.json({ success: true, pushed: jobs?.length || 0, pulled: importedCount });
    } catch (error) {
      console.error('Error syncing all jobs:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ============ CLIENTS ROUTES ============
  app.get('/api/clients', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;

    const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0];

    const [clientsRes, jobsRes, oppsRes] = await Promise.all([
      supabase.from('clients').select('*').eq('user_id', userId).order('name'),
      supabase
        .from('jobs')
        .select('*')
        .eq('user_id', userId)
        .order('job_date', { ascending: false }),
      supabase
        .from('opportunities')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'future')
        .lte('suggested_date', futureDate)
        .order('suggested_date'),
    ]);

    const clients = clientsRes.data || [];
    const jobs = jobsRes.data || [];
    const opps = oppsRes.data || [];

    const jobsByClient = new Map<number, any[]>();
    jobs.forEach((job) => {
      const list = jobsByClient.get(job.client_id) || [];
      list.push(job);
      jobsByClient.set(job.client_id, list);
    });

    const oppsByClient = new Map<number, any[]>();
    opps.forEach((opp) => {
      const list = oppsByClient.get(opp.client_id) || [];
      list.push({
        ...opp,
        priority: getPriority(opp.suggested_date),
      });
      oppsByClient.set(opp.client_id, list);
    });

    const clientsWithStats = clients.map((client) => {
      const clientJobs = jobsByClient.get(client.id) || [];
      const jobCount = clientJobs.length;
      const totalInvested =
        clientJobs.reduce((sum, j) => sum + (j.amount || 0), 0) || 0;

      return {
        ...client,
        jobs: clientJobs,
        opportunities: oppsByClient.get(client.id) || [],
        total_invested: totalInvested,
        tier: calculateTier(jobCount, totalInvested),
      };
    });

    res.json(clientsWithStats);
  });

  app.get('/api/clients/export/csv', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { data: clients } = await supabase.from('clients').select('*').eq('user_id', userId).order('name');
    const csv = Papa.unparse(clients || []);
    res.header('Content-Type', 'text/csv');
    res.attachment('clientes.csv');
    res.send(csv);
  });

  app.get('/api/clients/:id', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', req.params.id)
      .eq('user_id', userId)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: jobs } = await supabase
      .from('jobs')
      .select('*')
      .eq('client_id', client.id)
      .eq('user_id', userId)
      .order('job_date', { ascending: false });

    const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const { data: opportunities } = await supabase
      .from('opportunities')
      .select('*')
      .eq('client_id', client.id)
      .eq('user_id', userId)
      .lte('suggested_date', futureDate)
      .order('suggested_date');

    const opportunitiesWithPriority = (opportunities || []).map(opp => ({
      ...opp,
      priority: getPriority(opp.suggested_date)
    }));

    const jobCount = jobs?.length || 0;
    const totalInvested = jobs?.reduce((sum, j) => sum + (j.amount || 0), 0) || 0;

    res.json({
      ...client,
      jobs: jobs || [],
      opportunities: opportunitiesWithPriority,
      total_invested: totalInvested,
      tier: calculateTier(jobCount, totalInvested)
    });
  });

  app.post('/api/clients', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;

    const { data, error } = await supabase
      .from('clients')
      .insert({ ...req.body, user_id: userId })
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    res.json({ id: data.id });
  });

  app.put('/api/clients/:id', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;

    const { data: existing } = await supabase
      .from('clients')
      .select('id')
      .eq('id', req.params.id)
      .eq('user_id', userId)
      .single();

    if (!existing) return res.status(404).json({ error: 'Client not found' });

    await supabase.from('clients').update(req.body).eq('id', req.params.id);
    res.json({ success: true });
  });

  app.delete('/api/clients/:id', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;

    const { data: existing } = await supabase
      .from('clients')
      .select('id')
      .eq('id', req.params.id)
      .eq('user_id', userId)
      .single();

    if (!existing) return res.status(404).json({ error: 'Client not found' });

    await supabase.from('opportunities').delete().eq('client_id', req.params.id);
    await supabase.from('jobs').delete().eq('client_id', req.params.id);
    await supabase.from('clients').delete().eq('id', req.params.id);
    res.json({ success: true });
  });

  // ============ JOBS ROUTES ============
  app.get('/api/jobs', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;

    // Background sync
    pullFromGoogleCalendar(supabase, userId).catch(err => console.error('Background sync error:', err));

    const { data: jobs } = await supabase
      .from('jobs')
      .select('*, clients(name)')
      .eq('user_id', userId)
      .order('job_date', { ascending: false });

    const jobsFormatted = (jobs || []).map(j => ({
      ...j,
      client_name: (j.clients as any)?.name || null
    }));

    res.json(jobsFormatted);
  });

  app.post('/api/jobs', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { client_id, job_type, job_date, job_time, job_end_time, job_name, amount, payment_method, payment_status, status, notes } = req.body;

    const { data, error } = await supabase.from('jobs').insert({
      client_id: client_id || null,
      job_type,
      job_date,
      job_time,
      job_end_time,
      job_name,
      amount,
      payment_method,
      payment_status,
      status: status || 'scheduled',
      notes,
      user_id: userId
    }).select().single();

    if (error) return res.status(500).json({ error: error.message });

    if (client_id) {
      await generateOpportunities(supabase, client_id, job_type, job_date, userId, data.id);
    }
    syncJobToGoogleCalendar(supabase, data.id, userId);

    res.json({ id: data.id });
  });

  app.put('/api/jobs/:id', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { client_id, job_type, job_date, job_time, job_end_time, job_name, amount, payment_method, payment_status, status, notes } = req.body;

    const { data: oldJob } = await supabase
      .from('jobs')
      .select('*')
      .eq('id', req.params.id)
      .eq('user_id', userId)
      .single();

    if (!oldJob) return res.status(404).json({ error: 'Job not found' });

    await supabase.from('jobs').update({
      client_id: client_id || null,
      job_type,
      job_date,
      job_time,
      job_end_time,
      job_name,
      amount,
      payment_method,
      payment_status,
      status: status || oldJob.status,
      notes
    }).eq('id', req.params.id);

    const jobId = Number(req.params.id);

    if (client_id) {
      const { data: linkedOpps } = await supabase
        .from('opportunities')
        .select('*')
        .eq('trigger_job_id', jobId)
        .eq('user_id', userId);

      for (const opp of linkedOpps || []) {
        const { data: rule } = await supabase
          .from('opportunity_rules')
          .select('*')
          .eq('trigger_job_type', job_type)
          .eq('target_job_type', opp.type)
          .eq('user_id', userId)
          .single();

        if (rule) {
          const suggestedDate = new Date(job_date);
          if (!isNaN(suggestedDate.getTime())) {
            suggestedDate.setDate(suggestedDate.getDate() + rule.days_offset);
            const dateStr = suggestedDate.toISOString().split('T')[0];
            await supabase.from('opportunities').update({ suggested_date: dateStr }).eq('id', opp.id);
          }
        }
      }

      if (oldJob.job_type !== job_type || oldJob.job_date !== job_date) {
        await generateOpportunities(supabase, client_id || oldJob.client_id, job_type, job_date, userId, jobId);
      }
    }

    syncJobToGoogleCalendar(supabase, jobId, userId);
    res.json({ success: true });
  });

  app.delete('/api/jobs/:id', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;

    try {
      const { data: job } = await supabase
        .from('jobs')
        .select('google_event_id')
        .eq('id', req.params.id)
        .eq('user_id', userId)
        .single();

      if (!job) return res.status(404).json({ error: 'Job not found' });

      if (job.google_event_id) {
        await deleteGoogleCalendarEvent(supabase, job.google_event_id, userId);
      }

      await supabase.from('opportunities').delete().eq('trigger_job_id', req.params.id);
      await supabase.from('jobs').delete().eq('id', req.params.id);
      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting job:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ============ FUNNEL & LEADS ROUTES ============
  app.get('/api/funnel', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { data: stages } = await supabase.from('funnel_stages').select('*').eq('user_id', userId).order('position');
    const { data: leads } = await supabase.from('leads').select('*').eq('user_id', userId);
    res.json({ stages: stages || [], leads: leads || [] });
  });

  app.post('/api/leads', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { client_name, job_type_interest, contact_date, estimated_value, status, notes, stage_id } = req.body;

    const { data, error } = await supabase.from('leads').insert({
      client_name,
      job_type_interest,
      contact_date,
      estimated_value,
      status,
      notes,
      stage_id,
      user_id: userId
    }).select().single();

    if (error) return res.status(500).json({ error: error.message });
    res.json({ id: data.id });
  });

  app.put('/api/leads/:id', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { stage_id, status } = req.body;

    const { data: existing } = await supabase
      .from('leads')
      .select('id')
      .eq('id', req.params.id)
      .eq('user_id', userId)
      .single();

    if (!existing) return res.status(404).json({ error: 'Lead not found' });

    const updates: any = {};
    if (stage_id !== undefined) updates.stage_id = stage_id;
    if (status !== undefined) updates.status = status;

    if (Object.keys(updates).length > 0) {
      await supabase.from('leads').update(updates).eq('id', req.params.id);
    }
    res.json({ success: true });
  });

  app.delete('/api/leads/:id', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;

    const { data: existing } = await supabase
      .from('leads')
      .select('id')
      .eq('id', req.params.id)
      .eq('user_id', userId)
      .single();

    if (!existing) return res.status(404).json({ error: 'Lead not found' });

    await supabase.from('leads').delete().eq('id', req.params.id);
    res.json({ success: true });
  });

  // ============ OPPORTUNITIES ROUTES ============
  app.get('/api/opportunities', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const { data: opportunities } = await supabase
      .from('opportunities')
      .select('*, clients(name)')
      .eq('user_id', userId)
      .not('status', 'in', '("converted","dismissed")')
      .lte('suggested_date', futureDate)
      .order('suggested_date');

    const oppsFormatted = (opportunities || []).map(opp => ({
      ...opp,
      client_name: (opp.clients as any)?.name || null,
      priority: getPriority(opp.suggested_date)
    }));

    res.json(oppsFormatted);
  });

  app.put('/api/opportunities/:id', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { status, notes, estimated_value } = req.body;

    const { data: existing } = await supabase
      .from('opportunities')
      .select('id')
      .eq('id', req.params.id)
      .eq('user_id', userId)
      .single();

    if (!existing) return res.status(404).json({ error: 'Opportunity not found' });

    const updates: any = {};
    if (status !== undefined) updates.status = status;
    if (notes !== undefined) updates.notes = notes;
    if (estimated_value !== undefined) updates.estimated_value = estimated_value;

    if (Object.keys(updates).length > 0) {
      await supabase.from('opportunities').update(updates).eq('id', req.params.id);
    }
    res.json({ success: true });
  });

  // ============ OPPORTUNITY RULES ROUTES ============
  app.get('/api/opportunity-rules', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { data: rules } = await supabase.from('opportunity_rules').select('*').eq('user_id', userId);
    res.json(rules || []);
  });

  app.post('/api/opportunity-rules', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { trigger_job_type, target_job_type, days_offset } = req.body;

    const { data, error } = await supabase.from('opportunity_rules').insert({
      trigger_job_type,
      target_job_type,
      days_offset,
      user_id: userId
    }).select().single();

    if (error) return res.status(500).json({ error: error.message });
    res.json({ id: data.id });
  });

  app.put('/api/opportunity-rules/:id', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { trigger_job_type, target_job_type, days_offset, is_active } = req.body;

    const { data: existing } = await supabase
      .from('opportunity_rules')
      .select('id')
      .eq('id', req.params.id)
      .eq('user_id', userId)
      .single();

    if (!existing) return res.status(404).json({ error: 'Rule not found' });

    await supabase.from('opportunity_rules').update({
      trigger_job_type,
      target_job_type,
      days_offset,
      is_active
    }).eq('id', req.params.id);
    res.json({ success: true });
  });

  app.delete('/api/opportunity-rules/:id', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;

    const { data: existing } = await supabase
      .from('opportunity_rules')
      .select('id')
      .eq('id', req.params.id)
      .eq('user_id', userId)
      .single();

    if (!existing) return res.status(404).json({ error: 'Rule not found' });

    await supabase.from('opportunity_rules').delete().eq('id', req.params.id);
    res.json({ success: true });
  });

  // ============ DEALS / PIPELINE ROUTES ============
  const appendStageHistory = (
    history: any[] | null | undefined,
    stageId: string,
    stageName: string,
    nowIso: string
  ) => {
    const next = Array.isArray(history)
      ? history.map((h) => ({ ...h }))
      : [];
    if (next.length > 0 && !next[next.length - 1].left_at) {
      next[next.length - 1].left_at = nowIso;
    }
    next.push({
      stage_id: stageId,
      stage_name: stageName,
      entered_at: nowIso,
      left_at: null,
    });
    return next;
  };

  const loadDeals = async (supabase: SupabaseClient, userId: string) => {
    const stages = await ensurePipelineStages(supabase, userId);

    const [dealsRes, clientsRes] = await Promise.all([
      supabase.from('deals').select('*').eq('user_id', userId),
      supabase.from('clients').select('id, name').eq('user_id', userId),
    ]);

    const clients = clientsRes.data || [];
    const clientMap = new Map<number, string>();
    clients.forEach((c) => clientMap.set(c.id, c.name));

    const dealsRaw = dealsRes.data || [];
    const activityMap = await fetchActivityMetrics(
      supabase,
      userId,
      dealsRaw.map((d: any) => d.id),
    );

    const deals = dealsRaw.map((deal: any) => {
      const activity = activityMap.get(deal.id);
      const { temperature, score } = calculateTemperature(deal, activity);
      return {
        ...deal,
        stage_entered_at: deal.current_stage_entered_at || deal.stage_entered_at || deal.updated_at || deal.created_at,
        activity_count: activity?.count || 0,
        last_activity_at: activity?.last || null,
        temperature,
        temperature_score: score,
        client_name: deal.client_id ? clientMap.get(deal.client_id) || null : null,
      };
    });

    return { deals, stages };
  };

  app.get('/api/pipeline/stages', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const stages = await ensurePipelineStages(supabase, userId);
    res.json(stages);
  });

  app.post('/api/pipeline/stages', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { name, color } = req.body;
    if (!name) return res.status(400).json({ error: 'Nome da etapa é obrigatório' });

    const stages = await ensurePipelineStages(supabase, userId);
    const nonFinal = stages.filter((s) => !s.is_final);
    const position = nonFinal.length;
    const id = createStageId(name);

    const payload: any = { id, name, color: color || '#E5E7EB', position, is_final: false, is_won: false, user_id: userId };
    const { error, data } = await supabase.from('deal_stages').insert(payload).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  });

  app.put('/api/pipeline/stages/reorder', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { stageIds } = req.body as { stageIds: string[] };
    if (!Array.isArray(stageIds)) return res.status(400).json({ error: 'stageIds deve ser array' });

    const stages = await ensurePipelineStages(supabase, userId);
    const finals = stages.filter((s) => s.is_final);

    await Promise.all(stageIds.map((id: string, index: number) => supabase.from('deal_stages').update({ position: index }).eq('id', id).eq('user_id', userId)));

    await Promise.all(
      finals.map((stage, idx) =>
        supabase
          .from('deal_stages')
          .update({ position: stageIds.length + idx })
          .eq('id', stage.id)
          .eq('user_id', userId),
      ),
    );

    res.json({ success: true });
  });

  app.put('/api/pipeline/stages/:id', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { id } = req.params;
    const { name, color } = req.body;

    const stages = await ensurePipelineStages(supabase, userId);
    const stage = stages.find((s) => s.id === id) || DEFAULT_STAGES.find((s) => s.id === id);
    if (!stage) return res.status(404).json({ error: 'Etapa não encontrada' });
    if (stage.is_final && name) return res.status(400).json({ error: 'Não é possível renomear etapa final' });

    const { error } = await supabase
      .from('deal_stages')
      .update({ name: name || stage.name, color: color || stage.color })
      .eq('id', id)
      .eq('user_id', userId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  });

  app.delete('/api/pipeline/stages/:id', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { id } = req.params;
    const stages = await ensurePipelineStages(supabase, userId);
    const stage = stages.find((s) => s.id === id);
    if (!stage) return res.status(404).json({ error: 'Etapa não encontrada' });
    if (stage.is_final) return res.status(400).json({ error: 'Etapas finais não podem ser removidas' });

    const fallbackStage = stageIdOrDefault(stages, stages.find((s) => !s.is_final && s.id !== id)?.id);
    await supabase.from('deals').update({ stage: fallbackStage }).eq('stage', id).eq('user_id', userId);
    await supabase.from('deal_stages').delete().eq('id', id).eq('user_id', userId);
    res.json({ success: true });
  });

  app.get('/api/deals', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { deals } = await loadDeals(supabase, userId);
    res.json(deals);
  });

  app.post('/api/deals', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const stages = await ensurePipelineStages(supabase, userId);
    const { client_id, title, value, stage, priority, expected_close_date, next_follow_up, notes } = req.body;
    const nowIso = new Date().toISOString();
    const stageId = stageIdOrDefault(stages, stage);
    const stageName = stages.find((s) => s.id === stageId)?.name || stageId;

    const payload: any = {
      client_id: client_id || null,
      title,
      value: value || 0,
      stage: stageId,
      stage_entered_at: nowIso,
      current_stage_entered_at: nowIso,
      stage_history: [
        {
          stage_id: stageId,
          stage_name: stageName,
          entered_at: nowIso,
          left_at: null,
        },
      ],
      priority: priority || 'medium',
      expected_close_date: expected_close_date || null,
      next_follow_up: next_follow_up || null,
      notes: notes || null,
      user_id: userId,
      updated_at: nowIso,
    };

    const { data, error } = await supabase.from('deals').insert(payload).select().single();
    if (error) {
      console.warn('Falha ao inserir com campos estendidos, tentando fallback', error.message);
      const minimal = {
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
        current_stage_entered_at: payload.current_stage_entered_at,
        stage_history: payload.stage_history,
      };
      const retry = await supabase.from('deals').insert(minimal).select().single();
      if (retry.error || !retry.data) return res.status(500).json({ error: retry.error?.message || 'Erro ao criar deal' });
      return res.json({ id: retry.data.id });
    }
    res.json({ id: data.id });
  });

  app.post('/api/deals/quick', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const stages = await ensurePipelineStages(supabase, userId);
    const firstStage = stages.find((s) => !s.is_final) || DEFAULT_STAGES[0];
    const { name, phone, email, value, source } = req.body;
    if (!name || !phone) return res.status(400).json({ error: 'Nome e telefone são obrigatórios' });

    const nowIso = new Date().toISOString();
    const payload: any = {
      title: name,
      contact_name: name,
      contact_phone: phone,
      contact_email: email || null,
      lead_source: source || null,
      value: Number(value) || 0,
      stage: firstStage.id,
      stage_entered_at: nowIso,
      current_stage_entered_at: nowIso,
      stage_history: [
        {
          stage_id: firstStage.id,
          stage_name: firstStage.name,
          entered_at: nowIso,
          left_at: null,
        },
      ],
      priority: 'medium',
      user_id: userId,
      updated_at: nowIso,
    };

    const { data, error } = await supabase.from('deals').insert(payload).select().single();
    if (error) {
      const retryPayload = {
        title: name,
        value: Number(value) || 0,
        stage: firstStage.id,
        priority: 'medium',
        notes: `Telefone: ${phone}${email ? ` | Email: ${email}` : ''}${source ? ` | Origem: ${source}` : ''}`,
        user_id: userId,
        updated_at: nowIso,
        current_stage_entered_at: nowIso,
        stage_history: payload.stage_history,
      };
      const retry = await supabase.from('deals').insert(retryPayload).select().single();
      if (retry.error || !retry.data) return res.status(500).json({ error: retry.error?.message || 'Erro ao criar lead' });
      return res.json({ id: retry.data.id, fallbackNotes: true });
    }

    res.json({ id: data.id });
  });

  app.put('/api/deals/:id', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const dealId = Number(req.params.id);

    console.log('=== DEBUG PUT /api/deals/:id ===');
    console.log('dealId:', dealId, 'tipo:', typeof dealId);
    console.log('userId:', userId);
    console.log('body:', req.body);

    if (isNaN(dealId)) {
      return res.status(400).json({ error: 'ID inválido' });
    }

    // Testa buscar SEM o filtro de user_id primeiro
    const { data: dealSemUser, error: errSemUser } = await supabase
      .from('deals')
      .select('id, user_id, stage')
      .eq('id', dealId)
      .single();
    
    console.log('Deal sem filtro user_id:', dealSemUser, 'erro:', errSemUser);

    const { data: existing, error: errExisting } = await supabase
      .from('deals')
      .select('id, stage, stage_entered_at, stage_history, current_stage_entered_at, user_id')
      .eq('id', dealId)
      .eq('user_id', userId)
      .single();

    console.log('Deal com filtro user_id:', existing, 'erro:', errExisting);
    console.log('=== FIM DEBUG ===');

    if (!existing) return res.status(404).json({ error: 'Deal not found' });

    const updates: any = { ...req.body, updated_at: new Date().toISOString() };

    if (updates.stage && updates.stage !== existing.stage) {
      const stages = await ensurePipelineStages(supabase, userId);
      const stageName = stages.find((s) => s.id === updates.stage)?.name || updates.stage;
      const nowIso = new Date().toISOString();
      updates.stage_entered_at = nowIso;
      updates.current_stage_entered_at = nowIso;
      updates.stage_history = appendStageHistory(existing.stage_history, updates.stage, stageName, nowIso);
      await recordStageEvent(
        supabase,
        userId,
        dealId,
        existing.stage,
        updates.stage,
        existing.current_stage_entered_at || existing.stage_entered_at
      );
    }

    const { error } = await supabase.from('deals').update(updates).eq('id', dealId).eq('user_id', userId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  });

  app.delete('/api/deals/:id', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;

    const { data: existing } = await supabase
      .from('deals')
      .select('id')
      .eq('id', req.params.id)
      .eq('user_id', userId)
      .single();

    if (!existing) return res.status(404).json({ error: 'Deal not found' });

    await supabase.from('deals').delete().eq('id', req.params.id).eq('user_id', userId);
    res.json({ success: true });
  });

  app.get('/api/deals/:id/history', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const stages = await ensurePipelineStages(supabase, userId);
    const stageMap = new Map(stages.map((s) => [s.id, s.name]));

    const { data: deal } = await supabase
      .from('deals')
      .select('stage_history, stage, current_stage_entered_at, created_at')
      .eq('id', req.params.id)
      .eq('user_id', userId)
      .single();

    if (!deal) return res.status(404).json({ error: 'Deal not found' });

    let history = Array.isArray((deal as any).stage_history)
      ? ((deal as any).stage_history as any[])
      : [];

    history = history.map((entry) => ({
      ...entry,
      stage_name: entry.stage_name || stageMap.get(entry.stage_id) || entry.stage_id,
    }));

    history.sort(
      (a, b) =>
        new Date(a.entered_at).getTime() - new Date(b.entered_at).getTime()
    );

    if (history.length === 0) {
      history = [
        {
          stage_id: deal.stage,
          stage_name: stageMap.get(deal.stage) || deal.stage,
          entered_at: deal.current_stage_entered_at || deal.created_at || new Date().toISOString(),
          left_at: null,
        },
      ];
    }

    res.json(history);
  });

  app.get('/api/deals/:id/activities', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;

    const { data: activities, error } = await supabase
      .from('deal_activities')
      .select('*')
      .eq('deal_id', req.params.id)
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    res.json(activities || []);
  });

  app.post('/api/deals/:id/activities', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const dealId = Number(req.params.id);
    const { type, description } = req.body;

    const { data: existing } = await supabase
      .from('deals')
      .select('id')
      .eq('id', dealId)
      .eq('user_id', userId)
      .single();
    if (!existing) return res.status(404).json({ error: 'Deal not found' });

    const { error } = await supabase.from('deal_activities').insert({
      deal_id: dealId,
      user_id: userId,
      type,
      description: description || null,
    });

    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  });

  app.post('/api/deals/:id/convert', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const stages = await ensurePipelineStages(supabase, userId);
    const wonStage = stages.find((s) => s.is_won) || DEFAULT_STAGES.find((s) => s.is_won);
    const { createClient, createJob, client, job } = req.body;
    const nowIso = new Date().toISOString();

    const { data: deal } = await supabase
      .from('deals')
      .select('*')
      .eq('id', req.params.id)
      .eq('user_id', userId)
      .single();
    if (!deal) return res.status(404).json({ error: 'Deal not found' });

    let clientId = deal.client_id as number | null;

    if (createClient) {
      const clientPayload = {
        name: client?.name || deal.title,
        phone: client?.phone || deal.contact_phone || null,
        email: client?.email || deal.contact_email || null,
        status: 'active',
        user_id: userId,
      } as any;
      const { data: newClient, error } = await supabase.from('clients').insert(clientPayload).select().single();
      if (error) return res.status(500).json({ error: error.message });
      clientId = newClient?.id || clientId;
    }

    let jobId: number | null = null;
    if (createJob && job) {
      const jobPayload = {
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
        notes: job.notes || '',
        user_id: userId,
      } as any;
      const { data: newJob, error } = await supabase.from('jobs').insert(jobPayload).select().single();
      if (error) return res.status(500).json({ error: error.message });
      jobId = newJob?.id || null;
    }

    const stageId = wonStage?.id || 'won';
    const stageName = wonStage?.name || stageId;
    const updates: any = {
      stage: stageId,
      stage_entered_at: nowIso,
      current_stage_entered_at: nowIso,
      stage_history: appendStageHistory(deal.stage_history, stageId, stageName, nowIso),
      converted: true,
      converted_at: nowIso,
      converted_client_id: clientId,
      converted_job_id: jobId,
      client_id: clientId || deal.client_id,
      temperature: 'hot',
      temperature_locked: true,
    };

    const { error } = await supabase.from('deals').update(updates).eq('id', req.params.id).eq('user_id', userId);
    if (error) return res.status(500).json({ error: error.message });
    await recordStageEvent(
      supabase,
      userId,
      Number(req.params.id),
      deal.stage,
      updates.stage,
      deal.current_stage_entered_at || deal.stage_entered_at
    );
    res.json({ success: true, client_id: clientId, job_id: jobId });
  });

  app.post('/api/deals/:id/lost', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const stages = await ensurePipelineStages(supabase, userId);
    const lostStage = stages.find((s) => s.id === req.body.stageId) || stages.find((s) => s.id === 'lost') || DEFAULT_STAGES.find((s) => s.id === 'lost');
    const { reason, notes } = req.body;
    const nowIso = new Date().toISOString();

    const { data: deal } = await supabase
      .from('deals')
      .select('*')
      .eq('id', req.params.id)
      .eq('user_id', userId)
      .single();
    if (!deal) return res.status(404).json({ error: 'Deal not found' });

    const stageId = lostStage?.id || 'lost';
    const stageName = lostStage?.name || stageId;
    const updates: any = {
      stage: stageId,
      stage_entered_at: nowIso,
      current_stage_entered_at: nowIso,
      stage_history: appendStageHistory(deal.stage_history, stageId, stageName, nowIso),
      lost_reason: reason || null,
      lost_notes: notes || null,
      temperature: 'cold',
      temperature_locked: true,
    };
    const { error } = await supabase.from('deals').update(updates).eq('id', req.params.id).eq('user_id', userId);
    if (error) return res.status(500).json({ error: error.message });
    await recordStageEvent(
      supabase,
      userId,
      Number(req.params.id),
      deal.stage,
      updates.stage,
      deal.current_stage_entered_at || deal.stage_entered_at
    );
    res.json({ success: true });
  });

  app.get('/api/pipeline/analytics', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { deals, stages } = await loadDeals(supabase, userId);
    let events: any[] = [];
    try {
      const { data } = await supabase.from('deal_stage_events').select('*').eq('user_id', userId);
      events = data || [];
    } catch (err) {
      console.warn('deal_stage_events not available', err);
    }
    const analytics = computePipelineAnalytics(deals, stages, events);
    res.json(analytics);
  });

  // ============ STATS ROUTE ============
  app.get('/api/stats', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
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

    const totalClientsBase = clients.length;
    const totalClientsMonth = clients.filter((c) => c.created_at?.startsWith(currentMonth)).length;
    const totalJobsMonth = jobs.filter((j) => j.job_date?.startsWith(currentMonth)).length;
    const activeLeads = leads.filter((l) => l.status && !['closed', 'lost'].includes(l.status)).length;

    const revenueByTypeMap: Record<string, number> = {};
    jobs.forEach((j) => {
      if (j.job_type && j.amount) {
        revenueByTypeMap[j.job_type] = (revenueByTypeMap[j.job_type] || 0) + j.amount;
      }
    });
    const revenueByTypeArray = Object.entries(revenueByTypeMap).map(([job_type, total]) => ({ job_type, total }));

    const dailyRevenueMap: Record<string, number> = {};
    jobs.forEach((j) => {
      if (j.job_date && j.amount) {
        dailyRevenueMap[j.job_date] = (dailyRevenueMap[j.job_date] || 0) + j.amount;
      }
    });
    const dailyRevenue = Object.entries(dailyRevenueMap)
      .map(([date, total]) => ({ date, total }))
      .sort((a, b) => a.date.localeCompare(b.date));

    res.json({
      totalClientsBase: totalClientsBase || 0,
      totalClientsMonth,
      totalJobsMonth,
      activeLeads: activeLeads || 0,
      revenueByType: revenueByTypeArray,
      dailyRevenue
    });
  });

  // ============ CSV IMPORT ROUTE ============
  app.post('/api/clients/import/csv', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { csvData } = req.body;
    if (!csvData) return res.status(400).json({ error: 'No CSV data provided' });

    try {
      const results = Papa.parse(csvData, { header: true, skipEmptyLines: true, dynamicTyping: false });
      const rows = results.data as any[];

      let importedClientsCount = 0;
      let updatedClientsCount = 0;
      let importedJobsCount = 0;
      let updatedJobsCount = 0;

      const formatDate = (dateStr: string | null | undefined) => {
        if (!dateStr || typeof dateStr !== 'string') return null;
        const clean = dateStr.trim();
        if (!clean) return null;
        const parts = clean.split('/');
        if (parts.length === 3) {
          return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
        }
        return clean;
      };

      const formatTime = (timeStr: string | null | undefined) => {
        if (!timeStr || typeof timeStr !== 'string') return null;
        const clean = timeStr.trim().toLowerCase();
        if (!clean) return null;
        if (clean.includes('h')) {
          const [h, m] = clean.replace('h', ':').split(':');
          return `${String(h || '00').padStart(2, '0')}:${String(m || '00').padStart(2, '0')}`;
        }
        if (clean.includes(':')) {
          const [h, m] = clean.split(':');
          return `${String(h || '00').padStart(2, '0')}:${String(m || '00').padStart(2, '0')}`;
        }
        return clean;
      };

      const formatAmount = (amountStr: any) => {
        if (amountStr === null || amountStr === undefined) return 0;
        if (typeof amountStr === 'number') return amountStr;
        if (typeof amountStr === 'string') {
          let clean = amountStr.replace('R$', '').trim();
          if (!clean) return 0;
          const matches = clean.match(/[\d.,]+/g);
          if (!matches) return 0;
          const nums = matches.map(v => {
            let val = v.trim();
            if (val.includes('.') && val.includes(',')) val = val.replace(/\./g, '').replace(',', '.');
            else if (val.includes(',')) val = val.replace(',', '.');
            return parseFloat(val) || 0;
          }).filter(n => n > 0);
          return nums.length > 0 ? Math.max(...nums) : 0;
        }
        return 0;
      };

      const normalizePhone = (phone: any) => phone ? String(phone).replace(/\D/g, '') || null : null;

      const getVal = (row: any, keys: string[]) => {
        for (const key of keys) {
          const found = Object.keys(row).find(k => k.trim().toLowerCase() === key.trim().toLowerCase());
          if (found) return row[found];
        }
        return null;
      };

      for (const row of rows) {
        const name = getVal(row, ['NOME', 'name'])?.toString().trim();
        if (!name) continue;

        const phone = normalizePhone(getVal(row, ['Telefone', 'phone']));
        const email = getVal(row, ['E-MAIL', 'email'])?.toString().trim() || null;
        const cpf = getVal(row, ['CPF', 'cpf'])?.toString().trim() || null;

        let existingClient = null;
        if (cpf) {
          const { data } = await supabase.from('clients').select('id').eq('cpf', cpf).eq('user_id', userId).single();
          existingClient = data;
        }
        if (!existingClient && phone) {
          const { data } = await supabase.from('clients').select('id').eq('phone', phone).eq('user_id', userId).single();
          existingClient = data;
        }
        if (!existingClient) {
          const { data } = await supabase.from('clients').select('id').eq('name', name).eq('user_id', userId).single();
          existingClient = data;
        }

        const clientData = {
          name,
          phone,
          email,
          birth_date: formatDate(getVal(row, ['NASCIMENTO', 'birth_date'])?.toString()),
          cpf,
          cep: getVal(row, ['CEP', 'cep'])?.toString().trim() || null,
          address: getVal(row, ['Endereco', 'address'])?.toString().trim() || null,
          neighborhood: getVal(row, ['Bairro', 'neighborhood'])?.toString().trim() || null,
          city: getVal(row, ['Cidade', 'city'])?.toString().trim() || null,
          state: getVal(row, ['UF', 'state'])?.toString().trim() || null,
          age: getVal(row, ['IDADE', 'age'])?.toString().trim() || null,
          child_name: getVal(row, ['Filho(a)', 'child_name'])?.toString().trim() || null,
          instagram: getVal(row, ['Instagram', 'instagram'])?.toString().trim() || null,
          closing_date: formatDate(getVal(row, ['Data de Fechamento', 'closing_date'])?.toString()),
          lead_source: getVal(row, ['Como Conheceu', 'lead_source'])?.toString().trim() || null,
          status: 'active',
          user_id: userId
        };

        let clientId: number;

        if (existingClient) {
          clientId = existingClient.id;
          await supabase.from('clients').update(clientData).eq('id', clientId);
          updatedClientsCount++;
        } else {
          const { data: newClient, error: insertError } = await supabase.from('clients').insert(clientData).select().single();

          if (insertError || !newClient) {
            console.error('Erro ao inserir cliente:', insertError, 'Dados:', clientData);
            continue;
          }

          clientId = newClient.id;
          importedClientsCount++;
        }

        const ensaio = getVal(row, ['ENSAIO', 'job_type'])?.toString().trim() || null;
        const dataEnsaio = formatDate(getVal(row, ['DATA DO ENSAIO', 'job_date'])?.toString());
        const valor = formatAmount(getVal(row, ['VALOR', ' VALOR ', 'amount']));

        if (ensaio || dataEnsaio || valor > 0) {
          const horario = formatTime(getVal(row, ['HORÁRIO', 'job_time'])?.toString());
          const pacote = getVal(row, ['PACOTE', 'notes'])?.toString().trim() || null;
          const pago = getVal(row, ['PAGO', ' PAGO ', 'payment_status'])?.toString().trim() || null;
          const today = new Date().toISOString().split('T')[0];

          const jobData = {
            client_id: clientId,
            job_name: pacote ? `${ensaio || 'Ensaio'} - ${pacote}` : (ensaio || 'Ensaio'),
            job_type: ensaio || 'Outros',
            job_date: dataEnsaio,
            job_time: horario,
            amount: valor || 0,
            payment_status: pago?.toLowerCase().includes('sim') ? 'paid' : 'pending',
            status: dataEnsaio && dataEnsaio < today ? 'completed' : 'scheduled',
            user_id: userId
          };

          const { data: existingJob } = await supabase
            .from('jobs')
            .select('id')
            .eq('client_id', clientId)
            .eq('job_type', ensaio || '')
            .eq('job_date', dataEnsaio || '')
            .eq('user_id', userId)
            .single();

          if (existingJob) {
            await supabase.from('jobs').update(jobData).eq('id', existingJob.id);
            updatedJobsCount++;
          } else {
            await supabase.from('jobs').insert(jobData);
            importedJobsCount++;
          }
        }
      }

      res.json({ success: true, importedClientsCount, updatedClientsCount, importedJobsCount, updatedJobsCount });
    } catch (error) {
      console.error('Error importing CSV:', error);
      res.status(500).json({ error: 'Failed to parse or import CSV data' });
    }
  });

  // ============ VITE / STATIC FILES ============
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();

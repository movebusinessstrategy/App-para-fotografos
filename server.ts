import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import { google } from 'googleapis';
import dotenv from 'dotenv';
import Papa from 'papaparse';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseClient, supabaseAdmin } from './supabase.js';
import {
  DEFAULT_STAGES,
  DEFAULT_PRODUCTION_STAGES,
  DEFAULT_PRODUCTION_STAGES_V2,
  calculateTemperature,
  computePipelineAnalytics,
  createStageId,
  ensurePipelineStages,
  ensureProductionStages,
  ensureProductionProcesses,
  ensureProductionStagesV2,
  fetchActivityMetrics,
  recordStageEvent,
  stageIdOrDefault,
} from './pipeline-helpers.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ============ WHATSAPP PROVIDER CONFIG ============
const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL || 'https://evolution-api-ocpq.onrender.com';
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY || '';
const normalizeZApiBaseUrl = (raw: string | undefined) => {
  const value = (raw || 'https://api.z-api.io').trim();

  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}`;
  } catch {
    return 'https://api.z-api.io';
  }
};

const ZAPI_BASE_URL = normalizeZApiBaseUrl(process.env.ZAPI_BASE_URL);
const ZAPI_INSTANCE_ID = process.env.ZAPI_INSTANCE_ID || '';
const ZAPI_INSTANCE_TOKEN = process.env.ZAPI_INSTANCE_TOKEN || '';
const ZAPI_CLIENT_TOKEN = process.env.ZAPI_CLIENT_TOKEN || '';
const WHATSAPP_PROVIDER = (process.env.WHATSAPP_PROVIDER || (
  ZAPI_INSTANCE_ID && ZAPI_INSTANCE_TOKEN && ZAPI_CLIENT_TOKEN ? 'zapi' : 'evolution'
)).toLowerCase();

const isZApiEnabled = () => WHATSAPP_PROVIDER === 'zapi';

const getMissingZApiConfig = () => {
  const missing: string[] = [];
  if (!ZAPI_INSTANCE_ID) missing.push('ZAPI_INSTANCE_ID');
  if (!ZAPI_INSTANCE_TOKEN) missing.push('ZAPI_INSTANCE_TOKEN');
  if (!ZAPI_CLIENT_TOKEN || /SEU_TOKEN|YOUR_TOKEN|TOKEN_DE_SEGURANCA/i.test(ZAPI_CLIENT_TOKEN)) {
    missing.push('ZAPI_CLIENT_TOKEN');
  }
  return missing;
};

const ensureDataUrl = async (value: string): Promise<string | null> => {
  if (!value) return null;
  if (value.startsWith('data:image/')) return value;

  if (/^https?:\/\//i.test(value)) {
    try {
      const imageResponse = await fetch(value);
      if (!imageResponse.ok) return null;
      const contentType = imageResponse.headers.get('content-type') || 'image/png';
      const buffer = Buffer.from(await imageResponse.arrayBuffer());
      return `data:${contentType};base64,${buffer.toString('base64')}`;
    } catch {
      return null;
    }
  }

  return `data:image/png;base64,${value}`;
};

const parseHttpResponse = async (response: Response) => {
  const contentType = response.headers.get('content-type') || '';
  const raw = await response.text();

  let data: any = raw;
  if (contentType.includes('application/json')) {
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      data = raw;
    }
  } else if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      data = raw;
    }
  }

  return { raw, data, contentType };
};

const zapiHeaders = (withJson = false): HeadersInit => {
  const headers: Record<string, string> = {
    'Client-Token': ZAPI_CLIENT_TOKEN,
  };
  if (withJson) headers['Content-Type'] = 'application/json';
  return headers;
};

const zapiUrl = (path: string) =>
  `${ZAPI_BASE_URL}/instances/${ZAPI_INSTANCE_ID}/token/${ZAPI_INSTANCE_TOKEN}${path}`;

const normalizeWhatsappState = (data: any): 'open' | 'close' => {
  const statusRaw =
    data?.instance?.state ??
    data?.state ??
    data?.connectionStatus ??
    data?.status;

  if (typeof statusRaw === 'string') {
    const normalized = statusRaw.toLowerCase();
    if (['open', 'connected', 'online'].includes(normalized)) return 'open';
  }

  if (data?.connected === true || data?.authenticated === true) return 'open';
  return 'close';
};

const extractQrCandidate = (payload: any, raw: string): string | null => {
  const candidates = [
    payload?.value,
    payload?.base64,
    payload?.qrcode?.base64,
    payload?.qrcode,
    payload?.qrCode,
    payload?.code,
    typeof payload === 'string' ? payload : null,
    raw,
  ];

  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const value = candidate.trim().replace(/^"|"$/g, '');
    if (!value || value.startsWith('{') || value.startsWith('[')) continue;
    if (value.startsWith('2@')) continue; // evita confundir "code" textual com QR de imagem
    if (value.startsWith('data:image/')) return value;
    if (/^https?:\/\//i.test(value)) return value;
    if (/^[A-Za-z0-9+/=]+$/.test(value) && value.length > 60) return value;
  }

  return null;
};

interface LiveWhatsAppMessage {
  id: string;
  phone: string;
  name?: string;
  text: string;
  fromMe: boolean;
  timestamp: number;
  source: 'webhook';
}

const LIVE_MESSAGE_CACHE_LIMIT = 400;
const liveWhatsAppMessagesByPhone = new Map<string, LiveWhatsAppMessage[]>();
const readUpToTimestampByPhone = new Map<string, number>();
const qrCodeByInstance = new Map<string, string>();


const normalizePhone = (value: unknown) => {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  return String(value).replace(/\D/g, '');
};

// Brasil: número com 10 dígitos locais (sem o 9) → normaliza para 11 dígitos
// Ex: 554388416682 (12 total) → 5543988416682 (13 total)
const normalizeBrazilianPhone = (digits: string): string => {
  if (digits.startsWith('55') && digits.length === 12) {
    return digits.slice(0, 4) + '9' + digits.slice(4);
  }
  return digits;
};

const parseWebhookTimestamp = (payload: any) => {
  const candidates = [payload?.momment, payload?.moment, payload?.timestamp, payload?.ts];
  for (const candidate of candidates) {
    const parsed = Number(candidate);
    if (!Number.isFinite(parsed) || parsed <= 0) continue;
    return parsed > 1_000_000_000_000 ? parsed : parsed * 1000;
  }
  return Date.now();
};

const extractWebhookText = (payload: any): string | null => {
  const candidates = [
    payload?.text?.message,
    payload?.extendedTextMessage?.text,
    payload?.extendedTextMessage?.description,
    payload?.image?.caption,
    payload?.video?.caption,
    payload?.document?.caption,
    payload?.caption,
    payload?.conversation,
    payload?.message,
    payload?.button?.text,
    payload?.reaction?.emoji,
  ];

  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const text = candidate.trim();
    if (text) return text;
  }

  return null;
};

const cacheLiveWhatsAppMessage = (message: LiveWhatsAppMessage, userId?: string) => {
  const existing = liveWhatsAppMessagesByPhone.get(message.phone) || [];
  const alreadyExists = existing.some((item) => item.id === message.id);
  if (!alreadyExists) {
    existing.push(message);
    if (existing.length > LIVE_MESSAGE_CACHE_LIMIT) {
      existing.splice(0, existing.length - LIVE_MESSAGE_CACHE_LIMIT);
    }
    liveWhatsAppMessagesByPhone.set(message.phone, existing);
  }

  // Persistir no Supabase se userId disponível
  if (userId) {
    persistMessageToSupabase(userId, message).catch(() => {});
  }
};

async function persistMessageToSupabase(userId: string, message: LiveWhatsAppMessage) {
  try {
    const supabase = createSupabaseClient();
    const ts = new Date(message.timestamp).toISOString();

    // Upsert mensagem
    await supabase.from('wa_messages').upsert({
      user_id: userId,
      phone: message.phone,
      message_id: message.id,
      body: message.text,
      from_me: message.fromMe,
      type: 'text',
      timestamp: ts,
      status: 'received',
    }, { onConflict: 'user_id,message_id', ignoreDuplicates: true });

    // Upsert conversa (atualiza último msg)
    await supabase.from('wa_conversations').upsert({
      user_id: userId,
      phone: message.phone,
      contact_name: message.name || null,
      last_message: message.text,
      last_message_at: ts,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,phone' });
  } catch (err) {
    // Falha silenciosa — cache em memória ainda funciona
  }
}

const getLiveMessagesByPhone = (phone: string, limit = 50) => {
  const all = liveWhatsAppMessagesByPhone.get(phone) || [];
  return all.slice(Math.max(0, all.length - limit));
};

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

  // ============ CORS — permite extensão Chrome ============
  app.use((req, res, next) => {
    const origin = req.headers.origin || '';
    const allowed = [
      'https://app-para-fotografos.vercel.app', // sempre permitido
      process.env.APP_URL,
      'http://localhost:5173',
      'http://localhost:3000',
    ].filter(Boolean) as string[];
    if (allowed.includes(origin) || origin.startsWith('chrome-extension://')) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,x-extension-id');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  // Health check — used by frontend to warm up Render free tier
  app.get('/api/health', (_req, res) => res.json({ ok: true }));

  // ============ AUTH MIDDLEWARE ============
  const requireAuth = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Não autorizado' });
    }

    const token = authHeader.substring(7);
    const userClient = createSupabaseClient(authHeader);

    try {
      const { data: { user }, error } = await userClient.auth.getUser(token);
      if (error || !user) {
        return res.status(401).json({ error: 'Não autorizado' });
      }

      // ── Detectar se é membro de equipe ────────────────────────────────
      if (supabaseAdmin) {
        // 1) Verificar por member_user_id (já vinculado)
        const { data: memberById } = await supabaseAdmin
          .from('team_members')
          .select('id, owner_user_id, permissions')
          .eq('member_user_id', user.id)
          .eq('is_active', true)
          .maybeSingle();

        if (memberById) {
          (req as any).userId = memberById.owner_user_id;
          (req as any).memberPermissions = memberById.permissions;
          (req as any).isMember = true;
          (req as any).supabase = supabaseAdmin;
          return next();
        }

        // 2) Auto-link: primeira entrada após convite (busca por e-mail)
        if (user.email) {
          const { data: memberByEmail } = await supabaseAdmin
            .from('team_members')
            .select('id, owner_user_id, permissions')
            .eq('email', user.email)
            .eq('is_active', true)
            .is('member_user_id', null)
            .maybeSingle();

          if (memberByEmail) {
            await supabaseAdmin
              .from('team_members')
              .update({ member_user_id: user.id })
              .eq('id', memberByEmail.id);

            (req as any).userId = memberByEmail.owner_user_id;
            (req as any).memberPermissions = memberByEmail.permissions;
            (req as any).isMember = true;
            (req as any).supabase = supabaseAdmin;
            return next();
          }
        }
      }

      // ── Dono da conta ─────────────────────────────────────────────────
      (req as any).userId = user.id;
      (req as any).memberPermissions = null;
      (req as any).isMember = false;
      (req as any).supabase = userClient;
      next();
    } catch (err) {
      console.error('Erro ao validar token:', err);
      return res.status(401).json({ error: 'Não autorizado' });
    }
  };

  // ============ WHATSAPP ROUTES (Z-API OU EVOLUTION) ============
  const getInstanceName = (userId: string) => `user_${userId.replace(/-/g, '_')}`;
  const zapiConfigError = () => ({
    error: 'Z-API não configurada. Defina ZAPI_INSTANCE_ID, ZAPI_INSTANCE_TOKEN e ZAPI_CLIENT_TOKEN.',
    missing: getMissingZApiConfig(),
  });

  app.post('/api/whatsapp/instance', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const instanceName = getInstanceName(userId);

    if (isZApiEnabled()) {
      if (getMissingZApiConfig().length > 0) {
        return res.status(500).json(zapiConfigError());
      }

      try {
        const response = await fetch(zapiUrl('/status'), {
          method: 'GET',
          headers: zapiHeaders(),
        });
        const parsed = await parseHttpResponse(response);
        if (!response.ok) {
          return res.status(response.status).json({
            error: 'Falha ao consultar status na Z-API',
            provider: 'zapi',
            details: parsed.data,
          });
        }
        const state = normalizeWhatsappState(parsed.data);

        return res.status(response.status).json({
          success: response.ok,
          provider: 'zapi',
          state,
          connectionStatus: state,
          instance: { state },
          details: parsed.data,
        });
      } catch (error) {
        console.error('Erro ao inicializar sessão Z-API:', error);
        return res.status(500).json({ error: 'Falha ao inicializar sessão WhatsApp (Z-API)' });
      }
    }

    // Evolution API
    try {
      const response = await fetch(`${EVOLUTION_API_URL}/instance/create`, {
        method: 'POST',
        headers: { 'apikey': EVOLUTION_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ instanceName, qrcode: true, integration: 'WHATSAPP-BAILEYS' }),
      });
      const parsed = await parseHttpResponse(response);
      return res.status(response.status).json({ success: response.ok, provider: 'evolution', ...parsed.data });
    } catch (error) {
      console.error('Erro ao inicializar sessão Evolution API:', error);
      return res.status(500).json({ error: 'Falha ao inicializar sessão WhatsApp' });
    }
  });

  // Configura webhook em instância Evolution já existente
  app.post('/api/whatsapp/configure-webhook', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const instanceName = getInstanceName(userId);
    const serverUrl = process.env.SERVER_URL?.replace(/\/$/, '') || '';
    if (!serverUrl) return res.status(400).json({ error: 'SERVER_URL não configurado' });
    try {
      const response = await fetch(`${EVOLUTION_API_URL}/webhook/set/${instanceName}`, {
        method: 'POST',
        headers: { 'apikey': EVOLUTION_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          webhook: {
            enabled: true,
            url: `${serverUrl}/api/whatsapp/webhook`,
            byEvents: false,
            base64: true,
            events: ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'CONNECTION_UPDATE']
          }
        })
      });
      const parsed = await parseHttpResponse(response);
      res.status(response.status).json(parsed.data);
    } catch (error) {
      res.status(500).json({ error: 'Falha ao configurar webhook' });
    }
  });

  app.get('/api/whatsapp/qrcode', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const instanceName = getInstanceName(userId);

    if (isZApiEnabled()) {
      if (getMissingZApiConfig().length > 0) {
        return res.status(500).json(zapiConfigError());
      }

      try {
        const statusResponse = await fetch(zapiUrl('/status'), {
          method: 'GET',
          headers: zapiHeaders(),
        });
        const statusParsed = await parseHttpResponse(statusResponse);
        if (!statusResponse.ok) {
          return res.status(statusResponse.status).json({
            error: 'Falha ao consultar status na Z-API',
            provider: 'zapi',
            details: statusParsed.data,
          });
        }
        const state = normalizeWhatsappState(statusParsed.data);

        if (state === 'open') {
          return res.json({
            provider: 'zapi',
            state,
            connectionStatus: state,
            instance: { state },
          });
        }

        const qrResponse = await fetch(zapiUrl('/qr-code/image'), {
          method: 'GET',
          headers: zapiHeaders(),
        });
        const qrParsed = await parseHttpResponse(qrResponse);

        let candidate = extractQrCandidate(qrParsed.data, qrParsed.raw);
        if (!candidate && qrResponse.ok) {
          const fallbackResponse = await fetch(zapiUrl('/qr-code'), {
            method: 'GET',
            headers: zapiHeaders(),
          });
          const fallbackParsed = await parseHttpResponse(fallbackResponse);
          if (fallbackResponse.ok) {
            candidate = extractQrCandidate(fallbackParsed.data, fallbackParsed.raw);
          } else {
            return res.status(fallbackResponse.status).json({
              error: 'Falha ao obter QR na Z-API',
              provider: 'zapi',
              details: fallbackParsed.data,
            });
          }
        } else if (!qrResponse.ok) {
          return res.status(qrResponse.status).json({
            error: 'Falha ao obter QR na Z-API',
            provider: 'zapi',
            details: qrParsed.data,
          });
        }

        const base64 = candidate ? await ensureDataUrl(candidate) : null;
        if (!base64) {
          return res.status(502).json({
            error: 'QR Code não disponível na Z-API',
            provider: 'zapi',
            state,
            connectionStatus: state,
            instance: { state },
          });
        }

        return res.json({
          provider: 'zapi',
          state: 'close',
          connectionStatus: 'close',
          instance: { state: 'close' },
          base64,
          qrcode: { base64 },
        });
      } catch (error) {
        console.error('Erro ao buscar QR Code (Z-API):', error);
        return res.status(500).json({ error: 'Falha ao buscar QR Code (Z-API)' });
      }
    }

    // Evolution API
    try {
      const response = await fetch(`${EVOLUTION_API_URL}/instance/connect/${instanceName}`, {
        method: 'GET',
        headers: { 'apikey': EVOLUTION_API_KEY },
      });
      const parsed = await parseHttpResponse(response);
      const base64 = parsed.data?.base64 ?? qrCodeByInstance.get(instanceName) ?? '';
      if (!base64) return res.json({ count: 0 });
      return res.status(response.status).json({ base64, qrcode: { base64 }, provider: 'evolution' });
    } catch (error) {
      console.error('Erro ao buscar QR Code (Evolution API):', error);
      return res.status(500).json({ error: 'Falha ao buscar QR Code' });
    }
  });

  // Debug endpoint — mostra estado interno e chama Evolution API para diagnóstico
  app.get('/api/whatsapp/debug', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const instanceName = getInstanceName(userId);
    const cachedQr = qrCodeByInstance.get(instanceName);

    const [connRes, statusRes] = await Promise.all([
      fetch(`${EVOLUTION_API_URL}/instance/connect/${instanceName}`, {
        method: 'GET', headers: { 'apikey': EVOLUTION_API_KEY }
      }).then(r => r.json()).catch(e => ({ error: e.message })),
      fetch(`${EVOLUTION_API_URL}/instance/connectionState/${instanceName}`, {
        method: 'GET', headers: { 'apikey': EVOLUTION_API_KEY }
      }).then(r => r.json()).catch(e => ({ error: e.message })),
    ]);

    res.json({
      instanceName,
      hasCachedQr: !!cachedQr,
      connectEndpoint: connRes,
      connectionState: statusRes,
      serverUrl: process.env.SERVER_URL,
      evolutionUrl: EVOLUTION_API_URL,
    });
  });

  // Endpoint de diagnóstico
  app.get('/api/whatsapp/ping', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const instanceName = getInstanceName(userId);

    if (isZApiEnabled()) {
      if (getMissingZApiConfig().length > 0) {
        return res.status(500).json(zapiConfigError());
      }

      try {
        const start = Date.now();
        const response = await fetch(zapiUrl('/status'), {
          method: 'GET',
          headers: zapiHeaders(),
        });
        const parsed = await parseHttpResponse(response);
        const ms = Date.now() - start;
        const state = normalizeWhatsappState(parsed.data);

        return res.status(response.status).json({
          ok: response.ok,
          ms,
          provider: 'zapi',
          zapiBaseUrl: ZAPI_BASE_URL,
          instanceId: ZAPI_INSTANCE_ID,
          state,
          details: parsed.data,
        });
      } catch (error: any) {
        return res.status(500).json({ ok: false, provider: 'zapi', error: error.message, zapiBaseUrl: ZAPI_BASE_URL });
      }
    }

    try {
      const start = Date.now();
      const response = await fetch(`${EVOLUTION_API_URL}/instance/fetchInstances`, {
        method: 'GET',
        headers: { 'apikey': EVOLUTION_API_KEY }
      });
      const parsed = await parseHttpResponse(response);
      const ms = Date.now() - start;
      const instances: any[] = Array.isArray(parsed.data) ? parsed.data : [];
      const mine = instances.find((i: any) => i.instance?.instanceName === instanceName || i.instanceName === instanceName);
      res.json({
        ok: response.ok,
        ms,
        provider: 'evolution',
        evolutionApiUrl: EVOLUTION_API_URL,
        instanceName,
        instanceFound: !!mine,
        instanceState: mine?.instance?.state ?? mine?.state ?? null,
        allInstances: instances.map((i: any) => i.instance?.instanceName ?? i.instanceName)
      });
    } catch (error: any) {
      res.status(500).json({ ok: false, provider: 'evolution', error: error.message, evolutionApiUrl: EVOLUTION_API_URL });
    }
  });

  app.get('/api/whatsapp/status', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const instanceName = getInstanceName(userId);

    // Verifica Meta WhatsApp Business primeiro
    try {
      const { data: metaAccount } = await supabase
        .from('whatsapp_business_accounts')
        .select('phone_number, display_name')
        .eq('user_id', userId)
        .maybeSingle();

      if (metaAccount) {
        return res.json({
          connected: true,
          provider: 'meta',
          phone: metaAccount.phone_number,
          display_name: metaAccount.display_name,
          whatsapp: { connected: true },
        });
      }
    } catch {}

    if (isZApiEnabled()) {
      if (getMissingZApiConfig().length > 0) {
        return res.status(500).json(zapiConfigError());
      }

      try {
        const response = await fetch(zapiUrl('/status'), {
          method: 'GET',
          headers: zapiHeaders(),
        });
        const parsed = await parseHttpResponse(response);
        if (!response.ok) {
          return res.status(response.status).json({
            error: 'Falha ao consultar status na Z-API',
            provider: 'zapi',
            details: parsed.data,
          });
        }
        const state = normalizeWhatsappState(parsed.data);
        const payload = (typeof parsed.data === 'object' && parsed.data !== null) ? parsed.data : { raw: parsed.raw };

        return res.status(response.status).json({
          ...payload,
          provider: 'zapi',
          state,
          connectionStatus: state,
          instance: { state },
        });
      } catch (error) {
        console.error('Erro ao verificar status (Z-API):', error);
        return res.status(500).json({ error: 'Falha ao verificar status (Z-API)' });
      }
    }

    // Evolution API
    try {
      const response = await fetch(`${EVOLUTION_API_URL}/instance/connectionState/${instanceName}`, {
        method: 'GET',
        headers: { 'apikey': EVOLUTION_API_KEY },
      });
      const parsed = await parseHttpResponse(response);
      const state = normalizeWhatsappState(parsed.data);
      return res.status(response.status).json({ instance: { state }, state, connectionStatus: state, provider: 'evolution' });
    } catch (error) {
      console.error('Erro ao verificar status (Evolution API):', error);
      return res.status(500).json({ error: 'Falha ao verificar status' });
    }
  });

  app.post('/api/whatsapp/webhook/configure', requireAuth, async (req, res) => {
    if (!isZApiEnabled()) {
      return res.status(400).json({ error: 'Configuração automática de webhook disponível apenas para Z-API' });
    }

    if (getMissingZApiConfig().length > 0) {
      return res.status(500).json(zapiConfigError());
    }

    const appUrl = process.env.APP_URL ? process.env.APP_URL.replace(/\/$/, '') : '';
    const requestedUrl = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
    const webhookUrl = requestedUrl || (appUrl ? `${appUrl}/api/whatsapp/webhook` : '');

    if (!webhookUrl) {
      return res.status(400).json({
        error: 'Informe req.body.url ou defina APP_URL para montar a URL do webhook.',
      });
    }

    if (!/^https:\/\//i.test(webhookUrl)) {
      return res.status(400).json({
        error: 'A Z-API exige webhook HTTPS. Use URL pública (ex: tunnel ou deploy).',
        webhookUrl,
      });
    }

    try {
      const response = await fetch(zapiUrl('/update-every-webhooks'), {
        method: 'PUT',
        headers: zapiHeaders(true),
        body: JSON.stringify({
          value: webhookUrl,
          notifySentByMe: true,
        }),
      });
      const parsed = await parseHttpResponse(response);
      return res.status(response.status).json({
        provider: 'zapi',
        webhookUrl,
        result: parsed.data,
      });
    } catch (error) {
      console.error('Erro ao configurar webhook da Z-API:', error);
      return res.status(500).json({ error: 'Falha ao configurar webhook da Z-API' });
    }
  });

  app.post('/api/whatsapp/send', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const instanceName = getInstanceName(userId);
    const { number, text } = req.body;

    if (!number || !text) {
      return res.status(400).json({ error: 'Número e texto são obrigatórios' });
    }

    if (isZApiEnabled()) {
      if (getMissingZApiConfig().length > 0) {
        return res.status(500).json(zapiConfigError());
      }

      const phone = String(number).replace(/\D/g, '');
      try {
        const response = await fetch(zapiUrl('/send-text'), {
          method: 'POST',
          headers: zapiHeaders(true),
          body: JSON.stringify({
            phone,
            message: String(text),
          })
        });
        const parsed = await parseHttpResponse(response);
        return res.status(response.status).json(parsed.data);
      } catch (error) {
        console.error('Erro ao enviar mensagem (Z-API):', error);
        return res.status(500).json({ error: 'Falha ao enviar mensagem (Z-API)' });
      }
    }

    // Evolution API
    const phone = String(number).replace(/\D/g, '');
    try {
      const response = await fetch(`${EVOLUTION_API_URL}/message/sendText/${instanceName}`, {
        method: 'POST',
        headers: { 'apikey': EVOLUTION_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ number: phone, textMessage: { text: String(text) } }),
      });
      const parsed = await parseHttpResponse(response);
      return res.status(response.status).json(parsed.data);
    } catch (error) {
      console.error('Erro ao enviar mensagem (Evolution API):', error);
      return res.status(500).json({ error: 'Falha ao enviar mensagem' });
    }
  });

  app.delete('/api/whatsapp/instance', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const instanceName = getInstanceName(userId);

    if (isZApiEnabled()) {
      if (getMissingZApiConfig().length > 0) {
        return res.status(500).json(zapiConfigError());
      }

      try {
        const response = await fetch(zapiUrl('/disconnect'), {
          method: 'GET',
          headers: zapiHeaders(),
        });
        const parsed = await parseHttpResponse(response);
        return res.status(response.status).json(parsed.data);
      } catch (error) {
        console.error('Erro ao desconectar Z-API:', error);
        return res.status(500).json({ error: 'Falha ao desconectar WhatsApp (Z-API)' });
      }
    }

    // Evolution API
    try {
      const response = await fetch(`${EVOLUTION_API_URL}/instance/delete/${instanceName}`, {
        method: 'DELETE',
        headers: { 'apikey': EVOLUTION_API_KEY },
      });
      const parsed = await parseHttpResponse(response);
      return res.status(response.status).json(parsed.data);
    } catch (error) {
      console.error('Erro ao deletar instância (Evolution API):', error);
      return res.status(500).json({ error: 'Falha ao desconectar WhatsApp' });
    }
  });

  // Listar conversas do WhatsApp
  app.get('/api/whatsapp/chats', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const instanceName = getInstanceName(userId);
    const page = Number(req.query.page) > 0 ? Number(req.query.page) : 1;
    const pageSize = Number(req.query.pageSize) > 0 ? Number(req.query.pageSize) : 100;

    if (isZApiEnabled()) {
      if (getMissingZApiConfig().length > 0) {
        return res.status(500).json(zapiConfigError());
      }

      try {
        const response = await fetch(zapiUrl(`/chats?page=${page}&pageSize=${pageSize}`), {
          method: 'GET',
          headers: zapiHeaders(),
        });
        const parsed = await parseHttpResponse(response);
        return res.status(response.status).json(parsed.data);
      } catch (error) {
        console.error('Erro ao buscar conversas (Z-API):', error);
        return res.status(500).json({ error: 'Falha ao buscar conversas (Z-API)' });
      }
    }

    // Evolution API
    try {
      const response = await fetch(`${EVOLUTION_API_URL}/chat/findChats/${instanceName}`, {
        method: 'GET',
        headers: { 'apikey': EVOLUTION_API_KEY },
      });
      const parsed = await parseHttpResponse(response);
      return res.status(response.status).json(parsed.data);
    } catch (error) {
      console.error('Erro ao buscar conversas (Evolution API):', error);
      return res.status(500).json({ error: 'Falha ao buscar conversas' });
    }
  });

  // Mensagens de um contato específico
  app.get('/api/whatsapp/messages/:jid', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const instanceName = getInstanceName(userId);
    const { jid } = req.params;
    const limit = parseInt(req.query.limit as string) || 50;

    if (isZApiEnabled()) {
      if (getMissingZApiConfig().length > 0) {
        return res.status(500).json(zapiConfigError());
      }

      try {
        const normalizedJid = normalizePhone(jid);
        if (!normalizedJid) {
          return res.status(400).json({ error: 'jid inválido para consulta de mensagens' });
        }

        const response = await fetch(zapiUrl(`/chats/${normalizedJid}`), {
          method: 'GET',
          headers: zapiHeaders(),
        });
        const parsed = await parseHttpResponse(response);
        const liveMessages = getLiveMessagesByPhone(normalizedJid, limit);

        if (!response.ok && liveMessages.length === 0) {
          return res.status(response.status).json({
            error: 'Falha ao buscar metadata do chat na Z-API',
            provider: 'zapi',
            details: parsed.data,
          });
        }

        const statusCode = response.ok ? response.status : 200;

        return res.status(statusCode).json({
          provider: 'zapi',
          chat: response.ok ? parsed.data : null,
          chatError: response.ok ? null : parsed.data,
          messages: liveMessages,
          limit,
          note: liveMessages.length > 0
            ? 'Mensagens em tempo real recebidas via webhook.'
            : 'A Z-API não expõe histórico completo; configure webhook para receber mensagens no app.',
        });
      } catch (error) {
        console.error('Erro ao buscar mensagens (Z-API):', error);
        return res.status(500).json({ error: 'Falha ao buscar mensagens (Z-API)' });
      }
    }

    // Evolution API — retorna mensagens do cache em memória (recebidas via webhook)
    const phone = normalizePhone(jid);
    const messages = getLiveMessagesByPhone(phone, limit);
    return res.json({ messages, provider: 'evolution' });
  });

  // Webhook para mensagens recebidas (Evolution API / Z-API / Meta Cloud API)
  // Captura sub-rotas da Evolution API quando byEvents: true (ex: /webhook/connection-update)
  app.post('/api/whatsapp/webhook/:event', async (req, res) => {
    res.sendStatus(200); // sempre responde 200 para o provider não ficar retonando
    const event = req.params.event;
    if (event === 'connection-update') return; // só log silencioso
    console.log(`[WA Webhook] Evento via sub-rota: ${event}`, JSON.stringify(req.body).slice(0, 200));
  });

  app.post('/api/whatsapp/webhook', async (req, res) => {
    res.sendStatus(200); // always respond fast to avoid timeout

    try {
      const payload = req.body;

      // ── Meta WhatsApp Cloud API ──────────────────────────────────────────────
      if (payload?.object === 'whatsapp_business_account') {
        if (!supabaseAdmin) { console.error('[Webhook Meta] supabaseAdmin not initialized'); return; }

        const entry = payload.entry?.[0];
        const value = entry?.changes?.[0]?.value;
        if (!value?.messages?.length) return;

        const message = value.messages[0];
        if (message.type !== 'text') return;

        const phoneNumberId = value.metadata?.phone_number_id;
        const fromNumber = message.from;
        const msgBody = message.text?.body || '';
        const msgId = message.id;

        console.log(`[Webhook Meta] Mensagem de ${fromNumber} para phone_number_id ${phoneNumberId}: "${msgBody}"`);

        const { data: waAccount, error: waErr } = await supabaseAdmin
          .from('whatsapp_business_accounts')
          .select('user_id')
          .eq('phone_number_id', phoneNumberId)
          .maybeSingle();

        if (waErr) { console.error('[Webhook Meta] Erro ao buscar conta:', waErr.message); return; }
        if (!waAccount) { console.error('[Webhook Meta] Nenhuma conta para phone_number_id:', phoneNumberId); return; }

        const cleanFrom = normalizeBrazilianPhone(fromNumber.replace(/\D/g, ''));
        const now = new Date().toISOString();

        const { error: msgErr } = await supabaseAdmin.from('wa_messages').insert({
          user_id: waAccount.user_id,
          phone: cleanFrom,
          message_id: msgId || `meta-in-${Date.now()}`,
          body: msgBody,
          from_me: false,
          timestamp: now,
          type: 'text',
          status: 'received',
        });
        if (msgErr) console.error('[Webhook Meta] Erro ao salvar mensagem:', msgErr.message);

        const { error: convErr } = await supabaseAdmin.from('wa_conversations').upsert({
          user_id: waAccount.user_id,
          phone: cleanFrom,
          last_message: msgBody,
          last_message_at: now,
          unread_count: 1,
        }, { onConflict: 'user_id,phone' });

        if (convErr) console.error('[Webhook Meta] Erro ao atualizar conversa:', convErr.message);
        else console.log(`[Webhook Meta] ✅ Mensagem salva — user ${waAccount.user_id}, phone ${cleanFrom}`);
        return;
      }

      // ── Evolution API / Z-API ────────────────────────────────────────────────
      const instanceName = payload?.instance ?? payload?.instanceName ?? '';
      const eventType = payload?.event ?? payload?.type ?? '';
      if (eventType === 'qrcode.updated' || eventType === 'QRCODE_UPDATED') {
        const qrBase64 = payload?.data?.qrcode?.base64 ?? payload?.qrcode?.base64 ?? payload?.data?.base64 ?? '';
        if (qrBase64 && instanceName) {
          qrCodeByInstance.set(instanceName, qrBase64);
          console.log(`[WA] QR recebido via webhook para instância: ${instanceName}`);
        }
        return;
      }

      const rawEvents = Array.isArray(payload) ? payload : [payload];
      const events = rawEvents.flatMap((item: any) => {
        if (!item || typeof item !== 'object') return [item];
        if (Array.isArray(item.messages)) return item.messages;
        if (Array.isArray(item.data)) return item.data;
        if (item.data && typeof item.data === 'object') return [item.data];
        return [item];
      });

      let processed = 0;
      for (const event of events) {
        const rawPhone = String(
          event?.phone ?? event?.chatId ?? event?.chatLid ??
          event?.senderPhone ?? event?.participantPhone ?? ''
        );

        const isGroup =
          rawPhone.includes('@g.us') ||
          /^\d+[-]\d+/.test(rawPhone) ||
          Boolean(event?.isGroup) ||
          String(event?.chatId ?? '').includes('@g.us');
        if (isGroup) continue;

        const phone = normalizePhone(rawPhone);
        const text = extractWebhookText(event);
        if (!phone || !text) continue;

        const name = String(
          event?.senderName ?? event?.pushName ?? event?.chatName ??
          event?.contact?.name ?? event?.name ?? ''
        ).trim() || undefined;

        const timestamp = parseWebhookTimestamp(event);
        const messageIdRaw = event?.messageId ?? event?.id ?? event?.messageID;
        const messageId =
          (typeof messageIdRaw === 'string' && messageIdRaw.trim())
            ? messageIdRaw.trim()
            : `${phone}-${timestamp}-${processed}`;

        cacheLiveWhatsAppMessage({
          id: messageId,
          phone,
          name,
          text,
          fromMe: Boolean(event?.fromMe),
          timestamp,
          source: 'webhook',
        });
        processed += 1;
      }

      if (processed > 0) {
        console.log(`[Webhook WA] Mensagens processadas: ${processed}`);
      }
    } catch (error) {
      console.error('Erro no webhook:', error);
    }
  });

  // Retorna todos os contatos que enviaram mensagens via webhook (cache em memória)
  app.get('/api/whatsapp/live-contacts', requireAuth, async (_req, res) => {
    const contacts = [...liveWhatsAppMessagesByPhone.entries()].map(([phone, messages]) => {
      const latest = messages[messages.length - 1];
      const readUntil = readUpToTimestampByPhone.get(phone) ?? 0;
      const unread = messages.filter((m) => !m.fromMe && m.timestamp > readUntil).length;
      const name = messages.map((m) => m.name).find((n) => n) || undefined;
      return {
        phone,
        name,
        lastMessage: latest?.text || '',
        lastMessageTime: latest?.timestamp || 0,
        fromMe: latest?.fromMe || false,
        unreadCount: unread,
      };
    });
    return res.json(contacts);
  });

  // ============ INBOX ENDPOINTS ============

  // Lista conversas do Supabase (persistido) + merge com cache em memória
  app.get('/api/inbox/conversations', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    try {
      const { data, error } = await supabase
        .from('wa_conversations')
        .select('*')
        .eq('user_id', userId)
        .order('last_message_at', { ascending: false })
        .limit(200);

      if (error) throw error;

      // Merge com cache em memória (conversas novas ainda não persistidas)
      const dbPhones = new Set((data || []).map((c: any) => c.phone));
      const memContacts = [...liveWhatsAppMessagesByPhone.entries()]
        .filter(([phone]) => !dbPhones.has(phone))
        .map(([phone, messages]) => {
          const latest = messages[messages.length - 1];
          return {
            phone,
            contact_name: null,
            last_message: latest?.text || '',
            last_message_at: latest ? new Date(latest.timestamp).toISOString() : new Date().toISOString(),
            unread_count: 0,
            from_memory: true,
          };
        });

      return res.json([...(data || []), ...memContacts]);
    } catch (err) {
      // Fallback: cache em memória
      const contacts = [...liveWhatsAppMessagesByPhone.entries()].map(([phone, messages]) => {
        const latest = messages[messages.length - 1];
        return {
          phone,
          contact_name: null,
          last_message: latest?.text || '',
          last_message_at: latest ? new Date(latest.timestamp).toISOString() : new Date().toISOString(),
          unread_count: 0,
        };
      });
      return res.json(contacts);
    }
  });

  // Mensagens de uma conversa
  app.get('/api/inbox/messages/:phone', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const phone = normalizeBrazilianPhone(req.params.phone.replace(/\D/g, '')); // normaliza + trata 9 BR
    const limit = Number(req.query.limit) || 60;
    try {
      const { data, error } = await supabase
        .from('wa_messages')
        .select('*')
        .eq('user_id', userId)
        .eq('phone', phone)
        .order('timestamp', { ascending: true })
        .limit(limit);

      if (error) throw error;

      // Merge com cache em memória
      const dbIds = new Set((data || []).map((m: any) => m.message_id));
      const memMessages = getLiveMessagesByPhone(phone, limit)
        .filter((m) => !dbIds.has(m.id))
        .map((m) => ({
          message_id: m.id,
          body: m.text,
          from_me: m.fromMe,
          timestamp: new Date(m.timestamp).toISOString(),
          type: 'text',
          status: 'received',
        }));

      const all = [...(data || []), ...memMessages].sort(
        (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      );
      return res.json(all);
    } catch {
      const msgs = getLiveMessagesByPhone(phone, limit).map((m) => ({
        message_id: m.id,
        body: m.text,
        from_me: m.fromMe,
        timestamp: new Date(m.timestamp).toISOString(),
        type: 'text',
        status: 'received',
      }));
      return res.json(msgs);
    }
  });

  // Marcar conversa como lida (zera unread no Supabase)
  app.post('/api/inbox/mark-read/:phone', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const phone = req.params.phone.replace(/\D/g, '');
    readUpToTimestampByPhone.set(phone, Date.now());
    try {
      const supabase = createSupabaseClient();
      await supabase
        .from('wa_conversations')
        .update({ unread_count: 0, updated_at: new Date().toISOString() })
        .eq('user_id', userId)
        .eq('phone', phone);
    } catch {}
    return res.json({ ok: true });
  });

  // Envia mensagem via Meta WhatsApp Business API
  app.post('/api/inbox/send', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { phone, text } = req.body;

    if (!phone || !text) return res.status(400).json({ error: 'phone e text são obrigatórios' });

    const { data: waAccount } = await supabase
      .from('whatsapp_business_accounts')
      .select('phone_number_id, phone_number, access_token')
      .eq('user_id', userId)
      .maybeSingle();

    if (!waAccount) return res.status(400).json({ error: 'WhatsApp Business não conectado. Vá em Configurações para conectar.' });

    const cleanPhone = normalizeBrazilianPhone(phone.replace(/\D/g, ''));

    try {
      const metaRes = await fetch(
        `https://graph.facebook.com/v21.0/${waAccount.phone_number_id}/messages`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${waAccount.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: cleanPhone,
            type: 'text',
            text: { body: text },
          }),
        }
      );
      const metaData = await metaRes.json();
      if (metaData.error) return res.status(400).json({ error: metaData.error.message });

      const msgId = metaData.messages?.[0]?.id || `meta-${Date.now()}`;
      const now = new Date().toISOString();

      await supabase.from('wa_messages').insert({
        user_id: userId,
        phone: cleanPhone,
        message_id: msgId,
        body: text,
        from_me: true,
        timestamp: now,
        type: 'text',
        status: 'sent',
      });

      await supabase.from('wa_conversations').upsert({
        user_id: userId,
        phone: cleanPhone,
        last_message: text,
        last_message_at: now,
      }, { onConflict: 'user_id,phone' });

      res.json({ success: true, message_id: msgId });
    } catch (err: any) {
      console.error('[inbox/send] error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // Sincroniza histórico de conversas recentes da Evolution API para o cache em memória
  app.post('/api/whatsapp/sync-history', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const instanceName = getInstanceName(userId);
    const limit = Number(req.query.limit) || 30; // últimas 30 conversas

    const total = liveWhatsAppMessagesByPhone.size;
    res.json({ synced: total, total, note: 'Mensagens recebidas via webhook da Evolution API / Z-API' });
  });

  // Marca mensagens de um contato como lidas
  app.post('/api/whatsapp/mark-read/:phone', requireAuth, (req, res) => {
    const phone = req.params.phone;
    const messages = liveWhatsAppMessagesByPhone.get(phone);
    if (messages && messages.length > 0) {
      const latest = messages[messages.length - 1];
      readUpToTimestampByPhone.set(phone, latest.timestamp);
    } else {
      readUpToTimestampByPhone.set(phone, Date.now());
    }
    res.json({ ok: true });
  });

  // ============ INSTAGRAM / EVOLUTION API ROUTES ============
  app.post('/api/instagram/instance', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const instanceName = `ig_${userId.replace(/-/g, '_')}`;
    try {
      const response = await fetch(`${EVOLUTION_API_URL}/instance/create`, {
        method: 'POST',
        headers: { 'apikey': EVOLUTION_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ instanceName, qrcode: true, integration: 'INSTAGRAM' })
      });
      const data = await response.json();
      res.json(data);
    } catch (error) {
      console.error('Erro ao criar instância Instagram:', error);
      res.status(500).json({ error: 'Falha ao criar instância Instagram' });
    }
  });

  app.get('/api/instagram/status', requireAuth, async (req, res) => {
    // Instagram via Evolution API está desativado — retorna desconectado sem chamar serviço externo
    res.json({ instance: { state: 'close' }, state: 'close' });
  });

  app.delete('/api/instagram/instance', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const instanceName = `ig_${userId.replace(/-/g, '_')}`;
    try {
      const response = await fetch(`${EVOLUTION_API_URL}/instance/delete/${instanceName}`, {
        method: 'DELETE',
        headers: { 'apikey': EVOLUTION_API_KEY }
      });
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        return res.json({ ok: true });
      }
      const data = await response.json();
      res.json(data);
    } catch (error) {
      console.error('Erro ao desconectar Instagram:', error);
      res.status(500).json({ error: 'Falha ao desconectar Instagram' });
    }
  });

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
      client_name: (j.clients as any)?.name || null,
      // Default unassigned jobs to the first production stage
      production_stage: j.production_stage || 'prod-emp-1',
    }));

    res.json(jobsFormatted);
  });

  app.post('/api/jobs', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { client_id, job_type, job_date, job_time, job_end_time, job_name, amount, payment_method, payment_status, status, notes } = req.body;

    // Sanitize amount — empty string from form becomes 0
    const amountNum = (amount === '' || amount == null) ? 0 : Number(amount);

    const baseJobPayload: any = {
      client_id: client_id || null,
      job_type,
      job_date,
      job_time: job_time || null,
      job_end_time: job_end_time || null,
      job_name,
      amount: amountNum,
      payment_method,
      payment_status,
      status: status || 'scheduled',
      notes,
      user_id: userId,
    };

    // Try inserting with production columns (requires migration)
    let { data, error } = await supabase.from('jobs').insert({
      ...baseJobPayload,
      production_stage: 'prod-emp-1',
      production_stage_entered_at: new Date().toISOString(),
    }).select().single();

    // Fallback: if production columns don't exist yet, insert without them
    if (error && (error.code === '42703' || error.message?.includes('column') || error.message?.includes('production_stage'))) {
      console.warn('[POST /api/jobs] Production columns missing, inserting without them. Run SQL migration!');
      const fallback = await supabase.from('jobs').insert(baseJobPayload).select().single();
      data = fallback.data;
      error = fallback.error;
    }

    if (error) {
      console.error('[POST /api/jobs] Supabase error:', error.message);
      return res.status(500).json({ error: error.message });
    }

    if (client_id) {
      await generateOpportunities(supabase, client_id, job_type, job_date, userId, data.id);
    }
    syncJobToGoogleCalendar(supabase, data.id, userId);

    res.json({ id: data.id });
  });

  app.put('/api/jobs/:id', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { client_id, job_type, job_date, job_time, job_end_time, job_name, amount, payment_method, payment_status, status, notes, production_stage } = req.body;

    const { data: oldJob } = await supabase
      .from('jobs')
      .select('*')
      .eq('id', req.params.id)
      .eq('user_id', userId)
      .single();

    if (!oldJob) return res.status(404).json({ error: 'Job not found' });

    // Only include fields that were explicitly sent — avoids wiping fields on partial updates (e.g. moving stages)
    const updatePayload: any = {};
    if (client_id !== undefined) updatePayload.client_id = client_id || null;
    if (job_type !== undefined) updatePayload.job_type = job_type;
    if (job_date !== undefined) updatePayload.job_date = job_date;
    if (job_time !== undefined) updatePayload.job_time = job_time || null;
    if (job_end_time !== undefined) updatePayload.job_end_time = job_end_time || null;
    if (job_name !== undefined) updatePayload.job_name = job_name;
    if (amount !== undefined) updatePayload.amount = amount;
    if (payment_method !== undefined) updatePayload.payment_method = payment_method;
    if (payment_status !== undefined) updatePayload.payment_status = payment_status;
    if (status !== undefined) updatePayload.status = status || oldJob.status;
    if (notes !== undefined) updatePayload.notes = notes;
    if (production_stage !== undefined) {
      updatePayload.production_stage = production_stage;
      if (production_stage !== oldJob.production_stage) {
        updatePayload.production_stage_entered_at = new Date().toISOString();
      }
    }

    await supabase.from('jobs').update(updatePayload).eq('id', req.params.id).eq('user_id', userId);

    // Track stage history when production_stage changes
    if (production_stage !== undefined && production_stage !== oldJob.production_stage) {
      try {
        // Close previous stage entry
        if (oldJob.production_stage) {
          await supabase
            .from('job_stage_history')
            .update({ exited_at: new Date().toISOString() })
            .eq('job_id', Number(req.params.id))
            .eq('stage_id', oldJob.production_stage)
            .is('exited_at', null)
            .eq('user_id', userId);
        }
        // Open new stage entry
        await supabase.from('job_stage_history').insert({
          job_id: Number(req.params.id),
          user_id: userId,
          stage_id: production_stage,
          entered_at: new Date().toISOString(),
        });
      } catch (_) {}
    }

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

  // ============ JOB DETAIL / CHECKLIST / TESTIMONIALS / STAGE HISTORY ============

  app.get('/api/jobs/:id/checklist', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { data, error } = await supabase
      .from('job_checklist')
      .select('*')
      .eq('job_id', req.params.id)
      .eq('user_id', userId)
      .order('created_at');
    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
  });

  app.post('/api/jobs/:id/checklist', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'text required' });
    const { data, error } = await supabase
      .from('job_checklist')
      .insert({ job_id: Number(req.params.id), user_id: userId, text, done: false })
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  });

  app.put('/api/jobs/checklist/:itemId', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { done } = req.body;
    const { error } = await supabase
      .from('job_checklist')
      .update({ done })
      .eq('id', req.params.itemId)
      .eq('user_id', userId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  });

  app.delete('/api/jobs/checklist/:itemId', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { error } = await supabase
      .from('job_checklist')
      .delete()
      .eq('id', req.params.itemId)
      .eq('user_id', userId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  });

  app.get('/api/jobs/:id/testimonials', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { data, error } = await supabase
      .from('job_testimonials')
      .select('*')
      .eq('job_id', req.params.id)
      .eq('user_id', userId)
      .order('created_at');
    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
  });

  app.post('/api/jobs/:id/testimonials', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { photo_data, caption } = req.body;
    if (!photo_data) return res.status(400).json({ error: 'photo_data required' });
    const { data, error } = await supabase
      .from('job_testimonials')
      .insert({ job_id: Number(req.params.id), user_id: userId, photo_data, caption: caption || null })
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  });

  app.delete('/api/jobs/testimonials/:id', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { error } = await supabase
      .from('job_testimonials')
      .delete()
      .eq('id', req.params.id)
      .eq('user_id', userId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  });

  app.get('/api/jobs/:id/stage-history', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { data, error } = await supabase
      .from('job_stage_history')
      .select('*')
      .eq('job_id', req.params.id)
      .eq('user_id', userId)
      .order('entered_at');
    if (error) {
      // Table may not exist yet — return empty gracefully
      return res.json([]);
    }
    const rows = (data || []) as any[];
    // Compute exited_at from sequence if the UPDATE-based approach failed (e.g. RLS)
    const processed = rows.map((row, idx) => {
      const next = rows[idx + 1];
      return {
        ...row,
        exited_at: row.exited_at ?? (next ? next.entered_at : null),
      };
    });
    res.json(processed);
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

  // ============ CATÁLOGO: FORNECEDORES ============

  app.get('/api/fornecedores', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { data, error } = await supabase.from('fornecedores').select('*').eq('user_id', userId).order('nome');
    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
  });

  app.post('/api/fornecedores', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { data, error } = await supabase.from('fornecedores').insert({ ...req.body, user_id: userId }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  });

  app.put('/api/fornecedores/:id', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { data, error } = await supabase.from('fornecedores').update({ ...req.body, updated_at: new Date().toISOString() }).eq('id', req.params.id).eq('user_id', userId).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  });

  app.delete('/api/fornecedores/:id', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { error } = await supabase.from('fornecedores').delete().eq('id', req.params.id).eq('user_id', userId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  });

  // ============ CATÁLOGO: PRODUTOS ============

  app.get('/api/produtos', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { data, error } = await supabase
      .from('produtos')
      .select('*, fornecedores(nome)')
      .eq('user_id', userId)
      .order('nome');
    if (error) return res.status(500).json({ error: error.message });
    const mapped = (data || []).map((p: any) => ({
      ...p,
      fornecedor_nome: p.fornecedores?.nome || null,
      fornecedores: undefined,
    }));
    res.json(mapped);
  });

  app.post('/api/produtos', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    // Strip computed / read-only fields that don't exist as table columns
    const { id: _id, user_id: _uid, fornecedor_nome: _fn, created_at: _ca, updated_at: _ua, margem_lucro: _ml, ...body } = req.body;
    const margem = body.preco_venda > 0
      ? ((body.preco_venda - body.preco_custo) / body.preco_venda * 100)
      : 0;
    const { data, error } = await supabase.from('produtos').insert({
      ...body, user_id: userId, margem_lucro: Math.round(margem * 100) / 100
    }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  });

  app.put('/api/produtos/:id', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    // Strip computed / read-only fields that don't exist as table columns
    const { id: _id, user_id: _uid, fornecedor_nome: _fn, created_at: _ca, updated_at: _ua, margem_lucro: _ml, ...body } = req.body;
    const margem = body.preco_venda > 0
      ? ((body.preco_venda - body.preco_custo) / body.preco_venda * 100)
      : 0;
    const { data, error } = await supabase.from('produtos').update({
      ...body, margem_lucro: Math.round(margem * 100) / 100, updated_at: new Date().toISOString()
    }).eq('id', req.params.id).eq('user_id', userId).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  });

  app.delete('/api/produtos/:id', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { error } = await supabase.from('produtos').delete().eq('id', req.params.id).eq('user_id', userId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  });

  // ============ CATÁLOGO: SERVIÇOS ============

  app.get('/api/servicos', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { data, error } = await supabase.from('servicos').select('*').eq('user_id', userId).order('nome');
    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
  });

  app.post('/api/servicos', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { data, error } = await supabase.from('servicos').insert({ ...req.body, user_id: userId }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  });

  app.put('/api/servicos/:id', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { data, error } = await supabase.from('servicos').update({ ...req.body, updated_at: new Date().toISOString() }).eq('id', req.params.id).eq('user_id', userId).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  });

  app.delete('/api/servicos/:id', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { error } = await supabase.from('servicos').delete().eq('id', req.params.id).eq('user_id', userId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  });

  // ============ CATÁLOGO: COMBOS ============

  app.get('/api/combos', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    // combo_items não tem user_id — usa admin para bypassar RLS
    const itemsClient = supabaseAdmin || supabase;
    const { data: combos, error } = await supabase.from('combos').select('*').eq('user_id', userId).order('nome');
    if (error) return res.status(500).json({ error: error.message });
    if (!combos?.length) return res.json([]);
    const { data: itens, error: itensError } = await itemsClient.from('combo_items').select('*').in('combo_id', combos.map((c: any) => c.id));
    if (itensError) console.error('[combos GET] combo_items error:', itensError.message);
    const result = combos.map((c: any) => ({ ...c, itens: (itens || []).filter((i: any) => i.combo_id === c.id) }));
    res.json(result);
  });

  app.post('/api/combos', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const itemsClient = supabaseAdmin || supabase;
    const { itens, ...comboBody } = req.body;
    const { data: combo, error } = await supabase.from('combos').insert({ ...comboBody, user_id: userId }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    if (itens?.length) {
      const { error: itensError } = await itemsClient.from('combo_items').insert(
        itens.map(({ id: _id, combo_id: _c, ...rest }: any) => ({ ...rest, combo_id: combo.id }))
      );
      if (itensError) return res.status(500).json({ error: itensError.message });
    }
    res.json({ ...combo, itens: itens || [] });
  });

  app.put('/api/combos/:id', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const itemsClient = supabaseAdmin || supabase;
    const { itens, ...comboBody } = req.body;
    const { data: combo, error } = await supabase.from('combos').update({ ...comboBody, updated_at: new Date().toISOString() }).eq('id', req.params.id).eq('user_id', userId).select().single();
    if (error) return res.status(500).json({ error: error.message });
    // Reinsere itens usando admin (bypassa RLS em combo_items)
    await itemsClient.from('combo_items').delete().eq('combo_id', req.params.id);
    if (itens?.length) {
      const { error: itensError } = await itemsClient.from('combo_items').insert(
        itens.map(({ id: _id, combo_id: _c, ...rest }: any) => ({ ...rest, combo_id: combo.id }))
      );
      if (itensError) return res.status(500).json({ error: itensError.message });
    }
    res.json({ ...combo, itens: itens || [] });
  });

  app.delete('/api/combos/:id', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { error } = await supabase.from('combos').delete().eq('id', req.params.id).eq('user_id', userId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  });

  // ============ CATÁLOGO: CATEGORIAS PRODUTO ============

  app.get('/api/categorias-produto', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { data, error } = await supabase.from('categorias_produto').select('*').eq('user_id', userId).order('nome');
    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
  });

  app.post('/api/categorias-produto', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { data, error } = await supabase.from('categorias_produto').insert({ ...req.body, user_id: userId }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  });

  app.put('/api/categorias-produto/:id', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { data, error } = await supabase.from('categorias_produto').update(req.body).eq('id', req.params.id).eq('user_id', userId).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  });

  app.delete('/api/categorias-produto/:id', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { error } = await supabase.from('categorias_produto').delete().eq('id', req.params.id).eq('user_id', userId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  });

  // ============ CATÁLOGO: TIPOS DE ENSAIO ============

  app.get('/api/tipos-ensaio', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { data, error } = await supabase.from('tipos_ensaio').select('*').eq('user_id', userId).order('nome');
    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
  });

  app.post('/api/tipos-ensaio', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { data, error } = await supabase.from('tipos_ensaio').insert({ ...req.body, user_id: userId }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  });

  app.put('/api/tipos-ensaio/:id', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { data, error } = await supabase.from('tipos_ensaio').update(req.body).eq('id', req.params.id).eq('user_id', userId).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  });

  app.delete('/api/tipos-ensaio/:id', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { error } = await supabase.from('tipos_ensaio').delete().eq('id', req.params.id).eq('user_id', userId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  });

  // ============ CNPJ LOOKUP (com fallback entre múltiplas APIs) ============

  app.get('/api/cnpj/:cnpj', requireAuth, async (req, res) => {
    const cnpj = req.params.cnpj.replace(/\D/g, '');
    if (cnpj.length !== 14) return res.status(400).json({ error: 'CNPJ inválido' });

    // Normaliza resposta de qualquer API para o formato BrasilAPI
    const normalize = (data: any, source: string): any => {
      if (source === 'brasilapi') return data;
      if (source === 'receitaws') {
        return {
          razao_social: data.nome,
          nome_fantasia: data.fantasia,
          email: data.email,
          ddd_telefone_1: data.telefone,
          logradouro: data.logradouro,
          numero: data.numero,
          complemento: data.complemento,
          bairro: data.bairro,
          municipio: data.municipio,
          uf: data.uf,
          cep: data.cep,
          descricao_situacao_cadastral: data.situacao,
        };
      }
      if (source === 'cnpjws') {
        const est = data.estabelecimento || {};
        return {
          razao_social: data.razao_social,
          nome_fantasia: est.nome_fantasia || data.razao_social,
          email: est.email,
          ddd_telefone_1: est.ddd1 && est.telefone1 ? `${est.ddd1} ${est.telefone1}` : undefined,
          logradouro: est.logradouro,
          numero: est.numero,
          complemento: est.complemento,
          bairro: est.bairro,
          municipio: est.cidade?.nome,
          uf: est.estado?.sigla,
          cep: est.cep,
          descricao_situacao_cadastral: est.situacao_cadastral,
        };
      }
      return data;
    };

    const apis = [
      { url: `https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, source: 'brasilapi' },
      { url: `https://publica.cnpj.ws/cnpj/${cnpj}`, source: 'cnpjws' },
      { url: `https://www.receitaws.com.br/v1/cnpj/${cnpj}`, source: 'receitaws' },
    ];

    for (const api of apis) {
      try {
        const resp = await fetch(api.url, { signal: AbortSignal.timeout(6000) });
        if (!resp.ok) continue;
        const data = await resp.json();
        if (data.status === 'ERROR' || data.message) continue; // receitaws retorna status ERROR
        return res.json(normalize(data, api.source));
      } catch {
        // tenta próxima API
      }
    }

    res.status(404).json({ error: 'CNPJ não encontrado. Verifique o número e tente novamente.' });
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
    const id = `${createStageId(name)}-${Math.random().toString(36).slice(2, 7)}`;

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

  // ============ PRODUCTION STAGES ROUTES ============
  app.get('/api/production/stages', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const stages = await ensureProductionStages(supabase, userId);
    res.json(stages);
  });

  app.post('/api/production/stages', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Nome da etapa é obrigatório' });

    const stages = await ensureProductionStages(supabase, userId);
    const nonFinal = stages.filter((s) => !s.is_final);
    const position = nonFinal.length;
    const id = `prod-${createStageId(name)}-${Math.random().toString(36).slice(2, 7)}`;

    const payload: any = { id, name, color: '#94a3b8', position, is_final: false, is_won: false, user_id: userId };
    const { error, data } = await supabase.from('deal_stages').insert(payload).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  });

  app.put('/api/production/stages/reorder', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { stageIds } = req.body as { stageIds: string[] };
    if (!Array.isArray(stageIds)) return res.status(400).json({ error: 'stageIds deve ser array' });

    const stages = await ensureProductionStages(supabase, userId);
    const finals = stages.filter((s) => s.is_final);

    await Promise.all(stageIds.map((id: string, index: number) =>
      supabase.from('deal_stages').update({ position: index }).eq('id', id).eq('user_id', userId)
    ));
    await Promise.all(finals.map((stage, idx) =>
      supabase.from('deal_stages').update({ position: stageIds.length + idx }).eq('id', stage.id).eq('user_id', userId)
    ));

    res.json({ success: true });
  });

  app.put('/api/production/stages/:id', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { id } = req.params;
    const { name } = req.body;

    const stages = await ensureProductionStages(supabase, userId);
    const stage = stages.find((s) => s.id === id);
    if (!stage) return res.status(404).json({ error: 'Etapa não encontrada' });
    if (stage.is_final) return res.status(400).json({ error: 'Não é possível renomear etapa final' });

    const { error } = await supabase.from('deal_stages').update({ name }).eq('id', id).eq('user_id', userId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  });

  app.delete('/api/production/stages/:id', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { id } = req.params;

    const stages = await ensureProductionStages(supabase, userId);
    const stage = stages.find((s) => s.id === id);
    if (!stage) return res.status(404).json({ error: 'Etapa não encontrada' });
    if (stage.is_final) return res.status(400).json({ error: 'Etapas finais não podem ser removidas' });

    const nonFinal = stages.filter((s) => !s.is_final);
    if (nonFinal.length <= 1) return res.status(400).json({ error: 'É necessário ter pelo menos 1 etapa' });

    const fallbackId = nonFinal.find((s) => s.id !== id)?.id || DEFAULT_PRODUCTION_STAGES[0].id;
    await supabase.from('jobs').update({ production_stage: fallbackId }).eq('production_stage', id).eq('user_id', userId);
    await supabase.from('deal_stages').delete().eq('id', id).eq('user_id', userId);
    res.json({ success: true });
  });

  // ============ PRODUCTION PROCESSES ROUTES (V2) ============
  app.get('/api/production/processes', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const processes = await ensureProductionProcesses(supabase, userId);
    res.json(processes);
  });

  app.put('/api/production/processes/reorder', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { processIds } = req.body as { processIds: string[] };
    if (!Array.isArray(processIds)) return res.status(400).json({ error: 'processIds deve ser array' });
    await Promise.all(processIds.map((pid: string, i: number) =>
      supabase.from('production_processes').update({ position: i }).eq('id', pid).eq('user_id', userId)
    ));
    res.json({ success: true });
  });

  app.put('/api/production/processes/:id', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { name, is_special } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Nome obrigatório' });
    const updatePayload: any = { name: name.trim() };
    if (is_special !== undefined) updatePayload.is_special = is_special;
    const { error } = await supabase
      .from('production_processes')
      .update(updatePayload)
      .eq('id', req.params.id)
      .eq('user_id', userId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  });

  // Update process color
  app.patch('/api/production/processes/:id/color', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { color } = req.body;
    if (!color) return res.status(400).json({ error: 'Cor obrigatória' });
    const { error } = await supabase
      .from('production_processes')
      .update({ color })
      .eq('id', req.params.id)
      .eq('user_id', userId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  });

  // Toggle special flag without requiring name
  app.patch('/api/production/processes/:id/special', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { is_special } = req.body;
    const { error } = await supabase
      .from('production_processes')
      .update({ is_special: !!is_special })
      .eq('id', req.params.id)
      .eq('user_id', userId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  });

  app.post('/api/production/processes', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Nome obrigatório' });
    const { data: existing } = await supabase.from('production_processes').select('position').eq('user_id', userId).order('position', { ascending: false }).limit(1);
    const position = (existing?.[0]?.position ?? -1) + 1;
    const id = `proc-${createStageId(name)}-${Math.random().toString(36).slice(2, 6)}`;
    const color = ['#6366f1','#ec4899','#f59e0b','#10b981','#0ea5e9','#8b5cf6'][position % 6];
    const { data, error } = await supabase.from('production_processes').insert({ id, name: name.trim(), position, color, user_id: userId }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  });

  app.delete('/api/production/processes/:id', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { id } = req.params;
    const { data: allProcesses } = await supabase.from('production_processes').select('id').eq('user_id', userId);
    if (!allProcesses || allProcesses.length <= 1) return res.status(400).json({ error: 'É necessário ter pelo menos 1 processo' });
    // Move jobs deste processo para sem etapa
    await supabase.from('deal_stages').select('id').eq('process_id', id).eq('user_id', userId).then(async ({ data: stageRows }) => {
      if (stageRows?.length) {
        const ids = stageRows.map((s: any) => s.id);
        await supabase.from('jobs').update({ production_stage: null }).in('production_stage', ids).eq('user_id', userId);
      }
    });
    await supabase.from('deal_stages').delete().eq('process_id', id).eq('user_id', userId);
    await supabase.from('production_processes').delete().eq('id', id).eq('user_id', userId);
    res.json({ success: true });
  });



  app.post('/api/production/stages-v2', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { name, process_id } = req.body;
    if (!name?.trim() || !process_id) return res.status(400).json({ error: 'Nome e process_id obrigatórios' });
    const { data: existing } = await supabase.from('deal_stages').select('position').eq('process_id', process_id).eq('user_id', userId).order('position', { ascending: false }).limit(1);
    const position = (existing?.[0]?.position ?? -1) + 1;
    const id = `prod-${createStageId(name)}-${Math.random().toString(36).slice(2, 7)}`;
    const { data: proc } = await supabase.from('production_processes').select('color').eq('id', process_id).eq('user_id', userId).single();
    const color = proc?.color || '#94a3b8';
    const payload = { id, name: name.trim(), position, process_id, color, is_final: false, is_won: false, expected_hours: 0, user_id: userId };
    const { data, error } = await supabase.from('deal_stages').insert(payload).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  });

  app.delete('/api/production/stages-v2/:id', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { id } = req.params;
    const { data: stage } = await supabase.from('deal_stages').select('*').eq('id', id).eq('user_id', userId).single();
    if (!stage) return res.status(404).json({ error: 'Etapa não encontrada' });
    const { data: siblings } = await supabase.from('deal_stages').select('id').eq('process_id', stage.process_id).eq('user_id', userId);
    if (!siblings || siblings.length <= 1) return res.status(400).json({ error: 'É necessário ter pelo menos 1 etapa' });
    const fallbackId = siblings.find((s: any) => s.id !== id)?.id || null;
    await supabase.from('jobs').update({ production_stage: fallbackId }).eq('production_stage', id).eq('user_id', userId);
    await supabase.from('deal_stages').delete().eq('id', id).eq('user_id', userId);
    res.json({ success: true });
  });

  app.put('/api/production/stages-v2/reorder', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { stageIds } = req.body as { stageIds: string[] };
    if (!Array.isArray(stageIds)) return res.status(400).json({ error: 'stageIds deve ser array' });
    await Promise.all(stageIds.map((sid: string, i: number) =>
      supabase.from('deal_stages').update({ position: i }).eq('id', sid).eq('user_id', userId)
    ));
    res.json({ success: true });
  });

  // ============ PRODUCTION STAGES V2 ROUTES ============
  app.get('/api/production/stages-v2', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const stages = await ensureProductionStagesV2(supabase, userId);
    res.json(stages);
  });

  app.patch('/api/production/stages/:id/expected-hours', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { expected_hours } = req.body;
    const { error } = await supabase
      .from('deal_stages')
      .update({ expected_hours: Number(expected_hours) || 0 })
      .eq('id', req.params.id)
      .eq('user_id', userId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  });

  app.patch('/api/production/stages/:id/name', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Nome obrigatório' });
    const { error } = await supabase
      .from('deal_stages')
      .update({ name: name.trim() })
      .eq('id', req.params.id)
      .eq('user_id', userId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  });

  // ============ TEAM MEMBERS ============

  app.get('/api/team-members', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { data, error } = await supabase
      .from('team_members')
      .select('*')
      .eq('owner_user_id', userId)
      .eq('is_active', true)
      .order('created_at');
    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
  });

  app.post('/api/team-members', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { name, email, color, permissions, password } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Nome obrigatório' });
    const defaultPermissions = { dashboard: true, clients: true, jobs: true, vendas: true, calendar: true, finance: true, oportunidades: true, contratos: true };

    // Cria o registro na tabela team_members
    const { data, error } = await supabase
      .from('team_members')
      .insert({ owner_user_id: userId, name: name.trim(), email: email?.trim() || null, color: color || '#6366f1', permissions: permissions || defaultPermissions })
      .select().single();
    if (error) return res.status(500).json({ error: error.message });

    // Se veio senha, cria o usuário no Supabase Auth imediatamente
    if (password && email?.trim() && supabaseAdmin) {
      const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.createUser({
        email: email.trim(),
        password,
        email_confirm: true, // confirma o email automaticamente — não precisa clicar em link
      });
      if (authError) {
        // Usuário já existe no auth — apenas atualiza a senha e vincula
        if (authError.message?.toLowerCase().includes('already')) {
          const { data: existing } = await supabaseAdmin.auth.admin.listUsers();
          const found = (existing?.users ?? []).find((u: any) => u.email === email.trim());
          if (found) {
            await supabaseAdmin.auth.admin.updateUserById(found.id, { password });
            await supabaseAdmin.from('team_members').update({ member_user_id: found.id }).eq('id', data.id);
          }
        } else {
          return res.status(500).json({ error: `Membro criado mas erro ao gerar acesso: ${authError.message}` });
        }
      } else if (authUser?.user) {
        await supabaseAdmin.from('team_members').update({ member_user_id: authUser.user.id }).eq('id', data.id);
      }
    }

    res.json(data);
  });

  app.put('/api/team-members/:id', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { name, email, color, permissions, password } = req.body;

    // Atualiza dados do membro
    const { error } = await supabase
      .from('team_members')
      .update({ name: name?.trim(), email: email?.trim() || null, color, permissions })
      .eq('id', req.params.id)
      .eq('owner_user_id', userId);
    if (error) return res.status(500).json({ error: error.message });

    // Se veio nova senha, atualiza no Supabase Auth
    if (password && supabaseAdmin) {
      // Busca o member_user_id vinculado
      const { data: member } = await supabaseAdmin
        .from('team_members')
        .select('member_user_id, email')
        .eq('id', req.params.id)
        .single();

      if (member?.member_user_id) {
        // Já tem usuário vinculado — apenas atualiza a senha
        const { error: pwError } = await supabaseAdmin.auth.admin.updateUserById(member.member_user_id, { password });
        if (pwError) return res.status(500).json({ error: `Dados salvos mas erro ao atualizar senha: ${pwError.message}` });
      } else if (member?.email) {
        // Ainda não tem usuário — cria com a nova senha
        const memberEmail = email?.trim() || member.email;
        const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.createUser({
          email: memberEmail,
          password,
          email_confirm: true,
        });
        if (authError) {
          // Já existe no auth — encontra e atualiza
          const { data: existing } = await supabaseAdmin.auth.admin.listUsers();
          const found = (existing?.users ?? []).find((u: any) => u.email === memberEmail);
          if (found) {
            await supabaseAdmin.auth.admin.updateUserById(found.id, { password });
            await supabaseAdmin.from('team_members').update({ member_user_id: found.id }).eq('id', req.params.id);
          }
        } else if (authUser?.user) {
          await supabaseAdmin.from('team_members').update({ member_user_id: authUser.user.id }).eq('id', req.params.id);
        }
      }
    }

    res.json({ success: true });
  });

  app.delete('/api/team-members/:id', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    // Desvincula jobs antes de excluir
    await supabase.from('jobs').update({ assignee_id: null }).eq('assignee_id', req.params.id).eq('user_id', userId);
    const { error } = await supabase
      .from('team_members')
      .update({ is_active: false })
      .eq('id', req.params.id)
      .eq('owner_user_id', userId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  });

  // ============ TASKS ============

  app.get('/api/tasks', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { data, error } = await supabase
      .from('tasks')
      .select('*')
      .eq('user_id', userId)
      .order('due_date', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
  });

  app.post('/api/tasks', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { title, description, assignee_id, job_id, stage_id, due_date } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: 'Título obrigatório' });
    if (!due_date) return res.status(400).json({ error: 'Prazo obrigatório' });
    const { data, error } = await supabase
      .from('tasks')
      .insert({
        user_id: userId,
        title: title.trim(),
        description: description?.trim() || null,
        assignee_id: assignee_id || null,
        job_id: job_id || null,
        stage_id: stage_id || null,
        due_date,
      })
      .select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  });

  app.put('/api/tasks/:id', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { title, description, assignee_id, job_id, stage_id, due_date } = req.body;
    const { error } = await supabase
      .from('tasks')
      .update({
        title: title?.trim(),
        description: description?.trim() || null,
        assignee_id: assignee_id || null,
        job_id: job_id || null,
        stage_id: stage_id || null,
        due_date,
      })
      .eq('id', req.params.id)
      .eq('user_id', userId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  });

  app.patch('/api/tasks/:id/complete', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { completed } = req.body;
    const { error } = await supabase
      .from('tasks')
      .update({ completed_at: completed ? new Date().toISOString() : null })
      .eq('id', req.params.id)
      .eq('user_id', userId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  });

  app.delete('/api/tasks/:id', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { error } = await supabase
      .from('tasks')
      .delete()
      .eq('id', req.params.id)
      .eq('user_id', userId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  });

  app.get('/api/me', requireAuth, async (req, res) => {
    res.json({
      isMember: (req as any).isMember ?? false,
      permissions: (req as any).memberPermissions ?? null,
    });
  });

  app.post('/api/admin/invite', requireAuth, async (req, res) => {
    if ((req as any).isMember) {
      return res.status(403).json({ error: 'Apenas o proprietário pode convidar membros' });
    }
    if (!supabaseAdmin) {
      return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY não configurada' });
    }
    const userId = (req as any).userId;
    const { team_member_id } = req.body;
    if (!team_member_id) return res.status(400).json({ error: 'team_member_id obrigatório' });

    const { data: member } = await supabaseAdmin
      .from('team_members')
      .select('*')
      .eq('id', team_member_id)
      .eq('owner_user_id', userId)
      .single();

    if (!member) return res.status(404).json({ error: 'Membro não encontrado' });
    if (!member.email) return res.status(400).json({ error: 'Membro sem e-mail cadastrado' });

    const appUrl = process.env.SERVER_URL || process.env.APP_URL || 'http://localhost:3000';
    const { error } = await supabaseAdmin.auth.admin.inviteUserByEmail(member.email, {
      redirectTo: `${appUrl}/login`,
    });

    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  });

  app.patch('/api/jobs/:id/assignee', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { assignee_id } = req.body;
    const { error } = await supabase
      .from('jobs')
      .update({ assignee_id: assignee_id || null })
      .eq('id', req.params.id)
      .eq('user_id', userId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  });

  // Labels on jobs
  app.patch('/api/jobs/:id/labels', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { labels } = req.body;
    const { error } = await supabase
      .from('jobs')
      .update({ labels: Array.isArray(labels) ? labels : [] })
      .eq('id', req.params.id)
      .eq('user_id', userId);
    if (error) return res.status(500).json({ error: error.message });
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
        production_stage: 'prod-emp-1',
        production_stage_entered_at: new Date().toISOString(),
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

    // Marcar oportunidades do cliente como convertidas
    if (clientId) {
      await supabase
        .from('opportunities')
        .update({ status: 'converted' })
        .eq('user_id', userId)
        .eq('client_id', clientId)
        .in('status', ['em_kanban', 'future', 'active', 'urgent', 'pendente']);
    }

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

  // ============ EXTENSÃO CHROME — endpoints ============

  // Buscar deal por telefone (extensão usa ?phone=5511...)
  app.get('/api/extension/deal-by-phone', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const phone = String(req.query.phone || '').replace(/\D/g, '');
    if (!phone) return res.status(400).json({ error: 'phone é obrigatório' });

    const stages = await ensurePipelineStages(supabase, userId);

    const { data: deal } = await supabase
      .from('deals')
      .select('*')
      .eq('user_id', userId)
      .eq('contact_phone', phone)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!deal) return res.json({ deal: null, stages });

    const stage = stages.find((s) => s.id === deal.stage) || null;
    res.json({ deal: { ...deal, stage_name: stage?.name || deal.stage }, stages });
  });

  // Mover deal de fase (PATCH mais simples que PUT completo)
  app.patch('/api/extension/deals/:id/stage', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { stageId } = req.body;
    if (!stageId) return res.status(400).json({ error: 'stageId é obrigatório' });

    const stages = await ensurePipelineStages(supabase, userId);
    const targetStage = stages.find((s) => s.id === stageId);
    if (!targetStage) return res.status(404).json({ error: 'Fase não encontrada' });

    const { data: deal } = await supabase
      .from('deals')
      .select('*')
      .eq('id', req.params.id)
      .eq('user_id', userId)
      .single();
    if (!deal) return res.status(404).json({ error: 'Deal não encontrado' });

    const nowIso = new Date().toISOString();
    const updates: any = {
      stage: stageId,
      current_stage_entered_at: nowIso,
      stage_entered_at: nowIso,
      stage_history: appendStageHistory(deal.stage_history, stageId, targetStage.name, nowIso),
      updated_at: nowIso,
    };

    const { error } = await supabase.from('deals').update(updates).eq('id', req.params.id).eq('user_id', userId);
    if (error) return res.status(500).json({ error: error.message });

    await recordStageEvent(supabase, userId, Number(req.params.id), deal.stage, stageId, deal.current_stage_entered_at || deal.stage_entered_at);

    res.json({ success: true, stage: targetStage });
  });

  // Adicionar anotação rápida em um deal
  app.post('/api/extension/deals/:id/notes', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { text } = req.body;
    if (!text?.trim()) return res.status(400).json({ error: 'text é obrigatório' });

    const { data: deal } = await supabase
      .from('deals')
      .select('notes')
      .eq('id', req.params.id)
      .eq('user_id', userId)
      .single();
    if (!deal) return res.status(404).json({ error: 'Deal não encontrado' });

    const timestamp = new Date().toLocaleString('pt-BR');
    const newNote = `[${timestamp}] ${text.trim()}`;
    const existing = deal.notes ? deal.notes.trim() : '';
    const merged = existing ? `${existing}\n\n${newNote}` : newNote;

    const { error } = await supabase
      .from('deals')
      .update({ notes: merged, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('user_id', userId);

    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
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


  // ============ OPORTUNIDADES / ANIVERSARIANTES ============

  // Dashboard summary
  app.get('/api/oportunidades/dashboard', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;

    const today = new Date();

    const { data: clientsAll } = await supabase.from('clients').select('id,name,phone,birth_date').eq('user_id', userId);
    const clientIds = (clientsAll || []).map((c: any) => c.id);
    const { data: filhosAll } = clientIds.length
      ? await supabase.from('filhos').select('*').in('cliente_id', clientIds)
      : { data: [] };
    const { data: opsPendentes } = await supabase
      .from('opportunities')
      .select('id')
      .eq('user_id', userId)
      .in('status', ['future', 'active', 'urgent', 'pendente']);
    const { data: opsEmKanban } = await supabase
      .from('opportunities')
      .select('id')
      .eq('user_id', userId)
      .eq('status', 'em_kanban');
    const { data: opsConvertidas } = await supabase
      .from('opportunities')
      .select('id')
      .eq('user_id', userId)
      .in('status', ['converted', 'convertido']);

    const clients = clientsAll || [];
    const filhos = filhosAll || [];

    // Calcula dias até o próximo aniversário (com suporte à virada de ano)
    const daysUntilBirthday = (dateStr: string): number => {
      if (!dateStr) return -1;
      const d = new Date(dateStr);
      const thisYear = new Date(today.getFullYear(), d.getUTCMonth(), d.getUTCDate());
      let diff = Math.round((thisYear.getTime() - today.setHours(0,0,0,0)) / 86400000);
      if (diff < 0) {
        const nextYear = new Date(today.getFullYear() + 1, d.getUTCMonth(), d.getUTCDate());
        diff = Math.round((nextYear.getTime() - new Date().setHours(0,0,0,0)) / 86400000);
      }
      return diff;
    };

    const isBirthdayToday = (dateStr: string) => daysUntilBirthday(dateStr) === 0;
    const isBirthdayThisWeek = (dateStr: string) => { const d = daysUntilBirthday(dateStr); return d >= 0 && d <= 7; };

    const anivHoje = clients.filter((c: any) => isBirthdayToday(c.birth_date)).length
      + filhos.filter((f: any) => isBirthdayToday(f.data_nascimento)).length;
    const anivSemana = clients.filter((c: any) => isBirthdayThisWeek(c.birth_date)).length
      + filhos.filter((f: any) => isBirthdayThisWeek(f.data_nascimento)).length;

    const totalPendentes = (opsPendentes || []).length;
    const totalEmKanban = (opsEmKanban || []).length;
    const totalConvertidas = (opsConvertidas || []).length;
    const totalAproveitadas = totalEmKanban + totalConvertidas;
    const total = totalPendentes + totalAproveitadas;
    const taxaConversao = total > 0 ? Math.round((totalAproveitadas / total) * 100) : 0;

    res.json({ anivHoje, anivSemana, totalPendentes, taxaConversao });
  });

  // Aniversariantes (mães e filhos)
  app.get('/api/oportunidades/aniversariantes', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const periodo = (req.query.periodo as string) || 'hoje'; // hoje | semana | mes

    const today = new Date();
    const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());

    const { data: clients, error } = await supabase
      .from('clients')
      .select('id,name,phone,email,birth_date,status')
      .eq('user_id', userId);

    if (error) return res.status(500).json({ error: error.message });

    const clientIds = (clients || []).map((c: any) => c.id);
    const { data: filhos } = clientIds.length
      ? await supabase.from('filhos').select('*').in('cliente_id', clientIds)
      : { data: [] };

    // Dias até próximo aniversário (suporta virada de ano)
    const calcDias = (dateStr: string): number => {
      if (!dateStr) return -1;
      const d = new Date(dateStr);
      let bday = new Date(todayMidnight.getFullYear(), d.getUTCMonth(), d.getUTCDate());
      let diff = Math.round((bday.getTime() - todayMidnight.getTime()) / 86400000);
      if (diff < 0) {
        bday = new Date(todayMidnight.getFullYear() + 1, d.getUTCMonth(), d.getUTCDate());
        diff = Math.round((bday.getTime() - todayMidnight.getTime()) / 86400000);
      }
      return diff;
    };

    const isInPeriod = (dateStr: string) => {
      const diff = calcDias(dateStr);
      if (diff < 0) return false;
      if (periodo === 'hoje') return diff === 0;
      if (periodo === 'semana') return diff <= 7;
      if (periodo === 'mes') return diff <= 31;
      return false;
    };

    const calcIdade = (dateStr: string) => {
      const d = new Date(dateStr);
      return todayMidnight.getFullYear() - d.getUTCFullYear();
    };

    const result: any[] = [];

    for (const c of (clients || [])) {
      if (c.birth_date && isInPeriod(c.birth_date)) {
        result.push({
          tipo: 'MAE',
          nome: c.name,
          clienteId: c.id,
          clienteNome: c.name,
          telefone: c.phone,
          email: c.email,
          dataNascimento: c.birth_date,
          diasParaAniversario: calcDias(c.birth_date),
          idade: calcIdade(c.birth_date),
          nivel: c.status || 'Bronze',
        });
      }
    }

    for (const f of (filhos || [])) {
      if (isInPeriod(f.data_nascimento)) {
        const cliente = (clients || []).find((c: any) => c.id === f.cliente_id);
        if (!cliente) continue;
        result.push({
          tipo: 'FILHO',
          nome: f.nome,
          filhoId: f.id,
          clienteId: cliente.id,
          clienteNome: cliente.name,
          telefone: cliente.phone,
          email: cliente.email,
          dataNascimento: f.data_nascimento,
          diasParaAniversario: calcDias(f.data_nascimento),
          idade: calcIdade(f.data_nascimento),
          sexo: f.sexo,
          nivel: cliente.status || 'Bronze',
        });
      }
    }

    result.sort((a, b) => a.diasParaAniversario - b.diasParaAniversario);
    res.json(result);
  });

  // Smash the Cake (bebês completando 1 ano em 30 dias)
  app.get('/api/oportunidades/smash-the-cake', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;

    const { data: clients } = await supabase.from('clients').select('id,name,phone,email,status').eq('user_id', userId);
    const { data: filhos } = await supabase.from('filhos').select('*').in('cliente_id', (clients || []).map((c: any) => c.id));

    const today = new Date();
    const result: any[] = [];

    for (const f of (filhos || [])) {
      const nascimento = new Date(f.data_nascimento);
      const aniversario1Ano = new Date(nascimento.getUTCFullYear() + 1, nascimento.getUTCMonth(), nascimento.getUTCDate());
      const diff = Math.ceil((aniversario1Ano.getTime() - today.getTime()) / 86400000);
      if (diff >= 0 && diff <= 30) {
        const cliente = (clients || []).find((c: any) => c.id === f.cliente_id);
        if (!cliente) continue;
        result.push({
          filhoId: f.id,
          nome: f.nome,
          clienteId: cliente.id,
          clienteNome: cliente.name,
          telefone: cliente.phone,
          dataNascimento: f.data_nascimento,
          diasParaAniversario: diff,
          sexo: f.sexo,
          nivel: cliente.status || 'Bronze',
        });
      }
    }

    result.sort((a, b) => a.diasParaAniversario - b.diasParaAniversario);
    res.json(result);
  });

  // Acompanhamentos (3, 6, 9, 12 meses)
  app.get('/api/oportunidades/acompanhamentos', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;

    const { data: clients } = await supabase.from('clients').select('id,name,phone,email,status').eq('user_id', userId);
    const { data: filhos } = await supabase.from('filhos').select('*').in('cliente_id', (clients || []).map((c: any) => c.id));

    const today = new Date();
    const result: any[] = [];

    for (const f of (filhos || [])) {
      const nascimento = new Date(f.data_nascimento);
      const diffMs = today.getTime() - nascimento.getTime();
      const idadeMeses = Math.floor(diffMs / (1000 * 60 * 60 * 24 * 30.44));

      if ([3, 6, 9, 12].includes(idadeMeses)) {
        const cliente = (clients || []).find((c: any) => c.id === f.cliente_id);
        if (!cliente) continue;
        result.push({
          filhoId: f.id,
          nome: f.nome,
          clienteId: cliente.id,
          clienteNome: cliente.name,
          telefone: cliente.phone,
          dataNascimento: f.data_nascimento,
          idadeMeses,
          sexo: f.sexo,
          nivel: cliente.status || 'Bronze',
        });
      }
    }

    res.json(result);
  });

  // Newborn (bebês nascidos nos últimos 30 dias)
  app.get('/api/oportunidades/newborn', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;

    const { data: clients } = await supabase.from('clients').select('id,name,phone,email,status').eq('user_id', userId);
    const { data: filhos } = await supabase.from('filhos').select('*').in('cliente_id', (clients || []).map((c: any) => c.id));

    const today = new Date();
    const result: any[] = [];

    for (const f of (filhos || [])) {
      const nascimento = new Date(f.data_nascimento);
      const diffMs = today.getTime() - nascimento.getTime();
      const diasDeVida = Math.floor(diffMs / 86400000);

      if (diasDeVida >= 0 && diasDeVida <= 30) {
        const cliente = (clients || []).find((c: any) => c.id === f.cliente_id);
        if (!cliente) continue;
        result.push({
          filhoId: f.id,
          nome: f.nome,
          clienteId: cliente.id,
          clienteNome: cliente.name,
          telefone: cliente.phone,
          dataNascimento: f.data_nascimento,
          diasDeVida,
          sexo: f.sexo,
          nivel: cliente.status || 'Bronze',
        });
      }
    }

    result.sort((a, b) => a.diasDeVida - b.diasDeVida);
    res.json(result);
  });

  // Aniversário (filhos completando 2+ anos nos próximos 30 dias)
  app.get('/api/oportunidades/aniversario', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;

    const { data: clients } = await supabase.from('clients').select('id,name,phone,email,status').eq('user_id', userId);
    const { data: filhos } = await supabase.from('filhos').select('*').in('cliente_id', (clients || []).map((c: any) => c.id));

    const today = new Date();
    const result: any[] = [];

    for (const f of (filhos || [])) {
      const nascimento = new Date(f.data_nascimento);
      const idadeAtual = today.getFullYear() - nascimento.getUTCFullYear();
      const proximoAniversario = new Date(today.getFullYear(), nascimento.getUTCMonth(), nascimento.getUTCDate());
      if (proximoAniversario < today) proximoAniversario.setFullYear(today.getFullYear() + 1);
      const diff = Math.ceil((proximoAniversario.getTime() - today.getTime()) / 86400000);
      const idadeQueCompleta = proximoAniversario.getFullYear() - nascimento.getUTCFullYear();

      // Apenas 2 anos em diante (1 ano = Smash the Cake), janela de 30 dias
      if (idadeQueCompleta >= 2 && diff >= 0 && diff <= 30) {
        const cliente = (clients || []).find((c: any) => c.id === f.cliente_id);
        if (!cliente) continue;
        result.push({
          filhoId: f.id,
          nome: f.nome,
          clienteId: cliente.id,
          clienteNome: cliente.name,
          telefone: cliente.phone,
          dataNascimento: f.data_nascimento,
          diasParaAniversario: diff,
          idadeQueCompleta,
          sexo: f.sexo,
          nivel: cliente.status || 'Bronze',
        });
      }
    }

    result.sort((a, b) => a.diasParaAniversario - b.diasParaAniversario);
    res.json(result);
  });

  // CRUD filhos
  app.get('/api/filhos/cliente/:clienteId', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { clienteId } = req.params;

    const { data: client } = await supabase.from('clients').select('id').eq('id', clienteId).eq('user_id', userId).single();
    if (!client) return res.status(404).json({ error: 'Cliente não encontrado' });

    const { data, error } = await supabase.from('filhos').select('*').eq('cliente_id', clienteId).order('data_nascimento');
    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
  });

  app.post('/api/filhos', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { cliente_id, nome, data_nascimento, sexo } = req.body;
    if (!cliente_id || !nome || !data_nascimento) return res.status(400).json({ error: 'cliente_id, nome e data_nascimento são obrigatórios' });

    const { data: client } = await supabase.from('clients').select('id').eq('id', cliente_id).eq('user_id', userId).single();
    if (!client) return res.status(404).json({ error: 'Cliente não encontrado' });

    const { data, error } = await supabase.from('filhos').insert({ cliente_id, nome, data_nascimento, sexo: sexo || null }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  });

  app.put('/api/filhos/:id', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { nome, data_nascimento, sexo } = req.body;

    const { data: filho } = await supabase.from('filhos').select('*, clients!inner(user_id)').eq('id', req.params.id).single();
    if (!filho || (filho as any).clients?.user_id !== userId) return res.status(404).json({ error: 'Filho não encontrado' });

    const { error } = await supabase.from('filhos').update({ nome, data_nascimento, sexo, updated_at: new Date().toISOString() }).eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  });

  app.delete('/api/filhos/:id', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;

    const { data: filho } = await supabase.from('filhos').select('cliente_id').eq('id', req.params.id).single();
    if (!filho) return res.status(404).json({ error: 'Filho não encontrado' });
    const { data: client } = await supabase.from('clients').select('id').eq('id', (filho as any).cliente_id).eq('user_id', userId).single();
    if (!client) return res.status(403).json({ error: 'Sem permissão' });

    await supabase.from('filhos').delete().eq('id', req.params.id);
    res.json({ success: true });
  });

  // CRUD oportunidades — usa a tabela 'opportunities' que já existe e funciona
  app.get('/api/oportunidades', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;

    const { data, error } = await supabase
      .from('opportunities')
      .select('*, clients(name, phone, email)')
      .eq('user_id', userId)
      .order('suggested_date', { ascending: true });

    if (error) return res.status(500).json({ error: error.message });

    const enriched = (data || []).map((o: any) => ({
      id: o.id,
      cliente_id: o.client_id,
      cliente_nome: (o.clients as any)?.name || '',
      cliente_telefone: (o.clients as any)?.phone || '',
      cliente_email: (o.clients as any)?.email || '',
      tipo: o.type,
      status: o.status,
      data_oportunidade: o.suggested_date,
      notas: o.notes,
      valor_proposta: o.estimated_value,
      prioridade: getPriority(o.suggested_date),
    }));
    res.json(enriched);
  });

  app.post('/api/oportunidades', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { cliente_id, tipo, status, data_oportunidade, notas, valor_proposta } = req.body;
    if (!cliente_id || !tipo || !data_oportunidade) return res.status(400).json({ error: 'cliente_id, tipo e data_oportunidade são obrigatórios' });

    const { data: client } = await supabase.from('clients').select('id').eq('id', cliente_id).eq('user_id', userId).single();
    if (!client) return res.status(404).json({ error: 'Cliente não encontrado' });

    // Insere na tabela opportunities com os campos corretos
    const { data, error } = await supabase.from('opportunities').insert({
      client_id: cliente_id,
      type: tipo,
      suggested_date: data_oportunidade,
      status: status || 'future',
      notes: notas || null,
      estimated_value: valor_proposta || null,
      user_id: userId,
    }).select().single();

    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  });

  app.put('/api/oportunidades/:id', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;

    const { data: op } = await supabase
      .from('opportunities')
      .select('id')
      .eq('id', req.params.id)
      .eq('user_id', userId)
      .single();
    if (!op) return res.status(404).json({ error: 'Oportunidade não encontrada' });

    // Mapeia campos do frontend para os campos reais da tabela
    const { status, notas, valor_proposta } = req.body;
    const updates: any = {};
    if (status !== undefined) updates.status = status;
    if (notas !== undefined) updates.notes = notas;
    if (valor_proposta !== undefined) updates.estimated_value = valor_proposta;

    const { error } = await supabase.from('opportunities').update(updates).eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  });

  // Converter oportunidade em Job
  app.post('/api/oportunidades/:id/converter-job', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { job_date, amount, payment_method, job_name } = req.body;

    if (!job_date) return res.status(400).json({ error: 'job_date é obrigatório' });

    const { data: op } = await supabase
      .from('opportunities')
      .select('*, clients(name)')
      .eq('id', req.params.id)
      .eq('user_id', userId)
      .single();

    if (!op) return res.status(404).json({ error: 'Oportunidade não encontrada' });

    // Cria o Job
    const { data: job, error: jobError } = await supabase.from('jobs').insert({
      client_id: op.client_id,
      job_type: op.type,
      job_date,
      job_name: job_name || op.type,
      amount: amount || 0,
      payment_method: payment_method || 'PIX',
      payment_status: 'pending',
      status: 'scheduled',
      notes: op.notes || '',
      user_id: userId,
    }).select().single();

    if (jobError) return res.status(500).json({ error: jobError.message });

    // Atualiza o status da oportunidade para convertido
    await supabase.from('opportunities').update({ status: 'converted' }).eq('id', req.params.id);

    res.json({ success: true, job });
  });

  // CRUD cupons
  app.post('/api/cupons', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { cliente_id, oportunidade_id, tipo_desconto, valor_desconto, data_validade, codigo } = req.body;
    if (!tipo_desconto || !valor_desconto || !data_validade) return res.status(400).json({ error: 'Campos obrigatórios faltando' });

    if (cliente_id) {
      const { data: client } = await supabase.from('clients').select('id').eq('id', cliente_id).eq('user_id', userId).single();
      if (!client) return res.status(404).json({ error: 'Cliente não encontrado' });
    }

    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let cod = codigo || '';
    if (!cod) {
      for (let i = 0; i < 8; i++) cod += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    const { data, error } = await supabase.from('cupons').insert({
      codigo: cod, cliente_id: cliente_id || null, oportunidade_id: oportunidade_id || null,
      tipo_desconto, valor_desconto, data_validade, usado: false
    }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  });

  app.get('/api/cupons', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { data: clients } = await supabase.from('clients').select('id').eq('user_id', userId);
    const clientIds = (clients || []).map((c: any) => c.id);
    if (!clientIds.length) return res.json([]);
    const { data, error } = await supabase.from('cupons').select('*').in('cliente_id', clientIds).order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
  });

  // Atualiza data de nascimento da mãe (birth_date) no cliente
  app.patch('/api/clients/:id/mae-nascimento', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { mae_nascimento } = req.body;

    const { data: existing } = await supabase.from('clients').select('id').eq('id', req.params.id).eq('user_id', userId).single();
    if (!existing) return res.status(404).json({ error: 'Cliente não encontrado' });

    // birth_date é o campo existente que armazena a data de nascimento do cliente (mãe)
    const { error } = await supabase.from('clients').update({ birth_date: mae_nascimento }).eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  });

  // ============ META WHATSAPP BUSINESS ============
  const META_APP_ID = process.env.META_APP_ID || '';
  const META_APP_SECRET = process.env.META_APP_SECRET || '';

  // Rota de diagnóstico — retorna o que o token tem acesso
  app.get('/api/meta/whatsapp/debug', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;

    const { data: acc } = await supabase
      .from('whatsapp_business_accounts')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (!acc) return res.status(404).json({ error: 'Nenhuma conta conectada' });

    const result: any = { account_in_db: acc };

    try {
      // 1. debug_token
      const debugRes = await fetch(
        `https://graph.facebook.com/v21.0/debug_token?input_token=${acc.access_token}&access_token=${META_APP_ID}|${META_APP_SECRET}`
      );
      result.debug_token = await debugRes.json();
    } catch (e: any) { result.debug_token_error = e.message; }

    try {
      // 2. phone number details
      const phoneRes = await fetch(
        `https://graph.facebook.com/v21.0/${acc.phone_number_id}?fields=id,display_phone_number,verified_name,quality_rating,platform_type&access_token=${acc.access_token}`
      );
      result.phone_number_details = await phoneRes.json();
    } catch (e: any) { result.phone_number_error = e.message; }

    try {
      // 3. Tenta enviar mensagem de teste
      const sendRes = await fetch(
        `https://graph.facebook.com/v21.0/${acc.phone_number_id}/messages`,
        {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${acc.access_token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: '5543988416682',
            type: 'text',
            text: { body: 'Teste diagnóstico FotoMOVE' },
          }),
        }
      );
      result.test_send = await sendRes.json();
    } catch (e: any) { result.test_send_error = e.message; }

    res.json(result);
  });

  app.post('/api/meta/whatsapp/exchange-token', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { access_token, code } = req.body;
    const token = access_token || code;

    if (!token) return res.status(400).json({ error: 'access_token é obrigatório' });
    if (!META_APP_ID || !META_APP_SECRET) return res.status(500).json({ error: 'META_APP_ID/META_APP_SECRET não configurados' });

    try {
      // 1. Inspeciona o token para extrair WABA IDs autorizados
      const appToken = encodeURIComponent(`${META_APP_ID}|${META_APP_SECRET}`);
      const debugRes = await fetch(
        `https://graph.facebook.com/v21.0/debug_token?input_token=${encodeURIComponent(token)}&access_token=${appToken}`
      );
      const debugData = await debugRes.json();
      console.log('[Meta] debug_token response:', JSON.stringify(debugData));

      if (debugData.error) {
        console.error('[Meta] debug_token error:', debugData.error);
        return res.status(400).json({ error: `Meta API error: ${debugData.error.message}` });
      }

      const wabaScope = (debugData.data?.granular_scopes || []).find(
        (s: any) => s.scope === 'whatsapp_business_management'
      );
      const wabaId = wabaScope?.target_ids?.[0] || null;
      console.log('[Meta] WABA scope:', wabaScope, '| wabaId:', wabaId);

      // 3. Busca número de telefone do WABA
      let phoneNumberId: string | null = null;
      let phoneNumber: string | null = null;
      let displayName: string | null = null;

      if (wabaId) {
        const phoneRes = await fetch(
          `https://graph.facebook.com/v21.0/${wabaId}/phone_numbers?access_token=${token}`
        );
        const phoneData = await phoneRes.json();
        if (phoneData.data?.length > 0) {
          const phone = phoneData.data[0];
          phoneNumberId = phone.id;
          phoneNumber = phone.display_phone_number;
          displayName = phone.verified_name;
        }
      }

      // 4. Salva ou atualiza no banco
      const { error } = await supabase
        .from('whatsapp_business_accounts')
        .upsert(
          {
            user_id: userId,
            waba_id: wabaId,
            phone_number_id: phoneNumberId,
            phone_number: phoneNumber,
            display_name: displayName,
            access_token: token,
            connected_at: new Date().toISOString(),
          },
          { onConflict: 'user_id' }
        );

      if (error) return res.status(500).json({ error: error.message });

      // 5. Assina webhook no nível da WABA (necessário para receber eventos)
      if (wabaId && token) {
        try {
          const subRes = await fetch(
            `https://graph.facebook.com/v21.0/${wabaId}/subscribed_apps`,
            { method: 'POST', headers: { Authorization: `Bearer ${token}` } }
          );
          const subData = await subRes.json();
          console.log('[Meta] WABA subscribed_apps:', JSON.stringify(subData));
        } catch (subErr) {
          console.error('[Meta] Falha ao assinar WABA webhook:', subErr);
          // Não bloqueia — a conexão foi salva, usuário pode tentar manualmente
        }
      }

      res.json({ success: true, waba_id: wabaId, phone_number: phoneNumber, display_name: displayName });
    } catch (err: any) {
      console.error('[Meta] exchange-token error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // Assina/verifica webhook no nível da WABA
  app.post('/api/meta/whatsapp/subscribe-webhook', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;

    const { data: acc } = await supabase
      .from('whatsapp_business_accounts')
      .select('waba_id, access_token')
      .eq('user_id', userId)
      .maybeSingle();

    if (!acc?.waba_id || !acc?.access_token) {
      return res.status(400).json({ error: 'Conta WhatsApp não conectada' });
    }

    try {
      // Verifica assinatura atual
      const checkRes = await fetch(
        `https://graph.facebook.com/v21.0/${acc.waba_id}/subscribed_apps`,
        { headers: { Authorization: `Bearer ${acc.access_token}` } }
      );
      const checkData = await checkRes.json();

      // Assina o app
      const subRes = await fetch(
        `https://graph.facebook.com/v21.0/${acc.waba_id}/subscribed_apps`,
        { method: 'POST', headers: { Authorization: `Bearer ${acc.access_token}` } }
      );
      const subData = await subRes.json();

      console.log('[Meta] subscribe-webhook:', JSON.stringify({ checkData, subData }));

      res.json({
        current_subscriptions: checkData,
        subscribe_result: subData,
        success: subData.success === true,
      });
    } catch (err: any) {
      console.error('[Meta] subscribe-webhook error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/meta/whatsapp/status', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;

    const { data, error } = await supabase
      .from('whatsapp_business_accounts')
      .select('waba_id, phone_number_id, phone_number, display_name, connected_at')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) return res.status(500).json({ error: error.message });

    res.json({ connected: !!data, account: data || null });
  });

  app.delete('/api/meta/whatsapp/disconnect', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;

    const { error } = await supabase
      .from('whatsapp_business_accounts')
      .delete()
      .eq('user_id', userId);

    if (error) return res.status(500).json({ error: error.message });

    res.json({ success: true });
  });

  // ============ WHATSAPP MESSAGING ============
  const WA_WEBHOOK_VERIFY_TOKEN = process.env.WA_WEBHOOK_VERIFY_TOKEN || 'fotomove_webhook_2026';

  // Webhook verification (GET) — Meta calls this to confirm the endpoint
  app.get('/api/whatsapp/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === WA_WEBHOOK_VERIFY_TOKEN) {
      console.log('[WhatsApp Webhook] Verified');
      res.status(200).send(challenge as string);
    } else {
      res.status(403).send('Forbidden');
    }
  });

  // (Meta POST webhook is handled by the unified handler above)

  // Send message
  app.post('/api/whatsapp/send', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { to, body, client_id } = req.body;

    if (!to || !body) return res.status(400).json({ error: 'to e body são obrigatórios' });

    const { data: waAccount } = await supabase
      .from('whatsapp_business_accounts')
      .select('phone_number_id, phone_number, access_token')
      .eq('user_id', userId)
      .maybeSingle();

    if (!waAccount) return res.status(400).json({ error: 'WhatsApp Business não conectado' });

    const cleanPhone = to.replace(/\D/g, '');

    try {
      const metaRes = await fetch(
        `https://graph.facebook.com/v21.0/${waAccount.phone_number_id}/messages`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${waAccount.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: cleanPhone,
            type: 'text',
            text: { body },
          }),
        }
      );
      const metaData = await metaRes.json();

      if (metaData.error) {
        console.error('[WhatsApp] Send error:', metaData.error);
        return res.status(400).json({ error: metaData.error.message });
      }

      await supabase.from('whatsapp_messages').insert({
        user_id: userId,
        client_id: client_id || null,
        direction: 'outbound',
        from_number: waAccount.phone_number,
        to_number: cleanPhone,
        wa_message_id: metaData.messages?.[0]?.id,
        body,
        status: 'sent',
      });

      res.json({ success: true, message_id: metaData.messages?.[0]?.id });
    } catch (err: any) {
      console.error('[WhatsApp] Send error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // List conversations (last message per phone number)
  app.get('/api/whatsapp/conversations', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;

    const { data, error } = await supabase
      .from('whatsapp_messages')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(500);

    if (error) return res.status(500).json({ error: error.message });

    // Group by partner phone — first occurrence = last message
    const seen = new Set<string>();
    const conversations: any[] = [];
    for (const msg of data || []) {
      const partner = msg.direction === 'outbound' ? msg.to_number : msg.from_number;
      if (!seen.has(partner)) {
        seen.add(partner);
        conversations.push({
          phone: partner,
          client_id: msg.client_id,
          last_message: msg.body,
          last_direction: msg.direction,
          last_at: msg.created_at,
        });
      }
    }

    res.json(conversations);
  });

  // Messages for a specific phone conversation
  app.get('/api/whatsapp/messages/:phone', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const phone = req.params.phone;

    const { data, error } = await supabase
      .from('whatsapp_messages')
      .select('*')
      .eq('user_id', userId)
      .or(`to_number.eq.${phone},from_number.eq.${phone}`)
      .order('created_at', { ascending: true });

    if (error) return res.status(500).json({ error: error.message });

    res.json(data);
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

import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import { google } from 'googleapis';
import dotenv from 'dotenv';
import Papa from 'papaparse';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseClient } from './supabase.js';
import makeWASocket, { DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import QRCode from 'qrcode';
import pino from 'pino';
import fs from 'fs';
import {
  DEFAULT_STAGES,
  DEFAULT_PRODUCTION_STAGES,
  calculateTemperature,
  computePipelineAnalytics,
  createStageId,
  ensurePipelineStages,
  ensureProductionStages,
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

// ============ BAILEYS DIRETO (substitui Evolution API) ============
const baileysConnections = new Map<string, any>(); // userId → WASocket
const baileysQrCodes = new Map<string, string>();  // userId → base64 QR
const baileysStates = new Map<string, string>();   // userId → 'open'|'close'|'connecting'
const contactNamesByPhone = new Map<string, string>(); // phone → nome real do contato

async function startBaileysConnection(userId: string): Promise<void> {
  // Fecha conexão existente
  const existing = baileysConnections.get(userId);
  if (existing) {
    try { existing.end(undefined); } catch {}
    baileysConnections.delete(userId);
  }
  baileysQrCodes.delete(userId);
  baileysStates.set(userId, 'connecting');

  const sessionDir = `./baileys_sessions/${userId}`;
  fs.mkdirSync(sessionDir, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    logger: pino({ level: 'silent' }),
    browser: ['FocalPoint', 'Chrome', '1.0.0'],
    connectTimeoutMs: 30000,
  });

  baileysConnections.set(userId, sock);
  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update: any) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      const base64 = await QRCode.toDataURL(qr).catch(() => '');
      if (base64) {
        baileysQrCodes.set(userId, base64);
        console.log(`[Baileys] QR pronto para: ${userId.substring(0, 8)}`);
      }
    }

    if (connection === 'open') {
      baileysStates.set(userId, 'open');
      baileysQrCodes.delete(userId);
      console.log(`[Baileys] Conectado: ${userId.substring(0, 8)}`);
    }

    if (connection === 'close') {
      baileysStates.set(userId, 'close');
      const code = (lastDisconnect?.error as Boom)?.output?.statusCode;
      console.log(`[Baileys] Fechado (${code}) para: ${userId.substring(0, 8)}`);
      const loggedOut = code === DisconnectReason.loggedOut || code === DisconnectReason.connectionReplaced;
      if (!loggedOut) {
        setTimeout(() => startBaileysConnection(userId).catch(console.error), 5000);
      } else {
        baileysConnections.delete(userId);
      }
    }
  });

  // Mensagens em tempo real e histórico recente
  sock.ev.on('messages.upsert', ({ messages, type }: any) => {
    if (type !== 'notify' && type !== 'append') return;
    processBaileysMessages(messages, userId);
  });

  // Histórico inicial sincronizado no login (evento principal de sync)
  sock.ev.on('messaging-history.set', ({ messages }: any) => {
    if (!Array.isArray(messages) || messages.length === 0) return;
    console.log(`[Baileys] History sync: ${messages.length} mensagens`);
    processBaileysMessages(messages, userId);
  });
}

function extractBaileysText(msg: any): string {
  const m = msg.message ?? {};
  return (
    m.conversation
    ?? m.extendedTextMessage?.text
    ?? m.imageMessage?.caption
    ?? m.videoMessage?.caption
    ?? m.documentMessage?.caption
    ?? m.documentWithCaptionMessage?.message?.documentMessage?.caption
    ?? (m.audioMessage ? '[Áudio]' : null)
    ?? (m.imageMessage ? '[Imagem]' : null)
    ?? (m.videoMessage ? '[Vídeo]' : null)
    ?? (m.documentMessage ? '[Documento]' : null)
    ?? (m.stickerMessage ? '[Figurinha]' : null)
    ?? (m.contactMessage ? '[Contato]' : null)
    ?? (m.locationMessage ? '[Localização]' : null)
    ?? (m.reactionMessage ? `Reagiu: ${m.reactionMessage.text ?? ''}` : null)
    // m.protocolMessage: ignorar mensagens de protocolo (deletados, etc)
    ?? (Object.keys(m).length > 0 ? '[Mensagem]' : null)
    ?? ''
  );
}

function processBaileysMessages(messages: any[], userId?: string) {
  for (const msg of messages) {
    const jid = msg.key?.remoteJid ?? '';
    if (jid.includes('@g.us')) continue;
    if (!msg.message) continue;
    if (msg.message?.protocolMessage) continue;

    const phone = jid.replace('@s.whatsapp.net', '').replace(/\D/g, '');
    if (!phone) continue;

    const text = extractBaileysText(msg);
    if (!text) continue;

    const pushName = (msg as any).pushName;
    if (pushName && !msg.key.fromMe && !contactNamesByPhone.has(phone)) {
      contactNamesByPhone.set(phone, pushName);
    }

    cacheLiveWhatsAppMessage({
      id: msg.key.id ?? `${phone}-${Date.now()}`,
      phone,
      name: contactNamesByPhone.get(phone) ?? pushName ?? undefined,
      text,
      fromMe: Boolean(msg.key.fromMe),
      timestamp: Number(msg.messageTimestamp) * 1000,
      source: 'webhook',
    }, userId);
  }
}

const normalizePhone = (value: unknown) => {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  return String(value).replace(/\D/g, '');
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

    // Baileys direto — sem Evolution API
    try {
      console.log(`[Baileys] Iniciando conexão para: ${userId.substring(0, 8)}`);
      await startBaileysConnection(userId);
      res.json({ success: true, status: 'connecting', instance: { state: 'connecting' } });
    } catch (error) {
      console.error('[Baileys] Erro ao iniciar:', error);
      res.status(500).json({ error: 'Falha ao iniciar WhatsApp' });
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
            byEvents: true,
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

    // Baileys direto — aguarda QR em memória (gerado em 1-3s)
    try {
      for (let i = 0; i < 20; i++) {
        const state = baileysStates.get(userId);
        if (state === 'open') return res.json({ instance: { state: 'open' } });
        const qr = baileysQrCodes.get(userId);
        if (qr) {
          console.log(`[Baileys] QR servido após ${i}s para: ${userId.substring(0, 8)}`);
          return res.json({ base64: qr, qrcode: { base64: qr } });
        }
        await new Promise(r => setTimeout(r, 1000));
      }
      console.log(`[Baileys] QR timeout para: ${userId.substring(0, 8)}`);
      res.json({ count: 0 });
    } catch (error) {
      console.error('[Baileys] Erro ao buscar QR:', error);
      res.status(500).json({ error: 'Falha ao buscar QR Code' });
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

    // Baileys direto
    const state = baileysStates.get(userId) ?? 'close';
    res.json({ instance: { state }, state, connectionStatus: state });
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

    // Baileys direto
    try {
      const sock = baileysConnections.get(userId);
      if (!sock || baileysStates.get(userId) !== 'open') {
        return res.status(503).json({ error: 'WhatsApp não conectado' });
      }
      const cleanNumber = String(number).replace(/\D/g, '');
      const jid = `${cleanNumber}@s.whatsapp.net`;
      await sock.sendMessage(jid, { text: String(text) });
      res.json({ success: true });
    } catch (error) {
      console.error('[Baileys] Erro ao enviar mensagem:', error);
      res.status(500).json({ error: 'Falha ao enviar mensagem' });
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

    // Baileys direto
    try {
      const sock = baileysConnections.get(userId);
      if (sock) {
        try { await sock.logout(); } catch {}
        baileysConnections.delete(userId);
      }
      baileysStates.set(userId, 'close');
      baileysQrCodes.delete(userId);
      const sessionDir = `./baileys_sessions/${userId}`;
      try { fs.rmSync(sessionDir, { recursive: true, force: true }); } catch {}
      res.json({ ok: true });
    } catch (error) {
      console.error('[Baileys] Erro ao desconectar:', error);
      res.status(500).json({ error: 'Falha ao desconectar WhatsApp' });
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

    // Baileys direto — retorna chats do cache em memória
    const chats: any[] = [];
    for (const [phone, messages] of liveWhatsAppMessagesByPhone.entries()) {
      if (messages.length === 0) continue;
      const last = messages[messages.length - 1];
      chats.push({
        id: `${phone}@s.whatsapp.net`,
        remoteJid: `${phone}@s.whatsapp.net`,
        name: last.name ?? phone,
        lastMessage: last.text,
        timestamp: last.timestamp,
        unreadCount: 0,
      });
    }
    chats.sort((a, b) => b.timestamp - a.timestamp);
    res.json(chats);
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

    // Baileys: servir mensagens do cache em memória
    const phone = normalizePhone(jid);
    const messages = getLiveMessagesByPhone(phone, limit);
    return res.json({ messages, provider: 'baileys' });
  });

  // Webhook para mensagens recebidas (Evolution API chama este endpoint)
  app.post('/api/whatsapp/webhook', async (req, res) => {
    try {
      const payload = req.body;

      // Capturar QR Code entregue via webhook (evento QRCODE_UPDATED)
      const instanceName = payload?.instance ?? payload?.instanceName ?? '';
      const eventType = payload?.event ?? payload?.type ?? '';
      if (eventType === 'qrcode.updated' || eventType === 'QRCODE_UPDATED') {
        const qrBase64 = payload?.data?.qrcode?.base64 ?? payload?.qrcode?.base64 ?? payload?.data?.base64 ?? '';
        if (qrBase64 && instanceName) {
          qrCodeByInstance.set(instanceName, qrBase64);
          console.log(`[WA] QR recebido via webhook para instância: ${instanceName}`);
        }
        return res.sendStatus(200);
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

        // Filtrar grupos (JID @g.us, chatId com hífen ou flag isGroup)
        const isGroup =
          rawPhone.includes('@g.us') ||
          /^\d+[-]\d+/.test(rawPhone) ||
          Boolean(event?.isGroup) ||
          String(event?.chatId ?? '').includes('@g.us');
        if (isGroup) continue;

        const phone = normalizePhone(rawPhone);
        const text = extractWebhookText(event);
        if (!phone || !text) continue;

        // Capturar nome do contato do payload do Z-API
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
      res.sendStatus(200);
    } catch (error) {
      console.error('Erro no webhook:', error);
      res.sendStatus(500);
    }
  });

  // Retorna todos os contatos que enviaram mensagens via webhook (cache em memória)
  app.get('/api/whatsapp/live-contacts', requireAuth, async (_req, res) => {
    const contacts = [...liveWhatsAppMessagesByPhone.entries()].map(([phone, messages]) => {
      const latest = messages[messages.length - 1];
      const readUntil = readUpToTimestampByPhone.get(phone) ?? 0;
      const unread = messages.filter((m) => !m.fromMe && m.timestamp > readUntil).length;
      // Usar nome salvo no cache de contatos, senão fallback para pushName das mensagens
      const name = contactNamesByPhone.get(phone) || messages.map((m) => m.name).find((n) => n) || undefined;
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
    try {
      const supabase = createSupabaseClient();
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
            contact_name: contactNamesByPhone.get(phone) || null,
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
          contact_name: contactNamesByPhone.get(phone) || null,
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
    const phone = req.params.phone;
    const limit = Number(req.query.limit) || 60;
    try {
      const supabase = createSupabaseClient();
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
    const phone = req.params.phone;
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

  // Enviar mensagem via Baileys
  app.post('/api/inbox/send', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const { phone, text } = req.body;
    if (!phone || !text) return res.status(400).json({ error: 'phone e text são obrigatórios' });

    const sock = baileysConnections.get(userId);
    if (!sock) return res.status(503).json({ error: 'WhatsApp não conectado' });

    try {
      const jid = `${phone.replace(/\D/g, '')}@s.whatsapp.net`;
      await sock.sendMessage(jid, { text });

      const msgId = `sent-${Date.now()}`;
      const ts = new Date().toISOString();

      // Salvar localmente
      cacheLiveWhatsAppMessage({
        id: msgId,
        phone: phone.replace(/\D/g, ''),
        text,
        fromMe: true,
        timestamp: Date.now(),
        source: 'webhook',
      }, userId);

      return res.json({ ok: true, message_id: msgId, timestamp: ts });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Falha ao enviar mensagem' });
    }
  });

  // Sincroniza histórico de conversas recentes da Evolution API para o cache em memória
  app.post('/api/whatsapp/sync-history', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const instanceName = getInstanceName(userId);
    const limit = Number(req.query.limit) || 30; // últimas 30 conversas

    // Baileys sincroniza automaticamente ao conectar via messages.upsert
    const total = liveWhatsAppMessagesByPhone.size;
    res.json({ synced: total, total, note: 'Baileys sincroniza automaticamente ao conectar' });
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
    const { client_id, job_type, job_date, job_time, job_end_time, job_name, amount, payment_method, payment_status, status, notes, production_stage } = req.body;

    const { data: oldJob } = await supabase
      .from('jobs')
      .select('*')
      .eq('id', req.params.id)
      .eq('user_id', userId)
      .single();

    if (!oldJob) return res.status(404).json({ error: 'Job not found' });

    const updatePayload: any = {
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
      notes,
    };
    if (production_stage !== undefined) updatePayload.production_stage = production_stage;

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

  // ============ VIDEO EDITOR ROUTES ============
  {
    const multer = (await import('multer')).default;
    const ffmpeg = (await import('fluent-ffmpeg')).default;
    const ffmpegInstaller = (await import('@ffmpeg-installer/ffmpeg')).default;
    const { OpenAI } = await import('openai');
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const { v4: uuidv4 } = await import('uuid');
    const { createClient: createSupabaseStorageClient } = await import('@supabase/supabase-js');

    ffmpeg.setFfmpegPath(ffmpegInstaller.path);

    const VIDEO_UPLOADS_DIR = path.join(__dirname, 'server/uploads');
    const VIDEO_PROCESSED_DIR = path.join(__dirname, 'server/processed');
    fs.mkdirSync(VIDEO_UPLOADS_DIR, { recursive: true });
    fs.mkdirSync(VIDEO_PROCESSED_DIR, { recursive: true });

    // Supabase Storage client — uses service role key to bypass RLS
    const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
    const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY!;
    const storageSupa = createSupabaseStorageClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const VIDEO_BUCKET = 'videos';

    // Compress video to fit within Supabase free tier 50MB limit
    async function compressForUpload(inputPath: string, jobId: string): Promise<string | null> {
      const stat = fs.statSync(inputPath);
      if (stat.size <= 45 * 1024 * 1024) return inputPath; // already small enough

      const sizeMB = stat.size / 1024 / 1024;
      const compressedPath = path.join(VIDEO_PROCESSED_DIR, `${jobId}_compressed_upload.mp4`);
      console.log(`[storage] comprimindo ${sizeMB.toFixed(1)}MB → <48MB para Supabase...`);

      // Calculate target bitrate: 45MB in bits / duration in seconds
      const duration = await new Promise<number>((resolve) => {
        ffmpeg.ffprobe(inputPath, (err: any, metadata: any) => {
          resolve(err ? 60 : (metadata?.format?.duration || 60));
        });
      });

      // Target ~44MB to leave margin
      const targetBits = 48 * 8 * 1024 * 1024;
      const videoBitrate = Math.floor(targetBits / duration / 1000); // kbps
      const finalBitrate = Math.max(5000, Math.min(videoBitrate, 8000)); // clamp 5000k-8000k (qualidade alta)

      console.log(`[storage] duração: ${duration.toFixed(0)}s, bitrate alvo: ${finalBitrate}kbps`);

      try {
        await new Promise<void>((resolve, reject) => {
          ffmpeg(inputPath)
            .outputOptions([
              `-b:v ${finalBitrate}k`,
              '-c:v libx264',
              '-preset ultrafast',
              '-c:a aac',
              '-b:a 96k',
              '-movflags +faststart',
              '-vf scale=trunc(iw/2)*2:trunc(ih/2)*2',
              '-y',
            ])
            .output(compressedPath)
            .on('end', () => resolve())
            .on('error', (e: any) => reject(e))
            .run();
        });
        const compStat = fs.statSync(compressedPath);
        console.log(`[storage] comprimido: ${(compStat.size / 1024 / 1024).toFixed(1)}MB`);
        if (compStat.size > 49 * 1024 * 1024) {
          console.warn('[storage] compressão insuficiente, pulando upload');
          try { fs.unlinkSync(compressedPath); } catch {}
          return null;
        }
        return compressedPath;
      } catch (e: any) {
        console.error('[storage] compress failed:', e.message);
        try { fs.unlinkSync(compressedPath); } catch {}
        return null;
      }
    }

    async function uploadToStorage(localPath: string, storagePath: string, mimeType = 'video/mp4'): Promise<string | null> {
      try {
        const stat = fs.statSync(localPath);
        const sizeMB = stat.size / 1024 / 1024;

        let fileToUpload = localPath;
        // If file is too large, compress it first (only for video)
        if (stat.size > 45 * 1024 * 1024 && mimeType.startsWith('video/')) {
          const jobId = path.basename(storagePath).replace(/\.[^.]+$/, '');
          const compressed = await compressForUpload(localPath, `upload_${Date.now()}`);
          if (!compressed) {
            console.log(`[storage] arquivo ${sizeMB.toFixed(1)}MB — não foi possível comprimir, pulando upload`);
            return null;
          }
          fileToUpload = compressed;
        } else if (stat.size > 45 * 1024 * 1024) {
          console.log(`[storage] arquivo ${sizeMB.toFixed(1)}MB > 45MB (não-vídeo) — pulando upload`);
          return null;
        }

        const buffer = fs.readFileSync(fileToUpload);
        const { error } = await storageSupa.storage.from(VIDEO_BUCKET).upload(storagePath, buffer, {
          contentType: mimeType,
          upsert: true,
        });

        // Clean up compressed file if different from original
        if (fileToUpload !== localPath) {
          try { fs.unlinkSync(fileToUpload); } catch {}
        }

        if (error) { console.error('[storage] upload error:', error.message); return null; }
        const { data } = storageSupa.storage.from(VIDEO_BUCKET).getPublicUrl(storagePath);
        console.log(`[storage] upload OK: ${(buffer.length / 1024 / 1024).toFixed(1)}MB → ${storagePath}`);
        return data.publicUrl;
      } catch (e: any) {
        console.error('[storage] upload failed:', e.message);
        return null;
      }
    }

    const videoJobs: Record<string, any> = {};
    const videoProgress: Record<string, any> = {};

    // ── Jobs index: persiste na nuvem (Supabase Storage) ────────────────────
    async function saveJobMeta(jobId: string) {
      const job = videoJobs[jobId];
      if (!job) return;
      const meta = {
        jobId,
        filename:            job.filename            || 'video.mp4',
        createdAt:           job.createdAt           || new Date().toISOString(),
        transcription:       job.transcription       || null,
        segments:            job.segments            || null,
        analysis:            job.analysis            || null,
        originalSupabaseUrl: job.originalSupabaseUrl || null,
        editedSupabaseUrl:   job.editedSupabaseUrl   || null,
        thumbnailSupabaseUrl:job.thumbnailSupabaseUrl || null,
        status: job.analysis ? 'analyzed' : job.segments ? 'transcribed' : 'uploaded',
      };
      try {
        const buf = Buffer.from(JSON.stringify(meta));
        const { error } = await storageSupa.storage.from(VIDEO_BUCKET)
          .upload(`meta/${jobId}.json`, buf, { contentType: 'application/json', upsert: true });
        if (error) console.error('[meta] save error:', error.message);
      } catch (e: any) { console.error('[meta] save failed:', e.message); }
    }

    // Load jobs from Supabase on startup (background)
    (async () => {
      try {
        const { data: files, error } = await storageSupa.storage.from(VIDEO_BUCKET).list('meta', { limit: 50 });
        if (error || !files?.length) return;
        let restored = 0;
        for (const file of files) {
          try {
            const { data } = await storageSupa.storage.from(VIDEO_BUCKET).download(`meta/${file.name}`);
            if (!data) continue;
            const meta = JSON.parse(await data.text());
            if (!meta.jobId) continue;
            videoJobs[meta.jobId] = {
              ...meta,
              originalPath: null,   // arquivo local não existe após reinício
              processedPath: null,
              editedPath: null,
            };
            restored++;
          } catch {}
        }
        if (restored > 0) console.log(`[video-editor] ${restored} jobs restaurados da nuvem`);
        // NOTE: NÃO tentamos upload/compressão dos jobs restaurados.
        // O upload para Supabase acontece SOMENTE quando ensureVideoPublicUrl() é chamada.
      } catch (e: any) { console.error('[video-editor] erro ao restaurar da nuvem:', e.message); }
    })();

    const videoStorage = multer.diskStorage({
      destination: (_req: any, _file: any, cb: any) => cb(null, VIDEO_UPLOADS_DIR),
      filename: (_req: any, file: any, cb: any) => cb(null, `${Date.now()}-${file.originalname}`),
    });
    const upload = multer({ storage: videoStorage });

    const musicStorage = multer.diskStorage({
      destination: (_req: any, _file: any, cb: any) => cb(null, VIDEO_UPLOADS_DIR),
      filename: (_req: any, file: any, cb: any) => {
        const ext = path.extname(file.originalname) || '.mp3';
        cb(null, `music_${Date.now()}${ext}`);
      },
    });
    const musicUpload = multer({ storage: musicStorage, limits: { fileSize: 50 * 1024 * 1024 } });

    app.post('/api/video-editor/upload', upload.single('video'), async (req: any, res: any) => {
      if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
      const jobId = uuidv4();
      const ext = path.extname(req.file.originalname) || '.mp4';
      videoJobs[jobId] = {
        jobId,
        originalPath: req.file.path,
        filename:     req.file.originalname,
        createdAt:    new Date().toISOString(),
      };

      res.json({ jobId, filename: req.file.originalname });

      // Generate thumbnail → upload to Supabase in background
      const thumbPath = path.join(VIDEO_PROCESSED_DIR, `${jobId}_thumb.jpg`);
      ffmpeg(req.file.path)
        .seekInput(0.5).frames(1).videoFilter('scale=180:-1').outputOptions(['-q:v', '8']).output(thumbPath)
        .on('end', async () => {
          const thumbUrl = await uploadToStorage(thumbPath, `thumbs/${jobId}.jpg`, 'image/jpeg');
          if (thumbUrl) videoJobs[jobId].thumbnailSupabaseUrl = thumbUrl;
          try { fs.unlinkSync(thumbPath); } catch {}
          void saveJobMeta(jobId);
        })
        .on('error', () => void saveJobMeta(jobId))
        .run();

      // Upload to Supabase DEFERRED — only happens when Creatomate needs the URL
      // This avoids compressing 200MB+ videos on upload (which freezes the Mac)
      console.log('[video-editor] Upload concluído (local). Compressão adiada para quando necessário.');
    });

    app.post('/api/video-editor/music/:jobId', musicUpload.single('music'), (req: any, res: any) => {
      const job = videoJobs[req.params.jobId];
      if (!job) return res.status(404).json({ error: 'Job não encontrado.' });
      if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo de música enviado.' });
      job.musicPath = req.file.path;
      res.json({ ok: true });
    });

    app.get('/api/video-editor/progress/:jobId', (req: any, res: any) => {
      res.json(videoProgress[req.params.jobId] || { step: 'idle', percent: 0 });
    });

    app.post('/api/video-editor/normalize/:jobId', (req: any, res: any) => {
      const job = videoJobs[req.params.jobId];
      if (!job) return res.status(404).json({ error: 'Job não encontrado.' });
      if (!job.originalPath) return res.status(400).json({ error: 'Arquivo de vídeo não está no servidor. Faça o upload novamente.' });
      const { jobId } = req.params;
      const outputFile = `${jobId}_normalized.mp4`;
      const outputPath = path.join(VIDEO_PROCESSED_DIR, outputFile);
      videoProgress[jobId] = { step: 'normalize', percent: 0, status: 'processing' };

      // Respond immediately — FFmpeg runs in background
      res.json({ status: 'processing' });

      // Use stream copy (no re-encoding) — fast and avoids codec issues
      const proc = ffmpeg(job.originalPath)
        .outputOptions(['-c copy', '-movflags +faststart'])
        .output(outputPath)
        .on('progress', (p: any) => {
          const pct = p.percent && p.percent > 0 ? Math.min(Math.round(p.percent), 99) : 50;
          videoProgress[jobId] = { step: 'normalize', percent: pct, status: 'processing' };
        })
        .on('end', () => {
          videoProgress[jobId] = { step: 'normalize', percent: 100, status: 'done' };
          videoJobs[jobId].processedFile = outputFile;
          videoJobs[jobId].processedPath = outputPath;
        })
        .on('error', (err: any) => {
          // On copy failure, just use original file directly
          videoProgress[jobId] = { step: 'normalize', percent: 100, status: 'done' };
          videoJobs[jobId].processedPath = job.originalPath;
        });

      proc.run();

      // Safety timeout: if FFmpeg hangs for 2 minutes, mark as done using original file
      setTimeout(() => {
        if (videoProgress[jobId]?.status === 'processing') {
          proc.kill('SIGKILL');
          videoProgress[jobId] = { step: 'normalize', percent: 100, status: 'done' };
          videoJobs[jobId].processedPath = job.originalPath;
        }
      }, 120_000);
    });

    app.post('/api/video-editor/transcribe/:jobId', async (req: any, res: any) => {
      const job = videoJobs[req.params.jobId];
      if (!job) return res.status(404).json({ error: 'Job não encontrado.' });
      const { jobId } = req.params;
      const audioPath = path.join(VIDEO_PROCESSED_DIR, `${jobId}_audio.mp3`);
      const videoPath = job.processedPath || job.originalPath;
      try {
        videoProgress[jobId] = { step: 'transcribe', percent: 10, label: 'Extraindo áudio...' };

        // Extract audio — if fails (no audio track), treat as silent video
        let audioExtracted = false;
        try {
          await new Promise<void>((resolve, reject) => {
            ffmpeg(videoPath)
              .noVideo()
              .audioCodec('libmp3lame')
              .audioBitrate('128k')
              .output(audioPath)
              .on('progress', (p: any) => {
                videoProgress[jobId] = { step: 'transcribe', percent: Math.min(10 + Math.round((p.percent || 0) * 0.3), 40), label: 'Extraindo áudio...' };
              })
              .on('end', () => resolve())
              .on('error', (e: any) => reject(e))
              .run();
          });
          audioExtracted = fs.existsSync(audioPath) && fs.statSync(audioPath).size > 1000;
        } catch (audioErr: any) {
          console.warn('[video-editor] audio extraction failed (no audio track?):', audioErr.message);
        }

        if (!audioExtracted) {
          // No audio track — skip transcription, continue with empty result
          videoJobs[jobId].transcription = '';
          videoJobs[jobId].segments = [];
          videoProgress[jobId] = { step: 'transcribe', percent: 100, label: 'Sem áudio — análise por metadados.' };
          return res.json({ text: '', segments: [] });
        }

        videoProgress[jobId] = { step: 'transcribe', percent: 50, label: 'Transcrevendo com Whisper...' };
        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        const transcription = await openai.audio.transcriptions.create({
          file: fs.createReadStream(audioPath),
          model: 'whisper-1',
          response_format: 'verbose_json',
          timestamp_granularities: ['word'],
        });
        const segments = ((transcription as any).words || []).map((w: any) => ({ word: w.word, start: w.start, end: w.end }));
        videoJobs[jobId].transcription = transcription.text;
        videoJobs[jobId].segments = segments;
        videoProgress[jobId] = { step: 'transcribe', percent: 100, label: 'Transcrição concluída!' };
        try { fs.unlinkSync(audioPath); } catch {}
        res.json({ text: transcription.text, segments });
      } catch (err: any) {
        videoProgress[jobId] = { step: 'transcribe', percent: 0, error: err.message };
        res.status(500).json({ error: err.message });
      }
    });

    app.post('/api/video-editor/analyze/:jobId', async (req: any, res: any) => {
      const job = videoJobs[req.params.jobId];
      if (!job) return res.status(404).json({ error: 'Job não encontrado.' });
      const { jobId } = req.params;
      const segments = job.segments || [];
      const transcriptionWithIndices = segments.map((s: any, i: number) => `[${i}] ${s.word}`).join(' ');
      const hasTranscription = transcriptionWithIndices.trim().length > 0;
      const prompt = hasTranscription
        ? `Você é um editor de vídeo profissional. Analise a transcrição abaixo e crie um plano de edição.\n\nTranscrição (com índices de legenda):\n${transcriptionWithIndices}\n\nRetorne um JSON com exatamente esta estrutura:\n{\n  "narrativeFormat": "educativo|storytelling|lista|comparativo|cta|tutorial|depoimento",\n  "colorPalette": { "primary": "#hex", "secondary": "#hex", "accent": "#hex", "background": "#hex" },\n  "scenes": [{ "id": 1, "type": "A|B|C|D|E|F|G|H|I", "startLeg": 0, "title": "texto principal", "subtitle": "texto secundário", "icon": "emoji", "duration": 3 }]\n}\nTipos: A=Tela cheia, B=Texto embaixo, C=Painel+rosto, D=Comparativo, E=Card numerado, F=WhatsApp, G=Número, H=Fluxo, I=CTA\nCrie entre 6 e 10 cenas. Responda APENAS com o JSON, sem markdown.`
        : `Você é um editor de vídeo profissional. Crie um plano de edição genérico para um vídeo chamado "${job.filename || 'video.mp4'}". Não há transcrição disponível (vídeo sem áudio ou sem fala).\n\nRetorne um JSON com exatamente esta estrutura:\n{\n  "narrativeFormat": "educativo|storytelling|lista|comparativo|cta|tutorial|depoimento",\n  "colorPalette": { "primary": "#hex", "secondary": "#hex", "accent": "#hex", "background": "#hex" },\n  "scenes": [{ "id": 1, "type": "A|B|C|D|E|F|G|H|I", "startLeg": 0, "title": "texto principal", "subtitle": "texto secundário", "icon": "emoji", "duration": 3 }]\n}\nTipos: A=Tela cheia, B=Texto embaixo, C=Painel+rosto, D=Comparativo, E=Card numerado, F=WhatsApp, G=Número, H=Fluxo, I=CTA\nCrie entre 6 e 10 cenas com conteúdo inspirador/visual. Responda APENAS com o JSON, sem markdown.`;
      try {
        videoProgress[jobId] = { step: 'analyze', percent: 20, label: 'Enviando para IA...' };
        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

        const completion = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          max_tokens: 2048,
          messages: [{ role: 'user', content: prompt }],
          response_format: { type: 'json_object' },
        });

        videoProgress[jobId] = { step: 'analyze', percent: 90, label: 'Processando resposta...' };
        const rawText = (completion.choices[0].message.content || '').trim();
        const jsonStr = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
        const analysis = JSON.parse(jsonStr);
        videoJobs[jobId].analysis = analysis;
        videoProgress[jobId] = { step: 'analyze', percent: 100, label: 'Análise concluída!' };
        void saveJobMeta(jobId);
        res.json(analysis);
      } catch (err: any) {
        const msg = err?.message || String(err);
        console.error('[video-editor] analyze error:', msg);
        videoProgress[jobId] = { step: 'analyze', percent: 0, error: msg };
        res.status(500).json({ error: msg });
      }
    });

    app.get('/api/video-editor/video/:jobId', (req: any, res: any) => {
      const job = videoJobs[req.params.jobId];
      if (!job) return res.status(404).json({ error: 'Job não encontrado.' });
      const videoPath = job.processedPath || job.originalPath;
      if (!videoPath || !fs.existsSync(videoPath)) return res.status(404).json({ error: 'Arquivo não encontrado.' });
      const stat = fs.statSync(videoPath);
      const range = req.headers.range;
      if (range) {
        const [startStr, endStr] = range.replace(/bytes=/, '').split('-');
        const start = parseInt(startStr, 10);
        const end = endStr ? parseInt(endStr, 10) : stat.size - 1;
        res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, 'Content-Type': 'video/mp4' });
        fs.createReadStream(videoPath, { start, end }).pipe(res);
      } else {
        res.writeHead(200, { 'Content-Length': stat.size, 'Content-Type': 'video/mp4' });
        fs.createReadStream(videoPath).pipe(res);
      }
    });

    function generateAssSubtitles(
      segments: { word: string; start: number; end: number }[],
      cfg: { fontSize: number; color: string; position: string }
    ): string {
      if (!segments.length) return '';
      const alignment = cfg.position === 'top' ? 8 : cfg.position === 'middle' ? 5 : 2;
      const marginV = cfg.position === 'top' ? 80 : cfg.position === 'middle' ? 0 : 60;
      const hex = (cfg.color || '#FFFFFF').replace('#', '').padEnd(6, 'F');
      const r = hex.slice(0, 2); const g = hex.slice(2, 4); const b = hex.slice(4, 6);
      const assColor = `&H00${b}${g}${r}`;
      const header = `[Script Info]\nScriptType: v4.00+\nPlayResX: 1080\nPlayResY: 1920\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Arial,${cfg.fontSize},${assColor},&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,3,1,${alignment},10,10,${marginV},1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;
      const lines: { text: string; start: number; end: number }[] = [];
      let words: string[] = [];
      let lineStart = segments[0].start;
      for (let i = 0; i < segments.length; i++) {
        words.push(segments[i].word.trim());
        const nextGap = i < segments.length - 1 ? segments[i + 1].start - segments[i].end : 99;
        if (words.length >= 5 || nextGap > 0.4 || i === segments.length - 1) {
          lines.push({ text: words.join(' '), start: lineStart, end: segments[i].end + 0.05 });
          words = [];
          if (i < segments.length - 1) lineStart = segments[i + 1].start;
        }
      }
      const fmt = (s: number) => {
        const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60), cs = Math.floor((s % 1) * 100);
        return `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}.${String(cs).padStart(2,'0')}`;
      };
      return header + '\n' + lines.map(l => `Dialogue: 0,${fmt(l.start)},${fmt(l.end)},Default,,0,0,0,,${l.text}`).join('\n') + '\n';
    }

    app.post('/api/video-editor/render/:jobId', async (req: any, res: any) => {
      const job = videoJobs[req.params.jobId];
      if (!job) return res.status(404).json({ error: 'Job não encontrado.' });

      const { jobId } = req.params;
      const effects = req.body?.effects || {};
      const silenceCfg = effects.silenceCut ?? { enabled: true, gap: 0.5, pad: 0.2 };
      const zoomCfg    = effects.zoom     ?? { enabled: false, intensity: 0.05 };
      const captionCfg = effects.captions ?? { enabled: false, fontSize: 28, color: '#FFFFFF', position: 'bottom' };
      const musicCfg   = effects.music    ?? { enabled: false, volume: 15 };

      const words: { word: string; start: number; end: number }[] = job.segments || [];
      const inputPath  = job.processedPath || job.originalPath;
      const cutPath    = path.join(VIDEO_PROCESSED_DIR, `${jobId}_cut.mp4`);
      const outputPath = path.join(VIDEO_PROCESSED_DIR, `${jobId}_edited.mp4`);

      if (!inputPath) {
        return res.status(400).json({ error: 'Arquivo de vídeo não encontrado no servidor. Faça o upload novamente.' });
      }

      videoProgress[jobId] = { step: 'render', percent: 0, status: 'processing', label: 'Preparando...' };
      res.json({ status: 'processing' });

      try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch {}

      try {
        // ── PASS 1: Cut silences (concat demuxer, stream copy) ───────────────
        if (silenceCfg.enabled && words.length > 0) {
          const GAP = silenceCfg.gap ?? 0.5;
          const PAD = silenceCfg.pad ?? 0.2;
          const segs: { start: number; end: number }[] = [];
          let segStart = Math.max(0, words[0].start - PAD);
          let segEnd   = words[0].end + PAD;
          for (let i = 1; i < words.length; i++) {
            if (words[i].start - words[i - 1].end > GAP) {
              segs.push({ start: segStart, end: segEnd });
              segStart = Math.max(0, words[i].start - PAD);
            }
            segEnd = words[i].end + PAD;
          }
          segs.push({ start: segStart, end: segEnd });

          videoProgress[jobId] = { step: 'render', percent: 10, status: 'processing', label: `Cortando ${segs.length} trechos de fala...` };

          const concatFile = path.join(VIDEO_PROCESSED_DIR, `${jobId}_concat.txt`);
          const escapedInput = inputPath.replace(/\\/g, '/').replace(/'/g, "'\\''");
          fs.writeFileSync(concatFile,
            segs.map(s => `file '${escapedInput}'\ninpoint ${s.start.toFixed(3)}\noutpoint ${s.end.toFixed(3)}`).join('\n')
          );
          await new Promise<void>((resolve, reject) => {
            ffmpeg().input(concatFile).inputOptions(['-f concat', '-safe 0'])
              .outputOptions(['-c copy', '-movflags +faststart']).output(cutPath)
              .on('end', () => resolve()).on('error', (e: any) => reject(e)).run();
          });
          try { fs.unlinkSync(concatFile); } catch {}
        } else {
          fs.copyFileSync(inputPath, cutPath);
        }

        videoProgress[jobId] = { step: 'render', percent: 35, status: 'processing', label: 'Aplicando efeitos...' };

        // ── PASS 2: Effects (zoom + captions + music) ────────────────────────
        const hasZoom     = zoomCfg.enabled;
        const hasCaptions = captionCfg.enabled && words.length > 0;
        const hasMusic    = musicCfg.enabled && job.musicPath && fs.existsSync(job.musicPath);
        const hasVideoFx  = hasZoom || hasCaptions;

        if (!hasVideoFx && !hasMusic) {
          fs.renameSync(cutPath, outputPath);
        } else {
          let cmd: any = ffmpeg(cutPath);
          if (hasMusic) cmd = cmd.input(job.musicPath);

          // Build video filter chain
          const vf: string[] = [];
          if (hasZoom) {
            const s = (1 + Math.min(Math.max(zoomCfg.intensity ?? 0.05, 0.01), 0.5)).toFixed(4);
            // trunc to nearest even pixel — prevents flickering from non-integer dimensions
            vf.push(`scale=trunc(iw*${s}/2)*2:trunc(ih*${s}/2)*2,crop=trunc(iw/${s}/2)*2:trunc(ih/${s}/2)*2`);
          }
          if (hasCaptions) {
            const assPath = path.join(VIDEO_PROCESSED_DIR, `${jobId}_captions.ass`);
            fs.writeFileSync(assPath, generateAssSubtitles(words, {
              fontSize: captionCfg.fontSize ?? 28,
              color:    captionCfg.color    ?? '#FFFFFF',
              position: captionCfg.position ?? 'bottom',
            }), 'utf8');
            const esc = assPath.replace(/\\/g, '/').replace(/:/g, '\\:');
            vf.push(`ass='${esc}'`);
          }

          const vol = Math.min(Math.max((musicCfg.volume ?? 15) / 100, 0.01), 1.5).toFixed(3);
          const onProg = (p: any) => {
            videoProgress[jobId] = { step: 'render', percent: Math.min(35 + Math.round((p.percent || 0) * 0.5), 88), status: 'processing', label: 'Renderizando efeitos...' };
          };

          if (hasVideoFx && !hasMusic) {
            await new Promise<void>((resolve, reject) => {
              cmd.videoFilter(vf.join(','))
                .outputOptions(['-c:v libx264', '-crf 23', '-preset fast', '-c:a copy', '-movflags +faststart'])
                .output(outputPath)
                .on('progress', onProg).on('end', () => resolve()).on('error', (e: any) => reject(e)).run();
            });
          } else if (!hasVideoFx && hasMusic) {
            await new Promise<void>((resolve, reject) => {
              cmd.outputOptions([
                '-filter_complex', `[1:a]aloop=loop=-1:size=2147483647,volume=${vol}[bgm];[0:a][bgm]amix=inputs=2:duration=first[outa]`,
                '-map', '0:v', '-map', '[outa]',
                '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart',
              ]).output(outputPath)
                .on('progress', onProg).on('end', () => resolve()).on('error', (e: any) => reject(e)).run();
            });
          } else {
            // Both video and audio effects
            const vPart = `[0:v]${vf.join(',')}[outv]`;
            const aPart = `[1:a]aloop=loop=-1:size=2147483647,volume=${vol}[bgm];[0:a][bgm]amix=inputs=2:duration=first[outa]`;
            await new Promise<void>((resolve, reject) => {
              cmd.outputOptions([
                '-filter_complex', `${vPart};${aPart}`,
                '-map', '[outv]', '-map', '[outa]',
                '-c:v', 'libx264', '-crf', '23', '-preset', 'fast',
                '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart',
              ]).output(outputPath)
                .on('progress', onProg).on('end', () => resolve()).on('error', (e: any) => reject(e)).run();
            });
          }

          try { if (fs.existsSync(cutPath)) fs.unlinkSync(cutPath); } catch {}
        }

        videoJobs[jobId].editedPath = outputPath;
        videoProgress[jobId] = { step: 'render', percent: 90, status: 'processing', label: 'Salvando na nuvem...' };

        const supabasePath = `edited/${jobId}/video-editado.mp4`;
        const publicUrl = await uploadToStorage(outputPath, supabasePath, 'video/mp4');
        if (publicUrl) videoJobs[jobId].editedSupabaseUrl = publicUrl;

        videoProgress[jobId] = { step: 'render', percent: 100, status: 'done' };
        void saveJobMeta(jobId);
      } catch (err: any) {
        console.error('[video-editor] render error:', err.message);
        videoProgress[jobId] = { step: 'render', percent: 0, status: 'error', error: err.message };
      }
    });

    app.get('/api/video-editor/render-progress/:jobId', (req: any, res: any) => {
      res.json(videoProgress[req.params.jobId] || { step: 'idle', percent: 0, status: 'idle' });
    });
    
    // ═══════════════════════════════════════════════════════════════════════
    // CREATOMATE ROUTES — Cloud video editing with auto-subtitles
    // ═══════════════════════════════════════════════════════════════════════

    const CREATOMATE_API_KEY = process.env.CREATOMATE_API_KEY || '';
    const PEXELS_API_KEY = process.env.PEXELS_API_KEY || '';
    const creatomateJobs: Record<string, {
      renderId?: string;
      status: string;
      url?: string;
      error?: string;
      progress?: number;
      label?: string;
    }> = {};

    async function ensureVideoPublicUrl(jobId: string): Promise<string | null> {
      const job = videoJobs[jobId];
      if (!job) return null;

      // Already have a Supabase URL? Use it
      if (job.originalSupabaseUrl) return job.originalSupabaseUrl;

      // No Supabase URL yet — upload now (with compression if needed)
      if (job.originalPath && fs.existsSync(job.originalPath)) {
        console.log('[creatomate] vídeo sem URL pública — fazendo upload para Supabase...');
        const ext = path.extname(job.filename || '.mp4') || '.mp4';
        const storagePath = `uploads/${jobId}/original${ext}`;
        const publicUrl = await uploadToStorage(job.originalPath, storagePath, 'video/mp4');
        if (publicUrl) {
          job.originalSupabaseUrl = publicUrl;
          void saveJobMeta(jobId);
          console.log('[creatomate] upload concluído:', publicUrl);
          return publicUrl;
        }
      }

      // If running on Render (not localhost), use Render URL as last resort
      if (process.env.SERVER_URL && job.originalPath) {
        return `${process.env.SERVER_URL}/api/video-editor/video/${jobId}`;
      }

      return null;
    }


    // ═══════════════════════════════════════════════════════════════════════
    // PEXELS B-ROLL SEARCH
    // ═══════════════════════════════════════════════════════════════════════
    async function searchPexelsVideos(query: string, count = 3): Promise<string[]> {
      if (!PEXELS_API_KEY) { console.warn('[pexels] sem API key'); return []; }
      try {
        const res = await fetch(`https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=${count}&size=small&orientation=portrait`, {
          headers: { Authorization: PEXELS_API_KEY },
        });
        if (!res.ok) { console.warn('[pexels] erro:', res.status); return []; }
        const data = await res.json();
        return (data.videos || []).map((v: any) => {
          const files = v.video_files || [];
          const best = files.find((f: any) => f.width >= 720 && f.width <= 1080 && f.quality === 'hd')
            || files.find((f: any) => f.quality === 'hd')
            || files[0];
          return best?.link || '';
        }).filter(Boolean);
      } catch (e: any) {
        console.warn('[pexels] fetch error:', e.message);
        return [];
      }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // AI EDIT PLAN GENERATOR
    // ═══════════════════════════════════════════════════════════════════════
    async function generateEditPlan(jobId: string, transcription: string, segments: any[], editOptions: any) {
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const wordTimeline = segments.map((s: any, i: number) => `[${i}] ${s.word} (${s.start.toFixed(2)}-${s.end.toFixed(2)})`).join(' ');
      const totalDur = segments.length > 0 ? segments[segments.length - 1].end.toFixed(1) : '30';

      const prompt = `Você é um editor de vídeo profissional para Reels/TikTok. Analise a transcrição e crie um plano de edição.

Transcrição com timestamps:
${wordTimeline || '(sem fala detectada)'}

Duração total: ${totalDur}s

Opções do usuário:
- Cortes automáticos (remover silêncio): ${editOptions.autoCut ? 'SIM' : 'NÃO'}
- Zoom dinâmico: ${editOptions.dynamicZoom ? 'SIM' : 'NÃO'}
- B-roll automático: ${editOptions.broll ? 'SIM' : 'NÃO'}
- Efeitos sonoros: ${editOptions.sfx ? 'SIM' : 'NÃO'}
- Transições: ${editOptions.transitions ? 'SIM' : 'NÃO'}
- Tipo de transição: ${editOptions.transitionType || 'fade'}

Retorne um JSON:
{
  "clips": [
    {
      "startTime": 0.0,
      "endTime": 3.5,
      "zoom": { "startScale": 100, "endScale": 120, "focusX": 50, "focusY": 40 },
      "brollQuery": "keyword em inglês ou null",
      "brollStart": 1.5,
      "brollEnd": 3.0,
      "sfx": { "type": "whoosh|pop|ding|none", "time": 0.5 },
      "transition": "fade|slide-left|slide-right|zoom-in|none"
    }
  ],
  "totalDuration": 30.0,
  "removedSilence": 5.2
}

REGRAS:
1. autoCut=SIM: remova gaps de silêncio >0.7s entre palavras.
2. dynamicZoom=SIM: zoom sutil 100→115-125% em momentos de ênfase.
3. broll=SIM: brollQuery com 1-2 palavras em INGLÊS. Máx 3 b-rolls. null nos outros.
4. sfx=SIM: efeitos em transições/impacto. Máx 4. "none" nos outros.
5. transitions=SIM: transição entre clips. Último clip = "none".
6. Crie 4-12 clips cobrindo todo o conteúdo falado.
7. NÃO pule trechos com fala.

Responda APENAS com o JSON.`;

      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        max_tokens: 3000,
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
      });

      const raw = (completion.choices[0].message.content || '').trim();
      return JSON.parse(raw);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // SFX URLS
    // ═══════════════════════════════════════════════════════════════════════
    // SFX desabilitado — URLs externas bloqueiam hotlinking no Creatomate
    // Para ativar: hospedar os MP3 no próprio Supabase Storage e colocar as URLs aqui
    const SFX_URLS: Record<string, string> = {};

    // ═══════════════════════════════════════════════════════════════════════
    // CREATOMATE RENDER — PIPELINE COMPLETO
    // ═══════════════════════════════════════════════════════════════════════
    app.post('/api/video-editor/creatomate-render/:jobId', async (req: any, res: any) => {
      const { jobId } = req.params;
      const job = videoJobs[jobId];
      if (!job) return res.status(404).json({ error: 'Job não encontrado.' });

      if (!CREATOMATE_API_KEY) {
        return res.status(500).json({ error: 'CREATOMATE_API_KEY não configurada.' });
      }

      // Retornar imediatamente para o frontend não travar
      creatomateJobs[jobId] = { status: 'processing', progress: 10, label: 'Iniciando pipeline...' };
      res.json({ ok: true, status: 'processing' });

      // Pipeline roda em background
      (async () => {
        try {
      // ── AUTO-TRANSCRIBE se ainda não foi feito ──
      if (!job.transcription && !job.segments?.length) {
        console.log('[pipeline] auto-transcribe para job', jobId);
        const audioPath = path.join(VIDEO_PROCESSED_DIR, jobId + '_audio.mp3');
        const videoPath = job.processedPath || job.originalPath;
        if (videoPath && fs.existsSync(videoPath)) {
          try {
            let audioExtracted = false;
            try {
              await new Promise((resolve, reject) => {
                ffmpeg(videoPath).noVideo().audioCodec('libmp3lame').audioBitrate('128k')
                  .output(audioPath).on('end', () => resolve(undefined)).on('error', (e) => reject(e)).run();
              });
              audioExtracted = fs.existsSync(audioPath) && fs.statSync(audioPath).size > 1000;
            } catch (ae) {
              console.warn('[pipeline] audio extraction failed:', ae.message || ae);
            }
            if (audioExtracted) {
              const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
              const transcription = await openai.audio.transcriptions.create({
                file: fs.createReadStream(audioPath), model: 'whisper-1',
                response_format: 'verbose_json', timestamp_granularities: ['word'],
              });
              job.transcription = transcription.text || '';
              job.segments = ((transcription).words || []).map((w) => ({ word: w.word, start: w.start, end: w.end }));
              console.log('[pipeline] auto-transcribe OK:', job.segments.length, 'words');
              try { fs.unlinkSync(audioPath); } catch {}
            } else {
              job.transcription = '';
              job.segments = [];
              console.log('[pipeline] sem áudio detectado, prosseguindo sem transcrição');
            }
          } catch (te) {
            console.warn('[pipeline] auto-transcribe error:', te.message || te);
            job.transcription = '';
            job.segments = [];
          }
        }
      }

      const captionsCfg = req.body?.captions || {
        enabled: true, style: 'highlight', fontSize: '9.29 vmin',
        fontFamily: 'Montserrat', fontWeight: '700', color: '#ffffff',
        strokeColor: '#000000', strokeWidth: '1.6 vmin', position: '80%', maxLength: 14,
      };

      const editOptions = req.body?.editOptions || {
        autoCut: false, dynamicZoom: false, broll: false,
        sfx: false, transitions: false, transitionType: 'fade',
      };

      const hasAdvancedEdits = editOptions.autoCut || editOptions.dynamicZoom || editOptions.broll || editOptions.sfx || editOptions.transitions;

      creatomateJobs[jobId] = { renderId: '', status: 'processing', progress: 5, label: 'Preparando vídeo...' };

      try {
        // ── STEP 1: Ensure video URL ──
        creatomateJobs[jobId] = { ...creatomateJobs[jobId], label: 'Fazendo upload do vídeo...', progress: 10 };
        const videoUrl = await ensureVideoPublicUrl(jobId);
        if (!videoUrl) {
          creatomateJobs[jobId] = { renderId: '', status: 'failed', error: 'Falha no upload do vídeo.', progress: 0 };
          return;
        }

        let elements: any[];

        if (hasAdvancedEdits) {
          // ══════════════════════════════════════════════════════════
          // ADVANCED PIPELINE: Transcribe → AI Plan → B-roll → Build
          // ══════════════════════════════════════════════════════════

          // ── STEP 2: Transcribe if needed ──
          let segments = job.segments || [];
          let transcription = job.transcription || '';

          if (!segments.length && job.originalPath && fs.existsSync(job.originalPath)) {
            creatomateJobs[jobId] = { ...creatomateJobs[jobId], label: 'Transcrevendo áudio com Whisper...', progress: 20 };

            const audioPath = path.join(VIDEO_PROCESSED_DIR, `${jobId}_audio_pipe.mp3`);
            try {
              await new Promise<void>((resolve, reject) => {
                ffmpeg(job.originalPath)
                  .noVideo().audioCodec('libmp3lame').audioBitrate('128k')
                  .output(audioPath)
                  .on('end', () => resolve()).on('error', (e: any) => reject(e)).run();
              });

              if (fs.existsSync(audioPath) && fs.statSync(audioPath).size > 1000) {
                const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
                const result = await openai.audio.transcriptions.create({
                  file: fs.createReadStream(audioPath),
                  model: 'whisper-1',
                  response_format: 'verbose_json',
                  timestamp_granularities: ['word'],
                });
                segments = ((result as any).words || []).map((w: any) => ({ word: w.word, start: w.start, end: w.end }));
                transcription = result.text;
                job.segments = segments;
                job.transcription = transcription;
                void saveJobMeta(jobId);
              }
              try { fs.unlinkSync(audioPath); } catch {}
            } catch (e: any) {
              console.warn('[pipeline] transcription failed:', e.message);
            }
          }

          // ── STEP 3: AI edit plan ──
          creatomateJobs[jobId] = { ...creatomateJobs[jobId], label: 'IA criando plano de edição...', progress: 35 };

          let editPlan: any = null;
          try {
            editPlan = await generateEditPlan(jobId, transcription, segments, editOptions);
            console.log('[pipeline] edit plan:', JSON.stringify(editPlan).slice(0, 500));
          } catch (e: any) {
            console.warn('[pipeline] AI plan failed:', e.message);
          }

          // ── STEP 4: Search B-roll ──
          const brollUrls: Record<string, string> = {};
          if (editPlan && editOptions.broll) {
            creatomateJobs[jobId] = { ...creatomateJobs[jobId], label: 'Buscando vídeos B-roll...', progress: 45 };

            const queries = [...new Set(
              (editPlan.clips || []).map((c: any) => c.brollQuery).filter(Boolean)
            )] as string[];

            for (const q of queries.slice(0, 3)) {
              const urls = await searchPexelsVideos(q, 1);
              if (urls.length > 0) brollUrls[q] = urls[0];
            }
            console.log('[pipeline] b-roll found:', Object.keys(brollUrls));
          }

          // ── STEP 5: Build Creatomate JSON (CORRECTED) ──
          creatomateJobs[jobId] = { ...creatomateJobs[jobId], label: 'Montando composição...', progress: 55 };

          if (editPlan && editPlan.clips && editPlan.clips.length > 0) {
            const clips = editPlan.clips;

            // ── Abordagem: UM vídeo principal + zoom via animations ──
            // Creatomate funciona melhor com source no nível do render, não compositions aninhadas

            const mainVideo: any = {
              type: 'video',
              source: videoUrl,
              // O vídeo toca inteiro — Creatomate cuida do trim via compositions abaixo
            };

            // Se autoCut está ligado, montamos compositions para cada clip
            if (editOptions.autoCut && clips.length > 1) {
              const compositions: any[] = [];

              clips.forEach((clip: any, idx: number) => {
                const clipDuration = clip.endTime - clip.startTime;
                if (clipDuration <= 0.1) return;

                const videoEl: any = {
                  type: 'video',
                  source: videoUrl,
                  trim_start: clip.startTime,
                  trim_duration: clipDuration,
                  fit: 'cover',
                };

                // Zoom dinâmico via Creatomate animations (formato correto)
                if (editOptions.dynamicZoom && clip.zoom && clip.zoom.startScale !== clip.zoom.endScale) {
                  videoEl.animations = [
                    {
                      type: 'scale',
                      scope: 'element',
                      start_scale: (clip.zoom.startScale / 100).toFixed(2) + '',
                      end_scale: (clip.zoom.endScale / 100).toFixed(2) + '',
                      fade: false,
                      time: 0,
                      duration: clipDuration,
                      easing: 'linear',
                    }
                  ];
                }

                const compElements: any[] = [videoEl];

                // B-roll overlay
                if (editOptions.broll && clip.brollQuery && brollUrls[clip.brollQuery]) {
                  const brollDur = Math.min(
                    (clip.brollEnd || clip.endTime) - (clip.brollStart || clip.startTime),
                    clipDuration * 0.4
                  );
                  const brollTimeInClip = Math.max(0, (clip.brollStart || clip.startTime) - clip.startTime);

                  compElements.push({
                    type: 'video',
                    source: brollUrls[clip.brollQuery],
                    time: brollTimeInClip,
                    duration: Math.max(brollDur, 1),
                    trim_duration: Math.max(brollDur, 1),
                    fit: 'cover',
                    animations: [
                      { type: 'fade', duration: 0.3, time: 'start' },
                      { type: 'fade', duration: 0.3, time: 'end', reversed: true },
                    ],
                    z_index: 2,
                  });
                }

                const comp: any = {
                  type: 'composition',
                  track: 1,
                  duration: clipDuration,
                  width: 720,
                  height: 1280,
                  fill_color: '#000000',
                  elements: compElements,
                };

                // Transição entre clips
                if (editOptions.transitions && idx > 0) {
                  const tType = clip.transition || 'fade';
                  if (tType === 'fade') {
                    comp.animations = [{ type: 'fade', duration: 0.4, time: 'start' }];
                  }
                }

                compositions.push(comp);
              });

              elements = compositions;

            } else {
              // Sem autoCut — vídeo inteiro com zoom opcional
              const videoEl: any = {
                type: 'video',
                source: videoUrl,
              };

              // Zoom suave no vídeo inteiro
              if (editOptions.dynamicZoom && clips[0]?.zoom) {
                videoEl.animations = [
                  {
                    type: 'scale',
                    scope: 'element',
                    start_scale: '1.0',
                    end_scale: '1.15',
                    fade: false,
                    duration: null,
                    easing: 'linear',
                  }
                ];
              }

              elements = [videoEl];
            }

            // ── Subtitles: transcript direto do primeiro vídeo ──
            if (captionsCfg.enabled && captionsCfg.style !== 'none') {
              // Precisamos de um vídeo nomeado para transcript_source
              // Dar nome ao primeiro vídeo ou ao vídeo no primeiro composition
              if (elements.length > 0) {
                if (elements[0].type === 'composition' && elements[0].elements?.[0]) {
                  elements[0].elements[0].name = 'Main-Video';
                } else if (elements[0].type === 'video') {
                  elements[0].name = 'Main-Video';
                }
              }

              elements.push({
                type: 'text',
                transcript_source: 'Main-Video',
                transcript_effect: captionsCfg.style === 'karaoke' ? 'karaoke'
                  : captionsCfg.style === 'bounce' ? 'bounce' : 'highlight',
                transcript_maximum_length: captionsCfg.maxLength || 14,
                y: captionsCfg.position || '80%',
                width: '81%',
                height: '35%',
                x_alignment: '50%',
                y_alignment: '50%',
                fill_color: captionsCfg.color || '#ffffff',
                stroke_color: captionsCfg.strokeColor || '#000000',
                stroke_width: captionsCfg.strokeWidth || '1.6 vmin',
                font_family: captionsCfg.fontFamily || 'Montserrat',
                font_weight: captionsCfg.fontWeight || '700',
                font_size: captionsCfg.fontSize || '9.29 vmin',
                background_color: 'rgba(216,216,216,0)',
                background_x_padding: '31%',
                background_y_padding: '17%',
                background_border_radius: '31%',
                z_index: 10,
                track: 2,
                ...(captionsCfg.style === 'highlight' ? { transcript_color: '#FFD700' } : {}),
              });
            }

          } else {
            // AI failed — fallback to simple
            elements = buildSimpleElements(videoUrl, captionsCfg);
          }

        } else {
          // ══════════════════════════════════════════════════════════
          // SIMPLE PIPELINE: just video + captions (no advanced edits)
          // ══════════════════════════════════════════════════════════
          elements = buildSimpleElements(videoUrl, captionsCfg);
        }

        // ── STEP 6: Send to Creatomate ──
        creatomateJobs[jobId] = { ...creatomateJobs[jobId], label: 'Enviando para renderização...', progress: 65 };

        console.log('[creatomate] Starting render for job', jobId, 'elements:', elements.length, 'advanced:', hasAdvancedEdits);
        console.log('[creatomate] JSON:', JSON.stringify(elements, null, 2).slice(0, 3000));

        const response = await fetch('https://api.creatomate.com/v2/renders', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${CREATOMATE_API_KEY}`,
          },
          body: JSON.stringify({ output_format: 'mp4', width: 720, height: 1280, elements }),
        });

        if (!response.ok) {
          const errText = await response.text();
          console.error('[creatomate] API error:', response.status, errText);
          creatomateJobs[jobId] = { renderId: '', status: 'failed', error: 'Creatomate: ' + errText.slice(0, 200), progress: 0 };
          return;
        }

        const data = await response.json();
        const render = Array.isArray(data) ? data[0] : data;
        const renderId = render.id;

        creatomateJobs[jobId] = { renderId, status: 'processing', progress: 70, label: 'Renderizando na nuvem...' };
        console.log('[creatomate] Render started:', renderId);

        // Poll
        const pollCreatomate = async () => {
          try {
            const statusRes = await fetch(`https://api.creatomate.com/v2/renders/${renderId}`, {
              headers: { 'Authorization': `Bearer ${CREATOMATE_API_KEY}` },
            });
            const statusData = await statusRes.json();

            if (statusData.status === 'succeeded') {
              creatomateJobs[jobId] = { renderId, status: 'succeeded', url: statusData.url, progress: 100, label: 'Vídeo pronto! 🎬' };
              console.log('[creatomate] Render succeeded:', statusData.url);
              videoJobs[jobId].editedSupabaseUrl = statusData.url;
              void saveJobMeta(jobId);
            } else if (statusData.status === 'failed') {
              creatomateJobs[jobId] = { renderId, status: 'failed', error: statusData.error_message || 'Renderização falhou', progress: 0 };
              console.error('[creatomate] Render failed:', statusData.error_message);
            } else {
              const pct = typeof statusData.progress === 'number'
                ? Math.min(70 + Math.round(statusData.progress * 30), 95)
                : Math.min((creatomateJobs[jobId]?.progress || 70) + 3, 95);
              creatomateJobs[jobId] = { renderId, status: 'processing', progress: pct, label: 'Renderizando na nuvem...' };
              setTimeout(pollCreatomate, 3000);
            }
          } catch (pollErr: any) {
            console.error('[creatomate] Poll error:', pollErr.message);
            setTimeout(pollCreatomate, 5000);
          }
        };

        setTimeout(pollCreatomate, 5000);

      } catch (err: any) {
        console.error('[creatomate] Pipeline error:', err.message, err.stack);
        creatomateJobs[jobId] = { renderId: '', status: 'failed', error: err.message, progress: 0 };
      }
    } catch (outerErr: any) {
      console.error('[creatomate] outer error:', outerErr.message);
      creatomateJobs[jobId] = { renderId: '', status: 'failed', error: outerErr.message, progress: 0 };
    }
    })();
  });

    function buildSimpleElements(videoUrl: string, captionsCfg: any): any[] {
      const els: any[] = [
        { name: 'Video-1', type: 'video', source: videoUrl },
      ];

      if (captionsCfg.enabled && captionsCfg.style !== 'none') {
        els.push({
          type: 'text',
          transcript_source: 'Video-1',
          transcript_effect: captionsCfg.style === 'karaoke' ? 'karaoke'
            : captionsCfg.style === 'bounce' ? 'bounce' : 'highlight',
          transcript_maximum_length: captionsCfg.maxLength || 14,
          y: captionsCfg.position || '80%',
          width: '81%',
          height: '35%',
          x_alignment: '50%',
          y_alignment: '50%',
          fill_color: captionsCfg.color || '#ffffff',
          stroke_color: captionsCfg.strokeColor || '#000000',
          stroke_width: captionsCfg.strokeWidth || '1.6 vmin',
          font_family: captionsCfg.fontFamily || 'Montserrat',
          font_weight: captionsCfg.fontWeight || '700',
          font_size: captionsCfg.fontSize || '9.29 vmin',
          background_color: 'rgba(216,216,216,0)',
          background_x_padding: '31%',
          background_y_padding: '17%',
          background_border_radius: '31%',
          ...(captionsCfg.style === 'highlight' ? { transcript_color: '#FFD700' } : {}),
        });
      }

      return els;
    }

    app.get('/api/video-editor/creatomate-status/:jobId', (req: any, res: any) => {
      const cJob = creatomateJobs[req.params.jobId];
      if (!cJob) return res.json({ status: 'unknown', progress: 0 });
      res.json(cJob);
    });

    // ═══════════════════════════════════════════════════════════════════════
    // ═══════════════════════════════════════════════════════════════════════

    app.get('/api/video-editor/segments/:jobId', (req: any, res: any) => {
      const job = videoJobs[req.params.jobId];
      if (!job) return res.status(404).json({ error: 'Job não encontrado.' });
      const words: { start: number; end: number }[] = job.segments || [];
      if (words.length === 0) return res.json({ segments: [], duration: 0 });
      const GAP = 0.5, PAD = 0.2;
      const segs: { start: number; end: number }[] = [];
      let segStart = Math.max(0, words[0].start - PAD), segEnd = words[0].end + PAD;
      for (let i = 1; i < words.length; i++) {
        if (words[i].start - words[i - 1].end > GAP) {
          segs.push({ start: segStart, end: segEnd });
          segStart = Math.max(0, words[i].start - PAD);
        }
        segEnd = words[i].end + PAD;
      }
      segs.push({ start: segStart, end: segEnd });
      res.json({ segments: segs });
    });

    app.get('/api/video-editor/thumb/:jobId', (req: any, res: any) => {
      const job = videoJobs[req.params.jobId];
      if (job?.thumbnailSupabaseUrl) return res.redirect(job.thumbnailSupabaseUrl);
      // Fallback: local file (may not exist after restart)
      if (job?.thumbnailPath && fs.existsSync(job.thumbnailPath)) return res.sendFile(job.thumbnailPath);
      res.status(404).send('No thumbnail');
    });

    app.delete('/api/video-editor/job/:jobId', async (req: any, res: any) => {
      const { jobId } = req.params;
      const job = videoJobs[jobId];
      if (!job) return res.status(404).json({ error: 'Job não encontrado.' });

      // Limpar arquivos locais
      try {
        if (job.originalPath && fs.existsSync(job.originalPath)) fs.unlinkSync(job.originalPath);
        if (job.editedPath && fs.existsSync(job.editedPath)) fs.unlinkSync(job.editedPath);
        if (job.thumbnailPath && fs.existsSync(job.thumbnailPath)) fs.unlinkSync(job.thumbnailPath);
      } catch (e) { /* ignore */ }

      // Limpar do Supabase (metadata)
      try {
        await storageSupa.storage.from('videos').remove(['meta/' + jobId + '.json']);
        await storageSupa.storage.from('videos').remove(['thumbs/' + jobId + '.jpg']);
        await storageSupa.storage.from('videos').remove(['uploads/' + jobId + '/original.mp4']);
        await storageSupa.storage.from('videos').remove(['uploads/' + jobId + '/original.MOV']);
      } catch (e) { /* ignore */ }

      delete videoJobs[jobId];
      delete creatomateJobs[jobId];
      console.log('[video-editor] Job deletado:', jobId);
      res.json({ ok: true });
    });

    app.get('/api/video-editor/jobs', (_req: any, res: any) => {
      const jobs = Object.values(videoJobs)
        .filter((job: any) => job.filename && job.createdAt)
        .map((job: any) => ({
          jobId:            job.jobId,
          filename:         job.filename,
          createdAt:        job.createdAt,
          hasTranscription: !!job.transcription,
          hasAnalysis:      !!job.analysis,
          hasEdited:        !!job.editedSupabaseUrl || !!(job.editedPath && fs.existsSync(job.editedPath)),
          thumbnailUrl:     job.thumbnailSupabaseUrl || null,
        }))
        .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 12);
      res.json({ jobs });
    });

    app.get('/api/video-editor/restore/:jobId', (req: any, res: any) => {
      const job = videoJobs[req.params.jobId];
      if (!job) return res.status(404).json({ error: 'Job não encontrado.' });
      const localAvailable = !!(job.originalPath && fs.existsSync(job.originalPath));
      res.json({
        jobId:          req.params.jobId,
        filename:       job.filename || 'video.mp4',
        analysis:       job.analysis       || null,
        segments:       job.segments       || null,
        transcription:  job.transcription  || null,
        hasEdited:      !!job.editedSupabaseUrl || !!(job.editedPath && fs.existsSync(job.editedPath)),
        localAvailable,
      });
    });

    app.get('/api/video-editor/edited/:jobId', (req: any, res: any) => {
      const job = videoJobs[req.params.jobId];
      if (!job) return res.status(404).json({ error: 'Job não encontrado.' });

      // Prefer Supabase URL (persistent across restarts)
      if (job.editedSupabaseUrl) return res.redirect(job.editedSupabaseUrl);

      // Fallback: serve from local disk (only works on same server session)
      if (!job.editedPath || !fs.existsSync(job.editedPath)) {
        return res.status(404).json({ error: 'Vídeo editado não encontrado. Reprocesse o vídeo.' });
      }
      const stat = fs.statSync(job.editedPath);
      const range = req.headers.range;
      if (range) {
        const [startStr, endStr] = range.replace(/bytes=/, '').split('-');
        const start = parseInt(startStr, 10);
        const end = endStr ? parseInt(endStr, 10) : stat.size - 1;
        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${stat.size}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': end - start + 1,
          'Content-Type': 'video/mp4',
        });
        fs.createReadStream(job.editedPath, { start, end }).pipe(res);
      } else {
        res.writeHead(200, {
          'Content-Length': stat.size,
          'Content-Type': 'video/mp4',
          'Content-Disposition': 'attachment; filename="video-editado.mp4"',
        });
        fs.createReadStream(job.editedPath).pipe(res);
      }
    });
  }

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

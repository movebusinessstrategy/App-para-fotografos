import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import { google } from 'googleapis';
import dotenv from 'dotenv';
import Papa from 'papaparse';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import { Readable } from 'stream';
ffmpeg.setFfmpegPath(ffmpegInstaller.path);

import * as BaileysManager from './baileys-manager.js';
import * as Asaas from './asaas-client.js';
import { initSentry } from './sentry-server.js';
import { encryptIfNeeded, decryptIfNeeded } from './lib/wa-token-crypto.js';
import crypto from 'crypto';

// Não bloqueia o boot — roda em paralelo
const sentryReady = initSentry();
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseClient, supabaseAdmin } from './supabase.js';
import { getAgentReply, DEFAULT_PERSONA, DEFAULT_OBJECTIVE, DEFAULT_KNOWLEDGE, DEFAULT_RULES } from './ai-agent.js';
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

// Transcodifica áudio webm → ogg/opus com flags de voice note para WhatsApp
function transcodeWebmToOgg(inputBase64: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const inputBuffer = Buffer.from(inputBase64, 'base64');
    const inputStream = new Readable({ read() { this.push(inputBuffer); this.push(null); } });
    const chunks: Buffer[] = [];
    const command = ffmpeg(inputStream)
      .inputFormat('webm')
      .audioCodec('libopus')
      .audioBitrate('32k')
      .audioFrequency(16000)
      .audioChannels(1)
      .outputOptions([
        '-application voip',
        '-vbr on',
        '-compression_level 10',
        '-frame_duration 60',
        '-page_duration 60000',
        '-map_metadata -1',
        '-vn',
      ])
      .format('ogg')
      .on('error', (err: any) => {
        console.error('[Transcode] ffmpeg erro:', err.message);
        reject(err);
      })
      .on('end', () => {
        const result = Buffer.concat(chunks);
        console.log('[Transcode] OK', {
          inputBytes: inputBuffer.length,
          outputBytes: result.length,
          codec: 'opus', rate: 16000, channels: 1, application: 'voip',
        });
        resolve(result);
      });
    const stream = command.pipe();
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('error', reject);
  });
}

const WAVEFORM_SAMPLE_RATE = 16000;

function extractWaveformAndDuration(oggBuffer: Buffer): Promise<{ waveform: Buffer; seconds: number }> {
  return new Promise((resolve) => {
    try {
      const chunks: Buffer[] = [];
      const inputStream = new Readable({ read() { this.push(oggBuffer); this.push(null); } });

      const command = ffmpeg(inputStream)
        .inputFormat('ogg')
        .audioFrequency(WAVEFORM_SAMPLE_RATE)
        .audioChannels(1)
        .format('s16le')
        .on('error', (err: any) => {
          console.error('[Waveform] ffmpeg erro:', err.message);
          const estimatedSec = Math.max(1, Math.round(oggBuffer.length / 8000));
          resolve({ waveform: Buffer.alloc(64, 5), seconds: estimatedSec });
        })
        .on('end', () => {
          try {
            const pcm = Buffer.concat(chunks);
            const sampleCount = pcm.length / 2;
            const realSeconds = Math.max(1, Math.round(sampleCount / WAVEFORM_SAMPLE_RATE));

            console.log('[Waveform] Duração calculada do PCM', {
              pcmBytes: pcm.length, sampleCount, sampleRate: WAVEFORM_SAMPLE_RATE, realSeconds,
            });

            const bucketSize = Math.floor(sampleCount / 64);
            if (bucketSize === 0) {
              console.warn('[Waveform] Áudio muito curto, gerando waveform mínimo');
              resolve({ waveform: Buffer.alloc(64, 5), seconds: realSeconds });
              return;
            }

            const amplitudes: number[] = [];
            for (let i = 0; i < 64; i++) {
              let sumSquares = 0;
              const start = i * bucketSize;
              const end = Math.min(start + bucketSize, sampleCount);
              const len = end - start;
              for (let j = start; j < end; j++) {
                const sample = pcm.readInt16LE(j * 2);
                const norm = sample / 32768;
                sumSquares += norm * norm;
              }
              amplitudes.push(Math.sqrt(sumSquares / len));
            }

            const maxAmp = Math.max(...amplitudes, 0.01);
            const waveform = Buffer.alloc(64);
            for (let i = 0; i < 64; i++) {
              const visual = Math.pow(amplitudes[i] / maxAmp, 0.5);
              waveform[i] = Math.max(1, Math.min(100, Math.round(visual * 100)));
            }

            console.log('[Waveform] OK', {
              seconds: realSeconds,
              waveformBytes: waveform.length,
              first10: Array.from(waveform.subarray(0, 10)),
              max: Math.max(...Array.from(waveform)),
              min: Math.min(...Array.from(waveform)),
            });

            resolve({ waveform, seconds: realSeconds });
          } catch {
            const estimatedSec = Math.max(1, Math.round(oggBuffer.length / 8000));
            resolve({ waveform: Buffer.alloc(64, 5), seconds: estimatedSec });
          }
        });

      const stream = command.pipe();
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('error', (err: any) => {
        console.error('[Waveform] stream erro:', err.message);
        const estimatedSec = Math.max(1, Math.round(oggBuffer.length / 8000));
        resolve({ waveform: Buffer.alloc(64, 5), seconds: estimatedSec });
      });
    } catch {
      resolve({ waveform: Buffer.alloc(64, 5), seconds: 1 });
    }
  });
}

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
  mediaType?: 'image' | 'audio' | 'video' | 'document';
  mediaBase64?: string;
  mediaMimetype?: string;
}

const LIVE_MESSAGE_CACHE_LIMIT = 400;
const liveWhatsAppMessagesByPhone = new Map<string, LiveWhatsAppMessage[]>();
const readUpToTimestampByPhone = new Map<string, number>();
const qrCodeByInstance = new Map<string, string>();


const normalizePhone = (value: unknown) => {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  return String(value).replace(/\D/g, '');
};

// Normaliza número brasileiro para formato internacional (55 + DDD + 9 + 8 dígitos = 13 total)
// Casos tratados:
//   13 dígitos (5543988416682)  → já correto
//   12 dígitos (554388416682)   → insert 9 after DDD  → 5543988416682
//   11 dígitos (43988416682)    → add 55              → 5543988416682
//   10 dígitos (4388416682)     → add 55 + insert 9   → 5543988416682
const normalizeBrazilianPhone = (digits: string): string => {
  if (digits.startsWith('55')) {
    if (digits.length === 12) {
      return digits.slice(0, 4) + '9' + digits.slice(4);
    }
    return digits; // 13 = correto; outros formatos raros: retorna sem alterar
  }
  if (digits.length === 11) return '55' + digits;
  if (digits.length === 10) return '55' + digits.slice(0, 2) + '9' + digits.slice(2);
  return digits;
};

// ─── Follow-up automático: agendamento respeitando horário de silêncio ───────
// Brasil = UTC-3 (sem horário de verão desde 2019)
const BRT_OFFSET_MS = 3 * 60 * 60 * 1000;

function computeScheduledAt(delayHours: number): Date {
  const now = new Date();
  const scheduled = new Date(now.getTime() + delayHours * 3600 * 1000);

  // Converte para horário de Brasília para checar janela de silêncio (22h-07h)
  const scheduledBRT = new Date(scheduled.getTime() - BRT_OFFSET_MS);
  const hourBRT = scheduledBRT.getUTCHours();

  if (hourBRT >= 22 || hourBRT < 7) {
    const adjusted = new Date(scheduledBRT);
    if (hourBRT >= 22) adjusted.setUTCDate(adjusted.getUTCDate() + 1);
    adjusted.setUTCHours(7, 0, 0, 0); // 07:00 BRT
    return new Date(adjusted.getTime() + BRT_OFFSET_MS); // volta para UTC
  }
  return scheduled;
}

const parseWebhookTimestamp = (payload: any) => {
  // messageTimestamp é o campo padrão da Evolution API v2
  const candidates = [payload?.messageTimestamp, payload?.momment, payload?.moment, payload?.timestamp, payload?.ts];
  for (const candidate of candidates) {
    const parsed = Number(candidate);
    if (!Number.isFinite(parsed) || parsed <= 0) continue;
    return parsed > 1_000_000_000_000 ? parsed : parsed * 1000;
  }
  return Date.now();
};

const extractWebhookMedia = (payload: any): { type: 'image'|'audio'|'video'|'document'; base64: string; mimetype: string } | null => {
  // Evolution API v2: payload.message.imageMessage.base64
  // Outros formatos: payload.imageMessage.base64 | payload.image.base64
  const img = payload?.message?.imageMessage ?? payload?.imageMessage ?? payload?.image ?? payload?.data?.message?.imageMessage;
  if (img?.base64) return { type: 'image', base64: img.base64, mimetype: img.mimetype || 'image/jpeg' };

  const audio = payload?.message?.audioMessage ?? payload?.message?.pttMessage ?? payload?.audioMessage ?? payload?.audio ?? payload?.data?.message?.audioMessage;
  if (audio?.base64) return { type: 'audio', base64: audio.base64, mimetype: audio.mimetype || 'audio/ogg' };

  const video = payload?.message?.videoMessage ?? payload?.videoMessage ?? payload?.video ?? payload?.data?.message?.videoMessage;
  if (video?.base64) return { type: 'video', base64: video.base64, mimetype: video.mimetype || 'video/mp4' };

  const doc = payload?.message?.documentMessage ?? payload?.documentMessage ?? payload?.document ?? payload?.data?.message?.documentMessage;
  if (doc?.base64) return { type: 'document', base64: doc.base64, mimetype: doc.mimetype || 'application/octet-stream' };

  return null;
};

const extractWebhookText = (payload: any): string | null => {
  const candidates = [
    // Evolution API v2: { message: { conversation: "..." } }
    payload?.message?.conversation,
    payload?.message?.extendedTextMessage?.text,
    payload?.message?.imageMessage?.caption,
    payload?.message?.videoMessage?.caption,
    payload?.message?.documentMessage?.caption,
    payload?.message?.audioMessage?.caption,
    // Outros formatos / Z-API
    payload?.text?.message,
    payload?.extendedTextMessage?.text,
    payload?.extendedTextMessage?.description,
    payload?.image?.caption,
    payload?.video?.caption,
    payload?.document?.caption,
    payload?.caption,
    payload?.conversation,
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
    // Sempre usa supabaseAdmin para bypasses de RLS
    const db = supabaseAdmin;
    if (!db) { console.warn('[persistMessage] supabaseAdmin não disponível, abortando'); return; }
    const ts = new Date(message.timestamp).toISOString();
    const phone = normalizeBrazilianPhone(message.phone.replace(/\D/g, ''));
    const now = new Date().toISOString();
    // wa_number = número do WhatsApp conectado (o "estúdio"). Permite filtrar
    // o Inbox por número quando o usuário troca de WhatsApp.
    const waNumber = BaileysManager.getConnectedPhone(userId) || '';

    // Salva mensagem
    const msgType = message.mediaType || 'text';
    const mediaDataUrl = message.mediaBase64
      ? (message.mediaBase64.startsWith('data:')
          ? message.mediaBase64
          : `data:${message.mediaMimetype || 'image/jpeg'};base64,${message.mediaBase64}`)
      : null;

    const { error: msgErr } = await db.from('wa_messages').insert({
      user_id: userId,
      phone,
      message_id: message.id,
      body: message.text,
      from_me: message.fromMe,
      type: msgType,
      timestamp: ts,
      status: 'received',
      wa_number: waNumber,
      ...(mediaDataUrl ? { media_url: mediaDataUrl } : {}),
    });
    if (msgErr && !msgErr.message.includes('duplicate') && !msgErr.code?.includes('23505')) {
      console.error('[persistMessage] Erro ao salvar mensagem:', msgErr.message);
    }

    // Salva conversa — UPDATE primeiro, INSERT se não existir
    const convPayload: Record<string, any> = {
      user_id: userId, phone,
      last_message: message.text || `[${msgType}]`,
      last_message_at: ts,
      updated_at: now,
      wa_number: waNumber,
      ...(!message.fromMe ? { unread_count: 1 } : {}),
      ...(message.name ? { contact_name: message.name } : {}),
    };

    const { data: updated, error: updateErr } = await db
      .from('wa_conversations')
      .update(convPayload)
      .eq('user_id', userId)
      .eq('phone', phone)
      .select('id');

    if (updateErr) {
      console.error('[persistMessage] Erro ao UPDATE conversa:', updateErr.message);
    } else if (!updated || updated.length === 0) {
      const { error: insertErr } = await db.from('wa_conversations').insert(convPayload);
      if (insertErr) console.error('[persistMessage] Erro ao INSERT conversa:', insertErr.message);
      else console.log(`[persistMessage] ✅ Conversa CRIADA | phone=${phone}`);
    } else {
      console.log(`[persistMessage] ✅ Conversa ATUALIZADA | phone=${phone}`);
    }

    // Auto-criação de lead no pipeline foi desativada por escolha do usuário.
    // Conversas continuam aparecendo no Inbox; o lead só vira deal quando o usuário
    // adiciona manualmente via "Adicionar ao funil" na conversa.
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

  // CRÍTICO: NÃO usar new Date(...).toISOString() aqui — o Render roda em UTC,
  // e Date("YYYY-MM-DDTHH:MM:SS") sem timezone é interpretado como UTC local.
  // Resultado: 09:00 BRT virava 09:00 UTC = 06:00 BRT (3h mais cedo no Calendar).
  // Solução: passar a string YYYY-MM-DDTHH:MM:SS DIRETO + timeZone — o Google
  // interpreta o horário na timezone informada.
  const startTime = job.job_time || '09:00';
  const startDateTime = `${job.job_date}T${startTime}:00`;

  let endDateTime: string;
  if (job.job_end_time) {
    endDateTime = `${job.job_date}T${job.job_end_time}:00`;
  } else {
    // +1 hora sem conversão de timezone — parse manual da string HH:MM
    const [hh, mm] = startTime.split(':').map(Number);
    let endH = hh + 1;
    let endM = mm;
    if (endH >= 24) { endH = 23; endM = 59; }
    endDateTime = `${job.job_date}T${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}:00`;
  }

  const summary = client?.name
    ? `${client.name} - ${job.job_type}`
    : (job.job_name || job.job_type);

  const event = {
    summary,
    description: job.notes || (client?.name ? `Ensaio ${job.job_type} para ${client.name}` : job.job_type),
    start: { dateTime: startDateTime, timeZone: 'America/Sao_Paulo' },
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

// Extrai dígitos do telefone, retorna últimos 10-11 chars (ignora DDI)
// Usado só pelo matching de Google Calendar — não confundir com o normalizePhone
// "barebones" da linha 315 que é usado em outros lugares e retorna string vazia.
const normalizePhoneForMatch = (raw: string | null | undefined): string | null => {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length < 8) return null;
  return digits.length >= 11 ? digits.slice(-11) : digits.slice(-10);
};

// Regex pra telefone BR: opcional DDD entre parens, espaços/hífens, opcional 9, depois 4+4 dígitos
const PHONE_RE = /\(?(\d{2})\)?[\s\-]?9?\s?(\d{4})[\s\-]?(\d{4})/g;

const pullFromGoogleCalendar = async (supabase: SupabaseClient, userId: string) => {
  const auth = await getGoogleAuth(supabase, userId);
  if (!auth) return { imported: 0, linked: 0, updated: 0, skipped: 0, by_phone: 0, by_name: 0 };

  // Carrega todos os clientes do tenant pra fazer matching local
  const { data: clientsList } = await supabase
    .from('clients')
    .select('id, name, phone')
    .eq('user_id', userId);

  const phoneIndex = new Map<string, { id: number; name: string }>();
  const nameIndex = new Map<string, { id: number; name: string }>();
  for (const c of clientsList || []) {
    const np = normalizePhoneForMatch(c.phone);
    if (np) {
      phoneIndex.set(np, c);
      if (np.length >= 8) phoneIndex.set(np.slice(-8), c);
    }
    if (c.name) nameIndex.set(c.name.trim().toLowerCase(), c);
  }

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
    let imported = 0, linked = 0, updated = 0, skipped = 0, byPhone = 0, byName = 0;

    for (const event of events) {
      if (!event.id) continue;

      const { data: existingJob } = await supabase
        .from('jobs')
        .select('id, job_date, job_time, job_end_time')
        .eq('google_event_id', event.id)
        .eq('user_id', userId)
        .single();

      // Já vinculado: sincroniza horário/data se mudou no Google Calendar
      if (existingJob) {
        const start = event.start?.dateTime || event.start?.date;
        const end = event.end?.dateTime || event.end?.date;
        if (!start) { skipped++; continue; }

        const newDate = start.split('T')[0];
        const newTime = start.includes('T') ? start.split('T')[1].substring(0, 5) : null;
        const newEnd = (end && end.includes('T')) ? end.split('T')[1].substring(0, 5) : null;

        const changes: Record<string, string | null> = {};
        if (newDate !== existingJob.job_date) changes.job_date = newDate;
        if (newTime !== existingJob.job_time) changes.job_time = newTime;
        if (newEnd !== existingJob.job_end_time) changes.job_end_time = newEnd;

        if (Object.keys(changes).length > 0) {
          await supabase.from('jobs').update(changes).eq('id', existingJob.id);
          updated++;
        }
        continue;
      }

      const summary = (event.summary || '').trim() || 'Sem Título';
      const description = (event.description || '').trim();
      const text = `${summary}\n${description}`;

      // 1) Tenta match por telefone (extrai do texto livre)
      let matchedClient: { id: number; name: string } | null = null;
      let matchType: 'phone' | 'name' | null = null;

      PHONE_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = PHONE_RE.exec(text)) !== null) {
        const digits = m[1] + m[2] + m[3];
        const candidate = phoneIndex.get(digits) || phoneIndex.get(digits.slice(-8));
        if (candidate) {
          matchedClient = candidate;
          matchType = 'phone';
          break;
        }
      }

      // 2) Fallback: nome exato (formato "Nome - Tipo")
      if (!matchedClient) {
        const candidateName = summary.split(' - ')[0].trim().toLowerCase();
        const byName2 = nameIndex.get(candidateName);
        if (byName2) {
          matchedClient = byName2;
          matchType = 'name';
        }
      }

      // 3) Fallback: nome do cliente aparece como substring no summary
      if (!matchedClient) {
        const sLow = summary.toLowerCase();
        for (const [cname, cdata] of nameIndex.entries()) {
          if (cname.length >= 8 && sLow.includes(cname)) {
            matchedClient = cdata;
            matchType = 'name';
            break;
          }
        }
      }

      // Sem match → pula (não importa feriado/tarefa pessoal)
      if (!matchedClient) {
        skipped++;
        continue;
      }

      const start = event.start?.dateTime || event.start?.date;
      const end = event.end?.dateTime || event.end?.date;
      if (!start) { skipped++; continue; }

      const startDate = start.split('T')[0];
      const startTime = start.includes('T') ? start.split('T')[1].substring(0, 5) : null;
      const endTime = (end && end.includes('T')) ? end.split('T')[1].substring(0, 5) : null;

      // Modo link-only: vincula Job existente do mesmo cliente na mesma data.
      // NUNCA cria Job novo. Eventos sem Job correspondente são ignorados.
      const { data: existingMatch } = await supabase
        .from('jobs')
        .select('id')
        .eq('user_id', userId)
        .eq('client_id', matchedClient.id)
        .eq('job_date', startDate)
        .is('google_event_id', null)
        .limit(1)
        .maybeSingle();

      if (!existingMatch) { skipped++; continue; }

      await supabase
        .from('jobs')
        .update({ google_event_id: event.id })
        .eq('id', existingMatch.id);
      linked++;
      if (matchType === 'phone') byPhone++; else byName++;
      // suprime warning "endTime declared but never used" — pode ser usado em futuro
      void startTime; void endTime;
    }

    console.log(`[google-sync] user=${userId} imported=${imported} linked=${linked} updated=${updated} skipped=${skipped} by_phone=${byPhone} by_name=${byName}`);
    return { imported, linked, updated, skipped, by_phone: byPhone, by_name: byName };
  } catch (error) {
    console.error('Error pulling from Google Calendar:', error);
    return { imported: 0, linked: 0, updated: 0, skipped: 0, by_phone: 0, by_name: 0 };
  }
};

// ============ START SERVER ============
async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  // Guarda o raw body em req.rawBody pra rotas que precisam validar HMAC
  // (webhook do Meta WhatsApp via X-Hub-Signature-256). Sem isso, JSON.stringify
  // re-serializa com formatação diferente e o hash não bate.
  app.use(express.json({
    limit: '50mb',
    verify: (req: any, _res, buf) => { req.rawBody = buf; },
  }));

  // ============ CORS — permite extensão Chrome ============
  app.use((req, res, next) => {
    const origin = req.headers.origin || '';
    const allowed = [
      'https://app-para-fotografos.vercel.app', // sempre permitido
      process.env.APP_URL,
      process.env.APP_PUBLIC_URL, // custom domain (ex: https://crmtrilha.com.br)
      'http://localhost:5173',
      'http://localhost:3000',
    ]
      .filter(Boolean)
      .map(u => (u as string).replace(/\/$/, '')) as string[]; // normaliza trailing slash
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

  // ============ DATA DELETION (LGPD + Meta App Review requirement) ============
  // 2 endpoints públicos (sem requireAuth) pra atender:
  // 1. /api/data-deletion/request — formulário em /excluir-dados (UI pro user)
  // 2. /api/data-deletion-callback — callback signed_request da Meta
  //
  // Por enquanto ambos só logam a solicitação e geram um ticket_id determinístico.
  // Processamento manual (operador apaga via Supabase Studio + responde por email).
  // TODO futuro: tabela data_deletion_requests + worker async + email automático.

  const generateDeletionTicketId = (input: string): string => {
    // Hash determinístico do input + slice — não vaza dados, só serve como protocolo único.
    return 'DEL-' + crypto.createHash('sha256').update(input + (process.env.META_APP_SECRET || 'fallback')).digest('hex').slice(0, 12).toUpperCase();
  };

  app.post('/api/data-deletion/request', async (req, res) => {
    const { email, reason, scope } = req.body || {};
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return res.status(400).json({ error: 'E-mail válido é obrigatório.' });
    }
    const requestedScope: 'all' | 'whatsapp_only' = scope === 'whatsapp_only' ? 'whatsapp_only' : 'all';
    const ticketId = generateDeletionTicketId(email + ':' + new Date().toISOString().slice(0, 10));
    // Log estruturado pro operador picar via grep nos logs do Render:
    console.log('[DataDeletion] Nova solicitação:', JSON.stringify({
      ticket_id: ticketId,
      email,
      scope: requestedScope,
      reason: (reason || '').slice(0, 500),
      received_at: new Date().toISOString(),
      ip: req.ip || req.headers['x-forwarded-for'] || 'unknown',
    }));
    res.json({
      ok: true,
      ticket_id: ticketId,
      message: `Solicitação registrada com protocolo ${ticketId}. Você receberá confirmação por e-mail em até 48 horas úteis. A exclusão completa será processada em até 15 dias úteis, conforme prazo da LGPD.`,
    });
  });

  // Meta Data Deletion Callback — formato signed_request.
  // Docs: https://developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback
  app.post('/api/data-deletion-callback', async (req, res) => {
    try {
      const signedRequest: string | undefined = req.body?.signed_request;
      if (!signedRequest || typeof signedRequest !== 'string' || !signedRequest.includes('.')) {
        return res.status(400).json({ error: 'signed_request ausente ou inválido.' });
      }
      const [encodedSig, encodedPayload] = signedRequest.split('.', 2);
      const appSecret = process.env.META_APP_SECRET;
      if (!appSecret) {
        console.error('[DataDeletion Meta] META_APP_SECRET não configurado');
        return res.status(500).json({ error: 'Servidor não configurado.' });
      }
      // base64url → bytes (Meta usa base64url sem padding)
      const b64urlToBuf = (s: string): Buffer => {
        const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
        const pad = b64.length % 4 ? '='.repeat(4 - (b64.length % 4)) : '';
        return Buffer.from(b64 + pad, 'base64');
      };
      const sigBuf = b64urlToBuf(encodedSig);
      const expectedSig = crypto.createHmac('sha256', appSecret).update(encodedPayload).digest();
      if (sigBuf.length !== expectedSig.length || !crypto.timingSafeEqual(sigBuf, expectedSig)) {
        console.warn('[DataDeletion Meta] signed_request com assinatura inválida');
        return res.status(403).json({ error: 'Assinatura inválida.' });
      }
      const payload = JSON.parse(b64urlToBuf(encodedPayload).toString('utf-8'));
      const metaUserId: string = payload?.user_id || 'unknown';
      const ticketId = generateDeletionTicketId('meta:' + metaUserId);
      console.log('[DataDeletion Meta] Callback recebido:', JSON.stringify({
        ticket_id: ticketId,
        meta_user_id: metaUserId,
        issued_at: payload?.issued_at,
        received_at: new Date().toISOString(),
      }));
      // Resposta no formato exigido pela Meta: { url, confirmation_code }
      const publicBase = (process.env.APP_PUBLIC_URL || 'https://crmtrilha.com.br').replace(/\/$/, '');
      res.json({
        url: `${publicBase}/excluir-dados?protocolo=${ticketId}`,
        confirmation_code: ticketId,
      });
    } catch (e: any) {
      console.error('[DataDeletion Meta] Erro processando callback:', e.message);
      res.status(500).json({ error: 'Erro ao processar callback.' });
    }
  });

  // ============ PLATFORM ADMIN HELPERS ============
  // Checa se um auth.users.id pertence a um super-admin do SaaS.
  const isSuperAdmin = async (userId: string): Promise<boolean> => {
    if (!supabaseAdmin) return false;
    const { data } = await supabaseAdmin
      .from('platform_admins')
      .select('user_id')
      .eq('user_id', userId)
      .maybeSingle();
    return !!data;
  };

  // Garante que existe uma linha em platform_accounts para o dono (criação lazy).
  // Retorna a conta (status, plan_id) ou null se a tabela ainda não foi criada.
  const TRIAL_DAYS = 7;

  // Paths que SEMPRE devem ser acessíveis mesmo com pagamento atrasado
  // (pra o user ver/pagar a assinatura)
  const BILLING_EXEMPT_PREFIXES = ['/api/billing/', '/api/me', '/api/platform/', '/api/team-members'];
  const isBillingExemptPath = (p: string) => BILLING_EXEMPT_PREFIXES.some((pref) => p.startsWith(pref));

  // Retorna true se a conta precisa pagar agora (sem trial ativo, sem assinatura ativa)
  const accountRequiresPayment = (acct: any): { blocked: boolean; reason?: string } => {
    if (!acct) return { blocked: false };
    const status = acct.subscription_status;
    if (status === 'active') return { blocked: false };
    if (status === 'trial') {
      if (!acct.trial_ends_at) return { blocked: false };
      const expired = new Date(acct.trial_ends_at) < new Date();
      return expired ? { blocked: true, reason: 'trial_expired' } : { blocked: false };
    }
    if (['past_due', 'cancelled', 'expired'].includes(status)) {
      return { blocked: true, reason: status };
    }
    return { blocked: false };
  };

  type LimitResource = 'clients' | 'jobs' | 'team_members';
  const LIMIT_KEY: Record<LimitResource, string> = {
    clients: 'max_clients',
    jobs: 'max_jobs',
    team_members: 'max_team_members',
  };

  // Checa se o plano permite criar mais 1 do recurso. `max=-1` significa ilimitado.
  // Retorna { allowed, current, max, planSlug } pro endpoint poder mostrar erro útil.
  const checkPlanLimit = async (
    supabase: SupabaseClient,
    ownerUserId: string,
    resource: LimitResource,
  ): Promise<{ allowed: boolean; current: number; max: number; planSlug?: string }> => {
    if (!supabaseAdmin) return { allowed: true, current: 0, max: -1 };
    const { data: acct } = await supabaseAdmin
      .from('platform_accounts')
      .select('plan_id')
      .eq('owner_user_id', ownerUserId)
      .maybeSingle();
    if (!acct?.plan_id) return { allowed: true, current: 0, max: -1 };

    const { data: plan } = await supabaseAdmin
      .from('platform_plans')
      .select('slug, limits')
      .eq('id', acct.plan_id)
      .maybeSingle();
    const max = Number(plan?.limits?.[LIMIT_KEY[resource]] ?? -1);
    if (max < 0) return { allowed: true, current: 0, max: -1, planSlug: plan?.slug };

    // Conta os ativos. Usa o supabase do request (já com user_id scoping).
    const table = resource === 'team_members' ? 'team_members' : resource;
    const column = resource === 'team_members' ? 'owner_user_id' : 'user_id';
    let q = supabase.from(table).select('id', { count: 'exact', head: true }).eq(column, ownerUserId);
    if (resource === 'team_members') q = q.eq('is_active', true);
    const { count } = await q;
    const current = count || 0;
    return { allowed: current < max, current, max, planSlug: plan?.slug };
  };

  const ensurePlatformAccount = async (ownerUserId: string) => {
    if (!supabaseAdmin) return null;
    const { data: existing, error: selErr } = await supabaseAdmin
      .from('platform_accounts')
      .select('owner_user_id, plan_id, status, suspended_reason, subscription_status, trial_ends_at')
      .eq('owner_user_id', ownerUserId)
      .maybeSingle();
    // Tabela ainda não criada (migração não aplicada) — fail-open
    if (selErr && /relation .* does not exist/i.test(selErr.message)) return null;
    if (existing) return existing;

    // Novos signups entram com 7 dias de trial no plano Pro.
    const { data: proPlan } = await supabaseAdmin
      .from('platform_plans')
      .select('id')
      .eq('slug', 'pro')
      .maybeSingle();

    const now = new Date();
    const trialEnds = new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);

    const { data: created } = await supabaseAdmin
      .from('platform_accounts')
      .insert({
        owner_user_id: ownerUserId,
        plan_id: proPlan?.id ?? null,
        status: 'active',
        subscription_status: 'trial',
        trial_started_at: now.toISOString(),
        trial_ends_at: trialEnds.toISOString(),
      })
      .select('owner_user_id, plan_id, status, suspended_reason, subscription_status, trial_ends_at')
      .single();
    return created;
  };

  const logAdminAction = async (
    adminUserId: string,
    action: string,
    targetOwnerId: string | null,
    metadata: Record<string, any> = {},
    ip: string | null = null,
  ) => {
    if (!supabaseAdmin) return;
    try {
      await supabaseAdmin.from('platform_audit_log').insert({
        admin_user_id: adminUserId,
        action,
        target_owner_id: targetOwnerId,
        metadata,
        ip,
      });
    } catch (e) {
      console.error('[platform-admin] falha ao gravar audit log:', e);
    }
  };

  // ============ AUTH MIDDLEWARE ============
  // ─── Auth cache ────────────────────────────────────────────────────
  // requireAuth fazia 3-5 queries Supabase em CADA request (validar token,
  // checar membro, checar super-admin, checar platform_account). Página
  // fazendo 5 requests = 25 queries só de auth. Cache de 30s por token
  // corta isso pra 1x.
  // Key: token bearer. Value: req fields setados + impersonação?
  // Invalidate: header de impersonação muda → cache key inclui header.
  type AuthCacheEntry = {
    userId: string;
    realUserId: string;
    isMember: boolean;
    isPlatformAdmin: boolean;
    isImpersonating: boolean;
    memberPermissions: any;
    useAdmin: boolean; // se true, usa supabaseAdmin como client
    // Account status snapshot (pra bloqueio billing)
    acctStatus: 'active' | 'suspended' | 'deleted' | null;
    payBlocked: boolean;
    payReason: string | null;
    subscriptionStatus: string | null;
    trialEndsAt: string | null;
    cachedAt: number;
  };
  const authCache = new Map<string, AuthCacheEntry>();
  const AUTH_CACHE_TTL_MS = 30_000;

  // Invalida todas as entradas de auth de um tenant (owner + members).
  // Usado quando admin suspende/reativa/troca plano — pra refletir
  // imediatamente sem esperar o TTL de 30s.
  const invalidateAuthCacheForTenant = async (ownerUserId: string) => {
    // Remove entradas onde o userId (real, sem impersonation) bate.
    // Vai pegar tanto o owner quanto qualquer member desse tenant.
    let removed = 0;
    for (const [k, v] of authCache.entries()) {
      if (v.userId === ownerUserId || v.realUserId === ownerUserId) {
        authCache.delete(k);
        removed++;
        continue;
      }
    }
    // Também busca members do tenant e remove o cache deles
    if (supabaseAdmin) {
      const { data: members } = await supabaseAdmin
        .from('team_members')
        .select('member_user_id')
        .eq('owner_user_id', ownerUserId)
        .not('member_user_id', 'is', null);
      const memberIds = new Set((members ?? []).map((m: any) => m.member_user_id));
      for (const [k, v] of authCache.entries()) {
        if (memberIds.has(v.userId) || memberIds.has(v.realUserId)) {
          authCache.delete(k);
          removed++;
        }
      }
    }
    return removed;
  };

  const requireAuth = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Não autorizado' });
    }

    const token = authHeader.substring(7);
    const impersonateMemberHeader = (req.headers['x-impersonate-member-id'] as string | undefined)?.trim();
    const impersonateOwnerHeader  = (req.headers['x-impersonate-owner-id']  as string | undefined)?.trim();
    // Cache key inclui impersonação pra não vazar contexto entre modos
    const cacheKey = `${token}|m:${impersonateMemberHeader || ''}|o:${impersonateOwnerHeader || ''}`;

    // Cache hit: pula validação + 4 queries
    const cached = authCache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < AUTH_CACHE_TTL_MS) {
      // Re-checa bloqueios billing rapidamente (snapshot do cache)
      if (cached.acctStatus && cached.acctStatus !== 'active' && !cached.isPlatformAdmin) {
        return res.status(403).json({
          error: cached.acctStatus === 'suspended' ? 'Conta suspensa' : 'Conta excluída',
          account_status: cached.acctStatus,
        });
      }
      if (!cached.isPlatformAdmin && req.method !== 'GET' && !isBillingExemptPath(req.path) && cached.payBlocked) {
        return res.status(402).json({
          error: 'Assinatura necessária pra continuar',
          subscription_status: cached.subscriptionStatus,
          reason: cached.payReason,
          trial_ends_at: cached.trialEndsAt,
        });
      }
      (req as any).userId = cached.userId;
      (req as any).realUserId = cached.realUserId;
      (req as any).isMember = cached.isMember;
      (req as any).isPlatformAdmin = cached.isPlatformAdmin;
      (req as any).isImpersonating = cached.isImpersonating;
      (req as any).memberPermissions = cached.memberPermissions;
      (req as any).supabase = cached.useAdmin && supabaseAdmin ? supabaseAdmin : createSupabaseClient(authHeader);
      return next();
    }

    const userClient = createSupabaseClient(authHeader);

    // Helper local pra salvar resultado do auth no cache
    const cacheAuth = (entry: Omit<AuthCacheEntry, 'cachedAt'>) => {
      authCache.set(cacheKey, { ...entry, cachedAt: Date.now() });
      // Limpa cache antigo periodicamente pra não vazar memória
      if (authCache.size > 500) {
        const cutoff = Date.now() - AUTH_CACHE_TTL_MS;
        for (const [k, v] of authCache.entries()) {
          if (v.cachedAt < cutoff) authCache.delete(k);
        }
      }
    };

    try {
      const { data: { user }, error } = await userClient.auth.getUser(token);
      if (error || !user) {
        return res.status(401).json({ error: 'Não autorizado' });
      }

      // ── Impersonação (apenas super-admin) ─────────────────────────────
      // Dois modos:
      //  - X-Impersonate-Member-Id  → vê como aquele membro (com as permissões dele)
      //  - X-Impersonate-Owner-Id   → vê como o dono da empresa (acesso total)
      // Membro tem prioridade — só um header é enviado por vez.
      // (já lidos antes do cache check)
      if ((impersonateMemberHeader || impersonateOwnerHeader) && supabaseAdmin) {
        const allowed = await isSuperAdmin(user.id);
        if (!allowed) {
          return res.status(403).json({ error: 'Impersonação requer super-admin' });
        }

        if (impersonateMemberHeader) {
          const { data: member } = await supabaseAdmin
            .from('team_members')
            .select('id, owner_user_id, permissions')
            .eq('id', impersonateMemberHeader)
            .maybeSingle();
          if (!member) return res.status(404).json({ error: 'Membro não encontrado' });
          (req as any).userId = member.owner_user_id;
          (req as any).realUserId = user.id;
          (req as any).isImpersonating = true;
          (req as any).isPlatformAdmin = true;
          (req as any).memberPermissions = member.permissions;
          (req as any).isMember = true;
          (req as any).supabase = supabaseAdmin;
          return next();
        }

        (req as any).userId = impersonateOwnerHeader;
        (req as any).realUserId = user.id;
        (req as any).isImpersonating = true;
        (req as any).isPlatformAdmin = true;
        (req as any).memberPermissions = null;
        (req as any).isMember = false;
        (req as any).supabase = supabaseAdmin;
        return next();
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
          const platformAdmin = await isSuperAdmin(user.id);
          // Bloqueia se a conta do dono está suspensa/excluída (super-admin escapa)
          const acct = await ensurePlatformAccount(memberById.owner_user_id);
          if (acct && acct.status !== 'active' && !platformAdmin) {
            return res.status(403).json({
              error: acct.status === 'suspended' ? 'Conta suspensa' : 'Conta excluída',
              account_status: acct.status,
            });
          }
          if (req.method !== 'GET' && !isBillingExemptPath(req.path)) {
            const pay = accountRequiresPayment(acct);
            if (pay.blocked && !platformAdmin) {
              return res.status(402).json({
                error: 'Assinatura necessária pra continuar',
                subscription_status: (acct as any)?.subscription_status,
                reason: pay.reason,
                trial_ends_at: (acct as any)?.trial_ends_at,
              });
            }
          }
          (req as any).userId = memberById.owner_user_id;
          (req as any).realUserId = user.id;
          (req as any).memberPermissions = memberById.permissions;
          (req as any).isMember = true;
          (req as any).isPlatformAdmin = platformAdmin;
          (req as any).supabase = supabaseAdmin;
          cacheAuth({
            userId: memberById.owner_user_id,
            realUserId: user.id,
            isMember: true,
            isPlatformAdmin: platformAdmin,
            isImpersonating: false,
            memberPermissions: memberById.permissions,
            useAdmin: true,
            acctStatus: (acct?.status as any) ?? null,
            payBlocked: !!accountRequiresPayment(acct)?.blocked,
            payReason: accountRequiresPayment(acct)?.reason ?? null,
            subscriptionStatus: (acct as any)?.subscription_status ?? null,
            trialEndsAt: (acct as any)?.trial_ends_at ?? null,
          });
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

            const platformAdmin = await isSuperAdmin(user.id);
            const acct = await ensurePlatformAccount(memberByEmail.owner_user_id);
            if (acct && acct.status !== 'active' && !platformAdmin) {
              return res.status(403).json({
                error: acct.status === 'suspended' ? 'Conta suspensa' : 'Conta excluída',
                account_status: acct.status,
              });
            }
            if (req.method !== 'GET' && !isBillingExemptPath(req.path)) {
              const pay = accountRequiresPayment(acct);
              if (pay.blocked && !platformAdmin) {
                return res.status(402).json({
                  error: 'Assinatura necessária pra continuar',
                  subscription_status: (acct as any)?.subscription_status,
                  reason: pay.reason,
                  trial_ends_at: (acct as any)?.trial_ends_at,
                });
              }
            }
            (req as any).userId = memberByEmail.owner_user_id;
            (req as any).realUserId = user.id;
            (req as any).memberPermissions = memberByEmail.permissions;
            (req as any).isMember = true;
            (req as any).isPlatformAdmin = platformAdmin;
            (req as any).supabase = supabaseAdmin;
            cacheAuth({
              userId: memberByEmail.owner_user_id,
              realUserId: user.id,
              isMember: true,
              isPlatformAdmin: platformAdmin,
              isImpersonating: false,
              memberPermissions: memberByEmail.permissions,
              useAdmin: true,
              acctStatus: (acct?.status as any) ?? null,
              payBlocked: !!accountRequiresPayment(acct)?.blocked,
              payReason: accountRequiresPayment(acct)?.reason ?? null,
              subscriptionStatus: (acct as any)?.subscription_status ?? null,
              trialEndsAt: (acct as any)?.trial_ends_at ?? null,
            });
            return next();
          }
        }
      }

      // ── Dono da conta ─────────────────────────────────────────────────
      // Cria/garante a platform_account e bloqueia se suspensa/excluída.
      // Super-admin nunca é bloqueado, mesmo que sua própria conta esteja suspensa.
      const acct = await ensurePlatformAccount(user.id);
      const platformAdmin = await isSuperAdmin(user.id);
      if (acct && acct.status !== 'active' && !platformAdmin) {
        return res.status(403).json({
          error: acct.status === 'suspended' ? 'Conta suspensa' : 'Conta excluída',
          account_status: acct.status,
          reason: acct.suspended_reason ?? null,
        });
      }
      // Bloqueio por pagamento: trial expirado ou assinatura cancelada/atrasada.
      // Permite GETs (leitura) e rotas de billing/me/admin/team (pra o user pagar).
      if (!platformAdmin && req.method !== 'GET' && !isBillingExemptPath(req.path)) {
        const pay = accountRequiresPayment(acct);
        if (pay.blocked) {
          return res.status(402).json({
            error: 'Assinatura necessária pra continuar',
            subscription_status: (acct as any)?.subscription_status,
            reason: pay.reason,
            trial_ends_at: (acct as any)?.trial_ends_at,
          });
        }
      }
      (req as any).userId = user.id;
      (req as any).realUserId = user.id;
      (req as any).memberPermissions = null;
      (req as any).isMember = false;
      (req as any).isPlatformAdmin = platformAdmin;
      (req as any).supabase = userClient;
      cacheAuth({
        userId: user.id,
        realUserId: user.id,
        isMember: false,
        isPlatformAdmin: platformAdmin,
        isImpersonating: false,
        memberPermissions: null,
        useAdmin: false,
        acctStatus: (acct?.status as any) ?? null,
        payBlocked: !!accountRequiresPayment(acct)?.blocked,
        payReason: accountRequiresPayment(acct)?.reason ?? null,
        subscriptionStatus: (acct as any)?.subscription_status ?? null,
        trialEndsAt: (acct as any)?.trial_ends_at ?? null,
      });
      next();
    } catch (err) {
      console.error('Erro ao validar token:', err);
      return res.status(401).json({ error: 'Não autorizado' });
    }
  };

  // ============ PERMISSION MIDDLEWARE ============
  // Requer requireAuth antes. Bloqueia o request se for membro e a
  // permissão do módulo estiver desabilitada (permissions[module] === false).
  // Dono (não-membro) e platform-admin sempre passam.
  function requirePermission(module: string) {
    return (req: express.Request, res: express.Response, next: express.NextFunction) => {
      const isMember = (req as any).isMember;
      const isPlatformAdmin = (req as any).isPlatformAdmin;
      if (!isMember || isPlatformAdmin) return next();
      const perms = (req as any).memberPermissions || {};
      if (perms[module] === false) {
        return res.status(403).json({
          error: `Sem permissão pra acessar "${module}". Peça pro administrador liberar.`,
          permission_denied: module,
        });
      }
      next();
    };
  }

  // Owner-only: bloqueia qualquer membro (independente das permissions).
  // Pra dados sensíveis como faturamento, equipe, billing.
  function requireOwnerOrPlatformAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
    const isMember = (req as any).isMember;
    const isPlatformAdmin = (req as any).isPlatformAdmin;
    if (!isMember || isPlatformAdmin) return next();
    return res.status(403).json({
      error: 'Essa ação é restrita ao dono da conta.',
      owner_only: true,
    });
  }

  // ============ SUPER-ADMIN MIDDLEWARE ============
  // Requer requireAuth antes. Bloqueia se o REAL user (não o impersonado) não for super-admin.
  const requireSuperAdmin = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const realUserId = (req as any).realUserId as string | undefined;
    if (!realUserId) return res.status(401).json({ error: 'Não autorizado' });
    if (!supabaseAdmin) return res.status(500).json({ error: 'Service role não configurado' });
    const allowed = await isSuperAdmin(realUserId);
    if (!allowed) return res.status(403).json({ error: 'Acesso restrito ao painel da plataforma' });
    next();
  };

  // ============ WHATSAPP ROUTES (Z-API OU EVOLUTION) ============
  const getInstanceName = (userId: string) => `user_${userId.replace(/-/g, '_')}`;
  const zapiConfigError = () => ({
    error: 'Z-API não configurada. Defina ZAPI_INSTANCE_ID, ZAPI_INSTANCE_TOKEN e ZAPI_CLIENT_TOKEN.',
    missing: getMissingZApiConfig(),
  });

  app.post('/api/whatsapp/instance', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    try {
      console.log(`[Baileys] Iniciando sessão para usuário ${userId}`);
      await BaileysManager.startSession(userId);
      // Aguarda QR (até 35s) — retorna inline se disponível
      const qr = await BaileysManager.waitForQR(userId, 35000);
      if (qr) {
        return res.json({ success: true, provider: 'baileys', base64: qr, qrcode: { base64: qr } });
      }
      // Se não veio QR, pode já estar conectado
      const status = BaileysManager.getStatus(userId);
      if (status === 'open') {
        return res.json({ success: true, provider: 'baileys', state: 'open', instance: { state: 'open' } });
      }
      return res.json({ success: true, provider: 'baileys', triggered: true });
    } catch (error: any) {
      console.error('[Baileys] Erro ao iniciar sessão:', error);
      return res.status(500).json({ error: error.message || 'Falha ao iniciar sessão WhatsApp' });
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
            webhookByEvents: false,
            webhookBase64: true,
            events: ['QRCODE_UPDATED', 'MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'CONNECTION_UPDATE']
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

    // Baileys direto — aguarda QR por até 30s
    const status = BaileysManager.getStatus(userId);
    if (status === 'open') {
      return res.json({ state: 'open', connectionStatus: 'open', instance: { state: 'open' }, provider: 'baileys' });
    }
    if (status === 'not_initialized') {
      // Sessão não iniciada — inicia agora
      await BaileysManager.startSession(userId);
    }
    const qr = await BaileysManager.waitForQR(userId, 30000);
    if (qr) {
      return res.json({ base64: qr, qrcode: { base64: qr }, provider: 'baileys' });
    }
    return res.status(408).json({ error: 'QR Code não gerado. Tente novamente.', provider: 'baileys' });
  });

  // Conectar via código de pareamento (alternativa ao QR)
  app.post('/api/whatsapp/pairing-code', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const { phone } = req.body;

    if (!phone) return res.status(400).json({ error: 'Informe o número de telefone com DDD (ex: 11999999999)' });

    let cleanPhone = phone.replace(/\D/g, '');
    if (cleanPhone.length < 10) return res.status(400).json({ error: 'Número inválido. Use formato: 11999999999' });

    // Baileys exige código do país. Adiciona 55 (Brasil) se não tiver.
    if (!cleanPhone.startsWith('55')) cleanPhone = '55' + cleanPhone;

    try {
      const status = BaileysManager.getStatus(userId);
      if (status === 'open') {
        return res.json({ success: true, already_connected: true });
      }

      // Garante sessão fresca — requestPairingCode deve ser chamado ANTES do QR ser gerado
      if (status !== 'not_initialized') {
        try { await BaileysManager.stopSession(userId); } catch {}
        await new Promise(r => setTimeout(r, 1500));
      }

      await BaileysManager.startSession(userId);

      // Aguarda o socket estar pronto (conectado ao WS do WhatsApp mas antes do QR)
      // Tenta a cada 500ms por até 8 segundos
      let code: string | null = null;
      for (let i = 0; i < 16; i++) {
        await new Promise(r => setTimeout(r, 500));
        const sess = BaileysManager.getStatus(userId);
        if (sess === 'open') return res.json({ success: true, already_connected: true });
        code = await BaileysManager.requestPairingCode(userId, cleanPhone);
        if (code) break;
      }

      if (!code) return res.status(500).json({ error: 'Não foi possível gerar o código. Verifique se o número está correto e tente o QR Code.' });
      return res.json({ success: true, code });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Erro ao gerar código de pareamento' });
    }
  });

  app.get('/api/whatsapp/qrcode_legacy', requireAuth, async (req, res) => {
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

    // Evolution API — busca QR por polling direto (não depende de webhook)
    try {
      // 1. Dispara o connect para gerar o QR
      await fetch(`${EVOLUTION_API_URL}/instance/connect/${instanceName}`, {
        method: 'GET',
        headers: { 'apikey': EVOLUTION_API_KEY },
      }).catch(() => null);

      // 2. Polling direto na Evolution API até o QR aparecer (30s, intervalo 2s)
      const deadline = Date.now() + 30000;
      let lastQr: string | null = null;

      while (Date.now() < deadline) {
        // Tenta buscar QR direto do endpoint de connect
        const pollRes = await fetch(`${EVOLUTION_API_URL}/instance/connect/${instanceName}`, {
          method: 'GET',
          headers: { 'apikey': EVOLUTION_API_KEY },
        }).catch(() => null);

        if (pollRes?.ok) {
          const pollData = await pollRes.json().catch(() => ({}));

          // Verifica se já conectou
          const state = normalizeWhatsappState(pollData);
          if (state === 'open') {
            console.log(`[WA] Instância ${instanceName} já conectada durante polling`);
            return res.json({ state: 'open', connectionStatus: 'open', instance: { state: 'open' }, provider: 'evolution' });
          }

          // Extrai QR de qualquer campo possível
          const qr = extractQrCandidate(pollData, JSON.stringify(pollData));
          if (qr && qr.length > 50 && qr !== lastQr) {
            lastQr = qr;
            const base64 = qr.startsWith('data:') ? qr : `data:image/png;base64,${qr}`;
            console.log(`[WA] QR Code obtido por polling direto para ${instanceName}`);
            return res.json({ base64, qrcode: { base64 }, provider: 'evolution' });
          }
        }

        // Também verifica cache do webhook (caso chegue enquanto faz polling)
        const cached = qrCodeByInstance.get(instanceName);
        if (cached) {
          const base64 = cached.startsWith('data:') ? cached : `data:image/png;base64,${cached}`;
          console.log(`[WA] QR Code via webhook para ${instanceName}`);
          return res.json({ base64, qrcode: { base64 }, provider: 'evolution' });
        }

        await new Promise<void>((resolve) => setTimeout(resolve, 2000));
      }

      // Timeout final — verifica estado
      try {
        const statusRes = await fetch(`${EVOLUTION_API_URL}/instance/connectionState/${instanceName}`, {
          headers: { 'apikey': EVOLUTION_API_KEY },
        });
        if (statusRes.ok) {
          const statusData = await statusRes.json();
          const state = normalizeWhatsappState(statusData);
          if (state === 'open') {
            return res.json({ state: 'open', connectionStatus: 'open', instance: { state: 'open' }, provider: 'evolution' });
          }
        }
      } catch { /* ignora */ }

      console.warn(`[WA] Timeout no polling de QR para ${instanceName}`);
      return res.status(408).json({
        error: 'QR Code não gerado. Verifique se a Evolution API está online e tente novamente.',
        provider: 'evolution',
        count: 0,
      });
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

    // Baileys direto
    const baileysStatus = BaileysManager.getStatus(userId);
    if (baileysStatus === 'open') {
      return res.json({ connected: true, provider: 'baileys', whatsapp: { connected: true } });
    }
    if (baileysStatus === 'connecting') {
      return res.json({ connected: false, provider: 'baileys', state: 'connecting', whatsapp: { connected: false } });
    }

    // Fallback: Meta Cloud API. Filtra is_active=true porque o user pode ter
    // múltiplas rows (uma ativa + histórico inativo após troca-número). Sem
    // is_active, maybeSingle estoura PGRST116 e cai no catch silencioso, daí
    // a UI mostrava "Conectar" mesmo com Cloud API funcionando.
    try {
      const { data: metaAccount } = await supabase
        .from('whatsapp_business_accounts')
        .select('phone_number, display_name')
        .eq('user_id', userId)
        .eq('is_active', true)
        .maybeSingle();
      if (metaAccount) {
        return res.json({ connected: true, provider: 'meta', phone: metaAccount.phone_number, whatsapp: { connected: true } });
      }
    } catch (err: any) {
      console.error('[Status] Erro ao consultar Meta Cloud:', err?.message || err);
    }

    return res.json({ connected: false, provider: 'baileys', whatsapp: { connected: false } });
  });

  app.get('/api/whatsapp/status_legacy', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const instanceName = getInstanceName(userId);

    if (isZApiEnabled()) {
      if (getMissingZApiConfig().length > 0) {
        return res.status(500).json(zapiConfigError());
      }
      try {
        const response = await fetch(zapiUrl('/status'), { method: 'GET', headers: zapiHeaders() });
        const parsed = await parseHttpResponse(response);
        if (!response.ok) return res.status(response.status).json({ error: 'Falha ao consultar status na Z-API', provider: 'zapi', details: parsed.data });
        const state = normalizeWhatsappState(parsed.data);
        const payload = (typeof parsed.data === 'object' && parsed.data !== null) ? parsed.data : { raw: parsed.raw };
        return res.status(response.status).json({ ...payload, provider: 'zapi', state, connectionStatus: state, instance: { state } });
      } catch (error) {
        console.error('Erro ao verificar status (Z-API):', error);
        return res.status(500).json({ error: 'Falha ao verificar status (Z-API)' });
      }
    }

    // Evolution API — verifica estado da instância
    if (WHATSAPP_PROVIDER === 'evolution') {
      try {
        const response = await fetch(`${EVOLUTION_API_URL}/instance/connectionState/${instanceName}`, {
          method: 'GET',
          headers: { 'apikey': EVOLUTION_API_KEY },
        });
        const parsed = await parseHttpResponse(response);
        const state = normalizeWhatsappState(parsed.data);
        if (state === 'open') {
          return res.json({ connected: true, instance: { state }, state, connectionStatus: state, provider: 'evolution', whatsapp: { connected: true } });
        }
        // Evolution desconectada — verifica Meta como fallback ativo
      } catch { /* ignora — verifica Meta abaixo */ }
    }

    // Meta WhatsApp Business — usado quando Evolution não está conectada ou provider=meta
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

    // Nenhum provider conectado
    return res.json({ connected: false, provider: WHATSAPP_PROVIDER, whatsapp: { connected: false } });
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
    try {
      await BaileysManager.stopSession(userId);
      // Histórico preservado — cada número tem seu próprio histórico vinculado por wa_number
      console.log(`[Baileys] Sessão desconectada para ${userId} (histórico preservado por número)`);
      return res.json({ success: true });
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
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
  // Evolution v2 com webhookByEvents:true envia para /webhook/{EVENT_NAME}
  // Precisamos processar QR code e mensagens aqui também
  app.post('/api/whatsapp/webhook/:event', async (req, res) => {
    res.sendStatus(200);
    const eventParam = req.params.event.toLowerCase();
    const body = req.body ?? {};
    const instanceName: string = body?.instance ?? body?.instanceName ?? '';

    if (eventParam === 'qrcode_updated' || eventParam === 'qrcode.updated') {
      const qrBase64: string = body?.data?.qrcode?.base64 ?? body?.qrcode?.base64 ?? body?.data?.base64 ?? '';
      if (qrBase64 && instanceName) {
        qrCodeByInstance.set(instanceName, qrBase64);
        console.log(`[WA] QR recebido via /webhook/${eventParam} para: ${instanceName}`);
      }
      return;
    }

    if (eventParam === 'connection_update' || eventParam === 'connection.update') {
      const state: string = body?.data?.state ?? body?.state ?? body?.connectionStatus ?? '';
      console.log(`[WA] Connection update (byEvents) instância=${instanceName} state=${state}`);
      return;
    }

    if (eventParam === 'messages_upsert' || eventParam === 'messages.upsert') {
      // Reprocessa como se fosse o webhook principal inserindo evento no body
      const merged = { ...body, event: 'messages.upsert' };
      req.body = merged;
      // Chama a lógica de processamento diretamente passando req.body modificado
      // (simplificado: loga e deixa o polling de mensagens buscar do banco)
      console.log(`[WA] Messages upsert (byEvents) instância=${instanceName}`, JSON.stringify(body).slice(0, 200));
      return;
    }

    console.log(`[WA Webhook] Evento sub-rota não processado: ${eventParam}`, JSON.stringify(body).slice(0, 200));
  });

  app.post('/api/whatsapp/webhook', async (req, res) => {
    // ── HMAC verification ────────────────────────────────────────────────────
    // Meta assina cada POST com sha256(rawBody, META_APP_SECRET) em X-Hub-Signature-256.
    // Sem essa checagem, qualquer um pode forjar webhooks (mensagens, statuses).
    // Skipa em dev se WA_WEBHOOK_VERIFY_SIGNATURE=false. Default = on.
    // Eventos do Baileys (sem assinatura) só são aceitos se a verificação tá off.
    const verifySig = process.env.WA_WEBHOOK_VERIFY_SIGNATURE !== 'false';
    const isMetaPayload = req.body?.object === 'whatsapp_business_account';
    const secret = process.env.META_APP_SECRET;

    if (verifySig && isMetaPayload) {
      const signatureHeader = req.headers['x-hub-signature-256'] as string | undefined;
      const rawBody = (req as any).rawBody as Buffer | undefined;
      if (!signatureHeader || !rawBody || !secret) {
        console.warn('[Webhook] HMAC rejeitado: header/body/secret ausente');
        return res.status(403).send('Forbidden');
      }
      const expected = 'sha256=' + crypto
        .createHmac('sha256', secret)
        .update(rawBody)
        .digest('hex');
      // timingSafeEqual exige buffers do mesmo tamanho — se diferentes, rejeita
      const a = Buffer.from(signatureHeader);
      const b = Buffer.from(expected);
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        console.warn('[Webhook] HMAC inválido — payload rejeitado');
        return res.status(403).send('Forbidden');
      }
    }

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
        const msgType: string = message.type || 'text';

        // Ignora tipos que não sabemos tratar (reaction, system, etc.)
        if (!['text', 'image', 'audio', 'video', 'document', 'sticker', 'voice'].includes(msgType)) return;

        const phoneNumberId = value.metadata?.phone_number_id;
        const fromNumber = message.from;
        const msgId = message.id;

        // Nome do contato vem em value.contacts[0].profile.name
        const contactName: string | null = value.contacts?.[0]?.profile?.name || null;

        // Precisa do access_token para baixar mídia — busca antes do processamento.
        // Filtra is_active=true (multi-WABA: um phone_number_id pertence só a uma
        // WABA ativa; rows antigas viram is_active=false).
        const { data: waAccount, error: waErr } = await supabaseAdmin
          .from('whatsapp_business_accounts')
          .select('user_id, access_token')
          .eq('phone_number_id', phoneNumberId)
          .eq('is_active', true)
          .maybeSingle();

        if (waErr) { console.error('[Webhook Meta] Erro ao buscar conta:', waErr.message); return; }
        if (!waAccount) { console.error('[Webhook Meta] Nenhuma conta ativa para phone_number_id:', phoneNumberId); return; }

        // Decifra o token (no-op se a linha estiver em plaintext legacy).
        const decryptedToken = decryptIfNeeded(waAccount.access_token);
        if (!decryptedToken) { console.error('[Webhook Meta] Falha ao decifrar token da conta'); return; }
        waAccount.access_token = decryptedToken;

        let msgBody = '';
        let mediaDataUrl: string | null = null;
        const normalizedType = msgType === 'voice' ? 'audio' : msgType;

        if (msgType === 'text') {
          msgBody = message.text?.body || '';
        } else {
          // image | audio | video | document | sticker | voice
          const mediaObj = (message as any)[msgType] as any;
          msgBody = mediaObj?.caption || '';
          const metaMediaId: string = mediaObj?.id || '';

          if (metaMediaId && waAccount.access_token) {
            try {
              // 1. Obtém a URL temporária do arquivo no Meta
              const infoRes = await fetch(`https://graph.facebook.com/v21.0/${metaMediaId}`, {
                headers: { Authorization: `Bearer ${waAccount.access_token}` },
              });
              if (infoRes.ok) {
                const info = await infoRes.json();
                if (info.url) {
                  // 2. Baixa o arquivo
                  const fileRes = await fetch(info.url, {
                    headers: { Authorization: `Bearer ${waAccount.access_token}` },
                  });
                  if (fileRes.ok) {
                    const contentType = fileRes.headers.get('content-type') || `${normalizedType}/octet-stream`;
                    const buffer = Buffer.from(await fileRes.arrayBuffer());
                    mediaDataUrl = `data:${contentType};base64,${buffer.toString('base64')}`;
                    console.log(`[Webhook Meta] ✅ Mídia baixada: ${normalizedType} (${Math.round(buffer.length / 1024)}KB)`);
                  }
                }
              }
            } catch (err) {
              console.error('[Webhook Meta] Erro ao baixar mídia:', err);
            }
          }
        }

        console.log(`[Webhook Meta] ${normalizedType} de ${fromNumber}: "${msgBody}"${mediaDataUrl ? ' [mídia]' : ''}`);

        const cleanFrom = normalizeBrazilianPhone(fromNumber.replace(/\D/g, ''));
        const now = new Date().toISOString();

        // wa_number = o NOSSO número (display_phone_number da WABA), só dígitos.
        // Sem isso, /api/inbox/conversations.eq('wa_number', X) não encontra
        // a conversa — fica invisível na UI mesmo persistida no banco.
        const ourDisplayPhone = value.metadata?.display_phone_number || '';
        const ourWaNumber = ourDisplayPhone.replace(/\D/g, '');

        const { error: msgErr } = await supabaseAdmin.from('wa_messages').insert({
          user_id: waAccount.user_id,
          phone: cleanFrom,
          ...(ourWaNumber ? { wa_number: ourWaNumber } : {}),
          message_id: msgId || `meta-in-${Date.now()}`,
          body: msgBody,
          from_me: false,
          timestamp: now,
          type: normalizedType,
          status: 'received',
          ...(mediaDataUrl ? { media_url: mediaDataUrl } : {}),
        });
        if (msgErr) console.error('[Webhook Meta] Erro ao salvar mensagem:', msgErr.message);

        const lastMsg = msgBody || `[${normalizedType}]`;
        // UPDATE primeiro, INSERT se não existir (sem dependência de onConflict)
        const metaConvPayload: Record<string, any> = {
          user_id: waAccount.user_id, phone: cleanFrom,
          last_message: lastMsg, last_message_at: now, unread_count: 1,
          ...(ourWaNumber ? { wa_number: ourWaNumber } : {}),
          ...(contactName ? { contact_name: contactName } : {}),
        };
        const { data: metaUpdated, error: metaUpdateErr } = await supabaseAdmin
          .from('wa_conversations').update(metaConvPayload)
          .eq('user_id', waAccount.user_id).eq('phone', cleanFrom).select('id');
        if (metaUpdateErr) {
          console.error('[Webhook Meta] Erro ao UPDATE conversa:', metaUpdateErr.message);
        } else if (!metaUpdated || metaUpdated.length === 0) {
          const { error: metaInsertErr } = await supabaseAdmin.from('wa_conversations').insert(metaConvPayload);
          if (metaInsertErr) console.error('[Webhook Meta] Erro ao INSERT conversa:', metaInsertErr.message);
        }
        console.log(`[Webhook Meta] ✅ ${normalizedType} salvo — user ${waAccount.user_id}, phone ${cleanFrom}`);

        // Enriquece o nome de um deal já existente (criado manualmente) com o nome
        // que veio no payload do WhatsApp. Não cria novos deals — adição é manual.
        const metaUserId = waAccount.user_id;
        if (contactName) {
          const phoneShortMeta = cleanFrom.startsWith('55') ? cleanFrom.slice(2) : cleanFrom;
          const { data: existingDealsMeta } = await supabaseAdmin
            .from('deals')
            .select('id')
            .eq('user_id', metaUserId)
            .or(`contact_phone.eq.${cleanFrom},contact_phone.eq.${phoneShortMeta}`)
            .limit(1);

          if (existingDealsMeta && existingDealsMeta.length > 0) {
            const existingDeal = existingDealsMeta[0] as any;
            await supabaseAdmin.from('deals')
              .update({ contact_name: contactName, title: contactName })
              .eq('id', existingDeal.id)
              .eq('user_id', metaUserId)
              .is('contact_name', null);
          }
        }
        return;
      }

      // ── Evolution API / Z-API ────────────────────────────────────────────────
      const instanceName = payload?.instance ?? payload?.instanceName ?? '';
      const eventType = payload?.event ?? payload?.type ?? '';

      // Deriva userId a partir do instanceName (padrão: user_<uuid-com-underscores>)
      const userIdFromInstance = instanceName.startsWith('user_')
        ? instanceName.slice(5).replace(/_/g, '-')
        : '';

      if (eventType === 'qrcode.updated' || eventType === 'QRCODE_UPDATED') {
        const qrBase64 = payload?.data?.qrcode?.base64 ?? payload?.qrcode?.base64 ?? payload?.data?.base64 ?? '';
        if (qrBase64 && instanceName) {
          qrCodeByInstance.set(instanceName, qrBase64);
          console.log(`[WA] QR recebido via webhook para instância: ${instanceName}`);
        }
        return;
      }

      // Atualiza status de mensagens enviadas (entregue/lido)
      if ((eventType === 'messages.update' || eventType === 'MESSAGES_UPDATE') && userIdFromInstance && supabaseAdmin) {
        const updates: any[] = Array.isArray(payload?.data) ? payload.data : [];
        for (const upd of updates) {
          const msgId: string = upd?.key?.id ?? upd?.messageId ?? '';
          const rawStatus: string | number = upd?.update?.status ?? upd?.status ?? '';
          if (!msgId || rawStatus === '') continue;

          // Mapeia status numérico ou string para nosso formato
          const statusMap: Record<string, string> = {
            '0': 'error', 'ERROR': 'error',
            '1': 'pending', 'PENDING': 'pending',
            '2': 'sent', 'SERVER_ACK': 'sent',
            '3': 'delivered', 'DELIVERY_ACK': 'delivered',
            '4': 'read', 'READ': 'read',
            '5': 'read', 'PLAYED': 'read',
          };
          const normalized = statusMap[String(rawStatus).toUpperCase()] ?? statusMap[String(rawStatus)] ?? null;
          if (!normalized) continue;

          await supabaseAdmin
            .from('wa_messages')
            .update({ status: normalized })
            .eq('user_id', userIdFromInstance)
            .eq('message_id', msgId);
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
        // Evolution API v2: phone está em event.key.remoteJid (ex: "5511...@s.whatsapp.net")
        const remoteJid: string = event?.key?.remoteJid ?? '';
        const rawPhone = String(
          remoteJid.split('@')[0] ||
          (event?.phone ?? event?.chatId ?? event?.chatLid ??
          event?.senderPhone ?? event?.participantPhone ?? '')
        );

        const isGroup =
          rawPhone.includes('@g.us') ||
          /^\d+[-]\d+/.test(rawPhone) ||
          Boolean(event?.isGroup) ||
          String(event?.chatId ?? '').includes('@g.us');
        if (isGroup) continue;

        const phone = normalizePhone(rawPhone);
        const text = extractWebhookText(event);
        const media = extractWebhookMedia(event);
        if (!phone || (!text && !media)) continue;

        const name = String(
          // Evolution API v2: pushName vem no campo raiz do data
          event?.pushName ?? event?.senderName ?? event?.chatName ??
          event?.contact?.name ?? event?.name ?? ''
        ).trim() || undefined;

        const timestamp = parseWebhookTimestamp(event);
        // Evolution API v2: id fica em event.key.id
        const messageIdRaw = event?.key?.id ?? event?.messageId ?? event?.id ?? event?.messageID;
        const messageId =
          (typeof messageIdRaw === 'string' && messageIdRaw.trim())
            ? messageIdRaw.trim()
            : `${phone}-${timestamp}-${processed}`;

        // Evolution API v2: fromMe fica em event.key.fromMe
        const fromMe = Boolean(event?.key?.fromMe ?? event?.fromMe);

        cacheLiveWhatsAppMessage({
          id: messageId,
          phone,
          name,
          text: text || (media ? `[${media.type}]` : ''),
          fromMe,
          timestamp,
          source: 'webhook',
          ...(media ? { mediaType: media.type, mediaBase64: media.base64, mediaMimetype: media.mimetype } : {}),
        }, userIdFromInstance || undefined);
        processed += 1;
      }

      if (processed > 0) {
        console.log(`[Webhook WA] Mensagens processadas: ${processed}, userId: ${userIdFromInstance || 'desconhecido'}`);
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
    const db = supabaseAdmin;
    // Filtra pelas conversas do WhatsApp atualmente conectado.
    // Tenta Baileys primeiro, depois fallback Meta Cloud (sem isso, usuário
    // que migrou pra Cloud API via Embedded Signup nunca vê conversa — Baileys
    // não tem sessão, getConnectedPhone retorna null, query retorna []).
    let waNumber = BaileysManager.getConnectedPhone(userId) || '';
    if (!waNumber) {
      try {
        const userDb = (req as any).supabase as SupabaseClient;
        const { data: metaAcc } = await userDb
          .from('whatsapp_business_accounts')
          .select('phone_number')
          .eq('user_id', userId)
          .eq('is_active', true)
          .maybeSingle();
        if (metaAcc?.phone_number) {
          waNumber = metaAcc.phone_number.replace(/\D/g, '');
        }
      } catch (err: any) {
        console.error('[Inbox] Erro fallback Meta:', err?.message || err);
      }
    }
    if (!waNumber) {
      return res.json([]);
    }
    if (!db) {
      const userDb = (req as any).supabase as SupabaseClient;
      const { data } = await userDb.from('wa_conversations').select('*').eq('user_id', userId).eq('wa_number', waNumber).order('last_message_at', { ascending: false }).limit(200);
      return res.json(data || []);
    }
    try {
      const { data, error } = await db
        .from('wa_conversations')
        .select('*')
        .eq('user_id', userId)
        .eq('wa_number', waNumber)
        .order('last_message_at', { ascending: false })
        .limit(200);

      if (error) {
        console.error('[Inbox] Erro ao buscar conversas:', error.message, error.code);
        throw error;
      }

      const rows = data || [];

      // Merge com cache em memória (conversas chegadas mas ainda não persistidas)
      const dbPhones = new Set(rows.map((c: any) => c.phone));
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

      if (memContacts.length > 0) {
        console.log(`[Inbox] + ${memContacts.length} conversas do cache de memória`);
      }

      return res.json([...rows, ...memContacts]);
    } catch (err: any) {
      console.error('[Inbox] Exceção em /conversations:', err?.message || err);
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
    const phoneRaw = req.params.phone.replace(/\D/g, '');
    const phone12 = phoneRaw.startsWith('55') ? phoneRaw : '55' + phoneRaw;
    const phone13 = normalizeBrazilianPhone(phone12); // versão com "9" adicionado
    const limit = Number(req.query.limit) || 60;
    // Mesmo fallback do /conversations: tenta Baileys, depois Meta Cloud.
    let waNumber = BaileysManager.getConnectedPhone(userId) || '';
    if (!waNumber) {
      try {
        const { data: metaAcc } = await supabase
          .from('whatsapp_business_accounts')
          .select('phone_number')
          .eq('user_id', userId)
          .eq('is_active', true)
          .maybeSingle();
        if (metaAcc?.phone_number) {
          waNumber = metaAcc.phone_number.replace(/\D/g, '');
        }
      } catch {}
    }
    if (!waNumber) {
      return res.json([]);
    }
    const dbMsg = supabaseAdmin || supabase;
    try {
      // Busca em ambos os formatos: JID exato (12 dig) e normalizado (13 dig)
      // E só do WhatsApp atualmente conectado (filtrar por wa_number).
      const phoneCondition = phone12 !== phone13
        ? `phone.eq.${phone12},phone.eq.${phone13}`
        : `phone.eq.${phone12}`;
      const msgQuery = dbMsg
        .from('wa_messages')
        .select('*')
        .eq('user_id', userId)
        .eq('wa_number', waNumber)
        .or(phoneCondition)
        .order('timestamp', { ascending: true })
        .limit(limit);

      const { data, error } = await msgQuery;

      if (error) throw error;

      // Merge com cache em memória
      const dbIds = new Set((data || []).map((m: any) => m.message_id));
      const memMessages = getLiveMessagesByPhone(phone12, limit)
        .filter((m) => !dbIds.has(m.id))
        .map((m) => ({
          message_id: m.id,
          body: m.text,
          from_me: m.fromMe,
          timestamp: new Date(m.timestamp).toISOString(),
          type: m.mediaType || 'text',
          status: 'received',
          media_url: m.mediaBase64
            ? (m.mediaBase64.startsWith('data:') ? m.mediaBase64 : `data:${m.mediaMimetype||'image/jpeg'};base64,${m.mediaBase64}`)
            : null,
        }));

      const parseWf = (w: any): number[] | null => {
        if (!w) return null;
        if (Array.isArray(w)) return w;
        if (typeof w === 'string') { try { return JSON.parse(w); } catch { return null; } }
        if (w instanceof Uint8Array || Buffer.isBuffer(w)) return Array.from(w);
        return null;
      };
      const all = [...(data || []), ...memMessages]
        .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
        .map((m: any) => ({ ...m, waveform: parseWf(m.waveform) }));
      return res.json(all);
    } catch {
      const msgs = getLiveMessagesByPhone(phone12, limit).map((m) => ({
        message_id: m.id,
        body: m.text,
        from_me: m.fromMe,
        timestamp: new Date(m.timestamp).toISOString(),
        type: m.mediaType || 'text',
        status: m.fromMe ? 'sent' : 'received',
        media_url: m.mediaBase64
          ? (m.mediaBase64.startsWith('data:') ? m.mediaBase64 : `data:${m.mediaMimetype||'image/jpeg'};base64,${m.mediaBase64}`)
          : null,
      }));
      return res.json(msgs);
    }
  });

  // Marcar conversa como lida (zera unread no Supabase)
  app.post('/api/inbox/mark-read/:phone', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const phone = normalizeBrazilianPhone(req.params.phone.replace(/\D/g, ''));
    readUpToTimestampByPhone.set(phone, Date.now());
    try {
      const db = supabaseAdmin || (req as any).supabase as SupabaseClient;
      await db
        .from('wa_conversations')
        .update({ unread_count: 0, updated_at: new Date().toISOString() })
        .eq('user_id', userId)
        .eq('phone', phone);
    } catch {}
    return res.json({ ok: true });
  });

  // Debug: verifica estado do DB — sem auth, só localhost
  app.get('/api/inbox/debug', async (req, res) => {
    const userIdParam = (req.query.userId as string) || '';
    const result: any = { supabaseAdminAvailable: !!supabaseAdmin, sessions: [] };

    // Lista todas as sessões Baileys ativas
    const allSessions = ['connecting','open','close','not_initialized'];
    // Mostra status de todas as sessões se não informou userId
    if (!userIdParam) {
      result.tip = 'Passe ?userId=SEU_USER_ID para ver conversas. Reinicie o servidor e verifique os logs.';
      return res.json(result);
    }

    const waPhone = BaileysManager.getConnectedPhone(userIdParam);
    const waStatus = BaileysManager.getStatus(userIdParam);
    result.userId = userIdParam;
    result.waStatus = waStatus;
    result.waPhone = waPhone;

    if (supabaseAdmin) {
      const { data: convs, error: convErr } = await supabaseAdmin
        .from('wa_conversations')
        .select('phone, last_message, last_message_at, wa_number, unread_count')
        .eq('user_id', userIdParam)
        .order('last_message_at', { ascending: false })
        .limit(10);
      const { count: msgCount } = await supabaseAdmin
        .from('wa_messages')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userIdParam);
      result.conversationsInDB = convs || [];
      result.conversationError = convErr?.message;
      result.messageCount = msgCount;

      // Se passou phone, retorna mensagens dessa conversa
      const phoneParam = (req.query.phone as string) || '';
      if (phoneParam && convs && convs.length > 0) {
        const { data: msgs, error: msgsErr } = await supabaseAdmin
          .from('wa_messages')
          .select('message_id, body, from_me, timestamp, type, status')
          .eq('user_id', userIdParam)
          .eq('phone', phoneParam)
          .order('timestamp', { ascending: false })
          .limit(5);
        result.sampleMessages = msgs || [];
        result.sampleMessagesError = msgsErr?.message;
        result.testedPhone = phoneParam;
      } else if (convs && convs.length > 0) {
        // Testa com a primeira conversa
        const firstPhone = (convs[0] as any).phone;
        const { data: msgs, error: msgsErr } = await supabaseAdmin
          .from('wa_messages')
          .select('message_id, body, from_me, timestamp, type, status')
          .eq('user_id', userIdParam)
          .eq('phone', firstPhone)
          .order('timestamp', { ascending: false })
          .limit(5);
        result.sampleMessages = msgs || [];
        result.sampleMessagesError = msgsErr?.message;
        result.testedPhone = firstPhone;
      }
    }
    return res.json(result);
  });

  // ─── DIAGNÓSTICO: retorna userId do token JWT ─────────────────────────────────
  app.get('/test-whoami', requireAuth, (req, res) => {
    const userId = (req as any).userId;
    const isMember = (req as any).isMember;
    res.json({ userId, isMember, dbUserId: 'b6608c80-b993-444e-8ba8-ddde5bd18ac0', match: userId === 'b6608c80-b993-444e-8ba8-ddde5bd18ac0' });
  });

  // ─── DIAGNÓSTICO TEMPORÁRIO: página HTML sem auth ────────────────────────────
  app.get('/test-inbox', async (_req, res) => {
    if (!supabaseAdmin) return res.send('<h1>supabaseAdmin não disponível</h1>');
    const userId = 'b6608c80-b993-444e-8ba8-ddde5bd18ac0';
    const { data: convs } = await supabaseAdmin.from('wa_conversations').select('phone, contact_name, last_message, last_message_at').eq('user_id', userId).order('last_message_at', { ascending: false }).limit(20);
    const waStatus = BaileysManager.getStatus(userId);
    const waPhone = BaileysManager.getConnectedPhone(userId);
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>FotoApp Diagnóstico</title></head><body style="font-family:monospace;background:#111;color:#eee;padding:20px">
<h2>WhatsApp: <span style="color:${waStatus==='open'?'#4f4':'#f44'}">${waStatus}</span> | Número: ${waPhone||'--'}</h2>
<h3>${(convs||[]).length} conversas no banco</h3>
<table border="1" style="border-collapse:collapse;color:#eee">
<tr><th>Telefone</th><th>Nome</th><th>Última msg</th><th>Quando</th></tr>
${(convs||[]).map(c=>`<tr><td>${(c as any).phone}</td><td>${(c as any).contact_name||'--'}</td><td>${((c as any).last_message||'').slice(0,40)}</td><td>${((c as any).last_message_at||'').slice(0,16)}</td></tr>`).join('')}
</table>
<p style="color:#888">Se você ver essa página com conversas, o backend está OK. O problema é no frontend (auth/React).</p>
</body></html>`;
    res.send(html);
  });

  // Envia mensagem de texto
  app.post('/api/inbox/send', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const { phone, text } = req.body;

    if (!phone || !text) return res.status(400).json({ error: 'phone e text são obrigatórios' });

    // Usa o phone exatamente como armazenado (JID do WhatsApp) — normalizeBrazilianPhone
    // adiciona "9" e corrompe números que já têm o formato correto
    const rawDigits = phone.replace(/\D/g, '');
    // Só adiciona código do país se estiver faltando (número local digitado manualmente)
    const cleanPhone = rawDigits.startsWith('55') ? rawDigits : '55' + rawDigits;
    const db = supabaseAdmin || (req as any).supabase as SupabaseClient;

    const waNumber = BaileysManager.getConnectedPhone(userId) || '';
    // Para envio, usa o JID em 12 dígitos (formato nativo do WhatsApp).
    // Se o phone guardado tiver 13 dígitos (ex: 5543999093114 — resultado da normalização antiga),
    // remove o "9" extra na posição 4 para recuperar o JID correto (554399093114).
    const baileysPhone = cleanPhone.length === 13 && cleanPhone.startsWith('55')
      ? cleanPhone.slice(0, 4) + cleanPhone.slice(5)
      : cleanPhone;
    console.log(`[Send] baileysPhone=${baileysPhone} | status=${BaileysManager.getStatus(userId)} | waNumber=${waNumber}`);

    const saveToDb = async (msgId: string) => {
      const now = new Date().toISOString();
      const { error: msgErr } = await db.from('wa_messages').insert({
        user_id: userId, phone: baileysPhone, message_id: msgId,
        body: text, from_me: true, timestamp: now, type: 'text', status: 'sent', wa_number: waNumber,
      });
      if (msgErr) {
        if (!msgErr.message.includes('duplicate') && !msgErr.code?.includes('23505')) {
          console.error('[Send] Erro ao salvar mensagem no DB:', msgErr.message, '| code:', msgErr.code);
        }
      } else {
        console.log(`[Send] Mensagem salva no DB | msgId=${msgId} | phone=${baileysPhone}`);
      }
      // UPDATE primeiro, INSERT se não existir — tenta ambos os formatos (12 e 13 dígitos)
      const normalized = normalizeBrazilianPhone(baileysPhone);
      const phoneOr = normalized !== baileysPhone
        ? `phone.eq.${baileysPhone},phone.eq.${normalized}`
        : `phone.eq.${baileysPhone}`;
      const { data: upd } = await db.from('wa_conversations')
        .update({ last_message: text, last_message_at: now, updated_at: now, phone: baileysPhone })
        .eq('user_id', userId).or(phoneOr).select('id');
      if (!upd || upd.length === 0) {
        await db.from('wa_conversations').insert({
          user_id: userId, phone: baileysPhone, last_message: text, last_message_at: now, updated_at: now, wa_number: waNumber,
        });
      }
    };
    if (BaileysManager.getStatus(userId) === 'open') {
      try {
        const msgId = await BaileysManager.sendText(userId, baileysPhone, text);
        console.log(`[Send] Baileys enviou | msgId=${msgId}`);
        await saveToDb(msgId);
        return res.json({ success: true, message_id: msgId });
      } catch (err: any) {
        console.warn('[Send] Baileys erro:', err.message);
      }
    }

    // ── Meta WhatsApp Business API (fallback) ────────────────────────────────
    const { data: waAccount } = await db
      .from('whatsapp_business_accounts')
      .select('phone_number_id, phone_number, access_token')
      .eq('user_id', userId)
      .eq('is_active', true)
      .maybeSingle();

    if (!waAccount) return res.status(400).json({ error: 'WhatsApp não conectado. Configure nas Configurações.' });

    const metaToken = decryptIfNeeded(waAccount.access_token);
    if (!metaToken) return res.status(500).json({ error: 'Falha ao decifrar token' });

    try {
      const metaRes = await fetch(
        `https://graph.facebook.com/v21.0/${waAccount.phone_number_id}/messages`,
        {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${metaToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ messaging_product: 'whatsapp', to: cleanPhone, type: 'text', text: { body: text } }),
        }
      );
      const metaData = await metaRes.json();
      if (metaData.error) {
        const code = metaData.error.code;
        const msg: string = metaData.error.message || JSON.stringify(metaData.error);
        console.error(`[Send Meta] Erro código ${code}:`, msg);
        // Token expirado ou inválido
        if (code === 190 || code === 401 || msg.toLowerCase().includes('token')) {
          return res.status(400).json({ error: 'Token do WhatsApp Business expirado. Vá em Configurações → reconecte a API Oficial.' });
        }
        // Sandbox: destinatário não aprovado
        if (code === 131030 || msg.includes('not in allowed list') || msg.includes('recipient')) {
          return res.status(400).json({ error: 'Número não está na lista de testes do Meta. Adicione-o no Meta Business ou use o QR Code para enviar livremente.' });
        }
        // 133010 "Account not registered" — número ainda em platform_type=ON_PREMISE
        // (Coexistence Mode aguardando App Review da Meta liberar Advanced Access).
        // Comum quando Embedded Signup completou mas o app Meta ainda está em Dev Mode.
        if (code === 133010 || msg.toLowerCase().includes('account not registered')) {
          return res.status(400).json({
            error: 'Conta WhatsApp ainda em provisionamento na Meta. Sua integração foi conectada, mas o número precisa ser promovido pra Cloud API antes de enviar/receber mensagens. Aguarde aprovação do App Review da Meta (3-4 semanas após submissão) ou consulte o status em Configurações → WhatsApp → Diagnóstico.',
          });
        }
        return res.status(400).json({ error: msg });
      }
      const msgId = metaData.messages?.[0]?.id || `meta-${Date.now()}`;
      await saveToDb(msgId);
      res.json({ success: true, message_id: msgId });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Envia mídia (imagem, áudio, documento) via WhatsApp
  app.post('/api/inbox/send-media', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { phone, mediaBase64, mimetype, filename, caption } = req.body;

    if (!phone || !mediaBase64 || !mimetype) {
      return res.status(400).json({ error: 'phone, mediaBase64 e mimetype são obrigatórios' });
    }

    console.log(`[SendMedia] Recebido: phone=${phone} mimetype=${mimetype} size=${mediaBase64?.length ?? 0}`);

    const rawPhone = phone.replace(/\D/g, '');
    // Baileys usa JID de 12 dígitos — remover o "9" adicionado pela normalização
    const cleanPhone = rawPhone.length === 13 && rawPhone.startsWith('55')
      ? rawPhone.slice(0, 4) + rawPhone.slice(5)
      : rawPhone;
    const instanceName = `user_${userId.replace(/-/g, '_')}`;

    const getMediaType = (mime: string): string => {
      if (mime.startsWith('image/')) return 'image';
      if (mime.startsWith('video/')) return 'video';
      if (mime.startsWith('audio/')) return 'audio';
      return 'document';
    };
    const mediaType = getMediaType(mimetype);

    // Transcodifica webm → ogg para compatibilidade com WhatsApp PTT
    let finalBase64 = mediaBase64;
    let finalMimetype = mimetype;
    let finalFilename = filename || 'media';
    let audioWaveform: Buffer | undefined;
    let audioSeconds = 0;
    if (mimetype.startsWith('audio/webm')) {
      try {
        const oggBuffer = await transcodeWebmToOgg(mediaBase64);
        finalBase64 = oggBuffer.toString('base64');
        finalMimetype = 'audio/ogg; codecs=opus';
        finalFilename = 'audio.ogg';
        console.log(`[SendMedia] Áudio transcodificado: webm → ogg/opus | bytes=${oggBuffer.length}`);
        const wfResult = await extractWaveformAndDuration(oggBuffer).catch(() => null);
        if (wfResult) { audioWaveform = wfResult.waveform; audioSeconds = wfResult.seconds; }
      } catch (err: any) {
        console.warn('[SendMedia] Falha ao transcodar áudio, enviando como webm:', err.message);
      }
    }

    // Armazena o áudio original (webm) para reprodução no browser — Safari não suporta ogg
    const storageMimetype = mimetype.startsWith('audio/') ? mimetype : finalMimetype;
    const storageBase64 = mimetype.startsWith('audio/') ? mediaBase64 : finalBase64;
    const mediaDataUrl = `data:${storageMimetype};base64,${storageBase64}`;

    const saveToDb = async (msgId: string) => {
      const db = supabaseAdmin || (req as any).supabase as SupabaseClient;
      const now = new Date().toISOString();
      const fmtDur = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
      const msgBase = {
        user_id: userId, phone: cleanPhone, message_id: msgId,
        body: caption || '', from_me: true, timestamp: now,
        type: mediaType, status: 'sent', media_url: mediaDataUrl,
      };
      const msgFull = {
        ...msgBase,
        ...(audioSeconds > 0 ? { duration: audioSeconds } : {}),
        ...(audioWaveform ? { waveform: JSON.stringify(Array.from(audioWaveform)) } : {}),
      };
      const { error: insertErr } = await db.from('wa_messages').insert(msgFull);
      if (insertErr) {
        // colunas duration/waveform podem não existir — tenta sem elas
        await db.from('wa_messages').insert(msgBase);
      }
      const lastMsg = mediaType === 'audio'
        ? `🎤 Mensagem de voz${audioSeconds > 0 ? ` (${fmtDur(audioSeconds)})` : ''}`
        : caption || `[${mediaType}]`;
      const convPayload = { user_id: userId, phone: cleanPhone, last_message: lastMsg, last_message_at: now };
      const normalizedPhone = normalizeBrazilianPhone(cleanPhone);
      const phoneOr = normalizedPhone !== cleanPhone
        ? `phone.eq.${cleanPhone},phone.eq.${normalizedPhone}`
        : `phone.eq.${cleanPhone}`;
      const { data: upd } = await db.from('wa_conversations').update(convPayload).eq('user_id', userId).or(phoneOr).select('id');
      if (!upd || upd.length === 0) { await db.from('wa_conversations').insert(convPayload); }
    };

    // ── Baileys (primário) ───────────────────────────────────────────────────
    const baileysStatus = BaileysManager.getStatus(userId);
    console.log(`[SendMedia] Baileys status=${baileysStatus} cleanPhone=${cleanPhone} finalMimetype=${finalMimetype}`);
    if (baileysStatus === 'open') {
      try {
        if (audioWaveform) {
          console.log('[SendMedia] Enviado como PTT', {
            seconds: audioSeconds,
            waveformIsBuffer: Buffer.isBuffer(audioWaveform),
            waveformLength: audioWaveform.length,
            waveformSample: Array.from(audioWaveform.subarray(0, 5)),
          });
        }
        const msgId = await BaileysManager.sendMedia(userId, cleanPhone, finalBase64, finalMimetype, finalFilename, caption || '', audioWaveform, audioSeconds || undefined);
        console.log(`[SendMedia] ✅ Baileys enviou áudio | msgId=${msgId}`);
        await saveToDb(msgId);
        return res.json({ success: true, message_id: msgId });
      } catch (err: any) {
        console.error('[SendMedia] ❌ Baileys erro ao enviar áudio:', err.message, err.stack?.split('\n')[1]);
      }
    }

    // ── Meta WhatsApp Business API ───────────────────────────────────────────
    const { data: waAccount } = await supabase
      .from('whatsapp_business_accounts')
      .select('phone_number_id, access_token')
      .eq('user_id', userId)
      .eq('is_active', true)
      .maybeSingle();

    if (!waAccount) return res.status(400).json({ error: 'WhatsApp não conectado. Configure nas Configurações.' });

    const metaMediaToken = decryptIfNeeded(waAccount.access_token);
    if (!metaMediaToken) return res.status(500).json({ error: 'Falha ao decifrar token' });

    try {
      // 1. Upload da mídia
      const buffer = Buffer.from(finalBase64, 'base64');
      const formData = new FormData();
      formData.append('messaging_product', 'whatsapp');
      formData.append('file', new Blob([buffer], { type: finalMimetype }), finalFilename);

      const uploadRes = await fetch(
        `https://graph.facebook.com/v21.0/${waAccount.phone_number_id}/media`,
        { method: 'POST', headers: { 'Authorization': `Bearer ${metaMediaToken}` }, body: formData }
      );
      const uploadData = await uploadRes.json();
      if (!uploadRes.ok || !uploadData.id) {
        const errMsg = uploadData?.error?.message || 'Erro ao fazer upload da mídia';
        return res.status(400).json({ error: errMsg });
      }
      const mediaId = uploadData.id;

      // 2. Envio da mensagem
      const msgBody: Record<string, unknown> = {
        messaging_product: 'whatsapp',
        to: cleanPhone,
        type: mediaType,
        [mediaType]: mediaType === 'audio'
          ? { id: mediaId }
          : { id: mediaId, caption: caption || '' },
      };

      const sendRes = await fetch(
        `https://graph.facebook.com/v21.0/${waAccount.phone_number_id}/messages`,
        {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${metaMediaToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(msgBody),
        }
      );
      const sendData = await sendRes.json();
      if (sendData.error) {
        return res.status(400).json({ error: sendData.error.message || 'Erro ao enviar mídia' });
      }
      const msgId = sendData.messages?.[0]?.id || `meta-${Date.now()}`;
      await saveToDb(msgId);
      return res.json({ success: true, message_id: msgId });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
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

  // Foto de perfil do contato via Baileys
  app.get('/api/inbox/profile-picture/:phone', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const phone = normalizeBrazilianPhone(req.params.phone.replace(/\D/g, ''));
    try {
      const url = await BaileysManager.getProfilePicture(userId, phone);
      return res.json({ url });
    } catch {
      return res.json({ url: null });
    }
  });

  // Info completa do contato (foto + sobre + nome salvo)
  app.get('/api/inbox/contact-info/:phone', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const phone = normalizeBrazilianPhone(req.params.phone.replace(/\D/g, ''));
    try {
      const [pictureUrl, about, convRow] = await Promise.all([
        BaileysManager.getProfilePicture(userId, phone).catch(() => null),
        BaileysManager.fetchContactAbout(userId, phone).catch(() => null),
        supabase.from('wa_conversations').select('contact_name, last_message_at, unread_count').eq('user_id', userId).eq('phone', phone).maybeSingle(),
      ]);
      return res.json({
        profile_picture_url: pictureUrl,
        about,
        contact_name: convRow.data?.contact_name ?? null,
        last_message_at: convRow.data?.last_message_at ?? null,
      });
    } catch {
      return res.json({ profile_picture_url: null, about: null, contact_name: null, last_message_at: null });
    }
  });

  // Salva nome de contato manualmente
  app.patch('/api/inbox/contact-name/:phone', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const phone = normalizeBrazilianPhone(req.params.phone.replace(/\D/g, ''));
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Nome inválido' });
    try {
      const db = supabaseAdmin || (req as any).supabase as SupabaseClient;
      const { data: upd } = await db.from('wa_conversations').update({ contact_name: name.trim() }).eq('user_id', userId).eq('phone', phone).select('id');
      if (!upd || upd.length === 0) { await db.from('wa_conversations').insert({ user_id: userId, phone, contact_name: name.trim() }); }
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
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

    if (!userId || typeof userId !== 'string') {
      return res.status(400).send('User ID não encontrado.');
    }
    if (!supabaseAdmin) {
      return res.status(500).send('Service role indisponível no servidor.');
    }

    try {
      const client = getOAuth2Client(redirectUri);
      const { tokens } = await client.getToken({ code: code as string, redirect_uri: redirectUri });

      // Usa supabaseAdmin (service_role) pra bypassar RLS — callback é anônimo
      const { error: upsertError } = await supabaseAdmin.from('google_auth').upsert({
        user_id: userId,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expiry_date: tokens.expiry_date
      });
      if (upsertError) {
        console.error('[google-auth] Erro ao salvar token:', upsertError);
        return res.status(500).send('Erro ao salvar credenciais Google.');
      }

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
      // SÓ pull (Google → CRM). Push em massa removido em 2026-05-31 porque
      // criava centenas de eventos duplicados no Calendar do usuário. Push
      // individual continua nas rotas POST/PATCH de jobs (push só quando user
      // explicitamente cria/edita 1 job no CRM).
      const pullResult = await pullFromGoogleCalendar(supabase, userId);
      res.json({ success: true, ...pullResult });
    } catch (error) {
      console.error('Error syncing all jobs:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ============ CLIENTS ROUTES ============
  // Lista origens de lead "como nos conheceu" — defaults + o que o user já
  // cadastrou. Permite UI de combobox com sugestões dinâmicas (datalist).
  app.get('/api/lead-sources', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const defaults = ['Instagram', 'WhatsApp', 'Patrocinado', 'Indicação', 'Google', 'Outros'];
    const { data } = await supabase
      .from('clients')
      .select('lead_source')
      .eq('user_id', userId)
      .not('lead_source', 'is', null);
    const used = new Set<string>();
    (data ?? []).forEach((r: any) => {
      const v = String(r.lead_source ?? '').trim();
      if (v) used.add(v);
    });
    // Union: defaults primeiro, depois custom (alfabético)
    const customSorted = Array.from(used)
      .filter((v) => !defaults.includes(v))
      .sort((a, b) => a.localeCompare(b, 'pt-BR'));
    res.json([...defaults, ...customSorted]);
  });

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

    const limit = await checkPlanLimit(supabase, userId, 'clients');
    if (!limit.allowed) {
      return res.status(403).json({
        error: `Limite do plano atingido (${limit.current}/${limit.max} clientes). Faça upgrade pra continuar.`,
        limit_reached: 'clients',
        current: limit.current,
        max: limit.max,
        plan_slug: limit.planSlug,
      });
    }

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

    // Limit explícito acima do default PostgREST (1000) pra não cortar jobs
    // antigos quando user tem muitos. Bug encontrado em 2026-06-02:
    // a Pitori tinha 2696 jobs (a maioria lixo do pull antigo + reais antigos
    // com production_stage). Sem limit, o cap default de 1000 retornava
    // só os mais recentes (job_date desc), escondendo os jobs reais com
    // production_stage e fazendo o board de Produção parecer vazio.
    const { data: jobs } = await supabase
      .from('jobs')
      .select('*, clients(name)')
      .eq('user_id', userId)
      .order('job_date', { ascending: false })
      .limit(10000);

    // Agrega pagamentos por job (1 query extra para todos os jobs)
    const jobIds = (jobs || []).map((j: any) => j.id);
    const amountPaidByJob = new Map<number, number>();
    if (jobIds.length > 0) {
      try {
        const adminClient = supabaseAdmin || supabase;
        const { data: pmts } = await adminClient
          .from('job_payments')
          .select('job_id, amount')
          .in('job_id', jobIds);
        (pmts || []).forEach((p: any) => {
          amountPaidByJob.set(p.job_id, (amountPaidByJob.get(p.job_id) || 0) + (p.amount || 0));
        });
      } catch {}
    }

    const jobsFormatted = (jobs || []).map((j: any) => ({
      ...j,
      client_name: (j.clients as any)?.name || null,
      // production_stage só é definido quando o usuário envia explicitamente
      // pra produção. Trabalhos com null não aparecem no kanban.
      production_stage: j.production_stage || null,
      amount_paid: amountPaidByJob.get(j.id) || 0,
    }));

    res.json(jobsFormatted);
  });

  app.post('/api/jobs', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;

    const limit = await checkPlanLimit(supabase, userId, 'jobs');
    if (!limit.allowed) {
      return res.status(403).json({
        error: `Limite do plano atingido (${limit.current}/${limit.max} jobs). Faça upgrade pra continuar.`,
        limit_reached: 'jobs',
        current: limit.current,
        max: limit.max,
        plan_slug: limit.planSlug,
      });
    }

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

    // Trabalho novo entra fora da produção. O usuário envia explicitamente
    // pra produção via botão "Enviar para produção" no detalhe do trabalho.
    let { data, error } = await supabase.from('jobs').insert(baseJobPayload).select().single();

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

  // POST /api/jobs/pacote-acompanhamento — gera os trabalhos (sessões) de um
  // pacote de acompanhamento de uma vez. O dinheiro entra como UMA receita só.
  app.post('/api/jobs/pacote-acompanhamento', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { client_id, identificacao, sessoes, production_stage, valor, data_pagamento } = req.body;
    if (!client_id || !Array.isArray(sessoes) || sessoes.length === 0) {
      return res.status(400).json({ error: 'client_id e sessoes são obrigatórios' });
    }

    const nomeBase = String(identificacao || '').trim();
    let criados = 0;
    for (const raw of sessoes) {
      const sessao = String(raw || '').trim();
      if (!sessao) continue;
      const job_name = nomeBase ? `${nomeBase} — ${sessao}` : `Acompanhamento — ${sessao}`;
      const { data: job } = await supabase.from('jobs').insert({
        user_id: userId,
        client_id,
        job_type: 'Acompanhamento',
        job_name,
        amount: 0,
        payment_status: 'paid',
        status: 'scheduled',
        production_stage: production_stage || null,
        labels: [sessao],
        fin_synced: true,
      }).select('id').single();
      if (job) criados++;
      // Garante a etiqueta da sessão na paleta da Produção
      try {
        const { data: existe } = await supabase
          .from('job_labels').select('id')
          .eq('user_id', userId).eq('name', sessao).maybeSingle();
        if (!existe) {
          await supabase.from('job_labels').insert({ user_id: userId, name: sessao, color: '#8b5cf6' });
        }
      } catch { /* tabela job_labels ausente — ignora */ }
    }

    // Receita única do pacote — o dinheiro entra uma vez só
    if (valor && Number(valor) > 0) {
      try {
        const hoje = new Date().toISOString().slice(0, 10);
        const { data: cli } = await supabase.from('clients').select('name').eq('id', client_id).maybeSingle();
        await supabase.from('fin_receitas').insert({
          user_id: userId,
          cliente_id: client_id,
          cliente_nome: (cli as any)?.name || nomeBase || null,
          descricao: `Pacote Acompanhamento${nomeBase ? ' — ' + nomeBase : ''}`,
          valor_bruto: Number(valor), taxa_meio: 0, valor_liquido: Number(valor),
          data_vencimento: data_pagamento || hoje,
          data_pagamento: data_pagamento || hoje,
          status: 'recebido', parcela: 1, total_parcelas: 1,
          origem_automatica: false,
          updated_at: new Date().toISOString(),
        });
      } catch { /* tabelas do Financeiro ausentes — ignora */ }
    }

    res.json({ criados });
  });

  app.put('/api/jobs/:id', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { client_id, job_type, job_date, job_time, job_end_time, job_name, amount, payment_method, payment_status, status, notes, production_stage, position, cover_image_url, labels } = req.body;

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
    if (position !== undefined) updatePayload.position = Number(position) || 0;
    if (cover_image_url !== undefined) updatePayload.cover_image_url = cover_image_url || null;
    if (labels !== undefined) updatePayload.labels = Array.isArray(labels) ? labels : null;

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

  // Reordenar jobs em uma etapa. Body: { stage_id, job_ids: [in order] }
  // Atualiza o campo position de cada job em massa via supabaseAdmin pra
  // bypassar RLS quirky de updates múltiplos.
  app.post('/api/jobs/reorder', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const adminClient = supabaseAdmin || supabase;
    const { stage_id, job_ids } = req.body || {};
    if (!stage_id || !Array.isArray(job_ids)) {
      return res.status(400).json({ error: 'stage_id e job_ids[] obrigatórios' });
    }
    try {
      await Promise.all(
        job_ids.map((id: number, idx: number) =>
          adminClient
            .from('jobs')
            .update({ position: idx })
            .eq('id', id)
            .eq('user_id', userId)
            .eq('production_stage', stage_id),
        ),
      );
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Upload de imagem de capa do job. Body: { dataUrl: "data:image/...;base64,..." }
  // Sobe pro Supabase Storage (bucket 'job-covers'), salva URL pública.
  let jobCoversBucketReady = false;
  async function ensureJobCoversBucket() {
    if (jobCoversBucketReady || !supabaseAdmin) return;
    try {
      const { data: buckets } = await supabaseAdmin.storage.listBuckets();
      const exists = (buckets || []).some((b: any) => b.name === 'job-covers');
      if (!exists) {
        await supabaseAdmin.storage.createBucket('job-covers', { public: true, fileSizeLimit: 5_242_880 });
      }
      jobCoversBucketReady = true;
    } catch (e: any) {
      console.error('[jobs/cover] erro criando bucket:', e?.message);
    }
  }

  app.post('/api/jobs/:id/cover', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    if (!supabaseAdmin) return res.status(500).json({ error: 'Storage indisponível' });
    const jobId = Number(req.params.id);

    const { data: job } = await supabase.from('jobs').select('id').eq('id', jobId).eq('user_id', userId).single();
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const dataUrl: string = String(req.body?.dataUrl || '');
    const match = dataUrl.match(/^data:(image\/[a-z+]+);base64,(.+)$/i);
    if (!match) return res.status(400).json({ error: 'dataUrl inválido' });
    const mime = match[1];
    const buffer = Buffer.from(match[2], 'base64');
    if (buffer.length > 5_242_880) return res.status(400).json({ error: 'Imagem muito grande (>5MB)' });

    await ensureJobCoversBucket();
    const ext = mime.split('/')[1]?.split('+')[0] || 'jpg';
    const filename = `${userId}/${jobId}-${Date.now()}.${ext}`;
    const { error: upErr } = await supabaseAdmin.storage.from('job-covers').upload(filename, buffer, {
      contentType: mime,
      upsert: false,
    });
    if (upErr) return res.status(500).json({ error: `Upload falhou: ${upErr.message}` });

    const { data: pub } = supabaseAdmin.storage.from('job-covers').getPublicUrl(filename);
    const url = pub?.publicUrl;
    if (!url) return res.status(500).json({ error: 'Falha ao gerar URL pública' });

    await supabase.from('jobs').update({ cover_image_url: url }).eq('id', jobId).eq('user_id', userId);
    res.json({ cover_image_url: url });
  });

  // Remove a foto de capa
  app.delete('/api/jobs/:id/cover', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const jobId = Number(req.params.id);
    await supabase.from('jobs').update({ cover_image_url: null }).eq('id', jobId).eq('user_id', userId);
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

  // ============ JOB FINANCEIRO ============

  // GET /api/jobs/:id/financeiro — itens do deal vinculado + job_items + pagamentos
  app.get('/api/jobs/:id/financeiro', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const adminClient = supabaseAdmin || supabase;
    const jobId = Number(req.params.id);

    // Verifica ownership do job
    const { data: job } = await supabase.from('jobs').select('id, amount, notes, payment_method, payment_status, job_type, job_name').eq('id', jobId).eq('user_id', userId).single();
    if (!job) return res.status(404).json({ error: 'Job not found' });

    // Busca deal vinculado (converted_job_id = jobId)
    const { data: deal } = await supabase
      .from('deals')
      .select('id, value, title, discount')
      .eq('converted_job_id', jobId)
      .eq('user_id', userId)
      .maybeSingle();

    // Busca deal_items do deal vinculado
    let dealItems: any[] = [];
    if (deal?.id) {
      const { data } = await adminClient.from('deal_items').select('*').eq('deal_id', deal.id).order('created_at');
      dealItems = data || [];
    }

    // Busca job_items (adicionados diretamente ao job na aba financeiro)
    let jobItems: any[] = [];
    try {
      const { data } = await adminClient.from('job_items').select('*').eq('job_id', jobId).order('created_at');
      jobItems = data || [];
    } catch { jobItems = []; }

    // Busca pagamentos do job
    let payments: any[] = [];
    try {
      const { data } = await adminClient.from('job_payments').select('*').eq('job_id', jobId).order('payment_date').order('created_at');
      payments = data || [];
    } catch { payments = []; }

    // Fallback: se não há pagamentos mas há sinal nas notas, cria o registro automaticamente
    if (payments.length === 0 && job.notes) {
      const match = job.notes.match(/Sinal pago:\s*R\$\s*([\d.,]+)/i);
      if (match) {
        const sinalStr = match[1].replace(/\./g, '').replace(',', '.');
        const sinalValue = parseFloat(sinalStr);
        if (sinalValue > 0) {
          try {
            const { data: created } = await adminClient.from('job_payments').insert({
              job_id: jobId,
              amount: sinalValue,
              description: 'Sinal',
              payment_date: new Date().toISOString().slice(0, 10),
              payment_method: job.payment_method || 'Pix',
            }).select();
            if (created && created.length > 0) payments = created;
          } catch { /* ignora se job_payments ainda não existe */ }
        }
      }
    }

    const totalPago = payments.reduce((s: number, p: any) => s + (p.amount || 0), 0);

    // Recalcula o total real a partir dos itens (auto-corrige payment_status desatualizado)
    const dealItemsTotal = dealItems.reduce((s: number, i: any) => s + (i.catalog_value || 0) * (i.quantidade || 1), 0);
    const jobItemsTotal = jobItems.reduce((s: number, i: any) => s + (i.catalog_value || 0) * (i.quantidade || 1), 0);
    // Deal jobs: total = deal_items (se houver) ou deal.value (fallback) + job_items
    // Non-deal jobs: total = job.amount (base manual) + job_items (extras), never overwrite job.amount
    // Desconto do pacote (deal.discount) abate só quando o pacote é sintético (sem deal_items)
    const dealDiscount = Math.max(0, Number((deal as any)?.discount) || 0);
    const packageGross = deal?.value || job.amount || 0;
    const dealBase = dealItems.length > 0 ? dealItemsTotal : Math.max(0, packageGross - dealDiscount);
    const realTotal = deal?.id
      ? dealBase + jobItemsTotal
      : job.amount + jobItemsTotal;
    const correctStatus = totalPago <= 0 ? 'pending' : (realTotal > 0 && totalPago >= realTotal) ? 'paid' : 'partial';

    // Corrige silenciosamente se o status ou amount estiver desatualizado
    const statusChanged = correctStatus !== job.payment_status;
    // Para deal jobs: atualiza job.amount com o total recalculado
    // Para non-deal jobs: NÃO sobrescreve job.amount (base manual imutável)
    const dealAmountChanged = deal?.id && Math.abs(realTotal - job.amount) > 0.01;
    if (dealAmountChanged || statusChanged) {
      const upd: any = { payment_status: correctStatus };
      if (dealAmountChanged) upd.amount = realTotal;
      await supabase.from('jobs').update(upd).eq('id', jobId).eq('user_id', userId);
    }

    // Item do pacote/valor mostrado na seção "Itens do negócio":
    // - deal jobs sem deal_items → pacote sintético (nome/valor/desconto, source 'deal')
    // - jobs sem negócio vinculado → valor base do trabalho editável (source 'job')
    let packageItem: { name: string; value: number; discount: number; source: 'deal' | 'job' } | null = null;
    if (deal?.id) {
      if (dealItems.length === 0 && packageGross > 0) {
        packageItem = {
          name: (deal as any)?.title || (job as any).job_name || (job as any).job_type || 'Pacote',
          value: packageGross,
          discount: dealDiscount,
          source: 'deal',
        };
      }
    } else {
      packageItem = {
        name: (job as any).job_name || (job as any).job_type || 'Valor do trabalho',
        value: job.amount || 0,
        discount: 0,
        source: 'job',
      };
    }

    res.json({ dealItems, jobItems, payments, totalPago, jobAmount: realTotal, payment_status: correctStatus, packageItem });
  });

  // PUT /api/jobs/:id/package — edita o pacote/valor base do trabalho.
  // - Job com negócio vinculado (sem deal_items): edita o pacote no deal
  //   (nome, valor, desconto) ou troca por outro do catálogo.
  // - Job sem negócio: edita só o valor base (job.amount).
  app.put('/api/jobs/:id/package', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const adminClient = supabaseAdmin || supabase;
    const jobId = Number(req.params.id);

    const { data: job } = await supabase.from('jobs').select('id').eq('id', jobId).eq('user_id', userId).single();
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const { data: deal } = await supabase
      .from('deals')
      .select('id')
      .eq('converted_job_id', jobId)
      .eq('user_id', userId)
      .maybeSingle();

    // Job sem negócio vinculado → edita o valor base direto no job
    if (!deal?.id) {
      if (req.body.value === undefined) return res.json({ ok: true });
      const { error } = await supabase
        .from('jobs')
        .update({ amount: Math.max(0, Number(req.body.value) || 0) })
        .eq('id', jobId)
        .eq('user_id', userId);
      if (error) return res.status(500).json({ error: error.message });
      return res.json({ ok: true });
    }

    // Se o negócio já tem itens detalhados, o pacote não é editável por aqui
    const { data: existingItems } = await adminClient.from('deal_items').select('id').eq('deal_id', deal.id).limit(1);
    if (existingItems && existingItems.length > 0) {
      return res.status(400).json({ error: 'Negócio tem itens detalhados — edite pelos itens.' });
    }

    const upd: any = {};
    if (req.body.name !== undefined) upd.title = String(req.body.name).trim() || 'Pacote';
    if (req.body.value !== undefined) upd.value = Math.max(0, Number(req.body.value) || 0);
    if (req.body.discount !== undefined) upd.discount = Math.max(0, Number(req.body.discount) || 0);
    if (Object.keys(upd).length === 0) return res.json({ ok: true });

    const { error } = await supabase.from('deals').update(upd).eq('id', deal.id).eq('user_id', userId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  });

  // POST /api/jobs/:id/payments — registrar um pagamento
  app.post('/api/jobs/:id/payments', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const adminClient = supabaseAdmin || supabase;
    const jobId = Number(req.params.id);

    const { data: job } = await supabase.from('jobs').select('id, amount').eq('id', jobId).eq('user_id', userId).single();
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const { amount, description, payment_date, payment_method } = req.body;
    if (!amount || amount <= 0) return res.status(400).json({ error: 'amount obrigatório e > 0' });

    const { data: payment, error } = await adminClient.from('job_payments').insert({
      job_id: jobId,
      amount: Number(amount),
      description: description || null,
      payment_date: payment_date || new Date().toISOString().slice(0, 10),
      payment_method: payment_method || 'Pix',
    }).select().single();

    if (error) return res.status(500).json({ error: error.message });

    // Recalcula total pago e atualiza payment_status no job
    const { data: allPayments } = await adminClient.from('job_payments').select('amount').eq('job_id', jobId);
    const totalPago = (allPayments || []).reduce((s: number, p: any) => s + (p.amount || 0), 0);
    const newStatus = totalPago <= 0 ? 'pending' : (job.amount > 0 && totalPago >= job.amount) ? 'paid' : 'partial';
    await supabase.from('jobs').update({ payment_status: newStatus }).eq('id', jobId).eq('user_id', userId);

    res.json({ payment, totalPago, newStatus });
  });

  // DELETE /api/job-payments/:id
  app.delete('/api/job-payments/:id', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const adminClient = supabaseAdmin || supabase;

    const { data: payment } = await adminClient.from('job_payments').select('id, job_id, amount').eq('id', req.params.id).single();
    if (!payment) return res.status(404).json({ error: 'Not found' });

    // Garante ownership via job
    const { data: job } = await supabase.from('jobs').select('id, amount').eq('id', payment.job_id).eq('user_id', userId).single();
    if (!job) return res.status(403).json({ error: 'Forbidden' });

    await adminClient.from('job_payments').delete().eq('id', req.params.id);

    const { data: remaining } = await adminClient.from('job_payments').select('amount').eq('job_id', payment.job_id);
    const totalPago = (remaining || []).reduce((s: number, p: any) => s + (p.amount || 0), 0);
    const newStatus = totalPago <= 0 ? 'pending' : (job.amount > 0 && totalPago >= job.amount) ? 'paid' : 'partial';
    await supabase.from('jobs').update({ payment_status: newStatus }).eq('id', payment.job_id).eq('user_id', userId);

    res.json({ success: true, totalPago, newStatus });
  });

  // POST /api/jobs/:id/items — adicionar item ao job
  app.post('/api/jobs/:id/items', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const adminClient = supabaseAdmin || supabase;
    const jobId = Number(req.params.id);

    const { data: job } = await supabase.from('jobs').select('id, amount, labels, clients(name)').eq('id', jobId).eq('user_id', userId).single();
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const { catalog_type, catalog_id, catalog_name, catalog_value, quantidade = 1, discount_value = 0 } = req.body;
    if (!catalog_type || !catalog_id || !catalog_name) return res.status(400).json({ error: 'Campos obrigatórios ausentes' });

    const { data: item, error } = await adminClient.from('job_items').insert({
      job_id: jobId, catalog_type, catalog_id, catalog_name,
      catalog_value: catalog_value || 0, quantidade,
      discount_value: Number(discount_value) || 0,
    }).select().single();

    if (error) return res.status(500).json({ error: error.message });

    // Dá baixa no estoque do produto (se ele controla estoque)
    await adjustProductStock(adminClient, catalog_type, catalog_id, -(Number(quantidade) || 1));
    // Produto sob encomenda → gera o pedido de compra automático
    await createOrderForProduct(
      adminClient, userId, jobId, item.id, catalog_type, catalog_id, catalog_name,
      Number(quantidade) || 1, ((job as any).clients?.name) || null,
    );

    // Auto-label "Álbum" se o produto adicionado tem "álbum" / "album" no nome.
    // Não usa \b porque em JS o word boundary não funciona com chars
    // não-ASCII (á), então normaliza acentos antes do match.
    const nameNorm = String(catalog_name)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '');
    if (/(^|[^a-z])album(s|es)?($|[^a-z])/.test(nameNorm)) {
      const currentLabels: string[] = Array.isArray(job.labels) ? job.labels : [];
      if (!currentLabels.includes('Álbum')) {
        await supabase
          .from('jobs')
          .update({ labels: [...currentLabels, 'Álbum'] })
          .eq('id', jobId)
          .eq('user_id', userId);
      }
    }

    const result = await recalcJobFinancials(supabase, adminClient, jobId, userId);
    res.json({ item, ...result });
  });

  // Helper: recalcula amount e payment_status de um job a partir de todos os itens
  async function recalcJobFinancials(supabase: SupabaseClient, adminClient: SupabaseClient, jobId: number, userId: string) {
    const { data: job } = await supabase.from('jobs').select('id, amount').eq('id', jobId).eq('user_id', userId).single();
    if (!job) return { newAmount: 0, payment_status: 'pending' };

    // Busca deal vinculado
    const { data: deal } = await supabase.from('deals').select('id, value').eq('converted_job_id', jobId).eq('user_id', userId).maybeSingle();

    const { data: jItems } = await adminClient.from('job_items').select('catalog_value, quantidade, discount_value').eq('job_id', jobId);
    const jobItemsTotal = (jItems || []).reduce((s: number, i: any) => {
      const gross = (i.catalog_value || 0) * (i.quantidade || 1);
      return s + Math.max(0, gross - (i.discount_value || 0));
    }, 0);

    let realTotal: number;
    if (deal?.id) {
      // Job convertido de deal: base = soma dos deal_items (se houver) ou deal.value como fallback.
      // Sem fallback, vendas sem itens detalhados zeravam o job.amount.
      const { data: dItems } = await adminClient.from('deal_items').select('catalog_value, quantidade').eq('deal_id', deal.id);
      const items = dItems || [];
      const dealTotal = items.reduce((s: number, i: any) => s + (i.catalog_value || 0) * (i.quantidade || 1), 0);
      const dealBase = items.length > 0 ? dealTotal : (deal.value || job.amount || 0);
      realTotal = dealBase + jobItemsTotal;
      // Atualiza job.amount para refletir o total real
      await supabase.from('jobs').update({ amount: realTotal }).eq('id', jobId).eq('user_id', userId);
    } else {
      // Job direto: base = job.amount original (imutável). Não sobrescrevemos job.amount.
      // job.amount pode estar corrompido de operações anteriores; usamos ele como está.
      realTotal = job.amount + jobItemsTotal;
      // Não atualiza job.amount para não acumular erros
    }

    const { data: allPayments } = await adminClient.from('job_payments').select('amount').eq('job_id', jobId);
    const totalPago = (allPayments || []).reduce((s: number, p: any) => s + (p.amount || 0), 0);
    const newStatus = totalPago <= 0 ? 'pending' : (realTotal > 0 && totalPago >= realTotal) ? 'paid' : 'partial';
    await supabase.from('jobs').update({ payment_status: newStatus }).eq('id', jobId).eq('user_id', userId);

    return { newAmount: realTotal, payment_status: newStatus };
  }

  // Helper: ajusta o estoque de um produto do catálogo (delta +/-).
  // Só mexe se o item é um produto e o produto controla estoque.
  async function adjustProductStock(adminClient: SupabaseClient, catalogType: string, catalogId: string, delta: number) {
    if (catalogType !== 'produto' || !catalogId || !delta) return;
    try {
      const { data: prod } = await adminClient
        .from('produtos')
        .select('id, controla_estoque, estoque')
        .eq('id', catalogId)
        .maybeSingle();
      if (!prod || !(prod as any).controla_estoque) return;
      const novo = (Number((prod as any).estoque) || 0) + delta;
      await adminClient.from('produtos').update({ estoque: novo }).eq('id', catalogId);
    } catch { /* coluna controla_estoque ainda não existe — ignora */ }
  }

  // Helper: gera um pedido de compra automático quando um produto
  // "sob encomenda" é adicionado a um trabalho.
  async function createOrderForProduct(
    adminClient: SupabaseClient, userId: string, jobId: number, jobItemId: string,
    catalogType: string, catalogId: string, catalogName: string, quantidade: number,
    clienteNome: string | null,
  ) {
    if (catalogType !== 'produto' || !catalogId) return;
    try {
      const { data: prod } = await adminClient
        .from('produtos')
        .select('id, sob_encomenda')
        .eq('id', catalogId)
        .maybeSingle();
      if (!prod || !(prod as any).sob_encomenda) return;
      await adminClient.from('compras').insert({
        user_id: userId,
        produto_id: catalogId,
        produto_nome: catalogName,
        quantidade: Math.max(1, Number(quantidade) || 1),
        status: 'analise',
        job_id: jobId,
        job_item_id: String(jobItemId),
        cliente_nome: clienteNome,
      });
    } catch { /* coluna sob_encomenda / tabela compras ainda não existe — ignora */ }
  }

  // PATCH /api/job-items/:id — atualizar quantidade
  app.patch('/api/job-items/:id', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const adminClient = supabaseAdmin || supabase;

    const { data: item } = await adminClient.from('job_items').select('id, job_id, catalog_type, catalog_id, catalog_value, quantidade').eq('id', req.params.id).single();
    if (!item) return res.status(404).json({ error: 'Not found' });

    const { data: job } = await supabase.from('jobs').select('id').eq('id', item.job_id).eq('user_id', userId).single();
    if (!job) return res.status(403).json({ error: 'Forbidden' });

    // Aceita patch parcial: quantidade, catalog_value (preço editado),
    // discount_value (R$ de desconto). Frontend pode mandar só o que mudou.
    const patch: any = {};
    if (req.body.quantidade !== undefined) {
      patch.quantidade = Math.max(1, parseInt(req.body.quantidade) || 1);
    }
    if (req.body.catalog_value !== undefined) {
      patch.catalog_value = Math.max(0, Number(req.body.catalog_value) || 0);
    }
    if (req.body.discount_value !== undefined) {
      patch.discount_value = Math.max(0, Number(req.body.discount_value) || 0);
    }
    if (Object.keys(patch).length === 0) return res.json({ success: true });

    await adminClient.from('job_items').update(patch).eq('id', req.params.id);

    // Mudou a quantidade → ajusta o estoque pela diferença
    if (patch.quantidade !== undefined && patch.quantidade !== item.quantidade) {
      await adjustProductStock(adminClient, item.catalog_type, item.catalog_id, -(patch.quantidade - item.quantidade));
      // Sincroniza a quantidade no pedido automático ainda em análise
      try {
        await adminClient.from('compras')
          .update({ quantidade: patch.quantidade })
          .eq('job_item_id', String(req.params.id))
          .eq('status', 'analise');
      } catch { /* tabela compras ainda não existe — ignora */ }
    }

    const result = await recalcJobFinancials(supabase, adminClient, item.job_id, userId);
    res.json({ success: true, ...result });
  });

  // DELETE /api/job-items/:id
  app.delete('/api/job-items/:id', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const adminClient = supabaseAdmin || supabase;

    const { data: item } = await adminClient.from('job_items').select('id, job_id, catalog_type, catalog_id, catalog_value, quantidade').eq('id', req.params.id).single();
    if (!item) return res.status(404).json({ error: 'Not found' });

    const { data: job } = await supabase.from('jobs').select('id').eq('id', item.job_id).eq('user_id', userId).single();
    if (!job) return res.status(403).json({ error: 'Forbidden' });

    await adminClient.from('job_items').delete().eq('id', req.params.id);

    // Item removido → devolve a quantidade ao estoque do produto
    await adjustProductStock(adminClient, item.catalog_type, item.catalog_id, Number(item.quantidade) || 1);
    // Remove o pedido automático ligado a esse item, se ainda em análise
    try {
      await adminClient.from('compras')
        .delete()
        .eq('job_item_id', String(req.params.id))
        .eq('status', 'analise');
    } catch { /* tabela compras ainda não existe — ignora */ }

    const result = await recalcJobFinancials(supabase, adminClient, item.job_id, userId);
    res.json({ success: true, ...result });
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

  // Helper: lança uma despesa no Financeiro a partir de um pedido comprado.
  async function createExpenseFromCompra(
    adminClient: SupabaseClient, userId: string, compra: any, valorPago: number,
  ): Promise<string | null> {
    try {
      // Categoria "Produtos e Insumos" (cria se ainda não existir)
      let categoriaId: string | null = null;
      const { data: cat } = await adminClient
        .from('fin_categorias')
        .select('id')
        .eq('user_id', userId)
        .eq('tipo', 'despesa')
        .eq('nome', 'Produtos e Insumos')
        .maybeSingle();
      if (cat) {
        categoriaId = (cat as any).id;
      } else {
        const { data: novaCat } = await adminClient
          .from('fin_categorias')
          .insert({ user_id: userId, nome: 'Produtos e Insumos', tipo: 'despesa', cor: '#8b5cf6', ordem: 99, ativo: true })
          .select('id')
          .single();
        categoriaId = (novaCat as any)?.id || null;
      }

      // Fornecedor do produto (se houver)
      let fornecedor: string | null = null;
      if (compra.produto_id) {
        const { data: prod } = await adminClient
          .from('produtos')
          .select('fornecedor_id, fornecedores(nome)')
          .eq('id', compra.produto_id)
          .maybeSingle();
        fornecedor = ((prod as any)?.fornecedores?.nome) || null;
      }

      const hoje = new Date().toISOString().slice(0, 10);
      const descricao = compra.cliente_nome
        ? `Compra: ${compra.produto_nome} — ${compra.cliente_nome}`
        : `Compra: ${compra.produto_nome}`;
      const { data: desp } = await adminClient
        .from('fin_despesas')
        .insert({
          user_id: userId,
          descricao,
          fornecedor,
          valor: valorPago,
          data_vencimento: hoje,
          data_pagamento: hoje,
          status: 'pago',
          categoria_id: categoriaId,
        })
        .select('id')
        .single();
      return (desp as any)?.id || null;
    } catch {
      return null; // tabelas do Financeiro ausentes/incompatíveis — ignora
    }
  }

  // ============ COMPRAS (reposição de estoque) ============

  // GET /api/compras — lista os pedidos de compra
  app.get('/api/compras', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { data, error } = await supabase
      .from('compras')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) {
      if (error.code === '42P01') return res.json([]);
      return res.status(500).json({ error: error.message });
    }
    res.json(data || []);
  });

  // POST /api/compras — cria um pedido de compra (entra em "análise")
  app.post('/api/compras', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { produto_id, quantidade, observacao } = req.body;
    if (!produto_id) return res.status(400).json({ error: 'produto_id é obrigatório' });

    const { data: prod } = await supabase
      .from('produtos')
      .select('id, nome')
      .eq('id', produto_id)
      .eq('user_id', userId)
      .maybeSingle();
    if (!prod) return res.status(404).json({ error: 'Produto não encontrado' });

    const { data, error } = await supabase
      .from('compras')
      .insert({
        user_id: userId,
        produto_id,
        produto_nome: (prod as any).nome,
        quantidade: Math.max(1, Number(quantidade) || 1),
        status: 'analise',
        observacao: observacao || null,
      })
      .select()
      .single();
    if (error) {
      if (error.code === '42P01') {
        return res.status(400).json({ error: 'Tabela compras não existe. Rode a migration 016_compras.sql no Supabase.' });
      }
      return res.status(500).json({ error: error.message });
    }
    res.json(data);
  });

  // PATCH /api/compras/:id — muda status/quantidade. Ao virar "comprado",
  // o estoque do produto sobe pela quantidade do pedido.
  app.patch('/api/compras/:id', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const adminClient = supabaseAdmin || supabase;

    const { data: current } = await supabase
      .from('compras')
      .select('*')
      .eq('id', req.params.id)
      .eq('user_id', userId)
      .single();
    if (!current) return res.status(404).json({ error: 'Pedido não encontrado' });

    const patch: any = {};
    if (req.body.quantidade !== undefined) patch.quantidade = Math.max(1, Number(req.body.quantidade) || 1);
    if (req.body.observacao !== undefined) patch.observacao = req.body.observacao || null;
    if (req.body.valor_pago !== undefined) patch.valor_pago = Math.max(0, Number(req.body.valor_pago) || 0);
    if (req.body.status !== undefined) {
      const allowed = ['analise', 'aprovado', 'comprado', 'cancelado'];
      if (!allowed.includes(req.body.status)) return res.status(400).json({ error: 'status inválido' });
      patch.status = req.body.status;
    }
    if (Object.keys(patch).length === 0) return res.json(current);
    patch.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('compras')
      .update(patch)
      .eq('id', req.params.id)
      .eq('user_id', userId)
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });

    // Transição para "comprado" (uma vez só)
    if (patch.status === 'comprado' && (current as any).status !== 'comprado') {
      const qtd = patch.quantidade !== undefined ? patch.quantidade : (current as any).quantidade;

      // Repõe o estoque — só vale pra produto que controla estoque
      if ((current as any).produto_id) {
        const { data: prod } = await adminClient
          .from('produtos')
          .select('id, estoque, controla_estoque')
          .eq('id', (current as any).produto_id)
          .maybeSingle();
        if (prod && (prod as any).controla_estoque) {
          const novo = (Number((prod as any).estoque) || 0) + (Number(qtd) || 0);
          await adminClient.from('produtos').update({ estoque: novo }).eq('id', (current as any).produto_id);
        }
      }

      // Lança a despesa no Financeiro com o valor real pago
      const valorPago = Number(req.body.valor_pago) || 0;
      if (valorPago > 0 && !(current as any).fin_despesa_id) {
        const despId = await createExpenseFromCompra(adminClient, userId, { ...current, ...patch }, valorPago);
        if (despId) {
          await adminClient.from('compras').update({ fin_despesa_id: despId }).eq('id', req.params.id);
          (data as any).fin_despesa_id = despId;
        }
      }
    }
    res.json(data);
  });

  // DELETE /api/compras/:id
  app.delete('/api/compras/:id', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { error } = await supabase.from('compras').delete().eq('id', req.params.id).eq('user_id', userId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  });

  // POST /api/compras/backfill — varre os trabalhos já existentes e gera os
  // pedidos de compra dos produtos "sob encomenda" que ainda não têm pedido.
  app.post('/api/compras/backfill', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const adminClient = supabaseAdmin || supabase;

    // 1. Produtos marcados como sob encomenda
    const { data: prods, error: prodErr } = await supabase
      .from('produtos')
      .select('id, nome')
      .eq('user_id', userId)
      .eq('sob_encomenda', true);
    if (prodErr) return res.status(500).json({ error: prodErr.message });
    if (!prods || prods.length === 0) {
      return res.json({ created: 0, message: 'Nenhum produto está marcado como "sob encomenda".' });
    }
    const prodMap = new Map(prods.map((p: any) => [String(p.id), p.nome]));

    // 2. Trabalhos do usuário (ignora cancelados) + nome do cliente
    const { data: jobs } = await supabase
      .from('jobs')
      .select('id, status, clients(name)')
      .eq('user_id', userId);
    const validJobs = new Map<number, string | null>();
    for (const j of jobs || []) {
      if ((j as any).status === 'cancelled') continue;
      validJobs.set((j as any).id, ((j as any).clients?.name) || null);
    }

    // 3. Itens de trabalho que são produtos sob encomenda
    const { data: items } = await adminClient
      .from('job_items')
      .select('id, job_id, catalog_id, catalog_name, quantidade')
      .in('catalog_id', Array.from(prodMap.keys()));

    // 4. Pedidos já existentes ligados a um item (pra não duplicar)
    const { data: existentes } = await supabase
      .from('compras')
      .select('job_item_id')
      .eq('user_id', userId)
      .not('job_item_id', 'is', null);
    const jaTem = new Set((existentes || []).map((c: any) => String(c.job_item_id)));

    // 5. Cria os pedidos faltantes
    const novas: any[] = [];
    for (const it of items || []) {
      const jobId = (it as any).job_id;
      if (!validJobs.has(jobId)) continue;          // trabalho não é do usuário ou está cancelado
      if (jaTem.has(String((it as any).id))) continue; // já tem pedido
      novas.push({
        user_id: userId,
        produto_id: (it as any).catalog_id,
        produto_nome: (it as any).catalog_name || prodMap.get(String((it as any).catalog_id)) || 'Produto',
        quantidade: Math.max(1, Number((it as any).quantidade) || 1),
        status: 'analise',
        job_id: jobId,
        job_item_id: String((it as any).id),
        cliente_nome: validJobs.get(jobId) || null,
      });
    }
    if (novas.length === 0) {
      return res.json({ created: 0, message: 'Nenhuma venda nova — tudo já está sincronizado.' });
    }
    const { error } = await adminClient.from('compras').insert(novas);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ created: novas.length });
  });

  // GET /api/relatorios/vendas?mes=YYYY-MM — relatório mensal de vendas
  app.get('/api/relatorios/vendas', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const adminClient = supabaseAdmin || supabase;

    const mesParam = String(req.query.mes || '');
    const now = new Date();
    const mm = mesParam.match(/^(\d{4})-(\d{2})$/);
    const ano = mm ? Number(mm[1]) : now.getFullYear();
    const mes = mm ? Number(mm[2]) : now.getMonth() + 1;
    const inicio = new Date(Date.UTC(ano, mes - 1, 1)).toISOString();
    const fim = new Date(Date.UTC(ano, mes, 1)).toISOString();

    // Resumo: trabalhos criados (vendidos) no mês
    const { data: jobsMes } = await supabase
      .from('jobs')
      .select('id, amount')
      .eq('user_id', userId)
      .gte('created_at', inicio)
      .lt('created_at', fim);
    const numTrabalhos = (jobsMes || []).length;
    const totalVendido = (jobsMes || []).reduce((s: number, j: any) => s + (Number(j.amount) || 0), 0);
    const ticketMedio = numTrabalhos > 0 ? totalVendido / numTrabalhos : 0;

    // Todos os trabalhos do usuário — pra filtrar job_items por dono
    const { data: allJobs } = await supabase.from('jobs').select('id').eq('user_id', userId);
    const jobIds = new Set((allJobs || []).map((j: any) => j.id));

    // Produtos vendidos: itens de trabalho criados no mês, agrupados por nome
    const { data: items } = await adminClient
      .from('job_items')
      .select('catalog_name, catalog_type, catalog_value, quantidade, discount_value, job_id')
      .gte('created_at', inicio)
      .lt('created_at', fim);
    const prodMap = new Map<string, any>();
    for (const it of items || []) {
      if (!jobIds.has((it as any).job_id)) continue;
      const nome = (it as any).catalog_name || 'Item';
      const qtd = Number((it as any).quantidade) || 1;
      const valor = Math.max(0, (Number((it as any).catalog_value) || 0) * qtd - (Number((it as any).discount_value) || 0));
      const cur = prodMap.get(nome) || { nome, tipo: (it as any).catalog_type || 'produto', quantidade: 0, valor: 0 };
      cur.quantidade += qtd;
      cur.valor += valor;
      prodMap.set(nome, cur);
    }
    const produtos = Array.from(prodMap.values()).sort((a, b) => b.valor - a.valor);

    // Pedidos de compra criados no mês, por status (custo estimado)
    let comprasMes: any[] = [];
    try {
      const { data } = await supabase
        .from('compras')
        .select('produto_id, quantidade, status, valor_pago')
        .eq('user_id', userId)
        .gte('created_at', inicio)
        .lt('created_at', fim);
      comprasMes = data || [];
    } catch { comprasMes = []; }
    const { data: prods } = await supabase.from('produtos').select('id, preco_custo').eq('user_id', userId);
    const custoMap = new Map((prods || []).map((p: any) => [String(p.id), Number(p.preco_custo) || 0]));
    const compras: any = {
      analise: { qtd: 0, custo: 0 },
      aprovado: { qtd: 0, custo: 0 },
      comprado: { qtd: 0, custo: 0 },
      cancelado: { qtd: 0, custo: 0 },
    };
    for (const c of comprasMes) {
      const st = (c as any).status || 'analise';
      if (!compras[st]) continue;
      compras[st].qtd += 1;
      // Comprado: usa o valor real pago; outros: estima pelo preço de custo
      const custo = (c as any).valor_pago != null
        ? Number((c as any).valor_pago) || 0
        : (custoMap.get(String((c as any).produto_id)) || 0) * (Number((c as any).quantidade) || 0);
      compras[st].custo += custo;
    }

    res.json({ periodo: { ano, mes }, resumo: { totalVendido, numTrabalhos, ticketMedio }, produtos, compras });
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
    if (!trigger_job_type || !target_job_type) {
      return res.status(400).json({ error: 'trigger_job_type e target_job_type são obrigatórios' });
    }

    // Não duplica: se já existe uma regra com mesmo gatilho + alvo, devolve ela
    const { data: existente } = await supabase
      .from('opportunity_rules')
      .select('id')
      .eq('user_id', userId)
      .eq('trigger_job_type', trigger_job_type)
      .eq('target_job_type', target_job_type)
      .maybeSingle();
    if (existente) {
      return res.status(409).json({ error: 'Já existe uma regra com esse gatilho e tipo.', id: (existente as any).id });
    }

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
    const adminClient = supabaseAdmin || supabase;

    const [dealsRes, clientsRes] = await Promise.all([
      supabase.from('deals').select('*').eq('user_id', userId),
      supabase.from('clients').select('id, name').eq('user_id', userId),
    ]);

    const clients = clientsRes.data || [];
    const clientMap = new Map<number, string>();
    clients.forEach((c) => clientMap.set(c.id, c.name));

    const dealsRaw = dealsRes.data || [];

    // Carrega itens de todos os deals (deal_items não tem user_id → usa admin)
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

    const activityMap = await fetchActivityMetrics(
      supabase,
      userId,
      dealsRaw.map((d: any) => d.id),
    );

    const deals = dealsRaw.map((deal: any) => {
      const activity = activityMap.get(deal.id);
      const { temperature, score } = calculateTemperature(deal, activity);
      const items = itemsMap.get(deal.id) || [];
      return {
        ...deal,
        stage_entered_at: deal.current_stage_entered_at || deal.stage_entered_at || deal.updated_at || deal.created_at,
        activity_count: activity?.count || 0,
        last_activity_at: activity?.last || null,
        temperature,
        temperature_score: score,
        client_name: deal.client_id ? clientMap.get(deal.client_id) || null : null,
        items,
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
    const { name, color, auto_follow_up_enabled, follow_up_delay_hours, follow_up_template_id } = req.body;

    const stages = await ensurePipelineStages(supabase, userId);
    const stage = stages.find((s) => s.id === id) || DEFAULT_STAGES.find((s) => s.id === id);
    if (!stage) return res.status(404).json({ error: 'Etapa não encontrada' });
    if (stage.is_final && name) return res.status(400).json({ error: 'Não é possível renomear etapa final' });

    const updatePayload: Record<string, any> = {
      name: name || stage.name,
      color: color || stage.color,
    };
    if (auto_follow_up_enabled !== undefined) updatePayload.auto_follow_up_enabled = auto_follow_up_enabled;
    if (follow_up_delay_hours !== undefined) updatePayload.follow_up_delay_hours = Number(follow_up_delay_hours);
    if (follow_up_template_id !== undefined) {
      updatePayload.follow_up_template_id = follow_up_template_id === null ? null : Number(follow_up_template_id);
    }

    const { error } = await supabase
      .from('deal_stages')
      .update(updatePayload)
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

  // Salva template de mensagem de follow-up para uma etapa
  app.patch('/api/pipeline/stages/:id/follow-up', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { id } = req.params;
    const { message } = req.body;
    if (typeof message !== 'string') return res.status(400).json({ error: 'message é obrigatório' });

    const { error } = await supabase
      .from('deal_stages')
      .update({ follow_up_message: message })
      .eq('id', id)
      .eq('user_id', userId);

    if (error) {
      if (error.message?.includes('follow_up_message') || error.code === '42703') {
        return res.status(422).json({ error: 'MIGRATION_NEEDED' });
      }
      return res.status(500).json({ error: error.message });
    }
    res.json({ success: true });
  });

  // Lista follow-ups agendados pendentes do usuário
  app.get('/api/pipeline/followups/pending', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { data, error } = await supabase
      .from('scheduled_followups')
      .select('id, phone, message, stage_id, scheduled_at, status, created_at')
      .eq('user_id', userId)
      .in('status', ['pending', 'processing'])
      .order('scheduled_at', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
  });

  // Dispara mensagem de follow-up para todos os deals de uma etapa que têm telefone
  app.post('/api/pipeline/stages/:id/blast', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { id } = req.params;
    const { message } = req.body;
    if (!message?.trim()) return res.status(400).json({ error: 'message é obrigatório' });

    const { data: dealsInStage, error: dealsErr } = await supabase
      .from('deals')
      .select('id, title, contact_name, contact_phone')
      .eq('user_id', userId)
      .eq('stage', id)
      .not('contact_phone', 'is', null);

    if (dealsErr) return res.status(500).json({ error: dealsErr.message });

    const targets = (dealsInStage || []).filter((d: any) => d.contact_phone?.trim());
    if (targets.length === 0) return res.json({ sent: 0, failed: 0, total: 0, errors: [] });

    const instanceName = `user_${userId.replace(/-/g, '_')}`;

    // Carrega conta Meta como fallback (uma consulta antes do loop)
    const { data: waAccount } = await supabase
      .from('whatsapp_business_accounts')
      .select('phone_number_id, access_token')
      .eq('user_id', userId)
      .eq('is_active', true)
      .maybeSingle();

    const blastMetaToken = waAccount?.access_token ? decryptIfNeeded(waAccount.access_token) : null;

    let sent = 0, failed = 0;
    const errors: string[] = [];

    for (const deal of targets) {
      const rawPhone = String(deal.contact_phone).replace(/\D/g, '');
      const phone = normalizeBrazilianPhone(rawPhone);
      const name = deal.contact_name || deal.title || '';
      const personalizedMsg = message.replace(/\{nome\}/gi, name);
      let ok = false;
      let failReason = '';

      try {
        // 1ª tentativa: Evolution API (só se for o provider configurado)
        if (WHATSAPP_PROVIDER === 'evolution' && EVOLUTION_API_URL && EVOLUTION_API_KEY) {
          const evoRes = await fetch(`${EVOLUTION_API_URL}/message/sendText/${instanceName}`, {
            method: 'POST',
            headers: { 'apikey': EVOLUTION_API_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({ number: phone, textMessage: { text: personalizedMsg } }),
          });
          if (evoRes.ok) {
            ok = true;
          } else {
            const evoData = await evoRes.json().catch(() => ({}));
            failReason = `Evolution ${evoRes.status}: ${evoData?.message || evoData?.error || ''}`;
            console.warn(`[Blast] Evolution falhou para ${phone}:`, failReason);
          }
        }

        // Meta API (provider principal se não for Evolution, ou fallback)
        if (!ok && waAccount?.phone_number_id && blastMetaToken) {
          const metaRes = await fetch(
            `https://graph.facebook.com/v21.0/${waAccount.phone_number_id}/messages`,
            {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${blastMetaToken}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ messaging_product: 'whatsapp', to: phone, type: 'text', text: { body: personalizedMsg } }),
            }
          );
          const metaData = await metaRes.json();
          if (metaRes.ok && !metaData.error) {
            ok = true;
          } else {
            const metaMsg = metaData?.error?.message || JSON.stringify(metaData?.error || {});
            failReason = failReason ? `${failReason} | Meta: ${metaMsg}` : `Meta: ${metaMsg}`;
            console.warn(`[Blast] Meta falhou para ${phone}:`, metaMsg);
          }
        }

        if (ok) {
          sent++;
          const now = new Date().toISOString();
          const msgId = `blast-${Date.now()}-${phone}`;
          const db = supabaseAdmin || supabase;
          await db.from('wa_messages').insert({
            user_id: userId, phone, body: personalizedMsg, from_me: true,
            timestamp: now, type: 'text', status: 'sent', message_id: msgId,
          });
          const blastConvPayload = { user_id: userId, phone, last_message: personalizedMsg, last_message_at: now, updated_at: now };
          const { data: blastUpd } = await db.from('wa_conversations').update(blastConvPayload).eq('user_id', userId).eq('phone', phone).select('id');
          if (!blastUpd || blastUpd.length === 0) { await db.from('wa_conversations').insert(blastConvPayload); }
        } else {
          failed++;
          errors.push(`${name} (${phone})${failReason ? ': ' + failReason : ''}`);
        }
      } catch (err: any) {
        failed++;
        errors.push(`${name} (${phone}): ${err.message || 'Erro de conexão'}`);
      }

      // 1s entre envios para não bloquear o WhatsApp
      await new Promise<void>((r) => setTimeout(r, 1000));
    }

    res.json({ sent, failed, total: targets.length, errors });
  });

  // ============ PIPELINE LABELS ============
  app.get('/api/pipeline/labels', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { data, error } = await supabase
      .from('pipeline_labels')
      .select('*')
      .eq('user_id', userId)
      .order('name', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
  });

  app.post('/api/pipeline/labels', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { name, color } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'name é obrigatório' });
    const { data, error } = await supabase
      .from('pipeline_labels')
      .insert({ user_id: userId, name: name.trim(), color: color || '#6B7280' })
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  });

  app.delete('/api/pipeline/labels/:id', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    await supabase.from('pipeline_labels').delete().eq('id', req.params.id).eq('user_id', userId);
    res.json({ success: true });
  });

  // ── Etiquetas da Produção (paleta padronizada, estilo Trello) ──────
  app.get('/api/jobs/labels', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { data, error } = await supabase
      .from('job_labels')
      .select('*')
      .eq('user_id', userId)
      .order('name', { ascending: true });
    if (error) {
      if (error.code === '42P01') return res.json([]);
      return res.status(500).json({ error: error.message });
    }
    res.json(data || []);
  });

  app.post('/api/jobs/labels', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { name, color } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'name é obrigatório' });
    const { data, error } = await supabase
      .from('job_labels')
      .insert({ user_id: userId, name: name.trim(), color: color || '#6B7280' })
      .select()
      .single();
    if (error) {
      if (error.code === '42P01') {
        return res.status(400).json({
          error: 'Tabela job_labels não existe. Rode a migration 013_job_labels.sql no Supabase.',
        });
      }
      return res.status(500).json({ error: error.message });
    }
    res.json(data);
  });

  // PUT /api/jobs/labels/:id — edita nome e/ou cor de uma etiqueta padrão.
  // Se o nome mudar, renomeia a etiqueta em todos os trabalhos que a usam.
  app.put('/api/jobs/labels/:id', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { name, color } = req.body;

    const { data: current } = await supabase
      .from('job_labels')
      .select('id, name, color')
      .eq('id', req.params.id)
      .eq('user_id', userId)
      .single();
    if (!current) return res.status(404).json({ error: 'Etiqueta não encontrada' });

    const newName = name !== undefined ? String(name).trim() : current.name;
    const newColor = color !== undefined ? color : current.color;
    if (!newName) return res.status(400).json({ error: 'name é obrigatório' });

    const { data, error } = await supabase
      .from('job_labels')
      .update({ name: newName, color: newColor })
      .eq('id', req.params.id)
      .eq('user_id', userId)
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });

    // Nome mudou → propaga pra todos os trabalhos que usam a etiqueta antiga
    if (newName !== current.name) {
      const { data: jobsWithLabels } = await supabase
        .from('jobs')
        .select('id, labels')
        .eq('user_id', userId)
        .not('labels', 'is', null);
      for (const j of jobsWithLabels || []) {
        const arr = Array.isArray((j as any).labels) ? (j as any).labels : [];
        if (arr.includes(current.name)) {
          const updated = arr.map((l: string) => (l === current.name ? newName : l));
          await supabase.from('jobs').update({ labels: updated }).eq('id', (j as any).id).eq('user_id', userId);
        }
      }
    }
    res.json(data);
  });

  app.delete('/api/jobs/labels/:id', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    await supabase.from('job_labels').delete().eq('id', req.params.id).eq('user_id', userId);
    res.json({ success: true });
  });

  app.patch('/api/deals/:id/labels', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { labels } = req.body;
    const { error } = await supabase
      .from('deals')
      .update({ labels: Array.isArray(labels) ? labels : [] })
      .eq('id', req.params.id)
      .eq('user_id', userId);
    if (error) return res.status(500).json({ error: error.message });
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

  app.post('/api/team-members', requireAuth, requireOwnerOrPlatformAdmin, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { name, email, color, permissions, password } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Nome obrigatório' });

    const limit = await checkPlanLimit(supabase, userId, 'team_members');
    if (!limit.allowed) {
      return res.status(403).json({
        error: `Limite do plano atingido (${limit.current}/${limit.max} membros). Faça upgrade pra continuar.`,
        limit_reached: 'team_members',
        current: limit.current,
        max: limit.max,
        plan_slug: limit.planSlug,
      });
    }

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

  app.put('/api/team-members/:id', requireAuth, requireOwnerOrPlatformAdmin, async (req, res) => {
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

  app.delete('/api/team-members/:id', requireAuth, requireOwnerOrPlatformAdmin, async (req, res) => {
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
    const { title, description, assignee_id, job_id, stage_id, client_id, due_date } = req.body;
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
        client_id: client_id || null,
        due_date,
      })
      .select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  });

  app.put('/api/tasks/:id', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { title, description, assignee_id, job_id, stage_id, client_id, due_date } = req.body;
    const { error } = await supabase
      .from('tasks')
      .update({
        title: title?.trim(),
        description: description?.trim() || null,
        assignee_id: assignee_id || null,
        job_id: job_id || null,
        stage_id: stage_id || null,
        client_id: client_id || null,
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

  // ============ AGENTE IA ============

  // Lê a config do agente. Se a tabela ainda não existe (migration 009 não
  // rodada), devolve os padrões + table_missing pra UI avisar.
  app.get('/api/agent/config', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    // select('*') é resiliente: se a migration 010 ainda não rodou, as
    // colunas objective/rules só não vêm — e caímos nos padrões.
    const { data, error } = await supabase
      .from('ai_agent_config')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) {
      if (error.code === '42P01') {
        return res.json({
          enabled: false,
          persona: DEFAULT_PERSONA,
          objective: DEFAULT_OBJECTIVE,
          knowledge: DEFAULT_KNOWLEDGE,
          rules: DEFAULT_RULES,
          table_missing: true,
        });
      }
      return res.status(500).json({ error: error.message });
    }
    res.json({
      enabled: data?.enabled ?? false,
      persona: data?.persona || DEFAULT_PERSONA,
      objective: data?.objective || DEFAULT_OBJECTIVE,
      knowledge: data?.knowledge || DEFAULT_KNOWLEDGE,
      rules: data?.rules || DEFAULT_RULES,
    });
  });

  app.put('/api/agent/config', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { enabled, persona, objective, knowledge, rules } = req.body;
    const { error } = await supabase
      .from('ai_agent_config')
      .upsert(
        {
          user_id: userId,
          enabled: !!enabled,
          persona: typeof persona === 'string' ? persona : null,
          objective: typeof objective === 'string' ? objective : null,
          knowledge: typeof knowledge === 'string' ? knowledge : null,
          rules: typeof rules === 'string' ? rules : null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' },
      );
    if (error) {
      if (error.code === '42P01') {
        return res.status(400).json({
          error: 'Tabela ai_agent_config não existe. Rode a migration 009_ai_agent_config.sql no Supabase.',
        });
      }
      if (error.code === '42703') {
        return res.status(400).json({
          error: 'Colunas novas ainda não existem. Rode a migration 010_ai_agent_config_rules.sql no Supabase.',
        });
      }
      return res.status(500).json({ error: error.message });
    }
    res.json({ success: true });
  });

  // Playground de teste: gera uma resposta do agente sem enviar nada a
  // ninguém. Usa a persona/conhecimento do corpo (edição ao vivo na tela).
  app.post('/api/agent/test', requireAuth, async (req, res) => {
    const { messages, persona, objective, knowledge, rules } = req.body;
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Envie ao menos uma mensagem.' });
    }
    try {
      const reply = await getAgentReply(
        {
          enabled: true,
          persona: typeof persona === 'string' ? persona : '',
          objective: typeof objective === 'string' ? objective : '',
          knowledge: typeof knowledge === 'string' ? knowledge : '',
          rules: typeof rules === 'string' ? rules : '',
        },
        messages,
      );
      res.json({ reply });
    } catch (e: any) {
      console.error('[Agent test] erro:', e?.message || e);
      res.status(500).json({ error: e?.message || 'Erro ao gerar resposta do agente.' });
    }
  });

  // Sugestão de resposta para a extensão: recebe a conversa lida do
  // WhatsApp Web e devolve a resposta sugerida (usa a config salva).
  app.post('/api/agent/suggest', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { messages } = req.body || {};
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Conversa vazia.' });
    }
    const { data } = await supabase
      .from('ai_agent_config')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
    try {
      const reply = await getAgentReply(
        {
          enabled: true,
          persona: data?.persona || '',
          objective: data?.objective || '',
          knowledge: data?.knowledge || '',
          rules: data?.rules || '',
        },
        messages,
      );
      res.json({ reply });
    } catch (e: any) {
      console.error('[Agent suggest] erro:', e?.message || e);
      res.status(500).json({ error: e?.message || 'Erro ao gerar a sugestão.' });
    }
  });

  // ── Materiais (PDFs) do agente — bucket privado no Storage ──────────
  let agenteMateriaisBucketReady = false;
  async function ensureAgenteMateriaisBucket() {
    if (agenteMateriaisBucketReady || !supabaseAdmin) return;
    try {
      const { data: buckets } = await supabaseAdmin.storage.listBuckets();
      const exists = (buckets || []).some((b: any) => b.name === 'agente-materiais');
      if (!exists) {
        await supabaseAdmin.storage.createBucket('agente-materiais', {
          public: false,
          fileSizeLimit: 20_971_520, // 20MB
        });
      }
      agenteMateriaisBucketReady = true;
    } catch (e: any) {
      console.error('[agente/materiais] erro criando bucket:', e?.message);
    }
  }

  // Lista os materiais do agente com uma URL assinada (1h) por arquivo.
  app.get('/api/agent/materiais', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { data, error } = await supabase
      .from('agente_materiais')
      .select('*')
      .eq('user_id', userId)
      .order('nicho', { ascending: true });
    if (error) {
      if (error.code === '42P01') return res.json({ materiais: [], table_missing: true });
      return res.status(500).json({ error: error.message });
    }
    const materiais = [];
    for (const m of data || []) {
      let url: string | null = null;
      if (supabaseAdmin) {
        const { data: signed } = await supabaseAdmin.storage
          .from('agente-materiais')
          .createSignedUrl(m.path, 3600);
        url = signed?.signedUrl || null;
      }
      materiais.push({ ...m, url });
    }
    res.json({ materiais });
  });

  // Envia (ou substitui) um PDF. Body: { nicho, tipo, nome_arquivo, dataUrl }.
  app.post('/api/agent/materiais', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    if (!supabaseAdmin) return res.status(500).json({ error: 'Storage indisponível.' });
    const { nicho, tipo, nome_arquivo, dataUrl } = req.body || {};
    if (!nicho || typeof nicho !== 'string') {
      return res.status(400).json({ error: 'Informe o nicho.' });
    }
    if (tipo !== 'pacote' && tipo !== 'dicas') {
      return res.status(400).json({ error: 'Tipo inválido (use pacote ou dicas).' });
    }
    const match = String(dataUrl || '').match(/^data:application\/pdf;base64,(.+)$/i);
    if (!match) return res.status(400).json({ error: 'Envie um arquivo PDF válido.' });
    const buffer = Buffer.from(match[1], 'base64');
    if (buffer.length > 20_971_520) {
      return res.status(400).json({ error: 'PDF muito grande (máximo 20MB).' });
    }

    await ensureAgenteMateriaisBucket();
    // Caminho determinístico: substituir reescreve o mesmo arquivo.
    const path = `${userId}/${nicho}-${tipo}.pdf`;
    const { error: upErr } = await supabaseAdmin.storage
      .from('agente-materiais')
      .upload(path, buffer, { contentType: 'application/pdf', upsert: true });
    if (upErr) return res.status(500).json({ error: `Upload falhou: ${upErr.message}` });

    const { data: row, error } = await supabase
      .from('agente_materiais')
      .upsert(
        {
          user_id: userId,
          nicho,
          tipo,
          nome_arquivo: String(nome_arquivo || 'arquivo.pdf'),
          path,
          tamanho: buffer.length,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,nicho,tipo' },
      )
      .select()
      .single();
    if (error) {
      if (error.code === '42P01') {
        return res.status(400).json({
          error: 'Tabela agente_materiais não existe. Rode a migration 011_agente_materiais.sql no Supabase.',
        });
      }
      return res.status(500).json({ error: error.message });
    }
    res.json(row);
  });

  app.delete('/api/agent/materiais/:id', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { data: row } = await supabase
      .from('agente_materiais')
      .select('path')
      .eq('id', req.params.id)
      .eq('user_id', userId)
      .maybeSingle();
    if (row?.path && supabaseAdmin) {
      await supabaseAdmin.storage.from('agente-materiais').remove([row.path]);
    }
    const { error } = await supabase
      .from('agente_materiais')
      .delete()
      .eq('id', req.params.id)
      .eq('user_id', userId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  });

  // ── Áudios do agente — bucket privado no Storage ────────────────────
  let agenteAudiosBucketReady = false;
  async function ensureAgenteAudiosBucket() {
    if (agenteAudiosBucketReady || !supabaseAdmin) return;
    try {
      const { data: buckets } = await supabaseAdmin.storage.listBuckets();
      const exists = (buckets || []).some((b: any) => b.name === 'agente-audios');
      if (!exists) {
        await supabaseAdmin.storage.createBucket('agente-audios', {
          public: false,
          fileSizeLimit: 20_971_520,
        });
      }
      agenteAudiosBucketReady = true;
    } catch (e: any) {
      console.error('[agente/audios] erro criando bucket:', e?.message);
    }
  }

  function audioExt(mime: string): string {
    const m = (mime || '').toLowerCase();
    if (m.includes('ogg')) return 'ogg';
    if (m.includes('mpeg') || m.includes('mp3')) return 'mp3';
    if (m.includes('mp4') || m.includes('m4a') || m.includes('aac')) return 'm4a';
    if (m.includes('webm')) return 'webm';
    if (m.includes('wav')) return 'wav';
    return 'audio';
  }

  app.get('/api/agent/audios', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { data, error } = await supabase
      .from('agente_audios')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) {
      if (error.code === '42P01') return res.json({ audios: [], table_missing: true });
      return res.status(500).json({ error: error.message });
    }
    const audios = [];
    for (const a of data || []) {
      let url: string | null = null;
      if (supabaseAdmin) {
        const { data: signed } = await supabaseAdmin.storage
          .from('agente-audios')
          .createSignedUrl(a.path, 3600);
        url = signed?.signedUrl || null;
      }
      audios.push({ ...a, url });
    }
    res.json({ audios });
  });

  app.post('/api/agent/audios', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    if (!supabaseAdmin) return res.status(500).json({ error: 'Storage indisponível.' });
    const { titulo, mimetype, duracao, dataUrl } = req.body || {};
    if (!titulo || typeof titulo !== 'string' || !titulo.trim()) {
      return res.status(400).json({ error: 'Dê um nome ao áudio.' });
    }
    const match = String(dataUrl || '').match(/^data:(audio\/[a-z0-9.+-]+);base64,(.+)$/i);
    if (!match) return res.status(400).json({ error: 'Envie um arquivo de áudio válido.' });
    const mime = match[1];
    const buffer = Buffer.from(match[2], 'base64');
    if (buffer.length > 20_971_520) {
      return res.status(400).json({ error: 'Áudio muito grande (máximo 20MB).' });
    }

    await ensureAgenteAudiosBucket();
    const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${audioExt(mime)}`;
    const { error: upErr } = await supabaseAdmin.storage
      .from('agente-audios')
      .upload(path, buffer, { contentType: mime, upsert: false });
    if (upErr) return res.status(500).json({ error: `Upload falhou: ${upErr.message}` });

    const { data: row, error } = await supabase
      .from('agente_audios')
      .insert({
        user_id: userId,
        titulo: titulo.trim(),
        path,
        duracao: Number.isFinite(Number(duracao)) ? Math.round(Number(duracao)) : null,
        tamanho: buffer.length,
        mimetype: typeof mimetype === 'string' ? mimetype : mime,
      })
      .select()
      .single();
    if (error) {
      if (error.code === '42P01') {
        return res.status(400).json({
          error: 'Tabela agente_audios não existe. Rode a migration 012_agente_audios.sql no Supabase.',
        });
      }
      return res.status(500).json({ error: error.message });
    }
    res.json(row);
  });

  app.delete('/api/agent/audios/:id', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { data: row } = await supabase
      .from('agente_audios')
      .select('path')
      .eq('id', req.params.id)
      .eq('user_id', userId)
      .maybeSingle();
    if (row?.path && supabaseAdmin) {
      await supabaseAdmin.storage.from('agente-audios').remove([row.path]);
    }
    const { error } = await supabase
      .from('agente_audios')
      .delete()
      .eq('id', req.params.id)
      .eq('user_id', userId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  });

  app.get('/api/me', requireAuth, async (req, res) => {
    const realUserId = (req as any).realUserId || (req as any).userId;
    const ownerId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;

    // Tenta achar o team_member que representa o usuário atual.
    // - Se é member: buscamos por member_user_id.
    // - Se é owner: pode haver um team_member auto-criado pra ele com member_user_id = ownerId.
    let currentMember: { id: string; name: string; color?: string | null } | null = null;
    try {
      const { data } = await supabase
        .from('team_members')
        .select('id, name, color')
        .eq('owner_user_id', ownerId)
        .eq('member_user_id', realUserId)
        .eq('is_active', true)
        .maybeSingle();
      if (data) currentMember = { id: data.id, name: data.name, color: data.color };
    } catch { /* ignora — endpoint não pode quebrar */ }

    res.json({
      isMember: (req as any).isMember ?? false,
      permissions: (req as any).memberPermissions ?? null,
      isPlatformAdmin: (req as any).isPlatformAdmin ?? false,
      isImpersonating: (req as any).isImpersonating ?? false,
      impersonatingOwnerId: (req as any).isImpersonating ? (req as any).userId : null,
      currentMember,
    });
  });

  // ============================================================================
  // BILLING — integração Asaas (PIX recorrente + cartão de crédito)
  // ============================================================================

  // Retorna status atual da assinatura + dias restantes do trial
  app.get('/api/billing/me', requireAuth, async (req, res) => {
    const ownerId = (req as any).userId;
    if (!supabaseAdmin) return res.status(500).json({ error: 'Service role indisponível' });

    const acct = await ensurePlatformAccount(ownerId);
    if (!acct) return res.json({ subscription_status: 'unknown', trial_days_left: 0 });

    const { data: plan } = await supabaseAdmin
      .from('platform_plans')
      .select('id, slug, name, price_cents, limits')
      .eq('id', (acct as any).plan_id)
      .maybeSingle();

    let trialDaysLeft = 0;
    if ((acct as any).trial_ends_at) {
      const ms = new Date((acct as any).trial_ends_at).getTime() - Date.now();
      trialDaysLeft = Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
    }

    res.json({
      subscription_status: (acct as any).subscription_status || 'trial',
      trial_ends_at: (acct as any).trial_ends_at,
      trial_days_left: trialDaysLeft,
      asaas_customer_id: (acct as any).asaas_customer_id || null,
      asaas_subscription_id: (acct as any).asaas_subscription_id || null,
      plan,
    });
  });

  // Uso atual vs limites do plano — pra UI mostrar barra de progresso e alertar
  app.get('/api/billing/limits', requireAuth, async (req, res) => {
    const ownerId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const resources: Array<'clients' | 'jobs' | 'team_members'> = ['clients', 'jobs', 'team_members'];
    const results = await Promise.all(resources.map(async (r) => {
      const l = await checkPlanLimit(supabase, ownerId, r);
      return [r, { current: l.current, max: l.max, allowed: l.allowed }];
    }));
    res.json(Object.fromEntries(results));
  });

  // ============================================================================
  // COMPANY INFO — dados da empresa (usado em contratos e cobranças)
  // ============================================================================
  app.get('/api/company-info', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { data } = await supabase
      .from('company_info')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
    res.json(data || null);
  });

  app.put('/api/company-info', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const payload = { ...req.body, user_id: userId };
    delete payload.created_at;
    delete payload.updated_at;
    const { data, error } = await supabase
      .from('company_info')
      .upsert(payload, { onConflict: 'user_id' })
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  });

  // Histórico de pagamentos do dono da conta
  app.get('/api/billing/payments', requireAuth, async (req, res) => {
    const ownerId = (req as any).userId;
    if (!supabaseAdmin) return res.status(500).json({ error: 'Service role indisponível' });
    const { data } = await supabaseAdmin
      .from('billing_payments')
      .select('id, asaas_payment_id, amount_cents, status, billing_type, due_date, paid_at, invoice_url, created_at')
      .eq('owner_user_id', ownerId)
      .order('created_at', { ascending: false })
      .limit(50);
    res.json(data || []);
  });

  // Serve a extensão do Chrome como .zip pronto pra instalar.
  // Não precisa de auth — é o "executável" do produto. Atualiza junto com cada deploy.
  app.get('/api/public/extension.zip', async (_req, res) => {
    try {
      // @ts-ignore — opcional, instalado via `npm install`
      const archiverModule = await import('archiver');
      const archiver = archiverModule.default;
      const extensionDir = path.join(__dirname, 'whatsapp-extension');

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', 'attachment; filename="focalpoint-extension.zip"');

      const archive = archiver('zip', { zlib: { level: 9 } });
      archive.on('error', (err: Error) => {
        console.error('[extension-zip] erro:', err);
        if (!res.headersSent) res.status(500).json({ error: err.message });
      });
      archive.pipe(res);
      archive.directory(extensionDir, false);
      await archive.finalize();
    } catch (err: any) {
      console.error('[extension-zip] falha:', err);
      if (!res.headersSent) res.status(500).json({ error: err.message || 'Falha ao gerar zip' });
    }
  });

  // Versão atual da extensão (timestamp do manifest) — pra UI mostrar "Atualizado em XX"
  app.get('/api/public/extension-version', async (_req, res) => {
    try {
      const fs = await import('fs/promises');
      const manifestPath = path.join(__dirname, 'whatsapp-extension', 'manifest.json');
      const [contents, stat] = await Promise.all([
        fs.readFile(manifestPath, 'utf-8'),
        fs.stat(manifestPath),
      ]);
      const manifest = JSON.parse(contents);
      res.json({ version: manifest.version || 'dev', updated_at: stat.mtime.toISOString() });
    } catch (err: any) {
      res.json({ version: 'dev', updated_at: null });
    }
  });

  // Lista de planos acessível sem autenticação — usada pela landing pública.
  // Retorna só campos comerciais (slug, name, price_cents, limits) — nada sensível.
  app.get('/api/public/plans', async (_req, res) => {
    if (!supabaseAdmin) return res.json([]);
    const { data } = await supabaseAdmin
      .from('platform_plans')
      .select('id, slug, name, price_cents, limits, sort_order')
      .eq('is_active', true)
      .order('sort_order');
    res.json(data || []);
  });

  // Lista pública dos planos ativos (pra página de assinatura mostrar)
  app.get('/api/platform/plans-public', requireAuth, async (_req, res) => {
    if (!supabaseAdmin) return res.status(500).json({ error: 'Service role indisponível' });
    const { data } = await supabaseAdmin
      .from('platform_plans')
      .select('id, slug, name, price_cents, limits, sort_order')
      .eq('is_active', true)
      .order('sort_order');
    res.json(data || []);
  });

  // Cria customer no Asaas + subscription. Retorna invoiceUrl pra pagamento.
  // Body: { planSlug: 'pro'|'business', billingType: 'PIX'|'CREDIT_CARD',
  //         cpfCnpj, mobilePhone, creditCard?, creditCardHolderInfo? }
  app.post('/api/billing/subscribe', requireAuth, requireOwnerOrPlatformAdmin, async (req, res) => {
    const ownerId = (req as any).userId;
    if (!supabaseAdmin) return res.status(500).json({ error: 'Service role indisponível' });

    const { planSlug, billingType, cpfCnpj, mobilePhone, creditCard, creditCardHolderInfo } = req.body || {};
    if (!planSlug || !['pro', 'business'].includes(planSlug)) return res.status(400).json({ error: 'planSlug inválido' });
    if (!['PIX', 'CREDIT_CARD'].includes(billingType)) return res.status(400).json({ error: 'billingType inválido' });
    if (!cpfCnpj) return res.status(400).json({ error: 'CPF/CNPJ obrigatório' });

    const { data: plan } = await supabaseAdmin
      .from('platform_plans')
      .select('id, slug, name, price_cents')
      .eq('slug', planSlug)
      .maybeSingle();
    if (!plan) return res.status(404).json({ error: 'Plano não encontrado' });

    // Email/nome do user logado pra criar customer no Asaas
    const { data: userInfo } = await supabaseAdmin.auth.admin.getUserById(ownerId);
    const userEmail = userInfo?.user?.email;
    const userName = (userInfo?.user?.user_metadata as any)?.name || userEmail?.split('@')[0] || 'Cliente';
    if (!userEmail) return res.status(400).json({ error: 'Usuário sem email' });

    try {
      const customer = await Asaas.upsertCustomer({
        name: userName,
        email: userEmail,
        cpfCnpj: String(cpfCnpj).replace(/\D/g, ''),
        mobilePhone: mobilePhone ? String(mobilePhone).replace(/\D/g, '') : undefined,
        externalReference: ownerId,
      });

      // Cobra amanhã (dá tempo do cliente confirmar)
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const nextDueDate = tomorrow.toISOString().slice(0, 10);

      const subscription = await Asaas.createSubscription({
        customer: customer.id,
        billingType: billingType as Asaas.AsaasBillingType,
        value: plan.price_cents / 100,
        nextDueDate,
        cycle: 'MONTHLY',
        description: `Assinatura ${plan.name} — FocalPoint CRM`,
        externalReference: ownerId,
        creditCard,
        creditCardHolderInfo,
        remoteIp: (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip,
      });

      await supabaseAdmin
        .from('platform_accounts')
        .update({
          plan_id: plan.id,
          asaas_customer_id: customer.id,
          asaas_subscription_id: subscription.id,
          subscription_status: billingType === 'CREDIT_CARD' ? 'active' : 'trial', // PIX confirma só após pagar
          subscription_payment_method: billingType,
          subscription_started_at: new Date().toISOString(),
        })
        .eq('owner_user_id', ownerId);

      res.json({ subscription_id: subscription.id, customer_id: customer.id, status: subscription.status });
    } catch (err: any) {
      console.error('[billing/subscribe]', err);
      res.status(500).json({ error: err.message || 'Erro ao criar assinatura' });
    }
  });

  // Cancela assinatura corrente
  app.post('/api/billing/cancel', requireAuth, requireOwnerOrPlatformAdmin, async (req, res) => {
    const ownerId = (req as any).userId;
    if (!supabaseAdmin) return res.status(500).json({ error: 'Service role indisponível' });

    const { data: acct } = await supabaseAdmin
      .from('platform_accounts')
      .select('asaas_subscription_id')
      .eq('owner_user_id', ownerId)
      .maybeSingle();

    if (!acct?.asaas_subscription_id) return res.status(400).json({ error: 'Sem assinatura ativa' });

    try {
      await Asaas.cancelSubscription(acct.asaas_subscription_id);
      await supabaseAdmin
        .from('platform_accounts')
        .update({ subscription_status: 'cancelled' })
        .eq('owner_user_id', ownerId);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Webhook do Asaas — não usa requireAuth, mas valida token compartilhado.
  // Configure no painel Asaas: URL = https://seu-app.com/api/billing/webhook
  //                            Token = valor de ASAAS_WEBHOOK_TOKEN
  app.post('/api/billing/webhook', express.json({ limit: '1mb' }), async (req, res) => {
    const token = req.headers['asaas-access-token'] as string | undefined;
    if (process.env.ASAAS_WEBHOOK_TOKEN && token !== process.env.ASAAS_WEBHOOK_TOKEN) {
      return res.status(401).json({ error: 'Token inválido' });
    }
    if (!supabaseAdmin) return res.status(500).json({ error: 'Service role indisponível' });

    const payload = req.body;
    const eventId = payload?.id || payload?.payment?.id;
    const eventType = payload?.event;
    if (!eventId || !eventType) return res.status(400).json({ error: 'Payload inválido' });

    // Idempotência: se já processamos esse event_id, devolve 200 sem reprocessar
    const { data: already } = await supabaseAdmin
      .from('billing_webhook_events')
      .select('id, processed_at')
      .eq('event_id', eventId)
      .maybeSingle();
    if (already?.processed_at) return res.json({ ok: true, deduped: true });

    if (!already) {
      await supabaseAdmin.from('billing_webhook_events').insert({
        event_id: eventId, event_type: eventType, payload,
      });
    }

    try {
      const payment = payload.payment;
      if (payment) {
        // Acha o owner via subscription externalReference ou customer
        let ownerId: string | null = null;
        if (payment.subscription) {
          const { data: acct } = await supabaseAdmin
            .from('platform_accounts')
            .select('owner_user_id')
            .eq('asaas_subscription_id', payment.subscription)
            .maybeSingle();
          ownerId = acct?.owner_user_id || null;
        }
        if (!ownerId && payment.customer) {
          const { data: acct } = await supabaseAdmin
            .from('platform_accounts')
            .select('owner_user_id')
            .eq('asaas_customer_id', payment.customer)
            .maybeSingle();
          ownerId = acct?.owner_user_id || null;
        }

        if (ownerId) {
          // Persiste o pagamento
          await supabaseAdmin.from('billing_payments').upsert({
            owner_user_id: ownerId,
            asaas_payment_id: payment.id,
            asaas_subscription_id: payment.subscription || null,
            asaas_customer_id: payment.customer || null,
            amount_cents: Math.round((payment.value || 0) * 100),
            status: payment.status,
            billing_type: payment.billingType,
            due_date: payment.dueDate || null,
            paid_at: payment.paymentDate || payment.clientPaymentDate || null,
            invoice_url: payment.invoiceUrl || null,
            raw: payment,
          }, { onConflict: 'asaas_payment_id' });

          // Atualiza status da assinatura conforme o evento
          const updates: any = {};
          if (['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED'].includes(eventType)) {
            updates.subscription_status = 'active';
            updates.last_payment_at = new Date().toISOString();
            updates.subscription_renewed_at = new Date().toISOString();
          } else if (eventType === 'PAYMENT_OVERDUE') {
            updates.subscription_status = 'past_due';
          } else if (['PAYMENT_DELETED', 'PAYMENT_REFUNDED', 'PAYMENT_CHARGEBACK_REQUESTED'].includes(eventType)) {
            updates.subscription_status = 'past_due';
          } else if (['SUBSCRIPTION_INACTIVE'].includes(eventType)) {
            updates.subscription_status = 'cancelled';
          }
          if (Object.keys(updates).length) {
            await supabaseAdmin.from('platform_accounts').update(updates).eq('owner_user_id', ownerId);
          }
        }
      }

      await supabaseAdmin
        .from('billing_webhook_events')
        .update({ processed_at: new Date().toISOString() })
        .eq('event_id', eventId);

      res.json({ ok: true });
    } catch (err: any) {
      console.error('[billing/webhook]', err);
      await supabaseAdmin
        .from('billing_webhook_events')
        .update({ error: String(err.message || err) })
        .eq('event_id', eventId);
      res.status(500).json({ error: err.message });
    }
  });

  // ============================================================================
  // PLATFORM ADMIN ROUTES — painel do super-admin do SaaS
  // Todas as rotas aqui exigem requireAuth + requireSuperAdmin.
  // ============================================================================

  // Status leve — usado pelo frontend pra decidir se mostra o item de menu
  app.get('/api/platform/me', requireAuth, async (req, res) => {
    res.json({ isPlatformAdmin: (req as any).isPlatformAdmin ?? false });
  });

  // ---- TENANTS (donos) ----
  app.get('/api/platform/tenants', requireAuth, requireSuperAdmin, async (req, res) => {
    if (!supabaseAdmin) return res.status(500).json({ error: 'Service role indisponível' });
    const search = (req.query.q as string | undefined)?.trim().toLowerCase() ?? '';
    const status = (req.query.status as string | undefined) ?? '';
    const planId = (req.query.plan_id as string | undefined) ?? '';
    const page = Math.max(1, parseInt((req.query.page as string) || '1', 10));
    const pageSize = Math.min(100, Math.max(10, parseInt((req.query.page_size as string) || '25', 10)));

    try {
      // Lista usuários do auth.users via admin API
      const { data: usersData, error: usersErr } = await supabaseAdmin.auth.admin.listUsers({
        page,
        perPage: pageSize,
      });
      if (usersErr) return res.status(500).json({ error: usersErr.message });

      let users = usersData?.users ?? [];

      // Filtra fora os membros de equipe — só queremos donos de conta
      const { data: memberRows } = await supabaseAdmin
        .from('team_members')
        .select('member_user_id')
        .not('member_user_id', 'is', null);
      const memberIds = new Set((memberRows ?? []).map((r) => r.member_user_id));
      users = users.filter((u) => !memberIds.has(u.id));

      const totalUsers = users.length;
      if (search) {
        users = users.filter((u) => (u.email ?? '').toLowerCase().includes(search));
      }

      const userIds = users.map((u) => u.id);
      if (userIds.length === 0) {
        return res.json({ tenants: [], page, page_size: pageSize, total: totalUsers });
      }

      const [{ data: accounts }, { data: plans }] = await Promise.all([
        supabaseAdmin
          .from('platform_accounts')
          .select('owner_user_id, plan_id, status, suspended_reason, trial_ends_at, notes, created_at')
          .in('owner_user_id', userIds),
        supabaseAdmin.from('platform_plans').select('id, slug, name'),
      ]);

      const acctByOwner = new Map((accounts ?? []).map((a) => [a.owner_user_id, a]));
      const planById = new Map((plans ?? []).map((p) => [p.id, p]));

      let tenants = users.map((u) => {
        const acct = acctByOwner.get(u.id);
        const plan = acct?.plan_id ? planById.get(acct.plan_id) : null;
        return {
          owner_user_id: u.id,
          email: u.email,
          created_at: u.created_at,
          last_sign_in_at: u.last_sign_in_at,
          status: acct?.status ?? 'active',
          plan_id: acct?.plan_id ?? null,
          plan_slug: plan?.slug ?? null,
          plan_name: plan?.name ?? null,
          suspended_reason: acct?.suspended_reason ?? null,
          trial_ends_at: acct?.trial_ends_at ?? null,
          notes: acct?.notes ?? null,
        };
      });

      if (status) tenants = tenants.filter((t) => t.status === status);
      if (planId) tenants = tenants.filter((t) => t.plan_id === planId);

      res.json({ tenants, page, page_size: pageSize, total: totalUsers });
    } catch (err: any) {
      console.error('[platform/tenants] erro:', err);
      res.status(500).json({ error: err.message ?? 'Falha ao listar tenants' });
    }
  });

  app.get('/api/platform/tenants/:ownerId', requireAuth, requireSuperAdmin, async (req, res) => {
    if (!supabaseAdmin) return res.status(500).json({ error: 'Service role indisponível' });
    const ownerId = req.params.ownerId;

    try {
      // Fan-out de queries — todas independentes
      const [
        { data: userResp, error: userErr },
        { data: acct },
        { count: clientsCount },
        { count: jobsCount },
        { count: dealsCount },
        { count: teamCount },
        { count: contractsCount },
        { data: recentJobs },
        { data: recentDeals },
        { data: recentContracts },
        { data: googleAuth },
        { data: studioSettings },
        { data: whatsappInst },
      ] = await Promise.all([
        supabaseAdmin.auth.admin.getUserById(ownerId),
        supabaseAdmin
          .from('platform_accounts')
          .select('owner_user_id, plan_id, status, suspended_reason, trial_ends_at, notes, created_at, updated_at, subscription_status, trial_started_at')
          .eq('owner_user_id', ownerId)
          .maybeSingle(),
        supabaseAdmin.from('clients').select('id', { count: 'exact', head: true }).eq('user_id', ownerId),
        supabaseAdmin.from('jobs').select('id', { count: 'exact', head: true }).eq('user_id', ownerId),
        supabaseAdmin.from('deals').select('id', { count: 'exact', head: true }).eq('user_id', ownerId),
        supabaseAdmin.from('team_members').select('id', { count: 'exact', head: true }).eq('owner_user_id', ownerId),
        supabaseAdmin.from('contracts').select('id', { count: 'exact', head: true }).eq('user_id', ownerId),
        supabaseAdmin.from('jobs').select('id, job_name, job_date, status, created_at, client_id').eq('user_id', ownerId).order('created_at', { ascending: false }).limit(5),
        supabaseAdmin.from('deals').select('id, title, value, stage, created_at').eq('user_id', ownerId).order('created_at', { ascending: false }).limit(5),
        supabaseAdmin.from('contracts').select('id, status, created_at, signed_at, client_id').eq('user_id', ownerId).order('created_at', { ascending: false }).limit(5),
        supabaseAdmin.from('google_auth').select('user_id, expiry_date').eq('user_id', ownerId).maybeSingle(),
        supabaseAdmin.from('studio_settings').select('studio_name, autentique_api_key, asaas_customer_id').eq('user_id', ownerId).maybeSingle(),
        supabaseAdmin.from('whatsapp_instances').select('phone_number_id, status, display_phone_number').eq('user_id', ownerId).maybeSingle(),
      ]);

      if (userErr || !userResp?.user) {
        return res.status(404).json({ error: 'Usuário não encontrado' });
      }

      const { data: plans } = await supabaseAdmin.from('platform_plans').select('id, slug, name');
      const plan = acct?.plan_id ? plans?.find((p) => p.id === acct.plan_id) : null;

      const integrations = {
        google_calendar: {
          connected: !!googleAuth,
          expires_at: googleAuth?.expiry_date ? new Date(Number(googleAuth.expiry_date)).toISOString() : null,
        },
        autentique: {
          connected: !!(studioSettings as any)?.autentique_api_key,
        },
        asaas: {
          customer_id: (studioSettings as any)?.asaas_customer_id ?? null,
        },
        whatsapp: {
          phone_number_id: whatsappInst?.phone_number_id ?? null,
          status: whatsappInst?.status ?? null,
          display_phone_number: whatsappInst?.display_phone_number ?? null,
        },
        studio_name: (studioSettings as any)?.studio_name ?? null,
      };

      res.json({
        owner_user_id: ownerId,
        email: userResp.user.email,
        created_at: userResp.user.created_at,
        last_sign_in_at: userResp.user.last_sign_in_at,
        account: acct ?? { status: 'active', plan_id: null },
        plan: plan ?? null,
        metrics: {
          clients: clientsCount ?? 0,
          jobs: jobsCount ?? 0,
          deals: dealsCount ?? 0,
          team_members: teamCount ?? 0,
          contracts: contractsCount ?? 0,
        },
        integrations,
        recent: {
          jobs: recentJobs ?? [],
          deals: recentDeals ?? [],
          contracts: recentContracts ?? [],
        },
      });
    } catch (err: any) {
      console.error('[platform/tenant detail] erro:', err);
      res.status(500).json({ error: err.message ?? 'Falha ao carregar detalhe' });
    }
  });

  app.patch('/api/platform/tenants/:ownerId', requireAuth, requireSuperAdmin, async (req, res) => {
    if (!supabaseAdmin) return res.status(500).json({ error: 'Service role indisponível' });
    const ownerId = req.params.ownerId;
    const adminId = (req as any).realUserId as string;
    const { plan_id, status, suspended_reason, trial_ends_at, notes } = req.body ?? {};

    const update: Record<string, any> = {};
    if (plan_id !== undefined) update.plan_id = plan_id;
    if (status !== undefined) {
      if (!['active', 'suspended', 'deleted'].includes(status)) {
        return res.status(400).json({ error: 'status inválido' });
      }
      update.status = status;
    }
    if (suspended_reason !== undefined) update.suspended_reason = suspended_reason;
    if (trial_ends_at !== undefined) update.trial_ends_at = trial_ends_at;
    if (notes !== undefined) update.notes = notes;

    if (Object.keys(update).length === 0) {
      return res.status(400).json({ error: 'Nada para atualizar' });
    }

    // Upsert: se a conta ainda não existe, cria com defaults antes de aplicar
    await ensurePlatformAccount(ownerId);

    const { data, error } = await supabaseAdmin
      .from('platform_accounts')
      .update(update)
      .eq('owner_user_id', ownerId)
      .select('*')
      .single();

    if (error) return res.status(500).json({ error: error.message });

    // Invalida cache pra mudanças refletirem imediatamente (suspender,
    // mudar plano, etc.) — senão o user fica até 30s usando estado antigo.
    await invalidateAuthCacheForTenant(ownerId);

    await logAdminAction(adminId, 'tenant_update', ownerId, update, req.ip ?? null);
    res.json(data);
  });

  // Estender o trial — atalho usado pelo admin pra dar mais alguns dias.
  // Body: { extraDays: number }  (default 7, máx 14 contando do início do trial)
  app.post('/api/platform/tenants/:ownerId/extend-trial', requireAuth, requireSuperAdmin, async (req, res) => {
    if (!supabaseAdmin) return res.status(500).json({ error: 'Service role indisponível' });
    const ownerId = req.params.ownerId;
    const adminId = (req as any).realUserId as string;
    const extraDays = Math.max(1, Math.min(14, Number(req.body?.extraDays || 7)));

    await ensurePlatformAccount(ownerId);
    const { data: acct } = await supabaseAdmin
      .from('platform_accounts')
      .select('trial_started_at, trial_ends_at')
      .eq('owner_user_id', ownerId)
      .maybeSingle();

    const startedAt = (acct as any)?.trial_started_at ? new Date((acct as any).trial_started_at) : new Date();
    const currentEnds = (acct as any)?.trial_ends_at ? new Date((acct as any).trial_ends_at) : new Date();
    const base = currentEnds > new Date() ? currentEnds : new Date();
    const newEnds = new Date(base.getTime() + extraDays * 24 * 60 * 60 * 1000);
    // Limite: total não pode ultrapassar 14 dias contados do início
    const maxAllowed = new Date(startedAt.getTime() + 14 * 24 * 60 * 60 * 1000);
    const capped = newEnds > maxAllowed ? maxAllowed : newEnds;

    const { error } = await supabaseAdmin
      .from('platform_accounts')
      .update({ trial_ends_at: capped.toISOString(), subscription_status: 'trial' })
      .eq('owner_user_id', ownerId);
    if (error) return res.status(500).json({ error: error.message });

    await invalidateAuthCacheForTenant(ownerId);
    await logAdminAction(adminId, 'trial_extended', ownerId, { extraDays, newEndsAt: capped.toISOString() }, req.ip ?? null);
    res.json({ trial_ends_at: capped.toISOString() });
  });

  // Soft delete: marca como deleted (não apaga dados)
  app.delete('/api/platform/tenants/:ownerId', requireAuth, requireSuperAdmin, async (req, res) => {
    if (!supabaseAdmin) return res.status(500).json({ error: 'Service role indisponível' });
    const ownerId = req.params.ownerId;
    const adminId = (req as any).realUserId as string;
    const reason = (req.body?.reason as string | undefined) ?? null;

    await ensurePlatformAccount(ownerId);
    const { error } = await supabaseAdmin
      .from('platform_accounts')
      .update({ status: 'deleted', suspended_reason: reason })
      .eq('owner_user_id', ownerId);

    if (error) return res.status(500).json({ error: error.message });

    await invalidateAuthCacheForTenant(ownerId);
    await logAdminAction(adminId, 'tenant_delete', ownerId, { reason }, req.ip ?? null);
    res.json({ success: true });
  });

  // Lista membros (equipe) de uma empresa
  app.get('/api/platform/tenants/:ownerId/members', requireAuth, requireSuperAdmin, async (req, res) => {
    if (!supabaseAdmin) return res.status(500).json({ error: 'Service role indisponível' });
    const ownerId = req.params.ownerId;
    const { data, error } = await supabaseAdmin
      .from('team_members')
      .select('id, name, email, member_user_id, permissions, is_active, color, created_at')
      .eq('owner_user_id', ownerId)
      .order('created_at', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });

    // Hidrata last_sign_in_at dos que já fizeram login (têm member_user_id)
    const ids = (data ?? []).map((m: any) => m.member_user_id).filter(Boolean) as string[];
    const lastSignIns = new Map<string, string | null>();
    await Promise.all(ids.map(async (id) => {
      const { data: u } = await supabaseAdmin!.auth.admin.getUserById(id);
      lastSignIns.set(id, u?.user?.last_sign_in_at ?? null);
    }));

    res.json((data ?? []).map((m: any) => ({
      ...m,
      last_sign_in_at: m.member_user_id ? lastSignIns.get(m.member_user_id) ?? null : null,
    })));
  });

  app.post('/api/platform/members/:memberId/impersonate-start', requireAuth, requireSuperAdmin, async (req, res) => {
    if (!supabaseAdmin) return res.status(500).json({ error: 'Service role indisponível' });
    const memberId = req.params.memberId;
    const adminId = (req as any).realUserId as string;
    const { data: member } = await supabaseAdmin
      .from('team_members')
      .select('id, owner_user_id, email, name')
      .eq('id', memberId)
      .maybeSingle();
    if (!member) return res.status(404).json({ error: 'Membro não encontrado' });
    await logAdminAction(adminId, 'impersonate_member_start', member.owner_user_id, {
      member_id: memberId,
      member_email: member.email,
      member_name: member.name,
    }, req.ip ?? null);
    res.json({ success: true, member_id: memberId, owner_user_id: member.owner_user_id });
  });

  // Impersonação — apenas registra start/stop no audit log.
  // O frontend envia o header X-Impersonate-Owner-Id nas chamadas seguintes.
  app.post('/api/platform/tenants/:ownerId/impersonate-start', requireAuth, requireSuperAdmin, async (req, res) => {
    const adminId = (req as any).realUserId as string;
    const ownerId = req.params.ownerId;
    await logAdminAction(adminId, 'impersonate_start', ownerId, {}, req.ip ?? null);
    res.json({ success: true, owner_user_id: ownerId });
  });

  app.post('/api/platform/impersonate-stop', requireAuth, async (req, res) => {
    const adminId = (req as any).realUserId as string;
    const ownerId = (req.body?.owner_user_id as string | undefined) ?? null;
    if (!supabaseAdmin) return res.status(500).json({ error: 'Service role indisponível' });
    const allowed = await isSuperAdmin(adminId);
    if (!allowed) return res.status(403).json({ error: 'Apenas super-admin' });
    await logAdminAction(adminId, 'impersonate_stop', ownerId, {}, req.ip ?? null);
    res.json({ success: true });
  });

  // ---- PLANS ----
  app.get('/api/platform/plans', requireAuth, requireSuperAdmin, async (_req, res) => {
    if (!supabaseAdmin) return res.status(500).json({ error: 'Service role indisponível' });
    const { data, error } = await supabaseAdmin
      .from('platform_plans')
      .select('*')
      .order('sort_order', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    res.json(data ?? []);
  });

  app.post('/api/platform/plans', requireAuth, requireSuperAdmin, async (req, res) => {
    if (!supabaseAdmin) return res.status(500).json({ error: 'Service role indisponível' });
    const adminId = (req as any).realUserId as string;
    const { slug, name, price_cents, limits, is_active, sort_order } = req.body ?? {};
    if (!slug || !name) return res.status(400).json({ error: 'slug e name obrigatórios' });
    const { data, error } = await supabaseAdmin
      .from('platform_plans')
      .insert({
        slug,
        name,
        price_cents: price_cents ?? 0,
        limits: limits ?? {},
        is_active: is_active ?? true,
        sort_order: sort_order ?? 0,
      })
      .select('*')
      .single();
    if (error) return res.status(500).json({ error: error.message });
    await logAdminAction(adminId, 'plan_create', null, { plan_id: data.id, slug }, req.ip ?? null);
    res.json(data);
  });

  app.patch('/api/platform/plans/:id', requireAuth, requireSuperAdmin, async (req, res) => {
    if (!supabaseAdmin) return res.status(500).json({ error: 'Service role indisponível' });
    const adminId = (req as any).realUserId as string;
    const id = req.params.id;
    const { name, price_cents, limits, is_active, sort_order } = req.body ?? {};
    const update: Record<string, any> = {};
    if (name !== undefined) update.name = name;
    if (price_cents !== undefined) update.price_cents = price_cents;
    if (limits !== undefined) update.limits = limits;
    if (is_active !== undefined) update.is_active = is_active;
    if (sort_order !== undefined) update.sort_order = sort_order;
    const { data, error } = await supabaseAdmin
      .from('platform_plans')
      .update(update)
      .eq('id', id)
      .select('*')
      .single();
    if (error) return res.status(500).json({ error: error.message });
    await logAdminAction(adminId, 'plan_update', null, { plan_id: id, update }, req.ip ?? null);
    res.json(data);
  });

  app.delete('/api/platform/plans/:id', requireAuth, requireSuperAdmin, async (req, res) => {
    if (!supabaseAdmin) return res.status(500).json({ error: 'Service role indisponível' });
    const adminId = (req as any).realUserId as string;
    const id = req.params.id;
    const { error } = await supabaseAdmin.from('platform_plans').delete().eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    await logAdminAction(adminId, 'plan_delete', null, { plan_id: id }, req.ip ?? null);
    res.json({ success: true });
  });

  // ---- SUPER ADMINS (gerenciar quem tem acesso ao painel admin) ----
  app.get('/api/platform/admins', requireAuth, requireSuperAdmin, async (_req, res) => {
    if (!supabaseAdmin) return res.status(500).json({ error: 'Service role indisponível' });
    const { data: adminsRow, error } = await supabaseAdmin
      .from('platform_admins')
      .select('user_id, role, created_at, created_by')
      .order('created_at');
    if (error) return res.status(500).json({ error: error.message });
    // Enriquece com email/last_sign_in via auth.admin
    const enriched = await Promise.all((adminsRow ?? []).map(async (a: any) => {
      try {
        const { data: u } = await supabaseAdmin!.auth.admin.getUserById(a.user_id);
        return {
          ...a,
          email: u?.user?.email ?? null,
          last_sign_in_at: u?.user?.last_sign_in_at ?? null,
        };
      } catch {
        return { ...a, email: null, last_sign_in_at: null };
      }
    }));
    res.json(enriched);
  });

  // Body: { email: string, role?: 'super_admin' }
  // Cria registro em platform_admins pra um usuário existente (lookup por email).
  app.post('/api/platform/admins', requireAuth, requireSuperAdmin, async (req, res) => {
    if (!supabaseAdmin) return res.status(500).json({ error: 'Service role indisponível' });
    const adminId = (req as any).realUserId as string;
    const email = (req.body?.email as string | undefined)?.trim().toLowerCase();
    const role = (req.body?.role as string | undefined) || 'super_admin';
    if (!email) return res.status(400).json({ error: 'email obrigatório' });

    // Busca user_id por email (Supabase admin.listUsers não tem filtro por email,
    // então paginamos buscando pelo match).
    let target: any = null;
    let page = 1;
    while (page <= 10) {
      const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 });
      if (error) return res.status(500).json({ error: error.message });
      const match = data.users.find((u) => (u.email || '').toLowerCase() === email);
      if (match) { target = match; break; }
      if (data.users.length < 200) break;
      page++;
    }
    if (!target) return res.status(404).json({ error: 'Usuário não encontrado com esse e-mail. Peça pra ele criar uma conta no app primeiro.' });

    const { error: insErr } = await supabaseAdmin
      .from('platform_admins')
      .insert({ user_id: target.id, role, created_by: adminId });
    if (insErr) {
      if (/duplicate|unique/i.test(insErr.message)) {
        return res.status(409).json({ error: 'Esse usuário já é admin.' });
      }
      return res.status(500).json({ error: insErr.message });
    }
    await logAdminAction(adminId, 'admin_grant', target.id, { email, role }, req.ip ?? null);
    res.json({ user_id: target.id, email, role });
  });

  app.delete('/api/platform/admins/:userId', requireAuth, requireSuperAdmin, async (req, res) => {
    if (!supabaseAdmin) return res.status(500).json({ error: 'Service role indisponível' });
    const adminId = (req as any).realUserId as string;
    const targetId = req.params.userId;
    // Trava: não deixa remover o último admin (lockout)
    const { count } = await supabaseAdmin
      .from('platform_admins')
      .select('user_id', { count: 'exact', head: true });
    if ((count ?? 0) <= 1) {
      return res.status(400).json({ error: 'Não é possível remover o último super-admin — o painel ficaria inacessível.' });
    }
    // Trava: não deixa o admin remover a si mesmo (precaução contra clique acidental)
    if (targetId === adminId) {
      return res.status(400).json({ error: 'Você não pode remover seu próprio acesso. Peça pra outro admin fazer isso.' });
    }
    const { error } = await supabaseAdmin
      .from('platform_admins')
      .delete()
      .eq('user_id', targetId);
    if (error) return res.status(500).json({ error: error.message });
    await logAdminAction(adminId, 'admin_revoke', targetId, {}, req.ip ?? null);
    res.json({ success: true });
  });

  // ---- AUDIT LOG ----
  app.get('/api/platform/audit-log', requireAuth, requireSuperAdmin, async (req, res) => {
    if (!supabaseAdmin) return res.status(500).json({ error: 'Service role indisponível' });
    const limit = Math.min(200, Math.max(10, parseInt((req.query.limit as string) || '50', 10)));
    const targetOwnerId = req.query.target_owner_id as string | undefined;
    const action = req.query.action as string | undefined;

    let q = supabaseAdmin
      .from('platform_audit_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (targetOwnerId) q = q.eq('target_owner_id', targetOwnerId);
    if (action) q = q.eq('action', action);

    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });

    // Hidrata e-mails dos admin_user_id e target_owner_id
    const ids = new Set<string>();
    (data ?? []).forEach((row: any) => {
      if (row.admin_user_id) ids.add(row.admin_user_id);
      if (row.target_owner_id) ids.add(row.target_owner_id);
    });
    const emailMap = new Map<string, string>();
    await Promise.all(
      Array.from(ids).map(async (id) => {
        const { data: u } = await supabaseAdmin!.auth.admin.getUserById(id);
        if (u?.user?.email) emailMap.set(id, u.user.email);
      }),
    );

    const enriched = (data ?? []).map((row: any) => ({
      ...row,
      admin_email: emailMap.get(row.admin_user_id) ?? null,
      target_email: row.target_owner_id ? emailMap.get(row.target_owner_id) ?? null : null,
    }));

    res.json(enriched);
  });

  // ---- METRICS ----
  app.get('/api/platform/metrics', requireAuth, requireSuperAdmin, async (_req, res) => {
    if (!supabaseAdmin) return res.status(500).json({ error: 'Service role indisponível' });
    try {
      const [{ data: accounts }, { data: plans }, { data: usersData }] = await Promise.all([
        supabaseAdmin.from('platform_accounts').select('owner_user_id, plan_id, status, created_at'),
        supabaseAdmin.from('platform_plans').select('id, slug, name, price_cents'),
        supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1 }),
      ]);

      const totalUsers = (usersData as any)?.total ?? (usersData?.users?.length ?? 0);
      const accountsByStatus = { active: 0, suspended: 0, deleted: 0 };
      const accountsByPlan: Record<string, number> = {};
      const planById = new Map((plans ?? []).map((p) => [p.id, p]));

      let mrrCents = 0;
      const now = Date.now();
      const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
      let newLast30 = 0;

      (accounts ?? []).forEach((a: any) => {
        if (accountsByStatus[a.status as keyof typeof accountsByStatus] !== undefined) {
          accountsByStatus[a.status as keyof typeof accountsByStatus]++;
        }
        const plan = a.plan_id ? planById.get(a.plan_id) : null;
        const key = plan?.slug ?? 'sem_plano';
        accountsByPlan[key] = (accountsByPlan[key] ?? 0) + 1;
        if (a.status === 'active' && plan?.price_cents) mrrCents += plan.price_cents;
        if (new Date(a.created_at).getTime() >= thirtyDaysAgo) newLast30++;
      });

      res.json({
        total_users: totalUsers,
        accounts_by_status: accountsByStatus,
        accounts_by_plan: accountsByPlan,
        mrr_cents: mrrCents,
        new_last_30_days: newLast30,
      });
    } catch (err: any) {
      console.error('[platform/metrics] erro:', err);
      res.status(500).json({ error: err.message ?? 'Falha nas métricas' });
    }
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
    const { client_id, title, value, stage, priority, expected_close_date, next_follow_up, notes, assigned_to } = req.body;
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
      assigned_to: assigned_to || null,
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
    const { name, phone, email, value, source, stage: requestedStage, assigned_to } = req.body;
    if (!name || !phone) return res.status(400).json({ error: 'Nome e telefone são obrigatórios' });

    // Stage solicitado (drag direto pra coluna específica) > primeira stage
    const targetStage = (requestedStage && stages.find((s) => s.id === requestedStage)) || firstStage;

    const nowIso = new Date().toISOString();
    const payload: any = {
      title: name,
      contact_name: name,
      contact_phone: phone,
      contact_email: email || null,
      lead_source: source || null,
      value: Number(value) || 0,
      stage: targetStage.id,
      stage_entered_at: nowIso,
      current_stage_entered_at: nowIso,
      stage_history: [
        {
          stage_id: targetStage.id,
          stage_name: targetStage.name,
          entered_at: nowIso,
          left_at: null,
        },
      ],
      priority: 'medium',
      assigned_to: assigned_to || null,
      user_id: userId,
      updated_at: nowIso,
    };

    const { data, error } = await supabase.from('deals').insert(payload).select().single();
    if (error) {
      const retryPayload = {
        title: name,
        value: Number(value) || 0,
        stage: targetStage.id,
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

    if (isNaN(dealId)) return res.status(400).json({ error: 'ID inválido' });

    const { data: existing } = await supabase
      .from('deals')
      .select('id, stage, stage_entered_at, stage_history, current_stage_entered_at, contact_phone, contact_name, title')
      .eq('id', dealId)
      .eq('user_id', userId)
      .single();

    if (!existing) return res.status(404).json({ error: 'Deal not found' });

    const updates: any = { ...req.body, updated_at: new Date().toISOString() };
    const stageChanged = updates.stage && updates.stage !== existing.stage;

    if (stageChanged) {
      const stages = await ensurePipelineStages(supabase, userId);
      const stageName = stages.find((s) => s.id === updates.stage)?.name || updates.stage;
      const nowIso = new Date().toISOString();
      updates.stage_entered_at = nowIso;
      updates.current_stage_entered_at = nowIso;
      updates.stage_history = appendStageHistory(existing.stage_history, updates.stage, stageName, nowIso);
      await recordStageEvent(
        supabase, userId, dealId,
        existing.stage, updates.stage,
        existing.current_stage_entered_at || existing.stage_entered_at
      );
    }

    const { error } = await supabase.from('deals').update(updates).eq('id', dealId).eq('user_id', userId);
    if (error) return res.status(500).json({ error: error.message });

    // Agenda follow-up automático se a nova etapa tiver configurado
    if (stageChanged && existing.contact_phone && supabaseAdmin) {
      const { data: stageConfig } = await supabase
        .from('deal_stages')
        .select('auto_follow_up_enabled, follow_up_delay_hours, follow_up_message')
        .eq('id', updates.stage)
        .eq('user_id', userId)
        .maybeSingle();

      if (stageConfig?.auto_follow_up_enabled && stageConfig?.follow_up_message) {
        const phone = normalizeBrazilianPhone(String(existing.contact_phone).replace(/\D/g, ''));
        const delayHours = stageConfig.follow_up_delay_hours || 2;
        const scheduledAt = computeScheduledAt(delayHours);
        const name = existing.contact_name || (existing as any).title || '';
        const personalizedMsg = stageConfig.follow_up_message.replace(/\{nome\}/gi, name);

        // Cancela follow-ups pendentes anteriores desse deal
        await supabaseAdmin
          .from('scheduled_followups')
          .update({ status: 'cancelled' })
          .eq('deal_id', dealId)
          .eq('user_id', userId)
          .eq('status', 'pending');

        await supabaseAdmin.from('scheduled_followups').insert({
          user_id: userId, deal_id: dealId, phone,
          message: personalizedMsg, stage_id: updates.stage,
          contact_name: name,
          scheduled_at: scheduledAt.toISOString(),
        });
        console.log(`[FollowUp] Agendado para ${phone} às ${scheduledAt.toISOString()} (etapa: ${updates.stage})`);
      }
    }

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
    const { createClient, createJob, client, job, sinalAmount, existingClientId } = req.body;
    const nowIso = new Date().toISOString();

    const { data: deal } = await supabase
      .from('deals')
      .select('*')
      .eq('id', req.params.id)
      .eq('user_id', userId)
      .single();
    if (!deal) return res.status(404).json({ error: 'Deal not found' });

    let clientId = (existingClientId as number | null) || (deal.client_id as number | null);

    if (createClient) {
      const c = client || {};
      // "Como conheceu" não tem coluna própria — concatena nas notas
      const notes = [
        c.notes || '',
        c.how_found ? `Como conheceu: ${c.how_found}` : '',
      ].filter(Boolean).join('\n').trim();

      const clientPayload = {
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
        notes: notes || null,
        status: 'active',
        user_id: userId,
      } as any;
      const { data: newClient, error } = await supabase.from('clients').insert(clientPayload).select().single();
      if (error) return res.status(500).json({ error: error.message });
      clientId = newClient?.id || clientId;
    }

    let jobId: number | null = null;
    if (createJob && job) {
      // Determina a etapa de entrada da produção: primeira etapa do primeiro
      // processo não-especial (tipicamente "Ensaios Vendidos" → "Vendido").
      // Se a config não existir, o job nasce fora da produção (production_stage null).
      let entryProductionStage: string | null = null;
      try {
        const processes = await ensureProductionProcesses(supabase, userId);
        const stagesV2 = await ensureProductionStagesV2(supabase, userId);
        const firstProcess = processes
          .filter((p: any) => !p.is_special)
          .sort((a: any, b: any) => (a.position || 0) - (b.position || 0))[0];
        if (firstProcess) {
          const firstStage = stagesV2
            .filter((s: any) => s.process_id === firstProcess.id)
            .sort((a: any, b: any) => (a.position || 0) - (b.position || 0))[0];
          if (firstStage) entryProductionStage = firstStage.id;
        }
      } catch (err: any) {
        console.warn('[convert] não foi possível resolver etapa de entrada:', err?.message);
      }

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
        // Auto-envio pra produção: novas vendas entram já na primeira etapa
        // configurada (Ensaios Vendidos). Imports em lote/jobs antigos não são
        // afetados — só converts a partir de agora.
        production_stage: entryProductionStage,
        production_stage_entered_at: entryProductionStage ? nowIso : null,
        user_id: userId,
      } as any;
      const { data: newJob, error } = await supabase.from('jobs').insert(jobPayload).select().single();
      if (error) return res.status(500).json({ error: error.message });
      jobId = newJob?.id || null;

      // Registra o sinal como pagamento na tabela job_payments
      if (jobId && sinalAmount && Number(sinalAmount) > 0) {
        const adminClient = supabaseAdmin || supabase;
        await adminClient.from('job_payments').insert({
          job_id: jobId,
          amount: Number(sinalAmount),
          description: 'Sinal',
          payment_date: new Date().toISOString().slice(0, 10),
          payment_method: job.payment_method || 'Pix',
        }).select();
      }
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

  // ── Deal Items (múltiplos produtos/serviços/combos por deal) ──────────────────
  app.post('/api/deals/:id/items', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const adminClient = supabaseAdmin || supabase;
    const dealId = Number(req.params.id);

    // Verifica que o deal pertence ao usuário
    const { data: deal } = await supabase.from('deals').select('id, value').eq('id', dealId).eq('user_id', userId).single();
    if (!deal) return res.status(404).json({ error: 'Deal not found' });

    const { catalog_type, catalog_id, catalog_name, catalog_value, quantidade = 1 } = req.body;
    if (!catalog_type || !catalog_id || !catalog_name) {
      return res.status(400).json({ error: 'catalog_type, catalog_id, catalog_name são obrigatórios' });
    }

    const { data: newItem, error } = await adminClient
      .from('deal_items')
      .insert({ deal_id: dealId, catalog_type, catalog_id, catalog_name, catalog_value: catalog_value || 0, quantidade })
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    // Recalcula valor total dos itens e atualiza o deal
    const { data: allItems } = await adminClient.from('deal_items').select('catalog_value, quantidade').eq('deal_id', dealId);
    const total = (allItems || []).reduce((sum: number, i: any) => sum + (i.catalog_value * i.quantidade), 0);
    await supabase.from('deals').update({ value: total }).eq('id', dealId).eq('user_id', userId);

    res.json({ item: newItem, total });
  });

  app.delete('/api/deal-items/:itemId', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const adminClient = supabaseAdmin || supabase;
    const itemId = req.params.itemId;

    // Busca o item para pegar o deal_id
    const { data: item } = await adminClient.from('deal_items').select('id, deal_id').eq('id', itemId).single();
    if (!item) return res.status(404).json({ error: 'Item not found' });

    // Verifica que o deal pertence ao usuário
    const { data: deal } = await supabase.from('deals').select('id').eq('id', item.deal_id).eq('user_id', userId).single();
    if (!deal) return res.status(403).json({ error: 'Forbidden' });

    const { error } = await adminClient.from('deal_items').delete().eq('id', itemId);
    if (error) return res.status(500).json({ error: error.message });

    // Recalcula valor total dos itens restantes e atualiza o deal
    const { data: remaining } = await adminClient.from('deal_items').select('catalog_value, quantidade').eq('deal_id', item.deal_id);
    const total = (remaining || []).reduce((sum: number, i: any) => sum + (i.catalog_value * i.quantidade), 0);
    await supabase.from('deals').update({ value: total }).eq('id', item.deal_id).eq('user_id', userId);

    res.json({ success: true, total });
  });

  app.put('/api/deal-items/:itemId', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const adminClient = supabaseAdmin || supabase;
    const itemId = req.params.itemId;
    const { quantidade } = req.body;

    if (!quantidade || quantidade < 1) return res.status(400).json({ error: 'quantidade deve ser >= 1' });

    const { data: item } = await adminClient.from('deal_items').select('id, deal_id').eq('id', itemId).single();
    if (!item) return res.status(404).json({ error: 'Item not found' });

    const { data: deal } = await supabase.from('deals').select('id').eq('id', item.deal_id).eq('user_id', userId).single();
    if (!deal) return res.status(403).json({ error: 'Forbidden' });

    const { error } = await adminClient.from('deal_items').update({ quantidade }).eq('id', itemId);
    if (error) return res.status(500).json({ error: error.message });

    // Recalcula total
    const { data: allItems } = await adminClient.from('deal_items').select('catalog_value, quantidade').eq('deal_id', item.deal_id);
    const total = (allItems || []).reduce((sum: number, i: any) => sum + (i.catalog_value * i.quantidade), 0);
    await supabase.from('deals').update({ value: total }).eq('id', item.deal_id).eq('user_id', userId);

    res.json({ success: true, total });
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

  // ============ MÓDULO FINANCEIRO ============

  const finAdmin = () => supabaseAdmin!;
  const finClient = (req: any) => (req as any).supabase as SupabaseClient;
  const finUser = (req: any) => (req as any).userId as string;

  // ─── Helpers ───────────────────────────────────────────────────────────────
  async function atualizarStatusAtrasados(supabase: SupabaseClient, userId: string) {
    const hoje = new Date().toISOString().slice(0, 10);
    await supabase.from('fin_receitas').update({ status: 'atrasado' })
      .eq('user_id', userId).eq('status', 'pendente').lt('data_vencimento', hoje);
    await supabase.from('fin_despesas').update({ status: 'atrasado' })
      .eq('user_id', userId).eq('status', 'pendente').lt('data_vencimento', hoje);
  }

  // ─── Mount global: TODAS as rotas /api/fin/* exigem requireAuth +
  // permissão "finance" do membro. Dono e platform admin sempre passam.
  // Isso é defesa-em-profundidade: o frontend já bloqueia a rota, mas
  // sem isso um membro poderia chamar a API direto.
  app.use('/api/fin', requireAuth, requirePermission('finance'));

  // ─── Categorias ────────────────────────────────────────────────────────────
  app.get('/api/fin/categorias', requireAuth, async (req, res) => {
    const supabase = finClient(req); const userId = finUser(req);
    const { data } = await supabase.from('fin_categorias').select('*').eq('user_id', userId).eq('ativo', true).order('ordem');
    res.json(data || []);
  });

  app.post('/api/fin/categorias', requireAuth, async (req, res) => {
    const supabase = finClient(req); const userId = finUser(req);
    const { nome, tipo, cor, ordem } = req.body;
    const { data, error } = await supabase.from('fin_categorias').insert({ user_id: userId, nome, tipo, cor: cor || '#6366f1', ordem: ordem || 0 }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  });

  app.put('/api/fin/categorias/:id', requireAuth, async (req, res) => {
    const supabase = finClient(req); const userId = finUser(req);
    const { error } = await supabase.from('fin_categorias').update(req.body).eq('id', req.params.id).eq('user_id', userId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  });

  app.delete('/api/fin/categorias/:id', requireAuth, async (req, res) => {
    const supabase = finClient(req); const userId = finUser(req);
    const [{ count: cr }, { count: dp }] = await Promise.all([
      supabase.from('fin_receitas').select('id', { count: 'exact', head: true }).eq('categoria_id', req.params.id).eq('user_id', userId),
      supabase.from('fin_despesas').select('id', { count: 'exact', head: true }).eq('categoria_id', req.params.id).eq('user_id', userId),
    ]);
    if ((cr || 0) + (dp || 0) > 0) return res.status(400).json({ error: 'Categoria em uso. Migre os lançamentos primeiro.' });
    await supabase.from('fin_categorias').update({ ativo: false }).eq('id', req.params.id).eq('user_id', userId);
    res.json({ success: true });
  });

  // ─── Contas bancárias ───────────────────────────────────────────────────────
  app.get('/api/fin/contas', requireAuth, async (req, res) => {
    const supabase = finClient(req); const userId = finUser(req);
    const { data: contas } = await supabase.from('fin_contas').select('*').eq('user_id', userId).eq('ativo', true).order('created_at');
    // Calcular saldo atual para cada conta
    const result = await Promise.all((contas || []).map(async (c: any) => {
      const [{ data: rec }, { data: dep }] = await Promise.all([
        supabase.from('fin_receitas').select('valor_bruto').eq('conta_id', c.id).eq('status', 'recebido').eq('user_id', userId),
        supabase.from('fin_despesas').select('valor').eq('conta_id', c.id).eq('status', 'pago').eq('user_id', userId),
      ]);
      const entradas = (rec || []).reduce((s: number, r: any) => s + r.valor_bruto, 0);
      const saidas = (dep || []).reduce((s: number, d: any) => s + d.valor, 0);
      return { ...c, saldo_atual: c.saldo_inicial + entradas - saidas };
    }));
    res.json(result);
  });

  app.post('/api/fin/contas', requireAuth, async (req, res) => {
    const supabase = finClient(req); const userId = finUser(req);
    const { data, error } = await supabase.from('fin_contas').insert({ ...req.body, user_id: userId }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  });

  app.put('/api/fin/contas/:id', requireAuth, async (req, res) => {
    const supabase = finClient(req); const userId = finUser(req);
    const { error } = await supabase.from('fin_contas').update(req.body).eq('id', req.params.id).eq('user_id', userId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  });

  app.delete('/api/fin/contas/:id', requireAuth, async (req, res) => {
    const supabase = finClient(req); const userId = finUser(req);
    await supabase.from('fin_contas').update({ ativo: false }).eq('id', req.params.id).eq('user_id', userId);
    res.json({ success: true });
  });

  // ─── Meios de recebimento ───────────────────────────────────────────────────
  app.get('/api/fin/meios', requireAuth, async (req, res) => {
    const supabase = finClient(req); const userId = finUser(req);
    const { data } = await supabase.from('fin_meios').select('*').eq('user_id', userId).eq('ativo', true).order('created_at');
    res.json(data || []);
  });

  app.post('/api/fin/meios', requireAuth, async (req, res) => {
    const supabase = finClient(req); const userId = finUser(req);
    const { data, error } = await supabase.from('fin_meios').insert({ ...req.body, user_id: userId }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  });

  app.put('/api/fin/meios/:id', requireAuth, async (req, res) => {
    const supabase = finClient(req); const userId = finUser(req);
    const { error } = await supabase.from('fin_meios').update(req.body).eq('id', req.params.id).eq('user_id', userId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  });

  app.delete('/api/fin/meios/:id', requireAuth, async (req, res) => {
    const supabase = finClient(req); const userId = finUser(req);
    await supabase.from('fin_meios').update({ ativo: false }).eq('id', req.params.id).eq('user_id', userId);
    res.json({ success: true });
  });

  // ─── Receitas ───────────────────────────────────────────────────────────────
  app.get('/api/fin/receitas', requireAuth, async (req, res) => {
    const supabase = finClient(req); const userId = finUser(req);
    await atualizarStatusAtrasados(supabase, userId);
    const q = supabase.from('fin_receitas').select('*').eq('user_id', userId).order('data_vencimento');
    if (req.query.status) (q as any).eq('status', req.query.status);
    const { data } = await q;
    res.json(data || []);
  });

  app.post('/api/fin/receitas', requireAuth, async (req, res) => {
    const supabase = finClient(req); const userId = finUser(req);
    const body = { ...req.body, user_id: userId, updated_at: new Date().toISOString() };
    // Calcular valor_liquido automaticamente se meio informado
    if (body.meio_id && body.valor_bruto) {
      const { data: meio } = await supabase.from('fin_meios').select('taxa_percentual,taxa_fixa').eq('id', body.meio_id).single();
      if (meio) {
        body.taxa_meio = (body.valor_bruto * meio.taxa_percentual / 100) + meio.taxa_fixa;
        body.valor_liquido = body.valor_bruto - body.taxa_meio;
      }
    }
    if (!body.valor_liquido) body.valor_liquido = body.valor_bruto;
    const { data, error } = await supabase.from('fin_receitas').insert(body).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  });

  app.put('/api/fin/receitas/:id', requireAuth, async (req, res) => {
    const supabase = finClient(req); const userId = finUser(req);
    const { error } = await supabase.from('fin_receitas').update({ ...req.body, updated_at: new Date().toISOString() }).eq('id', req.params.id).eq('user_id', userId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  });

  app.delete('/api/fin/receitas/:id', requireAuth, async (req, res) => {
    const supabase = finClient(req); const userId = finUser(req);
    await supabase.from('fin_receitas').delete().eq('id', req.params.id).eq('user_id', userId);
    res.json({ success: true });
  });

  app.post('/api/fin/receitas/:id/receber', requireAuth, async (req, res) => {
    const supabase = finClient(req); const userId = finUser(req);
    const { data_pagamento, conta_id } = req.body;
    const { data: receita } = await supabase.from('fin_receitas').select('meio_id,valor_bruto').eq('id', req.params.id).eq('user_id', userId).single();
    if (!receita) return res.status(404).json({ error: 'Receita não encontrada' });
    let dataRecebimentoReal = data_pagamento;
    if (receita.meio_id) {
      const { data: meio } = await supabase.from('fin_meios').select('prazo_recebimento').eq('id', receita.meio_id).single();
      if (meio && meio.prazo_recebimento > 0) {
        const d = new Date(data_pagamento + 'T12:00:00');
        d.setDate(d.getDate() + meio.prazo_recebimento);
        dataRecebimentoReal = d.toISOString().slice(0, 10);
      }
    }
    const { error } = await supabase.from('fin_receitas').update({ status: 'recebido', data_pagamento, data_recebimento_real: dataRecebimentoReal, conta_id: conta_id || null, updated_at: new Date().toISOString() }).eq('id', req.params.id).eq('user_id', userId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  });

  // ─── Despesas ───────────────────────────────────────────────────────────────
  app.get('/api/fin/despesas', requireAuth, async (req, res) => {
    const supabase = finClient(req); const userId = finUser(req);
    await atualizarStatusAtrasados(supabase, userId);
    const { data } = await supabase.from('fin_despesas').select('*').eq('user_id', userId).order('data_vencimento');
    res.json(data || []);
  });

  app.post('/api/fin/despesas', requireAuth, async (req, res) => {
    const supabase = finClient(req); const userId = finUser(req);
    try {
      const { recorrencia_tipo, recorrencia_qtd, tipo_pessoa, ...rest } = req.body;
      // Colunas base garantidas
      const insertBody: any = {
        descricao: rest.descricao,
        valor: rest.valor,
        status: 'pendente',
        data_vencimento: rest.data_vencimento || null,
        data_pagamento: rest.data_pagamento || null,
        recorrente: rest.recorrente ?? false,
        user_id: userId,
        updated_at: new Date().toISOString(),
      };
      // Colunas opcionais — adicionadas somente se tiverem valor
      // (evita erro de schema caso ainda não existam no banco)
      const optionals: Record<string, any> = {
        categoria_id: rest.categoria_id || null,
        meio_id: rest.meio_id || null,
        fornecedor: rest.fornecedor || null,
        observacoes: rest.observacoes || null,
        frequencia_recorrencia: recorrencia_tipo || null,
        conta_id: rest.conta_id || null,
      };
      // Tenta inserir com todos os campos; se falhar por coluna inexistente,
      // remove o campo problemático e tenta novamente
      let { data, error } = await supabase.from('fin_despesas').insert({ ...insertBody, ...optionals }).select().single();
      if (error?.message?.includes('Could not find')) {
        // Detecta qual coluna está faltando e remove do objeto
        const colMatch = error.message.match(/Could not find the '(\w+)' column/);
        if (colMatch) {
          delete optionals[colMatch[1]];
          ({ data, error } = await supabase.from('fin_despesas').insert({ ...insertBody, ...optionals }).select().single());
        }
        // Se ainda falhar, fallback com campos base apenas
        if (error?.message?.includes('Could not find')) {
          ({ data, error } = await supabase.from('fin_despesas').insert(insertBody).select().single());
        }
      }
      if (error) return res.status(500).json({ error: error.message });
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? 'Erro ao criar despesa' });
    }
  });

  app.put('/api/fin/despesas/:id', requireAuth, async (req, res) => {
    const supabase = finClient(req); const userId = finUser(req);
    const { descricao, valor, status, data_vencimento, data_pagamento, categoria_id, meio_id, fornecedor, observacoes, recorrente, frequencia_recorrencia, conta_id } = req.body;
    const updateBody: any = { updated_at: new Date().toISOString() };
    if (descricao !== undefined) updateBody.descricao = descricao;
    if (valor !== undefined) updateBody.valor = valor;
    if (status !== undefined) updateBody.status = status;
    if (data_vencimento !== undefined) updateBody.data_vencimento = data_vencimento || null;
    if (data_pagamento !== undefined) updateBody.data_pagamento = data_pagamento || null;
    if (categoria_id !== undefined) updateBody.categoria_id = categoria_id || null;
    if (meio_id !== undefined) updateBody.meio_id = meio_id || null;
    if (fornecedor !== undefined) updateBody.fornecedor = fornecedor || null;
    if (observacoes !== undefined) updateBody.observacoes = observacoes || null;
    if (recorrente !== undefined) updateBody.recorrente = recorrente;
    if (frequencia_recorrencia !== undefined) updateBody.frequencia_recorrencia = frequencia_recorrencia || null;
    if (conta_id !== undefined) updateBody.conta_id = conta_id || null;
    const { error } = await supabase.from('fin_despesas').update(updateBody).eq('id', req.params.id).eq('user_id', userId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  });

  app.delete('/api/fin/despesas/:id', requireAuth, async (req, res) => {
    const supabase = finClient(req); const userId = finUser(req);
    await supabase.from('fin_despesas').delete().eq('id', req.params.id).eq('user_id', userId);
    res.json({ success: true });
  });

  app.post('/api/fin/despesas/:id/pagar', requireAuth, async (req, res) => {
    const supabase = finClient(req); const userId = finUser(req);
    const { data_pagamento, conta_id } = req.body;
    const { error } = await supabase.from('fin_despesas').update({ status: 'pago', data_pagamento, conta_id: conta_id || null, updated_at: new Date().toISOString() }).eq('id', req.params.id).eq('user_id', userId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  });

  // ─── Sincronizar jobs → receitas (importação automática) ───────────────────
  app.post('/api/fin/sync-jobs', requireAuth, async (req, res) => {
    const supabase = finClient(req); const userId = finUser(req);
    const adminClient = supabaseAdmin || supabase;

    // Carrega todos os jobs — precisamos saber quais estão em produção
    const { data: allJobs } = await supabase
      .from('jobs')
      .select('id,client_id,job_name,job_date,amount,payment_status,payment_method,production_stage,fin_synced,clients(id,name)')
      .eq('user_id', userId);
    if (!allJobs?.length) return res.json({ criadas: 0, atualizadas: 0, removidas: 0 });

    // Só sincroniza trabalhos que estão EM PRODUÇÃO (têm etapa definida).
    // Espelha a Produção: o que não está lá não vira conta a receber.
    const jobs = (allJobs as any[]).filter((j) => j.production_stage);
    const productionJobIds = new Set(jobs.map((j: any) => Number(j.id)));

    // ── Limpeza da conciliação ──────────────────────────────────────────────
    // Remove TODAS as receitas automáticas de trabalhos fora da produção
    // (recebidas ou não); e deduplica as contas a receber dos que estão.
    // Lançamentos manuais (origem_automatica = false) nunca são tocados.
    let removidas = 0;
    const { data: autoReceitas } = await supabase
      .from('fin_receitas')
      .select('id,job_id,status,valor_bruto')
      .eq('user_id', userId)
      .eq('origem_automatica', true)
      .not('job_id', 'is', null);
    const idsParaRemover: string[] = [];
    const pendProdPorJob = new Map<number, any[]>();
    for (const r of (autoReceitas || [])) {
      const jid = Number(r.job_id);
      if (!productionJobIds.has(jid)) {
        // Fora da produção → remove a receita automática (qualquer status)
        idsParaRemover.push(r.id);
      } else if (r.status === 'pendente' || r.status === 'atrasado') {
        // Em produção → guarda pra deduplicar as contas a receber
        const list = pendProdPorJob.get(jid) || [];
        list.push(r);
        pendProdPorJob.set(jid, list);
      }
    }
    // Cada trabalho em produção deve ter no máximo 1 conta a receber automática
    for (const [, list] of pendProdPorJob) {
      if (list.length > 1) {
        list.sort((a: any, b: any) => (b.valor_bruto || 0) - (a.valor_bruto || 0));
        for (const r of list.slice(1)) idsParaRemover.push(r.id);
      }
    }
    if (idsParaRemover.length > 0) {
      // Apaga em lotes — uma lista enorme de IDs numa só requisição estoura
      // o limite de tamanho da URL e a remoção falha silenciosamente.
      for (let i = 0; i < idsParaRemover.length; i += 100) {
        await supabase
          .from('fin_receitas')
          .delete()
          .in('id', idsParaRemover.slice(i, i + 100))
          .eq('user_id', userId);
      }
      removidas = idsParaRemover.length;
    }

    if (!jobs.length) return res.json({ criadas: 0, atualizadas: 0, removidas });

    const jobIds = jobs.map((j: any) => j.id);

    // Carrega receitas (já sem as removidas) e pagamentos em paralelo
    const [{ data: todasReceitas }, { data: todosPayments }] = await Promise.all([
      supabase
        .from('fin_receitas')
        .select('id,job_id,status,valor_bruto')
        .eq('user_id', userId)
        .not('job_id', 'is', null),
      adminClient
        .from('job_payments')
        .select('*')
        .in('job_id', jobIds)
        .order('created_at'),
    ]);

    // Agrupa por job_id — normaliza para Number para evitar mismatch string/int
    const receitasPorJob = new Map<number, any[]>();
    for (const r of (todasReceitas || [])) {
      const jid = Number(r.job_id);
      const list = receitasPorJob.get(jid) || [];
      list.push(r);
      receitasPorJob.set(jid, list);
    }
    const paymentsPorJob = new Map<number, any[]>();
    for (const p of (todosPayments || [])) {
      const jid = Number(p.job_id);
      const list = paymentsPorJob.get(jid) || [];
      list.push(p);
      paymentsPorJob.set(jid, list);
    }

    let criadas = 0;
    let atualizadas = 0;
    const hoje = new Date().toISOString().slice(0, 10);

    for (const job of jobs) {
      const jid = Number(job.id);
      const receitasExistentes = receitasPorJob.get(jid) || [];
      const paymentsArr = paymentsPorJob.get(jid) || [];
      const temReceita = receitasExistentes.length > 0;
      const dataVencimento = job.job_date || hoje;
      const clienteNome = (job.clients as any)?.name || job.job_name || `Job #${job.id}`;
      const descricaoBase = job.job_name || clienteNome;

      if (!temReceita) {
        // Sem receitas no momento. Se o job JÁ foi sincronizado uma vez, foi o
        // usuário que apagou — não recria. Só cria pra job nunca sincronizado.
        if (!job.fin_synced) {
          // ── Job nunca sincronizado: criar receitas do zero ──
          if (paymentsArr.length > 0) {
            for (const pay of paymentsArr) {
              await supabase.from('fin_receitas').insert({
                user_id: userId, job_id: job.id,
                cliente_id: job.client_id, cliente_nome: clienteNome,
                descricao: `${descricaoBase} — ${pay.description || 'Pagamento'}`,
                valor_bruto: pay.amount, taxa_meio: 0, valor_liquido: pay.amount,
                data_vencimento: pay.payment_date || dataVencimento,
                data_pagamento: pay.payment_date,
                status: 'recebido', parcela: 1, total_parcelas: 1,
                origem_automatica: true, updated_at: new Date().toISOString(),
              });
              criadas++;
            }
            const totalPago = paymentsArr.reduce((s: number, p: any) => s + (p.amount || 0), 0);
            const restante = (job.amount || 0) - totalPago;
            if (restante > 1 && job.payment_status !== 'paid') {
              const st = dataVencimento < hoje ? 'atrasado' : 'pendente';
              await supabase.from('fin_receitas').insert({
                user_id: userId, job_id: job.id, cliente_id: job.client_id, cliente_nome: clienteNome,
                descricao: `${descricaoBase} — Saldo restante`,
                valor_bruto: restante, taxa_meio: 0, valor_liquido: restante,
                data_vencimento: dataVencimento, status: st,
                parcela: 1, total_parcelas: 1, origem_automatica: true, updated_at: new Date().toISOString(),
              });
              criadas++;
            }
          } else if ((job.amount || 0) > 0) {
            const st = job.payment_status === 'paid' ? 'recebido' : (dataVencimento < hoje ? 'atrasado' : 'pendente');
            await supabase.from('fin_receitas').insert({
              user_id: userId, job_id: job.id, cliente_id: job.client_id, cliente_nome: clienteNome,
              descricao: descricaoBase,
              valor_bruto: job.amount, taxa_meio: 0, valor_liquido: job.amount,
              data_vencimento: dataVencimento,
              data_pagamento: st === 'recebido' ? hoje : null,
              status: st, parcela: 1, total_parcelas: 1,
              origem_automatica: true, updated_at: new Date().toISOString(),
            });
            criadas++;
          }
          // Marca o job como sincronizado — não recria se o usuário apagar depois
          await supabase.from('jobs').update({ fin_synced: true }).eq('id', job.id).eq('user_id', userId);
        }
      } else {
        // ── Job já existente: reconciliar com estado atual ────────────────────
        if (job.payment_status === 'paid') {
          // Marca TODA receita pendente/atrasada como recebido.
          // Usa a data do último pagamento real (não "hoje") pra o
          // faturamento cair no mês certo, não misturar com o atual.
          const dataRecebida = paymentsArr.length > 0
            ? (paymentsArr[paymentsArr.length - 1].payment_date || dataVencimento || hoje)
            : (dataVencimento || hoje);
          const pendentes = receitasExistentes.filter((r: any) =>
            r.status === 'pendente' || r.status === 'atrasado'
          );
          for (const r of pendentes) {
            await supabase.from('fin_receitas')
              .update({ status: 'recebido', data_pagamento: dataRecebida, cliente_nome: clienteNome, updated_at: new Date().toISOString() })
              .eq('id', r.id).eq('user_id', userId);
            atualizadas++;
          }
          // Corrige cliente_nome nas recebidas também
          const recebidas = receitasExistentes.filter((r: any) => r.status === 'recebido');
          for (const r of recebidas) {
            await supabase.from('fin_receitas')
              .update({ cliente_nome: clienteNome, updated_at: new Date().toISOString() })
              .eq('id', r.id).eq('user_id', userId);
          }
        } else if (job.payment_status === 'partial' && paymentsArr.length > 0) {
          // Para cada pagamento real, insere receita se ainda não existe como recebido
          for (const pay of paymentsArr) {
            const jaExiste = receitasExistentes.some(
              (r: any) => r.status === 'recebido' && Math.abs(r.valor_bruto - pay.amount) < 0.01
            );
            if (!jaExiste) {
              await supabase.from('fin_receitas').insert({
                user_id: userId, job_id: job.id,
                cliente_id: job.client_id, cliente_nome: clienteNome,
                descricao: `${descricaoBase} — ${pay.description || 'Pagamento parcial'}`,
                valor_bruto: pay.amount, taxa_meio: 0, valor_liquido: pay.amount,
                data_vencimento: pay.payment_date || dataVencimento,
                data_pagamento: pay.payment_date,
                status: 'recebido', parcela: 1, total_parcelas: 1,
                origem_automatica: true, updated_at: new Date().toISOString(),
              });
              criadas++;
            } else {
              // Corrige cliente_nome se estava errado
              const r = receitasExistentes.find((r: any) => r.status === 'recebido' && Math.abs(r.valor_bruto - pay.amount) < 0.01);
              if (r) {
                await supabase.from('fin_receitas')
                  .update({ cliente_nome: clienteNome, updated_at: new Date().toISOString() })
                  .eq('id', r.id).eq('user_id', userId);
              }
            }
          }
          // Corrige cliente_nome nas receitas pendentes
          const pendentes = receitasExistentes.filter((r: any) => r.status === 'pendente' || r.status === 'atrasado');
          for (const r of pendentes) {
            await supabase.from('fin_receitas')
              .update({ cliente_nome: clienteNome, updated_at: new Date().toISOString() })
              .eq('id', r.id).eq('user_id', userId);
          }
        } else {
          // pending — só corrige o cliente_nome
          for (const r of receitasExistentes) {
            await supabase.from('fin_receitas')
              .update({ cliente_nome: clienteNome, updated_at: new Date().toISOString() })
              .eq('id', r.id).eq('user_id', userId);
          }
        }
      }
    }

    res.json({ criadas, atualizadas, removidas });
  });

  // ─── Diagnóstico do sync ────────────────────────────────────────────────────
  app.get('/api/fin/sync-jobs/debug', requireAuth, async (req, res) => {
    const supabase = finClient(req); const userId = finUser(req);
    const adminClient = supabaseAdmin || supabase;

    const { data: jobs } = await supabase
      .from('jobs')
      .select('id,job_name,amount,payment_status,job_date')
      .eq('user_id', userId)
      .order('id');

    if (!jobs?.length) return res.json({ resumo: { total_jobs: 0, sem_receita: 0, ok_pago: 0, pago_mas_pendente: 0, parcial: 0, pendente: 0 }, jobs: [] });

    const jobIds = jobs.map((j: any) => j.id);

    // Carrega receitas e pagamentos em paralelo (sem N+1)
    const [{ data: receitas }, { data: todosPayments }] = await Promise.all([
      supabase
        .from('fin_receitas')
        .select('job_id,status,valor_bruto,descricao')
        .eq('user_id', userId)
        .not('job_id', 'is', null),
      adminClient
        .from('job_payments')
        .select('id,job_id,amount,payment_date')
        .in('job_id', jobIds),
    ]);

    // Normaliza job_id para Number para evitar mismatch string/int
    const receitasPorJob = new Map<number, any[]>();
    for (const r of (receitas || [])) {
      const jid = Number(r.job_id);
      const list = receitasPorJob.get(jid) || [];
      list.push(r);
      receitasPorJob.set(jid, list);
    }
    const paymentsPorJob = new Map<number, any[]>();
    for (const p of (todosPayments || [])) {
      const jid = Number(p.job_id);
      const list = paymentsPorJob.get(jid) || [];
      list.push(p);
      paymentsPorJob.set(jid, list);
    }

    const diagnostico = (jobs || []).map((job: any) => {
      const jid = Number(job.id);
      const receitasDoJob = receitasPorJob.get(jid) || [];
      const payments = paymentsPorJob.get(jid) || [];

      return {
        job_id: job.id,
        job_name: job.job_name,
        job_amount: job.amount,
        payment_status: job.payment_status,
        job_date: job.job_date,
        tem_receita: receitasDoJob.length > 0,
        receitas: receitasDoJob.map((r: any) => ({ status: r.status, valor: r.valor_bruto, descricao: r.descricao })),
        job_payments: payments.map((p: any) => ({ id: p.id, amount: p.amount, date: p.payment_date })),
        problema: (() => {
          if (receitasDoJob.length === 0) return 'SEM_RECEITA';
          if (job.payment_status === 'paid' && receitasDoJob.every((r: any) => r.status === 'recebido')) return 'OK_PAGO';
          if (job.payment_status === 'paid' && receitasDoJob.some((r: any) => r.status !== 'recebido')) return 'PAGO_MAS_RECEITA_PENDENTE';
          if (job.payment_status === 'partial') return 'PARCIAL';
          if (job.payment_status === 'pending' || !job.payment_status) return 'PENDENTE';
          return 'OK';
        })(),
      };
    });

    const resumo = {
      total_jobs: diagnostico.length,
      sem_receita: diagnostico.filter((d: any) => d.problema === 'SEM_RECEITA').length,
      ok_pago: diagnostico.filter((d: any) => d.problema === 'OK_PAGO').length,
      pago_mas_pendente: diagnostico.filter((d: any) => d.problema === 'PAGO_MAS_RECEITA_PENDENTE').length,
      parcial: diagnostico.filter((d: any) => d.problema === 'PARCIAL').length,
      pendente: diagnostico.filter((d: any) => d.problema === 'PENDENTE').length,
    };

    res.json({ resumo, jobs: diagnostico });
  });

  // ─── Dashboard financeiro ───────────────────────────────────────────────────
  app.get('/api/fin/dashboard', requireAuth, async (req, res) => {
    const supabase = finClient(req); const userId = finUser(req);
    await atualizarStatusAtrasados(supabase, userId);
    const hoje = new Date();
    const mesAtual = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;

    const [{ data: receitas }, { data: despesas }, { data: contas }] = await Promise.all([
      supabase.from('fin_receitas').select('*').eq('user_id', userId),
      supabase.from('fin_despesas').select('*').eq('user_id', userId),
      supabase.from('fin_contas').select('*').eq('user_id', userId).eq('ativo', true),
    ]);

    const r = receitas || []; const d = despesas || [];

    // KPIs do mês atual
    const receita_mes = r
      .filter((x: any) => x.status === 'recebido' && (x.data_pagamento || x.data_vencimento)?.startsWith(mesAtual))
      .reduce((s: number, x: any) => s + (x.valor_liquido || 0), 0);
    const despesa_mes = d
      .filter((x: any) => x.status === 'pago' && (x.data_pagamento || x.data_vencimento)?.startsWith(mesAtual))
      .reduce((s: number, x: any) => s + (x.valor || 0), 0);
    const receitas_pendentes = r
      .filter((x: any) => x.status === 'pendente')
      .reduce((s: number, x: any) => s + (x.valor_liquido || 0), 0);
    const despesas_pendentes = d
      .filter((x: any) => x.status === 'pendente')
      .reduce((s: number, x: any) => s + (x.valor || 0), 0);
    const receitas_atrasadas = r
      .filter((x: any) => x.status === 'atrasado')
      .reduce((s: number, x: any) => s + (x.valor_liquido || 0), 0);
    const despesas_atrasadas = d
      .filter((x: any) => x.status === 'atrasado')
      .reduce((s: number, x: any) => s + (x.valor || 0), 0);

    // Saldo total das contas
    const saldo_contas = (contas || []).reduce((s: number, c: any) => {
      const entradas = r.filter((x: any) => x.conta_id === c.id && x.status === 'recebido').reduce((a: number, x: any) => a + (x.valor_liquido || 0), 0);
      const saidas = d.filter((x: any) => x.conta_id === c.id && x.status === 'pago').reduce((a: number, x: any) => a + (x.valor || 0), 0);
      return s + (c.saldo_inicial || 0) + entradas - saidas;
    }, 0);

    // Fluxo de caixa — últimos 12 meses (passado → presente)
    const fluxo_12m: any[] = [];
    for (let i = 11; i >= 0; i--) {
      const dt = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1);
      const mes = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
      const label = dt.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });
      const receiMes = r
        .filter((x: any) => x.status === 'recebido' && (x.data_pagamento || x.data_vencimento)?.startsWith(mes))
        .reduce((s: number, x: any) => s + (x.valor_liquido || 0), 0);
      const despMes = d
        .filter((x: any) => x.status === 'pago' && (x.data_pagamento || x.data_vencimento)?.startsWith(mes))
        .reduce((s: number, x: any) => s + (x.valor || 0), 0);
      fluxo_12m.push({ mes: label, receitas: receiMes, despesas: despMes, lucro: receiMes - despMes });
    }

    // Próximos recebimentos (pendentes e atrasados, ordenados por vencimento)
    const proximos_recebimentos = r
      .filter((x: any) => ['pendente', 'atrasado'].includes(x.status))
      .sort((a: any, b: any) => (a.data_vencimento || '').localeCompare(b.data_vencimento || ''))
      .slice(0, 5)
      .map((x: any) => ({ id: x.id, descricao: x.descricao, valor: x.valor_liquido, data_vencimento: x.data_vencimento, status: x.status }));

    // Próximas despesas
    const proximas_despesas = d
      .filter((x: any) => ['pendente', 'atrasado'].includes(x.status))
      .sort((a: any, b: any) => (a.data_vencimento || '').localeCompare(b.data_vencimento || ''))
      .slice(0, 5)
      .map((x: any) => ({ id: x.id, descricao: x.descricao, valor: x.valor, data_vencimento: x.data_vencimento, status: x.status }));

    res.json({
      kpis: { receita_mes, despesa_mes, lucro_mes: receita_mes - despesa_mes, saldo_contas, receitas_pendentes, despesas_pendentes, receitas_atrasadas, despesas_atrasadas },
      fluxo_12m,
      proximos_recebimentos,
      proximas_despesas,
    });
  });

  // ─── DRE ───────────────────────────────────────────────────────────────────
  app.get('/api/fin/dre', requireAuth, async (req, res) => {
    const supabase = finClient(req); const userId = finUser(req);
    const { mes, ano } = req.query;

    // Filtro de período: "YYYY-MM" ou "YYYY"
    const periodoFiltro = mes
      ? `${ano}-${String(mes).padStart(2, '0')}`
      : String(ano);
    const periodoLabel = mes
      ? new Date(Number(ano), Number(mes) - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
      : `Ano ${ano}`;

    const [{ data: grupos }, { data: categorias }, { data: receitas }, { data: despesas }] = await Promise.all([
      supabase.from('fin_grupos_dre').select('*').eq('user_id', userId).order('ordem'),
      supabase.from('fin_categorias').select('*').eq('user_id', userId).eq('ativo', true),
      supabase.from('fin_receitas').select('*').eq('user_id', userId).like('data_vencimento', `${periodoFiltro}%`).eq('status', 'recebido'),
      supabase.from('fin_despesas').select('*').eq('user_id', userId).like('data_vencimento', `${periodoFiltro}%`).eq('status', 'pago'),
    ]);

    const receitaBruta = (receitas || []).reduce((s: number, r: any) => s + (r.valor_bruto || 0), 0);
    const taxasTotal = (receitas || []).reduce((s: number, r: any) => s + (r.taxa_meio || 0), 0);

    const linhas: any[] = [];
    const totais_parciais: Record<string, number> = {};
    let acumulado = receitaBruta;

    for (const grupo of (grupos || [])) {
      const catsDeste = (categorias || []).filter((c: any) => c.grupo_dre_id === grupo.id);
      const categoriasLinha: any[] = [];
      let total_grupo = 0;

      // Campos automáticos (ex: taxas de recebimento)
      if (grupo.campos_automaticos?.includes('taxas_recebimento') && taxasTotal > 0) {
        categoriasLinha.push({ categoria_id: null, categoria_nome: 'Taxas de recebimento', total: taxasTotal });
        total_grupo += taxasTotal;
      }

      for (const cat of catsDeste) {
        const isReceita = cat.tipo === 'receita';
        const total = isReceita
          ? (receitas || []).filter((r: any) => r.categoria_id === cat.id).reduce((s: number, r: any) => s + (r.valor_bruto || 0), 0)
          : (despesas || []).filter((d: any) => d.categoria_id === cat.id).reduce((s: number, d: any) => s + (d.valor || 0), 0);
        categoriasLinha.push({ categoria_id: cat.id, categoria_nome: cat.nome, total });
        total_grupo += total;
      }

      linhas.push({
        grupo_id: grupo.id,
        grupo_nome: grupo.nome,
        tipo: grupo.tipo,
        operacao: grupo.operacao,
        ordem: grupo.ordem,
        total_parcial_apos: grupo.total_parcial_apos || null,
        categorias: categoriasLinha,
        total_grupo,
      });

      if (grupo.operacao === 'subtrai') acumulado -= total_grupo;
      else if (grupo.nome !== '(+) Receita Bruta') acumulado += total_grupo; // Receita Bruta já é o acumulado inicial

      if (grupo.total_parcial_apos) {
        totais_parciais[grupo.total_parcial_apos] = acumulado;
      }
    }

    res.json({ periodo: periodoLabel, linhas, totais_parciais, resultado_liquido: acumulado });
  });

  // ─── Relatórios ────────────────────────────────────────────────────────────
  app.get('/api/fin/relatorios', requireAuth, async (req, res) => {
    const supabase = finClient(req); const userId = finUser(req);
    const { tipo, ano, mes_inicio, mes_fim } = req.query as Record<string, string>;

    const inicio = `${ano}-${String(mes_inicio).padStart(2, '0')}-01`;
    const fim = `${ano}-${String(mes_fim).padStart(2, '0')}-31`;

    if (tipo === 'receitas_categoria') {
      const [{ data: receitas }, { data: categorias }] = await Promise.all([
        supabase.from('fin_receitas').select('categoria_id, valor_liquido').eq('user_id', userId).eq('status', 'recebido').gte('data_vencimento', inicio).lte('data_vencimento', fim),
        supabase.from('fin_categorias').select('id, nome').eq('user_id', userId),
      ]);
      const catMap = new Map((categorias || []).map((c: any) => [c.id, c.nome]));
      const map = new Map<string, number>();
      (receitas || []).forEach((r: any) => {
        const cat = catMap.get(r.categoria_id) || 'Sem categoria';
        map.set(cat, (map.get(cat) || 0) + (r.valor_liquido || 0));
      });
      return res.json([...map.entries()].sort((a, b) => b[1] - a[1]).map(([Categoria, Total]) => ({ Categoria, Total })));
    }

    if (tipo === 'despesas_categoria') {
      const [{ data: despesas }, { data: categorias }] = await Promise.all([
        supabase.from('fin_despesas').select('categoria_id, valor').eq('user_id', userId).eq('status', 'pago').gte('data_vencimento', inicio).lte('data_vencimento', fim),
        supabase.from('fin_categorias').select('id, nome').eq('user_id', userId),
      ]);
      const catMap = new Map((categorias || []).map((c: any) => [c.id, c.nome]));
      const map = new Map<string, number>();
      (despesas || []).forEach((d: any) => {
        const cat = catMap.get(d.categoria_id) || 'Sem categoria';
        map.set(cat, (map.get(cat) || 0) + (d.valor || 0));
      });
      return res.json([...map.entries()].sort((a, b) => b[1] - a[1]).map(([Categoria, Total]) => ({ Categoria, Total })));
    }

    if (tipo === 'receitas_cliente') {
      const { data: receitas } = await supabase.from('fin_receitas').select('cliente_nome, valor_liquido').eq('user_id', userId).eq('status', 'recebido').gte('data_vencimento', inicio).lte('data_vencimento', fim);
      const map = new Map<string, number>();
      (receitas || []).forEach((r: any) => {
        const cli = r.cliente_nome || 'Sem cliente';
        map.set(cli, (map.get(cli) || 0) + (r.valor_liquido || 0));
      });
      return res.json([...map.entries()].sort((a, b) => b[1] - a[1]).map(([Cliente, Total]) => ({ Cliente, Total })));
    }

    if (tipo === 'fluxo_mensal') {
      const [{ data: receitas }, { data: despesas }] = await Promise.all([
        supabase.from('fin_receitas').select('data_vencimento, valor_liquido').eq('user_id', userId).eq('status', 'recebido').gte('data_vencimento', inicio).lte('data_vencimento', fim),
        supabase.from('fin_despesas').select('data_vencimento, valor').eq('user_id', userId).eq('status', 'pago').gte('data_vencimento', inicio).lte('data_vencimento', fim),
      ]);
      const mesesMap = new Map<string, { Receitas: number; Despesas: number; Lucro: number }>();
      (receitas || []).forEach((r: any) => {
        const mes = r.data_vencimento?.slice(0, 7) || '';
        const e = mesesMap.get(mes) || { Receitas: 0, Despesas: 0, Lucro: 0 };
        e.Receitas += (r.valor_liquido || 0);
        e.Lucro += (r.valor_liquido || 0);
        mesesMap.set(mes, e);
      });
      (despesas || []).forEach((d: any) => {
        const mes = d.data_vencimento?.slice(0, 7) || '';
        const e = mesesMap.get(mes) || { Receitas: 0, Despesas: 0, Lucro: 0 };
        e.Despesas += (d.valor || 0);
        e.Lucro -= (d.valor || 0);
        mesesMap.set(mes, e);
      });
      return res.json([...mesesMap.entries()].sort().map(([Mês, v]) => ({ Mês, ...v })));
    }

    res.status(400).json({ error: 'tipo inválido' });
  });

  // ─── OFX ───────────────────────────────────────────────────────────────────
  app.post('/api/fin/ofx/import', requireAuth, async (req, res) => {
    const supabase = finClient(req); const userId = finUser(req);
    const { conteudo, conta_id } = req.body;
    if (!conteudo || !conta_id) return res.status(400).json({ error: 'conteudo e conta_id obrigatórios' });

    // Parser OFX simples
    const transacoes: any[] = [];
    const stmtMatches = conteudo.matchAll(/<STMTTRN>([\s\S]*?)<\/STMTTRN>/g);
    for (const match of stmtMatches) {
      const block = match[1];
      const get = (tag: string) => { const m = block.match(new RegExp(`<${tag}>([^<\\n]+)`)); return m ? m[1].trim() : ''; };
      const fitId = get('FITID'); if (!fitId) continue;
      const trnType = get('TRNTYPE');
      const dtPosted = get('DTPOSTED');
      const trnAmt = parseFloat(get('TRNAMT').replace(',', '.')) || 0;
      const memo = get('MEMO') || get('NAME') || '';
      const data = dtPosted ? `${dtPosted.slice(0,4)}-${dtPosted.slice(4,6)}-${dtPosted.slice(6,8)}` : new Date().toISOString().slice(0,10);
      const tipo = trnAmt >= 0 ? 'credito' : 'debito';
      transacoes.push({ user_id: userId, conta_id, fit_id: fitId, tipo, valor: Math.abs(trnAmt), data, descricao: memo });
    }

    let importadas = 0; let duplicadas = 0;
    for (const t of transacoes) {
      const { error } = await supabase.from('fin_transacoes_ofx').insert(t);
      if (error?.code === '23505') duplicadas++; else if (!error) importadas++;
    }
    res.json({ importadas, duplicadas, total: transacoes.length });
  });

  app.get('/api/fin/ofx/transacoes', requireAuth, async (req, res) => {
    const supabase = finClient(req); const userId = finUser(req);
    const q = supabase.from('fin_transacoes_ofx').select('*').eq('user_id', userId).order('data', { ascending: false });
    if (req.query.conta_id) (q as any).eq('conta_id', req.query.conta_id);
    const { data } = await q;
    res.json(data || []);
  });

  app.post('/api/fin/ofx/conciliar', requireAuth, async (req, res) => {
    const supabase = finClient(req); const userId = finUser(req);
    const { transacao_id, receita_id, despesa_id, ignorar } = req.body;
    if (ignorar) {
      await supabase.from('fin_transacoes_ofx').update({ status_conciliacao: 'ignorado' }).eq('id', transacao_id).eq('user_id', userId);
      return res.json({ success: true });
    }
    const updates: any = { status_conciliacao: 'conciliado' };
    const { data: tx } = await supabase.from('fin_transacoes_ofx').select('data,valor').eq('id', transacao_id).single();
    if (receita_id) {
      updates.receita_id = receita_id;
      await supabase.from('fin_receitas').update({ status: 'recebido', data_pagamento: tx?.data, updated_at: new Date().toISOString() }).eq('id', receita_id).eq('user_id', userId);
    }
    if (despesa_id) {
      updates.despesa_id = despesa_id;
      await supabase.from('fin_despesas').update({ status: 'pago', data_pagamento: tx?.data, updated_at: new Date().toISOString() }).eq('id', despesa_id).eq('user_id', userId);
    }
    await supabase.from('fin_transacoes_ofx').update(updates).eq('id', transacao_id).eq('user_id', userId);
    res.json({ success: true });
  });

  // ─── Grupos DRE ────────────────────────────────────────────────────────────
  app.get('/api/fin/grupos-dre', requireAuth, async (req, res) => {
    const supabase = finClient(req); const userId = finUser(req);
    const { data } = await supabase.from('fin_grupos_dre').select('*').eq('user_id', userId).order('ordem');
    res.json(data || []);
  });

  app.post('/api/fin/grupos-dre', requireAuth, async (req, res) => {
    const supabase = finClient(req); const userId = finUser(req);
    const { data, error } = await supabase.from('fin_grupos_dre').insert({ ...req.body, user_id: userId }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  });

  app.put('/api/fin/grupos-dre/:id', requireAuth, async (req, res) => {
    const supabase = finClient(req); const userId = finUser(req);
    const { error } = await supabase.from('fin_grupos_dre').update(req.body).eq('id', req.params.id).eq('user_id', userId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  });

  app.delete('/api/fin/grupos-dre/:id', requireAuth, async (req, res) => {
    const supabase = finClient(req); const userId = finUser(req);
    await supabase.from('fin_grupos_dre').delete().eq('id', req.params.id).eq('user_id', userId);
    res.json({ success: true });
  });

  // ============ EXTENSÃO CHROME — endpoints ============

  // Buscar deal por telefone (extensão usa ?phone=5511...)
  // Agenda do mês pra extensão WhatsApp — agrega jobs e (futuro) Google events
  // Painel "Vendas recentes" da extensão — vendas (deals convertidos) num
  // período, com cross-reference do status na produção (em qual etapa o job
  // está, ou se ficou fora da produção).
  app.get('/api/extension/sales-overview', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const days = Math.max(1, Math.min(365, parseInt(String(req.query.days || '7'), 10)));
    const fromIso = new Date(Date.now() - days * 86400000).toISOString();

    const stages = await ensurePipelineStages(supabase, userId);
    const wonStageIds = stages.filter((s) => s.is_won).map((s) => s.id);
    if (wonStageIds.length === 0) return res.json({ sales: [], days });

    const { data: deals } = await supabase
      .from('deals')
      .select('id, title, contact_name, contact_phone, value, converted_at, converted_job_id, client_id, stage')
      .eq('user_id', userId)
      .in('stage', wonStageIds)
      .gte('converted_at', fromIso)
      .order('converted_at', { ascending: false })
      .limit(200);

    const jobIds = (deals || []).map((d) => d.converted_job_id).filter(Boolean) as number[];
    let jobsRes: { data: any[] | null } = { data: [] };
    if (jobIds.length) {
      jobsRes = await supabase
        .from('jobs')
        .select('id, production_stage, job_name, job_date')
        .in('id', jobIds);
    }
    const jobById = new Map<number, any>((jobsRes.data || []).map((j: any) => [j.id, j]));

    const prodStages = await ensureProductionStagesV2(supabase, userId);
    const prodById = new Map(prodStages.map((s: any) => [s.id, s]));

    const sales = (deals || []).map((d: any) => {
      const job = d.converted_job_id ? jobById.get(d.converted_job_id) : null;
      const prodStage = job?.production_stage ? prodById.get(job.production_stage) : null;
      return {
        deal_id: d.id,
        job_id: job?.id || null,
        job_name: job?.job_name || null,
        job_date: job?.job_date || null,
        client_name: d.contact_name || d.title || 'Sem nome',
        contact_phone: d.contact_phone || null,
        value: Number(d.value) || 0,
        converted_at: d.converted_at,
        in_production: !!prodStage,
        production_stage_id: prodStage?.id || null,
        production_stage_name: prodStage?.name || null,
      };
    });

    res.json({ sales, days });
  });

  // Cancela uma venda (geralmente duplicata): move o deal pra etapa
  // "perdido", limpa as flags de conversão e apaga o job vinculado (se
  // houver). O deal continua salvo no histórico — só sai do "ganho".
  app.post('/api/deals/:id/cancel-sale', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const adminClient = supabaseAdmin || supabase;
    const stages = await ensurePipelineStages(supabase, userId);

    // Resolução robusta da etapa "perdido": prioriza id='lost' (mais comum),
    // depois qualquer is_final && !is_won, depois fallback do DEFAULT.
    const lostStage =
      stages.find((s) => s.id === 'lost') ||
      stages.find((s) => s.is_final && !s.is_won) ||
      DEFAULT_STAGES.find((s) => s.id === 'lost');
    if (!lostStage) {
      console.warn('[cancel-sale] sem etapa "perdido" configurada', { userId });
      return res.status(400).json({ error: 'Sem etapa "perdido" configurada no funil' });
    }

    const { data: deal, error: dealErr } = await supabase
      .from('deals')
      .select('*')
      .eq('id', req.params.id)
      .eq('user_id', userId)
      .single();
    if (dealErr || !deal) {
      console.warn('[cancel-sale] deal não encontrado:', dealErr?.message);
      return res.status(404).json({ error: 'Venda não encontrada' });
    }

    // Apaga o job vinculado primeiro (se houver) — usa admin pra bypassar
    // qualquer RLS quirky e garantir que sumiu mesmo.
    if (deal.converted_job_id) {
      const { error: jobErr } = await adminClient
        .from('jobs')
        .delete()
        .eq('id', deal.converted_job_id);
      if (jobErr) console.warn('[cancel-sale] falha apagando job:', jobErr.message);
    }

    const nowIso = new Date().toISOString();
    const updates: any = {
      stage: lostStage.id,
      stage_entered_at: nowIso,
      current_stage_entered_at: nowIso,
      stage_history: appendStageHistory(deal.stage_history, lostStage.id, lostStage.name, nowIso),
      converted: false,
      converted_at: null,
      converted_job_id: null,
      temperature: 'cold',
      temperature_locked: true,
      lost_reason: req.body?.reason || 'Cancelado (venda duplicada/erro)',
    };

    const { error } = await supabase
      .from('deals')
      .update(updates)
      .eq('id', req.params.id)
      .eq('user_id', userId);
    if (error) {
      console.error('[cancel-sale] update do deal falhou:', error.message);
      return res.status(500).json({ error: `Falha ao mover pra perdido: ${error.message}` });
    }

    try {
      await recordStageEvent(
        supabase,
        userId,
        Number(req.params.id),
        deal.stage,
        lostStage.id,
        deal.current_stage_entered_at || deal.stage_entered_at
      );
    } catch (e: any) {
      // recordStageEvent é "best effort" — não bloqueia o cancel
      console.warn('[cancel-sale] recordStageEvent falhou (não-bloqueante):', e?.message);
    }

    res.json({ success: true, moved_to: lostStage.id, job_deleted: !!deal.converted_job_id });
  });

  app.get('/api/extension/agenda', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const now = new Date();
    const year = Number(req.query.year) || now.getFullYear();
    const month = Number(req.query.month) || (now.getMonth() + 1);

    // Range do mês: [primeiro dia, primeiro dia do mês seguinte) — pega job_date
    // tanto como "YYYY-MM-DD" quanto "YYYY-MM-DDTHH:mm:ss" (timestamp).
    const start = `${year}-${String(month).padStart(2, '0')}-01`;
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;
    const end = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;

    const { data: jobs, error: jobsError } = await supabase
      .from('jobs')
      .select('id, job_name, job_type, job_date, job_time, job_end_time, status, client_id')
      .eq('user_id', userId)
      .gte('job_date', start)
      .lt('job_date', end)
      .order('job_date');
    if (jobsError) console.warn('[extension/agenda]', jobsError.message);

    const clientIds = Array.from(new Set((jobs || []).map(j => j.client_id).filter(Boolean) as number[]));
    let clientsMap = new Map<number, string>();
    if (clientIds.length) {
      const { data: clients } = await supabase
        .from('clients')
        .select('id, name')
        .in('id', clientIds);
      (clients || []).forEach(c => clientsMap.set(c.id, c.name));
    }

    const events = (jobs || []).map(j => ({
      id: `job-${j.id}`,
      kind: 'job',
      job_id: j.id, // id "cru" do job — facilita PUT/DELETE pela extensão
      date: String(j.job_date || '').slice(0, 10), // garante "YYYY-MM-DD" mesmo se vier timestamp
      time: j.job_time || null,
      end_time: j.job_end_time || null,
      title: j.job_name || j.job_type || 'Trabalho',
      type: j.job_type || null,
      status: j.status || null,
      client_id: j.client_id || null,
      client_name: j.client_id ? (clientsMap.get(j.client_id) || null) : null,
    }));

    res.json({ year, month, events, count: events.length });
  });

  app.get('/api/extension/deal-by-phone', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const adminClient = supabaseAdmin || supabase;
    const phone = String(req.query.phone || '').replace(/\D/g, '');
    if (!phone) return res.status(400).json({ error: 'phone é obrigatório' });

    const stages = await ensurePipelineStages(supabase, userId);

    // Gera variantes pra match flexível: com/sem DDI 55, com/sem nono dígito do celular Brasil.
    // Ex.: 554398387146 → também tenta 4398387146, 5543998387146, 43998387146
    const variants = new Set<string>([phone]);
    const tail = phone.startsWith('55') && phone.length >= 12 ? phone.slice(2) : phone;
    variants.add(tail);
    variants.add(`55${tail}`);
    // 10 dígitos = DDD + 8 (sem nono) — adiciona variante com nono
    if (tail.length === 10) {
      const withNine = `${tail.slice(0, 2)}9${tail.slice(2)}`;
      variants.add(withNine);
      variants.add(`55${withNine}`);
    }
    // 11 dígitos com nono — adiciona variante sem nono
    if (tail.length === 11 && tail[2] === '9') {
      const withoutNine = `${tail.slice(0, 2)}${tail.slice(3)}`;
      variants.add(withoutNine);
      variants.add(`55${withoutNine}`);
    }

    const { data: deal } = await supabase
      .from('deals')
      .select('*')
      .eq('user_id', userId)
      .in('contact_phone', Array.from(variants))
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!deal) return res.json({ deal: null, stages, pending_tasks: [] });

    const stage = stages.find((s) => s.id === deal.stage) || null;
    const { data: items } = await adminClient
      .from('deal_items')
      .select('*')
      .eq('deal_id', deal.id)
      .order('created_at');

    // Pega tarefas pendentes vinculadas ao cliente desse deal (pra mostrar
    // na faixa do chat quando o lead abrir uma conversa no WhatsApp).
    let pendingTasks: any[] = [];
    if (deal.client_id) {
      const { data: tks } = await supabase
        .from('tasks')
        .select('id, title, due_date, assignee_id, completed_at')
        .eq('user_id', userId)
        .eq('client_id', deal.client_id)
        .is('completed_at', null)
        .order('due_date', { ascending: true })
        .limit(5);
      pendingTasks = tks || [];
    }

    res.json({
      deal: { ...deal, items: items || [], stage_name: stage?.name || deal.stage },
      stages,
      pending_tasks: pendingTasks,
    });
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

  // ── Valor mínimo por tipo de ensaio ─────────────────────────────────────
  // O usuário define o valor mínimo de cada tipo (Gestante R$1150, Newborn
  // R$1550 etc) na tela de Configurações → Oportunidades. Usado como base
  // pro cálculo de potencial de venda quando as oportunidades não têm
  // estimated_value preenchido individualmente.
  app.get('/api/tipo-ensaio-precos', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { data, error } = await supabase
      .from('tipo_ensaio_precos')
      .select('*')
      .eq('user_id', userId)
      .order('tipo_nome');
    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
  });

  // Upsert em batch: recebe array [{tipo_nome, preco_minimo}, ...] e grava
  // tudo de uma vez. Mantém tipos não enviados (não apaga ausentes — pra
  // apagar, frontend manda preco_minimo: null que ignoramos).
  app.put('/api/tipo-ensaio-precos', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const items: any[] = Array.isArray(req.body?.items) ? req.body.items : [];
    if (items.length === 0) return res.json({ ok: true, count: 0 });

    const { data: existing } = await supabase
      .from('tipo_ensaio_precos')
      .select('id, tipo_nome')
      .eq('user_id', userId);
    const byLower = new Map<string, string>();
    (existing || []).forEach((r: any) => byLower.set(r.tipo_nome.toLowerCase().trim(), r.id));

    const toInsert: any[] = [];
    const toUpdate: { id: string; preco: number; nome: string }[] = [];
    for (const it of items) {
      const nome = String(it.tipo_nome || '').trim();
      const preco = Number(it.preco_minimo);
      if (!nome || !isFinite(preco) || preco < 0) continue;
      const existingId = byLower.get(nome.toLowerCase());
      if (existingId) toUpdate.push({ id: existingId, preco, nome });
      else toInsert.push({ user_id: userId, tipo_nome: nome, preco_minimo: preco });
    }

    if (toInsert.length) {
      const { error } = await supabase.from('tipo_ensaio_precos').insert(toInsert);
      if (error) return res.status(500).json({ error: error.message });
    }
    for (const u of toUpdate) {
      await supabase.from('tipo_ensaio_precos')
        .update({ preco_minimo: u.preco, tipo_nome: u.nome })
        .eq('id', u.id)
        .eq('user_id', userId);
    }
    res.json({ ok: true, inserted: toInsert.length, updated: toUpdate.length });
  });

  app.delete('/api/tipo-ensaio-precos/:id', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { error } = await supabase.from('tipo_ensaio_precos')
      .delete().eq('user_id', userId).eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  });

  // Totais por produto: agrega estimated_value das oportunidades agrupadas
  // por produto vinculado (produto_id) ou por type. Pra oportunidades SEM
  // valor preenchido, usa o "pacote mínimo" como estimativa. Ordem de fallback:
  //   1. tipo_ensaio_precos.preco_minimo (configurado pelo usuário por tipo)
  //   2. produtos.preco_venda (se a opp tem produto_id vinculado)
  //   3. menor preço do catálogo (combos/servicos/produtos) cujo nome dê match
  app.get('/api/oportunidades/totais-por-produto', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;

    // Tenta com produto_id; se a coluna não existir, refaz sem ela.
    let opsRows: any[] | null = null;
    let hasProductCol = true;
    {
      const r = await supabase.from('opportunities')
        .select('produto_id, estimated_value, status, type')
        .eq('user_id', userId);
      if (r.error) {
        hasProductCol = false;
        const r2 = await supabase.from('opportunities')
          .select('estimated_value, status, type')
          .eq('user_id', userId);
        if (r2.error) return res.status(500).json({ error: r2.error.message });
        opsRows = r2.data || [];
      } else {
        opsRows = r.data || [];
      }
    }

    // Carrega catálogo + tipo_ensaio_precos (valores configurados pelo user
    // por tipo de ensaio — fonte primária do "pacote mínimo").
    const [prodsRes, servsRes, combosRes, tipoPrecosRes] = await Promise.all([
      supabase.from('produtos').select('id, nome, preco_venda').eq('user_id', userId),
      supabase.from('servicos').select('nome, preco_base').eq('user_id', userId),
      supabase.from('combos').select('nome, preco_final').eq('user_id', userId),
      supabase.from('tipo_ensaio_precos').select('tipo_nome, preco_minimo').eq('user_id', userId)
        .then(r => r.error ? { data: [] } : r),
    ]);

    // Map case-insensitive: tipo_nome.lower() → preço mínimo
    const tipoMinPrice = new Map<string, number>();
    (tipoPrecosRes.data || []).forEach((t: any) => {
      const key = (t.tipo_nome || '').toString().trim().toLowerCase();
      const preco = Number(t.preco_minimo) || 0;
      if (key && preco > 0) tipoMinPrice.set(key, preco);
    });

    const prodMap = new Map<string, { nome: string; preco: number }>();
    (prodsRes.data || []).forEach((p: any) => {
      prodMap.set(p.id, { nome: p.nome, preco: Number(p.preco_venda) || 0 });
    });

    // minPriceByKeyword: pra cada primeira palavra do nome de qualquer item
    // do catálogo, guarda o menor preço encontrado. Usado como fallback
    // quando a oportunidade não tem estimated_value e o nome do type/produto
    // começa com essa palavra (ex: type "Newborn Premium" → match com combo
    // "Newborn Basic" pelo prefixo "newborn").
    const minPriceByKeyword = new Map<string, number>();
    const addToLookup = (nome: string, preco: number) => {
      if (!nome || !(preco > 0)) return;
      const key = nome.trim().toLowerCase().split(/\s+/)[0];
      if (!key) return;
      const cur = minPriceByKeyword.get(key);
      if (cur === undefined || preco < cur) minPriceByKeyword.set(key, preco);
    };
    (combosRes.data || []).forEach((c: any) => addToLookup(c.nome, Number(c.preco_final)));
    (servsRes.data || []).forEach((s: any) => addToLookup(s.nome, Number(s.preco_base)));
    (prodsRes.data || []).forEach((p: any) => addToLookup(p.nome, Number(p.preco_venda)));

    const lookupPrice = (name: string): number => {
      if (!name) return 0;
      const k = name.trim().toLowerCase().split(/\s+/)[0];
      return k ? (minPriceByKeyword.get(k) || 0) : 0;
    };

    const PENDING = new Set(['pendente', 'future', 'active', 'urgent', 'contatado', 'negociando']);
    const CONVERTED = new Set(['em_kanban', 'converted', 'convertido']);

    type Bucket = {
      produto_id: string | null;
      produto_nome: string;
      total_estimado: number;
      total_convertido: number;
      qtd_aberta: number;
      qtd_convertida: number;
      usando_estimativa: boolean;  // true se ao menos uma opp usou fallback
      preco_base: number | null;    // preço-base usado no fallback (pacote mínimo)
    };
    const buckets = new Map<string, Bucket>();

    for (const op of opsRows) {
      const tipo = (op.type || '').toString();
      const hasProd = hasProductCol && op.produto_id;
      const prodInfo = hasProd ? prodMap.get(op.produto_id) : null;
      const key = hasProd ? `p:${op.produto_id}` : `t:${tipo || '__sem_tipo__'}`;
      const nome = hasProd
        ? (prodInfo?.nome || tipo || 'Produto removido')
        : (tipo || 'Sem categoria');

      // Pacote mínimo pra esse bucket. Ordem de prioridade:
      //   1. tipo_ensaio_precos pelo type (configurado manualmente pelo user)
      //   2. preço do produto vinculado (se opp.produto_id existe)
      //   3. lookup no catálogo (combos/servicos/produtos) pela primeira palavra do nome
      const tipoKey = (tipo || '').toLowerCase().trim();
      const tipoConfigured = tipoMinPrice.get(tipoKey) || 0;
      const precoBase = tipoConfigured > 0
        ? tipoConfigured
        : (prodInfo?.preco && prodInfo.preco > 0)
          ? prodInfo.preco
          : lookupPrice(nome);

      const bucket = buckets.get(key) || {
        produto_id: hasProd ? op.produto_id : null,
        produto_nome: nome,
        total_estimado: 0,
        total_convertido: 0,
        qtd_aberta: 0,
        qtd_convertida: 0,
        usando_estimativa: false,
        preco_base: precoBase > 0 ? precoBase : null,
      };

      const valorReal = Number(op.estimated_value) || 0;
      const valor = valorReal > 0 ? valorReal : precoBase;
      if (valorReal <= 0 && precoBase > 0) bucket.usando_estimativa = true;

      if (PENDING.has(op.status)) {
        bucket.total_estimado += valor;
        bucket.qtd_aberta += 1;
      } else if (CONVERTED.has(op.status)) {
        bucket.total_convertido += valor;
        bucket.qtd_convertida += 1;
      }
      buckets.set(key, bucket);
    }

    const list = Array.from(buckets.values())
      .sort((a, b) => (b.total_estimado + b.total_convertido) - (a.total_estimado + a.total_convertido));
    res.json(list);
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
      .eq('is_active', true)
      .maybeSingle();

    if (!acc) return res.status(404).json({ error: 'Nenhuma conta conectada' });

    const debugToken = decryptIfNeeded(acc.access_token);
    if (!debugToken) return res.status(500).json({ error: 'Falha ao decifrar token' });

    // Não devolve o token plaintext na resposta — só metadata. O cliente
    // não precisa ver o token; debug é pra equipe interna.
    const result: any = { account_in_db: { ...acc, access_token: '<encrypted>' } };

    try {
      // 1. debug_token
      const debugRes = await fetch(
        `https://graph.facebook.com/v21.0/debug_token?input_token=${debugToken}&access_token=${META_APP_ID}|${META_APP_SECRET}`
      );
      result.debug_token = await debugRes.json();
    } catch (e: any) { result.debug_token_error = e.message; }

    try {
      // 2. phone number details
      const phoneRes = await fetch(
        `https://graph.facebook.com/v21.0/${acc.phone_number_id}?fields=id,display_phone_number,verified_name,quality_rating,platform_type&access_token=${debugToken}`
      );
      result.phone_number_details = await phoneRes.json();
    } catch (e: any) { result.phone_number_error = e.message; }

    try {
      // 3. Tenta enviar mensagem de teste
      const sendRes = await fetch(
        `https://graph.facebook.com/v21.0/${acc.phone_number_id}/messages`,
        {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${debugToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: '5543988416682',
            type: 'text',
            text: { body: 'Teste diagnóstico CRM Trilha' },
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
    const { access_token, code, mode, launcher_url, fb_sdk_redirect_uri, waba_id: bodyWabaId, phone_number_id: bodyPhoneId } = req.body;

    // Normaliza mode: só aceita 'cloud_api' e 'coexistence'; default cloud_api.
    // Em coexistence o número segue ativo no app WhatsApp Business e o
    // pareamento é via QR — então pulamos o POST /register no final do fluxo.
    const connectionMode: 'cloud_api' | 'coexistence' =
      mode === 'coexistence' ? 'coexistence' : 'cloud_api';
    console.log('[Meta] exchange-token mode:', connectionMode, '| launcher_url:', launcher_url);

    if (!access_token && !code) return res.status(400).json({ error: 'access_token ou code é obrigatório' });
    if (!META_APP_ID || !META_APP_SECRET) return res.status(500).json({ error: 'META_APP_ID/META_APP_SECRET não configurados' });

    // Allowlist de domínios que podem ser usados como redirect_uri no exchange.
    // Bloqueia token leak via origin atacante. Cobre prod (Vercel), backend
    // (Render) e o domínio customizado do app caso seja configurado via env.
    const ALLOWED_LAUNCHER_HOSTS = [
      'app-para-fotografos.vercel.app',
      'onrender.com',
      ...(process.env.APP_PUBLIC_URL
        ? [(() => { try { return new URL(process.env.APP_PUBLIC_URL!).host; } catch { return ''; } })()]
        : []),
    ].filter(Boolean);

    function isLauncherAllowed(url: string): boolean {
      try {
        const u = new URL(url);
        if (u.protocol !== 'https:') return false;
        return ALLOWED_LAUNCHER_HOSTS.some(h => u.host === h || u.host.endsWith('.' + h) || u.host.endsWith(h));
      } catch {
        return false;
      }
    }

    try {
      // 0. Embedded Signup v4 (popup mode): se veio `code` (e não access_token),
      //    troca por access_token via /oauth/access_token.
      //
      //    redirect_uri precisa ser EXATAMENTE a URL que originou o FB.login
      //    (window.location.origin + pathname canônico, sem query/hash/trailing
      //    slash) E estar cadastrada em "Valid OAuth Redirect URIs" do
      //    Facebook Login for Business. Esse é o padrão usado em produção por
      //    Sinch, Y-Cloud e Dualhook. Tentativas anteriores de mandar vazio ou
      //    staticxx.facebook.com falharam — staticxx é subdomínio INTERNO do
      //    JS SDK (iframe XD Arbiter pra postMessage cross-domain), nunca
      //    aceito como redirect_uri em produção.
      //
      //    IMPORTANTE: code da Meta é one-time-use. Qualquer tentativa que falhe
      //    invalida o code; retries em sequência viram cascata de "Error
      //    validating verification code". Por isso UMA única chamada — se
      //    falhar, propaga o erro literal da Meta pra o frontend.
      let token: string = access_token || '';
      if (!access_token && code) {
        if (!launcher_url || typeof launcher_url !== 'string') {
          return res.status(400).json({
            error: 'launcher_url é obrigatório no body — envie window.location.origin + pathname (a URL que originou o FB.login).',
          });
        }
        if (!isLauncherAllowed(launcher_url)) {
          console.warn('[Meta] launcher_url REJEITADO (origem não permitida):', launcher_url);
          return res.status(400).json({
            error: 'launcher_url não permitido. Domínio precisa estar na allowlist do backend.',
          });
        }

        // ACHADO EMPÍRICO (URL real do popup capturada em 2026-05-30): o FB
        // SDK em popup mode + response_type=code USA o xd_arbiter COM HASH
        // FRAGMENT ÚNICO POR CHAMADA como redirect_uri. Os IDs cb/origin/frame
        // são gerados frescos a cada FB.login — backend NÃO consegue prever.
        // Frontend captura a URL via monkey-patch em window.open e envia em
        // fb_sdk_redirect_uri. Sem isso → subcode 36008.
        //
        // Tentativas anteriores que falharam: window.location.origin (sem path),
        // origin+pathname, xd_arbiter sem hash, vazio, omitir.
        if (!fb_sdk_redirect_uri || typeof fb_sdk_redirect_uri !== 'string') {
          return res.status(400).json({
            error: 'fb_sdk_redirect_uri obrigatório. Frontend precisa capturar a URL via monkey-patch em window.open antes de FB.login (atualize o bundle).',
          });
        }
        // Segurança: só aceita URLs do xd_arbiter da Meta — bloqueia injeção
        // de URL atacante que poderia ser usada pra confundir o exchange.
        if (!fb_sdk_redirect_uri.startsWith('https://staticxx.facebook.com/x/connect/xd_arbiter/')) {
          console.warn('[Meta] fb_sdk_redirect_uri REJEITADO (não é xd_arbiter):', fb_sdk_redirect_uri);
          return res.status(400).json({
            error: 'fb_sdk_redirect_uri inválido — esperado xd_arbiter da Meta.',
          });
        }
        console.log('[Meta] fb_sdk_redirect_uri capturado:', fb_sdk_redirect_uri.slice(0, 80) + '...');

        const exchangeParams = new URLSearchParams({
          client_id: META_APP_ID,
          client_secret: META_APP_SECRET,
          code,
          redirect_uri: fb_sdk_redirect_uri,
        });

        // Versão alinhada com o FB.init do frontend (v21.0).
        const exchangeRes = await fetch(
          `https://graph.facebook.com/v21.0/oauth/access_token?${exchangeParams.toString()}`
        );
        const exchangeData = await exchangeRes.json();

        if (exchangeData.access_token) {
          token = exchangeData.access_token;
          console.log('[Meta] code trocado por access_token com sucesso. redirect_uri:', launcher_url);
        } else {
          // Log detalhado pra diferenciar redirect_uri mismatch (code 100) de
          // code já consumido (code 100 subcode 33) vs app_secret errado (code 1)
          // vs config_id de outro app (code 100 subcode diferente).
          const err = exchangeData.error || {};
          console.error('[Meta] exchange code→token falhou:', JSON.stringify({
            error_code: err.code,
            error_subcode: err.error_subcode,
            error_message: err.message,
            error_type: err.type,
            fbtrace_id: err.fbtrace_id,
            full_response: exchangeData,
          }));
          return res.status(400).json({
            error: `Falha ao trocar code por token: ${err.message || 'sem access_token na resposta'}`,
            meta_error_code: err.code,
            meta_error_subcode: err.error_subcode,
            fbtrace_id: err.fbtrace_id,
          });
        }
      }

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
      // Plan B (System User Token): debug_token de app-scoped token nem sempre
      // expõe granular_scopes — então aceita waba_id/phone_number_id vindos
      // do body como override explícito.
      const wabaId: string | null = wabaScope?.target_ids?.[0] || bodyWabaId || null;
      console.log('[Meta] WABA scope:', wabaScope, '| wabaId:', wabaId);

      // 3. Busca número de telefone do WABA
      let phoneNumberId: string | null = bodyPhoneId || null;
      let phoneNumber: string | null = null;
      let displayName: string | null = null;

      if (wabaId) {
        const phoneRes = await fetch(
          `https://graph.facebook.com/v21.0/${wabaId}/phone_numbers?access_token=${token}`
        );
        const phoneData = await phoneRes.json();
        if (phoneData.data?.length > 0) {
          // Se body passou phone_number_id específico, prioriza ele; senão
          // pega o primeiro retornado pela API.
          const phone = bodyPhoneId
            ? phoneData.data.find((p: any) => p.id === bodyPhoneId) || phoneData.data[0]
            : phoneData.data[0];
          phoneNumberId = phone.id;
          phoneNumber = phone.display_phone_number;
          displayName = phone.verified_name;
        }
      }

      // 4. Troca token curto por long-lived token (60 dias em vez de ~2h)
      let finalToken = token;
      try {
        const ltRes = await fetch(
          `https://graph.facebook.com/oauth/access_token?grant_type=fb_exchange_token` +
          `&client_id=${META_APP_ID}&client_secret=${META_APP_SECRET}&fb_exchange_token=${encodeURIComponent(token)}`
        );
        const ltData = await ltRes.json();
        if (ltData.access_token) {
          finalToken = ltData.access_token;
          console.log('[Meta] Token trocado por long-lived com sucesso');
        } else {
          console.warn('[Meta] Falha ao trocar token:', ltData.error?.message || JSON.stringify(ltData));
        }
      } catch (ltErr: any) {
        console.warn('[Meta] Falha ao trocar token (continua com token original):', ltErr.message);
      }

      // 5. Multi-WABA: desativa outras WABAs do mesmo user antes de salvar
      //    a nova como ativa. Cliente pode ter várias WABAs conectadas, mas
      //    só uma é a "ativa" — a que os endpoints usam por default.
      await supabase
        .from('whatsapp_business_accounts')
        .update({ is_active: false })
        .eq('user_id', userId);

      // 6. Encripta o token antes de salvar (em repouso). Helper retorna
      //    plaintext se WA_TOKEN_ENCRYPTION_KEY não tá configurada — fluxo
      //    continua funcionando, só sem proteção. Linhas antigas em plaintext
      //    são lidas via decryptIfNeeded sem migration de dados.
      const encryptedToken = encryptIfNeeded(finalToken);
      const isEncrypted = !!encryptedToken && encryptedToken !== finalToken;

      // 7. Long-lived token dura ~60 dias. Marca a data esperada de expiração
      //    pra frontend mostrar aviso antes e pro endpoint de refresh saber
      //    quando rodar.
      const expiresAt = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();

      const { error } = await supabase
        .from('whatsapp_business_accounts')
        .upsert(
          {
            user_id: userId,
            waba_id: wabaId,
            phone_number_id: phoneNumberId,
            phone_number: phoneNumber,
            display_name: displayName,
            access_token: encryptedToken,
            token_encrypted: isEncrypted,
            token_expires_at: expiresAt,
            is_active: true,
            connected_at: new Date().toISOString(),
            mode: connectionMode,
          },
          { onConflict: 'user_id,waba_id' }
        );

      if (error) return res.status(500).json({ error: error.message });

      // 8. Assina webhook no nível da WABA (necessário para receber eventos)
      if (wabaId && finalToken) {
        try {
          const subRes = await fetch(
            `https://graph.facebook.com/v21.0/${wabaId}/subscribed_apps`,
            { method: 'POST', headers: { Authorization: `Bearer ${finalToken}` } }
          );
          const subData = await subRes.json();
          console.log('[Meta] WABA subscribed_apps:', JSON.stringify(subData));
        } catch (subErr) {
          console.error('[Meta] Falha ao assinar WABA webhook:', subErr);
          // Não bloqueia — a conexão foi salva, usuário pode tentar manualmente
        }
      }

      // 9. Registra o phone number na Cloud API. Sem isso, POST /messages
      //    falha com "Phone number not registered". O PIN '000000' é o default
      //    pra números que NÃO têm 2FA configurado — se o cliente já usa o
      //    número fora da Cloud API com 2FA, vai falhar e ele precisa
      //    desativar a verificação em duas etapas no WhatsApp Business app
      //    antes de conectar.
      //    Em modo coexistence o número continua ativo no app WhatsApp Business
      //    e a Meta proíbe registrá-lo na Cloud API — então pulamos esse passo.
      if (connectionMode === 'coexistence') {
        console.log('[Meta] mode=coexistence — pulando POST /register (número segue no app WA Business)');
      } else if (phoneNumberId && finalToken) {
        try {
          const regRes = await fetch(
            `https://graph.facebook.com/v21.0/${phoneNumberId}/register`,
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${finalToken}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ messaging_product: 'whatsapp', pin: '000000' }),
            }
          );
          const regData = await regRes.json();
          if (regData.error) {
            console.warn('[Meta] phone register falhou:', JSON.stringify(regData.error));
            // Não bloqueia — conexão salva. Cliente pode precisar desativar 2FA
            // no número e tentar reconectar.
          } else {
            console.log('[Meta] phone registered:', JSON.stringify(regData));
          }
        } catch (regErr) {
          console.error('[Meta] phone register exception:', regErr);
        }
      }

      res.json({ success: true, waba_id: wabaId, phone_number: phoneNumber, display_name: displayName, mode: connectionMode });
    } catch (err: any) {
      console.error('[Meta] exchange-token error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // Lista TODAS as WABAs e números autorizados no token salvo. Usa o
  // debug_token pra descobrir as WABAs (granular_scopes) e o Graph API
  // pra listar os phone_numbers de cada uma. Resolve o caso comum onde
  // o Embedded Signup expõe múltiplos números (Test Number + reais)
  // e a gente só pegou o primeiro no exchange-token.
  app.get('/api/meta/whatsapp/available-numbers', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;

    if (!META_APP_ID || !META_APP_SECRET) {
      return res.status(500).json({ error: 'META_APP_ID/META_APP_SECRET não configurados' });
    }

    const { data: acc } = await supabase
      .from('whatsapp_business_accounts')
      .select('waba_id, phone_number_id, access_token')
      .eq('user_id', userId)
      .eq('is_active', true)
      .maybeSingle();
    if (!acc?.access_token) return res.status(400).json({ error: 'Nenhuma conta conectada' });

    const token = decryptIfNeeded(acc.access_token);
    if (!token) return res.status(500).json({ error: 'Falha ao decifrar token' });

    try {
      // 1. debug_token pra extrair todas as WABAs autorizadas
      const appToken = encodeURIComponent(`${META_APP_ID}|${META_APP_SECRET}`);
      const debugRes = await fetch(
        `https://graph.facebook.com/v21.0/debug_token?input_token=${encodeURIComponent(token)}&access_token=${appToken}`
      );
      const debugData = await debugRes.json();
      if (debugData.error) {
        return res.status(400).json({ error: `debug_token: ${debugData.error.message}` });
      }

      const scopes = debugData.data?.granular_scopes || [];
      const wabaScope = scopes.find((s: any) => s.scope === 'whatsapp_business_management');
      const wabaIds: string[] = wabaScope?.target_ids || [];

      // Garantir que a WABA já salva também aparece (mesmo que não esteja
      // mais nas granular_scopes por alguma esquisitice)
      if (acc.waba_id && !wabaIds.includes(acc.waba_id)) wabaIds.unshift(acc.waba_id);

      // 2. Pra cada WABA, busca phone_numbers + dados básicos da WABA
      const wabas: any[] = [];
      for (const wid of wabaIds) {
        try {
          const [wabaInfoRes, numbersRes] = await Promise.all([
            fetch(`https://graph.facebook.com/v21.0/${wid}?fields=id,name&access_token=${encodeURIComponent(token)}`),
            fetch(`https://graph.facebook.com/v21.0/${wid}/phone_numbers?access_token=${encodeURIComponent(token)}`),
          ]);
          const wabaInfo = await wabaInfoRes.json();
          const numbersData = await numbersRes.json();
          wabas.push({
            waba_id: wid,
            waba_name: wabaInfo.name || null,
            numbers: Array.isArray(numbersData.data)
              ? numbersData.data.map((p: any) => ({
                  phone_number_id: p.id,
                  display_phone_number: p.display_phone_number,
                  verified_name: p.verified_name,
                  quality_rating: p.quality_rating,
                  code_verification_status: p.code_verification_status,
                  // marca qual está ativo no momento pra UI destacar
                  is_active: p.id === acc.phone_number_id,
                }))
              : [],
          });
        } catch (err: any) {
          console.error(`[Meta] falha listando WABA ${wid}:`, err.message);
          wabas.push({ waba_id: wid, waba_name: null, numbers: [], error: err.message });
        }
      }

      res.json({ wabas, current: { waba_id: acc.waba_id, phone_number_id: acc.phone_number_id } });
    } catch (err: any) {
      console.error('[Meta] available-numbers error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // Troca o número ativo da conta WhatsApp do user. Recebe (waba_id,
  // phone_number_id) — busca os dados via Graph API, atualiza/cria o registro
  // ativo no DB, registra o phone na Cloud API e subscribe webhook.
  // O token long-lived atual cobre todas as WABAs autorizadas no Embedded Signup,
  // então não precisa reconectar.
  app.post('/api/meta/whatsapp/select-number', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { waba_id: newWabaId, phone_number_id: newPhoneId } = req.body || {};

    if (!newWabaId || !newPhoneId) {
      return res.status(400).json({ error: 'waba_id e phone_number_id são obrigatórios' });
    }

    // Pega o token atual (qualquer linha ativa do user serve — todas
    // compartilham o mesmo long-lived token vindo do Embedded Signup)
    const { data: existing } = await supabase
      .from('whatsapp_business_accounts')
      .select('access_token, token_expires_at')
      .eq('user_id', userId)
      .eq('is_active', true)
      .maybeSingle();
    if (!existing?.access_token) return res.status(400).json({ error: 'Nenhuma conta conectada' });

    const token = decryptIfNeeded(existing.access_token);
    if (!token) return res.status(500).json({ error: 'Falha ao decifrar token' });

    try {
      // 1. Confirma o número existe e pega os dados (display_phone_number, verified_name)
      const phoneRes = await fetch(
        `https://graph.facebook.com/v21.0/${newPhoneId}?fields=id,display_phone_number,verified_name&access_token=${encodeURIComponent(token)}`
      );
      const phoneData = await phoneRes.json();
      if (phoneData.error) {
        return res.status(400).json({ error: `Número não acessível: ${phoneData.error.message}` });
      }

      // 2. Desativa todas as WABAs ativas atuais do user
      await supabase
        .from('whatsapp_business_accounts')
        .update({ is_active: false })
        .eq('user_id', userId);

      // 3. Reusa o token cifrado original — não precisa re-encriptar
      // (encryptIfNeeded é idempotente; passa direto)
      const { error } = await supabase
        .from('whatsapp_business_accounts')
        .upsert(
          {
            user_id: userId,
            waba_id: newWabaId,
            phone_number_id: newPhoneId,
            phone_number: phoneData.display_phone_number || null,
            display_name: phoneData.verified_name || null,
            access_token: existing.access_token,
            token_encrypted: existing.access_token?.startsWith('enc:v1:'),
            token_expires_at: existing.token_expires_at,
            is_active: true,
            connected_at: new Date().toISOString(),
          },
          { onConflict: 'user_id,waba_id' }
        );
      if (error) return res.status(500).json({ error: error.message });

      // 4. Garante que o webhook está subscrito na nova WABA
      try {
        await fetch(
          `https://graph.facebook.com/v21.0/${newWabaId}/subscribed_apps`,
          { method: 'POST', headers: { Authorization: `Bearer ${token}` } }
        );
      } catch (subErr) {
        console.error('[Meta] subscribed_apps falhou (não bloqueia):', subErr);
      }

      // 5. Registra o phone number novo (PIN 000000 — só funciona sem 2FA)
      try {
        const regRes = await fetch(
          `https://graph.facebook.com/v21.0/${newPhoneId}/register`,
          {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ messaging_product: 'whatsapp', pin: '000000' }),
          }
        );
        const regData = await regRes.json();
        if (regData.error) console.warn('[Meta] register falhou:', regData.error.message);
      } catch (regErr) {
        console.error('[Meta] register exception:', regErr);
      }

      res.json({
        success: true,
        waba_id: newWabaId,
        phone_number: phoneData.display_phone_number,
        display_name: phoneData.verified_name,
      });
    } catch (err: any) {
      console.error('[Meta] select-number error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // Tenta renovar o long-lived token sem reabrir o Embedded Signup. Funciona
  // enquanto o token atual ainda é válido (idealmente rodar quando faltam
  // 14d pra expirar). Depois de expirado, só re-autorização do user resolve.
  // Frontend pode chamar este endpoint quando detectar token_expires_at próximo.
  app.post('/api/meta/whatsapp/refresh-token', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;

    if (!META_APP_ID || !META_APP_SECRET) {
      return res.status(500).json({ error: 'META_APP_ID/META_APP_SECRET não configurados' });
    }

    const { data: acc } = await supabase
      .from('whatsapp_business_accounts')
      .select('id, access_token')
      .eq('user_id', userId)
      .eq('is_active', true)
      .maybeSingle();
    if (!acc?.access_token) return res.status(400).json({ error: 'Conta não conectada' });

    const currentToken = decryptIfNeeded(acc.access_token);
    if (!currentToken) return res.status(500).json({ error: 'Falha ao decifrar token' });

    try {
      const ltRes = await fetch(
        `https://graph.facebook.com/oauth/access_token?grant_type=fb_exchange_token` +
        `&client_id=${META_APP_ID}&client_secret=${META_APP_SECRET}&fb_exchange_token=${encodeURIComponent(currentToken)}`
      );
      const ltData = await ltRes.json();
      if (!ltData.access_token) {
        return res.status(400).json({
          error: 'Token não pôde ser renovado. Cliente precisa reconectar.',
          meta_error: ltData.error?.message,
        });
      }

      const newEncrypted = encryptIfNeeded(ltData.access_token);
      const isEncrypted = !!newEncrypted && newEncrypted !== ltData.access_token;
      const newExpiresAt = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();

      const { error: upErr } = await supabase
        .from('whatsapp_business_accounts')
        .update({
          access_token: newEncrypted,
          token_encrypted: isEncrypted,
          token_expires_at: newExpiresAt,
        })
        .eq('id', acc.id);
      if (upErr) return res.status(500).json({ error: upErr.message });

      res.json({ success: true, token_expires_at: newExpiresAt });
    } catch (err: any) {
      console.error('[Meta] refresh-token error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // Diagnóstico — roda 9 checks de saúde da conta WhatsApp Cloud sem
  // chamar /messages nem nada que cobre. Só leitura.
  app.post('/api/meta/whatsapp/diagnose', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;

    type Check = { id: string; label: string; ok: boolean; detail: string; fix_hint?: string };
    const META_PANEL_REMINDER =
      "Verifique no painel Meta (App > Webhooks > WhatsApp Business Account) se 'messages' está marcado nos campos do webhook. Sem isso, mesmo com app subscrito, nenhuma mensagem chega.";

    const { data: acc, error: accErr } = await supabase
      .from('whatsapp_business_accounts')
      .select('id, waba_id, phone_number_id, phone_number, display_name, access_token, is_active, token_expires_at, mode')
      .eq('user_id', userId)
      .order('connected_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (accErr || !acc) {
      return res.status(400).json({
        error: 'Nenhuma conta WhatsApp encontrada para este usuário',
        meta_panel_reminder: META_PANEL_REMINDER,
      });
    }

    const account = {
      waba_id: acc.waba_id,
      phone_number_id: acc.phone_number_id,
      phone_number: acc.phone_number,
      display_name: acc.display_name,
    };

    // Token pode estar cifrado ou plaintext
    let decryptedToken: string | null = null;
    let decryptError: string | null = null;
    try {
      decryptedToken = decryptIfNeeded(acc.access_token);
      if (!decryptedToken) decryptError = 'decryptIfNeeded retornou vazio';
    } catch (e: any) {
      decryptError = e?.message || 'Erro desconhecido ao decifrar';
    }

    // Se não conseguimos decifrar, devolvemos só os checks que não dependem do token
    if (!decryptedToken) {
      const checks: Check[] = [
        {
          id: 'env_app_secret',
          label: 'META_APP_SECRET configurado',
          ok: !!process.env.META_APP_SECRET,
          detail: process.env.META_APP_SECRET
            ? 'Secret presente nas envs do servidor'
            : 'META_APP_SECRET ausente — webhook HMAC rejeita TODOS os payloads do Meta com 403',
          fix_hint: process.env.META_APP_SECRET
            ? undefined
            : 'Copie o App Secret de Meta App > Configurações > Básico e adicione como env var META_APP_SECRET (sem aspas, sem espaços). Reinicie o servidor.',
        },
        {
          id: 'env_encryption_key',
          label: 'WA_TOKEN_ENCRYPTION_KEY configurado',
          ok: !!process.env.WA_TOKEN_ENCRYPTION_KEY,
          detail: process.env.WA_TOKEN_ENCRYPTION_KEY
            ? 'Chave de criptografia presente'
            : 'WA_TOKEN_ENCRYPTION_KEY ausente — tokens estão salvos em plaintext no banco (aviso de segurança, não bloqueia funcionamento)',
          fix_hint: process.env.WA_TOKEN_ENCRYPTION_KEY
            ? undefined
            : 'Gere uma chave aleatória de 32 bytes em base64 e adicione como WA_TOKEN_ENCRYPTION_KEY. Tokens novos serão cifrados; antigos continuam funcionando.',
        },
        {
          id: 'token_decrypt',
          label: 'Token pode ser decifrado',
          ok: false,
          detail: `Falha ao decifrar o token salvo: ${decryptError}. Provavelmente a env WA_TOKEN_ENCRYPTION_KEY foi alterada ou removida depois que o token foi salvo.`,
          fix_hint: 'Restaure a WA_TOKEN_ENCRYPTION_KEY original OU peça o cliente reconectar via Embedded Signup para gerar um token novo com a chave atual.',
        },
        {
          id: 'db_row_is_active',
          label: 'Linha do banco está ativa',
          ok: acc.is_active === true,
          detail: acc.is_active
            ? 'Row marcada como is_active=true — webhook lookup vai encontrar'
            : 'Row está com is_active=false — webhook descarta mensagens silenciosamente (log diz "Nenhuma conta ativa")',
          fix_hint: acc.is_active
            ? undefined
            : 'Faça o cliente refazer o select-number para reativar a row, OU rode UPDATE manual no banco setando is_active=true.',
        },
        (() => {
          const mode = (acc as any).mode || 'cloud_api';
          return {
            id: 'mode_active',
            label: 'Modo de conexão',
            ok: true,
            detail: `Modo ativo: ${mode} (${mode === 'coexistence' ? 'WhatsApp Business app continua no celular' : 'número exclusivo Cloud API'})`,
          };
        })(),
      ];

      return res.json({ account, checks, meta_panel_reminder: META_PANEL_REMINDER });
    }

    const token = decryptedToken;
    const authHeader = { Authorization: `Bearer ${token}` };
    const GRAPH = 'https://graph.facebook.com/v21.0';

    // Helpers que SEMPRE resolvem (capturam erros internamente)
    const safeFetch = async (url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data: any; networkError?: string }> => {
      try {
        const r = await fetch(url, init);
        let data: any = null;
        try {
          data = await r.json();
        } catch {
          data = null;
        }
        return { ok: r.ok, status: r.status, data };
      } catch (e: any) {
        return { ok: false, status: 0, data: null, networkError: e?.message || 'Erro de rede' };
      }
    };

    // ── 0. mode_active (informativo) ───────────────────────────────────────
    const accMode: string = (acc as any).mode || 'cloud_api';
    const checkModeActive = async (): Promise<Check> => {
      return {
        id: 'mode_active',
        label: 'Modo de conexão',
        ok: true,
        detail: `Modo ativo: ${accMode} (${accMode === 'coexistence' ? 'WhatsApp Business app continua no celular' : 'número exclusivo Cloud API'})`,
      };
    };

    // ── 1. env_app_secret ──────────────────────────────────────────────────
    const checkEnvAppSecret = async (): Promise<Check> => {
      const has = !!process.env.META_APP_SECRET && process.env.META_APP_SECRET.trim().length > 0;
      return {
        id: 'env_app_secret',
        label: 'META_APP_SECRET configurado',
        ok: has,
        detail: has
          ? `Secret presente (${process.env.META_APP_SECRET!.trim().length} chars)`
          : 'META_APP_SECRET ausente ou vazio — webhook HMAC rejeita TODOS os payloads do Meta com 403',
        fix_hint: has
          ? undefined
          : 'Copie o App Secret de Meta App > Configurações > Básico e adicione como env var META_APP_SECRET (sem aspas, sem espaços, sem newline). Reinicie o servidor.',
      };
    };

    // ── 2. env_encryption_key ──────────────────────────────────────────────
    const checkEnvEncryptionKey = async (): Promise<Check> => {
      const has = !!process.env.WA_TOKEN_ENCRYPTION_KEY;
      return {
        id: 'env_encryption_key',
        label: 'WA_TOKEN_ENCRYPTION_KEY configurado',
        ok: has,
        detail: has
          ? 'Chave de criptografia presente — tokens são cifrados em repouso'
          : 'WA_TOKEN_ENCRYPTION_KEY ausente — tokens estão em plaintext no banco (aviso de segurança, não bloqueia funcionamento)',
        fix_hint: has
          ? undefined
          : 'Gere uma chave aleatória de 32 bytes em base64 e adicione como WA_TOKEN_ENCRYPTION_KEY. Tokens novos serão cifrados automaticamente.',
      };
    };

    // ── 3. token_valid (debug_token) ───────────────────────────────────────
    let debugTokenData: any = null;
    const checkTokenValid = async (): Promise<Check> => {
      if (!process.env.META_APP_SECRET) {
        return {
          id: 'token_valid',
          label: 'Token válido (debug_token)',
          ok: false,
          detail: 'Não foi possível verificar — META_APP_SECRET ausente, debug_token precisa de app_token',
          fix_hint: 'Configure META_APP_SECRET primeiro.',
        };
      }
      const appToken = `${META_APP_ID}|${META_APP_SECRET}`;
      const r = await safeFetch(
        `${GRAPH}/debug_token?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(appToken)}`
      );
      if (!r.ok || !r.data?.data) {
        return {
          id: 'token_valid',
          label: 'Token válido (debug_token)',
          ok: false,
          detail: r.networkError
            ? `Erro de rede: ${r.networkError}`
            : `Meta retornou status ${r.status}: ${JSON.stringify(r.data?.error || r.data || {})}`,
          fix_hint: 'Verifique se o token long-lived ainda é válido. Se expirou (60d), peça o cliente reconectar via Embedded Signup.',
        };
      }
      debugTokenData = r.data.data;
      const isValid = debugTokenData.is_valid === true;
      const expiresAt = debugTokenData.expires_at;
      const expiresIso = expiresAt && expiresAt > 0 ? new Date(expiresAt * 1000).toISOString() : 'sem expiração (system user)';
      const expired = expiresAt > 0 && expiresAt * 1000 < Date.now();
      return {
        id: 'token_valid',
        label: 'Token válido (debug_token)',
        ok: isValid && !expired,
        detail: isValid
          ? expired
            ? `Token EXPIROU em ${expiresIso}`
            : `Token válido. Expira em: ${expiresIso}. Type: ${debugTokenData.type || 'desconhecido'}, App ID: ${debugTokenData.app_id}`
          : `Token inválido. Meta diz: ${JSON.stringify(debugTokenData.error || {})}`,
        fix_hint: !isValid || expired
          ? 'Chame POST /api/meta/whatsapp/refresh-token para renovar (se ainda válido), ou peça o cliente reconectar via Embedded Signup.'
          : undefined,
      };
    };

    // ── 4. token_scopes ────────────────────────────────────────────────────
    const checkTokenScopes = async (): Promise<Check> => {
      if (!debugTokenData) {
        return {
          id: 'token_scopes',
          label: 'Escopos do token (granular_scopes)',
          ok: false,
          detail: 'debug_token não retornou dados — não dá pra verificar escopos',
          fix_hint: 'Resolva o check token_valid primeiro.',
        };
      }
      const granular = debugTokenData.granular_scopes;
      if (!Array.isArray(granular)) {
        return {
          id: 'token_scopes',
          label: 'Escopos do token (granular_scopes)',
          ok: false,
          detail: 'Token não tem granular_scopes (campo ausente). Pode ser token de system user ou versão antiga do auth flow.',
          fix_hint: 'Reconecte via Embedded Signup atual para gerar token com granular_scopes.',
        };
      }
      const scopeNames = granular.map((g: any) => g.scope);
      const hasMessaging = scopeNames.includes('whatsapp_business_messaging');
      const hasManagement = scopeNames.includes('whatsapp_business_management');
      const ok = hasMessaging && hasManagement;
      const missing: string[] = [];
      if (!hasMessaging) missing.push('whatsapp_business_messaging');
      if (!hasManagement) missing.push('whatsapp_business_management');
      // Verifica também se a waba_id atual está nos target_ids do scope management
      let wabaInScope = true;
      let wabaInScopeDetail = '';
      if (hasManagement && acc.waba_id) {
        const mgmtScope = granular.find((g: any) => g.scope === 'whatsapp_business_management');
        const targets: string[] = mgmtScope?.target_ids || [];
        if (targets.length > 0) {
          wabaInScope = targets.includes(acc.waba_id);
          if (!wabaInScope) {
            wabaInScopeDetail = ` ATENÇÃO: waba_id ${acc.waba_id} NÃO está nos target_ids do scope whatsapp_business_management (autorizadas: ${targets.join(', ')}). Webhook subscribe vai falhar.`;
          }
        }
      }
      return {
        id: 'token_scopes',
        label: 'Escopos do token (granular_scopes)',
        ok: ok && wabaInScope,
        detail: ok
          ? `Scopes presentes: ${scopeNames.join(', ')}.${wabaInScopeDetail}`
          : `Faltam scopes: ${missing.join(', ')}. Scopes atuais: ${scopeNames.join(', ') || '(nenhum)'}.${wabaInScopeDetail}`,
        fix_hint: !ok
          ? 'Refaça o Embedded Signup pedindo whatsapp_business_messaging E whatsapp_business_management.'
          : !wabaInScope
            ? 'Esta WABA não está autorizada pelo token atual. Refaça o Embedded Signup selecionando esta WABA, ou troque pra uma WABA autorizada via select-number.'
            : undefined,
      };
    };

    // ── 5. waba_accessible ─────────────────────────────────────────────────
    const checkWabaAccessible = async (): Promise<Check> => {
      if (!acc.waba_id) {
        return {
          id: 'waba_accessible',
          label: 'WABA acessível',
          ok: false,
          detail: 'waba_id ausente no banco',
          fix_hint: 'Reconecte via Embedded Signup.',
        };
      }
      const r = await safeFetch(`${GRAPH}/${acc.waba_id}`, { headers: authHeader });
      return {
        id: 'waba_accessible',
        label: 'WABA acessível',
        ok: r.ok,
        detail: r.ok
          ? `GET /${acc.waba_id} retornou 200. Name: ${r.data?.name || 'sem nome'}, Currency: ${r.data?.currency || 'N/A'}`
          : r.networkError
            ? `Erro de rede: ${r.networkError}`
            : `Meta retornou status ${r.status}: ${JSON.stringify(r.data?.error || r.data || {})}`,
        fix_hint: !r.ok
          ? 'Token pode não ter permissão pra esta WABA. Verifique granular_scopes e reconecte se necessário.'
          : undefined,
      };
    };

    // ── 6/7. phone_accessible + phone_registered ───────────────────────────
    let phoneData: any = null;
    let phoneFetchOk = false;
    let phoneFetchDetail = '';
    const checkPhoneAccessible = async (): Promise<Check> => {
      if (!acc.phone_number_id) {
        return {
          id: 'phone_accessible',
          label: 'Número de telefone acessível',
          ok: false,
          detail: 'phone_number_id ausente no banco',
          fix_hint: 'Reconecte via Embedded Signup ou rode select-number.',
        };
      }
      const fields = 'id,display_phone_number,verified_name,code_verification_status,quality_rating,platform_type';
      const r = await safeFetch(`${GRAPH}/${acc.phone_number_id}?fields=${fields}`, { headers: authHeader });
      phoneFetchOk = r.ok;
      if (r.ok) {
        phoneData = r.data;
        phoneFetchDetail = `display_phone_number: ${r.data?.display_phone_number}, verified_name: ${r.data?.verified_name}, code_verification_status: ${r.data?.code_verification_status}, quality_rating: ${r.data?.quality_rating}, platform_type: ${r.data?.platform_type}`;
      } else {
        phoneFetchDetail = r.networkError
          ? `Erro de rede: ${r.networkError}`
          : `Meta retornou status ${r.status}: ${JSON.stringify(r.data?.error || r.data || {})}`;
      }
      return {
        id: 'phone_accessible',
        label: 'Número de telefone acessível',
        ok: r.ok,
        detail: phoneFetchDetail,
        fix_hint: !r.ok
          ? 'Verifique se o phone_number_id ainda pertence ao token. Pode ter sido migrado pra outra WABA — rode select-number pra atualizar.'
          : undefined,
      };
    };

    const checkPhoneRegistered = async (): Promise<Check> => {
      if (!phoneFetchOk || !phoneData) {
        return {
          id: 'phone_registered',
          label: 'Número registrado na Cloud API (VERIFIED)',
          ok: false,
          detail: 'Não foi possível verificar — phone_accessible falhou',
          fix_hint: 'Resolva phone_accessible primeiro.',
        };
      }
      const status = phoneData.code_verification_status;
      // Em Coexistence Mode, o número não passa pelo /register da Cloud API — ele continua
      // ativo no WhatsApp Business app. Então esse check vira informativo (ok=true).
      if (accMode === 'coexistence') {
        return {
          id: 'phone_registered',
          label: 'Número registrado na Cloud API (VERIFIED)',
          ok: true,
          detail: `N/A em Coexistence Mode (número não passa por register Cloud API). code_verification_status atual: ${status || 'desconhecido'}.`,
        };
      }
      const ok = status === 'VERIFIED';
      return {
        id: 'phone_registered',
        label: 'Número registrado na Cloud API (VERIFIED)',
        ok,
        detail: ok
          ? `code_verification_status = VERIFIED — pronto pra enviar/receber`
          : `code_verification_status = ${status || 'desconhecido'}. Número não está VERIFIED — Cloud API não vai entregar mensagens.`,
        fix_hint: !ok
          ? 'Chame POST /{phone_number_id}/register com PIN correto. Se cliente tem 2FA na WABA, PIN "000000" hardcoded vai falhar — use o PIN real configurado no painel Meta.'
          : undefined,
      };
    };

    // ── 8. app_subscribed_on_waba ──────────────────────────────────────────
    const checkAppSubscribedOnWaba = async (): Promise<Check> => {
      if (!acc.waba_id) {
        return {
          id: 'app_subscribed_on_waba',
          label: 'App subscrito na WABA',
          ok: false,
          detail: 'waba_id ausente no banco',
        };
      }
      if (!META_APP_ID) {
        return {
          id: 'app_subscribed_on_waba',
          label: 'App subscrito na WABA',
          ok: false,
          detail: 'META_APP_ID não configurado no servidor — não dá pra comparar',
          fix_hint: 'Configure env META_APP_ID com o ID do seu app Meta.',
        };
      }
      const r = await safeFetch(`${GRAPH}/${acc.waba_id}/subscribed_apps`, { headers: authHeader });
      if (!r.ok) {
        return {
          id: 'app_subscribed_on_waba',
          label: 'App subscrito na WABA',
          ok: false,
          detail: r.networkError
            ? `Erro de rede: ${r.networkError}`
            : `Meta retornou status ${r.status}: ${JSON.stringify(r.data?.error || r.data || {})}`,
          fix_hint: 'Token pode não ter permissão whatsapp_business_management nesta WABA. Reconecte.',
        };
      }
      const apps = Array.isArray(r.data?.data) ? r.data.data : [];
      const found = apps.find((a: any) => {
        // Meta retorna whatsapp_business_api_data.id ou diretamente o id em algumas versões
        const id = a?.whatsapp_business_api_data?.id || a?.id;
        return String(id) === String(META_APP_ID);
      });
      const ok = !!found;
      const subscribedFields = found?.subscribed_fields || found?.whatsapp_business_api_data?.subscribed_fields || [];
      const hasMessagesField = Array.isArray(subscribedFields) && subscribedFields.includes('messages');
      return {
        id: 'app_subscribed_on_waba',
        label: 'App subscrito na WABA',
        ok: ok && (subscribedFields.length === 0 || hasMessagesField),
        detail: ok
          ? subscribedFields.length === 0
            ? `App ${META_APP_ID} está subscrito (subscribed_fields não retornado pela Graph — verifique manualmente no painel)`
            : hasMessagesField
              ? `App ${META_APP_ID} subscrito com fields: ${subscribedFields.join(', ')}`
              : `App ${META_APP_ID} subscrito MAS sem field "messages" (fields atuais: ${subscribedFields.join(', ')}) — mensagens não chegam`
          : `App ${META_APP_ID} NÃO está na lista de subscribed_apps desta WABA. Apps subscritos: ${apps.map((a: any) => a?.whatsapp_business_api_data?.id || a?.id).join(', ') || '(nenhum)'}. Webhook nunca dispara.`,
        fix_hint: !ok
          ? 'Chame POST /api/meta/whatsapp/subscribe-webhook para subscrever o app. Se falhar, verifique granular_scopes (whatsapp_business_management).'
          : !hasMessagesField && subscribedFields.length > 0
            ? 'Vá em Meta App > Webhooks > WhatsApp Business Account e marque o field "messages".'
            : undefined,
      };
    };

    // ── 9. db_row_is_active ────────────────────────────────────────────────
    const checkDbRowIsActive = async (): Promise<Check> => {
      // Conta quantas rows ativas existem pra este phone_number_id (detecta race)
      const { data: activeRows } = await supabase
        .from('whatsapp_business_accounts')
        .select('id, user_id, waba_id, is_active')
        .eq('phone_number_id', acc.phone_number_id)
        .eq('is_active', true);
      const count = activeRows?.length || 0;
      const userRowActive = acc.is_active === true;
      const ok = userRowActive && count === 1;
      let detail = '';
      let fixHint: string | undefined;
      if (!userRowActive) {
        detail = `Row do user está com is_active=false — webhook descarta mensagens silenciosamente (log diz "Nenhuma conta ativa para phone_number_id")`;
        fixHint = 'Faça o cliente refazer select-number, OU rode UPDATE manual: UPDATE whatsapp_business_accounts SET is_active=true WHERE id=...';
      } else if (count === 0) {
        detail = `Inconsistência: row deveria estar ativa mas query retornou 0 ativas pro phone_number_id`;
        fixHint = 'Provavelmente race condition. Rode UPDATE manual.';
      } else if (count > 1) {
        detail = `${count} rows com is_active=true pro mesmo phone_number_id ${acc.phone_number_id} — webhook lookup com .maybeSingle() retorna erro PGRST116 'multiple rows' e descarta mensagem`;
        fixHint = 'Desative manualmente as rows duplicadas: UPDATE whatsapp_business_accounts SET is_active=false WHERE phone_number_id=X AND id != (id mais recente).';
      } else {
        detail = `Row do user (id=${acc.id}, waba_id=${acc.waba_id}) está ativa e única pro phone_number_id`;
      }
      return {
        id: 'db_row_is_active',
        label: 'Linha do banco está ativa e única',
        ok,
        detail,
        fix_hint: fixHint,
      };
    };

    // Roda em paralelo, mas alguns dependem de outros — então separamos em fases
    // Fase 1: independentes
    const phase1 = await Promise.allSettled([
      checkEnvAppSecret(),
      checkEnvEncryptionKey(),
      checkWabaAccessible(),
      checkPhoneAccessible(),
      checkAppSubscribedOnWaba(),
      checkDbRowIsActive(),
      checkTokenValid(), // popula debugTokenData
      checkModeActive(),
    ]);

    // Fase 2: dependem de phase 1 (debugTokenData, phoneData)
    const phase2 = await Promise.allSettled([
      checkTokenScopes(),
      checkPhoneRegistered(),
    ]);

    const unwrap = (results: PromiseSettledResult<Check>[], fallbackIds: string[]): Check[] =>
      results.map((r, idx) =>
        r.status === 'fulfilled'
          ? r.value
          : {
              id: fallbackIds[idx] || 'unknown',
              label: 'Check falhou com exceção',
              ok: false,
              detail: `Exceção: ${r.reason?.message || String(r.reason)}`,
            }
      );

    const phase1Checks = unwrap(phase1, [
      'env_app_secret',
      'env_encryption_key',
      'waba_accessible',
      'phone_accessible',
      'app_subscribed_on_waba',
      'db_row_is_active',
      'token_valid',
      'mode_active',
    ]);
    const phase2Checks = unwrap(phase2, ['token_scopes', 'phone_registered']);

    // Ordem final: mode → env → token → waba → phone → subscribe → db
    const allChecks = [...phase1Checks, ...phase2Checks];
    const order = [
      'mode_active',
      'env_app_secret',
      'env_encryption_key',
      'token_valid',
      'token_scopes',
      'waba_accessible',
      'phone_accessible',
      'phone_registered',
      'app_subscribed_on_waba',
      'db_row_is_active',
    ];
    const ordered: Check[] = order
      .map((id) => allChecks.find((c) => c.id === id))
      .filter((c): c is Check => !!c);

    res.json({
      account,
      checks: ordered,
      meta_panel_reminder: META_PANEL_REMINDER,
    });
  });

  // Assina/verifica webhook no nível da WABA
  app.post('/api/meta/whatsapp/subscribe-webhook', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;

    const { data: acc } = await supabase
      .from('whatsapp_business_accounts')
      .select('waba_id, access_token')
      .eq('user_id', userId)
      .eq('is_active', true)
      .maybeSingle();

    if (!acc?.waba_id || !acc?.access_token) {
      return res.status(400).json({ error: 'Conta WhatsApp não conectada' });
    }

    const token = decryptIfNeeded(acc.access_token);
    if (!token) return res.status(500).json({ error: 'Falha ao decifrar token' });

    try {
      // Verifica assinatura atual
      const checkRes = await fetch(
        `https://graph.facebook.com/v21.0/${acc.waba_id}/subscribed_apps`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const checkData = await checkRes.json();

      // Assina o app
      const subRes = await fetch(
        `https://graph.facebook.com/v21.0/${acc.waba_id}/subscribed_apps`,
        { method: 'POST', headers: { Authorization: `Bearer ${token}` } }
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
      .select('waba_id, phone_number_id, phone_number, display_name, connected_at, token_expires_at, access_token')
      .eq('user_id', userId)
      .eq('is_active', true)
      .maybeSingle();

    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.json({ connected: false, account: null });

    // Não vaza o token criptografado pra o frontend.
    const { access_token, ...accountSafe } = data;

    res.json({ connected: true, account: accountSafe });
  });

  // Diagnóstico de provisionamento Meta — bate na Graph API e retorna o estado
  // ao vivo do phone number. Usado pelo banner de "conta em provisionamento"
  // na inbox e pela tela de diagnóstico de Configurações → WhatsApp.
  app.get('/api/meta/whatsapp/diag', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;

    const { data: acc, error } = await supabase
      .from('whatsapp_business_accounts')
      .select('phone_number_id, access_token')
      .eq('user_id', userId)
      .eq('is_active', true)
      .maybeSingle();

    if (error) return res.status(500).json({ error: error.message });
    if (!acc) return res.json({ connected: false });

    const token = decryptIfNeeded(acc.access_token);
    if (!token) return res.status(500).json({ error: 'Falha ao decifrar token' });

    try {
      const r = await fetch(
        `https://graph.facebook.com/v21.0/${acc.phone_number_id}?fields=platform_type,code_verification_status,status,quality_rating,display_phone_number,verified_name`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const phone = await r.json();
      if (phone.error) return res.status(400).json({ error: phone.error.message, code: phone.error.code });

      const platform = String(phone.platform_type || '').toUpperCase();
      const verified = String(phone.code_verification_status || '').toUpperCase();
      const cloudApiReady = platform === 'CLOUD_API';

      // Interpretação humana do estado pra o frontend renderizar banner.
      // Ordem importa: CLOUD_API → OK; ON_PREMISE → aguardando migração; outros → erro genérico.
      let humanState: 'ready' | 'provisioning' | 'error';
      let humanMessage: string;
      if (cloudApiReady) {
        humanState = 'ready';
        humanMessage = 'Cloud API ativa — envio e recebimento de mensagens habilitados.';
      } else if (platform === 'ON_PREMISE') {
        humanState = 'provisioning';
        humanMessage = 'Número conectado, mas ainda não promovido pra Cloud API. A Meta processa essa migração após aprovação do App Review (3-4 semanas). Mensagens enviadas/recebidas pela API oficial estarão indisponíveis até lá.';
      } else {
        humanState = 'error';
        humanMessage = `Estado inesperado do número: platform_type=${platform || 'desconhecido'}. Reconecte em Configurações → WhatsApp.`;
      }

      res.json({
        connected: true,
        cloud_api_ready: cloudApiReady,
        state: humanState,
        message: humanMessage,
        phone: {
          platform_type: phone.platform_type || null,
          code_verification_status: phone.code_verification_status || null,
          status: phone.status || null,
          quality_rating: phone.quality_rating || null,
          display_phone_number: phone.display_phone_number || null,
          verified_name: phone.verified_name || null,
        },
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete('/api/meta/whatsapp/disconnect', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;

    // Desconecta só a WABA ativa. Rows inativas (de WABAs antigas) ficam pra
    // auditoria e pra eventual reativação manual via Supabase Studio.
    const { error } = await supabase
      .from('whatsapp_business_accounts')
      .delete()
      .eq('user_id', userId)
      .eq('is_active', true);

    if (error) return res.status(500).json({ error: error.message });

    res.json({ success: true });
  });

  // ============ WHATSAPP MESSAGE TEMPLATES ============
  // Gerencia templates de mensagem do WhatsApp via Graph API (nível WABA).
  // O Meta é a fonte da verdade; a tabela whatsapp_message_templates é cache.

  // Conta o número de variáveis {{N}} distintas no corpo
  const countTemplateVars = (body: string): number => {
    const matches = body.match(/\{\{(\d+)\}\}/g) || [];
    const nums = matches.map(m => Number(m.replace(/\D/g, '')));
    return nums.length ? Math.max(...nums) : 0;
  };

  const normalizeMetaTemplateStatus = (status: unknown): string => {
    const value = String(status || 'PENDING').trim().toUpperCase();
    return value || 'PENDING';
  };

  const parseMetaTemplate = (t: any, userId: string) => {
    const comps = Array.isArray(t.components) ? t.components : [];
    const bodyComp = comps.find((c: any) => String(c?.type || '').toUpperCase() === 'BODY');
    const headerComp = comps.find((c: any) => String(c?.type || '').toUpperCase() === 'HEADER');
    const footerComp = comps.find((c: any) => String(c?.type || '').toUpperCase() === 'FOOTER');
    const buttonsComp = comps.find((c: any) => String(c?.type || '').toUpperCase() === 'BUTTONS');
    const rawExamples = bodyComp?.example?.body_text;
    const exampleValues = Array.isArray(rawExamples?.[0])
      ? rawExamples[0].map(String)
      : Array.isArray(rawExamples)
        ? rawExamples.map(String)
        : [];
    const buttons = (buttonsComp?.buttons || []).map((b: any) => {
      const out: any = { type: String(b.type || '').toUpperCase(), text: b.text || '' };
      if (out.type === 'URL') out.url = b.url || '';
      if (out.type === 'PHONE_NUMBER') out.phone_number = b.phone_number || '';
      return out;
    });

    return {
      user_id: userId,
      meta_template_id: t.id || null,
      name: String(t.name || ''),
      status: normalizeMetaTemplateStatus(t.status),
      category: String(t.category || 'UTILITY').toUpperCase(),
      language: String(t.language || 'pt_BR'),
      body_text: bodyComp?.text || '',
      example_values: exampleValues,
      header_text: headerComp?.format === 'TEXT' ? (headerComp.text || null) : null,
      footer_text: footerComp?.text || null,
      buttons,
      rejection_reason: t.rejected_reason || t.rejection_reason || null,
      updated_at: new Date().toISOString(),
    };
  };

  const fetchMetaWhatsappTemplates = async (wabaId: string, accessToken: string): Promise<any[]> => {
    const params = new URLSearchParams({
      fields: 'id,name,status,category,language,components,rejected_reason',
      limit: '200',
    });
    let url = `https://graph.facebook.com/v21.0/${wabaId}/message_templates?${params.toString()}`;
    const templates: any[] = [];

    for (let page = 0; url && page < 20; page++) {
      const metaRes = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
      const metaData = await metaRes.json();
      if (!metaRes.ok || metaData.error) {
        throw new Error(metaData?.error?.message || 'Erro ao consultar templates no Meta');
      }

      if (Array.isArray(metaData.data)) templates.push(...metaData.data);
      url = metaData.paging?.next || '';
    }

    return templates;
  };

  const syncWhatsappTemplatesFromMeta = async (
    supabase: SupabaseClient,
    userId: string,
    acc: { waba_id: string; access_token: string },
  ) => {
    const metaTemplates = await fetchMetaWhatsappTemplates(acc.waba_id, acc.access_token);
    const rows = metaTemplates
      .map((t) => parseMetaTemplate(t, userId))
      .filter((t) => t.name && t.body_text);

    if (rows.length === 0) {
      return { metaTemplates, rows: [] as any[] };
    }

    const { data, error } = await supabase
      .from('whatsapp_message_templates')
      .upsert(rows, { onConflict: 'user_id,name' })
      .select('*');

    if (error) throw error;

    return { metaTemplates, rows: data || [] };
  };

  // GET — lista os templates diretamente sincronizados com o Meta.
  app.get('/api/meta/whatsapp/templates', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;

    const { data: acc } = await supabase
      .from('whatsapp_business_accounts')
      .select('waba_id, access_token')
      .eq('user_id', userId)
      .eq('is_active', true)
      .maybeSingle();

    if (!acc?.waba_id || !acc?.access_token) {
      return res.json([]);
    }

    const decryptedAccToken = decryptIfNeeded(acc.access_token);
    if (!decryptedAccToken) return res.status(500).json({ error: 'Falha ao decifrar token' });

    try {
      const { rows } = await syncWhatsappTemplatesFromMeta(supabase, userId, {
        waba_id: acc.waba_id,
        access_token: decryptedAccToken,
      });
      const sortedRows = [...rows].sort((a: any, b: any) => {
        const aTime = new Date(a.created_at || a.updated_at || 0).getTime();
        const bTime = new Date(b.created_at || b.updated_at || 0).getTime();
        return bTime - aTime;
      });
      res.json(sortedRows);
    } catch (err: any) {
      console.error('[Meta] listar templates error:', err);
      res.status(500).json({ error: err.message || 'Erro ao consultar templates no Meta' });
    }
  });

  // POST — cria um template no Meta e salva no cache como PENDING
  app.post('/api/meta/whatsapp/templates', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const body = req.body || {};

    const name = String(body.name || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
    const category = String(body.category || 'UTILITY').toUpperCase();
    const language = String(body.language || 'pt_BR');
    const bodyText = String(body.body_text || '').trim();
    const exampleValues: string[] = Array.isArray(body.example_values) ? body.example_values.map(String) : [];
    const headerText = String(body.header_text || '').trim();
    const footerText = String(body.footer_text || '').trim();
    // buttons: [{ type, text, url?, phone_number? }] — todos estáticos
    const rawButtons: any[] = Array.isArray(body.buttons) ? body.buttons : [];

    if (!name || !bodyText) {
      return res.status(400).json({ error: 'name e body_text são obrigatórios' });
    }
    const varCount = countTemplateVars(bodyText);
    if (varCount > exampleValues.length) {
      return res.status(400).json({ error: `O corpo usa ${varCount} variável(is), mas só ${exampleValues.length} exemplo(s) foram informados.` });
    }

    // Sanitiza botões
    const buttons = rawButtons
      .filter(b => b && b.type && String(b.text || '').trim())
      .slice(0, 10)
      .map(b => {
        const t = String(b.type).toUpperCase();
        const out: any = { type: t, text: String(b.text).trim().slice(0, 25) };
        if (t === 'URL') out.url = String(b.url || '').trim();
        if (t === 'PHONE_NUMBER') out.phone_number = String(b.phone_number || '').trim();
        return out;
      })
      .filter(b => b.type !== 'URL' || b.url)
      .filter(b => b.type !== 'PHONE_NUMBER' || b.phone_number);

    const { data: acc } = await supabase
      .from('whatsapp_business_accounts')
      .select('waba_id, access_token')
      .eq('user_id', userId)
      .eq('is_active', true)
      .maybeSingle();
    if (!acc?.waba_id || !acc?.access_token) {
      return res.status(400).json({ error: 'Conta WhatsApp não conectada' });
    }

    const createTplToken = decryptIfNeeded(acc.access_token);
    if (!createTplToken) return res.status(500).json({ error: 'Falha ao decifrar token' });

    // Monta os componentes na ordem que o Meta espera: HEADER, BODY, FOOTER, BUTTONS
    const components: any[] = [];
    if (headerText) {
      components.push({ type: 'HEADER', format: 'TEXT', text: headerText });
    }
    const bodyComponent: any = { type: 'BODY', text: bodyText };
    if (varCount > 0) {
      bodyComponent.example = { body_text: [exampleValues.slice(0, varCount)] };
    }
    components.push(bodyComponent);
    if (footerText) {
      components.push({ type: 'FOOTER', text: footerText });
    }
    if (buttons.length > 0) {
      components.push({
        type: 'BUTTONS',
        buttons: buttons.map(b => {
          if (b.type === 'URL') return { type: 'URL', text: b.text, url: b.url };
          if (b.type === 'PHONE_NUMBER') return { type: 'PHONE_NUMBER', text: b.text, phone_number: b.phone_number };
          return { type: 'QUICK_REPLY', text: b.text };
        }),
      });
    }

    try {
      const metaRes = await fetch(
        `https://graph.facebook.com/v21.0/${acc.waba_id}/message_templates`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${createTplToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, category, language, components }),
        }
      );
      const metaData = await metaRes.json();
      if (!metaRes.ok || metaData.error) {
        return res.status(400).json({ error: metaData?.error?.message || 'Erro ao criar template no Meta' });
      }

      const { data: saved, error } = await supabase
        .from('whatsapp_message_templates')
        .insert({
          user_id: userId,
          meta_template_id: metaData.id || null,
          name,
          category,
          language,
          body_text: bodyText,
          example_values: exampleValues,
          header_text: headerText || null,
          footer_text: footerText || null,
          buttons,
          status: normalizeMetaTemplateStatus(metaData.status),
        })
        .select()
        .single();
      if (error) return res.status(500).json({ error: error.message });
      res.json(saved);
    } catch (err: any) {
      console.error('[Meta] criar template error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // POST /sync — consulta o Meta e atualiza/importa o cache local.
  app.post('/api/meta/whatsapp/templates/sync', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;

    const { data: acc } = await supabase
      .from('whatsapp_business_accounts')
      .select('waba_id, access_token')
      .eq('user_id', userId)
      .eq('is_active', true)
      .maybeSingle();
    if (!acc?.waba_id || !acc?.access_token) {
      return res.status(400).json({ error: 'Conta WhatsApp não conectada' });
    }

    const syncToken = decryptIfNeeded(acc.access_token);
    if (!syncToken) return res.status(500).json({ error: 'Falha ao decifrar token' });

    try {
      const { metaTemplates, rows } = await syncWhatsappTemplatesFromMeta(supabase, userId, {
        waba_id: acc.waba_id,
        access_token: syncToken,
      });
      res.json({ synced: metaTemplates.length, updated: rows.length });
    } catch (err: any) {
      console.error('[Meta] sync templates error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE — remove o template no Meta e no cache local
  app.delete('/api/meta/whatsapp/templates/:id', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;

    const { data: tpl } = await supabase
      .from('whatsapp_message_templates')
      .select('id, name')
      .eq('user_id', userId)
      .eq('id', req.params.id)
      .maybeSingle();
    if (!tpl) return res.status(404).json({ error: 'Template não encontrado' });

    const { data: acc } = await supabase
      .from('whatsapp_business_accounts')
      .select('waba_id, access_token')
      .eq('user_id', userId)
      .eq('is_active', true)
      .maybeSingle();

    // Tenta deletar no Meta (não bloqueia se falhar — pode já não existir lá)
    const delTplToken = acc?.access_token ? decryptIfNeeded(acc.access_token) : null;
    if (acc?.waba_id && delTplToken) {
      try {
        await fetch(
          `https://graph.facebook.com/v21.0/${acc.waba_id}/message_templates?name=${encodeURIComponent(tpl.name)}&access_token=${delTplToken}`,
          { method: 'DELETE' }
        );
      } catch (err) {
        console.error('[Meta] deletar template no Meta falhou (segue):', err);
      }
    }

    const { error } = await supabase
      .from('whatsapp_message_templates')
      .delete()
      .eq('user_id', userId)
      .eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  });

  // POST /:id/send-test — envia o template pra um número de teste
  app.post('/api/meta/whatsapp/templates/:id/send-test', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const toRaw = String(req.body?.to || '').replace(/\D/g, '');
    const params: string[] = Array.isArray(req.body?.parameters) ? req.body.parameters.map(String) : [];

    if (!toRaw) return res.status(400).json({ error: 'Número de destino é obrigatório' });

    const { data: tpl } = await supabase
      .from('whatsapp_message_templates')
      .select('*')
      .eq('user_id', userId)
      .eq('id', req.params.id)
      .maybeSingle();
    if (!tpl) return res.status(404).json({ error: 'Template não encontrado' });
    if (tpl.status !== 'APPROVED') {
      return res.status(400).json({ error: 'Só é possível enviar templates aprovados pelo Meta.' });
    }

    const { data: acc } = await supabase
      .from('whatsapp_business_accounts')
      .select('phone_number_id, access_token')
      .eq('user_id', userId)
      .eq('is_active', true)
      .maybeSingle();
    if (!acc?.phone_number_id || !acc?.access_token) {
      return res.status(400).json({ error: 'Conta WhatsApp não conectada' });
    }

    const accessToken = decryptIfNeeded(acc.access_token);
    if (!accessToken) return res.status(500).json({ error: 'Falha ao decifrar token' });

    const varCount = countTemplateVars(tpl.body_text);
    const components: any[] = [];
    if (varCount > 0) {
      components.push({
        type: 'body',
        parameters: params.slice(0, varCount).map(p => ({ type: 'text', text: p })),
      });
    }

    try {
      const metaRes = await fetch(
        `https://graph.facebook.com/v21.0/${acc.phone_number_id}/messages`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: toRaw,
            type: 'template',
            template: {
              name: tpl.name,
              language: { code: tpl.language },
              ...(components.length ? { components } : {}),
            },
          }),
        }
      );
      const metaData = await metaRes.json();
      if (!metaRes.ok || metaData.error) {
        return res.status(400).json({ error: metaData?.error?.message || 'Erro ao enviar template' });
      }
      res.json({ success: true, message_id: metaData.messages?.[0]?.id || null });
    } catch (err: any) {
      console.error('[Meta] send-test template error:', err);
      res.status(500).json({ error: err.message });
    }
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

  // Send message — texto livre OU template aprovado.
  // - Sem template_id: envia texto livre, mas SÓ se a janela de 24h tá aberta
  //   (cliente mandou alguma mensagem nas últimas 24h). Fora da janela, Meta
  //   rejeita texto livre — preempção via 403 com mensagem clara.
  // - Com template_id: envia o template aprovado + parâmetros, sempre (janela
  //   não importa pra template).
  app.post('/api/whatsapp/send', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { to, body, client_id, template_id, parameters } = req.body;

    if (!to) return res.status(400).json({ error: 'to é obrigatório' });
    if (!template_id && !body) return res.status(400).json({ error: 'body ou template_id é obrigatório' });

    const { data: waAccount } = await supabase
      .from('whatsapp_business_accounts')
      .select('phone_number_id, phone_number, access_token')
      .eq('user_id', userId)
      .eq('is_active', true)
      .maybeSingle();

    if (!waAccount) return res.status(400).json({ error: 'WhatsApp Business não conectado' });

    const accessToken = decryptIfNeeded(waAccount.access_token);
    if (!accessToken) return res.status(500).json({ error: 'Falha ao decifrar token' });

    const cleanPhone = to.replace(/\D/g, '');

    // Monta o payload pro Graph API — texto livre OU template
    let payload: any;
    let savedBody = body;

    if (template_id) {
      // Carrega o template do cache local
      const { data: tpl } = await supabase
        .from('whatsapp_message_templates')
        .select('name, language, body_text, status')
        .eq('user_id', userId)
        .eq('id', template_id)
        .maybeSingle();

      if (!tpl) return res.status(404).json({ error: 'Template não encontrado' });
      if (tpl.status !== 'APPROVED') {
        return res.status(400).json({ error: 'Só é possível enviar templates aprovados pelo Meta.' });
      }

      const params: string[] = Array.isArray(parameters) ? parameters.map(String) : [];
      const varCount = countTemplateVars(tpl.body_text);
      const components: any[] = [];
      if (varCount > 0) {
        components.push({
          type: 'body',
          parameters: params.slice(0, varCount).map(p => ({ type: 'text', text: p })),
        });
      }

      payload = {
        messaging_product: 'whatsapp',
        to: cleanPhone,
        type: 'template',
        template: {
          name: tpl.name,
          language: { code: tpl.language },
          ...(components.length ? { components } : {}),
        },
      };

      // Substitui {{N}} por parâmetros pra salvar no histórico legível.
      savedBody = tpl.body_text.replace(/\{\{(\d+)\}\}/g, (_m: string, n: string) => params[Number(n) - 1] ?? `{{${n}}}`);
    } else {
      // Texto livre: confere janela de 24h. Meta exige que o cliente tenha
      // mandado pelo menos uma mensagem nas últimas 24h pra enviar texto livre.
      // Fora da janela, só template funciona.
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data: recentIncoming } = await supabase
        .from('wa_messages')
        .select('id')
        .eq('user_id', userId)
        .eq('phone', cleanPhone)
        .eq('from_me', false)
        .gte('timestamp', cutoff)
        .limit(1);

      if (!recentIncoming || recentIncoming.length === 0) {
        return res.status(403).json({
          error: 'Janela de 24h fechada. Cliente precisa responder primeiro, ou envie um template aprovado.',
          code: 'window_closed',
        });
      }

      payload = {
        messaging_product: 'whatsapp',
        to: cleanPhone,
        type: 'text',
        text: { body },
      };
    }

    try {
      const metaRes = await fetch(
        `https://graph.facebook.com/v21.0/${waAccount.phone_number_id}/messages`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
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
        body: savedBody,
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

  // ============ CONTRACTS / STUDIO SETTINGS ============

  // GET studio settings (returns null if user has none yet)
  app.get('/api/studio-settings', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { data, error } = await supabase
      .from('studio_settings')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    // Never leak the API key in plaintext on read; expose only a presence flag.
    if (data) {
      const { autentique_api_key, ...safe } = data as any;
      return res.json({ ...safe, autentique_api_key_set: !!autentique_api_key });
    }
    res.json(null);
  });

  // PUT studio settings (upsert)
  app.put('/api/studio-settings', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const body = req.body || {};
    const payload: any = {
      user_id: userId,
      studio_name: body.studio_name ?? null,
      studio_cnpj: body.studio_cnpj ?? null,
      studio_address: body.studio_address ?? null,
      studio_responsible: body.studio_responsible ?? null,
      studio_responsible_cpf: body.studio_responsible_cpf ?? null,
      studio_city: body.studio_city ?? null,
      down_payment_percent: body.down_payment_percent ?? 30,
      installments: body.installments ?? 6,
      extra_photo_price: body.extra_photo_price ?? '35,00',
      delivery_days_selection: body.delivery_days_selection ?? 2,
      selection_deadline_days: body.selection_deadline_days ?? 5,
      delivery_days: body.delivery_days ?? 30,
      signing_city: body.signing_city ?? null,
      autentique_sandbox: !!body.autentique_sandbox,
      updated_at: new Date().toISOString(),
    };
    // Only persist the API key if explicitly provided in this request.
    if (typeof body.autentique_api_key === 'string' && body.autentique_api_key.length > 0) {
      payload.autentique_api_key = body.autentique_api_key;
    }
    const { error } = await supabase.from('studio_settings').upsert(payload, { onConflict: 'user_id' });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  });

  // List contracts. Optional filters: ?status=, ?job_id=
  app.get('/api/contracts', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const status = (req.query.status as string) || null;
    const jobId = req.query.job_id ? Number(req.query.job_id) : null;
    let q = supabase
      .from('contracts')
      .select('id, user_id, client_id, job_id, template_id, status, signers, autentique_id, signed_at, created_at, updated_at, contract_data')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (status) q = q.eq('status', status);
    if (jobId) q = q.eq('job_id', jobId);
    const { data: contracts, error } = await q;
    if (error) return res.status(500).json({ error: error.message });

    // Hydrate client name for the list view (light read)
    const clientIds = Array.from(new Set((contracts || []).map((c: any) => c.client_id).filter(Boolean)));
    const nameById = new Map<number, string>();
    if (clientIds.length > 0) {
      const { data: clients } = await supabase
        .from('clients')
        .select('id, name')
        .in('id', clientIds);
      (clients || []).forEach((c: any) => nameById.set(c.id, c.name));
    }
    res.json((contracts || []).map((c: any) => ({ ...c, client_name: nameById.get(c.client_id) || null })));
  });

  // Get single contract
  // Restringe :id a só dígitos pra não capturar paths como /autentique-list
  app.get('/api/contracts/:id(\\d+)', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { data, error } = await supabase
      .from('contracts')
      .select('*')
      .eq('user_id', userId)
      .eq('id', req.params.id)
      .maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'not found' });
    res.json(data);
  });

  // Create contract (called by "Enviar p/ contratos" on a Job card)
  app.post('/api/contracts', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const body = req.body || {};
    if (!body.client_id) return res.status(400).json({ error: 'client_id required' });
    const payload: any = {
      user_id: userId,
      client_id: body.client_id,
      job_id: body.job_id ?? null,
      status: body.status || 'draft',
      contract_data: body.contract_data || {},
      signers: body.signers || [],
    };
    if (body.template_id !== undefined) payload.template_id = body.template_id;
    const { data, error } = await supabase
      .from('contracts')
      .insert(payload)
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  });

  // Update contract (form edits, status changes, signer updates)
  app.put('/api/contracts/:id(\\d+)', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const body = req.body || {};
    const update: any = { updated_at: new Date().toISOString() };
    if (body.contract_data !== undefined) update.contract_data = body.contract_data;
    if (body.signers !== undefined) update.signers = body.signers;
    if (body.status !== undefined) update.status = body.status;
    if (body.job_id !== undefined) update.job_id = body.job_id;
    if (body.template_id !== undefined) update.template_id = body.template_id;
    if (body.signed_at !== undefined) update.signed_at = body.signed_at;
    if (body.signed_pdf_url !== undefined) update.signed_pdf_url = body.signed_pdf_url;
    if (body.autentique_id !== undefined) update.autentique_id = body.autentique_id;
    const { data, error } = await supabase
      .from('contracts')
      .update(update)
      .eq('user_id', userId)
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  });

  app.delete('/api/contracts/:id(\\d+)', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { error } = await supabase
      .from('contracts')
      .delete()
      .eq('user_id', userId)
      .eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  });

  // ── Custom Fields (campos personalizados de cadastro de cliente) ─────────
  // Define a estrutura dos campos extras que cada usuário quer no cliente.
  // Os VALORES por cliente ficam em clients.custom_fields_data (jsonb).
  const VALID_FIELD_TYPES = new Set(['text', 'date', 'number', 'select', 'textarea']);

  app.get('/api/custom-fields', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { data, error } = await supabase
      .from('custom_fields')
      .select('*')
      .eq('user_id', userId)
      .eq('archived', false)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
  });

  app.post('/api/custom-fields', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const body = req.body || {};
    if (!body.label || typeof body.label !== 'string') {
      return res.status(400).json({ error: 'label is required' });
    }
    const fieldType = body.field_type || 'text';
    if (!VALID_FIELD_TYPES.has(fieldType)) {
      return res.status(400).json({ error: 'invalid field_type' });
    }
    // Slug pra field_key: lowercase, sem acento, sem espaço
    const slug = (body.field_key || body.label)
      .toString()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9_]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .toLowerCase()
      .slice(0, 60);
    if (!slug) return res.status(400).json({ error: 'invalid field_key' });

    const { data, error } = await supabase
      .from('custom_fields')
      .insert({
        user_id: userId,
        field_key: slug,
        label: body.label.trim(),
        field_type: fieldType,
        options: Array.isArray(body.options) ? body.options : [],
        required: !!body.required,
        sort_order: Number(body.sort_order) || 0,
      })
      .select()
      .single();
    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'Já existe um campo com essa chave' });
      return res.status(500).json({ error: error.message });
    }
    res.json(data);
  });

  app.put('/api/custom-fields/:id', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const body = req.body || {};
    const patch: any = {};
    if (typeof body.label === 'string') patch.label = body.label.trim();
    if (typeof body.field_type === 'string') {
      if (!VALID_FIELD_TYPES.has(body.field_type)) {
        return res.status(400).json({ error: 'invalid field_type' });
      }
      patch.field_type = body.field_type;
    }
    if (Array.isArray(body.options)) patch.options = body.options;
    if (typeof body.required === 'boolean') patch.required = body.required;
    if (typeof body.sort_order === 'number') patch.sort_order = body.sort_order;
    if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'nothing to update' });

    const { data, error } = await supabase
      .from('custom_fields')
      .update(patch)
      .eq('user_id', userId)
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  });

  app.delete('/api/custom-fields/:id', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    // Soft delete via archived=true — preserva os valores já preenchidos
    // em clients.custom_fields_data; só esconde do formulário.
    const { error } = await supabase
      .from('custom_fields')
      .update({ archived: true })
      .eq('user_id', userId)
      .eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  });

  // ── Contract Templates (modelos de contrato) ──────────────────────────────
  app.get('/api/contract-templates', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;

    // Auto-provisão do template padrão pra conta nova: se a flag
    // default_template_provisioned ainda for false, insere 1 modelo
    // genérico e marca a flag. Idempotente — se o usuário apagar
    // depois, NÃO recria (a flag continua true).
    const { data: settings } = await supabase
      .from('studio_settings')
      .select('default_template_provisioned')
      .eq('user_id', userId)
      .maybeSingle();
    if (!settings?.default_template_provisioned) {
      try {
        const { DEFAULT_TEMPLATE } = await import('./lib/default-contract-template.js');
        await supabase.from('contract_templates').insert({
          user_id: userId,
          name: DEFAULT_TEMPLATE.name,
          category: DEFAULT_TEMPLATE.category,
          body: DEFAULT_TEMPLATE.body,
          default_data: DEFAULT_TEMPLATE.default_data,
          is_default: DEFAULT_TEMPLATE.is_default,
        });
        await supabase
          .from('studio_settings')
          .upsert({ user_id: userId, default_template_provisioned: true }, { onConflict: 'user_id' });
      } catch (err) {
        console.error('[contract-templates] auto-provision falhou:', err);
      }
    }

    const { data, error } = await supabase
      .from('contract_templates')
      .select('*')
      .eq('user_id', userId)
      .eq('archived', false)
      .order('category', { ascending: true })
      .order('name', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
  });

  app.get('/api/contract-templates/:id', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { data, error } = await supabase
      .from('contract_templates')
      .select('*')
      .eq('user_id', userId)
      .eq('id', req.params.id)
      .maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'not found' });
    res.json(data);
  });

  app.post('/api/contract-templates', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const body = req.body || {};
    if (!body.name || !body.body || !body.category) {
      return res.status(400).json({ error: 'name, category and body are required' });
    }
    const payload = {
      user_id: userId,
      name: String(body.name).trim(),
      category: String(body.category).trim(),
      body: String(body.body),
      default_data: body.default_data || {},
      is_default: !!body.is_default,
      is_legacy: !!body.is_legacy,
    };
    const { data, error } = await supabase
      .from('contract_templates')
      .insert(payload)
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  });

  app.put('/api/contract-templates/:id', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const body = req.body || {};
    const update: any = { updated_at: new Date().toISOString() };
    if (body.name !== undefined) update.name = String(body.name).trim();
    if (body.category !== undefined) update.category = String(body.category).trim();
    if (body.body !== undefined) update.body = String(body.body);
    if (body.default_data !== undefined) update.default_data = body.default_data;
    if (body.is_default !== undefined) update.is_default = !!body.is_default;
    if (body.archived !== undefined) update.archived = !!body.archived;
    const { data, error } = await supabase
      .from('contract_templates')
      .update(update)
      .eq('user_id', userId)
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  });

  app.delete('/api/contract-templates/:id', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { error } = await supabase
      .from('contract_templates')
      .delete()
      .eq('user_id', userId)
      .eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  });

  // Endpoint /api/contract-templates/seed (bulk import dos 24 modelos do
  // estúdio) foi removido em 2026-05-23. Contas que já tinham importado
  // mantêm os modelos no banco; contas novas começam sem modelos hardcoded
  // e ganham 1 modelo padrão genérico via auto-provision em /api/contract-templates GET.

  // ── Autentique: send for signature ─────────────────────────────────────────
  // Creates a document via Autentique GraphQL API using the tenant's API key.
  // Requires: contract has at least 1 signer with email.
  // ──────────────────────────────────────────────────────────────────
  // PREVIEW: lista contratos do Autentique (1 página) com extração leve
  // dos metadados (nome do signatário, email, data) — SEM baixar PDFs.
  // Marca pra cada doc se: cliente já existe + se job duplicaria.
  // ──────────────────────────────────────────────────────────────────
  app.get('/api/contracts/autentique-list', requireAuth, requireOwnerOrPlatformAdmin, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);

    const { data: settings } = await supabase
      .from('studio_settings')
      .select('autentique_api_key, autentique_sandbox')
      .eq('user_id', userId)
      .maybeSingle();
    if (!settings?.autentique_api_key) {
      return res.status(400).json({
        error: 'Configure a API key do Autentique em Configurações → Integrações primeiro',
      });
    }

    let lib;
    try {
      lib = await import('./lib/autentique-import.js');
    } catch (err: any) {
      return res.status(500).json({ error: `Lib indisponível: ${err.message}` });
    }

    let pageResult;
    try {
      pageResult = await lib.fetchAutentiqueDocsPage(
        settings.autentique_api_key, !!settings.autentique_sandbox, page, 60,
      );
    } catch (err: any) {
      return res.status(502).json({ error: `Autentique: ${err.message}` });
    }

    // Caches pra marcação de duplicata/existência
    const { data: clients } = await supabase.from('clients').select('id, name, email').eq('user_id', userId);
    const clientsByEmail = new Map<string, any>();
    (clients || []).forEach((c: any) => { if (c.email) clientsByEmail.set(String(c.email).toLowerCase().trim(), c); });

    const { data: jobs } = await supabase.from('jobs').select('client_id, job_date').eq('user_id', userId);
    const jobKey = (cid: number | null, date: string | null) => `${cid}|${(date || '').slice(0, 10)}`;
    const jobKeys = new Set((jobs || []).map((j: any) => jobKey(j.client_id, j.job_date)));

    const items = (pageResult.docs || []).map((doc: any) => {
      const ext = lib.extractFromDoc(doc);
      // Mesma proteção do import: só conta como "vincula a existente" se
      // email E nome batem. Senão vai criar cliente novo.
      const emailMatch = ext.client_email ? clientsByEmail.get(ext.client_email) : null;
      const existingClient =
        emailMatch && lib.namesAreCompatible(emailMatch.name, ext.client_name)
          ? emailMatch
          : null;
      const wouldDuplicate = existingClient && jobKeys.has(jobKey(existingClient.id, ext.job_date));
      return {
        doc_id: doc.id,
        doc_name: ext.doc_name,
        client_name: ext.client_name,
        client_email: ext.client_email,
        job_type: ext.job_type,
        job_date: ext.job_date,
        existing_client_id: existingClient?.id || null,
        existing_client_name: existingClient?.name || null,
        will_duplicate: !!wouldDuplicate,
        has_name: !!ext.client_name,
      };
    });

    res.json({
      page,
      items,
      total: pageResult.total,
      last_page: pageResult.last_page,
      has_more: page < pageResult.last_page,
      next_page: page < pageResult.last_page ? page + 1 : null,
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // IMPORT: cria clientes + jobs em lote a partir de doc IDs selecionados
  // OU de uma página inteira. SEM baixar PDFs — só metadados.
  // Body: { doc_ids?: string[], page?: number }
  // - Se vier doc_ids: importa só esses (refaz fetch da página com eles)
  // - Se vier page: importa todos da página (skipping dups/sem nome)
  // ──────────────────────────────────────────────────────────────────
  app.post('/api/contracts/autentique-import', requireAuth, requireOwnerOrPlatformAdmin, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const page = Math.max(1, parseInt(String(req.body?.page ?? req.query?.page ?? '1'), 10) || 1);
    const docIdsFilter: Set<string> | null = Array.isArray(req.body?.doc_ids) && req.body.doc_ids.length
      ? new Set(req.body.doc_ids.map(String))
      : null;

    const { data: settings } = await supabase
      .from('studio_settings')
      .select('autentique_api_key, autentique_sandbox')
      .eq('user_id', userId)
      .maybeSingle();
    if (!settings?.autentique_api_key) {
      return res.status(400).json({ error: 'Configure a API key do Autentique primeiro' });
    }

    let lib;
    try {
      lib = await import('./lib/autentique-import.js');
    } catch (err: any) {
      return res.status(500).json({ error: `Lib indisponível: ${err.message}` });
    }

    let pageResult;
    try {
      pageResult = await lib.fetchAutentiqueDocsPage(
        settings.autentique_api_key, !!settings.autentique_sandbox, page, 60,
      );
    } catch (err: any) {
      return res.status(502).json({ error: `Autentique: ${err.message}` });
    }

    let docs: any[] = pageResult.docs || [];
    if (docIdsFilter) docs = docs.filter((d) => docIdsFilter.has(d.id));

    // Caches
    const { data: clients } = await supabase.from('clients').select('id, name, email').eq('user_id', userId);
    const clientsByEmail = new Map<string, any>();
    (clients || []).forEach((c: any) => { if (c.email) clientsByEmail.set(String(c.email).toLowerCase().trim(), c); });

    const { data: jobs } = await supabase.from('jobs').select('client_id, job_date').eq('user_id', userId);
    const jobKey = (cid: number | null, date: string | null) => `${cid}|${(date || '').slice(0, 10)}`;
    const existingJobKeys = new Set((jobs || []).map((j: any) => jobKey(j.client_id, j.job_date)));

    let imported = 0;
    let skippedDup = 0;
    let failed = 0;
    const errors: Array<{ doc_id: string; reason: string }> = [];

    // CPF (segundo critério de match — depois do email)
    const { data: clientsWithCpf } = await supabase.from('clients').select('id, name, cpf').eq('user_id', userId).not('cpf', 'is', null);
    const clientsByCpf = new Map<string, any>();
    (clientsWithCpf || []).forEach((c: any) => {
      if (c.cpf) clientsByCpf.set(String(c.cpf).replace(/\D/g, ''), c);
    });

    let pdfIndex = 0;
    for (const doc of docs) {
      try {
        const base = lib.extractFromDoc(doc);

        // Baixa + parseia o PDF assinado pra ter CPF/telefone/endereço/valor.
        // Throttle: 600ms entre downloads pra respeitar o rate limit do Autentique
        // (~100 req/min). Se falhar (sem PDF, 429 persistente, timeout), segue
        // com os metadados básicos do GraphQL.
        let ext: any = base;
        if (doc.pdf_url) {
          if (pdfIndex > 0) {
            await new Promise((res) => setTimeout(res, 600));
          }
          pdfIndex++;
          try {
            ext = await lib.downloadAndParsePdf(doc.pdf_url, base, 20_000);
          } catch (pdfErr: any) {
            console.warn(`[autentique-import] PDF parse falhou pra ${doc.id}: ${pdfErr.message} — seguindo só com metadados`);
          }
        }

        if (!ext.client_name) {
          failed++; errors.push({ doc_id: doc.id, reason: 'Sem nome de cliente' });
          continue;
        }

        // Match cliente: tenta email primeiro, depois CPF.
        // CRÍTICO: só vincula se o nome também bater (proteção contra
        // contratos diferentes assinados pelo mesmo email — marido,
        // responsável, etc — que viravam ensaios da pessoa errada).
        let client: any = null;
        if (ext.client_email) {
          const cand = clientsByEmail.get(ext.client_email);
          if (cand && lib.namesAreCompatible(cand.name, ext.client_name)) client = cand;
        }
        if (!client && ext.client_cpf) {
          const cand = clientsByCpf.get(ext.client_cpf);
          if (cand && lib.namesAreCompatible(cand.name, ext.client_name)) client = cand;
        }

        if (!client) {
          const { data: newClient, error: ce } = await supabase
            .from('clients')
            .insert({
              user_id: userId,
              name: ext.client_name,
              email: ext.client_email || null,
              cpf: ext.client_cpf || null,
              phone: ext.client_phone || null,
              address: ext.client_address || null,
              cep: ext.client_cep || null,
              city: ext.client_city || null,
              state: ext.client_state || null,
              status: 'active',
              notes: `Importado do Autentique em ${new Date().toLocaleDateString('pt-BR')}`,
            })
            .select().single();
          if (ce || !newClient) {
            failed++; errors.push({ doc_id: doc.id, reason: `Cliente: ${ce?.message}` });
            continue;
          }
          client = newClient;
          if (client.email) clientsByEmail.set(String(client.email).toLowerCase(), client);
          if (client.cpf) clientsByCpf.set(String(client.cpf).replace(/\D/g, ''), client);
        } else {
          // Cliente já existe — complementa dados vazios (não sobrescreve)
          const patch: any = {};
          if (!client.cpf && ext.client_cpf) patch.cpf = ext.client_cpf;
          if (!client.phone && ext.client_phone) patch.phone = ext.client_phone;
          if (!client.address && ext.client_address) patch.address = ext.client_address;
          if (!client.cep && ext.client_cep) patch.cep = ext.client_cep;
          if (!client.city && ext.client_city) patch.city = ext.client_city;
          if (!client.state && ext.client_state) patch.state = ext.client_state;
          if (Object.keys(patch).length > 0) {
            await supabase.from('clients').update(patch).eq('id', client.id).eq('user_id', userId);
          }
        }

        // Dedup
        if (ext.job_date && existingJobKeys.has(jobKey(client.id, ext.job_date))) {
          skippedDup++;
          continue;
        }

        const jobName = ext.job_type ? `${ext.job_type} — ${client.name}` : `Sessão (Autentique) — ${client.name}`;
        const { error: je } = await supabase.from('jobs').insert({
          user_id: userId,
          client_id: client.id,
          job_name: jobName,
          job_type: ext.job_type || 'Outro',
          job_date: ext.job_date || null,
          amount: ext.job_value || 0,
          payment_method: '',
          payment_status: 'paid',
          status: 'completed',
          production_stage: null,
          notes: `Importado do Autentique (doc ${doc.id}) — ${ext.doc_name}`,
        });
        if (je) {
          failed++; errors.push({ doc_id: doc.id, reason: `Job: ${je.message}` });
          continue;
        }

        if (ext.job_date) existingJobKeys.add(jobKey(client.id, ext.job_date));
        imported++;
      } catch (err: any) {
        failed++; errors.push({ doc_id: doc.id, reason: err.message || String(err) });
      }
    }

    res.json({
      page,
      processed: docs.length,
      imported,
      skipped_duplicates: skippedDup,
      failed,
      errors: errors.slice(0, 20),
      total: pageResult.total,
      last_page: pageResult.last_page,
      has_more: page < pageResult.last_page,
      next_page: page < pageResult.last_page ? page + 1 : null,
    });
  });

  app.post('/api/contracts/:id/autentique-send', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;

    const [{ data: contract }, { data: settings }] = await Promise.all([
      supabase.from('contracts').select('*').eq('user_id', userId).eq('id', req.params.id).maybeSingle(),
      supabase.from('studio_settings').select('autentique_api_key, autentique_sandbox').eq('user_id', userId).maybeSingle(),
    ]);
    if (!contract) return res.status(404).json({ error: 'contract not found' });
    if (!settings?.autentique_api_key) return res.status(400).json({ error: 'Autentique API key not configured' });

    const signers: any[] = contract.signers || [];
    if (!signers.length || !signers.every((s: any) => s.email)) {
      return res.status(400).json({ error: 'Todos os signatários precisam ter e-mail antes de enviar para a Autentique.' });
    }

    const html = String(req.body?.html || '');
    if (!html) return res.status(400).json({ error: 'html (rendered contract) required' });

    const endpoint = settings.autentique_sandbox
      ? 'https://api.autentique.com.br/v2/graphql?sandbox=true'
      : 'https://api.autentique.com.br/v2/graphql';

    // Autentique expects multipart/form-data for createDocument with a file.
    // We send the rendered HTML as a .html attachment; Autentique converts it.
    const operations = {
      query: `
        mutation CreateDocumentMutation($document: DocumentInput!, $signers: [SignerInput!]!, $file: Upload!) {
          createDocument(document: $document, signers: $signers, file: $file) {
            id
            name
            signatures { public_id name email signed { created_at } }
          }
        }
      `,
      variables: {
        document: { name: `Contrato - ${contract.contract_data?.clientName || 'Cliente'}` },
        signers: signers.map((s: any) => ({ email: s.email, action: 'SIGN', name: s.name || undefined })),
        file: null,
      },
    };
    const map = { '0': ['variables.file'] };

    const form = new FormData();
    form.append('operations', JSON.stringify(operations));
    form.append('map', JSON.stringify(map));
    form.append('0', new Blob([html], { type: 'text/html' }), 'contrato.html');

    let json: any;
    try {
      const r = await fetch(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${settings.autentique_api_key}` },
        body: form as any,
      });
      json = await r.json();
    } catch (err: any) {
      return res.status(502).json({ error: 'Autentique request failed: ' + err.message });
    }

    if (json.errors?.length) {
      return res.status(400).json({ error: json.errors[0]?.message || 'Autentique error', detail: json.errors });
    }
    const doc = json.data?.createDocument;
    if (!doc?.id) return res.status(502).json({ error: 'Autentique did not return a document id' });

    // Update contract: status + autentique_id + per-signer public_id
    const newSigners = signers.map((s: any) => {
      const match = (doc.signatures || []).find((sg: any) => sg.email === s.email);
      return { ...s, status: 'pending', autentique_public_id: match?.public_id || null };
    });
    await supabase
      .from('contracts')
      .update({
        autentique_id: doc.id,
        status: 'pending_signature',
        signers: newSigners,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId)
      .eq('id', req.params.id);

    res.json({ ok: true, autentique_id: doc.id });
  });

  // Pull latest signature status from Autentique for a given contract.
  app.post('/api/contracts/:id/autentique-refresh', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;

    const [{ data: contract }, { data: settings }] = await Promise.all([
      supabase.from('contracts').select('*').eq('user_id', userId).eq('id', req.params.id).maybeSingle(),
      supabase.from('studio_settings').select('autentique_api_key, autentique_sandbox').eq('user_id', userId).maybeSingle(),
    ]);
    if (!contract) return res.status(404).json({ error: 'contract not found' });
    if (!contract.autentique_id) return res.status(400).json({ error: 'contract not sent to Autentique yet' });
    if (!settings?.autentique_api_key) return res.status(400).json({ error: 'Autentique API key not configured' });

    const endpoint = settings.autentique_sandbox
      ? 'https://api.autentique.com.br/v2/graphql?sandbox=true'
      : 'https://api.autentique.com.br/v2/graphql';

    const query = `query Q($id: UUID!) {
      document(id: $id) {
        id name files { signed }
        signatures { public_id name email signed { created_at } }
      }
    }`;

    let json: any;
    try {
      const r = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${settings.autentique_api_key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query, variables: { id: contract.autentique_id } }),
      });
      json = await r.json();
    } catch (err: any) {
      return res.status(502).json({ error: 'Autentique request failed: ' + err.message });
    }

    // Debug log: helps diagnose "client signed but app didn't update"
    console.log('[autentique-refresh] contract', contract.id, 'autentique_id', contract.autentique_id);
    console.log('[autentique-refresh] response:', JSON.stringify(json, null, 2));

    if (json.errors?.length) return res.status(400).json({ error: json.errors[0]?.message, detail: json.errors });
    const doc = json.data?.document;
    if (!doc) return res.status(404).json({ error: 'document not found at Autentique' });

    const sigs = doc.signatures || [];
    const norm = (s: string) => (s || '').trim().toLowerCase();
    const updatedSigners = (contract.signers || []).map((s: any) => {
      const match = sigs.find((sg: any) =>
        (sg.public_id && sg.public_id === s.autentique_public_id) ||
        (sg.email && s.email && norm(sg.email) === norm(s.email))
      );
      const signed = !!match?.signed?.created_at;
      return {
        ...s,
        status: signed ? 'signed' : 'pending',
        signed_at: signed ? match.signed.created_at : null,
        autentique_public_id: match?.public_id || s.autentique_public_id || null,
      };
    });
    const allSigned = updatedSigners.length > 0 && updatedSigners.every((s: any) => s.status === 'signed');

    console.log('[autentique-refresh] computed signers:', JSON.stringify(updatedSigners, null, 2));
    console.log('[autentique-refresh] all_signed:', allSigned);

    const { data: updateResult, error: updateError } = await supabase
      .from('contracts')
      .update({
        signers: updatedSigners,
        status: allSigned ? 'signed' : 'pending_signature',
        signed_at: allSigned ? new Date().toISOString() : null,
        signed_pdf_url: doc.files?.signed || null,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId)
      .eq('id', req.params.id)
      .select();

    if (updateError) {
      console.error('[autentique-refresh] DB UPDATE ERROR:', updateError);
      return res.status(500).json({ error: 'DB update failed: ' + updateError.message });
    }
    console.log('[autentique-refresh] rows updated:', updateResult?.length || 0);
    if ((updateResult?.length || 0) === 0) {
      console.warn('[autentique-refresh] WARNING: 0 rows updated — possibly RLS or wrong id/user_id');
    }

    res.json({ ok: true, all_signed: allSigned, signers: updatedSigners, signed_pdf_url: doc.files?.signed || null });
  });

  // ============ DASHBOARD ANALYTICS ============
  const parseHistory = (raw: any): any[] => {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  };

  // Single endpoint that consolidates business-logic metrics across vendas,
  // produção, oportunidades internas e financeiro. Designed for the Dashboard
  // panorama view — heavy aggregation kept server-side so the client stays light.
  app.get('/api/dashboard/analytics', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const adminClient = supabaseAdmin || supabase;

    const DAY_MS = 24 * 60 * 60 * 1000;
    const toDateOnly = (date: Date) => {
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, '0');
      const d = String(date.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    };
    const dateOnlyToDate = (value: string) => {
      const [y, m, d] = value.split('-').map(Number);
      return new Date(y, (m || 1) - 1, d || 1);
    };
    const addDaysOnly = (value: string, days: number) => {
      const d = dateOnlyToDate(value);
      d.setDate(d.getDate() + days);
      return toDateOnly(d);
    };
    const parseDateOnlyParam = (value: any): string | null => {
      const raw = Array.isArray(value) ? value[0] : value;
      if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(String(raw))) return null;
      const parsed = dateOnlyToDate(String(raw));
      if (Number.isNaN(parsed.getTime())) return null;
      const normalized = toDateOnly(parsed);
      return normalized === String(raw) ? normalized : null;
    };
    const inDateRange = (value: any, start: string, end: string) => {
      if (!value) return false;
      const day = String(value).slice(0, 10);
      return day >= start && day <= end;
    };

    const now = new Date();
    const todayStr = toDateOnly(now);
    const monthStart = toDateOnly(new Date(now.getFullYear(), now.getMonth(), 1));
    const monthEnd = toDateOnly(new Date(now.getFullYear(), now.getMonth() + 1, 0));
    const next7DaysEnd = addDaysOnly(todayStr, 7);
    const futureLimit = toDateOnly(new Date(now.getFullYear(), now.getMonth() + 3, 0));

    let periodStart = parseDateOnlyParam(req.query.from) || monthStart;
    let periodEnd = parseDateOnlyParam(req.query.to) || monthEnd;
    if (periodStart > periodEnd) [periodStart, periodEnd] = [periodEnd, periodStart];

    const periodDays = Math.max(
      1,
      Math.round((dateOnlyToDate(periodEnd).getTime() - dateOnlyToDate(periodStart).getTime()) / DAY_MS) + 1,
    );
    const previousEnd = addDaysOnly(periodStart, -1);
    const previousStart = addDaysOnly(previousEnd, -(periodDays - 1));

    try {
      const [
        jobsRes,
        dealsRes,
        dealStagesRes,
        prodStagesRes,
        prodProcessesRes,
        contractsRes,
        opportunitiesRes,
        clientsRes,
      ] = await Promise.all([
        supabase.from('jobs').select('*, clients(name)').eq('user_id', userId),
        supabase.from('deals').select('*').eq('user_id', userId),
        supabase.from('deal_stages').select('*').eq('user_id', userId).not('id', 'like', 'prod-%').order('position'),
        supabase.from('deal_stages').select('*').eq('user_id', userId).like('id', 'prod-%').order('position'),
        supabase.from('production_processes').select('*').eq('user_id', userId).order('position'),
        supabase.from('contracts').select('id, job_id, status').eq('user_id', userId),
        supabase.from('opportunities').select('*, clients(name)').eq('user_id', userId).not('status', 'in', '("converted","dismissed")'),
        supabase.from('clients').select('id, name').eq('user_id', userId),
      ]);

      const jobs = (jobsRes.data || []).map((j: any) => ({ ...j, client_name: (j.clients as any)?.name || null }));
      const deals = dealsRes.data || [];
      const dealStages = dealStagesRes.data || [];
      const prodStages = prodStagesRes.data || [];
      const prodProcesses = prodProcessesRes.data || [];
      const contracts = contractsRes.data || [];
      const opportunities = opportunitiesRes.data || [];
      const clientNameById = new Map<number, string>();
      (clientsRes.data || []).forEach((c: any) => clientNameById.set(c.id, c.name));

      // Aggregated payments per job (for accurate revenue)
      const jobIds = jobs.map((j: any) => j.id);
      const amountPaidByJob = new Map<number, number>();
      const paymentsByDate = new Map<string, number>();
      if (jobIds.length > 0) {
        const { data: pmts } = await adminClient
          .from('job_payments')
          .select('job_id, amount, payment_date')
          .in('job_id', jobIds);
        (pmts || []).forEach((p: any) => {
          amountPaidByJob.set(p.job_id, (amountPaidByJob.get(p.job_id) || 0) + (p.amount || 0));
          if (p.payment_date) {
            const paymentDay = String(p.payment_date).slice(0, 10);
            paymentsByDate.set(paymentDay, (paymentsByDate.get(paymentDay) || 0) + (p.amount || 0));
          }
        });
      }
      const sumPaymentsBetween = (start: string, end: string) => {
        let total = 0;
        for (const [day, value] of paymentsByDate.entries()) {
          if (day >= start && day <= end) total += value;
        }
        return total;
      };

      // ── JOBS metrics ───────────────────────────────────────────────────────
      const jobsThisMonth = jobs.filter((j: any) => j.job_date >= periodStart && j.job_date <= periodEnd);
      const completedThisMonth = jobsThisMonth.filter((j: any) => j.status === 'completed' || (j.job_date < todayStr && j.status !== 'cancelled'));
      const scheduledThisMonth = jobsThisMonth.filter((j: any) => j.job_date >= todayStr && j.status === 'scheduled');
      const todayJobs = jobs.filter((j: any) => j.job_date === todayStr && j.status !== 'cancelled');
      const next7Jobs = jobs
        .filter((j: any) => j.job_date >= todayStr && j.job_date <= next7DaysEnd && j.status !== 'cancelled')
        .sort((a: any, b: any) => (a.job_date || '').localeCompare(b.job_date || ''));

      // Late jobs: production_stage_entered_at + expected_hours has passed
      const stageHoursById = new Map<string, number>();
      prodStages.forEach((s: any) => stageHoursById.set(s.id, Number(s.expected_hours || 0)));
      const isLate = (j: any) => {
        if (!j.production_stage || !j.production_stage_entered_at) return false;
        const expected = stageHoursById.get(j.production_stage) || 0;
        if (expected <= 0) return false;
        const elapsedMs = Date.now() - new Date(j.production_stage_entered_at).getTime();
        return elapsedMs / 3_600_000 >= expected;
      };
      const lateJobs = jobs.filter(isLate);

      // Awaiting contract: jobs without a signed contract (any non-signed status counts)
      const contractByJob = new Map<number, string>();
      contracts.forEach((c: any) => {
        if (c.job_id) contractByJob.set(c.job_id, c.status);
      });
      const awaitingContract = jobs.filter((j: any) => {
        if (j.status === 'cancelled') return false;
        const status = contractByJob.get(j.id);
        return !status || status === 'draft' || status === 'pending_signature';
      });
      const awaitingContractFutureOnly = awaitingContract.filter((j: any) => j.job_date >= todayStr);

      // Awaiting selection: stage names containing "seleção" or "selection"
      const selectionStageIds = new Set(
        prodStages
          .filter((s: any) => /sele[çc][aã]o|selection/i.test(s.name || ''))
          .map((s: any) => s.id),
      );
      const awaitingSelection = jobs.filter((j: any) =>
        j.production_stage && selectionStageIds.has(j.production_stage),
      );

      // ── PRODUCTION board (counts per process > stage) ──────────────────────
      const stageById = new Map<string, any>();
      prodStages.forEach((s: any) => stageById.set(s.id, s));
      const productionByProcess = prodProcesses.map((proc: any) => {
        const stages = prodStages
          .filter((s: any) => s.process_id === proc.id)
          .map((stage: any) => {
            const stageJobs = jobs.filter((j: any) => j.production_stage === stage.id && j.status !== 'cancelled');
            return {
              id: stage.id,
              name: stage.name,
              color: stage.color || '#94a3b8',
              count: stageJobs.length,
              late_count: stageJobs.filter(isLate).length,
              expected_hours: Number(stage.expected_hours || 0),
            };
          });
        return {
          id: proc.id,
          name: proc.name,
          color: proc.color || '#94a3b8',
          is_special: !!proc.is_special,
          stages,
          total_jobs: stages.reduce((acc: number, s: any) => acc + s.count, 0),
        };
      });

      // ── SALES funnel (deals by stage) ──────────────────────────────────────
      const dealInSelectedPeriod = (d: any) =>
        inDateRange(d.converted_at || d.updated_at || d.created_at, periodStart, periodEnd);
      const dealsByStage = dealStages.map((stage: any) => {
        const stageDeals = deals.filter((d: any) =>
          d.stage === stage.id && (!stage.is_final || dealInSelectedPeriod(d))
        );
        return {
          id: stage.id,
          name: stage.name,
          color: stage.color || '#E5E7EB',
          position: Number(stage.position || 0),
          is_final: !!stage.is_final,
          is_won: !!stage.is_won,
          count: stageDeals.length,
          total_value: stageDeals.reduce((acc: number, d: any) => acc + (Number(d.value) || 0), 0),
        };
      });

      const activeDeals = deals.filter((d: any) => {
        const s = dealStages.find((x: any) => x.id === d.stage);
        return !s?.is_final;
      });

      // Conversion: for each non-final stage, % of deals that *passed through* it
      // and are now in a later (or won) stage. Uses stage_history JSON when available.
      const stageOrder = new Map<string, number>();
      dealStages.forEach((s: any) => stageOrder.set(s.id, Number(s.position || 0)));
      const wonStageIds = new Set(dealStages.filter((s: any) => s.is_won).map((s: any) => s.id));

      const conversionByStage = dealStages
        .filter((s: any) => !s.is_final)
        .map((stage: any) => {
          const stagePos = Number(stage.position || 0);
          // Deals that ever entered this stage (via history if present, else current+later)
          let entered = 0;
          let advanced = 0;
          let lost = 0;
          deals.forEach((d: any) => {
            const history = parseHistory(d.stage_history);
            const passedThrough = history.some((h: any) => h.stage_id === stage.id) ||
              d.stage === stage.id ||
              (stageOrder.get(d.stage) ?? -1) > stagePos ||
              wonStageIds.has(d.stage);
            if (!passedThrough) return;
            entered++;
            const currentPos = stageOrder.get(d.stage) ?? -1;
            const isWon = wonStageIds.has(d.stage);
            const isLost = !!dealStages.find((x: any) => x.id === d.stage && x.is_final && !x.is_won);
            if (isLost && !history.some((h: any) => (stageOrder.get(h.stage_id) ?? -1) > stagePos)) lost++;
            if (currentPos > stagePos || isWon) advanced++;
          });
          const rate = entered > 0 ? Math.round((advanced / entered) * 100) : null;
          return { stage_id: stage.id, stage_name: stage.name, entered, advanced, lost, conversion_rate: rate };
        });

      // Hot deals (top 5 by value among active, prefer hot temperature)
      const hotDeals = activeDeals
        .map((d: any) => ({
          id: d.id,
          title: d.title || 'Negócio',
          client_name: d.client_id ? clientNameById.get(d.client_id) || null : null,
          value: Number(d.value) || 0,
          stage_id: d.stage,
          stage_name: dealStages.find((s: any) => s.id === d.stage)?.name || '',
          temperature: d.temperature || 'cold',
          stage_entered_at: d.current_stage_entered_at || d.stage_entered_at || d.updated_at,
        }))
        .sort((a: any, b: any) => {
          const tempOrder = { hot: 0, warm: 1, cold: 2 } as any;
          const t = (tempOrder[a.temperature] ?? 3) - (tempOrder[b.temperature] ?? 3);
          if (t !== 0) return t;
          return b.value - a.value;
        })
        .slice(0, 5);

      // ── OPPORTUNITIES (internal) ───────────────────────────────────────────
      const oppList = opportunities.map((o: any) => ({
        id: o.id,
        client_id: o.client_id,
        client_name: (o.clients as any)?.name || null,
        title: o.title,
        suggested_date: o.suggested_date,
        priority: getPriority(o.suggested_date),
      }));
      const opportunitiesData = {
        total: oppList.length,
        // getPriority -> 'urgent' (passou data) | 'active' (próximos dias) | 'future' (>15 dias)
        urgent: oppList.filter((o: any) => o.priority === 'urgent').length,
        active: oppList.filter((o: any) => o.priority === 'active').length,
        future: oppList.filter((o: any) => o.priority === 'future').length,
        list: oppList.slice(0, 8),
      };

      // ── FINANCE ────────────────────────────────────────────────────────────
      const revenueThisMonth = sumPaymentsBetween(periodStart, periodEnd);
      const revenueLastMonth = sumPaymentsBetween(previousStart, previousEnd);
      const futureRevenue = jobs
        .filter((j: any) => j.job_date >= todayStr && j.job_date <= futureLimit && j.status !== 'cancelled')
        .reduce((acc: number, j: any) => {
          const total = Number(j.amount) || 0;
          const paid = amountPaidByJob.get(j.id) || 0;
          return acc + Math.max(total - paid, 0);
        }, 0);

      const dailyRevenue: Array<{ date: string; total: number }> = [];
      const chartDays = Math.min(periodDays, 370);
      const chartStart = periodDays > chartDays ? addDaysOnly(periodEnd, -(chartDays - 1)) : periodStart;
      for (let i = 0; i < chartDays; i++) {
        const d = addDaysOnly(chartStart, i);
        dailyRevenue.push({ date: d, total: paymentsByDate.get(d) || 0 });
      }

      // ── ATTENTION counter (top KPI) ────────────────────────────────────────
      const attention =
        lateJobs.length +
        awaitingContractFutureOnly.length +
        awaitingSelection.length;

      const trim = (j: any) => ({
        id: j.id,
        client_name: j.client_name,
        job_type: j.job_type,
        job_date: j.job_date,
        job_time: j.job_time,
        amount: j.amount,
        production_stage: j.production_stage,
      });

      res.json({
        period: {
          start_date: periodStart,
          end_date: periodEnd,
          previous_start_date: previousStart,
          previous_end_date: previousEnd,
          days: periodDays,
        },
        attention,
        jobs: {
          today: { count: todayJobs.length, list: todayJobs.map(trim) },
          next7Days: { count: next7Jobs.length, list: next7Jobs.slice(0, 6).map(trim) },
          thisMonth: {
            total: jobsThisMonth.length,
            completed: completedThisMonth.length,
            scheduled: scheduledThisMonth.length,
            cancelled: jobsThisMonth.filter((j: any) => j.status === 'cancelled').length,
          },
          late: { count: lateJobs.length, list: lateJobs.slice(0, 5).map(trim) },
          awaitingContract: {
            count: awaitingContractFutureOnly.length,
            list: awaitingContractFutureOnly.slice(0, 5).map(trim),
          },
          awaitingSelection: { count: awaitingSelection.length, list: awaitingSelection.slice(0, 5).map(trim) },
        },
        sales: {
          activeCount: activeDeals.length,
          activeValue: activeDeals.reduce((acc: number, d: any) => acc + (Number(d.value) || 0), 0),
          byStage: dealsByStage,
          conversion: conversionByStage,
          hotDeals,
        },
        production: { processes: productionByProcess },
        opportunities: opportunitiesData,
        finance: {
          revenueThisMonth,
          revenueLastMonth,
          futureRevenue,
          dailyRevenue,
        },
      });
    } catch (err: any) {
      console.error('[dashboard/analytics] error:', err);
      res.status(500).json({ error: err?.message || 'Falha ao calcular analytics' });
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

  // Error handler global — registra no Sentry se configurado
  app.use(async (err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('[express-error]', err);
    const Sentry = await sentryReady;
    if (Sentry?.captureException) Sentry.captureException(err);
    if (res.headersSent) return;
    res.status(500).json({ error: err?.message || 'Erro interno' });
  });

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });

  // Crashes que escapam — também vão pro Sentry
  process.on('unhandledRejection', async (reason) => {
    console.error('[unhandledRejection]', reason);
    const Sentry = await sentryReady;
    if (Sentry?.captureException) Sentry.captureException(reason);
  });
  process.on('uncaughtException', async (err) => {
    console.error('[uncaughtException]', err);
    const Sentry = await sentryReady;
    if (Sentry?.captureException) Sentry.captureException(err);
  });

  startFollowUpWorker();

  // ── Baileys: upload de mídia para Supabase Storage ───────────────────────
  const WA_MEDIA_BUCKET = 'wa-media';
  let waBucketEnsured = false;

  async function ensureWaMediaBucket() {
    if (waBucketEnsured || !supabaseAdmin) return;
    try {
      const { data: buckets } = await supabaseAdmin.storage.listBuckets();
      const exists = (buckets || []).some((b: any) => b.name === WA_MEDIA_BUCKET);
      if (!exists) {
        await supabaseAdmin.storage.createBucket(WA_MEDIA_BUCKET, { public: true, fileSizeLimit: 52428800 }); // 50MB
        console.log(`[Baileys] Bucket '${WA_MEDIA_BUCKET}' criado.`);
      }
      waBucketEnsured = true;
    } catch (e: any) {
      console.error('[Baileys] Erro ao verificar/criar bucket de mídia:', e?.message);
    }
  }

  async function uploadWaMedia(userId: string, buffer: Buffer, mimetype: string): Promise<string | null> {
    if (!supabaseAdmin) return null;
    await ensureWaMediaBucket();
    try {
      const ext = mimetype.split('/')[1]?.split(';')[0] || 'bin';
      const filename = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const { error } = await supabaseAdmin.storage.from(WA_MEDIA_BUCKET).upload(filename, buffer, {
        contentType: mimetype,
        upsert: false,
      });
      if (error) {
        console.error('[Baileys] Erro ao fazer upload de mídia:', error.message);
        return null;
      }
      const { data } = supabaseAdmin.storage.from(WA_MEDIA_BUCKET).getPublicUrl(filename);
      return data?.publicUrl ?? null;
    } catch (e: any) {
      console.error('[Baileys] Exceção ao fazer upload de mídia:', e?.message);
      return null;
    }
  }

  // ── Baileys: lista de conversas ao conectar ──────────────────────────────
  // Ao conectar: vincula conversas/mensagens sem wa_number ao número atual
  BaileysManager.setConnectHandler(async (userId, phone) => {
    if (!supabaseAdmin) return;
    console.log(`[Baileys] Vinculando histórico ao número ${phone} para ${userId}`);
    // Corrige QUALQUER wa_number diferente do número atual (inclui '' e valores corrompidos como "55438841668246")
    const { error: eConv } = await supabaseAdmin
      .from('wa_conversations')
      .update({ wa_number: phone })
      .eq('user_id', userId)
      .neq('wa_number', phone);
    const { error: eMsg } = await supabaseAdmin
      .from('wa_messages')
      .update({ wa_number: phone })
      .eq('user_id', userId)
      .neq('wa_number', phone);
    if (eConv) console.error('[Baileys] Erro ao migrar conversas:', eConv.message);
    if (eMsg) console.error('[Baileys] Erro ao migrar mensagens:', eMsg.message);
    if (!eConv && !eMsg) console.log(`[Baileys] ✅ Histórico vinculado ao número ${phone}`);
  });

  BaileysManager.setChatsSetHandler(async (userId, chats) => {
    if (!supabaseAdmin) { console.warn('[Baileys] setChatsSetHandler: supabaseAdmin não disponível'); return; }
    const waNumber = BaileysManager.getConnectedPhone(userId) || '';
    // Filtra apenas conversas individuais (não grupos)
    const individual = chats.filter((c: any) =>
      typeof c.id === 'string' && c.id.endsWith('@s.whatsapp.net')
    );
    console.log(`[Baileys] ChatsSet: ${individual.length} individuais / ${chats.length} total | userId=${userId} | waNumber=${waNumber}`);
    let saved = 0, errors = 0;
    for (const chat of individual) {
      try {
        const phone = normalizeBrazilianPhone((chat.id as string).replace('@s.whatsapp.net', ''));
        const rawTs = (chat as any).conversationTimestamp ?? (chat as any).lastMsgTimestamp;
        const ts = rawTs
          ? new Date(Number(rawTs) * 1000).toISOString()
          : new Date().toISOString();
        const name: string | null = (chat as any).name || (chat as any).displayName || null;
        const chatPayload: Record<string, any> = {
          user_id: userId, phone,
          last_message_at: ts,
          unread_count: Number((chat as any).unreadCount) || 0,
          wa_number: waNumber,
          ...(name ? { contact_name: name } : {}),
        };
        const { data: existingChat } = await supabaseAdmin
          .from('wa_conversations').select('id').eq('user_id', userId).eq('phone', phone).maybeSingle();
        const { error } = existingChat
          ? await supabaseAdmin.from('wa_conversations').update(chatPayload).eq('user_id', userId).eq('phone', phone)
          : await supabaseAdmin.from('wa_conversations').insert(chatPayload);
        if (error) {
          console.error(`[Baileys] ChatsSet erro ${phone}:`, error.message, error.code);
          errors++;
        } else {
          saved++;
        }
      } catch (e: any) {
        console.error(`[Baileys] ChatsSet exceção:`, e?.message);
        errors++;
      }
    }
    console.log(`[Baileys] ChatsSet: ✅ ${saved} salvas, ${errors} erros`);
  });

  // ── Baileys: handler de mensagens ────────────────────────────────────────
  BaileysManager.setMessageHandler(async (userId, msg, sock, isHistory = false) => {
    if (!supabaseAdmin) { console.warn('[Baileys] MessageHandler: supabaseAdmin não disponível'); return; }
    const rawRemoteJid = msg.key.remoteJid || '';
    // WhatsApp @lid addressing: remoteJid vem como "12345@lid" — usar remoteJidAlt que tem o JID padrão
    const remoteJid = rawRemoteJid.endsWith('@lid')
      ? ((msg.key as any).remoteJidAlt || rawRemoteJid)
      : rawRemoteJid;
    if (!remoteJid.endsWith('@s.whatsapp.net')) return; // ignora grupos e status
    // Nota: NÃO ignoramos fromMe em tempo real — pode ser mensagem enviada do celular físico.
    // O insert em wa_messages usa message_id único, então duplicatas do app são tratadas via erro ignorado.

    const waNumber = BaileysManager.getConnectedPhone(userId) || '';
    const rawPhone = remoteJid.replace('@s.whatsapp.net', '');
    // JID do WhatsApp é autoritativo — normalizeBrazilianPhone adiciona "9" extra em números
    // que já têm 9 (ex: 554399093114 → 5543999093114), corrompendo o destinatário
    const phone = rawPhone;
    const msgId = msg.key.id || `baileys-${Date.now()}`;
    const ts = msg.messageTimestamp
      ? new Date(Number(msg.messageTimestamp) * 1000).toISOString()
      : new Date().toISOString();

    // Tipo e conteúdo
    const msgContent = msg.message || {};
    const firstKey = Object.keys(msgContent)[0] || '';
    let msgType = 'text';
    let msgBody = '';
    let mediaDataUrl: string | null = null;

    if (firstKey === 'conversation' || firstKey === 'extendedTextMessage') {
      msgType = 'text';
      msgBody = (msgContent as any).conversation || (msgContent as any).extendedTextMessage?.text || '';
    } else if (firstKey === 'imageMessage') {
      msgType = 'image';
      msgBody = (msgContent as any).imageMessage?.caption || '';
      if (!isHistory) {
        const media = await BaileysManager.downloadIncomingMedia(msg, sock);
        if (media) mediaDataUrl = await uploadWaMedia(userId, media.buffer, media.mimetype);
      }
    } else if (firstKey === 'audioMessage' || firstKey === 'pttMessage') {
      msgType = 'audio';
      if (!isHistory) {
        const media = await BaileysManager.downloadIncomingMedia(msg, sock);
        if (media) mediaDataUrl = await uploadWaMedia(userId, media.buffer, media.mimetype);
      }
    } else if (firstKey === 'videoMessage') {
      msgType = 'video';
      msgBody = (msgContent as any).videoMessage?.caption || '';
      if (!isHistory) {
        const media = await BaileysManager.downloadIncomingMedia(msg, sock);
        if (media) mediaDataUrl = await uploadWaMedia(userId, media.buffer, media.mimetype);
      }
    } else if (firstKey === 'documentMessage') {
      msgType = 'document';
      msgBody = (msgContent as any).documentMessage?.title || (msgContent as any).documentMessage?.fileName || '';
      if (!isHistory) {
        const media = await BaileysManager.downloadIncomingMedia(msg, sock);
        if (media) mediaDataUrl = await uploadWaMedia(userId, media.buffer, media.mimetype);
      }
    } else {
      // ignora reactions, stickers, protocolMessages etc.
      if (!isHistory) console.log(`[Baileys] Msg ignorada | tipo=${firstKey} | jid=${remoteJid}`);
      return;
    }

    if (!isHistory) {
      console.log(`[Baileys] MSG RECEBIDA | phone=${phone} | tipo=${msgType} | fromMe=${msg.key.fromMe} | userId=${userId}`);
    }

    // Salva mensagem (ignora duplicatas via message_id)
    const { error: msgSaveErr } = await supabaseAdmin.from('wa_messages').insert({
      user_id: userId, phone, wa_number: waNumber, message_id: msgId,
      body: msgBody, from_me: !!msg.key.fromMe, timestamp: ts,
      type: msgType, status: msg.key.fromMe ? 'sent' : 'received',
      ...(mediaDataUrl ? { media_url: mediaDataUrl } : {}),
    });
    if (msgSaveErr) {
      if (!msgSaveErr.message.includes('duplicate') && !msgSaveErr.code?.includes('23505')) {
        console.error('[Baileys] Erro ao salvar mensagem:', msgSaveErr.message, msgSaveErr.code);
      }
    }

    // Salva/atualiza conversa — UPDATE primeiro, INSERT se nenhuma linha foi atualizada
    const contactName = msg.pushName || null;
    const now = new Date().toISOString();
    const lastMsgPreview = msgType === 'audio'
      ? '🎤 Mensagem de voz'
      : msgType === 'image' ? '📷 Foto'
      : msgType === 'video' ? '🎥 Vídeo'
      : msgType === 'document' ? '📄 Documento'
      : msgType === 'sticker' ? '💟 Figurinha'
      : msgBody || `[${msgType}]`;
    const convPayload: Record<string, any> = {
      user_id: userId, phone, wa_number: waNumber,
      last_message: lastMsgPreview,
      last_message_at: ts,
      updated_at: now,
      ...(!isHistory ? { unread_count: msg.key.fromMe ? 0 : 1 } : {}),
      ...(contactName ? { contact_name: contactName } : {}),
    };

    try {
      // UPDATE primeiro — tenta os dois formatos: JID exato (12 dig) e versão normalizada (13 dig)
      // NOTA: não incluir 'phone' nem 'user_id' no update para não conflitar com a unique constraint
      const normalizedPhone = normalizeBrazilianPhone(rawPhone);
      const phoneFilter = normalizedPhone !== rawPhone
        ? `phone.eq.${rawPhone},phone.eq.${normalizedPhone}`
        : `phone.eq.${rawPhone}`;
      const { phone: _ph, user_id: _ui, ...updateFields } = convPayload;
      const { data: updated, error: updateErr } = await supabaseAdmin
        .from('wa_conversations')
        .update(updateFields)
        .eq('user_id', userId)
        .or(phoneFilter)
        .select('id');

      if (updateErr) {
        console.error('[Baileys] Erro no UPDATE de conversa:', updateErr.message, updateErr.code);
      } else if (!updated || updated.length === 0) {
        // Nenhuma linha existia → INSERT
        const { error: insertErr } = await supabaseAdmin
          .from('wa_conversations')
          .insert(convPayload);

        if (insertErr) {
          console.error('[Baileys] Erro no INSERT de conversa:', insertErr.message, insertErr.code);
          // Último recurso: tenta sem wa_number (coluna pode não existir)
          if (insertErr.message.includes('wa_number') || insertErr.code === '42703') {
            const { wa_number: _drop, ...payloadSemWaN } = convPayload;
            const { error: e2 } = await supabaseAdmin.from('wa_conversations').insert(payloadSemWaN);
            if (e2) console.error('[Baileys] INSERT sem wa_number falhou:', e2.message);
            else if (!isHistory) console.log(`[Baileys] ✅ Conversa criada (sem wa_number) | phone=${phone}`);
          }
        } else {
          if (!isHistory) console.log(`[Baileys] ✅ Conversa CRIADA | phone=${phone}`);
        }
      } else {
        if (!isHistory) console.log(`[Baileys] ✅ Conversa ATUALIZADA | phone=${phone} | msg="${msgBody.slice(0, 40)}"`);
      }
    } catch (convEx: any) {
      console.error('[Baileys] Exceção ao salvar conversa:', convEx?.message);
    }

    // Auto-cria lead apenas para mensagens novas recebidas
    if (!isHistory && !msg.key.fromMe) {
      // Tenta com vários formatos para não criar lead duplicado
      const phoneShort = phone.startsWith('55') ? phone.slice(2) : phone; // sem código do país
      const phoneOld = phone.length === 13 && phone.startsWith('55')     // formato antigo sem o 9
        ? phone.slice(0, 4) + phone.slice(5)
        : null;
      const orFilter = [phone, phoneShort, phoneOld].filter(Boolean).map(p => `contact_phone.eq.${p}`).join(',');
      const { data: existing } = await supabaseAdmin.from('deals').select('id, contact_name')
        .eq('user_id', userId)
        .or(orFilter)
        .limit(1);

      if (!existing || existing.length === 0) {
        const { data: stages } = await supabaseAdmin.from('deal_stages').select('id, name, position')
          .eq('user_id', userId).not('id', 'like', 'prod-%').eq('is_final', false)
          .order('position', { ascending: true }).limit(1);
        if (stages?.length) {
          const now = new Date().toISOString();
          await supabaseAdmin.from('deals').insert({
            user_id: userId, title: contactName || phone,
            contact_name: contactName, contact_phone: phone,
            stage: stages[0].id, value: 0,
            created_at: now, updated_at: now, current_stage_entered_at: now,
            stage_history: JSON.stringify([{ stage_id: stages[0].id, stage_name: stages[0].name, entered_at: now, left_at: null }]),
          });
          console.log(`[Baileys] Lead auto-criado: ${contactName || phone}`);
        }
      } else if (contactName && existing[0] && !existing[0].contact_name) {
        await supabaseAdmin.from('deals').update({ contact_name: contactName, title: contactName })
          .eq('id', existing[0].id).eq('user_id', userId);
      }
    }

    if (!isHistory) {
      console.log(`[Baileys] ✅ msg ${msg.key.fromMe ? 'enviada' : 'recebida'} | ${msgType} | ${phone} | ${contactName || 'sem nome'}`);
    }
  });

  // Restaura sessões existentes (arquivos de credenciais salvas)
  // Restaura sessões salvas em disco (handler já foi registrado acima via setMessageHandler)
  BaileysManager.restoreAllSessions()
    .then(n => { if (n > 0) console.log(`[Baileys] ${n} sessão(ões) restaurada(s)`); })
    .catch(() => {});
}

// ─── Helpers de janela 24h e templates do WhatsApp ──────────────────────────

// Retorna true se o contato mandou mensagem nas últimas 24h (janela de
// atendimento do WhatsApp, onde texto livre é permitido).
async function isWithin24hWindow(db: SupabaseClient, userId: string, phone: string): Promise<boolean> {
  try {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data } = await db
      .from('wa_messages')
      .select('timestamp')
      .eq('user_id', userId)
      .eq('phone', phone)
      .eq('from_me', false)
      .gte('timestamp', cutoff)
      .order('timestamp', { ascending: false })
      .limit(1);
    return !!(data && data.length > 0);
  } catch {
    return false; // na dúvida, trata como fora da janela (mais seguro)
  }
}

// Conta variáveis {{N}} no corpo do template
function countTemplateVarsServer(body: string): number {
  const matches = (body || '').match(/\{\{(\d+)\}\}/g) || [];
  const nums = matches.map(m => Number(m.replace(/\D/g, '')));
  return nums.length ? Math.max(...nums) : 0;
}

// Monta o objeto `template` da Graph API a partir de uma linha de
// whatsapp_message_templates + os valores das variáveis.
function buildTemplateMessagePayload(tpl: any, params: string[]): any {
  const varCount = countTemplateVarsServer(tpl.body_text);
  const components: any[] = [];
  if (varCount > 0) {
    components.push({
      type: 'body',
      parameters: params.slice(0, varCount).map(p => ({ type: 'text', text: String(p ?? '') })),
    });
  }
  return {
    name: tpl.name,
    language: { code: tpl.language || 'pt_BR' },
    ...(components.length ? { components } : {}),
  };
}

// ─── Worker de follow-ups automáticos ────────────────────────────────────────
function startFollowUpWorker() {
  if (!supabaseAdmin) {
    console.warn('[FollowUp Worker] supabaseAdmin não disponível — worker desativado');
    return;
  }
  console.log('[FollowUp Worker] iniciado — verificando a cada 60s');

  setInterval(async () => {
    try {
      const now = new Date().toISOString();

      // Busca até 20 tarefas pendentes com scheduled_at passado
      const { data: tasks } = await supabaseAdmin!
        .from('scheduled_followups')
        .select('*')
        .eq('status', 'pending')
        .lte('scheduled_at', now)
        .limit(20);

      if (!tasks || tasks.length === 0) return;

      for (const task of tasks) {
        // Marca como 'processing' para evitar duplo envio
        const { data: claimed } = await supabaseAdmin!
          .from('scheduled_followups')
          .update({ status: 'processing' })
          .eq('id', task.id)
          .eq('status', 'pending')
          .select('id');

        if (!claimed || claimed.length === 0) continue; // outro worker pegou

        let sent = false;
        const instanceName = `user_${task.user_id.replace(/-/g, '_')}`;

        try {
          // 1ª: Evolution API
          if (WHATSAPP_PROVIDER === 'evolution' && EVOLUTION_API_URL && EVOLUTION_API_KEY) {
            const evoRes = await fetch(`${EVOLUTION_API_URL}/message/sendText/${instanceName}`, {
              method: 'POST',
              headers: { 'apikey': EVOLUTION_API_KEY, 'Content-Type': 'application/json' },
              body: JSON.stringify({ number: task.phone, textMessage: { text: task.message } }),
            });
            sent = evoRes.ok;
          }

          // 2ª: Meta API — com detecção da janela de 24h
          if (!sent) {
            const { data: waAccount } = await supabaseAdmin!
              .from('whatsapp_business_accounts')
              .select('phone_number_id, access_token')
              .eq('user_id', task.user_id)
              .maybeSingle();

            if (waAccount?.phone_number_id && waAccount?.access_token) {
              const within24h = await isWithin24hWindow(supabaseAdmin!, task.user_id, task.phone);
              let messageBody: any;

              if (within24h) {
                // Dentro da janela: texto livre (comportamento de sempre)
                messageBody = { messaging_product: 'whatsapp', to: task.phone, type: 'text', text: { body: task.message } };
              } else {
                // Fora da janela: o Meta exige template aprovado.
                // Busca o template configurado na etapa do funil.
                const { data: stage } = await supabaseAdmin!
                  .from('deal_stages')
                  .select('follow_up_template_id')
                  .eq('id', task.stage_id)
                  .eq('user_id', task.user_id)
                  .maybeSingle();

                let tpl: any = null;
                if (stage?.follow_up_template_id) {
                  const { data: t } = await supabaseAdmin!
                    .from('whatsapp_message_templates')
                    .select('*')
                    .eq('id', stage.follow_up_template_id)
                    .eq('user_id', task.user_id)
                    .maybeSingle();
                  if (t && t.status === 'APPROVED') tpl = t;
                }

                if (!tpl) {
                  // Sem template aprovado configurado — não dá pra enviar legalmente.
                  console.warn(`[FollowUp Worker] ⏭️  ${task.phone} fora da janela 24h e etapa ${task.stage_id} sem template aprovado — pulado`);
                  await supabaseAdmin!
                    .from('scheduled_followups')
                    .update({ status: 'skipped_no_template' })
                    .eq('id', task.id);
                  continue;
                }

                const params = [task.contact_name || ''];
                messageBody = {
                  messaging_product: 'whatsapp', to: task.phone,
                  type: 'template', template: buildTemplateMessagePayload(tpl, params),
                };
              }

              const metaRes = await fetch(
                `https://graph.facebook.com/v21.0/${waAccount.phone_number_id}/messages`,
                {
                  method: 'POST',
                  headers: { 'Authorization': `Bearer ${waAccount.access_token}`, 'Content-Type': 'application/json' },
                  body: JSON.stringify(messageBody),
                }
              );
              const metaData = await metaRes.json();
              sent = metaRes.ok && !metaData.error;
              if (!sent) {
                console.warn(`[FollowUp Worker] Meta recusou ${task.phone}:`, metaData?.error?.message || JSON.stringify(metaData));
              }
            }
          }

          const sentAt = new Date().toISOString();
          await supabaseAdmin!
            .from('scheduled_followups')
            .update({ status: sent ? 'sent' : 'failed', sent_at: sent ? sentAt : null })
            .eq('id', task.id);

          if (sent) {
            const msgId = `auto-${Date.now()}-${task.phone}`;
            await supabaseAdmin!.from('wa_messages').insert({
              user_id: task.user_id, phone: task.phone, body: task.message,
              from_me: true, timestamp: sentAt, type: 'text', status: 'sent', message_id: msgId,
            });
            const fuConvPayload = { user_id: task.user_id, phone: task.phone, last_message: task.message, last_message_at: sentAt, updated_at: sentAt };
            const { data: fuUpd } = await supabaseAdmin!.from('wa_conversations').update(fuConvPayload).eq('user_id', task.user_id).eq('phone', task.phone).select('id');
            if (!fuUpd || fuUpd.length === 0) { await supabaseAdmin!.from('wa_conversations').insert(fuConvPayload); }
            console.log(`[FollowUp Worker] ✅ ${task.phone} (deal ${task.deal_id}) — etapa ${task.stage_id}`);
          } else {
            console.warn(`[FollowUp Worker] ❌ Falha para ${task.phone} (deal ${task.deal_id})`);
          }
        } catch (err: any) {
          console.error(`[FollowUp Worker] Erro:`, err.message);
          await supabaseAdmin!.from('scheduled_followups').update({ status: 'failed' }).eq('id', task.id);
        }
      }
    } catch (err: any) {
      console.error('[FollowUp Worker] Erro geral:', err.message);
    }
  }, 60 * 1000);
}

// ─── Worker: sincroniza mensagens da Evolution API periodicamente ────────────
async function syncEvolutionMessages() {
  if (!supabaseAdmin || !EVOLUTION_API_URL || !EVOLUTION_API_KEY) {
    console.warn('[EvolutionSync] Abortando: supabaseAdmin ou variáveis de ambiente ausentes');
    return;
  }

  try {
    const { data: convs } = await supabaseAdmin
      .from('wa_conversations')
      .select('user_id, phone')
      .order('last_message_at', { ascending: false })
      .limit(200);

    if (!convs || convs.length === 0) {
      console.log('[EvolutionSync] Nenhuma conversa no DB para sincronizar');
      return;
    }

    const byUser = new Map<string, string[]>();
    for (const c of convs) {
      const phones = byUser.get(c.user_id) || [];
      if (!phones.includes(c.phone)) phones.push(c.phone);
      byUser.set(c.user_id, phones);
    }

    for (const [userId, phones] of byUser.entries()) {
      const instanceName = `user_${userId.replace(/-/g, '_')}`;

      // Usa o endpoint correto de status
      let isConnected = false;
      try {
        const statusRes = await fetch(`${EVOLUTION_API_URL}/instance/connectionState/${instanceName}`, {
          headers: { 'apikey': EVOLUTION_API_KEY },
        });
        const statusData = statusRes.ok ? await statusRes.json() : null;
        const state = normalizeWhatsappState(statusData);
        isConnected = state === 'open';
        console.log(`[EvolutionSync] Instância ${instanceName}: status=${state}`);
      } catch (e: any) {
        console.warn(`[EvolutionSync] Falha ao checar status de ${instanceName}:`, e.message);
        continue;
      }

      if (!isConnected) {
        console.log(`[EvolutionSync] ${instanceName} não está conectado, pulando`);
        continue;
      }

      for (const phone of phones.slice(0, 10)) {
        try {
          const chatId = `${phone}@s.whatsapp.net`;
          const msgsRes = await fetch(`${EVOLUTION_API_URL}/chat/findMessages/${instanceName}`, {
            method: 'POST',
            headers: { 'apikey': EVOLUTION_API_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({ where: { key: { remoteJid: chatId } }, limit: 30 }),
          });

          if (!msgsRes.ok) {
            const errText = await msgsRes.text().catch(() => '');
            console.warn(`[EvolutionSync] findMessages falhou para ${phone}: ${msgsRes.status} ${errText.slice(0, 100)}`);
            continue;
          }

          const msgsData = await msgsRes.json();
          const messages: any[] = Array.isArray(msgsData?.messages?.records)
            ? msgsData.messages.records
            : Array.isArray(msgsData?.messages) ? msgsData.messages
            : Array.isArray(msgsData) ? msgsData : [];

          console.log(`[EvolutionSync] ${phone}: ${messages.length} mensagens retornadas da API`);

          let savedCount = 0;
          for (const msg of messages) {
            const msgId: string = msg?.key?.id || msg?.messageId || '';
            const fromMe: boolean = msg?.key?.fromMe ?? false;
            const timestamp: number = msg?.messageTimestamp ?? msg?.timestamp ?? 0;
            const ts = timestamp ? new Date(timestamp * 1000).toISOString() : new Date().toISOString();

            const textContent: string =
              msg?.message?.conversation ||
              msg?.message?.extendedTextMessage?.text ||
              msg?.message?.imageMessage?.caption ||
              msg?.message?.videoMessage?.caption ||
              msg?.message?.audioMessage?.caption || '';

            if (!msgId) continue;
            const body = textContent || (msg?.message ? `[${Object.keys(msg.message)[0] || 'mídia'}]` : '');
            if (!body) continue;

            const { data: existing } = await supabaseAdmin
              .from('wa_messages').select('id').eq('user_id', userId).eq('message_id', msgId).maybeSingle();
            if (existing) continue;

            const { error: insErr } = await supabaseAdmin.from('wa_messages').insert({
              user_id: userId, phone, message_id: msgId,
              body, from_me: fromMe, type: 'text', timestamp: ts,
              status: fromMe ? 'sent' : 'received', wa_number: '',
            });
            if (insErr && !insErr.code?.includes('23505')) {
              console.error(`[EvolutionSync] Erro ao salvar msg ${msgId}:`, insErr.message);
              continue;
            }
            savedCount++;

            const convPayload = { user_id: userId, phone, last_message: body, last_message_at: ts, updated_at: new Date().toISOString(), ...(!fromMe ? { unread_count: 1 } : {}) };
            const { data: upd } = await supabaseAdmin.from('wa_conversations').update(convPayload).eq('user_id', userId).eq('phone', phone).select('id');
            if (!upd || upd.length === 0) { await supabaseAdmin.from('wa_conversations').insert(convPayload); }
          }

          if (savedCount > 0) {
            console.log(`[EvolutionSync] ✅ ${savedCount} nova(s) msg salva(s) para ${phone}`);
          }
        } catch (e: any) {
          console.error(`[EvolutionSync] Erro ao processar ${phone}:`, e.message);
        }
      }
    }
  } catch (err: any) {
    console.error('[EvolutionSync] Erro geral:', err.message);
  }
}

if (WHATSAPP_PROVIDER !== 'baileys') {
  setTimeout(() => { syncEvolutionMessages(); setInterval(syncEvolutionMessages, 15_000); }, 10_000);
}

startServer();

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
import { encryptIfNeeded, decryptIfNeeded, isEncryptionConfigured } from './lib/wa-token-crypto.js';
import { signGallerySession, verifyGallerySession, isGallerySessionConfigured, type GallerySessionPayload } from './lib/gallery-session.js';
import { signAlbumSession, verifyAlbumSession, type AlbumSessionPayload } from './lib/album-session.js';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

// Não bloqueia o boot — roda em paralelo
const sentryReady = initSentry();
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseClient, supabaseAdmin } from './supabase.js';
import { getAgentReply, DEFAULT_PERSONA, DEFAULT_OBJECTIVE, DEFAULT_KNOWLEDGE, DEFAULT_RULES, DEFAULT_SALES_STRATEGY } from './ai-agent.js';
import * as plugnotas from './plugnotas.js';
import { understandMedia } from './media-understanding.js';
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
import { processGalleryPhoto } from './gallery-image.js';
import { isMailerConfigured, sendGalleryReadyEmail, sendSelectionDoneEmail, sendGalleryMessageEmail } from './gallery-mailer.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Instrução do MODO AUTÔNOMO (e do teste de fluxo na aba "Testar"). Fonte única
// usada tanto pelo atendimento autônomo quanto pelo /api/agent/test, pra o teste
// reproduzir EXATAMENTE o comportamento real (hand-off silencioso + envio do PDF).
const HANDOFF_INSTRUCTION = [
  'MODO AUTÔNOMO: você responde o cliente SOZINHA, sem revisão humana, COMO UMA PESSOA do time do estúdio — o cliente NUNCA pode perceber que é uma IA.',
  'HAND-OFF: se for FECHAR a venda, falar PREÇO/valor final, PAGAMENTO/Pix, CONFIRMAR a DATA do ensaio, OBJEÇÃO forte/reclamação, ou o cliente PEDIR uma pessoa — responda APENAS com ###HUMANO### (e nada mais), pra equipe assumir. Nunca avise que vai transferir. (Combinar um RETORNO de conversa — "te chamo amanhã/segunda" — NÃO é hand-off: faça você mesma.)',
  'ENVIAR PACOTE (PDF): quando for apresentar o pacote/orçamento do nicho que a pessoa quer, NÃO descreva em texto — comece a resposta com o token ###PDF:<nicho>### (nicho em minúsculo e sem acento: gestante, newborn, smash_the_cake, familia, casal, feminino, marca_pessoal, revelacao) e DEPOIS uma frase curta e natural de acompanhamento (ex.: "te mandei aqui as opções, dá uma olhada 🥰 qualquer dúvida me chama"). O sistema envia o PDF certo sozinho. Só use isso quando já souber o nicho.',
  'VÁRIOS BALÕES: escreva como no WhatsApp. Pra mandar em mensagens SEPARADAS, ponha uma LINHA EM BRANCO entre elas (ex.: a apresentação "…vou tomar conta do seu atendimento por aqui." vai numa mensagem e "Qual tipo de ensaio você gostaria?" vem na mensagem SEGUINTE). Quebra de linha simples fica no MESMO balão. Não exagere: 1 a 3 balões por vez.',
  'No resto, responda normal seguindo as regras, a estratégia de venda e o tom.',
].join('\n');

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
// ISOLAMENTO POR CONTA (LGPD): o cache de mensagens "ao vivo" é POR CONTA —
// a chave é `${userId}::${phone}`. NUNCA leia/itere por telefone sem o userId,
// senão vaza conversa entre contas. Use liveKey() e liveEntriesForUser().
const liveWhatsAppMessagesByPhone = new Map<string, LiveWhatsAppMessage[]>();
const readUpToTimestampByPhone = new Map<string, number>();
const qrCodeByInstance = new Map<string, string>();
const liveKey = (userId: string, phone: string) => `${userId}::${phone}`;
const liveEntriesForUser = (userId: string): Array<[string, LiveWhatsAppMessage[]]> => {
  const prefix = `${userId}::`;
  const out: Array<[string, LiveWhatsAppMessage[]]> = [];
  for (const [k, v] of liveWhatsAppMessagesByPhone.entries()) {
    if (k.startsWith(prefix)) out.push([k.slice(prefix.length), v]);
  }
  return out;
};


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

const brazilianPhoneVariants = (value: unknown): string[] => {
  const raw = normalizePhone(value);
  if (!raw) return [];

  const variants = new Set<string>();
  const add = (candidate: unknown) => {
    const clean = normalizePhone(candidate);
    if (clean) variants.add(clean);
  };

  add(raw);
  const tail = raw.startsWith('55') && raw.length >= 12 ? raw.slice(2) : raw;
  add(tail);
  add(`55${tail}`);

  if (tail.length === 10) {
    const withNine = `${tail.slice(0, 2)}9${tail.slice(2)}`;
    add(withNine);
    add(`55${withNine}`);
  }

  if (tail.length === 11 && tail[2] === '9') {
    const withoutNine = `${tail.slice(0, 2)}${tail.slice(3)}`;
    add(withoutNine);
    add(`55${withoutNine}`);
  }

  return Array.from(variants);
};

const brazilianPhonesMatch = (a: unknown, b: unknown): boolean => {
  const av = new Set(brazilianPhoneVariants(a));
  if (!av.size) return false;
  return brazilianPhoneVariants(b).some((variant) => av.has(variant));
};

const normalizeContactNameForMatch = (value: unknown): string => (
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
);

const contactNamesMatch = (expected: unknown, actual: unknown): boolean => {
  const a = normalizeContactNameForMatch(expected);
  const b = normalizeContactNameForMatch(actual);
  if (!a || !b || a.length < 3 || b.length < 3) return false;
  if (a === b) return true;
  const at = a.split(' ').filter(Boolean);
  const bt = b.split(' ').filter(Boolean);
  const [short, long] = at.length <= bt.length ? [at, bt] : [bt, at];
  const longSet = new Set(long);
  return short.every((token) => longSet.has(token)) && short.some((token) => token.length >= 3);
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
  // Sem userId não há como isolar por conta → NÃO cacheia em memória (evita
  // vazamento entre contas). Só persiste no banco (scoped por user_id) quando há.
  if (!userId) return;

  const key = liveKey(userId, message.phone);
  const existing = liveWhatsAppMessagesByPhone.get(key) || [];
  const alreadyExists = existing.some((item) => item.id === message.id);
  if (!alreadyExists) {
    existing.push(message);
    if (existing.length > LIVE_MESSAGE_CACHE_LIMIT) {
      existing.splice(0, existing.length - LIVE_MESSAGE_CACHE_LIMIT);
    }
    liveWhatsAppMessagesByPhone.set(key, existing);
  }

  persistMessageToSupabase(userId, message).catch(() => {});
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

const getLiveMessagesByPhone = (userId: string, phone: string, limit = 50) => {
  const all = liveWhatsAppMessagesByPhone.get(liveKey(userId, phone)) || [];
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

  // sendUpdates:'all' faz o Google ENVIAR o convite/atualização por e-mail pro
  // cliente (attendee). Sem isso, o attendee é adicionado mas ninguém recebe nada.
  try {
    if (job.google_event_id) {
      try {
        await calendar.events.patch({ calendarId: 'primary', eventId: job.google_event_id, requestBody: event, sendUpdates: 'all' });
      } catch (patchError: any) {
        if (patchError.message?.includes('Event type cannot be changed') || patchError.code === 404) {
          const res = await calendar.events.insert({ calendarId: 'primary', requestBody: event, sendUpdates: 'all' });
          if (res.data.id) {
            await supabase.from('jobs').update({ google_event_id: res.data.id }).eq('id', jobId);
          }
        } else {
          throw patchError;
        }
      }
    } else {
      const res = await calendar.events.insert({ calendarId: 'primary', requestBody: event, sendUpdates: 'all' });
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
      'https://crmtrilha.com.br', // domínio custom (apex)
      'https://www.crmtrilha.com.br', // domínio custom (a Vercel redireciona o apex pra cá)
      process.env.APP_URL,
      process.env.APP_PUBLIC_URL,
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

  // ── Features do plano (galeria/álbum/armazenamento) ───────────────────────
  // Lê limits do plano do tenant (cache 60s). Default-allow: só bloqueia se a
  // flag for explicitamente false — assim conta sem plano / plano antigo nunca
  // é barrada por engano.
  const planLimitsCache = new Map<string, { limits: any; at: number }>();
  const PLAN_LIMITS_TTL = 60_000;
  async function getPlanLimits(ownerUserId: string): Promise<any> {
    if (!supabaseAdmin) return {};
    const c = planLimitsCache.get(ownerUserId);
    if (c && Date.now() - c.at < PLAN_LIMITS_TTL) return c.limits;
    let limits: any = {};
    try {
      const { data: acct } = await supabaseAdmin
        .from('platform_accounts').select('plan_id').eq('owner_user_id', ownerUserId).maybeSingle();
      if (acct?.plan_id) {
        const { data: plan } = await supabaseAdmin
          .from('platform_plans').select('limits').eq('id', acct.plan_id).maybeSingle();
        limits = plan?.limits || {};
      }
    } catch { /* fail-open */ }
    planLimitsCache.set(ownerUserId, { limits, at: Date.now() });
    return limits;
  }
  // Só bloqueia quando a flag é explicitamente false.
  const planAllowsFeature = (limits: any, feature: 'gallery' | 'album'): boolean => limits?.[feature] !== false;
  const planStorageGb = (limits: any): number => Math.max(0, Number(limits?.storage_gb || 0));
  function invalidatePlanLimits(ownerUserId: string) { planLimitsCache.delete(ownerUserId); }

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
          // NÃO marca isPlatformAdmin=true: ao "ver como membro" o admin deve
          // enxergar EXATAMENTE o que o membro vê (respeita o RBAC dele, inclusive
          // ocultar financeiro do papel de produção). Pra acesso total, impersone
          // o DONO. (Antes vazava valores financeiros.)
          (req as any).isPlatformAdmin = false;
          (req as any).memberPermissions = member.permissions;
          (req as any).isMember = true;
          (req as any).supabase = supabaseAdmin;
          console.log(`[impersonate] admin=${user.id} → membro=${impersonateMemberHeader} (dono=${member.owner_user_id}) ${req.method} ${req.path}`);
          return next();
        }

        (req as any).userId = impersonateOwnerHeader;
        (req as any).realUserId = user.id;
        (req as any).isImpersonating = true;
        (req as any).isPlatformAdmin = true;
        (req as any).memberPermissions = null;
        (req as any).isMember = false;
        (req as any).supabase = supabaseAdmin;
        console.log(`[impersonate] admin=${user.id} → dono=${impersonateOwnerHeader} ${req.method} ${req.path}`);
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

  // ============ PAPEL "PRODUÇÃO RESTRITA" ============
  // Membro que só enxerga o board de Produção e NUNCA valores monetários.
  // Marcado via flag permissions.production_role (sem mudar o schema). O bloqueio
  // de valores acontece no BACKEND — a UI esconder não basta (vazaria pela rede).
  function isProductionOnly(req: express.Request): boolean {
    if (!(req as any).isMember) return false;
    if ((req as any).isPlatformAdmin) return false;
    return ((req as any).memberPermissions || {}).production_role === true;
  }
  // Bloqueia rotas que expõem/alteram valores pra esse papel.
  function denyProductionOnly(req: express.Request, res: express.Response, next: express.NextFunction) {
    if (isProductionOnly(req)) {
      return res.status(403).json({ error: 'Sem acesso a informações financeiras.', production_blocked: true });
    }
    next();
  }
  // Remove campos monetários de um job antes de enviar pro papel de produção.
  function stripJobMoney(job: any) {
    const { amount, amount_paid, payment_status, payment_method, ...rest } = job;
    return rest;
  }
  // Membro SEM permissão 'finance' (e que não é dono/admin). Mesma regra do
  // requirePermission('finance'): bloqueia só quando finance === false.
  function memberLacksFinance(req: express.Request) {
    return (req as any).isMember === true
      && (req as any).isPlatformAdmin !== true
      && (((req as any).memberPermissions || {}).finance === false);
  }
  // Zera o valor (R$) de um deal e dos seus itens — pra não vazar pela rede
  // (app/extensão) a quem não tem permissão 'finance'. O funil segue visível.
  function stripDealMoney(deal: any) {
    const items = Array.isArray(deal.items)
      ? deal.items.map((it: any) => ({ ...it, value: null, catalog_value: null }))
      : deal.items;
    return { ...deal, value: null, estimated_value: null, items };
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

  // Guard: impede resets "duros" concorrentes da mesma conta (clique repetido
  // no botão "Limpar sessão e gerar novo QR" enquanto o anterior ainda roda).
  const waFreshResetInFlight = new Set<string>();

  app.post('/api/whatsapp/instance', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    // fresh=true: ação EXPLÍCITA do usuário ("Limpar sessão e gerar novo QR").
    // Limpa as credenciais ANTES de iniciar, forçando um QR de pareamento novo.
    // Resolve o caso em que há creds registradas que não reconectam — aí o
    // Baileys tentaria "retomar" a sessão e NUNCA emitiria um QR. No fluxo
    // normal (sem fresh) NUNCA apaga credenciais — preserva a garantia da
    // da1fe0a (não re-escanear o QR em queda transitória).
    const fresh = req.body?.fresh === true;

    if (fresh && waFreshResetInFlight.has(userId)) {
      return res.status(429).json({ error: 'Já estamos limpando esta sessão. Aguarde alguns segundos.' });
    }
    if (fresh) waFreshResetInFlight.add(userId);

    try {
      if (fresh) {
        console.log(`[Baileys] Reset explícito (limpar sessão + novo QR) para ${userId}`);
        await BaileysManager.resetSession(userId);
        await new Promise(r => setTimeout(r, 600));
      }
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
    } finally {
      if (fresh) waFreshResetInFlight.delete(userId);
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
        const liveMessages = getLiveMessagesByPhone(userId, normalizedJid, limit);

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
    const messages = getLiveMessagesByPhone(userId, phone, limit);
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

        // Evolution API v2: fromMe fica em event.key.fromMe
        const fromMe = Boolean(event?.key?.fromMe ?? event?.fromMe);

        // pushName de mensagem NOSSA (fromMe) é o nome do próprio estúdio —
        // não usar como nome do contato (mesmo guard do handler do Baileys).
        const name = fromMe ? undefined : (String(
          // Evolution API v2: pushName vem no campo raiz do data
          event?.pushName ?? event?.senderName ?? event?.chatName ??
          event?.contact?.name ?? event?.name ?? ''
        ).trim() || undefined);

        const timestamp = parseWebhookTimestamp(event);
        // Evolution API v2: id fica em event.key.id
        const messageIdRaw = event?.key?.id ?? event?.messageId ?? event?.id ?? event?.messageID;
        const messageId =
          (typeof messageIdRaw === 'string' && messageIdRaw.trim())
            ? messageIdRaw.trim()
            : `${phone}-${timestamp}-${processed}`;

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
  app.get('/api/whatsapp/live-contacts', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const contacts = liveEntriesForUser(userId).map(([phone, messages]) => {
      const latest = messages[messages.length - 1];
      const readUntil = readUpToTimestampByPhone.get(liveKey(userId, phone)) ?? 0;
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
    // Desconectado (sem número ativo): NÃO esconda o histórico. O WhatsApp pode
    // cair (sem querer ou de propósito) e as conversas continuam salvas no banco —
    // mostra as conversas do usuário mesmo sem número conectado, em vez de [].
    const disconnected = !waNumber;
    if (!db) {
      const userDb = (req as any).supabase as SupabaseClient;
      let q = userDb.from('wa_conversations').select('*').eq('user_id', userId);
      if (!disconnected) q = q.eq('wa_number', waNumber);
      const { data } = await q.order('last_message_at', { ascending: false }).limit(200);
      return res.json(data || []);
    }
    try {
      let q = db
        .from('wa_conversations')
        .select('*')
        .eq('user_id', userId);
      if (!disconnected) q = q.eq('wa_number', waNumber);
      const { data, error } = await q
        .order('last_message_at', { ascending: false })
        .limit(200);

      if (error) {
        console.error('[Inbox] Erro ao buscar conversas:', error.message, error.code);
        throw error;
      }

      const rows = data || [];

      // Merge com cache em memória (conversas chegadas mas ainda não persistidas)
      const dbPhones = new Set(rows.map((c: any) => c.phone));
      const memContacts = liveEntriesForUser(userId)
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
      // Fallback: cache em memória (só desta conta)
      const contacts = liveEntriesForUser(userId).map(([phone, messages]) => {
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
    // Desconectado: NÃO esconda as mensagens (paridade com /conversations). O
    // histórico fica salvo no banco; mostra mesmo sem número conectado.
    const disconnected = !waNumber;
    const dbMsg = supabaseAdmin || supabase;
    try {
      // Busca em ambos os formatos: JID exato (12 dig) e normalizado (13 dig).
      // Quando conectado, restringe ao WhatsApp atual (wa_number).
      const phoneCondition = phone12 !== phone13
        ? `phone.eq.${phone12},phone.eq.${phone13}`
        : `phone.eq.${phone12}`;
      let msgQuery = dbMsg
        .from('wa_messages')
        .select('*')
        .eq('user_id', userId);
      if (!disconnected) msgQuery = msgQuery.eq('wa_number', waNumber);
      msgQuery = msgQuery
        .or(phoneCondition)
        .order('timestamp', { ascending: true })
        .limit(limit);

      const { data, error } = await msgQuery;

      if (error) throw error;

      // Merge com cache em memória
      const dbIds = new Set((data || []).map((m: any) => m.message_id));
      const memMessages = getLiveMessagesByPhone(userId, phone12, limit)
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
      const msgs = getLiveMessagesByPhone(userId, phone12, limit).map((m) => ({
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
    const raw = req.params.phone.replace(/\D/g, '');
    const with55 = raw.startsWith('55') ? raw : '55' + raw;
    const phone13 = normalizeBrazilianPhone(with55);
    // Variante SEM o nono dígito: conversas podem estar salvas em qualquer um
    // dos formatos (12 ou 13 dígitos). Antes o update só tentava o normalizado
    // → não achava a linha → o badge de "não lida" NUNCA sumia.
    const phone12 = phone13.length === 13 ? phone13.slice(0, 4) + phone13.slice(5) : phone13;
    const variants = [...new Set([with55, phone13, phone12])];
    variants.forEach(v => readUpToTimestampByPhone.set(liveKey(userId, v), Date.now()));
    try {
      const db = supabaseAdmin || (req as any).supabase as SupabaseClient;
      await db
        .from('wa_conversations')
        .update({ unread_count: 0, updated_at: new Date().toISOString() })
        .eq('user_id', userId)
        .in('phone', variants);
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

    const total = liveEntriesForUser(userId).length;
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
    const userId = (req as any).userId;
    const phone = req.params.phone;
    const messages = liveWhatsAppMessagesByPhone.get(liveKey(userId, phone));
    if (messages && messages.length > 0) {
      const latest = messages[messages.length - 1];
      readUpToTimestampByPhone.set(liveKey(userId, phone), latest.timestamp);
    } else {
      readUpToTimestampByPhone.set(liveKey(userId, phone), Date.now());
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

  // Papel de produção: trancado fora da Produção TAMBÉM no backend (frontend não
  // basta — vazaria via API direta). Bloqueia módulos que expõem valores/dados:
  // clientes, vendas, oportunidades, contratos. (/api/fin já cai em requirePermission('finance').)
  for (const prefix of ['/api/clients', '/api/opportunities', '/api/deals', '/api/contracts']) {
    app.use(prefix, requireAuth, denyProductionOnly);
  }

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
        // PERF: só as colunas que o front lê de client.jobs[] (ClientsPage:
        // histórico/getActivityDates/filtro por tipo; ContractsPage: .length).
        // total_invested continua somando amount; tenant isolation por user_id
        // intacto. Antes era select('*') trazendo TODO o histórico (~2700 linhas
        // x todas as colunas) por conta. NÃO fatiar (mudaria total_invested).
        .select('id, client_id, job_name, job_type, job_date, amount, status, payment_method, payment_status')
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
    // PERF: lista EXPLÍCITA das colunas que os consumidores leem (JobsPage,
    // CalendarPage, GerenciaPage, TasksPage, ProductionBoard). Remove só colunas
    // órfãs do schema (legado/galeria/álbum que vivem na tabela jobs mas ninguém
    // lê aqui). NÃO mexer no limit(10000) (board da Pitora depende), na ordem nem
    // no .eq('user_id') (isolamento por conta). client_name e amount_paid são
    // derivados no .map abaixo; clients(name) é a única relação (só expõe name).
    const { data: jobs } = await supabase
      .from('jobs')
      .select('id, client_id, job_type, job_name, job_date, job_time, job_end_time, amount, payment_status, payment_method, status, production_stage, production_stage_entered_at, position, assignee_id, labels, cover_image_url, notes, created_at, google_event_id, clients(name)')
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

    const safe = isProductionOnly(req) ? jobsFormatted.map(stripJobMoney) : jobsFormatted;
    res.json(safe);
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

  // POST /api/jobs/:id/to-production — manda um trabalho EXISTENTE pra produção,
  // achando a etapa de entrada (1ª etapa do 1º processo não-especial). Usado pra
  // "puxar" um cliente já vendido pra produção sem registrar nova venda.
  app.post('/api/jobs/:id/to-production', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { data: procs } = await supabase
      .from('production_processes').select('id, position, is_special').eq('user_id', userId);
    const firstProc = (procs || [])
      .filter((p: any) => !p.is_special)
      .sort((a: any, b: any) => (a.position || 0) - (b.position || 0))[0];
    if (!firstProc) {
      return res.status(400).json({ error: 'Configure ao menos um processo de produção com uma etapa.' });
    }
    const { data: stgs } = await supabase
      .from('deal_stages').select('id, position').eq('user_id', userId)
      .eq('process_id', firstProc.id).order('position', { ascending: true }).limit(1);
    const entryStageId = stgs?.[0]?.id;
    if (!entryStageId) {
      return res.status(400).json({ error: 'O primeiro processo de produção não tem etapas.' });
    }
    const { error } = await supabase.from('jobs')
      .update({ production_stage: entryStageId, production_stage_entered_at: new Date().toISOString() })
      .eq('id', req.params.id).eq('user_id', userId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true, production_stage: entryStageId });
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
    // Papel de produção NUNCA grava valores (mesmo que o front mande).
    const prodOnly = isProductionOnly(req);
    if (amount !== undefined && !prodOnly) updatePayload.amount = amount;
    if (payment_method !== undefined && !prodOnly) updatePayload.payment_method = payment_method;
    if (payment_status !== undefined && !prodOnly) updatePayload.payment_status = payment_status;
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

    // Galeria de proofing: job entrou em etapa final de produção → cria galeria
    // draft automaticamente. Best-effort: falha aqui NUNCA quebra o PUT.
    if (production_stage !== undefined && production_stage !== oldJob.production_stage) {
      maybeCreateGalleryForJob(supabase, userId, Number(req.params.id), production_stage)
        .catch((e: any) => console.warn('[galeria] gancho job→galeria falhou:', e?.message));
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

      // Se este ensaio era a conversão de uma venda, tira o deal do "ganho" pra
      // NÃO virar venda fantasma (deal ganho apontando pra ensaio que não existe).
      // Estava ganho → vai pra perdido (igual ao "Cancelar venda"); senão só
      // desfaz o vínculo. Assim a venda cancelada some de tudo (dashboard, etc.).
      const jobIdNum = Number(req.params.id);
      if (!Number.isNaN(jobIdNum)) {
        const { data: linkedDeals } = await supabase
          .from('deals')
          .select('id, stage, stage_history')
          .eq('user_id', userId)
          .eq('converted_job_id', jobIdNum);
        if (linkedDeals && linkedDeals.length) {
          const stages = await ensurePipelineStages(supabase, userId);
          const wonIds = new Set(stages.filter((s: any) => s.is_won).map((s: any) => s.id));
          const lostStage =
            stages.find((s: any) => s.id === 'lost') ||
            stages.find((s: any) => s.is_final && !s.is_won) ||
            DEFAULT_STAGES.find((s: any) => s.id === 'lost');
          const nowIso = new Date().toISOString();
          for (const d of linkedDeals) {
            const upd: any = { converted: false, converted_at: null, converted_job_id: null };
            if (wonIds.has(d.stage) && lostStage) {
              upd.stage = lostStage.id;
              upd.stage_entered_at = nowIso;
              upd.current_stage_entered_at = nowIso;
              upd.stage_history = appendStageHistory(d.stage_history, lostStage.id, lostStage.name, nowIso);
              upd.lost_reason = 'Ensaio apagado';
            }
            await supabase.from('deals').update(upd).eq('id', d.id).eq('user_id', userId);
          }
        }
      }

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
  app.get('/api/jobs/:id/financeiro', requireAuth, denyProductionOnly, async (req, res) => {
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
  app.put('/api/jobs/:id/package', requireAuth, denyProductionOnly, async (req, res) => {
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
  app.post('/api/jobs/:id/payments', requireAuth, denyProductionOnly, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const adminClient = supabaseAdmin || supabase;
    const jobId = Number(req.params.id);

    const { data: job } = await supabase.from('jobs').select('id, amount').eq('id', jobId).eq('user_id', userId).single();
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const { amount, description, payment_date, payment_method, discount } = req.body;
    const discountVal = Math.max(0, Number(discount) || 0);
    const amountVal = Math.max(0, Number(amount) || 0);
    // Pagamento e desconto podem vir juntos ou separados (ex: quitar só com desconto)
    if (amountVal <= 0 && discountVal <= 0) {
      return res.status(400).json({ error: 'Informe um valor de pagamento e/ou desconto' });
    }

    // Desconto abate do VALOR TOTAL do job (não é "dinheiro recebido" — não
    // infla receita). Fica registrado na descrição do pagamento.
    const newAmount = discountVal > 0 ? Math.max(0, (Number(job.amount) || 0) - discountVal) : (Number(job.amount) || 0);
    const descParts = [
      description || null,
      discountVal > 0 ? `Desconto de R$ ${discountVal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} aplicado` : null,
    ].filter(Boolean);

    let payment: any = null;
    if (amountVal > 0) {
      const ins = await adminClient.from('job_payments').insert({
        job_id: jobId,
        amount: amountVal,
        description: descParts.join(' · ') || null,
        payment_date: payment_date || new Date().toISOString().slice(0, 10),
        payment_method: payment_method || 'Pix',
      }).select().single();
      if (ins.error) return res.status(500).json({ error: ins.error.message });
      payment = ins.data;
    }

    // Recalcula total pago e atualiza payment_status (contra o total já com desconto)
    const { data: allPayments } = await adminClient.from('job_payments').select('amount').eq('job_id', jobId);
    const totalPago = (allPayments || []).reduce((s: number, p: any) => s + (p.amount || 0), 0);
    const newStatus = (newAmount === 0 && (totalPago > 0 || discountVal > 0))
      ? 'paid'
      : totalPago <= 0 ? 'pending' : totalPago >= newAmount ? 'paid' : 'partial';
    const jobUpdate: any = { payment_status: newStatus };
    if (discountVal > 0) jobUpdate.amount = newAmount;
    await supabase.from('jobs').update(jobUpdate).eq('id', jobId).eq('user_id', userId);

    res.json({ payment, totalPago, newStatus, newAmount, discountApplied: discountVal });
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
  app.post('/api/jobs/:id/items', requireAuth, denyProductionOnly, async (req, res) => {
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
  async function recalcJobFinancials(supabase: SupabaseClient, adminClient: SupabaseClient, jobId: number, userId: string, dealBaseOverride?: number) {
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
      let dealBase: number;
      if (dealBaseOverride !== undefined) {
        // Quem chama (syncDealAndJob) já calculou a base autoritativa a partir dos
        // deal_items recém-editados. Usar direto evita o fallback `|| job.amount`
        // ressuscitar o valor antigo quando o usuário ESVAZIA o pacote (base = 0).
        dealBase = dealBaseOverride;
      } else {
        const { data: dItems } = await adminClient.from('deal_items').select('catalog_value, quantidade').eq('deal_id', deal.id);
        const items = dItems || [];
        const dealTotal = items.reduce((s: number, i: any) => s + (i.catalog_value || 0) * (i.quantidade || 1), 0);
        dealBase = items.length > 0 ? dealTotal : (deal.value || job.amount || 0);
      }
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

  // Valida que a string é uma data YYYY-MM-DD REAL (não só no formato): rejeita
  // 2025-99-99 / 2025-02-30 etc. pra não estourar new Date().toISOString().
  const okYMD = (s: string): boolean => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  };

  // GET /api/relatorios/vendas?from=YYYY-MM-DD&to=YYYY-MM-DD (ou ?mes=YYYY-MM)
  // Relatório de PRODUTOS vendidos: filtra pela data da VENDA (created_at do
  // item), com precisão de dia e "até" inclusivo. Mantém ?mes= por compat.
  app.get('/api/relatorios/vendas', requireAuth, requirePermission('finance'), async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const adminClient = supabaseAdmin || supabase;

    const now = new Date();
    const fromQ = String(req.query.from || '').trim();
    const toQ = String(req.query.to || '').trim();
    let inicio: string, fim: string, labelFrom: string, labelTo: string;
    if (okYMD(fromQ) && okYMD(toQ)) {
      labelFrom = fromQ <= toQ ? fromQ : toQ;
      labelTo = fromQ <= toQ ? toQ : fromQ;
      const next = new Date(`${labelTo}T12:00:00Z`); // meio-dia evita borda de fuso
      next.setUTCDate(next.getUTCDate() + 1);          // fim exclusivo = dia seguinte
      inicio = new Date(`${labelFrom}T00:00:00-03:00`).toISOString();
      fim = new Date(`${next.toISOString().slice(0, 10)}T00:00:00-03:00`).toISOString();
    } else {
      const mm = String(req.query.mes || '').match(/^(\d{4})-(\d{2})$/);
      const ano = mm ? Number(mm[1]) : now.getFullYear();
      const mes = mm ? Number(mm[2]) : now.getMonth() + 1;
      inicio = new Date(Date.UTC(ano, mes - 1, 1)).toISOString();
      fim = new Date(Date.UTC(ano, mes, 1)).toISOString();
      labelFrom = inicio.slice(0, 10);
      labelTo = new Date(Date.UTC(ano, mes, 0)).toISOString().slice(0, 10); // último dia do mês
    }

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

    // Trabalhos do usuário — pra restringir job_items ao dono JÁ NA QUERY
    // (job_items não tem user_id; sem o .in abaixo a busca varreria itens de
    // todas as contas e filtraria só em memória — vazamento em logs + lento).
    const { data: allJobs } = await supabase.from('jobs').select('id').eq('user_id', userId).limit(10000);
    const jobIdsArr = (allJobs || []).map((j: any) => j.id);
    const jobIds = new Set(jobIdsArr);

    // Produtos vendidos: itens de trabalho criados no período, por nome
    const { data: items } = jobIdsArr.length
      ? await adminClient
          .from('job_items')
          .select('catalog_name, catalog_type, catalog_value, quantidade, discount_value, job_id')
          .in('job_id', jobIdsArr)
          .gte('created_at', inicio)
          .lt('created_at', fim)
      : { data: [] as any[] };
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

    res.json({ periodo: { from: labelFrom, to: labelTo }, resumo: { totalVendido, numTrabalhos, ticketMedio }, produtos, compras });
  });

  // GET /api/relatorios/vendas-por-tipo?ano=&mes_inicio=&mes_fim=
  // Relatório gerencial: vendas separadas por TIPO DE ENSAIO (categoria), com o
  // valor dos ENSAIOS (pacote/base), os EXTRAS vendidos (fotos avulsas, álbuns,
  // produtos = job_items) e a subdivisão de quais PACOTES (deal_items) foram
  // vendidos em cada categoria. "Vendido" = job criado (created_at) no período.
  // Isolamento por conta: jobs/deals filtrados por user_id; itens via .in(ids).
  app.get('/api/relatorios/vendas-por-tipo', requireAuth, requirePermission('finance'), async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const adminClient = supabaseAdmin || supabase;

    const now = new Date();
    // Filtra por ENSAIO REALIZADO (job_date = a data do ensaio), NÃO pela data
    // da venda (created_at). Aceita intervalo de datas (from/to em YYYY-MM-DD,
    // "até" inclusivo) OU o formato antigo ano/mes_inicio/mes_fim. job_date é uma
    // coluna DATE, então comparamos por string de data (sem fuso, dia cravado).
    const fromQ = String(req.query.from || '').trim();
    const toQ = String(req.query.to || '').trim();
    let dInicio: string, dFimIncl: string;
    if (okYMD(fromQ) && okYMD(toQ)) {
      dInicio = fromQ <= toQ ? fromQ : toQ;
      dFimIncl = fromQ <= toQ ? toQ : fromQ;
    } else {
      const ano = Number(req.query.ano) || now.getFullYear();
      const mi = Math.min(12, Math.max(1, Number(req.query.mes_inicio) || 1));
      const mf = Math.min(12, Math.max(mi, Number(req.query.mes_fim) || 12));
      const lastDay = new Date(Date.UTC(ano, mf, 0)).getUTCDate(); // último dia do mês mf
      dInicio = `${ano}-${String(mi).padStart(2, '0')}-01`;
      dFimIncl = `${ano}-${String(mf).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    }

    // Ensaios (jobs) REALIZADOS no período (por job_date, "até" inclusivo)
    const { data: jobsData } = await supabase
      .from('jobs')
      .select('id, job_type, amount, job_date, client_id, clients(name)')
      .eq('user_id', userId)
      .gte('job_date', dInicio)
      .lte('job_date', dFimIncl);
    const jobs = jobsData || [];
    const jobIds = jobs.map((j: any) => j.id);
    const tipoByJob = new Map<number, string>(jobs.map((j: any) => [j.id, j.job_type || 'Sem tipo']));
    const clienteByJob = new Map<number, string>(
      jobs.map((j: any) => [j.id, ((j.clients as any)?.name) || 'Cliente']));

    // Extras (job_items) desses jobs
    const itemsRaw = jobIds.length
      ? (await adminClient.from('job_items')
          .select('job_id, catalog_name, catalog_type, catalog_value, quantidade, discount_value')
          .in('job_id', jobIds)).data || []
      : [];

    // Pacotes: deal_items dos deals convertidos nesses jobs
    const dealsData = jobIds.length
      ? (await supabase.from('deals').select('id, converted_job_id').eq('user_id', userId).in('converted_job_id', jobIds)).data || []
      : [];
    const jobByDeal = new Map<string, number>(dealsData.map((d: any) => [d.id, d.converted_job_id]));
    const dealIds = dealsData.map((d: any) => d.id);
    const dealItemsRaw = dealIds.length
      ? (await adminClient.from('deal_items')
          .select('deal_id, catalog_name, catalog_type, catalog_value, quantidade')
          .in('deal_id', dealIds)).data || []
      : [];

    // PRODUTO (foto avulsa, álbum, produtos) NÃO entra no faturamento — vira
    // observação por pessoa (o que ela comprou a mais). Combo/serviço continuam
    // como ensaio. Aqui separamos, por job, os produtos do resto.
    const isProduto = (t: any) => String(t || '').toLowerCase() === 'produto';
    type ProdLinha = { nome: string; tipo: string; qtd: number; valor: number };
    const produtosByJob = new Map<number, ProdLinha[]>();
    const produtoSumByJob = new Map<number, number>();
    const servExtraSumByJob = new Map<number, number>(); // extras NÃO-produto (faturamento)
    const pacoteLinesByJob = new Map<number, Array<{ nome: string; qtd: number; valor: number }>>();
    const pacoteSumByJob = new Map<number, number>();
    const pushProduto = (jobId: number, p: ProdLinha) => {
      if (!produtosByJob.has(jobId)) produtosByJob.set(jobId, []);
      produtosByJob.get(jobId)!.push(p);
      produtoSumByJob.set(jobId, (produtoSumByJob.get(jobId) || 0) + p.valor);
    };

    // job_items: produto → bucket de produtos; resto → extra de serviço (faturamento)
    for (const it of itemsRaw as any[]) {
      if (!tipoByJob.has(it.job_id)) continue;
      const qtd = Number(it.quantidade) || 1;
      const valor = Math.max(0, (Number(it.catalog_value) || 0) * qtd - (Number(it.discount_value) || 0));
      if (isProduto(it.catalog_type)) {
        pushProduto(it.job_id, { nome: it.catalog_name || 'Produto', tipo: it.catalog_type || 'produto', qtd, valor });
      } else {
        servExtraSumByJob.set(it.job_id, (servExtraSumByJob.get(it.job_id) || 0) + valor);
      }
    }

    // deal_items: produto → bucket de produtos; resto → pacote (faturamento)
    for (const di of dealItemsRaw as any[]) {
      const jobId = jobByDeal.get(di.deal_id);
      if (jobId == null || !tipoByJob.has(jobId)) continue;
      const qtd = Number(di.quantidade) || 1;
      const valor = (Number(di.catalog_value) || 0) * qtd;
      if (isProduto(di.catalog_type)) {
        pushProduto(jobId, { nome: di.catalog_name || 'Produto', tipo: di.catalog_type || 'produto', qtd, valor });
      } else {
        if (!pacoteLinesByJob.has(jobId)) pacoteLinesByJob.set(jobId, []);
        pacoteLinesByJob.get(jobId)!.push({ nome: di.catalog_name || 'Pacote', qtd, valor });
        pacoteSumByJob.set(jobId, (pacoteSumByJob.get(jobId) || 0) + valor);
      }
    }

    // Agrupa tipos de ensaio ignorando acento/maiúscula ("Aniversário" e
    // "Aniversario" caem na mesma categoria). O nome exibido é a variante mais
    // frequente entre os jobs daquele grupo.
    const normTipo = (s: any): string =>
      String(s || 'Sem tipo').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase() || 'sem tipo';
    type Cliente = { nome: string; data: string; valor: number; produtos: ProdLinha[]; totalProdutos: number };
    type CatPacote = { nome: string; quantidade: number; valor: number; clientes: Cliente[] };
    type Cat = {
      tipo: string; labelCount: Map<string, number>; numEnsaios: number;
      valorEnsaios: number; valorExtras: number; valorProdutos: number;
      pacotes: Map<string, CatPacote>; produtos: Map<string, ProdLinha & { quantidade: number }>;
    };
    const AVULSO = '— Avulso (sem pacote) —';
    const cats = new Map<string, Cat>();
    const getCat = (tipo: string): Cat => {
      const k = normTipo(tipo);
      if (!cats.has(k)) cats.set(k, { tipo: tipo || 'Sem tipo', labelCount: new Map(), numEnsaios: 0, valorEnsaios: 0, valorExtras: 0, valorProdutos: 0, pacotes: new Map(), produtos: new Map() });
      return cats.get(k)!;
    };

    // Por job: conta ensaio, soma faturamento (pacote OU amount-produto) e
    // pendura o cliente em cada pacote (drill-down) com seus produtos.
    for (const j of jobs as any[]) {
      const cat = getCat(j.job_type || 'Sem tipo');
      const lbl = j.job_type || 'Sem tipo';
      cat.labelCount.set(lbl, (cat.labelCount.get(lbl) || 0) + 1);
      cat.numEnsaios += 1;

      const cliente = clienteByJob.get(j.id) || 'Cliente';
      const dataEnsaio = String(j.job_date || '').slice(0, 10);
      const produtosJob = produtosByJob.get(j.id) || [];
      const totalProdJob = produtoSumByJob.get(j.id) || 0;
      const servExtra = servExtraSumByJob.get(j.id) || 0;
      cat.valorProdutos += totalProdJob;
      cat.valorExtras += servExtra;
      for (const p of produtosJob) {
        const e = cat.produtos.get(p.nome) || { nome: p.nome, tipo: p.tipo, qtd: 0, quantidade: 0, valor: 0 };
        e.quantidade += p.qtd; e.valor += p.valor; cat.produtos.set(p.nome, e);
      }

      const pacoteLines = pacoteLinesByJob.get(j.id) || [];
      const addCliente = (pacoteNome: string, valor: number) => {
        const p = cat.pacotes.get(pacoteNome) || { nome: pacoteNome, quantidade: 0, valor: 0, clientes: [] };
        p.clientes.push({ nome: cliente, data: dataEnsaio, valor, produtos: produtosJob, totalProdutos: totalProdJob });
        cat.pacotes.set(pacoteNome, p);
        return p;
      };
      if (pacoteLines.length > 0) {
        cat.valorEnsaios += pacoteSumByJob.get(j.id) || 0;
        // Produtos do job aparecem só na 1ª linha de pacote (evita repetir a obs).
        let first = true;
        for (const pl of pacoteLines) {
          const p = cat.pacotes.get(pl.nome) || { nome: pl.nome, quantidade: 0, valor: 0, clientes: [] };
          p.quantidade += pl.qtd; p.valor += pl.valor;
          p.clientes.push({ nome: cliente, data: dataEnsaio, valor: pl.valor, produtos: first ? produtosJob : [], totalProdutos: first ? totalProdJob : 0 });
          cat.pacotes.set(pl.nome, p);
          first = false;
        }
      } else {
        // Sem pacote: faturamento = amount - produtos - serviço (serviço entra em valorExtras).
        const ensaioBase = Math.max(0, (Number(j.amount) || 0) - totalProdJob - servExtra);
        cat.valorEnsaios += ensaioBase;
        const p = addCliente(AVULSO, ensaioBase);
        p.quantidade += 1; p.valor += ensaioBase;
      }
    }

    const ordClientes = (cs: Cliente[]) => cs.sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : 0));
    const categorias = [...cats.values()].map((c) => ({
      // nome exibido = variante mais frequente do tipo (ex.: "Aniversário")
      tipo: [...c.labelCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || c.tipo,
      numEnsaios: c.numEnsaios,
      valorEnsaios: c.valorEnsaios,
      valorExtras: c.valorExtras,
      valorTotal: c.valorEnsaios + c.valorExtras, // faturamento (SEM produtos)
      valorProdutos: c.valorProdutos,             // produtos vendidos (fora do faturamento)
      pacotes: [...c.pacotes.values()]
        .map((p) => ({ nome: p.nome, quantidade: p.quantidade, valor: p.valor, clientes: ordClientes(p.clientes) }))
        // "Avulso" sempre por último; o resto por valor desc.
        .sort((a, b) => (a.nome === AVULSO ? 1 : b.nome === AVULSO ? -1 : b.valor - a.valor)),
      produtos: [...c.produtos.values()]
        .map((p) => ({ nome: p.nome, tipo: p.tipo, quantidade: p.quantidade, valor: p.valor }))
        .sort((a, b) => b.valor - a.valor),
    })).sort((a, b) => b.valorTotal - a.valorTotal);

    const totais = categorias.reduce((t, c) => ({
      numEnsaios: t.numEnsaios + c.numEnsaios,
      valorEnsaios: t.valorEnsaios + c.valorEnsaios,
      valorExtras: t.valorExtras + c.valorExtras,
      valorTotal: t.valorTotal + c.valorTotal,
      valorProdutos: t.valorProdutos + c.valorProdutos,
    }), { numEnsaios: 0, valorEnsaios: 0, valorExtras: 0, valorTotal: 0, valorProdutos: 0 });

    res.json({ periodo: { from: dInicio, to: dFimIncl }, totais, categorias });
  });

  // GET /api/relatorios/entrada-saida?from=YYYY-MM-DD&to=YYYY-MM-DD
  // ENTRADA = pagamentos reais recebidos no período (job_payments) — mesma base
  // do "Entrada" do Dashboard. SAÍDA = despesas pagas (fin_despesas status='pago')
  // no período, por data_pagamento. Lucro = entrada - saída. Tudo por conta.
  app.get('/api/relatorios/entrada-saida', requireAuth, requirePermission('finance'), async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const adminClient = supabaseAdmin || supabase;

    const now = new Date();
    const fromQ = String(req.query.from || '').trim();
    const toQ = String(req.query.to || '').trim();
    let dInicio: string, dFimIncl: string;
    if (okYMD(fromQ) && okYMD(toQ)) {
      dInicio = fromQ <= toQ ? fromQ : toQ;
      dFimIncl = fromQ <= toQ ? toQ : fromQ;
    } else {
      dInicio = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1)).toISOString().slice(0, 10);
      dFimIncl = new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 0)).toISOString().slice(0, 10);
    }
    // fim exclusivo (dia seguinte ao "até") pra incluir o dia inteiro mesmo se a
    // coluna for timestamp.
    const nd = new Date(`${dFimIncl}T12:00:00Z`);
    nd.setUTCDate(nd.getUTCDate() + 1);
    const nextDay = nd.toISOString().slice(0, 10);

    // ENTRADA: job_payments recebidos no período (só de jobs do usuário).
    const { data: userJobs } = await supabase.from('jobs').select('id').eq('user_id', userId).limit(10000);
    const jobIds = (userJobs || []).map((j: any) => j.id);
    let entrada = 0;
    if (jobIds.length) {
      const { data: pmts } = await adminClient
        .from('job_payments')
        .select('amount, payment_date, job_id')
        .in('job_id', jobIds)
        .gte('payment_date', dInicio)
        .lt('payment_date', nextDay);
      entrada = (pmts || []).reduce((s: number, p: any) => s + (Number(p.amount) || 0), 0);
    }

    // SAÍDA: despesas pagas no período (por data_pagamento).
    const { data: desp } = await adminClient
      .from('fin_despesas')
      .select('valor, data_pagamento, status, user_id')
      .eq('user_id', userId)
      .eq('status', 'pago')
      .gte('data_pagamento', dInicio)
      .lt('data_pagamento', nextDay);
    const saida = (desp || []).reduce((s: number, d: any) => s + (Number(d.valor) || 0), 0);

    res.json({ periodo: { from: dInicio, to: dFimIncl }, entrada, saida, lucro: entrada - saida });
  });

  // GET /api/relatorios/vendas-por-vendedor?from=YYYY-MM-DD&to=YYYY-MM-DD
  // Quanto cada VENDEDOR (team_member via deals.assigned_to) converteu no
  // período (deals em etapa ganha, por converted_at) + comissão devida
  // (valor vendido × % do vendedor) e progresso da meta. Inclui todos os
  // membros ativos (mesmo com 0) e um balde "Sem vendedor".
  app.get('/api/relatorios/vendas-por-vendedor', requireAuth, requirePermission('finance'), async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;

    const now = new Date();
    const fromQ = String(req.query.from || '').trim();
    const toQ = String(req.query.to || '').trim();
    let dInicio: string, dFimIncl: string;
    if (okYMD(fromQ) && okYMD(toQ)) {
      dInicio = fromQ <= toQ ? fromQ : toQ;
      dFimIncl = fromQ <= toQ ? toQ : fromQ;
    } else {
      dInicio = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1)).toISOString().slice(0, 10);
      dFimIncl = new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 0)).toISOString().slice(0, 10);
    }
    const nd = new Date(`${dFimIncl}T12:00:00Z`);
    nd.setUTCDate(nd.getUTCDate() + 1);
    const nextDay = nd.toISOString().slice(0, 10);

    const stages = await ensurePipelineStages(supabase, userId);
    const wonStageIds = stages.filter((s: any) => s.is_won).map((s: any) => s.id);

    // Vendas ganhas no período (por converted_at)
    let deals: any[] = [];
    if (wonStageIds.length) {
      const { data } = await supabase
        .from('deals')
        .select('id, assigned_to, value, converted_at, converted_job_id')
        .eq('user_id', userId)
        .in('stage', wonStageIds)
        .gte('converted_at', dInicio)
        .lt('converted_at', nextDay)
        .limit(10000);
      deals = data || [];
    }

    // VENDA CANCELADA: deal que ficou "ganho" mas cujo ensaio (job) foi APAGADO
    // ou marcado como cancelado. Não conta como venda. (Quem usa "Cancelar venda"
    // já cai em "perdido"; isto pega quem só apagou o ensaio.)
    if (deals.length) {
      const jobIds = deals.map((d) => d.converted_job_id).filter(Boolean);
      const jobStatusById = new Map<number, string>();
      if (jobIds.length) {
        const { data: jobsRows } = await supabase
          .from('jobs')
          .select('id, status')
          .eq('user_id', userId)
          .in('id', jobIds);
        for (const j of jobsRows || []) jobStatusById.set(j.id, String((j as any).status || ''));
      }
      const isCancelled = (s: string) => /cancel/i.test(s); // 'cancelled' / 'cancelado'
      deals = deals.filter((d) => {
        if (!d.converted_job_id) return true; // venda sem job (ganho por arrasto) conta
        const st = jobStatusById.get(d.converted_job_id);
        if (st === undefined) return false;     // job apagado → cancelada
        return !isCancelled(st);                // job cancelado → fora
      });
    }

    // Carrega TODOS os membros (ativo ou não) pra resolver nome; mostra na lista
    // só os ativos (mesmo com 0 vendas). assigned_to que não casa com nenhum
    // membro cai num único balde "Sem vendedor" (não vira vários baldes).
    // select('*') é resiliente: se a migration 042 (meta_venda/comissao_percentual)
    // ainda não rodou, as colunas só vêm undefined → comissão 0, sem quebrar.
    const { data: membersData } = await supabase
      .from('team_members')
      .select('*')
      .eq('owner_user_id', userId);
    const members = membersData || [];
    const memberById = new Map<string, any>((members as any[]).map((m) => [m.id, m]));

    type Row = { id: string | null; nome: string; cor: string | null; meta: number; percentual: number; numVendas: number; valorVendido: number };
    const mkRow = (m: any): Row => ({ id: m.id, nome: m.name || 'Vendedor', cor: m.color || null, meta: Number(m.meta_venda) || 0, percentual: Number(m.comissao_percentual) || 0, numVendas: 0, valorVendido: 0 });
    const rows = new Map<string, Row>();
    for (const m of members as any[]) {
      if (m.is_active === false) continue; // só ativos pré-semeados
      rows.set(m.id, mkRow(m));
    }
    for (const d of deals) {
      const k = (d.assigned_to && memberById.has(d.assigned_to)) ? d.assigned_to : '__none__';
      let r = rows.get(k);
      if (!r) {
        r = k !== '__none__'
          ? mkRow(memberById.get(k)) // membro inativo com vendas no período
          : { id: null, nome: 'Sem vendedor', cor: null, meta: 0, percentual: 0, numVendas: 0, valorVendido: 0 };
        rows.set(k, r);
      }
      r.numVendas += 1;
      r.valorVendido += Number(d.value) || 0;
    }

    const vendedores = [...rows.values()].map((r) => ({
      id: r.id, nome: r.nome, cor: r.cor, meta: r.meta, percentual: r.percentual,
      numVendas: r.numVendas, valorVendido: r.valorVendido,
      comissao: r.valorVendido * (r.percentual / 100),
      metaPct: r.meta > 0 ? Math.round((r.valorVendido / r.meta) * 100) : null,
    })).sort((a, b) => b.valorVendido - a.valorVendido);

    const totais = vendedores.reduce((t, v) => ({
      numVendas: t.numVendas + v.numVendas,
      valorVendido: t.valorVendido + v.valorVendido,
      comissao: t.comissao + v.comissao,
    }), { numVendas: 0, valorVendido: 0, comissao: 0 });

    res.json({ periodo: { from: dInicio, to: dFimIncl }, totais, vendedores });
  });

  // GET /api/relatorios/vendas-por-campanha?from=YYYY-MM-DD&to=YYYY-MM-DD
  // Quanto cada CAMPANHA de venda especial (deals.campaign_id) vendeu no
  // período (deals em etapa ganha, por converted_at). Clona vendas-por-vendedor:
  // mesmo período, mesmos wonStageIds e mesmo descarte de venda cancelada.
  // Deals sem campanha caem num balde "Sem campanha".
  app.get('/api/relatorios/vendas-por-campanha', requireAuth, requirePermission('finance'), async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;

    const now = new Date();
    const fromQ = String(req.query.from || '').trim();
    const toQ = String(req.query.to || '').trim();
    let dInicio: string, dFimIncl: string;
    if (okYMD(fromQ) && okYMD(toQ)) {
      dInicio = fromQ <= toQ ? fromQ : toQ;
      dFimIncl = fromQ <= toQ ? toQ : fromQ;
    } else {
      dInicio = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1)).toISOString().slice(0, 10);
      dFimIncl = new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 0)).toISOString().slice(0, 10);
    }
    const nd = new Date(`${dFimIncl}T12:00:00Z`);
    nd.setUTCDate(nd.getUTCDate() + 1);
    const nextDay = nd.toISOString().slice(0, 10);

    const stages = await ensurePipelineStages(supabase, userId);
    const wonStageIds = stages.filter((s: any) => s.is_won).map((s: any) => s.id);

    // Vendas ganhas no período (por converted_at)
    let deals: any[] = [];
    if (wonStageIds.length) {
      const { data } = await supabase
        .from('deals')
        .select('id, campaign_id, value, converted_at, converted_job_id')
        .eq('user_id', userId)
        .in('stage', wonStageIds)
        .gte('converted_at', dInicio)
        .lt('converted_at', nextDay)
        .limit(10000);
      deals = data || [];
    }

    // VENDA CANCELADA: deal "ganho" cujo ensaio (job) foi APAGADO ou cancelado
    // não conta como venda. (Mesma regra de vendas-por-vendedor.)
    if (deals.length) {
      const jobIds = deals.map((d) => d.converted_job_id).filter(Boolean);
      const jobStatusById = new Map<number, string>();
      if (jobIds.length) {
        const { data: jobsRows } = await supabase
          .from('jobs')
          .select('id, status')
          .eq('user_id', userId)
          .in('id', jobIds);
        for (const j of jobsRows || []) jobStatusById.set(j.id, String((j as any).status || ''));
      }
      const isCancelled = (s: string) => /cancel/i.test(s); // 'cancelled' / 'cancelado'
      deals = deals.filter((d) => {
        if (!d.converted_job_id) return true; // venda sem job (ganho por arrasto) conta
        const st = jobStatusById.get(d.converted_job_id);
        if (st === undefined) return false;     // job apagado → cancelada
        return !isCancelled(st);                // job cancelado → fora
      });
    }

    // Resolve nome+cor das campanhas do user. Se a tabela ainda não existe
    // (42P01), segue só com o balde "Sem campanha".
    const campaignById = new Map<string, { name: string; color: string }>();
    {
      const { data: campRows, error: campErr } = await supabase
        .from('sale_campaigns')
        .select('id, name, color')
        .eq('user_id', userId);
      if (campErr && campErr.code !== '42P01') return res.status(500).json({ error: campErr.message });
      for (const c of campRows || []) campaignById.set(c.id, { name: c.name, color: c.color });
    }

    type Row = { id: string | null; nome: string; cor: string; numVendas: number; valorVendido: number };
    const rows = new Map<string, Row>();
    for (const d of deals) {
      const k = d.campaign_id || '__none__';
      let r = rows.get(k);
      if (!r) {
        if (k === '__none__') {
          r = { id: null, nome: 'Sem campanha', cor: '#9CA3AF', numVendas: 0, valorVendido: 0 };
        } else {
          const meta = campaignById.get(k);
          r = { id: k, nome: meta?.name || 'Sem campanha', cor: meta?.color || '#9CA3AF', numVendas: 0, valorVendido: 0 };
        }
        rows.set(k, r);
      }
      r.numVendas += 1;
      r.valorVendido += Number(d.value) || 0;
    }

    const campanhas = [...rows.values()].sort((a, b) => b.valorVendido - a.valorVendido);

    const totais = campanhas.reduce((t, c) => ({
      numVendas: t.numVendas + c.numVendas,
      valorVendido: t.valorVendido + c.valorVendido,
    }), { numVendas: 0, valorVendido: 0 });

    res.json({ periodo: { from: dInicio, to: dFimIncl }, totais, campanhas });
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

    // Fallback SEGURO: precisa ser uma etapa aberta que SOBREVIVE à exclusão.
    // O stageIdOrDefault antigo podia devolver a própria etapa excluída (ou um
    // id default que nem existe) → deals ficavam órfãos e SUMIAM do funil.
    const fallbackStage = stages.find((s) => !s.is_final && s.id !== id)?.id || null;
    if (!fallbackStage) {
      return res.status(400).json({
        error: 'Crie a nova etapa antes de excluir a última etapa aberta — os leads precisam de um destino.',
      });
    }
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

  // ============ CAMPANHAS DE VENDA ESPECIAL ============
  // "Venda especial / campanha" é só uma MARCAÇÃO + RELATÓRIO (NÃO aplica
  // desconto). Cada deal pertence a UMA campanha (deals.campaign_id). CRUD
  // gerenciável pelo usuário com defaults semeados na primeira leitura.
  const DEFAULT_SALE_CAMPAIGNS: { name: string; color: string }[] = [
    { name: 'Natal', color: '#16A34A' },
    { name: 'Dia das Mães', color: '#DB2777' },
    { name: 'Dia dos Pais', color: '#2563EB' },
    { name: 'Black Friday', color: '#111827' },
    { name: 'Dia das Crianças', color: '#F59E0B' },
    { name: 'Páscoa', color: '#A855F7' },
  ];

  app.get('/api/sale-campaigns', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { data, error } = await supabase
      .from('sale_campaigns')
      .select('*')
      .eq('user_id', userId)
      .order('name', { ascending: true });
    if (error) {
      if (error.code === '42P01') return res.json([]); // tabela ainda não migrada
      return res.status(500).json({ error: error.message });
    }
    // Vazio → semeia defaults para esse user (estilo ensurePipelineStages)
    if (!data || data.length === 0) {
      const payload = DEFAULT_SALE_CAMPAIGNS.map((c) => ({ user_id: userId, name: c.name, color: c.color }));
      const { data: seeded, error: seedErr } = await supabase
        .from('sale_campaigns')
        .insert(payload)
        .select()
        .order('name', { ascending: true });
      if (seedErr) {
        console.warn('Não foi possível semear campanhas padrão:', seedErr.message);
        return res.json([]);
      }
      return res.json(seeded || []);
    }
    res.json(data);
  });

  app.post('/api/sale-campaigns', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { name, color, starts_at, ends_at } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'name é obrigatório' });
    const { data, error } = await supabase
      .from('sale_campaigns')
      .insert({
        user_id: userId,
        name: name.trim(),
        color: color || '#6B7280',
        starts_at: starts_at || null,
        ends_at: ends_at || null,
      })
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  });

  app.put('/api/sale-campaigns/:id', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { name, color, starts_at, ends_at, active } = req.body;
    const updates: any = {};
    if (name !== undefined) updates.name = name;
    if (color !== undefined) updates.color = color;
    if (starts_at !== undefined) updates.starts_at = starts_at || null;
    if (ends_at !== undefined) updates.ends_at = ends_at || null;
    if (active !== undefined) updates.active = active;
    const { data, error } = await supabase
      .from('sale_campaigns')
      .update(updates)
      .eq('id', req.params.id)
      .eq('user_id', userId)
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  });

  app.delete('/api/sale-campaigns/:id', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    // Desvincula deals dessa campanha antes de remover (não deixa órfão).
    await supabase
      .from('deals')
      .update({ campaign_id: null })
      .eq('campaign_id', req.params.id)
      .eq('user_id', userId);
    await supabase.from('sale_campaigns').delete().eq('id', req.params.id).eq('user_id', userId);
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
    const { name, email, color, permissions, password, meta_venda, comissao_percentual } = req.body;
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

    // finance começa DESLIGADO: funcionário não vê valores/relatórios por padrão;
    // o dono liga em Configurações → Equipe pra quem quiser.
    const defaultPermissions = { dashboard: true, clients: true, jobs: true, vendas: true, calendar: true, finance: false, oportunidades: true, contratos: true };

    // Cria o registro na tabela team_members
    const baseRow: any = {
      owner_user_id: userId, name: name.trim(), email: email?.trim() || null,
      color: color || '#6366f1', permissions: permissions || defaultPermissions,
    };
    const commissionRow = {
      meta_venda: Math.max(0, Number(meta_venda) || 0),
      comissao_percentual: Math.min(100, Math.max(0, Number(comissao_percentual) || 0)),
    };
    // Resiliente: se a migration 042 ainda não rodou, cria sem comissão.
    let ins = await supabase.from('team_members').insert({ ...baseRow, ...commissionRow }).select().single();
    if (ins.error && /meta_venda|comissao_percentual|does not exist|schema cache/i.test(ins.error.message || '')) {
      ins = await supabase.from('team_members').insert(baseRow).select().single();
    }
    const { data, error } = ins;
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
    const { name, email, color, permissions, password, meta_venda, comissao_percentual } = req.body;

    // Atualiza dados do membro. name/email/color/permissions só entram se vierem
    // (evita zerar o nome quando o caller manda update parcial); meta/comissão idem.
    const upd: any = {};
    if (typeof name === 'string' && name.trim()) upd.name = name.trim();
    if (email !== undefined) upd.email = email?.trim() || null;
    if (color !== undefined) upd.color = color;
    if (permissions !== undefined) upd.permissions = permissions;
    if (meta_venda !== undefined) upd.meta_venda = Math.max(0, Number(meta_venda) || 0);
    if (comissao_percentual !== undefined) upd.comissao_percentual = Math.min(100, Math.max(0, Number(comissao_percentual) || 0));
    if (Object.keys(upd).length) {
      let r = await supabase.from('team_members').update(upd).eq('id', req.params.id).eq('owner_user_id', userId);
      // Resiliente: se faltam colunas de comissão (migration 042), salva o resto.
      if (r.error && /meta_venda|comissao_percentual|does not exist|schema cache/i.test(r.error.message || '')) {
        const { meta_venda: _m, comissao_percentual: _c, ...rest } = upd;
        r = Object.keys(rest).length
          ? await supabase.from('team_members').update(rest).eq('id', req.params.id).eq('owner_user_id', userId)
          : { error: null } as any;
      }
      if (r.error) return res.status(500).json({ error: r.error.message });
    }

    // Se veio nova senha, atualiza no Supabase Auth
    if (password && supabaseAdmin) {
      const isPlatformAdmin = (req as any).isPlatformAdmin === true;
      // Isolamento: dono só mexe nos PRÓPRIOS membros (platform admin gerencia
      // todos). Sem isso, um dono poderia vincular/redefinir acesso de membro
      // de outro estúdio passando o id alheio.
      const ownerScoped = (q: any) => (isPlatformAdmin ? q : q.eq('owner_user_id', userId));
      const { data: member } = await ownerScoped(
        supabaseAdmin.from('team_members').select('member_user_id, email').eq('id', req.params.id)
      ).single();

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
            await ownerScoped(supabaseAdmin.from('team_members').update({ member_user_id: found.id }).eq('id', req.params.id));
          }
        } else if (authUser?.user) {
          await ownerScoped(supabaseAdmin.from('team_members').update({ member_user_id: authUser.user.id }).eq('id', req.params.id));
        }
      }
    }

    // Permissão mudou? Invalida o cache de auth (TTL 30s) do tenant pra valer na
    // hora — senão o backend continuaria autorizando pela permissão antiga.
    if (permissions !== undefined) {
      try { await invalidateAuthCacheForTenant(userId); } catch { /* best-effort */ }
    }

    res.json({ success: true });
  });

  // Atualiza SÓ meta + comissão (edição inline no relatório de vendas por vendedor).
  app.put('/api/team-members/:id/comissao', requireAuth, requireOwnerOrPlatformAdmin, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const meta = Math.max(0, Number(req.body.meta_venda) || 0);
    const pct = Math.min(100, Math.max(0, Number(req.body.comissao_percentual) || 0));
    const { error } = await supabase
      .from('team_members')
      .update({ meta_venda: meta, comissao_percentual: pct })
      .eq('id', req.params.id)
      .eq('owner_user_id', userId);
    if (error) {
      if (/meta_venda|comissao_percentual|does not exist|schema cache/i.test(error.message || ''))
        return res.status(400).json({ error: 'Rode a migration 042 no banco pra salvar meta/comissão.' });
      return res.status(500).json({ error: error.message });
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
    const { title, description, assignee_id, job_id, stage_id, client_id, due_date,
            block, block_position, parent_task_id, position, template_id } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: 'Título obrigatório' });
    // Prazo agora é OPCIONAL (tarefas tipo checklist).
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
        due_date: due_date || null,
        block: block || null,
        block_position: block_position ?? null,
        parent_task_id: parent_task_id || null,
        position: position ?? 0,
        template_id: template_id || null,
      })
      .select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  });

  app.put('/api/tasks/:id', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const b = req.body || {};
    // Update parcial: só toca nos campos enviados (não zera o que não veio).
    const patch: any = {};
    if (b.title !== undefined) patch.title = b.title?.trim();
    if (b.description !== undefined) patch.description = b.description?.trim() || null;
    if (b.assignee_id !== undefined) patch.assignee_id = b.assignee_id || null;
    if (b.job_id !== undefined) patch.job_id = b.job_id || null;
    if (b.stage_id !== undefined) patch.stage_id = b.stage_id || null;
    if (b.client_id !== undefined) patch.client_id = b.client_id || null;
    if (b.due_date !== undefined) patch.due_date = b.due_date || null;
    if (b.block !== undefined) patch.block = b.block || null;
    if (b.position !== undefined) patch.position = b.position ?? 0;
    const { error } = await supabase
      .from('tasks')
      .update(patch)
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

  // ============ PADRÕES DE TAREFAS (playbooks) ============

  // Helper: regrava blocos+itens de um padrão (apaga e reinsere a estrutura).
  async function saveTemplateStructure(supabase: SupabaseClient, templateId: string, blocks: any[]) {
    await supabase.from('task_template_blocks').delete().eq('template_id', templateId); // cascade remove itens
    let bPos = 0;
    for (const bl of (blocks || [])) {
      const { data: newBlock } = await supabase.from('task_template_blocks').insert({
        template_id: templateId, title: (bl.title || 'Bloco').trim(), note: bl.note?.trim() || null, position: bl.position ?? bPos,
      }).select().single();
      bPos++;
      if (!newBlock) continue;
      let iPos = 0;
      for (const it of (bl.items || [])) {
        const { data: newItem } = await supabase.from('task_template_items').insert({
          template_id: templateId, block_id: newBlock.id, parent_id: null,
          title: (it.title || 'Tarefa').trim(), description: it.description?.trim() || null, position: it.position ?? iPos,
          default_assignee_id: it.default_assignee_id || null, due_offset_days: it.due_offset_days ?? null, due_offset_ref: it.due_offset_ref || 'ensaio',
        }).select().single();
        iPos++;
        if (!newItem) continue;
        let cPos = 0;
        for (const ch of (it.children || [])) {
          await supabase.from('task_template_items').insert({
            template_id: templateId, block_id: newBlock.id, parent_id: newItem.id,
            title: (ch.title || 'Subtarefa').trim(), description: ch.description?.trim() || null, position: ch.position ?? cPos,
            default_assignee_id: ch.default_assignee_id || null, due_offset_days: ch.due_offset_days ?? null, due_offset_ref: ch.due_offset_ref || 'ensaio',
          });
          cPos++;
        }
      }
    }
  }

  // Monta a estrutura aninhada (blocos → itens → subtarefas) a partir das linhas.
  function nestTemplate(blocks: any[], items: any[]) {
    const topByBlock: Record<string, any[]> = {};
    const childrenByParent: Record<string, any[]> = {};
    for (const it of (items || [])) {
      if (it.parent_id) (childrenByParent[it.parent_id] ||= []).push(it);
      else (topByBlock[it.block_id] ||= []).push(it);
    }
    return (blocks || []).map((bl: any) => ({
      ...bl,
      items: (topByBlock[bl.id] || []).map((it: any) => ({ ...it, children: childrenByParent[it.id] || [] })),
    }));
  }

  // Lista padrões (leve, com contagem de itens).
  app.get('/api/task-templates', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    // Service role + filtro por user_id: a tabela tem RLS (user_id = auth.uid()),
    // que bloqueia MEMBROS da equipe (auth.uid() = membro ≠ dono). Isolamento
    // garantido pelo .eq('user_id', userId) explícito.
    const supabase = (supabaseAdmin || (req as any).supabase) as SupabaseClient;
    const { data: templates, error } = await supabase
      .from('task_templates').select('*').eq('user_id', userId).order('created_at', { ascending: true });
    if (error) {
      if (/task_templates/i.test(error.message)) return res.json({ tableMissing: true, templates: [] });
      return res.status(500).json({ error: error.message });
    }
    const ids = (templates || []).map((t: any) => t.id);
    const counts: Record<string, number> = {};
    if (ids.length) {
      const { data: items } = await supabase.from('task_template_items').select('template_id').in('template_id', ids);
      for (const it of (items || [])) counts[it.template_id] = (counts[it.template_id] || 0) + 1;
    }
    res.json({ templates: (templates || []).map((t: any) => ({ ...t, item_count: counts[t.id] || 0 })) });
  });

  // Padrão completo (blocos + itens aninhados).
  app.get('/api/task-templates/:id', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (supabaseAdmin || (req as any).supabase) as SupabaseClient; // RLS bloqueia membros — ver GET /api/task-templates
    const { data: tpl, error } = await supabase.from('task_templates').select('*').eq('id', req.params.id).eq('user_id', userId).maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!tpl) return res.status(404).json({ error: 'Padrão não encontrado' });
    const { data: blocks } = await supabase.from('task_template_blocks').select('*').eq('template_id', tpl.id).order('position');
    const { data: items } = await supabase.from('task_template_items').select('*').eq('template_id', tpl.id).order('position');
    res.json({ ...tpl, blocks: nestTemplate(blocks || [], items || []) });
  });

  // Cria padrão (com estrutura opcional).
  app.post('/api/task-templates', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (supabaseAdmin || (req as any).supabase) as SupabaseClient; // RLS bloqueia membros — ver GET /api/task-templates
    const { name, description, blocks } = req.body || {};
    if (!name?.trim()) return res.status(400).json({ error: 'Nome obrigatório' });
    const { data: tpl, error } = await supabase.from('task_templates').insert({
      user_id: userId, name: name.trim(), description: description?.trim() || null,
    }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    if (Array.isArray(blocks) && blocks.length) await saveTemplateStructure(supabase, tpl.id, blocks);
    res.json(tpl);
  });

  // Substitui o padrão inteiro (nome/descrição + estrutura).
  app.put('/api/task-templates/:id', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (supabaseAdmin || (req as any).supabase) as SupabaseClient; // RLS bloqueia membros — ver GET /api/task-templates
    const { name, description, is_active, blocks } = req.body || {};
    const { data: tpl, error } = await supabase.from('task_templates').update({
      ...(name !== undefined ? { name: name?.trim() } : {}),
      ...(description !== undefined ? { description: description?.trim() || null } : {}),
      ...(is_active !== undefined ? { is_active: !!is_active } : {}),
      updated_at: new Date().toISOString(),
    }).eq('id', req.params.id).eq('user_id', userId).select().single();
    if (error) return res.status(500).json({ error: error.message });
    if (!tpl) return res.status(404).json({ error: 'Padrão não encontrado' });
    if (Array.isArray(blocks)) await saveTemplateStructure(supabase, tpl.id, blocks);
    res.json({ success: true });
  });

  // Duplica um padrão (com toda a estrutura).
  app.post('/api/task-templates/:id/duplicate', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (supabaseAdmin || (req as any).supabase) as SupabaseClient; // RLS bloqueia membros — ver GET /api/task-templates
    const { data: tpl } = await supabase.from('task_templates').select('*').eq('id', req.params.id).eq('user_id', userId).maybeSingle();
    if (!tpl) return res.status(404).json({ error: 'Padrão não encontrado' });
    const { data: blocks } = await supabase.from('task_template_blocks').select('*').eq('template_id', tpl.id).order('position');
    const { data: items } = await supabase.from('task_template_items').select('*').eq('template_id', tpl.id).order('position');
    const nested = nestTemplate(blocks || [], items || []);
    const { data: copy } = await supabase.from('task_templates').insert({ user_id: userId, name: `${tpl.name} (cópia)`, description: tpl.description }).select().single();
    if (copy) await saveTemplateStructure(supabase, copy.id, nested);
    res.json(copy);
  });

  app.delete('/api/task-templates/:id', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (supabaseAdmin || (req as any).supabase) as SupabaseClient; // RLS bloqueia membros — ver GET /api/task-templates
    const { error } = await supabase.from('task_templates').delete().eq('id', req.params.id).eq('user_id', userId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  });

  // Aplica um padrão: cria as tarefas (blocos → tarefas → subtarefas) numa venda.
  app.post('/api/task-templates/:id/apply', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (supabaseAdmin || (req as any).supabase) as SupabaseClient; // RLS bloqueia membros — ver GET /api/task-templates
    const { job_id, client_id, reference_date, default_assignee_id } = req.body || {};
    const { data: tpl } = await supabase.from('task_templates').select('id').eq('id', req.params.id).eq('user_id', userId).maybeSingle();
    if (!tpl) return res.status(404).json({ error: 'Padrão não encontrado' });
    const { data: blocks } = await supabase.from('task_template_blocks').select('*').eq('template_id', tpl.id).order('position');
    const { data: items } = await supabase.from('task_template_items').select('*').eq('template_id', tpl.id).order('position');
    const topByBlock: Record<string, any[]> = {}; const childrenByParent: Record<string, any[]> = {};
    for (const it of (items || [])) { if (it.parent_id) (childrenByParent[it.parent_id] ||= []).push(it); else (topByBlock[it.block_id] ||= []).push(it); }
    const refDate = reference_date ? new Date(`${reference_date}T12:00:00`) : new Date();
    const dueFrom = (item: any): string | null => {
      if (item.due_offset_days == null) return null;
      const base = (item.due_offset_ref === 'aplicacao') ? new Date() : new Date(refDate);
      base.setDate(base.getDate() + Number(item.due_offset_days));
      return base.toISOString();
    };
    let created = 0;
    for (const bl of (blocks || [])) {
      for (const it of (topByBlock[bl.id] || [])) {
        const { data: parent } = await supabase.from('tasks').insert({
          user_id: userId, title: it.title, description: it.description || null,
          assignee_id: it.default_assignee_id || default_assignee_id || null,
          job_id: job_id || null, client_id: client_id || null,
          due_date: dueFrom(it), block: bl.title, block_position: bl.position, position: it.position,
          template_id: tpl.id, parent_task_id: null,
        }).select().single();
        created++;
        if (!parent) continue;
        for (const ch of (childrenByParent[it.id] || [])) {
          await supabase.from('tasks').insert({
            user_id: userId, title: ch.title, description: ch.description || null,
            assignee_id: ch.default_assignee_id || default_assignee_id || null,
            job_id: job_id || null, client_id: client_id || null,
            due_date: dueFrom(ch), block: bl.title, block_position: bl.position, position: ch.position,
            template_id: tpl.id, parent_task_id: parent.id,
          });
          created++;
        }
      }
    }
    res.json({ success: true, created });
  });

  // Cria o "Ensaio Padrão" de exemplo (as 7 etapas do fluxo do estúdio).
  app.post('/api/task-templates/seed-default', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (supabaseAdmin || (req as any).supabase) as SupabaseClient; // RLS bloqueia membros — ver GET /api/task-templates
    const t = (title: string, children?: string[]) => ({ title, children: (children || []).map(c => ({ title: c })) });
    const blocks = [
      { title: 'Etapa 1 — Atendimento / Sistema da empresa', note: 'Todo ensaio fechado precisa passar por contrato + alinhamento antes de ir para a semana do ensaio.', items: [
        t('Ensaio vendido'),
        t('Fazer o contrato no próprio sistema'),
        t('Fazer o alinhamento com a cliente'),
        t('Mover para "Ensaio a realizar"'),
        t('Separar na coluna "Ensaios da semana"'),
        t('Conferir quais ensaios da semana já estão com contrato e alinhamento feitos'),
        { title: 'Enviar a mensagem de lembrança do ensaio (2 dias antes)', due_offset_days: -2, due_offset_ref: 'ensaio' },
        t('Para eventos, cobrar o restante do pagamento antes'),
      ]},
      { title: 'Etapa 2 — Preparação e realização do ensaio', note: 'Cada tipo de ensaio tem sua forma de organização conforme os processos internos.', items: [
        t('Antes do cliente chegar', ['Arrumar o estúdio', 'Varrer e passar pano', 'Conferir café e banheiro', 'Ver se está tudo limpo e organizado', 'Nos ensaios específicos, montar as produções combinadas (ex.: newborn, smash e acompanhamento)']),
        t('Durante o ensaio', ['Recepção do cliente', 'Bastidores', 'Auxílio com as crianças', 'Fazer café e dar suporte aos pais']),
        t('Depois do ensaio', ['Arrumar o estúdio novamente', 'Limpar o que sujou', 'Deixar tudo pronto para o próximo atendimento']),
      ]},
      { title: 'Etapa 3 — Sistema "Enviar fotos"', note: 'Sempre conferir seleção, produtos comprados e fotos extras antes de avançar.', items: [
        t('Importar fotos do SSD para o HD (sempre confirmar se passou tudo)'),
        t('Fazer seleção no Aftershoot'),
        t('Enviar para o cliente selecionar pelo sistema e pelo WhatsApp'),
        t('Cliente selecionou: conferir se a seleção deu certo, ver se comprou álbum e anotar fotos extras'),
        t('Se houver pendência de pagamento: registrar pendência'),
        t('Se não houver pendência: marcar como prontos para editar'),
      ]},
      { title: 'Etapa 4 — Sistema "Edição"', note: 'Essas etapas ajudam a saber em que ponto o ensaio está. Normalmente é feita por Giovana e Talise, mas é importante conhecer o fluxo para informar a cliente.', items: [
        t('Fila de edição'), t('Em edição'), t('Editados'), t('Vídeo a fazer'), t('Revisado'), t('Aprovado'), t('Mandou prévia'),
      ]},
      { title: 'Etapa 5 — Sistema "Revelação"', note: 'Quando os produtos chegarem, essa etapa deve ser feita com urgência. Responsabilidade da Giovana, exceto a etapa 8.', items: [
        t('Fila de edição'), t('Mandou revelar'), t('Defing sendo desenvolvido'), t('Designer finalizar'),
        t('Enviado para aprovação'), t('Aprovado'), t('Mandou para produção'), t('Produto chegou no estúdio'),
        t('Quando o produto chegar', ['Abrir e separar as fotos', 'Embalar o quanto antes', 'Não postergar essa etapa', 'Se tiver álbum: fotografar o álbum', 'Mandar o álbum para a Cris embalar', 'Passar as fotos do álbum para o HD']),
      ]},
      { title: 'Etapa 6 — Sistema "Embalagem"', note: 'Essa etapa exige atenção para não esquecer de avisar nenhum cliente.', items: [
        t('Aguardando embalagens', ['Colocar aqui ensaios que chegaram, mas ainda aguardam embalagem', 'Também usar quando chegou a foto, mas ainda falta o álbum']),
        t('Embalado e pronto', ['Quando já está tudo embalado e pronto para avisar o cliente']),
        t('Avisou o cliente que está pronto', ['Conferir com atenção se a mensagem foi enviada para todos os clientes certos']),
        t('Combinou com o cliente para retirar'),
        t('Retirado', ['Sempre mudar para "Retirado" quando o cliente pegar as fotos']),
      ]},
      { title: 'Etapa 7 — Sistema "Pós-venda"', note: 'Objetivo final: cada cliente deve passar por todas as etapas até o pós-venda, com organização, atenção e carinho.', items: [
        t('Perguntar se deu certo as fotos', ['Sempre perguntar, exceto em casos de clientes que deram trabalho']),
        t('Pedido de avaliação no Google', ['Sempre pedir, exceto em casos de clientes que deram trabalho']),
        t('Não pedimos avaliação'),
        t('Avaliaram no Google', ['Colocar nessa etiqueta todos os clientes que avaliaram']),
      ]},
    ];
    const { data: tpl, error } = await supabase.from('task_templates').insert({
      user_id: userId, name: 'Ensaio Padrão',
      description: 'Fluxo completo de atendimento e produção. Dica: sempre confirmar antes de avançar de etapa, registrar observações no sistema e não deixar pendências para depois.',
    }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    await saveTemplateStructure(supabase, tpl.id, blocks);
    res.json(tpl);
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
          sales_strategy: DEFAULT_SALES_STRATEGY,
          table_missing: true,
        });
      }
      return res.status(500).json({ error: error.message });
    }
    res.json({
      enabled: data?.enabled ?? false,
      auto_send: data?.auto_send ?? false,
      use_client_history: data?.use_client_history ?? false,
      persona: data?.persona || DEFAULT_PERSONA,
      objective: data?.objective || DEFAULT_OBJECTIVE,
      knowledge: data?.knowledge || DEFAULT_KNOWLEDGE,
      rules: data?.rules || DEFAULT_RULES,
      sales_strategy: data?.sales_strategy || DEFAULT_SALES_STRATEGY,
      attendant_name: data?.attendant_name || '',
    });
  });

  app.put('/api/agent/config', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { enabled, auto_send, use_client_history, persona, objective, knowledge, rules, sales_strategy, attendant_name } = req.body;
    const baseRow: any = {
      user_id: userId,
      enabled: !!enabled,
      persona: typeof persona === 'string' ? persona : null,
      objective: typeof objective === 'string' ? objective : null,
      knowledge: typeof knowledge === 'string' ? knowledge : null,
      rules: typeof rules === 'string' ? rules : null,
      updated_at: new Date().toISOString(),
    };
    const row = {
      ...baseRow,
      sales_strategy: typeof sales_strategy === 'string' ? sales_strategy : null,
      ...(auto_send !== undefined ? { auto_send: !!auto_send } : {}),
      ...(use_client_history !== undefined ? { use_client_history: !!use_client_history } : {}),
      ...(attendant_name !== undefined ? { attendant_name: typeof attendant_name === 'string' ? attendant_name.trim() : null } : {}),
    };
    let { error } = await supabase.from('ai_agent_config').upsert(row, { onConflict: 'user_id' });
    // Resiliente: se colunas novas (sales_strategy/auto_send/use_client_history/attendant_name)
    // ainda não existem (migrations 045/046/048/049), salva o resto pra não travar a tela.
    if (error && (error.code === '42703' || /sales_strategy|auto_send|use_client_history|attendant_name/.test(error.message || ''))) {
      ({ error } = await supabase.from('ai_agent_config').upsert(baseRow, { onConflict: 'user_id' }));
    }
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
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { messages, persona, objective, knowledge, rules, sales_strategy, attendant_name } = req.body;
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Envie ao menos uma mensagem.' });
    }
    try {
      // Mesmo cérebro do atendimento autônomo (HANDOFF_INSTRUCTION) pra o teste
      // descer o fluxo REAL — até o envio do orçamento (token ###PDF###) e o
      // hand-off (###HUMANO###). Aqui NADA é enviado: a gente só relata.
      const reply = await getAgentReply(
        {
          enabled: true,
          persona: typeof persona === 'string' ? persona : '',
          objective: typeof objective === 'string' ? objective : '',
          knowledge: typeof knowledge === 'string' ? knowledge : '',
          rules: typeof rules === 'string' ? rules : '',
          salesStrategy: typeof sales_strategy === 'string' ? sales_strategy : '',
          attendantName: typeof attendant_name === 'string' ? attendant_name : '',
        },
        messages,
        { extraInstruction: HANDOFF_INSTRUCTION },
      );

      // Hand-off → a Lia passaria pro humano (no real ela não responde nada).
      if (!reply || reply.includes('###HUMANO###')) {
        return res.json({ reply: '', action: { type: 'handoff' } });
      }
      // Envio do orçamento → checa se o PDF de 'pacote' do nicho está cadastrado.
      const pdfMatch = reply.match(/###PDF:([a-z_]+)###/i);
      if (pdfMatch) {
        const nicho = pdfMatch[1].toLowerCase();
        const followText = reply.replace(/###PDF:[a-z_]+###/i, '').trim();
        // Espelha EXATAMENTE o sendMaterialPdf: só conta como "cadastrado" se a
        // linha tem path E o arquivo baixa do storage (senão o envio real falha).
        let pdfFound = false;
        let fileName: string | null = null;
        try {
          const matClient = supabaseAdmin || supabase;
          const { data: mat } = await matClient
            .from('agente_materiais')
            .select('path, nome_arquivo')
            .eq('user_id', userId).eq('nicho', nicho).eq('tipo', 'pacote')
            .maybeSingle();
          fileName = mat?.nome_arquivo || null;
          if (mat?.path) {
            if (supabaseAdmin) {
              const { data: blob, error: dlErr } = await supabaseAdmin
                .storage.from('agente-materiais').download(mat.path);
              pdfFound = !dlErr && !!blob;
            } else {
              pdfFound = true; // sem service role não dá pra checar o storage; a linha existe
            }
          }
        } catch { /* sem materiais / falha de storage → trata como não cadastrado */ }
        return res.json({ reply: followText, action: { type: 'orcamento', nicho, pdfFound, fileName } });
      }
      res.json({ reply, action: null });
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
          salesStrategy: data?.sales_strategy || '',
          attendantName: data?.attendant_name || '',
        },
        messages,
      );
      res.json({ reply });
    } catch (e: any) {
      console.error('[Agent suggest] erro:', e?.message || e);
      res.status(500).json({ error: e?.message || 'Erro ao gerar a sugestão.' });
    }
  });

  // ── Painel "Atendimentos da Lia" (Fase 3 agêntica) ─────────────────
  // Lista as conversas que a Lia tocou, em 3 baldes: precisa de humano (hand-off),
  // orçamento enviado (aguardando), e Lia conversando. Só leitura, escopo do user.
  app.get('/api/agent/atendimentos', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const db = supabaseAdmin || ((req as any).supabase as SupabaseClient);
    const emptyResp = { items: [] as any[], counts: { precisa_humano: 0, orcamento: 0, conversando: 0, total: 0 } };
    try {
      let { data: convData, error: convErr } = await db.from('wa_conversations')
        .select('phone, contact_name, last_message, last_message_at, needs_human, unread_count, last_agent_reply_at')
        .eq('user_id', userId)
        .order('last_message_at', { ascending: false })
        .limit(300);
      // Resiliente: se a coluna last_agent_reply_at ainda não existe (migration 051),
      // cai pra só as conversas marcadas como needs_human.
      if (convErr && (convErr.code === '42703' || /last_agent_reply_at/.test(convErr.message || ''))) {
        const r = await db.from('wa_conversations')
          .select('phone, contact_name, last_message, last_message_at, needs_human, unread_count')
          .eq('user_id', userId).eq('needs_human', true)
          .order('last_message_at', { ascending: false }).limit(300);
        convData = r.data as any; convErr = r.error as any;
      } else if (convErr) {
        throw convErr;
      }
      const convs = (convData || []).filter((c: any) => c.needs_human || c.last_agent_reply_at);
      if (convs.length === 0) return res.json(emptyResp);

      const [{ data: deals }, { data: stages }, { data: fups }] = await Promise.all([
        db.from('deals').select('id, stage, contact_phone').eq('user_id', userId),
        db.from('deal_stages').select('id, name').eq('user_id', userId),
        db.from('scheduled_followups').select('deal_id, status, scheduled_at')
          .eq('user_id', userId).eq('message', AGENT_FOLLOWUP_SENTINEL).in('status', ['pending', 'sent']),
      ]);
      const stageName = new Map((stages || []).map((s: any) => [s.id, s.name]));
      const fupByDeal = new Map<any, any>();
      for (const f of (fups || [])) {
        const prev = fupByDeal.get(f.deal_id);
        if (!prev || (f.scheduled_at || '') > (prev.scheduled_at || '')) fupByDeal.set(f.deal_id, f);
      }
      // Indexa os deals por dígitos UMA vez (em vez de varrer todos os deals por
      // conversa) — o painel faz poll de 30s, então evita O(conversas × deals).
      const dealByDigits = new Map<string, any>();
      for (const dl of (deals || [])) {
        const dd = lerDigitos(dl.contact_phone || '');
        if (!dd) continue;
        const sh = dd.startsWith('55') ? dd.slice(2) : dd;
        for (const k of [dd, sh, '55' + sh]) if (k && !dealByDigits.has(k)) dealByDigits.set(k, dl);
      }
      const dealForPhone = (phone: string) => {
        const d = lerDigitos(phone);
        const short = d.startsWith('55') ? d.slice(2) : d;
        for (const k of [d, short, '55' + short]) { const hit = dealByDigits.get(k); if (hit) return hit; }
        return undefined;
      };
      const orcRe = /or[çc]amento.*enviad|enviad.*or[çc]amento/i;
      const items = convs.map((c: any) => {
        const deal = dealForPhone(c.phone);
        const sName = deal ? (stageName.get(deal.stage) || '') : '';
        const fup = deal ? fupByDeal.get(deal.id) : null;
        let bucket: 'precisa_humano' | 'orcamento' | 'conversando';
        if (c.needs_human) bucket = 'precisa_humano';
        else if (orcRe.test(sName)) bucket = 'orcamento';
        else bucket = 'conversando';
        return {
          phone: c.phone,
          contact_name: c.contact_name || null,
          last_message: c.last_message || '',
          last_message_at: c.last_message_at || c.last_agent_reply_at || null,
          unread_count: c.unread_count || 0,
          stage_name: sName || null,
          followup_status: fup?.status || null,
          followup_at: fup?.scheduled_at || null,
          bucket,
        };
      });
      const counts = {
        precisa_humano: items.filter((i) => i.bucket === 'precisa_humano').length,
        orcamento: items.filter((i) => i.bucket === 'orcamento').length,
        conversando: items.filter((i) => i.bucket === 'conversando').length,
        total: items.length,
      };
      res.json({ items, counts });
    } catch (e: any) {
      console.error('[Agent atendimentos] erro:', e?.message || e);
      res.status(500).json({ error: e?.message || 'Erro ao listar atendimentos.' });
    }
  });

  // Devolve uma conversa pra Lia (limpa needs_human → o autônomo volta a responder).
  app.post('/api/agent/atendimentos/:phone/devolver', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const db = supabaseAdmin || ((req as any).supabase as SupabaseClient);
    const phone = String(req.params.phone || '').replace(/\D/g, '');
    if (!phone) return res.status(400).json({ error: 'phone inválido' });
    try {
      await db.from('wa_conversations').update({ needs_human: false })
        .eq('user_id', userId).eq('phone', phone);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || 'Erro ao devolver pra Lia.' });
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

  // ============ NOTA FISCAL (NFS-e via PlugNotas) ============
  // Bloco multi-tenant. Cada estúdio tem a sua config fiscal + suas notas.
  // Regra: a nota só sai DEPOIS do ensaio realizado, pelo valor cheio do serviço
  // (o sinal de 30% é pagamento, não gera nota). Gateado por permissão 'finance'.
  const fiscalDb = (req: any) => (supabaseAdmin || (req as any).supabase) as SupabaseClient;
  const fiscalEnv = (cfg: any): plugnotas.PlugEnv =>
    cfg?.environment === 'production' ? 'production' : 'sandbox';

  async function getFiscalConfig(req: any) {
    const userId = (req as any).userId;
    const { data } = await fiscalDb(req)
      .from('fiscal_config').select('*').eq('user_id', userId).maybeSingle();
    return data;
  }

  // Config fiscal do estúdio (dados do emitente + serviço).
  app.get('/api/fiscal/config', requireAuth, requirePermission('finance'), async (req, res) => {
    const cfg = await getFiscalConfig(req);
    res.json(cfg || null);
  });

  app.put('/api/fiscal/config', requireAuth, requirePermission('finance'), async (req, res) => {
    const userId = (req as any).userId;
    // Nunca aceita certificado/senha aqui (vai por rota própria, vai pro PlugNotas).
    const { certificado, senha, pfxBase64, user_id, created_at, ...rest } = req.body || {};
    const row = { ...rest, user_id: userId, updated_at: new Date().toISOString() };
    const { error } = await fiscalDb(req)
      .from('fiscal_config').upsert(row, { onConflict: 'user_id' });
    if (error) return res.status(500).json({ error: error.message });
    res.json(await getFiscalConfig(req));
  });

  // Cadastra/atualiza o emitente no PlugNotas a partir da config salva.
  app.post('/api/fiscal/empresa', requireAuth, requirePermission('finance'), async (req, res) => {
    const userId = (req as any).userId;
    const cfg = await getFiscalConfig(req);
    if (!cfg?.cnpj || !cfg?.razao_social) {
      return res.status(400).json({ error: 'Preencha ao menos CNPJ e razão social antes de cadastrar a empresa.' });
    }
    const env = fiscalEnv(cfg);
    const payload: plugnotas.EmpresaPayload = {
      cpfCnpj: String(cfg.cnpj).replace(/\D/g, ''),
      inscricaoMunicipal: cfg.inscricao_municipal || undefined,
      inscricaoEstadual: cfg.inscricao_estadual || undefined,
      razaoSocial: cfg.razao_social,
      nomeFantasia: cfg.nome_fantasia || undefined,
      simplesNacional: cfg.simples_nacional ?? true,
      regimeTributario: cfg.regime_tributario ?? undefined,
      incentivadorCultural: cfg.incentivo_cultural ?? false,
      email: cfg.email || undefined,
      endereco: {
        logradouro: cfg.logradouro || '', numero: cfg.numero || '',
        complemento: cfg.complemento || undefined, bairro: cfg.bairro || '',
        codigoCidade: cfg.codigo_cidade || '', descricaoCidade: cfg.cidade || undefined,
        estado: cfg.estado || '', cep: String(cfg.cep || '').replace(/\D/g, ''),
      },
    };
    try {
      const exist = await plugnotas.consultarEmpresa(env, payload.cpfCnpj);
      const r = exist.ok
        ? await plugnotas.atualizarEmpresa(env, payload.cpfCnpj, payload)
        : await plugnotas.cadastrarEmpresa(env, payload);
      if (!r.ok) return res.status(400).json({ error: r.data?.error?.message || r.data?.message || 'Erro ao cadastrar empresa no PlugNotas.', detail: r.data });
      await fiscalDb(req).from('fiscal_config')
        .update({ empresa_cadastrada: true, updated_at: new Date().toISOString() })
        .eq('user_id', userId);
      res.json({ success: true, data: r.data });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || 'Falha ao falar com o PlugNotas.' });
    }
  });

  // Upload do certificado A1 (.pfx em base64) → vai pro PlugNotas, não fica aqui.
  app.post('/api/fiscal/certificado', requireAuth, requirePermission('finance'), async (req, res) => {
    const userId = (req as any).userId;
    const { pfxBase64, senha } = req.body || {};
    if (!pfxBase64 || !senha) return res.status(400).json({ error: 'Envie o arquivo .pfx e a senha.' });
    const cfg = await getFiscalConfig(req);
    if (!cfg?.cnpj) return res.status(400).json({ error: 'Cadastre o CNPJ na config antes do certificado.' });
    try {
      const buf = Buffer.from(String(pfxBase64).replace(/^data:.*;base64,/, ''), 'base64');
      const r = await plugnotas.enviarCertificado(fiscalEnv(cfg), String(cfg.cnpj).replace(/\D/g, ''), buf, String(senha));
      if (!r.ok) return res.status(400).json({ error: r.data?.error?.message || r.data?.message || 'Certificado recusado pelo PlugNotas.', detail: r.data });
      const validade = r.data?.vencimento || r.data?.validade || null;
      await fiscalDb(req).from('fiscal_config')
        .update({ certificado_enviado: true, certificado_validade: validade, updated_at: new Date().toISOString() })
        .eq('user_id', userId);
      res.json({ success: true, validade });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || 'Falha ao enviar o certificado.' });
    }
  });

  // Emite a NFS-e de um ensaio JÁ REALIZADO, pelo valor cheio do serviço.
  app.post('/api/fiscal/nfse', requireAuth, requirePermission('finance'), async (req, res) => {
    const userId = (req as any).userId;
    const { job_id, deal_id, client_id, valor, discriminacao, tomador, enviarEmail } = req.body || {};
    if (!valor || Number(valor) <= 0) return res.status(400).json({ error: 'Informe o valor do serviço.' });
    if (!tomador?.cpfCnpj || !tomador?.razaoSocial) return res.status(400).json({ error: 'Informe nome e CPF/CNPJ do cliente (tomador).' });
    const cfg = await getFiscalConfig(req);
    if (!cfg?.empresa_cadastrada || !cfg?.certificado_enviado) {
      return res.status(400).json({ error: 'Configure a empresa e o certificado antes de emitir.' });
    }
    const db = fiscalDb(req);
    // Cria a linha primeiro (id idempotente que vai como idIntegracao no PlugNotas).
    const { data: inv, error: insErr } = await db.from('fiscal_invoices').insert({
      user_id: userId, job_id: job_id || null, deal_id: deal_id || null, client_id: client_id || null,
      tipo: 'nfse', status: 'processando', valor: Number(valor),
      tomador_nome: tomador.razaoSocial, tomador_doc: String(tomador.cpfCnpj).replace(/\D/g, ''),
      discriminacao: discriminacao || cfg.servico_discriminacao || 'Serviço de fotografia',
    }).select().single();
    if (insErr) return res.status(500).json({ error: insErr.message });
    try {
      const payload = plugnotas.montarNfse(cfg as any, {
        idIntegracao: inv.id, valor: Number(valor),
        discriminacao: inv.discriminacao, tomador, enviarEmail: !!enviarEmail,
      });
      const r = await plugnotas.emitirNfse(fiscalEnv(cfg), [payload]);
      const doc = Array.isArray(r.data) ? r.data[0] : (r.data?.documents?.[0] || r.data);
      const providerId = doc?.id || doc?.idIntegracao || null;
      if (!r.ok) {
        const msg = r.data?.error?.message || doc?.mensagem || r.data?.message || 'Erro ao emitir no PlugNotas.';
        await db.from('fiscal_invoices').update({ status: 'erro', error_message: msg, provider_id: providerId, updated_at: new Date().toISOString() }).eq('id', inv.id);
        return res.status(400).json({ error: msg, detail: r.data });
      }
      await db.from('fiscal_invoices').update({ provider_id: providerId, emitida_em: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', inv.id);
      res.json({ success: true, id: inv.id, provider_id: providerId });
    } catch (e: any) {
      await db.from('fiscal_invoices').update({ status: 'erro', error_message: e?.message || 'falha', updated_at: new Date().toISOString() }).eq('id', inv.id);
      res.status(500).json({ error: e?.message || 'Falha ao emitir a nota.' });
    }
  });

  app.get('/api/fiscal/nfse', requireAuth, requirePermission('finance'), async (req, res) => {
    const userId = (req as any).userId;
    const { data, error } = await fiscalDb(req).from('fiscal_invoices')
      .select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(500);
    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
  });

  // Atualiza o status da nota consultando o PlugNotas (autorizada/rejeitada).
  app.post('/api/fiscal/nfse/:id/refresh', requireAuth, requirePermission('finance'), async (req, res) => {
    const userId = (req as any).userId;
    const db = fiscalDb(req);
    const { data: inv } = await db.from('fiscal_invoices').select('*').eq('id', req.params.id).eq('user_id', userId).maybeSingle();
    if (!inv) return res.status(404).json({ error: 'Nota não encontrada.' });
    if (!inv.provider_id) return res.json(inv);
    const cfg = await getFiscalConfig(req);
    const r = await plugnotas.consultarNfse(fiscalEnv(cfg), inv.provider_id);
    const d = Array.isArray(r.data) ? r.data[0] : r.data;
    const map: Record<string, string> = { CONCLUIDO: 'autorizada', AUTORIZADO: 'autorizada', REJEITADO: 'rejeitada', CANCELADO: 'cancelada', PROCESSANDO: 'processando', NEGADO: 'rejeitada' };
    const status = map[(d?.situacao || d?.status || '').toUpperCase()] || inv.status;
    const upd: any = { status, updated_at: new Date().toISOString() };
    if (d?.numero) upd.numero = String(d.numero);
    if (d?.codigoVerificacao) upd.codigo_verificacao = String(d.codigoVerificacao);
    if (d?.pdf || d?.linkPdf) upd.pdf_url = d.pdf || d.linkPdf;
    if (d?.xml || d?.linkXml) upd.xml_url = d.xml || d.linkXml;
    if (status === 'rejeitada') upd.error_message = d?.mensagem || d?.motivo || 'Rejeitada pela prefeitura.';
    await db.from('fiscal_invoices').update(upd).eq('id', inv.id);
    res.json({ ...inv, ...upd });
  });

  app.post('/api/fiscal/nfse/:id/cancelar', requireAuth, requirePermission('finance'), async (req, res) => {
    const userId = (req as any).userId;
    const justificativa = String(req.body?.justificativa || '').trim();
    if (justificativa.length < 15) return res.status(400).json({ error: 'A justificativa precisa de pelo menos 15 caracteres.' });
    const db = fiscalDb(req);
    const { data: inv } = await db.from('fiscal_invoices').select('*').eq('id', req.params.id).eq('user_id', userId).maybeSingle();
    if (!inv?.provider_id) return res.status(400).json({ error: 'Nota sem registro no provedor.' });
    const cfg = await getFiscalConfig(req);
    const r = await plugnotas.cancelarNfse(fiscalEnv(cfg), inv.provider_id, justificativa);
    if (!r.ok) return res.status(400).json({ error: r.data?.error?.message || r.data?.message || 'Erro ao cancelar.', detail: r.data });
    await db.from('fiscal_invoices').update({ status: 'cancelada', updated_at: new Date().toISOString() }).eq('id', inv.id);
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

    const planLimits = await getPlanLimits(ownerId);
    res.json({
      isMember: (req as any).isMember ?? false,
      permissions: (req as any).memberPermissions ?? null,
      isPlatformAdmin: (req as any).isPlatformAdmin ?? false,
      isImpersonating: (req as any).isImpersonating ?? false,
      impersonatingOwnerId: (req as any).isImpersonating ? (req as any).userId : null,
      productionOnly: isProductionOnly(req),
      currentMember,
      // Features liberadas pelo plano (default-allow; só false bloqueia).
      planFeatures: {
        gallery: planLimits?.gallery !== false,
        album: planLimits?.album !== false,
        storage_gb: Number(planLimits?.storage_gb || 0),
        // Bloco Nota Fiscal (NFS-e). Default-allow por enquanto (igual galeria/álbum);
        // na fase de venda, planos que não incluem marcam nota_fiscal=false.
        nota_fiscal: planLimits?.nota_fiscal !== false,
      },
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

  // Uso de armazenamento (galeria + álbum) vs limite do plano (GB).
  app.get('/api/billing/storage', requireAuth, async (req, res) => {
    const ownerId = (req as any).userId;
    const fresh = req.query.fresh === '1';
    const limits = await getPlanLimits(ownerId);
    const capGb = planStorageGb(limits);
    if (capGb <= 0) return res.json({ enabled: false, used_gb: 0, cap_gb: 0, pct: 0 });
    const usedBytes = await getStorageUsageBytes(ownerId, fresh);
    const usedGb = usedBytes / 1e9;
    res.json({
      enabled: true,
      used_gb: Math.round(usedGb * 100) / 100,
      cap_gb: capGb,
      pct: Math.min(100, Math.round((usedGb / capGb) * 100)),
    });
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

  // ════════════════════════════════════════════════════════════════════════
  // GALERIA DE PROOFING — seleção de fotos pelo cliente final
  // Tabelas: galleries, gallery_photos, gallery_selections, gallery_payments,
  // gallery_settings (migrations/026_galleries.sql).
  // Buckets: galeria-originais (privado) + galeria-previews (público, com
  // marca d'água queimada — original nunca sai do bucket privado).
  // Rotas públicas (/api/public/gallery/*) validam pelo share_token, sem auth.
  // ════════════════════════════════════════════════════════════════════════

  const GALLERY_ORIGINALS_BUCKET = 'galeria-originais';
  const GALLERY_PREVIEWS_BUCKET = 'galeria-previews';
  const GALLERY_STATUSES = ['draft', 'sent', 'selected', 'delivered'];

  // ── Uso de armazenamento por tenant (galeria + álbum) ─────────────────────
  // Soma os bytes nos buckets sob o prefixo do user. Recursivo + cache 5min.
  // FAIL-OPEN: qualquer erro → retorna o que tiver (nunca trava upload por bug
  // de medição).
  const storageUsageCache = new Map<string, { bytes: number; at: number }>();
  const STORAGE_TTL = 5 * 60 * 1000;
  async function sumBucketPrefix(bucket: string, prefix: string, depth = 0): Promise<number> {
    if (!supabaseAdmin || depth > 6) return 0;
    let total = 0;
    try {
      // Pagina (1000 por página) — pasta com muitas fotos não pode subcontar.
      let offset = 0;
      for (;;) {
        const { data } = await supabaseAdmin.storage.from(bucket).list(prefix, { limit: 1000, offset });
        const items = data || [];
        for (const item of items) {
          const isFolder = (item as any).id == null && (item as any).metadata == null;
          if (isFolder) {
            total += await sumBucketPrefix(bucket, prefix ? `${prefix}/${item.name}` : item.name, depth + 1);
          } else {
            total += Number((item as any).metadata?.size || 0);
          }
        }
        if (items.length < 1000) break;
        offset += 1000;
        if (offset > 200000) break; // teto de segurança
      }
    } catch { /* fail-open */ }
    return total;
  }
  async function getStorageUsageBytes(userId: string, fresh = false): Promise<number> {
    const c = storageUsageCache.get(userId);
    if (!fresh && c && Date.now() - c.at < STORAGE_TTL) return c.bytes;
    let bytes = 0;
    for (const b of [GALLERY_ORIGINALS_BUCKET, GALLERY_PREVIEWS_BUCKET, 'album-assets']) {
      bytes += await sumBucketPrefix(b, userId);
    }
    storageUsageCache.set(userId, { bytes, at: Date.now() });
    return bytes;
  }
  // Checa se cabe `incomingBytes` no plano. Retorna {ok, usedGb, capGb}. capGb=0
  // (Start/Pro/sem plano) → sem trava de espaço aqui (galeria/álbum já é barrado
  // antes pelo gating de feature).
  async function storageWouldFit(userId: string, incomingBytes: number): Promise<{ ok: boolean; usedGb: number; capGb: number }> {
    const limits = await getPlanLimits(userId);
    const capGb = planStorageGb(limits);
    if (capGb <= 0) return { ok: true, usedGb: 0, capGb: 0 };
    const used = await getStorageUsageBytes(userId);
    const cap = capGb * 1_000_000_000;
    return { ok: used + Math.max(0, incomingBytes) <= cap, usedGb: used / 1e9, capGb };
  }

  let galleryBucketsReady = false;
  async function ensureGalleryBuckets() {
    if (galleryBucketsReady || !supabaseAdmin) return;
    try {
      const { data: buckets } = await supabaseAdmin.storage.listBuckets();
      const names = new Set((buckets || []).map((b: any) => b.name));
      if (!names.has(GALLERY_ORIGINALS_BUCKET)) {
        await supabaseAdmin.storage.createBucket(GALLERY_ORIGINALS_BUCKET, {
          public: false,
          fileSizeLimit: 52_428_800, // 50MB por original
        });
      }
      if (!names.has(GALLERY_PREVIEWS_BUCKET)) {
        await supabaseAdmin.storage.createBucket(GALLERY_PREVIEWS_BUCKET, { public: true });
      }
      galleryBucketsReady = true;
    } catch (e: any) {
      console.error('[galeria] erro criando buckets:', e?.message);
    }
  }

  const galleryPublicBase = () =>
    (process.env.APP_PUBLIC_URL || 'https://crmtrilha.com.br').replace(/\/$/, '');
  const galleryLink = (token: string) => `${galleryPublicBase()}/g/${token}`;
  const newGalleryToken = () => crypto.randomBytes(18).toString('base64url');

  const previewPublicUrl = (p: string | null | undefined): string | null => {
    if (!p || !supabaseAdmin) return null;
    return supabaseAdmin.storage.from(GALLERY_PREVIEWS_BUCKET).getPublicUrl(p).data.publicUrl || null;
  };

  const galleryTableMissing = (error: any) => error?.code === '42P01';
  const galleryMigrationError = (res: express.Response) =>
    res.status(400).json({ error: 'Tabelas da galeria não existem. Rode a migration 026_galleries.sql no Supabase.' });

  const GALLERY_SETTINGS_DEFAULTS = {
    watermark_type: 'text',
    watermark_text: null as string | null,
    watermark_logo_path: null as string | null,
    watermark_opacity: 0.3,
    watermark_include_client: false,
    watermark_mode: 'tiled' as 'tiled' | 'centered',
    sender_email: null as string | null,
    notify_studio_whatsapp: true,
    mp_access_token: null as string | null,
    categories: ['Gestante', 'Newborn', 'Casamento', 'Família'],
    protection: { right_click: true, drag: true, notice: true },
    custom_domain: null as string | null,
    deadline_presets: [7, 15, 30] as number[],
  };

  async function getGallerySettings(userId: string): Promise<any> {
    if (!supabaseAdmin) return { ...GALLERY_SETTINGS_DEFAULTS };
    const { data } = await supabaseAdmin
      .from('gallery_settings')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
    return { ...GALLERY_SETTINGS_DEFAULTS, ...(data || {}) };
  }

  async function getStudioNameForGallery(userId: string): Promise<string> {
    if (!supabaseAdmin) return 'Estúdio';
    const { data } = await supabaseAdmin
      .from('studio_settings')
      .select('studio_name')
      .eq('user_id', userId)
      .maybeSingle();
    return data?.studio_name || 'Estúdio';
  }

  // Logo do estúdio (company_info.logo_url) pra exibir nas telas do cliente
  // (login + cabeçalho da galeria pública). Null quando não há logo cadastrada.
  async function getStudioLogoForGallery(userId: string): Promise<string | null> {
    if (!supabaseAdmin) return null;
    const { data } = await supabaseAdmin
      .from('company_info')
      .select('logo_url')
      .eq('user_id', userId)
      .maybeSingle();
    return data?.logo_url || null;
  }

  // Preço default da foto extra vem do studio_settings ('35,00' → 35).
  async function getDefaultExtraPrice(userId: string): Promise<number> {
    if (!supabaseAdmin) return 35;
    const { data } = await supabaseAdmin
      .from('studio_settings')
      .select('extra_photo_price')
      .eq('user_id', userId)
      .maybeSingle();
    const n = Number(String(data?.extra_photo_price ?? '').replace(',', '.'));
    return Number.isFinite(n) && n > 0 ? n : 35;
  }

  // Agrega contagens/valores que os cards do kanban mostram.
  async function decorateGalleries(supabase: SupabaseClient, rows: any[]): Promise<any[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((g) => g.id);
    const [photosQ, selectionsQ, paymentsQ] = await Promise.all([
      supabase.from('gallery_photos').select('id, gallery_id, thumb_path, sort_order, created_at').in('gallery_id', ids),
      supabase.from('gallery_selections').select('gallery_id, selected').in('gallery_id', ids).eq('selected', true),
      supabase.from('gallery_payments').select('gallery_id, amount, status').in('gallery_id', ids),
    ]);

    const photoCount = new Map<string, number>();
    const coverThumb = new Map<string, string>();
    const sortedPhotos = (photosQ.data || []).sort(
      (a: any, b: any) => (a.sort_order - b.sort_order) || String(a.created_at).localeCompare(String(b.created_at)),
    );
    for (const p of sortedPhotos) {
      photoCount.set(p.gallery_id, (photoCount.get(p.gallery_id) || 0) + 1);
      if (!coverThumb.has(p.gallery_id) && p.thumb_path) coverThumb.set(p.gallery_id, p.thumb_path);
    }

    const selCount = new Map<string, number>();
    for (const s of selectionsQ.data || []) selCount.set(s.gallery_id, (selCount.get(s.gallery_id) || 0) + 1);

    const paidBy = new Map<string, number>();
    for (const p of paymentsQ.data || []) {
      if (p.status === 'paid') paidBy.set(p.gallery_id, (paidBy.get(p.gallery_id) || 0) + Number(p.amount || 0));
    }

    return rows.map((g) => {
      const photo_count = photoCount.get(g.id) || 0;
      const selected_count = selCount.get(g.id) || 0;
      const extra_count = Math.max(0, selected_count - (g.included_count || 0));
      const paid_amount = paidBy.get(g.id) || 0;
      const extraTotal = extra_count * Number(g.extra_price || 0);
      return {
        ...g,
        extra_price: Number(g.extra_price || 0),
        photo_count,
        selected_count,
        extra_count,
        paid_amount,
        pending_amount: Math.max(0, extraTotal - paid_amount),
        cover_thumb_url: previewPublicUrl(coverThumb.get(g.id)),
      };
    });
  }

  // Gancho do PUT /api/jobs/:id: job entrou em etapa FINAL de produção →
  // cria galeria draft automaticamente (1 por job, idempotente).
  async function maybeCreateGalleryForJob(
    supabase: SupabaseClient,
    userId: string,
    jobId: number,
    newStageId: string | null | undefined,
  ): Promise<void> {
    // RLS ligado nas tabelas da galeria: usa service role (toda query filtra por user_id)
    supabase = (supabaseAdmin || supabase) as SupabaseClient;
    if (!newStageId) return;
    const stages = await ensureProductionStagesV2(supabase, userId);
    const stage = stages.find((s) => s.id === newStageId);
    if (!stage?.is_final) return;

    const { data: existing, error } = await supabase
      .from('galleries').select('id').eq('job_id', jobId).eq('user_id', userId).limit(1);
    if (error || (existing && existing.length > 0)) return; // tabela ausente ou galeria já existe

    const { data: job } = await supabase
      .from('jobs')
      .select('id, job_name, job_type, client_id, clients(name, email, phone)')
      .eq('id', jobId)
      .eq('user_id', userId)
      .maybeSingle();
    if (!job) return;

    const client: any = (job as any).clients || {};
    await supabase.from('galleries').insert({
      user_id: userId,
      job_id: jobId,
      client_id: job.client_id || null,
      client_name: client.name || null,
      client_email: client.email || null,
      client_phone: client.phone || null,
      title: `Seleção — ${(job as any).job_name || (job as any).job_type || `Trabalho ${jobId}`}`,
      category: (job as any).job_type || null,
      status: 'draft',
      share_token: newGalleryToken(),
      included_count: 20,
      extra_price: await getDefaultExtraPrice(userId),
    });
    console.log(`[galeria] galeria draft criada automaticamente pro job ${jobId}`);
  }

  // ── OAuth do Mercado Pago ─────────────────────────────────────────────────
  //
  // Cada estúdio conecta a própria conta MP pra receber direto. UMA app no
  // MP Developers (CRM Trilha), N usuários autorizam acesso. Token cifrado
  // em repouso; refresh automático quando perto de expirar (5 min antes).

  const MP_STATE_CACHE = new Map<string, { userId: string; ts: number }>();
  const MP_STATE_TTL_MS = 10 * 60 * 1000;

  const mpClientId       = () => process.env.MP_CLIENT_ID || '';
  const mpClientSecret   = () => process.env.MP_CLIENT_SECRET || '';
  const mpRedirectUri    = () => process.env.MP_REDIRECT_URI || '';
  const mpConfigured     = () => !!(mpClientId() && mpClientSecret() && mpRedirectUri());

  function pruneMpStates() {
    const now = Date.now();
    for (const [k, v] of MP_STATE_CACHE.entries()) {
      if (now - v.ts > MP_STATE_TTL_MS) MP_STATE_CACHE.delete(k);
    }
  }

  function buildMpAuthUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: mpClientId(),
      response_type: 'code',
      platform_id: 'mp',
      state,
      redirect_uri: mpRedirectUri(),
    });
    return `https://auth.mercadopago.com.br/authorization?${params.toString()}`;
  }

  // Renova o access usando o refresh_token. Devolve o novo access ou null.
  async function refreshMpAccessToken(userId: string, currentSettings: any): Promise<string | null> {
    const refreshToken = decryptIfNeeded(currentSettings.mp_refresh_token || '');
    if (!refreshToken || !mpConfigured() || !supabaseAdmin) return null;
    try {
      const resp = await fetch('https://api.mercadopago.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: mpClientId(),
          client_secret: mpClientSecret(),
          refresh_token: refreshToken,
        }).toString(),
      });
      const data: any = await resp.json().catch(() => null);
      if (!resp.ok || !data?.access_token) {
        console.warn('[MP OAuth] refresh falhou:', resp.status, data?.message || '');
        return null;
      }
      const expiresIn = Number(data.expires_in) || 0;
      await supabaseAdmin.from('gallery_settings').update({
        mp_access_token: encryptIfNeeded(data.access_token),
        mp_refresh_token: encryptIfNeeded(data.refresh_token || refreshToken),
        mp_token_expires_at: expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null,
        updated_at: new Date().toISOString(),
      }).eq('user_id', userId);
      return data.access_token as string;
    } catch (e: any) {
      console.warn('[MP OAuth] refresh erro:', e?.message);
      return null;
    }
  }

  // Pega access válido (renova se expirar em <5min).
  async function getValidMpAccessToken(userId: string): Promise<string | null> {
    const settings = await getGallerySettings(userId);
    if (!settings.mp_access_token) return null;
    const expiresAt = settings.mp_token_expires_at ? new Date(settings.mp_token_expires_at).getTime() : 0;
    if (expiresAt && expiresAt - Date.now() < 5 * 60 * 1000 && settings.mp_refresh_token) {
      const fresh = await refreshMpAccessToken(userId, settings);
      if (fresh) return fresh;
    }
    return decryptIfNeeded(settings.mp_access_token);
  }

  // Inicia OAuth: gera state CSRF, devolve URL pra redirect no front.
  app.get('/api/oauth/mp/start', requireAuth, async (req, res) => {
    if (!mpConfigured()) {
      return res.status(503).json({ error: 'Pagamento ainda não está configurado neste servidor.' });
    }
    const userId = (req as any).userId;
    const state = crypto.randomBytes(24).toString('base64url');
    pruneMpStates();
    MP_STATE_CACHE.set(state, { userId, ts: Date.now() });
    res.json({ url: buildMpAuthUrl(state) });
  });

  // Callback do MP: troca code por token, salva, redireciona pro front.
  app.get('/api/oauth/mp/callback', async (req, res) => {
    const back = (process.env.APP_PUBLIC_URL || 'https://crmtrilha.com.br').replace(/\/$/, '');
    const failRedirect = (reason: string) => res.redirect(`${back}/galeria?mp_error=${encodeURIComponent(reason)}`);

    const code = String(req.query.code || '');
    const state = String(req.query.state || '');
    if (!code || !state) return failRedirect('parametros');

    const stateData = MP_STATE_CACHE.get(state);
    if (!stateData || Date.now() - stateData.ts > MP_STATE_TTL_MS) return failRedirect('expirou');
    MP_STATE_CACHE.delete(state);
    const userId = stateData.userId;

    try {
      const tokenResp = await fetch('https://api.mercadopago.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: mpClientId(),
          client_secret: mpClientSecret(),
          code,
          redirect_uri: mpRedirectUri(),
        }).toString(),
      });
      const tokenData: any = await tokenResp.json().catch(() => null);
      if (!tokenResp.ok || !tokenData?.access_token) {
        console.error('[MP OAuth] troca falhou:', tokenResp.status, tokenData?.message || '');
        return failRedirect('troca');
      }

      const accessToken: string = tokenData.access_token;
      const refreshToken: string = tokenData.refresh_token || '';
      const expiresIn = Number(tokenData.expires_in) || 0;
      const mpUserId = String(tokenData.user_id || '');

      // E-mail do dono — útil pra exibir "Conectado como ...". Best-effort.
      let email = '';
      try {
        const userResp = await fetch('https://api.mercadopago.com/users/me', {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (userResp.ok) {
          const userData: any = await userResp.json().catch(() => null);
          email = String(userData?.email || '');
        }
      } catch { /* ignora */ }

      if (!supabaseAdmin) return failRedirect('storage');
      // Em produção, NÃO grava token de pagamento sem cifra em repouso.
      if (process.env.NODE_ENV === 'production' && !isEncryptionConfigured()) {
        console.error('[MP OAuth] CRÍTICO: WA_TOKEN_ENCRYPTION_KEY ausente — recusando salvar token MP em plaintext.');
        return failRedirect('cifra_ausente');
      }
      await supabaseAdmin.from('gallery_settings').upsert({
        user_id: userId,
        mp_access_token: encryptIfNeeded(accessToken),
        mp_refresh_token: encryptIfNeeded(refreshToken),
        mp_user_id: mpUserId,
        mp_email: email,
        mp_token_expires_at: expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });

      res.redirect(`${back}/galeria?mp_connected=1`);
    } catch (e: any) {
      console.error('[MP OAuth] callback erro:', e?.message);
      failRedirect('erro');
    }
  });

  // Limpa a conexão. Não tenta revogar do lado do MP — só apaga o token.
  app.post('/api/oauth/mp/disconnect', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    if (!supabaseAdmin) return res.status(500).json({ error: 'indisponível' });
    await supabaseAdmin.from('gallery_settings').update({
      mp_access_token: null,
      mp_refresh_token: null,
      mp_user_id: null,
      mp_email: null,
      mp_token_expires_at: null,
      updated_at: new Date().toISOString(),
    }).eq('user_id', userId);
    res.json({ ok: true });
  });

  // ── Configurações da galeria ──────────────────────────────────────────────

  app.get('/api/gallery-settings', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const s = await getGallerySettings(userId);
    const prot = s.protection || {};
    res.json({
      settings: {
        watermark_type: s.watermark_type === 'logo' ? 'logo' : 'text',
        watermark_text: s.watermark_text,
        watermark_logo_path: s.watermark_logo_path,
        watermark_logo_url: previewPublicUrl(s.watermark_logo_path),
        watermark_opacity: Number(s.watermark_opacity ?? 0.3),
        watermark_include_client_name: !!s.watermark_include_client,
        watermark_mode: s.watermark_mode === 'centered' ? 'centered' : 'tiled',
        sender_email: s.sender_email,
        notify_studio_whatsapp: s.notify_studio_whatsapp !== false,
        categories: Array.isArray(s.categories) ? s.categories : [],
        protect_right_click: prot.right_click !== false,
        protect_download: prot.drag !== false,
        custom_domain: s.custom_domain,
        mp_access_token: null, // nunca ecoa o token
        mp_access_token_set: !!s.mp_access_token,
        mp_connected: !!s.mp_user_id,
        mp_email: s.mp_email || null,
        mp_user_id: s.mp_user_id || null,
        mp_oauth_available: mpConfigured(),
        default_included_count: 20,
        default_extra_price: await getDefaultExtraPrice(userId),
        deadline_presets: Array.isArray(s.deadline_presets) && s.deadline_presets.length > 0
          ? s.deadline_presets.map((n: any) => Math.max(1, Math.min(365, Number(n) || 0))).filter(Boolean).slice(0, 6)
          : [7, 15, 30],
        send_message_template: s.send_message_template || GALLERY_SEND_TEMPLATE_DEFAULT,
      },
    });
  });

  // Sobe a logo da marca d'água (data URL) pro bucket público de previews.
  // Path fixo por usuário (logos/{userId}.png) com upsert — trocar substitui.
  async function uploadWatermarkLogo(userId: string, dataUrl: string): Promise<{ path?: string; error?: string }> {
    const match = String(dataUrl || '').match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i);
    if (!match) return { error: 'watermark_logo_base64 inválido (esperado data URL de imagem)' };
    const buffer = Buffer.from(match[2], 'base64');
    if (buffer.length > 2_097_152) return { error: 'Logo muito grande (máx. 2MB)' };
    if (!supabaseAdmin) return { error: 'Storage indisponível' };

    await ensureGalleryBuckets();
    const path = `logos/${userId}.png`;
    const { error } = await supabaseAdmin.storage
      .from(GALLERY_PREVIEWS_BUCKET)
      .upload(path, buffer, { contentType: match[1], upsert: true });
    if (error) return { error: `Upload da logo falhou: ${error.message}` };
    return { path };
  }

  app.put('/api/gallery-settings', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (supabaseAdmin || (req as any).supabase) as SupabaseClient;
    const body = req.body || {};
    const payload: any = { user_id: userId, updated_at: new Date().toISOString() };

    if (body.watermark_type !== undefined) payload.watermark_type = body.watermark_type === 'logo' ? 'logo' : 'text';
    if (body.watermark_text !== undefined) payload.watermark_text = body.watermark_text || null;
    if (body.watermark_logo_path !== undefined) payload.watermark_logo_path = body.watermark_logo_path || null;
    // Logo enviada como data URL: sobe no Storage e grava o path resultante.
    if (typeof body.watermark_logo_base64 === 'string' && body.watermark_logo_base64) {
      const up = await uploadWatermarkLogo(userId, body.watermark_logo_base64);
      if (up.error) return res.status(400).json({ error: up.error });
      payload.watermark_logo_path = up.path;
    }
    if (body.watermark_opacity !== undefined) {
      payload.watermark_opacity = Math.min(1, Math.max(0.05, Number(body.watermark_opacity) || 0.3));
    }
    if (body.watermark_include_client_name !== undefined) payload.watermark_include_client = !!body.watermark_include_client_name;
    if (body.watermark_mode !== undefined) payload.watermark_mode = body.watermark_mode === 'centered' ? 'centered' : 'tiled';
    if (body.sender_email !== undefined) payload.sender_email = body.sender_email || null;
    if (body.notify_studio_whatsapp !== undefined) payload.notify_studio_whatsapp = !!body.notify_studio_whatsapp;
    if (Array.isArray(body.categories)) payload.categories = body.categories.map(String);
    if (Array.isArray(body.deadline_presets)) {
      payload.deadline_presets = body.deadline_presets
        .map((n: any) => Math.max(1, Math.min(365, Math.round(Number(n) || 0))))
        .filter((n: number) => n > 0)
        .slice(0, 6);
    }
    if (body.send_message_template !== undefined) {
      const t = String(body.send_message_template || '').trim();
      payload.send_message_template = t || null; // vazio volta pro padrão do sistema
    }
    if (body.protect_right_click !== undefined || body.protect_download !== undefined) {
      payload.protection = {
        right_click: body.protect_right_click !== false,
        drag: body.protect_download !== false,
        notice: true,
      };
    }
    if (body.custom_domain !== undefined) payload.custom_domain = body.custom_domain || null;
    // Token do Mercado Pago: só grava se vier preenchido (cifrado em repouso).
    if (typeof body.mp_access_token === 'string' && body.mp_access_token.trim()) {
      payload.mp_access_token = encryptIfNeeded(body.mp_access_token.trim());
    }

    const { error } = await supabase.from('gallery_settings').upsert(payload, { onConflict: 'user_id' });
    if (error) {
      return galleryTableMissing(error) ? galleryMigrationError(res) : res.status(500).json({ error: error.message });
    }
    res.json({ ok: true });
  });

  // ── CRUD de galerias (lado do estúdio) ────────────────────────────────────

  app.get('/api/galleries', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (supabaseAdmin || (req as any).supabase) as SupabaseClient;
    let q = supabase.from('galleries').select('*').eq('user_id', userId).order('created_at', { ascending: false });
    if (req.query.job_id) q = q.eq('job_id', Number(req.query.job_id));
    const { data, error } = await q;
    if (error) {
      if (galleryTableMissing(error)) return res.json({ galleries: [], table_missing: true });
      return res.status(500).json({ error: error.message });
    }
    res.json({ galleries: await decorateGalleries(supabase, data || []) });
  });

  // Soma o pendente (extras × preço) de galerias 'selected' que ainda não têm
  // linha em gallery_payments (ex.: finalize sem valor de extra ou row antiga).
  async function pendingAmountWithoutPayment(supabase: SupabaseClient, galleries: any[]): Promise<number> {
    if (galleries.length === 0) return 0;
    const ids = galleries.map((g) => g.id);
    const { data } = await supabase
      .from('gallery_selections').select('gallery_id').in('gallery_id', ids).eq('selected', true);
    const selCount = new Map<string, number>();
    for (const s of data || []) selCount.set(s.gallery_id, (selCount.get(s.gallery_id) || 0) + 1);

    let total = 0;
    for (const g of galleries) {
      const extras = Math.max(0, (selCount.get(g.id) || 0) - (g.included_count || 0));
      total += extras * Number(g.extra_price || 0);
    }
    return total;
  }

  const sumPaymentAmounts = (rows: any[]) => rows.reduce((acc, p) => acc + Number(p.amount || 0), 0);

  // Armazenamento usado pelas fotos da conta (originais; previews/thumbs são
  // ~10% disso e ficam de fora do somatório — o aviso na UI explica).
  // Também registrada ANTES de GET /api/galleries/:id.
  app.get('/api/galleries/storage', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (supabaseAdmin || (req as any).supabase) as SupabaseClient;

    const { data: galleries, error } = await supabase
      .from('galleries').select('id, title, client_name').eq('user_id', userId);
    if (error) {
      return galleryTableMissing(error)
        ? res.json({ total_bytes: 0, photo_count: 0, galleries: [] })
        : res.status(500).json({ error: error.message });
    }
    const list = galleries || [];
    if (list.length === 0) return res.json({ total_bytes: 0, photo_count: 0, galleries: [] });

    const ids = list.map((g: any) => g.id);
    const { data: photos } = await supabase
      .from('gallery_photos').select('gallery_id, bytes').in('gallery_id', ids);

    const byGallery = new Map<string, { bytes: number; count: number }>();
    let total_bytes = 0;
    let photo_count = 0;
    for (const p of photos || []) {
      const acc = byGallery.get(p.gallery_id) || { bytes: 0, count: 0 };
      acc.bytes += Number(p.bytes || 0);
      acc.count += 1;
      byGallery.set(p.gallery_id, acc);
      total_bytes += Number(p.bytes || 0);
      photo_count += 1;
    }

    const detail = list
      .map((g: any) => ({
        id: g.id,
        title: g.title,
        client_name: g.client_name,
        bytes: byGallery.get(g.id)?.bytes || 0,
        photo_count: byGallery.get(g.id)?.count || 0,
      }))
      .filter((g: any) => g.photo_count > 0)
      .sort((a: any, b: any) => b.bytes - a.bytes);

    res.json({ total_bytes, photo_count, galleries: detail });
  });

  // Aba Receita: cards (a receber, recebido no mês, ticket médio) + extrato.
  // IMPORTANTE: registrada ANTES de GET /api/galleries/:id — senão o Express
  // casaria 'revenue' como :id.
  app.get('/api/galleries/revenue', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (supabaseAdmin || (req as any).supabase) as SupabaseClient;

    const { data: payments, error } = await supabase
      .from('gallery_payments')
      .select('gallery_id, order_code, extra_count, amount, status, created_at, paid_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1000);
    if (error) {
      if (galleryTableMissing(error)) {
        return res.json({ to_receive: 0, received_month: 0, avg_ticket: 0, pending_count: 0, orders: [] });
      }
      return res.status(500).json({ error: error.message });
    }

    const { data: galleries } = await supabase
      .from('galleries')
      .select('id, title, client_name, status, included_count, extra_price')
      .eq('user_id', userId);
    const galleryById = new Map((galleries || []).map((g: any) => [g.id, g]));

    const rows = payments || [];
    const pending = rows.filter((p: any) => p.status === 'pending');
    const paid = rows.filter((p: any) => p.status === 'paid');

    // A receber: pendentes + galerias 'selected' sem payment row (sem dupla contagem).
    const withPayment = new Set(rows.map((p: any) => p.gallery_id));
    const awaiting = (galleries || []).filter((g: any) => g.status === 'selected' && !withPayment.has(g.id));
    const to_receive = sumPaymentAmounts(pending) + (await pendingAmountWithoutPayment(supabase, awaiting));

    const monthPrefix = new Date().toISOString().slice(0, 7);
    const paidThisMonth = paid.filter((p: any) => String(p.paid_at || '').startsWith(monthPrefix));

    const orders = rows.slice(0, 200).map((p: any) => ({
      order_code: p.order_code,
      client_name: galleryById.get(p.gallery_id)?.client_name || null,
      gallery_title: galleryById.get(p.gallery_id)?.title || null,
      extra_count: p.extra_count || 0,
      amount: Number(p.amount || 0),
      status: p.status,
      created_at: p.created_at,
      paid_at: p.paid_at || null,
    }));

    res.json({
      to_receive,
      received_month: sumPaymentAmounts(paidThisMonth),
      avg_ticket: paid.length > 0 ? sumPaymentAmounts(paid) / paid.length : 0,
      pending_count: pending.length,
      orders,
    });
  });

  // Quando criada a partir de um job (sem title), herda título/cliente do job.
  async function galleryDefaultsFromJob(supabase: SupabaseClient, userId: string, jobId: number): Promise<any> {
    const { data: job } = await supabase
      .from('jobs')
      .select('id, job_name, job_type, client_id, clients(name, email, phone)')
      .eq('id', jobId)
      .eq('user_id', userId)
      .maybeSingle();
    if (!job) return {};
    const client: any = (job as any).clients || {};
    return {
      title: `Seleção — ${(job as any).job_name || (job as any).job_type || `Trabalho ${jobId}`}`,
      category: (job as any).job_type || null,
      client_id: job.client_id || null,
      client_name: client.name || null,
      client_email: client.email || null,
      client_phone: client.phone || null,
    };
  }

  // ── Presets de galeria (categorias prontas: nº de fotos, prazo, valores,
  //    descontos). Escolher um preset ao criar a galeria preenche tudo. ──────

  const presetTableMissing = (error: any) =>
    error?.code === '42P01' || /gallery_presets/i.test(error?.message || '');

  // Só os campos que o editor de preset suporta hoje (extensível via config JSONB).
  function sanitizePresetConfig(cfg: any): any {
    const c = cfg || {};
    const out: any = {};
    if (['no_charge', 'extra_avulso', 'upgrade_packs', 'sell_all'].includes(c.pricing_mode)) {
      out.pricing_mode = c.pricing_mode;
    }
    if (c.cart_discount !== undefined) out.cart_discount = Math.max(0, Number(c.cart_discount) || 0);
    if (['none', 'single_pct', 'progressive'].includes(c.discount_mode)) out.discount_mode = c.discount_mode;
    if (c.discount_single_pct !== undefined) {
      out.discount_single_pct = Math.min(100, Math.max(0, Number(c.discount_single_pct) || 0));
    }
    if (Array.isArray(c.discount_rules)) {
      out.discount_rules = c.discount_rules
        .map((r: any) => ({
          percent: Math.min(100, Math.max(0, Number(r?.percent) || 0)),
          min_photos: Math.max(1, Math.floor(Number(r?.min_photos) || 0)),
        }))
        .filter((r: any) => r.percent > 0 && r.min_photos >= 1)
        .sort((a: any, b: any) => a.min_photos - b.min_photos)
        .slice(0, 20);
    }
    return out;
  }

  function buildPresetPayload(body: any): any {
    const p: any = {};
    if (body.name !== undefined) p.name = String(body.name || '').trim().slice(0, 80);
    if (body.category !== undefined) p.category = body.category ? String(body.category).slice(0, 60) : null;
    if (body.included_count !== undefined) p.included_count = Math.max(0, Math.floor(Number(body.included_count) || 0));
    if (body.extra_price !== undefined) p.extra_price = Math.max(0, Number(body.extra_price) || 0);
    if (body.deadline_days !== undefined) {
      const d = Math.floor(Number(body.deadline_days));
      p.deadline_days = Number.isFinite(d) && d > 0 ? Math.min(365, d) : null;
    }
    if (body.config !== undefined) p.config = sanitizePresetConfig(body.config);
    if (body.sort_order !== undefined) p.sort_order = Math.floor(Number(body.sort_order) || 0);
    return p;
  }

  // Monta o "corpo" (no formato que buildGalleryPatch entende) a partir de um
  // preset, pra aplicar prazo/cobrança/descontos na galeria recém-criada.
  async function galleryPatchFromPreset(
    supabase: SupabaseClient, userId: string, presetId: string,
  ): Promise<any | null> {
    const { data: preset } = await supabase
      .from('gallery_presets').select('*').eq('id', presetId).eq('user_id', userId).maybeSingle();
    if (!preset) return null;
    const cfg = preset.config || {};
    const out: any = {
      pricing_mode: cfg.pricing_mode,
      cart_discount: cfg.cart_discount,
      discount_mode: cfg.discount_mode,
      discount_single_pct: cfg.discount_single_pct,
      discount_rules: cfg.discount_rules,
    };
    if (preset.deadline_days != null) {
      const d = new Date();
      d.setDate(d.getDate() + Number(preset.deadline_days));
      out.selection_deadline = d.toISOString();
    }
    return out;
  }

  app.get('/api/gallery-presets', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (supabaseAdmin || (req as any).supabase) as SupabaseClient;
    const { data, error } = await supabase
      .from('gallery_presets').select('*').eq('user_id', userId)
      .order('sort_order', { ascending: true }).order('created_at', { ascending: true });
    if (error) {
      if (presetTableMissing(error)) return res.json({ tableMissing: true, presets: [] });
      return res.status(500).json({ error: error.message });
    }
    res.json({ presets: data || [] });
  });

  app.post('/api/gallery-presets', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (supabaseAdmin || (req as any).supabase) as SupabaseClient;
    const payload = buildPresetPayload(req.body || {});
    if (!payload.name) return res.status(400).json({ error: 'Informe o nome do preset.' });
    const { data, error } = await supabase
      .from('gallery_presets').insert({ user_id: userId, ...payload }).select().single();
    if (error) {
      if (presetTableMissing(error)) return res.status(400).json({ error: 'Tabela gallery_presets não existe. Rode a migration 055_gallery_presets.sql no Supabase.', table_missing: true });
      return res.status(500).json({ error: error.message });
    }
    res.json({ preset: data });
  });

  app.put('/api/gallery-presets/:id', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (supabaseAdmin || (req as any).supabase) as SupabaseClient;
    const payload = buildPresetPayload(req.body || {});
    if (payload.name !== undefined && !payload.name) return res.status(400).json({ error: 'Informe o nome do preset.' });
    const { data, error } = await supabase
      .from('gallery_presets')
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq('id', req.params.id).eq('user_id', userId).select().single();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Preset não encontrado' });
    res.json({ preset: data });
  });

  app.post('/api/gallery-presets/:id/duplicate', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (supabaseAdmin || (req as any).supabase) as SupabaseClient;
    const { data: src } = await supabase
      .from('gallery_presets').select('*').eq('id', req.params.id).eq('user_id', userId).maybeSingle();
    if (!src) return res.status(404).json({ error: 'Preset não encontrado' });
    const { data, error } = await supabase.from('gallery_presets').insert({
      user_id: userId,
      name: `${src.name} (cópia)`,
      category: src.category,
      included_count: src.included_count,
      extra_price: src.extra_price,
      deadline_days: src.deadline_days,
      config: src.config || {},
      sort_order: src.sort_order,
    }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ preset: data });
  });

  app.delete('/api/gallery-presets/:id', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (supabaseAdmin || (req as any).supabase) as SupabaseClient;
    const { error } = await supabase
      .from('gallery_presets').delete().eq('id', req.params.id).eq('user_id', userId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  });

  app.post('/api/galleries', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (supabaseAdmin || (req as any).supabase) as SupabaseClient;
    const body = req.body || {};

    // Gating de plano: Galeria só nos planos Studio/Premium.
    if (!planAllowsFeature(await getPlanLimits(userId), 'gallery')) {
      return res.status(403).json({ error: 'A Galeria de seleção está disponível nos planos Studio e Premium.', feature_locked: 'gallery' });
    }

    const jobId = body.job_id ? Number(body.job_id) : null;
    const fromJob = jobId && !body.title ? await galleryDefaultsFromJob(supabase, userId, jobId) : {};
    const title = String(body.title || fromJob.title || '').trim();
    if (!title) return res.status(400).json({ error: 'Informe o título da galeria.' });

    const payload = {
      user_id: userId,
      job_id: jobId,
      client_id: body.client_id ?? fromJob.client_id ?? null,
      client_name: body.client_name ?? fromJob.client_name ?? null,
      client_email: body.client_email ?? fromJob.client_email ?? null,
      client_phone: body.client_phone ?? fromJob.client_phone ?? null,
      title,
      category: body.category ?? fromJob.category ?? null,
      status: 'draft',
      share_token: newGalleryToken(),
      included_count: Math.max(0, Number(body.included_count) || 0),
      extra_price: Math.max(0, Number(body.extra_price) || 0),
    };
    const { data, error } = await supabase.from('galleries').insert(payload).select().single();
    if (error) {
      return galleryTableMissing(error) ? galleryMigrationError(res) : res.status(500).json({ error: error.message });
    }

    // Preset/categoria escolhido: aplica prazo, cobrança e descontos do preset.
    // (nº de fotos, valor extra e categoria já vêm no corpo, pré-preenchidos
    // pelo modal — o usuário pode ter ajustado, então o corpo prevalece neles.)
    let finalRow = data;
    if (body.preset_id) {
      const presetBody = await galleryPatchFromPreset(supabase, userId, String(body.preset_id));
      if (presetBody) {
        await applyGalleryPatchResilient(supabase, userId, data.id, buildGalleryPatch(presetBody));
        const { data: fresh } = await supabase
          .from('galleries').select('*').eq('id', data.id).eq('user_id', userId).maybeSingle();
        if (fresh) finalRow = fresh;
      }
    }

    const [gallery] = await decorateGalleries(supabase, [finalRow]);
    res.json({ gallery });
  });

  app.get('/api/galleries/:id', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (supabaseAdmin || (req as any).supabase) as SupabaseClient;
    const { data: gallery, error } = await supabase
      .from('galleries').select('*').eq('id', req.params.id).eq('user_id', userId).maybeSingle();
    if (error) {
      return galleryTableMissing(error) ? galleryMigrationError(res) : res.status(500).json({ error: error.message });
    }
    if (!gallery) return res.status(404).json({ error: 'Galeria não encontrada' });

    const [photosQ, selectionsQ, decorated] = await Promise.all([
      supabase.from('gallery_photos').select('*').eq('gallery_id', gallery.id).order('sort_order').order('created_at'),
      supabase.from('gallery_selections').select('photo_id, selected, client_comment').eq('gallery_id', gallery.id),
      decorateGalleries(supabase, [gallery]),
    ]);

    res.json({
      gallery: decorated[0],
      photos: (photosQ.data || []).map((p: any) => ({
        id: p.id,
        file_name: p.file_name,
        sort_order: p.sort_order,
        process_status: p.process_status,
        thumb_url: previewPublicUrl(p.thumb_path),
        preview_url: previewPublicUrl(p.preview_path),
        width: p.width,
        height: p.height,
      })),
      selections: selectionsQ.data || [],
    });
  });

  function buildGalleryPatch(body: any): any {
    const patch: any = { updated_at: new Date().toISOString() };
    for (const k of ['title', 'category', 'client_id', 'client_name', 'client_email', 'client_phone']) {
      if (body[k] !== undefined) patch[k] = body[k] || null;
    }
    if (body.included_count !== undefined) patch.included_count = Math.max(0, Number(body.included_count) || 0);
    if (body.extra_price !== undefined) patch.extra_price = Math.max(0, Number(body.extra_price) || 0);
    if (body.selection_deadline !== undefined) patch.selection_deadline = body.selection_deadline || null;
    if (body.status !== undefined && GALLERY_STATUSES.includes(body.status)) {
      patch.status = body.status;
      if (body.status === 'sent') patch.sent_at = new Date().toISOString();
      if (body.status === 'selected') patch.selected_at = new Date().toISOString();
    }
    if (body.require_login !== undefined) patch.require_login = !!body.require_login;
    if (body.download_mode !== undefined && ['off', 'with_watermark', 'clean'].includes(body.download_mode)) {
      patch.download_mode = body.download_mode;
    }
    if (body.pricing_mode !== undefined &&
        ['no_charge', 'extra_avulso', 'upgrade_packs', 'sell_all'].includes(body.pricing_mode)) {
      patch.pricing_mode = body.pricing_mode;
    }
    if (body.cart_discount !== undefined) patch.cart_discount = Math.max(0, Number(body.cart_discount) || 0);
    if (body.discount_mode !== undefined &&
        ['none', 'flat', 'single_pct', 'progressive',
         'progressive_value', 'deadline', 'buy_n_get_m', 'coupon'].includes(body.discount_mode)) {
      patch.discount_mode = body.discount_mode;
    }
    if (body.discount_single_pct !== undefined) {
      patch.discount_single_pct = Math.min(100, Math.max(0, Number(body.discount_single_pct) || 0));
    }
    if (body.discount_rules !== undefined) {
      const rules = Array.isArray(body.discount_rules) ? body.discount_rules : [];
      patch.discount_rules = rules
        .map((r: any) => ({
          percent: Math.min(100, Math.max(0, Number(r?.percent) || 0)),
          min_photos: Math.max(1, Math.floor(Number(r?.min_photos) || 0)),
        }))
        .filter((r: any) => r.percent > 0 && r.min_photos >= 1)
        .sort((a: any, b: any) => a.min_photos - b.min_photos)
        .slice(0, 20);
    }
    // ── novos tipos de desconto (migration 052) ──
    if (body.discount_value_rules !== undefined) {
      patch.discount_value_rules = sanitizeValueRules(body.discount_value_rules);
    }
    if (body.deadline_discount_pct !== undefined) {
      patch.deadline_discount_pct = Math.min(100, Math.max(0, Number(body.deadline_discount_pct) || 0));
    }
    if (body.deadline_discount_until !== undefined) {
      const v = String(body.deadline_discount_until || '').slice(0, 10);
      patch.deadline_discount_until = /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
    }
    if (body.buy_n_group !== undefined) {
      patch.buy_n_group = Math.max(0, Math.floor(Number(body.buy_n_group) || 0));
    }
    if (body.buy_n_free !== undefined) {
      patch.buy_n_free = Math.max(0, Math.floor(Number(body.buy_n_free) || 0));
    }
    if (body.coupons !== undefined) {
      patch.coupons = sanitizeCoupons(body.coupons);
    }
    if (body.lock_after_deadline !== undefined) patch.lock_after_deadline = !!body.lock_after_deadline;
    if (body.cover_layout !== undefined) patch.cover_layout = String(body.cover_layout || 'classic').slice(0, 32);
    if (body.font_family !== undefined) patch.font_family = String(body.font_family || 'sans').slice(0, 32);
    if (body.primary_color !== undefined) {
      const v = String(body.primary_color || '').slice(0, 16);
      patch.primary_color = /^#[0-9A-Fa-f]{3,8}$/.test(v) ? v : '#D4537E';
    }
    return patch;
  }

  // Aplica um patch na galeria tolerando colunas de desconto ainda não migradas:
  // repete a query removendo as ausentes pra não travar o resto do save.
  // Estágio 1: colunas da 052; estágio 2: as da 033.
  async function applyGalleryPatchResilient(
    supabase: SupabaseClient, userId: string, galleryId: string, patch: any,
  ): Promise<{ error: any }> {
    const doUpdate = () => supabase
      .from('galleries').update(patch).eq('id', galleryId).eq('user_id', userId);
    let { error } = await doUpdate();
    if (error && (error as any).code === '42703') {
      delete patch.discount_value_rules;
      delete patch.deadline_discount_pct;
      delete patch.deadline_discount_until;
      delete patch.buy_n_group;
      delete patch.buy_n_free;
      delete patch.coupons;
      ({ error } = await doUpdate());
    }
    if (error && (error as any).code === '42703') {
      delete patch.discount_mode;
      delete patch.discount_single_pct;
      delete patch.discount_rules;
      ({ error } = await doUpdate());
    }
    return { error };
  }

  app.put('/api/galleries/:id', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (supabaseAdmin || (req as any).supabase) as SupabaseClient;
    const patch = buildGalleryPatch(req.body || {});
    const { error } = await applyGalleryPatchResilient(supabase, userId, req.params.id, patch);
    if (error) {
      return galleryTableMissing(error) ? galleryMigrationError(res) : res.status(500).json({ error: error.message });
    }
    res.json({ success: true });
  });

  // Reabre uma galeria finalizada: a cliente volta a poder marcar/trocar
  // fotos. Expira cobrança pendente (o valor pode mudar) e registra no log.
  app.post('/api/galleries/:id/reopen', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (supabaseAdmin || (req as any).supabase) as SupabaseClient;
    const { data: gallery } = await supabase
      .from('galleries').select('id, status').eq('id', req.params.id).eq('user_id', userId).maybeSingle();
    if (!gallery) return res.status(404).json({ error: 'Galeria não encontrada' });
    if (gallery.status !== 'selected' && gallery.status !== 'delivered') {
      return res.status(409).json({ error: 'A galeria não está finalizada.' });
    }

    const { error } = await supabase
      .from('galleries')
      .update({ status: 'sent', selected_at: null, updated_at: new Date().toISOString() })
      .eq('id', gallery.id);
    if (error) return res.status(500).json({ error: error.message });

    await supabaseAdmin?.from('gallery_payments')
      .update({ status: 'expired' })
      .eq('gallery_id', gallery.id)
      .eq('status', 'pending');

    try {
      await supabaseAdmin?.from('gallery_access_log').insert({
        gallery_id: gallery.id,
        access_user_id: null,
        event: 'reopen',
        detail: 'seleção reaberta pelo estúdio',
        ip: 'estudio',
        user_agent: null,
      });
    } catch { /* log é best-effort */ }

    res.json({ ok: true });
  });

  // Remove os arquivos das fotos no Storage (lotes de 100).
  async function removeGalleryStorage(photos: any[]) {
    if (!supabaseAdmin) return;
    const originals = photos.map((p) => p.original_path).filter(Boolean);
    const previews = photos.flatMap((p) => [p.preview_path, p.thumb_path]).filter(Boolean);
    for (let i = 0; i < originals.length; i += 100) {
      await supabaseAdmin.storage.from(GALLERY_ORIGINALS_BUCKET).remove(originals.slice(i, i + 100));
    }
    for (let i = 0; i < previews.length; i += 100) {
      await supabaseAdmin.storage.from(GALLERY_PREVIEWS_BUCKET).remove(previews.slice(i, i + 100));
    }
  }

  app.delete('/api/galleries/:id', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (supabaseAdmin || (req as any).supabase) as SupabaseClient;
    const { data: gallery } = await supabase
      .from('galleries').select('id').eq('id', req.params.id).eq('user_id', userId).maybeSingle();
    if (!gallery) return res.status(404).json({ error: 'Galeria não encontrada' });

    const { data: photos } = await supabase
      .from('gallery_photos').select('original_path, preview_path, thumb_path').eq('gallery_id', gallery.id);
    await removeGalleryStorage(photos || []).catch((e: any) =>
      console.warn('[galeria] limpeza do storage falhou:', e?.message));

    const { error } = await supabase.from('galleries').delete().eq('id', gallery.id).eq('user_id', userId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  });

  // ── Upload + processamento de fotos ───────────────────────────────────────

  // Lote de signed upload URLs: browser sobe o ORIGINAL direto pro bucket
  // privado (não passa pelo backend) e depois chama /process foto a foto.
  app.post('/api/galleries/:id/photos/sign-upload', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (supabaseAdmin || (req as any).supabase) as SupabaseClient;
    if (!supabaseAdmin) return res.status(500).json({ error: 'Storage indisponível.' });
    const files = Array.isArray(req.body?.files) ? req.body.files : [];
    if (files.length === 0 || files.length > 50) {
      return res.status(400).json({ error: 'Envie de 1 a 50 arquivos por lote.' });
    }

    const { data: gallery, error: gErr } = await supabase
      .from('galleries').select('id').eq('id', req.params.id).eq('user_id', userId).maybeSingle();
    if (gErr) {
      return galleryTableMissing(gErr) ? galleryMigrationError(res) : res.status(500).json({ error: gErr.message });
    }
    if (!gallery) return res.status(404).json({ error: 'Galeria não encontrada' });
    await ensureGalleryBuckets();

    // Trava de armazenamento do plano (fail-open: erro de medição não bloqueia).
    const incoming = files.reduce((s: number, f: any) => s + (Number(f?.size) || 0), 0);
    const fit = await storageWouldFit(userId, incoming);
    if (!fit.ok) {
      return res.status(403).json({ error: `Armazenamento cheio (${fit.usedGb.toFixed(1)} de ${fit.capGb} GB). Apague fotos antigas ou suba pro plano Premium.`, storage_full: true });
    }

    const { count } = await supabase
      .from('gallery_photos').select('id', { count: 'exact', head: true }).eq('gallery_id', gallery.id);
    const baseOrder = count || 0;

    const rows = files.map((f: any, i: number) => {
      const id = crypto.randomUUID();
      return {
        id,
        gallery_id: gallery.id,
        file_name: String(f?.name || `foto-${baseOrder + i + 1}.jpg`),
        sort_order: baseOrder + i,
        bytes: Number(f?.size) || null,
        process_status: 'pending',
        original_path: `${userId}/${gallery.id}/${id}/original`,
      };
    });
    const { error: insErr } = await supabase.from('gallery_photos').insert(rows);
    if (insErr) return res.status(500).json({ error: insErr.message });

    const uploads: Array<{ photo_id: string; signed_url: string }> = [];
    for (const r of rows) {
      const { data: signed, error: sErr } = await supabaseAdmin.storage
        .from(GALLERY_ORIGINALS_BUCKET)
        .createSignedUploadUrl(r.original_path);
      if (sErr || !signed) {
        return res.status(500).json({ error: `Falha ao assinar upload: ${sErr?.message || 'desconhecida'}` });
      }
      uploads.push({ photo_id: r.id, signed_url: signed.signedUrl });
    }
    res.json({ uploads });
  });

  async function downloadGalleryObject(bucket: string, objectPath: string): Promise<Buffer> {
    const { data, error } = await supabaseAdmin!.storage.from(bucket).download(objectPath);
    if (error || !data) throw new Error(`download falhou: ${error?.message || 'arquivo vazio'}`);
    return Buffer.from(await data.arrayBuffer());
  }

  async function uploadGalleryPreview(objectPath: string, buf: Buffer) {
    const { error } = await supabaseAdmin!.storage
      .from(GALLERY_PREVIEWS_BUCKET)
      .upload(objectPath, buf, { contentType: 'image/jpeg', upsert: true });
    if (error) throw new Error(`upload do preview falhou: ${error.message}`);
  }

  async function buildWatermarkOpts(userId: string, gallery: any) {
    const s = await getGallerySettings(userId);
    let logo: Buffer | null = null;
    if (s.watermark_type === 'logo' && s.watermark_logo_path) {
      logo = await downloadGalleryObject(GALLERY_PREVIEWS_BUCKET, s.watermark_logo_path).catch(() => null);
    }
    const text = (s.watermark_text || '').trim() || (await getStudioNameForGallery(userId));
    return {
      watermarkType: (logo ? 'logo' : 'text') as 'logo' | 'text',
      watermarkText: text,
      logo,
      opacity: Number(s.watermark_opacity ?? 0.3),
      clientLabel: s.watermark_include_client ? gallery.client_name : null,
      watermarkMode: (s.watermark_mode === 'centered' ? 'centered' : 'tiled') as 'tiled' | 'centered',
    };
  }

  // Trava de concorrência do processamento: no máx. 2 jobs de sharp por vez no
  // servidor (RAM pequena ~512MB). Mesmo se o cliente disparar vários /process,
  // eles entram numa fila e rodam de 2 em 2 — evita OOM e o "processando" eterno.
  let galProcActive = 0;
  const galProcQueue: (() => void)[] = [];
  const acquireProcessSlot = () => new Promise<void>((resolve) => {
    if (galProcActive < 2) { galProcActive++; resolve(); }
    else galProcQueue.push(resolve);
  });
  const releaseProcessSlot = () => {
    galProcActive = Math.max(0, galProcActive - 1);
    const next = galProcQueue.shift();
    if (next) { galProcActive++; next(); }
  };

  // Gera preview 1600px + thumb 400px com marca d'água a partir do original.
  app.post('/api/galleries/:id/photos/:photoId/process', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (supabaseAdmin || (req as any).supabase) as SupabaseClient;
    if (!supabaseAdmin) return res.status(500).json({ error: 'Storage indisponível.' });

    const { data: gallery } = await supabase
      .from('galleries').select('*').eq('id', req.params.id).eq('user_id', userId).maybeSingle();
    if (!gallery) return res.status(404).json({ error: 'Galeria não encontrada' });
    const { data: photo } = await supabase
      .from('gallery_photos').select('*').eq('id', req.params.photoId).eq('gallery_id', gallery.id).maybeSingle();
    if (!photo?.original_path) return res.status(404).json({ error: 'Foto não encontrada' });

    await supabase.from('gallery_photos').update({ process_status: 'processing' }).eq('id', photo.id);
    const basePath = `${userId}/${gallery.id}/${photo.id}`;
    await acquireProcessSlot(); // espera um slot livre (no máx. 2 processando por vez)
    try {
      // Limite de tempo: se download/sharp/upload travar, marca 'error' em vez de
      // deixar a foto presa em "processando" pra sempre (causa do "carregando infinito").
      const out = await Promise.race([
        (async () => {
          // HEIC do iPhone crasha o sharp (precisa de libheif com codec HEVC).
          // O frontend converte pra JPEG antes; aqui é rede de proteção.
          if (/\.heic$|\.heif$/i.test(photo.file_name || '')) {
            throw new Error('Formato HEIC não suportado — converta pra JPEG antes de enviar.');
          }
          const original = await downloadGalleryObject(GALLERY_ORIGINALS_BUCKET, photo.original_path);
          const opts = await buildWatermarkOpts(userId, gallery);
          const processed = await processGalleryPhoto(original, opts);
          await uploadGalleryPreview(`${basePath}/preview.jpg`, processed.preview);
          await uploadGalleryPreview(`${basePath}/thumb.jpg`, processed.thumb);
          return processed;
        })(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('processamento excedeu o tempo limite')), 120_000)),
      ]);

      await supabase.from('gallery_photos').update({
        preview_path: `${basePath}/preview.jpg`,
        thumb_path: `${basePath}/thumb.jpg`,
        width: out.width,
        height: out.height,
        process_status: 'done',
      }).eq('id', photo.id);
      res.json({ ok: true });
    } catch (e: any) {
      console.error('[galeria] processamento falhou:', e?.message);
      await supabase.from('gallery_photos').update({ process_status: 'error' }).eq('id', photo.id);
      res.status(500).json({ error: e?.message || 'Falha ao processar a foto' });
    } finally {
      releaseProcessSlot();
    }
  });

  // Remove em massa as fotos que ficaram com status 'error' (crash do
  // processamento) — útil pra limpar HEIC/originais corrompidos sem
  // apagar uma a uma.
  app.delete('/api/galleries/:id/photos-erro', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (supabaseAdmin || (req as any).supabase) as SupabaseClient;
    const { data: gallery } = await supabase
      .from('galleries').select('id').eq('id', req.params.id).eq('user_id', userId).maybeSingle();
    if (!gallery) return res.status(404).json({ error: 'Galeria não encontrada' });

    const { data: photos } = await supabase
      .from('gallery_photos')
      .select('id, original_path, preview_path, thumb_path')
      .eq('gallery_id', gallery.id)
      .eq('process_status', 'error');
    const list = photos || [];
    if (list.length === 0) return res.json({ removed: 0 });

    await removeGalleryStorage(list).catch(() => {});
    const { error } = await supabase
      .from('gallery_photos').delete().in('id', list.map((p) => p.id));
    if (error) return res.status(500).json({ error: error.message });
    res.json({ removed: list.length });
  });

  app.delete('/api/galleries/:id/photos/:photoId', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (supabaseAdmin || (req as any).supabase) as SupabaseClient;
    const { data: gallery } = await supabase
      .from('galleries').select('id').eq('id', req.params.id).eq('user_id', userId).maybeSingle();
    if (!gallery) return res.status(404).json({ error: 'Galeria não encontrada' });

    const { data: photo } = await supabase
      .from('gallery_photos')
      .select('id, original_path, preview_path, thumb_path')
      .eq('id', req.params.photoId)
      .eq('gallery_id', gallery.id)
      .maybeSingle();
    if (!photo) return res.status(404).json({ error: 'Foto não encontrada' });

    await removeGalleryStorage([photo]).catch(() => {});
    const { error } = await supabase.from('gallery_photos').delete().eq('id', photo.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  });

  // Exclusão em massa de fotos selecionadas pelo fotógrafo (multi-seleção na UI).
  // Recebe { photo_ids: string[] } e remove storage + linhas de uma vez.
  app.post('/api/galleries/:id/photos/bulk-delete', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (supabaseAdmin || (req as any).supabase) as SupabaseClient;
    const { data: gallery } = await supabase
      .from('galleries').select('id').eq('id', req.params.id).eq('user_id', userId).maybeSingle();
    if (!gallery) return res.status(404).json({ error: 'Galeria não encontrada' });

    const ids = Array.isArray(req.body?.photo_ids)
      ? req.body.photo_ids.map((x: any) => String(x)).filter(Boolean)
      : [];
    if (ids.length === 0) return res.json({ removed: 0 });

    const { data: photos } = await supabase
      .from('gallery_photos')
      .select('id, original_path, preview_path, thumb_path')
      .eq('gallery_id', gallery.id)
      .in('id', ids);
    const list = photos || [];
    if (list.length === 0) return res.json({ removed: 0 });

    await removeGalleryStorage(list).catch(() => {});
    const { error } = await supabase
      .from('gallery_photos').delete().in('id', list.map((p) => p.id));
    if (error) return res.status(500).json({ error: error.message });
    res.json({ removed: list.length });
  });

  // ── Pacotes de upgrade (Fase 2) ────────────────────────────────────────────

  app.get('/api/galleries/:id/packs', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (supabaseAdmin || (req as any).supabase) as SupabaseClient;
    const { data: gallery } = await supabase
      .from('galleries').select('*').eq('id', req.params.id).eq('user_id', userId).maybeSingle();
    if (!gallery) return res.status(404).json({ error: 'Galeria não encontrada' });
    const discountCfg = {
      cart_discount: Number(gallery.cart_discount || 0),
      discount_mode: gallery.discount_mode || 'flat',
      discount_single_pct: Number(gallery.discount_single_pct || 0),
      discount_rules: Array.isArray(gallery.discount_rules) ? gallery.discount_rules : [],
      discount_value_rules: Array.isArray(gallery.discount_value_rules) ? gallery.discount_value_rules : [],
      deadline_discount_pct: Number(gallery.deadline_discount_pct || 0),
      deadline_discount_until: gallery.deadline_discount_until || null,
      buy_n_group: Number(gallery.buy_n_group || 0),
      buy_n_free: Number(gallery.buy_n_free || 0),
      coupons: Array.isArray(gallery.coupons) ? gallery.coupons : [],
    };
    const { data, error } = await supabase
      .from('gallery_packs').select('*').eq('gallery_id', gallery.id).order('sort_order');
    if (error) {
      return galleryTableMissing(error) ? res.json({ packs: [], ...discountCfg, table_missing: true })
        : res.status(500).json({ error: error.message });
    }
    res.json({ packs: data || [], ...discountCfg });
  });

  app.post('/api/galleries/:id/packs', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (supabaseAdmin || (req as any).supabase) as SupabaseClient;
    const { data: gallery } = await supabase
      .from('galleries').select('id').eq('id', req.params.id).eq('user_id', userId).maybeSingle();
    if (!gallery) return res.status(404).json({ error: 'Galeria não encontrada' });
    const payload = {
      gallery_id: gallery.id,
      name: String(req.body?.name || '').trim().slice(0, 80) || 'Pacote',
      photo_count: Math.max(1, Number(req.body?.photo_count) || 1),
      price: Math.max(0, Number(req.body?.price) || 0),
      sort_order: Number(req.body?.sort_order) || 0,
    };
    const { data, error } = await supabase.from('gallery_packs').insert(payload).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ pack: data });
  });

  app.put('/api/galleries/:id/packs/:packId', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (supabaseAdmin || (req as any).supabase) as SupabaseClient;
    const { data: gallery } = await supabase
      .from('galleries').select('id').eq('id', req.params.id).eq('user_id', userId).maybeSingle();
    if (!gallery) return res.status(404).json({ error: 'Galeria não encontrada' });
    const patch: any = {};
    if (req.body?.name !== undefined) patch.name = String(req.body.name).trim().slice(0, 80) || 'Pacote';
    if (req.body?.photo_count !== undefined) patch.photo_count = Math.max(1, Number(req.body.photo_count) || 1);
    if (req.body?.price !== undefined) patch.price = Math.max(0, Number(req.body.price) || 0);
    if (req.body?.sort_order !== undefined) patch.sort_order = Number(req.body.sort_order) || 0;
    const { error } = await supabase
      .from('gallery_packs').update(patch).eq('id', req.params.packId).eq('gallery_id', gallery.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  });

  app.delete('/api/galleries/:id/packs/:packId', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (supabaseAdmin || (req as any).supabase) as SupabaseClient;
    const { data: gallery } = await supabase
      .from('galleries').select('id').eq('id', req.params.id).eq('user_id', userId).maybeSingle();
    if (!gallery) return res.status(404).json({ error: 'Galeria não encontrada' });
    const { error } = await supabase
      .from('gallery_packs').delete().eq('id', req.params.packId).eq('gallery_id', gallery.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  });

  // ── Enviar galeria pro cliente (e-mail + WhatsApp) ────────────────────────
  //
  // O texto sai de um template editável (por envio e/ou padrão do estúdio em
  // gallery_settings.send_message_template). Placeholders: {cliente} {titulo}
  // {link} {estudio} {prazo} {acesso_email} {senha}. Resultado por canal é
  // REAL: "enviado" só quando o provedor aceitou; senão devolve o motivo.

  const GALLERY_SEND_TEMPLATE_DEFAULT = [
    'Olá, {cliente}! 📸',
    '',
    'Suas fotos de "{titulo}" estão prontas! Escolha suas favoritas aqui:',
    '{link}',
    '',
    'Seus dados de acesso:',
    'E-mail: {acesso_email}',
    'Senha: {senha}',
    '',
    'Qualquer dúvida é só chamar! — {estudio}',
  ].join('\n');

  function renderGalleryMessage(template: string, vars: Record<string, string>): string {
    let out = template;
    for (const [k, v] of Object.entries(vars)) {
      out = out.split(`{${k}}`).join(v);
    }
    // Remove o bloco de acesso quando não há credenciais (linhas que ficaram
    // com placeholder vazio ou rótulo órfão).
    if (!vars.acesso_email) {
      out = out
        .split('\n')
        .filter((l) => !/^(Seus dados de acesso:|E-mail:\s*$|Senha:\s*$)/.test(l.trim()))
        .join('\n');
    }
    return out.replace(/\n{3,}/g, '\n\n').trim();
  }

  // Devolve a senha do acesso principal pra incluir na mensagem. A senha é
  // GUARDADA em texto (password_plain) e ESTÁVEL: reenviar manda a MESMA senha.
  // Só gera uma nova se o acesso ainda não tem senha nenhuma. Legado (hash sem
  // texto) é preservado (password = null). Sem acesso cadastrado → null.
  async function ensureGalleryAccessPassword(gallery: any): Promise<{ email: string; password: string | null } | null> {
    if (!supabaseAdmin) return null;
    let { data: users, error: selErr } = (await supabaseAdmin
      .from('gallery_access_users')
      .select('id, email, role, password_hash, password_plain')
      .eq('gallery_id', gallery.id)
      .order('created_at')) as any;
    // Coluna password_plain ainda não migrada (056)? Repete sem ela.
    if (selErr && (selErr as any).code === '42703') {
      ({ data: users } = (await supabaseAdmin
        .from('gallery_access_users')
        .select('id, email, role, password_hash')
        .eq('gallery_id', gallery.id)
        .order('created_at')) as any);
    }
    const owner = (users || []).find((u: any) => u.role === 'owner') || (users || [])[0];
    if (!owner) return null;
    // Já tem a senha guardada em texto → reenvia a MESMA (estável e visível).
    if ((owner as any).password_plain) return { email: owner.email, password: (owner as any).password_plain };
    // Tem hash mas sem texto (legado) → preserva, não troca.
    if (owner.password_hash) return { email: owner.email, password: null };
    // Sem senha ainda → gera e guarda hash + texto.
    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    let password = '';
    for (let i = 0; i < 8; i++) password += chars[crypto.randomInt(chars.length)];
    const password_hash = await bcrypt.hash(password, 10);
    const patch: any = { password_hash, password_plain: password, updated_at: new Date().toISOString() };
    let { error: updErr } = await supabaseAdmin
      .from('gallery_access_users').update(patch).eq('id', owner.id);
    if (updErr && (updErr as any).code === '42703') {
      delete patch.password_plain;
      ({ error: updErr } = await supabaseAdmin
        .from('gallery_access_users').update(patch).eq('id', owner.id));
    }
    if (updErr) return null;
    return { email: owner.email, password };
  }

  app.post('/api/galleries/:id/send', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (supabaseAdmin || (req as any).supabase) as SupabaseClient;
    const { data: gallery, error } = await supabase
      .from('galleries').select('*').eq('id', req.params.id).eq('user_id', userId).maybeSingle();
    if (error) {
      return galleryTableMissing(error) ? galleryMigrationError(res) : res.status(500).json({ error: error.message });
    }
    if (!gallery) return res.status(404).json({ error: 'Galeria não encontrada' });

    const body = req.body || {};
    const wantEmail = body.channel_email !== false;       // default: tenta os dois
    const wantWhatsApp = body.channel_whatsapp !== false;
    const includeAccess = body.include_access !== false && !!gallery.require_login;

    const settings = await getGallerySettings(userId);
    const studioName = await getStudioNameForGallery(userId);
    const link = galleryLink(gallery.share_token);

    // Template: o que veio do front > padrão do estúdio > padrão do sistema.
    const template = String(body.message || settings.send_message_template || GALLERY_SEND_TEMPLATE_DEFAULT);
    if (body.save_as_default === true && typeof body.message === 'string' && body.message.trim()) {
      await supabaseAdmin?.from('gallery_settings')
        .upsert({ user_id: userId, send_message_template: body.message.trim(), updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
    }

    // Credenciais: garante a senha do acesso (gera só na 1ª vez; reenvio mantém
    // a mesma). password = null quando preservada — a mensagem omite a linha.
    let access: { email: string; password: string | null } | null = null;
    if (includeAccess) access = await ensureGalleryAccessPassword(gallery);

    const prazo = gallery.selection_deadline
      ? new Date(gallery.selection_deadline + 'T12:00:00').toLocaleDateString('pt-BR')
      : '';
    const message = renderGalleryMessage(template, {
      cliente: gallery.client_name || 'tudo bem',
      titulo: gallery.title,
      link,
      estudio: studioName,
      prazo,
      acesso_email: access?.email || '',
      senha: access?.password || '',
    });

    // E-mail — resultado real com motivo.
    let email: { sent: boolean; error?: string } = { sent: false, error: 'Canal desativado.' };
    if (wantEmail) {
      if (!gallery.client_email) {
        email = { sent: false, error: 'Cliente sem e-mail cadastrado (preencha em Dados da galeria).' };
      } else {
        const r = await sendGalleryMessageEmail({
          to: gallery.client_email,
          from: settings.sender_email,
          studioName,
          subject: `Suas fotos estão prontas — ${gallery.title}`,
          messageText: message,
          link,
        });
        email = { sent: r.ok, error: r.error };
      }
    }

    // WhatsApp — resultado real com motivo.
    let whatsapp: { sent: boolean; error?: string } = { sent: false, error: 'Canal desativado.' };
    if (wantWhatsApp) {
      const digits = String(gallery.client_phone || '').replace(/\D/g, '');
      if (!digits) {
        whatsapp = { sent: false, error: 'Cliente sem telefone cadastrado (preencha em Dados da galeria).' };
      } else if (BaileysManager.getStatus(userId) !== 'open') {
        whatsapp = { sent: false, error: 'WhatsApp desconectado — conecte na página WhatsApp do app.' };
      } else {
        try {
          await BaileysManager.sendText(userId, normalizeBrazilianPhone(digits), message);
          whatsapp = { sent: true };
        } catch (e: any) {
          console.warn('[galeria] envio WhatsApp falhou:', e?.message);
          whatsapp = { sent: false, error: `Falha no envio: ${e?.message || 'desconhecida'}` };
        }
      }
    }

    // Marca como enviada somente se ALGUM canal entregou de verdade.
    if (email.sent || whatsapp.sent) {
      const patch: any = { sent_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      if (gallery.status === 'draft') patch.status = 'sent';
      await supabase.from('galleries').update(patch).eq('id', gallery.id);
    }

    res.json({
      ok: email.sent || whatsapp.sent,
      link,
      message,
      email,
      whatsapp,
      access,
      // Legado (banner antigo)
      email_sent: email.sent,
      whatsapp_sent: whatsapp.sent,
    });
  });

  // ── Rotas PÚBLICAS (cliente final, validação por share_token) ─────────────

  async function findGalleryByToken(token: string): Promise<any | null> {
    if (!supabaseAdmin || !token) return null;
    const { data } = await supabaseAdmin.from('galleries').select('*').eq('share_token', token).maybeSingle();
    return data || null;
  }

  // Normaliza as regras de desconto progressivo vindas do banco (JSONB) ou do
  // body do PUT. Devolve { percent (0..100), min_photos (>=1) } ordenadas por
  // min_photos crescente. Ignora lixo silenciosamente (nunca quebra o cálculo).
  function sanitizeDiscountRules(raw: any): { percent: number; min_photos: number }[] {
    let arr = raw;
    if (typeof arr === 'string') { try { arr = JSON.parse(arr); } catch { arr = []; } }
    if (!Array.isArray(arr)) return [];
    return arr
      .map((r: any) => ({
        percent: Math.min(100, Math.max(0, Number(r?.percent) || 0)),
        min_photos: Math.max(1, Math.floor(Number(r?.min_photos) || 0)),
      }))
      .filter((r) => r.percent > 0 && r.min_photos >= 1)
      .sort((a, b) => a.min_photos - b.min_photos)
      .slice(0, 20);
  }

  // Regras do progressivo por VALOR: [{ percent (0..100), min_value (R$ ≥ 0) }],
  // ordenadas por min_value crescente. Mesma robustez do sanitizeDiscountRules.
  function sanitizeValueRules(raw: any): { percent: number; min_value: number }[] {
    let arr = raw;
    if (typeof arr === 'string') { try { arr = JSON.parse(arr); } catch { arr = []; } }
    if (!Array.isArray(arr)) return [];
    return arr
      .map((r: any) => ({
        percent: Math.min(100, Math.max(0, Number(r?.percent) || 0)),
        min_value: Math.max(0, Number(r?.min_value) || 0),
      }))
      .filter((r) => r.percent > 0 && r.min_value > 0)
      .sort((a, b) => a.min_value - b.min_value)
      .slice(0, 20);
  }

  // Cupons: [{ code (UPPER), type 'pct'|'flat', value }]. Código normalizado em
  // maiúsculas pra comparar sem case-sensitivity. Ignora lixo silenciosamente.
  function sanitizeCoupons(raw: any): { code: string; type: 'pct' | 'flat'; value: number }[] {
    let arr = raw;
    if (typeof arr === 'string') { try { arr = JSON.parse(arr); } catch { arr = []; } }
    if (!Array.isArray(arr)) return [];
    const seen = new Set<string>();
    const out: { code: string; type: 'pct' | 'flat'; value: number }[] = [];
    for (const c of arr) {
      const code = String(c?.code || '').trim().toUpperCase().slice(0, 40);
      const type: 'pct' | 'flat' = c?.type === 'flat' ? 'flat' : 'pct';
      const value = Math.max(0, Number(c?.value) || 0);
      if (!code || value <= 0 || seen.has(code)) continue;
      seen.add(code);
      out.push({ code, type, value });
      if (out.length >= 50) break;
    }
    return out;
  }

  // Calcula o desconto (em R$) sobre um subtotal, conforme o modo da galeria.
  // Retorna { discount, pct, couponApplied } — pct só pra exibir; couponApplied
  // = código do cupom que pegou (ou null). Modos:
  //   none              → 0
  //   flat              → cart_discount em R$ (comportamento antigo)
  //   single_pct        → subtotal × pct/100
  //   progressive       → maior regra cujo min_photos ≤ fotos escolhidas
  //   progressive_value → maior regra cujo min_value ≤ subtotal
  //   deadline          → pct se hoje ≤ data limite (early bird)
  //   buy_n_get_m       → a cada N fotos, M de graça (abate as M mais baratas)
  //   coupon            → código digitado bate em coupons[] (pct ou flat)
  function computeGalleryDiscount(ctx: {
    subtotal: number;
    selectedCount: number;
    billablePrices?: number[];
    mode?: string;
    flat?: number;
    singlePct?: number;
    rules?: any;
    valueRules?: any;
    deadlinePct?: number;
    deadlineUntil?: string | null;
    buyNGroup?: number;
    buyNFree?: number;
    coupons?: any;
    couponCode?: string | null;
    now?: Date;
  }): { discount: number; pct: number; couponApplied: string | null } {
    const subtotal = Number(ctx.subtotal) || 0;
    const selectedCount = Number(ctx.selectedCount) || 0;
    const mode = ctx.mode || 'flat';
    const none = { discount: 0, pct: 0, couponApplied: null };
    if (mode === 'none' || subtotal <= 0) return none;

    if (mode === 'single_pct') {
      const pct = Math.min(100, Math.max(0, Number(ctx.singlePct) || 0));
      return { discount: (subtotal * pct) / 100, pct, couponApplied: null };
    }
    if (mode === 'progressive') {
      const rules = sanitizeDiscountRules(ctx.rules);
      let pct = 0;
      for (const r of rules) if (selectedCount >= r.min_photos) pct = r.percent;
      return { discount: (subtotal * pct) / 100, pct, couponApplied: null };
    }
    if (mode === 'progressive_value') {
      const rules = sanitizeValueRules(ctx.valueRules);
      let pct = 0;
      for (const r of rules) if (subtotal >= r.min_value) pct = r.percent;
      return { discount: (subtotal * pct) / 100, pct, couponApplied: null };
    }
    if (mode === 'deadline') {
      const pct = Math.min(100, Math.max(0, Number(ctx.deadlinePct) || 0));
      if (pct <= 0) return none;
      const until = ctx.deadlineUntil;
      if (until) {
        const limit = new Date(`${until}T23:59:59`);
        const now = ctx.now || new Date();
        if (isNaN(limit.getTime()) || now > limit) return none; // prazo passou
      }
      return { discount: (subtotal * pct) / 100, pct, couponApplied: null };
    }
    if (mode === 'buy_n_get_m') {
      const group = Math.max(0, Math.floor(Number(ctx.buyNGroup) || 0));
      const free = Math.max(0, Math.floor(Number(ctx.buyNFree) || 0));
      const prices = [...(ctx.billablePrices || [])].sort((a, b) => a - b);
      if (group <= 0 || free <= 0 || prices.length === 0) return none;
      const freeCount = Math.min(Math.floor(selectedCount / group) * free, prices.length);
      if (freeCount <= 0) return none;
      let discount = 0;
      for (let i = 0; i < freeCount; i++) discount += prices[i]; // as mais baratas
      const pct = subtotal > 0 ? Math.round((discount / subtotal) * 100) : 0;
      return { discount, pct, couponApplied: null };
    }
    if (mode === 'coupon') {
      const code = String(ctx.couponCode || '').trim().toUpperCase();
      if (!code) return none;
      const found = sanitizeCoupons(ctx.coupons).find((c) => c.code === code);
      if (!found) return none;
      if (found.type === 'flat') return { discount: Math.max(0, found.value), pct: 0, couponApplied: found.code };
      const pct = Math.min(100, Math.max(0, found.value));
      return { discount: (subtotal * pct) / 100, pct, couponApplied: found.code };
    }
    // flat (default) — abatimento fixo em reais.
    return { discount: Math.max(0, Number(ctx.flat) || 0), pct: 0, couponApplied: null };
  }

  // Totais da seleção respeitando o pricing_mode da galeria:
  //   no_charge      → cliente só seleciona; valor 0.
  //   extra_avulso   → N incluídas grátis + cada extra a extra_price.
  //   upgrade_packs  → cliente compra um pacote (pack_id) ao finalizar.
  //   sell_all       → cada foto tem preço (gallery_photo_prices); senão extra_price.
  // Aplica o desconto (fixo/único/progressivo) sobre o subtotal.
  async function galleryTotals(
    galleryId: string,
    includedCount: number,
    extraPrice: number,
    opts: {
      pricingMode?: string; cartDiscount?: number; packId?: string | null;
      discountMode?: string; discountSinglePct?: number; discountRules?: any;
      discountValueRules?: any; deadlinePct?: number; deadlineUntil?: string | null;
      buyNGroup?: number; buyNFree?: number; coupons?: any; couponCode?: string | null;
    } = {},
  ) {
    const sb = supabaseAdmin!;
    const mode = opts.pricingMode || 'extra_avulso';

    const { data: selRows } = await sb
      .from('gallery_selections')
      .select('photo_id')
      .eq('gallery_id', galleryId)
      .eq('selected', true);
    const selectedIds = (selRows || []).map((r: any) => r.photo_id);
    const selected_count = selectedIds.length;
    const extra_count = Math.max(0, selected_count - (includedCount || 0));

    let subtotal = 0;
    let pack_name: string | null = null;
    // Preço de cada foto cobrável (pro "leve N pague M" abater as mais baratas).
    let billablePrices: number[] = [];
    if (mode === 'no_charge') {
      subtotal = 0;
    } else if (mode === 'upgrade_packs' && opts.packId) {
      const { data: pack } = await sb
        .from('gallery_packs').select('name, price').eq('id', opts.packId).eq('gallery_id', galleryId).maybeSingle();
      subtotal = Number(pack?.price || 0);
      pack_name = pack?.name || null;
    } else if (mode === 'sell_all' && selectedIds.length > 0) {
      const { data: prices } = await sb
        .from('gallery_photo_prices').select('photo_id, price')
        .eq('gallery_id', galleryId).in('photo_id', selectedIds);
      const byId = new Map<string, number>();
      for (const p of prices || []) byId.set(p.photo_id, Number(p.price || 0));
      // Foto sem preço cadastrado usa extra_price como fallback.
      billablePrices = selectedIds.map((id) => (byId.has(id) ? byId.get(id)! : Number(extraPrice || 0)));
      subtotal = billablePrices.reduce((sum, v) => sum + v, 0);
    } else {
      // extra_avulso (default) — N inclusas + cobra os extras.
      billablePrices = Array.from({ length: extra_count }, () => Number(extraPrice || 0));
      subtotal = extra_count * Number(extraPrice || 0);
    }

    const { discount: rawDiscount, pct: discount_pct, couponApplied } = computeGalleryDiscount({
      subtotal,
      selectedCount: selected_count,
      billablePrices,
      mode: opts.discountMode,
      flat: opts.cartDiscount,
      singlePct: opts.discountSinglePct,
      rules: opts.discountRules,
      valueRules: opts.discountValueRules,
      deadlinePct: opts.deadlinePct,
      deadlineUntil: opts.deadlineUntil,
      buyNGroup: opts.buyNGroup,
      buyNFree: opts.buyNFree,
      coupons: opts.coupons,
      couponCode: opts.couponCode,
    });
    // Nunca abate mais que o subtotal (mantém amount ≥ 0 e display coerente).
    const discount = Math.min(Math.max(0, rawDiscount), subtotal);
    const amount = subtotal - discount;
    return { selected_count, extra_count, amount, subtotal, discount, discount_pct, pack_name, coupon_applied: couponApplied };
  }

  // Monta os opts de desconto a partir da linha da galeria (evita repetir nos
  // 3 callers do galleryTotals). couponCode vem do cliente (ou do pagamento).
  function galleryDiscountOpts(gallery: any, couponCode?: string | null) {
    return {
      pricingMode: gallery.pricing_mode, cartDiscount: gallery.cart_discount,
      discountMode: gallery.discount_mode, discountSinglePct: gallery.discount_single_pct,
      discountRules: gallery.discount_rules, discountValueRules: gallery.discount_value_rules,
      deadlinePct: gallery.deadline_discount_pct, deadlineUntil: gallery.deadline_discount_until,
      buyNGroup: gallery.buy_n_group, buyNFree: gallery.buy_n_free,
      coupons: gallery.coupons, couponCode: couponCode || null,
    };
  }

  // ── Acesso & auditoria (Fase 1) ────────────────────────────────────────────

  // Rate-limit simples em memória pras rotas PÚBLICAS da galeria (anti
  // brute-force de senha + anti-flood de seleção/comentário). Janela
  // deslizante por chave (ip+token+ação). Em memória: não compartilha entre
  // instâncias do Render, mas já corta o abuso de uma origem. Fail-open se
  // algo der errado — nunca derruba uma requisição legítima por engano.
  const RL_BUCKETS = new Map<string, number[]>();
  function publicRateLimit(req: express.Request, action: string, max: number, windowMs: number): boolean {
    try {
      const ip = String(
        req.headers['x-forwarded-for']?.toString().split(',')[0].trim() ||
        req.headers['x-real-ip'] || req.socket.remoteAddress || 'unknown',
      ).slice(0, 64);
      const key = `${action}:${req.params.token || ''}:${ip}`;
      const now = Date.now();
      const hits = (RL_BUCKETS.get(key) || []).filter((t) => now - t < windowMs);
      if (hits.length >= max) { RL_BUCKETS.set(key, hits); return false; }
      hits.push(now);
      RL_BUCKETS.set(key, hits);
      // Limpeza preguiçosa pra não vazar memória (mapa não cresce sem fim).
      if (RL_BUCKETS.size > 5000) {
        for (const [k, v] of RL_BUCKETS) {
          if (v.every((t) => now - t > windowMs)) RL_BUCKETS.delete(k);
        }
      }
      return true;
    } catch {
      return true; // fail-open
    }
  }

  // Conta login_fail recentes (últimos 15 min) pra lockout por conta/galeria,
  // aproveitando o log de auditoria já gravado. Defesa adicional ao rate-limit
  // por IP (cobre brute-force distribuído num mesmo e-mail).
  async function recentLoginFails(galleryId: string, email: string): Promise<number> {
    if (!supabaseAdmin) return 0;
    try {
      const since = new Date(Date.now() - 15 * 60 * 1000).toISOString();
      const { count } = await supabaseAdmin
        .from('gallery_access_log')
        .select('id', { count: 'exact', head: true })
        .eq('gallery_id', galleryId)
        .eq('event', 'login_fail')
        .gte('created_at', since);
      return count || 0;
    } catch {
      return 0;
    }
  }

  // Extrai IP + UA pro log de auditoria.
  function reqIpUa(req: express.Request): { ip: string; ua: string } {
    const ip = String(
      req.headers['x-forwarded-for']?.toString().split(',')[0].trim() ||
      req.headers['x-real-ip'] ||
      req.socket.remoteAddress || '',
    ).slice(0, 64);
    const ua = String(req.headers['user-agent'] || '').slice(0, 300);
    return { ip, ua };
  }

  // Insere um evento no log da galeria — best-effort, NUNCA quebra a request.
  async function logGalleryEvent(
    galleryId: string,
    accessUserId: string | null,
    event: string,
    req: express.Request,
    extra?: { photoId?: string; detail?: string },
  ): Promise<void> {
    if (!supabaseAdmin) return;
    try {
      const { ip, ua } = reqIpUa(req);
      await supabaseAdmin.from('gallery_access_log').insert({
        gallery_id: galleryId,
        access_user_id: accessUserId,
        event,
        photo_id: extra?.photoId || null,
        detail: extra?.detail || null,
        ip, user_agent: ua,
      });
    } catch (e: any) {
      console.warn('[galeria] log falhou:', e?.message);
    }
  }

  // Lê o session token do header Authorization e devolve o payload OU null
  // (token ausente / inválido / expirado). Não confere se ainda pertence à
  // galeria — quem chamar deve comparar com gallery.id.
  function sessionFromReq(req: express.Request): GallerySessionPayload | null {
    const auth = req.headers.authorization || '';
    if (!auth.startsWith('Bearer ')) return null;
    return verifyGallerySession(auth.slice(7));
  }

  // Garante que a galeria está acessível: se require_login=true, exige
  // uma session válida do mesmo gallery_id. Se ok, devolve o access_user
  // (ou null quando galeria é pública). Caso contrário responde 401/403
  // e retorna undefined.
  async function ensureGalleryAccess(
    req: express.Request,
    res: express.Response,
    gallery: any,
  ): Promise<{ accessUserId: string | null } | undefined> {
    if (!gallery.require_login) {
      const sess = sessionFromReq(req);
      // Se passou session ainda assim, respeita; senão acesso anônimo.
      return { accessUserId: sess && sess.gid === gallery.id ? sess.aid : null };
    }
    const sess = sessionFromReq(req);
    if (!sess || sess.gid !== gallery.id) {
      res.status(401).json({ error: 'login_required' });
      return undefined;
    }
    return { accessUserId: sess.aid };
  }

  // ── Rotas autenticadas: estúdio gerencia logins da galeria ────────────────

  app.get('/api/galleries/:id/access', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (supabaseAdmin || (req as any).supabase) as SupabaseClient;
    const { data: gallery } = await supabase
      .from('galleries').select('id, require_login').eq('id', req.params.id).eq('user_id', userId).maybeSingle();
    if (!gallery) return res.status(404).json({ error: 'Galeria não encontrada' });
    const baseCols = 'id, email, name, role, last_login_at, login_count, created_at';
    let { data, error } = (await supabase
      .from('gallery_access_users')
      .select(`${baseCols}, password_plain`)
      .eq('gallery_id', gallery.id)
      .order('created_at')) as any;
    // Coluna password_plain ainda não migrada (056)? Repete sem ela.
    if (error && (error as any).code === '42703') {
      ({ data, error } = (await supabase
        .from('gallery_access_users').select(baseCols).eq('gallery_id', gallery.id).order('created_at')) as any);
    }
    if (error) {
      return galleryTableMissing(error) ? galleryMigrationError(res) : res.status(500).json({ error: error.message });
    }
    // Expõe a senha (texto) pro próprio estúdio ver/copiar — rota autenticada.
    const users = (data || []).map((u: any) => {
      const { password_plain, ...rest } = u;
      return { ...rest, password: password_plain ?? null };
    });
    res.json({ users, require_login: !!gallery.require_login });
  });

  app.post('/api/galleries/:id/access', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (supabaseAdmin || (req as any).supabase) as SupabaseClient;
    const { data: gallery } = await supabase
      .from('galleries').select('id').eq('id', req.params.id).eq('user_id', userId).maybeSingle();
    if (!gallery) return res.status(404).json({ error: 'Galeria não encontrada' });

    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const name = req.body?.name ? String(req.body.name).trim() : null;
    const role: 'owner' | 'guest' = req.body?.role === 'guest' ? 'guest' : 'owner';
    if (!email.includes('@')) return res.status(400).json({ error: 'E-mail inválido' });
    if (password.length < 6) return res.status(400).json({ error: 'Senha curta demais (mínimo 6 caracteres).' });

    const password_hash = await bcrypt.hash(password, 10);
    const insertRow: any = { gallery_id: gallery.id, email, password_hash, password_plain: password, name, role, invited_by: userId };
    let { data, error } = await supabase
      .from('gallery_access_users').insert(insertRow).select('id, email, name, role, created_at').single();
    // Coluna password_plain ainda não migrada (056)? Repete sem ela.
    if (error && (error as any).code === '42703') {
      delete insertRow.password_plain;
      ({ data, error } = await supabase
        .from('gallery_access_users').insert(insertRow).select('id, email, name, role, created_at').single());
    }
    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'Esse e-mail já tem acesso à galeria.' });
      return res.status(500).json({ error: error.message });
    }
    res.json({ user: data });
  });

  app.put('/api/galleries/:id/access/:userId', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (supabaseAdmin || (req as any).supabase) as SupabaseClient;
    const { data: gallery } = await supabase
      .from('galleries').select('id').eq('id', req.params.id).eq('user_id', userId).maybeSingle();
    if (!gallery) return res.status(404).json({ error: 'Galeria não encontrada' });

    const patch: any = { updated_at: new Date().toISOString() };
    if (req.body?.name !== undefined) patch.name = req.body.name ? String(req.body.name).trim() : null;
    if (req.body?.role === 'owner' || req.body?.role === 'guest') patch.role = req.body.role;
    if (typeof req.body?.password === 'string' && req.body.password.length >= 6) {
      patch.password_hash = await bcrypt.hash(req.body.password, 10);
      patch.password_plain = req.body.password; // guarda em texto pra ver/reenviar
    }
    let { error } = await supabase
      .from('gallery_access_users').update(patch).eq('id', req.params.userId).eq('gallery_id', gallery.id);
    // Coluna password_plain ainda não migrada (056)? Repete sem ela.
    if (error && (error as any).code === '42703') {
      delete patch.password_plain;
      ({ error } = await supabase
        .from('gallery_access_users').update(patch).eq('id', req.params.userId).eq('gallery_id', gallery.id));
    }
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  });

  app.delete('/api/galleries/:id/access/:userId', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (supabaseAdmin || (req as any).supabase) as SupabaseClient;
    const { data: gallery } = await supabase
      .from('galleries').select('id').eq('id', req.params.id).eq('user_id', userId).maybeSingle();
    if (!gallery) return res.status(404).json({ error: 'Galeria não encontrada' });
    const { error } = await supabase
      .from('gallery_access_users').delete().eq('id', req.params.userId).eq('gallery_id', gallery.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  });

  // Log de auditoria + sumário pras abas "Atividades do cliente" e
  // "Histórico de atividades" (Fase 1D).
  app.get('/api/galleries/:id/audit', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (supabaseAdmin || (req as any).supabase) as SupabaseClient;
    const { data: gallery } = await supabase
      .from('galleries').select('id').eq('id', req.params.id).eq('user_id', userId).maybeSingle();
    if (!gallery) return res.status(404).json({ error: 'Galeria não encontrada' });

    const [logQ, usersQ, photosQ, selQ] = await Promise.all([
      supabase
        .from('gallery_access_log')
        .select('id, event, photo_id, detail, ip, user_agent, created_at, access_user_id')
        .eq('gallery_id', gallery.id)
        .order('created_at', { ascending: false })
        .limit(500),
      supabase
        .from('gallery_access_users')
        .select('id, email, name, role, last_login_at, login_count')
        .eq('gallery_id', gallery.id),
      supabase.from('gallery_photos').select('id, file_name').eq('gallery_id', gallery.id),
      supabase.from('gallery_selections').select('photo_id, selected, client_comment')
        .eq('gallery_id', gallery.id).eq('selected', true),
    ]);
    if (logQ.error && galleryTableMissing(logQ.error)) return galleryMigrationError(res);

    const usersById = new Map<string, any>();
    for (const u of usersQ.data || []) usersById.set(u.id, u);
    const photosById = new Map<string, string>();
    for (const p of photosQ.data || []) photosById.set(p.id, p.file_name);

    const events = (logQ.data || []).map((e: any) => ({
      id: e.id,
      event: e.event,
      detail: e.detail,
      ip: e.ip,
      user_agent: e.user_agent,
      created_at: e.created_at,
      photo_id: e.photo_id,
      photo_name: e.photo_id ? photosById.get(e.photo_id) || null : null,
      user: e.access_user_id ? {
        id: e.access_user_id,
        email: usersById.get(e.access_user_id)?.email || null,
        name: usersById.get(e.access_user_id)?.name || null,
      } : null,
    }));

    const summary = {
      total_users: (usersQ.data || []).length,
      total_views: events.filter((e) => e.event === 'view_gallery').length,
      total_logins: events.filter((e) => e.event === 'login').length,
      total_login_fails: events.filter((e) => e.event === 'login_fail').length,
      selected_count: (selQ.data || []).length,
      comments_count: (selQ.data || []).filter((s: any) => !!s.client_comment).length,
      last_event_at: events[0]?.created_at || null,
      finalized_at: events.find((e) => e.event === 'finalize')?.created_at || null,
    };
    res.json({ users: usersQ.data || [], events, summary });
  });

  // ── Login público da cliente / convidado ──────────────────────────────────

  app.post('/api/public/gallery/:token/login', async (req, res) => {
    if (!supabaseAdmin) return res.status(500).json({ error: 'Indisponível' });

    // Anti brute-force por IP: no máx 8 tentativas a cada 15 min por token+IP.
    if (!publicRateLimit(req, 'login', 8, 15 * 60 * 1000)) {
      return res.status(429).json({ error: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.' });
    }

    const gallery = await findGalleryByToken(req.params.token);
    if (!gallery) return res.status(404).json({ error: 'Galeria não encontrada' });

    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    if (!email || !password) return res.status(400).json({ error: 'E-mail e senha são obrigatórios.' });

    // Lockout por galeria: muitas falhas recentes (qualquer IP) → trava temporária.
    if (await recentLoginFails(gallery.id, email) >= 20) {
      return res.status(429).json({ error: 'Acesso bloqueado por excesso de tentativas. Tente novamente em 15 minutos.' });
    }

    const { data: user } = await supabaseAdmin
      .from('gallery_access_users')
      .select('id, email, name, role, password_hash, login_count')
      .eq('gallery_id', gallery.id)
      .eq('email', email)
      .maybeSingle();

    if (!user) {
      await logGalleryEvent(gallery.id, null, 'login_fail', req, { detail: `email=${email}` });
      return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
    }
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      await logGalleryEvent(gallery.id, user.id, 'login_fail', req);
      return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
    }

    await supabaseAdmin
      .from('gallery_access_users')
      .update({ last_login_at: new Date().toISOString(), login_count: (user.login_count || 0) + 1 })
      .eq('id', user.id);
    await logGalleryEvent(gallery.id, user.id, 'login', req);

    const session = signGallerySession({ gid: gallery.id, aid: user.id, role: user.role });
    if (!session) {
      // Chave de sessão ausente em produção (fail-closed) — não dá pra logar.
      return res.status(503).json({ error: 'Login temporariamente indisponível. Avise o estúdio.' });
    }
    res.json({
      session_token: session,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    });
  });

  app.get('/api/public/gallery/:token', async (req, res) => {
    if (!supabaseAdmin) return res.status(500).json({ error: 'Indisponível' });
    const gallery = await findGalleryByToken(req.params.token);
    if (!gallery) return res.status(404).json({ error: 'Galeria não encontrada' });

    const access = await ensureGalleryAccess(req, res, gallery);
    if (access === undefined) return;

    const [settings, studioName, studioLogo, photosQ, selQ] = await Promise.all([
      getGallerySettings(gallery.user_id),
      getStudioNameForGallery(gallery.user_id),
      getStudioLogoForGallery(gallery.user_id),
      supabaseAdmin
        .from('gallery_photos')
        .select('id, file_name, preview_path, thumb_path')
        .eq('gallery_id', gallery.id)
        .eq('process_status', 'done')
        .order('sort_order')
        .order('created_at'),
      supabaseAdmin
        .from('gallery_selections')
        .select('photo_id, selected, client_comment')
        .eq('gallery_id', gallery.id),
    ]);

    if (gallery.status !== 'draft') {
      await supabaseAdmin
        .from('galleries')
        .update({ view_count: (gallery.view_count || 0) + 1, last_viewed_at: new Date().toISOString() })
        .eq('id', gallery.id);
      await logGalleryEvent(gallery.id, access.accessUserId, 'view_gallery', req);
    }

    const selections: Record<string, { selected: boolean; comment: string | null }> = {};
    for (const s of selQ.data || []) selections[s.photo_id] = { selected: !!s.selected, comment: s.client_comment };

    const prot = settings.protection || {};
    res.json({
      gallery: {
        title: gallery.title,
        status: gallery.status,
        included_count: gallery.included_count || 0,
        extra_price: Number(gallery.extra_price || 0),
        pricing_mode: gallery.pricing_mode || 'extra_avulso',
        discount_mode: gallery.discount_mode || 'flat',
        cart_discount: Number(gallery.cart_discount || 0),
        discount_single_pct: Number(gallery.discount_single_pct || 0),
        discount_rules: Array.isArray(gallery.discount_rules) ? gallery.discount_rules : [],
        // Config dos novos tipos pra prévia no cliente. NÃO expõe os códigos de
        // cupom — só sinaliza que a galeria usa cupom (validação é server-side).
        discount_value_rules: Array.isArray(gallery.discount_value_rules) ? gallery.discount_value_rules : [],
        deadline_discount_pct: Number(gallery.deadline_discount_pct || 0),
        deadline_discount_until: gallery.deadline_discount_until || null,
        buy_n_group: Number(gallery.buy_n_group || 0),
        buy_n_free: Number(gallery.buy_n_free || 0),
        has_coupons: gallery.discount_mode === 'coupon',
        category: gallery.category,
        studio_name: studioName,
        studio_logo_url: studioLogo,
        require_login: !!gallery.require_login,
        download_mode: gallery.download_mode || 'off',
        protection: {
          enabled: prot.right_click !== false || prot.drag !== false,
          notice: prot.notice !== false,
        },
      },
      photos: (photosQ.data || []).map((p: any) => ({
        id: p.id,
        file_name: p.file_name,
        thumb_url: previewPublicUrl(p.thumb_path) || '',
        preview_url: previewPublicUrl(p.preview_path) || '',
      })),
      selections,
    });
  });

  // Login info — frontend chama esse endpoint LEVE pra saber se precisa
  // pedir login antes de mostrar a galeria (sem expor as fotos).
  app.get('/api/public/gallery/:token/login-info', async (req, res) => {
    if (!supabaseAdmin) return res.status(500).json({ error: 'Indisponível' });
    const gallery = await findGalleryByToken(req.params.token);
    if (!gallery) return res.status(404).json({ error: 'Galeria não encontrada' });
    const [studioName, studioLogo] = await Promise.all([
      getStudioNameForGallery(gallery.user_id),
      getStudioLogoForGallery(gallery.user_id),
    ]);
    res.json({
      title: gallery.title,
      studio_name: studioName,
      studio_logo_url: studioLogo,
      require_login: !!gallery.require_login,
      status: gallery.status,
    });
  });

  app.post('/api/public/gallery/:token/select', async (req, res) => {
    if (!supabaseAdmin) return res.status(500).json({ error: 'Indisponível' });
    // Anti-flood: ~240 cliques/min por token+IP (folgado pra seleção normal).
    if (!publicRateLimit(req, 'select', 240, 60 * 1000)) {
      return res.status(429).json({ error: 'Muitas ações seguidas. Aguarde um instante.' });
    }
    const gallery = await findGalleryByToken(req.params.token);
    if (!gallery) return res.status(404).json({ error: 'Galeria não encontrada' });
    if (gallery.status === 'delivered' || gallery.status === 'selected') {
      return res.status(409).json({ error: 'Seleção já finalizada — fale com o estúdio pra reabrir.' });
    }

    const access = await ensureGalleryAccess(req, res, gallery);
    if (access === undefined) return;

    // Mexeu na seleção com pagamento pendente? O valor pode mudar — expira a
    // cobrança antiga; o finalize gera outra com o valor certo.
    await supabaseAdmin
      .from('gallery_payments')
      .update({ status: 'expired' })
      .eq('gallery_id', gallery.id)
      .eq('status', 'pending');

    const { photo_id, selected, comment } = req.body || {};
    if (!photo_id) return res.status(400).json({ error: 'photo_id obrigatório' });
    const { data: photo } = await supabaseAdmin
      .from('gallery_photos').select('id').eq('id', photo_id).eq('gallery_id', gallery.id).maybeSingle();
    if (!photo) return res.status(404).json({ error: 'Foto não encontrada' });

    // Limita a 1000 chars — comentário de foto não precisa de mais e evita
    // que um blob gigante seja gravado (DoS de armazenamento).
    const cleanComment = typeof comment === 'string' && comment.trim() ? comment.trim().slice(0, 1000) : null;
    const { error } = await supabaseAdmin.from('gallery_selections').upsert(
      {
        gallery_id: gallery.id,
        photo_id,
        selected: !!selected,
        client_comment: cleanComment,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'gallery_id,photo_id' },
    );
    if (error) return res.status(500).json({ error: error.message });

    await logGalleryEvent(
      gallery.id,
      access.accessUserId,
      selected ? 'select_photo' : 'unselect_photo',
      req,
      { photoId: photo_id },
    );
    if (cleanComment) {
      await logGalleryEvent(gallery.id, access.accessUserId, 'comment_photo', req, {
        photoId: photo_id,
        detail: cleanComment.slice(0, 240),
      });
    }

    const totals = await galleryTotals(gallery.id, gallery.included_count, gallery.extra_price,
      galleryDiscountOpts(gallery, (req.body || {}).coupon));
    res.json({ ok: true, ...totals });
  });

  // Prévia de totais (sem mexer na seleção). Usado pra validar/aplicar um cupom:
  // o cliente manda { coupon } e recebe os totais já com o desconto — ou sem, se
  // o código não existir (coupon_applied = null sinaliza cupom inválido).
  app.post('/api/public/gallery/:token/totals', async (req, res) => {
    if (!supabaseAdmin) return res.status(500).json({ error: 'Indisponível' });
    if (!publicRateLimit(req, 'totals', 120, 60 * 1000)) {
      return res.status(429).json({ error: 'Muitas tentativas. Aguarde um instante.' });
    }
    const gallery = await findGalleryByToken(req.params.token);
    if (!gallery) return res.status(404).json({ error: 'Galeria não encontrada' });
    const access = await ensureGalleryAccess(req, res, gallery);
    if (access === undefined) return;
    const totals = await galleryTotals(gallery.id, gallery.included_count, gallery.extra_price,
      galleryDiscountOpts(gallery, (req.body || {}).coupon));
    res.json({ ok: true, ...totals });
  });

  // Cria a preference do Checkout Pro na conta MP do PRÓPRIO estúdio.
  async function createMercadoPagoCheckout(gallery: any, payment: any, _settings: any): Promise<string | null> {
    const token = await getValidMpAccessToken(payment.user_id);
    if (!token) return null;
    try {
      const resp = await fetch('https://api.mercadopago.com/checkout/preferences', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: [{
            title: `Fotos extras — ${gallery.title}`,
            quantity: 1,
            currency_id: 'BRL',
            unit_price: Number(payment.amount),
          }],
          external_reference: payment.id,
          notification_url: `${galleryPublicBase()}/api/public/gallery/mp-webhook?payment=${payment.id}`,
          back_urls: { success: galleryLink(gallery.share_token) },
          // Sem boleto: só cartão e Pix. ('ticket' = boleto/PEC no MP Brasil.)
          // Juros do parcelamento ficam por conta do cliente (padrão do MP); para
          // oferecer "parcelas sem juros" o estúdio liga em Custos na conta MP dele.
          payment_methods: { excluded_payment_types: [{ id: 'ticket' }] },
        }),
      });
      const data: any = await resp.json().catch(() => null);
      if (!resp.ok || !data?.id) {
        console.warn('[galeria] MP preference falhou:', resp.status, data?.message || '');
        return null;
      }
      await supabaseAdmin!.from('gallery_payments').update({ provider_ref: String(data.id) }).eq('id', payment.id);
      return data.init_point || data.sandbox_init_point || null;
    } catch (e: any) {
      console.warn('[galeria] MP erro:', e?.message);
      return null;
    }
  }

  async function createGalleryPayment(
    gallery: any,
    totals: { selected_count: number; extra_count: number; amount: number; coupon_applied?: string | null },
  ): Promise<{ payment_url: string | null; order_code: string | null; connected: boolean }> {
    // connected = o estúdio tem MP vinculado. Distingue "não conectou"
    // (cobra por fora, ok finalizar) de "conectou mas a cobrança falhou"
    // (erro transitório — NÃO pode liberar a galeria de graça).
    const settings = await getGallerySettings(gallery.user_id);
    const connected = !!(settings.mp_user_id && settings.mp_access_token);

    const order_code = `G${Date.now().toString(36).toUpperCase()}${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
    const insertRow: any = {
      gallery_id: gallery.id,
      user_id: gallery.user_id,
      order_code,
      extra_count: totals.extra_count,
      amount: totals.amount,
      provider: 'mercadopago',
      status: 'pending',
      coupon_code: totals.coupon_applied || null,
    };
    let { data: row, error } = await supabaseAdmin!
      .from('gallery_payments').insert(insertRow).select().single();
    // Coluna coupon_code ainda não migrada (052)? Repete sem ela.
    if (error && (error as any).code === '42703') {
      delete insertRow.coupon_code;
      ({ data: row, error } = await supabaseAdmin!
        .from('gallery_payments').insert(insertRow).select().single());
    }
    if (error || !row) {
      console.warn('[galeria] criar pagamento falhou:', error?.message);
      return { payment_url: null, order_code: null, connected };
    }
    const payment_url = await createMercadoPagoCheckout(gallery, row, settings);
    if (payment_url) {
      await supabaseAdmin!.from('gallery_payments').update({ payment_url }).eq('id', row.id);
    }
    return { payment_url, order_code, connected };
  }

  // Avisa o estúdio (e-mail de login + WhatsApp pro próprio número conectado).
  async function notifyStudioSelectionDone(
    gallery: any,
    totals: { selected_count: number; extra_count: number; amount: number },
  ) {
    const settings = await getGallerySettings(gallery.user_id);
    const studioName = await getStudioNameForGallery(gallery.user_id);

    if (isMailerConfigured() && supabaseAdmin) {
      const { data } = await supabaseAdmin.auth.admin.getUserById(gallery.user_id);
      const to = data?.user?.email;
      if (to) {
        await sendSelectionDoneEmail({
          to,
          from: settings.sender_email,
          studioName,
          clientName: gallery.client_name,
          galleryTitle: gallery.title,
          selectedCount: totals.selected_count,
          extraCount: totals.extra_count,
          amount: totals.amount,
        });
      }
    }

    if (settings.notify_studio_whatsapp !== false && BaileysManager.getStatus(gallery.user_id) === 'open') {
      const own = BaileysManager.getConnectedPhone(gallery.user_id);
      if (own) {
        const valor = totals.amount > 0 ? `, R$ ${totals.amount.toFixed(2).replace('.', ',')}` : '';
        const msg = `📸 ${gallery.client_name || 'Cliente'} finalizou a seleção de "${gallery.title}": ${totals.selected_count} foto(s), ${totals.extra_count} extra(s)${valor}.`;
        await BaileysManager.sendText(gallery.user_id, own.replace(/\D/g, ''), msg).catch(() => {});
      }
    }
  }

  // Fecha a galeria de verdade. Chamado quando: (a) finalize sem valor a
  // pagar; (b) pagamento confirmado pelo Mercado Pago (webhook/polling).
  async function finalizeGallery(gallery: any, totals: any, origem: string): Promise<void> {
    await supabaseAdmin!
      .from('galleries')
      .update({ status: 'selected', selected_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', gallery.id)
      .in('status', ['draft', 'sent']); // idempotente — não rebaixa nada
    try {
      await supabaseAdmin!.from('gallery_access_log').insert({
        gallery_id: gallery.id,
        access_user_id: null,
        event: 'finalize',
        detail: `selecionadas=${totals.selected_count} extras=${totals.extra_count} valor=${totals.amount} via=${origem}`,
        ip: origem,
        user_agent: null,
      });
    } catch { /* log é best-effort */ }
    notifyStudioSelectionDone(gallery, totals).catch((e: any) =>
      console.warn('[galeria] notificação ao estúdio falhou:', e?.message));
  }

  app.post('/api/public/gallery/:token/finalize', async (req, res) => {
    if (!supabaseAdmin) return res.status(500).json({ error: 'Indisponível' });
    try {
      const gallery = await findGalleryByToken(req.params.token);
      if (!gallery) return res.status(404).json({ error: 'Galeria não encontrada' });
      if (gallery.status === 'delivered' || gallery.status === 'selected') {
        return res.status(409).json({ error: 'Seleção já finalizada' });
      }

      const access = await ensureGalleryAccess(req, res, gallery);
      if (access === undefined) return;

      const totals = await galleryTotals(gallery.id, gallery.included_count, gallery.extra_price,
        galleryDiscountOpts(gallery, (req.body || {}).coupon));

      // SEM valor a pagar → finaliza na hora.
      if (totals.amount <= 0) {
        await logGalleryEvent(gallery.id, access.accessUserId, 'finalize', req, {
          detail: `selecionadas=${totals.selected_count} extras=${totals.extra_count} valor=0`,
        });
        await finalizeGallery(gallery, totals, 'cliente');
        return res.json({ ok: true, finalized: true, ...totals, payment_url: null, order_code: null });
      }

      // COM valor a pagar → a seleção SÓ finaliza após o pagamento confirmar.
      // Expira pendências antigas pra preference nova bater com a seleção atual.
      try {
        await supabaseAdmin
          .from('gallery_payments')
          .update({ status: 'expired' })
          .eq('gallery_id', gallery.id)
          .eq('status', 'pending');
      } catch (e: any) {
        console.warn('[galeria] expirar pendências falhou:', e?.message);
      }

      const payment = await createGalleryPayment(gallery, totals);
      await logGalleryEvent(gallery.id, access.accessUserId, 'pay_attempt', req, {
        detail: `valor=${totals.amount} pedido=${payment.order_code || '-'} conectado=${payment.connected}`,
      });

      if (!payment.payment_url) {
        if (payment.connected) {
          // Estúdio TEM MP, mas a cobrança falhou agora (rede/MP fora/token).
          // NÃO finaliza de graça — devolve erro pra cliente tentar de novo.
          console.warn(`[galeria] cobrança MP falhou com estúdio conectado — galeria ${gallery.id} NÃO finalizada`);
          return res.status(502).json({
            ok: false,
            error: 'Não conseguimos gerar o pagamento agora. Tente novamente em instantes.',
          });
        }
        // Estúdio nunca conectou MP: finaliza e o estúdio cobra por fora.
        await finalizeGallery(gallery, totals, 'cliente-sem-gateway');
        return res.json({ ok: true, finalized: true, ...totals, payment_url: null, order_code: payment.order_code });
      }

      res.json({ ok: true, finalized: false, payment_required: true, ...totals, ...payment });
    } catch (e: any) {
      // Sem o try o erro virava 500 sem corpo JSON → o cliente só via "tente de novo".
      console.error('[galeria] finalize falhou:', e?.message, e?.stack);
      if (!res.headersSent) {
        res.status(500).json({ ok: false, error: 'Erro ao finalizar a seleção. Tente novamente.' });
      }
    }
  });

  // Confirma o pagamento direto na API do MP (usado no polling e no webhook).
  // Pagamento aprovado → marca paid E finaliza a galeria (a seleção só fecha aqui).
  async function refreshMercadoPagoStatus(payment: any): Promise<any | null> {
    const token = await getValidMpAccessToken(payment.user_id);
    if (!token) return null;
    const resp = await fetch(
      `https://api.mercadopago.com/v1/payments/search?external_reference=${encodeURIComponent(payment.id)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!resp.ok) return null;
    const data: any = await resp.json().catch(() => null);
    // SÓ aceita se: aprovado + moeda BRL + valor pago >= valor cobrado.
    // Sem isso, um pagamento parcial/de centavos marcaria a galeria como
    // paga (fraude de valor). Tolerância de 1 centavo p/ arredondamento.
    const esperado = Number(payment.amount || 0);
    const approved = (data?.results || []).find((p: any) =>
      p.status === 'approved' &&
      (p.currency_id === 'BRL' || !p.currency_id) &&
      Number(p.transaction_amount || 0) >= esperado - 0.01,
    );
    if (!approved) {
      // Há aprovado mas com valor divergente? Loga pro estúdio investigar.
      const divergente = (data?.results || []).find((p: any) => p.status === 'approved');
      if (divergente) {
        console.warn(`[galeria] pagamento aprovado com valor divergente (esperado ${esperado}, pago ${divergente.transaction_amount}) — galeria NÃO finalizada. payment ${payment.id}`);
        try {
          await supabaseAdmin!.from('gallery_access_log').insert({
            gallery_id: payment.gallery_id, access_user_id: null, event: 'pay_mismatch',
            detail: `esperado=${esperado} pago=${divergente.transaction_amount} ${divergente.currency_id || ''}`,
            ip: 'mercadopago', user_agent: null,
          });
        } catch { /* best-effort */ }
      }
      return null;
    }
    const patch = { status: 'paid', paid_at: new Date().toISOString(), provider_ref: String(approved.id || payment.provider_ref || '') };
    await supabaseAdmin!.from('gallery_payments').update(patch).eq('id', payment.id);

    try {
      const { data: gallery } = await supabaseAdmin!
        .from('galleries').select('*').eq('id', payment.gallery_id).maybeSingle();
      if (gallery) {
        await supabaseAdmin!.from('gallery_access_log').insert({
          gallery_id: gallery.id,
          access_user_id: null,
          event: 'pay_success',
          detail: `valor=${payment.amount} pedido=${payment.order_code || '-'}`,
          ip: 'mercadopago',
          user_agent: null,
        });
        const totals = await galleryTotals(gallery.id, gallery.included_count, gallery.extra_price,
          galleryDiscountOpts(gallery, payment.coupon_code));
        await finalizeGallery(gallery, totals, 'pagamento-confirmado');
      }
    } catch (e: any) {
      console.warn('[galeria] finalização pós-pagamento falhou:', e?.message);
    }
    return { ...payment, ...patch };
  }

  app.get('/api/public/gallery/:token/payment-status', async (req, res) => {
    if (!supabaseAdmin) return res.status(500).json({ error: 'Indisponível' });
    const gallery = await findGalleryByToken(req.params.token);
    if (!gallery) return res.status(404).json({ error: 'Galeria não encontrada' });

    const { data: payment } = await supabaseAdmin
      .from('gallery_payments')
      .select('*')
      .eq('gallery_id', gallery.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!payment) return res.json({ status: null });

    if (payment.status === 'pending') {
      const updated = await refreshMercadoPagoStatus(payment).catch(() => null);
      if (updated) return res.json({ status: updated.status, payment_url: updated.payment_url });
    }
    res.json({ status: payment.status, payment_url: payment.payment_url });
  });

  // Webhook do Mercado Pago (notification_url da preference).
  app.post('/api/public/gallery/mp-webhook', async (req, res) => {
    res.sendStatus(200); // responde já — o MP reenvia se demorar
    try {
      const paymentRowId = String(req.query.payment || '');
      if (!paymentRowId || !supabaseAdmin) return;
      const { data: payment } = await supabaseAdmin
        .from('gallery_payments').select('*').eq('id', paymentRowId).maybeSingle();
      if (payment && payment.status === 'pending') await refreshMercadoPagoStatus(payment);
    } catch (e: any) {
      console.warn('[galeria] mp-webhook erro:', e?.message);
    }
  });

  // ════════════════════════════════════════════════════════════════════════
  // DIAGRAMAÇÃO DE ÁLBUM — editor visual de lâminas (spreads = 2 páginas)
  // Tabelas: album_projects, album_assets, album_spreads (migration
  // migrations/033_album.sql). Bucket: album-assets (PÚBLICO — saída é só
  // prévia visual pra aprovar, sem PDF de gráfica; original não precisa de
  // bucket privado). Fotos vêm da galeria de proofing (selecionadas) e de
  // upload próprio. Fotógrafo E cliente montam.
  // Preview de asset: reusa processGalleryPhoto com a MARCA DO ESTÚDIO leve
  // (é só prévia de aprovação — não é arquivo de gráfica). Fotos importadas
  // da galeria já vêm com preview/thumb prontos (referenciados direto do
  // bucket público da galeria, sem reprocessar).
  // Rotas públicas (/api/public/album/*) validam pelo share_token, sem auth.
  // ════════════════════════════════════════════════════════════════════════

  const ALBUM_ASSETS_BUCKET = 'album-assets';
  const ALBUM_SIZES_VALID = new Set(['sq15', 'sq20', 'sq25', 'sq30', 'port20x30', 'port30x40', 'land30x20', 'land40x30']);
  // Aceita os presets OU medida arbitrária "LxA" em cm (ex.: "29.7x29,7"),
  // pra cada linha de gráfica ter o tamanho exato dela.
  const ALBUM_SIZE_CUSTOM_RE = /^\d{1,3}([.,]\d{1,2})?x\d{1,3}([.,]\d{1,2})?$/i;
  const validAlbumSize = (s: any): boolean =>
    typeof s === 'string' && (ALBUM_SIZES_VALID.has(s) || ALBUM_SIZE_CUSTOM_RE.test(s.trim()));
  const normAlbumSize = (s: any): string => (typeof s === 'string' ? s.trim() : '');
  const ALBUM_STATUSES = ['draft', 'sent', 'approved'];
  const ALBUM_SPREAD_COUNT = 10; // lâminas em branco ao criar
  const ALBUM_DEFAULT_TEMPLATE = 'classico';

  let albumBucketReady = false;
  async function ensureAlbumBucket() {
    if (albumBucketReady || !supabaseAdmin) return;
    try {
      const { data: buckets } = await supabaseAdmin.storage.listBuckets();
      const names = new Set((buckets || []).map((b: any) => b.name));
      if (!names.has(ALBUM_ASSETS_BUCKET)) {
        await supabaseAdmin.storage.createBucket(ALBUM_ASSETS_BUCKET, {
          public: true,
          fileSizeLimit: 52_428_800, // 50MB por foto
        });
      }
      albumBucketReady = true;
    } catch (e: any) {
      console.error('[album] erro criando bucket:', e?.message);
    }
  }

  const albumPublicUrl = (p: string | null | undefined): string | null => {
    if (!p || !supabaseAdmin) return null;
    return supabaseAdmin.storage.from(ALBUM_ASSETS_BUCKET).getPublicUrl(p).data.publicUrl || null;
  };

  // Resolve a URL pública de um asset. Asset 'gallery' aponta pro bucket de
  // previews da galeria (já público); asset 'upload' pro bucket do álbum.
  const albumAssetUrl = (asset: { source?: string; preview_path?: string | null; thumb_path?: string | null; full_path?: string | null }, which: 'preview' | 'thumb'): string | null => {
    // full_path = foto LIMPA (sem marca d'água) copiada pro bucket do álbum —
    // é o que o editor usa. Vale tanto pra upload quanto pra import da galeria.
    if (asset.full_path) return albumPublicUrl(asset.full_path);
    const p = which === 'thumb' ? asset.thumb_path : asset.preview_path;
    if (!p) return which === 'thumb' ? albumAssetUrl(asset, 'preview') : null;
    return asset.source === 'gallery' ? previewPublicUrl(p) : albumPublicUrl(p);
  };

  const albumTableMissing = (error: any) => error?.code === '42P01';
  const albumMigrationError = (res: express.Response) =>
    res.status(400).json({ error: 'Tabelas do álbum não existem. Rode a migration 033_album.sql no Supabase.' });
  const albumSecurityMigrationError = (res: express.Response) =>
    res.status(400).json({ error: 'Tabelas de acesso do álbum não existem. Rode a migration 035_album_security.sql no Supabase.' });
  const albumCommentsMigrationError = (res: express.Response) =>
    res.status(400).json({ error: 'Tabela de comentários do álbum não existe. Rode a migration 036_album_comments.sql no Supabase.' });
  const newAlbumToken = () => crypto.randomBytes(18).toString('base64url');
  const albumLink = (token: string) => `${galleryPublicBase()}/a/${token}`;

  function mapAlbumAsset(a: any) {
    return {
      id: a.id,
      source: a.source,
      preview_url: albumAssetUrl(a, 'preview'),
      thumb_url: albumAssetUrl(a, 'thumb'),
      original_name: a.original_name,
      sort_order: a.sort_order,
    };
  }

  function mapAlbumSpread(s: any) {
    return {
      id: s.id,
      position: s.position,
      kind: s.kind || 'spread',
      template_id: s.template_id,
      slots: Array.isArray(s.slots) ? s.slots : [],
      canvas_json: s.canvas_json || null,
    };
  }

  // ── Acesso & auditoria do álbum (espelho do padrão da galeria) ─────────────

  // Insere um evento no log do álbum — best-effort, NUNCA quebra a request.
  async function logAlbumEvent(
    albumId: string,
    accessUserId: string | null,
    event: string,
    req: express.Request,
    detail?: string | null,
  ): Promise<void> {
    if (!supabaseAdmin) return;
    try {
      const { ip, ua } = reqIpUa(req);
      await supabaseAdmin.from('album_access_log').insert({
        album_id: albumId,
        access_user_id: accessUserId,
        event,
        detail: detail || null,
        ip, user_agent: ua,
      });
    } catch (e: any) {
      console.warn('[album] log falhou:', e?.message);
    }
  }

  // Throttle do log de edição (autosave dispara muito): só registra um
  // 'edit_album' por álbum+cliente a cada 90s — vira uma trilha legível em vez
  // de centenas de linhas. Em memória; best-effort.
  const albumEditLogged = new Map<string, number>();
  function shouldLogAlbumEdit(albumId: string, accessUserId: string | null): boolean {
    const key = `${albumId}:${accessUserId || 'anon'}`;
    const now = Date.now();
    const last = albumEditLogged.get(key) || 0;
    if (now - last < 90 * 1000) return false;
    albumEditLogged.set(key, now);
    if (albumEditLogged.size > 5000) {
      for (const [k, t] of albumEditLogged) if (now - t > 10 * 60 * 1000) albumEditLogged.delete(k);
    }
    return true;
  }

  // Lê o session token do header Authorization (formato as:v1:...).
  function albumSessionFromReq(req: express.Request): AlbumSessionPayload | null {
    const auth = req.headers.authorization || '';
    if (!auth.startsWith('Bearer ')) return null;
    return verifyAlbumSession(auth.slice(7));
  }

  // Estado de acesso ao álbum público. Se require_login=false, acesso anônimo
  // (mas respeita a sessão se vier). Se require_login=true, exige sessão válida
  // do mesmo album_id. Não responde nada — quem chama decide (login vs 401).
  function albumAccessState(req: express.Request, album: any): { ok: boolean; accessUserId: string | null } {
    const sess = albumSessionFromReq(req);
    const valid = sess && sess.aid === album.id ? sess.uid : null;
    if (!album.require_login) return { ok: true, accessUserId: valid };
    return { ok: !!valid, accessUserId: valid };
  }

  // Conta login_fail recentes (15 min) pra lockout por álbum.
  async function recentAlbumLoginFails(albumId: string): Promise<number> {
    if (!supabaseAdmin) return 0;
    try {
      const since = new Date(Date.now() - 15 * 60 * 1000).toISOString();
      const { count } = await supabaseAdmin
        .from('album_access_log')
        .select('id', { count: 'exact', head: true })
        .eq('album_id', albumId)
        .eq('event', 'login_fail')
        .gte('created_at', since);
      return count || 0;
    } catch {
      return 0;
    }
  }

  // Importa as fotos SELECIONADAS de uma galeria como album_assets (source
  // 'gallery', preview_path/thumb_path copiados de gallery_photos). Idempotente
  // por (album_id, gallery preview_path): não reimporta a mesma foto. Retorna
  // quantas foram importadas de fato.
  async function importGalleryPhotosToAlbum(albumId: string, userId: string, galleryId: string): Promise<number> {
    if (!supabaseAdmin) return 0;
    const { data: gallery } = await supabaseAdmin
      .from('galleries').select('id').eq('id', galleryId).eq('user_id', userId).maybeSingle();
    if (!gallery) return 0;

    const { data: sel } = await supabaseAdmin
      .from('gallery_selections').select('photo_id').eq('gallery_id', galleryId).eq('selected', true);
    const selectedIds = (sel || []).map((s: any) => s.photo_id).filter(Boolean);
    if (selectedIds.length === 0) return 0;

    const { data: photos } = await supabaseAdmin
      .from('gallery_photos')
      .select('id, file_name, original_path, preview_path, thumb_path, sort_order')
      .in('id', selectedIds)
      .eq('process_status', 'done')
      .order('sort_order');
    const ready = (photos || []).filter((p: any) => p.original_path || p.preview_path);
    if (ready.length === 0) return 0;

    // Idempotência: não reimporta a mesma foto da galeria (por original_path).
    const { data: existing } = await supabaseAdmin
      .from('album_assets').select('source_ref').eq('album_id', albumId).eq('source', 'gallery');
    const have = new Set((existing || []).map((r: any) => r.source_ref).filter(Boolean));
    const { count } = await supabaseAdmin
      .from('album_assets').select('id', { count: 'exact', head: true }).eq('album_id', albumId);
    let order = count || 0;

    await ensureAlbumBucket();
    const novos = ready.filter((p: any) => !have.has(p.original_path || p.preview_path));
    let importadas = 0;
    for (const p of novos) {
      try {
        // Copia o ORIGINAL (limpo, sem marca d'água) do bucket privado da
        // galeria pro bucket do álbum, com path uuid não-adivinhável.
        const srcBucket = p.original_path ? GALLERY_ORIGINALS_BUCKET : GALLERY_PREVIEWS_BUCKET;
        const srcPath = p.original_path || p.preview_path;
        const buf = await downloadGalleryObject(srcBucket, srcPath);
        const destPath = `${userId}/${albumId}/gallery/${crypto.randomUUID()}.jpg`;
        const up = await supabaseAdmin.storage.from(ALBUM_ASSETS_BUCKET)
          .upload(destPath, buf, { contentType: 'image/jpeg', upsert: true });
        if (up.error) throw new Error(up.error.message);
        const ins = await supabaseAdmin.from('album_assets').insert({
          album_id: albumId,
          source: 'gallery',
          source_ref: p.original_path || p.preview_path,
          full_path: destPath,
          preview_path: destPath,
          thumb_path: destPath,
          original_name: p.file_name,
          sort_order: order++,
        });
        if (ins.error) throw new Error(ins.error.message);
        importadas++;
      } catch (e: any) {
        console.warn('[album] import de foto da galeria falhou:', e?.message);
      }
    }
    return importadas;
  }

  async function carregarAlbum(supabase: SupabaseClient, userId: string, id: string): Promise<any | null> {
    const { data, error } = await supabase
      .from('album_projects').select('*').eq('id', id).eq('user_id', userId).maybeSingle();
    if (error) throw error;
    return data || null;
  }

  // ── CRUD de álbuns (lado do estúdio) ──────────────────────────────────────

  app.get('/api/albums', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (supabaseAdmin || (req as any).supabase) as SupabaseClient;
    const { data, error } = await supabase
      .from('album_projects').select('*').eq('user_id', userId).order('created_at', { ascending: false });
    if (error) {
      if (albumTableMissing(error)) return res.json({ albums: [], table_missing: true });
      return res.status(500).json({ error: error.message });
    }
    const albums = data || [];
    if (albums.length === 0) return res.json({ albums: [] });

    const ids = albums.map((a: any) => a.id);
    const [spreadsQ, assetsQ] = await Promise.all([
      supabase.from('album_spreads').select('album_id').in('album_id', ids),
      supabase.from('album_assets').select('album_id, thumb_path, preview_path, source, sort_order').in('album_id', ids),
    ]);

    const spreadCount = new Map<string, number>();
    for (const s of spreadsQ.data || []) spreadCount.set(s.album_id, (spreadCount.get(s.album_id) || 0) + 1);

    const assetCount = new Map<string, number>();
    const cover = new Map<string, any>();
    const sortedAssets = (assetsQ.data || []).slice().sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0));
    for (const a of sortedAssets) {
      assetCount.set(a.album_id, (assetCount.get(a.album_id) || 0) + 1);
      if (!cover.has(a.album_id)) cover.set(a.album_id, a);
    }

    res.json({
      albums: albums.map((a: any) => ({
        id: a.id,
        title: a.title,
        client_name: a.client_name,
        status: a.status,
        size: a.size,
        spread_count: spreadCount.get(a.id) || 0,
        asset_count: assetCount.get(a.id) || 0,
        cover_thumb_url: cover.has(a.id) ? albumAssetUrl(cover.get(a.id), 'thumb') : null,
        created_at: a.created_at,
      })),
    });
  });

  app.post('/api/albums', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (supabaseAdmin || (req as any).supabase) as SupabaseClient;
    const body = req.body || {};
    const title = String(body.title || '').trim();
    if (!title) return res.status(400).json({ error: 'Informe um título pro álbum.' });

    // Gating de plano: Designer de Álbum só nos planos Studio/Premium.
    if (!planAllowsFeature(await getPlanLimits(userId), 'album')) {
      return res.status(403).json({ error: 'O Designer de Álbum está disponível nos planos Studio e Premium.', feature_locked: 'album' });
    }

    const size = validAlbumSize(body.size) ? normAlbumSize(body.size) : 'sq30';
    const insert: any = {
      user_id: userId,
      title: title.slice(0, 200),
      size,
      status: 'draft',
      share_token: newAlbumToken(),
      allow_client_edit: body.allow_client_edit !== false,
    };
    for (const k of ['gallery_id', 'job_id', 'client_id', 'client_name', 'client_email', 'client_phone']) {
      if (body[k] !== undefined && body[k] !== null && body[k] !== '') insert[k] = body[k];
    }

    const { data: album, error } = await supabase
      .from('album_projects').insert(insert).select('*').maybeSingle();
    if (error || !album) {
      return albumTableMissing(error) ? albumMigrationError(res) : res.status(500).json({ error: error?.message || 'Falha ao criar álbum.' });
    }

    // Lâminas em branco. Se vieram spreads no body, usa-os; senão 10 brancas.
    const spreadsBody = Array.isArray(body.spreads) ? body.spreads : [];
    const spreadRows = spreadsBody.length > 0
      ? spreadsBody.map((s: any, i: number) => ({
          album_id: album.id,
          position: Number.isFinite(s?.position) ? Number(s.position) : i,
          template_id: typeof s?.template_id === 'string' ? s.template_id : ALBUM_DEFAULT_TEMPLATE,
          slots: Array.isArray(s?.slots) ? s.slots : [],
        }))
      : Array.from({ length: ALBUM_SPREAD_COUNT }, (_, i) => ({
          album_id: album.id,
          position: i,
          // 1ª página = capa, última = contracapa, resto = lâminas.
          kind: i === 0 ? 'cover' : (i === ALBUM_SPREAD_COUNT - 1 ? 'backcover' : 'spread'),
          template_id: ALBUM_DEFAULT_TEMPLATE,
          slots: [],
        }));
    await supabase.from('album_spreads').insert(spreadRows);

    // Importa fotos selecionadas da galeria, se informada (best-effort).
    if (insert.gallery_id) {
      await importGalleryPhotosToAlbum(album.id, userId, insert.gallery_id)
        .catch((e: any) => console.warn('[album] import galeria falhou:', e?.message));
    }

    res.json({ album });
  });

  app.get('/api/albums/:id', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (supabaseAdmin || (req as any).supabase) as SupabaseClient;
    let album: any;
    try {
      album = await carregarAlbum(supabase, userId, req.params.id);
    } catch (e: any) {
      return albumTableMissing(e) ? albumMigrationError(res) : res.status(500).json({ error: e.message });
    }
    if (!album) return res.status(404).json({ error: 'Álbum não encontrado' });

    const [assetsQ, spreadsQ] = await Promise.all([
      supabase.from('album_assets').select('*').eq('album_id', album.id).order('sort_order').order('created_at'),
      supabase.from('album_spreads').select('*').eq('album_id', album.id).order('position'),
    ]);

    res.json({
      album,
      assets: (assetsQ.data || []).map(mapAlbumAsset),
      spreads: (spreadsQ.data || []).map(mapAlbumSpread),
    });
  });

  function buildAlbumPatch(body: any): any {
    const patch: any = { updated_at: new Date().toISOString() };
    if (body.title !== undefined) patch.title = String(body.title || '').trim().slice(0, 200) || 'Álbum';
    if (body.size !== undefined && validAlbumSize(body.size)) patch.size = normAlbumSize(body.size);
    if (body.status !== undefined && ALBUM_STATUSES.includes(body.status)) patch.status = body.status;
    if (body.allow_client_edit !== undefined) patch.allow_client_edit = !!body.allow_client_edit;
    if (body.require_login !== undefined) patch.require_login = !!body.require_login;
    for (const k of ['client_id', 'client_name', 'client_email', 'client_phone']) {
      if (body[k] !== undefined) patch[k] = body[k] || null;
    }
    return patch;
  }

  app.put('/api/albums/:id', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (supabaseAdmin || (req as any).supabase) as SupabaseClient;
    const patch = buildAlbumPatch(req.body || {});
    const { error } = await supabase
      .from('album_projects').update(patch).eq('id', req.params.id).eq('user_id', userId);
    if (error) {
      return albumTableMissing(error) ? albumMigrationError(res) : res.status(500).json({ error: error.message });
    }
    res.json({ ok: true });
  });

  app.delete('/api/albums/:id', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (supabaseAdmin || (req as any).supabase) as SupabaseClient;
    const album = await carregarAlbum(supabase, userId, req.params.id).catch(() => null);
    if (!album) return res.status(404).json({ error: 'Álbum não encontrado' });

    // Remove os arquivos de upload do storage (gallery assets ficam — são da
    // galeria). Best-effort: a falha do storage não impede apagar as linhas.
    if (supabaseAdmin) {
      const { data: assets } = await supabaseAdmin
        .from('album_assets').select('source, preview_path, thumb_path').eq('album_id', album.id);
      const paths: string[] = [];
      for (const a of assets || []) {
        if (a.source === 'upload') {
          if (a.preview_path) paths.push(a.preview_path);
          if (a.thumb_path && a.thumb_path !== a.preview_path) paths.push(a.thumb_path);
        }
      }
      if (paths.length > 0) {
        await supabaseAdmin.storage.from(ALBUM_ASSETS_BUCKET).remove(paths).catch(() => {});
      }
    }

    // Cascade (FK ON DELETE CASCADE) limpa assets + spreads.
    const { error } = await supabase
      .from('album_projects').delete().eq('id', album.id).eq('user_id', userId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  });

  // ── Upload de fotos próprias (browser sobe direto pro bucket público) ──────

  app.post('/api/albums/:id/assets/sign-upload', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (supabaseAdmin || (req as any).supabase) as SupabaseClient;
    if (!supabaseAdmin) return res.status(500).json({ error: 'Storage indisponível.' });
    const files = Array.isArray(req.body?.files) ? req.body.files : [];
    if (files.length === 0 || files.length > 50) {
      return res.status(400).json({ error: 'Envie de 1 a 50 arquivos por lote.' });
    }
    const album = await carregarAlbum(supabase, userId, req.params.id).catch(() => null);
    if (!album) return res.status(404).json({ error: 'Álbum não encontrado' });
    await ensureAlbumBucket();

    // Trava de armazenamento do plano (fail-open).
    const incoming = files.reduce((s: number, f: any) => s + (Number(f?.size) || 0), 0);
    const fit = await storageWouldFit(userId, incoming);
    if (!fit.ok) {
      return res.status(403).json({ error: `Armazenamento cheio (${fit.usedGb.toFixed(1)} de ${fit.capGb} GB). Apague fotos antigas ou suba pro plano Premium.`, storage_full: true });
    }

    const { count } = await supabase
      .from('album_assets').select('id', { count: 'exact', head: true }).eq('album_id', album.id);
    const baseOrder = count || 0;

    const rows = files.map((f: any, i: number) => {
      const id = crypto.randomUUID();
      return {
        id,
        album_id: album.id,
        source: 'upload',
        original_name: String(f?.name || `foto-${baseOrder + i + 1}.jpg`).slice(0, 300),
        sort_order: baseOrder + i,
        // path do ORIGINAL temporário (processado depois em /process):
        preview_path: `${userId}/${album.id}/${id}/original`,
      };
    });
    const { error: insErr } = await supabase.from('album_assets').insert(rows);
    if (insErr) {
      return albumTableMissing(insErr) ? albumMigrationError(res) : res.status(500).json({ error: insErr.message });
    }

    const uploads: Array<{ asset_id: string; signed_url: string }> = [];
    for (const r of rows) {
      const { data: signed, error: sErr } = await supabaseAdmin.storage
        .from(ALBUM_ASSETS_BUCKET)
        .createSignedUploadUrl(r.preview_path);
      if (sErr || !signed) {
        return res.status(500).json({ error: `Falha ao assinar upload: ${sErr?.message || 'desconhecida'}` });
      }
      uploads.push({ asset_id: r.id, signed_url: signed.signedUrl });
    }
    res.json({ uploads });
  });

  async function downloadAlbumObject(objectPath: string): Promise<Buffer> {
    const { data, error } = await supabaseAdmin!.storage.from(ALBUM_ASSETS_BUCKET).download(objectPath);
    if (error || !data) throw new Error(`download falhou: ${error?.message || 'arquivo vazio'}`);
    return Buffer.from(await data.arrayBuffer());
  }

  async function uploadAlbumObject(objectPath: string, buf: Buffer) {
    const { error } = await supabaseAdmin!.storage
      .from(ALBUM_ASSETS_BUCKET)
      .upload(objectPath, buf, { contentType: 'image/jpeg', upsert: true });
    if (error) throw new Error(`upload falhou: ${error.message}`);
  }

  // Gera preview + thumb a partir do original recém-enviado. É só PRÉVIA de
  // aprovação (sem PDF de gráfica), então a marca d'água do estúdio é leve e
  // serve só pra identificar — reusa o mesmo processGalleryPhoto da galeria.
  app.post('/api/albums/:id/assets/:assetId/process', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (supabaseAdmin || (req as any).supabase) as SupabaseClient;
    if (!supabaseAdmin) return res.status(500).json({ error: 'Storage indisponível.' });

    const album = await carregarAlbum(supabase, userId, req.params.id).catch(() => null);
    if (!album) return res.status(404).json({ error: 'Álbum não encontrado' });
    const { data: asset } = await supabase
      .from('album_assets').select('*').eq('id', req.params.assetId).eq('album_id', album.id).maybeSingle();
    if (!asset?.preview_path) return res.status(404).json({ error: 'Foto não encontrada' });

    try {
      if (/\.heic$|\.heif$/i.test(asset.original_name || '')) {
        throw new Error('Formato HEIC não suportado — converta pra JPEG antes de enviar.');
      }
      const originalPath = `${userId}/${album.id}/${asset.id}/original`;
      const original = await downloadAlbumObject(originalPath);

      const studioName = await getStudioNameForGallery(userId);
      const out = await processGalleryPhoto(original, {
        watermarkType: 'text',
        watermarkText: studioName,
        logo: null,
        opacity: 0.18, // marca leve — é só prévia de aprovação
        clientLabel: null,
      });

      const base = `${userId}/${album.id}/${asset.id}`;
      await uploadAlbumObject(`${base}/preview.jpg`, out.preview);
      await uploadAlbumObject(`${base}/thumb.jpg`, out.thumb);
      // O original temporário não é mais necessário (saída é só prévia).
      await supabaseAdmin.storage.from(ALBUM_ASSETS_BUCKET).remove([originalPath]).catch(() => {});

      const patch = { preview_path: `${base}/preview.jpg`, thumb_path: `${base}/thumb.jpg` };
      await supabase.from('album_assets').update(patch).eq('id', asset.id);
      res.json({ asset: { id: asset.id, ...mapAlbumAsset({ ...asset, ...patch }) } });
    } catch (e: any) {
      console.error('[album] processamento falhou:', e?.message);
      res.status(500).json({ error: `Falha ao processar foto: ${e?.message || 'desconhecida'}` });
    }
  });

  app.post('/api/albums/:id/assets/import-gallery', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (supabaseAdmin || (req as any).supabase) as SupabaseClient;
    const galleryId = String(req.body?.gallery_id || '').trim();
    if (!galleryId) return res.status(400).json({ error: 'gallery_id obrigatório' });
    const album = await carregarAlbum(supabase, userId, req.params.id).catch(() => null);
    if (!album) return res.status(404).json({ error: 'Álbum não encontrado' });
    try {
      const imported = await importGalleryPhotosToAlbum(album.id, userId, galleryId);
      res.json({ imported });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || 'Falha ao importar fotos.' });
    }
  });

  app.delete('/api/albums/:id/assets/:assetId', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (supabaseAdmin || (req as any).supabase) as SupabaseClient;
    const album = await carregarAlbum(supabase, userId, req.params.id).catch(() => null);
    if (!album) return res.status(404).json({ error: 'Álbum não encontrado' });

    const { data: asset } = await supabase
      .from('album_assets').select('*').eq('id', req.params.assetId).eq('album_id', album.id).maybeSingle();
    if (!asset) return res.status(404).json({ error: 'Foto não encontrada' });

    if (supabaseAdmin && asset.source === 'upload') {
      const base = `${userId}/${album.id}/${asset.id}`;
      await supabaseAdmin.storage.from(ALBUM_ASSETS_BUCKET)
        .remove([`${base}/original`, `${base}/preview.jpg`, `${base}/thumb.jpg`]).catch(() => {});
    }
    const { error } = await supabase.from('album_assets').delete().eq('id', asset.id).eq('album_id', album.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  });

  // ── Lâminas (spreads): salva em lote (replace) ────────────────────────────

  // Sanitiza uma lâmina vinda do body. template_id e slots são livres
  // (validação fina fica no front com o contrato de templates); aqui só
  // garante tipos e tamanho seguro.
  function sanitizeSpread(s: any, fallbackPos: number): { id: string | null; position: number; kind: string; template_id: string; slots: any[]; canvas_json: any } {
    const kind = ['cover', 'spread', 'backcover'].includes(s?.kind) ? s.kind : 'spread';
    return {
      id: typeof s?.id === 'string' && s.id ? s.id : null,
      position: Number.isFinite(s?.position) ? Number(s.position) : fallbackPos,
      kind,
      template_id: (typeof s?.template_id === 'string' && s.template_id ? s.template_id : ALBUM_DEFAULT_TEMPLATE).slice(0, 64),
      slots: Array.isArray(s?.slots) ? s.slots.slice(0, 64) : [],
      // canvas_json = desenho livre do fabric.js (objeto). Limite defensivo
      // de tamanho serializado (~2MB) pra não estourar a linha.
      canvas_json: s?.canvas_json && JSON.stringify(s.canvas_json).length < 2_000_000 ? s.canvas_json : null,
    };
  }

  // Replace em lote: atualiza por id, cria novos sem id, e remove os que
  // sumiram da lista. Transação lógica (sequência de queries scoped pelo
  // album_id já validado pelo user_id).
  async function replaceAlbumSpreads(albumId: string, incoming: any[]): Promise<any[]> {
    const clean = incoming.map((s, i) => sanitizeSpread(s, i));
    const keepIds = clean.filter((s) => s.id).map((s) => s.id as string);

    // 1) Apaga os que sumiram da lista.
    let delQ = supabaseAdmin!.from('album_spreads').delete().eq('album_id', albumId);
    if (keepIds.length > 0) delQ = delQ.not('id', 'in', `(${keepIds.join(',')})`);
    await delQ;

    // 2) Atualiza os existentes (por id, scoped pelo album_id).
    for (const s of clean) {
      if (!s.id) continue;
      await supabaseAdmin!.from('album_spreads').update({
        position: s.position, kind: s.kind, template_id: s.template_id, slots: s.slots,
        canvas_json: s.canvas_json, updated_at: new Date().toISOString(),
      }).eq('id', s.id).eq('album_id', albumId);
    }

    // 3) Cria os novos (sem id).
    const novos = clean.filter((s) => !s.id).map((s) => ({
      album_id: albumId, position: s.position, kind: s.kind, template_id: s.template_id, slots: s.slots, canvas_json: s.canvas_json,
    }));
    if (novos.length > 0) await supabaseAdmin!.from('album_spreads').insert(novos);

    const { data } = await supabaseAdmin!
      .from('album_spreads').select('*').eq('album_id', albumId).order('position');
    return (data || []).map(mapAlbumSpread);
  }

  app.put('/api/albums/:id/spreads', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (supabaseAdmin || (req as any).supabase) as SupabaseClient;
    if (!supabaseAdmin) return res.status(500).json({ error: 'Indisponível' });
    const album = await carregarAlbum(supabase, userId, req.params.id).catch(() => null);
    if (!album) return res.status(404).json({ error: 'Álbum não encontrado' });
    const spreads = Array.isArray(req.body?.spreads) ? req.body.spreads : [];
    if (spreads.length > 200) return res.status(400).json({ error: 'Máximo de 200 lâminas.' });

    try {
      const saved = await replaceAlbumSpreads(album.id, spreads);
      await supabase.from('album_projects').update({ updated_at: new Date().toISOString() }).eq('id', album.id);
      res.json({ ok: true, spreads: saved });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || 'Falha ao salvar lâminas.' });
    }
  });

  // ── Export (a "lista": qual foto em cada lâmina) ──────────────────────────

  app.get('/api/albums/:id/export', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (supabaseAdmin || (req as any).supabase) as SupabaseClient;
    const album = await carregarAlbum(supabase, userId, req.params.id).catch(() => null);
    if (!album) return res.status(404).json({ error: 'Álbum não encontrado' });

    const [assetsQ, spreadsQ] = await Promise.all([
      supabase.from('album_assets').select('id, original_name').eq('album_id', album.id),
      supabase.from('album_spreads').select('position, template_id, slots').eq('album_id', album.id).order('position'),
    ]);
    const nameById = new Map<string, string>();
    for (const a of assetsQ.data || []) nameById.set(a.id, a.original_name || 'foto');

    const pages = (spreadsQ.data || []).map((s: any, i: number) => {
      const slots = Array.isArray(s.slots) ? s.slots : [];
      const photos: string[] = [];
      for (const slot of slots) {
        const assetId = typeof slot === 'string' ? slot : slot?.asset_id;
        if (assetId && nameById.has(assetId)) photos.push(nameById.get(assetId)!);
      }
      return { spread: i + 1, template: s.template_id, photos };
    });
    res.json({ album_title: album.title, pages });
  });

  // ── Envio do link pra cliente (e-mail + WhatsApp) ─────────────────────────

  app.post('/api/albums/:id/send', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (supabaseAdmin || (req as any).supabase) as SupabaseClient;
    const album = await carregarAlbum(supabase, userId, req.params.id).catch(() => null);
    if (!album) return res.status(404).json({ error: 'Álbum não encontrado' });

    const settings = await getGallerySettings(userId);
    const studioName = await getStudioNameForGallery(userId);
    const link = albumLink(album.share_token);
    const message =
      `Olá ${album.client_name || ''}! O layout do seu álbum "${album.title}" está pronto pra você revisar e aprovar. ` +
      `Acesse: ${link}`.replace('  ', ' ');

    let email: { sent: boolean; error?: string } = { sent: false, error: 'Cliente sem e-mail cadastrado.' };
    if (album.client_email) {
      const r = await sendGalleryMessageEmail({
        to: album.client_email,
        from: settings.sender_email,
        studioName,
        subject: `Seu álbum está pronto pra aprovação — ${album.title}`,
        messageText: message,
        link,
      });
      email = { sent: r.ok, error: r.error };
    }

    let whatsapp: { sent: boolean; error?: string } = { sent: false, error: 'Cliente sem telefone cadastrado.' };
    const digits = String(album.client_phone || '').replace(/\D/g, '');
    if (digits) {
      if (BaileysManager.getStatus(userId) !== 'open') {
        whatsapp = { sent: false, error: 'WhatsApp desconectado — conecte na página WhatsApp do app.' };
      } else {
        try {
          await BaileysManager.sendText(userId, normalizeBrazilianPhone(digits), message);
          whatsapp = { sent: true };
        } catch (e: any) {
          whatsapp = { sent: false, error: `Falha no envio: ${e?.message || 'desconhecida'}` };
        }
      }
    }

    if (email.sent || whatsapp.sent || album.status === 'draft') {
      await supabase.from('album_projects')
        .update({ status: album.status === 'approved' ? 'approved' : 'sent', updated_at: new Date().toISOString() })
        .eq('id', album.id).eq('user_id', userId);
    }
    res.json({ ok: email.sent || whatsapp.sent, link, email, whatsapp });
  });

  // ── Acesso (login/senha) do cliente — lado do estúdio ─────────────────────

  app.get('/api/albums/:id/access', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (supabaseAdmin || (req as any).supabase) as SupabaseClient;
    const album = await carregarAlbum(supabase, userId, req.params.id).catch(() => null);
    if (!album) return res.status(404).json({ error: 'Álbum não encontrado' });
    const { data, error } = await supabase
      .from('album_access_users')
      .select('id, email, name, role, last_login_at, login_count, created_at')
      .eq('album_id', album.id)
      .order('created_at');
    if (error) {
      return albumTableMissing(error) ? albumSecurityMigrationError(res) : res.status(500).json({ error: error.message });
    }
    res.json({ users: data || [], require_login: !!album.require_login });
  });

  app.post('/api/albums/:id/access', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (supabaseAdmin || (req as any).supabase) as SupabaseClient;
    const album = await carregarAlbum(supabase, userId, req.params.id).catch(() => null);
    if (!album) return res.status(404).json({ error: 'Álbum não encontrado' });

    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const name = req.body?.name ? String(req.body.name).trim() : null;
    const role: 'owner' | 'guest' = req.body?.role === 'guest' ? 'guest' : 'owner';
    if (!email.includes('@')) return res.status(400).json({ error: 'E-mail inválido' });
    if (password.length < 6) return res.status(400).json({ error: 'Senha curta demais (mínimo 6 caracteres).' });

    const password_hash = await bcrypt.hash(password, 10);
    const { data, error } = await supabase
      .from('album_access_users')
      .insert({ album_id: album.id, email, password_hash, name, role, invited_by: userId })
      .select('id, email, name, role, created_at')
      .single();
    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'Esse e-mail já tem acesso a este álbum.' });
      return albumTableMissing(error) ? albumSecurityMigrationError(res) : res.status(500).json({ error: error.message });
    }
    res.json({ user: data });
  });

  app.put('/api/albums/:id/access/:userId', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (supabaseAdmin || (req as any).supabase) as SupabaseClient;
    const album = await carregarAlbum(supabase, userId, req.params.id).catch(() => null);
    if (!album) return res.status(404).json({ error: 'Álbum não encontrado' });

    const patch: any = { updated_at: new Date().toISOString() };
    if (req.body?.name !== undefined) patch.name = req.body.name ? String(req.body.name).trim() : null;
    if (req.body?.role === 'owner' || req.body?.role === 'guest') patch.role = req.body.role;
    if (typeof req.body?.password === 'string' && req.body.password.length >= 6) {
      patch.password_hash = await bcrypt.hash(req.body.password, 10);
    }
    const { error } = await supabase
      .from('album_access_users').update(patch).eq('id', req.params.userId).eq('album_id', album.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  });

  app.delete('/api/albums/:id/access/:userId', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (supabaseAdmin || (req as any).supabase) as SupabaseClient;
    const album = await carregarAlbum(supabase, userId, req.params.id).catch(() => null);
    if (!album) return res.status(404).json({ error: 'Álbum não encontrado' });
    const { error } = await supabase
      .from('album_access_users').delete().eq('id', req.params.userId).eq('album_id', album.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  });

  // Log de auditoria + sumário pras abas "Acesso" / "Atividades" do estúdio.
  app.get('/api/albums/:id/audit', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (supabaseAdmin || (req as any).supabase) as SupabaseClient;
    const album = await carregarAlbum(supabase, userId, req.params.id).catch(() => null);
    if (!album) return res.status(404).json({ error: 'Álbum não encontrado' });

    const [logQ, usersQ] = await Promise.all([
      supabase
        .from('album_access_log')
        .select('id, event, detail, ip, user_agent, created_at, access_user_id')
        .eq('album_id', album.id)
        .order('created_at', { ascending: false })
        .limit(500),
      supabase
        .from('album_access_users')
        .select('id, email, name, role, last_login_at, login_count')
        .eq('album_id', album.id),
    ]);
    if (logQ.error && albumTableMissing(logQ.error)) return albumSecurityMigrationError(res);

    const usersById = new Map<string, any>();
    for (const u of usersQ.data || []) usersById.set(u.id, u);

    const events = (logQ.data || []).map((e: any) => ({
      id: e.id,
      event: e.event,
      detail: e.detail,
      ip: e.ip,
      user_agent: e.user_agent,
      created_at: e.created_at,
      user: e.access_user_id ? {
        id: e.access_user_id,
        email: usersById.get(e.access_user_id)?.email || null,
        name: usersById.get(e.access_user_id)?.name || null,
      } : null,
    }));

    const summary = {
      total_users: (usersQ.data || []).length,
      total_views: events.filter((e) => e.event === 'view_album').length,
      total_logins: events.filter((e) => e.event === 'login').length,
      total_login_fails: events.filter((e) => e.event === 'login_fail').length,
      total_edits: events.filter((e) => e.event === 'edit_album').length,
      last_event_at: events[0]?.created_at || null,
      approved_at: events.find((e) => e.event === 'approve')?.created_at || null,
    };
    res.json({ users: usersQ.data || [], events, summary });
  });

  // ── Comentários do cliente — lado do estúdio ──────────────────────────────

  app.get('/api/albums/:id/comments', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (supabaseAdmin || (req as any).supabase) as SupabaseClient;
    const album = await carregarAlbum(supabase, userId, req.params.id).catch(() => null);
    if (!album) return res.status(404).json({ error: 'Álbum não encontrado' });
    const { data, error } = await supabase
      .from('album_comments')
      .select('id, access_user_id, author_name, spread_position, body, resolved, created_at')
      .eq('album_id', album.id)
      .order('created_at', { ascending: false });
    if (error) {
      return albumTableMissing(error) ? albumCommentsMigrationError(res) : res.status(500).json({ error: error.message });
    }
    res.json({ comments: data || [] });
  });

  app.put('/api/albums/:id/comments/:commentId', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (supabaseAdmin || (req as any).supabase) as SupabaseClient;
    const album = await carregarAlbum(supabase, userId, req.params.id).catch(() => null);
    if (!album) return res.status(404).json({ error: 'Álbum não encontrado' });
    const { error } = await supabase
      .from('album_comments')
      .update({ resolved: !!req.body?.resolved })
      .eq('id', req.params.commentId)
      .eq('album_id', album.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  });

  // ── Rotas PÚBLICAS (cliente final, validação por share_token) ─────────────

  async function findAlbumByToken(token: string): Promise<any | null> {
    if (!supabaseAdmin || !token) return null;
    const { data } = await supabaseAdmin.from('album_projects').select('*').eq('share_token', token).maybeSingle();
    return data || null;
  }

  // Login público do cliente / convidado do álbum.
  app.post('/api/public/album/:token/login', async (req, res) => {
    if (!supabaseAdmin) return res.status(500).json({ error: 'Indisponível' });
    if (!publicRateLimit(req, 'album_login', 8, 15 * 60 * 1000)) {
      return res.status(429).json({ error: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.' });
    }
    const album = await findAlbumByToken(req.params.token);
    if (!album) return res.status(404).json({ error: 'Álbum não encontrado' });

    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    if (!email || !password) return res.status(400).json({ error: 'E-mail e senha são obrigatórios.' });

    if (await recentAlbumLoginFails(album.id) >= 20) {
      return res.status(429).json({ error: 'Acesso bloqueado por excesso de tentativas. Tente novamente em 15 minutos.' });
    }

    const { data: user } = await supabaseAdmin
      .from('album_access_users')
      .select('id, email, name, role, password_hash, login_count')
      .eq('album_id', album.id)
      .eq('email', email)
      .maybeSingle();

    if (!user) {
      await logAlbumEvent(album.id, null, 'login_fail', req, `email=${email}`);
      return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
    }
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      await logAlbumEvent(album.id, user.id, 'login_fail', req);
      return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
    }

    await supabaseAdmin
      .from('album_access_users')
      .update({ last_login_at: new Date().toISOString(), login_count: (user.login_count || 0) + 1 })
      .eq('id', user.id);
    await logAlbumEvent(album.id, user.id, 'login', req);

    const session = signAlbumSession({ aid: album.id, uid: user.id, role: user.role });
    if (!session) {
      return res.status(503).json({ error: 'Login temporariamente indisponível. Avise o estúdio.' });
    }
    res.json({
      session_token: session,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    });
  });

  app.get('/api/public/album/:token', async (req, res) => {
    if (!supabaseAdmin) return res.status(500).json({ error: 'Indisponível' });
    if (!publicRateLimit(req, 'album_view', 120, 60 * 1000)) {
      return res.status(429).json({ error: 'Muitas requisições. Aguarde um instante.' });
    }
    const album = await findAlbumByToken(req.params.token);
    if (!album) return res.status(404).json({ error: 'Álbum não encontrado' });

    const studioName = await getStudioNameForGallery(album.user_id);
    const meta = {
      title: album.title,
      size: album.size,
      status: album.status,
      studio_name: studioName,
      allow_client_edit: !!album.allow_client_edit,
      require_login: !!album.require_login,
    };

    // Se exige login e o cliente ainda não entrou, devolve só a "capa" (título +
    // estúdio) pra montar a tela de login — sem expor as fotos/lâminas.
    const access = albumAccessState(req, album);
    if (!access.ok) {
      return res.json({ album: meta, needs_login: true, assets: [], spreads: [] });
    }

    const [assetsQ, spreadsQ, commentsQ] = await Promise.all([
      supabaseAdmin.from('album_assets').select('*').eq('album_id', album.id).order('sort_order').order('created_at'),
      supabaseAdmin.from('album_spreads').select('*').eq('album_id', album.id).order('position'),
      supabaseAdmin.from('album_comments')
        .select('id, author_name, spread_position, body, resolved, created_at')
        .eq('album_id', album.id).order('created_at', { ascending: false }),
    ]);

    await logAlbumEvent(album.id, access.accessUserId, 'view_album', req);

    res.json({
      album: meta,
      assets: (assetsQ.data || []).map(mapAlbumAsset),
      spreads: (spreadsQ.data || []).map(mapAlbumSpread),
      comments: commentsQ.data || [], // [] se a migration 036 ainda não rodou
    });
  });

  app.put('/api/public/album/:token/spreads', async (req, res) => {
    if (!supabaseAdmin) return res.status(500).json({ error: 'Indisponível' });
    if (!publicRateLimit(req, 'album_edit', 240, 60 * 1000)) {
      return res.status(429).json({ error: 'Muitas ações seguidas. Aguarde um instante.' });
    }
    const album = await findAlbumByToken(req.params.token);
    if (!album) return res.status(404).json({ error: 'Álbum não encontrado' });
    // Exige login quando configurado.
    const access = albumAccessState(req, album);
    if (!access.ok) return res.status(401).json({ error: 'login_required' });
    // Fail-closed: cliente só edita se permitido E enquanto não aprovado.
    if (!album.allow_client_edit) return res.status(403).json({ error: 'Edição pela cliente desativada.' });
    if (album.status === 'approved') return res.status(409).json({ error: 'Álbum já aprovado — fale com o estúdio pra reabrir.' });

    const spreads = Array.isArray(req.body?.spreads) ? req.body.spreads : [];
    if (spreads.length > 200) return res.status(400).json({ error: 'Máximo de 200 lâminas.' });
    try {
      await replaceAlbumSpreads(album.id, spreads);
      await supabaseAdmin.from('album_projects').update({ updated_at: new Date().toISOString() }).eq('id', album.id);
      // Trilha de edição (throttle de 90s pra não floodar com o autosave).
      if (shouldLogAlbumEdit(album.id, access.accessUserId)) {
        await logAlbumEvent(album.id, access.accessUserId, 'edit_album', req);
      }
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || 'Falha ao salvar lâminas.' });
    }
  });

  // Notifica o estúdio que a cliente aprovou o álbum (WhatsApp + e-mail).
  async function notifyStudioAlbumApproved(album: any): Promise<void> {
    const settings = await getGallerySettings(album.user_id);
    const studioName = await getStudioNameForGallery(album.user_id);

    if (isMailerConfigured() && supabaseAdmin) {
      const { data } = await supabaseAdmin.auth.admin.getUserById(album.user_id);
      const to = data?.user?.email;
      if (to) {
        await sendGalleryMessageEmail({
          to,
          from: settings.sender_email,
          studioName,
          subject: `Álbum aprovado — ${album.title}`,
          messageText: `${album.client_name || 'A cliente'} aprovou o layout do álbum "${album.title}". Pode seguir pra produção.`,
          link: albumLink(album.share_token),
        }).catch(() => {});
      }
    }

    if (settings.notify_studio_whatsapp !== false && BaileysManager.getStatus(album.user_id) === 'open') {
      const own = BaileysManager.getConnectedPhone(album.user_id);
      if (own) {
        const msg = `📔 ${album.client_name || 'Cliente'} aprovou o álbum "${album.title}".`;
        await BaileysManager.sendText(album.user_id, own.replace(/\D/g, ''), msg).catch(() => {});
      }
    }
  }

  app.post('/api/public/album/:token/approve', async (req, res) => {
    if (!supabaseAdmin) return res.status(500).json({ error: 'Indisponível' });
    if (!publicRateLimit(req, 'album_approve', 20, 60 * 1000)) {
      return res.status(429).json({ error: 'Muitas tentativas. Aguarde um instante.' });
    }
    const album = await findAlbumByToken(req.params.token);
    if (!album) return res.status(404).json({ error: 'Álbum não encontrado' });
    // Exige login quando configurado.
    const access = albumAccessState(req, album);
    if (!access.ok) return res.status(401).json({ error: 'login_required' });
    if (album.status === 'approved') return res.json({ ok: true, already: true });

    const { error } = await supabaseAdmin
      .from('album_projects')
      .update({ status: 'approved', updated_at: new Date().toISOString() })
      .eq('id', album.id);
    if (error) return res.status(500).json({ error: error.message });

    await logAlbumEvent(album.id, access.accessUserId, 'approve', req);
    notifyStudioAlbumApproved(album).catch((e: any) =>
      console.warn('[album] notificação de aprovação falhou:', e?.message));
    res.json({ ok: true });
  });

  // Avisa o estúdio (WhatsApp + e-mail) que o cliente pediu um ajuste/comentou.
  async function notifyStudioAlbumComment(album: any, autor: string | null, body: string, pagina: number | null): Promise<void> {
    const settings = await getGallerySettings(album.user_id);
    const studioName = await getStudioNameForGallery(album.user_id);
    const ref = pagina != null ? ` (lâmina ${pagina + 1})` : '';
    const quem = autor || album.client_name || 'O cliente';
    const txt = `💬 ${quem} comentou no álbum "${album.title}"${ref}: "${body.slice(0, 220)}"`;

    if (isMailerConfigured() && supabaseAdmin) {
      const { data } = await supabaseAdmin.auth.admin.getUserById(album.user_id);
      const to = data?.user?.email;
      if (to) {
        await sendGalleryMessageEmail({
          to,
          from: settings.sender_email,
          studioName,
          subject: `Novo comentário no álbum — ${album.title}`,
          messageText: txt,
          link: albumLink(album.share_token),
        }).catch(() => {});
      }
    }
    if (settings.notify_studio_whatsapp !== false && BaileysManager.getStatus(album.user_id) === 'open') {
      const own = BaileysManager.getConnectedPhone(album.user_id);
      if (own) await BaileysManager.sendText(album.user_id, own.replace(/\D/g, ''), txt).catch(() => {});
    }
  }

  app.post('/api/public/album/:token/comment', async (req, res) => {
    if (!supabaseAdmin) return res.status(500).json({ error: 'Indisponível' });
    if (!publicRateLimit(req, 'album_comment', 30, 60 * 1000)) {
      return res.status(429).json({ error: 'Muitos comentários seguidos. Aguarde um instante.' });
    }
    const album = await findAlbumByToken(req.params.token);
    if (!album) return res.status(404).json({ error: 'Álbum não encontrado' });
    const access = albumAccessState(req, album);
    if (!access.ok) return res.status(401).json({ error: 'login_required' });

    const body = String(req.body?.body || '').trim().slice(0, 2000);
    if (!body) return res.status(400).json({ error: 'Escreva o comentário.' });
    const spread_position = Number.isFinite(req.body?.spread_position) ? Number(req.body.spread_position) : null;

    let author_name: string | null = null;
    if (access.accessUserId) {
      const { data: u } = await supabaseAdmin
        .from('album_access_users').select('name, email').eq('id', access.accessUserId).maybeSingle();
      author_name = u?.name || u?.email || null;
    }

    const { data, error } = await supabaseAdmin
      .from('album_comments')
      .insert({ album_id: album.id, access_user_id: access.accessUserId, author_name, spread_position, body })
      .select('id, author_name, spread_position, body, resolved, created_at')
      .single();
    if (error) {
      return albumTableMissing(error) ? albumCommentsMigrationError(res) : res.status(500).json({ error: error.message });
    }

    await logAlbumEvent(album.id, access.accessUserId, 'comment', req, (spread_position != null ? `lâmina ${spread_position + 1}: ` : '') + body.slice(0, 120));
    notifyStudioAlbumComment(album, author_name, body, spread_position).catch((e: any) =>
      console.warn('[album] notificação de comentário falhou:', e?.message));
    res.json({ comment: data });
  });

  // Cria customer no Asaas + subscription. Retorna invoiceUrl pra pagamento.
  // Body: { planSlug: 'pro'|'business', billingType: 'PIX'|'CREDIT_CARD',
  //         cpfCnpj, mobilePhone, creditCard?, creditCardHolderInfo? }
  app.post('/api/billing/subscribe', requireAuth, requireOwnerOrPlatformAdmin, async (req, res) => {
    const ownerId = (req as any).userId;
    if (!supabaseAdmin) return res.status(500).json({ error: 'Service role indisponível' });

    const { planSlug, billingType, cpfCnpj, mobilePhone, creditCard, creditCardHolderInfo } = req.body || {};
    if (!planSlug || typeof planSlug !== 'string') return res.status(400).json({ error: 'planSlug inválido' });
    if (!['PIX', 'CREDIT_CARD'].includes(billingType)) return res.status(400).json({ error: 'billingType inválido' });
    if (!cpfCnpj) return res.status(400).json({ error: 'CPF/CNPJ obrigatório' });

    // Aceita qualquer plano ATIVO (start/pro/studio/premium); aposentados não.
    const { data: plan } = await supabaseAdmin
      .from('platform_plans')
      .select('id, slug, name, price_cents')
      .eq('slug', planSlug)
      .eq('is_active', true)
      .maybeSingle();
    if (!plan) return res.status(404).json({ error: 'Plano não encontrado ou indisponível' });

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
      // 1) Busca TODOS os usuários do auth (em páginas de 1000) — paginação e
      // filtros precisam rodar sobre o conjunto COMPLETO de donos, não sobre
      // uma fatia crua de auth.users (era o bug: donos sumiam da lista).
      const allUsers: Array<{ id: string; email?: string | null; created_at?: string; last_sign_in_at?: string | null }> = [];
      for (let p = 1; p <= 20; p++) {
        const { data: usersData, error: usersErr } = await supabaseAdmin.auth.admin.listUsers({ page: p, perPage: 1000 });
        if (usersErr) return res.status(500).json({ error: usersErr.message });
        const batch = usersData?.users ?? [];
        allUsers.push(...(batch as any));
        if (batch.length < 1000) break; // última página
      }

      // 2) Remove membros de equipe — só donos de conta.
      const { data: memberRows } = await supabaseAdmin
        .from('team_members')
        .select('member_user_id')
        .not('member_user_id', 'is', null);
      const memberIds = new Set((memberRows ?? []).map((r) => r.member_user_id));
      const owners = allUsers.filter((u) => !memberIds.has(u.id));

      // 3) Contas + planos de TODOS (limit alto p/ não bater o teto 1000 do PostgREST).
      const [{ data: accounts }, { data: plans }] = await Promise.all([
        supabaseAdmin
          .from('platform_accounts')
          .select('owner_user_id, plan_id, status, suspended_reason, trial_ends_at, notes, created_at')
          .limit(100000),
        supabaseAdmin.from('platform_plans').select('id, slug, name'),
      ]);
      const acctByOwner = new Map((accounts ?? []).map((a) => [a.owner_user_id, a]));
      const planById = new Map((plans ?? []).map((p) => [p.id, p]));

      // 4) Monta a lista completa de tenants.
      let tenants = owners.map((u) => {
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

      // 5) Filtros sobre o conjunto COMPLETO.
      if (search) tenants = tenants.filter((t) => (t.email ?? '').toLowerCase().includes(search));
      if (status) tenants = tenants.filter((t) => t.status === status);
      if (planId) tenants = tenants.filter((t) => t.plan_id === planId);

      // 6) Total real + fatia da página pedida.
      const total = tenants.length;
      const start = (page - 1) * pageSize;
      const pageItems = tenants.slice(start, start + pageSize);

      res.json({ tenants: pageItems, page, page_size: pageSize, total });
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
    invalidatePlanLimits(ownerId);

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
    // Trava: não deixa excluir plano em uso (senão os tenants ficam sem plano =
    // quota ilimitada / fail-open). Manda trocar o plano dessas empresas antes.
    const { count: emUso } = await supabaseAdmin
      .from('platform_accounts')
      .select('owner_user_id', { count: 'exact', head: true })
      .eq('plan_id', id);
    if ((emUso || 0) > 0) {
      return res.status(409).json({ error: `Plano em uso por ${emUso} empresa(s). Troque o plano delas antes de excluir.` });
    }
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
    const page = Math.max(1, parseInt((req.query.page as string) || '1', 10));
    const from = (page - 1) * limit;
    const targetOwnerId = req.query.target_owner_id as string | undefined;
    const action = req.query.action as string | undefined;

    // range(from, to) → permite navegar pro histórico antigo (antes só dava as
    // últimas N e o resto ficava inalcançável).
    let q = supabaseAdmin
      .from('platform_audit_log')
      .select('*')
      .order('created_at', { ascending: false })
      .range(from, from + limit - 1);
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

    // RESGATE de leads órfãos: deal ativo apontando pra etapa que não existe
    // mais (ex: usuário recriou a pipeline — os ids mudam) ficava INVISÍVEL no
    // funil. Aqui movemos de volta pra primeira etapa aberta e persistimos.
    // Best-effort: falha no resgate não bloqueia a listagem.
    try {
      const stages = await ensurePipelineStages(supabase, userId);
      const knownIds = new Set(stages.map((s: any) => s.id));
      const orphans = (deals || []).filter((d: any) => d.stage && !knownIds.has(d.stage) && !d.converted);
      if (orphans.length > 0) {
        const firstOpen = stages.find((s: any) => !s.is_final)?.id;
        if (firstOpen) {
          const nowIso = new Date().toISOString();
          await supabase.from('deals')
            .update({ stage: firstOpen, current_stage_entered_at: nowIso })
            .in('id', orphans.map((o: any) => o.id))
            .eq('user_id', userId);
          orphans.forEach((o: any) => { o.stage = firstOpen; o.current_stage_entered_at = nowIso; });
          console.log(`[deals] ${orphans.length} lead(s) órfão(s) resgatado(s) → etapa "${firstOpen}" (user ${userId})`);
        }
      }
    } catch { /* não bloqueia a resposta */ }

    // Funcionário sem 'finance' recebe o funil SEM valores (R$) — fecha o
    // vazamento pela rede (inclui a extensão, que consome este endpoint).
    res.json(memberLacksFinance(req) ? deals.map(stripDealMoney) : deals);
  });

  app.post('/api/deals', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const stages = await ensurePipelineStages(supabase, userId);
    const { client_id, title, value, stage, priority, expected_close_date, next_follow_up, notes, assigned_to, contact_name, contact_phone, contact_email, lead_source, campaign_id } = req.body;
    const nowIso = new Date().toISOString();
    const stageId = stageIdOrDefault(stages, stage);
    const stageName = stages.find((s) => s.id === stageId)?.name || stageId;

    const payload: any = {
      client_id: client_id || null,
      title,
      contact_name: contact_name || title || null,
      contact_phone: normalizePhone(contact_phone) || null,
      contact_email: contact_email || null,
      lead_source: lead_source || null,
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
      campaign_id: campaign_id || null,
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
    const { name, phone, email, value, source, stage: requestedStage, assigned_to, notes, campaign_id } = req.body;
    if (!name || !phone) return res.status(400).json({ error: 'Nome e telefone são obrigatórios' });

    // Stage solicitado (drag direto pra coluna específica) > primeira stage
    const targetStage = (requestedStage && stages.find((s) => s.id === requestedStage)) || firstStage;

    const nowIso = new Date().toISOString();
    const payload: any = {
      title: name,
      contact_name: name,
      contact_phone: normalizePhone(phone) || null,
      contact_email: email || null,
      lead_source: source || null,
      notes: notes || null,
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
      campaign_id: campaign_id || null,
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
      .select('id, stage, stage_entered_at, stage_history, current_stage_entered_at, contact_phone, contact_name, title, converted_at')
      .eq('id', dealId)
      .eq('user_id', userId)
      .single();

    if (!existing) return res.status(404).json({ error: 'Deal not found' });

    const updates: any = { ...req.body, updated_at: new Date().toISOString() };
    if (updates.contact_phone !== undefined) {
      updates.contact_phone = normalizePhone(updates.contact_phone) || null;
    }
    // Funcionário sem 'finance' não enxerga o valor (vem zerado pra ele) — então
    // NÃO deixa sobrescrever value/estimated_value, senão zeraria o real ao editar
    // outros campos (ex: nome/telefone pela extensão).
    if (memberLacksFinance(req)) {
      delete updates.value;
      delete updates.estimated_value;
    }
    const stageChanged = updates.stage && updates.stage !== existing.stage;

    if (stageChanged) {
      const stages = await ensurePipelineStages(supabase, userId);
      const newStage = stages.find((s) => s.id === updates.stage);
      const stageName = newStage?.name || updates.stage;
      const nowIso = new Date().toISOString();
      updates.stage_entered_at = nowIso;
      updates.current_stage_entered_at = nowIso;
      updates.stage_history = appendStageHistory(existing.stage_history, updates.stage, stageName, nowIso);
      // Ganho por ARRASTO (sem passar pela conversão): grava a data da venda
      // pra aparecer no relatório de vendas por vendedor. Respeita converted_at
      // que já venha no body ou que já exista.
      if (newStage?.is_won && !(existing as any).converted_at && updates.converted_at === undefined) {
        updates.converted_at = nowIso;
      }
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
    const { createClient, createJob, client, job, sinalAmount, existingClientId, converted_at, campaign_id } = req.body;
    const nowIso = new Date().toISOString();
    // Data da venda retroativa: aceita 'YYYY-MM-DD' (ou ISO) e usa como
    // converted_at do deal. Inválida ou no futuro → agora. O meio-dia evita
    // a data "voltar" um dia por fuso horário.
    let soldAtIso = nowIso;
    if (typeof converted_at === 'string' && converted_at.trim()) {
      const raw = converted_at.trim();
      const d = new Date(raw.length <= 10 ? `${raw}T12:00:00` : raw);
      if (!isNaN(d.getTime()) && d.getTime() <= Date.now()) soldAtIso = d.toISOString();
    }

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

      // Registra o sinal como pagamento na tabela job_payments.
      // Venda retroativa: o sinal entra com a data real da venda.
      if (jobId && sinalAmount && Number(sinalAmount) > 0) {
        const adminClient = supabaseAdmin || supabase;
        await adminClient.from('job_payments').insert({
          job_id: jobId,
          amount: Number(sinalAmount),
          description: 'Sinal',
          payment_date: soldAtIso.slice(0, 10),
          payment_method: job.payment_method || 'Pix',
        }).select();
      }

      // AGENDA: cria o evento no Google Calendar e convida o cliente pelo e-mail
      // (se a conta tiver Google conectado e o job tiver data). Antes a conversão
      // NÃO agendava — só agendava quem editava o job depois; por isso "uns sim,
      // outros não". Fire-and-forget, igual ao POST /api/jobs (não atrasa a resposta).
      if (jobId) syncJobToGoogleCalendar(supabase, jobId, userId);
    }

    const stageId = wonStage?.id || 'won';
    const stageName = wonStage?.name || stageId;
    const updates: any = {
      stage: stageId,
      stage_entered_at: nowIso,
      current_stage_entered_at: nowIso,
      stage_history: appendStageHistory(deal.stage_history, stageId, stageName, nowIso),
      converted: true,
      converted_at: soldAtIso,
      converted_client_id: clientId,
      converted_job_id: jobId,
      client_id: clientId || deal.client_id,
      temperature: 'hot',
      temperature_locked: true,
    };
    // Campanha de venda especial: persiste no deal (não no job). Guard pra não
    // sobrescrever uma campanha já marcada quando o convert não envia o campo.
    if (campaign_id !== undefined) updates.campaign_id = campaign_id;

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
  // Sincroniza valor do DEAL (soma dos deal_items) e, se houver job convertido,
  // recalcula o financeiro do job (amount + status). Mantém o NEXO deal↔job e
  // garante que editar o pacote reflita certo em todo lugar.
  async function syncDealAndJob(supabase: SupabaseClient, adminClient: SupabaseClient, dealId: number, userId: string) {
    const { data: items } = await adminClient.from('deal_items').select('catalog_value, quantidade').eq('deal_id', dealId);
    const total = (items || []).reduce((s: number, i: any) => s + ((i.catalog_value || 0) * (i.quantidade || 1)), 0);
    await supabase.from('deals').update({ value: total }).eq('id', dealId).eq('user_id', userId);
    const { data: deal } = await supabase.from('deals').select('converted_job_id').eq('id', dealId).eq('user_id', userId).maybeSingle();
    let job: any = null;
    if (deal?.converted_job_id) {
      // Passa `total` (soma autoritativa dos deal_items) como base: ao esvaziar o
      // pacote a base vira 0 de fato, sem o fallback ressuscitar o valor antigo.
      job = await recalcJobFinancials(supabase, adminClient, deal.converted_job_id, userId, total).catch(() => null);
    }
    return { total, job };
  }

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

    const { total, job } = await syncDealAndJob(supabase, adminClient, dealId, userId);
    res.json({ item: newItem, total, ...(job || {}) });
  });

  // POST /api/jobs/:id/deal-items — adiciona item AO PACOTE do negócio vinculado
  // ao job (a partir do drawer financeiro). Mantém o nexo e recalcula tudo.
  app.post('/api/jobs/:id/deal-items', requireAuth, denyProductionOnly, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const adminClient = supabaseAdmin || supabase;
    const jobId = Number(req.params.id);

    const { data: job } = await supabase.from('jobs').select('id').eq('id', jobId).eq('user_id', userId).single();
    if (!job) return res.status(404).json({ error: 'Job not found' });
    const { data: deal } = await supabase.from('deals').select('id').eq('converted_job_id', jobId).eq('user_id', userId).maybeSingle();
    if (!deal?.id) return res.status(400).json({ error: 'Este trabalho não tem negócio vinculado.' });

    const { catalog_type, catalog_id, catalog_name, catalog_value, quantidade = 1 } = req.body;
    if (!catalog_type || !catalog_id || !catalog_name) {
      return res.status(400).json({ error: 'catalog_type, catalog_id, catalog_name são obrigatórios' });
    }
    const { data: newItem, error } = await adminClient
      .from('deal_items')
      .insert({ deal_id: deal.id, catalog_type, catalog_id, catalog_name, catalog_value: catalog_value || 0, quantidade })
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });

    const { total, job: jobFin } = await syncDealAndJob(supabase, adminClient, deal.id, userId);
    res.json({ item: newItem, total, ...(jobFin || {}) });
  });

  app.delete('/api/deal-items/:itemId', requireAuth, denyProductionOnly, async (req, res) => {
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

    const { total, job } = await syncDealAndJob(supabase, adminClient, item.deal_id, userId);
    res.json({ success: true, total, ...(job || {}) });
  });

  // Edita um item do pacote: quantidade e/ou preço (catalog_value). Patch parcial.
  app.put('/api/deal-items/:itemId', requireAuth, denyProductionOnly, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const adminClient = supabaseAdmin || supabase;
    const itemId = req.params.itemId;

    const { data: item } = await adminClient.from('deal_items').select('id, deal_id').eq('id', itemId).single();
    if (!item) return res.status(404).json({ error: 'Item not found' });

    const { data: deal } = await supabase.from('deals').select('id').eq('id', item.deal_id).eq('user_id', userId).single();
    if (!deal) return res.status(403).json({ error: 'Forbidden' });

    const patch: any = {};
    if (req.body.quantidade !== undefined) patch.quantidade = Math.max(1, parseInt(req.body.quantidade) || 1);
    if (req.body.catalog_value !== undefined) patch.catalog_value = Math.max(0, Number(req.body.catalog_value) || 0);
    if (Object.keys(patch).length === 0) return res.json({ success: true });

    const { error } = await adminClient.from('deal_items').update(patch).eq('id', itemId);
    if (error) return res.status(500).json({ error: error.message });

    const { total, job } = await syncDealAndJob(supabase, adminClient, item.deal_id, userId);
    res.json({ success: true, total, ...(job || {}) });
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
  // Financeiro inteiro gateado pela permissão 'finance' (o dono liga/desliga por
  // funcionário em Configurações → Equipe). Default desligado pra novos membros.
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

    // "Catch-all": lançamentos cuja categoria NÃO está ligada a nenhum grupo da
    // DRE (ou sem categoria) somem do relatório. Pior: despesas assim nunca eram
    // subtraídas → resultado inflado. Aqui captamos esses como "Outros".
    const grupoIds = new Set((grupos || []).map((g: any) => g.id));
    const catMapeada = new Set(
      (categorias || []).filter((c: any) => c.grupo_dre_id && grupoIds.has(c.grupo_dre_id)).map((c: any) => c.id)
    );
    const ehMapeada = (catId: any) => !!catId && catMapeada.has(catId);
    const receitasNaoMapeadas = (receitas || []).filter((r: any) => !ehMapeada(r.categoria_id)).reduce((s: number, r: any) => s + (r.valor_bruto || 0), 0);
    const despesasNaoMapeadas = (despesas || []).filter((d: any) => !ehMapeada(d.categoria_id)).reduce((s: number, d: any) => s + (d.valor || 0), 0);
    // Onde encaixar os "Outros": receita bruta (entradas) e despesas operacionais (saídas).
    const grupoReceitaBrutaId = ((grupos || []).find((g: any) => g.nome === '(+) Receita Bruta') || (grupos || []).find((g: any) => g.tipo === 'receita'))?.id ?? null;
    const grupoOutrasDespesasId = (
      (grupos || []).find((g: any) => g.nome === '(-) Despesas Operacionais') ||
      (grupos || []).find((g: any) => g.tipo === 'despesa' && g.operacao === 'subtrai') ||
      (grupos || []).find((g: any) => g.operacao === 'subtrai' && !(g.campos_automaticos || []).includes('taxas_recebimento'))
    )?.id ?? null;

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

      // Catch-all: entradas não categorizadas vão na Receita Bruta (já contam no
      // acumulado, então é só exibir); saídas não categorizadas vão em Despesas
      // Operacionais (entram no total_grupo → passam a ser subtraídas).
      if (grupo.id === grupoReceitaBrutaId && receitasNaoMapeadas > 0) {
        categoriasLinha.push({ categoria_id: null, categoria_nome: 'Outros (não categorizado)', total: receitasNaoMapeadas });
        total_grupo += receitasNaoMapeadas;
      }
      if (grupo.id === grupoOutrasDespesasId && despesasNaoMapeadas > 0) {
        categoriasLinha.push({ categoria_id: null, categoria_nome: 'Outros (não categorizado)', total: despesasNaoMapeadas });
        total_grupo += despesasNaoMapeadas;
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
    const { tipo, ano, mes_inicio, mes_fim, from, to } = req.query as Record<string, string>;

    // Novo: intervalo de datas (from/to em YYYY-MM-DD, precisão de dia, "até"
    // inclusivo). Mantém o formato antigo ano/mes_inicio/mes_fim por compat.
    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    let inicio: string, fim: string;
    if (dateRe.test(from || '') && dateRe.test(to || '')) {
      inicio = (from <= to ? from : to);
      fim = (from <= to ? to : from);
    } else {
      inicio = `${ano}-${String(mes_inicio).padStart(2, '0')}-01`;
      fim = `${ano}-${String(mes_fim).padStart(2, '0')}-31`;
    }

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
  // Tenta conciliar automaticamente uma transação recém-importada do extrato
  // com um lançamento já baixado: MESMO banco, MESMO valor e MESMA data (exata).
  // Crédito → receita recebida (valor_liquido); débito → despesa paga.
  async function autoConciliarOfxTx(supabase: any, userId: string, tx: any): Promise<boolean> {
    if (!tx?.conta_id) return false;
    const valorBate = (v: any) => Math.abs(Number(v) - Number(tx.valor)) < 0.005;
    if (tx.tipo === 'credito') {
      const { data: rs } = await supabase.from('fin_receitas')
        .select('id, valor_liquido, valor_bruto')
        .eq('user_id', userId).eq('conta_id', tx.conta_id)
        .eq('status', 'recebido').eq('data_recebimento_real', tx.data);
      for (const r of rs || []) {
        if (!valorBate(r.valor_liquido ?? r.valor_bruto)) continue;
        const { data: ja } = await supabase.from('fin_transacoes_ofx')
          .select('id').eq('user_id', userId).eq('receita_id', r.id).limit(1);
        if (ja && ja.length) continue; // já ligada a outra transação
        await supabase.from('fin_transacoes_ofx')
          .update({ status_conciliacao: 'conciliado', receita_id: r.id })
          .eq('id', tx.id).eq('user_id', userId);
        return true;
      }
      return false;
    }
    const { data: ds } = await supabase.from('fin_despesas')
      .select('id, valor')
      .eq('user_id', userId).eq('conta_id', tx.conta_id)
      .eq('status', 'pago').eq('data_pagamento', tx.data);
    for (const d of ds || []) {
      if (!valorBate(d.valor)) continue;
      const { data: ja } = await supabase.from('fin_transacoes_ofx')
        .select('id').eq('user_id', userId).eq('despesa_id', d.id).limit(1);
      if (ja && ja.length) continue;
      await supabase.from('fin_transacoes_ofx')
        .update({ status_conciliacao: 'conciliado', despesa_id: d.id })
        .eq('id', tx.id).eq('user_id', userId);
      return true;
    }
    return false;
  }

  app.post('/api/fin/ofx/import', requireAuth, async (req, res) => {
    const supabase = finClient(req); const userId = finUser(req);
    const { conteudo, conta_id } = req.body;
    if (!conteudo || !conta_id) return res.status(400).json({ error: 'conteudo e conta_id obrigatórios' });

    // Parser OFX simples
    const transacoes: any[] = [];
    let ignoradasSaldo = 0;
    const stmtMatches = conteudo.matchAll(/<STMTTRN>([\s\S]*?)<\/STMTTRN>/g);
    for (const match of stmtMatches) {
      const block = match[1];
      const get = (tag: string) => { const m = block.match(new RegExp(`<${tag}>([^<\\n]+)`)); return m ? m[1].trim() : ''; };
      const fitId = get('FITID'); if (!fitId) continue;
      const trnType = get('TRNTYPE');
      const dtPosted = get('DTPOSTED');
      const trnAmt = parseFloat(get('TRNAMT').replace(',', '.')) || 0;
      const memo = get('MEMO') || get('NAME') || '';
      // Linhas de SALDO (ex: "SALDO TOTAL DISPONÍVEL DIA", "S A L D O") são fotos
      // do saldo do dia, NÃO movimentação. Importá-las inflaria a conciliação.
      const memoNorm = memo.toUpperCase().replace(/\s+/g, ' ').trim();
      if (/^SALDO\b/.test(memoNorm) || memoNorm.replace(/\s/g, '').startsWith('SALDO')) { ignoradasSaldo++; continue; }
      const data = dtPosted ? `${dtPosted.slice(0,4)}-${dtPosted.slice(4,6)}-${dtPosted.slice(6,8)}` : new Date().toISOString().slice(0,10);
      const tipo = trnAmt >= 0 ? 'credito' : 'debito';
      transacoes.push({ user_id: userId, conta_id, fit_id: fitId, tipo, valor: Math.abs(trnAmt), data, descricao: memo });
    }

    let importadas = 0; let duplicadas = 0; let conciliadas = 0;
    for (const t of transacoes) {
      const { data: ins, error } = await supabase
        .from('fin_transacoes_ofx').insert(t).select('id,conta_id,tipo,valor,data').single();
      if (error?.code === '23505') { duplicadas++; continue; }
      if (error) continue;
      importadas++;
      try { if (await autoConciliarOfxTx(supabase, userId, ins)) conciliadas++; }
      catch { /* falha de auto-conciliação não derruba o import */ }
    }
    res.json({ importadas, duplicadas, conciliadas, ignoradas_saldo: ignoradasSaldo, total: transacoes.length });
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
    const { data: tx } = await supabase.from('fin_transacoes_ofx').select('data,valor,conta_id').eq('id', transacao_id).eq('user_id', userId).single();
    if (receita_id) {
      updates.receita_id = receita_id;
      // Vincula a receita: marca recebida na data/banco do extrato. data_recebimento_real
      // = data do extrato pra bater com a conciliação automática.
      await supabase.from('fin_receitas').update({ status: 'recebido', data_pagamento: tx?.data, data_recebimento_real: tx?.data, conta_id: tx?.conta_id || null, updated_at: new Date().toISOString() }).eq('id', receita_id).eq('user_id', userId);
    }
    if (despesa_id) {
      updates.despesa_id = despesa_id;
      await supabase.from('fin_despesas').update({ status: 'pago', data_pagamento: tx?.data, conta_id: tx?.conta_id || null, updated_at: new Date().toISOString() }).eq('id', despesa_id).eq('user_id', userId);
    }
    await supabase.from('fin_transacoes_ofx').update(updates).eq('id', transacao_id).eq('user_id', userId);
    res.json({ success: true });
  });

  // Cria uma receita/despesa NOVA a partir de uma transação do extrato e já
  // vincula (concilia). Usado quando o lançamento ainda não existe no sistema.
  app.post('/api/fin/ofx/criar-lancamento', requireAuth, async (req, res) => {
    const supabase = finClient(req); const userId = finUser(req);
    const { transacao_id, descricao, categoria_id } = req.body;
    if (!transacao_id) return res.status(400).json({ error: 'transacao_id obrigatório' });
    const { data: tx } = await supabase.from('fin_transacoes_ofx').select('*').eq('id', transacao_id).eq('user_id', userId).single();
    if (!tx) return res.status(404).json({ error: 'Transação não encontrada' });
    const desc = (descricao && String(descricao).trim()) || tx.descricao || (tx.tipo === 'credito' ? 'Receita (extrato)' : 'Despesa (extrato)');

    if (tx.tipo === 'credito') {
      const { data: rec, error } = await supabase.from('fin_receitas').insert({
        user_id: userId, descricao: desc,
        valor_bruto: tx.valor, valor_liquido: tx.valor, status: 'recebido',
        data_vencimento: tx.data, data_pagamento: tx.data, data_recebimento_real: tx.data,
        conta_id: tx.conta_id || null, categoria_id: categoria_id || null,
      }).select('id').single();
      if (error) return res.status(500).json({ error: error.message });
      await supabase.from('fin_transacoes_ofx').update({ status_conciliacao: 'conciliado', receita_id: rec.id }).eq('id', transacao_id).eq('user_id', userId);
      return res.json({ success: true, receita_id: rec.id });
    }

    const { data: desp, error } = await supabase.from('fin_despesas').insert({
      user_id: userId, descricao: desc,
      valor: tx.valor, status: 'pago',
      data_vencimento: tx.data, data_pagamento: tx.data,
      conta_id: tx.conta_id || null, categoria_id: categoria_id || null,
    }).select('id').single();
    if (error) return res.status(500).json({ error: error.message });
    await supabase.from('fin_transacoes_ofx').update({ status_conciliacao: 'conciliado', despesa_id: desp.id }).eq('id', transacao_id).eq('user_id', userId);
    return res.json({ success: true, despesa_id: desp.id });
  });

  // Desfaz a conciliação (ou o "ignorar") de uma transação: volta pra pendente e
  // desfaz os vínculos. NÃO altera o lançamento vinculado — se ele foi marcado
  // recebido/pago ou criado por engano, isso é ajustado na tela dele (A Receber/Pagar).
  app.post('/api/fin/ofx/desconciliar', requireAuth, async (req, res) => {
    const supabase = finClient(req); const userId = finUser(req);
    const { transacao_id } = req.body;
    if (!transacao_id) return res.status(400).json({ error: 'transacao_id obrigatório' });
    const { error } = await supabase.from('fin_transacoes_ofx')
      .update({ status_conciliacao: 'pendente', receita_id: null, despesa_id: null })
      .eq('id', transacao_id).eq('user_id', userId);
    if (error) return res.status(500).json({ error: error.message });
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
  app.get('/api/extension/sales-overview', requireAuth, requirePermission('finance'), async (req, res) => {
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

    let jobDeleted = false;
    // Apaga o job vinculado primeiro (se houver) — usa admin pra bypassar
    // qualquer RLS quirky e garantir que sumiu mesmo. Limpa dependências
    // conhecidas antes para não ficar preso em FK/registro auxiliar.
    if (deal.converted_job_id) {
      const { data: job } = await adminClient
        .from('jobs')
        .select('id, google_event_id')
        .eq('id', deal.converted_job_id)
        .eq('user_id', userId)
        .maybeSingle();

      if (job?.google_event_id) {
        try {
          await deleteGoogleCalendarEvent(supabase, job.google_event_id, userId);
        } catch (e: any) {
          console.warn('[cancel-sale] falha apagando evento do Calendar:', e?.message);
        }
      }

      if (job?.id) {
        try {
          const { data: jobItems } = await adminClient
            .from('job_items')
            .select('id')
            .eq('job_id', job.id);
          const jobItemIds = (jobItems || []).map((it: any) => String(it.id));
          if (jobItemIds.length > 0) {
            await adminClient.from('compras').delete().in('job_item_id', jobItemIds);
          }
        } catch {
          // compras/job_items podem não existir em todos os ambientes.
        }

        await Promise.allSettled([
          adminClient.from('job_payments').delete().eq('job_id', job.id),
          adminClient.from('job_items').delete().eq('job_id', job.id),
          adminClient.from('job_stage_history').delete().eq('job_id', job.id),
          adminClient.from('job_checklist').delete().eq('job_id', job.id),
          adminClient.from('job_testimonials').delete().eq('job_id', job.id),
          adminClient.from('opportunities').delete().eq('trigger_job_id', job.id).eq('user_id', userId),
          adminClient.from('fin_receitas').update({ job_id: null }).eq('job_id', job.id).eq('user_id', userId),
          adminClient.from('contracts').update({ job_id: null }).eq('job_id', job.id).eq('user_id', userId),
        ]);
      }

      const { error: jobErr } = await adminClient
        .from('jobs')
        .delete()
        .eq('id', deal.converted_job_id)
        .eq('user_id', userId);
      if (jobErr) {
        console.error('[cancel-sale] falha apagando job:', jobErr.message);
        return res.status(500).json({ error: `Falha ao excluir trabalho vinculado: ${jobErr.message}` });
      }
      jobDeleted = !!job?.id;
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

    res.json({ success: true, moved_to: lostStage.id, job_deleted: jobDeleted });
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
    const contactName = String(req.query.name || '').trim();
    if (!phone && !contactName) return res.status(400).json({ error: 'phone ou name é obrigatório' });

    const stages = await ensurePipelineStages(supabase, userId);
    let deal: any = null;

    if (phone) {
      const variants = brazilianPhoneVariants(phone);

      const { data: exactDeal } = await supabase
        .from('deals')
        .select('*')
        .eq('user_id', userId)
        .in('contact_phone', variants)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      deal = exactDeal;

      if (!deal) {
        const { data: candidates } = await supabase
          .from('deals')
          .select('*')
          .eq('user_id', userId)
          .not('contact_phone', 'is', null)
          .order('updated_at', { ascending: false })
          .limit(500);

        deal = (candidates || []).find((candidate: any) => (
          candidate.contact_phone && brazilianPhonesMatch(candidate.contact_phone, phone)
        )) || null;
      }
    }

    if (!deal && contactName) {
      const { data: nameCandidates } = await supabase
        .from('deals')
        .select('*')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false })
        .limit(1000);

      const normalizedWanted = normalizeContactNameForMatch(contactName);
      const matches = (nameCandidates || []).filter((candidate: any) => {
        const candidateName = candidate.contact_name || candidate.title || '';
        return (
          normalizeContactNameForMatch(candidateName) === normalizedWanted ||
          contactNamesMatch(candidateName, contactName)
        );
      });
      const exactMatches = matches.filter((candidate: any) => (
        normalizeContactNameForMatch(candidate.contact_name || candidate.title || '') === normalizedWanted
      ));
      const safeMatches = exactMatches.length ? exactMatches : matches;
      deal = safeMatches.length === 1 ? safeMatches[0] : null;
    }

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
  // Mostra valores (faturamento por produto) → gateado pela permissão 'finance'.
  app.get('/api/oportunidades/totais-por-produto', requireAuth, requirePermission('finance'), async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;

    // Tenta com produto_id; se a coluna não existir, refaz sem ela.
    let opsRows: any[] | null = null;
    let hasProductCol = true;
    {
      const r = await supabase.from('opportunities')
        .select('produto_id, estimated_value, status, type, client_id')
        .eq('user_id', userId);
      if (r.error) {
        hasProductCol = false;
        const r2 = await supabase.from('opportunities')
          .select('estimated_value, status, type, client_id')
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

    // Valor REAL fechado por cliente = soma dos negócios GANHOS (deals.value).
    // O "convertido" passa a usar isto, e NÃO mais o estimated_value/pacote base.
    // O elo oportunidade→negócio é o client_id (quando um deal é ganho, as
    // oportunidades daquele cliente viram 'converted').
    const realPorCliente = new Map<string, number>();
    {
      const dr = await supabase.from('deals')
        .select('client_id, converted_client_id, value, converted')
        .eq('user_id', userId).eq('converted', true).limit(10000);
      (dr.data || []).forEach((d: any) => {
        const v = Number(d.value) || 0;
        if (v <= 0) return;
        const cids = [...new Set(
          [d.converted_client_id, d.client_id].filter((x: any) => x != null).map((x: any) => String(x))
        )];
        cids.forEach(k => realPorCliente.set(k, (realPorCliente.get(k) || 0) + v));
      });
    }
    // Conta cada cliente uma única vez no convertido (várias oportunidades do
    // mesmo cliente não inflam o total nem a contagem de "fechadas").
    const clientesContados = new Set<string>();

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
      const valorPend = valorReal > 0 ? valorReal : precoBase;

      if (PENDING.has(op.status)) {
        // "Pra vender" (em aberto): segue usando o valor estimado/pacote base.
        bucket.total_estimado += valorPend;
        bucket.qtd_aberta += 1;
        if (valorReal <= 0 && precoBase > 0) bucket.usando_estimativa = true;
      } else if (CONVERTED.has(op.status)) {
        // "Convertido": valor REAL do negócio ganho do cliente, 1x por cliente.
        const cid = op.client_id != null ? String(op.client_id) : '';
        const real = cid ? (realPorCliente.get(cid) || 0) : 0;
        if (cid && real > 0 && !clientesContados.has(cid)) {
          clientesContados.add(cid);
          bucket.total_convertido += real;
          bucket.qtd_convertida += 1;
        }
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

  // ─── Saneamento LGPD de modelos legados ────────────────────────────────────
  // O seed antigo (2026-05-05 → 05-23) embutia DADOS REAIS no corpo de 24
  // modelos: estúdio Pitori (CNPJ/responsável/endereço) em todos, e uma
  // cliente real (nome/CPF/endereço/telefone/email) no "ACOMPANHAMENTO
  // AVULSO". A fonte foi removida, mas contas criadas no período ainda têm os
  // modelos sujos no banco — e, por serem texto FIXO, eles também não puxavam
  // os dados do cliente. Aqui trocamos as assinaturas conhecidas por
  // placeholders. Roda nos GETs de modelos: idempotente, preserva edições do
  // usuário (só altera os trechos conhecidos) e persiste o resultado.
  const LEGACY_SANITIZE_RULES: Array<[RegExp, string]> = [
    // Cliente real vazada no seed (ordem importa: endereço antes da cidade)
    [/Micheli\s+Fioravanti(?:\s+Alves)?/gi, '{{cliente_nome}}'],
    [/075\.?722\.?709-?05/g, '{{cliente_cpf}}'],
    // Endereço: NÃO comer até o fim da linha — para no início do próximo trecho
    // (conjunção/placeholder/fim de linha). Antes, [^\n]* engolia o que vinha
    // depois no MESMO parágrafo (ex.: a qualificação da CONTRATANTE).
    [/(?:Rua\s+)?Alameda\s+Cris[âa]ntemo[^\n{]*?(?=\s+e[,.]?\s+de\s+outro|\s*denominad[ao]\s+CONTRATANTE|\s*na\s+qualidade\s+de|\s+t[êe]m\s+entre|\s+doravante|\s+justo\s+e\s+contratad|\s*\{\{|\n|$)/gi, '{{cliente_endereco}}'],
    [/\(?43\)?\s*9?9634-?5322/g, '{{cliente_telefone}}'],
    [/michelifioalves@hotmail\.com/gi, '{{cliente_email}}'],
    // Dados do estúdio do seed (terceiros para as demais contas) → placeholders
    // {{studio_*}}, preenchidos pelo gerador com os settings da PRÓPRIA conta.
    [/ST[ÚU]DIO\s+PITORI\s+LTDA/gi, '{{studio_nome}}'],
    [/39\.?732\.?374\/?0001-?37/g, '{{studio_cnpj}}'],
    [/Giovana\s+Vit[óo]ria\s+Pitori(?:\s+Macena)?/gi, '{{studio_responsavel}}'],
    [/103\.?177\.?439-?45/g, '{{studio_responsavel_cpf}}'],
    [/Rua\s+Dinamarca[^\n{]*?(?=\s+e[,.]?\s+de\s+outro|\s*denominad[ao]\s+CONTRATANTE|\s*na\s+qualidade\s+de|\s+t[êe]m\s+entre|\s+doravante|\s+justo\s+e\s+contratad|\s*\{\{|\n|$)/gi, '{{studio_endereco}}'],
    [/Camb[ée]\s*\/\s*PR/g, '{{studio_cidade}}'],
  ];

  // Templatização: valores que ficaram CHUMBADOS no corpo de alguns modelos
  // (não puxam o que o formulário coleta). Trocamos por placeholders. Genérico
  // e idempotente (modelos que já usam o placeholder não casam de novo).
  const LEGACY_TEMPLATIZE_RULES: Array<[RegExp, string]> = [
    // "...é de R$ 2.200,00 (Dois mil e duzentos reais)..." → puxa do form.
    // (Para a NF/contrato refletir o valor real do negócio, não um preço fixo.)
    [/(é\s+de\s+)R\$\s*[\d][\d.,]*\s*\([^)]*\)/gi, '$1R$ {{valor_total}} ({{valor_extenso}})'],
    // "A CONTRATANTE autoriza o uso das imagens" → respeita o "NÃO autoriza".
    [/A\s+CONTRATANTE\s+autoriza\s+o\s+uso\s+das\s+imagens/gi, 'A CONTRATANTE {{autorizacao_imagem}} autoriza o uso das imagens'],
  ];

  // Reparo do estrago do saneamento antigo: a regra 'Rua Dinamarca[^\n]*' chegou
  // a comer a cauda do parágrafo do preâmbulo — levando junto a qualificação da
  // CONTRATANTE que ficava na MESMA linha. Resultado: o contrato nomeia a
  // CONTRATADA e pula direto pra Cláusula 1ª, sem nome/CPF/endereço da cliente.
  // Se NÃO houver o bloco de qualificação da CONTRATANTE, reinsere o padrão com
  // placeholders (preenchidos pelo gerador com os dados reais). Detecta pela
  // QUALIFICAÇÃO ("denominada/qualidade de CONTRATANTE"), não pelo {{cliente_nome}}
  // solto — que pode estar só na assinatura.
  function ensureContratanteBlock(body: string): string {
    if (!body) return body;
    if (/denominad[ao]\s+CONTRATANTE|na\s+qualidade\s+de\s+CONTRATANTE/i.test(body)) return body;
    // Só age em contratos com preâmbulo de CONTRATADA (evita docs importados soltos).
    if (!/denominad[ao]\s+CONTRATADA/i.test(body)) return body;
    const bloco = 'E, de outro lado, na qualidade de CONTRATANTE, {{cliente_nome}}, '
      + 'inscrito(a) no CPF nº {{cliente_cpf}}, residente e domiciliado(a) em {{cliente_endereco}}, '
      + 'telefone {{cliente_telefone}}, e-mail: {{cliente_email}}.';
    const m = body.match(/\n\s*CL[ÁA]USULA\s+1/i);
    if (m && m.index !== undefined) {
      return body.slice(0, m.index) + '\n\n' + bloco + body.slice(m.index);
    }
    return body.replace(/\s+$/, '') + '\n\n' + bloco;
  }

  // O cabeçalho de vários modelos não cita o RESPONSÁVEL da CONTRATADA (nome +
  // CPF) nem o CONTATO da CONTRATANTE (telefone/e-mail), que o modelo de
  // referência tem. Insere os placeholders que faltam logo após o endereço de
  // cada parte. Idempotente: não duplica se já existirem (os placeholders são
  // resolvidos pelo gerador com os dados da conta/cliente).
  function ensureStudioRepresentante(body: string): string {
    if (!body) return body;
    if (/representad[oa]\s+por/i.test(body) || /\{\{studio_responsavel_cpf\}\}/.test(body)) return body;
    if (!body.includes('{{studio_endereco}}')) return body;
    return body.replace('{{studio_endereco}}',
      '{{studio_endereco}}, neste ato representado por sua responsável, {{studio_responsavel}}, inscrita no CPF nº {{studio_responsavel_cpf}}');
  }
  function ensureClienteContato(body: string): string {
    if (!body) return body;
    if (body.includes('{{cliente_telefone}}') || body.includes('{{cliente_email}}')) return body;
    if (!body.includes('{{cliente_endereco}}')) return body;
    return body.replace('{{cliente_endereco}}',
      '{{cliente_endereco}}, telefone {{cliente_telefone}}, e-mail: {{cliente_email}}');
  }

  function sanitizeLegacyContractBody(body: string): string | null {
    if (!body) return null;
    let out = body;
    for (const [re, repl] of LEGACY_SANITIZE_RULES) out = out.replace(re, repl);
    for (const [re, repl] of LEGACY_TEMPLATIZE_RULES) out = out.replace(re, repl);
    out = ensureContratanteBlock(out);
    out = ensureStudioRepresentante(out);
    out = ensureClienteContato(out);
    return out === body ? null : out;
  }

  // Templatiza os termos do PACOTE que estavam chumbados (duração, parcelas,
  // prazo de entrega, descrição do pacote) → placeholders, e CAPTURA o valor de
  // cada modelo no default_data. Assim cada contrato puxa o termo DAQUELE modelo
  // (ex.: modelo de 60 dias mostra 60, não o padrão 30) e o usuário pode editar
  // no formulário. Captura só quando o default ainda não existe (respeita edição).
  function templatizePackageFields(body: string, defaultData: any): { body: string; defaults: Record<string, any> } {
    let out = body;
    const defaults: Record<string, any> = {};
    const dd = defaultData || {};
    // Duração: "até 3 (três) horas" → {{servico_duracao}} (texto livre do form)
    const dur = out.match(/at[ée]\s+\d+\s*\([^)]*\)\s*horas?/i);
    if (dur && !/\{\{/.test(dur[0])) {
      if (dd.servico_duracao == null) defaults.servico_duracao = dur[0].trim();
      out = out.replace(/at[ée]\s+\d+\s*\([^)]*\)\s*horas?/gi, '{{servico_duracao}}');
    }
    // Parcelas: "parcelado em até 6 (seis) vezes" → número + extenso
    const parc = out.match(/parcelad[oa]\s+em\s+at[ée]\s+(\d+)\s*\([^)]*\)\s*vezes/i);
    if (parc) {
      if (dd.parcelas == null) defaults.parcelas = Number(parc[1]);
      out = out.replace(/(parcelad[oa]\s+em\s+at[ée]\s+)\d+\s*\([^)]*\)(\s*vezes)/gi, '$1{{parcelas}} ({{parcelas_extenso}})$2');
    }
    // Prazo de entrega: SÓ a cláusula de entrega ("terá o prazo de até N dias
    // úteis") — não toca em outros "N dias" (devolução, abandono, etc.).
    const prazo = out.match(/ter[áa]\s+o\s+prazo\s+de\s+at[ée]\s+(\d+)\s*\([^)]*\)\s*dias\s+[úu]teis/i);
    if (prazo) {
      if (dd.prazo_entrega == null) defaults.prazo_entrega = Number(prazo[1]);
      out = out.replace(/(ter[áa]\s+o\s+prazo\s+de\s+at[ée]\s+)\d+\s*\([^)]*\)(\s*dias\s+[úu]teis)/gi, '$1{{prazo_entrega}} ({{prazo_extenso}})$2');
    }
    // Descrição do pacote: "...disponibiliza no pacote acima citado, <texto>"
    const pac = out.match(/(disponibiliza\s+no\s+pacote\s+acima\s+citado,\s*)([^\n]+)/i);
    if (pac && !/\{\{/.test(pac[2])) {
      if (dd.pacote_descricao == null) defaults.pacote_descricao = pac[2].trim();
      out = out.replace(/(disponibiliza\s+no\s+pacote\s+acima\s+citado,\s*)[^\n]+/i, '$1{{pacote_descricao}}');
    }
    return { body: out, defaults };
  }

  // Repara um modelo: saneia/templatiza o corpo + captura defaults do pacote.
  // Retorna null se nada mudou. Idempotente.
  function repairContractTemplate(body: string, defaultData: any): { body: string; default_data: any } | null {
    const cleaned = sanitizeLegacyContractBody(body || '');
    const work = cleaned ?? (body || '');
    const { body: tBody, defaults } = templatizePackageFields(work, defaultData || {});
    const changed = (cleaned !== null) || (tBody !== work) || Object.keys(defaults).length > 0;
    if (!changed) return null;
    return { body: tBody, default_data: { ...(defaultData || {}), ...defaults } };
  }

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

    // Saneamento LGPD + templatização do pacote: persiste corpo e default_data
    const templates = data || [];
    for (const t of templates) {
      const fixed = repairContractTemplate(t.body || '', t.default_data || {});
      if (fixed) {
        t.body = fixed.body;
        t.default_data = fixed.default_data;
        await supabase.from('contract_templates').update({ body: fixed.body, default_data: fixed.default_data }).eq('id', t.id).eq('user_id', userId);
        console.log(`[contracts] modelo "${t.name}" reparado (saneado/templatizado) user=${userId}`);
      }
    }
    res.json(templates);
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
    // Mesmo reparo do GET de lista (cobre quem abre o modelo direto)
    const fixed = repairContractTemplate(data.body || '', data.default_data || {});
    if (fixed) {
      data.body = fixed.body;
      data.default_data = fixed.default_data;
      await supabase.from('contract_templates').update({ body: fixed.body, default_data: fixed.default_data }).eq('id', data.id).eq('user_id', userId);
      console.log(`[contracts] modelo "${data.name}" reparado (saneado/templatizado) user=${userId}`);
    }
    res.json(data);
  });

  // Importa um contrato em Word (.docx) ou PDF e cria um MODELO editável.
  // O arquivo chega em base64 (express.json já aceita 50mb); o texto extraído
  // vira o body do modelo — o usuário então troca os dados pelos placeholders.
  app.post('/api/contract-templates/import', requireAuth, async (req, res) => {
    const userId = (req as any).userId;
    const supabase = (req as any).supabase as SupabaseClient;
    const { filename, file_base64 } = req.body || {};
    if (!filename || !file_base64) return res.status(400).json({ error: 'Envie filename e file_base64' });

    let buf: Buffer;
    try { buf = Buffer.from(String(file_base64), 'base64'); } catch { return res.status(400).json({ error: 'Arquivo inválido' }); }
    if (buf.length < 100) return res.status(400).json({ error: 'Arquivo vazio ou inválido' });
    if (buf.length > 15 * 1024 * 1024) return res.status(400).json({ error: 'Arquivo muito grande (máx 15MB)' });

    let text = '';
    try {
      if (/\.docx$/i.test(filename)) {
        const mammoth = await import('mammoth');
        const r = await mammoth.extractRawText({ buffer: buf });
        text = r?.value || '';
      } else if (/\.pdf$/i.test(filename)) {
        // BUG do pdf-parse@1: o index.js tenta abrir um PDF de teste ao ser
        // importado. Workaround: importa direto o módulo interno (igual ao
        // autentique-import).
        // @ts-ignore — pdf-parse v1 não tem types publicados
        const pdfParse = (await import('pdf-parse/lib/pdf-parse.js')).default;
        const parsed = await pdfParse(buf);
        text = parsed?.text || '';
      } else if (/\.doc$/i.test(filename)) {
        return res.status(400).json({ error: 'Formato .doc antigo não é suportado — abra no Word e salve como .docx' });
      } else {
        return res.status(400).json({ error: 'Formato não suportado — envie .docx ou .pdf' });
      }
    } catch (err: any) {
      console.error('[contracts/import] falha ao ler arquivo:', err?.message || err);
      return res.status(422).json({ error: 'Não consegui ler o arquivo. Confira se ele não está corrompido ou protegido por senha.' });
    }

    // Limpeza: normaliza quebras de linha e colapsa linhas vazias em excesso
    const cleanedText = text
      .replace(/\r\n?/g, '\n')
      .split('\n').map((l: string) => l.replace(/[ \t]+$/g, '')).join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    if (!cleanedText || cleanedText.length < 40) {
      return res.status(422).json({ error: 'O arquivo não tem texto extraível (PDF escaneado/imagem não é suportado).' });
    }

    const name = String(filename).replace(/\.(docx|pdf)$/i, '').trim().slice(0, 80) || 'Contrato importado';
    const { data: created, error } = await supabase.from('contract_templates').insert({
      user_id: userId,
      name,
      category: 'IMPORTADO',
      body: cleanedText,
      is_default: false,
    }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(created);
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
    // Vê valores no Dashboard? Dono/admin sempre; membro só com permissão 'finance'.
    const canSeeFinance = !(req as any).isMember || (req as any).isPlatformAdmin
      || ((req as any).memberPermissions || {}).finance !== false;

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
        supabase.from('jobs').select('*, clients(name)').eq('user_id', userId).limit(10000),
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
      // "Venda fantasma" = deal GANHO cujo ensaio (converted_job_id) foi APAGADO
      // ou cancelado. Ao cancelar a venda apagando o ensaio, o deal às vezes fica
      // "ganho" — não pode contar como venda no funil. (Quem usa "Cancelar venda"
      // já cai em perdido.)
      const jobsById = new Map<number, any>((jobs as any[]).map((j: any) => [j.id, j]));
      const isPhantomWon = (d: any) => {
        if (!d.converted_job_id) return false;
        const j = jobsById.get(d.converted_job_id);
        return !j || j.status === 'cancelled';
      };
      const dealsByStage = dealStages.map((stage: any) => {
        const stageDeals = deals.filter((d: any) => {
          if (d.stage !== stage.id) return false;
          if (stage.is_final && !dealInSelectedPeriod(d)) return false;
          if (stage.is_won && isPhantomWon(d)) return false; // venda cancelada/apagada não conta
          return true;
        });
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

      // "Ensaios em aberto a receber" = estão EM PRODUÇÃO (têm production_stage),
      // não cancelados e com saldo a receber (valor - pago > 0). O filtro de
      // produção é essencial: sem ele, centenas de ensaios ANTIGOS já entregues
      // (cujo pagamento nunca foi lançado em job_payments) entravam com saldo
      // "fantasma" e inflavam o "A receber" (ex.: R$596k → R$22k real).
      const openJobs = jobs.filter((j: any) => {
        if (j.status === 'cancelled') return false;
        if (!j.production_stage) return false; // só conta o que está EM PRODUÇÃO
        const saldo = (Number(j.amount) || 0) - (amountPaidByJob.get(j.id) || 0);
        return saldo > 0.005;
      });
      const toReceiveOpen = openJobs.reduce(
        (acc: number, j: any) => acc + Math.max((Number(j.amount) || 0) - (amountPaidByJob.get(j.id) || 0), 0), 0);
      const sinalRecebidoOpen = openJobs.reduce(
        (acc: number, j: any) => acc + Math.max(amountPaidByJob.get(j.id) || 0, 0), 0);

      // SAÍDA do período: despesas pagas (fin_despesas status='pago') por
      // data_pagamento dentro do período. Fim exclusivo (dia seguinte) cobre o
      // dia inteiro mesmo se a coluna for timestamp.
      const periodEndNext = addDaysOnly(periodEnd, 1);
      const { data: despPagas } = await adminClient
        .from('fin_despesas')
        .select('valor, data_pagamento, status')
        .eq('user_id', userId)
        .eq('status', 'pago')
        .gte('data_pagamento', periodStart)
        .lt('data_pagamento', periodEndNext);
      const expensesThisMonth = (despPagas || []).reduce((s: number, d: any) => s + (Number(d.valor) || 0), 0);

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
        // Só quem tem a permissão 'finance' vê valores (dono/admin sempre; membro
        // só se o dono ligou). Sem ela, zera o finance — a UI também esconde os
        // cards, mas aqui é a trava de rede.
        finance: canSeeFinance ? {
          revenueThisMonth,
          revenueLastMonth,
          futureRevenue,
          toReceiveOpen,
          sinalRecebidoOpen,
          openJobsCount: openJobs.length,
          expensesThisMonth,
          dailyRevenue,
        } : {
          revenueThisMonth: 0, revenueLastMonth: 0, futureRevenue: 0,
          toReceiveOpen: 0, sinalRecebidoOpen: 0, openJobsCount: 0,
          expensesThisMonth: 0, dailyRevenue: [],
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
    // Avisos de segurança no boot (galeria/pagamento).
    if (process.env.NODE_ENV === 'production') {
      if (!isEncryptionConfigured()) {
        console.error('[SEGURANÇA] WA_TOKEN_ENCRYPTION_KEY ausente: tokens de WhatsApp/Mercado Pago NÃO serão cifrados e conexões de pagamento serão recusadas. Configure uma chave de 64 hex.');
      }
      if (!isGallerySessionConfigured()) {
        console.error('[SEGURANÇA] Sem chave de sessão da galeria (GALLERY_SESSION_KEY/WA_TOKEN_ENCRYPTION_KEY): login de clientes na galeria está DESABILITADO. Configure uma chave de 64 hex.');
      }
    }
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
  // Conversas já limpas do "nome do estúdio" neste boot (chave userId:nome)
  const ownerNameHealed = new Set<string>();

  // ── Atendimento autônomo (semi-automático) da Lia ──────────────────────────
  // Liga por estúdio (ai_agent_config.auto_send, default off). Responde sozinha,
  // mas em caso de preço/fechamento/objeção forte/cliente pedir humano, NÃO
  // responde o cliente — marca a conversa (needs_human) pra equipe assumir.
  // HANDOFF_INSTRUCTION agora é const de módulo (lá em cima) — compartilhada com
  // o /api/agent/test pra o teste reproduzir o fluxo real.
  const autoReplyTimers = new Map<string, NodeJS.Timeout>();
  const lastAutoReplyAt = new Map<string, number>();

  async function loadAgentConversation(userId: string, phone: string) {
    if (!supabaseAdmin) return [] as { role: 'user' | 'assistant'; content: string }[];
    // Pega as ÚLTIMAS 60 (desc + reverte) — em conversa longa o que importa é o
    // contexto RECENTE, não as primeiras mensagens.
    const { data } = await supabaseAdmin.from('wa_messages')
      .select('body, from_me, type, transcription, timestamp')
      .eq('user_id', userId).eq('phone', phone)
      .order('timestamp', { ascending: false }).limit(60);
    return (data || []).reverse().map((m: any) => ({
      role: (m.from_me ? 'assistant' : 'user') as 'user' | 'assistant',
      content: (m.body && m.body.trim())
        || m.transcription
        || (m.type === 'audio' ? '[áudio]' : m.type === 'image' ? '[imagem]' : ''),
    })).filter((m: any) => m.content && m.content.trim());
  }

  // ── Ações agênticas da Lia (mover funil + mandar PDF) ──────────────────────
  const lerDigitos = (s: string) => (s || '').replace(/\D/g, '');
  async function findDealForPhone(userId: string, phone: string) {
    if (!supabaseAdmin) return null;
    const d = lerDigitos(phone);
    const short = d.startsWith('55') ? d.slice(2) : d;
    const variants = new Set([d, short, '55' + short]);
    const { data } = await supabaseAdmin.from('deals')
      .select('id, stage, contact_phone').eq('user_id', userId);
    return (data || []).find((x: any) => variants.has(lerDigitos(x.contact_phone))) || null;
  }
  async function moveDealToStageNamed(userId: string, dealId: any, nameRegex: RegExp) {
    if (!supabaseAdmin || !dealId) return;
    const { data: stages } = await supabaseAdmin.from('deal_stages')
      .select('id, name, position').eq('user_id', userId).is('process_id', null)
      .order('position', { ascending: true });
    const target = (stages || []).find((s: any) => nameRegex.test(s.name || ''));
    if (!target) return;
    await supabaseAdmin.from('deals')
      .update({ stage: target.id, current_stage_entered_at: new Date().toISOString() })
      .eq('id', dealId).eq('user_id', userId);
  }
  async function sendMaterialPdf(userId: string, phone: string, nicho: string): Promise<boolean> {
    if (!supabaseAdmin) return false;
    const { data: mat } = await supabaseAdmin.from('agente_materiais')
      .select('path, nome_arquivo').eq('user_id', userId).eq('nicho', nicho).eq('tipo', 'pacote').maybeSingle();
    if (!mat?.path) return false;
    const { data: blob, error } = await supabaseAdmin.storage.from('agente-materiais').download(mat.path);
    if (error || !blob) return false;
    const buf = Buffer.from(await blob.arrayBuffer());
    await BaileysManager.sendMedia(userId, phone, buf.toString('base64'), 'application/pdf', mat.nome_arquivo || 'pacote.pdf', '');
    return true;
  }

  // Linha em branco (\n\n) = mensagem SEPARADA no WhatsApp (gente manda em vários
  // balões, ex.: a apresentação manda "…vou tomar conta do seu atendimento por
  // aqui." e SÓ DEPOIS "Qual tipo de ensaio…"). Quebra simples (\n) fica no mesmo
  // balão. Entre balões, "digitando…" + uma pausa curta, pra parecer humano.
  function splitIntoMessages(text: string): string[] {
    return (text || '').split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
  }
  async function sendAgentMessages(userId: string, phone: string, text: string) {
    const parts = splitIntoMessages(text);
    for (let i = 0; i < parts.length; i++) {
      if (i > 0) {
        await BaileysManager.sendTyping(userId, phone, true);
        await new Promise((r) => setTimeout(r, Math.min(1200 + parts[i].length * 35, 6000)));
        await BaileysManager.sendTyping(userId, phone, false);
      }
      await BaileysManager.sendText(userId, phone, parts[i]);
    }
  }

  // Cruza o telefone com clients/jobs pra a Lia reconhecer quem JÁ é cliente e
  // atender com proximidade (opt-in por estúdio: ai_agent_config.use_client_history).
  // Retorna '' se não achar (aí atende normal). Só leitura, escopo do user.
  async function buildClientContext(userId: string, phone: string): Promise<string> {
    if (!supabaseAdmin) return '';
    // Match rígido por número completo (mesma lógica do findDealForPhone). NÃO
    // casar por "últimos 8 dígitos" — daria falso positivo entre clientes do
    // mesmo estúdio (DDDs diferentes / com e sem o 9) e vazaria PII pra conversa
    // errada. Melhor não reconhecer do que reconhecer o cliente errado.
    const d = lerDigitos(phone);
    const short = d.startsWith('55') ? d.slice(2) : d;
    const variants = new Set([d, short, '55' + short]);
    const matchPhone = (p: any) => {
      const cd = lerDigitos(p || '');
      return !!cd && variants.has(cd);
    };
    const { data: clients } = await supabaseAdmin.from('clients')
      .select('id, name, child_name, phone').eq('user_id', userId);
    const cli = (clients || []).find((c: any) => matchPhone(c.phone));
    if (!cli) return '';
    let past = '';
    try {
      const { data: jobs } = await supabaseAdmin.from('jobs')
        .select('job_type, job_date').eq('user_id', userId).eq('client_id', cli.id)
        .order('job_date', { ascending: false }).limit(5);
      const items = (jobs || [])
        .filter((j: any) => j.job_type || j.job_date)
        .map((j: any) => {
          const dt = j.job_date ? new Date(j.job_date).toLocaleDateString('pt-BR') : '';
          return `${j.job_type || 'ensaio'}${dt ? ' (' + dt + ')' : ''}`;
        });
      if (items.length) past = items.join('; ');
    } catch { /* sem jobs cadastrados */ }
    const lines = [
      'CLIENTE QUE JÁ É DA CASA — atenda com a proximidade e o carinho de quem já se conhece, com naturalidade (sem parecer que leu uma ficha, sem despejar os dados de uma vez):',
      `- Nome: ${cli.name}`,
    ];
    if (cli.child_name) lines.push(`- Filho(a)/bebê: ${cli.child_name} — pode perguntar como ele(a) está, com carinho.`);
    if (past) lines.push(`- Já fez ensaio com a gente: ${past}.`);
    lines.push('Reconheça que já se conhecem e puxe assunto com afeto. NÃO invente nada além do que está aqui; se a pessoa não lembrar ou for outro assunto, siga normal.');
    return lines.join('\n');
  }

  async function runAutonomousReply(userId: string, phone: string) {
    if (!supabaseAdmin) return;
    const key = `${userId}|${phone}`;
    try {
      if (Date.now() - (lastAutoReplyAt.get(key) || 0) < 8000) return; // cooldown anti-duplicidade
      const { data: cfg } = await supabaseAdmin.from('ai_agent_config').select('*').eq('user_id', userId).maybeSingle();
      if (!cfg?.enabled || !cfg?.auto_send) return; // só se ligado E autônomo on
      // Se a última mensagem já é nossa (respondemos / humano entrou), não age.
      const { data: lastMsgs } = await supabaseAdmin.from('wa_messages')
        .select('from_me').eq('user_id', userId).eq('phone', phone)
        .order('timestamp', { ascending: false }).limit(1);
      if (lastMsgs?.[0]?.from_me) return;
      // Se já foi passada pra humano, a Lia não responde mais (humano assume).
      const { data: conv } = await supabaseAdmin.from('wa_conversations')
        .select('needs_human').eq('user_id', userId).eq('phone', phone).maybeSingle();
      if (conv?.needs_human) return;

      const messages = await loadAgentConversation(userId, phone);
      if (!messages.length || messages[messages.length - 1].role !== 'user') return;

      // Reconhecer cliente antigo (opt-in): injeta um contexto de proximidade.
      let extraInstruction = HANDOFF_INSTRUCTION;
      if (cfg.use_client_history) {
        try {
          const ctx = await buildClientContext(userId, phone);
          if (ctx) extraInstruction = HANDOFF_INSTRUCTION + '\n\n' + ctx;
        } catch (e: any) { console.warn('[Lia autônoma] contexto de cliente falhou:', e?.message); }
      }

      const reply = await getAgentReply({
        enabled: true,
        persona: cfg.persona || '', objective: cfg.objective || '',
        knowledge: cfg.knowledge || '', rules: cfg.rules || '',
        salesStrategy: cfg.sales_strategy || '',
        attendantName: cfg.attendant_name || '',
      }, messages, { extraInstruction });

      if (!reply || reply.includes('###HUMANO###')) {
        await supabaseAdmin.from('wa_conversations')
          .update({ needs_human: true }).eq('user_id', userId).eq('phone', phone);
        console.log(`[Lia autônoma] hand-off → equipe | ${phone}`);
        return;
      }
      const deal = await findDealForPhone(userId, phone);
      const isFirstReply = !messages.some((m) => m.role === 'assistant');
      const pdfMatch = reply.match(/###PDF:([a-z_]+)###/i);

      // "digitando…" + atraso realista antes de mandar.
      await BaileysManager.sendTyping(userId, phone, true);
      await new Promise((r) => setTimeout(r, Math.min(2500 + reply.length * 45, 9000)));
      await BaileysManager.sendTyping(userId, phone, false);

      if (pdfMatch) {
        // Manda o PDF do pacote do nicho + a frase de acompanhamento e move o
        // funil pra "Orçamento Enviado".
        const nicho = pdfMatch[1].toLowerCase();
        const followText = reply.replace(/###PDF:[a-z_]+###/i, '').trim();
        const sent = await sendMaterialPdf(userId, phone, nicho);
        if (followText) await sendAgentMessages(userId, phone, followText);
        if (sent && deal) {
          await moveDealToStageNamed(userId, deal.id, /or[çc]amento.*enviad|enviad.*or[çc]amento/i);
          // Agenda o follow-up contextual da Lia pra ~24h (dispara só se a pessoa
          // não responder; o worker cancela sozinho se ela responder ou virar humano).
          try {
            // Cancela QUALQUER follow-up pendente do deal (inclusive os estáticos de
            // etapa) — quando a Lia assume o orçamento, ela é a única fonte de retorno.
            await supabaseAdmin.from('scheduled_followups').update({ status: 'cancelled' })
              .eq('user_id', userId).eq('deal_id', deal.id).eq('status', 'pending');
            await supabaseAdmin.from('scheduled_followups').insert({
              user_id: userId, deal_id: deal.id, phone,
              message: AGENT_FOLLOWUP_SENTINEL, stage_id: deal.stage || null, contact_name: null,
              scheduled_at: new Date(Date.now() + AGENT_FOLLOWUP_DELAY_HOURS * 3600 * 1000).toISOString(),
            });
            console.log(`[Lia autônoma] follow-up ${AGENT_FOLLOWUP_DELAY_HOURS}h agendado | ${phone}`);
          } catch (e: any) { console.warn('[Lia autônoma] agendar follow-up falhou:', e?.message); }
        }
        console.log(`[Lia autônoma] PDF ${nicho} ${sent ? 'enviado' : 'NÃO cadastrado'} | ${phone}`);
      } else {
        await sendAgentMessages(userId, phone, reply);
        // Primeira resposta nossa → coloca o lead em "Conversa Iniciada".
        if (isFirstReply && deal) await moveDealToStageNamed(userId, deal.id, /conversa\s*iniciada/i);
        console.log(`[Lia autônoma] respondeu | ${phone}: ${reply.slice(0, 60)}`);
      }
      lastAutoReplyAt.set(key, Date.now());
      // Marca que a Lia atendeu (pro painel "Atendimentos da Lia"). Best-effort.
      try {
        await supabaseAdmin.from('wa_conversations')
          .update({ last_agent_reply_at: new Date().toISOString() })
          .eq('user_id', userId).eq('phone', phone);
      } catch {}
    } catch (e: any) {
      console.warn('[Lia autônoma] erro:', e?.message);
    }
  }

  // Debounce: espera a pessoa terminar a RAJADA de mensagens antes de responder
  // (muita gente manda uma e já manda outra). Mídia espera mais (dá tempo da
  // transcrição/descrição ficar pronta).
  function scheduleAutonomousReply(userId: string, phone: string, msgType: string) {
    const key = `${userId}|${phone}`;
    const old = autoReplyTimers.get(key);
    if (old) clearTimeout(old);
    const delay = (msgType === 'audio' || msgType === 'image') ? 18000 : 14000;
    autoReplyTimers.set(key, setTimeout(() => {
      autoReplyTimers.delete(key);
      runAutonomousReply(userId, phone).catch(() => {});
    }, delay));
  }

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
    // Buffer da mídia recebida — pra Lia "entender" áudio/imagem (Fase B).
    let mediaBuffer: Buffer | null = null;
    let mediaMime = '';

    if (firstKey === 'conversation' || firstKey === 'extendedTextMessage') {
      msgType = 'text';
      msgBody = (msgContent as any).conversation || (msgContent as any).extendedTextMessage?.text || '';
    } else if (firstKey === 'imageMessage') {
      msgType = 'image';
      msgBody = (msgContent as any).imageMessage?.caption || '';
      if (!isHistory) {
        const media = await BaileysManager.downloadIncomingMedia(msg, sock);
        if (media) { mediaDataUrl = await uploadWaMedia(userId, media.buffer, media.mimetype); mediaBuffer = media.buffer; mediaMime = media.mimetype; }
      }
    } else if (firstKey === 'audioMessage' || firstKey === 'pttMessage') {
      msgType = 'audio';
      if (!isHistory) {
        const media = await BaileysManager.downloadIncomingMedia(msg, sock);
        if (media) { mediaDataUrl = await uploadWaMedia(userId, media.buffer, media.mimetype); mediaBuffer = media.buffer; mediaMime = media.mimetype; }
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
    // pushName é o nome de QUEM ENVIOU: em mensagem nossa (fromMe) é o nome do
    // PRÓPRIO estúdio — gravar isso como contact_name fazia a lista inteira de
    // conversas virar "Estúdio X" em vez do nome do cliente.
    const contactName = msg.key.fromMe ? null : (msg.pushName || null);

    // HEAL retroativo: limpa conversas já contaminadas com o nome do estúdio
    // (gravado por mensagens enviadas antes do fix). Roda 1x por boot por
    // usuário+nome, na primeira mensagem enviada — quando o contato falar de
    // novo, o pushName dele repovoa o nome correto.
    if (msg.key.fromMe && msg.pushName) {
      const healKey = `${userId}:${msg.pushName}`;
      if (!ownerNameHealed.has(healKey)) {
        ownerNameHealed.add(healKey);
        try {
          await supabaseAdmin.from('wa_conversations')
            .update({ contact_name: null })
            .eq('user_id', userId)
            .eq('contact_name', msg.pushName);
          console.log(`[Baileys] Conversas com nome do estúdio ("${msg.pushName}") limpas (user ${userId})`);
        } catch { /* heal é best-effort */ }
      }
    }
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
      // Quem mandou a última? Pro ✓✓ na lista ("já respondi"). Baileys dispara
      // o handler também nas NOSSAS mensagens (fromMe), então isso cobre tudo.
      ...(!isHistory ? { last_from_me: !!msg.key.fromMe } : {}),
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

    // Fase B: a Lia "entende" áudio/imagem do CLIENTE em segundo plano (não
    // bloqueia o fluxo, não pode quebrar o recebimento). Guarda a transcrição/
    // descrição na mensagem e atualiza o preview do inbox.
    if (!isHistory && !msg.key.fromMe && (msgType === 'audio' || msgType === 'image') && mediaBuffer) {
      const buf = mediaBuffer; const mime = mediaMime; const placeholder = lastMsgPreview;
      const kind = msgType as 'audio' | 'image';
      void (async () => {
        try {
          const text = await understandMedia(kind, buf, mime);
          if (!text) return;
          await supabaseAdmin.from('wa_messages')
            .update({ transcription: text }).eq('user_id', userId).eq('message_id', msgId);
          const clean = text.replace(/^\[[^\]]+\]\s*/, '').slice(0, 60);
          await supabaseAdmin.from('wa_conversations')
            .update({ last_message: `${kind === 'audio' ? '🎤' : '📷'} ${clean}` })
            .eq('user_id', userId).eq('phone', phone).eq('last_message', placeholder);
        } catch (e: any) { console.warn('[media] understand falhou:', e?.message); }
      })();
    }

    // Fase C: agenda a resposta autônoma da Lia (só age se o estúdio ligou o
    // auto_send; debounce espera a pessoa terminar de mandar as mensagens).
    if (!isHistory && !msg.key.fromMe && (msgType === 'text' || msgType === 'audio' || msgType === 'image')) {
      scheduleAutonomousReply(userId, phone, msgType);
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

  // Acks do WhatsApp → status das mensagens enviadas (✓ enviado, ✓✓ entregue,
  // ✓✓ azul lido). O MessageBubble do app já renderiza pelos valores
  // 'sent'/'delivered'/'read' — faltava alimentar. Nunca rebaixa um 'read'.
  BaileysManager.setAckHandler(async (userId, updates) => {
    if (!supabaseAdmin) return;
    for (const u of updates) {
      try {
        let q = supabaseAdmin
          .from('wa_messages')
          .update({ status: u.status })
          .eq('user_id', userId)
          .eq('message_id', u.messageId);
        // delivered só sobe a partir de estados anteriores; read sobrescreve
        // tudo menos o próprio read (acks podem chegar fora de ordem).
        q = u.status === 'delivered'
          ? q.in('status', ['sending', 'sent', 'server_ack'])
          : q.neq('status', 'read');
        await q;
      } catch { /* ack perdido não é crítico — o próximo corrige */ }
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

// ─── Follow-up CONTEXTUAL da Lia (Fase 2 agêntica) ───────────────────────────
// ~24h após mandar o orçamento, SE o cliente não respondeu, a Lia LÊ a conversa
// e escreve um retorno caloroso (combinado com dia concreto), enviado via Baileys
// (mesmo canal do autônomo). Agendado em scheduled_followups com este sentinel na
// coluna `message`; o worker abaixo reconhece e gera/envia em vez do texto fixo.
const AGENT_FOLLOWUP_SENTINEL = '###AGENT_FOLLOWUP###';
const AGENT_FOLLOWUP_DELAY_HOURS = 24;
const AGENT_FOLLOWUP_DIRECTIVE =
  '[NOTA DO SISTEMA — NÃO é mensagem do cliente: já se passaram cerca de 24h desde que você enviou o orçamento e o cliente ainda não respondeu. Escreva AGORA uma única mensagem de follow-up pra retomar a conversa: calorosa, leve e na 1ª pessoa, sem cobrança e sem pressão. Relembre de leve o valor/a experiência, pergunte se ficou alguma dúvida, e proponha um combinado com DIA concreto (use a data de hoje: "posso te chamar amanhã?", "te chamo segunda?"). NÃO diga que é mensagem automática, NÃO mencione "24h" nem "sistema", NÃO mande pacote/PDF de novo. Se NÃO fizer sentido um follow-up (já fechou, já recusou, ou pediu pra não insistir), responda só ###SKIP###.]';

// Gera e envia o follow-up. Retorna o status final pra gravar em
// scheduled_followups. 'retry' = erro transitório (IA/WhatsApp fora) → reagenda.
async function runAgentFollowUp(task: any): Promise<'sent' | 'cancelled' | 'failed' | 'retry'> {
  if (!supabaseAdmin) return 'retry';
  try {
    const { data: cfg } = await supabaseAdmin.from('ai_agent_config')
      .select('*').eq('user_id', task.user_id).maybeSingle();
    if (!cfg?.enabled || !cfg?.auto_send) return 'cancelled'; // autônomo desligou
    // Cliente respondeu QUALQUER coisa desde que mandamos o orçamento? Então a
    // conversa está viva (mesmo que a Lia tenha respondido depois) — não manda
    // "follow-up de quem sumiu". Usa o instante do agendamento como corte
    // (scheduled_at - delay ≈ quando o orçamento foi enviado).
    const cutMs = Date.parse(task.scheduled_at) - AGENT_FOLLOWUP_DELAY_HOURS * 3600 * 1000;
    if (!Number.isNaN(cutMs)) {
      const since = new Date(cutMs).toISOString();
      const { data: clientMsgs } = await supabaseAdmin.from('wa_messages')
        .select('id').eq('user_id', task.user_id).eq('phone', task.phone)
        .eq('from_me', false).gt('timestamp', since).limit(1);
      if (clientMsgs && clientMsgs.length) return 'cancelled';
    }
    // Já passou pra humano? Não insiste.
    const { data: conv } = await supabaseAdmin.from('wa_conversations')
      .select('needs_human').eq('user_id', task.user_id).eq('phone', task.phone).maybeSingle();
    if (conv?.needs_human) return 'cancelled';
    // Carrega a conversa (últimas 60, desc + reverte — precisa do contexto recente,
    // inclusive o orçamento que acabou de ir). Mesmo mapeamento do autônomo.
    const { data: rows } = await supabaseAdmin.from('wa_messages')
      .select('body, from_me, type, transcription, timestamp')
      .eq('user_id', task.user_id).eq('phone', task.phone)
      .order('timestamp', { ascending: false }).limit(60);
    const messages = (rows || []).reverse().map((m: any) => ({
      role: (m.from_me ? 'assistant' : 'user') as 'user' | 'assistant',
      content: (m.body && m.body.trim()) || m.transcription
        || (m.type === 'audio' ? '[áudio]' : m.type === 'image' ? '[imagem]' : ''),
    })).filter((m: any) => m.content && m.content.trim());
    if (!messages.length) return 'cancelled';
    // A API exige terminar com o cliente: anexa a diretiva como turno "user".
    messages.push({ role: 'user', content: AGENT_FOLLOWUP_DIRECTIVE });
    const reply = await getAgentReply({
      enabled: true,
      persona: cfg.persona || '', objective: cfg.objective || '',
      knowledge: cfg.knowledge || '', rules: cfg.rules || '',
      salesStrategy: cfg.sales_strategy || '', attendantName: cfg.attendant_name || '',
    }, messages);
    if (!reply || /###SKIP###/i.test(reply) || /###HUMANO###/.test(reply)) return 'cancelled';
    const clean = reply.replace(/###[A-Za-z:_]+###/g, '').trim();
    if (!clean) return 'cancelled';
    // Envia em balões (linha em branco = mensagem separada), via Baileys.
    const parts = clean.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
    for (let i = 0; i < parts.length; i++) {
      if (i > 0) {
        try { await BaileysManager.sendTyping(task.user_id, task.phone, true); } catch {}
        await new Promise((r) => setTimeout(r, Math.min(1200 + parts[i].length * 35, 6000)));
        try { await BaileysManager.sendTyping(task.user_id, task.phone, false); } catch {}
      }
      await BaileysManager.sendText(task.user_id, task.phone, parts[i]);
    }
    try {
      await supabaseAdmin.from('wa_conversations')
        .update({ last_agent_reply_at: new Date().toISOString() })
        .eq('user_id', task.user_id).eq('phone', task.phone);
    } catch {}
    console.log(`[Lia follow-up] enviado | ${task.phone}: ${clean.slice(0, 60)}`);
    return 'sent';
  } catch (e: any) {
    // Erro transitório (IA/rede/WhatsApp desconectado) → reagenda em vez de perder.
    console.warn('[Lia follow-up] erro (vai reagendar):', e?.message);
    return 'retry';
  }
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

        // Follow-up CONTEXTUAL da Lia: gera com IA (lê a conversa) e envia via
        // Baileys, em vez do texto fixo. Cancela sozinho se o cliente já respondeu.
        if (task.message === AGENT_FOLLOWUP_SENTINEL) {
          const fStatus = await runAgentFollowUp(task);
          if (fStatus === 'retry') {
            // Erro transitório (IA/WhatsApp fora do ar): reagenda +30min, teto 5.
            // Só re-tenta se a coluna attempts existir (migration 050); senão falha.
            const nextAttempts = (typeof task.attempts === 'number' ? task.attempts : 0) + 1;
            if (typeof task.attempts === 'number' && nextAttempts <= 5) {
              await supabaseAdmin!.from('scheduled_followups').update({
                status: 'pending', attempts: nextAttempts,
                scheduled_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
              }).eq('id', task.id);
              console.log(`[FollowUp Worker] Lia follow-up ${task.phone} → retry ${nextAttempts}/5 (+30min)`);
            } else {
              await supabaseAdmin!.from('scheduled_followups').update({ status: 'failed' }).eq('id', task.id);
              console.log(`[FollowUp Worker] Lia follow-up ${task.phone} → failed (sem retry)`);
            }
            continue;
          }
          await supabaseAdmin!.from('scheduled_followups')
            .update({ status: fStatus, sent_at: fStatus === 'sent' ? new Date().toISOString() : null })
            .eq('id', task.id);
          console.log(`[FollowUp Worker] Lia follow-up ${task.phone} → ${fStatus}`);
          continue;
        }

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

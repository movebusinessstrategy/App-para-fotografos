import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  WAMessage,
  downloadMediaMessage,
  Browsers,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import QRCode from 'qrcode';
import path from 'path';
import fs from 'fs';
import pino from 'pino';

// Caminho das credenciais do WhatsApp (Baileys). Em produção, aponte
// BAILEYS_SESSIONS_DIR para um DISCO PERSISTENTE do Render (ex.:
// /var/data/baileys_sessions) — senão o disco do container é zerado a cada
// deploy/reinício e a sessão do WhatsApp é perdida (precisa reescanear o QR).
// Sem a env, mantém o comportamento atual (disco local, não persistente).
const SESSIONS_DIR = process.env.BAILEYS_SESSIONS_DIR || path.join(process.cwd(), 'baileys_sessions');
const silentLogger = pino({ level: 'silent' });

type Socket = ReturnType<typeof makeWASocket>;

interface Session {
  sock: Socket | null;
  status: 'connecting' | 'open' | 'close';
  qrBase64: string | null;
  qrWaiters: Array<(qr: string) => void>;
  connectWaiters: Array<() => void>;
  userId: string;
  reconnecting: boolean; // guard: impede múltiplos _initSocket simultâneos
  failCount: number;     // contador de falhas consecutivas para detectar credenciais corrompidas
}

const sessions = new Map<string, Session>();

// ── Multi-slot: 2º número na MESMA conta (ex.: pós-venda/alinhamento) ──────
// Um "slot" é só um SUFIXO na chave de sessão: o Map acima, a pasta em disco e
// o restoreAllSessions continuam funcionando sem NENHUMA mudança (a pasta do
// slot é um diretório normal com creds.json). O server separa o userId real do
// slot com parseSlotKey() na ENTRADA dos handlers (mensagem/conexão/acks) —
// todo o resto do código continua chamando com o userId puro (= slot 'main').
const SLOT_SEP = '__slot__';
export function slotKey(userId: string, slot?: string | null): string {
  return slot && slot !== 'main' ? `${userId}${SLOT_SEP}${slot}` : userId;
}
export function parseSlotKey(key: string): { userId: string; slot: string } {
  const i = key.indexOf(SLOT_SEP);
  return i === -1
    ? { userId: key, slot: 'main' }
    : { userId: key.slice(0, i), slot: key.slice(i + SLOT_SEP.length) };
}

export type IncomingMessageHandler = (userId: string, msg: WAMessage, sock: Socket, isHistory?: boolean) => Promise<void>;
let globalOnMessage: IncomingMessageHandler = async () => {};

export function setMessageHandler(handler: IncomingMessageHandler) {
  globalOnMessage = handler;
}

// Handler para lista de conversas ao conectar
export type ChatsSetHandler = (userId: string, chats: any[]) => Promise<void>;
let globalChatsSetHandler: ChatsSetHandler = async () => {};

export function setChatsSetHandler(handler: ChatsSetHandler) {
  globalChatsSetHandler = handler;
}

// Handler chamado quando a conexão abre — útil para migrações e sincronização inicial
export type ConnectHandler = (userId: string, phone: string) => Promise<void>;
let globalConnectHandler: ConnectHandler = async () => {};

export function setConnectHandler(handler: ConnectHandler) {
  globalConnectHandler = handler;
}

// Acks de entrega/leitura das mensagens ENVIADAS (✓✓ cinza / ✓✓ azul no app)
export type AckUpdate = { messageId: string; status: 'delivered' | 'read' };
export type AckHandler = (userId: string, updates: AckUpdate[]) => void;
let globalOnAck: AckHandler | null = null;

export function setAckHandler(handler: AckHandler) {
  globalOnAck = handler;
}

// ─── Iniciar / Reconectar sessão ─────────────────────────────────────────────

export async function startSession(userId: string): Promise<void> {
  // Encerra sessão anterior sem apagar arquivos (pode ter credenciais válidas)
  // Marca como reconnecting=true para que o handler 'close' não tente reconectar sozinho
  const existing = sessions.get(userId);
  if (existing) {
    existing.reconnecting = true;
    if (existing.sock) {
      try { existing.sock.end(undefined); } catch {}
    }
  }

  const sessionDir = path.join(SESSIONS_DIR, userId);
  fs.mkdirSync(sessionDir, { recursive: true });

  const session: Session = {
    sock: null,
    status: 'connecting',
    qrBase64: null,
    qrWaiters: [],
    connectWaiters: [],
    userId,
    reconnecting: false,
    failCount: 0,
  };
  sessions.set(userId, session);

  await _initSocket(session, sessionDir);
}

async function _initSocket(session: Session, sessionDir: string) {
  const { userId } = session;

  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, silentLogger as any),
    },
    printQRInTerminal: false,
    logger: silentLogger as any,
    browser: Browsers.macOS('Desktop'),
    generateHighQualityLinkPreview: false,
    // true: ao (re)vincular, o WhatsApp envia um pacote grande de histórico via
    // 'messaging-history.set' → handlers já gravam em wa_messages. Limite é do
    // próprio WhatsApp (alguns meses, só 1-a-1; mídia antiga não baixa).
    syncFullHistory: true,
    mobile: false,
    markOnlineOnConnect: false,
    connectTimeoutMs: 60_000,
    keepAliveIntervalMs: 25_000,
    retryRequestDelayMs: 2_000,
    defaultQueryTimeoutMs: 60_000,
    emitOwnEvents: false,
  });

  session.sock = sock;

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    const _debugCode = (lastDisconnect?.error as Boom)?.output?.statusCode;

    // Novo QR disponível
    if (qr) {
      try {
        const png = await QRCode.toDataURL(qr);
        session.qrBase64 = png;
        console.log(`[Baileys] QR gerado para ${userId}`);
        const waiters = [...session.qrWaiters];
        session.qrWaiters = [];
        waiters.forEach(cb => cb(png));
      } catch (e) {
        console.error('[Baileys] Erro ao gerar QR:', e);
      }
    }

    if (connection === 'open') {
      session.status = 'open';
      session.qrBase64 = null;
      session.failCount = 0; // zera contador de falhas ao conectar com sucesso
      console.log(`[Baileys] ✅ Conectado — usuário ${userId}`);
      const waiters = [...session.connectWaiters];
      session.connectWaiters = [];
      waiters.forEach(cb => cb());
      // Notifica handler de conexão (ex: migrar conversas órfãs para este número)
      const connectedPhone = getConnectedPhone(userId);
      if (connectedPhone) {
        try { await globalConnectHandler(userId, connectedPhone); } catch {}
      }
    }

    if (connection === 'close') {
      session.status = 'close';
      const code = (lastDisconnect?.error as Boom)?.output?.statusCode;
      const loggedOut = code === DisconnectReason.loggedOut;
      console.log(`[Baileys] Desconectado (código ${code}) — usuário ${userId}`);

      // 401 (logout pelo celular) ou 500 (sessão inválida): as credenciais não
      // servem mais — limpa tudo e para. ESTES são os ÚNICOS casos que apagam a
      // credencial; qualquer outra queda preserva o QR já pareado (antes, quedas
      // transitórias apagavam a sessão e forçavam escanear o QR de novo).
      if (loggedOut || code === DisconnectReason.badSession) {
        console.log(`[Baileys] ${loggedOut ? 'Logout pelo celular' : 'Sessão inválida (500)'} — removendo credenciais de ${userId}`);
        fs.rmSync(sessionDir, { recursive: true, force: true });
        sessions.delete(userId);
        registeredPhoneCache.delete(userId);
        return;
      }

      // 515 restartRequired: ESPERADO logo após parear/registrar. Não é falha —
      // reinicia o socket na hora, mantendo as credenciais (não gasta o
      // orçamento de tentativas nem adiciona delay desnecessário).
      if (code === DisconnectReason.restartRequired) {
        if (session.reconnecting) return;
        console.log(`[Baileys] Reinício solicitado (515) — reconectando já para ${userId}`);
        session.reconnecting = true;
        await new Promise(r => setTimeout(r, 1000));
        if (sessions.get(userId) === session) {
          session.reconnecting = false;
          await _initSocket(session, sessionDir);
        } else {
          session.reconnecting = false;
        }
        return;
      }

      // 440 connectionReplaced: outra instância/aparelho assumiu ESTA sessão.
      // Reconectar aqui gera "ping-pong" (um derruba o outro sem parar) — é
      // exatamente o sintoma de "ora cai um, ora cai o outro". Paramos a
      // auto-reconexão e PRESERVAMOS as credenciais; a sessão sai da memória
      // (UI mostra desconectado) e o usuário reconecta pela UI sem QR novo.
      // Em geral indica 2 servidores rodando na mesma sessão, ou outro aparelho.
      if (code === DisconnectReason.connectionReplaced) {
        console.log(`[Baileys] ⚠️ Conexão substituída (440) para ${userId} — outra instância/aparelho assumiu a sessão. Auto-reconexão pausada (credenciais preservadas). Verifique se não há 2 servidores rodando ou outro aparelho conectado.`);
        sessions.delete(userId);
        return;
      }

      // Guard: impede múltiplos _initSocket simultâneos (evita loop)
      if (session.reconnecting) {
        console.log(`[Baileys] Reconexão já em andamento para ${userId}, ignorando evento duplicado.`);
        return;
      }

      // Demais quedas (408 conexão perdida, 428 fechada, 503, oscilação de rede):
      // são transitórias. Reconecta com backoff e NUNCA apaga as credenciais.
      session.failCount = (session.failCount || 0) + 1;
      console.log(`[Baileys] Falha #${session.failCount} para ${userId} (código ${code})`);

      // Circuit breaker: após muitas falhas seguidas, PARA de tentar sozinho
      // (não fica martelando), mas MANTÉM as credenciais no disco. A sessão sai
      // da memória (UI mostra desconectado) e um reconnect manual — ou o restore
      // no próximo boot — retoma SEM precisar de QR novo.
      if (session.failCount >= 8) {
        console.log(`[Baileys] ⛔ ${session.failCount} falhas seguidas para ${userId} — pausando auto-reconexão (credenciais preservadas). Reconecte pelo app.`);
        sessions.delete(userId);
        return;
      }

      // Backoff progressivo: 3s, 6s, 9s... com teto de 30s
      const delayMs = Math.min(3000 * session.failCount, 30000);
      console.log(`[Baileys] Reconectando em ${delayMs / 1000}s...`);
      session.reconnecting = true;
      await new Promise(r => setTimeout(r, delayMs));

      // Verifica se a sessão ainda é a mesma (não foi substituída por startSession)
      if (sessions.get(userId) === session) {
        session.reconnecting = false;
        await _initSocket(session, sessionDir);
      } else {
        session.reconnecting = false;
        console.log(`[Baileys] Sessão para ${userId} foi substituída, reconexão cancelada.`);
      }
    }
  });

  // Mensagens em tempo real
  sock.ev.on('messages.upsert', async (upsert) => {
    const { messages, type } = upsert;
    if (type !== 'notify') return;
    for (const msg of messages) {
      try {
        await globalOnMessage(userId, msg, sock, false);
      } catch (e) {
        console.error('[Baileys] Erro ao processar msg:', e);
      }
    }
  });

  // Acks das mensagens que NÓS enviamos — alimenta o ✓✓/azul do app.
  // proto.WebMessageInfo.Status: 3=DELIVERY_ACK, 4=READ, 5=PLAYED (áudio ouvido).
  sock.ev.on('messages.update', (updates) => {
    if (!globalOnAck) return;
    const mapped: AckUpdate[] = [];
    for (const u of updates || []) {
      const st = Number((u.update as any)?.status);
      const id = u.key?.id;
      if (!id || !u.key?.fromMe) continue;
      if (st === 3) mapped.push({ messageId: id, status: 'delivered' });
      else if (st === 4 || st === 5) mapped.push({ messageId: id, status: 'read' });
    }
    if (mapped.length) {
      try { globalOnAck(userId, mapped); } catch { /* não derruba o socket */ }
    }
  });

  // Histórico ao conectar: chats + mensagens recentes
  sock.ev.on('messaging-history.set', async ({ chats, messages }) => {
    console.log(`[Baileys] messaging-history.set: ${chats.length} chats, ${messages.length} msgs para ${userId}`);
    try {
      if (chats.length > 0) await globalChatsSetHandler(userId, chats);
    } catch (e) { console.error('[Baileys] Erro messaging-history chats:', e); }
    for (const msg of messages) {
      try { await globalOnMessage(userId, msg, sock, true); } catch { /* silencioso */ }
    }
  });

  // chats.upsert: dispara individualmente para cada conversa ao conectar/atualizar
  sock.ev.on('chats.upsert', async (chats) => {
    console.log(`[Baileys] chats.upsert: ${chats.length} chats para ${userId}`);
    try { await globalChatsSetHandler(userId, chats); }
    catch (e) { console.error('[Baileys] Erro chats.upsert:', e); }
  });
}

// ─── Desconectar ─────────────────────────────────────────────────────────────

export async function stopSession(userId: string): Promise<void> {
  const session = sessions.get(userId);
  if (!session) return;
  sessions.delete(userId);
  registeredPhoneCache.delete(userId);
  try { await session.sock?.logout(); } catch {}
  try { session.sock?.end(undefined); } catch {}
  const sessionDir = path.join(SESSIONS_DIR, userId);
  fs.rmSync(sessionDir, { recursive: true, force: true });
  console.log(`[Baileys] Sessão removida — usuário ${userId}`);
}

// Reset "duro": limpa credenciais e sessão SEM tentar logout no servidor do
// WhatsApp. Diferente de stopSession, NÃO chama sock.logout() — logout exige
// socket vivo e TRAVA quando a credencial está morta. Usado SOMENTE por ação
// explícita do usuário ("Limpar sessão e gerar novo QR"), para destravar o caso
// em que existem creds registradas que não reconectam: aí o Baileys tenta
// "retomar" a sessão e NUNCA emite um QR novo (só emite QR quando NÃO há creds
// registradas). Preserva a garantia da da1fe0a: nunca apaga creds sozinho em
// queda transitória — só aqui, sob pedido direto do usuário.
export async function resetSession(userId: string): Promise<void> {
  const session = sessions.get(userId);
  if (session) {
    session.reconnecting = true; // impede o handler 'close' de auto-reconectar
    try { session.sock?.end(undefined); } catch {}
    sessions.delete(userId);
  }
  registeredPhoneCache.delete(userId);
  const sessionDir = path.join(SESSIONS_DIR, userId);
  try { fs.rmSync(sessionDir, { recursive: true, force: true }); } catch {}
  console.log(`[Baileys] Sessão resetada (credenciais limpas) — usuário ${userId}`);
}

// ─── Status e QR ─────────────────────────────────────────────────────────────

export function getStatus(userId: string): 'open' | 'connecting' | 'close' | 'not_initialized' {
  return sessions.get(userId)?.status ?? 'not_initialized';
}

// Retorna o número de telefone (somente dígitos) do WhatsApp conectado, ou null se não conectado
export function getConnectedPhone(userId: string): string | null {
  const session = sessions.get(userId);
  if (session?.status !== 'open' || !session.sock?.user?.id) return null;
  // sock.user.id pode ser "5511999999999:0@s.whatsapp.net" ou "5511999999999@s.whatsapp.net"
  const rawId = session.sock.user.id;
  const phone = rawId.split('@')[0].split(':')[0].replace(/\D/g, '');
  return phone || null;
}

// Número REGISTRADO da sessão, mesmo com o socket fora do ar: cai pro creds.json
// do disco (me.id fica gravado no pareamento). Essencial pra saber qual é o
// número de um slot desconectado — ex.: o connect do principal precisa saber o
// número do pós-venda pra NÃO re-carimbar as conversas dele. Cache em memória
// porque o handler de mensagens chama isso 1x por mensagem (histórico = milhares);
// invalidado onde a credencial morre (stopSession/resetSession/logout).
const registeredPhoneCache = new Map<string, string>();

// Existe credencial pareada em disco pra esta sessão? Distingue "slot nunca
// pareado" (false) de "pareado mas número ilegível agora" (true + phone null)
// — quem chama usa isso pra decidir entre seguir sem o slot ou FALHAR SEGURO.
export function hasSessionCreds(sessionKey: string): boolean {
  return fs.existsSync(path.join(SESSIONS_DIR, sessionKey, 'creds.json'));
}

export function getRegisteredPhone(sessionKey: string): string | null {
  const live = getConnectedPhone(sessionKey);
  if (live) {
    registeredPhoneCache.set(sessionKey, live);
    return live;
  }
  const cached = registeredPhoneCache.get(sessionKey);
  if (cached) return cached;
  try {
    const raw = fs.readFileSync(path.join(SESSIONS_DIR, sessionKey, 'creds.json'), 'utf8');
    const meId: string = JSON.parse(raw)?.me?.id || '';
    const phone = meId.split('@')[0].split(':')[0].replace(/\D/g, '');
    if (phone) registeredPhoneCache.set(sessionKey, phone);
    return phone || null;
  } catch {
    return null;
  }
}

export async function waitForQR(userId: string, timeoutMs = 40000): Promise<string | null> {
  const session = sessions.get(userId);
  if (!session) return null;
  if (session.qrBase64) return session.qrBase64;

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      session.qrWaiters = session.qrWaiters.filter(cb => cb !== onQR);
      resolve(null);
    }, timeoutMs);

    const onQR = (qr: string) => {
      clearTimeout(timer);
      resolve(qr);
    };
    session.qrWaiters.push(onQR);
  });
}

// ─── Envio de mensagens ───────────────────────────────────────────────────────

export async function sendText(userId: string, phone: string, text: string): Promise<string> {
  const sock = _requireSocket(userId);
  const result = await sock.sendMessage(_jid(phone), { text });
  return result?.key?.id ?? `baileys-${Date.now()}`;
}

// Mostra "digitando…" pro contato (presença). Best-effort: nunca lança.
export async function sendTyping(userId: string, phone: string, on = true): Promise<void> {
  try {
    const sock = _requireSocket(userId);
    await sock.sendPresenceUpdate(on ? 'composing' : 'paused', _jid(phone));
  } catch { /* presença é best-effort */ }
}

export async function sendMedia(
  userId: string,
  phone: string,
  mediaBase64: string,
  mimetype: string,
  filename: string,
  caption = '',
  waveform?: Buffer,
  seconds?: number,
): Promise<string> {
  const sock = _requireSocket(userId);
  const buffer = Buffer.from(mediaBase64, 'base64');
  const jid = _jid(phone);

  let result;
  if (mimetype.startsWith('image/')) {
    result = await sock.sendMessage(jid, { image: buffer, caption, mimetype });
  } else if (mimetype.startsWith('video/')) {
    result = await sock.sendMessage(jid, { video: buffer, caption, mimetype });
  } else if (mimetype.startsWith('audio/')) {
    result = await sock.sendMessage(jid, {
      audio: buffer,
      mimetype,
      ptt: true,
      ...(waveform ? { waveform: new Uint8Array(waveform) } : {}),
      ...(seconds ? { seconds } : {}),
    });
    const proto = (result as any)?.message?.audioMessage;
    console.log('[Baileys] PTT proto check', {
      hasWaveformInProto: !!proto?.waveform,
      protoWaveformLength: proto?.waveform?.length ?? 0,
      protoSeconds: proto?.seconds,
      protoPtt: proto?.ptt,
    });
  } else {
    result = await sock.sendMessage(jid, { document: buffer, mimetype, fileName: filename, caption });
  }
  return result?.key?.id ?? `baileys-${Date.now()}`;
}

// ─── Etiquetas (labels) do WhatsApp Business ─────────────────────────────────
// Etiquetas SÓ existem em conta WhatsApp Business — em conta pessoal a chamada
// não dá erro garantido mas não surte efeito. Tudo passa por chatModify → app-
// state do WhatsApp, que exige a sessão já sincronizada (app-state key presente);
// por isso PODE lançar logo após conectar. Quem chama trata (best-effort).
// Nesta versão do Baileys (7.x) não existe getLabels — as etiquetas existentes
// só chegam por evento; por isso o app CRIA e gerencia as próprias (ensureLabel).

// Cria/edita a DEFINIÇÃO de uma etiqueta (idempotente — é um SET pelo id).
export async function ensureLabel(userId: string, labelId: string, name: string, color: number): Promise<void> {
  const sock = _requireSocket(userId) as any;
  // addLabel(jid, {...}) → chatModify({addLabel}, jid). O jid não identifica a
  // etiqueta (o índice do patch é ['label_edit', id]); usa o próprio número.
  const selfDigits = String(sock.user?.id || '0').split('@')[0].split(':')[0];
  await sock.addLabel(_jid(selfDigits), { id: labelId, name, color });
}

// Aplica uma etiqueta EXISTENTE (por id) a um chat.
export async function addChatLabel(userId: string, phone: string, labelId: string): Promise<void> {
  const sock = _requireSocket(userId) as any;
  await sock.addChatLabel(_jid(phone), labelId);
}

// Remove uma etiqueta (por id) de um chat.
export async function removeChatLabel(userId: string, phone: string, labelId: string): Promise<void> {
  const sock = _requireSocket(userId) as any;
  await sock.removeChatLabel(_jid(phone), labelId);
}

export async function requestPairingCode(userId: string, phone: string): Promise<string | null> {
  const session = sessions.get(userId);
  if (!session?.sock) {
    console.log(`[Baileys] requestPairingCode: sessão/socket não disponível para ${userId}`);
    return null;
  }
  try {
    // requestPairingCode deve ser chamado enquanto o socket está conectando,
    // antes do WhatsApp gerar o QR. O número precisa incluir o código do país (ex: 5511999999999).
    const code = await session.sock.requestPairingCode(phone);
    if (code) {
      console.log(`[Baileys] ✅ Código de pareamento gerado para ${userId}: ${code}`);
    } else {
      console.warn(`[Baileys] requestPairingCode retornou vazio para ${userId}`);
    }
    return code ?? null;
  } catch (e: any) {
    // Ignora erros esperados de "ainda não pronto" — o caller vai tentar novamente
    const msg = e?.message || String(e);
    if (!msg.includes('not-authorized') && !msg.includes('stream') && !msg.includes('connection')) {
      console.error('[Baileys] Erro ao gerar código de pareamento:', msg);
    }
    return null;
  }
}

export async function fetchContactAbout(userId: string, phone: string): Promise<string | null> {
  const session = sessions.get(userId);
  if (session?.status !== 'open' || !session.sock) return null;
  try {
    const statuses = await session.sock.fetchStatus(_jid(phone));
    // fetchStatus retorna array de { id, status: { status: string, setAt: Date } }
    const item = Array.isArray(statuses) ? statuses[0] : statuses;
    const statusData = (item as any)?.status;
    // statusData pode ser { status: string, setAt: Date } ou a string diretamente
    if (typeof statusData === 'string') return statusData;
    if (statusData && typeof statusData.status === 'string') return statusData.status;
    return null;
  } catch {
    return null;
  }
}

export async function getProfilePicture(userId: string, phone: string): Promise<string | null> {
  const session = sessions.get(userId);
  if (session?.status !== 'open' || !session.sock) return null;

  // Tenta formato atual (13 dígitos)
  try {
    const url = await session.sock.profilePictureUrl(_jid(phone), 'image');
    if (url) return url;
  } catch {}

  // Tenta formato antigo (12 dígitos, sem o 9 extra) para compatibilidade
  if (phone.startsWith('55') && phone.length === 13) {
    const oldPhone = phone.slice(0, 4) + phone.slice(5); // remove o 9 na posição 5
    try {
      const url = await session.sock.profilePictureUrl(_jid(oldPhone), 'image');
      if (url) return url;
    } catch {}
  }

  return null;
}

// ─── Buscar histórico de mensagens ───────────────────────────────────────────

export async function fetchMessageHistory(userId: string, _phone: string, _count = 50): Promise<WAMessage[]> {
  const session = sessions.get(userId);
  if (session?.status !== 'open' || !session.sock) return [];
  // Histórico completo está no banco (Supabase); Baileys não é usado para busca retroativa
  return [];
}

// ─── Inicialização: restaura sessões existentes no boot ──────────────────────

export async function restoreAllSessions(onMessage?: IncomingMessageHandler): Promise<number> {
  if (onMessage) globalOnMessage = onMessage;
  if (!fs.existsSync(SESSIONS_DIR)) return 0;

  const dirs = fs.readdirSync(SESSIONS_DIR).filter(d => {
    const p = path.join(SESSIONS_DIR, d);
    return fs.statSync(p).isDirectory();
  });

  let restored = 0;
  for (const userId of dirs) {
    const credsFile = path.join(SESSIONS_DIR, userId, 'creds.json');
    if (fs.existsSync(credsFile)) {
      console.log(`[Baileys] Restaurando sessão: ${userId}`);
      await startSession(userId);
      restored++;
    }
  }
  return restored;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function _jid(phone: string): string {
  return `${phone.replace(/\D/g, '')}@s.whatsapp.net`;
}

function _requireSocket(userId: string): Socket {
  const session = sessions.get(userId);
  if (!session?.sock || session.status !== 'open') {
    throw new Error('WhatsApp não conectado. Escaneie o QR Code primeiro.');
  }
  return session.sock;
}

export async function downloadIncomingMedia(msg: WAMessage, sock: Socket): Promise<{ buffer: Buffer; mimetype: string } | null> {
  try {
    const type = Object.keys(msg.message || {})[0] as string | undefined;
    if (!type || !['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage', 'stickerMessage'].includes(type)) {
      return null;
    }
    const buffer = await downloadMediaMessage(msg, 'buffer', {}, { logger: silentLogger as any, reuploadRequest: sock.updateMediaMessage });
    const msgContent = (msg.message as any)[type];
    const mimetype = msgContent?.mimetype || 'application/octet-stream';
    return { buffer: buffer as Buffer, mimetype };
  } catch (e) {
    console.error('[Baileys] Erro ao baixar mídia:', e);
    return null;
  }
}

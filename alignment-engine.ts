import type { AlignmentAnswer, AlignmentData, AlignmentSession, AlignmentStatus } from './src/features/alignment/types.js';
import { nextAlignmentField, nextAlignmentText } from './src/features/alignment/messages.js';
export { nextAlignmentField, nextAlignmentText, alignmentSummary } from './src/features/alignment/messages.js';

export interface AlignmentMessage { message_id: string; body: string; from_me: boolean; type: string; transcription?: string; timestamp: string }
export interface AlignmentDecision {
  action: 'answer' | 'wait' | 'human';
  reason: string;
  answers: Array<{ field: string; value: string; messageId: string; quote: string }>;
}
export interface AlignmentStore {
  get(id: string, userId: string): Promise<AlignmentSession>;
  save(s: AlignmentSession, status: AlignmentStatus, data: AlignmentData): Promise<AlignmentSession | null>;
  messages(s: AlignmentSession): Promise<AlignmentMessage[]>;
  recordSent(s: AlignmentSession, text: string, messageId: string): Promise<void>;
  checkJob(s: AlignmentSession): Promise<void>;
}
export interface AlignmentTransport {
  check(s: AlignmentSession): Promise<void>;
  send(s: AlignmentSession, text: string): Promise<string>;
}
export type AlignmentEvaluator = (s: AlignmentSession, messages: AlignmentMessage[]) => Promise<AlignmentDecision>;

function messageText(m: AlignmentMessage): string { return [m.body, m.transcription].filter(Boolean).join('\n'); }
function validAnswerValue(value: unknown): value is string {
  return typeof value === 'string' && Boolean(value.trim()) && value.length <= 1200;
}
export function validateAlignmentDecision(raw: unknown, s: AlignmentSession, messages: AlignmentMessage[]): AlignmentDecision {
  const d = raw as AlignmentDecision;
  if (!d || !['answer', 'wait', 'human'].includes(d.action) || !Array.isArray(d.answers)) throw new Error('A interpretação da resposta precisa de revisão.');
  const fields = new Set(s.data.steps.map(x => x.id));
  const answers = d.answers.map(a => {
    const m = messages.find(x => x.message_id === a.messageId && !x.from_me);
    if (!fields.has(a.field) || !validAnswerValue(a.value)) throw new Error('Resposta fora do roteiro.');
    if (a.field === 'confirmacao' && s.data.asked !== 'confirmacao') throw new Error('A cliente ainda não recebeu o resumo para confirmar.');
    if (!m || typeof a.quote !== 'string' || !a.quote.trim() || !messageText(m).includes(a.quote)) throw new Error('Resposta sem evidência na mensagem da cliente.');
    return { ...a, value: a.value.trim() };
  });
  return { action: d.action, answers, reason: typeof d.reason === 'string' ? d.reason.slice(0,600) : '' };
}

export function applyAlignmentDecision(s: AlignmentSession, messages: AlignmentMessage[], decision: AlignmentDecision): AlignmentData {
  const data = structuredClone(s.data);
  data.seen = [...new Set([...data.seen, ...messages.map(m => m.message_id)])].slice(-1000);
  let changed = false;
  for (const a of decision.answers) {
    const answer: AlignmentAnswer = { value: a.value, source: 'client', messageIds: [a.messageId] };
    if (a.field !== 'confirmacao' && data.answers[a.field]?.value !== a.value) changed = true;
    data.answers[a.field] = answer;
  }
  // Qualquer correção de escolhas exige conferir o novo resumo, mesmo que a
  // mesma mensagem também contenha "sim" referente ao resumo anterior.
  if (changed) delete data.answers.confirmacao;
  data.attempts = decision.action === 'wait' ? data.attempts + 1 : 0;
  data.reason = decision.reason || null;
  return data;
}

export class AlignmentEngine {
  constructor(private store: AlignmentStore, private transport: AlignmentTransport, private evaluate: AlignmentEvaluator) {}

  private async handoff(s: AlignmentSession, reason: string) {
    return this.store.save(s, 'needs_human', { ...s.data, reason });
  }

  async dispatch(s: AlignmentSession, text: string, nextStatus: 'active' | 'review') {
    try { await this.store.checkJob(s); await this.transport.check(s); }
    catch { await this.handoff(s, 'O trabalho ou o WhatsApp mudou. Confira antes de retomar.'); return; }
    const sending = await this.store.save(s, 'sending', {
      ...s.data, pending: { text, nextStatus }, asked: nextAlignmentField(s.data),
    });
    if (!sending) return; // uma pessoa pausou ou outro processo assumiu
    try {
      const messageId = await this.transport.send(sending, text);
      // Persiste o recibo antes do inbox. Uma falha posterior nunca reenvia.
      const received = await this.store.save(sending, 'sending', {
        ...sending.data, pending: { text, nextStatus, messageId }, sent: [...sending.data.sent, messageId].slice(-1000),
      });
      if (!received) return;
      await this.store.recordSent(received, text, messageId);
      await this.store.save(received, nextStatus, { ...received.data, pending: null, reason: null });
    } catch {
      const latest = await this.store.get(s.id, s.user_id);
      if (latest.status === 'sending') await this.handoff(latest, 'O envio ou o registro não foi confirmado. Confira a conversa antes de retomar; não haverá reenvio automático.');
    }
  }

  async process(s: AlignmentSession): Promise<void> {
    if (s.status !== 'active') return;
    const locked = await this.store.save(s, 'processing', s.data);
    if (!locked) return;
    try { await this.processLocked(locked); }
    catch { await this.handoff(locked, 'Não consegui conferir esta resposta com segurança. Revise a conversa para retomar.'); }
  }

  private async processLocked(s: AlignmentSession) {
    await this.store.checkJob(s);
    const pending = await this.readIncoming(s);
    if (!pending) return;
    const { messages, incoming } = pending;
    const decision = validateAlignmentDecision(await this.evaluate(s, incoming), s, incoming);
    const recheck = await this.store.messages(s);
    const knownIds = new Set([...s.data.seen, ...messages.map(m => m.message_id), ...s.data.sent]);
    if (recheck.some(m => !knownIds.has(m.message_id))) {
      await this.store.save(s, 'active', s.data); return;
    }
    const data = applyAlignmentDecision(s, incoming, decision);
    if (decision.action === 'human') { await this.store.save(s, 'needs_human', data); return; }
    if (decision.action === 'wait') { await this.store.save(s, 'active', { ...data, reason: null }); return; }
    if (!decision.answers.length) throw new Error('Não há resposta verificável.');
    const prepared = await this.store.save(s, 'processing', data);
    if (prepared) await this.dispatch(prepared, nextAlignmentText(data), nextAlignmentField(data) ? 'active' : 'review');
  }

  private async readIncoming(s: AlignmentSession) {
    const messages = (await this.store.messages(s)).filter(m => !s.data.seen.includes(m.message_id));
    if (!messages.length) { await this.store.save(s, 'active', s.data); return; }
    if (messages.some(m => m.from_me && !s.data.sent.includes(m.message_id))) {
      await this.handoff(s, 'Uma pessoa respondeu na conversa. O M.I.A. foi pausado para a equipe assumir.'); return;
    }
    const incoming = messages.filter(m => !m.from_me);
    if (!incoming.length) { await this.store.save(s, 'active', s.data); return; }
    // Aguarda a sequência de mensagens e a transcrição antes de avançar.
    const newest = Math.max(...incoming.map(m => Date.parse(m.timestamp)));
    if (Date.now() - newest < 12_000) { await this.store.save(s, 'active', s.data); return; }
    if (incoming.some(m => !messageText(m).trim())) {
      if (Date.now() - newest < 60_000) { await this.store.save(s, 'active', s.data); return; }
      await this.handoff(s, 'A cliente enviou uma mídia que precisa ser conferida pela equipe.'); return;
    }
    return { incoming, messages };
  }
}

import { waMessageKeyId } from './whatsapp-message-key.js';

type HistoryRow = { message_id: string; phone: string; from_me: boolean; timestamp: string };

export function messageHistoryAnchor(row: HistoryRow) {
  const id = waMessageKeyId(row.message_id);
  const timestampMs = Date.parse(row.timestamp);
  if (!id || id.startsWith('wamid.') || !Number.isFinite(timestampMs)) return null;
  const phone = row.phone.replace(/\D/g, '');
  if (!phone) return null;
  return { phone, id, fromMe: row.from_me, timestampMs };
}

export function conversationIsNewer(current: string | null | undefined, incoming: string): boolean {
  return Boolean(current) && Date.parse(current!) > Date.parse(incoming);
}

export function historyChatUpdate<T extends Record<string, unknown>>(payload: T, currentTimestamp?: string | null): Partial<T> {
  const patch: Record<string, unknown> = { ...payload };
  if (conversationIsNewer(currentTimestamp, String(payload.last_message_at || ''))) {
    delete patch.last_message_at;
    delete patch.unread_count;
  }
  return patch as Partial<T>;
}

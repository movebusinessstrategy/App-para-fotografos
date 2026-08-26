import { useState, useEffect, useRef } from 'react';
import { authFetch } from '../../../utils/authFetch';
import { Message } from '../types';
import { startVisiblePoll } from '../../../utils/poll';

// slot 'posvenda' → o envio sai pelo 2º número (socket do slot), não pelo principal
export function useMessages(phone: string | null, slot: 'main' | 'posvenda' = 'main') {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const intervalRef = useRef<(() => void) | null>(null);

  async function fetchMessages() {
    if (!phone) return;
    try {
      const clean = phone.replace(/\D/g, '');
      // slot na BUSCA também: sem ele o server filtrava pelo número principal
      // e a conversa aberta na aba Pós-venda aparecia vazia
      const res = await authFetch(`/api/inbox/messages/${clean}?limit=80${slot === 'posvenda' ? '&slot=posvenda' : ''}`);
      if (!res.ok) return;

      const data = await res.json();
      if (!Array.isArray(data)) return;

      setMessages(
        data.sort((a, b) =>
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        )
      );
    } catch {
      // silencioso
    }
  }

  useEffect(() => {
    if (!phone) { setMessages([]); return; }

    setLoading(true);
    setMessages([]);

    let cancelled = false;
    const syncRecentHistory = async () => {
      const clean = phone.replace(/\D/g, '');
      const suffix = slot === 'posvenda' ? '?slot=posvenda' : '';
      const response = await authFetch(`/api/inbox/messages/${clean}/sync${suffix}`, {
        method: 'POST',
      });
      if (!response.ok || cancelled) return;
      const result = await response.json().catch(() => ({}));
      if (!result.queued) return;
      window.setTimeout(() => { if (!cancelled) fetchMessages(); }, 3500);
    };

    fetchMessages().finally(() => setLoading(false));
    syncRecentHistory().catch(() => {});
    intervalRef.current = startVisiblePoll(fetchMessages, 8000);

    return () => {
      cancelled = true;
      if (intervalRef.current) intervalRef.current();
    };
    // slot nos deps: trocar de aba com a MESMA conversa aberta refaz a busca
  }, [phone, slot]);

  async function sendText(text: string): Promise<void> {
    const tmpId = `tmp-${Date.now()}`;
    const tmp: Message = {
      message_id: tmpId,
      body: text,
      from_me: true,
      timestamp: new Date().toISOString(),
      type: 'text',
      status: 'sending',
      media_url: null,
    };
    setMessages(prev => [...prev, tmp]);

    // authFetch: impersonado, o envio tem que sair pelo WhatsApp do TENANT —
    // fetch cru mandava pela conta do próprio admin.
    const res = await authFetch('/api/inbox/send', {
      method: 'POST',
      body: JSON.stringify({ phone: phone!.replace(/\D/g, ''), text, ...(slot === 'posvenda' ? { slot } : {}) }),
    });

    setMessages(prev => prev.filter(m => m.message_id !== tmpId));
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Erro ao enviar');
    }
    await fetchMessages();
  }

  return { messages, loading, sendText };
}

import { useState, useEffect, useRef, useCallback } from 'react';
import { authFetch } from '../../../utils/authFetch';
import { Message } from '../types';
import { startVisiblePoll } from '../../../utils/poll';

// slot 'posvenda' → o envio sai pelo 2º número (socket do slot), não pelo principal
export function useMessages(phone: string | null, slot: 'main' | 'posvenda' = 'main') {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const requestSeqRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const activeKeyRef = useRef(`${slot}:${phone}`);
  activeKeyRef.current = `${slot}:${phone}`;

  const fetchMessages = useCallback(async () => {
    if (!phone) return;
    const key = `${slot}:${phone}`;
    if (key !== activeKeyRef.current) return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const seq = ++requestSeqRef.current;
    try {
      const clean = phone.replace(/\D/g, '');
      // slot na BUSCA também: sem ele o server filtrava pelo número principal
      // e a conversa aberta na aba Pós-venda aparecia vazia
      const res = await authFetch(`/api/inbox/messages/${clean}?limit=80${slot === 'posvenda' ? '&slot=posvenda' : ''}`, { signal: controller.signal });
      if (!res.ok) return;

      const data = await res.json();
      if (!Array.isArray(data)) return;
      if (controller.signal.aborted || seq !== requestSeqRef.current || key !== activeKeyRef.current) return;

      setMessages(
        data.sort((a, b) =>
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        )
      );
    } catch {
      // silencioso
    }
  }, [phone, slot]);

  useEffect(() => {
    if (!phone) { setMessages([]); setLoading(false); return; }

    setLoading(true);
    setMessages([]);

    let cancelled = false;
    let syncTimer: number | undefined;
    const syncRecentHistory = async () => {
      const clean = phone.replace(/\D/g, '');
      const suffix = slot === 'posvenda' ? '?slot=posvenda' : '';
      const response = await authFetch(`/api/inbox/messages/${clean}/sync${suffix}`, {
        method: 'POST',
      });
      if (!response.ok || cancelled) return;
      const result = await response.json().catch(() => ({})) as { queued?: boolean };
      if (!result.queued) return;
      syncTimer = window.setTimeout(() => { if (!cancelled) fetchMessages(); }, 3500);
    };

    fetchMessages().finally(() => { if (!cancelled) setLoading(false); });
    syncRecentHistory().catch(() => {});
    const stopPolling = startVisiblePoll(fetchMessages, 8000);

    return () => {
      cancelled = true;
      stopPolling();
      window.clearTimeout(syncTimer);
      controllerRef.current?.abort();
      requestSeqRef.current++;
    };
    // slot nos deps: trocar de aba com a MESMA conversa aberta refaz a busca
  }, [phone, slot, fetchMessages]);

  async function sendText(text: string): Promise<void> {
    const key = `${slot}:${phone}`;
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

    if (key === activeKeyRef.current) setMessages(prev => prev.filter(m => m.message_id !== tmpId));
    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as { error?: string };
      throw new Error(err.error || 'Erro ao enviar');
    }
    await fetchMessages();
  }

  return { messages, loading, sendText };
}

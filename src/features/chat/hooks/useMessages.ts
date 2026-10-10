import { useState, useEffect, useRef, useCallback } from 'react';
import { authFetch } from '../../../utils/authFetch';
import { Message } from '../types';
import { startVisiblePoll } from '../../../utils/poll';

// slot 'posvenda' → o envio sai pelo 2º número (socket do slot), não pelo principal
export function useMessages(phone: string | null, slot: 'main' | 'posvenda' = 'main') {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadedKey, setLoadedKey] = useState('');
  const [error, setError] = useState<string | null>(null);
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
      if (!res.ok) throw new Error('Não foi possível carregar as mensagens. Tente novamente.');

      const data = await res.json();
      if (!Array.isArray(data)) throw new Error('Resposta inválida ao carregar as mensagens.');
      if (controller.signal.aborted || seq !== requestSeqRef.current || key !== activeKeyRef.current) return;

      setError(null);
      setLoadedKey(key);
      setMessages(previous => {
        const pending = previous.filter(message => message.status === 'sending');
        return [...data, ...pending].sort((a, b) =>
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        );
      });
    } catch (cause) {
      if (controller.signal.aborted || key !== activeKeyRef.current) return;
      setLoadedKey(key);
      setError(cause instanceof Error ? cause.message : 'Não foi possível carregar as mensagens.');
    }
  }, [phone, slot]);

  useEffect(() => {
    if (!phone) { setMessages([]); setLoading(false); return; }

    setLoading(true);
    setError(null);
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

    try {
      const res = await authFetch('/api/inbox/send', {
        method: 'POST',
        body: JSON.stringify({ phone: phone!.replace(/\D/g, ''), text, ...(slot === 'posvenda' ? { slot } : {}) }),
      });
      const data = await res.json().catch(() => ({})) as { error?: string; message_id?: string };
      if (!res.ok) throw new Error(data.error || 'Não foi possível enviar a mensagem.');
      if (key !== activeKeyRef.current) return;
      // Mostra o envio confirmado enquanto o histórico é revalidado.
      setMessages(previous => previous.map(message => message.message_id === tmpId
        ? { ...message, message_id: data.message_id || tmpId, status: 'sent' }
        : message));
      await fetchMessages();
    } catch (cause) {
      if (key === activeKeyRef.current) setMessages(previous => previous.filter(message => message.message_id !== tmpId));
      throw cause;
    }
  }

  const current = `${slot}:${phone}`;
  return { messages: loadedKey === current ? messages : [], loading: !!phone && (loading || loadedKey !== current), error, refreshMessages: fetchMessages, sendText };
}

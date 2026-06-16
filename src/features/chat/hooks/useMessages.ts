import { useState, useEffect, useRef } from 'react';
import { supabase } from '../../../integrations/supabase/client';
import { Message } from '../types';
import { startVisiblePoll } from '../../../utils/poll';

export function useMessages(phone: string | null) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const intervalRef = useRef<(() => void) | null>(null);

  async function fetchMessages() {
    if (!phone) return;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) { console.warn('[useMessages] sem sessão'); return; }

      const clean = phone.replace(/\D/g, '');
      const res = await fetch(`/api/inbox/messages/${clean}?limit=80`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
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

    fetchMessages().finally(() => setLoading(false));
    intervalRef.current = startVisiblePoll(fetchMessages, 8000);

    return () => { if (intervalRef.current) intervalRef.current(); };
  }, [phone]);

  async function sendText(text: string): Promise<void> {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error('Sem sessão');

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

    const res = await fetch('/api/inbox/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ phone: phone!.replace(/\D/g, ''), text }),
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

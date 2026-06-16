import { useState, useEffect, useRef } from 'react';
import { supabase } from '../../../integrations/supabase/client';
import { Conversation } from '../types';
import { startVisiblePoll } from '../../../utils/poll';

export function useConversations() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const intervalRef = useRef<(() => void) | null>(null);

  async function fetchConversations() {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return;

      const res = await fetch('/api/inbox/conversations', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) return;

      const data = await res.json();
      if (!Array.isArray(data)) return;

      // Deduplicar por phone — manter a mais recente quando há duplicatas no DB
      const seen = new Map<string, typeof data[0]>();
      for (const conv of data) {
        const existing = seen.get(conv.phone);
        if (!existing || new Date(conv.last_message_at || 0) > new Date(existing.last_message_at || 0)) {
          seen.set(conv.phone, conv);
        }
      }
      const deduped = Array.from(seen.values()).sort((a, b) =>
        new Date(b.last_message_at || 0).getTime() - new Date(a.last_message_at || 0).getTime()
      );
      setConversations(deduped);
    } catch {
      // silencioso
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchConversations();
    intervalRef.current = startVisiblePoll(fetchConversations, 25000);
    return () => { if (intervalRef.current) intervalRef.current(); };
  }, []);

  return { conversations, loading, refresh: fetchConversations };
}

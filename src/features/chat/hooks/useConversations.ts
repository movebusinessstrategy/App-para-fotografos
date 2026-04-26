import { useState, useCallback, useRef, useEffect } from 'react';
import { authFetch } from '../../../utils/authFetch';
import { Conversation } from '../types';

export function useConversations() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchConversations = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const res = await authFetch('/api/inbox/conversations');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          setConversations(
            (data as Conversation[]).sort(
              (a, b) =>
                new Date(b.last_message_at || 0).getTime() -
                new Date(a.last_message_at || 0).getTime()
            )
          );
        }
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchConversations();
    pollRef.current = setInterval(() => fetchConversations(true), 4000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchConversations]);

  const addOrGet = useCallback(
    (phone: string, name?: string): Conversation => {
      const clean = phone.replace(/\D/g, '');
      const existing = conversations.find((c) => c.phone.replace(/\D/g, '') === clean);
      if (existing) return existing;
      const newConv: Conversation = {
        phone,
        contact_name: name || null,
        last_message: '',
        last_message_at: new Date().toISOString(),
        unread_count: 0,
      };
      setConversations((prev) => [newConv, ...prev]);
      return newConv;
    },
    [conversations]
  );

  return {
    conversations,
    loading,
    refreshing,
    refresh: () => fetchConversations(true),
    addOrGet,
  };
}

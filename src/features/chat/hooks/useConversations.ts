import { useState, useEffect, useRef, useCallback } from 'react';
import { authFetch } from '../../../utils/authFetch';
import { Conversation } from '../types';
import { startVisiblePoll } from '../../../utils/poll';

function sortConversations(data: Conversation[]): Conversation[] {
  const seen = new Map<string, Conversation>();
  for (const conversation of data) {
    const existing = seen.get(conversation.phone);
    if (!existing || new Date(conversation.last_message_at || 0) > new Date(existing.last_message_at || 0)) {
      seen.set(conversation.phone, conversation);
    }
  }
  return Array.from(seen.values()).sort((a, b) =>
    new Date(b.last_message_at || 0).getTime() - new Date(a.last_message_at || 0).getTime()
  );
}

// slot: 'main' = WhatsApp de vendas (padrão) | 'posvenda' = 2º número
// (alinhamento) — visões SEPARADAS, cada uma só com as conversas do seu número.
export function useConversations(slot: 'main' | 'posvenda' = 'main', search = '') {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadedSlotRef = useRef<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  // Sequência das buscas: o poll de 25s e o refresh() (pós mark-read/unread)
  // rodam concorrentes — uma resposta VELHA chegando depois sobrescrevia o
  // estado novo (badge recém-marcado sumia até o próximo tick).
  const fetchSeqRef = useRef(0);

  const fetchConversations = useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const seq = ++fetchSeqRef.current;
    setSearching(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (slot === 'posvenda') params.set('slot', 'posvenda');
      if (search.trim()) params.set('search', search.trim());
      const query = params.toString();
      // authFetch: leva os headers de impersonação do painel ADM — fetch cru
      // aqui fazia o Atendimento mostrar as conversas do PRÓPRIO admin em
      // qualquer conta impersonada (vazamento entre contas).
      const res = await authFetch(`/api/inbox/conversations${query ? `?${query}` : ''}`, { signal: controller.signal });
      if (!res.ok) throw new Error('Falha ao buscar conversas');

      const data = await res.json();
      if (!Array.isArray(data)) throw new Error('Resposta inválida');
      if (controller.signal.aborted || seq !== fetchSeqRef.current) return; // já existe busca mais nova

      loadedSlotRef.current = slot;
      setConversations(sortConversations(data));
    } catch {
      if (!controller.signal.aborted && seq === fetchSeqRef.current) setError('Não foi possível atualizar as conversas.');
    } finally {
      if (seq === fetchSeqRef.current) {
        setLoading(false);
        setSearching(false);
      }
    }
  }, [slot, search]);

  // Update otimista do badge (mark-read/unread): a UI responde na hora e o
  // refresh() confirma com o servidor em seguida.
  const mutateUnread = useCallback((phone: string, unread: number) => {
    controllerRef.current?.abort();
    fetchSeqRef.current++; // invalida buscas em voo: o snapshot delas é anterior à mutação
    setSearching(false);
    setLoading(false);
    setConversations(prev => prev.map(c => (c.phone === phone ? { ...c, unread_count: unread } : c)));
  }, []);

  useEffect(() => {
    const changedSlot = loadedSlotRef.current !== slot;
    setLoading(changedSlot);
    if (changedSlot) setConversations([]);
    fetchConversations();
    const stopPolling = startVisiblePoll(fetchConversations, 25000);
    return () => {
      stopPolling();
      controllerRef.current?.abort();
      fetchSeqRef.current++;
    };
  }, [fetchConversations, slot]);

  return { conversations, loading, searching, error, refresh: fetchConversations, mutateUnread };
}

import { useState, useEffect, useRef } from 'react';
import { authFetch } from '../../../utils/authFetch';
import { Conversation } from '../types';
import { startVisiblePoll } from '../../../utils/poll';

// slot: 'main' = WhatsApp de vendas (padrão) | 'posvenda' = 2º número
// (alinhamento) — visões SEPARADAS, cada uma só com as conversas do seu número.
export function useConversations(slot: 'main' | 'posvenda' = 'main', search = '') {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const intervalRef = useRef<(() => void) | null>(null);
  // Sequência das buscas: o poll de 25s e o refresh() (pós mark-read/unread)
  // rodam concorrentes — uma resposta VELHA chegando depois sobrescrevia o
  // estado novo (badge recém-marcado sumia até o próximo tick).
  const fetchSeqRef = useRef(0);

  async function fetchConversations() {
    const seq = ++fetchSeqRef.current;
    try {
      const params = new URLSearchParams();
      if (slot === 'posvenda') params.set('slot', 'posvenda');
      if (search.trim()) params.set('search', search.trim());
      const query = params.toString();
      // authFetch: leva os headers de impersonação do painel ADM — fetch cru
      // aqui fazia o Atendimento mostrar as conversas do PRÓPRIO admin em
      // qualquer conta impersonada (vazamento entre contas).
      const res = await authFetch(`/api/inbox/conversations${query ? `?${query}` : ''}`);
      if (!res.ok) return;

      const data = await res.json();
      if (!Array.isArray(data)) return;
      if (seq !== fetchSeqRef.current) return; // já existe busca mais nova

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

  // Update otimista do badge (mark-read/unread): a UI responde na hora e o
  // refresh() confirma com o servidor em seguida.
  function mutateUnread(phone: string, unread: number) {
    fetchSeqRef.current++; // invalida buscas em voo: o snapshot delas é anterior à mutação
    setConversations(prev => prev.map(c => (c.phone === phone ? { ...c, unread_count: unread } : c)));
  }

  useEffect(() => {
    setLoading(true);
    fetchConversations();
    intervalRef.current = startVisiblePoll(fetchConversations, 25000);
    return () => { if (intervalRef.current) intervalRef.current(); };
  }, [slot, search]);

  return { conversations, loading, refresh: fetchConversations, mutateUnread };
}

import { useMemo } from 'react';
import { useApi } from '../utils/useApi';
import { TeamMember } from '../types';

interface CurrentMember {
  id: string;
  name: string;
  color?: string | null;
}

interface MeResponse {
  currentMember: CurrentMember | null;
  isMember: boolean;
}

export function useSellers() {
  const { data: members } = useApi<TeamMember[]>('/api/team-members');
  const { data: me } = useApi<MeResponse>('/api/me');

  const sellers = useMemo(() => Array.isArray(members) ? members.filter(m => m.is_active !== false) : [], [members]);
  const currentMemberId = me?.currentMember?.id || null;
  const byId = useMemo(() => {
    const map = new Map<string, TeamMember>();
    for (const s of sellers) map.set(s.id, s);
    return map;
  }, [sellers]);

  return { sellers, currentMemberId, byId };
}

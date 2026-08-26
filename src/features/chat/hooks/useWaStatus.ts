import { useState, useEffect } from 'react';
import { authFetch } from '../../../utils/authFetch';
import { startVisiblePoll } from '../../../utils/poll';

export function useWaStatus() {
  const [connected, setConnected] = useState<boolean | null>(null);

  async function check() {
    try {
      const res = await authFetch('/api/whatsapp/status');
      if (!res.ok) return;
      const data = await res.json();
      setConnected(data?.connected === true || data?.whatsapp?.connected === true);
    } catch {
      setConnected(false);
    }
  }

  useEffect(() => {
    check();
    return startVisiblePoll(check, 20000);
  }, []);

  return { connected, check };
}

import { useState, useCallback, useEffect } from 'react';
import { authFetch } from '../../../utils/authFetch';
import { WaStatus } from '../types';

export function useWaStatus() {
  const [status, setStatus] = useState<WaStatus>('checking');

  const check = useCallback(async () => {
    try {
      const res = await authFetch('/api/whatsapp/status');
      if (res.ok) {
        const data = await res.json();
        const connected =
          data?.whatsapp?.connected === true || data?.connected === true;
        setStatus(connected ? 'connected' : 'disconnected');
      }
    } catch {
      setStatus('disconnected');
    }
  }, []);

  useEffect(() => {
    check();
    const id = setInterval(check, 4000);
    return () => clearInterval(id);
  }, [check]);

  return { status, check };
}

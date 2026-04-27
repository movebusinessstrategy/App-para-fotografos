import { useState, useEffect } from 'react';
import { supabase } from '../../../integrations/supabase/client';

export function useWaStatus() {
  const [connected, setConnected] = useState<boolean | null>(null);

  async function check() {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return;

      const res = await fetch('/api/whatsapp/status', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      setConnected(data?.connected === true || data?.whatsapp?.connected === true);
    } catch {
      setConnected(false);
    }
  }

  useEffect(() => {
    check();
    const id = setInterval(check, 5000);
    return () => clearInterval(id);
  }, []);

  return { connected, check };
}

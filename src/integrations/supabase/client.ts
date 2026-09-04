import { createClient } from '@supabase/supabase-js';
import { fetchWithTimeout } from '../../utils/requestTimeout';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY são obrigatórios no .env');
}

export const supabase = createClient(supabaseUrl, supabaseKey, {
  global: {
    fetch: (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      // Uploads mantêm seu tempo normal; login/renovação não prendem a sessão.
      return url.includes('/auth/v1/') ? fetchWithTimeout(input, init, 12_000) : fetch(input, init);
    },
  },
});

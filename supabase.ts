import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY!;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY são obrigatórios no .env');
}

/**
 * Cria um client do Supabase opcionalmente já com o header Authorization do usuário.
 * Usamos autoRefresh/persistSession desativados porque estamos no backend.
 */
export const createSupabaseClient = (authorizationHeader?: string): SupabaseClient => {
  return createClient(supabaseUrl, supabaseKey, {
    global: {
      headers: authorizationHeader ? { Authorization: authorizationHeader } : {}
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
};

// Client "anônimo" sem token; útil apenas para operações públicas.
export const supabase = createSupabaseClient();

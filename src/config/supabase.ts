import { createClient } from '@supabase/supabase-js';
import { config } from './index';

// Supabase client for authentication
export const supabase = createClient(
  config.supabase.url,
  config.supabase.anonKey
);

// Supabase admin client for server-side operations
export const supabaseAdmin = createClient(
  config.supabase.url,
  config.supabase.serviceRoleKey,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

export default supabase;

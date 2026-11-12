// Supabase browser client. Uses only the public publishable/anon key; never put a
// service_role or secret key in this frontend. Row Level Security must protect data.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase-config.js';

// Supabase's createClient expects the project root URL, not its /rest/v1 API URL.
const projectUrl = SUPABASE_URL.trim().replace(/\/rest\/v1\/?$/, '').replace(/\/$/, '');
const isValidProjectUrl = (() => {
  try {
    const parsed = new URL(projectUrl);
    return parsed.protocol === 'https:' && parsed.hostname.endsWith('.supabase.co');
  } catch {
    return false;
  }
})();

export const isSupabaseConfigured = Boolean(isValidProjectUrl && SUPABASE_ANON_KEY.trim());
export const supabase = isSupabaseConfigured
  ? createClient(projectUrl, SUPABASE_ANON_KEY.trim(), {
      auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true }
    })
  : null;

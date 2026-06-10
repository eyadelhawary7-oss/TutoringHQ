import 'server-only';

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * Server-side Supabase client with elevated privileges.
 * This module is server-only - importing it from a Client Component fails at build time.
 */
export const supabaseAdmin =
  supabaseUrl && supabaseServiceKey
    ? createClient(supabaseUrl, supabaseServiceKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      })
    : null;

export function getSupabaseAdmin() {
  if (!supabaseAdmin) {
    throw new Error(
      'Supabase admin client not configured. Please set SUPABASE_SERVICE_ROLE_KEY in .env.local',
    );
  }
  return supabaseAdmin;
}

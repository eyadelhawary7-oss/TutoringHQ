/** Browser client only. Service role + `import 'server-only'` live in `@/lib/supabase-admin`. */
import { createBrowserClient } from '@supabase/ssr';

// Validate environment variables
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase environment variables. Please check your .env.local file.'
  );
}

/**
 * Browser client — persists session to cookies so middleware (proxy) and
 * server-side Supabase clients can read the same session (fixes admin redirect).
 */
export const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey);

/**
 * Example usage:
 *
 * // Client Components (browser client):
 * import { supabase } from '@/lib/supabase';
 *
 * // Service role (API routes, server-only — never import from Client Components):
 * import { getSupabaseAdmin } from '@/lib/supabase-admin';
 */

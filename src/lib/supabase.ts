import { createClient } from '@supabase/supabase-js';

// Validate environment variables
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase environment variables. Please check your .env.local file.'
  );
}

/**
 * Browser/Client-side Supabase client
 * Use this in Client Components and browser-side code
 * Uses the public anon key (safe to expose to the browser)
 */
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});

/**
 * Server-side Supabase client with elevated privileges
 * Use this ONLY in Server Components, API routes, and server actions
 * Uses the service role key (has full database access - keep secret!)
 * 
 * WARNING: Never use this client in Client Components or expose it to the browser
 */
export const supabaseAdmin = supabaseServiceKey
  ? createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    })
  : null;

// Helper to check if admin client is available
export function getSupabaseAdmin() {
  if (!supabaseAdmin) {
    throw new Error(
      'Supabase admin client not configured. Please set SUPABASE_SERVICE_ROLE_KEY in .env.local'
    );
  }
  return supabaseAdmin;
}

/**
 * Example Usage:
 * 
 * // Client-side (Client Components):
 * import { supabase } from '@/lib/supabase';
 * const { data, error } = await supabase.from('users').select('*');
 * 
 * // Server-side (Server Components, API Routes, Server Actions):
 * import { getSupabaseAdmin } from '@/lib/supabase';
 * const admin = getSupabaseAdmin();
 * const { data, error } = await admin.from('users').select('*');
 */

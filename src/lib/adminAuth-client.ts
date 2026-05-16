'use client';

import { supabase } from '@/lib/supabase';
import { getCsrfHeaders } from '@/lib/csrf-client';

export async function getAdminSession() {
  const { data: { session } } = await supabase.auth.getSession();
  return session;
}

/**
 * Authenticated headers for admin REST calls.
 * Pass `includeCsrf = false` for read-only GET requests.
 */
export async function getAdminAuthHeaders(
  includeCsrf = true,
): Promise<Record<string, string> | null> {
  const session = await getAdminSession();
  if (!session) return null;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session.access_token}`,
  };
  if (includeCsrf) {
    const csrf = await getCsrfHeaders(session.access_token);
    Object.assign(headers, csrf);
  }
  return headers;
}

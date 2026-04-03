/**
 * Liveness-style health check for uptime monitoring.
 * Public, no auth. Always returns HTTP 200; body indicates ok vs degraded (DB).
 */

import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const maxDuration = 10;

const CHECK_TIMEOUT_MS = 2500;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms)
    ),
  ]);
}

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return Response.json(
      { status: 'degraded', timestamp: new Date().toISOString() },
      { status: 200 }
    );
  }

  try {
    const supabase = createClient(url, key, { auth: { persistSession: false } });
    const result = await withTimeout(
      Promise.resolve(supabase.from('centers').select('id').limit(1).maybeSingle()),
      CHECK_TIMEOUT_MS
    );

    if (result.error) {
      return Response.json(
        { status: 'degraded', timestamp: new Date().toISOString() },
        { status: 200 }
      );
    }

    return Response.json(
      { status: 'ok', timestamp: new Date().toISOString() },
      { status: 200 }
    );
  } catch {
    return Response.json(
      { status: 'degraded', timestamp: new Date().toISOString() },
      { status: 200 }
    );
  }
}

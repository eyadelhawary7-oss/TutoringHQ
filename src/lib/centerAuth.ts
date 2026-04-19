import { NextRequest, NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export type CenterAuthOk = {
  ok: true;
  userId: string;
  centerId: string;
  role: string;
  supabaseAdmin: SupabaseClient;
};

export type CenterAuthFail = { ok: false; response: NextResponse };

/**
 * Center-side API auth (Bearer access token). Returns service-role client for server updates.
 */
export async function requireCenterAuth(request: NextRequest): Promise<CenterAuthOk | CenterAuthFail> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Server misconfigured' }, { status: 500 }),
    };
  }

  const authHeader = request.headers.get('Authorization');
  const accessToken = authHeader?.replace(/^Bearer\s+/i, '')?.trim();
  if (!accessToken) {
    return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });

  const {
    data: { user },
    error,
  } = await supabaseAuth.auth.getUser();
  if (error || !user) {
    return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  let admin: SupabaseClient;
  try {
    admin = getSupabaseAdmin();
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Server misconfigured' }, { status: 500 }),
    };
  }

  const { data: userRecord } = await admin
    .from('users')
    .select('id, center_id, role')
    .eq('id', user.id)
    .maybeSingle();

  if (!userRecord?.center_id) {
    return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  return {
    ok: true,
    userId: user.id,
    centerId: userRecord.center_id as string,
    role: String((userRecord as { role?: string }).role ?? ''),
    supabaseAdmin: admin,
  };
}

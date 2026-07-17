import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { centerAccessGateResponse } from '@/lib/centerAccessGate';

function extractUuid(s: string): string | null {
  const m = s.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  return m ? m[0] : null;
}

/**
 * Optional server-side handshake before Supabase Realtime subscribe (auth-first; no uncaught 500s).
 */
export async function POST(request: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    let user: { id: string } | null = null;

    const authHeader = request.headers.get('Authorization');
    const accessToken = authHeader?.replace(/^Bearer\s+/i, '')?.trim();
    if (accessToken) {
      const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
        auth: { persistSession: false },
        global: { headers: { Authorization: `Bearer ${accessToken}` } },
      });
      const {
        data: { user: u },
        error,
      } = await supabaseAuth.auth.getUser();
      if (!error && u) user = u;
    }

    if (!user) {
      const cookieStore = await cookies();
      const supabaseCookie = createServerClient(supabaseUrl, supabaseAnonKey, {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll() {
            /* read-only */
          },
        },
      });
      const {
        data: { user: cookieUser },
      } = await supabaseCookie.auth.getUser();
      user = cookieUser ?? null;
    }

    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    let channel = '';
    try {
      const body = (await request.json()) as { channel?: string };
      channel = typeof body.channel === 'string' ? body.channel : '';
    } catch {
      channel = '';
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: profile } = await supabaseAdmin
      .from('users')
      .select('center_id')
      .eq('id', user.id)
      .maybeSingle();

    const { data: adminRow } = await supabaseAdmin
      .from('admin_users')
      .select('id')
      .eq('id', user.id)
      .maybeSingle();

    const isStaff = !!adminRow;
    const channelUuid = extractUuid(channel);

    if (channelUuid && profile?.center_id && !isStaff && channelUuid !== profile.center_id) {
      return NextResponse.json({ error: 'Forbidden channel for this user' }, { status: 403 });
    }

    // Part 6 (BLOCK): a locked centre has nothing to feed a realtime channel, and
    // the hand-rolled auth here skipped the suspension / lock gate. Staff bypass.
    if (!isStaff && profile?.center_id) {
      const gate = await centerAccessGateResponse(supabaseAdmin, profile.center_id);
      if (gate) return gate;
    }

    return NextResponse.json({ ok: true, channel: channel || undefined });
  } catch (err) {
    console.error('[realtime/subscribe]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unexpected error' },
      { status: 500 },
    );
  }
}

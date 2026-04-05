import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

const ALLOWED_PATCH = new Set([
  'name',
  'city',
  'governorate',
  'phone',
  'onboarding_step',
  'onboarding_completed',
  'onboarding_started_at',
]);

async function getUserCenterContext(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) return null;

  const authHeader = request.headers.get('Authorization');
  const accessToken = authHeader?.replace('Bearer ', '');
  if (!accessToken) return null;

  const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });

  const {
    data: { user },
    error,
  } = await supabaseAuth.auth.getUser();
  if (error || !user) return null;

  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userRecord } = await supabaseAdmin
    .from('users')
    .select('id, center_id')
    .eq('id', user.id)
    .single();

  const centerId = userRecord?.center_id as string | undefined;
  if (!centerId) return null;

  return { centerId, supabaseAdmin };
}

export async function PATCH(request: NextRequest) {
  try {
    const ctx = await getUserCenterContext(request);
    if (!ctx) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const patch: Record<string, unknown> = {};
    for (const key of Object.keys(body)) {
      if (!ALLOWED_PATCH.has(key)) continue;
      const v = body[key];
      if (key === 'onboarding_completed' && typeof v === 'boolean') {
        patch[key] = v;
      } else if (key === 'onboarding_step' && typeof v === 'number' && Number.isFinite(v)) {
        patch[key] = v;
      } else if (key === 'onboarding_started_at' && (typeof v === 'string' || v === null)) {
        patch[key] = v;
      } else if (key === 'name' && typeof v === 'string') {
        patch[key] = v.trim();
      } else if ((key === 'city' || key === 'governorate' || key === 'phone') && (typeof v === 'string' || v === null)) {
        patch[key] = typeof v === 'string' ? v.trim() || null : null;
      }
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    const { error: upErr } = await ctx.supabaseAdmin.from('centers').update(patch).eq('id', ctx.centerId);

    if (upErr) {
      return NextResponse.json({ error: upErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[centers/me PATCH]', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

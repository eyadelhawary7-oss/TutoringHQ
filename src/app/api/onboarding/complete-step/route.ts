import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

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
    .select('center_id')
    .eq('id', user.id)
    .single();

  const centerId = userRecord?.center_id as string | undefined;
  if (!centerId) return null;

  return { centerId, supabaseAdmin };
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await getUserCenterContext(request);
    if (!ctx) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let body: { step?: number };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const step = typeof body.step === 'number' ? body.step : NaN;
    if (!Number.isInteger(step) || step < 1 || step > 4) {
      return NextResponse.json({ error: 'Invalid step' }, { status: 400 });
    }

    const patch: Record<string, unknown> = { onboarding_step: step };
    if (step >= 4) {
      patch.onboarding_completed_at = new Date().toISOString();
    }

    const { error } = await ctx.supabaseAdmin
      .from('centers')
      .update(patch)
      .eq('id', ctx.centerId);

    if (error) {
      return NextResponse.json({ error: error.message ?? 'Update failed' }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[onboarding/complete-step]', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 },
    );
  }
}

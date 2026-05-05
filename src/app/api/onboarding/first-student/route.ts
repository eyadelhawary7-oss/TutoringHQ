import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { parseBodyWithLimit } from '@/lib/validate';

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
    .select('id, center_id, can_manage_students')
    .eq('id', user.id)
    .single();

  const centerId = userRecord?.center_id as string | undefined;
  if (!centerId) return null;

  return {
    userId: user.id,
    centerId,
    canManage: (userRecord as { can_manage_students?: boolean }).can_manage_students !== false,
    supabaseAdmin,
  };
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await getUserCenterContext(request);
    if (!ctx) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!ctx.canManage) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    let body: { name?: string; phone?: string | null };
    try {
      body = (await parseBodyWithLimit(request, 65536)) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (name.length < 2) {
      return NextResponse.json({ error: 'Name must be at least 2 characters' }, { status: 400 });
    }

    const phone =
      typeof body.phone === 'string' && body.phone.trim() ? body.phone.trim() : null;

    const { data: inserted, error } = await ctx.supabaseAdmin
      .from('students')
      .insert({
        center_id: ctx.centerId,
        name,
        phone,
        fee: 0,
        payment_status: 'unpaid',
      })
      .select('id, name, phone, student_number')
      .single();

    if (error || !inserted) {
      return NextResponse.json({ error: error?.message ?? 'Insert failed' }, { status: 500 });
    }

    return NextResponse.json({
      student: {
        id: inserted.id as string,
        name: inserted.name as string,
        phone: (inserted.phone as string | null) ?? '',
        student_number: (inserted.student_number as string | null) ?? null,
      },
    });
  } catch (e) {
    console.error('[onboarding/first-student]', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

async function getContext(request: NextRequest) {
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

  const { data: { user }, error } = await supabaseAuth.auth.getUser();
  if (error || !user) return null;

  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false },
  });

  const { data: userRecord } = await supabaseAdmin
    .from('users')
    .select('id, center_id')
    .eq('id', user.id)
    .single();

  const centerId = (userRecord as { center_id?: string } | null)?.center_id;
  if (!centerId) return null;

  return { centerId, supabaseAdmin };
}

const VALID_STATUSES = ['enrolled', 'active', 'at_risk', 'inactive', 'churned'] as const;

/** PATCH: Update student lifecycle_status */
export async function PATCH(request: NextRequest) {
  try {
    const ctx = await getContext(request);
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const studentId = typeof body.student_id === 'string' ? body.student_id : null;
    const status = typeof body.lifecycle_status === 'string' ? body.lifecycle_status : null;

    if (!studentId || !status) {
      return NextResponse.json({ error: 'student_id and lifecycle_status required' }, { status: 400 });
    }

    if (!VALID_STATUSES.includes(status as (typeof VALID_STATUSES)[number])) {
      return NextResponse.json({ error: 'Invalid lifecycle_status' }, { status: 400 });
    }

    const { supabaseAdmin } = ctx;

    const { data: student, error: fetchError } = await supabaseAdmin
      .from('students')
      .select('id, center_id')
      .eq('id', studentId)
      .single();

    if (fetchError || !student) {
      return NextResponse.json({ error: 'Student not found' }, { status: 404 });
    }

    if ((student as { center_id?: string }).center_id !== ctx.centerId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const updateData: Record<string, unknown> = {
      lifecycle_status: status,
      last_status_change: new Date().toISOString(),
    };
    if (status === 'at_risk') {
      updateData.at_risk_since = new Date().toISOString();
    } else {
      updateData.at_risk_since = null;
    }

    const { error: updateError } = await supabaseAdmin
      .from('students')
      .update(updateData)
      .eq('id', studentId);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

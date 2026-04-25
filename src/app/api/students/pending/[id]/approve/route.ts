import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { afterStudentWriteParentPackEffects } from '@/lib/studentParentPackWelcome';
import { currentBillingPeriod } from '@/lib/parentPack';

async function getOwnerAdminContext(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) return null;

  const accessToken = request.headers.get('Authorization')?.replace('Bearer ', '');
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

  const { data: userRow } = await supabaseAdmin
    .from('users')
    .select('role, center_id')
    .eq('id', user.id)
    .maybeSingle();

  if (!userRow || !['owner', 'admin'].includes((userRow.role as string) ?? '') || !userRow.center_id) {
    return { unauthorized: true as const };
  }

  return {
    supabaseAdmin,
    centerId: userRow.center_id as string,
    userId: user.id,
  };
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const ctx = await getOwnerAdminContext(request);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if ('unauthorized' in ctx) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { supabaseAdmin, centerId } = ctx;
  const { id } = await context.params;

  let body: {
    parent_phone?: string | null;
    enroll_in_pack?: boolean;
    selling_price?: number | null;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const enrollInPack = body.enroll_in_pack === true;
  const sellingPrice =
    typeof body.selling_price === 'number' && Number.isFinite(body.selling_price) && body.selling_price >= 0
      ? body.selling_price
      : null;
  const parentPhone =
    typeof body.parent_phone === 'string' && body.parent_phone.trim().length > 0
      ? body.parent_phone.trim()
      : null;

  if (enrollInPack && !parentPhone) {
    return NextResponse.json({ error: 'parent_phone_required' }, { status: 400 });
  }

  const { data: enrollment, error: fetchError } = await supabaseAdmin
    .from('pending_enrollments')
    .select('id, center_id, group_id, student_name, student_phone, parent_phone, notes, status')
    .eq('id', id)
    .maybeSingle();

  if (fetchError || !enrollment) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const row = enrollment as {
    id: string;
    center_id: string;
    group_id: string;
    student_name: string;
    student_phone: string;
    parent_phone: string | null;
    notes: string | null;
    status: string;
  };
  if (row.center_id !== centerId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (row.status !== 'pending') {
    return NextResponse.json({ error: 'Already processed' }, { status: 409 });
  }

  const { data: groupRow } = await supabaseAdmin
    .from('student_groups')
    .select('id, name, subject')
    .eq('id', row.group_id)
    .eq('center_id', centerId)
    .maybeSingle();

  const subjectValue = (groupRow as { subject?: string | null } | null)?.subject ?? null;

  const insertPayload = {
    center_id: centerId,
    name: row.student_name,
    phone: row.student_phone || null,
    parent_phone: parentPhone,
    subject: subjectValue,
    payment_status: 'unpaid' as const,
    parent_pack_opted_in: enrollInPack,
    parent_consent_given: enrollInPack,
    parent_consent_at: enrollInPack ? new Date().toISOString() : null,
  };

  const { data: insertedRaw, error: insertError } = await supabaseAdmin
    .from('students')
    .insert(insertPayload)
    .select('id, name, parent_phone, parent_pack_opted_in, student_number, center_id')
    .single();

  if (insertError || !insertedRaw) {
    return NextResponse.json(
      {
        error: 'Failed to create student',
        details: insertError?.message,
      },
      { status: 500 },
    );
  }
  const inserted = insertedRaw as {
    id: string;
    name: string;
    parent_phone: string | null;
    parent_pack_opted_in: boolean | null;
    student_number: string | null;
    center_id: string;
  };

  if (groupRow?.id) {
    await supabaseAdmin
      .from('student_group_members')
      .insert({ group_id: row.group_id, student_id: inserted.id });
  }

  await afterStudentWriteParentPackEffects(supabaseAdmin, {
    kind: 'insert',
    centerId,
    row: {
      id: inserted.id,
      name: inserted.name,
      parent_phone: inserted.parent_phone,
      parent_pack_opted_in: inserted.parent_pack_opted_in,
    },
  });

  if (enrollInPack && parentPhone) {
    await supabaseAdmin.from('parent_pack_monthly_counts').upsert(
      {
        center_id: centerId,
        billing_period: currentBillingPeriod(),
        student_id: inserted.id,
        parent_phone: parentPhone,
        opted_in_at: new Date().toISOString(),
      },
      { onConflict: 'center_id,billing_period,student_id', ignoreDuplicates: true },
    );

    if (sellingPrice != null) {
      await supabaseAdmin
        .from('centers')
        .update({ pack_price_per_parent: sellingPrice })
        .eq('id', centerId);
    }
  }

  await supabaseAdmin
    .from('pending_enrollments')
    .update({ status: 'approved' })
    .eq('id', id);

  return NextResponse.json({
    success: true,
    student: {
      id: inserted.id,
      name: inserted.name,
      student_number: inserted.student_number,
    },
  });
}

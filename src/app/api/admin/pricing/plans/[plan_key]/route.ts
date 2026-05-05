import { requireSuperAdminApi } from '@/lib/admin-auth';
import { requireSuperAdminRow } from '@/lib/admin-access';
import { validateCSRFRequest } from '@/lib/csrf';
import { NextRequest, NextResponse } from 'next/server';
import { parseBodyWithLimit } from '@/lib/validate';

type PatchBody = {
  monthly_fee?: number;
  all_in_price?: number;
  is_active?: boolean;
  weekly_student_limit?: number;
};

export async function PATCH(request: NextRequest, ctx: { params: Promise<{ plan_key: string }> }) {
  const auth = await requireSuperAdminApi(request);
  if (!auth.ok) return auth.response;

  const row403 = await requireSuperAdminRow(auth.supabaseAdmin, auth.userId);
  if (row403) return row403;
  // Enforces admin_users.role === 'super_admin' (or SUPER_ADMIN_PHONES). can_approve_signups does not unlock pricing PATCH.

  if (!validateCSRFRequest(request, auth.userId)) {
    return NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 });
  }

  const { plan_key: planKeyRaw } = await ctx.params;
  const planKey = decodeURIComponent(planKeyRaw || '').trim();
  if (!planKey) {
    return NextResponse.json({ error: 'Missing plan key' }, { status: 400 });
  }

  let body: PatchBody;
  try {
    body = (await parseBodyWithLimit(request, 65536)) as PatchBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { data: existing, error: fetchErr } = await auth.supabaseAdmin
    .from('pricing_plans')
    .select('plan_key')
    .eq('plan_key', planKey)
    .maybeSingle();

  if (fetchErr || !existing) {
    return NextResponse.json({ error: 'Plan not found' }, { status: 404 });
  }

  const updates: Record<string, unknown> = {};

  if (body.monthly_fee !== undefined) {
    const n = Number(body.monthly_fee);
    if (!Number.isFinite(n) || n <= 0) {
      return NextResponse.json({ error: 'monthly_fee must be a positive number' }, { status: 400 });
    }
    updates.monthly_fee = n;
  }

  if (body.all_in_price !== undefined) {
    const n = Number(body.all_in_price);
    if (!Number.isFinite(n) || n <= 0) {
      return NextResponse.json({ error: 'all_in_price must be a positive number' }, { status: 400 });
    }
    updates.all_in_price = n;
  }

  if (body.is_active !== undefined) {
    updates.is_active = Boolean(body.is_active);
  }

  if (body.weekly_student_limit !== undefined) {
    const n = Math.round(Number(body.weekly_student_limit));
    if (!Number.isFinite(n) || n < 0) {
      return NextResponse.json({ error: 'weekly_student_limit must be a non-negative integer' }, { status: 400 });
    }
    updates.weekly_student_limit = n;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
  }

  const { data: row, error: upErr } = await auth.supabaseAdmin
    .from('pricing_plans')
    .update(updates)
    .eq('plan_key', planKey)
    .select(
      'plan_key, arabic_name, english_name, weekly_student_limit, monthly_fee, cost_per_student, setup_fee, is_active, all_in_price',
    )
    .single();

  if (upErr) {
    console.error('[PATCH /api/admin/pricing/plans/[plan_key]]', upErr);
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  return NextResponse.json({ plan: row });
}

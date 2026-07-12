// /api/admin/promo-code-requests
//
// Phase 4c — Manager promo-code request flow.
//
// POST : a Sales Manager (admin_users.role = 'sales_manager') REQUESTS a promo code.
//        super_admin may also create directly. Reps / everyone else -> 403. The request
//        is validated against per-request caps (max discount %, max uses) and inserted as
//        status='pending'. CSRF-required.
// GET  : list requests. CEO (super_admin) / full admin see ALL; a sales_manager sees ONLY
//        their own (fail-closed via requested_by = ctx.userId). Reps / others -> 403.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminContext, requireAdminRole } from '@/lib/admin-auth';
import { validateCSRFRequest } from '@/lib/csrf';
import { parseBodyWithLimit } from '@/lib/validate';
import { loadPromoRequestCaps, validatePromoRequestInput } from '@/lib/promoCodeRequests';

const REQUEST_SELECT =
  'id, code, discount_pct, max_uses_total, expires_at, target_type, status, rejection_reason, requested_by, requested_by_staff_id, reviewed_by, reviewed_at, created_promo_code_id, created_at';

export async function GET(request: NextRequest) {
  const ctx = await getAdminContext(request);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const isFullAdmin = requireAdminRole(ctx, ['super_admin', 'admin']) === null;
  const isManager = ctx.adminRole === 'sales_manager';
  // Reps and every other role get nothing here.
  if (!isFullAdmin && !isManager) {
    return NextResponse.json({ error: 'insufficient_admin_role' }, { status: 403 });
  }

  let query = ctx.supabaseAdmin
    .from('promo_code_requests')
    .select(REQUEST_SELECT)
    .order('created_at', { ascending: false });

  // Fail-closed: a manager only ever sees rows they requested. Full admins see all.
  if (isManager && !isFullAdmin) {
    query = query.eq('requested_by', ctx.userId);
  }

  const { data: rows, error } = await query;
  if (error) {
    console.error('[GET /api/admin/promo-code-requests]', error);
    return NextResponse.json({ error: 'Failed to load promo code requests' }, { status: 500 });
  }

  return NextResponse.json({ requests: rows ?? [] });
}

export async function POST(request: NextRequest) {
  const ctx = await getAdminContext(request);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Only a Manager may request; super_admin may also create directly. Reps -> 403.
  const isManager = ctx.adminRole === 'sales_manager';
  const isSuperAdmin = ctx.internalRole === 'super_admin';
  if (!isManager && !isSuperAdmin) {
    return NextResponse.json({ error: 'insufficient_admin_role' }, { status: 403 });
  }

  if (!validateCSRFRequest(request, ctx.userId)) {
    return NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 });
  }

  let body: {
    code?: unknown;
    discountPct?: unknown;
    maxUsesTotal?: unknown;
    expiresAt?: unknown;
    targetType?: unknown;
  };
  try {
    body = (await parseBodyWithLimit(request, 8192)) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const caps = await loadPromoRequestCaps(ctx.supabaseAdmin);
  const validated = validatePromoRequestInput(body, caps);
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error, caps }, { status: 400 });
  }

  // Resolve the manager's sales-org (staff) row from staff.user_id.
  const { data: staffRow } = await ctx.supabaseAdmin
    .from('staff')
    .select('id')
    .eq('user_id', ctx.userId)
    .maybeSingle();
  const requestedByStaffId = (staffRow as { id?: string } | null)?.id ?? null;

  // requested_by FK -> admin_users.id. A phone-based super_admin has no admin_users row
  // (ctx.adminRole === null), so store NULL to avoid an FK violation. Managers always
  // have a row (their role comes FROM admin_users.role).
  const requestedBy = ctx.adminRole ? ctx.userId : null;

  const { data: inserted, error: insertErr } = await ctx.supabaseAdmin
    .from('promo_code_requests')
    .insert({
      requested_by: requestedBy,
      requested_by_staff_id: requestedByStaffId,
      code: validated.code,
      discount_pct: validated.discountPct,
      max_uses_total: validated.maxUsesTotal,
      expires_at: validated.expiresAt,
      target_type: validated.targetType,
      status: 'pending',
    })
    .select(REQUEST_SELECT)
    .single();

  if (insertErr) {
    console.error('[POST /api/admin/promo-code-requests]', insertErr);
    return NextResponse.json({ error: 'Failed to create promo code request' }, { status: 500 });
  }

  try {
    await ctx.supabaseAdmin.from('audit_log').insert({
      user_id: ctx.userId,
      action: 'promo_code_requested',
      details: {
        code: validated.code,
        discountPct: validated.discountPct,
        maxUsesTotal: validated.maxUsesTotal,
        targetType: validated.targetType,
      },
    });
  } catch (auditErr) {
    console.error('[POST /api/admin/promo-code-requests] audit_log', auditErr);
  }

  return NextResponse.json({ request: inserted }, { status: 201 });
}

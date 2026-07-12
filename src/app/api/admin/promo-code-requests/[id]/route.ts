// /api/admin/promo-code-requests/[id]
//
// Phase 4c — CEO approves or rejects a Manager's promo-code request.
//
// PATCH (super_admin only + CSRF):
//   action: 'approve' -> create the real promo_codes row (is_active=true; code / discount
//                        / max_uses / expiry taken from the request), then mark the request
//                        approved with reviewed_by / reviewed_at / created_promo_code_id.
//                        Idempotent-safe: an already-approved request is not re-created.
//   action: 'reject'  -> require a non-empty reason; mark the request rejected with
//                        rejection_reason / reviewed_by / reviewed_at.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminContext, requireAdminRole } from '@/lib/admin-auth';
import { validateCSRFRequest } from '@/lib/csrf';
import { parseBodyWithLimit } from '@/lib/validate';

type RouteContext = { params: Promise<{ id: string }> };

const REQUEST_SELECT =
  'id, code, discount_pct, max_uses_total, expires_at, target_type, status, rejection_reason, requested_by, requested_by_staff_id, reviewed_by, reviewed_at, created_promo_code_id, created_at';

const CODE_RE = /^[A-Z0-9_-]{2,32}$/;

export async function PATCH(request: NextRequest, context: RouteContext) {
  const ctx = await getAdminContext(request);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const denied = requireAdminRole(ctx, ['super_admin']);
  if (denied) return denied;

  if (!validateCSRFRequest(request, ctx.userId)) {
    return NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 });
  }

  const { id } = await context.params;
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  let body: { action?: unknown; reason?: unknown; code?: unknown };
  try {
    body = (await parseBodyWithLimit(request, 8192)) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const action = body.action;
  if (action !== 'approve' && action !== 'reject') {
    return NextResponse.json({ error: "action must be 'approve' or 'reject'" }, { status: 400 });
  }

  const { data: reqRow, error: loadErr } = await ctx.supabaseAdmin
    .from('promo_code_requests')
    .select(REQUEST_SELECT)
    .eq('id', id)
    .maybeSingle();

  if (loadErr) {
    console.error('[PATCH /api/admin/promo-code-requests/[id]] load', loadErr);
    return NextResponse.json({ error: 'Failed to load promo code request' }, { status: 500 });
  }
  if (!reqRow) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const row = reqRow as {
    status: string;
    code: string | null;
    discount_pct: number;
    max_uses_total: number | null;
    expires_at: string | null;
    created_promo_code_id: string | null;
  };

  // reviewed_by FK -> admin_users.id. A phone-based super_admin has no admin_users row
  // (ctx.adminRole === null); store NULL to avoid an FK violation.
  const reviewedBy = ctx.adminRole ? ctx.userId : null;
  const reviewedAt = new Date().toISOString();

  if (action === 'reject') {
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (!reason) {
      return NextResponse.json({ error: 'A rejection reason is required' }, { status: 400 });
    }
    // Idempotent-safe: re-rejecting an already-rejected request is a no-op success.
    if (row.status === 'rejected') {
      return NextResponse.json({ request: reqRow, alreadyReviewed: true });
    }
    if (row.status === 'approved') {
      return NextResponse.json({ error: 'Request already approved' }, { status: 409 });
    }

    const { data: updated, error: updErr } = await ctx.supabaseAdmin
      .from('promo_code_requests')
      .update({
        status: 'rejected',
        rejection_reason: reason,
        reviewed_by: reviewedBy,
        reviewed_at: reviewedAt,
      })
      .eq('id', id)
      .eq('status', 'pending')
      .select(REQUEST_SELECT)
      .maybeSingle();

    if (updErr) {
      console.error('[PATCH /api/admin/promo-code-requests/[id]] reject', updErr);
      return NextResponse.json({ error: 'Failed to reject request' }, { status: 500 });
    }
    if (!updated) return NextResponse.json({ error: 'Request is no longer pending' }, { status: 409 });

    try {
      await ctx.supabaseAdmin.from('audit_log').insert({
        user_id: ctx.userId,
        action: 'promo_code_request_rejected',
        details: { requestId: id, reason },
      });
    } catch (auditErr) {
      console.error('[PATCH /api/admin/promo-code-requests/[id]] audit reject', auditErr);
    }

    return NextResponse.json({ request: updated });
  }

  // ── action === 'approve' ──────────────────────────────────────────────────────
  // Idempotent-safe: never double-create the promo code.
  if (row.status === 'approved') {
    return NextResponse.json({ request: reqRow, alreadyReviewed: true });
  }
  if (row.status === 'rejected') {
    return NextResponse.json({ error: 'Request already rejected' }, { status: 409 });
  }

  // The promo_codes.code column is NOT NULL. Use the request's proposed code, or a code
  // the CEO supplies at approval time when the manager left it blank.
  const overrideCode =
    typeof body.code === 'string' && body.code.trim() ? body.code.trim().toUpperCase() : null;
  const finalCode = overrideCode ?? row.code;
  if (!finalCode) {
    return NextResponse.json({ error: 'A code is required to approve this request' }, { status: 400 });
  }
  if (!CODE_RE.test(finalCode)) {
    return NextResponse.json(
      { error: 'code must be 2-32 uppercase alphanumeric characters (A-Z, 0-9, _, -)' },
      { status: 400 },
    );
  }

  const { data: promo, error: promoErr } = await ctx.supabaseAdmin
    .from('promo_codes')
    .insert({
      code: finalCode,
      discount_pct: row.discount_pct,
      max_uses_total: row.max_uses_total,
      expires_at: row.expires_at,
      is_active: true,
      created_by: ctx.userId,
    })
    .select('id, code')
    .single();

  if (promoErr) {
    if ((promoErr as { code?: string }).code === '23505') {
      return NextResponse.json({ error: 'A promo code with this code already exists' }, { status: 409 });
    }
    console.error('[PATCH /api/admin/promo-code-requests/[id]] create promo', promoErr);
    return NextResponse.json({ error: 'Failed to create promo code' }, { status: 500 });
  }

  const createdPromoId = (promo as { id: string }).id;

  const { data: updated, error: updErr } = await ctx.supabaseAdmin
    .from('promo_code_requests')
    .update({
      status: 'approved',
      code: finalCode,
      reviewed_by: reviewedBy,
      reviewed_at: reviewedAt,
      created_promo_code_id: createdPromoId,
    })
    .eq('id', id)
    .eq('status', 'pending')
    .select(REQUEST_SELECT)
    .maybeSingle();

  if (updErr) {
    console.error('[PATCH /api/admin/promo-code-requests/[id]] mark approved', updErr);
    // The promo code was created; surface success with the id so the CEO can see it.
    return NextResponse.json(
      { error: 'Promo code created but request status update failed', createdPromoCodeId: createdPromoId },
      { status: 500 },
    );
  }

  try {
    await ctx.supabaseAdmin.from('audit_log').insert({
      user_id: ctx.userId,
      action: 'promo_code_request_approved',
      details: { requestId: id, code: finalCode, promoCodeId: createdPromoId },
    });
  } catch (auditErr) {
    console.error('[PATCH /api/admin/promo-code-requests/[id]] audit approve', auditErr);
  }

  return NextResponse.json({ request: updated, promoCode: promo });
}

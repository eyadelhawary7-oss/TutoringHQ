// /api/admin/promo-codes/[id]
//
// PATCH  : toggle is_active or update expiresAt (super_admin or admin)
// DELETE : soft-delete - sets is_active = false (super_admin only)

import { NextRequest, NextResponse } from 'next/server';
import { getAdminContext, requireAdminRole } from '@/lib/admin-auth';
import { validateCSRFRequest } from '@/lib/csrf';
import { parseBodyWithLimit } from '@/lib/validate';

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: RouteContext) {
  const ctx = await getAdminContext(request);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const denied = requireAdminRole(ctx, ['super_admin', 'admin']);
  if (denied) return denied;

  if (!validateCSRFRequest(request, ctx.userId)) {
    return NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 });
  }

  const { id } = await context.params;
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  let body: { isActive?: unknown; expiresAt?: unknown };
  try {
    body = (await parseBodyWithLimit(request, 4096)) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};

  if (body.isActive !== undefined) {
    if (typeof body.isActive !== 'boolean') {
      return NextResponse.json({ error: 'isActive must be boolean' }, { status: 400 });
    }
    updates.is_active = body.isActive;
  }

  if (body.expiresAt !== undefined) {
    if (body.expiresAt === null || body.expiresAt === '') {
      updates.expires_at = null;
    } else if (typeof body.expiresAt === 'string') {
      const d = new Date(body.expiresAt);
      if (Number.isNaN(d.getTime())) {
        return NextResponse.json({ error: 'expiresAt must be a valid ISO date string or null' }, { status: 400 });
      }
      updates.expires_at = d.toISOString();
    } else {
      return NextResponse.json({ error: 'expiresAt must be a string or null' }, { status: 400 });
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No changes provided' }, { status: 400 });
  }

  const { data: updated, error } = await ctx.supabaseAdmin
    .from('promo_codes')
    .update(updates)
    .eq('id', id)
    .select()
    .maybeSingle();

  if (error) {
    console.error('[PATCH /api/admin/promo-codes/[id]]', error);
    return NextResponse.json({ error: 'Failed to update promo code' }, { status: 500 });
  }
  if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json({ promoCode: updated });
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const ctx = await getAdminContext(request);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const denied = requireAdminRole(ctx, ['super_admin']);
  if (denied) return denied;

  if (!validateCSRFRequest(request, ctx.userId)) {
    return NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 });
  }

  const { id } = await context.params;
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  const { data: updated, error } = await ctx.supabaseAdmin
    .from('promo_codes')
    .update({ is_active: false })
    .eq('id', id)
    .select('id, code')
    .maybeSingle();

  if (error) {
    console.error('[DELETE /api/admin/promo-codes/[id]]', error);
    return NextResponse.json({ error: 'Failed to deactivate promo code' }, { status: 500 });
  }
  if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  try {
    await ctx.supabaseAdmin.from('audit_log').insert({
      user_id: ctx.userId,
      action: 'promo_code_deleted',
      details: { code: (updated as { code?: string }).code ?? id },
    });
  } catch (auditErr) {
    console.error('[DELETE /api/admin/promo-codes/[id]] audit_log', auditErr);
  }

  return NextResponse.json({ ok: true });
}

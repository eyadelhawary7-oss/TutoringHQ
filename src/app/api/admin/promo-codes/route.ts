// /api/admin/promo-codes
//
// GET  : list all promo codes with uses_count (any admin role)
// POST : create a new promo code (super_admin or admin)

import { NextRequest, NextResponse } from 'next/server';
import { getAdminContext, requireAdminRole } from '@/lib/admin-auth';
import { validateCSRFRequest } from '@/lib/csrf';
import { parseBodyWithLimit } from '@/lib/validate';

export async function GET(request: NextRequest) {
  const ctx = await getAdminContext(request);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: rows, error } = await ctx.supabaseAdmin
    .from('promo_codes')
    .select('id, code, discount_pct, max_uses_total, uses_count, expires_at, is_active, created_at, created_by')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[GET /api/admin/promo-codes]', error);
    return NextResponse.json({ error: 'Failed to load promo codes' }, { status: 500 });
  }

  // Merged-Admin-Platform §05 — the three summary tiles. "Given" is the EGP
  // actually discounted, which lives on promo_code_redemptions, not on the code
  // itself: a code's uses_count says how often it was used, never for how much.
  let totalGivenEgp: number | null = null;
  try {
    const { data: redemptions, error: redErr } = await ctx.supabaseAdmin
      .from('promo_code_redemptions')
      .select('discount_amount_egp');
    if (redErr) throw redErr;
    totalGivenEgp = ((redemptions ?? []) as { discount_amount_egp: number | string | null }[]).reduce(
      (sum, r) => sum + Number(r.discount_amount_egp || 0),
      0,
    );
  } catch {
    // null, not 0 — "we did not read it" is not "we gave away nothing".
    totalGivenEgp = null;
  }

  return NextResponse.json({ promoCodes: rows ?? [], totalGivenEgp });
}

export async function POST(request: NextRequest) {
  const ctx = await getAdminContext(request);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const denied = requireAdminRole(ctx, ['super_admin', 'admin']);
  if (denied) return denied;

  if (!validateCSRFRequest(request, ctx.userId)) {
    return NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 });
  }

  let body: {
    code?: unknown;
    discountPct?: unknown;
    maxUsesTotal?: unknown;
    expiresAt?: unknown;
  };
  try {
    body = (await parseBodyWithLimit(request, 8192)) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const rawCode = typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';
  if (!rawCode || !/^[A-Z0-9_-]{2,32}$/.test(rawCode)) {
    return NextResponse.json(
      { error: 'code must be 2-32 uppercase alphanumeric characters (A-Z, 0-9, _, -)' },
      { status: 400 },
    );
  }

  const discountPct =
    typeof body.discountPct === 'number' ? body.discountPct : Number(body.discountPct);
  if (!Number.isFinite(discountPct) || discountPct < 1 || discountPct > 100) {
    return NextResponse.json(
      { error: 'discountPct must be an integer between 1 and 100' },
      { status: 400 },
    );
  }

  let maxUsesTotal: number | null = null;
  if (body.maxUsesTotal !== undefined && body.maxUsesTotal !== null && body.maxUsesTotal !== '') {
    const n = Number(body.maxUsesTotal);
    if (!Number.isFinite(n) || n < 1 || !Number.isInteger(n)) {
      return NextResponse.json(
        { error: 'maxUsesTotal must be a positive integer or omitted for unlimited' },
        { status: 400 },
      );
    }
    maxUsesTotal = n;
  }

  let expiresAt: string | null = null;
  if (typeof body.expiresAt === 'string' && body.expiresAt.trim()) {
    const d = new Date(body.expiresAt.trim());
    if (Number.isNaN(d.getTime())) {
      return NextResponse.json({ error: 'expiresAt must be a valid ISO date string' }, { status: 400 });
    }
    expiresAt = d.toISOString();
  }

  const { data: inserted, error: insertErr } = await ctx.supabaseAdmin
    .from('promo_codes')
    .insert({
      code: rawCode,
      discount_pct: Math.round(discountPct),
      max_uses_total: maxUsesTotal,
      expires_at: expiresAt,
      is_active: true,
      created_by: ctx.userId,
    })
    .select()
    .single();

  if (insertErr) {
    if (insertErr.code === '23505') {
      return NextResponse.json({ error: 'A promo code with this code already exists' }, { status: 409 });
    }
    console.error('[POST /api/admin/promo-codes]', insertErr);
    return NextResponse.json({ error: 'Failed to create promo code' }, { status: 500 });
  }

  try {
    await ctx.supabaseAdmin.from('audit_log').insert({
      user_id: ctx.userId,
      action: 'promo_code_created',
      details: { code: rawCode, discountPct: Math.round(discountPct) },
    });
  } catch (auditErr) {
    console.error('[POST /api/admin/promo-codes] audit_log', auditErr);
  }

  return NextResponse.json({ promoCode: inserted }, { status: 201 });
}

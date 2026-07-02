import { NextRequest, NextResponse } from 'next/server';
import { parseBodyWithLimit } from '@/lib/validate';
import { getAdminContext, requireAdminRole } from '@/lib/admin-auth';
import { validateCSRFRequest } from '@/lib/csrf';

export async function GET(request: NextRequest) {
  try {
    const ctx = await getAdminContext(request);
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    // PDPL: referrals data carries centre names + commission amounts.
    // accountant-and-above only.
    const denied = requireAdminRole(ctx, ['super_admin', 'admin', 'internal_admin', 'accountant']);
    if (denied) return denied;

    const { data: referrals } = await ctx.supabaseAdmin
      .from('referrals')
      .select('id, referrer_center_id, referred_center_id, referral_code, status, created_at')
      .order('created_at', { ascending: false });

    const refIds = [...new Set((referrals || []).flatMap((r: { referrer_center_id: string; referred_center_id: string }) => [r.referrer_center_id, r.referred_center_id]))];
    const { data: centers } = refIds.length > 0
      ? await ctx.supabaseAdmin.from('centers').select('id, name').in('id', refIds)
      : { data: [] };
    const centerMap = new Map((centers || []).map((c: { id: string; name: string }) => [c.id, c.name]));

    const allReferrals = (referrals || []).map((r: { referrer_center_id: string; referred_center_id: string; referral_code: string; status: string; created_at: string }) => ({
      ...r,
      referrer_name: centerMap.get(r.referrer_center_id) ?? ',',
      referred_name: centerMap.get(r.referred_center_id) ?? ',',
    }));

    const { data: withdrawableCommissions } = await ctx.supabaseAdmin
      .from('referral_commissions')
      .select('id, referrer_center_id, commission_amount, period_month')
      .eq('status', 'withdrawable');

    const byReferrer: Record<string, { total: number; centerId: string }> = {};
    for (const c of withdrawableCommissions || []) {
      const id = (c as { referrer_center_id: string }).referrer_center_id;
      if (!byReferrer[id]) byReferrer[id] = { total: 0, centerId: id };
      byReferrer[id].total += Number((c as { commission_amount: number }).commission_amount || 0);
    }

    const referrerIds = Object.keys(byReferrer);
    const { data: referrerCenters } = referrerIds.length > 0
      ? await ctx.supabaseAdmin.from('centers').select('id, name, referral_code').in('id', referrerIds)
      : { data: [] };
    const referrerMap = new Map((referrerCenters || []).map((c: { id: string; name: string; referral_code: string }) => [c.id, { name: c.name, code: c.referral_code }]));

    const pendingPayouts = referrerIds.map((id) => ({
      center_id: id,
      center_name: referrerMap.get(id)?.name ?? ',',
      code: referrerMap.get(id)?.code ?? ',',
      amount: byReferrer[id].total,
    }));

    return NextResponse.json({ referrals: allReferrals, pendingPayouts });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await getAdminContext(request);
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    // M1: marks referral_commissions paid (money mutation) — was gated only on
    // "any admin row exists". Restrict to super_admin/accountant and require CSRF.
    const denied = requireAdminRole(ctx, ['super_admin', 'accountant']);
    if (denied) return denied;
    if (!validateCSRFRequest(request, ctx.userId)) {
      return NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 });
    }

    const body = (await parseBodyWithLimit(request, 65536)) as Record<string, unknown>;
    const { action, referrer_center_id } = body;
    if (action !== 'mark_paid' || !referrer_center_id) {
      return NextResponse.json({ error: 'Invalid action or referrer_center_id' }, { status: 400 });
    }

    const now = new Date().toISOString();
    const { error } = await ctx.supabaseAdmin
      .from('referral_commissions')
      .update({ status: 'paid', paid_at: now })
      .eq('referrer_center_id', referrer_center_id)
      .eq('status', 'withdrawable');

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
  }
}

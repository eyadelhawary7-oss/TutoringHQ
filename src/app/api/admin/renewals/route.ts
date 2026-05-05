import { NextResponse } from 'next/server';
import { getAdminContext } from '@/lib/admin-auth';
import { customPermissionsToKeys, fetchAdminAccessFlags } from '@/lib/admin-access';
import { getAdminPermissions } from '@/lib/admin-roles';
import { validateCSRFRequest } from '@/lib/csrf';
import { parseBodyWithLimit } from '@/lib/validate';

function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

const PERIOD_MONTHS: Record<string, number> = {
  monthly: 1,
  quarterly: 3,
  biannual: 6,
  yearly: 12,
};

interface RenewalRow {
  id?: string;
  name?: string;
  phone?: string | null;
  subscription_start_date?: string | null;
  subscription_renewal_date?: string | null;
  subscription_billing_period?: string | null;
  subscription_monthly_fee?: number | string | null;
  subscription_status?: string | null;
  daysUntil: number;
  renewalDate: string;
}

export async function GET(request: Request) {
  try {
    const ctx = await getAdminContext(request);
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { supabaseAdmin, userId } = ctx;
    const { data: au } = await supabaseAdmin
      .from('admin_users')
      .select('role, custom_permissions')
      .eq('id', userId)
      .maybeSingle();
    const flags = await fetchAdminAccessFlags(supabaseAdmin, userId);
    const effRole = flags.isSuperAdmin ? 'super_admin' : (au?.role ?? 'internal_viewer');
    const keys = customPermissionsToKeys(au?.custom_permissions);
    const perms = getAdminPermissions(effRole, keys);
    if (!flags.canApproveSignups && !perms.includes('renewals')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const url = new URL(request.url);
    const filter = url.searchParams.get('filter') || 'all'; // all | this_week | this_month | overdue

    const { data: centers, error } = await supabaseAdmin
      .from('centers')
      .select(`
        id,
        name,
        phone,
        subscription_start_date,
        subscription_renewal_date,
        subscription_billing_period,
        subscription_monthly_fee,
        subscription_status
      `)
      .in('subscription_status', ['active', 'overdue', 'suspended'])
      .not('subscription_renewal_date', 'is', null)
      .order('subscription_renewal_date', { ascending: true });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const today = new Date();
    today.setHours(12, 0, 0, 0);

    const weekEnd = new Date(today);
    weekEnd.setDate(weekEnd.getDate() + 7);
    const monthEnd = new Date(today);
    monthEnd.setMonth(monthEnd.getMonth() + 1);

    const rows: RenewalRow[] = (centers || []).map((c: Record<string, unknown>) => {
      const renewalStr = c.subscription_renewal_date as string;
      const renewal = renewalStr ? new Date(renewalStr + 'T12:00:00') : null;
      const diffMs = renewal ? renewal.getTime() - today.getTime() : 0;
      const daysUntil = Math.round(diffMs / (24 * 60 * 60 * 1000));
      const monthlyFee = Number(c.subscription_monthly_fee ?? 0);
      return {
        ...c,
        daysUntil,
        renewalDate: renewalStr,
      } as RenewalRow;
    });

    let filtered = rows;
    if (filter === 'this_week') {
      filtered = rows.filter((r) => {
        const d = r.daysUntil;
        return d >= 0 && d <= 7;
      });
    } else if (filter === 'this_month') {
      filtered = rows.filter((r) => {
        const d = r.daysUntil;
        return d >= 0 && d <= 31;
      });
    } else if (filter === 'overdue') {
      filtered = rows.filter((r) => r.daysUntil < 0);
    }

    const renewalsThisWeek = rows.filter((r) => r.daysUntil >= 0 && r.daysUntil <= 7).length;
    const overdueCount = rows.filter((r) => r.daysUntil < 0).length;
    const mrrAtRisk = rows
      .filter((r) => r.daysUntil < 0)
      .reduce((sum, r) => sum + Number(r.subscription_monthly_fee ?? 0), 0);

    return NextResponse.json({
      centers: filtered,
      summary: { renewalsThisWeek, overdueCount, mrrAtRisk },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await getAdminContext(request);
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!validateCSRFRequest(request, ctx.userId)) {
      return NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 });
    }

    const { supabaseAdmin, userId } = ctx;
    const body = (await parseBodyWithLimit(request, 65536)) as Record<string, unknown>;
    const centerId = body.center_id as string | undefined;
    const amount = body.amount as number | undefined;
    const paymentMethod = (body.payment_method as string) || 'bank_transfer';
    const notes = (body.notes as string) || '';

    if (!centerId || typeof amount !== 'number' || amount <= 0) {
      return NextResponse.json({ error: 'center_id and amount required' }, { status: 400 });
    }

    const { data: center, error: centerErr } = await supabaseAdmin
      .from('centers')
      .select('id, name, subscription_renewal_date, subscription_billing_period')
      .eq('id', centerId)
      .single();

    if (centerErr || !center) {
      return NextResponse.json({ error: 'Center not found' }, { status: 404 });
    }

    const period = (center as { subscription_billing_period?: string }).subscription_billing_period ?? 'quarterly';
    const months = PERIOD_MONTHS[period] ?? 3;
    const renewalDate = (center as { subscription_renewal_date?: string }).subscription_renewal_date;
    const baseDate = renewalDate ? new Date(renewalDate + 'T12:00:00') : new Date();
    const nextRenewal = addMonths(baseDate, months);

    const { error: insertErr } = await supabaseAdmin.from('renewal_history').insert({
      center_id: centerId,
      renewal_date: baseDate.toISOString().slice(0, 10),
      amount_paid: amount,
      payment_method: paymentMethod,
      recorded_by: userId,
      notes: notes || null,
    });

    if (insertErr) {
      return NextResponse.json({ error: insertErr.message }, { status: 500 });
    }

    const nextRenewalStr = nextRenewal.toISOString().slice(0, 10);
    await supabaseAdmin
      .from('centers')
      .update({
        subscription_renewal_date: nextRenewalStr,
        subscription_status: 'active',
        subscription_start_date: baseDate.toISOString().slice(0, 10),
        next_payment_due: nextRenewalStr,
        payment_due_date: nextRenewalStr,
        last_payment_date: new Date().toISOString().slice(0, 10),
        billing_status: 'paid',
        status: 'active',
      })
      .eq('id', centerId);

    try {
      await supabaseAdmin.from('audit_log').insert({
        center_id: centerId,
        user_id: userId,
        action: 'renewal_payment_recorded',
        entity_type: 'renewal_history',
        details: { amount, payment_method: paymentMethod, next_renewal: nextRenewalStr },
      });
    } catch {
      // ignore
    }

    return NextResponse.json({ success: true, nextRenewalDate: nextRenewalStr });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

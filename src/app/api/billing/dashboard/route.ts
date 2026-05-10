import { NextRequest, NextResponse } from 'next/server';
import { requireCenterAuth } from '@/lib/centerAuth';
import { PLANS, type PlanKey, isPlanKey } from '@/lib/pricing';
import { getSubscriptionGracePeriodDays } from '@/lib/billingGrace';
import { todayISO } from '@/lib/parentPack';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireCenterAuth(request);
  if (!auth.ok) return auth.response;
  if (auth.role !== 'owner') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const pageParam = request.nextUrl.searchParams.get('page');
  const page = Math.max(1, parseInt(pageParam || '1', 10) || 1);
  const perPage = Math.min(
    50,
    Math.max(1, parseInt(request.nextUrl.searchParams.get('limit') || '12', 10) || 12),
  );
  const from = (page - 1) * perPage;

  const t = todayISO();
  const monthStart = `${t.slice(0, 7)}-01T00:00:00.000Z`;

  const [graceDays, centerRes, countRes, invRes, blastRes] = await Promise.all([
    getSubscriptionGracePeriodDays(auth.supabaseAdmin),
    auth.supabaseAdmin
      .from('centers')
      .select(
        `id, plan, billing_period, subscription_billing_period, billing_type, pricing_type,
        status, subscription_status, billing_status, next_payment_due, auto_suspend_at,
        billing_amount, all_in_price, is_early_adopter, early_adopter_price,
        weekly_student_limit, parent_pack_enabled, parent_pack_active_parents,
        pack_price_per_parent, announcement_balance`,
      )
      .eq('id', auth.centerId)
      .maybeSingle(),
    auth.supabaseAdmin
      .from('students')
      .select('id', { count: 'exact', head: true })
      .eq('center_id', auth.centerId),
    auth.supabaseAdmin
      .from('invoices')
      .select(
        'id, invoice_number, invoice_type, total_amount, status, created_at, due_date',
        { count: 'exact' },
      )
      .eq('center_id', auth.centerId)
      .order('created_at', { ascending: false })
      .range(from, from + perPage - 1),
    auth.supabaseAdmin
      .from('announcement_blasts')
      .select('id, parents_notified, total_amount, created_at')
      .eq('center_id', auth.centerId)
      .gte('created_at', monthStart)
      .order('created_at', { ascending: false })
      .limit(50),
  ]);

  if (!centerRes.data) {
    return NextResponse.json({ error: 'Center not found' }, { status: 404 });
  }

  const c = centerRes.data as Record<string, unknown>;
  const planRaw = String(c.plan ?? 'starter');
  const planKey: PlanKey = isPlanKey(planRaw) ? planRaw : 'starter';
  const planCfg = PLANS[planKey];
  const weeklyCap =
    typeof c.weekly_student_limit === 'number' && Number.isFinite(c.weekly_student_limit)
      ? Number(c.weekly_student_limit)
      : planCfg?.weeklyStudentLimit ?? 0;

  const { data: payInv } = await auth.supabaseAdmin
    .from('invoices')
    .select('id, total_amount')
    .eq('center_id', auth.centerId)
    .eq('invoice_type', 'subscription')
    .in('status', ['pending', 'overdue'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const payNowInvoiceId =
    payInv && typeof (payInv as { id?: string }).id === 'string'
      ? (payInv as { id: string }).id
      : null;
  const payNowAmount =
    payInv && (payInv as { total_amount?: unknown }).total_amount != null
      ? Number((payInv as { total_amount: number }).total_amount)
      : Number(c.billing_amount ?? 0) || 0;

  let cardOrdersSummary: { openPipeline: number } = { openPipeline: 0 };
  try {
    const { data: ord } = await auth.supabaseAdmin
      .from('card_orders')
      .select('status')
      .eq('center_id', auth.centerId);
    const terminal = new Set(['delivered', 'issued', 'cancelled', 'refunded', 'failed']);
    for (const row of ord ?? []) {
      const st = String((row as { status?: string }).status ?? '').toLowerCase();
      if (!terminal.has(st)) cardOrdersSummary.openPipeline += 1;
    }
  } catch {
    /* optional */
  }

  const studentCount = countRes.count ?? 0;

  let blastMonthTotal = 0;
  let blastParents = 0;
  for (const b of blastRes.data ?? []) {
    blastMonthTotal += Number((b as { total_amount?: unknown }).total_amount ?? 0);
    blastParents += Number((b as { parents_notified?: unknown }).parents_notified ?? 0);
  }

  const invoices = (invRes.data ?? []) as Record<string, unknown>[];
  const totalInvoices = invRes.count ?? invoices.length;

  return NextResponse.json({
    gracePeriodDays: graceDays,
    center: {
      plan: planKey,
      billing_period: c.billing_period ?? c.subscription_billing_period ?? null,
      status: c.status,
      subscription_status: c.subscription_status,
      billing_status: c.billing_status,
      next_payment_due: c.next_payment_due,
      auto_suspend_at: c.auto_suspend_at,
      billing_amount: c.billing_amount != null ? Number(c.billing_amount) : null,
      all_in_price: c.all_in_price != null ? Number(c.all_in_price) : null,
      is_early_adopter: !!c.is_early_adopter,
      early_adopter_price: c.early_adopter_price != null ? Number(c.early_adopter_price) : null,
      weekly_student_limit: weeklyCap,
      parent_pack_enabled: !!c.parent_pack_enabled,
      parent_pack_active_parents:
        c.parent_pack_active_parents != null ? Number(c.parent_pack_active_parents) : 0,
      pack_price_per_parent:
        c.pack_price_per_parent != null ? Number(c.pack_price_per_parent) : 12,
      announcement_balance:
        c.announcement_balance != null ? Number(c.announcement_balance) : 0,
    },
    studentCount,
    payNowInvoiceId,
    payNowAmount,
    invoices,
    invoicePagination: {
      page,
      perPage,
      total: totalInvoices,
      totalPages: Math.max(1, Math.ceil(totalInvoices / perPage)),
    },
    addons: {
      blastMonthParents: blastParents,
      blastMonthSpend: blastMonthTotal,
      cardOrders: cardOrdersSummary,
    },
  });
}

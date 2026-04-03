import { NextResponse } from 'next/server';
import { getAdminContext } from '@/lib/admin-auth';
import { adminPlanRequestsSchema } from '@/lib/validations';
import { validateCSRFRequest } from '@/lib/csrf';
import { PLANS, getPlanPrice, isPlanKey, type PlanKey } from '@/lib/pricing';
import { todayISO } from '@/lib/parentPack';

function planPriceMonthly(plan: string | undefined, isEarly: boolean, earlyPrice: number | undefined): number {
  if (isEarly && typeof earlyPrice === 'number') return getChargeApproxFromEarlyBase(earlyPrice);
  const k = (plan || 'starter').toLowerCase();
  if (k === 'payg') return 0;
  if (!isPlanKey(k) || k === 'top_centers') return 0;
  return getPlanPrice(k, 'monthly');
}

/** Legacy early_adopter_price treated as quarterly all-in → monthly all-in display. */
function getChargeApproxFromEarlyBase(quarterlyBase: number): number {
  return Math.round(quarterlyBase * 1.15);
}

function calendarAddDays(baseYmd: string, delta: number): string {
  const [y, m, d] = baseYmd.split('-').map((x) => parseInt(x, 10));
  const t = Date.UTC(y, m - 1, d + delta);
  const dt = new Date(t);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

export async function GET(request: Request) {
  try {
    const ctx = await getAdminContext(request);
    if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const { supabaseAdmin } = ctx;

    const { data: requests, error } = await supabaseAdmin
      .from('plan_requests')
      .select(`
        id, center_id, current_plan, requested_plan, status,
        requested_at, approved_at, rejected_at, notes
      `)
      .order('requested_at', { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const centerIds = [...new Set((requests || []).map((r: { center_id: string }) => r.center_id))];
    const { data: centers } = await supabaseAdmin
      .from('centers')
      .select('id, name, phone, is_early_adopter, early_adopter_price')
      .in('id', centerIds);

    const centerMap = new Map((centers || []).map((c: { id: string; name: string; phone?: string; is_early_adopter?: boolean; early_adopter_price?: number }) => [c.id, c]));

    const rows = (requests || []).map((r: { center_id: string; current_plan?: string; requested_plan?: string; [k: string]: unknown }) => {
      const center = centerMap.get(r.center_id);
      const ea = !!(center?.is_early_adopter && typeof center?.early_adopter_price === 'number');
      const ep = center?.early_adopter_price;
      const currentPrice = planPriceMonthly(r.current_plan as string, ea, ep);
      const requestedPrice = planPriceMonthly(r.requested_plan as string, false, undefined);
      const priceDiff = requestedPrice - currentPrice;
      return {
        ...r,
        centerName: center?.name ?? '—',
        centerPhone: center?.phone ?? null,
        currentPrice,
        requestedPrice,
        priceDiff,
        priceDiffFormatted: priceDiff > 0 ? `+${priceDiff.toLocaleString('en-US')} EGP/mo` : priceDiff < 0 ? `${priceDiff.toLocaleString('en-US')} EGP/mo` : '—',
      };
    });

    return NextResponse.json({ requests: rows });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

export async function PUT(request: Request) {
  try {
    const ctx = await getAdminContext(request);
    if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    if (!validateCSRFRequest(request, ctx.userId)) {
      return NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 });
    }

    const { supabaseAdmin, userId } = ctx;
    const body = await request.json();
    const parsed = adminPlanRequestsSchema.safeParse(body);
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? 'Invalid input';
      return NextResponse.json({ error: msg, details: parsed.error.flatten() }, { status: 400 });
    }
    const { requestId, action, notes } = parsed.data;

    const { data: pr, error: fetchErr } = await supabaseAdmin
      .from('plan_requests')
      .select('id, center_id, current_plan, requested_plan, status')
      .eq('id', requestId)
      .single();

    if (fetchErr || !pr || pr.status !== 'pending') {
      return NextResponse.json({ error: 'Request not found or not pending' }, { status: 404 });
    }

    const now = new Date().toISOString();

    if (action === 'reject') {
      await supabaseAdmin
        .from('plan_requests')
        .update({ status: 'rejected', rejected_at: now, notes: notes || null })
        .eq('id', requestId);

      try {
        await supabaseAdmin.from('audit_log').insert({
          center_id: pr.center_id,
          user_id: userId,
          action: 'admin_plan_request_rejected',
          entity_type: 'plan_requests',
          details: { request_id: requestId, requested_plan: pr.requested_plan },
        });
      } catch {
        // ignore
      }

      return NextResponse.json({ success: true, action: 'rejected' });
    }

    const { data: centerRow, error: centerErr } = await supabaseAdmin
      .from('centers')
      .select('phone, billing_amount, next_payment_due, center_code, referral_code')
      .eq('id', pr.center_id)
      .single();

    if (centerErr || !centerRow) {
      return NextResponse.json({ error: 'Center not found' }, { status: 404 });
    }

    const rp = (pr.requested_plan as string) || '';
    const { data: planRow, error: planErr } = await supabaseAdmin
      .from('pricing_plans')
      .select('all_in_price')
      .eq('id', rp)
      .maybeSingle();

    if (planErr) {
      return NextResponse.json({ error: planErr.message }, { status: 500 });
    }

    const requestedAllIn = (planRow as { all_in_price?: number | null } | null)?.all_in_price;
    if (requestedAllIn == null) {
      return NextResponse.json({ error: 'Custom pricing required' }, { status: 400 });
    }

    const currentBilling = Number((centerRow as { billing_amount?: number | null }).billing_amount ?? 0);
    const difference = Number(requestedAllIn) - currentBilling;

    if (difference <= 0) {
      await supabaseAdmin
        .from('plan_requests')
        .update({ status: 'pending_downgrade', notes: notes || null })
        .eq('id', requestId);

      try {
        await supabaseAdmin.from('audit_log').insert({
          center_id: pr.center_id,
          user_id: userId,
          action: 'admin_plan_request_pending_downgrade',
          entity_type: 'plan_requests',
          details: { request_id: requestId, requested_plan: pr.requested_plan, difference },
        });
      } catch {
        // ignore
      }

      return NextResponse.json({
        success: true,
        action: 'pending_downgrade',
        message: 'No upgrade charge; marked as pending downgrade for follow-up.',
      });
    }

    const todayStr = todayISO();
    const npd = (centerRow as { next_payment_due?: string | null }).next_payment_due;
    const billingPeriodEnd = npd ?? calendarAddDays(todayStr, 90);
    const code =
      ((centerRow as { center_code?: string | null }).center_code ||
        (centerRow as { referral_code?: string | null }).referral_code ||
        'UNK')
        .toString()
        .replace(/\s+/g, '') || 'UNK';
    const yyyymm = todayStr.slice(0, 7);
    const invoiceNumber = `UPG-${code}-${yyyymm}`;

    const { error: invErr } = await supabaseAdmin.from('invoices').insert({
      center_id: pr.center_id,
      invoice_number: invoiceNumber,
      invoice_type: 'plan_upgrade_difference',
      status: 'pending',
      total_amount: difference,
      base_amount: difference,
      billing_period_start: todayStr,
      billing_period_end: billingPeriodEnd,
      due_date: todayStr,
    });

    if (invErr) {
      return NextResponse.json({ error: invErr.message }, { status: 500 });
    }

    await supabaseAdmin
      .from('plan_requests')
      .update({ status: 'pending_payment', notes: notes || null })
      .eq('id', requestId);

    try {
      await supabaseAdmin.from('audit_log').insert({
        center_id: pr.center_id,
        user_id: userId,
        action: 'admin_plan_request_pending_payment',
        entity_type: 'plan_requests',
        details: {
          request_id: requestId,
          old_plan: pr.current_plan,
          new_plan: pr.requested_plan,
          difference,
          invoice_number: invoiceNumber,
        },
      });
    } catch {
      // ignore
    }

    const PLAN_LABELS: Record<string, string> = {
      starter: 'Starter',
      pro: 'Pro',
      business: 'Business',
      enterprise: 'Enterprise',
      top_centers: 'Top Centers',
      payg: 'PAYG',
    };
    const requestedLabel = PLAN_LABELS[rp] || rp;
    const phone = ((centerRow as { phone?: string }).phone || '').trim();
    const waMessage = `مرحباً، تمت الموافقة على ترقية خطتك إلى ${requestedLabel}. يرجى سداد فرق الترقية (${difference.toLocaleString('en-US')} ج.م) من صفحة الفواتير لإكمال التفعيل.`;
    const waLink = phone
      ? `https://wa.me/${phone.startsWith('+') ? phone.slice(1).replace(/\D/g, '') : '20' + phone.replace(/^0/, '').replace(/\D/g, '')}?text=${encodeURIComponent(waMessage)}`
      : null;

    return NextResponse.json({
      success: true,
      action: 'pending_payment',
      centerPhone: phone || null,
      whatsappLink: waLink,
      invoiceNumber,
      difference,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

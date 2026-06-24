import { NextRequest, NextResponse } from 'next/server';
import { requireTeacherAuth } from '@/lib/centerAuth';
import { remainingBalance, round2 } from '@/lib/invoiceBalance';
import { computeUpcomingForecast } from '@/lib/billingForecast';
import { getProcessingFeeConfig } from '@/lib/pricingConfig';
import { resolveProcessingFeeAmount } from '@/lib/processingFee';

export const dynamic = 'force-dynamic';

/** Teacher invoice types a teacher can see/pay on her billing page. */
const PAYABLE_TYPES = ['subscription'];

/** Statuses that mean "still owed" (action required). */
const UNPAID_STATUSES = ['pending', 'overdue', 'failed'];

type InvoiceRow = {
  id: string;
  invoice_number: string | null;
  invoice_type: string | null;
  total_amount: number | string | null;
  amount_received: number | string | null;
  billing_period_start: string | null;
  billing_period_end: string | null;
  status: string | null;
  created_at: string | null;
  paid_at: string | null;
  due_date: string | null;
  metadata: { processing_fee?: number | string | null } | null;
};

function feeOf(row: InvoiceRow): number {
  const raw = row.metadata?.processing_fee;
  const n = Number(raw ?? 0);
  return Number.isFinite(n) && n > 0 ? round2(n) : 0;
}

/**
 * Teacher billing surface (parity with the center /api/billing/customer-invoices):
 * three buckets in one payload, scoped to the authenticated teacher.
 *  - unpaid:   action-required invoices, with the REMAINING balance (underpayment).
 *  - paid:     reverse-chronological history (receipts).
 *  - upcoming: a FORECAST of the next charge — never a persisted invoice.
 *
 * Uses requireTeacherAuth (NOT the private-access gate) so a lapsed/free-tier
 * teacher can still load and pay her invoice to restore the private engine.
 */
export async function GET(request: NextRequest) {
  const auth = await requireTeacherAuth(request);
  if (!auth.ok) return auth.response;

  const supabase = auth.supabaseAdmin;

  const [{ data: unpaidData, error: unpaidErr }, { data: paidData, error: paidErr }, { data: subData }] =
    await Promise.all([
      supabase
        .from('invoices')
        .select(
          'id, invoice_number, invoice_type, total_amount, amount_received, billing_period_start, billing_period_end, status, created_at, paid_at, due_date, metadata',
        )
        .eq('owner_type', 'teacher')
        .eq('teacher_id', auth.userId)
        .in('invoice_type', PAYABLE_TYPES)
        .in('status', UNPAID_STATUSES)
        .order('due_date', { ascending: true })
        .limit(50),
      supabase
        .from('invoices')
        .select(
          'id, invoice_number, invoice_type, total_amount, amount_received, billing_period_start, billing_period_end, status, created_at, paid_at, due_date, metadata',
        )
        .eq('owner_type', 'teacher')
        .eq('teacher_id', auth.userId)
        .eq('status', 'paid')
        .order('paid_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(24),
      supabase
        .from('teacher_subscriptions')
        .select('status, next_billing_at, price_gross')
        .eq('teacher_id', auth.userId)
        .maybeSingle(),
    ]);

  if (unpaidErr || paidErr) {
    console.error('[teacher/billing/customer-invoices]', unpaidErr ?? paidErr);
    return NextResponse.json({ error: (unpaidErr ?? paidErr)?.message ?? 'Error' }, { status: 500 });
  }

  const unpaid = ((unpaidData as InvoiceRow[]) ?? []).map((r) => {
    const total = round2(Number(r.total_amount ?? 0));
    const received = round2(Number(r.amount_received ?? 0));
    const remaining = remainingBalance(total, received);
    return {
      id: r.id,
      invoiceNumber: r.invoice_number,
      invoiceType: r.invoice_type,
      status: r.status,
      total,
      amountReceived: received,
      remaining,
      processingFee: feeOf(r),
      partial: received > 0,
      billingPeriodStart: r.billing_period_start,
      billingPeriodEnd: r.billing_period_end,
      dueDate: r.due_date,
      createdAt: r.created_at,
    };
  });

  const paid = ((paidData as InvoiceRow[]) ?? []).map((r) => ({
    id: r.id,
    invoiceNumber: r.invoice_number,
    invoiceType: r.invoice_type,
    status: r.status,
    total: round2(Number(r.total_amount ?? 0)),
    processingFee: feeOf(r),
    paidAt: r.paid_at,
    createdAt: r.created_at,
    billingPeriodStart: r.billing_period_start,
    billingPeriodEnd: r.billing_period_end,
  }));

  // Upcoming forecast — computed from the teacher subscription, never persisted.
  // Only an active/trialing subscription has a next scheduled charge; a lapsed
  // teacher sees just her unpaid invoice (no forecast).
  const subscription = (subData as {
    status?: string | null;
    next_billing_at?: string | null;
    price_gross?: number | null;
  } | null) ?? null;

  let feeAmount = 0;
  try {
    feeAmount = resolveProcessingFeeAmount(await getProcessingFeeConfig());
  } catch {
    feeAmount = 0;
  }

  const subActive = !!subscription && (subscription.status === 'active' || subscription.status === 'trialing');
  const upcoming = computeUpcomingForecast({
    nextPaymentDue: subscription?.next_billing_at ?? null,
    billingAmount: subscription?.price_gross ?? null,
    processingFee: feeAmount,
    subscriptionActive: subActive,
  });

  return NextResponse.json({ unpaid, paid, upcoming });
}

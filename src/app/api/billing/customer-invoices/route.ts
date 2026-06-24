import { NextRequest, NextResponse } from 'next/server';
import { requireCenterAuth } from '@/lib/centerAuth';
import { remainingBalance, round2 } from '@/lib/invoiceBalance';
import { computeUpcomingForecast } from '@/lib/billingForecast';
import { getProcessingFeeConfig } from '@/lib/pricingConfig';
import { resolveProcessingFeeAmount } from '@/lib/processingFee';

export const dynamic = 'force-dynamic';

/** Invoice types a customer can see/pay on the invoices page. */
const PAYABLE_TYPES = [
  'subscription',
  'plan_upgrade_difference',
  'pack_billing',
  'announcement_settlement',
  'late_payment_fee',
  'reactivation_fee',
];

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
 * The single customer billing surface (Phase 3): three buckets in one payload.
 *  - unpaid:   action-required invoices, with the REMAINING balance (Phase 5).
 *  - paid:     reverse-chronological history.
 *  - upcoming: a FORECAST preview of the next charge — never a persisted invoice.
 */
export async function GET(request: NextRequest) {
  const auth = await requireCenterAuth(request);
  if (!auth.ok) return auth.response;
  if (auth.role !== 'owner') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const supabase = auth.supabaseAdmin;

  const [{ data: unpaidData, error: unpaidErr }, { data: paidData, error: paidErr }, { data: centerData }] =
    await Promise.all([
      supabase
        .from('invoices')
        .select(
          'id, invoice_number, invoice_type, total_amount, amount_received, billing_period_start, billing_period_end, status, created_at, paid_at, due_date, metadata',
        )
        .eq('center_id', auth.centerId)
        .in('invoice_type', PAYABLE_TYPES)
        .in('status', UNPAID_STATUSES)
        .order('due_date', { ascending: true })
        .limit(50),
      supabase
        .from('invoices')
        .select(
          'id, invoice_number, invoice_type, total_amount, amount_received, billing_period_start, billing_period_end, status, created_at, paid_at, due_date, metadata',
        )
        .eq('center_id', auth.centerId)
        .eq('status', 'paid')
        .order('paid_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(24),
      supabase
        .from('centers')
        .select('billing_amount, next_payment_due, billing_type, status')
        .eq('id', auth.centerId)
        .maybeSingle(),
    ]);

  if (unpaidErr || paidErr) {
    console.error('[billing/customer-invoices]', unpaidErr ?? paidErr);
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

  // Upcoming forecast — computed, never persisted as an invoice.
  const center = (centerData as {
    billing_amount?: number | null;
    next_payment_due?: string | null;
    billing_type?: string | null;
    status?: string | null;
  } | null) ?? null;

  let feeAmount = 0;
  try {
    feeAmount = resolveProcessingFeeAmount(await getProcessingFeeConfig());
  } catch {
    feeAmount = 0;
  }

  const upcoming = computeUpcomingForecast({
    nextPaymentDue: center?.next_payment_due ?? null,
    billingAmount: center?.billing_amount ?? null,
    processingFee: feeAmount,
    subscriptionActive:
      !!center && center.status !== 'cancelled' && center.billing_type !== 'payg',
  });

  return NextResponse.json({ unpaid, paid, upcoming });
}

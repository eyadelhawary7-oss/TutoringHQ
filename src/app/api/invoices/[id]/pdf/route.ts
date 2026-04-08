import { NextRequest, NextResponse } from 'next/server';
import { requireCenterAuth } from '@/lib/centerAuth';
import { generateInvoicePdf, type InvoiceData } from '@/lib/generateInvoicePdf';

export const dynamic = 'force-dynamic';

function fmtDateEn(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso.includes('T') ? iso : `${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function fmtMonthYearYmd(ymd: string | null | undefined): string {
  if (!ymd) return '—';
  const d = new Date(`${ymd}T12:00:00`);
  if (Number.isNaN(d.getTime())) return ymd;
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

function billingPeriodSummary(start: string | null | undefined, end: string | null | undefined): string {
  if (!start || !end) return '—';
  return `${fmtMonthYearYmd(start)} – ${fmtMonthYearYmd(end)}`;
}

function normalizePdfStatus(raw: string | null | undefined): InvoiceData['status'] {
  const s = (raw ?? '').toLowerCase();
  if (s === 'paid' || s === 'approved') return 'paid';
  if (s === 'overdue') return 'overdue';
  if (s === 'failed' || s === 'rejected' || s === 'cancelled' || s === 'canceled') return 'failed';
  return 'pending';
}

function planPresentation(planRaw: string | null | undefined): { planName: string; planNameAr: string } {
  const k = (planRaw ?? 'starter').toLowerCase().replace(/-/g, '_');
  const table: Record<string, { planName: string; planNameAr: string }> = {
    nano: { planName: 'Nano', planNameAr: 'ناشئ' },
    starter: { planName: 'Starter', planNameAr: 'أساسي' },
    pro: { planName: 'Pro', planNameAr: 'محترف' },
    business: { planName: 'Business', planNameAr: 'أعمال' },
    enterprise: { planName: 'Enterprise', planNameAr: 'مؤسسات' },
    payg: { planName: 'Pay as you go', planNameAr: 'دفع حسب الاستخدام' },
    top_centers: { planName: 'Top Centers', planNameAr: 'مراكز مميزة' },
  };
  const hit = table[k];
  if (hit) return hit;
  const label = (planRaw ?? 'starter').replace(/_/g, ' ');
  const title = label.replace(/\b\w/g, (c) => c.toUpperCase());
  return { planName: title, planNameAr: '—' };
}

function safeFilenamePart(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 80) || 'invoice';
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id: invoiceId } = await context.params;
    if (!invoiceId?.trim()) {
      return NextResponse.json({ error: 'Invalid invoice id' }, { status: 400 });
    }

    const auth = await requireCenterAuth(request);
    if (!auth.ok) return auth.response;
    if (auth.role !== 'owner') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { data: invoice, error: invErr } = await auth.supabaseAdmin
      .from('invoices')
      .select(
        `
        id,
        center_id,
        invoice_number,
        invoice_type,
        total_amount,
        billing_period_start,
        billing_period_end,
        status,
        created_at,
        due_date,
        paid_at,
        payment_method,
        payment_reference,
        paymob_transaction_id
      `,
      )
      .eq('id', invoiceId.trim())
      .maybeSingle();

    if (invErr || !invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }

    const inv = invoice as {
      center_id: string;
      invoice_number: string | null;
      invoice_type: string | null;
      total_amount: number | string | null;
      billing_period_start: string | null;
      billing_period_end: string | null;
      status: string | null;
      created_at: string | null;
      due_date: string | null;
      paid_at: string | null;
      payment_method: string | null;
      payment_reference: string | null;
      paymob_transaction_id: string | null;
    };

    if (inv.center_id !== auth.centerId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { data: center, error: cErr } = await auth.supabaseAdmin
      .from('centers')
      .select('name, phone, city, plan')
      .eq('id', inv.center_id)
      .maybeSingle();

    if (cErr || !center) {
      return NextResponse.json({ error: 'Center not found' }, { status: 404 });
    }

    const c = center as {
      name?: string | null;
      phone?: string | null;
      city?: string | null;
      plan?: string | null;
    };

    const { planName, planNameAr } = planPresentation(c.plan);
    const invNo = String(inv.invoice_number ?? inv.center_id.slice(0, 8));
    const totalAmount = Number(inv.total_amount ?? 0);
    const payRef =
      (inv.payment_reference && String(inv.payment_reference).trim()) ||
      (inv.paymob_transaction_id && String(inv.paymob_transaction_id).trim()) ||
      null;

    const data: InvoiceData = {
      invoiceNumber: invNo,
      invoiceType: String(inv.invoice_type ?? ''),
      status: normalizePdfStatus(inv.status),
      centerName: String(c.name ?? '—'),
      centerPhone: String(c.phone ?? '—'),
      centerCity: String(c.city ?? '—'),
      planName,
      planNameAr,
      billingPeriod: billingPeriodSummary(inv.billing_period_start, inv.billing_period_end),
      billingPeriodStart: fmtDateEn(inv.billing_period_start ?? undefined),
      billingPeriodEnd: fmtDateEn(inv.billing_period_end ?? undefined),
      totalAmount,
      paidAt: inv.paid_at ? fmtDateEn(inv.paid_at) : null,
      paymentMethod: inv.payment_method,
      paymentReference: payRef,
      issuedAt: fmtDateEn(inv.created_at ?? undefined),
      dueDate: fmtDateEn(inv.due_date ?? undefined),
    };

    const pdfBuf = await generateInvoicePdf(data);
    if (!pdfBuf) {
      return NextResponse.json({ error: 'PDF generation failed' }, { status: 500 });
    }

    const fname = safeFilenamePart(invNo);

    return new NextResponse(new Uint8Array(pdfBuf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="INV-${fname}.pdf"`,
      },
    });
  } catch (e) {
    console.error('[invoices/pdf]', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'PDF generation failed' },
      { status: 500 },
    );
  }
}

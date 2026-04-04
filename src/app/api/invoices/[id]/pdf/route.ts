import { NextRequest, NextResponse } from 'next/server';
import { jsPDF } from 'jspdf';
import { requireCenterAuth } from '@/lib/centerAuth';
import { normalizeBillingPeriod, type BillingPeriod } from '@/lib/pricing';

export const dynamic = 'force-dynamic';

const TEAL: [number, number, number] = [13, 148, 136];

function fmtMoney(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function fmtDateYmd(ymd: string | null | undefined): string {
  if (!ymd) return '—';
  const d = new Date(`${ymd}T12:00:00`);
  if (Number.isNaN(d.getTime())) return ymd;
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function billingPeriodLabel(period: BillingPeriod): string {
  switch (period) {
    case 'monthly':
      return 'monthly';
    case 'annual':
      return 'annual';
    case 'quarterly':
    default:
      return 'quarterly';
  }
}

function subscriptionLineDescription(
  invoiceType: string | null | undefined,
  plan: string,
  period: BillingPeriod,
): string {
  const p = plan ? plan.replace(/_/g, ' ') : '—';
  const bp = billingPeriodLabel(period);
  const t = (invoiceType ?? '').toLowerCase();
  if (t === 'plan_upgrade_difference') {
    return `Plan upgrade (prorated) (${p} — ${bp})`;
  }
  if (t === 'pack_billing' || t === 'whatsapp_addon') {
    return `Add-on (${p} — ${bp})`;
  }
  if (t === 'setup_fee') {
    return `Setup fee (${p} — ${bp})`;
  }
  if (t === 'announcement_settlement' || t === 'announcement_cap') {
    return `Announcements (${p} — ${bp})`;
  }
  return `Subscription (${p} — ${bp})`;
}

function watermarkStyle(statusRaw: string | null | undefined): { label: string; rgb: [number, number, number] } {
  const s = (statusRaw ?? '').toLowerCase();
  if (s === 'paid' || s === 'approved') {
    return { label: 'PAID', rgb: [22, 163, 74] };
  }
  if (s === 'overdue') {
    return { label: 'OVERDUE', rgb: [220, 38, 38] };
  }
  if (s === 'cancelled' || s === 'canceled') {
    return { label: 'CANCELLED', rgb: [107, 114, 128] };
  }
  return { label: 'PENDING', rgb: [234, 88, 12] };
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
        base_amount,
        discount_amount,
        total_amount,
        billing_period_start,
        billing_period_end,
        status,
        created_at,
        due_date
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
      base_amount: number | string | null;
      discount_amount: number | string | null;
      total_amount: number | string | null;
      billing_period_start: string | null;
      billing_period_end: string | null;
      status: string | null;
      created_at: string | null;
      due_date: string | null;
    };

    if (inv.center_id !== auth.centerId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { data: center, error: cErr } = await auth.supabaseAdmin
      .from('centers')
      .select('name, phone, center_code, plan, subscription_billing_period, billing_period')
      .eq('id', inv.center_id)
      .maybeSingle();

    if (cErr || !center) {
      return NextResponse.json({ error: 'Center not found' }, { status: 404 });
    }

    const c = center as {
      name?: string | null;
      phone?: string | null;
      center_code?: string | null;
      plan?: string | null;
      subscription_billing_period?: string | null;
      billing_period?: string | null;
    };

    const plan = String(c.plan ?? '—');
    const bp = normalizeBillingPeriod(c.subscription_billing_period ?? c.billing_period);
    const baseAmount = Number(inv.base_amount ?? 0);
    const discountAmount = Number(inv.discount_amount ?? 0);
    const totalAmount = Number(inv.total_amount ?? 0);
    const subtotalBeforeVat = Math.max(0, baseAmount - discountAmount);
    const vatEstimate = Math.round(subtotalBeforeVat * 0.14 * 100) / 100;

    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 14;
    const rightX = pageW - margin;

    const wm = watermarkStyle(inv.status);
    doc.saveGraphicsState();
    doc.setGState(doc.GState({ opacity: 0.12 }));
    doc.setTextColor(...wm.rgb);
    doc.setFontSize(48);
    doc.setFont('helvetica', 'bold');
    doc.text(wm.label, pageW / 2, pageH / 2, { align: 'center', angle: 45 });
    doc.restoreGraphicsState();

    let y = margin;

    doc.setTextColor(...TEAL);
    doc.setFontSize(22);
    doc.setFont('helvetica', 'bold');
    doc.text('CenterHQ', margin, y);
    y += 8;

    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    doc.text('Tax Invoice', margin, y);
    y += 4;

    doc.setDrawColor(200, 200, 200);
    doc.setLineWidth(0.3);
    doc.line(margin, y, rightX, y);
    y += 10;

    doc.setTextColor(40, 40, 40);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text('Bill to', margin, y);
    doc.text('Invoice details', rightX, y, { align: 'right' });
    y += 6;

    doc.setFont('helvetica', 'normal');
    const leftLines = [
      `Center Name: ${c.name ?? '—'}`,
      `Phone: ${c.phone ?? '—'}`,
      `Center Code: ${c.center_code ?? '—'}`,
    ];
    const invNo = inv.invoice_number ?? inv.center_id.slice(0, 8);
    const rightLines = [
      `Invoice #: ${invNo}`,
      `Date: ${fmtDate(inv.created_at)}`,
      `Due: ${fmtDateYmd(inv.due_date)}`,
      `Period: ${fmtDateYmd(inv.billing_period_start)} — ${fmtDateYmd(inv.billing_period_end)}`,
    ];

    const blockStart = y;
    leftLines.forEach((line, i) => {
      doc.text(line, margin, blockStart + i * 5);
    });
    rightLines.forEach((line, i) => {
      doc.text(line, rightX, blockStart + i * 5, { align: 'right' });
    });
    y = blockStart + Math.max(leftLines.length, rightLines.length) * 5 + 10;

    doc.setFont('helvetica', 'bold');
    doc.text('Description', margin, y);
    doc.text('Amount (EGP)', rightX, y, { align: 'right' });
    y += 4;
    doc.setDrawColor(180, 180, 180);
    doc.line(margin, y, rightX, y);
    y += 6;

    doc.setFont('helvetica', 'normal');
    const desc = subscriptionLineDescription(inv.invoice_type, plan, bp);
    doc.text(desc, margin, y);
    doc.text(fmtMoney(baseAmount), rightX, y, { align: 'right' });
    y += 6;

    if (discountAmount > 0) {
      doc.text('Discount', margin, y);
      doc.text(`-${fmtMoney(discountAmount)}`, rightX, y, { align: 'right' });
      y += 6;
    }

    doc.line(margin, y, rightX, y);
    y += 6;

    doc.text('Subtotal (before VAT)', margin, y);
    doc.text(fmtMoney(subtotalBeforeVat), rightX, y, { align: 'right' });
    y += 6;

    doc.text('VAT (14%)', margin, y);
    doc.text(fmtMoney(vatEstimate), rightX, y, { align: 'right' });
    y += 6;

    doc.setFont('helvetica', 'bold');
    doc.text('Total', margin, y);
    doc.text(`${fmtMoney(totalAmount)} EGP`, rightX, y, { align: 'right' });
    y += 6;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(100, 100, 100);
    doc.text(`Status: ${(inv.status ?? '—').toUpperCase()}`, margin, y);

    doc.setTextColor(120, 120, 120);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.text('Generated by CenterHQ — center-hq.vercel.app', margin, pageH - 14);
    doc.text('This invoice was generated automatically.', margin, pageH - 10);

    const pdfOut = doc.output('arraybuffer');
    const buf = Buffer.from(pdfOut);
    const fname = safeFilenamePart(invNo);

    return new NextResponse(buf, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="invoice-${fname}.pdf"`,
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

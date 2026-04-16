import { NextRequest, NextResponse } from 'next/server';
import { getAdminContext } from '@/lib/admin-auth';
import { generateInvoicePdf } from '@/lib/generateInvoicePdf';

export const dynamic = 'force-dynamic';

function safeFilenamePart(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 80) || 'invoice';
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getAdminContext(request);
    if (!ctx) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: invoiceId } = await context.params;
    if (!invoiceId?.trim()) {
      return NextResponse.json({ error: 'Invalid invoice id' }, { status: 400 });
    }

    const { data: invoice, error: invErr } = await ctx.supabaseAdmin
      .from('invoices')
      .select('id, invoice_number')
      .eq('id', invoiceId.trim())
      .maybeSingle();

    if (invErr || !invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }

    const inv = invoice as { invoice_number: string | null };

    let pdfBuf: Buffer;
    try {
      pdfBuf = await generateInvoicePdf(invoiceId.trim());
    } catch (e) {
      console.error('[admin/invoices/pdf]', e);
      return NextResponse.json(
        { error: e instanceof Error ? e.message : 'PDF generation failed' },
        { status: 500 },
      );
    }

    const invNo = String(inv.invoice_number ?? invoiceId.slice(0, 8));
    const fname = safeFilenamePart(invNo);

    return new NextResponse(new Uint8Array(pdfBuf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="INV-${fname}.pdf"`,
      },
    });
  } catch (e) {
    console.error('[admin/invoices/pdf]', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'PDF generation failed' },
      { status: 500 },
    );
  }
}

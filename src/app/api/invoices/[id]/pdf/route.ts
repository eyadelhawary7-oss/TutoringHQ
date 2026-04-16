import { NextRequest, NextResponse } from 'next/server';
import { requireCenterAuth } from '@/lib/centerAuth';
import { generateInvoicePdf } from '@/lib/generateInvoicePdf';

export const dynamic = 'force-dynamic';

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
      .select('id, center_id, invoice_number')
      .eq('id', invoiceId.trim())
      .maybeSingle();

    if (invErr || !invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }

    const inv = invoice as { center_id: string; invoice_number: string | null };
    if (inv.center_id !== auth.centerId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    let pdfBuf: Buffer;
    try {
      pdfBuf = await generateInvoicePdf(invoiceId.trim());
    } catch (e) {
      console.error('[invoices/pdf]', e);
      return NextResponse.json(
        { error: e instanceof Error ? e.message : 'PDF generation failed' },
        { status: 500 },
      );
    }

    const invNo = String(inv.invoice_number ?? inv.center_id.slice(0, 8));
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

import 'server-only';

import { NextRequest, NextResponse } from 'next/server';
import { requireTeacherAuth } from '@/lib/centerAuth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { generateInvoicePdf } from '@/lib/generateInvoicePdf';

export const dynamic = 'force-dynamic';

function safeFilenamePart(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 80) || 'invoice';
}

/**
 * Teacher invoice receipt PDF (parity with /api/invoices/[id]/pdf). Scoped to the
 * authenticated teacher's own invoice; the shared generateInvoicePdf renders the
 * teacher document via its owner_type='teacher' branch.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id: invoiceId } = await context.params;
    if (!invoiceId?.trim()) {
      return NextResponse.json({ error: 'Invalid invoice id' }, { status: 400 });
    }

    const auth = await requireTeacherAuth(request);
    if (!auth.ok) return auth.response;

    const admin = getSupabaseAdmin();
    const { data: invoice, error } = await admin
      .from('invoices')
      .select('id, invoice_number, owner_type, teacher_id')
      .eq('id', invoiceId.trim())
      .maybeSingle();

    if (error || !invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }

    const inv = invoice as {
      id: string;
      invoice_number: string | null;
      owner_type: string | null;
      teacher_id: string | null;
    };
    if (inv.owner_type !== 'teacher' || inv.teacher_id !== auth.userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    let pdfBuffer: Buffer;
    try {
      pdfBuffer = await generateInvoicePdf(invoiceId.trim());
    } catch (e) {
      console.error('[teacher/invoice-pdf]', e);
      return NextResponse.json({ error: 'PDF generation failed' }, { status: 500 });
    }

    const filename = inv.invoice_number
      ? `${safeFilenamePart(inv.invoice_number)}.pdf`
      : `invoice-${safeFilenamePart(inv.id)}.pdf`;

    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'private, no-cache',
      },
    });
  } catch (err) {
    console.error('[teacher/invoice-pdf]', err);
    return NextResponse.json({ error: 'PDF generation failed' }, { status: 500 });
  }
}

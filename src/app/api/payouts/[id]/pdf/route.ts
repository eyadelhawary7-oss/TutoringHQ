import { NextRequest, NextResponse } from 'next/server';
import { requireCenterAuth } from '@/lib/centerAuth';
import { generatePayoutReceiptPdf } from '@/lib/generateInvoicePdf';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id: payoutId } = await context.params;
    if (!payoutId?.trim()) {
      return NextResponse.json({ error: 'Invalid payout id' }, { status: 400 });
    }

    const auth = await requireCenterAuth(request);
    if (!auth.ok) return auth.response;
    if (auth.role !== 'owner') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { data: row, error } = await auth.supabaseAdmin
      .from('payout_requests')
      .select('id, center_id')
      .eq('id', payoutId.trim())
      .maybeSingle();

    if (error || !row) {
      return NextResponse.json({ error: 'Payout not found' }, { status: 404 });
    }

    const p = row as { center_id: string };
    if (p.center_id !== auth.centerId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const pdfBuf = await generatePayoutReceiptPdf(payoutId.trim(), auth.supabaseAdmin);
    if (!pdfBuf) {
      return NextResponse.json({ error: 'PDF generation failed' }, { status: 500 });
    }

    const fname = payoutId.trim().slice(0, 12).replace(/[^a-zA-Z0-9-]+/g, '-') || 'payout';

    return new NextResponse(new Uint8Array(pdfBuf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="PAY-${fname}.pdf"`,
      },
    });
  } catch (e) {
    console.error('[payouts/pdf]', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'PDF generation failed' },
      { status: 500 },
    );
  }
}

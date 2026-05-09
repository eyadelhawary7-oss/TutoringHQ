import { NextRequest, NextResponse } from 'next/server';
import { requireCenterAuth } from '@/lib/centerAuth';
import { generateCardOrderReceiptPdf } from '@/lib/generateInvoicePdf';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, ctx: { params: Promise<{ orderId: string }> }) {
  const auth = await requireCenterAuth(request);
  if (!auth.ok) return auth.response;

  const { orderId } = await ctx.params;
  const id = typeof orderId === 'string' ? orderId.trim() : '';
  if (!id) return NextResponse.json({ error: 'Bad request' }, { status: 400 });

  const result = await generateCardOrderReceiptPdf(id, auth.supabaseAdmin, auth.centerId);
  if (!result.ok) {
    if (result.reason === 'unavailable') {
      return NextResponse.json({ error: 'Receipt unavailable until payment completes.' }, { status: 422 });
    }
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const short = id.replace(/-/g, '').slice(-8).toUpperCase();

  return new NextResponse(new Uint8Array(result.buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="centerhq-order-${short}.pdf"`,
    },
  });
}

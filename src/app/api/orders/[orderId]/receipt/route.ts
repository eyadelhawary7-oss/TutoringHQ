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

  const buf = await generateCardOrderReceiptPdf(id, auth.supabaseAdmin);
  if (!buf) {
    return NextResponse.json({ error: 'Receipt unavailable' }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="card-order-${id.slice(0, 8)}.pdf"`,
    },
  });
}

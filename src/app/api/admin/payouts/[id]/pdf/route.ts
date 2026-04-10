import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdminApi } from '@/lib/admin-auth';
import { generateStaffCommissionPayoutPdf } from '@/lib/generateInvoicePdf';

export const dynamic = 'force-dynamic';

function safeFilenamePart(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 80) || 'payout';
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const gated = await requireSuperAdminApi(request);
  if (!gated.ok) return gated.response;

  const { id: payoutId } = await context.params;
  if (!payoutId?.trim()) {
    return NextResponse.json({ error: 'Invalid payout id' }, { status: 400 });
  }

  const { data: payout, error } = await gated.supabaseAdmin
    .from('commission_payouts')
    .select('id, status, period')
    .eq('id', payoutId.trim())
    .maybeSingle();

  if (error || !payout) {
    return NextResponse.json({ error: 'Payout not found' }, { status: 404 });
  }

  const st = String((payout as { status: string }).status);
  if (st !== 'confirmed' && st !== 'paid') {
    return NextResponse.json({ error: 'PDF is available after payout is confirmed or paid' }, { status: 403 });
  }

  const pdfBuf = await generateStaffCommissionPayoutPdf(payoutId.trim(), gated.supabaseAdmin);
  if (!pdfBuf) {
    return NextResponse.json({ error: 'PDF generation failed' }, { status: 500 });
  }

  const period = String((payout as { period?: string }).period ?? payoutId.slice(0, 8));
  const fname = safeFilenamePart(period);

  return new NextResponse(new Uint8Array(pdfBuf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="PAYOUT-${fname}.pdf"`,
    },
  });
}

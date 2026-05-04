import { requireSuperAdminApi } from '@/lib/admin-auth';
import { NextResponse } from 'next/server';
import { generateOrderPdf } from '@/lib/generateOrderPdf';

export const runtime = 'nodejs';

interface PdfOrderCenter {
  name: string;
  phone: string | null;
  card_color: string | null;
}

interface PdfOrderStudent {
  id: string;
  name: string;
  student_number: string;
  qr_code: string;
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const auth = await requireSuperAdminApi(req);
  if (!auth.ok) {
    return auth.response;
  }

  const { supabaseAdmin } = auth;

  const { data: order, error: fetchError } = await supabaseAdmin
    .from('card_orders')
    .select('id, quantity, notes, students, card_style, centers(name, phone, card_color)')
    .eq('id', id)
    .maybeSingle();

  if (fetchError || !order) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const center = order.centers as unknown as PdfOrderCenter | null;
  const students = (order.students ?? []) as unknown as PdfOrderStudent[];
  const prefix =
    (process.env.BOSTA_BUSINESS_PREFIX ?? 'CHQ').replace(/[^A-Za-z0-9]/g, '') || 'CHQ';
  const ref = `${prefix}-${String(order.id).substring(0, 8).toUpperCase()}`;

  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  const academicYear = month >= 9 ? `${year}/${year + 1}` : `${year - 1}/${year}`;

  const pdfCardStyle: 'dark' | 'light' =
    (order as { card_style?: string | null }).card_style === 'light' ? 'light' : 'dark';

  const pdfBuffer = await generateOrderPdf({
    ref,
    quantity: order.quantity,
    notes: order.notes ?? null,
    centerName: center?.name ?? '',
    centerPhone: center?.phone ?? '',
    cardColor: center?.card_color ?? '#0D9488',
    cardStyle: pdfCardStyle,
    academicYear,
    students,
  });

  if (!pdfBuffer) {
    return NextResponse.json({ error: 'pdf_generation_failed' }, { status: 500 });
  }

  return new Response(new Uint8Array(pdfBuffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="CenterHQ-${ref}.pdf"`,
    },
  });
}

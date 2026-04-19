import { NextRequest, NextResponse } from 'next/server';
import { validateCSRFRequest } from '@/lib/csrf';
import { requireCenterAuth } from '@/lib/centerAuth';

export async function POST(request: NextRequest) {
  try {
    const auth = await requireCenterAuth(request);
    if (!auth.ok) return auth.response;

    const { data: permRow } = await auth.supabaseAdmin
      .from('users')
      .select('can_view_payments, can_record_payments')
      .eq('id', auth.userId)
      .single();
    const canConfirm =
      permRow?.can_view_payments === true || permRow?.can_record_payments === true;
    if (!canConfirm) {
      return NextResponse.json({ error: 'Forbidden - insufficient permissions' }, { status: 403 });
    }

    if (!validateCSRFRequest(request, auth.userId)) {
      return NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 });
    }

    const body = await request.json();
    const paymentId = body?.payment_id ?? body?.paymentId;
    if (!paymentId || typeof paymentId !== 'string') {
      return NextResponse.json({ error: 'payment_id is required' }, { status: 400 });
    }

    const { data: payment, error: payErr } = await auth.supabaseAdmin
      .from('payments')
      .select('id, student_id, center_id, amount, status')
      .eq('id', paymentId)
      .single();

    if (payErr || !payment) {
      return NextResponse.json({ error: 'Payment not found' }, { status: 404 });
    }

    if ((payment as { center_id?: string }).center_id !== auth.centerId) {
      return NextResponse.json({ error: 'Payment does not belong to your center' }, { status: 403 });
    }

    const status = (payment as { status?: string }).status;
    if (status === 'confirmed') {
      return NextResponse.json({ success: true, message: 'Already confirmed' });
    }

    const amount = Number((payment as { amount?: number }).amount ?? 0);
    const studentId = (payment as { student_id?: string }).student_id;

    const { error: updateErr } = await auth.supabaseAdmin
      .from('payments')
      .update({
        status: 'confirmed',
        confirmed: true,
        confirmed_by: auth.userId,
        confirmed_at: new Date().toISOString(),
      })
      .eq('id', paymentId);

    if (updateErr) {
      console.error('[payments/confirm] Update error:', updateErr);
      return NextResponse.json({ error: 'Failed to confirm payment' }, { status: 500 });
    }

    if (studentId && amount > 0) {
      const { data: student } = await auth.supabaseAdmin
        .from('students')
        .select('balance_due')
        .eq('id', studentId)
        .single();

      if (student && typeof (student as { balance_due?: number }).balance_due === 'number') {
        const currentBalance = (student as { balance_due: number }).balance_due;
        const newBalance = Math.max(0, currentBalance - amount);
        await auth.supabaseAdmin
          .from('students')
          .update({ balance_due: newBalance })
          .eq('id', studentId);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[payments/confirm] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

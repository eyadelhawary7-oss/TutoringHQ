import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { validateCSRFRequest } from '@/lib/csrf';

async function getUserContext(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) return null;

  const authHeader = request.headers.get('Authorization');
  const accessToken = authHeader?.replace('Bearer ', '');
  if (!accessToken) return null;

  const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });

  const { data: { user }, error } = await supabaseAuth.auth.getUser();
  if (error || !user) return null;

  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false },
  });

  const { data: userRecord } = await supabaseAdmin
    .from('users')
    .select('id, center_id, can_view_payments, can_record_payments')
    .eq('id', user.id)
    .single();

  if (!userRecord?.center_id) return null;

  return { user: userRecord, supabaseAdmin };
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await getUserContext(request);
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const canConfirm = ctx.user.can_view_payments === true || ctx.user.can_record_payments === true;
    if (!canConfirm) {
      return NextResponse.json({ error: 'Forbidden - insufficient permissions' }, { status: 403 });
    }

    if (!validateCSRFRequest(request, ctx.user.id)) {
      return NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 });
    }

    const body = await request.json();
    const paymentId = body?.payment_id ?? body?.paymentId;
    if (!paymentId || typeof paymentId !== 'string') {
      return NextResponse.json({ error: 'payment_id is required' }, { status: 400 });
    }

    const { data: payment, error: payErr } = await ctx.supabaseAdmin
      .from('payments')
      .select('id, student_id, center_id, amount, status')
      .eq('id', paymentId)
      .single();

    if (payErr || !payment) {
      return NextResponse.json({ error: 'Payment not found' }, { status: 404 });
    }

    if ((payment as { center_id?: string }).center_id !== ctx.user.center_id) {
      return NextResponse.json({ error: 'Payment does not belong to your center' }, { status: 403 });
    }

    const status = (payment as { status?: string }).status;
    if (status === 'confirmed') {
      return NextResponse.json({ success: true, message: 'Already confirmed' });
    }

    const amount = Number((payment as { amount?: number }).amount ?? 0);
    const studentId = (payment as { student_id?: string }).student_id;

    const { error: updateErr } = await ctx.supabaseAdmin
      .from('payments')
      .update({
        status: 'confirmed',
        confirmed_by: ctx.user.id,
        confirmed_at: new Date().toISOString(),
      })
      .eq('id', paymentId);

    if (updateErr) {
      console.error('[payments/confirm] Update error:', updateErr);
      return NextResponse.json({ error: 'Failed to confirm payment' }, { status: 500 });
    }

    if (studentId && amount > 0) {
      const { data: student } = await ctx.supabaseAdmin
        .from('students')
        .select('balance_due')
        .eq('id', studentId)
        .single();

      if (student && typeof (student as { balance_due?: number }).balance_due === 'number') {
        const currentBalance = (student as { balance_due: number }).balance_due;
        const newBalance = Math.max(0, currentBalance - amount);
        await ctx.supabaseAdmin
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

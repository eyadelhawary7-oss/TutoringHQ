import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

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

  const {
    data: { user },
    error,
  } = await supabaseAuth.auth.getUser();
  if (error || !user) return null;

  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false },
  });

  const { data: userRecord } = await supabaseAdmin
    .from('users')
    .select('id, center_id')
    .eq('id', user.id)
    .single();

  if (!userRecord?.center_id) return null;

  return { user: userRecord, supabaseAdmin };
}

export async function GET(request: NextRequest) {
  try {
    const ctx = await getUserContext(request);
    if (!ctx) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const cardOrderId = request.nextUrl.searchParams.get('cardOrderId')?.trim();
    if (!cardOrderId) {
      return NextResponse.json({ error: 'cardOrderId required' }, { status: 400 });
    }

    const { data: row, error } = await ctx.supabaseAdmin
      .from('card_orders')
      .select('payment_status, center_id')
      .eq('id', cardOrderId)
      .single();

    if (error || !row || row.center_id !== ctx.user.center_id) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const paymentStatus = row.payment_status as string;
    if (paymentStatus !== 'unpaid' && paymentStatus !== 'paid' && paymentStatus !== 'failed') {
      return NextResponse.json({ paymentStatus: 'unpaid' });
    }

    return NextResponse.json({ paymentStatus });
  } catch (e) {
    console.error('[payment-status]', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Internal error' },
      { status: 500 }
    );
  }
}

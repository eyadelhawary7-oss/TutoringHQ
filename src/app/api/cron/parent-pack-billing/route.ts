import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  PACK_BASE_PER_PARENT,
  PACK_SERVICE_FEE_RATE,
  PACK_VAT_RATE,
  currentMonthFirstDay,
} from '@/lib/parentPack';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json({ error: 'Missing Supabase config' }, { status: 500 });
  }

  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: activeCenters } = await supabaseAdmin
    .from('centers')
    .select('id')
    .eq('parent_pack_enabled', true)
    .eq('subscription_status', 'active');

  let total = 0;
  const monthStart = currentMonthFirstDay();
  const serviceFee = Math.round(PACK_BASE_PER_PARENT * PACK_SERVICE_FEE_RATE * 100) / 100;
  const vat = Math.round(PACK_BASE_PER_PARENT * PACK_VAT_RATE * 100) / 100;

  for (const center of activeCenters ?? []) {
    const { data: students } = await supabaseAdmin
      .from('students')
      .select('id')
      .eq('center_id', center.id)
      .eq('parent_pack_opted_in', true)
      .not('parent_phone', 'is', null)
      .eq('is_active', true);

    await supabaseAdmin
      .from('centers')
      .update({ parent_pack_active_parents: students?.length ?? 0 })
      .eq('id', center.id);

    for (const student of students ?? []) {
      const { error } = await supabaseAdmin.from('parent_pack_billing').upsert(
        {
          center_id: center.id,
          student_id: student.id,
          month: monthStart,
          amount: 12,
          base_amount: PACK_BASE_PER_PARENT,
          service_fee: serviceFee,
          vat,
          total_amount: 12,
          status: 'pending',
        },
        { onConflict: 'center_id,student_id,month', ignoreDuplicates: true },
      );
      if (!error) total += 1;
    }
  }

  return NextResponse.json({ processed: total });
}

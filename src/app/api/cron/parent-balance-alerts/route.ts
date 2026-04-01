import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendTemplateMessage } from '@/lib/whatsapp/client';
import { toArabicNumerals, WA_TEMPLATES } from '@/lib/parentPack';

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

  const { data: packCenters } = await supabaseAdmin
    .from('centers')
    .select('id, name')
    .eq('parent_pack_enabled', true)
    .eq('subscription_status', 'active');

  const packCenterIds = packCenters?.map((c) => c.id) ?? [];
  if (packCenterIds.length === 0) {
    return NextResponse.json({ sent: 0, skipped: 0 });
  }

  const centerNameMap = new Map(packCenters?.map((c) => [c.id, c.name]) ?? []);

  const { data: students } = await supabaseAdmin
    .from('students')
    .select('id, name, parent_phone, fee, center_id')
    .eq('parent_pack_opted_in', true)
    .not('parent_phone', 'is', null)
    .eq('is_active', true)
    .eq('payment_status', 'unpaid')
    .in('center_id', packCenterIds);

  let sent = 0;
  let skipped = 0;

  for (const student of students ?? []) {
    const feeAmount = Number(student.fee ?? 0);
    if (feeAmount <= 0) {
      skipped += 1;
      continue;
    }

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: recentAlert } = await supabaseAdmin
      .from('wa_message_queue')
      .select('id')
      .eq('to_phone', student.parent_phone as string)
      .eq('template_name', WA_TEMPLATES.PARENT_BALANCE_DUE)
      .gt('created_at', sevenDaysAgo)
      .limit(1)
      .maybeSingle();

    if (!recentAlert) {
      const centerName = centerNameMap.get(student.center_id) ?? '';
      await sendTemplateMessage(student.center_id as string, student.parent_phone as string, WA_TEMPLATES.PARENT_BALANCE_DUE, {
        '1': student.name,
        '2': centerName,
        '3': toArabicNumerals(Math.round(feeAmount)),
      });
      sent += 1;
    } else {
      skipped += 1;
    }
  }

  return NextResponse.json({ sent, skipped });
}

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase =
  supabaseUrl && serviceKey
    ? createClient(supabaseUrl, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;

/** Runs at 9am UTC daily. Loyalty unlocks after 365 actual active days (paused intervals excluded). */
export async function GET(request: Request) {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!supabase) {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }

  const today = new Date().toISOString().split('T')[0];
  let eligible = 0;
  let forfeited = 0;

  const { data: candidates } = await supabase
    .from('commissions')
    .select(
      `
      id, staff_id, loyalty_bonus_amount,
      center_first_payment_date,
      centers!inner(billing_status, next_payment_due)
    `,
    )
    .eq('loyalty_bonus_status', 'locked')
    .not('center_first_payment_date', 'is', null)
    .not('staff_id', 'is', null);

  for (const commission of candidates ?? []) {
    const c = commission as {
      id: string;
      staff_id: string;
      centers:
        | { billing_status: string; next_payment_due: string | null }
        | { billing_status: string; next_payment_due: string | null }[];
    };
    const center = Array.isArray(c.centers) ? c.centers[0] : c.centers;
    if (!center) continue;

    if (!['active', 'paid'].includes(center.billing_status)) continue;
    const npd = center.next_payment_due;
    if (!npd) continue;
    const nextDue = new Date(npd);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 14);
    if (nextDue < cutoff) continue;

    const { data: activeDays } = await supabase.rpc('compute_active_days', {
      p_commission_id: c.id,
    });
    if ((activeDays ?? 0) < 365) continue;

    const { data: staffMember } = await supabase
      .from('staff')
      .select('status, termination_type')
      .eq('id', c.staff_id)
      .single();

    if (staffMember?.status === 'terminated' && staffMember.termination_type !== 'completed') {
      await supabase.from('commissions').update({ loyalty_bonus_status: 'forfeited' }).eq('id', c.id);
      forfeited++;
      continue;
    }

    await supabase
      .from('commissions')
      .update({ loyalty_bonus_status: 'eligible', loyalty_bonus_eligible_at: today })
      .eq('id', c.id);
    await supabase.from('commission_audit_log').insert({
      commission_id: c.id,
      action: 'loyalty_eligible_set',
      triggered_by: 'cron',
      new_value: { loyalty_bonus_status: 'eligible', active_days: activeDays, eligible_at: today },
    });
    eligible++;
  }

  return NextResponse.json({
    success: true,
    date: today,
    loyalty_eligible: eligible,
    forfeited,
  });
}

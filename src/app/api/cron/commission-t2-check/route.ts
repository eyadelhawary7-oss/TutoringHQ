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

/** Runs at 9am UTC daily — after process-renewals so billing reflects payment state before T2 unlock. */
export async function GET(request: Request) {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!supabase) {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }

  const today = new Date().toISOString().split('T')[0];
  let unlocked = 0;
  let forfeited = 0;
  let skipped = 0;

  const { data: candidates, error: candidatesError } = await supabase
    .from('commissions')
    .select(
      `
      id, staff_id, center_id, t2_amount,
      center_first_payment_date, clock_pause_log,
      centers!inner(billing_status, next_payment_due)
    `,
    )
    .eq('t2_status', 'locked')
    .not('center_first_payment_date', 'is', null)
    .not('staff_id', 'is', null);
  if (candidatesError) {
    console.error('[commission-t2-check]', candidatesError.message);
  }

  for (const commission of candidates ?? []) {
    const c = commission as {
      id: string;
      staff_id: string;
      centers:
        | { billing_status: string; next_payment_due: string | null }
        | { billing_status: string; next_payment_due: string | null }[];
    };
    const center = Array.isArray(c.centers) ? c.centers[0] : c.centers;
    if (!center) {
      skipped++;
      continue;
    }

    if (!['active', 'paid'].includes(center.billing_status)) {
      skipped++;
      continue;
    }
    const npd = center.next_payment_due;
    if (!npd) {
      skipped++;
      continue;
    }
    const nextDue = new Date(npd);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 14);
    if (nextDue < cutoff) {
      skipped++;
      continue;
    }

    const { data: activeDays, error: activeDaysErr } = await supabase.rpc('compute_active_days', {
      p_commission_id: c.id,
    });
    if (activeDaysErr) {
      console.error('[commission-t2-check] compute_active_days', activeDaysErr.message);
    }
    if ((activeDays ?? 0) < 180) {
      skipped++;
      continue;
    }

    const { data: staffMember, error: staffErr } = await supabase
      .from('staff')
      .select('status, termination_type')
      .eq('id', c.staff_id)
      .single();
    if (staffErr) {
      console.error('[commission-t2-check] staff', staffErr.message);
    }

    if (staffMember?.status === 'terminated' && staffMember.termination_type !== 'completed') {
      await supabase.from('commissions').update({ t2_status: 'forfeited' }).eq('id', c.id);
      await supabase.from('commission_audit_log').insert({
        commission_id: c.id,
        action: 't2_forfeited',
        triggered_by: 'cron',
        reason: `Staff ${staffMember.termination_type} before T2 unlocked`,
        new_value: { t2_status: 'forfeited', active_days: activeDays },
      });
      forfeited++;
      continue;
    }

    await supabase
      .from('commissions')
      .update({ t2_status: 'eligible', t2_eligible_at: today })
      .eq('id', c.id);
    await supabase.from('commission_audit_log').insert({
      commission_id: c.id,
      action: 't2_auto_unlock',
      triggered_by: 'cron',
      new_value: { t2_status: 'eligible', active_days: activeDays, eligible_at: today },
    });
    unlocked++;
  }

  return NextResponse.json({
    success: true,
    date: today,
    t2_unlocked: unlocked,
    t2_forfeited: forfeited,
    skipped,
  });
}

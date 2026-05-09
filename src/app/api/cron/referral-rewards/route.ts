import { NextResponse } from 'next/server';
import { requireCronSecret } from '@/lib/cron/requireCronSecret';
import { tCronBackup } from '@/lib/cronBackupI18n';
import { netReferralBaseFromAllInPrice } from '@/lib/referralNetBase';
import { supabaseAdmin } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function getRate(monthNumber: number): number {
  if (monthNumber === 1) return 0.25;
  if (monthNumber <= 12) return 0.1;
  return 0.05;
}

/** Gross reward from monthly base × tier rate; month 1 applies 15% withholding (net to record). */
function computeRewardAmount(monthNumber: number, baseAmount: number): number {
  const gross = baseAmount * getRate(monthNumber);
  const net = monthNumber === 1 ? Math.round(gross * 0.85) : Math.round(gross);
  return net;
}

/**
 * Runs on the 2nd of each month at 3am UTC (Vercel cron).
 * Calculates referral_reward_records for the previous calendar month.
 */
export async function GET(request: Request) {
  const cronStart = Date.now();
  const CRON_NAME = 'referral-rewards';

  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized;

  if (!supabaseAdmin) {
    return NextResponse.json({ success: false, error: tCronBackup('errorServerMisconfigured') }, { status: 500 });
  }

  const supabase = supabaseAdmin;

  const now = new Date();
  const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const periodMonth = `${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, '0')}`;

  let created = 0;
  let skipped = 0;
  const errors: string[] = [];

  const { data: referrals, error: refErr } = await supabase
    .from('referrals')
    .select(
      `
      id,
      referrer_center_id,
      referred_center_id,
      status,
      referred_first_paid_at,
      referred_center:centers!referrals_referred_center_id_fkey(
        id,
        plan,
        all_in_price,
        billing_status,
        next_payment_due,
        subscription_status,
        status
      )
    `,
    )
    .eq('status', 'active')
    .not('referred_first_paid_at', 'is', null);

  if (refErr) {
    errors.push(refErr.message);
    await supabase.from('cron_log').insert({
      cron_name: CRON_NAME,
      status: 'failure',
      duration_ms: Date.now() - cronStart,
      records_processed: 0,
      error_message: refErr.message,
      metadata: { period_month: periodMonth },
    });
    return NextResponse.json({ success: false, error: refErr.message }, { status: 500 });
  }

  for (const referral of referrals ?? []) {
    const row = referral as Record<string, unknown>;
    const refId = String(row.id ?? '');
    try {
      const referred = row.referred_center as {
        id: string;
        plan: string;
        all_in_price: number | string | null;
        billing_status: string | null;
        next_payment_due: string | null;
        subscription_status: string | null;
        status: string | null;
      } | null;

      if (!referred) {
        skipped++;
        continue;
      }

      if (referred.status !== 'active') {
        skipped++;
        continue;
      }

      const sub = String(referred.subscription_status ?? 'active');
      if (sub !== 'active') {
        skipped++;
        continue;
      }

      const billing = String(referred.billing_status ?? '');
      if (!['active', 'paid'].includes(billing)) {
        skipped++;
        continue;
      }

      const { data: existing } = await supabase
        .from('referral_reward_records')
        .select('id')
        .eq('referral_id', row.id as string)
        .eq('period_month', periodMonth)
        .maybeSingle();

      if (existing) {
        skipped++;
        continue;
      }

      const firstPaid = new Date(row.referred_first_paid_at as string);
      if (Number.isNaN(firstPaid.getTime())) {
        skipped++;
        continue;
      }

      const yearDiff = prevMonth.getFullYear() - firstPaid.getFullYear();
      const monthDiff = prevMonth.getMonth() - firstPaid.getMonth();
      const monthNumber = yearDiff * 12 + monthDiff + 1;

      if (monthNumber < 1) {
        skipped++;
        continue;
      }

      const rate = getRate(monthNumber);
      const baseAmount = netReferralBaseFromAllInPrice(Number(referred.all_in_price) || 0);
      const rewardAmount = computeRewardAmount(monthNumber, baseAmount);

      const heldUntil =
        monthNumber === 1
          ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
          : null;

      const status = heldUntil ? 'held' : 'pending';

      const { error: insErr } = await supabase.from('referral_reward_records').insert({
        referral_id: row.id,
        referrer_center_id: row.referrer_center_id,
        referred_center_id: row.referred_center_id,
        month_number: monthNumber,
        reward_percentage: rate,
        base_amount: baseAmount,
        reward_amount: rewardAmount,
        status,
        held_until: heldUntil,
        period_month: periodMonth,
      });

      if (insErr) {
        errors.push(`referral ${refId}: ${insErr.message}`);
        continue;
      }
      created++;
    } catch (err) {
      errors.push(`referral ${refId}: ${String(err)}`);
    }
  }

  const logStatus = errors.length === 0 ? 'success' : created > 0 ? 'partial' : 'failure';
  await supabase.from('cron_log').insert({
    cron_name: CRON_NAME,
    status: logStatus,
    duration_ms: Date.now() - cronStart,
    records_processed: created,
    error_message: errors.length > 0 ? errors.join('; ').slice(0, 10000) : null,
    metadata: { period_month: periodMonth, created, skipped },
  });

  try {
    await supabase.from('cron_health_log').upsert(
      {
        cron_name: CRON_NAME,
        last_success_at: new Date().toISOString(),
        failure_count: 0,
      },
      { onConflict: 'cron_name' },
    );
  } catch (healthLogErr) {
    console.error(`[${CRON_NAME}] cron_health_log:`, healthLogErr);
  }

  return NextResponse.json({
    success: true,
    period_month: periodMonth,
    created,
    skipped,
    ...(errors.length > 0 ? { errors } : {}),
  });
}

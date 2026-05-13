import { NextResponse } from 'next/server';
import { requireCronSecret } from '@/lib/cron/requireCronSecret';
import { insertCronLogSuccess, insertCronLogFailure, insertCronLogPartial } from '@/lib/cron/cronLog';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { tCronBackup } from '@/lib/cronBackupI18n';
import { netReferralBaseFromAllInPrice } from '@/lib/referralNetBase';
import { sendReferralCommission } from '@/lib/centerNotify';
import { ownerContactByCenterId, resolveOwnerWaPhone } from '@/lib/ownerPhone';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function getRate(monthNumber: number): number {
  if (monthNumber === 1) return 0.25;
  if (monthNumber <= 12) return 0.1;
  return 0.05;
}

function addDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + days);
  return out;
}

/**
 * Runs on the 2nd of each month at 3am UTC (Vercel cron).
 * Creates referral_commissions for the previous calendar month using net revenue base
 * (all_in_price ex VAT / service fee / stamp duty).
 */
export async function GET(request: Request) {
  const cronStart = Date.now();
  const CRON_NAME = 'referral-automation';

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
        name,
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
    await insertCronLogFailure(supabase, CRON_NAME, refErr, {
      duration_ms: Date.now() - cronStart,
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
        name: string | null;
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
        .from('referral_commissions')
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

      const allIn = Number(referred.all_in_price) || 0;
      const referred_plan_fee = netReferralBaseFromAllInPrice(allIn);
      if (referred_plan_fee <= 0) {
        skipped++;
        continue;
      }

      const rate = getRate(monthNumber);
      const commission_amount = Math.round(referred_plan_fee * rate);

      const holdUntil = monthNumber === 1 ? addDays(firstPaid, 30) : null;
      const status = holdUntil ? 'hold' : 'withdrawable';

      const insertData: Record<string, unknown> = {
        referral_id: row.id,
        referrer_center_id: row.referrer_center_id,
        referred_center_id: row.referred_center_id,
        period_month: periodMonth,
        referred_plan_fee,
        commission_rate: rate,
        commission_amount,
        status,
      };
      if (holdUntil) insertData.hold_until = holdUntil.toISOString();

      const { error: insErr } = await supabase.from('referral_commissions').insert(insertData);

      if (insErr) {
        errors.push(`referral ${refId}: ${insErr.message}`);
        continue;
      }
      if (monthNumber === 1) {
        await supabase.from('referrals').update({ status: 'active' }).eq('id', row.id as string);
      }
      if (commission_amount > 0) {
        try {
          const referredName = String(referred.name ?? '').trim() || ',';
          const { data: sumRows } = await supabase
            .from('referral_commissions')
            .select('commission_amount')
            .eq('referrer_center_id', row.referrer_center_id as string)
            .in('status', ['hold', 'withdrawable']);
          const totalBalance = (sumRows ?? []).reduce(
            (s, r) => s + Number((r as { commission_amount?: number | string | null }).commission_amount ?? 0),
            0,
          );
          const { data: refOwnerCenter } = await supabase
            .from('centers')
            .select('owner_name, name, phone')
            .eq('id', row.referrer_center_id as string)
            .maybeSingle();
          const rc = refOwnerCenter as {
            owner_name?: string | null;
            name?: string | null;
            phone?: string | null;
          } | null;
          const ownerMap = await ownerContactByCenterId(supabase, [row.referrer_center_id as string]);
          const oc = ownerMap.get(row.referrer_center_id as string);
          const ownerPhone = await resolveOwnerWaPhone(
            supabase,
            oc?.authId ?? null,
            oc?.userPhone,
            rc?.phone,
          );
          if (ownerPhone) {
            const ownerName = (rc?.owner_name ?? '').trim() || (rc?.name ?? '').trim() || ',';
            await sendReferralCommission(ownerPhone, ownerName, referredName, commission_amount, totalBalance);
          }
        } catch (waErr) {
          console.error('[referral-automation] referral WA:', refId, waErr);
        }
      }
      created++;
    } catch (err) {
      errors.push(`referral ${refId}: ${String(err)}`);
    }
  }

  {
    const _refDurationMs = Date.now() - cronStart;
    const _refMeta = { period_month: periodMonth, created, skipped } as Record<string, unknown>;
    if (errors.length === 0) {
      await insertCronLogSuccess(supabase, CRON_NAME, { duration_ms: _refDurationMs, records_processed: created, metadata: _refMeta });
    } else if (created > 0) {
      await insertCronLogPartial(supabase, CRON_NAME, { duration_ms: _refDurationMs, records_processed: created, metadata: _refMeta });
    } else {
      await insertCronLogFailure(supabase, CRON_NAME, errors.join('; '), { duration_ms: _refDurationMs, metadata: _refMeta });
    }
  }

  try {
    if (supabaseAdmin) {
      await supabaseAdmin.from('cron_health_log').upsert(
        {
          cron_name: 'referral-automation',
          last_success_at: new Date().toISOString(),
          failure_count: 0,
        },
        { onConflict: 'cron_name' },
      );
    }
  } catch (healthLogErr) {
    console.error('[referral-automation] cron_health_log:', healthLogErr);
  }

  return NextResponse.json({
    success: true,
    period_month: periodMonth,
    created,
    skipped,
    ...(errors.length > 0 ? { errors } : {}),
  });
}

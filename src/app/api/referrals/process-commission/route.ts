import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { netReferralBaseFromAllInPrice } from '@/lib/referralNetBase';
import { sendReferralCommission } from '@/lib/centerNotify';
import { ownerContactByCenterId, resolveOwnerWaPhone } from '@/lib/ownerPhone';
import { supabaseAdmin } from '@/lib/supabase-admin';

function differenceInMonths(d1: Date, d2: Date): number {
  const y1 = d1.getFullYear();
  const m1 = d1.getMonth();
  const y2 = d2.getFullYear();
  const m2 = d2.getMonth();
  return (y1 - y2) * 12 + (m1 - m2);
}

function addDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + days);
  return out;
}

export async function POST(request: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }
    if (!supabaseAdmin) {
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    const authHeader = request.headers.get('Authorization');
    const accessToken = authHeader?.replace('Bearer ', '');
    if (!accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabaseAuth = createClient(supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });
    const { data: { user }, error: authErr } = await supabaseAuth.auth.getUser();
    if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: adminUser } = await supabaseAdmin.from('admin_users').select('id').eq('id', user.id).single();
    const { data: userRecord } = await supabaseAdmin.from('users').select('phone').eq('id', user.id).single();
    const superAdminPhones = (process.env.SUPER_ADMIN_PHONES || '').split(',').map((p: string) => p.trim()).filter(Boolean);
    const isPhoneAdmin = !!userRecord?.phone && superAdminPhones.includes(userRecord.phone);
    if (!adminUser && !isPhoneAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const body = await request.json();
    const { referral_id, period_month, paid_in_full } = body;

    if (!referral_id || !period_month || typeof paid_in_full !== 'boolean') {
      return NextResponse.json({ error: 'Missing required fields: referral_id, period_month, paid_in_full' }, { status: 400 });
    }

    const { data: referral, error: refErr } = await supabaseAdmin
      .from('referrals')
      .select('id, referrer_center_id, referred_center_id, referred_first_paid_at')
      .eq('id', referral_id)
      .single();

    if (refErr || !referral) {
      return NextResponse.json({ error: 'Referral not found' }, { status: 404 });
    }

    const { data: referredCenter, error: centerErr } = await supabaseAdmin
      .from('centers')
      .select('all_in_price')
      .eq('id', referral.referred_center_id)
      .single();

    if (centerErr || !referredCenter) {
      return NextResponse.json({ error: 'Referred center not found' }, { status: 404 });
    }

    const referred_plan_fee = netReferralBaseFromAllInPrice(
      Number((referredCenter as { all_in_price?: number | string | null }).all_in_price) || 0,
    );
    if (paid_in_full && referred_plan_fee <= 0) {
      return NextResponse.json({ error: 'Referred center has no valid all_in_price for commission base' }, { status: 400 });
    }

    if (!referral.referred_first_paid_at) {
      return NextResponse.json({ error: 'Referral must have referred_first_paid_at set' }, { status: 400 });
    }

    const periodDate = new Date(period_month);
    const firstPaidDate = new Date(referral.referred_first_paid_at);
    const months = differenceInMonths(periodDate, firstPaidDate) + 1;

    if (months < 1) {
      return NextResponse.json({ error: 'Invalid period_month' }, { status: 400 });
    }

    let rate: number;
    if (months === 1) rate = 0.25;
    else if (months <= 12) rate = 0.1;
    else rate = 0.05;

    const commission = Math.round(referred_plan_fee * rate);

    if (paid_in_full === false) {
      const { error: insErr } = await supabaseAdmin.from('referral_commissions').insert({
        referral_id,
        period_month: period_month.slice(0, 7),
        referred_plan_fee,
        commission_rate: rate,
        commission_amount: 0,
        status: 'forfeited',
        referred_center_id: referral.referred_center_id,
        referrer_center_id: referral.referrer_center_id,
      });
      if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
      return NextResponse.json({ success: true, status: 'forfeited', commission_amount: 0 });
    }

    const holdUntil = months === 1 ? addDays(firstPaidDate, 30) : null;
    const status = holdUntil ? 'hold' : 'withdrawable';

    const insertData: Record<string, unknown> = {
      referral_id,
      period_month: period_month.slice(0, 7),
      referred_plan_fee,
      commission_rate: rate,
      commission_amount: commission,
      status,
      referred_center_id: referral.referred_center_id,
      referrer_center_id: referral.referrer_center_id,
    };
    if (holdUntil) insertData.hold_until = holdUntil.toISOString();

    const { error: insErr } = await supabaseAdmin.from('referral_commissions').insert(insertData);
    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

    if (months === 1) {
      await supabaseAdmin.from('referrals').update({ status: 'active' }).eq('id', referral_id);
    }

    if (commission > 0) {
      try {
        const { data: refCenter } = await supabaseAdmin
          .from('centers')
          .select('name')
          .eq('id', referral.referred_center_id)
          .maybeSingle();
        const referredName = String((refCenter as { name?: string | null } | null)?.name ?? '').trim() || '—';

        const { data: sumRows } = await supabaseAdmin
          .from('referral_commissions')
          .select('commission_amount')
          .eq('referrer_center_id', referral.referrer_center_id)
          .in('status', ['hold', 'withdrawable']);
        const totalBalance = (sumRows ?? []).reduce(
          (s, r) => s + Number((r as { commission_amount?: number | string | null }).commission_amount ?? 0),
          0,
        );

        const { data: refOwnerCenter } = await supabaseAdmin
          .from('centers')
          .select('owner_name, name, phone')
          .eq('id', referral.referrer_center_id)
          .maybeSingle();
        const rc = refOwnerCenter as {
          owner_name?: string | null;
          name?: string | null;
          phone?: string | null;
        } | null;
        const ownerMap = await ownerContactByCenterId(supabaseAdmin, [referral.referrer_center_id]);
        const oc = ownerMap.get(referral.referrer_center_id);
        const ownerPhone = await resolveOwnerWaPhone(
          supabaseAdmin,
          oc?.authId ?? null,
          oc?.userPhone,
          rc?.phone,
        );
        if (ownerPhone) {
          const ownerName = (rc?.owner_name ?? '').trim() || (rc?.name ?? '').trim() || '—';
          await sendReferralCommission(ownerPhone, ownerName, referredName, commission, totalBalance);
        }
      } catch (e) {
        console.error('[process-commission] referral WA:', e);
      }
    }

    return NextResponse.json({
      success: true,
      status,
      commission_amount: commission,
      hold_until: holdUntil?.toISOString() ?? null,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

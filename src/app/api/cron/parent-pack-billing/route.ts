import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  currentBillingPeriod,
  dateInNDays,
  previousBillingPeriod,
  shouldIssueInvoice,
} from '@/lib/parentPack';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function billingMonthEndYmd(ym: string): string {
  const [ys, ms] = ym.split('-');
  const y = Number(ys);
  const m = Number(ms);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return `${ym}-28`;
  const last = new Date(y, m, 0).getDate();
  return `${ym}-${String(last).padStart(2, '0')}`;
}

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

  const prevPeriod = previousBillingPeriod();
  const newPeriod = currentBillingPeriod();

  const { data: centers, error: centersErr } = await supabaseAdmin
    .from('centers')
    .select(
      `id, plan, parent_pack_enabled,
      pack_pending_balance, pack_months_without_invoice,
      pack_custom_invoice_minimum, pack_approved_at`,
    )
    .not('pack_approved_at', 'is', null);

  if (centersErr) {
    console.error('[cron/parent-pack-billing] centers', centersErr);
    return NextResponse.json({ error: 'Failed to load centers' }, { status: 500 });
  }

  const list = centers ?? [];

  for (const center of list) {
    const centerId = center.id as string;
    const plan = String(center.plan ?? '');

    const { count, error: countErr } = await supabaseAdmin
      .from('parent_pack_monthly_counts')
      .select('id', { count: 'exact', head: true })
      .eq('center_id', centerId)
      .eq('billing_period', prevPeriod);

    if (countErr) {
      console.error('[cron/parent-pack-billing] count', centerId, countErr);
      continue;
    }

    const billedStudents = Number(count ?? 0);
    const monthlyCharge = billedStudents * 12;

    const prevBal = Number(center.pack_pending_balance ?? 0);
    const prevMonths = Number(center.pack_months_without_invoice ?? 0);
    const newPendingBalance = prevBal + monthlyCharge;
    const newMonthsWithoutInvoice =
      billedStudents === 0 ? prevMonths : prevMonths + 1;

    const issue = shouldIssueInvoice({
      plan,
      customMinimum: center.pack_custom_invoice_minimum as number | null | undefined,
      pendingBalance: newPendingBalance,
      monthsWithoutInvoice: newMonthsWithoutInvoice,
      isFinalInvoice: false,
    });

    if (issue && newPendingBalance > 0) {
      const periodStart = `${prevPeriod}-01`;
      const periodEnd = billingMonthEndYmd(prevPeriod);
      const descCount = billedStudents;
      const invoiceNumber = `WAPACK-${prevPeriod}-${descCount}st-${Date.now()}`;

      const { error: invErr } = await supabaseAdmin.from('invoices').insert({
        center_id: centerId,
        invoice_number: invoiceNumber,
        invoice_type: 'whatsapp_addon',
        base_amount: newPendingBalance,
        total_amount: newPendingBalance,
        billing_period_start: periodStart,
        billing_period_end: periodEnd,
        due_date: dateInNDays(7),
        status: 'pending',
        payment_reference: `WhatsApp Pack — ${prevPeriod} (${descCount} students)`,
      });

      if (invErr) {
        console.error('[cron/parent-pack-billing] invoice', centerId, invErr);
        const { error: rollErr } = await supabaseAdmin
          .from('centers')
          .update({
            pack_pending_balance: newPendingBalance,
            pack_months_without_invoice: newMonthsWithoutInvoice,
          })
          .eq('id', centerId);
        if (rollErr) console.error('[cron/parent-pack-billing] rollover after invoice fail', rollErr);
        continue;
      }

      const { error: resetErr } = await supabaseAdmin
        .from('centers')
        .update({
          pack_pending_balance: 0,
          pack_months_without_invoice: 0,
        })
        .eq('id', centerId);
      if (resetErr) console.error('[cron/parent-pack-billing] reset balance', centerId, resetErr);
    } else {
      const { error: rollErr } = await supabaseAdmin
        .from('centers')
        .update({
          pack_pending_balance: newPendingBalance,
          pack_months_without_invoice: newMonthsWithoutInvoice,
        })
        .eq('id', centerId);
      if (rollErr) console.error('[cron/parent-pack-billing] rollover', centerId, rollErr);
    }

    if (center.parent_pack_enabled === true) {
      const { data: activeStudents, error: stErr } = await supabaseAdmin
        .from('students')
        .select('id, parent_phone, center_id')
        .eq('center_id', centerId)
        .eq('parent_pack_opted_in', true)
        .eq('is_active', true)
        .not('parent_phone', 'is', null);

      if (stErr) {
        console.error('[cron/parent-pack-billing] students', centerId, stErr);
        continue;
      }

      if (activeStudents?.length) {
        const rows = activeStudents.map((s) => ({
          center_id: s.center_id as string,
          billing_period: newPeriod,
          student_id: s.id as string,
          parent_phone: s.parent_phone as string,
          opted_in_at: new Date().toISOString(),
        }));

        const { error: upErr } = await supabaseAdmin
          .from('parent_pack_monthly_counts')
          .upsert(rows, {
            onConflict: 'center_id,billing_period,student_id',
            ignoreDuplicates: true,
          });
        if (upErr) console.error('[cron/parent-pack-billing] upsert counts', centerId, upErr);
      }
    }
  }

  return NextResponse.json({ success: true, processed: list.length });
}

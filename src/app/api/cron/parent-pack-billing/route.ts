import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import {
  currentBillingPeriod,
  dateInNDays,
  previousBillingPeriod,
  shouldIssueInvoice,
} from '@/lib/parentPack';
import {
  billingPeriodArabicMonthYear,
  computeRollingParentCount,
  resolvePackBillingMinimumEgp,
} from '@/lib/packBilling';
import { sendChqPackInvoiceTemplate } from '@/lib/centerNotify';
import { sendWhatsAppMessage } from '@/lib/whatsapp';

const packInvoiceEnabled = true; // TODO: set to true when chq_pack_invoice is Active

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

function centerCodeForPack(c: { center_code?: string | null; referral_code?: string | null; id: string }): string {
  const raw = (c.center_code || c.referral_code || '').trim();
  if (raw) return raw.replace(/\s+/g, '');
  return 'UNK';
}

export async function POST(request: Request) {
  const cronStart = Date.now();
  const CRON_NAME = 'parent-pack-billing';

  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json({ success: false }, { status: 200 });
  }

  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: pausedRow } = await supabaseAdmin
    .from('platform_config')
    .select('value')
    .eq('key', 'cron_paused')
    .maybeSingle();
  if (pausedRow?.value === true) {
    return NextResponse.json({ skipped: 'cron_paused' }, { status: 200 });
  }

  try {
    const { data: waSendRow } = await supabaseAdmin
      .from('platform_config')
      .select('value')
      .eq('key', 'wa_sending_enabled')
      .maybeSingle();
    const waSendingOn = waSendRow?.value !== false;

    const prevPeriod = previousBillingPeriod();
    const newPeriod = currentBillingPeriod();

    const { data: centers, error: centersErr } = await supabaseAdmin
      .from('centers')
      .select(
        `id, plan, name, phone, center_code, referral_code,
      parent_pack_enabled, pack_request_status,
      pack_pending_balance, pack_months_without_invoice,
      pack_custom_invoice_minimum, pack_approved_at,
      pack_price_per_parent`,
      )
      .not('pack_approved_at', 'is', null);

    if (centersErr) {
      throw new Error(centersErr.message || 'Failed to load centers');
    }

    const list = centers ?? [];
    let skippedTopCentersPack = 0;

    for (const center of list) {
      const centerId = center.id as string;
      const plan = String(center.plan ?? '');
      const sessionD =
        center.parent_pack_enabled === true && String(center.pack_request_status ?? '') === 'approved';

      const packBillingMin = await resolvePackBillingMinimumEgp(supabaseAdmin, {
        id: centerId,
        name: String((center as { name?: string }).name ?? ''),
        plan,
        pack_custom_invoice_minimum: (center as { pack_custom_invoice_minimum?: number | null })
          .pack_custom_invoice_minimum,
      });
      if (packBillingMin === null) {
        skippedTopCentersPack += 1;
      }

      if (sessionD) {
        const [billingYear, billingMonth] = prevPeriod.split('-');
        const code = centerCodeForPack(center as { center_code?: string; referral_code?: string; id: string });
        const invoiceNumber = `PACK-${code}-${billingYear}-${billingMonth}`;

        const { data: existsPackInv } = await supabaseAdmin
          .from('invoices')
          .select('id')
          .eq('center_id', centerId)
          .eq('invoice_number', invoiceNumber)
          .maybeSingle();

        if (!existsPackInv && packBillingMin !== null) {
          const rolling = await computeRollingParentCount(supabaseAdmin, centerId, prevPeriod);
          const pricePer = Number((center as { pack_price_per_parent?: number }).pack_price_per_parent ?? 12);
          const baseLine = Math.max(rolling * pricePer, packBillingMin);
          const pending = Number((center as { pack_pending_balance?: number }).pack_pending_balance ?? 0);
          const totalAmount = baseLine + (pending > 0 ? pending : 0);

          const periodStart = `${prevPeriod}-01`;
          const periodEnd = billingMonthEndYmd(prevPeriod);

          const { error: packInvErr } = await supabaseAdmin.from('invoices').insert({
            center_id: centerId,
            invoice_number: invoiceNumber,
            invoice_type: 'pack_billing',
            base_amount: totalAmount,
            total_amount: totalAmount,
            billing_period_start: periodStart,
            billing_period_end: periodEnd,
            due_date: dateInNDays(7),
            status: 'pending',
            payment_reference: `Parent Pack — ${prevPeriod} (${rolling} parents)`,
          });

          if (packInvErr) {
            console.error('[cron/parent-pack-billing] pack_billing invoice', centerId, packInvErr);
          } else {
            const { error: balErr } = await supabaseAdmin
              .from('centers')
              .update({ pack_pending_balance: 0 })
              .eq('id', centerId);
            if (balErr) console.error('[cron/parent-pack-billing] reset pack_pending_balance', centerId, balErr);

            try {
              await sendChqPackInvoiceTemplate(supabaseAdmin, packInvoiceEnabled, {
                name: (center as { name?: string }).name ?? '—',
                phone: (center as { phone?: string | null }).phone ?? null,
                monthArabic: billingPeriodArabicMonthYear(prevPeriod),
                parentCountStr: String(rolling),
                amountStr: String(totalAmount),
              });
            } catch (waErr) {
              console.error('[cron/parent-pack-billing] WA send error:', waErr);
            }
          }
        }
      }

      if (!sessionD) {
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
        const newMonthsWithoutInvoice = billedStudents === 0 ? prevMonths : prevMonths + 1;

        const issue =
          packBillingMin !== null &&
          shouldIssueInvoice({
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

          const { error: upErr } = await supabaseAdmin.from('parent_pack_monthly_counts').upsert(rows, {
            onConflict: 'center_id,billing_period,student_id',
            ignoreDuplicates: true,
          });
          if (upErr) console.error('[cron/parent-pack-billing] upsert counts', centerId, upErr);
        }
      }
    }

    const cutoffIso = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const { data: agedInvoices, error: agedErr } = await supabaseAdmin
      .from('invoices')
      .select('center_id')
      .eq('invoice_type', 'pack_billing')
      .eq('status', 'pending')
      .lt('created_at', cutoffIso);

    if (agedErr) {
      console.error('[cron/parent-pack-billing] aged pack invoices', agedErr);
    } else {
      const seenSuspend = new Set<string>();
      for (const row of agedInvoices ?? []) {
        const cid = (row as { center_id: string }).center_id;
        if (seenSuspend.has(cid)) continue;
        seenSuspend.add(cid);

        const { error: susErr } = await supabaseAdmin
          .from('centers')
          .update({
            pack_request_status: 'suspended',
            parent_pack_enabled: false,
          })
          .eq('id', cid);

        if (susErr) {
          console.error('[cron/parent-pack-billing] suspend center', cid, susErr);
          continue;
        }

        if (waSendingOn) {
          const { data: cen } = await supabaseAdmin
            .from('centers')
            .select('name, phone')
            .eq('id', cid)
            .maybeSingle();
          const name = (cen as { name?: string } | null)?.name ?? '—';
          const phone = (cen as { phone?: string | null } | null)?.phone ?? null;
          const digits = (phone ?? '').replace(/\D/g, '');
          if (digits) {
            try {
              await sendWhatsAppMessage(
                digits,
                `تم إيقاف باقة واتساب الآباء لـ ${name} بسبب عدم السداد. يرجى الدفع من المنصة لإعادة التفعيل.`,
              );
            } catch (waErr) {
              console.error('[cron/parent-pack-billing] WA send error:', waErr);
            }
          }
        }
      }
    }

    const recordsProcessed = list.length;

    await supabaseAdmin.from('cron_log').insert({
      cron_name: CRON_NAME,
      status: 'success',
      duration_ms: Date.now() - cronStart,
      records_processed: recordsProcessed,
      metadata: { skipped_top_centers_pack: skippedTopCentersPack },
    });

    return NextResponse.json({ success: true, processed: recordsProcessed });
  } catch (error) {
    console.error(`[${CRON_NAME}] Error:`, error);
    try {
      await supabaseAdmin.from('cron_log').insert({
        cron_name: CRON_NAME,
        status: 'failure',
        duration_ms: Date.now() - cronStart,
        error_message: error instanceof Error ? error.message.slice(0, 2000) : 'Unknown',
      });
    } catch (logErr) {
      console.error(`[${CRON_NAME}] cron_log:`, logErr);
    }
    return NextResponse.json({ success: false }, { status: 200 });
  }
}

export async function GET(request: Request) {
  return POST(request);
}

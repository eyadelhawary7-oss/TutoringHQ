import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { requireCronSecret } from '@/lib/cron/requireCronSecret';
import { insertCronLogSuccess, insertCronLogFailure } from '@/lib/cron/cronLog';
import { supabaseAdmin as supabaseAdminHealth } from '@/lib/supabase-admin';
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
import { tCronBackup, tCronWaAr } from '@/lib/cronBackupI18n';
import { getProcessingFeeConfig } from '@/lib/pricingConfig';
import { applyProcessingFee } from '@/lib/processingFee';

// TODO: set to true when chq_pack_invoice is approved by Meta
const packInvoiceEnabled = true;

const CENTER_CHUNK_SIZE = 50;

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

  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized;

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

    // Flat processing fee (Section 5) added to each pack / WhatsApp-addon invoice.
    const feeCfg = await getProcessingFeeConfig();

    for (let offset = 0; offset < list.length; offset += CENTER_CHUNK_SIZE) {
      const chunk = list.slice(offset, offset + CENTER_CHUNK_SIZE);
      const chunkIds = chunk.map((c) => c.id as string);

      const packMinsEntries = await Promise.all(
        chunk.map(async (center) => {
          const centerId = center.id as string;
          const plan = String(center.plan ?? '');
          const min = await resolvePackBillingMinimumEgp(supabaseAdmin, {
            id: centerId,
            name: String((center as { name?: string }).name ?? ''),
            plan,
            pack_custom_invoice_minimum: (center as { pack_custom_invoice_minimum?: number | null })
              .pack_custom_invoice_minimum,
          });
          return [centerId, min] as const;
        }),
      );
      const packMinByCenter = new Map(packMinsEntries);
      for (const [, min] of packMinsEntries) {
        if (min === null) skippedTopCentersPack += 1;
      }

      const { data: invRows } = await supabaseAdmin
        .from('invoices')
        .select('center_id, invoice_number')
        .in('center_id', chunkIds);

      const invoiceKeySet = new Set<string>();
      for (const inv of invRows ?? []) {
        const row = inv as { center_id: string; invoice_number: string };
        invoiceKeySet.add(`${row.center_id}|${row.invoice_number}`);
      }

      const { data: countRows, error: countRowsErr } = await supabaseAdmin
        .from('parent_pack_monthly_counts')
        .select('center_id')
        .in('center_id', chunkIds)
        .eq('billing_period', prevPeriod);
      if (countRowsErr) {
        console.error('[cron/parent-pack-billing] bulk count', countRowsErr);
      }
      const billedCountByCenter = new Map<string, number>();
      for (const r of countRows ?? []) {
        const cid = (r as { center_id: string }).center_id;
        billedCountByCenter.set(cid, (billedCountByCenter.get(cid) ?? 0) + 1);
      }

      const { data: packStudents, error: stBulkErr } = await supabaseAdmin
        .from('students')
        .select('id, parent_phone, center_id')
        .in('center_id', chunkIds)
        .eq('parent_pack_opted_in', true)
        .eq('is_active', true)
        .not('parent_phone', 'is', null);
      if (stBulkErr) {
        console.error('[cron/parent-pack-billing] bulk students', stBulkErr);
      }
      const packStudentsByCenter = new Map<
        string,
        { id: string; center_id: string; parent_phone: string }[]
      >();
      for (const s of packStudents ?? []) {
        const row = s as { id: string; center_id: string; parent_phone: string };
        const arr = packStudentsByCenter.get(row.center_id) ?? [];
        arr.push(row);
        packStudentsByCenter.set(row.center_id, arr);
      }

      const rollingEntries = await Promise.all(
        chunk.map(async (center) => {
          const centerId = center.id as string;
          const n = await computeRollingParentCount(supabaseAdmin, centerId, prevPeriod);
          return [centerId, n] as const;
        }),
      );
      const rollingByCenter = new Map(rollingEntries);

      for (const center of chunk) {
        const centerId = center.id as string;
        const plan = String(center.plan ?? '');
        const sessionD =
          center.parent_pack_enabled === true && String(center.pack_request_status ?? '') === 'approved';

        const packBillingMin = packMinByCenter.get(centerId) ?? null;

        if (sessionD) {
          const [billingYear, billingMonth] = prevPeriod.split('-');
          const code = centerCodeForPack(center as { center_code?: string; referral_code?: string; id: string });
          const invoiceNumber = `PACK-${code}-${billingYear}-${billingMonth}`;

          const existsPackInv = invoiceKeySet.has(`${centerId}|${invoiceNumber}`);

          if (!existsPackInv && packBillingMin !== null) {
            const rolling = rollingByCenter.get(centerId) ?? 0;
            const pricePer = Number((center as { pack_price_per_parent?: number }).pack_price_per_parent ?? 12);
            const baseLine = Math.max(rolling * pricePer, packBillingMin);
            const pending = Number((center as { pack_pending_balance?: number }).pack_pending_balance ?? 0);
            const totalAmount = baseLine + (pending > 0 ? pending : 0);
            const { fee: packFee, total: packChargedTotal } = applyProcessingFee(totalAmount, feeCfg);

            const periodStart = `${prevPeriod}-01`;
            const periodEnd = billingMonthEndYmd(prevPeriod);

            const { error: packInvErr } = await supabaseAdmin.from('invoices').insert({
              center_id: centerId,
              invoice_number: invoiceNumber,
              invoice_type: 'pack_billing',
              base_amount: totalAmount,
              total_amount: packChargedTotal,
              billing_period_start: periodStart,
              billing_period_end: periodEnd,
              due_date: dateInNDays(7),
              status: 'pending',
              payment_reference: `Parent Pack, ${prevPeriod} (${rolling} parents)`,
              metadata: { processing_fee: packFee },
            });

            if (packInvErr) {
              console.error('[cron/parent-pack-billing] pack_billing invoice', centerId, packInvErr);
            } else {
              invoiceKeySet.add(`${centerId}|${invoiceNumber}`);
              const { error: balErr } = await supabaseAdmin
                .from('centers')
                .update({ pack_pending_balance: 0 })
                .eq('id', centerId);
              if (balErr) console.error('[cron/parent-pack-billing] reset pack_pending_balance', centerId, balErr);

              void sendChqPackInvoiceTemplate(supabaseAdmin, packInvoiceEnabled, {
                name: (center as { name?: string }).name ?? ',',
                phone: (center as { phone?: string | null }).phone ?? null,
                monthArabic: billingPeriodArabicMonthYear(prevPeriod),
                parentCountStr: String(rolling),
                amountStr: String(packChargedTotal),
              }).catch((waErr) => console.error('[cron/parent-pack-billing] WA send error:', waErr));
            }
          }
        }

        if (!sessionD) {
          const billedStudents = countRowsErr ? 0 : (billedCountByCenter.get(centerId) ?? 0);
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
            const { fee: waFee, total: waChargedTotal } = applyProcessingFee(newPendingBalance, feeCfg);

            const { error: invErr } = await supabaseAdmin.from('invoices').insert({
              center_id: centerId,
              invoice_number: invoiceNumber,
              invoice_type: 'whatsapp_addon',
              base_amount: newPendingBalance,
              total_amount: waChargedTotal,
              billing_period_start: periodStart,
              billing_period_end: periodEnd,
              due_date: dateInNDays(7),
              status: 'pending',
              payment_reference: `WhatsApp Pack, ${prevPeriod} (${descCount} students)`,
              metadata: { processing_fee: waFee },
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
          const activeStudents = packStudentsByCenter.get(centerId);

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
      }

      const suspendIds = [...seenSuspend];
      if (suspendIds.length > 0) {
        const { error: bulkSusErr } = await supabaseAdmin
          .from('centers')
          .update({
            pack_request_status: 'suspended',
            parent_pack_enabled: false,
          })
          .in('id', suspendIds);
        if (bulkSusErr) {
          console.error('[cron/parent-pack-billing] bulk suspend', bulkSusErr);
        } else if (waSendingOn) {
          const { data: cenRows } = await supabaseAdmin
            .from('centers')
            .select('id, name, phone')
            .in('id', suspendIds);
          const cenById = new Map(
            (cenRows ?? []).map((c) => [c.id as string, c as { name?: string; phone?: string | null }]),
          );
          for (const cid of suspendIds) {
            const cen = cenById.get(cid);
            const name = cen?.name ?? ',';
            const phone = cen?.phone ?? null;
            const digits = (phone ?? '').replace(/\D/g, '');
            if (digits) {
              void sendWhatsAppMessage(
                digits,
                tCronWaAr('waParentPackSuspended', { name }),
              ).catch((waErr) => console.error('[cron/parent-pack-billing] WA send error:', waErr));
            }
          }
        }
      }
    }

    const recordsProcessed = list.length;

    await insertCronLogSuccess(supabaseAdmin, CRON_NAME, {
      duration_ms: Date.now() - cronStart,
      records_processed: recordsProcessed,
      metadata: { skipped_top_centers_pack: skippedTopCentersPack },
    });

    try {
      if (supabaseAdminHealth) {
        await supabaseAdminHealth.from('cron_health_log').upsert(
          {
            cron_name: 'parent-pack-billing',
            last_success_at: new Date().toISOString(),
            failure_count: 0,
          },
          { onConflict: 'cron_name' },
        );
      }
    } catch (healthLogErr) {
      console.error('[parent-pack-billing] cron_health_log:', healthLogErr);
    }

    return NextResponse.json({ success: true, processed: recordsProcessed });
  } catch (error) {
    console.error(`[${CRON_NAME}] Error:`, error);
    await insertCronLogFailure(supabaseAdmin, CRON_NAME, error, {
      duration_ms: Date.now() - cronStart,
    });
    return NextResponse.json({ success: false }, { status: 200 });
  }
}

export async function GET(request: Request) {
  return POST(request);
}

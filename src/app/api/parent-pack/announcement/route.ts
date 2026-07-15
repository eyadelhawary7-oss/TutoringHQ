import { NextRequest, NextResponse } from 'next/server';
import { sendParentAnnouncementOps, sendParentAnnouncementPromo } from '@/lib/centerNotify';
import {
  BLAST_BASE_PER_PARENT,
  BLAST_SERVICE_FEE_RATE,
  BLAST_VAT_RATE,
  dateInNDays,
  getAnnouncementCap,
  todayISO,
  WA_TEMPLATES,
} from '@/lib/parentPack';
import { BLAST_PRICE_PER_PARENT_INCLUSIVE } from '@/lib/invoiceTemplates';
import { requireOwnerAdminCenter } from '@/lib/requireOwnerAdminCenter';
import { parseBodyWithLimit, validateString, ValidationError } from '@/lib/validate';
import { getProcessingFeeConfig } from '@/lib/pricingConfig';
import { applyProcessingFee, buildInvoiceTaxSnapshot } from '@/lib/processingFee';

export const dynamic = 'force-dynamic';

const WA_MESSAGE_SEND_MAX = 160;

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireOwnerAdminCenter(request);
    if (ctx instanceof NextResponse) return ctx;

    const { supabaseAdmin, centerId, userId } = ctx;

    const body = (await parseBodyWithLimit(request, 32768)) as Record<string, unknown>;
    const blastType = validateString(body.blast_type, 'blast_type', { required: true, maxLength: 10 });
    if (!['ops', 'promo'].includes(blastType)) {
      throw new ValidationError('Invalid blast_type', 'blast_type');
    }

    const rawMessage =
      body.messageBody !== undefined && body.messageBody !== null
        ? body.messageBody
        : body.message;
    const messageBody = validateString(rawMessage, 'messageBody', {
      required: true,
      maxLength: 4096,
    });

    const { data: center } = await supabaseAdmin
      .from('centers')
      .select('id, name, plan, announcement_balance')
      .eq('id', centerId)
      .maybeSingle();

    if (!center) {
      return NextResponse.json({ error: 'Center not found' }, { status: 404 });
    }

    const now = new Date();
    const startOfMonthUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
    const { count: blastsThisMonth, error: monthCountErr } = await supabaseAdmin
      .from('announcement_blasts')
      .select('id', { count: 'exact', head: true })
      .eq('center_id', centerId)
      .gte('created_at', startOfMonthUtc);
    if (monthCountErr) {
      console.error('[parent-pack/announcement] monthly count', monthCountErr);
      return NextResponse.json({ error: 'Failed to verify announcement limit' }, { status: 500 });
    }
    if ((blastsThisMonth ?? 0) >= 2) {
      return NextResponse.json(
        { error: 'monthly_limit', message: 'Maximum 2 announcements per month' },
        { status: 429 },
      );
    }

    const cap = getAnnouncementCap(center.plan as string);
    const currentBalance = Number(center.announcement_balance ?? 0);
    if (currentBalance >= cap) {
      return NextResponse.json({ error: 'cap_reached' }, { status: 400 });
    }

    const { data: parents } = await supabaseAdmin
      .from('students')
      .select('id, name, parent_phone')
      .eq('center_id', centerId)
      .eq('parent_pack_opted_in', true)
      .not('parent_phone', 'is', null)
      .eq('is_active', true);

    const parentsNotified = parents?.length ?? 0;
    if (parentsNotified === 0) {
      return NextResponse.json({ error: 'no_parents' }, { status: 400 });
    }

    const baseAmount = Math.round(parentsNotified * BLAST_BASE_PER_PARENT * 100) / 100;
    const serviceFee = Math.round(baseAmount * BLAST_SERVICE_FEE_RATE * 100) / 100;
    const vat = Math.round(baseAmount * BLAST_VAT_RATE * 100) / 100;
    const totalAmount = parentsNotified * BLAST_PRICE_PER_PARENT_INCLUSIVE;

    const templateName =
      blastType === 'ops' ? WA_TEMPLATES.PARENT_ANNOUNCEMENT_OPS : WA_TEMPLATES.PARENT_ANNOUNCEMENT_PROMO;

    await supabaseAdmin.from('announcement_blasts').insert({
      center_id: centerId,
      sent_by: userId,
      template_name: templateName,
      blast_type: blastType,
      message: messageBody,
      parents_notified: parentsNotified,
      base_amount: baseAmount,
      service_fee: serviceFee,
      vat,
      total_amount: totalAmount,
      billing_status: 'pending',
    });

    const newBalance = currentBalance + totalAmount;
    await supabaseAdmin
      .from('centers')
      .update({
        announcement_balance: newBalance,
        announcement_balance_updated_at: new Date().toISOString(),
      })
      .eq('id', centerId);

    if (newBalance >= cap) {
      const today = todayISO();
      // Flat 20 EGP processing fee rides every invoice (added on top of the blast balance).
      const feeCfg = await getProcessingFeeConfig();
      const { fee: processingFee, total: capTotal } = applyProcessingFee(newBalance, feeCfg);
      await supabaseAdmin.from('invoices').insert({
        center_id: centerId,
        invoice_number: `BLAST-${Date.now()}`,
        invoice_type: 'announcement_cap',
        base_amount: newBalance,
        total_amount: capTotal,
        // VAT is on the blast balance only; the flat fee is not VAT-bearing here.
        ...buildInvoiceTaxSnapshot({ total: capTotal, fee: processingFee, vatBasis: newBalance }),
        billing_period_start: today,
        billing_period_end: today,
        due_date: dateInNDays(7),
        status: 'pending',
        metadata: { processing_fee: processingFee },
      });
      await supabaseAdmin
        .from('announcement_blasts')
        .update({ billing_status: 'charged', charged_at: new Date().toISOString() })
        .eq('center_id', centerId)
        .eq('billing_status', 'pending');
      await supabaseAdmin
        .from('centers')
        .update({
          announcement_balance: 0,
          announcement_balance_updated_at: new Date().toISOString(),
        })
        .eq('id', centerId);
    }

    const centerName = center.name ?? '';
    const msgForSend = messageBody.slice(0, WA_MESSAGE_SEND_MAX);
    for (const p of parents ?? []) {
      if (!p.parent_phone) continue;
      if (blastType === 'promo') {
        await sendParentAnnouncementPromo(p.parent_phone, centerName, msgForSend);
      } else {
        await sendParentAnnouncementOps(p.parent_phone, centerName, msgForSend);
      }
    }

    return NextResponse.json({
      success: true,
      sent: parentsNotified,
      totalCost: totalAmount,
    });
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message, field: err.field }, { status: 400 });
    }
    throw err;
  }
}

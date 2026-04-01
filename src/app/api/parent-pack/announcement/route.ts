import { NextRequest, NextResponse } from 'next/server';
import { sendTemplateMessage } from '@/lib/whatsapp/client';
import {
  BLAST_BASE_PER_PARENT,
  BLAST_PRICE_PER_PARENT,
  BLAST_SERVICE_FEE_RATE,
  BLAST_VAT_RATE,
  dateInNDays,
  getAnnouncementCap,
  todayISO,
  WA_TEMPLATES,
} from '@/lib/parentPack';
import { requireOwnerAdminCenter } from '@/lib/requireOwnerAdminCenter';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const ctx = await requireOwnerAdminCenter(request);
  if (ctx instanceof NextResponse) return ctx;

  const { supabaseAdmin, centerId, userId } = ctx;

  let body: { blast_type?: string; message?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!body.blast_type || !['ops', 'promo'].includes(body.blast_type)) {
    return NextResponse.json({ error: 'Invalid blast_type' }, { status: 400 });
  }

  if (
    !body.message ||
    typeof body.message !== 'string' ||
    body.message.trim().length === 0 ||
    body.message.length > 200
  ) {
    return NextResponse.json({ error: 'Invalid message' }, { status: 400 });
  }

  const { data: center } = await supabaseAdmin
    .from('centers')
    .select('id, name, plan, announcement_balance')
    .eq('id', centerId)
    .maybeSingle();

  if (!center) {
    return NextResponse.json({ error: 'Center not found' }, { status: 404 });
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
  const totalAmount = parentsNotified * BLAST_PRICE_PER_PARENT;

  const templateName =
    body.blast_type === 'ops' ? WA_TEMPLATES.PARENT_ANNOUNCEMENT_OPS : WA_TEMPLATES.PARENT_ANNOUNCEMENT_PROMO;

  await supabaseAdmin.from('announcement_blasts').insert({
    center_id: centerId,
    sent_by: userId,
    template_name: templateName,
    blast_type: body.blast_type,
    message: body.message.trim(),
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
    await supabaseAdmin.from('invoices').insert({
      center_id: centerId,
      invoice_number: `BLAST-${Date.now()}`,
      invoice_type: 'announcement_cap',
      base_amount: newBalance,
      total_amount: newBalance,
      billing_period_start: today,
      billing_period_end: today,
      due_date: dateInNDays(7),
      status: 'pending',
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
  for (const p of parents ?? []) {
    if (!p.parent_phone) continue;
    await sendTemplateMessage(centerId, p.parent_phone, templateName, {
      '1': centerName,
      '2': body.message.trim(),
    });
  }

  return NextResponse.json({
    success: true,
    sent: parentsNotified,
    totalCost: totalAmount,
  });
}

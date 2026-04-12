/**
 * Paymob / pending invoice webhook failure alert: one grouped WhatsApp to admin (Eyad).
 */

import { NextResponse } from 'next/server';
import { sendFreeformMessage } from '@/lib/whatsapp/client';
import { supabaseAdmin } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const CRON_NAME = 'payment-alert';
const INVOICE_TYPES = ['subscription', 'signup_first_payment', 'pack_billing'] as const;

type CenterEmbed = {
  name: string | null;
  owner_phone: string | null;
  phone: string | null;
};

type InvoiceRow = {
  id: string;
  invoice_number: string | null;
  due_date: string;
  invoice_type: string | null;
  created_at: string;
  center_id: string;
  centers: CenterEmbed | CenterEmbed[] | null;
};

function embeddedCenter(row: InvoiceRow): CenterEmbed | null {
  const c = row.centers;
  if (c == null) return null;
  return Array.isArray(c) ? (c[0] ?? null) : c;
}

async function upsertCronHealth(admin: NonNullable<typeof supabaseAdmin>) {
  const { error } = await admin.from('cron_health_log').upsert(
    {
      cron_name: CRON_NAME,
      last_success_at: new Date().toISOString(),
      failure_count: 0,
    },
    { onConflict: 'cron_name' },
  );
  if (error) {
    console.error(`[${CRON_NAME}] cron_health_log:`, error.message);
  }
}

export async function POST(request: Request) {
  const auth = request.headers.get('Authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!supabaseAdmin) {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }

  const admin = supabaseAdmin;
  const now = Date.now();
  const today = new Date().toISOString().slice(0, 10);
  const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();
  const twentyFourHoursAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();

  const { data: rawRows, error: invErr } = await admin
    .from('invoices')
    .select('id, invoice_number, due_date, invoice_type, created_at, center_id, centers(name, owner_phone, phone)')
    .eq('status', 'pending')
    .lte('due_date', today)
    .lt('created_at', twoHoursAgo)
    .is('payment_alert_sent_at', null)
    .in('invoice_type', [...INVOICE_TYPES]);

  if (invErr) {
    console.error(`[${CRON_NAME}] invoices:`, invErr.message);
    return NextResponse.json({ error: invErr.message }, { status: 500 });
  }

  const candidates = (rawRows ?? []) as unknown as InvoiceRow[];
  const totalCandidates = candidates.length;

  if (totalCandidates === 0) {
    await upsertCronHealth(admin);
    return NextResponse.json({ alerted: 0, skipped: 0 });
  }

  const paymentByCenter = new Map<string, boolean>();

  async function centerHasRecentPayment(centerId: string): Promise<boolean> {
    const cached = paymentByCenter.get(centerId);
    if (cached !== undefined) return cached;

    const { data: row, error } = await admin
      .from('payments')
      .select('id')
      .eq('center_id', centerId)
      .gte('paid_at', twentyFourHoursAgo)
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error(`[${CRON_NAME}] payments check`, centerId, error.message);
      paymentByCenter.set(centerId, true);
      return true;
    }

    const has = row != null;
    paymentByCenter.set(centerId, has);
    return has;
  }

  const alertList: InvoiceRow[] = [];
  for (const inv of candidates) {
    if (await centerHasRecentPayment(inv.center_id)) continue;
    alertList.push(inv);
  }

  const skipped = totalCandidates - alertList.length;

  if (alertList.length === 0) {
    await upsertCronHealth(admin);
    return NextResponse.json({ alerted: 0, skipped });
  }

  const adminRaw = process.env.ADMIN_WHATSAPP_NUMBER;
  if (!adminRaw?.trim()) {
    console.warn(`[${CRON_NAME}] ADMIN_WHATSAPP_NUMBER not set`);
    await upsertCronHealth(admin);
    return NextResponse.json({ alerted: 0, skipped, error: 'ADMIN_WHATSAPP_NUMBER not set' });
  }

  const centerList = alertList
    .map((i) => {
      const cen = embeddedCenter(i);
      const name = cen?.name ?? '';
      const num = i.invoice_number ?? i.id.slice(0, 8);
      return `${name} (${num})`;
    })
    .join(', ');

  const message =
    `[CenterHQ PAYMENT ALERT] ` +
    `${alertList.length.toLocaleString('en-US')} فاتورة متأخرة بدون دفع. ` +
    `المراكز: ${centerList}. ` +
    `تحقق من Paymob dashboard.`;

  const logCenterId = alertList[0].center_id;

  let sendOk = false;
  try {
    const result = await sendFreeformMessage(logCenterId, adminRaw.trim(), message);
    sendOk = result.success;
    if (!result.success) {
      console.error(`[${CRON_NAME}] sendFreeformMessage:`, result.error);
    }
  } catch (e) {
    console.error(`[${CRON_NAME}] sendFreeformMessage exception:`, e);
  }

  if (!sendOk) {
    await upsertCronHealth(admin);
    return NextResponse.json({ alerted: 0, skipped });
  }

  const ids = alertList.map((i) => i.id);
  const nowIso = new Date().toISOString();
  const { error: upErr } = await admin.from('invoices').update({ payment_alert_sent_at: nowIso }).in('id', ids);

  if (upErr) {
    console.error(`[${CRON_NAME}] invoice update:`, upErr.message);
    await upsertCronHealth(admin);
    return NextResponse.json({ alerted: 0, skipped, error: upErr.message });
  }

  await upsertCronHealth(admin);
  return NextResponse.json({ alerted: alertList.length, skipped });
}

export async function GET(request: Request) {
  return POST(request);
}

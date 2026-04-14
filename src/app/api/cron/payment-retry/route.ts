/**
 * Failed / overdue invoice Paymob retry (daily). Gated by FEATURES.PAYMOB_ENABLED.
 */

import { NextResponse } from 'next/server';
import { createPaymentLink } from '@/lib/paymob';
import { sendPaymentRetry } from '@/lib/centerNotify';
import { FEATURES } from '@/lib/features';
import { ownerContactByCenterId, resolveOwnerWaPhoneCached } from '@/lib/ownerPhone';
import { supabaseAdmin } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const CRON_NAME = 'payment-retry';

function addDaysToYmd(ymd: string, deltaDays: number): string {
  const [y, m, d] = ymd.slice(0, 10).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

type CenterEmbed = {
  id: string;
  name: string | null;
  owner_name: string | null;
  phone: string | null;
  plan: string | null;
  status: string | null;
};

type InvoiceRetryRow = {
  id: string;
  invoice_number: string;
  total_amount: number | string | null;
  due_date: string;
  retry_count: number | null;
  invoice_type: string;
  centers: CenterEmbed | CenterEmbed[] | null;
};

function embeddedCenter(row: InvoiceRetryRow): CenterEmbed | null {
  const c = row.centers;
  if (c == null) return null;
  return Array.isArray(c) ? (c[0] ?? null) : c;
}

export async function POST(request: Request) {
  const auth = request.headers.get('authorization') ?? request.headers.get('Authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!FEATURES.PAYMOB_ENABLED) {
    return NextResponse.json({
      skipped: true,
      reason: 'PAYMOB_ENABLED is false',
    });
  }

  if (!supabaseAdmin) {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }

  const admin = supabaseAdmin;
  const todayStr = new Date().toISOString().slice(0, 10);

  let rows: InvoiceRetryRow[] = [];
  try {
    const { data, error } = await admin
      .from('invoices')
      .select(
        `
        id,
        invoice_number,
        total_amount,
        due_date,
        retry_count,
        invoice_type,
        centers!inner (
          id,
          name,
          owner_name,
          phone,
          plan,
          status
        )
      `,
      )
      .in('status', ['failed', 'overdue'])
      .eq('centers.status', 'active')
      .or(`next_retry_at.is.null,next_retry_at.lte.${todayStr}`)
      .in('invoice_type', ['subscription', 'pack_billing']);

    if (error) {
      console.error(`[${CRON_NAME}] query:`, error.message);
    } else {
      rows = (data ?? []) as InvoiceRetryRow[];
    }
  } catch (e) {
    console.error(`[${CRON_NAME}] query:`, e);
  }

  const processed = rows.length;
  let retried = 0;
  let skipped = 0;

  const centerIds = [
    ...new Set(
      rows
        .map((r) => embeddedCenter(r)?.id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    ),
  ];
  const ownerByCenter = await ownerContactByCenterId(admin, centerIds);
  const ownerPhoneCache = new Map<string, string | null>();

  for (const raw of rows) {
    const center = embeddedCenter(raw);
    if (!center || center.status !== 'active') {
      skipped += 1;
      continue;
    }

    const rc = Number(raw.retry_count ?? 0);
    if (!Number.isFinite(rc) || rc >= 2) {
      skipped += 1;
      continue;
    }

    const oc = ownerByCenter.get(center.id);
    const ownerPhone = (
      await resolveOwnerWaPhoneCached(
        admin,
        oc?.authId ?? null,
        oc?.userPhone,
        center.phone,
        ownerPhoneCache,
      )
    )?.trim();
    if (!ownerPhone) {
      skipped += 1;
      continue;
    }

    const amount = Number(raw.total_amount ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      skipped += 1;
      continue;
    }

    const dueYmd = String(raw.due_date).slice(0, 10);
    const centerName = (center.name ?? 'Center').trim() || 'Center';
    const ownerName = (center.owner_name ?? center.name ?? '').trim() || '—';

    let paymentLink = '';
    let paymobOrderId = '';
    try {
      const created = await createPaymentLink(
        raw.id,
        amount,
        centerName,
        raw.invoice_number,
        ownerPhone,
      );
      paymentLink = created.paymentLink;
      paymobOrderId = created.paymobOrderId;
    } catch (e) {
      console.error(`[${CRON_NAME}] createPaymentLink`, raw.id, e);
      skipped += 1;
      continue;
    }

    let sendOk = false;
    try {
      const sendRes = await sendPaymentRetry(
        admin,
        center.id,
        ownerPhone,
        ownerName,
        centerName,
        amount,
        paymentLink,
        rc === 1,
      );
      sendOk = sendRes.success === true;
    } catch (e) {
      console.error(`[${CRON_NAME}] sendPaymentRetry`, raw.id, e);
    }

    if (!sendOk) {
      skipped += 1;
      continue;
    }

    const nextRetryAt = rc === 0 ? addDaysToYmd(dueYmd, 6) : addDaysToYmd(dueYmd, 8);
    const newRetryCount = rc + 1;

    try {
      const { error: upErr } = await admin
        .from('invoices')
        .update({
          paymob_order_id: paymobOrderId,
          retry_count: newRetryCount,
          last_retry_at: new Date().toISOString(),
          next_retry_at: nextRetryAt,
        })
        .eq('id', raw.id);
      if (upErr) {
        console.error(`[${CRON_NAME}] invoice update`, raw.id, upErr.message);
        skipped += 1;
        continue;
      }
    } catch (e) {
      console.error(`[${CRON_NAME}] invoice update`, raw.id, e);
      skipped += 1;
      continue;
    }

    retried += 1;
  }

  try {
    await admin.from('cron_health_log').upsert(
      {
        cron_name: CRON_NAME,
        last_success_at: new Date().toISOString(),
        failure_count: 0,
      },
      { onConflict: 'cron_name' },
    );
  } catch (e) {
    console.error(`[${CRON_NAME}] cron_health_log:`, e);
  }

  return NextResponse.json({
    processed,
    retried,
    skipped,
  });
}

export async function GET(request: Request) {
  return POST(request);
}

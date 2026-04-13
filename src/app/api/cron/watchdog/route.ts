/**
 * Cron watchdog: hourly dead-man switch; alerts admin if crons miss expected success window.
 */

import { NextResponse } from 'next/server';
import { normalizeWhatsAppNumber, sendWhatsAppMessage } from '@/lib/whatsapp';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { formatNumber } from '@/lib/formatNumber';

const OP_LOCALE = 'en';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const TWO_H_MS = 2 * 60 * 60 * 1000;
const MS_PER_MIN = 60 * 1000;

type CronHealthRow = {
  cron_name: string;
  last_success_at: string | null;
  last_failure_at: string | null;
  failure_count: number;
  expected_interval_minutes: number;
};

function thresholdMultiplier(cronName: string): number {
  if (cronName === 'check-stuck-payments') return 3;
  return 1.5;
}

async function upsertWatchdogSuccess(admin: NonNullable<typeof supabaseAdmin>) {
  const nowIso = new Date().toISOString();
  const { error } = await admin.from('cron_health_log').upsert(
    {
      cron_name: 'watchdog',
      last_success_at: nowIso,
      expected_interval_minutes: 60,
    },
    { onConflict: 'cron_name' },
  );
  if (error) {
    console.error('[watchdog] self upsert:', error.message);
  }
}

async function runWatchdog(): Promise<{ overdue: number; alerted: number }> {
  if (!supabaseAdmin) {
    return { overdue: 0, alerted: 0 };
  }

  const admin = supabaseAdmin;

  const { data: rows, error: qErr } = await admin
    .from('cron_health_log')
    .select('cron_name, last_success_at, last_failure_at, failure_count, expected_interval_minutes');

  if (qErr) {
    console.error('[watchdog] query:', qErr.message);
    await upsertWatchdogSuccess(admin);
    return { overdue: 0, alerted: 0 };
  }

  const list = (rows ?? []) as CronHealthRow[];
  const now = Date.now();
  let timeOverdue = 0;
  const toAlert: CronHealthRow[] = [];

  for (const row of list) {
    if (row.cron_name === 'status-ping') continue;

    const intervalMin = Number(row.expected_interval_minutes) || 1440;
    const mult = thresholdMultiplier(row.cron_name);
    const thresholdMs = intervalMin * mult * MS_PER_MIN;

    let overdue = false;
    if (!row.last_success_at) {
      overdue = true;
    } else {
      const last = new Date(row.last_success_at).getTime();
      if (!Number.isFinite(last) || now - last > thresholdMs) {
        overdue = true;
      }
    }

    if (!overdue) continue;
    timeOverdue += 1;

    const failT = row.last_failure_at ? new Date(row.last_failure_at).getTime() : null;
    const cooldownOk = failT == null || failT < now - TWO_H_MS;
    if (!cooldownOk) continue;

    toAlert.push(row);
  }

  if (toAlert.length === 0) {
    await upsertWatchdogSuccess(admin);
    return { overdue: timeOverdue, alerted: 0 };
  }

  const overdueList = toAlert
    .map((c) => {
      if (!c.last_success_at) {
        return `${c.cron_name} (never)`;
      }
      const hoursAgo = Math.floor(
        (Date.now() - new Date(c.last_success_at).getTime()) / (1000 * 60 * 60),
      );
      return `${c.cron_name} (${formatNumber(hoursAgo, OP_LOCALE)}h ago)`;
    })
    .join('\n');

  const message =
    `[CenterHQ ALERT] ` +
    `${formatNumber(toAlert.length, OP_LOCALE)} cron(s) overdue:\n${overdueList}\n` +
    `Check Vercel logs immediately.`;

  const adminPhone = process.env.ADMIN_WHATSAPP_NUMBER?.trim();
  let sendOk = false;
  if (adminPhone) {
    try {
      const to = normalizeWhatsAppNumber(adminPhone);
      sendOk = await sendWhatsAppMessage(to, message);
      if (!sendOk) {
        console.error('[watchdog] WhatsApp send returned false');
      }
    } catch (e) {
      console.error('[watchdog] WhatsApp send:', e);
    }
  } else {
    console.warn('[watchdog] ADMIN_WHATSAPP_NUMBER not set');
  }

  if (sendOk) {
    const nowIso = new Date().toISOString();
    for (const c of toAlert) {
      const nextCount = (Number(c.failure_count) || 0) + 1;
      const { error: upErr } = await admin
        .from('cron_health_log')
        .update({
          last_failure_at: nowIso,
          failure_count: nextCount,
        })
        .eq('cron_name', c.cron_name);
      if (upErr) {
        console.error('[watchdog] update', c.cron_name, upErr.message);
      }
    }
  }

  await upsertWatchdogSuccess(admin);
  return { overdue: timeOverdue, alerted: sendOk ? toAlert.length : 0 };
}

export async function POST(request: Request) {
  try {
    const auth = request.headers.get('Authorization');
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const result = await runWatchdog();
    return NextResponse.json(result);
  } catch (e) {
    console.error('[watchdog] fatal:', e);
    try {
      if (supabaseAdmin) {
        await upsertWatchdogSuccess(supabaseAdmin);
      }
    } catch {
      /* ignore */
    }
    return NextResponse.json({ overdue: 0, alerted: 0 }, { status: 200 });
  }
}

export async function GET(request: Request) {
  return POST(request);
}

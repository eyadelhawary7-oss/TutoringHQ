/**
 * Daily WhatsApp operations summary
 * Cairo time (UTC+2). Yesterday's attended, absent, payments, balance.
 * Template: chq_daily_summary
 */

import { createClient } from '@supabase/supabase-js';
import { sendTemplateMessage } from '../client';

const TEMPLATE = 'chq_daily_summary';
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://center-hq.vercel.app';

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase not configured');
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Cairo = UTC+2. Get yesterday's date string (YYYY-MM-DD) in Cairo. */
export function getYesterdayCairo(): string {
  const now = new Date();
  const cairoOffset = 2 * 60 * 60 * 1000;
  const cairoNow = new Date(now.getTime() + cairoOffset);
  const cairoYesterday = new Date(cairoNow);
  cairoYesterday.setUTCDate(cairoYesterday.getUTCDate() - 1);
  const y = cairoYesterday.getUTCFullYear();
  const m = String(cairoYesterday.getUTCMonth() + 1).padStart(2, '0');
  const d = String(cairoYesterday.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Cairo yesterday 00:00 and 23:59:59 in UTC for scanned_at range. Cairo = UTC+2. */
export function getYesterdayCairoUtcRange(): { start: string; end: string } {
  const yesterday = getYesterdayCairo();
  const [y, m, d] = yesterday.split('-').map(Number);
  const prevDay = new Date(Date.UTC(y, m - 1, d - 1));
  const start = new Date(Date.UTC(prevDay.getUTCFullYear(), prevDay.getUTCMonth(), prevDay.getUTCDate(), 22, 0, 0, 0));
  const end = new Date(Date.UTC(y, m - 1, d, 21, 59, 59, 999));
  return {
    start: start.toISOString(),
    end: end.toISOString(),
  };
}

/** Format Arabic date for yesterday. */
export function formatYesterdayArabic(): string {
  const yesterday = getYesterdayCairo();
  const [y, m, d] = yesterday.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export interface DailySummaryData {
  centerId: string;
  centerName: string;
  phone: string;
  attendedCount: number;
  absentCount: number;
  paymentsCollected: number;
  pendingPayments: number;
  pendingBalanceTotal: number;
}

export async function sendDailySummary(data: DailySummaryData): Promise<{ success: boolean; error?: string }> {
  const dashboardUrl = `${APP_URL}/ar/dashboard`;
  const variables: Record<string, string> = {
    '1': data.centerName,
    '2': formatYesterdayArabic(),
    '3': String(data.attendedCount),
    '4': String(data.absentCount),
    '5': Number(data.paymentsCollected).toLocaleString('en-US'),
    '6': Number(data.pendingPayments).toLocaleString('en-US'),
    '7': Number(data.pendingBalanceTotal).toLocaleString('en-US'),
    '8': dashboardUrl,
  };

  const result = await sendTemplateMessage(data.centerId, data.phone, TEMPLATE, variables);
  return { success: result.success, error: result.error };
}

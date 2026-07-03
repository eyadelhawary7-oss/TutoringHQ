/**
 * Daily WhatsApp operations summary
 * Cairo time (UTC+2). Yesterday's attended, absent, payments, balance.
 * Template: chq_daily_summary
 */

import { createClient } from '@supabase/supabase-js';
import { isTemplateApproved } from '@/lib/centerNotify';
import { formatDate, formatNumber } from '@/lib/formatNumber';
import { sendTemplateMessage } from '../client';

const WA_AR = 'ar';

const TEMPLATE = 'chq_daily_summary';
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://tutoringhq.app';

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
  return formatDate(date, WA_AR, {
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
  const admin = getSupabaseAdmin();
  const approved = await isTemplateApproved(TEMPLATE, admin);
  if (!approved) {
    return { success: true };
  }

  const dashboardUrl = `${APP_URL}/ar/dashboard`;
  const variables: Record<string, string> = {
    '1': data.centerName,
    '2': formatYesterdayArabic(),
    '3': formatNumber(data.attendedCount, WA_AR),
    '4': formatNumber(data.absentCount, WA_AR),
    '5': formatNumber(Number(data.paymentsCollected), WA_AR),
    '6': formatNumber(Number(data.pendingPayments), WA_AR),
    '7': formatNumber(Number(data.pendingBalanceTotal), WA_AR),
    '8': dashboardUrl,
  };

  const result = await sendTemplateMessage(data.centerId, data.phone, TEMPLATE, variables);
  return { success: result.success, error: result.error };
}
